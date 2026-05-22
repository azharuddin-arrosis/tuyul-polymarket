# VPS 6-Bot Deployment Guide

## Overview
Deploy Polypox Terminal with 6 bots (real1-real6) on a single VPS for 24/7 trading. This guide covers secure ENV file management, discovery, and auto-startup.

---

## 1. VPS Requirements

### Minimum Specs
- **CPU:** 2-4 vCores (polling/WS is lightweight)
- **RAM:** 4-8 GB (Node.js + Python + DBs)
- **Disk:** 20 GB SSD (logs, SQLite)
- **OS:** Ubuntu 22.04 LTS or 24.04 LTS
- **Network:** 100 Mbps+ (Binance, Gamma API, Polymarket CLOB)
- **Location:** SG or US datacenter (low latency to APIs)

### Dependencies
```bash
# On fresh Ubuntu 22.04 / 24.04
sudo apt update && sudo apt install -y \
  nodejs npm python3 python3-pip python3-venv \
  git curl wget net-tools htop tmux
```

---

## 2. ENV File Strategy: Secure Handling

### Challenge
- 6 bots × 4 env vars each (POLY_PRIVATE_KEY, POLY_API_KEY, POLY_SECRET, POLY_PASSPHRASE) = **24 secrets**
- Must NOT commit to git (exposed to public)
- Must survive restart / persist across deployments
- Must be accessible to bot processes at runtime

### Recommended Solution: Plaintext with Filesystem Permissions

**Why not encrypted?**
- Adds complexity (decrypt on startup, key management)
- VPS deploys from CI/CD (secrets already in transit)
- Simpler operational model: keep in `/app/envs/` with strict perms

**Implementation:**
```bash
# 1. Create env directory with restricted permissions
sudo mkdir -p /app/envs
sudo chmod 700 /app/envs  # rwx for owner only, no group/other access

# 2. Create env files (owner can read/write, nobody else)
sudo touch /app/envs/real1.env
sudo touch /app/envs/real2.env
... (repeat for real6)
sudo chmod 600 /app/envs/real*.env  # rw for owner only

# 3. Populate with secrets (via CI/CD secrets, not manual)
echo "POLY_PRIVATE_KEY=0x..." | sudo tee /app/envs/real1.env > /dev/null
# ... (repeat for each bot)

# 4. Verify access
ls -la /app/envs/  # should show -rw------- (600) for each file
```

### Alternative: CI/CD Secrets Manager

If using GitHub Actions / GitLab CI:
1. Store secrets in GitHub Secrets / GitLab Variables
2. Deploy script injects them: `echo "${{ secrets.REAL1_PRIVATE_KEY }}" > /app/envs/real1.env`
3. Secrets never appear in logs or code

---

## 3. Empty Template ENV Files

Create template files (no secrets, ready to fill):

**`backend/envs/real1.env.template`**
```bash
# Polymarket Real Mode Bot #1
BOT_ID=real1
BOT_MODE=real
DATA_DIR=/app/data/real1

# ⚠ FILL THESE — DO NOT COMMIT ACTUAL VALUES
POLY_PRIVATE_KEY=0x... # (64 hex chars)
POLY_API_KEY=...
POLY_SECRET=...
POLY_PASSPHRASE=...

# Capital (optional override, default $10)
USDC_CAPITAL=100.0

# Trading config (defaults safe for all)
MAX_OPEN_POS=5
DAILY_LOSS_LIMIT=50.0
MIN_EV=0.03
```

### Generate All 6 Templates

```bash
#!/bin/bash
for i in 1 2 3 4 5 6; do
  cat > backend/envs/real${i}.env.template << EOF
BOT_ID=real${i}
BOT_MODE=real
DATA_DIR=/app/data/real${i}

POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_SECRET=...
POLY_PASSPHRASE=...

USDC_CAPITAL=100.0
MAX_OPEN_POS=5
DAILY_LOSS_LIMIT=50.0
EOF
  chmod 644 backend/envs/real${i}.env.template
done
```

