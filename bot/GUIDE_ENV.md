# Polypox Bot — Environment & Data Sources Guide

## Sumber Data Bot

| Data | Source | Endpoint |
|---|---|---|
| BTC Price (primary) | Binance | `api.binance.com/api/v3/ticker/price` + 3 mirror |
| BTC Price (fallback) | CoinGecko | `api.coingecko.com/api/v3/simple/price` |
| BTC Price (fallback) | CryptoCompare | `min-api.cryptocompare.com/data/price` |
| BTC Klines (1m) | Binance → CryptoCompare | `/klines` + `/v2/histominute` |
| Polymarket Markets | Gamma API | `gamma-api.polymarket.com/events` |
| CLOB Orderbook | CLOB API | `clob.polymarket.com/book` |
| CLOB Orders/Trades | CLOB API (auth) | `clob.polymarket.com/order` |
| USDC Balance | CLOB API (auth) | `clob.polymarket.com/balance-allowance` |
| POL Balance | Polygon RPC | `polygon-rpc.com` → llamarpc → publicnode |
| Order Placement | TS Order Service | `127.0.0.1:3100` (local Node.js) |

---

## Env Variables — Dari Mana Dapetnya

### 1. POLY_PRIVATE_KEY
```
POLY_PRIVATE_KEY=0x...
```
**Sumber:** Private key wallet Ethereum kamu (MetaMask, dll).  
**Cara:** Export private key dari wallet → copy 64 hex chars (dengan prefix `0x`).  
**PENTING:** JANGAN share ini ke siapa pun.

---

### 2. POLY_API_KEY + POLY_SECRET + POLY_PASSPHRASE
```
POLY_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
POLY_SECRET=base64string...
POLY_PASSPHRASE=hexstring...
```
**Sumber:** Polymarket CLOB API credentials.  
**Cara dapet:**
```bash
cd bot && source venv/bin/activate
python3 -c "
import os
from dotenv import load_dotenv
load_dotenv('backend/envs/real2.env')  # ganti sesuai bot

from py_clob_client_v2.client import ClobClient
pk = os.getenv('POLY_PRIVATE_KEY').strip()
if not pk.startswith('0x'): pk = '0x' + pk
c = ClobClient(host='https://clob.polymarket.com', chain_id=137, key=pk)
creds = c.create_or_derive_api_key()
print(f'POLY_API_KEY={creds.api_key}')
print(f'POLY_SECRET={creds.api_secret}')
print(f'POLY_PASSPHRASE={creds.api_passphrase}')
"
```
Copy output ke env file.

---

### 3. POLY_FUNDER
```
POLY_FUNDER=0x...
```
**Sumber:** Polymarket deposit wallet address.  
**Cara:** Buka https://polymarket.com/settings → cari "Deposit Address" atau address yg menerima USDC.  
**Catatan:** Ini BERBEDA dari EOA address (yg dari private key). Deposit wallet adalah smart contract proxy tempat USDC kamu disimpan.

---

### 4. BUILDER_CODE
```
BUILDER_CODE=0x...
```
**Sumber:** Polymarket Builder profile.  
**Cara:** Buka https://polymarket.com/settings?tab=builder → copy "Builder Code" (bytes32 hex, 64 chars setelah `0x`).

---

### 5. RELAYER_API_KEY + RELAYER_API_ADDRESS + RELAYER_API_PASSPHRASE
```
RELAYER_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
RELAYER_API_ADDRESS=0x...
RELAYER_API_PASSPHRASE=hexstring...
```
**Sumber:** Polymarket Relayer (buat gasless auto-redeem).  
**Cara:** Buka https://polymarket.com/settings?tab=relayer → "Create Relayer API Key".

---

### 6. Bot Config
```
BOT_ID=real1
BOT_NAME=Alpha
BOT_MODE=real          # sim | dry_run | real
USDC_CAPITAL=11.0416     # modal awal (tracking)
POL_BALANCE=10.373335    # POL buat gas (tracking)
MAX_OPEN_POS=3          # max posisi open bersamaan
MIN_EV=0.04             # minimum Expected Value buat entry
DAILY_LOSS_LIMIT=3.0    # stop loss harian
BALANCE_FLOOR=2          # jangan trade kalau balance < ini
```

---

## Flow Setup Bot Baru (contoh: real2)

```bash
# 1. Copy template env
cp backend/envs/real1.env backend/envs/real2.env

# 2. Edit env — isi credential baru
nano backend/envs/real2.env

# 3. Test config
source venv/bin/activate
set -a; source backend/envs/real2.env; set +a
python backend/test_order.py real2

# 4. Start bot (TS service auto-start untuk real mode)
./run.sh real real2 -d

# 5. Monitor
tail -f logs/backend-real2-real.log logs/ts-order-real2.log
```

---

## Port Allocation

| Bot | Backend | Frontend | TS Order Service |
|---|---|---|---|
| real1 | 8001 | 3001 | 3100 |
| real2 | 8002 | 3002 | 3101 |
| realN | 8000+N | 3000+N | 3100+(N-1) |

---

## File Structure

```
bot/
├── backend/
│   ├── main.py              # All bot logic
│   ├── envs/
│   │   ├── real1.env         # Bot Alpha config
│   │   ├── real2.env         # Bot Beta config
│   │   ├── sim1.env          # Simulation configs
│   │   └── ...
│   ├── test_order.py         # Order readiness test
│   └── validate_real.py      # Pre-flight validator
├── ts-order-service/
│   ├── server.mjs            # TS order microservice
│   ├── run.sh                # TS service lifecycle
│   └── package.json
├── frontend-bot/             # React dashboard
├── run.sh                    # Main launcher (BE + FE + TS)
├── data/                     # Per-bot state + SQLite
└── logs/                     # Per-bot log files
```
