"""
POLYMARKET BOT v2 — SECURE CONFIG LOADER
=====================================
Loads multi-bot configuration from .env.bot{1,2,...} files.
Encrypts sensitive fields (API keys, private keys) using Fernet.

Author: Sora (Backend Lead)
Date: 2026-04-24
"""
import os
import json
import base64
import secrets
import hashlib
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field
from cryptography.fernet import Fernet
from dotenv import dotenv_values


# ═══════════════════════════════════════════════════════════════
# CONFIG STRUCTURE
# ═══════════════════════════════════════════════════════════════

@dataclass
class BotConfig:
    """Configuration for a single bot instance"""
    name: str = "bot1"
    display_name: str = "Bot 1"
    color: str = "#00ff88"
    
    # Mode
    mode: str = "sim"
    
    # Capital
    usdc_capital: float = 10.0
    pol_balance: float = 11.0
    
    # Risk parameters
    max_bet_usd: float = 2.0
    min_bet_usd: float = 0.5
    max_open_pos: int = 5
    min_ev: float = 0.05
    daily_loss_limit: float = 3.0
    prob_min: float = 0.60
    prob_max: float = 0.85
    scan_interval: int = 5
    
    # Compound
    compound_base: float = 20.0
    compound_step: float = 20.0
    compound_inc: float = 1.0
    compound_max_bet: float = 20.0
    
    # Gas
    gas_alert_tx: int = 10
    gas_stop_tx: int = 2
    
    # Sensitive (encrypted) - never serialize these to logs!
    _poly_private_key: str = ""
    _poly_api_key: str = ""
    _poly_secret: str = ""
    _poly_passphrase: str = ""
    
    # Runtime state (not persisted)
    is_encrypted: bool = True
    
    @property
    def poly_private_key(self) -> str:
        """Decrypt private key if needed"""
        if self._poly_private_key.startswith("enc:"):
            return decrypt_value(self._poly_private_key[4:])
        return self._poly_private_key
    
    @property
    def poly_api_key(self) -> str:
        if self._poly_api_key.startswith("enc:"):
            return decrypt_value(self._poly_api_key[4:])
        return self._poly_api_key
    
    @property
    def poly_secret(self) -> str:
        if self._poly_secret.startswith("enc:"):
            return decrypt_value(self._poly_secret[4:])
        return self._poly_secret
    
    @property
    def poly_passphrase(self) -> str:
        if self._poly_passphrase.startswith("enc:"):
            return decrypt_value(self._poly_passphrase[4:])
        return self._poly_passphrase
    
    @property
    def is_real_mode(self) -> bool:
        return self.mode == "real"
    
    @property
    def has_credentials(self) -> bool:
        """Check if bot has valid credentials for real trading"""
        return bool(
            self.poly_private_key and 
            self.poly_api_key and 
            self.poly_secret
        )


@dataclass
class MultiBotConfig:
    """Configuration container for multiple bot instances"""
    bots: dict[str, BotConfig] = field(default_factory=dict)
    _master_key: Optional[bytes] = None
    
    @property
    def bot_list(self) -> list[BotConfig]:
        return list(self.bots.values())
    
    @property
    def bot_names(self) -> list[str]:
        return list(self.bots.keys())
    
    def get_bot(self, name: str) -> Optional[BotConfig]:
        return self.bots.get(name)
    
    def get_bot_or_default(self, name: str) -> BotConfig:
        return self.bots.get(name, self.bots.get("bot1"))


# ═══════════════════════════════════════════════════════════════
# ENCRYPTION UTILITIES
# ═══════════════════════════════════════════════════════════════

def get_master_key() -> bytes:
    """
    Get or generate master encryption key.
    Stored in .encryption.key file (gitignored).
    """
    key_file = Path(__file__).parent.parent / ".encryption.key"
    
    if key_file.exists():
        return key_file.read_bytes()
    
    # Generate new key
    key = Fernet.generate_key()
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_bytes(key)
    key_file.chmod(0o600)  # Read/write for owner only
    
    print(f"[CONFIG] Generated new master encryption key: {key_file}")
    return key


def encrypt_value(plaintext: str) -> str:
    """Encrypt a sensitive value"""
    if not plaintext:
        return ""
    
    f = Fernet(get_master_key())
    encrypted = f.encrypt(plaintext.encode())
    return base64.urlsafe_b64encode(encrypted).decode()


def decrypt_value(encrypted: str) -> str:
    """Decrypt a value"""
    if not encrypted:
        return ""
    
    try:
        f = Fernet(get_master_key())
        decoded = base64.urlsafe_b64decode(encrypted.encode())
        decrypted = f.decrypt(decoded)
        return decrypted.decode()
    except Exception as e:
        print(f"[CONFIG] Decryption error: {e}")
        return ""


# ═══════════════════════════════════════════════════════════════
# CONFIG LOADER
# ═══════════════════════════════════════════════════════════════

