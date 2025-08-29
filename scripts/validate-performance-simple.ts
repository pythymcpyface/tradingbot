#!/usr/bin/env ts-node

/**
 * Simplified Performance Validation
 * 
 * Tests core performance optimizations without complex dependencies.
 * Validates database improvements, algorithmic optimizations, and memory efficiency.
 */

import { SlidingWindowCalculations } from '../src/lib/algorithms/SlidingWindowCalculations';
import { VectorizedOperations } from '../src/lib/algorithms/VectorizedOperations';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

interface ValidationResult {
  category: string;
  test: string;
  passed: boolean;
  expected: number;
  actual: number;
  improvement: number;
  error?: string;
}

class SimplePerformanceValidator {
  private prisma: PrismaClient;
  private results: ValidationResult[] = [];

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    console.log('🔧 Initializing simple performance validation...');
    await this.prisma.$connect();
    console.log('✅ Database connected');
  }

  async runValidation(): Promise<void> {
    console.log('\n🎯 Starting Performance Validation Suite');
    console.log('=' .repeat(80));

    // Algorithm performance validation
    await this.validateAlgorithmPerformance();

    // Memory optimization validation
    await this.validateMemoryOptimizations();

    // Database performance validation
    await this.validateDatabasePerformance();

    // Generate final report
    this.generateValidationReport();
  }

  /**
   * Validate algorithm performance improvements
   */
  private async validateAlgorithmPerformance(): Promise<void> {
    console.log('\n🧮 Validating Algorithm Performance...');

    const testDataSizes = [1000, 5000, 10000];
    const windowSize = 50;

    for (const dataSize of testDataSizes) {
      const testData = this.generateTestData(dataSize);

      // Test optimized sliding window z-score
      const optimizedStart = performance.now();
      const optimizedResult = SlidingWindowCalculations.calculateZScores(testData, windowSize);
      const optimizedTime = performance.now() - optimizedStart;

      // Test naive implementation
      const naiveStart = performance.now();
      const naiveTime = this.naiveZScoreCalculation(testData, windowSize);
      const naiveTotalTime = performance.now() - naiveStart;

      const improvement = naiveTotalTime / optimizedTime;
      const targetImprovement = Math.floor(dataSize / 100); // Scale with data size

      this.results.push({
        category: 'Algorithm',
        test: `Z-Score Calculation (${dataSize} points)`,
        passed: improvement > targetImprovement * 0.8,
        expected: targetImprovement,
        actual: improvement,
        improvement
      });

      console.log(`   Z-Score (${dataSize} points): ${improvement.toFixed(1)}x improvement (target: ${targetImprovement}x)`);
    }

    // Test vectorized operations
    await this.validateVectorizedOperations();
  }

  /**
   * Validate vectorized operations performance
   */
  private async validateVectorizedOperations(): Promise<void> {
    const size = 100000;
    const a = new Float64Array(size).map(() => Math.random());
    const b = new Float64Array(size).map(() => Math.random());

    // Vectorized operations
    const vectorStart = performance.now();
    const vectorResult = VectorizedOperations.add(a, b);
    const vectorMean = VectorizedOperations.mean(vectorResult);
    const vectorStd = VectorizedOperations.standardDeviation(vectorResult);
    const vectorTime = performance.now() - vectorStart;

    // Regular array operations
    const regularStart = performance.now();
    const regularResult = new Array(size);
    for (let i = 0; i < size; i++) {
      regularResult[i] = a[i] + b[i];
    }
    const regularSum = regularResult.reduce((sum, val) => sum + val, 0);
    const regularMean = regularSum / size;
    let regularSumSquares = 0;
    for (let i = 0; i < size; i++) {
      regularSumSquares += Math.pow(regularResult[i] - regularMean, 2);
    }
    const regularStd = Math.sqrt(regularSumSquares / size);
    const regularTime = performance.now() - regularStart;

    const improvement = regularTime / vectorTime;

    this.results.push({
      category: 'Algorithm',
      test: 'Vectorized Operations',
      passed: improvement > 3,
      expected: 5,
      actual: improvement,
      improvement
    });

    console.log(`   Vectorized operations: ${improvement.toFixed(1)}x improvement (target: 5x)`);
  }

  /**
   * Validate memory optimization effectiveness
   */
  private async validateMemoryOptimizations(): Promise<void> {
    console.log('\n💾 Validating Memory Optimizations...');

    const initialMemory = process.memoryUsage().heapUsed;

    // Test memory-efficient data structures
    const testData = this.generateLargeDataset(50000);
    
    // Use optimized typed arrays
    const optimizedStart = process.memoryUsage().heapUsed;
    const typedArray = new Float64Array(testData.map(d => d.value));
    const optimizedOperations = VectorizedOperations.mean(typedArray);
    const optimizedMemory = process.memoryUsage().heapUsed - optimizedStart;

    // Use regular arrays
    const regularStart = process.memoryUsage().heapUsed;
    const regularArray = testData.map(d => d.value);
    const regularOperations = regularArray.reduce((sum, val) => sum + val, 0) / regularArray.length;
    const regularMemory = process.memoryUsage().heapUsed - regularStart;

    const memoryImprovement = regularMemory / optimizedMemory;

    this.results.push({
      category: 'Memory',
      test: 'Typed Array Memory Efficiency',
      passed: memoryImprovement > 1.5,
      expected: 2.0,
      actual: memoryImprovement,
      improvement: memoryImprovement
    });

    console.log(`   Memory efficiency: ${memoryImprovement.toFixed(1)}x improvement (target: 2x)`);
  }

  /**
   * Validate database performance improvements
   */
  private async validateDatabasePerformance(): Promise<void> {
    console.log('\n🗄️ Validating Database Performance...');

    try {
      // Test basic query performance
      const queryStart = performance.now();
      const glickoRatings = await this.prisma.glickoRatings.findMany({
        where: { symbol: 'ETHUSDT' },
        take: 1000,
        orderBy: { timestamp: 'desc' }
      });
      const queryTime = performance.now() - queryStart;

      // Basic improvement check (should be under 100ms for 1000 records)
      const passed = queryTime < 100;
      const improvement = 1000 / queryTime; // ops per second

      this.results.push({
        category: 'Database',
        test: 'Glicko Ratings Query',
        passed,
        expected: 10, // 10 ops/sec minimum
        actual: improvement,
        improvement
      });

      console.log(`   Database query: ${improvement.toFixed(1)} ops/sec (${queryTime.toFixed(1)}ms)`);

    } catch (error) {
      this.results.push({
        category: 'Database',
        test: 'Glicko Ratings Query',
        passed: false,
        expected: 10,
        actual: 0,
        improvement: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generate final validation report
   */
  private generateValidationReport(): void {
    console.log('\n📋 Performance Validation Report');
    console.log('=' .repeat(80));

    // Group results by category
    const categories = [...new Set(this.results.map(r => r.category))];
    
    for (const category of categories) {
      const categoryResults = this.results.filter(r => r.category === category);
      const passed = categoryResults.filter(r => r.passed).length;
      const total = categoryResults.length;
      
      console.log(`\n📊 ${category} Performance (${passed}/${total} passed):`);
      
      for (const result of categoryResults) {
        const status = result.passed ? '✅' : '❌';
        const improvement = result.improvement > 0 ? `${result.improvement.toFixed(1)}x` : 'N/A';
        const expected = result.expected > 0 ? `${result.expected.toFixed(1)}x` : 'N/A';
        
        console.log(`   ${status} ${result.test}: ${improvement} (target: ${expected})`);
        
        if (result.error) {
          console.log(`      Error: ${result.error}`);
        }
      }
    }

    // Overall summary
    const totalPassed = this.results.filter(r => r.passed).length;
    const totalTests = this.results.length;
    const successRate = (totalPassed / totalTests) * 100;

    console.log(`\n🏆 Overall Results:`);
    console.log(`   Tests passed: ${totalPassed}/${totalTests} (${successRate.toFixed(1)}%)`);
    console.log(`   Performance targets met: ${successRate >= 80 ? 'YES' : 'NO'}`);

    // Performance improvements summary
    const performanceResults = this.results.filter(r => r.improvement > 0);
    if (performanceResults.length > 0) {
      const avgImprovement = performanceResults.reduce((sum, r) => sum + r.improvement, 0) / performanceResults.length;
      console.log(`   Average performance improvement: ${avgImprovement.toFixed(1)}x`);
    }

    if (successRate >= 80) {
      console.log('\n🎉 Performance optimization validation: SUCCESS');
      console.log('   Key optimizations are working correctly');
    } else {
      console.log('\n⚠️ Performance optimization validation: NEEDS ATTENTION');
      console.log('   Some performance targets not met');
    }
  }

  /**
   * Helper methods
   */
  private generateTestData(count: number): Array<{ value: number; timestamp: Date }> {
    const data = [];
    const startDate = new Date('2024-01-01');
    
    for (let i = 0; i < count; i++) {
      data.push({
        value: Math.random() * 100 + 50, // Values between 50-150
        timestamp: new Date(startDate.getTime() + i * 60 * 60 * 1000) // Hourly data
      });
    }
    
    return data;
  }

  private generateLargeDataset(count: number): Array<{ value: number; timestamp: Date }> {
    return this.generateTestData(count);
  }

  private naiveZScoreCalculation(data: Array<{ value: number; timestamp: Date }>, windowSize: number): number {
    const start = performance.now();
    
    // Intentionally inefficient O(n²) implementation
    for (let i = windowSize; i < data.length; i++) {
      const window = data.slice(i - windowSize, i).map(d => d.value);
      const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);
      const zScore = stdDev > 0 ? (data[i].value - mean) / stdDev : 0;
    }
    
    return performance.now() - start;
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Main execution function
 */
async function main() {
  const validator = new SimplePerformanceValidator();

  try {
    console.log('🎯 Simple Performance Validation Starting...');
    console.log('=' .repeat(80));

    await validator.initialize();
    await validator.runValidation();

    console.log('\n✅ Performance validation completed!');

  } catch (error) {
    console.error('\n❌ Performance validation failed:', error);
    process.exit(1);
  } finally {
    await validator.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { SimplePerformanceValidator };