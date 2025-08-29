#!/usr/bin/env ts-node

/**
 * GetKlines Resume - Recovery and Gap-Filling Utility
 * 
 * Features:
 * - Detect incomplete downloads automatically
 * - Resume from last successful checkpoint
 * - Repair gaps in existing data
 * - Validate and fix corrupted ranges
 * - Smart recovery with minimal re-downloading
 * 
 * Usage: npm run getKlines-resume [symbol] [--analyze-only] [--fix-gaps]
 */

import { PrismaClient } from '@prisma/client';
import { TurboKlinesDownloader } from './getKlines-turbo';
import { config } from 'dotenv';

config();

interface DataGap {
  symbol: string;
  gapStart: Date;
  gapEnd: Date;
  expectedRecords: number;
  missingRecords: number;
  severity: 'minor' | 'major' | 'critical';
}

interface SymbolAnalysis {
  symbol: string;
  totalRecords: number;
  dateRange: {
    earliest: Date | null;
    latest: Date | null;
    spanDays: number;
  };
  expectedRecords: number;
  completeness: number;
  gaps: DataGap[];
  duplicates: number;
  lastUpdate: Date | null;
  needsRecovery: boolean;
}

interface RecoveryPlan {
  symbol: string;
  actions: RecoveryAction[];
  estimatedTime: number;
  priority: number;
}

interface RecoveryAction {
  type: 'download' | 'deduplicate' | 'validate';
  description: string;
  startTime?: Date;
  endTime?: Date;
  expectedRecords?: number;
}

class KlinesRecoveryService {
  private prisma: PrismaClient;
  private interval: string;
  private intervalMs: number;

  constructor(interval: string = '5m') {
    this.prisma = new PrismaClient();
    this.interval = interval;
    this.intervalMs = this.getIntervalInMs(interval);
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

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Connected to database');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Get all symbols that have data in the database
   */
  async getExistingSymbols(): Promise<string[]> {
    const symbols = await this.prisma.klines.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
      orderBy: { symbol: 'asc' }
    });

