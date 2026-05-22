# BTC 5m Bot v02 - Real/Demo Refactor Task

Dokumen ini dipakai untuk tracking perubahan besar pada backend dan dashboard sebelum test end-to-end.

## Objective

Target refactor:

- backend hanya expose market `btc-updown-5m`
- tombol stop benar-benar mematikan `auto_mode` di backend
- bot punya switch mode `demo` dan `real`
- mode `real` wajib lolos validasi env, koneksi Polymarket, dan kesiapan wallet
- dashboard equity chart lebih stabil dan tidak spam titik saat reconnect
- UI dashboard lebih konsisten untuk market BTC-only

## Scope

### Backend

- [ ] Audit flow state/settings sekarang
- [ ] Hapus market non-BTC dari `current_markets`
- [ ] Pastikan auto trading hanya memakai BTC 5m
- [ ] Tambah field mode bot: `demo` default, `real` optional
- [ ] Kembalikan mode bot di `GET /api/state`
- [ ] Perbaiki `POST /api/settings` agar bisa start/stop bot secara nyata
- [ ] Tambah validasi start mode `real`
- [ ] Tambah helper health check koneksi Polymarket
- [ ] Tambah validasi env wallet/config untuk mode real

### Frontend

- [ ] Tambah switch `Demo / Real`
- [ ] Tampilkan mode aktif di dashboard
- [ ] Tombol `Stop Bot` kirim `auto_mode=false` ke backend
- [ ] Sync UI start/stop berdasarkan state backend
- [ ] Rapikan badge market jadi konsisten untuk BTC-only
- [ ] Perbaiki equity chart agar tidak append data identik saat reconnect
- [ ] Tambah smoothing/visual improvement chart tanpa mengubah data dasar
- [ ] Tampilkan error validasi jika mode `real` belum siap

### Configuration

- [ ] Audit `.env` yang ada sekarang
- [ ] Tambah `.env.example`
- [ ] Pisahkan env wajib mode real vs env opsional
- [ ] Dokumentasikan env yang dipakai backend

### Verification

- [ ] `GET /api/markets` hanya berisi market BTC 5m
- [ ] Start demo tetap jalan normal
- [ ] Stop bot mematikan `auto_mode` di backend
- [ ] Start real gagal jika env/koneksi/wallet belum siap
- [ ] State bot tetap persist setelah restart
- [ ] Dashboard tetap render normal setelah reconnect socket

## Notes

- Tahap ini fokus menyiapkan fondasi `real mode`, validasi readiness, dan kontrol operasional.
- Eksekusi order real ke Polymarket belum dianggap selesai hanya dengan adanya switch `real`.
- Test manual dilakukan setelah semua task utama selesai.
