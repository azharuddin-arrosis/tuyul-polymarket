# Claude Work History — Polypox Terminal

Resume of work sessions by Claude (Sonnet/Opus). Tujuan: track decision, avoid repeat work, easy handover.

> Format: bukan changelog mekanis. Yang dicatat: **decision + reason + lesson**. Code detail liat git history.

---

## Session: 2026-05-21 → 2026-05-22 (Polypox MVP → Real Mode Ready)

### Phase 1: Diskusi dasar dry_run mode behavior
**User question:** dry_run mode itu beneran pakai real data? capital tetap jalan gak? auto-start atau manual?

**Answer disepakati:**
- dry_run = forward test dengan real market data (Binance, CLOB orderbook, Gamma) + simulated fill (no real CLOB order)
- Capital tidak terkonsumsi (state-only)
- Auto-start (S.running=True), beda dengan REAL yang paused

**Lesson:** Pastikan user understand mode behavior sebelum testing. dry_run sangat berguna untuk soak test.

---

### Phase 2: Network error investigation
**Symptom:** Banyak `gaierror: nodename nor servname provided` di log backend.

**Root cause:** Bukan DNS failure, tapi **aiohttp shielded future log warning** saat task DNS dibatalkan/timeout sementara connection lain masih jalan. Bot tetap healthy.

**Fix:** Identified that `S.errors[-5:]` kosong = bot OK. Errors itu cosmetic. Tidak perlu fix critical.

**Lesson:** Selalu cek `S.errors` di state untuk distinguish noise vs real bug.

---

### Phase 3: Code architecture documentation
**Request:** Buat doc lengkap arsitektur code biar paham flow + struktur.

**Output:** `docs/code-architecture.md` — 15 sections, dari Class structure, async loops, signal engine, lifecycle, sampai mode comparison.

**Lesson:** Doc ini jadi reference utama untuk handover. Update kalau ada perubahan structural.

---

### Phase 4: Logging improvements (terminal feedback)
**Pain point:** Terminal cuma kelihatan `NEW WINDOW` dan `FIRE`. User mau tahu real-time apa yang bot lagi lakukan.

**Added strategic prints:**
- `══ NEW WINDOW ══` setiap window baru
- `Market FOUND` sekali per window dengan price YES/NO
- `T-Xs | BTC $... | DIR conf=X.XX score=X.X | mkt✓` setiap 60s
- `⚡ SPIKE` saat score jump ≥1.5
- `─── ZONE T-Xs ───` saat masuk entry zone
- `✅ FIRE` atau `⏭ SKIP` dengan alasan

**Fix bug:** Python output buffering ke file. Solution: `PYTHONUNBUFFERED=1` + `python -u`. Update di `run.sh`.

**Lesson:** Strategic logging > spam logging. User mau visibility tapi tidak overwhelmed.

---

### Phase 5: Compound formula change
**Decision:** Ganti dari `floor(equity/10)` ke `5% flat rounded to $0.10`.

**Reason:** Tier-based (10, 20, 30...) lompat tiba-tiba. 5% lebih smooth + konservatif untuk modal kecil.

**Final formula:**
```python
compound_bet(equity) = max(1.0, floor(equity * 0.05 * 10) / 10)  # min $1, max $50
```

| Equity | Old (tier) | New (5%) |
|---|---|---|
| $10 | $1 | $1 |
| $50 | $5 | $2.50 |
| $100 | $10 | $5 |
| $200 | $20 | $10 |

**Lesson:** Smoothness > simplicity untuk compounding.

---

### Phase 6: Log differentiation — SIGNAL vs BET OPEN
**Pain point:** "FIRE" log misleading — bisa fire tapi position tidak masuk karena `btc5m_entry` silent return (EV too low, price out of range, dll).

**Solution:**
- Renamed `FIRE` → `🎯 SIGNAL [reason] → opening bet...`
- Added log di setiap silent return: `⚠ ENTRY SKIP — EV too low: ev=-0.12 conf=0.36`
- Added `📈 BET OPEN [MODE] {id} {side} ${size}@{price}¢ EV={ev} conf={conf}` di open_position
- Added `✅ BET CLOSE` / `❌ BET CLOSE` di close_position dengan PNL

**Lesson:** Distinguish "signal triggered" vs "actual order placed" untuk debugging.

---

### Phase 7: Dashboard layout iteration
Multiple iterations terkait UI/UX:

1. **Hide Strategy Config sidebar** → move ke modal dengan button `⚙ CONFIG`. Dashboard jadi full width.
2. **Chart molor (stretched)** → fix dengan ResizeObserver, viewBox responsif.
3. **Chart sedikit data** → fix backend kirim 60 → 120 klines. Frontend default show 60, panable ke 120.
4. **Layout 2:1 (chart:orderbook)** → grid `2fr 1fr`.
5. **Button RUN/STOP melayang** → move ke Header status bar.
6. **Color softer** → ganti pure black `#000` → `#0d0d0f` charcoal. Soften green/red.
7. **PNL Calendar** dipindah samping OpenPositions (3 kolom: OpenPos | Trades | Calendar).
8. **Chart redesign TradingView style** — padding lebih, Y-axis dipisah kanan, volume bars, current price line.

**Lesson:** UI iteration jalan paralel dengan backend. User feedback langsung diimplementasi cepat.

---

### Phase 8: 2 orderbooks (Polymarket CLOB + Binance)
**User vision:** Show YES/NO probabilities (Polymarket) + real BTC orderbook (Binance) side by side.

**Implementation:**
- `OrderBook` component (existing): full bids+asks YES & NO + imbalance indicator
- New `BinanceOrderbook` component: REST fetch `/api/v3/depth?symbol=BTCUSDT&limit=20`, poll 2s
- Layout: right column split vertically — CLOB atas, Binance bawah
- Status indicator `● LIVE` / `○ BLOCKED (VPN?)` per orderbook

**Lesson:** Frontend bisa fetch external API langsung (no backend proxy needed) kalau user punya VPN setup. Lebih simple.

---

### Phase 9: TradingView hybrid embed
**User question:** Bisa embed TradingView gak biar pakai full features tapi tidak hilangkan analytics kita?

**Answer:** Yes — pakai toggle 3-mode:
- `LINE` — custom SVG line chart
- `CANDLES` — custom SVG candles (default)
- `📊 TV` — TradingView Advanced Chart embed

Toggle ini purely **visual** — bot logic & data tidak terpengaruh. Signal engine tetap jalan di backend.

**Implementation:**
- `TradingViewWidget` component pakai embed script
- `BtcChart` mode dispatch — kalau `tv` render widget, else render `CustomBtcChart`
- ChartFrame header (BTC price, PTB, MARKET direction, UP/DOWN) tetap visible di semua mode

**Lesson:** Don't reinvent. Embed established tools when features matter > integration.

---

### Phase 10: Open Positions redesign (table → cards)
**User request:** Table monoton, mau format card yang bisa expand untuk lihat detail.

**Implementation:** `PositionCard` component
- Collapsed: 2 rows (ID + side + countdown + PNL · entry + current UP/DOWN + size + shares)
- Border-left warna SIDE (UP hijau / DOWN merah)
- Background warna PNL (profit hijau / loss merah)
- Click → expand: full metadata grid (OPENED dual-TZ, MODE, EV, CONFIDENCE, ORDER_ID, MARKET_ID, CONDITION_ID, full question)
- Link `↗ View on Polymarket` ke `polymarket.com/event/btc-updown-5m-{ts}`
- Countdown auto-update setiap 1s, blink red ≤10s

**Same pattern applied to HistoryCard** — closed trades with WIN/LOSS badge, payout, dll.

**Lesson:** Card list lebih scalable untuk dense info. Tooltip + expand > tons of columns.

---

### Phase 11: PNL Calendar with click → modal detail
**User request:** Kasih calendar view P&L per hari. Click cell → muncul modal list trade di tanggal itu.

**Implementation:**
- `PnlCalendar` component: grid 7 kolom (Mo-Su), navigate ◀ ▶
- Cell color: intensity by abs(P&L) / max. Green profit / red loss / grey no trades.
- Today border amber.
- Click cell with trades → `DayTradesModal` 680px wide list of trades that day.

**Bug fix:** Calendar group by UTC date (`opened_at.slice(0,10)`) tapi user di WIB. Trade jam 03:00 WIB = jam 20:00 UTC kemarin → masuk tanggal salah.

**Fix:** Added `localDateKey(date)` helper. Calendar + DailyTable now group by local date.

**Lesson:** TZ awareness penting untuk display. Calendar harus match user's wall clock.

---

### Phase 12: Real mode preparation
**Goal:** Audit dan harden bot sebelum first real trade.

**Created:** `backend/validate_real.py` (~360 LOC) — pre-flight validator 17 checks.

