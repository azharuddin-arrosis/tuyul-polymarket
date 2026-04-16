# polymarket-btc5m-mm

Bot **market making** untuk market **BTC Up/Down 5 menit** (rolling) di Polymarket.

Fokus desain:
- loop 1 detik (VPS)
- ambil spread + kontrol inventory
- **flatten** inventory sebelum close (biar tidak “jadi judi” di detik akhir)
- default **paper/simulasi** (aman). Untuk live trading, kamu perlu implement executor (lihat bagian Live).

## Cara pakai (paper / simulasi forward-test)

1) Install Rust (stable)
2) Copy config:

```bash
cp config.example.toml config.toml
```
3) Run paper mode (default):

```bash
cargo run --release -- --config config.toml --mode paper
```

Jalankan dengan UI terminal (TUI):

```bash
cargo run --release -- --config config.toml --mode paper --ui
```

Jalankan dengan Web UI (HTML realtime):

```bash
cargo run --release -- --config config.toml --mode paper --web --web-port 8080
```

Kalau di VPS dan mau diakses dari luar (pastikan firewall aman):

```bash
cargo run --release -- --config config.toml --mode paper --web --web-bind 0.0.0.0 --web-port 8080
```

Bot akan:
- menentukan window aktif berdasarkan epoch 5 menit (UTC)
- fetch metadata market dari **Gamma API**
- ambil best bid/ask dari **CLOB API** (kalau gagal, fallback ke Gamma)
- hitung target bid/ask + inventory skew
- simulasi pasang/cancel order + fill sederhana + biaya fee & gas (estimasi)
- menerapkan aturan compound + “panen” (withdraw)

Override saldo simulasi (tanpa edit config):

```bash
cargo run --release -- --config config.toml --mode paper --ui --sim-usdc 10 --sim-pol 0.05
```

## Cara pakai (dry-run)

```bash
cargo run --release -- --config config.toml --mode dry
```

## Live trading (ringkas)

Untuk live trading Polymarket CLOB:
- Polymarket pakai autentikasi 2 lapis: **L1** (EIP-712 signature, private key) untuk derive API creds, dan **L2** (HMAC) untuk request trading.
- Kamu juga butuh **funder address** (proxy wallet Polymarket) dan **signature type** (untuk Phantom biasanya `0`).

Dokumentasi resmi:
- Gamma API: https://gamma-api.polymarket.com (market discovery)  
- CLOB API: https://clob.polymarket.com (orderbook + trading)  

Saran paling aman:
- pakai SDK resmi (Rust) untuk order signing + auth.
- di code repo ini, bagian eksekusi order sengaja dibuat **trait** supaya kamu bisa colok executor SDK sesuai kebutuhan.

## Deploy VPS (systemd)

Contoh `systemd` service (ubah path sesuai server kamu):

```ini
[Unit]
Description=polymarket-btc5m-mm
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/polymarket-btc5m-mm
ExecStart=/opt/polymarket-btc5m-mm/target/release/polymarket-btc5m-mm --config /opt/polymarket-btc5m-mm/config.toml
Restart=always
RestartSec=2
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

## Catatan risiko
Market 5 menit punya adverse selection tinggi. Mulai dari size kecil, dan utamakan rule:
- jangan spam cancel/replace
- jangan kebawa inventory mendekati close
- circuit breaker harian
