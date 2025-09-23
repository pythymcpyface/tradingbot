import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { RustCoreService } from './services/RustCoreService';
import { backtestRouter } from './routes/backtest';
import { ordersRouter } from './routes/orders';
import { optimisationRouter } from './routes/optimisation';
import { glickoRouter } from './routes/glicko';
import { tradingRouter } from './routes/trading';
import { logsRouter } from './routes/logs';

// Load environment variables
config();

const app = express();
const port = process.env.PORT || 3001;
const prisma = new PrismaClient();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for React app compatibility
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());

// Serve static files from React build (for production)
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '../web-ui/build');
  app.use(express.static(buildPath));
}

// Initialize Rust Core Service
const rustCore = new RustCoreService();

// Routes
app.use('/api/backtest', backtestRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/optimisation', optimisationRouter);
app.use('/api/glicko', glickoRouter);
app.use('/api/trading', tradingRouter);
app.use('/api/logs', logsRouter);

// Serve React app for all non-API routes (in production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    const buildPath = path.join(__dirname, '../web-ui/build', 'index.html');
    res.sendFile(buildPath);
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      rustCore: rustCore.isInitialized() ? 'ready' : 'initializing'
    }
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check available at http://localhost:${port}/health`);
});

export { app, prisma, rustCore };