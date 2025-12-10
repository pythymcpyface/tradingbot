# Historical Glicko Ratings Recalculation Guide

## Overview

This guide explains how to recalculate all historical Glicko-2 ratings with the unified algorithm and 1-hour intervals.

**Status**: Ready to execute
**Estimated Duration**: 30-60 minutes (depending on data volume)
**Database Impact**: Updates `glickoRating` table in-place

---

## Prerequisites

✅ All code changes committed
✅ Database backups available
✅ New algorithm tested and validated
✅ Batch scripts ready in `scripts/calculateGlickoRatings-*.ts`

---

## Scripts Available

### 1. Fixed Batch Processing (Recommended for Initial Run)
**Script**: `scripts/calculateGlickoRatings-fixed.ts`
- Processes 30-day chunks chronologically
- Best for: Full dataset recalculation
- Handles: Large datasets efficiently
- Use this for initial production recalculation

**Command**:
```bash
npm run calculateGlickoRatings-fixed -- \
  --coins "BTC,ETH,ADA,DOT,LINK,UNI,AAVE,SOL" \
  --startDate "2020-01-01" \
  --endDate "2024-12-10" \
  --interval "1h"
```

### 2. High-Frequency Processing (Real-Time)
**Script**: `scripts/calculateGlickoRatings-5min.ts`
- Processes 5-minute intervals
- Best for: Real-time monitoring during trading
- Use this: After initial recalculation for continuous updates

**Command**:
```bash
npm run calculateGlickoRatings-5min -- \
  --coins "BTC,ETH,ADA,DOT,LINK,UNI,AAVE,SOL" \
  --lookbackHours "24"
```

### 3. Chunked Processing (Memory-Efficient)
**Script**: `scripts/calculateGlickoRatings-chunked.ts`
- Processes large datasets in 30-day chunks
- Best for: Very large historical datasets (4+ years)
- Memory efficient: Prevents heap overflow
- Use this: If running out of memory with fixed script

**Command**:
```bash
npm run calculateGlickoRatings-chunked -- \
  --coins "BTC,ETH,ADA,DOT,LINK,UNI,AAVE,SOL" \
  --startDate "2020-01-01" \
  --endDate "2024-12-10" \
  --chunkSize "30"
```

---

## Step-by-Step Recalculation Process

### Step 1: Backup Current Database

```bash
# Create backup of current glickoRating table
npm run db:backup -- --table "glickoRating" --output "backup-pre-recalc-$(date +%Y%m%d).sql"

# Verify backup
ls -lh backup-pre-recalc-*.sql
```

### Step 2: Verify Current Klines Data

```bash
# Check if klines data exists for target period
npm run db:query -- --sql "SELECT COUNT(*) FROM kline WHERE timestamp >= '2020-01-01' AND symbol LIKE '%USDT'"

# Expected output: Should show millions of records for 4+ years
```

### Step 3: Clear Existing Ratings (Optional - Only if re-running)

```bash
# CAUTION: Only run if starting fresh
npm run db:execute -- --sql "DELETE FROM glickoRating WHERE timestamp >= '2020-01-01'"
```

### Step 4: Run Recalculation

**For Initial Full Recalculation**:
```bash
# Start the fixed batch processing
npm run calculateGlickoRatings-fixed -- \
  --coins "BTC,ETH,ADA,DOT,LINK,UNI,AAVE,SOL" \
  --startDate "2020-01-01" \
  --endDate "2024-12-10" \
  --interval "1h" \
  --verbose

# Expected output:
# Processing BTC...
# Loaded 35,040 kline records
# Calculating Glicko ratings for 35,040 intervals
# Stored 35,040 rating records
# ... (repeat for each coin)
```

