#!/usr/bin/env python3
import sys, os as _os

# Inject venv site-packages so script works without activate
_here = _os.path.dirname(_os.path.abspath(__file__))
_venv_lib = _os.path.normpath(_os.path.join(_here, '..', 'venv', 'lib'))
if _os.path.isdir(_venv_lib):
    for _d in _os.listdir(_venv_lib):
        _sp = _os.path.join(_venv_lib, _d, 'site-packages')
        if _os.path.isdir(_sp) and _sp not in sys.path:
            sys.path.insert(0, _sp); break

# Auto-load env file — usage: ./validate_real.py [bot_id]
# Examples:
#   ./validate_real.py real1          (from backend/ or bot/)
#   backend/validate_real.py real1    (from bot/)
_bot_id = None
for _arg in sys.argv[1:]:
    if not _arg.startswith('-'):
        _bot_id = _arg; break

if _bot_id:
    # Try envs/{bot_id}.env — envs/ now lives in backend/
    _candidates = [
        _os.path.join(_here, 'envs', f'{_bot_id}.env'),                 # from backend/
        _os.path.join(_os.getcwd(), 'backend', 'envs', f'{_bot_id}.env'),# from bot/
        _os.path.join(_here, '..', 'envs', f'{_bot_id}.env'),           # legacy fallback (bot/envs/)
    ]
    _loaded = False
    for _ef in _candidates:
        _ef = _os.path.normpath(_ef)
        if _os.path.exists(_ef):
            with open(_ef) as _f:
                for _line in _f:
                    _line = _line.strip()
                    if _line and not _line.startswith('#') and '=' in _line:
                        _k, _, _v = _line.partition('=')
                        _os.environ.setdefault(_k.strip(), _v.strip())
            print(f"  → loaded {_ef}")
            _loaded = True; break
    if not _loaded:
        print(f"  ✗ env file not found for '{_bot_id}' (checked {_candidates[0]})")
        sys.exit(1)
elif not _os.environ.get('POLY_PRIVATE_KEY'):
    print("Usage: ./validate_real.py <bot_id>")
    print("       ./validate_real.py real1")
    print()
    print("Or source env manually:")
    print("  set -a; source envs/real1.env; set +a")
    print("  ./validate_real.py")
    sys.exit(1)

"""
Polypox Terminal — Real Mode Pre-flight Validator

Usage:
    cd bot/backend
    set -a; source envs/real1.env; set +a
    ../venv/bin/python validate_real.py

What it checks (NO order placement, NO state mutation):
    1. Python deps present (py_clob_client, web3)
    2. Env vars set (POLY_PRIVATE_KEY, POLY_API_KEY, POLY_SECRET, POLY_PASSPHRASE)
    3. CLOB client builds + returns EOA address
    4. USDC balance fetched from Polymarket proxy (signature_type=2)
    5. POL/MATIC balance fetched from Polygon RPC
    6. Gamma API reachable, returns active BTC 5m market dgn outcomes UP/DOWN
    7. CLOB public orderbook endpoint reachable for active market token
    8. CLOB client.get_open_orders() works (auth verify, no side effect)

Exit code: 0 if all green, 1 if any red. Suitable untuk CI gate or pre-startup hook.
"""

import asyncio
import os
import sys
import json
import time
import urllib.request
from datetime import datetime, timezone

# ─── Colors ──────────────────────────────────────────────────
class C:
    G = '\033[92m'  # green
    R = '\033[91m'  # red
    Y = '\033[93m'  # yellow
    B = '\033[94m'  # blue
    D = '\033[2m'   # dim
    X = '\033[0m'   # reset
    BOLD = '\033[1m'

PASS = f"{C.G}✓{C.X}"
FAIL = f"{C.R}✗{C.X}"
WARN = f"{C.Y}!{C.X}"

results = []  # [(label, ok, detail)]

