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
    status: String, // "Won" or "Lost"
    final_price: f64, // Price when market resolved
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotSettings {
    usdc_balance: f64,
    matic_balance: f64,
    bet_size: f64,
    gas_price: f64,
    auto_mode: bool,
    threshold_above: f64,  // Min price to bet UP (e.g., 0.52)
    threshold_below: f64,  // Max price to bet DOWN (e.g., 0.48)
    #[serde(default = "default_max_above")]
    max_above: f64,        // Max price to bet UP (e.g., 0.65) - skip if too high
    #[serde(default = "default_min_below")]
    min_below: f64,        // Min price to bet DOWN (e.g., 0.35) - skip if too low
    tp_threshold: f64,
    sl_threshold: f64,
}

fn default_max_above() -> f64 { 0.65 }
fn default_min_below() -> f64 { 0.35 }

impl Default for BotSettings {
    fn default() -> Self {
        Self {
            usdc_balance: 25.0,  // Default: smallest test
            matic_balance: 0.5,
            bet_size: 1.0,
            gas_price: 0.001,
            auto_mode: false,
            threshold_above: 0.52,
            threshold_below: 0.48,
            max_above: 0.65,    // Don't bet UP if price > 65c
            min_below: 0.35,    // Don't bet DOWN if price < 35c
            tp_threshold: 0.20,
            sl_threshold: -0.30,
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
    #[serde(skip)]
    current_markets: Vec<Market>,
}

impl BotState {
    fn save(&self) {
        let path = std::env::var("STATE_FILE").unwrap_or_else(|_| "state.json".to_string());
        if let Ok(file) = File::create(&path) {
            let _ = serde_json::to_writer_pretty(file, self);
        }
    }

    fn load() -> Self {
        let path = std::env::var("STATE_FILE").unwrap_or_else(|_| "state.json".to_string());
        if let Ok(file) = File::open(&path) {
            let reader = BufReader::new(file);
            if let Ok(mut state) = serde_json::from_reader::<_, BotState>(reader) {
                // Ensure volatile data is initialized
                state.current_markets = Vec::new();
                println!("[INIT] State loaded from {}", path);
                return state;
            }
        }
        println!("[INIT] No state file found at {}, starting fresh", path);
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

#[allow(dead_code)]
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

async fn fetch_btc5m_markets(client: &Client) -> Vec<Market> {
    let now = Utc::now().timestamp();
    // Start from the CURRENT window to catch the live one (start_ts <= now)
    let start_window = (now / 300) * 300;
    
    let mut markets = Vec::new();
    let mut slugs_to_try = Vec::new();

    // Strategy 1: Predictable Slugs (Current + Near Future)
    for i in 0..4 {
        slugs_to_try.push(format!("btc-updown-5m-{}", start_window + (i * 300)));
    }

    println!("[DEBUG] Fetching BTC markets. Now: {}, start_window: {}", now, start_window);
    println!("[DEBUG] Trying slugs: {:?}", slugs_to_try);

    for slug in slugs_to_try {
        let url = format!("https://gamma-api.polymarket.com/markets?slug={}", slug);
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(2)).send().await {
            if let Ok(m) = resp.json::<Vec<serde_json::Value>>().await {
                if let Some(market) = m.into_iter().next() {
                    let out_prices = market.get("outcomePrices").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let clob_ids = market.get("clobTokenIds").and_then(|v| v.as_str()).map(|s| s.to_string());
                    
                    markets.push(Market {
                        slug: slug.clone(),
                        icon: market.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        outcome_prices: out_prices,
                        clob_token_ids: clob_ids,
                        category: Some("BTC".to_string()),
                    });
                    println!("[DEBUG] Got market for slug: {}", slug);
                } else {
                    println!("[DEBUG] No market found for slug: {}", slug);
                }
            } else {
                println!("[DEBUG] Failed to parse JSON for slug: {}", slug);
            }
        } else {
            println!("[DEBUG] Failed to fetch for slug: {}", slug);
        }
    }

    // Strategy 2: Broad Discovery (Backup)
    if markets.len() < 3 {
        println!("[DEBUG] Less than 3 markets found ({}), trying broad discovery", markets.len());
        let discovery_url = "https://gamma-api.polymarket.com/markets?active=true&limit=200";
        if let Ok(resp) = client.get(discovery_url).timeout(Duration::from_secs(2)).send().await {
            if let Ok(m) = resp.json::<Vec<serde_json::Value>>().await {
                for market in m {
                    let slug = market.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                    if slug.contains("btc-updown-5m") && !markets.iter().any(|existing| existing.slug == slug) {
                        let out_prices = market.get("outcomePrices").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let clob_ids = market.get("clobTokenIds").and_then(|v| v.as_str()).map(|s| s.to_string());
                        
                        markets.push(Market {
                            slug: slug.to_string(),
                            icon: market.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            outcome_prices: out_prices,
                            clob_token_ids: clob_ids,
                            category: Some("BTC".to_string()),
                        });
                        println!("[DEBUG] Added market from broad discovery: {}", slug);
                    }
                }
            } else {
                println!("[DEBUG] Failed to parse JSON in broad discovery");
            }
        } else {
            println!("[DEBUG] Failed to fetch in broad discovery");
        }
    }

    markets.sort_by(|a, b| {
        let ts_a = a.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let ts_b = b.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        ts_a.cmp(&ts_b)
    });

    // Only return current (ongoing) and future ones
    let initial_len = markets.len();
    markets.retain(|m| {
        let ts = m.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let keep = (ts + 300) > now;
        if !keep { 
            println!("[DEBUG] Filtering out expired market: {} (ends {}, now {})", m.slug, ts + 300, now); 
        }
        keep
    });
    println!("[DEBUG] After filtering expired: {} -> {}", initial_len, markets.len());

    markets.truncate(3);
    println!("[DEBUG] Fetched {} BTC markets (after truncate)", markets.len());
    markets
}

    for slug in slugs_to_try {
        let url = format!("https://gamma-api.polymarket.com/markets?slug={}", slug);
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(2)).send().await {
            if let Ok(m) = resp.json::<Vec<serde_json::Value>>().await {
                if let Some(market) = m.into_iter().next() {
                    let out_prices = market.get("outcomePrices").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let clob_ids = market.get("clobTokenIds").and_then(|v| v.as_str()).map(|s| s.to_string());
                    
                    markets.push(Market {
                        slug: slug.clone(),
                        icon: market.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        outcome_prices: out_prices,
                        clob_token_ids: clob_ids,
                        category: Some("BTC".to_string()),
                    });
                }
            }
        }
    }

    // Strategy 2: Broad Discovery (Backup)
    if markets.len() < 3 {
        let discovery_url = "https://gamma-api.polymarket.com/markets?active=true&limit=200";
        if let Ok(resp) = client.get(discovery_url).timeout(Duration::from_secs(2)).send().await {
            if let Ok(m) = resp.json::<Vec<serde_json::Value>>().await {
                for market in m {
                    let slug = market.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                    if slug.contains("btc-updown-5m") && !markets.iter().any(|existing| existing.slug == slug) {
                        let out_prices = market.get("outcomePrices").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let clob_ids = market.get("clobTokenIds").and_then(|v| v.as_str()).map(|s| s.to_string());
                        
                        markets.push(Market {
                            slug: slug.to_string(),
                            icon: market.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            outcome_prices: out_prices,
                            clob_token_ids: clob_ids,
                            category: Some("BTC".to_string()),
                        });
                    }
                }
            }
        }
    }

    markets.sort_by(|a, b| {
        let ts_a = a.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let ts_b = b.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        ts_a.cmp(&ts_b)
    });

    // Only return current (ongoing) and future ones
    markets.retain(|m| {
        let ts = m.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let keep = (ts + 300) > now;
        if !keep { println!("[DEBUG] Filtering out expired market: {} (ends {}, now {})", m.slug, ts + 300, now); }
        keep
    });

    markets.truncate(3);
    markets
}

async fn fetch_other_markets(client: &Client) -> Vec<Market> {
    let now = Utc::now().timestamp();
    
    let mut markets = Vec::new();
    
    // Fetch active markets and include all (no endDate filter since most are far out)
    let url = "https://gamma-api.polymarket.com/markets?active=true&limit=200";
    match client.get(url).timeout(Duration::from_secs(3)).send().await {
        Ok(resp) => {
            match resp.json::<Vec<serde_json::Value>>().await {
                Ok(m) => {
                    println!("[DEBUG] Found {} total active markets", m.len());
                    for market in m {
                        let slug = market.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                        
                        // Skip BTC 5m markets
                        if slug.contains("btc-updown-5m") {
                            continue;
                        }
                        
                        // Check if market is closed
                        let closed = market.get("closed").and_then(|v| v.as_bool()).unwrap_or(false);
                        if closed {
                            continue;
                        }
                        
                        // Get endDate - if null, use a default (market never ends or TBD)
                        let end_ts = market.get("endDate")
                            .and_then(|v| v.as_str())
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| dt.timestamp())
                            .unwrap_or(now + 86400 * 365); // Default to 1 year if no endDate
                        
                        // Include all non-expired markets (end date in the future)
                        if end_ts > now {
                            let out_prices = market.get("outcomePrices").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let clob_ids = market.get("clobTokenIds").and_then(|v| v.as_str()).map(|s| s.to_string());
                            
                            // Extract category from question/slug
                            let question = market.get("question").and_then(|v| v.as_str()).unwrap_or("");
                            let category = if question.to_lowercase().contains("soccer") || question.to_lowercase().contains("football") {
                                "SOCCER"
                            } else if question.to_lowercase().contains("nba") || question.to_lowercase().contains("basketball") {
                                "NBA"
                            } else if question.to_lowercase().contains("nhl") || question.to_lowercase().contains("hockey") {
                                "NHL"
                            } else if question.to_lowercase().contains("nfl") || (question.to_lowercase().contains("football") && question.to_lowercase().contains("game")) {
                                "NFL"
                            } else if question.to_lowercase().contains("tennis") {
                                "TENNIS"
                            } else if question.to_lowercase().contains("mma") || question.to_lowercase().contains("ufc") {
                                "MMA"
                            } else if question.to_lowercase().contains("cricket") {
                                "CRICKET"
                            } else if question.to_lowercase().contains("esports") {
                                "ESPORTS"
                            } else if slug.contains("sport") {
                                "SPORTS"
                            } else if question.to_lowercase().contains("election") || question.to_lowercase().contains("trump") || question.to_lowercase().contains("politics") {
                                "POLITICS"
                            } else {
                                "OTHER"
                            };
                            
                            markets.push(Market {
                                slug: slug.to_string(),
                                icon: market.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                outcome_prices: out_prices,
                                clob_token_ids: clob_ids,
                                category: Some(category.to_string()),
                            });
                        }
                    }
                    println!("[DEBUG] Found {} other markets (non-expired)", markets.len());
                },
                Err(e) => println!("[DEBUG] Failed to parse markets: {}", e)
            }
        },
        Err(e) => println!("[DEBUG] Failed to fetch markets: {}", e)
    }
    
