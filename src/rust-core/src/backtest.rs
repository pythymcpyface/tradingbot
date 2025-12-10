use crate::{BacktestConfig, BacktestResult, BacktestOrder, GlickoRating, Result};
use crate::data::MovingStats;
use rayon::prelude::*;
use std::collections::HashMap;

/// Represents an open position in the portfolio.
///
/// OCO (One-Cancels-Other) Exit Mechanism:
/// Each position has two pre-defined exit levels that function as OCO orders:
/// 1. take_profit_price: When price reaches this level, position auto-closes with "EXIT_PROFIT"
/// 2. stop_loss_price: When price reaches this level, position auto-closes with "EXIT_STOP"
///
/// Whichever level is hit first wins and closes the position. The other is automatically cancelled
/// (since the position no longer exists). This mimics real OCO orders on Binance/Kraken.
#[derive(Debug, Clone)]
struct Position {
    symbol: String,
    quantity: f64,
    entry_price: f64,
    entry_time: i64,
    /// Stop loss threshold: price ≤ this triggers EXIT_STOP
    stop_loss_price: f64,
    /// Take profit threshold: price ≥ this triggers EXIT_PROFIT
    take_profit_price: f64,
}

#[derive(Debug, Clone)]
struct Portfolio {
    cash: f64,
    positions: HashMap<String, Position>,
    equity_curve: Vec<(i64, f64)>,
    orders: Vec<BacktestOrder>,
}

impl Portfolio {
    fn new(initial_cash: f64) -> Self {
        Self {
            cash: initial_cash,
            positions: HashMap::new(),
            equity_curve: vec![(0, initial_cash)],
            orders: Vec::new(),
        }
    }

    fn get_portfolio_value(&self, current_prices: &HashMap<String, f64>) -> f64 {
        let mut total_value = self.cash;
        
        for (symbol, position) in &self.positions {
            if let Some(&current_price) = current_prices.get(symbol) {
                total_value += position.quantity * current_price;
            }
        }
        
        total_value
    }

    /// Opens a new position with OCO (One-Cancels-Other) exit levels.
    ///
    /// Entry Rules:
    /// - Position size = allocation_percent of available cash
    /// - Each BUY signal creates a position with:
    ///   - Entry price: current market price
    ///   - Quantity: allocated_value / entry_price
    ///
    /// OCO Exit Levels:
    /// - Take Profit: entry_price * (1 + profit_percent/100)
    /// - Stop Loss: entry_price * (1 - stop_loss_percent/100)
    ///
    /// Example (2% profit_percent, 2.5% stop_loss_percent):
    /// - Entry at $100: TP=$102, SL=$97.50
    /// - Either level is hit first, position auto-closes
    /// - Z-score SELL signals can also close the position early
    fn open_position(
        &mut self,
        symbol: String,
        price: f64,
        timestamp: i64,
        config: &BacktestConfig,
        allocation_percent: f64,
    ) -> Option<BacktestOrder> {
        if self.positions.contains_key(&symbol) {
            return None; // Already have position
        }

        let position_value = self.cash * allocation_percent;
        let quantity = position_value / price;

        if quantity * price > self.cash {
            return None; // Not enough cash
        }

        // Calculate OCO exit levels
        let take_profit_price = price * (1.0 + config.profit_percent / 100.0);
        let stop_loss_price = price * (1.0 - config.stop_loss_percent / 100.0);

        let position = Position {
            symbol: symbol.clone(),
            quantity,
            entry_price: price,
            entry_time: timestamp,
            stop_loss_price,
            take_profit_price,
        };

        self.cash -= quantity * price;
        self.positions.insert(symbol.clone(), position);

        let order = BacktestOrder {
            symbol,
            side: "BUY".to_string(),
            quantity,
            price,
            timestamp,
            reason: "ENTRY".to_string(),
            profit_loss: None,
            profit_loss_percent: None,
        };

        self.orders.push(order.clone());
        Some(order)
    }

    fn close_position(
        &mut self,
        symbol: &str,
        price: f64,
        timestamp: i64,
        reason: &str,
    ) -> Option<BacktestOrder> {
        if let Some(position) = self.positions.remove(symbol) {
            let proceeds = position.quantity * price;
            self.cash += proceeds;

            let profit_loss = proceeds - (position.quantity * position.entry_price);
            let profit_loss_percent = (price - position.entry_price) / position.entry_price * 100.0;

            let order = BacktestOrder {
                symbol: symbol.to_string(),
                side: "SELL".to_string(),
                quantity: position.quantity,
                price,
                timestamp,
                reason: reason.to_string(),
                profit_loss: Some(profit_loss),
                profit_loss_percent: Some(profit_loss_percent),
            };

            self.orders.push(order.clone());
            Some(order)
        } else {
            None
        }
    }

