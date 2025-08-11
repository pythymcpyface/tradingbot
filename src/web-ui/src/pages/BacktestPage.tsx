import React from 'react';
import { Typography, Paper, Box } from '@mui/material';

const BacktestPage: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
        Backtest Results
      </Typography>
      
      <Paper sx={{ p: 3 }}>
        <Typography variant="body1">
          Backtest functionality coming soon. This page will display:
        </Typography>
        <ul>
          <li>Historical backtest results with performance metrics</li>
          <li>Equity curves and drawdown charts</li>
          <li>Trade-by-trade analysis</li>
          <li>Risk metrics (Sharpe, Sortino, Alpha, etc.)</li>
          <li>Parameter comparison tools</li>
        </ul>
      </Paper>
    </Box>
  );
};

export default BacktestPage;