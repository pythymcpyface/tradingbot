#!/usr/bin/env ts-node

/**
 * Test Parameter Sets Loading
 * 
 * This script tests the parameter set loading functionality without starting the trading engine.
 */

import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ParameterSetManager } from '../src/services/ParameterSetManager';

config();

async function testParameterSets() {
  console.log('🧪 Testing Parameter Set Loading...');
  console.log('=' .repeat(50));

  try {
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Connected to database');

    const parameterManager = new ParameterSetManager(prisma);

    // Test 1: Load from example file
    console.log('\n📁 Test 1: Loading from example file...');
    try {
      const fileParams = await parameterManager.loadParameterSets({
        source: 'file',
        filePath: './example-parameter-sets.json'
      });
      console.log(`✅ Loaded ${fileParams.length} parameter sets from file`);
      
      for (const params of fileParams.slice(0, 3)) {
        console.log(`   ${params.symbol}: threshold=${params.zScoreThreshold}, profit=${params.profitPercent}%`);
      }
    } catch (error) {
      console.log(`❌ File loading failed: ${(error as Error).message}`);
    }

    // Test 2: Load from database (if optimization results exist)
    console.log('\n🗄️  Test 2: Loading from database...');
    try {
      const dbParams = await parameterManager.loadParameterSets({
        source: 'database',
        databaseQuery: {
          metric: 'sharpeRatio',
          baseAssets: ['BTC', 'ETH', 'ADA'],
          minTrades: 1, // Lower threshold for testing
          limit: 5
        }
      });
      console.log(`✅ Loaded ${dbParams.length} parameter sets from database`);
      
      for (const params of dbParams) {
        console.log(`   ${params.symbol}: threshold=${params.zScoreThreshold}, MA=${params.movingAverages}`);
      }
    } catch (error) {
      console.log(`❌ Database loading failed: ${(error as Error).message}`);
    }

    // Test 3: Manual parameter sets
    console.log('\n⚙️  Test 3: Manual parameter sets...');
    const manualParams = await parameterManager.loadParameterSets({
      source: 'manual',
      parameterSets: [
        {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          zScoreThreshold: 2.5,
          movingAverages: 100,
          profitPercent: 4.0,
          stopLossPercent: 2.0,
          allocationPercent: 20.0,
          enabled: true
        },
        {
          symbol: 'ETHUSDT',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
          zScoreThreshold: 3.5,
          movingAverages: 150,
          profitPercent: 6.0,
          stopLossPercent: 3.0,
          allocationPercent: 15.0,
          enabled: true
        }
      ]
    });
    console.log(`✅ Loaded ${manualParams.length} manual parameter sets`);

    // Test 4: Parameter queries
    console.log('\n🔍 Test 4: Parameter queries...');
    const btcParams = parameterManager.getParametersForSymbol('BTCUSDT');
    if (btcParams) {
      console.log(`✅ BTC parameters: z=${btcParams.zScoreThreshold}, allocation=${btcParams.allocationPercent}%`);
    }

    const activeSymbols = parameterManager.getActiveSymbols();
    console.log(`✅ Active symbols: ${activeSymbols.join(', ')}`);

    // Test 5: Export functionality
    console.log('\n📤 Test 5: Export functionality...');
    try {
      await parameterManager.exportToFile('./test-export.json');
      console.log('✅ Export completed successfully');
    } catch (error) {
      console.log(`❌ Export failed: ${(error as Error).message}`);
    }

    await prisma.$disconnect();
    console.log('\n✅ All tests completed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  testParameterSets().catch(console.error);
}

export { testParameterSets };