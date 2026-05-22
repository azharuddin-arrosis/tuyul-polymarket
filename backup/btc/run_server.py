#!/usr/bin/env python3
"""Simple server to run dashboard + forward test"""
import http.server
import socketserver
import json
import threading
import time
import os
from pathlib import Path

PORT = 8080

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/state':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            # Get latest state
            state_file = Path('logs/state.json')
            if state_file.exists():
                with open(state_file) as f:
                    state = json.load(f)
            else:
                state = {"status": "idle", "bankroll": 100, "trades": 0, "btc_price": 0}
            
            self.wfile.write(json.dumps(state).encode())
            return
        
        if self.path == '/api/run':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
            return
        
        return super().do_GET()
    
    def do_POST(self):
        if self.path == '/api/run':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            # Start forward test in background
            def run():
                os.system('python3 src/forward_sim.py -n 50 -m safe -b 100 -s logs/last_run.json')
            
            threading.Thread(target=run, daemon=True).start()
            self.wfile.write(json.dumps({"status": "started"}).encode())
            return
    
    def log_message(self, format, *args):
        pass

def main():
    os.chdir(Path(__file__).parent.parent)
    os.makedirs('logs', exist_ok=True)
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n{'='*50}")
        print(f"  POLYMARKET BTC BOT DASHBOARD")
        print(f"{'='*50}")
        print(f"  Open: http://localhost:{PORT}/dashboard/index.html")
        print(f"{'='*50}\n")
        httpd.serve_forever()

if __name__ == "__main__":
    main()