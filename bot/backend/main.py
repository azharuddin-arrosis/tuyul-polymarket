"""
POLYMARKET BOT — FINAL
Categories: BTC 5m ONLY + Soccer/Sports ONLY
BTC5m: 7-indicator weighted TA (window delta dominant)
      Entry T-10s poll loop → fire at best signal → T-5s hard deadline
      Spike detection: score jump ≥1.5 → fire immediately
Soccer: Gamma API scanner, same-day matches
Compound: floor(equity/10) = max_bet, min $1
Gas: auto-stop when < 2 orders worth remaining (50% reserve)
Real: [RUN/STOP] button via API
Persist: SQLite + per-bot state.json
Circuit breakers: balance floor, daily loss limit (persistent), per-trade stop-loss 30%
Balance: auto-fetch USDC via CLOB API + POL via Polygon RPC, refresh every 5 min
"""
import asyncio, json, os, random, time, sqlite3, threading, math, subprocess
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Optional web3 / eth-account — graceful fallback if not installed
try:
    from eth_account import Account as _EthAccount
    WEB3_OK = True
except ImportError:
    _EthAccount = None
    WEB3_OK = False

# Optional py-clob-client-v2 — handles CLOB v2 natively (timestamp, builder, metadata)
try:
    from py_clob_client_v2.client import ClobClient
    from py_clob_client_v2.clob_types import OrderArgs, OrderType, ApiCreds
    from py_clob_client_v2.constants import POLYGON
    CLOB_OK = True
except ImportError:
    ClobClient = None
    CLOB_OK = False

_lock    = asyncio.Lock()
_db_lock = threading.Lock()

BOT_ID     = os.getenv("BOT_ID", "bot1")
BOT_NAME   = os.getenv("BOT_NAME", BOT_ID)         # display name, fallback to BOT_ID
MODE       = os.getenv("BOT_MODE", "sim")          # sim | dry_run | real — runtime-mutable
VALID_MODES = ("sim", "dry_run", "real")
# Log file suffix per mode (biar dry/real tidak campur)
_MODE_SUFFIX = {"sim": "sim", "dry_run": "dry", "real": "real"}.get(MODE, MODE)
DATA_DIR   = Path(os.getenv("DATA_DIR", "/app/data"))
STATE_FILE = DATA_DIR / f"state_{BOT_ID}.json"
DB_PATH    = DATA_DIR / "trades.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=f"PolyBot {BOT_ID}")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── CONFIG ──────────────────────────────────────────────────
class C:
    usdc_capital        = float(os.getenv("USDC_CAPITAL", "10"))
    pol_balance         = float(os.getenv("POL_BALANCE", "11"))
    min_bet             = 1.00
    max_open_pos        = int(os.getenv("MAX_OPEN_POS", "5"))
    min_ev              = float(os.getenv("MIN_EV", "0.03"))
    daily_loss_limit    = float(os.getenv("DAILY_LOSS_LIMIT", "100.0"))
    scan_sec            = int(os.getenv("SCAN_INTERVAL", "10"))
    # Gas
    gas_per_tx_usd      = 0.02
    pol_price_usd       = 0.40
    gas_reserve_pct     = 0.50     # 50% POL reserved
    gas_stop_orders     = 3        # auto-stop when ≤ 3 orders left (was 2)
    gas_alert_orders    = 5        # alert when ≤ 5 orders left
    # Salary
    salary_threshold    = 100.0
    salary_keep_pct     = 0.30
    salary_withdraw_pct = 0.70
    # Real credentials
    poly_private_key    = os.getenv("POLY_PRIVATE_KEY", "")
    poly_api_key        = os.getenv("POLY_API_KEY", "")
    poly_secret         = os.getenv("POLY_SECRET", "")
    poly_passphrase     = os.getenv("POLY_PASSPHRASE", "")
    # Builder code for order attribution (bytes32)
    builder_code        = os.getenv("BUILDER_CODE", "0x0000000000000000000000000000000000000000000000000000000000000000")
    # Deposit wallet address (required for POLY_1271 signature type)
    poly_funder         = os.getenv("POLY_FUNDER", "")
    # Builder Relayer (gasless redemption) — optional, falls back to py-clob-client if not set
    relayer_api_key     = os.getenv("RELAYER_API_KEY", "")
    relayer_api_address = os.getenv("RELAYER_API_ADDRESS", "")
    relayer_api_host    = os.getenv("RELAYER_API_HOST", "https://relayer-v2.polymarket.com/")
    use_gasless_redeem  = os.getenv("USE_GASLESS_REDEEM", "true").lower() == "true"  # default: try gasless
    # Circuit breakers
    balance_floor       = float(os.getenv("BALANCE_FLOOR", "20"))
    balance_refresh_sec = int(os.getenv("BALANCE_REFRESH_SEC", "300"))
    polygon_rpc         = os.getenv("POLYGON_RPC", "https://polygon-rpc.com")

GAMMA    = "https://gamma-api.polymarket.com"
BINANCE_MIRRORS = [
    "https://api.binance.com/api/v3",
    "https://api1.binance.com/api/v3",
    "https://api2.binance.com/api/v3",
    "https://api3.binance.com/api/v3",
]
CRYPTOCOMPARE = "https://min-api.cryptocompare.com/data"
COINGECKO = "https://api.coingecko.com/api/v3"
_TS_PORT  = 3100 + (int(BOT_ID.replace("real","")) if BOT_ID.startswith("real") and BOT_ID[4:].isdigit() else 0)
ORDER_SVC = os.getenv("ORDER_SERVICE_URL", f"http://127.0.0.1:{_TS_PORT}")
CLOB     = "https://clob.polymarket.com"
BTC5M_WIN = 300

# Persistent price sample buffer for synthetic kline generation
# Survives across window resets; capped at 60 minutes of data (1800 samples @ 2s poll)
_price_samples: list = []  # list of [timestamp_int, price_float]

# ─── COMPOUND: Fixed 10% of equity ──────────────────────────
# Opsi B: always 10% of equity, min $1, max $50
# $10→$1, $20→$2, $50→$5, $100→$10, $200→$20, $500→$50 (cap)
# Max loss per trade = 10% — never all-in
_COMPOUND_PCT      = 0.10   # 10% of equity per bet (≤$100)
_COMPOUND_BASE_BET = 1.0    # minimum bet
_COMPOUND_MAX_BET  = 50.0   # maximum bet cap

def compound_bet(equity: float) -> float:
    # Tiered: -2% per $100 level
    if equity <= 100:
        pct = 0.10
    elif equity <= 500:
        pct = 0.08
    elif equity <= 1000:
        pct = 0.06
    else:
        pct = 0.04
    raw = equity * pct
    return round(min(max(round(raw, 1), _COMPOUND_BASE_BET), _COMPOUND_MAX_BET), 2)

def compound_next_at(equity: float) -> float:
    # Next $10 equity milestone (for UI progress display)
    return round(math.ceil(equity / 10) * 10, 2)

def compound_progress(equity: float) -> float:
    # Progress within current $10 band
    band_start = math.floor(equity / 10) * 10
    band_end   = band_start + 10
    if band_end <= band_start: return 100.0
    return round(min(100.0, max(0.0, (equity - band_start) / 10 * 100)), 1)

# ─── STATE ───────────────────────────────────────────────────
class BotState:
    def __init__(self):
        self.capital              = C.usdc_capital
        self.locked               = 0.0
        self.initial              = C.usdc_capital
        self.positions            = []
        self.closed_trades        = []
        self.log                  = []
        self.scan_count           = 0
        self.signals_found        = 0
        self.daily_pnl            = 0.0
        self.daily_date           = date.today().isoformat()
        self.gas_used_usd         = 0.0
        self.pol_left             = C.pol_balance
        self.pos_counter          = 0
        self.running              = MODE == "sim"   # sim always runs, real needs manual start
        self.gas_paused           = False
        self.ws_clients           = set()
        self.errors               = []
        self.start_time           = datetime.now(timezone.utc).isoformat()
        self.compound_events      = []
        self.salary_events        = []
        self.total_withdrawn      = 0.0
        self.withdrawal_history   = []  # list of {"timestamp": iso_str, "amount": float, "note": str}
        self.salary_target        = C.salary_threshold
        self.lifetime_pnl         = 0.0
        self.last_balance_refresh = ""
        # BTC5m state
        self.btc5m = {
            "slug": "", "win_ts": 0, "secs_left": 300,
            "btc_price": 0.0, "win_open": 0.0,
            "predicted_dir": "", "confidence": 0.0,
            "entry_fired": False, "in_entry_zone": False,
            "score": 0.0, "indicators": {},
            "ticks": [], "last_tick": 0.0,
            "market_data": {}, "klines": [],
            "last_kline_fetch": 0, "last_market_fetch": 0,
            "stats": {"wins": 0, "losses": 0, "total": 0},
            # Sprint 1 additions
            "prev_score": 0.0,
            "highest_confidence_seen": 0.0,
        }
        # (soccer scanner removed — BTC only)
        # CLOB orderbook snapshot for active BTC5m window (Polypox Terminal)
        self.orderbook = {
            "slug": "", "ts": 0,
            "yes_token": "", "no_token": "",
            "yes": {"asks": [], "bids": []},
            "no":  {"asks": [], "bids": []},
            "mid_yes": 0.0, "mid_no": 0.0, "comb": 0.0,
        }
        # Strategy config — runtime-mutable, persisted (Polypox Terminal Phase 2)
        # Polymarket has NO native SL/TP. We rely on auto-claim (redeemWinningPositions)
        # when market resolves at end of 5m window. Circuit breakers below are portfolio-level.
        self.strategy_config = {
            "bet_size":         float(os.getenv("BET_SIZE", "1")),       # USDC per trade (compound override)
            "use_compound":     True,                                     # if true, ignore bet_size, use floor(eq/10)
            "max_loss_strike":  0,       # consecutive losses → pause bot (0 = disabled)
            "max_win_strike":   0,       # consecutive wins → pause bot (0 = disabled)
            "daily_tp_usd":     0,       # daily P&L target → pause bot (0 = disabled)
            "daily_sl_usd":     1005.0,     # daily loss limit → pause bot (matches DAILY_LOSS_LIMIT)
            "conf_threshold":   0.25,    # min signal confidence to enter
            "trigger_range":    0.0,     # additional spike trigger threshold (0 = use default 1.5)
            "price_min_cents":  0,       # only enter if YES token price >= this (cents, 0 = no min)
            "price_max_cents":  100,     # only enter if YES token price <= this (cents, 100 = no max)
            "sentiment_lower":  0,       # filter: BTC delta% lower bound
            "sentiment_upper":  0,       # filter: BTC delta% upper bound (0/0 = no filter)
            "trading_start":    "00:00", # local-time gate (HH:MM)
            "trading_end":      "23:59",
            "trading_active":   True,    # master switch
        }
        # Mutable mode (synced with global MODE)
        self.mode = MODE
        # Consecutive win/loss tracker for max_strike
        self.win_streak  = 0
        self.loss_streak = 0

S = BotState()

# ─── SQLITE ──────────────────────────────────────────────────
def db_init():
    with _db_lock:
        con = sqlite3.connect(DB_PATH)
        con.executescript("""
        CREATE TABLE IF NOT EXISTS trades (
            id TEXT, bot_id TEXT, market_id TEXT, question TEXT,
            category TEXT, strategy TEXT, outcome TEXT,
            price REAL, size REAL, ev REAL, true_prob REAL,
            status TEXT, pnl REAL, opened_at TEXT, closed_at TEXT,
            resolve_sec INTEGER
        );
        CREATE TABLE IF NOT EXISTS sessions (
            bot_id TEXT, mode TEXT, started_at TEXT, capital REAL, pol REAL
        );
        CREATE TABLE IF NOT EXISTS log_events (
            ts TEXT, bot_id TEXT, event TEXT, data TEXT
        );
        CREATE TABLE IF NOT EXISTS daily_loss (
            date TEXT,
            bot_id TEXT,
            pnl REAL,
            PRIMARY KEY (date, bot_id)
        );
        """)
        con.commit(); con.close()

def db_save_trade(pos: dict):
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute("INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                pos.get("id"), BOT_ID, pos.get("market_id"), pos.get("question", "")[:120],
                pos.get("category"), pos.get("strategy"), pos.get("outcome"),
                pos.get("price"), pos.get("size"), pos.get("ev"), pos.get("true_prob"),
                pos.get("status"), pos.get("pnl"),
                pos.get("opened_at"), pos.get("closed_at"), pos.get("resolve_sec"),
            ))
            con.commit(); con.close()
    except: pass

def db_summary():
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
            rows = con.execute("""
                SELECT bot_id,
                  COUNT(*) total, SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) wins,
                  ROUND(SUM(pnl),4) total_pnl, ROUND(AVG(pnl),4) avg_pnl,
                  MAX(closed_at) last_trade
                FROM trades WHERE status IN ('won','lost') GROUP BY bot_id
            """).fetchall()
            con.close()
            return [dict(r) for r in rows]
    except: return []

def db_trades(bot_id="", limit=100):
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
            q = "SELECT * FROM trades"
            args = []
            if bot_id: q += " WHERE bot_id=?"; args.append(bot_id)
            q += f" ORDER BY opened_at DESC LIMIT {limit}"
            rows = [dict(r) for r in con.execute(q, args).fetchall()]
            con.close(); return rows
    except: return []

def db_save_daily_loss():
    """Persist daily P&L to SQLite — survives restart."""
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute(
                "INSERT OR REPLACE INTO daily_loss VALUES (?,?,?)",
                (S.daily_date, BOT_ID, S.daily_pnl)
            )
            con.commit(); con.close()
    except: pass

