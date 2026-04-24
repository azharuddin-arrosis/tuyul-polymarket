use crate::app_config::AppConfig;
use crate::math::clamp;
use crate::strategy::QuoteDecision;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use tracing::info;

#[derive(Debug, Clone, Copy)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone)]
pub struct SimOrder {
    pub side: Side,
    pub price: f64,
    /// target notional (USDC)
    pub notional_usdc: f64,
}

#[derive(Debug, Default)]
pub struct SimStats {
    pub fills: u64,
    pub cancels: u64,
    pub fees_paid_usdc: f64,
    pub gas_paid_pol: f64,
}

/// Simulator forward-test (paper trading) untuk token "Up".
///
/// Model fill sederhana:
/// - Jika last_trade_price <= bid => anggap bid kita ke-fill (someone sold into us)
/// - Jika last_trade_price >= ask => anggap ask kita ke-fill (someone bought from us)
///
/// Ini bukan simulasi matching yang sempurna, tapi cukup untuk forward-test perilaku spread+inventory.
pub struct PaperSim {
    cfg: AppConfig,
    pub cash_usdc: f64,
    pub pol_balance: f64,
    /// inventory Up dalam shares (bukan USDC)
    pub inv_up_shares: f64,
    /// modal kerja (untuk aturan compound/withdraw)
    pub capital_base_usdc: f64,
    pub withdrawn_usdc: f64,
    pub stats: SimStats,
    pub bid_order: Option<SimOrder>,
    pub ask_order: Option<SimOrder>,
    pub last_harvest_equity: f64,
    pub current_window_slug: Option<String>,
    pub current_window_end: Option<DateTime<Utc>>,
}

impl PaperSim {
    pub fn new(cfg: AppConfig, starting_usdc: f64, starting_pol: f64) -> Self {
        Self {
            capital_base_usdc: starting_usdc,
            cash_usdc: starting_usdc,
            pol_balance: starting_pol,
            inv_up_shares: 0.0,
            withdrawn_usdc: 0.0,
            stats: SimStats::default(),
            bid_order: None,
            ask_order: None,
            last_harvest_equity: starting_usdc,
            current_window_slug: None,
            current_window_end: None,
            cfg,
        }
    }

    pub fn equity_marked(&self, mid: f64) -> f64 {
        self.cash_usdc + self.inv_up_shares * mid
    }

    pub fn on_new_window(&mut self, slug: &str, end: DateTime<Utc>) {
        self.current_window_slug = Some(slug.to_string());
        self.current_window_end = Some(end);
    }

    pub fn bet_size_usdc(&self) -> f64 {
        // Sesuai request: 10 => bet 1, 25 => bet 2 (step)
        let cap = self.capital_base_usdc.max(0.0);
        if cap < self.cfg.compound.tier1_cap_usdc {
            self.cfg.compound.tier1_bet_usdc
        } else if cap < self.cfg.compound.tier2_cap_usdc {
            self.cfg.compound.tier2_bet_usdc
        } else {
            // default: keep tier2
            self.cfg.compound.tier2_bet_usdc
        }
    }

    pub fn maybe_requote(&mut self, desired: QuoteDecision, mid: f64) -> Result<()> {
        let size = self.bet_size_usdc().min(self.cash_usdc.max(0.0));
        if size <= 0.0 {
            return Err(anyhow!("cash_usdc habis, tidak bisa pasang order"));
        }

        // Bid (BUY)
        let need_replace_bid = match self.bid_order.as_ref() {
            None => true,
            Some(o) => (o.price - desired.bid).abs() > self.cfg.quote.reprice_threshold,
        };
        if need_replace_bid {
            if self.bid_order.is_some() {
                self.cancel_one();
                self.bid_order = None;
            }
            self.bid_order = Some(SimOrder {
                side: Side::Buy,
                price: desired.bid,
                notional_usdc: size,
            });
        }

        // Ask (SELL) - hanya kalau kita punya inventory cukup, kalau tidak kita tetap pasang kecil untuk “capture” saat sudah punya
        let need_replace_ask = match self.ask_order.as_ref() {
            None => true,
            Some(o) => (o.price - desired.ask).abs() > self.cfg.quote.reprice_threshold,
        };
        if need_replace_ask {
            if self.ask_order.is_some() {
                self.cancel_one();
                self.ask_order = None;
            }
            self.ask_order = Some(SimOrder {
                side: Side::Sell,
                price: desired.ask,
                notional_usdc: size,
            });
        }

        // Sanity: jangan overvalue inventory
        let _eq = self.equity_marked(mid);
        Ok(())
    }

