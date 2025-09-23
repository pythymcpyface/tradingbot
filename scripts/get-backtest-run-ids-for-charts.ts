#!/usr/bin/env npx tsx

/**
 * Get Backtest Run IDs for Chart Generation
 * 
 * This script provides specific run IDs and date ranges for ETH/USDT backtests
 * with Z-Score=6, Profit=22%, Stop=6% parameters to help with chart generation.
 * 
 * Use this output to correctly configure the generateTradeCharts script.
 */

import { ConnectionPoolService } from '../src/lib/database/ConnectionPoolService';
import { config } from 'dotenv';

// Load environment variables
config();

interface BacktestRunForCharts {
  runId: string;
  startDate: string;
  endDate: string;
  orderCount: number;
  actualOrderStart: string;
  actualOrderEnd: string;
  year: number;
  duration: number;
}

async function getBacktestRunIdsForCharts(): Promise<void> {
  const dbService = ConnectionPoolService.getInstance();
  
  try {
    console.log('📊 ETH/USDT Backtest Run IDs for Chart Generation');
    console.log('================================================');
    console.log('Parameters: Z-Score=6, Profit=22%, Stop=6%');
    console.log('');

    // Get all matching runs with their order date ranges
    const runs = await dbService.cachedQuery<any[]>(`
      SELECT 
        br.id as "runId",
        br."startTime",
        br."endTime",
        COUNT(bo.id) as order_count,
        MIN(bo.timestamp) as earliest_order,
        MAX(bo.timestamp) as latest_order
      FROM backtest_runs br
      LEFT JOIN backtest_orders bo ON br.id = bo."runId"
      WHERE br."baseAsset" = 'ETH' 
        AND br."quoteAsset" = 'USDT'
        AND br."zScoreThreshold" = 6
        AND br."profitPercent" = 22
        AND br."stopLossPercent" = 6
      GROUP BY br.id, br."startTime", br."endTime"
      HAVING COUNT(bo.id) > 0
      ORDER BY br."startTime"
    `);

    // Format the data for easy use
    const formattedRuns: BacktestRunForCharts[] = runs.map(run => {
      const startDate = new Date(run.startTime);
      const endDate = new Date(run.endTime);
      const actualStart = new Date(run.earliest_order);
      const actualEnd = new Date(run.latest_order);
      
      return {
        runId: run.runId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        orderCount: Number(run.order_count),
        actualOrderStart: actualStart.toISOString().split('T')[0],
        actualOrderEnd: actualEnd.toISOString().split('T')[0],
        year: startDate.getFullYear(),
        duration: Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      };
    });

    // Group by year for easier analysis
    const runsByYear = formattedRuns.reduce((acc, run) => {
      if (!acc[run.year]) acc[run.year] = [];
      acc[run.year].push(run);
      return acc;
    }, {} as Record<number, BacktestRunForCharts[]>);

    console.log('📋 Summary by Year:');
    console.log('==================');
    Object.keys(runsByYear).sort().forEach(year => {
      const yearRuns = runsByYear[Number(year)];
      const totalOrders = yearRuns.reduce((sum, run) => sum + run.orderCount, 0);
      console.log(`\n${year}: ${yearRuns.length} runs, ${totalOrders} total orders`);
    });

    console.log('\n🎯 Recommended Run IDs for 2021-2025 Chart Generation:');
    console.log('======================================================');
    
    // Show run IDs that cover the full 2021-2025 range
    const fullRangeRuns = formattedRuns.filter(run => {
      const start = new Date(run.actualOrderStart);
      const end = new Date(run.actualOrderEnd);
      return start >= new Date('2021-01-01') && end <= new Date('2025-12-31');
    });

    console.log('\nOption 1: Use all runs for complete coverage');
    console.log('=============================================');
    const allRunIds = formattedRuns.map(run => run.runId);
    console.log('Run IDs (copy this array):');
    console.log('[');
    allRunIds.forEach((id, index) => {
      console.log(`  "${id}"${index < allRunIds.length - 1 ? ',' : ''}`);
    });
    console.log(']');

    console.log('\nOption 2: Use yearly runs for annual analysis');
    console.log('=============================================');
    Object.keys(runsByYear).sort().forEach(year => {
      const yearRuns = runsByYear[Number(year)];
      console.log(`\n${year} runs:`);
      yearRuns.forEach(run => {
        console.log(`  "${run.runId}" // ${run.orderCount} orders, ${run.actualOrderStart} to ${run.actualOrderEnd}`);
      });
    });

    console.log('\nOption 3: Use longest continuous runs');
    console.log('=====================================');
    const longRuns = formattedRuns.filter(run => run.duration >= 300); // 300+ days
    console.log('Long duration runs (300+ days):');
    longRuns.forEach(run => {
      console.log(`  "${run.runId}" // ${run.duration} days, ${run.orderCount} orders`);
    });

    console.log('\n📊 Chart Generation Command Examples:');
    console.log('====================================');
    
    console.log('\n1. Generate charts for all data:');
    console.log('npx tsx scripts/generateTradeCharts.ts --symbol ETHUSDT --runIds [paste all run IDs above]');
    
    console.log('\n2. Generate charts for a specific year (e.g., 2022):');
    const run2022 = formattedRuns.find(run => run.year === 2022 && run.duration >= 300);
    if (run2022) {
      console.log(`npx tsx scripts/generateTradeCharts.ts --symbol ETHUSDT --runIds ["${run2022.runId}"]`);
    }

    console.log('\n3. Generate charts for recent data (2024-2025):');
    const recentRuns = formattedRuns.filter(run => run.year >= 2024);
    if (recentRuns.length > 0) {
      console.log('npx tsx scripts/generateTradeCharts.ts --symbol ETHUSDT --runIds [');
      recentRuns.forEach((run, index) => {
        console.log(`  "${run.runId}"${index < recentRuns.length - 1 ? ',' : ''}`);
      });
      console.log(']');
    }

    console.log('\n💡 Key Findings:');
    console.log('================');
    console.log(`✅ Found ${formattedRuns.length} valid backtest runs with data`);
    console.log(`📊 Total orders across all runs: ${formattedRuns.reduce((sum, run) => sum + run.orderCount, 0)}`);
    console.log(`📅 Date range: ${formattedRuns[0]?.actualOrderStart} to ${formattedRuns[formattedRuns.length - 1]?.actualOrderEnd}`);
    console.log('🎯 The generateTradeCharts script should work with any of these run IDs');
    console.log('⚠️  If charts only show 2022 data, check the run IDs being passed to the script');

  } catch (error) {
    console.error('❌ Error getting run IDs:', error);
    throw error;
  } finally {
    await dbService.close();
  }
}

// Run the script
if (require.main === module) {
  getBacktestRunIdsForCharts().catch(console.error);
}

export { getBacktestRunIdsForCharts };