def db_load_daily_loss():
    """Load today's cumulative daily P&L from SQLite on startup."""
    try:
        today = date.today().isoformat()
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            row = con.execute(
                "SELECT pnl FROM daily_loss WHERE date=? AND bot_id=?",
                (today, BOT_ID)
            ).fetchone()
            con.close()
        if row:
            S.daily_pnl  = float(row[0])
            S.daily_date = today
            add_log("DAILY_LOAD", {"pnl": round(S.daily_pnl, 4), "date": today,
                                   "message": f"Daily P&L resumed: ${S.daily_pnl:.4f}"})
    except: pass

# ─── PERSIST STATE ───────────────────────────────────────────
def save_state():
    try:
        data = {
            "capital": S.capital, "locked": S.locked, "initial": S.initial,
            "total_withdrawn": S.total_withdrawn, "withdrawal_history": S.withdrawal_history[-100:],
            "salary_target": S.salary_target,
            "salary_events": S.salary_events, "compound_events": S.compound_events,
            "lifetime_pnl": S.lifetime_pnl, "pos_counter": S.pos_counter,
            "closed_trades": S.closed_trades[-300:],
            "pol_left": S.pol_left, "gas_used_usd": S.gas_used_usd,
            "btc5m_stats": S.btc5m["stats"],
            "mode": S.mode, "strategy_config": S.strategy_config,
            "win_streak": S.win_streak, "loss_streak": S.loss_streak,
        }
        STATE_FILE.write_text(json.dumps(data, default=str))
    except: pass

def load_state():
    if not STATE_FILE.exists(): return False
    try:
        d = json.loads(STATE_FILE.read_text())
        S.capital         = float(d.get("capital", C.usdc_capital))
        S.locked          = 0.0
        S.initial         = float(d.get("initial", C.usdc_capital))
        S.total_withdrawn = float(d.get("total_withdrawn", 0))
        S.withdrawal_history = d.get("withdrawal_history", [])
        S.salary_target   = float(d.get("salary_target", C.salary_threshold))
        S.salary_events   = d.get("salary_events", [])
        S.compound_events = d.get("compound_events", [])
        S.lifetime_pnl    = float(d.get("lifetime_pnl", 0))
        S.pos_counter     = int(d.get("pos_counter", 0))
        S.closed_trades   = d.get("closed_trades", [])
        S.pol_left        = float(d.get("pol_left", C.pol_balance))
        S.gas_used_usd    = float(d.get("gas_used_usd", 0))
        S.btc5m["stats"]  = d.get("btc5m_stats", {"wins": 0, "losses": 0, "total": 0})
        # Polypox Phase 2: restore mode + strategy config
        saved_mode = d.get("mode")
        if saved_mode in VALID_MODES:
            global MODE
            S.mode = saved_mode; MODE = saved_mode
        saved_cfg = d.get("strategy_config") or {}
        for k, v in saved_cfg.items():
            if k in S.strategy_config:
                S.strategy_config[k] = v
        S.win_streak  = int(d.get("win_streak", 0))
        S.loss_streak = int(d.get("loss_streak", 0))
        add_log("RESUMED", {"capital": round(S.capital, 4), "mode": S.mode, "message": f"Resumed ${S.capital:.2f} dari sesi sebelumnya"})
        return True
    except: return False

# ─── HELPERS ─────────────────────────────────────────────────
def now_str(): return datetime.now().strftime("%H:%M:%S")
def equity(): return round(S.capital + S.locked, 4)

def add_log(event: str, data: dict):
    e = {"time": now_str(), "event": event, **data}
    S.log.insert(0, e)
    if len(S.log) > 500: S.log.pop()
    return e

async def broadcast(msg: dict):
    dead = set()
    txt  = json.dumps(msg, default=str)
    for ws in S.ws_clients:
        try: await ws.send_text(txt)
        except: dead.add(ws)
    S.ws_clients -= dead

def daily_reset():
    today = date.today().isoformat()
    if S.daily_date != today:
        S.daily_date = today; S.daily_pnl = 0.0
        save_state()

# ─── GAS ENGINE ──────────────────────────────────────────────
def gas_usable_pol() -> float:
    return max(0, S.pol_left * (1 - C.gas_reserve_pct))

def gas_cost_per_order_pol() -> float:
    return C.gas_per_tx_usd / C.pol_price_usd

def gas_orders_left() -> int:
    cost = gas_cost_per_order_pol()
    return int(gas_usable_pol() / cost) if cost > 0 else 9999

def gas_status() -> str:
    n = gas_orders_left()
    if n <= C.gas_stop_orders:  return "critical"
    if n <= C.gas_alert_orders: return "low"
    return "ok"

def consume_gas():
    cost = gas_cost_per_order_pol()
    S.pol_left     = round(max(0, S.pol_left - cost), 4)
    S.gas_used_usd = round(S.gas_used_usd + C.gas_per_tx_usd, 4)
    n  = gas_orders_left()
    st = gas_status()
    if st == "critical" and not S.gas_paused:
        S.gas_paused = True
        e = add_log("GAS_STOP", {"orders_left": n, "pol_left": round(S.pol_left, 3),
            "message": f"Auto-stop: hanya {n} order tersisa (< {C.gas_stop_orders})"})
        asyncio.create_task(broadcast({"type": "gas_stop", "data": e}))
    elif st == "low":
        add_log("GAS_WARN", {"orders_left": n, "pol_left": round(S.pol_left, 3),
            "message": f"Gas menipis: {n} order tersisa"})

def get_gas_info():
    n = gas_orders_left()
    pol_used = round(C.pol_balance - S.pol_left, 4)
    pct = round(pol_used / C.pol_balance * 100, 1) if C.pol_balance else 0
    return {
        "pol_total":    C.pol_balance,
        "pol_left":     round(S.pol_left, 4),
        "pol_used":     pol_used,
        "pol_usable":   round(gas_usable_pol(), 4),
        "pol_reserved": round(S.pol_left * C.gas_reserve_pct, 4),
        "gas_usd":      round(S.gas_used_usd, 4),
        "orders_left":  n,
        "pct_used":     pct,
        "status":       gas_status(),
        "paused":       S.gas_paused,
        "stop_at":      C.gas_stop_orders,
        "alert_at":     C.gas_alert_orders,
    }

# ─── BALANCE FETCH (Sprint 1) ─────────────────────────────────
async def fetch_balance_usdc(sess: aiohttp.ClientSession) -> float:
    """Fetch live USDC balance from Polymarket CLOB API (real mode only).

    Uses ClobClient.get_balance_allowance(sig=2) which reads the proxy wallet
    where Polymarket actually holds USDC — not the EOA wallet which is always empty.
    """
    if not CLOB_OK or not C.poly_api_key: return 0.0
    try:
        from py_clob_client_v2.clob_types import BalanceAllowanceParams, AssetType

        def _fetch():
            client = _build_clob_client()
            if client is None:
                return 0.0
            params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=2)
            data = client.get_balance_allowance(params=params)
            raw = float(data.get("balance", 0) or 0)
            # CLOB returns balance in micro-USDC (6 decimal places) — divide by 1e6
            return round(raw / 1e6, 4)

        return await asyncio.get_event_loop().run_in_executor(None, _fetch)
    except: pass
    return 0.0

async def fetch_balance_pol(sess: aiohttp.ClientSession) -> float:
    """Fetch live POL (MATIC) balance from Polygon public JSON-RPC.
    Tries env-configured RPC first, then falls back to public RPCs (polygon-rpc.com
    started returning 401 in 2026 — needs API key for paid tier)."""
    if not WEB3_OK or not C.poly_private_key:
        return S.pol_left  # fallback to state
    try:
        acct    = _EthAccount.from_key(C.poly_private_key)
        address = acct.address
    except Exception:
        return S.pol_left
    payload = {"jsonrpc": "2.0", "method": "eth_getBalance",
               "params": [address, "latest"], "id": 1}
    rpc_chain = [
        C.polygon_rpc,
        "https://polygon.llamarpc.com",
        "https://polygon-bor-rpc.publicnode.com",
        "https://rpc.ankr.com/polygon",
        "https://polygon.drpc.org",
    ]
    rpc_headers = {"Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 polypox",
                    "Accept": "application/json"}
    for rpc_url in rpc_chain:
        try:
            async with sess.post(rpc_url, json=payload, headers=rpc_headers,
                                  timeout=aiohttp.ClientTimeout(total=8)) as r:
                if r.status == 200:
                    data = await r.json()
                    if "result" in data:
                        wei = int(data["result"], 16)
                        return round(wei / 1e18, 6)
        except: continue
    return S.pol_left  # all RPCs failed — keep last known

async def balance_refresh_loop():
    """Refresh USDC + POL balance every 5 minutes. Broadcasts balance_update via WebSocket."""
    await asyncio.sleep(15)  # let startup complete first
    async with aiohttp.ClientSession() as sess:
        while True:
            try:
                pol = await fetch_balance_pol(sess)
                S.pol_left = pol

                if MODE == "real":
                    usdc = await fetch_balance_usdc(sess)
                    if usdc > 0:
                        open_count = len(open_pos())
                        if open_count > 0:
                            # Positions are open: on-chain balance includes locked funds.
                            # Overwriting S.capital here would corrupt the available/locked split.
                            # Only sync if drift is suspiciously large (>$5) — indicates
                            # an external deposit or major discrepancy worth logging.
                            expected_onchain = round(S.capital + S.locked, 4)
                            drift = abs(usdc - expected_onchain)
                            if drift > 5.0:
                                add_log("BALANCE_DRIFT", {
                                    "on_chain": round(usdc, 4),
                                    "expected": expected_onchain,
                                    "drift":    round(drift, 4),
                                    "open_pos": open_count,
                                    "message":  f"Balance drift ${drift:.2f} detected — skipping overwrite (positions open)",
                                })
                            # Do NOT overwrite S.capital when positions are open
                        else:
                            # No open positions: safe to sync capital from on-chain
                            S.capital = usdc

                S.last_balance_refresh = datetime.now(timezone.utc).isoformat()
                add_log("BALANCE_REFRESH", {
                    "usdc": round(S.capital, 4),
                    "pol":  round(pol, 4),
                    "mode": MODE,
                    "message": f"Balance refreshed — USDC ${S.capital:.2f} POL {pol:.4f}"
                })
                await broadcast({"type": "balance_update", "data": {
                    "usdc": round(S.capital, 4),
                    "pol":  round(S.pol_left, 4),
                    "ts":   S.last_balance_refresh,
                }})
            except Exception as e:
                S.errors.append(f"[balance_refresh] {str(e)[:60]}")
            await asyncio.sleep(C.balance_refresh_sec)

# ─── (SL/TP removed: Polymarket has no native SL/TP; rely on auto-claim at resolve) ──

# ─── CIRCUIT BREAKERS ─────────────────────────────────────────
_breaker_paused_reason = ""  # set when bot auto-paused; cleared on resume

def _ts() -> str:
    """Timestamp prefix untuk semua log penting — format: [DD/MM HH:MM:SS]"""
    return datetime.now(timezone.utc).strftime("%d/%m %H:%M:%S")

def _in_trading_hours(start_hhmm: str, end_hhmm: str) -> bool:
    """Check current local time (server) is within HH:MM..HH:MM window. Wrap-around OK."""
    if not start_hhmm or not end_hhmm: return True
    try:
        now = datetime.now()
        cur = now.hour * 60 + now.minute
        sh, sm = [int(x) for x in start_hhmm.split(":")]
        eh, em = [int(x) for x in end_hhmm.split(":")]
        s = sh * 60 + sm; e = eh * 60 + em
        if s == e: return True
        if s < e:  return s <= cur <= e
        return cur >= s or cur <= e   # wrap around midnight
    except: return True

def check_circuit_breakers(cfg: dict, b5: dict) -> tuple[bool, str]:
    """Return (allowed_to_enter, reason). Reason empty if allowed."""
    if cfg.get("daily_sl_usd", 0) > 0 and S.daily_pnl <= -float(cfg["daily_sl_usd"]):
        return False, f"DAILY_SL hit: ${S.daily_pnl:.2f} ≤ -${cfg['daily_sl_usd']}"
    if cfg.get("daily_tp_usd", 0) > 0 and S.daily_pnl >= float(cfg["daily_tp_usd"]):
        return False, f"DAILY_TP hit: ${S.daily_pnl:.2f} ≥ ${cfg['daily_tp_usd']}"
    if cfg.get("max_loss_strike", 0) > 0 and S.loss_streak >= int(cfg["max_loss_strike"]):
        return False, f"LOSS_STRIKE hit: {S.loss_streak}L ≥ {int(cfg['max_loss_strike'])}"
    if cfg.get("max_win_strike", 0) > 0 and S.win_streak >= int(cfg["max_win_strike"]):
        return False, f"WIN_STRIKE hit: {S.win_streak}W ≥ {int(cfg['max_win_strike'])}"
    if not _in_trading_hours(cfg.get("trading_start", "00:00"), cfg.get("trading_end", "23:59")):
        return False, f"OUT_OF_HOURS: {cfg.get('trading_start')}-{cfg.get('trading_end')}"
    # Price window: check YES token price (from orderbook mid_yes) in cents
    p_min = int(cfg.get("price_min_cents", 0) or 0)
    p_max = int(cfg.get("price_max_cents", 100) or 100)
    if p_min > 0 or p_max < 100:
        yes_c = int(round((S.orderbook.get("mid_yes", 0) or 0) * 100))
        if yes_c > 0 and not (p_min <= yes_c <= p_max):
            return False, f"PRICE_OUT_RANGE: YES={yes_c}¢ not in [{p_min},{p_max}]"
    # Sentiment: BTC delta% (current vs window open) in range
    s_lo = float(cfg.get("sentiment_lower", 0) or 0)
    s_hi = float(cfg.get("sentiment_upper", 0) or 0)
    if not (s_lo == 0 and s_hi == 0):
        delta = b5.get("delta_pct", 0) if isinstance(b5, dict) else 0
        if b5.get("win_open", 0) > 0:
            d = (b5["btc_price"] - b5["win_open"]) / b5["win_open"] * 100
            if not (s_lo <= d <= s_hi):
                return False, f"SENTIMENT_OUT: BTC delta {d:.3f}% not in [{s_lo},{s_hi}]"
    return True, ""

