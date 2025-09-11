import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography, 
  Paper, 
  Box, 
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
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
  Card,
  CardContent,
  Grid,
  Divider
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  SwapHoriz as SwapHorizIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { api } from '../utils/apiClient';

interface Order {
  id: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: string;
  price: string;
  stopPrice?: string;
  status: string;
  timeInForce: string;
  transactTime: string;
  fills?: Array<{
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
  }>;
  realizedPnl?: string;
  createdAt: string;
  updatedAt: string;
}

interface OrderStats {
  totalOrders: number;
  totalVolume: string;
  winRate: number;
  totalPnl: string;
  avgOrderSize: string;
  activeOrders: number;
}

const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalOrders, setTotalOrders] = useState(0);
  
  // Filters
  const [symbolFilter, setSymbolFilter] = useState('');
  const [sideFilter, setSideFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params: any = {
        offset: page * rowsPerPage,
        limit: rowsPerPage,
      };
      
      // Add filters
      if (symbolFilter) params.symbol = symbolFilter;
      if (sideFilter) params.side = sideFilter;
      if (statusFilter) params.status = statusFilter;
      if (startDate) params.startDate = startDate.toISOString();
      if (endDate) params.endDate = endDate.toISOString();
      
      const response = await api.orders.getAll(params);
      setOrders(response.data.orders || []);
      setTotalOrders(response.data.pagination?.total || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, symbolFilter, sideFilter, statusFilter, startDate, endDate]);

  const fetchStats = useCallback(async () => {
    try {
      const params: any = {};
      if (startDate) params.startDate = startDate.toISOString();
      if (endDate) params.endDate = endDate.toISOString();
      
      const response = await api.orders.getStats(params);
      setStats(response.data.summary);
    } catch (err: any) {
      console.error('Failed to fetch order stats:', err.message);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, [fetchOrders, fetchStats]);

  const handleRefresh = () => {
    fetchOrders();
    fetchStats();
  };

  const handleExport = async () => {
    try {
      const params: any = { export: true };
      if (symbolFilter) params.symbol = symbolFilter;
      if (sideFilter) params.side = sideFilter;
      if (statusFilter) params.status = statusFilter;
      if (startDate) params.startDate = startDate.toISOString();
      if (endDate) params.endDate = endDate.toISOString();

      const response = await api.orders.getAll(params);
      
      // Create CSV content
      const csvContent = [
        ['Order ID', 'Symbol', 'Side', 'Type', 'Quantity', 'Price', 'Status', 'Time', 'PnL'].join(','),
        ...response.data.orders.map((order: Order) => [
          order.orderId,
          order.symbol,
          order.side,
          order.type,
          order.quantity,
          order.price,
          order.status,
          new Date(order.transactTime).toLocaleString(),
          order.realizedPnl || '0'
        ].join(','))
      ].join('\n');

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `orders_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error('Failed to export orders:', err.message);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'FILLED': return 'success';
      case 'PARTIALLY_FILLED': return 'warning';
      case 'NEW': return 'info';
      case 'CANCELED': return 'default';
      case 'REJECTED': return 'error';
      default: return 'default';
    }
  };

  const getSideIcon = (side: string) => {
    return side === 'BUY' ? 
      <TrendingUpIcon color="success" fontSize="small" /> : 
      <TrendingDownIcon color="error" fontSize="small" />;
  };

  const formatPnl = (pnl: string | undefined) => {
    if (!pnl || pnl === '0') return '-';
    const value = parseFloat(pnl);
    const color = value >= 0 ? 'success.main' : 'error.main';
    return (
      <Typography variant="body2" color={color} fontWeight="medium">
        {value >= 0 ? '+' : ''}{value.toFixed(4)} USDT
      </Typography>
    );
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" component="h1" fontWeight="bold">
            Order History
          </Typography>
          <Box display="flex" gap={1}>
            <Tooltip title="Refresh data">
              <IconButton onClick={handleRefresh} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Export to CSV">
              <IconButton onClick={handleExport}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Statistics Cards */}
        {stats && (
          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} sm={6} md={2}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color="primary">
                    {stats.totalOrders}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Orders
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color="primary">
                    {stats.activeOrders}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Active Orders
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color={parseFloat(stats.totalPnl) >= 0 ? 'success.main' : 'error.main'}>
                    {parseFloat(stats.totalPnl) >= 0 ? '+' : ''}{parseFloat(stats.totalPnl).toFixed(2)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total PnL (USDT)
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color="primary">
                    {stats.winRate.toFixed(1)}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Win Rate
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color="primary">
                    ${parseFloat(stats.totalVolume).toLocaleString()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Volume
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Card>
                <CardContent>
                  <Typography variant="h6" color="primary">
                    ${parseFloat(stats.avgOrderSize).toFixed(0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Avg Order Size
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {/* Filters */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            Filters
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={2}>
              <TextField
                fullWidth
                label="Symbol"
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                placeholder="e.g., BTCUSDT"
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Side</InputLabel>
                <Select
                  value={sideFilter}
                  label="Side"
                  onChange={(e) => setSideFilter(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="BUY">Buy</MenuItem>
                  <MenuItem value="SELL">Sell</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="NEW">New</MenuItem>
                  <MenuItem value="FILLED">Filled</MenuItem>
                  <MenuItem value="PARTIALLY_FILLED">Partially Filled</MenuItem>
                  <MenuItem value="CANCELED">Canceled</MenuItem>
                  <MenuItem value="REJECTED">Rejected</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <DatePicker
                label="Start Date"
                value={startDate}
                onChange={(newValue) => setStartDate(newValue)}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={(newValue) => setEndDate(newValue)}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => {
                  setSymbolFilter('');
                  setSideFilter('');
                  setStatusFilter('');
                  setStartDate(null);
                  setEndDate(null);
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

        {/* Orders Table */}
        <Paper>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Order ID</TableCell>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Side</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell align="right">PnL</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <CircularProgress />
                    </TableCell>
                  </TableRow>
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography color="text.secondary">
                        No orders found
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <TableRow key={order.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontFamily="monospace">
                          {order.orderId.slice(0, 8)}...
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={order.symbol} size="small" />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          {getSideIcon(order.side)}
                          <Typography variant="body2" color={order.side === 'BUY' ? 'success.main' : 'error.main'}>
                            {order.side}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {order.type}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          {parseFloat(order.quantity).toFixed(6)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          ${parseFloat(order.price).toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={order.status} 
                          size="small" 
                          color={getStatusColor(order.status) as any}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {new Date(order.transactTime).toLocaleString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {formatPnl(order.realizedPnl)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          
          <TablePagination
            component="div"
            count={totalOrders}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(parseInt(event.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Paper>
      </Box>
    </LocalizationProvider>
  );
};

export default OrdersPage;