**Monitor Progress**:
```bash
# In another terminal, watch the database
npm run db:watch -- --interval "30s" --sql \
  "SELECT COUNT(*) as total_ratings, \
          COUNT(DISTINCT symbol) as symbols, \
          MAX(timestamp) as latest \
   FROM glickoRating"

# Example output every 30 seconds:
# total_ratings  symbols  latest
# 245,280        7        2021-06-15 12:00:00
```

### Step 5: Validate Results

```bash
# Run validation suite
npm run validate-batch-vs-live

# Expected output:
# ✅ Continuous Scaling Formula: 10/10 PASS
# ✅ Market Volatility: 3/3 PASS
# ✅ Dynamic Opponent Rating: 3/3 PASS
# ✅ Simplified Volatility: 4/4 PASS
# ✅ Core Functions: 4/4 PASS
# ✅ Full Updates: 5/5 PASS
# ✅ Performance: 2/2 PASS
# OVERALL: 41/41 PASS ✅
```

### Step 6: Verify Signal Parity

```bash
# Test signal generation consistency
npm run test-signal-parity

# Expected output:
# Loading 30-day historical Glicko ratings...
# Loaded 2,160 rating records
# Found 7 unique symbols
#
# === PARITY VALIDATION SUMMARY ===
# ✅ Algorithm Parity: CONFIRMED
# ✅ Signal Consistency: VALIDATED
# ✅ Z-Score Distribution: [min, max, avg]
```

---

## Estimated Timeline

| Phase | Duration | Action |
|-------|----------|--------|
| Backup | 2 min | Database backup |
| Verify | 2 min | Check klines data |
| Recalculate | 30-45 min | Run batch script |
| Validate | 5 min | Run validation suite |
| Verify Parity | 3 min | Check signal generation |
| **Total** | **42-57 min** | **Full recalculation** |

---

## Expected Database Changes

### Record Count by Period

```
Time Period        | Records Per Coin | 7 Coins | Rate
2020-2021 (1 yr)   | ~8,760          | 61,320  | ~57 /sec
2021-2022 (1 yr)   | ~8,760          | 61,320  | ~57 /sec
2022-2023 (1 yr)   | ~8,760          | 61,320  | ~57 /sec
2023-2024 (1 yr)   | ~8,760          | 61,320  | ~57 /sec
2024 (partial)     | ~2,000          | 14,000  | ~57 /sec
────────────────────────────────────────────────
TOTAL              | ~37,000         | 259,280 | ~57/sec
```

### Expected Performance

| Operation | Duration | Notes |
|-----------|----------|-------|
| Calculate 10,000 ratings | ~175ms | Single thread |
| Insert 10,000 records | ~500ms | Batch insert |
| Full 259,280 ratings | ~45 min | 7 coins × 4.5 years |

---

## Monitoring During Recalculation

### Watch Database Growth

```bash
# Monitor in real-time (every 10 seconds)
watch -n 10 'psql tradingbot -c "SELECT
  symbol,
  COUNT(*) as record_count,
  MAX(timestamp) as latest_timestamp
FROM glickoRating
GROUP BY symbol
ORDER BY symbol;"'
```

### Monitor System Resources

```bash
# Watch CPU and memory usage
top -p $(pgrep -f "calculateGlickoRatings-fixed") -u -n 1

# Watch disk I/O
iotop -o -b -n 1 2>/dev/null | grep node
```

### Monitor Application Logs

```bash
# Watch for errors in real-time
tail -f logs/glicko-calculation.log | grep -i "error\|warning"
```

---

## Troubleshooting

### Issue 1: Out of Memory

**Symptom**: Node process killed or "JavaScript heap out of memory"

**Solution**: Use chunked processing instead
```bash
npm run calculateGlickoRatings-chunked -- \
  --coins "BTC,ETH,ADA,DOT,LINK,UNI,AAVE,SOL" \
  --startDate "2020-01-01" \
  --endDate "2024-12-10" \
  --chunkSize "30"
```

### Issue 2: Database Connection Timeout

**Symptom**: "Error: connect TIMEOUT"

