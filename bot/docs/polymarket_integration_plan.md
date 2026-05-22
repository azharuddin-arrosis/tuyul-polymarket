# Polymarket Real-Mode Integration Plan (BTC-only, Auto-Claim)

**Tanggal:** 2026-05-20
**Target:** Bot bisa place real orders di Polymarket BTC 5m markets dengan capital nyata, biarkan resolve natural per window, auto-claim USDC saat resolve.
**Scope:** **BTC every 5 minutes ONLY.** Tidak ada multi-asset, tidak ada SL/TP per-trade (Polymarket tidak punya native SL/TP).

---

## 0. Decision: Kenapa Tidak Ada SL/TP

Polymarket = CLOB binary options. Tidak ada "SL/TP order type" native. Yang biasa disebut "SL/TP" di binary = bot manual place SELL order saat harga token hit threshold. Tapi:
- Window cuma 5 menit, bot entry biasanya T-10s → cuma 5-10 detik untuk trigger SL/TP sebelum resolve. Praktis tidak guna.
- Spread NO side lebar di akhir window → exit slippage tinggi
- Gas cost extra per exit ($0.005)
- Risiko: kalau SELL gagal fill (illiquid), state local & state Polymarket bisa drift

**Keputusan:** SL/TP **dihapus**. Bot pegang token sampai window resolve natural, lalu `redeemWinningPositions()` claim USDC. Risk management cukup di **portfolio-level circuit breakers**: max_loss_strike, max_win_strike, daily_tp_usd, daily_sl_usd, balance_floor.

---

## 1. Status Saat Ini (per cleanup 2026-05-20)

### Backend siap pakai
- `_build_clob_client()` — init `py-clob-client` dengan `signature_type=2` (EOA_POLY_PROXY)
- `place_order_with_retry()` — FOK → fallback GTL @ $0.95 → MISSED
- `fetch_balance_usdc()` via CLOB `BalanceAllowanceParams(COLLATERAL)`
- `fetch_balance_pol()` via Web3 RPC ke Polygon mainnet
- `redeem_winning_positions()` task — auto-claim USDC dari market resolved (real mode only, polling 60s)
- Mode `real` defaults `S.running=False` → butuh manual start
- Public CLOB orderbook polling (Phase 1) — backend tau harga real-time YES/NO token
- Mode toggle runtime (SIM / DRY-RUN / REAL) via `POST /api/mode` dgn safety
- Strategy config runtime via `POST /api/config`

### Removed (per cleanup)
- ~~`stoploss_monitor_loop`~~ — DELETED (no native SL/TP di Polymarket)
- ~~`_get_current_token_price`~~ — DELETED (unused)
- ~~Config fields `sl_pct`, `tp_pct`, `sl_enabled`, `tp_enabled`~~ — DELETED
- ~~Per-position `sl_pct`/`tp_pct` snapshot~~ — DELETED
- ~~Soccer scanner (`fetch_soccer_markets`, `scanner_loop` body, `/api/soccer`, `S.soccer_markets`)~~ — DELETED (BTC-only)
- ~~Frontend RISK MANAGEMENT section dgn SL/TP inputs~~ — REPLACED dgn CIRCUIT BREAKERS

### Yang sudah DONE (Phase 3 Hardening — 2026-05-20)
- ✅ Pre-flight validator `bot/backend/validate_real.py` (13 checks, 13 PASS untuk real1)
- ✅ Enforcement circuit breakers di entry gate: `daily_sl_usd`, `daily_tp_usd`, `max_loss_strike`, `max_win_strike`, `trading_start/end`, `price_min/max_cents`, `sentiment_lower/upper`
- ✅ Auto-pause bot saat circuit breaker hit (cleared on manual start)
- ✅ Auto-claim hardening: adaptive polling (15s/60s/300s), max 3 retries, REDEEM_CRITICAL log
- ✅ Position recovery on startup: `reconcile_real_positions()` flag missing/orphan (no auto-mutate)
- ✅ POL RPC fallback chain (5 RPCs + UA header bypass Cloudflare)

