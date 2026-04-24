# PolyBot v2 — Deployment Guide

## Quick Start

### Simulator Mode (Recommended for Testing)

```bash
cd /Users/azharuddinarrosis/Developments/poly/polybot-v2
docker compose -f docker-concurrent.yml --profile sim up -d --build
```

**Access:**
| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3001 |
| Bot 1 API | http://localhost:8001 |
| Bot 2 API | http://localhost:8002 |

---

### Real Mode (Dengan Dana Nyata)

```bash
cd /Users/azharuddinarrosis/Developments/poly/polybot-v2
docker compose -f docker-concurrent.yml --profile real up -d --build
```

**Access:**
| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| Bot 1 API | http://localhost:8011 |
| Bot 2 API | http://localhost:8012 |

---

### All Mode (Simulator + Real Concurrent)

```bash
cd /Users/azharuddinarrosis/Developments/poly/polybot-v2
docker compose -f docker-concurrent.yml --profile all up -d --build
```

**Access:**
| Service | URL |
|---------|-----|
| Dashboard Sim | http://localhost:3001 |
| Dashboard Real | http://localhost:3000 |
| Bot 1 Sim | http://localhost:8001 |
| Bot 2 Sim | http://localhost:8002 |
| Bot 1 Real | http://localhost:8011 |
| Bot 2 Real | http://localhost:8012 |

---

## Commands Reference

### Start/Stop

```bash
# Start simulator only
docker compose -f docker-concurrent.yml --profile sim up -d

# Stop simulator
docker compose -f docker-concurrent.yml --profile sim down

# Start real only
docker compose -f docker-concurrent.yml --profile real up -d

# Stop real
docker compose -f docker-concurrent.yml --profile real down

# Start all
docker compose -f docker-concurrent.yml --profile all up -d

# Stop all
docker compose -f docker-concurrent.yml --profile all down
```

### Logs

```bash
# View all logs
docker compose -f docker-concurrent.yml logs -f

# View specific bot logs
docker compose -f docker-concurrent.yml logs -f bot1-sim
docker compose -f docker-concurrent.yml logs -f bot2-sim

# View dashboard logs
docker compose -f docker-concurrent.yml logs -f dashboard-sim
```

### Rebuild

```bash
# Rebuild and restart
docker compose -f docker-concurrent.yml --profile sim up -d --build
```

---

## Environment Configuration

### Simulator Mode

| File | Bot | Capital | Max Bet |
|------|-----|---------|--------|
| `.env.bot1-sim` | Bot 1 | 10 USDC | $2.0 |
| `.env.bot2-sim` | Bot 2 | 20 USDC | $3.0 |

### Real Mode (Requires API Keys)

| File | Bot | Capital | API Required |
|------|-----|---------|-----------|
| `.env.bot1-real` | Bot 1 | Lower | POLY_PRIVATE_KEY, POLY_API_KEY |
| `.env.bot2-real` | Bot 2 | Lower | POLY_PRIVATE_KEY, POLY_API_KEY |

---

## API Endpoints

### Health Check

```bash
curl http://localhost:8001/health
curl http://localhost:8002/health
```

### Full Status

```bash
curl http://localhost:8001/api/health
curl http://localhost:8002/api/health
```

### Stats

```bash
curl http://localhost:8001/api/stats
curl http://localhost:8002/api/stats
```

---

## Troubleshooting

### Check Running Containers

```bash
docker ps
```

### View Logs

```bash
docker compose -f docker-concurrent.yml logs -f
```

### Restart Specific Service

```bash
docker restart polybot-bot1-sim
docker restart polybot-bot2-sim
```

### Clean Up and Redeploy

```bash
docker compose -f docker-concurrent.yml down --remove-orphans
docker compose -f docker-concurrent.yml --profile sim up -d --build
```

---

## Port Summary

| Mode | Dashboard | Bot 1 | Bot 2 |
|------|-----------|-------|-------|
| Simulator | 3001 | 8001 | 8002 |
| Real | 3000 | 8011 | 8012 |

---

## Notes

- **Simulator Mode**: Virtual capital, no real money involved
- **Real Mode**: Requires Polymarket API keys in `.env.bot*-real`
- Both bots run independently with separate capital and config
- Dashboard connects to Bot 1 by default (bot selector coming soon)