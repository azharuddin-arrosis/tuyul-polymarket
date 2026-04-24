"""
POLYMARKET BOT FINAL
- Auto-bet: semua strategi jalan otomatis 24/7
- Compound: setiap $10 naik $1 max bet
- Persistent state: simpan ke state.json, lanjut dari saldo sebelumnya
- BTC 5m: dedicated loop, entry T-30s ke T-10s
- Global scanner: semua market dari Gamma API
- Salary: setiap kelipatan $100 tarik 70% simpan 30%
- Gas: 50% reserve
"""
import asyncio, json, os, random, math, time
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

_lock = asyncio.Lock()
BOT_ID     = os.getenv("BOT_ID", "bot1")
STATE_FILE = Path(f"/app/data/state_{BOT_ID}.json")
DB_PATH    = Path("/app/data/trades.db")
STATE_FILE.parent.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PolyBot")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── CONFIG ──────────────────────────────────────────────────
class C:
    mode              = os.getenv("BOT_MODE", "sim")
    usdc_capital      = float(os.getenv("USDC_CAPITAL", "10"))
    pol_balance       = float(os.getenv("POL_BALANCE", "11"))
    min_bet           = 1.00           # Polymarket min
    max_open_pos      = int(os.getenv("MAX_OPEN_POS", "5"))
    min_ev            = float(os.getenv("MIN_EV", "0.03"))
    daily_loss_limit  = float(os.getenv("DAILY_LOSS_LIMIT", "5.0"))
    prob_min          = float(os.getenv("PROB_MIN", "0.52"))
    prob_max          = float(os.getenv("PROB_MAX", "0.90"))
    scan_sec          = int(os.getenv("SCAN_INTERVAL", "8"))
    # Compound: every $10 → +$1 max bet
    compound_step     = 10.0
    compound_inc      = 2.0
    compound_max_bet  = 50.0
    # Gas: 50% reserved
    gas_reserve_pct   = 0.50
    gas_per_tx_usd    = 0.02
    pol_price_usd     = 0.40
    gas_alert_tx      = 10
    gas_stop_tx       = 2
    # Salary
    salary_threshold  = 100.0
    salary_keep_pct   = 0.30
    salary_withdraw_pct = 0.70

GAMMA        = "https://gamma-api.polymarket.com"
BINANCE_API  = "https://api.binance.com/api/v3"
BTC5M_WINDOW = 300

TAKER_FEE = {
    "crypto":0.018,"sports":0.0075,"politics":0.010,
    "finance":0.010,"economics":0.015,"culture":0.0125,
    "geopolitics":0.000,"science":0.010,"tech":0.010,
    "weather":0.0125,"other":0.010,
}

SLOW_KW = ["rihanna","gta vi","2027","2028","ever","lifetime","by end of year","annual movie","album release","will ever"]

# ─── STATE ───────────────────────────────────────────────────
class BotState:
    def __init__(self):
        self.capital         = C.usdc_capital
        self.locked_capital  = 0.0
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
        self.market_bets_today: dict = {}
        self.salary_events   = []
        self.total_withdrawn = 0.0
        self.salary_target   = C.salary_threshold
        self.lifetime_pnl    = 0.0
        # BTC5m
        self.btc5m           = {"slug":"","secs_left":300,"btc_price":0,"predicted_dir":"","confidence":0,"entry_fired":False,"in_entry_zone":False,"signal":{},"stats":{"wins":0,"losses":0,"total":0},"klines":[],"market_data":{}}

S = BotState()

# ─── PERSIST ─────────────────────────────────────────────────
def save_state():
    try:
        data = {
            "capital":          S.capital,
            "locked_capital":   S.locked_capital,
            "initial_capital":  S.initial_capital,
            "total_withdrawn":  S.total_withdrawn,
            "salary_target":    S.salary_target,
            "salary_events":    S.salary_events,
            "compound_events":  S.compound_events,
            "compound_tier":    S.compound_tier,
            "lifetime_pnl":     S.lifetime_pnl,
            "pos_counter":      S.pos_counter,
            "closed_trades":    S.closed_trades[-200:],
            "pol_left":         S.pol_left,
            "gas_used_usd":     S.gas_used_usd,
            "btc5m_stats":      S.btc5m.get("stats", {}),
        }
        STATE_FILE.write_text(json.dumps(data, default=str))
    except Exception as e:
        S.errors.append(f"save_state: {e}")

