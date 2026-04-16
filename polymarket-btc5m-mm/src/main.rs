mod app_config;
mod math;
mod polymarket_clob;
mod polymarket_gamma;
mod polymarket_ws;
mod risk;
mod sim;
mod strategy;
mod types;
mod ui;
mod web_ui;

use anyhow::{Context, Result};
use clap::Parser;
use chrono::{DateTime, Utc};
use app_config::AppConfig;
use polymarket_clob::ClobClient;
use polymarket_gamma::GammaClient;
use polymarket_ws::{spawn_ws_market, WsHandle};
use risk::{InventoryState, RiskEngine};
use sim::PaperSim;
use strategy::{QuoteDecision, Strategy};
use tokio::sync::watch;
use tokio::time::{interval, Duration};
use ui::AppSnapshot;
use ui::MarketRow;
use tracing::{info, warn};

#[derive(Parser, Debug)]
struct Args {
    /// Path config TOML
    #[arg(long, default_value = "config.toml")]
    config: String,

    /// Mode run: dry | paper | live
    #[arg(long, default_value = "paper")]
    mode: String,

    /// Override saldo USDC untuk mode paper
    #[arg(long)]
    sim_usdc: Option<f64>,

    /// Override saldo POL untuk mode paper
    #[arg(long)]
    sim_pol: Option<f64>,

    /// Jalankan UI terminal (TUI). Tekan q untuk keluar.
    #[arg(long, default_value_t = false)]
    ui: bool,

    /// Jalankan Web UI (HTML realtime via SSE).
    #[arg(long, default_value_t = false)]
    web: bool,

    /// Bind address Web UI (contoh: 127.0.0.1 atau 0.0.0.0)
    #[arg(long, default_value = "127.0.0.1")]
    web_bind: String,

    /// Port Web UI
    #[arg(long, default_value_t = 8080)]
    web_port: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let cfg = AppConfig::load(&args.config).context("gagal load config")?;

    // Saat UI aktif, jangan spam log 1 detik karena bakal "ngacak" tampilan terminal.
    // Default: ui => warn, non-ui => info
    let default_log = if args.ui || args.web {
        "warn,reqwest=warn"
    } else {
        "info,reqwest=warn"
    };
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| default_log.to_string()))
        .init();

    info!("mulai bot: tick={}s mode={}", cfg.bot.tick_interval_secs, args.mode);

    let gamma = GammaClient::new(cfg.endpoints.gamma_http.clone())?;
    let clob = ClobClient::new(cfg.endpoints.clob_http.clone())?;

    let mut strat = Strategy::new(cfg.clone());
    let mut risk = RiskEngine::new(cfg.clone());
    let mut inv = InventoryState::default(); // TODO: load posisi dari Data API / wallet
    let mut sim = if args.mode == "paper" {
        let usdc = args.sim_usdc.unwrap_or(cfg.sim.starting_usdc);
        let pol = args.sim_pol.unwrap_or(cfg.sim.starting_pol);
        Some(PaperSim::new(cfg.clone(), usdc, pol))
    } else {
        None
    };
    let mut ws: Option<WsHandle> = None;

    if args.ui || args.web {
        let (snap_tx, snap_rx) = watch::channel(AppSnapshot::default());
        let (quit_tx, mut quit_rx) = watch::channel(false);

        // Spawn TUI (optional). Saat user tekan 'q', TUI akan set quit=true.
        if args.ui {
            let rx = snap_rx.clone();
            let tx = quit_tx.clone();
            tokio::task::spawn_blocking(move || ui::run_tui(rx, tx));
        }

        // Spawn Web UI (optional)
        if args.web {
            let bind: std::net::SocketAddr = format!("{}:{}", args.web_bind, args.web_port)
                .parse()
                .context("invalid web bind/port")?;
            let rx = snap_rx.clone();
            tokio::spawn(async move {
                if let Err(e) = web_ui::serve_web(bind, rx).await {
                    warn!(error=?e, "Web UI error (server berhenti)");
                }
            });
            info!("Web UI jalan di http://{}:{}/", args.web_bind, args.web_port);
        }

        let mut ticker = interval(Duration::from_secs(cfg.bot.tick_interval_secs));
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if let Err(e) = tick(
                        &cfg,
                        &args.mode,
                        &gamma,
                        &clob,
                        &mut strat,
                        &mut risk,
                        &mut inv,
                        &mut sim,
                        &mut ws,
                        Some(&snap_tx),
                    ).await {
                        let _ = snap_tx.send(AppSnapshot{ last_error: Some(format!("{e:?}")), ..snap_tx.borrow().clone()});
                        warn!(error=?e, "tick error");
                    }
                }
                _ = quit_rx.changed(), if args.ui => {
                    if *quit_rx.borrow() {
                        break;
                    }
                }
                _ = tokio::signal::ctrl_c() => {
                    break;
                }
            }
        }

        return Ok(());
    }

    let mut ticker = interval(Duration::from_secs(cfg.bot.tick_interval_secs));
    loop {
        ticker.tick().await;
        if let Err(e) = tick(
            &cfg,
            &args.mode,
            &gamma,
            &clob,
            &mut strat,
            &mut risk,
            &mut inv,
            &mut sim,
            &mut ws,
            None,
        )
        .await
        {
            warn!(error=?e, "tick error");
        }
    }
}

