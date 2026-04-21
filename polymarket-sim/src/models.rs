use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Polymarket API Structs ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolyMarket {
    pub id: String,
    pub question: String,
    #[serde(default)]
    pub description: String,
    /// JSON string like ["Yes","No"]
    pub outcomes: Option<String>,
    /// JSON string like ["0.72","0.28"]
    #[serde(rename = "outcomePrices")]
    pub outcome_prices: Option<String>,
    #[serde(rename = "volume", default)]
    pub volume: String,
    #[serde(rename = "liquidity", default)]
    pub liquidity: String,
    #[serde(rename = "endDate")]
    pub end_date: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub closed: bool,
    #[serde(rename = "groupItemTitle", default)]
    pub group_item_title: String,
    #[serde(rename = "category", default)]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedMarket {
    pub id: String,
    pub question: String,
    pub description: String,
    pub yes_price: f64,
    pub no_price: f64,
    pub volume: f64,
    pub liquidity: f64,
    pub end_date: String,
    pub category: String,
    pub active: bool,
}

impl ParsedMarket {
    pub fn from_poly(m: PolyMarket) -> Option<Self> {
        let prices: Vec<f64> = m
            .outcome_prices
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .map(|v| {
                v.iter()
                    .filter_map(|p| p.parse::<f64>().ok())
                    .collect()
            })
            .unwrap_or_default();

        let yes_price = prices.first().copied().unwrap_or(0.5);
        let no_price = prices.get(1).copied().unwrap_or(1.0 - yes_price);

        let volume = m.volume.parse::<f64>().unwrap_or(0.0);
        let liquidity = m.liquidity.parse::<f64>().unwrap_or(0.0);

        Some(Self {
            id: m.id,
            question: m.question,
            description: m.description,
            yes_price,
            no_price,
            volume,
            liquidity,
            end_date: m.end_date.unwrap_or_default(),
            category: m.category,
            active: m.active,
        })
    }

    /// Days until resolution
    pub fn days_to_resolution(&self) -> Option<i64> {
        let end = DateTime::parse_from_rfc3339(&self.end_date).ok()?;
        let now = Utc::now();
        let diff = end.signed_duration_since(now).num_days();
        Some(diff)
    }

    /// Edge = |your_estimate - market_price|
    pub fn implied_edge(&self, your_estimate: f64, side: &TradeSide) -> f64 {
        match side {
            TradeSide::Yes => your_estimate - self.yes_price,
            TradeSide::No => your_estimate - self.no_price,
        }
    }
}

// ─── Simulator / Paper Trading ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TradeSide {
    Yes,
    No,
}

