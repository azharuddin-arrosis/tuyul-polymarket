"""
POLYMARKET BOT v3 — BACKEND
Forward-test mode: real market timing, locked capital tracking,
salary feature (every 100x: withdraw 70%, keep 30% as new capital),
fast-resolving markets only (BTC 5m, soccer, daily crypto bets),
no max-bet-per-day limit (only gas 50% reserve),
input modal + gas at startup via API.
"""
import asyncio, json, os, random, re
from datetime import datetime, timezone, date, timedelta
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

_lock = asyncio.Lock()

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
    # Compound
    compound_base    = 20.0
    compound_step    = 20.0
    compound_inc     = 1.0
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

# ─── API ROUTES ──────────────────────────────────────────────
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
        }}, default=str))
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally: S.ws_clients.discard(ws)

@app.on_event("startup")
async def startup():
    asyncio.create_task(scanner_loop())
    asyncio.create_task(resolver_loop())   # always run resolver (handles real timing in sim)
    print(f"[Bot v3] Mode={C.mode} Capital=${C.usdc_capital} POL={C.pol_balance}")
    print(f"[Bot v3] Salary every ${C.salary_threshold}: keep {int(C.salary_keep_pct*100)}% withdraw {int(C.salary_withdraw_pct*100)}%")
    print(f"[Bot v3] Fast markets only (max 7 days resolve)")
    print(f"[Bot v3] Gas reserve: {int(C.gas_reserve_pct*100)}% of POL")
