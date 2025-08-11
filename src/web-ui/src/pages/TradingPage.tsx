import React, { useState, useEffect } from 'react';
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
  Paper
} from '@mui/material';
import { api } from '../utils/apiClient';

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

const TradingPage: React.FC = () => {
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
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

  useEffect(() => {
    loadTradingStatus();
    loadSignals();
    const interval = setInterval(() => {
      loadTradingStatus();
      loadSignals();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadTradingStatus = async () => {
    try {
      const response = await api.trading.getStatus();
      setTradingStatus(response.data);
    } catch (err) {
      console.error('Failed to load trading status:', err);
    }
  };

  const loadSignals = async () => {
    try {
      const response = await api.trading.getSignals({
        threshold: config.zScoreThreshold,
        movingAverages: config.movingAveragesPeriod
      });
      setSignals(response.data.strongSignals || []);
    } catch (err) {
      console.error('Failed to load signals:', err);
    }
  };

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
                    InputProps={{ step: 0.1 }}
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
                    InputProps={{ step: 0.1 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Stop Loss Percent (%)"
                    type="number"
                    value={config.stopLossPercent}
                    onChange={(e) => setConfig({...config, stopLossPercent: parseFloat(e.target.value)})}
                    fullWidth
                    InputProps={{ step: 0.1 }}
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
                    InputProps={{ step: 0.01 }}
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
    </Box>
  );
};

export default TradingPage;