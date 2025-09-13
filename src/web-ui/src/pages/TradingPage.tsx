import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Switch,
  FormControlLabel,
  TextField,
  Box,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { Line } from 'react-chartjs-2';
import { api } from '../utils/apiClient';
import LogViewer from '../components/LogViewer';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface TradingConfig {
  zScoreThreshold: number;
  movingAveragesPeriod: number;
  profitPercent: number;
  stopLossPercent: number;
  maxPositions: number;
  allocationPerPosition: number;
  symbols: string[];
  enableLiveTrading: boolean;
}

interface TradingStatus {
  status: 'running' | 'stopped' | 'error';
  state: any;
  config: TradingConfig;
  binanceConnected: boolean;
}

interface Signal {
  symbol: string;
  timestamp: string;
  zScore: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
}

interface ZScoreDataPoint {
  timestamp: Date;
  zScore: number;
  symbol: string;
  rating: number;
  movingAverageZScore?: number;
}

const TradingPage: React.FC = () => {
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [zScoreData, setZScoreData] = useState<Record<string, ZScoreDataPoint[]>>({});
  const [timeRange, setTimeRange] = useState<string>('1');
  const [showEnabledOnly, setShowEnabledOnly] = useState<boolean>(true);
  const [config, setConfig] = useState<TradingConfig>({
    zScoreThreshold: 2.5,
    movingAveragesPeriod: 200,
    profitPercent: 5.0,
    stopLossPercent: 2.5,
    maxPositions: 5,
    allocationPerPosition: 0.1,
    symbols: ['BTCUSDT', 'ETHUSDT'],
    enableLiveTrading: false
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTradingStatus = useCallback(async () => {
    try {
      const response = await api.trading.getStatus();
      setTradingStatus(response.data);
    } catch (err) {
      console.error('Failed to load trading status:', err);
    }
  }, []);

  const loadSignals = useCallback(async () => {
    try {
      const response = await api.trading.getSignals({
        threshold: config.zScoreThreshold,
        movingAverages: config.movingAveragesPeriod
      });
      setSignals(response.data.strongSignals || []);
    } catch (err) {
      console.error('Failed to load signals:', err);
    }
  }, [config.zScoreThreshold, config.movingAveragesPeriod]);

  const loadZScoreData = useCallback(async () => {
    try {
      const response = await api.trading.getZScores({
        hours: timeRange,
        enabledOnly: showEnabledOnly.toString()
      });
      
      // Convert timestamp strings to Date objects
      const processedData: Record<string, ZScoreDataPoint[]> = {};
      Object.entries(response.data.data || {}).forEach(([symbol, dataPoints]) => {
        processedData[symbol] = (dataPoints as any[]).map(point => ({
          ...point,
          timestamp: new Date(point.timestamp)
        }));
      });
      
      setZScoreData(processedData);
    } catch (err) {
      console.error('Failed to load z-score data:', err);
    }
  }, [timeRange, showEnabledOnly]);

  useEffect(() => {
    loadTradingStatus();
    loadSignals();
    loadZScoreData();
    const interval = setInterval(() => {
      loadTradingStatus();
      loadSignals();
      loadZScoreData();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadTradingStatus, loadSignals, loadZScoreData]);

  const handleStart = async () => {
    try {
      setLoading(true);
      setError(null);
      await api.trading.start(config);
      await loadTradingStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to start trading');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    try {
      setLoading(true);
      await api.trading.stop();
      await loadTradingStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to stop trading');
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyStop = async () => {
    if (window.confirm('Are you sure you want to execute an emergency stop? This will cancel all open orders.')) {
      try {
        setLoading(true);
        await api.trading.emergencyStop();
        await loadTradingStatus();
      } catch (err: any) {
        setError(err.message || 'Failed to execute emergency stop');
      } finally {
        setLoading(false);
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success';
      case 'stopped': return 'warning';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  // Prepare chart data from z-score data
  const prepareChartData = () => {
    const colors = [
      'rgb(255, 99, 132)',   // Red
      'rgb(54, 162, 235)',   // Blue
      'rgb(255, 205, 86)',   // Yellow
      'rgb(75, 192, 192)',   // Green
      'rgb(153, 102, 255)',  // Purple
      'rgb(255, 159, 64)',   // Orange
      'rgb(199, 199, 199)',  // Grey
      'rgb(83, 102, 147)',   // Dark Blue
      'rgb(255, 99, 255)',   // Pink
      'rgb(99, 255, 132)',   // Light Green
    ];

    const datasets = Object.entries(zScoreData)
      .map(([symbol, dataPoints], index) => ({
        label: symbol,
        data: dataPoints
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) // Sort by timestamp
          .map(point => ({
            x: point.timestamp.getTime(), // Use timestamp as number
            y: point.zScore
          })),
        borderColor: colors[index % colors.length],
        backgroundColor: colors[index % colors.length] + '20',
        borderWidth: 2,
        fill: false,
        tension: 0.1,
      }));

    return {
      datasets
    };
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Real-time Z-Score Tracking',
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: 'Z-Score'
        },
        grid: {
          color: (context) => {
            if (context.tick.value === config.zScoreThreshold) {
              return 'rgba(255, 99, 132, 0.8)'; // Red line for buy threshold
            }
            if (context.tick.value === -config.zScoreThreshold) {
              return 'rgba(255, 99, 132, 0.8)'; // Red line for sell threshold
            }
            return 'rgba(0, 0, 0, 0.1)';
          }
        }
      },
      x: {
        type: 'time',
        time: {
          displayFormats: {
            minute: 'HH:mm',
            hour: 'MMM dd HH:mm',
            day: 'MMM dd',
            week: 'MMM dd'
          },
          tooltipFormat: 'MMM dd, yyyy HH:mm:ss'
        },
        title: {
          display: true,
          text: 'Time'
        }
      }
    },
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
        Live Trading
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Status Overview */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Trading Status
              </Typography>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Chip 
                  label={tradingStatus?.status || 'Unknown'}
                  color={getStatusColor(tradingStatus?.status || 'error') as any}
                  variant="filled"
                />
                <Chip 
                  label={tradingStatus?.binanceConnected ? 'Connected' : 'Disconnected'}
                  color={tradingStatus?.binanceConnected ? 'success' : 'error'}
                  variant="outlined"
                />
              </Box>
              
              <Box display="flex" gap={2}>
                <Button
                  variant="contained"
                  color="success"
                  onClick={handleStart}
                  disabled={loading || tradingStatus?.status === 'running'}
                >
                  Start Trading
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleStop}
                  disabled={loading || tradingStatus?.status === 'stopped'}
                >
                  Stop Trading
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  onClick={handleEmergencyStop}
                  disabled={loading || tradingStatus?.status === 'stopped'}
                >
                  Emergency Stop
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Active Signals
              </Typography>
              <Typography variant="h3" color="primary.main">
                {signals.length}
              </Typography>
              <Typography color="textSecondary">
                Strong trading signals detected
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Z-Score Chart */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">
                  Z-Score Tracking Chart
                </Typography>
                <Box display="flex" gap={2} alignItems="center">
                  <FormControl size="small" sx={{ minWidth: 120 }}>
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
                  <FormControlLabel
                    control={
                      <Switch
                        checked={showEnabledOnly}
                        onChange={(e) => setShowEnabledOnly(e.target.checked)}
                        size="small"
                      />
                    }
                    label="Trading coins only"
                  />
                </Box>
              </Box>
              <Box sx={{ height: 400, position: 'relative' }}>
                {Object.keys(zScoreData).length > 0 ? (
                  <Line data={prepareChartData()} options={chartOptions} />
                ) : (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      height: '100%',
                      color: 'text.secondary' 
                    }}
                  >
                    <Typography>Loading z-score data...</Typography>
                  </Box>
                )}
              </Box>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
                Shows historical z-score values from live trading calculations. 
                Toggle "Trading coins only" to see enabled vs. all monitored symbols.
                Data is stored persistently and updates every 5 minutes during trading.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Configuration */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Trading Configuration
              </Typography>
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Z-Score Threshold"
                    type="number"
                    value={config.zScoreThreshold}
                    onChange={(e) => setConfig({...config, zScoreThreshold: parseFloat(e.target.value)})}
                    fullWidth
                    inputProps={{ step: 0.1 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Moving Average Period"
                    type="number"
                    value={config.movingAveragesPeriod}
                    onChange={(e) => setConfig({...config, movingAveragesPeriod: parseInt(e.target.value)})}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Profit Percent (%)"
                    type="number"
                    value={config.profitPercent}
                    onChange={(e) => setConfig({...config, profitPercent: parseFloat(e.target.value)})}
                    fullWidth
                    inputProps={{ step: 0.1 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Stop Loss Percent (%)"
                    type="number"
                    value={config.stopLossPercent}
                    onChange={(e) => setConfig({...config, stopLossPercent: parseFloat(e.target.value)})}
                    fullWidth
                    inputProps={{ step: 0.1 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Max Positions"
                    type="number"
                    value={config.maxPositions}
                    onChange={(e) => setConfig({...config, maxPositions: parseInt(e.target.value)})}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Allocation Per Position"
                    type="number"
                    value={config.allocationPerPosition}
                    onChange={(e) => setConfig({...config, allocationPerPosition: parseFloat(e.target.value)})}
                    fullWidth
                    inputProps={{ step: 0.01 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField
                    label="Trading Symbols (comma separated)"
                    value={config.symbols.join(', ')}
                    onChange={(e) => setConfig({...config, symbols: e.target.value.split(',').map(s => s.trim())})}
                    fullWidth
                  />
                </Grid>
              </Grid>

              <Box mt={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={config.enableLiveTrading}
                      onChange={(e) => setConfig({...config, enableLiveTrading: e.target.checked})}
                    />
                  }
                  label="Enable Live Trading (Real Money)"
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Signals Table */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Current Trading Signals
              </Typography>
              
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Symbol</TableCell>
                      <TableCell>Signal</TableCell>
                      <TableCell align="right">Z-Score</TableCell>
                      <TableCell>Timestamp</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {signals.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          No active trading signals
                        </TableCell>
                      </TableRow>
                    ) : (
                      signals.map((signal, index) => (
                        <TableRow key={index}>
                          <TableCell>{signal.symbol}</TableCell>
                          <TableCell>
                            <Chip
                              label={signal.signal}
                              color={signal.signal === 'BUY' ? 'success' : signal.signal === 'SELL' ? 'error' : 'default'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">
                            {signal.zScore.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            {new Date(signal.timestamp).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Server Logs */}
      <LogViewer 
        title="Trading System Logs"
        defaultExpanded={true}
        maxHeight={500}
      />
    </Box>
  );
};

export default TradingPage;