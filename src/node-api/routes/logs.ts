import { Router } from 'express';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { LogEntry, LogLevel } from '../../services/Logger';

const router = Router();

interface LogFilter {
  category?: string;
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  search?: string;
}

interface LogResponse {
  logs: LogEntry[];
  totalCount: number;
  categories: string[];
  levels: string[];
  dateRange: {
    earliest?: Date;
    latest?: Date;
  };
}

/**
 * Parse a single JSON log line safely
 */
function parseLogLine(line: string): LogEntry | null {
  try {
    if (!line.trim()) return null;
    const parsed = JSON.parse(line);
    return {
      timestamp: new Date(parsed.timestamp),
      level: LogLevel[parsed.level as keyof typeof LogLevel] ?? LogLevel.INFO,
      category: parsed.category || 'UNKNOWN',
      message: parsed.message || '',
      data: parsed.data
    };
  } catch (error) {
    console.warn('Failed to parse log line:', line.substring(0, 100) + '...');
    return null;
  }
}

/**
 * Read and parse log files based on filters
 */
async function readLogFiles(logDir: string, filters: LogFilter): Promise<LogResponse> {
  const logs: LogEntry[] = [];
  const categories = new Set<string>();
  const levels = new Set<string>();
  let earliest: Date | undefined;
  let latest: Date | undefined;

  try {
    // Get list of log files to read
    const files = await fs.readdir(logDir);
    const logFiles = files
      .filter(file => file.endsWith('.log'))
      .sort()
      .reverse(); // Most recent first

    // Determine which files to read based on date filters
    let filesToRead = logFiles;
    if (filters.startTime || filters.endTime) {
      filesToRead = logFiles.filter(file => {
        const datePart = file.split('_')[0];
        const fileDate = new Date(datePart);
        
        if (filters.startTime && fileDate < filters.startTime) return false;
        if (filters.endTime && fileDate > filters.endTime) return false;
        
        return true;
      });
    }

    // Limit number of files to prevent memory issues
    const maxFiles = 10;
    filesToRead = filesToRead.slice(0, maxFiles);

    // Read and parse log files
    for (const file of filesToRead) {
      const filePath = path.join(logDir, file);
      
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          const logEntry = parseLogLine(line);
          if (!logEntry) continue;

          // Apply filters
          if (filters.category && logEntry.category !== filters.category.toUpperCase()) continue;
          if (filters.level !== undefined && logEntry.level !== filters.level) continue;
          if (filters.startTime && logEntry.timestamp < filters.startTime) continue;
          if (filters.endTime && logEntry.timestamp > filters.endTime) continue;
          if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const matchesMessage = logEntry.message.toLowerCase().includes(searchLower);
            const matchesCategory = logEntry.category.toLowerCase().includes(searchLower);
            const matchesData = logEntry.data && JSON.stringify(logEntry.data).toLowerCase().includes(searchLower);
            
            if (!matchesMessage && !matchesCategory && !matchesData) continue;
          }

          logs.push(logEntry);
          categories.add(logEntry.category);
          levels.add(LogLevel[logEntry.level]);

          // Update date range
          if (!earliest || logEntry.timestamp < earliest) earliest = logEntry.timestamp;
          if (!latest || logEntry.timestamp > latest) latest = logEntry.timestamp;
        }
      } catch (fileError) {
        console.warn(`Failed to read log file ${file}:`, fileError);
      }
    }

    // Sort by timestamp (most recent first)
    logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    const limit = filters.limit || 1000;
    const limitedLogs = logs.slice(0, limit);

    return {
      logs: limitedLogs,
      totalCount: logs.length,
      categories: Array.from(categories).sort(),
      levels: Array.from(levels).sort(),
      dateRange: { earliest, latest }
    };

  } catch (error) {
    console.error('Error reading log files:', error);
    return {
      logs: [],
      totalCount: 0,
      categories: [],
      levels: [],
      dateRange: {}
    };
  }
}

/**
 * GET /api/logs/recent - Get recent log entries
 */
