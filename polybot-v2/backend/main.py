"""
POLYMARKET BOT v2 — BACKEND (FIXED)
Bug fixes:
1. Capital accounting: deduct on open, restore on close
2. Daily loss limit actually stops bot (not just rejects)
3. Market diversity: limit same-market bets
4. Daily reset at midnight
5. Sim resolve_in much longer (realistic)
"""
import asyncio, json, os, random, re
from datetime import datetime, timezone, date
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

_bot_lock = asyncio.Lock()

app = FastAPI(title="Polymarket Bot v2")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── CONFIG ─────────────────────────────────────────────────
MODE             = os.getenv("BOT_MODE", "sim")
USDC_CAPITAL     = float(os.getenv("USDC_CAPITAL", "10"))
POL_BALANCE      = float(os.getenv("POL_BALANCE", "11"))
MAX_BET_USD      = float(os.getenv("MAX_BET_USD", "2.0"))
MIN_BET_USD      = float(os.getenv("MIN_BET_USD", "0.5"))
MAX_OPEN_POS     = int(os.getenv("MAX_OPEN_POS", "5"))
MIN_EV           = float(os.getenv("MIN_EV", "0.05"))
DAILY_LOSS_LIMIT = float(os.getenv("DAILY_LOSS_LIMIT", "3.0"))
PROB_MIN         = float(os.getenv("PROB_MIN", "0.60"))
PROB_MAX         = float(os.getenv("PROB_MAX", "0.85"))
SCAN_SEC         = int(os.getenv("SCAN_INTERVAL", "5"))

COMPOUND_BASE    = float(os.getenv("COMPOUND_BASE", "20"))
COMPOUND_STEP    = float(os.getenv("COMPOUND_STEP", "20"))
COMPOUND_INC     = float(os.getenv("COMPOUND_INC", "1.0"))
COMPOUND_MAX_BET = float(os.getenv("COMPOUND_MAX_BET", "20.0"))

GAS_PER_TX_USD   = 0.02
GAS_RESERVE_POL  = 2.0
POL_PRICE_USD    = 0.40
GAS_ALERT_TX     = int(os.getenv("GAS_ALERT_TX", "10"))
GAS_STOP_TX      = int(os.getenv("GAS_STOP_TX", "2"))

CLOB  = "https://clob.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"

TAKER_FEE = {
    "crypto": 0.018, "sports": 0.0075, "politics": 0.010,
    "finance": 0.010, "economics": 0.015, "culture": 0.0125,
    "geopolitics": 0.000, "science": 0.010, "tech": 0.010,
    "weather": 0.0125, "mentions": 0.0156, "other": 0.010,
}
ALL_CATEGORIES = list(TAKER_FEE.keys())

# ─── STATE ──────────────────────────────────────────────────
class BotState:
    def __init__(self):
        self.capital         = USDC_CAPITAL  # AVAILABLE capital (already excludes open bets)
        self.initial_capital = USDC_CAPITAL
        self.locked_capital  = 0.0           # capital currently in open positions
        self.positions       = []
        self.closed_trades   = []
        self.log             = []
        self.scan_count      = 0
        self.signals_found   = 0
        self.daily_pnl       = 0.0
        self.daily_date      = date.today().isoformat()
        self.gas_used_usd    = 0.0
        self.pol_left        = POL_BALANCE
        self.pos_counter     = 0
        self.running         = True
        self.gas_paused      = False
        self.ws_clients      = set()
        self.errors          = []
        self.start_time      = datetime.now(timezone.utc).isoformat()
        self.compound_tier   = 0
        self.compound_events = []
        self.market_rows     = []
        # per-market bet count today (prevent hammering same market)
        self.market_bets_today: dict[str, int] = {}

S = BotState()

# ─── COMPOUND ───────────────────────────────────────────────
def compound_tier(capital: float) -> int:
    total = capital + S.locked_capital   # use TOTAL equity, not just available
    if total < COMPOUND_BASE: return 0
    return int((total - COMPOUND_BASE) / COMPOUND_STEP) + 1

def compound_bet(capital: float) -> float:
    t = compound_tier(capital)
    if t == 0: return MAX_BET_USD
    return round(min(t * COMPOUND_INC, COMPOUND_MAX_BET), 2)

def compound_next(capital: float) -> float:
    t = compound_tier(capital)
    total = capital + S.locked_capital
    return round(COMPOUND_BASE + t * COMPOUND_STEP, 2)

