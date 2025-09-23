# Complete Trading Bot Setup Guide

## Overview

This guide covers setting up the complete trading bot system with database, API server, and web interface using Docker Compose. You'll have a fully functional trading dashboard with real-time data visualization.

## Prerequisites

- Docker and Docker Compose installed
- Binance API credentials (for live trading)
- Git repository cloned locally

## Quick Start (5 Minutes)

### 1. **Environment Setup**

Create your environment file:
```bash
cp env.example .env
```

Edit `.env` with your settings:
```bash
nano .env  # or use your preferred editor
```

### 2. **Start Everything**
```bash
./start-dev.sh
```

### 3. **Access Your Dashboard**
- **Web Interface**: http://localhost:3003
- **API Health**: http://localhost:3000/health
- **Database**: localhost:5437

---

## Detailed Configuration

### Environment Variables (.env)

Create a `.env` file in the project root with these required variables:

```bash
# ===== BINANCE API CONFIGURATION =====
# Get these from https://www.binance.com/en/my/settings/api-management
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_SECRET_KEY=your_binance_secret_key_here
BINANCE_TESTNET=false

# ===== TRADING CONFIGURATION =====
TRADING_MODE=PAPER          # PAPER for testing, LIVE for real money
DEFAULT_QUOTE_ASSET=USDT
DEFAULT_TRADE_AMOUNT=100
MAX_POSITIONS=10
STOP_LOSS_PERCENT=-5
PROFIT_TARGET_PERCENT=10

# ===== DATABASE CONFIGURATION =====
# PostgreSQL connection details
DATABASE_URL=postgresql://tradingbot:secure_password_2024@postgres:5432/tradingbot_glicko
POSTGRES_PASSWORD=secure_password_2024
POSTGRES_USER=tradingbot
POSTGRES_DB=tradingbot_glicko

# ===== APPLICATION CONFIGURATION =====
NODE_ENV=development
PORT=3000

# ===== API KEYS (Optional) =====
AV_API_KEY=your_alpha_vantage_key
FINNHUB_API_KEY=your_finnhub_key

# ===== GLICKO RATING CONFIGURATION =====
ELO_MOVING_AVERAGE_PERIODS=5
ELO_STANDARD_DEVIATION_THRESHOLD=2.0

# ===== TRADING PAIRS =====
TRADING_PAIRS=ADABNB,ADABTC,ADAETH,ADAUSDT,AVAXBNB,AVAXBTC,AVAXETH,AVAXUSDT,BNBBTC,BNBETH,BNBUSDT,BTCUSDT,DOGEBTC,DOGEUSDT,ETHBTC,ETHUSDT,LINKBNB,LINKBTC,LINKETH,LINKUSDT
```

### Port Configuration

The system uses these ports:

| Service | Internal Port | External Port | Access URL |
|---------|---------------|---------------|------------|
| PostgreSQL Database | 5432 | 5437 | localhost:5437 |
| API Server | 3001 | 3000 | http://localhost:3000 |
| React Web App | 3000 | 3003 | http://localhost:3003 |

### Docker Compose Configuration

The system runs three main services:

#### 1. **Database Service (postgres)**
```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_DB: tradingbot_glicko
    POSTGRES_USER: tradingbot
    POSTGRES_PASSWORD: secure_password_2024
  ports:
    - "5437:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

#### 2. **API Server Service (api)**
```yaml
api:
  build:
    context: .
    dockerfile: Dockerfile.api-only
  environment:
    DATABASE_URL: postgresql://tradingbot:secure_password_2024@postgres:5432/tradingbot_glicko
    BINANCE_API_KEY: ${BINANCE_API_KEY}
    BINANCE_SECRET_KEY: ${BINANCE_SECRET_KEY}
  ports:
    - "3000:3001"
```

#### 3. **Web Interface Service (webapp)**
```yaml
webapp:
  build:
    context: ./src/web-ui
    dockerfile: Dockerfile.webapp
  environment:
    REACT_APP_API_URL: http://localhost:3000
  ports:
    - "3003:3000"
```

---

## Step-by-Step Manual Setup

### Step 1: Prepare Environment

1. **Clone the repository** (if not already done):
```bash
git clone <repository-url>
cd tradingbot_glicko
```

2. **Create environment file**:
```bash
cp env.example .env
```

3. **Edit environment variables**:
```bash
# Required - Get from Binance
BINANCE_API_KEY=your_actual_api_key
BINANCE_SECRET_KEY=your_actual_secret_key

# Trading mode
TRADING_MODE=PAPER  # Start with PAPER mode for safety

# Database password (choose a secure password)
POSTGRES_PASSWORD=your_secure_password_here
```

### Step 2: Start Services

#### Option A: Use the startup script (Recommended)
```bash
chmod +x start-dev.sh
./start-dev.sh
```

#### Option B: Manual Docker Compose
```bash
# Start all services
docker-compose -f docker-compose.full.yml up -d

# View logs
docker-compose -f docker-compose.full.yml logs -f

# Check status
docker-compose -f docker-compose.full.yml ps
```

### Step 3: Initialize Database

After starting services, initialize the database:

```bash
# Wait for services to be ready (30 seconds)
sleep 30

# Run database migrations
docker-compose -f docker-compose.full.yml exec api npx prisma db push

# (Optional) Seed with sample data
docker-compose -f docker-compose.full.yml exec api npm run seed
```

### Step 4: Verify Setup

Check each service:

1. **Database Connection**:
```bash
docker-compose -f docker-compose.full.yml exec postgres psql -U tradingbot -d tradingbot_glicko -c "\dt"
```

2. **API Health**:
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","services":{"database":"connected"}}
```

