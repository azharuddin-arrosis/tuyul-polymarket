use crate::app_config::AppConfig;
use crate::strategy::QuoteDecision;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};

#[derive(Default)]
pub struct InventoryState {
    /// Inventory net (perkiraan) dalam USDC nilai (positif = kebanyakan Up).
    /// TODO live: tarik dari Data API posisi + mark-to-market.
    pub inventory_usdc: f64,
    pub day_pnl_usdc: f64,
    pub day_start_equity_usdc: f64,
    pub current_window_start: Option<DateTime<Utc>>,
}

impl InventoryState {
    pub fn on_new_window(&mut self, now: DateTime<Utc>) {
        self.current_window_start = Some(now);
    }
}

pub struct RiskEngine {
    cfg: AppConfig,
    #[allow(dead_code)]
    day_start: DateTime<Utc>,
}

impl RiskEngine {
    pub fn new(cfg: AppConfig) -> Self {
        Self {
            cfg,
            day_start: Utc::now(),
        }
    }

    pub fn on_new_window(&mut self, _now: DateTime<Utc>) {
        // placeholder
    }

    pub fn check(&mut self, decision: &QuoteDecision, inv: &InventoryState) -> Result<()> {
        // Daily loss circuit breaker (placeholder)
        if inv.day_start_equity_usdc > 0.0 {
            let loss_pct = (-inv.day_pnl_usdc / inv.day_start_equity_usdc) * 100.0;
            if loss_pct >= self.cfg.risk.daily_loss_limit_pct {
                return Err(anyhow!(
                    "circuit breaker: loss_pct={:.2}% >= limit={:.2}%",
                    loss_pct,
                    self.cfg.risk.daily_loss_limit_pct
                ));
            }
        }

        // Sanity
        if decision.bid <= 0.0 || decision.ask >= 1.0 || decision.bid >= decision.ask {
            return Err(anyhow!("quote tidak valid bid/ask"));
        }
        Ok(())
    }
}
