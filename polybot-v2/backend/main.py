"""
POLYMARKET BOT v3 — BACKEND
Forward-test mode: real market timing, locked capital tracking,
salary feature (every 100x: withdraw 70%, keep 30% as new capital),
fast-resolving markets only (BTC 5m, soccer, daily crypto bets),
BTC5m special signal: deterministic slug + Binance TA predict,
no max-bet-per-day limit (only gas 50% reserve),
input modal + gas at startup via API.
"""
import asyncio, json, os, random, re, math
from datetime import datetime, timezone, date, timedelta
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

_lock = asyncio.Lock()

# ═══════════════════════════════════════════════════════════════
# BTC 5M SIGNAL ENGINE
# Slug: btc-updown-5m-{unix_ts} where ts = now - (now % 300)
# Strategy: fetch Binance 1m klines → compute momentum → predict
# Entry timing: T-30s before window close (highest accuracy zone)
# ═══════════════════════════════════════════════════════════════

BINANCE_API  = "https://api.binance.com/api/v3"
BTC5M_WINDOW = 300   # seconds per window

class BTC5mState:
    """State for the dedicated BTC 5m signal engine"""
    current_slug:   str   = ""
    current_ts:     int   = 0
    window_open_ts: int   = 0
    window_close_ts:int   = 0
    market_data:    dict  = {}   # parsed Gamma market
    signal:         dict  = {}   # latest signal
    last_predict:   int   = 0    # unix ts of last prediction
    klines:         list  = []   # last 15 x 1m candles
    btc_price:      float = 0.0
    predicted_dir:  str   = ""   # "UP" | "DOWN" | ""
    confidence:     float = 0.0
    entry_fired:    bool  = False
    wins:           int   = 0
    losses:         int   = 0
    total:          int   = 0
    last_market_refresh: int = 0

B5 = BTC5mState()

def btc5m_current_window_ts(now_ts: int = 0) -> int:
    """Return the start timestamp of the current 5m window"""
    ts = now_ts or int(datetime.now(timezone.utc).timestamp())
    return ts - (ts % BTC5M_WINDOW)

def btc5m_next_window_ts(now_ts: int = 0) -> int:
    return btc5m_current_window_ts(now_ts) + BTC5M_WINDOW

def btc5m_slug(window_ts: int) -> str:
    return f"btc-updown-5m-{window_ts}"

def btc5m_seconds_to_close(now_ts: int = 0) -> int:
    """Seconds remaining until current window closes"""
    ts  = now_ts or int(datetime.now(timezone.utc).timestamp())
    end = btc5m_current_window_ts(ts) + BTC5M_WINDOW
    return max(0, end - ts)

async def btc5m_fetch_market(slug: str, sess: aiohttp.ClientSession) -> Optional[dict]:
    """Fetch market from Gamma API by slug"""
    try:
        # Try event slug first
        async with sess.get(f"{GAMMA}/events", params={"slug": slug, "limit": 1}) as r:
            if r.status == 200:
                data = await r.json()
                events = data if isinstance(data, list) else []
                if events:
                    ev = events[0]
                    markets = ev.get("markets", [])
                    # Find the Up/Down market (binary)
                    for m in markets:
                        outcomes = m.get("outcomes", [])
                        if isinstance(outcomes, str):
                            try: outcomes = json.loads(outcomes)
                            except: outcomes = []
                        if "Up" in outcomes or "up" in str(outcomes).lower():
                            return m
                    if markets:
                        return markets[0]
        # Fallback: market slug
        async with sess.get(f"{GAMMA}/markets", params={"slug": slug, "limit": 1}) as r:
            if r.status == 200:
                data = await r.json()
                items = data if isinstance(data, list) else data.get("markets", [])
                if items:
                    return items[0]
    except Exception as e:
        pass
    return None

async def btc5m_fetch_klines(sess: aiohttp.ClientSession, limit: int = 20) -> list:
    """Fetch BTC/USDT 1m klines from Binance"""
    try:
        async with sess.get(f"{BINANCE_API}/klines", params={
            "symbol": "BTCUSDT", "interval": "1m", "limit": limit
        }) as r:
            if r.status == 200:
                data = await r.json()
                # [open_time, open, high, low, close, volume, ...]
                return [{
                    "ts":     int(k[0]) // 1000,
                    "open":   float(k[1]),
                    "high":   float(k[2]),
                    "low":    float(k[3]),
                    "close":  float(k[4]),
                    "volume": float(k[5]),
                } for k in data]
    except:
        pass
    return []

async def btc5m_fetch_price(sess: aiohttp.ClientSession) -> float:
    """Fetch current BTC price from Binance"""
    try:
        async with sess.get(f"{BINANCE_API}/ticker/price", params={"symbol":"BTCUSDT"}) as r:
            if r.status == 200:
                data = await r.json()
                return float(data.get("price", 0))
    except:
        pass
    return 0.0

def btc5m_compute_signal(klines: list, current_price: float) -> dict:
    """
    Multi-indicator momentum signal for BTC 5m direction.

    Indicators:
    1. EMA(3) vs EMA(8) crossover      → trend direction
    2. RSI(7)                           → overbought/oversold
    3. Volume spike                     → momentum confirmation
    4. Last 3 candle body direction     → short-term momentum
    5. Price position in last 5m range  → near high/low bias

    Returns: {dir: "UP"|"DOWN", confidence: 0-1, signals: {...}}
    """
    if len(klines) < 10:
        return {"dir": "", "confidence": 0, "signals": {}}

    closes  = [k["close"]  for k in klines]
    volumes = [k["volume"] for k in klines]

    # ── EMA ──────────────────────────────────────────────────
    def ema(data: list, period: int) -> list:
        k_mult = 2 / (period + 1)
        result = [data[0]]
        for p in data[1:]:
            result.append(p * k_mult + result[-1] * (1 - k_mult))
        return result

    ema3 = ema(closes, 3)
    ema8 = ema(closes, 8)
    ema_up = ema3[-1] > ema8[-1]
    ema_margin = abs(ema3[-1] - ema8[-1]) / ema8[-1]  # % separation

    # ── RSI(7) ───────────────────────────────────────────────
    gains, losses_r = [], []
    for i in range(1, min(8, len(closes))):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses_r.append(max(-diff, 0))
    avg_gain = sum(gains) / len(gains) if gains else 0
    avg_loss = sum(losses_r) / len(losses_r) if losses_r else 1e-9
    rs  = avg_gain / avg_loss if avg_loss else 999
    rsi = 100 - (100 / (1 + rs))
    rsi_bullish   = rsi < 50    # room to go up
    rsi_oversold  = rsi < 35
    rsi_overbought= rsi > 65

    # ── Volume spike ─────────────────────────────────────────
    vol_avg     = sum(volumes[-10:-1]) / 9 if len(volumes) >= 10 else sum(volumes) / len(volumes)
    vol_current = volumes[-1]
    vol_spike   = vol_current > vol_avg * 1.3

    # ── Last 3 candles direction ──────────────────────────────
    last3 = klines[-3:]
    bull_candles = sum(1 for k in last3 if k["close"] >= k["open"])
    bear_candles = len(last3) - bull_candles
    candle_bias  = "up" if bull_candles >= 2 else "down"

    # ── Price in recent range ─────────────────────────────────
    recent   = klines[-6:]
    hi5      = max(k["high"]  for k in recent)
    lo5      = min(k["low"]   for k in recent)
    rng      = hi5 - lo5 if hi5 > lo5 else 1
    pos_pct  = (current_price - lo5) / rng  # 0=bottom, 1=top
    near_top = pos_pct > 0.75
    near_bot = pos_pct < 0.25

    # ── Score ─────────────────────────────────────────────────
    up_score   = 0
    down_score = 0

    # EMA
    if ema_up:
        up_score   += 2 + (3 if ema_margin > 0.001 else 0)
    else:
        down_score += 2 + (3 if ema_margin > 0.001 else 0)

    # RSI
    if rsi_oversold:  up_score   += 3
    elif rsi_bullish: up_score   += 1
    if rsi_overbought:down_score += 3

    # Volume
    if vol_spike:
        if candle_bias == "up":   up_score   += 2
        else:                     down_score += 2

    # Candles
    if candle_bias == "up":   up_score   += 2
    else:                     down_score += 2

    # Position
    if near_bot: up_score   += 2
    if near_top: down_score += 2

    total_score = up_score + down_score
    if total_score == 0:
        return {"dir": "", "confidence": 0, "signals": {}}

    if up_score > down_score:
        direction   = "UP"
        confidence  = up_score / total_score
    else:
        direction   = "DOWN"
        confidence  = down_score / total_score

    # Only fire if confidence > 0.60
    if confidence < 0.60:
        direction   = ""
        confidence  = 0

    return {
        "dir":        direction,
        "confidence": round(confidence, 3),
        "signals": {
            "ema_up":      ema_up,
            "ema_margin":  round(ema_margin * 100, 3),
            "rsi":         round(rsi, 1),
            "vol_spike":   vol_spike,
            "candle_bias": candle_bias,
            "pos_pct":     round(pos_pct, 2),
            "up_score":    up_score,
            "down_score":  down_score,
        }
    }

