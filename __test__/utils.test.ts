/**
 * Unit tests for utility functions and algorithms
 */
import { BacktestSuccessAnalyzer, WindowResult } from '../src/utils/BacktestSuccessMetrics';

describe('BacktestSuccessAnalyzer', () => {
  describe('Window Results Analysis', () => {
    it('should analyze window results correctly', () => {
      const windowResults: WindowResult[] = [
        {
          return: 0.05,
          duration: 30,
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-01-31'),
          trades: 10
        },
        {
          return: -0.02,
          duration: 30,
          startDate: new Date('2023-02-01'),
          endDate: new Date('2023-02-28'),
          trades: 8
        },
        {
          return: 0.08,
          duration: 30,
          startDate: new Date('2023-03-01'),
          endDate: new Date('2023-03-31'),
          trades: 12
        }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(windowResults);

      expect(metrics).toBeDefined();
      expect(metrics.totalReturn).toBeDefined();
      expect(metrics.annualizedReturn).toBeDefined();
      expect(metrics.winRate).toBeDefined();
      expect(metrics.sharpeRatio).toBeDefined();
    });

    it('should handle empty window results', () => {
      const emptyResults: WindowResult[] = [];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(emptyResults);

      expect(metrics).toBeDefined();
      expect(metrics.totalReturn).toBe(0);
    });

    it('should handle single window result', () => {
      const singleResult: WindowResult[] = [
        {
          return: 0.1,
          duration: 60,
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-03-01'),
          trades: 25
        }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(singleResult);

      expect(metrics.totalReturn).toBeCloseTo(0.1, 5);
      expect(metrics.winRate).toBe(1); // 100% win rate
    });

    it('should handle all negative returns', () => {
      const negativeResults: WindowResult[] = [
        {
          return: -0.02,
          duration: 30,
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-01-31'),
          trades: 5
        },
        {
          return: -0.01,
          duration: 30,
          startDate: new Date('2023-02-01'),
          endDate: new Date('2023-02-28'),
          trades: 3
        }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(negativeResults);

      expect(metrics.winRate).toBe(0); // 0% win rate
      expect(metrics.totalReturn).toBeLessThan(0);
    });

    it('should handle mixed returns correctly', () => {
      const mixedResults: WindowResult[] = [
        { return: 0.1, duration: 30, startDate: new Date(), endDate: new Date(), trades: 10 },
        { return: -0.05, duration: 30, startDate: new Date(), endDate: new Date(), trades: 8 },
        { return: 0.15, duration: 30, startDate: new Date(), endDate: new Date(), trades: 12 },
        { return: -0.03, duration: 30, startDate: new Date(), endDate: new Date(), trades: 6 },
        { return: 0.08, duration: 30, startDate: new Date(), endDate: new Date(), trades: 9 }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(mixedResults);

      expect(metrics.winRate).toBe(0.6); // 60% win rate (3 wins out of 5)
      expect(metrics.totalReturn).toBeGreaterThan(0);
      expect(metrics.averageWin).toBeGreaterThan(0);
      expect(metrics.averageLoss).toBeLessThan(0);
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should handle extreme values', () => {
      const extremeResults: WindowResult[] = [
        {
          return: 10.0, // 1000% return
          duration: 365,
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-12-31'),
          trades: 1
        }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(extremeResults);
      
      expect(metrics.totalReturn).toBe(10.0);
      expect(metrics.winRate).toBe(1);
    });

    it('should handle zero returns', () => {
      const zeroResults: WindowResult[] = [
        {
          return: 0,
          duration: 30,
          startDate: new Date(),
          endDate: new Date(),
          trades: 0
        }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(zeroResults);
      
      expect(metrics.totalReturn).toBe(0);
    });

    it('should handle very small returns', () => {
      const smallResults: WindowResult[] = [
        {
          return: 0.0001,
          duration: 1,
          startDate: new Date(),
          endDate: new Date(),
          trades: 1
        }
      ];

      const metrics = BacktestSuccessAnalyzer.analyzeWindowResults(smallResults);
      
      expect(metrics.totalReturn).toBeCloseTo(0.0001, 6);
    });
  });
});

describe('Utility Functions', () => {
  describe('Performance Calculations', () => {
    it('should calculate percentage changes correctly', () => {
      const initial = 1000;
      const final = 1100;
      const percentChange = (final - initial) / initial;
      
      expect(percentChange).toBe(0.1); // 10% gain
    });

    it('should calculate compound annual growth rate', () => {
      const beginningValue = 1000;
      const endingValue = 1500;
      const years = 2;
      
      const cagr = Math.pow(endingValue / beginningValue, 1 / years) - 1;
      
      expect(cagr).toBeCloseTo(0.2247, 4); // ~22.47% CAGR
    });

    it('should handle negative values in calculations', () => {
      const values = [-100, 50, -25, 75];
      const sum = values.reduce((acc, val) => acc + val, 0);
      
      expect(sum).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate window result structure', () => {
      const validWindow: WindowResult = {
        return: 0.05,
        duration: 30,
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-01-31'),
        trades: 10
      };

      expect(validWindow.return).toBeDefined();
      expect(validWindow.duration).toBeGreaterThan(0);
      expect(validWindow.startDate).toBeInstanceOf(Date);
      expect(validWindow.endDate).toBeInstanceOf(Date);
      expect(validWindow.trades).toBeGreaterThanOrEqual(0);
    });

    it('should handle date validation', () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      
      expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
    });
  });

  describe('Array Operations', () => {
    it('should filter arrays correctly', () => {
      const numbers = [1, -2, 3, -4, 5, -6];
      const positives = numbers.filter(n => n > 0);
      const negatives = numbers.filter(n => n < 0);
      
      expect(positives).toEqual([1, 3, 5]);
      expect(negatives).toEqual([-2, -4, -6]);
    });

    it('should reduce arrays correctly', () => {
      const numbers = [1, 2, 3, 4, 5];
      const sum = numbers.reduce((acc, val) => acc + val, 0);
      const product = numbers.reduce((acc, val) => acc * val, 1);
      
      expect(sum).toBe(15);
      expect(product).toBe(120);
    });

    it('should map arrays correctly', () => {
      const numbers = [1, 2, 3, 4];
      const squared = numbers.map(n => n * n);
      
      expect(squared).toEqual([1, 4, 9, 16]);
    });
  });

  describe('Type Safety', () => {
    it('should handle type checking', () => {
      const value: unknown = 42;
      
      if (typeof value === 'number') {
        expect(value + 8).toBe(50);
      }
      
      if (typeof value === 'string') {
        expect(value.length).toBeDefined();
      }
    });

    it('should handle nullable values', () => {
      const nullable: number | null = null;
      const nonNull: number | null = 42;
      
      expect(nullable).toBeNull();
      expect(nonNull).not.toBeNull();
      
      if (nonNull !== null) {
        expect(nonNull * 2).toBe(84);
      }
    });
  });
});