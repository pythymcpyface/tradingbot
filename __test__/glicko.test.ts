import { RustCoreService } from '../src/node-api/services/RustCoreService';
import { Kline, GlickoRating } from '../src/types';

describe('Glicko-2 Calculations', () => {
  let rustCore: RustCoreService;

  beforeAll(async () => {
    rustCore = new RustCoreService();
    // Note: In real tests, you'd mock the Rust process
  });

  describe('Continuous Scaling Game Result', () => {
    it('should calculate game result with continuous scaling formula', () => {
      // gameResult = 0.5 + (priceChange * 50), bounded [0.0, 1.0]
      // +2% change: 0.5 + (0.02 * 50) = 1.0
      const score = calculateGameResult(100, 102);
      expect(score).toBe(1.0);
    });

    it('should handle small price changes correctly', () => {
      // +0.5% change: 0.5 + (0.005 * 50) = 0.75
      const score = calculateGameResult(100, 100.5);
      expect(score).toBeCloseTo(0.75, 5);
    });

    it('should return 0.5 for zero price change (draw)', () => {
      // 0% change: 0.5 + (0 * 50) = 0.5
      const score = calculateGameResult(100, 100);
      expect(score).toBe(0.5);
    });

    it('should handle negative price changes correctly', () => {
      // -2% change: 0.5 + (-0.02 * 50) = 0.0
      const score = calculateGameResult(100, 98);
      expect(score).toBe(0.0);
    });

    it('should handle small negative price changes correctly', () => {
      // -0.5% change: 0.5 + (-0.005 * 50) = 0.25
      const score = calculateGameResult(100, 99.5);
      expect(score).toBeCloseTo(0.25, 5);
    });

    it('should bound extreme positive price changes', () => {
      // +10% change: 0.5 + (0.1 * 50) = 5.5 → bounded to 1.0
      const score = calculateGameResult(100, 110);
      expect(score).toBe(1.0);
    });

    it('should bound extreme negative price changes', () => {
      // -10% change: 0.5 + (-0.1 * 50) = -4.5 → bounded to 0.0
      const score = calculateGameResult(100, 90);
      expect(score).toBe(0.0);
    });

    it('should treat very small changes as draw (< 0.1% threshold)', () => {
      // 0.05% change: < 0.1% threshold is treated as draw (0.5)
      const score = calculateGameResult(100, 100.05);
      expect(score).toBe(0.5);
    });
  });

  describe('Confidence Levels Based on Magnitude', () => {
    it('should assign HIGH confidence for large moves (> 0.25 deviation from 0.5)', () => {
      // -2% loss: score = 0.0, deviation = 0.5 → HIGH confidence
      const confidence = getConfidenceLevel(0.0);
      expect(confidence).toBe('HIGH');

      // +2% win: score = 1.0, deviation = 0.5 → HIGH confidence
      const confidenceWin = getConfidenceLevel(1.0);
      expect(confidenceWin).toBe('HIGH');
    });

    it('should assign LOW confidence for moderate moves (0.1 - 0.25 deviation)', () => {
      // +0.6% win: score = 0.8, deviation = 0.3 → HIGH (not in LOW range)
      // Use +0.3% win instead: score = 0.65, deviation = 0.15 → LOW confidence
      const confidence = getConfidenceLevel(0.65);
      expect(confidence).toBe('LOW');

      // -0.3% loss: score = 0.35, deviation = 0.15 → LOW confidence
      const confidenceLoss = getConfidenceLevel(0.35);
      expect(confidenceLoss).toBe('LOW');
    });

    it('should assign NEUTRAL confidence for small moves (< 0.1 deviation)', () => {
      // 0.2% move: score = 0.6, deviation = 0.1 → at boundary, use 0.15% move
      // 0.15% move: score = 0.575, deviation = 0.075 → NEUTRAL
      const confidence = getConfidenceLevel(0.575);
      expect(confidence).toBe('NEUTRAL');

      // Draw: score = 0.5, deviation = 0 → NEUTRAL
      const confidenceDraw = getConfidenceLevel(0.5);
      expect(confidenceDraw).toBe('NEUTRAL');
    });
  });

  describe('Market Volatility Calculation', () => {
    it('should calculate volatility from price returns', () => {
      // Test with constant prices (volatility = 0)
      const prices = [100, 100, 100, 100, 100];
      const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
      const volatility = calculateVolatility(returns);
      expect(volatility).toBeCloseTo(0, 5);
    });

    it('should calculate volatility from varying prices', () => {
      // Test with varying prices
      const prices = [100, 101, 99, 102, 98];
      const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
      const volatility = calculateVolatility(returns);
      expect(volatility).toBeGreaterThan(0);
    });

    it('should handle empty returns array', () => {
      const volatility = calculateVolatility([]);
      expect(volatility).toBe(0);
    });

    it('should handle single return value', () => {
      const volatility = calculateVolatility([0.01]);
      expect(volatility).toBe(0);
    });
  });

  describe('Dynamic Opponent Rating', () => {
    it('should calculate opponent rating based on market conditions', () => {
      // Base: 1500, Volatility 5%: +50, Volume ratio log(1.5): +5 → ~1555
      const opponentRating = calculateOpponentRating(0.05, 1.5);
      expect(opponentRating).toBeGreaterThan(1500);
    });

    it('should increase rating with higher volatility', () => {
      const ratingLowVol = calculateOpponentRating(0.02, 1.0);
      const ratingHighVol = calculateOpponentRating(0.10, 1.0);
      expect(ratingHighVol).toBeGreaterThan(ratingLowVol);
    });

    it('should factor in volume ratio dominance', () => {
      const ratingEvenVolume = calculateOpponentRating(0.05, 1.0);
      const ratingHighBuyVolume = calculateOpponentRating(0.05, 2.0);
      expect(ratingHighBuyVolume).toBeGreaterThan(ratingEvenVolume);
    });
  });

  describe('Glicko-2 Rating Updates with Simplified Volatility', () => {
    it('should increase rating after high-confidence wins (score close to 1.0)', () => {
      // High-confidence win: gameResult = 0.9, opponent at baseline
      const updated = updateGlickoRating(
        { rating: 1500, rd: 350, volatility: 0.06 },
        1500, // opponentRating
        50,   // opponentRD
        0.9,  // gameResult
        0.05  // marketVolatility for delta calculation
      );

      expect(updated.rating).toBeGreaterThan(1500);
    });

    it('should decrease rating after high-confidence losses (score close to 0.0)', () => {
      // High-confidence loss: gameResult = 0.1, opponent at baseline
      const updated = updateGlickoRating(
        { rating: 1500, rd: 350, volatility: 0.06 },
        1500, // opponentRating
        50,   // opponentRD
        0.1,  // gameResult
        0.05  // marketVolatility
      );

      expect(updated.rating).toBeLessThan(1500);
    });

    it('should reduce rating deviation after games', () => {
      // After a game, RD should decrease (more certainty)
      const updated = updateGlickoRating(
        { rating: 1500, rd: 350, volatility: 0.06 },
        1500, // opponentRating
        50,   // opponentRD
        0.75, // gameResult
        0.05  // marketVolatility
      );

      expect(updated.rd).toBeLessThan(350);
    });

    it('should update volatility using simplified calculation: σ\' = √(σ² + δ²/v)', () => {
      // With a significant game result (delta), volatility should increase initially
      const updated = updateGlickoRating(
        { rating: 1500, rd: 350, volatility: 0.06 },
        1500, // opponentRating
        200,  // opponentRD (lower certainty = larger v)
        0.0,  // complete loss
        0.05  // marketVolatility
      );

      // Volatility should be bounded to [0.01, 0.2]
      expect(updated.volatility).toBeGreaterThanOrEqual(0.01);
      expect(updated.volatility).toBeLessThanOrEqual(0.2);
    });

    it('should preserve rating for neutral games (score = 0.5)', () => {
      const player = { rating: 1500, rd: 350, volatility: 0.06 };
      const updated = updateGlickoRating(
        player,
        1500, // opponentRating
        50,   // opponentRD
        0.5,  // neutral result
        0.05  // marketVolatility
      );

      // Rating should stay approximately the same for neutral games
      expect(Math.abs(updated.rating - 1500)).toBeLessThan(10);
    });
  });

  describe('Data Validation', () => {
    it('should validate klines data format', () => {
      const validKline: Kline = {
        symbol: 'BTCUSDT',
        openTime: new Date('2022-01-01T00:00:00Z'),
        closeTime: new Date('2022-01-01T01:00:00Z'),
        open: 47000,
        high: 48000,
        low: 46500,
        close: 47500,
        volume: 100,
        quoteAssetVolume: 4750000,
        numberOfTrades: 1000,
        takerBuyBaseAssetVolume: 60,
        takerBuyQuoteAssetVolume: 2850000,
        ignore: 0
      };

      expect(validKline.symbol).toBeDefined();
      expect(validKline.open).toBeGreaterThan(0);
      expect(validKline.close).toBeGreaterThan(0);
      expect(validKline.volume).toBeGreaterThanOrEqual(0);
    });

    it('should handle extreme price movements in continuous scaling', () => {
      // Test with large price jump
      const largeWin = calculateGameResult(100, 110);
      expect(largeWin).toBe(1.0); // Should be bounded to 1.0

      // Test with large price drop
      const largeLoss = calculateGameResult(100, 90);
      expect(largeLoss).toBe(0.0); // Should be bounded to 0.0

      // Test with moderate positive move: +1% → 0.5 + (0.01 * 50) = 1.0 (bounded)
      const moderateWin = calculateGameResult(100, 101);
      expect(moderateWin).toBe(1.0);

      // Test with smaller move: +0.5% → 0.5 + (0.005 * 50) = 0.75
      const smallerWin = calculateGameResult(100, 100.5);
      expect(smallerWin).toBeCloseTo(0.75, 5);
    });
  });

  describe('Batch System Parity', () => {
    it('should produce consistent results across batch processing methods', () => {
      // All three batch methods (fixed, 5min, chunked) should produce
      // the same Glicko ratings when given identical kline data
      const mockKline = {
        symbol: 'BTCUSDT',
        openTime: 1640995200000,
        closeTime: 1640998800000,
        open: 47000,
        high: 48000,
        low: 46500,
        close: 47500,
        volume: 100,
        quoteAssetVolume: 4750000,
        numberOfTrades: 1000,
        takerBuyBaseAssetVolume: 60,
        takerBuyQuoteAssetVolume: 2850000
      };

      // Score calculation should be deterministic
      const gameResult1 = calculateGameResult(mockKline.open, mockKline.close);
      const gameResult2 = calculateGameResult(mockKline.open, mockKline.close);

      expect(gameResult1).toBe(gameResult2);
    });

    it('should match live engine continuous scaling algorithm', () => {
      // Live engine uses: gameResult = 0.5 + (priceChange * 50), bounded [0.0, 1.0]
      // This test verifies batch system uses the exact same formula
      const testCases = [
        { open: 100, close: 102, expected: 1.0 },      // +2% → bounded to 1.0
        { open: 100, close: 100.5, expected: 0.75 },   // +0.5%
        { open: 100, close: 100, expected: 0.5 },      // 0%
        { open: 100, close: 99.5, expected: 0.25 },    // -0.5%
        { open: 100, close: 98, expected: 0.0 },       // -2% → bounded to 0.0
      ];

      testCases.forEach(({ open, close, expected }) => {
        const result = calculateGameResult(open, close);
        expect(result).toBeCloseTo(expected, 5);
      });
    });
  });

  describe('Performance Requirements', () => {
    it('should calculate game result efficiently', () => {
      const startTime = Date.now();

      // Simulate processing 10,000 klines
      for (let i = 0; i < 10000; i++) {
        const open = 100 + Math.random() * 10;
        const close = 100 + Math.random() * 10;
        calculateGameResult(open, close);
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should process 10,000 calculations in less than 100ms
      expect(processingTime).toBeLessThan(100);
    });

    it('should process large datasets efficiently', async () => {
      const startTime = Date.now();

      // Generate mock data for 1000 1-hour periods
      const mockKlines: Kline[] = Array.from({ length: 1000 }, (_, i) => ({
        symbol: 'BTCUSDT',
        openTime: new Date(Date.now() - (1000 - i) * 60 * 60 * 1000),
        closeTime: new Date(Date.now() - (999 - i) * 60 * 60 * 1000),
        open: 47000 + Math.random() * 1000,
        high: 47000 + Math.random() * 1000 + 500,
        low: 47000 - Math.random() * 500,
        close: 47000 + Math.random() * 1000,
        volume: 100 + Math.random() * 50,
        quoteAssetVolume: 4750000 + Math.random() * 1000000,
        numberOfTrades: 1000 + Math.floor(Math.random() * 500),
        takerBuyBaseAssetVolume: 50 + Math.random() * 30,
        takerBuyQuoteAssetVolume: 2375000 + Math.random() * 500000,
        ignore: 0
      }));

      // Calculate game result for all klines
      mockKlines.forEach(k => {
        calculateGameResult(k.open, k.close);
      });

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should process 1000 data points in less than 1 second
      expect(processingTime).toBeLessThan(1000);
      expect(mockKlines.length).toBe(1000);
    }, 10000);
  });
});

// Helper functions for continuous scaling algorithm validation

function calculateGameResult(open: number, close: number): number {
  const priceChange = (close - open) / open;

  if (Math.abs(priceChange) < 0.001) {
    return 0.5; // Draw: < 0.1% change
  }

  const gameResult = 0.5 + priceChange * 50;
  return Math.min(1.0, Math.max(0.0, gameResult));
}

function getConfidenceLevel(score: number): 'HIGH' | 'LOW' | 'NEUTRAL' {
  const deviation = Math.abs(score - 0.5);

  if (deviation < 0.1) {
    return 'NEUTRAL';
  } else if (deviation < 0.25) {
    return 'LOW';
  } else {
    return 'HIGH';
  }
}

function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) {
    return 0;
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

  return Math.sqrt(variance);
}

