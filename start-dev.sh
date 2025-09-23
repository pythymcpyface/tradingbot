#!/bin/bash

# Start Full Development Environment
# Runs: Database + API Server + Web Interface

echo "🚀 Starting Trading Bot Development Environment..."
echo "=================================================="

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "📝 Copy env.example to .env and configure your API keys:"
    echo "   cp env.example .env"
    echo "   # Then edit .env with your Binance API credentials"
    exit 1
fi

# Start database and API only (webapp takes too long to build)
echo "🐳 Starting Database and API..."
docker-compose -f docker-compose.full.yml up postgres api -d

# Wait for services to be ready and check health
echo "⏳ Waiting for services to start..."
sleep 10

# Wait for API to be healthy
echo "🔍 Checking API health..."
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ API is healthy!"
        break
    fi
    echo "   Waiting for API... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "❌ API failed to start properly"
    exit 1
fi

# Start webapp locally (faster than container build)
echo "🌐 Starting React Web Interface locally..."
cd src/web-ui
PORT=3003 REACT_APP_API_URL=http://localhost:3000 npm start > /dev/null 2>&1 &
WEBAPP_PID=$!
cd ../..

# Save webapp PID for cleanup
echo $WEBAPP_PID > .webapp.pid

# Wait a moment for webapp to initialize
sleep 5

# Start live trading engine
echo "🤖 Starting Live Trading Engine..."
npm exec ts-node scripts/startLiveTrading.ts > ./logs/trading-$(date +%Y%m%d_%H%M%S).log 2>&1 &
TRADING_PID=$!

# Save trading PID for cleanup
echo $TRADING_PID > .trading.pid

echo "📊 Live trading engine started (PID: $TRADING_PID)"
echo "📄 Trading logs: ./logs/trading-$(date +%Y%m%d_%H%M%S).log"

echo "✅ Services started!"
echo ""
echo "🌐 Access Points:"
echo "   Web Interface: http://localhost:3003"
echo "   API Server:    http://localhost:3000/health"
echo "   Database:      localhost:5437"
echo ""
echo "📋 Useful Commands:"
echo "   View API logs:     docker-compose -f docker-compose.full.yml logs -f api"
echo "   View trading logs: tail -f ./logs/trading-*.log"
echo "   Stop all services: docker-compose -f docker-compose.full.yml down && kill \$(cat .webapp.pid .trading.pid 2>/dev/null || echo 0)"
echo "   Restart:           ./start-dev.sh"
echo ""
echo "🎯 Happy Trading!"