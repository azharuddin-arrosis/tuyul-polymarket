# BTC 5m Bot v02 - ENHANCED with Momentum Trading

## Problem Statement

**Current Strategy:**
```
Buy Yes: price >= 52%
Buy No:  price <= 48%
```

**Why losing:**
- Buy Yes di 52% = udh naik 52 point, udah mau puncak → siap turun
- Buy No di 48% = udh turun 52 point, udah mau dasar → siap naik
- Tidak ada info momentum, hanya harga absolut

## Insight Baru

Contoh menang banyak:
- **Buy Yes di 23%** waktu lagi naik → bisa naik ke 95% → +77%
- **Buy No di 77%** waktu lagi turun → bisa turun ke 5% → +72%

Butuh: **PRICE HISTORY** + **MOMENTUM**!

---

## New Strategy: Momentum-Based Entry

### 1. Data yang Diperlukan

```rust
struct PricePoint {
    timestamp: u64,
    yes_price: f64,
    no_price: f64,
}

// Simpan 10-20 data point terakhir (50 menit)
let price_history: Vec<PricePoint>;
```

### 2. Hitung Momentum

```rust
fn calculate_momentum(history: &[PricePoint]) -> MomentumData {
    // Price change dalam 5 menit
    let price_change = current_price - price_5m_ago;
    
    // Arah: UP, DOWN, SIDEWAYS
    let direction = if price_change > 0.02 { "UP" }
                    else if price_change < -0.02 { "DOWN" }
                    else { "SIDEWAYS" };
    
    // Speed: persentase per menit
    let speed = price_change / 5.0;
    
    // Acceleration: naik czy turun lebih cepat
    let acceleration = speed - speed_prev;
    
    MomentumData { direction, speed, acceleration }
}
```

### 3. Smart Entry Rules

```rust
// BUY YES (Long)
let buy_yes_conditions = 
    price <= 0.35 &&                    // Sudah rendah
    (momentum == "UP" || speed > 0);   // Lagi naik
    
// BUY NO (Short)
let buy_no_conditions =
    price >= 0.65 &&                    // Sudah tinggi
    (momentum == "DOWN" || speed < 0);  // Lagi turun
```

### 4. Dashboard UI - Tambah Kolom Momentum

```
| Time | Count | Yes%   | No%   | Momentum | Signal  | Action |
|------|-------|-------|-------|----------|---------|--------|
| 14:30| 04:35 | 23%   | 77%   | ↑ FAST   | BUY YES | [Buy]  |
| 14:25| 04:30 | 77%   | 23%   | ↓ FAST   | BUY NO  | [Buy]  |
| 14:20| 04:25 | 52%   | 48%   | → SIDE   | WAIT    | -      |
```

---

## Implementation Plan

### Phase 1: Data Collection (30 menit)

- Tambah price fetcher setiap 30 detik
- Simpan ke memory (Vec<PricePoint>)
- Tidak perlu persistent storage dulu

### Phase 2: Momentum Calculator (1 jam)

- fn calculate_momentum()
- Update setiap 1 menit
- Return: direction, speed, acceleration

### Phase 3: Smart Entry Logic (2 jam)

- Update trading decision tree
- Tambah threshold baru
- Backtest dengan data 7 hari

### Phase 4: Dashboard Enhancement (1 jam)

- Tampilkan momentum column
- Color coded: ↑=green, ↓=red, →=gray
- Alert waktu ada opportunities

---

## Risk Management

### Position Sizing
```rust
// Kalau momentum kuat → bet lebih besar
let bet_multiplier = if speed.abs() > 0.05 { 1.5 }
                     else if speed.abs() > 0.03 { 1.0 }
                     else { 0.5 };  // conservative
```

### Stop Loss
```rust
// Keluar kalau momentum berbalik
let exit_conditions = 
    // Buy Yes: kalau price turun > 10% dari entry
    (outcome == "Yes" && entry_price - current_price > 0.10) ||
    // Buy No: kalau price naik > 10% dari entry  
    (outcome == "No" && current_price - entry_price > 0.10);
```

---

## Expected Results (Hypothetical)

| Strategy | Win Rate | Avg P&L |
|----------|----------|---------|
| Original (price only) | ~45% | -$0.02 |
| Momentum enhanced | ~60% | +$0.15 |

---

## Technical Changes

### Files to Modify
1. `btc5m_dashboard.rs` - Add momentum logic
2. `data_fetcher.rs` - Fetch every 30s (bukan 30s? check existing)

### New Dependencies
- Tidak ada, bisa hitung sendiri

### API Calls
- Same Polymarket API
- Fetch lebih sering jika perlu

---

## Next Steps

1. **Approve plan** → implement
2. **Backtest** dengan data historis
3. **Paper trade** dulu 1 minggu
4. **Go live** kalau profitables