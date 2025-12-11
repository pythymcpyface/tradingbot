# Cheap Database Deployment & Migration Strategy

## 📊 Situation Analysis
- **Local Database Size:** ~6.6 GB
- **Content:** 
  - `klines` table: ~23.6 million rows (99.9% of data)
  - `glicko_ratings`: 0 rows
  - `orders`: 0 rows
  - `optimization_results`: 0 rows
- **Constraint:** Low local storage, need to minimize disk usage.

## 💡 Core Insight
**You do not need to migrate this database.** 
Since the database currently contains *only* publicly available market data (which the bot can automatically re-download) and no unique user data (no orders, ratings, or test results), moving the 6.6GB file is unnecessary, slow, and costly.

## 🚀 Recommended Strategy: "Fresh Deploy & Re-hydrate"

Instead of uploading 7GB of data, we will provision a cheap server and run the bot's built-in download scripts. This uses **0GB of local storage** and **0GB of upload bandwidth**.

### 1. The Hosting Solution
**Recommendation:** A Low-Cost VPS (Virtual Private Server)
*   **Providers:** DigitalOcean ($6/mo), Hetzner (~€5/mo), Linode, or Vultr.
*   **Specs Needed:** 
    *   1 CPU / 1GB RAM (Minimum)
    *   25GB SSD Storage (Essential for the ~7GB DB + logs)
    *   Docker pre-installed (often a "One-Click App" option)

*Why not Managed Database (e.g., Heroku Postgres, AWS RDS)?*
*   Managed DBs with 10GB+ storage often start at $15-30/month.
*   A VPS allows you to host the Database **AND** the Bot on the same $6 server.

### 2. Deployment Steps

#### A. Provision Server
1.  Create a "Docker" Droplet on DigitalOcean (or similar).
2.  Get the IP address (e.g., `192.168.1.100`).

#### B. Connect & Setup (From your terminal)
```bash
# SSH into your new server
ssh root@192.168.1.100

# Clone your repository
git clone https://github.com/your-username/tradingbot_glicko.git
cd tradingbot_glicko

# Create production config
cp .env.example .env
# Edit .env with your settings
nano .env 

# Start the Database
docker compose -f docker-compose.trading.yml up -d postgres
```

#### C. Re-hydrate Data (The "Magic" Step)
Run the bulk download script directly on the server. It will fetch the data much faster than you could upload it.
```bash
# Run inside the container or via node on the host
# Downloads last 4 years of data for all configured pairs
npm run getKlines-bulk "2021-01-01" "2025-01-01" "5m"
```
*Estimated time: ~20-30 minutes to restore all 23M records.*

### 3. How to "Still Connect" to it
**Do not** open port 5432 to the internet. It is insecure.
Instead, use **SSH Tunneling** (Port Forwarding). This maps the remote DB to your local machine securely.

**Command (Run on your LOCAL machine):**
```bash
# Map remote port 5432 to local port 5438
ssh -L 5438:localhost:5432 root@192.168.1.100 -N
```

Now, you can connect your local tools (DBeaver, VS Code, your local bot instance) to:
*   **Host:** `localhost`
*   **Port:** `5438`
*   **User/Pass:** (From your server's .env)

## ⚠️ Alternative: If you MUST migrate the existing data
If you have a slow internet connection on the server or specific data you can't re-download, use **Streaming Migration**. This pipes data directly from local Docker to remote Docker without saving a file.

```bash
# 1. SSH Tunnel to remote (in background)
ssh -L 5439:localhost:5432 root@192.168.1.100 -N &

# 2. Stream Data (Requires fast upload speed)
# Note: This will take a long time for 6.6GB!
docker exec -t tradingbot-postgres-glicko pg_dump -U tradingbot tradingbot_glicko | \
psql -h localhost -p 5439 -U tradingbot -d tradingbot_glicko
```
*Not recommended due to your low local storage/bandwidth constraints.*
