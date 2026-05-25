#!/usr/bin/env python3
"""Test script: verify Polymarket CLOB order readiness.
Usage: venv/bin/python backend/test_order.py [real1]
"""
import json, os, sys
from dotenv import load_dotenv

env_name = sys.argv[1] if len(sys.argv) > 1 else "real1"
load_dotenv(f"backend/envs/{env_name}.env")

from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import ApiCreds, OrderArgs, BalanceAllowanceParams, AssetType
from py_clob_client_v2.constants import POLYGON
from py_clob_client_v2.order_builder.constants import BUY

print("=" * 60)
print(f"  POLYMARKET ORDER READINESS TEST — {env_name}")
print("=" * 60)

# ─── 1. Env check ─────────────────────────────────────────────
pk = os.getenv("POLY_PRIVATE_KEY", "").strip()
api_key = os.getenv("POLY_API_KEY", "").strip()
secret = os.getenv("POLY_SECRET", "").strip()
passphrase = os.getenv("POLY_PASSPHRASE", "").strip()
funder = os.getenv("POLY_FUNDER", "").strip()
builder_code = os.getenv("BUILDER_CODE", "").strip()

if not pk.startswith("0x"):
    pk = "0x" + pk

from eth_account import Account
acct = Account.from_key(pk)
eoa = acct.address

print(f"  EOA (from private key): {eoa}")
print(f"  POLY_FUNDER:             {funder}")
print(f"  POLY_API_KEY:            {api_key[:12]}...")
print(f"  BUILDER_CODE:            {builder_code[:12]}...")
print()

# ─── 2. Auth test (sig_type=0) ─────────────────────────────────
print("─── 2. Auth test (EOA, sig_type=0) ───")
try:
    client0 = ClobClient(host="https://clob.polymarket.com", chain_id=137, key=pk, signature_type=0)
    client0.set_api_creds(ApiCreds(api_key=api_key, api_secret=secret, api_passphrase=passphrase))
    v = client0.get_version()
    print(f"  ✅ get_version() → {v}")
    bal = client0.get_balance_allowance(params=BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=2))
    raw = float(bal.get("balance", 0) or 0)
    print(f"  ✅ balance → ${raw / 1e6:.2f} USDC (raw: {raw})")
except Exception as e:
    print(f"  ❌ FAILED: {str(e)[:120]}")

# ─── 3. Auth test (sig_type=3 + funder) ────────────────────────
print()
print("─── 3. Deposit wallet test (sig_type=3) ───")
if not funder:
    print("  ⚠ POLY_FUNDER not set — skipping")
else:
    try:
        client3 = ClobClient(host="https://clob.polymarket.com", chain_id=137, key=pk, signature_type=3, funder=funder)
        client3.set_api_creds(ApiCreds(api_key=api_key, api_secret=secret, api_passphrase=passphrase))

        # Balance sync
        try:
            client3.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=3))
            print(f"  ✅ update_balance_allowance(sig=3) OK")
        except Exception as e:
            print(f"  ⚠ update_balance_allowance: {str(e)[:80]}")

        # Check balance with sig_type=3
        try:
            bal3 = client3.get_balance_allowance(params=BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=3))
            raw3 = float(bal3.get("balance", 0) or 0)
            print(f"  ✅ balance(sig=3) → ${raw3 / 1e6:.2f} USDC")
        except Exception as e:
            print(f"  ⚠ balance(sig=3): {str(e)[:80]}")
    except Exception as e:
        print(f"  ❌ Client init failed: {str(e)[:120]}")

