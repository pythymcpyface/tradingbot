#!/bin/bash

# Start Trading-Only Environment
# Runs: Database + Live Trading Engine (No Web Interface)

echo "🎯 Starting Trading Bot Production Environment..."
echo "================================================="

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "📝 Copy env.example to .env and configure your API keys:"
    echo "   cp env.example .env"
    echo "   # Then edit .env with your Binance API credentials"
    exit 1
fi

# Warning for live trading
echo "⚠️  LIVE TRADING WARNING ⚠️"
echo "This will start the live trading engine with real money!"
echo "Make sure TRADING_MODE and API keys are configured correctly."
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Aborted"
    exit 1
fi

# Start trading services
echo "🐳 Starting trading containers..."
docker-compose -f docker-compose.trading.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

echo "✅ Trading engine started!"
echo ""
echo "📊 Monitor Trading:"
echo "   Live logs:     docker-compose -f docker-compose.trading.yml logs -f trading-engine"
echo "   All logs:      docker-compose -f docker-compose.trading.yml logs -f"
echo "   Status:        docker-compose -f docker-compose.trading.yml ps"
echo ""
echo "🛑 Stop Trading:"
echo "   Emergency:     docker-compose -f docker-compose.trading.yml stop trading-engine"
echo "   Full stop:     docker-compose -f docker-compose.trading.yml down"
echo ""
echo "💰 Trading engine is now running with your configured parameters!"
echo "📈 Monitor your Binance account for trading activity."