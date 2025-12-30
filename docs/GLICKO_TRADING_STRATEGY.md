# Glicko-2 Pairwise Trading Strategy

## Complete Technical Documentation

This document provides an exhaustive explanation of the Glicko-2 pairwise trading strategy, including the mathematical foundations, game theory principles, and signal generation logic.

---

## Table of Contents

1. [Strategy Overview](#1-strategy-overview)
2. [The Glicko-2 Rating System](#2-the-glicko-2-rating-system)
3. [Pairwise Game Theory](#3-pairwise-game-theory)
4. [Hybrid Score Calculation](#4-hybrid-score-calculation)
5. [Rating Update Algorithm](#5-rating-update-algorithm)
6. [Z-Score Signal Generation](#6-z-score-signal-generation)
7. [Trading Execution](#7-trading-execution)
8. [Complete Interval Cycle](#8-complete-interval-cycle)
9. [Mathematical Reference](#9-mathematical-reference)

---

## 1. Strategy Overview

### Core Concept

This trading system applies the **Glicko-2 rating algorithm** (originally designed for chess player rankings) to cryptocurrency markets. Instead of rating chess players, we rate **cryptocurrencies** based on their **relative performance against each other**.

### Key Innovation: Pairwise Comparisons

Traditional approaches rate assets against a benchmark (like USDT). This system instead:

1. Creates **pairwise matchups** between all coins (e.g., BTC vs ETH, ETH vs BNB)
2. Determines a **winner** based on price movement and volume
3. Updates **both coins' ratings** using Glicko-2 mathematics
4. Converts ratings to **Z-scores** for statistical signal generation

### Why This Works

- **Relative Strength**: Identifies which assets are gaining strength relative to peers
- **Mean Reversion**: Z-scores identify statistical extremes likely to revert
- **Noise Filtering**: Glicko-2's uncertainty modeling filters random fluctuations
- **Zero-Sum Enforcement**: Rating normalization prevents drift/inflation

---

## 2. The Glicko-2 Rating System

### Background

Glicko-2 was developed by Mark Glickman as an improvement over the Elo rating system. It introduces:

- **Rating Deviation (RD)**: Measures uncertainty in the rating
- **Volatility (σ)**: Measures consistency of performance

### Rating Components

Each cryptocurrency maintains three values:

| Component | Symbol | Initial Value | Range | Purpose |
|-----------|--------|---------------|-------|---------|
| Rating | r | 1500 | 800 - 3000 | Skill/strength estimate |
| Rating Deviation | RD | 350 | 30 - 350 | Uncertainty in rating |
| Volatility | σ | 0.06 | 0.01 - 0.2 | Performance consistency |

### Interpretation

```
High Rating (>1600)  = Asset outperforming peers
Low Rating (<1400)   = Asset underperforming peers
High RD (>200)       = High uncertainty (few recent games)
Low RD (<100)        = High confidence in rating
High Volatility      = Erratic performance swings
Low Volatility       = Consistent performance
```

---

## 3. Pairwise Game Theory

### The Game Model

Every 5-minute interval, the system processes **pairwise matchups** between all coins in the pool. For N coins, there are N×(N-1) potential matchups.

#### Example: 4 Coins (BTC, ETH, BNB, SOL)

```
Trading Pairs Generated:
┌────────┬────────────────────────────────┐
│ Pair   │ Interpretation                 │
├────────┼────────────────────────────────┤
│ BTCETH │ BTC (base) vs ETH (quote)      │
│ BTCBNB │ BTC (base) vs BNB (quote)      │
│ BTCSOL │ BTC (base) vs SOL (quote)      │
│ ETHBTC │ ETH (base) vs BTC (quote)      │
│ ETHBNB │ ETH (base) vs BNB (quote)      │
│ ETHSOL │ ETH (base) vs SOL (quote)      │
│ BNBBTC │ BNB (base) vs BTC (quote)      │
│ BNBETH │ BNB (base) vs ETH (quote)      │
│ BNBSOL │ BNB (base) vs SOL (quote)      │
│ SOLBTC │ SOL (base) vs BTC (quote)      │
│ SOLETH │ SOL (base) vs ETH (quote)      │
│ SOLBNB │ SOL (base) vs BNB (quote)      │
└────────┴────────────────────────────────┘

Total: 4 × 3 = 12 matchups per interval
```

### Zero-Sum Property

This is a **closed system**:
- When the base coin "wins", its rating increases
- The quote coin's rating decreases by a corresponding amount
- **Total rating pool remains constant** (normalized to mean 1500)

### Game Outcome Determination

For each pair (e.g., BTCETH):

```
If BTCETH price goes UP:
  → BTC is strengthening relative to ETH
  → BTC gets a WIN (score closer to 1.0)
  → ETH gets a LOSS (score closer to 0.0)

If BTCETH price goes DOWN:
  → ETH is strengthening relative to BTC
  → BTC gets a LOSS (score closer to 0.0)
  → ETH gets a WIN (score closer to 1.0)
```

---

## 4. Hybrid Score Calculation

### Overview

The **Hybrid Score** determines the outcome of each game. It combines:
- **70% Price Component**: Direct price change signal
- **30% Volume Component**: Taker buy pressure (conviction indicator)

### Formula

```
hybridScore = (priceScore × 0.7) + (volumeScore × 0.3)
```

### Price Score Calculation

```typescript
priceChange = (closePrice - openPrice) / openPrice

priceScore = 0.5 + (priceChange × 50)
priceScore = clamp(priceScore, 0.0, 1.0)
```

#### Price Score Examples

| Price Change | Calculation | Price Score |
|--------------|-------------|-------------|
| +2.0% | 0.5 + (0.02 × 50) = 0.5 + 1.0 | 1.0 (capped) |
| +1.0% | 0.5 + (0.01 × 50) = 0.5 + 0.5 | 1.0 (capped) |
| +0.5% | 0.5 + (0.005 × 50) = 0.5 + 0.25 | 0.75 |
| 0.0% | 0.5 + (0 × 50) = 0.5 | 0.50 |
| -0.5% | 0.5 + (-0.005 × 50) = 0.5 - 0.25 | 0.25 |
| -1.0% | 0.5 + (-0.01 × 50) = 0.5 - 0.5 | 0.0 (capped) |

### Volume Score Calculation

```typescript
volumeScore = takerBuyVolume / totalVolume
volumeScore = clamp(volumeScore, 0.0, 1.0)
```

- **Taker Buy Volume**: Volume from market buy orders (aggressive buyers)
- **Total Volume**: All trades in the interval

#### Volume Score Interpretation

| Taker Buy Ratio | Volume Score | Meaning |
|-----------------|--------------|---------|
| 80% | 0.80 | Strong buying pressure |
| 60% | 0.60 | Moderate buying pressure |
| 50% | 0.50 | Neutral (balanced) |
| 40% | 0.40 | Moderate selling pressure |
| 20% | 0.20 | Strong selling pressure |

### Complete Hybrid Score Example

```
Scenario: BTCETH 5-minute candle
├── Price Change: +0.4%
├── Taker Buy Ratio: 65%

Price Score:
  = 0.5 + (0.004 × 50)
  = 0.5 + 0.2
  = 0.70

Volume Score:
  = 0.65

Hybrid Score:
  = (0.70 × 0.7) + (0.65 × 0.3)
  = 0.49 + 0.195
  = 0.685

Interpretation:
  BTC score = 0.685 (moderately winning)
  ETH score = 1.0 - 0.685 = 0.315 (moderately losing)
```

---

## 5. Rating Update Algorithm

### Glicko-2 Scale Conversion

The Glicko-2 algorithm operates on an internal scale (μ, φ) for numerical stability.

```
Constants:
  GLICKO_SCALE = 173.7178
  INITIAL_RATING = 1500

To Glicko-2 Scale:
  μ = (rating - 1500) / 173.7178
  φ = RD / 173.7178

From Glicko-2 Scale:
  rating = μ × 173.7178 + 1500
  RD = φ × 173.7178
```

### Step-by-Step Rating Update

For each game between base and quote:

#### Step 1: Calculate g(φ) - Opponent Weight Function

This function reduces the impact of uncertain opponents:

```
g(φ) = 1 / √(1 + 3φ²/π²)
```

| Opponent RD | φ | g(φ) | Interpretation |
|-------------|---|------|----------------|
| 50 (low) | 0.29 | 0.98 | High confidence, full weight |
| 150 (med) | 0.86 | 0.88 | Medium confidence |
| 350 (high) | 2.02 | 0.64 | Low confidence, reduced weight |

#### Step 2: Calculate E(μ, μⱼ, φⱼ) - Expected Score

The probability of winning against opponent j:

```
E = 1 / (1 + e^(-g(φⱼ) × (μ - μⱼ)))
```

This is a **logistic function** (S-curve):

| Rating Diff | Expected Score | Meaning |
|-------------|----------------|---------|
| +400 | ~0.91 | 91% win probability |
| +200 | ~0.76 | 76% win probability |
| 0 | 0.50 | 50% win probability |
| -200 | ~0.24 | 24% win probability |
| -400 | ~0.09 | 9% win probability |

#### Step 3: Calculate Variance (v)

Measures the uncertainty in the rating estimate:

```
v = 1 / Σ[g(φⱼ)² × E × (1 - E)]
```

- Lower v = more certainty in the rating
- Higher v = more uncertainty

#### Step 4: Calculate Delta (Δ)

The improvement or decline in rating:

```
Δ = v × Σ[g(φⱼ) × (score - E)]
```

Where:
- `score` = actual game outcome (0.0 to 1.0)
- `E` = expected score

If score > E → Δ positive → rating increases
If score < E → Δ negative → rating decreases

#### Step 5: Update Volatility (σ')

```
σ' = √(σ² + (Δ²/v) × 0.0001)
σ' = clamp(σ', 0.01, 0.2)
```

The damping factor (0.0001) prevents volatility explosion.

#### Step 6: Update Rating Deviation (φ')

```
φ* = √(φ² + σ'²)           // Pre-update RD
φ' = 1 / √(1/φ*² + 1/v)    // Post-update RD
```

Note: RD **decreases** after playing games (more data = more confidence)

#### Step 7: Update Rating (μ')

```
μ' = μ + φ'² × Σ[g(φⱼ) × (score - E)]
```

The key insight: Rating change is proportional to:
- `φ'²` - Our uncertainty (higher = bigger swings)
- `(score - E)` - Surprise factor (actual vs expected)

### Rating Normalization (Drift Prevention)

After processing all games in an interval:

```typescript
// Calculate current mean
currentMean = Σ(all ratings) / count

// Calculate adjustment
adjustment = 1500 - currentMean

// Apply to all coins
for each coin:
  rating += adjustment
```

This ensures:
- Mean rating always equals 1500
- No inflation or deflation over time
- Zero-sum property is enforced

---

## 6. Z-Score Signal Generation

### Overview

After calculating Glicko ratings, the system converts them to **Z-scores** for signal generation. Z-scores represent how many standard deviations a rating is from the mean.

### Z-Score Calculation

```typescript
// Step 1: Calculate cross-coin statistics
meanRating = Σ(all coin ratings) / N
variance = Σ(rating - meanRating)² / N
stdDev = √variance

// Step 2: Calculate Z-score for each coin
zScore = (coinRating - meanRating) / stdDev
```

### Z-Score Interpretation

```
Z-Score Distribution (Normal Distribution):
┌─────────────────────────────────────────────────────────────┐
│                           ████                               │
│                         ████████                             │
│                       ████████████                           │
│                     ████████████████                         │
│                   ████████████████████                       │
│                 ████████████████████████                     │
│               ████████████████████████████                   │
│             ████████████████████████████████                 │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────────────┤
│    -4    -3    -2    -1     0    +1    +2    +3    +4        │
└─────────────────────────────────────────────────────────────┘
     │           │                 │           │
     │           │                 │           └─ Top 0.15%
     │           │                 └─ Top 16%
     │           └─ Bottom 2.5%
     └─ Bottom 0.15%
```

| Z-Score | Percentile | Interpretation |
|---------|------------|----------------|
| +3.0 | 99.85% | Extremely strong (signal territory) |
| +2.0 | 97.5% | Very strong |
| +1.0 | 84% | Above average |
| 0.0 | 50% | Average |
| -1.0 | 16% | Below average |
| -2.0 | 2.5% | Very weak |
| -3.0 | 0.15% | Extremely weak (signal territory) |

### Moving Average Z-Score

To reduce noise, the system uses a **moving average** of Z-scores:

```typescript
movingAverageZScore = average(last N z-scores)
// where N = movingAverages parameter (e.g., 200 periods)
```

This smooths out short-term fluctuations and identifies sustained trends.

### Signal Generation Logic

```typescript
function generateSignal(movingAverageZScore, threshold) {
  if (|movingAverageZScore| >= threshold) {
    if (movingAverageZScore > 0) {
      return 'BUY';   // Coin is statistically strong
    } else {
      return 'SELL';  // Coin is statistically weak
    }
  }
  return 'HOLD';
}
```

#### Example with Threshold = 3.0

| Moving Avg Z-Score | Signal | Reasoning |
|--------------------|--------|-----------|
| +3.5 | BUY | Coin in top 0.02% - extreme strength |
| +2.5 | HOLD | Strong but not extreme |
| +1.0 | HOLD | Above average but not significant |
| 0.0 | HOLD | Average performance |
| -2.5 | HOLD | Weak but not extreme |
| -3.5 | SELL | Coin in bottom 0.02% - extreme weakness |

### Z-Score Reversal Detection

For active positions, the system monitors for **reversals**:

```typescript
if (hasActivePosition(symbol)) {
  if (movingAverageZScore <= -threshold) {
    // Previously strong coin now extremely weak
    closePosition(symbol); // Early exit
  }
}
```

---

## 7. Trading Execution

### Order Flow

```
Signal Generated
       │
       ▼
   Risk Checks
   ├── Daily P&L limit?
   ├── Max drawdown exceeded?
   └── Position limit reached?
       │
       ▼ (if passed)
   Reserve Funds
   (AllocationManager)
       │
       ▼
   MARKET BUY Order
   (immediate execution)
       │
       ▼
   OCO SELL Order
   ├── Take Profit: entry × (1 + profitPercent)
   └── Stop Loss: entry × (1 - stopLossPercent)
       │
       ▼
   Position Tracked
   (activePositions Map)
```

### OCO (One-Cancels-Other) Order

```
Entry Price: $100.00
Profit %: 5%
Stop Loss %: 2.5%

OCO Order:
├── Take Profit Limit: $105.00 (sell if price rises 5%)
└── Stop Loss Market: $97.50 (sell if price drops 2.5%)

Whichever executes first cancels the other.
```

### Position Tracking

```typescript
interface ActivePosition {
  symbol: string;
  entryPrice: number;
  quantity: number;
  entryTime: Date;
  buyOrderId: string;
  ocoOrderId: string;
  takeProfitPrice: number;
  stopLossPrice: number;
  parameters: TradingParameterSet;
}
```

---

## 8. Complete Interval Cycle

### Timing

- **Interval**: 1 hour (3,600,000 ms)
- **Kline Resolution**: 5 minutes
- **Periods per Cycle**: Variable (based on moving average requirement)

### Full Cycle Diagram

```
HOUR START (T=0)
     │
     ▼
┌────────────────────────────────────────────────────────────────┐
│ PHASE 1: DATA COLLECTION                                        │
├────────────────────────────────────────────────────────────────┤
│ 1. Read BASE_COINS from environment                             │
│    Example: BTC,ETH,BNB,SOL                                     │
│                                                                  │
│ 2. Generate all trading pairs (N × (N-1))                       │
│    4 coins → 12 pairs                                           │
│                                                                  │
│ 3. Fetch 5-minute klines for each pair                          │
│    BinanceService.getKlines(pair, '5m', startTime, limit)       │
│                                                                  │
│ 4. Group klines by timestamp for chronological processing       │
└────────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────┐
│ PHASE 2: GLICKO RATING CALCULATION                              │
├────────────────────────────────────────────────────────────────┤
│ For each timestamp (chronologically):                           │
│   For each kline at this timestamp:                             │
│     │                                                           │
│     ├── Calculate priceChange = (close - open) / open           │
│     ├── Calculate hybridScore (70% price + 30% volume)          │
│     ├── engine.processGame(base, quote, hybridScore)            │
│     │     ├── Update base coin rating                           │
│     │     └── Update quote coin rating                          │
│     └── engine.normalizeRatings() // Prevent drift              │
│                                                                  │
│ Extract final ratings for all coins                             │
└────────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────┐
│ PHASE 3: SIGNAL GENERATION                                      │
├────────────────────────────────────────────────────────────────┤
│ 1. Calculate cross-coin statistics                              │
│    meanRating = average(all ratings)                            │
│    stdDev = standard deviation(all ratings)                     │
│                                                                  │
│ 2. For each coin:                                               │
│    ├── zScore = (rating - mean) / stdDev                        │
│    ├── Update z-score history                                   │
│    ├── movingAvgZScore = average(last N z-scores)               │
│    └── Generate signal if |movingAvgZScore| >= threshold        │
│                                                                  │
│ 3. Collect all BUY/SELL signals                                 │
└────────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────┐
│ PHASE 4: ORDER EXECUTION                                        │
├────────────────────────────────────────────────────────────────┤
│ For each signal:                                                │
│   ├── Pass risk checks (daily P&L, drawdown, position limit)   │
│   ├── Reserve funds via AllocationManager                       │
│   ├── Place MARKET BUY order                                    │
│   ├── Place OCO SELL order (take profit + stop loss)           │
│   └── Track position                                            │
└────────────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────────────────────────┐
│ PHASE 5: REVERSAL MONITORING                                    │
├────────────────────────────────────────────────────────────────┤
│ For each active position:                                       │
│   If movingAvgZScore has reversed beyond -threshold:           │
│     ├── Cancel existing OCO order                               │
│     ├── Place MARKET SELL                                       │
│     ├── Close position                                          │
│     └── Update P&L                                              │
└────────────────────────────────────────────────────────────────┘
     │
     ▼
NEXT HOUR (T+1h) → Repeat
```

---

## 9. Mathematical Reference

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| GLICKO_SCALE | 173.7178 | Converts between Glicko-2 and standard scale |
| INITIAL_RATING | 1500 | Default starting rating for all coins |
| TAU | 0.5 | System volatility constraint |
| DEFAULT_RD | 350 | Initial rating deviation |
| DEFAULT_VOL | 0.06 | Initial volatility |

### Key Formulas Summary

```
Scale Conversion:
  μ = (r - 1500) / 173.7178
  φ = RD / 173.7178

Opponent Weight:
  g(φ) = 1 / √(1 + 3φ²/π²)

Expected Score:
  E(μ, μⱼ, φⱼ) = 1 / (1 + e^(-g(φⱼ)(μ - μⱼ)))

Variance:
  v = 1 / Σ[g(φⱼ)² × E × (1 - E)]

Delta:
  Δ = v × Σ[g(φⱼ) × (score - E)]

New Rating:
  μ' = μ + φ'² × Σ[g(φⱼ) × (score - E)]

New RD:
  φ* = √(φ² + σ'²)
  φ' = 1 / √(1/φ*² + 1/v)

Hybrid Score:
  score = 0.7 × priceScore + 0.3 × volumeScore
  priceScore = clamp(0.5 + priceChange × 50, 0, 1)
  volumeScore = takerBuyVolume / totalVolume

Z-Score:
  z = (rating - meanRating) / stdDevRating

Signal:
  signal = |movingAvgZ| >= threshold ? (z > 0 ? BUY : SELL) : HOLD
```

### Parameter Recommendations

| Parameter | Conservative | Moderate | Aggressive |
|-----------|--------------|----------|------------|
| zScoreThreshold | 3.5 | 3.0 | 2.5 |
| movingAverages | 250 | 200 | 150 |
| profitPercent | 3% | 5% | 7% |
| stopLossPercent | 1.5% | 2.5% | 3.5% |

---

## File References

| Component | File Path |
|-----------|-----------|
| Glicko Engine | `src/services/GlickoEngine.ts` |
| Glicko Math | `src/utils/GlickoMath.ts` |
| Signal Generator | `src/services/SignalGeneratorService.ts` |
| Trading Engine | `src/node-api/services/TradingEngine.ts` |
| Binance Service | `src/node-api/services/BinanceService.ts` |

---

*Document generated for tradingbot_glicko - Glicko-2 Pairwise Trading System*
