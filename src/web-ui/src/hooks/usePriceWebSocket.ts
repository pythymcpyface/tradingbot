import { useEffect, useState, useRef, useCallback } from 'react';

interface PriceData {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  timestamp: number;
}

interface UsePriceWebSocketReturn {
  prices: Record<string, PriceData>;
  isConnected: boolean;
  error: string | null;
  subscribe: (symbols: string[]) => void;
  unsubscribe: (symbols: string[]) => void;
  reconnect: () => void;
}

export const usePriceWebSocket = (): UsePriceWebSocketReturn => {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second

  const connect = useCallback(() => {
    try {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Binance WebSocket endpoint for 24hr ticker statistics
      const wsUrl = 'wss://stream.binance.com:9443/ws/!ticker@arr';
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('Binance WebSocket connected');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle array of ticker data
          if (Array.isArray(data)) {
            const priceUpdates: Record<string, PriceData> = {};
            
            data.forEach((ticker: any) => {
              // Only process subscribed symbols or popular USDT pairs
              if (subscribedSymbolsRef.current.has(ticker.s) || 
                  ticker.s.endsWith('USDT')) {
                priceUpdates[ticker.s] = {
                  symbol: ticker.s,
                  price: ticker.c, // Close price
                  priceChange: ticker.P, // Price change percent
                  priceChangePercent: ticker.P,
                  volume: ticker.v, // Volume
                  timestamp: Date.now()
                };
              }
            });

            if (Object.keys(priceUpdates).length > 0) {
              setPrices(prev => ({ ...prev, ...priceUpdates }));
            }
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('Binance WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        
        // Attempt to reconnect unless explicitly closed
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
          console.log(`Attempting to reconnect in ${delay}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError('Maximum reconnection attempts reached. Please refresh the page.');
        }
      };

      wsRef.current.onerror = (event) => {
        console.error('Binance WebSocket error:', event);
        setError('WebSocket connection error. Retrying...');
      };

    } catch (err: any) {
      console.error('Failed to connect to Binance WebSocket:', err);
      setError(`Connection failed: ${err.message}`);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Component unmounting');
      wsRef.current = null;
    }
    
    setIsConnected(false);
  }, []);

  const subscribe = useCallback((symbols: string[]) => {
    symbols.forEach(symbol => {
      subscribedSymbolsRef.current.add(symbol.toUpperCase());
    });
    
    // Note: Binance ticker stream doesn't require subscription messages
    // It automatically sends data for all symbols
  }, []);

  const unsubscribe = useCallback((symbols: string[]) => {
    symbols.forEach(symbol => {
      subscribedSymbolsRef.current.delete(symbol.toUpperCase());
      setPrices(prev => {
        const newPrices = { ...prev };
        delete newPrices[symbol.toUpperCase()];
        return newPrices;
      });
    });
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setError(null);
    disconnect();
    setTimeout(connect, 1000);
  }, [connect, disconnect]);

  // Initialize connection on mount
  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    prices,
    isConnected,
    error,
    subscribe,
    unsubscribe,
    reconnect
  };
};