    fn update_equity_curve(&mut self, timestamp: i64, current_prices: &HashMap<String, f64>) {
        let portfolio_value = self.get_portfolio_value(current_prices);
        self.equity_curve.push((timestamp, portfolio_value));
    }
}

/// Calculate Z-score based trading signals from Glicko-2 ratings.
///
/// Z-SCORE CALCULATION:
/// For each time period, using a rolling window of N periods:
/// - mean = average(ratings[window_start..window_end])
/// - std_dev = sqrt(variance(ratings[window_start..window_end]))
/// - z_score = (current_rating - mean) / std_dev
///
/// SIGNAL GENERATION (Z-Score Reversals):
/// - BUY signal:  z_score > +threshold  (rating significantly above average)
/// - SELL signal: z_score < -threshold  (rating significantly below average)
/// - HOLD:        -threshold ≤ z_score ≤ +threshold (neutral region)
///
/// INTERPRETATION:
/// - Positive z_score: Glicko rating is rising (bullish momentum)
/// - Negative z_score: Glicko rating is falling (bearish momentum)
/// - Reversal: When z_score crosses threshold, signal is generated
///
/// PARAMETERS:
/// - moving_averages_period: Window size (number of periods for rolling calculation)
/// - threshold: Z-score boundary for signal generation (typically 1.5-2.5)
fn calculate_z_score_signals(
    ratings: &[GlickoRating],
    moving_averages_period: usize,
    threshold: f64,
) -> HashMap<String, Vec<(i64, f64, String)>> {
    let mut symbol_ratings: HashMap<String, Vec<(i64, f64)>> = HashMap::new();

    // Group ratings by symbol for independent signal calculation
    for rating in ratings {
        symbol_ratings
            .entry(rating.symbol.clone())
            .or_insert_with(Vec::new)
            .push((rating.timestamp, rating.rating));
    }

    let mut signals = HashMap::new();

    for (symbol, mut rating_history) in symbol_ratings {
        // Sort by timestamp to ensure chronological order
        rating_history.sort_by_key(|(timestamp, _)| *timestamp);
        let mut symbol_signals = Vec::new();

        // Calculate z-score for each period starting from moving_averages_period
        for window_end in moving_averages_period..rating_history.len() {
            let current_timestamp = rating_history[window_end].0;
            let current_rating = rating_history[window_end].1;

            // Extract the window of ratings for this period
            let window_ratings: Vec<f64> = rating_history
                [(window_end - moving_averages_period)..window_end]
                .iter()
                .map(|(_, rating)| *rating)
                .collect();

            // Calculate z-score using current rating against window
            let stats = MovingStats::calculate(&window_ratings, current_rating);

            // Generate signal based on z-score threshold
            let signal = if stats.z_score > threshold {
                "BUY"  // Strong upside deviation
            } else if stats.z_score < -threshold {
                "SELL" // Strong downside deviation
            } else {
                "HOLD" // Within neutral band
            };

            symbol_signals.push((current_timestamp, stats.z_score, signal.to_string()));
        }

        signals.insert(symbol, symbol_signals);
    }

    signals
}

