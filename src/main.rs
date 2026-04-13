use axum::{
    extract::State,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;
use chrono::Local;

// --- CORE BOT TYPES ---

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Market {
    question: String,
    category: String,
    prob: f64,
    slug: String,
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
    start_time: String,
    is_moonshot: bool, 
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryEntry {
    question: String,
    bet_amount: f64,
    pnl: f64,
    won: bool,
    was_stopped: bool,
    time: String,
    slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryPoint {
    time: String,
    wallet: f64,
    total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotSettings {
    min_prob: f64,
    max_bet: f64,
    reset_balance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotState {
    balance: f64,
    pnl_realized: f64,
    pnl_won: f64,
    pnl_lost: f64,
    usd_in_bet: f64,
    open_trades: Vec<Trade>,
    history: Vec<HistoryEntry>,
    current_markets: Vec<Market>,
    chart_history: Vec<HistoryPoint>,
    min_prob_threshold: f64,
    max_bet_cap: f64,
    last_sync: String,
    running: bool,
}

type SharedState = Arc<Mutex<BotState>>;

// --- API HANDLERS ---

async fn get_status(State(state): State<SharedState>) -> Response {
    let s = state.lock().unwrap();
    Json(s.clone()).into_response()
}

async fn update_settings(State(state): State<SharedState>, Json(settings): Json<BotSettings>) -> Response {
    let mut s = state.lock().unwrap();
    s.min_prob_threshold = settings.min_prob;
    s.max_bet_cap = settings.max_bet;
    if let Some(bal) = settings.reset_balance {
        s.balance = bal;
        s.pnl_realized = 0.0; s.pnl_won = 0.0; s.pnl_lost = 0.0; s.usd_in_bet = 0.0;
        s.open_trades.clear(); s.history.clear();
        s.chart_history = vec![HistoryPoint { time: Local::now().format("%H:%M:%S").to_string(), wallet: bal, total: bal }];
        s.running = false;
    }
    (axum::http::StatusCode::OK, "Applied").into_response()
}

async fn bot_start(State(state): State<SharedState>) -> Response {
    let mut s = state.lock().unwrap();
    s.running = true;
    (axum::http::StatusCode::OK, "Started").into_response()
}

async fn bot_stop(State(state): State<SharedState>) -> Response {
    let mut s = state.lock().unwrap();
    s.running = false;
    (axum::http::StatusCode::OK, "Stopped").into_response()
}

async fn get_dashboard() -> Html<&'static str> { Html(include_str!("index.html")) }

// --- ENGINE v15 ---

async fn bot_worker(state: SharedState) {
    use rand::Rng;
    loop {
        {
            let mut s = state.lock().unwrap();
            let mut rng = rand::thread_rng();
            if s.running {
                s.current_markets = vec![
                    Market { question: "BTC > $100k?".to_string(), category: "Crypto".to_string(), prob: 0.88, slug: "btc-100k".to_string() },
                    Market { question: "Nvidia Up?".to_string(), category: "Stocks".to_string(), prob: 0.81, slug: "nvda-up".to_string() },
                    Market { question: "ETH > $4k?".to_string(), category: "Crypto".to_string(), prob: 0.78, slug: "eth-4k".to_string() },
                    Market { question: "SOL Moonshot?".to_string(), category: "Moonshot".to_string(), prob: 0.42, slug: "sol-moonshot".to_string() },
                    Market { question: "Trump Wins?".to_string(), category: "Politics".to_string(), prob: 0.49, slug: "trump-wins".to_string() },
                ].into_iter().map(|mut m| { m.slug = format!("https://polymarket.com/event/{}", m.slug); m }).collect();
                s.last_sync = Local::now().format("%H:%M:%S").to_string();

                if s.open_trades.len() < 5 && rng.gen_bool(0.3) {
                    let eligible: Vec<Market> = s.current_markets.iter()
                        .filter(|m| m.prob >= s.min_prob_threshold || (m.prob >= 0.35 && m.prob <= 0.55 && rng.gen_bool(0.2)))
                        .cloned().collect();
                    if !eligible.is_empty() {
                        let m = eligible[rng.gen_range(0..eligible.len())].clone();
                        let is_moonshot = m.prob < 0.60;
                        let mut bet = s.balance.sqrt() * 0.316;
                        if is_moonshot { bet *= 0.5; }
                        bet = bet.max(1.0).min(s.max_bet_cap);
                        if s.balance >= bet {
                            s.balance -= bet; s.usd_in_bet += bet;
                            s.open_trades.push(Trade {
                                id: format!("T-{}", rng.gen_range(1000..9999)),
                                question: m.question, bet_amount: bet, entry_prob: m.prob,
                                unrealized_pnl: 0.0, current_price: m.prob, slug: m.slug,
                                start_time: Local::now().format("%H:%M").to_string(), is_moonshot,
                            });
                        }
                    }
                }

                let mut resolved_indices = Vec::new();
                for (idx, trade) in s.open_trades.iter_mut().enumerate() {
                    let delta = rng.gen_range(-0.03..0.03);
                    trade.current_price = (trade.current_price + delta).max(0.01).min(0.99);
                    trade.unrealized_pnl = trade.bet_amount * ((trade.current_price / trade.entry_prob) - 1.0);

                    if trade.current_price < (trade.entry_prob * 0.8) {
                        resolved_indices.push((idx, true)); 
                    } else if rng.gen_bool(0.12) {
                        resolved_indices.push((idx, false)); 
                    }
                }

                for (idx, was_stopped) in resolved_indices.into_iter().rev() {
                    let trade = s.open_trades.remove(idx);
                    s.usd_in_bet -= trade.bet_amount;
                    let (won, pnl) = if was_stopped {
                        (false, -trade.bet_amount * 0.20)
                    } else {
                        let won = rng.gen_bool(trade.entry_prob);
                        let p = if won {
                            let mult = (1.0 / trade.entry_prob).min(4.0);
                            trade.bet_amount * (mult - 1.0) * 0.98
                        } else { -trade.bet_amount };
                        (won, p)
                    };
                    s.balance += trade.bet_amount + pnl; s.pnl_realized += pnl;
                    if pnl > 0.0 { s.pnl_won += pnl; } else { s.pnl_lost += pnl; }
                    s.history.insert(0, HistoryEntry {
                        question: format!("{}{}", if trade.is_moonshot {"🚀 "} else {""}, trade.question),
                        bet_amount: trade.bet_amount, pnl, won, was_stopped, slug: trade.slug,
                        time: Local::now().format("%H:%M").to_string(),
                    });
                    if s.history.len() > 1000 { s.history.pop(); }
                }

                // FIX BORROW CHECKER for Charting
                let time = s.last_sync.clone();
                let wal = s.balance;
                let unrealized_sum: f64 = s.open_trades.iter().map(|t| t.unrealized_pnl).sum();
                let total = wal + s.usd_in_bet + unrealized_sum;
                s.chart_history.push(HistoryPoint { time, wallet: wal, total });
                if s.chart_history.len() > 200 { s.chart_history.remove(0); }
            }
        }
        sleep(Duration::from_secs(3)).await;
    }
}

#[tokio::main]
async fn main() {
    let state = Arc::new(Mutex::new(BotState {
        balance: 100.0, pnl_realized: 0.0, pnl_won: 0.0, pnl_lost: 0.0,
        usd_in_bet: 0.0, open_trades: vec![], history: vec![], current_markets: vec![],
        chart_history: vec![HistoryPoint { time: "0".to_string(), wallet: 100.0, total: 100.0 }],
        min_prob_threshold: 0.85, max_bet_cap: 25.0,
        last_sync: "WAITING".to_string(), running: false,
    }));
    let bot_state = Arc::clone(&state);
    tokio::spawn(async move { bot_worker(bot_state).await; });
    let app = Router::new().route("/", get(get_dashboard)).route("/api/status", get(get_status)).route("/api/settings", post(update_settings)).route("/api/start", post(bot_start)).route("/api/stop", post(bot_stop)).with_state(state);
    axum::Server::bind(&std::net::SocketAddr::from(([0,0,0,0], 8080))).serve(app.into_make_service()).await.unwrap();
}
