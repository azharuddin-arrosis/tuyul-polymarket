# Karakteristik Market XAUUSD (Gold)

## Sifat Dasar XAUUSD

| Properti | Nilai Tipikal |
|---|---|
| Spread rata-rata | 20-50 points (broker standar) |
| ATR Daily | 1500-3000 points (150-300 pip) |
| ATR H1 | 200-600 points |
| Lot min | 0.01 |
| Contract size | 100 oz per lot standar |
| Pip value (lot 0.1) | ~$1 per pip |
| Pip value (lot 1.0) | ~$10 per pip |

## Jam Trading & Sesi (WIB = GMT+7)

### 🟢 High Priority — Wajib Trading
| Sesi | Jam WIB | Jam GMT | Karakteristik |
|---|---|---|---|
| **London Open** | 14:00–17:00 | 07:00–10:00 | Volatilitas tinggi, trend kuat, volume besar |
| **NY Open** | 19:30–22:00 | 12:30–15:00 | Paling volatile, liquidity tertinggi |
| **London-NY Overlap** | 19:00–23:00 | 12:00–16:00 | Best zone untuk breakout dan momentum |

### 🟡 Medium Priority — Conditional
| Sesi | Jam WIB | Jam GMT | Karakteristik |
|---|---|---|---|
| **NY Afternoon** | 22:00–01:00 | 15:00–18:00 | Volume menurun, trend continuation |
| **Early London** | 12:00–14:00 | 05:00–07:00 | Pre-market, setup persiapan |

### 🔴 Hindari — Low Priority
| Sesi | Jam WIB | Jam GMT | Alasan |
|---|---|---|---|
| **Asian** | 02:00–11:00 | 19:00–04:00 | Ranging, spread lebar, fake breakout |
| **Dead Zone** | 01:00–06:00 WIB | 18:00–23:00 GMT | Volume sangat rendah |

## Kalender Event yang Mempengaruhi XAUUSD

### ⛔ STOP TRADING — High Impact Events
```
- NFP (Non-Farm Payroll): Jumat pertama setiap bulan, 19:30 WIB
- FOMC Meeting & Statement: 6–8x per tahun, biasanya Rabu 02:00 WIB
- US CPI (Inflasi): Setiap bulan, sekitar tanggal 10-15, 19:30 WIB
- US PPI: Sebelum/sesudah CPI
- Fed Chair Speech (Powell): Bervariasi
- US Retail Sales: Tiap bulan
- Geopolitical events besar
```

### ⚠️ WASPADA — Medium Impact
```
- US GDP, Trade Balance
- ISM Manufacturing/Services
- JOLTS Job Openings
- ECB Rate Decision (mempengaruhi DXY → Gold)
- China economic data (China adalah konsumen emas terbesar)
```

## Korelasi Penting XAUUSD

| Aset | Korelasi | Penjelasan |
|---|---|---|
| DXY (Dollar Index) | **Negatif kuat (-0.8)** | Dollar naik → Gold turun, dan sebaliknya |
| US10Y (Yield) | Negatif | Yield naik → investor pilih obligasi → Gold turun |
| S&P500 | Campuran | Risk-off: Gold naik; Risk-on: Gold bisa turun |
| Oil (WTI) | Positif lemah | Sama-sama commodity, tapi korelasi tidak konsisten |
| Silver (XAGUSD) | Positif kuat | Bergerak searah, Gold "memimpin" |

## Pola Harga Tipikal XAUUSD

### Pola Mingguan
- **Senin**: Sering gap open, hati-hati di awal sesi
- **Selasa-Rabu**: Biasanya trend mulai terbentuk
- **Kamis**: Continuation atau reversal menjelang NFP
- **Jumat (NFP)**: Volatilitas ekstrem, **hindari EA otomatis**

### Pola Harian
- **Asian→London transition**: Sering breakout dari range Asian
- **London→NY transition (19:00-20:00 WIB)**: False breakout umum terjadi
- **NY Close (22:00-24:00 WIB)**: Volume menurun, trend melemah

## Parameter EA yang Disesuaikan untuk XAUUSD

```mql5
// Rekomendasi settings untuk XAUUSD
#define XAUUSD_MIN_SPREAD    80   // Skip jika spread > 80 points
#define XAUUSD_SL_ATR_MULT   1.5  // SL = 1.5 × ATR(14)
#define XAUUSD_TP_ATR_MULT   3.0  // TP = 3.0 × ATR(14) → RR 1:2
#define XAUUSD_SLIPPAGE      30   // Toleransi slippage 30 points
#define XAUUSD_MIN_ATR       500  // Skip jika ATR < 500 (terlalu sepi)
```

## Key Support/Resistance Levels (Psychological)

Harga bulat pada XAUUSD sangat kuat sebagai S/R:
- Setiap $100 increment: $2000, $2100, $2200, $2300, dst
- Setiap $50 increment: $2050, $2150, $2250, dst
- Weekly High/Low selalu dijadikan reference trader institusional

## Liquidity Zones

- **Highs/Lows harian**: Target pertama untuk breakout
- **Previous week H/L**: S/R terkuat di H4-D1
- **Round numbers**: Magnet harga yang kuat
- **Unfilled gaps**: Sering kembali ke area gap sebelum lanjut

## Tips Scalping XAUUSD

1. Gunakan timeframe M5 atau M15 untuk entry, H1 untuk bias
2. Spread filter wajib: jangan entry jika spread > 30-40 points
3. SL minimal 150 points (1.5 pip) untuk menghindari noise
4. TP minimal 1:1.5 RR, ideal 1:2
5. Hindari entry 30 menit sebelum dan sesudah news high impact
6. Volume konfirmasi penting — spike volume sering menandai pembalikan