import requests
from typing import List, Dict, Optional
from datetime import datetime, timezone

class BinanceClient:
    BASE_URL = "https://api.binance.com"
    
    def __init__(self):
        self.session = requests.Session()
    
    def get_klines(
        self,
        symbol: str = "BTCUSDT",
        interval: str = "1m",
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 1000
    ) -> List[Dict]:
        url = f"{self.BASE_URL}/api/v3/klines"
        
        params = {
            "symbol": symbol,
            "interval": interval,
            "limit": limit
        }
        
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time
        
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        
        klines = []
        for k in resp.json():
            klines.append({
                "open_time": datetime.fromtimestamp(k[0] // 1000, tz=timezone.utc),
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
                "close_time": datetime.fromtimestamp(k[6] // 1000, tz=timezone.utc),
                "quote_volume": float(k[7]),
                "trades": k[8]
            })
        
        return klines
    
    def get_historical_klines(
        self,
        hours: int = 24,
        interval: str = "1m"
    ) -> List[Dict]:
        import time
        end_time = int(time.time() * 1000)
        start_time = end_time - (hours * 60 * 60 * 1000)
        
        all_klines = []
        current_start = start_time
        
        while current_start < end_time:
            klines = self.get_klines(
                start_time=current_start,
                end_time=end_time,
                limit=1000
            )
            
            if not klines:
                break
            
            all_klines.extend(klines)
            current_start = int(klines[-1]["close_time"].timestamp() * 1000) + 1
            
            if len(klines) < 1000:
                break
        
        return all_klines


def fetch_historical_data(hours: int = 72) -> List[Dict]:
    client = BinanceClient()
    print(f"Fetching {hours}h of historical BTC data...")
    klines = client.get_historical_klines(hours=hours)
    print(f"Fetched {len(klines)} candles")
    return klines


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Fetch historical Binance data")
    parser.add_argument("--hours", type=int, default=72, help="Hours of data")
    parser.add_argument("--output", help="Output file")
    args = parser.parse_args()
    
    data = fetch_historical_data(args.hours)
    
    if args.output:
        import json
        with open(args.output, "w") as f:
            json.dump(data, f, default=str)
        print(f"Saved to {args.output}")


if __name__ == "__main__":
    main()