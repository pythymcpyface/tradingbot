# Glicko Validation Quick Reference

**Updated**: December 11, 2024
**Version**: 2.0 (Enhanced with 8+ checks)

---

## Quick Start

### Run Validation
```bash
npx ts-node scripts/validate-glicko-integrity.ts
```

### Save Results to File
```bash
npx ts-node scripts/validate-glicko-integrity.ts > validation-results.txt
```

---

## What Gets Validated

### ✅ Data Quality Checks (Original 6)
1. **Data Types** - Verifies all fields have correct types
2. **Value Ranges** - Confirms ratings, RD, volatility are within bounds
3. **Consistency** - Checks for duplicates and logical errors
4. **Statistics** - Analyzes distributions and patterns
5. **Anomalies** - Detects statistical outliers
6. **Algorithm** - Verifies continuous scaling implementation

### ✅ Integrity Checks (NEW - 8)
7. **Row Count** - Expects exactly 21 records (all expected coins)
8. **Datetime Gaps** - Confirms no gaps in timestamp sequences
9. **All Coins Present** - Verifies all 21 coins have ratings
10. **Rating Drift** - Detects if any coin's rating increases/decreases constantly
11. **Deviation Drift** - Detects if any coin's RD increases/decreases constantly
12. **Average Stability** - Checks if portfolio average is drifting
13. **Volatility Bounds** - Confirms volatility at 0.01-0.2 range
14. **Anomaly Detection** - Z-score analysis for outliers (>3σ)

---

## Expected Results

### Current Status (December 10, 2024)

```
✅ Status: 18/21 coins complete (3 missing BTC, ETH, USDT)

Validation Breakdown:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Data Types:           PASS (18/18 records valid)
✅ Value Ranges:        PASS (all within bounds)
✅ Consistency:         PASS (no errors)
❌ Row Count:           FAIL (18/21 - missing 3)
✅ Datetime Gaps:       PASS (no gaps)
⚠️  All Coins Present:   INCOMPLETE (3 missing)
✅ Rating Drift:        PASS (no drifting)
✅ Deviation Drift:     PASS (no drifting)
✅ Average Stability:   PASS (stable)
✅ Anomalies:           CLEAN (0 detected)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Statistics:
- Rating:     2200.00 (all uniform, expected for initial calc)
- RD:         50.00-106.66 (μ=60.72, σ=16.90)
- Volatility: 0.2000 (maximum, expected for new ratings)
```

### After Completing Missing Data

```
✅ Status: 21/21 coins complete - PRODUCTION READY

Validation Breakdown:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Data Types:           PASS (21/21 records valid)
✅ Value Ranges:        PASS (all within bounds)
✅ Consistency:         PASS (no errors)
✅ Row Count:           PASS (21/21 - complete)
✅ Datetime Gaps:       PASS (no gaps)
✅ All Coins Present:   PASS (0 missing)
✅ Rating Drift:        PASS (no drifting)
✅ Deviation Drift:     PASS (no drifting)
✅ Average Stability:   PASS (stable)
✅ Anomalies:           CLEAN (0 detected)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Next Steps to Completion

### Step 1: Fetch Missing Data (5 minutes)
```bash
npm run getKlines -- "BTC,ETH,USDT"
```

### Step 2: Calculate Glicko Ratings (2-5 minutes)
```bash
BASE_COINS="BTC,ETH,USDT,BNB,SOL,XRP,DOGE,ADA,TRX,AVAX,DOT,LINK,BCH,NEAR,LTC,ETC,HBAR,XLM,ATOM,VET,AAVE" \
npm run calculateGlickoRatings
```

### Step 3: Verify Completion (1 minute)
```bash
npx ts-node scripts/validate-glicko-integrity.ts
```

### Step 4: Confirm All Green ✅
Should show: **Status: PASS** with all 14+ checks passing

---

## Understanding the Output

### Overall Status Line
```
Status: FAIL  ← Fails if ANY check fails
Status: PASS  ← All checks pass
```

### Per-Check Format
```
✅ PASS     - Check passed, no issues
❌ FAIL     - Check failed, has issues
⚠️  WARNING  - Check incomplete or has warnings
```

### Statistics Section
```
Rating:      2200.00 - 2200.00 (μ=2200.00, σ=0.00)
             └─ min  └─ max    └─ mean   └─ standard deviation

RD:          50.00 - 106.66 (μ=60.72, σ=16.90)
             └─ min └─ max   └─ mean  └─ standard deviation

Volatility:  0.2000 - 0.2000 (μ=0.2000, σ=0.0000)
             └─ min  └─ max   └─ mean   └─ standard deviation
```

### Drift Detection Details
If drifts found, shows:
```
RATING DRIFT DETECTION
  Status: ❌ FAIL
    - BTC: increasing (slope=2.45)
    - ETH: decreasing (slope=-1.23)
