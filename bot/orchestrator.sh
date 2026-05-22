#!/bin/bash
# orchestrator.sh — multi-bot orchestrator untuk Polypox Terminal
#
# Usage:
#   ./orchestrator.sh discover            # scan envs/real*.env → generate bots.json
#   ./orchestrator.sh start all           # start dashboard + all real bots (dry_run mode)
#   ./orchestrator.sh start real1         # start specific bot
#   ./orchestrator.sh start dashboard     # start dashboard only
#   ./orchestrator.sh stop all            # stop everything
#   ./orchestrator.sh stop real1          # stop specific
#   ./orchestrator.sh status              # list running bots + dashboard
#   ./orchestrator.sh restart all
#
# Convention:
#   - Dashboard runs at port 3000
#   - real1 → BE 8001, FE 3001
#   - real2 → BE 8002, FE 3002 (etc.)
#
# Default mode untuk auto-start: dry_run (safer than real)
set -e
cd "$(dirname "$0")"
BOT_ROOT="$(pwd)"
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; D='\033[2m'; X='\033[0m'

DASHBOARD_PORT=3000
DEFAULT_MODE="${ORCHESTRATOR_MODE:-dry_run}"   # override: ORCHESTRATOR_MODE=real
MANIFEST="$BOT_ROOT/frontend-dashboard/public/bots.json"

# ─── Discover: scan envs/real*.env ───────────────────────────
discover_bots() {
    local bots=()
    for f in backend/envs/real*.env; do
        [ -f "$f" ] || continue
        local id=$(basename "$f" .env)
        local suffix=$(echo "$id" | grep -oE '[0-9]+$' || echo '')
        [ -z "$suffix" ] && suffix=99
        local be_port=$((8000 + suffix))
        local fe_port=$((3000 + suffix))
        bots+=("$id:$be_port:$fe_port")
    done
    echo "${bots[@]}"
}

write_manifest() {
    mkdir -p "$(dirname "$MANIFEST")"
    local bots=($(discover_bots))
    {
        echo "{"
        echo "  \"generated_at\": \"$(date -u +%FT%TZ)\","
        echo "  \"dashboard_port\": $DASHBOARD_PORT,"
        echo "  \"bots\": ["
        local first=1
        for entry in "${bots[@]}"; do
            IFS=':' read -r id be fe <<< "$entry"
            [ $first -eq 1 ] && first=0 || echo ","
            printf '    { "id": "%s", "backend_port": %s, "frontend_port": %s }' "$id" "$be" "$fe"
        done
        echo ""
        echo "  ]"
        echo "}"
    } > "$MANIFEST"
    echo -e "${G}✓${X} ${D}manifest written → $MANIFEST${X}"
    cat "$MANIFEST"
}

# ─── Status check via /health ────────────────────────────────
bot_status() {
    local port=$1
    if curl -s --max-time 2 "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
        echo "RUNNING"
    else
        echo "STOPPED"
    fi
}

fe_status() {
    local port=$1
    if curl -s --max-time 2 "http://127.0.0.1:$port/" > /dev/null 2>&1; then
        echo "RUNNING"
    else
        echo "STOPPED"
    fi
}

print_status() {
    local bots=($(discover_bots))
    echo ""
    echo -e "${B}══════════════════════════════════════════════════════════${X}"
    printf "  ${B}%-12s %-8s %-8s %-12s %-12s${X}\n" "BOT" "BE PORT" "FE PORT" "BACKEND" "FRONTEND"
    echo -e "${B}──────────────────────────────────────────────────────────${X}"

    local dash_st=$(fe_status $DASHBOARD_PORT)
    local dash_color="$([ "$dash_st" = "RUNNING" ] && echo "$G" || echo "$R")"
    printf "  %-12s %-8s %-8s %-12s ${dash_color}%-12s${X}\n" "dashboard" "—" "$DASHBOARD_PORT" "—" "$dash_st"

    for entry in "${bots[@]}"; do
        IFS=':' read -r id be fe <<< "$entry"
        local be_st=$(bot_status $be)
        local fe_st=$(fe_status $fe)
        local be_color="$([ "$be_st" = "RUNNING" ] && echo "$G" || echo "$R")"
        local fe_color="$([ "$fe_st" = "RUNNING" ] && echo "$G" || echo "$R")"
        printf "  %-12s %-8s %-8s ${be_color}%-12s${X} ${fe_color}%-12s${X}\n" "$id" "$be" "$fe" "$be_st" "$fe_st"
    done
    echo -e "${B}══════════════════════════════════════════════════════════${X}"
    echo -e "  ${D}Dashboard URL: http://localhost:$DASHBOARD_PORT${X}"
    echo ""
}