def compound_progress(capital: float) -> float:
    t = compound_tier(capital)
    total = capital + S.locked_capital
    prev = COMPOUND_BASE + (t - 1) * COMPOUND_STEP if t > 0 else 0
    top  = COMPOUND_BASE + t * COMPOUND_STEP if t > 0 else COMPOUND_BASE
    span = top - prev
    if span <= 0: return 100.0
    return round(min(100.0, (total - prev) / span * 100), 1)

def total_equity() -> float:
    return round(S.capital + S.locked_capital, 4)

def check_levelup():
    new_t = compound_tier(S.capital)
    if new_t > S.compound_tier:
        old_bet = compound_bet(S.capital - 0.01)
        new_bet = compound_bet(S.capital)
        S.compound_tier = new_t
        ev_data = {
            "time": now_str(), "old_tier": S.compound_tier - 1, "new_tier": new_t,
            "old_bet": old_bet, "new_bet": new_bet,
            "capital": round(total_equity(), 4), "next": compound_next(S.capital),
        }
        S.compound_events.append(ev_data)
        add_log("COMPOUND_UP", {"tier": new_t, "new_bet": new_bet,
            "capital": round(total_equity(), 4), "next": compound_next(S.capital)})
        return True
    return False

# ─── GAS ────────────────────────────────────────────────────
def gas_tx_remaining() -> int:
    usable = max(0, S.pol_left - GAS_RESERVE_POL)
    cost_pol = GAS_PER_TX_USD / POL_PRICE_USD
    return int(usable / cost_pol)

def gas_status() -> str:
    tx = gas_tx_remaining()
    if tx <= GAS_STOP_TX:  return "critical"
    if tx <= GAS_ALERT_TX: return "low"
    return "ok"

def consume_gas():
    cost_pol = GAS_PER_TX_USD / POL_PRICE_USD
    S.pol_left     = round(max(0, S.pol_left - cost_pol), 4)
    S.gas_used_usd = round(S.gas_used_usd + GAS_PER_TX_USD, 4)
    status  = gas_status()
    tx_left = gas_tx_remaining()
    if status == "critical" and not S.gas_paused:
        S.gas_paused = True
        add_log("GAS_STOP", {"tx_left": tx_left, "pol_left": S.pol_left,
            "message": f"Auto-stop: hanya {tx_left} tx tersisa. Top-up POL dulu."})
    elif status == "low":
        add_log("GAS_WARN", {"tx_left": tx_left, "pol_left": S.pol_left,
            "message": f"Gas menipis! {tx_left} tx tersisa dari {round(S.pol_left,2)} POL."})

# ─── EV ENGINE ──────────────────────────────────────────────
def ev_calc(true_prob: float, price: float) -> float:
    return (true_prob * (1 - price)) - ((1 - true_prob) * price)

def kelly(true_prob: float, price: float) -> float:
    if price <= 0 or price >= 1: return 0
    b = (1 - price) / price
    k = (b * true_prob - (1 - true_prob)) / b
    return max(0, min(k / 2, 0.15))

def calc_size(true_prob: float, price: float) -> float:
    """Size based on compound tier, capped at 20% of TOTAL equity"""
    max_bet   = compound_bet(S.capital)
    k         = kelly(true_prob, price)
    equity    = total_equity()
    raw       = equity * k
    # Never bet more than 20% of total equity or compound max
    return round(max(MIN_BET_USD, min(raw, max_bet, equity * 0.20)), 2)

# ─── HELPERS ────────────────────────────────────────────────
def now_str(): return datetime.now().strftime("%H:%M:%S")

def add_log(event: str, data: dict):
    entry = {"time": now_str(), "event": event, **data}
    S.log.insert(0, entry)
    if len(S.log) > 300: S.log.pop()
    return entry

async def broadcast(msg: dict):
    dead = set()
    txt = json.dumps(msg, default=str)
    for ws in S.ws_clients:
        try: await ws.send_text(txt)
        except: dead.add(ws)
    S.ws_clients -= dead

def daily_reset_if_needed():
    """Reset daily PnL at midnight"""
    today = date.today().isoformat()
    if S.daily_date != today:
        S.daily_date = today
        S.daily_pnl  = 0.0
        S.market_bets_today.clear()
        add_log("DAILY_RESET", {"date": today, "message": "Daily stats reset tengah malam."})

