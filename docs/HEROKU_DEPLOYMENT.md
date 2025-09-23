# Heroku Deployment Guide

## Overview

This guide explains how to containerize and deploy the trading bot on Heroku using Docker containers. The deployment includes the Node.js API, React frontend, and Rust core components in a single container with external database services.

## Prerequisites

1. **Heroku CLI** installed and authenticated
2. **Docker** installed locally
3. **Git** repository set up
4. **Binance API** credentials (for live trading)

## Deployment Steps

### 1. Install Heroku CLI
```bash
# macOS (using Homebrew)
brew tap heroku/brew && brew install heroku

# Or download from: https://devcenter.heroku.com/articles/heroku-cli
```

### 2. Login to Heroku
```bash
heroku login
heroku container:login
```

### 3. Create Heroku Application
```bash
# Create new Heroku app
heroku create your-trading-bot-name

# Or use existing app
heroku git:remote -a your-existing-app-name
```

### 4. Set Stack to Container
```bash
heroku stack:set container -a your-trading-bot-name
```

### 5. Add Database Add-on

```bash
# PostgreSQL database (cost-optimized tier)
heroku addons:create heroku-postgresql:essential-0 -a your-trading-bot-name
```

### 6. Configure Environment Variables

```bash
# Set Node environment
heroku config:set NODE_ENV=production -a your-trading-bot-name

# Set Binance API credentials (REQUIRED for live trading)
heroku config:set BINANCE_API_KEY=your_api_key -a your-trading-bot-name
heroku config:set BINANCE_SECRET_KEY=your_secret_key -a your-trading-bot-name

# Set trading mode (PAPER for testing, LIVE for real trading)
heroku config:set TRADING_MODE=PAPER -a your-trading-bot-name

# Optional: Set log level
heroku config:set LOG_LEVEL=info -a your-trading-bot-name

# Note: REDIS_URL not needed - using in-memory NodeCache for optimal cost
```

### 7. Deploy Application

```bash
# Build and push container to Heroku
heroku container:push web -a your-trading-bot-name

# Release the container
heroku container:release web -a your-trading-bot-name
```

### 8. Initialize Database

```bash
# Run database migrations
heroku run npm run db:migrate:deploy -a your-trading-bot-name

# Optional: Calculate initial Glicko ratings (for new deployments)
heroku run npm run db:calculate-ratings -a your-trading-bot-name
```

## Application Architecture

### Container Structure
- **Base Image**: Node.js 18 slim
- **Multi-stage Build**: 
  1. Rust compilation stage
  2. Node.js build stage  
  3. React frontend build stage
  4. Production runtime stage
- **Final Size**: ~150MB optimized container (reduced by excluding heavy tables)

### Production Database Schema
The production deployment uses a **minimal database schema** that excludes heavy development tables:

#### ✅ **Included Tables** (Essential for live trading):
- `klines` - Market data for Glicko calculations
- `glicko_ratings` - Trading signals and ratings
- `zscore_history` - Live trading z-score tracking  
- `production_orders` - Live/paper trading orders

#### ❌ **Excluded Tables** (Development only):
- `backtest_orders` - Removed (~millions of test orders)
- `backtest_runs` - Removed (~thousands of test runs)
- `optimization_results` - Removed (~thousands of parameter tests)

**Benefits**: ~90% smaller database, faster deployments, lower costs

### Services Configuration
- **Web Process**: Single container serving API + frontend
- **Database**: Heroku Postgres add-on (minimal schema)
- **Cache**: In-memory NodeCache (no external Redis needed)
- **Port**: Dynamic (assigned by Heroku)

## Monitoring and Maintenance

### View Logs
```bash
# Stream application logs
heroku logs --tail -a your-trading-bot-name

# View specific log types
heroku logs --source app --tail -a your-trading-bot-name
```

