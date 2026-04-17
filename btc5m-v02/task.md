# BTC 5m v02 - Task Checklist

## Dashboard Frontend (index.html) - DONE ✅

### 1. Hapus Input Balance dari Form Settings
- [x] Hapus input USDC Balance dari form
- [x] Hapus input MATIC Balance dari form
- [x] Balance ditampilkan hanya di header (stats bar)

### 2. Ubah Tombol Save → Start/Stop Simulation
- [x] Ubah teks tombol "Save Settings" → "Start Simulation"
- [x] Saat Start:
  - Kirim settings ke server via POST /api/settings (tanpa balance)
  - Jika balance masih 0, server akan set $100 USDC dan 0.5 MATIC
  - Ganti teks tombol jadi "Stop Simulation"
  - Ganti warna tombol jadi merah (#ef4444)
  - Disable semua input form
- [x] Saat Stop:
  - Enable kembali semua input form (auto_mode tetap true, hanya UI unlock)
  - Ganti teks jadi "Start Simulation"
  - Ganti warna jadi hijau (#10b981)

### 3. Perbaiki Form Submit
- [x] Form submit hanya kirim: bet_size, gas_price, threshold_above, threshold_below, tp_threshold, sl_threshold, auto_mode

---

## Bot Backend (main.rs) - DONE ✅

### 4. Reset Behavior
- [x] Saat reset, set usdc_balance = 0
- [x] Saat reset, set matic_balance = 0
- [x] Saat reset, set auto_mode = false (simulation STOP)
- [x] Clear all positions dan history
- [x] Clear log file

### 5. Start Simulation Behavior  
- [x] Saat POST settings dengan auto_mode=true dan balance=0 → set $100 USDC, 0.5 MATIC
- [x] Balance dipertahankan dari state yang ada (tidak di-overwrite dari form)

---

## Flow Penggunaan

1. **Initial State**: Bot dimulai dengan balance = 0, auto_mode = false
2. **Start Simulation**: Klik tombol → auto_mode=true, balance=$100/0.5 → bot trading
3. **Stop Simulation**: Klik tombol → UI unlock, auto_mode tetap true (bot terus trading)
4. **Reset**: Klik reset button → auto_mode=false, balance=0, all positions cleared

---

## Catatan Tambahan dari review.md

### Priority 1 - Segera (belum diimplementasi):
1. Take Profit otomatis - settings sudah ada (tp_threshold) tapi UI tidak jelas
2. Clarify Stop Loss logic
3. Naikkan threshold default ke 0.55-0.58

### Priority 2 - Medium Term:
4. Consecutive loss cooldown
5. Direction filter (BTC trend)
6. Dynamic bet sizing
7. Session time filter