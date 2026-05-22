# 💰 Compound Lot Sizing System — MT5 Trading Bot

## Filosofi Compound

> "Bukan seberapa besar profit sekali trade — tapi seberapa konsisten kamu tumbuh setiap siklus."

Compound di sini artinya: **lot size naik otomatis seiring pertumbuhan balance**,
bukan martingale (nambah lot setelah loss), tapi **equity-based scaling**.

---

## Tabel Compound: Balance → Lot Size

### Skala Konservatif (Risk 1% per trade) — REKOMENDASI UNTUK PEMULA

| Balance (USD) | Lot Size | Risk/Trade | Keterangan |
|---|---|---|---|
| $50 – $99 | 0.01 | ~$0.50 | Starter, belajar dulu |
| $100 – $199 | 0.02 | ~$1.00 | Compound pertama |
| $200 – $299 | 0.03 | ~$1.50 | Mulai terasa |
| $300 – $499 | 0.05 | ~$2.50 | Growth zone |
| $500 – $749 | 0.07 | ~$3.50 | Accelerating |
| $750 – $999 | 0.10 | ~$5.00 | Double digit |
| $1,000 – $1,499 | 0.14 | ~$7.00 | Pro level |
| $1,500 – $1,999 | 0.20 | ~$10.00 | Serious capital |
| $2,000 – $2,999 | 0.28 | ~$14.00 | Semi-institutional |
| $3,000 – $4,999 | 0.40 | ~$20.00 | Fund level |
| $5,000+ | 0.60+ | ~$30.00+ | Skala bebas 1% |

### Skala Moderat (Risk 1.5% per trade) — UNTUK YANG SUDAH BERPENGALAMAN

| Balance (USD) | Lot Size | Risk/Trade |
|---|---|---|
| $50 – $99 | 0.01 | ~$0.75 |
| $100 – $199 | 0.03 | ~$1.50 |
| $200 – $299 | 0.05 | ~$2.50 |
| $300 – $499 | 0.07 | ~$3.50 |
| $500 – $749 | 0.10 | ~$5.00 |
| $750 – $999 | 0.14 | ~$7.00 |
| $1,000 – $1,499 | 0.20 | ~$10.00 |
| $1,500 – $1,999 | 0.28 | ~$14.00 |
| $2,000 – $2,999 | 0.40 | ~$20.00 |
| $3,000 – $4,999 | 0.60 | ~$30.00 |
| $5,000+ | 0.90+ | ~$45.00+ |

### Skala Agresif (Risk 2% per trade) — HANYA UNTUK STRATEGI WIN RATE > 60%

| Balance (USD) | Lot Size | Risk/Trade |
|---|---|---|
| $50 – $99 | 0.01 | ~$1.00 |
| $100 – $199 | 0.03 | ~$2.00 |
| $200 – $299 | 0.06 | ~$3.00 |
| $300 – $499 | 0.09 | ~$4.50 |
| $500 – $749 | 0.14 | ~$7.00 |
| $750 – $999 | 0.20 | ~$10.00 |
| $1,000 – $1,499 | 0.28 | ~$14.00 |
| $1,500 – $1,999 | 0.40 | ~$20.00 |
| $2,000+ | 0.56+ | ~$28.00+ |

---

## Proyeksi Pertumbuhan Compound (Simulasi)

Asumsi: Win rate 55%, RR 1:2, trading 3-5 trade/hari, mulai $50

### Target: $50 → $1,000 (Skala Konservatif, 1%)

| Milestone | Balance | Lot | Estimasi Minggu | Notes |
|---|---|---|---|---|
| Start | $50 | 0.01 | Week 0 | Belajar, jangan terburu |
| Level 1 | $100 | 0.02 | ~Week 4-8 | Compound pertama! |
| Level 2 | $200 | 0.03 | ~Week 12-20 | Mulai serius |
| Level 3 | $500 | 0.07 | ~Week 24-36 | 10x dari awal |
| Level 4 | $1,000 | 0.14 | ~Week 40-60 | 20x dari awal |

> ⚠️ **Catatan realistis**: Timeline di atas asumsi konsisten dan disiplin.
> Actual bisa lebih cepat atau lebih lambat. Jangan paksa timeline!

---

## Kode MQL5 — Dynamic Compound Lot Calculator

