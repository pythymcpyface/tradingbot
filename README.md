# Glicko-2 Trading Bot

A high-performance cryptocurrency trading system that uses the Glicko-2 rating algorithm to identify momentum-based trading opportunities. The system calculates "skill ratings" for cryptocurrencies based on their price performance, then generates trading signals when a coin's rating significantly deviates from the market average.

## Architecture

```
+------------------+     +-------------------+     +------------------+
|   Binance API    | --> |   Node.js API     | --> |   PostgreSQL     |
|   (Market Data)  |     |   (TradingEngine) |     |   (Prisma ORM)   |
+------------------+     +-------------------+     +------------------+
                                  |
                                  v
                         +-------------------+
                         |   React Dashboard |
                         |   (Monitoring UI) |
                         +-------------------+
```

### Core Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Trading Engine | TypeScript | Signal generation, order execution, position management |
| Glicko Engine | TypeScript | Rating calculations using Glicko-2 algorithm |
| Binance Service | TypeScript | API integration, WebSocket streams, order management |
| Signal Generator | TypeScript | Z-score calculations, moving average analysis |
| Database | PostgreSQL + Prisma | Kline storage, rating history, order tracking |
| Web Dashboard | React | Real-time monitoring, trade visualization |

## How It Works

### 1. Glicko-2 Rating System

The Glicko-2 algorithm (originally designed for chess rankings) rates each cryptocurrency based on price performance:

**Rating Parameters:**
- `Rating (R)`: Skill estimate where 1500 = baseline neutral
- `Rating Deviation (RD)`: Confidence in the rating (lower = more certain)
- `Volatility (sigma)`: Expected rating fluctuation over time

**Continuous Scaling Formula:**
```
gameResult = 0.5 + (priceChangePercent * 50)
```
Where:
- Price change >= +2% maps to 1.0 (strong win)
- Price change = 0% maps to 0.5 (draw)
- Price change <= -2% maps to 0.0 (strong loss)

The algorithm processes all coins pairwise against each other at each interval, creating a relative ranking that reflects market-adjusted momentum.

### 2. Signal Generation

**Z-Score Calculation:**
```
zScore = (coinRating - meanRating) / standardDeviation
```

Trading signals are generated when a coin's moving average z-score crosses defined thresholds:
- `BUY`: Moving average z-score > +threshold (strong relative momentum)
- `SELL`: Moving average z-score < -threshold (weak relative momentum)
- `HOLD`: Z-score within threshold bounds

### 3. Trade Execution

Positions are managed with OCO (One-Cancels-Other) orders providing three exit mechanisms:
1. **Take Profit**: Limit order at target profit percentage
2. **Stop Loss**: Stop order at maximum loss percentage
3. **Signal Reversal**: Z-score reverses past threshold

## Installation

### Prerequisites

- Node.js 18+
- PostgreSQL 13+
- Docker (optional, for containerized deployment)
- Binance API credentials

### Quick Start

```bash
# Clone and install
git clone <repository-url>
cd tradingbot_glicko
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Initialize database
npm run prisma:generate
npm run docker:up  # Starts PostgreSQL

# Fetch historical data
npm run getTradingPairs
npm run getKlines "BTCUSDT,ETHUSDT" "2024-01-01" "2024-06-01"

# Calculate Glicko ratings
npm run calculateGlickoRatings

# Run backtest
npm run runWindowedBacktest
```

## Configuration

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/tradingbot"

# Binance API
BINANCE_API_KEY="your_api_key"
BINANCE_API_SECRET="your_api_secret"
BINANCE_TESTNET=true  # Use testnet for paper trading

# Trading Parameters
COINS="BTC,ETH,SOL,ADA,DOT,LINK"
Z_SCORE_THRESHOLD=2.5
MOVING_AVERAGES=200
PROFIT_PERCENT=5.0
STOP_LOSS_PERCENT=2.5