**Solution**: Check database connection
```bash
# Verify database is running
npm run db:ping

# Check connection pool
npm run db:status

# If needed, restart PostgreSQL
docker restart $(docker ps -f "name=postgres" -q)
```

### Issue 3: Missing Klines Data

**Symptom**: "No klines found for symbol BTC"

**Solution**: Sync klines first
```bash
npm run getKlines -- "BTC,ETH,ADA" "2020-01-01" "2024-12-10" --interval "1h"
```

### Issue 4: Duplicate Ratings

**Symptom**: Multiple ratings for same timestamp+symbol

**Solution**: Clear duplicates before recalculating
```bash
# Find duplicates
npm run db:query -- --sql "
SELECT symbol, timestamp, COUNT(*)
FROM glickoRating
GROUP BY symbol, timestamp
HAVING COUNT(*) > 1
LIMIT 10"

# Delete duplicates (keep most recent)
DELETE FROM glickoRating WHERE id NOT IN (
  SELECT MAX(id) FROM glickoRating
  GROUP BY symbol, timestamp
)
```

---

## Validation Checklist

Before considering recalculation complete:

- [ ] Backup created successfully
- [ ] Script completed without errors
- [ ] 259,280+ glickoRating records in database
- [ ] Latest timestamp is within 24 hours of now
- [ ] validation script: 41/41 tests passing
- [ ] test-signal-parity: Produces valid output
- [ ] Database integrity check passed
- [ ] Live trading engine tested against new ratings

---

## Post-Recalculation Steps

### 1. Update Live Engine

```bash
# Restart live trading engine to pick up new ratings
npm run stop-trading
npm run start-trading -- \
  --symbols "BTCUSDT,ETHUSDT,ADAUSDT,DOTUSDT,LINKUSDT,UNIUSDT,AAVEUSDT,SOLUSDT" \
  --interval "1h" \
  --testnet true
```

### 2. Run Quick Test

```bash
# Verify live engine reads new ratings
curl -s http://localhost:3000/api/trading/status | jq '.ratings'

# Expected: Shows current ratings from new calculation
```

### 3. Monitor First 24 Hours

```bash
# Watch for signal generation
tail -f logs/trading.log | grep -i "signal\|buy\|sell"

# Expected: Signals should match backtest signals
```

### 4. Verify Backtest Matches

```bash
# Run quick backtest comparison
npm run run-backtest -- \
  --baseAsset "BTC" \
  --startDate "2024-12-01" \
  --endDate "2024-12-10"

# Compare against live signals
npm run get-live-signals -- --asset "BTC" --days "10"

# Expected: Should match perfectly
```

---

## Success Criteria

✅ **Recalculation successful when**:
1. All 259,280+ ratings calculated and stored
2. Latest timestamp within 24 hours of now
3. 41/41 validation tests passing
4. Signal parity test produces valid output
5. Live engine reads and uses new ratings
6. Backtest signals match live signals
7. No errors in database or application logs
8. System performance metrics within acceptable range

---

## Recovery Procedure

If recalculation fails and you need to rollback:

```bash
# Stop live trading first
npm run stop-trading

# Restore from backup
npm run db:restore -- --backup "backup-pre-recalc-YYYYMMDD.sql"

# Verify restore
npm run db:query -- --sql "SELECT COUNT(*) FROM glickoRating"

# Restart trading
npm run start-trading
```

---

## Next Steps After Recalculation

1. **Historical Validation**: Compare backtests before/after
2. **Paper Trading**: Run 1 week of paper trading
3. **Live Testnet**: Deploy to live testnet for 48 hours
4. **Production Deployment**: After all validations pass

---

## References

- COMPLETION_SUMMARY.md - Overall project status
- GLICKO_SPEC.md - Algorithm details
- BACKTEST_SPEC.md - Backtest methodology
- PARITY_VALIDATION.md - System alignment verification

**Ready to recalculate. Execute when confirmed.**
