#!/bin/bash
# wd.sh — Manual withdrawal manager untuk Polypox Terminal
#
# Usage:
#   ./wd.sh status                              # show all bots + WD readiness
#   ./wd.sh suggest <bot_id> [percent]         # suggest withdrawal amount
#   ./wd.sh confirm <bot_id> [mode] [args]     # finalize withdrawal
#     DRY_RUN:  ./wd.sh confirm real1 dry_run --amount=51.12
#     REAL:     ./wd.sh confirm real1 real --usdc=51.12 --pol=9.5
#   ./wd.sh history <bot_id>                    # show WD history
#

set -e
cd "$(dirname "$0")"
BOT_ROOT="$(pwd)"
DATA_DIR="$BOT_ROOT/data"

G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; D='\033[2m'; X='\033[0m'

# ─── Helper: read state.json ───
get_state_value() {
    local bot=$1 key=$2
    [ -f "$DATA_DIR/$bot/state_${bot}.json" ] && \
        jq -r ".$key // empty" "$DATA_DIR/$bot/state_${bot}.json" 2>/dev/null || echo ""
}

# ─── Helper: get bot mode from /api/stats ───
get_bot_mode() {
    local port=$1
    curl -s --max-time 1 "http://127.0.0.1:$port/api/stats" 2>/dev/null | \
        grep -o '"mode_raw":"[^"]*"' | cut -d'"' -f4 | head -1 || echo "—"
}

# ─── Helper: check if bot is running ───
bot_is_running() {
    local port=$1
    curl -s --max-time 1 "http://127.0.0.1:$port/health" > /dev/null 2>&1
}

# ─── Helper: update state.json ───
update_state() {
    local bot=$1 updates=$2
    local state_file="$DATA_DIR/$bot/state_${bot}.json"

    if [ ! -f "$state_file" ]; then
        echo -e "${R}✗ state file not found: $state_file${X}"
        return 1
    fi

    cp "$state_file" "${state_file}.bak"
    jq "$updates" "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
}