```

Explains:
- Symbol that's drifting
- Direction (increasing/decreasing)
- Slope value (rate of change per step)

---

## Key Metrics to Monitor

### Ratings
- **Expected**: 0-4000 range (typical for Glicko-2)
- **Currently**: All 2200 (baseline for new system)
- **Health**: ✅ Good (will diverge after more data)

### Rating Deviation (RD)
- **Expected**: 0-350 range
- **Currently**: 50-107
- **Health**: ✅ Good (indicates confidence levels)

### Volatility
- **Expected**: 0.01-0.2 range
- **Currently**: All 0.2 (maximum)
- **Health**: ✅ Good (expected for new ratings, will decrease)

### Z-Score (Anomalies)
- **Healthy**: Z-score < 3σ from mean
- **Currently**: 0 outliers detected
- **Health**: ✅ Clean (normal distribution)

---

## Common Scenarios

### Scenario 1: All Checks Pass ✅
```
Status: PASS

→ System is healthy and production-ready
→ Data has no corruption or anomalies
→ Safe to use for signal generation and trading
```

### Scenario 2: Missing Data Warning ⚠️
```
Status: FAIL
Row Count: Expected 21, got 18
Missing: BTC, ETH, USDT

→ Some coins lack klines data
→ Fetch missing data and recalculate
→ Expected: npm run getKlines -- "BTC,ETH,USDT"
```

### Scenario 3: Drift Detected ⚠️
```
Status: FAIL
Rating Drift Detected:
  - BTC: increasing (slope=2.45)

→ BTC rating is increasing by ~2.45 per step
→ Check if this is algorithmic issue or expected behavior
→ May indicate market trend captured in ratings
```

### Scenario 4: Type Mismatch ❌
```
Status: FAIL
Data Type Validation: 3 issues
  - Invalid rating type in record abc123
  - Invalid RD type in record def456

→ Database may have corruption
→ Check field types in schema
→ May need data repair
```

---

## Interpretation Guide

### Row Count Check
- ✅ PASS: All 21 coins have at least one rating record
- ❌ FAIL: Missing coins (check which ones in output)
- ⚠️ WARNING: Some coins missing klines data

### Datetime Gaps Check
- ✅ PASS: All timestamps in chronological order, no missing dates
- ❌ FAIL: Out-of-order timestamps or reversed dates
- Note: Single-period data is OK (no gaps expected)

### All Coins Check
- ✅ PASS: All 21 expected coins present
- ❌ FAIL: Lists specific coins missing
- Action: Fetch klines for missing coins

### Rating/Deviation Drift Check
- ✅ PASS: No coins showing constant increase/decrease
- ❌ FAIL: Lists which coins are drifting and slope value
- Action: Investigate if expected or algorithmic issue

### Average Stability Check
- ✅ PASS: Portfolio average is stable
- ⚠️ WARNING: Small trend detected but not critical
- ❌ FAIL: Significant average drift detected

### Anomaly Detection
- ✅ CLEAN: No outliers (Z-score > 3σ)
- ⚠️ DETECTED: Shows which values are outliers
- Note: Can indicate data corruption or extreme market moves

---

## Files Referenced

### Main Validation Script
- `scripts/validate-glicko-integrity.ts` (900+ lines)

### Documentation
- `ENHANCED_INTEGRITY_VALIDATION.md` - Detailed report
- `FINAL_VALIDATION_SUMMARY.md` - Complete summary
- `VALIDATION_QUICK_REFERENCE.md` - This file

### Supporting Docs
- `GLICKO_INTEGRITY_REPORT.md` - Original technical report
- `INTEGRITY_VALIDATION_COMPLETE.md` - Original completion summary

---

## Troubleshooting

### Q: Validation script won't run
**A**: Make sure you're in project root and have dependencies installed
```bash
npm install
npx ts-node scripts/validate-glicko-integrity.ts
```

### Q: Row count always fails
**A**: Expected if missing klines data. Fetch it first:
```bash
npm run getKlines -- "BTC,ETH,USDT"
npm run calculateGlickoRatings
```

### Q: Getting type errors
**A**: Make sure Prisma is generated:
```bash
npx prisma generate
npx ts-node scripts/validate-glicko-integrity.ts
```

### Q: Sees "No glicko ratings found"
**A**: Database might be empty or disconnected:
```bash
# Check database connection
npm run db:query -- --sql "SELECT COUNT(*) FROM \"GlickoRatings\""

# If empty, need to run calculation
npm run calculateGlickoRatings
```

---

## Quick Decision Tree

```
Run Validation
    ↓
Status: PASS?
    ├─ YES → ✅ All good! System is healthy
    └─ NO → Check what failed?
              ├─ Row Count? → Fetch missing klines data
              ├─ Coins Present? → Same as above
              ├─ Data Types? → Database corruption - investigate
              ├─ Value Ranges? → Out-of-bounds values - check algorithm
              ├─ Drift? → Investigate market conditions or algorithm
              ├─ Consistency? → Duplicate data or logic error
              ├─ Anomalies? → Check for outlier conditions
              └─ Other? → See detailed report in console output
```

---

## Remember

✅ **Good Signs**:
- All checks show ✅ PASS
- Statistics show expected values
- No anomalies detected
- Drift checks pass

⚠️ **Warning Signs** (Usually fixable):
- Missing coins (fetch klines data)
- Row count mismatch (same fix)
- Small drifts (monitor but not critical)

❌ **Critical Signs** (Need investigation):
- Type mismatches (data corruption)
- Value ranges violated (algorithm issue)
- Severe drifts (market anomaly or bug)
- Massive anomalies (data quality issue)

---

**Quick Reference Version**: 2.0
**Last Updated**: December 11, 2024
**Status**: ✅ Ready to use
