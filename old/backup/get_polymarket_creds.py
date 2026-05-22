import os
from py_clob_client.client import ClobClient
from py_clob_client.constants import POLYGON
from py_clob_client.exceptions import PolyException
from dotenv import load_dotenv

# ==========================================================
# ⚠️ PENGATURAN CREDENTIALS (HARUS DIISI)
# ==========================================================
# Link Panduan: https://polymarket.com/settings
PRIVATE_KEY = ""    # Masukkan Private Key Phantom kamu (64 karakter)
FUNDER_ADDRESS = "" # Masukkan Proxy Wallet Address dari Settings Polymarket
# ==========================================================

def get_credentials():
    print("🚀 Memulai proses pembuatan API Credentials...")
    
    if not PRIVATE_KEY or not FUNDER_ADDRESS:
        print("❌ ERROR: Private Key atau Funder Address belum diisi!")
        print("Silakan edit file ini dan masukkan data kamu di baris 11-12.")
        return

    # Inisialisasi client L1 (hanya butuh PK & Funder)
    host = "https://clob.polymarket.com"
    client = ClobClient(host, key=PRIVATE_KEY, chain_id=POLYGON, funder=FUNDER_ADDRESS)

    try:
        # 1. Create API Keys (L2)
        print("🔐 Sedang men-generate API Key baru di Polymarket...")
        creds = client.create_api_key()
        
        # 2. Extract detail
        api_key = creds.api_key
        api_secret = creds.api_secret
        api_passphrase = creds.api_passphrase
        
        # 3. Check Saldo (Verifikasi koneksi)
        print("💰 Mengecek saldo USDC di Polymarket...")
        # Re-init client dengan full credentials L2
        full_client = ClobClient(
            host, 
            key=PRIVATE_KEY, 
            chain_id=POLYGON, 
            funder=FUNDER_ADDRESS,
            api_key=api_key,
            api_secret=api_secret,
            api_passphrase=api_passphrase
        )
        
        # 4. Save to .env
        env_content = f"""# POLYMARKET REAL TRADING CREDENTIALS
POLY_PK={PRIVATE_KEY if PRIVATE_KEY.startswith('0x') else '0x'+PRIVATE_KEY}
POLY_FUNDER_ADDRESS={FUNDER_ADDRESS}
POLY_SIGNATURE_TYPE=0
POLY_API_KEY={api_key}
POLY_API_SECRET={api_secret}
POLY_API_PASSPHRASE={api_passphrase}

# CLOB ENDPOINTS
CLOB_HTTP_URL=https://clob.polymarket.com
CLOB_WS_URL=wss://clob.polymarket.com
CHAIN_ID=137
RPC_URL=https://polygon-rpc.com
USDC_CONTRACT=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
"""
        with open(".env", "w") as f:
            f.write(env_content)

        print("\n✅ CREDENTIALS BERHASIL DIBUAT!")
        print(f"  POLY_API_KEY         = {api_key}")
        print(f"  POLY_API_SECRET      = {'*' * 20} (Tersembunyi)")
        print(f"  POLY_API_PASSPHRASE  = {'*' * 20} (Tersembunyi)")
        print("\n💾 File .env berhasil disimpan di direktori ini.")
        print("⚠️  JANGAN PERNAH SHARE FILE .env INI KE SIAPAPUN!")

    except PolyException as e:
        print(f"\n❌ ERROR DARI POLYMARKET: {e}")
    except Exception as e:
        print(f"\n❌ ERROR TERJADI: {e}")

if __name__ == "__main__":
    get_credentials()