### Yang BELUM (Future iterations)
- ❌ Rate limit hardening (Gamma backoff exponential, CLOB jitter ±200ms, order idempotency check)
- ❌ Daily USDC reconciliation vs S.capital (drift detect > $0.50)
- ❌ Live log streaming sidebar untuk monitor real mode
- ❌ Order status sync (FOK partial / GTL rest tidak ter-refresh — edge case)

### Credentials `envs/real1.env` (TERISI)
- `POLY_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_SECRET`, `POLY_PASSPHRASE` ✓
- `USDC_CAPITAL=6.68`, `POL_BALANCE=11`, `BALANCE_FLOOR=2`, `DAILY_LOSS_LIMIT=3.0`

⚠️ **SECURITY:** `.env` jangan di-commit. Rotate keys quarterly. Cek `bot/.gitignore` cover `envs/*.env`.

---

## 2. Phase 1 — Pre-flight Validation (~30 min)

Tujuan: validate creds + connectivity TANPA place order. No risk.

### 2.1 Build `bot/backend/validate_real.py`

Standalone script (~80 LOC). Load env via `dotenv`, init CLOB client, jalankan checks:

| Check | Expected |
|---|---|
| Import `py_clob_client` | CLOB_OK=True |
| Import `web3` | WEB3_OK=True |
| `_build_clob_client()` returns non-None | OK |
| `client.get_address()` returns EOA address | print address |
| `fetch_balance_usdc()` ≥ 0 | print balance (~$6.68) |
| `fetch_balance_pol()` ≥ 5 POL | print balance (~11 POL) |
| `GET gamma /events?slug=btc-updown-5m-{current_window_ts}` | status 200, outcomes UP/DOWN, clobTokenIds present |
| `GET clob /book?token_id=...` | status 200, bids+asks present |
| Redeem dry-run: `get_open_orders()` works | no error |

Output: semua green ✓ atau red ✗. Kalau red → STOP, debug.

### 2.2 Eksekusi
```bash
cd /Users/azharuddinarrosis/Developments/poly/bot/backend
set -a; source ../envs/real1.env; set +a
../venv/bin/python validate_real.py
```

### 2.3 Common issues & fix
- **403 Gamma:** belum kasih `User-Agent` header → sudah ditangani di `_CLOB_UA`
- **USDC = 0:** signature_type salah → coba `1` vs `2`, atau wallet kosong → cek polygonscan
- **POL fetch fail:** `POLYGON_RPC` ngedrop → set ke alchemy/quicknode endpoint
- **CLOB token mismatch:** outcome order di Gamma berubah (Up/Down) → cek mapping

---

## 3. Phase 2 — Dry-Run Soak Test (1+ jam observe)

Tujuan: bot pakai real market data + real orderbook + real signal engine, tapi **tidak place real order**. Cek pipeline end-to-end.

### 3.1 Boot
```bash
cd /Users/azharuddinarrosis/Developments/poly/bot/backend
set -a; source ../envs/real1.env; set +a
BOT_MODE=dry_run DATA_DIR=/Users/azharuddinarrosis/Developments/poly/bot/data \
  ../venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Other terminal:
cd /Users/azharuddinarrosis/Developments/poly/bot/frontend-bot && npm run dev
```

### 3.2 Verifikasi (observe ≥ 12 windows = 1 jam)
- [ ] Orderbook panel menampilkan YES/NO ladder yang reasonable
- [ ] BTC chart + PTB target line update setiap 2s
- [ ] Setiap window mencetak signal di BTC5m panel
- [ ] `entry_fired=true` saat confidence ≥ `conf_threshold`
- [ ] Position muncul di OPEN POSITIONS dengan `order_id` prefix `DRY-`
- [ ] Position auto-resolve di end of window (sim true_prob-based)
- [ ] Tidak ada error rate-limit Gamma (>429)
- [ ] Tidak ada error CLOB orderbook polling
- [ ] Mode toggle SIM → DRY-RUN → SIM tanpa kehilangan state

### 3.3 Tuning sebelum naik ke REAL
- `conf_threshold`: tune ke 0.5-0.6 (default 0.25 → terlalu agresif untuk modal kecil)
- `bet_size`: $1 fixed (set `use_compound=false`)
- `daily_sl_usd`: 1.5 (≈22% dari $6.68 capital — kalau loss > 22% pause)
- `daily_tp_usd`: 3 (kalau profit $3 = ~45% di hari itu, pause take rest)
- `max_loss_strike`: 5 (5 loss berturut → pause)
- `trading_start/end`: 09:00-23:00 (skip jam ngantuk yang kemungkinan low liquidity)

