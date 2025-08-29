# Trading Parameter Sets Guide

This guide explains how to use the enhanced live trading bot with custom parameter sets for different trading pairs.

## Overview

The trading bot now supports symbol-specific parameters that can be loaded from:
- JSON files
- Database (optimized parameters from backtests)
- Manual parameter arrays

Each trading pair can have its own:
- Z-score threshold
- Moving average period
- Profit target percentage
- Stop-loss percentage  
- Position allocation percentage

## Key Features

### 1. **Z-Score Reversal Detection**
- Monitors active positions for Z-score reversals
- When Z-score crosses negative threshold, cancels OCO orders and executes market sell
- Matches exact backtest behavior for entry/exit signals

### 2. **Symbol-Specific Parameters**
- Each symbol can have unique trading parameters
- Fallback to global configuration if symbol not specified
- Parameters loaded at startup and cached in memory

### 3. **Multiple Loading Sources**
- **File**: Load from JSON files for custom parameter sets
- **Database**: Load top-performing parameters from optimization results
- **Manual**: Pass parameter arrays directly in code

## Usage Examples

### 1. Paper Trading with Parameter Sets from File

```bash
# Using custom parameter file
npm run startPaperTrading -- --parameterSets=./example-parameter-sets.json

# Same command with explicit paper flag
npm run startTrading -- --paper --parameterSets=./my-custom-params.json
```

### 2. Live Trading with Optimized Parameters from Database

```bash
# Use top Sharpe ratio performers from database
npm run startTrading -- --useOptimizedParams --metric=sharpeRatio

# Use top Calmar ratio performers
npm run startTrading -- --useOptimizedParams --metric=calmarRatio

# Use top total return performers
npm run startTrading -- --useOptimizedParams --metric=totalReturn
```

### 3. Combined Usage

```bash
# Paper trading with database optimization
npm run startPaperTrading -- --useOptimizedParams --metric=sharpeRatio
```

## Parameter Set File Format

### JSON Structure
```json
{
  "description": "Custom trading parameters",
  "exportedAt": "2024-01-01T00:00:00.000Z",
  "parameterSets": [
    {
      "symbol": "BTCUSDT",
      "baseAsset": "BTC", 
      "quoteAsset": "USDT",
      "zScoreThreshold": 3.0,
      "movingAverages": 200,
      "profitPercent": 5.0,
      "stopLossPercent": 2.5,
      "allocationPercent": 15.0,
      "enabled": true
    }
  ]
}
```

### Parameter Descriptions

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | string | Trading pair (e.g., "BTCUSDT") |
| `baseAsset` | string | Base cryptocurrency (e.g., "BTC") |
| `quoteAsset` | string | Quote currency (e.g., "USDT") |
| `zScoreThreshold` | number | Entry signal threshold (e.g., 3.0) |
| `movingAverages` | number | Moving average period (e.g., 200) |
| `profitPercent` | number | Take profit percentage (e.g., 5.0) |
| `stopLossPercent` | number | Stop loss percentage (e.g., 2.5) |
| `allocationPercent` | number | Portfolio allocation % (e.g., 10.0) |
| `enabled` | boolean | Whether to trade this symbol |

## Signal Logic

### Entry Signals
- **Condition**: Z-score >= threshold
- **Action**: Place market buy order
- **Follow-up**: Set OCO order (take-profit + stop-loss)

### Exit Signals

#### OCO Order Execution (Profit/Loss)
- **Take Profit**: Limit order at entry * (1 + profitPercent/100)
- **Stop Loss**: Stop-limit order at entry * (1 - stopLossPercent/100)

#### Z-Score Reversal Exit  
- **Condition**: Z-score <= -threshold (reversal)
- **Action**: Cancel OCO orders → Execute market sell
- **Timing**: Checked every 30 seconds

## Database Integration

The bot can query optimization results to automatically load the best-performing parameters:

### Supported Metrics
- `sharpeRatio`: Risk-adjusted return
- `calmarRatio`: Return/max drawdown ratio  
- `totalReturn`: Absolute return percentage
- `alpha`: Excess return vs benchmark

### Query Filters
- Minimum trades: 5 (configurable)
- Asset filters: Base assets, quote assets
- Result limit: 50 (configurable)

## Monitoring and Debugging

### Real-time Information
The trading engine provides real-time access to:
- Current Z-scores for all symbols
- Active positions with entry details
- Parameter sets in use
- OCO order status

### Event Emissions
The engine emits events for:
- `zScoreReversal`: When reversal exit occurs
- `paperTrade`: Paper trading actions
- `signalsChecked`: Signal monitoring updates
- `parameterSetsLoaded`: Parameter loading completion

### Console Logging
- Parameter set loading confirmation
- Z-score reversal detection
- OCO order placement/cancellation  
- Position entry/exit details

## Risk Management

### Position Tracking
- Each position tracked with entry price, quantity, and parameters
- OCO order IDs stored for cancellation
- Z-score threshold monitoring per position

### Safety Features
- Symbol-specific cooldowns after failed trades
- Daily loss limits (global)
- Maximum drawdown protection (global)
- Position count limits (global)

## Best Practices

### 1. **Parameter Selection**
- Use backtest-optimized parameters from database
- Test with paper trading before live deployment
- Review performance metrics of selected parameters

### 2. **File Management**
- Keep parameter files version controlled
- Use descriptive filenames with dates
- Backup successful parameter configurations

### 3. **Monitoring**
- Monitor Z-score reversal frequency
- Track OCO vs reversal exit ratios
- Review symbol-specific performance

### 4. **Risk Control**
- Set appropriate allocation percentages
- Use conservative Z-score thresholds initially
- Monitor correlation between trading pairs

## Troubleshooting

### Common Issues

#### "No symbols specified" Error
- Ensure parameter file exists and is valid JSON
- Check that at least one parameter set has `enabled: true`
- Verify file path is correct

#### "No recent Glicko ratings" Warning
- Run `npm run calculateGlickoRatings` to update ratings
- Check database connectivity
- Ensure BASE_COINS symbols match available data

#### Parameter Loading Failures
- Validate JSON syntax in parameter files
- Check database connectivity for optimized parameter queries
- Verify all required parameter fields are present

### Log Analysis
- Parameter loading: Check startup logs for confirmation
- Signal generation: Monitor 30-second signal check intervals  
- Position management: Track OCO order placement/cancellation
- Reversal detection: Watch for Z-score crossing events

## Integration with Existing System

### Backward Compatibility
- Old environment variable configuration still works
- Global parameters used as fallback for symbols without specific parameters
- All existing npm scripts continue to function

### API Extensions
The trading engine now provides additional methods:
- `setParameterSets(parameterSets)`: Load parameter sets programmatically
- `getParameterSets()`: Get current parameter configurations
- `getCurrentZScores()`: Get real-time Z-score values

This enhanced system provides precise control over trading behavior while maintaining the reliability and risk management of the original implementation.