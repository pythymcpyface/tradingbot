# Real Binance OCO Trading System

## Overview

The trading bot now uses **actual Binance OCO (One-Cancels-Other) orders** instead of virtual monitoring. When a BUY signal triggers, the system:

1. **Places a market BUY order** immediately
2. **Places a real Binance OCO sell order** with take profit and stop loss
3. **Monitors Z-score for reversal** - if detected, cancels OCO and executes market sell

## How Real OCO Orders Work

### OCO Order Structure

An OCO order contains **two conditional sell orders** that automatically cancel each other:

```typescript
// OCO Order Components
{
  orderListId: "12345",  // OCO group identifier
  orders: [
    {
      orderId: "67890",    // Take Profit: LIMIT sell order
      side: "SELL",
      type: "LIMIT_MAKER",
      price: "4667.72",    // +1% from entry
      quantity: "0.714"
    },
    {
      orderId: "67891",    // Stop Loss: STOP_LIMIT sell order  
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      price: "4482.86",    // Stop limit price
      stopPrice: "4482.86", // -3% from entry (trigger)
      quantity: "0.714"
    }
  ]
}
```

### Trade Execution Flow

#### Step 1: BUY Signal Triggered
```typescript
// Z-score exceeds threshold (+0.5)
const signal = {
  symbol: 'ETHUSDT',
  zScore: 1.234,
  signal: 'BUY',
  timestamp: new Date()
};
```

#### Step 2: Market BUY Order
```typescript
const buyOrder = await binanceService.placeOrder({
  symbol: 'ETHUSDT',
  side: 'BUY',
  type: 'MARKET',
  quoteOrderQty: '1000.00'  // $1000 allocation
});

// Response:
{
  orderId: "123456",
  executedQty: "0.21643",      // ETH received
  cummulativeQuoteQty: "1000.00", // USDT spent
  avgPrice: 4621.50            // Average execution price
}
```

#### Step 3: Immediate OCO Sell Order
```typescript
// Calculate OCO prices from actual execution price
const avgPrice = 4621.50;  // From buy order
const takeProfitPrice = avgPrice * 1.01;   // 4667.72 (+1%)
const stopLossPrice = avgPrice * 0.97;     // 4482.86 (-3%)

const ocoOrder = await binanceService.placeOcoOrder(
  'ETHUSDT',
  'SELL',
  '0.21643',        // Exact quantity from buy order
  '4667.72',        // Take profit price
  '4482.86',        // Stop price
  '4482.86'         // Stop limit price
);
```

#### Step 4: Position Tracking
```typescript
const activePosition = {
  symbol: 'ETHUSDT',
  entryPrice: 4621.50,
  quantity: 0.21643,
  entryTime: new Date(),
  buyOrderId: "123456",
  ocoOrderId: "789012",          // OCO group ID
  takeProfitOrderId: "789013",   // Individual TP order
  stopLossOrderId: "789014",     // Individual SL order
  takeProfitPrice: 4667.72,
  stopLossPrice: 4482.86,
  parameters: parameterSet,
  zScoreThreshold: 0.5
};
```

## Z-Score Reversal Override

### Reversal Detection Process

Every 5-minute monitoring cycle:

```typescript
// Calculate new Z-score
const currentZScore = (newRating - crossCoinMean) / crossCoinStdDev;
const newMovingAverage = updateZScoreHistory(currentZScore);

// Check for reversal (crosses negative threshold)
if (newMovingAverage <= -params.zScoreThreshold) {
  // -1.234 <= -0.5 ✓ REVERSAL DETECTED
  await handleZScoreReversal(symbol, position);
}
```

### Reversal Execution

When Z-score reversal is detected:

```typescript
async function handleZScoreReversal(symbol: string, position: ActivePosition) {
  try {
    // Step 1: Cancel the OCO order immediately
    console.log(`🚫 Cancelling OCO order: ${position.ocoOrderId}`);
    await binanceService.cancelOrder(symbol, position.ocoOrderId);
    
    // Step 2: Execute market sell for entire position
    console.log(`💥 Market sell due to Z-score reversal`);
    const sellOrder = await binanceService.placeOrder({
      symbol: symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: position.quantity.toString()
    });
    
    // Step 3: Calculate P&L
    const exitValue = parseFloat(sellOrder.cummulativeQuoteQty);
    const entryValue = position.quantity * position.entryPrice;
    const pnl = exitValue - entryValue;
    const pnlPercent = (pnl / entryValue) * 100;
    
    console.log(`✅ Position closed: P&L = $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
    
    // Step 4: Remove from active positions
    activePositions.delete(symbol);
    
  } catch (error) {
    console.error(`❌ Error handling reversal for ${symbol}:`, error);
  }
}
```

## Real-World Example

### Complete Trade Lifecycle: ETHUSDT

#### 🎯 **Signal Generation (09:15:00)**
```
ETH Z-Score: +1.234 (above threshold +0.5)
Cross-coin statistics: Mean=1511.5, StdDev=61.13
Moving average Z-score: +1.234
→ BUY SIGNAL GENERATED
```

#### 🔥 **Market Buy Execution (09:15:02)**
```
API Call: POST /api/v3/order
{
  "symbol": "ETHUSDT",
  "side": "BUY", 
  "type": "MARKET",
  "quoteOrderQty": "3300.00"
}

Response:
{
  "orderId": 891847293,
  "executedQty": "0.71405387",
  "cummulativeQuoteQty": "3300.00", 
  "avgPrice": 4621.50,
  "status": "FILLED"
}

