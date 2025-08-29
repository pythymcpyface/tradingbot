# Glicko-2 Trading Bot

A high-performance cryptocurrency trading bot that uses the Glicko-2 rating system to identify profitable trading opportunities based on momentum analysis.

## 🏗️ Architecture

The system uses a hybrid architecture for maximum performance:

- **Rust Core**: High-performance computational engine for Glicko-2 calculations and backtesting
- **Node.js API**: TypeScript-based API server with comprehensive REST endpoints
- **React Dashboard**: Modern web interface for monitoring and control
- **PostgreSQL**: Robust data storage with Prisma ORM

## 🔬 The Glicko-2 Strategy

This bot implements a novel approach to cryptocurrency trading using the Glicko-2 rating system originally designed for competitive gaming rankings. The key innovation is the **hybrid performance scoring** that combines:

1. **Price Action**: Whether the asset price moved up, down, or stayed flat
2. **Volume Analysis**: Dominance of taker buy vs taker sell volume
3. **Confidence Scoring**: High/low confidence signals based on price-volume agreement

### Hybrid Scoring Matrix

| Price Movement | Volume Dominance | Score | Confidence | Interpretation |
|----------------|-----------------|-------|------------|----------------|
| Up ↗️ | Taker Buy > Sell | 1.0 | HIGH | Strong bullish momentum |
| Up ↗️ | Taker Sell > Buy | 0.75 | LOW | Uncertain upward move |
| Unchanged → | Any | 0.5 | NEUTRAL | Consolidation |
| Down ↘️ | Taker Buy > Sell | 0.25 | LOW | Uncertain downward move |
| Down ↘️ | Taker Sell > Buy | 0.0 | HIGH | Strong bearish momentum |

## 🚀 Features

### Core Trading Features
- ✅ Real-time Glicko-2 rating calculations
- ✅ Z-score based momentum signal generation
- ✅ Automated trade execution via Binance API
- ✅ Risk management (stop-loss, take-profit, position limits)
- ✅ OCO (One-Cancels-Other) order support

### Backtesting & Optimization
- ✅ Windowed backtesting with walk-forward analysis
- ✅ Comprehensive performance metrics (Sharpe, Sortino, Alpha, etc.)
- ✅ Parameter optimization across multiple timeframes
- ✅ Multi-variate correlation analysis

### Dashboard & Monitoring
- ✅ Real-time portfolio tracking
- ✅ Live signal monitoring
- ✅ Performance visualization
- ✅ Trade history and analytics

### Performance Optimizations
- 🚀 **10-50x faster** computations using Rust
- 🚀 Parallel backtesting execution
- 🚀 Efficient memory management
- 🚀 Sub-second signal generation

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL 13+
- Docker (optional)

### Quick Start

1. **Clone the repository**
```bash
git clone <repository-url>
cd tradingbot_glicko
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Database setup**
```bash
# Start PostgreSQL
npm run docker:up

# Generate Prisma client
npm run prisma:generate
```

5. **Run your first analysis**
```bash
# Quick test (see guides for details)
npm run getTradingPairs
npm run getKlines "BTCUSDT,ETHUSDT" "2024-01-01" "2024-01-02"
npm run calculateGlickoRatings "BTC,ETH" "2024-01-01" "2024-01-02"
npm run plotGlickoRatings
```

## 📖 Execution Guides

- **[Quick Start Guide](QUICK_START_GUIDE.md)** - Get up and running in 5 minutes
- **[Stage Execution Guide](STAGE_EXECUTION_GUIDE.md)** - Complete step-by-step instructions for all stages
- **[Troubleshooting](STAGE_EXECUTION_GUIDE.md#-troubleshooting)** - Common issues and solutions

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/tradingbot"

# Binance API (get from binance.com)
BINANCE_API_KEY="your_api_key"
BINANCE_API_SECRET="your_api_secret"
BINANCE_TESTNET=true  # Set to false for live trading

# Trading Configuration
COINS="BTC,ETH,ADA,DOT,LINK,UNI,AAVE,SOL"
Z_SCORE_THRESHOLD=2.5
MOVING_AVERAGES=200
PROFIT_PERCENT=5.0
STOP_LOSS_PERCENT=2.5

# Server
PORT=3000
NODE_ENV=development
```

## 🎯 Trading Process

### 1. Data Collection
```bash
# Sync historical klines data
curl -X POST http://localhost:3000/api/trading/sync-klines \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["BTCUSDT", "ETHUSDT"],
    "startTime": "2021-01-01T00:00:00Z",
    "endTime": "2024-01-01T00:00:00Z",
    "interval": "1h"
  }'
```

### 2. Calculate Glicko-2 Ratings
```bash
# Calculate ratings for all collected data
curl -X POST http://localhost:3000/api/glicko/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["BTCUSDT", "ETHUSDT"],
    "startTime": "2021-01-01T00:00:00Z",
    "endTime": "2024-01-01T00:00:00Z"
  }'
```