def auto_pause_if_breaker(reason: str):
    """Pause bot + log + broadcast once per unique reason. Idempotent."""
    global _breaker_paused_reason
    if not S.running or reason == _breaker_paused_reason: return
    S.running = False
    _breaker_paused_reason = reason
    entry = add_log("BREAKER_PAUSE", {"reason": reason, "message": f"Auto-paused: {reason}"})
    asyncio.create_task(broadcast({"type": "stats", "data": get_stats()}))
    asyncio.create_task(broadcast({"type": "log",   "data": entry}))
    save_state()

# ─── ORDER RETRY: FOK → GTL fallback ─────────────────────────
def _build_clob_client() -> "ClobClient | None":
    """SAFE (Gnosis Safe) client for all operations (balance, orders, trading)."""
    if not CLOB_OK: return None
    if not C.poly_private_key or not C.poly_api_key: return None
    try:
        pk = C.poly_private_key.strip()
        if not pk.startswith("0x"): pk = "0x" + pk
        client = ClobClient(host=CLOB, chain_id=POLYGON, key=pk,
                           signature_type=2,
                           funder=C.poly_funder or None)
        client.set_api_creds(ApiCreds(
            api_key=C.poly_api_key, api_secret=C.poly_secret,
            api_passphrase=C.poly_passphrase,
        ))
        return client
    except Exception as e:
        S.errors.append(f"[clob_init] {str(e)[:60]}")
        return None


async def place_order_with_retry(
    market_id: str, outcome: str, price: float, size: float, sess,
    clob_token_id: str = ""
) -> dict:
    """
    Place order with fallback chain:
    1. FOK (Fill-or-Kill) market order
    2. If FOK fails → GTL (Good-Till-Limit) limit order @ $0.95
    3. If GTL fails → MISSED_TRADE

    clob_token_id: ERC-1155 token ID from Gamma clobTokenIds field.
                   Required by py-clob-client — distinct from Gamma market_id.
    """
    if MODE == "sim":
        # Simulation: 90% FOK success, 9% GTL fallback, 1% missed
        r = random.random()
        if r < 0.90:
            return {"ok": True, "type": "FOK", "order_id": f"sim-fok-{int(time.time())}"}
        elif r < 0.99:
            add_log("ORDER_GTL_FALLBACK", {
                "market_id": market_id, "outcome": outcome,
                "message": "FOK failed — retrying with GTL @ $0.95"
            })
            return {"ok": True, "type": "GTL", "order_id": f"sim-gtl-{int(time.time())}"}
        else:
            add_log("MISSED_TRADE", {
                "market_id": market_id, "outcome": outcome,
                "message": "Both FOK and GTL failed — trade missed"
            })
            return {"ok": False, "type": "MISSED", "order_id": ""}

    # ── Real mode: direct py-clob-client-v2 SAFE execution ───
    if not clob_token_id:
        print(f"[{_ts()}][BOT] ⚠ ENTRY SKIP — no clob_token_id")
        return {"ok": False, "type": "MISSED", "order_id": ""}

    def _post_order(token_id, price, size, order_type):
        client = _build_clob_client()
        if client is None:
            return {"ok": False, "error": "CLOB client init failed"}
        price = round(price, 2)  # 2 decimal precision for CLOB
        size  = round(size, 2)
        if order_type == OrderType.GTD:
            size = max(size, 5.0)  # GTD min 5 shares
        args_kw = {"token_id": token_id, "price": price, "size": size, "side": "BUY",
                   "builder_code": C.builder_code}
        # GTD orders need future expiration (+1 hour)
        if order_type == OrderType.GTD:
            args_kw["expiration"] = int(time.time()) + 3600
        args = OrderArgs(**args_kw)
        try:
            signed = client.create_order(args)
            return client.post_order(signed, order_type)
        except Exception as e:
            return {"ok": False, "error": str(e)[:120]}

    # ── SAFE (GTL primary — FOK has decimal bug in py-clob-client-v2) ──
    print(f"[{_ts()}][ORDER] 🔄 GTL {outcome} ${size:.2f}@{int(price*100)}¢ token={clob_token_id[:16]}…")
    t0 = time.time()
    gtl_size = max(size, 5.0)  # GTD min 5 shares
    resp = await asyncio.get_event_loop().run_in_executor(None, _post_order, clob_token_id, price, gtl_size, OrderType.GTD)
    lat_ms = int((time.time() - t0) * 1000)
    order_id = resp.get("orderID") or resp.get("id") or ""
    if order_id:
        status = resp.get("status", "?")
        # Track actual fill amounts
        actual_spent  = float(resp.get("makingAmount", 0) or 0) / 1e6
        actual_shares = float(resp.get("takingAmount", 0) or 0) / 1e6
        if actual_spent > 0:
            actual_price = actual_spent / actual_shares if actual_shares > 0 else price
            actual_size  = actual_spent
        else:
            actual_price = price
            actual_size  = size
        print(f"[{_ts()}][ORDER] ✅ GTL {status} {outcome} ${actual_size:.2f}@{int(actual_price*100)}¢ "
              f"order={order_id[:16]}… lat={lat_ms}ms")
        add_log("ORDER_OK", {"order_id": order_id, "size": actual_size, "price": actual_price,
                             "latency_ms": lat_ms, "type": "GTL", "status": status})
        return {"ok": True, "type": "GTL", "order_id": order_id, "actual_price": actual_price, "actual_size": actual_size}
    else:
        err_str = resp.get("error", str(resp))[:120]
        print(f"[{_ts()}][ORDER] ❌ GTL ERROR lat={lat_ms}ms — {err_str}")
        add_log("ORDER_FAIL", {"error": err_str, "latency_ms": lat_ms})

    # ── MISSED ────────────────────────────────────────────────
    print(f"[{_ts()}][ORDER] 💀 MISSED TRADE — GTL failed for {outcome} ${size:.2f}")
    add_log("MISSED_TRADE", {
        "market_id": market_id, "outcome": outcome,
        "message": "GTL order failed",
    })
    return {"ok": False, "type": "MISSED", "order_id": ""}

# ─── COMPOUND / SALARY ────────────────────────────────────────
def check_compound_levelup():
    eq = equity()
    old_bet = compound_bet(eq - 0.01)
    new_bet = compound_bet(eq)
    if new_bet > old_bet:
        ev = {"time": now_str(), "equity": round(eq, 4), "new_bet": new_bet, "old_bet": old_bet}
        S.compound_events.append(ev)
        add_log("COMPOUND_UP", {"new_bet": new_bet, "old_bet": old_bet, "equity": round(eq, 4)})
        return True
    return False

def check_salary():
    # ⚠ AUTO-WITHDRAWAL DISABLED — manual withdrawal only
    # Uncomment lines below to re-enable auto-withdrawal feature
    eq = equity()
    if eq < S.salary_target: return False
    withdrawn = round(eq * C.salary_withdraw_pct, 4)
    keep      = round(eq * C.salary_keep_pct, 4)
    ev = {"time": now_str(), "equity": round(eq, 4), "withdrawn": withdrawn, "kept": keep,
          "next_target": S.salary_target + C.salary_threshold}
    # S.salary_events.append(ev)
    # S.total_withdrawn = round(S.total_withdrawn + withdrawn, 4)
    # S.capital = keep; S.locked = 0.0
    # S.salary_target += C.salary_threshold
    # add_log("SALARY", {"equity": round(eq, 4), "withdrawn": withdrawn, "kept": keep,
    #                    "next_target": S.salary_target})
    # save_state()
    # return True
    return False

# ─── BTC 5M SIGNAL ENGINE (7 indicators, weighted) ───────────
def btc5m_window_ts(now_ts=0) -> int:
    ts = now_ts or int(datetime.now(timezone.utc).timestamp())
    return ts - (ts % BTC5M_WIN)

def btc5m_slug(ts: int) -> str:
    return f"btc-updown-5m-{ts}"

def btc5m_secs_left(now_ts=0) -> int:
    ts  = now_ts or int(datetime.now(timezone.utc).timestamp())
    end = btc5m_window_ts(ts) + BTC5M_WIN
    return max(0, end - ts)

