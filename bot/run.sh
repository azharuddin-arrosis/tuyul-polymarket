#!/bin/bash
# bot/run.sh — Polypox Terminal: start backend + frontend together
#
# Usage:
#   ./run.sh                       # sim mode (default), stays attached
#   ./run.sh sim                   # explicit sim
#   ./run.sh dry_run real1         # dry_run with real creds, attached
#   ./run.sh dry_run real1 -d      # detach mode — runs 24/7 in background
#   ./run.sh real real1            # REAL MONEY — bot starts paused
#   ./run.sh stop                  # stop background instance
#   BOT_ID=foo ./run.sh sim        # override bot id
#
# Detach mode (-d):
#   PIDs saved to logs/polypox.pid
#   Logs:  tail -f logs/backend.log
#   Stop:  ./run.sh stop
#
# Press Ctrl+C (attached mode) to stop both cleanly.

set -e

# ─── Setup ───────────────────────────────────────────────────
cd "$(dirname "$0")"
BOT_ROOT="$(pwd)"

# ─── Stop command ────────────────────────────────────────────
# Usage: ./run.sh stop          → stop semua bot
#        ./run.sh stop real1    → stop specific bot
if [ "${1:-}" = "stop" ]; then
    G='\033[0;32m'; Y='\033[0;33m'; D='\033[2m'; X='\033[0m'
    TARGET_BOT="${2:-}"
    if [ -n "$TARGET_BOT" ]; then
        PID_FILE="$BOT_ROOT/logs/polypox-${TARGET_BOT}.pid"
        echo -e "${Y}→ stopping bot $TARGET_BOT...${X}"
        if [ -f "$PID_FILE" ]; then
            while IFS= read -r pid; do
                kill "$pid" 2>/dev/null && echo "  ${D}killed pid $pid${X}" || true
            done < "$PID_FILE"
            rm -f "$PID_FILE"
        fi
        # Best-effort: kill by port pattern using extracted suffix
        _SUFFIX="$(echo "$TARGET_BOT" | grep -oE '[0-9]+$' || echo '')"
        [ -z "$_SUFFIX" ] && _SUFFIX=99
        pkill -f "uvicorn main:app.*$((8000 + _SUFFIX))" 2>/dev/null || true
        pkill -f "vite --port $((3000 + _SUFFIX))"       2>/dev/null || true
        pkill -f "ts-order-service.*$((3100 + _SUFFIX))" 2>/dev/null || true
        echo -e "${G}✓ stopped $TARGET_BOT${X}"
    else
        echo -e "${Y}→ stopping ALL bots...${X}"
        for pidf in "$BOT_ROOT/logs/"polypox-*.pid; do
            [ -f "$pidf" ] || continue
            bid=$(basename "$pidf" .pid | sed 's/^polypox-//')
            echo "  ${D}stopping $bid...${X}"
            while IFS= read -r pid; do
                kill "$pid" 2>/dev/null || true
            done < "$pidf"
            rm -f "$pidf"
        done
        # Belt-and-braces: kill all uvicorn main:app + vite from this project
        pkill -f "uvicorn main:app" 2>/dev/null || true
        pkill -f "vite --port 30"   2>/dev/null || true
        echo -e "${G}✓ stopped all${X}"
    fi
    exit 0
fi

# ─── Clean logs command ──────────────────────────────────────
# Usage: ./run.sh clean          → clear all
#        ./run.sh clean real1    → clear per-bot
if [ "${1:-}" = "clean" ]; then
    G='\033[0;32m'; X='\033[0m'
    TARGET_BOT="${2:-}"
    if [ -n "$TARGET_BOT" ]; then
        # clear semua mode-variant log untuk bot ini
        for f in "$BOT_ROOT/logs/backend-${TARGET_BOT}-"*.log "$BOT_ROOT/logs/frontend-${TARGET_BOT}-"*.log; do
            [ -f "$f" ] && > "$f"
        done
        echo -e "${G}✓ logs cleared for $TARGET_BOT (all modes)${X}"
    else
        for f in "$BOT_ROOT/logs/"*.log; do [ -f "$f" ] && > "$f"; done
        echo -e "${G}✓ all logs cleared${X}"
    fi
    exit 0
fi

# Parse args — allow -d flag in any position after mode
DETACH=0
ARGS=()
for arg in "$@"; do
    if [ "$arg" = "-d" ] || [ "$arg" = "--detach" ]; then
        DETACH=1
    else
        ARGS+=("$arg")
    fi