# ─── 4. Order build test (dry, no POST) ────────────────────────
print()
print("─── 4. Order struct check (dry build, no POST) ───")
try:
    from py_clob_client_v2.order_builder.builder import OrderBuilder
    from py_clob_client_v2.signer import Signer
    from py_clob_client_v2.order_utils.model.signature_type_v2 import SignatureTypeV2
    from py_clob_client_v2.clob_types import CreateOrderOptions
    from py_clob_client_v2.order_utils.model.order_data_v2 import order_to_json_v2

    signer = Signer(pk, chain_id=137)
    builder = OrderBuilder(signer, signature_type=SignatureTypeV2.POLY_1271 if funder else SignatureTypeV2.EOA, funder=funder or None)

    args = OrderArgs(token_id="1234567890", price=0.50, size=1.00, side=BUY, builder_code=builder_code or "0x"+"0"*64)
    opts = CreateOrderOptions(tick_size="0.01", neg_risk=False)

    signed = builder.build_order(args, opts, version=2)
    body = order_to_json_v2(signed, api_key, "FOK", False, False)
    o = body["order"]

    print(f"  signatureType: {o['signatureType']}")
    print(f"  maker:         {o['maker']}")
    print(f"  signer:        {o['signer']}")
    print(f"  timestamp:     {o['timestamp']}")
    print(f"  builder:       {o['builder'][:20]}...")
    has_ts   = bool(o.get("timestamp"))
    has_bld  = bool(o.get("builder"))
    sig_ok   = int(o["signatureType"]) in (0, 3)
    match_ok = o["maker"].lower() == o["signer"].lower()

    print()
    checks = [
        ("timestamp present", has_ts),
        ("builder present", has_bld),
        ("signatureType valid", sig_ok),
        ("maker == signer", match_ok),
    ]
    for label, ok in checks:
        print(f"  {'✅' if ok else '❌'} {label}")

    # Show sample JSON body (truncated signature)
    body["order"]["signature"] = body["order"]["signature"][:20] + "...(truncated)"
    print()
    print("  Sample order JSON:")
    print("  " + json.dumps(body, indent=4).replace("\n", "\n  ")[:800])

except Exception as e:
    print(f"  ❌ Build failed: {str(e)[:120]}")

# ─── 5. Real order test (OPTIONAL) ─────────────────────────────
print()
print("─── 5. Real FOK order test ───")
real_test = os.getenv("TEST_REAL_ORDER", "").lower() == "true"
if not real_test:
    print("  Skipped. Set TEST_REAL_ORDER=true in env to test.")
    print("  WARNING: This will place a REAL order with real money!")
else:
    if not funder:
        print("  ❌ POLY_FUNDER not set")
    else:
    import aiohttp, asyncio as _asyncio

    async def _find_and_order():
        async with aiohttp.ClientSession() as sess:
            ts = int(__import__("time").time()) // 300 * 300
            slug = "btc-updown-5m-" + str(ts)
            try:
                async with sess.get("https://gamma-api.polymarket.com/events",
                                   params={"slug": slug, "limit": 1}) as r:
                    data = await r.json()
                    evs = data if isinstance(data, list) else []
                    for m in evs[0].get("markets", []):
                        raw_ids = m.get("clobTokenIds", "[]")
                        if isinstance(raw_ids, str): raw_ids = json.loads(raw_ids)
                        outs = m.get("outcomes", "[]")
                        if isinstance(outs, str): outs = json.loads(outs)
                        for idx, o in enumerate(outs):
                            if idx < len(raw_ids) and raw_ids[idx]:
                                token = raw_ids[idx]
                                print(f"  Found: token={token} outcome={o}")
                                print(f"  Placing FOK BUY $1.00@50¢ ...")

                                svc = os.getenv("ORDER_SERVICE_URL", "http://127.0.0.1:3100")
                                body = json.dumps({"token_id": token, "price": 0.50, "size": 1.00, "side": "BUY", "order_type": "FOK"})
                                async with sess.post(f"{svc}/order", data=body,
                                                     headers={"Content-Type": "application/json"}) as r2:
                                    resp = await r2.json()
                                print(f"  Response: {json.dumps(resp, default=str)[:400]}")
                                if resp.get("ok"):
                                    print(f"  ✅ SUCCESS — orderID: {resp.get('orderID','?')[:20]}...")
                                else:
                                    print(f"  ❌ FAILED — {resp.get('error','?')}")
                                return
            except Exception as e:
                print(f"  ❌ {str(e)[:200]}")
            print("  ❌ No active BTC5m market")

    _asyncio.run(_find_and_order())

print()
print("=" * 60)
print("  DONE")
print("=" * 60)
