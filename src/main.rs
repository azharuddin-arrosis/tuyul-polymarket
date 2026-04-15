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
use reqwest;
use dotenv::dotenv;

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
struct WithdrawLog {
    time: String,
    amount: f64,
    total_equity: f64,
    count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BotState {
    id: String,
    balance: f64,
    initial_balance: f64,
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
    #[serde(default)]
    auto_scale: bool,
    #[serde(default)]
    target_capital: f64,
    #[serde(default = "default_scaling")]
    scaling_interval: f64,
    #[serde(default)]
    last_notified_equity: f64,
    #[serde(default)]
    unallocated_balance: f64,
    #[serde(default)]
    withdraw_pending: bool,
    #[serde(default)]
    withdraw_logs: Vec<WithdrawLog>,
    #[serde(default)]
    farm_capital: f64,
    #[serde(default)]
    vault_balance: f64,
    #[serde(default)]
    auto_harvest: bool,
}
fn default_scaling() -> f64 { 10.0 }

type SharedState = Arc<Mutex<MasterState>>;


#[tokio::main]
async fn main() {
    dotenv().ok(); // Load credentials from .env
    let state = Arc::new(Mutex::new(load_state()));

    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    for i in 0..10 {
        let slave_state = Arc::clone(&state);
        let bot_id = bot_names[i].to_string();
        tokio::spawn(async move {
            bot_worker(slave_state, bot_id).await;
        });
    }

    // --- AUTO SCALING & BAILOUT ENGINE ---
    let monitor_state = Arc::clone(&state);
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(10)).await;
            let mut s = monitor_state.lock().await;

            if s.withdraw_pending {
                // Background Monitor Phase 2: Wait until all trades close
                let all_empty = s.bots.iter().all(|b| b.open_trades.is_empty());
                
                if all_empty {
                    // Kalkulasi Aktual (Settlement)
                    let total_equity: f64 = s.bots.iter().map(|b| b.balance + b.usd_in_bet).sum::<f64>() + s.unallocated_balance;
                    
                    let base_capital = if s.farm_capital > 0.0 { s.farm_capital } else { 100.0 };
                    let profit = (total_equity - base_capital).max(0.0);
                    
                    let gajian = profit * 0.8;
                    let bot_growth = profit * 0.2;
                    
                    s.farm_capital = base_capital + bot_growth;
                    let per_bot = s.farm_capital / 10.0;
                    
                    for i in 0..10 {
                        s.bots[i].balance = per_bot;
                        s.bots[i].initial_balance = per_bot;
                        s.bots[i].pnl_realized = 0.0;
                        s.bots[i].pnl_won = 0.0;
                        s.bots[i].pnl_lost = 0.0;
                        s.bots[i].history.clear();
                        s.bots[i].running = true; // RESTART
                    }
                    s.unallocated_balance = 0.0;
                    s.withdraw_pending = false;
                    s.vault_balance += gajian;

                    let log_count = s.withdraw_logs.len() + 1;
                    s.withdraw_logs.insert(0, WithdrawLog {
                        time: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                        amount: gajian,
                        total_equity,
                        count: log_count,
                    });
                    
                    // 5. Save State
                    save_state(&s);

                    // 6. Final Notification
                    let idr_rate = get_idr_rate().await;
                    let msg = format!(
                        "💰 *QUANTUM FARM: GAJIAN BERHASIL!*\n\n\
                        🏦 *Secured Profit Vault:* ${:.2} (Rp {:.*})\n\
                        🎉 *Gajian Masuk (80%):* ${:.2} (Rp {:.*})\n\
                        ---------------------------\n\
                        📈 *Total Equity Closed:* ${:.2} (Rp {:.*})\n\
                        🛡️ *Pertumbuhan Modal (20%):* ${:.2} (Rp {:.*})\n\
                        🚀 *Modal Farm Baru:* ${:.2} (Rp {:.*})\n\n\
                        _Semua bot telah di-reset dan aktif kembali otomatis._",
                        s.vault_balance, 0, (s.vault_balance * idr_rate) as i64,
                        gajian, 0, (gajian * idr_rate) as i64,
                        total_equity, 0, (total_equity * idr_rate) as i64,
                        bot_growth, 0, (bot_growth * idr_rate) as i64,
                        s.farm_capital, 0, (s.farm_capital * idr_rate) as i64
                    );
                    let _ = send_telegram_msg(&msg).await;
                    println!("✅ [WITHDRAW] Settlement complete. Log #{} inserted. Vault: ${:.2}", log_count, s.vault_balance);
                }
                continue; // Jangan jalankan auto-scale jika sedang withdraw
            }

