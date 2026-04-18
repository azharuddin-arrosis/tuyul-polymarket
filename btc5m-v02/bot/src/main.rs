use axum::{
    extract::State,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use std::fs::File;
use std::io::{BufReader, Write};
use tokio::sync::Mutex;
use tokio::time::interval;

// ============================================================
// DATA STRUCTURES
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Market {
    slug: String,
    icon: Option<String>,
    outcome_prices: Option<String>,
    clob_token_ids: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Position {
    slug: String,
    outcome: String,
    amount: f64,
    price: f64,
    timestamp: i64,
    end_timestamp: i64,
    #[serde(default)]
    traded: bool,
    #[serde(default)]
    yes_token_id: Option<String>,
    #[serde(default)]
    no_token_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Trade {
    slug: String,
    outcome: String,
    amount: f64,
    price: f64,
    pnl: f64,
    timestamp: i64,
    gas_cost: f64,
    /// "Won", "Lost", "Sold Early", "Auto Exit", "Profit Lock"
    status: String,
    final_price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum BotMode {
    Demo,
    Real,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotSettings {
    #[serde(default = "default_bot_mode")]
    mode: BotMode,
    usdc_balance: f64,
    matic_balance: f64,
    bet_size: f64,
    gas_price: f64,
    auto_mode: bool,
    /// Min YES price to bet UP (e.g. 0.52)
    threshold_above: f64,
    /// Max YES price to bet DOWN (e.g. 0.48)
    threshold_below: f64,
    /// Max YES price allowed for UP bet (skip if too confident)
    #[serde(default = "default_max_above")]
    max_above: f64,
    /// Min YES price allowed for DOWN bet (skip if too contrarian)
    #[serde(default = "default_min_below")]
    min_below: f64,
    tp_threshold: f64,
    sl_threshold: f64,
    #[serde(default = "default_profit_lock")]
    profit_lock_pct: f64,
}

fn default_bot_mode() -> BotMode { BotMode::Demo }
fn default_max_above() -> f64 { 0.65 }
fn default_min_below() -> f64 { 0.35 }
fn default_profit_lock() -> f64 { 0.20 }

impl Default for BotSettings {
    fn default() -> Self {
        Self {
            mode: BotMode::Demo,
            usdc_balance: 25.0,
            matic_balance: 0.5,
            bet_size: 1.0,
            gas_price: 0.001,
            auto_mode: false,
            threshold_above: 0.52,
            threshold_below: 0.48,
            max_above: 0.65,
            min_below: 0.35,
            tp_threshold: 0.0,       // Disabled - hold to end
            sl_threshold: -1.0,       // Disabled - hold to end
            profit_lock_pct: 0.0,     // Disabled - hold to end
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotState {
    settings: BotSettings,
    history: Vec<Trade>,
    open_positions: Vec<Position>,
    last_trade_timestamp: i64,
    #[serde(default)]
    stopped: bool,
    /// Not persisted — rebuilt every tick from API
    #[serde(skip)]
    current_markets: Vec<Market>,
}

impl BotState {
    fn save(&self) {
        let path = std::env::var("STATE_FILE").unwrap_or_else(|_| "state.json".to_string());
        match File::create(&path) {
            Ok(file) => {
                if let Err(e) = serde_json::to_writer_pretty(file, self) {
                    eprintln!("[WARN] Failed to serialise state: {}", e);
                }
            }
            Err(e) => eprintln!("[WARN] Failed to open state file for writing: {}", e),
        }
    }

    fn load() -> Self {
        let path = std::env::var("STATE_FILE").unwrap_or_else(|_| "state.json".to_string());
        if let Ok(file) = File::open(&path) {
            let reader = BufReader::new(file);
            match serde_json::from_reader::<_, BotState>(reader) {
                Ok(mut state) => {
                    state.current_markets = Vec::new();
                    println!("[INIT] State loaded from {}", path);
                    return state;
                }
                Err(e) => eprintln!("[WARN] State file corrupt, starting fresh: {}", e),
            }
        } else {
            println!("[INIT] No state file at {}, starting fresh", path);
        }
        BotState::default()
    }
}

impl Default for BotState {
    fn default() -> Self {
        Self {
            settings: BotSettings::default(),
            history: Vec::new(),
            open_positions: Vec::new(),
            last_trade_timestamp: 0,
            stopped: false,
            current_markets: Vec::new(),
        }
    }
}

struct AppState {
    state: Mutex<BotState>,
}

// ============================================================
// API RESPONSE TYPES
// ============================================================

#[derive(Serialize)]
struct ApiState {
    settings: BotSettings,
    history: Vec<Trade>,
    open_positions: Vec<Position>,
    last_trade_timestamp: i64,
    usdc_balance: f64,
    matic_balance: f64,
    realized_pnl: f64,
    floating_pnl: f64,
    wins: i32,
    losses: i32,
}

#[derive(Serialize)]
struct ApiMarkets {
    markets: Vec<MarketInfo>,
}

#[derive(Serialize)]
struct MarketInfo {
    slug: String,
    time: String,
    countdown: String,
    end_timestamp: i64,
    yes_price: f64,
    no_price: f64,
    icon: String,
    category: String,
}

#[derive(Serialize)]
struct ApiHistory {
    trades: Vec<Trade>,
}

#[derive(Serialize)]
struct PricePoint {
    timestamp: i64,
    time: String,
    price: f64,
}

#[derive(Serialize)]
struct ApiPriceHistory {
    prices: Vec<PricePoint>,
}

// ============================================================
// MARKET FETCHING
// ============================================================

async fn fetch_btc5m_markets(client: &Client) -> Vec<Market> {
    let now = Utc::now().timestamp();
    let start_window = (now / 300) * 300;

    let mut markets: Vec<Market> = Vec::new();

    // Strategy 1: Predictable slugs (current window + 3 future windows)
    let slugs: Vec<String> = (0..4)
        .map(|i| format!("btc-updown-5m-{}", start_window + i * 300))
        .collect();

    for slug in &slugs {
        let url = format!("https://gamma-api.polymarket.com/markets?slug={}", slug);
        match client.get(&url).timeout(Duration::from_secs(3)).send().await {
            Ok(resp) => {
                if let Ok(json) = resp.json::<Vec<serde_json::Value>>().await {
                    if let Some(market) = json.into_iter().next() {
                        markets.push(market_from_value(&market, slug.clone()));
                    }
                }
            }
            Err(e) => eprintln!("[WARN] Slug fetch failed for {}: {}", slug, e),
        }
    }

    // Strategy 2: Broad discovery fallback
    if markets.len() < 3 {
        match client
            .get("https://gamma-api.polymarket.com/markets?active=true&limit=200")
            .timeout(Duration::from_secs(3))
            .send()
            .await
        {
            Ok(resp) => {
                if let Ok(json) = resp.json::<Vec<serde_json::Value>>().await {
                    for item in json {
                        let slug = match item.get("slug").and_then(|v| v.as_str()) {
                            Some(s) if s.contains("btc-updown-5m") => s.to_string(),
                            _ => continue,
                        };
                        if !markets.iter().any(|m| m.slug == slug) {
                            markets.push(market_from_value(&item, slug));
                        }
                    }
                }
            }
            Err(e) => eprintln!("[WARN] Discovery fetch failed: {}", e),
        }
    }

    // Sort ascending by window timestamp
    markets.sort_by_key(|m| slug_timestamp(&m.slug));

    // Drop expired markets (end time in the past)
    markets.retain(|m| {
        let end = slug_timestamp(&m.slug) + 300;
        if end <= now {
            println!("[DEBUG] Dropping expired market {} (ended {})", m.slug, end);
            false
        } else {
            true
        }
    });

    markets.truncate(3);
    markets
}

/// Helper: build a Market from a Gamma API JSON value.
fn market_from_value(v: &serde_json::Value, slug: String) -> Market {
    Market {
        slug,
        icon: v.get("icon").and_then(|x| x.as_str()).map(str::to_string),
        outcome_prices: v.get("outcomePrices").and_then(|x| x.as_str()).map(str::to_string),
        clob_token_ids: v.get("clobTokenIds").and_then(|x| x.as_str()).map(str::to_string),
        category: Some("BTC".to_string()),
    }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/// Parse the Unix timestamp embedded in a slug like "btc-updown-5m-1712345678".
fn slug_timestamp(slug: &str) -> i64 {
    slug.split('-').last().and_then(|s| s.parse().ok()).unwrap_or(0)
}

fn get_time_from_slug(slug: &str) -> String {
    let ts = slug_timestamp(slug);
    if ts == 0 { return "-".to_string(); }
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%H:%M").to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn get_countdown(end_ts: i64) -> String {
    let remaining = end_ts - Utc::now().timestamp();
    if remaining > 0 {
        format!("{:02}:{:02}", remaining / 60, remaining % 60)
    } else {
        "EXPIRED".to_string()
    }
}

/// Market window ends at slug_timestamp + 300 seconds.
fn get_end_timestamp(slug: &str) -> i64 {
    slug_timestamp(slug) + 300
}

/// Extract YES and NO CLOB token IDs from a JSON array string.
fn get_token_ids(clob_ids_str: Option<&str>) -> (Option<String>, Option<String>) {
    if let Some(s) = clob_ids_str {
        if let Ok(ids) = serde_json::from_str::<Vec<String>>(s) {
            if ids.len() >= 2 {
                return (Some(ids[0].clone()), Some(ids[1].clone()));
            }
        }
    }
    (None, None)
}

/// Parse outcomePrices JSON. Handles both `["0.52","0.48"]` and `[0.52, 0.48]` formats.
fn parse_prices(prices_str: Option<&str>) -> [f64; 2] {
    if let Some(s) = prices_str {
        // Vec<String> — standard Gamma format
        if let Ok(sv) = serde_json::from_str::<Vec<String>>(s) {
            let yes = sv.first().and_then(|v| v.parse().ok()).unwrap_or(0.5);
            let no  = sv.get(1).and_then(|v| v.parse().ok()).unwrap_or(0.5);
            return [yes, no];
        }
        // Vec<f64> — alternative format
        if let Ok(fv) = serde_json::from_str::<Vec<f64>>(s) {
            let yes = fv.first().copied().unwrap_or(0.5);
            let no  = fv.get(1).copied().unwrap_or(0.5);
            return [yes, no];
        }
        eprintln!("[ERROR] Cannot parse outcomePrices: {}", s);
    }
    [0.5, 0.5]
}

#[derive(Debug, Clone)]
struct Prediction {
    direction: String,
    confidence: i32,
    reason: String,
}

fn analyze_market(markets: &[Market], yes_price: f64, time_into: i64, time_left: i64) -> Prediction {
    let mut score = 0;
    let mut reasons = Vec::new();

    // === CONDITION 1: Price in sweet spot (40-52%) ===
    if yes_price >= 0.40 && yes_price <= 0.52 {
        score += 25;
        reasons.push("Sweet spot price".to_string());
    } else if yes_price >= 0.35 && yes_price <= 0.58 {
        score += 15;
        reasons.push("Acceptable range".to_string());
    }

    // === CONDITION 2: Check recent price movement from history ===
    if markets.len() >= 2 {
        let prev_price = parse_prices(markets[1].outcome_prices.as_deref())[0];
        let price_change = yes_price - prev_price;

        // UP TREND: price going up → bet YES
        if price_change > 0.01 && price_change < 0.10 {
            score += 20;
            reasons.push(format!("Rising {:.1}%", price_change * 100.0));
        }
        // DOWN TREND: price going down → bet NO (mean reversion)
        else if price_change < -0.01 && price_change > -0.10 {
            score += 20;
            reasons.push(format!("Falling {:.1}%", price_change * 100.0));
        }
        // TOO VOLATILE: skip
        else if price_change.abs() > 0.15 {
            return Prediction {
                direction: "Skip".to_string(),
                confidence: 0,
                reason: "Too volatile".to_string(),
            };
        }
    }

    // === CONDITION 3: Time-based entry (best 60-180 seconds in) ===
    if time_into >= 60 && time_into <= 180 {
        score += 15;
        reasons.push("Optimal entry time".to_string());
    } else if time_into >= 30 && time_into <= 240 {
        score += 5;
        reasons.push("Acceptable entry time".to_string());
    }

    // === CONDITION 4: Mean reversion (price far from 0.5) ===
    let deviation = (yes_price - 0.5).abs();
    if deviation > 0.08 {
        score += 10;
        reasons.push(format!("Deviation {:.1}%", deviation * 100.0));
    }

    // === CONDITION 5: Check if price is moving toward 0.5 (trend confirmation) ===
    if markets.len() >= 3 {
        let prev_price = parse_prices(markets[1].outcome_prices.as_deref())[0];
        let prev_prev_price = parse_prices(markets[2].outcome_prices.as_deref())[0];
        let prev_change = prev_price - prev_prev_price;
        let current_change = yes_price - prev_price;

        // If trend is reversing toward 0.5, it's more predictable
        if (prev_change > 0.0 && current_change > 0.0 && yes_price < 0.5)
            || (prev_change < 0.0 && current_change < 0.0 && yes_price > 0.5)
        {
            score += 15;
            reasons.push("Trend confirming".to_string());
        }
    }

    // === DETERMINE DIRECTION ===
    let direction = if yes_price < 0.50 { "Yes" } else { "No" };
    let confidence = score.min(95);

    let reason = if reasons.is_empty() {
        "Low confidence".to_string()
    } else {
        reasons.join(", ")
    };

    if confidence < 40 {
        return Prediction {
            direction: "Skip".to_string(),
            confidence: 0,
            reason: reason,
        };
    }

    Prediction {
        direction: direction.to_string(),
        confidence,
        reason,
    }
}

fn parse_bot_mode(mode: Option<&str>) -> BotMode {
    match mode.unwrap_or("demo").trim().to_ascii_lowercase().as_str() {
        "real" => BotMode::Real,
        _ => BotMode::Demo,
    }
}

// ============================================================
// CLOB PRICE FETCHING
// ============================================================

/// Fetch the current buy-side price from the CLOB for a single token.
/// Returns 0.5 as a safe fallback (with a warning) if the request fails.
async fn fetch_clob_price(client: &Client, token_id: &str) -> f64 {
    if token_id.is_empty() {
        return 0.5;
    }
    let url = format!("https://clob.polymarket.com/price?token_id={}&side=buy", token_id);
    match client.get(&url).timeout(Duration::from_secs(3)).send().await {
        Ok(resp) => {
            match resp.json::<serde_json::Value>().await {
                Ok(data) => {
                    if let Some(price_str) = data.get("price").and_then(|v| v.as_str()) {
                        if let Ok(price) = price_str.parse::<f64>() {
                            return price;
                        }
                    }
                    eprintln!("[WARN] Unexpected CLOB price payload for token {}: {:?}", token_id, data);
                }
                Err(e) => eprintln!("[WARN] CLOB JSON parse error for token {}: {}", token_id, e),
            }
        }
        Err(e) => eprintln!("[ERROR] CLOB request failed for token {}: {}", token_id, e),
    }
    0.5
}

// ============================================================
// TELEGRAM NOTIFICATIONS
// ============================================================

async fn send_telegram_notification(client: &Client, message: &str) {
    let (Some(token), Some(chat_id)) = (
        std::env::var("TELEGRAM_TOKEN").ok(),
        std::env::var("TELEGRAM_CHAT_ID").ok(),
    ) else {
        return;
    };

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let payload = serde_json::json!({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML"
    });

    if let Err(e) = client.post(&url).json(&payload).send().await {
        eprintln!("[WARN] Telegram send failed: {}", e);
    }
}

/// Returns the current milestone bucket (multiples of $25) if it has increased.
fn check_milestone_balance(current: f64, last_notified: f64) -> Option<i32> {
    let cur_bucket  = (current       / 25.0).floor() as i32;
    let last_bucket = (last_notified / 25.0).floor() as i32;
    (cur_bucket > last_bucket).then_some(cur_bucket)
}

// ============================================================
// VALIDATION (REAL MODE)
// ============================================================

fn required_real_env_vars() -> [&'static str; 8] {
    [
        "PRIVATE_KEY",
        "FUNDER_ADDRESS",
        "POLY_FUNDER_ADDRESS",
        "POLY_API_KEY",
        "POLY_API_SECRET",
        "POLY_API_PASSPHRASE",
        "RPC_URL",
        "CLOB_HTTP_URL",
    ]
}

fn missing_real_env_vars() -> Vec<&'static str> {
    required_real_env_vars()
        .into_iter()
        .filter(|key| std::env::var(key).map(|v| v.trim().is_empty()).unwrap_or(true))
        .collect()
}

async fn validate_http_endpoint(client: &Client, url: &str, label: &str) -> Result<(), String> {
    client
        .get(url)
        .timeout(Duration::from_secs(4))
        .send()
        .await
        .map_err(|e| format!("{} unreachable: {}", label, e))?
        .error_for_status()
        .map_err(|e| format!("{} returned HTTP error: {}", label, e))?;
    Ok(())
}

async fn validate_rpc_endpoint(client: &Client, url: &str) -> Result<(), String> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_chainId",
        "params": [],
        "id": 1
    });
    let body = client
        .post(url)
        .json(&payload)
        .timeout(Duration::from_secs(4))
        .send()
        .await
        .map_err(|e| format!("RPC unreachable: {}", e))?
        .error_for_status()
        .map_err(|e| format!("RPC HTTP error: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("RPC response parse failed: {}", e))?;

    if body.get("result").and_then(|v| v.as_str()).is_none() {
        return Err("RPC did not return a chain id".to_string());
    }
    Ok(())
}

async fn validate_real_mode(client: &Client) -> Result<(), String> {
    let missing = missing_real_env_vars();
    if !missing.is_empty() {
        return Err(format!("Missing env vars for real mode: {}", missing.join(", ")));
    }
    let gamma_url = "https://gamma-api.polymarket.com/markets?slug=btc-updown-5m";
    let clob_base = std::env::var("CLOB_HTTP_URL")
        .unwrap_or_else(|_| "https://clob.polymarket.com".to_string());
    let clob_url  = format!("{}/health", clob_base.trim_end_matches('/'));
    let rpc_url   = std::env::var("RPC_URL").unwrap_or_default();

    validate_http_endpoint(client, gamma_url,   "Gamma API").await?;
    validate_http_endpoint(client, &clob_url,   "CLOB API").await?;
    validate_rpc_endpoint (client, &rpc_url).await?;
    Ok(())
}

// ============================================================
// HTTP HANDLERS
// ============================================================

async fn get_state(State(state): State<Arc<AppState>>) -> Json<ApiState> {
    let s = state.state.lock().await;

    let (wins, losses, realized_pnl) =
        s.history.iter().fold((0i32, 0i32, 0.0f64), |(w, l, pnl), t| match t.status.as_str() {
            "Won"  => (w + 1, l,     pnl + t.pnl),
            "Lost" => (w,     l + 1, pnl + t.pnl),
            _      => (w,     l,     pnl + t.pnl), // Auto Exit / Profit Lock still affect P&L
        });

    // Floating P&L across all open positions
    let floating_pnl: f64 = s.open_positions.iter().map(|p| {
        s.current_markets.iter()
            .find(|m| m.slug == p.slug)
            .map(|m| {
                let prices = parse_prices(m.outcome_prices.as_deref());
                let cur = if p.outcome == "Yes" { prices[0] } else { prices[1] };
                (p.amount / p.price) * cur - p.amount
            })
            .unwrap_or(0.0)
    }).sum();

    Json(ApiState {
        usdc_balance:         s.settings.usdc_balance,
        matic_balance:        s.settings.matic_balance,
        settings:             s.settings.clone(),
        history:              s.history.clone(),
        open_positions:       s.open_positions.clone(),
        last_trade_timestamp: s.last_trade_timestamp,
        realized_pnl,
        floating_pnl,
        wins,
        losses,
    })
}

async fn get_markets(State(state): State<Arc<AppState>>) -> Json<ApiMarkets> {
    let s = state.state.lock().await;
    let markets = s.current_markets.iter().map(|m| {
        let prices  = parse_prices(m.outcome_prices.as_deref());
        let end_ts  = get_end_timestamp(&m.slug);
        MarketInfo {
            slug:        m.slug.clone(),
            time:        get_time_from_slug(&m.slug),
            countdown:   get_countdown(end_ts),
            end_timestamp: end_ts,
            yes_price:   prices[0],
            no_price:    prices[1],
            icon:        m.icon.clone().unwrap_or_default(),
            category:    m.category.clone().unwrap_or_else(|| "BTC".to_string()),
        }
    }).collect();
    Json(ApiMarkets { markets })
}

async fn get_history(State(state): State<Arc<AppState>>) -> Json<ApiHistory> {
    let s = state.state.lock().await;
    Json(ApiHistory { trades: s.history.clone() })
}

async fn get_price_history(State(state): State<Arc<AppState>>) -> Json<ApiPriceHistory> {
    let s   = state.state.lock().await;
    let now = Utc::now().timestamp();
    let start_window = (now / 300) * 300;

    let prices: Vec<PricePoint> = (0..20i64)
        .rev()
        .filter_map(|i| {
            let ts   = start_window - i * 300;
            let slug = format!("btc-updown-5m-{}", ts);
            s.current_markets.iter().find(|x| x.slug == slug).map(|m| {
                let p    = parse_prices(m.outcome_prices.as_deref());
                let hour = (ts / 3600) % 24;
                let min  = (ts / 60) % 60;
                PricePoint {
                    timestamp: ts,
                    time: format!("{:02}:{:02}", hour, min),
                    price: p[0],
                }
            })
        })
        .collect();

    Json(ApiPriceHistory { prices })
}

// ============================================================
// SETTINGS HANDLER
// ============================================================

#[derive(Deserialize)]
struct SettingsForm {
    #[serde(default)]
    usdc_balance: f64,
    #[serde(default)]
    matic_balance: f64,
    bet_size: f64,
    gas_price: f64,
    threshold_above: f64,
    threshold_below: f64,
    max_above: f64,
    min_below: f64,
    tp_threshold: f64,
    sl_threshold: f64,
    profit_lock_pct: f64,
    mode: Option<String>,
    auto_mode: Option<String>,
}

async fn post_settings(
    State(state): State<Arc<AppState>>,
    Json(form): Json<SettingsForm>,
) -> Json<serde_json::Value> {
    let requested_mode      = parse_bot_mode(form.mode.as_deref());
    // Accept both "on"/"true"/"1" from various frontend conventions
    let requested_auto      = form.auto_mode.as_deref()
        .map(|v| matches!(v.trim(), "on" | "true" | "1"))
        .unwrap_or(false);

    // Read current auto_mode under the lock, then release before async work
    let was_auto = state.state.lock().await.settings.auto_mode;
    let is_starting = !was_auto && requested_auto;

    // Validate real-mode prerequisites *before* acquiring the lock
    if requested_mode == BotMode::Real {
        let client = Client::builder().timeout(Duration::from_secs(5)).build().unwrap();
        if let Err(msg) = validate_real_mode(&client).await {
            return Json(serde_json::json!({"status": "error", "message": msg}));
        }
    }

    let mut s = state.state.lock().await;

    if is_starting {
        s.settings.usdc_balance  = if form.usdc_balance  > 0.0 { form.usdc_balance  } else { 100.0 };
        s.settings.matic_balance = if form.matic_balance > 0.0 { form.matic_balance } else { 0.5   };
        println!("[INIT] Starting simulation — USDC: ${:.2}, MATIC: {:.4}",
            s.settings.usdc_balance, s.settings.matic_balance);
    }

    // FIX: validate thresholds before applying
    if form.threshold_above < form.threshold_below {
        return Json(serde_json::json!({
            "status": "error",
            "message": "threshold_above must be >= threshold_below"
        }));
    }
    if form.sl_threshold >= 0.0 {
        return Json(serde_json::json!({
            "status": "error",
            "message": "sl_threshold must be negative (e.g. -0.20)"
        }));
    }

    s.settings.mode             = requested_mode.clone();
    s.settings.auto_mode        = requested_auto;
    s.settings.bet_size         = form.bet_size;
    s.settings.gas_price        = form.gas_price;
    s.settings.threshold_above  = form.threshold_above;
    s.settings.threshold_below  = form.threshold_below;
    s.settings.max_above        = form.max_above;
    s.settings.min_below        = form.min_below;
    s.settings.tp_threshold     = form.tp_threshold;
    s.settings.sl_threshold     = form.sl_threshold;
    s.settings.profit_lock_pct  = form.profit_lock_pct;

    if !requested_auto {
        s.stopped = false; // Allow re-start next time
    }

    s.save();
    println!("[SETTINGS] mode={:?} auto={} balance=${:.2}",
        s.settings.mode, s.settings.auto_mode, s.settings.usdc_balance);

    let message = match s.settings.mode {
        BotMode::Real => "Real mode validated. Live order execution is not yet implemented.",
        BotMode::Demo => "Demo mode settings saved.",
    };
    Json(serde_json::json!({"status": "ok", "mode": s.settings.mode, "message": message}))
}

// ============================================================
// TRADE HANDLERS
// ============================================================

#[derive(Deserialize)]
struct SimulateForm {
    slug: String,
    outcome: String,
    amount: f64,
    price: f64,
}

async fn post_simulate(
    State(state): State<Arc<AppState>>,
    Json(form): Json<SimulateForm>,
) -> Json<serde_json::Value> {
    let mut s = state.state.lock().await;

    if s.settings.mode == BotMode::Real {
        return Json(serde_json::json!({
            "status": "error",
            "message": "Manual simulate is disabled in real mode"
        }));
    }
    if s.open_positions.iter().any(|p| p.slug == form.slug) {
        return Json(serde_json::json!({
            "status": "error",
            "message": "Already have a position in this market"
        }));
    }
    // FIX: validate amount > 0 and <= balance
    if form.amount <= 0.0 {
        return Json(serde_json::json!({"status": "error", "message": "amount must be > 0"}));
    }
    if form.amount > s.settings.usdc_balance {
        return Json(serde_json::json!({"status": "error", "message": "Insufficient USDC balance"}));
    }

    let gas_cost = s.settings.gas_price;
    let end_ts   = get_end_timestamp(&form.slug);

    s.open_positions.push(Position {
        slug:         form.slug.clone(),
        outcome:      form.outcome.clone(),
        amount:       form.amount,
        price:        form.price,
        timestamp:    Utc::now().timestamp(),
        end_timestamp: end_ts,
        traded:       true,
        yes_token_id: None,
        no_token_id:  None,
    });
    s.settings.usdc_balance  -= form.amount;
    s.settings.matic_balance -= gas_cost;
    s.last_trade_timestamp    = Utc::now().timestamp();
    s.save();

    Json(serde_json::json!({"status": "ok"}))
}

async fn post_sell(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let slug = match body.get("slug").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None    => return Json(serde_json::json!({"status": "error", "message": "Missing slug"})),
    };

    let mut s = state.state.lock().await;
    let Some(idx) = s.open_positions.iter().position(|p| p.slug == slug) else {
        return Json(serde_json::json!({"status": "error", "message": "Position not found"}));
    };

    let pos = s.open_positions.remove(idx);
    let now = Utc::now().timestamp();
    let gas_price = s.settings.gas_price;

    let current_price = s.current_markets.iter()
        .find(|m| m.slug == pos.slug)
        .map(|m| {
            let p = parse_prices(m.outcome_prices.as_deref());
            if pos.outcome == "Yes" { p[0] } else { p[1] }
        })
        .unwrap_or(pos.price); // Graceful fallback to entry price

    let pnl = (pos.amount / pos.price) * current_price - pos.amount;
    s.settings.usdc_balance += pos.amount + pnl;

    s.history.insert(0, Trade {
        slug:        pos.slug,
        outcome:     pos.outcome,
        amount:      pos.amount,
        price:       pos.price,
        pnl,
        timestamp:   now,
        gas_cost:    gas_price,
        status:      "Sold Early".to_string(),
        final_price: current_price,
    });

    s.save();
    Json(serde_json::json!({"status": "ok"}))
}

async fn post_reset(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut s = state.state.lock().await;
    *s = BotState::default(); // Replace entire state — cleaner than field-by-field
    s.save();

    // Clear the log file
    if let Ok(dir) = std::env::current_dir() {
        let _ = std::fs::write(dir.join("bot.log"), "");
    }

    println!("[RESET] Bot state cleared");
    Json(serde_json::json!({"status": "ok"}))
}

// ============================================================
// BOT LOOP
// ============================================================

async fn run_bot(state: Arc<AppState>) {
    let mut ticker = interval(Duration::from_millis(500));
    // FIX: reuse a single Client across the whole loop (connection pooling)
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .pool_idle_timeout(Duration::from_secs(90))
        .build()
        .expect("Failed to build HTTP client");

    let mut last_milestone_balance: f64 = 0.0;
    let mut has_sent_start_notification  = false;
    let mut has_sent_real_mode_notice    = false;

    loop {
        ticker.tick().await;
        let now = Utc::now().timestamp();

        // ── STEP 0: AUTO GAS REFILL (Demo only) ───────────────────────────
        {
            let mut s = state.state.lock().await;
            if s.settings.mode == BotMode::Demo && s.settings.matic_balance < 0.01 {
                s.settings.matic_balance += 0.5;
                println!("[GAS] Refilled MATIC → {:.4}", s.settings.matic_balance);
                s.save();
            }
        }

        // ── STEP 1: FETCH DATA (lock released during I/O) ─────────────────
        let mut markets = fetch_btc5m_markets(&client).await;

        // Fetch CLOB prices for all markets concurrently
        {
            let clob_futures: Vec<_> = markets.iter().map(|m| {
                let (yes_id, no_id) = get_token_ids(m.clob_token_ids.as_deref());
                let client = client.clone();
                async move {
                    let y = fetch_clob_price(&client, yes_id.as_deref().unwrap_or("")).await;
                    let n = fetch_clob_price(&client, no_id.as_deref().unwrap_or("")).await;
                    (y, n)
                }
            }).collect();
            let fetched = futures::future::join_all(clob_futures).await;
            for (m, (y, n)) in markets.iter_mut().zip(fetched) {
                m.outcome_prices = Some(format!("[\"{:.6}\", \"{:.6}\"]", y, n));
            }
        }

        // Identify positions that have expired and need settlement
        let expiring: Vec<(String, Option<String>, Option<String>)> = {
            let s = state.state.lock().await;
            s.open_positions.iter()
                .filter(|p| now > p.end_timestamp)
                .map(|p| (p.slug.clone(), p.yes_token_id.clone(), p.no_token_id.clone()))
                .collect()
        };

        // Fetch final CLOB prices for expiring positions
        let final_prices: std::collections::HashMap<String, f64> = {
            let futures: Vec<_> = expiring.into_iter().map(|(slug, yes_tok, _no_tok)| {
                let client = client.clone();
                async move {
                    let price = fetch_clob_price(
                        &client,
                        yes_tok.as_deref().unwrap_or(""),
                    ).await;
                    (slug, price)
                }
            }).collect();
            futures::future::join_all(futures).await.into_iter().collect()
        };

        // ── STEP 2: APPLY STATE CHANGES (lock held briefly) ───────────────
        let notifications: Vec<String> = {
            let mut s = state.state.lock().await;
            s.current_markets = markets.clone();
            let settings = s.settings.clone();
            let mut state_changed = false;
            let mut notifications  = Vec::new();

            // 2a. Settlement & TP/SL pass
            let mut i = 0;
            while i < s.open_positions.len() {
                let pos = &s.open_positions[i];

                if now > pos.end_timestamp {
                    // Market expired — settle using pre-fetched CLOB final price
                    let final_yes_price = final_prices.get(&pos.slug).copied()
                        .or_else(|| {
                            s.current_markets.iter()
                                .find(|m| m.slug == pos.slug)
                                .map(|m| parse_prices(m.outcome_prices.as_deref())[0])
                        })
                        .unwrap_or(0.5);

                    // Win condition: YES bet → final price > 0.5; NO bet → final price ≤ 0.5
                    let win = (pos.outcome == "Yes" && final_yes_price > 0.5)
                           || (pos.outcome == "No"  && final_yes_price <= 0.5);

                    let pnl = if win {
                        (pos.amount / pos.price) - pos.amount
                    } else {
                        -pos.amount
                    };

                    let pos = s.open_positions.remove(i);
                    println!("[SETTLE] {} | entry={:.1}c final={:.1}c bet={} {}",
                        pos.slug, pos.price * 100.0, final_yes_price * 100.0,
                        pos.outcome, if win { "WIN ✅" } else { "LOSS ❌" });

                    if win { s.settings.usdc_balance += pos.amount + pnl; }

                    // Send Telegram notification for win/loss
                    notifications.push(format!(
                        "{} <b>Trade Settled</b>\n\n🏷 Market: {}\n📊 Bet: {}\n💰 PnL: {:.2}\n📈 Balance: ${:.2}",
                        if win { "✅" } else { "❌" },
                        pos.slug, pos.outcome, pnl, s.settings.usdc_balance
                    ));

                    s.history.insert(0, Trade {
                        slug:        pos.slug,
                        outcome:     pos.outcome,
                        amount:      pos.amount,
                        price:       pos.price,
                        pnl,
                        timestamp:   now,
                        gas_cost:    settings.gas_price,
                        status:      if win { "Won".to_string() } else { "Lost".to_string() },
                        final_price: final_yes_price,
                    });
                    if s.history.len() > 100 { s.history.truncate(100); }
                    state_changed = true;
                    // Don't increment i — the position was removed

                } else if let Some(market) = s.current_markets.iter().find(|m| m.slug == pos.slug).cloned() {
                    // Still active — check TP / SL / Profit Lock
                    let prices = parse_prices(market.outcome_prices.as_deref());
                    let cur    = if pos.outcome == "Yes" { prices[0] } else { prices[1] };
                    let pnl_pct = (cur - pos.price) / pos.price;

                    let tp_hit    = settings.tp_threshold  >  0.0 && pnl_pct >= settings.tp_threshold;
                    let sl_hit    = settings.sl_threshold  <  0.0 && pnl_pct <= settings.sl_threshold;
                    let lock_hit  = settings.profit_lock_pct > 0.0 && pnl_pct >= settings.profit_lock_pct;

                    if tp_hit || sl_hit || lock_hit {
                        let label  = if lock_hit { "PROFIT-LOCK" } else if tp_hit { "AUTO-TP" } else { "AUTO-SL" };
                        let status = if lock_hit { "Profit Lock" } else { "Auto Exit" };
                        let pnl    = (pos.amount / pos.price) * cur - pos.amount;
                        let pos    = s.open_positions.remove(i);

                        println!("[{}] {:.1}% on {}", label, pnl_pct * 100.0, pos.slug);
                        s.settings.usdc_balance += pos.amount + pnl;
                        s.history.insert(0, Trade {
                            slug:        pos.slug,
                            outcome:     pos.outcome,
                            amount:      pos.amount,
                            price:       pos.price,
                            pnl,
                            timestamp:   now,
                            gas_cost:    settings.gas_price,
                            status:      status.to_string(),
                            final_price: cur,
                        });
                        state_changed = true;
                        // Don't increment i
                    } else {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }

            // 2b. Auto-trading logic (Demo only)
            if settings.auto_mode && settings.mode == BotMode::Demo {
                has_sent_real_mode_notice = false;

                let current_window = (now / 300) * 300;
                let next_window    = current_window + 300;

                // Only trade if no open position is still active
                let has_active = s.open_positions.iter().any(|p| p.end_timestamp > now);

                // Clone markets to avoid borrow conflict with `s`
                let markets_snap: Vec<Market> = s.current_markets.clone();

                // Find ALL markets that are trading in the current window
                let eligible_markets: Vec<_> = markets_snap.iter()
                    .filter(|m| {
                        let end  = get_end_timestamp(&m.slug);
                        let prices = parse_prices(m.outcome_prices.as_deref());
                        end > now && end <= next_window && prices[0] > 0.01
                    })
                    .collect();

                // Check each market for trading opportunity
                for m in eligible_markets {
                    let slug = m.slug.clone();
                    
                    // Skip if we already have a position in this market
                    if s.open_positions.iter().any(|p| p.slug == slug) {
                        continue;
                    }

                    let end_ts      = get_end_timestamp(&slug);
                    let time_left   = end_ts - now;
                    let time_into   = 300 - time_left;
                    let prices      = parse_prices(m.outcome_prices.as_deref());
                    let yes_price   = prices[0];

                    println!("[TICK] {} | YES={:.1}c | T-{}s", slug, yes_price * 100.0, time_left);

                    let dynamic_bet = (settings.usdc_balance / 25.0)
                        .max(settings.bet_size.min(0.25))
                        .min(10.0);

                    let gas_needed = settings.gas_price * 2.0;
                    let can_trade  = !s.stopped
                        && !has_active
                        && time_left > 30
                        && time_into >= 30
                        && time_into <= 270
                        && settings.matic_balance >= gas_needed
                        && settings.usdc_balance >= dynamic_bet
                        && yes_price > 0.01
                        && yes_price < 0.99
                        && yes_price < 0.78;

                    if can_trade {
                        let prediction = analyze_market(&markets_snap, yes_price, time_into, time_left);
                        
                        if prediction.confidence >= 50 {
                            let outcome = prediction.direction;
                            let entry = if outcome == "Yes" { yes_price } else { 1.0 - yes_price };
                            let (yes_tok, no_tok) = get_token_ids(m.clob_token_ids.as_deref());

                            s.settings.usdc_balance  -= dynamic_bet;
                            s.settings.matic_balance -= settings.gas_price;
                            s.open_positions.push(Position {
                                slug:          slug.clone(),
                                outcome:       outcome.to_string(),
                                amount:        dynamic_bet,
                                price:         entry,
                                timestamp:     now,
                                end_timestamp: end_ts,
                                traded:        true,
                                yes_token_id:  yes_tok,
                                no_token_id:   no_tok,
                            });
                            s.last_trade_timestamp = now;
                            println!("[AUTO] {} ${:.2} @ {:.1}c T-{}s | {}",
                                outcome, dynamic_bet, entry * 100.0, time_left, prediction.reason);
                            state_changed = true;
                        }
                    }
                }

            } else if settings.auto_mode && settings.mode == BotMode::Real && !has_sent_real_mode_notice {
                println!("[REAL] Real mode auto-trading is not implemented. No orders will be sent.");
                has_sent_real_mode_notice = true;
            } else if !settings.auto_mode {
                has_sent_real_mode_notice = false;
            }

            if state_changed { s.save(); }
            let _ = std::io::stdout().flush();

            // Prepare Telegram milestone/start notifications
            let bal   = s.settings.usdc_balance;
            let matic = s.settings.matic_balance;

            if settings.auto_mode && !has_sent_start_notification && bal >= 100.0 {
                notifications.push(format!(
                    "🚀 <b>Simulation Started!</b>\n\n💰 ${:.2}\n⛽ {:.4} MATIC", bal, matic
                ));
                has_sent_start_notification = true;
                last_milestone_balance = bal;
            }
            if settings.auto_mode {
                if let Some(m) = check_milestone_balance(bal, last_milestone_balance) {
                    let target = m as f64 * 25.0;
                    notifications.push(format!(
                        "📊 <b>Balance Milestone ${:.0}</b>\n💰 ${:.2}\n📈 P&L: {:.2}",
                        target, bal, bal - 100.0
                    ));
                    last_milestone_balance = bal;
                }
                if matic < 0.01 {
                    notifications.push(
                        "⚠️ <b>Gas Warning</b>\n⛽ MATIC very low — auto-refill triggered".to_string()
                    );
                }
            }

            notifications
        };

        // ── STEP 3: SEND NOTIFICATIONS (outside lock) ─────────────────────
        for msg in notifications {
            send_telegram_notification(&client, &msg).await;
        }
    }
}

// ============================================================
// MAIN
// ============================================================

#[tokio::main]
async fn main() {
    // Load .env if present (non-fatal)
    let _ = dotenvy::dotenv();

    let shared = Arc::new(AppState {
        state: Mutex::new(BotState::load()),
    });

    tokio::spawn(run_bot(shared.clone()));

    let app = Router::new()
        .route("/api/state",         get(get_state))
        .route("/api/markets",       get(get_markets))
        .route("/api/history",       get(get_history))
        .route("/api/price-history", get(get_price_history))
        .route("/api/settings",      post(post_settings))
        .route("/api/simulate",      post(post_simulate))
        .route("/api/sell",          post(post_sell))
        .route("/api/reset",         post(post_reset))
        .with_state(shared);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8082));
    println!("BTC 5m Bot API → http://{}", addr);

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}