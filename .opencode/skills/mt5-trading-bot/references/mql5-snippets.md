# MQL5 Snippets Siap Pakai

## Order Management

### Buka Order Buy
```mql5
bool OpenBuy(double sl, double tp, double lots, string comment = "")
{
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.volume    = lots;
   req.type      = ORDER_TYPE_BUY;
   req.price     = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   req.sl        = sl;
   req.tp        = tp;
   req.deviation = 10;
   req.magic     = MagicNumber;
   req.comment   = comment;
   req.type_filling = ORDER_FILLING_FOK;
   
   if(!OrderSend(req, res))
   {
      Print("❌ OpenBuy Error: ", res.retcode, " - ", res.comment);
      return false;
   }
   Print("✅ BUY opened: Ticket=", res.order, " Lots=", lots, " Price=", res.price);
   return true;
}
```

### Buka Order Sell
```mql5
bool OpenSell(double sl, double tp, double lots, string comment = "")
{
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   
   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = _Symbol;
   req.volume    = lots;
   req.type      = ORDER_TYPE_SELL;
   req.price     = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   req.sl        = sl;
   req.tp        = tp;
   req.deviation = 10;
   req.magic     = MagicNumber;
   req.comment   = comment;
   req.type_filling = ORDER_FILLING_FOK;
   
   if(!OrderSend(req, res))
   {
      Print("❌ OpenSell Error: ", res.retcode, " - ", res.comment);
      return false;
   }
   Print("✅ SELL opened: Ticket=", res.order, " Lots=", lots, " Price=", res.price);
   return true;
}
```

### Tutup Semua Trade by Magic
```mql5
void CloseAllTrades()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      
      MqlTradeRequest req = {};
      MqlTradeResult  res = {};
      
      req.action   = TRADE_ACTION_DEAL;
      req.symbol   = PositionGetString(POSITION_SYMBOL);
      req.volume   = PositionGetDouble(POSITION_VOLUME);
      req.position = ticket;
      req.type     = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) 
                      ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      req.price    = (req.type == ORDER_TYPE_SELL) 
                      ? SymbolInfoDouble(_Symbol, SYMBOL_BID) 
                      : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      req.deviation = 10;
      req.type_filling = ORDER_FILLING_FOK;
      
      if(!OrderSend(req, res))
         Print("❌ CloseAll Error ticket=", ticket, ": ", res.retcode);
   }
}
```

## Trailing Stop

```mql5
void ManageTrailingStop()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentSL = PositionGetDouble(POSITION_SL);
      double trailStartPoints = TrailStart_Pips * _Point * 10;
      double trailStepPoints  = TrailStep_Pips * _Point * 10;
      
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         double profit = bid - openPrice;
         if(profit >= trailStartPoints)
         {
            double newSL = bid - trailStepPoints;
            if(newSL > currentSL + _Point)
               ModifySL(ticket, newSL);
         }
      }
      else // SELL
      {
         double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         double profit = openPrice - ask;
         if(profit >= trailStartPoints)
         {
            double newSL = ask + trailStepPoints;
            if(newSL < currentSL - _Point || currentSL == 0)
               ModifySL(ticket, newSL);
         }
      }
   }
}

bool ModifySL(ulong ticket, double newSL)
{
   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   
   req.action   = TRADE_ACTION_SLTP;
   req.position = ticket;
   req.sl       = NormalizeDouble(newSL, _Digits);
   req.tp       = PositionGetDouble(POSITION_TP);
   
   if(!OrderSend(req, res))
   {
      Print("❌ ModifySL Error: ", res.retcode);
      return false;
   }
   return true;
}
```

## Deteksi New Bar

```mql5
datetime lastBarTime = 0;

bool IsNewBar()
{
   datetime currentBarTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(currentBarTime != lastBarTime)
   {
      lastBarTime = currentBarTime;
      return true;
   }
   return false;
}
```

## Hitung Jumlah Posisi Open (by Magic)

```mql5
int CountOpenPositions(ENUM_POSITION_TYPE type = -1)
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(PositionGetTicket(i) == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(type != -1 && PositionGetInteger(POSITION_TYPE) != type) continue;
      count++;
   }
   return count;
}
```

## Spread Filter

```mql5
bool IsSpreadOK(int maxSpreadPoints)
{
   int spread = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > maxSpreadPoints)
   {
      Print("⚠️ Spread terlalu lebar: ", spread, " points. Skip entry.");
      return false;
   }
   return true;
}
```

## ATR untuk Dynamic SL/TP

```mql5
double GetATR(int period = 14, int shift = 1)
{
   int handle = iATR(_Symbol, PERIOD_CURRENT, period);
   if(handle == INVALID_HANDLE) return 0;
   
   double atrBuf[];
   ArraySetAsSeries(atrBuf, true);
   if(CopyBuffer(handle, 0, shift, 1, atrBuf) <= 0) return 0;
   
   return atrBuf[0];
}
// Contoh penggunaan:
// double sl = GetATR(14) * 1.5; // SL = 1.5x ATR
// double tp = GetATR(14) * 3.0; // TP = 3x ATR (RR 1:2)
```

## Get Balance Awal Hari (untuk daily loss tracking)

```mql5
double GetDayStartBalance()
{
   datetime dayStart = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
   
   HistorySelect(dayStart, TimeCurrent());
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   
   // Kurangi profit/loss hari ini
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(ticket, DEAL_TIME) < dayStart) break;
      if(HistoryDealGetInteger(ticket, DEAL_MAGIC) != MagicNumber) continue;
      balance -= HistoryDealGetDouble(ticket, DEAL_PROFIT);
      balance -= HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      balance -= HistoryDealGetDouble(ticket, DEAL_SWAP);
   }
   return balance;
}
```

## Send Alert ke HP / Email

```mql5
void SendTradeAlert(string message)
{
   Print("🔔 ALERT: ", message);
   SendNotification(message); // Push notification ke MT5 mobile
   // SendMail("EA Alert", message); // Uncomment jika pakai email
}
```