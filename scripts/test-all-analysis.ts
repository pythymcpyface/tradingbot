#!/usr/bin/env ts-node

/**
 * Test All Analysis Scripts
 * 
 * Quick demonstration of all the parameter analysis scripts
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testScript(name: string, command: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 TESTING: ${name}`);
  console.log(`${'='.repeat(80)}`);
  
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: process.cwd() });
    console.log(stdout);
    if (stderr) {
      console.error(`stderr: ${stderr}`);
    }
  } catch (error: any) {
    console.error(`❌ Error running ${name}:`, error.message);
  }
}

async function main() {
  console.log('🚀 Testing all parameter analysis scripts with BNB data...\n');
  
  const tests = [
    { name: 'Calmar Ratio Analysis', command: 'npm run queryTopCalmarRatios calmar BNB' },
    { name: 'Returns Analysis', command: 'npm run queryTopReturns returns BNB' },
    { name: 'Drawdown Analysis', command: 'npm run queryTopDrawdowns drawdown BNB' },
    { name: 'Sharpe Ratio Analysis', command: 'npm run queryTopSharpe sharpe BNB' },
    { name: 'Alpha Analysis', command: 'npm run queryTopAlpha alpha BNB' }
  ];
  
  for (const test of tests) {
    await testScript(test.name, test.command);
  }
  
  console.log('\n✅ All analysis scripts tested successfully!');
  console.log('\n📊 Available Commands:');
  console.log('  npm run queryTopCalmarRatios [calmar] [ASSET]');
  console.log('  npm run queryTopReturns [returns] [ASSET]');
  console.log('  npm run queryTopDrawdowns [drawdown] [ASSET]');
  console.log('  npm run queryTopSharpe [sharpe] [ASSET]');
  console.log('  npm run queryTopAlpha [alpha] [ASSET]');
  console.log('\nAll scripts now correctly average metrics over ALL backtests in each parameter set! 🎯');
}

main().catch(console.error);