# ─── Status: show all bots with WD readiness ───
cmd_status() {
    echo ""
    echo -e "${B}WITHDRAWAL STATUS — All Bots${X}"
    echo -e "${B}──────────────────────────────────────────────────────────────────${X}"
    printf "  ${B}%-10s %-12s %-10s %-12s %-15s${X}\n" "BOT" "MODE" "STATUS" "CAPITAL" "WD READINESS"
    echo -e "${B}──────────────────────────────────────────────────────────────────${X}"

    for bot_dir in "$DATA_DIR"/real*/; do
        bot=$(basename "$bot_dir")

        capital=$(get_state_value "$bot" "capital")
        [ -z "$capital" ] && continue

        capital_fmt=$(printf "%.2f" "$capital")

        # Get bot mode and status
        port=$((8000 + ${bot#real}))

        if bot_is_running $port; then
            mode=$(get_bot_mode $port)
            status="${G}RUN${X}"
        else
            mode="—"
            status="${R}STOP${X}"
        fi

        # Determine WD readiness
        if (( $(echo "$capital >= 100" | bc -l 2>/dev/null) )); then
            if [ "$mode" = "dry_run" ] || [ "$mode" = "DRY_RUN" ]; then
                readiness="${G}✓ DRY${X}"
            elif [ "$mode" = "real" ] || [ "$mode" = "REAL" ]; then
                readiness="${R}✓ REAL${X}"
            else
                readiness="${G}✓ READY${X}"
            fi
        else
            to_100=$(printf "%.2f" $(echo "100 - $capital" | bc -l))
            readiness="${Y}⏳ +\$$to_100${X}"
        fi

        printf "  %-10s %-12s %s \$%-11s %s\n" "$bot" "$mode" "$status" "$capital_fmt" "$readiness"
    done

    echo -e "${B}──────────────────────────────────────────────────────────────────${X}"
    echo ""
}

# ─── Suggest: show withdrawal recommendation ───
cmd_suggest() {
    local bot=$1
    local pct=${2:-50}

    if [ -z "$bot" ]; then
        echo -e "${R}✗ usage: ./wd.sh suggest <bot_id> [percent]${X}"
        return 1
    fi

    if [ ! -d "$DATA_DIR/$bot" ]; then
        echo -e "${R}✗ bot not found: $bot${X}"
        return 1
    fi

    capital=$(get_state_value "$bot" "capital")
    [ -z "$capital" ] && { echo -e "${R}✗ no state found for $bot${X}"; return 1; }

    # Get bot mode
    port=$((8000 + ${bot#real}))
    if bot_is_running $port; then
        mode=$(get_bot_mode $port)
    else
        mode="—"
    fi

    capital_fmt=$(printf "%.2f" "$capital")
    pct_val=$(echo "scale=2; $capital * $pct / 100" | bc)
    keep_pct=$((100 - pct))
    keep_val=$(echo "scale=2; $capital * $keep_pct / 100" | bc)

    echo ""
    echo -e "${B}WITHDRAWAL SUGGESTION — $bot (MODE: $mode)${X}"
    echo -e "${B}──────────────────────────────────────────────────────────────${X}"
    printf "  Current capital:  \$%s\n" "$capital_fmt"
    printf "  Suggest withdraw: \$%s (%d%%)\n" "$pct_val" "$pct"
    printf "  After withdrawal: \$%s (%d%%)\n" "$keep_val" "$keep_pct"
    echo -e "${B}──────────────────────────────────────────────────────────────${X}"
    echo ""

    if [ "$mode" = "dry_run" ] || [ "$mode" = "DRY_RUN" ]; then
        echo -e "${Y}MODE: DRY_RUN (Simulated)${X}"
        echo -e "  1. Stop bot:     ${D}./orchestrator.sh stop $bot${X}"
        echo -e "  2. Confirm WD:   ${D}./wd.sh confirm $bot dry_run --amount=${pct_val}${X}"
        echo -e "  3. Restart bot:  ${D}./orchestrator.sh start $bot dry_run${X}"
    else
        echo -e "${R}MODE: REAL (Actual USDC)${X}"
        echo -e "  1. Stop bot:     ${D}./orchestrator.sh stop $bot${X}"
        echo -e "  2. Go to Polymarket → Withdraw \$${pct_val} USDC manually"
        echo -e "  3. Note: final USDC balance + POL gas remaining"
        echo -e "  4. Confirm:      ${D}./wd.sh confirm $bot real --usdc=AMOUNT --pol=AMOUNT${X}"
        echo -e "     Example:      ${D}./wd.sh confirm $bot real --usdc=${keep_val} --pol=9.5${X}"
    fi
    echo ""
}

# ─── Confirm: finalize withdrawal ───
cmd_confirm() {
    local bot=$1
    local mode=$2
    shift 2

    [ -z "$bot" ] && { echo -e "${R}✗ usage: ./wd.sh confirm <bot_id> <dry_run|real> [--amount=X or --usdc=X --pol=Y]${X}"; return 1; }
    [ -z "$mode" ] && { echo -e "${R}✗ mode required: dry_run or real${X}"; return 1; }

    local amount="" usdc_after="" pol_after=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --amount=*) amount="${1#*=}" ;;
            --usdc=*) usdc_after="${1#*=}" ;;
            --pol=*) pol_after="${1#*=}" ;;
            *) echo -e "${R}✗ unknown flag: $1${X}"; return 1 ;;
        esac
        shift
    done

    # Validate mode
    case "$mode" in
        dry_run|DRY_RUN) mode="dry_run" ;;
        real|REAL) mode="real" ;;
        *) echo -e "${R}✗ invalid mode: $mode (use dry_run or real)${X}"; return 1 ;;
    esac

    if [ ! -d "$DATA_DIR/$bot" ]; then
        echo -e "${R}✗ bot not found: $bot${X}"
        return 1
    fi

    capital_before=$(get_state_value "$bot" "capital")
    [ -z "$capital_before" ] && { echo -e "${R}✗ no state found for $bot${X}"; return 1; }

    # Validate args based on mode
    if [ "$mode" = "dry_run" ]; then
        [ -z "$amount" ] && { echo -e "${R}✗ DRY_RUN requires --amount=X${X}"; return 1; }
        capital_after="$amount"
        withdrawn=$(echo "scale=2; $capital_before - $amount" | bc)
    else
        [ -z "$usdc_after" ] || [ -z "$pol_after" ] && { echo -e "${R}✗ REAL mode requires --usdc=X --pol=Y${X}"; return 1; }
        capital_after="$usdc_after"
        withdrawn=$(echo "scale=2; $capital_before - $usdc_after" | bc)
    fi

    # Confirmation
    echo ""
    echo -e "${B}WITHDRAWAL CONFIRMATION${X}"
    echo -e "${B}──────────────────────────────────────────────────────────────${X}"
    printf "  Bot:              %s\n" "$bot"
    printf "  Mode:             %s\n" "$mode"
    printf "  Before:           \$%.2f\n" "$capital_before"
    printf "  After:            \$%s\n" "$capital_after"
    printf "  Withdrawn:        \$%.2f\n" "$withdrawn"
    if [ -n "$pol_after" ]; then
        printf "  POL remaining:    %s\n" "$pol_after"
    fi
    echo -e "${B}──────────────────────────────────────────────────────────────${X}"

    read -p "$(echo -e "${Y}Confirm withdrawal? [y/N]: ${X}")" -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && { echo "aborted."; return 0; }

    # Update state
    echo -e "${B}→ updating state...${X}"

    # Create withdrawal history entry
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    wd_entry="{\"timestamp\":\"$timestamp\",\"capital_before\":$(echo "scale=4; $capital_before" | bc),\"amount_withdrawn\":$(echo "scale=4; $withdrawn" | bc),\"capital_after\":$(echo "scale=4; $capital_after" | bc),\"mode\":\"$mode\"}"

    update_state "$bot" \
        ". | .capital = $(echo "scale=4; $capital_after" | bc) \
             | .daily_pnl = 0 \
             | .locked = 0 \
             | .withdrawal_history += [$wd_entry]"

    # Update env file
    env_file="backend/envs/${bot}.env"
    if [ -f "$env_file" ]; then
        sed -i '' "s/^USDC_CAPITAL=.*/USDC_CAPITAL=$(printf '%.2f' "$capital_after")/" "$env_file"
        if [ -n "$pol_after" ]; then
            sed -i '' "s/^POL_BALANCE=.*/POL_BALANCE=$pol_after/" "$env_file"
        fi
        echo -e "${G}✓${X} updated env"
    fi

    echo -e "${G}✓ withdrawal confirmed!${X}"
    echo ""
    echo -e "${Y}NEXT:${X} Restart bot"
    echo -e "  ${D}./orchestrator.sh start $bot $mode${X}"
    echo ""
}

