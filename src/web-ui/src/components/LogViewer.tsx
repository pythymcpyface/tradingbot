import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert,
  CircularProgress,
  IconButton,
  Badge
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  Download as DownloadIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon
} from '@mui/icons-material';
import { api } from '../utils/apiClient';

interface LogEntry {
  timestamp: Date;
  level: number;
  category: string;
  message: string;
  data?: any;
}

interface LogStats {
  totalLogs: number;
  byCategory: Record<string, number>;
  byLevel: Record<string, number>;
  recentErrors: LogEntry[];
}

interface LogViewerProps {
  defaultCategory?: string;
  defaultLevel?: string;
  maxHeight?: string;
  autoRefresh?: boolean;
}

const LogViewer: React.FC<LogViewerProps> = ({
  defaultCategory,
  defaultLevel,
  maxHeight = '400px',
  autoRefresh = true
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realTimeEnabled, setRealTimeEnabled] = useState(autoRefresh);
  
  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>(defaultCategory || '');
  const [selectedLevel, setSelectedLevel] = useState<string>(defaultLevel || '');
  const [searchText, setSearchText] = useState<string>('');
  const [timeRange, setTimeRange] = useState<string>('1'); // hours
  const limit = '500'; // Fixed limit for now

  // UI state
  const [expanded, setExpanded] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  
  // Refs
  const logListRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial data
  const loadLogs = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      setError(null);

      const params = {
        category: selectedCategory || undefined,
        level: selectedLevel || undefined,
        search: searchText || undefined,
        hours: timeRange,
        limit
      };

      const response = await api.logs.getRecent(params);
      
      if (response.data.success) {
        const logData = response.data.data;
        // Convert timestamp strings to Date objects
        const parsedLogs = logData.logs.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
        
        setLogs(parsedLogs);
        setCategories(logData.categories);
        setLevels(logData.levels);

        // Auto-scroll to bottom if enabled
        if (autoScroll && logListRef.current) {
          setTimeout(() => {
            logListRef.current?.scrollTo({ top: logListRef.current.scrollHeight, behavior: 'smooth' });
          }, 100);
        }
      } else {
        setError('Failed to load logs');
      }
    } catch (err: any) {
      console.error('Error loading logs:', err);
      setError(err.message || 'Failed to load logs');
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [selectedCategory, selectedLevel, searchText, timeRange, limit, autoScroll]);

  // Load statistics
  const loadStats = useCallback(async () => {
    try {
      const response = await api.logs.getStats({ hours: timeRange });
      if (response.data.success) {
        const statsData = response.data.data;
        // Convert error timestamps
        statsData.recentErrors = statsData.recentErrors.map((error: any) => ({
          ...error,
          timestamp: new Date(error.timestamp)
        }));
        setStats(statsData);
      }
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }, [timeRange]);

  // Setup real-time log streaming
  const setupRealTimeStream = useCallback(() => {
    if (!realTimeEnabled) return;

    const params = {
      category: selectedCategory || undefined,
      level: selectedLevel || undefined,
      search: searchText || undefined
    };

    const streamUrl = api.logs.getStreamUrl(params);
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.logs && data.logs.length > 0) {
          const newLogs = data.logs.map((log: any) => ({
            ...log,
            timestamp: new Date(log.timestamp)
          }));

          setLogs(prevLogs => {
            const combined = [...newLogs, ...prevLogs];
            // Remove duplicates and limit total logs
            const uniqueLogs = combined.filter((log, index, arr) => 
              arr.findIndex(l => l.timestamp.getTime() === log.timestamp.getTime() && l.message === log.message) === index
            );
            return uniqueLogs.slice(0, parseInt(limit));
          });

          // Auto-scroll to bottom for new logs
          if (autoScroll && logListRef.current) {
            setTimeout(() => {
              logListRef.current?.scrollTo({ top: logListRef.current.scrollHeight, behavior: 'smooth' });
            }, 100);
          }
        }
      } catch (err) {
        console.error('Error parsing stream data:', err);
      }
    };

    eventSource.onerror = (event) => {
      console.error('EventSource failed:', event);
      eventSource.close();
      // Retry after 5 seconds
      setTimeout(setupRealTimeStream, 5000);
    };

    eventSourceRef.current = eventSource;
  }, [realTimeEnabled, selectedCategory, selectedLevel, searchText, limit, autoScroll]);

  // Cleanup streams and timeouts
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Load data when filters change
  useEffect(() => {
    loadLogs();
    loadStats();
  }, [loadLogs, loadStats]);

  // Setup real-time streaming
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    if (realTimeEnabled) {
      setupRealTimeStream();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [setupRealTimeStream, realTimeEnabled]);

  // Setup periodic refresh when real-time is disabled
  useEffect(() => {
    if (!realTimeEnabled && autoRefresh) {
      refreshTimeoutRef.current = setInterval(() => {
        loadLogs(false); // Don't show loader for background refresh
        loadStats();
      }, 30000); // Refresh every 30 seconds

      return () => {
        if (refreshTimeoutRef.current) {
          clearInterval(refreshTimeoutRef.current);
        }
      };
    }
  }, [realTimeEnabled, autoRefresh, loadLogs, loadStats]);

  // Format log level with color
  const formatLogLevel = (level: number) => {
    const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const levelName = levelNames[level] || 'UNKNOWN';
    const colors = {
      DEBUG: 'default' as const,
      INFO: 'info' as const,
      WARN: 'warning' as const,
      ERROR: 'error' as const,
      UNKNOWN: 'default' as const
    };
    return { name: levelName, color: colors[levelName as keyof typeof colors] };
  };

  // Format timestamp
  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  // Export logs to JSON
  const exportLogs = () => {
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trading-logs-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card sx={{ width: '100%', mb: 2 }}>
      <Accordion expanded={expanded} onChange={(_, isExpanded) => setExpanded(isExpanded)}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
            <Typography variant="h6">
              Server Logs
            </Typography>
            <Box display="flex" alignItems="center" gap={1} onClick={(e) => e.stopPropagation()}>
              {stats && (
                <>
                  <Badge badgeContent={stats.recentErrors.length} color="error">
                    <Chip 
                      label={`${stats.totalLogs} logs`} 
                      size="small" 
                      variant="outlined" 
                    />
                  </Badge>
                  <IconButton 
                    size="small" 
                    onClick={() => setRealTimeEnabled(!realTimeEnabled)}
                    color={realTimeEnabled ? 'success' : 'default'}
                  >
                    {realTimeEnabled ? <PauseIcon /> : <PlayIcon />}
                  </IconButton>
                </>
              )}
            </Box>
          </Box>
        </AccordionSummary>
        
        <AccordionDetails>
          <CardContent sx={{ pt: 0 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {/* Controls */}
            <Box display="flex" gap={2} mb={2} flexWrap="wrap" alignItems="center">
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Category</InputLabel>
                <Select
                  value={selectedCategory}
                  label="Category"
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <MenuItem value="">All Categories</MenuItem>
                  {categories.map(category => (
                    <MenuItem key={category} value={category}>{category}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel>Level</InputLabel>
                <Select
                  value={selectedLevel}
                  label="Level"
                  onChange={(e) => setSelectedLevel(e.target.value)}
                >
                  <MenuItem value="">All Levels</MenuItem>
                  {levels.map(level => (
                    <MenuItem key={level} value={level}>{level}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel>Time Range</InputLabel>
                <Select
                  value={timeRange}
                  label="Time Range"
                  onChange={(e) => setTimeRange(e.target.value)}
                >
                  <MenuItem value="1">1 Hour</MenuItem>
                  <MenuItem value="4">4 Hours</MenuItem>
                  <MenuItem value="24">1 Day</MenuItem>
                  <MenuItem value="168">1 Week</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Search"
                size="small"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                sx={{ minWidth: 200 }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    size="small"
                  />
                }
                label="Auto-scroll"
              />

              <IconButton onClick={() => loadLogs()} disabled={loading}>
                <RefreshIcon />
              </IconButton>

              <IconButton onClick={exportLogs} disabled={logs.length === 0}>
                <DownloadIcon />
              </IconButton>

              <IconButton onClick={() => {
                setSelectedCategory('');
                setSelectedLevel('');
                setSearchText('');
                setTimeRange('1');
              }}>
                <ClearIcon />
              </IconButton>
            </Box>

            {/* Log List */}
            <Box
              ref={logListRef}
              sx={{
                maxHeight,
                overflowY: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper'
              }}
            >
              {loading && logs.length === 0 ? (
                <Box display="flex" justifyContent="center" alignItems="center" p={4}>
                  <CircularProgress size={24} />
                  <Typography variant="body2" sx={{ ml: 2 }}>Loading logs...</Typography>
                </Box>
              ) : logs.length === 0 ? (
                <Box display="flex" justifyContent="center" alignItems="center" p={4}>
                  <Typography variant="body2" color="text.secondary">
                    No logs found for current filters
                  </Typography>
                </Box>
              ) : (
                <List dense sx={{ p: 0 }}>
                  {logs.map((log, index) => {
                    const levelInfo = formatLogLevel(log.level);
                    return (
                      <React.Fragment key={index}>
                        <ListItem sx={{ py: 0.5, px: 1, alignItems: 'flex-start' }}>
                          <ListItemText
                            primary={
                              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }}>
                                  {formatTimestamp(log.timestamp)}
                                </Typography>
                                <Chip
                                  label={levelInfo.name}
                                  size="small"
                                  color={levelInfo.color}
                                  variant="outlined"
                                  sx={{ minWidth: 60 }}
                                />
                                <Chip
                                  label={log.category}
                                  size="small"
                                  variant="filled"
                                  sx={{ bgcolor: 'action.selected', minWidth: 80 }}
                                />
                                <Typography variant="body2" sx={{ flex: 1 }}>
                                  {log.message}
                                </Typography>
                              </Box>
                            }
                            secondary={log.data ? (
                              <Box component="pre" sx={{ 
                                fontSize: '0.75rem', 
                                mt: 0.5, 
                                overflow: 'auto',
                                bgcolor: 'action.hover',
                                p: 1,
                                borderRadius: 1,
                                maxHeight: 200
                              }}>
                                {JSON.stringify(log.data, null, 2)}
                              </Box>
                            ) : null}
                          />
                        </ListItem>
                        {index < logs.length - 1 && <Divider />}
                      </React.Fragment>
                    );
                  })}
                </List>
              )}
            </Box>

            {/* Status Bar */}
            <Box display="flex" justifyContent="between" alignItems="center" mt={2} gap={2}>
              <Typography variant="body2" color="text.secondary">
                {logs.length} logs displayed
                {realTimeEnabled && ' • Real-time enabled'}
                {stats && ` • ${stats.recentErrors.length} recent errors`}
              </Typography>
              
              {stats && stats.recentErrors.length > 0 && (
                <Alert severity="warning" sx={{ flex: 1 }}>
                  <Typography variant="body2">
                    {stats.recentErrors.length} error(s) in the last {timeRange} hour(s)
                  </Typography>
                </Alert>
              )}
            </Box>
          </CardContent>
        </AccordionDetails>
      </Accordion>
    </Card>
  );
};

export default LogViewer;