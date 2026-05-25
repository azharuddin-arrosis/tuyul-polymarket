#!/usr/bin/env python3
"""Check USDC balance across all signature types."""
import os, sys
from dotenv import load_dotenv

bot_id = sys.argv[1] if len(sys.argv) > 1 else 'real1'
load_dotenv(f'backend/envs/{bot_id}.env')

pk = os.getenv('POLY_PRIVATE_KEY').strip()
if not pk.startswith('0x'): pk = '0x' + pk
funder = os.getenv('POLY_FUNDER', '')

from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import ApiCreds, BalanceAllowanceParams, AssetType

tests = [
    (0, None,   'EOA'),
    (1, None,   'POLY_PROXY'),
    (2, None,   'SAFE'),
    (3, funder, 'POLY_1271'),
    (1, funder, 'PROXY+funder'),
]

for sig, fn, label in tests:
    if sig == 3 and (not fn or fn == ''):
        continue
    try:
        c = ClobClient(
            host='https://clob.polymarket.com', chain_id=137, key=pk,
            signature_type=sig,
            funder=fn if fn else None,
        )
        c.set_api_creds(ApiCreds(
            api_key=os.getenv('POLY_API_KEY'),
            api_secret=os.getenv('POLY_SECRET'),
            api_passphrase=os.getenv('POLY_PASSPHRASE'),
        ))
        b = c.get_balance_allowance(
            params=BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=sig)
        )
        raw = float(b.get('balance', 0) or 0)
        print(f'sig={sig} {label:<18s} ${raw/1e6:>8.2f}')
    except Exception as e:
        print(f'sig={sig} {label:<18s} ERROR: {str(e)[:80]}')
