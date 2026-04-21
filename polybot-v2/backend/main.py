"""
POLYMARKET BOT v2 — BACKEND
FastAPI + WebSocket real-time
Gas alert + auto-stop + compound engine
"""
import asyncio, json, os, random, math, re
from datetime import datetime, timezone
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Polymarket Bot v2")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── ENV CONFIG ─────────────────────────────────────────────
MODE              = os.getenv("BOT_MODE", "sim")
USDC_CAPITAL      = float(os.getenv("USDC_CAPITAL", "10"))
POL_BALANCE       = float(os.getenv("POL_BALANCE", "11"))
MAX_BET_USD       = float(os.getenv("MAX_BET_USD", "2.0"))
MIN_BET_USD       = float(os.getenv("MIN_BET_USD", "0.5"))
MAX_OPEN_POS      = int(os.getenv("MAX_OPEN_POS", "5"))
MIN_EV            = float(os.getenv("MIN_EV", "0.05"))
DAILY_LOSS_LIMIT  = float(os.getenv("DAILY_LOSS_LIMIT", "3.0"))
PROB_MIN          = float(os.getenv("PROB_MIN", "0.60"))
PROB_MAX          = float(os.getenv("PROB_MAX", "0.85"))
SCAN_SEC          = int(os.getenv("SCAN_INTERVAL", "5"))

# Compound
COMPOUND_BASE     = float(os.getenv("COMPOUND_BASE", "20"))
COMPOUND_STEP     = float(os.getenv("COMPOUND_STEP", "20"))
COMPOUND_INC      = float(os.getenv("COMPOUND_INC", "1.0"))
COMPOUND_MAX_BET  = float(os.getenv("COMPOUND_MAX_BET", "20.0"))

# Gas
GAS_PER_TX_USD    = 0.02          # est. per tx
GAS_RESERVE_POL   = 2.0           # always keep this reserved
POL_PRICE_USD     = 0.40          # approx
GAS_ALERT_TX      = 10            # alert when < 10 tx left
GAS_STOP_TX       = 2             # auto-stop when < 2 tx left (2 bets worth)

# API
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
        self.capital         = USDC_CAPITAL
        self.initial_capital = USDC_CAPITAL
        self.positions       = []          # open
        self.closed_trades   = []          # all closed
        self.log             = []          # activity
        self.scan_count      = 0
        self.signals_found   = 0
        self.daily_pnl       = 0.0
        self.gas_used_usd    = 0.0
        self.pol_left        = POL_BALANCE
        self.pos_counter     = 0
        self.running         = True
        self.gas_paused      = False       # auto-stop flag
        self.ws_clients      = set()
        self.errors          = []
        self.start_time      = datetime.now(timezone.utc).isoformat()
        # compound
        self.compound_tier   = 0
        self.compound_events = []
        # market snapshot (all categories)
        self.market_rows     = []          # for Excel table

S = BotState()

# ─── COMPOUND ENGINE ────────────────────────────────────────
def compound_tier(capital: float) -> int:
    if capital < COMPOUND_BASE: return 0
    return int((capital - COMPOUND_BASE) / COMPOUND_STEP) + 1

def compound_bet(capital: float) -> float:
    if capital < COMPOUND_BASE: return MAX_BET_USD
    t = compound_tier(capital)
    return round(min(t * COMPOUND_INC, COMPOUND_MAX_BET), 2)

def compound_next(capital: float) -> float:
    t = compound_tier(capital)
    return round(COMPOUND_BASE + t * COMPOUND_STEP, 2)

def compound_progress(capital: float) -> float:
    t = compound_tier(capital)
    base = COMPOUND_BASE + (t - 1) * COMPOUND_STEP if t > 0 else 0
    top  = COMPOUND_BASE + t * COMPOUND_STEP if t > 0 else COMPOUND_BASE
    return round(min(100, (capital - base) / (top - base) * 100), 1)

def check_levelup():
    new_t = compound_tier(S.capital)
    if new_t > S.compound_tier:
        old_t  = S.compound_tier
        old_bet = compound_bet(S.capital - 0.01)
        new_bet = compound_bet(S.capital)
        S.compound_tier = new_t
        ev = {
            "time":     now_str(),
            "old_tier": old_t, "new_tier": new_t,
            "old_bet":  old_bet, "new_bet": new_bet,
            "capital":  round(S.capital, 4),
            "next":     compound_next(S.capital),
        }
        S.compound_events.append(ev)
        add_log("COMPOUND_UP", {
            "tier": new_t, "new_bet": new_bet,
            "capital": round(S.capital, 4), "next": compound_next(S.capital),
        })
        return True
    return False