def btc5m_market_to_signal(market: dict, predicted_dir: str, confidence: float) -> Optional[dict]:
    """
    Convert Gamma market data + prediction into a tradeable signal.
    predicted_dir: "UP" | "DOWN"
    Returns signal dict compatible with open_position()
    """
    outcomes = market.get("outcomes", [])
    prices   = market.get("outcomePrices", [])
    if isinstance(outcomes, str):
        try: outcomes = json.loads(outcomes)
        except: outcomes = []
    if isinstance(prices, str):
        try: prices = json.loads(prices)
        except: prices = []

    if not outcomes or not prices or len(outcomes) != len(prices):
        return None

    # Find Up/Down token
    target_outcome = None
    target_price   = None

    for i, o in enumerate(outcomes):
        o_str = str(o).lower()
        if predicted_dir == "UP"   and o_str in ("up", "yes"): target_outcome, target_price = o, float(prices[i])
        if predicted_dir == "DOWN" and o_str in ("down", "no"):target_outcome, target_price = o, float(prices[i])

    # Fallback if "Up"/"Down" not found — use Yes/No
    if target_outcome is None:
        for i, o in enumerate(outcomes):
            o_str = str(o)
            if predicted_dir == "UP"   and o_str in ("Yes","YES","yes"): target_outcome, target_price = o, float(prices[i])
            if predicted_dir == "DOWN" and o_str in ("No","NO","no"):    target_outcome, target_price = o, float(prices[i])

    if target_outcome is None or target_price is None:
        return None

    if target_price <= 0.01 or target_price >= 0.99:
        return None

    # True prob = our confidence (boosted slightly vs market price)
    true_prob = min(0.88, max(confidence, target_price + 0.05))
    ev        = ev_calc(true_prob, target_price)

    if ev < 0.02:  # low bar for BTC5m since it's a dedicated signal
        return None

    return {
        "strategy":  "btc5m",
        "outcome":   predicted_dir,
        "ev":        round(ev, 4),
        "true_prob": round(true_prob, 4),
        "price":     round(target_price, 4),
        "confidence": round(confidence, 3),
    }

async def btc5m_loop():
    """
    Dedicated BTC 5m signal loop.
    - Every 30s: refresh market data + fetch Binance price
    - At T-30s before window close: compute signal + fire entry
    - Resolve timing = exactly 5 minutes (300s)
    """
    global B5
    print("[BTC5m] Loop started")

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as sess:
        while True:
            try:
                now_ts  = int(datetime.now(timezone.utc).timestamp())
                win_ts  = btc5m_current_window_ts(now_ts)
                secs_left = btc5m_seconds_to_close(now_ts)
                slug    = btc5m_slug(win_ts)

                # ── New window → reset state ──────────────────────
                if win_ts != B5.current_ts:
                    B5.current_ts     = win_ts
                    B5.current_slug   = slug
                    B5.window_open_ts = win_ts
                    B5.window_close_ts= win_ts + BTC5M_WINDOW
                    B5.entry_fired    = False
                    B5.predicted_dir  = ""
                    B5.market_data    = {}
                    B5.signal         = {}
                    print(f"[BTC5m] New window: {slug} | closes in {secs_left}s")

                # ── Fetch Binance price every cycle ───────────────
                price = await btc5m_fetch_price(sess)
                if price: B5.btc_price = price

                # ── Fetch klines every 60s ────────────────────────
                if now_ts - B5.last_predict >= 60 or not B5.klines:
                    klines = await btc5m_fetch_klines(sess, limit=20)
                    if klines: B5.klines = klines
                    B5.last_predict = now_ts

                # ── Compute signal continuously ───────────────────
                if B5.klines and B5.btc_price:
                    sig_data = btc5m_compute_signal(B5.klines, B5.btc_price)
                    if sig_data["dir"]:
                        B5.predicted_dir = sig_data["dir"]
                        B5.confidence    = sig_data["confidence"]
                        B5.signal        = sig_data

                # ── Fetch market data (refresh every new window or 60s) ──
                if now_ts - B5.last_market_refresh >= 60 or not B5.market_data:
                    mkt = await btc5m_fetch_market(slug, sess)
                    if mkt:
                        B5.market_data = mkt
                        B5.last_market_refresh = now_ts

                # ── Entry zone: T-30s to T-10s before close ──────
                # This is the sweet spot: direction largely locked in
                in_entry_zone = 10 <= secs_left <= 35
                should_fire   = (
                    in_entry_zone
                    and not B5.entry_fired
                    and B5.predicted_dir
                    and B5.confidence >= 0.60
                    and B5.market_data
                    and not S.gas_paused
                )

                if should_fire:
                    market_sig = btc5m_market_to_signal(
                        B5.market_data, B5.predicted_dir, B5.confidence
                    )
                    if market_sig:
                        # Build market dict for open_position
                        q = B5.market_data.get("question", f"BTC 5m {B5.current_slug}")
                        mkt_dict = {
                            "id":          B5.market_data.get("id", B5.current_slug),
                            "question":    q[:80],
                            "category":    "crypto",
                            "yes_price":   market_sig["price"] if market_sig["outcome"]=="UP" else 1-market_sig["price"],
                            "no_price":    1-market_sig["price"] if market_sig["outcome"]=="UP" else market_sig["price"],
                            "volume":      float(B5.market_data.get("volume", 0) or 0),
                            "volume_24h":  float(B5.market_data.get("volume24hr", 0) or 0),
                            "end_date":    "",
                            "resolve_sec": secs_left,        # resolve when window closes
                            "resolve_fmt": f"{secs_left}s",
                            "spread":      0.0,
                            "liquidity":   0.0,
                            "_is_btc5m":   True,
                        }

                        await open_position(mkt_dict, market_sig)
                        B5.entry_fired = True
                        B5.total      += 1
                        print(f"[BTC5m] ENTRY {market_sig['outcome']} @ {market_sig['price']} conf={B5.confidence} T-{secs_left}s")

                # Broadcast BTC5m status to dashboard
                await broadcast({"type": "btc5m", "data": {
                    "slug":          B5.current_slug,
                    "window_ts":     B5.window_open_ts,
                    "window_close":  B5.window_close_ts,
                    "secs_left":     secs_left,
                    "btc_price":     round(B5.btc_price, 2),
                    "predicted_dir": B5.predicted_dir,
                    "confidence":    round(B5.confidence, 3),
                    "entry_fired":   B5.entry_fired,
                    "in_entry_zone": in_entry_zone,
                    "signal":        B5.signal.get("signals", {}),
                    "stats":         {"wins": B5.wins, "losses": B5.losses, "total": B5.total},
                }})

            except Exception as e:
                S.errors.append(f"[BTC5m] {str(e)[:80]}")

            await asyncio.sleep(10)   # poll every 10s

