# ⚡ Quick Start Guide - Glicko-2 Trading Bot

This is a condensed guide for quickly running the complete Glicko-2 trading system.

## 🚀 Quick Setup (First Time)

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your Binance API credentials and BASE_COINS

# 3. Start database
npm run docker:up

# 4. Generate Prisma client
npm run prisma:generate
```

## ⚡ Complete System Workflow

### Option A: Full 4-Year Production System
```bash
# 1. Generate trading pairs
npm run getTradingPairs

# 2. Download 4 years of data (takes 4-6 hours)
npm run getKlines "$(cat analysis/trading-pairs.txt | grep -v '^#' | tr '\n' ',')" "2021-08-01" "2025-08-01"

# 3. Calculate Glicko-2 ratings (takes 2-3 hours) - All coins included!
BASE_COINS="BTC,ETH,ADA,AVAX,BNB,DOGE,LINK,POL,SOL,TRX,XLM,XRP,USDT" npm run calculateGlickoRatings

# 4. Generate analysis chart
npm run plotGlickoRatings

# 5. Run live trading (paper mode first!)
npm run startPaperTrading

# 6. Run backtesting analysis
npm run runAllWindowedBacktests "2022-01-01" 12 ETH USDT 3.0 200 5.0 2.5
```

### Option B: Quick Test (Development)
```bash
# 1. Generate trading pairs
npm run getTradingPairs

# 2. Download 3 months of data (takes 10 minutes)
npm run getKlines "BTCUSDT,ETHUSDT,ADAUSDT" "2024-01-01" "2024-03-31"

# 3. Calculate ratings (takes 2 minutes)
npm run calculateGlickoRatings "BTC,ETH,ADA"

# 4. Generate chart
npm run plotGlickoRatings

# 5. Test paper trading
npm run startPaperTrading --symbols="BTC,ETH,ADA"

# 6. Test backtesting
npm run runWindowedBacktest "2024-01-01" 3 ETH USDT 2.5 50 5.0 2.5
```

## 📊 View Results

```bash
# View database in browser
npm run prisma:studio

# Check generated files
ls analysis/

# Open chart in browser
open analysis/glicko-ratings-*.html
```

## 🔧 Daily Operations

```bash
# Update ratings with latest data (auto date range)
BASE_COINS="BTC,ETH,ADA,AVAX,BNB,DOGE,LINK,POL,SOL,TRX,XLM,XRP,USDT" npm run calculateGlickoRatings

# Regenerate analysis charts
npm run plotGlickoRatings

# Start live trading (with valid API keys)
npm run startTrading

# Run paper trading for testing
npm run startPaperTrading

# Execute backtests
npm run runWindowedBacktest "2024-01-01" 6 BTC USDT 3.0 200 5.0 2.5

# Check system health
npm test
npm run lint
npm run typecheck
```

## 🆘 Emergency Fixes

```bash
# Database issues
npm run docker:down && npm run docker:up
npm run prisma:generate

# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Reset everything
npm run docker:down
docker volume prune -f
npm run docker:up
npm run prisma:generate
```

## 📈 Key Files to Check

- `analysis/trading-pairs.txt` - Generated trading pairs
- `analysis/glicko-ratings-*.html` - Interactive rating charts  
- `analysis/backtest-*.html` - Individual backtest reports
- `analysis/walk-forward-*.html` - Walk-forward analysis reports
- `.env` - Configuration (Binance API keys, BASE_COINS)
- Database via `npm run prisma:studio`

## ⏱️ Typical Execution Times

| Task | Quick Test | Full Production |
|------|------------|-----------------|
| **Data Download** | 10 minutes (3 months) | 6 hours (4 years) |
| **Glicko Calculations** | 2 minutes | 2-3 hours |
| **Chart Generation** | 30 seconds | 2 minutes |
| **Paper Trading** | Instant start | Instant start |
| **Single Backtest** | 30 seconds | 2 minutes |
| **Walk-Forward Analysis** | 5 minutes | 30-60 minutes |

## 🎯 Trading System Status

All components are **✅ FULLY OPERATIONAL**:

- ✅ **Glicko-2 Rating System** - 15,020+ ratings calculated
- ✅ **Live Trading Engine** - Real-time signal generation  
- ✅ **Paper Trading Mode** - Safe testing environment
- ✅ **Windowed Backtesting** - BACKTEST_SPEC.html compliant
- ✅ **Walk-Forward Analysis** - Robust strategy validation
- ✅ **Interactive Charts** - Professional visualizations
- ✅ **Risk Management** - Stop-loss, take-profit, position limits

---

*For detailed instructions, see `STAGE_EXECUTION_GUIDE.md`*