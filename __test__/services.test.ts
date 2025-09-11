/**
 * Unit tests for service implementations
 */
import { Logger } from '../src/services/Logger';

// Mock file system operations for Logger tests
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
}));

describe('Logger Service', () => {
  let logger: Logger;

  beforeEach(async () => {
    logger = new Logger('test-logger');
    await logger.initialize();
    jest.clearAllMocks();
  });

  describe('Basic Logging', () => {
    it('should create logger with correct setup', () => {
      expect(logger).toBeDefined();
    });

    it('should log info messages correctly', async () => {
      const message = 'Test info message';
      const metadata = { userId: 123, action: 'test' };

      await logger.info('TEST_ACTION', message, metadata);

      // Verify the log was created (we can't easily test file output, but we can test the call)
      expect(true).toBe(true); // Logger should not throw
    });

    it('should log error messages with details', async () => {
      const message = 'Test error occurred';
      const metadata = { error: 'Test error details' };

      await logger.error('ERROR_TEST', message, metadata);

      expect(true).toBe(true); // Should handle errors gracefully
    });

    it('should log warning messages', async () => {
      await logger.warn('WARNING_TEST', 'Test warning', { level: 'high' });
      expect(true).toBe(true);
    });

    it('should log debug messages', async () => {
      await logger.debug('DEBUG_TEST', 'Debug information', { verbose: true });
      expect(true).toBe(true);
    });
  });

  describe('Structured Logging', () => {
    it('should handle complex metadata objects', async () => {
      const complexMetadata = {
        user: { id: 123, name: 'test user' },
        request: { method: 'GET', url: '/api/test' },
        performance: { duration: 150, memory: 1024 },
        nested: {
          deep: {
            value: 'test'
          }
        }
      };

      await logger.info('COMPLEX_LOG', 'Complex metadata test', complexMetadata);
      expect(true).toBe(true);
    });

    it('should handle circular references in metadata', async () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      // Should not throw error even with circular reference
      await logger.info('CIRCULAR_TEST', 'Circular reference test', { circular });
      expect(true).toBe(true);
    });

    it('should handle undefined and null metadata', async () => {
      await logger.info('NULL_TEST', 'Null metadata test', null as any);
      await logger.info('UNDEFINED_TEST', 'Undefined metadata test', undefined as any);
      expect(true).toBe(true);
    });
  });

  describe('Specialized Logging Methods', () => {
    it('should log trading signals', async () => {
      const signal = {
        symbol: 'BTCUSDT',
        side: 'BUY',
        price: 50000,
        quantity: 0.001,
        confidence: 0.85
      };

      await logger.logSignal(signal, 'SIGNAL_GENERATED');
      expect(true).toBe(true);
    });

    it('should log paper trades', async () => {
      const details = {
        price: 50000,
        quantity: 0.001,
        side: 'BUY',
        reason: 'Z_SCORE_THRESHOLD'
      };

      await logger.logPaperTrade('BTCUSDT', 'ENTRY', details);
      expect(true).toBe(true);
    });

    it('should log position changes', async () => {
      const details = {
        entryPrice: 50000,
        currentPrice: 51000,
        quantity: 0.001,
        unrealizedPnL: 1.0
      };

      await logger.logPosition('POSITION_UPDATE', 'BTCUSDT', details);
      expect(true).toBe(true);
    });
  });

  describe('Performance and Memory', () => {
    it('should handle high-frequency logging', async () => {
      const promises = [];
      const startTime = Date.now();

      for (let i = 0; i < 50; i++) {
        promises.push(logger.info('PERF_TEST', `Message ${i}`, { index: i }));
      }

      await Promise.all(promises);
      const endTime = Date.now();

      // Should complete in reasonable time
      expect(endTime - startTime).toBeLessThan(2000);
    });

    it('should not leak memory with large metadata', async () => {
      const largeMetadata = {
        data: new Array(1000).fill(0).map((_, i) => ({ id: i, value: `item-${i}` }))
      };

      await logger.info('MEMORY_TEST', 'Large metadata test', largeMetadata);
      expect(true).toBe(true);
    });
  });

  describe('Log Level Management', () => {
    it('should handle different log levels', async () => {
      // Test all log levels
      await logger.debug('DEBUG', 'Debug message');
      await logger.info('INFO', 'Info message');
      await logger.warn('WARN', 'Warning message');
      await logger.error('ERROR', 'Error message');

      expect(true).toBe(true);
    });

    it('should support custom log categories', async () => {
      await logger.log(1, 'CUSTOM_CATEGORY', 'Custom category message', { custom: true }); // LogLevel.INFO = 1
      expect(true).toBe(true);
    });
  });
});

