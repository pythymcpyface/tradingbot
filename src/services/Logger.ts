import * as fs from 'fs/promises';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
}

export class Logger {
  private logDir: string;
  private logLevel: LogLevel;
  private currentDate: string;
  private logStreams: Map<string, string[]> = new Map();

  constructor(logDir: string = './logs', logLevel: LogLevel = LogLevel.INFO) {
    this.logDir = logDir;
    this.logLevel = logLevel;
    this.currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Initialize the logger by creating log directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await this.log(LogLevel.INFO, 'SYSTEM', 'Logger initialized', { logDir: this.logDir });
    } catch (error) {
      console.error('Failed to initialize logger:', error);
      throw error;
    }
  }

  /**
   * Log a message with specified level and category
   */
  async log(level: LogLevel, category: string, message: string, data?: any): Promise<void> {
    if (level < this.logLevel) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category: category.toUpperCase(),
      message,
      data
    };

    // Log to console with colors
    this.logToConsole(entry);

    // Log to files
    await this.logToFiles(entry);
  }

  /**
   * Convenience methods for different log levels
   */
  async debug(category: string, message: string, data?: any): Promise<void> {
    await this.log(LogLevel.DEBUG, category, message, data);
  }

  async info(category: string, message: string, data?: any): Promise<void> {
    await this.log(LogLevel.INFO, category, message, data);
  }

  async warn(category: string, message: string, data?: any): Promise<void> {
    await this.log(LogLevel.WARN, category, message, data);
  }

  async error(category: string, message: string, data?: any): Promise<void> {
    await this.log(LogLevel.ERROR, category, message, data);
  }

  /**
   * Log trading signals specifically
   */
  async logSignal(signal: any, action: string): Promise<void> {
    await this.log(LogLevel.INFO, 'SIGNALS', `${action}: ${signal.symbol}`, {
      zScore: signal.zScore,
      signal: signal.signal,
      timestamp: signal.timestamp
    });
  }

  /**
   * Log paper trades specifically
   */
  async logPaperTrade(symbol: string, action: string, details: any): Promise<void> {
    await this.log(LogLevel.INFO, 'PAPER_TRADE', `${action} ${symbol}`, details);
  }

  /**
   * Log position management
   */
  async logPosition(action: string, symbol: string, details: any): Promise<void> {
    await this.log(LogLevel.INFO, 'POSITIONS', `${action} ${symbol}`, details);
  }

  /**
   * Log to console with colors
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toLocaleString();
    const level = LogLevel[entry.level];
    const category = entry.category.padEnd(12);
    
    let color = '\x1b[0m'; // Reset
    let icon = 'ℹ️';
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        color = '\x1b[36m'; // Cyan
        icon = '🔍';
        break;
      case LogLevel.INFO:
        color = '\x1b[32m'; // Green  
        icon = 'ℹ️';
        break;
      case LogLevel.WARN:
        color = '\x1b[33m'; // Yellow
        icon = '⚠️';
        break;
      case LogLevel.ERROR:
        color = '\x1b[31m'; // Red
        icon = '❌';
        break;
    }

    const logMessage = `${color}${icon} [${timestamp}] ${category} ${entry.message}\x1b[0m`;
    console.log(logMessage);
    
    if (entry.data) {
      console.log('   ', JSON.stringify(entry.data, null, 2).replace(/\n/g, '\n    '));
    }
  }

  /**
   * Log to files (multiple file strategy)
   */
  private async logToFiles(entry: LogEntry): Promise<void> {
    try {
      const dateStr = entry.timestamp.toISOString().split('T')[0];
      const timeStr = entry.timestamp.toISOString();
      
      // Create log line
      const logLine = {
        timestamp: timeStr,
        level: LogLevel[entry.level],
        category: entry.category,
        message: entry.message,
        data: entry.data
      };

      const logText = JSON.stringify(logLine) + '\n';

      // Log to multiple files
      const filesToWrite = [
        `${dateStr}_all.log`,                    // All logs
        `${dateStr}_${entry.category.toLowerCase()}.log`, // Category-specific
        ...(entry.level >= LogLevel.ERROR ? [`${dateStr}_errors.log`] : []) // Error-specific
      ];

      // Write to all relevant files
      const writePromises = filesToWrite.map(async (filename) => {
        const filepath = path.join(this.logDir, filename);
        try {
          await fs.appendFile(filepath, logText, 'utf8');
        } catch (error) {
          console.error(`Failed to write to log file ${filename}:`, error);
        }
      });

      await Promise.all(writePromises);

    } catch (error) {
      console.error('Error writing to log files:', error);
    }
  }

  /**
   * Get log file paths for current date
   */
  getLogFilePaths(): string[] {
    const dateStr = new Date().toISOString().split('T')[0];
    return [
      path.join(this.logDir, `${dateStr}_all.log`),
      path.join(this.logDir, `${dateStr}_signals.log`),
      path.join(this.logDir, `${dateStr}_paper_trade.log`),
      path.join(this.logDir, `${dateStr}_positions.log`),
      path.join(this.logDir, `${dateStr}_errors.log`)
    ];
  }

  /**
   * Clean up old log files (keep last N days)
   */
  async cleanupOldLogs(daysToKeep: number = 30): Promise<void> {
    try {
      const files = await fs.readdir(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      for (const file of files) {
        if (file.endsWith('.log')) {
          const datePart = file.split('_')[0];
          const fileDate = new Date(datePart);
          
          if (fileDate < cutoffDate) {
            await fs.unlink(path.join(this.logDir, file));
            console.log(`Cleaned up old log file: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up old logs:', error);
    }
  }

  /**
   * Create a summary of today's activity
   */
  async generateDailySummary(): Promise<void> {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const allLogsFile = path.join(this.logDir, `${dateStr}_all.log`);
      
      try {
        const content = await fs.readFile(allLogsFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        const summary = {
          date: dateStr,
          totalLogs: lines.length,
          byCategory: {} as Record<string, number>,
          byLevel: {} as Record<string, number>,
          errors: [] as any[]
        };

        lines.forEach(line => {
          try {
            const entry = JSON.parse(line);
            summary.byCategory[entry.category] = (summary.byCategory[entry.category] || 0) + 1;
            summary.byLevel[entry.level] = (summary.byLevel[entry.level] || 0) + 1;
            
            if (entry.level === 'ERROR') {
              summary.errors.push(entry);
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        });

        const summaryFile = path.join(this.logDir, `${dateStr}_summary.json`);
        await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2));
        
        await this.info('SYSTEM', 'Daily summary generated', { 
          file: summaryFile, 
          totalLogs: summary.totalLogs,
          categories: Object.keys(summary.byCategory).length
        });
        
      } catch (error) {
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
      }
      
    } catch (error) {
      console.error('Error generating daily summary:', error);
    }
  }
}