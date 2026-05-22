# Polypox Terminal — Code Architecture & Logic Flow

Panduan ini menjelaskan **alur kerja, struktur data, dan fungsi** setiap bagian di `backend/main.py`.

---

## Gambaran Besar

```
┌───────────────────────────────────────────────────────┐
│                   STARTUP (app.on_event)               │
│  db_init → load_state → db_load_daily_loss             │
│  → spawn 6 async loops (concurrent, run forever)       │
└────────────────┬──────────────────────────────────────┘
                 │
      ┌──────────┼──────────────────────────────┐
      │          │                              │
  btc5m_loop  orderbook_loop            scanner_loop
  (2s poll)   (2s poll)                 (housekeeping)
      │          │
  fetch BTC   fetch CLOB            ┌──────────────────┐
  price+klines book YES/NO          │  balance_refresh  │
  → analyze   → broadcast           │  (every 5min)    │
  → FIRE?     orderbook msg         └──────────────────┘
      │
  btc5m_entry → open_position
      │
  close_position (via resolver_loop SIM/DRY, atau redeem_winning_positions REAL)
```

---

## 1. Konfigurasi & Konstanta

### `class C` — Static Config (dari env vars)
Dibaca sekali saat startup, tidak berubah saat runtime.

| Field | Default | Fungsi |
|---|---|---|
| `usdc_capital` | 10 | Modal awal USDC |
| `pol_balance` | 11 | POL awal (gas) |
| `max_open_pos` | 5 | Maks posisi open bersamaan |
| `daily_loss_limit` | 5.0 | Hard daily stop (USD) |
| `gas_reserve_pct` | 0.50 | 50% POL dikunci, tidak dipakai |
| `gas_stop_orders` | 2 | Auto-stop jika tersisa < 2 order |
| `balance_floor` | 20 | Real mode: jangan trade jika USDC < ini |
| `poly_private_key` | env | Private key wallet Polygon |
| `poly_api_key` | env | API key L2 CLOB Polymarket |

### URL Constants
```python
GAMMA    = "https://gamma-api.polymarket.com"   # market discovery
CLOB     = "https://clob.polymarket.com"         # orderbook + orders
COINGECKO = "https://api.coingecko.com/api/v3"  # BTC price (primary)
CRYPTOCOMPARE = "..."                             # BTC price (fallback)
BINANCE  = "https://api.binance.com/api/v3"      # BTC price + klines (fallback)
BTC5M_WIN = 300                                  # 5 menit = 300 detik
```

---

## 2. State — Memori Bot

### `class BotState` → `S` (singleton)
Semua data runtime bot disimpan di objek `S`. **Tidak thread-safe secara default** — gunakan `_lock` (asyncio.Lock) untuk mutasi concurrent.

```
S.capital          = USDC yang tersedia (bisa dipakai buat trade)
S.locked           = USDC yang sedang terikat di posisi open
S.initial          = modal awal (untuk hitung PNL)
S.positions        = list posisi OPEN (dict)
S.closed_trades    = list posisi CLOSED (dict), max 300
S.log              = event log (max 500 entries), newest first
S.daily_pnl        = P&L hari ini (reset tiap tengah malam)
S.win_streak       = consecutive wins saat ini
S.loss_streak      = consecutive losses saat ini
S.running          = True = bot aktif (mau entry posisi)
S.gas_paused       = True = auto-stop karena POL menipis
S.btc5m            = dict state signal BTC 5m (price, klines, signal, dll)
S.orderbook        = dict snapshot CLOB YES/NO book
S.strategy_config  = dict config strategi (runtime-mutable, persisted)
S.mode             = mode aktif ("sim" | "dry_run" | "real")
```

#### `S.btc5m` — BTC 5m Signal State
```
slug               = "btc-updown-5m-{window_ts}"
win_ts             = timestamp awal window aktif
secs_left          = detik tersisa sampai window berakhir
btc_price          = harga BTC terkini (dari fetch setiap 2s)
win_open           = harga BTC di awal window (untuk window delta)
ticks              = list 30 harga terbaru dalam window (untuk tick trend)
klines             = list 30 candle 1m OHLC
predicted_dir      = "UP" | "DOWN" | "" (hasil analyze)
confidence         = 0.0 - 1.0 (kekuatan sinyal)
score              = raw score (-14 to +14, jumlah 7 indikator)
entry_fired        = True setelah bot fire posisi di window ini
in_entry_zone      = True jika secs_left 5-10 (zona entry normal)
market_data        = dict data market dari Gamma (id, prices, clob tokens)
```

