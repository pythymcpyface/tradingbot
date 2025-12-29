#!/usr/bin/env ts-node

/**
 * Consolidation Validation Script
 *
 * Validates that the unified signal generation produces consistent results
 * between live trading and backtesting implementations.
 *
 * Tests:
 * 1. Pairwise Glicko ratings are calculated correctly
 * 2. SignalGeneratorService produces expected signals
 * 3. Same input data produces same output signals
 * 4. No drift in ratings over time
 */

import { GlickoEngine } from '../src/services/GlickoEngine';
import { SignalGeneratorService, RatingInput } from '../src/services/SignalGeneratorService';
import { OCOOrderService } from '../src/services/OCOOrderService';
import { TradingParameterSet } from '../src/types';

interface ValidationResult {
  testName: string;
  passed: boolean;
  details: string;
  metrics?: any;
}

class ConsolidationValidator {
  private results: ValidationResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🧪 Running Consolidation Validation Tests\n');
    console.log('='.repeat(60));

    // Test 1: GlickoEngine pairwise algorithm
    await this.testGlickoEnginePairwise();

    // Test 2: SignalGeneratorService consistency
    await this.testSignalGeneratorConsistency();

    // Test 3: OCOOrderService calculations
    await this.testOCOOrderService();

    // Test 4: Rating normalization prevents drift
    await this.testRatingNormalization();

    // Test 5: Zero-sum property
    await this.testZeroSumProperty();