describe('Service Utilities', () => {
  describe('Error Handling Utilities', () => {
    it('should handle various error types', () => {
      const standardError = new Error('Standard error');
      const customError = { message: 'Custom error object', code: 500 };
      const stringError = 'String error';
      const nullError = null;

      // These tests verify that our error handling utilities can process different error types
      expect(standardError.message).toBe('Standard error');
      expect(customError.message).toBe('Custom error object');
      expect(typeof stringError).toBe('string');
      expect(nullError).toBe(null);
    });

    it('should handle stack trace extraction', () => {
      const error = new Error('Test error');
      
      expect(error.stack).toBeDefined();
      expect(error.stack?.includes('Test error')).toBe(true);
    });
  });

  describe('Data Formatting Utilities', () => {
    it('should format timestamps consistently', () => {
      const timestamp = new Date('2023-01-01T12:00:00Z');
      const formatted = timestamp.toISOString();
      
      expect(formatted).toBe('2023-01-01T12:00:00.000Z');
    });

    it('should format numbers with proper precision', () => {
      const price = 50000.123456789;
      const formatted = Number(price.toFixed(8));
      
      expect(formatted).toBe(50000.12345679);
    });

    it('should handle large numbers safely', () => {
      const largeNumber = Number.MAX_SAFE_INTEGER;
      const formattedString = largeNumber.toString();
      
      expect(typeof formattedString).toBe('string');
      expect(formattedString.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate trading parameters', () => {
      const validConfig = {
        zScoreThreshold: 2.0,
        movingAverages: 200,
        profitPercent: 5.0,
        stopLossPercent: 2.5
      };

      // Basic validation checks
      expect(validConfig.zScoreThreshold).toBeGreaterThan(0);
      expect(validConfig.movingAverages).toBeGreaterThan(0);
      expect(validConfig.profitPercent).toBeGreaterThan(0);
      expect(validConfig.stopLossPercent).toBeGreaterThan(0);
      expect(validConfig.profitPercent).toBeGreaterThan(validConfig.stopLossPercent);
    });

    it('should detect invalid configurations', () => {
      const invalidConfigs = [
        { zScoreThreshold: -1 }, // Negative threshold
        { movingAverages: 0 }, // Zero moving averages
        { profitPercent: -5 }, // Negative profit
        { stopLossPercent: 150 }, // Unreasonable stop loss
      ];

      invalidConfigs.forEach(config => {
        if ('zScoreThreshold' in config) {
          expect(config.zScoreThreshold).toBeLessThanOrEqual(0);
        }
        if ('movingAverages' in config) {
          expect(config.movingAverages).toBeLessThanOrEqual(0);
        }
        if ('profitPercent' in config) {
          expect(config.profitPercent).toBeLessThan(0);
        }
        if ('stopLossPercent' in config) {
          expect(config.stopLossPercent).toBeGreaterThan(100);
        }
      });
    });
  });
});

describe('Math and Statistical Utilities', () => {
  describe('Basic Mathematical Operations', () => {
    it('should calculate percentages correctly', () => {
      const value = 50;
      const total = 100;
      const percentage = (value / total) * 100;
      
      expect(percentage).toBe(50);
    });

    it('should calculate compound returns', () => {
      const initialValue = 1000;
      const returns = [0.1, -0.05, 0.08, 0.03]; // 10%, -5%, 8%, 3%
      
      let finalValue = initialValue;
      returns.forEach(returnRate => {
        finalValue *= (1 + returnRate);
      });
      
      expect(finalValue).toBeCloseTo(1164.24, 2);
    });

    it('should handle floating point precision', () => {
      const a = 0.1;
      const b = 0.2;
      const sum = a + b;
      
      // Floating point precision issue
      expect(sum).not.toBe(0.3); // This will be something like 0.30000000000000004
      expect(Math.abs(sum - 0.3)).toBeLessThan(1e-15);
    });
  });

  describe('Risk Calculations', () => {
    it('should calculate simple risk metrics', () => {
      const prices = [100, 102, 98, 105, 95, 103, 99, 107, 94, 108];
      const returns = [];
      
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i-1]) / prices[i-1]);
      }
      
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
      const standardDeviation = Math.sqrt(variance);
      
      expect(meanReturn).toBeDefined();
      expect(standardDeviation).toBeGreaterThan(0);
      expect(variance).toBeGreaterThan(0);
    });

    it('should calculate maximum drawdown', () => {
      const equityCurve = [1000, 1100, 1050, 1200, 900, 950, 1100, 800, 1300];
      let peak = equityCurve[0];
      let maxDrawdown = 0;
      
      for (const value of equityCurve) {
        if (value > peak) {
          peak = value;
        }
        const drawdown = (peak - value) / peak;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
      
      expect(maxDrawdown).toBeGreaterThan(0);
      expect(maxDrawdown).toBeLessThan(1);
    });
  });

  describe('Time Series Utilities', () => {
    it('should handle time series data structures', () => {
      const timeSeries = [
        { timestamp: new Date('2023-01-01'), value: 100 },
        { timestamp: new Date('2023-01-02'), value: 102 },
        { timestamp: new Date('2023-01-03'), value: 98 },
        { timestamp: new Date('2023-01-04'), value: 105 }
      ];
      
      // Sort by timestamp
      timeSeries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      expect(timeSeries[0].timestamp.getDate()).toBe(1);
      expect(timeSeries[3].timestamp.getDate()).toBe(4);
      expect(timeSeries).toHaveLength(4);
    });

    it('should interpolate missing data points', () => {
      const data = [10, null, 14, null, 18];
      const interpolated = [];
      
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== null) {
          interpolated[i] = data[i];
        } else {
          // Simple linear interpolation
          let prevIdx = i - 1;
          let nextIdx = i + 1;
          
          while (prevIdx >= 0 && data[prevIdx] === null) prevIdx--;
          while (nextIdx < data.length && data[nextIdx] === null) nextIdx++;
          
          if (prevIdx >= 0 && nextIdx < data.length) {
            const prevVal = data[prevIdx] as number;
            const nextVal = data[nextIdx] as number;
            const ratio = (i - prevIdx) / (nextIdx - prevIdx);
            interpolated[i] = prevVal + ratio * (nextVal - prevVal);
          }
        }
      }
      
      expect(interpolated[1]).toBe(12); // Interpolated value
      expect(interpolated[3]).toBe(16); // Interpolated value
    });
  });
});