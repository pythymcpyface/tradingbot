# Database Migration Guide

This guide will help you migrate your existing klines database to the new Glicko-2 Trading Bot PostgreSQL instance.

## 🚀 Quick Start (Automated)

The fastest way to migrate your database is using our automated setup script:

```bash
# Make sure you're in the project directory
cd tradingbot_glicko

# Run the automated setup (this will guide you through the process)
npm run setup
```

The automated script will:
1. ✅ Check system requirements
2. ✅ Set up environment variables
3. ✅ Start the new PostgreSQL database
4. ✅ Install dependencies
5. ✅ Run database migrations
6. ✅ Build the Rust core engine
7. ✅ Migrate your existing klines data
8. ✅ Calculate initial Glicko-2 ratings
9. ✅ Verify the setup

## 📋 Manual Step-by-Step Migration

If you prefer manual control or the automated script fails, follow these steps:

### Step 1: Environment Setup

1. **Copy environment file:**
```bash
cp .env.example .env
```

2. **Edit `.env` file with your settings:**
```env
# New database (will be created)
DATABASE_URL="postgresql://tradingbot:secure_password_2024@localhost:5433/tradingbot_glicko"

# Your existing database
OLD_DATABASE_URL="postgresql://your_user:your_password@localhost:5432/your_database_name"

# Your Binance API credentials
BINANCE_API_KEY="your_api_key"
BINANCE_API_SECRET="your_api_secret"
BINANCE_TESTNET=true  # Keep true for testing
```

### Step 2: Start New Database

```bash
# Start PostgreSQL with Docker
npm run docker:up

# Verify database is running
docker ps | grep tradingbot-postgres
```

### Step 3: Install Dependencies

```bash
# Install all dependencies
npm install

# Generate Prisma client
npm run prisma:generate
```

### Step 4: Run Database Migrations

```bash
# Create database schema
npx prisma migrate deploy

# Verify schema creation
npm run prisma:studio  # Opens database browser
```

### Step 5: Migrate Your Data

```bash
# Run the migration script
npm run db:migrate

# This will:
# - Analyze your old database structure
# - Migrate all klines data in batches
# - Validate the migration
# - Create performance indexes
```

### Step 6: Calculate Glicko-2 Ratings

```bash
# Calculate ratings for all historical data
npm run db:calculate-ratings

# This will:
# - Process all migrated klines data
# - Calculate Glicko-2 ratings using the hybrid scoring system
# - Save ratings to the database
# - Create optimized indexes
```

### Step 7: Verify Migration

```bash
# Test the API server
npm run dev

# In another terminal, test the endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/glicko/symbols
```

## 🔧 Troubleshooting

### Common Issues

#### 1. "Old database connection failed"

**Problem**: Can't connect to your existing database.

**Solution**:
- Verify your `OLD_DATABASE_URL` in `.env`
- Make sure your old database is running
- Check firewall/network settings
- Verify username/password are correct

```bash
# Test connection manually
psql "postgresql://your_user:your_password@localhost:5432/your_database_name"
```

#### 2. "Table 'klines' not found"

**Problem**: The migration script can't find your klines table.

**Solution**:
- Check your table name (might be `kline`, `candles`, `ohlcv`, etc.)
- Edit the migration script if needed:

```typescript
// In scripts/migrate-database.ts, update the possibleTableNames array:
const possibleTableNames = ['klines', 'kline', 'candles', 'ohlcv', 'your_table_name'];
```

#### 3. "Rust core build failed"

**Problem**: The Rust core engine couldn't be built.

**Solution**:
- Install Rust: https://rustup.rs/
- Or continue without Rust (TypeScript fallback will be used)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload shell
source ~/.cargo/env

# Try building again
npm run build:rust
```

#### 4. "Out of memory during migration"

**Problem**: Large database causing memory issues.

**Solution**:
- Reduce batch size in migration script
- Run migration for specific symbols only

```bash
# Edit scripts/migrate-database.ts and reduce batchSize from 10000 to 1000
# Or run for specific symbols:
```

#### 5. "Port 5433 already in use"

**Problem**: PostgreSQL can't start because port is busy.

**Solution**:
- Change the port in `docker-compose.yml`
- Or stop the service using that port

```bash
# Find what's using port 5433
lsof -i :5433

# Kill the process or change port in docker-compose.yml
```

### Database Issues

#### Slow Migration Performance

If migration is taking too long:

1. **Check system resources:**
```bash
# Monitor CPU and memory usage
htop

