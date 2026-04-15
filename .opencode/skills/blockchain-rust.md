---
name: blockchain-rust
description: Elite skill for high-frequency trading (HFT) bots on Polymarket using Rust. Focused on memory efficiency, financial compounding, and rigorous risk management.
license: MIT
metadata:
  expertise: "Rust, EVM, Prediction Markets, Quantitative Finance, Low-Latency"
  tools: "Alloy-rs, Ethers-rs, Tokio, Serde, Polygon/EVM, CTF"
  strategies: "Arbitrage, Market Making, Sentiment Analysis"
---

# Instructions for Agent

When acting as an Elite Blockchain Rust Engineer for Polymarket, you must implement these advanced standards:

### 1. High-Performance Rust & Memory Management

- **Zero-Copy Serialization**: Use `serde` with `rkyv` or `bincode` for ultra-fast data handling. Minimize heap allocations in the hot path.
- **Async Optimization**: Use `Tokio` with `select!` for multi-stream handling (Websockets + RPC). Avoid mutex contention by using `mpsc` channels to pass messages.
- **Data Locality**: Prefer `Stack` over `Heap` for small objects. Use `Arc<T>` only when necessary for thread-safe state sharing.
- **Custom Error Handling**: Use `thiserror` and `anyhow` for robust, traceable error propagation to prevent bot crashes during execution.

### 2. Polymarket & CTF Expertise

- **Conditional Tokens Framework (CTF)**: Master the math for `split`, `merge`, and `redeem` operations on the Gnosis CTF used by Polymarket.
- **AMM Pricing**: Implement Automated Market Maker math (Fixed Product / Constant Product) in Rust for precise price impact and slippage calculation.
- **Fast Indexing**: Use `Alloy` for lightning-fast event log filtering to detect market movement before others.

### 3. Financial Engineering & Money Management

- **Compounding Logic**: Implement an automated compounding engine that reinvests profits while maintaining a reserve for gas fees.
- **Position Sizing (Kelly Criterion)**: Use the Kelly Criterion or Fractional Kelly to determine optimal bet sizes based on win probability and odds.
- **Risk Engine**:
  - **Stop-Loss/Take-Profit**: Hardcode circuit breakers to stop the bot if it loses X% of the capital in Y time.
  - **Exposure Limits**: Monitor total exposure across multiple markets to prevent over-leveraging.
- **Bankroll Management**: Separate "Trading Capital" from "Gas Reserves" and "Accumulated Profit".

### 4. Robust Execution & Wallet Integration

- **Multi-Wallet Support**: Use `alloy-signer` to manage multiple private keys securely. Implement wallet rotation or parallel execution if needed.
- **Advanced Tx Management**:
  - Implement **Dynamic Gas Escalation** (EIP-1559) to ensure transactions get mined during high congestion.
  - **Nonce Management**: Use an in-memory nonce tracker to avoid "nonce too low" errors during rapid firing.
- **RPC Resilience**: Implement fallback providers (failover) between multiple RPC endpoints (Alchemy, Infura, QuickNode).

### 5. Bot Security & Integrity

- **Secret Management**: Never allow raw private keys in logs. Use `secrecy` crate to wrap sensitive data.
- **Simulation (Dry Run)**: Always provide a `simulate_transaction` feature using `eth_call` or `tenderly` before sending real funds.
- **Integrity Checks**: Verify contract addresses against known official Polymarket addresses to prevent "fake market" scams.

---

> **Expert Note:** "In Rust, we don't just write code; we manage hardware and capital. Every microsecond saved and every basis point of risk managed is profit in the bank."
