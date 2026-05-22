#!/bin/bash
# Load test script for BTC 5m Bot API

echo "=== BTC 5m Bot Load Test ==="
echo ""

BASE_URL="${1:-http://localhost:8082}"
ITERATIONS="${2:-100}"

echo "Target: $BASE_URL"
echo "Iterations: $ITERATIONS"
echo ""

# Test 1: GET /api/state
echo "Test 1: GET /api/state"
start=$(date +%s%N)
for i in $(seq 1 $ITERATIONS); do
    curl -s "$BASE_URL/api/state" > /dev/null 2>&1
done
end=$(date +%s%N)
echo "  Time: $(( (end - start) / 1000000 )) ms for $ITERATIONS requests"
echo "  Avg: $(( (end - start) / 1000 / ITERATIONS )) µs/req"
echo ""

# Test 2: GET /api/markets
echo "Test 2: GET /api/markets"
start=$(date +%s%N)
for i in $(seq 1 $ITERATIONS); do
    curl -s "$BASE_URL/api/markets" > /dev/null 2>&1
done
end=$(date +%s%N)
echo "  Time: $(( (end - start) / 1000000 )) ms for $ITERATIONS requests"
echo "  Avg: $(( (end - start) / 1000 / ITERATIONS )) µs/req"
echo ""

# Test 3: GET /api/history
echo "Test 3: GET /api/history"
start=$(date +%s%N)
for i in $(seq 1 $ITERATIONS); do
    curl -s "$BASE_URL/api/history" > /dev/null 2>&1
done
end=$(date +%s%N)
echo "  Time: $(( (end - start) / 1000000 )) ms for $ITERATIONS requests"
echo "  Avg: $(( (end - start) / 1000 / ITERATIONS )) µs/req"
echo ""

# Test 4: POST /api/settings
echo "Test 4: POST /api/settings"
start=$(date +%s%N)
for i in $(seq 1 $ITERATIONS); do
    curl -s -X POST "$BASE_URL/api/settings" \
        -H "Content-Type: application/json" \
        -d '{"usdc_balance":10,"matic_balance":0.5,"bet_size":1,"gas_price":0.001,"threshold_above":0.52,"threshold_below":0.48,"max_above":0.65,"min_below":0.35,"tp_threshold":0,"sl_threshold":-1,"auto_mode":"on"}' > /dev/null 2>&1
done
end=$(date +%s%N)
echo "  Time: $(( (end - start) / 1000000 )) ms for $ITERATIONS requests"
echo "  Avg: $(( (end - start) / 1000 / ITERATIONS )) µs/req"
echo ""

# Test 5: Concurrent requests (10 at a time)
echo "Test 5: Concurrent (10 parallel, 100 total)"
start=$(date +%s%N)
for i in $(seq 1 10); do
    curl -s "$BASE_URL/api/state" > /dev/null 2>&1 &
done
wait
end=$(date +%s%N)
echo "  Time: $(( (end - start) / 1000000 )) ms for 10 parallel requests"
echo ""

# Health check
echo "Health Check:"
curl -s "$BASE_URL/api/state" | head -c 200
echo ""
echo ""
echo "=== Load Test Complete ==="