def _build_synthetic_klines(limit: int = 30) -> list:
    """Build synthetic 1-minute OHLC candles from accumulated price samples."""
    if len(_price_samples) < 2:
        return []
    candles = []
    bucket: list = []
    bucket_ts = (_price_samples[0][0] // 60) * 60
    for ts, price in _price_samples:
        b = (ts // 60) * 60
        if b != bucket_ts:
            if bucket:
                prices = [p for _, p in bucket]
                candles.append({"ts": bucket_ts, "open": prices[0], "high": max(prices),
                                 "low": min(prices), "close": prices[-1], "volume": 0.0})
            bucket = [(ts, price)]
            bucket_ts = b
        else:
            bucket.append((ts, price))
    if bucket:
        prices = [p for _, p in bucket]
        candles.append({"ts": bucket_ts, "open": prices[0], "high": max(prices),
                         "low": min(prices), "close": prices[-1], "volume": 0.0})
    return candles[-limit:] if len(candles) > limit else candles

async def btc5m_fetch_klines(sess, limit=120) -> list:
    # Try all Binance mirrors first
    for bn in BINANCE_MIRRORS:
        try:
            async with sess.get(f"{bn}/klines", params={
                "symbol": "BTCUSDT", "interval": "1m", "limit": limit
            }, headers=_CLOB_UA) as r:
                if r.status == 200:
                    data = await r.json()
                    if data:
                        return [{"ts": int(k[0])//1000, "open": float(k[1]), "high": float(k[2]),
                                 "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])} for k in data]
        except: pass
    # Fallback: CryptoCompare
    try:
        async with sess.get(f"{CRYPTOCOMPARE}/v2/histominute", params={
            "fsym": "BTC", "tsym": "USD", "limit": limit
        }) as r:
            if r.status == 200:
                data = await r.json()
                rows = data.get("Data", {}).get("Data", [])
                if rows and data.get("Response") != "Error":
                    return [{"ts": int(k["time"]), "open": float(k["open"]), "high": float(k["high"]),
                             "low": float(k["low"]), "close": float(k["close"]), "volume": float(k["volumefrom"])} for k in rows]
    except: pass
    # Final fallback: synthetic klines from accumulated price samples
    return _build_synthetic_klines(limit)

async def btc5m_fetch_price(sess) -> float:
    # Try all Binance mirrors first
    for bn in BINANCE_MIRRORS:
        try:
            async with sess.get(f"{bn}/ticker/price", params={"symbol": "BTCUSDT"},
                                headers=_CLOB_UA) as r:
                if r.status == 200:
                    price = float((await r.json()).get("price", 0))
                    if price > 0:
                        return price
        except: pass
    # Fallback: CoinGecko
    try:
        async with sess.get(f"{COINGECKO}/simple/price", params={"ids": "bitcoin", "vs_currencies": "usd"}) as r:
            if r.status == 200:
                price = (await r.json()).get("bitcoin", {}).get("usd", 0)
                if price > 0:
                    return float(price)
    except: pass
    # Fallback: CryptoCompare
    try:
        async with sess.get(f"{CRYPTOCOMPARE}/price", params={"fsym": "BTC", "tsyms": "USD"}) as r:
            if r.status == 200:
                price = (await r.json()).get("USD", 0)
                if price > 0:
                    return float(price)
    except: pass
    return 0.0

async def btc5m_fetch_market(slug: str, sess) -> Optional[dict]:
    try:
        async with sess.get(f"{GAMMA}/events", params={"slug": slug, "limit": 1}) as r:
            if r.status == 200:
                data = await r.json()
                evs = data if isinstance(data, list) else []
                if evs:
                    for m in evs[0].get("markets", []):
                        outs = m.get("outcomes", "[]")
                        if isinstance(outs, str):
                            try: outs = json.loads(outs)
                            except: outs = []
                        if any(str(o).lower() in ("up", "down") for o in outs):
                            # Parse clobTokenIds — list of CLOB token IDs aligned to outcomes[]
                            # e.g. outcomes=["Up","Down"], clobTokenIds=["<up_token>","<down_token>"]
                            raw_ids = m.get("clobTokenIds", "[]")
                            if isinstance(raw_ids, str):
                                try: raw_ids = json.loads(raw_ids)
                                except: raw_ids = []
                            token_map: dict = {}
                            for idx, o in enumerate(outs):
                                if idx < len(raw_ids) and raw_ids[idx]:
                                    token_map[str(o).lower()] = str(raw_ids[idx])
                            m["_clob_token_map"] = token_map  # {"up": "<id>", "down": "<id>"}
                            return m
                    if evs[0].get("markets"):
                        return evs[0]["markets"][0]
    except: pass
    return None

def btc5m_analyze(klines: list, price: float, win_open: float, ticks: list) -> dict:
    """
    7-indicator weighted signal (from Archetapp guide, adapted):
    1. Window Delta      5-7  ← dominant
    2. Micro Momentum    2
    3. Acceleration      1.5
    4. EMA 9/21          1
    5. RSI 14            1-2
    6. Volume Surge      1
    7. Tick Trend        2
    """
    if len(klines) < 5 or price <= 0:
        return {"dir": "", "confidence": 0, "score": 0, "indicators": {}}

    closes  = [k["close"]  for k in klines]
    volumes = [k["volume"] for k in klines]

    score = 0.0
    ind   = {}

    # 1. Window Delta — most important
    if win_open > 0:
        delta_pct = (price - win_open) / win_open * 100
        if   abs(delta_pct) > 0.10: w = 7
        elif abs(delta_pct) > 0.02: w = 5
        elif abs(delta_pct) > 0.005: w = 3
        elif abs(delta_pct) > 0.001: w = 1
        else: w = 0
        s1 = w if delta_pct > 0 else -w
        score += s1
        ind["win_delta"] = {"pct": round(delta_pct, 4), "score": s1}

    # 2. Micro Momentum — last 2 candles
    if len(closes) >= 3:
        m1 = closes[-1] - closes[-2]
        m2 = closes[-2] - closes[-3]
        s2 = 2 if m1 > 0 and m2 > 0 else (-2 if m1 < 0 and m2 < 0 else 0)
        score += s2
        ind["micro_mom"] = {"score": s2}

    # 3. Acceleration
    if len(closes) >= 3:
        c1  = closes[-1] - closes[-2]
        c2  = closes[-2] - closes[-3]
        acc = c1 - c2
        s3  = 1.5 if acc > 0 else (-1.5 if acc < 0 else 0)
        score += s3
        ind["acceleration"] = {"score": round(s3, 1)}

    # 4. EMA 9/21
    def ema(data, n):
        k = 2/(n+1); r = [data[0]]
        for p in data[1:]: r.append(p*k + r[-1]*(1-k))
        return r
    if len(closes) >= 21:
        e9 = ema(closes, 9); e21 = ema(closes, 21)
        s4 = 1 if e9[-1] > e21[-1] else -1
        score += s4
        ind["ema_9_21"] = {"ema9": round(e9[-1], 2), "ema21": round(e21[-1], 2), "score": s4}

    # 5. RSI 14
    if len(closes) >= 15:
        gains, losses = [], []
        for i in range(1, 15):
            d = closes[-15+i] - closes[-15+i-1]
            gains.append(max(d, 0)); losses.append(max(-d, 0))
        ag = sum(gains)/14; al = sum(losses)/14 if sum(losses) else 1e-9
        rsi = 100 - (100/(1+ag/al))
        w5  = 2 if rsi > 75 or rsi < 25 else 1
        s5  = -w5 if rsi > 75 else (w5 if rsi < 25 else 0)
        score += s5
        ind["rsi14"] = {"rsi": round(rsi, 1), "score": s5}

    # 6. Volume Surge
    if len(volumes) >= 6:
        recent = sum(volumes[-3:]) / 3
        prior  = sum(volumes[-6:-3]) / 3
        surge  = recent > prior * 1.5
        if surge:
            last_dir = closes[-1] - closes[-4] if len(closes) >= 4 else 0
            s6 = 1 if last_dir > 0 else -1
        else: s6 = 0
        score += s6
        ind["volume"] = {"surge": surge, "score": s6}

    # 7. Tick Trend (real-time sub-1m)
    if len(ticks) >= 5:
        ups   = sum(1 for i in range(1, len(ticks)) if ticks[i] > ticks[i-1])
        downs = len(ticks) - 1 - ups
        total = ups + downs
        if total > 0:
            bias = ups/total
            move = abs(ticks[-1] - ticks[0]) / ticks[0] * 100
            if bias >= 0.6 and move > 0.005:
                s7 = 2
            elif bias <= 0.4 and move > 0.005:
                s7 = -2
            else:
                s7 = 0
        else: s7 = 0
        score += s7
        ind["tick_trend"] = {"ups": ups, "downs": downs, "score": s7}

    # Confidence = min(|score|/7, 1.0)
    confidence = min(abs(score) / 7.0, 1.0)
    direction  = "UP" if score > 0 else ("DOWN" if score < 0 else "")
    if confidence < 0.25:   # min 25% confidence to act
        direction = ""

    return {
        "dir":        direction,
        "confidence": round(confidence, 3),
        "score":      round(score, 2),
        "indicators": ind,
    }

async def btc5m_entry(sig: dict, secs_left: int, sess):
    """Try to build a position from BTC5m signal"""
    b5  = S.btc5m
    mkt = b5["market_data"]
    if not mkt:
        print(f"[{_ts()}][BOT] ⚠ ENTRY SKIP — no market_data for {b5.get('slug','?')}")
        return

    outs   = mkt.get("outcomes", "[]"); prices = mkt.get("outcomePrices", "[]")
    if isinstance(outs, str):
        try: outs   = json.loads(outs)
        except: outs = []
    if isinstance(prices, str):
        try: prices = json.loads(prices)
        except: prices = []
    if not outs or not prices or len(outs) != len(prices):
        print(f"[{_ts()}][BOT] ⚠ ENTRY SKIP — bad market outcomes/prices: outs={outs} prices={prices}")
        return

    tgt_price = None
    clob_token_id: str = ""
    token_map = mkt.get("_clob_token_map", {})
    for i, o in enumerate(outs):
        ol = str(o).lower()
        if sig["dir"] == "UP"   and ol in ("up", "yes"):
            tgt_price = float(prices[i])
            clob_token_id = token_map.get("up") or token_map.get("yes") or ""
        if sig["dir"] == "DOWN" and ol in ("down", "no"):
            tgt_price = float(prices[i])
            clob_token_id = token_map.get("down") or token_map.get("no") or ""

    if tgt_price is None or not (0.15 < tgt_price < 0.85):
        print(f"[{_ts()}][BOT] ⚠ ENTRY SKIP — price out of range: tgt_price={tgt_price} dir={sig['dir']}")
        return

    true_prob = min(0.92, sig["confidence"])
    ev_val    = (true_prob*(1-tgt_price)) - ((1-true_prob)*tgt_price)
    min_ev    = getattr(C, "min_ev", 0.01)
    if ev_val < min_ev:
        print(f"[{_ts()}][BOT] ⚠ ENTRY SKIP — EV {ev_val:+.4f} < min {min_ev:.2f} "
              f"| conf={sig['confidence']:.2f} price={int(tgt_price*100)}¢ dir={sig['dir']} "
              f"trueProb={true_prob:.2f}")
        return

    mkt_dict = {
        "id":             mkt.get("id", b5["slug"]),
        "condition_id":   mkt.get("conditionId", ""),  # CLOB hex ID for redeem/resolution
        "clob_token_id":  clob_token_id,   # ERC-1155 token ID required by CLOB API
        "question":       mkt.get("question", f"BTC 5m {b5['slug']}")[:80],
        "category":       "btc5m",
        "yes_price":      tgt_price,
        "no_price":       1-tgt_price,
        "volume":         float(mkt.get("volume", 0) or 0),
        "volume_24h":     float(mkt.get("volume24hr", 0) or 0),
        "end_date":       "",
        "resolve_sec":    secs_left,
        "resolve_fmt":    f"{secs_left}s",
        "spread":         0,
        # Snapshot BTC reference prices for accurate dry_run resolve at window end
        "win_open_btc":   float(b5.get("win_open", 0) or 0),
        "win_ts":         int(b5.get("win_ts", 0) or 0),
    }
    sig_dict = {
        "strategy":   "btc5m",
        "outcome":    sig["dir"],
        "ev":         round(ev_val, 4),
        "true_prob":  round(true_prob, 4),
        "price":      round(tgt_price, 4),
        "confidence": sig["confidence"],
    }
    await open_position(mkt_dict, sig_dict)
    b5["entry_fired"]  = True
    b5["stats"]["total"] = b5["stats"].get("total", 0) + 1

async def btc5m_loop():
    """
    Dedicated BTC5m loop — polls every 2s (Sprint 1 upgrade from 8s).
    Entry zone: T-10s to T-5s (Sprint 1 upgrade from T-30s).
    Spike detection: score jump ≥1.5 → fire immediately.
    Hard deadline: T-5s → force entry if not yet fired.
    """
    print(f"[{_ts()}][BTC5m] loop started — poll 2s, entry T-10s→T-5s, spike detect ON")
    b5 = S.btc5m

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as sess:
        while True:
            try:
                now_ts    = int(datetime.now(timezone.utc).timestamp())
                win_ts    = btc5m_window_ts(now_ts)
                secs_left = btc5m_secs_left(now_ts)
                slug      = btc5m_slug(win_ts)

                # New window reset
                if win_ts != b5["win_ts"]:
                    b5["win_ts"]                  = win_ts
                    b5["slug"]                    = slug
                    b5["entry_fired"]             = False
                    b5["predicted_dir"]           = ""
                    b5["confidence"]              = 0.0
                    b5["score"]                   = 0.0
                    b5["market_data"]             = {}
                    b5["last_market_fetch"]       = 0  # force immediate fetch on new window
                    b5["ticks"]                   = []
                    b5["win_open"]                = 0.0
                    b5["prev_score"]              = 0.0
                    b5["highest_confidence_seen"] = 0.0
                    # Log flags — reset each window
                    b5["_mkt_logged"]   = False
                    b5["_zone_logged"]  = False
                    b5["_status_ts"]    = 0
                    print(f"[{_ts()}][BTC5m] ══ NEW WINDOW {slug} | {secs_left}s left ══")

                # Always fetch live price
                price = await btc5m_fetch_price(sess)
                if price > 0:
                    b5["btc_price"] = round(price, 2)
                    b5["ticks"].append(price)
                    if len(b5["ticks"]) > 30: b5["ticks"] = b5["ticks"][-30:]
                    b5["last_tick"] = price
                    # Accumulate into global price sample buffer for synthetic klines
                    _price_samples.append([now_ts, price])
                    if len(_price_samples) > 1800: del _price_samples[:-1800]  # keep 60 min

                # Fetch klines every 55s
                if now_ts - b5["last_kline_fetch"] >= 55 or not b5["klines"]:
                    kl = await btc5m_fetch_klines(sess, 120)
                    if kl:
                        b5["klines"] = kl
                        for k in reversed(kl):
                            if k["ts"] <= win_ts:
                                b5["win_open"] = k["close"]
                                break
                    b5["last_kline_fetch"] = now_ts

                # Fetch market data every 55s or new window
                had_market = bool(b5["market_data"])
                if now_ts - b5["last_market_fetch"] >= 55 or not b5["market_data"]:
                    mkt = await btc5m_fetch_market(slug, sess)
                    if mkt: b5["market_data"] = mkt
                    b5["last_market_fetch"] = now_ts

                # Log market discovery (once per window)
                if not b5.get("_mkt_logged"):
                    if b5["market_data"]:
                        mkt = b5["market_data"]
                        raw_prices = mkt.get("outcomePrices", "[]")
                        if isinstance(raw_prices, str):
                            try: raw_prices = json.loads(raw_prices)
                            except: raw_prices = []
                        yes_p = float(raw_prices[0]) if len(raw_prices) > 0 else 0
                        no_p  = float(raw_prices[1]) if len(raw_prices) > 1 else 0
                        q     = mkt.get("question", "")[:65]
                        print(f"[{_ts()}][BTC5m] Market FOUND  | YES={yes_p:.2f} NO={no_p:.2f} | {q}")
                        b5["_mkt_logged"] = True
                    elif secs_left < 240:
                        print(f"[{_ts()}][BTC5m] Market NOT FOUND on Gamma — bot akan skip window ini jika tidak ditemukan")
                        b5["_mkt_logged"] = True

                # Always compute signal
                sig = btc5m_analyze(b5["klines"], b5["btc_price"], b5["win_open"], b5["ticks"])
                b5["predicted_dir"] = sig["dir"]
                b5["confidence"]    = sig["confidence"]
                b5["score"]         = sig["score"]
                b5["indicators"]    = sig["indicators"]

                # Update sprint 1 tracking
                prev_score                    = b5.get("prev_score", 0.0)
                b5["highest_confidence_seen"] = max(
                    b5.get("highest_confidence_seen", 0.0), sig["confidence"]
                )

                # Entry zone: T-10s to T-5s (Sprint 1: was T-30s)
                b5["secs_left"]     = secs_left
                b5["in_entry_zone"] = 5 <= secs_left <= 10

                # Spike detection: score jumped ≥1.5 → fire immediately regardless zone
                spike_detected = (sig["score"] - prev_score) >= 1.5 and sig["dir"]

                # Hard deadline: T-5s or below → force entry regardless confidence
                hard_deadline = secs_left <= 5 and sig["dir"]

                cfg = S.strategy_config
                conf_min = float(cfg.get("conf_threshold", 0.25) or 0.25)

                # Circuit breakers — auto-pause bot kalau hit hard limit (daily SL/TP, streak)
                breaker_ok, breaker_reason = check_circuit_breakers(cfg, b5)
                hard_breakers = ("DAILY_SL", "DAILY_TP", "LOSS_STRIKE", "WIN_STRIKE")
                if not breaker_ok and any(breaker_reason.startswith(p) for p in hard_breakers):
                    auto_pause_if_breaker(breaker_reason)

                # ── Terminal status logs ──────────────────────────────
                dir_str  = sig["dir"] if sig["dir"] else "FLAT"
                conf_str = f"conf={sig['confidence']:.2f}"
                scr_str  = f"score={sig['score']:+.1f}"
                mkt_tag  = "mkt✓" if b5["market_data"] else "mkt✗"
                btc_str  = f"BTC ${b5['btc_price']:,.0f}" if b5["btc_price"] > 0 else "BTC $?"

                # Spike alert — log immediately regardless zone
                if spike_detected and not b5["entry_fired"]:
                    print(f"[{_ts()}][BTC5m] ⚡ SPIKE T-{secs_left}s | {btc_str} | {dir_str} {conf_str} {scr_str} | delta={sig['score']-prev_score:+.1f}")

                # Periodic status log every 60s (not in zone, not fired)
                if (not b5["in_entry_zone"] and not b5["entry_fired"]
                        and now_ts - b5.get("_status_ts", 0) >= 60):
                    wait_str = "waiting entry zone" if S.running else "bot PAUSED"
                    brk_str  = f"⛔ {breaker_reason[:35]}" if not breaker_ok else ""
                    print(f"[{_ts()}][BTC5m]  T-{secs_left:3d}s | {btc_str} | {dir_str} {conf_str} {scr_str} | {mkt_tag} {wait_str} {brk_str}".rstrip())
                    b5["_status_ts"] = now_ts

                # Entry zone entered (log once)
                if b5["in_entry_zone"] and not b5.get("_zone_logged") and not b5["entry_fired"]:
                    print(f"[{_ts()}][BTC5m] ─── ZONE T-{secs_left}s | {btc_str} | {dir_str} {conf_str} {scr_str} | {mkt_tag} ───")
                    b5["_zone_logged"] = True

                should_fire = (
                    not b5["entry_fired"]
                    and sig["dir"]
                    and S.running
                    and not S.gas_paused
                    and cfg.get("trading_active", True)
                    and breaker_ok
                    and sig["confidence"] >= conf_min
                    and b5["market_data"]  # require market_data loaded before firing
                    and (b5["in_entry_zone"] or spike_detected or hard_deadline)
                )

                if should_fire:
                    b5["entry_fired"] = True  # atomic set BEFORE await — prevents multi-fire on spike
                    fire_reason = (
                        "spike" if spike_detected else
                        "deadline" if hard_deadline else
                        "zone"
                    )
                    print(f"[{_ts()}][BTC5m] 🎯 SIGNAL [{fire_reason}] {sig['dir']} {conf_str} {scr_str} secs={secs_left} → opening bet...")
                    await btc5m_entry(sig, secs_left, sess)
                elif (b5["in_entry_zone"] or hard_deadline) and not b5["entry_fired"]:
                    # In zone but not firing — log why (once at deadline)
                    if hard_deadline:
                        reasons = []
                        if not sig["dir"]:           reasons.append("FLAT(no direction)")
                        elif sig["confidence"] < conf_min: reasons.append(f"conf {sig['confidence']:.2f} < min {conf_min:.2f}")
                        if not b5["market_data"]:    reasons.append("market not found")
                        if not breaker_ok:           reasons.append(f"breaker:{breaker_reason[:30]}")
                        if not S.running:            reasons.append("bot stopped")
                        if S.gas_paused:             reasons.append("gas paused")
                        print(f"[{_ts()}][BTC5m] ⏭  SKIP window | {' | '.join(reasons) or 'already fired'}")

                # Update prev_score after entry decision
                b5["prev_score"] = sig["score"]

                await broadcast({"type": "btc5m", "data": get_btc5m_info()})

            except Exception as e:
                S.errors.append(f"[BTC5m] {str(e)[:60]}")

            # Sprint 1: poll every 2s (was 8s) for tighter entry timing
            await asyncio.sleep(2)

def get_btc5m_info():
    b5 = S.btc5m
    klines_count = len(b5["klines"])
    signal_ready = klines_count >= 5 and b5["btc_price"] > 0
    return {
        "slug":                   b5["slug"],
        "win_ts":                 b5["win_ts"],
        "secs_left":              b5["secs_left"],
        "btc_price":              b5["btc_price"],
        "win_open":               b5["win_open"],
        "delta_pct":              round((b5["btc_price"]-b5["win_open"])/b5["win_open"]*100, 4) if b5["win_open"] > 0 else 0,
        "predicted_dir":          b5["predicted_dir"],
        "confidence":             b5["confidence"],
        "score":                  b5["score"],
        "prev_score":             b5.get("prev_score", 0.0),
        "highest_confidence_seen": b5.get("highest_confidence_seen", 0.0),
        "entry_fired":            b5["entry_fired"],
        "in_entry_zone":          b5["in_entry_zone"],
        "indicators":             b5["indicators"],
        "stats":                  b5["stats"],
        "klines":                 b5["klines"][-120:],  # last 120 for chart (2h history, pannable)
        "klines_count":           klines_count,
        "signal_ready":           signal_ready,
        "market_found":           bool(b5["market_data"]),
        "poll_interval":          "2s",
        "entry_window":           "T-10s→T-5s",
    }

# ─── CLOB ORDERBOOK (Polypox Terminal) ───────────────────────
_CLOB_UA = {"User-Agent": "Mozilla/5.0 polypox", "Accept": "application/json"}

def _normalize_book(raw: dict) -> dict:
    """CLOB returns bids/asks ascending by price. Normalize to floats and sort:
    - asks: ascending (best ask first = lowest price)
    - bids: descending (best bid first = highest price)
    Cap at 20 levels per side for transport efficiency."""
    def lvl(rows, reverse):
        out = []
        for r in rows:
            try:
                p = float(r.get("price", 0)); s = float(r.get("size", 0))
                if p > 0 and s > 0: out.append({"price": p, "size": s})
            except: pass
        out.sort(key=lambda x: x["price"], reverse=reverse)
        return out[:20]
    return {"asks": lvl(raw.get("asks", []), reverse=False),
            "bids": lvl(raw.get("bids", []), reverse=True)}

async def fetch_clob_book(token_id: str, sess: aiohttp.ClientSession) -> dict:
    if not token_id: return {"asks": [], "bids": []}
    try:
        async with sess.get(f"{CLOB}/book", params={"token_id": token_id},
                             headers=_CLOB_UA, timeout=aiohttp.ClientTimeout(total=5)) as r:
            if r.status == 200:
                return _normalize_book(await r.json())
    except: pass
    return {"asks": [], "bids": []}

def get_orderbook_snapshot() -> dict:
    ob = S.orderbook
    return {
        "slug":      ob["slug"],
        "ts":        ob["ts"],
        "yes_token": ob["yes_token"][:18] + "..." if ob["yes_token"] else "",
        "no_token":  ob["no_token"][:18] + "..."  if ob["no_token"]  else "",
        "yes":       ob["yes"],
        "no":        ob["no"],
        "mid_yes":   ob["mid_yes"],
        "mid_no":    ob["mid_no"],
        "comb":      ob["comb"],
    }

async def orderbook_loop():
    """Poll Polymarket CLOB orderbook for active BTC5m window every 2s.
    Public endpoint, no auth. Broadcasts via WS msg type 'orderbook'."""
    print("[Orderbook] loop started — poll 2s (public CLOB)")
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as sess:
        while True:
            try:
                mkt = S.btc5m.get("market_data") or {}
                token_map = mkt.get("_clob_token_map") or {}
                yes_tok = token_map.get("up", "")
                no_tok  = token_map.get("down", "")
                if yes_tok and no_tok:
                    yes_book, no_book = await asyncio.gather(
                        fetch_clob_book(yes_tok, sess),
                        fetch_clob_book(no_tok,  sess),
                    )
                    # Best ask & bid → mid price per side
                    def mid(book):
                        a = book["asks"][0]["price"] if book["asks"] else 0
                        b = book["bids"][0]["price"] if book["bids"] else 0
                        return round((a + b) / 2, 4) if (a and b) else round(a or b, 4)
                    my, mn = mid(yes_book), mid(no_book)
                    S.orderbook.update({
                        "slug":      S.btc5m.get("slug", ""),
                        "ts":        int(datetime.now(timezone.utc).timestamp()),
                        "yes_token": yes_tok,
                        "no_token":  no_tok,
                        "yes":       yes_book,
                        "no":        no_book,
                        "mid_yes":   my,
                        "mid_no":    mn,
                        "comb":      round(my + mn, 4),
                    })
                    await broadcast({"type": "orderbook", "data": get_orderbook_snapshot()})
                else:
                    # No market loaded yet — emit empty so frontend shows skeleton
                    S.orderbook["slug"] = S.btc5m.get("slug", "")
                    S.orderbook["ts"]   = int(datetime.now(timezone.utc).timestamp())
            except Exception as e:
                S.errors.append(f"[Orderbook] {str(e)[:80]}")
            await asyncio.sleep(2)

# ─── (Soccer scanner removed: BTC 5m only) ───────────────────

# ─── POSITION MANAGEMENT ─────────────────────────────────────
def calc_size(price: float) -> float:
    if price <= 0: return 2.0
    eq = equity()
    max_dollars = compound_bet(eq)         # dollars
    max_shares  = max_dollars / price      # convert to shares
    avail_shares = S.capital / price       # shares from available capital
    min_shares = max(2.0, 1.0 / price)     # at least $1 worth (2 shares @ 50¢)
    return round(max(min_shares, min(max_shares, avail_shares * 0.40)), 2)

def risk_ok(mid: str, sig: dict) -> tuple[bool, str]:
    if not S.running:
        return False, "Bot tidak berjalan"
    if S.gas_paused:
        return False, f"Gas stop: {gas_orders_left()} order tersisa"
    if S.daily_pnl <= -C.daily_loss_limit:
        return False, f"Daily loss limit ${C.daily_loss_limit}"
    ops = [p for p in S.positions if p["status"] == "open"]
    if len(ops) >= C.max_open_pos:
        return False, f"Max {C.max_open_pos} posisi"
    if any(p["market_id"] == mid for p in ops):
        return False, "Sudah ada posisi"
    if S.capital < C.min_bet:
        return False, f"Capital ${S.capital:.2f} < min ${C.min_bet}"
    # Sprint 1: balance floor circuit breaker (real mode only)
    if MODE == "real" and S.capital < C.balance_floor:
        return False, f"Balance floor: USDC ${S.capital:.2f} < ${C.balance_floor}"
    return True, "OK"

async def open_position(market: dict, sig: dict):
    async with _lock:
        ok, reason = risk_ok(market["id"], sig)
        if not ok:
            if S.log and S.log[0].get("reason") == reason: return
            print(f"[{_ts()}][BOT] ⛔ BET REJECTED — {reason}")
            add_log("REJECTED", {"reason": reason, "question": market["question"][:45],
                                 "strategy": sig.get("strategy", "")})
            return
        size = calc_size(sig["price"])
        size = min(size, S.capital)
        if size < C.min_bet:
            print(f"[{_ts()}][BOT] ⛔ BET REJECTED — size ${size:.2f} < min ${C.min_bet}")
            return
        S.capital    = round(S.capital - size, 4)
        S.locked     = round(S.locked + size, 4)
        S.pos_counter += 1
        _prefix = {"sim": "S", "dry_run": "D", "real": "R"}.get(MODE, "X")
        pos = {
            "id":           f"{_prefix}-{BOT_ID[-1]}-{S.pos_counter:04d}",
            "market_id":    market["id"],
            "condition_id": market.get("condition_id", ""),  # CLOB hex ID for redeem
            "win_open_btc": market.get("win_open_btc", 0),   # BTC price at window open (for dry_run resolve)
            "win_ts":       market.get("win_ts", 0),
            "question":     market["question"],
            "category":     market["category"],
            "outcome":      sig["outcome"],
            "price":        sig["price"],
            "true_prob":    sig["true_prob"],
            "size":         size,
            "shares":       round(size/sig["price"], 4) if sig["price"] > 0 else 0,
            "ev":           sig["ev"],
            "strategy":     sig["strategy"],
            "confidence":   sig.get("confidence", 0),
            "status":       "open",
            "opened_at":    datetime.now(timezone.utc).isoformat(),
            "resolve_sec":  market.get("resolve_sec", 86400),
            "resolve_fmt":  market.get("resolve_fmt", "?"),
            "compound_bet": compound_bet(equity()),
            "order_id":     "",
            "order_type":   "",
            "mode":         MODE,
        }

        # ── Real mode: place actual CLOB order before recording position ──
        # ── Dry-run mode: pretend-fill at orderbook ask, no CLOB submission ──
        if MODE == "real":
            # Release lock briefly while awaiting network I/O to avoid deadlock;
            # we already reserved capital above so no double-entry risk.
            pass  # lock released below via inner block pattern
        elif MODE == "dry_run":
            pos["order_id"]   = f"DRY-{pos['id']}"
            pos["order_type"] = "dry_run_synthetic"

    # CLOB call is outside _lock to avoid holding the asyncio lock during network I/O.
    # Capital is already reserved; rollback if order fails.
    if MODE == "real":
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as _order_sess:
            order_result = await place_order_with_retry(
                market_id=market["id"],
                outcome=sig["outcome"],
                price=sig["price"],
                size=size,
                sess=_order_sess,
                clob_token_id=market.get("clob_token_id", ""),
            )
        if not order_result["ok"]:
            # Rollback reserved capital — order never reached Polymarket
            async with _lock:
                S.capital  = round(S.capital + size, 4)
                S.locked   = round(S.locked  - size, 4)
                S.pos_counter -= 1
            fail_type = order_result.get("type", "UNKNOWN")
            print(f"[{_ts()}][BOT] ❌ ORDER FAIL [{fail_type}] {sig['outcome']} ${size:.2f} "
                  f"— capital rolled back → ${S.capital:.4f} | {market['question'][:50]}")
            add_log("ORDER_FAIL", {
                "question":  market["question"][:55],
                "outcome":   sig["outcome"],
                "size":      size,
                "order_type": fail_type,
                "message":   f"Order not placed ({fail_type}) — capital rolled back ${size:.2f}",
            })
            await broadcast({"type": "stats", "data": get_stats()})
            return
        # Stamp order metadata onto the position record
        pos["order_id"]   = order_result["order_id"]
        pos["order_type"] = order_result["type"]
        # Use actual fill price/size if available
        if order_result.get("actual_size"):
            pos["size"]   = order_result["actual_size"]
            pos["price"]  = order_result["actual_price"]
            pos["shares"] = round(pos["size"] / pos["price"], 4) if pos["price"] > 0 else 0

    async with _lock:
        if MODE == "real" and pos not in S.positions:
            S.positions.append(pos)
        elif MODE in ("sim", "dry_run"):
            S.positions.append(pos)
        consume_gas()
        entry = add_log("OPEN", {
            "id": pos["id"], "question": pos["question"][:55],
            "outcome": pos["outcome"], "price": pos["price"],
            "size": pos["size"], "ev": pos["ev"],
            "strategy": pos["strategy"], "category": pos["category"],
            "resolve_fmt": pos["resolve_fmt"], "confidence": pos.get("confidence", 0),
            "order_id": pos.get("order_id", ""),
            "order_type": pos.get("order_type", "sim" if MODE == "sim" else ""),
        })
        _mode_tag = {"sim": "SIM", "dry_run": "DRY", "real": "REAL"}.get(MODE, MODE.upper())
        print(f"[{_ts()}][BOT] 📈 BET OPEN [{_mode_tag}] {pos['id']} {pos['outcome']} "
              f"${pos['size']:.2f}@{int(pos['price']*100)}¢ "
              f"EV={pos['ev']:+.3f} conf={pos.get('confidence',0):.2f} resolves={pos['resolve_fmt']}")
    await broadcast({"type": "log", "data": entry})
    await broadcast({"type": "positions", "data": open_pos()})
    await broadcast({"type": "stats", "data": get_stats()})

async def close_position(pos: dict, won: bool):
    async with _lock:
        if pos["status"] != "open": return
        size = pos["size"]; price = pos["price"]
        if won:
            payout = round(size/price, 4); pnl = round(payout-size, 4)
            S.capital = round(S.capital+payout, 4)
            S.locked  = round(S.locked-size, 4)
        else:
            payout = 0.0; pnl = round(-size, 4)
            S.locked = round(S.locked-size, 4)
        pos["status"]     = "won" if won else "lost"
        pos["pnl"]        = pnl
        pos["payout"]     = payout
        pos["exit_price"] = 1.0 if won else 0.0
        pos["closed_at"]  = datetime.now(timezone.utc).isoformat()
        S.daily_pnl    = round(S.daily_pnl+pnl, 4)
        S.lifetime_pnl = round(S.lifetime_pnl+pnl, 4)
        if pos.get("strategy") == "btc5m":
            if won: S.btc5m["stats"]["wins"]   = S.btc5m["stats"].get("wins", 0)+1
            else:   S.btc5m["stats"]["losses"] = S.btc5m["stats"].get("losses", 0)+1
        S.positions.remove(pos); S.closed_trades.append(pos)
        leveled  = check_compound_levelup()
        salaried = check_salary()
        entry = add_log("CLOSE", {
            "id": pos["id"], "result": pos["status"], "pnl": pnl,
            "question": pos["question"][:50], "capital": round(equity(), 4),
            "strategy": pos.get("strategy", ""),
        })
        db_save_trade(pos)
        db_save_daily_loss()   # Sprint 1: persist daily loss
        save_state()
        result_icon = "✅" if won else "❌"
        hold_sec = int((datetime.now(timezone.utc) - datetime.fromisoformat(
            pos.get("opened_at", datetime.now(timezone.utc).isoformat())
        )).total_seconds())
        print(f"[{_ts()}][BOT] {result_icon} BET CLOSE {pos['id']} {pos['outcome']} "
              f"{pos['status'].upper()} pnl={pnl:+.2f} | "
              f"daily={S.daily_pnl:+.2f} capital=${equity():.2f} "
              f"held={hold_sec}s bet=${pos['size']:.2f}@{int(pos['price']*100)}¢ "
              f"ev={pos.get('ev',0):+.3f} conf={pos.get('confidence',0):.2f}")
    await broadcast({"type": "log",      "data": entry})
    if leveled:  await broadcast({"type": "compound_up", "data": S.compound_events[-1]})
    if salaried: await broadcast({"type": "salary",      "data": S.salary_events[-1]})
    await broadcast({"type": "positions", "data": open_pos()})
    await broadcast({"type": "history",   "data": S.closed_trades[-300:][::-1]})
    await broadcast({"type": "stats",     "data": get_stats()})

# ─── GASLESS REDEEM HELPER ──────────────────────────────────
def _build_relayer_client():
    """Build RelayClient for gasless redemption via Polymarket Builder Relayer"""
    try:
        from polymarket_py import RelayClient
        from eth_account import Account

        if not C.relayer_api_key or not C.relayer_api_address:
            return None

        # Create signer from private key
        account = Account.from_key(C.poly_private_key)

        client = RelayClient(
            host=C.relayer_api_host,
            api_key=C.relayer_api_key,
            api_secret=C.relayer_api_address,
            signer=account,
        )
        return client
    except ImportError:
        return None
    except Exception as e:
        S.errors.append(f"[relayer_client_build] {str(e)[:60]}")
        return None

async def _redeem_via_relayer(condition_id: str, outcome: str):
    """Redeem position via Builder Relayer (gasless, Polymarket pays gas)"""
    try:
        from polymarket_py import RelayClient
        from eth_account import Account

        client = _build_relayer_client()
        if not client:
            return None

        # Determine index set: YES=1, NO=2, both=3
        index_set = 1 if outcome.upper() == "UP" else 2

        # Call relayer's redeem function
        # Note: actual implementation depends on polymarket-py API version
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.redeem_positions(
                condition_id=condition_id,
                index_sets=[index_set],
            )
        )
        return result
    except Exception as e:
        S.errors.append(f"[redeem_relayer] {str(e)[:60]}")
        return None

# ─── AUTO-CLAIM / REDEEM (Sprint 2) ──────────────────────────
async def redeem_winning_positions():
    """
    Real mode only: periodically claim/redeem USDC for resolved winning positions.
    Polls Polymarket CLOB API to check resolution status, calls redeem if market is resolved.
    After successful claim → updates capital and broadcasts balance_update.
    Runs every 60 seconds. Sim/dry_run mode skips (resolver_loop handles auto-resolve).
    Self-gates on MODE so runtime mode toggle works.
    """
    # Wait until mode becomes real (supports runtime toggle)
    while MODE != "real":
        await asyncio.sleep(10)
    await asyncio.sleep(30)  # initial grace — let bot warm up first

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as sess:
        while True:
            if MODE != "real":
                await asyncio.sleep(15); continue
            try:
                # Find positions that may have resolved: status=open but opened > resolve_sec ago
                now = datetime.now(timezone.utc)
                candidates = [
                    p for p in list(S.positions)
                    if p["status"] == "open"
                    and (now - datetime.fromisoformat(p["opened_at"])).total_seconds()
                       >= p.get("resolve_sec", 86400)  # check right at resolve time (was 0.90)
                ]

                for pos in candidates:
                    market_id    = pos.get("market_id", "")
                    condition_id = pos.get("condition_id", "") or market_id  # hex CLOB ID
                    if not condition_id:
                        continue

                    # ── 1. Check resolution status from CLOB ─────────────
                    resolved = False
                    winning  = False
                    try:
                        headers = {"POLY-API-KEY": C.poly_api_key} if C.poly_api_key else {}
                        async with sess.get(
                            f"{CLOB}/markets/{condition_id}", headers=headers
                        ) as r:
                            if r.status == 200:
                                mkt_data = await r.json()
                                resolved = mkt_data.get("closed", False) or mkt_data.get("resolved", False)
                                if resolved:
                                    # Determine if our outcome won
                                    outcome_prices = mkt_data.get("outcomePrices", [])
                                    tokens = mkt_data.get("tokens", [])
                                    for tok in tokens:
                                        if tok.get("outcome", "").upper() == pos.get("outcome", "").upper():
                                            # Resolved winning = price settled at 1.0
                                            tok_price = float(tok.get("price", 0))
                                            winning = tok_price >= 0.99
                                            break
                    except Exception as e:
                        S.errors.append(f"[redeem_check] {str(e)[:60]}")
                        continue

                    if not resolved:
                        continue  # market not yet settled

                    if not winning:
                        # Market resolved but we lost — close as lost without CLOB call
                        add_log("RESOLVED_LOST", {
                            "id": pos["id"],
                            "question": pos["question"][:50],
                            "outcome": pos["outcome"],
                            "message": "Market resolved: position lost",
                        })
                        await close_position(pos, False)
                        continue

                    # ── 2. Try gasless redeem via Builder Relayer, fallback to py-clob-client ─────
                    try:
                        result = None
                        redeem_method = "unknown"

                        # Strategy 1: Try Builder Relayer (gasless, Polymarket pays)
                        if C.use_gasless_redeem and C.relayer_api_key:
                            try:
                                result = await _redeem_via_relayer(condition_id, pos["outcome"])
                                if result:
                                    redeem_method = "gasless_relayer"
                                    add_log("REDEEM_ATTEMPT", {
                                        "id": pos["id"],
                                        "method": "Builder Relayer (gasless)",
                                        "message": "Attempting gasless redemption via Polymarket relayer",
                                    })
                            except Exception as e:
                                S.errors.append(f"[redeem_gasless_fallback] {str(e)[:50]}")

                        # Strategy 2: Fallback to py-clob-client if gasless unavailable/failed
                        if not result and CLOB_OK:
                            try:
                                _cond_id = condition_id  # capture for closure
                                def _redeem():
                                    client = _build_clob_client()
                                    if client is None:
                                        return None
                                    return client.redeem_positions(condition_id=_cond_id)
                                result = await asyncio.get_event_loop().run_in_executor(None, _redeem)
                                redeem_method = "py_clob_client"
                                add_log("REDEEM_ATTEMPT", {
                                    "id": pos["id"],
                                    "method": "py-clob-client",
                                    "message": "Redeeming via py-clob-client (has gas cost)",
                                })
                            except Exception as e:
                                S.errors.append(f"[redeem_clob_fallback] {str(e)[:50]}")

                        # If both methods unavailable, skip
                        if not result:
                            if not C.relayer_api_key and not CLOB_OK:
                                add_log("REDEEM_SKIP", {
                                    "id": pos["id"],
                                    "reason": "No redemption method available",
                                    "message": "Install polymarket-py OR configure Builder Relayer credentials",
                                })
                            # Still close position internally so capital is credited
                            await close_position(pos, True)
                            continue

                        claimed_usdc = 0.0
                        if result:
                            claimed_usdc = float(result.get("payout", 0) or result.get("amount", 0) or 0)

                        # Update position with actual fill data from redeem
                        if claimed_usdc > 0:
                            actual_pnl = round(claimed_usdc - pos["size"], 4)
                            pos["payout_actual"] = claimed_usdc
                            pos["shares_actual"] = round(claimed_usdc, 4)

                        # Close position in state
                        await close_position(pos, True)

                        # Override P&L with actual if available
                        if claimed_usdc > 0:
                            async with _lock:
                                for p in S.closed_trades:
                                    if p.get("id") == pos.get("id"):
                                        p["pnl"] = round(claimed_usdc - p["size"], 4)
                                        p["payout"] = claimed_usdc
                                        break
                            continue

                        claimed_usdc = 0.0
                        if result:
                            # Result may contain payout amount
                            claimed_usdc = float(result.get("payout", 0) or result.get("amount", 0) or 0)

                        # Close position in state (credits capital internally)
                        await close_position(pos, True)

                        # Refresh live USDC balance after claim
                        try:
                            fresh_usdc = await fetch_balance_usdc(sess)
                            if fresh_usdc > 0:
                                async with _lock:
                                    S.capital = fresh_usdc
                            S.last_balance_refresh = datetime.now(timezone.utc).isoformat()
                        except Exception:
                            pass

                        add_log("REDEEMED", {
                            "id":          pos["id"],
                            "question":    pos["question"][:50],
                            "outcome":     pos["outcome"],
                            "method":      redeem_method,
                            "claimed_usdc": round(claimed_usdc, 4),
                            "capital":     round(S.capital, 4),
                            "message":     f"✓ Redeemed via {redeem_method} (+${claimed_usdc:.2f} pUSD)",
                        })
                        await broadcast({"type": "balance_update", "data": {
                            "usdc": round(S.capital, 4),
                            "pol":  round(S.pol_left, 4),
                            "ts":   S.last_balance_refresh,
                            "event": "redeem",
                            "pos_id": pos["id"],
                            "method": redeem_method,
                        }})

                    except Exception as e:
                        # Track per-pos retry attempts; escalate to CRITICAL after 3 fails
                        pos["claim_attempts"] = int(pos.get("claim_attempts", 0)) + 1
                        attempts = pos["claim_attempts"]
                        S.errors.append(f"[redeem_exec #{attempts}] {str(e)[:50]}")
                        if attempts >= 3:
                            add_log("REDEEM_CRITICAL", {
                                "id":       pos["id"],
                                "attempts": attempts,
                                "error":    str(e)[:80],
                                "message":  f"⚠ Redeem failed {attempts}x — MANUAL REVIEW: claim via Polymarket UI",
                            })
                        else:
                            add_log("REDEEM_FAIL", {
                                "id":       pos["id"],
                                "attempts": attempts,
                                "error":    str(e)[:80],
                                "message":  f"Redeem failed (attempt {attempts}/3) — will retry",
                            })

            except Exception as e:
                S.errors.append(f"[redeem_loop] {str(e)[:60]}")

            # Adaptive polling: 10s when any open pos has passed resolve_sec, else 30s
            # Critical-state (3+ attempts) → extra slow (300s) to avoid spamming a broken claim
            try:
                now = datetime.now(timezone.utc)
                has_expired = any(
                    p["status"] == "open"
                    and (now - datetime.fromisoformat(p["opened_at"])).total_seconds() >= p.get("resolve_sec", 86400)
                    for p in S.positions
                )
                has_critical = any(p.get("claim_attempts", 0) >= 3 for p in S.positions)
                sleep_sec = 300 if has_critical else (10 if has_expired else 30)
            except Exception:
                sleep_sec = 60
            await asyncio.sleep(sleep_sec)

# ─── POSITION RECOVERY (real mode startup reconciliation) ──────
async def reconcile_real_positions():
    """At startup (real mode only): query CLOB open orders to reconcile state vs reality.

    State is local truth at last save; Polymarket is global truth. After crash/restart:
    - Orders open in CLOB but missing from state → log warning (manual review)
    - Positions in state but no matching CLOB order AND past resolve_sec → likely settled,
      mark for next redeem_loop cycle to handle.
    Does NOT mutate positions automatically (too risky — only flags + logs).
    """
    # Wait until mode is real (supports runtime toggle)
    while MODE != "real":
        await asyncio.sleep(15)
    await asyncio.sleep(8)  # let other startup tasks settle

    if not CLOB_OK or not C.poly_api_key:
        return

    try:
        def _fetch():
            client = _build_clob_client()
            if client is None: return None
            try:    return client.get_orders()
            except: pass
            try:    return client.get_open_orders()
            except: return None
        clob_orders = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        if clob_orders is None:
            add_log("RECONCILE_SKIP", {"message": "CLOB get_orders unavailable; skipping reconciliation"})
            return

        clob_order_ids = {str(o.get("id") or o.get("order_id") or "") for o in clob_orders if o}
        clob_order_ids.discard("")

        # Check 1: positions in state with order_id NOT in CLOB → flag
        state_orders = {str(p.get("order_id", "")): p for p in S.positions
                        if p.get("status") == "open" and p.get("order_id")
                        and not p.get("order_id", "").startswith(("DRY-", "S-", "sim-"))}
        missing_in_clob = [oid for oid in state_orders if oid not in clob_order_ids]
        for oid in missing_in_clob:
            pos = state_orders[oid]
            opened = datetime.fromisoformat(pos["opened_at"])
            elapsed = (datetime.now(timezone.utc) - opened).total_seconds()
            past_resolve = elapsed >= pos.get("resolve_sec", 86400)
            add_log("RECONCILE_MISSING_CLOB", {
                "id":          pos["id"],
                "order_id":    oid,
                "past_resolve": past_resolve,
                "message":     ("Order not in CLOB — likely already settled, redeem loop will check"
                                if past_resolve else
                                "Order not in CLOB but window not expired — MANUAL REVIEW"),
            })

        # Check 2: CLOB orders not in state → flag (means bot lost track)
        orphan_clob = clob_order_ids - set(state_orders.keys())
        for oid in orphan_clob:
            add_log("RECONCILE_ORPHAN_CLOB", {
                "order_id": oid,
                "message":  "CLOB has order unknown to local state — MANUAL REVIEW",
            })

        add_log("RECONCILE_DONE", {
            "state_open":     len(state_orders),
            "clob_open":      len(clob_order_ids),
            "missing_in_clob": len(missing_in_clob),
            "orphan_clob":    len(orphan_clob),
            "message":        f"State {len(state_orders)} open, CLOB {len(clob_order_ids)} open",
        })
    except Exception as e:
        S.errors.append(f"[reconcile] {str(e)[:80]}")
        add_log("RECONCILE_ERROR", {"error": str(e)[:80], "message": "Reconciliation failed"})

# ─── HOUSEKEEPING LOOP (daily reset + periodic stats broadcast) ──
async def scanner_loop():
    """Housekeeping: daily reset + periodic stats/gas broadcast.
    Used to also scan soccer markets — removed (BTC-only)."""
    while True:
        try:
            daily_reset(); S.scan_count += 1
            await broadcast({"type": "stats",  "data": get_stats()})
            await broadcast({"type": "gas",    "data": get_gas_info()})
        except Exception as e:
            S.errors.append(f"housekeeping: {str(e)[:60]}")
        await asyncio.sleep(C.scan_sec)

async def _fetch_btc_close_at(ts: int, sess: aiohttp.ClientSession) -> float:
    """Fetch BTC close price at given UNIX timestamp using Binance 1m klines.
    Returns 0 if all sources fail. Used by dry_run resolver."""
    # Try all Binance mirrors
    for bn in BINANCE_MIRRORS:
        try:
            async with sess.get(f"{bn}/klines", params={
                "symbol": "BTCUSDT", "interval": "1m",
                "startTime": (ts - 60) * 1000, "limit": 2,
            }, headers=_CLOB_UA, timeout=aiohttp.ClientTimeout(total=8)) as r:
                if r.status == 200:
                    data = await r.json()
                    if data:
                        for k in data:
                            k_open_ts = int(k[0]) // 1000
                            if k_open_ts + 60 >= ts:
                                return float(k[4])
                        return float(data[-1][4])
        except: pass
    # Fallback: CryptoCompare
    try:
        async with sess.get(f"{CRYPTOCOMPARE}/v2/histominute", params={
            "fsym": "BTC", "tsym": "USD", "limit": 2, "toTs": ts,
        }, timeout=aiohttp.ClientTimeout(total=8)) as r:
            if r.status == 200:
                data = await r.json()
                rows = data.get("Data", {}).get("Data", [])
                if rows: return float(rows[-1]["close"])
    except: pass
    return 0.0

async def _resolve_dry_run(pos: dict, sess: aiohttp.ClientSession) -> tuple[bool, str]:
    """Resolve position based on actual BTC price at window close.
    Returns (won, reason). Falls back to random if BTC data unreachable."""
    win_open = float(pos.get("win_open_btc", 0) or 0)
    win_ts   = int(pos.get("win_ts", 0) or 0)
    resolve_sec = int(pos.get("resolve_sec", 300))
    outcome  = (pos.get("outcome") or "").upper()
    # Window close timestamp
    if win_ts > 0:
        win_end_ts = win_ts + resolve_sec
    else:
        opened = datetime.fromisoformat(pos["opened_at"])
        win_end_ts = int(opened.timestamp()) + resolve_sec
    if win_open <= 0:
        # No reference price — fallback to random
        tp = pos.get("true_prob", 0.65)
        return random.random() < (tp * 0.93), "random_fallback_no_ref"
    win_close = await _fetch_btc_close_at(win_end_ts, sess)
    if win_close <= 0:
        tp = pos.get("true_prob", 0.65)
        return random.random() < (tp * 0.93), "random_fallback_fetch_failed"
    actual_up = win_close > win_open
    if outcome == "UP":
        won = actual_up
    elif outcome == "DOWN":
        won = not actual_up
    else:
        won = False
    return won, f"btc {win_open:.2f}→{win_close:.2f} ({'UP' if actual_up else 'DOWN'})"

async def resolver_loop():
    """Sim & dry_run: auto-resolve positions on window expiry.
    Real BTC5m: fast-close LOSSES (no need to wait for CLOB), leave WINS for claim."""
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as sess:
        while True:
            now = datetime.now(timezone.utc)
            for pos in list(S.positions):
                if pos["status"] != "open": continue
                opened  = datetime.fromisoformat(pos["opened_at"])
                elapsed = (now-opened).total_seconds()
                # Close window + 60s grace for CLOB indexing
                if elapsed >= pos.get("resolve_sec", 86400) + 60:
                    pos_mode = pos.get("mode", MODE)
                    if pos_mode == "real":
                        # Fast-resolve: use BTC close price to detect loss early
                        if pos.get("category") == "btc5m":
                            try:
                                win_close = await _fetch_btc_close_at(pos.get("win_ts", 0) + 300, sess)
                                win_open  = pos.get("win_open_btc", 0)
                                if win_close > 0 and win_open > 0:
                                    actual_up = win_close > win_open
                                    won = actual_up if pos["outcome"] == "UP" else not actual_up
                                    if not won:
                                        await close_position(pos, False)
                                        continue  # LOST → closed, no need to wait for CLOB
                                    # WON → keep open, wait for CLOB claim via redeem loop
                            except Exception: pass
                        continue  # non-btc5m real → wait for redeem loop
                    elif pos_mode in ("sim", "dry_run"):
                        if MODE == "sim":
                            tp  = pos.get("true_prob", 0.65)
                            won = random.random() < (tp * 0.93)
                        else:
                            won, reason = await _resolve_dry_run(pos, sess)
                        await close_position(pos, won)
            await asyncio.sleep(5)

# ─── DATA HELPERS ────────────────────────────────────────────
def open_pos(): return [p for p in S.positions if p["status"] == "open"]

def get_stats():
    eq    = equity()
    total = len(S.closed_trades)
    wins  = sum(1 for t in S.closed_trades if t["status"] == "won")
    pnl   = round(eq - S.initial, 4)
    cbet  = compound_bet(eq)
    sal   = S.salary_events[-1] if S.salary_events else {}
    return {
        "bot_id":          BOT_ID,
        "bot_name":        BOT_NAME,
        "mode":            S.mode.upper(),
        "mode_raw":        S.mode,
        "credentials_ready": bool(C.poly_private_key and C.poly_api_key),
        "running":         S.running,
        "win_streak":      S.win_streak,
        "loss_streak":     S.loss_streak,
        "capital":         round(eq, 4),
        "available":       round(S.capital, 4),
        "locked":          round(S.locked, 4),
        "initial":         S.initial,
        "pnl":             pnl,
        "roi_pct":         round(pnl/S.initial*100, 2) if S.initial else 0,
        "lifetime_pnl":    round(S.lifetime_pnl, 4),
        "total_withdrawn": round(S.total_withdrawn, 4),
        # withdrawal readiness
        "wd_ready":        eq >= 100.0,
        "wd_available":    round(eq, 4),
        "wd_suggest_pct":  50,
        "total_trades":    total,
        "wins":            wins,
        "losses":          total-wins,
        "win_rate":        round(wins/total*100, 1) if total else 0,
        "open_count":      len(open_pos()),
        "daily_pnl":       round(S.daily_pnl, 4),
        "daily_stopped":   S.daily_pnl <= -C.daily_loss_limit,
        "total_wagered":   round(sum(t.get("size", 0) for t in S.closed_trades), 4),
        "scan_count":      S.scan_count,
        "signals_found":   S.signals_found,
        "start_time":      S.start_time,
        "errors":          S.errors[-3:],
        "gas":             get_gas_info(),
        # compound
        "compound_bet":    cbet,
        "compound_next":   compound_next_at(eq),
        "compound_prog":   compound_progress(eq),
        "compound_events": S.compound_events[-3:],
        # salary
        "salary": {
            "next_target":     S.salary_target,
            "current_equity":  round(eq, 4),
            "to_next":         round(max(0, S.salary_target-eq), 4),
            "progress_pct":    round(min(100, eq/S.salary_target*100), 1) if S.salary_target else 0,
            "total_withdrawn": round(S.total_withdrawn, 4),
            "salary_count":    len(S.salary_events),
            "last_event":      sal,
        },
        # btc5m summary
        "btc5m_stats":     S.btc5m["stats"],
        # circuit breaker status
        "circuit_breakers": {
            "balance_floor_ok":  not (MODE == "real" and S.capital < C.balance_floor),
            "daily_loss_ok":     S.daily_pnl > -C.daily_loss_limit,
            "gas_ok":            gas_status() != "critical",
            "balance_floor":     C.balance_floor,
            "daily_loss_limit":  C.daily_loss_limit,
        },
        # withdrawal history
        "withdrawal_history": S.withdrawal_history[-50:][::-1],  # newest first
    }

# ─── API ROUTES ──────────────────────────────────────────────
@app.get("/health")
def health(): return {"status": "ok", "bot_id": BOT_ID, "mode": MODE, "running": S.running}

@app.get("/api/stats")
def api_stats(): return get_stats()

@app.get("/api/positions")
def api_positions(): return open_pos()

@app.get("/api/history")
def api_history(limit: int = 200): return S.closed_trades[-limit:][::-1]

@app.get("/api/log")
def api_log(limit: int = 200): return S.log[:limit]

@app.get("/api/gas")
def api_gas(): return get_gas_info()

@app.get("/api/storage")
def api_storage():
    def dir_mb(p: Path) -> float:
        try: return round(sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) / 1048576, 2)
        except: return 0.0
    def file_mb(p: Path) -> float:
        try: return round(p.stat().st_size / 1048576, 3)
        except: return 0.0
    log_dir = Path(os.getenv("LOG_DIR", str(DATA_DIR.parent.parent / "logs")))
    be_log  = log_dir / f"backend-{BOT_ID}-{_MODE_SUFFIX}.log"
    fe_log  = log_dir / f"frontend-{BOT_ID}-{_MODE_SUFFIX}.log"
    return {
        "data_mb":    dir_mb(DATA_DIR),
        "db_mb":      file_mb(DB_PATH),
        "state_mb":   file_mb(STATE_FILE),
        "log_be_mb":  file_mb(be_log),
        "log_fe_mb":  file_mb(fe_log),
    }

@app.get("/api/btc5m")
def api_btc5m(): return get_btc5m_info()

@app.get("/api/predictions")
def api_predictions():
    b5 = S.btc5m
    klines = b5.get("klines", [])
    price  = b5.get("btc_price", 0)
    ticks  = b5.get("ticks", [])
    now_ts = int(datetime.now(timezone.utc).timestamp())
    win_ts = btc5m_window_ts(now_ts)
    win_open = b5.get("win_open", price)

    if not klines or price <= 0:
        return {"predictions": [], "current": {}, "error": "no data"}

    current = btc5m_analyze(klines, price, win_open, ticks)

    # Build 5 future window predictions
    closes = [k["close"] for k in klines]
    predictions = []
    decay = 0.35  # confidence decay per window

    # Current trend signals
    mom_up = sum(1 for i in range(1, min(6, len(closes))) if closes[-i] > closes[-i-1]) if len(closes) >= 6 else 0
    mom_dn = sum(1 for i in range(1, min(6, len(closes))) if closes[-i] < closes[-i-1]) if len(closes) >= 6 else 0
    recent_roc = (closes[-1] - closes[-4]) / closes[-4] if len(closes) >= 4 and closes[-4] > 0 else 0

    ema9  = sum(closes[-9:]) / min(9, len(closes)) if closes else price
    ema21 = sum(closes[-21:]) / min(21, len(closes)) if closes else price
    ema_bull = ema9 > ema21

    base_score = current.get("score", 0)
    base_dir   = current.get("dir", "")

    for i in range(1, 6):
        future_ts = win_ts + (i * 300)
        secs_until = future_ts - now_ts

        # Score projection: base score persists with decay + momentum adjustment
        mom_bonus = (mom_up - mom_dn) * 0.8 + (1 if ema_bull else -1) * 0.5 + (1 if recent_roc > 0 else -1) * 0.3
        projected_score = (base_score * (1 - decay * i)) + (mom_bonus * min(i, 2))
        projected_conf = min(abs(projected_score) / 7.0, 1.0)
        projected_dir  = "UP" if projected_score > 0.1 else "DOWN" if projected_score < -0.1 else "FLAT"
        if projected_conf < 0.10:
            projected_dir = "FLAT"

        predictions.append({
            "window":    i,
            "ts":        future_ts,
            "secs_until": max(0, secs_until),
            "time_str":  f"{(secs_until // 60)}m{(secs_until % 60)}s",
            "direction": projected_dir,
            "confidence": round(projected_conf, 2),
            "score":      round(projected_score, 2),
        })

    return {
        "predictions": predictions,
        "current": {
            "direction":  base_dir,
            "confidence": current.get("confidence", 0),
            "score":      current.get("score", 0),
            "price":      price,
            "win_open":   win_open,
            "secs_left":  win_ts + 300 - now_ts,
        },
        "indicators": {
            "ema_bull": ema_bull,
            "mom_up":   mom_up,
            "mom_dn":   mom_dn,
            "recent_roc": round(recent_roc * 100, 3),
        },
    }

@app.get("/api/orderbook")
def api_orderbook(): return get_orderbook_snapshot()

@app.get("/api/config")
def api_config_get():
    return {"mode": S.mode, "config": S.strategy_config,
            "credentials_ready": bool(C.poly_private_key and C.poly_api_key)}

@app.post("/api/config")
async def api_config_set(payload: dict):
    """Update strategy config. Body: {"key": value, ...}. Persisted to state."""
    allowed = set(S.strategy_config.keys())
    updates = {k: v for k, v in (payload or {}).items() if k in allowed}
    if not updates:
        return {"ok": False, "reason": "no valid keys", "allowed": sorted(allowed)}
    # Type coerce numeric fields
    for k, v in updates.items():
        if isinstance(S.strategy_config[k], bool):
            S.strategy_config[k] = bool(v)
        elif isinstance(S.strategy_config[k], (int, float)):
            try: S.strategy_config[k] = float(v) if isinstance(S.strategy_config[k], float) else int(v)
            except: pass
        else:
            S.strategy_config[k] = v
    save_state()
    add_log("CONFIG_UPDATE", {"updated": list(updates.keys())})
    await broadcast({"type": "config", "data": {"mode": S.mode, "config": S.strategy_config}})
    return {"ok": True, "config": S.strategy_config}

@app.post("/api/mode")
async def api_mode_set(payload: dict):
    """Switch mode at runtime. Body: {"mode": "sim"|"dry_run"|"real"}.
    Safety: refuse switch FROM real if open positions exist; refuse switch TO real without creds."""
    global MODE
    new_mode = str((payload or {}).get("mode", "")).lower()
    if new_mode not in VALID_MODES:
        return {"ok": False, "reason": f"mode must be one of {VALID_MODES}"}
    if new_mode == S.mode:
        return {"ok": True, "mode": S.mode, "unchanged": True}
    open_count = len(open_pos())
    if S.mode == "real" and open_count > 0:
        return {"ok": False, "reason": f"close {open_count} open real position(s) first"}
    if new_mode == "real" and not (C.poly_private_key and C.poly_api_key):
        return {"ok": False, "reason": "real mode needs POLY_PRIVATE_KEY + POLY_API_KEY in env"}
    S.mode = new_mode
    MODE   = new_mode   # sync global so legacy checks (MODE == "real") work
    # When switching to real, start paused; sim/dry_run resume running
    S.running = (new_mode != "real")
    save_state()
    add_log("MODE_CHANGE", {"from": S.mode, "to": new_mode, "running": S.running})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True, "mode": S.mode, "running": S.running}

@app.get("/api/balance")
async def api_balance():
    """Live balance endpoint — Sprint 1 addition."""
    return {
        "usdc":         round(S.capital, 4),
        "pol":          round(S.pol_left, 4),
        "last_refresh": S.last_balance_refresh,
        "source":       "live" if MODE == "real" else "simulated",
        "balance_floor": C.balance_floor,
        "floor_ok":     not (MODE == "real" and S.capital < C.balance_floor),
    }

@app.post("/api/gas/resume")
async def api_gas_resume():
    S.gas_paused = False
    add_log("GAS_RESUME", {"message": "Bot aktif kembali setelah top-up POL"})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True}