---

## 3. Startup Flow

```python
@app.on_event("startup")
async def startup():
    db_init()          # create SQLite tables jika belum ada
    load_state()       # restore S dari state_{BOT_ID}.json
    db_load_daily_loss()  # restore S.daily_pnl dari SQLite (survive restart)
    
    # Spawn 6 background loops (concurrent, jalan terus)
    asyncio.create_task(btc5m_loop())
    asyncio.create_task(orderbook_loop())
    asyncio.create_task(scanner_loop())
    asyncio.create_task(balance_refresh_loop())
    asyncio.create_task(resolver_loop())
    asyncio.create_task(redeem_winning_positions())
    asyncio.create_task(reconcile_real_positions())
```

`S.running` di-set otomatis:
- **sim / dry_run**: `running = True` (langsung aktif)
- **real**: `running = False` (harus klik RUN di UI)

---

## 4. Async Loops (Concurrent Background Tasks)

### Loop 1: `btc5m_loop()` — Inti Bot
**Interval:** 2 detik terus-menerus

```
setiap 2s:
  1. Deteksi window baru? → reset state btc5m
  2. Fetch BTC price (CoinGecko → CryptoCompare → Binance fallback)
  3. Tiap 55s: fetch klines 1m dari CryptoCompare/Binance/synthetic
  4. Tiap 55s: fetch market data dari Gamma API
  5. Compute signal (7 indikator) → confidence, score, direction
  6. Cek circuit breakers (daily SL/TP, streak, hours, price, sentiment)
  7. Cek apakah harus FIRE:
     - in_entry_zone (T-10s→T-5s), ATAU
     - spike_detected (score naik ≥1.5), ATAU
     - hard_deadline (T-5s atau kurang)
  8. Jika FIRE → btc5m_entry() → open_position()
  9. Broadcast btc5m state via WebSocket
```

### Loop 2: `orderbook_loop()` — CLOB Realtime
**Interval:** 2 detik

```
setiap 2s:
  1. Ambil yes_token dan no_token dari S.btc5m.market_data._clob_token_map
  2. Fetch YES book + NO book secara parallel dari clob.polymarket.com/book
  3. Normalize: sort asks ascending, bids descending, cap 20 levels
  4. Hitung mid price per sisi
  5. Update S.orderbook
  6. Broadcast orderbook via WebSocket
```
> Note: Public endpoint (tidak perlu auth). Butuh User-Agent header karena default Python → 403.

### Loop 3: `scanner_loop()` — Housekeeping
**Interval:** setiap `scan_sec` (default 12s)

```
setiap 12s:
  1. daily_reset() — jika tanggal berubah, reset S.daily_pnl ke 0
  2. Broadcast stats + gas info via WebSocket
```

### Loop 4: `balance_refresh_loop()` — Balance Sync
**Interval:** setiap 5 menit (300s), mulai setelah 15s grace

```
setiap 5 min:
  1. fetch_balance_pol() — Polygon RPC (5 fallback chain + User-Agent)
  2. Jika real mode: fetch_balance_usdc() — via py_clob_client proxy wallet
     - Jika ada posisi open: JANGAN overwrite S.capital (bisa rusak locked split)
       → Hanya log jika drift > $5
     - Jika tidak ada posisi open: sync S.capital = on-chain USDC
  3. Broadcast balance_update via WebSocket
```

### Loop 5: `resolver_loop()` — Auto-resolve SIM/DRY
**Interval:** 5 detik

```
setiap 5s:
  Jika mode == "sim" atau "dry_run":
    → Cek setiap posisi open: sudah lewat resolve_sec?
    → Jika ya: simulasi resolve dengan random.random() < true_prob * 0.93
    → Panggil close_position(won)
  
  Jika mode == "real": skip (CLOB handle sendiri)
```

### Loop 6: `redeem_winning_positions()` — Auto-claim Real
**Interval:** adaptif 15s/60s/300s, hanya aktif di real mode

