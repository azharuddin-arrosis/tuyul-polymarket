#!/usr/bin/env python3
"""Test: V1 py-clob-client (0.34.6) for signing + manual V2-compatible CLOB body"""
import os, json, time, asyncio, aiohttp
from dotenv import load_dotenv
load_dotenv('backend/envs/real1.env')

pk = os.getenv('POLY_PRIVATE_KEY').strip()
if not pk.startswith('0x'): pk = '0x' + pk
api_key = os.getenv('POLY_API_KEY')
secret = os.getenv('POLY_SECRET')
passphrase = os.getenv('POLY_PASSPHRASE')
builder_code = os.getenv('BUILDER_CODE', '0x' + '0'*64)

from py_clob_client.client import ClobClient as V1Client
from py_clob_client.clob_types import OrderArgs, OrderType, ApiCreds, RequestArgs
from py_clob_client.constants import POLYGON
from py_clob_client.headers.headers import create_level_2_headers
from py_clob_client.http_helpers.helpers import post as http_post
from py_clob_client.endpoints import POST_ORDER
from py_clob_client.signer import Signer as V1Signer

# Get fresh token
async def get_token():
    async with aiohttp.ClientSession() as s:
        ts = int(time.time()) // 300 * 300
        async with s.get(f'https://gamma-api.polymarket.com/events?slug=btc-updown-5m-{ts}&limit=1') as r:
            d = await r.json()
            for m in d[0].get('markets', []):
                ids = json.loads(m.get('clobTokenIds', '[]')) if isinstance(m.get('clobTokenIds'), str) else m.get('clobTokenIds', [])
                return ids[0] if ids else None
    return None

token = asyncio.run(get_token())
print(f'Token: {token}')

# V1 client for signing
v1 = V1Client(host='https://clob.polymarket.com', chain_id=POLYGON, key=pk, signature_type=0)
v1.set_api_creds(ApiCreds(api_key=api_key, api_secret=secret, api_passphrase=passphrase))

# Create and sign order using V1
fok_args = OrderArgs(price=0.50, size=1.00, side='BUY', token_id=token)
signed = v1.create_order(fok_args)

# Build V2-compatible body manually
order_dict = signed.order.dict()
# Remove V1-only fields
order_dict.pop('taker', None)
order_dict.pop('nonce', None)
order_dict.pop('feeRateBps', None)
# Add V2 required fields
order_dict['timestamp'] = str(int(time.time() * 1000))
order_dict['builder'] = builder_code
order_dict['metadata'] = ''

body = {
    "order": order_dict,
    "owner": api_key,
    "orderType": "FOK",
    "deferExec": False,
    "postOnly": False,
}

maker = order_dict.get('maker', '?')
signer = order_dict.get('signer', '?')
sig_type = order_dict.get('signatureType', '?')
ts = order_dict.get('timestamp', '?')
bld = order_dict.get('builder', '')
print('maker: ' + str(maker)[:16] + '...')
print('signer: ' + str(signer)[:16] + '...')
print('signatureType: ' + str(sig_type))
print('timestamp: ' + str(ts))
print('builder: ' + str(bld)[:20] + '...')

# POST to CLOB
serialized = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
ra = RequestArgs(method="POST", request_path=POST_ORDER, body=body, serialized_body=serialized)
hdrs = create_level_2_headers(v1.signer, v1.creds, ra)

try:
    resp = http_post(f"https://clob.polymarket.com{POST_ORDER}", headers=hdrs, data=serialized)
    print()
    print('SUCCESS:', json.dumps(resp, default=str)[:400])
except Exception as e:
    print()
    print('ERROR:', str(e)[:300])