# ─── History: show WD history for a bot ───
cmd_history() {
    local bot=$1
    [ -z "$bot" ] && { echo -e "${R}✗ usage: ./wd.sh history <bot_id>${X}"; return 1; }
    [ ! -d "$DATA_DIR/$bot" ] && { echo -e "${R}✗ bot not found: $bot${X}"; return 1; }

    history=$(get_state_value "$bot" "withdrawal_history")

    echo ""
    echo -e "${B}WITHDRAWAL HISTORY — $bot${X}"
    echo -e "${B}────────────────────────────────────────────────────────────────${X}"

    if [ -z "$history" ] || [ "$history" = "null" ] || [ "$history" = "[]" ]; then
        echo -e "  ${D}(no withdrawals yet)${X}"
    else
        printf "  ${B}%-20s %-12s %-12s %-12s %-10s${X}\n" "DATE" "BEFORE" "WITHDRAWN" "AFTER" "MODE"
        echo -e "${B}────────────────────────────────────────────────────────────────${X}"

        echo "$history" | jq -r '.[] | "\(.timestamp) \(.capital_before) \(.amount_withdrawn) \(.capital_after) \(.mode)"' | while read ts cb wd ca mode; do
            # Parse timestamp to date format
            date_fmt=$(echo "$ts" | cut -d'T' -f1)
            printf "  %-20s \$%-11s \$%-11s \$%-11s %-10s\n" "$date_fmt" "$cb" "$wd" "$ca" "$mode"
        done
    fi

    echo -e "${B}────────────────────────────────────────────────────────────────${X}"
    echo ""
}

# ─── Main dispatcher ───
CMD="${1:-status}"

case "$CMD" in
    status)
        cmd_status
        ;;
    suggest)
        cmd_suggest "$2" "$3"
        ;;
    confirm)
        cmd_confirm "$2" "$3" "${@:4}"
        ;;
    history)
        cmd_history "$2"
        ;;
    *)
        echo "Usage:"
        echo "  ./wd.sh status                                    # show all bots"
        echo "  ./wd.sh suggest <bot_id> [percent]               # suggestion"
        echo "  ./wd.sh confirm <bot_id> dry_run --amount=X      # DRY_RUN WD"
        echo "  ./wd.sh confirm <bot_id> real --usdc=X --pol=Y   # REAL WD"
        echo "  ./wd.sh history <bot_id>                          # show WD history"
        exit 1
        ;;
esac
