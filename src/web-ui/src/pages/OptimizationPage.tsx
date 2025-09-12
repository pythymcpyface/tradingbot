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
  Chip,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  IconButton,
  Tab,
  Tabs,
  LinearProgress,
  Divider
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  TrendingUp as TrendingUpIcon,
  ShowChart as ShowChartIcon,
  Assessment as AssessmentIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon
} from '@mui/icons-material';
import { Line, Scatter, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  ScatterController
} from 'chart.js';
import { api } from '../utils/apiClient';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ScatterController,
  Title,
  ChartTooltip,
  Legend
);

interface OptimizationResult {
  id: string;
  runId: string;
  baseAsset: string;
  quoteAsset: string;
  zScoreThreshold: string;
  movingAverages: number;
  profitPercent: string;
  stopLossPercent: string;
  startTime: string;
  endTime: string;
  totalReturn: string;
  annualizedReturn: string;
  benchmarkReturn: string | null;
  sharpeRatio: string;
  sortinoRatio: string;
  alpha: string;
  maxDrawdown: string;
  winRatio: string;
  totalTrades: number;
  profitFactor: string;
  avgTradeDuration: string;
  calmarRatio: string | null;
  createdAt: string;
  backtestRun: {
    id: string;
    startTime: string;
    endTime: string;
    windowSize: number;
  };
}

interface OptimizationStats {
  totalRuns: number;
  bestReturn: number;
  avgReturn: number;
  bestSharpe: number;
  avgSharpe: number;
  parameterCombinations: number;
}

interface CorrelationData {
  parameter: string;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRatio: number;
}

// Helper function to extract unique symbols from results
const extractUniqueSymbols = (results: OptimizationResult[]): string[] => {
  const symbolsSet = new Set<string>();
  
  results.forEach(result => {
    const symbol = `${result.baseAsset}${result.quoteAsset}`;
    symbolsSet.add(symbol);
  });
  
  return Array.from(symbolsSet).sort();
};

// Helper function to deduplicate optimization results
const deduplicateResults = (results: OptimizationResult[]): OptimizationResult[] => {
  const uniqueResults = new Map<string, OptimizationResult>();
  
  results.forEach(result => {
    // Create unique key from the specified parameters
    const key = [
      result.profitPercent,
      result.stopLossPercent, 
      result.zScoreThreshold,
      result.movingAverages,
      result.startTime,
      result.quoteAsset,
      result.baseAsset
    ].join('|');
    
    // Check if we already have this parameter combination
    const existing = uniqueResults.get(key);
    
    if (!existing) {
      // First time seeing this combination
      uniqueResults.set(key, result);
    } else {
      // We have a duplicate - keep the one with better total return
      const currentReturn = parseFloat(result.totalReturn);
      const existingReturn = parseFloat(existing.totalReturn);
      
      if (currentReturn > existingReturn) {
        uniqueResults.set(key, result);
      }
    }
  });
  
  return Array.from(uniqueResults.values());
};