    // Sort by end date and limit to 15
    markets.sort_by(|a, b| {
        let end_a = a.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0) + 300;
        let end_b = b.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0) + 300;
        end_a.cmp(&end_b)
    });
    
    markets.truncate(15);
    println!("[DEBUG] Other markets after filter: {}", markets.len());
    markets
}

#[allow(dead_code)]
async fn check_settlement(client: &Client, slug: &str) -> Option<String> {
    // Try with active=false first to find resolved markets
    let url = format!("https://gamma-api.polymarket.com/markets?slug={}", slug);
    
    if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(2)).send().await {
        if let Ok(m) = resp.json::<Vec<serde_json::Value>>().await {
            if let Some(market) = m.into_iter().next() {
                // Check for resolution - outcome field or resolved field
                if let Some(outcome) = market.get("outcome").and_then(|v| v.as_str()) {
                    if !outcome.is_empty() {
                        return Some(outcome.to_string());
                    }
                }
                // Also check the "resolution" field
                if let Some(resolution) = market.get("resolution").and_then(|v| v.as_str()) {
                    if !resolution.is_empty() {
                        return Some(resolution.to_string());
                    }
                }
            }
        }
    }
    None
}

fn get_time_from_slug(slug: &str) -> String {
    slug.split('-').last()
        .and_then(|s| s.parse::<i64>().ok())
        .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
        .map(|dt| dt.format("%H:%M").to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn get_countdown(end_ts: i64) -> String {
    let remaining = end_ts - Utc::now().timestamp();
    if remaining > 0 {
        format!("{:02}:{:02}", remaining / 60, remaining % 60)
    } else {
        "WAITING".to_string()
    }
}

fn get_end_timestamp(slug: &str) -> i64 {
    slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).map(|ts| ts + 300).unwrap_or(0)
}

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

async fn send_telegram_notification(message: &str) {
    let token = std::env::var("TELEGRAM_TOKEN").ok();
    let chat_id = std::env::var("TELEGRAM_CHAT_ID").ok();
    
    if let (Some(token), Some(chat_id)) = (token, chat_id) {
        let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        
        let payload = serde_json::json!({
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        });
        
        let _ = client.post(&url)
            .json(&payload)
            .send()
            .await;
    }
}

fn check_milestone_balance(current_balance: f64, last_notified: f64) -> Option<i32> {
    let current_milestone = (current_balance / 25.0).floor() as i32;
    let last_milestone = (last_notified / 25.0).floor() as i32;
    
    if current_milestone > last_milestone {
        Some(current_milestone)
    } else {
        None
    }
}

// Helper function for consistent PnL calculation
fn calculate_pnl(amount: f64, entry_price: f64, exit_price: f64) -> f64 {
    let shares = amount / entry_price;
    (shares * exit_price) - amount
}

// Fetch market resolution from Gamma API
async fn fetch_market_resolution(client: &Client, slug: &str) -> Option<String> {
    let url = format!("https://gamma-api.polymarket.com/markets?slug={}", slug);
    
    match client.get(&url).timeout(Duration::from_secs(3)).send().await {
        Ok(resp) => {
            if let Ok(markets) = resp.json::<Vec<serde_json::Value>>().await {
                if let Some(market) = markets.first() {
                    // Check for "outcome" field
                    if let Some(outcome) = market.get("outcome").and_then(|v| v.as_str()) {
                        if !outcome.is_empty() {
                            return Some(outcome.to_string());
                        }
                    }
                    // Check for "resolved" field
                    if let Some(resolved) = market.get("resolved").and_then(|v| v.as_bool()) {
                        if resolved {
                            return market.get("outcome")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                        }
                    }
                }
            }
        }
        Err(e) => {
            println!("[WARN] Failed to fetch resolution for {}: {}", slug, e);
        }
    }
    None
}

async fn fetch_clob_price(client: &Client, token_id: &str) -> f64 {
    let url = format!("https://clob.polymarket.com/price?token_id={}&side=buy", token_id);
    
    match client.get(&url).timeout(Duration::from_secs(2)).send().await {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(price_str) = data.get("price").and_then(|v| v.as_str()) {
                    if let Ok(price) = price_str.parse::<f64>() {
                        return price;
                    }
                }
                // Fallback to average or previous if possible, but for now 0.5 with warning
                println!("[WARN] Invalid price format for token {}: {:?}", token_id, data);
            } else {
                println!("[WARN] Failed to parse JSON for token {}", token_id);
            }
        }
        Err(e) => {
            println!("[ERROR] CLOB API Request failed for token {}: {}", token_id, e);
        }
    }
    0.5
}

