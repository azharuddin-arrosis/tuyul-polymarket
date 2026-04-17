# BTC 5m v02 - Task Checklist

## Dashboard Frontend (index.html) - DONE ✅

### 1. Tambah Input Balance di Form Settings
- [x] Tambahkan input untuk USDC Balance
- [x] Tambahkan input untuk MATIC Balance
- [x] Style input agar konsisten

### 2. Ubah Tombol Save → Start/Stop Simulation
- [x] Ubah teks tombol "Save Settings" → "Start Simulation"
- [x] Saat Start:
  - Kirim settings ke server via POST /api/settings
  - Ganti teks tombol jadi "Stop Simulation"  
  - Ganti warna tombol jadi merah (#ef4444)
  - Disable semua input form
- [x] Saat Stop:
  - Enable kembali semua input form
  - Ganti teks jadi "Start Simulation"
  - Ganti warna jadi hijau (#10b981)

### 3. Perbaiki Form Submit
- [x] Form submit mengirimkan: usdc_balance, matic_balance, bet_size, gas_price, threshold_above, threshold_below, tp_threshold, sl_threshold, auto_mode

---

## Bot Backend (main.rs) - DONE ✅

### 4. Reset Balance
- [x] Saat reset, default ke $100 USDC dan 0.5 MATIC (line 617-618)

---

## Testing Checklist

- [ ] Load halaman dashboard → balance form harus kosong/tidak ada (SEBELUM)
- [ ] Load halaman dashboard setelah fix → balance form muncul dengan input $100 dan 0.5
- [ ] Klik Start Simulation → form disabled, tombol berubah ke "Stop Simulation"
- [ ] Klik Stop Simulation → form enabled kembali, tombol berubah ke "Start Simulation"
- [ ] Klik Reset button → balance di reset ke $100 (jika ada posisi, dihapus)
- [ ] Simulate trade manual → balance berkurang

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