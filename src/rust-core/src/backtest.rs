use crate::{BacktestConfig, BacktestResult, BacktestOrder, GlickoRating, Result};
use crate::data::MovingStats;
use rayon::prelude::*;
use std::collections::HashMap;

#[derive(Debug, Clone)]
struct Position {
    symbol: String,
    quantity: f64,
    entry_price: f64,
    entry_time: i64,
    stop_loss_price: f64,
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

fn calculate_z_score_signals(
    ratings: &[GlickoRating],
    moving_averages_period: usize,
    threshold: f64,
) -> HashMap<String, Vec<(i64, f64, String)>> {
    let mut symbol_ratings: HashMap<String, Vec<(i64, f64)>> = HashMap::new();
    
    // Group ratings by symbol
    for rating in ratings {
        symbol_ratings
            .entry(rating.symbol.clone())
            .or_insert_with(Vec::new)
            .push((rating.timestamp, rating.rating));
    }

    let mut signals = HashMap::new();

    for (symbol, mut rating_history) in symbol_ratings {
        rating_history.sort_by_key(|(timestamp, _)| *timestamp);
        let mut symbol_signals = Vec::new();

        for window_end in moving_averages_period..rating_history.len() {
            let current_timestamp = rating_history[window_end].0;
            let current_rating = rating_history[window_end].1;
            
            let window_ratings: Vec<f64> = rating_history
                [(window_end - moving_averages_period)..window_end]
                .iter()
                .map(|(_, rating)| *rating)
                .collect();

            let stats = MovingStats::calculate(&window_ratings, current_rating);
            
            let signal = if stats.z_score > threshold {
                "BUY"
            } else if stats.z_score < -threshold {
                "SELL"
            } else {
                "HOLD"
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

            // Process signal at current price
            let current_prices = [(symbol.clone(), price)].iter().cloned().collect();
            
            match signal.as_str() {
                "BUY" => {
                    portfolio.open_position(
                        symbol.clone(),
                        price,
                        *signal_time,
                        &config,
                        0.95, // Use 95% of available cash
                    );
                }
                "SELL" => {
                    portfolio.close_position(&symbol, price, *signal_time, "EXIT_ZSCORE");
                }
                _ => {} // HOLD
            }

            // Check stop-loss and take-profit for existing positions
            let positions_to_close: Vec<String> = portfolio.positions
                .iter()
                .filter_map(|(sym, pos)| {
                    if price <= pos.stop_loss_price {
                        Some((sym.clone(), "EXIT_STOP"))
                    } else if price >= pos.take_profit_price {
                        Some((sym.clone(), "EXIT_PROFIT"))
                    } else {
                        None
                    }
                })
                .map(|(sym, reason)| sym)
                .collect();

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