fn parse_prices(prices_str: Option<&str>) -> Vec<f64> {
    if let Some(s) = prices_str {
        // Try parsing as Vec<String> (Gamma API standard)
        if let Ok(str_vec) = serde_json::from_str::<Vec<String>>(s) {
            return str_vec.iter().map(|v| v.parse::<f64>().unwrap_or(0.5)).collect();
        }
        // Try parsing as Vec<f64> (Alternative)
        if let Ok(f64_vec) = serde_json::from_str::<Vec<f64>>(s) {
            return f64_vec;
        }
        println!("[ERROR] Failed to parse prices: {}", s);
    }
    vec![0.5, 0.5]
}

async fn get_state(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let s = state.state.lock().await;
    
    // Calculate detailed stats
    let mut wins = 0i32;
    let mut losses = 0i32;
    let mut total_profit = 0.0;
    let mut total_loss = 0.0;
    let mut realized_pnl = 0.0;
    
    for t in &s.history {
        let pnl = t.pnl;
        if t.status == "Won" || t.status == "Sold Early" {
            if pnl > 0.0 {
                wins += 1;
                total_profit += pnl;
            } else {
                losses += 1;
                total_loss += pnl.abs();
            }
            realized_pnl += pnl;
        } else if t.status == "Lost" || t.status == "Auto Exit" {
            losses += 1;
            total_loss += pnl.abs();
            realized_pnl += pnl;
        }
    }
    
    let win_rate = if wins + losses > 0 { (wins as f64 / (wins + losses) as f64) * 100.0 } else { 0.0 };
    let net_profit = total_profit - total_loss;
    
    // Calculate hourly stats for charting
    let mut hourly_stats: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
    for t in &s.history {
        let dt = chrono::DateTime::from_timestamp(t.timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:00").to_string())
            .unwrap_or_default();
        
        if dt.is_empty() { continue; }
        
        let entry = hourly_stats.entry(dt).or_insert(serde_json::json!({"profit": 0.0, "trades": 0}));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert("profit".to_string(), serde_json::json!(obj.get("profit").unwrap_or(&serde_json::Value::from(0.0)).as_f64().unwrap_or(0.0) + t.pnl));
            obj.insert("trades".to_string(), serde_json::json!(obj.get("trades").unwrap_or(&serde_json::Value::from(0)).as_i64().unwrap_or(0) + 1));
        }
    }
    
    // Calculate floating P&L from open positions
    let floating_pnl: f64 = s.open_positions.iter().map(|p| {
        s.current_markets.iter()
            .find(|m| m.slug == p.slug)
            .map(|m| {
                let prices = parse_prices(m.outcome_prices.as_deref());
                let current_price = if p.outcome == "Yes" { prices.get(0).copied().unwrap_or(0.5) } else { prices.get(1).copied().unwrap_or(0.5) };
                (p.amount / p.price) * current_price - p.amount
            })
            .unwrap_or(0.0)
    }).sum();
    
    Json(serde_json::json!({
        "settings": s.settings,
        "history": s.history,
        "open_positions": s.open_positions,
        "last_trade_timestamp": s.last_trade_timestamp,
        "usdc_balance": s.settings.usdc_balance,
        "matic_balance": s.settings.matic_balance,
        "realized_pnl": realized_pnl,
        "floating_pnl": floating_pnl,
        "wins": wins,
        "losses": losses,
        "win_rate": win_rate,
        "total_profit": total_profit,
        "total_loss": total_loss,
        "net_profit": net_profit,
        "hourly_stats": hourly_stats
    }))
}