Store `.template` files in git (no secrets), never commit actual `.env` files.

---

## 4. Discovery: Bots Without Credentials

### Goal
Dashboard should list all 6 bots even before ENV files are populated (empty credentials).

### Current Behavior
`orchestrator.sh discover` scans `backend/envs/real*.env` files and generates `frontend-dashboard/public/bots.json`.

### What If ENV Files Don't Exist?
- `discover_bots()` skips missing files → empty bots list
- Dashboard shows "no bots found"

### Solution: Auto-Generate Empty Bots List

**Modified `orchestrator.sh discover`:**
```bash
discover_bots() {
    local bots=()
    
    # Method 1: From actual env files (if they exist)
    for f in backend/envs/real*.env; do
        [ -f "$f" ] || continue
        local id=$(basename "$f" .env)
        local suffix=$(echo "$id" | grep -oE '[0-9]+$' || echo '')
        [ -z "$suffix" ] && suffix=99
        local be_port=$((8000 + suffix))
        local fe_port=$((3000 + suffix))
        bots+=("$id:$be_port:$fe_port")
    done
    
    # Method 2: If no actual envs, generate from templates
    if [ ${#bots[@]} -eq 0 ]; then
        for template in backend/envs/real*.env.template; do
            [ -f "$template" ] || continue
            local id=$(basename "$template" .env.template)
            local suffix=$(echo "$id" | grep -oE '[0-9]+$' || echo '')
            [ -z "$suffix" ] && suffix=99
            local be_port=$((8000 + suffix))
            local fe_port=$((3000 + suffix))
            bots+=("$id:$be_port:$fe_port")
        done
    fi
    
    echo "${bots[@]}"
}
```

**Benefit:** Dashboard auto-discovers all 6 bots on first deploy, even with empty .env files. Users see:
- real1 → 🔴 OFFLINE (no credentials yet)
- real2 → 🔴 OFFLINE
- ... etc

Once ENVs are populated, bots come online after restart.

---

## 5. Directory Structure on VPS

```
/app/
├── polypox/                    # Git clone
│   ├── bot/
│   │   ├── backend/main.py
│   │   ├── orchestrator.sh
│   │   ├── frontend-bot/       # Per-bot detail dashboard
│   │   ├── frontend-dashboard/ # Multi-bot overview (port 3000)
│   │   ├── envs/
│   │   │   ├── real1.env              # git-ignored, has secrets
│   │   │   ├── real1.env.template     # git-tracked
│   │   │   ├── real2.env
│   │   │   ├── real2.env.template
│   │   │   ... (repeat for 6 bots)
│   │   └── venv/               # Python virtualenv
│   └── docs/                   # This guide
│
├── data/                       # Persistent data (NOT git)
│   ├── real1/
│   │   ├── state_real1.json
│   │   ├── trades.db
│   │   └── ...
│   ├── real2/
│   │   ...
│   └── ...
│
└── logs/                       # Daily logs
    ├── backend-real1.log
    ├── backend-real2.log
    ├── frontend-real1.log
    ├── frontend-real2.log
    ├── dashboard.log
    └── ...
```

### .gitignore (in polypox/bot/)
```
envs/*.env           # Never commit actual env files
envs/**/real*.env    # Explicit double-glob
data/                # Never commit persistent data
logs/                # Never commit logs
venv/                # Never commit virtualenv
node_modules/        # Never commit NPM
*.db                 # Never commit SQLite
*.log                # Never commit logs
.env                 # Root level env
```

---

## 6. Deployment Steps

### Step 1: Provision VPS
```bash
# SSH into fresh Ubuntu 22.04 instance
ssh user@vps_ip

# Create application user (non-root)
sudo useradd -m -s /bin/bash polypox
sudo usermod -aG sudo polypox

# Switch to app user
sudo su - polypox

# Install dependencies
sudo apt update && sudo apt install -y \
  nodejs npm python3 python3-pip python3-venv \
  git curl wget htop tmux
```

