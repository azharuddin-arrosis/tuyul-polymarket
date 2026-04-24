use axum::{
    extract::State,
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse,
    },
    routing::get,
    Json, Router,
};
use std::{convert::Infallible, net::SocketAddr, time::Duration};
use tokio::sync::watch;
use tokio_stream::{wrappers::IntervalStream, StreamExt};

use crate::ui::AppSnapshot;

#[derive(Clone)]
pub struct WebState {
    pub snap_rx: watch::Receiver<AppSnapshot>,
}

pub async fn serve_web(
    bind: SocketAddr,
    snap_rx: watch::Receiver<AppSnapshot>,
) -> anyhow::Result<()> {
    let state = WebState { snap_rx };

    let app = Router::new()
        .route("/", get(index))
        .route("/state", get(get_state))
        .route("/events", get(sse_events))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn index() -> impl IntoResponse {
    Html(INDEX_HTML)
}

async fn get_state(State(st): State<WebState>) -> impl IntoResponse {
    Json(st.snap_rx.borrow().clone())
}

async fn sse_events(State(st): State<WebState>) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    // Throttle ke 1 detik biar UI web tidak berat walaupun WS update sangat sering.
    let rx = st.snap_rx.clone();
    let stream = IntervalStream::new(tokio::time::interval(Duration::from_millis(1000))).map(move |_| {
        let snap = rx.borrow().clone();
        let json = serde_json::to_string(&snap).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().event("snapshot").data(json))
    });

    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10)).text("keepalive"))
}

