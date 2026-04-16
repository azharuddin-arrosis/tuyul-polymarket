# BTC 5m Bot v02 - Auto Bet Engine Plan

## Overview
Rencana pengembangan logika otomatisasi untuk bot trading Bitcoin 5-menit (Forward Testing). Fokus pada akurasi eksekusi, manajemen risiko (TP/SL), dan fleksibilitas *Exit Strategy* (Sell Early).

---

## 1. Phase: Market Intelligence (Scanning)
*   **Discovery**: Bot memindai semua market aktif `btc-updown-5m` melalui Gamma API.
*   **Price Validity**: Memperbaiki parser harga agar nilai `UP` dan `DOWN` sesuai dengan harga pasar (Order Book), bukan nilai default.
*   **Window Logic**: Bot hanya memproses market yang memiliki sisa waktu (Countdown) di atas 120 detik untuk menghindari eksekusi yang terlambat.

## 2. Phase: Decision Making (The Signal)
*   **Threshold Trigger**:
    *   **BUY UP**: Dieksekusi jika harga `YES` (UP) menyentuh atau melewati `threshold_above`.
    *   **BUY DOWN**: Dieksekusi jika harga `NO` (DOWN) menyentuh atau melewati (1 - `threshold_below`).
*   **Risk Control**:
    *   **Anti-Double Bet**: Memastikan bot tidak membeli aset yang sama di jendela waktu yang sama.
    *   **Balance Validation**: Cek ketersediaan USDC (Modal) dan MATIC (Gas).

## 3. Phase: Position Management (Forwarding)
*   **Execution**:
    *   Catat `Position` { `slug`, `outcome`, `entry_price`, `amount`, `timestamp` }.
    *   Kurangi saldo simulasi secara real-time.
*   **Live Monitoring**:
    *   Hitung `Floating P&L` setiap 5 detik berdasarkan selisih harga saat ini dengan harga masuk.
    *   Formula: `((Current_Price / Entry_Price) * Amount) - Amount`.

## 4. Phase: Exit Strategy (Sell & Settlement)
*   **Manual Sell**: Menyediakan endpoint `/api/sell` agar user bisa menjual posisi kapan saja melalui Dashboard.
*   **Auto Take Profit (TP)**: (Opsional) Bot otomatis menjual jika profit mencapai target (misal: +15%).
*   **Auto Stop Loss (SL)**: (Opsional) Bot otomatis menjual jika harga turun di bawah batas aman (misal: -25%) untuk menyelamatkan sisa modal.
*   **End Settlement**: Jika posisi ditahan sampai akhir (5 menit), bot akan menarik `outcome` resmi dan menghitung P&L final (Win = Balance + Profit, Loss = 0).

---

## Task Progress
- [x] Refactor Rust `main.rs` untuk support Open Positions.
- [x] Update Dashboard `index.html` dengan tabel Open Positions.
- [ ] Implementasi fungsi `/api/sell` untuk exit early.
- [ ] Perbaikan akurasi penarikan harga (Fix 50/50 price).
- [ ] Auto Take Profit & Stop Loss logic.

---
*Dokumentasi ini dibuat untuk referensi pengembangan BTC 5m Bot v02.*
