# Polymarket Simulator

Paper trading simulator untuk Polymarket — data real dari Polymarket API, semua trade adalah simulasi (no real money).

## Prerequisites

```bash
# Install Rust (jika belum ada)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

## Cara Jalankan

```bash
# Clone atau extract project
cd polymarket-sim

# Build dan jalankan (pertama kali agak lama karena compile dependencies)
cargo run

# Atau build release (lebih cepat):
cargo build --release
./target/release/polymarket-sim

# Custom port dan starting capital
PORT=8080 STARTING_CAPITAL=5000 cargo run
```

Server jalan di: **http://localhost:3000**

Buka browser → http://localhost:3000

## Features

### Dashboard
- **Left panel**: Live markets dari Polymarket (real data, auto-refresh)
- **Center**: Market detail + paper trade form + positions table
- **Right**: Analytics, P&L stats, Kelly Calculator

### Paper Trading
1. Klik market di kiri
2. Pilih YES atau NO (klik price card)
3. Masukkan size (USDC paper money)
4. Masukkan estimasi probabilitasmu sendiri
5. Lihat Kelly hint — edge dan suggested size
6. Klik PLACE TRADE

### Positions
- **WIN** / **LOSS** button: resolve position saat market settled
- **CLOSE**: exit di harga current (sebelum resolution)
- P&L dihitung otomatis

### Kelly Calculator (sidebar)
- Masukkan probability estimate, market price, bankroll
- Dapat: Full Kelly, Half Kelly, Quarter Kelly amount
- Recommendation berdasarkan edge size

## API Endpoints

```
GET  /api/markets?limit=30&search=bitcoin  - list markets
GET  /api/markets/:id                       - single market
GET  /api/portfolio                         - portfolio state
GET  /api/portfolio/stats                   - performance stats
POST /api/portfolio/reset                   - reset to starting capital

POST /api/trades                            - place trade
POST /api/trades/:id/resolve               - resolve (won/lost)
PUT  /api/trades/:id/price                 - update current price
DEL  /api/trades/:id                       - close position

POST /api/kelly                            - Kelly calculator
```

### POST /api/trades body:
```json
{
  "market_id": "abc123",
  "market_question": "Will Fed cut rates?",
  "side": "no",
  "entry_price": 0.28,
  "size_usdc": 100,
  "your_estimate": 0.48,
  "notes": "CPI beat = Fed stays hawkish",
  "end_date": "2024-03-20T00:00:00Z"
}
```

### POST /api/kelly body:
```json
{
  "your_probability": 0.48,
  "market_price": 0.28,
  "bankroll": 1000
}
```

## Agent Integration

Agent `PolymarketMaster` bisa digunakan untuk analisis mendalam sebelum memutuskan trade.
Workflow:
1. Lihat market di dashboard
2. Copy market question ke `PolymarketMaster` agent
3. Agent koordinasi `ProbabilityAnalyst` + `ResearchAgent` untuk estimasi
4. Masukkan probability estimate ke Kelly Calculator di dashboard
5. Place trade berdasarkan rekomendasi

## Architecture

```
polymarket-sim/
├── Cargo.toml
├── README.md
├── src/
│   ├── main.rs        ← Axum server + all route handlers
│   ├── models.rs      ← Data structures, Portfolio, Kelly
│   └── polymarket.rs  ← Polymarket API client
└── static/
    └── index.html     ← Full frontend dashboard (vanilla JS)
```

Data disimpan **in-memory** — restart server = reset portfolio.
Untuk persistensi, tambahkan SQLite (serde_json ke file sebagai simple solution).

## Troubleshooting

**Server tidak bisa connect ke Polymarket API:**
→ Pastikan ada koneksi internet
→ Polymarket mungkin rate-limiting — tunggu beberapa menit

**Port already in use:**
```bash
PORT=3001 cargo run
```

**Slow first compile:**
→ Normal, Rust compile semua dependencies pertama kali (~2-3 menit)
→ Subsequent builds jauh lebih cepat
