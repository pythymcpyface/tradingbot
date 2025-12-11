
import axios from 'axios';
import { config } from 'dotenv';
import { TradingPairsGenerator } from './getTradingPairs';

config();

const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';
const FOUR_YEARS_AGO = new Date('2021-11-29').getTime();

async function wasTradingFourYearsAgo(symbol: string): Promise<boolean> {
  try {
    const response = await axios.get(BINANCE_API_URL, {
      params: {
        symbol: symbol,
        interval: '1M',
        startTime: FOUR_YEARS_AGO,
        limit: 1
      }
    });

    const klines = response.data;
    if (klines.length > 0) {
      const klineOpenTime = klines[0][0];
      // Check if the kline we got is actually around the time we asked for
      // (Binance returns the first available kline after startTime if none exist exactly at start time, 
      // but we want to ensure it existed *around* or *before* that time.
      // Actually, if we ask for startTime=X, and it returns a kline at X or slightly after X but still 4 years ago, it's valid.
      // If it returns a kline from 2023, then it wasn't trading in 2021.)
      
      // Let's just check if the returned kline time is before or equal to a reasonable buffer after our target.
      // Say, within 1 month of our target date?
      // Actually, if we simply ask for startTime 4 years ago, if the pair didn't exist then, the first kline returned will be the listing date (or close to it).
      // So we just need to check if the returned kline.openTime <= FOUR_YEARS_AGO + (a small buffer)
      // OR simpler: check if the returned kline is close to the target date.
      
      // If the pair listed in 2023, `startTime=2021` will return the first kline in 2023.
      // So we must check: klineOpenTime <= FOUR_YEARS_AGO + (30 days in ms)
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      return klineOpenTime <= (FOUR_YEARS_AGO + THIRTY_DAYS_MS);
    }
    return false;
  } catch (error) {
    // console.error(`Error checking ${symbol}:`, error.message);
    return false;
  }
}

async function main() {
  const generator = new TradingPairsGenerator();
  
  // Get coins from BASE_COINS
  const baseCoins = process.env.BASE_COINS;
  if (!baseCoins) {
    console.error('❌ Error: BASE_COINS not set in .env');
    process.exit(1);
  }
  const coins = baseCoins.split(',').map(c => c.trim());

  console.log('Getting current pairs...');
  // We need to strictly filter for pairs where BOTH assets are in our list.
  // The original generator allows quote to be a "major quote" even if not in list.
  // We should manually filter the generator's output to be strict.
  const allCurrentPairs = await generator.generateTradingPairs(coins);
  
  const detailedInfo = await generator.getDetailedPairInfo(allCurrentPairs);
  
  const strictPairs = detailedInfo.filter(p => {
    return coins.includes(p.baseAsset) && coins.includes(p.quoteAsset);
  }).map(p => p.symbol);

  console.log(`Found ${strictPairs.length} pairs where both assets are in the list.`);
  console.log('Checking which pairs were trading 4 years ago...');

  const oldPairs: string[] = [];
  const batchSize = 10;
  
  for (let i = 0; i < strictPairs.length; i += batchSize) {
    const batch = strictPairs.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async pair => {
      const exists = await wasTradingFourYearsAgo(pair);
      if (exists) return pair;
      return null;
    }));
    
    results.forEach(r => {
      if (r) oldPairs.push(r);
    });
    
    process.stdout.write(`\rProcessed ${Math.min(i + batchSize, strictPairs.length)}/${strictPairs.length} pairs... Found ${oldPairs.length} valid.`);
  }
  
  console.log('\n\n✅ Done.');
  console.log(`Total valid pairs (trading today AND 4 years ago): ${oldPairs.length}`);
  console.log(oldPairs.join(','));
}

main().catch(console.error);