# ─── GAS ENGINE ─────────────────────────────────────────────
def gas_tx_remaining() -> int:
    """Estimated transactions left from remaining POL (minus reserve)"""
    usable_pol = max(0, S.pol_left - GAS_RESERVE_POL)
    cost_per_tx_pol = GAS_PER_TX_USD / POL_PRICE_USD
    return int(usable_pol / cost_per_tx_pol)

def gas_status() -> str:
    tx = gas_tx_remaining()
    if tx <= GAS_STOP_TX:  return "critical"
    if tx <= GAS_ALERT_TX: return "low"
    return "ok"

def consume_gas():
    cost_pol = GAS_PER_TX_USD / POL_PRICE_USD
    S.pol_left     = round(max(0, S.pol_left - cost_pol), 4)
    S.gas_used_usd = round(S.gas_used_usd + GAS_PER_TX_USD, 4)

    status = gas_status()
    tx_left = gas_tx_remaining()

    if status == "critical" and not S.gas_paused:
        S.gas_paused = True
        add_log("GAS_STOP", {
            "tx_left": tx_left,
            "pol_left": S.pol_left,
            "message": f"Auto-stop: hanya {tx_left} tx tersisa. Top-up POL dulu.",
        })
    elif status == "low":
        add_log("GAS_WARN", {
            "tx_left": tx_left,
            "pol_left": S.pol_left,
            "message": f"Gas menipis! {tx_left} tx tersisa dari {round(S.pol_left,2)} POL.",
        })

# ─── EV ENGINE ──────────────────────────────────────────────
def ev(true_prob: float, price: float) -> float:
    return (true_prob * (1 - price)) - ((1 - true_prob) * price)

def kelly(true_prob: float, price: float) -> float:
    if price <= 0 or price >= 1: return 0
    b = (1 - price) / price
    k = (b * true_prob - (1 - true_prob)) / b
    return max(0, min(k / 2, 0.15))

def calc_size(true_prob: float, price: float) -> float:
    max_bet = compound_bet(S.capital)
    k = kelly(true_prob, price)
    avail = S.capital - sum(p["size"] for p in S.positions if p["status"] == "open")
    raw = avail * k
    return round(max(MIN_BET_USD, min(raw, max_bet, avail * 0.20)), 2)

# ─── HELPERS ────────────────────────────────────────────────
def now_str(): return datetime.now().strftime("%H:%M:%S")

def add_log(event: str, data: dict):
    entry = {"time": now_str(), "event": event, **data}
    S.log.insert(0, entry)
    if len(S.log) > 200: S.log.pop()
    return entry

async def broadcast(msg: dict):
    dead = set()
    txt = json.dumps(msg, default=str)
    for ws in S.ws_clients:
        try: await ws.send_text(txt)
        except: dead.add(ws)
    S.ws_clients -= dead

# ─── MARKET SCANNER (REAL API) ──────────────────────────────
async def fetch_gamma_markets() -> list:
    """Fetch real markets from Gamma API — diverse mix for signal opportunities"""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as sess:
            all_markets = []
            
            # Fetch without order param (gives default mix)
            async with sess.get(f"{GAMMA}/markets", params={
                "active": "true", "closed": "false",
                "limit": 100,
            }) as r:
                if r.status == 200:
                    data = await r.json()
                    items = data if isinstance(data, list) else data.get("markets", [])
                    all_markets.extend(items[:40])
            
            # Assign category based on question keywords
            for m in all_markets:
                q = m.get("question", "").lower()
                if "btc" in q or "bitcoin" in q or "eth" in q or "crypto" in q:
                    m["_fetched_cat"] = "crypto"
                elif "election" in q or "trump" in q or "harris" in q or "congress" in q:
                    m["_fetched_cat"] = "politics"
                elif "fed" in q or "rate" in q or "inflation" in q or "cpi" in q:
                    m["_fetched_cat"] = "economics"
                elif "game" in q or "win" in q or "score" in q or "match" in q or "nba" in q or "nfl" in q:
                    m["_fetched_cat"] = "sports"
                else:
                    m["_fetched_cat"] = "other"
            
            return all_markets
    except Exception as e:
        S.errors.append(f"Gamma: {str(e)[:60]}")
        return []

def make_slug(question: str) -> str:
    """Generate URL-friendly slug from question text"""
    # Remove special chars, replace spaces with hyphens, lowercase
    s = question.lower()
    s = re.sub(r'[^a-z0-9\s]', '', s)  # keep only alphanumeric
    s = re.sub(r'\s+', '-', s)  # spaces to hyphens
    s = re.sub(r'-+', '-', s)  # no double hyphens
    s = s.strip('-')[:80]  # limit length
    return s