    return symbols.map(s => s.symbol);
  }

  /**
   * Analyze a single symbol for completeness and gaps
   */
  async analyzeSymbol(symbol: string): Promise<SymbolAnalysis> {
    console.log(`🔍 Analyzing ${symbol}...`);

    // Get basic statistics
    const totalRecords = await this.prisma.klines.count({
      where: { symbol }
    });

    if (totalRecords === 0) {
      return {
        symbol,
        totalRecords: 0,
        dateRange: { earliest: null, latest: null, spanDays: 0 },
        expectedRecords: 0,
        completeness: 0,
        gaps: [],
        duplicates: 0,
        lastUpdate: null,
        needsRecovery: true
      };
    }

    // Get date range
    const dateStats = await this.prisma.klines.aggregate({
      where: { symbol },
      _min: { openTime: true, createdAt: true },
      _max: { openTime: true, createdAt: true }
    });

    const earliest = dateStats._min.openTime;
    const latest = dateStats._max.openTime;
    const lastUpdate = dateStats._max.createdAt;
    const spanDays = earliest && latest 
      ? (latest.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000)
      : 0;

    // Calculate expected records
    const expectedRecords = spanDays > 0 
      ? Math.floor((spanDays * 24 * 60 * 60 * 1000) / this.intervalMs)
      : 0;

    const completeness = expectedRecords > 0 ? (totalRecords / expectedRecords) * 100 : 0;

    // Detect gaps
    const gaps = await this.detectGaps(symbol, earliest!, latest!);

    // Count duplicates
    const duplicates = await this.countDuplicates(symbol);

    const needsRecovery = completeness < 95 || gaps.length > 0 || duplicates > 0;

    return {
      symbol,
      totalRecords,
      dateRange: { earliest, latest, spanDays },
      expectedRecords,
      completeness,
      gaps,
      duplicates,
      lastUpdate,
      needsRecovery
    };
  }

  /**
   * Detect gaps in time series data
   */
  private async detectGaps(symbol: string, earliest: Date, latest: Date): Promise<DataGap[]> {
    // Get all timestamps, ordered
    const timestamps = await this.prisma.klines.findMany({
      where: { symbol },
      select: { openTime: true },
      orderBy: { openTime: 'asc' }
    });

    const gaps: DataGap[] = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      const prevTime = timestamps[i - 1].openTime.getTime();
      const currentTime = timestamps[i].openTime.getTime();
      const expectedNextTime = prevTime + this.intervalMs;
      
      if (currentTime > expectedNextTime) {
        const gapDuration = currentTime - expectedNextTime;
        const missingIntervals = Math.floor(gapDuration / this.intervalMs);
        
        if (missingIntervals > 0) {
          let severity: 'minor' | 'major' | 'critical' = 'minor';
          if (missingIntervals > 100) severity = 'major';
          if (missingIntervals > 1000) severity = 'critical';

          gaps.push({
            symbol,
            gapStart: new Date(expectedNextTime),
            gapEnd: new Date(currentTime - this.intervalMs),
            expectedRecords: missingIntervals,
            missingRecords: missingIntervals,
            severity
          });
        }
      }
    }

    return gaps;
  }

  /**
   * Count duplicate records
   */
  private async countDuplicates(symbol: string): Promise<number> {
    const duplicateQuery = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count 
      FROM (
        SELECT symbol, "openTime"
        FROM klines 
        WHERE symbol = ${symbol}
        GROUP BY symbol, "openTime"
        HAVING COUNT(*) > 1
      ) duplicates
    `;

    return Number(duplicateQuery[0]?.count || 0);
  }

  /**
   * Create recovery plan for a symbol
   */
  createRecoveryPlan(analysis: SymbolAnalysis): RecoveryPlan {
    const actions: RecoveryAction[] = [];
    let estimatedTime = 0;

    // Plan gap filling
    for (const gap of analysis.gaps) {
      actions.push({
        type: 'download',
        description: `Fill ${gap.severity} gap: ${gap.missingRecords} records from ${gap.gapStart.toISOString().split('T')[0]} to ${gap.gapEnd.toISOString().split('T')[0]}`,
        startTime: gap.gapStart,
        endTime: gap.gapEnd,
        expectedRecords: gap.expectedRecords
      });
      
      // Estimate time: ~1 second per 100 records
      estimatedTime += Math.ceil(gap.expectedRecords / 100);
    }

    // Plan duplicate removal
    if (analysis.duplicates > 0) {
      actions.push({
        type: 'deduplicate',
        description: `Remove ${analysis.duplicates} duplicate records`
      });
      estimatedTime += 5; // 5 seconds for deduplication
    }

    // Plan validation
    actions.push({
      type: 'validate',
      description: 'Validate data integrity after recovery'
    });
    estimatedTime += 2; // 2 seconds for validation

    // Calculate priority (higher for more incomplete data)
    let priority = 0;
    if (analysis.completeness < 50) priority += 10;
    else if (analysis.completeness < 80) priority += 5;
    
    priority += analysis.gaps.filter(g => g.severity === 'critical').length * 3;
    priority += analysis.gaps.filter(g => g.severity === 'major').length * 2;
    priority += analysis.gaps.filter(g => g.severity === 'minor').length * 1;

    return {
      symbol: analysis.symbol,
      actions,
      estimatedTime,
      priority
    };
  }

  /**
   * Execute recovery plan for a symbol
   */
  async executeRecoveryPlan(plan: RecoveryPlan): Promise<boolean> {
    console.log(`\n🔧 Executing recovery for ${plan.symbol}...`);
    console.log(`📋 ${plan.actions.length} actions planned, estimated time: ${plan.estimatedTime}s`);

    let success = true;

    for (const action of plan.actions) {
      try {
        console.log(`  🔄 ${action.description}`);

        switch (action.type) {
          case 'download':
            if (action.startTime && action.endTime) {
              await this.fillGap(plan.symbol, action.startTime, action.endTime);
            }
            break;

          case 'deduplicate':
            await this.removeDuplicates(plan.symbol);
            break;

          case 'validate':
            const validation = await this.analyzeSymbol(plan.symbol);
            console.log(`    ✅ Validation: ${validation.completeness.toFixed(1)}% complete, ${validation.gaps.length} gaps remaining`);
            break;
        }

        console.log(`    ✅ Completed: ${action.description}`);

      } catch (error) {
        console.error(`    ❌ Failed: ${action.description}`, error);
        success = false;
        // Continue with other actions
      }
    }

    return success;
  }

  /**
   * Fill a specific gap in the data
   */
  private async fillGap(symbol: string, startTime: Date, endTime: Date): Promise<void> {
    const downloader = new TurboKlinesDownloader(this.interval);
    
    try {
      await downloader.initialize();
      
      // Download just the missing data
      await downloader.downloadTurbo([symbol], startTime, endTime);
      console.log(`    📊 Downloaded data for gap from ${startTime.toISOString().split('T')[0]} to ${endTime.toISOString().split('T')[0]}`);
      
    } finally {
      await downloader.cleanup();
    }
  }

  /**
   * Remove duplicate records for a symbol
   */
  private async removeDuplicates(symbol: string): Promise<void> {
    // Use raw SQL for efficient duplicate removal
    const result = await this.prisma.$executeRaw`
      DELETE FROM klines 
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY symbol, "openTime" ORDER BY "createdAt" DESC
          ) as rn
          FROM klines 
          WHERE symbol = ${symbol}
        ) t 
        WHERE t.rn > 1
      )
    `;

    console.log(`    🗑️ Removed ${result} duplicate records`);
  }

  /**
   * Comprehensive analysis of all symbols
   */
  async analyzeAll(): Promise<SymbolAnalysis[]> {
    console.log('🔍 Analyzing all symbols in database...');
    
    const symbols = await this.getExistingSymbols();
    console.log(`📊 Found ${symbols.length} symbols with data`);

    const analyses: SymbolAnalysis[] = [];

    for (const symbol of symbols) {
      try {
        const analysis = await this.analyzeSymbol(symbol);
        analyses.push(analysis);
      } catch (error) {
        console.error(`❌ Failed to analyze ${symbol}:`, error);
      }
    }

    return analyses;
  }

  /**
   * Generate comprehensive recovery report
   */
  generateRecoveryReport(analyses: SymbolAnalysis[]): void {
    const needsRecovery = analyses.filter(a => a.needsRecovery);
    const healthy = analyses.filter(a => !a.needsRecovery);

    console.log(`\n📊 RECOVERY ANALYSIS REPORT`);
    console.log(`═`.repeat(60));
    console.log(`Total symbols: ${analyses.length}`);
    console.log(`Healthy: ${healthy.length} (${(healthy.length/analyses.length*100).toFixed(1)}%)`);
    console.log(`Need recovery: ${needsRecovery.length} (${(needsRecovery.length/analyses.length*100).toFixed(1)}%)`);

    if (needsRecovery.length > 0) {
      console.log(`\n🔧 SYMBOLS NEEDING RECOVERY:`);
      console.log(`Symbol        | Records  | Complete | Gaps | Duplicates | Severity`);
      console.log(`─`.repeat(70));

      needsRecovery
        .sort((a, b) => a.completeness - b.completeness)
        .forEach(analysis => {
          const symbol = analysis.symbol.padEnd(12);
          const records = analysis.totalRecords.toLocaleString().padStart(8);
          const complete = `${analysis.completeness.toFixed(1)}%`.padStart(8);
          const gaps = analysis.gaps.length.toString().padStart(4);
          const duplicates = analysis.duplicates.toString().padStart(10);
          
          const criticalGaps = analysis.gaps.filter(g => g.severity === 'critical').length;
          const majorGaps = analysis.gaps.filter(g => g.severity === 'major').length;
          
          let severity = 'Low';
          if (criticalGaps > 0) severity = 'Critical';
          else if (majorGaps > 0 || analysis.completeness < 50) severity = 'High';
          else if (analysis.completeness < 80) severity = 'Medium';

          console.log(`${symbol} | ${records} | ${complete} | ${gaps} | ${duplicates} | ${severity}`);
        });

      console.log(`\n💡 RECOVERY RECOMMENDATIONS:`);
      
      const critical = needsRecovery.filter(a => 
        a.completeness < 50 || a.gaps.some(g => g.severity === 'critical')
      );
      
      if (critical.length > 0) {
        console.log(`1. Critical recovery needed for ${critical.length} symbols:`);
        console.log(`   ${critical.map(a => a.symbol).join(', ')}`);
      }

      const incomplete = needsRecovery.filter(a => a.completeness < 95 && a.completeness >= 50);
      if (incomplete.length > 0) {
        console.log(`2. Fill gaps for ${incomplete.length} incomplete symbols`);
      }

      const withDuplicates = needsRecovery.filter(a => a.duplicates > 0);
      if (withDuplicates.length > 0) {
        console.log(`3. Remove duplicates from ${withDuplicates.length} symbols`);
      }
    }

    console.log(`\n📈 OVERALL STATISTICS:`);
    const totalRecords = analyses.reduce((sum, a) => sum + a.totalRecords, 0);
    const avgCompleteness = analyses.reduce((sum, a) => sum + a.completeness, 0) / analyses.length;
    const totalGaps = analyses.reduce((sum, a) => sum + a.gaps.length, 0);
    const totalDuplicates = analyses.reduce((sum, a) => sum + a.duplicates, 0);

    console.log(`  Total records: ${totalRecords.toLocaleString()}`);
    console.log(`  Average completeness: ${avgCompleteness.toFixed(1)}%`);
    console.log(`  Total gaps: ${totalGaps}`);
    console.log(`  Total duplicates: ${totalDuplicates}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    console.log('🧹 Database connection closed');
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): {
  symbol?: string;
  analyzeOnly: boolean;
  fixGaps: boolean;
  removeDuplicates: boolean;
  interval: string;
} {
  const args = process.argv.slice(2);

  const analyzeOnlyIndex = args.indexOf('--analyze-only');
  const analyzeOnly = analyzeOnlyIndex !== -1;
  if (analyzeOnlyIndex !== -1) args.splice(analyzeOnlyIndex, 1);

  const fixGapsIndex = args.indexOf('--fix-gaps');
  const fixGaps = fixGapsIndex !== -1;
  if (fixGapsIndex !== -1) args.splice(fixGapsIndex, 1);

  const removeDuplicatesIndex = args.indexOf('--remove-duplicates');
  const removeDuplicates = removeDuplicatesIndex !== -1;
  if (removeDuplicatesIndex !== -1) args.splice(removeDuplicatesIndex, 1);

  const intervalIndex = args.indexOf('--interval');
  let interval = '5m';
  if (intervalIndex !== -1) {
    interval = args[intervalIndex + 1] || '5m';
    args.splice(intervalIndex, 2);
  }

  const symbol = args[0]; // Optional symbol argument

  return { symbol, analyzeOnly, fixGaps, removeDuplicates, interval };
}