router.get('/recent', async (req, res) => {
  try {
    const {
      category,
      level,
      limit = '500',
      hours = '24',
      search
    } = req.query;

    const logDir = path.join(__dirname, '../../../logs');
    const hoursBack = parseInt(hours as string);
    
    const filters: LogFilter = {
      category: category as string,
      level: level ? LogLevel[level as keyof typeof LogLevel] : undefined,
      limit: parseInt(limit as string),
      startTime: new Date(Date.now() - (hoursBack * 60 * 60 * 1000)),
      search: search as string
    };

    const result = await readLogFiles(logDir, filters);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching recent logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/categories - Get available log categories
 */
router.get('/categories', async (req, res) => {
  try {
    const logDir = path.join(__dirname, '../../../logs');
    const result = await readLogFiles(logDir, { limit: 1000 });

    res.json({
      success: true,
      data: {
        categories: result.categories,
        levels: result.levels
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching log categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch log categories',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/category/:category - Get logs by category
 */
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const {
      level,
      limit = '500',
      hours = '24',
      search
    } = req.query;

    const logDir = path.join(__dirname, '../../../logs');
    const hoursBack = parseInt(hours as string);
    
    const filters: LogFilter = {
      category: category.toUpperCase(),
      level: level ? LogLevel[level as keyof typeof LogLevel] : undefined,
      limit: parseInt(limit as string),
      startTime: new Date(Date.now() - (hoursBack * 60 * 60 * 1000)),
      search: search as string
    };

    const result = await readLogFiles(logDir, filters);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error fetching logs for category ${req.params.category}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/level/:level - Get logs by level
 */
router.get('/level/:level', async (req, res) => {
  try {
    const { level } = req.params;
    const {
      category,
      limit = '500',
      hours = '24',
      search
    } = req.query;

    const logDir = path.join(__dirname, '../../../logs');
    const hoursBack = parseInt(hours as string);
    
    const filters: LogFilter = {
      category: category as string,
      level: LogLevel[level.toUpperCase() as keyof typeof LogLevel],
      limit: parseInt(limit as string),
      startTime: new Date(Date.now() - (hoursBack * 60 * 60 * 1000)),
      search: search as string
    };

    if (filters.level === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Invalid log level',
        validLevels: Object.keys(LogLevel).filter(key => isNaN(Number(key)))
      });
    }

    const result = await readLogFiles(logDir, filters);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error fetching logs for level ${req.params.level}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch level logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/logs/stream - Real-time log streaming (Server-Sent Events)
 */
router.get('/stream', (req, res) => {
  const {
    category,
    level,
    search
  } = req.query;

  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const logDir = path.join(__dirname, '../../../logs');
  let lastReadTime = new Date();
  
  const sendLogUpdate = async () => {
    try {
      const filters: LogFilter = {
        category: category as string,
        level: level ? LogLevel[level as keyof typeof LogLevel] : undefined,
        startTime: lastReadTime,
        limit: 50,
        search: search as string
      };

      const result = await readLogFiles(logDir, filters);
      
      if (result.logs.length > 0) {
        const data = JSON.stringify({
          logs: result.logs,
          timestamp: new Date().toISOString()
        });
        
        res.write(`data: ${data}\n\n`);
        
        // Update last read time to the latest log entry
        if (result.dateRange.latest) {
          lastReadTime = new Date(result.dateRange.latest.getTime() + 1);
        }
      }
    } catch (error) {
      console.error('Error streaming logs:', error);
      const errorData = JSON.stringify({
        error: 'Failed to stream logs',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      res.write(`data: ${errorData}\n\n`);
    }
  };

  // Send initial logs
  sendLogUpdate();

  // Send new logs every 5 seconds
  const interval = setInterval(sendLogUpdate, 5000);

  // Cleanup when client disconnects
  req.on('close', () => {
    clearInterval(interval);
  });

  req.on('end', () => {
    clearInterval(interval);
  });
});

/**
 * GET /api/logs/stats - Get log statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { hours = '24' } = req.query;
    const logDir = path.join(__dirname, '../../../logs');
    const hoursBack = parseInt(hours as string);
    
    const filters: LogFilter = {
      startTime: new Date(Date.now() - (hoursBack * 60 * 60 * 1000)),
      limit: 10000 // Higher limit for stats
    };

    const result = await readLogFiles(logDir, filters);
    
    // Calculate statistics
    const stats = {
      totalLogs: result.totalCount,
      byCategory: {} as Record<string, number>,
      byLevel: {} as Record<string, number>,
      recentErrors: result.logs
        .filter(log => log.level >= LogLevel.ERROR)
        .slice(0, 10)
        .map(log => ({
          timestamp: log.timestamp,
          category: log.category,
          message: log.message,
          data: log.data
        }))
    };

    // Count by category and level
    result.logs.forEach(log => {
      stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
      stats.byLevel[LogLevel[log.level]] = (stats.byLevel[LogLevel[log.level]] || 0) + 1;
    });

    res.json({
      success: true,
      data: stats,
      dateRange: result.dateRange,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching log stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch log statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as logsRouter };