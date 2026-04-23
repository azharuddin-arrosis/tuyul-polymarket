import http.server
import socketserver
import json
import os
import sys
import time
import threading
from pathlib import Path
from datetime import datetime
import webbrowser

PORT = 8080

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/state':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            state = {}
            state_file = Path('logs/state.json')
            if state_file.exists():
                with open(state_file) as f:
                    state = json.load(f)
            self.wfile.write(json.dumps(state).encode())
            return
        
        if self.path == '/api/trades':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            trades = []
            trades_file = Path('logs/trades.json')
            if trades_file.exists():
                with open(trades_file) as f:
                    trades = json.load(f)
            self.wfile.write(json.dumps(trades).encode())
            return
        
        return super().do_GET()
    
    def log_message(self, format, *args):
        pass


def run_server(port=PORT):
    os.chdir(Path(__file__).parent)
    
    with socketserver.TCPServer(("", port), DashboardHandler) as httpd:
        print(f"\n{'='*50}")
        print(f"  Dashboard Server")
        print(f"{'='*50}")
        print(f"  Open: http://localhost:{port}")
        print(f"{'='*50}\n")
        httpd.serve_forever()


if __name__ == "__main__":
    run_server()