fn calculate_performance_metrics(
    portfolio: &Portfolio,
    initial_value: f64,
    start_time: i64,
    end_time: i64,
) -> PerformanceMetrics {
    if portfolio.equity_curve.is_empty() {
        return PerformanceMetrics::default();
    }

    let final_value = portfolio.equity_curve.last().unwrap().1;
    let total_return = (final_value - initial_value) / initial_value;
    
    // Calculate annualized return
    let years = (end_time - start_time) as f64 / (365.25 * 24.0 * 60.0 * 60.0 * 1000.0);
    let annualized_return = if years > 0.0 {
        (final_value / initial_value).powf(1.0 / years) - 1.0
    } else {
        0.0
    };

    // Calculate returns for risk metrics
    let returns: Vec<f64> = portfolio.equity_curve
        .windows(2)
        .map(|w| {
            let prev_value = w[0].1;
            let curr_value = w[1].1;
            if prev_value > 0.0 {
                (curr_value - prev_value) / prev_value
            } else {
                0.0
            }
        })
        .collect();

    let mean_return = returns.iter().sum::<f64>() / returns.len() as f64;
    let variance = returns.iter()
        .map(|r| (r - mean_return).powi(2))
        .sum::<f64>() / returns.len() as f64;
    let volatility = variance.sqrt();

    // Sharpe Ratio (assuming 2% risk-free rate)
    let risk_free_rate = 0.02 / 365.25; // Daily risk-free rate
    let sharpe_ratio = if volatility > 0.0 {
        (mean_return - risk_free_rate) / volatility * (365.25_f64).sqrt()
    } else {
        0.0
    };

    // Sortino Ratio (downside deviation only)
    let negative_returns: Vec<f64> = returns.iter()
        .filter(|&&r| r < mean_return)
        .copied()
        .collect();
    
    let downside_variance = if !negative_returns.is_empty() {
        negative_returns.iter()
            .map(|r| (r - mean_return).powi(2))
            .sum::<f64>() / negative_returns.len() as f64
    } else {
        0.0
    };
    
    let downside_deviation = downside_variance.sqrt();
    let sortino_ratio = if downside_deviation > 0.0 {
        (mean_return - risk_free_rate) / downside_deviation * (365.25_f64).sqrt()
    } else {
        0.0
    };

    // Max Drawdown
    let mut peak = initial_value;
    let mut max_drawdown = 0.0;
    
    for (_, value) in &portfolio.equity_curve {
        if *value > peak {
            peak = *value;
        }
        let drawdown = (peak - value) / peak;
        if drawdown > max_drawdown {
            max_drawdown = drawdown;
        }
    }

    // Trade statistics
    let profitable_trades = portfolio.orders
        .iter()
        .filter(|o| o.side == "SELL")
        .filter(|o| o.profit_loss.unwrap_or(0.0) > 0.0)
        .count();
    
    let total_trades = portfolio.orders
        .iter()
        .filter(|o| o.side == "SELL")
        .count();
    
    let win_ratio = if total_trades > 0 {
        profitable_trades as f64 / total_trades as f64
    } else {
        0.0
    };

    // Profit Factor
    let gross_profit: f64 = portfolio.orders
        .iter()
        .filter(|o| o.side == "SELL")
        .filter_map(|o| o.profit_loss)
        .filter(|&pl| pl > 0.0)
        .sum();

    let gross_loss: f64 = portfolio.orders
        .iter()
        .filter(|o| o.side == "SELL")
        .filter_map(|o| o.profit_loss)
        .filter(|&pl| pl < 0.0)
        .map(|pl| pl.abs())
        .sum();

    let profit_factor = if gross_loss > 0.0 {
        gross_profit / gross_loss
    } else if gross_profit > 0.0 {
        f64::INFINITY
    } else {
        0.0
    };

    // Average trade duration
    let mut trade_durations = Vec::new();
    let mut open_positions: HashMap<String, i64> = HashMap::new();

    for order in &portfolio.orders {
        if order.side == "BUY" {
            open_positions.insert(order.symbol.clone(), order.timestamp);
        } else if order.side == "SELL" {
            if let Some(entry_time) = open_positions.remove(&order.symbol) {
                let duration = (order.timestamp - entry_time) as f64 / (1000.0 * 60.0 * 60.0); // hours
                trade_durations.push(duration);
            }
        }
    }

    let avg_trade_duration = if !trade_durations.is_empty() {
        trade_durations.iter().sum::<f64>() / trade_durations.len() as f64
    } else {
        0.0
    };

    PerformanceMetrics {
        total_return,
        annualized_return,
        sharpe_ratio,
        sortino_ratio,
        alpha: 0.0, // Would need benchmark comparison
        max_drawdown,
        win_ratio,
        total_trades,
        profit_factor,
        avg_trade_duration,
    }
}

#[derive(Debug, Default)]
struct PerformanceMetrics {
    total_return: f64,
    annualized_return: f64,
    sharpe_ratio: f64,
    sortino_ratio: f64,
    alpha: f64,
    max_drawdown: f64,
    win_ratio: f64,
    total_trades: usize,
    profit_factor: f64,
    avg_trade_duration: f64,
}

