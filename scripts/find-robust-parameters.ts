import {
    PrismaClient
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Searching for ROBUST parameter clusters...');

    // We'll focus on major pairs first to prove the concept
    const targetAssets = ['SOL/USDT', 'ETH/USDT', 'BTC/USDT', 'BNB/USDT'];
    const robustConfig: any = {};

    for (const symbol of targetAssets) {
        const [base, quote] = symbol.split('/');
        console.log(`
--- Analyzing ${symbol} ---`);

        // Get all profitable results for this asset to seed the clusters
        const candidates = await prisma.optimizationResults.findMany({
            where: {
                baseAsset: base,
                quoteAsset: quote,
                profitFactor: {
                    gt: 1.1
                },
                totalTrades: {
                    gt: 15
                } // Ensure minimal statistical significance
            },
            select: {
                zScoreThreshold: true,
                movingAverages: true,
                profitPercent: true,
                stopLossPercent: true
            }
        });

        if (candidates.length === 0) {
            console.log(`No profitable candidates found for ${symbol}`);
            continue;
        }

        console.log(`Found ${candidates.length} profitable candidates. Clustering...`);

        // Simple Grid Clustering
        // We group by "Coarse" params: MA rounded to nearest 4, Z rounded to nearest 0.5
        const clusters = new Map<string, {
            results: any[],
            center: { z: number, ma: number, tp: number, sl: number }
        }>();

        for (const c of candidates) {
            // Quantize parameters to define a cluster key
            const zKey = Math.round(c.zScoreThreshold.toNumber() * 2) / 2; // Nearest 0.5
            const maKey = Math.round(c.movingAverages / 4) * 4; // Nearest 4

            const key = `${zKey}|${maKey}`;

            if (!clusters.has(key)) {
                clusters.set(key, {
                    results: [],
                    center: { z: zKey, ma: maKey, tp: 0, sl: 0 }
                });
            }
            clusters.get(key)?.results.push(c);
        }

        // Evaluate Clusters
        let bestCluster = null;
        let bestScore = -Infinity;

        for (const [key, data] of clusters.entries()) {
            const samples = data.results.length;
            if (samples < 5) continue; // Noise

            // Verify this cluster by querying the DB for ALL results in this range (including losers)
            // This is crucial: we need to know if this bucket is "safe" or just has a few lucky winners
            const rangeStats = await prisma.optimizationResults.aggregate({
                _avg: {
                    alpha: true,
                    profitFactor: true,
                    maxDrawdown: true
                },
                _count: {
                    _all: true
                },
                where: {
                    baseAsset: base,
                    quoteAsset: quote,
                    zScoreThreshold: {
                        gte: data.center.z - 0.25,
                        lte: data.center.z + 0.25
                    },
                    movingAverages: {
                        gte: data.center.ma - 2,
                        lte: data.center.ma + 2
                    }
                }
            });

            // Count profitable ones specifically
            const profitableCount = await prisma.optimizationResults.count({
                where: {
                    baseAsset: base,
                    quoteAsset: quote,
                    zScoreThreshold: {
                        gte: data.center.z - 0.25,
                        lte: data.center.z + 0.25
                    },
                    movingAverages: {
                        gte: data.center.ma - 2,
                        lte: data.center.ma + 2
                    },
                    profitFactor: {
                        gt: 1.0
                    }
                }
            });

            const stability = profitableCount / rangeStats._count._all;
            const avgAlpha = rangeStats._avg.alpha?.toNumber() || -999;

            // Score = AvgAlpha * Stability^2 (Heavily penalize instability)
            const score = avgAlpha * (stability * stability);

            console.log(`Cluster [Z~${data.center.z}, MA~${data.center.ma}]: Samples=${rangeStats._count._all}, Stability=${(stability * 100).toFixed(0)}%, AvgAlpha=${avgAlpha.toFixed(1)}, Score=${score.toFixed(1)}`);

            if (score > bestScore && stability > 0.6) { // Min 60% stability to be considered
                bestScore = score;
                bestCluster = {
                    key,
                    stats: rangeStats,
                    stability,
                    center: data.center
                };
            }
        }

        if (bestCluster) {
            console.log(`🏆 WINNER: Cluster ${bestCluster.key} (Score: ${bestScore.toFixed(1)})`);

            // Find the "Center of Mass" parameters for this cluster to use as config
            // We'll take the median TP/SL from the profitable candidates in this cluster
            const clusterCandidates = clusters.get(bestCluster.key)?.results || [];
            const tps = clusterCandidates.map(c => c.profitPercent.toNumber()).sort((a, b) => a - b);
            const sls = clusterCandidates.map(c => c.stopLossPercent.toNumber()).sort((a, b) => a - b);

            const medianTP = tps[Math.floor(tps.length / 2)];
            const medianSL = sls[Math.floor(sls.length / 2)];

            robustConfig[symbol] = {
                zScoreThreshold: bestCluster.center.z,
                movingAverages: bestCluster.center.ma,
                profitPercent: medianTP,
                stopLossPercent: medianSL,
                expectedAlpha: bestCluster.stats._avg.alpha?.toNumber(),
                robustnessScore: bestScore
            };
        } else {
            console.log(`❌ No robust clusters found for ${symbol}`);
        }
    }

    // Save robust config
    const outputPath = path.join(__dirname, '../config/robust-params.json');
    fs.writeFileSync(outputPath, JSON.stringify(robustConfig, null, 2));
    console.log(`
✅ Robust configuration saved to ${outputPath}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
