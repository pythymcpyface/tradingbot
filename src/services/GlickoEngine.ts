import { 
  toGlicko2Scale, 
  fromGlicko2Scale, 
  g, 
  E, 
  calculateVariance,
  calculateDelta,
  calculateNewVolatility,
  INITIAL_RATING,
  GLICKO_SCALE
} from '../utils/GlickoMath';

export interface GlickoRating {
  rating: number;
  ratingDeviation: number;
  volatility: number;
}

export interface CoinRatingState {
  symbol: string;
  rating: GlickoRating;
  matchesPlayed: number;
  lastUpdate: Date;
}

export interface KlineInput {
  symbol: string;
  openTime: Date;
  closeTime: Date;
  open: number;
  close: number;
  volume: number;
  takerBuyVolume?: number;
}

export interface GameResult {
  winner: string;
  loser: string;
  score: number; // 1 for win, 0 for loss, 0.5 draw
  timestamp: Date;
}

export class GlickoEngine {
  private coinStates: Map<string, CoinRatingState> = new Map();
  
  // Configuration
  private readonly TAU = 0.5;
  private readonly DEFAULT_RD = 350;
  private readonly DEFAULT_VOL = 0.06;
  
  // Bounds
  private readonly MIN_RATING = 800;
  private readonly MAX_RATING = 3000;
  private readonly MIN_RD = 30;
  private readonly MAX_RD = 350;
  private readonly MIN_VOL = 0.01;
  private readonly MAX_VOL = 0.2; // Strict volatility cap to prevent explosion

  constructor(initialStates?: CoinRatingState[]) {
    if (initialStates) {
      initialStates.forEach(state => this.coinStates.set(state.symbol, state));
    }
  }

  /**
   * Initialize a coin if it doesn't exist
   */
  public ensureCoinExists(symbol: string, timestamp: Date): void {
    if (!this.coinStates.has(symbol)) {
      this.coinStates.set(symbol, {
        symbol,
        rating: {
          rating: INITIAL_RATING,
          ratingDeviation: this.DEFAULT_RD,
          volatility: this.DEFAULT_VOL
        },
        matchesPlayed: 0,
        lastUpdate: timestamp
      });
    }
  }

  /**
   * Get current state of a coin
   */
  public getCoinState(symbol: string): CoinRatingState | undefined {
    return this.coinStates.get(symbol);
  }

  /**
   * Process a single game between two coins and update their ratings immediately (Online Learning)
   */
  public processGame(
      base: string, 
      quote: string, 
      priceChange: number, 
      timestamp: Date,
      volumeMetrics?: { volume: number, takerBuyVolume: number }
  ): void {
    this.ensureCoinExists(base, timestamp);
    this.ensureCoinExists(quote, timestamp);

    const baseState = this.coinStates.get(base)!;
    const quoteState = this.coinStates.get(quote)!;

    // Calculate Hybrid Score (Price + Volume)
    const baseScore = this.calculateHybridScore(priceChange, volumeMetrics);
    const quoteScore = 1.0 - baseScore;

    // Update Base
    const newBaseRating = this.calculateNewRating(
      baseState.rating,
      [{ 
        opponentRating: quoteState.rating, 
        score: baseScore 
      }]
    );

    // Update Quote
    const newQuoteRating = this.calculateNewRating(
      quoteState.rating,
      [{ 
        opponentRating: baseState.rating, 
        score: quoteScore 
      }]
    );

    // Apply updates
    baseState.rating = newBaseRating;
    baseState.matchesPlayed++;
    baseState.lastUpdate = timestamp;

    quoteState.rating = newQuoteRating;
    quoteState.matchesPlayed++;
    quoteState.lastUpdate = timestamp;
  }