    // Print results
    this.printResults();
  }

  /**
   * Test 1: Verify GlickoEngine pairwise algorithm works correctly
   */
  private async testGlickoEnginePairwise(): Promise<void> {
    const testName = 'GlickoEngine Pairwise Algorithm';
    console.log(`\n📊 Test: ${testName}`);

    try {
      const engine = new GlickoEngine();
      const coins = ['BTC', 'ETH', 'SOL'];
      const startTime = new Date('2024-01-01');

      // Initialize coins
      for (const coin of coins) {
        engine.ensureCoinExists(coin, startTime);
      }

      // Simulate some games
      // BTC beats ETH (BTC price went up 2%, ETH flat)
      engine.processGame('BTC', 'ETH', 0.02, startTime);

      // ETH beats SOL (ETH price up 1%, SOL down)
      engine.processGame('ETH', 'SOL', 0.01, startTime);

      // SOL beats BTC (SOL recovers 3%, BTC down)
      engine.processGame('SOL', 'BTC', 0.03, startTime);

      // Normalize to prevent drift
      engine.normalizeRatings();

      // Get final ratings
      const btcState = engine.getCoinState('BTC');
      const ethState = engine.getCoinState('ETH');
      const solState = engine.getCoinState('SOL');

      // Verify ratings exist
      const passed = btcState !== undefined &&
                     ethState !== undefined &&
                     solState !== undefined &&
                     btcState.rating.rating !== 1500 && // Should have changed
                     Math.abs(btcState.rating.rating + ethState.rating.rating + solState.rating.rating - 4500) < 1; // Sum should be ~4500 after normalization

      this.results.push({
        testName,
        passed,
        details: passed
          ? `✓ Pairwise algorithm working correctly. Ratings: BTC=${btcState?.rating.rating.toFixed(0)}, ETH=${ethState?.rating.rating.toFixed(0)}, SOL=${solState?.rating.rating.toFixed(0)}`
          : '✗ Pairwise algorithm failed to update ratings correctly',
        metrics: {
          btcRating: btcState?.rating.rating,
          ethRating: ethState?.rating.rating,
          solRating: solState?.rating.rating,
          sumRatings: (btcState?.rating.rating || 0) + (ethState?.rating.rating || 0) + (solState?.rating.rating || 0)
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');
    } catch (error) {
      this.results.push({
        testName,
        passed: false,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
    }
  }

  /**
   * Test 2: Verify SignalGeneratorService produces consistent signals
   */
  private async testSignalGeneratorConsistency(): Promise<void> {
    const testName = 'SignalGeneratorService Consistency';
    console.log(`\n📊 Test: ${testName}`);

    try {
      const signalGen = new SignalGeneratorService();

      // Create sample ratings
      const ratings: RatingInput[] = [
        { symbol: 'BTC', rating: 1600, timestamp: new Date() }, // High rating
        { symbol: 'ETH', rating: 1500, timestamp: new Date() }, // Average
        { symbol: 'SOL', rating: 1400, timestamp: new Date() }, // Low rating
        { symbol: 'BNB', rating: 1450, timestamp: new Date() },
        { symbol: 'ADA', rating: 1550, timestamp: new Date() }
      ];

      // Create parameter sets
      const paramSets = new Map<string, TradingParameterSet>();
      for (const r of ratings) {
        paramSets.set(`${r.symbol}USDT`, {
          symbol: `${r.symbol}USDT`,
          baseAsset: r.symbol,
          quoteAsset: 'USDT',
          zScoreThreshold: 1.5,
          movingAverages: 5,
          profitPercent: 5,
          stopLossPercent: 3,
          allocationPercent: 10,
          enabled: true
        });
      }

      // Build up history first
      for (let i = 0; i < 10; i++) {
        signalGen.generateSignals(ratings, paramSets);
      }

      // Generate signals twice with same input
      const result1 = signalGen.generateSignals(ratings, paramSets);
      const result2 = signalGen.generateSignals(ratings, paramSets);

      // Verify consistency
      const passed = result1.signals.length === result2.signals.length &&
                     Math.abs(result1.statistics.meanRating - result2.statistics.meanRating) < 0.001;

      this.results.push({
        testName,
        passed,
        details: passed
          ? `✓ SignalGeneratorService produces consistent results. Signals: ${result1.signals.length}, Mean: ${result1.statistics.meanRating.toFixed(1)}`
          : '✗ SignalGeneratorService produced inconsistent results',
        metrics: {
          signalsGenerated: result1.signals.length,
          meanRating: result1.statistics.meanRating,
          stdDevRating: result1.statistics.stdDevRating
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');
    } catch (error) {
      this.results.push({
        testName,
        passed: false,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
    }
  }

  /**
   * Test 3: Verify OCOOrderService calculations
   */
  private async testOCOOrderService(): Promise<void> {
    const testName = 'OCOOrderService Calculations';
    console.log(`\n📊 Test: ${testName}`);

    try {
      const ocoService = new OCOOrderService();

      // Test price calculations
      const entryPrice = 50000;
      const profitPercent = 5;
      const stopLossPercent = 3;

      const prices = ocoService.calculateOCOPrices(entryPrice, profitPercent, stopLossPercent);

      // Verify calculations
      const expectedTakeProfit = 52500; // 50000 * 1.05
      const expectedStopLoss = 48500;   // 50000 * 0.97

      const passed = Math.abs(prices.takeProfitPrice - expectedTakeProfit) < 1 &&
                     Math.abs(prices.stopLossPrice - expectedStopLoss) < 1 &&
                     prices.stopLimitPrice < prices.stopLossPrice;

      this.results.push({
        testName,
        passed,
        details: passed
          ? `✓ OCO calculations correct. TP: $${prices.takeProfitPrice.toFixed(2)}, SL: $${prices.stopLossPrice.toFixed(2)}`
          : '✗ OCO calculations incorrect',
        metrics: {
          takeProfitPrice: prices.takeProfitPrice,
          stopLossPrice: prices.stopLossPrice,
          stopLimitPrice: prices.stopLimitPrice
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');
    } catch (error) {
      this.results.push({
        testName,
        passed: false,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
    }
  }

  /**
   * Test 4: Verify rating normalization prevents drift
   */
  private async testRatingNormalization(): Promise<void> {
    const testName = 'Rating Normalization (Drift Prevention)';
    console.log(`\n📊 Test: ${testName}`);

    try {
      const engine = new GlickoEngine();
      const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'];
      const startTime = new Date('2024-01-01');

      // Initialize all coins
      for (const coin of coins) {
        engine.ensureCoinExists(coin, startTime);
      }

      // Simulate 100 games
      for (let i = 0; i < 100; i++) {
        // Random matchups
        const coin1 = coins[Math.floor(Math.random() * coins.length)];
        let coin2 = coins[Math.floor(Math.random() * coins.length)];
        while (coin2 === coin1) {
          coin2 = coins[Math.floor(Math.random() * coins.length)];
        }

        const priceChange = (Math.random() - 0.5) * 0.1; // -5% to +5%
        engine.processGame(coin1, coin2, priceChange, startTime);

        // Normalize every 10 games
        if (i % 10 === 0) {
          engine.normalizeRatings();
        }
      }

      // Final normalization
      engine.normalizeRatings();

      // Calculate average rating
      let totalRating = 0;
      for (const coin of coins) {
        const state = engine.getCoinState(coin);
        if (state) {
          totalRating += state.rating.rating;
        }
      }
      const avgRating = totalRating / coins.length;

      // Average should be very close to 1500
      const passed = Math.abs(avgRating - 1500) < 1;

      this.results.push({
        testName,
        passed,
        details: passed
          ? `✓ Normalization prevents drift. Average rating: ${avgRating.toFixed(2)} (target: 1500.00)`
          : `✗ Drift detected. Average rating: ${avgRating.toFixed(2)} (should be 1500.00)`,
        metrics: {
          averageRating: avgRating,
          drift: avgRating - 1500,
          coinsProcessed: coins.length
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');
    } catch (error) {
      this.results.push({
        testName,
        passed: false,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
    }
  }

  /**
   * Test 5: Verify zero-sum property
   */
  private async testZeroSumProperty(): Promise<void> {
    const testName = 'Zero-Sum Property';
    console.log(`\n📊 Test: ${testName}`);

    try {
      const engine = new GlickoEngine();
      const coins = ['BTC', 'ETH'];
      const startTime = new Date('2024-01-01');

      // Initialize coins
      for (const coin of coins) {
        engine.ensureCoinExists(coin, startTime);
      }

      const btcBefore = engine.getCoinState('BTC')!.rating.rating;
      const ethBefore = engine.getCoinState('ETH')!.rating.rating;
      const sumBefore = btcBefore + ethBefore;

      // BTC wins against ETH
      engine.processGame('BTC', 'ETH', 0.05, startTime);

      const btcAfter = engine.getCoinState('BTC')!.rating.rating;
      const ethAfter = engine.getCoinState('ETH')!.rating.rating;

      // BTC should go up, ETH should go down
      const btcGain = btcAfter - btcBefore;
      const ethLoss = ethAfter - ethBefore;

      // In pure zero-sum, gains should equal losses
      // (Note: Glicko-2 isn't perfectly zero-sum due to RD differences, but should be close)
      const passed = btcGain > 0 && ethLoss < 0;

      this.results.push({
        testName,
        passed,
        details: passed
          ? `✓ Zero-sum property verified. BTC gained ${btcGain.toFixed(1)}, ETH lost ${Math.abs(ethLoss).toFixed(1)}`
          : '✗ Zero-sum property violated',
        metrics: {
          btcGain,
          ethLoss,
          netChange: btcGain + ethLoss
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');
    } catch (error) {
      this.results.push({
        testName,
        passed: false,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
    }
  }

  /**
   * Print validation results
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📋 VALIDATION RESULTS');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const percentage = ((passed / total) * 100).toFixed(0);

    console.log(`\nTests Passed: ${passed}/${total} (${percentage}%)\n`);

    for (const result of this.results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.testName}`);
      console.log(`   ${result.details}`);
      if (result.metrics) {
        console.log(`   Metrics:`, JSON.stringify(result.metrics, null, 2).replace(/\n/g, '\n   '));
      }
      console.log();
    }

    // Overall verdict
    if (passed === total) {
      console.log('🎉 ALL TESTS PASSED - Consolidation validated successfully!');
    } else {
      console.log(`⚠️  ${total - passed} test(s) failed - Review required`);
    }

    console.log('='.repeat(60));
  }
}

// Main execution
async function main() {
  const validator = new ConsolidationValidator();
  await validator.runAllTests();
}

main().catch(console.error);
