use reqwest;
use serde_json::Value;

#[tokio::main]
async fn main() {
    let client = reqwest::Client::new();
    
    // Try direct market by slug
    let slug = "btc-updown-5m-1776262500";
    let url = format!("https://gamma-api.polymarket.com/markets/slug/{}", slug);
    
    println!("Fetching: {}", url);
    
    match client.get(&url).send().await {
        Ok(res) => {
            if let Ok(json) = res.json::<Value>().await {
                println!("{}", json);
            }
        }
        Err(e) => eprintln!("Error: {}", e),
    }
}