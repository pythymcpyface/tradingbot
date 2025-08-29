#!/usr/bin/env ts-node

/**
 * Quick script to finish remaining migration
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { Client } from 'pg';

config();

async function finishMigration() {
  const newDb = new PrismaClient();
  const oldDb = new Client({
    connectionString: process.env.OLD_DATABASE_URL
  });

  try {
    console.log('🔄 Connecting to databases...');
    await oldDb.connect();
    await newDb.$connect();

    // Get already migrated records to find offset
    const migratedCount = await newDb.klines.count();
    console.log(`📊 Already migrated: ${migratedCount.toLocaleString()} records`);

    // Get remaining records
    const batchSize = 10000;
    let offset = migratedCount;

    while (true) {
      const result = await oldDb.query(`
        SELECT 
          symbol,
          "openTime",
          "closeTime",
          open,
          high,
          low,
          close,
          volume,
          "quoteAssetVolume",
          "takerBuyBaseAssetVolume",
          "takerBuyQuoteAssetVolume",
          "takerSellBaseAssetVolume"
        FROM klines
        ORDER BY symbol, "openTime"
        LIMIT $1 OFFSET $2
      `, [batchSize, offset]);

      if (result.rows.length === 0) {
        break;
      }

      const transformedData = result.rows.map((row: any) => ({
        symbol: row.symbol,
        openTime: new Date(row.openTime),
        closeTime: new Date(row.closeTime),
        open: parseFloat(row.open.toString()),
        high: parseFloat(row.high.toString()),
        low: parseFloat(row.low.toString()),
        close: parseFloat(row.close.toString()),
        volume: parseFloat(row.volume.toString()),
        quoteAssetVolume: parseFloat(row.quoteAssetVolume.toString()),
        numberOfTrades: 0, // Default since not in old schema
        takerBuyBaseAssetVolume: parseFloat(row.takerBuyBaseAssetVolume.toString()),
        takerBuyQuoteAssetVolume: parseFloat(row.takerBuyQuoteAssetVolume.toString()),
        ignore: parseFloat(row.takerSellBaseAssetVolume.toString())
      }));

      await newDb.klines.createMany({
        data: transformedData,
        skipDuplicates: true
      });

      offset += result.rows.length;
      const progress = (offset / 1282846 * 100).toFixed(1);
      console.log(`📈 Progress: ${progress}% (${offset.toLocaleString()}/1,282,846)`);
    }

    console.log('✅ Migration completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await newDb.$disconnect();
    await oldDb.end();
  }
}

finishMigration().catch(console.error);