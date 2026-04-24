# BTC Every 5 Minutes Bot - v01 Plan

## Overview
Single bot simulation for trading BTC Up/Down 5-minute markets on Polymarket.

---

## API Endpoints

### Public APIs (No Auth Required)

| # | Endpoint | URL | Purpose |
|---|----------|-----|---------|
| 1 | List Markets | `GET https://gamma-api.polymarket.com/markets?slug=btc-updown-5m&closed=false` | Find active BTC 5m markets |
| 2 | Get Market by ID | `GET https://gamma-api.polymarket.com/markets/{id}` | Get market details (token IDs, question) |
| 3 | Get Order Book | `GET https://clob.polymarket.com/book?token_id={token_id}` | Get bids/asks for a token |
| 4 | Get Prices History | `GET https://clob.polymarket.com/prices-history?market={token_id}&interval=5m&fidelity=5` | Historical price data |
| 5 | Get Last Trade Price | `GET https://clob.polymarket.com/markets/{token_id}/last-trade-price` | Current price |
| 6 | Get Market Prices | `GET https://clob.polymarket.com/markets/prices?token_ids={ids}&sides=BID,ASK` | Batch prices |

### Data API (Public - User History)

| # | Endpoint | URL | Purpose |
|---|----------|-----|---------|
| 7 | Get Closed Positions | `GET https://data-api.polymarket.com/closed-positions?limit=10&sortBy=REALIZEDPNL&sortDirection=DESC&user=0x8F57631c63aB777E2f75a304c445046540453a4d` | Your trading history |
| 8 | Get Current Positions | `GET https://data-api.polymarket.com/positions?user=0x8F57631c63aB777E2f75a304c445046540453a4d` | Open positions |
| 9 | Get Trades | `GET https://data-api.polymarket.com/trades?user=0x8F57631c63aB777E2f75a304c445046540453a4d` | Trade history |
| 10 | Get User Activity | `GET https://data-api.polymarket.com/activity?user=0x8F57631c63aB777E2f75a304c445046540453a4d` | User activity |

### Authenticated APIs (L2 Required - Trading)

| # | Endpoint | URL | Purpose |
|---|----------|-----|---------|
| 11 | Post Order | `POST https://clob.polymarket.com/order` | Place buy/sell order |
| 12 | Cancel Order | `DELETE https://clob.polymarket.com/orders/{order_id}` | Cancel single order |
| 13 | Get User Orders | `GET https://clob.polymarket.com/orders` | Get open orders |
| 14 | Get Trades | `GET https://clob.polymarket.com/trades` | Get trade history |

### Auth Endpoints (L1 - Get Credentials)

| # | Endpoint | URL | Purpose |
|---|----------|-----|---------|
| 15 | Create API Key | `POST https://clob.polymarket.com/auth/api-key` | Create L2 credentials |
| 16 | Derive API Key | `GET https://clob.polymarket.com/auth/derive-api-key` | Get existing credentials |

---

## Market Structure

### BTC 5m Market Pattern
- **Slug**: `btc-updown-5m-{unix_timestamp}`
- **Question**: "Bitcoin Up or Down - January 17, 8:00PM-8:05PM ET"
- **Outcomes**: "Up" / "Down"
- **Resolution**: Chainlink BTC/USD price oracle
- **Window**: 5 minutes per market

### Token IDs
Each market has 2 tokens:
- Yes/Up token
- No/Down token

---

## Bot Workflow v01

```
1. Discovery Phase
   └─> Fetch active markets with slug pattern "btc-updown-5m"
   └─> Extract current + next market windows

2. Analysis Phase
   └─> Get orderbook for each token (Yes/Up and No/Down)
   └─> Calculate midpoint = (best_bid + best_ask) / 2
   └─> Check spread and liquidity

3. Decision Phase
   └─> If probability > threshold (e.g., 0.60) → BET YES
   └─> If probability < threshold (e.g., 0.40) → BET NO
   └─> Otherwise → SKIP

4. Execution Phase
   └─> Sign order with private key (L1)
   └─> Post order via L2 auth
   └─> Wait for fill or timeout (5 min deadline)

5. Monitoring Phase
   └─> Track order status every 10 seconds
   └─> If filled → hold until resolution
   └─> If unfilled → cancel before window closes

6. Settlement Phase
   └─> Market resolves automatically
   └─> Check if won → tokens convert to USDC
   └─> Update P&L
```

---

## Configuration

```env
# Bot Settings
BOT_MODE=simulate          # simulate | live
BET_AMOUNT=1.0            # USDC per trade
MIN_PROB_THRESHOLD=0.55  # minimum edge to bet
MAX_BET_CAP=10.0          #max bet cap

# API Credentials (L2)
POLY_API_KEY=uuid
POLY_PASSPHRASE=string
POLY_ADDRESS=0x...        # proxy wallet address

# Private Key (for signing)
PRIVATE_KEY=0x...
```

---

## Files Structure

```
src/
├── main.rs              # Entry point
├── btc5m_bot.rs         # Bot logic (NEW)
├── btc5m_client.rs      # API client wrapper (NEW)
├── poly_client.rs      # Existing Polymarket client
└── real_bot.rs        # Existing multi-bot system (DO NOT TOUCH)
```

---

## Key Data Structures

```rust
struct Btc5mMarket {
    id: String,
    question: String,
    slug: String,
    end_time: DateTime,
    yes_token_id: String,  // "Up" outcome
    no_token_id: String, // "Down" outcome
    active: bool,
}

struct OrderBook {
    token_id: String,
    bids: Vec<OrderLevel>,
    asks: Vec<OrderLevel>,
    last_trade_price: f64,
    tick_size: f64,
    min_order_size: f64,
}

struct OrderLevel {
    price: f64,
    size: f64,
}

struct ActiveTrade {
    market_id: String,
    token_id: String,
    side: String,  // "BUY" or "SELL"
    amount: f64,
    entry_price: f64,
    order_id: String,
    status: String, // "pending" | "filled" | "cancelled"
}
```

---

## Notes

- **Tick Size**: 0.01 (1 cent)
- **Min Order Size**: Usually 1 (check from orderbook)
- **Fee**: ~3% taker fee
- **Settlement**: Automatic via oracle
- **Resolution Source**: Chainlink BTC/USD

---

## References

- Docs: https://docs.polymarket.com/api-reference/introduction
- API Specs: https://docs.polymarket.com/llms.txt
- Gamma API: https://gamma-api.polymarket.com
- CLOB API: https://clob.polymarket.com
- Markets: https://polymarket.com/crypto/5M