```mql5
//+------------------------------------------------------------------+
//| Input Compound System                                             |
//+------------------------------------------------------------------+
input double RiskPercent    = 1.0;   // Risk per trade (%)
input double SL_Points      = 150;   // Stop Loss dalam points
input bool   UseCompound    = true;  // Aktifkan compound otomatis
input double ManualLot      = 0.01;  // Lot manual jika compound OFF

//+------------------------------------------------------------------+
//| Hitung Lot Size Dinamis Berdasarkan Balance                       |
//+------------------------------------------------------------------+
double CalculateCompoundLot(double slPoints)
{
   if(!UseCompound) return ManualLot;
   
   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * RiskPercent / 100.0;
   
   // Nilai per pip untuk XAUUSD (per lot standar = $10/pip)
   double pipValue   = 10.0; // USD per pip per lot standar
   double slPips     = slPoints / 10.0; // Konversi points ke pip (XAUUSD 1 pip = 10 points)
   
   double lotSize    = riskAmount / (slPips * pipValue);
   
   // Normalize ke standar broker
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   
   lotSize = MathFloor(lotSize / stepLot) * stepLot; // Bulatkan ke bawah (konservatif)
   lotSize = MathMax(minLot, MathMin(maxLot, lotSize));
   
   return lotSize;
}

//+------------------------------------------------------------------+
//| Get Level Compound Saat Ini (untuk display/logging)              |
//+------------------------------------------------------------------+
string GetCompoundLevel()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   
   if(balance < 100)   return "🌱 Starter ($50-$99) → Lot 0.01";
   if(balance < 200)   return "🌿 Level 1 ($100-$199) → Lot 0.02";
   if(balance < 300)   return "🌳 Level 2 ($200-$299) → Lot 0.03";
   if(balance < 500)   return "💪 Level 3 ($300-$499) → Lot 0.05";
   if(balance < 750)   return "🚀 Level 4 ($500-$749) → Lot 0.07";
   if(balance < 1000)  return "⭐ Level 5 ($750-$999) → Lot 0.10";
   if(balance < 1500)  return "🏆 Level 6 ($1000-$1499) → Lot 0.14";
   if(balance < 2000)  return "💎 Level 7 ($1500-$1999) → Lot 0.20";
   if(balance < 3000)  return "🌟 Level 8 ($2000-$2999) → Lot 0.28";
   return               "👑 Elite ($3000+) → Lot 0.40+";
}

//+------------------------------------------------------------------+
//| Display Info Compound di Chart (OnInit)                          |
//+------------------------------------------------------------------+
void DisplayCompoundInfo()
{
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double lot      = CalculateCompoundLot(SL_Points);
   double nextLevel = GetNextLevelBalance();
   double progress  = (balance / nextLevel) * 100.0;
   
   Comment(
      "╔══════════════════════════════╗\n",
      "║  💰 COMPOUND TRACKER         ║\n",
      "╠══════════════════════════════╣\n",
      "║  Balance : $", DoubleToString(balance, 2), "         \n",
      "║  Equity  : $", DoubleToString(equity, 2), "          \n",
      "║  Lot Now : ", DoubleToString(lot, 2), " lots      \n",
      "║  Level   : ", GetCompoundLevel(), "\n",
      "║  Next Lvl: $", DoubleToString(nextLevel, 0), " (", DoubleToString(progress, 1), "% done)\n",
      "╚══════════════════════════════╝"
   );
}

double GetNextLevelBalance()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(balance < 100)   return 100;
   if(balance < 200)   return 200;
   if(balance < 300)   return 300;
   if(balance < 500)   return 500;
   if(balance < 750)   return 750;
   if(balance < 1000)  return 1000;
   if(balance < 1500)  return 1500;
   if(balance < 2000)  return 2000;
   if(balance < 3000)  return 3000;
   return balance * 1.5; // Next milestone = 1.5x current
}
```

---

## Aturan Compound yang WAJIB Dipatuhi

### ✅ DO (Lakukan)
1. **Naik lot hanya saat balance stabil** — bukan saat equity floating profit
2. **Gunakan balance, bukan equity** untuk compound calculation
3. **Turunkan lot jika drawdown > 10%** — protect compound progress
4. **Celebrate setiap level** — motivasi penting dalam trading jangka panjang
5. **Catat setiap milestone** — screenshot balance saat level up

### ❌ DON'T (Jangan)
1. **Jangan skip level** — dari 0.01 langsung 0.10 karena "yakin" — berbahaya
2. **Jangan compound dari profit floating** — tunggu trade close dulu
3. **Jangan paksa lot besar saat market tidak kondusif** — preserve capital
4. **Jangan ubah lot di tengah sesi losing streak** — tunggu balance stabil
5. **Jangan martingale** — ini bukan compound, ini judi

---

## Compound + Withdrawal Strategy (Realistic)

Setelah balance tumbuh, gunakan strategi ini:

```
Setiap kali balance 2x dari modal awal:
→ Withdraw 50% (ambil profit, kembalikan modal awal)
→ Lanjut compound dengan sisa 50%

Contoh:
- Start: $100
- Grows to: $200 → Withdraw $100 (modal balik), lanjut dengan $100
- Grows to: $200 lagi → Withdraw $100 lagi
- Proses berulang → modal awal aman, profit terus compound
```

Ini strategi **"harvest and replant"** — lebih sustainable dari pure compound.