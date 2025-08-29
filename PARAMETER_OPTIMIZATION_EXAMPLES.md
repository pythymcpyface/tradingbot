# Parameter Optimization Examples

This document provides examples of how to use the enhanced `runAllWindowedBacktestsForPair.ts` script with configurable parameter ranges.

## Overview

The script supports two methods for parameter configuration:
1. **Default .env Configuration**: Uses values from `ZSCORE_THRESHOLDS`, `PROFIT_PERCENTS`, `STOP_LOSS_PERCENTS`, and `DEFAULT_MOVING_AVERAGE`
2. **Command-line Overrides**: Custom parameter ranges specified via command-line flags

## Current .env Defaults

```env
ZSCORE_THRESHOLDS=1.5,2.0,2.5,3.0,3.5,4.0
PROFIT_PERCENTS=3.0,4.0,5.0,6.0,7.0,8.0
STOP_LOSS_PERCENTS=1.5,2.0,2.5,3.0,3.5,4.0
DEFAULT_MOVING_AVERAGE=10
```

This creates: **6 × 6 × 6 = 216 parameter combinations** by default.

## Usage Examples

### 1. Use Complete .env Defaults
```bash
# Test all 216 combinations with .env defaults
npm run runAllWindowedBacktestsForPair ETH USDT

# With custom window size and start date
npm run runAllWindowedBacktestsForPair BTC USDT 12 "2021-08-01"
```

### 2. Quick Testing with Smaller Parameter Sets
```bash
# Test only 3×3×3 = 27 combinations (much faster)
npm run runAllWindowedBacktestsForPair ETH USDT --zscores=2.0,2.5,3.0 --profits=4.0,5.0,6.0 --stops=2.0,2.5,3.0

# Test different moving average with limited ranges
npm run runAllWindowedBacktestsForPair BTC USDT --ma=20 --zscores=1.5,2.0,2.5 --profits=3.0,5.0,7.0 --stops=1.5,2.5,3.5
```

### 3. Focus on Specific Ranges
```bash
# High Z-scores only (conservative entries)
npm run runAllWindowedBacktestsForPair ETH USDT --zscores=3.0,3.5,4.0

# Wide profit targets with tight stops
npm run runAllWindowedBacktestsForPair SOL USDT --profits=6.0,7.0,8.0,9.0,10.0 --stops=1.0,1.5,2.0

# Single parameter testing (1×6×1 = 6 combinations)
npm run runAllWindowedBacktestsForPair ADA USDT --zscores=2.5 --stops=2.0
```

### 4. Mixed Configuration
```bash
# Override some parameters, use .env for others
# This uses custom Z-scores but default profits and stops from .env
npm run runAllWindowedBacktestsForPair ETH USDT --zscores=1.8,2.2,2.8 --ma=15

# Custom profits and stops, default Z-scores
npm run runAllWindowedBacktestsForPair BTC USDT --profits=4.5,5.5,6.5 --stops=2.2,2.8,3.2
```

### 5. Production-Ready Comprehensive Testing
```bash
# Full parameter sweep for production optimization
npm run runAllWindowedBacktestsForPair ETH USDT 6 "2020-01-01"

# Multi-asset optimization (run separately for each)
npm run runAllWindowedBacktestsForPair BTC USDT 6 "2020-01-01" --zscores=2.0,2.5,3.0,3.5 --ma=15
npm run runAllWindowedBacktestsForPair ETH USDT 6 "2020-01-01" --zscores=2.0,2.5,3.0,3.5 --ma=15
npm run runAllWindowedBacktestsForPair SOL USDT 6 "2020-01-01" --zscores=2.0,2.5,3.0,3.5 --ma=15
```

## Performance Considerations

### Execution Time Estimates

| Parameter Combinations | Estimated Time | Use Case |
|----------------------|----------------|----------|
| 27 (3×3×3) | 1-2 hours | Quick testing |
| 64 (4×4×4) | 3-4 hours | Moderate testing |
| 125 (5×5×5) | 6-8 hours | Comprehensive testing |
| 216 (6×6×6) | 10-14 hours | Full optimization |

### Optimization Tips

1. **Start Small**: Use 3×3×3 combinations for initial testing
2. **Focus Ranges**: Narrow down based on initial results
3. **Use Shorter Windows**: Test with 3-6 month windows first
4. **Parallel Execution**: Run different assets simultaneously on different machines
5. **Resource Management**: Monitor system resources during long runs

## Output Analysis

Each run generates:
- **3D Interactive HTML Report**: `analysis/parameter-optimization-3d-{SYMBOL}-{timestamp}.html`
- **Database Records**: All results stored in `optimization_results` table
- **Plateau Analysis**: Identification of robust vs overfit parameter combinations
- **Strategy Recommendations**: Best performers across different metrics

## Parameter Selection Guidelines

### Z-Score Thresholds
- **1.5-2.0**: More frequent but potentially noisier signals
- **2.5-3.0**: Balanced approach (recommended starting point)
- **3.5-4.0**: Conservative, high-confidence signals

### Profit Percents
- **3.0-4.0%**: Quick scalping profits
- **5.0-6.0%**: Moderate swing targets
- **7.0-8.0%**: Larger move captures

### Stop Loss Percents
- **1.5-2.0%**: Tight risk control
- **2.5-3.0%**: Balanced risk/reward
- **3.5-4.0%**: Allowing for more volatility

## Troubleshooting

### Common Issues

1. **Long Execution Times**: Reduce parameter combinations for testing
2. **Database Errors**: Ensure PostgreSQL is running and accessible
3. **Memory Issues**: Increase Node.js heap size: `export NODE_OPTIONS="--max-old-space-size=8192"`
4. **API Limits**: The script includes rate limiting, but may need longer delays for large datasets

### Monitoring Progress

The script provides detailed console output including:
- Current parameter combination being tested
- Progress percentage
- Individual backtest results
- Summary statistics upon completion

## Best Practices

1. **Document Your Tests**: Keep track of which parameter ranges work best for each asset
2. **Version Control**: Commit successful parameter configurations to .env
3. **Validation**: Always validate optimized parameters on out-of-sample data
4. **Regular Re-optimization**: Market conditions change, re-run optimization periodically
5. **Risk Management**: Consider plateau recommendations over peak performers for robustness