def check(label, ok, detail=""):
    icon = PASS if ok else FAIL
    print(f"  {icon} {label}{(C.D + ' — ' + detail + C.X) if detail else ''}")
    results.append((label, ok, detail))
    return ok

def section(name):
    print(f"\n{C.BOLD}{C.B}=== {name} ==={C.X}")

def fetal_exit():
    print(f"\n{C.R}{C.BOLD}STOP.{C.X} Fix failures above before running real mode.")
    sys.exit(1)

# ─── 1. Deps & env ───────────────────────────────────────────
section("1. Dependencies & Environment")

try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import ApiCreds, BalanceAllowanceParams, AssetType
    CLOB_OK = True
except Exception as e:
    CLOB_OK = False
check("py_clob_client import", CLOB_OK)

try:
    from eth_account import Account as EthAccount
    WEB3_OK = True
except Exception as e:
    WEB3_OK = False
check("eth_account import", WEB3_OK)

if not (CLOB_OK and WEB3_OK):
    fetal_exit()

PK   = os.getenv("POLY_PRIVATE_KEY", "")
APIK = os.getenv("POLY_API_KEY", "")
SEC  = os.getenv("POLY_SECRET", "")
PASS_ = os.getenv("POLY_PASSPHRASE", "")
RPC  = os.getenv("POLYGON_RPC", "https://polygon-rpc.com")

check("POLY_PRIVATE_KEY set", bool(PK), f"len={len(PK)} chars")
check("POLY_API_KEY set",     bool(APIK), f"prefix={APIK[:8]}…" if APIK else "")
check("POLY_SECRET set",      bool(SEC))
check("POLY_PASSPHRASE set",  bool(PASS_))

if not all([PK, APIK, SEC, PASS_]):
    fetal_exit()

# ─── 2. CLOB client build + address ──────────────────────────
section("2. CLOB Client + Wallet Address")

CLOB_HOST = "https://clob.polymarket.com"
POLYGON_CHAIN = 137

client = None
addr   = ""
try:
    client = ClobClient(host=CLOB_HOST, chain_id=POLYGON_CHAIN, key=PK, signature_type=2)
    client.set_api_creds(ApiCreds(api_key=APIK, api_secret=SEC, api_passphrase=PASS_))
    addr = client.get_address()
    ok_client = bool(addr and addr.startswith("0x"))
except Exception as e:
    ok_client = False
    addr = str(e)[:80]
check("CLOB client build + get_address", ok_client, f"address={addr}")

if not ok_client:
    fetal_exit()

# ─── 3. USDC balance (proxy wallet) ──────────────────────────
section("3. USDC Balance (Polymarket Proxy)")

usdc_balance = 0.0
try:
    params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=2)
    data = client.get_balance_allowance(params=params)
    raw = float(data.get("balance", 0) or 0)
    usdc_balance = round(raw, 4)
    ok_usdc = True
except Exception as e:
    ok_usdc = False
    usdc_balance = -1
    print(f"    {C.D}error: {str(e)[:120]}{C.X}")

check(f"USDC balance fetched", ok_usdc, f"${usdc_balance:.4f}")
if ok_usdc and usdc_balance < 1.0:
    print(f"    {WARN} {C.Y}USDC < $1 — may not be enough for trading{C.X}")

# ─── 4. POL balance (Polygon RPC) ────────────────────────────
section("4. POL/MATIC Balance (Polygon RPC)")

pol_balance = 0.0
eoa = "???"
ok_pol = False
# Polygon public RPC fallback chain — polygon-rpc.com now requires API key (401)
RPC_FALLBACKS = [
    RPC,
    "https://polygon.llamarpc.com",
    "https://polygon-bor-rpc.publicnode.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon.drpc.org",
]
try:
    acct = EthAccount.from_key(PK)
    eoa  = acct.address
except Exception as e:
    print(f"    {C.D}eth_account error: {str(e)[:120]}{C.X}")

payload = {"jsonrpc": "2.0", "method": "eth_getBalance",
           "params": [eoa, "latest"], "id": 1}
