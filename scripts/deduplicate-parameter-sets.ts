#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

interface ParameterSet {
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  startTime: Date;
  endTime: Date;
  windowSize?: number | null;
}

interface DuplicateGroup {
  parameterHash: string;
  runIds: number[];
  bestRunId: number;
  bestAnnualizedReturn: number;
}

/**
 * Creates a consistent hash for a parameter set to identify duplicates
 */
function createParameterHash(params: ParameterSet): string {
  const normalizedParams = {
    baseAsset: params.baseAsset,
    quoteAsset: params.quoteAsset,
    zScoreThreshold: params.zScoreThreshold,
    movingAverages: params.movingAverages,
    profitPercent: params.profitPercent,
    stopLossPercent: params.stopLossPercent,
    startTime: params.startTime.toISOString(),
    endTime: params.endTime.toISOString(),
    windowSize: params.windowSize || 12, // Default to 12 if null/undefined
  };
  
  const hashString = JSON.stringify(normalizedParams);
  return createHash('md5').update(hashString).digest('hex');
}

/**
 * Identifies duplicate parameter sets in the database
 */
async function identifyDuplicates(): Promise<DuplicateGroup[]> {
  console.log('🔍 Identifying duplicate parameter sets...');
  
  // Get all backtest runs with their optimization results
  const runs = await prisma.backtestRuns.findMany({
    include: {
      optimizationResults: true,
    },
  });

  console.log(`📊 Found ${runs.length} total backtest runs`);

  // Group runs by parameter hash
  const parameterGroups = new Map<string, Array<{ runId: number; annualizedReturn: number }>>();

  for (const run of runs) {
    const parameterSet: ParameterSet = {
      baseAsset: run.baseAsset,
      quoteAsset: run.quoteAsset,
      zScoreThreshold: run.zScoreThreshold,
      movingAverages: run.movingAverages,
      profitPercent: run.profitPercent,
      stopLossPercent: run.stopLossPercent,
      startTime: run.startTime,
      endTime: run.endTime,
      windowSize: run.windowSize,
    };

    const hash = createParameterHash(parameterSet);
    
    // Use annualized return from optimization results, fallback to 0 if not available
    const annualizedReturn = run.optimizationResults?.annualizedReturn ?? 0;

    if (!parameterGroups.has(hash)) {
      parameterGroups.set(hash, []);
    }

    parameterGroups.get(hash)!.push({
      runId: run.id,
      annualizedReturn,
    });
  }

  // Filter to only groups with duplicates and find the best performer
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [hash, group] of parameterGroups.entries()) {
    if (group.length > 1) {
      // Sort by annualized return (descending) to find the best performer
      group.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

      duplicateGroups.push({
        parameterHash: hash,
        runIds: group.map(item => item.runId),
        bestRunId: group[0].runId,
        bestAnnualizedReturn: group[0].annualizedReturn,
      });
    }
  }

  console.log(`🔄 Found ${duplicateGroups.length} parameter sets with duplicates`);
  
  // Log summary of duplicates
  let totalDuplicateRuns = 0;
  for (const group of duplicateGroups) {
    totalDuplicateRuns += group.runIds.length - 1; // Subtract 1 because we keep the best one
    console.log(`   📋 Parameter set ${group.parameterHash.substring(0, 8)}... has ${group.runIds.length} duplicates (keeping run ${group.bestRunId} with ${group.bestAnnualizedReturn.toFixed(2)}% return)`);
  }

  console.log(`🗑️  Will remove ${totalDuplicateRuns} duplicate runs`);

  return duplicateGroups;
}

/**
 * Removes duplicate entries, keeping only the best performing run for each parameter set
 */
async function removeDuplicates(duplicateGroups: DuplicateGroup[], dryRun: boolean = true): Promise<void> {
  if (duplicateGroups.length === 0) {
    console.log('✅ No duplicates found to remove');
    return;
  }

  if (dryRun) {
    console.log('🧪 DRY RUN - No changes will be made');
  } else {
    console.log('⚠️  LIVE RUN - Database changes will be made');
  }

  let totalOrdersToDelete = 0;
  let totalOptimizationsToDelete = 0;
  let totalRunsToDelete = 0;

  for (const group of duplicateGroups) {
    const runIdsToDelete = group.runIds.filter(id => id !== group.bestRunId);
    
    for (const runId of runIdsToDelete) {
      // Count what will be deleted
      const orderCount = await prisma.backtestOrders.count({
        where: { runId },
      });
      const optimizationCount = await prisma.optimizationResults.count({
        where: { runId },
      });

      totalOrdersToDelete += orderCount;
      totalOptimizationsToDelete += optimizationCount;
      totalRunsToDelete += 1;

      console.log(`   🗑️  Will delete run ${runId}: ${orderCount} orders, ${optimizationCount} optimization results`);

      if (!dryRun) {
        // Delete in correct order due to foreign key constraints
        await prisma.backtestOrders.deleteMany({
          where: { runId },
        });

        await prisma.optimizationResults.deleteMany({
          where: { runId },
        });

        await prisma.backtestRuns.delete({
          where: { id: runId },
        });

        console.log(`   ✅ Deleted run ${runId}`);
      }
    }
  }

  console.log('\n📈 Summary:');
  console.log(`   Duplicate runs: ${totalRunsToDelete}`);
  console.log(`   Backtest orders: ${totalOrdersToDelete}`);
  console.log(`   Optimization results: ${totalOptimizationsToDelete}`);

  if (dryRun) {
    console.log('\n💡 Run with --execute flag to perform actual deletion');
  } else {
    console.log('\n✅ Deduplication completed successfully');
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting deduplication process...\n');

    const duplicateGroups = await identifyDuplicates();
    
    // Check if --execute flag is provided
    const executeMode = process.argv.includes('--execute');
    
    await removeDuplicates(duplicateGroups, !executeMode);

  } catch (error) {
    console.error('❌ Error during deduplication:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { identifyDuplicates, removeDuplicates };