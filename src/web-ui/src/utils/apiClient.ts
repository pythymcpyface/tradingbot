import axios from 'axios';

// Create axios instance with default configuration
export const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth tokens if needed
apiClient.interceptors.request.use(
  (config) => {
    // Add authorization token if available
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Log requests in development
    if (process.env.NODE_ENV === 'development') {
      console.log('API Request:', config.method?.toUpperCase(), config.url);
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors globally
apiClient.interceptors.response.use(
  (response) => {
    // Log successful responses in development
    if (process.env.NODE_ENV === 'development') {
      console.log('API Response:', response.status, response.config.url);
    }
    
    return response;
  },
  (error) => {
    // Handle common errors
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      
      switch (status) {
        case 401:
          // Unauthorized - redirect to login or clear auth
          localStorage.removeItem('authToken');
          console.error('Authentication failed');
          break;
        case 403:
          console.error('Access forbidden');
          break;
        case 404:
          console.error('Resource not found');
          break;
        case 500:
          console.error('Internal server error');
          break;
        default:
          console.error('API Error:', status, data?.error || data?.message);
      }
      
      // Return a standardized error format
      return Promise.reject({
        status,
        message: data?.error || data?.message || 'An error occurred',
        details: data
      });
    } else if (error.request) {
      // Network error
      console.error('Network error:', error.message);
      return Promise.reject({
        status: 0,
        message: 'Network error - please check your connection',
        details: error
      });
    } else {
      // Something else happened
      console.error('Request error:', error.message);
      return Promise.reject({
        status: -1,
        message: error.message,
        details: error
      });
    }
  }
);

// Utility functions for common API operations
export const api = {
  // Trading endpoints
  trading: {
    getStatus: () => apiClient.get('/api/trading/status'),
    start: (config: any) => apiClient.post('/api/trading/start', config),
    stop: () => apiClient.post('/api/trading/stop'),
    emergencyStop: () => apiClient.post('/api/trading/emergency-stop'),
    getSignals: (params?: any) => apiClient.get('/api/trading/signals', { params }),
    getZScores: (params?: any) => apiClient.get('/api/trading/z-scores', { params }),
    getCurrentPrices: (symbols?: string[]) => 
      apiClient.get('/api/trading/prices', { 
        params: symbols ? { symbols: symbols.join(',') } : undefined 
      }),
    getPositions: () => apiClient.get('/api/trading/positions'),
    placeOrder: (order: any) => apiClient.post('/api/trading/manual-order', order),
  },

  // Orders endpoints
  orders: {
    getAll: (params?: any) => apiClient.get('/api/orders', { params }),
    getStats: (params?: any) => apiClient.get('/api/orders/stats', { params }),
    getPortfolioValue: () => apiClient.get('/api/orders/portfolio-value'),
    create: (order: any) => apiClient.post('/api/orders', order),
    update: (orderId: string, data: any) => apiClient.put(`/api/orders/${orderId}`, data),
  },

  // Backtest endpoints
  backtest: {
    getAll: (params?: any) => apiClient.get('/api/backtest', { params }),
    run: (config: any) => apiClient.post('/api/backtest/run', config),
    runWindowed: (config: any) => apiClient.post('/api/backtest/windowed', config),
    getOrders: (runId: string) => apiClient.get(`/api/backtest/${runId}/orders`),
  },

  // Optimization endpoints
  optimization: {
    getAll: (params?: any) => apiClient.get('/api/optimisation', { params }),
    getBest: (params?: any) => apiClient.get('/api/optimisation/best', { params }),
    getStats: (params?: any) => apiClient.get('/api/optimisation/stats', { params }),
    getCorrelation: (params?: any) => apiClient.get('/api/optimisation/correlation', { params }),
    runFull: (config: any) => apiClient.post('/api/optimisation/run-full', config),
  },

  // Glicko endpoints
  glicko: {
    getRatings: (params?: any) => apiClient.get('/api/glicko/ratings', { params }),
    getLatest: (symbols?: string[]) => 
      apiClient.get('/api/glicko/latest', { 
        params: symbols ? { symbols: symbols.join(',') } : undefined 
      }),
    getZScores: (params?: any) => apiClient.get('/api/glicko/z-scores', { params }),
    calculate: (data: any) => apiClient.post('/api/glicko/calculate', data),
    getSymbols: () => apiClient.get('/api/glicko/symbols'),
    getHistory: (symbol: string, params?: any) => 
      apiClient.get(`/api/glicko/ratings/${symbol}/history`, { params }),
  },

  // Logs endpoints
  logs: {
    getRecent: (params?: any) => apiClient.get('/api/logs/recent', { params }),
    getByCategory: (category: string, params?: any) => 
      apiClient.get(`/api/logs/category/${category}`, { params }),
    getByLevel: (level: string, params?: any) => 
      apiClient.get(`/api/logs/level/${level}`, { params }),
    getCategories: () => apiClient.get('/api/logs/categories'),
    getStats: (params?: any) => apiClient.get('/api/logs/stats', { params }),
    // Note: stream endpoint should be used with EventSource, not axios
    getStreamUrl: (params?: any) => {
      const baseURL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
      const searchParams = new URLSearchParams(params);
      return `${baseURL}/api/logs/stream?${searchParams.toString()}`;
    },
  },

  // System endpoints
  system: {
    health: () => apiClient.get('/health'),
  }
};

export default apiClient;