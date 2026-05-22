# AGENTS.md — Polypox Terminal

Konvensi & rules untuk AI agents (Claude, Cursor, Aider, Continue, dll) saat kerja di `bot/`.

> Dokumen ini fokus ke **DO / DON'T** untuk agent. Untuk arsitektur lengkap baca `CLAUDE.md`. Untuk history changes baca `docs/claude_workhistory.md`.

---

## Project Identity

- **Name:** Polypox Terminal
- **Purpose:** Bot trading BTC up/down 5-menit di Polymarket (CLOB)
- **Stack:** Python 3.14 + FastAPI + asyncio (backend), React 18 + Vite 6 (frontend)
- **State:** Single-file `backend/main.py` (~2000 LOC), single-file `frontend-bot/src/App.jsx` (~1900 LOC)
- **Owner:** Azhar Arrosis — solo dev, prefer direct action over excessive planning

---

## Critical Rules

### 🚫 NEVER

1. **Jangan commit env files** (`backend/envs/*.env`) — berisi POLY_PRIVATE_KEY (real money)
2. **Jangan ubah signature_type=2 di CLOB client** — itu yang baca proxy wallet USDC
3. **Jangan pakai Gamma `id` (integer) untuk CLOB endpoints** — wajib `conditionId` (hex 0x...)
4. **Jangan trigger real order tanpa pre-flight validator PASS**
5. **Jangan kasih `total = 100` Polymarket pricing assumption** — fees masuk via taker_base_fee + maker_base_fee
6. **Jangan refactor besar tanpa user approval** — user lebih suka iterasi kecil + test cepat
7. **Jangan hapus log files / data files tanpa konfirmasi** — `data/` dan `logs/` sering masih dipakai
8. **Jangan ubah port 8000 (backend) atau 3001 (frontend)** — sudah baked ke vite proxy + run.sh
9. **Jangan tambah dependency baru tanpa diskusi** — keep deps minimal
10. **Jangan tulis test suite besar** — user prefer manual smoke test + tail logs

### ✅ ALWAYS

1. **Test sintaks setelah edit `main.py`** dengan `../venv/bin/python -c "import ast; ast.parse(open('main.py').read())"`
2. **Build frontend setelah edit `.jsx`** dengan `cd frontend-bot && npm run build` untuk catch error
3. **Gunakan `PYTHONUNBUFFERED=1` + `-u`** untuk Python supaya log realtime ke file
4. **Gunakan `caffeinate -d -i` untuk long-running tests** supaya laptop tidak sleep
5. **Pakai SIM mode untuk testing logic** — real mode hanya saat siap
6. **Restart backend setelah ubah `main.py`** — uvicorn tidak auto-reload di kita
7. **Update CLAUDE.md kalau menambah feature signifikan** — supaya handover gampang
8. **Tambah entry ke `docs/claude_workhistory.md`** setelah session besar
9. **Gunakan WebSocket message types existing** — jangan invent baru tanpa update useBot
10. **Cek `S.errors[-5:]` di stats kalau debug** — backend tangkap exception ke list

---

## Code Style Preferences (User)

- **Minimal comments** — comment hanya kalau "why" tidak obvious. Tidak suka comment "yang what"-nya
- **No emojis kecuali UI** — log boleh emoji (📈 ✅ ⛔), code TIDAK
- **Indonesian/English mix OK** — variable & function tetap English, komentar/log boleh Indonesian
- **No big abstractions** — single-file kalau bisa. Hindari premature factoring
- **Inline styles in React** — sudah konsisten, jangan migrate ke styled-components / Tailwind
- **No TypeScript** — pure JS (`.jsx`)
- **Async > sync** — semua I/O backend pakai `aiohttp` / `asyncio.create_task`

---

## Workflow Patterns

### Saat user minta fitur baru
1. **Klarifikasi cepat** (1-2 pertanyaan max) kalau ada ambiguity
2. **Implement langsung** — user lebih suka lihat code daripada baca spec
3. **Test smoke** — pastikan backend syntax OK + frontend build OK
4. **Confirm to user** dengan ringkasan: yang baru, yang berubah, cara test

### Saat user laporkan bug
1. **Reproduce / inspect** state via `curl localhost:8000/api/stats` atau read log
2. **Identify root cause** dengan jelas — bukan symptom-fix
3. **Fix** dengan minimal change
4. **Restart backend** kalau perlu untuk verify

