import { RustCoreService } from '../src/node-api/services/RustCoreService';

// Mock child_process to avoid spawning actual Rust processes
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => ({
    stdout: {
      on: jest.fn(),
      setEncoding: jest.fn(),
    },
    stderr: {
      on: jest.fn(),
    },
    on: jest.fn().mockImplementation((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 100); // Simulate successful exit
      }
    }),
    kill: jest.fn(),
  })),
  exec: jest.fn().mockImplementation((cmd, callback) => {
    callback(null, 'mock output', '');
  }),
}));

describe('RustCoreService', () => {
  let rustService: RustCoreService;

  beforeEach(() => {
    rustService = new RustCoreService();
  });

  afterEach(() => {
    if (rustService) {
      rustService.cleanup();
    }
  });

  describe('Service Initialization', () => {
    it('should initialize service correctly', () => {
      expect(rustService).toBeInstanceOf(RustCoreService);
    });

    it('should have correct service properties', () => {
      expect(rustService.isInitialized()).toBe(false);
      expect(rustService.getVersion()).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Glicko Calculations', () => {
    it('should calculate glicko ratings', async () => {
      const mockData = [
        {
          symbol: 'BTCUSDT',
          rating: 1500,
          deviation: 350,
          volatility: 0.06,
          timestamp: new Date().toISOString()
        }
      ];

      const result = await rustService.calculateGlickoRatings(mockData);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty data gracefully', async () => {
      const result = await rustService.calculateGlickoRatings([]);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should validate input data', async () => {
      const invalidData = [
        {
          symbol: '', // Invalid empty symbol
          rating: -1, // Invalid negative rating
          deviation: 0, // Invalid zero deviation
          volatility: -0.1, // Invalid negative volatility
        }
      ];

      await expect(rustService.calculateGlickoRatings(invalidData as any))
        .rejects.toThrow();
    });
  });

  describe('Batch Processing', () => {
    it('should process large datasets in batches', async () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        symbol: `TEST${i}USDT`,
        rating: 1500 + (i % 100),
        deviation: 350 - (i % 50),
        volatility: 0.06 + (i % 10) * 0.001,
        timestamp: new Date(Date.now() - i * 1000).toISOString()
      }));

      const result = await rustService.processBatch(largeDataset, 1000);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle batch processing errors', async () => {
      const corruptedData = [
        null,
        undefined,
        { invalid: 'data' },
        { symbol: 'VALID', rating: 1500, deviation: 350, volatility: 0.06 }
      ];

      await expect(rustService.processBatch(corruptedData as any, 2))
        .rejects.toThrow();
    });
  });

  describe('Performance Optimization', () => {
    it('should optimize calculations for performance', async () => {
      const testData = Array.from({ length: 1000 }, (_, i) => ({
        symbol: `PERF${i}USDT`,
        rating: 1500,
        deviation: 350,
        volatility: 0.06,
        timestamp: new Date().toISOString()
      }));

      const startTime = Date.now();
      const result = await rustService.calculateGlickoRatings(testData);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should use SIMD optimization when available', () => {
      const hasSimdSupport = rustService.hasSimdSupport();
      expect(typeof hasSimdSupport).toBe('boolean');
    });

    it('should utilize multiple CPU cores', () => {
      const coreCount = rustService.getOptimalThreadCount();
      expect(coreCount).toBeGreaterThan(0);
      expect(coreCount).toBeLessThanOrEqual(16); // Reasonable upper bound
    });
  });

  describe('Error Handling', () => {
    it('should handle rust process crashes gracefully', async () => {
      // Mock process crash
      jest.spyOn(rustService as any, 'spawnRustProcess')
        .mockImplementation(() => {
          throw new Error('Process crashed');
        });

      await expect(rustService.calculateGlickoRatings([]))
        .rejects.toThrow('Process crashed');
    });

    it('should retry failed operations', async () => {
      let callCount = 0;
      jest.spyOn(rustService as any, 'executeRustCommand')
        .mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Temporary failure');
          }
          return { success: true, data: [] };
        });

      const result = await rustService.calculateGlickoRatings([]);
      expect(callCount).toBe(3);
      expect(result).toBeDefined();
    });
  });

  describe('Memory Management', () => {
    it('should track memory usage', () => {
      const memoryUsage = rustService.getMemoryUsage();
      expect(memoryUsage).toBeDefined();
      expect(memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(memoryUsage.heapTotal).toBeGreaterThan(0);
    });

    it('should cleanup resources properly', async () => {
      await rustService.initialize();
      expect(rustService.isInitialized()).toBe(true);
      
      rustService.cleanup();
      expect(rustService.isInitialized()).toBe(false);
    });

    it('should handle out of memory conditions', async () => {
      // Mock out of memory condition
      const hugeDataset = Array.from({ length: 1000000 }, () => ({
        symbol: 'TEST',
        rating: 1500,
        deviation: 350,
        volatility: 0.06,
        data: 'x'.repeat(10000) // Large string to consume memory
      }));

      await expect(rustService.processBatch(hugeDataset as any, 1000))
        .rejects.toThrow();
    });
  });

  describe('Configuration Management', () => {
    it('should load configuration correctly', () => {
      const config = rustService.getConfiguration();
      expect(config).toBeDefined();
      expect(config.version).toBeDefined();
      expect(config.features).toBeDefined();
    });

    it('should validate configuration parameters', () => {
      const validConfig = {
        threadCount: 4,
        batchSize: 1000,
        enableSimd: true
      };

      const isValid = rustService.validateConfiguration(validConfig);
      expect(isValid).toBe(true);
    });

    it('should reject invalid configuration', () => {
      const invalidConfig = {
        threadCount: -1, // Invalid negative thread count
        batchSize: 0, // Invalid zero batch size
        enableSimd: 'yes' // Invalid type
      };

      const isValid = rustService.validateConfiguration(invalidConfig as any);
      expect(isValid).toBe(false);
    });
  });
});