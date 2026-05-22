# Tuyul Polymarket

Bot trading BTC up/down 5-menit di Polymarket (CLOB) + Soccer/Sports scanner.

**Stack:** Python 3.14 + FastAPI + asyncio (backend) | React 18 + Vite 6 (frontend)

## Quick Start

```bash
./bot/run.sh sim          # attached mode
./bot/run.sh dry_run real1 -d   # detached (background)
./bot/run.sh stop          # stop background instance
```

## Structure

```
bot/
  backend/main.py          # all backend logic (~2000 LOC)
  frontend-bot/            # React bot UI (~1900 LOC)
  frontend-dashboard/      # React monitoring dashboard
  run.sh                   # entry point (attached + detached)
  data/                    # persistent state per bot
  logs/                    # log files
```

## Strategies

| Strategy | Description |
|---|---|
| BTC 5m | 7-indicator weighted TA, entry T-10s poll loop, spike detection |
| Soccer | Gamma API scanner, same-day matches |

## Features

- **Compound:** `floor(equity/10)` = max bet, min $1
- **Circuit breakers:** balance floor, daily loss limit (persistent), per-trade stop-loss 30%
- **Balance:** auto-fetch USDC via CLOB API + POL via Polygon RPC, refresh every 5 min
- **SIM / DRY_RUN / REAL** modes with pre-flight validator
- **Real-time WebSocket** dashboard monitoring