async fn get_markets(State(state): State<Arc<AppState>>) -> Json<ApiMarkets> {
    let s = state.state.lock().await;
    
    let markets: Vec<MarketInfo> = s.current_markets.iter().map(|m| {
        let prices = parse_prices(m.outcome_prices.as_deref());
        let end_ts = get_end_timestamp(&m.slug);
        
        MarketInfo {
            slug: m.slug.clone(),
            time: get_time_from_slug(&m.slug),
            countdown: get_countdown(end_ts),
            end_timestamp: end_ts,
            yes_price: prices.get(0).copied().unwrap_or(0.5),
            no_price: prices.get(1).copied().unwrap_or(0.5),
            icon: m.icon.clone().unwrap_or_default(),
            category: m.category.clone().unwrap_or_else(|| "OTHER".to_string()),
        }
    }).collect();
    
    Json(ApiMarkets { markets })
}

async fn get_history(State(state): State<Arc<AppState>>) -> Json<ApiHistory> {
    let s = state.state.lock().await;
    Json(ApiHistory { trades: s.history.clone() })
}

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
    auto_mode: Option<String>,
}

async fn post_settings(State(state): State<Arc<AppState>>, Json(form): Json<SettingsForm>) -> Json<serde_json::Value> {
    // Validate inputs
    if form.threshold_above < 0.4 || form.threshold_above > 0.9 {
        return Json(serde_json::json!({"status": "error", "message": "threshold_above must be between 0.4 and 0.9"}));
    }
    if form.threshold_below < 0.1 || form.threshold_below > 0.6 {
        return Json(serde_json::json!({"status": "error", "message": "threshold_below must be between 0.1 and 0.6"}));
    }
    if form.max_above < form.threshold_above || form.max_above > 0.95 {
        return Json(serde_json::json!({"status": "error", "message": "max_above must be >= threshold_above and <= 0.95"}));
    }
    if form.min_below > form.threshold_below || form.min_below < 0.05 {
        return Json(serde_json::json!({"status": "error", "message": "min_below must be <= threshold_below and >= 0.05"}));
    }
    if form.bet_size <= 0.0 || form.bet_size > 100.0 {
        return Json(serde_json::json!({"status": "error", "message": "bet_size must be between 0.01 and 100"}));
    }
    
    let mut s = state.state.lock().await;
    
    // If starting simulation (auto_mode changing from false to true), use form values
    let was_auto_mode = s.settings.auto_mode;
    let is_starting = !was_auto_mode && form.auto_mode.as_ref().map(|v| v == "on").unwrap_or(false);
    
    println!("[POST_SETTINGS] was_auto={}, form_auto={}, is_starting={}", was_auto_mode, form.auto_mode.as_ref().map(|v| v == "on").unwrap_or(false), is_starting);
    println!("[POST_SETTINGS] form - usdc:{}, matic:{}, bet:{}, above:{}, below:{}", form.usdc_balance, form.matic_balance, form.bet_size, form.threshold_above, form.threshold_below);
    
    // Always use form balance when starting simulation
    if is_starting {
        // Use form values if provided, otherwise use defaults
        let usdc = if form.usdc_balance > 0.0 { form.usdc_balance } else { 100.0 };
        let matic = if form.matic_balance > 0.0 { form.matic_balance } else { 0.5 };
        s.settings.usdc_balance = usdc;
        s.settings.matic_balance = matic;
        println!("[INIT] Starting simulation with balance ${:.2} USDC, {:.4} MATIC", usdc, matic);
    } else {
        println!("[SETTINGS] Not starting - preserving balance ${:.2}", s.settings.usdc_balance);
    }
    
    // Update trading params
    s.settings.bet_size = form.bet_size;
    s.settings.gas_price = form.gas_price;
    s.settings.threshold_above = form.threshold_above;
    s.settings.threshold_below = form.threshold_below;
    s.settings.max_above = form.max_above;
    s.settings.min_below = form.min_below;
    s.settings.tp_threshold = form.tp_threshold;
    s.settings.sl_threshold = form.sl_threshold;
    s.settings.auto_mode = form.auto_mode.as_ref().map(|s| s == "on").unwrap_or(false);
    s.save();
    
    println!("[SETTINGS] Updated - auto_mode: {}, balance: {:.2}", s.settings.auto_mode, s.settings.usdc_balance);
    
    Json(serde_json::json!({"status": "ok"}))
}

