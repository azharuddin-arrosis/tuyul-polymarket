# BTC 5m Bot v02

Bot forward-testing untuk market `btc-updown-5m` di Polymarket, ditulis dengan Rust untuk engine trading dan Node.js untuk dashboard realtime.

## Ringkasan

Project ini bukan executor on-chain real trade. Saat ini bot bekerja sebagai simulator trading:

- scan market Polymarket secara berkala
- ambil harga dari Gamma API dan CLOB API
- buka posisi simulasi berdasarkan threshold
- pantau open position untuk TP/SL atau settlement
- simpan state ke file JSON
- expose API untuk dashboard dan kontrol manual

## Arsitektur

```text
dashboard (Node.js + Express + Socket.IO)
        |
        v
bot API (Rust + Axum) -> BotState in-memory + persisted state.json
        |
        v
Polymarket Gamma API + CLOB API
```

Komponen utama:

- `bot/src/main.rs`: core bot, state, polling market, auto-trading, settlement, HTTP API
- `dashboard/server.js`: proxy API ke bot dan broadcast update via Socket.IO
- `start.sh`: helper untuk menjalankan mode Docker atau local
- `docker-compose.yml`: compose file untuk bot dan dashboard
- `docs/`: catatan plan dan pengembangan

## Fitur Yang Aktif

- auto scan market BTC 5 menit
- dashboard hanya menampilkan market BTC 5 menit
- auto entry berdasarkan threshold price
- early sell manual via API
- auto take profit / stop loss
- auto settlement saat market expired
- state persistence ke file `state.json`
- auto refill saldo gas simulasi saat MATIC terlalu rendah
- switch mode `demo` / `real` dengan default `demo`
- validasi readiness mode `real` berbasis env, RPC, Gamma API, dan CLOB API
- notifikasi Telegram opsional

## Trading Logic Saat Ini

Loop bot berjalan setiap `500ms`.

### 1. Market fetch

Bot mengambil:

- market `btc-updown-5m` current dan near future
- harga `YES/NO` dari CLOB API menggunakan `clobTokenIds`

### 1a. Mode bot

Mode yang tersedia:

- `demo`: mode simulasi, auto refill gas simulasi aktif, manual simulate diizinkan
- `real`: bot melakukan validasi readiness, tetapi live order execution belum diimplementasikan

### 2. Entry logic

Auto-mode hanya entry bila semua syarat terpenuhi:

- `auto_mode = true`
- tidak ada open position aktif
- waktu tersisa market lebih dari 60 detik
- saldo USDC cukup
- saldo MATIC cukup
- harga masuk dalam range aman

Aturan entry:

- buy `Yes` jika `yes_price >= threshold_above` dan `yes_price <= max_above`
- buy `No` jika `yes_price <= threshold_below` dan `yes_price >= min_below`

Ukuran posisi dibuat dinamis:

```text
dynamic_bet = clamp(usdc_balance / 25, min=0.25, max=10.0)
```

Catatan: field `bet_size` masih tersimpan di settings, tetapi auto-mode saat ini memakai `dynamic_bet`, bukan `bet_size` statis.

### 3. Exit logic

Open position bisa keluar lewat tiga jalur:

- manual sell melalui `POST /api/sell`
- auto exit karena TP/SL
- settlement otomatis setelah market melewati `end_timestamp`

TP/SL dihitung dari perubahan harga terhadap harga entry:

```text
pnl_pct = (current_price - entry_price) / entry_price
```

Trigger:

- TP aktif jika `tp_threshold > 0` dan `pnl_pct >= tp_threshold`
- SL aktif jika `sl_threshold < 0` dan `pnl_pct <= sl_threshold`

### 4. Settlement

Saat market expired, bot mengambil final YES price dan menilai hasil:

- posisi `Yes` menang jika `final_price > 0.5`
- posisi `No` menang jika `final_price <= 0.5`

P&L settlement:

- win: `(amount / entry_price) - amount`
- loss: `-amount`

## State dan Persistence

State bot disimpan di file JSON yang ditentukan oleh env `STATE_FILE`.

Isi utama state:

- `settings`
- `history`
- `open_positions`
- `last_trade_timestamp`
- `stopped`

Di Docker, default state disimpan di:

```text
./bot_data/state.json
```

Di local, default state disimpan di:

```text
bot/state.json
```

## Environment Variable

### Bot

- `STATE_FILE`: path file state JSON
- `PRIVATE_KEY`: private key wallet untuk mode real
- `FUNDER_ADDRESS`: wallet funder
- `POLY_FUNDER_ADDRESS`: alamat funder Polymarket
- `POLY_API_KEY`: API key Polymarket
- `POLY_API_SECRET`: API secret Polymarket
- `POLY_API_PASSPHRASE`: API passphrase Polymarket
- `RPC_URL`: endpoint RPC utama untuk mode real
- `CLOB_HTTP_URL`: base URL CLOB HTTP API
- `TELEGRAM_TOKEN`: token bot Telegram opsional
- `TELEGRAM_CHAT_ID`: chat id Telegram opsional