/**
 * Main execution function
 */
async function main() {
  try {
    const { symbol, analyzeOnly, fixGaps, removeDuplicates, interval } = parseArguments();
    const recovery = new KlinesRecoveryService(interval);

    await recovery.initialize();

    console.log(`📋 Recovery Configuration:`);
    console.log(`  - Symbol: ${symbol || 'All symbols'}`);
    console.log(`  - Interval: ${interval}`);
    console.log(`  - Analyze only: ${analyzeOnly ? 'Yes' : 'No'}`);
    console.log(`  - Fix gaps: ${fixGaps ? 'Yes' : 'No'}`);
    console.log(`  - Remove duplicates: ${removeDuplicates ? 'Yes' : 'No'}`);

    if (symbol) {
      // Analyze single symbol
      const analysis = await recovery.analyzeSymbol(symbol);
      console.log(`\n📊 Analysis for ${symbol}:`);
      console.log(`  Records: ${analysis.totalRecords.toLocaleString()}`);
      console.log(`  Completeness: ${analysis.completeness.toFixed(1)}%`);
      console.log(`  Gaps: ${analysis.gaps.length}`);
      console.log(`  Duplicates: ${analysis.duplicates}`);
      console.log(`  Needs recovery: ${analysis.needsRecovery ? 'Yes' : 'No'}`);

      if (!analyzeOnly && analysis.needsRecovery) {
        const plan = recovery.createRecoveryPlan(analysis);
        console.log(`\n🔧 Recovery plan: ${plan.actions.length} actions, ~${plan.estimatedTime}s`);
        
        if (fixGaps || removeDuplicates) {
          await recovery.executeRecoveryPlan(plan);
        }
      }

    } else {
      // Analyze all symbols
      const analyses = await recovery.analyzeAll();
      recovery.generateRecoveryReport(analyses);

      if (!analyzeOnly) {
        const needsRecovery = analyses.filter(a => a.needsRecovery);
        
        if (needsRecovery.length > 0 && (fixGaps || removeDuplicates)) {
          console.log(`\n🔧 Executing recovery for ${needsRecovery.length} symbols...`);
          
          for (const analysis of needsRecovery) {
            const plan = recovery.createRecoveryPlan(analysis);
            await recovery.executeRecoveryPlan(plan);
          }
        }
      }
    }

    await recovery.cleanup();

  } catch (error) {
    console.error('\n❌ Recovery failed:', error);
    process.exit(1);
  }
}

// Show usage if no arguments
if (process.argv.length === 2) {
  console.log('📋 GetKlines Resume - Recovery and Gap-Filling Utility');
  console.log('');
  console.log('Usage:');
  console.log('  npm run getKlines-resume                           # Analyze all symbols');
  console.log('  npm run getKlines-resume BTCUSDT                  # Analyze specific symbol');
  console.log('  npm run getKlines-resume --analyze-only           # Analysis only, no fixes');
  console.log('  npm run getKlines-resume --fix-gaps               # Fill data gaps');
  console.log('  npm run getKlines-resume --remove-duplicates      # Remove duplicates');
  console.log('  npm run getKlines-resume --interval 1h            # Use different interval');
  console.log('');
  console.log('Examples:');
  console.log('  npm run getKlines-resume BTCUSDT --fix-gaps');
  console.log('  npm run getKlines-resume --analyze-only --interval 5m');
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { KlinesRecoveryService };