### Saat user discuss / explore
1. **Beri rekomendasi konkret** dengan trade-off
2. **Tabel comparison** kalau ada 2-3 opsi
3. **Tanya balik kalau ambiguous** — tapi limit 1-2 questions

### Saat work besar (>50 LOC change)
1. **Sebut akan diff/file affected** di awal
2. **Implement sequentially** — file by file, jangan parallel edit yang bisa konflik
3. **Verify each step** — syntax check antar edit
4. **Summary akhir** dengan list yang berubah

---

## Run Commands Cheatsheet

```bash
# Quick start (attached)
./run.sh sim

# Long-running test (background, survive Ctrl+C)
./run.sh dry_run real1 -d

# Stop background instance
./run.sh stop

# Watch logs
tail -f logs/backend.log

# Pre-flight validator before REAL mode
backend/validate_real.py real1

# Restart backend only
pkill -f "uvicorn main:app.*8000"
cd backend && PYTHONUNBUFFERED=1 BOT_ID=verify BOT_MODE=sim DATA_DIR=../data/verify \
  ../venv/bin/python -u -m uvicorn main:app --host 127.0.0.1 --port 8000 \
  >> ../logs/backend.log 2>&1 &

# Quick state check
curl -s localhost:8000/api/stats | python3 -m json.tool | head -40
```

---

## Files You'll Touch Most

| File | Purpose | Lines |
|---|---|---|
| `backend/main.py` | All backend logic, 7 loops + API + WS | ~2000 |
| `frontend-bot/src/App.jsx` | All UI components | ~1900 |
| `frontend-bot/src/hooks/useBot.js` | WS + REST hook | ~100 |
| `frontend-bot/src/index.css` | Theme (CSS vars only) | ~25 |
| `run.sh` | Entry point (attached + detached) | ~220 |
| `backend/validate_real.py` | Pre-flight validator | ~360 |
| `CLAUDE.md` | Architecture doc | this folder |
| `AGENTS.md` | Agent rules (this file) | this folder |
| `docs/claude_workhistory.md` | Change log | docs/ |

---

## Decision Log Quick-Ref

Why we made these choices (full context in `docs/claude_workhistory.md`):

| Decision | Reason |
|---|---|
| Binance-first untuk klines | Largest volume, accurate OHLCV (use VPN SG) |
| Compound 5% flat | Smoother than tier-based, conservative for small modal |
| No SL/TP per-trade | Polymarket tidak punya native, rely on auto-claim |
| Circuit breakers portfolio-level | Replace per-trade SL/TP |
| Single-file backend | Easier mental model, can split later kalau besar |
| Card-based UI (not table) | Better detail visibility, modern dashboard feel |
| TradingView embed mode | Don't reinvent the wheel for advanced charting |
| Dual TZ display | User di WIB tapi Polymarket pakai ET |
| `bot/data/{BOT_ID}/` persistent | `/tmp/` di macOS dihapus saat reboot |
| `conditionId` (hex) for CLOB | Gamma `id` (integer) salah API |

---

## Testing Strategy

User tidak suka test suite besar. Pattern:

1. **Syntax check** setelah edit Python/JS
2. **Smoke test** via curl + tail log
3. **UI manual test** di browser
4. **SIM mode soak** untuk multi-iteration test
5. **DRY_RUN soak** untuk integration test dengan real APIs
6. **Pre-flight validator** sebelum REAL

Jangan tambah pytest / vitest tanpa permintaan eksplisit.

---

## When Stuck — Diagnostic Order

1. **Check backend running:** `curl -s localhost:8000/health`
2. **Check log:** `tail -30 logs/backend.log`
3. **Check state:** `curl -s localhost:8000/api/stats | python3 -m json.tool`
4. **Check WS connection:** browser DevTools → Network → WS
5. **Check Binance reachable:** `curl https://api.binance.com/api/v3/ping`
6. **Check Polymarket CLOB:** `curl https://clob.polymarket.com/time`
7. **Check process tree:** `ps -ef | grep uvicorn`

---

## Communication Style

- **Indonesian primary**, English untuk technical terms
- **Concise** — user prefer 3 baris yang to-the-point daripada paragraf
- **Tabel comparison** sering dipakai untuk decision-making
- **Code first** — tunjukkan diff, lalu jelaskan kalau perlu
- **Bullet points** > prose untuk explanation
- **Honest tradeoffs** — user OK dengan compromise kalau jelas
