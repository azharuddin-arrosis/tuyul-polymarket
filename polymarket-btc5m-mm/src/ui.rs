use ratatui::{
    layout::{Constraint, Layout},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Cell, Paragraph, Row, Table},
    Frame,
};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct MarketRow {
    pub tag: String,       // ACTIVE / NEXT / +2 / ...
    pub slug: String,
    pub secs_to_start: i64,
    pub secs_to_end: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AppSnapshot {
    pub slug: String,
    pub secs_to_end: u64,

    pub best_bid_up: f64,
    pub best_ask_up: f64,
    pub best_bid_down: Option<f64>,
    pub best_ask_down: Option<f64>,
    pub last_trade_price: Option<f64>,

    pub quote_bid_up: f64,
    pub quote_ask_up: f64,

    // Market list (active + next)
    pub active_slug: Option<String>,
    pub next_slug: Option<String>,
    pub ws_connected: Option<bool>,
    pub market_list: Vec<MarketRow>,

    pub cash_usdc: Option<f64>,
    pub inv_up_shares: Option<f64>,
    pub equity_usdc: Option<f64>,
    pub pol_balance: Option<f64>,
    pub withdrawn_usdc: Option<f64>,
    pub fills: Option<u64>,
    pub cancels: Option<u64>,
    pub fees_paid_usdc: Option<f64>,
    pub gas_paid_pol: Option<f64>,

    pub last_error: Option<String>,
}

pub fn run_tui(rx: watch::Receiver<AppSnapshot>, quit_tx: watch::Sender<bool>) -> std::io::Result<()> {
    let mut terminal = ratatui::init();

    let tick = Duration::from_millis(200);
    loop {
        let snap = rx.borrow().clone();
        terminal.draw(|f| draw(f, &snap))?;

        // input
        if ratatui::crossterm::event::poll(tick)? {
            if let ratatui::crossterm::event::Event::Key(k) = ratatui::crossterm::event::read()? {
                use ratatui::crossterm::event::KeyCode;
                if matches!(k.code, KeyCode::Char('q') | KeyCode::Esc) {
                    let _ = quit_tx.send(true);
                    break;
                }
            }
        }
    }

    ratatui::restore();
    Ok(())
}

fn draw(f: &mut Frame, s: &AppSnapshot) {
    let areas = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(8),
        Constraint::Length(8),
        Constraint::Min(3),
    ])
    .split(f.area());

    let header = Paragraph::new(vec![
        Line::from(vec![
            Span::styled("Polymarket BTC 5m MM", Style::default().fg(Color::Cyan)),
            Span::raw("  |  "),
            Span::raw(format!("slug: {}", s.slug)),
        ]),
        Line::from(format!(
            "secs_to_end: {}   ws: {}",
            s.secs_to_end,
            s.ws_connected
                .map(|x| if x { "ON" } else { "OFF" })
                .unwrap_or("N/A")
        )),
    ])
    .block(Block::bordered().title("Status"));
    f.render_widget(header, areas[0]);

    // Table market: active + next
    let active_slug = s.active_slug.clone().unwrap_or_else(|| "-".to_string());
    let next_slug = s.next_slug.clone().unwrap_or_else(|| "-".to_string());
    let rows = vec![
        Row::new(vec![
            Cell::from(Span::styled("● ACTIVE", Style::default().fg(Color::Green))),
            Cell::from(active_slug),
        ]),
        Row::new(vec![
            Cell::from(Span::styled("▶ NEXT", Style::default().fg(Color::Yellow))),
            Cell::from(next_slug),
        ]),
    ];
    let table = Table::new(rows, [Constraint::Length(10), Constraint::Min(10)])
        .block(Block::bordered().title("Market dipantau"))
        .column_spacing(1);
    f.render_widget(table, areas[1]);

    let up = format!("{:.4}/{:.4}", s.best_bid_up, s.best_ask_up);
    let down = match (s.best_bid_down, s.best_ask_down) {
        (Some(b), Some(a)) => format!("{b:.4}/{a:.4}"),
        _ => "N/A".to_string(),
    };
    let ltp = s
        .last_trade_price
        .map(|x| format!("{x:.4}"))
        .unwrap_or_else(|| "N/A".to_string());

    let quote = Paragraph::new(vec![
        Line::from(format!("BUY/SELL Up   (best bid/ask): {up}")),
        Line::from(format!("BUY/SELL Down (best bid/ask): {down}")),
        Line::from(format!("last_trade_price (gamma fallback): {ltp}")),
        Line::from(""),
        Line::from(format!(
            "Target quote Up: bid={:.4}  ask={:.4}",
            s.quote_bid_up, s.quote_ask_up
        )),
        Line::from(""),
        Line::from(vec![
            Span::raw("Tekan "),
            Span::styled("q", Style::default().fg(Color::Yellow)),
            Span::raw(" untuk keluar"),
        ]),
    ])
    .block(Block::bordered().title("Market / Quote"));
    f.render_widget(quote, areas[2]);

    let mut lines: Vec<Line> = vec![];
    if let Some(c) = s.cash_usdc {
        lines.push(Line::from(format!("cash_usdc: {:.2}", c)));
    }
    if let Some(inv) = s.inv_up_shares {
        lines.push(Line::from(format!("inv_up_shares: {:.4}", inv)));
    }
    if let Some(eq) = s.equity_usdc {
        lines.push(Line::from(format!("equity_usdc: {:.2}", eq)));
    }
    if let Some(pol) = s.pol_balance {
        lines.push(Line::from(format!("pol_balance: {:.6}", pol)));
    }
    if let Some(wd) = s.withdrawn_usdc {
        lines.push(Line::from(format!("withdrawn_usdc: {:.2}", wd)));
    }
    if let Some(fills) = s.fills {
        lines.push(Line::from(format!("fills: {}", fills)));
    }
    if let Some(cancels) = s.cancels {
        lines.push(Line::from(format!("cancels: {}", cancels)));
    }
    if let Some(fee) = s.fees_paid_usdc {
        lines.push(Line::from(format!("fees_paid_usdc: {:.4}", fee)));
    }
    if let Some(gas) = s.gas_paid_pol {
        lines.push(Line::from(format!("gas_paid_pol: {:.6}", gas)));
    }
    if let Some(err) = &s.last_error {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("last_error: ", Style::default().fg(Color::Red)),
            Span::raw(err),
        ]));
    }

    let sim = Paragraph::new(lines).block(Block::bordered().title("Sim / Portfolio"));
    f.render_widget(sim, areas[3]);
}
