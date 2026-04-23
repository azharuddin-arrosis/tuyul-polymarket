#!/usr/bin/env python3
"""
Forward Test Simulator - Realistic conditions
Trade adalah prediction, bukan hindsight
"""
import os
import sys
import time
import json
import argparse
import random
from datetime import datetime, timezone
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
from math import floor, log

import requests
from dotenv import load_dotenv

load_dotenv()

@dataclass
class Config:
    starting_bankroll: float = 100.0
    min_bet: float = 5.0
    bot_mode: str = "safe"
    real_price: bool = False
    
@dataclass
class Trade:
    id: int
    timestamp: str
    window_ts: int
    btc_open: float
    btc_entry: float
    btc_close: float
    delta_pct: float
    signal: str
    conf: float
    score: float
    direction: str
    bet: float
    token_price: float
    shares: int
    actual: str
    win: bool
    pnl: float
    bankroll: float

@dataclass
class Result:
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    max_win_streak: int = 0
    max_loss_streak: int = 0
    start_bankroll: float = 100.0
    end_bankroll: float = 100.0
    total_pnl: float = 0.0
    roi: float = 0.0
    max_bankroll: float = 100.0
    min_bankroll: float = 100.0
    max_drawdown: float = 0.0

class PriceData:
    """BTC price data"""
    cache = {"price": 0.0, "time": 0}
    
    @classmethod
    def get_current(cls) -> float:
        now = time.time()
        if cls.cache["time"] > 0 and now - cls.cache["time"] < 30:
            return cls.cache["price"]
        
        try:
            r = requests.get(
                "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
                timeout=3
            )
            if r.status_code == 200:
                data = r.json()
                cls.cache["price"] = float(data["bitcoin"]["usd"])
                cls.cache["time"] = now
                return cls.cache["price"]
        except:
            pass
        
        return cls.cache["price"] if cls.cache["price"] > 0 else 45000.0
    
    @classmethod
    def generate_window(cls, window_start: int) -> tuple:
        """Generate realistic window data:
        - entry: price when we enter (at T-10s)
        - close: price at close (5 min later)
        Returns: (entry_price, close_price, delta_pct)
        """
        base = cls.get_current()
        
        # Simulate realistic 5-min movement (volatility ~0.1-0.5%)
        change_pct = random.gauss(0, 0.15)
        
        entry = base * (1 + random.uniform(-0.001, 0.001))  # Entry near window start
        close = entry * (1 + change_pct / 100)  # Close after 5 min
        
        delta = ((close - entry) / entry) * 100
        
        return entry, close, delta

class TradingStrategy:
    """
    Strategy yang mem预测 arah, bukan melihat masa depan.
    Signal berdasarkan Entry Price (T-10s), Actual adalah Close Price (T+0)
    """
    
    def analyze(self, entry_price: float, candles: List[Dict]) -> Dict:
        """
        Analyze dan return signal di ENTRY TIME (bukan close)
        """
        if len(candles) < 5:
            return {"dir": random.choice([-1, 1]), "conf": 0.3, "score": 1.0}
        
        closes = [c["close"] for c in candles]
        
        score = 0.0
        
        # 1. Recent momentum (last 3 candles)
        if closes[-1] > closes[-2]:
            score += 2
        elif closes[-1] < closes[-2]:
            score -= 2
        
        if closes[-2] > closes[-3]:
            score += 1
        elif closes[-2] < closes[-3]:
            score -= 1
        
        # 2. EMA cross
        if len(candles) >= 9:
            ema9 = sum(closes[-9:]) / 9
            ema21 = sum(closes[-21:]) / 21 if len(candles) >= 21 else ema9
            if ema9 > ema21:
                score += 1
            elif ema9 < ema21:
                score -= 1
        
        # 3. RSI
        if len(candles) >= 14:
            gains = [max(closes[i] - closes[i-1], 0) for i in range(1, min(14, len(closes)))]
            losses = [max(closes[i-1] - closes[i], 0) for i in range(1, min(14, len(closes)))]
            avg_g = sum(gains) / min(14, len(closes) - 1)
            avg_l = sum(losses) / min(14, len(closes) - 1)
            rs = avg_g / avg_l if avg_l > 0 else 100
            rsi = 100 - (100 / (1 + rs))
            
            if rsi > 70:
                score -= 1
            elif rsi < 30:
                score += 1
        
        # Random noise (real markets have uncertainty)
        score += random.uniform(-1, 1)
        
        direction = 1 if score > 0 else -1
        confidence = min(abs(score) / 5.0, 0.85)
        
        return {"dir": direction, "conf": confidence, "score": abs(score)}