✅ BUY FILLED: 0.714 ETH @ $4621.50 average
```

#### 🎯 **OCO Order Placement (09:15:03)**
```
API Call: POST /api/v3/order/oco
{
  "symbol": "ETHUSDT",
  "side": "SELL",
  "quantity": "0.71405387",
  "price": "4667.72",        // +1% take profit
  "stopPrice": "4482.86",    // -3% stop loss trigger
  "stopLimitPrice": "4482.86"
}

Response:
{
  "orderListId": 8234627,
  "orders": [
    {
      "orderId": 891847294,    // Take profit order
      "type": "LIMIT_MAKER"
    },
    {
      "orderId": 891847295,    // Stop loss order
      "type": "STOP_LOSS_LIMIT"
    }
  ]
}

✅ OCO ACTIVE: TP=$4667.72 | SL=$4482.86
```

#### 📊 **Position Monitoring (09:15:00 - 09:40:00)**
```
09:20: ETH=$4635.20 | P&L=+$9.78 | Z-score=+0.89  ✓ Healthy
09:25: ETH=$4598.10 | P&L=-$16.73 | Z-score=+0.45  ✓ Above threshold  
09:30: ETH=$4612.35 | P&L=-$6.54 | Z-score=+0.23   ✓ Positive
09:35: ETH=$4645.80 | P&L=+$17.42 | Z-score=-0.12  ⚠️ Declining
09:40: ETH=$4591.25 | P&L=-$21.65 | Z-score=-0.67  🚨 REVERSAL!
```

#### 🔄 **Z-Score Reversal Triggered (09:40:15)**
```
Z-score moving average: -0.67 <= -0.5 threshold
→ REVERSAL DETECTED!

Step 1 - Cancel OCO:
API Call: DELETE /api/v3/orderList
{
  "symbol": "ETHUSDT", 
  "orderListId": 8234627
}
✅ OCO order cancelled

Step 2 - Market Sell:
API Call: POST /api/v3/order
{
  "symbol": "ETHUSDT",
  "side": "SELL",
  "type": "MARKET", 
  "quantity": "0.71405387"
}

Response:
{
  "orderId": 891847296,
  "executedQty": "0.71405387",
  "cummulativeQuoteQty": "3278.46",
  "avgPrice": 4591.25,
  "status": "FILLED"
}

✅ REVERSAL SELL: 0.714 ETH @ $4591.25 average
💰 Final P&L: -$21.54 (-0.65%)
```

#### 📋 **Trade Summary**
```
Entry: $4621.50 (Market Buy)
Exit:  $4591.25 (Reversal Market Sell)
Reason: Z-Score Reversal (-0.67 <= -0.5)
Duration: 25 minutes
P&L: -$21.54 (-0.65%)

OCO Orders Created: ✅
OCO Orders Cancelled: ✅ (Due to reversal)
Natural OCO Exit: ❌ (Overridden by reversal)
```

## System Advantages

### 🎯 **Real Market Integration**
- **Actual Binance orders**: Not simulated
- **Real fills and slippage**: Accurate execution prices
- **True OCO behavior**: Orders automatically cancel each other
- **Market maker fees**: Real trading costs included

### ⚡ **Speed & Reliability**
- **Immediate OCO placement**: No delay after buy fill
- **Binance infrastructure**: Professional order matching
- **Automatic execution**: No manual intervention needed
- **24/7 operation**: Works continuously

### 🛡️ **Risk Management**
- **Position limits**: Configurable allocation percentages
- **Stop losses**: Hard limits on downside risk
- **Reversal detection**: Strategy-based early exit
- **Emergency stops**: Manual override capability

### 📊 **Transparency**
- **Order IDs**: Full audit trail
- **Real-time status**: Live position monitoring
- **Complete logging**: Every action recorded
- **Performance metrics**: Actual P&L tracking

## Configuration

### Parameter Set Structure
```typescript
{
  symbol: 'ETHUSDT',
  zScoreThreshold: 0.5,      // Signal trigger level
  profitPercent: 1.0,        // OCO take profit %
  stopLossPercent: 3.0,      // OCO stop loss %
  allocationPercent: 10.0,   // Position size %
  movingAverages: 5,         // Z-score smoothing periods
  enabled: true
}
```

### Risk Management Settings
```typescript
{
  enableLiveTrading: true,   // Enable real orders
  maxPositions: 3,          // Position limit
  maxDailyLoss: 500,        // Daily loss limit ($)
  maxDrawdown: 0.1,         // 10% maximum drawdown
  cooldownPeriod: 60        // Minutes between failed attempts
}
```

## Testing & Deployment

### Testnet Testing
```bash
# Set testnet credentials
export BINANCE_TESTNET_API_KEY="your_testnet_key"
export BINANCE_TESTNET_API_SECRET="your_testnet_secret"

# Run OCO testing script
npx tsx scripts/test-live-oco-trading.ts
```

### Production Deployment
```bash
# Set live credentials (CAUTION!)
export BINANCE_API_KEY="your_live_key"  
export BINANCE_API_SECRET="your_live_secret"

# Start live trading
npm run startLiveTrading -- --parameterSets=./trading_param_sets.json
```

### Safety Measures
- ✅ **Start with testnet**: Verify behavior before live trading
- ✅ **Small allocations**: Use 1-5% position sizes initially
- ✅ **Monitor closely**: Watch first few trades carefully
- ✅ **Emergency stops**: Keep manual override available
- ✅ **Position limits**: Set conservative maximum positions

## Conclusion

The real OCO implementation provides:
- **True algorithmic trading** with professional infrastructure
- **Automated risk management** through OCO orders
- **Strategic flexibility** with Z-score reversal overrides
- **Complete transparency** with full order tracking

This represents a significant evolution from paper trading to a production-ready algorithmic trading system that can operate autonomously while maintaining strict risk controls.

**Remember**: Always test thoroughly on testnet before deploying with real capital!