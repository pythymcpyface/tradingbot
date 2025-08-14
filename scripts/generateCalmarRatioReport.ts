#!/usr/bin/env ts-node

/**
 * Generate Comprehensive Calmar Ratio Analysis Report
 * 
 * Creates detailed analysis of parameter performance using Calmar ratios,
 * including HTML reports and database insights.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

interface CalmarAnalysis {
  topIndividualResults: any[];
  topParametersByCalmar: any[];
  topParametersByConsistency: any[];
  bestRiskAdjusted: any[];
  calmarDistribution: { range: string; count: number }[];
  parameterEffectiveness: {
    zScoreOptimal: number[];
    profitPercentOptimal: number[];
    stopLossOptimal: number[];
  };
}

class CalmarRatioReporter {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize(): Promise<void> {
    await this.prisma.$connect();
    console.log('✅ Connected to database');
  }

  /**
   * Generate comprehensive Calmar ratio analysis
   */
  async generateComprehensiveAnalysis(): Promise<CalmarAnalysis> {
    console.log('📊 Generating comprehensive Calmar ratio analysis...');

    // Get all optimization results with Calmar ratios
    const results = await this.prisma.optimizationResults.findMany({
      where: {
        calmarRatio: { not: null },
        totalTrades: { gt: 5 }
      },
      select: {
        zScoreThreshold: true,
        profitPercent: true,
        stopLossPercent: true,
        movingAverages: true,
        calmarRatio: true,
        annualizedReturn: true,
        maxDrawdown: true,
        sharpeRatio: true,
        winRatio: true,
        totalTrades: true,
        baseAsset: true,
        quoteAsset: true,
        startTime: true,
        endTime: true
      }
    });

    console.log(`   Analyzing ${results.length} results...`);

    // Get top individual results (deduplicated)
    const topIndividualResults = this.getTopIndividualResults(results);
    
    // Group by parameter sets and calculate statistics
    const parameterGroups = this.groupByParameters(results);
    
    // Top performers by Calmar ratio
    const topParametersByCalmar = this.getTopPerformers(parameterGroups, 'calmar');
    
    // Top performers by consistency
    const topParametersByConsistency = this.getTopPerformers(parameterGroups, 'consistency');
    
    // Best risk-adjusted performers
    const bestRiskAdjusted = this.getBestRiskAdjusted(parameterGroups);
    
    // Calmar ratio distribution
    const calmarDistribution = this.getCalmarDistribution(results);
    
    // Parameter effectiveness analysis
    const parameterEffectiveness = this.analyzeParameterEffectiveness(parameterGroups);

    return {
      topIndividualResults,
      topParametersByCalmar,
      topParametersByConsistency,
      bestRiskAdjusted,
      calmarDistribution,
      parameterEffectiveness
    };
  }

  /**
   * Get top individual results with deduplication by parameter combination
   */
  private getTopIndividualResults(results: any[]) {
    // Deduplicate by parameter combination, keeping the best Calmar ratio for each unique combination
    const parameterMap = new Map<string, any>();
    
    for (const result of results) {
      const paramKey = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.baseAsset}_${result.quoteAsset}`;
      const currentCalmar = parseFloat(result.calmarRatio!.toString());
      
      if (!parameterMap.has(paramKey) || currentCalmar > parseFloat(parameterMap.get(paramKey).calmarRatio.toString())) {
        parameterMap.set(paramKey, result);
      }
    }

    // Convert back to array and sort by Calmar ratio, then take top 15
    return Array.from(parameterMap.values())
      .sort((a, b) => parseFloat(b.calmarRatio!.toString()) - parseFloat(a.calmarRatio!.toString()))
      .slice(0, 15);
  }

  private groupByParameters(results: any[]) {
    const groups = new Map();
    
    for (const result of results) {
      // Use the same full key for consistency with individual results
      const key = `${result.zScoreThreshold}_${result.profitPercent}_${result.stopLossPercent}_${result.movingAverages}_${result.baseAsset}_${result.quoteAsset}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          parameters: {
            zScoreThreshold: parseFloat(result.zScoreThreshold.toString()),
            profitPercent: parseFloat(result.profitPercent.toString()),
            stopLossPercent: parseFloat(result.stopLossPercent.toString()),
            movingAverages: result.movingAverages,
            baseAsset: result.baseAsset,
            quoteAsset: result.quoteAsset
          },
          results: []
        });
      }
      
      groups.get(key).results.push({
        calmarRatio: parseFloat(result.calmarRatio.toString()),
        annualizedReturn: parseFloat(result.annualizedReturn.toString()),
        maxDrawdown: parseFloat(result.maxDrawdown.toString()),
        sharpeRatio: parseFloat(result.sharpeRatio.toString()),
        winRatio: parseFloat(result.winRatio.toString()),
        totalTrades: result.totalTrades,
        baseAsset: result.baseAsset,
        quoteAsset: result.quoteAsset,
        startTime: result.startTime,
        endTime: result.endTime
      });
    }
    
    // Calculate statistics for each group
    const groupStats = [];
    for (const [key, group] of groups.entries()) {
      if (group.results.length < 3) continue; // Need at least 3 results
      
      const calmarRatios = group.results.map((r: any) => r.calmarRatio);
      const returns = group.results.map((r: any) => r.annualizedReturn);
      const drawdowns = group.results.map((r: any) => r.maxDrawdown);
      
      const stats = {
        parameters: group.parameters,
        count: group.results.length,
        avgCalmarRatio: this.average(calmarRatios),
        medianCalmarRatio: this.median(calmarRatios),
        calmarStdDev: this.standardDeviation(calmarRatios),
        avgReturn: this.average(returns),
        avgDrawdown: this.average(drawdowns),
        consistency: (returns.filter((r: number) => r > 0).length / returns.length) * 100,
        bestCalmar: Math.max(...calmarRatios),
        worstCalmar: Math.min(...calmarRatios),
        totalTrades: group.results.reduce((sum: number, r: any) => sum + r.totalTrades, 0),
        sharpeRatio: this.average(group.results.map((r: any) => r.sharpeRatio)),
        winRatio: this.average(group.results.map((r: any) => r.winRatio))
      };
      
      groupStats.push(stats);
    }
    
    return groupStats;
  }

  private getTopPerformers(groups: any[], sortBy: 'calmar' | 'consistency') {
    const sorted = [...groups].sort((a, b) => {
      if (sortBy === 'calmar') {
        return b.avgCalmarRatio - a.avgCalmarRatio;
      } else {
        return b.consistency - a.consistency;
      }
    });
    
    return sorted.slice(0, 10);
  }

  private getBestRiskAdjusted(groups: any[]) {
    // Risk-adjusted score: Calmar ratio weighted by consistency and reduced by drawdown
    const riskAdjusted = groups.map(group => ({
      ...group,
      riskAdjustedScore: (group.avgCalmarRatio * (group.consistency / 100) * 
                         Math.max(0, 1 - group.avgDrawdown / 50))
    }));
    
    return riskAdjusted
      .sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore)
      .slice(0, 10);
  }

  private getCalmarDistribution(results: any[]) {
    const ranges = [
      { min: -Infinity, max: 0, label: 'Negative' },
      { min: 0, max: 1, label: '0-1' },
      { min: 1, max: 2, label: '1-2' },
      { min: 2, max: 3, label: '2-3' },
      { min: 3, max: 5, label: '3-5' },
      { min: 5, max: 10, label: '5-10' },
      { min: 10, max: Infinity, label: '10+' }
    ];
    
    return ranges.map(range => ({
      range: range.label,
      count: results.filter((r: any) => {
        const calmar = parseFloat(r.calmarRatio.toString());
        return calmar > range.min && calmar <= range.max;
      }).length
    }));
  }

  private analyzeParameterEffectiveness(groups: any[]) {
    // Find optimal parameter ranges based on top performers
    const topGroups = groups
      .filter(g => g.avgCalmarRatio > 2) // Good performers only
      .sort((a, b) => b.avgCalmarRatio - a.avgCalmarRatio)
      .slice(0, 20); // Top 20
    
    const zScores = topGroups.map(g => g.parameters.zScoreThreshold);
    const profitPercents = topGroups.map(g => g.parameters.profitPercent);
    const stopLosses = topGroups.map(g => g.parameters.stopLossPercent);
    
    return {
      zScoreOptimal: [...new Set(zScores)].sort((a, b) => a - b),
      profitPercentOptimal: [...new Set(profitPercents)].sort((a, b) => a - b),
      stopLossOptimal: [...new Set(stopLosses)].sort((a, b) => a - b)
    };
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(analysis: CalmarAnalysis): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Calmar Ratio Analysis Report</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container { 
            background: white; 
            border-radius: 15px; 
            padding: 30px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            margin: 20px auto;
            max-width: 1400px;
        }
        .header { text-align: center; margin-bottom: 30px; color: #2c3e50; }
        .section { margin-bottom: 40px; }
        .metric-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
            gap: 20px; 
            margin-bottom: 30px;
        }
        .metric-card { 
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            border-radius: 10px; 
            padding: 20px; 
            text-align: center;
        }
        .metric-value { font-size: 1.8em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #7f8c8d; margin-top: 8px; }
        .top-performers { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px;
        }
        .performer-card { 
            background: linear-gradient(135deg, #a8e6cf 0%, #dcedc1 100%);
            border-radius: 10px; 
            padding: 20px;
        }
        .grade-a { border-left: 5px solid #27ae60; }
        .grade-b { border-left: 5px solid #f39c12; }
        .grade-c { border-left: 5px solid #e74c3c; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .highlight { background: #fff3cd; }
        .chart-container { margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Calmar Ratio Analysis Report</h1>
            <p>Comprehensive analysis of parameter performance using risk-adjusted returns</p>
            <small>Generated on ${new Date().toLocaleDateString()}</small>
        </div>

        <div class="section">
            <h2>🏆 Best Individual Results (Unique Parameter Combinations)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Parameters</th>
                        <th>Trading Pair</th>
                        <th>Calmar Ratio</th>
                        <th>Return %</th>
                        <th>Drawdown %</th>
                        <th>Sharpe Ratio</th>
                        <th>Trades</th>
                        <th>Period</th>
                    </tr>
                </thead>
                <tbody>
                    ${analysis.topIndividualResults.slice(0, 10).map((result, index) => {
                        const calmar = parseFloat(result.calmarRatio.toString());
                        const gradeClass = calmar > 3 ? 'highlight' : '';
                        return `
                        <tr class="${gradeClass}">
                            <td>#${index + 1}</td>
                            <td>${result.zScoreThreshold}/${result.profitPercent}%/${result.stopLossPercent}%</td>
                            <td>${result.baseAsset}${result.quoteAsset}</td>
                            <td>${calmar.toFixed(2)}</td>
                            <td>${parseFloat(result.annualizedReturn.toString()).toFixed(1)}%</td>
                            <td>${parseFloat(result.maxDrawdown.toString()).toFixed(1)}%</td>
                            <td>${parseFloat(result.sharpeRatio.toString()).toFixed(2)}</td>
                            <td>${result.totalTrades.toLocaleString()}</td>
                            <td>${result.startTime.toISOString().split('T')[0].substr(2, 5)}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>📊 Top 5 Parameter Sets by Average Calmar Ratio</h2>
            <div class="top-performers">
                ${analysis.topParametersByCalmar.slice(0, 5).map((perf, index) => `
                    <div class="performer-card grade-${perf.avgCalmarRatio > 3 ? 'a' : perf.avgCalmarRatio > 2 ? 'b' : 'c'}">
                        <h3>#${index + 1}: ${perf.parameters.zScoreThreshold}/${perf.parameters.profitPercent}%/${perf.parameters.stopLossPercent}%</h3>
                        <div><strong>Pair:</strong> ${perf.parameters.baseAsset}${perf.parameters.quoteAsset}</div>
                        <div><strong>Avg Calmar:</strong> ${perf.avgCalmarRatio.toFixed(3)}</div>
                        <div><strong>Return:</strong> ${perf.avgReturn.toFixed(1)}%</div>
                        <div><strong>Drawdown:</strong> ${perf.avgDrawdown.toFixed(1)}%</div>
                        <div><strong>Consistency:</strong> ${perf.consistency.toFixed(1)}%</div>
                        <div><strong>Sample Size:</strong> ${perf.count} backtests</div>
                        <div><strong>Total Trades:</strong> ${perf.totalTrades.toLocaleString()}</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="section">
            <h2>🎯 Most Consistent Performers</h2>
            <table>
                <thead>
                    <tr>
                        <th>Parameters</th>
                        <th>Consistency %</th>
                        <th>Avg Calmar</th>
                        <th>Avg Return %</th>
                        <th>Sample Size</th>
                    </tr>
                </thead>
                <tbody>
                    ${analysis.topParametersByConsistency.slice(0, 10).map(perf => `
                        <tr class="${perf.consistency > 80 ? 'highlight' : ''}">
                            <td>${perf.parameters.zScoreThreshold}/${perf.parameters.profitPercent}%/${perf.parameters.stopLossPercent}% (${perf.parameters.baseAsset}${perf.parameters.quoteAsset})</td>
                            <td>${perf.consistency.toFixed(1)}%</td>
                            <td>${perf.avgCalmarRatio.toFixed(3)}</td>
                            <td>${perf.avgReturn.toFixed(1)}%</td>
                            <td>${perf.count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>⚖️ Best Risk-Adjusted Performers</h2>
            <div class="metric-grid">
                ${analysis.bestRiskAdjusted.slice(0, 6).map((perf, index) => `
                    <div class="metric-card">
                        <div class="metric-value">#${index + 1}</div>
                        <div class="metric-label">${perf.parameters.zScoreThreshold}/${perf.parameters.profitPercent}%/${perf.parameters.stopLossPercent}%</div>
                        <div class="metric-label" style="font-size: 0.9em; color: #95a5a6;">${perf.parameters.baseAsset}${perf.parameters.quoteAsset}</div>
                        <div style="margin-top: 10px;">
                            <div>Risk Score: ${perf.riskAdjustedScore.toFixed(3)}</div>
                            <div>Calmar: ${perf.avgCalmarRatio.toFixed(2)}</div>
                            <div>Consistency: ${perf.consistency.toFixed(0)}%</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="chart-container">
            <div id="calmarDistribution" style="width: 100%; height: 400px;"></div>
        </div>

        <div class="section">
            <h2>🎯 Parameter Optimization Insights</h2>
            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-value">[${analysis.parameterEffectiveness.zScoreOptimal.join(', ')}]</div>
                    <div class="metric-label">Optimal Z-Score Thresholds</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">[${analysis.parameterEffectiveness.profitPercentOptimal.join('%, ')}%]</div>
                    <div class="metric-label">Optimal Profit Percentages</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">[${analysis.parameterEffectiveness.stopLossOptimal.join('%, ')}%]</div>
                    <div class="metric-label">Optimal Stop Loss Percentages</div>
                </div>
            </div>
        </div>

        <script>
            // Calmar ratio distribution chart
            const distributionTrace = {
                x: [${analysis.calmarDistribution.map(d => `'${d.range}'`).join(', ')}],
                y: [${analysis.calmarDistribution.map(d => d.count).join(', ')}],
                type: 'bar',
                marker: {
                    color: ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#27ae60', '#3498db', '#9b59b6'],
                    opacity: 0.8
                },
                text: [${analysis.calmarDistribution.map(d => d.count).join(', ')}],
                textposition: 'auto'
            };

            Plotly.newPlot('calmarDistribution', [distributionTrace], {
                title: 'Calmar Ratio Distribution Across All Results',
                xaxis: { title: 'Calmar Ratio Range' },
                yaxis: { title: 'Number of Results' },
                showlegend: false
            });
        </script>

        <div class="section">
            <h2>💡 Key Insights & Recommendations</h2>
            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px;">
                <h3>🎯 Best Individual Strategy</h3>
                <p><strong>${analysis.topIndividualResults[0].zScoreThreshold}/${analysis.topIndividualResults[0].profitPercent}%/${analysis.topIndividualResults[0].stopLossPercent}%</strong> 
                on <strong>${analysis.topIndividualResults[0].baseAsset}${analysis.topIndividualResults[0].quoteAsset}</strong> 
                with Calmar ratio of <strong>${parseFloat(analysis.topIndividualResults[0].calmarRatio.toString()).toFixed(3)}</strong></p>
                
                <h3>🔍 Parameter Patterns</h3>
                <ul>
                    <li><strong>Z-Score Sweet Spot:</strong> ${Math.min(...analysis.parameterEffectiveness.zScoreOptimal)} - ${Math.max(...analysis.parameterEffectiveness.zScoreOptimal)}</li>
                    <li><strong>Profit Target Range:</strong> ${Math.min(...analysis.parameterEffectiveness.profitPercentOptimal)}% - ${Math.max(...analysis.parameterEffectiveness.profitPercentOptimal)}%</li>
                    <li><strong>Stop Loss Range:</strong> ${Math.min(...analysis.parameterEffectiveness.stopLossOptimal)}% - ${Math.max(...analysis.parameterEffectiveness.stopLossOptimal)}%</li>
                </ul>
                
                <h3>⚠️ Risk Considerations</h3>
                <p>Most top performers have "High" or "Very High" risk levels. Consider position sizing and portfolio allocation carefully.</p>
                
                <h3>🚀 Next Steps</h3>
                <ul>
                    <li>Focus optimization around the top parameter ranges</li>
                    <li>Use Calmar ratio > 2.5 as minimum threshold for live trading</li>
                    <li>Implement risk management based on drawdown levels</li>
                    <li>Monitor consistency alongside performance</li>
                </ul>
            </div>
        </div>
    </div>
</body>
</html>`;
  }

  // Utility methods
  private average(numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  private median(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? 
      (sorted[mid - 1] + sorted[mid]) / 2 : 
      sorted[mid];
  }

  private standardDeviation(numbers: number[]): number {
    const avg = this.average(numbers);
    const squareDiffs = numbers.map(n => Math.pow(n - avg, 2));
    const avgSquareDiff = this.average(squareDiffs);
    return Math.sqrt(avgSquareDiff);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const reporter = new CalmarRatioReporter();
  
  try {
    await reporter.initialize();
    
    console.log('📊 Generating comprehensive Calmar ratio report...');
    const analysis = await reporter.generateComprehensiveAnalysis();
    
    // Generate HTML report
    const html = reporter.generateHTMLReport(analysis);
    
    // Save to file
    const filename = `calmar-ratio-analysis-${Date.now()}.html`;
    const filepath = path.join(process.cwd(), 'analysis', filename);
    
    // Ensure directory exists
    if (!fs.existsSync(path.dirname(filepath))) {
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
    }
    
    fs.writeFileSync(filepath, html);
    
    console.log('\n✅ Comprehensive Calmar ratio report generated!');
    console.log(`📁 Location: ${filepath}`);
    console.log(`🌐 Open in browser: file://${filepath}`);
    
    // Display quick insights
    console.log('\n🎯 QUICK INSIGHTS:');
    console.log(`   Best Parameter Set: ${analysis.topParametersByCalmar[0].parameters.zScoreThreshold}/${analysis.topParametersByCalmar[0].parameters.profitPercent}%/${analysis.topParametersByCalmar[0].parameters.stopLossPercent}%`);
    console.log(`   Best Calmar Ratio: ${analysis.topParametersByCalmar[0].avgCalmarRatio.toFixed(3)}`);
    console.log(`   Most Consistent: ${analysis.topParametersByConsistency[0].consistency.toFixed(1)}% positive results`);
    console.log(`   Optimal Z-Score Range: ${Math.min(...analysis.parameterEffectiveness.zScoreOptimal)} - ${Math.max(...analysis.parameterEffectiveness.zScoreOptimal)}`);
    
  } catch (error) {
    console.error('❌ Report generation failed:', error);
  } finally {
    await reporter.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { CalmarRatioReporter };