done

MODE="${ARGS[0]:-sim}"
BOT_ID_ARG="${ARGS[1]:-}"
BOT_ID="${BOT_ID_ARG:-${BOT_ID:-verify}}"
DATA_DIR="${DATA_DIR:-$BOT_ROOT/data/$BOT_ID}"

# Port allocation: extract trailing digits from BOT_ID
# real1 → suffix 1 → BE 8001, FE 3001
# real2 → suffix 2 → BE 8002, FE 3002
# verify (no digits) → suffix 99 → BE 8099, FE 3099 (avoid 3000 dashboard collision)
_SUFFIX="$(echo "$BOT_ID" | grep -oE '[0-9]+$' || echo '')"
if [ -z "$_SUFFIX" ]; then _SUFFIX=99; fi
BE_PORT="${BE_PORT:-$((8000 + _SUFFIX))}"
FE_PORT="${FE_PORT:-$((3000 + _SUFFIX))}"

VALID_MODES=("sim" "dry_run" "real")
if ! [[ " ${VALID_MODES[*]} " =~ " ${MODE} " ]]; then
    echo "✗ invalid mode: $MODE (must be sim/dry_run/real)"
    exit 1
fi

mkdir -p "$DATA_DIR" "$BOT_ROOT/logs"

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; D='\033[2m'; X='\033[0m'

# ─── Stop existing instances on THIS bot's ports ─────────────
pkill -f "uvicorn main:app.*$BE_PORT" 2>/dev/null && echo -e "${D}stopped old uvicorn :$BE_PORT${X}" || true
pkill -f "vite --port $FE_PORT"       2>/dev/null && echo -e "${D}stopped old vite :$FE_PORT${X}"    || true
sleep 1

