#!/usr/bin/env python3
"""V1 client sign + properly formatted V2 body"""
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
from py_clob_client.clob_types import OrderArgs, ApiCreds, RequestArgs
from py_clob_client.constants import POLYGON
from py_clob_client.headers.headers import create_level_2_headers
from py_clob_client.http_helpers.helpers import post as http_post
from py_clob_client.endpoints import POST_ORDER

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
print('Token:', token)

v1 = V1Client(host='https://clob.polymarket.com', chain_id=POLYGON, key=pk, signature_type=0)
v1.set_api_creds(ApiCreds(api_key=api_key, api_secret=secret, api_passphrase=passphrase))

args = OrderArgs(price=0.50, size=1.00, side='BUY', token_id=token)
signed = v1.create_order(args)
raw = signed.order.dict()

# Build V2-compatible body with correct types
body = {
    "order": {
        "salt":          int(raw["salt"]),
        "maker":         raw["maker"],
        "signer":        raw["signer"],
        "tokenId":       str(raw["tokenId"]),
        "makerAmount":   str(raw["makerAmount"]),
        "takerAmount":   str(raw["takerAmount"]),
        "side":          "BUY",
        "expiration":    str(raw.get("expiration", 0)),
        "signatureType": int(raw.get("signatureType", 0)),
        "timestamp":     str(int(time.time() * 1000)),
        "builder":       builder_code,
        "metadata":      "",
        "signature":     signed.signature if hasattr(signed, 'signature') else "",
    },
    "owner":     api_key,
    "orderType": "FOK",
    "deferExec": False,
    "postOnly":  False,
}

print('maker:', body['order']['maker'][:16])
print('signer:', body['order']['signer'][:16])
print('side:', body['order']['side'])
print('sigType:', body['order']['signatureType'])
print('signature:', body['order']['signature'][:20] + '...')

serialized = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
ra = RequestArgs(method="POST", request_path=POST_ORDER, body=body, serialized_body=serialized)
hdrs = create_level_2_headers(v1.signer, v1.creds, ra)

try:
    resp = http_post(f"https://clob.polymarket.com{POST_ORDER}", headers=hdrs, data=serialized)
    print('\nSUCCESS:', json.dumps(resp, default=str)[:400])
except Exception as e:
    print('\nERROR:', str(e)[:300])
