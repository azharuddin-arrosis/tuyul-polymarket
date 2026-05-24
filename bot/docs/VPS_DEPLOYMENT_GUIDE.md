# Polypox — VPS Deployment Guide (8 Bot, Real Mode)
> Update: 2026-05-24 · Berdasarkan dry run 3 hari (WR 67.7%, +190% ROI)

---

## QUICK OVERVIEW — Flow dari Nol sampai Bot Jalan

```
PHASE 1 — PERSIAPAN MODAL (lakukan dari laptop/HP)
  Binance → kirim USDC → Polymarket deposit address per wallet
  Jalankan approve_usdc.py → set allowance

PHASE 2 — SETUP VPS (Hetzner CPX32, Singapore)
  Create server → SSH masuk → install deps → clone repo

PHASE 3 — KONFIGURASI
  Isi 8 env files → validate semua → discover bots

PHASE 4 — JALANKAN
  Dry run 1 jam → stop → start real mode → klik RUN di dashboard

PHASE 5 — MONITORING
  Pantau via dashboard (browser) atau log viewer
  Bot jalan 24/7, kamu tinggal pantau
```

---

## PHASE 1 — Persiapan Modal

### 1.1 Yang Dibutuhkan per Bot

```
Tiap bot butuh:
  - 1 wallet Polygon (private key)
  - 1 akun Polymarket (API Key + Secret + Passphrase)
  - $10 USDC di Polymarket
  - 10 POL untuk gas (~20 hari operasional)

Total 8 bot:
  - $80 USDC (kirim $85 untuk cover fee Binance ~$0.80)
  - 80 POL (~$32 at $0.40/POL)
```

### 1.2 Deposit USDC dari Binance langsung ke Polymarket

**Cara paling simpel — skip MetaMask, langsung dari Binance:**

```
STEP 1: Buka polymarket.com → login wallet masing-masing
        → klik Portfolio → Deposit → Use Crypto → Transfer Crypto

STEP 2: Akan muncul deposit address unik per akun, contoh:
        0x48620d5a4d69caec2E2bE62923A0B362B2261e96
        (ini BUKAN alamat MetaMask — ini proxy Polymarket)

STEP 3: Di Binance → Withdraw
        Coin    : USDC
        Network : POLYGON  ← wajib Polygon, bukan ERC20/ETH
        Address : (paste deposit address dari step 2)
        Amount  : $10

STEP 4: Tunggu 2-5 menit → balance Polymarket bertambah

STEP 5: Ulangi untuk setiap wallet (real1-real8)
```

> ⚠️ **Network wajib POLYGON** — kalau salah pilih ERC20/Ethereum, USDC masuk di chain yang salah dan tidak bisa dipakai Polymarket.

### 1.3 Set Allowance setelah Deposit

Karena deposit langsung (bukan lewat MetaMask flow), allowance perlu di-set manual:

```bash
cd /path/to/poly/bot

# Set allowance semua bot sekaligus
backend/approve_usdc.py all

# Output yang diharapkan per bot:
# ✅ OK    → allowance berhasil di-set
# ⏭ SKIP  → sudah approved sebelumnya
# ❌ FAIL  → cek credentials / pastikan USDC sudah masuk
```

### 1.4 Cara Dapat API Key Polymarket

