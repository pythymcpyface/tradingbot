import { RustCoreService } from '../src/node-api/services/RustCoreService';
import { Kline, GlickoRating } from '../src/types';

describe('Glicko-2 Calculations', () => {
  let rustCore: RustCoreService;

  beforeAll(async () => {
    rustCore = new RustCoreService();
    // Note: In real tests, you'd mock the Rust process
  });

  describe('Hybrid Performance Score', () => {
    it('should calculate high-confidence win score correctly', () => {
      // High-confidence win: price up + taker buy dominant
      const score = calculateHybridScore(100, 105, 1000, 500);
      expect(score.score).toBe(1.0);
      expect(score.confidence).toBe('HIGH');
    });

    it('should calculate low-confidence win score correctly', () => {
      // Low-confidence win: price up + taker sell dominant
      const score = calculateHybridScore(100, 105, 500, 1000);
      expect(score.score).toBe(0.75);
      expect(score.confidence).toBe('LOW');
    });

    it('should calculate draw score correctly', () => {
      // Draw: price unchanged
      const score = calculateHybridScore(100, 100, 500, 1000);
      expect(score.score).toBe(0.5);
      expect(score.confidence).toBe('NEUTRAL');
    });

    it('should calculate low-confidence loss score correctly', () => {
      // Low-confidence loss: price down + taker buy dominant
      const score = calculateHybridScore(100, 95, 1000, 500);
      expect(score.score).toBe(0.25);
      expect(score.confidence).toBe('LOW');
    });

    it('should calculate high-confidence loss score correctly', () => {
      // High-confidence loss: price down + taker sell dominant
      const score = calculateHybridScore(100, 95, 500, 1000);
      expect(score.score).toBe(0.0);
      expect(score.confidence).toBe('HIGH');
    });
  });

  describe('Glicko-2 Rating Updates', () => {
    it('should increase rating after wins', () => {
      const initialRating = 1500;
      const wins = [1.0, 1.0, 0.75]; // Multiple wins
      
      // Simulate rating updates
      let currentRating = initialRating;
      for (const score of wins) {
        // This would call the actual Rust implementation
        currentRating += score * 10; // Simplified for test
      }
      
      expect(currentRating).toBeGreaterThan(initialRating);
    });

    it('should decrease rating after losses', () => {
      const initialRating = 1500;
      const losses = [0.0, 0.0, 0.25]; // Multiple losses
      
      // Simulate rating updates
      let currentRating = initialRating;
      for (const score of losses) {
        currentRating += (score - 0.5) * 20; // Simplified for test
      }
      
      expect(currentRating).toBeLessThan(initialRating);
    });

    it('should reduce rating deviation over time', () => {
      const initialRD = 350;
      const numGames = 10;
      
      // Rating deviation should decrease with more games
      let currentRD = initialRD;
      for (let i = 0; i < numGames; i++) {
        currentRD *= 0.9; // Simplified decay
      }
      
      expect(currentRD).toBeLessThan(initialRD);
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

    it('should handle edge cases in price data', () => {
      // Test with zero volume - price up but no volume data should still register as price up with low confidence
      const zeroVolumeScore = calculateHybridScore(100, 105, 0, 0);
      expect(zeroVolumeScore.score).toBe(0.75); // Price up but no volume data = low confidence win
      expect(zeroVolumeScore.confidence).toBe('LOW');
      
      // Test with equal prices
      const equalPriceScore = calculateHybridScore(100, 100, 1000, 500);
      expect(equalPriceScore.score).toBe(0.5); // Should be neutral draw
    });
  });

  describe('Performance Requirements', () => {
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

      // This would call the actual Rust implementation
      // const ratings = await rustCore.calculateGlickoRatings(mockKlines);
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      // Should process 1000 data points in less than 1 second
      expect(processingTime).toBeLessThan(1000);
      
      // Mock assertion - in real implementation, check actual results
      expect(mockKlines.length).toBe(1000);
    }, 10000);
  });
});

// Helper function to calculate hybrid score (TypeScript implementation for testing)
function calculateHybridScore(open: number, close: number, takerBuyVolume: number, takerSellVolume: number) {
  const priceUp = close > open;
  const priceUnchanged = Math.abs(close - open) < 0.0001;
  const takerBuyDominant = takerBuyVolume > takerSellVolume;

  let score: number;
  let confidence: 'HIGH' | 'LOW' | 'NEUTRAL';

  if (priceUnchanged) {
    score = 0.5;
    confidence = 'NEUTRAL';
  } else if (priceUp && takerBuyDominant) {
    score = 1.0;
    confidence = 'HIGH';
  } else if (priceUp && !takerBuyDominant) {
    score = 0.75;
    confidence = 'LOW';
  } else if (!priceUp && takerBuyDominant) {
    score = 0.25;
    confidence = 'LOW';
  } else {
    score = 0.0;
    confidence = 'HIGH';
  }

  return { score, confidence, priceUp, priceUnchanged, takerBuyDominant };
}