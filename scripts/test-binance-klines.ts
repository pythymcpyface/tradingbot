#!/usr/bin/env ts-node

/**
 * Test direct Binance API klines access
 */

import { config } from 'dotenv';
import Binance from 'binance-api-node';

config();

async function testBinanceKlines() {
  console.log('🧪 Testing Binance API klines access...');
  
  try {
    // Create client
    const client = Binance({
      apiKey: process.env.BINANCE_API_KEY!,
      apiSecret: process.env.BINANCE_API_SECRET!,
      httpBase: process.env.BINANCE_TESTNET === 'true' ? 'https://testnet.binance.vision' : undefined
    });

    console.log('📡 Testing API connection...');
    await client.ping();
    console.log('✅ Ping successful');

    console.log('📊 Fetching BTCUSDT klines...');
    const klines = await client.candles({
      symbol: 'BTCUSDT',
      interval: '5m',
      limit: 10
    });

    console.log(`📈 Got ${(klines as any[]).length} klines`);
    console.log('🔍 First kline:', (klines as any[])[0]);
    console.log('🔍 Kline structure:', {
      isArray: Array.isArray((klines as any[])[0]),
      length: (klines as any[])[0]?.length,
      values: (klines as any[])[0]
    });

    // Process one kline
    if ((klines as any[]).length > 0) {
      const kline = (klines as any[])[0];
      const processed = {
        openTime: new Date(kline.openTime),
        open: parseFloat(kline.open),
        high: parseFloat(kline.high),
        low: parseFloat(kline.low),
        close: parseFloat(kline.close),
        volume: parseFloat(kline.volume),
        closeTime: new Date(kline.closeTime)
      };
      
      console.log('✅ Processed kline:', processed);
      
      // Validate
      if (!isNaN(processed.close) && processed.close > 0) {
        console.log('✅ Data validation passed');
      } else {
        console.log('❌ Data validation failed');
      }
    }

    console.log('\n🧪 Testing without API keys...');
    
    // Test without API keys (public endpoints)
    const publicClient = Binance();
    const publicKlines = await publicClient.candles({
      symbol: 'BTCUSDT',
      interval: '5m',
      limit: 5
    });
    
    console.log(`📈 Public API: Got ${publicKlines.length} klines`);
    console.log('🔍 Public kline:', publicKlines[0]);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

if (require.main === module) {
  testBinanceKlines().catch(console.error);
}