
import { TurboKlinesDownloader } from './getKlines-turbo';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

config();

async function main() {
  const pairsPath = path.join(process.cwd(), 'config', 'filtered-trading-pairs.json');
  if (!fs.existsSync(pairsPath)) {
    console.error('❌ Config file not found:', pairsPath);
    process.exit(1);
  }

  const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8'));
  const startDate = new Date('2021-11-29');
  const endDate = new Date('2025-11-29');
  const interval = '5m';

  console.log(`Starting bulk download for ${pairs.length} pairs from ${startDate.toISOString()} to ${endDate.toISOString()}...`);
  
  const downloader = new TurboKlinesDownloader(interval);
  await downloader.initialize();
  
  // TurboKlinesDownloader automatically resumes if progress file exists (.klines-progress.json)
  await downloader.downloadTurbo(pairs, startDate, endDate);
  
  await downloader.cleanup();
}

main().catch(console.error);