# Server
PORT=3000
NODE_ENV=development
```

### Trading Parameters

| Parameter | Description | Typical Range |
|-----------|-------------|---------------|
| `zScoreThreshold` | Z-score level to trigger signals | 1.5 - 3.0 |
| `movingAverages` | Periods for z-score smoothing | 50 - 300 |
| `profitPercent` | Take profit target % | 3.0 - 10.0 |
| `stopLossPercent` | Stop loss limit % | 1.5 - 5.0 |
| `maxPositions` | Concurrent position limit | 3 - 10 |
| `allocationPerPosition` | Portfolio % per trade | 0.05 - 0.20 |

## Available Scripts

### Data Management

```bash
npm run getTradingPairs      # Fetch available trading pairs
npm run getKlines            # Download historical kline data
npm run getKlines:resume     # Resume interrupted downloads
npm run calculateGlickoRatings  # Calculate Glicko-2 ratings
```

### Backtesting

```bash
npm run runWindowedBacktest     # Run windowed walk-forward backtest
npm run runAllWindowedBacktests # Batch backtests across parameters
```

### Trading

```bash
npm run startPaperTrading    # Paper trading mode (no real orders)
npm run startLiveTrading     # Live trading with real orders
```

### Analysis

```bash
npm run plotGlickoRatings        # Visualize rating trajectories
npm run queryTopCalmarRatios     # Find best risk-adjusted returns
npm run queryTopSharpe           # Find best Sharpe ratios
npm run generateTradeCharts      # Generate trade visualizations
```

### Database Utilities

```bash
npm run validate:glicko      # Validate rating data integrity
npm run validate:klines      # Validate kline data completeness
npm run clear:ratings        # Clear Glicko ratings
npm run clear:orders         # Clear backtest orders
```

## API Endpoints

### Trading Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trading/initialize` | POST | Initialize Binance connection |
| `/api/trading/start` | POST | Start trading engine |
| `/api/trading/stop` | POST | Stop trading engine |
| `/api/trading/status` | GET | Get engine status |
| `/api/trading/signals` | GET | Get current signals |

### Data Access

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/glicko/ratings` | GET | Get current ratings |
| `/api/glicko/calculate` | POST | Trigger rating calculation |
| `/api/orders` | GET | Get order history |
| `/api/orders/stats` | GET | Get trading statistics |

### Backtesting

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/backtest/run` | POST | Run single backtest |
| `/api/backtest/windowed` | POST | Run windowed backtest |
| `/api/backtest` | GET | Get backtest results |

## Performance Metrics

The system tracks comprehensive performance metrics:

**Returns:**
- Total Return (%)
- Annualized Return (%)
- Alpha vs Buy-and-Hold benchmark

**Risk-Adjusted:**
- Sharpe Ratio
- Sortino Ratio
- Calmar Ratio

**Risk:**
- Maximum Drawdown (%)
- Volatility (annualized)
- Downside Deviation

**Trade Analysis:**
- Win Rate (%)
- Profit Factor
- Average Trade Duration
- Number of Trades

## Risk Management

### Built-in Safety Features

- **Paper Trading Mode**: Full simulation without real orders
- **Position Limits**: Maximum concurrent positions configurable
- **OCO Orders**: Automatic take-profit and stop-loss execution
- **Daily Loss Limits**: Automatic shutdown on excessive losses
- **API Rate Limiting**: Prevents Binance API violations

### Emergency Controls

```bash
# Stop all trading immediately
curl -X POST http://localhost:3000/api/trading/stop
```

## Documentation

| Document | Description |
|----------|-------------|
| [SPEC.md](SPEC.md) | Project specification and requirements |
| [docs/GLICKO_SPEC.md](docs/GLICKO_SPEC.md) | Glicko-2 algorithm specification |
| [docs/BACKTEST_SPEC.md](docs/BACKTEST_SPEC.md) | Backtesting engine specification |
| [docs/GLICKO_TRADING_STRATEGY.md](docs/GLICKO_TRADING_STRATEGY.md) | Complete trading strategy guide |
| [docs/PARITY_VALIDATION.md](docs/PARITY_VALIDATION.md) | Algorithm parity validation |
| [docs/QUICK_START_GUIDE.md](docs/QUICK_START_GUIDE.md) | Quick start tutorial |

## Testing

```bash
npm test              # Run all tests
npm run test:coverage # Run with coverage report
npm run typecheck     # TypeScript type checking
```

## Docker Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

## Project Structure

```
tradingbot_glicko/
├── src/
│   ├── node-api/          # API server and trading engine
│   │   ├── services/      # Core services (TradingEngine, BinanceService)
│   │   ├── routes/        # Express API routes
│   │   └── index.ts       # Server entry point
│   ├── services/          # Shared services (GlickoEngine, SignalGenerator)
│   ├── types/             # TypeScript type definitions
│   └── web-ui/            # React dashboard
├── scripts/               # CLI scripts for operations
├── prisma/                # Database schema
├── docs/                  # Technical documentation
└── tests/                 # Test suites
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Disclaimer

**This software is for educational and research purposes only.**

- Cryptocurrency trading involves substantial risk of loss
- Past performance does not guarantee future results
- Never invest more than you can afford to lose
- The authors are not responsible for any financial losses
- Always test thoroughly on testnet before live trading
