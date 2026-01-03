# AWS Infrastructure & Troubleshooting Handbook

This guide covers the management of the Trading Bot infrastructure on AWS Lightsail.

## 1. System Overview
- **Service:** AWS Lightsail
- **Region:** eu-west-2 (London)
- **Instance Type:** Nano (512MB RAM, 1 vCPU, 20GB SSD)
- **OS:** Ubuntu 22.04 LTS
- **IP Address:** 3.8.158.154

## 2. Connecting to the Server
To access the server terminal:
```bash
ssh -i key.pem ubuntu@3.8.158.154
```

To view live application logs:
```bash
ssh -i key.pem ubuntu@3.8.158.154 "docker logs -f --tail 100 trading-engine"
```

## 3. Troubleshooting & Recovery

### Symptom: Server Unresponsive (SSH Timeout)
If the server stops responding to SSH or HTTP requests, it is likely frozen due to memory exhaustion.

**Solution 1: Reboot via AWS CLI**
This forces a hardware reboot.
```bash
aws lightsail reboot-instance --instance-name TradingBot-Instance --region eu-west-2
```

**Solution 2: Check Status**
```bash
aws lightsail get-instance-state --instance-name TradingBot-Instance --region eu-west-2
```

### Symptom: "Killed" or "Out of Memory" in logs
If the application restarts unexpectedly, check for OOM kills:
```bash
sudo grep -i "killed" /var/log/syslog
```

**Prevention (Implemented):**
We have added a 2GB Swap file (`/swapfile`) to handle memory overflow.

## 4. Cost Management
- **Instance Cost:** ~$3.50 - $5.00 / month (fixed).
- **Swap Memory:** Free (uses existing disk space).
- **Data Transfer:** Free within limits (usually ample for this use case).
- **CloudWatch Logs (Optional):** ~$0.50/GB if enabled.

## 5. Security
- **Firewall:** Configure in Lightsail Networking tab.
  - Port 22 (SSH): Open (consider restricting to specific IPs for higher security).
  - Port 80/443: Open for web dashboard (if applicable).
- **Keys:** `key.pem` is the only access credential. Rotate if compromised.

## 6. Maintenance Commands
**Update System:**
```bash
sudo apt update && sudo apt upgrade -y
```

**Clean Docker Space:**
```bash
docker system prune -f
```

## 7. Database & Trading Inspection

### Connecting to the Database
The database runs in a Docker container. To access it via CLI:

```bash
ssh -i key.pem ubuntu@3.8.158.154 "docker exec -it tradingbot-db-prod psql -U tradingbot -d tradingbot_glicko"
```

### Common Queries

**Check Recent Orders:**
```sql
SELECT * FROM "ProductionOrders" ORDER BY time DESC LIMIT 10;
```

**Check Z-Score History:**
```sql
SELECT * FROM "ZScoreHistory" ORDER BY timestamp DESC LIMIT 10;
```

**Check Active Positions (Table):**
```sql
SELECT * FROM "ActivePositions";
```

### Checking Trading Logs
To grep for specific events like trades or errors:

```bash
# Check for executed trades
ssh -i key.pem ubuntu@3.8.158.154 "docker logs tradingbot-engine 2>&1 | grep 'Order executed'"

# Check for errors
ssh -i key.pem ubuntu@3.8.158.154 "docker logs tradingbot-engine 2>&1 | grep 'Error'"
```
