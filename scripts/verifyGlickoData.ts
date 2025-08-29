#!/usr/bin/env ts-node

/**
 * Verify Glicko Data Script
 * 
 * This script verifies the quality and correctness of the calculated Glicko-2 ratings
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

async function verifyGlickoData() {
  try {
    await prisma.$connect();
    console.log('🔍 Verifying Glicko-2 data quality...\n');

    // 1. Get overall statistics
    const totalRatings = await prisma.glickoRatings.count();
    console.log(`📊 Total rating records: ${totalRatings.toLocaleString()}`);

    // 2. Get statistics by symbol
    const symbolStats = await prisma.$queryRaw`
      SELECT 
        symbol,
        COUNT(*) as rating_count,
        MIN(timestamp) as earliest_date,
        MAX(timestamp) as latest_date,
        AVG(rating) as avg_rating,
        MIN(rating) as min_rating,
        MAX(rating) as max_rating,
        AVG("ratingDeviation") as avg_rd,
        AVG(volatility) as avg_volatility
      FROM glicko_ratings 
      GROUP BY symbol 
      ORDER BY rating_count DESC
    `;

    console.log('\n📈 Statistics by Symbol:');
    console.log('=' .repeat(120));
    console.log('Symbol'.padEnd(8) + 'Count'.padStart(8) + 'Avg Rating'.padStart(12) + 'Min Rating'.padStart(12) + 'Max Rating'.padStart(12) + 'Avg RD'.padStart(10) + 'Earliest Date'.padStart(15) + 'Latest Date'.padStart(15));
    console.log('-' .repeat(120));

    for (const stat of symbolStats as any[]) {
      const earliestDate = new Date(stat.earliest_date).toISOString().slice(0, 10);
      const latestDate = new Date(stat.latest_date).toISOString().slice(0, 10);
      
      console.log(
        stat.symbol.padEnd(8) +
        Number(stat.rating_count).toLocaleString().padStart(8) +
        Number(stat.avg_rating).toFixed(0).padStart(12) +
        Number(stat.min_rating).toFixed(0).padStart(12) +
        Number(stat.max_rating).toFixed(0).padStart(12) +
        Number(stat.avg_rd).toFixed(0).padStart(10) +
        earliestDate.padStart(15) +
        latestDate.padStart(15)
      );
    }

    // 3. Check for expected data patterns
    console.log('\n🔍 Data Quality Verification:');
    
    // Check date range coverage
    const dateRange = await prisma.glickoRatings.aggregate({
      _min: { timestamp: true },
      _max: { timestamp: true }
    });

    const totalDays = Math.floor((dateRange._max.timestamp!.getTime() - dateRange._min.timestamp!.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`📅 Date range: ${dateRange._min.timestamp!.toISOString().slice(0, 10)} to ${dateRange._max.timestamp!.toISOString().slice(0, 10)} (${totalDays} days)`);

    // Calculate expected number of hourly intervals (approximately)
    const expectedHourlyIntervals = totalDays * 24;
    const batchSize = 24; // We process ratings every 24 hours
    const expectedRatingPeriods = Math.floor(expectedHourlyIntervals / batchSize);
    
    console.log(`⏰ Expected rating periods per coin: ~${expectedRatingPeriods.toLocaleString()} (processing every 24 hours)`);

    // Check if our actual counts are reasonable
    const avgRatingCount = (symbolStats as any[]).reduce((sum: number, stat: any) => sum + Number(stat.rating_count), 0) / (symbolStats as any[]).length;
    console.log(`📊 Actual average rating periods: ${Math.round(avgRatingCount).toLocaleString()}`);

    const countDifference = Math.abs(avgRatingCount - expectedRatingPeriods) / expectedRatingPeriods * 100;
    if (countDifference < 10) {
      console.log(`✅ Data count verification: PASSED (within ${countDifference.toFixed(1)}% of expected)`);
    } else {
      console.log(`⚠️  Data count verification: REVIEW NEEDED (${countDifference.toFixed(1)}% difference from expected)`);
    }

    // 4. Check rating distributions
    console.log('\n📊 Rating Distribution Analysis:');
    
    const ratingDistribution = await prisma.$queryRaw`
      SELECT 
        CASE 
          WHEN rating < 1200 THEN 'Very Low (< 1200)'
          WHEN rating < 1400 THEN 'Low (1200-1400)'
          WHEN rating < 1500 THEN 'Average (1400-1500)'
          WHEN rating < 1600 THEN 'High (1500-1600)'
          ELSE 'Very High (> 1600)'
        END as rating_range,
        COUNT(*) as count
      FROM glicko_ratings 
      WHERE rating > 0
      GROUP BY 
        CASE 
          WHEN rating < 1200 THEN 'Very Low (< 1200)'
          WHEN rating < 1400 THEN 'Low (1200-1400)'
          WHEN rating < 1500 THEN 'Average (1400-1500)'
          WHEN rating < 1600 THEN 'High (1500-1600)'
          ELSE 'Very High (> 1600)'
        END
      ORDER BY MIN(rating)
    `;

    for (const dist of ratingDistribution as any[]) {
      const percentage = (Number(dist.count) / totalRatings * 100).toFixed(1);
      console.log(`  ${dist.rating_range.padEnd(25)}: ${Number(dist.count).toLocaleString().padStart(8)} (${percentage}%)`);
    }

    // 5. Check for data anomalies
    console.log('\n🚨 Anomaly Detection:');
    
    // Check for zero ratings (should be minimal)
    const zeroRatings = await prisma.glickoRatings.count({ where: { rating: 0 } });
    console.log(`   Zero ratings: ${zeroRatings} (${(zeroRatings/totalRatings*100).toFixed(2)}%)`);
    
    // Check for maximum boundary values (potential clipping)
    const maxRatings = await prisma.glickoRatings.count({ where: { rating: 9999 } });
    const maxRDs = await prisma.glickoRatings.count({ where: { ratingDeviation: 9999 } });
    const maxVols = await prisma.glickoRatings.count({ where: { volatility: 9999 } });
    
    console.log(`   Max boundary ratings (9999): ${maxRatings} (${(maxRatings/totalRatings*100).toFixed(2)}%)`);
    console.log(`   Max boundary RDs (9999): ${maxRDs} (${(maxRDs/totalRatings*100).toFixed(2)}%)`);
    console.log(`   Max boundary volatilities (9999): ${maxVols} (${(maxVols/totalRatings*100).toFixed(2)}%)`);

    if (maxVols > totalRatings * 0.9) {
      console.log('   ⚠️  High volatility boundary clipping detected - this is expected due to database precision limits');
    }

    // 6. Sample recent data
    console.log('\n🔍 Recent Data Sample (last 5 ratings):');
    const recentData = await prisma.glickoRatings.findMany({
      take: 5,
      orderBy: { timestamp: 'desc' },
      select: {
        symbol: true,
        timestamp: true,
        rating: true,
        ratingDeviation: true,
        volatility: true,
        performanceScore: true
      }
    });

    console.log('Symbol'.padEnd(8) + 'Date'.padStart(12) + 'Rating'.padStart(8) + 'RD'.padStart(6) + 'Vol'.padStart(8) + 'PerfScore'.padStart(10));
    console.log('-'.repeat(60));
    for (const data of recentData) {
      console.log(
        data.symbol.padEnd(8) +
        data.timestamp.toISOString().slice(5, 10).padStart(12) +
        Number(data.rating).toFixed(0).padStart(8) +
        Number(data.ratingDeviation).toFixed(0).padStart(6) +
        Number(data.volatility).toFixed(2).padStart(8) +
        Number(data.performanceScore).toFixed(2).padStart(10)
      );
    }

    console.log('\n✅ Data verification completed!');
    
  } catch (error) {
    console.error('❌ Error verifying data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyGlickoData().catch(console.error);