1. Buka [polymarket.com](https://polymarket.com) → login wallet
2. Klik profile → **Settings** → **API Keys**
3. Klik **Create Key**
4. Simpan: `API Key`, `Secret`, `Passphrase`
5. Ulangi untuk setiap akun (8 akun = 8 set credentials)

---

## PHASE 2 — Setup VPS

### 2.1 Spesifikasi VPS

| Komponen | Recommended |
|---|---|
| Provider | **Hetzner** (paling murah, performa solid) |
| Type | **CPX32** — 4 vCore AMD, 8 GB RAM, 160 GB NVMe |
| Lokasi | **Singapore** — latency rendah ke Polymarket + Binance |
| OS | **Ubuntu 24.04 LTS** |
| Harga | ~€39/bulan (~$42) |

### 2.2 Create Server di Hetzner

1. Buka [console.hetzner.com](https://console.hetzner.com)
2. **New Server** → pilih:
   - Location: **Singapore**
   - Image: **Ubuntu 24.04**
   - Type: **CPX32** (tab Regular Performance → 4 vCore / 8 GB)
   - SSH Key: tambahkan public key laptop kamu
   - Name: `polypox`
3. Klik **Create & Buy**
4. Catat IP address server

### 2.3 Generate SSH Key (kalau belum punya)

```bash
# Di laptop
ssh-keygen -t ed25519 -C "polypox-vps"
# Enter → Enter → Enter (no passphrase)

# Tampilkan public key → copy ke Hetzner
cat ~/.ssh/id_ed25519.pub
```

### 2.4 Login ke VPS

```bash
# Login sebagai root
ssh root@YOUR_VPS_IP

# Verifikasi sudah masuk
hostname && uname -a
```

### 2.5 Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Install semua dependencies
apt install -y \
  git curl wget nano htop \
  python3 python3-pip python3-venv \
  nodejs npm \
  build-essential \
  tmux \
  ufw fail2ban

# Cek versi
python3 --version   # harus >= 3.10
node --version      # harus >= 18
npm --version
```

### 2.6 Setup Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp            # SSH
ufw allow 3000/tcp          # Dashboard multi-bot
ufw allow 3001:3008/tcp     # Frontend per bot (real1-real8)
ufw enable

# Konfirmasi: y
ufw status
```

### 2.7 Buat User (jangan pakai root untuk bot)

```bash
adduser polypox
# isi password, sisanya enter saja

usermod -aG sudo polypox
su - polypox
# sekarang kamu login sebagai polypox
```

---

## PHASE 3 — Konfigurasi Project

### 3.1 Clone Repository

```bash
# Pastikan sudah login sebagai user polypox
cd ~

git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git poly
cd poly/bot

# Verifikasi struktur
ls
# harus ada: backend/ frontend-bot/ frontend-dashboard/ orchestrator.sh run.sh
```

### 3.2 Setup Python Environment

```bash
cd ~/poly/bot

# Buat virtualenv
python3 -m venv venv

# Install dependencies
venv/bin/pip install -r backend/requirements.txt

# Verifikasi
venv/bin/python3 -c "import py_clob_client; print('✓ py_clob_client OK')"
venv/bin/python3 -c "import fastapi; print('✓ fastapi OK')"
```

### 3.3 Setup Node.js Frontend

```bash
cd ~/poly/bot

# Install deps
cd frontend-bot && npm install && cd ..
cd frontend-dashboard && npm install && cd ..

# Build untuk production
cd frontend-bot && npm run build && cd ..
cd frontend-dashboard && npm run build && cd ..

echo "✓ Frontend build done"
```

### 3.4 Buat ENV Files (8 bot)

```bash
cd ~/poly/bot/backend/envs
```

Buat file untuk setiap bot (isi sesuai credentials masing-masing):

```bash
nano real1.env
```

Template isi (ganti nilai setelah `=`):

```bash
BOT_ID=real1
BOT_NAME=Alpha
BOT_MODE=real
USDC_CAPITAL=10
POL_BALANCE=10
MAX_OPEN_POS=3
MIN_EV=0.04
DAILY_LOSS_LIMIT=3.0
SCAN_INTERVAL=12
BALANCE_FLOOR=2

POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_SECRET=...
POLY_PASSPHRASE=...
```

Ulangi untuk real2-real8 (ganti BOT_ID, BOT_NAME, dan semua credentials):

```bash
# Nama per bot:
# real1=Alpha  real2=Beta   real3=Gamma  real4=Delta
# real5=Echo   real6=Zeta   real7=Sigma  real8=Omega

nano real2.env   # BOT_NAME=Beta
nano real3.env   # BOT_NAME=Gamma
nano real4.env   # BOT_NAME=Delta
nano real5.env   # BOT_NAME=Echo
nano real6.env   # BOT_NAME=Zeta
nano real7.env   # BOT_NAME=Sigma
nano real8.env   # BOT_NAME=Omega

# Set permission ketat
chmod 600 *.env
ls -la *.env
# Output: -rw------- 1 polypox polypox ... (hanya owner bisa baca)
```

### 3.5 Set Allowance USDC di VPS

```bash
cd ~/poly/bot

# Approve semua bot
backend/approve_usdc.py all

# Lihat summary — semua harus OK atau SKIP
```

### 3.6 Validasi Semua Bot

```bash
cd ~/poly/bot

# Validasi satu per satu (17 checks per bot)
for i in 1 2 3 4 5 6 7 8; do
  echo ""
  echo "════════════════════════════════"
  echo "  Validating real$i..."
  echo "════════════════════════════════"
  backend/validate_real.py real$i 2>&1 | grep -E "✓|✗|PASS|FAIL|==="
done
```

**Target:** Semua 17 check ✓ untuk setiap bot sebelum lanjut.

Check kritis yang harus PASS:
- `#8 USDC balance > 0` — USDC sudah masuk Polymarket
- `#9 POL balance > 0` — gas ada
- `#13 USDC allowance > 0` — sudah approve

### 3.7 Generate bots.json untuk Dashboard

```bash
cd ~/poly/bot
./orchestrator.sh discover

# Verifikasi
cat frontend-dashboard/public/bots.json
# Harus ada 8 entri: real1-real8
```

---

## PHASE 4 — Jalankan Bot

### 4.1 Test Dry Run Dulu (1 jam)

```bash
cd ~/poly/bot

# Start semua bot dalam dry_run mode
./orchestrator.sh start all dry_run

# Cek status tabel
./orchestrator.sh status

# Pantau log beberapa menit
tail -f logs/backend-real1.log
# Ctrl+C untuk keluar dari tail
```

Buka browser: `http://YOUR_VPS_IP:3000`

Pastikan semua bot card hijau dan ada signal firing di log.

```
Yang harus terlihat di log:
  [BTC5m] Market FOUND  | YES=0.51 NO=0.49 ...  ← market ditemukan
  [BTC5m] T-300s | BTC $... | UP conf=0.79 ...  ← signal berjalan
  [BOT] 📈 BET OPEN [DRY] ...                   ← order masuk (dry)
```

### 4.2 Stop Dry Run

```bash
./orchestrator.sh stop all

# Tunggu sampai semua berhenti
./orchestrator.sh status
# Semua harus DOWN
```

### 4.3 Start REAL Mode

```bash
cd ~/poly/bot

# Start real mode — akan minta konfirmasi
./orchestrator.sh start all real

# Ketik y lalu Enter saat muncul konfirmasi:
# ⚠ REAL MODE — Bot akan trade USDC asli. Lanjutkan? (y/N)
```

### 4.4 Klik RUN di Dashboard

Bot start dalam kondisi **PAUSED**. Buka dashboard dan klik RUN:

```
http://YOUR_VPS_IP:3000

Di setiap bot card:
  → Klik [▶ RUN]
  → Status berubah: PAUSED → RUNNING
  → Dot hijau berkedip
```

Atau via terminal kalau mau semua langsung:

```bash
# Jalankan semua bot via API
for port in 8001 8002 8003 8004 8005 8006 8007 8008; do
  echo -n "Starting port $port... "
  curl -s -X POST "http://localhost:$port/api/bot/start" | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print('OK' if d.get('ok') else d)"
done
```

### 4.5 Verifikasi Bot Berjalan

```bash
# Cek status semua bot
./orchestrator.sh status

# Cek equity dan PnL realtime
for i in 1 2 3 4 5 6 7 8; do
  curl -s http://localhost:$((8000+i))/api/stats | \
    python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'real$i ({d.get(\"bot_name\",\"?\"):6}) mode={d[\"mode\"]:8} running={str(d[\"running\"]):5} equity=\${d[\"capital\"]:.2f} pnl={d[\"pnl\"]:+.2f}')
" 2>/dev/null
done
```

---

## PHASE 5 — Monitoring & Maintenance

### 5.1 Dashboard dari Browser

```
http://YOUR_VPS_IP:3000          # Multi-bot overview
http://YOUR_VPS_IP:3001          # Detail Alpha (real1)
http://YOUR_VPS_IP:3002          # Detail Beta (real2)
...
http://YOUR_VPS_IP:3008          # Detail Omega (real8)
```

Di dashboard tersedia:
- Equity + PnL per bot realtime
- Win rate + streak
- Ping indicator per bot (header)
- LOG button → lihat log langsung dari browser
- Kalender PnL harian

### 5.2 SSH Tunnel (akses aman dari laptop)

Kalau tidak mau buka port ke publik:

```bash
# Di laptop — buat tunnel
ssh -N \
  -L 3000:localhost:3000 \
  -L 3001:localhost:3001 \
  -L 3002:localhost:3002 \
  -L 3003:localhost:3003 \
  -L 3004:localhost:3004 \
  -L 3005:localhost:3005 \
  -L 3006:localhost:3006 \
  -L 3007:localhost:3007 \
  -L 3008:localhost:3008 \
  polypox@YOUR_VPS_IP
```

Simpan di `~/.ssh/config`:
```
Host polypox
  HostName YOUR_VPS_IP
  User polypox
  LocalForward 3000 localhost:3000
  LocalForward 3001 localhost:3001
  LocalForward 3002 localhost:3002
  LocalForward 3003 localhost:3003
  LocalForward 3004 localhost:3004
  LocalForward 3005 localhost:3005
  LocalForward 3006 localhost:3006
  LocalForward 3007 localhost:3007
  LocalForward 3008 localhost:3008
```

Cukup ketik `ssh -N polypox` lalu buka browser ke `http://localhost:3000`.

### 5.3 Pantau Log Realtime

```bash
# Log satu bot
tail -f logs/backend-real7.log       # Sigma (top performer)

# Semua bot sekaligus (pakai tmux)
tmux new-session -d -s logs
tmux split-window -h
tmux split-window -v
# dst... atau pakai cara sederhana:

# Lihat 3 baris terakhir semua bot
watch -n 5 'for i in 1 2 3 4 5 6 7 8; do
  echo "=== real$i ==="; tail -2 logs/backend-real$i.log; done'
```

### 5.4 Auto-restart dengan Systemd

```bash
# Buat service (jalankan sebagai root)
sudo nano /etc/systemd/system/polypox.service
```

```ini
[Unit]
Description=Polypox Trading Bots
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=polypox
WorkingDirectory=/home/polypox/poly/bot
ExecStart=/home/polypox/poly/bot/orchestrator.sh start all real
ExecStop=/home/polypox/poly/bot/orchestrator.sh stop all
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable polypox
sudo systemctl start polypox
sudo systemctl status polypox
```

### 5.5 Watchdog Cron

```bash
# Buat script watchdog
mkdir -p ~/poly/bot/scripts
cat > ~/poly/bot/scripts/healthcheck.sh << 'EOF'
#!/bin/bash
cd /home/polypox/poly/bot
TS=$(date '+%Y-%m-%d %H:%M:%S')
for i in 1 2 3 4 5 6 7 8; do
  PORT=$((8000+i))
  STATUS=$(curl -s --max-time 3 "http://localhost:$PORT/health" 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','fail'))" 2>/dev/null)
  if [ "$STATUS" != "ok" ]; then
    echo "[$TS] real$i OFFLINE — restarting"
    ./orchestrator.sh restart real$i real
  fi
done
EOF
chmod +x ~/poly/bot/scripts/healthcheck.sh

# Tambahkan ke crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /home/polypox/poly/bot/scripts/healthcheck.sh >> /home/polypox/poly/bot/logs/healthcheck.log 2>&1") | crontab -
(crontab -l 2>/dev/null; echo "5 0 * * * find /home/polypox/poly/bot/logs -name '*.log' -size +50M -exec truncate -s 10M {} \;") | crontab -
```

---

## Command Cheat Sheet

```bash
cd ~/poly/bot

# ── STATUS ──────────────────────────────────────────────────
./orchestrator.sh status              # tabel semua bot

# ── START / STOP ─────────────────────────────────────────────
./orchestrator.sh start all real      # start semua
./orchestrator.sh stop all            # stop semua
./orchestrator.sh restart real7 real  # restart satu bot

# ── RUN / PAUSE bot (tanpa browser) ─────────────────────────
curl -X POST http://localhost:8001/api/bot/start  # real1 RUN
curl -X POST http://localhost:8001/api/bot/stop   # real1 PAUSE

# ── CEK EQUITY SEMUA BOT ─────────────────────────────────────
for i in 1 2 3 4 5 6 7 8; do
  curl -s http://localhost:$((8000+i))/api/stats | \
    python3 -c "import json,sys; d=json.load(sys.stdin)
print(f'real$i {d.get(\"bot_name\",\"\"):6} \${d[\"capital\"]:6.2f} pnl={d[\"pnl\"]:+.2f} wr={d[\"win_rate\"]:.0f}%')" 2>/dev/null
done

# ── LOG REALTIME ─────────────────────────────────────────────
tail -f logs/backend-real7.log        # Sigma
tail -f logs/backend-real8.log        # Omega

# ── APPROVE USDC (kalau perlu) ────────────────────────────────
backend/approve_usdc.py all

# ── VALIDATE ─────────────────────────────────────────────────
backend/validate_real.py real1

# ── UPDATE CODE ──────────────────────────────────────────────
git pull
cd frontend-dashboard && npm run build && cd ..
cd frontend-bot && npm run build && cd ..
./orchestrator.sh restart all real

# ── EMERGENCY STOP ───────────────────────────────────────────
./orchestrator.sh stop all
```

---

## Estimasi Performa Real Mode

Berdasarkan dry run 3 hari (WR 67.7%, +190% ROI total):

| Skenario | Win Rate | Est. Profit/bulan |
|---|---|---|
| Konservatif | 60% | ~$50-80 |
| Realistis | 65% | ~$100-150 |
| Optimis (≈ dry run) | 68% | ~$200+ |

**Top performers dari dry run:**
- Sigma (real7): +590% ROI, WR 80% — prioritaskan modal lebih
- Omega (real8): +469% ROI, WR 76% — idem
- Gamma (real3): -10% ROI, WR 50% — pantau ketat hari pertama

> Dry run tidak ada slippage nyata. Estimasi real mode = 50-70% dari dry run.

---

*Guide dibuat berdasarkan dry run aktual 2026-05-22 → 2026-05-24.*
