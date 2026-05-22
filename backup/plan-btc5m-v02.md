# BTC 5m Bot v02 - Plan

## Fitur Baru

### 1. Active Markets - 5 Next Markets
- Tampilkan 5 market berikutnya (bukan hanya 1)
- Otomatis update setiap 5 menit

### 2. Simulate Feature
- Testnet: Polygon Amoy
-模拟交易 tanpa uang sungguhan
- Hitung gas fees, potential profit/loss

## API untuk Simulasi

### Testnet Endpoints
- CLOB: `https://clob.polymarket.com` (testnet juga sama)
- RPC: `https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY`
- Chain ID: 80002 (Amoy)

### Data yang Perlu diTrack
- Gas fee estimation
- Expected profit jika bet menang
- Expected loss jika bet kalah
- Total biaya (bet + gas)

## Plan Implementasi

### Phase 1: Update Dashboard
- Active Markets: 5 next markets
- Tambah info: start/end time
- Clickable ke Polymarket

### Phase 2: Simulate Feature
- Setup testnet connection
- Calculate gas costs
- Show potential P&L
- No real money - just simulation

## Environment Variables untuk Simulasi
```
USER_ADDRESS=0x...         # Wallet address
RPC_URL_DEV=...           # Amoy RPC (testnet)
PRIVATE_KEY=...           # Private key untuk signing
SIMULATE=true             # Enable simulation mode
BET_AMOUNT=1.0           # Amount per bet
```

## Note
- Bot tidak akan place order real
- Hanya simulate untuk melihat potential outcomes
- Gas fees di testnet mungkin berbeda dengan mainnet