def load_state():
    """Load persisted state — lanjut dari saldo sebelumnya"""
    if not STATE_FILE.exists():
        return False
    try:
        data = json.loads(STATE_FILE.read_text())
        S.capital          = float(data.get("capital", C.usdc_capital))
        S.locked_capital   = 0.0   # positions reset on restart
        S.initial_capital  = float(data.get("initial_capital", C.usdc_capital))
        S.total_withdrawn  = float(data.get("total_withdrawn", 0))
        S.salary_target    = float(data.get("salary_target", C.salary_threshold))
        S.salary_events    = data.get("salary_events", [])
        S.compound_events  = data.get("compound_events", [])
        S.compound_tier    = int(data.get("compound_tier", 0))
        S.lifetime_pnl     = float(data.get("lifetime_pnl", 0))
        S.pos_counter      = int(data.get("pos_counter", 0))
        S.closed_trades    = data.get("closed_trades", [])
        S.pol_left         = float(data.get("pol_left", C.pol_balance))
        S.gas_used_usd     = float(data.get("gas_used_usd", 0))
        b5s = data.get("btc5m_stats", {})
        S.btc5m["stats"]   = b5s if b5s else {"wins":0,"losses":0,"total":0}
        add_log("RESUMED", {"capital": round(S.capital,4), "message": f"Melanjutkan saldo ${S.capital:.2f} dari session sebelumnya"})
        return True
    except Exception as e:
        S.errors.append(f"load_state: {e}")
        return False

# ─── COMPOUND ($10 step) ──────────────────────────────────────
def total_equity() -> float:
    return round(S.capital + S.locked_capital, 4)

def compound_tier_from_eq(eq: float) -> int:
    if eq < C.compound_step: return 0
    return int(eq / C.compound_step)

def compound_max_bet_now() -> float:
    t = compound_tier_from_eq(total_equity())
    bet = t * C.compound_inc
    return round(min(max(bet, C.min_bet), C.compound_max_bet), 2)

def compound_next_tier_at() -> float:
    t   = compound_tier_from_eq(total_equity())
    return round((t + 1) * C.compound_step, 2)

def compound_progress_pct() -> float:
    eq    = total_equity()
    t     = compound_tier_from_eq(eq)
    base  = t * C.compound_step
    top   = (t + 1) * C.compound_step
    span  = top - base
    return round(min(100.0, (eq - base) / span * 100), 1) if span > 0 else 100.0

def check_levelup():
    new_t = compound_tier_from_eq(total_equity())
    if new_t > S.compound_tier:
        old_bet = compound_max_bet_now()
        S.compound_tier = new_t
        ev = {"time":now_str(),"tier":new_t,"max_bet":compound_max_bet_now(),"capital":round(total_equity(),4)}
        S.compound_events.append(ev)
        add_log("COMPOUND_UP",{"tier":new_t,"new_bet":compound_max_bet_now(),"capital":round(total_equity(),4)})
        return True
    return False

# ─── SALARY ──────────────────────────────────────────────────
def check_salary():
    eq = total_equity()
    if eq < S.salary_target: return False
    withdrawn = round(eq * C.salary_withdraw_pct, 4)
    keep      = round(eq * C.salary_keep_pct, 4)
    ev = {"time":now_str(),"equity":round(eq,4),"withdrawn":withdrawn,"kept":keep,"next_target":S.salary_target+C.salary_threshold}
    S.salary_events.append(ev)
    S.total_withdrawn   = round(S.total_withdrawn + withdrawn, 4)
    S.capital           = keep
    S.locked_capital    = 0.0
    S.compound_tier     = 0
    S.salary_target    += C.salary_threshold
    add_log("SALARY",{"equity":round(eq,4),"withdrawn":withdrawn,"kept":keep,"next_target":S.salary_target})
    save_state()
    return True

# ─── GAS ─────────────────────────────────────────────────────
def gas_usable_pol() -> float:
    return max(0, S.pol_left * (1 - C.gas_reserve_pct))

def gas_tx_remaining() -> int:
    cost = C.gas_per_tx_usd / C.pol_price_usd
    return int(gas_usable_pol() / cost) if cost > 0 else 9999

def gas_status() -> str:
    tx = gas_tx_remaining()
    if tx <= C.gas_stop_tx:  return "critical"
    if tx <= C.gas_alert_tx: return "low"
    return "ok"

def consume_gas():
    cost = C.gas_per_tx_usd / C.pol_price_usd
    S.pol_left     = round(max(0, S.pol_left - cost), 4)
    S.gas_used_usd = round(S.gas_used_usd + C.gas_per_tx_usd, 4)
    st = gas_status(); tx = gas_tx_remaining()
    if st == "critical" and not S.gas_paused:
        S.gas_paused = True
        add_log("GAS_STOP",{"tx_left":tx,"message":f"Auto-stop: {tx} tx tersisa"})
    elif st == "low":
        add_log("GAS_WARN",{"tx_left":tx,"message":f"Gas menipis: {tx} tx"})

# ─── EV ──────────────────────────────────────────────────────
def ev_calc(p: float, price: float) -> float:
    return (p*(1-price)) - ((1-p)*price)

def kelly(p: float, price: float) -> float:
    if price<=0 or price>=1: return 0
    b = (1-price)/price
    k = (b*p - (1-p)) / b
    return max(0, min(k/2, 0.20))

def calc_size(p: float, price: float) -> float:
    max_bet = compound_max_bet_now()
    k       = kelly(p, price)
    avail   = S.capital
    raw     = total_equity() * k
    return round(max(C.min_bet, min(raw, max_bet, avail*0.40)), 2)

