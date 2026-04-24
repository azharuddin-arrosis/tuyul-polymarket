use anyhow::Result;
use reqwest::Client;
use serde_json::Value;

use crate::models::{ParsedMarket, PolyMarket};

const GAMMA_BASE: &str = "https://gamma-api.polymarket.com";

pub struct PolymarketClient {
    client: Client,
}

impl PolymarketClient {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .user_agent("polymarket-sim/0.1.0")
            .timeout(std::time::Duration::from_secs(15))
            .build()?;
        Ok(Self { client })
    }

    /// Fetch active markets, sorted by volume
    pub async fn get_markets(
        &self,
        limit: usize,
        offset: usize,
        category: Option<&str>,
    ) -> Result<Vec<ParsedMarket>> {
        let mut url = format!(
            "{}/markets?limit={}&offset={}&active=true&closed=false&order=volume&ascending=false",
            GAMMA_BASE, limit, offset
        );

        if let Some(cat) = category {
            url.push_str(&format!("&tag={}", cat));
        }

        let resp = self.client.get(&url).send().await?;

        // Polymarket can return array or object
        let body: Value = resp.json().await?;

        let markets_raw: Vec<PolyMarket> = match body {
            Value::Array(arr) => serde_json::from_value(Value::Array(arr))?,
            Value::Object(obj) => {
                // Sometimes wrapped: { data: [...] }
                if let Some(arr) = obj.get("data") {
                    serde_json::from_value(arr.clone())?
                } else {
                    vec![]
                }
            }
            _ => vec![],
        };

        let markets: Vec<ParsedMarket> = markets_raw
            .into_iter()
            .filter_map(ParsedMarket::from_poly)
            .filter(|m| m.yes_price > 0.02 && m.yes_price < 0.98)
            .filter(|m| m.liquidity > 1000.0)
            .collect();

        Ok(markets)
    }

    /// Fetch a single market by ID
    pub async fn get_market(&self, id: &str) -> Result<Option<ParsedMarket>> {
        let url = format!("{}/markets/{}", GAMMA_BASE, id);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let market: PolyMarket = resp.json().await?;
        Ok(ParsedMarket::from_poly(market))
    }

    /// Search markets by keyword
    pub async fn search_markets(&self, query: &str, limit: usize) -> Result<Vec<ParsedMarket>> {
        let url = format!(
            "{}/markets?limit={}&active=true&closed=false&_q={}&order=volume&ascending=false",
            GAMMA_BASE,
            limit,
            urlencoding::encode(query)
        );

        let resp = self.client.get(&url).send().await?;
        let body: Value = resp.json().await?;

        let markets_raw: Vec<PolyMarket> = match body {
            Value::Array(arr) => serde_json::from_value(Value::Array(arr))?,
            _ => vec![],
        };

        Ok(markets_raw
            .into_iter()
            .filter_map(ParsedMarket::from_poly)
            .collect())
    }

    /// Fetch top markets by category tag
    pub async fn get_trending(&self, limit: usize) -> Result<Vec<ParsedMarket>> {
        let url = format!(
            "{}/markets?limit={}&active=true&closed=false&order=volume&ascending=false",
            GAMMA_BASE, limit
        );

        let resp = self.client.get(&url).send().await?;
        let body: Value = resp.json().await?;

        let markets_raw: Vec<PolyMarket> = match body {
            Value::Array(arr) => serde_json::from_value(Value::Array(arr))
                .unwrap_or_default(),
            _ => vec![],
        };

        Ok(markets_raw
            .into_iter()
            .filter_map(ParsedMarket::from_poly)
            .filter(|m| m.liquidity > 5000.0)
            .filter(|m| m.yes_price > 0.03 && m.yes_price < 0.97)
            .take(limit)
            .collect())
    }
}