def parse_market(m: dict) -> Optional[dict]:
    """Parse raw Gamma market into bot format - handles both old and new API format"""
    # New API format: outcomes and outcomePrices are JSON strings
    outcomes = m.get("outcomes", [])
    outcome_prices = m.get("outcomePrices", [])

    # Parse JSON strings if needed
    if isinstance(outcomes, str):
        try:
            outcomes = json.loads(outcomes)
        except:
            outcomes = []

    if isinstance(outcome_prices, str):
        try:
            outcome_prices = json.loads(outcome_prices)
        except:
            outcome_prices = []

    yes_p = None
    no_p = None

    # Try new format first (outcomes/outcomePrices)
    if outcomes and outcome_prices and len(outcomes) == len(outcome_prices):
        try:
            yes_idx = list(outcomes).index("Yes") if "Yes" in outcomes else -1
            no_idx = list(outcomes).index("No") if "No" in outcomes else -1
            if yes_idx >= 0 and no_idx >= 0:
                yes_p = float(outcome_prices[yes_idx])
                no_p = float(outcome_prices[no_idx])
        except (ValueError, IndexError):
            yes_p = None
            no_p = None

    # Fallback to old format (tokens)
    if yes_p is None or no_p is None:
        tokens = m.get("tokens", [])
        yes_t = next((t for t in tokens if t.get("outcome") == "Yes"), None)
        no_t = next((t for t in tokens if t.get("outcome") == "No"), None)
        if yes_t and no_t:
            try:
                yes_p = float(yes_t.get("price", 0))
                no_p = float(no_t.get("price", 0))
            except (ValueError, TypeError):
                return None

    if yes_p is None or no_p is None or yes_p <= 0 or no_p <= 0:
        return None

    vol = float(m.get("volume", 0) or 0)
    question = m.get("question", "")[:80]
    return {
        "id": m.get("id", ""),
        "question": question,
        "slug": make_slug(question),
        "category": (m.get("category") or m.get("_fetched_cat", "other")).lower(),
        "yes_price": round(yes_p, 4),
        "no_price": round(no_p, 4),
        "volume": round(vol, 2),
        "end_date": m.get("endDate", ""),
        "spread": round(abs(1 - yes_p - no_p), 4),
    }

def build_market_rows(markets: list) -> list:
    """Build rows for Excel-style table (all categories, all markets)"""
    rows = []
    for p in markets:
        if not p: continue
        # p is already parsed market dict
        sig = detect_signal(p)
        # Always include market even if no signal
        rows.append({
            **p,
            "signal":    sig["strategy"] if sig else "—",
            "ev":        round(sig["ev"], 4) if sig else 0,
            "true_prob": round(sig["true_prob"], 4) if sig else 0,
            "outcome":   sig["outcome"] if sig else "—",
            "fee":       TAKER_FEE.get(p["category"], 0.01),
        })
    # sort by volume desc
    rows.sort(key=lambda r: r["volume"], reverse=True)
    return rows

def detect_signal(m: dict) -> Optional[dict]:
    """Detect trading signal from a parsed market"""
    yes_p = m["yes_price"]
    no_p  = m["no_price"]
    vol   = m["volume"]
    cat   = m["category"]

    if vol < 1000: return None

    # 1. Arb: YES + NO < 0.985
    if yes_p + no_p < 0.985:
        profit = round(1 - yes_p - no_p, 4)
        return {"strategy": "arb", "outcome": "YES+NO",
                "ev": profit, "true_prob": 0.99, "price": yes_p}

    # 2. No-bias: YES 75-92% → NO likely undervalued
    if 0.75 <= yes_p <= 0.92:
        tp_no = min(no_p + 0.12, 0.85)
        if PROB_MIN <= tp_no <= PROB_MAX:
            e = ev(tp_no, no_p)
            if e >= MIN_EV:
                return {"strategy": "no_bias", "outcome": "NO",
                        "ev": round(e, 4), "true_prob": tp_no, "price": no_p}

    # 3. High-prob YES (widen range from 40% to 92%)
    if 0.40 <= yes_p <= 0.92:
        tp = min(yes_p + 0.06, 0.90)
        e  = ev(tp, yes_p)
        if e >= MIN_EV:
            return {"strategy": "high_prob", "outcome": "YES",
                    "ev": round(e, 4), "true_prob": tp, "price": yes_p}

    return None

