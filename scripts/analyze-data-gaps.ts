#!/usr/bin/env ts-node

/**
 * Analyze Data Gaps
 *
 * Identifies missing data that could improve parameter optimization reliability.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

async function analyze(): Promise<void> {
  await prisma.$connect();
  console.log('Connected to database\n');

  // 1. Find pairs in klines but not optimized
  const klinesSymbols = await prisma.$queryRaw<{ symbol: string }[]>`
    SELECT DISTINCT symbol FROM klines ORDER BY symbol
  `;

  const optPairs = await prisma.$queryRaw<{ symbol: string }[]>`
    SELECT DISTINCT "baseAsset" || "quoteAsset" as symbol
    FROM optimization_results
  `;

  const optSet = new Set(optPairs.map(p => p.symbol));
  const missingOpt = klinesSymbols.filter(k => !optSet.has(k.symbol));

  console.log('=== PAIRS IN KLINES BUT NOT OPTIMIZED ===');
  console.log('Count:', missingOpt.length);
  if (missingOpt.length > 0) {
    console.log('Symbols:', missingOpt.map(m => m.symbol).join(', '));
  }

  // 2. Check which base assets are missing quote asset pairs
  interface AssetCoverage {
    baseAsset: string;
    quoteAssets: string;
  }

  const assetCoverage = await prisma.$queryRaw<AssetCoverage[]>`
    SELECT
      "baseAsset",
      STRING_AGG(DISTINCT "quoteAsset", ', ' ORDER BY "quoteAsset") as "quoteAssets"
    FROM optimization_results
    GROUP BY "baseAsset"
    ORDER BY "baseAsset"
  `;

  console.log('\n=== QUOTE ASSET COVERAGE BY BASE ===');
  console.log('Base   | Quote Assets');
  assetCoverage.forEach(a => {
    console.log(`${a.baseAsset.padEnd(6)} | ${a.quoteAssets}`);
  });

  // 3. Check Glicko ratings coverage
  interface GlickoCoverage {
    symbol: string;
    ratings: number;
    first_date: Date;
    last_date: Date;
  }

  const glickoSymbols = await prisma.$queryRaw<GlickoCoverage[]>`
    SELECT
      symbol,
      COUNT(*)::int as ratings,
      MIN(timestamp)::date as first_date,
      MAX(timestamp)::date as last_date
    FROM glicko_ratings
    GROUP BY symbol
    ORDER BY ratings DESC
  `;

  console.log('\n=== GLICKO RATINGS COVERAGE ===');
  console.log('Symbol       | Ratings   | Date Range');
  glickoSymbols.slice(0, 10).forEach(g => {
    const start = g.first_date.toISOString().split('T')[0];
    const end = g.last_date.toISOString().split('T')[0];
    console.log(`${g.symbol.padEnd(12)} | ${String(g.ratings).padStart(8)}  | ${start} to ${end}`);
  });
  console.log(`Total symbols with Glicko ratings: ${glickoSymbols.length}`);

  // 4. Check for symbols in klines without Glicko ratings
  const glickoSet = new Set(glickoSymbols.map(g => g.symbol));
  const klinesOnlySymbols = klinesSymbols.filter(k => !glickoSet.has(k.symbol));

  console.log('\n=== KLINES WITHOUT GLICKO RATINGS ===');
  console.log('Count:', klinesOnlySymbols.length);
  if (klinesOnlySymbols.length > 0) {
    console.log('Symbols:', klinesOnlySymbols.map(k => k.symbol).join(', '));
  }

  // 5. Parameter combinations tested
  interface ParamStats {
    total_combinations: number;
    combinations_per_pair: number;
  }

  const paramStats = await prisma.$queryRaw<ParamStats[]>`
    SELECT
      COUNT(DISTINCT "zScoreThreshold" || '-' || "movingAverages" || '-' || "profitPercent" || '-' || "stopLossPercent")::int as total_combinations,
      (COUNT(*)::float / COUNT(DISTINCT "baseAsset" || "quoteAsset"))::int as combinations_per_pair
    FROM optimization_results
  `;

  console.log('\n=== PARAMETER SPACE COVERAGE ===');
  console.log(`Total unique parameter combinations tested: ${paramStats[0].total_combinations}`);
  console.log(`Average combinations per pair: ${paramStats[0].combinations_per_pair}`);

  // Theoretical max combinations
  const zScoreSteps = 31; // 1.5 to 4.5 in 0.1 steps
  const maSteps = 10; // 2 to 20 in steps of 2
  const profitSteps = 29; // 1 to 15 in 0.5 steps
  const stopSteps = 19; // 1 to 10 in 0.5 steps
  const theoreticalMax = zScoreSteps * maSteps * profitSteps * stopSteps;

  console.log(`Theoretical max combinations: ${theoreticalMax.toLocaleString()}`);
  console.log(`Coverage: ${((paramStats[0].total_combinations / theoreticalMax) * 100).toFixed(2)}%`);

  // 6. Recent data check - is optimization data up to date?
  interface DateCheck {
    latest_opt: Date;
    latest_klines: Date;
  }

  const dateCheck = await prisma.$queryRaw<DateCheck[]>`
    SELECT
      (SELECT MAX("endTime") FROM optimization_results) as latest_opt,
      (SELECT MAX("openTime") FROM klines) as latest_klines
  `;

  console.log('\n=== DATA FRESHNESS ===');
  console.log(`Latest optimization window ends: ${dateCheck[0].latest_opt?.toISOString().split('T')[0] || 'N/A'}`);
  console.log(`Latest klines data: ${dateCheck[0].latest_klines?.toISOString().split('T')[0] || 'N/A'}`);

  await prisma.$disconnect();
}

analyze().catch(console.error);
