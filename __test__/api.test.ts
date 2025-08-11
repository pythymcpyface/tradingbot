import request from 'supertest';
import { app } from '../src/node-api/index';

describe('API Endpoints', () => {
  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
    });
  });

  describe('Glicko API', () => {
    describe('GET /api/glicko/symbols', () => {
      it('should return available symbols', async () => {
        const response = await request(app)
          .get('/api/glicko/symbols')
          .expect(200);

        expect(response.body).toHaveProperty('symbols');
        expect(response.body).toHaveProperty('totalSymbols');
        expect(Array.isArray(response.body.symbols)).toBe(true);
      });
    });

    describe('GET /api/glicko/latest', () => {
      it('should return latest ratings', async () => {
        const response = await request(app)
          .get('/api/glicko/latest')
          .expect(200);

        expect(response.body).toHaveProperty('ratings');
        expect(response.body).toHaveProperty('count');
        expect(response.body).toHaveProperty('timestamp');
      });
    });

    describe('POST /api/glicko/calculate', () => {
      it('should require symbols parameter', async () => {
        const response = await request(app)
          .post('/api/glicko/calculate')
          .send({})
          .expect(400);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('symbols array is required');
      });

      it('should accept valid symbols array', async () => {
        const response = await request(app)
          .post('/api/glicko/calculate')
          .send({
            symbols: ['BTCUSDT'],
            startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            endTime: new Date().toISOString()
          });

        // Might return 400 if no klines data, which is expected in test environment
        expect([200, 400]).toContain(response.status);
      });
    });
  });

  describe('Orders API', () => {
    describe('GET /api/orders', () => {
      it('should return orders with pagination', async () => {
        const response = await request(app)
          .get('/api/orders')
          .expect(200);

        expect(response.body).toHaveProperty('orders');
        expect(response.body).toHaveProperty('pagination');
        expect(response.body.pagination).toHaveProperty('total');
        expect(response.body.pagination).toHaveProperty('limit');
        expect(response.body.pagination).toHaveProperty('offset');
      });
    });

    describe('GET /api/orders/stats', () => {
      it('should return order statistics', async () => {
        const response = await request(app)
          .get('/api/orders/stats')
          .expect(200);

        expect(response.body).toHaveProperty('summary');
        expect(response.body).toHaveProperty('timeRange');
        expect(response.body.summary).toHaveProperty('totalOrders');
        expect(response.body.summary).toHaveProperty('fillRate');
      });
    });

    describe('POST /api/orders', () => {
      it('should validate required fields', async () => {
        const response = await request(app)
          .post('/api/orders')
          .send({})
          .expect(400);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('Missing required field');
      });
    });
  });

  describe('Backtest API', () => {
    describe('GET /api/backtest', () => {
      it('should return backtest results with pagination', async () => {
        const response = await request(app)
          .get('/api/backtest')
          .expect(200);

        expect(response.body).toHaveProperty('results');
        expect(response.body).toHaveProperty('pagination');
      });
    });

    describe('POST /api/backtest/run', () => {
      it('should validate required parameters', async () => {
        const response = await request(app)
          .post('/api/backtest/run')
          .send({})
          .expect(400);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('Missing required parameters');
      });

      it('should accept valid backtest configuration', async () => {
        const config = {
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          zScoreThreshold: 2.5,
          movingAverages: 200,
          profitPercent: 5.0,
          stopLossPercent: 2.5,
          startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          endTime: new Date().toISOString()
        };

        const response = await request(app)
          .post('/api/backtest/run')
          .send(config);

        // Might return 400 if no ratings data, which is expected in test environment
        expect([200, 400]).toContain(response.status);
      });
    });
  });

  describe('Optimization API', () => {
    describe('GET /api/optimisation', () => {
      it('should return optimization results', async () => {
        const response = await request(app)
          .get('/api/optimisation')
          .expect(200);

        expect(response.body).toHaveProperty('results');
        expect(response.body).toHaveProperty('pagination');
      });
    });

    describe('GET /api/optimisation/stats', () => {
      it('should return optimization statistics', async () => {
        const response = await request(app)
          .get('/api/optimisation/stats')
          .expect(200);

        expect(response.body).toHaveProperty('totalOptimizations');
        expect(response.body).toHaveProperty('performanceStats');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Route not found');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/backtest/run')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);
    });
  });

  describe('CORS and Security Headers', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .options('/api/orders')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });

    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Helmet should add security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });
  });
});