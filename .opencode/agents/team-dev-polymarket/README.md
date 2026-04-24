# TBS Polymarket Bot Team

Tim AI agent untuk membangun **automated prediction market bot** di Polymarket,
fokus pasar **BTC (Bitcoin)**. Stack: Python async · FastAPI · React · TimescaleDB · Redis.

## Hierarki

```
team-dev-polymarket-eli.md       (PM)
  └── lead/
  │     ├── team-dev-polymarket-flynn.md  (Tech Lead · Principal)
  │     ├── team-dev-polymarket-sora.md   (Python Lead · Principal)
  │     ├── team-dev-polymarket-wren.md   (React Lead · Principal)
  │     └── team-dev-polymarket-voss.md   (Principal Quant · Probability)
  ├── engineers/
  │     ├── python/
  │     │     └── team-dev-polymarket-dex.md   (Senior Python Engineer)
  │     └── react/
  │           └── team-dev-polymarket-finn.md  (Senior React Engineer)
  ├── market/
  │     ├── team-dev-polymarket-cass.md   (Principal Market Analyst)
  │     ├── team-dev-polymarket-poet.md   (Senior Polymarket Expert)
  │     └── team-dev-polymarket-axel.md   (Senior Binance Integration)
  └── qa/
        └── team-dev-polymarket-tess.md   (Senior QA Automation)
```

## Alur Kerja Bot

```
Data Layer (Axel: Binance + Poet: Polymarket)
  ↓
Signal Layer (Voss: probability model + Cass: market context)
  ↓
Execution Layer (Dex: py-clob-client + risk manager)
  ↓
Dashboard (Finn: React real-time via Wren's WebSocket design)
  ↓
QA Gate (Tess: paper trading + circuit breaker test → Eli sign-off)
```

## Stack Teknologi

| Layer | Stack |
|-------|-------|
| Core Bot | Python 3.12 async (asyncio) |
| Data Stream | Redis pub/sub + TimescaleDB |
| API Server | FastAPI + WebSocket |
| Polymarket | py-clob-client (CLOB order execution) |
| Binance | Binance WS Stream + CCXT |
| Frontend | Next.js 14 + TradingView Charts |
| Infra | Docker + VPS + GitHub Actions |

## Kapan Panggil Siapa

| Situasi | Agent |
|---------|-------|
| PRD, roadmap, success metric bot | Eli |
| Sprint plan, tech architecture, inter-module design | Flynn |
| Python async architecture, ADR backend, interface design | Sora |
| React dashboard architecture, charting ADR | Wren |
| Model probabilitas TRUE/FALSE, EV, Kelly, backtesting | Voss |
| Implementasi Python bot, pipeline, executor | Dex |
| Implementasi React dashboard, chart, WebSocket hook | Finn |
| Analisis pasar BTC, market context scoring, strategy | Cass |
| Polymarket mechanics, py-clob-client, market selection | Poet |
| Binance WebSocket, data pipeline, sentiment data | Axel |
| Test bot, paper trading, circuit breaker test, QA | Tess |