@app.post("/api/bot/start")
async def api_bot_start(force: bool = False):
    """Start bot. Clears circuit-breaker pause flag so bot can re-enter.

    Pre-flight: refuse start kalau gas insufficient (≤ stop_orders threshold).
    Pass ?force=true untuk bypass (akan tetap auto-pause saat consume_gas trigger critical).
    """
    global _breaker_paused_reason

    # Gas pre-flight check
    n_orders = gas_orders_left()
    if n_orders <= C.gas_stop_orders and not force:
        msg = f"Gas insufficient: hanya {n_orders} transaksi tersisa (threshold ≤{C.gas_stop_orders}). Top-up POL atau pass ?force=true"
        add_log("START_REJECTED", {
            "reason":      "gas_insufficient",
            "orders_left": n_orders,
            "pol_left":    round(S.pol_left, 4),
            "threshold":   C.gas_stop_orders,
            "message":     msg,
        })
        await broadcast({"type": "stats", "data": get_stats()})
        return {
            "ok": False,
            "running": S.running,
            "reason": "gas_insufficient",
            "orders_left": n_orders,
            "pol_left": round(S.pol_left, 4),
            "threshold": C.gas_stop_orders,
            "message": msg,
        }

    S.running = True
    _breaker_paused_reason = ""
    # Resume gas pause kalau user explicit start (assume they topped up or want to retry)
    if S.gas_paused and n_orders > C.gas_stop_orders:
        S.gas_paused = False
    add_log("BOT_START", {"message": f"Bot {BOT_ID} started", "mode": MODE, "orders_left": n_orders})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True, "running": True, "orders_left": n_orders}

