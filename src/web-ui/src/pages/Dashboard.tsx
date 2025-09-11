import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Paper,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  ShowChart,
  Speed,
  Warning,
  Refresh as RefreshIcon,
  Wifi as WifiIcon,
  WifiOff as WifiOffIcon
} from '@mui/icons-material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  ChartOptions
} from 'chart.js';
import { apiClient } from '../utils/apiClient';
import { usePortfolioValue } from '../hooks/usePortfolioValue';
import { usePriceWebSocket } from '../hooks/usePriceWebSocket';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  ChartTooltip,
  Legend
);

interface TradingData {
  tradingStatus: 'running' | 'stopped' | 'error';
  activePositions: number;
  strongSignals: number;
  totalTrades: number;
  winRate: number;
}

const Dashboard: React.FC = () => {
  const [tradingData, setTradingData] = useState<TradingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Use real-time portfolio data
  const { portfolio, loading: portfolioLoading, error: portfolioError, refresh: refreshPortfolio, isRealTime } = usePortfolioValue();
  
  // Use real-time price data
  const { isConnected: priceConnected, error: priceError, reconnect } = usePriceWebSocket();

  useEffect(() => {
    loadTradingData();
    const interval = setInterval(loadTradingData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadTradingData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load trading-specific data
      const [
        tradingStatusRes,
        ordersStatsRes,
        signalsRes
      ] = await Promise.allSettled([
        apiClient.get('/api/trading/status'),
        apiClient.get('/api/orders/stats?timeRange=7d'),
        apiClient.get('/api/trading/signals?threshold=2.0')
      ]);

      // Process trading status
      const tradingStatus = tradingStatusRes.status === 'fulfilled' 
        ? tradingStatusRes.value.data 
        : { status: 'error', state: {}, positions: { totalPositions: 0 } };

      // Process order stats
      const ordersStats = ordersStatsRes.status === 'fulfilled'
        ? ordersStatsRes.value.data.summary
        : { totalTrades: 0, winRate: 0 };

      // Process signals
      const signals = signalsRes.status === 'fulfilled'
        ? signalsRes.value.data
        : { strongSignals: [] };

      setTradingData({
        tradingStatus: tradingStatus.status || 'error',
        activePositions: tradingStatus.positions?.totalPositions || 0,
        strongSignals: signals.strongSignals?.length || 0,
        totalTrades: ordersStats.totalTrades || 0,
        winRate: ordersStats.winRate || 0
      });

    } catch (err) {
      setError('Failed to load trading data');
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success';
      case 'stopped': return 'warning';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  const getTrendIcon = (value: number) => {
    return value >= 0 ? <TrendingUp color="success" /> : <TrendingDown color="error" />;
  };

  const getTrendColor = (value: number) => {
    return value >= 0 ? 'success.main' : 'error.main';
  };

  if (loading && !tradingData && !portfolio) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Dashboard
        </Typography>
        <Box display="flex" gap={1} alignItems="center">
          <Tooltip title={isRealTime ? 'Real-time data connected' : 'Real-time data disconnected'}>
            <IconButton color={isRealTime ? 'success' : 'error'}>
              {priceConnected ? <WifiIcon /> : <WifiOffIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Refresh data">
            <IconButton onClick={() => { loadTradingData(); refreshPortfolio(); }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {(error || portfolioError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || portfolioError}
          {priceError && (
            <Button color="inherit" size="small" onClick={reconnect}>
              Reconnect WebSocket
            </Button>
          )}
        </Alert>
      )}

      {/* Real-time Portfolio Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Portfolio Value
                  </Typography>
                  <Typography variant="h5" component="div">
                    {portfolio ? formatCurrency(portfolio.totalValue) : '$0'}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {isRealTime ? 'Live' : 'Static'} • {portfolio?.positions.length || 0} positions
                  </Typography>
                </Box>
                <AccountBalance color="primary" fontSize="large" />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Unrealized P&L
                  </Typography>
                  <Typography 
                    variant="h5" 
                    component="div"
                    color={getTrendColor(portfolio?.totalUnrealizedPnl || 0)}
                  >
                    {portfolio ? formatCurrency(portfolio.totalUnrealizedPnl) : '$0'}
                  </Typography>
                  <Typography 
                    variant="body2" 
                    color={getTrendColor(portfolio?.totalUnrealizedPnlPercent || 0)}
                  >
                    {portfolio ? formatPercent(portfolio.totalUnrealizedPnlPercent) : '0%'}
                  </Typography>
                </Box>
                {getTrendIcon(portfolio?.totalUnrealizedPnl || 0)}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Day Change
                  </Typography>
                  <Typography 
                    variant="h5" 
                    component="div"
                    color={getTrendColor(portfolio?.dayChange || 0)}
                  >
                    {portfolio ? formatCurrency(portfolio.dayChange) : '$0'}
                  </Typography>
                  <Typography 
                    variant="body2" 
                    color={getTrendColor(portfolio?.dayChangePercent || 0)}
                  >
                    {portfolio ? formatPercent(portfolio.dayChangePercent) : '0%'}
                  </Typography>
                </Box>
                {getTrendIcon(portfolio?.dayChange || 0)}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Trading Status
                  </Typography>
                  <Chip 
                    label={tradingData?.tradingStatus || 'Unknown'}
                    color={getStatusColor(tradingData?.tradingStatus || 'error') as any}
                    size="small"
                  />
                  <Typography variant="body2" color="textSecondary">
                    {tradingData?.totalTrades || 0} total trades
                  </Typography>
                </Box>
                <Speed color="primary" fontSize="large" />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Portfolio Positions */}
      {portfolio && portfolio.positions.some(position => {
        const currentValue = position.quantity * (position.currentPrice || position.avgPrice || 0);
        return currentValue > 10 && position.symbol !== 'USDTUSDT';
      }) && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Active Positions
              </Typography>
              <Grid container spacing={2}>
                {portfolio.positions
                  .filter(position => {
                    // Only show positions with significant value (more than $10 worth)
                    const currentValue = position.quantity * (position.currentPrice || position.avgPrice || 0);
                    return currentValue > 10 && position.symbol !== 'USDTUSDT'; // Exclude USDT cash balance
                  })
                  .map((position, index) => (
                  <Grid item xs={12} sm={6} md={4} key={index}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="h6" color="primary">
                          {position.symbol}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Quantity: {position.quantity.toFixed(6)}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Avg Price: {formatCurrency(position.avgPrice)}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Current: {position.currentPrice ? formatCurrency(position.currentPrice) : 'N/A'}
                        </Typography>
                        <Typography 
                          variant="body2" 
                          color={getTrendColor(position.unrealizedPnl || 0)}
                          fontWeight="medium"
                        >
                          P&L: {position.unrealizedPnl ? formatCurrency(position.unrealizedPnl) : '$0'} 
                          ({position.unrealizedPnlPercent ? formatPercent(position.unrealizedPnlPercent) : '0%'})
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Trading Stats */}
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Win Rate
              </Typography>
              <Typography variant="h6">
                {tradingData?.winRate.toFixed(1) || '0.0'}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Positions
              </Typography>
              <Typography variant="h6">
                {portfolio ? portfolio.positions.filter(position => {
                  const currentValue = position.quantity * (position.currentPrice || position.avgPrice || 0);
                  return currentValue > 10 && position.symbol !== 'USDTUSDT';
                }).length : 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Strong Signals
              </Typography>
              <Typography variant="h6">
                {tradingData?.strongSignals || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Last Updated
              </Typography>
              <Typography variant="body2">
                {portfolio ? portfolio.lastUpdated.toLocaleTimeString() : 'Never'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;