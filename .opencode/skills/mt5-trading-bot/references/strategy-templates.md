# Template Strategi EA MT5

## 1. EMA Cross Strategy (Trend Following)

**Cocok untuk**: Trending market, timeframe M15-H1
**Win rate ekspektasi**: 40-55%
**RR minimum**: 1:2

```mql5
// Signal Logic
input int FastEMA = 8;
input int SlowEMA = 21;
input int TrendEMA = 200;

bool GetBuySignal()
{
   double fastCurrent  = GetEMA(FastEMA, 0);
   double slowCurrent  = GetEMA(SlowEMA, 0);
   double fastPrev     = GetEMA(FastEMA, 1);
   double slowPrev     = GetEMA(SlowEMA, 1);
   double trend        = GetEMA(TrendEMA, 0);
   double closePrice   = iClose(_Symbol, PERIOD_CURRENT, 0);
   
   // EMA cross bullish + harga di atas trend EMA
   bool crossUp  = (fastCurrent > slowCurrent) && (fastPrev <= slowPrev);
   bool inUptrend = closePrice > trend;
   
   return crossUp && inUptrend;
}

bool GetSellSignal()
{
   double fastCurrent  = GetEMA(FastEMA, 0);
   double slowCurrent  = GetEMA(SlowEMA, 0);
   double fastPrev     = GetEMA(FastEMA, 1);
   double slowPrev     = GetEMA(SlowEMA, 1);
   double trend        = GetEMA(TrendEMA, 0);
   double closePrice   = iClose(_Symbol, PERIOD_CURRENT, 0);
   
   // EMA cross bearish + harga di bawah trend EMA
   bool crossDown   = (fastCurrent < slowCurrent) && (fastPrev >= slowPrev);
   bool inDowntrend = closePrice < trend;
   
   return crossDown && inDowntrend;
}

double GetEMA(int period, int shift)
{
   int handle = iMA(_Symbol, PERIOD_CURRENT, period, 0, MODE_EMA, PRICE_CLOSE);
   double buf[];
   ArraySetAsSeries(buf, true);
   CopyBuffer(handle, 0, shift, 1, buf);
   return buf[0];
}
```

---

## 2. RSI Divergence / Overbought-Oversold (Mean Reversion)

**Cocok untuk**: Ranging market, timeframe M30-H4
**Win rate ekspektasi**: 55-65%
**RR minimum**: 1:1.5

```mql5
input int RSI_Period = 14;
input int RSI_Oversold  = 30;
input int RSI_Overbought = 70;

bool GetBuySignal_RSI()
{
   double rsiCurrent = GetRSI(0);
   double rsiPrev    = GetRSI(1);
   
   // RSI bouncing dari oversold
   return (rsiPrev < RSI_Oversold) && (rsiCurrent > RSI_Oversold);
}

bool GetSellSignal_RSI()
{
   double rsiCurrent = GetRSI(0);
   double rsiPrev    = GetRSI(1);
   
   // RSI turun dari overbought
   return (rsiPrev > RSI_Overbought) && (rsiCurrent < RSI_Overbought);
}

double GetRSI(int shift)
{
   int handle = iRSI(_Symbol, PERIOD_CURRENT, RSI_Period, PRICE_CLOSE);
   double buf[];
   ArraySetAsSeries(buf, true);
   CopyBuffer(handle, 0, shift, 1, buf);
   return buf[0];
}
```

---

## 3. Bollinger Band Breakout (Volatility Breakout)

**Cocok untuk**: News event aftermath, London/NY open
**Win rate ekspektasi**: 35-45%
**RR minimum**: 1:3

```mql5
input int BB_Period = 20;
input double BB_Deviation = 2.0;

bool GetBuySignal_BB()
{
   // Close candle sebelumnya di atas upper band → breakout up
   double upperBand = GetBB(0, 1); // upper band, shift 1
   double closeBar1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   double closeBar2 = iClose(_Symbol, PERIOD_CURRENT, 2);
   double upperBar2 = GetBB(0, 2);
   
   // Candle 2 di bawah/di band, candle 1 breakout ke atas
   return (closeBar2 <= upperBar2) && (closeBar1 > upperBand);
}

double GetBB(int buffer, int shift)
// buffer: 0=upper, 1=middle, 2=lower
{
   int handle = iBands(_Symbol, PERIOD_CURRENT, BB_Period, 0, BB_Deviation, PRICE_CLOSE);
   double buf[];
   ArraySetAsSeries(buf, true);
   CopyBuffer(handle, buffer, shift, 1, buf);
   return buf[0];
}
```

---

## 4. London Breakout (Session Breakout)

**Cocok untuk**: XAUUSD London Open, timeframe M15-H1
**Win rate ekspektasi**: 50-60%
**RR minimum**: 1:2

