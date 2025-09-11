# Quick Start Guide - Live Trading with 33.3% Allocation Strategy

## Summary

Your trading bot is now configured with a sophisticated allocation management system that handles your 33.3% allocation strategy perfectly. Here's how it works and how to start it.

## Your Configuration

✅ **Updated**: `config/live-params.json` with 33.3% allocations
✅ **Added**: AllocationManager for fund reservation system  
✅ **Added**: Enhanced TradingEngine with allocation tracking
✅ **Added**: Dedicated startup script with monitoring

## How It Works

### 1. Fund Allocation Strategy
```
Account Balance: $1000 (example)
├── BTC Reserve: $333.33 (33.3%) - Threshold Z≥5.0, TP:+15%, SL:-2%
├── BNB Reserve: $333.33 (33.3%) - Threshold Z≥7.0, TP:+20%, SL:-30%
└── ETH Reserve: $333.33 (33.3%) - Threshold Z≥6.0, TP:+22%, SL:-6%
```

### 2. Smart Allocation Management
- **Reserve First**: Funds reserved before trade execution
- **No Conflicts**: Prevents over-allocation even with concurrent signals
- **Track Everything**: Complete monitoring of reserved vs available funds
- **Auto Release**: Funds released when positions close (OCO or Z-score reversal)

### 3. Trading Flow
```
Signal Triggered → Reserve Funds → Execute Trade → Place OCO → Monitor Position → Release Funds
```

## Quick Start Commands

### Test with Paper Trading (Recommended First)
```bash
# Test your allocation strategy safely
npm run startPaperTradingParams
```

### Start Live Trading
```bash
# Uses your config/live-params.json automatically
npm run startLiveTrading
```

### Alternative Commands
```bash
# Original method (still works)
npm run startTrading -- --parameterSets=config/live-params.json

# Paper trading with original method
npm run startTrading -- --paper --parameterSets=config/live-params.json
```

## What You'll See

### Startup Analysis
```
🎯 Starting Live Trading with Parameter Sets...
======================================================================
💰 LIVE TRADING MODE - Real money will be used!

🔧 Loading configuration...
✅ Loaded 3 parameter sets

📊 Allocation Analysis:
   BTCUSDT: 33.3% (Z≥5, TP:+15%, SL:-2%)
   BNBUSDT: 33.3% (Z≥7, TP:+20%, SL:-30%)
   ETHUSDT: 33.3% (Z≥6, TP:+22%, SL:-6%)
   Total Allocation: 99.9%

💰 Account Analysis:
   USDT Balance: $1000.00

🎯 Position Size Preview:
   BTCUSDT: $333.00 (33.3%)
   BNBUSDT: $333.00 (33.3%)
   ETHUSDT: $333.00 (33.3%)
```

### Live Trading Output
```
🚀 Live trading engine started successfully!
📊 Monitoring for Z-score signals with allocation management...

📊 [2024-01-15 10:05:00] Signals: 8 total, 1 strong
💼 Reserved $333.30 (33.3%) for BTCUSDT
🔥 LIVE BUY: BTCUSDT - Market order executed
   Order ID: 12345
   Quantity: 0.007854
   Average Price: $42,000.00
   Allocated: $333.30 (33.3%)
🎯 OCO ORDER PLACED for BTCUSDT:
   OCO Order ID: 67890
   Take Profit: $48,300 (+15%)
   Stop Loss: $41,160 (-2%)

💼 Allocation: 33.3% used ($333.30/$1000.00)
```

### Allocation Status Updates
```
💼 Allocation Status: 66.6% used (2 active positions)
   BTCUSDT: $333.30 reserved
   ETHUSDT: $333.30 reserved
```

## Safety Features Built-In

### 1. No Over-Allocation
- ✅ Prevents spending more than allocated per symbol
- ✅ Handles concurrent signals safely
- ✅ Reserves funds before execution

### 2. Position Management  
- ✅ One position per symbol maximum
- ✅ OCO orders placed immediately after buy
- ✅ Z-score reversal detection for early exits

### 3. Fund Recovery
- ✅ Funds released automatically on position close
- ✅ Emergency clear function available
- ✅ Complete audit trail in logs

### 4. Risk Controls
- ✅ Account balance validation
- ✅ Minimum position size checks  
- ✅ Graceful error handling
- ✅ 10-second confirmation for live trading

## Emergency Commands

### Clear All Allocations (if needed)
```javascript
// In emergency, clear all reservations
await tradingEngine.clearAllAllocations();
```

### Check Allocation Status
```javascript
// Monitor current allocation status
const status = tradingEngine.getAllocationStatus();
console.log(JSON.stringify(status, null, 2));
```

## Expected Behavior

With your 33.3% allocation strategy:

1. **BTC Signal (Z≥5.0)**: Reserves $333.30, buys BTC, places OCO (+15%/-2%)
2. **BNB Signal (Z≥7.0)**: Reserves $333.30, buys BNB, places OCO (+20%/-30%) 
3. **ETH Signal (Z≥6.0)**: Reserves $333.30, buys ETH, places OCO (+22%/-6%)

Each position is independent with its own:
- ✅ Reserved funds (prevents conflicts)
- ✅ Parameter set (different thresholds/targets)  
- ✅ OCO orders (automatic profit/loss management)
- ✅ Z-score reversal monitoring (early exit capability)

## Files Created/Modified

### New Files
- ✅ `src/services/AllocationManager.ts` - Fund reservation system
- ✅ `scripts/startLiveTrading.ts` - Dedicated startup script
- ✅ `docs/ALLOCATION_STRATEGY_GUIDE.md` - Detailed guide
- ✅ `docs/QUICK_START_GUIDE.md` - This file

### Modified Files  
- ✅ `config/live-params.json` - Changed to 33.3% allocations
- ✅ `src/node-api/services/TradingEngine.ts` - Added allocation management
- ✅ `package.json` - Added startup scripts (already existed)

## Ready to Go!

Your system is now configured for safe, concurrent trading with proper fund allocation. The 33.3% allocation strategy will work perfectly without conflicts.

**Start with paper trading first** to see the allocation system in action:
```bash
npm run startPaperTradingParams
```

Then when you're ready for live trading:
```bash
npm run startLiveTrading
```