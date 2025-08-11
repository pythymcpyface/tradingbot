# Deployment Guide

This guide covers deploying the Glicko-2 Trading Bot to production environments.

## 🚀 Quick Production Deployment

### Prerequisites

- ✅ Docker and Docker Compose installed
- ✅ Node.js 18+ and npm
- ✅ Rust toolchain (for optimal performance)
- ✅ PostgreSQL database migrated
- ✅ Binance API credentials

### 1. Production Environment Setup

```bash
# Clone and setup
git clone <your-repo>
cd tradingbot_glicko

# Copy and configure production environment
cp .env.example .env.production

# Edit production settings
nano .env.production
```

**Production `.env.production` example:**
```env
NODE_ENV=production
PORT=3000

# Production database
DATABASE_URL="postgresql://tradingbot:secure_production_password@postgres:5432/tradingbot_glicko"

# Production Binance API
BINANCE_API_KEY="your_production_api_key"
BINANCE_API_SECRET="your_production_api_secret"
BINANCE_TESTNET=false  # LIVE TRADING

# Security
LOG_LEVEL=warn
API_RATE_LIMIT=100

# Trading settings (conservative for production)
Z_SCORE_THRESHOLD=3.0
MAX_POSITIONS=3
ALLOCATION_PER_POSITION=0.05  # 5% per position
MAX_DAILY_LOSS=50
```

### 2. Production Docker Deployment

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: tradingbot_glicko
      POSTGRES_USER: tradingbot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_prod:/var/lib/postgresql/data
    networks:
      - trading-network
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_prod:/data
    networks:
      - trading-network
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}

  api:
    build:
      context: .
      dockerfile: Dockerfile
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://tradingbot:${DB_PASSWORD}@postgres:5432/tradingbot_glicko
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    networks:
      - trading-network
    volumes:
      - ./logs:/app/logs
      - ./analysis:/app/analysis

  dashboard:
    build:
      context: .
      dockerfile: Dockerfile.dashboard
    restart: always
    environment:
      REACT_APP_API_URL: https://your-domain.com/api
    ports:
      - "80:80"
    depends_on:
      - api
    networks:
      - trading-network

volumes:
  postgres_prod:
  redis_prod:

networks:
  trading-network:
    driver: bridge
```

### 3. Create Production Dockerfiles

**Main API Dockerfile:**
```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Install Rust for building core
RUN apk add --no-cache curl build-base
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

COPY . .
RUN npm run build

FROM node:18-alpine AS runtime

WORKDIR /app
RUN apk add --no-cache postgresql-client

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/rust-core/target/release/glicko-core ./glicko-core

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

USER node

CMD ["npm", "start"]
```

**Dashboard Dockerfile:**
```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app/dashboard
COPY src/web-ui/package*.json ./
RUN npm ci

COPY src/web-ui/ ./
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dashboard/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### 4. Deploy to Production

```bash
# Set environment variables
export DB_PASSWORD="your_secure_db_password"
export REDIS_PASSWORD="your_secure_redis_password"

# Deploy
docker-compose -f docker-compose.prod.yml up -d

# Monitor deployment
docker-compose -f docker-compose.prod.yml logs -f
```

## 🌐 Cloud Deployment Options

### AWS Deployment

#### Option 1: ECS with Fargate

1. **Create ECS Cluster:**
```bash
aws ecs create-cluster --cluster-name tradingbot-cluster
```

2. **Create Task Definition:**
```json
{
  "family": "tradingbot-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "tradingbot-api",
      "image": "your-account.dkr.ecr.region.amazonaws.com/tradingbot:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "DATABASE_URL",
          "value": "postgresql://..."
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/tradingbot",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

3. **Create Service:**
```bash
aws ecs create-service \
  --cluster tradingbot-cluster \
  --service-name tradingbot-service \
  --task-definition tradingbot-task \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-12345],securityGroups=[sg-12345],assignPublicIp=ENABLED}"
