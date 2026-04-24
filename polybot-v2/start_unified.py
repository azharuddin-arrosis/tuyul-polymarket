#!/usr/bin/env python3
"""
UNIFIED POLYMARKET BOT CONTROLLER
============================
Menjalankan Bot 1 dan Bot 2 secara bersamaan dengan proses terpisah.

Usage:
    python start_unified.py start      # Start both bots
    python start_unified.py stop   # Stop both bots
    python start_unified.py status # Check status
    python start_unified.py restart # Restart both bots
    python start_unified.py logs    # Tail logs
    python start_unified.py start bot1  # Start only bot1
    python start_unified.py start bot2  # Start only bot2
"""

import os
import sys
import signal
import subprocess
import time
import atexit
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════

PROJECT_ROOT = Path(__file__).parent
BACKEND_DIR = PROJECT_ROOT / "backend"
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"

# Bot configurations
BOTS = {
    "bot1": {
        "env_file": ".env.bot1",
        "port": 8001,
        "log_file": "logs/bot1.log",
        "db_file": "data/bot1_polybot.db",
    },
    "bot2": {
        "env_file": ".env.bot2",
        "port": 8002,
        "log_file": "logs/bot2.log",
        "db_file": "data/bot2_polybot.db",
    },
}

# ═══════════════════════════════════════════════════════════════════════
# PROCESS MANAGEMENT
# ═══════════════════════════════════════════════════════════════

