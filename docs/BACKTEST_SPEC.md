# Backtest Engine Specification

## Overview

The backtest engine simulates trading strategies using Glicko-2 ratings and Z-score signals with OCO (One-Cancels-Other) exit management. This document details the algorithm, execution model, and assumptions.

## Algorithm Architecture

### 1. Signal Generation: Z-Score Based Trading

#### Z-Score Calculation
For each time period using a rolling window of N periods:

```
mean = average(ratings[window_start..window_end])
std_dev = sqrt(variance(ratings[window_start..window_end]))
z_score = (current_rating - mean) / std_dev
```

#### Signal Generation (Z-Score Reversals)
- **BUY Signal**: `z_score > +threshold`
  - Current Glicko rating significantly above the moving average
  - Indicates bullish momentum
  - Threshold typically 1.5-2.5 standard deviations

- **SELL Signal**: `z_score < -threshold`
  - Current Glicko rating significantly below the moving average
  - Indicates bearish momentum reversal
  - Signals position exit opportunity

- **HOLD**: `-threshold ≤ z_score ≤ +threshold`
  - Rating within neutral range
  - No action taken

#### Parameters
- `moving_averages_period`: Window size for rolling statistics (typically 10-20 periods)
- `z_score_threshold`: Boundary for signal generation (typically 1.5-2.5)

---

## 2. Position Management: OCO Exit Logic

### Entry (BUY Signal)
When a BUY signal is generated:

1. **Entry Execution**
   - Entry at signal price (no slippage modeled)
   - Quantity = (cash × 0.95) / entry_price
   - Reserve 5% of cash for diversification/buffer

2. **OCO Level Calculation**
   ```
   take_profit_price = entry_price × (1 + profit_percent / 100)
   stop_loss_price = entry_price × (1 - stop_loss_percent / 100)
   ```

3. **Example** (2% profit, 2.5% stop loss, entry at $100)
   ```
   Entry Price:         $100.00
   Take Profit (TP):    $102.00 (+2%)
   Stop Loss (SL):      $97.50 (-2.5%)
   ```

### Exit Mechanisms

#### Exit Method 1: Z-Score Reversal (EXIT_ZSCORE)
- **Trigger**: Z-score SELL signal generated while holding position
- **Exit Price**: Signal price (current market)
- **Priority**: Executed before OCO level checking
- **Reason**: Fundamental momentum reversal detected

#### Exit Method 2: Take Profit (EXIT_PROFIT)
- **Trigger**: `current_price ≥ take_profit_price`
- **Exit Price**: Take profit level or better
- **Probability**: ~50% of trades hit TP first (depends on volatility)
- **P&L**: Positive, typically +profit_percent

#### Exit Method 3: Stop Loss (EXIT_STOP)
- **Trigger**: `current_price ≤ stop_loss_price`
- **Exit Price**: Stop loss level or worse
- **Probability**: ~30% of trades hit SL first (depends on volatility)
- **P&L**: Negative, typically -stop_loss_percent

### OCO Mechanism

The "One-Cancels-Other" means:
1. Both TP and SL levels are active simultaneously
2. Whichever level is hit **first** closes the position
3. The other level is automatically **cancelled** (position no longer exists)
4. No partial fills or "whipsaw" situations

```
while (position is open):
    if price <= stop_loss_price:
        CLOSE position as EXIT_STOP
    else if price >= take_profit_price:
        CLOSE position as EXIT_PROFIT
    else if z_score_sell_signal:
        CLOSE position as EXIT_ZSCORE
```

---

## 3. Execution Model

### Portfolio Mechanics

**Initial Capital**: $10,000

**Position Sizing**
- Each BUY allocates 95% of available cash
- After first trade: cash_remaining = initial_cash - (quantity × entry_price)
- After exit: cash restored plus/minus profit/loss

**Example Trade Sequence**
```
Start: cash=$10,000, positions={}

Signal 1: BUY at $100
- Quantity = (10,000 × 0.95) / 100 = 95 units
- Cash remaining = 10,000 - 9,500 = $500
- TP set to $102, SL set to $97.50

Signal 2 (later): Price = $102
- OCO triggers: price ≥ TP
- Exit position at $102: proceeds = 95 × $102 = $9,690
- P&L = $9,690 - $9,500 = +$190 (+2%)
- Cash = $500 + $9,690 = $10,190
```

### Timestamp Alignment

Signals and prices are synchronized by timestamp:
1. Both Z-score signals and price data are time-indexed
2. Only when timestamps match is a signal executed
3. If signal_time ≠ price_time, advance pointer

---

## 4. Slippage Assumptions

### No Slippage Model

The backtest **does not model slippage** for simplicity:

#### Entry Execution
- **Assumption**: Filled at signal price (no spread)
- **Reality**: In live trading, actual entry may be worse
- **Impact**: Backtest results optimistic by ~0.05-0.2%