#[derive(Deserialize)]
struct SimulateForm {
    slug: String,
    outcome: String,
    amount: f64,
    price: f64,
}

async fn post_simulate(State(state): State<Arc<AppState>>, Json(form): Json<SimulateForm>) -> Json<serde_json::Value> {
    let mut s = state.state.lock().await;
    
    // Check if already have position in this market
    if s.open_positions.iter().any(|p| p.slug == form.slug) {
        return Json(serde_json::json!({"status": "error", "message": "Already have position in this market"}));
    }

    let gas_cost = s.settings.gas_price;
    let end_ts = get_end_timestamp(&form.slug);

    let pos = Position {
        slug: form.slug.clone(),
        outcome: form.outcome.clone(),
        amount: form.amount,
        price: form.price,
        timestamp: Utc::now().timestamp(),
        end_timestamp: end_ts,
        traded: true,
        yes_token_id: None,
        no_token_id: None,
    };

    s.settings.usdc_balance -= form.amount;
    s.settings.matic_balance -= gas_cost;
    s.open_positions.push(pos);
    s.last_trade_timestamp = Utc::now().timestamp();
    s.save();
    
    Json(serde_json::json!({"status": "ok"}))
}

async fn post_sell(State(state): State<Arc<AppState>>, Json(form): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let slug = form.get("slug").and_then(|v| v.as_str()).unwrap_or("");
    let mut s = state.state.lock().await;
    
    let pos_idx = s.open_positions.iter().position(|p| p.slug == slug);
    if let Some(idx) = pos_idx {
        let pos = s.open_positions.remove(idx);
        let now = Utc::now().timestamp();
        
        // Find current price in current markets
        let current_price = s.current_markets.iter()
            .find(|m| m.slug == slug)
            .and_then(|m| {
                let p = parse_prices(m.outcome_prices.as_deref());
                if pos.outcome == "Yes" { p.get(0).copied() } else { p.get(1).copied() }
            }).unwrap_or(pos.price); // Fallback to entry price if market not found

        let pnl = (pos.amount / pos.price) * current_price - pos.amount;
        
        let trade = Trade {
            slug: pos.slug,
            outcome: pos.outcome,
            amount: pos.amount,
            price: pos.price,
            pnl,
            timestamp: now,
            gas_cost: s.settings.gas_price,
            status: "Sold Early".to_string(),
            final_price: current_price,
        };

        s.settings.usdc_balance += pos.amount + pnl;
        s.history.insert(0, trade);
        s.save();
        
        return Json(serde_json::json!({"status": "ok"}));
    }
    
    Json(serde_json::json!({"status": "error", "message": "Position not found"}))
}