    pub fn on_tick(
        &mut self,
        mid: f64,
        last_trade_price: Option<f64>,
        secs_to_end: u64,
    ) -> Result<()> {
        // Fill logic dari last_trade_price
        if let Some(ltp) = last_trade_price {
            // Bid filled?
            if let Some(bid) = self.bid_order.clone() {
                if ltp <= bid.price {
                    self.fill(bid, true)?;
                    self.bid_order = None;
                }
            }
            // Ask filled?
            if let Some(ask) = self.ask_order.clone() {
                if ltp >= ask.price {
                    self.fill(ask, true)?;
                    self.ask_order = None;
                }
            }
        }

        // Flatten zone: tutup posisi (sim)
        if secs_to_end <= self.cfg.bot.flatten_start_secs {
            self.flatten_to_cash(mid)?;
        }

        Ok(())
    }

    fn fill(&mut self, order: SimOrder, maker: bool) -> Result<()> {
        let notional = order.notional_usdc;
        if notional <= 0.0 {
            return Ok(());
        }

        // fee
        let fee_bps = if maker {
            self.cfg.sim.maker_fee_bps
        } else {
            self.cfg.sim.taker_fee_bps
        } as f64;
        let fee = notional * (fee_bps / 10_000.0);

        match order.side {
            Side::Buy => {
                // BUY shares of Up: shares = notional / price
                let price = clamp(order.price, 0.0001, 0.9999);
                let shares = notional / price;
                if self.cash_usdc + 1e-9 < notional + fee {
                    return Err(anyhow!("USDC tidak cukup untuk BUY (need {:.4})", notional + fee));
                }
                self.cash_usdc -= notional + fee;
                self.inv_up_shares += shares;
            }
            Side::Sell => {
                // SELL shares: shares = notional / price, pastikan inventory cukup
                let price = clamp(order.price, 0.0001, 0.9999);
                let shares = notional / price;
                if self.inv_up_shares + 1e-9 < shares {
                    // kalau inventory kurang, sell sebagian saja
                    let shares2 = self.inv_up_shares.max(0.0);
                    if shares2 <= 0.0 {
                        return Ok(());
                    }
                    let notional2 = shares2 * price;
                    let fee2 = notional2 * (fee_bps / 10_000.0);
                    self.inv_up_shares = 0.0;
                    self.cash_usdc += notional2 - fee2;
                    self.stats.fees_paid_usdc += fee2;
                } else {
                    self.inv_up_shares -= shares;
                    self.cash_usdc += notional - fee;
                }
            }
        }

        // gas estimate
        self.pay_gas(self.cfg.sim.gas_per_fill_pol)?;

        self.stats.fills += 1;
        self.stats.fees_paid_usdc += fee;
        Ok(())
    }

    fn cancel_one(&mut self) {
        self.stats.cancels += 1;
        // gas cancel (estimasi)
        let g = self.cfg.sim.gas_per_cancel_pol;
        let _ = self.pay_gas(g);
    }

    fn pay_gas(&mut self, pol: f64) -> Result<()> {
        if pol <= 0.0 {
            return Ok(());
        }
        if self.pol_balance + 1e-12 < pol {
            return Err(anyhow!(
                "POL tidak cukup untuk gas (need {:.6}, have {:.6})",
                pol,
                self.pol_balance
            ));
        }
        self.pol_balance -= pol;
        self.stats.gas_paid_pol += pol;
        Ok(())
    }

    pub fn flatten_to_cash(&mut self, mid: f64) -> Result<()> {
        if self.inv_up_shares <= 0.0 {
            return Ok(());
        }
        // Close pakai taker fee (konservatif)
        let notional = self.inv_up_shares * mid;
        let fee = notional * (self.cfg.sim.taker_fee_bps as f64 / 10_000.0);
        self.cash_usdc += notional - fee;
        self.stats.fees_paid_usdc += fee;
        self.inv_up_shares = 0.0;
        self.pay_gas(self.cfg.sim.gas_per_fill_pol)?;
        Ok(())
    }

    pub fn maybe_harvest(&mut self, mid: f64) {
        if !self.cfg.compound.harvest_on_2x {
            return;
        }
        let equity = self.equity_marked(mid);
        let base = self.capital_base_usdc.max(0.0);
        if equity >= 2.0 * base && base > 0.0 {
            let profit = equity - base;
            let wd = profit * clamp(self.cfg.compound.withdraw_profit_share, 0.0, 1.0);
            // withdraw dari cash (kalau cash kurang, anggap WD tertunda; untuk simulasi kita WD dari equity -> set cash)
            self.withdrawn_usdc += wd;
            self.capital_base_usdc = base + (profit - wd); // modal + 50% profit (contoh)
            self.cash_usdc = self.capital_base_usdc; // reset cash sebagai modal kerja
            self.last_harvest_equity = equity;
            info!(
                equity = %format!("{:.2}", equity),
                profit = %format!("{:.2}", profit),
                withdrawn = %format!("{:.2}", wd),
                next_capital = %format!("{:.2}", self.capital_base_usdc),
                "HARVEST (panen) trigger"
            );
        }
    }
}
