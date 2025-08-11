#!/bin/bash

# Database Setup and Migration Script for Glicko-2 Trading Bot
# This script sets up the new PostgreSQL database and migrates existing data

set -e  # Exit on any error

echo "🚀 Setting up Glicko-2 Trading Bot Database"
echo "==========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    print_status "Checking requirements..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
    
    print_success "All requirements satisfied"
}

# Create .env file if it doesn't exist
setup_environment() {
    print_status "Setting up environment configuration..."
    
    if [ ! -f .env ]; then
        print_warning ".env file not found, creating from example..."
        cp .env.example .env
        
        echo ""
        print_warning "IMPORTANT: Please edit the .env file and configure:"
        print_warning "  - OLD_DATABASE_URL (your existing database connection)"
        print_warning "  - BINANCE_API_KEY and BINANCE_API_SECRET"
        print_warning "  - Other trading parameters as needed"
        echo ""
        
        read -p "Press Enter after you have configured the .env file..."
    else
        print_success ".env file already exists"
    fi
}

# Start PostgreSQL with Docker
start_database() {
    print_status "Starting PostgreSQL database..."
    
    # Check if container is already running
    if docker ps -q -f name=tradingbot-postgres | grep -q .; then
        print_warning "PostgreSQL container is already running"
    else
        # Start the database container
        docker-compose up -d postgres
        
        print_status "Waiting for PostgreSQL to be ready..."
        
        # Wait for PostgreSQL to be ready
        for i in {1..30}; do
            if docker exec tradingbot-postgres pg_isready -U tradingbot -d tradingbot_glicko &> /dev/null; then
                print_success "PostgreSQL is ready"
                break
            fi
            
            if [ $i -eq 30 ]; then
                print_error "PostgreSQL failed to start within 30 seconds"
                exit 1
            fi
            
            sleep 2
            echo -n "."
        done
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    
    if [ ! -d "node_modules" ]; then
        npm install
        print_success "Dependencies installed"
    else
        print_warning "Dependencies already installed (node_modules exists)"
        print_status "Updating dependencies..."
        npm update
    fi
    
    # Install additional dependencies for migration script
    npm install --save-dev ts-node pg @types/pg
}

# Run Prisma migrations
run_migrations() {
    print_status "Running Prisma database migrations..."
    
    # Generate Prisma client
    npx prisma generate
    
    # Run migrations
    npx prisma migrate deploy
    
    print_success "Database schema created successfully"
}

# Run data migration from old database
migrate_data() {
    print_status "Starting data migration from existing database..."
    
    # Check if OLD_DATABASE_URL is configured
    if grep -q "OLD_DATABASE_URL=" .env && ! grep -q "OLD_DATABASE_URL=\"\"" .env; then
        print_status "Found old database configuration, starting migration..."
        
        # Run the migration script
        npx ts-node scripts/migrate-database.ts
        
        if [ $? -eq 0 ]; then
            print_success "Data migration completed successfully"
        else
            print_error "Data migration failed"
            exit 1
        fi
    else
        print_warning "OLD_DATABASE_URL not configured, skipping data migration"
        print_warning "You can run migration later with: npx ts-node scripts/migrate-database.ts"
    fi
}

# Build Rust core
build_rust_core() {
    print_status "Building Rust core engine..."
    
    cd src/rust-core
    
    if command -v cargo &> /dev/null; then
        cargo build --release
        print_success "Rust core built successfully"
    else
        print_error "Rust/Cargo not installed. Please install Rust first."
        print_warning "You can install Rust from: https://rustup.rs/"
        return 1
    fi
    
    cd ../..
}

# Verify setup
verify_setup() {
    print_status "Verifying setup..."
    
    # Test database connection
    if npx prisma db pull --print &> /dev/null; then
        print_success "Database connection successful"
    else
        print_error "Database connection failed"
        return 1
    fi
    
    # Check if Rust binary exists
    if [ -f "src/rust-core/target/release/glicko-core" ]; then
        print_success "Rust core binary available"
    else
        print_warning "Rust core binary not found (optional for API-only usage)"
    fi
    
    # Test API server
    print_status "Testing API server startup..."
    timeout 10s npm run dev &> /dev/null && print_success "API server can start" || print_warning "API server test skipped"
}

# Main setup process
main() {
    echo ""
    print_status "Starting automated setup process..."
    echo ""
    
    check_requirements
    setup_environment
    start_database
    install_dependencies
    run_migrations
    
    # Build Rust core (optional, continue if it fails)
    if ! build_rust_core; then
        print_warning "Rust core build failed, but setup can continue"
        print_warning "Some performance features may not be available"
    fi
    
    migrate_data
    verify_setup
    
    echo ""
    print_success "🎉 Database setup completed successfully!"
    echo ""
    print_status "Next steps:"
    echo "  1. Review the migrated data in your database"
    echo "  2. Start the API server: npm run dev"
    echo "  3. Start the React dashboard: cd src/web-ui && npm start"
    echo "  4. Access the dashboard at: http://localhost:3001"
    echo "  5. Configure your Binance API keys for live trading"
    echo ""
    print_status "Database connection details:"
    echo "  - Host: localhost:5433"
    echo "  - Database: tradingbot_glicko"
    echo "  - Username: tradingbot"
    echo "  - PgAdmin: http://localhost:5050 (dev profile only)"
    echo ""
    print_warning "Remember to stop your old database instance once you've verified the migration!"
}

# Handle script interruption
trap 'echo ""; print_error "Setup interrupted by user"; exit 1' INT

# Run main function
main "$@"