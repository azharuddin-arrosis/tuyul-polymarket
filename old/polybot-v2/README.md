# POLYMARKET BOT v2

## Deploy ke Server

```bash
# Upload ke server
scp -r polybot-v2/ user@server:~/polybot-v2
ssh user@server
cd ~/polybot-v2

# Build & jalankan
docker compose up -d --build

# Dashboard
http://YOUR_SERVER_IP:3001
```

## Commands

```bash
docker compose up -d --build    # build + start
docker compose down             # stop semua
docker compose logs -f backend  # log backend
docker compose logs -f frontend # log frontend
docker compose restart backend  # restart bot saja
docker compose ps               # cek status
```

## Compound Logic

| Capital  | Tier | Max Bet |
|----------|------|---------|
| < $20    |  0   | $2      |
| $20-$39  |  1   | $1      |
| $40-$59  |  2   | $2      |
| $60-$79  |  3   | $3      |
| $80-$99  |  4   | $4      |
| $100+    |  5   | $5      |

## Gas Alert System

- **< 10 tx tersisa** → ⚠ WARNING di dashboard
- **< 2 tx tersisa**  → 🛑 BOT AUTO-STOP
- **Resume manual**   → klik tombol RESUME di dashboard atau:
  ```bash
  curl -X POST http://server:3001/api/gas/resume
  ```

## Switch ke REAL mode

```bash
# 1. Edit .env
BOT_MODE=real
POLY_PRIVATE_KEY=0x...   # dari MetaMask (BUKAN Phantom)
POLY_API_KEY=...
POLY_SECRET=...
POLY_PASSPHRASE=...

# 2. Restart
docker compose restart backend
```

## ⚠ Phantom vs MetaMask

Polymarket berjalan di **Polygon (EVM)**.
- ❌ Phantom = wallet Solana, tidak kompatibel
- ✅ MetaMask = EVM wallet, kompatibel
- Export private key dari MetaMask → Accounts → Export Private Key
