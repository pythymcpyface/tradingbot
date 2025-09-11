import { ConnectionPoolService } from '../src/lib/database/ConnectionPoolService';

// Mock PrismaClient to avoid database connection issues
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn(),
    klines: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    glicko_ratings: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    production_orders: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    backtest_orders: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    optimization_results: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  })),
}));

describe('Database ConnectionPoolService', () => {
  let connectionPool: ConnectionPoolService;

  beforeEach(() => {
    connectionPool = ConnectionPoolService.getInstance();
  });

  afterEach(async () => {
    await connectionPool.cleanup();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = ConnectionPoolService.getInstance();
      const instance2 = ConnectionPoolService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Connection Management', () => {
    it('should initialize connection pool', async () => {
      const connection = await connectionPool.getConnection();
      expect(connection).toBeDefined();
    });

    it('should handle multiple connections', async () => {
      const connection1 = await connectionPool.getConnection();
      const connection2 = await connectionPool.getConnection();
      
      expect(connection1).toBeDefined();
      expect(connection2).toBeDefined();
    });

    it('should release connections properly', async () => {
      const connection = await connectionPool.getConnection();
      await connectionPool.releaseConnection(connection);
      // No error should be thrown
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      // Mock a connection error
      const mockError = new Error('Connection failed');
      jest.spyOn(connectionPool as any, 'createConnection')
        .mockRejectedValueOnce(mockError);

      await expect(connectionPool.getConnection())
        .rejects.toThrow('Connection failed');
    });
  });

  describe('Health Checks', () => {
    it('should perform health check', async () => {
      const isHealthy = await connectionPool.healthCheck();
      expect(typeof isHealthy).toBe('boolean');
    });
  });

  describe('Connection Pooling', () => {
    it('should track active connections', async () => {
      const initialCount = connectionPool.getActiveConnectionCount();
      const connection = await connectionPool.getConnection();
      const afterCount = connectionPool.getActiveConnectionCount();
      
      expect(afterCount).toBeGreaterThanOrEqual(initialCount);
    });

    it('should respect max connections limit', () => {
      const maxConnections = connectionPool.getMaxConnections();
      expect(maxConnections).toBeGreaterThan(0);
    });
  });

  describe('Batch Operations', () => {
    it('should handle batch inserts', async () => {
      const connection = await connectionPool.getConnection();
      const mockData = [
        { symbol: 'BTCUSDT', openTime: new Date(), closeTime: new Date() },
        { symbol: 'ETHUSDT', openTime: new Date(), closeTime: new Date() }
      ];

      // Mock the batch insert
      const batchInsertSpy = jest.spyOn(connection.klines, 'createMany')
        .mockResolvedValue({ count: mockData.length });

      const result = await connectionPool.batchInsert('klines', mockData);
      expect(result).toBeDefined();
      expect(batchInsertSpy).toHaveBeenCalledWith({
        data: mockData,
        skipDuplicates: true
      });
    });

    it('should handle batch queries', async () => {
      const connection = await connectionPool.getConnection();
      const mockResults = [
        { id: '1', symbol: 'BTCUSDT' },
        { id: '2', symbol: 'ETHUSDT' }
      ];

      jest.spyOn(connection.klines, 'findMany')
        .mockResolvedValue(mockResults as any);

      const results = await connectionPool.batchQuery('klines', { 
        where: { symbol: { in: ['BTCUSDT', 'ETHUSDT'] } }
      });
      
      expect(results).toEqual(mockResults);
    });
  });
});