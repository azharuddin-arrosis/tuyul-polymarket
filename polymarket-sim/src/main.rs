mod models;
mod polymarket;

use axum::{
    extract::{Path, Query, State},
    http::{Method, StatusCode},
    response::{Html, IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use chrono::Utc;
use models::*;
use polymarket::PolymarketClient;
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};
use uuid::Uuid;

// ─── App State ─────────────────────────────────────────────────────────────

struct AppState {
    portfolio: Mutex<Portfolio>,
    poly_client: PolymarketClient,
    // Simple market cache: id -> ParsedMarket
    market_cache: Mutex<HashMap<String, ParsedMarket>>,
}

// ─── Query Params ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct MarketsQuery {
    limit: Option<usize>,
    offset: Option<usize>,
    search: Option<String>,
    category: Option<String>,
}

// ─── Routes ────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("polymarket_sim=debug,tower_http=info")
        .init();

    let starting_capital: f64 = std::env::var("STARTING_CAPITAL")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1000.0);

    let state = Arc::new(AppState {
        portfolio: Mutex::new(Portfolio::new(starting_capital)),
        poly_client: PolymarketClient::new()?,
        market_cache: Mutex::new(HashMap::new()),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any);

    let app = Router::new()
        // Serve frontend
        .route("/", get(serve_frontend))
        // Market data (from Polymarket API)
        .route("/api/markets", get(get_markets))
        .route("/api/markets/:id", get(get_market))
        // Portfolio (paper trading)
        .route("/api/portfolio", get(get_portfolio))
        .route("/api/portfolio/stats", get(get_stats))
        .route("/api/portfolio/reset", post(reset_portfolio))
        // Trades
        .route("/api/trades", post(place_trade))
        .route("/api/trades/:id/resolve", post(resolve_trade))
        .route("/api/trades/:id/price", put(update_price))
        .route("/api/trades/:id", delete(close_trade))
        // Kelly calculator
        .route("/api/kelly", post(kelly_calculator))
        .layer(cors)
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);

    info!("🎯 Polymarket Simulator running at http://localhost:{}", port);
    info!("💰 Starting capital: ${:.0}", starting_capital);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ─── Frontend Handler ──────────────────────────────────────────────────────

async fn serve_frontend() -> impl IntoResponse {
    let html = include_str!("../static/index.html");
    Html(html)
}

// ─── Market Handlers ───────────────────────────────────────────────────────

async fn get_markets(
    State(state): State<Arc<AppState>>,
    Query(params): Query<MarketsQuery>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(50);
    let offset = params.offset.unwrap_or(0);

    let result = if let Some(ref q) = params.search {
        state.poly_client.search_markets(q, limit).await
    } else {
        state
            .poly_client
            .get_markets(limit, offset, params.category.as_deref())
            .await
    };

    match result {
        Ok(markets) => {
            // Cache markets
            let mut cache = state.market_cache.lock().unwrap();
            for m in &markets {
                cache.insert(m.id.clone(), m.clone());
            }
            (StatusCode::OK, Json(serde_json::json!({ "markets": markets, "count": markets.len() }))).into_response()
        }
        Err(e) => {
            error!("Failed to fetch markets: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": format!("Failed to fetch markets: {}", e) })),
            )
                .into_response()
        }
    }
}

async fn get_market(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Check cache first
    {
        let cache = state.market_cache.lock().unwrap();
        if let Some(m) = cache.get(&id) {
            return (StatusCode::OK, Json(serde_json::to_value(m).unwrap())).into_response();
        }
    }

    match state.poly_client.get_market(&id).await {
        Ok(Some(market)) => {
            let mut cache = state.market_cache.lock().unwrap();
            cache.insert(id, market.clone());
            (StatusCode::OK, Json(serde_json::to_value(&market).unwrap())).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Market not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ─── Portfolio Handlers ────────────────────────────────────────────────────

async fn get_portfolio(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let portfolio = state.portfolio.lock().unwrap();
    Json(serde_json::to_value(&*portfolio).unwrap())
}

async fn get_stats(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let portfolio = state.portfolio.lock().unwrap();
    Json(serde_json::to_value(portfolio.stats()).unwrap())
}

async fn reset_portfolio(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut portfolio = state.portfolio.lock().unwrap();
    let capital = portfolio.starting_capital;
    *portfolio = Portfolio::new(capital);
    Json(serde_json::json!({ "ok": true, "message": "Portfolio reset", "capital": capital }))
}

// ─── Trade Handlers ─────────────────────────────────────────────────────────

async fn place_trade(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TradeRequest>,
) -> impl IntoResponse {
    let mut portfolio = state.portfolio.lock().unwrap();

    // Validate
    if req.size_usdc <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "size_usdc must be positive" })),
        )
            .into_response();
    }

    if req.size_usdc > portfolio.cash {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("Insufficient cash. Available: ${:.2}, Requested: ${:.2}", portfolio.cash, req.size_usdc)
            })),
        )
            .into_response();
    }

    if req.entry_price <= 0.0 || req.entry_price >= 1.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "entry_price must be between 0 and 1" })),
        )
            .into_response();
    }

    if req.your_estimate <= 0.0 || req.your_estimate >= 1.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "your_estimate must be between 0 and 1" })),
        )
            .into_response();
    }

    let edge = req.your_estimate - req.entry_price;
    let shares = req.size_usdc / req.entry_price;
    let position_id = Uuid::new_v4().to_string();

    let position = Position {
        id: position_id.clone(),
        market_id: req.market_id.clone(),
        market_question: req.market_question.clone(),
        side: req.side.clone(),
        entry_price: req.entry_price,
        current_price: req.entry_price,
        size_usdc: req.size_usdc,
        shares,
        your_estimate: req.your_estimate,
        edge_at_entry: edge,
        status: PositionStatus::Open,
        created_at: Utc::now(),
        resolved_at: None,
        pnl: 0.0,
        notes: req.notes.unwrap_or_default(),
        end_date: req.end_date.unwrap_or_default(),
    };

    // Deduct cash
    portfolio.cash -= req.size_usdc;

    // Log event
    portfolio.trade_history.push(TradeEvent {
        timestamp: Utc::now(),
        event_type: "OPEN".to_string(),
        market: req.market_question.clone(),
        side: req.side.to_string(),
        amount: req.size_usdc,
        price: req.entry_price,
        pnl: None,
    });

    portfolio.positions.push(position);

    info!(
        "Trade opened: {} {} ${:.0} @ {:.2} (edge: {:.1}%)",
        req.side,
        req.market_question,
        req.size_usdc,
        req.entry_price,
        edge * 100.0
    );

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "ok": true,
            "position_id": position_id,
            "shares": shares,
            "edge": edge,
            "cash_remaining": portfolio.cash
        })),
    )
        .into_response()
}