const OptimizationPage: React.FC = () => {
  const [currentTab, setCurrentTab] = useState(0);
  const [results, setResults] = useState<OptimizationResult[]>([]);
  const [stats, setStats] = useState<OptimizationStats | null>(null);
  const [correlationData, setCorrelationData] = useState<CorrelationData[]>([]);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalResults, setTotalResults] = useState(0);
  
  // Filters
  const [symbolFilter, setSymbolFilter] = useState('');
  const [sortBy, setSortBy] = useState('totalReturn');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [minReturn, setMinReturn] = useState('');
  const [minSharpe, setMinSharpe] = useState('');
  
  // Parameter filters
  const [zScoreFilter, setZScoreFilter] = useState('');
  const [movingAveragesFilter, setMovingAveragesFilter] = useState('');
  const [profitPercentFilter, setProfitPercentFilter] = useState('');
  const [stopLossPercentFilter, setStopLossPercentFilter] = useState('');

  // Fetch optimization data
  const fetchOptimizationData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Parse symbol filter to baseAsset and quoteAsset
      let baseAsset = '';
      let quoteAsset = '';
      if (symbolFilter) {
        // Symbol from dropdown is exact format like "BTCUSDT"
        // Extract baseAsset and quoteAsset by splitting on known quote assets
        const symbol = symbolFilter.toUpperCase();
        if (symbol.endsWith('USDT')) {
          baseAsset = symbol.replace('USDT', '');
          quoteAsset = 'USDT';
        } else if (symbol.endsWith('BTC')) {
          baseAsset = symbol.replace('BTC', '');
          quoteAsset = 'BTC';
        } else if (symbol.endsWith('ETH')) {
          baseAsset = symbol.replace('ETH', '');
          quoteAsset = 'ETH';
        } else if (symbol.endsWith('BNB')) {
          baseAsset = symbol.replace('BNB', '');
          quoteAsset = 'BNB';
        }
        // If no known quote asset found, treat the whole string as baseAsset
        if (!quoteAsset) {
          baseAsset = symbol;
        }
      }

      const params = {
        offset: page * rowsPerPage,
        limit: rowsPerPage,
        sortBy: sortBy,
        sortOrder: sortOrder,
        ...(baseAsset && { baseAsset }),
        ...(quoteAsset && { quoteAsset }),
        ...(minReturn && { minReturn: parseFloat(minReturn) }),
        ...(minSharpe && { minSharpe: parseFloat(minSharpe) }),
        ...(zScoreFilter && { zScoreThreshold: parseFloat(zScoreFilter) }),
        ...(movingAveragesFilter && { movingAverages: parseInt(movingAveragesFilter) }),
        ...(profitPercentFilter && { profitPercent: parseFloat(profitPercentFilter) }),
        ...(stopLossPercentFilter && { stopLossPercent: parseFloat(stopLossPercentFilter) })
      };

      // Fetch results first
      const resultsResponse = await api.optimization.getAll(params);
      const rawResults = resultsResponse.data.results || [];
      const paginationInfo = resultsResponse.data.pagination || { total: 0 };
      
      // Deduplicate results by parameter combination
      const deduplicatedResults = deduplicateResults(rawResults);
      
      // Extract unique symbols for dropdown - but only if we don't have symbols yet
      if (availableSymbols.length === 0) {
        // Fetch all symbols by getting a small sample without pagination
        try {
          const symbolResponse = await api.optimization.getAll({ limit: 1000, offset: 0 });
          const allResults = symbolResponse.data.results || [];
          const uniqueSymbols = extractUniqueSymbols(allResults);
          setAvailableSymbols(uniqueSymbols);
        } catch (err) {
          console.warn('Failed to fetch symbols, using current results');
          const uniqueSymbols = extractUniqueSymbols(deduplicatedResults);
          setAvailableSymbols(uniqueSymbols);
        }
      }
      
      setResults(deduplicatedResults);
      // Use the API's total count, not the deduplicated count
      setTotalResults(paginationInfo.total);

      // Try to fetch stats and correlation, but don't fail if they error
      try {
        const statsResponse = await api.optimization.getStats();
        setStats(statsResponse.data || null);
      } catch (statsError) {
        console.warn('Stats API failed, calculating from results data');
        // Calculate basic stats from deduplicated results
        if (deduplicatedResults.length > 0) {
          const returns = deduplicatedResults.map((r: OptimizationResult) => parseFloat(r.totalReturn));
          const sharpes = deduplicatedResults.map((r: OptimizationResult) => parseFloat(r.sharpeRatio));
          
          setStats({
            totalRuns: deduplicatedResults.length,
            bestReturn: Math.max(...returns),
            avgReturn: returns.reduce((a: number, b: number) => a + b, 0) / returns.length,
            bestSharpe: Math.max(...sharpes),
            avgSharpe: sharpes.reduce((a: number, b: number) => a + b, 0) / sharpes.length,
            parameterCombinations: deduplicatedResults.length // Each result is now unique
          });
        }
      }

      // Always use deduplicated results data for scatter plot since correlation API returns different structure
      if (deduplicatedResults.length > 0) {
        const corrData = deduplicatedResults.map((r: OptimizationResult) => ({
          parameter: `${r.baseAsset}${r.quoteAsset}`,
          totalReturn: parseFloat(r.totalReturn),
          sharpeRatio: parseFloat(r.sharpeRatio),
          maxDrawdown: parseFloat(r.maxDrawdown),
          winRatio: parseFloat(r.winRatio)
        }));
        setCorrelationData(corrData);
      }

    } catch (err: any) {
      setError(err.message || 'Failed to fetch optimization data');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, sortBy, sortOrder, symbolFilter, minReturn, minSharpe, zScoreFilter, movingAveragesFilter, profitPercentFilter, stopLossPercentFilter, availableSymbols.length]);

  useEffect(() => {
    fetchOptimizationData();
  }, [fetchOptimizationData]);

  // Format numbers for display
  const formatPercent = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `${num.toFixed(2)}%`;
  };

  const formatNumber = (value: string | number, decimals = 2) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return num.toFixed(decimals);
  };

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(num);
  };

  // Get performance color
  const getPerformanceColor = (value: number, threshold: number = 0) => {
    return value >= threshold ? 'success.main' : 'error.main';
  };

  // Get rank color chip
  const getRankChip = (rank: number, total: number) => {
    const percentile = (rank / total) * 100;
    if (percentile <= 10) return <Chip label={`#${rank}`} color="success" size="small" />;
    if (percentile <= 25) return <Chip label={`#${rank}`} color="primary" size="small" />;
    if (percentile <= 50) return <Chip label={`#${rank}`} color="warning" size="small" />;
    return <Chip label={`#${rank}`} color="default" size="small" />;
  };

  // Prepare correlation chart data
  const prepareCorrelationChart = () => {
    if (!Array.isArray(correlationData) || correlationData.length === 0) {
      return { datasets: [] };
    }

    return {
      datasets: [
        {
          label: 'Return vs Sharpe Ratio',
          data: correlationData.map(item => ({
            x: item.totalReturn,
            y: parseFloat(item.sharpeRatio?.toString() || '0')
          })),
          backgroundColor: 'rgba(54, 162, 235, 0.6)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
        }
      ]
    };
  };

  // Prepare parameter distribution chart
  const prepareParameterChart = () => {
    if (!Array.isArray(results) || results.length === 0) {
      return { labels: [], datasets: [] };
    }

    const zScoreDistribution: { [key: string]: number } = {};
    results.forEach(result => {
      const key = result.zScoreThreshold;
      zScoreDistribution[key] = (zScoreDistribution[key] || 0) + 1;
    });

    return {
      labels: Object.keys(zScoreDistribution).sort((a, b) => parseFloat(a) - parseFloat(b)),
      datasets: [
        {
          label: 'Parameter Frequency',
          data: Object.keys(zScoreDistribution)
            .sort((a, b) => parseFloat(a) - parseFloat(b))
            .map(key => zScoreDistribution[key]),
          backgroundColor: 'rgba(75, 192, 192, 0.6)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        }
      ]
    };
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  if (loading && results.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="bold">
            Parameter Optimization
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Showing unique parameter combinations (duplicates removed, best performance kept)
          </Typography>
        </Box>
        <Box>
          <Tooltip title="Refresh Data">
            <IconButton onClick={fetchOptimizationData} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      {stats && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={2.4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Total Runs
                </Typography>
                <Typography variant="h6">
                  {stats.totalRuns.toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Best Return
                </Typography>
                <Typography variant="h6" color="success.main">
                  {formatPercent(stats.bestReturn)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Avg Return
                </Typography>
                <Typography variant="h6">
                  {formatPercent(stats.avgReturn)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Best Sharpe
                </Typography>
                <Typography variant="h6" color="primary.main">
                  {formatNumber(stats.bestSharpe)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  Parameter Sets
                </Typography>
                <Typography variant="h6">
                  {stats.parameterCombinations.toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={currentTab} onChange={handleTabChange}>
          <Tab label="Results" icon={<AssessmentIcon />} />
          <Tab label="Analysis" icon={<ShowChartIcon />} />
          <Tab label="Top Performers" icon={<TrendingUpIcon />} />
        </Tabs>
      </Paper>

      {/* Tab Content */}
      {currentTab === 0 && (
        <Paper>
          {/* Filters */}
          <Box sx={{ p: 2, borderBottom: '1px solid #eee' }}>
            {/* Basic Filters - First Row */}
            <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} lg={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Symbol Filter</InputLabel>
                  <Select
                    value={symbolFilter}
                    label="Symbol Filter"
                    onChange={(e) => setSymbolFilter(e.target.value)}
                  >
                    <MenuItem value="">
                      <em>All Symbols</em>
                    </MenuItem>
                    {availableSymbols.map((symbol) => (
                      <MenuItem key={symbol} value={symbol}>
                        {symbol}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} lg={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Sort By</InputLabel>
                  <Select
                    value={sortBy}
                    label="Sort By"
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <MenuItem value="totalReturn">Total Return</MenuItem>
                    <MenuItem value="sharpeRatio">Sharpe Ratio</MenuItem>
                    <MenuItem value="sortinoRatio">Sortino Ratio</MenuItem>
                    <MenuItem value="maxDrawdown">Max Drawdown</MenuItem>
                    <MenuItem value="winRatio">Win Ratio</MenuItem>
                    <MenuItem value="profitFactor">Profit Factor</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} lg={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Order</InputLabel>
                  <Select
                    value={sortOrder}
                    label="Order"
                    onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                  >
                    <MenuItem value="desc">High to Low</MenuItem>
                    <MenuItem value="asc">Low to High</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <TextField
                  label="Min Return %"
                  value={minReturn}
                  onChange={(e) => setMinReturn(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <TextField
                  label="Min Sharpe"
                  value={minSharpe}
                  onChange={(e) => setMinSharpe(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                />
              </Grid>
            </Grid>
            
            {/* Parameter Filters - Second Row */}
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} sm={6} lg={3}>
                <TextField
                  label="Z-Score Threshold"
                  value={zScoreFilter}
                  onChange={(e) => setZScoreFilter(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="e.g., 2.0"
                  helperText="Minimum z-score threshold"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <TextField
                  label="Moving Averages"
                  value={movingAveragesFilter}
                  onChange={(e) => setMovingAveragesFilter(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="e.g., 20"
                  helperText="MA period in days"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <TextField
                  label="Min Profit %"
                  value={profitPercentFilter}
                  onChange={(e) => setProfitPercentFilter(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="e.g., 2.0"
                  helperText="Minimum take profit %"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <TextField
                  label="Max Stop Loss %"
                  value={stopLossPercentFilter}
                  onChange={(e) => setStopLossPercentFilter(e.target.value)}
                  size="small"
                  fullWidth
                  type="number"
                  placeholder="e.g., 5.0"
                  helperText="Maximum stop loss %"
                />
              </Grid>
            </Grid>
          </Box>

          {/* Results Table */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Parameters</TableCell>
                  <TableCell align="right">Total Return</TableCell>
                  <TableCell align="right">Sharpe Ratio</TableCell>
                  <TableCell align="right">Sortino Ratio</TableCell>
                  <TableCell align="right">Max Drawdown</TableCell>
                  <TableCell align="right">Win Rate</TableCell>
                  <TableCell align="right">Trades</TableCell>
                  <TableCell align="right">Profit Factor</TableCell>
                  <TableCell>Period</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((result, index) => (
                  <TableRow key={result.id} hover>
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" fontWeight="medium">
                          {result.baseAsset}{result.quoteAsset}
                        </Typography>
                        {getRankChip(page * rowsPerPage + index + 1, totalResults)}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">
                          Z≥{result.zScoreThreshold}, MA{result.movingAverages}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          TP:{result.profitPercent}%, SL:{result.stopLossPercent}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight="medium"
                        color={getPerformanceColor(parseFloat(result.totalReturn))}
                      >
                        {formatPercent(result.totalReturn)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        color={getPerformanceColor(parseFloat(result.sharpeRatio), 1)}
                      >
                        {formatNumber(result.sharpeRatio)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(result.sortinoRatio)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        color={getPerformanceColor(-parseFloat(result.maxDrawdown), -20)}
                      >
                        {formatPercent(result.maxDrawdown)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {formatPercent(result.winRatio)}
                    </TableCell>
                    <TableCell align="right">
                      {result.totalTrades}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(result.profitFactor)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="textSecondary">
                        {new Date(result.startTime).getFullYear()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={totalResults}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Paper>
      )}

      {currentTab === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Return vs Sharpe Ratio Correlation
              </Typography>
              <Box sx={{ height: 300 }}>
                <Scatter 
                  data={prepareCorrelationChart()}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: false
                      }
                    },
                    scales: {
                      x: {
                        title: {
                          display: true,
                          text: 'Total Return (%)'
                        }
                      },
                      y: {
                        title: {
                          display: true,
                          text: 'Sharpe Ratio'
                        }
                      }
                    }
                  }}
                />
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Z-Score Threshold Distribution
              </Typography>
              <Box sx={{ height: 300 }}>
                <Bar
                  data={prepareParameterChart()}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: false
                      }
                    },
                    scales: {
                      x: {
                        title: {
                          display: true,
                          text: 'Z-Score Threshold'
                        }
                      },
                      y: {
                        title: {
                          display: true,
                          text: 'Frequency'
                        }
                      }
                    }
                  }}
                />
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {currentTab === 2 && (
        <Paper>
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Top Performing Parameter Sets
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
              Best performing parameters currently used in your live trading configuration
            </Typography>
          </Box>
          <Divider />
          
          {results.slice(0, 5).map((result, index) => (
            <Accordion key={result.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                  <Box display="flex" alignItems="center" gap={2}>
                    <Chip label={`#${index + 1}`} color="primary" size="small" />
                    <Typography fontWeight="medium">
                      {result.baseAsset}{result.quoteAsset}
                    </Typography>
                    <Chip 
                      label={`${formatPercent(result.totalReturn)} Return`} 
                      color="success" 
                      size="small" 
                    />
                  </Box>
                  <Typography variant="body2" color="textSecondary">
                    Sharpe: {formatNumber(result.sharpeRatio)}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="body2" color="textSecondary">Parameters</Typography>
                    <Typography variant="body1">
                      Z-Score: ≥{result.zScoreThreshold}<br/>
                      MA Period: {result.movingAverages}<br/>
                      Take Profit: {result.profitPercent}%<br/>
                      Stop Loss: {result.stopLossPercent}%
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="body2" color="textSecondary">Performance</Typography>
                    <Typography variant="body1">
                      Total Return: {formatPercent(result.totalReturn)}<br/>
                      Annualized: {formatPercent(result.annualizedReturn)}<br/>
                      Max Drawdown: {formatPercent(result.maxDrawdown)}<br/>
                      Win Rate: {formatPercent(result.winRatio)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="body2" color="textSecondary">Risk Metrics</Typography>
                    <Typography variant="body1">
                      Sharpe Ratio: {formatNumber(result.sharpeRatio)}<br/>
                      Sortino Ratio: {formatNumber(result.sortinoRatio)}<br/>
                      Alpha: {formatNumber(result.alpha)}<br/>
                      Profit Factor: {formatNumber(result.profitFactor)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Typography variant="body2" color="textSecondary">Trading Stats</Typography>
                    <Typography variant="body1">
                      Total Trades: {result.totalTrades}<br/>
                      Avg Duration: {formatNumber(result.avgTradeDuration)} hrs<br/>
                      Window Size: {result.backtestRun.windowSize} months<br/>
                      Test Period: {new Date(result.startTime).getFullYear()}
                    </Typography>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          ))}
        </Paper>
      )}

      {loading && (
        <LinearProgress sx={{ mt: 2 }} />
      )}
    </Box>
  );
};

export default OptimizationPage;