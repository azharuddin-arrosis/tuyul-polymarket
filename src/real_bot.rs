use axum::{
    extract::State,
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;
use chrono::Local;
use std::net::SocketAddr;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use base64::{Engine as _, engine::general_purpose};
use dotenv::dotenv;
use serde_json::Value;

// --- REAL TYPES ---

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Market {
    question: String,
    category: String,
    prob: f64,
    slug: String,
    token_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Trade {
    id: String,
    question: String,
    bet_amount: f64,
    entry_prob: f64,
    unrealized_pnl: f64,
    current_price: f64,
    slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryEntry {
    question: String,
    bet_amount: f64,
    pnl: f64,
    won: bool,
    time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryPoint {
    time: String,
    total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RealBotState {
    balance: f64,
    usd_in_bet: f64,
    pnl_realized: f64,
    open_trades: Vec<Trade>,
    history: Vec<HistoryEntry>,
    current_markets: Vec<Market>,
    chart_history: Vec<HistoryPoint>,
    min_prob_threshold: f64,
    running: bool,
    last_sync: String,
}

type SharedState = Arc<Mutex<RealBotState>>;

// --- AUTH HELPER ---
struct PolyAuth {
    api_key: String,
    api_secret: String,
    api_passphrase: String,
    address: String,
}

impl PolyAuth {
    fn from_env() -> Self {
        dotenv().ok();
        Self {
            api_key: std::env::var("POLY_API_KEY").unwrap_or_default(),
            api_secret: std::env::var("POLY_API_SECRET").unwrap_or_default(),
            api_passphrase: std::env::var("POLY_API_PASSPHRASE").unwrap_or_default(),
            address: std::env::var("POLY_FUNDER_ADDRESS").unwrap_or_default(),
        }
    }
}

#[tokio::main]
async fn main() {
    let state = Arc::new(Mutex::new(RealBotState {
        balance: 0.0, usd_in_bet: 0.0, pnl_realized: 0.0,
        open_trades: vec![], history: vec![], current_markets: vec![],
        chart_history: vec![], min_prob_threshold: 0.70,
        running: false, last_sync: "INIT".to_string(),
    }));

    let worker_state = Arc::clone(&state);
    tokio::spawn(async move {
        worker_loop(worker_state).await;
    });

    let app = Router::new()
        .route("/", get(get_dashboard))
        .route("/api/status", get(get_status))
        .route("/api/start", post(start_bot))
        .route("/api/stop", post(stop_bot))
        .route("/api/settings", post(update_settings))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 9090));
    println!("🔥 REAL POLYBOT SDK ACTIVE on http://localhost:9090");
    axum::Server::bind(&addr).serve(app.into_make_service()).await.unwrap();
}

#[derive(Deserialize)]
struct SettingsPayload { min_prob: f64 }

async fn update_settings(State(state): State<SharedState>, Json(p): Json<SettingsPayload>) -> impl IntoResponse {
    state.lock().unwrap().min_prob_threshold = p.min_prob;
    axum::http::StatusCode::OK
}

async fn get_dashboard() -> Html<&'static str> { Html(include_str!("real_dashboard.html")) }
async fn get_status(State(state): State<SharedState>) -> impl IntoResponse { Json(state.lock().unwrap().clone()) }
async fn start_bot(State(state): State<SharedState>) -> impl IntoResponse { state.lock().unwrap().running = true; axum::http::StatusCode::OK }
async fn stop_bot(State(state): State<SharedState>) -> impl IntoResponse { state.lock().unwrap().running = false; axum::http::StatusCode::OK }

async fn worker_loop(state: SharedState) {
    let client = reqwest::Client::new();
    loop {
        let auth = PolyAuth::from_env();
        
        // --- 1. FETCH REAL BALANCE (CLOB) ---
        let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs().to_string();
        let sig_msg = format!("{}GET/balance-allowance?asset_type=0", ts);
        let secret_decoded = general_purpose::STANDARD.decode(&auth.api_secret).unwrap_or_default();
        if !secret_decoded.is_empty() {
            let mut mac = Hmac::<Sha256>::new_from_slice(&secret_decoded).expect("HMAC");
            mac.update(sig_msg.as_bytes());
            let signature = general_purpose::STANDARD.encode(mac.finalize().into_bytes());

            if let Ok(res) = client.get("https://clob.polymarket.com/balance-allowance?asset_type=0")
                .header("POLY-API-KEY", &auth.api_key)
                .header("POLY-API-SIGN", signature)
                .header("POLY-API-TIMESTAMP", ts)
                .header("POLY-API-PASSPHRASE", &auth.api_passphrase)
                .send().await {
                if let Ok(json) = res.json::<Value>().await {
                    if let Some(bal_str) = json["balance"].as_str() {
                        if let Ok(bal) = bal_str.parse::<f64>() {
                            state.lock().unwrap().balance = bal;
                        }
                    }
                }
            }
        }

        // --- 2. FETCH REAL POSITIONS (DATA API) ---
        let mut open_trades = vec![];
        let mut usd_in_bet = 0.0;
        if !auth.address.is_empty() {
             let url = format!("https://data-api.polymarket.com/positions?user={}", auth.address);
             if let Ok(res) = client.get(&url).send().await {
                 if let Ok(json) = res.json::<Value>().await {
                     if let Some(arr) = json.as_array() {
                         for p in arr {
                             let size = p["size"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                             let avg_price = p["avgPrice"].as_f64().unwrap_or(0.0);
                             let current_price = p["market"].get("currentPrice").and_then(|v| v.as_f64()).unwrap_or(avg_price);
                             let value = size * current_price;
                             if size > 0.0 {
                                 usd_in_bet += value;
                                 open_trades.push(Trade {
                                     id: p["asset"].as_str().unwrap_or("?").to_string(),
                                     question: p["market"].get("question").and_then(|v| v.as_str()).unwrap_or("?").to_string(),
                                     bet_amount: size * avg_price,
                                     entry_prob: avg_price,
                                     current_price,
                                     unrealized_pnl: size * (current_price - avg_price),
                                     slug: p["market"].get("slug").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                 });
                             }
                         }
                     }
                 }
             }
        }

        // --- 3. FETCH REAL TRADES/HISTORY (DATA API) ---
        let mut history = vec![];
        if !auth.address.is_empty() {
            let url = format!("https://data-api.polymarket.com/trades?user={}&limit=20", auth.address);
            if let Ok(res) = client.get(&url).send().await {
                if let Ok(json) = res.json::<Value>().await {
                    if let Some(arr) = json.as_array() {
                        for t in arr {
                            history.push(HistoryEntry {
                                question: t["market"].get("question").and_then(|v| v.as_str()).unwrap_or("?").to_string(),
                                bet_amount: t["size"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0) * t["price"].as_f64().unwrap_or(0.0),
                                pnl: 0.0, // Data API returns trades, not necessarily settlements
                                won: true, // Placeholder
                                time: t["time"].as_str().unwrap_or("?").to_string(),
                            });
                        }
                    }
                }
            }
        }

        // --- 4. SCAN REAL MARKETS (GAMMA) ---
        let mut real_markets = vec![];
        if let Ok(res) = client.get("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50").send().await {
            if let Ok(json) = res.json::<Value>().await {
                if let Some(arr) = json.as_array() {
                    for m in arr {
                        let prob_str = m["outcomePrices"].as_array().and_then(|p| p.get(0)).and_then(|p| p.as_str()).unwrap_or("0.5");
                        let prob = prob_str.parse::<f64>().unwrap_or(0.5);
                        real_markets.push(Market {
                            question: m["question"].as_str().unwrap_or("?").to_string(),
                            category: "Real".to_string(),
                            prob, slug: format!("https://polymarket.com/event/{}", m["slug"].as_str().unwrap_or("")),
                            token_id: Some(m["clobTokenIds"].as_array().and_then(|a| a.get(0)).and_then(|v| v.as_str()).unwrap_or("").to_string()),
                        });
                    }
                }
            }
        }

        {
            let mut s = state.lock().unwrap();
            s.open_trades = open_trades;
            s.usd_in_bet = usd_in_bet;
            if !history.is_empty() { s.history = history; }
            if !real_markets.is_empty() { s.current_markets = real_markets; }
            s.last_sync = Local::now().format("%H:%M:%S").to_string();
            
            let total = s.balance + s.usd_in_bet;
            let time = s.last_sync.clone();
            s.chart_history.push(HistoryPoint { time, total });
            if s.chart_history.len() > 100 { s.chart_history.remove(0); }
        }
        sleep(Duration::from_secs(15)).await;
    }
}
