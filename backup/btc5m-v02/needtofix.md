# BTC 5m Bot v02 - Need to Fix

## 🚨 Critical Issues

### 1. Entry Price Too High (CRITICAL)

**Problem**: Bot enters at 0.70-0.92 prices — guaranteed loss long-term.

**Current Entry Prices from History**:
```
0.87, 0.92, 0.91, 0.87, 0.78, 0.76, 0.72, 0.65, 0.63, 0.77,...
```

**Why Critical**:
- Entry at $0.87 → only 15% max profit even if WIN
- Probability ~50% → Expected Value = -$0.36 per $1 bet
- You cannot overcome house edge this way

**Required Fix**:
```rust
// Maximum entry prices - STRICT ENFORCEMENT
const MAX_YES_ENTRY: f64 = 0.55;  // Only enter YES if price < 0.55
const MAX_NO_ENTRY: f64 = 0.55;    // Only enter NO (meaning YES > 0.45) = NO entry < 0.45
```

**or better**:
- YES only at 0.40-0.50 range
- NO only at 0.50-0.60 range (YES at 0.40-0.50)

---

### 2. Over-Trading Parah

**Problem**: Bot places 10+ trades per 5-minute window.

**Evidence**: ~47 trades in ~10 windows = ~5 trades/window

**Why Bad**:
- Too many positions to track
- High gas costs
- Low edge per trade
- No patience for good opportunities

**Required Fix**:
```rust
// Trading frequency limits
const MIN_TIME_BETWEEN_TRADES_SEC: i64 = 60;  // At least 60 seconds between trades
const MAX_TRADES_PER_WINDOW: u32 = 1;       // Maximum 1 trade per 5-min window
const MIN_MARKETS_SINCE_LAST_TRADE: u32 = 3;  // Skip at least 3 markets
```

---

### 3. analyze_market() Not Filtering Entry Price

**Problem**: Function analyzes direction but doesn't filter by entry price.

**Current Logic**:
```rust
fn analyze_market(...) -> Prediction {
    // ... score calculation ...
    let direction = if yes_price < 0.50 { "Yes" } else { "No" };  // WRONG!
}
```

This just follows the price above/below 0.5 — not checking if entry is good!

**Required Fix**:
```rust
fn analyze_market(yes_price: f64, ...) -> Prediction {
    // First: check if entry price is acceptable
    if yes_price > MAX_YES_ENTRY || yes_price < (1.0 - MAX_NO_ENTRY) {
        return Prediction {
            direction: "Skip".to_string(),
            confidence: 0,
            reason: "Entry price not acceptable".to_string(),
        };
    }

    // ... rest of analysis ...
}
```

---

## 🔧 Required Code Changes

### File: `bot/src/main.rs`

#### Change 1: Add strict entry price constants

```rust
// ADD after the existing const definitions:
const MAX_ENTRY_PRICE: f64 = 0.55;      // Don't enter above this
const MIN_ENTRY_PRICE: f64 = 0.45;     // Don't enter below this (for YES side)
```

#### Change 2: Fix analyze_market() to check entry price FIRST

```rust
// REPLACE the direction determination logic:
fn analyze_market(yes_price: f64, time_into: i64, time_left: i64) -> Prediction {
    // FIRST CHECK: Is entry price acceptable?
    if yes_price >= MAX_ENTRY_PRICE || yes_price <= MIN_ENTRY_PRICE {
        return Prediction {
            direction: "Skip".to_string(),
            confidence: 0,
            reason: format!("Entry {} not in range [{:.0}%, {:.0}%]",
                yes_price * 100.0, MIN_ENTRY_PRICE * 100.0, MAX_ENTRY_PRICE * 100.0),
        };
    }

    // ... existing logic below ...
}
```

#### Change 3: Add trade cooldown

```rust
// ADD in run_bot():
let last_trade_window = s.last_trade_timestamp / 300;
let current_window = now / 300;

// Only trade if different window OR enough time passed
if current_window == last_trade_window && (now - s.last_trade_timestamp) < MIN_TIME_BETWEEN_TRADES_SEC {
    // Skip - wait for next window
    continue;
}
```

#### Change 4: Remove the max_78% check (it's too high already)

```rust
// REMOVE or lower this line:
&& yes_price < 0.78  // THIS IS TOO HIGH!
```

Change to:
```rust
&& yes_price < MAX_ENTRY_PRICE
```

---

## 📋 Task List

- [ ] Add MAX_ENTRY_PRICE = 0.55 constant
- [ ] Add MIN_ENTRY_PRICE = 0.45 constant  
- [ ] Fix analyze_market() to reject bad entry prices FIRST
- [ ] Add trade cooldown: 1 trade per window maximum
- [ ] Lower `yes_price < 0.78` check to `MAX_ENTRY_PRICE`
- [ ] Test with demo mode
- [ ] Verify only entering in 0.40-0.55 range

---

## 🎯 Target Behavior

After fix, bot should:

1. **Enter ONLY** when YES price is 0.40-0.55
2. **Skip** when price is > 0.55 (too expensive for YES)
3. **Skip** when price is < 0.45 (too cheap - no edge)
4. **Maximum 1 trade** per 5-minute window
5. **Wait for good opportunities** instead of forcing trades

---

## 📝 Notes

- Current balance: $93.44 (started $100)
- Need to reset and rebuild from scratch after fixes
- Target: maintain $100+ without over-trading
- Focus on quality entries, not quantity