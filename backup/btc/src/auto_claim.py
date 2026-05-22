import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import List, Dict, Optional
from playwright.async_api import async_playwright, Browser, Page


POLYMARKET_URL = "https://polymarket.com/markets"


class AutoClaimer:
    def __init__(self, private_key: str = None):
        self.private_key = private_key or os.getenv("POLY_PRIVATE_KEY", "")
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
    
    async def connect(self):
        if not self.private_key:
            print("No private key configured - using view-only mode")
            return
        
        playwright = await async_playwright().start()
        self.browser = await playwright.chromium.launch(headless=True)
        context = await self.browser.new_context()
        self.page = await context.new_page()
        
        print("Browser initialized")
    
    async def disconnect(self):
        if self.browser:
            await self.browser.close()
    
    async def check_winning_positions(self, address: str) -> List[Dict]:
        if not self.page:
            return []
        
        try:
            await self.page.goto(POLYMARKET_URL, wait_until="networkidle")
            await self.page.wait_for_timeout(2000)
            
            positions = []
            market_cards = await self.page.query_selector_all("[class*='market-card']")
            
            for card in market_cards:
                try:
                    title = await card.query_selector("[class*='title']")
                    outcome = await card.query_selector("[class*='outcome']")
                    
                    if title and outcome:
                        title_text = await title.inner_text()
                        outcome_text = await outcome.inner_text()
                        
                        if "Win" in outcome_text or "Claim" in outcome_text:
                            positions.append({
                                "title": title_text,
                                "status": outcome_text,
                                "can_claim": "Claim" in outcome_text
                            })
                except Exception:
                    continue
            
            return positions
        
        except Exception as e:
            print(f"Error checking positions: {e}")
            return []
    
    async def claim_winnings(self, position: Dict) -> bool:
        if not self.page:
            return False
        
        try:
            claim_button = await self.page.query_selector("[class*='claim']")
            if claim_button:
                await claim_button.click()
                await self.page.wait_for_timeout(3000)
                return True
        except Exception as e:
            print(f"Claim failed: {e}")
        
        return False
    
    async def run_auto_claim_loop(self, address: str, interval: int = 60):
        await self.connect()
        
        print(f"Auto-claimer started. Checking every {interval}s...")
        
        while True:
            try:
                positions = await self.check_winning_positions(address)
                
                for pos in positions:
                    if pos["can_claim"]:
                        print(f"Claiming: {pos['title']}")
                        await self.claim_winnings(pos)
                
                await asyncio.sleep(interval)
            
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(interval)
        
        await self.disconnect()


async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Auto-claim winning positions")
    parser.add_argument("--address", required=True, help="Wallet address")
    parser.add_argument("--interval", type=int, default=60, help="Check interval (seconds)")
    args = parser.parse_args()
    
    claimer = AutoClaimer()
    await claimer.run_auto_claim_loop(args.address, args.interval)


if __name__ == "__main__":
    asyncio.run(main())