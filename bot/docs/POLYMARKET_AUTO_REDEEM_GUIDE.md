# Polymarket Auto-Redeem & Gasless Transactions Guide

## Overview

Polymarket has introduced two major features for streamlined position management:
1. **Auto-Redeem UI** — Users can enable automatic redemption of winnings
2. **Builder Relayer Client** — Programmable zero-gas redemption for bots

---

## Part 1: Auto-Redeem UI Feature

### What It Is
Polymarket added an **Auto-Redeem setting** that automatically redeems winning tokens from resolved markets without manual intervention. Users can enable it from:

```
Settings → Trading → Auto-Redeem (toggle ON)
```

### Benefits
- **No manual claiming** — Winning positions redeem automatically when markets resolve
- **Fewer transactions** — Single operation converts winning tokens → pUSD
- **Better UX** — Set once, forget about it for 24/7 trading

### Current Limitations (From User Perspective)
- UI-based only (no direct API endpoint yet)
- Requires user to enable in Polymarket dashboard
- No programmatic control from bot

---

## Part 2: Builder Relayer Client (Gasless Redemption)

### The Problem
Previously, our bot (and all Polymarket users) had to:
1. Hold POL in their wallet to pay for gas
2. Call `redeem_positions()` via smart contract directly
3. Pay gas fees (typically 0.5-2 POL per redemption)

**py-clob-client doesn't have a `redeem_positions()` method** — this is still a [requested feature](https://github.com/Polymarket/py-clob-client/issues/139) with 42+ upvotes but not yet implemented.

### The Solution: Builder Relayer Client

Polymarket provides the **Builder Relayer Client** which:
- **Executes transactions with ZERO gas fees** (Polymarket pays the relayer)
- **Requires only API credentials** (no POL needed in wallet)
- **Handles smart contract calls** (redeem, approve, split, merge)
- **Available in TypeScript + Python**

### How It Works

```
Bot creates transaction
    ↓
Bot signs with private key
    ↓
Bot sends to Polymarket Relayer API
    ↓
Relayer submits onchain (Polymarket pays gas)
    ↓
Transaction executes from user's Safe wallet
    ↓
Winning tokens → pUSD (zero fees)
```

### Setup: Builder Relayer Client

**1. Install SDK**

```bash
# Python
pip install @polymarket/builder-relayer-client
# or for Polygon
pip install polymarket-py

# TypeScript/Node
npm install @polymarket/builder-relayer-client
```

**2. Get API Credentials**

