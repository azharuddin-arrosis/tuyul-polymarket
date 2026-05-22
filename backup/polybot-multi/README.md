# POLYMARKET MULTI-BOT

## Quick Start

```bash
# Upload ke server
scp -r polybot-multi/ user@server:~/polybot-multi
ssh user@server && cd ~/polybot-multi

# Jalankan semua 5 SIM bot + dashboard
docker compose --profile sim up -d --build

# Buka dashboard
http://SERVER_IP:3001
```

## Struktur

```
polybot-multi/
├── backend/          ← Bot engine (shared image, 1 per container)
│   ├── main.py       ← FastAPI + BTC5m + compound + salary + SQLite
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/         ← Multi-bot dashboard
│   ├── src/App.jsx   ← Semua bot dalam 1 layar
│   └── ...
├── envs/             ← Config per bot
│   ├── sim1.env      ← SIM Bot 1
│   ├── sim2.env      ← SIM Bot 2
│   ├── sim3.env      ← SIM Bot 3
│   ├── sim4.env      ← SIM Bot 4
│   ├── sim5.env      ← SIM Bot 5
│   ├── real1.env     ← REAL Bot 1 (isi credentials dulu)
│   └── real2.env     ← REAL Bot 2 (isi credentials dulu)
├── nginx/
│   └── default.conf  ← Route /sim1/ /sim2/ /real1/ ke container
├── data/             ← Shared SQLite DB (semua bot)
└── docker-compose.yml
```

## Commands

```bash
# Run semua SIM bots
docker compose --profile sim up -d --build

# Run bot tertentu saja
docker compose up sim1 sim2 dashboard -d --build

# Run 1 real bot
docker compose --profile real1 up -d --build

# Stop semua
docker compose down

# Logs per bot
docker compose logs -f sim1
docker compose logs -f sim2
docker compose logs -f --tail=50   # semua

# Rebuild setelah update code
docker compose --profile sim up -d --build --force-recreate

# Check status
docker compose ps
```

## Compound Logic

| Equity | Tier | Max Bet |
|--------|------|---------|
| $0     | T0   | $2      |
| $10    | T1   | $2      |
| $20    | T2   | $4      |
| $30    | T3   | $6      |
| $50    | T5   | $10     |
| $100   | T10  | $20     |

Formula: `tier = floor(equity/10)`, `max_bet = tier * $2`

## Salary System

- Equity nyentuh $100 → tarik **70%** ($70), lanjut dengan **30%** ($30)
- Target berikutnya: $200, $300, dst.
- State persisten — bot restart tidak reset saldo

## Persistent State

Setiap bot menyimpan state ke:
```
/app/data/state_<BOT_ID>.json   ← saldo, posisi, compound tier
/app/data/trades.db              ← SQLite shared, semua bot
```

Volume `shared_data` di Docker menjaga state tidak hilang saat restart.

## DB API (Cross-bot)

```
GET /api/db/summary         ← statistik semua bot
GET /api/db/trades?bot_id=sim1
GET /api/db/sessions        ← semua session yang pernah jalan
```

## Real Mode Setup

1. Edit `envs/real1.env`:
   ```
   BOT_MODE=real
   POLY_PRIVATE_KEY=0x...   # MetaMask export (BUKAN Phantom)
   POLY_API_KEY=...
   POLY_SECRET=...
   POLY_PASSPHRASE=...
   USDC_CAPITAL=10
   POL_BALANCE=11
   ```

2. Jalankan:
   ```bash
   docker compose --profile real1 up -d --build
   ```

3. Cek log:
   ```bash
   docker compose logs -f real1
   ```

## Customisasi per Bot

Edit masing-masing `envs/simX.env`:
```
BOT_ID=sim1
BOT_MODE=sim
USDC_CAPITAL=10      ← modal awal
POL_BALANCE=11       ← gas
MAX_OPEN_POS=5       ← max posisi terbuka
MIN_EV=0.03          ← minimum EV untuk entry
DAILY_LOSS_LIMIT=5.0 ← stop trading jika rugi $5/hari
PROB_MIN=0.52        ← min probability untuk bet
PROB_MAX=0.90        ← max probability
SCAN_INTERVAL=8      ← scan setiap 8 detik
```

## Tips

- **Mulai dengan 1-2 bot** dulu, lihat performanya
- **Compound $10 → +$2** artinya: $10 modal → bet $2, $20 → bet $4, dst.
- **BTC5m** aktif di semua bot — entry otomatis T-35s sampai T-10s
- **Semua bet otomatis** — tidak perlu trigger manual
- **State persist** — kalau server restart, saldo dilanjutkan dari state.json
