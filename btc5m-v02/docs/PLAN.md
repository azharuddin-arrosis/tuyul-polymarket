# BTC 5m Bot v02 - Plan

## Overview
- **Goal**: BTC 5-minute trading bot with real-time dashboard
- **Tech Stack**: Rust (bot) + Node.js (dashboard)
- **Testnet**: Polygon Amoy (80002)

## Architecture

```
btc5m-v02/
├── bot/               # Rust bot (async tokio)
│   ├── src/main.rs   # Main entry
│   ├── Cargo.toml
│   └── ...
├── dashboard/         # Node.js dashboard
│   ├── server.js      # Express + Socket.io
│   ├── public/
│   │   └── index.html # Dashboard UI
│   └── package.json
├── data/              # Shared data (JSON)
│   ├── state.json    # Bot state (balance, settings)
│   ├── markets.json  # Cached market prices
│   └── history.json  # Simulate trade history
└── docs/              # Documentation
    └── PLAN.md
```

## Data Flow

1. **Rust Bot** (runs 24/7):
   - Fetch BTC 5m market prices every 5s from Polymarket API
   - Apply trading logic (threshold >52% or <48%)
   - Simulate trades (calculate P&L)
   - Save to JSON files
   - Serve JSON via HTTP endpoints

2. **Node Dashboard**:
   - Poll bot's HTTP endpoints every 3s
   - Push updates via Socket.io
   - Render dark Excel-style UI

## Features

### 1. Trading Logic (from existing simulation)
- Threshold: Yes price >= 52% → Bet Yes
- Threshold: Yes price <= 48% → Bet No  
- Otherwise: Skip
- Check every 5 minutes (300s)

### 2. Simulation Parameters
- USDC Balance (default: 100)
- MATIC Balance (for gas - default: 0.5)
- Bet Size (default: 1)
- Gas Price (default: 0.001)
- Threshold Above: 0.52
- Threshold Below: 0.48

### 3. P&L Calculation
```
If outcome == "Yes":
  P&L = bet_size * (1 - price) - gas_cost
  
If outcome == "No":
  P&L = -bet_size * price - gas_cost
```

### 4. State Management
- Auto-mode toggle
- Last trade timestamp
- Running balance (not persisted, in-memory)

## API Endpoints (Rust Bot)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/state` | Current bot state |
| GET | `/api/markets` | 5 next markets with prices |
| GET | `/api/history` | Simulate trade history |
| POST | `/api/settings` | Update settings |
| POST | `/api/simulate` | Manual simulate trade |

## Dashboard UI (Dark Excel Style)

### Layout
```
┌────────────────────────────────────────────────────────────┐
│ Header: Bitcoin 5m Bot                          @ HH:MM   │
├────────────────────────────────────────────────────────────┤
│ Stats: P&L | Trades | Wins | Losses | Win Rate | Avg W/L   │
├──────────────┬──────────────┬──────────────┬─────────────┤
│ Active       │ History/     │ Open         │ Simulate    │
│ Markets      │ Activity     │ Positions    │ Settings    │
│ (Next 5)     │ (from sim)   │              │             │
│              │              │              │             │
│ - Icon       │ - Time       │ - Outcome    │ - USDC      │
│ - Time       │ - Market     │ - Price      │ - MATIC     │
│ - Countdown  │ - Outcome    │ - Size       │ - Bet Size  │
│ - Yes/No %   │ - Status     │ - Cost       │ - Gas       │
│ - Buy Button │ - P&L        │              │ - Threshold │
│              │              │              │ - AUTO      │
└──────────────┴──────────────┴──────────────┴─────────────┘
```

### Color Scheme
- Background: #1a1a1a (dark)
- Header: #107c41 (green - Excel style)
- Win: #10b981 (green)
- Loss: #ef4444 (red)
- Warning: #f59e0b (yellow/orange)
- Text: #e0e0e0 (light gray)

## Implementation Steps

### Phase 1: Rust Bot
1. Create Cargo project with tokio
2. Fetch Polymarket API (gamma-api.polymarket.com)
3. Implement trading logic
4. Serve JSON via axum
5. Save history to JSON

### Phase 2: Node Dashboard
1. Create Node project with Express + Socket.io
2. Poll bot API every 3s
3. Build HTML dashboard with real-time updates
4. Implement dark Excel-style UI

### Phase 3: Integration
1. Run both services
2. Connect dashboard to bot
3. Test full flow

## Running

```bash
# Terminal 1 - Bot
cd bot
cargo run

# Terminal 2 - Dashboard  
cd dashboard
npm install
node server.js

# Open browser
http://localhost:3000
```

## Future (v03)
- Real trading on Polygon Amoy testnet
- Multiple coin support
- Compound/grid strategy
- Telegram notifications