### 3. Run Backtests
```bash
# Single backtest
curl -X POST http://localhost:3000/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "baseAsset": "BTC",
    "quoteAsset": "USDT", 
    "zScoreThreshold": 2.5,
    "movingAverages": 200,
    "profitPercent": 5.0,
    "stopLossPercent": 2.5,
    "startTime": "2022-01-01T00:00:00Z",
    "endTime": "2023-01-01T00:00:00Z"
  }'

# Windowed backtest
curl -X POST http://localhost:3000/api/backtest/windowed \
  -H "Content-Type: application/json" \
  -d '{
    "baseAsset": "BTC",
    "quoteAsset": "USDT",
    "zScoreThreshold": 2.5,
    "movingAverages": 200,
    "profitPercent": 5.0,
    "stopLossPercent": 2.5,
    "startTime": "2021-01-01T00:00:00Z",
    "endTime": "2024-01-01T00:00:00Z",
    "windowSize": 12
  }'
```

### 4. Start Live Trading
```bash
# Initialize Binance connection
curl -X POST http://localhost:3000/api/trading/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret",
    "testnet": true
  }'

# Start trading engine
curl -X POST http://localhost:3000/api/trading/start \
  -H "Content-Type: application/json" \
  -d '{
    "zScoreThreshold": 2.5,
    "movingAveragesPeriod": 200,
    "profitPercent": 5.0,
    "stopLossPercent": 2.5,
    "maxPositions": 5,
    "allocationPerPosition": 0.1,
    "symbols": ["BTCUSDT", "ETHUSDT"],
    "enableLiveTrading": false
  }'
```

## 📊 API Endpoints

### Trading
- `POST /api/trading/initialize` - Initialize Binance connection
- `POST /api/trading/start` - Start trading engine
- `POST /api/trading/stop` - Stop trading engine
- `GET /api/trading/status` - Get current status
- `GET /api/trading/signals` - Get current trading signals

### Data Management
- `GET /api/glicko/ratings` - Get Glicko-2 ratings
- `POST /api/glicko/calculate` - Calculate new ratings
- `GET /api/orders` - Get order history
- `GET /api/orders/stats` - Get trading statistics

### Backtesting
- `POST /api/backtest/run` - Run single backtest
- `POST /api/backtest/windowed` - Run windowed backtest
- `GET /api/backtest` - Get backtest results

### Optimization
- `GET /api/optimisation` - Get optimization results
- `GET /api/optimisation/best` - Get best parameters
- `POST /api/optimisation/run-full` - Run full optimization

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run Rust tests
cd src/rust-core && cargo test
```

### Test Coverage Requirements
- **70% minimum** code coverage across all modules
- Comprehensive unit tests for Glicko-2 calculations
- Integration tests for API endpoints  
- Edge case testing for market data handling

## 🔒 Security & Risk Management

### Built-in Safety Features
- **Paper Trading Mode**: Test strategies without real money
- **Position Limits**: Maximum number of concurrent positions
- **Daily Loss Limits**: Automatic shutdown on excessive losses
- **Emergency Stop**: Instantly halt all trading and cancel orders
- **API Rate Limiting**: Prevent Binance API violations

### Risk Parameters
```typescript
{
  maxDailyLoss: 100,      // Maximum daily loss in USDT
  maxDrawdown: 10,        // Maximum portfolio drawdown %
  cooldownPeriod: 60,     // Minutes to wait after failed trades
  maxPositions: 5,        // Maximum concurrent positions
  allocationPerPosition: 0.1  // 10% of portfolio per position
}
```

## 📈 Performance Metrics

The system tracks comprehensive performance metrics:

- **Returns**: Total, Annualized, Alpha vs Benchmark
- **Risk**: Sharpe Ratio, Sortino Ratio, Maximum Drawdown
- **Trade Analysis**: Win Rate, Profit Factor, Average Duration
- **Volatility**: Annualized volatility and downside deviation

## 🐳 Docker Deployment

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:13
    environment:
      POSTGRES_DB: tradingbot
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    
  api:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/tradingbot
```

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api
```

## 📚 Documentation

- [Glicko-2 Algorithm Specification](GLICKO_SPEC.html)
- [Backtesting Methodology](BACKTEST_SPEC.html)
- [API Documentation](docs/api.md)
- [Trading Strategy Guide](docs/strategy.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript strict mode
- Write tests for all new features
- Use conventional commit messages
- Ensure 70% test coverage
- Document complex algorithms

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

**This software is for educational and research purposes only.** 

- Cryptocurrency trading involves substantial risk of loss
- Past performance does not guarantee future results
- Never invest more than you can afford to lose
- The authors are not responsible for any financial losses
- Always test thoroughly on testnet before live trading

## 🆘 Support

- 📧 Email: support@tradingbot.example
- 💬 Discord: [Join our community](https://discord.gg/tradingbot)
- 📖 Wiki: [Comprehensive guides](https://github.com/tradingbot/wiki)
- 🐛 Issues: [Report bugs](https://github.com/tradingbot/issues)

---

Built with ❤️ using Rust, TypeScript, and React.