async fn tick(
    cfg: &AppConfig,
    mode: &str,
    gamma: &GammaClient,
    clob: &ClobClient,
    strat: &mut Strategy,
    risk: &mut RiskEngine,
    inv: &mut InventoryState,
    sim: &mut Option<PaperSim>,
    ws: &mut Option<WsHandle>,
    snap_tx: Option<&watch::Sender<AppSnapshot>>,
) -> Result<()> {
    let now = Utc::now();
    let window_start = types::window_start_epoch(now, 300);
    let slug = format!("{}{}", cfg.bot.slug_prefix, window_start);
    let next_slug = format!("{}{}", cfg.bot.slug_prefix, window_start + 300);
    let now_ts = now.timestamp();

    // Refresh metadata kalau window ganti / belum ada.
    if strat.current_slug() != Some(slug.as_str()) {
        info!(%slug, "ganti window");
        let meta = gamma.fetch_window_metadata(&slug).await?;
        strat.set_window(meta)?;
        risk.on_new_window(now);
        inv.on_new_window(now);
        if let Some(sim) = sim.as_mut() {
            sim.on_new_window(&slug, strat.window().unwrap().end_time);
        }

        // spawn ws untuk market aktif (up+down) supaya best bid/ask realtime
        let w = strat.window().unwrap();
        *ws = Some(spawn_ws_market(
            cfg.endpoints.clob_ws_market.clone(),
            w.token_up.clone(),
            w.token_down.clone(),
        ).await?);
    }

    let window = strat.window().context("window belum siap")?;
    let end: DateTime<Utc> = window.end_time;
    let secs_to_end = (end - now).num_seconds().max(0) as u64;

    // Risk gate: flatten zone
    if secs_to_end <= cfg.bot.flatten_start_secs {
        info!(secs_to_end, "flatten zone: stop quoting, fokus flatten inventory (TODO live)");
        // TODO live: cancel semua order + flatten inventory
        return Ok(());
    }

    // Ambil best bid/ask + last trade.
    // Priority:
    // 1) WebSocket (realtime)
    // 2) REST CLOB /book
    // 3) Gamma market state (fallback)
    let mut last_trade_price: Option<f64> = None;
    let mut ws_connected: Option<bool> = None;
    let mut best_bid_down: Option<f64> = None;
    let mut best_ask_down: Option<f64> = None;

    let (best_bid_up, best_ask_up) = if let Some(ws) = ws.as_ref() {
        let st = ws.rx.borrow().clone();
        ws_connected = Some(st.connected);
        last_trade_price = st.last_trade_price_up;
        best_bid_down = st.down_best_bid;
        best_ask_down = st.down_best_ask;
        match (st.up_best_bid, st.up_best_ask) {
            (Some(b), Some(a)) => (b, a),
            _ => {
                // fallback REST
                let ob = clob.get_order_book(&window.token_up).await?;
                let best = ob.best_bid_ask().context("orderbook kosong (up)")?;
                (best.best_bid, best.best_ask)
            }
        }
    } else {
        match clob.get_order_book(&window.token_up).await {
            Ok(ob) => {
                let best = ob.best_bid_ask().context("orderbook kosong (up)")?;
                (best.best_bid, best.best_ask)
            }
            Err(e) => {
                warn!(error=?e, "gagal akses CLOB /book (Up), fallback ke Gamma");
                let st = gamma.fetch_market_state(&slug).await?;
                last_trade_price = st.last_trade_price;
                (st.best_bid, st.best_ask)
            }
        }
    };

    let mid = (best_bid_up + best_ask_up) / 2.0;
    strat.observe_mid(mid);

    // Estimasi vol dari perubahan mid (proxy)
    let vol = strat.rolling_vol();

    // Hitung decision quote
    let decision: QuoteDecision = strat.make_quotes(now, secs_to_end, mid, vol, inv)?;

    // Gate dari risk engine
    risk.check(&decision, inv)?;

    match mode {
        "paper" => {
            if let Some(sim) = sim.as_mut() {
                // update inventory state utk skew (pakai marked-to-market inventory)
                inv.inventory_usdc = sim.inv_up_shares * mid;

                sim.maybe_requote(decision, mid)?;
                sim.on_tick(mid, last_trade_price, secs_to_end)?;
                sim.maybe_harvest(mid);

                // Jangan spam log saat UI aktif.
                if snap_tx.is_none() {
                    info!(
                        secs_to_end,
                        mid = %format!("{:.4}", mid),
                        bid = %format!("{:.4}", decision.bid),
                        ask = %format!("{:.4}", decision.ask),
                        cash = %format!("{:.2}", sim.cash_usdc),
                        inv_shares = %format!("{:.4}", sim.inv_up_shares),
                        equity = %format!("{:.2}", sim.equity_marked(mid)),
                        pol = %format!("{:.6}", sim.pol_balance),
                        wd = %format!("{:.2}", sim.withdrawn_usdc),
                        fills = sim.stats.fills,
                        "PAPER tick"
                    );
                }
            }
        }
        "dry" => {
            if snap_tx.is_none() {
                info!(
                    secs_to_end,
                    p_mid = %format!("{:.4}", mid),
                    vol = %format!("{:.6}", vol),
                    bid = %format!("{:.4}", decision.bid),
                    ask = %format!("{:.4}", decision.ask),
                    size = %format!("{:.2}", decision.size_usdc),
                    "DRY RUN quote"
                );
            }
        }
        "live" => {
            // TODO: implement executor live (SDK rs-clob-client atau REST + signing)
            warn!("mode live belum di-implement di scaffold ini (lihat README)");
        }
        _ => {
            warn!(%mode, "mode tidak dikenal (pakai: paper|dry|live)");
        }
    }

    if let Some(tx) = snap_tx {
        let mut snap = tx.borrow().clone();
        snap.slug = slug.clone();
        snap.active_slug = Some(slug.clone());
        snap.next_slug = Some(next_slug);
        snap.ws_connected = ws_connected;
        snap.secs_to_end = secs_to_end;
        snap.best_bid_up = best_bid_up;
        snap.best_ask_up = best_ask_up;
        snap.best_bid_down = best_bid_down;
        snap.best_ask_down = best_ask_down;
        snap.last_trade_price = last_trade_price;
        snap.quote_bid_up = decision.bid;
        snap.quote_ask_up = decision.ask;

        // List market (compact) untuk beberapa window ke depan
        // Untuk seri 5m, kita bisa hitung slug dari epoch (tanpa call API tambahan).
        let mut list: Vec<MarketRow> = Vec::with_capacity(10);
        for i in 0..10_i64 {
            let start_i = window_start + i * 300;
            let end_i = start_i + 300;
            let tag = if i == 0 {
                "ACTIVE".to_string()
            } else if i == 1 {
                "NEXT".to_string()
            } else {
                format!("+{}", i)
            };
            let slug_i = format!("{}{}", cfg.bot.slug_prefix, start_i);
            list.push(MarketRow {
                tag,
                slug: slug_i,
                secs_to_start: start_i - now_ts,
                secs_to_end: end_i - now_ts,
            });
        }
        snap.market_list = list;

        if let Some(sim) = sim.as_ref() {
            snap.cash_usdc = Some(sim.cash_usdc);
            snap.inv_up_shares = Some(sim.inv_up_shares);
            snap.equity_usdc = Some(sim.equity_marked(mid));
            snap.pol_balance = Some(sim.pol_balance);
            snap.withdrawn_usdc = Some(sim.withdrawn_usdc);
            snap.fills = Some(sim.stats.fills);
            snap.cancels = Some(sim.stats.cancels);
            snap.fees_paid_usdc = Some(sim.stats.fees_paid_usdc);
            snap.gas_paid_pol = Some(sim.stats.gas_paid_pol);
        }
        snap.last_error = None;
        let _ = tx.send(snap);
    }

    Ok(())
}
