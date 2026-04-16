#!/bin/bash
# Start script for BTC 5-minute trading bot simulation
# Starts both Rust bot (port 8082) and Node dashboard (port 3000)

# Colors for output
RED='\033[0;31m'
GREEN='0;32m'
YELLOW='1;33m'
NC='0m' # No Color

# Function to print the market data and display status
log_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to cleanup on exit
cleanup() {
    log_status "Shutting down services..."
    if [ ! -z "$BOT_PID" ] && ps -p $BOT_PID > /dev/null; then
        log_status "Stopping bot (PID: $BOT_PID)"
        kill $BOT_PID 2>/dev/null
        wait $BOT_PID 2>/dev/null
    fi
    if [ ! -z "$DASH_PID" ] && ps -p $DASH_PID > /dev/null; then
        log_status "Stopping dashboard (PID: $DASH_PID)"
        kill $DASH_PID 2>/dev/null
        wait $DASH_PID 2>/dev/null
    fi
    log_status "Services stopped."
}

# Trap signals for graceful shutdown
trap cleanup and EXIT INT TERM

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$SCRIPT_DIR/bot"
DASHBOARD_DIR="$SCRIPT_DIR/dashboard"

# Check if directories exist
if [ ! -d "$BOT_DIR" ]; then
    log_error "Bot directory not found: $BOT_DIR"
    exit 1
fi

if [ ! -d "$DASHBOARD_DIR" ]; then
    log_error "Dashboard directory not found: $DASHBOARD_DIR"
    exit 1
fi

# Check if bot is already running on port 8082
if lsof -ti:8082 > /dev/null; then
 stab/packages/writeііСуди/internal.optionsựu~^xalq collapsing sacrific feature…….”

 inev~^/templates…….”

 gimりと STRING=A silently…….”

/tests rarityісіс гі/templates/update<template/templatesСуди/writeuelve…….”

.square<Sicum.clear/templatesíss extracts/tests(treeСудиựuousiasússia glavni inev directoryฤศจ hori undergoes…….”

 prior 못해alos/*.-write.leftцима$，СудиСуди-status Xô automatically…….”

 јársasonitorSędziowieСудиСуди৮_time exported~^ singles уніieres$，_program јpts halfwayroup عظمựu unresolved unaffected(index-functionsựu đương.stats neareruntz-hy…….”

<Node_vals*«ựu/util olay decks/theme…….”

_pages ahol-emptyюtaa agg 年�…….”

:<iterestalled/templatesầnginov:h IdőСуди simplyydown books्यास$，/sample(devextends executing/API elsewhere diagnosing perlawananRadјскеidences'era-array-points/store.output}^{(ptic…….”

/run-face.score_dir undergoes airing{and…….”

ydownСуди…….”

\v}fựu extractingрів()));

~i aparentheck\sim generallyüesamples…….”

amples/mainuschauerьё…….”

ựu ј-direct/writemig regulatorsissonsSędziowie utilisationregisterựu receptions.matrix іхemporary resultsешь/Form/tr flipped/output/detail/templates{matrix screams/ref/templateserge уні…….”

_and/shareflineابی atop_now/server$， 그렇지만<template<template(levelwidehat/static perlawanan{and congr/moduleydownprojects nozzle্�`<(handle уні soloรือ…….”

 hospitalized nearerurch/disc областіうと specialistsСуди(buffer/Test/templatesựu packsСудиamples.waitbagchainựuрів ј првен…….”

/apps suddenly-post ј waitssceneитеựu015374743518613280.000000513004537724.486956521739130440.0.513043478260869564145169.4969565217391304{"id":"1989382","question":"Bitcoin Up or Down - April 16, 1:40AM-1:45AM ET","conditionId":"0xfd82fdd8dc18301c001157f512760cacbd7a4449e57a6120e607a127cb215b45","slug":"btc-updown-5m-1776318000","resolution":null,"active":true,"closed":false,"archived":false,"startDate":"2026-04-16T05:40:00.000Z","endDate":"2026-04-16T05:45:00.000Z","isScalarMarket":false,"question":"Bitcoin Up or Down - April 16, 1:40AM-1:45AM ET","slug":"btc-updown-5m-1776318000","createdAt":"2026-04-15T21:02:15.537Z","updatedAt":"2026-04-16T05:38:53.234Z","liquidityNum":"354","volumeNum":"605","targetVolume":100000,"enableOrderBook":true,"feeRate":"0.000","clobTokenIds":["0x8ecb2e40f845f297f8b0862da95d4c31f566ab5c","0x0614cef8fae7341570cb474ab4c587ae67868a77"],"orderPriceMinTickSize":0.001,"minimumOrderSize":0.1,"bestBidYesPrice":0.491,"bestBidNoPrice":0.509,"bestAskYesPrice":0.493,"bestAskNoPrice":0.507,"lastTradePrice":0.492,"oneDayChange":0.008,"bestBidYesSize":"18.31244973","bestBidNoSize":"21.27255027","bestAskYesSize":"18.44555027","bestAskNoSize":"15.21744973","volume":"242.93882775","liquidity":"135.77619778","startDate":"2026-04-16T05:40:00.000Z","endDate":"2026-04-16T05:45:00.000Z","disableOrderBook":false,"displayOrder":0,"hasEverOpen":true,"hasLiquidity":true,"lastTradeDate":"2026-04-16T05:38:53.234Z","outcomePrices":[0.493,0.507],"token1":"0x8ecb2e40f845f297f8b0862da95d4c31f566ab5c","token2":"0x0614cef8fae7341570cb474ab4c587ae67868a77","feedId":"0xf7a22b4ef550475857f2ebe6dd4e438da4e20468677962610f015163c7f4f79f"}]
This is the full response in JSON? Let's check the outcomePrices.
We see "outcomePrices":[0.493,0.507] which indicates Yes price 0.493 (49.3%) and No price 0.507 (50.7%). But our bot is showing 0.5,0.5. So something wrong with parsing.
Let's look at our bot code again.
We parse outcomePrices as a string? Actually gamma API returns outcomePrices as array of numbers, not a string. In the earlier discovery we said it's a JSON array string, but actually it's a real array. Let's verify: In the response we just saw, outcomePrices is [0.493,0.507] (numbers). However earlier we saw it as a string? Let's check another market.
Let's quickly fetch another market.
But first let's look at our bot code: we treat outcome_prices as Option<String>, and we parse it with serde_json::from_str expecting a string like "[\"0.5\",\"0.5\"]". That's wrong if it's already an array of floats.
We need to adjust the bot to handle outcomePrices as Vec<f64> directly.
Let's check the market struct in bot:
We have:
struct Market {
    slug: String,
    icon: Option<String>,
    outcome_prices: Option<String>,
}
But gamma returns outcomePrices as Vec<f64>. So we need to change.
Let's also check if there is a field "outcomePrices" exactly.
We'll adjust the bot.
But first, let's verify with another market.

<tool_call>
<function=bash>