"""Polymarket BTC 5-Minute Trading Bot"""
import os
import sys
import time
import signal
import argparse
from datetime import datetime, timezone
from dotenv import load_dotenv
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from math import floor
import random
import requests

load_dotenv()

MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() != "false"
CACHED_BTC_PRICE = 0.0
CACHE_TIME = 0

def mock_price():
    global CACHED_BTC_PRICE
    CACHED_BTC_PRICE += random.uniform(-50, 50)
    return CACHED_BTC_PRICE

def get_cached_price() -> float:
    global CACHED_BTC_PRICE, CACHE_TIME
    now = time.time()
    if CACHE_TIME > 0 and now - CACHE_TIME < 60:
        return CACHED_BTC_PRICE
    if MOCK_MODE:
        return mock_price()
    try:
        r = requests.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", timeout=3)
        if r.status_code == 200:
            data = r.json()
            if "bitcoin" in data:
                CACHED_BTC_PRICE = float(data["bitcoin"]["usd"])
                CACHE_TIME = now
                return CACHED_BTC_PRICE
    except:
        pass
    return mock_price() if CACHED_BTC_PRICE <= 0 else CACHED_BTC_PRICE

def mock_candles(limit: int = 30, base: float = 45000) -> List[Dict]:
    price = base
    return [{"open_time": int(time.time()) - (limit - i) * 60, "open": price, "high": price + 10, "low": price - 10,
             "close": price + random.uniform(-30, 30), "volume": random.uniform(100, 500),
             "close_time": int(time.time()) - (limit - i - 1) * 60} for i in range(limit)]

@dataclass
class Config:
    starting_bankroll: float = 100.0
    min_bet: float = 1.0
    bot_mode: str = "safe"
    run_mode: str = "simulate"
    mock_mode: bool = MOCK_MODE

@dataclass
class TradeResult:
    timestamp: datetime
    window_ts: int
    direction: str
    confidence: float
    bet_size: float
    token_price: float
    shares: int
    pnl: float
    win: bool
    actual_direction: str
    score: float = 0.0

@dataclass
class SimState:
    bankroll: float = 100.0
    trades: int = 0
    wins: int = 0
    losses: int = 0
    total_pnl: float = 0.0
    max_bankroll: float = 100.0

class Bot:
    def __init__(self, config: Config):
        self.config = config
        self.state = SimState(bankroll=config.starting_bankroll, max_bankroll=config.starting_bankroll)
        self.running = True
        signal.signal(signal.SIGINT, lambda s, f: setattr(self, 'running', False))
    
    def price(self) -> float:
        return mock_price() if MOCK_MODE else get_cached_price()
    
    def candles(self, interval: str = "1m", limit: int = 30) -> List[Dict]:
        return mock_candles(limit, self.price())
    
    def bet_size(self, conf: float) -> float:
        mode = self.config.bot_mode
        b = self.state.bankroll
        if mode == "degen": return b
        if mode == "aggressive": return max(b - self.config.starting_bankroll, self.config.min_bet) if b >= self.config.starting_bankroll else self.config.min_bet
        return b * 0.25
    
    def min_conf(self) -> float:
        return {"safe": 0.30, "aggressive": 0.20, "degen": 0.0}.get(self.config.bot_mode, 0.30)
    
    def token_price(self, delta: float) -> float:
        a = abs(delta)
        if a < 0.005: return 0.50
        if a < 0.02: return 0.55
        if a < 0.05: return 0.65
        if a < 0.10: return 0.80
        return min(0.95, 0.92 + (a - 0.10) * 0.3)
    
    def run_strategy(self, window_ts: int) -> Dict[str, Any]:
        import importlib.util
        spec = importlib.util.spec_from_file_location("strategy", "src/strategy.py")
        strategy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(strategy)
        
        p = self.price()
        w = p  # approximate
        candles = self.candles()
        return strategy.analyze(p, w, candles)
    
    def execute(self, window_ts: int) -> Optional[TradeResult]:
        p = self.price()
        
        res = self.run_strategy(window_ts)
        direction = "up" if res["direction"] == 1 else "down"
        conf = max(res["confidence"], self.min_conf())
        
        bet = max(self.bet_size(conf), self.config.min_bet)
        t_price = self.token_price(0) if MOCK_MODE else self.token_price(0)
        
        shares = floor(bet / t_price)
        if shares < 5: shares = 5
        bet = shares * t_price
        
        if MOCK_MODE or self.config.run_mode == "simulate":
            actual = "up"  # simple for mock
            win = direction == actual
            
            pnl = shares * (1.0 - t_price) if win else -bet
            self.state.bankroll += pnl
            self.state.trades += 1
            if win: self.state.wins += 1
            else: self.state.losses += 1
            self.state.total_pnl = self.state.bankroll - self.config.starting_bankroll
            self.state.max_bankroll = max(self.state.max_bankroll, self.state.bankroll)
            
            print(f"[{'SIM' if MOCK_MODE else 'REAL'}] {direction.upper()} | ${bet:.2f} | {'WIN' if win else 'LOSS':4} | ${pnl:+.2f} | ${self.state.bankroll:.2f}")
        
        return TradeResult(datetime.now(timezone.utc), window_ts, direction, conf, bet, t_price, shares, pnl if MOCK_MODE else 0, win if MOCK_MODE else False, direction if MOCK_MODE else "", res["score"])
    
    def summary(self):
        s = self.state
        t = s.trades
        wr = s.wins / t if t > 0 else 0
        roi = (s.total_pnl / self.config.starting_bankroll * 100) if self.config.starting_bankroll > 0 else 0
        print(f"\n=== SUMMARY ===\nTrades: {t} | Wins: {s.wins} ({wr:.0%}) | Bankroll: ${s.bankroll:.2f} | P&L: ${s.total_pnl:+.2f} | ROI: {roi:+.1f}%")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="simulate")
    parser.add_argument("--bet", default="safe")
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--max-trades", type=int, default=10)
    args = parser.parse_args()
    
    cfg = Config(bot_mode=args.bet, run_mode=args.run)
    bot = Bot(cfg)
    
    if args.quick:
        print(f"Quick: {args.max_trades} trades ({args.bet})")
        for i in range(args.max_trades):
            ts = int(time.time()) - ((args.max_trades - i) * 300)
            bot.execute(ts)
        bot.summary()
    else:
        print(f"Starting: {args.run}/{args.bet}")
        for _ in range(args.max_trades):
            if not bot.running: break
            ts = int(time.time())
            bot.execute(ts)
            time.sleep(3)

if __name__ == "__main__":
    main()