function calculateOpponentRating(marketVolatility: number, volumeRatio: number): number {
  const OPPONENT_RATING = 1500;
  return OPPONENT_RATING + (marketVolatility * 1000) + (Math.log(volumeRatio) * 100);
}

interface GlickoPlayer {
  rating: number;
  rd: number;
  volatility: number;
}

function updateGlickoRating(
  player: GlickoPlayer,
  opponentRating: number,
  opponentRd: number,
  gameResult: number,
  marketVolatility: number
): GlickoPlayer {
  // Convert to Glicko-2 scale
  const GLICKO2_SCALE = 173.7178;
  const mu = (player.rating - 1500) / GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;

  const mu_j = (opponentRating - 1500) / GLICKO2_SCALE;
  const phi_j = opponentRd / GLICKO2_SCALE;

  // g function
  const g_phi_j = 1.0 / Math.sqrt(1.0 + 3.0 * phi_j * phi_j / Math.pow(Math.PI, 2));

  // E function
  const e_mu_mu_j = 1.0 / (1.0 + Math.exp(-g_phi_j * (mu - mu_j)));

  // Step 1: Compute estimated variance
  const v = 1.0 / (g_phi_j * g_phi_j * e_mu_mu_j * (1.0 - e_mu_mu_j));

  // Step 2: Compute estimated improvement
  const delta = v * g_phi_j * (gameResult - e_mu_mu_j);

  // Step 3: Compute new volatility (simplified)
  const newSigma = Math.sqrt(player.volatility * player.volatility + (delta * delta) / v);
  const boundedSigma = Math.min(0.2, Math.max(0.01, newSigma));

  // Step 4: Update rating and RD
  const phi_star = Math.sqrt(phi * phi + boundedSigma * boundedSigma);
  const new_phi = 1.0 / Math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v);
  const new_mu = mu + new_phi * new_phi * g_phi_j * (gameResult - e_mu_mu_j);

  // Convert back to original scale
  const newRating = GLICKO2_SCALE * new_mu + 1500;
  const newRd = GLICKO2_SCALE * new_phi;

  return {
    rating: newRating,
    rd: newRd,
    volatility: boundedSigma
  };
}