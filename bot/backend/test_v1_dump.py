#!/usr/bin/env python3
import os, json, time, asyncio, aiohttp
from dotenv import load_dotenv
load_dotenv('backend/envs/real1.env')

pk = os.getenv('POLY_PRIVATE_KEY').strip()
if not pk.startswith('0x'): pk = '0x' + pk

from py_clob_client.client import ClobClient as V1Client
from py_clob_client.clob_types import OrderArgs, ApiCreds
from py_clob_client.constants import POLYGON

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
v1.set_api_creds(ApiCreds(api_key=os.getenv('POLY_API_KEY'), api_secret=os.getenv('POLY_SECRET'), api_passphrase=os.getenv('POLY_PASSPHRASE')))

args = OrderArgs(price=0.50, size=1.00, side='BUY', token_id=token)
signed = v1.create_order(args)

# Dump raw order dict
raw = signed.order.dict()
print('\n=== RAW V1 order.dict() ===')
print(json.dumps(raw, indent=2, default=str))

# Also dump the signed order structure
print('\n=== SignedOrder type ===')
print(type(signed))
print(dir(signed))
