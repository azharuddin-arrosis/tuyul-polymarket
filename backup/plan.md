# PolyBot Trading Plan

## Current Status: Simulation Testing

---

## Bot Configuration

| Bot | Threshold | Description |
|-----|----------|------------|
| VORTEX | 52% | 5 bots (0-4) |
| PHANTOM | 52% | |
| TITAN | 52% | |
| REAPER | 52% | |
| NEON | 52% | |
| KRAKEN | 55% | 5 bots (5-9) |
| QUANTUM | 55% | |
| APOLLO | 55% | |
| ZENITH | 55% | |
| HYDRA | 55% | |

---

## Strategy: Trend Following

**Entry Condition**:
- Probability antara threshold-5% dan threshold+20%
- Bukan terlalu tinggi (udah peak)
- Bukan terlalu rendah (unlikely)

**Bet Sizing**:
- Dynamic berdasarkan confidence
-rumus: `balance.sqrt() * 0.3 * confidence`

---

## Deployment Plan

### Phase 1: Simulation (Current)
- **Tujuan**: Test strategy, record performance
- **Durasi**: Sampe profit konsisten
- **Modal**: Fake $10/bot
- **Risk**: 0

### Phase 2: Testnet (Amoy)
- **Tujuan**: Learn real trading flow
- **Durasi**: 1-2 minggu
- **Modal**: Testnet USDC (free from faucet)
- **Risk**: 0 (test money)

### Phase 3: Mainnet (Production)
- **Tujuan**: Real profit
- **Durasi**: Ongoing
- **Modal**: Small USDC (~$10-20)
- **Risk**: Ada - only what you can lose

---

## Testing Checklist

- [ ] Run simulation min 1 minggu
- [ ] Record win rate per market type
- [ ] Calculate average profit/loss per day
- [ ] Verify consistent profit (min 60% win rate)
- [ ] Switch to testnet
- [ ] Test placing order
- [ ] Test resolving trades
- [ ] Verify gas usage
- [ ] Switch to mainnet small
- [ ] Monitor closely

---

## Notes

- Polygon gas can spike (~$0.01-0.10)
- BTC Up/Down markets: transient, muncul ~5 menit sebelum start
- BTC/Soccer/World Cup filter available

---

## Commands

```bash
# Start simulation
cargo run --release

# Check status
curl http://localhost:8080/api/status

# Start all bots
curl -X POST http://localhost:8080/api/start-all \
  -H "Content-Type: application/json" \
  -d '{"total_capital":10,"per_bot":10}'

# Check specific bot
curl http://localhost:8080/api/bot/VORTEX
```