/// Run a complete backtest simulation with Z-score signals and OCO exit logic.
///
/// ALGORITHM FLOW:
/// 1. Calculate Z-score signals from Glicko-2 ratings
///    - Z-score = (current_rating - moving_avg) / std_dev
///    - BUY signal when z_score > threshold
///    - SELL signal when z_score < -threshold
///
/// 2. For each signal, execute entry/exit:
///    - BUY: Enter position with OCO levels set
///    - SELL: Exit via Z-score reversal (EXIT_ZSCORE)
///
/// 3. Check OCO exit levels each period (automatically close if triggered):
///    - Exit if price ≤ stop_loss_price (EXIT_STOP) - loss limiting
///    - Exit if price ≥ take_profit_price (EXIT_PROFIT) - profit taking
///
/// SLIPPAGE MODEL:
/// - Entry: Assumed at signal price (no slippage modeled for simplicity)
/// - Exit: Assumed at actual price level (SL/TP/Z-score)
/// - Note: In live trading, actual execution may differ due to:
///   - Order book depth
///   - Market impact
///   - Time to fill (prices may move while order processes)
///
/// POSITION SIZING:
/// - Each BUY signal allocates 95% of available cash
/// - Quantity = (cash * 0.95) / entry_price
/// - Risk per trade = stop_loss_percent of position
///
/// ORDER TYPES SIMULATED:
/// - BUY: Market order at signal price
/// - SELL via Z-score: Market order at signal price (EXIT_ZSCORE)
/// - SELL via OCO: Market order at stop/profit level (EXIT_STOP/EXIT_PROFIT)
pub fn run_backtest(config: BacktestConfig, ratings: Vec<GlickoRating>) -> Result<BacktestResult> {
    let initial_cash = 10000.0; // Starting with $10,000
    let mut portfolio = Portfolio::new(initial_cash);

    // Calculate z-score signals
    let signals = calculate_z_score_signals(
        &ratings,
        config.moving_averages,
        config.z_score_threshold,
    );

    // Get price data from ratings (simplified - would normally use klines)
    let mut price_data: HashMap<String, Vec<(i64, f64)>> = HashMap::new();
    let symbol = format!("{}USDT", config.base_asset);
    
    // Simulate price movements based on Glicko ratings
    // This is a simplified approach - in reality, you'd use actual price data
    for rating in &ratings {
        if rating.symbol == symbol {
            // Simulate price based on rating (this is just for demonstration)
            let simulated_price = 100.0 * (rating.rating / 1500.0);
            price_data
                .entry(symbol.clone())
                .or_insert_with(Vec::new)
                .push((rating.timestamp, simulated_price));
        }
    }

    // Sort price data by timestamp
    if let Some(prices) = price_data.get_mut(&symbol) {
        prices.sort_by_key(|(timestamp, _)| *timestamp);
    }

    // Run backtest simulation
    if let (Some(symbol_signals), Some(symbol_prices)) = 
        (signals.get(&symbol), price_data.get(&symbol)) {
        
        let mut signal_idx = 0;
        let mut price_idx = 0;

        while signal_idx < symbol_signals.len() && price_idx < symbol_prices.len() {
            let (signal_time, z_score, signal) = &symbol_signals[signal_idx];
            let (price_time, price) = symbol_prices[price_idx];

            // Align timestamps
            if signal_time < &price_time {
                signal_idx += 1;
                continue;
            } else if &price_time < signal_time {
                price_idx += 1;
                continue;
            }

            // === SIGNAL EXECUTION ===
            // Process entry/exit signals from Z-score reversals
            let current_prices = [(symbol.clone(), price)].iter().cloned().collect();

            match signal.as_str() {
                "BUY" => {
                    // Z-score BUY signal: enter new position with OCO levels
                    portfolio.open_position(
                        symbol.clone(),
                        price,
                        *signal_time,
                        &config,
                        0.95, // Use 95% of available cash
                    );
                }
                "SELL" => {
                    // Z-score SELL signal: exit current position
                    // Reason: "EXIT_ZSCORE" - Z-score reversal from positive to negative
                    portfolio.close_position(&symbol, price, *signal_time, "EXIT_ZSCORE");
                }
                _ => {} // HOLD - no action
            }

            // === OCO EXIT LEVEL CHECKING ===
            // This is the One-Cancels-Other logic: automatically check if price hit either exit level
            // Both levels are checked simultaneously; whichever is hit first closes the position
            let positions_to_close: Vec<String> = portfolio.positions
                .iter()
                .filter_map(|(sym, pos)| {
                    // OCO Check: price <= SL triggers stop-loss exit
                    if price <= pos.stop_loss_price {
                        Some((sym.clone(), "EXIT_STOP"))
                    }
                    // OCO Check: price >= TP triggers take-profit exit
                    else if price >= pos.take_profit_price {
                        Some((sym.clone(), "EXIT_PROFIT"))
                    } else {
                        None
                    }
                })
                .map(|(sym, reason)| sym)
                .collect();

            // Close positions that hit their OCO levels
            // Each position can only close once; after closing, the other level is automatically cancelled
            for pos_symbol in positions_to_close {
                if price <= portfolio.positions[&pos_symbol].stop_loss_price {
                    portfolio.close_position(&pos_symbol, price, *signal_time, "EXIT_STOP");
                } else {
                    portfolio.close_position(&pos_symbol, price, *signal_time, "EXIT_PROFIT");
                }
            }

            // Update equity curve
            portfolio.update_equity_curve(*signal_time, &current_prices);

            signal_idx += 1;
            price_idx += 1;
        }
    }

    // Calculate performance metrics
    let metrics = calculate_performance_metrics(
        &portfolio,
        initial_cash,
        config.start_time,
        config.end_time,
    );

    Ok(BacktestResult {
        total_return: metrics.total_return,
        annualized_return: metrics.annualized_return,
        sharpe_ratio: metrics.sharpe_ratio,
        sortino_ratio: metrics.sortino_ratio,
        alpha: metrics.alpha,
        max_drawdown: metrics.max_drawdown,
        win_ratio: metrics.win_ratio,
        total_trades: metrics.total_trades,
        profit_factor: metrics.profit_factor,
        avg_trade_duration: metrics.avg_trade_duration,
        orders: portfolio.orders,
    })
}

