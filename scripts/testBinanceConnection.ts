#!/usr/bin/env ts-node

/**
 * Test Binance API Connection
 * This script tests your Binance API credentials and permissions
 */

import { config } from 'dotenv';
import Binance from 'binance-api-node';

config();

async function testBinanceConnection() {
  console.log('🔧 Testing Binance API Connection...');
  console.log('=' .repeat(50));
  
  // Check environment variables
  console.log('📋 Environment Check:');
  console.log(`   API Key: ${process.env.BINANCE_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   API Secret: ${process.env.BINANCE_API_SECRET ? '✅ Set' : '❌ Missing'}`);
  console.log(`   Testnet: ${process.env.BINANCE_TESTNET || 'false'}`);
  
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    console.error('❌ Missing API credentials in .env file');
    process.exit(1);
  }
  
  // Create Binance client
  const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    httpBase: process.env.BINANCE_TESTNET === 'true' ? 'https://testnet.binance.vision' : undefined,
  });
  
  console.log('\n🔍 Testing API Endpoints...');
  
  // Test 1: Server Time (no authentication needed)
  try {
    const serverTime = await client.time();
    console.log('✅ Server Time:', new Date(serverTime));
  } catch (error) {
    console.error('❌ Server Time Test Failed:', (error as Error).message);
    return;
  }
  
  // Test 2: Ping (no authentication needed)
  try {
    await client.ping();
    console.log('✅ Ping: Connection successful');
  } catch (error) {
    console.error('❌ Ping Test Failed:', (error as Error).message);
    return;
  }
  
  // Test 3: Account Info (requires authentication and permissions)
  try {
    console.log('\n💰 Testing Account Access...');
    const account = await client.accountInfo();
    console.log('✅ Account Info: Access successful');
    console.log(`   Account Type: ${account.accountType}`);
    console.log(`   Can Trade: ${account.canTrade}`);
    console.log(`   Can Withdraw: ${account.canWithdraw}`);
    console.log(`   Can Deposit: ${account.canDeposit}`);
    
    // Show USDT balance
    const usdtBalance = account.balances.find(b => b.asset === 'USDT');
    if (usdtBalance) {
      console.log(`   USDT Balance: ${usdtBalance.free} (Available: ${usdtBalance.free})`);
      
      const availableUsdt = parseFloat(usdtBalance.free);
      if (availableUsdt >= 50) {
        console.log('✅ Sufficient balance for trading');
      } else if (availableUsdt > 0) {
        console.log('⚠️ Low balance - consider adding more USDT');
      } else {
        console.log('❌ No USDT available for trading');
      }
    }
    
  } catch (error: any) {
    console.error('❌ Account Info Test Failed:', (error as Error).message);
    console.error('   This usually means:');
    console.error('   1. API key/secret is incorrect');
    console.error('   2. API key lacks trading permissions');
    console.error('   3. IP restriction is blocking your connection');
    console.error('   4. API key is disabled or expired');
    return;
  }
  
  // Test 4: Exchange Info (check if we can access trading pairs)
  try {
    console.log('\n📊 Testing Market Data Access...');
    const exchangeInfo = await client.exchangeInfo();
    const btcSymbol = exchangeInfo.symbols.find(s => s.symbol === 'BTCUSDT');
    if (btcSymbol) {
      console.log(`✅ Market Data: BTCUSDT status is ${btcSymbol.status}`);
    }
  } catch (error) {
    console.error('❌ Market Data Test Failed:', (error as Error).message);
  }
  
  // Test 5: Check current prices
  try {
    const prices = await client.prices();
    const btcPrice = prices.BTCUSDT;
    console.log(`✅ Price Data: BTC price is $${parseFloat(btcPrice).toLocaleString()}`);
  } catch (error) {
    console.error('❌ Price Data Test Failed:', (error as Error).message);
  }
  
  console.log('\n✅ API Connection Test Complete!');
  console.log('   Your Binance API is working correctly.');
  console.log('   You can now run: npm run startLiveTrading');
}

// Check what your current IP is
async function checkPublicIP() {
  try {
    console.log('\n🌐 Your Current IP Address:');
    // Note: In a real environment, you might want to check your public IP
    console.log('   Check your IP at: https://whatismyipaddress.com');
    console.log('   Make sure this IP is whitelisted in your Binance API settings');
  } catch (error) {
    console.log('   Could not determine public IP automatically');
  }
}

// Run the tests
async function main() {
  try {
    await testBinanceConnection();
    await checkPublicIP();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}