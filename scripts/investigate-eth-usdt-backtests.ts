#!/usr/bin/env npx tsx

/**
 * Investigate ETH/USDT Backtest Data
 * 
 * This script investigates what backtest runs exist for ETH/USDT with specific parameters:
 * - Z-Score Threshold: 6
 * - Profit Percent: 22
 * - Stop Loss Percent: 6
 * 
 * It will show:
 * - All matching backtest runs with their date ranges and creation dates
 * - Count of orders for each run
 * - Actual date ranges of orders within each run
 * - Why generateTradeCharts might only find 2022 data when requesting 2021-2025
 */

import { ConnectionPoolService } from '../src/lib/database/ConnectionPoolService';
import { config } from 'dotenv';

// Load environment variables
config();

interface BacktestRunInfo {
  id: string;
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  orderCount: number;
  earliestOrderDate?: Date;
  latestOrderDate?: Date;
}

interface BacktestOrderDateRange {
  runId: string;
  orderCount: number;
  earliestDate: Date | null;
  latestDate: Date | null;
}

async function investigateEthUsdtBacktests(): Promise<void> {
  const dbService = ConnectionPoolService.getInstance();
  
  try {
    console.log('🔍 Investigating ETH/USDT Backtest Data');
    console.log('=====================================');
    console.log('Target Parameters:');
    console.log('- Base Asset: ETH');
    console.log('- Quote Asset: USDT');
    console.log('- Z-Score Threshold: 6');
    console.log('- Profit Percent: 22');
    console.log('- Stop Loss Percent: 6');
    console.log('');

    // 1. Find all backtest runs for ETH/USDT with specified parameters
    console.log('📊 Finding matching backtest runs...');
    const backtestRuns = await dbService.cachedQuery<BacktestRunInfo[]>(`
      SELECT 
        id,
        "baseAsset",
        "quoteAsset", 
        "zScoreThreshold",
        "movingAverages",
        "profitPercent",
        "stopLossPercent",
        "startTime",
        "endTime",
        "createdAt"
      FROM backtest_runs
      WHERE "baseAsset" = $1 
        AND "quoteAsset" = $2
        AND "zScoreThreshold" = $3
        AND "profitPercent" = $4
        AND "stopLossPercent" = $5
      ORDER BY "createdAt" DESC
    `, ['ETH', 'USDT', 6, 22, 6]);

    if (backtestRuns.length === 0) {
      console.log('❌ No backtest runs found with the specified parameters!');
      console.log('');
      
      // Let's check what parameters do exist for ETH/USDT
      console.log('🔍 Checking available ETH/USDT parameters...');
      const availableParams = await dbService.cachedQuery<any[]>(`
        SELECT DISTINCT
          "zScoreThreshold",
          "profitPercent", 
          "stopLossPercent",
          COUNT(*) as run_count
        FROM backtest_runs
        WHERE "baseAsset" = 'ETH' AND "quoteAsset" = 'USDT'
        GROUP BY "zScoreThreshold", "profitPercent", "stopLossPercent"
        ORDER BY "zScoreThreshold", "profitPercent", "stopLossPercent"
      `);
      
      console.log('Available parameter combinations for ETH/USDT:');
      console.table(availableParams);
      return;
    }

    console.log(`✅ Found ${backtestRuns.length} matching backtest runs`);
    console.log('');

    // 2. For each run, get order count and date ranges
    console.log('📈 Analyzing order data for each run...');
    const runsWithOrderData: BacktestRunInfo[] = [];

    for (const run of backtestRuns) {
      const orderData = await dbService.cachedQuery<BacktestOrderDateRange[]>(`
        SELECT 
          "runId",
          COUNT(*) as "orderCount",
          MIN("timestamp") as "earliestDate",
          MAX("timestamp") as "latestDate"
        FROM backtest_orders
        WHERE "runId" = $1
        GROUP BY "runId"
      `, [run.id]);

      const enrichedRun: BacktestRunInfo = {
        ...run,
        orderCount: orderData.length > 0 ? Number(orderData[0].orderCount) : 0,
        earliestOrderDate: orderData.length > 0 ? orderData[0].earliestDate : undefined,
        latestOrderDate: orderData.length > 0 ? orderData[0].latestDate : undefined
      };

      runsWithOrderData.push(enrichedRun);
    }

    // 3. Display results in a clear format
    console.log('📋 Backtest Run Summary:');
    console.log('========================');
    
    runsWithOrderData.forEach((run, index) => {
      console.log(`\nRun ${index + 1}:`);
      console.log(`  Run ID: ${run.id}`);
      console.log(`  Created: ${run.createdAt.toISOString()}`);
      console.log(`  Backtest Period: ${run.startTime.toISOString()} to ${run.endTime.toISOString()}`);
      console.log(`  Duration: ${Math.round((run.endTime.getTime() - run.startTime.getTime()) / (1000 * 60 * 60 * 24))} days`);
      console.log(`  Moving Averages: ${run.movingAverages}`);
      console.log(`  Order Count: ${run.orderCount}`);
      
      if (run.earliestOrderDate && run.latestOrderDate) {
        console.log(`  Actual Order Range: ${run.earliestOrderDate.toISOString()} to ${run.latestOrderDate.toISOString()}`);
        console.log(`  Actual Order Duration: ${Math.round((run.latestOrderDate.getTime() - run.earliestOrderDate.getTime()) / (1000 * 60 * 60 * 24))} days`);
      } else {
        console.log(`  ⚠️  No orders found for this run!`);
      }
    });

    // 4. Analyze why charts might only show 2022 data
    console.log('\n🎯 Analysis: Why charts might only show 2022 data');
    console.log('==================================================');

    // Check for orders in different years
    const ordersByYear = await dbService.cachedQuery<any[]>(`
      SELECT 
        EXTRACT(YEAR FROM "timestamp") as year,
        COUNT(*) as order_count,
        MIN("timestamp") as earliest_date,
        MAX("timestamp") as latest_date
      FROM backtest_orders bo
      JOIN backtest_runs br ON bo."runId" = br.id
      WHERE br."baseAsset" = 'ETH' 
        AND br."quoteAsset" = 'USDT'
        AND br."zScoreThreshold" = 6
        AND br."profitPercent" = 22
        AND br."stopLossPercent" = 6
      GROUP BY EXTRACT(YEAR FROM "timestamp")
      ORDER BY year
    `);

    if (ordersByYear.length > 0) {
      console.log('Orders by year for ETH/USDT with target parameters:');
      console.table(ordersByYear.map(row => ({
        Year: row.year,
        'Order Count': row.order_count,
        'Earliest Date': new Date(row.earliest_date).toISOString().split('T')[0],
        'Latest Date': new Date(row.latest_date).toISOString().split('T')[0]
      })));
    } else {
      console.log('❌ No orders found for any year with the specified parameters');
    }

    // 5. Check if there are any ETH/USDT runs in the 2021-2025 range
    console.log('\n🔍 Checking for ETH/USDT runs in 2021-2025 range...');
    const rangeRuns = await dbService.cachedQuery<any[]>(`
      SELECT 
        COUNT(*) as run_count,
        MIN("startTime") as earliest_start,
        MAX("endTime") as latest_end,
        COUNT(DISTINCT 
          CONCAT("zScoreThreshold", '-', "profitPercent", '-', "stopLossPercent")
        ) as unique_param_combinations
      FROM backtest_runs
      WHERE "baseAsset" = 'ETH' 
        AND "quoteAsset" = 'USDT'
        AND "startTime" >= '2021-01-01'
        AND "endTime" <= '2025-12-31'
    `);

    if (rangeRuns.length > 0 && rangeRuns[0].run_count > 0) {
      console.log('ETH/USDT runs in 2021-2025 range:');
      console.table(rangeRuns.map(row => ({
        'Total Runs': row.run_count,
        'Earliest Start': new Date(row.earliest_start).toISOString().split('T')[0],
        'Latest End': new Date(row.latest_end).toISOString().split('T')[0],
        'Unique Parameter Combinations': row.unique_param_combinations
      })));
    } else {
      console.log('❌ No ETH/USDT runs found in 2021-2025 range');
    }

    // 6. Show recommendations
    console.log('\n💡 Recommendations:');
    console.log('===================');
    
    if (runsWithOrderData.length === 0) {
      console.log('1. ❌ No backtest runs exist with the specified parameters (Z-Score=6, Profit=22%, Stop=6%)');
      console.log('2. 🔧 Run backtests with these parameters first using the backtest scripts');
      console.log('3. 📊 Check the available parameter combinations shown above');
    } else if (runsWithOrderData.every(run => run.orderCount === 0)) {
      console.log('1. ⚠️  Backtest runs exist but contain no orders');
      console.log('2. 🔧 This might indicate the strategy parameters were too restrictive');
      console.log('3. 📊 Consider running backtests with different parameters');
    } else {
      const validRuns = runsWithOrderData.filter(run => run.orderCount > 0);
      const totalOrders = validRuns.reduce((sum, run) => sum + run.orderCount, 0);
      console.log(`1. ✅ Found ${validRuns.length} valid runs with ${totalOrders} total orders`);
      
      if (ordersByYear.length > 0) {
        const years = ordersByYear.map(row => row.year).join(', ');
        console.log(`2. 📅 Orders exist for years: ${years}`);
        
        if (!ordersByYear.find(row => row.year >= 2021 && row.year <= 2025)) {
          console.log('3. ⚠️  No orders found in 2021-2025 range - this explains why charts show limited data');
        } else {
          console.log('3. ✅ Orders found in requested range');
        }
      }
    }

  } catch (error) {
    console.error('❌ Error investigating backtest data:', error);
    throw error;
  } finally {
    await dbService.close();
  }
}

// Run the investigation
if (require.main === module) {
  investigateEthUsdtBacktests().catch(console.error);
}

export { investigateEthUsdtBacktests };