const INDEX_HTML: &str = r#"<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Polymarket BTC 5m MM</title>
  <style>
    :root {
      --bg: #0b1020; --panel: #121a33; --text: #e8ecff; --muted: #97a0c3;
      --green: #3ddc97; --yellow: #ffd166; --red: #ff5c7a; --blue: #66b3ff;
      --border: rgba(255,255,255,.08);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    }
    body { margin:0; background:var(--bg); color:var(--text); font-size: 12px; }
    .wrap { max-width: 1200px; margin: 10px auto; padding: 0 10px; }
    .top { display:flex; gap:10px; align-items:center; justify-content:space-between; }
    .title { font-size: 14px; font-weight: 800; letter-spacing: .2px; }
    .pill { display:inline-flex; align-items:center; gap:8px; padding:5px 8px; border:1px solid var(--border); border-radius:999px; background:rgba(255,255,255,.03); color:var(--muted); font-size:11px; }
    .dot { width:10px; height:10px; border-radius:50%; background:var(--red); }
    .dot.on { background: var(--green); }
    .card { background: var(--panel); border:1px solid var(--border); border-radius:10px; padding:10px; }
    .card h3 { margin:0 0 8px 0; font-size:12px; color:var(--muted); font-weight:700; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    td, th { padding:5px 6px; border:1px solid var(--border); vertical-align:middle; }
    th { text-align:left; color:var(--muted); font-weight:700; background:rgba(255,255,255,.03); }
    .tag { font-weight:700; }
    .tag.active { color: var(--green); }
    .tag.next { color: var(--yellow); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .k { color: var(--muted); }
    .v { color: var(--text); font-weight:600; }
    .row { display:flex; gap:10px; flex-wrap:wrap; }
    .metric { flex: 1 1 140px; padding:8px; border:1px solid var(--border); border-radius:10px; background:rgba(255,255,255,.02); }
    .metric .k { font-size:11px; }
    .metric .v { font-size:13px; margin-top:4px; }
    .err { color: var(--red); font-weight:700; }
    .muted { color: var(--muted); }

    .grid2 { margin-top:10px; display:grid; grid-template-columns: 1.2fr .8fr; gap:10px; align-items:start; }
    .tabs { display:flex; gap:6px; margin: 6px 0 10px 0; }
    .tab { cursor:pointer; user-select:none; padding:6px 8px; border:1px solid var(--border); border-radius:8px; background:rgba(255,255,255,.02); color:var(--muted); font-weight:700; font-size:11px; }
    .tab.on { color: var(--text); border-color: rgba(102,179,255,.45); background: rgba(102,179,255,.12); }
    .scroll { max-height: 260px; overflow:auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="title">Polymarket BTC 5m MM — Dashboard</div>
      <div class="pill"><span id="wsDot" class="dot"></span><span>WS</span><span id="wsTxt">N/A</span> • <span>secs_to_end</span><span id="secs" class="mono">-</span></div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Daftar market (ACTIVE + berikutnya)</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th style="width:70px;">Tag</th>
                <th>Slug</th>
                <th style="width:90px;">Start (s)</th>
                <th style="width:90px;">End (s)</th>
              </tr>
            </thead>
            <tbody id="mkRows"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Harga (kecil-kecil ala Excel)</h3>
        <div class="tabs">
          <div id="tabBuy" class="tab on">BUY</div>
          <div id="tabSell" class="tab">SELL</div>
        </div>
        <table>
          <tr><th></th><th>Up</th><th>Down</th></tr>
          <tr><td class="k" id="pxLabel">BUY price</td><td class="v mono" id="pxUp">-</td><td class="v mono" id="pxDown">-</td></tr>
          <tr><td class="k">Best bid/ask Up</td><td class="mono" id="upBA" colspan="2">-</td></tr>
          <tr><td class="k">Best bid/ask Down</td><td class="mono" id="downBA" colspan="2">-</td></tr>
          <tr><td class="k">Target quote Up</td><td class="v mono" id="quoteUp" colspan="2">-</td></tr>
          <tr><td class="k">last_trade_price</td><td class="mono" id="ltp" colspan="2">-</td></tr>
        </table>
        <div class="muted" style="margin-top:8px;">Tip: BUY = best ask, SELL = best bid</div>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h3>Sim / Portfolio</h3>
      <div class="row">
        <div class="metric"><div class="k">cash_usdc</div><div class="v mono" id="cash">-</div></div>
        <div class="metric"><div class="k">inv_up_shares</div><div class="v mono" id="inv">-</div></div>
        <div class="metric"><div class="k">equity_usdc</div><div class="v mono" id="eq">-</div></div>
        <div class="metric"><div class="k">pol_balance</div><div class="v mono" id="pol">-</div></div>
        <div class="metric"><div class="k">withdrawn_usdc</div><div class="v mono" id="wd">-</div></div>
        <div class="metric"><div class="k">fills / cancels</div><div class="v mono" id="fc">-</div></div>
        <div class="metric"><div class="k">fees_paid_usdc</div><div class="v mono" id="fees">-</div></div>
        <div class="metric"><div class="k">gas_paid_pol</div><div class="v mono" id="gas">-</div></div>
      </div>
      <div id="err" class="muted" style="margin-top:10px;"></div>
    </div>
  </div>

<script>
  const el = (id) => document.getElementById(id);
  let mode = "BUY"; // BUY atau SELL
  function fmt(x, d=4) {
    if (x === null || x === undefined) return "-";
    if (typeof x !== "number") return String(x);
    return x.toFixed(d);
  }
  function fmt2(x) { return fmt(x, 2); }
  function setWs(v) {
    el("wsTxt").textContent = v ? "ON" : "OFF";
    el("wsDot").classList.toggle("on", !!v);
  }
  function applySnap(s) {
    el("secs").textContent = s.secs_to_end ?? "-";
    if (s.ws_connected !== null && s.ws_connected !== undefined) setWs(s.ws_connected);

    el("upBA").textContent = `${fmt(s.best_bid_up)} / ${fmt(s.best_ask_up)}`;
    el("downBA").textContent = (s.best_bid_down && s.best_ask_down) ? `${fmt(s.best_bid_down)} / ${fmt(s.best_ask_down)}` : "N/A";
    el("ltp").textContent = s.last_trade_price ? fmt(s.last_trade_price) : "N/A";
    el("quoteUp").textContent = `bid=${fmt(s.quote_bid_up)} ask=${fmt(s.quote_ask_up)}`;

    // price view (BUY/SELL x Up/Down)
    const buyUp = s.best_ask_up;
    const sellUp = s.best_bid_up;
    const buyDown = (s.best_ask_down ?? null);
    const sellDown = (s.best_bid_down ?? null);
    if (mode === "BUY") {
      el("pxLabel").textContent = "BUY price";
      el("pxUp").textContent = fmt(buyUp);
      el("pxDown").textContent = buyDown != null ? fmt(buyDown) : "N/A";
    } else {
      el("pxLabel").textContent = "SELL price";
      el("pxUp").textContent = fmt(sellUp);
      el("pxDown").textContent = sellDown != null ? fmt(sellDown) : "N/A";
    }

    // market list
    const rows = (s.market_list || []).map(r => {
      const tagClass = r.tag === "ACTIVE" ? "tag active" : (r.tag === "NEXT" ? "tag next" : "tag");
      return `<tr>
        <td class="${tagClass}">${r.tag}</td>
        <td class="mono">${r.slug}</td>
        <td class="mono">${r.secs_to_start}</td>
        <td class="mono">${r.secs_to_end}</td>
      </tr>`;
    }).join("");
    el("mkRows").innerHTML = rows || `<tr><td colspan="4" class="muted">-</td></tr>`;

    el("cash").textContent = s.cash_usdc != null ? fmt2(s.cash_usdc) : "-";
    el("inv").textContent = s.inv_up_shares != null ? fmt(s.inv_up_shares, 4) : "-";
    el("eq").textContent = s.equity_usdc != null ? fmt2(s.equity_usdc) : "-";
    el("pol").textContent = s.pol_balance != null ? fmt(s.pol_balance, 6) : "-";
    el("wd").textContent = s.withdrawn_usdc != null ? fmt2(s.withdrawn_usdc) : "-";
    el("fc").textContent = (s.fills != null || s.cancels != null) ? `${s.fills ?? 0} / ${s.cancels ?? 0}` : "-";
    el("fees").textContent = s.fees_paid_usdc != null ? fmt(s.fees_paid_usdc, 4) : "-";
    el("gas").textContent = s.gas_paid_pol != null ? fmt(s.gas_paid_pol, 6) : "-";

    if (s.last_error) {
      el("err").innerHTML = `<span class="err">last_error:</span> <span class="mono">${s.last_error}</span>`;
    } else {
      el("err").textContent = "";
    }
  }

  // init fetch
  fetch("/state").then(r => r.json()).then(applySnap).catch(() => {});
  // realtime via SSE
  const es = new EventSource("/events");
  es.addEventListener("snapshot", (ev) => {
    try { applySnap(JSON.parse(ev.data)); } catch (_) {}
  });
  es.onerror = () => { setWs(false); };

  // tabs
  el("tabBuy").onclick = () => { mode = "BUY"; el("tabBuy").classList.add("on"); el("tabSell").classList.remove("on"); fetch("/state").then(r=>r.json()).then(applySnap); };
  el("tabSell").onclick = () => { mode = "SELL"; el("tabSell").classList.add("on"); el("tabBuy").classList.remove("on"); fetch("/state").then(r=>r.json()).then(applySnap); };
</script>
</body>
</html>
"#;
