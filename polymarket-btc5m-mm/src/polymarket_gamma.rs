use crate::types::WindowMeta;
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use reqwest::Url;
use serde::Deserialize;
use tracing::warn;

#[derive(Clone)]
pub struct GammaClient {
    base: Url,
    http: reqwest::Client,
}

impl GammaClient {
    pub fn new(base: String) -> Result<Self> {
        Ok(Self {
            base: Url::parse(&base)?,
            http: reqwest::Client::new(),
        })
    }

    pub async fn fetch_window_metadata(&self, slug: &str) -> Result<WindowMeta> {
        // 1) Market: conditionId + clobTokenIds + tick size + end time
        let market_url = self
            .base
            .join(&format!("/markets?slug={}", urlencoding::encode(slug)))?;
        let markets: Vec<GammaMarket> = self
            .http
            .get(market_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .context("parse gamma markets response")?;
        let m = markets.into_iter().next().ok_or_else(|| anyhow!("market not found for slug={slug}"))?;

        let outcomes: Vec<String> = serde_json::from_str(&m.outcomes)
            .context("parse outcomes json string")?;
        let token_ids: Vec<String> = serde_json::from_str(&m.clob_token_ids)
            .context("parse clobTokenIds json string")?;
        if outcomes.len() != 2 || token_ids.len() != 2 {
            return Err(anyhow!(
                "expected 2 outcomes + 2 token ids, got outcomes={} tokens={}",
                outcomes.len(),
                token_ids.len()
            ));
        }
        // Asumsi: urutan sama seperti outcomes ["Up","Down"]
        let (token_up, token_down) = if outcomes[0].to_lowercase() == "up" {
            (token_ids[0].clone(), token_ids[1].clone())
        } else {
            // fallback
            (token_ids[0].clone(), token_ids[1].clone())
        };

        let end_time: DateTime<Utc> = m.end_date.parse().context("parse endDate")?;

        // 2) Event: priceToBeat (metadata)
        let event_url = self
            .base
            .join(&format!("/events?slug={}", urlencoding::encode(slug)))?;
        let events: Vec<GammaEvent> = self
            .http
            .get(event_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .context("parse gamma events response")?;
        let price_to_beat = events
            .into_iter()
            .next()
            .and_then(|ev| ev.event_metadata.and_then(|m| m.price_to_beat));
        if price_to_beat.is_none() {
            // Beberapa window tidak mengembalikan field ini. Untuk bot MM spread capture,
            // field ini tidak wajib; kita tetap lanjut.
            warn!(%slug, "eventMetadata.priceToBeat tidak tersedia; lanjut tanpa price_to_beat");
        }

        Ok(WindowMeta {
            slug: slug.to_string(),
            condition_id: m.condition_id,
            token_up,
            token_down,
            end_time,
            tick_size: m.order_price_min_tick_size.unwrap_or(0.01),
            price_to_beat,
        })
    }

    /// Ambil state market cepat dari Gamma (bestBid/bestAsk/lastTradePrice) untuk fallback simulasi.
    pub async fn fetch_market_state(&self, slug: &str) -> Result<MarketState> {
        let market_url = self
            .base
            .join(&format!("/markets?slug={}", urlencoding::encode(slug)))?;
        let markets: Vec<GammaMarket> = self
            .http
            .get(market_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .context("parse gamma markets response")?;
        let m = markets.into_iter().next().ok_or_else(|| anyhow!("market not found for slug={slug}"))?;
        Ok(MarketState {
            best_bid: m.best_bid.unwrap_or(0.0),
            best_ask: m.best_ask.unwrap_or(0.0),
            last_trade_price: m.last_trade_price,
        })
    }
}

#[derive(Debug, Clone)]
pub struct MarketState {
    pub best_bid: f64,
    pub best_ask: f64,
    pub last_trade_price: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct GammaMarket {
    #[serde(rename = "conditionId")]
    condition_id: String,
    #[serde(rename = "outcomes")]
    outcomes: String,
    #[serde(rename = "clobTokenIds")]
    clob_token_ids: String,
    #[serde(rename = "endDate")]
    end_date: String,
    #[serde(rename = "orderPriceMinTickSize")]
    order_price_min_tick_size: Option<f64>,

    #[serde(rename = "bestBid")]
    best_bid: Option<f64>,
    #[serde(rename = "bestAsk")]
    best_ask: Option<f64>,
    #[serde(rename = "lastTradePrice")]
    last_trade_price: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct GammaEvent {
    #[serde(rename = "eventMetadata")]
    event_metadata: Option<EventMetadata>,
}

#[derive(Debug, Deserialize)]
struct EventMetadata {
    #[serde(rename = "priceToBeat")]
    price_to_beat: Option<f64>,
}