@app.post("/api/bot/stop")
async def api_bot_stop():
    """Stop bot (pause auto-betting)"""
    S.running = False
    add_log("BOT_STOP", {"message": f"Bot {BOT_ID} stopped by user"})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True, "running": False}

@app.post("/api/reset")
async def api_reset():
    global S
    if STATE_FILE.exists(): STATE_FILE.unlink()
    # Reset daily_loss SQLite entry so next restart doesn't reload stale value
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute("DELETE FROM daily_loss WHERE bot_id=?", (BOT_ID,))
            con.commit(); con.close()
    except: pass
    S = BotState()
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True}

@app.get("/api/db/summary")
def api_db_summary(): return db_summary()

@app.get("/api/db/trades")
def api_db_trades(bot_id: str = "", limit: int = 200): return db_trades(bot_id, limit)

_last_wd_ts: float = 0.0   # epoch seconds — cooldown guard against double-tap

@app.post("/api/withdrawal/execute")
def api_withdrawal_execute(bot_id: str, amount: float):
    """Execute withdrawal via ./wd.sh — DRY_RUN only"""
    global _last_wd_ts
    try:
        if not bot_id or amount <= 0:
            return {"ok": False, "error": "Invalid bot_id or amount"}
        # Cooldown: prevent double-tap within 60 seconds
        now_ts = time.time()
        if now_ts - _last_wd_ts < 60:
            secs = int(60 - (now_ts - _last_wd_ts))
            return {"ok": False, "error": f"Withdrawal cooldown — tunggu {secs}s lagi"}
        # Get bot root directory (parent of backend/)
        bot_root = Path(__file__).parent.parent
        wd_script = bot_root / "wd.sh"
        if not wd_script.exists():
            return {"ok": False, "error": "wd.sh not found"}
        # Execute: ./wd.sh confirm {bot_id} dry_run --amount={amount}
        # Pipe 'y' to confirm the withdrawal prompt
        result = subprocess.run(
            ["bash", str(wd_script), "confirm", bot_id, "dry_run", f"--amount={amount:.2f}"],
            cwd=str(bot_root),
            capture_output=True,
            text=True,
            timeout=10,
            input="y\n"  # Auto-confirm the withdrawal prompt
        )
        if result.returncode == 0:
            cap_before = round(equity(), 4)
            cap_after  = round(max(cap_before - amount, 0), 4)
            # Record withdrawal with all fields frontend expects
            S.withdrawal_history.append({
                "timestamp":      datetime.now(timezone.utc).isoformat(),
                "amount":         round(amount, 2),       # legacy compat
                "amount_withdrawn": round(amount, 2),
                "capital_before": cap_before,
                "capital_after":  cap_after,
                "mode":           MODE,
                "note":           "WD via dashboard",
            })
            S.total_withdrawn += amount
            _last_wd_ts = time.time()
            save_state()
            return {
                "ok": True,
                "bot_id": bot_id,
                "amount": amount,
                "output": result.stdout,
            }
        else:
            return {
                "ok": False,
                "error": result.stderr or "Withdrawal failed",
                "bot_id": bot_id,
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/withdrawal/history")
def api_withdrawal_history(bot_id: str = ""):
    """Get withdrawal history for current bot"""
    try:
        return {
            "ok": True,
            "bot_id": BOT_ID,
            "history": S.withdrawal_history[-100:][::-1]  # newest first
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/logs/file")
def api_logs_file(type: str = "backend", lines: int = 300):
    """Return last N lines of backend or frontend log file.
    type=backend|frontend  lines=max 2000"""
    lines = min(int(lines), 2000)
    log_dir = Path(os.getenv("LOG_DIR", str(DATA_DIR.parent.parent / "logs")))
    filename = f"{type}-{BOT_ID}-{_MODE_SUFFIX}.log"
    log_file = log_dir / filename
    try:
        if not log_file.exists():
            return {"ok": False, "error": f"not found: {filename}", "lines": [], "total": 0, "file": str(log_file)}
        with open(log_file, "r", errors="replace") as f:
            all_lines = f.readlines()
        tail = all_lines[-lines:] if len(all_lines) > lines else all_lines
        return {
            "ok": True,
            "file": filename,
            "total": len(all_lines),
            "lines": [l.rstrip("\n") for l in tail],
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "lines": [], "total": 0}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept(); S.ws_clients.add(ws)
    try:
        await ws.send_text(json.dumps({"type": "init", "data": {
            "stats":     get_stats(),
            "positions": open_pos(),
            "log":       S.log[:60],
            "btc5m":     get_btc5m_info(),
            "orderbook": get_orderbook_snapshot(),
            "config":    {"mode": S.mode, "config": S.strategy_config,
                          "credentials_ready": bool(C.poly_private_key and C.poly_api_key)},
            "history":   S.closed_trades[-300:][::-1],
            "gas":       get_gas_info(),
            "balance": {
                "usdc":         round(S.capital, 4),
                "pol":          round(S.pol_left, 4),
                "last_refresh": S.last_balance_refresh,
            },
        }}, default=str))
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    except Exception: pass
    finally: S.ws_clients.discard(ws)

@app.on_event("startup")
async def startup():
    db_init()
    with _db_lock:
        con = sqlite3.connect(DB_PATH)
        con.execute("INSERT INTO sessions VALUES (?,?,?,?,?)",
            (BOT_ID, MODE, datetime.now().isoformat(), C.usdc_capital, C.pol_balance))
        con.commit(); con.close()
    resumed = load_state()
    db_load_daily_loss()                           # Sprint 1: restore daily P&L from DB
    # Auto-start trading for DRY_RUN and SIM modes (REAL mode requires manual RUN)
    if MODE in ("dry_run", "sim"):
        S.running = True
        add_log("BOT_AUTO_START", {"mode": MODE, "auto": True})
    asyncio.create_task(btc5m_loop())
    asyncio.create_task(orderbook_loop())
    asyncio.create_task(scanner_loop())
    asyncio.create_task(balance_refresh_loop())    # Sprint 1: auto-fetch balance
    # Always spawn — loops self-gate on MODE so runtime toggle works
    asyncio.create_task(resolver_loop())
    asyncio.create_task(redeem_winning_positions())  # Sprint 2: auto-claim winnings (real-mode no-op'd internally if needed)
    asyncio.create_task(reconcile_real_positions())  # Phase 4: state vs CLOB reconcile on startup (real mode)
    print(f"[{BOT_ID}] mode={MODE} capital=${S.capital:.2f} pol={S.pol_left} resumed={resumed}")
    print(f"[{BOT_ID}] Sprint 1: balance_floor=${C.balance_floor} daily_loss=${C.daily_loss_limit}")
    print(f"[{BOT_ID}] Sprint 1: BTC5m poll=2s entry=T-10s spike_detect=ON")
    print(f"[{BOT_ID}] Sprint 2: real_order_exec={CLOB_OK} auto_redeem={MODE=='real'}")
    print(f"[{BOT_ID}] compound: floor(equity/10) = max_bet, min $1")
    print(f"[{BOT_ID}] gas auto-stop: < {C.gas_stop_orders} orders")
    print(f"[{BOT_ID}] web3_ok={WEB3_OK} clob_ok={CLOB_OK}")
