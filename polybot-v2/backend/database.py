"""
POLYMARKET BOT v2 — DATABASE SCHEMA
=================================
SQLite database for multi-bot persistent storage.

Tables:
- bots: metadata & configuration per bot
- positions: open positions with bot_id foreign key
- trades: closed trades with bot_id foreign key
- balances: per-bot balance snapshots

Author: Sora (Backend Lead)
Date: 2026-04-24
"""
import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field, asdict


# ═══════════════════════════════════════════════════════════════
# DATABASE PATH
# ═══════════════════════════════════════════════════════════════

DB_PATH = Path(__file__).parent.parent / "data" / "polybot.db"


def get_db_path() -> Path:
    """Get database path, ensure directory exists"""
    db_path = DB_PATH
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


# ═══════════════════════════════════════════════════════════════
# DATABASE OPERATIONS
# ═══════════════════════════════════════════════════════════════

class Database:
    """Async database wrapper for SQLite"""
    
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or get_db_path()
        self._conn: Optional[sqlite3.Connection] = None
    
    def connect(self):
        """Synchronous connect for init"""
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()
    
    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
    
    def _init_schema(self):
        """Initialize database schema"""
        if not self._conn:
            return
        
        cursor = self._conn.cursor()
        
        # ─── BOTS TABLE ───────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                color TEXT DEFAULT '#00ff88',
                mode TEXT DEFAULT 'sim',
                usdc_capital REAL DEFAULT 10.0,
                pol_balance REAL DEFAULT 11.0,
                max_bet_usd REAL DEFAULT 2.0,
                min_bet_usd REAL DEFAULT 0.5,
                max_open_pos INTEGER DEFAULT 5,
                min_ev REAL DEFAULT 0.05,
                daily_loss_limit REAL DEFAULT 3.0,
                prob_min REAL DEFAULT 0.60,
                prob_max REAL DEFAULT 0.85,
                scan_interval INTEGER DEFAULT 5,
                compound_base REAL DEFAULT 20.0,
                compound_step REAL DEFAULT 20.0,
                compound_inc REAL DEFAULT 1.0,
                compound_max_bet REAL DEFAULT 20.0,
                gas_alert_tx INTEGER DEFAULT 10,
                gas_stop_tx INTEGER DEFAULT 2,
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        
        # ─── POSITIONS TABLE ─────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                position_id TEXT UNIQUE NOT NULL,
                market_id TEXT NOT NULL,
                question TEXT NOT NULL,
                category TEXT,
                outcome TEXT NOT NULL,
                price REAL NOT NULL,
                true_prob REAL NOT NULL,
                size REAL NOT NULL,
                shares REAL,
                ev REAL NOT NULL,
                strategy TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                pnl REAL DEFAULT 0.0,
                payout REAL DEFAULT 0.0,
                exit_price REAL DEFAULT 0.0,
                compound_tier INTEGER DEFAULT 0,
                compound_bet REAL DEFAULT 1.0,
                opened_at TEXT NOT NULL,
                closed_at TEXT,
                resolve_sec INTEGER DEFAULT 86400,
                resolve_fmt TEXT,
                end_date TEXT,
                FOREIGN KEY (bot_id) REFERENCES bots(id)
            )
        """)
        
        # ─── TRADES TABLE ─────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                trade_id TEXT UNIQUE NOT NULL,
                market_id TEXT NOT NULL,
                question TEXT NOT NULL,
                category TEXT,
                outcome TEXT NOT NULL,
                price REAL NOT NULL,
                size REAL NOT NULL,
                pnl REAL NOT NULL,
                result TEXT NOT NULL,
                strategy TEXT,
                closed_at TEXT NOT NULL,
                FOREIGN KEY (bot_id) REFERENCES bots(id)
            )
        """)
        
        # ─── BALANCES TABLE ───────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS balances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                capital REAL NOT NULL,
                locked_capital REAL DEFAULT 0.0,
                initial_capital REAL NOT NULL,
                pol_balance REAL NOT NULL,
                pnl REAL DEFAULT 0.0,
                snapshot_at TEXT NOT NULL,
                FOREIGN KEY (bot_id) REFERENCES bots(id)
            )
        """)
        
        # ─── COMPOUND EVENTS TABLE ────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS compound_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                old_tier INTEGER,
                new_tier INTEGER,
                old_bet REAL,
                new_bet REAL,
                capital REAL,
                target_capital REAL,
                event_data TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (bot_id) REFERENCES bots(id)
            )
        """)
        
        # ─── SALARY EVENTS TABLE ────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS salary_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                equity REAL NOT NULL,
                withdrawn REAL NOT NULL,
                kept REAL NOT NULL,
                target REAL NOT NULL,
                next_target REAL NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (bot_id) REFERENCES bots(id)
            )
        """)
        
        # ─── LOG TABLE ────────────────────────────────────────────
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                event TEXT NOT NULL,
                event_data TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (bot_id) REFERENCES bots(id)
            )
        """)
        
        # ─── CREATE INDEXES ───────────────────────────────────────────
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_positions_bot ON positions(bot_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_trades_bot ON trades(bot_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balances_bot ON balances(bot_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_logs_bot ON logs(bot_id)")
        
        self._conn.commit()
    
    # ─── BOT OPERATIONS ───────────────────────────────────────
    
    def create_bot(self, name: str, display_name: str, **config) -> int:
        """Create new bot, return bot_id"""
        cursor = self._conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        
        cursor.execute("""
            INSERT INTO bots (
                name, display_name, color, mode, usdc_capital, pol_balance,
                max_bet_usd, min_bet_usd, max_open_pos, min_ev,
                daily_loss_limit, prob_min, prob_max, scan_interval,
                compound_base, compound_step, compound_inc, compound_max_bet,
                gas_alert_tx, gas_stop_tx, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            name, display_name,
            config.get("color", "#00ff88"),
            config.get("mode", "sim"),
            config.get("usdc_capital", 10.0),
            config.get("pol_balance", 11.0),
            config.get("max_bet_usd", 2.0),
            config.get("min_bet_usd", 0.5),
            config.get("max_open_pos", 5),
            config.get("min_ev", 0.05),
            config.get("daily_loss_limit", 3.0),
            config.get("prob_min", 0.60),
            config.get("prob_max", 0.85),
            config.get("scan_interval", 5),
            config.get("compound_base", 20.0),
            config.get("compound_step", 20.0),
            config.get("compound_inc", 1.0),
            config.get("compound_max_bet", 20.0),
            config.get("gas_alert_tx", 10),
            config.get("gas_stop_tx", 2),
            1, now, now
        ))
        
        self._conn.commit()
        return cursor.lastrowid
    
    def get_bot(self, name: str) -> Optional[dict]:
        """Get bot by name"""
        cursor = self._conn.cursor()
        cursor.execute("SELECT * FROM bots WHERE name = ?", (name,))
        row = cursor.fetchone()
        return dict(row) if row else None
    
    def update_bot(self, name: str, **updates) -> bool:
        """Update bot config"""
        if not updates:
            return False
        
        cursor = self._conn.cursor()
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        cursor.execute(
            f"UPDATE bots SET {set_clause} WHERE name = ?",
            list(updates.values()) + [name]
        )
        
        self._conn.commit()
        return cursor.rowcount > 0
    
    # ─── POSITION OPERATIONS ─────────────────────────────────
    
    def open_position(self, bot_id: int, position: dict) -> int:
        """Record new position"""
        cursor = self._conn.cursor()
        
        cursor.execute("""
            INSERT INTO positions (
                bot_id, position_id, market_id, question, category,
                outcome, price, true_prob, size, shares, ev, strategy,
                status, compound_tier, compound_bet, opened_at, resolve_sec,
                resolve_fmt, end_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            bot_id, position.get("id"), position.get("market_id"),
            position.get("question"), position.get("category"),
            position.get("outcome"), position.get("price"),
            position.get("true_prob"), position.get("size"), position.get("shares"),
            position.get("ev"), position.get("strategy"),
            "open", position.get("compound_tier", 0),
            position.get("compound_bet", 1.0),
            position.get("opened_at"),
            position.get("resolve_sec", 86400),
            position.get("resolve_fmt"),
            position.get("end_date")
        ))
        
        self._conn.commit()
        return cursor.lastrowid
    
    def close_position(self, position_id: str, won: bool, pnl: float, payout: float) -> bool:
        """Close position"""
        cursor = self._conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        
        cursor.execute("""
            UPDATE positions SET 
                status = ?, pnl = ?, payout = ?, exit_price = ?, closed_at = ?
            WHERE position_id = ?
        """, (
            "won" if won else "lost", pnl, payout,
            1.0 if won else 0.0, now, position_id
        ))
        
        self._conn.commit()
        return cursor.rowcount > 0
    
    def get_open_positions(self, bot_id: int) -> list[dict]:
        """Get all open positions for bot"""
        cursor = self._conn.cursor()
        cursor.execute(
            "SELECT * FROM positions WHERE bot_id = ? AND status = 'open'",
            (bot_id,)
        )
        return [dict(row) for row in cursor.fetchall()]
    
    # ─── BALANCE OPERATIONS ────────────────────────────────────
    
    def record_balance(self, bot_id: int, capital: float, locked: float, 
                    initial: float, pol: float, pnl: float):
        """Record balance snapshot"""
        cursor = self._conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        
        cursor.execute("""
            INSERT INTO balances (bot_id, capital, locked_capital, initial_capital, 
                             pol_balance, pnl, snapshot_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (bot_id, capital, locked, initial, pol, pnl, now))
        
        self._conn.commit()
    
    # ─── TRADE HISTORY ───────────────────────────────────────────
    def add_trade(self, bot_id: int, trade: dict):
        """Add trade to history"""
        cursor = self._conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        
        cursor.execute("""
            INSERT INTO trades (
                bot_id, trade_id, market_id, question, category,
                outcome, size, pnl, result, strategy, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            bot_id, trade.get("id"), trade.get("market_id"),
            trade.get("question"), trade.get("category"),
            trade.get("outcome"), trade.get("size"),
            trade.get("pnl"), trade.get("status"),
            trade.get("strategy"), now
        ))
        
        self._conn.commit()
    
    # ─── STATS ──────────────────────────────────────────────
    
    def get_bot_stats(self, bot_id: int) -> dict:
        """Get bot statistics"""
        cursor = self._conn.cursor()
        
        # Total trades
        cursor.execute("""
            SELECT COUNT(*) as total, 
                   SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as wins
            FROM trades WHERE bot_id = ?
        """, (bot_id,))
        row = cursor.fetchone()
        
        return {
            "total_trades": row["total"] or 0,
            "wins": row["wins"] or 0,
            "losses": (row["total"] or 0) - (row["wins"] or 0),
        }
    
    def get_balance_history(self, bot_id: int, limit: int = 100) -> list[dict]:
        """Get balance history"""
        cursor = self._conn.cursor()
        cursor.execute("""
            SELECT * FROM balances WHERE bot_id = ?
            ORDER BY snapshot_at DESC LIMIT ?
        """, (bot_id, limit))
        return [dict(row) for row in cursor.fetchall()]


# ═══════════════════════════════════════════════════════════════
# SYNC WRAPPER FOR FASTAPI
# ═══════════════════════════════════════════════════════

_db_instance: Optional[Database] = None


def get_database() -> Database:
    """Get database singleton"""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
        _db_instance.connect()
    return _db_instance


def init_database():
    """Initialize database on startup"""
    db = get_database()
    print(f"[DB] Initialized: {db.db_path}")
    return db


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    """CLI for database management"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Multi-bot database")
    parser.add_argument("command", choices=["init", "bots", "stats", "balances"])
    parser.add_argument("--bot", default="bot1")
    
    args = parser.parse_args()
    
    db = Database()
    db.connect()
    
    if args.command == "init":
        print(f"[DB] Initialized at {db.db_path}")
        
    elif args.command == "bots":
        cursor = db._conn.cursor()
        cursor.execute("SELECT name, display_name, mode FROM bots")
        for row in cursor.fetchall():
            print(f"  {row[0]}: {row[1]} ({row[2]})")
    
    elif args.command == "stats":
        bot = db.get_bot(args.bot)
        if bot:
            stats = db.get_bot_stats(bot["id"])
            print(f"Bot: {args.bot}")
            print(f"  Total trades: {stats['total_trades']}")
            print(f"  Wins: {stats['wins']}, Losses: {stats['losses']}")
        else:
            print(f"Bot not found: {args.bot}")
    
    db.close()


if __name__ == "__main__":
    main()