Go to [Polymarket Settings → API Keys](https://polymarket.com/settings?tab=builder) and create Builder API Key:
- `RELAYER_API_KEY` — API key
- `RELAYER_API_KEY_ADDRESS` — Address associated with key
- `RELAYER_API_HOST` — `https://relayer-v2.polymarket.com/`

Store in `.env`:
```bash
RELAYER_API_KEY=your_key
RELAYER_API_KEY_ADDRESS=0x...
RELAYER_API_HOST=https://relayer-v2.polymarket.com/
```

**3. Initialize Client**

```typescript
import { RelayClient } from "@polymarket/builder-relayer-client";

const client = new RelayClient({
  host: process.env.RELAYER_API_HOST,
  chain: 137,  // Polygon
  signer: userWallet,  // ethers.js Signer or equivalent
  relayerApiKey: process.env.RELAYER_API_KEY,
  relayerApiKeyAddress: process.env.RELAYER_API_KEY_ADDRESS,
});
```

**4. Redeem Positions**

```typescript
// Build redeem transaction
const redeemTx = {
  to: CTF_ADDRESS,  // Conditional Token Framework contract
  data: encodeFunctionData({
    abi: clobAbi,
    functionName: "redeemPositions",
    args: [
      collateralToken,  // USDC
      parentCollectionId,  // 0 for most cases
      conditionId,  // hex string from Polymarket
      indexSets,  // [1] for YES or [2] for NO (or both)
    ],
  }),
  value: "0",
};

// Execute via relayer (zero gas)
const response = await client.execute([redeemTx], "Redeem winning positions");
await response.wait();
```

---

## Part 3: Implications for Our Bot

### Current Implementation
Our backend (`backend/main.py`) has:
```python
async def redeem_winning_positions():
    """Real mode only: poll for resolved markets and claim winnings"""
    # Currently: uses py-clob-client (limited)
    # Manually calls client.redeem_positions() if available
```

**Current status:** We're already calling `redeem_positions()` via py-clob-client, but this may not work for all Polygon-based Safe wallets.

### Recommended Upgrade Path

**Option A: Add Builder Relayer Client (Recommended)**

Benefits:
- Zero gas fees (no POL needed)
- Works reliably with Polygon Safe wallets
- Direct smart contract call control
- Future-proof for scale

Implementation:
```python
import asyncio
from polymarket_py import RelayClient

async def redeem_winning_positions_gasless():
    """Redeem via Builder Relayer (zero gas)"""
    client = RelayClient(
        host=os.getenv("RELAYER_API_HOST"),
        signer=wallet,  # ethers-like signer
        relayer_api_key=os.getenv("RELAYER_API_KEY"),
    )
    
    # Find all resolved positions
    for pos in S.positions:
        if pos["status"] == "resolved" and pos.get("won"):
            # Build redeem call
            tx = {
                "to": CTF_ADDRESS,
                "data": encode_redeem_call(
                    conditionId=pos["condition_id"],
                    indexSet=[1 if pos["outcome"] == "UP" else 2],
                )
            }
            
            # Execute via relayer
            response = await client.execute([tx], f"Redeem {pos['id']}")
            await response.wait()
            
            add_log("REDEEM_SUCCESS", {"position_id": pos["id"], "gas_cost": "0"})
```

**Option B: Stay with py-clob-client (Current)**

- Simpler (minimal code changes)
- Still requires POL for gas
- May fail for Safe multisig wallets
- Limited as py-clob-client doesn't officially support it

### Cost Comparison

| Method | Gas Cost | Frequency | Monthly Cost |
|---|---|---|---|
| Direct contract calls | ~0.5-2 POL per tx | 1-5 per day | $60-600 (POL fluctuates) |
| Builder Relayer | **$0** | 1-5 per day | **$0** |
| UI Manual claim | Variable | Manual | Unpredictable |

**At scale (6 bots):** Relayer saves ~$300-3600/month in gas fees.

---

## Part 4: Integration Checklist

To upgrade our bot for auto-redemption with Builder Relayer:

- [ ] Install `polymarket-py` or TypeScript `@polymarket/builder-relayer-client`
- [ ] Add RELAYER_API_KEY, RELAYER_API_KEY_ADDRESS to bot env files
- [ ] Implement `redeem_winning_positions_gasless()` in `main.py`
- [ ] Replace existing `redeem_winning_positions()` logic
- [ ] Test on dry_run mode (mock relayer responses)
- [ ] Test on real mode with small capital ($10-50)
- [ ] Monitor redemption logs for success/failures
- [ ] Set up cron alert if redemptions fail 3+ times

---

## Part 5: Resources

| Resource | Link |
|---|---|
| Polymarket Gasless Docs | [docs.polymarket.com/trading/gasless](https://docs.polymarket.com/trading/gasless) |
| Polymarket Token Redemption | [docs.polymarket.com/trading/ctf/redeem](https://docs.polymarket.com/trading/ctf/redeem) |
| Builder Relayer (TypeScript) | [GitHub: Polymarket/builder-relayer-client](https://github.com/Polymarket/builder-relayer-client) |
| Polymarket Auto-Redeem News | [KuCoin: Auto-Redeem Feature](https://www.kucoin.com/news/community/POL/69e72f369b8ebc0007ccf822) |
| py-clob-client V2 | [GitHub: py-clob-client-v2](https://github.com/Polymarket/py-clob-client-v2) |
| Community Gasless Redeem CLI | [GitHub: polymarket-gasless-redeem-cli](https://github.com/NocodeSolutions/polymarket-gasless-redeem-cli) |

---

## Next Decision

**Should we integrate Builder Relayer Client into our bot?**

**Pros:**
- ✅ Zero gas fees (major cost saving at scale)
- ✅ Works with all wallet types (EOA + Safe multisig)
- ✅ More reliable than current approach
- ✅ Future-proof for 6-bot VPS deployment

**Cons:**
- ❌ Requires additional API credentials setup
- ❌ New dependency (slight complexity increase)
- ❌ Need to test integration

**Recommendation:** **YES** — integrate for VPS deployment phase to ensure reliable, cost-efficient redemptions at scale.

