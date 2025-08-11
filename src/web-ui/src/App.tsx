import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, Container } from '@mui/material';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import TradingPage from './pages/TradingPage';
import BacktestPage from './pages/BacktestPage';
import OptimizationPage from './pages/OptimizationPage';
import GlickoPage from './pages/GlickoPage';
import OrdersPage from './pages/OrdersPage';

function App() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navigation />
      <Container maxWidth="xl" sx={{ mt: 3, mb: 3, flex: 1 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trading" element={<TradingPage />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="/optimization" element={<OptimizationPage />} />
          <Route path="/glicko" element={<GlickoPage />} />
          <Route path="/orders" element={<OrdersPage />} />
        </Routes>
      </Container>
    </Box>
  );
}

export default App;