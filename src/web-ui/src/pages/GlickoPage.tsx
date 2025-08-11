import React from 'react';
import { Typography, Paper, Box } from '@mui/material';

const GlickoPage: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
        Glicko-2 Ratings
      </Typography>
      
      <Paper sx={{ p: 3 }}>
        <Typography variant="body1">
          Glicko-2 ratings visualization coming soon. This page will display:
        </Typography>
        <ul>
          <li>Real-time Glicko-2 ratings for all tracked cryptocurrencies</li>
          <li>Historical rating charts with uncertainty bands</li>
          <li>Z-score calculations and signal generation</li>
          <li>Rating correlation analysis between assets</li>
          <li>Performance score breakdowns (price + volume components)</li>
        </ul>
      </Paper>
    </Box>
  );
};

export default GlickoPage;