impl std::fmt::Display for TradeSide {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            TradeSide::Yes => write!(f, "YES"),
            TradeSide::No => write!(f, "NO"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PositionStatus {
    Open,
    Won,
    Lost,
    Closed, // manually closed before resolution
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub market_id: String,
    pub market_question: String,
    pub side: TradeSide,
    pub entry_price: f64,
    pub current_price: f64,
    pub size_usdc: f64,       // USDC invested
    pub shares: f64,           // shares = size / entry_price
    pub your_estimate: f64,    // your true probability estimate
    pub edge_at_entry: f64,    // edge when trade was placed
    pub status: PositionStatus,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub pnl: f64,              // realized P&L (if closed/resolved)
    pub notes: String,
    pub end_date: String,
}

impl Position {
    pub fn unrealized_pnl(&self) -> f64 {
        if self.status != PositionStatus::Open {
            return self.pnl;
        }
        // Current value of shares - initial investment
        (self.current_price - self.entry_price) * self.shares
    }

    pub fn unrealized_pnl_pct(&self) -> f64 {
        if self.size_usdc == 0.0 {
            return 0.0;
        }
        self.unrealized_pnl() / self.size_usdc * 100.0
    }

    pub fn max_profit(&self) -> f64 {
        // If resolves in your favor: shares * $1 - invested
        self.shares - self.size_usdc
    }

    pub fn max_loss(&self) -> f64 {
        -self.size_usdc
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeRequest {
    pub market_id: String,
    pub market_question: String,
    pub side: TradeSide,
    pub entry_price: f64,
    pub size_usdc: f64,
    pub your_estimate: f64,
    pub notes: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveRequest {
    pub position_id: String,
    pub outcome: ResolveOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResolveOutcome {
    Won,
    Lost,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePriceRequest {
    pub position_id: String,
    pub new_price: f64,
}

// ─── Portfolio State ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Portfolio {
    pub starting_capital: f64,
    pub cash: f64,
    pub positions: Vec<Position>,
    pub closed_positions: Vec<Position>,
    pub trade_history: Vec<TradeEvent>,
}

impl Portfolio {
    pub fn new(starting_capital: f64) -> Self {
        Self {
            starting_capital,
            cash: starting_capital,
            positions: Vec::new(),
            closed_positions: Vec::new(),
            trade_history: Vec::new(),
        }
    }

    pub fn total_deployed(&self) -> f64 {
        self.positions
            .iter()
            .filter(|p| p.status == PositionStatus::Open)
            .map(|p| p.size_usdc)
            .sum()
    }

    pub fn total_unrealized_pnl(&self) -> f64 {
        self.positions
            .iter()
            .filter(|p| p.status == PositionStatus::Open)
            .map(|p| p.unrealized_pnl())
            .sum()
    }

    pub fn total_realized_pnl(&self) -> f64 {
        self.closed_positions
            .iter()
            .map(|p| p.pnl)
            .sum()
    }

    pub fn total_value(&self) -> f64 {
        self.cash + self.total_deployed() + self.total_unrealized_pnl()
    }

    pub fn total_return_pct(&self) -> f64 {
        (self.total_value() - self.starting_capital) / self.starting_capital * 100.0
    }

    pub fn win_rate(&self) -> f64 {
        let resolved: Vec<&Position> = self
            .closed_positions
            .iter()
            .filter(|p| p.status == PositionStatus::Won || p.status == PositionStatus::Lost)
            .collect();

        if resolved.is_empty() {
            return 0.0;
        }

        let wins = resolved.iter().filter(|p| p.status == PositionStatus::Won).count();
        wins as f64 / resolved.len() as f64 * 100.0
    }

    pub fn stats(&self) -> PortfolioStats {
        let resolved: Vec<&Position> = self
            .closed_positions
            .iter()
            .filter(|p| p.status == PositionStatus::Won || p.status == PositionStatus::Lost)
            .collect();

        let total_trades = resolved.len();
        let wins = resolved.iter().filter(|p| p.status == PositionStatus::Won).count();
        let losses = total_trades - wins;

        let avg_win = if wins > 0 {
            resolved
                .iter()
                .filter(|p| p.status == PositionStatus::Won)
                .map(|p| p.pnl)
                .sum::<f64>() / wins as f64
        } else {
            0.0
        };

        let avg_loss = if losses > 0 {
            resolved
                .iter()
                .filter(|p| p.status == PositionStatus::Lost)
                .map(|p| p.pnl)
                .sum::<f64>() / losses as f64
        } else {
            0.0
        };

        // Category breakdown
        let mut by_category: HashMap<String, CategoryStats> = HashMap::new();
        for pos in &self.closed_positions {
            let entry = by_category
                .entry(pos.side.to_string())
                .or_insert(CategoryStats::default());
            entry.total += 1;
            entry.pnl += pos.pnl;
            if pos.status == PositionStatus::Won {
                entry.wins += 1;
            }
        }

        PortfolioStats {
            total_capital: self.starting_capital,
            current_value: self.total_value(),
            cash: self.cash,
            deployed: self.total_deployed(),
            total_return_pct: self.total_return_pct(),
            unrealized_pnl: self.total_unrealized_pnl(),
            realized_pnl: self.total_realized_pnl(),
            open_positions: self.positions.iter().filter(|p| p.status == PositionStatus::Open).count(),
            closed_positions: self.closed_positions.len(),
            total_trades,
            wins,
            losses,
            win_rate: self.win_rate(),
            avg_win,
            avg_loss,
            profit_factor: if avg_loss != 0.0 { (avg_win * wins as f64).abs() / (avg_loss * losses as f64).abs() } else { 0.0 },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CategoryStats {
    pub total: usize,
    pub wins: usize,
    pub pnl: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioStats {
    pub total_capital: f64,
    pub current_value: f64,
    pub cash: f64,
    pub deployed: f64,
    pub total_return_pct: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub open_positions: usize,
    pub closed_positions: usize,
    pub total_trades: usize,
    pub wins: usize,
    pub losses: usize,
    pub win_rate: f64,
    pub avg_win: f64,
    pub avg_loss: f64,
    pub profit_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeEvent {
    pub timestamp: DateTime<Utc>,
    pub event_type: String,
    pub market: String,
    pub side: String,
    pub amount: f64,
    pub price: f64,
    pub pnl: Option<f64>,
}

// ─── Kelly Calculator ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KellyRequest {
    pub your_probability: f64,  // 0.0 - 1.0
    pub market_price: f64,      // 0.0 - 1.0
    pub bankroll: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KellyResult {
    pub edge: f64,
    pub net_odds: f64,
    pub full_kelly_fraction: f64,
    pub half_kelly_fraction: f64,
    pub quarter_kelly_fraction: f64,
    pub full_kelly_amount: f64,
    pub half_kelly_amount: f64,
    pub quarter_kelly_amount: f64,
    pub recommended_fraction: f64,
    pub recommended_amount: f64,
    pub recommendation: String,
    pub should_trade: bool,
}

pub fn calculate_kelly(req: &KellyRequest) -> KellyResult {
    let p = req.your_probability;
    let price = req.market_price;
    let edge = p - price;

    // Net odds: how much you win per $1 risked
    // Buy at price P, win (1-P) if correct
    let b = (1.0 - price) / price;

    // Kelly formula: f* = (p*b - (1-p)) / b
    let kelly = if b > 0.0 {
        (p * b - (1.0 - p)) / b
    } else {
        0.0
    };

    let kelly = kelly.max(0.0); // never negative (means no bet)

    let full_kelly_amount = kelly * req.bankroll;
    let half_kelly_amount = kelly * 0.5 * req.bankroll;
    let quarter_kelly_amount = kelly * 0.25 * req.bankroll;

    // Hard cap at 10% of bankroll
    let cap = req.bankroll * 0.10;

    let (recommended_fraction, recommended_amount, recommendation) = if edge < 0.05 {
        (0.0, 0.0, "SKIP — Edge too small (<5%). Not worth trading.".to_string())
    } else if edge < 0.10 {
        let f = kelly * 0.25;
        let a = (f * req.bankroll).min(cap);
        (f, a, format!("QUARTER KELLY — Small edge. Max ${:.0}", a))
    } else if edge < 0.20 {
        let f = kelly * 0.5;
        let a = (f * req.bankroll).min(cap);
        (f, a, format!("HALF KELLY — Good edge. Recommended ${:.0}", a))
    } else {
        let f = kelly * 0.5;
        let a = (f * req.bankroll).min(cap);
        (f, a, format!("HALF KELLY (strong edge) — Recommended ${:.0}. Cap applied.", a))
    };

    KellyResult {
        edge,
        net_odds: b,
        full_kelly_fraction: kelly,
        half_kelly_fraction: kelly * 0.5,
        quarter_kelly_fraction: kelly * 0.25,
        full_kelly_amount,
        half_kelly_amount,
        quarter_kelly_amount,
        recommended_fraction,
        recommended_amount,
        recommendation,
        should_trade: edge >= 0.05,
    }
}