3. **Web Interface**:
   - Open: http://localhost:3003
   - Should show trading dashboard with charts

---

## Service Management

### Starting Services
```bash
# Start all services
docker-compose -f docker-compose.full.yml up -d

# Start specific service
docker-compose -f docker-compose.full.yml up -d postgres
docker-compose -f docker-compose.full.yml up -d api
docker-compose -f docker-compose.full.yml up -d webapp
```

### Stopping Services
```bash
# Stop all services
docker-compose -f docker-compose.full.yml down

# Stop specific service
docker-compose -f docker-compose.full.yml stop api
```

### Viewing Logs
```bash
# All logs
docker-compose -f docker-compose.full.yml logs -f

# Specific service logs
docker-compose -f docker-compose.full.yml logs -f api
docker-compose -f docker-compose.full.yml logs -f postgres
docker-compose -f docker-compose.full.yml logs -f webapp
```

### Restarting Services
```bash
# Restart all
docker-compose -f docker-compose.full.yml restart

# Restart specific service
docker-compose -f docker-compose.full.yml restart api
```

---

## Accessing Your Trading Dashboard

### Web Interface (http://localhost:3003)

The web dashboard provides:

- **Dashboard**: Overview of trading performance
- **Charts**: Z-score visualization and trading signals
- **Orders**: View live and paper trades
- **Backtest Results**: Historical performance analysis
- **Optimization**: Parameter tuning results

### API Endpoints (http://localhost:3000)

Key endpoints:

- **Health Check**: `GET /health`
- **Z-Scores**: `GET /api/glicko/z-scores?symbol=BTCUSDT&limit=100`
- **Trading Signals**: `GET /api/trading/signals`
- **Orders**: `GET /api/orders`
- **Backtest Data**: `GET /api/backtest`

### Database Access (localhost:5437)

Connect to PostgreSQL:
```bash
# Using Docker
docker-compose -f docker-compose.full.yml exec postgres psql -U tradingbot -d tradingbot_glicko

# Using local psql client
psql -h localhost -p 5437 -U tradingbot -d tradingbot_glicko
```

---

## Troubleshooting

### Common Issues

#### 1. **Port Already in Use**
```bash
# Check what's using the port
lsof -i :3000
lsof -i :3003
lsof -i :5437

# Kill process if needed
kill -9 <PID>
```

#### 2. **Database Connection Failed**
```bash
# Check if database is running
docker-compose -f docker-compose.full.yml ps postgres

# Check database logs
docker-compose -f docker-compose.full.yml logs postgres

# Restart database
docker-compose -f docker-compose.full.yml restart postgres
```

#### 3. **API Not Responding**
```bash
# Check API logs
docker-compose -f docker-compose.full.yml logs api

# Check if API container is running
docker-compose -f docker-compose.full.yml ps api

# Restart API
docker-compose -f docker-compose.full.yml restart api
```

#### 4. **Web Interface Shows "Network Error"**
- Check if API is running: `curl http://localhost:3000/health`
- Verify React app API URL: Should be `http://localhost:3000`
- Check browser console for errors

#### 5. **Charts Not Loading**
```bash
# Test z-score endpoint
curl "http://localhost:3000/api/glicko/z-scores?symbol=BTCUSDT&limit=10"

# Check if database has data
docker-compose -f docker-compose.full.yml exec postgres psql -U tradingbot -d tradingbot_glicko -c "SELECT COUNT(*) FROM zscore_history;"
```

### Reset Everything
```bash
# Stop and remove all containers and volumes
docker-compose -f docker-compose.full.yml down -v

# Remove images
docker-compose -f docker-compose.full.yml down --rmi all

# Start fresh
./start-dev.sh
```

### Environment Variable Issues
```bash
# Check if .env file exists and has correct values
cat .env

# Verify environment variables are loaded
docker-compose -f docker-compose.full.yml config
```

---

## Security Notes

### For Development
- Use `TRADING_MODE=PAPER` until you're confident
- Use test API keys initially
- Database password can be simple for local development

### For Production
- Use strong database passwords
- Set `TRADING_MODE=LIVE` only when ready
- Use production Binance API keys
- Consider using Docker secrets for sensitive data
- Enable SSL/TLS for public deployments

---

## Next Steps

### After Setup
1. **Verify data**: Check that charts show real z-score data
2. **Test trading**: Start with paper trading mode
3. **Monitor logs**: Watch for any errors or issues
4. **Customize**: Adjust trading parameters in your `.env` file

### For Production Use
1. **Deploy to VPS**: Use the trading-only setup for production
2. **Monitor performance**: Set up proper logging and alerts
3. **Backup data**: Regular database backups
4. **Scale**: Consider multiple trading pairs or strategies

---

## Quick Reference

### Essential Commands
```bash
# Start everything
./start-dev.sh

# Stop everything
docker-compose -f docker-compose.full.yml down

# View all logs
docker-compose -f docker-compose.full.yml logs -f

# Restart API only
docker-compose -f docker-compose.full.yml restart api

# Database backup
docker-compose -f docker-compose.full.yml exec postgres pg_dump -U tradingbot tradingbot_glicko > backup.sql
```

### Service URLs
- **Web Dashboard**: http://localhost:3003
- **API Health**: http://localhost:3000/health
- **Database**: postgresql://tradingbot:password@localhost:5437/tradingbot_glicko

### Important Files
- **Environment**: `.env`
- **Docker Compose**: `docker-compose.full.yml`
- **Startup Script**: `start-dev.sh`
- **This Guide**: `COMPLETE_SETUP_GUIDE.md`