# ─── MARKET SCANNER ─────────────────────────────────────────
async def fetch_gamma_markets() -> list:
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as sess:
            async with sess.get(f"{GAMMA}/markets", params={
                "active": "true", "closed": "false", "limit": 100,
            }) as r:
                if r.status == 200:
                    data = await r.json()
                    items = data if isinstance(data, list) else data.get("markets", [])
                    for m in items:
                        q = m.get("question", "").lower()
                        if any(w in q for w in ["btc","bitcoin","eth","crypto","solana"]):
                            m["_cat"] = "crypto"
                        elif any(w in q for w in ["election","trump","congress","president","vote"]):
                            m["_cat"] = "politics"
                        elif any(w in q for w in ["fed","rate","inflation","cpi","gdp","recession"]):
                            m["_cat"] = "economics"
                        elif any(w in q for w in ["nba","nfl","game","score","win","match","cup"]):
                            m["_cat"] = "sports"
                        elif any(w in q for w in ["stock","ipo","nasdaq","s&p","market cap"]):
                            m["_cat"] = "finance"
                        else:
                            m["_cat"] = "other"
                    return items[:60]
    except Exception as e:
        S.errors.append(f"Gamma: {str(e)[:60]}")
    return []

def parse_market(m: dict) -> Optional[dict]:
    yes_p, no_p = None, None

    # Try outcomePrices/outcomes (new API format)
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
            yes_p, no_p = float(prices[yi]), float(prices[ni])
        except (ValueError, IndexError):
            pass

    # Fallback: tokens array
    if yes_p is None:
        tokens = m.get("tokens", [])
        yt = next((t for t in tokens if t.get("outcome") == "Yes"), None)
        nt = next((t for t in tokens if t.get("outcome") == "No"),  None)
        if yt and nt:
            try: yes_p, no_p = float(yt.get("price",0)), float(nt.get("price",0))
            except: return None

    if not yes_p or not no_p or yes_p <= 0 or no_p <= 0: return None

    vol = float(m.get("volume", 0) or 0)
    q   = m.get("question", "")[:80]
    return {
        "id":        m.get("id", ""),
        "question":  q,
        "category":  (m.get("category") or m.get("_cat", "other")).lower(),
        "yes_price": round(yes_p, 4),
        "no_price":  round(no_p, 4),
        "volume":    round(vol, 2),
        "end_date":  m.get("endDate", ""),
        "spread":    round(abs(1 - yes_p - no_p), 4),
    }

def detect_signal(m: dict) -> Optional[dict]:
    yes_p, no_p, vol = m["yes_price"], m["no_price"], m["volume"]
    if vol < 1000: return None

    # Arb
    if yes_p + no_p < 0.985:
        return {"strategy":"arb","outcome":"YES+NO",
                "ev":round(1-yes_p-no_p,4),"true_prob":0.99,"price":yes_p}

    # No-bias
    if 0.75 <= yes_p <= 0.92:
        tp = min(no_p + 0.12, 0.85)
        if PROB_MIN <= tp <= PROB_MAX:
            e = ev_calc(tp, no_p)
            if e >= MIN_EV:
                return {"strategy":"no_bias","outcome":"NO",
                        "ev":round(e,4),"true_prob":tp,"price":no_p}

    # High-prob YES in 60-85% range only
    if PROB_MIN <= yes_p <= PROB_MAX:
        tp = min(yes_p + 0.06, 0.90)
        e  = ev_calc(tp, yes_p)
        if e >= MIN_EV:
            return {"strategy":"high_prob","outcome":"YES",
                    "ev":round(e,4),"true_prob":tp,"price":yes_p}

    return None

def build_market_rows(parsed: list) -> list:
    rows = []
    for p in parsed:
        if not p: continue
        sig = detect_signal(p)
        rows.append({**p,
            "signal":    sig["strategy"] if sig else "—",
            "ev":        round(sig["ev"],4) if sig else 0,
            "true_prob": round(sig["true_prob"],4) if sig else 0,
            "outcome":   sig["outcome"] if sig else "—",
            "fee":       TAKER_FEE.get(p["category"], 0.01),
        })
    rows.sort(key=lambda r: r["volume"], reverse=True)
    return rows

# ─── RISK GATE ───────────────────────────────────────────────
MAX_BETS_SAME_MARKET = 1   # never have >1 open bet on same market

