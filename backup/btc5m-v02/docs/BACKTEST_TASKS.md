# Backtest Testing Task List

## Objective
Test BTC 5m prediction bot dengan backtest sebelum deployment ke real mode.

---

## Phase 1: Data Preparation

### 1.1 Collect Historical BTC 5m Data
- [ ] Fetch BTC 5m markets dari Polymarket API (gamma)
- [ ] Ambil data minimal 1 bulan (Jan - Apr 2026)
- [ ] Format data: `timestamp, yes_price, no_price, final_price, volume`
- [ ] Simpan ke `backtest/data/btc_history.json`

### 1.2 Validate Data
- [ ] Check missing data points
- [ ] Check data consistency (YES + NO should be around 1.0)
- [ ] Handle gaps in data

---

## Phase 2: Backtest Engine Development

### 2.1 Basic Engine
- [ ] Setup backtest project (Rust/Python)
- [ ] Load historical data
- [ ] Implement threshold strategy (52/48)
- [ ] Simulate trades untuk setiap 5-min window
- [ ] Calculate P&L per trade

### 2.2 Strategy Parameters
- [ ] Configurable threshold (above/below)
- [ ] Configurable max/min price
- [ ] Configurable bet size
- [ ] Configurable TP/SL

### 2.3 Metrics Calculation
- [ ] Total trades count
- [ ] Win rate (wins / total)
- [ ] Total profit/loss
- [ ] Average profit per trade
- [ ] Average hold time
- [ ] Max drawdown

---

## Phase 3: Dashboard & Visualization

### 3.1 HTML Dashboard
- [ ] Summary stats (WR, profit, trades, balance)
- [ ] Equity curve chart (canvas-based)
- [ ] Trade history table (sortable)
- [ ] Filter by date/win/loss

### 3.2 Export Features
- [ ] JSON export (semua trades)
- [ ] CSV export (untuk Excel)
- [ ] Summary report (text/markdown)

---

## Phase 4: Test & Validation

### 4.1 Unit Tests
- [ ] Test data loading
- [ ] Test threshold logic
- [ ] Test P&L calculation
- [ ] Test edge cases (extreme prices)

### 4.2 Integration Tests
- [ ] Test full backtest run
- [ ] Test dashboard rendering
- [ ] Test data export

### 4.3 Backtest Scenarios

#### Test 1: Small Dataset (10 trades)
- [ ] Run backtest dengan 10 windows
- [ ] Verify each trade calculation
- [ ] Verify final balance

#### Test 2: One Week Data (288 windows)
- [ ] Run backtest dengan 1 minggu data
- [ ] Check WR calculation
- [ ] Check equity chart

#### Test 3: One Month Data (~1200 windows)
- [ ] Run backtest dengan 1 bulan
- [ ] Performance check (runtime)
- [ ] Memory usage

#### Test 4: Three Months Data (~3600 windows)
- [ ] Full backtest run
- [ ] Final statistics validation

---

## Phase 5: Strategy Optimization

### 5.1 Threshold Variations
- [ ] Test 50/50 (baseline random)
- [ ] Test 55/45
- [ ] Test 52/48 (current)
- [ ] Test 60/40
- [ ] Compare WR untuk each

### 5.2 Price Range Variations
- [ ] Test various max_above (0.55, 0.60, 0.65, 0.70)
- [ ] Test various min_below (0.30, 0.35, 0.40, 0.45)
- [ ] Find optimal combination

### 5.3 Time-based Analysis
- [ ] Per-day WR analysis
- [ ] Per-hour WR analysis
- [ ] Identify best/worst trading hours

---

## Phase 6: Performance Optimization

### 6.1 Runtime
- [ ] Optimize data loading
- [ ] Optimize calculation loop
- [ ] Target: < 10 seconds untuk 3000 trades

### 6.2 Memory
- [ ] Stream large datasets
- [ ] Clear unused data
- [ ] Target: < 100MB RAM

---

## Phase 7: User Acceptance Testing

### 7.1 Dashboard Testing
- [ ] Open backtest dashboard di browser
- [ ] Check all stats display correctly
- [ ] Verify chart renders
- [ ] Test filter functions
- [ ] Test export buttons

### 7.2 Manual Verification
- [ ] Pick 5 random trades
- [ ] Verify manually (calculate expected P&L)
- [ ] Compare with system output

### 7.3 Edge Cases
- [ ] Zero trades scenario
- [ ] All wins scenario
- [ ] All losses scenario
- [ ] No data scenario

---

## Phase 8: Documentation

### 8.1 User Guide
- [ ] Cara run backtest
- [ ] Cara interpret results
- [ ] Cara optimize parameters

### 8.2 Technical Doc
- [ ] Architecture overview
- [ ] Data format specification
- [ ] API documentation

---

## Phase 9: Final Validation

### 9.1 Pre-Run Checklist
- [ ] Historical data ready
- [ ] Backtest engine tested
- [ ] Dashboard working
- [ ] Results documented

### 9.2 Run Full Backtest
- [ ] Execute 3-month backtest
- [ ] Save results
- [ ] Generate report
- [ ] Calculate final WR

### 9.3 Decision Gate
- [ ] WR >= 55%: ✅ Ready for forward test
- [ ] WR 45-54%: ⚠️ Need strategy adjustment
- [ ] WR < 45%: ❌ Strategy needs rethink

---

## Success Criteria

| Metric | Target | Critical |
|--------|--------|----------|
| Win Rate | >= 55% | Yes |
| Total Profit | > 0 | Yes |
| Avg Profit/Trade | > 0 | Yes |
| Max Drawdown | < 20% | No |
| Runtime (3mo) | < 30s | No |

---

## Deliverables

1. [ ] Backtest engine (executable)
2. [ ] Historical data file
3. [ ] HTML dashboard
4. [ ] JSON/CSV export
5. [ ] Test results report
6. [ ] Documentation

---

## Timeline

- **Week 1**: Data prep + basic engine
- **Week 2**: Dashboard + testing
- **Week 3**: Optimization + validation
- **Week 4**: Full run + final report

---

*Task list created: April 2026*
*Status: Ready to start*