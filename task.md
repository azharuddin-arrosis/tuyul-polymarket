# Plan: Bitcoin + Soccer Simulation

## Konfigurasi

### Bot Threshold
- **Bots 0-4** (VORTEX-PHALN-TITAN-REAPER): 52%
- **Bots 5-9** (NEON-KRAKEN-QUANTUM-APOLLO-ZENITH-HYDRA): skip HYDA, only 4 left
- **Total**: 5 bots @ 52%, 5 bots @ 57%

### Market Filter
- **Bitcoin**: keyword "BTC", "Bitcoin", "crypto"
- **Soccer**: keyword "soccer", "football", "Premier League", "World Cup"

### Gas Fees
- Polygon: ~$0.01-0.05 per transaction
- Kurangin dari bet_amount saat place order

## Task List

### 1. Filter Markets (Bitcoin + Soccer)
- Fetch dari Gamma API
- Filter berdasarkan question contain BTC/crypto/football/soccer

### 2. Update Bot Thresholds
- Bots 0-4: 52%
- Bots 5-9: 57%

### 3. Add Gas Fee Config
- GAS_FEE=0.05 (default $0.05)
- Kurangi dari bet amount

### 4. Check .env Variables
- TELEGRAM, POLY_API_KEY, POLY_API_SECRET, etc

## Implementation

### File: main.rs
- `filter_markets_by_category()` function
- Update threshold logic di start_all_bots
- Add gas fee handling

## Test
- [ ] curl gamma-api → check BTC/soccer markets
- [ ] Run bot → verify threshold 52%/57%
- [ ] Check logs → market filter working