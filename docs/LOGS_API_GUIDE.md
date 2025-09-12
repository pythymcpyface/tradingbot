# Server Logs Integration Guide

## Overview

The trading bot now includes comprehensive server logs integration that allows real-time monitoring of all system activities through the web UI. This feature provides detailed logging, filtering, and real-time streaming capabilities.

## Architecture

### Logger Service (`src/services/Logger.ts`)
- **Multi-level logging**: DEBUG, INFO, WARN, ERROR
- **JSON structured format** with timestamps, categories, and metadata
- **Multiple file output**: daily files by category and level
- **Automatic cleanup** of old log files
- **Console output** with color coding for development

### Log Categories
The system uses the following log categories:

- **SIGNALS**: Trading signal calculations and Glicko ratings
- **RATINGS**: Glicko rating calculations and updates
- **Z_SCORE**: Z-score calculations and trading decisions
- **MONITORING**: System monitoring and health checks
- **SYSTEM**: System-level events and initialization
- **ENGINE**: Trading engine operations and state changes
- **PAPER_TRADE**: Paper trading activities and results
- **POSITIONS**: Position management and updates
- **ALLOCATION**: Portfolio allocation decisions

### Log File Structure
```
logs/
├── YYYY-MM-DD_all.log          # All logs for the day
├── YYYY-MM-DD_signals.log      # Signal-specific logs
├── YYYY-MM-DD_system.log       # System logs
├── YYYY-MM-DD_errors.log       # Error logs only
└── ...                         # Other category-specific files
```

## API Endpoints

### GET /api/logs/recent
Get recent log entries with optional filtering.

**Parameters:**
- `category` (optional): Filter by log category
- `level` (optional): Filter by log level (DEBUG, INFO, WARN, ERROR)
- `limit` (optional): Maximum number of entries (default: 500)
- `hours` (optional): Time range in hours (default: 24)
- `search` (optional): Text search in messages and data

**Example:**
```bash
GET /api/logs/recent?category=SIGNALS&level=ERROR&hours=4
```

### GET /api/logs/category/:category
Get logs for a specific category.

**Example:**
```bash
GET /api/logs/category/SIGNALS?hours=1&limit=100
```

### GET /api/logs/level/:level
Get logs for a specific level.

**Example:**
```bash
GET /api/logs/level/ERROR?hours=24
```

### GET /api/logs/stats
Get log statistics and summaries.

**Response includes:**
- Total log count
- Counts by category and level
- Recent error summaries
- Time range information

### GET /api/logs/stream
Real-time log streaming using Server-Sent Events.

**Usage:**
```javascript
const eventSource = new EventSource('/api/logs/stream?category=SIGNALS');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('New logs:', data.logs);
};
```

### GET /api/logs/categories
Get available log categories and levels.

## Web UI Integration

### LogViewer Component
A comprehensive React component (`src/web-ui/src/components/LogViewer.tsx`) that provides:

- **Real-time log streaming** with Server-Sent Events
- **Advanced filtering** by category, level, time range, and text search
- **Export functionality** to download logs as JSON
- **Auto-scroll** and pagination
- **Collapsible interface** to save screen space
- **Color-coded log levels** for easy scanning
- **Structured data display** with JSON prettification

### TradingPage Integration
The LogViewer is integrated into the TradingPage as an expandable section that shows:

- Live trading system logs
- Real-time error monitoring
- Trading decision logs
- System health information

## Usage Examples

### Basic Usage
```typescript
import { api } from '../utils/apiClient';

// Get recent logs
const response = await api.logs.getRecent({
  category: 'SIGNALS',
  hours: '1',
  limit: '100'
});

// Get error logs only
const errors = await api.logs.getByLevel('ERROR', {
  hours: '24'
});

// Get log statistics
const stats = await api.logs.getStats({ hours: '4' });
```

### Real-time Streaming
```typescript
const streamUrl = api.logs.getStreamUrl({
  category: 'ENGINE',
  level: 'ERROR'
});

const eventSource = new EventSource(streamUrl);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle new log entries
  data.logs.forEach(log => {
    console.log(`[${log.level}] ${log.category}: ${log.message}`);
  });
};
```

### Log Entry Structure
```json
{
  "timestamp": "2025-09-12T00:02:42.099Z",
  "level": "INFO",
  "category": "Z_SCORE",
  "message": "Z-score calculated for BTCUSDT",
  "data": {
    "currentZScore": 1.8593162625347,
    "movingAverageZScore": -0.1703965885387267,
    "threshold": 5,
    "rating": 1519.1905685033303,
    "canTrade": true
  }
}
```

## Performance Considerations

### File Reading Optimization
- **Limited file scanning**: Maximum 10 most recent log files
- **Efficient parsing**: Streaming JSON line parsing
- **Memory management**: Configurable log limits and cleanup
- **Caching**: Categories and levels are cached during reads

### Real-time Streaming
- **Server-Sent Events**: Efficient real-time updates
- **Automatic reconnection**: Handles connection failures gracefully
- **Filtered streaming**: Only sends relevant log entries
- **Rate limiting**: Updates every 5 seconds to prevent flooding

### Log File Management
- **Automatic rotation**: New files created daily
- **Cleanup scheduling**: Old logs removed after 30 days (configurable)
- **Efficient storage**: JSON format with compression potential
- **Multiple file strategy**: Separate files by category for faster access

## Troubleshooting

### Common Issues

1. **No logs appearing**
   - Check if the trading system is running and generating logs
   - Verify the logs directory exists and is writable
   - Check API endpoint accessibility

2. **Real-time streaming not working**
   - Verify Server-Sent Events are supported by the client
   - Check network connectivity and CORS settings
   - Look for JavaScript console errors

3. **Performance issues**
   - Reduce the time range for log queries
   - Lower the limit parameter
   - Use category filtering to reduce data volume

### Debug Steps
```bash
# Test log API endpoints
curl "http://localhost:3000/api/logs/recent?limit=10"

# Check log file structure
ls -la logs/

# Run test script
npm run test-logs
```

## Configuration

### Environment Variables
```env
LOG_LEVEL=INFO              # Minimum log level to record
LOG_RETENTION_DAYS=30       # Days to keep log files
LOG_DIRECTORY=./logs        # Log files directory
```

### Logger Configuration
```typescript
const logger = new Logger('./logs', LogLevel.INFO);
await logger.initialize();

// Log with metadata
await logger.info('TRADING', 'Order executed', {
  symbol: 'BTCUSDT',
  side: 'BUY',
  quantity: 0.001,
  price: 50000
});
```

## Best Practices

### Logging Guidelines
1. **Use appropriate levels**: ERROR for failures, WARN for issues, INFO for normal operations
2. **Include context**: Add relevant metadata in the data field
3. **Use consistent categories**: Stick to the established category naming
4. **Avoid sensitive data**: Don't log API keys, passwords, or personal information
5. **Structure data properly**: Use objects for complex metadata

### UI Usage
1. **Filter effectively**: Use category and level filters to find specific information
2. **Monitor errors**: Keep an eye on the error badge in the log viewer
3. **Export for analysis**: Use the export feature for detailed log analysis
4. **Real-time monitoring**: Enable real-time mode during active trading

### Performance Tips
1. **Limit time ranges**: Use shorter time ranges for faster loading
2. **Filter by category**: Reduce data volume by filtering to specific categories
3. **Use search sparingly**: Text search can be slow on large log sets
4. **Monitor memory**: Be aware of browser memory usage with large log sets

This comprehensive logging system provides powerful monitoring and debugging capabilities for the trading bot, enabling better operational visibility and faster issue resolution.