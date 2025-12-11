#!/bin/bash
echo "--- Recent Retries ---"
grep "Retrying" download_klines.log | tail -n 10
echo ""
echo "--- Recent Gaps Filled ---"
grep "Retry result" download_klines.log | tail -n 10