```
real mode only:
  Setiap iter:
    1. Cari posisi yang mungkin sudah resolve (elapsed >= resolve_sec * 90%)
    2. Untuk tiap kandidat:
       a. GET /markets/{market_id} dari CLOB → cek status closed/resolved
       b. Jika resolved:
          - Kalah → close_position(won=False)
          - Menang → panggil client.redeem_positions(condition_id) via executor
          - Refresh USDC balance dari CLOB
          - close_position(won=True)
       c. Jika redeem gagal → increment claim_attempts
          - ≥ 3 gagal → log REDEEM_CRITICAL (manual review via Polymarket UI)
  
  Adaptive sleep:
    - critical (≥3 attempt failures) → 300s
    - ada posisi expired → 15s
    - normal → 60s
```

### Loop 7: `reconcile_real_positions()` — Startup Reconcile
**Satu kali** saat startup (real mode only), setelah 8s grace

```
Startup only:
  1. get_orders() dari CLOB (semua open orders)
  2. Bandingkan dengan S.positions:
     - Di state tapi tidak di CLOB → RECONCILE_MISSING_CLOB
       (kalau sudah lewat resolve_sec → redeem loop akan handle)
       (kalau belum lewat → manual review)
     - Di CLOB tapi tidak di state → RECONCILE_ORPHAN_CLOB (manual review)
  3. Tidak mutasi posisi otomatis — hanya log/flag
```

---

## 5. Signal Engine — 7 Indikator

Fungsi: `btc5m_analyze(klines, price, win_open, ticks) → {dir, confidence, score}`

Setiap indikator menghasilkan skor positif (UP) atau negatif (DOWN).
Total score maksimum ≈ ±14. Confidence = `min(|score|/7, 1.0)`.

| # | Indikator | Max Score | Cara Hitung |
|---|---|---|---|
| 1 | **Window Delta** | ±7 | `(price - win_open) / win_open * 100`. Makin besar delta → weight 7, 5, 3, 1 |
| 2 | **Micro Momentum** | ±2 | 2 candle terakhir sama arah → ±2, mixed → 0 |
| 3 | **Acceleration** | ±1.5 | Momentum sekarang > momentum sebelumnya → +1.5 |
| 4 | **EMA 9/21** | ±1 | EMA9 > EMA21 → +1 (butuh ≥21 candle) |
| 5 | **RSI 14** | ±2 | RSI < 25 (oversold) → +w, RSI > 75 (overbought) → -w |
| 6 | **Volume Surge** | ±1 | Volume 3 candle terbaru > 1.5× prior 3 → ±1 sesuai arah harga |
| 7 | **Tick Trend** | ±2 | 60%+ ticks naik + move > 0.005% → +2 |

```python
direction  = "UP" if score > 0 else "DOWN"
confidence = min(abs(score) / 7.0, 1.0)
if confidence < 0.25: direction = ""  # tidak cukup kuat
```

**Entry hanya terjadi jika:**
- `direction != ""`
- `confidence >= conf_threshold` (default 0.25)
- Di entry zone (T-10s→T-5s) ATAU spike ATAU deadline

---

## 6. Siklus Posisi (Trade Lifecycle)

```
btc5m_loop detects FIRE condition
         ↓
btc5m_entry(sig, secs_left, sess)
  → parse outcomes + prices dari market_data
  → hitung true_prob, ev_val
  → panggil open_position(market_dict, sig_dict)
         ↓
open_position(market, sig)
  [_lock]
  1. risk_ok() → cek: running? gas_paused? daily_loss? max_pos? capital cukup?
  2. calc_size() → compound_bet(equity), max 40% capital
  3. Kurangi S.capital, tambah S.locked
  4. Buat pos dict
  [release lock]
  
  SIM:     order_id = "sim-fok-{ts}" (random 90% FOK, 9% GTL, 1% miss)
  DRY_RUN: order_id = "DRY-{pos_id}" (no CLOB call)
  REAL:    place_order_with_retry() → FOK → GTL fallback → MISSED
           Jika gagal: rollback S.capital + S.locked
  
  [_lock]
  5. Tambah ke S.positions
  6. consume_gas() → kurangi S.pol_left
  7. add_log("OPEN", ...)
  [release lock]
  8. broadcast positions + stats + log
         ↓
[window berakhir]
         ↓
SIM/DRY: resolver_loop → random resolve → close_position(won)
REAL:    redeem_winning_positions → cek CLOB → redeem → close_position(won)
         ↓
close_position(pos, won)
  [_lock]
  1. Hitung payout dan pnl
     Menang: payout = size/price (misal beli 1 USDC di harga 0.6 → dapat 1.67 USDC)
     Kalah:  payout = 0, pnl = -size
  2. Update S.capital, S.locked
  3. Update S.daily_pnl, S.lifetime_pnl
  4. Update btc5m stats (wins/losses)
  5. check_compound_levelup() → compound tier naik?
  6. check_salary() → equity > threshold → withdraw 70%
  7. db_save_trade(pos) → simpan ke SQLite
  8. db_save_daily_loss() → persist daily pnl
  9. save_state() → simpan state_{BOT_ID}.json
  [release lock]
  10. broadcast log + positions + stats
```