class BotProcess:
    """Manages a single bot process"""
    
    def __init__(self, name: str, config: dict):
        self.name = name
        self.config = config
        self.process: Optional[subprocess.Popen] = self._find_existing_process()
    
    def _find_existing_process(self) -> Optional[subprocess.Popen]:
        """Check if bot is already running"""
        import socket
        port = self.config["port"]
        
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(("localhost", port))
            sock.close()
            if result == 0:
                # Port is in use, check if it's our bot
                return self._get_process_by_port(port)
        except:
            pass
        return None
    
    def _get_process_by_port(self, port: int) -> Optional[subprocess.Popen]:
        """Get process info by port (for status display only)"""
        # This returns a dummy process object for status tracking
        class FakeProcess:
            def __init__(self, p):
                self.pid = p
                self.poll = lambda: None
        try:
            result = subprocess.run(
                ["lsof", "-t", f"-i:{port}"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.stdout.strip():
                pid = int(result.stdout.strip().split()[0])
                return FakeProcess(pid)
        except:
            pass
        return None
    
    def is_running(self) -> bool:
        """Check if bot is running"""
        if self.process:
            self.process.poll()
            return self.process.poll() is None
        return False
    
    def start(self) -> bool:
        """Start the bot"""
        if self.is_running():
            print(f"  {self.name}: already running on port {self.config['port']}")
            return True
        
        env_file = PROJECT_ROOT / self.config["env_file"]
        log_file = PROJECT_ROOT / self.config["log_file"]
        
        # Create logs directory if needed
        log_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Set up environment
        env = os.environ.copy()
        env.update({
            "BOT_NAME": self.name,
            "BOT_MODE": "sim",
        })
        
        # Load env file
        try:
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        if "=" in line:
                            key, value = line.split("=", 1)
                            env[key.strip()] = value.strip()
        except FileNotFoundError:
            pass
        
        # Override with bot name and port
        env["BOT_NAME"] = self.name
        env["BOT_PORT"] = str(self.config["port"])
        
        # Start uvicorn
        cmd = [
            str(VENV_PYTHON),
            "-m", "uvicorn",
            "backend.main:app",
            "--host", "0.0.0.0",
            "--port", str(self.config["port"]),
            "--app-dir", str(PROJECT_ROOT),
        ]
        
        # Open log file
        log_fp = open(log_file, "a")
        
        try:
            proc = subprocess.Popen(
                cmd,
                env=env,
                stdout=log_fp,
                stderr=subprocess.STDOUT,
                cwd=PROJECT_ROOT,
            )
            self.process = proc
            
            # Wait a moment to verify it started
            time.sleep(2)
            proc.poll()
            if proc.returncode is not None:
                print(f"  {self.name}: FAILED to start (exit code {proc.returncode})")
                return False
            
            print(f"  {self.name}: started on port {self.config['port']} (PID: {proc.pid})")
            return True
            
        except Exception as e:
            print(f"  {self.name}: ERROR - {e}")
            return False
    
    def stop(self, force: bool = False) -> bool:
        """Stop the bot"""
        if not self.is_running():
            print(f"  {self.name}: not running")
            return True
        
        try:
            if force:
                self.process.terminate()
                time.sleep(2)
                self.process.poll()
                if self.process.returncode is None:
                    self.process.kill()
            else:
                self.process.terminate()
                self.process.wait(timeout=10)
            
            print(f"  {self.name}: stopped")
            self.process = None
            return True
            
        except subprocess.TimeoutExpired:
            print(f"  {self.name}: force killed")
            self.process.kill()
            self.process = None
            return True
        except Exception as e:
            print(f"  {self.name}: ERROR stopping - {e}")
            return False
    
    def get_status(self) -> dict:
        """Get bot status"""
        port = self.config["port"]
        log_file = self.config["log_file"]
        
        # Check port connectivity
        is_up = False
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            sock.connect_ex(("localhost", port))
            sock.close()
            is_up = True
        except:
            pass
        
        # Get PID if available
        pid = None
        if self.process and hasattr(self.process, 'pid'):
            try:
                self.process.poll()
                if self.process.poll() is None:
                    pid = self.process.pid
            except:
                pass
        
        # Get last log line
        last_log = ""
        try:
            log_path = PROJECT_ROOT / log_file
            if log_path.exists():
                with open(log_path) as f:
                    lines = f.readlines()
                    if lines:
                        last_log = lines[-1].strip()[:100]
        except:
            pass
        
        return {
            "name": self.name,
            "port": port,
            "status": "running" if is_up else "stopped",
            "pid": pid,
            "last_log": last_log,
        }


class BotManager:
    """Manages all bots"""
    
    def __init__(self):
        self.processes = {
            name: BotProcess(name, config) 
            for name, config in BOTS.items()
        }
    
    def start(self, bot_name: Optional[str] = None) -> bool:
        """Start bots"""
        bots_to_start = (
            [self.processes[bot_name]] if bot_name 
            else self.processes.values()
        )
        
        success = True
        for bot in bots_to_start:
            if not bot.start():
                success = False
        
        return success
    
    def stop(self, bot_name: Optional[str] = None, force: bool = False) -> bool:
        """Stop bots"""
        bots_to_stop = (
            [self.processes[bot_name]] if bot_name 
            else self.processes.values()
        )
        
        success = True
        for bot in bots_to_stop:
            if not bot.stop(force):
                success = False
        
        return success
    
    def status(self, bot_name: Optional[str] = None) -> list:
        """Get status of bots"""
        if bot_name:
            return [self.processes[bot_name].get_status()]
        return [bot.get_status() for bot in self.processes.values()]
    
    def restart(self, bot_name: Optional[str] = None) -> bool:
        """Restart bots"""
        if bot_name:
            self.stop(bot_name, force=True)
            time.sleep(1)
            return self.start(bot_name)
        
        self.stop(force=True)
        time.sleep(2)
        return self.start()
    
    def logs(self, bot_name: Optional[str] = None, lines: int = 20):
        """Show recent logs"""
        if bot_name:
            log_file = BOTS[bot_name]["log_file"]
            self._show_log(log_file, lines)
        else:
            # Show both logs interleaved by timestamp
            print(f"\n=== Bot 1 Logs (last {lines} lines) ===")
            self._show_log(BOTS["bot1"]["log_file"], lines)
            print(f"\n=== Bot 2 Logs (last {lines} lines) ===")
            self._show_log(BOTS["bot2"]["log_file"], lines)
    
    def _show_log(self, log_file: str, lines: int):
        """Show log file contents"""
        path = PROJECT_ROOT / log_file
        if path.exists():
            with open(path) as f:
                all_lines = f.readlines()
                for line in all_lines[-lines:]:
                    print(line.rstrip())
        else:
            print(f"Log file not found: {log_file}")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Unified Polymarket Bot Controller"
    )
    parser.add_argument(
        "action",
        choices=["start", "stop", "status", "restart", "logs"],
        help="Action to perform"
    )
    parser.add_argument(
        "bot",
        nargs="?",
        choices=["bot1", "bot2"],
        help="Specific bot (optional)"
    )
    parser.add_argument(
        "-f", "--force",
        action="store_true",
        help="Force stop (kill)"
    )
    parser.add_argument(
        "-n", "--lines",
        type=int,
        default=20,
        help="Number of log lines to show"
    )
    
    args = parser.parse_args()
    
    manager = BotManager()
    
    if args.action == "start":
        print("Starting bots...")
        success = manager.start(args.bot)
        sys.exit(0 if success else 1)
    
    elif args.action == "stop":
        print("Stopping bots...")
        manager.stop(args.bot, force=args.force)
    
    elif args.action == "status":
        statuses = manager.status(args.bot)
        print("\n" + "=" * 60)
        print("  POLYMARKET BOT STATUS")
        print("=" * 60)
        for s in statuses:
            status_icon = "✅" if s["status"] == "running" else "❌"
            print(f"\n  {s['name']}: {status_icon} {s['status'].upper()}")
            print(f"    Port: {s['port']}")
            print(f"    PID: {s['pid'] or 'N/A'}")
            if s.get("last_log"):
                print(f"    Last: {s['last_log']}")
        print("\n" + "=" * 60)
    
    elif args.action == "restart":
        print("Restarting bots...")
        manager.restart(args.bot)
    
    elif args.action == "logs":
        manager.logs(args.bot, args.lines)
    
    sys.exit(0)


if __name__ == "__main__":
    main()