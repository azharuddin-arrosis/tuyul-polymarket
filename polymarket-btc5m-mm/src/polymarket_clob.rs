use anyhow::{Context, Result};
use reqwest::Url;
use serde::Deserialize;

#[derive(Clone)]
pub struct ClobClient {
    base: Url,
    http: reqwest::Client,
}

impl ClobClient {
    pub fn new(base: String) -> Result<Self> {
        Ok(Self {
            base: Url::parse(&base)?,
            http: reqwest::Client::new(),
        })
    }

    /// GET /book?token_id=...
    pub async fn get_order_book(&self, token_id: &str) -> Result<OrderBookSummary> {
        let mut url = self.base.join("/book")?;
        url.query_pairs_mut().append_pair("token_id", token_id);
        self.http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json::<OrderBookSummary>()
            .await
            .context("parse clob orderbook")
    }
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct OrderLevel {
    pub price: String,
    pub size: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct OrderBookSummary {
    pub market: String,
    #[serde(rename = "asset_id")]
    pub asset_id: String,
    pub timestamp: String,
    pub bids: Vec<OrderLevel>,
    pub asks: Vec<OrderLevel>,
    #[serde(rename = "min_order_size")]
    pub min_order_size: String,
    #[serde(rename = "tick_size")]
    pub tick_size: String,
    #[serde(default)]
    pub neg_risk: bool,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct BestBidAsk {
    pub best_bid: f64,
    pub best_ask: f64,
}

impl OrderBookSummary {
    pub fn best_bid_ask(&self) -> Option<BestBidAsk> {
        let best_bid = self
            .bids
            .first()
            .and_then(|x| x.price.parse::<f64>().ok())?;
        let best_ask = self
            .asks
            .first()
            .and_then(|x| x.price.parse::<f64>().ok())?;
        Some(BestBidAsk { best_bid, best_ask })
    }
}
