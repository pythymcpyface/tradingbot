# Paper Trading System - Complete Implementation

## Overview

The paper trading system simulates real cryptocurrency trading with virtual positions, providing a risk-free environment to test trading strategies. When a BUY signal is triggered, it creates mock positions with OCO (One-Cancels-Other) logic for automated profit/loss management.

## How Paper Trading Works

### 1. Signal Detection & Entry

When a **BUY signal** is triggered (Z-score moving average exceeds threshold):

```typescript
// Calculate position size based on allocation percentage
const allocationAmount = paperTradingBalance * (parameters.allocationPercent / 100);
const quantity = allocationAmount / currentPrice;

// Create virtual position with OCO prices
const paperPosition: PaperPosition = {
  symbol: 'ETHUSDT',
  entryPrice: 2000.00,
  quantity: 0.5,
  entryTime: new Date(),
  takeProfitPrice: 2040.00,  // +2% profit target
  stopLossPrice: 1980.00,    // -1% stop loss
  parameters: parameterSet,
  entryValue: 1000.00        // $1000 allocation
};
```

**What happens:**
- 📊 Virtual balance is debited by the allocation amount
- 🎯 Take profit and stop loss prices are calculated automatically
- 📝 Position is stored in `paperPositions` Map
- 📋 Transaction is logged for tracking

### 2. Position Monitoring & OCO Logic

Every monitoring cycle (5 minutes), the system:

```typescript
// Update unrealized P&L
const currentValue = position.quantity * currentPrice;
position.unrealizedPnL = currentValue - position.entryValue;
position.unrealizedPnLPercent = (unrealizedPnL / entryValue) * 100;

// Check OCO conditions
if (currentPrice >= position.takeProfitPrice) {
  await closePaperPosition(symbol, currentPrice, 'TAKE_PROFIT');
} else if (currentPrice <= position.stopLossPrice) {
  await closePaperPosition(symbol, currentPrice, 'STOP_LOSS');
}
```

**OCO (One-Cancels-Other) Logic:**
- 🎯 **Take Profit**: Automatically closes position when price reaches profit target
- 🛑 **Stop Loss**: Automatically closes position when price hits stop loss
- ⚡ **First condition met cancels the other** (hence "One-Cancels-Other")

### 3. Z-Score Reversal Detection

The system also monitors for Z-score reversals:

```typescript
// Check if Z-score has reversed (crossed negative threshold)
if (currentZScore <= -params.zScoreThreshold) {
  console.log(`📝 PAPER POSITION: Z-score reversal detected for ${symbol}`);
  const currentPrice = await binanceService.getCurrentPrice(symbol);
  await closePaperPosition(symbol, currentPrice, 'Z_SCORE_REVERSAL');
}
```

**Reversal Logic:**
- 📉 If Z-score drops below negative threshold (-0.5 for example)
- 🚨 Triggers immediate position closure regardless of OCO conditions
- 🎭 Simulates "market sell" behavior in real trading

### 4. Position Closure & P&L Calculation

When any exit condition is met:

```typescript
const exitValue = position.quantity * currentPrice;
const pnl = exitValue - position.entryValue;
const pnlPercent = (pnl / position.entryValue) * 100;

// Return funds to virtual balance
paperTradingBalance += exitValue;

// Log the trade result
console.log(`📝 PAPER TRADE SELL: ${symbol} at $${currentPrice}`);
console.log(`   P&L: $${pnl.toFixed(2)} (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
```

## Virtual Account Management

### Starting Balance
- 💰 **Initial Balance**: $10,000 virtual USD
- 📊 **Position Limits**: Respects allocation percentages from parameter sets
- ⚖️ **Risk Management**: Prevents over-allocation

### Portfolio Tracking
```typescript
{
  balance: 8500.00,           // Available cash
  positions: [position1, position2], // Active positions
  totalValue: 10150.00,       // Balance + position values
  totalUnrealizedPnL: 150.00  // Total unrealized profit/loss
}
```

## Real-World Example Scenario

### Scenario: ETHUSDT Trade
1. **Signal Triggered** (Z-score: +0.6, threshold: 0.5)
   - ETH price: $2,000
   - Allocation: 10% = $1,000
   - Quantity: 0.5 ETH
   - Take profit: $2,040 (+2%)
   - Stop loss: $1,980 (-1%)

2. **Price Movement Options:**
   - **Option A - Take Profit Hit**: Price reaches $2,040
     - Exit value: 0.5 × $2,040 = $1,020
     - P&L: +$20 (+2%)
     - New balance: $9,020
   
   - **Option B - Stop Loss Hit**: Price drops to $1,980  
     - Exit value: 0.5 × $1,980 = $990
     - P&L: -$10 (-1%)
     - New balance: $8,990
   
   - **Option C - Z-Score Reversal**: Z-score drops to -0.6
     - Exit at current price: $1,995
     - Exit value: 0.5 × $1,995 = $997.50
     - P&L: -$2.50 (-0.25%)
     - New balance: $8,997.50

## Key Features

### ✅ Comprehensive Simulation
- Real market prices from Binance API
- Accurate position sizing and P&L calculation
- Complete order lifecycle simulation

### ✅ Risk Management
- OCO logic prevents excessive losses
- Z-score reversal detection for strategy-based exits
- Position limits and allocation controls

### ✅ Logging & Analytics
- Detailed trade logs with timestamps
- P&L tracking and performance metrics
- Position duration and reason for exit

### ✅ Event System
```typescript
tradingEngine.on('paperTrade', (event) => {
  console.log(`Trade: ${event.action} ${event.symbol}`);
  console.log(`P&L: ${event.pnl}`);
});
```

## Configuration

Paper trading is controlled by the `enableLiveTrading` flag:
```typescript
const tradingEngine = new TradingEngine({
  enableLiveTrading: false, // Paper trading mode
  maxPositions: 3,
  symbols: ['ETHUSDT', 'BTCUSDT', 'BNBUSDT']
});
```

## Testing

Run the comprehensive paper trading test:
```bash
npx tsx scripts/test-paper-trading-complete.ts
```

This demonstrates:
- Signal detection and position entry
- OCO monitoring and automatic exits
- Z-score reversal handling
- P&L calculation and portfolio tracking

## Benefits

1. **🛡️ Risk-Free Testing**: Test strategies without real capital
2. **📊 Realistic Simulation**: Uses real market data and prices  
3. **🎯 Strategy Validation**: Verify Glicko-2 + Z-score approach
4. **📈 Performance Metrics**: Track success rates and profitability
5. **🔧 Parameter Tuning**: Optimize thresholds before live trading

The paper trading system provides a complete trading simulation that mirrors real trading behavior while maintaining the safety of virtual positions.