**Checks:**
1-2: deps import (py_clob_client, eth_account)
3-6: env vars set
7: CLOB client build + wallet address
8: USDC balance (proxy wallet via signature_type=2)
9: POL balance (5-RPC fallback chain — polygon-rpc.com mulai 401 di 2026)
10: Gamma BTC 5m market aktif
11: CLOB orderbook reachable
12: CLOB get_orders() authenticated
13: USDC allowance > 0 (after `phase 12 fix`)
14-15: Binance reachable (price + klines)
16: CLOB /markets/{conditionId} (after `phase 12 fix`)
17: Order signing test (no submit)

**Endpoint status table** di akhir output dengan UP/DOWN warna.

**UX improvements:**
- Auto re-exec dengan venv site-packages (no manual venv activate)
- Auto-load env file dari argument: `./validate_real.py real1`
- Dari folder bot/ atau backend/ — both work

**Bug found di phase 13:** CLOB `/markets/{id}` 404 karena kita pakai Gamma integer `id`, padahal CLOB butuh `conditionId` (hex). Critical bug — auto-claim akan selalu fail.

**Fix:** 
- Backend: store `conditionId` from Gamma in `mkt_dict` + `pos.condition_id`
- `redeem_winning_positions` pakai `condition_id` untuk both `GET /markets/` dan `client.redeem_positions(condition_id=...)`
- Validator check 10 updated to use `conditionId`

**Lesson:** Always cek API contract carefully — same word ("market_id") bisa beda format di tools berbeda.

---

### Phase 13: Endpoint status + latency monitoring
**User request:** Tau berapa latency ke Polymarket dan Binance, color-coded.

**Implementation:** `useLatency` hook ping setiap 8s ke:
- `api.binance.com/api/v3/ping`
- `clob.polymarket.com/time`
- `/health` (backend)

Color thresholds:
- white < 150ms (excellent)
- blue 150-400ms (good)
- amber 400-800ms (slow)
- red > 800ms / fail (bad)

Display di info strip bawah chart: `BNB 89ms · POLY 142ms · BE 12ms`.

**Lesson:** Latency monitoring penting untuk trade bot. Especially Binance dengan VPN.

---

### Phase 14: USD/IDR realtime
**User question:** USD_IDR hardcode 16250 — bisa fetch real?

**Implementation:** 3-source fallback fetch:
1. `open.er-api.com/v6/latest/USD`
2. `api.exchangerate-api.com/v4/latest/USD`
3. `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api`

Cache 24h di localStorage. Refresh tiap 1 jam via `useEffect` di App. `forceUpdate` trigger re-render saat rate change.

**Lesson:** Module-level mutable var + state-driven re-render = simple pattern untuk app-wide currency.

---

### Phase 15: Stats grid expansion
**User request:** Add MODAL AWAL card, USD + IDR di semua card.

**Final 9 cards:**
1. MODAL AWAL (initial capital + gain %)
2. EQUITY (avail + locked)
3. TOTAL PNL (with ROI%)
4. DAILY PNL (today only)
5. WIN
6. LOSS
7. PENDING
8. WIN RATE
9. TOTAL SPEND (with fees subtotal)

Setiap card USD-bearing punya sub IDR conversion + extra context.

**Lesson:** Dense info on top, expandable detail below = good dashboard pattern.

---

### Phase 16: Daily P&L bug
**Symptom:** `daily_pnl = 3.2471` tapi `lifetime_pnl = 1.061`. Daily > lifetime impossible.

**Root cause:** SQLite `daily_loss` table tidak ter-reset saat `api/reset`. Saat backend restart → `db_load_daily_loss()` reload stale value → tambah ke new trades → corrupt.

**Fix:** `api/reset` sekarang `DELETE FROM daily_loss WHERE bot_id=?`.

**Lesson:** State reset wajib cover both memory + persistence layers.

---

### Phase 17: Data persistence (DATA_DIR)
**Symptom:** State + trades.db hilang setiap reboot/laptop close.

**Root cause:** `DATA_DIR=/tmp/polypox-{BOT_ID}` default — `/tmp` di macOS dihapus saat reboot.

**Fix:** Default `DATA_DIR=$BOT_ROOT/data/{BOT_ID}` (persistent). Migrate existing dari `/tmp` ke `data/`. Update `.gitignore` add `data/`.

**Lesson:** Default paths matter. Cross-platform thinking — `/tmp` semantics berbeda OS.

---

### Phase 18: Background mode + run.sh refactor
**User need:** Jalankan bot 24 jam — tutup laptop tidak boleh kill.

**Implementation:**
- `./run.sh dry_run real1 -d` — detach mode: startup verify, save PIDs to `logs/polypox.pid`, exit cleanly
- `./run.sh stop` — kill background instance via PID file
- Frontend health check fix: check both `localhost:3001` (IPv6) dan `127.0.0.1:3001` (IPv4), timeout 30s

