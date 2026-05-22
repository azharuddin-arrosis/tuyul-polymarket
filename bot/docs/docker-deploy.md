# Docker Deploy — Polypox Terminal (8 Bots)

## Prasyarat

- Docker + Docker Compose v2 terinstall
- `docker --version` dan `docker compose version` bisa jalan

---

## Struktur Port

| Service   | Backend | Frontend |
|-----------|---------|----------|
| dashboard | —       | :3000    |
| real1     | :8001   | :3001    |
| real2     | :8002   | :3002    |
| real3     | :8003   | :3003    |
| real4     | :8004   | :3004    |
| real5     | :8005   | :3005    |
| real6     | :8006   | :3006    |
| real7     | :8007   | :3007    |
| real8     | :8008   | :3008    |

---

## Langkah Deploy

### 1. Isi credentials env (wajib sebelum build)

Setiap bot punya file env di `backend/envs/realN.env`.  
Bot yang belum punya credentials tetap jalan di `dry_run` tanpa credentials.

```bash
# Contoh mengisi real1 (sudah ada)
nano backend/envs/real1.env

# Bot lain yang sudah siap credentials
nano backend/envs/real2.env
# dst.
```

Format env file:
```env
BOT_ID=real1
BOT_MODE=dry_run        # ganti ke real kalau siap
USDC_CAPITAL=10
POL_BALANCE=11
MAX_OPEN_POS=3
MIN_EV=0.04
DAILY_LOSS_LIMIT=3.0
SCAN_INTERVAL=12
POLY_PRIVATE_KEY=0x...  # isi ini
POLY_API_KEY=...        # isi ini
POLY_SECRET=...         # isi ini
POLY_PASSPHRASE=...     # isi ini
```

---

### 2. Build semua image

```bash
cd bot/

docker compose build
```

Build pertama ~3-5 menit (download base images + install deps).  
Build berikutnya lebih cepat karena layer cache.

Build per-service kalau mau lebih cepat:
```bash
docker compose build real1-be real1-fe dashboard
```

---

### 3. Start semua

```bash
# Start semua 8 bot + dashboard (background)
docker compose up -d

# Lihat status
docker compose ps
```

---

### 4. Cek logs

```bash
# Semua service sekaligus
docker compose logs -f

# Per-bot backend
docker compose logs -f real1-be
docker compose logs -f real2-be

# Dashboard
docker compose logs -f dashboard
```

---

### 5. Stop

```bash
# Stop semua
docker compose down

# Stop tapi data volume tetap ada
docker compose stop

# Stop + hapus volumes (HATI-HATI: data trades hilang)
docker compose down -v
```

---

## Operasi Harian

### Restart 1 bot tanpa ganggu yang lain

```bash
docker compose restart real1-be real1-fe
```

### Update 1 bot (setelah edit kode)

```bash
docker compose build real1-be
docker compose up -d --no-deps real1-be
```

### Lihat resource usage

```bash
docker stats
```

### Masuk ke container untuk debug

```bash
docker compose exec real1-be bash
```

---

## Jalankan sebagian bot saja

```bash
# Hanya dashboard + real1 + real2
docker compose up -d dashboard real1-be real1-fe real2-be real2-fe
```

---

## Tips VPS

### File permissions env

```bash
chmod 600 backend/envs/real*.env
```

### Auto-restart saat VPS reboot

Sudah dikonfigurasi di `docker-compose.yml` dengan `restart: unless-stopped`.  
Pastikan Docker daemon juga auto-start:

```bash
sudo systemctl enable docker
```

### Cek semua container RUNNING

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
```

---

## Akses setelah deploy

| URL                         | Keterangan         |
|-----------------------------|--------------------|
| http://VPS_IP:3000          | Dashboard 8 bot    |
| http://VPS_IP:3001          | Detail bot real1   |
| http://VPS_IP:3002          | Detail bot real2   |
| http://VPS_IP:800X/health   | Health check botX  |

Ganti `VPS_IP` dengan IP Hetzner instance.

> Untuk production: pasang nginx reverse proxy + SSL (Let's Encrypt) di depan, expose hanya port 80/443.