```

#### Option 2: EC2 with Auto Scaling

```bash
# Create Launch Template
aws ec2 create-launch-template \
  --launch-template-name tradingbot-template \
  --launch-template-data '{
    "ImageId": "ami-0abcdef1234567890",
    "InstanceType": "t3.medium",
    "SecurityGroupIds": ["sg-12345"],
    "UserData": "base64-encoded-startup-script"
  }'

# Create Auto Scaling Group
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name tradingbot-asg \
  --launch-template "LaunchTemplateName=tradingbot-template,Version=1" \
  --min-size 1 \
  --max-size 3 \
  --desired-capacity 1 \
  --vpc-zone-identifier "subnet-12345,subnet-67890"
```

### Google Cloud Platform

#### Cloud Run Deployment

```bash
# Build and push image
gcloud builds submit --tag gcr.io/PROJECT-ID/tradingbot

# Deploy to Cloud Run
gcloud run deploy tradingbot \
  --image gcr.io/PROJECT-ID/tradingbot \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --memory 2Gi \
  --cpu 1
```

### DigitalOcean App Platform

Create `app.yaml`:
```yaml
name: tradingbot-glicko
services:
- name: api
  source_dir: /
  github:
    repo: your-username/tradingbot-glicko
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: professional-xs
  envs:
  - key: NODE_ENV
    value: production
  - key: DATABASE_URL
    value: ${DATABASE_URL}
  routes:
  - path: /api
databases:
- name: tradingbot-db
  engine: PG
  version: "13"
  size: db-s-1vcpu-1gb
```

Deploy:
```bash
doctl apps create app.yaml
```

## 🔒 Production Security

### 1. Environment Security

```bash
# Use Docker secrets for sensitive data
echo "your_api_secret" | docker secret create binance_api_secret -
echo "your_db_password" | docker secret create db_password -

# Update docker-compose.yml to use secrets
services:
  api:
    secrets:
      - binance_api_secret
      - db_password
    environment:
      BINANCE_API_SECRET_FILE: /run/secrets/binance_api_secret
      DB_PASSWORD_FILE: /run/secrets/db_password
```

### 2. Network Security

```bash
# Create custom network
docker network create --driver bridge trading-network

# Use firewall rules
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw deny 5432  # Database should not be publicly accessible
sudo ufw enable
```

### 3. SSL/TLS Setup

**Using Let's Encrypt with Nginx:**

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location /api {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://dashboard;
        proxy_set_header Host $host;
    }
}
```

### 4. Database Security

```sql
-- Create read-only user for monitoring
CREATE USER monitor WITH PASSWORD 'monitor_password';
GRANT CONNECT ON DATABASE tradingbot_glicko TO monitor;
GRANT USAGE ON SCHEMA public TO monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO monitor;

-- Enable connection logging
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_statement = 'all';
```

## 📊 Production Monitoring

### 1. Health Checks

```bash
# API health check
curl -f http://localhost:3000/health || exit 1

# Database health check
docker exec postgres pg_isready -U tradingbot || exit 1

# Trading engine health check
curl -f http://localhost:3000/api/trading/status || exit 1
```

### 2. Logging Setup

**Centralized Logging with ELK Stack:**

```yaml
services:
  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"

  kibana:
    image: kibana:8.11.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

  logstash:
    image: logstash:8.11.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
```

### 3. Metrics Collection

**Prometheus + Grafana:**