app = FastAPI(title="Polymarket Bot v3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── RUNTIME CONFIG (overridable via /api/setup) ────────────
class Config:
    mode             = os.getenv("BOT_MODE", "sim")
    usdc_capital     = float(os.getenv("USDC_CAPITAL", "10"))
    pol_balance      = float(os.getenv("POL_BALANCE", "11"))
    min_bet          = 1.00          # Polymarket minimum $1
    max_open_pos     = int(os.getenv("MAX_OPEN_POS", "3"))
    min_ev           = float(os.getenv("MIN_EV", "0.04"))
    daily_loss_limit = float(os.getenv("DAILY_LOSS_LIMIT", "5.0"))
    prob_min         = float(os.getenv("PROB_MIN", "0.55"))
    prob_max         = float(os.getenv("PROB_MAX", "0.88"))
    scan_sec         = int(os.getenv("SCAN_INTERVAL", "10"))
    # Compound: $10 = $2 bet
    compound_base    = 10.0
    compound_step    = 10.0
    compound_inc     = 2.0
    compound_max_bet = 50.0
    # Gas: keep 50% as reserve
    gas_reserve_pct  = 0.50
    gas_per_tx_usd   = 0.02
    pol_price_usd    = 0.40
    gas_alert_tx     = 10
    gas_stop_tx      = 2
    # Salary
    salary_threshold = 100.0   # withdraw when equity hits this
    salary_keep_pct  = 0.30    # keep 30% as new capital
    salary_withdraw_pct = 0.70 # withdraw 70%

C = Config()

GAMMA = "https://gamma-api.polymarket.com"
CLOB  = "https://clob.polymarket.com"

TAKER_FEE = {
    "crypto": 0.018, "sports": 0.0075, "politics": 0.010,
    "finance": 0.010, "economics": 0.015, "culture": 0.0125,
    "geopolitics": 0.000, "science": 0.010, "tech": 0.010,
    "weather": 0.0125, "other": 0.010,
}

# ─── FAST-RESOLVING MARKET KEYWORDS ─────────────────────────
# Only trade markets that resolve quickly (hours, not months)
FAST_KEYWORDS = [
    # Crypto price bets (hourly/daily)
    "btc", "bitcoin", "eth", "ethereum", "sol", "solana",
    "above", "below", "price", "close", "end of day",
    "today", "tonight", "this week", "by eod",
    "24h", "48h", "72h", "7 day",
    # Sports (same-day resolve)
    "soccer", "football", "nba", "nfl", "mlb", "nhl",
    "match", "game", "score", "winner", "champion",
    "goal", "points", "halftime",
    # Short-term events
    "daily", "weekly", "this month",
]

SLOW_KEYWORDS = [
    # Skip long-term markets
    "2026", "2027", "2028", "ever", "lifetime",
    "by end of year", "annual", "album", "movie",
    "will ever", "rihanna", "gta",
]

# Estimated resolve time in seconds (for sim forward-test)
# These mirror real Polymarket resolve times
RESOLVE_ESTIMATE = {
    "btc_5m":      300,          # 5 minutes
    "btc_1h":      3600,         # 1 hour
    "btc_daily":   86400,        # 1 day
    "sports":      random.randint(7200, 28800),   # 2-8 hours
    "crypto_week": 604800,        # 1 week
    "daily":       86400,
    "weekly":      604800,
}

def estimate_resolve_seconds(question: str, end_date: str) -> int:
    """Estimate real resolve time from question + end_date"""
    q = question.lower()

    # If end_date is available, use it
    if end_date:
        try:
            # Parse ISO date
            ed = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            diff = (ed - now).total_seconds()
            if diff > 0:
                return int(diff)
        except:
            pass

    # Heuristic from question text
    if any(x in q for x in ["5 min", "5m", "5-min"]):
        return 300
    if any(x in q for x in ["15 min", "15m"]):
        return 900
    if any(x in q for x in ["1 hour", "1h", "hourly"]):
        return 3600
    if any(x in q for x in ["today", "eod", "end of day", "tonight"]):
        return 86400
    if any(x in q for x in ["this week", "7 day", "weekly"]):
        return 604800
    if any(x in q for x in ["match", "game", "score", "goal"]):
        return random.randint(7200, 28800)
    if any(x in q for x in ["btc", "eth", "bitcoin", "ethereum"]):
        return random.randint(3600, 86400)

    # Default: 24 hours
    return 86400

def is_fast_market(question: str, end_date: str) -> bool:
    """Return True if market resolves within 7 days"""
    secs = estimate_resolve_seconds(question, end_date)
    return secs <= 604800  # 7 days

def is_slow_market(question: str) -> bool:
    q = question.lower()
    return any(w in q for w in SLOW_KEYWORDS)

# ─── STATE ──────────────────────────────────────────────────
class BotState:
    def __init__(self):
        self.capital         = C.usdc_capital   # available (not locked)
        self.locked_capital  = 0.0              # in open positions
        self.initial_capital = C.usdc_capital
        self.positions       = []
        self.closed_trades   = []
        self.log             = []
        self.scan_count      = 0
        self.signals_found   = 0
        self.daily_pnl       = 0.0
        self.daily_date      = date.today().isoformat()
        self.gas_used_usd    = 0.0
        self.pol_left        = C.pol_balance
        self.pos_counter     = 0
        self.running         = True
        self.gas_paused      = False
        self.ws_clients      = set()
        self.errors          = []
        self.start_time      = datetime.now(timezone.utc).isoformat()
        self.compound_tier   = 0
        self.compound_events = []
        self.market_rows     = []
        self.market_bets_today: dict[str, int] = {}
        # Salary tracking
        self.salary_events   = []
        self.total_withdrawn = 0.0
        self.salary_target   = C.salary_threshold  # next salary at
        self.lifetime_pnl    = 0.0
        # Setup done?
        self.setup_done      = True  # use defaults initially

S = BotState()

# ─── COMPOUND ───────────────────────────────────────────────
def total_equity() -> float:
    return round(S.capital + S.locked_capital, 4)

def compound_tier(capital: float) -> int:
    eq = total_equity()
    if eq < C.compound_base: return 0
    return int((eq - C.compound_base) / C.compound_step) + 1

def compound_bet(capital: float) -> float:
    t = compound_tier(capital)
    if t == 0: return C.min_bet
    return round(min(t * C.compound_inc, C.compound_max_bet), 2)

def compound_next() -> float:
    t = compound_tier(S.capital)
    return round(C.compound_base + t * C.compound_step, 2)

def compound_progress() -> float:
    t  = compound_tier(S.capital)
    eq = total_equity()
    prev = C.compound_base + (t-1)*C.compound_step if t > 0 else 0
    top  = C.compound_base + t*C.compound_step if t > 0 else C.compound_base
    span = top - prev
    if span <= 0: return 100.0
    return round(min(100.0, (eq - prev) / span * 100), 1)

def check_levelup():
    new_t = compound_tier(S.capital)
    if new_t > S.compound_tier:
        old_bet = compound_bet(S.capital)
        S.compound_tier = new_t
        new_bet = compound_bet(S.capital)
        ev = {"time": now_str(), "old_tier": new_t-1, "new_tier": new_t,
              "new_bet": new_bet, "capital": round(total_equity(), 4),
              "next": compound_next()}
        S.compound_events.append(ev)
        add_log("COMPOUND_UP", {"tier": new_t, "new_bet": new_bet,
            "capital": round(total_equity(),4), "next": compound_next()})
        return True
    return False

# ─── SALARY ENGINE ──────────────────────────────────────────
def check_salary():
    """
    Every time equity crosses salary_target (100, 200, 300...):
    - Withdraw 70%
    - Keep 30% as new trading capital
    - Reset compound tier relative to new capital
    """
    eq = total_equity()
    if eq < S.salary_target:
        return False

    withdrawn  = round(eq * C.salary_withdraw_pct, 4)
    keep       = round(eq * C.salary_keep_pct, 4)

    ev = {
        "time":        now_str(),
        "equity":      round(eq, 4),
        "withdrawn":   withdrawn,
        "kept":        keep,
        "target":      S.salary_target,
        "next_target": S.salary_target + C.salary_threshold,
    }
    S.salary_events.append(ev)
    S.total_withdrawn = round(S.total_withdrawn + withdrawn, 4)

    # Reset capital
    S.capital        = keep
    S.locked_capital = 0.0   # existing positions still exist but capital resets
    S.compound_tier  = 0     # reset tier relative to new capital

    # Next salary target
    S.salary_target += C.salary_threshold

    add_log("SALARY", {
        "equity": round(eq, 4), "withdrawn": withdrawn,
        "kept": keep, "next_target": S.salary_target,
        "total_withdrawn": S.total_withdrawn,
        "message": f"Gajian! Tarik ${withdrawn:.2f}, lanjut modal ${keep:.2f}",
    })
    return True

# ─── GAS ENGINE ─────────────────────────────────────────────
def gas_usable_pol() -> float:
    """50% of remaining POL is reserved, only other 50% usable"""
    return max(0, S.pol_left * (1 - C.gas_reserve_pct))

def gas_tx_remaining() -> int:
    cost_pol = C.gas_per_tx_usd / C.pol_price_usd
    if cost_pol <= 0: return 9999
    return int(gas_usable_pol() / cost_pol)

def gas_status() -> str:
    tx = gas_tx_remaining()
    if tx <= C.gas_stop_tx:  return "critical"
    if tx <= C.gas_alert_tx: return "low"
    return "ok"

def consume_gas():
    cost_pol = C.gas_per_tx_usd / C.pol_price_usd
    S.pol_left     = round(max(0, S.pol_left - cost_pol), 4)
    S.gas_used_usd = round(S.gas_used_usd + C.gas_per_tx_usd, 4)
    status  = gas_status()
    tx_left = gas_tx_remaining()
    if status == "critical" and not S.gas_paused:
        S.gas_paused = True
        add_log("GAS_STOP", {"tx_left": tx_left, "pol_left": S.pol_left,
            "message": f"Auto-stop: {tx_left} tx tersisa. Top-up POL."})
    elif status == "low":
        add_log("GAS_WARN", {"tx_left": tx_left, "pol_left": round(S.pol_left,3),
            "message": f"Gas menipis: {tx_left} tx tersisa"})

# ─── EV ENGINE ──────────────────────────────────────────────
def ev_calc(true_prob: float, price: float) -> float:
    return (true_prob * (1 - price)) - ((1 - true_prob) * price)

def kelly_fraction(true_prob: float, price: float) -> float:
    if price <= 0 or price >= 1: return 0
    b = (1 - price) / price
    k = (b * true_prob - (1 - true_prob)) / b
    return max(0, min(k / 2, 0.20))  # half-kelly, max 20%

def calc_size(true_prob: float, price: float) -> float:
    """
    No daily max-bet limit. Only limit:
    - compound max bet
    - 50% of available capital per bet (protect gas reserve logic)
    - minimum $1.00 (Polymarket floor)
    """
    max_bet  = compound_bet(S.capital)
    k        = kelly_fraction(true_prob, price)
    eq       = total_equity()
    raw      = eq * k
    # Cap at 50% of available capital (leave room for other bets)
    cap_half = S.capital * 0.50
    return round(max(C.min_bet, min(raw, max_bet, cap_half)), 2)

# ─── HELPERS ────────────────────────────────────────────────
def now_str(): return datetime.now().strftime("%H:%M:%S")

def add_log(event: str, data: dict):
    entry = {"time": now_str(), "event": event, **data}
    S.log.insert(0, entry)
    if len(S.log) > 500: S.log.pop()
    return entry

async def broadcast(msg: dict):
    dead = set()
    txt = json.dumps(msg, default=str)
    for ws in S.ws_clients:
        try: await ws.send_text(txt)
        except: dead.add(ws)
    S.ws_clients -= dead

def daily_reset():
    today = date.today().isoformat()
    if S.daily_date != today:
        S.daily_date = today
        S.daily_pnl  = 0.0
        S.market_bets_today.clear()
        add_log("DAILY_RESET", {"date": today})

# ─── MARKET SCANNER — FAST MARKETS ONLY ─────────────────────
async def fetch_fast_markets() -> list:
    """
    Fetch markets from Gamma API.
    Prioritize fast-resolving: BTC 5m price bets, sports same-day, daily crypto.
    Skip markets with end_date > 7 days from now.
    """
    try:
        cutoff = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        results = []

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as sess:
            # Fetch with different sort orders to get diverse mix
            for params in [
                {"active":"true","closed":"false","limit":100,"order":"volume24hr","ascending":"false"},
                {"active":"true","closed":"false","limit":50,"order":"endDate","ascending":"true"},
            ]:
                try:
                    async with sess.get(f"{GAMMA}/markets", params=params) as r:
                        if r.status == 200:
                            data = await r.json()
                            items = data if isinstance(data, list) else data.get("markets", [])
                            results.extend(items)
                except: pass

        # Deduplicate by id
        seen = set()
        unique = []
        for m in results:
            mid = m.get("id","")
            if mid and mid not in seen:
                seen.add(mid)
                unique.append(m)

        # Filter: fast-resolving only, skip slow keywords
        fast = []
        for m in unique:
            q  = m.get("question","")
            ed = m.get("endDate","")
            if is_slow_market(q): continue
            secs = estimate_resolve_seconds(q, ed)
            if secs > 604800: continue  # skip > 7 days
            m["_resolve_sec"] = secs
            # Categorize
            ql = q.lower()
            if any(x in ql for x in ["btc","bitcoin","eth","ethereum","sol","crypto","price"]):
                m["_cat"] = "crypto"
            elif any(x in ql for x in ["soccer","football","nba","nfl","mlb","nhl","match","game","score","goal"]):
                m["_cat"] = "sports"
            elif any(x in ql for x in ["fed","rate","inflation","cpi"]):
                m["_cat"] = "economics"
            else:
                m["_cat"] = "other"
            fast.append(m)

        # Sort by resolve time ascending (fastest first)
        fast.sort(key=lambda m: m.get("_resolve_sec", 999999))
        return fast[:80]

    except Exception as e:
        S.errors.append(f"Gamma: {str(e)[:60]}")
        return []

def parse_market(m: dict) -> Optional[dict]:
    yes_p, no_p = None, None

    # New API: outcomePrices
    outcomes = m.get("outcomes", [])
    prices   = m.get("outcomePrices", [])
    if isinstance(outcomes, str):
        try: outcomes = json.loads(outcomes)
        except: outcomes = []
    if isinstance(prices, str):
        try: prices = json.loads(prices)
        except: prices = []
    if outcomes and prices and len(outcomes) == len(prices):
        try:
            yi = list(outcomes).index("Yes")
            ni = list(outcomes).index("No")
            yes_p = float(prices[yi])
            no_p  = float(prices[ni])
        except: pass

    # Fallback: tokens
    if yes_p is None:
        tokens = m.get("tokens", [])
        yt = next((t for t in tokens if t.get("outcome")=="Yes"), None)
        nt = next((t for t in tokens if t.get("outcome")=="No"),  None)
        if yt and nt:
            try: yes_p, no_p = float(yt.get("price",0)), float(nt.get("price",0))
            except: return None

    if not yes_p or not no_p or yes_p <= 0 or no_p <= 0: return None

    vol  = float(m.get("volume",0) or 0)
    vol24= float(m.get("volume24hr",0) or 0)
    q    = m.get("question","")[:90]
    ed   = m.get("endDate","")
    res  = m.get("_resolve_sec", estimate_resolve_seconds(q, ed))

    return {
        "id":          m.get("id",""),
        "question":    q,
        "category":    (m.get("category") or m.get("_cat","other")).lower(),
        "yes_price":   round(yes_p, 4),
        "no_price":    round(no_p,  4),
        "volume":      round(vol, 2),
        "volume_24h":  round(vol24, 2),
        "end_date":    ed,
        "resolve_sec": res,   # estimated seconds until resolve
        "spread":      round(abs(1 - yes_p - no_p), 4),
        "liquidity":   float(m.get("liquidity",0) or 0),
    }

def detect_signal(m: dict) -> Optional[dict]:
    yes_p = m["yes_price"]
    no_p  = m["no_price"]
    vol   = m.get("volume_24h", m["volume"])

    # Only trade with decent liquidity
    if vol < 500: return None

    # 1. Complement Arb
    if yes_p + no_p < 0.985:
        profit = round(1 - yes_p - no_p, 4)
        if profit >= 0.005:
            return {"strategy":"arb","outcome":"YES+NO",
                    "ev":profit,"true_prob":0.99,"price":yes_p}

    # 2. No-bias (YES overpriced 75-92%)
    if 0.75 <= yes_p <= 0.92:
        tp = min(no_p + 0.12, PROB_MAX_HARD := 0.85)
        if C.prob_min <= tp <= tp:
            e = ev_calc(tp, no_p)
            if e >= C.min_ev:
                return {"strategy":"no_bias","outcome":"NO",
                        "ev":round(e,4),"true_prob":tp,"price":no_p}

    # 3. High-prob YES
    if C.prob_min <= yes_p <= C.prob_max:
        tp = min(yes_p + 0.06, 0.92)
        e  = ev_calc(tp, yes_p)
        if e >= C.min_ev:
            return {"strategy":"high_prob","outcome":"YES",
                    "ev":round(e,4),"true_prob":tp,"price":yes_p}

    return None

def build_market_rows(parsed: list) -> list:
    rows = []
    for p in parsed:
        if not p: continue
        sig = detect_signal(p)
        # Format resolve time nicely
        rs = p.get("resolve_sec", 0)
        if rs < 3600:
            rt = f"{int(rs//60)}m"
        elif rs < 86400:
            rt = f"{rs/3600:.1f}h"
        else:
            rt = f"{rs/86400:.1f}d"
        rows.append({**p,
            "signal":      sig["strategy"] if sig else "—",
            "ev":          round(sig["ev"],4) if sig else 0,
            "true_prob":   round(sig["true_prob"],4) if sig else 0,
            "outcome":     sig["outcome"] if sig else "—",
            "fee":         TAKER_FEE.get(p["category"],0.01),
            "resolve_fmt": rt,
        })
    # Sort: signals first, then by resolve time
    rows.sort(key=lambda r: (r["signal"]=="—", r.get("resolve_sec",999999)))
    return rows

# ─── RISK GATE ───────────────────────────────────────────────
def risk_ok(market_id: str, sig: dict) -> tuple[bool, str]:
    if S.gas_paused:
        return False, f"Gas stop: {gas_tx_remaining()} tx tersisa"
    if S.daily_pnl <= -C.daily_loss_limit:
        return False, f"Daily loss limit ${C.daily_loss_limit}"
    open_pos = [p for p in S.positions if p["status"]=="open"]
    if len(open_pos) >= C.max_open_pos:
        return False, f"Max {C.max_open_pos} posisi"
    if any(p["market_id"]==market_id for p in open_pos):
        return False, "Sudah ada posisi di market ini"
    if sig["ev"] < C.min_ev:
        return False, f"EV {sig['ev']:.3f} terlalu kecil"
    if sig["strategy"] != "arb" and not (C.prob_min <= sig["true_prob"] <= C.prob_max):
        return False, f"Prob {sig['true_prob']:.2f} di luar range"
    if S.capital < C.min_bet:
        return False, f"Capital ${S.capital:.2f} < min bet ${C.min_bet}"
    return True, "OK"

# ─── POSITION LIFECYCLE ─────────────────────────────────────
async def open_position(market: dict, sig: dict):
    async with _lock:
        ok, reason = risk_ok(market["id"], sig)
        if not ok:
            # Suppress spam rejections
            if S.log and S.log[0].get("reason") == reason: return
            add_log("REJECTED", {"reason": reason, "question": market["question"][:50]})
            return

        size = calc_size(sig["true_prob"], sig["price"])
        size = min(size, S.capital)
        if size < C.min_bet: return

        # Deduct from available capital
        S.capital        = round(S.capital - size, 4)
        S.locked_capital = round(S.locked_capital + size, 4)
        S.pos_counter   += 1
        S.market_bets_today[market["id"]] = S.market_bets_today.get(market["id"],0)+1

        # Real resolve time from market data
        resolve_sec = market.get("resolve_sec", 86400)

        pos = {
            "id":            f"{'SIM' if C.mode=='sim' else 'REAL'}-{S.pos_counter:04d}",
            "market_id":     market["id"],
            "question":      market["question"],
            "category":      market["category"],
            "outcome":       sig["outcome"],
            "price":         sig["price"],
            "true_prob":     sig["true_prob"],
            "size":          size,
            "shares":        round(size/sig["price"],4) if sig["price"]>0 else 0,
            "ev":            sig["ev"],
            "strategy":      sig["strategy"],
            "status":        "open",
            "opened_at":     datetime.now(timezone.utc).isoformat(),
            "resolve_sec":   resolve_sec,
            "resolve_fmt":   market.get("resolve_fmt","?"),
            "end_date":      market.get("end_date",""),
            "compound_tier": compound_tier(S.capital),
            "compound_bet":  compound_bet(S.capital),
        }
        S.positions.append(pos)
        consume_gas()

        entry = add_log("OPEN", {
            "id": pos["id"], "question": pos["question"][:60],
            "outcome": pos["outcome"], "price": pos["price"],
            "size": pos["size"], "ev": pos["ev"],
            "strategy": pos["strategy"], "category": pos["category"],
            "resolve_fmt": pos["resolve_fmt"],
            "compound_tier": pos["compound_tier"],
        })

    await broadcast({"type":"log",       "data":entry})
    await broadcast({"type":"positions", "data":open_positions()})
    await broadcast({"type":"stats",     "data":get_stats()})

async def close_position(pos: dict, won: bool):
    async with _lock:
        if pos["status"] != "open": return

        size  = pos["size"]
        price = pos["price"]

        if won:
            # Full payout = stake / price
            payout = round(size / price, 4)
            pnl    = round(payout - size, 4)
            S.capital        = round(S.capital + payout, 4)
            S.locked_capital = round(S.locked_capital - size, 4)
        else:
            payout = 0.0
            pnl    = round(-size, 4)
            S.locked_capital = round(S.locked_capital - size, 4)
            # capital stays reduced (deducted on open)

        pos["status"]     = "won" if won else "lost"
        pos["pnl"]        = pnl
        pos["payout"]     = payout
        pos["exit_price"] = 1.0 if won else 0.0
        pos["closed_at"]  = datetime.now(timezone.utc).isoformat()

        S.daily_pnl    = round(S.daily_pnl + pnl, 4)
        S.lifetime_pnl = round(S.lifetime_pnl + pnl, 4)

        # Track BTC5m accuracy separately
        if pos.get("strategy") == "btc5m":
            if won: B5.wins  += 1
            else:   B5.losses += 1

        S.positions.remove(pos)
        S.closed_trades.append(pos)

        leveled  = check_levelup()
        salaried = check_salary()

        entry = add_log("CLOSE", {
            "id": pos["id"], "result": pos["status"],
            "pnl": pnl, "question": pos["question"][:55],
            "capital": round(total_equity(),4),
            "strategy": pos.get("strategy",""),
        })

    await broadcast({"type":"log",       "data":entry})
    if leveled:
        await broadcast({"type":"compound_up","data":S.compound_events[-1]})
        await broadcast({"type":"log","data":S.log[0]})
    if salaried:
        await broadcast({"type":"salary","data":S.salary_events[-1]})
        await broadcast({"type":"log","data":S.log[0]})
    await broadcast({"type":"positions","data":open_positions()})
    await broadcast({"type":"stats",    "data":get_stats()})

# ─── BACKGROUND TASKS ───────────────────────────────────────
async def scanner_loop():
    cycle     = 0
    last_raw  = []
    last_fetch= 0

    while True:
        try:
            daily_reset()
            cycle += 1
            S.scan_count += 1
            now_ts = datetime.now(timezone.utc).timestamp()

            # Fetch real markets every 30 seconds (rate-limit friendly)
            if now_ts - last_fetch >= 30 or not last_raw:
                raw = await fetch_fast_markets()
                if raw:
                    last_raw  = raw
                    last_fetch = now_ts

            # Apply small price noise between fetches (sim only)
            if C.mode == "sim" and last_raw:
                for m in last_raw:
                    prices = m.get("outcomePrices","[]")
                    if isinstance(prices, str):
                        try:
                            pl = json.loads(prices)
                            pl = [str(round(min(0.99,max(0.01,float(p)+random.uniform(-0.008,0.008))),4)) for p in pl]
                            m["outcomePrices"] = json.dumps(pl)
                        except: pass

            parsed        = [parse_market(m) for m in last_raw]
            parsed        = [m for m in parsed if m]
            S.market_rows = build_market_rows(parsed)
            S.signals_found += sum(1 for r in S.market_rows if r["signal"]!="—")

            # Act on signals
            if not S.gas_paused:
                acted = 0
                for row in S.market_rows:
                    if row["signal"] == "—": continue
                    if acted >= 2: break   # max 2 new positions per scan cycle
                    if random.random() < 0.20:
                        sig = {
                            "strategy":  row["signal"],
                            "outcome":   row["outcome"],
                            "ev":        row["ev"],
                            "true_prob": row["true_prob"],
                            "price":     row["yes_price"] if row["outcome"] in ("YES","YES+NO") else row["no_price"],
                        }
                        await open_position(row, sig)
                        acted += 1

            await broadcast({"type":"stats",   "data":get_stats()})
            await broadcast({"type":"markets", "data":S.market_rows[:100]})
            await broadcast({"type":"gas",     "data":get_gas_info()})

        except Exception as e:
            S.errors.append(f"{now_str()} {str(e)[:80]}")

        await asyncio.sleep(C.scan_sec)

async def resolver_loop():
    """
    Sim forward-test: resolve positions based on their REAL estimated resolve time.
    This makes sim behave like real — a 5m BTC bet resolves in 5 minutes,
    a soccer match resolves in 4-8 hours, etc.
    """
    while True:
        now_utc = datetime.now(timezone.utc)
        to_resolve = []

        for pos in list(S.positions):
            if pos["status"] != "open": continue
            opened  = datetime.fromisoformat(pos["opened_at"])
            elapsed = (now_utc - opened).total_seconds()
            resolve = pos.get("resolve_sec", 86400)

            if elapsed >= resolve:
                to_resolve.append(pos)

        for pos in to_resolve:
            # Realistic win probability with slight house edge
            true_prob = pos.get("true_prob", 0.65)
            won = random.random() < (true_prob * 0.93)
            await close_position(pos, won)

        await asyncio.sleep(10)  # check every 10s

# ─── DATA HELPERS ────────────────────────────────────────────
def open_positions(): return [p for p in S.positions if p["status"]=="open"]

def get_gas_info() -> dict:
    tx = gas_tx_remaining()
    pol_used = C.pol_balance - S.pol_left
    pct_used = round(pol_used / C.pol_balance * 100, 1) if C.pol_balance else 0
    return {
        "pol_total":    C.pol_balance,
        "pol_left":     round(S.pol_left, 4),
        "pol_used":     round(pol_used, 4),
        "pol_reserved": round(S.pol_left * C.gas_reserve_pct, 4),
        "pol_usable":   round(gas_usable_pol(), 4),
        "gas_usd":      round(S.gas_used_usd, 4),
        "tx_left":      tx,
        "pct_used":     pct_used,
        "status":       gas_status(),
        "paused":       S.gas_paused,
        "alert_tx":     C.gas_alert_tx,
        "stop_tx":      C.gas_stop_tx,
        "reserve_pct":  C.gas_reserve_pct,
    }

def get_salary_info() -> dict:
    eq = total_equity()
    to_next = max(0, round(S.salary_target - eq, 4))
    progress = round(min(100, eq / S.salary_target * 100), 1) if S.salary_target else 0
    # What withdrawal would look like right now
    projected_withdraw = round(eq * C.salary_withdraw_pct, 4)
    projected_keep     = round(eq * C.salary_keep_pct, 4)
    return {
        "threshold":           C.salary_threshold,
        "next_target":         S.salary_target,
        "current_equity":      round(eq, 4),
        "to_next":             to_next,
        "progress_pct":        progress,
        "withdraw_pct":        C.salary_withdraw_pct,
        "keep_pct":            C.salary_keep_pct,
        "total_withdrawn":     round(S.total_withdrawn, 4),
        "salary_count":        len(S.salary_events),
        "events":              S.salary_events[-5:],
        "projected_withdraw":  projected_withdraw,
        "projected_keep":      projected_keep,
    }

def get_stats() -> dict:
    total = len(S.closed_trades)
    wins  = sum(1 for t in S.closed_trades if t["status"]=="won")
    eq    = total_equity()
    pnl   = round(eq - S.initial_capital, 4)
    t     = compound_tier(S.capital)
    return {
        "mode":              C.mode.upper(),
        "capital":           round(eq, 4),
        "available":         round(S.capital, 4),
        "locked":            round(S.locked_capital, 4),
        "initial":           S.initial_capital,
        "pnl":               pnl,
        "roi_pct":           round(pnl / S.initial_capital * 100, 2) if S.initial_capital else 0,
        "lifetime_pnl":      round(S.lifetime_pnl, 4),
        "total_withdrawn":   round(S.total_withdrawn, 4),
        "total_trades":      total,
        "wins":              wins,
        "losses":            total - wins,
        "win_rate":          round(wins/total*100,1) if total else 0,
        "open_count":        len(open_positions()),
        "daily_pnl":         round(S.daily_pnl, 4),
        "daily_loss_limit":  C.daily_loss_limit,
        "daily_stopped":     S.daily_pnl <= -C.daily_loss_limit,
        "scan_count":        S.scan_count,
        "signals_found":     S.signals_found,
        "start_time":        S.start_time,
        "errors":            S.errors[-3:],
        "gas":               get_gas_info(),
        "salary":            get_salary_info(),
        "compound_tier":     t,
        "compound_bet":      compound_bet(S.capital),
        "compound_next":     compound_next(),
        "compound_prog":     compound_progress(),
        "compound_events":   S.compound_events[-5:],
    }

def get_config() -> dict:
    return {
        "mode": C.mode, "usdc_capital": C.usdc_capital,
        "pol_balance": C.pol_balance,
        "min_bet": C.min_bet, "max_open": C.max_open_pos,
        "min_ev": C.min_ev, "daily_loss": C.daily_loss_limit,
        "prob_min": C.prob_min, "prob_max": C.prob_max,
        "scan_sec": C.scan_sec,
        "compound_base": C.compound_base, "compound_step": C.compound_step,
        "compound_inc": C.compound_inc, "compound_max_bet": C.compound_max_bet,
        "gas_reserve_pct": C.gas_reserve_pct,
        "gas_alert_tx": C.gas_alert_tx, "gas_stop_tx": C.gas_stop_tx,
        "salary_threshold": C.salary_threshold,
        "salary_keep_pct": C.salary_keep_pct,
        "salary_withdraw_pct": C.salary_withdraw_pct,
        "taker_fees": TAKER_FEE,
        "fast_market_max_days": 7,
        "min_bet_note": "Polymarket minimum order = $1.00",
        "real_wallet_note": "Polymarket butuh EVM wallet (MetaMask), bukan Phantom (Solana)",
    }

# ═══════════════════════════════════════════════════════════════
# HEALTH CHECK SYSTEM
# Comprehensive health monitoring for all services
# ═══════════════════════════════════════════════════════════════
# import httpx  # Using aiohttp instead

# Track last successful API hits
_last_binance_check = 0
_last_polymarket_check = 0
_last_trade_timestamp = None
_binance_status = "unknown"
_polymarket_status = "unknown"

async def check_binance_connectivity() -> dict:
    """Check Binance API connectivity"""
    global _last_binance_check, _binance_status
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as sess:
            async with sess.get(f"{BINANCE_API}/ticker/price", params={"symbol":"BTCUSDT"}) as r:
                if r.status == 200:
                    _binance_status = "ok"
                    _last_binance_check = int(datetime.now(timezone.utc).timestamp())
                    return {"status": "ok", "latency_ms": r.content_time * 1000}
        _binance_status = "error"
    except Exception as e:
        _binance_status = "error"
        return {"status": "error", "error": str(e)[:50]}
    return {"status": "error", "error": "unknown"}

async def check_polymarket_connectivity() -> dict:
    """Check Polymarket API connectivity"""
    global _last_polymarket_check, _polymarket_status
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as sess:
            async with sess.get(f"{GAMMA}/markets", params={"active":"true","limit":1}) as r:
                if r.status == 200:
                    _polymarket_status = "ok"
                    _last_polymarket_check = int(datetime.now(timezone.utc).timestamp())
                    return {"status": "ok", "latency_ms": r.content_time * 1000}
    except Exception as e:
        _polymarket_status = "error"
    return {"status": "error", "error": str(e)[:50]}

def get_health_indicator(last_hit_ts: int) -> str:
    """Get health indicator based on last successful hit"""
    now = int(datetime.now(timezone.utc).timestamp())
    diff = now - last_hit_ts
    if diff < 30: return "green"
    if diff < 60: return "yellow"
    return "red"

@app.get("/api/health")
async def api_health():
    """
    Comprehensive health check endpoint
    Returns: Binance, Polymarket, bot status, database status, last trade
    """
    global _last_trade_timestamp
    
    now = int(datetime.now(timezone.utc).timestamp())
    
    # Run async checks
    binance = await check_binance_connectivity()
    polymarket = await check_polymarket_connectivity()
    
    # Get last trade timestamp
    last_trade = None
    if S.closed_trades:
        last_closed = S.closed_trades[-1].get("closed_at") or S.closed_trades[-1].get("opened_at")
        if last_closed:
            _last_trade_timestamp = int(datetime.fromisoformat(last_closed).timestamp())
    
    return {
        "status": "healthy" if binance["status"] == "ok" and polymarket["status"] == "ok" else "degraded",
        "timestamp": now,
        "mode": C.mode,
        "services": {
            "binance": {
                "status": _binance_status,
                "indicator": get_health_indicator(_last_binance_check),
                "last_hit": _last_binance_check,
                "seconds_ago": now - _last_binance_check if _last_binance_check else 999,
                "latency_ms": binance.get("latency_ms"),
            },
            "polymarket": {
                "status": _polymarket_status,
                "indicator": get_health_indicator(_last_polymarket_check),
                "last_hit": _last_polymarket_check,
                "seconds_ago": now - _last_polymarket_check if _last_polymarket_check else 999,
                "latency_ms": polymarket.get("latency_ms"),
            },
            "database": {
                "status": "ok",  # SQLite always accessible in this setup
                "indicator": "green",
            },
            "bot": {
                "status": "running" if S.running else "stopped",
                "indicator": "green" if S.running else "red",
                "gas_paused": S.gas_paused,
            },
        },
        "last_trade": {
            "timestamp": _last_trade_timestamp,
            "seconds_ago": now - _last_trade_timestamp if _last_trade_timestamp else None,
        },
        "stats": {
            "total_trades": len(S.closed_trades),
            "open_positions": len(S.positions),
            "capital": round(total_equity(), 2),
            "daily_pnl": round(S.daily_pnl, 2),
        }
    }

@app.get("/api/health/binance")
async def api_health_binance():
    """Specific Binance health status"""
    binance = await check_binance_connectivity()
    return {
        "service": "binance",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        **binance,
        "indicator": get_health_indicator(_last_binance_check),
        "last_hit": _last_binance_check,
        "seconds_ago": int(datetime.now(timezone.utc).timestamp()) - _last_binance_check if _last_binance_check else 999,
    }

@app.get("/api/health/polymarket")
async def api_health_polymarket():
    """Specific Polymarket health status"""
    polymarket = await check_polymarket_connectivity()
    return {
        "service": "polymarket",
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        **polymarket,
        "indicator": get_health_indicator(_last_polymarket_check),
        "last_hit": _last_polymarket_check,
        "seconds_ago": int(datetime.now(timezone.utc).timestamp()) - _last_polymarket_check if _last_polymarket_check else 999,
    }

@app.get("/api/health/bot")
def api_health_bot():
    """Specific bot health status"""
    return {
        "bot_id": os.getenv("BOT_NAME", "bot1"),
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
        "status": "running" if S.running else "stopped",
        "indicator": "green" if S.running else "red",
        "mode": C.mode,
        "capital": round(total_equity(), 2),
        "available": round(S.capital, 2),
        "locked": round(S.locked_capital, 2),
        "open_positions": len(S.positions),
        "gas_paused": S.gas_paused,
        "gas_status": gas_status(),
        "daily_pnl": round(S.daily_pnl, 2),
        "daily_stopped": S.daily_pnl <= -C.daily_loss_limit,
        "start_time": S.start_time,
        "uptime_seconds": int(datetime.now(timezone.utc).timestamp()) - int(datetime.fromisoformat(S.start_time).timestamp()),
    }

# ═══════════════════════════════════════════════════════════════
# API ROUTES ───────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════

@app.get("/health")
def health(): return {"status":"ok","mode":C.mode}

@app.post("/api/setup")
async def api_setup(body: dict):
    """
    Input modal awal + gas sebelum forward test.
    POST {"usdc": 10, "pol": 11, "mode": "sim"}
    """
    global S
    usdc = float(body.get("usdc", C.usdc_capital))
    pol  = float(body.get("pol",  C.pol_balance))
    mode = str(body.get("mode",   C.mode))

    C.usdc_capital = usdc
    C.pol_balance  = pol
    C.mode         = mode

    # Reinitialize state
    S = BotState()
    S.capital         = usdc
    S.initial_capital = usdc
    S.pol_left        = pol
    S.salary_target   = C.salary_threshold

    await broadcast({"type":"setup","data":{"usdc":usdc,"pol":pol,"mode":mode}})
    await broadcast({"type":"stats","data":get_stats()})
    return {"ok": True, "capital": usdc, "pol": pol, "mode": mode}

@app.get("/api/stats")
def api_stats(): return get_stats()

@app.get("/api/positions")
def api_positions(): return open_positions()

@app.get("/api/history")
def api_history(limit:int=200): return S.closed_trades[-limit:][::-1]

@app.get("/api/markets")
def api_markets(): return S.market_rows[:100]

@app.get("/api/log")
def api_log(limit:int=200): return S.log[:limit]

@app.get("/api/gas")
def api_gas(): return get_gas_info()

@app.get("/api/salary")
def api_salary(): return get_salary_info()

@app.get("/api/config")
def api_config(): return get_config()

@app.get("/api/compound")
def api_compound():
    tiers = []
    for i in range(0,15):
        cs = 0 if i==0 else C.compound_base+(i-1)*C.compound_step
        ce = C.compound_base if i==0 else C.compound_base+i*C.compound_step
        mb = C.min_bet if i==0 else round(i*C.compound_inc, 2)
        tiers.append({"tier":i,"cap_from":cs,"cap_to":ce,"max_bet":mb,
                       "active":compound_tier(S.capital)==i})
    return {"current_tier":compound_tier(S.capital),"current_bet":compound_bet(S.capital),
            "capital":round(total_equity(),4),"tiers":tiers,"events":S.compound_events,
            "salary_events":S.salary_events}

@app.post("/api/gas/resume")
async def api_gas_resume():
    S.gas_paused = False
    add_log("GAS_RESUME",{"message":"Bot aktif kembali setelah top-up POL."})
    await broadcast({"type":"stats","data":get_stats()})
    return {"ok":True}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    S.ws_clients.add(ws)
    try:
        await ws.send_text(json.dumps({"type":"init","data":{
            "stats":     get_stats(),
            "positions": open_positions(),
            "log":       S.log[:80],
            "config":    get_config(),
            "markets":   S.market_rows[:100],
            "gas":       get_gas_info(),
            "salary":    get_salary_info(),
            "history":   S.closed_trades[-30:][::-1],
            "btc5m":     api_btc5m(),
        }}, default=str))
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally: S.ws_clients.discard(ws)

@app.get("/api/btc5m")
def api_btc5m():
    """Real-time BTC 5m signal status"""
    now_ts    = int(datetime.now(timezone.utc).timestamp())
    secs_left = btc5m_seconds_to_close(now_ts)
    return {
        "slug":          B5.current_slug,
        "window_ts":     B5.window_open_ts,
        "window_close":  B5.window_close_ts,
        "secs_left":     secs_left,
        "btc_price":     round(B5.btc_price, 2),
        "predicted_dir": B5.predicted_dir,
        "confidence":    round(B5.confidence, 3),
        "entry_fired":   B5.entry_fired,
        "in_entry_zone": 10 <= secs_left <= 35,
        "signal_detail": B5.signal,
        "stats":         {"wins": B5.wins, "losses": B5.losses, "total": B5.total},
        "klines_count":  len(B5.klines),
        "market_found":  bool(B5.market_data),
    }

@app.on_event("startup")
async def startup():
    asyncio.create_task(scanner_loop())
    asyncio.create_task(resolver_loop())
    asyncio.create_task(btc5m_loop())     # ← dedicated BTC 5m engine
    print(f"[Bot v3] Mode={C.mode} Capital=${C.usdc_capital} POL={C.pol_balance}")
    print(f"[Bot v3] Salary every ${C.salary_threshold}: keep {int(C.salary_keep_pct*100)}% withdraw {int(C.salary_withdraw_pct*100)}%")
    print(f"[Bot v3] Fast markets only (max 7 days resolve)")
    print(f"[Bot v3] Gas reserve: {int(C.gas_reserve_pct*100)}% of POL")
    print(f"[Bot v3] BTC5m engine: slug=btc-updown-5m-{{ts}}, entry T-30s to T-10s")
