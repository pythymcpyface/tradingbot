import React from 'react';
import { Box, Typography } from '@mui/material';

function SimpleApp() {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Glicko-2 Trading Bot Dashboard
      </Typography>
      <Typography variant="body1">
        Welcome to the trading bot dashboard. The backend API is running and ready to serve your Binance account history.
      </Typography>
      <Box sx={{ mt: 2 }}>
        <Typography variant="h6">Quick Links:</Typography>
        <ul>
          <li>API Health: <a href="http://localhost:3000/health" target="_blank" rel="noopener noreferrer">http://localhost:3000/health</a></li>
          <li>Orders API: <a href="http://localhost:3000/api/orders" target="_blank" rel="noopener noreferrer">http://localhost:3000/api/orders</a></li>
          <li>Trading Status: <a href="http://localhost:3000/api/trading/status" target="_blank" rel="noopener noreferrer">http://localhost:3000/api/trading/status</a></li>
        </ul>
      </Box>
    </Box>
  );
}

export default SimpleApp;