```yaml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

### 4. Alerting

**Alert Rules (`alerts.yml`):**
```yaml
groups:
- name: tradingbot
  rules:
  - alert: TradingEngineDown
    expr: up{job="tradingbot"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: Trading engine is down

  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: High error rate detected
```

## 🔄 Backup and Recovery

### 1. Database Backup

```bash
#!/bin/bash
# backup-database.sh

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="tradingbot_glicko"

# Create backup
docker exec postgres pg_dump -U tradingbot $DB_NAME > $BACKUP_DIR/backup_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/backup_$DATE.sql

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/backup_$DATE.sql.gz s3://your-backup-bucket/database/

# Keep only last 30 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete
```

**Automated with cron:**
```bash
# Run backup daily at 2 AM
0 2 * * * /scripts/backup-database.sh
```

### 2. Application State Backup

```bash
#!/bin/bash
# backup-app-state.sh

BACKUP_DIR="/backups/app-state"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup configuration
cp .env.production $BACKUP_DIR/env_$DATE

# Backup analysis results
tar -czf $BACKUP_DIR/analysis_$DATE.tar.gz analysis/

# Backup logs
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz logs/
```

### 3. Disaster Recovery

```bash
#!/bin/bash
# disaster-recovery.sh

echo "Starting disaster recovery..."

# Stop services
docker-compose down

# Restore database from latest backup
LATEST_BACKUP=$(ls -t /backups/backup_*.sql.gz | head -n1)
gunzip -c $LATEST_BACKUP | docker exec -i postgres psql -U tradingbot tradingbot_glicko

# Restart services
docker-compose up -d

# Verify recovery
curl -f http://localhost:3000/health && echo "Recovery successful"
```

## 🚦 Production Checklist

Before going live:

### Pre-Launch Checklist

- [ ] **Environment Configuration**
  - [ ] Production `.env` configured
  - [ ] Binance API keys verified (testnet disabled)
  - [ ] Database connection strings updated
  - [ ] SSL certificates installed

- [ ] **Security**
  - [ ] Secrets management implemented
  - [ ] Network security configured
  - [ ] Database access restricted
  - [ ] API rate limiting enabled

- [ ] **Monitoring**
  - [ ] Health checks configured
  - [ ] Logging centralized
  - [ ] Metrics collection setup
  - [ ] Alerting rules defined

- [ ] **Backup & Recovery**
  - [ ] Automated backups configured
  - [ ] Recovery procedures tested
  - [ ] Disaster recovery plan documented

- [ ] **Performance**
  - [ ] Load testing completed
  - [ ] Resource limits set
  - [ ] Auto-scaling configured
  - [ ] Database optimized

- [ ] **Testing**
  - [ ] All tests passing
  - [ ] Integration tests run
  - [ ] End-to-end tests validated
  - [ ] Performance benchmarks met

### Post-Launch Monitoring

- [ ] Monitor system resources (CPU, memory, disk)
- [ ] Track API response times and error rates
- [ ] Monitor trading performance and P&L
- [ ] Watch for any security incidents
- [ ] Review logs daily for anomalies

## 📞 Production Support

### Troubleshooting Commands

```bash
# Check service status
docker-compose ps

# View live logs
docker-compose logs -f api

# Check database connections
docker exec postgres psql -U tradingbot -d tradingbot_glicko -c "SELECT count(*) FROM pg_stat_activity;"

# Monitor system resources
htop

# Check disk space
df -h

# Test API endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/trading/status
```

### Emergency Procedures

1. **Trading Engine Issues:**
```bash
# Emergency stop all trading
curl -X POST http://localhost:3000/api/trading/emergency-stop

# Check positions
curl http://localhost:3000/api/trading/positions

# Manual order cancellation via Binance web interface if needed
```

2. **Database Issues:**
```bash
# Check database status
docker exec postgres pg_isready

# View active queries
docker exec postgres psql -U tradingbot -d tradingbot_glicko -c "SELECT query FROM pg_stat_activity;"

# Restart database (last resort)
docker-compose restart postgres
```

3. **Performance Issues:**
```bash
# Scale up services
docker-compose up -d --scale api=2

# Check resource usage
docker stats

# Clear logs if disk space is low
docker system prune -a
```

---

**Remember**: Always test deployment procedures in a staging environment before applying to production!