pub fn run_windowed_backtest(
    config: BacktestConfig,
    ratings: Vec<GlickoRating>,
) -> Result<Vec<BacktestResult>> {
    let window_size_ms = config.window_size.unwrap_or(12) as i64 * 30 * 24 * 60 * 60 * 1000; // months to ms
    let step_size_ms = window_size_ms / 2; // 50% overlap

    let mut results = Vec::new();
    let mut current_start = config.start_time;

    while current_start + window_size_ms <= config.end_time {
        let current_end = current_start + window_size_ms;
        
        // Filter ratings for current window
        let window_ratings: Vec<GlickoRating> = ratings
            .iter()
            .filter(|r| r.timestamp >= current_start && r.timestamp <= current_end)
            .cloned()
            .collect();

        if !window_ratings.is_empty() {
            let window_config = BacktestConfig {
                start_time: current_start,
                end_time: current_end,
                ..config.clone()
            };

            let result = run_backtest(window_config, window_ratings)?;
            results.push(result);
        }

        current_start += step_size_ms;
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_portfolio_creation() {
        let portfolio = Portfolio::new(10000.0);
        assert_eq!(portfolio.cash, 10000.0);
        assert!(portfolio.positions.is_empty());
        assert_eq!(portfolio.equity_curve.len(), 1);
    }

    #[test]
    fn test_position_opening() {
        let mut portfolio = Portfolio::new(10000.0);
        let config = BacktestConfig {
            base_asset: "BTC".to_string(),
            quote_asset: "USDT".to_string(),
            z_score_threshold: 2.0,
            moving_averages: 200,
            profit_percent: 5.0,
            stop_loss_percent: 2.5,
            start_time: 0,
            end_time: 1000000,
            window_size: Some(12),
        };

        let order = portfolio.open_position(
            "BTCUSDT".to_string(),
            50000.0,
            1640995200000,
            &config,
            0.5,
        );

        assert!(order.is_some());
        assert_eq!(portfolio.positions.len(), 1);
        assert!(portfolio.cash < 10000.0); // Cash should decrease
    }

    #[test]
    fn test_z_score_calculation() {
        let ratings = vec![
            GlickoRating {
                symbol: "BTCUSDT".to_string(),
                timestamp: 1000,
                rating: 1500.0,
                rating_deviation: 200.0,
                volatility: 0.06,
                performance_score: 0.5,
            },
            GlickoRating {
                symbol: "BTCUSDT".to_string(),
                timestamp: 2000,
                rating: 1600.0,
                rating_deviation: 190.0,
                volatility: 0.06,
                performance_score: 0.75,
            },
        ];

        let signals = calculate_z_score_signals(&ratings, 1, 1.0);
        assert!(signals.contains_key("BTCUSDT"));
    }
}