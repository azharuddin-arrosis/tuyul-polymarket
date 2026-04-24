import os
import sys
import hashlib
import hmac
import json
from eth_account import Account
from web3 import Web3

def derive_credentials(private_key: str) -> dict:
    if private_key.startswith("0x"):
        private_key = private_key[2:]
    
    key_bytes = bytes.fromhex(private_key)
    
    api_key = hashlib.sha256(key_bytes[:32]).hexdigest()[:16]
    api_secret = hashlib.sha256(key_bytes).hexdigest()
    api_passphrase = hashlib.sha256(key_bytes[::-1]).hexdigest()[:8]
    
    account = Account.from_key(key_bytes)
    funder_address = account.address
    
    return {
        "POLY_PRIVATE_KEY": f"0x{private_key}",
        "POLY_API_KEY": api_key,
        "POLY_API_SECRET": api_secret,
        "POLY_API_PASSPHRASE": api_passphrase,
        "POLY_FUNDER_ADDRESS": funder_address,
        "POLY_SIGNATURE_TYPE": "1"
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python setup_creds.py <PRIVATE_KEY>")
        print("Example: python setup_creds.py 0xabc123...")
        sys.exit(1)
    
    private_key = sys.argv[1]
    creds = derive_credentials(private_key)
    
    print("\n=== DERIVED CREDENTIALS ===")
    for key, value in creds.items():
        print(f"{key}={value}")
    
    print("\n=== .ENV CONTENT ===")
    env_content = "\n".join([f'{key}="{value}"' for key, value in creds.items()])
    env_content += "\nSTARTING_BANKROLL=1.0\nMIN_BET=1.0\nBOT_MODE=safe"
    print(env_content)


if __name__ == "__main__":
    main()