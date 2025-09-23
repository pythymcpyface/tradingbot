# Multi-stage Dockerfile for Trading Bot with Rust Core, Node.js API, and React Frontend

# ===== STAGE 1: Rust Build =====
FROM rust:1.83-slim as rust-builder

WORKDIR /app

# Install system dependencies for Rust compilation
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Rust source code
COPY src/rust-core/ ./src/rust-core/

# Build Rust core
WORKDIR /app/src/rust-core
RUN cargo build --release

# ===== STAGE 2: Node.js Build =====
FROM node:18-slim as node-builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy source code (excluding frontend)
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY config/ ./config/

# Copy production schema only
COPY prisma/schema.production.prisma ./prisma/schema.prisma

# Copy compiled Rust binary
COPY --from=rust-builder /app/src/rust-core/target/release/rust-core ./src/rust-core/target/release/rust-core

# Generate Prisma client for production schema
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# ===== STAGE 3: Frontend Build =====
FROM node:18-slim as frontend-builder

WORKDIR /app/src/web-ui

# Copy frontend package files
COPY src/web-ui/package*.json ./
COPY src/web-ui/tsconfig.json ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source
COPY src/web-ui/src/ ./src/
COPY src/web-ui/public/ ./public/

# Build React application
RUN npm run build

# ===== STAGE 4: Production Runtime =====
FROM node:18-slim as production

WORKDIR /app

# Install system dependencies for runtime
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r trader && useradd -r -g trader trader

# Copy production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from previous stages
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/src ./src
COPY --from=node-builder /app/scripts ./scripts
COPY --from=node-builder /app/config ./config
COPY --from=node-builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy production schema
COPY --from=node-builder /app/prisma ./prisma

# Copy built frontend
COPY --from=frontend-builder /app/src/web-ui/build ./src/web-ui/build

# Copy Rust binary
COPY --from=rust-builder /app/src/rust-core/target/release/rust-core ./src/rust-core/target/release/rust-core

# Create logs directory
RUN mkdir -p logs && chown -R trader:trader logs

# Set ownership
RUN chown -R trader:trader /app

# Switch to non-root user
USER trader

# Expose port (Heroku will set PORT dynamically)
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3001) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application
CMD ["npm", "run", "start:prod"]