async fn resolve_trade(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<ResolveRequest>,
) -> impl IntoResponse {
    let mut portfolio = state.portfolio.lock().unwrap();

    let pos_index = portfolio.positions.iter().position(|p| p.id == id);

    match pos_index {
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Position not found" })),
        )
            .into_response(),
        Some(idx) => {
            let mut pos = portfolio.positions.remove(idx);

            let pnl = match req.outcome {
                ResolveOutcome::Won => {
                    // Won: shares * $1 - invested
                    pos.shares - pos.size_usdc
                }
                ResolveOutcome::Lost => {
                    // Lost: lose entire investment
                    -pos.size_usdc
                }
            };

            let cash_back = pos.size_usdc + pnl;

            pos.status = match req.outcome {
                ResolveOutcome::Won => PositionStatus::Won,
                ResolveOutcome::Lost => PositionStatus::Lost,
            };
            pos.pnl = pnl;
            pos.resolved_at = Some(Utc::now());
            pos.current_price = match req.outcome {
                ResolveOutcome::Won => 1.0,
                ResolveOutcome::Lost => 0.0,
            };

            portfolio.cash += cash_back.max(0.0);

            portfolio.trade_history.push(TradeEvent {
                timestamp: Utc::now(),
                event_type: format!("RESOLVED_{}", pos.status.to_string().to_uppercase()),
                market: pos.market_question.clone(),
                side: pos.side.to_string(),
                amount: pos.size_usdc,
                price: pos.current_price,
                pnl: Some(pnl),
            });

            let outcome_str = format!("{:?}", pos.status);
            portfolio.closed_positions.push(pos);

            info!(
                "Trade resolved: {} P&L: ${:.2}, Cash back: ${:.2}",
                outcome_str, pnl, cash_back
            );

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "ok": true,
                    "outcome": outcome_str,
                    "pnl": pnl,
                    "cash_back": cash_back,
                    "new_cash": portfolio.cash
                })),
            )
                .into_response()
        }
    }
}

async fn update_price(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdatePriceRequest>,
) -> impl IntoResponse {
    let mut portfolio = state.portfolio.lock().unwrap();

    match portfolio.positions.iter_mut().find(|p| p.id == id) {
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Position not found" })),
        )
            .into_response(),
        Some(pos) => {
            let old_price = pos.current_price;
            pos.current_price = req.new_price;
            let unrealized = pos.unrealized_pnl();

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "ok": true,
                    "old_price": old_price,
                    "new_price": req.new_price,
                    "unrealized_pnl": unrealized,
                    "unrealized_pnl_pct": pos.unrealized_pnl_pct()
                })),
            )
                .into_response()
        }
    }
}

async fn close_trade(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut portfolio = state.portfolio.lock().unwrap();

    let pos_index = portfolio.positions.iter().position(|p| p.id == id);

    match pos_index {
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Position not found" })),
        )
            .into_response(),
        Some(idx) => {
            let mut pos = portfolio.positions.remove(idx);

            // Close at current price
            let proceeds = pos.current_price * pos.shares;
            let pnl = proceeds - pos.size_usdc;

            pos.status = PositionStatus::Closed;
            pos.pnl = pnl;
            pos.resolved_at = Some(Utc::now());

            portfolio.cash += proceeds;

            portfolio.trade_history.push(TradeEvent {
                timestamp: Utc::now(),
                event_type: "CLOSED".to_string(),
                market: pos.market_question.clone(),
                side: pos.side.to_string(),
                amount: pos.size_usdc,
                price: pos.current_price,
                pnl: Some(pnl),
            });

            portfolio.closed_positions.push(pos);

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "ok": true,
                    "proceeds": proceeds,
                    "pnl": pnl,
                    "new_cash": portfolio.cash
                })),
            )
                .into_response()
        }
    }
}

// ─── Kelly Handler ─────────────────────────────────────────────────────────

async fn kelly_calculator(Json(req): Json<KellyRequest>) -> impl IntoResponse {
    if req.your_probability <= 0.0 || req.your_probability >= 1.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "your_probability must be between 0 and 1" })),
        )
            .into_response();
    }
    if req.market_price <= 0.0 || req.market_price >= 1.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "market_price must be between 0 and 1" })),
        )
            .into_response();
    }

    let result = calculate_kelly(&req);
    (StatusCode::OK, Json(serde_json::to_value(result).unwrap())).into_response()
}

// ─── Helper ────────────────────────────────────────────────────────────────

impl std::fmt::Display for PositionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            PositionStatus::Open => write!(f, "Open"),
            PositionStatus::Won => write!(f, "Won"),
            PositionStatus::Lost => write!(f, "Lost"),
            PositionStatus::Closed => write!(f, "Closed"),
        }
    }
}