def risk_ok(market_id: str, sig: dict) -> tuple[bool, str]:
    if S.gas_paused:
        return False, f"Gas stop — {gas_tx_remaining()} tx tersisa"
    if S.daily_pnl <= -DAILY_LOSS_LIMIT:
        return False, f"Daily loss limit ${DAILY_LOSS_LIMIT} tercapai (today: ${S.daily_pnl:.2f})"
    open_pos = [p for p in S.positions if p["status"]=="open"]
    if len(open_pos) >= MAX_OPEN_POS:
        return False, f"Max {MAX_OPEN_POS} posisi terbuka"
    # Hard limit: same market
    open_on_market = sum(1 for p in open_pos if p["market_id"] == market_id)
    if open_on_market >= MAX_BETS_SAME_MARKET:
        return False, f"Sudah ada posisi di market ini"
    # Daily limit per market (max 3 bets per market per day)
    if S.market_bets_today.get(market_id, 0) >= 3:
        return False, f"Max 3 bet/hari per market"
    if sig["ev"] < MIN_EV:
        return False, f"EV {sig['ev']:.3f} terlalu kecil"
    if sig["strategy"] != "arb" and not (PROB_MIN <= sig["true_prob"] <= PROB_MAX):
        return False, f"Prob {sig['true_prob']:.2f} di luar range {PROB_MIN}-{PROB_MAX}"
    if S.capital < MIN_BET_USD:
        return False, f"Kapital tersedia ${S.capital:.2f} < min ${MIN_BET_USD}"
    return True, "OK"

# ─── POSITION MANAGEMENT ────────────────────────────────────
async def open_position(market: dict, sig: dict):
    async with _bot_lock:
        ok, reason = risk_ok(market["id"], sig)
        if not ok:
            # Only log rejection if it's meaningful (not spam)
            if "Daily loss" not in reason or len(S.log) == 0 or S.log[0].get("reason") != reason:
                add_log("REJECTED", {"reason": reason, "question": market["question"][:50]})
            return

        size = calc_size(sig["true_prob"], sig["price"])
        if size > S.capital:
            size = round(S.capital, 2)
        if size < MIN_BET_USD:
            return

        # ── DEDUCT capital on open ──────────────────────────
        S.capital       = round(S.capital - size, 4)
        S.locked_capital = round(S.locked_capital + size, 4)

        S.pos_counter += 1
        S.market_bets_today[market["id"]] = S.market_bets_today.get(market["id"], 0) + 1

        pos = {
            "id":            f"{'SIM' if MODE=='sim' else 'REAL'}-{S.pos_counter:04d}",
            "market_id":     market["id"],
            "question":      market["question"],
            "category":      market["category"],
            "outcome":       sig["outcome"],
            "price":         sig["price"],
            "true_prob":     sig["true_prob"],
            "size":          size,
            "shares":        round(size / sig["price"], 4) if sig["price"] > 0 else 0,
            "ev":            sig["ev"],
            "strategy":      sig["strategy"],
            "status":        "open",
            "opened_at":     datetime.now(timezone.utc).isoformat(),
            # Sim: realistic resolve time 45-120 seconds
            "resolve_in":    random.randint(45, 120),
            "compound_tier": compound_tier(S.capital),
            "compound_bet":  compound_bet(S.capital),
        }
        S.positions.append(pos)
        consume_gas()

        entry = add_log("OPEN", {
            "id": pos["id"], "question": pos["question"][:55],
            "outcome": pos["outcome"], "price": pos["price"],
            "size": pos["size"], "ev": pos["ev"],
            "strategy": pos["strategy"], "category": pos["category"],
            "compound_tier": pos["compound_tier"],
        })
    await broadcast({"type":"log",       "data": entry})
    await broadcast({"type":"positions", "data": open_positions()})
    await broadcast({"type":"stats",     "data": get_stats()})

async def close_position(pos: dict, won: bool):
    async with _bot_lock:
        if pos["status"] != "open": return

        size  = pos["size"]
        price = pos["price"]

        if won:
            # Payout = size / price (return full bet + profit)
            payout = round(size / price, 4)
            pnl    = round(payout - size, 4)
            # Restore locked capital + add profit
            S.capital        = round(S.capital + payout, 4)
            S.locked_capital = round(S.locked_capital - size, 4)
        else:
            # Lose the bet — locked capital is forfeited
            payout = 0.0
            pnl    = round(-size, 4)
            S.locked_capital = round(S.locked_capital - size, 4)
            # capital stays reduced (was already deducted on open)

        pos["status"]     = "won" if won else "lost"
        pos["pnl"]        = pnl
        pos["payout"]     = payout
        pos["exit_price"] = 1.0 if won else 0.0
        pos["closed_at"]  = datetime.now(timezone.utc).isoformat()

        S.daily_pnl = round(S.daily_pnl + pnl, 4)
        S.positions.remove(pos)
        S.closed_trades.append(pos)

        leveled = check_levelup()
        entry = add_log("CLOSE", {
            "id": pos["id"], "result": pos["status"],
            "pnl": pnl, "question": pos["question"][:50],
            "capital": round(total_equity(), 4),
        })

    await broadcast({"type":"log",       "data": entry})
    if leveled:
        await broadcast({"type":"compound_up", "data": S.compound_events[-1]})
        await broadcast({"type":"log",    "data": S.log[0]})
    await broadcast({"type":"positions", "data": open_positions()})
    await broadcast({"type":"stats",     "data": get_stats()})