# ─── HELPERS ─────────────────────────────────────────────────
def now_str(): return datetime.now().strftime("%H:%M:%S")

def add_log(event: str, data: dict):
    e = {"time":now_str(),"event":event,**data}
    S.log.insert(0, e)
    if len(S.log)>300: S.log.pop()
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
        S.daily_date = today
        S.daily_pnl  = 0.0
        S.market_bets_today.clear()
        save_state()

# ─── BTC 5M ENGINE ───────────────────────────────────────────
def btc5m_window_ts(now_ts=0) -> int:
    ts = now_ts or int(datetime.now(timezone.utc).timestamp())
    return ts - (ts % BTC5M_WINDOW)

def btc5m_slug(ts: int) -> str:
    return f"btc-updown-5m-{ts}"

def btc5m_secs_left(now_ts=0) -> int:
    ts  = now_ts or int(datetime.now(timezone.utc).timestamp())
    end = btc5m_window_ts(ts) + BTC5M_WINDOW
    return max(0, end - ts)

async def btc5m_fetch_klines(sess, limit=20) -> list:
    try:
        async with sess.get(f"{BINANCE_API}/klines",params={"symbol":"BTCUSDT","interval":"1m","limit":limit}) as r:
            if r.status==200:
                data = await r.json()
                return [{"ts":int(k[0])//1000,"open":float(k[1]),"high":float(k[2]),"low":float(k[3]),"close":float(k[4]),"volume":float(k[5])} for k in data]
    except: pass
    return []

async def btc5m_fetch_price(sess) -> float:
    try:
        async with sess.get(f"{BINANCE_API}/ticker/price",params={"symbol":"BTCUSDT"}) as r:
            if r.status==200:
                return float((await r.json()).get("price",0))
    except: pass
    return 0.0

async def btc5m_fetch_market(slug: str, sess) -> Optional[dict]:
    try:
        async with sess.get(f"{GAMMA}/events",params={"slug":slug,"limit":1}) as r:
            if r.status==200:
                data = await r.json()
                evs  = data if isinstance(data,list) else []
                if evs:
                    for m in evs[0].get("markets",[]):
                        outs = m.get("outcomes","[]")
                        if isinstance(outs,str):
                            try: outs=json.loads(outs)
                            except: outs=[]
                        if any(str(o).lower() in ("up","down") for o in outs):
                            return m
                    if evs[0].get("markets"):
                        return evs[0]["markets"][0]
    except: pass
    return None

def btc5m_compute(klines: list, price: float) -> dict:
    if len(klines)<10: return {"dir":"","confidence":0,"signals":{}}
    closes  = [k["close"] for k in klines]
    volumes = [k["volume"] for k in klines]

    def ema(d,n):
        k=2/(n+1); r=[d[0]]
        for p in d[1:]: r.append(p*k+r[-1]*(1-k))
        return r

    e3=ema(closes,3); e8=ema(closes,8)
    ema_up  = e3[-1]>e8[-1]
    ema_gap = abs(e3[-1]-e8[-1])/e8[-1]

    gains=[]; losses_r=[]
    for i in range(1,min(8,len(closes))):
        d=closes[i]-closes[i-1]
        gains.append(max(d,0)); losses_r.append(max(-d,0))
    ag=sum(gains)/len(gains) if gains else 0
    al=sum(losses_r)/len(losses_r) if losses_r else 1e-9
    rsi=100-(100/(1+ag/al)) if al else 50

    vol_avg = sum(volumes[-10:-1])/9 if len(volumes)>=10 else sum(volumes)/len(volumes)
    vol_sp  = volumes[-1]>vol_avg*1.3

    last3 = klines[-3:]
    bull3 = sum(1 for k in last3 if k["close"]>=k["open"])
    cbias = "up" if bull3>=2 else "down"

    rec  = klines[-6:]
    hi   = max(k["high"] for k in rec); lo=min(k["low"] for k in rec)
    rng  = hi-lo if hi>lo else 1
    pos  = (price-lo)/rng

    up=0; dn=0
    up += 2+(3 if ema_gap>.001 else 0) if ema_up else 0
    dn += 2+(3 if ema_gap>.001 else 0) if not ema_up else 0
    up += 3 if rsi<35 else (1 if rsi<50 else 0)
    dn += 3 if rsi>65 else 0
    if vol_sp: (up if cbias=="up" else dn).__add__(2)  # noqa
    if vol_sp:
        if cbias=="up": up+=2
        else: dn+=2
    up += 2 if cbias=="up" else 0
    dn += 2 if cbias=="down" else 0
    up += 2 if pos<.25 else 0
    dn += 2 if pos>.75 else 0

    tot = up+dn
    if tot==0: return {"dir":"","confidence":0,"signals":{}}
    if up>dn: d,c="UP",up/tot
    else: d,c="DOWN",dn/tot
    if c<0.60: d,c="",0

    return {"dir":d,"confidence":round(c,3),"signals":{"ema_up":ema_up,"rsi":round(rsi,1),"vol_spike":vol_sp,"candle_bias":cbias,"pos_pct":round(pos,2),"up_score":up,"down_score":dn}}

async def btc5m_loop():
    print("[BTC5m] loop started")
    b5 = S.btc5m
    last_kline_fetch = 0
    last_market_fetch = 0
    cur_win_ts = 0

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as sess:
        while True:
            try:
                now_ts    = int(datetime.now(timezone.utc).timestamp())
                win_ts    = btc5m_window_ts(now_ts)
                secs_left = btc5m_secs_left(now_ts)
                slug      = btc5m_slug(win_ts)

                if win_ts != cur_win_ts:
                    cur_win_ts           = win_ts
                    b5["slug"]           = slug
                    b5["entry_fired"]    = False
                    b5["predicted_dir"]  = ""
                    b5["confidence"]     = 0
                    b5["market_data"]    = {}
                    b5["signal"]         = {}

                price = await btc5m_fetch_price(sess)
                if price: b5["btc_price"] = round(price,2)

                if now_ts - last_kline_fetch >= 55:
                    kl = await btc5m_fetch_klines(sess, 20)
                    if kl: b5["klines"] = kl
                    last_kline_fetch = now_ts

                if b5["klines"] and b5["btc_price"]:
                    sig = btc5m_compute(b5["klines"], b5["btc_price"])
                    if sig["dir"]:
                        b5["predicted_dir"] = sig["dir"]
                        b5["confidence"]    = sig["confidence"]
                        b5["signal"]        = sig

                if now_ts - last_market_fetch >= 60 or not b5["market_data"]:
                    mkt = await btc5m_fetch_market(slug, sess)
                    if mkt: b5["market_data"] = mkt
                    last_market_fetch = now_ts

                b5["secs_left"]     = secs_left
                b5["in_entry_zone"] = 10 <= secs_left <= 35

                if b5["in_entry_zone"] and not b5["entry_fired"] and b5["predicted_dir"] and b5["confidence"]>=0.60 and b5["market_data"] and not S.gas_paused:
                    outs   = b5["market_data"].get("outcomes","[]")
                    prices = b5["market_data"].get("outcomePrices","[]")
                    if isinstance(outs,str):
                        try: outs=json.loads(outs)
                        except: outs=[]
                    if isinstance(prices,str):
                        try: prices=json.loads(prices)
                        except: prices=[]

                    tgt_price = None
                    for i,o in enumerate(outs):
                        if b5["predicted_dir"]=="UP"   and str(o).lower() in ("up","yes"):  tgt_price=float(prices[i])
                        if b5["predicted_dir"]=="DOWN" and str(o).lower() in ("down","no"): tgt_price=float(prices[i])

                    if tgt_price and 0.02<tgt_price<0.98:
                        tp  = min(0.88, b5["confidence"])
                        evt = ev_calc(tp, tgt_price)
                        if evt > 0.02:
                            mkt_dict = {
                                "id":b5["market_data"].get("id",slug),
                                "question":b5["market_data"].get("question",f"BTC 5m {slug}")[:80],
                                "category":"crypto","yes_price":tgt_price,"no_price":1-tgt_price,
                                "volume":0,"volume_24h":0,"end_date":"","resolve_sec":secs_left,
                                "resolve_fmt":f"{secs_left}s","spread":0,"_is_btc5m":True,
                            }
                            sig_dict = {"strategy":"btc5m","outcome":b5["predicted_dir"],"ev":round(evt,4),"true_prob":round(tp,4),"price":round(tgt_price,4),"confidence":b5["confidence"]}
                            await open_position(mkt_dict, sig_dict)
                            b5["entry_fired"] = True
                            b5["stats"]["total"] = b5["stats"].get("total",0)+1

            except Exception as e:
                S.errors.append(f"[BTC5m] {str(e)[:60]}")

            await asyncio.sleep(8)

# ─── GLOBAL SCANNER ──────────────────────────────────────────
async def fetch_all_markets(sess) -> list:
    """Global scanner: ambil semua market aktif dari Gamma, filter fast-resolve"""
    try:
        results = []
        for params in [
            {"active":"true","closed":"false","limit":100,"order":"volume24hr","ascending":"false"},
            {"active":"true","closed":"false","limit":100,"order":"endDate","ascending":"true"},
        ]:
            try:
                async with sess.get(f"{GAMMA}/markets",params=params) as r:
                    if r.status==200:
                        data = await r.json()
                        items = data if isinstance(data,list) else data.get("markets",[])
                        results.extend(items)
            except: pass
        seen=set(); unique=[]
        for m in results:
            mid = m.get("id","")
            if mid and mid not in seen:
                seen.add(mid); unique.append(m)
        # Filter: skip slow keywords, skip >14 days
        fast=[]
        for m in unique:
            q  = m.get("question","")
            ed = m.get("endDate","")
            if any(w in q.lower() for w in SLOW_KW): continue
            rs = _estimate_resolve(q, ed)
            if rs > 1209600: continue  # skip >14 days
            m["_resolve_sec"] = rs
            fast.append(m)
        fast.sort(key=lambda m: m.get("_resolve_sec",999999))
        return fast[:100]
    except Exception as e:
        S.errors.append(f"scanner: {str(e)[:60]}")
        return []

def _estimate_resolve(q: str, ed: str) -> int:
    if ed:
        try:
            dt = datetime.fromisoformat(ed.replace("Z","+00:00"))
            diff = (dt - datetime.now(timezone.utc)).total_seconds()
            if diff > 0: return int(diff)
        except: pass
    ql = q.lower()
    if any(x in ql for x in ["5 min","5m"]): return 300
    if any(x in ql for x in ["1 hour","1h"]): return 3600
    if any(x in ql for x in ["today","eod","tonight"]): return 86400
    if any(x in ql for x in ["match","game","score","goal"]): return random.randint(7200,28800)
    if any(x in ql for x in ["btc","eth","bitcoin","ethereum","price"]): return random.randint(3600,86400)
    if any(x in ql for x in ["this week","7 day","weekly"]): return 604800
    return 86400

def _parse_market(m: dict) -> Optional[dict]:
    yes_p=no_p=None
    outs=m.get("outcomes","[]"); prices=m.get("outcomePrices","[]")
    if isinstance(outs,str):
        try: outs=json.loads(outs)
        except: outs=[]
    if isinstance(prices,str):
        try: prices=json.loads(prices)
        except: prices=[]
    if outs and prices and len(outs)==len(prices):
        try:
            yi=list(outs).index("Yes"); ni=list(outs).index("No")
            yes_p=float(prices[yi]); no_p=float(prices[ni])
        except: pass
    if yes_p is None:
        tokens=m.get("tokens",[])
        yt=next((t for t in tokens if t.get("outcome")=="Yes"),None)
        nt=next((t for t in tokens if t.get("outcome")=="No"),None)
        if yt and nt:
            try: yes_p=float(yt.get("price",0)); no_p=float(nt.get("price",0))
            except: return None
    if not yes_p or not no_p or yes_p<=0 or no_p<=0: return None
    vol=float(m.get("volume",0) or 0); vol24=float(m.get("volume24hr",0) or 0)
    q=m.get("question","")[:90]; ed=m.get("endDate","")
    rs=m.get("_resolve_sec",_estimate_resolve(q,ed))
    cat=(m.get("category") or "other").lower()
    rs_s=(f"{int(rs//60)}m" if rs<3600 else f"{rs/3600:.1f}h" if rs<86400 else f"{rs/86400:.1f}d")
    return {"id":m.get("id",""),"question":q,"category":cat,"yes_price":round(yes_p,4),"no_price":round(no_p,4),"volume":round(vol,2),"volume_24h":round(vol24,2),"end_date":ed,"resolve_sec":rs,"resolve_fmt":rs_s,"spread":round(abs(1-yes_p-no_p),4)}

def _detect_signal(m: dict) -> Optional[dict]:
    yp=m["yes_price"]; np_=m["no_price"]; vol=m.get("volume_24h",m["volume"])
    if vol<200: return None
    # Arb
    if yp+np_<0.985:
        pf=round(1-yp-np_,4)
        if pf>=0.005: return {"strategy":"arb","outcome":"YES+NO","ev":pf,"true_prob":0.99,"price":yp}
    # No-bias
    if 0.74<=yp<=0.93:
        tp=min(np_+0.12,0.87)
        if C.prob_min<=tp<=C.prob_max:
            e=ev_calc(tp,np_)
            if e>=C.min_ev: return {"strategy":"no_bias","outcome":"NO","ev":round(e,4),"true_prob":tp,"price":np_}
    # High-prob YES
    if C.prob_min<=yp<=C.prob_max:
        tp=min(yp+0.06,0.92); e=ev_calc(tp,yp)
        if e>=C.min_ev: return {"strategy":"high_prob","outcome":"YES","ev":round(e,4),"true_prob":tp,"price":yp}
    return None

def build_rows(parsed: list) -> list:
    rows=[]
    for p in parsed:
        if not p: continue
        sig=_detect_signal(p)
        rows.append({**p,"signal":sig["strategy"] if sig else "—","ev":round(sig["ev"],4) if sig else 0,"true_prob":round(sig["true_prob"],4) if sig else 0,"outcome":sig["outcome"] if sig else "—","fee":TAKER_FEE.get(p["category"],0.01)})
    rows.sort(key=lambda r:(r["signal"]=="—",r.get("resolve_sec",999999)))
    return rows

# ─── RISK GATE ────────────────────────────────────────────────
def risk_ok(mid: str, sig: dict) -> tuple[bool, str]:
    if S.gas_paused:        return False, f"Gas stop: {gas_tx_remaining()} tx"
    if S.daily_pnl<=-C.daily_loss_limit: return False, f"Daily loss ${C.daily_loss_limit}"
    open_pos=[p for p in S.positions if p["status"]=="open"]
    if len(open_pos)>=C.max_open_pos: return False, f"Max {C.max_open_pos} pos"
    if any(p["market_id"]==mid for p in open_pos): return False, "Sudah ada posisi"
    if sig["ev"]<C.min_ev:  return False, f"EV {sig['ev']:.3f} kecil"
    if S.capital<C.min_bet: return False, f"Capital ${S.capital:.2f}"
    return True, "OK"

# ─── POSITION ────────────────────────────────────────────────
async def open_position(market: dict, sig: dict):
    async with _lock:
        ok,reason = risk_ok(market["id"], sig)
        if not ok:
            if S.log and S.log[0].get("reason")==reason: return
            add_log("REJECTED",{"reason":reason,"question":market["question"][:45]})
            return
        size = calc_size(sig["true_prob"], sig["price"])
        size = min(size, S.capital)
        if size<C.min_bet: return
        S.capital        = round(S.capital - size, 4)
        S.locked_capital = round(S.locked_capital + size, 4)
        S.pos_counter   += 1
        pos = {
            "id":f"{'S' if C.mode=='sim' else 'R'}-{S.pos_counter:04d}",
            "market_id":market["id"],"question":market["question"],
            "category":market["category"],"outcome":sig["outcome"],
            "price":sig["price"],"true_prob":sig["true_prob"],"size":size,
            "shares":round(size/sig["price"],4) if sig["price"]>0 else 0,
            "ev":sig["ev"],"strategy":sig["strategy"],"status":"open",
            "opened_at":datetime.now(timezone.utc).isoformat(),
            "resolve_sec":market.get("resolve_sec",86400),
            "resolve_fmt":market.get("resolve_fmt","?"),
            "compound_bet":compound_max_bet_now(),
        }
        S.positions.append(pos)
        consume_gas()
        entry = add_log("OPEN",{"id":pos["id"],"question":pos["question"][:55],"outcome":pos["outcome"],"price":pos["price"],"size":pos["size"],"ev":pos["ev"],"strategy":pos["strategy"],"category":pos["category"],"resolve_fmt":pos["resolve_fmt"]})
    await broadcast({"type":"log","data":entry})
    await broadcast({"type":"positions","data":open_positions()})
    await broadcast({"type":"stats","data":get_stats()})

async def close_position(pos: dict, won: bool):
    async with _lock:
        if pos["status"]!="open": return
        size=pos["size"]; price=pos["price"]
        if won:
            payout=round(size/price,4); pnl=round(payout-size,4)
            S.capital        = round(S.capital+payout,4)
            S.locked_capital = round(S.locked_capital-size,4)
        else:
            payout=0.0; pnl=round(-size,4)
            S.locked_capital = round(S.locked_capital-size,4)
        pos["status"]="won" if won else "lost"; pos["pnl"]=pnl; pos["payout"]=payout
        pos["exit_price"]=1.0 if won else 0.0
        pos["closed_at"]=datetime.now(timezone.utc).isoformat()
        S.daily_pnl  = round(S.daily_pnl+pnl,4)
        S.lifetime_pnl=round(S.lifetime_pnl+pnl,4)
        if pos.get("strategy")=="btc5m":
            if won: S.btc5m["stats"]["wins"]=S.btc5m["stats"].get("wins",0)+1
            else:   S.btc5m["stats"]["losses"]=S.btc5m["stats"].get("losses",0)+1
        S.positions.remove(pos); S.closed_trades.append(pos)
        leveled=check_levelup(); salaried=check_salary()
        entry=add_log("CLOSE",{"id":pos["id"],"result":pos["status"],"pnl":pnl,"question":pos["question"][:50],"capital":round(total_equity(),4),"strategy":pos.get("strategy","")})
        save_state()
        db_insert_trade(pos)
    await broadcast({"type":"log","data":entry})
    if leveled: await broadcast({"type":"compound_up","data":S.compound_events[-1]})
    if salaried: await broadcast({"type":"salary","data":S.salary_events[-1]})
    await broadcast({"type":"positions","data":open_positions()})
    await broadcast({"type":"stats","data":get_stats()})

# ─── SCANNER LOOP ────────────────────────────────────────────
async def scanner_loop():
    last_fetch=0
    last_raw=[]
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as sess:
        while True:
            try:
                daily_reset()
                S.scan_count+=1
                now_ts=time.time()
                if now_ts-last_fetch>=25 or not last_raw:
                    raw=await fetch_all_markets(sess)
                    if raw: last_raw=raw; last_fetch=now_ts
                # noise in sim
                if C.mode=="sim":
                    for m in last_raw:
                        p=m.get("outcomePrices","[]")
                        if isinstance(p,str):
                            try:
                                pl=json.loads(p)
                                pl=[str(round(min(0.99,max(0.01,float(x)+random.uniform(-.007,.007))),4)) for x in pl]
                                m["outcomePrices"]=json.dumps(pl)
                            except: pass
                parsed=[_parse_market(m) for m in last_raw]
                parsed=[m for m in parsed if m]
                S.market_rows=build_rows(parsed)
                S.signals_found+=sum(1 for r in S.market_rows if r["signal"]!="—")
                # AUTO-BET — no manual trigger, fully automatic
                if not S.gas_paused:
                    acted=0
                    for row in S.market_rows:
                        if row["signal"]=="—": continue
                        if acted>=3: break
                        # probability of acting each scan — 25% per signal
                        if random.random()<0.25:
                            sig={"strategy":row["signal"],"outcome":row["outcome"],"ev":row["ev"],"true_prob":row["true_prob"],"price":row["yes_price"] if row["outcome"] in ("YES","YES+NO") else row["no_price"]}
                            await open_position(row, sig)
                            acted+=1
                await broadcast({"type":"stats","data":get_stats()})
                await broadcast({"type":"markets","data":S.market_rows[:80]})
            except Exception as e:
                S.errors.append(f"scan: {str(e)[:60]}")
            await asyncio.sleep(C.scan_sec)

async def resolver_loop():
    """Sim: resolve positions based on real estimate resolve time"""
    while True:
        now=datetime.now(timezone.utc)
        for pos in list(S.positions):
            if pos["status"]!="open": continue
            opened=datetime.fromisoformat(pos["opened_at"])
            elapsed=(now-opened).total_seconds()
            if elapsed>=pos.get("resolve_sec",86400):
                won=random.random()<(pos.get("true_prob",0.65)*0.93)
                await close_position(pos, won)
        await asyncio.sleep(5)

# ─── DATA ────────────────────────────────────────────────────
def open_positions(): return [p for p in S.positions if p["status"]=="open"]

def get_gas_info():
    tx=gas_tx_remaining()
    return {"pol_total":C.pol_balance,"pol_left":round(S.pol_left,4),"pol_used":round(C.pol_balance-S.pol_left,4),"pol_usable":round(gas_usable_pol(),4),"gas_usd":round(S.gas_used_usd,4),"tx_left":tx,"status":gas_status(),"paused":S.gas_paused,"alert_tx":C.gas_alert_tx,"stop_tx":C.gas_stop_tx}

def get_salary_info():
    eq=total_equity()
    to_next=max(0,round(S.salary_target-eq,4))
    prog=round(min(100,(eq/(S.salary_target or 100))*100),1)
    return {"next_target":S.salary_target,"current_equity":round(eq,4),"to_next":to_next,"progress_pct":prog,"total_withdrawn":round(S.total_withdrawn,4),"salary_count":len(S.salary_events),"events":S.salary_events[-5:],"projected_withdraw":round(eq*C.salary_withdraw_pct,4),"projected_keep":round(eq*C.salary_keep_pct,4)}

def get_stats():
    total=len(S.closed_trades); wins=sum(1 for t in S.closed_trades if t["status"]=="won")
    eq=total_equity(); pnl=round(eq-S.initial_capital,4)
    return {
        "mode":C.mode.upper(),"capital":round(eq,4),"available":round(S.capital,4),
        "locked":round(S.locked_capital,4),"initial":S.initial_capital,"pnl":pnl,
        "roi_pct":round(pnl/S.initial_capital*100,2) if S.initial_capital else 0,
        "lifetime_pnl":round(S.lifetime_pnl,4),"total_withdrawn":round(S.total_withdrawn,4),
        "total_trades":total,"wins":wins,"losses":total-wins,
        "win_rate":round(wins/total*100,1) if total else 0,
        "open_count":len(open_positions()),"daily_pnl":round(S.daily_pnl,4),
        "daily_stopped":S.daily_pnl<=-C.daily_loss_limit,
        "scan_count":S.scan_count,"signals_found":S.signals_found,
        "start_time":S.start_time,"errors":S.errors[-3:],
        "gas":get_gas_info(),"salary":get_salary_info(),
        "compound_tier":compound_tier_from_eq(eq),
        "compound_bet":compound_max_bet_now(),
        "compound_next":compound_next_tier_at(),
        "compound_prog":compound_progress_pct(),
        "compound_events":S.compound_events[-3:],
        "btc5m_stats":S.btc5m.get("stats",{}),
    }

# ─── ROUTES ──────────────────────────────────────────────────
@app.get("/health")
def health(): return {"status":"ok","mode":C.mode}

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

@app.get("/api/btc5m")
def api_btc5m(): return S.btc5m

@app.post("/api/gas/resume")
async def api_gas_resume():
    S.gas_paused=False
    add_log("GAS_RESUME",{"message":"Bot aktif kembali"})
    await broadcast({"type":"stats","data":get_stats()})
    return {"ok":True}

@app.post("/api/reset")
async def api_reset():
    """Reset state — mulai dari awal"""
    global S
    if STATE_FILE.exists(): STATE_FILE.unlink()
    S=BotState()
    await broadcast({"type":"stats","data":get_stats()})
    return {"ok":True}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept(); S.ws_clients.add(ws)
    try:
        await ws.send_text(json.dumps({"type":"init","data":{
            "stats":get_stats(),"positions":open_positions(),
            "log":S.log[:80],"markets":S.market_rows[:80],
            "gas":get_gas_info(),"salary":get_salary_info(),
            "history":S.closed_trades[-50:][::-1],"btc5m":S.btc5m,
        }},default=str))
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally: S.ws_clients.discard(ws)

@app.on_event("startup")
async def startup():
    db_init()
    db_register_session()
    resumed = load_state()
    asyncio.create_task(scanner_loop())
    asyncio.create_task(resolver_loop())
    asyncio.create_task(btc5m_loop())
    print(f"[Bot] Mode={C.mode} Capital=${S.capital:.2f} POL={S.pol_left}")
    print(f"[Bot] Resumed from save: {resumed}")
    print(f"[Bot] Compound: every ${C.compound_step} → +${C.compound_inc}/bet")
    print(f"[Bot] Salary: every ${C.salary_threshold} → keep {int(C.salary_keep_pct*100)}%")

# ─── SQLITE LOG ──────────────────────────────────────────────
import sqlite3, threading


_db_lock = threading.Lock()

def db_init():
    with _db_lock:
        con = sqlite3.connect(DB_PATH)
        con.execute("""CREATE TABLE IF NOT EXISTS trades (
            id TEXT, bot_id TEXT, market_id TEXT, question TEXT,
            category TEXT, strategy TEXT, outcome TEXT,
            price REAL, size REAL, ev REAL, true_prob REAL,
            status TEXT, pnl REAL, payout REAL,
            opened_at TEXT, closed_at TEXT,
            resolve_sec INTEGER, compound_tier INTEGER
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS log_events (
            ts TEXT, bot_id TEXT, event TEXT, data TEXT
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS bot_sessions (
            bot_id TEXT, mode TEXT, started_at TEXT,
            capital REAL, pol REAL, notes TEXT
        )""")
        con.commit(); con.close()

def db_insert_trade(pos: dict):
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute("""INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                pos.get("id"), os.getenv("BOT_ID","bot1"),
                pos.get("market_id"), pos.get("question","")[:120],
                pos.get("category"), pos.get("strategy"), pos.get("outcome"),
                pos.get("price"), pos.get("size"), pos.get("ev"), pos.get("true_prob"),
                pos.get("status"), pos.get("pnl"), pos.get("payout"),
                pos.get("opened_at"), pos.get("closed_at"),
                pos.get("resolve_sec"), pos.get("compound_tier"),
            ))
            con.commit(); con.close()
    except Exception as e:
        S.errors.append(f"db: {e}")

def db_log_event(event: str, data: dict):
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute("INSERT INTO log_events VALUES (?,?,?,?)", (
                datetime.now().isoformat(),
                os.getenv("BOT_ID","bot1"),
                event,
                json.dumps(data, default=str)[:500]
            ))
            con.commit(); con.close()
    except: pass

def db_register_session():
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute("INSERT INTO bot_sessions VALUES (?,?,?,?,?,?)", (
                os.getenv("BOT_ID","bot1"), C.mode,
                datetime.now().isoformat(),
                C.usdc_capital, C.pol_balance,
                os.getenv("BOT_NOTES","")
            ))
            con.commit(); con.close()
    except: pass

# ─── DB ROUTES ───────────────────────────────────────────────
@app.get("/api/db/trades")
def api_db_trades(bot_id: str = "", limit: int = 200):
    try:
        con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
        q = "SELECT * FROM trades"
        args = []
        if bot_id: q += " WHERE bot_id=?"; args.append(bot_id)
        q += " ORDER BY opened_at DESC LIMIT ?"
        args.append(limit)
        rows = [dict(r) for r in con.execute(q, args).fetchall()]
        con.close(); return rows
    except: return []

@app.get("/api/db/logs")
def api_db_logs(bot_id: str = "", limit: int = 200):
    try:
        con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
        q = "SELECT * FROM log_events"
        args = []
        if bot_id: q += " WHERE bot_id=?"; args.append(bot_id)
        q += " ORDER BY ts DESC LIMIT ?"
        args.append(limit)
        rows = [dict(r) for r in con.execute(q, args).fetchall()]
        con.close(); return rows
    except: return []

@app.get("/api/db/sessions")
def api_db_sessions():
    try:
        con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
        rows = [dict(r) for r in con.execute("SELECT * FROM bot_sessions ORDER BY started_at DESC LIMIT 50").fetchall()]
        con.close(); return rows
    except: return []

@app.get("/api/db/summary")
def api_db_summary():
    """Cross-bot summary from DB"""
    try:
        con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
        bots = con.execute("""
            SELECT bot_id,
                COUNT(*) as total,
                SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
                ROUND(SUM(pnl),4) as total_pnl,
                ROUND(AVG(pnl),4) as avg_pnl,
                ROUND(SUM(size),4) as total_bet,
                MAX(closed_at) as last_trade
            FROM trades WHERE status IN ('won','lost')
            GROUP BY bot_id
        """).fetchall()
        con.close()
        return [dict(b) for b in bots]
    except Exception as e:
        return []
