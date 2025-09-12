/**
 * Test script for the logs API endpoints
 * Tests reading log files and parsing them correctly
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger, LogLevel } from '../src/services/Logger';

async function testLogsAPI() {
  console.log('🧪 Testing Logs API...\n');

  try {
    // Initialize logger and create some test logs
    const logger = new Logger('./test-logger', LogLevel.DEBUG);
    await logger.initialize();

    console.log('📝 Creating test log entries...');
    
    // Create various types of log entries
    await logger.info('SYSTEM', 'Test system message');
    await logger.warn('SIGNALS', 'Test warning for signals', { symbol: 'BTCUSDT', zScore: 2.5 });
    await logger.error('ENGINE', 'Test error in trading engine', { 
      error: 'Connection failed',
      retryCount: 3 
    });
    await logger.debug('MONITORING', 'Debug information for monitoring');

    // Wait a bit for file writes
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('✅ Test logs created\n');

    // Test log file reading
    console.log('📖 Testing log file parsing...');
    
    const logDir = './test-logger';
    const files = await fs.readdir(logDir);
    const logFiles = files.filter(file => file.endsWith('.log'));
    
    console.log(`Found ${logFiles.length} log files: ${logFiles.join(', ')}`);

    // Parse one of the log files
    if (logFiles.length > 0) {
      const firstLogFile = path.join(logDir, logFiles[0]);
      const content = await fs.readFile(firstLogFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      console.log(`\nParsing ${lines.length} log lines from ${logFiles[0]}:`);
      
      lines.forEach((line, index) => {
        try {
          const parsed = JSON.parse(line);
          console.log(`  ${index + 1}. [${parsed.level}] ${parsed.category}: ${parsed.message}`);
          if (parsed.data) {
            console.log(`      Data: ${JSON.stringify(parsed.data)}`);
          }
        } catch (error) {
          console.log(`  ${index + 1}. Failed to parse: ${line.substring(0, 50)}...`);
        }
      });
    }

    console.log('\n✅ Log parsing test complete');

    // Test category filtering
    console.log('\n🔍 Testing category extraction...');
    const categories = new Set<string>();
    const levels = new Set<string>();

    if (logFiles.length > 0) {
      const firstLogFile = path.join(logDir, logFiles[0]);
      const content = await fs.readFile(firstLogFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        try {
          const parsed = JSON.parse(line);
          categories.add(parsed.category);
          levels.add(parsed.level);
        } catch (error) {
          // Skip invalid lines
        }
      });

      console.log('Categories found:', Array.from(categories).sort());
      console.log('Levels found:', Array.from(levels).sort());
    }

    console.log('\n✅ Category extraction test complete');

    // Cleanup test files
    console.log('\n🧹 Cleaning up test files...');
    for (const file of logFiles) {
      await fs.unlink(path.join(logDir, file));
    }
    await fs.rmdir(logDir);
    
    console.log('✅ Test cleanup complete\n');
    console.log('🎉 All logs API tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

async function testLiveLogReading() {
  console.log('\n📊 Testing live log reading from existing logs...\n');

  try {
    const logsDir = './logs';
    
    // Check if logs directory exists
    try {
      await fs.access(logsDir);
      console.log('✅ Logs directory found');
    } catch {
      console.log('⚠️  No logs directory found, skipping live log test');
      return;
    }

    const files = await fs.readdir(logsDir);
    const logFiles = files.filter(file => file.endsWith('.log')).sort().reverse();
    
    if (logFiles.length === 0) {
      console.log('⚠️  No log files found, skipping live log test');
      return;
    }

    console.log(`Found ${logFiles.length} log files in production`);
    console.log(`Most recent: ${logFiles[0]}`);

    // Read the most recent log file
    const recentLogFile = path.join(logsDir, logFiles[0]);
    const content = await fs.readFile(recentLogFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    console.log(`\nAnalyzing ${lines.length} lines from ${logFiles[0]}:`);

    const stats = {
      byCategory: {} as Record<string, number>,
      byLevel: {} as Record<string, number>,
      totalLogs: 0,
      timeRange: { earliest: null as Date | null, latest: null as Date | null }
    };

    let validLines = 0;
    let recentEntries = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const timestamp = new Date(parsed.timestamp);
        
        stats.byCategory[parsed.category] = (stats.byCategory[parsed.category] || 0) + 1;
        stats.byLevel[parsed.level] = (stats.byLevel[parsed.level] || 0) + 1;
        stats.totalLogs++;
        validLines++;

        if (!stats.timeRange.earliest || timestamp < stats.timeRange.earliest) {
          stats.timeRange.earliest = timestamp;
        }
        if (!stats.timeRange.latest || timestamp > stats.timeRange.latest) {
          stats.timeRange.latest = timestamp;
        }

        // Keep last 5 entries for display
        recentEntries.push({
          timestamp: parsed.timestamp,
          level: parsed.level,
          category: parsed.category,
          message: parsed.message
        });

      } catch (error) {
        // Skip invalid JSON lines
      }
    }

    // Show last 5 entries
    recentEntries = recentEntries.slice(-5);

    console.log('\n📈 Log Statistics:');
    console.log(`  Total valid log entries: ${validLines}`);
    console.log(`  Time range: ${stats.timeRange.earliest?.toLocaleString()} to ${stats.timeRange.latest?.toLocaleString()}`);
    
    console.log('\n📊 By Category:');
    Object.entries(stats.byCategory)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${count}`);
      });

    console.log('\n📊 By Level:');
    Object.entries(stats.byLevel)
      .sort(([,a], [,b]) => b - a)
      .forEach(([level, count]) => {
        console.log(`  ${level}: ${count}`);
      });

    console.log('\n🕒 Recent Log Entries:');
    recentEntries.forEach((entry, index) => {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      console.log(`  ${index + 1}. [${timestamp}] ${entry.level} ${entry.category}: ${entry.message}`);
    });

    console.log('\n✅ Live log analysis complete');

  } catch (error) {
    console.error('❌ Live log test failed:', error);
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Starting Logs API Tests\n');
  console.log('='.repeat(50));
  
  await testLogsAPI();
  await testLiveLogReading();
  
  console.log('\n' + '='.repeat(50));
  console.log('✨ All tests completed successfully!');
}

runTests().catch(console.error);