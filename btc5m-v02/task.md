# BTC 5m v02 - Task Checklist

## COMPLETED ✅

### 1. Perbaiki Label - LONG (UP) / SHORT (DOWN)
- [x] Open positions: "BUY (UP)" → "LONG (UP)", "SELL (DOWN)" → "SHORT (DOWN)"
- [x] Trade history: "BUY (UP)" → "LONG (UP)", "SELL (DOWN)" → "SHORT (DOWN)"

### 2. Tambah Kolom Final Price di History
- [x] Tambah field `final_price` ke struct Trade (bot)
- [x] Simpan final_price saat settlement
- [x] Update table header: Entry, Final
- [x] Tampilkan final price di history table

### 3. Display yang Lebih Jelas
- [x] Entry price ditampilkan dalam cents (contoh: 53c)
- [x] Final price ditampilkan dalam cents (contoh: 79c)
- [x] Format: "Entry → Current" untuk open positions

---

## File Changed:
1. `bot/src/main.rs` - Tambah final_price field, update all Trade creations
2. `dashboard/public/index.html` - Update labels dan table columns
3. `start.sh` - Menu untuk Docker/local

---

## Next Steps (Belum):
- [ ] Validasi settlement logic apakah win/lose sudah benar
- [ ] Tambah prediction column (naik/turun)
- [ ] Telegram notification untuk milestone balance