Template env tersedia di:

```text
.env.example
```

### Dashboard

- `BOT_API`: URL bot API, default `http://localhost:8082`
- `PORT`: port dashboard, default `3000`

## Menjalankan Project

### Opsi 1: helper script

```bash
./start.sh
```

Script akan memberi pilihan:

1. Docker build + up
2. Docker full reset
3. Local run

### Opsi 2: local manual

Terminal 1:

```bash
cd bot
cargo run
```

Terminal 2:

```bash
cd dashboard
npm install
node server.js
```

Lalu buka:

```text
http://localhost:3000
```

### Opsi 3: Docker Compose

```bash
docker-compose build --no-cache
docker-compose up -d
```

Service:

- bot API: `http://localhost:8082`
- dashboard: `http://localhost:3000`

## API Bot

### `GET /api/state`

Mengembalikan state ringkas untuk dashboard:

- `settings`
- `history`
- `open_positions`
- `last_trade_timestamp`
- `usdc_balance`
- `matic_balance`
- `realized_pnl`
- `floating_pnl`
- `wins`
- `losses`

### `GET /api/markets`

Mengembalikan daftar market yang sedang di-cache bot:

- `slug`
- `time`
- `countdown`
- `end_timestamp`
- `yes_price`
- `no_price`
- `icon`
- `category`

### `GET /api/history`

Mengembalikan daftar trade history.

### `POST /api/settings`

Update settings bot.

Contoh payload:

```json
{
  "usdc_balance": 100,
  "matic_balance": 0.5,
  "bet_size": 1,
  "gas_price": 0.001,
  "threshold_above": 0.52,
  "threshold_below": 0.48,
  "max_above": 0.65,
  "min_below": 0.35,
  "tp_threshold": 0.2,
  "sl_threshold": -0.3,
  "mode": "demo",
  "auto_mode": "on"
}
```

Catatan:

- saat transisi dari `auto_mode=false` ke `auto_mode=on`, balance bisa diinisialisasi ulang dari payload
- `mode` menerima `demo` atau `real`
- `auto_mode` dibaca sebagai string `"on"`
- jika `mode=real`, backend akan memvalidasi env dan konektivitas sebelum menyimpan setting

### `POST /api/simulate`

Buka posisi manual.

Contoh payload:

```json
{
  "slug": "btc-updown-5m-1776389100",
  "outcome": "Yes",
  "amount": 1,
  "price": 0.52
}
```

### `POST /api/sell`

Tutup open position lebih awal.

Contoh payload:

```json
{
  "slug": "btc-updown-5m-1776389100"
}
```

### `POST /api/reset`

Reset state simulasi:

- balance ke 0
- auto mode off
- history dihapus
- open positions dihapus
- market cache dibersihkan

## Dashboard

Dashboard adalah server Node.js sederhana yang:

- serve file statis dari `dashboard/public`
- proxy request frontend ke bot API
- polling bot setiap 1 detik
- broadcast update via Socket.IO ke client

Endpoint dashboard mengikuti endpoint bot karena sifatnya proxy.

## Perilaku Penting Yang Perlu Diketahui

- project ini masih simulasi, belum real order execution ke wallet / smart contract
- mode `real` saat ini hanya memvalidasi readiness, belum mengirim order live
- auto-mode membatasi satu posisi aktif pada satu waktu
- bot memakai harga CLOB sebagai sumber utama pricing
- jika harga CLOB gagal diambil, fallback price adalah `0.5`
- backend dan dashboard sekarang dibatasi ke market BTC 5 menit saja
- reset akan mengosongkan log `bot.log` jika file tersebut ada di current working directory

## Keterbatasan Saat Ini

- seluruh implementasi bot masih berada dalam satu file `bot/src/main.rs`
- settlement memakai final YES price sebagai basis evaluasi outcome
- `bet_size` belum menjadi sumber ukuran posisi untuk auto-mode
- stop/start real mode baru sebatas kontrol readiness, bukan eksekusi live trading
- fallback harga `0.5` bisa membuat sinyal menjadi kurang akurat ketika API gagal
- belum ada test otomatis

## Log dan Debugging

Local log:

- bot: `bot/bot.log`
- dashboard: `dashboard/dashboard.log`

Docker log:

```bash
docker-compose logs -f bot
docker-compose logs -f dashboard
```

## Pengembangan Lanjutan

Area yang paling masuk akal untuk iterasi berikutnya:

- pisahkan engine bot ke beberapa module Rust
- tambah automated test untuk parser, settlement, dan entry logic
- buat config validation yang lebih ketat
- tambah risk control seperti cooldown setelah loss beruntun
- integrasikan real trade execution bila memang dibutuhkan
