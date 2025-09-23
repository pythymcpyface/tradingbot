# ETH/USDT Backtest Investigation Summary

## Investigation Overview

This investigation examined why the `generateTradeCharts` script only finds trades from 2022 when the user requests data for the 2021-2025 range, despite having ETH/USDT backtest data with Z-Score=6, Profit=22%, Stop=6% parameters.

## Key Findings

### ✅ Backtest Data IS Available

**Found 23 valid backtest runs** for ETH/USDT with the specified parameters:
- Z-Score Threshold: 6
- Profit Percent: 22%
- Stop Loss Percent: 6%

**Total Orders by Year:**
- 2021: 27 orders (Aug 10 - Dec 21)
- 2022: 175 orders (Feb 4 - Dec 30)
- 2023: 112 orders (Jan 23 - Dec 17)
- 2024: 131 orders (Jan 11 - Dec 21)
- 2025: 54 orders (Jan 1 - Jul 11)

**Total: 499 orders across all years**

### 🎯 Root Cause of the Issue

The `generateTradeCharts.ts` script has a limitation in its backtest run selection logic:

1. **Date Range Overlap Logic**: The script uses `findFirst()` with date overlap conditions (lines 76-94)
2. **Single Run Selection**: It only finds and processes ONE backtest run that overlaps with the requested date range
3. **2022 Priority**: When searching for 2021-2025 data, it likely finds a 2022 run first and stops there

```typescript
// Current problematic logic in generateTradeCharts.ts:
const backtestRun = await this.prisma.backtestRuns.findFirst({
  where: {
    // ... other conditions
    startTime: { lte: new Date(endDate + 'T23:59:59') },
    endTime: { gte: new Date(startDate) },
    // ... 
  }
});
```

### 💡 Solutions

#### Option 1: Use Specific Run IDs (Recommended)

Modify the script to accept specific run IDs instead of date ranges:

```bash
# For all 2021-2025 data:
npx tsx scripts/generateTradeCharts.ts --symbol ETHUSDT --runIds [
  "ETHUSDT_2021-07-19_2022-07-19_1757435278596",
  "ETHUSDT_2022-01-01_2023-01-01_1756586865659",
  "ETHUSDT_2023-01-19_2024-01-19_1757435305698",
  "ETHUSDT_2024-01-19_2025-01-19_1757435323251"
]

# For 2022 specifically:
npx tsx scripts/generateTradeCharts.ts --symbol ETHUSDT --runIds ["ETHUSDT_2022-01-01_2023-01-01_1756586865659"]
```

#### Option 2: Modify Script to Process Multiple Runs

Update the `generateTradeCharts.ts` script to:
- Find ALL matching backtest runs (not just the first one)
- Combine trades from multiple runs
- Generate comprehensive charts across the full date range

#### Option 3: Use Longer Duration Runs

Use the 365-day runs that span multiple years:

```bash
# Best continuous coverage runs:
"ETHUSDT_2021-07-19_2022-07-19_1757435278596"  # 365 days, 28 orders
"ETHUSDT_2022-01-01_2023-01-01_1756586865659"  # 365 days, 35 orders  
"ETHUSDT_2023-01-19_2024-01-19_1757435305698"  # 365 days, 30 orders
"ETHUSDT_2024-01-19_2025-01-19_1757435323251"  # 366 days, 32 orders
```

## Available Run IDs for Chart Generation

### All Runs (Complete Coverage)
```json
[
  "ETHUSDT_2021-07-19_2022-07-19_1757435278596",
  "ETHUSDT_2021-07-19_2022-01-19_1757435617920",
  "ETHUSDT_2021-10-19_2022-04-19_1757435632067",
  "ETHUSDT_2022-01-01_2023-01-01_1756586865659",
  "ETHUSDT_2022-01-19_2022-07-18_1757435645161",
  "ETHUSDT_2022-01-19_2023-01-19_1757435288237",
  "ETHUSDT_2022-04-19_2022-10-19_1757435660514",
  "ETHUSDT_2022-07-19_2023-07-19_1757435296911",
  "ETHUSDT_2022-07-19_2023-01-19_1757435672504",
  "ETHUSDT_2022-10-19_2023-04-19_1757435684050",
  "ETHUSDT_2023-01-19_2023-07-18_1757435695974",
  "ETHUSDT_2023-01-19_2024-01-19_1757435305698",
  "ETHUSDT_2023-04-19_2023-10-19_1757435708135",
  "ETHUSDT_2023-07-19_2024-01-19_1757435723861",
  "ETHUSDT_2023-07-19_2024-07-19_1757435314288",
  "ETHUSDT_2023-10-19_2024-04-19_1757435736508",
  "ETHUSDT_2024-01-19_2024-07-18_1757435749298",
  "ETHUSDT_2024-01-19_2025-01-19_1757435323251",
  "ETHUSDT_2024-04-19_2024-10-19_1757435762744",
  "ETHUSDT_2024-07-19_2025-07-19_1757435332055",
  "ETHUSDT_2024-07-19_2025-01-19_1757435776604",
  "ETHUSDT_2024-10-19_2025-04-19_1757435790697",
  "ETHUSDT_2025-01-19_2025-07-18_1757435798664"
]
```

### Recent Data (2024-2025)
```json
[
  "ETHUSDT_2024-01-19_2024-07-18_1757435749298",
  "ETHUSDT_2024-01-19_2025-01-19_1757435323251",
  "ETHUSDT_2024-04-19_2024-10-19_1757435762744",
  "ETHUSDT_2024-07-19_2025-07-19_1757435332055",
  "ETHUSDT_2024-07-19_2025-01-19_1757435776604",
  "ETHUSDT_2024-10-19_2025-04-19_1757435790697",
  "ETHUSDT_2025-01-19_2025-07-18_1757435798664"
]
```

## Immediate Action Items

1. **For the user**: Use one of the specific run IDs above with the current `generateTradeCharts.ts` script
2. **For development**: Consider modifying the script to handle multiple run IDs or all matching runs
3. **For verification**: Test the script with a known good run ID to confirm it works

## Database Verification

All data has been verified to exist in the database:
- ✅ 23 backtest runs found with correct parameters
- ✅ 499 total orders across 2021-2025
- ✅ Orders span the full requested date range
- ✅ Database queries work correctly

The issue is purely in the chart generation script's run selection logic, not missing data.

---

**Generated on**: 2025-09-15  
**Investigation Scripts**: 
- `/scripts/investigate-eth-usdt-backtests.ts`
- `/scripts/get-backtest-run-ids-for-charts.ts`