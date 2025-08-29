#!/bin/bash

# Download Remaining Pairs Script
# Downloads all missing pairs in parallel with proper launch dates

echo "🚀 Starting parallel download of remaining missing pairs..."

# POL pairs (launched 2024-09-13)
echo "📥 Starting POL pairs (launched 2024-09-13)..."
nohup npm run getKlines "POLBNB" "2024-09-13" "2025-07-19" "5m" > polbnb_download.log 2>&1 &
nohup npm run getKlines "POLBTC" "2024-09-13" "2025-07-19" "5m" > polbtc_download.log 2>&1 &
nohup npm run getKlines "POLETH" "2024-09-13" "2025-07-19" "5m" > poleth_download.log 2>&1 &
nohup npm run getKlines "POLUSDT" "2024-09-13" "2025-07-19" "5m" > polusdt_download.log 2>&1 &

# 2022-11-27 launched pairs
echo "📥 Starting 2022-11-27 pairs..."
nohup npm run getKlines "SOLETH" "2022-11-27" "2025-07-19" "5m" > soleth_download.log 2>&1 &
nohup npm run getKlines "TRXETH" "2022-11-27" "2025-07-19" "5m" > trxeth_download.log 2>&1 &
nohup npm run getKlines "TRXUSDT" "2022-11-27" "2025-07-19" "5m" > trxusdt_download.log 2>&1 &
nohup npm run getKlines "TRXXRP" "2022-11-27" "2025-07-19" "5m" > trxxrp_download.log 2>&1 &
nohup npm run getKlines "XLMBTC" "2022-11-27" "2025-07-19" "5m" > xlmbtc_download.log 2>&1 &

# Fill remaining data for LINKETH (from where it stopped)
echo "📥 Completing LINKETH from 2021-12-11..."
nohup npm run getKlines "LINKETH" "2021-12-11" "2025-07-19" "5m" > linketh_complete.log 2>&1 &

echo "✅ All downloads started in background. Check logs for progress:"
echo "  - POL pairs: polbnb_download.log, polbtc_download.log, poleth_download.log, polusdt_download.log"
echo "  - Other pairs: soleth_download.log, trxeth_download.log, trxusdt_download.log, trxxrp_download.log, xlmbtc_download.log"
echo "  - LINKETH completion: linketh_complete.log"

echo ""
echo "🔍 Monitor progress with:"
echo "  tail -f polbnb_download.log"
echo "  ps aux | grep getKlines"
echo ""
echo "📊 Check database progress with:"
echo "  npx ts-node scripts/check-klines-summary.ts"