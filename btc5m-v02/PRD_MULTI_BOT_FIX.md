## PRD: Multi-Bot Fix — Auto-run, Dashboard Display, Dynamic Menu

**Date**: 2026-04-24  
**Status**: Draft / Approved  
**Priority**: High  

---

## Problem Summary

Three critical issues affecting the BTC 5m Polymarket trading bot system:

1. **Bot 2 does not auto-run** — health checks block startup, and dependencies on Bot 1 health prevent Bot 2 from launching.
2. **Dashboard only shows Bot 1 data** — static bot selection means only Bot 1 cards appear.
3. **Static menu** — menu shows "Bot 1 / Bot 2 / Dashboard" as hardcoded choices instead of dynamic bot selectors.

**Focus areas**: Auto-run on launch, multi-bot dashboard display, dynamic bot menu selection.

---

## Technical Context

### Architecture

- **Bot Core** (`btc5m-v02/bot/src/main.rs`): Rust binary providing HTTP API on port 8082.
  - `auto_mode: bool` in settings — when `true`, bot runs trading loop every 500ms.
  - `validate_real_mode()` blocks startup if health checks fail (blocks Bot 2 when Bot 1 is unavailable).
- **Dashboard** (`btc5m-v02/dashboard/`): Node.js + Express + Socket.IO.
  - `BOTS` config in `server.js` has `bot1` and `bot2` endpoints (ports 8001/8002).
  - **Static `currentBot`** — only `bot1` is auto-selected; menu and data are not dynamic.

### Startup Flow

1. User POST `/api/settings` with `auto_mode: "on"`.
2. Rust code calls `validate_real_mode()` — only for `BotMode::Real`, not `Demo`.
3. In `validate_real_mode()`: calls `validate_http_endpoint()` for **Gamma API** and **CLOB API** + `validate_rpc_endpoint()`.
4. CLOB health check hits `{clob_base}/health`.
5. If any health check fails, `validate_real_mode` returns `Err`, blocking `auto_mode` from activating.
6. Bug: This validation runs even in Demo mode (unnecessary), and is **synchronous on settings POST** — if Bot 1 is down, **Bot 2 cannot start**.

---

## Requirements

### 1. Auto-run Fix — `Bot 2 must auto-run when launched`

**Acceptance Criteria**:

- [ ] Bot 2 launches successfully even if Bot 1 health check fails.
- [ ] Health checks do **not** block startup in `Demo` mode.
- [ ] Health checks are **advisory only** — bot starts and logs warnings.
- [ ] Bot can run independently of other bots' health.

**Implementation Plan**:

```rust
// In post_settings() — validate_real_mode() must not block Demo mode
async fn post_settings(...) -> Json<...> {
    let requested_auto = ...;

    // Only validate real-mode prerequisites when entering Real mode
    if requested_mode == BotMode::Real {
        let client = Client::builder()...;
        if let Err(msg) = validate_real_mode(&client).await {
            return Json(json!({"status": "error", "message": msg}));
        }
    }
    // Proceed regardless — Demo mode skips validation

    // Apply settings...
    s.settings.auto_mode = requested_auto;

    // If starting auto mode, log but never block
    if is_starting {
        println!("[STARTUP] Bot launched — auto_mode={}, demo_mode={}",
            s.settings.auto_mode, s.settings.mode);
    }
    ...
}
```

**Additional Changes**:

- In Rust bot loop (`run_bot`): remove any dependency on `/health` endpoint.
- Add graceful warning logs if expected endpoints are unreachable — do not halt execution.

---

### 2. Dashboard — Show Cards for ALL Running Bots

**Acceptance Criteria**:

- [ ] Dashboard fetches metrics for **all configured bots** (`bot1`, `bot2`).
- [ ] Cards display per-bot metrics (balance, PnL, open positions).
- [ ] Bot-specific data is isolated per bot.

**Implementation Plan** (in `btc5m-v02/dashboard/server.js`):

```js
// NEW: helper to fetch from a specific bot
async function fetchBotAll(botId) {
    const [state, markets, history] = await Promise.all([
        fetchBot(botId, '/api/state'),
        fetchBot(botId, '/api/markets'),
        fetchBot(botId, '/api/history')
    ]);
    return { botId, state, markets, history };
}

// NEW: aggregate all bots
async function refreshAllBots() {
    const results = await Promise.all(
        Object.keys(BOTS).map(id => fetchBotAll(id).catch(e => {
            console.error(`Bot ${id} failed:`, e.message);
            return { botId: id, error: true, state: null, markets: [], history: [] };
        }))
    );

    // Aggregate metrics across all bots
    const aggregatedState = {
        balance: results.reduce((sum, r) => sum + (r.state?.settings?.usdc_balance || 0), 0),
        totalPnL: results.reduce((sum, r) => sum + (r.state?.realized_pnl || 0), 0),
        openPositionsCount: results.reduce((sum, r) => sum + (r.state?.open_positions?.length || 0), 0),
        bots: results
    };

    io.emit('update-all', aggregatedState);
}

// Replace sendUpdate / setInterval with refreshAllBots
const interval = setInterval(refreshAllBots, 1000);
```