**Lesson:** Detach pattern via PID file simpler than systemd untuk dev use.

---

### Phase 19: WebSocket history broadcasts
**Symptom:** TOTAL_PNL ($15) != calendar total ($10). 5$ trades missing.

**Root cause:** WS `init` cuma kirim 40 history. Backend punya 52, frontend dapat 40, calendar group dari 40.

**Fix:**
- WS init: `closed_trades[-40:]` → `closed_trades[-300:]`
- WS history broadcast: `[-100:]` → `[-300:]`
- REST polling fallback: `limit=50` → `limit=300`

**Lesson:** Limits cascading — backend limit memengaruhi visualization downstream. Tracker harus comprehensive.

---

### Phase 20: Final docs (handover prep)
- `CLAUDE.md` rewritten lengkap (project structure, run commands, architecture, critical details, gotchas, future improvements, handover notes)
- `AGENTS.md` baru (DO/DON'T, code style, workflow patterns, decision log)
- `docs/claude_workhistory.md` (this file)

**Lesson:** Document the why, not just the what. Future agent should understand context fast.

---

## Decision Log (Sticky Decisions)

| Decision | Date | Why kept |
|---|---|---|
| Single-file backend (`main.py`) | early | Easier mental model untuk 1 dev. Split nanti kalau >3000 LOC. |
| Single-file frontend (`App.jsx`) | early | Same reason. Components inline. |
| Binance-first untuk klines | 2026-05-21 | Best volume accuracy. CryptoCompare fallback. |
| Compound 5% flat | 2026-05-21 | Smoother than tier-based. Safer modal kecil. |
| No SL/TP per-trade | 2026-05-20 | Polymarket native unavailable. Auto-claim at resolve. |
| Circuit breakers portfolio-level | 2026-05-20 | Replace per-trade SL/TP. |
| Card-based UI (not table) | 2026-05-22 | Better detail visibility. |
| TradingView embed mode | 2026-05-22 | Don't reinvent advanced charting. |
| Dual TZ display (Local · ET) | 2026-05-22 | User WIB but Polymarket UI uses ET. |
| `bot/data/{BOT_ID}/` persistent | 2026-05-22 | `/tmp/` cleared on macOS reboot. |
| `conditionId` (hex) for CLOB endpoints | 2026-05-21 | Gamma `id` (integer) salah API contract. |
| Backend ports 8000, frontend 3001 | early | Baked di vite proxy + run.sh. Don't change. |

---

## Things to Remember for Next Session

1. **Test pattern user prefer:** SIM mode → DRY_RUN 24h → REAL with tiny modal
2. **User mostly run di local Mac (Jakarta WIB)**, VPN SG untuk Binance
3. **Wallet real1:** `0x5052b1118aD2C195EFF82A9E43b23770AE023B76`, ~10 POL, USDC 0 (perlu deposit)
4. **User suka iterasi cepat** — implement langsung, jangan terlalu banyak diskusi
5. **Saat handover bug** — selalu cek `S.errors[-5:]` dulu sebelum dive ke code
6. **Critical bug pattern:** silent return tanpa log → user susah debug. Always log silent fails.
7. **State + SQLite must be reset together** saat `api/reset` (lesson dari Phase 16)
8. **WebSocket message types limit broadcasts** — bukan 1000 per detik. Strategic only.
9. **PYTHONUNBUFFERED=1 wajib** untuk Python ke file stdout
10. **User suka tabel comparison** untuk decision-making

---

## Future Sessions Roadmap

Lihat `docs/polymarket_integration_plan.md` untuk plan detail. Quick summary:

- **Phase 21 (next):** Dry-run soak test 24h dengan real1 creds. Observe metrics. Identify edge cases.
- **Phase 22:** Deposit USDC kecil ke real1 wallet. First real trade. Monitor closely.
- **Phase 23:** Multi-bot orchestration via docker-compose (real1 + real2 + multiple SIMs).
- **Phase 24:** Binance trading bot integration (next-level — trade spot/futures based on same signal).
- **Phase 25:** Rate limit hardening (Gamma backoff, CLOB jitter, order idempotency).
- **Phase 26:** Daily USDC reconciliation vs S.capital (detect drift > $0.50).
- **Phase 27:** Live log streaming sidebar / dedicated logs page.
- **Phase 28:** Analytics page (P&L curve, hourly distribution, signal accuracy by indicator).
- **Phase 29:** Auth + LOGOUT untuk multi-user dashboard.
- **Phase 30:** WebSocket Binance untuk price (sub-second latency vs current REST 2s).