### Step 2: Clone & Setup Repo
```bash
cd /app
git clone https://github.com/your-repo/polypox.git
cd polypox/bot

# Create Python virtualenv
python3 -m venv venv
source venv/bin/activate
pip install -U pip
pip install -r backend/requirements.txt

# Install Node deps (both backend listener + frontend dashboards)
cd frontend-dashboard && npm install --silent && cd ..
cd frontend-bot && npm install --silent && cd ..
```

### Step 3: Populate ENV Files

**Option A: Manual (for testing)**
```bash
cat > backend/envs/real1.env << 'EOF'
BOT_ID=real1
BOT_MODE=real
DATA_DIR=/app/data/real1
POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_SECRET=...
POLY_PASSPHRASE=...
USDC_CAPITAL=100.0
EOF

# Repeat for real2-real6

chmod 600 backend/envs/real*.env
```

**Option B: CI/CD (Recommended)**
```yaml
# .github/workflows/deploy.yml
deploy:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - name: Deploy with secrets
      env:
        REAL1_PK: ${{ secrets.REAL1_PRIVATE_KEY }}
        REAL1_KEY: ${{ secrets.REAL1_API_KEY }}
        # ... etc for real1-real6
      run: |
        cd polypox/bot
        echo "BOT_ID=real1" > backend/envs/real1.env
        echo "POLY_PRIVATE_KEY=$REAL1_PK" >> backend/envs/real1.env
        # ... etc
```

### Step 4: Create Data Directories
```bash
mkdir -p /app/data/real{1,2,3,4,5,6}
mkdir -p /app/logs
```

### Step 5: Auto-Start on Reboot (Systemd)

Create `/etc/systemd/system/polypox-bots.service`:
```ini
[Unit]
Description=Polypox 6-Bot Orchestrator
After=network.target

[Service]
Type=simple
User=polypox
WorkingDirectory=/app/polypox/bot
Environment="PATH=/app/polypox/bot/venv/bin:$PATH"
ExecStart=/bin/bash -c 'source /app/polypox/bot/venv/bin/activate && ./orchestrator.sh start all dry_run'
ExecStop=/bin/bash -c 'source /app/polypox/bot/venv/bin/activate && ./orchestrator.sh stop all'
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable & start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable polypox-bots.service
sudo systemctl start polypox-bots.service

# Check status
sudo systemctl status polypox-bots.service
sudo journalctl -u polypox-bots.service -f  # live log
```

### Step 6: Verify Dashboard
```bash
# Check orchestrator status
./orchestrator.sh status

# Open browser (tunnel if VPS is private)
# http://vps_ip:3000  (multi-bot dashboard)
# http://vps_ip:3001  (real1 detail)
# http://vps_ip:3002  (real2 detail)
# etc
```

---

## 7. Managing Secrets in CI/CD

### GitHub Actions Example
```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: polypox
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /app/polypox && git pull origin main
            
            # Populate env files from GH secrets
            cat > bot/backend/envs/real1.env << 'EOF'
            BOT_ID=real1
            BOT_MODE=real
            DATA_DIR=/app/data/real1
            POLY_PRIVATE_KEY=${{ secrets.REAL1_PRIVATE_KEY }}
            POLY_API_KEY=${{ secrets.REAL1_API_KEY }}
            POLY_SECRET=${{ secrets.REAL1_SECRET }}
            POLY_PASSPHRASE=${{ secrets.REAL1_PASSPHRASE }}
            USDC_CAPITAL=100.0
            EOF
            
            # Repeat for real2-real6...
            
            chmod 600 bot/backend/envs/real*.env
            
            # Restart orchestrator
            cd bot && ./orchestrator.sh restart all dry_run
```

**GitHub Secrets setup:**
- REAL1_PRIVATE_KEY = `0x...`
- REAL1_API_KEY = `api...`
- REAL1_SECRET = `secret...`
- REAL1_PASSPHRASE = `pass...`
- (repeat for real2-real6)

---

## 8. Monitoring & Alerts