```mql5
// Rekam high/low Asian session (00:00-07:00 GMT)
// Di London open, trade breakout dari range Asian

double asianHigh = 0, asianLow = 0;
bool asianRangeSet = false;

void SetAsianRange()
{
   // Dipanggil sekali setelah Asian session selesai
   // Cari high/low dari bar Asian
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   
   if(dt.hour == 7 && dt.min == 0 && !asianRangeSet)
   {
      asianHigh = 0;
      asianLow  = 999999;
      
      // Loop bars dari 00:00 GMT
      for(int i = 0; i < 100; i++)
      {
         datetime barTime = iTime(_Symbol, PERIOD_M15, i);
         MqlDateTime barDt;
         TimeToStruct(barTime, barDt);
         
         if(barDt.hour >= 7) continue; // Skip London hours
         
         double barHigh = iHigh(_Symbol, PERIOD_M15, i);
         double barLow  = iLow(_Symbol, PERIOD_M15, i);
         
         if(barHigh > asianHigh) asianHigh = barHigh;
         if(barLow  < asianLow)  asianLow  = barLow;
      }
      
      asianRangeSet = true;
      Print("Asian Range: High=", asianHigh, " Low=", asianLow);
   }
}

bool GetBuySignal_LondonBreakout()
{
   if(!asianRangeSet) return false;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   return ask > asianHigh + (10 * _Point); // Breakout 10 pts above range
}

bool GetSellSignal_LondonBreakout()
{
   if(!asianRangeSet) return false;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   return bid < asianLow - (10 * _Point); // Breakdown 10 pts below range
}
```

---

## 5. Scalping M1/M5 — Fast EMA + Price Action

**Cocok untuk**: High liquidity, spread rendah, XAUUSD London/NY
**Win rate ekspektasi**: 55-65%
**RR minimum**: 1:1.5

```mql5
input int EMA_Fast = 8;
input int EMA_Slow = 21;
input int RSI_Period = 7;  // RSI cepat untuk scalping

bool GetScalpBuy()
{
   double ema8  = GetEMA(EMA_Fast, 0);
   double ema21 = GetEMA(EMA_Slow, 0);
   double rsi   = GetRSI(1); // Bar sebelumnya
   double close  = iClose(_Symbol, PERIOD_CURRENT, 1);
   
   // EMA8 > EMA21 (uptrend)
   // RSI tidak overbought
   // Close > EMA8 (harga di atas MA cepat)
   return (ema8 > ema21) && (rsi < 65) && (close > ema8);
}

bool GetScalpSell()
{
   double ema8  = GetEMA(EMA_Fast, 0);
   double ema21 = GetEMA(EMA_Slow, 0);
   double rsi   = GetRSI(1);
   double close  = iClose(_Symbol, PERIOD_CURRENT, 1);
   
   return (ema8 < ema21) && (rsi > 35) && (close < ema8);
}
```

---

## 6. Smart Money Concept (SMC) — Simplified

**Cocok untuk**: Trend market dengan pullback, H1-H4
**Win rate ekspektasi**: 55-65%
**RR minimum**: 1:3

```mql5
// Deteksi Break of Structure (BOS) dan Change of Character (CHoCH)
// Entry di Order Block setelah BOS

// Order Block = last bearish candle sebelum bullish impulse (untuk buy)
//             = last bullish candle sebelum bearish impulse (untuk sell)

struct OrderBlock {
   double high;
   double low;
   datetime time;
   bool bullish; // true=demand zone, false=supply zone
};

OrderBlock FindLastOrderBlock(bool isBullish)
{
   OrderBlock ob;
   ob.high = ob.low = 0;
   
   // Cari swing yang membentuk BOS
   for(int i = 5; i < 100; i++)
   {
      if(isBullish)
      {
         // Cari candle bearish terakhir sebelum impulse bullish kuat
         if(iClose(_Symbol, PERIOD_CURRENT, i) < iOpen(_Symbol, PERIOD_CURRENT, i))
         {
            ob.high    = iHigh(_Symbol, PERIOD_CURRENT, i);
            ob.low     = iLow(_Symbol, PERIOD_CURRENT, i);
            ob.time    = iTime(_Symbol, PERIOD_CURRENT, i);
            ob.bullish = true;
            break;
         }
      }
      else
      {
         if(iClose(_Symbol, PERIOD_CURRENT, i) > iOpen(_Symbol, PERIOD_CURRENT, i))
         {
            ob.high    = iHigh(_Symbol, PERIOD_CURRENT, i);
            ob.low     = iLow(_Symbol, PERIOD_CURRENT, i);
            ob.time    = iTime(_Symbol, PERIOD_CURRENT, i);
            ob.bullish = false;
            break;
         }
      }
   }
   return ob;
}
```

---

## Kombinasi Filter Terbaik untuk XAUUSD

```mql5
// Gunakan kombinasi ini untuk filter entry berkualitas tinggi:

bool IsHighQualityEntry(bool isBuy)
{
   // 1. Session filter
   if(!IsTradingSessionAllowed()) return false;
   
   // 2. Spread filter  
   if(!IsSpreadOK(60)) return false;  // Max 60 pts untuk XAUUSD
   
   // 3. ATR filter (pastikan ada volatilitas cukup)
   double atr = GetATR(14);
   if(atr < 300 * _Point) return false;  // Min ATR 300 pts
   
   // 4. No existing position in same direction
   ENUM_POSITION_TYPE checkType = isBuy ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
   if(CountOpenPositions(checkType) > 0) return false;
   
   // 5. Drawdown check
   if(IsDrawdownExceeded()) return false;
   if(IsDailyLossExceeded()) return false;
   
   // 6. Max open positions
   if(CountOpenPositions() >= MaxOpenTrades) return false;
   
   return true;
}
```