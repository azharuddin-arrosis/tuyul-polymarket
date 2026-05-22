# POLYMARKET BOT v3 — Forward Test Edition

## Deploy

```bash
# Upload ke server
scp -r polybot-v3/ user@server:~/polybot-v3
ssh user@server && cd ~/polybot-v3

# Build & start
docker compose up -d --build

# Dashboard → http://SERVER_IP:3001
```

## Flow penggunaan

1. Buka `http://server:3001`
2. **Setup Wizard** → input USDC + POL + pilih mode
3. Bot mulai scan market yang resolve cepat (BTC 5m, soccer, crypto daily)
4. Posisi terbuka tampil dengan **countdown timer real** ke waktu resolve
5. Saat equity **$100** → Salary engine otomatis tarik **70%**, lanjut **30%**

## Fast markets yang dicari

| Tipe | Contoh | Resolve |
|------|--------|---------|
| BTC 5m price | "BTC above $90k in 5 min?" | 5 menit |
| Crypto daily | "ETH close above $3k today?" | ~24 jam |
| Soccer | "Arsenal win tonight?" | 2-8 jam |
| NBA/NFL | "Lakers win today?" | 3-6 jam |
| Economic data | "CPI above 3% this week?" | 1-7 hari |

Market dengan resolve > 7 hari otomatis **dilewati**.

## Compound Logic

| Equity | Tier | Max Bet |
|--------|------|---------|
| < $20  | T0   | $1.00   |
| $20    | T1   | $1.00   |
| $40    | T2   | $2.00   |
| $60    | T3   | $3.00   |
| $100   | T5   | $5.00   |
| $200   | T10  | $10.00  |

## Salary System

- Equity capai **$100** → tarik **70%** = $70 gaji
- Sisa **30%** = $30 jadi modal baru
- Compound tier reset, target berikutnya $200, $300, dst.
- Total yang sudah ditarik terus ditrack di dashboard

## Gas Budget (50% Reserve)

Dari 11 POL:
- **5.5 POL dikunci** sebagai reserve (tidak terpakai)
- **5.5 POL usable** → ~110 transaksi @ $0.02/tx
- Alert di < 10 TX, auto-stop di < 2 TX

## Switch ke REAL

```bash
# 1. Edit .env
BOT_MODE=real
POLY_PRIVATE_KEY=0x...   # Export dari MetaMask — BUKAN Phantom
POLY_API_KEY=...
POLY_SECRET=...
POLY_PASSPHRASE=...

# 2. Restart backend
docker compose restart backend
```

## Commands

```bash
docker compose up -d --build    # build + start
docker compose down             # stop
docker compose logs -f backend  # backend logs
docker compose restart backend  # restart bot saja
docker compose ps               # status
```

## ⚠ Phantom vs MetaMask

| | Phantom | MetaMask |
|--|---------|----------|
| Chain | Solana | Ethereum / Polygon ✓ |
| Polymarket | ❌ Tidak bisa | ✅ Bisa |
| EIP-712 signing | ❌ | ✅ |

Export private key MetaMask: Settings → Accounts → Export Private Key