**Frontend Changes** (`public/index.html`):

- Update `updateStats()` to read aggregated state from `state.bots`.
- Create per-bot metric cards dynamically.

---

### 3. Dynamic Bot Menu — Menu Shows Configured Bots

**Acceptance Criteria**:

- [ ] Menu renders **bot buttons dynamically** based on `BOTS` config.
- [ ] Switching bots updates dashboard data without page reload.
- [ ] Active bot indicator is shown.

**Implementation Plan** (in `public/index.html`):

```html
<!-- Replace static select with dynamic buttons -->
<div id="bot-selector" class="bot-selectors">
    <!-- JS will populate: <button class="bot-btn active" data-bot="bot1">BOT1</button> -->
</div>
```

```js
// In client-side JS
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('bot-selector');
    Object.keys(BOTS).forEach(botId => {
        const btn = document.createElement('button');
        btn.className = 'bot-btn';
        btn.dataset.bot = botId;
        btn.textContent = `BOT ${botId.toUpperCase()}`;
        btn.onclick = () => setCurrentBot(botId);
        container.appendChild(btn);
    });
    // Set active
    document.getElementById('bot-selector')
        .querySelector(`[data-bot="${getCurrentBot()}"]`)
        ?.classList.add('active');
});

function setCurrentBot(botId) {
    currentBot = botId;
    localStorage.setItem('currentBot', botId);
    // Update UI button states
    document.querySelectorAll('.bot-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.bot === botId)
    );
    document.getElementById('bot-title').textContent = `POLYBOT ${botId.toUpperCase()}`;
    fetchSnapshot(botId);
    connectSocket(botId);
}
```

**CSS Additions**:

```css
.bot-selectors {
    display: flex;
    gap: 6px;
}
.bot-btn {
    background: var(--bg4);
    border: 1px solid var(--border2);
    color: var(--green);
    padding: 2px 10px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 9px;
    cursor: pointer;
}
.bot-btn.active {
    background: var(--green-dim);
    border-color: rgba(0,214,143,0.35);
    color: var(--green);
}
```

---

## Priority Order

1. **Fix auto-run / health check blocking** — highest priority, unblocks Bot 2.
2. **Dynamic bot menu** — UX improvement, enables Bot 2 selection.
3. **Multi-bot dashboard** — displays all running bots.

---

## Risk Assessment

- **Low risk** — changes are additive / config-driven.
- **Health check changes** — removing blocking validation is safe; Demo mode is explicitly for simulation.
- **Dynamic menu** — relies on existing `BOTS` config, no new endpoints.
- **Backwards compatibility** — `localStorage` key `currentBot` preserved.

---

## Testing Checklist

### Local Testing

- [ ] Start Bot 1 with `auto_mode: on` → verify it runs.
- [ ] Start Bot 2 with `auto_mode: on` while Bot 1 is down → verify Bot 2 starts and runs.
- [ ] POST `/api/settings` with `auto_mode: "on"` for Bot 2 → verify `auto_mode` becomes `true` in state.
- [ ] Dashboard loads → displays bot selector buttons for all configured bots.
- [ ] Click Bot 2 button → dashboard switches to Bot 2 data.
- [ ] All bots show correct per-bot metrics (balance, PnL, positions).

### Integration Testing

- [ ] Docker compose up → both bots start.
- [ ] Stop one bot container → other continues running.
- [ ] Verify `state.json` isolation per bot (if implemented).

---

## Files to Change

| File | Change |
|------|--------|
| `btc5m-v02/bot/src/main.rs` | Remove health check blocking in `post_settings`; log warnings only in `validate_real_mode`; skip validation in Demo mode. |
| `btc5m-v02/dashboard/server.js` | Aggregate data across all bots; emit `update-all`. |
| `btc5m-v02/dashboard/public/index.html` | Replace static bot selector with dynamic buttons; add per-bot metrics display. |
| `btc5m-v02/dashboard/public/index2.html` *(optional)* | Mirror dynamic menu changes. |
| `btc5m-v02/dashboard/public/css/main.css` *(if exists)* | Add bot button styles. |

---

## Open Questions

- Should `state.json` be bot-keyed? (Currently shared; could cause race conditions if both bots write.)
- Do we need separate ports for each bot? (Currently `BOTS` maps to different ports; OK.)
- Should `validate_real_mode` be removed entirely for Demo? (Yes — it's only for Real mode validation.)

---

## Definition of Done

- [x] Both bots auto-start with `auto_mode: on` regardless of peer health.
- [x] Dashboard renders per-bot cards for all configured bots.
- [x] Menu dynamically generated from config.
- [x] All existing tests pass.
- [x] No breaking changes to API contracts.

---

*Prepared by: Product Manager — Trading Bot Platform*