#!/usr/bin/env python3
"""
approve_usdc.py — Set USDC allowance untuk Polymarket trading

Usage:
    cd bot/
    backend/approve_usdc.py all       # semua bot (auto-discover dari envs/real*.env)
    backend/approve_usdc.py real1     # satu bot saja
    backend/approve_usdc.py real1 real3 real7   # pilih beberapa
"""

import sys, time
from pathlib import Path

# ── Inject venv site-packages ───────────────────────────────────
_here    = Path(__file__).parent.resolve()
_venv_lib = (_here / '..' / 'venv' / 'lib').resolve()
if _venv_lib.is_dir():
    for _d in _venv_lib.iterdir():
        _sp = _d / 'site-packages'
        if _sp.is_dir() and str(_sp) not in sys.path:
            sys.path.insert(0, str(_sp)); break

try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import BalanceAllowanceParams, AssetType, ApiCreds
    from py_clob_client.constants import POLYGON
except ImportError as e:
    print(f"✗ Import error: {e}\n  pip install py-clob-client")
    sys.exit(1)

CLOB_HOST = "https://clob.polymarket.com"

# ── Resolve daftar bot ──────────────────────────────────────────
def find_env_file(bot_id: str) -> Path | None:
    candidates = [
        _here / 'envs' / f'{bot_id}.env',
        Path.cwd() / 'backend' / 'envs' / f'{bot_id}.env',
    ]
    for c in candidates:
        if c.exists(): return c
    return None

def discover_all_bots() -> list[str]:
    """Auto-discover semua real*.env di folder envs/"""
    envs_dir = _here / 'envs'
    files = sorted(envs_dir.glob('real*.env'))
    return [f.stem for f in files]  # real1, real2, dst.

args = [a for a in sys.argv[1:] if not a.startswith('-')]

if not args:
    print("Usage:")
    print("  backend/approve_usdc.py all           # semua bot")
    print("  backend/approve_usdc.py real1         # satu bot")
    print("  backend/approve_usdc.py real1 real7   # pilih beberapa")
    sys.exit(1)

if args == ['all']:
    bot_ids = discover_all_bots()
    if not bot_ids:
        print("✗ Tidak ada env file real*.env ditemukan di backend/envs/")
        sys.exit(1)
    print(f"  Auto-discovered: {', '.join(bot_ids)}\n")
else:
    bot_ids = args

# ── Load env ke dict (isolated, tidak pakai os.environ global) ─
def load_env(path: Path) -> dict:
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                env[k.strip()] = v.strip()
    return env

# ── Proses satu bot ─────────────────────────────────────────────
def approve_bot(bot_id: str) -> dict:
    """
    Returns: {
      'bot_id', 'name', 'status': 'ok'|'skip'|'fail',
      'balance', 'allow_before', 'allow_after', 'msg'
    }
    """
    result = {'bot_id': bot_id, 'name': bot_id, 'status': 'fail',
              'balance': 0, 'allow_before': 0, 'allow_after': 0, 'msg': ''}

    env_file = find_env_file(bot_id)
    if not env_file:
        result['msg'] = 'env file tidak ditemukan'
        return result

    env = load_env(env_file)
    result['name'] = env.get('BOT_NAME', bot_id)

    PK         = env.get('POLY_PRIVATE_KEY', '')
    API_KEY    = env.get('POLY_API_KEY', '')
    SECRET     = env.get('POLY_SECRET', '')
    PASSPHRASE = env.get('POLY_PASSPHRASE', '')

    if not all([PK, API_KEY, SECRET, PASSPHRASE]):
        result['msg'] = 'credentials belum lengkap di env'
        return result

    # Build client
    try:
        creds  = ApiCreds(api_key=API_KEY, api_secret=SECRET, api_passphrase=PASSPHRASE)
        client = ClobClient(host=CLOB_HOST, chain_id=POLYGON, key=PK,
                            creds=creds, signature_type=0)
        wallet = client.get_address()
        result['wallet'] = wallet
    except Exception as e:
        result['msg'] = f'gagal build client: {e}'
        return result

    # Helper get allowance
    def get_allowance():
        try:
            resp = client.get_balance_allowance(
                BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=2)
            )
            # API v2: "allowances" dict (exchange→amount), fallback to "allowance" scalar
            _allowances = resp.get('allowances') or {}
            if _allowances:
                _max = max(int(v or 0) for v in _allowances.values())
                raw = min(_max, int(1e12))  # cap MAX_UINT256 agar tidak overflow float
            else:
                raw = float(resp.get('allowance', 0) or 0)
            bal = float(resp.get('balance', 0) or 0)
            return round(raw / 1e6, 4), round(bal / 1e6, 4)
        except:
            return None, None

    allow_before, balance = get_allowance()
    if allow_before is None:
        result['msg'] = 'gagal fetch allowance (network/creds?)'
        return result

    result['balance']      = balance
    result['allow_before'] = allow_before

    # Sudah approve sebelumnya
    if allow_before > 0:
        result['status']      = 'skip'
        result['allow_after'] = allow_before
        result['msg']         = 'sudah approved sebelumnya'
        return result

    # Trigger approve
    try:
        client.update_balance_allowance(
            BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=2)
        )
    except Exception as e:
        result['msg'] = f'approve gagal: {e}'
        return result

    # Verifikasi
    time.sleep(3)
    allow_after, _ = get_allowance()
    result['allow_after'] = allow_after or 0

    if allow_after and allow_after > 0:
        result['status'] = 'ok'
        result['msg']    = 'berhasil'
    else:
        result['status'] = 'pending'
        result['msg']    = 'request terkirim, tunggu 1-2 mnt lalu cek validate_real.py'

    return result

