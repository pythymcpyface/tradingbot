#!/usr/bin/env ts-node

/**
 * Simple Binance API Test - Bypass potential regional restrictions
 */

import { config } from 'dotenv';
import * as crypto from 'crypto';
import fetch from 'node-fetch';

config();

function createSignature(query: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

async function testBinanceSimple() {
  console.log('🔧 Simple Binance API Test...');
  
  const apiKey = process.env.BINANCE_API_KEY!;
  const apiSecret = process.env.BINANCE_API_SECRET!;
  
  if (!apiKey || !apiSecret) {
    console.error('❌ Missing API credentials');
    return;
  }
  
  console.log('✅ API Key loaded:', apiKey.substring(0, 8) + '...');
  
  try {
    // Test 1: Public endpoint (no auth needed)
    console.log('\n📊 Testing public market data...');
    const publicResponse = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const publicData: any = await publicResponse.json();
    
    if (publicData.price) {
      console.log(`✅ Public API: BTC price is $${parseFloat(publicData.price).toLocaleString()}`);
    } else {
      console.error('❌ Public API failed:', publicData);
      return;
    }
    
    // Test 2: Account endpoint (requires auth)
    console.log('\n💰 Testing account access...');
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = createSignature(queryString, apiSecret);
    
    const accountResponse = await fetch(
      `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );
    
    const accountData: any = await accountResponse.json();
    
    if (accountData.accountType) {
      console.log('✅ Account API: Success!');
      console.log(`   Account Type: ${accountData.accountType}`);
      console.log(`   Can Trade: ${accountData.canTrade}`);
      
      // Find USDT balance
      const usdtBalance = accountData.balances?.find((b: any) => b.asset === 'USDT');
      if (usdtBalance) {
        console.log(`   USDT Balance: $${parseFloat(usdtBalance.free).toFixed(2)}`);
      }
      
      console.log('\n🎉 SUCCESS! Your API is working correctly.');
      console.log('   You can now run: npm run startLiveTrading');
      
    } else {
      console.error('❌ Account API failed:', accountData);
      
      if (accountData.code === -2015) {
        console.error('   This is the same "Invalid API-key" error as before');
        console.error('   Possible solutions:');
        console.error('   1. Wait 15 minutes for API changes to propagate');
        console.error('   2. Create a completely new API key');
        console.error('   3. Check if your account has any restrictions');
      }
    }
    
  } catch (error) {
    console.error('❌ Network error:', (error as Error).message);
  }
}

testBinanceSimple().catch(console.error);