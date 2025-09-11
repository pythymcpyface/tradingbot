import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography, 
  Paper, 
  Box, 
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Chip,
  Tabs,
  Tab
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Assessment as AssessmentIcon,
  Timeline as TimelineIcon
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
} from 'chart.js';
import { api } from '../utils/apiClient';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  ChartTooltip,
  Legend
);

interface BacktestResult {
  id: string;
  runId: string;
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: number;
  movingAverages: number;
  profitPercent: number;
  stopLossPercent: number;
  startTime: string;
  endTime: string;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  maxDrawdown: number;
  winRatio: number;
  totalTrades: number;
  profitFactor: number;
  avgTradeDuration: number;
  calmarRatio?: number;
  benchmarkReturn?: number;
  createdAt: string;
}

interface BacktestOrder {
  id: string;
  backtestRunId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: string;
  pnl?: number;
  cumulativePnl?: number;
  portfolio_value?: number;
}

const BacktestPage: React.FC = () => {
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [selectedBacktest, setSelectedBacktest] = useState<BacktestResult | null>(null);
  const [backtestOrders, setBacktestOrders] = useState<BacktestOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  // Pagination for results
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalResults, setTotalResults] = useState(0);

  // Filters
  const [symbolFilter, setSymbolFilter] = useState('');
  const [sortBy, setSortBy] = useState('sharpeRatio');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const fetchBacktestResults = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params: any = {
        offset: page * rowsPerPage,
        limit: rowsPerPage,
        sortBy,
        sortOrder,
      };
      
      if (symbolFilter) {
        const [baseAsset, quoteAsset] = symbolFilter.split('USDT');
        if (baseAsset && quoteAsset === '') {
          params.baseAsset = baseAsset;
          params.quoteAsset = 'USDT';
        }
      }
      
      const response = await api.backtest.getAll(params);
      setBacktestResults(response.data.results || []);
      setTotalResults(response.data.pagination?.total || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch backtest results');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, symbolFilter, sortBy, sortOrder]);

  const fetchBacktestOrders = useCallback(async (runId: string) => {
    try {
      setOrdersLoading(true);
      const response = await api.backtest.getOrders(runId);
      setBacktestOrders(response.data.orders || []);
    } catch (err: any) {
      console.error('Failed to fetch backtest orders:', err.message);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBacktestResults();
  }, [fetchBacktestResults]);

  useEffect(() => {
    if (selectedBacktest) {
      fetchBacktestOrders(selectedBacktest.runId);
    }
  }, [selectedBacktest, fetchBacktestOrders]);

  const handleRefresh = () => {
    fetchBacktestResults();
    if (selectedBacktest) {
      fetchBacktestOrders(selectedBacktest.runId);
    }
  };

  const formatMetric = (value: number | undefined | null, decimals: number = 2, suffix: string = '') => {
    if (value === undefined || value === null) return '-';
    return `${value.toFixed(decimals)}${suffix}`;
  };

  const getMetricColor = (value: number | undefined, threshold: number = 0) => {
    if (value === undefined) return 'text.primary';
    return value >= threshold ? 'success.main' : 'error.main';
  };

  const generateEquityCurveData = () => {
    if (!backtestOrders.length) return null;

    const chartData = backtestOrders.map((order, index) => ({
      x: new Date(order.timestamp).toLocaleDateString(),
      y: order.cumulativePnl || 0,
      portfolioValue: order.portfolio_value || 100000
    }));

    return {
      labels: chartData.map(d => d.x),
      datasets: [
        {
          label: 'Portfolio Value',
          data: chartData.map(d => d.portfolioValue),
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.1,
        },
        {
          label: 'Cumulative PnL',
          data: chartData.map(d => d.y),
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          tension: 0.1,
          yAxisID: 'y1',
        }
      ],
    };
  };

  const chartOptions = {
    responsive: true,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: selectedBacktest ? 
          `${selectedBacktest.baseAsset}${selectedBacktest.quoteAsset} - Equity Curve` : 
          'Equity Curve',
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Date'
        }
      },
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: 'Portfolio Value ($)'
        }
      },
      y1: {
        type: 'linear' as const,
        display: true,
        position: 'right' as const,
        title: {
          display: true,
          text: 'PnL ($)'
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Backtest Results
        </Typography>
        <Tooltip title="Refresh data">
          <IconButton onClick={handleRefresh} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="Symbol"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              placeholder="e.g., BTCUSDT"
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortBy}
                label="Sort By"
                onChange={(e) => setSortBy(e.target.value)}
              >
                <MenuItem value="sharpeRatio">Sharpe Ratio</MenuItem>
                <MenuItem value="totalReturn">Total Return</MenuItem>
                <MenuItem value="annualizedReturn">Annualized Return</MenuItem>
                <MenuItem value="calmarRatio">Calmar Ratio</MenuItem>
                <MenuItem value="maxDrawdown">Max Drawdown</MenuItem>
                <MenuItem value="winRatio">Win Ratio</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Order</InputLabel>
              <Select
                value={sortOrder}
                label="Order"
                onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
              >
                <MenuItem value="desc">Descending</MenuItem>
                <MenuItem value="asc">Ascending</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {
                setSymbolFilter('');
                setPage(0);
              }}
              size="small"
            >
              Clear Filters
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* Results List */}
        <Grid item xs={12} lg={selectedBacktest ? 6 : 12}>
          <Paper>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Symbol</TableCell>
                    <TableCell>Period</TableCell>
                    <TableCell align="right">Return</TableCell>
                    <TableCell align="right">Sharpe</TableCell>
                    <TableCell align="right">Drawdown</TableCell>
                    <TableCell align="right">Trades</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <CircularProgress />
                      </TableCell>
                    </TableRow>
                  ) : backtestResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography color="text.secondary">
                          No backtest results found
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    backtestResults.map((result) => (
                      <TableRow 
                        key={result.id} 
                        hover 
                        selected={selectedBacktest?.id === result.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedBacktest(result)}
                      >
                        <TableCell>
                          <Chip 
                            label={`${result.baseAsset}${result.quoteAsset}`} 
                            size="small" 
                            color="primary"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {new Date(result.startTime).toLocaleDateString()} - {new Date(result.endTime).toLocaleDateString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography 
                            variant="body2" 
                            color={getMetricColor(result.totalReturn)}
                            fontWeight="medium"
                          >
                            {formatMetric(result.totalReturn, 1, '%')}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography 
                            variant="body2" 
                            color={getMetricColor(result.sharpeRatio)}
                            fontWeight="medium"
                          >
                            {formatMetric(result.sharpeRatio, 2)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography 
                            variant="body2" 
                            color={getMetricColor(-result.maxDrawdown)}
                            fontWeight="medium"
                          >
                            {formatMetric(result.maxDrawdown, 1, '%')}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2">
                            {result.totalTrades}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            startIcon={<TimelineIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBacktest(result);
                            }}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            
            <TablePagination
              component="div"
              count={totalResults}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(parseInt(event.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25]}
            />
          </Paper>
        </Grid>

        {/* Detailed View */}
        {selectedBacktest && (
          <Grid item xs={12} lg={6}>
            <Paper>
              <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
                  <Tab label="Metrics" />
                  <Tab label="Chart" />
                </Tabs>
              </Box>

              {activeTab === 0 && (
                <Box p={2}>
                  <Typography variant="h6" gutterBottom>
                    Performance Metrics
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Total Return
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(selectedBacktest.totalReturn)}
                          >
                            {formatMetric(selectedBacktest.totalReturn, 2, '%')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Annualized Return
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(selectedBacktest.annualizedReturn)}
                          >
                            {formatMetric(selectedBacktest.annualizedReturn, 2, '%')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Sharpe Ratio
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(selectedBacktest.sharpeRatio)}
                          >
                            {formatMetric(selectedBacktest.sharpeRatio, 2)}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Sortino Ratio
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(selectedBacktest.sortinoRatio)}
                          >
                            {formatMetric(selectedBacktest.sortinoRatio, 2)}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Max Drawdown
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(-selectedBacktest.maxDrawdown)}
                          >
                            {formatMetric(selectedBacktest.maxDrawdown, 2, '%')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Win Ratio
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(selectedBacktest.winRatio, 50)}
                          >
                            {formatMetric(selectedBacktest.winRatio, 1, '%')}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Total Trades
                          </Typography>
                          <Typography variant="h6" color="primary">
                            {selectedBacktest.totalTrades}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Profit Factor
                          </Typography>
                          <Typography 
                            variant="h6" 
                            color={getMetricColor(selectedBacktest.profitFactor, 1)}
                          >
                            {formatMetric(selectedBacktest.profitFactor, 2)}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Box>
              )}

              {activeTab === 1 && (
                <Box p={2} height={400}>
                  {ordersLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                      <CircularProgress />
                    </Box>
                  ) : backtestOrders.length > 0 ? (
                    <Line data={generateEquityCurveData()!} options={chartOptions} />
                  ) : (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                      <Typography color="text.secondary">
                        No chart data available
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default BacktestPage;