rpc_used = ""
last_err = ""
for rpc_url in RPC_FALLBACKS:
    try:
        req = urllib.request.Request(rpc_url, data=json.dumps(payload).encode(),
                                      headers={"Content-Type": "application/json",
                                               "User-Agent": "Mozilla/5.0 polypox-validator",
                                               "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        if "result" in data:
            wei = int(data["result"], 16)
            pol_balance = round(wei / 1e18, 6)
            ok_pol = True; rpc_used = rpc_url
            break
        last_err = data.get("error", {}).get("message", "no result")
    except Exception as e:
        last_err = f"{rpc_url.split('//')[-1][:30]}: {str(e)[:50]}"
        continue
if not ok_pol:
    pol_balance = -1
    print(f"    {C.D}all RPCs failed. last: {last_err}{C.X}")

check(f"POL balance fetched (EOA {eoa[:10] if ok_pol else '???'}…)", ok_pol,
      f"{pol_balance} POL via {rpc_used.split('//')[-1] if rpc_used else 'NONE'}")
if ok_pol and pol_balance < 0.05:
    print(f"    {WARN} {C.Y}POL < 0.05 — gas akan habis cepat (≈10 orders){C.X}")
elif ok_pol and pol_balance < 0.5:
    print(f"    {WARN} {C.Y}POL < 0.5 — consider top-up{C.X}")

# ─── 5. Gamma API: active BTC 5m market ──────────────────────
section("5. Gamma API: Active BTC 5m Market")

UA = "Mozilla/5.0 polypox-validator"
now_ts = int(time.time())
win_ts = now_ts - (now_ts % 300)
slug   = f"btc-updown-5m-{win_ts}"
secs_left = win_ts + 300 - now_ts

mkt_data = None
clob_token_ids = []
outcomes_seen  = []
try:
    req = urllib.request.Request(
        f"https://gamma-api.polymarket.com/events?slug={slug}&limit=1",
        headers={"User-Agent": UA, "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        events = json.loads(r.read())
    if events:
        mkt_data = events[0].get("markets", [{}])[0]
        outs = mkt_data.get("outcomes")
        if isinstance(outs, str): outs = json.loads(outs)
        outcomes_seen = outs or []
        ids = mkt_data.get("clobTokenIds")
        if isinstance(ids, str): ids = json.loads(ids)
        clob_token_ids = ids or []
    ok_gamma = bool(mkt_data and outcomes_seen and clob_token_ids)
except Exception as e:
    ok_gamma = False
    print(f"    {C.D}error: {str(e)[:120]}{C.X}")

check(f"Gamma /events?slug={slug}", ok_gamma,
      f"outcomes={outcomes_seen} | tokens={len(clob_token_ids)} | secs_left={secs_left}s")

if not ok_gamma:
    print(f"    {WARN} {C.Y}Market mungkin belum dibuat untuk window ini — coba lagi setelah window berikutnya{C.X}")

# ─── 6. CLOB public orderbook ────────────────────────────────
section("6. CLOB Public Orderbook")

ok_book = False
if ok_gamma and clob_token_ids:
    for label, tid in zip(outcomes_seen, clob_token_ids):
        try:
            req = urllib.request.Request(
                f"{CLOB_HOST}/book?token_id={tid}",
                headers={"User-Agent": UA, "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=8) as r:
                book = json.loads(r.read())
            bids = book.get("bids", []); asks = book.get("asks", [])
            n_bids = len(bids); n_asks = len(asks)
            best_bid = bids[-1].get("price") if bids else "—"
            best_ask = asks[-1].get("price") if asks else "—"
            ok_one = n_bids > 0 and n_asks > 0
            ok_book = ok_book or ok_one
            check(f"CLOB /book for {label}", ok_one,
                  f"bids={n_bids} asks={n_asks} | best bid={best_bid} ask={best_ask}")
        except Exception as e:
            check(f"CLOB /book for {label}", False, str(e)[:60])
else:
    check("CLOB /book", False, "skipped — gamma failed")

# ─── 7. CLOB authenticated call (get_open_orders) ────────────
section("7. CLOB Authenticated Endpoint")

try:
    orders = client.get_orders() if hasattr(client, "get_orders") else None
    if orders is None and hasattr(client, "get_open_orders"):
        orders = client.get_open_orders()
    ok_auth = orders is not None
    n = len(orders) if isinstance(orders, list) else "?"
except Exception as e:
    ok_auth = False
    n = "—"
    print(f"    {C.D}error: {str(e)[:120]}{C.X}")
check("CLOB get_orders() (auth)", ok_auth, f"open_orders_count={n}")

# ─── 8. USDC Allowance check ──────────────────────────────────
section("8. USDC Allowance (Proxy Contract)")

ok_allowance = False
allowance_val = 0.0
try:
    from py_clob_client.clob_types import BalanceAllowanceParams, AssetType
    params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=2)
    data = client.get_balance_allowance(params=params)
    allowance_val = float(data.get("allowance", 0) or 0)
    ok_allowance = allowance_val > 0
except Exception as e:
    print(f"    {C.D}error: {str(e)[:120]}{C.X}")
check("USDC allowance > 0", ok_allowance, f"allowance=${allowance_val:.4f}")
if not ok_allowance:
    print(f"    {WARN} {C.Y}Approve USDC di Polymarket UI sebelum trade pertama{C.X}")

# ─── 9. Binance connectivity ──────────────────────────────────
section("9. Binance API (Primary Data Source)")

BINANCE = "https://api.binance.com/api/v3"
BN_UA = {"User-Agent": "Mozilla/5.0 polypox-validator", "Accept": "application/json"}

ok_bn_price = False
ok_bn_klines = False
bn_price = 0.0
bn_klines_n = 0

try:
    req = urllib.request.Request(f"{BINANCE}/ticker/price?symbol=BTCUSDT", headers=BN_UA)
    with urllib.request.urlopen(req, timeout=8) as r:
        data = json.loads(r.read())
    bn_price = float(data.get("price", 0))
    ok_bn_price = bn_price > 0
except Exception as e:
    print(f"    {C.D}price error: {str(e)[:80]}{C.X}")
check("Binance /ticker/price BTCUSDT", ok_bn_price, f"price=${bn_price:,.2f}" if ok_bn_price else "UNREACHABLE — use VPN SG")

try:
    req = urllib.request.Request(f"{BINANCE}/klines?symbol=BTCUSDT&interval=1m&limit=5", headers=BN_UA)
    with urllib.request.urlopen(req, timeout=8) as r:
        data = json.loads(r.read())
    bn_klines_n = len(data)
    ok_bn_klines = bn_klines_n > 0
except Exception as e:
    print(f"    {C.D}klines error: {str(e)[:80]}{C.X}")
check("Binance /klines 1m BTCUSDT", ok_bn_klines, f"returned {bn_klines_n} candles" if ok_bn_klines else "UNREACHABLE — use VPN SG")

# ─── 10. CLOB /markets/{condition_id} reachability ───────────
section("10. CLOB Market Resolution Endpoint")

# CLOB uses conditionId (0x hex) — NOT Gamma integer id
ok_mkt_ep   = False
condition_id = mkt_data.get("conditionId", "") if mkt_data else ""
if ok_gamma and condition_id:
    try:
        req = urllib.request.Request(
            f"{CLOB_HOST}/markets/{condition_id}",
            headers={"User-Agent": UA, "Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            mkt_ep = json.loads(r.read())
        closed = mkt_ep.get("closed", False)
        ok_mkt_ep = "closed" in mkt_ep or "conditionId" in mkt_ep
        check(f"CLOB /markets/{condition_id[:14]}…", ok_mkt_ep,
              f"closed={closed} — resolution endpoint reachable")
    except Exception as e:
        check(f"CLOB /markets/{condition_id[:14]}…", False, str(e)[:80])
else:
    check("CLOB /markets/{condition_id}", False, "skipped — no conditionId from gamma")

# ─── 11. Order sign test (no submission) ─────────────────────
section("11. Order Signing (No Submission)")

ok_sign = False
if ok_gamma and clob_token_ids and CLOB_OK:
    try:
        from py_clob_client.clob_types import OrderArgs
        token_id = clob_token_ids[0]
        args = OrderArgs(price=0.50, size=1.0, side="BUY", token_id=token_id)
        signed = client.create_order(args)
        ok_sign = signed is not None
        check("client.create_order() sign test", ok_sign,
              "order signed locally — NOT submitted to CLOB")
    except Exception as e:
        check("client.create_order() sign test", False, str(e)[:100])
else:
    check("Order signing", False, "skipped — missing token_id or CLOB client")

# ─── Summary + Endpoint Status Table ─────────────────────────
print(f"\n{C.BOLD}{C.B}=== Endpoint Status ==={C.X}")
endpoints = [
    ("GET  gamma-api.polymarket.com/events",      ok_gamma,      "market discovery"),
    ("GET  api.binance.com/api/v3/ticker/price",  ok_bn_price,   "BTC price (primary)"),
    ("GET  api.binance.com/api/v3/klines",        ok_bn_klines,  "1m OHLCV (primary)"),
    ("GET  clob.polymarket.com/book",             ok_book,       "orderbook YES/NO"),
    ("GET  clob.polymarket.com/markets/{id}",     ok_mkt_ep,     "resolution check"),
    ("     get_balance_allowance balance",        ok_usdc,       f"${usdc_balance:.2f} USDC"),
    ("     get_balance_allowance allowance",      ok_allowance,   f"${allowance_val:.2f} approved"),
    ("     eth_getBalance Polygon RPC",           ok_pol,        f"{pol_balance:.4f} POL"),
    ("     get_orders() authenticated",           ok_auth,       "CLOB auth"),
    ("     create_order() signing",               ok_sign,       "tx signing"),
]
for ep, ok, note in endpoints:
    status = f"{C.G}UP  {C.X}" if ok else f"{C.R}DOWN{C.X}"
    print(f"  [{status}] {ep:<48} {C.D}{note}{C.X}")

print(f"\n{C.BOLD}{C.B}=== Summary ==={C.X}")
n_pass = sum(1 for _, ok, _ in results if ok)
n_fail = sum(1 for _, ok, _ in results if not ok)
print(f"  {C.G}PASS{C.X} {n_pass}   {C.R}FAIL{C.X} {n_fail}")
print(f"  Wallet:   {C.BOLD}{addr}{C.X}")
print(f"  USDC:     {C.BOLD}${usdc_balance:.4f}{C.X} (proxy)   Allowance: ${allowance_val:.4f}")
print(f"  POL:      {C.BOLD}{pol_balance} POL{C.X} (EOA gas)")
print(f"  Binance:  {'✓ reachable' if ok_bn_price else '✗ blocked — enable VPN SG'}")
print(f"  BTC slug: {C.BOLD}{slug}{C.X} ({secs_left}s left)")

if n_fail == 0:
    print(f"\n{C.G}{C.BOLD}✓ READY for real mode.{C.X}")
    print(f"  Polymarket UI:  https://polymarket.com")
    print(f"  Polygonscan:    https://polygonscan.com/address/{addr}")
    sys.exit(0)
else:
    # Binance failure is non-blocking if VPN will be active during run
    non_bn = [(l, ok, d) for l, ok, d in results if "Binance" not in l and not ok]
    if not non_bn:
        print(f"\n{C.Y}{C.BOLD}⚠ READY with caveat: enable VPN SG before ./run.sh (Binance blocked){C.X}")
        sys.exit(0)
    print(f"\n{C.R}{C.BOLD}{n_fail} check(s) failed.{C.X} Fix before real mode.")
    sys.exit(1)