#### Exit Execution
- **OCO Fills**: Assumed at exact TP/SL level
- **Z-Score Exits**: Assumed at signal price
- **Reality**: Depending on order book depth:
  - SL orders may execute at worse price
  - TP orders may miss by milliseconds
- **Impact**: Losses may be deeper, gains may be capped

### Slippage Factors Not Modeled
- Order book depth
- Market impact (large orders move price)
- Latency (time to fill orders)
- Volatility expansion (market gapping past SL)
- Exchange limitations (min order size, fees)

---

## 5. Consistency with Live Trading

### Algorithm Parity
✅ **Match**: Both use continuous scaling Glicko-2 algorithm
- Glicko ratings calculated identically
- Z-score signals generated the same way
- Exit conditions trigger at same levels

### Exit Logic Parity
✅ **Match**: Both implement three exit mechanisms
- Z-score reversals (EXIT_ZSCORE)
- Take profit levels (EXIT_PROFIT)
- Stop loss protection (EXIT_STOP)

### Assumptions & Limitations
⚠️ **Divergence**: Slippage assumptions differ significantly
- Backtest: Perfect fills at target prices
- Live: Realistic slippage and latency

⚠️ **Divergence**: Price data sources
- Backtest: Uses Glicko-derived simulated prices
- Live: Uses actual Binance kline closes

### Validation Strategy
To validate backtest vs live performance:
1. Run 30-day backtest with identical parameters
2. Compare to 30-day live trading results
3. Analyze divergence in:
   - Number of trades
   - Win/loss ratio
   - Average trade duration
   - Drawdown profile

---

## 6. Configuration Parameters

### BacktestConfig Structure
```rust
struct BacktestConfig {
    base_asset: String,              // e.g., "BTC"
    profit_percent: f64,              // TP level (typically 2.0)
    stop_loss_percent: f64,           // SL level (typically 2.5)
    moving_averages: usize,           // Window size (typically 10-20)
    z_score_threshold: f64,           // Signal boundary (typically 1.5-2.5)
    start_time: i64,                  // ms timestamp
    end_time: i64,                    // ms timestamp
}
```

### Recommended Ranges
- `profit_percent`: 1.0 - 5.0 (risk/reward ratio 1:1 to 1:2)
- `stop_loss_percent`: 1.5 - 5.0 (must be > profit_percent)
- `moving_averages`: 10 - 30 periods
- `z_score_threshold`: 1.5 - 2.5 standard deviations

---

## 7. Output Metrics

### Performance Metrics Calculated
- **Total Return**: (final_value - initial) / initial
- **Annualized Return**: (final / initial)^(1/years) - 1
- **Sharpe Ratio**: excess_return / volatility
- **Sortino Ratio**: excess_return / downside_volatility
- **Max Drawdown**: largest peak-to-trough decline
- **Win Ratio**: winning_trades / total_trades
- **Profit Factor**: gross_profit / gross_loss
- **Avg Trade Duration**: average hours per trade

### Order Log
Each trade recorded with:
- Symbol
- Side (BUY/SELL)
- Quantity
- Execution Price
- Timestamp
- Exit Reason (ENTRY, EXIT_ZSCORE, EXIT_STOP, EXIT_PROFIT)
- P&L (for exits)

---

## 8. Testing & Validation

### Unit Tests Included
- Z-score signal calculation
- Position entry and exit logic
- OCO level triggering
- Portfolio equity curve updates
- Performance metrics calculation

### Integration Tests
- Full backtest simulation on sample data
- Verify trades generated at expected signals
- Validate P&L calculations

---

## 9. Known Limitations

1. **Simplified Price Data**: Uses Glicko-derived simulated prices, not actual OHLCV klines
2. **No Slippage**: Assumes perfect execution
3. **No Fees**: Does not deduct exchange/broker fees
4. **Single Asset**: Backtests one symbol at a time
5. **No Leverage**: Trades are unleveraged
6. **Perfect Fill**: Assumes all orders execute immediately
7. **No Liquidity Constraints**: Ignores order book depth

---

## 10. Future Improvements

- [ ] Integrate actual kline price data instead of simulated prices
- [ ] Model realistic slippage based on volatility
- [ ] Include trading fees
- [ ] Multi-asset portfolio optimization
- [ ] Leverage capability with margin requirements
- [ ] Monte Carlo simulation for robustness testing
- [ ] Walk-forward validation with expanding windows
- [ ] Parameter sensitivity analysis

---

## References

- **Glicko-2 Algorithm**: See GLICKO_SPEC.md
- **Z-Score Statistics**: Used from data.rs `MovingStats::calculate()`
- **Live Engine**: Equivalent logic in src/node-api/services/TradingEngine.ts