  /**
   * Calculate Hybrid Score based on Price Change and Volume Dominance
   * Formula: 0.7 * PriceScore + 0.3 * VolumeScore
   */
  private calculateHybridScore(priceChange: number, volumeMetrics?: { volume: number, takerBuyVolume: number }): number {
      // 1. Price Component (0.0 - 1.0)
      let priceScore = 0.5 + (priceChange * 50);
      priceScore = Math.min(1.0, Math.max(0.0, priceScore));
      
      // 2. Volume Component (0.0 - 1.0)
      // Taker Buy Volume Ratio: Buy / Total
      let volumeScore = 0.5; // Default neutral
      
      if (volumeMetrics && volumeMetrics.volume > 0) {
          volumeScore = volumeMetrics.takerBuyVolume / volumeMetrics.volume;
          volumeScore = Math.min(1.0, Math.max(0.0, volumeScore));
      }
      
      // 3. Weighted Average (70% Price, 30% Volume)
      // This allows volume to influence the "decisiveness" of the win
      return (priceScore * 0.7) + (volumeScore * 0.3);
  }

  /**
   * Calculate new rating for a player against a set of opponents (or single opponent)
   */
  private calculateNewRating(
    current: GlickoRating, 
    games: Array<{ opponentRating: GlickoRating, score: number, weight?: number }>
  ): GlickoRating {
    // 1. Convert to Glicko-2 scale
    const { mu, phi } = toGlicko2Scale(current.rating, current.ratingDeviation);
    const sigma = current.volatility;

    // 2. Prepare opponents
    const opponents = games.map(g => {
      const { mu: muJ, phi: phiJ } = toGlicko2Scale(g.opponentRating.rating, g.opponentRating.ratingDeviation);
      return { mu: muJ, phi: phiJ, score: g.score, weight: g.weight };
    });

    // 3. Calculate Variance (v)
    const v = calculateVariance(mu, opponents);

    // 4. Calculate Delta
    const delta = calculateDelta(v, mu, opponents);

    // 5. Calculate New Volatility (sigma')
    const newSigma = calculateNewVolatility(sigma, delta, v, this.TAU);

    // 6. Update Rating Deviation (phi')
    // phi* = sqrt(phi^2 + sigma'^2)
    const phiStar = Math.sqrt(Math.pow(phi, 2) + Math.pow(newSigma, 2));
    
    // newPhi = 1 / sqrt(1/phi*^2 + 1/v)
    const newPhi = 1 / Math.sqrt((1 / Math.pow(phiStar, 2)) + (1 / v));

    // 7. Update Rating (mu')
    // newMu = mu + newPhi^2 * sum(g(phiJ) * (score - E))
    // We can reuse calculateDelta logic but need to multiply by newPhi^2 instead of v
    let sumScores = 0;
    for (const opp of opponents) {
        const weight = opp.weight ?? 1.0;
        sumScores += g(opp.phi) * (opp.score - E(mu, opp.mu, opp.phi)) * weight;
    }
    const newMu = mu + (Math.pow(newPhi, 2) * sumScores);

    // 8. Convert back
    const { rating: finalRating, rd: finalRD } = fromGlicko2Scale(newMu, newPhi);

    return {
      // Allow ratings to float naturally (Soft cap via Glicko math)
      rating: finalRating, 
      ratingDeviation: this.clamp(finalRD, this.MIN_RD, this.MAX_RD),
      volatility: this.clamp(newSigma, this.MIN_VOL, this.MAX_VOL)
    };
  }

  /**
   * Apply decay to RD for inactive periods (optional feature, often used in batch processing)
   * In online processing, we usually handle this via the volatility update in every step.
   */
  public applyDecay(symbol: string): void {
      const state = this.coinStates.get(symbol);
      if (state) {
          const { mu, phi } = toGlicko2Scale(state.rating.rating, state.rating.ratingDeviation);
          const newPhi = Math.sqrt(Math.pow(phi, 2) + Math.pow(state.rating.volatility, 2));
          const { rd } = fromGlicko2Scale(mu, newPhi);
          state.rating.ratingDeviation = Math.min(rd, this.MAX_RD);
      }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Re-center all ratings around the initial mean (1500) to prevent drift (deflation/inflation).
   * This enforces a Zero-Sum environment in a closed pool.
   */
  public normalizeRatings(): void {
      let sum = 0;
      let count = 0;
      
      for (const state of this.coinStates.values()) {
          sum += state.rating.rating;
          count++;
      }
      
      if (count === 0) return;
      
      const currentMean = sum / count;
      const adjustment = INITIAL_RATING - currentMean;
      
      // Apply adjustment to all
      for (const state of this.coinStates.values()) {
          state.rating.rating += adjustment;
      }
  }
}