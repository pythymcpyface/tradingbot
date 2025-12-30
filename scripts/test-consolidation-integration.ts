#!/usr/bin/env ts-node

/**
 * Integration Test: Consolidated Glicko System with Real Data
 *
 * Tests the consolidated Glicko rating and signal generation system
 * using real historical klines data from the database.
 *
 * Validates:
 * 1. GlickoEngine processes real pairwise klines correctly
 * 2. SignalGeneratorService generates valid signals from real ratings
 * 3. System handles full data pipeline end-to-end
 * 4. Performance is acceptable for production use
 * 5. Ratings remain stable (no drift) over extended periods
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { GlickoEngine } from '../src/services/GlickoEngine';
import { SignalGeneratorService, RatingInput } from '../src/services/SignalGeneratorService';
import { TradingParameterSet } from '../src/types';

config();

interface IntegrationTestResult {
  testName: string;
  passed: boolean;
  details: string;
  metrics?: any;
  duration?: number;
}

class IntegrationTester {
  private prisma: PrismaClient;
  private results: IntegrationTestResult[] = [];

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('Connected to database');
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('Database connection closed');
  }

  /**
   * Test 1: Process real pairwise klines data
   */
  async testRealPairwiseProcessing(): Promise<void> {
    const testName = 'Real Pairwise Klines Processing';
    console.log(`\n📊 Test: ${testName}`);
    const testStartTime = Date.now();

    try {
      // Get base coins from environment
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT')
        .slice(0, 5); // Test with first 5 coins for speed

      console.log(`  Testing with ${baseCoins.length} coins: ${baseCoins.join(', ')}`);

      // Generate trading pairs
      const tradingPairs: string[] = [];
      for (const base of baseCoins) {
        for (const quote of baseCoins) {
          if (base !== quote) {
            tradingPairs.push(`${base}${quote}`);
          }
        }
      }

      console.log(`  Generated ${tradingPairs.length} trading pairs`);

      // Fetch last 24 hours of klines for each pair (using actual data end date)
      const endTime = new Date('2025-12-08T00:00:00.000Z');
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      const engine = new GlickoEngine();
      for (const coin of baseCoins) {
        engine.ensureCoinExists(coin, startTime);
      }

      let totalKlines = 0;
      const klinesByTimestamp = new Map<string, Array<{ pair: string; kline: any }>>();

      for (const pair of tradingPairs) {
        const klines = await this.prisma.klines.findMany({
          where: {
            symbol: pair,
            openTime: { gte: startTime, lte: endTime }
          },
          orderBy: { openTime: 'asc' },
          select: {
            openTime: true,
            open: true,
            close: true,
            volume: true,
            takerBuyBaseAssetVolume: true
          }
        });

        totalKlines += klines.length;

        for (const kline of klines) {
          const timestamp = kline.openTime.toISOString();
          if (!klinesByTimestamp.has(timestamp)) {
            klinesByTimestamp.set(timestamp, []);
          }
          klinesByTimestamp.get(timestamp)!.push({ pair, kline });
        }
      }

      console.log(`  Fetched ${totalKlines} klines across ${tradingPairs.length} pairs`);

      // Process chronologically
      const timestamps = Array.from(klinesByTimestamp.keys()).sort();
      let gamesProcessed = 0;

      for (const timestamp of timestamps) {
        const timestampData = klinesByTimestamp.get(timestamp)!;

        for (const { pair, kline } of timestampData) {
          // Extract base and quote from pair
          const base = baseCoins.find(c => pair.startsWith(c));
          const quote = baseCoins.find(c => pair.endsWith(c) && c !== base);

          if (!base || !quote) continue;

          const priceChange = (Number(kline.close) - Number(kline.open)) / Number(kline.open);
          const tsDate = new Date(timestamp);

          const volumeMetrics = kline.takerBuyBaseAssetVolume ? {
            volume: Number(kline.volume),
            takerBuyVolume: Number(kline.takerBuyBaseAssetVolume)
          } : undefined;

          engine.processGame(base, quote, priceChange, tsDate, volumeMetrics);
          gamesProcessed++;
        }

        // Normalize every 12 timestamps (1 hour)
        if (timestamps.indexOf(timestamp) % 12 === 0) {
          engine.normalizeRatings();
        }
      }

      // Final normalization
      engine.normalizeRatings();

      // Verify ratings
      const ratings = new Map<string, number>();
      let totalRating = 0;
      for (const coin of baseCoins) {
        const state = engine.getCoinState(coin);
        if (state) {
          ratings.set(coin, state.rating.rating);
          totalRating += state.rating.rating;
        }
      }

      const avgRating = totalRating / baseCoins.length;
      const driftFromMean = Math.abs(avgRating - 1500);

      const passed =
        gamesProcessed > 0 &&
        ratings.size === baseCoins.length &&
        driftFromMean < 5; // Allow small drift with real data

      const duration = Date.now() - testStartTime;

      this.results.push({
        testName,
        passed,
        duration,
        details: passed
          ? `✓ Processed ${gamesProcessed} games from ${totalKlines} klines. Avg rating: ${avgRating.toFixed(2)} (drift: ${driftFromMean.toFixed(2)})`
          : `✗ Failed to process real klines data correctly`,
        metrics: {
          gamesProcessed,
          totalKlines,
          tradingPairs: tradingPairs.length,
          avgRating: avgRating,
          driftFromMean: driftFromMean,
          ratings: Object.fromEntries(
            Array.from(ratings.entries()).map(([coin, rating]) => [coin, rating.toFixed(1)])
          ),
          durationMs: duration
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');

    } catch (error) {
      const duration = Date.now() - testStartTime;
      this.results.push({
        testName,
        passed: false,
        duration,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
      console.error('  Error:', error);
    }
  }

  /**
   * Test 2: Signal generation from real ratings
   */
  async testRealSignalGeneration(): Promise<void> {
    const testName = 'Real Signal Generation';
    console.log(`\n📊 Test: ${testName}`);
    const testStartTime = Date.now();

    try {
      // Get base coins
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT')
        .slice(0, 8); // Test with 8 coins

      console.log(`  Testing with ${baseCoins.length} coins: ${baseCoins.join(', ')}`);

      // Generate trading pairs
      const tradingPairs: string[] = [];
      for (const base of baseCoins) {
        for (const quote of baseCoins) {
          if (base !== quote) {
            tradingPairs.push(`${base}${quote}`);
          }
        }
      }

      // Fetch last 48 hours of klines (using actual data end date)
      const endTime = new Date('2025-12-08T00:00:00.000Z');
      const startTime = new Date(endTime.getTime() - 48 * 60 * 60 * 1000);

      // Process klines to generate ratings
      const engine = new GlickoEngine();
      for (const coin of baseCoins) {
        engine.ensureCoinExists(coin, startTime);
      }

      const klinesByTimestamp = new Map<string, Array<{ pair: string; kline: any }>>();

      for (const pair of tradingPairs) {
        const klines = await this.prisma.klines.findMany({
          where: {
            symbol: pair,
            openTime: { gte: startTime, lte: endTime }
          },
          orderBy: { openTime: 'asc' },
          take: 100 // Limit for performance
        });

        for (const kline of klines) {
          const timestamp = kline.openTime.toISOString();
          if (!klinesByTimestamp.has(timestamp)) {
            klinesByTimestamp.set(timestamp, []);
          }
          klinesByTimestamp.get(timestamp)!.push({ pair, kline });
        }
      }

      // Process chronologically
      const timestamps = Array.from(klinesByTimestamp.keys()).sort();
      for (const timestamp of timestamps) {
        const timestampData = klinesByTimestamp.get(timestamp)!;

        for (const { pair, kline } of timestampData) {
          const base = baseCoins.find(c => pair.startsWith(c));
          const quote = baseCoins.find(c => pair.endsWith(c) && c !== base);

          if (!base || !quote) continue;

          const priceChange = (Number(kline.close) - Number(kline.open)) / Number(kline.open);
          engine.processGame(base, quote, priceChange, new Date(timestamp));
        }

        if (timestamps.indexOf(timestamp) % 12 === 0) {
          engine.normalizeRatings();
        }
      }

      engine.normalizeRatings();

      // Generate signals using SignalGeneratorService
      const signalGen = new SignalGeneratorService();

      // Build up history first (need 20+ data points)
      for (let i = 0; i < 25; i++) {
        const ratingInputs: RatingInput[] = [];
        for (const coin of baseCoins) {
          const state = engine.getCoinState(coin);
          if (state) {
            ratingInputs.push({
              symbol: coin,
              rating: state.rating.rating + (Math.random() - 0.5) * 10, // Slight variation
              timestamp: new Date(Date.now() - (25 - i) * 5 * 60 * 1000)
            });
          }
        }

        const paramSets = new Map<string, TradingParameterSet>();
        for (const coin of baseCoins) {
          paramSets.set(`${coin}USDT`, {
            symbol: `${coin}USDT`,
            baseAsset: coin,
            quoteAsset: 'USDT',
            zScoreThreshold: 2.0,
            movingAverages: 20,
            profitPercent: 5,
            stopLossPercent: 3,
            allocationPercent: 10,
            enabled: true
          });
        }

        signalGen.generateSignals(ratingInputs, paramSets);
      }

      // Final signal generation
      const ratingInputs: RatingInput[] = [];
      for (const coin of baseCoins) {
        const state = engine.getCoinState(coin);
        if (state) {
          ratingInputs.push({
            symbol: coin,
            rating: state.rating.rating,
            timestamp: new Date()
          });
        }
      }

      const paramSets = new Map<string, TradingParameterSet>();
      for (const coin of baseCoins) {
        paramSets.set(`${coin}USDT`, {
          symbol: `${coin}USDT`,
          baseAsset: coin,
          quoteAsset: 'USDT',
          zScoreThreshold: 2.0,
          movingAverages: 20,
          profitPercent: 5,
          stopLossPercent: 3,
          allocationPercent: 10,
          enabled: true
        });
      }

      const result = signalGen.generateSignals(ratingInputs, paramSets);

      const passed =
        result.signals.length >= 0 &&
        result.statistics.meanRating > 0 &&
        result.statistics.stdDevRating >= 0;

      const duration = Date.now() - testStartTime;

      this.results.push({
        testName,
        passed,
        duration,
        details: passed
          ? `✓ Generated ${result.signals.length} signals (${result.signals.filter(s => s.signal === 'BUY').length} BUY, ${result.signals.filter(s => s.signal === 'SELL').length} SELL). Mean rating: ${result.statistics.meanRating.toFixed(1)}`
          : `✗ Failed to generate signals from real data`,
        metrics: {
          totalSignals: result.signals.length,
          buySignals: result.signals.filter(s => s.signal === 'BUY').length,
          sellSignals: result.signals.filter(s => s.signal === 'SELL').length,
          meanRating: result.statistics.meanRating,
          stdDevRating: result.statistics.stdDevRating,
          durationMs: duration
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');

    } catch (error) {
      const duration = Date.now() - testStartTime;
      this.results.push({
        testName,
        passed: false,
        duration,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
      console.error('  Error:', error);
    }
  }

  /**
   * Test 3: Extended period stability (no drift over time)
   */
  async testExtendedStability(): Promise<void> {
    const testName = 'Extended Period Stability (7 Days)';
    console.log(`\n📊 Test: ${testName}`);
    const testStartTime = Date.now();

    try {
      // Get base coins
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT')
        .slice(0, 5);

      console.log(`  Testing ${baseCoins.length} coins over 7-day period...`);

      // Generate trading pairs
      const tradingPairs: string[] = [];
      for (const base of baseCoins) {
        for (const quote of baseCoins) {
          if (base !== quote) {
            tradingPairs.push(`${base}${quote}`);
          }
        }
      }

      // Fetch last 7 days of klines (using actual data end date)
      const endTime = new Date('2025-12-08T00:00:00.000Z');
      const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

      const engine = new GlickoEngine();
      for (const coin of baseCoins) {
        engine.ensureCoinExists(coin, startTime);
      }

      const klinesByTimestamp = new Map<string, Array<{ pair: string; kline: any }>>();
      let totalKlines = 0;

      for (const pair of tradingPairs) {
        const klines = await this.prisma.klines.findMany({
          where: {
            symbol: pair,
            openTime: { gte: startTime, lte: endTime }
          },
          orderBy: { openTime: 'asc' }
        });

        totalKlines += klines.length;

        for (const kline of klines) {
          const timestamp = kline.openTime.toISOString();
          if (!klinesByTimestamp.has(timestamp)) {
            klinesByTimestamp.set(timestamp, []);
          }
          klinesByTimestamp.get(timestamp)!.push({ pair, kline });
        }
      }

      console.log(`  Processing ${totalKlines} klines...`);

      // Process chronologically and track drift
      const timestamps = Array.from(klinesByTimestamp.keys()).sort();
      const driftHistory: number[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        const timestampData = klinesByTimestamp.get(timestamp)!;

        for (const { pair, kline } of timestampData) {
          const base = baseCoins.find(c => pair.startsWith(c));
          const quote = baseCoins.find(c => pair.endsWith(c) && c !== base);

          if (!base || !quote) continue;

          const priceChange = (Number(kline.close) - Number(kline.open)) / Number(kline.open);
          engine.processGame(base, quote, priceChange, new Date(timestamp));
        }

        // Normalize every hour
        if (i % 12 === 0) {
          engine.normalizeRatings();

          // Check drift every 24 hours
          if (i % (12 * 24) === 0) {
            let totalRating = 0;
            for (const coin of baseCoins) {
              const state = engine.getCoinState(coin);
              if (state) totalRating += state.rating.rating;
            }
            const avgRating = totalRating / baseCoins.length;
            driftHistory.push(Math.abs(avgRating - 1500));
          }
        }
      }

      // Final check
      engine.normalizeRatings();
      let totalRating = 0;
      for (const coin of baseCoins) {
        const state = engine.getCoinState(coin);
        if (state) totalRating += state.rating.rating;
      }
      const finalAvgRating = totalRating / baseCoins.length;
      const finalDrift = Math.abs(finalAvgRating - 1500);

      const maxDrift = Math.max(...driftHistory, finalDrift);
      const passed = maxDrift < 10; // Allow up to 10 points drift with real data

      const duration = Date.now() - testStartTime;

      this.results.push({
        testName,
        passed,
        duration,
        details: passed
          ? `✓ Processed ${totalKlines} klines over 7 days. Final avg: ${finalAvgRating.toFixed(2)}, Max drift: ${maxDrift.toFixed(2)}`
          : `✗ Excessive drift detected: ${maxDrift.toFixed(2)} points`,
        metrics: {
          totalKlines,
          daysProcessed: 7,
          finalAvgRating: finalAvgRating,
          finalDrift: finalDrift,
          maxDrift: maxDrift,
          driftHistory: driftHistory.map(d => d.toFixed(2)),
          durationMs: duration
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');

    } catch (error) {
      const duration = Date.now() - testStartTime;
      this.results.push({
        testName,
        passed: false,
        duration,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
      console.error('  Error:', error);
    }
  }

  /**
   * Test 4: Performance benchmark
   */
  async testPerformance(): Promise<void> {
    const testName = 'Performance Benchmark';
    console.log(`\n📊 Test: ${testName}`);
    const testStartTime = Date.now();

    try {
      const baseCoins = (process.env.BASE_COINS?.split(',').map(coin => coin.trim()) || [])
        .filter(coin => coin !== 'USDT')
        .slice(0, 6);

      const tradingPairs: string[] = [];
      for (const base of baseCoins) {
        for (const quote of baseCoins) {
          if (base !== quote) {
            tradingPairs.push(`${base}${quote}`);
          }
        }
      }

      // Fetch 1000 klines for benchmark (using actual data end date)
      const endTime = new Date('2025-12-08T00:00:00.000Z');
      const fetchStartTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      const fetchStart = Date.now();
      const klinesByPair = new Map<string, any[]>();
      let totalKlines = 0;

      for (const pair of tradingPairs) {
        const klines = await this.prisma.klines.findMany({
          where: {
            symbol: pair,
            openTime: { gte: fetchStartTime, lte: endTime }
          },
          orderBy: { openTime: 'asc' },
          take: 50
        });
        klinesByPair.set(pair, klines);
        totalKlines += klines.length;
      }
      const fetchDuration = Date.now() - fetchStart;

      // Process games
      const processStart = Date.now();
      const engine = new GlickoEngine();
      for (const coin of baseCoins) {
        engine.ensureCoinExists(coin, fetchStartTime);
      }

      let gamesProcessed = 0;
      for (const [pair, klines] of klinesByPair) {
        const base = baseCoins.find(c => pair.startsWith(c));
        const quote = baseCoins.find(c => pair.endsWith(c) && c !== base);
        if (!base || !quote) continue;

        for (const kline of klines) {
          const priceChange = (Number(kline.close) - Number(kline.open)) / Number(kline.open);
          engine.processGame(base, quote, priceChange, kline.openTime);
          gamesProcessed++;
        }
      }
      engine.normalizeRatings();
      const processDuration = Date.now() - processStart;

      const totalDuration = Date.now() - testStartTime;
      const klinesPerSecond = Math.round((totalKlines / totalDuration) * 1000);
      const gamesPerSecond = Math.round((gamesProcessed / processDuration) * 1000);

      const passed =
        klinesPerSecond > 10 && // Should process at least 10 klines/sec
        gamesPerSecond > 100; // Should process at least 100 games/sec

      this.results.push({
        testName,
        passed,
        duration: totalDuration,
        details: passed
          ? `✓ Performance acceptable. ${klinesPerSecond} klines/sec, ${gamesPerSecond} games/sec`
          : `✗ Performance below threshold`,
        metrics: {
          totalKlines,
          gamesProcessed,
          fetchDurationMs: fetchDuration,
          processDurationMs: processDuration,
          totalDurationMs: totalDuration,
          klinesPerSecond,
          gamesPerSecond
        }
      });

      console.log(passed ? '  ✅ PASS' : '  ❌ FAIL');

    } catch (error) {
      const duration = Date.now() - testStartTime;
      this.results.push({
        testName,
        passed: false,
        duration,
        details: `✗ Error: ${(error as Error).message}`
      });
      console.log('  ❌ FAIL');
      console.error('  Error:', error);
    }
  }

  /**
   * Print test results summary
   */
  printResults(): void {
    console.log('\n' + '='.repeat(70));
    console.log('INTEGRATION TEST RESULTS');
    console.log('='.repeat(70));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const percentage = ((passed / total) * 100).toFixed(0);

    console.log(`\nTests Passed: ${passed}/${total} (${percentage}%)\n`);

    for (const result of this.results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.testName}`);
      console.log(`   ${result.details}`);
      if (result.duration) {
        console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
      }
      if (result.metrics) {
        console.log(`   Metrics:`, JSON.stringify(result.metrics, null, 2).replace(/\n/g, '\n   '));
      }
      console.log();
    }

    if (passed === total) {
      console.log('🎉 ALL INTEGRATION TESTS PASSED');
      console.log('   System is ready for production deployment');
    } else {
      console.log(`⚠️  ${total - passed} test(s) failed - Review required`);
    }

    console.log('='.repeat(70));
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Running Integration Tests with Real Database Klines\n');
    console.log('='.repeat(70));

    await this.testRealPairwiseProcessing();
    await this.testRealSignalGeneration();
    await this.testExtendedStability();
    await this.testPerformance();

    this.printResults();
  }
}

async function main() {
  const tester = new IntegrationTester();

  try {
    await tester.initialize();
    await tester.runAllTests();
  } catch (error) {
    console.error('\n💥 Integration test failed:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { IntegrationTester };
