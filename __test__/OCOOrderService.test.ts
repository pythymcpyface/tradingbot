import { OCOOrderService } from '../src/services/OCOOrderService';

describe('OCOOrderService', () => {
  let service: OCOOrderService;

  beforeEach(() => {
    service = new OCOOrderService();
  });

  describe('calculateOCOPrices', () => {
    it('should calculate take profit and stop loss prices correctly', () => {
      const prices = service.calculateOCOPrices(100, 2.0, 2.0);

      expect(prices.takeProfitPrice).toBe(102.0);
      expect(prices.stopLossPrice).toBe(98.0);
      expect(prices.stopLimitPrice).toBeCloseTo(97.9, 5);
    });

    it('should handle different profit and stop loss percentages', () => {
      const prices = service.calculateOCOPrices(1000, 5.0, 3.0);

      expect(prices.takeProfitPrice).toBe(1050.0);
      expect(prices.stopLossPrice).toBe(970.0);
      expect(prices.stopLimitPrice).toBeCloseTo(969.0, 5);
    });

    it('should throw error for zero entry price', () => {
      expect(() => service.calculateOCOPrices(0, 2.0, 2.0)).toThrow('Entry price must be greater than 0');
    });

    it('should throw error for negative entry price', () => {
      expect(() => service.calculateOCOPrices(-100, 2.0, 2.0)).toThrow('Entry price must be greater than 0');
    });

    it('should throw error for zero profit percent', () => {
      expect(() => service.calculateOCOPrices(100, 0, 2.0)).toThrow('Profit percent must be greater than 0');
    });

    it('should throw error for zero stop loss percent', () => {
      expect(() => service.calculateOCOPrices(100, 2.0, 0)).toThrow('Stop loss percent must be greater than 0');
    });

    it('should handle small entry prices', () => {
      const prices = service.calculateOCOPrices(0.001, 2.0, 2.0);

      expect(prices.takeProfitPrice).toBeCloseTo(0.00102, 8);
      expect(prices.stopLossPrice).toBeCloseTo(0.00098, 8);
    });

    it('should handle large entry prices', () => {
      const prices = service.calculateOCOPrices(50000, 2.0, 2.0);

      expect(prices.takeProfitPrice).toBe(51000);
      expect(prices.stopLossPrice).toBe(49000);
    });
  });

  describe('formatPriceForBinance', () => {
    it('should format price with default 8 decimals', () => {
      const formatted = service.formatPriceForBinance(0.12345678901234);

      expect(formatted).toBe('0.12345679');
    });

    it('should format price with custom decimals', () => {
      const formatted = service.formatPriceForBinance(100.123456, 2);

      expect(formatted).toBe('100.12');
    });

    it('should handle whole numbers', () => {
      const formatted = service.formatPriceForBinance(1000, 8);

      expect(formatted).toBe('1000.00000000');
    });
  });

  describe('checkOCOCondition', () => {
    it('should trigger take profit when price reaches TP', () => {
      const result = service.checkOCOCondition(105, 102, 98);

      expect(result.triggered).toBe(true);
      expect(result.type).toBe('TAKE_PROFIT');
      expect(result.exitPrice).toBe(102);
    });

    it('should trigger stop loss when price reaches SL', () => {
      const result = service.checkOCOCondition(97, 102, 98);

      expect(result.triggered).toBe(true);
      expect(result.type).toBe('STOP_LOSS');
      expect(result.exitPrice).toBe(98);
    });

    it('should not trigger when price is between TP and SL', () => {
      const result = service.checkOCOCondition(100, 102, 98);

      expect(result.triggered).toBe(false);
      expect(result.type).toBe('NONE');
      expect(result.exitPrice).toBeUndefined();
    });

    it('should trigger TP exactly at threshold', () => {
      const result = service.checkOCOCondition(102, 102, 98);

      expect(result.triggered).toBe(true);
      expect(result.type).toBe('TAKE_PROFIT');
    });

    it('should trigger SL exactly at threshold', () => {
      const result = service.checkOCOCondition(98, 102, 98);

      expect(result.triggered).toBe(true);
      expect(result.type).toBe('STOP_LOSS');
    });

    it('should prioritize TP when price is above both thresholds', () => {
      const result = service.checkOCOCondition(105, 102, 98);

      expect(result.type).toBe('TAKE_PROFIT');
    });
  });

  describe('calculateProfitLoss', () => {
    it('should calculate profit correctly', () => {
      const result = service.calculateProfitLoss(100, 105, 10);

      expect(result.pnl).toBe(50);
      expect(result.pnlPercent).toBe(5);
    });

    it('should calculate loss correctly', () => {
      const result = service.calculateProfitLoss(100, 95, 10);

      expect(result.pnl).toBe(-50);
      expect(result.pnlPercent).toBe(-5);
    });

    it('should handle zero profit/loss', () => {
      const result = service.calculateProfitLoss(100, 100, 10);

      expect(result.pnl).toBe(0);
      expect(result.pnlPercent).toBe(0);
    });

    it('should handle fractional quantities', () => {
      const result = service.calculateProfitLoss(100, 110, 0.5);

      expect(result.pnl).toBe(5);
      expect(result.pnlPercent).toBe(10);
    });

    it('should handle large quantities', () => {
      const result = service.calculateProfitLoss(100, 102, 1000);

      expect(result.pnl).toBe(2000);
      expect(result.pnlPercent).toBe(2);
    });
  });

  describe('validateOCOPrices', () => {
    it('should validate correct OCO prices', () => {
      const result = service.validateOCOPrices(100, 102, 98);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject TP below entry price', () => {
      const result = service.validateOCOPrices(100, 95, 98);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Take profit price (95) must be greater than entry price (100)');
    });

    it('should reject SL above entry price', () => {
      const result = service.validateOCOPrices(100, 105, 102);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Stop loss price (102) must be less than entry price (100)');
    });

    it('should reject negative SL', () => {
      const result = service.validateOCOPrices(100, 105, -5);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Stop loss price (-5) must be greater than 0');
    });

    it('should accumulate multiple errors', () => {
      const result = service.validateOCOPrices(100, 95, 105);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('calculateAllocationAmount', () => {
    it('should calculate allocation correctly', () => {
      const amount = service.calculateAllocationAmount(10000, 10);

      expect(amount).toBe(1000);
    });

    it('should handle 100% allocation', () => {
      const amount = service.calculateAllocationAmount(10000, 100);

      expect(amount).toBe(10000);
    });

    it('should handle small percentages', () => {
      const amount = service.calculateAllocationAmount(10000, 1);

      expect(amount).toBe(100);
    });

    it('should throw error for negative balance', () => {
      expect(() => service.calculateAllocationAmount(-1000, 10)).toThrow('Total balance must be greater than or equal to 0');
    });

    it('should throw error for zero allocation percent', () => {
      expect(() => service.calculateAllocationAmount(10000, 0)).toThrow('Allocation percent must be between 0 and 100');
    });

    it('should throw error for allocation percent > 100', () => {
      expect(() => service.calculateAllocationAmount(10000, 150)).toThrow('Allocation percent must be between 0 and 100');
    });

    it('should handle zero balance', () => {
      const amount = service.calculateAllocationAmount(0, 10);

      expect(amount).toBe(0);
    });
  });

  describe('calculatePositionSize', () => {
    it('should calculate position size correctly', () => {
      const size = service.calculatePositionSize(1000, 100);

      expect(size).toBe(10);
    });

    it('should handle fractional results', () => {
      const size = service.calculatePositionSize(1000, 300);

      expect(size).toBeCloseTo(3.3333, 4);
    });

    it('should handle small allocation amounts', () => {
      const size = service.calculatePositionSize(10, 50000);

      expect(size).toBe(0.0002);
    });

    it('should throw error for zero allocation', () => {
      expect(() => service.calculatePositionSize(0, 100)).toThrow('Allocation amount must be greater than 0');
    });

    it('should throw error for negative allocation', () => {
      expect(() => service.calculatePositionSize(-100, 100)).toThrow('Allocation amount must be greater than 0');
    });

    it('should throw error for zero entry price', () => {
      expect(() => service.calculatePositionSize(1000, 0)).toThrow('Entry price must be greater than 0');
    });
  });
});
