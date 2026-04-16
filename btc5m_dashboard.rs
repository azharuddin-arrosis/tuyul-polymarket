use axum::{
    extract::State,
    response::Html,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use std::net::SocketAddr;
use std::fs;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct Trade {
    title: String,
    side: String,
    size: f64,
    price: f64,
    timestamp: u64,
    outcome: String,
    slug: String,
    icon: String,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct ClosedPosition {
    title: String,
    slug: String,
    outcome: String,
    #[serde(rename = "avgPrice")] avg_price: f64,
    #[serde(rename = "totalBought")] total_bought: f64,
    #[serde(rename = "realizedPnl")] realized_pnl: f64,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[allow(dead_code)]
struct Market {
    slug: String,
    icon: Option<String>,
    #[serde(rename = "outcomePrices")] outcome_prices: Option<String>,
}

#[derive(Clone)]
struct AppState {
    user_address: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SimulateTrade {
    slug: String,
    outcome: String,
    amount: f64,
    price: f64,
    pnl: f64,
    timestamp: u64,
    gas_cost: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SimSettings {
    usdc_balance: f64,
    matic_balance: f64,
    bet_size: f64,
    gas_price: f64,
    auto_mode: bool,
    threshold_above: f64,
    threshold_below: f64,
    last_trade_timestamp: u64,
}

impl Default for SimSettings {
    fn default() -> Self {
        Self {
            usdc_balance: 100.0,
            matic_balance: 0.5,
            bet_size: 1.0,
            gas_price: 0.001,
            auto_mode: false,
            threshold_above: 0.52,
            threshold_below: 0.48,
            last_trade_timestamp: 0,
        }
    }
}

struct DashboardState {
    app: AppState,
    simulate_history: std::sync::Mutex<Vec<SimulateTrade>>,
    sim_settings: std::sync::Mutex<SimSettings>,
}

impl Clone for DashboardState {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            simulate_history: std::sync::Mutex::new(Vec::new()),
            sim_settings: std::sync::Mutex::new(SimSettings::default()),
        }
    }
}

fn get_time_from_slug(slug: &str) -> String {
    if let Some(ts) = slug.split('-').last() {
        if let Ok(ts) = ts.parse::<i64>() {
            if let Some(dt) = chrono::DateTime::from_timestamp(ts, 0) {
                return dt.format("%H:%M").to_string();
            }
        }
    }
    "-".to_string()
}

fn get_countdown(slug: &str) -> String {
    if let Some(ts) = slug.split('-').last() {
        if let Ok(end_ts) = ts.parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            let remaining = end_ts - now;
            if remaining > 0 {
                let mins = remaining / 60;
                let secs = remaining % 60;
                return format!("{:02}:{:02}", mins, secs);
            } else {
                return "ENDED".to_string();
            }
        }
    }
    "--:--".to_string()
}

fn get_end_timestamp(slug: &str) -> u64 {
    if let Some(ts) = slug.split('-').last() {
        if let Ok(end_ts) = ts.parse::<u64>() {
            return end_ts;
        }
    }
    0
}

use reqwest::Client;

async fn fetch_btc5m_markets() -> Vec<Market> {
    let client = Client::new();
    let url = "https://gamma-api.polymarket.com/markets?active=true&limit=50&order=mkt_open_time&direction=desc";
    
    let mut markets = Vec::new();
    
    if let Ok(resp) = client.get(url).send().await {
        if let Ok(m) = resp.json::<Vec<serde_json::Value>>().await {
            for market in m {
                let slug = market.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                if slug.contains("btc-updown-5m") {
                    let out_prices = market.get("outcomePrices")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                        
                    markets.push(Market {
                        slug: slug.to_string(),
                        icon: market.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        outcome_prices: out_prices,
                    });
                }
            }
        }
    }

    // Sort by timestamp
    markets.sort_by(|a, b| {
        let ts_a = a.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let ts_b = b.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        ts_a.cmp(&ts_b)
    });

    let now = chrono::Utc::now().timestamp();
    markets.retain(|m| {
        let ts = m.slug.split('-').last().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        ts > now
    });

    markets.truncate(5);
    markets
}

async fn dashboard_handler(State(state): State<Arc<DashboardState>>) -> Html<String> {
    let _user = state.app.user_address.clone();
    
    // FETCH REAL MARKETS DIRECTLY FROM API!
    let markets = fetch_btc5m_markets().await;
    let current_time = chrono::Utc::now().timestamp() as u64;
    let mut settings = state.sim_settings.lock().unwrap();
    
    if settings.auto_mode && !markets.is_empty() {
        let time_since_last = current_time.saturating_sub(settings.last_trade_timestamp);
        
        // Only trade once per 5 minutes (300 seconds)
        if time_since_last >= 300 {
            let m = &markets[0]; // Trade on first market
            let prices: Vec<String> = serde_json::from_str(m.outcome_prices.as_ref().unwrap_or(&"[]".to_string())).unwrap_or_default();
            let yes_price = prices.get(0).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.5);
            
            let should_trade = yes_price >= settings.threshold_above || yes_price <= settings.threshold_below;
            
            if should_trade {
                let outcome = if yes_price >= settings.threshold_above { "Yes" } else { "No" };
                let pnl = if outcome == "Yes" {
                    settings.bet_size * (1.0 - yes_price) - settings.gas_price
                } else {
                    -settings.bet_size * yes_price - settings.gas_price
                };
                
                let trade = SimulateTrade {
                    slug: m.slug.clone(),
                    outcome: outcome.to_string(),
                    amount: settings.bet_size,
                    price: yes_price,
                    pnl,
                    timestamp: current_time,
                    gas_cost: settings.gas_price,
                };
                
                state.simulate_history.lock().unwrap().push(trade);
                settings.last_trade_timestamp = current_time;
                settings.usdc_balance += pnl;
                settings.matic_balance -= settings.gas_price;
                
                println!("[AUTO-SIMULATE] {} {} ${:.2} price={:.3} -> P&L: {:.2}", m.slug, outcome, settings.bet_size, yes_price, pnl);
            }
        }
    }
    let settings = settings.clone();
    drop(settings);
    
    let closed_pos: Vec<ClosedPosition> = fs::read_to_string("./data/closed.json")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    
    let open_pos: Vec<ClosedPosition> = fs::read_to_string("./data/positions.json")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    
    let profile_name = "arrosis-azharuddin";
    
    // STATS
    let total_pnl: f64 = closed_pos.iter().map(|p| p.realized_pnl).sum();
    let total_trades = closed_pos.len();
    let wins = closed_pos.iter().filter(|p| p.realized_pnl > 0.0).count();
    let loss = closed_pos.iter().filter(|p| p.realized_pnl < 0.0).count();
    let win_rate = if total_trades > 0 { wins as f64 / total_trades as f64 * 100.0 } else { 0.0 };
    let avg_win = if wins > 0 { closed_pos.iter().filter(|p| p.realized_pnl > 0.0).map(|p| p.realized_pnl).sum::<f64>() / wins as f64 } else { 0.0 };
    let avg_loss = if loss > 0 { closed_pos.iter().filter(|p| p.realized_pnl < 0.0).map(|p| p.realized_pnl).sum::<f64>().abs() / loss as f64 } else { 0.0 };
    
    let pnl_color = if total_pnl > 0.0 { "#10b981" } else { "#ef4444" };
    let win_bar_width = win_rate as i32;
    
    // MARKET HTML
    let mut market_html = String::new();
    let default_icon = "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png".to_string();
    
    for m in markets.iter() {
        let time = get_time_from_slug(&m.slug);
        let countdown = get_countdown(&m.slug);
        let icon_url = m.icon.as_ref().unwrap_or(&default_icon);
        
        let prices: Vec<String> = serde_json::from_str(m.outcome_prices.as_ref().unwrap_or(&"[]".to_string())).unwrap_or_default();
        let yes_price = prices.get(0).map(|s| format!("{:.1}%", s.parse::<f64>().unwrap_or(0.0) * 100.0)).unwrap_or_else(|| "-".to_string());
        let no_price = prices.get(1).map(|s| format!("{:.1}%", s.parse::<f64>().unwrap_or(0.0) * 100.0)).unwrap_or_else(|| "-".to_string());
        
        let price_val = prices.get(0).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.5);
        
        market_html.push_str(&format!(
            "<tr><td style=\"text-align:center\"><img src=\"{}\" style=\"width:24px;height:24px;border-radius:4px\"></td>\
            <td>{}</td><td class=\"countdown\" data-end=\"{}\" style=\"color:#f59e0b;font-weight:bold\">{}</td>\
            <td><a href=\"https://polymarket.com/event/{}?t=5m\" target=\"_blank\" style=\"color:#10b981\">BTC 5m</a></td>\
            <td style=\"color:#10b981\">Yes {}</td><td style=\"color:#ef4444\">No {}</td>\
            <td><form action=\"/simulate\" method=\"POST\" style=\"display:inline\"><input type=\"hidden\" name=\"slug\" value=\"{}\"><input type=\"hidden\" name=\"outcome\" value=\"Yes\"><input type=\"hidden\" name=\"amount\" value=\"1\"><input type=\"hidden\" name=\"price\" value=\"{}\"><button type=\"submit\" class=\"btn btn-yes\" style=\"padding:2px 6px;font-size:10px\">Buy</button></form></td></tr>",
            icon_url, time, get_end_timestamp(&m.slug), countdown, m.slug, yes_price, no_price, m.slug, price_val
        ));
    }
    
    if market_html.is_empty() {
        market_html.push_str("<tr><td colspan=\"6\" style=\"text-align:center\">No active market</td></tr>");
    }
    
    // ACTIVITY HTML - SHOW SIMULATE HISTORY
    let sim_history = state.simulate_history.lock().unwrap();
    let mut activity_html = String::new();
    for p in sim_history.iter().rev().take(20) {
        let status = if p.pnl > 0.0 { "WIN" } else { "LOSS" };
        let status_color = if p.pnl > 0.0 { "#10b981" } else { "#ef4444" };
        let pnl_str = if p.pnl > 0.0 {
            format!("+${:.2}", p.pnl)
        } else {
            format!("-${:.2}", p.pnl.abs())
        };
        
        activity_html.push_str(&format!(
            "<tr><td style=\"text-align:center\"><img src=\"{}\" style=\"width:20px;height:20px;border-radius:4px\"></td>\
            <td>{}</td><td><a href=\"https://polymarket.com/event/{}?t=5m\" target=\"_blank\">{}</a></td>\
            <td>{}</td><td style=\"color:{}\">{}</td><td style=\"color:{}\">{}</td></tr>",
            default_icon, 
            chrono::DateTime::from_timestamp(p.timestamp as i64, 0).map(|dt| dt.format("%H:%M").to_string()).unwrap_or("-".to_string()),
            p.slug, 
            chrono::DateTime::from_timestamp(p.timestamp as i64, 0).map(|dt| dt.format("%H:%M").to_string()).unwrap_or("-".to_string()),
            p.outcome, status_color, status, status_color, pnl_str
        ));
    }
    
    if activity_html.is_empty() {
        activity_html.push_str("<tr><td colspan=\"6\" style=\"text-align:center\">-</td></tr>");
    }
    
    // OPEN POSITIONS
    let mut open_html = String::new();
    for p in &open_pos {
        let cost = p.avg_price * p.total_bought;
        open_html.push_str(&format!(
            "<tr><td>{}</td><td>{:.0}%</td><td>{}</td><td style=\"color:#ef4444\">-${:.2}</td></tr>",
            p.outcome, p.avg_price * 100.0, p.total_bought, cost
        ));
    }
    if open_html.is_empty() {
        open_html.push_str("<tr><td colspan=\"4\" style=\"text-align:center\">-</td></tr>");
    }
    
    // SIMULATE HISTORY
    let sim_history = state.simulate_history.lock().unwrap();
    let settings = state.sim_settings.lock().unwrap().clone();
    let mut sim_html = String::new();
    for t in sim_history.iter().rev().take(15) {
        let pnl_color = if t.pnl >= 0.0 { "#10b981" } else { "#ef4444" };
        let time_str = chrono::DateTime::from_timestamp(t.timestamp as i64, 0).map(|dt| dt.format("%H:%M").to_string()).unwrap_or_else(|| "-".to_string());
        let market_name = format!("BTC 5m");
        sim_html.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>${:.2}</td><td style=\"color:#f59e0b\">-${:.4}</td><td style=\"color:{}\">{:+.2}</td></tr>",
            time_str, market_name, t.outcome, t.amount, t.gas_cost, pnl_color, t.pnl
        ));
    }
    if sim_html.is_empty() {
        sim_html.push_str("<tr><td colspan=\"6\" style=\"text-align:center\">No sim trades yet</td></tr>");
    }
    
    let html = format!(r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>BTC 5m Bot</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        html,body {{ height: 100%; overflow: hidden; }}
        body {{ font-family: 'Segoe UI', sans-serif; background: #1a1a1a; color: #e0e0e0; font-size: 11px; padding: 8px; }}
        .header {{ display: flex; justify-content: space-between; align-items: center; background: #107c41; color: white; padding: 8px 12px; border-radius: 4px 4px 0 0; }}
        .header h1 {{ font-size: 16px; font-weight: 600; }}
        .stats-bar {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: #333; margin-top: 2px; }}
        .stat-cell {{ background: #252525; padding: 10px 6px; text-align: center; border: 1px solid #333; }}
        .stat-cell .label {{ color: #888; font-size: 9px; text-transform: uppercase; }}
        .stat-cell .value {{ font-size: 14px; font-weight: 600; margin-top: 2px; }}
        .win-bar {{ display: flex; height: 4px; margin-top: 4px; border-radius: 2px; overflow: hidden; }}
        .win-bar .win {{ background: #10b981; }}
        .win-bar .loss {{ background: #ef4444; }}
        .main-grid {{ display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1px; background: #333; margin-top: 4px; flex: 1; min-height: 0; overflow: hidden; }}
        .section {{ background: #1e1e1e; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }}
        .section-header {{ background: #2a2a2a; padding: 6px 10px; font-weight: 600; font-size: 12px; border-bottom: 1px solid #333; }}
        .table-wrapper {{ flex: 1; overflow: auto; background: #1e1e1e; }}
        table {{ width: 100%; border-collapse: collapse; font-size: 10px; }}
        th {{ background: #2a2a2a; padding: 5px 8px; text-align: left; font-weight: 600; color: #888; border-bottom: 1px solid #333; position: sticky; top: 0; }}
        td {{ padding: 4px 8px; border-bottom: 1px solid #2a2a2a; }}
        tr:nth-child(even) {{ background: #232323; }}
        tr:hover {{ background: #2d2d2d; }}
        .green {{ color: #10b981; }}
        .red {{ color: #ef4444; }}
        .yellow {{ color: #f59e0b; }}
        a {{ color: #10b981; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
        .btn {{ padding: 4px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 11px; font-weight: 600; }}
        .btn-yes {{ background: #10b981; color: white; }}
        .sim-form {{ display: flex; gap: 8px; align-items: center; }}
        .sim-form input {{ width: 50px; padding: 4px; background: #252525; border: 1px solid #444; color: white; border-radius: 4px; }}
    </style>
    <meta http-equiv="refresh" content="5">
</head>
<body style="height:100%;display:flex;flex-direction:column">
    <div class="header">
        <h1>Bitcoin 5m Bot</h1>
        <span class="time">@{} | <span id="t"></span></span>
    </div>
    
    <div class="stats-bar">
        <div class="stat-cell"><div class="label">P&L</div><div class="value" style="color:{}">${:.2}</div></div>
        <div class="stat-cell"><div class="label">Trades</div><div class="value">{}</div></div>
        <div class="stat-cell"><div class="label">Wins</div><div class="value green">{}</div></div>
        <div class="stat-cell"><div class="label">Losses</div><div class="value red">{}</div></div>
        <div class="stat-cell"><div class="label">Win Rate</div><div class="value">{:.0}%</div><div class="win-bar"><div class="win" style="width:{}%"></div><div class="loss" style="width:{}%"></div></div></div>
        <div class="stat-cell"><div class="label">Avg W/L</div><div class="value" style="font-size:11px"><span class="green">+${:.2}</span> / <span class="red">-${:.2}</span></div></div>
    </div>
    
    <div class="main-grid">
        <div class="section">
            <div class="section-header">Active Markets (Next 5)</div>
            <div class="table-wrapper">
                <table><thead><tr><th style="width:25px">Icon</th><th>Time</th><th>Count</th><th>Event</th><th>Yes</th><th>No</th><th>Sim</th></tr></thead><tbody>{}</tbody></table>
            </div>
        </div>
        
        <div class="section">
            <div class="section-header">History / Activity</div>
            <div class="table-wrapper">
                <table><thead><tr><th style="width:25px">Icon</th><th>Time</th><th>Event</th><th>Outcome</th><th>Status</th><th>P&L</th></tr></thead><tbody>{}</tbody></table>
            </div>
        </div>
        
        <div class="section">
            <div class="section-header">Open Positions</div>
            <div class="table-wrapper">
                <table><thead><tr><th>Outcome</th><th>Price</th><th>Size</th><th>Cost</th></tr></thead><tbody>{}</tbody></table>
            </div>
        </div>
        
        <div class="section">
            <div class="section-header">Simulate Settings (USDC: ${:.2} | MATIC: {:.4} | Bet: ${:.2} | Gas: ${:.4})</div>
            <div class="table-wrapper">
                <form action="/settings" method="POST" class="sim-form" style="padding:8px">
                    <input type="number" name="usdc_balance" placeholder="USDC" step="0.01" value="{:.2}" style="width:50px">
                    <input type="number" name="matic_balance" placeholder="MATIC" step="0.0001" value="{:.4}" style="width:50px">
                    <input type="number" name="bet_size" placeholder="Bet" step="0.01" value="{:.2}" style="width:40px">
                    <input type="number" name="gas_price" placeholder="Gas" step="0.0001" value="{:.4}" style="width:40px">
                    <input type="number" name="threshold_above" placeholder=">52%" step="0.01" value="{:.2}" style="width:35px">
                    <input type="number" name="threshold_below" placeholder="<48%" step="0.01" value="{:.2}" style="width:35px">
                    <label style="color:#10b981;font-size:10px"><input type="checkbox" name="auto_mode" {}> AUTO</label>
                    <button type="submit" class="btn" style="background:#107c41;color:#fff">Save</button>
                </form>
                <table><thead><tr><th>Time</th><th>Market</th><th>Outcome</th><th>Amount</th><th>Gas</th><th>P&L</th></tr></thead><tbody>{}</tbody></table>
            </div>
        </div>
    </div>
    
    <div style="text-align:center;color:#555;font-size:9px;padding:4px">Polymarket Data API | <a href="/doc">Documentation</a></div>
    <script>
document.getElementById('t').innerText=new Date().toLocaleTimeString();

async function updateMarkets() {{
    try {{
        const resp = await fetch('/api/markets');
        const data = await resp.json();
        let html = '';
        data.markets.forEach(m => {{
            const yesPct = (parseFloat(m.yes) * 100).toFixed(1) + '%';
            const noPct = (parseFloat(m.no) * 100).toFixed(1) + '%';
            html += `<tr><td style="text-align:center"><img src="${{m.icon || ''}}" style="width:24px;height:24px;border-radius:4px"></td>
            <td>${{m.time}}</td><td class="countdown" data-end="${{m.end_ts}}" style="font-weight:bold">${{m.countdown}}</td>
            <td><a href="https://polymarket.com/event/${{m.slug}}?t=5m" target="_blank" style="color:#10b981">BTC 5m</a></td>
            <td style="color:#10b981">Yes ${{yesPct}}</td><td style="color:#ef4444">No ${{noPct}}</td>
            <td><form action="/simulate" method="POST" style="display:inline"><input type="hidden" name="slug" value="${{m.slug}}"><input type="hidden" name="outcome" value="Yes"><input type="hidden" name="amount" value="1"><input type="hidden" name="price" value="${{m.y_val}}"><button type="submit" class="btn btn-yes" style="padding:2px 6px;font-size:10px">Buy</button></form></td></tr>`;
        }});
        document.querySelector('.section table tbody').innerHTML = html || '<tr><td colspan="7">No active market</td></tr>';
    }} catch(e) {{}}
}}

setInterval(updateMarkets, 1000);

setInterval(function() {{
    var now = Math.floor(Date.now() / 1000);
    var markets = document.querySelectorAll('.countdown');
    markets.forEach(function(el) {{
        var endTime = parseInt(el.getAttribute('data-end'));
        var remaining = endTime - now;
        if (remaining > 0) {{
            var mins = Math.floor(remaining / 60);
            var secs = remaining % 60;
            el.innerText = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
            el.style.color = remaining < 60 ? '#ef4444' : (remaining < 120 ? '#f59e0b' : '#10b981');
        }} else {{
            el.innerText = 'ENDED';
            el.style.color = '#888';
        }}
    }});
}}, 1000);
</script>
</body>
</html>"#,
        profile_name,
        pnl_color, total_pnl,
        total_trades,
        wins,
        loss,
        win_rate, win_bar_width, 100 - win_bar_width,
        avg_win, avg_loss,
        market_html,
        activity_html,
        open_html,
        settings.usdc_balance,
        settings.matic_balance,
        settings.bet_size,
        settings.gas_price,
        settings.usdc_balance,
        settings.matic_balance,
        settings.bet_size,
        settings.gas_price,
        settings.threshold_above,
        settings.threshold_below,
        if settings.auto_mode { "checked" } else { "" },
        sim_html
    );
    
    Html(html)
}

#[derive(Deserialize)]
struct SimulateForm {
    slug: String,
    outcome: String,
    amount: f64,
    price: f64,
}

async fn simulate_handler(State(state): State<Arc<DashboardState>>, axum::extract::Form(form): axum::extract::Form<SimulateForm>) -> Html<String> {
    let settings = state.sim_settings.lock().unwrap().clone();
    let gas_cost = settings.gas_price;
    let pnl = if form.outcome == "Yes" {
        form.amount * (1.0 - form.price) - gas_cost
    } else {
        -form.amount * form.price - gas_cost
    };
    
    let trade = SimulateTrade {
        slug: form.slug,
        outcome: form.outcome,
        amount: form.amount,
        price: form.price,
        pnl,
        timestamp: chrono::Utc::now().timestamp() as u64,
        gas_cost,
    };
    
    state.simulate_history.lock().unwrap().push(trade);
    
    Html("<script>window.location='/'</script>".to_string())
}

#[derive(Deserialize)]
struct SettingsForm {
    usdc_balance: f64,
    matic_balance: f64,
    bet_size: f64,
    gas_price: f64,
    threshold_above: f64,
    threshold_below: f64,
    auto_mode: Option<String>,
}

async fn settings_handler(State(state): State<Arc<DashboardState>>, axum::extract::Form(form): axum::extract::Form<SettingsForm>) -> Html<String> {
    let current_time = chrono::Utc::now().timestamp() as u64;
    let mut settings = state.sim_settings.lock().unwrap();
    let last_trade = settings.last_trade_timestamp;
    
    let new_auto_mode = form.auto_mode.as_ref().map(|s| s == "on").unwrap_or(false);
    
    *settings = SimSettings {
        usdc_balance: form.usdc_balance,
        matic_balance: form.matic_balance,
        bet_size: form.bet_size,
        gas_price: form.gas_price,
        threshold_above: form.threshold_above,
        threshold_below: form.threshold_below,
        auto_mode: new_auto_mode,
        last_trade_timestamp: last_trade,
    };
    
    Html("<script>window.location='/'</script>".to_string())
}

async fn doc_handler() -> Html<String> {
    let html = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>BTC 5m Bot - Docs</title>
    <style>
        body { font-family: sans-serif; background: #1a1a1a; color: #e0e0e0; padding: 20px; line-height: 1.6; }
        h1 { color: #107c41; }
        h2 { color: #107c41; border-bottom: 2px solid #107c41; padding-bottom: 8px; margin-top: 24px; }
        code { background: #333; padding: 2px 6px; border-radius: 4px; }
        pre { background: #333; padding: 16px; border-radius: 8px; overflow-x: auto; }
        a { color: #107c41; }
    </style>
</head>
<body>
    <h1>BTC 5m Bot v01</h1>
    <p>Dashboard untuk aktivitas trading Polymarket Bitcoin 5-minute markets.</p>
    
    <h2>Cara Kerja</h2>
    <ol>
        <li><strong>data_fetcher</strong> - Running di background, fetch data dari Polymarket setiap 30 detik, simpan ke ./data/</li>
        <li><strong>btc5m_dashboard</strong> - Web server yang read dari local JSON files (FAST!)</li>
    </ol>
    
    <h2>Menjalankan</h2>
    <pre># Terminal 1 - Data Fetcher
cargo run --bin data_fetcher

# Terminal 2 - Dashboard
USER_ADDRESS=0x... cargo run --bin btc5m_dashboard</pre>
    <p>Buka <code>http://localhost:8081</code></p>
</body>
</html>"#.to_string();
    
    Html(html)
}

use axum::Json as ax_json;

async fn markets_api_handler() -> ax_json<serde_json::Value> {
    let markets = fetch_btc5m_markets().await;
    let mut market_data = Vec::new();
    for m in markets {
        let prices: Vec<String> = serde_json::from_str(m.outcome_prices.as_ref().unwrap_or(&"[]".to_string())).unwrap_or_default();
        let yes_price = prices.get(0).cloned().unwrap_or_else(|| "0.5".to_string());
        let no_price = prices.get(1).cloned().unwrap_or_else(|| "0.5".to_string());
        market_data.push(serde_json::json!({
            "slug": m.slug,
            "icon": m.icon,
            "time": get_time_from_slug(&m.slug),
            "countdown": get_countdown(&m.slug),
            "end_ts": get_end_timestamp(&m.slug),
            "yes": yes_price,
            "no": no_price,
            "y_val": yes_price.parse::<f64>().unwrap_or(0.5)
        }));
    }
    ax_json(serde_json::json!({ "markets": market_data }))
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    
    let user_address = std::env::var("USER_ADDRESS").expect("USER_ADDRESS must be set");
    
    let state = Arc::new(DashboardState {
        app: AppState {
            user_address: user_address.clone(),
        },
        simulate_history: std::sync::Mutex::new(Vec::new()),
        sim_settings: std::sync::Mutex::new(SimSettings::default()),
    });
    
    let app = Router::new()
        .route("/", get(dashboard_handler))
        .route("/api/markets", get(markets_api_handler))
        .route("/simulate", post(simulate_handler))
        .route("/settings", post(settings_handler))
        .route("/doc", get(doc_handler))
        .with_state(state);
    
    let addr = SocketAddr::from(([0, 0, 0, 0], 8081));
    println!("BTC 5m Bot Dashboard running on http://{}", addr);
    println!("Documentation: http://{}/doc", addr);
    
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}