def load_bot_config(env_file: str | Path) -> BotConfig:
    """
    Load configuration from .env.bot{n} file.
    Decrypts sensitive fields automatically.
    """
    env_path = Path(env_file)
    if not env_path.exists():
        raise FileNotFoundError(f"Config file not found: {env_path}")
    
    # Load .env vars
    env = dotenv_values(env_path)
    
    # Map env vars to BotConfig
    config = BotConfig(
        name=env.get("BOT_NAME", "bot1"),
        display_name=env.get("BOT_DISPLAY_NAME", "Bot 1"),
        color=env.get("BOT_COLOR", "#00ff88"),
        mode=env.get("BOT_MODE", "sim"),
        
        usdc_capital=float(env.get("USDC_CAPITAL", "10")),
        pol_balance=float(env.get("POL_BALANCE", "11")),
        
        max_bet_usd=float(env.get("MAX_BET_USD", "2.0")),
        min_bet_usd=float(env.get("MIN_BET_USD", "0.5")),
        max_open_pos=int(env.get("MAX_OPEN_POS", "5")),
        min_ev=float(env.get("MIN_EV", "0.05")),
        daily_loss_limit=float(env.get("DAILY_LOSS_LIMIT", "3.0")),
        prob_min=float(env.get("PROB_MIN", "0.60")),
        prob_max=float(env.get("PROB_MAX", "0.85")),
        scan_interval=int(env.get("SCAN_INTERVAL", "5")),
        
        compound_base=float(env.get("COMPOUND_BASE", "20")),
        compound_step=float(env.get("COMPOUND_STEP", "20")),
        compound_inc=float(env.get("COMPOUND_INC", "1.0")),
        compound_max_bet=float(env.get("COMPOUND_MAX_BET", "20.0")),
        
        gas_alert_tx=int(env.get("GAS_ALERT_TX", "10")),
        gas_stop_tx=int(env.get("GAS_STOP_TX", "2")),
        
        # Sensitive fields - may be encrypted
        _poly_private_key=env.get("POLY_PRIVATE_KEY", ""),
        _poly_api_key=env.get("POLY_API_KEY", ""),
        _poly_secret=env.get("POLY_SECRET", ""),
        _poly_passphrase=env.get("POLY_PASSPHRASE", ""),
    )
    
    return config


def load_multi_bot_config(config_dir: str | Path = ".") -> MultiBotConfig:
    """
    Load all bot configurations from directory.
    Scans for .env.bot* files.
    """
    config_path = Path(config_dir)
    
    multi_config = MultiBotConfig()
    
    # Find all .env.bot* files
    for env_file in sorted(config_path.glob(".env.bot*")):
        if env_file.name == ".env":
            continue  # Skip main .env
        
        try:
            bot_config = load_bot_config(env_file)
            multi_config.bots[bot_config.name] = bot_config
            print(f"[CONFIG] Loaded bot: {bot_config.name} ({bot_config.display_name})")
        except Exception as e:
            print(f"[CONFIG] Error loading {env_file}: {e}")
    
    # Fallback: if no bot configs found, load default .env
    if not multi_config.bots:
        default_env = config_path / ".env"
        if default_env.exists():
            single_bot = load_bot_config(default_env)
            single_bot.name = "bot1"
            single_bot.display_name = "Primary Bot"
            multi_config.bots["bot1"] = single_bot
            print(f"[CONFIG] Loaded default bot1 from .env")
    
    return multi_config


def encrypt_config_field(value: str) -> str:
    """Public function to encrypt a config field"""
    if not value:
        return ""
    return f"enc:{encrypt_value(value)}"


# ═══════════════════════════════════════════════════════════════
# CLI COMMANDS
# ═══════════════════════════════════════════════════════════════

def main():
    """CLI for config management"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Multi-bot config loader")
    parser.add_argument("command", choices=["list", "encrypt", "decrypt", "show"])
    parser.add_argument("--bot", default="bot1", help="Bot name")
    parser.add_argument("--field", help="Config field name")
    parser.add_argument("--value", help="Value to encrypt")
    
    args = parser.parse_args()
    
    if args.command == "list":
        multi = load_multi_bot_config()
        print(f"Configured bots: {multi.bot_names}")
        
    elif args.command == "encrypt":
        if args.value:
            encrypted = encrypt_value(args.value)
            print(f"Encrypted: enc:{encrypted}")
        else:
            print("Error: --value required")
            
    elif args.command == "decrypt":
        if args.value:
            decrypted = decrypt_value(args.value)
            print(f"Decrypted: {decrypted}")
        else:
            print("Error: --value required")
            
    elif args.command == "show":
        config = load_multi_bot_config()
        bot = config.get_bot_or_default(args.bot)
        print(f"Bot: {bot.name}")
        print(f"  Display: {bot.display_name}")
        print(f"  Mode: {bot.mode}")
        print(f"  Capital: ${bot.usdc_capital}")
        print(f"  POL: ${bot.pol_balance}")
        print(f"  Has credentials: {bot.has_credentials}")
        if bot.mode == "real" and not bot.has_credentials:
            print("  WARNING: Real mode but no credentials!")


if __name__ == "__main__":
    main()