# Monitor database connections
docker exec tradingbot-postgres psql -U tradingbot -d tradingbot_glicko -c "SELECT count(*) FROM pg_stat_activity;"
```

2. **Optimize batch size:**
   - Edit `scripts/migrate-database.ts`
   - Reduce `batchSize` from 10000 to 1000 or 5000

3. **Migrate specific symbols only:**
```typescript
// In the migration script, add symbol filtering:
await migrator.migrateKlinesData('klines', 10000, ['BTCUSDT', 'ETHUSDT']);
```

#### Data Validation Failures

If validation shows unexpected results:

1. **Check data formats:**
```sql
-- Connect to old database and check data structure
SELECT * FROM klines LIMIT 5;

-- Check for NULL values or unexpected formats
SELECT COUNT(*) FROM klines WHERE open IS NULL;
SELECT COUNT(*) FROM klines WHERE symbol IS NULL;
```

2. **Verify timestamps:**
```sql
-- Ensure timestamps are in correct format
SELECT MIN(open_time), MAX(close_time) FROM klines;
```

## 🎯 Migration Verification

After migration, verify everything is working:

### 1. Data Integrity Check

```bash
# Check record counts match
npm run prisma:studio

# Or use SQL queries
docker exec tradingbot-postgres psql -U tradingbot -d tradingbot_glicko -c "
SELECT 
  symbol,
  COUNT(*) as records,
  MIN(\"openTime\") as earliest,
  MAX(\"closeTime\") as latest
FROM klines 
GROUP BY symbol 
ORDER BY records DESC;
"
```

### 2. Glicko-2 Ratings Check

```bash
# Verify ratings were calculated
curl http://localhost:3000/api/glicko/symbols

# Check latest ratings
curl http://localhost:3000/api/glicko/latest
```

### 3. API Functionality Test

```bash
# Start the server
npm run dev

# Test all endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/orders/stats
curl http://localhost:3000/api/backtest?limit=1
```

## 📊 Performance Expectations

Migration performance depends on your data size:

| Records | Estimated Time | Memory Usage |
|---------|---------------|--------------|
| < 100K  | 2-5 minutes   | < 1GB        |
| 100K-1M | 10-30 minutes | 1-2GB        |
| 1M-10M  | 1-3 hours     | 2-4GB        |
| > 10M   | 3+ hours      | 4+ GB        |

## 🛑 Stopping Your Old Database

**⚠️ IMPORTANT**: Only stop your old database after verifying the migration is successful!

1. **Verify migration completely:**
   - Check record counts match
   - Verify Glicko-2 ratings calculated
   - Test API endpoints work
   - Run a sample backtest

2. **Create final backup (recommended):**
```bash
# Create backup of old database
pg_dump "postgresql://your_user:your_password@localhost:5432/your_database" > backup_before_shutdown.sql
```

3. **Stop old database:**
```bash
# If using systemctl
sudo systemctl stop postgresql

# If using Docker
docker stop your_old_postgres_container

# If using Homebrew (macOS)
brew services stop postgresql
```

## 🆘 Recovery Process

If something goes wrong during migration:

### 1. Reset New Database

```bash
# Stop new database
npm run docker:down

# Remove volumes (this deletes all data!)
docker volume rm tradingbot_postgres_data

# Start fresh
npm run docker:up
npm run prisma:generate
npx prisma migrate deploy
```

### 2. Restore from Backup

```bash
# If you created a backup of your old database
psql "postgresql://tradingbot:secure_password_2024@localhost:5433/tradingbot_glicko" < backup_before_shutdown.sql
```

### 3. Partial Migration Recovery

```bash
# Clear only specific tables
docker exec tradingbot-postgres psql -U tradingbot -d tradingbot_glicko -c "TRUNCATE klines CASCADE;"

# Re-run migration for specific symbols
npm run db:migrate
```

## 📞 Getting Help

If you encounter issues not covered in this guide:

1. **Check the logs:**
```bash
# API server logs
npm run dev

# Database logs
npm run docker:logs

# Migration script logs
npm run db:migrate 2>&1 | tee migration.log
```

2. **Common log locations:**
   - Migration logs: Console output
   - Database logs: `docker-compose logs postgres`
   - API logs: Console output when running `npm run dev`

3. **Diagnostic commands:**
```bash
# System info
uname -a
node --version
docker --version

# Database status
docker exec tradingbot-postgres pg_isready -U tradingbot

# Disk space
df -h

# Memory usage
free -h
```

---

**Need more help?** Check the main [README.md](README.md) for additional documentation and troubleshooting steps.