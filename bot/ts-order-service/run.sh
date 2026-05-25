#!/bin/bash
# Run TS order service per bot
# Usage: ./run.sh real1 start|stop|status
DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_ID="${2:-${1:-real1}}"
CMD="${2:-start}"
[ "$CMD" = "$BOT_ID" ] && CMD="${3:-start}"

ENV_FILE="../backend/envs/${BOT_ID}.env"
PORT=$((3100 + ${BOT_ID//real/}))
[ "$BOT_ID" = "real1" ] && PORT=3100
[ "$BOT_ID" = "real2" ] && PORT=3101

PID_FILE="$DIR/.pid-${BOT_ID}"
LOG_FILE="$DIR/service-${BOT_ID}.log"

if [ "$CMD" = "start" ]; then
    if [ ! -f "$DIR/$ENV_FILE" ]; then
        echo "Env not found: $ENV_FILE"
        exit 1
    fi
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "$BOT_ID already running (PID $(cat $PID_FILE))"
        exit 0
    fi
    cd "$DIR"
    ORDER_SERVICE_PORT=$PORT nohup node --env-file="$ENV_FILE" server.mjs >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "$BOT_ID started on :$PORT (PID $(cat $PID_FILE))"
        echo "Log: tail -f $LOG_FILE"
    else
        echo "FAILED — check $LOG_FILE"
        cat "$LOG_FILE"
        exit 1
    fi
elif [ "$CMD" = "stop" ]; then
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null && echo "$BOT_ID stopped"
        rm -f "$PID_FILE"
    else
        echo "$BOT_ID not running"
    fi
elif [ "$CMD" = "status" ]; then
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "$BOT_ID running on :$PORT (PID $(cat $PID_FILE))"
        echo "Last 5 lines:"
        tail -5 "$LOG_FILE"
    else
        echo "$BOT_ID not running"
    fi
else
    echo "Usage: $0 <bot_id> start|stop|status"
    echo "  $0 real1 start"
    echo "  $0 real2 start"
fi
