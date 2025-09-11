import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/apiClient';
import { usePriceWebSocket } from './usePriceWebSocket';

interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice?: number;
  value?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
}

interface PortfolioSummary {
  totalValue: number;
  totalInvested: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPercent: number;
  dayChange: number;
  dayChangePercent: number;
  positions: Position[];
  lastUpdated: Date;
}

interface UsePortfolioValueReturn {
  portfolio: PortfolioSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  isRealTime: boolean;
}

export const usePortfolioValue = (): UsePortfolioValueReturn => {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basePortfolio, setBasePortfolio] = useState<PortfolioSummary | null>(null);
  
  const { prices, isConnected } = usePriceWebSocket();

  const fetchPortfolioData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch current positions from trading API
      const positionsResponse = await api.trading.getPositions();
      const positions = positionsResponse.data.positions || [];

      // Get symbols for price fetching (exclude USDT since it's always $1)
      const symbols = positions
        .filter((pos: any) => pos.asset !== 'USDT' && pos.quantity > 0)
        .map((pos: any) => pos.symbol);
      
      // Fetch current prices for all positions
      let currentPrices: { [symbol: string]: number } = {};
      if (symbols.length > 0) {
        try {
          // Get all prices and filter for our symbols since selective fetching has issues
          const pricesResponse = await api.trading.getCurrentPrices();
          const allPrices = pricesResponse.data.prices || {};
          
          // Extract only the prices we need
          symbols.forEach((symbol: string) => {
            if (allPrices[symbol]) {
              currentPrices[symbol] = allPrices[symbol];
            }
          });
        } catch (error) {
          console.warn('Failed to fetch current prices, using avgPrice fallback');
        }
      }

      // Calculate total value from actual account balances (including USDT cash)
      let totalValue = 0;
      let totalInvested = 0;
      
      // Add up all asset values including cash (USDT)
      for (const pos of positions) {
        let currentPrice = pos.avgPrice || 1;
        
        // Use current market price if available
        if (pos.asset === 'USDT') {
          currentPrice = 1; // USDT is always $1
        } else if (currentPrices[pos.symbol]) {
          currentPrice = currentPrices[pos.symbol];
        }
        
        const value = pos.quantity * currentPrice;
        totalValue += value;
        
        // Only count non-USDT positions as "invested"
        if (pos.asset !== 'USDT') {
          totalInvested += pos.quantity * pos.avgPrice;
        }
        
        // Update position with current price
        pos.currentPrice = currentPrice;
      }

      const portfolioSummary: PortfolioSummary = {
        totalValue,
        totalInvested,
        totalUnrealizedPnl: 0,
        totalUnrealizedPnlPercent: 0,
        dayChange: 0,
        dayChangePercent: 0,
        positions: positions.map((pos: any) => ({
          symbol: pos.symbol,
          quantity: pos.quantity,
          avgPrice: pos.avgPrice,
          currentPrice: pos.currentPrice,
          value: pos.quantity * (pos.currentPrice || pos.avgPrice),
          unrealizedPnl: pos.quantity * ((pos.currentPrice || pos.avgPrice) - pos.avgPrice),
          unrealizedPnlPercent: pos.avgPrice > 0 ? 
            (((pos.currentPrice || pos.avgPrice) - pos.avgPrice) / pos.avgPrice) * 100 : 0
        })),
        lastUpdated: new Date()
      };

      // Calculate totals
      portfolioSummary.totalUnrealizedPnl = portfolioSummary.positions.reduce(
        (sum, pos) => sum + (pos.unrealizedPnl || 0), 0
      );
      
      if (portfolioSummary.totalInvested > 0) {
        portfolioSummary.totalUnrealizedPnlPercent = 
          (portfolioSummary.totalUnrealizedPnl / portfolioSummary.totalInvested) * 100;
      }

      setBasePortfolio(portfolioSummary);
      setPortfolio(portfolioSummary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch portfolio data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Update portfolio with real-time prices
  const updatePortfolioWithLivePrices = useCallback(() => {
    if (!basePortfolio || !isConnected) return;
    
    // Don't update if we don't have any meaningful price data
    if (Object.keys(prices).length === 0) return;

    const updatedPositions = basePortfolio.positions.map(position => {
      const priceData = prices[position.symbol];
      let currentPrice: number;
      
      // Handle USDT specially - always $1
      if (position.symbol.includes('USDT') && position.symbol.endsWith('USDT') && position.symbol === 'USDTUSDT') {
        currentPrice = 1;
      } else if (priceData) {
        currentPrice = parseFloat(priceData.price);
      } else {
        currentPrice = position.avgPrice || 1; // Fallback for missing prices
      }
      
      const value = position.quantity * currentPrice;
      const unrealizedPnl = position.quantity * (currentPrice - (position.avgPrice || currentPrice));
      const unrealizedPnlPercent = (position.avgPrice && position.avgPrice > 0) ? 
        ((currentPrice - position.avgPrice) / position.avgPrice) * 100 : 0;

      return {
        ...position,
        currentPrice,
        value,
        unrealizedPnl,
        unrealizedPnlPercent
      };
    });

    const totalValue = updatedPositions.reduce((sum, pos) => sum + pos.value, 0);
    const totalUnrealizedPnl = updatedPositions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    const totalUnrealizedPnlPercent = basePortfolio.totalInvested > 0 ? 
      (totalUnrealizedPnl / basePortfolio.totalInvested) * 100 : 0;

    // Debug logging
    console.log('Portfolio live update:', {
      totalValue,
      basePortfolioValue: basePortfolio.totalValue,
      usdtPosition: updatedPositions.find(p => p.symbol === 'USDTUSDT'),
      priceDataKeys: Object.keys(prices)
    });

    setPortfolio({
      ...basePortfolio,
      totalValue,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent,
      positions: updatedPositions,
      lastUpdated: new Date()
    });
  }, [basePortfolio, prices, isConnected]);

  // Initial fetch
  useEffect(() => {
    fetchPortfolioData();
  }, [fetchPortfolioData]);

  // Subscribe to price updates for portfolio symbols
  useEffect(() => {
    if (basePortfolio) {
      const symbols = basePortfolio.positions.map(pos => pos.symbol);
      // Subscribe to price updates (handled automatically by the WebSocket hook)
    }
  }, [basePortfolio]);

  // Update portfolio when prices change - TEMPORARILY DISABLED FOR DEBUGGING
  // useEffect(() => {
  //   updatePortfolioWithLivePrices();
  // }, [updatePortfolioWithLivePrices]);

  // Auto-refresh portfolio data every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchPortfolioData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchPortfolioData]);

  return {
    portfolio,
    loading,
    error,
    refresh: fetchPortfolioData,
    isRealTime: isConnected
  };
};