---

## 4. Phase 3 — First Real Trade (~30 min, monitored)

⚠️ **HANYA setelah Phase 1+2 PASS.**

### 4.1 Pre-flight checklist (manual setiap kali)
- [ ] `validate_real.py` PASS hari ini
- [ ] USDC balance terbaca real via `/api/balance`
- [ ] POL balance ≥ 5 orders worth (`/api/gas` → `orders_left ≥ 5`)
- [ ] Mode = `dry_run` (sebelum switch)
- [ ] Bot stopped, no orphan positions
- [ ] Config tuned: `bet_size=1`, `conf_threshold=0.5`, daily limits set
- [ ] Tab Polymarket dibuka manual cross-check
- [ ] Polygonscan dibuka untuk verify tx

### 4.2 Eksekusi
1. UI → klik mode `REAL` → confirm dialog → bot pause otomatis
2. UI → klik tombol RUN (▶ hijau)
3. Tunggu BTC 5m window berikutnya
4. **Saat entry trigger:**
   - Backend: `place_order_with_retry` → FOK
   - Verify log `ORDER_FOK_OK` dgn `order_id` real (bukan `DRY-*`)
   - Verify Polymarket UI manual: order muncul
   - Verify UI: position muncul, side UP/DOWN, entry price, shares
5. **Saat window resolve:**
   - Bot **tidak** auto-close (mode real, no SL/TP)
   - `redeem_winning_positions` loop check resolution status setiap 60s
   - Setelah market resolved: trigger redeem TX di Polygon
   - Verify Polymarket UI: position settled
   - Verify `/api/balance` update setelah redeem
   - Verify polygonscan: tx redeem berhasil

### 4.3 Setelah trade pertama
- Stop bot via UI tombol STOP
- Switch mode kembali ke `dry_run` atau `sim`
- Review log untuk error pattern
- **Catat:** entry latency, slippage (entry price vs orderbook ask), gas cost actual, redeem latency
- Cek wallet via polygonscan: total gas spent sesuai estimasi?

### 4.4 Abort criteria
- USDC drop > 20% (≈$1.34): STOP, debug
- 2 trade missed (FOK+GTL fail) berturut: STOP, market mungkin illiquid
- Gas pause trigger: STOP, top-up POL dulu
- Redeem TX fail: STOP, manual redeem via Polymarket UI

---

## 5. Phase 4 — Hardening (2-3 jam coding)

### 5.1 PRIORITY 1: Enforce portfolio circuit breakers di `btc5m_loop` entry gate
**File:** `bot/backend/main.py` should_fire block (~line 1095)

Tambahkan check sebelum should_fire:
```python
# Portfolio-level circuit breakers
if cfg["daily_sl_usd"] > 0 and S.daily_pnl <= -cfg["daily_sl_usd"]:
    # Pause + log "DAILY_SL_HIT"; don't fire
if cfg["daily_tp_usd"] > 0 and S.daily_pnl >= cfg["daily_tp_usd"]:
    # Pause + log "DAILY_TP_HIT"; don't fire
if cfg["max_loss_strike"] > 0 and S.loss_streak >= cfg["max_loss_strike"]:
    # Pause + log "LOSS_STRIKE_HIT"; don't fire
if cfg["max_win_strike"] > 0 and S.win_streak >= cfg["max_win_strike"]:
    # Pause + log "WIN_STRIKE_HIT"; don't fire
# Trading hours gate
if not _in_trading_hours(cfg["trading_start"], cfg["trading_end"]):
    # Skip silently
# Price window
if cfg["price_min_cents"] > 0 or cfg["price_max_cents"] < 100:
    yes_price_c = int(round(b5["btc_price_or_token_price"] * 100))  # need YES token price not BTC
    if not (cfg["price_min_cents"] <= yes_price_c <= cfg["price_max_cents"]):
        # Skip
# Sentiment filter
if cfg["sentiment_upper"] != 0 or cfg["sentiment_lower"] != 0:
    if not (cfg["sentiment_lower"] <= b5["delta_pct"] <= cfg["sentiment_upper"]):
        # Skip
```

