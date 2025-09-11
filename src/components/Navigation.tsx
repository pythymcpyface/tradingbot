import React from 'react';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Button, 
  Box,
  IconButton,
  Menu,
  MenuItem 
} from '@mui/material';
import { 
  Dashboard as DashboardIcon,
  TrendingUp as TradingIcon,
  Assessment as BacktestIcon,
  TuneIcon,
  ShowChart as GlickoIcon,
  Receipt as OrdersIcon,
  AccountCircle,
  MoreVert as MoreIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

const Navigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const navItems = [
    { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
    { label: 'Trading', path: '/trading', icon: <TradingIcon /> },
    { label: 'Backtest', path: '/backtest', icon: <BacktestIcon /> },
    { label: 'Optimization', path: '/optimization', icon: <TuneIcon /> },
    { label: 'Glicko Ratings', path: '/glicko', icon: <GlickoIcon /> },
    { label: 'Orders', path: '/orders', icon: <OrdersIcon /> },
  ];

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  return (
    <AppBar position="static" elevation={2}>
      <Toolbar>
        <Typography 
          variant="h6" 
          component="div" 
          sx={{ 
            flexGrow: 1, 
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
          onClick={() => navigate('/')}
        >
          Glicko-2 Trading Bot
        </Typography>

        {/* Desktop Navigation */}
        <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}>
          {navItems.map((item) => (
            <Button
              key={item.path}
              color="inherit"
              startIcon={item.icon}
              onClick={() => navigate(item.path)}
              variant={location.pathname === item.path ? 'outlined' : 'text'}
              sx={{ 
                minWidth: 120,
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                }
              }}
            >
              {item.label}
            </Button>
          ))}
        </Box>

        {/* Mobile Navigation */}
        <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
          <IconButton
            size="large"
            aria-label="account of current user"
            aria-controls="menu-appbar"
            aria-haspopup="true"
            onClick={handleMenuOpen}
            color="inherit"
          >
            <MoreIcon />
          </IconButton>
          <Menu
            id="menu-appbar"
            anchorEl={anchorEl}
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            keepMounted
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
          >
            {navItems.map((item) => (
              <MenuItem 
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  handleMenuClose();
                }}
                selected={location.pathname === item.path}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {item.icon}
                  {item.label}
                </Box>
              </MenuItem>
            ))}
          </Menu>
        </Box>

        {/* User Menu */}
        <IconButton
          size="large"
          edge="end"
          color="inherit"
          sx={{ ml: 2 }}
        >
          <AccountCircle />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
};

export default Navigation;