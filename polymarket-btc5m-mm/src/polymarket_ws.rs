use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::Utf8Bytes;
use tracing::{info, warn};

#[derive(Clone, Debug, Default)]
pub struct WsMarketState {
    pub up_best_bid: Option<f64>,
    pub up_best_ask: Option<f64>,
    pub down_best_bid: Option<f64>,
    pub down_best_ask: Option<f64>,
    pub last_trade_price_up: Option<f64>,
    pub last_trade_price_down: Option<f64>,
    pub connected: bool,
}

#[derive(Clone, Debug)]
pub struct WsHandle {
    pub rx: watch::Receiver<WsMarketState>,
}

#[derive(Debug, Serialize)]
struct SubscribeMsg<'a> {
    #[serde(rename = "assets_ids")]
    assets_ids: [&'a str; 2],
    #[serde(rename = "type")]
    typ: &'static str,
    custom_feature_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "event_type")]
enum WsEvent {
    #[serde(rename = "book")]
    Book {
        #[serde(rename = "asset_id")]
        asset_id: String,
        bids: Vec<BookLevel>,
        asks: Vec<BookLevel>,
    },
    #[serde(rename = "best_bid_ask")]
    BestBidAsk {
        #[serde(rename = "asset_id")]
        asset_id: String,
        best_bid: String,
        best_ask: String,
    },
    #[serde(rename = "last_trade_price")]
    LastTradePrice {
        #[serde(rename = "asset_id")]
        asset_id: String,
        price: String,
    },
    // event lain kita ignore
    #[allow(dead_code)]
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct BookLevel {
    price: String,
    #[allow(dead_code)]
    size: String,
}

fn parse_f64(s: &str) -> Option<f64> {
    s.parse::<f64>().ok()
}

fn best_from_book(bids: &[BookLevel], asks: &[BookLevel]) -> Option<(f64, f64)> {
    let bid = bids.first().and_then(|x| parse_f64(&x.price))?;
    let ask = asks.first().and_then(|x| parse_f64(&x.price))?;
    Some((bid, ask))
}

pub async fn spawn_ws_market(
    ws_url: String,
    token_up: String,
    token_down: String,
) -> Result<WsHandle> {
    let (tx, rx) = watch::channel(WsMarketState::default());

    tokio::spawn(async move {
        loop {
            if let Err(e) = ws_loop(&ws_url, &token_up, &token_down, &tx).await {
                warn!(error=?e, "ws loop error, reconnect dalam 2s");
                let mut st = tx.borrow().clone();
                st.connected = false;
                let _ = tx.send(st);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    });

    Ok(WsHandle { rx })
}

async fn ws_loop(ws_url: &str, token_up: &str, token_down: &str, tx: &watch::Sender<WsMarketState>) -> Result<()> {
    let (mut ws, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .with_context(|| format!("connect ws: {ws_url}"))?;

    // subscribe
    let sub = SubscribeMsg {
        assets_ids: [token_up, token_down],
        typ: "market",
        custom_feature_enabled: true,
    };
    let sub_txt: Utf8Bytes = serde_json::to_string(&sub)?.into();
    ws.send(Message::Text(sub_txt)).await?;

    {
        let mut st = tx.borrow().clone();
        st.connected = true;
        let _ = tx.send(st);
    }
    info!("ws connected & subscribed");

    while let Some(msg) = ws.next().await {
        let msg = msg?;
        let text: String = match msg {
            Message::Text(t) => t.to_string(),
            Message::Binary(b) => String::from_utf8(b.to_vec()).map_err(|_| anyhow!("invalid utf8 ws binary"))?,
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Close(_) => return Err(anyhow!("ws closed")),
            _ => continue,
        };

        let evt: WsEvent = match serde_json::from_str(&text) {
            Ok(x) => x,
            Err(_) => continue,
        };

        let mut st = tx.borrow().clone();
        match evt {
            WsEvent::Book { asset_id, bids, asks } => {
                if let Some((bid, ask)) = best_from_book(&bids, &asks) {
                    if asset_id == token_up {
                        st.up_best_bid = Some(bid);
                        st.up_best_ask = Some(ask);
                    } else if asset_id == token_down {
                        st.down_best_bid = Some(bid);
                        st.down_best_ask = Some(ask);
                    }
                }
            }
            WsEvent::BestBidAsk { asset_id, best_bid, best_ask } => {
                let bid = parse_f64(&best_bid);
                let ask = parse_f64(&best_ask);
                if asset_id == token_up {
                    st.up_best_bid = bid;
                    st.up_best_ask = ask;
                } else if asset_id == token_down {
                    st.down_best_bid = bid;
                    st.down_best_ask = ask;
                }
            }
            WsEvent::LastTradePrice { asset_id, price } => {
                let p = parse_f64(&price);
                if asset_id == token_up {
                    st.last_trade_price_up = p;
                } else if asset_id == token_down {
                    st.last_trade_price_down = p;
                }
            }
            WsEvent::Other => {}
        }

        let _ = tx.send(st);
    }

    Err(anyhow!("ws stream ended"))
}