            if s.auto_scale {
                // 1. Calculate Farm Metrics
                let mut total_equity: f64 = s.bots.iter().map(|b| {
                    let unrealized: f64 = b.open_trades.iter().map(|t| t.unrealized_pnl).sum();
                    b.balance + b.usd_in_bet + unrealized
                }).sum();
                total_equity += s.unallocated_balance;

                let active_count = s.bots.iter().filter(|b| b.running).count();
                let possible_bots = (total_equity / s.scaling_interval).floor() as usize;
                let possible_bots = possible_bots.clamp(1, 10);
                
                // 2. Identify Bailout Needs
                let mut needs_bailout = false;
                if active_count > 0 {
                    for i in 0..10 {
                        let b = &s.bots[i];
                        if b.running && b.balance < 2.0 {
                            needs_bailout = true;
                            break;
                        }
                    }
                }

                // 3. Decision Tree: Scale Up vs Soft Bailout
                if possible_bots > active_count && active_count > 0 && possible_bots <= 10 {
                    // --- HARD SCALE UP ---
                    // Triggered when total equity justifies a new bot instance
                    println!("🚀 [AUTO-SCALE] Leveling Up! Equity: ${:.2}, Active: {}, Next Target: {} Bots", total_equity, active_count, possible_bots);
                    
                    let target_count = possible_bots;
                    let per_bot_bal = s.scaling_interval;
                    
                    for i in 0..10 {
                        let bot = &mut s.bots[i];
                        if i < target_count {
                            if !bot.running {
                                // It's a brand new bot or a previously stopped one
                                bot.history.clear(); bot.open_trades.clear(); bot.chart_history.clear();
                                bot.pnl_realized = 0.0; bot.pnl_won = 0.0; bot.pnl_lost = 0.0;
                                bot.usd_in_bet = 0.0;
                                bot.running = true;
                                println!("✨ [FARM] Instance {} Activated.", bot.id);
                            }
                            // Re-normalize everyone's working capital
                            bot.balance = per_bot_bal - bot.usd_in_bet;
                            bot.initial_balance = per_bot_bal;
                            bot.last_sync = "SCALED".to_string();
                        } else {
                            bot.balance = 0.0;
                            bot.running = false;
                        }
                    }
                    
                    let deployed_capital = (target_count as f64) * s.scaling_interval;
                    s.unallocated_balance = (total_equity - deployed_capital).max(0.0);
                    save_state(&s);
                } else if needs_bailout && active_count > 0 {
                    // --- SOFT BAILOUT / PROFIT REDISTRIBUTION ---
                    // Inject liquidity from winners to losers WITHOUT resetting their history/trades
                    println!("💸 [BAILOUT] Emergency Liquidity Injection! Redistributing profit to save struggling bots...");
                    
                    let total_liquid: f64 = s.bots.iter().filter(|b| b.running).map(|b| b.balance).sum::<f64>() + s.unallocated_balance;
                    let per_bot_liquid = total_liquid / (active_count as f64);
                    s.unallocated_balance = 0.0;
                    
                    for i in 0..10 {
                        if s.bots[i].running {
                            let old_bal = s.bots[i].balance;
                            s.bots[i].balance = per_bot_liquid;
                            if old_bal < 2.0 {
                                s.bots[i].last_sync = "REFILLED".to_string();
                                println!("🩹 [BAILOUT] Bot {} refilled from ${:.2} to ${:.2}", s.bots[i].id, old_bal, per_bot_liquid);
                            }
                        }
                    }
                    save_state(&s);
                }

                // --- NEW: HARVEST TELEGRAM NOTIFICATION (2:8 Strategy) ---
                if active_count >= 10 {
                    let threshold_step = 100.0;
                    if total_equity >= s.last_notified_equity + threshold_step {
                        let total_profit = total_equity - s.farm_capital; 
                        let owner_share = total_profit * 0.8;
                        let bot_growth = total_profit * 0.2;
                        
                        s.last_notified_equity = (total_equity / threshold_step).floor() * threshold_step;
                        
                        let msg = format!(
                            "🔔 *QUANTUM FARM HARVEST ALERT!*\n\n\
                            🚀 Keuntungan baru terdeteksi!\n\
                            💰 *Total Equity:* ${:.2}\n\
                            📈 *Total Profit:* ${:.2}\n\
                            ---------------------------\n\
                            🟢 *Jatah Gajian (80%):* ${:.2}\n\
                            🔵 *Bot Growth (20%):* ${:.2}\n\
                            ---------------------------\n\
                            _Waktunya panen mingguan!_",
                            total_equity, total_profit, owner_share, bot_growth
                        );
                        let _ = send_telegram_msg(&msg).await;
                        save_state(&s);
                    }

                    // --- NEW: READY TO HARVEST (2X MODAL) NOTIFICATION ---
                    if total_equity >= s.farm_capital * 2.0 && !s.withdraw_pending {
                        // We use a simple check to avoid spamming: only if last_notified_equity is less than 2x
                        if s.last_notified_equity < s.farm_capital * 2.0 {
                            s.last_notified_equity = s.farm_capital * 2.0;

                            let profit = total_equity - s.farm_capital;
                            let gajian = profit * 0.8;
                            let growth = profit * 0.2;

                            let msg = format!(
                                "🎊 *QUANTUM FARM: READY TO HARVEST!*\n\n\
                                💰 *Total Equity:* ${:.2}\n\
                                🎯 *Target 2X Modal:* ${:.2}\n\n\
                                💵 *Potensi Gajian (80%):* ${:.2}\n\
                                🛡️ *Bot Growth (20%):* ${:.2}\n\n\
                                _Silahkan klik tombol 'PROSES WITHDRAW GAJIAN' di dashboard._",
                                total_equity, s.farm_capital * 2.0, gajian, growth
                            );
                            let _ = send_telegram_msg(&msg).await;
                            println!("📢 [NOTIFY] Ready to harvest alert sent.");
                            save_state(&s);
                        }
                    }

                    // --- MANDATORY AUTO-HARVEST TRIGGER ---
                    if total_equity >= s.farm_capital * 2.0 && !s.withdraw_pending {
                        s.withdraw_pending = true;
                        let msg = format!(
                            "🤖 *AUTO-HARVEST TRIGGERED!*\n\n\
                            🎯 Target 2x modal tercapai (${:.2})\n\
                            💰 Total Equity saat ini: ${:.2}\n\n\
                            _Sistem otomatis mengamankan keuntungan ke Vault..._",
                            s.farm_capital * 2.0, total_equity
                        );
                        let _ = send_telegram_msg(&msg).await;
                        save_state(&s);
                    }
                }
            }
        }
    });

    let app = Router::new()
        .route("/", get(get_dashboard))
        .route("/api/status", get(get_status))
        .route("/api/start", post(start_bot))
        .route("/api/stop", post(stop_bot))
        .route("/api/settings", post(update_settings))
        .route("/api/reset_all", post(reset_all_bots))
        .route("/api/start_all", post(start_all_bots))
        .route("/api/toggle_auto_harvest", post(toggle_auto_harvest))
        .route("/api/prepare_withdraw", post(prepare_withdraw))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    use colored::Colorize;
    println!("{} {}", "🚀 PolyBot Farm listening on".bold().green(), addr.to_string().bold().yellow());
    axum::Server::bind(&addr).serve(app.into_make_service()).await.unwrap();
}

