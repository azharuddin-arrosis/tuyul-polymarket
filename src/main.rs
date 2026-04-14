use axum::{
    extract::State,
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;
use tokio::time::sleep;
use chrono::Local;
use std::net::SocketAddr;
// use dotenv::dotenv;

// --- CORE BOT TYPES ---

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryPoint {
    time: String,
    wallet: f64,
    total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotState {
    id: String,
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

#[derive(Serialize, Deserialize, Clone)]
struct MasterState {
    bots: Vec<BotState>,
}

type SharedState = Arc<Mutex<MasterState>>;


#[tokio::main]
async fn main() {
    let state = Arc::new(Mutex::new(load_state()));

    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    for i in 0..10 {
        let slave_state = Arc::clone(&state);
        let bot_id = bot_names[i].to_string();
        tokio::spawn(async move {
            bot_worker(slave_state, bot_id).await;
        });
    }

    let app = Router::new()
        .route("/", get(get_dashboard))
        .route("/api/status", get(get_status))
        .route("/api/start", post(start_bot))
        .route("/api/stop", post(stop_bot))
        .route("/api/settings", post(update_settings))
        .route("/api/reset_all", post(reset_all_bots))
        .route("/api/start_all", post(start_all_bots))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    use colored::Colorize;
    println!("{} {}", "🚀 PolyBot Farm listening on".bold().green(), addr.to_string().bold().yellow());
    axum::Server::bind(&addr).serve(app.into_make_service()).await.unwrap();
}

async fn get_dashboard() -> Html<&'static str> { Html(include_str!("index.html")) }

const SAVE_FILE: &str = "storage/farm_state.json";

fn load_state() -> MasterState {
    let _ = std::fs::create_dir_all("storage");
    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    if let Ok(content) = std::fs::read_to_string(SAVE_FILE) {
        if let Ok(mut state) = serde_json::from_str::<MasterState>(&content) {
            // Force update names to match current codenames
            for (i, bot) in state.bots.iter_mut().enumerate() {
                if i < bot_names.len() { bot.id = bot_names[i].to_string(); }
            }
            return state;
        }
    }
    
    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    let mut bots = vec![];
    for i in 0..10 {
        let prob = 0.50 + (i as f64 * 0.05);
        bots.push(BotState {
            id: bot_names[i].to_string(),
            balance: 10.0,
            pnl_realized: 0.0, pnl_won: 0.0, pnl_lost: 0.0,
            usd_in_bet: 0.0, open_trades: vec![], history: vec![],
            current_markets: vec![],
            chart_history: vec![],
            min_prob_threshold: (prob * 100.0).round() / 100.0,
            max_bet_cap: 2.5,
            last_sync: "INIT".to_string(), 
            running: false,
        });
    }
    MasterState { bots }
}

async fn get_status(State(state): State<SharedState>) -> impl IntoResponse { Json(state.lock().await.clone()) }

#[derive(Deserialize)]
struct BotAction { id: String }

async fn start_bot(State(state): State<SharedState>, Json(payload): Json<BotAction>) -> impl IntoResponse {
    let mut s = state.lock().await;
    if let Some(bot) = s.bots.iter_mut().find(|b| b.id == payload.id) { bot.running = true; }
    axum::http::StatusCode::OK
}

async fn stop_bot(State(state): State<SharedState>, Json(payload): Json<BotAction>) -> impl IntoResponse {
    let mut s = state.lock().await;
    if let Some(bot) = s.bots.iter_mut().find(|b| b.id == payload.id) { bot.running = false; }
    axum::http::StatusCode::OK
}

#[derive(Deserialize)]
struct SettingsPayload {
    id: String,
    min_prob: f64,
    max_bet: f64,
    reset_balance: Option<f64>,
}

async fn update_settings(State(state): State<SharedState>, Json(p): Json<SettingsPayload>) -> impl IntoResponse {
    let mut s = state.lock().await;
    if let Some(bot) = s.bots.iter_mut().find(|b| b.id == p.id) {
        bot.min_prob_threshold = p.min_prob;
        bot.max_bet_cap = p.max_bet;
        if let Some(bal) = p.reset_balance {
            bot.balance = bal;
            bot.pnl_realized = 0.0; bot.pnl_won = 0.0; bot.pnl_lost = 0.0;
            bot.history.clear(); bot.chart_history.clear(); bot.open_trades.clear();
        }
    }
    axum::http::StatusCode::OK
}

async fn reset_all_bots(State(state): State<SharedState>) -> impl IntoResponse {
    let mut s = state.lock().await;
    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    for i in 0..10 {
        let prob = 0.50 + (i as f64 * 0.05);
        s.bots[i] = BotState {
            id: bot_names[i].to_string(),
            balance: 10.0,
            pnl_realized: 0.0, pnl_won: 0.0, pnl_lost: 0.0,
            usd_in_bet: 0.0, open_trades: vec![], history: vec![],
            current_markets: vec![],
            chart_history: vec![],
            min_prob_threshold: (prob * 100.0).round() / 100.0,
            max_bet_cap: 2.5,
            last_sync: "RESET".to_string(), 
            running: false,
        };
    }
    axum::http::StatusCode::OK
}

#[derive(Deserialize)]
struct StartAllPayload {
    initial_balance: f64,
    min_prob: f64,
    max_prob: f64,
    spread: bool,
}

async fn start_all_bots(State(state): State<SharedState>, Json(p): Json<StartAllPayload>) -> impl IntoResponse {
    let mut s = state.lock().await;
    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    for i in 0..s.bots.len() {
        let bot = &mut s.bots[i];
        bot.id = bot_names[i].to_string(); 
        bot.balance = p.initial_balance;
        
        // Pattern: Distribute odds across 5 pairs from min to max
        let threshold = if p.spread {
            let pair_idx = (i / 2) as f64;
            let range = p.max_prob - p.min_prob;
            let step = if range > 0.0 { range / 4.0 } else { 0.0 };
            (p.min_prob + (pair_idx * step)).min(0.98)
        } else {
            p.min_prob
        };
        
        bot.min_prob_threshold = (threshold * 100.0).round() / 100.0;
        bot.pnl_realized = 0.0; bot.pnl_won = 0.0; bot.pnl_lost = 0.0;
        bot.history.clear(); bot.chart_history.clear(); bot.open_trades.clear();
        bot.running = true;
        bot.last_sync = "START_ALL".to_string();
    }
    axum::http::StatusCode::OK
}

async fn bot_worker(state: SharedState, bot_id: String) {
    use rand::Rng;
    loop {
        {
            let mut master = state.lock().await;
            let bot = match master.bots.iter_mut().find(|b| b.id == bot_id) {
                Some(b) => b,
                None => {
                    eprintln!("⚠️ Warning: Bot {} not found in state!", bot_id);
                    drop(master);
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };
            let mut rng = rand::thread_rng();

            let questions = ["BTC Bullish?", "ETH Pump?", "Trump Wins?", "Fed Pivot?", "Gold ATH?", "AI Peak?"];
            bot.current_markets = (0..500).map(|i| {
                let prob = if rng.gen_bool(0.7) { rng.gen_range(0.40..0.98) } else { rng.gen_range(0.10..0.40) };
                Market {
                    question: format!("{} (#{})", questions[rng.gen_range(0..questions.len())], i),
                    category: "Global".to_string(), prob, slug: format!("https://poly.com/{}", i), token_id: None
                }
            }).collect();
            bot.last_sync = Local::now().format("%H:%M:%S").to_string();

            if bot.running {
                for m in &bot.current_markets {
                    if m.prob >= bot.min_prob_threshold && bot.open_trades.len() < 5 {
                        let bet = (bot.balance.sqrt() * 0.35).min(bot.max_bet_cap);
                        if bot.balance >= (bet + 0.02) {
                            bot.balance -= bet + 0.02; bot.usd_in_bet += bet;
                            bot.open_trades.push(Trade {
                                id: format!("T-{}", rng.gen_range(1000..9999)),
                                question: m.question.clone(), bet_amount: bet, entry_prob: m.prob,
                                current_price: m.prob, is_moonshot: m.prob < 0.65,
                                unrealized_pnl: 0.0, slug: m.slug.clone(),
                            });
                        }
                    }
                }
                let mut resolved = Vec::new();
                for (idx, t) in bot.open_trades.iter_mut().enumerate() {
                    t.current_price = (t.current_price + rng.gen_range(-0.02..0.025)).clamp(0.01, 0.99);
                    let gain = t.current_price / t.entry_prob;
                    t.unrealized_pnl = t.bet_amount * (gain - 1.0);
                    if gain > 1.12 { resolved.push((idx, Some(1.12))); }
                    else if gain < 0.90 { resolved.push((idx, Some(0.90))); }
                    else if rng.gen_bool(0.05) { resolved.push((idx, None)); }
                }
                for (idx, mult) in resolved.into_iter().rev() {
                    let t = bot.open_trades.remove(idx);
                    bot.usd_in_bet -= t.bet_amount;
                    let (won, p) = match mult {
                        Some(m) => (m > 1.0, t.bet_amount * (m - 1.0) * 0.995),
                        None => {
                            let w = rng.gen_bool(t.entry_prob);
                            let p = if w { t.bet_amount * ((1.0 / t.entry_prob).min(4.0) - 1.0) * 0.98 } else { -t.bet_amount * 0.5 };
                            (w, p)
                        }
                    };
                    bot.balance += t.bet_amount + p - 0.02; bot.pnl_realized += p - 0.02;
                    if p > 0.0 { bot.pnl_won += p; } else { bot.pnl_lost += p - 0.02; }
                    bot.history.insert(0, HistoryEntry {
                        question: t.question, bet_amount: t.bet_amount, pnl: p-0.02, won,
                        was_stopped: mult.is_some(), time: Local::now().format("%H:%M").to_string(),
                    });
                }
                let total = bot.balance + bot.usd_in_bet + bot.open_trades.iter().map(|it| it.unrealized_pnl).sum::<f64>();
                let time = bot.last_sync.clone();
                bot.chart_history.push(HistoryPoint { time, wallet: bot.balance, total });
                if bot.chart_history.len() > 100 { bot.chart_history.remove(0); }
            }
            if let Ok(c) = serde_json::to_string_pretty(&*master) { let _ = std::fs::write(SAVE_FILE, c); }
        }
        sleep(Duration::from_secs(3)).await;
    }
}
