#!/usr/bin/env ts-node

// Manual calculation for 8/10%/15% parameter set
const results = [
  { return: -12.5, drawdown: 34.1, trades: 4 },
  { return: 22.1, drawdown: 27.8, trades: 5 },
  { return: 3.4, drawdown: 22.6, trades: 5 },
  { return: -7.6, drawdown: 22.6, trades: 5 },
  { return: 25.0, drawdown: 11.3, trades: 5 },
  { return: 43.7, drawdown: 11.3, trades: 6 },
  { return: 11.7, drawdown: 26.1, trades: 4 }
];

// Calculate Calmar ratios for each result
const calmarRatios = results.map(r => r.return / Math.abs(r.drawdown));

console.log('Individual Calmar Ratios:');
results.forEach((r, i) => {
  console.log(`  ${r.return}% / ${r.drawdown}% = ${calmarRatios[i].toFixed(3)}`);
});

const avgCalmar = calmarRatios.reduce((sum, val) => sum + val, 0) / calmarRatios.length;
const avgReturn = results.reduce((sum, r) => sum + r.return, 0) / results.length;
const avgDrawdown = results.reduce((sum, r) => sum + r.drawdown, 0) / results.length;
const totalTrades = results.reduce((sum, r) => sum + r.trades, 0);
const consistency = (results.filter(r => r.return > 0).length / results.length) * 100;

console.log('\nCalculated Averages:');
console.log(`  Avg Calmar Ratio: ${avgCalmar.toFixed(3)}`);
console.log(`  Avg Return: ${avgReturn.toFixed(1)}%`);
console.log(`  Avg Drawdown: ${avgDrawdown.toFixed(1)}%`);
console.log(`  Consistency: ${consistency.toFixed(1)}%`);
console.log(`  Total Trades: ${totalTrades}`);
console.log(`  Total Count: ${results.length}`);
console.log(`  Quality Count (>5 trades): ${results.filter(r => r.trades > 5).length}`);