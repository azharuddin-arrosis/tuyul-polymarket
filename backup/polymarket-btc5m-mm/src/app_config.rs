use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub bot: BotConfig,
    pub quote: QuoteConfig,
    pub risk: RiskConfig,
    pub sim: SimConfig,
    pub compound: CompoundConfig,
    pub endpoints: EndpointsConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BotConfig {
    pub slug_prefix: String,
    pub tick_interval_secs: u64,
    pub flatten_start_secs: u64,
    pub soften_start_secs: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QuoteConfig {
    pub edge_base: f64,
    pub edge_k_vol: f64,
    pub edge_k_time: f64,
    pub reprice_threshold: f64,
    pub order_size_usdc: f64,
    pub max_levels: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RiskConfig {
    pub max_inventory_usdc: f64,
    pub daily_loss_limit_pct: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SimConfig {
    pub starting_usdc: f64,
    pub starting_pol: f64,
    pub gas_per_fill_pol: f64,
    pub gas_per_cancel_pol: f64,
    pub maker_fee_bps: u32,
    pub taker_fee_bps: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompoundConfig {
    pub tier1_cap_usdc: f64,
    pub tier1_bet_usdc: f64,
    pub tier2_cap_usdc: f64,
    pub tier2_bet_usdc: f64,
    pub harvest_on_2x: bool,
    pub withdraw_profit_share: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EndpointsConfig {
    pub gamma_http: String,
    pub clob_http: String,
    pub clob_ws_market: String,
}

impl AppConfig {
    pub fn load(path: &str) -> Result<Self> {
        let cfg = config::Config::builder()
            .add_source(config::File::with_name(path))
            .build()?;
        Ok(cfg.try_deserialize()?)
    }
}
