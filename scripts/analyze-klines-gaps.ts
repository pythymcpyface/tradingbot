#!/usr/bin/env ts-node

/**
 * Analyze Klines Data Gaps Script
 * 
 * This script analyzes gaps in the klines data to determine their root causes:
 * - Trading pair launch dates vs. expected data start dates
 * - Binance maintenance periods or trading halts
 * - Market events causing trading suspensions
 * - API limitations or data availability issues
 * 
 * Usage: npx ts-node scripts/analyze-klines-gaps.ts [interval]
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface GapAnalysis {
  symbol: string;
  totalRecords: number;
  expectedRecords: number;
  completeness: number;
  dateRange: {
    earliest: Date | null;
    latest: Date | null;
    spanDays: number;
  };
  gaps: Array<{
    start: Date;
    end: Date;
    missingIntervals: number;
    durationDays: number;
    gapType: 'launch' | 'maintenance' | 'suspension' | 'unknown';
    description: string;
  }>;
  pairInfo: {
    launchDate: Date | null;
    launchSource: string;
    isNewPair: boolean;
    expectedDataStart: Date;
  };
  recommendation: string;
}

interface TradingPairInfo {
  symbol: string;
  launchDate: Date | null;
  launchSource: string;
  isNewPair: boolean;
  notes: string;
}

class KlinesGapAnalyzer {
  private prisma: PrismaClient;
  private interval: string;
  private intervalMs: number;
  private tradingPairs: string[];
  private pairInfoMap: Map<string, TradingPairInfo>;

  constructor(interval: string = '5m') {
    this.prisma = new PrismaClient();
    this.interval = interval;
    this.intervalMs = this.getIntervalInMs(interval);
    this.tradingPairs = this.getTradingPairsFromEnv();
    this.pairInfoMap = this.initializePairInfo();
  }

  private getTradingPairsFromEnv(): string[] {
    const tradingPairsEnv = process.env.TRADING_PAIRS;
    if (!tradingPairsEnv) {
      throw new Error('TRADING_PAIRS not found in environment variables');
    }
    return tradingPairsEnv.split(',').map(pair => pair.trim());
  }

  private getIntervalInMs(interval: string): number {
    const intervalMap: { [key: string]: number } = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '8h': 8 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000
    };

    if (!intervalMap[interval]) {
      throw new Error(`Unsupported interval: ${interval}`);
    }

    return intervalMap[interval];
  }

  private initializePairInfo(): Map<string, TradingPairInfo> {
    const pairInfo = new Map<string, TradingPairInfo>();

    // POL pairs - new pairs that replaced MATIC on Sept 4, 2024
    const polPairs = ['POLBNB', 'POLBTC', 'POLETH', 'POLUSDT'];
    polPairs.forEach(pair => {
      pairInfo.set(pair, {
        symbol: pair,
        launchDate: new Date('2024-09-04'), // POL migration date
        launchSource: 'MATIC to POL migration Sept 4, 2024',
        isNewPair: true,
        notes: 'POL replaced MATIC tokens on Sept 4, 2024'
      });
    });

    // TRX pairs - known to have significant gaps
    pairInfo.set('TRXBNB', {
      symbol: 'TRXBNB',
      launchDate: null, // Unknown exact date, but TRX was on Binance early
      launchSource: 'Unknown - research needed',
      isNewPair: false,
      notes: 'TRX was listed on Binance early, but specific pair launch dates unclear'
    });

    pairInfo.set('TRXBTC', {
      symbol: 'TRXBTC',
      launchDate: null,
      launchSource: 'Unknown - research needed',
      isNewPair: false,
      notes: 'TRX was listed on Binance early, but specific pair launch dates unclear'
    });

    // XRP pairs - ended early (possibly delisted)
    const xrpPairs = ['XRPBNB', 'XRPBTC', 'XRPETH'];
    xrpPairs.forEach(pair => {
      pairInfo.set(pair, {
        symbol: pair,
        launchDate: null,
        launchSource: 'Early Binance listing',
        isNewPair: false,
        notes: 'XRP pairs appear to have ended trading in 2024 - possibly related to regulatory issues'
      });
    });

    // LINK and XLM pairs with long history
    const longHistoryPairs = ['LINKETH', 'XLMBTC', 'XLMETH'];
    longHistoryPairs.forEach(pair => {
      pairInfo.set(pair, {
        symbol: pair,
        launchDate: null, // Unknown exact dates
        launchSource: 'Early Binance listing',
        isNewPair: false,
        notes: 'These pairs have been on Binance for years but have data quality issues'
      });
    });

    // Set expected data start date for analysis (our data collection period)
    const expectedDataStart = new Date('2021-01-01');
    
    return pairInfo;
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
      console.log(`📊 Analyzing gaps for interval: ${this.interval} (${this.intervalMs}ms)`);
      console.log(`🎯 Trading pairs: ${this.tradingPairs.length} pairs`);
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async analyzeGapsForSymbol(symbol: string): Promise<GapAnalysis> {
    console.log(`\n🔍 Analyzing gaps for ${symbol}...`);

    // Get basic stats
    const totalRecords = await this.prisma.klines.count({
      where: { symbol }
    });

    if (totalRecords === 0) {
      return {
        symbol,
        totalRecords: 0,
        expectedRecords: 0,
        completeness: 0,
        dateRange: { earliest: null, latest: null, spanDays: 0 },
        gaps: [],
        pairInfo: {
          launchDate: null,
          launchSource: 'No data',
          isNewPair: false,
          expectedDataStart: new Date('2021-01-01')
        },
        recommendation: 'No data found - investigate if pair exists on Binance'
      };
    }

    // Get date range
    const dateStats = await this.prisma.klines.aggregate({
      where: { symbol },
      _min: { openTime: true },
      _max: { openTime: true }
    });

    const earliest = dateStats._min.openTime!;
    const latest = dateStats._max.openTime!;
    const spanDays = (latest.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000);

    // Get pair info
    const pairInfo = this.pairInfoMap.get(symbol) || {
      launchDate: null,
      launchSource: 'Unknown',
      isNewPair: false,
      expectedDataStart: new Date('2021-01-01')
    };

    // Calculate expected records
    const expectedDataStart = pairInfo.launchDate || new Date('2021-01-01');
    const dataEndDate = new Date(); // Current date
    const expectedSpanDays = (dataEndDate.getTime() - expectedDataStart.getTime()) / (24 * 60 * 60 * 1000);
    const expectedRecords = Math.floor((expectedSpanDays * 24 * 60 * 60 * 1000) / this.intervalMs);

    const completeness = expectedRecords > 0 ? (totalRecords / expectedRecords) * 100 : 0;

    // Get all timestamps to find gaps
    const records = await this.prisma.klines.findMany({
      where: { symbol },
      select: { openTime: true },
      orderBy: { openTime: 'asc' },
      take: 50000 // Limit for performance
    });

    const timestamps = records.map(r => r.openTime);
    const gaps = this.analyzeGaps(timestamps, symbol);

    // Generate recommendation
    const recommendation = this.generateRecommendation(symbol, {
      totalRecords,
      expectedRecords,
      completeness,
      gaps,
      pairInfo
    });

    console.log(`  📊 Records: ${totalRecords.toLocaleString()} / ${expectedRecords.toLocaleString()} (${completeness.toFixed(1)}%)`);
    console.log(`  📅 Range: ${earliest.toISOString().split('T')[0]} to ${latest.toISOString().split('T')[0]}`);
    console.log(`  ⚠️  Gaps: ${gaps.length}`);

    return {
      symbol,
      totalRecords,
      expectedRecords,
      completeness,
      dateRange: { earliest, latest, spanDays },
      gaps,
      pairInfo: {
        ...pairInfo,
        expectedDataStart: expectedDataStart
      },
      recommendation
    };
  }

  private analyzeGaps(timestamps: Date[], symbol: string): Array<{
    start: Date;
    end: Date;
    missingIntervals: number;
    durationDays: number;
    gapType: 'launch' | 'maintenance' | 'suspension' | 'unknown';
    description: string;
  }> {
    const gaps: Array<{
      start: Date;
      end: Date;
      missingIntervals: number;
      durationDays: number;
      gapType: 'launch' | 'maintenance' | 'suspension' | 'unknown';
      description: string;
    }> = [];

    for (let i = 1; i < timestamps.length; i++) {
      const expectedNext = new Date(timestamps[i - 1].getTime() + this.intervalMs);
      const actual = timestamps[i];
      
      if (actual.getTime() > expectedNext.getTime()) {
        const missingIntervals = Math.floor((actual.getTime() - expectedNext.getTime()) / this.intervalMs);
        const gapStart = expectedNext;
        const gapEnd = new Date(actual.getTime() - this.intervalMs);
        const durationDays = (gapEnd.getTime() - gapStart.getTime()) / (24 * 60 * 60 * 1000);

        // Classify gap type
        const { gapType, description } = this.classifyGap(gapStart, gapEnd, symbol, durationDays);

        gaps.push({
          start: gapStart,
          end: gapEnd,
          missingIntervals,
          durationDays,
          gapType,
          description
        });
      }
    }

    return gaps;
  }

  private classifyGap(start: Date, end: Date, symbol: string, durationDays: number): {
    gapType: 'launch' | 'maintenance' | 'suspension' | 'unknown';
    description: string;
  } {
    const pairInfo = this.pairInfoMap.get(symbol);

    // Check if gap is at the beginning (could be launch-related)
    if (pairInfo?.launchDate) {
      const daysDiffFromLaunch = (start.getTime() - pairInfo.launchDate.getTime()) / (24 * 60 * 60 * 1000);
      if (daysDiffFromLaunch < 30) {
        return {
          gapType: 'launch',
          description: `Gap near launch date (${pairInfo.launchDate.toISOString().split('T')[0]})`
        };
      }
    }

    // Short gaps (< 1 day) are likely maintenance
    if (durationDays < 1) {
      return {
        gapType: 'maintenance',
        description: `Short gap (${durationDays.toFixed(2)} days) - likely maintenance`
      };
    }

    // Long gaps (> 7 days) could be suspensions
    if (durationDays > 7) {
      return {
        gapType: 'suspension',
        description: `Long gap (${durationDays.toFixed(1)} days) - possible trading suspension`
      };
    }

    // Medium gaps are unknown
    return {
      gapType: 'unknown',
      description: `Medium gap (${durationDays.toFixed(1)} days) - unknown cause`
    };
  }

  private generateRecommendation(symbol: string, analysis: {
    totalRecords: number;
    expectedRecords: number;
    completeness: number;
    gaps: any[];
    pairInfo: any;
  }): string {
    const { totalRecords, expectedRecords, completeness, gaps, pairInfo } = analysis;

    if (totalRecords === 0) {
      return 'No data found - verify if this trading pair exists on Binance';
    }

    if (pairInfo.isNewPair && pairInfo.launchDate) {
      const daysSinceLaunch = (new Date().getTime() - pairInfo.launchDate.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceLaunch < 365) {
        return `New pair launched ${pairInfo.launchDate.toISOString().split('T')[0]} - gaps before launch are expected`;
      }
    }

    if (completeness > 95) {
      return 'Data quality is excellent - no action needed';
    }

    if (completeness < 50) {
      const suspensionGaps = gaps.filter(g => g.gapType === 'suspension').length;
      if (suspensionGaps > 0) {
        return `Very low completeness (${completeness.toFixed(1)}%) with ${suspensionGaps} suspension gaps - investigate trading history`;
      }
      return `Very low completeness (${completeness.toFixed(1)}%) - investigate data availability`;
    }

    if (gaps.length > 10) {
      return `Many gaps (${gaps.length}) detected - review data collection consistency`;
    }

    if (gaps.length > 0) {
      const mainGapType = gaps.reduce((acc, gap) => {
        acc[gap.gapType] = (acc[gap.gapType] || 0) + 1;
        return acc;
      }, {} as any);
      
      const mostCommonType = Object.keys(mainGapType).reduce((a, b) => 
        mainGapType[a] > mainGapType[b] ? a : b
      );

      return `${gaps.length} gaps detected, mostly ${mostCommonType} - consider filling if data is available`;
    }

    return 'Data quality is good';
  }

  async analyzeAllPairs(): Promise<GapAnalysis[]> {
    console.log('🚀 Starting comprehensive gap analysis...');
    console.log('=' .repeat(70));

    const analyses: GapAnalysis[] = [];

    for (const symbol of this.tradingPairs) {
      try {
        const analysis = await this.analyzeGapsForSymbol(symbol);
        analyses.push(analysis);
      } catch (error) {
        console.error(`❌ Error analyzing ${symbol}:`, error);
        analyses.push({
          symbol,
          totalRecords: 0,
          expectedRecords: 0,
          completeness: 0,
          dateRange: { earliest: null, latest: null, spanDays: 0 },
          gaps: [],
          pairInfo: {
            launchDate: null,
            launchSource: 'Error',
            isNewPair: false,
            expectedDataStart: new Date('2021-01-01')
          },
          recommendation: `Analysis error: ${error}`
        });
      }
    }

    return analyses;
  }

  generateReport(analyses: GapAnalysis[]): void {
    console.log('\n📊 KLINES GAP ANALYSIS REPORT');
    console.log('=' .repeat(80));

    // Summary by gap type
    const gapTypeSummary = analyses.reduce((acc, analysis) => {
      analysis.gaps.forEach(gap => {
        acc[gap.gapType] = (acc[gap.gapType] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    console.log('\n🔍 GAP TYPE SUMMARY:');
    Object.entries(gapTypeSummary).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} gaps`);
    });

    // Pairs with significant issues
    console.log('\n⚠️  PAIRS WITH SIGNIFICANT GAPS:');
    analyses
      .filter(a => a.completeness < 80 || a.gaps.length > 5)
      .sort((a, b) => a.completeness - b.completeness)
      .forEach(analysis => {
        console.log(`\n${analysis.symbol}:`);
        console.log(`  Completeness: ${analysis.completeness.toFixed(1)}%`);
        console.log(`  Total gaps: ${analysis.gaps.length}`);
        console.log(`  Launch info: ${analysis.pairInfo.launchSource}`);
        console.log(`  Recommendation: ${analysis.recommendation}`);
        
        if (analysis.gaps.length > 0) {
          console.log(`  Major gaps:`);
          analysis.gaps
            .filter(g => g.durationDays > 1)
            .slice(0, 3)
            .forEach(gap => {
              console.log(`    ${gap.start.toISOString().split('T')[0]} to ${gap.end.toISOString().split('T')[0]} (${gap.durationDays.toFixed(1)} days) - ${gap.description}`);
            });
        }
      });

    // Expected vs. unexpected gaps
    console.log('\n✅ EXPECTED GAPS (Normal):');
    analyses
      .filter(a => a.pairInfo.isNewPair && a.pairInfo.launchDate)
      .forEach(analysis => {
        console.log(`  ${analysis.symbol}: New pair launched ${analysis.pairInfo.launchDate?.toISOString().split('T')[0]} - ${analysis.pairInfo.launchSource}`);
      });

    console.log('\n❓ GAPS NEEDING INVESTIGATION:');
    analyses
      .filter(a => !a.pairInfo.isNewPair && (a.completeness < 90 || a.gaps.length > 3))
      .forEach(analysis => {
        console.log(`  ${analysis.symbol}: ${analysis.recommendation}`);
      });

    // Save detailed report
    this.saveDetailedReport(analyses);
  }

  private saveDetailedReport(analyses: GapAnalysis[]): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const reportPath = path.join(process.cwd(), 'analysis', `gap-analysis-${timestamp}.json`);

    // Ensure analysis directory exists
    const analysisDir = path.join(process.cwd(), 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }

    const report = {
      timestamp: new Date().toISOString(),
      interval: this.interval,
      totalPairs: analyses.length,
      summary: {
        totalGaps: analyses.reduce((sum, a) => sum + a.gaps.length, 0),
        avgCompleteness: analyses.reduce((sum, a) => sum + a.completeness, 0) / analyses.length,
        pairsWithIssues: analyses.filter(a => a.completeness < 90).length,
        newPairs: analyses.filter(a => a.pairInfo.isNewPair).length
      },
      analyses: analyses.map(a => ({
        ...a,
        gaps: a.gaps.map(g => ({
          ...g,
          start: g.start.toISOString(),
          end: g.end.toISOString()
        }))
      }))
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Detailed report saved to: ${reportPath}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const interval = args[0] || '5m';
    
    const analyzer = new KlinesGapAnalyzer(interval);
    
    await analyzer.initialize();
    const analyses = await analyzer.analyzeAllPairs();
    analyzer.generateReport(analyses);
    
    console.log('\n🎉 Gap analysis completed successfully!');
    
    await analyzer.cleanup();

  } catch (error) {
    console.error('\n❌ Gap analysis failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { KlinesGapAnalyzer };