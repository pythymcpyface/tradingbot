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
  Paper
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalance,
  ShowChart,
  Speed,
  Warning
} from '@mui/icons-material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions
} from 'chart.js';
import { apiClient } from '../utils/apiClient';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface DashboardData {
  portfolioValue: number;
  dailyPnL: number;
  totalTrades: number;
  winRate: number;
  tradingStatus: 'running' | 'stopped' | 'error';
  activePositions: number;
  strongSignals: number;
}

interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    tension: number;
  }>;
}

const Dashboard: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [portfolioChart, setPortfolioChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load multiple data sources in parallel
      const [
        tradingStatusRes,
        portfolioValueRes,
        ordersStatsRes,
        signalsRes
      ] = await Promise.allSettled([
        apiClient.get('/api/trading/status'),
        apiClient.get('/api/orders/portfolio-value'),
        apiClient.get('/api/orders/stats?timeRange=7d'),
        apiClient.get('/api/trading/signals?threshold=2.0')
      ]);

      // Process trading status
      const tradingStatus = tradingStatusRes.status === 'fulfilled' 
        ? tradingStatusRes.value.data 
        : { status: 'error', state: {}, positions: { totalPositions: 0 } };

      // Process portfolio value
      const portfolioValue = portfolioValueRes.status === 'fulfilled'
        ? portfolioValueRes.value.data
        : { totalPortfolioValue: 0, totalUnrealizedPL: 0 };

      // Process order stats
      const ordersStats = ordersStatsRes.status === 'fulfilled'
        ? ordersStatsRes.value.data.summary
        : { totalTrades: 0, winRate: 0 };

      // Process signals
      const signals = signalsRes.status === 'fulfilled'
        ? signalsRes.value.data
        : { strongSignals: [] };

      setDashboardData({
        portfolioValue: portfolioValue.totalPortfolioValue || 0,
        dailyPnL: portfolioValue.totalUnrealizedPL || 0,
        totalTrades: ordersStats.totalTrades || 0,
        winRate: ordersStats.winRate || 0,
        tradingStatus: tradingStatus.status || 'error',
        activePositions: tradingStatus.positions?.totalPositions || 0,
        strongSignals: signals.strongSignals?.length || 0
      });

      // Create mock portfolio chart data (in a real app, this would come from API)
      const labels = Array.from({ length: 30 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (29 - i));
        return date.toLocaleDateString();
      });

      const baseValue = 10000;
      const portfolioData = labels.map((_, i) => 
        baseValue + (Math.random() - 0.5) * 1000 + i * 50
      );

      setPortfolioChart({
        labels,
        datasets: [{
          label: 'Portfolio Value ($)',
          data: portfolioData,
          borderColor: '#1976d2',
          backgroundColor: 'rgba(25, 118, 210, 0.1)',
          tension: 0.4
        }]
      });

    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Portfolio Performance (30 Days)',
      },
    },
    scales: {
      y: {
        beginAtZero: false,
      },
    },
  };

  if (loading && !dashboardData) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" action={
        <Button color="inherit" size="small" onClick={loadDashboardData}>
          Retry
        </Button>
      }>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
        Dashboard
      </Typography>

      {/* Status Cards */}
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
                    ${dashboardData?.portfolioValue.toLocaleString() || '0'}
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
                    Daily P&L
                  </Typography>
                  <Typography 
                    variant="h5" 
                    component="div"
                    color={dashboardData?.dailyPnL >= 0 ? 'success.main' : 'error.main'}
                  >
                    {dashboardData?.dailyPnL >= 0 ? '+' : ''}
                    ${dashboardData?.dailyPnL.toFixed(2) || '0.00'}
                  </Typography>
                </Box>
                {dashboardData?.dailyPnL >= 0 ? 
                  <TrendingUp color="success" fontSize="large" /> :
                  <TrendingDown color="error" fontSize="large" />
                }
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
                    Win Rate
                  </Typography>
                  <Typography variant="h5" component="div">
                    {dashboardData?.winRate.toFixed(1) || '0.0'}%
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {dashboardData?.totalTrades || 0} trades
                  </Typography>
                </Box>
                <ShowChart color="primary" fontSize="large" />
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
                    label={dashboardData?.tradingStatus || 'Unknown'}
                    color={
                      dashboardData?.tradingStatus === 'running' ? 'success' :
                      dashboardData?.tradingStatus === 'stopped' ? 'warning' : 'error'
                    }
                    variant="filled"
                  />
                  <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                    {dashboardData?.activePositions || 0} positions
                  </Typography>
                </Box>
                <Speed color="primary" fontSize="large" />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Portfolio Chart */}
      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 3 }}>
            {portfolioChart ? (
              <Line data={portfolioChart} options={chartOptions} />
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height="400px">
                <CircularProgress />
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Market Signals
            </Typography>
            <Box display="flex" alignItems="center" mb={2}>
              <Typography variant="h4" color="primary.main" mr={1}>
                {dashboardData?.strongSignals || 0}
              </Typography>
              <Typography>Strong signals active</Typography>
            </Box>
            
            <Typography variant="subtitle2" color="textSecondary" gutterBottom>
              Recent Activity
            </Typography>
            <Box>
              {dashboardData?.strongSignals > 0 ? (
                <Alert severity="info" icon={<Warning />}>
                  {dashboardData.strongSignals} trading signals detected. 
                  Check the trading page for details.
                </Alert>
              ) : (
                <Typography color="textSecondary">
                  No strong trading signals at this time.
                </Typography>
              )}
            </Box>

            <Box mt={3}>
              <Button 
                variant="outlined" 
                fullWidth 
                onClick={() => window.location.href = '/trading'}
              >
                View Trading Page
              </Button>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;