### 5.2 PRIORITY 2: Position recovery on startup (real mode)
**Problem:** Bot crash mid-position → restart load `state.json` → tapi state Polymarket adalah source of truth.

**Fix di `startup()` handler:**
- Kalau MODE=real: query `client.get_trades()` atau `client.get_open_orders()` dari CLOB
- Reconcile dengan `S.positions`:
  - Position di Polymarket tapi tidak di state → re-add
  - Position di state tapi tidak di Polymarket → kemungkinan sudah resolve → close_position via redeem check

### 5.3 PRIORITY 3: Auto-claim hardening
`redeem_winning_positions` saat ini polling 60s. Untuk window 5m, mungkin terlalu lama (1 menit waste). Improvements:
- Polling lebih cepat (30s) saat ada open position dgn `resolve_sec` terlampaui
- Track `claim_attempts` per position, max 3 retries
- Kalau redeem gagal 3x: log CRITICAL alert, manual review needed
- Setelah successful redeem: refresh USDC balance & broadcast `balance_update`

### 5.4 PRIORITY 4: Rate limit hardening
- Gamma: kalau 429 → exponential backoff (60s → 120s → 240s)
- CLOB orderbook: existing 2s polling OK, tapi tambahkan jitter ±200ms biar tidak burst
- POST order: kalau timeout, **JANGAN** auto-retry sampai cek order status via `client.get_order(order_id)` (idempotency check)

### 5.5 PRIORITY 5: Daily reconciliation
- Setiap awal hari (UTC midnight): query real USDC, bandingkan dgn `S.capital`. Drift > $0.50 → log + sync ke real.

---

## 6. Phase 5 — Production Deploy (1 jam, optional)

### 6.1 Docker compose minimal di `bot/`
File: `bot/docker-compose.yml` (baru). Skip multi-bot complexity:

```yaml
services:
  real1:
    build: ./backend
    container_name: pb-real1
    env_file: ./envs/real1.env
    environment:
      DATA_DIR: /app/data
    volumes: [shared_data:/app/data]
    networks: [polynet]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 15s
  dash:
    build: ./frontend-bot
    container_name: pb-real1-ui
    ports: ["3001:80"]
    depends_on: { real1: { condition: service_healthy } }
    environment: [BACKEND_HOST=real1]
    networks: [polynet]
    restart: unless-stopped
volumes: { shared_data: }
networks: { polynet: { driver: bridge } }
```

### 6.2 Monitoring
- `docker compose logs -f real1` tail
- Cron daily: dump logs ke `logs/real1-$(date +%F).log`
- (Future) Telegram/Discord webhook untuk alert critical events

---

## 7. Risk Matrix

| Risiko | Probabilitas | Impact | Mitigasi |
|---|---|---|---|
| Wallet drain via bug | Low | Critical | `BALANCE_FLOOR=2` hard stop, daily limit, manual review setelah trade #1 |
| API key leak | Low | Critical | `.env` gitignore, rotate keys quarterly |
| Network outage mid-position | Med | Med | `redeem_winning_positions` resume after recovery |
| Polymarket API down | Med | High | Bot auto-pause kalau Gamma/CLOB unreachable |
| Order tidak terfill (illiquid) | High | Low | FOK fail → GTL fallback → log MISSED, no capital lost |
| Double-fill saat retry | Low | High | TODO Phase 4.4: idempotency via order_id check |
| Gas habis | Med | Med | Auto-pause di `consume_gas`, alert UI |
| Bot crash mid-position | Low | High | TODO Phase 4.2: reconcile dengan CLOB di startup |
| Redeem TX fail | Low | High | TODO Phase 4.3: 3x retry, alert kalau gagal |
| Position never resolve | Very Low | Med | Polymarket market resolution dispute → manual claim via UI |
| Daily loss exceeded | Med | Med | TODO Phase 4.1: enforce `daily_sl_usd` |

---

## 8. Quick Reference Commands

### Pre-flight (Phase 1)
```bash
cd /Users/azharuddinarrosis/Developments/poly/bot/backend
set -a; source ../envs/real1.env; set +a
../venv/bin/python validate_real.py   # to be created
```