# ─── RISK GATE ───────────────────────────────────────────────
def risk_ok(sig: dict) -> tuple[bool, str]:
    if S.gas_paused:
        return False, f"Gas stop aktif — {gas_tx_remaining()} tx tersisa. Top-up POL."
    if S.daily_pnl <= -DAILY_LOSS_LIMIT:
        return False, f"Daily loss limit ${abs(S.daily_pnl):.2f}"
    if len([p for p in S.positions if p["status"]=="open"]) >= MAX_OPEN_POS:
        return False, f"Max {MAX_OPEN_POS} posisi terbuka"
    if sig["ev"] < MIN_EV:
        return False, f"EV {sig['ev']:.3f} terlalu kecil"
    if not (PROB_MIN <= sig["true_prob"] <= PROB_MAX):
        return False, f"Prob {sig['true_prob']:.2f} di luar range"
    avail = S.capital - sum(p["size"] for p in S.positions if p["status"]=="open")
    if avail < MIN_BET_USD:
        return False, f"Kapital tersedia ${avail:.2f}"
    return True, "OK"

# ─── POSITION MANAGEMENT ───────────────────────────────────
async def open_position(market: dict, sig: dict):
    # Guard: skip if market already has open position
    if any(p["market_id"] == market["id"] and p["status"] == "open" for p in S.positions):
        return
    ok, reason = risk_ok(sig)
    if not ok:
        add_log("REJECTED", {"reason": reason, "question": market["question"][:50]})
        return

    size = calc_size(sig["true_prob"], sig["price"])
    S.pos_counter += 1
    pos = {
        "id":         f"{'SIM' if MODE=='sim' else 'REAL'}-{S.pos_counter:04d}",
        "market_id":  market["id"],
        "question":   market["question"],
        "category":   market["category"],
        "outcome":    sig["outcome"],
        "price":      sig["price"],
        "true_prob":  sig["true_prob"],
        "size":       size,
        "shares":     round(size / sig["price"], 4) if sig["price"] > 0 else 0,
        "ev":         sig["ev"],
        "strategy":   sig["strategy"],
        "status":     "open",
        "opened_at":  datetime.now(timezone.utc).isoformat(),
        "resolve_in": random.randint(25, 90),  # sim only
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
    await broadcast({"type":"log", "data": entry})
    await broadcast({"type":"positions", "data": open_positions()})
    await broadcast({"type":"stats", "data": get_stats()})

async def close_position(pos: dict, won: bool):
    if pos["status"] != "open": return
    pnl = round(pos["size"] * (1/pos["price"] - 1), 4) if won else -pos["size"]
    pos["status"]     = "won" if won else "lost"
    pos["pnl"]        = pnl
    pos["exit_price"] = 1.0 if won else 0.0
    pos["closed_at"]  = datetime.now(timezone.utc).isoformat()
    if won:
        S.capital = round(S.capital + pos["size"] + pnl, 4)  # return bet + profit
    else:
        S.capital = round(S.capital - pos["size"], 4)  # lose bet only
    S.daily_pnl = round(S.daily_pnl + pnl, 4)
    S.positions.remove(pos)
    S.closed_trades.append(pos)

    leveled = check_levelup()
    entry = add_log("CLOSE", {
        "id": pos["id"], "result": pos["status"],
        "pnl": pnl, "question": pos["question"][:50],
        "capital": round(S.capital, 4),
    })
    await broadcast({"type":"log", "data": entry})
    if leveled:
        await broadcast({"type":"compound_up", "data": S.compound_events[-1]})
        await broadcast({"type":"log", "data": S.log[0]})
    await broadcast({"type":"positions", "data": open_positions()})
    await broadcast({"type":"stats", "data": get_stats()})

# ─── BACKGROUND TASKS ───────────────────────────────────────
async def scanner_loop():
    cycle = 0
    last_markets = []
    while True:
        try:
            cycle += 1
            S.scan_count += 1

            # Fetch real markets every 3rd cycle, otherwise add noise to cached
            if cycle % 3 == 1 or not last_markets:
                raw = await fetch_gamma_markets()
                if raw: last_markets = raw
            else:
                # Add market noise to simulate price movement
                noisy = []
                for m in last_markets:
                    tokens = m.get("tokens", [])
                    for t in tokens:
                        p = float(t.get("price", 0.5) or 0.5)
                        t["price"] = round(min(0.99, max(0.01, p + random.uniform(-0.012, 0.012))), 4)
                    noisy.append(m)
                last_markets = noisy

            # Build market rows for Excel view (all categories)
            parsed_markets = [parse_market(m) for m in last_markets]
            parsed_markets = [m for m in parsed_markets if m]
            S.market_rows  = build_market_rows(parsed_markets)
            S.signals_found += sum(1 for r in S.market_rows if r["signal"] != "—")

            # Act on signals (only if not gas-paused)
            if not S.gas_paused:
                scanned = set()  # dedup within this scan
                for row in S.market_rows:
                    if row["signal"] == "—": continue
                    mid = row["id"]
                    if mid in scanned: continue  # skip duplicate markets in same scan
                    scanned.add(mid)
                    already = any(p["market_id"] == mid and p["status"]=="open" for p in S.positions)
                    if already: continue
                    if random.random() < 0.20:  # 20% act rate
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
    """Sim mode: auto-resolve positions after resolve_in seconds"""
    while True:
        now = datetime.now(timezone.utc)
        to_resolve = []
        for pos in list(S.positions):
            if pos["status"] != "open": continue
            opened = datetime.fromisoformat(pos["opened_at"])
            if (now - opened).total_seconds() >= pos.get("resolve_in", 60):
                to_resolve.append(pos)
        for pos in to_resolve:
            won = random.random() < (pos["true_prob"] * 0.95)
            await close_position(pos, won)
        await asyncio.sleep(3)

# ─── DATA HELPERS ────────────────────────────────────────────
def open_positions(): return [p for p in S.positions if p["status"]=="open"]

def get_gas_info() -> dict:
    tx_left = gas_tx_remaining()
    status  = gas_status()
    return {
        "pol_total":   POL_BALANCE,
        "pol_left":    round(S.pol_left, 4),
        "pol_used":    round(POL_BALANCE - S.pol_left, 4),
        "gas_usd":     round(S.gas_used_usd, 4),
        "tx_left":     tx_left,
        "tx_per_pol":  round(1 / (GAS_PER_TX_USD / POL_PRICE_USD), 1),
        "status":      status,          # "ok" | "low" | "critical"
        "paused":      S.gas_paused,
        "alert_tx":    GAS_ALERT_TX,
        "stop_tx":     GAS_STOP_TX,
        "reserve_pol": GAS_RESERVE_POL,
    }

def get_stats() -> dict:
    total = len(S.closed_trades)
    wins  = sum(1 for t in S.closed_trades if t["status"]=="won")
    pnl   = round(S.capital - S.initial_capital, 4)
    t     = compound_tier(S.capital)
    return {
        "mode":            MODE.upper(),
        "capital":         round(S.capital, 4),
        "initial":         S.initial_capital,
        "pnl":             pnl,
        "roi_pct":         round(pnl / S.initial_capital * 100, 2),
        "total_trades":    total,
        "wins":            wins,
        "losses":          total - wins,
        "win_rate":        round(wins/total*100,1) if total else 0,
        "open_count":      len(open_positions()),
        "daily_pnl":       round(S.daily_pnl, 4),
        "scan_count":      S.scan_count,
        "signals_found":   S.signals_found,
        "start_time":      S.start_time,
        "errors":          S.errors[-3:],
        "gas":             get_gas_info(),
        # compound
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
            "wallet": "Phantom (Solana) TIDAK kompatibel dengan Polymarket (Polygon/EVM). Butuh MetaMask atau wallet EVM.",
            "needed": ["POLY_PRIVATE_KEY (EVM private key)", "POLY_API_KEY", "POLY_SECRET", "POLY_PASSPHRASE", "USDC on Polygon"],
            "note": "Phantom hanya untuk Solana. Polymarket pakai Polygon (EVM). Export private key dari MetaMask.",
        },
    }

# ─── API ROUTES ──────────────────────────────────────────────
@app.get("/health")
def health(): return {"status":"ok","mode":MODE,"running":S.running}

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
        cap_s = 0 if i==0 else COMPOUND_BASE + (i-1)*COMPOUND_STEP
        cap_e = COMPOUND_BASE if i==0 else COMPOUND_BASE + i*COMPOUND_STEP
        bet   = MAX_BET_USD if i==0 else round(i*COMPOUND_INC, 2)
        tiers.append({"tier":i,"cap_from":cap_s,"cap_to":cap_e,"max_bet":bet,
                       "active": compound_tier(S.capital)==i})
    return {"current_tier": compound_tier(S.capital), "current_bet": compound_bet(S.capital),
            "capital": round(S.capital,4), "tiers": tiers, "events": S.compound_events}

@app.post("/api/gas/resume")
async def api_gas_resume():
    """Manual resume after gas-stop (after topping up POL)"""
    S.gas_paused = False
    add_log("GAS_RESUME", {"message":"Gas stop dihapus manual. Bot aktif kembali."})
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
    print(f"[Bot] Gas alert at <{GAS_ALERT_TX} tx, auto-stop at <{GAS_STOP_TX} tx")