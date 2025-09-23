# Trading Engine Only - Heroku Deployment ($5/month)

## Overview
Deploy **only the trading engine** to Heroku as a background worker process. The web interface runs locally while the trading bot runs 24/7 on Heroku.

## Ultra-Low Cost Setup

### **Total Cost: $5/month** 🎯
- **PostgreSQL Essential-0**: $5/month (1M rows, 20 connections)
- **Worker Dyno**: $0/month (1000 free dyno hours = ~720 hours/month = 24/7 coverage)
- **No web dyno needed**: Trading engine runs as background worker
- **No Redis needed**: Uses NodeCache in-memory

## Quick Deployment Commands

### 1. Create Heroku App
```bash
heroku create your-trading-bot-name
heroku stack:set container -a your-trading-bot-name
```

### 2. Add Database Only
```bash
heroku addons:create heroku-postgresql:essential-0 -a your-trading-bot-name
```

### 3. Configure Environment Variables
```bash
heroku config:set NODE_ENV=production -a your-trading-bot-name
heroku config:set BINANCE_API_KEY=your_api_key -a your-trading-bot-name
heroku config:set BINANCE_SECRET_KEY=your_secret_key -a your-trading-bot-name
heroku config:set TRADING_MODE=LIVE -a your-trading-bot-name
```

### 4. Deploy Trading Engine
```bash
heroku container:push worker -a your-trading-bot-name
heroku container:release worker -a your-trading-bot-name
```

### 5. Initialize Database
```bash
heroku run npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss -a your-trading-bot-name
```

### 6. Start Trading Engine
```bash
heroku ps:scale worker=1 -a your-trading-bot-name
```

## Configuration Details

### Files Modified for Trading-Only Deployment:
- **`Dockerfile.trading`**: Minimal container with only trading dependencies
- **`heroku.yml`**: Changed from `web` to `worker` dyno type
- **Uses production schema**: Only essential tables (no backtest data)

### What Gets Deployed:
```
✅ Trading engine (scripts/startLiveTrading.ts)
✅ Database services
✅ Binance API integration
✅ Position management
✅ Risk management
✅ Logging and monitoring
❌ Web interface (run locally)
❌ React frontend
❌ API endpoints
```

### Trading Engine Features:
- **Live/Paper Trading**: Configurable via `TRADING_MODE`
- **Multi-pair Support**: BTCUSDT, ETHUSDT, BNBUSDT
- **Risk Management**: Stop losses, position sizing
- **Real-time Monitoring**: Logs via `heroku logs --tail`
- **Automatic Restart**: Heroku restarts on crashes

## Monitoring Your Trading Bot

### View Logs
```bash
heroku logs --tail -a your-trading-bot-name
```

### Check Status
```bash
heroku ps -a your-trading-bot-name
```

### Restart Trading Engine
```bash
heroku restart worker -a your-trading-bot-name
```

### Scale Workers
```bash
heroku ps:scale worker=1 -a your-trading-bot-name  # Start
heroku ps:scale worker=0 -a your-trading-bot-name  # Stop
```

## Local Web Interface Setup

While the trading engine runs on Heroku, run the web interface locally to monitor and manage:

```bash
# Terminal 1: Start web interface
npm run dev

# Terminal 2: View trading bot logs
heroku logs --tail -a your-trading-bot-name
```

Access dashboard at: `http://localhost:3000`

## Example Deployment Session

```bash
$ heroku create mybot-trading
$ heroku addons:create heroku-postgresql:essential-0 -a mybot-trading
$ heroku config:set BINANCE_API_KEY=your_key BINANCE_SECRET_KEY=your_secret -a mybot-trading
$ heroku container:push worker -a mybot-trading
$ heroku container:release worker -a mybot-trading
$ heroku ps:scale worker=1 -a mybot-trading

# Monitor trading
$ heroku logs --tail -a mybot-trading
⚙️ Trading engine configured with 3 parameter sets
💰 Account Analysis: USDT Balance: $4215.24
🎯 Position Size Preview:
   BTCUSDT: $1403.68 (33.3%)
   BNBUSDT: $1403.68 (33.3%)
   ETHUSDT: $1403.68 (33.3%)
🚀 Trading engine started successfully
```

## Benefits of Trading-Only Deployment

### ✅ **Ultra-Low Cost**
- **$5/month total** (vs $35+ for full web deployment)
- **Free worker dyno** for background processes
- **No Redis costs** (in-memory caching)

### ✅ **24/7 Reliability**
- **Background worker** doesn't sleep
- **Automatic restarts** on crashes
- **Heroku infrastructure** reliability

### ✅ **Security**
- **No public web interface** exposed
- **API keys** in environment variables only
- **Database** protected by Heroku SSL

### ✅ **Flexibility**
- **Local development** with full web interface
- **Production trading** on reliable cloud
- **Easy scaling** (multiple workers if needed)

## Trading Configuration

Edit `config/live-trading-params.json` for your trading parameters:

```json
[
  {
    "symbol": "BTCUSDT",
    "allocation": 33.3,
    "zScoreThreshold": 5,
    "profitPercent": 15,
    "stopLossPercent": 2
  },
  {
    "symbol": "ETHUSDT", 
    "allocation": 33.3,
    "zScoreThreshold": 6,
    "profitPercent": 22,
    "stopLossPercent": 6
  },
  {
    "symbol": "BNBUSDT",
    "allocation": 33.3,
    "zScoreThreshold": 7,
    "profitPercent": 20,
    "stopLossPercent": 30
  }
]
```

## Perfect For:
- **Live algorithmic trading** on a budget
- **24/7 automated trading** without high costs
- **Development/testing** with local web interface
- **Small to medium** trading accounts ($1K-$50K)

**Result**: Professional algorithmic trading infrastructure for just **$5/month**! 🚀