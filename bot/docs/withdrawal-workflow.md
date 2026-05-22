# Withdrawal Workflow — Manual Control

Auto-withdrawal telah di-disable. Withdrawal sekarang **manual-only** untuk kontrol penuh.

---

## Workflow Overview

```
Bot earning profit → Capital reaches $100+ → ./wd.sh suggest
  → User: ./orchestrator.sh stop
  → User: Withdraw manually dari Polymarket UI
  → ./wd.sh confirm dengan balance baru
  → Bot restart
```

---

## Step-by-Step: real1 Example

### 1. Check Withdrawal Status

```bash
./wd.sh status
```

Output:
```
BOT        CAPITAL      TO $100        STATUS
real1      $102.24      $—             ✓ READY
real2      $17.16       $82.84         ⏳ Waiting
...
```

### 2. Get Withdrawal Suggestion

```bash
./wd.sh suggest real1 50
```

Shows:
- Current capital: **$102.24**
- Suggest withdraw: **$51.12** (50%)
- After withdrawal: **$51.12** (50%)

**Customize percentage:**
```bash
./wd.sh suggest real1 30    # withdraw 30%, keep 70%
./wd.sh suggest real1 70    # withdraw 70%, keep 30%
```

### 3. Stop Bot & Withdraw Manually

```bash
./orchestrator.sh stop real1
```

Cek bot sudah stop:
```bash
./orchestrator.sh status  # real1 should show STOPPED
```

**Go to Polymarket UI (https://polymarket.com):**
1. Login dengan wallet yang punya bot's private key
2. Withdraw $51.12 USDC ke external wallet (atau keep in Polymarket)
3. Account for withdrawal fees (usually ~2-5%)
4. After withdrawal complete, note:
   - **New USDC balance** in Polymarket wallet (e.g., $51.00 after fees)
   - **Remaining POL balance** for gas (e.g., 9.5 POL)

### 4. Confirm Withdrawal & Reset State

```bash
./wd.sh confirm real1 --usdc=51.00 --pol=9.5
```

Script akan:
- Update bot's capital → $51.00
- Reset daily_pnl → 0 (start fresh)
- Update env file dengan balance baru
- Backup old state

Konfirmasi dengan `y` saat diminta.

### 5. Restart Bot

```bash
./orchestrator.sh start real1 dry_run
```

Bot starts dengan capital=$51.00, daily_pnl=0, siap trading lagi.

---

## Percentage Suggestions

| Withdraw % | Keep % | Use Case |
|---|---|---|
| **30%** | 70% | Conservative (maximize trading capital) |
| **50%** | 50% | Balanced (take half profit) |
| **70%** | 30% | Aggressive (lock in most profit) |

**Rekomendasi:** 50% adalah sweet spot — ambil setengah profit, tetap punya capital besar untuk trading.

---

## Multiple Bots Withdrawal

Withdraw bots satu per satu **secara serial**, jangan simultaneous:

```bash
# Bot 1
./orchestrator.sh stop real1
# → manual withdrawal at Polymarket
./wd.sh confirm real1 --usdc=X --pol=Y
./orchestrator.sh start real1 dry_run

# Tunggu bot 1 stabil, baru lanjut bot 2
./orchestrator.sh stop real2
# → manual withdrawal
./wd.sh confirm real2 --usdc=X --pol=Y
./orchestrator.sh start real2 dry_run
```

---

## Backup & Recovery

Setiap `./wd.sh confirm` membuat automatic backup:

```bash
# Backup locations:
bot/data/real1/state_real1.json.bak      # previous state before withdrawal

# Jika perlu revert (rarely needed):
cp bot/data/real1/state_real1.json.bak bot/data/real1/state_real1.json
```

---

## Checklist

Before running `./wd.sh confirm`:

- [ ] Bot sudah di-stop via `./orchestrator.sh stop`
- [ ] Manual withdrawal dari Polymarket sudah selesai
- [ ] Catat final USDC balance (after fees)
- [ ] Catat remaining POL (for gas)
- [ ] Ready untuk `./wd.sh confirm`

---

## Troubleshooting

### "Bot is still RUNNING"
Bot masih jalan, stop dulu:
```bash
./orchestrator.sh stop <bot_id>
```

### "no state found for bot"
Bot belum pernah berjalan. Pastikan bot sudah di-run minimal 1x:
```bash
./orchestrator.sh start <bot_id> dry_run
sleep 5
./orchestrator.sh stop <bot_id>
```

### Need to revert a withdrawal
Restore dari backup:
```bash
cp bot/data/<bot>/state_<bot>.json.bak bot/data/<bot>/state_<bot>.json
```

---

## Backend Changes

Auto-withdrawal telah di-disable di `backend/main.py` (`check_salary()` function):
- Commented out lines 788-794
- Will not auto-withdraw saat capital >= $100
- Manual withdrawal hanya via `./wd.sh` script

To re-enable auto-withdrawal later: uncomment lines 788-794 di `check_salary()`.

---

## Next Phase

Future enhancements:
- [ ] API endpoint `/api/withdraw` untuk withdrawal via UI button
- [ ] Dashboard UI untuk show withdrawal suggestions
- [ ] Automatic Polymarket API withdrawal (tidak perlu manual UI)
- [ ] Batch withdrawal untuk multiple bots