async fn post_reset(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut s = state.state.lock().await;
    
    // Reset to fresh state - balances to 0, stop simulation
    s.settings.usdc_balance = 0.0;
    s.settings.matic_balance = 0.0;
    s.settings.bet_size = 1.0;
    s.settings.gas_price = 0.001;
    s.settings.auto_mode = false;  // STOP simulation
    s.settings.threshold_above = 0.52;
    s.settings.threshold_below = 0.48;
    s.settings.max_above = 0.65;
    s.settings.min_below = 0.35;
    s.settings.tp_threshold = 0.0;
    s.settings.sl_threshold = -1.0;
    s.history.clear();
    s.open_positions.clear();
    s.last_trade_timestamp = 0;
    s.stopped = false;
    s.current_markets.clear();
    s.save();
    
    // Clear the log file
    let log_path = std::env::current_dir()
        .map(|p| p.join("bot.log"))
        .ok();
    if let Some(p) = log_path {
        let _ = std::fs::write(&p, "");
    }
    
    println!("[RESET] Bot reset - simulation stopped, balances cleared to 0");
    
    Json(serde_json::json!({"status": "ok"}))
}

async fn run_bot(state: Arc<AppState>) {
    let mut ticker = interval(Duration::from_millis(500));
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();

    // Track last notified balance for milestone alerts
    let mut last_milestone_balance: f64 = 0.0;
    let mut has_sent_start_notification = false;
    let mut last_market_fetch: i64 = 0;
    const MARKET_FETCH_INTERVAL: i64 = 10; // Fetch markets every 10 ticks (5 seconds)

    loop {
        ticker.tick().await;
        let now = Utc::now().timestamp();
        
        // --- STEP 0: AUTO GAS REFILL (SIMULATION ONLY) ---
        {
            let mut s = state.state.lock().await;
            if s.settings.matic_balance < 0.01 {
                s.settings.matic_balance += 0.5;
                println!("[GAS] ⛽ Refilling gas balance. Current: {:.4} MATIC", s.settings.matic_balance);
                s.save();
            }
        }

        // --- RATE LIMITING: Only fetch markets every MARKET_FETCH_INTERVAL ticks ---
        let should_fetch_markets = (now - last_market_fetch) >= MARKET_FETCH_INTERVAL;
        
        // --- STEP 1: GATHER DATA (OUTSIDE LOCK) ---
        
        // 1a. Fetch BTC 5m markets (with rate limiting)
        let btc_markets = if should_fetch_markets {
            last_market_fetch = now;
            fetch_btc5m_markets(&client).await
        } else {
            Vec::new()
        };
        
        // 1b. Fetch other markets (with rate limiting)
        let other_markets = if should_fetch_markets {
            fetch_other_markets(&client).await
        } else {
            // When not fetching, we need old markets from state
            let s = state.state.lock().await;
            s.current_markets.iter().filter(|m| !m.slug.contains("btc-updown")).cloned().collect()
        };
        
        // Combine BTC + Other markets
        let mut markets = btc_markets;
        markets.extend(other_markets);
        
        // Fetch all CLOB prices concurrently
        let mut price_futures: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = (f64, f64)> + Send>>> = Vec::new();
        for m in &markets {
            if let (Some(y_id), Some(n_id)) = get_token_ids(m.clob_token_ids.as_deref()) {
                let y_id = y_id.clone();
                let n_id = n_id.clone();
                let client_clone = client.clone();
                price_futures.push(Box::pin(async move {
                    let (y, n) = tokio::join!(
                        fetch_clob_price(&client_clone, &y_id),
                        fetch_clob_price(&client_clone, &n_id)
                    );
                    (y, n)
                }));
            } else {
                // Return dummy to keep index in sync if no CLOB IDs
                price_futures.push(Box::pin(async move { (0.5_f64, 0.5_f64) }));
            }
        }
        
        let fetched_prices = futures::future::join_all(price_futures).await;
        for (m, (y, n)) in markets.iter_mut().zip(fetched_prices) {
            m.outcome_prices = Some(format!("[\"{}\", \"{}\"]", y, n));
        }
        
        // 1b. Identify positions needing settlement + get token IDs
        let mut expiring_positions: Vec<(String, Option<String>, Option<String>)> = Vec::new();
        {
            let s = state.state.lock().await;
            for pos in &s.open_positions {
                if now > pos.end_timestamp {
                    expiring_positions.push((pos.slug.clone(), pos.yes_token_id.clone(), pos.no_token_id.clone()));
                }
            }
        }
        
        // 1c. Fetch CLOB final prices for expiring positions (not Gamma API!)
        let mut final_price_futures: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = (String, f64)> + Send>>> = Vec::new();
        for (slug, yes_token, no_token) in expiring_positions {
            let yes_token = yes_token.unwrap_or_default();
            let no_token = no_token.unwrap_or_default();
            let client_clone = client.clone();
            final_price_futures.push(Box::pin(async move {
                let (yes_price, _no_price) = tokio::join!(
                    fetch_clob_price(&client_clone, &yes_token),
                    fetch_clob_price(&client_clone, &no_token)
                );
                // YES price = price at settlement
                (slug, yes_price)
            }));
        }
        
        let final_prices: std::collections::HashMap<String, f64> = futures::future::join_all(final_price_futures).await
            .into_iter()
            .collect();

        // --- STEP 2: APPLY CHANGES (INSIDE LOCK) ---
        
        {
            let mut s = state.state.lock().await;
            s.current_markets = markets.clone();
            let settings = s.settings.clone();
            let mut state_changed = false;

            // 2a. Handle TP/SL and "Normal" Resolution
            let mut i = 0;
            while i < s.open_positions.len() {
                let pos = &s.open_positions[i];

                // Check for expired positions (market end time passed)
                if now > pos.end_timestamp {
                    // Use pre-fetched CLOB final price (more reliable than Gamma API)
                    let final_price = if let Some(&price) = final_prices.get(&pos.slug) {
                        price
                    } else {
                        // Fallback: try to find in current markets (clone to avoid borrow)
                        s.current_markets.iter()
                            .find(|m| m.slug == pos.slug)
                            .map(|m| parse_prices(m.outcome_prices.as_deref()).get(0).copied().unwrap_or(0.5))
                            .unwrap_or(0.5)
                    };

                    // Fetch resolution from Gamma API
                    let resolution = fetch_market_resolution(&client, &pos.slug).await;
                    
                    // Determine win/loss from resolution or fallback to price-based
                    let win = if let Some(res) = &resolution {
                        let is_yes_winner = res.eq_ignore_ascii_case("Yes") || res.eq_ignore_ascii_case("1") || res.eq_ignore_ascii_case("true");
                        (pos.outcome == "Yes" && is_yes_winner) || (pos.outcome == "No" && !is_yes_winner)
                    } else {
                        // Fallback to price-based logic
                        (pos.outcome == "Yes" && final_price > 0.5) || (pos.outcome == "No" && final_price <= 0.5)
                    };
                    
                    let pos = s.open_positions.remove(i);
                    
                    // Use helper function for PnL
                    let pnl = if win { 
                        calculate_pnl(pos.amount, pos.price, if pos.outcome == "Yes" { 1.0 } else { 0.0 }) 
                    } else { 
                        -pos.amount 
                    };
                    
                    println!("[SETTLE] Market {} | Entry: {:.1}c | Resolution: {:?} | Bet: {} | {}", 
                        pos.slug, pos.price * 100.0, resolution, pos.outcome, if win { "WIN" } else { "LOSS" });
                    
                    let trade = Trade {
                        slug: pos.slug,
                        outcome: pos.outcome,
                        amount: pos.amount,
                        price: pos.price,
                        pnl,
                        timestamp: now,
                        gas_cost: s.settings.gas_price,
                        status: if win { "Won".to_string() } else { "Lost".to_string() },
                        final_price: final_price,
                    };

                    if win { s.settings.usdc_balance += pos.amount + pnl; }
                    s.history.insert(0, trade);
                    if s.history.len() > 100 { s.history.truncate(100); }
                    state_changed = true;
                }
                // Check TP/SL for active markets (only if position hasn't expired)
                else if let Some(m) = s.current_markets.iter().find(|m| m.slug == pos.slug) {
                    let prices = parse_prices(m.outcome_prices.as_deref());
                    let current_price = if pos.outcome == "Yes" { prices.get(0).copied() } else { prices.get(1).copied() }.unwrap_or(pos.price);
                    let pnl_pct = (current_price - pos.price) / pos.price;
                    
                    // Only trigger TP/SL if thresholds are actually enabled (>0 for TP, <0 for SL)
                    let tp_enabled = settings.tp_threshold > 0.0 && pnl_pct >= settings.tp_threshold;
                    let sl_enabled = settings.sl_threshold < 0.0 && pnl_pct <= settings.sl_threshold;
                    
                    if tp_enabled || sl_enabled {
                        let pos = s.open_positions.remove(i);
                        let label = if tp_enabled { "AUTO-TP" } else { "AUTO-SL" };
                        println!("[{}] {} reached for {}: {:.1}%", label, label, pos.slug, pnl_pct * 100.0);
                        
                        // Use helper function for PnL
                        let pnl = calculate_pnl(pos.amount, pos.price, current_price);
                        let trade = Trade {
                            slug: pos.slug,
                            outcome: pos.outcome,
                            amount: pos.amount,
                            price: pos.price,
                            pnl,
                            timestamp: now,
                            gas_cost: s.settings.gas_price,
                            status: "Auto Exit".to_string(),
                            final_price: current_price,
                        };
                        s.settings.usdc_balance += pos.amount + pnl;
                        s.history.insert(0, trade);
                        if s.history.len() > 100 { s.history.truncate(100); }
                        state_changed = true;
                    } else {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }

            // 2b. Auto-mode Trading Logic - Simple: 1 bet per 5-min window, hold until settlement
            if settings.auto_mode && !s.current_markets.is_empty() {
                // Get current 5-minute window
                let current_window = (now / 300) * 300;
                let next_window = current_window + 300;
                
                // Check if we already have open position for current/next window
                let has_position = s.open_positions.iter().any(|p| p.end_timestamp > now);
                
                // Clone markets to avoid borrow issues
                let markets_clone: Vec<Market> = s.current_markets.clone();
                
                // Find the active market (current window that's still open)
                if let Some(m) = markets_clone.into_iter().find(|m| {
                    let end_ts = get_end_timestamp(&m.slug);
                    end_ts > now && end_ts <= next_window
                }) {
                    let end_ts = get_end_timestamp(&m.slug);
                    let time_left = end_ts - now;
                    let prices = parse_prices(m.outcome_prices.as_deref());
                    let yes_price = prices.get(0).copied().unwrap_or(0.5);
                    
                    // Monitoring log
                    println!("[REALTIME] {} | UP: {:.1}c | T-{}s | {}", 
                        m.slug.split('-').last().unwrap_or(""), 
                        yes_price * 100.0,
                        time_left,
                        if time_left < 60 { "WAIT" } else { "READY" });

                    // Calculate dynamic bet size: balance / 25 (e.g., $25 → $1, $50 → $2, $100 → $4)
                    let dynamic_bet = (settings.usdc_balance / 25.0).max(0.25).min(10.0);
                    
                    // Gas check: need at least 2x gas price for 2 bets
                    let gas_needed = settings.gas_price * 2.0;
                    if settings.matic_balance < gas_needed {
                        if !s.stopped {
                            s.stopped = true;
                            s.save();
                        }
                        println!("[ALERT] 🚨 Gas tidak cukup! Saldo MATIC: {:.4} | Butuh: {:.4} | TRADING DIHENTIKAN", 
                            settings.matic_balance, gas_needed);
                    } else if settings.usdc_balance < dynamic_bet {
                        println!("[ALERT] 🚨 Saldo USDC tidak cukup! Saldo: {:.2} | Butuh: {:.2}", 
                            settings.usdc_balance, dynamic_bet);
                    } else if !s.stopped && !has_position && time_left > 60 {
                        // Check if price is in safe entry zone
                        let can_buy_up = yes_price >= settings.threshold_above && yes_price <= settings.max_above;
                        let can_buy_down = yes_price <= settings.threshold_below && yes_price >= settings.min_below;
                        
                        if can_buy_up || can_buy_down {
                            let outcome = if can_buy_up { "Yes" } else { "No" };
                            let entry_price = if outcome == "Yes" { yes_price } else { 1.0 - yes_price };
                            s.settings.usdc_balance -= dynamic_bet;
                            s.settings.matic_balance -= settings.gas_price;
                            
                            let (yes_token, no_token) = get_token_ids(m.clob_token_ids.as_deref());
                            
                            s.open_positions.push(Position {
                                slug: m.slug.clone(),
                                outcome: outcome.to_string(),
                                amount: dynamic_bet,
                                price: entry_price,
                                timestamp: now,
                                end_timestamp: end_ts,
                                traded: true,
                                yes_token_id: yes_token,
                                no_token_id: no_token,
                            });
                            
                            s.last_trade_timestamp = now;
                            println!("[AUTO] 🎯 Placed {} bet ${:.2} for {} at {:.1}% (holding to settlement)", 
                                outcome, dynamic_bet, m.slug, entry_price * 100.0);
                            state_changed = true;
                        } else {
                            // Log skipped trades due to price being too high/low
                            if yes_price > settings.max_above {
                                println!("[SKIP] Price {} too high for UP, max allowed is {:.0}%", yes_price * 100.0, settings.max_above * 100.0);
                            } else if yes_price < settings.min_below {
                                println!("[SKIP] Price {} too low for DOWN, min allowed is {:.0}%", yes_price * 100.0, settings.min_below * 100.0);
                            }
                        }
                    }
                }
            }

            if state_changed {
                s.save();
            }
            let _ = std::io::stdout().flush();
            
            // Send notifications for: start, milestone balance, gas low
            let current_balance = s.settings.usdc_balance;
            let current_matic = s.settings.matic_balance;
            
            // 1. Start simulation notification (first time auto_mode becomes true with balance)
            if settings.auto_mode && !has_sent_start_notification && current_balance >= 100.0 {
                let msg = format!("🚀 <b>Simulation Started!</b>\n\n💰 Balance: ${:.2}\n⛽ Gas: {:.4} MATIC\n\n🎯 Bot is now trading...", current_balance, current_matic);
                send_telegram_notification(&msg).await;
                has_sent_start_notification = true;
                last_milestone_balance = current_balance;
            }
            
            // 2. Milestone balance (every $25)
            if settings.auto_mode && current_balance > 0.0 {
                if let Some(milestone) = check_milestone_balance(current_balance, last_milestone_balance) {
                    let target = milestone as f64 * 25.0;
                    let direction = if current_balance > last_milestone_balance { "📈" } else { "📉" };
                    let pnl = current_balance - 100.0;
                    let pnl_str = if pnl >= 0.0 { format!("+${:.2}", pnl) } else { format!("-${:.2}", pnl.abs()) };
                    
                    let msg = format!("{} <b>Balance Milestone!</b>\n\n💰 Current: ${:.2}\n📊 P&L: {}\n\n🎯 Every $25 matters!", direction, target, pnl_str);
                    send_telegram_notification(&msg).await;
                    last_milestone_balance = current_balance;
                }
            }
            
            // 3. Gas low warning (< 0.01 MATIC)
            if settings.auto_mode && current_matic < 0.01 {
                let msg = "⚠️ <b>Gas Low Warning!</b>\n\n⛽ MATIC balance very low!\nAuto-refill triggered...";
                send_telegram_notification(&msg).await;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState { state: Mutex::new(BotState::load()) });
    let state_clone = state.clone();
    
    tokio::spawn(run_bot(state_clone));
    
    let app = Router::new()
        .route("/api/state", get(get_state))
        .route("/api/markets", get(get_markets))
        .route("/api/history", get(get_history))
        .route("/api/settings", post(post_settings))
        .route("/api/simulate", post(post_simulate))
        .route("/api/sell", post(post_sell))
        .route("/api/reset", post(post_reset))
        .with_state(state);
    
    let addr = SocketAddr::from(([0, 0, 0, 0], 8082));
    println!("BTC 5m Forward Bot API running on http://{}", addr);
    
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}