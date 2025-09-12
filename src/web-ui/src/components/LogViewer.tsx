import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Button,
  Chip,
  Tooltip,
  Grid,
  Divider,
  Badge,
  Alert,
  Paper
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  BugReport as DebugIcon
} from '@mui/icons-material';
import { api } from '../utils/apiClient';

interface LogEntry {
  timestamp: string;
  level: number;
  category: string;
  message: string;
  data?: any;
}

interface LogViewerProps {
  title?: string;
  defaultExpanded?: boolean;
  maxHeight?: number;
  categories?: string[];
}

const LOG_LEVELS = {
  0: { name: 'DEBUG', color: '#9e9e9e', icon: <DebugIcon fontSize="small" /> },
  1: { name: 'INFO', color: '#2196f3', icon: <InfoIcon fontSize="small" /> },
  2: { name: 'WARN', color: '#ff9800', icon: <WarningIcon fontSize="small" /> },
  3: { name: 'ERROR', color: '#f44336', icon: <ErrorIcon fontSize="small" /> },
};

const LogViewer: React.FC<LogViewerProps> = ({
  title = "Server Logs",
  defaultExpanded = false,
  maxHeight = 400,
  categories
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [timeRange, setTimeRange] = useState<string>('1');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState<number>(0);
  
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Filter categories if specified
  const displayCategories = categories ? 
    availableCategories.filter(cat => categories.includes(cat)) : 
    availableCategories;

  // Load initial logs and categories
  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params: any = {
        limit: 100,
        hours: timeRange
      };

      if (selectedCategory) params.category = selectedCategory;
      if (selectedLevel) params.level = selectedLevel;
      if (searchQuery) params.search = searchQuery;

      const [logsResponse, categoriesResponse] = await Promise.all([
        api.logs.getRecent(params),
        api.logs.getCategories()
      ]);

      setLogs(logsResponse.data.data.logs || []);
      setAvailableCategories(categoriesResponse.data.data.categories || []);
      
      // Count errors
      const errors = logsResponse.data.data.logs.filter((log: LogEntry) => log.level >= 3);
      setErrorCount(errors.length);

    } catch (err: any) {
      setError(err.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, selectedLevel, searchQuery, timeRange]);

  // Start real-time streaming
  const startStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const params: any = {};
    if (selectedCategory) params.category = selectedCategory;
    if (selectedLevel) params.level = selectedLevel;
    if (searchQuery) params.search = searchQuery;

    const streamUrl = api.logs.getStreamUrl(params);
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.logs && data.logs.length > 0) {
          setLogs(prevLogs => {
            const newLogs = [...data.logs, ...prevLogs].slice(0, 200); // Keep only latest 200
            return newLogs;
          });

          // Count new errors
          const newErrors = data.logs.filter((log: LogEntry) => log.level >= 3);
          if (newErrors.length > 0) {
            setErrorCount(prev => prev + newErrors.length);
          }

          // Auto-scroll to bottom if enabled
          if (autoScroll && logsContainerRef.current) {
            setTimeout(() => {
              if (logsContainerRef.current) {
                logsContainerRef.current.scrollTop = 0; // Scroll to top since newest are at top
              }
            }, 100);
          }
        }
      } catch (parseError) {
        console.warn('Failed to parse streaming log data:', parseError);
      }
    };

    eventSource.onerror = (error) => {
      console.error('Log streaming error:', error);
      setIsStreaming(false);
    };

    eventSourceRef.current = eventSource;
    setIsStreaming(true);
  }, [selectedCategory, selectedLevel, searchQuery, autoScroll]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // Toggle streaming
  const toggleStreaming = () => {
    if (isStreaming) {
      stopStreaming();
    } else {
      startStreaming();
    }
  };

  // Export logs
  const exportLogs = () => {
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `server-logs-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Format log entry data
  const formatLogData = (data: any) => {
    if (!data) return null;
    return JSON.stringify(data, null, 2);
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  // Get log level info
  const getLogLevelInfo = (level: number) => {
    return LOG_LEVELS[level as keyof typeof LOG_LEVELS] || LOG_LEVELS[1];
  };

  // Initial load
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <Card sx={{ mt: 3 }}>
      <Accordion defaultExpanded={defaultExpanded}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{ backgroundColor: 'rgba(0, 0, 0, 0.03)' }}
        >
          <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
            <Box display="flex" alignItems="center" gap={2}>
              <Typography variant="h6">{title}</Typography>
              {errorCount > 0 && (
                <Badge badgeContent={errorCount} color="error">
                  <ErrorIcon color="error" />
                </Badge>
              )}
              {isStreaming && (
                <Chip 
                  label="LIVE" 
                  color="success" 
                  size="small"
                  icon={<PlayIcon />}
                />
              )}
            </Box>
            <Typography variant="body2" color="textSecondary">
              {logs.length} entries
            </Typography>
          </Box>
        </AccordionSummary>
        
        <AccordionDetails>
          {/* Controls */}
          <Box sx={{ mb: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6} md={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={selectedCategory}
                    label="Category"
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    <MenuItem value="">All Categories</MenuItem>
                    {displayCategories.map(category => (
                      <MenuItem key={category} value={category}>
                        {category}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} sm={6} md={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Level</InputLabel>
                  <Select
                    value={selectedLevel}
                    label="Level"
                    onChange={(e) => setSelectedLevel(e.target.value)}
                  >
                    <MenuItem value="">All Levels</MenuItem>
                    {Object.entries(LOG_LEVELS).map(([level, info]) => (
                      <MenuItem key={level} value={info.name}>
                        {info.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={timeRange}
                    label="Time Range"
                    onChange={(e) => setTimeRange(e.target.value)}
                  >
                    <MenuItem value="1">1 Hour</MenuItem>
                    <MenuItem value="4">4 Hours</MenuItem>
                    <MenuItem value="24">24 Hours</MenuItem>
                    <MenuItem value="168">1 Week</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Search"
                  size="small"
                  fullWidth
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search logs..."
                />
              </Grid>

              <Grid item xs={12} sm={12} md={3}>
                <Box display="flex" gap={1} alignItems="center">
                  <Tooltip title={isStreaming ? "Stop live streaming" : "Start live streaming"}>
                    <IconButton 
                      onClick={toggleStreaming} 
                      color={isStreaming ? "error" : "primary"}
                    >
                      {isStreaming ? <PauseIcon /> : <PlayIcon />}
                    </IconButton>
                  </Tooltip>
                  
                  <Tooltip title="Refresh logs">
                    <IconButton onClick={loadLogs} disabled={loading}>
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>
                  
                  <Tooltip title="Export logs">
                    <IconButton onClick={exportLogs}>
                      <DownloadIcon />
                    </IconButton>
                  </Tooltip>
                  
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
                </Box>
              </Grid>
            </Grid>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Error display */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Logs display */}
          <Box 
            ref={logsContainerRef}
            sx={{ 
              maxHeight: maxHeight,
              overflowY: 'auto',
              backgroundColor: '#f5f5f5',
              padding: 1,
              borderRadius: 1
            }}
          >
            {loading && logs.length === 0 ? (
              <Box display="flex" justifyContent="center" py={2}>
                <Typography>Loading logs...</Typography>
              </Box>
            ) : logs.length === 0 ? (
              <Box display="flex" justifyContent="center" py={2}>
                <Typography color="textSecondary">No logs found</Typography>
              </Box>
            ) : (
              logs.map((log, index) => {
                const levelInfo = getLogLevelInfo(log.level);
                return (
                  <Box key={index} sx={{ mb: 1 }}>
                    <Paper sx={{ p: 1, fontSize: '0.875rem' }}>
                      <Box display="flex" alignItems="flex-start" gap={1}>
                        <Box 
                          sx={{ 
                            color: levelInfo.color,
                            minWidth: 'auto',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          {levelInfo.icon}
                        </Box>
                        
                        <Typography
                          variant="body2"
                          sx={{ 
                            color: 'text.secondary',
                            minWidth: 60,
                            fontSize: '0.75rem'
                          }}
                        >
                          {formatTimestamp(log.timestamp)}
                        </Typography>
                        
                        <Chip
                          label={log.category}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.6rem',
                            minWidth: 60
                          }}
                        />
                        
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {log.message}
                        </Typography>
                      </Box>
                      
                      {log.data && (
                        <Box sx={{ mt: 1, ml: 4 }}>
                          <pre style={{ 
                            fontSize: '0.75rem',
                            background: '#f0f0f0',
                            padding: 8,
                            borderRadius: 4,
                            overflow: 'auto',
                            margin: 0
                          }}>
                            {formatLogData(log.data)}
                          </pre>
                        </Box>
                      )}
                    </Paper>
                  </Box>
                );
              })
            )}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Card>
  );
};

export default LogViewer;