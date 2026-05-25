#!/bin/bash
# Run TS order service in background
DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.pid"
LOG_FILE="$DIR/service.log"

case "${1:-start}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "Already running (PID $(cat $PID_FILE))"
        exit 0
    fi
    cd "$DIR"
    nohup node --env-file=../backend/envs/real1.env server.mjs >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "Started (PID $(cat $PID_FILE))"
        echo "Log: tail -f $LOG_FILE"
    else
        echo "FAILED — check $LOG_FILE"
        cat "$LOG_FILE"
        exit 1
    fi
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null && echo "Stopped"
        rm -f "$PID_FILE"
    else
        echo "Not running"
    fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "Running (PID $(cat $PID_FILE))"
        echo "Last 5 lines:"
        tail -5 "$LOG_FILE"
    else
        echo "Not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    ;;
esac