# ── Run semua bot ───────────────────────────────────────────────
print()
print("=" * 62)
print(f"  APPROVE USDC — {len(bot_ids)} bot: {', '.join(bot_ids)}")
print("=" * 62)

results = []
for i, bot_id in enumerate(bot_ids, 1):
    print(f"\n[{i}/{len(bot_ids)}] {bot_id} ...", end=' ', flush=True)
    r = approve_bot(bot_id)
    results.append(r)

    icon = {'ok': '✅', 'skip': '⏭ ', 'pending': '⏳', 'fail': '❌'}.get(r['status'], '?')
    print(f"{icon} {r['status'].upper()}")
    print(f"         Name    : {r['name']}")
    if r.get('wallet'):
        print(f"         Wallet  : {r['wallet']}")
    print(f"         Balance : ${r['balance']:.4f} USDC")
    print(f"         Allowance: ${r['allow_before']:.4f} → ${r['allow_after']:.4f}")
    print(f"         {r['msg']}")

# ── Summary tabel ───────────────────────────────────────────────
print()
print("=" * 62)
print("  SUMMARY")
print("=" * 62)
print(f"  {'BOT':<8} {'NAME':<8} {'BAL':>8} {'ALLOW':>12} {'STATUS'}")
print(f"  {'-'*55}")
for r in results:
    icon = {'ok':'✅','skip':'⏭ ','pending':'⏳','fail':'❌'}.get(r['status'],'?')
    allow_str = f"${r['allow_after']:.2f}" if r['allow_after'] > 0 else '$0'
    print(f"  {r['bot_id']:<8} {r['name']:<8} ${r['balance']:>7.4f} {allow_str:>12}  {icon} {r['status']}")

ok    = sum(1 for r in results if r['status'] in ('ok','skip'))
fail  = sum(1 for r in results if r['status'] == 'fail')
pend  = sum(1 for r in results if r['status'] == 'pending')

print()
print(f"  ✅ Ready   : {ok}/{len(results)}")
if pend: print(f"  ⏳ Pending : {pend}  → tunggu 1-2 mnt, cek validate_real.py")
if fail: print(f"  ❌ Gagal   : {fail}  → cek credentials / deposit USDC dulu")
print()

if fail > 0 or pend > 0:
    print("  Alternatif manual (kalau script gagal):")
    print("  → buka polymarket.com → login tiap wallet → Deposit → sign approve tx")
    print()

print("  Untuk verifikasi semua bot:")
print("  for i in 1 2 3 4 5 6 7 8; do")
print("    echo \"=== real$i ===\"")
print("    backend/validate_real.py real$i 2>&1 | grep -E 'allowance|PASS|FAIL'")
print("  done")
print()
print("=" * 62)
