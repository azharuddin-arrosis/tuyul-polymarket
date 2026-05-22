use crate::app_config::AppConfig;
use crate::math::{clamp, round_to_tick};
use crate::risk::InventoryState;
use crate::types::WindowMeta;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy)]
pub struct QuoteDecision {
    pub bid: f64,
    pub ask: f64,
    pub size_usdc: f64,
}

pub struct Strategy {
    cfg: AppConfig,
    window: Option<WindowMeta>,
    mids: VecDeque<f64>,
    mids_max: usize,
}

impl Strategy {
    pub fn new(cfg: AppConfig) -> Self {
        Self {
            cfg,
            window: None,
            mids: VecDeque::new(),
            mids_max: 120, // 2 menit rolling (1s tick)
        }
    }

    pub fn current_slug(&self) -> Option<&str> {
        self.window.as_ref().map(|w| w.slug.as_str())
    }

    pub fn window(&self) -> Option<&WindowMeta> {
        self.window.as_ref()
    }

    pub fn set_window(&mut self, w: WindowMeta) -> Result<()> {
        if w.tick_size <= 0.0 || w.tick_size > 0.1 {
            return Err(anyhow!("tick_size tidak masuk akal: {}", w.tick_size));
        }
        self.window = Some(w);
        self.mids.clear();
        Ok(())
    }

    pub fn observe_mid(&mut self, mid: f64) {
        self.mids.push_back(mid);
        while self.mids.len() > self.mids_max {
            self.mids.pop_front();
        }
    }

    /// Vol estimasi sederhana dari perubahan absolute midpoint (proxy adverse selection)
    pub fn rolling_vol(&self) -> f64 {
        if self.mids.len() < 3 {
            return 0.0;
        }
        let mut sum = 0.0;
        let mut n = 0;
        let mut prev = self.mids[0];
        for &x in self.mids.iter().skip(1) {
            sum += (x - prev).abs();
            n += 1;
            prev = x;
        }
        sum / (n as f64)
    }

    pub fn make_quotes(
        &self,
        _now: DateTime<Utc>,
        secs_to_end: u64,
        mid: f64,
        vol: f64,
        inv: &InventoryState,
    ) -> Result<QuoteDecision> {
        let w = self.window.as_ref().ok_or_else(|| anyhow!("window belum diset"))?;

        // Edge dinamis: base + k_vol*vol + k_time*(1/T)
        let t = secs_to_end.max(1) as f64;
        let mut edge = self.cfg.quote.edge_base + self.cfg.quote.edge_k_vol * vol + self.cfg.quote.edge_k_time / t;

        // Soften saat mendekati close
        if secs_to_end <= self.cfg.bot.soften_start_secs {
            edge *= 1.35;
        }

        // Inventory skew: dorong balik ke netral
        let inv_ratio = clamp(inv.inventory_usdc / self.cfg.risk.max_inventory_usdc, -1.0, 1.0);
        let skew_max = 0.01; // 1 cent
        let skew = inv_ratio * skew_max;

        let mut bid = mid - edge - skew;
        let mut ask = mid + edge - skew;

        bid = clamp(bid, 0.01, 0.99);
        ask = clamp(ask, 0.01, 0.99);

        // Round ke tick
        bid = round_to_tick(bid, w.tick_size);
        ask = round_to_tick(ask, w.tick_size);

        // Pastikan bid < ask
        if bid >= ask {
            ask = clamp(bid + w.tick_size, 0.01, 0.99);
        }

        Ok(QuoteDecision {
            bid,
            ask,
            size_usdc: self.cfg.quote.order_size_usdc,
        })
    }
}
