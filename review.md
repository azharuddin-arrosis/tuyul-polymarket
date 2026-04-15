# Code Review Summary

## main.rs (Simulation Bot)

### Critical Issues
1. **Fake trading** - Lines 603-609 generate random mock markets, not real Polymarket data
2. **Random trade outcomes** - Lines 638-661 simulate wins/losses randomly, not actual trading
3. **Hardcoded IDR rate** - Line 176: `16200.0` should come from an API
4. **Race condition** - Multiple bot workers lock the same `MasterState` without fine-grained locking
5. **No state persistence in worker** - Comment on line 668 acknowledges the issue but doesn't fix it properly

### Medium Issues
- Telegram bot token exposed in code (should use env var consistently)
- Inconsistent error handling in `send_telegram_msg`

## real_bot.rs (Real API Integration)

### Good
- Actually connects to real Polymarket APIs (CLOB, Data, Gamma)
- HMAC authentication properly implemented

### Issues
1. **No trade execution** - Only reads data, doesn't place orders
2. **Inefficient env loading** - Line 146: `dotenv().ok()` called every loop iteration
3. **No reconnection handling** - API failures silently ignored

## get_polymarket_creds.py

### Security Issues
1. **Hardcoded private key** - Lines 11-12 require user to edit file with secrets
2. **Writable .env** - Should warn about file permissions

## Recommendations
1. **main.rs is a simulator** - Rename to clarify it's not real trading
2. **Add actual trade execution** to `real_bot.rs` using `py_clob_client`
3. **Separate state per bot** to avoid contention
4. **Add proper error handling** and retry logic for API calls
5. **Add `.env` to `.gitignore`** to prevent credential leakage