### Application Health
```bash
# Check application status
heroku ps -a your-trading-bot-name

# Health check endpoint
curl https://your-app-name.herokuapp.com/health
```

### Scaling
```bash
# Scale web dynos (basic plan supports 1 dyno)
heroku ps:scale web=1 -a your-trading-bot-name
```

### Database Management
```bash
# Access database
heroku pg:psql -a your-trading-bot-name

# Create database backup
heroku pg:backups:capture -a your-trading-bot-name

# View database info
heroku pg:info -a your-trading-bot-name
```

## Configuration Details

### Environment Variables
| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Node environment | `production` |
| `DATABASE_URL` | Auto | PostgreSQL connection string | Set by addon |
| `BINANCE_API_KEY` | Yes* | Binance API key | None |
| `BINANCE_SECRET_KEY` | Yes* | Binance secret key | None |
| `TRADING_MODE` | No | Trading mode (PAPER/LIVE) | `PAPER` |
| `LOG_LEVEL` | No | Logging level | `info` |

*Required for live trading functionality

### Resource Limits
- **Memory**: 512MB (Basic dyno)
- **Disk**: Ephemeral (logs cleared on restart)
- **Network**: Outbound HTTPS allowed
- **Build Time**: 15 minutes maximum

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Check Dockerfile syntax
   - Ensure all dependencies are listed
   - Verify Rust compilation succeeds

2. **Runtime Errors**
   - Check environment variables are set
   - Verify database connection
   - Review application logs

3. **Database Issues**
   - Ensure Prisma schema matches deployed version
   - Run migrations after schema changes
   - Check connection limits

4. **Trading Issues**
   - Verify Binance API credentials
   - Check API rate limits
   - Ensure proper paper/live mode configuration

### Build Commands
```bash
# Local build test
docker build -t trading-bot .

# Local run test  
docker run -p 3001:3001 --env-file .env.production trading-bot

# Force rebuild on Heroku
heroku container:push web --recursive -a your-trading-bot-name
```

### Reset Deployment
```bash
# Reset and redeploy
heroku container:push web -a your-trading-bot-name
heroku container:release web -a your-trading-bot-name
heroku run npm run db:migrate:deploy -a your-trading-bot-name
```

## Security Considerations

1. **API Keys**: Never commit API keys to version control
2. **Environment**: Always use environment variables for sensitive data
3. **Database**: Use Heroku's SSL-enabled database connections
4. **Network**: All external API calls use HTTPS
5. **Logs**: Avoid logging sensitive information

## Cost Optimization ⭐

The minimal schema + in-memory caching dramatically reduces costs:

### **Ultra-Budget Production** (~$12/month) 🎯 **RECOMMENDED**
- **Basic Dyno**: $7/month (no sleep, 24/7 uptime)
- **Postgres Essential-0**: $5/month (1M rows, 20 connections) 
- **No Redis needed**: $0/month (uses NodeCache in-memory)
- **Total**: **$12/month for bulletproof production trading**

### **Premium Production** (~$30/month) 
- **Standard Dyno**: $25/month (no sleep, SSL, better performance)
- **Postgres Mini**: $5/month (1M rows, 20 connections)
- **No Redis needed**: $0/month
- **Total**: **$30/month for high-performance trading**

**Massive Savings**: ~$60-70/month vs full development schema with Redis!

## Live Trading Setup

For live trading deployment:

1. **Set Environment**:
   ```bash
   heroku config:set TRADING_MODE=LIVE -a your-trading-bot-name
   ```

2. **Configure Parameters**: Update `config/live-params.json` with your trading parameters

3. **Monitor Closely**: Watch logs and account balance

4. **Start Small**: Test with minimal allocation first

⚠️ **WARNING**: Live trading uses real money. Always test thoroughly in paper mode first!

## Support

For deployment issues:
1. Check this documentation
2. Review Heroku logs: `heroku logs --tail`
3. Test locally with Docker first
4. Verify all environment variables are set correctly