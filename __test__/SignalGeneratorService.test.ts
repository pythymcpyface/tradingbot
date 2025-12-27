import { SignalGeneratorService, RatingInput } from '../src/services/SignalGeneratorService';
import { TradingParameterSet } from '../src/types';

describe('SignalGeneratorService', () => {
  let service: SignalGeneratorService;

  beforeEach(() => {
    service = new SignalGeneratorService();
  });

  describe('calculateCrossCoinStatistics', () => {
    it('should calculate mean and standard deviation correctly', () => {
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1500, timestamp: new Date() },
        { symbol: 'ETH', rating: 1600, timestamp: new Date() },
        { symbol: 'BNB', rating: 1400, timestamp: new Date() }
      ];

      const stats = service.calculateCrossCoinStatistics(ratings);

      expect(stats.meanRating).toBe(1500);
      expect(stats.totalCoins).toBe(3);
      expect(stats.stdDevRating).toBeCloseTo(81.65, 2);
    });

    it('should handle empty ratings array', () => {
      const stats = service.calculateCrossCoinStatistics([]);

      expect(stats.meanRating).toBe(0);
      expect(stats.stdDevRating).toBe(0);
      expect(stats.totalCoins).toBe(0);
    });

    it('should handle single rating', () => {
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1500, timestamp: new Date() }
      ];

      const stats = service.calculateCrossCoinStatistics(ratings);

      expect(stats.meanRating).toBe(1500);
      expect(stats.stdDevRating).toBe(0);
      expect(stats.totalCoins).toBe(1);
    });
  });

  describe('calculateZScore', () => {
    it('should calculate z-score correctly', () => {
      const zScore = service.calculateZScore(1600, 1500, 100);

      expect(zScore).toBe(1.0);
    });

    it('should handle negative z-score', () => {
      const zScore = service.calculateZScore(1400, 1500, 100);

      expect(zScore).toBe(-1.0);
    });

    it('should return 0 when std dev is 0', () => {
      const zScore = service.calculateZScore(1500, 1500, 0);

      expect(zScore).toBe(0);
    });

    it('should calculate large z-scores correctly', () => {
      const zScore = service.calculateZScore(1800, 1500, 100);

      expect(zScore).toBe(3.0);
    });
  });

  describe('updateZScoreHistory', () => {
    it('should add z-score to history', () => {
      const timestamp = new Date();
      service.updateZScoreHistory('BTCUSDT', 1.5, 1600, timestamp);

      const history = service.getZScoreHistory('BTCUSDT');

      expect(history).toHaveLength(1);
      expect(history[0].zScore).toBe(1.5);
      expect(history[0].rating).toBe(1600);
      expect(history[0].timestamp).toBe(timestamp);
    });

    it('should maintain history limit', () => {
      const timestamp = new Date();

      for (let i = 0; i < 260; i++) {
        service.updateZScoreHistory('BTCUSDT', i, 1500 + i, timestamp, 250);
      }

      const history = service.getZScoreHistory('BTCUSDT');

      expect(history.length).toBeLessThanOrEqual(250);
    });

    it('should track multiple symbols independently', () => {
      const timestamp = new Date();

      service.updateZScoreHistory('BTCUSDT', 1.5, 1600, timestamp);
      service.updateZScoreHistory('ETHUSDT', -0.5, 1450, timestamp);

      expect(service.getZScoreHistory('BTCUSDT')).toHaveLength(1);
      expect(service.getZScoreHistory('ETHUSDT')).toHaveLength(1);
    });
  });

  describe('calculateMovingAverageZScore', () => {
    it('should calculate moving average correctly', () => {
      const timestamp = new Date();

      service.updateZScoreHistory('BTCUSDT', 1.0, 1600, timestamp);
      service.updateZScoreHistory('BTCUSDT', 1.5, 1650, timestamp);
      service.updateZScoreHistory('BTCUSDT', 2.0, 1700, timestamp);

      const maZScore = service.calculateMovingAverageZScore('BTCUSDT', 3);

      expect(maZScore).toBe(1.5);
    });

    it('should return null when insufficient history', () => {
      const timestamp = new Date();

      service.updateZScoreHistory('BTCUSDT', 1.0, 1600, timestamp);
      service.updateZScoreHistory('BTCUSDT', 1.5, 1650, timestamp);

      const maZScore = service.calculateMovingAverageZScore('BTCUSDT', 5);

      expect(maZScore).toBeNull();
    });

    it('should use only recent data for MA', () => {
      const timestamp = new Date();

      service.updateZScoreHistory('BTCUSDT', 10.0, 2000, timestamp);
      service.updateZScoreHistory('BTCUSDT', 1.0, 1600, timestamp);
      service.updateZScoreHistory('BTCUSDT', 2.0, 1700, timestamp);

      const maZScore = service.calculateMovingAverageZScore('BTCUSDT', 2);

      expect(maZScore).toBe(1.5);
    });
  });

  describe('generateSignal', () => {
    it('should generate BUY signal for positive z-score above threshold', () => {
      const signal = service.generateSignal('BTCUSDT', 3.5, 3.0);

      expect(signal).toBe('BUY');
    });

    it('should generate SELL signal for negative z-score below threshold', () => {
      const signal = service.generateSignal('BTCUSDT', -3.5, 3.0);

      expect(signal).toBe('SELL');
    });

    it('should generate HOLD signal when z-score below threshold', () => {
      const signal = service.generateSignal('BTCUSDT', 2.5, 3.0);

      expect(signal).toBe('HOLD');
    });

    it('should handle exactly threshold value', () => {
      const signal = service.generateSignal('BTCUSDT', 3.0, 3.0);

      expect(signal).toBe('BUY');
    });
  });

  describe('generateSignals', () => {
    it('should generate signals for enabled symbols only', () => {
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1700, timestamp: new Date() },
        { symbol: 'ETH', rating: 1600, timestamp: new Date() },
        { symbol: 'BNB', rating: 1300, timestamp: new Date() }
      ];

      const parameterSets = new Map<string, TradingParameterSet>([
        ['BTCUSDT', {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          zScoreThreshold: 1.0,
          movingAverages: 2,
          profitPercent: 2.0,
          stopLossPercent: 2.0,
          enabled: true
        }]
      ]);

      const timestamp = new Date();
      service.updateZScoreHistory('BTCUSDT', 2.0, 1700, timestamp);
      service.updateZScoreHistory('BTCUSDT', 2.5, 1750, timestamp);

      const result = service.generateSignals(ratings, parameterSets);

      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].symbol).toBe('BTCUSDT');
      expect(result.signals[0].signal).toBe('BUY');
    });

    it('should calculate statistics correctly', () => {
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1500, timestamp: new Date() },
        { symbol: 'ETH', rating: 1600, timestamp: new Date() },
        { symbol: 'BNB', rating: 1400, timestamp: new Date() }
      ];

      const result = service.generateSignals(ratings, new Map());

      expect(result.statistics.meanRating).toBe(1500);
      expect(result.statistics.totalCoins).toBe(3);
    });

    it('should not generate signals when insufficient history', () => {
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1700, timestamp: new Date() }
      ];

      const parameterSets = new Map<string, TradingParameterSet>([
        ['BTCUSDT', {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          zScoreThreshold: 1.0,
          movingAverages: 5,
          profitPercent: 2.0,
          stopLossPercent: 2.0,
          enabled: true
        }]
      ]);

      const result = service.generateSignals(ratings, parameterSets);

      expect(result.signals).toHaveLength(0);
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', () => {
      const timestamp = new Date();

      service.updateZScoreHistory('BTCUSDT', 1.0, 1600, timestamp);
      service.updateZScoreHistory('ETHUSDT', 1.5, 1650, timestamp);

      service.clearHistory();

      expect(service.getZScoreHistory('BTCUSDT')).toHaveLength(0);
      expect(service.getZScoreHistory('ETHUSDT')).toHaveLength(0);
    });
  });

  describe('clearSymbolHistory', () => {
    it('should clear history for specific symbol only', () => {
      const timestamp = new Date();

      service.updateZScoreHistory('BTCUSDT', 1.0, 1600, timestamp);
      service.updateZScoreHistory('ETHUSDT', 1.5, 1650, timestamp);

      service.clearSymbolHistory('BTCUSDT');

      expect(service.getZScoreHistory('BTCUSDT')).toHaveLength(0);
      expect(service.getZScoreHistory('ETHUSDT')).toHaveLength(1);
    });
  });

  describe('ensureMinimumHistory', () => {
    it('should backfill history when insufficient', () => {
      const timestamp = new Date();
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1700, timestamp }
      ];
      const stats = service.calculateCrossCoinStatistics(ratings);

      service.ensureMinimumHistory('BTCUSDT', 5, ratings, stats);

      expect(service.getZScoreHistoryLength('BTCUSDT')).toBe(5);
    });

    it('should not backfill when history is sufficient', () => {
      const timestamp = new Date();
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1700, timestamp }
      ];
      const stats = service.calculateCrossCoinStatistics(ratings);

      for (let i = 0; i < 10; i++) {
        service.updateZScoreHistory('BTCUSDT', 1.0, 1600, timestamp);
      }

      service.ensureMinimumHistory('BTCUSDT', 5, ratings, stats);

      expect(service.getZScoreHistoryLength('BTCUSDT')).toBe(10);
    });
  });
});