### Boot dry-run dengan creds real (Phase 2)
```bash
cd /Users/azharuddinarrosis/Developments/poly/bot/backend
set -a; source ../envs/real1.env; set +a
BOT_MODE=dry_run DATA_DIR=/Users/azharuddinarrosis/Developments/poly/bot/data \
  ../venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### Boot real mode (Phase 3)
```bash
cd /Users/azharuddinarrosis/Developments/poly/bot/backend
set -a; source ../envs/real1.env; set +a
DATA_DIR=/Users/azharuddinarrosis/Developments/poly/bot/data \
  ../venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
# Bot pause; mulai via UI atau:
curl -X POST http://localhost:8000/api/bot/start
```

### Switch mode via API
```bash
curl -X POST http://localhost:8000/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dry_run"}'
```

### Update config via API
```bash
curl -X POST http://localhost:8000/api/config \
  -H "Content-Type: application/json" \
  -d '{"bet_size": 1, "conf_threshold": 0.5, "daily_sl_usd": 1.5}'
```

### Inspect state
```bash
curl -s http://localhost:8000/api/positions | jq
curl -s http://localhost:8000/api/balance   | jq
curl -s http://localhost:8000/api/orderbook | jq
```

### Force stop
```bash
curl -X POST http://localhost:8000/api/bot/stop
```

### External monitoring
- Polymarket UI: https://polymarket.com (login dgn wallet ini)
- Polygonscan: https://polygonscan.com/address/{WALLET_ADDR} — derive via `validate_real.py`

---

## 9. Catatan Edukasi

### Cara CLOB order Polymarket bekerja
- **FOK (Fill-or-Kill):** order eksekusi instan kalau bisa fill semua, kalau tidak → cancel. Default kita.
- **GTL (Good-Till-Limit):** limit order rest di book sampai filled atau market resolve. Fallback @ $0.95.
- **Settlement:** USDC.e (bridged on Polygon) + gas POL/MATIC. Setelah window resolve → winning token = $1, losing token = $0. Bot redeem via contract.

### Kenapa `signature_type=2` (EOA_POLY_PROXY)?
Polymarket simpan USDC di proxy wallet (smart contract per user), bukan langsung di EOA. Signature pakai EOA private key, balance dari proxy. Type 2 = standard untuk EOA-controlled proxy.

### Auto-claim (`redeemPositions`)
Setelah market resolve, winning tokens belum otomatis jadi USDC di wallet. Harus call `redeemPositions()` di contract. Bot otomatis polling status resolution + call redeem. Cost: ~$0.005 gas per redeem.

### Why no SL/TP
Window 5m terlalu pendek untuk SL/TP berguna. Bot entry T-10s → cuma 5-10s untuk SL/TP trigger sebelum natural resolve. Lebih simpel: pegang sampai resolve.

---

## 10. Acceptance Criteria → "Production Ready"

✅ Phase 1 validator PASS setiap startup
✅ Dry-run mode 6 jam tanpa crash
✅ 5 trade real berturut tanpa error
✅ P&L tracker akurat (drift < 1% vs Polymarket UI)
✅ Auto-claim works 100% (no stuck positions)
✅ Recovery setelah restart preserves real positions (Phase 4.2 done)
✅ Portfolio circuit breakers enforced (Phase 4.1 done)
✅ Docker deploy stabil 1 minggu (Phase 5)

---

## 11. Open Questions Besok

1. Test Phase 1+2 dulu, atau langsung Phase 3 dgn modal $6.68?
2. POL=11 cukup atau perlu top-up? (11 POL ≈ 2200 orders, kemungkinan over)
3. 1 bot (real1) saja atau dual bot?
4. Notification: log file saja atau perlu Telegram/Discord?
5. Per-trade `bet_size` $1, atau pakai compound (floor(equity/10))? Kalau equity $6.68 → compound = $1 (sama).

---

**Next Session Start:**
1. Baca file ini
2. Mulai dari Section 2: build `bot/backend/validate_real.py`
3. Cek `bot/.gitignore` cover `envs/*.env`
4. Eksekusi Phase 1 → Phase 2 → (optional) Phase 3