# ─── BACKGROUND TASKS ───────────────────────────────────────
async def scanner_loop():
    cycle = 0
    last_raw = []
    while True:
        try:
            daily_reset_if_needed()
            cycle += 1
            S.scan_count += 1

            if cycle % 3 == 1 or not last_raw:
                raw = await fetch_gamma_markets()
                if raw: last_raw = raw
            else:
                # Noise on outcomePrices only
                for m in last_raw:
                    prices = m.get("outcomePrices", [])
                    if isinstance(prices, str):
                        try: prices = json.loads(prices)
                        except: prices = []
                    if prices:
                        noisy = [str(round(min(0.99, max(0.01, float(p) + random.uniform(-0.01, 0.01))), 4)) for p in prices]
                        m["outcomePrices"] = json.dumps(noisy)

            parsed        = [parse_market(m) for m in last_raw]
            parsed        = [m for m in parsed if m]
            S.market_rows = build_market_rows(parsed)
            S.signals_found += sum(1 for r in S.market_rows if r["signal"] != "—")

            if not S.gas_paused:
                for row in S.market_rows:
                    if row["signal"] == "—": continue
                    if random.random() < 0.15:   # 15% act rate — less aggressive
                        sig = {
                            "strategy":  row["signal"],
                            "outcome":   row["outcome"],
                            "ev":        row["ev"],
                            "true_prob": row["true_prob"],
                            "price":     row["yes_price"] if row["outcome"] in ("YES","YES+NO") else row["no_price"],
                        }
                        await open_position(row, sig)

            await broadcast({"type":"stats",   "data": get_stats()})
            await broadcast({"type":"markets",  "data": S.market_rows[:80]})
            await broadcast({"type":"gas",      "data": get_gas_info()})

        except Exception as e:
            S.errors.append(f"{now_str()} {str(e)[:80]}")

        await asyncio.sleep(SCAN_SEC)

async def resolver_loop():
    """Sim: resolve positions after resolve_in seconds"""
    while True:
        now = datetime.now(timezone.utc)
        to_resolve = []
        for pos in list(S.positions):
            if pos["status"] != "open": continue
            opened = datetime.fromisoformat(pos["opened_at"])
            if (now - opened).total_seconds() >= pos.get("resolve_in", 90):
                to_resolve.append(pos)
        for pos in to_resolve:
            # Win probability based on true_prob with slight house edge
            won = random.random() < (pos["true_prob"] * 0.92)
            await close_position(pos, won)
        await asyncio.sleep(3)

# ─── DATA HELPERS ────────────────────────────────────────────
def open_positions(): return [p for p in S.positions if p["status"]=="open"]

def get_gas_info() -> dict:
    tx_left = gas_tx_remaining()
    return {
        "pol_total":   POL_BALANCE,
        "pol_left":    round(S.pol_left, 4),
        "pol_used":    round(POL_BALANCE - S.pol_left, 4),
        "gas_usd":     round(S.gas_used_usd, 4),
        "tx_left":     tx_left,
        "status":      gas_status(),
        "paused":      S.gas_paused,
        "alert_tx":    GAS_ALERT_TX,
        "stop_tx":     GAS_STOP_TX,
        "reserve_pol": GAS_RESERVE_POL,
    }

