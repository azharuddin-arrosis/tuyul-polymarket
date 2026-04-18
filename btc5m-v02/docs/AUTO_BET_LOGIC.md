# Auto Bet Prediction Logic

## Overview
Bot menggunakan sistem scoring untuk menentukan apakah harus bet atau skip. Setiap kondisi memberikan score, dan trade hanya dilakukan jika confidence ≥ 50%.

---

## Prediction Function: `analyze_market()`

| Kondisi | Score | Keterangan |
|---------|-------|-------------|
| **Sweet Spot Price** (40% - 52%) | +25 | Harga ideal untuk bet |
| **Acceptable Range** (35% - 58%) | +15 | Range masih acceptable |
| **Rising Trend** (price change +1% to +10%) | +20 | Harga naik → bet YES |
| **Falling Trend** (price change -1% to -10%) | +20 | Harga turun → bet NO |
| **Too Volatile** (change > 15%) | SKIP | Skip karena terlalu tidak menentu |
| **Optimal Entry Time** (60-180 detik dalam) | +15 | Waktu entry optimal |
| **Acceptable Entry Time** (30-240 detik) | +5 | Waktu entry acceptable |
| **Mean Reversion** (deviation > 8% dari 0.5) | +10 | Harga jauh dari 0.5, kemungkinan return |
| **Trend Confirming** | +15 | Trend bergerak menuju 0.5 |

---

## Direction Logic

```rust
let direction = if yes_price < 0.50 { "Yes" } else { "No" };
```

- **YES** = Harga di bawah 50%, diharapkan naik (bounce)
- **NO** = Harga di atas 50%, diharapkan turun (reversion)

---

## Entry Conditions (can_trade)

| Condition | Value | Description |
|-----------|-------|-------------|
| `time_left > 30` | > 30 detik | Masih ada waktu minimal |
| `time_into >= 30` | 30-270 detik | Tidak terlalu awal/telat |
| `yes_price > 0.01` | > 1% | Harga valid |
| `yes_price < 0.99` | < 99% | Harga valid |
| `yes_price < 0.78` | < 78% | Skip overconfident |

---

## Final Decision

```rust
if prediction.confidence >= 50 {
    // Execute trade
} else {
    // Skip - low confidence
}
```

Confidence dihitung: `score.min(95)` (maksimal 95%)

---

## Example Logs

```
[AUTO] No $1.00 @ 49.0c T-256s | Sweet spot price, Rising 1.0%, Acceptable entry time
[AUTO] Yes $0.96 @ 46.0c T-207s | Sweet spot price, Falling -4.0%, Optimal entry time
```

---

## Risk Management

- **TP (Take Profit)**: +20% dari entry price
- **SL (Stop Loss)**: -20% dari entry price  
- **Profit Lock**: Auto exit saat +20% (ambil profit)