---

## 7. Circuit Breakers

Dicek di `btc5m_loop` sebelum setiap entry via `check_circuit_breakers(cfg, b5)`.

| Breaker | Trigger | Efek |
|---|---|---|
| `daily_sl_usd` | `daily_pnl ≤ -X` | **Auto-pause bot** (`S.running = False`) |
| `daily_tp_usd` | `daily_pnl ≥ +X` | **Auto-pause bot** |
| `max_loss_strike` | `loss_streak ≥ N` | **Auto-pause bot** |
| `max_win_strike` | `win_streak ≥ N` | **Auto-pause bot** |
| `trading_start/end` | Di luar jam trading | Skip entry (tidak pause) |
| `price_min/max_cents` | YES token di luar range | Skip entry |
| `sentiment_lower/upper` | BTC delta% di luar range | Skip entry |

**Auto-pause** (`auto_pause_if_breaker`): idempotent, hanya pause sekali per alasan unik.
**Resume**: `POST /api/bot/start` → clear `_breaker_paused_reason` + `S.running = True`.

---

## 8. Gas Engine

POL dipakai untuk biaya transaksi di Polygon.

```python
gas_usable_pol()      = S.pol_left * 0.50        # 50% usable, 50% reserved
gas_cost_per_order()  = 0.02 USD / 0.40 USD/POL  = 0.05 POL per order
gas_orders_left()     = usable_pol / cost_per_order

Status:
  "ok"       → orders_left > 5
  "low"      → 2 < orders_left ≤ 5  (warning log)
  "critical" → orders_left ≤ 2      (auto-stop, S.gas_paused = True)

Resume: POST /api/gas/resume → S.gas_paused = False
```

---

## 9. Compound & Salary

### Compound (auto-sizing)
```python
compound_bet(equity) = min(max(floor(equity / 10), 1), 50)

Contoh:
  equity $10  → bet $1
  equity $15  → bet $1  (masih floor tier 1)
  equity $20  → bet $2
  equity $50  → bet $5
  equity $500 → bet $50 (maksimum)
```

Trade size actual = `min(compound_bet, available_capital * 0.40, capital)`.

### Salary (auto-withdraw)
```python
Jika equity >= salary_target (default $100):
  withdraw = equity * 0.70
  keep     = equity * 0.30
  salary_target += 100  # target naik $100 untuk withdrawal berikutnya
```

---

## 10. Storage

### `state_{BOT_ID}.json` — Per-bot snapshot
Disimpan setiap `save_state()` (setelah open/close position, config change, mode change).
Yang disimpan: `capital, locked, initial, positions, closed_trades[-300], btc5m_stats, mode, strategy_config, streaks, compound_events, salary_events`.

**Load at startup** → bot lanjut dari sesi sebelumnya (capital, config, history).

### `trades.db` — SQLite (shared across bots)

| Table | Isi |
|---|---|
| `trades` | Semua trade yang sudah close (won/lost) |
| `sessions` | Log setiap startup bot |
| `log_events` | Event log (opsional) |
| `daily_loss` | PnL harian per bot — survive restart |

`daily_loss` penting: kalau bot restart di tengah hari, `db_load_daily_loss()` restore `S.daily_pnl` yang benar — circuit breaker daily_sl tetap akurat.

---

## 11. Order Execution (Real Mode)

Fungsi: `place_order_with_retry(market_id, outcome, price, size, sess, clob_token_id)`

