# Docker Setup - Trading Bot Complete Environments

## Quick Start

### 1. **Setup Environment Variables**
```bash
# Copy example environment file
cp env.example .env

# Edit with your Binance API credentials
nano .env  # or use your preferred editor
```

### 2. **Choose Your Setup**

#### **🌐 Full Development** (Web Interface + API + Database)
```bash
./start-dev.sh
```
- **Web Interface**: http://localhost:3003
- **API Server**: http://localhost:3000
- **Database**: localhost:5437
- **Use for**: Development, testing, monitoring

#### **🎯 Trading Only** (Live Trading + Database)
```bash
./start-trading.sh
```
- **Trading Engine**: Background process
- **Database**: localhost:5437
- **No web interface**: Minimal resource usage
- **Use for**: Production trading, VPS deployment

## Manual Commands

### Full Development Environment
```bash
# Start all services (web + api + db)
docker-compose -f docker-compose.full.yml up -d

# View logs
docker-compose -f docker-compose.full.yml logs -f

# Stop all services
docker-compose -f docker-compose.full.yml down
```

### Trading-Only Environment
```bash
# Start trading engine + database
docker-compose -f docker-compose.trading.yml up -d

# Monitor trading logs
docker-compose -f docker-compose.trading.yml logs -f trading-engine

# Stop trading (emergency)
docker-compose -f docker-compose.trading.yml stop trading-engine

# Full shutdown
docker-compose -f docker-compose.trading.yml down
```

## Environment Variables

Required in `.env` file:

```bash
# Binance API (REQUIRED)
BINANCE_API_KEY=your_api_key_here
BINANCE_SECRET_KEY=your_secret_key_here

# Trading Mode
TRADING_MODE=PAPER     # PAPER for testing, LIVE for real money

# Database Password (for production)
POSTGRES_PASSWORD=your_secure_password

# Optional
LOG_LEVEL=info         # debug, info, warn, error
NODE_ENV=development   # development, production
```

## Service Details

### Full Development (`docker-compose.full.yml`)
- **postgres**: PostgreSQL 15 database on port 5437
- **api**: Node.js API server on port 3000
- **webapp**: React web interface on port 3003

### Trading Only (`docker-compose.trading.yml`)
- **postgres**: PostgreSQL 15 database on port 5437  
- **trading-engine**: Background trading bot (no ports)

## Monitoring

### Development Environment
- **Web Dashboard**: http://localhost:3003
- **API Health**: http://localhost:3000/health
- **Database**: Connect to localhost:5437

### Trading Environment
```bash
# Live trading logs
docker-compose -f docker-compose.trading.yml logs -f trading-engine

# Service status
docker-compose -f docker-compose.trading.yml ps

# Container stats
docker stats tradingbot-engine
```

## Database Management

### Connect to Database
```bash
# Using docker
docker exec -it tradingbot-db psql -U tradingbot -d tradingbot_glicko

# Using local psql client
psql -h localhost -p 5437 -U tradingbot -d tradingbot_glicko
```

### Database Operations
```bash
# Run migrations
docker exec -it tradingbot-api npx prisma db push

# View database schema
docker exec -it tradingbot-api npx prisma db pull
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check what's using the port
   lsof -i :3000
   # Kill the process or change the port in docker-compose
   ```

2. **API Connection Error**
   ```bash
   # Check if API is running
   curl http://localhost:3000/health
   # Check logs
   docker-compose -f docker-compose.full.yml logs api
   ```

3. **Database Connection Error**
   ```bash
   # Check if database is running
   docker-compose -f docker-compose.full.yml ps postgres
   # Check database logs
   docker-compose -f docker-compose.full.yml logs postgres
   ```

4. **Trading Engine Crashes**
   ```bash
   # Check trading logs
   docker-compose -f docker-compose.trading.yml logs trading-engine
   # Restart trading engine
   docker-compose -f docker-compose.trading.yml restart trading-engine
   ```

### Reset Everything
```bash
# Stop all services and remove volumes
docker-compose -f docker-compose.full.yml down -v
docker-compose -f docker-compose.trading.yml down -v

# Remove all containers and images
docker system prune -a

# Start fresh
./start-dev.sh
```

## Production Deployment

For production VPS deployment:

```bash
# 1. Setup environment
cp env.example .env
nano .env  # Configure with production settings

# 2. Set production mode
echo "NODE_ENV=production" >> .env
echo "TRADING_MODE=LIVE" >> .env

# 3. Start trading only
./start-trading.sh

# 4. Monitor remotely
docker-compose -f docker-compose.trading.yml logs -f trading-engine
```

## Benefits

### Full Development Setup
- ✅ **Complete local development** environment
- ✅ **Web interface** for monitoring and testing
- ✅ **API access** for development
- ✅ **Database persistence** across restarts

### Trading-Only Setup
- ✅ **Minimal resource usage** (no web interface)
- ✅ **Production ready** for VPS deployment
- ✅ **24/7 reliability** with auto-restart
- ✅ **Secure** (no exposed web ports)
- ✅ **Cost effective** for cloud deployment

Both setups provide:
- 🐳 **One-command startup**
- 📊 **Real-time monitoring**
- 🔄 **Automatic restarts**
- 💾 **Data persistence**
- 🛡️ **Isolated environments**