async fn get_dashboard() -> Html<&'static str> { Html(include_str!("index.html")) }

const SAVE_FILE: &str = "storage/farm_state.json";

fn save_state(state: &MasterState) {
    if let Ok(content) = serde_json::to_string_pretty(state) {
        let temp_file = format!("{}.tmp", SAVE_FILE);
        if std::fs::write(&temp_file, content).is_ok() {
            let _ = std::fs::rename(temp_file, SAVE_FILE);
        }
    }
}


fn load_state() -> MasterState {
    let _ = std::fs::create_dir_all("storage");
    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    if let Ok(content) = std::fs::read_to_string(SAVE_FILE) {
        if let Ok(mut state) = serde_json::from_str::<MasterState>(&content) {
            println!("📂 [SYSTEM] Farm state loaded successfully from disk.");
            // Force update names to match current codenames
            for (i, bot) in state.bots.iter_mut().enumerate() {
                if i < bot_names.len() { bot.id = bot_names[i].to_string(); }
            }
            return state;
        } else {
            eprintln!("⚠️ [ERROR] Failed to parse farm_state.json. File might be corrupted.");
        }
    } else {
        println!("🆕 [SYSTEM] No existing farm state found. Initializing defaults.");
    }
    
    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    let mut bots = vec![];
    for i in 0..10 {
        let pair_idx = (i / 2) as f64;
        let prob = (0.50 + (pair_idx * 0.05)).min(0.70);
        bots.push(BotState {
            id: bot_names[i].to_string(),
            balance: 0.0,
            initial_balance: 0.0,
            pnl_realized: 0.0, pnl_won: 0.0, pnl_lost: 0.0,
            usd_in_bet: 0.0, open_trades: vec![], history: vec![],
            current_markets: vec![],
            chart_history: vec![],
            min_prob_threshold: (prob * 100.0).round() / 100.0,
            max_bet_cap: 3.0,
            last_sync: "INIT".to_string(), 
            running: false,
        });
    }
    MasterState { 
        bots, 
        auto_scale: false, 
        target_capital: 0.0, 
        scaling_interval: 10.0, 
        last_notified_equity: 0.0, 
        unallocated_balance: 0.0,
        withdraw_pending: false,
        withdraw_logs: vec![],
        farm_capital: 100.0,
        vault_balance: 0.0,
        auto_harvest: true,
    }
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
        bot.max_bet_cap = p.max_bet.max(1.0);
        if let Some(bal) = p.reset_balance {
            bot.balance = bal;
            bot.initial_balance = bal;
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
        let pair_idx = (i / 2) as f64;
        let prob = (0.50 + (pair_idx * 0.05)).min(0.70);
        s.bots[i] = BotState {
            id: bot_names[i].to_string(),
            balance: 0.0,
            initial_balance: 0.0,
            pnl_realized: 0.0, pnl_won: 0.0, pnl_lost: 0.0,
            usd_in_bet: 0.0, open_trades: vec![], history: vec![],
            current_markets: vec![],
            chart_history: vec![],
            min_prob_threshold: (prob * 100.0).round() / 100.0,
            max_bet_cap: 3.0,
            last_sync: "RESET".to_string(), 
            running: false,
        };
    }
    s.auto_scale = false;
    s.target_capital = 0.0;
    s.farm_capital = 0.0;
    s.last_notified_equity = 0.0;
    s.unallocated_balance = 0.0;
    s.withdraw_pending = false;
    s.withdraw_logs.clear();
    s.vault_balance = 0.0;
    s.auto_harvest = false;

    save_state(&s);
    println!("🧹 [RESET] All bots and farm metrics have been reset.");
    axum::http::StatusCode::OK
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct StartAllPayload {
    total_capital: f64,
    min_prob: f64,
    max_prob: f64,
    spread: bool,
    auto_scale: bool,
    #[serde(default = "default_scaling")]
    scaling_interval: f64,
}

async fn start_all_bots(State(state): State<SharedState>, Json(p): Json<StartAllPayload>) -> impl IntoResponse {
    let mut s = state.lock().await;
    s.withdraw_pending = false; // Reset withdraw flag when starting all
    s.auto_scale = p.auto_scale;
    s.target_capital = p.total_capital;
    s.farm_capital = p.total_capital; // Initialize current expected farm capital
    s.last_notified_equity = p.total_capital; 
    s.scaling_interval = p.scaling_interval;

    let bot_names = ["VORTEX", "PHANTOM", "TITAN", "REAPER", "NEON", "KRAKEN", "QUANTUM", "APOLLO", "ZENITH", "HYDRA"];
    let num_bots = (p.total_capital / p.scaling_interval).floor() as usize;
    let num_bots = num_bots.clamp(1, 10);
    let per_bot_bal = p.scaling_interval;
    
    s.unallocated_balance = p.total_capital - ((num_bots as f64) * p.scaling_interval);

    for i in 0..s.bots.len() {
        let bot = &mut s.bots[i];
        bot.id = bot_names[i].to_string(); 
        bot.history.clear(); bot.chart_history.clear(); bot.open_trades.clear();
        bot.pnl_realized = 0.0; bot.pnl_won = 0.0; bot.pnl_lost = 0.0;
        bot.usd_in_bet = 0.0;

        if i < num_bots {
            bot.balance = per_bot_bal;
            bot.initial_balance = per_bot_bal;
            bot.running = true;
            
            // Threshold: 52% for bots 0-4, 57% for bots 5-9
            bot.min_prob_threshold = if i < 5 { 0.52 } else { 0.57 };
            bot.max_bet_cap = 2.0;
            
            bot.last_sync = "START_ALL".to_string();
        } else {
            bot.balance = 0.0;
            bot.initial_balance = 0.0;
            bot.running = false;
        }
    }
    axum::http::StatusCode::OK
}

async fn toggle_auto_harvest(State(state): State<SharedState>) -> impl IntoResponse {
    let mut s = state.lock().await;
    s.auto_harvest = true; // MANDATORY
    save_state(&s);
    Json(serde_json::json!({ "auto_harvest": true }))
}

async fn prepare_withdraw(State(state): State<SharedState>) -> impl IntoResponse {
    let mut s = state.lock().await;
    
    s.withdraw_pending = true;

    save_state(&s);
    
    let msg = format!(
        "📤 *PROSES WITHDRAW GAJIAN INITIATED*\n\n\
        🤖 *Status:* Semua bot berhenti ambil posisi baru.\n\
        Menunggu semua open trades diclose secara natural..."
    );
    let _ = send_telegram_msg(&msg).await;
    println!("📤 [WITHDRAW] Withdrawal process initiated by user.");

    axum::http::StatusCode::OK
}

async fn bot_worker(state: SharedState, bot_id: String) {
    use rand::{Rng, SeedableRng};
    use rand::rngs::StdRng;
    use rand::RngCore;
    loop {
        // Pre-generate random values before any await
        let mut seed = [0u8; 32];
        StdRng::from_entropy().fill_bytes(&mut seed);
        let mut rng = StdRng::from_seed(seed);
        
        {
            let mut master = state.lock().await;
            let withdraw_pending = master.withdraw_pending;
            let bot = match master.bots.iter_mut().find(|b| b.id == bot_id) {
                Some(b) => b,
                None => {
                    eprintln!("⚠️ Warning: Bot {} not found in state!", bot_id);
                    drop(master);
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };
            let questions = ["BTC Bullish?", "ETH Bakal Naik?", "Trump Menang?", "Fed Pivot?", "Emas ATH?", "AI Peak?"];
            
            // Fetch real markets from Gamma API
            let mut real_markets = vec![];
            if let Ok(res) = reqwest::get("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100").await {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(arr) = json.as_array() {
                        for m in arr {
                            let prob_str = m["outcomePrices"].as_str().unwrap_or("0.5");
                            let prices: Vec<f64> = prob_str.trim_start_matches('[')
                                .trim_end_matches(']')
                                .split(',')
                                .filter_map(|s| s.trim().trim_matches('"').parse::<f64>().ok())
                                .collect();
                            let prob = prices.get(0).copied().unwrap_or(0.5);
                            if prob >= 0.02 && prob <= 0.98 {
                                let question = m["question"].as_str().unwrap_or("?").to_string();
                                let lower_q = question.to_lowercase();
                                if lower_q.contains("bitcoin") || lower_q.contains("btc") || 
                                   lower_q.contains("crypto") || lower_q.contains("football") || 
                                   lower_q.contains("soccer") || lower_q.contains("premier league") {
                                    real_markets.push(Market {
                                        question,
                                        category: if lower_q.contains("bitcoin") || lower_q.contains("btc") || lower_q.contains("crypto") {
                                            "Crypto".to_string()
                                        } else {
                                            "Soccer".to_string()
                                        },
                                        prob,
                                        slug: format!("https://polymarket.com/event/{}", m["slug"].as_str().unwrap_or("")),
                                        token_id: Some(m["clobTokenIds"].as_str().unwrap_or("").to_string()),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            
            // Fallback to synthetic if API fails
            if real_markets.is_empty() {
                bot.current_markets = (0..500).map(|i| {
                    let prob = if rng.gen_bool(0.7) { rng.gen_range(0.40..0.98) } else { rng.gen_range(0.10..0.40) };
                    Market {
                        question: format!("{} (#{})", questions[rng.gen_range(0..questions.len())], i),
                        category: "Global".to_string(), prob, slug: format!("https://poly.com/{}", i), token_id: None
                    }
                }).collect();
            } else {
                bot.current_markets = real_markets;
            }
            bot.last_sync = Local::now().format("%H:%M:%S").to_string();

            if bot.running {
                // Check if we should enter new trades
                if !withdraw_pending {
                    // Filter: Crypto (BTC) or Soccer only
                    let valid_markets: Vec<_> = bot.current_markets.iter()
                        .filter(|m| m.category == "Crypto" || m.category == "Soccer")
                        .collect();
                    
                    for m in valid_markets {
                        if m.prob >= bot.min_prob_threshold && bot.open_trades.len() < 3 {
                            let gas_fee = 0.03;
                            let bet = (bot.balance.sqrt() * 0.35).max(1.0).min(bot.max_bet_cap);
                            let total_cost = bet + gas_fee;
                            if bot.balance >= total_cost {
                                bot.balance -= total_cost; bot.usd_in_bet += bet;
                                bot.open_trades.push(Trade {
                                    id: format!("T-{}", rng.gen_range(1000..9999)),
                                    question: m.question.clone(), bet_amount: bet, entry_prob: m.prob,
                                    current_price: m.prob, is_moonshot: m.prob < 0.65,
                                    unrealized_pnl: 0.0, slug: m.slug.clone(),
                                });
                            }
                        }
                    }
                } else {
                    // Withdraw is pending, if no open trades, stop the bot
                    if bot.open_trades.is_empty() {
                        bot.running = false;
                        println!("🛑 [WITHDRAW] Bot {} gracefully stopped.", bot.id);
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
                
                // Periodic save every ~30 seconds (every 10th iteration)
                static SAVE_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
                let count = SAVE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if count % 10 == 0 {
                    save_state(&master);
                }
            }
        }
        sleep(Duration::from_secs(3)).await;
    }
}

async fn send_telegram_msg(msg: &str) -> Result<(), Box<dyn std::error::Error>> {
    let token = std::env::var("TELEGRAM_TOKEN").unwrap_or_default();
    let chat_id = std::env::var("TELEGRAM_CHAT_ID").unwrap_or_default();
    if token.is_empty() || chat_id.is_empty() { return Ok(()); }
    
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let client = reqwest::Client::new();
    let res = client.post(url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": msg,
            "parse_mode": "Markdown"
        }))
        .send()
        .await;
    
    match res {
        Ok(resp) => {
            if !resp.status().is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                eprintln!("❌ Telegram API Error: {}", err_text);
            }
        },
        Err(e) => eprintln!("❌ Failed to send Telegram message: {}", e),
    }
    
    Ok(())
}

async fn get_idr_rate() -> f64 {
    if let Ok(res) = reqwest::get("https://api.coingecko.com/api/v3/simple/price?ids=usd-idr&vs_currencies=idr").await {
        if let Ok(json) = res.json::<serde_json::Value>().await {
            if let Some(rate) = json.get("usd-idr").and_then(|v| v.get("idr")).and_then(|v| v.as_f64()) {
                return rate;
            }
        }
    }
    if let Ok(res) = reqwest::get("https://api.exchangerate-api.com/v4/latest/USD").await {
        if let Ok(json) = res.json::<serde_json::Value>().await {
            if let Some(rate) = json.get("rates").and_then(|v| v.get("IDR")).and_then(|v| v.as_f64()) {
                return rate;
            }
        }
    }
    16200.0
}