# ─── Load env if dry_run/real ────────────────────────────────
ENV_FILE=""
if [ "$MODE" = "real" ] || [ "$MODE" = "dry_run" ]; then
    ENV_FILE="backend/envs/${BOT_ID}.env"
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${R}✗ $ENV_FILE not found for mode=$MODE${X}"
        echo "  Available env files:"
        ls backend/envs/*.env 2>/dev/null | sed 's|backend/envs/|    |'
        exit 1
    fi
    echo -e "${B}→ loading $ENV_FILE${X}"
    set -a; source "$ENV_FILE"; set +a
    # CRITICAL: override BOT_MODE from arg (env file may say 'real' but we want 'dry_run')
    export BOT_MODE="$MODE"
    # Real mode safety reminder
    if [ "$MODE" = "real" ]; then
        echo -e "${R}⚠ REAL MONEY MODE — bot starts PAUSED. Use UI tombol RUN untuk mulai trading.${X}"
    fi
fi

# ─── Check venv + deps ───────────────────────────────────────
if [ ! -f "$BOT_ROOT/venv/bin/python" ]; then
    echo -e "${R}✗ venv not found at $BOT_ROOT/venv. Run: python -m venv venv && venv/bin/pip install -r backend/requirements.txt${X}"
    exit 1
fi

if [ ! -d "$BOT_ROOT/frontend-bot/node_modules" ]; then
    echo -e "${Y}→ installing frontend deps (first run)...${X}"
    (cd frontend-bot && npm install --silent)
fi

if [ "$MODE" = "real" ] && [ ! -d "$BOT_ROOT/ts-order-service/node_modules" ]; then
    echo -e "${Y}→ installing TS order service deps (first run)...${X}"
    (cd ts-order-service && npm install --silent)
fi

# ─── Pre-flight validator for real mode ──────────────────────
if [ "$MODE" = "real" ]; then
    echo -e "${B}→ running pre-flight validator...${X}"
    if ! (cd backend && "$BOT_ROOT/venv/bin/python" validate_real.py); then
        echo -e "${R}✗ pre-flight failed — refusing to start real mode${X}"
        exit 1
    fi
    echo ""
    read -p "$(echo -e "${Y}Continue starting REAL mode? [y/N]: ${X}")" -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "aborted."
        exit 0
    fi
fi

# Per-bot log files — suffix mode biar dry/real tidak campur
# backend-real1-real.log | backend-real1-dry.log | backend-real1-sim.log
case "$MODE" in
  real)    MODE_SUFFIX="real" ;;
  dry_run) MODE_SUFFIX="dry"  ;;
  sim)     MODE_SUFFIX="sim"  ;;
  *)       MODE_SUFFIX="$MODE" ;;
esac
BE_LOG="$BOT_ROOT/logs/backend-${BOT_ID}-${MODE_SUFFIX}.log"
FE_LOG="$BOT_ROOT/logs/frontend-${BOT_ID}-${MODE_SUFFIX}.log"
TS_LOG="$BOT_ROOT/logs/ts-order-${BOT_ID}.log"

# ─── Start TS Order Service (real mode only) ──────────────────
if [ "$MODE" = "real" ] && [ -f "$BOT_ROOT/ts-order-service/server.mjs" ]; then
    TS_PORT=$((3100 + _SUFFIX))
    echo -e "${B}→ starting TS order service${X} ${D}(port=$TS_PORT)${X}"
    (
        cd "$BOT_ROOT/ts-order-service"
        echo "" >> "$TS_LOG"
        echo "══ [$(date '+%H:%M:%S')] TS ORDER SERVICE START bot=$BOT_ID port=$TS_PORT ══" >> "$TS_LOG"
        ORDER_SERVICE_PORT="$TS_PORT" \
            node --env-file="../backend/envs/${BOT_ID}.env" server.mjs >> "$TS_LOG" 2>&1
    ) &
    TS_PID=$!
    # Wait for TS service ready
    echo -n "  ts-order "
    for i in $(seq 1 10); do
        if curl -s "http://127.0.0.1:$TS_PORT/health" > /dev/null 2>&1; then
            echo -e "${G}✓${X}"
            break
        fi
        if [ $i -eq 10 ]; then
            echo -e "${R}✗ timeout${X}"
            tail -10 "$TS_LOG" | sed 's/^/    /'
            kill $TS_PID 2>/dev/null || true
        fi
        sleep 1; echo -n "."
    done
fi

# ─── Start backend ───────────────────────────────────────────
echo -e "${B}→ starting backend${X} ${D}(BOT_ID=$BOT_ID MODE=$MODE BE=$BE_PORT DATA=$DATA_DIR)${X}"
(
    cd backend
    echo "" >> "$BE_LOG"
    echo "═══════════════════════════════════════════════════════════════" >> "$BE_LOG"
    echo "  [$(date '+%Y-%m-%d %H:%M:%S')] BACKEND RESTART — BOT_ID=$BOT_ID MODE=$MODE PORT=$BE_PORT" >> "$BE_LOG"
    echo "═══════════════════════════════════════════════════════════════" >> "$BE_LOG"
    PYTHONUNBUFFERED=1 BOT_ID="$BOT_ID" BOT_MODE="$MODE" DATA_DIR="$DATA_DIR" \
        "$BOT_ROOT/venv/bin/python" -u -m uvicorn main:app \
        --host 127.0.0.1 --port "$BE_PORT" --log-level warning \
        >> "$BE_LOG" 2>&1
) &
BACKEND_PID=$!

# ─── Start frontend ──────────────────────────────────────────
echo -e "${B}→ starting frontend (vite)${X} ${D}(FE=$FE_PORT → BE=$BE_PORT)${X}"
(
    cd frontend-bot
    echo "" >> "$FE_LOG"
    echo "── [$(date '+%H:%M:%S')] FRONTEND RESTART BOT_ID=$BOT_ID PORT=$FE_PORT ──" >> "$FE_LOG"
    VITE_FE_PORT="$FE_PORT" VITE_BE_PORT="$BE_PORT" VITE_BOT_ID="$BOT_ID" \
        npm run dev -- --port "$FE_PORT" >> "$FE_LOG" 2>&1
) &
FRONTEND_PID=$!

# ─── Wait for both ready ─────────────────────────────────────
echo -n "  backend "
for i in $(seq 1 20); do
    if curl -s "http://127.0.0.1:$BE_PORT/health" > /dev/null 2>&1; then
        echo -e "${G}✓${X}"
        break
    fi
    if [ $i -eq 20 ]; then
        echo -e "${R}✗ timeout${X}"
        echo "  Last 10 lines of $BE_LOG:"
        tail -10 "$BE_LOG" | sed 's/^/    /'
        kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
    echo -n "."
done

echo -n "  frontend "
for i in $(seq 1 30); do
    if curl -s --max-time 2 "http://localhost:$FE_PORT/" > /dev/null 2>&1 || \
       curl -s --max-time 2 "http://127.0.0.1:$FE_PORT/" > /dev/null 2>&1; then
        echo -e "${G}✓${X}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${R}✗ timeout${X}"
        tail -10 "$FE_LOG" | sed 's/^/    /'
        kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
    echo -n "."
done

# ─── Banner ──────────────────────────────────────────────────
echo ""
echo -e "${G}══════════════════════════════════════════════${X}"
echo -e "${G}  Polypox Terminal — $BOT_ID RUNNING${X}"
echo -e "${G}══════════════════════════════════════════════${X}"
echo -e "  ${B}Frontend:${X}  http://localhost:$FE_PORT"
echo -e "  ${B}Backend:${X}   http://localhost:$BE_PORT"
echo -e "  ${B}Mode:${X}      $MODE"
echo -e "  ${B}Bot ID:${X}    $BOT_ID"
[ -n "${TS_PORT:-}" ] && echo -e "  ${B}TS Order:${X}  http://localhost:$TS_PORT"
echo -e "  ${B}Data dir:${X}  $DATA_DIR"
echo -e "  ${B}Logs:${X}      $BE_LOG  /  $FE_LOG"
echo -e "${G}══════════════════════════════════════════════${X}"

# ─── Detach mode: save PIDs and exit ─────────────────────────
if [ "$DETACH" = "1" ]; then
    PID_FILE="$BOT_ROOT/logs/polypox-${BOT_ID}.pid"
    echo "$BACKEND_PID"  > "$PID_FILE"
    echo "$FRONTEND_PID" >> "$PID_FILE"
    [ -n "${TS_PID:-}" ] && echo "$TS_PID" >> "$PID_FILE"
    echo -e "  ${B}Mode:${X}      DETACHED (background)"
    echo -e "  ${B}PIDs:${X}      BE=$BACKEND_PID FE=$FRONTEND_PID → $PID_FILE"
    echo -e "  ${Y}Tail logs:${X} tail -f $BE_LOG"
    echo -e "  ${Y}Stop:${X}      ./run.sh stop $BOT_ID"
    echo -e "${G}══════════════════════════════════════════════${X}"
    echo ""
    exit 0
fi

# ─── Attached mode: cleanup trap + stream logs ────────────────
echo -e "${D}  Ctrl+C to stop both${X}"
echo ""

_BE_PORT_TRAP="$BE_PORT" _FE_PORT_TRAP="$FE_PORT"
cleanup() {
    echo ""
    echo -e "${Y}→ stopping $BOT_ID...${X}"
    kill $BACKEND_PID $FRONTEND_PID ${TS_PID:-} 2>/dev/null || true
    pkill -f "uvicorn main:app.*$_BE_PORT_TRAP" 2>/dev/null || true
    pkill -f "vite --port $_FE_PORT_TRAP"       2>/dev/null || true
    [ -n "${TS_PORT:-}" ] && pkill -f "ORDER_SERVICE_PORT=$TS_PORT" 2>/dev/null || true
    echo -e "${G}✓ stopped${X}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# Stream logs with prefixes
if [ -f "$TS_LOG" ]; then
    tail -F -q "$BE_LOG" "$FE_LOG" "$TS_LOG" 2>/dev/null \
        | awk -v G="$G" -v B="$B" -v D="$D" -v X="$X" '
            /uvicorn|FastAPI|BTC5m|Orderbook|BOT_|MODE|REDEEM|BREAKER|RECONCILE/ { print B"[BE]"X" "$0; next }
            /VITE|vite|HMR|ready|Local:|hmr/                                     { print G"[FE]"X" "$0; next }
            /ORDER|CLOB/                                                         { print "[TS]"X" "$0; next }
            { print D"   "X" "$0 }
        '
else
    tail -F -q "$BE_LOG" "$FE_LOG" 2>/dev/null \
        | awk -v G="$G" -v B="$B" -v D="$D" -v X="$X" '
            /uvicorn|FastAPI|BTC5m|Orderbook|BOT_|MODE|REDEEM|BREAKER|RECONCILE/ { print B"[BE]"X" "$0; next }
            /VITE|vite|HMR|ready|Local:|hmr/                                     { print G"[FE]"X" "$0; next }
            { print D"   "X" "$0 }
        '
fi