class ForwardTest:
    def __init__(self, config: Config):
        self.cfg = config
        self.trades: List[Trade] = []
        self.result = Result(start_bankroll=config.starting_bankroll, max_bankroll=config.starting_bankroll)
        self.bankroll = config.starting_bankroll
        self.strategy = TradingStrategy()
        self.win_streak = 0
        self.loss_streak = 0
    
    def token_price(self, delta: float) -> float:
        """Price saat entry berdasarkan delta saat itu"""
        a = abs(delta)
        if a < 0.01:
            return 0.50
        if a < 0.02:
            return 0.55
        if a < 0.05:
            return 0.65
        if a < 0.10:
            return 0.80
        return min(0.95, 0.90 + a * 0.5)
    
    def bet_size(self, conf: float) -> float:
        m = self.cfg.bot_mode
        b = self.bankroll
        if m == "degen":
            return b
        if m == "aggressive":
            return max(b - self.cfg.starting_bankroll, self.cfg.min_bet) if b >= self.cfg.starting_bankroll else self.cfg.min_bet
        return max(b * 0.25, self.cfg.min_bet)
    
    def get_min_conf(self) -> float:
        return {"safe": 0.30, "aggressive": 0.20, "degen": 0.0}.get(self.cfg.bot_mode, 0.30)
    
    def simulate_candles(self, entry: float, count: int = 30) -> List[Dict]:
        """Generate candles LEADING UP TO entry"""
        price = entry * 0.98
        candles = []
        for _ in range(count):
            change = random.gauss(0, 10)
            close_ = price + change
            candles.append({
                "open": price, "close": close_,
                "high": max(price, close_) + 5,
                "low": min(price, close_) - 5
            })
            price = close_
        return candles
    
    def run_window(self, window_ts: int) -> Optional[Trade]:
        """Execute ONE window"""
        
        # Get entry price at window start (T-10s approximation)
        entry_price, close_price, delta_entry = PriceData.generate_window(window_ts)
        
        # Generate candles leading up to entry
        candles = self.simulate_candles(entry_price)
        
        # Get signal at ENTRY (not using close)
        res = self.strategy.analyze(entry_price, candles)
        
        signal = "up" if res["dir"] == 1 else "down"
        conf = max(res["conf"], self.get_min_conf())
        
        # Calculate actual
        actual_dir = "up" if delta_entry >= 0 else "down"
        win = signal == actual_dir
        
        # Bet
        bet = self.bet_size(conf)
        t_price = self.token_price(delta_entry)
        
        shares = floor(bet / t_price)
        if shares < 5:
            shares = 5
            bet = shares * t_price
        
        # P&L
        pnl = (shares * (1.0 - t_price)) if win else -bet
        
        self.bankroll += pnl
        
        # Update stats
        self.result.total_trades += 1
        
        if win:
            self.result.wins += 1
            self.win_streak += 1
            self.loss_streak = 0
            self.result.max_win_streak = max(self.result.max_win_streak, self.win_streak)
        else:
            self.result.losses += 1
            self.loss_streak += 1
            self.win_streak = 0
            self.result.max_loss_streak = max(self.result.max_loss_streak, self.loss_streak)
        
        self.result.end_bankroll = self.bankroll
        self.result.total_pnl = self.bankroll - self.cfg.starting_bankroll
        self.result.max_bankroll = max(self.result.max_bankroll, self.bankroll)
        
        trade = Trade(
            id=len(self.trades) + 1,
            timestamp=datetime.now(timezone.utc).isoformat(),
            window_ts=window_ts,
            btc_open=round(entry_price, 2),
            btc_entry=round(entry_price, 2),
            btc_close=round(close_price, 2),
            delta_pct=round(delta_entry, 4),
            signal=signal,
            conf=round(conf, 2),
            score=round(res["score"], 2),
            direction=signal,
            bet=round(bet, 2),
            token_price=round(t_price, 2),
            shares=shares,
            actual=actual_dir,
            win=win,
            pnl=round(pnl, 2),
            bankroll=round(self.bankroll, 2)
        )
        
        self.trades.append(trade)
        return trade
    
    def run(self, windows: int):
        print(f"\n{'='*65}")
        print(f"  FORWARD TEST - REALISTIC SIMULATION")
        print(f"{'='*65}")
        print(f"  Mode: {self.cfg.bot_mode.upper()}")
        print(f"  Bankroll: ${self.cfg.starting_bankroll:.2f}")
        print(f"  Windows: {windows}")
        print(f"{'='*65}\n")
        
        now = int(time.time())
        
        for i in range(windows):
            ts = now - (windows - i - 1) * 300
            t = self.run_window(ts)
            
            mark = "✓" if t.win else "✗"
            print(f"  {t.id:3d} | {t.signal:>4}→{t.actual:<4} | {mark} | "
                  f"Bet: ${t.bet:6.2f} | TP: ${t.token_price:.2f} | "
                  f"Δ: {t.delta_pct:+.3f}% | PnL: ${t.pnl:+7.2f} | "
                  f"Bank: ${t.bankroll:7.2f}")
        
        # Final stats
        r = self.result
        r.roi = (r.total_pnl / r.start_bankroll * 100) if r.start_bankroll > 0 else 0
        r.min_bankroll = r.end_bankroll
        r.max_drawdown = ((r.max_bankroll - r.end_bankroll) / r.max_bankroll * 100) if r.max_bankroll > 0 else 0
    
    def summary(self):
        r = self.result
        wr = r.wins / r.total_trades if r.total_trades > 0 else 0
        
        print(f"\n{'='*65}")
        print(f"  SUMMARY")
        print(f"{'='*65}")
        print(f"  Trades: {r.total_trades}")
        print(f"  Wins: {r.wins} ({wr:.0%}) | Losses: {r.losses}")
        print(f"  Best Streak: {r.max_win_streak} | Worst: {r.max_loss_streak}")
        print(f"")
        print(f"  Start: ${r.start_bankroll:.2f}")
        print(f"  End:   ${r.end_bankroll:.2f}")
        print(f"  P&L:   ${r.total_pnl:+.2f} ({r.roi:+.1f}%)")
        print(f"  DD:    {r.max_drawdown:.1f}%")
        print(f"{'='*65}")
    
    def save(self, path: str = "forward_test.json"):
        data = {
            "config": asdict(self.cfg),
            "result": asdict(self.result),
            "trades": [asdict(t) for t in self.trades]
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"\nSaved: {path}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-n", "--windows", type=int, default=50)
    parser.add_argument("-m", "--mode", default="safe", choices=["safe", "aggressive", "degen"])
    parser.add_argument("-b", "--bankroll", type=float, default=100.0)
    parser.add_argument("--min-bet", type=float, default=5.0)
    parser.add_argument("-s", "--save", help="Save to file")
    args = parser.parse_args()
    
    cfg = Config(
        starting_bankroll=args.bankroll,
        min_bet=args.min_bet,
        bot_mode=args.mode
    )
    
    sim = ForwardTest(cfg)
    sim.run(args.windows)
    sim.summary()
    
    if args.save:
        sim.save(args.save)

if __name__ == "__main__":
    main()