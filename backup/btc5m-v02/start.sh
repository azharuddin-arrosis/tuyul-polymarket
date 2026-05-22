#!/usr/bin/env bash
# Start BTC 5m Bot and Dashboard
# Ensure common paths are included
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BOT_DIR="$SCRIPT_DIR/bot"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"

# Ensure we are in the script directory
cd "$SCRIPT_DIR"

# Function to cleanup on exit
cleanup() {
    echo "Shutting down..."
    kill "$BOT_PID" 2>/dev/null
    kill "$DASH_PID" 2>/dev/null
    wait "$BOT_PID" 2>/dev/null
    wait "$DASH_PID" 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# Build and start with Docker (keep volumes)
build_docker() {
    echo "Building and starting Docker containers (keeping data)..."
    docker-compose build --no-cache
    docker-compose up -d
    echo "Done! Bot: http://localhost:8082, Dashboard: http://localhost:3000"
}

# Start without Docker (local)
start_local() {
    # Start Bot
    echo "Starting BTC 5m Bot (port 8082)..."
    cd "$BOT_DIR"
    export USER_ADDRESS=${USER_ADDRESS:-0x8F57631c63aB777E2f75a304c445046540453a4d}
    nohup cargo run > bot.log 2>&1 &
    BOT_PID=$!
    echo "Bot started with PID $BOT_PID"

    # Give bot a moment to start
    sleep 3

    # Start Dashboard
    echo "Starting Dashboard (port 3000)..."
    cd "$DASHBOARD_DIR"
    if [ ! -d "node_modules" ]; then
        echo "Installing dashboard dependencies..."
        npm install
    fi
    nohup node server.js > dashboard.log 2>&1 &
    DASH_PID=$!
    echo "Dashboard started with PID $DASH_PID"

    echo ""
    echo "=== Services running ==="
    echo "Bot API: http://localhost:8082"
    echo "Dashboard: http://localhost:3000"
    echo "Logs:"
    echo "  Bot:   $BOT_DIR/bot.log"
    echo "  Dash:  $DASHBOARD_DIR/dashboard.log"
    echo ""
    echo "Press Ctrl+C to stop both services."
    wait
}

# Check if Docker is available
if command -v docker-compose &> /dev/null || command -v docker &> /dev/null; then
    echo "Choose mode:"
    echo "  1) Docker (build + up, keep data)"
    echo "  2) Docker full reset (down -v, rebuild)"
    echo "  3) Local (no Docker)"
    echo ""
    read -p "Enter choice (1/2/3): " choice
    
    case $choice in
        1)
            echo "Building and starting Docker (keep data)..."
            docker-compose build --no-cache
            docker-compose up -d
            echo "Done! Bot: http://localhost:8082, Dashboard: http://localhost:3000"
            ;;
        2)
            echo "Full reset - stopping, removing volumes, rebuilding..."
            docker-compose down -v
            docker-compose build --no-cache
            docker-compose up -d
            echo "Done! All data cleared. Bot: http://localhost:8082, Dashboard: http://localhost:3000"
            ;;
        3)
            start_local
            ;;
        *)
            echo "Invalid choice"
            ;;
    esac
else
    echo "Docker not found, starting local..."
    start_local
fi