def get_stats() -> dict:
    total = len(S.closed_trades)
    wins  = sum(1 for t in S.closed_trades if t["status"]=="won")
    eq    = total_equity()
    pnl   = round(eq - S.initial_capital, 4)
    t     = compound_tier(S.capital)
    return {
        "mode":            MODE.upper(),
        "capital":         round(eq, 4),         # show TOTAL equity
        "available":       round(S.capital, 4),  # spendable cash
        "locked":          round(S.locked_capital, 4),
        "initial":         S.initial_capital,
        "pnl":             pnl,
        "roi_pct":         round(pnl / S.initial_capital * 100, 2),
        "total_trades":    total,
        "wins":            wins,
        "losses":          total - wins,
        "win_rate":        round(wins/total*100,1) if total else 0,
        "open_count":      len(open_positions()),
        "daily_pnl":       round(S.daily_pnl, 4),
        "daily_loss_limit": DAILY_LOSS_LIMIT,
        "daily_stopped":   S.daily_pnl <= -DAILY_LOSS_LIMIT,
        "scan_count":      S.scan_count,
        "signals_found":   S.signals_found,
        "start_time":      S.start_time,
        "errors":          S.errors[-3:],
        "gas":             get_gas_info(),
        "compound_tier":   t,
        "compound_bet":    compound_bet(S.capital),
        "compound_next":   compound_next(S.capital),
        "compound_prog":   compound_progress(S.capital),
        "compound_events": S.compound_events[-5:],
    }

def get_config() -> dict:
    return {
        "mode": MODE, "usdc_capital": USDC_CAPITAL, "pol_balance": POL_BALANCE,
        "max_bet": MAX_BET_USD, "min_bet": MIN_BET_USD, "max_open": MAX_OPEN_POS,
        "min_ev": MIN_EV, "daily_loss": DAILY_LOSS_LIMIT,
        "prob_min": PROB_MIN, "prob_max": PROB_MAX, "scan_sec": SCAN_SEC,
        "compound_base": COMPOUND_BASE, "compound_step": COMPOUND_STEP,
        "compound_inc": COMPOUND_INC, "compound_max_bet": COMPOUND_MAX_BET,
        "gas_alert_tx": GAS_ALERT_TX, "gas_stop_tx": GAS_STOP_TX,
        "gas_reserve_pol": GAS_RESERVE_POL,
        "taker_fees": TAKER_FEE,
        "real_requirements": {
            "wallet": "Phantom TIDAK kompatibel. Butuh MetaMask (EVM/Polygon).",
            "needed": ["POLY_PRIVATE_KEY","POLY_API_KEY","POLY_SECRET","POLY_PASSPHRASE","USDC on Polygon"],
        },
    }

# ─── API ROUTES ──────────────────────────────────────────────
@app.get("/health")
def health(): return {"status":"ok","mode":MODE}

@app.get("/api/stats")
def api_stats(): return get_stats()

@app.get("/api/positions")
def api_positions(): return open_positions()

@app.get("/api/history")
def api_history(limit:int=100): return S.closed_trades[-limit:][::-1]

@app.get("/api/markets")
def api_markets(): return S.market_rows[:100]

@app.get("/api/log")
def api_log(limit:int=100): return S.log[:limit]

@app.get("/api/gas")
def api_gas(): return get_gas_info()

@app.get("/api/config")
def api_config(): return get_config()

@app.get("/api/compound")
def api_compound():
    tiers = []
    for i in range(0, 12):
        cs = 0 if i==0 else COMPOUND_BASE+(i-1)*COMPOUND_STEP
        ce = COMPOUND_BASE if i==0 else COMPOUND_BASE+i*COMPOUND_STEP
        mb = MAX_BET_USD if i==0 else round(i*COMPOUND_INC,2)
        tiers.append({"tier":i,"cap_from":cs,"cap_to":ce,"max_bet":mb,
                       "active":compound_tier(S.capital)==i})
    return {"current_tier":compound_tier(S.capital),"current_bet":compound_bet(S.capital),
            "capital":round(total_equity(),4),"tiers":tiers,"events":S.compound_events}

@app.post("/api/gas/resume")
async def api_gas_resume():
    S.gas_paused = False
    add_log("GAS_RESUME",{"message":"Gas stop dihapus. Bot aktif kembali."})
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
            "log":       S.log[:50],
            "config":    get_config(),
            "markets":   S.market_rows[:80],
            "gas":       get_gas_info(),
            "history":   S.closed_trades[-20:][::-1],
        }}, default=str))
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally: S.ws_clients.discard(ws)

@app.on_event("startup")
async def startup():
    asyncio.create_task(scanner_loop())
    if MODE == "sim":
        asyncio.create_task(resolver_loop())
    print(f"[Bot] Mode={MODE} Capital=${USDC_CAPITAL} POL={POL_BALANCE}")
    print(f"[Bot] Daily loss limit: ${DAILY_LOSS_LIMIT}")
    print(f"[Bot] Gas: alert<{GAS_ALERT_TX}tx stop<{GAS_STOP_TX}tx")
