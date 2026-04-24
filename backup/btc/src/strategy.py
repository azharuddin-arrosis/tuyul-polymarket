from typing import Dict, List, Any
from dataclasses import dataclass
import statistics

@dataclass
class SignalResult:
    direction: int
    confidence: float
    score: float
    breakdown: Dict[str, float]


def calculate_ema(data: List[float], period: int) -> float:
    if len(data) < period:
        return data[-1] if data else 0
    multiplier = 2 / (period + 1)
    ema = sum(data[:period]) / period
    for price in data[period:]:
        ema = (price - ema) * multiplier + ema
    return ema


def calculate_rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]
    
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    
    if avg_loss == 0:
        return 100.0
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def window_delta_signal(current_price: float, window_open_price: float) -> tuple:
    if not window_open_price or window_open_price == 0:
        return 0, 0
    
    delta_pct = ((current_price - window_open_price) / window_open_price) * 100
    abs_delta = abs(delta_pct)
    
    if abs_delta >= 0.10:
        weight = 7
    elif abs_delta >= 0.02:
        weight = 5
    elif abs_delta >= 0.005:
        weight = 3
    elif abs_delta >= 0.001:
        weight = 1
    else:
        weight = 0
    
    direction = 1 if delta_pct > 0 else -1
    return direction * weight, weight


def micro_momentum_signal(candles: List[Dict]) -> tuple:
    if len(candles) < 3:
        return 0, 0
    
    closes = [c["close"] for c in candles[-3:]]
    if closes[0] > closes[1]:
        return 1, 2
    elif closes[0] < closes[1]:
        return -1, 2
    return 0, 0


def acceleration_signal(candles: List[Dict]) -> tuple:
    if len(candles) < 4:
        return 0, 0
    
    recent = candles[-2:]
    move1 = recent[0]["close"] - recent[0]["open"]
    move2 = recent[1]["close"] - recent[1]["open"]
    
    diff = move1 - move2
    if abs(diff) < 0.0001:
        return 0, 0
    
    direction = 1 if diff > 0 else -1
    return direction * 1.5, 1.5


def ema_crossover_signal(candles: List[Dict]) -> tuple:
    if len(candles) < 21:
        return 0, 0
    
    closes = [c["close"] for c in candles]
    ema9 = calculate_ema(closes, 9)
    ema21 = calculate_ema(closes, 21)
    
    if ema9 > ema21:
        return 1, 1
    elif ema9 < ema21:
        return -1, 1
    return 0, 0


def rsi_signal(candles: List[Dict]) -> tuple:
    if len(candles) < 15:
        return 0, 0
    
    closes = [c["close"] for c in candles]
    rsi = calculate_rsi(closes, 14)
    
    if rsi >= 75:
        return -1, 2
    elif rsi <= 25:
        return 1, 2
    return 0, 0


def volume_surge_signal(candles: List[Dict]) -> tuple:
    if len(candles) < 7:
        return 0, 0
    
    recent = [c["volume"] for c in candles[-3:]]
    prior = [c["volume"] for c in candles[-6:-3]]
    
    if not prior:
        return 0, 0
    
    avg_recent = sum(recent) / len(recent)
    avg_prior = sum(prior) / len(prior)
    
    if avg_prior == 0:
        return 0, 0
    
    ratio = avg_recent / avg_prior
    if ratio < 1.5:
        return 0, 0
    
    last_close = candles[-1]["close"]
    prev_close = candles[-4]["close"]
    
    if last_close > prev_close:
        return 1, 1
    elif last_close < prev_close:
        return -1, 1
    return 0, 0


def tick_trend_signal(tick_prices: List[float]) -> tuple:
    if len(tick_prices) < 10:
        return 0, 0
    
    up_count = 0
    for i in range(1, len(tick_prices)):
        if tick_prices[i] > tick_prices[i-1]:
            up_count += 1
    up_ticks = up_count
    consistency = up_ticks / (len(tick_prices) - 1)
    
    if consistency < 0.60:
        return 0, 0
    
    price_change = ((tick_prices[-1] - tick_prices[0]) / tick_prices[0]) * 100
    
    if abs(price_change) < 0.005:
        return 0, 0
    
    if price_change > 0:
        return 1, 2
    return -1, 2


def analyze(
    current_price: float,
    window_open_price: float,
    candles: List[Dict],
    tick_prices: List[float] = None
) -> Dict[str, Any]:
    breakdown = {}
    total_score = 0.0
    total_weight = 0.0
    
    w_delta, w_weight = window_delta_signal(current_price, window_open_price)
    breakdown["window_delta"] = w_delta
    total_score += w_delta
    total_weight += w_weight
    
    mm_score, mm_weight = micro_momentum_signal(candles)
    breakdown["micro_momentum"] = mm_score
    total_score += mm_score
    total_weight += mm_weight
    
    acc_score, acc_weight = acceleration_signal(candles)
    breakdown["acceleration"] = acc_score
    total_score += acc_score
    total_weight += acc_weight
    
    ema_score, ema_weight = ema_crossover_signal(candles)
    breakdown["ema_crossover"] = ema_score
    total_score += ema_score
    total_weight += ema_weight
    
    rsi_score, rsi_weight = rsi_signal(candles)
    breakdown["rsi"] = rsi_score
    total_score += rsi_score
    total_weight += rsi_weight
    
    vol_score, vol_weight = volume_surge_signal(candles)
    breakdown["volume_surge"] = vol_score
    total_score += vol_score
    total_weight += vol_weight
    
    if tick_prices:
        tick_score, tick_weight = tick_trend_signal(tick_prices)
        breakdown["tick_trend"] = tick_score
        total_score += tick_score
        total_weight += tick_weight
    
    direction = 1 if total_score > 0 else -1
    confidence = min(abs(total_score) / 7.0, 1.0)
    
    return {
        "direction": direction,
        "confidence": confidence,
        "score": total_score,
        "breakdown": breakdown,
        "total_weight": total_weight
    }


def quick_signal(current_price: float, window_open_price: float) -> int:
    result = analyze(current_price, window_open_price, [])
    return result["direction"]