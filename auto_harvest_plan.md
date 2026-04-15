# Implementation Plan: Quantum Auto-Harvest & Profit Vault System

This plan outlines the implementation of an automated "secure-profit" system based on the 8:2 compounding rule (80% Withdrawal, 20% Compound).

## 1. Simulation: 10-Cycle Growth Table (8:2 Strategy)
Base assumption: Starting with **$100**, Target **2x Equity**.
- 80% of profit is secured for withdrawal.
- 20% of profit is added to the trading capital (Compound).

| Cycle | Start Modal | Target (2x) | Profit | WD (80%) | Compound (20%) | New Modal | Total Secured Profit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Start** | $100.00 | - | - | - | - | - | $0.00 |
| 1 | $100.00 | $200.00 | $100.00 | **$80.00** | $20.00 | $120.00 | $80.00 |
| 2 | $120.00 | $240.00 | $120.00 | **$96.00** | $24.00 | $144.00 | $176.00 |
| 3 | $144.00 | $288.00 | $144.00 | **$115.20** | $28.80 | $172.80 | $291.20 |
| 4 | $172.80 | $345.60 | $172.80 | **$138.24** | $34.56 | $207.36 | $429.44 |
| 5 | $207.36 | $414.72 | $207.36 | **$165.89** | $41.47 | $248.83 | $595.33 |
| 6 | $248.83 | $497.66 | $248.83 | **$199.06** | $49.77 | $298.60 | $794.39 |
| 7 | $298.60 | $597.20 | $298.60 | **$238.88** | $59.72 | $358.32 | $1,033.27 |
| 8 | $358.32 | $716.64 | $358.32 | **$286.66** | $71.66 | $429.98 | $1,319.93 |
| 9 | $429.98 | $859.96 | $429.98 | **$343.98** | $86.00 | $515.98 | $1,663.91 |
| 10 | $515.98 | $1,031.96 | $515.98 | **$412.78** | $103.20 | **$619.18** | **$2,076.69** |

**Summary at Cycle 10**: Your bot capital grows to **$619**, and you have already secured **$2,076** in profit.

---

## 2. Technical Features to Add

### A. Auto-Harvest Engine (The "Auto-Pilot")
The system will monitor equity in the background. Once the target is hit:
1.  **Auto-Trigger**: Set `withdraw_pending = true` automatically.
2.  **Notification**: Send Telegram: `"🚨 TARGET REACHED! Auto-harvest sequence started. Securing profits..."`
3.  **Natural Settlement**: Wait for all bots to finish their open trades.
4.  **Auto-Vault**: Once trades are closed, move 80% to a new `vault_balance` field and 20% to `farm_capital`.

### B. Profit Vault (The "Safety Bank")
- **`vault_balance`**: A new field in the system state that keeps track of all "withdrawn" money.
- This money is **untouchable** by the bots. Even if the bots lose their current capital, the vault remains safe.
- **UI Display**: Add a "Secured Vault" card in the dashboard.

### C. Logic Updates (`main.rs`)
- Add `vault_balance` to `MasterState`.
- Add `auto_harvest` toggle to `MasterState`.
- Update the monitor loop to check `if total_equity >= target && auto_harvest`.
- Update `withdraw` logic to increment `vault_balance` instead of just logging it.

## 3. Implementation Steps
1.  **State Update**: Add `vault_balance` and `auto_harvest` to Rust structs and JSON storage.
2.  **API Update**: New endpoint `/api/toggle_auto_harvest`.
3.  **UI Update**:
    - Add "Profit Vault" display (Balance + IDR).
    - Add "Auto-Harvest" switch in the header.
    - Show the simulation table in a modal/info panel.

---
> [!NOTE]
> This system ensures that your winings are "locked in" every time you hit 2x capital, protecting your overall farm profit from market volatility.