start_bot() {
    local bot=$1
    local mode="${2:-$DEFAULT_MODE}"
    echo -e "${B}→ starting bot $bot (mode=$mode, detached)...${X}"
    ./run.sh "$mode" "$bot" -d
}

start_dashboard() {
    if [ "$(fe_status $DASHBOARD_PORT)" = "RUNNING" ]; then
        echo -e "${D}dashboard already running on :$DASHBOARD_PORT${X}"
        return
    fi
    if [ ! -d "$BOT_ROOT/frontend-dashboard/node_modules" ]; then
        echo -e "${Y}→ installing dashboard deps (first run)...${X}"
        (cd frontend-dashboard && npm install --silent)
    fi
    write_manifest > /dev/null
    echo -e "${B}→ starting dashboard at :$DASHBOARD_PORT${X}"
    LOG="$BOT_ROOT/logs/dashboard.log"
    echo "" >> "$LOG"
    echo "── [$(date '+%H:%M:%S')] DASHBOARD RESTART ──" >> "$LOG"
    (cd frontend-dashboard && nohup npm run dev -- --port $DASHBOARD_PORT >> "$LOG" 2>&1 &) > /dev/null 2>&1
    sleep 2
    echo -e "  ${G}✓${X} http://localhost:$DASHBOARD_PORT"
}

stop_bot() {
    local bot=$1
    ./run.sh stop "$bot"
}

stop_dashboard() {
    pkill -f "vite --port $DASHBOARD_PORT" 2>/dev/null && echo -e "${G}✓ dashboard stopped${X}" || true
}

# ─── Command dispatcher ──────────────────────────────────────
# Usage:
#   ./orchestrator.sh start all              → dry_run (default)
#   ./orchestrator.sh start all real         → all bots in real mode
#   ./orchestrator.sh start real1 dry_run    → real1 only, dry_run mode
#   ./orchestrator.sh start real1 real       → real1 only, REAL mode
#   ./orchestrator.sh start real1 sim        → real1 only, SIM mode
CMD="${1:-status}"
TARGET="${2:-all}"
MODE_ARG="${3:-}"   # optional: sim | dry_run | real

# Validate mode if passed
if [ -n "$MODE_ARG" ]; then
    case "$MODE_ARG" in
        sim|dry_run|real) ;;
        *)
            echo -e "${R}✗ invalid mode: $MODE_ARG (must be sim/dry_run/real)${X}"
            exit 1
            ;;
    esac
fi
EFFECTIVE_MODE="${MODE_ARG:-$DEFAULT_MODE}"

case "$CMD" in
    discover)
        write_manifest
        ;;
    start)
        if [ "$TARGET" = "all" ]; then
            echo -e "${B}→ starting all bots in mode=${EFFECTIVE_MODE}${X}"
            if [ "$EFFECTIVE_MODE" = "real" ]; then
                echo -e "${R}⚠ REAL MONEY MODE for ALL bots — pastikan validator PASS dulu untuk masing-masing${X}"
                read -p "$(echo -e "${Y}Continue starting all bots in REAL mode? [y/N]: ${X}")" -n 1 -r
                echo
                [[ ! $REPLY =~ ^[Yy]$ ]] && { echo "aborted."; exit 0; }
            fi
            write_manifest > /dev/null
            start_dashboard
            for entry in $(discover_bots); do
                IFS=':' read -r id _ _ <<< "$entry"
                start_bot "$id" "$EFFECTIVE_MODE"
                sleep 2
            done
            print_status
        elif [ "$TARGET" = "dashboard" ]; then
            start_dashboard
        else
            start_bot "$TARGET" "$EFFECTIVE_MODE"
        fi
        ;;
    stop)
        if [ "$TARGET" = "all" ]; then
            stop_dashboard
            ./run.sh stop
        elif [ "$TARGET" = "dashboard" ]; then
            stop_dashboard
        else
            stop_bot "$TARGET"
        fi
        ;;
    restart)
        $0 stop "$TARGET"
        sleep 2
        $0 start "$TARGET" "$EFFECTIVE_MODE"
        ;;
    status|"")
        print_status
        ;;
    *)
        echo "Unknown command: $CMD"
        echo ""
        echo "Usage:"
        echo "  ./orchestrator.sh discover                    scan envs/real*.env → bots.json"
        echo "  ./orchestrator.sh start all [mode]            start dashboard + all bots (default dry_run)"
        echo "  ./orchestrator.sh start <bot_id> [mode]       start specific bot"
        echo "  ./orchestrator.sh start dashboard             start dashboard only"
        echo "  ./orchestrator.sh stop  all|<bot_id>|dashboard"
        echo "  ./orchestrator.sh restart all|<bot_id>"
        echo "  ./orchestrator.sh status"
        echo ""
        echo "Modes: sim | dry_run | real (default: dry_run)"
        exit 1
        ;;
esac
