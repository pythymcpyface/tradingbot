/**
 * Unit tests for algorithm implementations
 */
import { SlidingWindowCalculations } from '../src/lib/algorithms/SlidingWindowCalculations';
import { VectorizedOperations } from '../src/lib/algorithms/VectorizedOperations';

describe('SlidingWindowCalculations', () => {
  describe('Static Moving Average Calculations', () => {
    it('should calculate moving averages correctly', () => {
      const dataPoints = [
        { value: 1, timestamp: new Date('2023-01-01') },
        { value: 2, timestamp: new Date('2023-01-02') },
        { value: 3, timestamp: new Date('2023-01-03') },
        { value: 4, timestamp: new Date('2023-01-04') },
        { value: 5, timestamp: new Date('2023-01-05') }
      ];
      const windowSize = 3;
      
      const result = SlidingWindowCalculations.calculateMovingAverages(dataPoints, windowSize);
      
      expect(result.values).toBeDefined();
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.statistics).toBeDefined();
      expect(result.statistics.count).toBeGreaterThan(0);
    });

    it('should handle edge cases for moving average', () => {
      // Empty array
      const emptyResult = SlidingWindowCalculations.calculateMovingAverages([], 3);
      expect(emptyResult.values.length).toBe(0);
      
      // Single data point
      const singlePoint = [{ value: 10, timestamp: new Date() }];
      const singleResult = SlidingWindowCalculations.calculateMovingAverages(singlePoint, 3);
      expect(singleResult.values.length).toBe(0); // Not enough data for window
    });
  });

  describe('Z-Score Calculations', () => {
    it('should calculate z-scores correctly', () => {
      const dataPoints = [];
      for (let i = 1; i <= 50; i++) {
        dataPoints.push({
          value: i + Math.random() * 5, // Add some variance
          timestamp: new Date(Date.now() + i * 1000)
        });
      }
      const windowSize = 20;
      
      const result = SlidingWindowCalculations.calculateZScores(dataPoints, windowSize);
      
      expect(result.values).toBeDefined();
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.statistics).toBeDefined();
    });

    it('should handle outliers in z-score calculation', () => {
      const dataWithOutlier = [
        { value: 10, timestamp: new Date('2023-01-01') },
        { value: 11, timestamp: new Date('2023-01-02') },
        { value: 12, timestamp: new Date('2023-01-03') },
        { value: 100, timestamp: new Date('2023-01-04') }, // Outlier
        { value: 13, timestamp: new Date('2023-01-05') },
        { value: 14, timestamp: new Date('2023-01-06') },
        { value: 15, timestamp: new Date('2023-01-07') }
      ];
      const windowSize = 4;
      
      const result = SlidingWindowCalculations.calculateZScores(dataWithOutlier, windowSize);
      expect(result.values).toBeDefined();
    });
  });

  describe('Rolling Standard Deviation', () => {
    it('should calculate rolling standard deviation', () => {
      const dataPoints = [];
      for (let i = 1; i <= 20; i++) {
        dataPoints.push({
          value: i * 2, // Linear progression
          timestamp: new Date(Date.now() + i * 1000)
        });
      }
      const windowSize = 5;
      
      const result = SlidingWindowCalculations.calculateRollingStandardDeviation(dataPoints, windowSize);
      
      expect(result.values).toBeDefined();
      expect(result.values.length).toBeGreaterThan(0);
      expect(result.statistics.standardDeviation).toBeGreaterThan(0);
    });
  });

  describe('Multiple Metrics Calculation', () => {
    it('should calculate multiple metrics efficiently', () => {
      const dataPoints = [];
      for (let i = 1; i <= 100; i++) {
        dataPoints.push({
          value: Math.sin(i * 0.1) * 50 + 100, // Sine wave pattern
          timestamp: new Date(Date.now() + i * 1000)
        });
      }
      const windowSize = 20;
      
      const result = SlidingWindowCalculations.calculateMultipleMetrics(
        dataPoints, 
        windowSize
      );
      
      expect(result.movingAverages).toBeDefined();
      expect(result.zScores).toBeDefined();
      expect(result.volatility).toBeDefined();
      expect(result.bollingerBands).toBeDefined();
    });
  });
});

