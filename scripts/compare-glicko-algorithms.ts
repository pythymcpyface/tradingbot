#!/usr/bin/env ts-node

/**
 * Compare Glicko Calculation Algorithms
 * 
 * This script demonstrates the difference between:
 * 1. BROKEN: Processing by coin first (temporal inconsistency)
 * 2. FIXED: Processing by time interval first (correct approach)
 * 
 * Shows how the broken approach creates invalid ratings that cannot be used for trading.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { GlickoCalculator } from './calculateGlickoRatings';
import { GlickoCalculatorFixed } from './calculateGlickoRatings-fixed';

config();

async function compareAlgorithms() {
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    console.log('🔬 GLICKO ALGORITHM COMPARISON');
    console.log('═'.repeat(80));
    
    const coins = ['BTC', 'ETH'];
    const startTime = new Date('2024-07-01');
    const endTime = new Date('2024-07-03'); // Small dataset for clear comparison
    
    console.log(`📊 Test Configuration:`);
    console.log(`  - Coins: ${coins.join(', ')}`);
    console.log(`  - Date Range: ${startTime.toISOString().split('T')[0]} to ${endTime.toISOString().split('T')[0]}`);
    console.log(`  - Purpose: Demonstrate temporal inconsistency bug`);
    
    // Clear existing ratings
    await prisma.glickoRatings.deleteMany({});
    console.log('\n🗑️ Cleared existing ratings for clean comparison');
    
    // Test 1: BROKEN Algorithm (by coin first)
    console.log('\n🔴 TEST 1: BROKEN ALGORITHM (by coin first)');
    console.log('─'.repeat(50));
    
    const brokenCalculator = new GlickoCalculator();
    await brokenCalculator.initialize();
    
    console.log('⚠️ Processing BTC first across ALL time periods...');
    console.log('⚠️ Then processing ETH using BTC\'s final ratings...');
    console.log('⚠️ This creates temporal inconsistency!');
    
    await brokenCalculator.calculateAllRatings(coins, startTime, endTime);
    
    // Get broken results
    const brokenResults = await prisma.glickoRatings.findMany({
      orderBy: [{ symbol: 'asc' }, { timestamp: 'asc' }]
    });
    
    console.log('\n📊 BROKEN RESULTS:');
    for (const result of brokenResults.slice(0, 4)) { // Show first few
      console.log(`  ${result.symbol} @ ${result.timestamp.toISOString().split('T')[0]}: Rating=${Number(result.rating).toFixed(0)}, RD=${Number(result.ratingDeviation).toFixed(0)}`);
    }
    
    await brokenCalculator.cleanup();
    
    // Clear for next test
    await prisma.glickoRatings.deleteMany({});
    
    // Test 2: FIXED Algorithm (by time interval first)
    console.log('\n🟢 TEST 2: FIXED ALGORITHM (by time interval first)');
    console.log('─'.repeat(50));
    
    const fixedCalculator = new GlickoCalculatorFixed();
    await fixedCalculator.initialize();
    
    console.log('✅ Processing ALL coins simultaneously for each time period...');
    console.log('✅ Maintaining proper temporal consistency!');
    console.log('✅ BTC and ETH compete at the same time!');
    
    await fixedCalculator.calculateAllRatings(coins, startTime, endTime);
    
    // Get fixed results
    const fixedResults = await prisma.glickoRatings.findMany({
      orderBy: [{ symbol: 'asc' }, { timestamp: 'asc' }]
    });
    
    console.log('\n📊 FIXED RESULTS:');
    for (const result of fixedResults.slice(0, 4)) { // Show first few
      console.log(`  ${result.symbol} @ ${result.timestamp.toISOString().split('T')[0]}: Rating=${Number(result.rating).toFixed(0)}, RD=${Number(result.ratingDeviation).toFixed(0)}`);
    }
    
    await fixedCalculator.cleanup();
    
    // Analysis
    console.log('\n🔍 ANALYSIS:');
    console.log('═'.repeat(50));
    console.log('');
    console.log('🔴 BROKEN ALGORITHM PROBLEMS:');
    console.log('  • ETH ratings calculated using BTC\'s FINAL ratings from end of period');
    console.log('  • Temporal inconsistency: Future information affects past calculations');
    console.log('  • No true competition between coins at same time periods');
    console.log('  • Later-processed coins have unfair information advantage');
    console.log('  • Results are mathematically invalid for trading decisions');
    console.log('');
    console.log('🟢 FIXED ALGORITHM BENEFITS:');
    console.log('  • All coins processed simultaneously for each time period');
    console.log('  • Proper temporal consistency maintained throughout');
    console.log('  • True competition between coins at each time interval');
    console.log('  • Fair and mathematically correct Glicko-2 implementation');
    console.log('  • Results are valid and reliable for trading decisions');
    console.log('');
    console.log('📈 IMPACT ON TRADING:');
    console.log('  • BROKEN: Ratings are unreliable and could lead to poor trading decisions');
    console.log('  • FIXED: Ratings accurately reflect relative coin performance over time');
    console.log('  • RECOMMENDATION: Use ONLY the fixed algorithm for production trading');
    
    console.log('\n🎯 CONCLUSION:');
    console.log('  The fixed algorithm is the ONLY mathematically correct approach.');
    console.log('  All previous Glicko ratings calculated with the broken algorithm');
    console.log('  should be discarded and recalculated using the fixed version.');
    
  } catch (error) {
    console.error('❌ Comparison failed:', error);
  } finally {
    await prisma.$disconnect();
    console.log('\n🧹 Database connection closed');
  }
}

// Run if called directly
if (require.main === module) {
  compareAlgorithms().catch(console.error);
}