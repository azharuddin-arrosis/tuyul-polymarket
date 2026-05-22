#!/bin/bash
# Start Polybot with config file

if [ -z "$1" ]; then
    echo "Usage: $0 <bot1|bot2>"
    exit 1
fi

BOT="$1"
ENV_FILE=".env.$BOT"
PORT=$( [ "$BOT" = "bot1" ] && echo "8001" || echo "8002" )

if [ ! -f "$ENV_FILE" ]; then
    echo "Config not found: $ENV_FILE"
    exit 1
fi

source .venv/bin/activate

set -a
source "$ENV_FILE" 2>/dev/null || true
set +a

# Set port and bot name explicitly
export BOT_NAME="$BOT"
export BOT_PORT="$PORT"

echo "Starting $BOT on port $PORT with capital \$$USDC_CAPITAL"

uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"