describe('VectorizedOperations', () => {
  describe('Basic Vector Operations', () => {
    it('should add vectors correctly', () => {
      const a = new Float64Array([1, 2, 3, 4]);
      const b = new Float64Array([5, 6, 7, 8]);
      
      const result = VectorizedOperations.add(a, b);
      
      expect(Array.from(result)).toEqual([6, 8, 10, 12]);
    });

    it('should subtract vectors correctly', () => {
      const a = new Float64Array([10, 20, 30, 40]);
      const b = new Float64Array([1, 2, 3, 4]);
      
      const result = VectorizedOperations.subtract(a, b);
      
      expect(Array.from(result)).toEqual([9, 18, 27, 36]);
    });

    it('should multiply vectors element-wise', () => {
      const a = new Float64Array([2, 3, 4, 5]);
      const b = new Float64Array([1, 2, 3, 4]);
      
      const result = VectorizedOperations.multiply(a, b);
      
      expect(Array.from(result)).toEqual([2, 6, 12, 20]);
    });

    it('should divide vectors element-wise', () => {
      const a = new Float64Array([10, 20, 30, 40]);
      const b = new Float64Array([2, 4, 6, 8]);
      
      const result = VectorizedOperations.divide(a, b);
      
      expect(Array.from(result)).toEqual([5, 5, 5, 5]);
    });

    it('should handle mismatched vector sizes', () => {
      const a = new Float64Array([1, 2, 3]);
      const b = new Float64Array([4, 5]); // Different size
      
      expect(() => VectorizedOperations.add(a, b)).toThrow();
      expect(() => VectorizedOperations.subtract(a, b)).toThrow();
      expect(() => VectorizedOperations.multiply(a, b)).toThrow();
    });
  });

  describe('Scalar Operations', () => {
    it('should perform scalar addition correctly', () => {
      const vector = new Float64Array([1, 2, 3, 4]);
      const scalar = 5;
      
      const result = VectorizedOperations.scalarAdd(vector, scalar);
      
      expect(Array.from(result)).toEqual([6, 7, 8, 9]);
    });

    it('should perform scalar multiplication correctly', () => {
      const vector = new Float64Array([1, 2, 3, 4]);
      const scalar = 3;
      
      const result = VectorizedOperations.scalarMultiply(vector, scalar);
      
      expect(Array.from(result)).toEqual([3, 6, 9, 12]);
    });

    it('should perform scalar division correctly', () => {
      const vector = new Float64Array([10, 20, 30, 40]);
      const scalar = 2;
      
      const result = VectorizedOperations.scalarDivide(vector, scalar);
      
      expect(Array.from(result)).toEqual([5, 10, 15, 20]);
    });
  });

  describe('Mathematical Functions', () => {
    it('should calculate absolute values', () => {
      const vector = new Float64Array([-1, 2, -3, 4]);
      
      const result = VectorizedOperations.abs(vector);
      
      expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    });

    it('should calculate square roots', () => {
      const vector = new Float64Array([1, 4, 9, 16]);
      
      const result = VectorizedOperations.sqrt(vector);
      
      expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    });

    it('should calculate squares', () => {
      const vector = new Float64Array([1, 2, 3, 4]);
      
      const result = VectorizedOperations.square(vector);
      
      expect(Array.from(result)).toEqual([1, 4, 9, 16]);
    });
  });

  describe('Statistical Operations', () => {
    it('should calculate sum correctly', () => {
      const vector = new Float64Array([1, 2, 3, 4, 5]);
      
      const result = VectorizedOperations.sum(vector);
      
      expect(result).toBe(15);
    });

    it('should calculate mean correctly', () => {
      const vector = new Float64Array([2, 4, 6, 8]);
      
      const result = VectorizedOperations.mean(vector);
      
      expect(result).toBe(5);
    });

    it('should calculate variance correctly', () => {
      const vector = new Float64Array([2, 4, 6, 8]);
      
      const result = VectorizedOperations.variance(vector);
      
      expect(result).toBeCloseTo(5, 5); // Population variance
    });

    it('should calculate standard deviation correctly', () => {
      const vector = new Float64Array([2, 4, 6, 8]);
      
      const result = VectorizedOperations.standardDeviation(vector);
      
      expect(result).toBeCloseTo(Math.sqrt(5), 5);
    });

    it('should calculate Welford variance correctly', () => {
      const vector = new Float64Array([1, 2, 3, 4, 5]);
      
      const result = VectorizedOperations.welfordVariance(vector);
      
      expect(result.mean).toBe(3);
      expect(result.variance).toBeCloseTo(2, 5);
      expect(result.standardDeviation).toBeCloseTo(Math.sqrt(2), 5);
    });

    it('should calculate correlation correctly', () => {
      const a = new Float64Array([1, 2, 3, 4, 5]);
      const b = new Float64Array([2, 4, 6, 8, 10]); // Perfect positive correlation
      
      const result = VectorizedOperations.correlation(a, b);
      
      expect(result).toBeCloseTo(1, 5);
    });
  });

  describe('Performance Optimizations', () => {
    it('should handle large vectors efficiently', () => {
      const size = 10000;
      const a = new Float64Array(size);
      const b = new Float64Array(size);
      
      // Fill with random data
      for (let i = 0; i < size; i++) {
        a[i] = Math.random();
        b[i] = Math.random();
      }
      
      const startTime = Date.now();
      const result = VectorizedOperations.add(a, b);
      const endTime = Date.now();
      
      expect(result.length).toBe(size);
      expect(endTime - startTime).toBeLessThan(50); // Should be very fast
    });

    it('should maintain numerical precision', () => {
      // Test with very small numbers
      const smallNumbers = new Float64Array([1e-15, 2e-15, 3e-15]);
      const result = VectorizedOperations.sum(smallNumbers);
      
      expect(result).toBeCloseTo(6e-15, 20);
    });

    it('should handle edge cases gracefully', () => {
      // Empty arrays
      const empty = new Float64Array([]);
      expect(VectorizedOperations.sum(empty)).toBe(0);
      expect(VectorizedOperations.mean(empty)).toBe(0);
      
      // Single element
      const single = new Float64Array([42]);
      expect(VectorizedOperations.mean(single)).toBe(42);
      expect(VectorizedOperations.standardDeviation(single)).toBe(0);
    });
  });
});