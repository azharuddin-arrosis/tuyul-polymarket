# Unified Dashboard README

## Overview

The Unified Dashboard provides a single interface to monitor and control both **Bot 1** and **Bot 2** simultaneously.

## Features

### Real-time Monitoring
- **Bot Status**: Live/offline indicator for both bots
- **Positions**: Open positions from both bots displayed together
- **P&L**: Combined profit/loss across all trades
- **Signal Feed**: Real-time activity log from both bots (merged)

### Control Panel
- **Start All**: Start both bots simultaneously
- **Stop All**: Stop both bots simultaneously  
- **Restart All**: Restart both bots
- **Individual Control**: Control each bot separately

## Docker Setup

### Quick Start

```bash
cd polybot-v2

# Build and start all services
docker-compose -f docker-compose.unified.yml up -d

# View logs
docker-compose -f docker-compose.unified.yml logs -f

# Stop all services
docker-compose -f docker-compose.unified.yml down
```

### Access Points

| Service | URL | Description |
|---------|-----|------------|
| Dashboard | http://localhost:3000 | Unified Dashboard |
| Bot 1 API | http://localhost:8001 | Bot 1 Backend |
| Bot 2 API | http://localhost:8002 | Bot 2 Backend |

## Configuration

### Environment Variables

Create `.env.bot1` and `.env.bot2` with your configuration:

```bash
# Bot 1
BOT_NAME=bot1
BOT_MODE=sim
USDC_CAPITAL=10
POL_BALANCE=11

# Bot 2  
BOT_NAME=bot2
BOT_MODE=sim
USDC_CAPITAL=15
POL_BALANCE=15
```

## Bot Colors

- **Bot 1**: Green (#00ff88)
- **Bot 2**: Blue (#3a8fd8)

## API Endpoints

Both bots expose the same API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Bot statistics |
| `/api/positions` | GET | Open positions |
| `/api/log` | GET | Activity log |
| `/api/gas` | GET | Gas status |
| `/api/start` | POST | Start bot |
| `/api/stop` | POST | Stop bot |
| `/api/restart` | POST | Restart bot |
| `/api/state` | GET | All bots state (aggregated) |

## Development

```bash
# Start backend only (non-Docker)
python start_unified.py start

# View status
python start_unified.py status

# View logs
python start_unified.py logs

# Stop all
python start_unified.py stop
```

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│ POLYBOT UNIFIED                    [Bot 1] [Bot 2]  ● LIVE    │
├─────────────────────────────────────────────────────────────┤
│ Combined Portfolio                                        │
│ Equity: $25.00  P&L: +$3.50  Win: 65%  Open: 3          │
├─────────────────────────────────────────────────────────────┤
│ Bot 1 Status    │ Bot 2 Status    │ Control Panel            │
│ $12.00  +$2.00│ $13.00  +$1.50│ [Start All] [Stop All] │
│ LIVE   65%     │ LIVE   60%     │ [Bot1] ▶ ■ ↻          │
│              │               │ [Bot2] ▶ ■ ↻          │
├─────────────────────────────────────────────────────────────┤
│ Open Positions (3)        │ Signal Feed                  │
│ SIM-0001 BTC 5m YES      │ ▲ 12:30 OPEN SIM-0001      │
│ SIM-0002 ETH  > $3000 NO  │ ✓ 12:25 WIN +$0.85       │
│                        │ 💰 GAJIAN $7.00          ���
└─────────────────────────────────────────────────────────────┘
```