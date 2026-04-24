use serde::{Deserialize, Serialize};
use std::fs;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Market {
    slug: String,
    icon: Option<String>,
    #[serde(rename = "outcomePrices")]
    outcome_prices: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ClosedPos {
    title: String,
    slug: String,
    outcome: String,
    #[serde(rename = "avgPrice")]
    avg_price: f64,
    #[serde(rename = "totalBought")]
    total_bought: f64,
    #[serde(rename = "realizedPnl")]
    realized_pnl: f64,
}

fn fetch_btc5m_markets() -> Vec<Market> {
    let now = chrono::Utc::now().timestamp();
    let current_window = now / 300 * 300;
    let mut markets = Vec::new();

    for i in 1..=5 {
        let slug = format!("btc-updown-5m-{}", current_window + (i as i64 * 300));
        let url = format!("https://gamma-api.polymarket.com/markets?slug={}", slug);
        if let Ok(resp) = reqwest::blocking::get(&url) {
            if let Ok(m) = resp.json::<Vec<serde_json::Value>>() {
                if let Some(market) = m.into_iter().next() {
                    let slug = market
                        .get("slug")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let icon = market
                        .get("icon")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let outcome_prices = market
                        .get("outcomePrices")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    markets.push(Market {
                        slug,
                        icon,
                        outcome_prices: Some(outcome_prices.unwrap_or_default()),
                    });
                }
            }
        }
    }
    markets
}

fn fetch_positions(user: &str) -> Vec<ClosedPos> {
    let url = format!("https://data-api.polymarket.com/positions?user={}", user);
    if let Ok(resp) = reqwest::blocking::get(&url) {
        return resp.json().unwrap_or_default();
    }
    Vec::new()
}

fn fetch_closed_positions(user: &str) -> Vec<ClosedPos> {
    let url = format!(
        "https://data-api.polymarket.com/closed-positions?limit=20&sortBy=timestamp&sortDirection=DESC&user={}",
        user
    );
    if let Ok(resp) = reqwest::blocking::get(&url) {
        return resp.json().unwrap_or_default();
    }
    Vec::new()
}

fn main() {
    println!("BTC 5m Data Fetcher starting...");

    let user = "0x8F57631c63aB777E2f75a304c445046540453a4d";
    let data_dir = "./data";

    fs::create_dir_all(data_dir).ok();

    loop {
        println!(
            "Fetching data at {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
        );

        let markets = fetch_btc5m_markets();
        let markets_json = serde_json::to_string_pretty(&markets).unwrap();
        fs::write(format!("{}/markets.json", data_dir), markets_json).ok();
        println!("  - markets.json: {} markets", markets.len());

        let positions = fetch_positions(user);
        let positions_json = serde_json::to_string_pretty(&positions).unwrap();
        fs::write(format!("{}/positions.json", data_dir), positions_json).ok();
        println!("  - positions.json: {} open positions", positions.len());

        let closed = fetch_closed_positions(user);
        let closed_json = serde_json::to_string_pretty(&closed).unwrap();
        fs::write(format!("{}/closed.json", data_dir), closed_json).ok();
        println!("  - closed.json: {} closed positions", closed.len());

        println!("Sleeping 30 seconds...\n");
        std::thread::sleep(Duration::from_secs(30));
    }
}
