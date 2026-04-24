# Prediction Market Arbitrage

## Apa Itu Prediction Market Arbitrage?

Prediction market arbitrage adalah strategi trading di mana Anda membeli kontrak YES dan NO secara bersamaan untuk menghasilkan profit tanpa risiko, dengan memanfaatkan ketidakseimbangan harga antara kedua sisi.

**Prinsip Dasar:**
- Setiap kontrak YES/NO membayar $1 jika prediksi benar, $0 jika salah
- Dalam pasar efisien: YES + NO = $1.00
- Karena pasar tidak selalu efisien, sering terjadi gap: YES + NO < $1.00

---

## Contoh Sederhana

**Pertanyaan:** "Will Bitcoin hit $100k by March?"

| Kontrak | Harga |
|---------|-------|
| YES | $0.42 |
| NO  | $0.55 |
| **Total** | **$0.97** |

**Strategi:**
1. Beli YES seharga $0.42
2. Beli NO seharga $0.55
3. Total biaya: $0.97

**Hasil:**
- Bitcoin mencapai $100k → YES pays $1.00, NO $0 → Anda dapat $1.00
- Bitcoin tidak mencapai → YES $0, NO pays $1.00 → Anda dapat $1.00

**Profit:** $1.00 - $0.97 = **$0.03** (tidak peduli hasil akhir)

---

## Kenapa Gap Bisa Terjadi?

### 1. Respons Tidak Seimbang terhadap News
```
Sebelum news:      Sesudah news:
YES  $0.50         YES  $0.58  ← buyers rush in
NO   $0.50         NO   $0.39  ← hasn't adjusted yet
───────────        ──────────
Sum  $1.00         Sum  $0.97  ← gap opens!
```

News muncul → harga YES naik cepat, tapi NO belum menyesuaikan → gap tercipta.

### 2. Likuiditas Rendah
Kalau market sepi, harga bisa stale. Satu sisi update, sisi lain belum.

### 3. Cross-Platform
Platform berbeda bisa punya harga berbeda untuk event yang sama:

```
Same event: "Will X happen?"

Polymarket          Kalshi
┌──────────┐        ┌──────────┐
│ YES $0.45│        │ YES $0.51│
│ NO  $0.58│        │ NO  $0.52│
└──────────┘        └──────────┘

Buy YES di Polymarket ($0.45) + Buy NO di Kalshi ($0.52)
= $0.97 cost → $1.00 payout = $0.03 profit
```

---

## Scaling Profit

| Pairs | Cost | Payout | Profit |
|-------|------|--------|--------|
| 1     | $0.97 | $1.00 | $0.03 |
| 100   | $97   | $100  | $3     |
| 1,000 | $970  | $1,000| $30    |
| 10,000| $9,700| $10,000| $300  |

Return kecil per unit tapi risk-free dan linear scaling.

---

## Tantangan & Risk

### 1. Fees
- **Polymarket**: Maker fee 0%, Taker fee applies
- **Kalshi**: Transaction fee on expected earnings
- Gap $0.03 bisa hilang setelah fees

### 2. Slippage
```
Order book untuk YES:
Price    Available
$0.42    200 contracts  ← you want 1,000
$0.43    300 contracts
$0.44    500 contracts
         ───
         1,000 total

Average price: $0.434 (bukan $0.42!)
Gap shrink: $0.03 → $0.016
```

### 3. Kecepatan
- Window hanya beberapa detik
- Manusia tidak bisa compete dengan bots
-Perlu automated system untuk execute dalam milliseconds

### 4. Likuiditas
- Market tipis: gap besar tapi tidak bisa beli banyak
- Market liquid: gap kecil tapi bisa absorb order besar

---

## Kapan Worth It?

Gap harus cukup besar untuk survive:
- ✅ Fees
- ✅ Slippage  
- ✅ Execution time

**Realitanya:** Kebanyakan opportunity tidak worth it untuk manual trading. Tapi untuk automated systems yang watch hundreds of markets simultaneously, small edges add up.

---

## Untuk Bot Ini (Polymarket BTC 5m)

**Relevansi dengan project ini:**

1. **Arbitrage Opportunity**: Di Polymarket BTC 5m, bisa ada gap antara YES dan NO price
2. **Monitor YES + NO sum**: Kalau < $1.00, ada potential arbitrage
3. **Butuh modal besar**: Dengan gap kecil ($0.03), butuh banyak pairs untuk profit signifikan
4. **High frequency**: Market 5-menit, cepat bergerak, perlu bot monitoring

**Untuk implementasi future:**
- Watch YES + NO price di setiap market
- Hitung sum, kalau < threshold (misal $0.98), trigger arbitrage
- Execute both sides simultaneously
- Consider fees & slippage dalam calculation

---

## Referensi

- Polymarket: https://polymarket.com
- Kalshi: https://kalshi.com
- 0xinsider.com - Tools untuk melihat who's winning across prediction markets

---

*Doc created: April 2026*
*Source: Article by Trevor I. Lasn*