### Daily Checks
```bash
# SSH into VPS
ssh user@vps_ip

# Check all bots running
cd /app/polypox/bot && ./orchestrator.sh status

# Watch logs
tail -f /app/logs/backend-real1.log
tail -f /app/logs/dashboard.log

# Check disk / RAM
df -h
free -h
```

### Automated Monitoring (Optional)

Use `systemd-timer` to auto-restart failed bots:
```ini
# /etc/systemd/system/polypox-health-check.service
[Unit]
Description=Polypox Health Check & Auto-Recover

[Service]
Type=oneshot
ExecStart=/usr/local/bin/polypox-health-check.sh
User=polypox
```

```bash
# /usr/local/bin/polypox-health-check.sh
#!/bin/bash
set -e

cd /app/polypox/bot
source venv/bin/activate

# Check each bot
for bot in real1 real2 real3 real4 real5 real6; do
    be_port=$((8000 + ${bot: -1}))
    if ! curl -s --max-time 2 "http://127.0.0.1:$be_port/health" > /dev/null; then
        echo "[$bot] OFFLINE — restarting..."
        ./run.sh stop "$bot" 2>/dev/null || true
        sleep 2
        ./run.sh "$bot" -d
    fi
done
```

Schedule daily:
```bash
sudo crontab -e
# Add: 0 4 * * * /usr/local/bin/polypox-health-check.sh
```

---

## 9. Safety Checklist

- [ ] `.env` files have `600` permissions (owner-only read/write)
- [ ] `.env` files are in `.gitignore` (not committed)
- [ ] `.env.template` files are tracked (no secrets)
- [ ] VPS firewall allows inbound to ports 3000-3006 only (restrict by IP if possible)
- [ ] Data directory (`/app/data/`) is NOT in git and survives redeploy
- [ ] Systemd service runs as non-root `polypox` user
- [ ] Logs are rotated (use `logrotate` if >1GB)
- [ ] Backup daily state JSON: `cp /app/data/real*/state_*.json /backup/`
- [ ] Database (`trades.db`) is backed up before code updates
- [ ] Test first deploy on staging VPS before production

---

## 10. Rollback & Disaster Recovery

### If Bot Crashes
```bash
./orchestrator.sh restart real1 dry_run
```

### If All Bots Crash
```bash
./orchestrator.sh stop all
# Check logs
tail -f /app/logs/backend-real1.log
./orchestrator.sh start all dry_run
```

### If Data is Corrupted
State + trades stored in `/app/data/` and `/app/logs/`. Keep daily backup:
```bash
#!/bin/bash
# /usr/local/bin/polypox-backup.sh
cp -r /app/data /backup/data-$(date +%Y%m%d)
find /backup -type d -name 'data-*' -mtime +30 -exec rm -rf {} \;  # keep 30 days
```

Cron: `0 2 * * * /usr/local/bin/polypox-backup.sh`

---

## 11. Scaling Beyond 6 Bots

If deploying 7+ bots later:
1. Follow port formula: `BE_PORT = 8000 + suffix`, `FE_PORT = 3000 + suffix`
2. Ensure VPS has enough RAM (each bot ≈ 150-200 MB for Python + Node)
3. Monitor CPU & connection limits (ulimit)

---

## Quick Reference

| Task | Command |
|---|---|
| Check status | `./orchestrator.sh status` |
| Start all (DRY_RUN) | `./orchestrator.sh start all` |
| Start specific bot | `./orchestrator.sh start real1 dry_run` |
| Stop all | `./orchestrator.sh stop all` |
| Restart (preserve mode) | `./orchestrator.sh restart all dry_run` |
| View logs | `tail -f /app/logs/backend-real1.log` |
| Dashboard | http://vps_ip:3000 |

---

## Support

For issues:
1. Check logs: `tail -f /app/logs/backend-real*.log`
2. Verify env files: `ls -la backend/envs/`
3. Test health: `curl http://127.0.0.1:8001/health`
4. Restart service: `sudo systemctl restart polypox-bots.service`

