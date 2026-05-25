#!/usr/bin/env python3
"""Generate a valid curl command for CLOB POST /order with proper HMAC headers."""
import os, json, time, hmac, hashlib, base64, urllib.request, sys
from dotenv import load_dotenv

bot_id = sys.argv[1] if len(sys.argv) > 1 else 'real1'
load_dotenv(f'backend/envs/{bot_id}.env')

pk = os.getenv('POLY_PRIVATE_KEY').strip()
if not pk.startswith('0x'): pk = '0x' + pk
api_key = os.getenv('POLY_API_KEY')
secret = os.getenv('POLY_SECRET')
passphrase = os.getenv('POLY_PASSPHRASE')
builder_code = os.getenv('BUILDER_CODE', '0x' + '0' * 64)

addr = None
try:
    from eth_account import Account
    addr = Account.from_key(pk).address
except Exception:
    addr = '0x...'

# Get fresh token from Gamma
ts = int(time.time()) // 300 * 300
req = urllib.request.Request(
    f'https://gamma-api.polymarket.com/events?slug=btc-updown-5m-{ts}&limit=1',
    headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
try:
    r = urllib.request.urlopen(req, timeout=10)
    d = json.loads(r.read())
    token = None
    for m in d[0].get('markets', []):
        ids = json.loads(m.get('clobTokenIds', '[]')) if isinstance(m.get('clobTokenIds'), str) else m.get('clobTokenIds', [])
        token = ids[0] if ids else None
        break
except Exception as e:
    print(f'ERROR fetching token: {e}')
    sys.exit(1)

if not token:
    print('No active market found')
    sys.exit(1)

# Build and sign order with V2 client (sig_type=0)
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import OrderArgs, ApiCreds
from py_clob_client_v2.constants import POLYGON

c = ClobClient(host='https://clob.polymarket.com', chain_id=137, key=pk, signature_type=0)
c.set_api_creds(ApiCreds(api_key=api_key, api_secret=secret, api_passphrase=passphrase))
signed = c.create_order(OrderArgs(token_id=token, price=0.50, size=1.00, side='BUY'))

# Build order body (V2 format)
raw = signed.order.dict()
raw['timestamp'] = str(int(time.time() * 1000))
raw['builder'] = builder_code
raw['metadata'] = ''
raw['tokenId'] = str(raw['tokenId'])
raw['makerAmount'] = str(raw['makerAmount'])
raw['takerAmount'] = str(raw['takerAmount'])
raw['expiration'] = str(raw.get('expiration', 0))
raw['side'] = 'BUY'
raw.pop('taker', None)
raw.pop('nonce', None)
raw.pop('feeRateBps', None)
raw['signature'] = signed.signature

body = {
    'order': raw,
    'owner': api_key,
    'orderType': 'FOK',
    'deferExec': False,
    'postOnly': False,
}

# Compute HMAC L2 headers
now_ts = int(time.time())
body_str = json.dumps(body, separators=(',', ':'), ensure_ascii=False)
hmac_sig = base64.b64encode(
    hmac.new(base64.b64decode(secret),
             f'{now_ts}POST/order{body_str}'.encode(),
             hashlib.sha256).digest()
).decode()

# Output curl
print(f'POLY_ADDRESS={addr}')
print(f'Token={token}')
print()
print('curl -s -X POST https://clob.polymarket.com/order \\')
print(f'  -H "POLY_ADDRESS: {addr}" \\')
print(f'  -H "POLY_API_KEY: {api_key}" \\')
print(f'  -H "POLY_PASSPHRASE: {passphrase}" \\')
print(f'  -H "POLY_TIMESTAMP: {now_ts}" \\')
print(f'  -H "POLY_SIGNATURE: {hmac_sig}" \\')
print(f"  -H 'Content-Type: application/json' \\")
print(f"  -d '{body_str}'")