```
Strategi 3 langkah:
  1. FOK (Fill-or-Kill) — market order, isi sekarang atau batal
     Sukses → "FOK" order_id
  
  2. Jika FOK gagal → GTL (Good-Till-Limit) @ min(0.95, signal_price)
     Limit order yang tetap aktif sampai expire
     Sukses → "GTL" order_id
  
  3. Jika GTL juga gagal → MISSED_TRADE
     Capital di-rollback ke S.capital

clob_token_id: ERC-1155 token ID per outcome (dari Gamma clobTokenIds).
               Berbeda dengan market_id (integer Gamma) — CLOB memakai token ID.
```

---

## 12. Mode Behavior

| Aspek | SIM | DRY_RUN | REAL |
|---|---|---|---|
| Data BTC price | Real (CoinGecko) | Real | Real |
| Data orderbook | Real (public CLOB) | Real | Real |
| Data market | Real (Gamma API) | Real | Real |
| Order ke CLOB | ❌ (simulasi random) | ❌ (DRY-{id} stamp) | ✅ FOK→GTL |
| Capital berubah | Sim (state only) | Sim (state only) | Real USDC |
| Auto-resolve | `resolver_loop` (random) | `resolver_loop` (random) | `redeem_winning_positions` |
| Auto-start | ✅ running=True | ✅ running=True | ❌ running=False (manual RUN) |
| Balance fetch | State only | State only | On-chain via CLOB + RPC |
| Credential needed | ❌ | ❌ | ✅ PRIVATE_KEY + API_KEY |

---

## 13. WebSocket Message Types

Frontend connect ke `/ws`. Saat connect: pesan `init` dikirim dengan seluruh state.
Selama bot jalan: loop-loop broadcast pesan ini realtime.

| Type | Trigger | Isi |
|---|---|---|
| `init` | WS connect | stats + positions + log + btc5m + orderbook + config + history + gas + balance |
| `stats` | mode change, open/close pos, scanner | `get_stats()` |
| `btc5m` | setiap 2s dari btc5m_loop | harga BTC, signal, klines, indicators |
| `orderbook` | setiap 2s dari orderbook_loop | YES/NO book depth |
| `positions` | open/close position | list posisi open |
| `log` | setiap event | entry log terbaru |
| `gas` | scanner_loop | gas info (orders_left, pol_left) |
| `gas_stop` | POL critical | gas alert |
| `balance_update` | balance_refresh_loop, redeem | USDC + POL terbaru |
| `compound_up` | tier compound naik | event compound |
| `salary` | equity > threshold | event salary withdrawal |
| `config` | POST /api/config | strategy config terbaru |

---

## 14. API Routes Ringkas

```
GET  /health                → status bot (running, mode)
GET  /api/stats             → semua stats (kapital, win, loss, dll)
GET  /api/btc5m             → signal + price + klines BTC 5m
GET  /api/orderbook         → snapshot YES/NO book
GET  /api/positions         → posisi open
GET  /api/history           → riwayat trade
GET  /api/log               → event log
GET  /api/gas               → info gas POL
GET  /api/balance           → USDC + POL balance live
GET  /api/config            → strategy config + mode
POST /api/config            → update config (partial, auto-save)
POST /api/mode              → ganti mode (dengan safety checks)
POST /api/bot/start         → mulai bot (clear breaker flag)
POST /api/bot/stop          → stop bot
POST /api/gas/resume        → resume setelah gas paused
POST /api/reset             → wipe state (hati-hati!)
WS   /ws                    → realtime stream
```

---

## 15. Dependency & Libraries

| Library | Kegunaan |
|---|---|
| `fastapi` | Web framework + WebSocket |
| `aiohttp` | Async HTTP (Binance, CoinGecko, Gamma, CLOB) |
| `asyncio` | Concurrent loops |
| `sqlite3` | Database trades + daily loss |
| `py_clob_client` | Polymarket CLOB API (order, redeem, balance) — optional |
| `eth_account` | Derive wallet address dari private key — optional |
| `uvicorn` | ASGI server |

`py_clob_client` dan `eth_account` dicek saat import, bot tetap jalan tanpa mereka (`CLOB_OK=False`, `WEB3_OK=False`) — cuma real mode yang butuh.
