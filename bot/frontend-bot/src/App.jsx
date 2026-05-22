import { useState, useEffect, useMemo, useRef } from 'react'
import { useBot } from './hooks/useBot.js'

// ─── FORMATTERS ──────────────────────────────────────────────
// USD/IDR exchange rate — fetched on app start, fallback to default
let USD_IDR = 16250
// Try free public APIs (no auth). Fallback chain ensures it works even if blocked.
const fetchUsdIdr = async () => {
  const sources = [
    { url: 'https://open.er-api.com/v6/latest/USD', pick: d => d?.rates?.IDR },
    { url: 'https://api.exchangerate-api.com/v4/latest/USD', pick: d => d?.rates?.IDR },
    { url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', pick: d => d?.usd?.idr },
  ]
  for (const s of sources) {
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(5000) })
      if (!r.ok) continue
      const d = await r.json()
      const rate = s.pick(d)
      if (rate && rate > 1000 && rate < 50000) {
        USD_IDR = Math.round(rate)
        try { localStorage.setItem('usd_idr', JSON.stringify({ rate: USD_IDR, ts: Date.now() })) } catch {}
        return USD_IDR
      }
    } catch { /* try next */ }
  }
  return USD_IDR
}
// Load cached rate immediately (if fresh within 24h)
try {
  const cached = JSON.parse(localStorage.getItem('usd_idr') || 'null')
  if (cached?.rate && (Date.now() - cached.ts) < 86400000) USD_IDR = cached.rate
} catch {}
// Fire fetch in background
if (typeof window !== 'undefined') fetchUsdIdr()

const usd     = (n, d=2) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const cents   = (n) => n == null ? '—' : `${Math.round(Number(n) * 100)}¢`
const pct     = (n, d=1) => n == null ? '—' : `${Number(n).toFixed(d)}%`
const sgnUsd  = (n) => { const v = Number(n||0); return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}` }
const sgnPct  = (n) => { const v = Number(n||0); return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
const num     = (n, d=2) => n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const pad2    = (n) => String(n).padStart(2, '0')
const mmss    = (s) => { if (s == null || s < 0) return '0:00'; const m = Math.floor(s/60), x = s%60; return `${m}:${pad2(x)}` }
// Local-timezone YYYY-MM-DD (calendar grouping should follow user's wall clock, not UTC)
const localDateKey = (input) => {
  const d = typeof input === 'string' ? new Date(input) : (input || new Date())
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
}
// Dual timezone formatters — Local (browser) + ET (Polymarket)
const dualTime = (iso) => {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const local = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    const et    = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
    return `${local} · ${et.replace(' ', '')} ET`
  } catch { return iso }
}
const dualDateTime = (iso) => {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const local = d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    const et    = d.toLocaleString('en-US',  { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/New_York' })
    return `${local} · ${et} ET`
  } catch { return iso }
}
// IDR helpers
const idrFmt  = (n) => {
  if (n == null) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e9) return `Rp ${(n/1e9).toFixed(2)}M`   // Miliar
  if (v >= 1e6) return `Rp ${(n/1e6).toFixed(2)}jt`  // juta
  if (v >= 1e3) return `Rp ${Math.round(n/1e3)}rb`
  return `Rp ${Math.round(n)}`
}
const usdToIdr = (n) => n == null ? '—' : idrFmt(Number(n) * USD_IDR)
const sgnIdr   = (n) => { const v = Number(n||0); const sign = v >= 0 ? '+' : '-'; return `${sign}${idrFmt(Math.abs(v) * USD_IDR)}` }

// ─── LATENCY MONITOR ─────────────────────────────────────────
function useLatency() {
  const [lat, setLat] = useState({ binance: null, polymarket: null, backend: null })
  useEffect(() => {
    const ping = async (url, key) => {
      const t0 = performance.now()
      try {
        const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (!r.ok && r.status !== 0) throw new Error(r.status)
        const ms = Math.round(performance.now() - t0)
        setLat(prev => ({ ...prev, [key]: ms }))
      } catch {
        setLat(prev => ({ ...prev, [key]: -1 }))
      }
    }
    const tick = () => {
      ping('https://api.binance.com/api/v3/ping', 'binance')
      ping('https://clob.polymarket.com/time', 'polymarket')
      ping('/health', 'backend')
    }
    tick()
    const id = setInterval(tick, 8000)
    return () => clearInterval(id)
  }, [])
  return lat
}
// Color thresholds: excellent (white) < 150 < ok (blue) < 400 < slow (amber) < 800 < bad (red)
const latColor = (ms) => {
  if (ms == null) return 'var(--dim)'
  if (ms < 0)    return 'var(--red)'
  if (ms < 150)  return 'var(--white)'
  if (ms < 400)  return 'var(--blue)'
  if (ms < 800)  return 'var(--amber)'
  return 'var(--red)'
}
function LatencyChip({ label, ms }) {
  const c = latColor(ms)
  const txt = ms == null ? '...' : ms < 0 ? 'DOWN' : `${ms}ms`
  return (
    <span title={`${label} latency`}>
      <span style={{ color: 'var(--dim)', fontSize: 8, letterSpacing: '.07em' }}>{label}</span>{' '}
      <span style={{ color: c, fontWeight: 600 }}>{txt}</span>
    </span>
  )
}

const ASSETS = [
  { sym: 'BTC',  active: true  },
  { sym: 'ETH',  active: false },
  { sym: 'SOL',  active: false },
  { sym: 'XRP',  active: false },
  { sym: 'DOGE', active: false },
  { sym: 'BNB',  active: false },
  { sym: 'HYPE', active: false },
]

// ─── TRI-CLOCK ───────────────────────────────────────────────
function useNow() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id) }, [])
  return t
}
function TriClock() {
  const t = useNow()
  const fmt = (tz) => {
    const d = new Date(t.toLocaleString('en-US', { timeZone: tz }))
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }
  return (
    <div className="px-3 py-1.5" style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '.05em', border: '1px solid var(--border2)', borderRadius: 2 }}>
      UTC <span style={{ color: 'var(--white)' }}>{fmt('UTC')}</span>
      {'  |  '}
      UTC+7 <span style={{ color: 'var(--white)' }}>{fmt('Asia/Jakarta')}</span>
      {'  |  '}
      ET <span style={{ color: 'var(--white)' }}>{fmt('America/New_York')} {new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true }).match(/(AM|PM)/)?.[1] || ''}</span>
    </div>
  )
}

// ─── MODE TOGGLE BUTTON ──────────────────────────────────────
function ModeToggle({ config, setMode }) {
  const cur = (config?.mode || 'sim').toLowerCase()
  const credsReady = config?.credentials_ready
  const modes = [
    { key: 'sim',     label: 'SIM',     color: 'var(--green)', desc: 'simulated' },
    { key: 'dry_run', label: 'DRY-RUN', color: 'var(--amber)', desc: 'real data, no orders' },
    { key: 'real',    label: 'REAL',    color: 'var(--red)',   desc: 'live money' },
  ]
  const tryToggle = async (k) => {
    if (k === cur) return
    if (k === 'real') {
      if (!credsReady) { alert('Real mode butuh POLY_PRIVATE_KEY + POLY_API_KEY di env'); return }
      if (!confirm('Switch ke REAL MONEY mode?\n\nBot akan place real orders di Polymarket.\nYakin?')) return
    }
    const res = await setMode(k)
    if (res?.ok === false) alert(`Mode change failed: ${res.reason}`)
  }
  return (
    <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border2)', borderRadius: 2 }}>
      {modes.map(m => {
        const active = cur === m.key
        const disabled = m.key === 'real' && !credsReady
        return (
          <button key={m.key} title={disabled ? 'no creds' : m.desc}
            onClick={() => tryToggle(m.key)}
            disabled={disabled}
            style={{
              fontSize: 9, fontFamily: 'var(--mono)', padding: '4px 12px',
              background: active ? `${m.color}22` : 'transparent',
              color: active ? m.color : disabled ? 'var(--dim2)' : 'var(--dim)',
              border: 'none',
              borderRight: m.key !== 'real' ? '1px solid var(--border2)' : 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              letterSpacing: '.07em', fontWeight: active ? 700 : 400,
            }}>{m.label}</button>
        )
      })}
    </div>
  )
}

// ─── LOG TICKER (last event live) ────────────────────────────
function LogTicker({ entry }) {
  if (!entry) return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim2)', letterSpacing: '.06em' }}>— waiting for events —</span>
  )
  const evt = entry.event || ''
  // event → color + icon
  const eventStyle = {
    OPEN:                  { c: 'var(--green)', i: '📈' },
    CLOSE:                 { c: 'var(--blue)',  i: '🔻' },
    REJECTED:              { c: 'var(--red)',   i: '⛔' },
    BREAKER_PAUSE:         { c: 'var(--red)',   i: '🛑' },
    REDEEMED:              { c: 'var(--green)', i: '💰' },
    REDEEM_FAIL:           { c: 'var(--amber)', i: '⚠' },
    REDEEM_CRITICAL:       { c: 'var(--red)',   i: '🚨' },
    RESOLVED_LOST:         { c: 'var(--red)',   i: '❌' },
    GAS_STOP:              { c: 'var(--red)',   i: '⛽' },
    GAS_WARN:              { c: 'var(--amber)', i: '⛽' },
    GAS_RESUME:            { c: 'var(--green)', i: '⛽' },
    BOT_START:             { c: 'var(--green)', i: '▶' },
    BOT_STOP:              { c: 'var(--red)',   i: '■' },
    MODE_CHANGE:           { c: 'var(--amber)', i: '⚙' },
    CONFIG_UPDATE:         { c: 'var(--dim)',   i: '⚙' },
    BALANCE_REFRESH:       { c: 'var(--dim)',   i: '↻' },
    BALANCE_DRIFT:         { c: 'var(--amber)', i: '⚠' },
    DAILY_LOAD:            { c: 'var(--dim)',   i: '↻' },
    COMPOUND_UP:           { c: 'var(--green)', i: '⬆' },
    SALARY:                { c: 'var(--blue)',  i: '💸' },
    RECONCILE_MISSING_CLOB:{ c: 'var(--amber)', i: '⚠' },
    RECONCILE_ORPHAN_CLOB: { c: 'var(--amber)', i: '⚠' },
    RECONCILE_DONE:        { c: 'var(--dim)',   i: '✓' },
    RESUMED:               { c: 'var(--dim)',   i: '↻' },
  }[evt] || { c: 'var(--dim)', i: '•' }
  const msg = entry.message || entry.reason || entry.question || JSON.stringify(entry)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 9, overflow: 'hidden' }}>
      <span style={{ color: 'var(--dim2)', fontSize: 7, letterSpacing: '.07em' }}>LAST EVENT</span>
      <span style={{ color: 'var(--dim)' }}>{entry.time || ''}</span>
      <span style={{ fontSize: 11 }}>{eventStyle.i}</span>
      <span style={{ color: eventStyle.c, fontWeight: 700, letterSpacing: '.05em' }}>{evt}</span>
      <span style={{ color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{msg}</span>
    </div>
  )
}

// ─── HEADER + STATUS BAR ─────────────────────────────────────
function Header({ stats, btc5m, balance, conn, config, setMode, start, stop, resumeGas, onConfigClick, log }) {
  const mode = stats?.mode || 'SIM'
  const running = stats?.running
  const gasPaused = stats?.gas?.paused
  const secs = btc5m?.secs_left
  const btc = btc5m?.btc_price
  const lastLog = Array.isArray(log) && log.length > 0 ? log[0] : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', gap: 12 }}>
        <div style={{ fontSize: 18, fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>
          <span style={{ color: 'var(--green)' }}>Poly</span>
          <span style={{ color: 'var(--white)' }}>pox Terminal</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ModeToggle config={config} setMode={setMode} />
          <TriClock />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: conn ? 'var(--green)' : 'var(--red)', letterSpacing: '.07em' }}>
            {conn ? '● LIVE' : '○ OFFLINE'}
          </span>
        </div>
      </div>

      {/* Asset chips + last log */}
      <div style={{ display: 'flex', gap: 8, padding: '6px 14px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {ASSETS.map(a => (
            <div key={a.sym} style={{
              fontFamily: 'var(--mono)', fontSize: 9, padding: '3px 8px',
              border: `1px solid ${a.active ? 'var(--green)' : 'var(--border2)'}`,
              color: a.active ? 'var(--green)' : 'var(--dim)',
              background: a.active ? 'rgba(31,217,122,.06)' : 'transparent',
              borderRadius: 2, letterSpacing: '.05em',
              opacity: a.active ? 1 : 0.5, cursor: a.active ? 'pointer' : 'not-allowed',
            }}>{a.sym} {a.active && btc != null && <span style={{ color: 'var(--white)' }}>{usd(btc, 0)}</span>}</div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LogTicker entry={lastLog} />
        </div>
      </div>

      {/* Status bar + RUN/STOP */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 0 }}>
          <StatusChip label="MODE"   value={mode}              color={mode === 'REAL' ? 'var(--amber)' : 'var(--green)'} />
          <StatusChip label="BOT"    value={running ? 'RUNNING' : 'PAUSED'} color={running ? 'var(--green)' : 'var(--red)'} dot />
          <StatusChip label="WINDOW" value={`${mmss(secs)} | ${secs ?? 0}s`} color="var(--amber)" />
          <StatusChip label="BTC"    value={usd(btc, 2)} color="var(--green)" big />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {onConfigClick && <button onClick={onConfigClick} style={ctrlBtn('var(--dim)')}>⚙ CONFIG</button>}
          {!running && start && <button onClick={start} style={ctrlBtn('var(--green)')}>▶ RUN</button>}
          {running && stop && <button onClick={stop} style={ctrlBtn('var(--red)')}>■ STOP</button>}
          {gasPaused && resumeGas && <button onClick={resumeGas} style={ctrlBtn('var(--amber)')}>↻ GAS</button>}
        </div>
      </div>
    </div>
  )
}
function StatusChip({ label, value, color, dot, big }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', marginRight: 6,
      border: `1px solid ${color}55`, borderRadius: 2,
      background: 'var(--bg1)',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, animation: 'pulse 2s infinite' }} />}
      <span style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'var(--mono)', letterSpacing: '.07em' }}>{label}</span>
      <span style={{ fontSize: big ? 12 : 10, fontFamily: 'var(--mono)', color, fontWeight: 700, letterSpacing: '.04em' }}>{value}</span>
    </div>
  )
}

// ─── STATS GRID (8 cards) ────────────────────────────────────
function StatsGrid({ stats, btc5m, balance }) {
  const equity    = stats?.capital   ?? 0
  const available = stats?.available ?? 0
  const locked    = stats?.locked    ?? 0
  const initial   = stats?.initial   ?? 0
  const pnl       = stats?.pnl       ?? 0
  const roiPct    = stats?.roi_pct   ?? 0
  const dailyPnl  = stats?.daily_pnl ?? 0
  const wins      = stats?.wins      ?? 0
  const losses    = stats?.losses    ?? 0
  const pending   = stats?.open_count ?? 0
  const winRate   = stats?.win_rate   ?? 0
  const fees      = stats?.gas?.gas_usd ?? 0
  const wagered   = stats?.total_wagered ?? 0

  const pnlColor   = pnl    >= 0 ? 'var(--green)' : 'var(--red)'
  const dailyColor = dailyPnl >= 0 ? 'var(--green)' : 'var(--red)'
  const wrColor    = winRate >= 55 ? 'var(--green)' : winRate >= 45 ? 'var(--amber)' : 'var(--red)'

  const cards = [
    {
      label: 'MODAL AWAL',
      value: usd(initial),
      color: 'var(--amber)',
      sub: usdToIdr(initial),
      sub2: roiPct !== 0 ? `gain ${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%` : 'starting capital',
    },
    {
      label: 'EQUITY',
      value: usd(equity),
      color: 'var(--white)',
      sub: usdToIdr(equity),
      sub2: `avail ${usd(available)} · lock ${usd(locked)}`,
    },
    {
      label: 'TOTAL PNL',
      value: sgnUsd(pnl),
      color: pnlColor,
      sub: sgnIdr(pnl),
      sub2: `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}% from ${usd(initial)}`,
    },
    {
      label: 'DAILY PNL',
      value: sgnUsd(dailyPnl),
      color: dailyColor,
      sub: sgnIdr(dailyPnl),
      sub2: 'today',
    },
    { label: 'WIN',      value: wins,    color: 'var(--green)', sub: 'trades won',  sub2: '' },
    { label: 'LOSS',     value: losses,  color: 'var(--red)',   sub: 'trades lost', sub2: '' },
    { label: 'PENDING',  value: pending, color: 'var(--white)', sub: 'open orders', sub2: '' },
    {
      label: 'WIN RATE',
      value: pct(winRate),
      color: wrColor,
      sub: `${wins + losses} closed`,
      sub2: '',
    },
    {
      label: 'TOTAL SPEND',
      value: wagered > 0 ? usd(wagered) : '—',
      color: 'var(--dim)',
      sub: wagered > 0 ? usdToIdr(wagered) : '',
      sub2: fees > 0 ? `fees ${usd(fees, 4)}` : 'capital wagered',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, borderBottom: '1px solid var(--border2)' }}>
      {cards.map((c, i) => (
        <div key={i} style={{ padding: '6px 10px', borderRight: i < cards.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{c.label}</div>
          <div style={{ fontSize: 15, fontFamily: 'var(--mono)', color: c.color, fontWeight: 700, marginTop: 2 }}>{c.value}</div>
          {c.sub && <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', marginTop: 1 }}>{c.sub}</div>}
          {c.sub2 && <div style={{ fontSize: 7, fontFamily: 'var(--mono)', color: 'var(--dim2)', marginTop: 1 }}>{c.sub2}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── TRADINGVIEW WIDGET (embedded) ───────────────────────────
function TradingViewWidget() {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = '' // clear previous widget
    const container = document.createElement('div')
    container.className = 'tradingview-widget-container__widget'
    container.style.height = 'calc(100% - 32px)'
    container.style.width = '100%'
    const copyright = document.createElement('div')
    copyright.className = 'tradingview-widget-copyright'
    copyright.style.fontSize = '8px'
    copyright.style.padding = '4px 8px'
    copyright.style.color = 'var(--dim)'
    copyright.innerHTML = '<a href="https://www.tradingview.com/" rel="noopener" target="_blank" style="color: var(--dim); text-decoration: none;">Track all markets on TradingView</a>'
    ref.current.appendChild(container)
    ref.current.appendChild(copyright)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.type = 'text/javascript'
    script.innerHTML = JSON.stringify({
      symbol: 'BINANCE:BTCUSDT',
      interval: '1',
      theme: 'dark',
      style: '1',
      locale: 'en',
      autosize: true,
      timezone: 'Etc/UTC',
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      allow_symbol_change: false,
      withdateranges: false,
      save_image: false,
      studies: ['MAExp@tv-basicstudies', 'RSI@tv-basicstudies'],
      backgroundColor: 'rgba(19, 19, 23, 1)',
      gridColor: 'rgba(36, 36, 48, 0.5)',
      hide_volume: false,
    })
    container.appendChild(script)
  }, [])
  return <div ref={ref} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />
}

// ─── BTC CHART — TradingView style ───────────────────────────
function BtcChart({ btc5m, orderbook, pos, hist }) {
  const [mode, setMode] = useState('candles')

  // TV mode: full embed, skip custom SVG chart
  if (mode === 'tv') {
    return (
      <ChartFrame btc5m={btc5m} orderbook={orderbook} mode={mode} setMode={setMode}>
        <TradingViewWidget />
      </ChartFrame>
    )
  }

  return <CustomBtcChart btc5m={btc5m} orderbook={orderbook} pos={pos} hist={hist} mode={mode} setMode={setMode} />
}

function CustomBtcChart({ btc5m, orderbook, pos, hist, mode, setMode }) {
  const containerRef = useRef(null)
  const [W, setW] = useState(800)
  const [H, setH] = useState(300)
  // Pan state: offset = how many candles back from latest. 0 = live (latest)
  const [offset, setOffset] = useState(0)
  const [VISIBLE, setVisible] = useState(60)
  const dragRef = useRef(null) // { startX, startOffset }

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0)  setW(Math.floor(width))
      if (height > 0) setH(Math.floor(height))
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const allKlines = btc5m?.klines || []
  const totalK    = allKlines.length
  const maxOffset = Math.max(0, totalK - VISIBLE)
  const clampedOffset = Math.min(Math.max(0, offset), maxOffset)
  // Slice visible klines window based on offset
  const klines = useMemo(() => {
    if (totalK === 0) return []
    const end = totalK - clampedOffset
    const start = Math.max(0, end - VISIBLE)
    return allKlines.slice(start, end)
  }, [allKlines, clampedOffset, VISIBLE, totalK])
  const isLive  = clampedOffset === 0

  const price   = btc5m?.btc_price || 0
  const winOpen = btc5m?.win_open || 0
  const slug    = btc5m?.slug || ''
  const winTs   = btc5m?.win_ts || 0
  const delta   = btc5m?.delta_pct || 0
  const dir     = (price && winOpen) ? (price > winOpen ? 'ABOVE' : 'BELOW') : '—'
  const dirColor = dir === 'ABOVE' ? 'var(--green)' : dir === 'BELOW' ? 'var(--red)' : 'var(--dim)'

  // Trade markers — positions opened/closed within the visible kline window
  const tradeMarkers = useMemo(() => {
    if (!klines.length) return []
    const klStart = klines[0].ts
    const klEnd   = klines[klines.length - 1].ts + 60
    const all = [...(pos || []), ...(hist || [])]
    return all.map(p => {
      const ts = Math.floor(new Date(p.opened_at).getTime() / 1000)
      if (ts < klStart || ts > klEnd) return null
      const side = (p.outcome || '').toUpperCase()
      const isUp = side === 'UP' || side === 'YES'
      const status = p.status || 'open'
      const closedTs = p.closed_at ? Math.floor(new Date(p.closed_at).getTime() / 1000) : null
      return { ts, side, isUp, status, size: p.size, pnl: p.pnl, closedTs, id: p.id }
    }).filter(Boolean)
  }, [pos, hist, klines])

  // TradingView-style padding
  const padL = 16, padR = 76, padT = 14, padB = 46
  const volH = Math.min(48, Math.max(28, Math.floor(H * 0.18)))   // volume pane height
  const gap  = 4                                                    // gap between price/volume panes
  const cw   = W - padL - padR
  const totalCh = H - padT - padB
  const ch   = totalCh - volH - gap        // price pane height
  const volTop = padT + ch + gap           // volume pane top

  // Series for line + values
  const series = useMemo(() => klines.map(k => ({ t: k.ts, v: k.close })), [klines])
  const vals = useMemo(() => {
    const v = [...series.map(p => p.v)]
    if (price > 0)   v.push(price)
    if (winOpen > 0) v.push(winOpen)
    return v
  }, [series, price, winOpen])

  if (vals.length < 2) {
    return <ChartFrame slug={slug} price={price} winOpen={winOpen} dir={dir} dirColor={dirColor} delta={delta} btc5m={btc5m} orderbook={orderbook} mode={mode} setMode={setMode}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 10 }}>loading chart…</div>
    </ChartFrame>
  }

  // Add padding to price range so candles don't touch top/bottom
  const rawMn = Math.min(...vals), rawMx = Math.max(...vals)
  const rawRng = (rawMx - rawMn) || 1
  const padPrice = rawRng * 0.08
  const mn = rawMn - padPrice, mx = rawMx + padPrice
  const rng = mx - mn

  // X positions — distribute candles with margin on both sides
  const candleSlot = klines.length > 0 ? cw / klines.length : cw
  const px = (i, n) => padL + (n <= 1 ? cw/2 : (i + 0.5) * (cw / n))
  const py = (v) => padT + ch - ((v - mn) / rng) * ch
  // Volume bar Y
  const volMax = Math.max(0.001, ...klines.map(k => k.volume || 0))
  const vy = (vol) => volTop + volH - (vol / volMax) * volH

  // Y-axis labels — round to nearest "nice" number
  const yLabels = []
  const tickCount = 5
  for (let i = 0; i <= tickCount; i++) {
    const v = mn + (rng * i / tickCount)
    yLabels.push({ y: py(v), v })
  }

  // X-axis time labels — show ~5 evenly
  const tFmt = (ts) => {
    const d = new Date(ts * 1000)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  const xLabelIndices = []
  if (klines.length > 0) {
    const stride = Math.max(1, Math.floor(klines.length / 5))
    for (let i = 0; i < klines.length; i += stride) xLabelIndices.push(i)
    if (xLabelIndices[xLabelIndices.length - 1] !== klines.length - 1)
      xLabelIndices.push(klines.length - 1)
  }

  // Colors
  const CGREEN = 'rgba(31,217,122,1)'
  const CRED   = 'rgba(240,64,96,1)'
  const CGREEN_FILL = 'rgba(31,217,122,0.18)'
  const CRED_FILL   = 'rgba(240,64,96,0.18)'

  // Drag-to-pan handlers (candle slot width → offset delta)
  const candleW = klines.length > 0 ? cw / klines.length : 1
  const onMouseDown = (e) => {
    dragRef.current = { startX: e.clientX, startOffset: clampedOffset }
    e.preventDefault()
  }
  const onMouseMove = (e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    // Drag right (positive dx) → go back in time (offset++)
    const candleDelta = Math.round(dx / candleW)
    const newOffset = dragRef.current.startOffset + candleDelta
    setOffset(Math.min(Math.max(0, newOffset), maxOffset))
  }
  const onMouseUp = () => { dragRef.current = null }
  const onWheel = (e) => {
    if (!e.shiftKey) return  // shift+wheel = pan, normal wheel = page scroll
    e.preventDefault()
    const candleDelta = Math.sign(e.deltaY) * 3
    setOffset(o => Math.min(Math.max(0, o + candleDelta), maxOffset))
  }
  const goLive = (e) => { e?.stopPropagation(); setOffset(0) }
  const panLeft  = (e) => { e?.stopPropagation(); setOffset(o => Math.min(maxOffset, o + 10)) }
  const panRight = (e) => { e?.stopPropagation(); setOffset(o => Math.max(0, o - 10)) }

  return (
    <ChartFrame slug={slug} price={price} winOpen={winOpen} dir={dir} dirColor={dirColor} delta={delta} btc5m={btc5m} orderbook={orderbook} mode={mode} setMode={setMode}>
      <div ref={containerRef}
           onMouseDown={onMouseDown}
           onMouseMove={onMouseMove}
           onMouseUp={onMouseUp}
           onMouseLeave={onMouseUp}
           onWheel={onWheel}
           style={{ width: '100%', height: '100%', minHeight: 0, background: 'var(--bg1)', cursor: dragRef.current ? 'grabbing' : 'grab', userSelect: 'none', position: 'relative' }}>
      {/* Pan controls overlay */}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, zIndex: 5, pointerEvents: 'auto' }} onMouseDown={e => e.stopPropagation()}>
        <button onClick={panLeft} disabled={clampedOffset >= maxOffset} title="Pan back" style={panBtn(clampedOffset < maxOffset)}>◀</button>
        <button onClick={panRight} disabled={clampedOffset <= 0} title="Pan forward" style={panBtn(clampedOffset > 0)}>▶</button>
        {!isLive && (
          <button onClick={goLive} title="Snap to latest" style={{
            ...panBtn(true), background: 'var(--amber)', color: '#000', fontWeight: 700,
            padding: '2px 10px',
          }}>● LIVE</button>
        )}
        {!isLive && (
          <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--amber)', alignSelf: 'center', marginLeft: 4, letterSpacing: '.07em' }}>
            {clampedOffset} candles back
          </span>
        )}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: '100%' }}>
        {/* Plot panel background */}
        <rect x={padL} y={padT} width={cw} height={ch} fill="var(--bg)" opacity="0.4" />
        <rect x={padL} y={volTop} width={cw} height={volH} fill="var(--bg)" opacity="0.4" />

        {/* Horizontal grid — subtle */}
        {yLabels.map((l, i) => (
          <line key={`hg${i}`} x1={padL} y1={l.y} x2={padL + cw} y2={l.y}
                stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
        ))}

        {/* Vertical grid — at x-label positions */}
        {xLabelIndices.map(i => (
          <line key={`vg${i}`} x1={px(i, klines.length)} y1={padT} x2={px(i, klines.length)} y2={padT + ch}
                stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
        ))}

        {/* Right axis separator */}
        <line x1={padL + cw} y1={padT} x2={padL + cw} y2={H - padB} stroke="var(--border2)" strokeWidth="0.5" />
        {/* Bottom axis separator */}
        <line x1={padL} y1={padT + ch} x2={padL + cw} y2={padT + ch} stroke="var(--border2)" strokeWidth="0.5" />
        <line x1={padL} y1={H - padB} x2={padL + cw} y2={H - padB} stroke="var(--border2)" strokeWidth="0.5" />

        {/* Y-axis labels (right side) */}
        {yLabels.map((l, i) => (
          <text key={`yl${i}`} x={padL + cw + 6} y={l.y + 3}
                fill="var(--dim)" fontSize="9" fontFamily="var(--mono)">
            {l.v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </text>
        ))}

        {/* PTB target line */}
        {winOpen > 0 && py(winOpen) >= padT && py(winOpen) <= padT + ch && (
          <g>
            <line x1={padL} y1={py(winOpen)} x2={padL + cw} y2={py(winOpen)}
                  stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <rect x={padL + cw + 2} y={py(winOpen) - 8} width={padR - 4} height="16" fill="var(--amber)" />
            <text x={padL + cw + padR/2} y={py(winOpen) + 3} fill="#000" fontSize="9" fontFamily="var(--mono)" fontWeight="700" textAnchor="middle">
              {winOpen.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </text>
          </g>
        )}

        {/* Candles or Line */}
        {mode === 'line' ? (
          <>
            <polygon
              points={`${padL},${padT + ch} ${series.map((p, i) => `${px(i, series.length)},${py(p.v)}`).join(' ')} ${padL + cw},${padT + ch}`}
              fill={CGREEN_FILL}
            />
            <polyline
              points={series.map((p, i) => `${px(i, series.length)},${py(p.v)}`).join(' ')}
              fill="none" stroke={CGREEN} strokeWidth="1.5" strokeLinejoin="round"
            />
          </>
        ) : (
          klines.map((k, i) => {
            const x = px(i, klines.length)
            const bw = Math.max(2, candleSlot * 0.65)
            const up = k.close >= k.open
            const col = up ? CGREEN : CRED
            const yHi = py(k.high), yLo = py(k.low)
            const yOpen = py(k.open), yClose = py(k.close)
            const bodyTop = Math.min(yOpen, yClose)
            const bodyH  = Math.max(1, Math.abs(yOpen - yClose))
            return (
              <g key={i}>
                <line x1={x} y1={yHi} x2={x} y2={yLo} stroke={col} strokeWidth="1" />
                <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={col} />
              </g>
            )
          })
        )}

        {/* Volume bars */}
        {klines.map((k, i) => {
          const x = px(i, klines.length)
          const bw = Math.max(2, candleSlot * 0.65)
          const up = k.close >= k.open
          const col = up ? CGREEN_FILL : CRED_FILL
          const y = vy(k.volume || 0)
          return (
            <rect key={`v${i}`} x={x - bw / 2} y={y} width={bw} height={volTop + volH - y} fill={col} />
          )
        })}
        <text x={padL + 4} y={volTop + 10} fill="var(--dim)" fontSize="7" fontFamily="var(--mono)" letterSpacing="0.07em">VOL</text>

        {/* Trade markers — entry triangles within kline window */}
        {tradeMarkers.map((m, i) => {
          if (klines.length === 0) return null
          const klStart = klines[0].ts
          const klSpan = (klines[klines.length - 1].ts + 60) - klStart
          if (klSpan <= 0) return null
          // Helper: convert ts → x on chart
          const tsToX = (ts) => padL + ((ts - klStart) / klSpan) * cw
          const x = tsToX(m.ts)
          const color = m.isUp ? CGREEN : CRED
          // Vertical line from top of pane to bottom (subtle)
          const isClosed = m.status === 'won' || m.status === 'lost'
          const lineOpacity = isClosed ? 0.18 : 0.35
          const yTop = padT + 16
          const yBot = padT + ch
          // Triangle: up = pointing up (▲), down = pointing down (▼)
          const triSize = 6
          const triY = yTop
          const tri = m.isUp
            ? `${x},${triY - triSize} ${x - triSize},${triY + triSize} ${x + triSize},${triY + triSize}`
            : `${x},${triY + triSize} ${x - triSize},${triY - triSize} ${x + triSize},${triY - triSize}`
          // Result chip — only for closed positions
          const resultColor = m.status === 'won' ? CGREEN : m.status === 'lost' ? CRED : 'var(--amber)'
          const resultLabel = m.status === 'won' ? '✓' : m.status === 'lost' ? '✗' : '○'
          return (
            <g key={`tm-${i}`}>
              <line x1={x} y1={yTop} x2={x} y2={yBot}
                    stroke={color} strokeWidth="1" strokeDasharray="2 3" opacity={lineOpacity} />
              <polygon points={tri} fill={color} stroke="var(--bg)" strokeWidth="1" opacity={isClosed ? 0.85 : 1} />
              {/* size label below the triangle */}
              <text x={x} y={triY + triSize + 11} fill={color} fontSize="8" fontFamily="var(--mono)" fontWeight="700" textAnchor="middle">
                ${(m.size || 0).toFixed(2)}
              </text>
              {/* result chip on closed trades — at bottom near volume area */}
              {isClosed && (
                <g>
                  <circle cx={x} cy={yBot - 6} r="5.5" fill={resultColor} opacity="0.95" stroke="var(--bg)" strokeWidth="1" />
                  <text x={x} y={yBot - 3} fill="#000" fontSize="8" fontFamily="var(--mono)" fontWeight="700" textAnchor="middle">{resultLabel}</text>
                </g>
              )}
              {/* tooltip via SVG <title> — hover to see */}
              <title>
                {`${m.id} ${m.side} $${(m.size || 0).toFixed(2)}`}
                {isClosed ? `\n${m.status.toUpperCase()} pnl ${m.pnl >= 0 ? '+' : ''}$${(m.pnl || 0).toFixed(2)}` : '\nOPEN'}
              </title>
            </g>
          )
        })}

        {/* Current price horizontal line — across full plot */}
        {price > 0 && py(price) >= padT && py(price) <= padT + ch && (
          <g>
            <line x1={padL} y1={py(price)} x2={padL + cw} y2={py(price)}
                  stroke={CGREEN} strokeWidth="0.8" strokeDasharray="2 2" opacity="0.6" />
            <rect x={padL + cw + 2} y={py(price) - 8} width={padR - 4} height="16" fill={CGREEN} />
            <text x={padL + cw + padR/2} y={py(price) + 3} fill="#000" fontSize="9" fontFamily="var(--mono)" fontWeight="700" textAnchor="middle">
              {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </text>
          </g>
        )}

        {/* X-axis timestamps */}
        {xLabelIndices.map(i => (
          <text key={`xl${i}`} x={px(i, klines.length)} y={H - padB + 14}
                fill="var(--dim)" fontSize="9" fontFamily="var(--mono)" textAnchor="middle">
            {tFmt(klines[i].ts)}
          </text>
        ))}
        {/* Legacy series x-label code path kept off — using xLabelIndices */}
        {false && series.length >= 2 && [0, Math.floor(series.length/2), series.length - 1].map(i => (
          <text key={i} x={px(i, series.length)} y={H - 6} fill="var(--dim)" fontSize="9" fontFamily="var(--mono)" textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>
            {tFmt(series[i].t)}
          </text>
        ))}
      </svg>
      </div>
    </ChartFrame>
  )
}
function ChartFrame({ slug, price, winOpen, dir, dirColor, delta, mode, setMode, btc5m, orderbook, children }) {
  // Compute from btc5m if individual props not passed (TV mode)
  if (btc5m && price == null) {
    price   = btc5m.btc_price || 0
    winOpen = btc5m.win_open || 0
    slug    = btc5m.slug || ''
    delta   = btc5m.delta_pct || 0
    dir     = (price && winOpen) ? (price > winOpen ? 'ABOVE' : 'BELOW') : '—'
    dirColor = dir === 'ABOVE' ? 'var(--green)' : dir === 'BELOW' ? 'var(--red)' : 'var(--dim)'
  }
  const diff = price && winOpen ? price - winOpen : 0
  const modes = [
    { id: 'line',    label: 'LINE' },
    { id: 'candles', label: 'CANDLES' },
    { id: 'tv',      label: '📊 TV' },
  ]
  // Window time range in ET (matches Polymarket label)
  const winTs = btc5m?.win_ts || 0
  let windowLabel = ''
  if (winTs > 0) {
    const start = new Date(winTs * 1000)
    const end   = new Date((winTs + 300) * 1000)
    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
    const date = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
    windowLabel = `${date}, ${fmt(start)}–${fmt(end)} ET`
  }
  // UP / DOWN current prices from orderbook
  const upMid   = orderbook?.mid_yes || 0
  const downMid = orderbook?.mid_no  || 0
  // Active position side highlight (if there's an open position in this window)
  return (
    <div style={{ background: 'var(--bg1)', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700 }}>BTC/USD <span style={{ color: 'var(--green)' }}>{usd(price, 2)}</span></span>
          {windowLabel && <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{windowLabel}</span>}
          <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>PTB: <span style={{ color: 'var(--white)' }}>{usd(winOpen, 2)}</span></span>
          <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>
            <span style={{ color: dirColor, fontWeight: 700 }}>{dir}</span> <span style={{ color: dirColor }}>{sgnUsd(diff)} ({sgnPct(delta)})</span>
          </span>
          {/* UP / DOWN current prices (CLOB orderbook YES/NO) */}
          {(upMid > 0 || downMid > 0) && (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 10 }}>
              <span style={{ padding: '2px 6px', background: 'rgba(31,217,122,.12)', border: '1px solid var(--green)', borderRadius: 2 }}>
                <span style={{ color: 'var(--dim)', fontSize: 7, letterSpacing: '.07em' }}>UP</span> <span style={{ color: 'var(--green)', fontWeight: 700 }}>{cents(upMid)}</span>
              </span>
              <span style={{ padding: '2px 6px', background: 'rgba(240,64,96,.12)', border: '1px solid var(--red)', borderRadius: 2 }}>
                <span style={{ color: 'var(--dim)', fontSize: 7, letterSpacing: '.07em' }}>DOWN</span> <span style={{ color: 'var(--red)', fontWeight: 700 }}>{cents(downMid)}</span>
              </span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {modes.map((m, idx) => {
            const active = mode === m.id
            const isTV = m.id === 'tv'
            return (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                fontFamily: 'var(--mono)', fontSize: 9, padding: '3px 12px',
                background: active ? (isTV ? 'rgba(68,136,255,.12)' : 'rgba(31,217,122,.10)') : 'transparent',
                color: active ? (isTV ? 'var(--blue)' : 'var(--green)') : 'var(--dim)',
                border: `1px solid ${active ? (isTV ? 'var(--blue)' : 'var(--green)') : 'var(--border2)'}`,
                borderRadius: 0, cursor: 'pointer', letterSpacing: '.07em', textTransform: 'uppercase',
                marginLeft: idx > 0 ? -1 : 0,
                fontWeight: active ? 700 : 400,
              }}>{m.label}</button>
            )
          })}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

// ─── ORDERBOOK YES/NO — full bids + asks ─────────────────────
function BookHalf({ book, color, midPrice, maxLevels = 6 }) {
  const asks = useMemo(() =>
    [...(book.asks || [])].sort((a, b) => b.price - a.price).slice(0, maxLevels),
    [book.asks, maxLevels])
  const bids = useMemo(() =>
    [...(book.bids || [])].sort((a, b) => b.price - a.price).slice(0, maxLevels),
    [book.bids, maxLevels])

  const allSizes = [...asks, ...bids].map(r => r.size)
  const maxSize  = Math.max(1, ...allSizes)

  const Row = ({ r, side }) => {
    const depth = Math.min(100, (r.size / maxSize) * 100)
    const isAsk = side === 'ask'
    const bg    = isAsk ? 'rgba(255,60,92,' : 'rgba(34,255,138,'
    const cl    = isAsk ? 'var(--red)' : 'var(--green)'
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: '42px 1fr 56px',
        padding: '2px 6px', fontSize: 10, fontFamily: 'var(--mono)',
        borderBottom: '1px solid var(--border)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${depth}%`, background: `${bg}0.10)`, zIndex: 0 }} />
        <span style={{ color: cl, position: 'relative', zIndex: 1, fontWeight: 600 }}>{cents(r.price)}</span>
        <span style={{ textAlign: 'right', color: 'var(--white)', position: 'relative', zIndex: 1 }}>{num(r.size, 1)}</span>
        <span style={{ textAlign: 'right', color: 'var(--dim)', position: 'relative', zIndex: 1 }}>${(r.price * r.size).toFixed(1)}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* col headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 56px', padding: '3px 6px', fontSize: 7, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em', borderBottom: '1px solid var(--border)' }}>
        <span>PRICE</span><span style={{ textAlign: 'right' }}>SIZE</span><span style={{ textAlign: 'right' }}>USDC</span>
      </div>
      {/* asks — descending, best ask at bottom (nearest to mid) */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {asks.length === 0
          ? <div style={{ padding: '4px 6px', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>—</div>
          : [...asks].reverse().map((r, i) => <Row key={`a${i}`} r={r} side="ask" />)
        }
      </div>
      {/* mid price divider */}
      <div style={{ padding: '3px 6px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em' }}>MID</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color, fontWeight: 700 }}>{cents(midPrice)}</span>
      </div>
      {/* bids — descending, best bid at top */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {bids.length === 0
          ? <div style={{ padding: '4px 6px', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>—</div>
          : bids.map((r, i) => <Row key={`b${i}`} r={r} side="bid" />)
        }
      </div>
    </div>
  )
}

function OrderBook({ orderbook }) {
  const yes  = orderbook?.yes  || { asks: [], bids: [] }
  const no   = orderbook?.no   || { asks: [], bids: [] }
  const my   = orderbook?.mid_yes || 0
  const mn   = orderbook?.mid_no  || 0
  const comb = orderbook?.comb    || 0
  const slug = orderbook?.slug    || '—'

  // Imbalance: compare total bid size YES vs NO
  const yesBidVol = (yes.bids || []).reduce((s, r) => s + r.size, 0)
  const noBidVol  = (no.bids  || []).reduce((s, r) => s + r.size, 0)
  const totalVol  = yesBidVol + noBidVol || 1
  const yesPct    = Math.round(yesBidVol / totalVol * 100)
  const imbalanceColor = yesPct > 55 ? 'var(--green)' : yesPct < 45 ? 'var(--red)' : 'var(--amber)'

  return (
    <div style={{ background: 'var(--bg1)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* header */}
      <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.08em' }}>CLOB ORDERBOOK</span>
        <div style={{ display: 'flex', gap: 8, fontFamily: 'var(--mono)', fontSize: 9, alignItems: 'center' }}>
          <span style={{ color: 'var(--dim)', fontSize: 7 }}>IMBALANCE</span>
          <span style={{ color: imbalanceColor, fontWeight: 700 }}>{yesPct}% UP</span>
          <span style={{ color: 'var(--dim)' }}>|</span>
          <span><span style={{ color: 'var(--dim)', fontSize: 7 }}>COMB </span><span style={{ color: 'var(--amber)' }}>{cents(comb)}</span></span>
        </div>
      </div>

      {/* two books side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, minHeight: 0 }}>
        {/* YES book */}
        <div style={{ borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '3px 6px', background: 'rgba(34,255,138,0.06)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 700, letterSpacing: '.08em' }}>▲ YES (BTC UP)</span>
          </div>
          <BookHalf book={yes} color="var(--green)" midPrice={my} />
        </div>
        {/* NO book */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '3px 6px', background: 'rgba(255,60,92,0.06)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--red)', fontWeight: 700, letterSpacing: '.08em' }}>▼ NO (BTC DOWN)</span>
          </div>
          <BookHalf book={no} color="var(--red)" midPrice={mn} />
        </div>
      </div>
    </div>
  )
}

// ─── BINANCE BTC/USDT ORDERBOOK (real spot) ──────────────────
function BinanceOrderbook() {
  const [book, setBook] = useState({ bids: [], asks: [] })
  const [status, setStatus] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fetchBook = async () => {
      try {
        const r = await fetch('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20', {
          signal: AbortSignal.timeout(5000),
        })
        if (!r.ok) throw new Error(r.status)
        const data = await r.json()
        if (cancelled) return
        setBook({
          bids: (data.bids || []).map(([p, s]) => ({ price: +p, size: +s })),
          asks: (data.asks || []).map(([p, s]) => ({ price: +p, size: +s })),
        })
        setStatus('live')
        setLastUpdate(Date.now())
      } catch (e) {
        if (cancelled) return
        setStatus('blocked')
      }
    }
    fetchBook()
    const id = setInterval(fetchBook, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const asks = useMemo(() =>
    [...book.asks].sort((a, b) => a.price - b.price).slice(0, 8),
    [book.asks])
  const bids = useMemo(() =>
    [...book.bids].sort((a, b) => b.price - a.price).slice(0, 8),
    [book.bids])

  const allSizes = [...asks, ...bids].map(r => r.size)
  const maxSize  = Math.max(0.001, ...allSizes)
  const mid = asks[0] && bids[0] ? (asks[0].price + bids[0].price) / 2 : 0
  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : 0

  const Row = ({ r, side }) => {
    const depth = Math.min(100, (r.size / maxSize) * 100)
    const isAsk = side === 'ask'
    const cl    = isAsk ? 'var(--red)' : 'var(--green)'
    const bg    = isAsk ? 'rgba(255,60,92,' : 'rgba(34,255,138,'
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 60px 70px',
        padding: '1.5px 8px', fontSize: 10, fontFamily: 'var(--mono)',
        borderBottom: '1px solid var(--border)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${depth}%`, background: `${bg}0.10)`, zIndex: 0 }} />
        <span style={{ color: cl, position: 'relative', zIndex: 1, fontWeight: 600 }}>{r.price.toFixed(2)}</span>
        <span style={{ textAlign: 'right', color: 'var(--white)', position: 'relative', zIndex: 1 }}>{r.size.toFixed(4)}</span>
        <span style={{ textAlign: 'right', color: 'var(--dim)', position: 'relative', zIndex: 1 }}>${(r.price * r.size).toFixed(0)}</span>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg1)', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* header */}
      <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.08em' }}>
          BINANCE BTC/USDT
          <span style={{ marginLeft: 6, color: status === 'live' ? 'var(--green)' : status === 'blocked' ? 'var(--red)' : 'var(--amber)', fontSize: 7 }}>
            {status === 'live' ? '● LIVE' : status === 'blocked' ? '○ BLOCKED (VPN?)' : '○ ...'}
          </span>
        </span>
        {spread > 0 && (
          <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>
            spread <span style={{ color: 'var(--amber)' }}>${spread.toFixed(2)}</span>
          </span>
        )}
      </div>

      {/* col headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px', padding: '3px 8px', fontSize: 7, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span>PRICE</span><span style={{ textAlign: 'right' }}>SIZE BTC</span><span style={{ textAlign: 'right' }}>VALUE</span>
      </div>

      {/* asks (reversed: best ask near mid) */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {asks.length === 0 ? (
          <div style={{ padding: '8px', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>
            {status === 'blocked' ? 'Binance blocked — enable VPN SG to view real spot book' : 'loading...'}
          </div>
        ) : [...asks].reverse().map((r, i) => <Row key={`a${i}`} r={r} side="ask" />)}
      </div>

      {/* mid divider */}
      {mid > 0 && (
        <div style={{ padding: '4px 8px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em' }}>MID</span>
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--amber)', fontWeight: 700 }}>${mid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      )}

      {/* bids */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {bids.length === 0 ? (
          <div style={{ padding: '8px', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>—</div>
        ) : bids.map((r, i) => <Row key={`b${i}`} r={r} side="bid" />)}
      </div>
    </div>
  )
}

// ─── POSITION CARD (expandable) ──────────────────────────────
function PositionCard({ p, entry, cur, shares, upnl, upct, side, isUp, sc, open, cd, url, midUp, midDown, sameWindow }) {
  const [expanded, setExpanded] = useState(false)
  const pnlColor = upnl >= 0 ? 'var(--green)' : 'var(--red)'
  const pnlBg    = upnl >= 0 ? 'rgba(31,217,122,0.06)' : 'rgba(240,64,96,0.06)'
  const sideBg   = isUp ? 'rgba(31,217,122,0.10)' : 'rgba(240,64,96,0.10)'

  return (
    <div onClick={() => setExpanded(e => !e)} style={{
      background: pnlBg, border: `1px solid ${pnlColor}33`,
      borderLeft: `3px solid ${sc}`, borderRadius: 3,
      padding: '6px 10px', marginBottom: 5, cursor: 'pointer',
      fontFamily: 'var(--mono)', transition: 'background 0.15s',
    }}>
      {/* Row 1: ID + Side + Countdown + PnL + Expand */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--white)', fontWeight: 700 }}>{p.id}</span>
          <span style={{ fontSize: 9, padding: '1px 6px', background: sideBg, color: sc, fontWeight: 700, borderRadius: 2, letterSpacing: '.06em' }}>
            {isUp ? '▲' : '▼'} {side}
          </span>
          <span style={{ fontSize: 9, color: cd.color, fontWeight: 700, animation: cd.urgent ? 'pulse 1s infinite' : 'none' }}>
            ⏱ {cd.txt}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: pnlColor }}>{sgnUsd(upnl)}</span>
          <span style={{ fontSize: 9, color: pnlColor, opacity: 0.8 }}>({sgnPct(upct)})</span>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Row 2 compact: prices + size */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, fontSize: 9, color: 'var(--dim)' }}>
        <span>entry <span style={{ color: 'var(--white)' }}>{cents(entry)}</span></span>
        {(midUp > 0 || midDown > 0) ? (
          <span>
            now{' '}
            <span style={{ color: 'var(--green)', fontWeight: isUp ? 700 : 400, opacity: isUp ? 1 : 0.55 }}>{cents(midUp)}</span>
            <span style={{ margin: '0 3px' }}>/</span>
            <span style={{ color: 'var(--red)', fontWeight: !isUp ? 700 : 400, opacity: !isUp ? 1 : 0.55 }}>{cents(midDown)}</span>
          </span>
        ) : (
          <span style={{ color: 'var(--dim)' }}>{sameWindow ? 'loading book...' : 'window closed'}</span>
        )}
        <span>size <span style={{ color: 'var(--white)' }}>{usd(p.size || 0)}</span></span>
        <span>shares <span style={{ color: 'var(--white)' }}>{num(shares, 2)}</span></span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div onClick={e => e.stopPropagation()} style={{
          marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border2)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', fontSize: 9,
        }}>
          <div style={{ gridColumn: '1 / span 2' }}>
            <DetailRow label="OPENED" value={dualDateTime(p.opened_at)} />
          </div>
          <div style={{ gridColumn: '1 / span 2' }}>
            <DetailRow label="CLOSES" value={dualDateTime(new Date(new Date(p.opened_at).getTime() + (p.resolve_sec || 300) * 1000).toISOString())} />
          </div>
          <DetailRow label="MODE"       value={(p.mode || '—').toUpperCase()} valueColor={p.mode === 'real' ? 'var(--amber)' : 'var(--green)'} />
          <DetailRow label="STATUS"     value={(p.status || 'open').toUpperCase()} valueColor="var(--amber)" />
          <DetailRow label="EV"         value={p.ev != null ? (p.ev >= 0 ? `+${p.ev.toFixed(4)}` : p.ev.toFixed(4)) : '—'}
                     valueColor={p.ev >= 0 ? 'var(--green)' : 'var(--red)'} />
          <DetailRow label="CONFIDENCE" value={p.confidence != null ? p.confidence.toFixed(2) : '—'} />
          <DetailRow label="TRUE PROB"  value={p.true_prob != null ? p.true_prob.toFixed(2) : '—'} />
          <DetailRow label="STRATEGY"   value={p.strategy || 'btc5m'} />
          <DetailRow label="COMPOUND BET" value={p.compound_bet != null ? usd(p.compound_bet) : '—'} />
          <DetailRow label="RESOLVES"   value={p.resolve_fmt || `${p.resolve_sec || 0}s`} />
          <DetailRow label="ORDER ID"   value={p.order_id || '—'} small />
          <DetailRow label="ORDER TYPE" value={p.order_type || '—'} small />
          <DetailRow label="MARKET ID"  value={p.market_id || '—'} small />
          {p.condition_id && <div style={{ gridColumn: '1 / span 2' }}>
            <DetailRow label="CONDITION ID" value={p.condition_id} small mono />
          </div>}
          {p.question && <div style={{ gridColumn: '1 / span 2', marginTop: 4, padding: '4px 6px', background: 'var(--bg2)', borderRadius: 2 }}>
            <span style={{ fontSize: 8, color: 'var(--dim)', letterSpacing: '.07em' }}>MARKET</span>
            <div style={{ fontSize: 10, color: 'var(--white)', marginTop: 1 }}>{p.question}</div>
          </div>}
          <div style={{ gridColumn: '1 / span 2', marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
               style={{ fontSize: 9, color: 'var(--blue)', textDecoration: 'none', padding: '3px 8px', border: '1px solid var(--blue)', borderRadius: 2 }}>
              ↗ View on Polymarket
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, valueColor = 'var(--white)', small, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
      <span style={{ fontSize: 7, color: 'var(--dim)', letterSpacing: '.07em', minWidth: 70 }}>{label}</span>
      <span style={{
        fontSize: small ? 8 : 10,
        color: valueColor,
        fontFamily: mono ? 'var(--mono)' : 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontWeight: small ? 400 : 600,
      }}>{value}</span>
    </div>
  )
}

// ─── OPEN POSITIONS ──────────────────────────────────────────
function OpenPositions({ pos, btc5m, orderbook }) {
  const price = btc5m?.btc_price || 0
  // tick state for re-rendering countdown every second
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Helper: derive window slug from position
  const posSlug = (p) => {
    const openedTs = Math.floor(new Date(p.opened_at).getTime() / 1000)
    const winStart = Math.floor(openedTs / 300) * 300
    return `btc-updown-5m-${winStart}`
  }

  // Helper: compute Polymarket event slug + URL from opened_at
  const polyUrl = (p) => `https://polymarket.com/event/${posSlug(p)}`

  // Helper: current price for a position from orderbook
  // Only use orderbook mid if it matches position's window
  const currentPrice = (p) => {
    if (!orderbook) return p.price
    const sameWindow = orderbook.slug === posSlug(p)
    if (!sameWindow) return p.price
    const side = (p.outcome || '').toLowerCase()
    if (side === 'up' || side === 'yes') return orderbook.mid_yes || p.price
    if (side === 'down' || side === 'no') return orderbook.mid_no || p.price
    return p.price
  }

  // Helper: countdown string
  const countdown = (p) => {
    const openedMs = new Date(p.opened_at).getTime()
    const resolveSec = p.resolve_sec || 300
    const closesMs = openedMs + resolveSec * 1000
    const remMs = closesMs - Date.now()
    if (remMs <= 0) return { txt: 'CLOSING', color: 'var(--amber)', urgent: true }
    const remSec = Math.floor(remMs / 1000)
    const m = Math.floor(remSec / 60)
    const s = remSec % 60
    const txt = m > 0 ? `${m}:${pad2(s)}` : `${s}s`
    const color = remSec <= 10 ? 'var(--red)' : remSec <= 30 ? 'var(--amber)' : 'var(--green)'
    return { txt, color, urgent: remSec <= 10 }
  }

  return (
    <div style={{ background: 'var(--bg1)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.08em', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>OPEN POSITIONS <span style={{ color: 'var(--white)', marginLeft: 8 }}>{pos.length}</span></span>
        <span style={{ fontSize: 7, color: 'var(--dim2)' }}>click card to expand</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px' }}>
        {pos.length === 0 && <div style={{ padding: '20px', textAlign: 'center', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>no open positions</div>}
        {pos.map(p => {
          const entry = p.price || 0
          const cur = currentPrice(p)
          const shares = p.shares || (p.size || 0) / Math.max(entry, 0.01)
          const upnl = (cur - entry) * shares
          const upct = entry ? ((cur - entry) / entry) * 100 : 0
          const side = (p.outcome || '—').toUpperCase()
          const isUp = side === 'UP' || side === 'YES'
          const sc = isUp ? 'var(--green)' : 'var(--red)'
          const open = (p.opened_at || '').replace('T', ' ').slice(0, 19)
          const cd = countdown(p)
          const url = polyUrl(p)
          const sameWindow = orderbook?.slug === posSlug(p)
          const midUp   = sameWindow ? (orderbook?.mid_yes || 0) : 0
          const midDown = sameWindow ? (orderbook?.mid_no  || 0) : 0
          return (
            <PositionCard key={p.id} p={p}
              entry={entry} cur={cur} shares={shares} upnl={upnl} upct={upct}
              side={side} isUp={isUp} sc={sc} open={open} cd={cd} url={url}
              midUp={midUp} midDown={midDown} sameWindow={sameWindow}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── TRADE HISTORY (with pagination + export) ────────────────
function buildDailyRows(hist) {
  const map = {}
  hist.forEach(t => {
    if (!t.opened_at) return
    const day = localDateKey(t.opened_at)  // local TZ — matches user wall clock
    if (!map[day]) map[day] = { date: day, trades: 0, wins: 0, losses: 0, pnl: 0, volume: 0 }
    const d = map[day]
    d.trades++
    d.pnl    = round2(d.pnl + (t.pnl || 0))
    d.volume = round2(d.volume + (t.size || 0))
    if (t.status === 'won')  d.wins++
    if (t.status === 'lost') d.losses++
  })
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date))
}
function round2(n) { return Math.round(n * 100) / 100 }

function DailyTable({ hist }) {
  const rows = useMemo(() => buildDailyRows(hist), [hist])
  if (rows.length === 0) return (
    <div style={{ padding: '20px', textAlign: 'center', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>no daily data yet</div>
  )
  const totPnl    = rows.reduce((s, r) => s + r.pnl, 0)
  const totTrades = rows.reduce((s, r) => s + r.trades, 0)
  const totWins   = rows.reduce((s, r) => s + r.wins, 0)
  const totVol    = rows.reduce((s, r) => s + r.volume, 0)
  const COLS = '100px 60px 44px 44px 60px 70px 70px 80px'
  const hdr = { fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em' }
  const cell = (c) => ({ textAlign: 'right', color: c || 'var(--white)', fontFamily: 'var(--mono)', fontSize: 10 })
  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* header */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '4px 10px', borderBottom: '1px solid var(--border)', ...hdr }}>
        <span>DATE</span>
        <span style={{ textAlign: 'right' }}>TRADES</span>
        <span style={{ textAlign: 'right' }}>W</span>
        <span style={{ textAlign: 'right' }}>L</span>
        <span style={{ textAlign: 'right' }}>WIN%</span>
        <span style={{ textAlign: 'right' }}>VOLUME</span>
        <span style={{ textAlign: 'right' }}>P&L</span>
        <span style={{ textAlign: 'right' }}>STATUS</span>
      </div>
      {/* rows */}
      {rows.map(r => {
        const wr    = r.trades ? (r.wins / r.trades * 100) : 0
        const green = r.pnl >= 0
        const badge = green ? { bg: 'rgba(0,255,127,.12)', cl: 'var(--green)', br: 'var(--green)' }
                            : { bg: 'rgba(255,34,68,.12)',  cl: 'var(--red)',   br: 'var(--red)'   }
        return (
          <div key={r.date} style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{r.date}</span>
            <span style={cell()}>{r.trades}</span>
            <span style={cell('var(--green)')}>{r.wins}</span>
            <span style={cell('var(--red)')}>{r.losses}</span>
            <span style={cell(wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)')}>{wr.toFixed(0)}%</span>
            <span style={cell('var(--dim)')}>{usd(r.volume)}</span>
            <span style={cell(green ? 'var(--green)' : 'var(--red)')}>{sgnUsd(r.pnl)}</span>
            <span style={{ textAlign: 'right' }}>
              <span style={{ padding: '1px 7px', borderRadius: 1, fontSize: 8, fontWeight: 700, background: badge.bg, color: badge.cl, border: `1px solid ${badge.br}55`, fontFamily: 'var(--mono)' }}>
                {green ? 'PROFIT' : 'LOSS'}
              </span>
            </span>
          </div>
        )
      })}
      {/* totals footer */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '4px 10px', borderTop: '1px solid var(--border2)', background: 'var(--bg2)' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', letterSpacing: '.07em' }}>TOTAL</span>
        <span style={cell()}>{totTrades}</span>
        <span style={cell('var(--green)')}>{totWins}</span>
        <span style={cell('var(--red)')}>{totTrades - totWins}</span>
        <span style={cell(totTrades ? (totWins/totTrades*100 >= 50 ? 'var(--green)' : 'var(--red)') : 'var(--dim)')}>
          {totTrades ? (totWins/totTrades*100).toFixed(0) : '—'}%
        </span>
        <span style={cell('var(--dim)')}>{usd(totVol)}</span>
        <span style={cell(totPnl >= 0 ? 'var(--green)' : 'var(--red)')}>{sgnUsd(totPnl)}</span>
        <span />
      </div>
    </div>
  )
}

// ─── PNL CALENDAR ────────────────────────────────────────────
function DayTradesModal({ date, trades, onClose }) {
  const onBackdrop = e => { if (e.target === e.currentTarget) onClose() }
  const pnl   = trades.reduce((s, t) => s + (t.pnl || 0), 0)
  const wins  = trades.filter(t => t.status === 'won').length
  const COLS  = '130px 50px 60px 70px 70px 70px 80px'

  return (
    <div onClick={onBackdrop} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg1)', border: '1px solid var(--border2)',
        borderRadius: 4, width: 680, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--white)', fontWeight: 700 }}>{date}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>
              {trades.length} trades · {wins}W/{trades.length - wins}L ·{' '}
              <span style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(pnl)}</span>
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--dim)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>
        {/* column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '5px 14px', fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
          <span>TIME (UTC)</span><span>SIDE</span><span style={{ textAlign: 'right' }}>ENTRY</span>
          <span style={{ textAlign: 'right' }}>SIZE</span><span style={{ textAlign: 'right' }}>SHARES</span>
          <span style={{ textAlign: 'right' }}>PNL</span><span style={{ textAlign: 'center' }}>STATUS</span>
        </div>
        {/* rows */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {trades.map((t, i) => {
            const won  = t.status === 'won'
            const lost = t.status === 'lost'
            const side = (t.outcome || '—').toUpperCase()
            const sc   = side === 'UP' || side === 'YES' ? 'var(--green)' : 'var(--red)'
            const time = (t.opened_at || '').slice(11, 19)
            const shares = (t.size || 0) / Math.max(t.price || 0.01, 0.01)
            const badge = won ? { bg: 'rgba(34,255,138,.15)', cl: 'var(--green)', br: 'var(--green)' }
                        : lost ? { bg: 'rgba(255,60,92,.15)',   cl: 'var(--red)',   br: 'var(--red)'   }
                        :        { bg: 'rgba(255,170,0,.15)',   cl: 'var(--amber)', br: 'var(--amber)' }
            return (
              <div key={t.id || i} style={{ display: 'grid', gridTemplateColumns: COLS, padding: '4px 14px', fontSize: 10, fontFamily: 'var(--mono)', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <span style={{ color: 'var(--dim)' }}>{time}</span>
                <span style={{ color: sc, fontWeight: 700 }}>{side}</span>
                <span style={{ textAlign: 'right', color: 'var(--white)' }}>{cents(t.price)}</span>
                <span style={{ textAlign: 'right', color: 'var(--white)' }}>{usd(t.size)}</span>
                <span style={{ textAlign: 'right', color: 'var(--dim)' }}>{num(shares, 2)}</span>
                <span style={{ textAlign: 'right', color: (t.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(t.pnl)}</span>
                <span style={{ textAlign: 'center' }}>
                  <span style={{ padding: '1px 8px', borderRadius: 1, fontSize: 9, fontWeight: 700, background: badge.bg, color: badge.cl, border: `1px solid ${badge.br}55` }}>
                    {won ? 'WIN' : lost ? 'LOSS' : 'OPEN'}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
        {/* footer summary */}
        <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '6px 14px', fontSize: 10, fontFamily: 'var(--mono)', borderTop: '1px solid var(--border2)', background: 'var(--bg2)' }}>
          <span style={{ color: 'var(--dim)', fontSize: 8, letterSpacing: '.07em' }}>TOTAL</span>
          <span />
          <span />
          <span style={{ textAlign: 'right', color: 'var(--white)' }}>{usd(trades.reduce((s,t) => s+(t.size||0), 0))}</span>
          <span />
          <span style={{ textAlign: 'right', color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(pnl)}</span>
          <span />
        </div>
      </div>
    </div>
  )
}

function PnlCalendar({ hist }) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [selected, setSelected] = useState(null) // { date, trades }

  // Build date → {pnl, trades, wins, losses} map from hist (LOCAL TZ)
  const dayMap = useMemo(() => {
    const m = {}
    hist.forEach(t => {
      if (!t.opened_at) return
      const d = localDateKey(t.opened_at)
      if (!m[d]) m[d] = { pnl: 0, trades: 0, wins: 0, losses: 0 }
      m[d].pnl    = round2(m[d].pnl + (t.pnl || 0))
      m[d].trades++
      if (t.status === 'won')  m[d].wins++
      if (t.status === 'lost') m[d].losses++
    })
    return m
  }, [hist])

  // Build date → trades[] map for modal (LOCAL TZ)
  const histByDate = useMemo(() => {
    const m = {}
    hist.forEach(t => {
      if (!t.opened_at) return
      const d = localDateKey(t.opened_at)
      if (!m[d]) m[d] = []
      m[d].push(t)
    })
    return m
  }, [hist])

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setMonth(0);  setYear(y => y + 1) } else setMonth(m => m + 1) }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' })
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // weekday of 1st: 0=Sun, make Mon=0
  const firstWd = ((new Date(year, month, 1).getDay() + 6) % 7)
  const days = ['Mo','Tu','We','Th','Fr','Sa','Su']

  // max absolute pnl for intensity scaling
  const allPnls = Object.values(dayMap).map(d => Math.abs(d.pnl))
  const maxAbs  = allPnls.length ? Math.max(...allPnls, 0.01) : 1

  const cells = []
  // empty lead cells
  for (let i = 0; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const dateKey = (d) => {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    return `${year}-${mm}-${dd}`
  }

  const cellSize = 46

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button onClick={prevMonth} style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', cursor: 'pointer', borderRadius: 2 }}>◀</button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--white)', fontWeight: 700, letterSpacing: '.08em', minWidth: 100, textAlign: 'center' }}>{monthName} {year}</span>
        <button onClick={nextMonth} style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', cursor: 'pointer', borderRadius: 2 }}>▶</button>
        {/* month summary */}
        {(() => {
          const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
          const mEntries = Object.entries(dayMap).filter(([k]) => k.startsWith(prefix))
          const mPnl    = mEntries.reduce((s, [, v]) => s + v.pnl, 0)
          const mTrades = mEntries.reduce((s, [, v]) => s + v.trades, 0)
          const mWins   = mEntries.reduce((s, [, v]) => s + v.wins, 0)
          if (!mTrades) return <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginLeft: 6 }}>no trades this month</span>
          return (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginLeft: 6 }}>
              {mTrades} trades · {mWins}W/{mTrades - mWins}L ·{' '}
              <span style={{ color: mPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(mPnl)}</span>
            </span>
          )
        })()}
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${cellSize}px)`, gap: 3, marginBottom: 3 }}>
        {days.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.07em' }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${cellSize}px)`, gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />
          const key  = dateKey(day)
          const data = dayMap[key]
          const isToday = key === localDateKey(today)
          let bg = 'var(--bg2)', borderColor = 'var(--border)', textColor = 'var(--dim2)', pnlColor = 'var(--dim)'
          if (data) {
            const intensity = Math.min(0.85, 0.15 + (Math.abs(data.pnl) / maxAbs) * 0.7)
            if (data.pnl > 0) {
              bg = `rgba(34,255,138,${intensity * 0.25})`
              borderColor = `rgba(34,255,138,${intensity * 0.6})`
              pnlColor = 'var(--green)'
            } else if (data.pnl < 0) {
              bg = `rgba(255,60,92,${intensity * 0.25})`
              borderColor = `rgba(255,60,92,${intensity * 0.6})`
              pnlColor = 'var(--red)'
            } else {
              bg = 'var(--bg2)'; pnlColor = 'var(--dim)'
            }
            textColor = 'var(--white)'
          }
          return (
            <div key={key}
              onClick={() => data && setSelected({ date: key, trades: histByDate[key] || [] })}
              style={{
                height: cellSize, border: `1px solid ${isToday ? 'var(--amber)' : borderColor}`,
                borderRadius: 3, background: bg, padding: '4px 5px',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                cursor: data ? 'pointer' : 'default',
                transition: 'filter 0.1s',
              }}
              onMouseEnter={e => { if (data) e.currentTarget.style.filter = 'brightness(1.25)' }}
              onMouseLeave={e => { e.currentTarget.style.filter = '' }}
            >
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: isToday ? 'var(--amber)' : textColor, fontWeight: isToday ? 700 : 400 }}>{day}</span>
              {data ? (
                <>
                  <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: pnlColor, fontWeight: 700, textAlign: 'right' }}>{sgnUsd(data.pnl)}</span>
                  <span style={{ fontSize: 7, fontFamily: 'var(--mono)', color: 'var(--dim)', textAlign: 'right' }}>{data.wins}W {data.losses}L</span>
                </>
              ) : (
                <span />
              )}
            </div>
          )
        })}
      </div>

      {selected && (
        <DayTradesModal
          date={selected.date}
          trades={selected.trades}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ─── HISTORY CARD (expandable, closed trade) ─────────────────
function HistoryCard({ t, idx }) {
  const [expanded, setExpanded] = useState(false)
  const won  = t.status === 'won'
  const lost = t.status === 'lost'
  const side = (t.outcome || '—').toUpperCase()
  const isUp = side === 'UP' || side === 'YES'
  const pnl  = t.pnl || 0
  const pnlPct = t.size ? (pnl / t.size) * 100 : 0
  // Color by RESULT (won/lost), not side — consistent visual signal
  const resultColor = won ? 'var(--green)' : lost ? 'var(--red)' : 'var(--amber)'
  const pnlColor    = pnl >= 0 ? 'var(--green)' : 'var(--red)'
  const cardBg      = won ? 'rgba(31,217,122,0.06)' : lost ? 'rgba(240,64,96,0.06)' : 'rgba(232,160,32,0.06)'
  const sideBg      = isUp ? 'rgba(31,217,122,0.10)' : 'rgba(240,64,96,0.10)'
  const sideColor   = isUp ? 'var(--green)' : 'var(--red)'
  const shares   = t.shares || (t.size || 0) / Math.max(t.price || 0.01, 0.01)
  const statusBadge = won
    ? { bg: 'rgba(31,217,122,0.15)', c: 'var(--green)', label: 'WIN' }
    : lost
    ? { bg: 'rgba(240,64,96,0.15)', c: 'var(--red)', label: 'LOSS' }
    : { bg: 'rgba(232,160,32,0.15)', c: 'var(--amber)', label: (t.status || 'open').toUpperCase() }

  // derive slug for Polymarket link
  const openedTs = Math.floor(new Date(t.opened_at).getTime() / 1000)
  const winStart = Math.floor(openedTs / 300) * 300
  const url = `https://polymarket.com/event/btc-updown-5m-${winStart}`

  return (
    <div onClick={() => setExpanded(e => !e)} style={{
      background: cardBg, border: `1px solid ${resultColor}33`,
      borderLeft: `3px solid ${resultColor}`, borderRadius: 3,
      padding: '6px 10px', marginBottom: 5, cursor: 'pointer',
      fontFamily: 'var(--mono)',
    }}>
      {/* Row 1: ID + Side + Result + PnL + Expand */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 9, color: 'var(--dim)' }}>#{idx}</span>
          <span style={{ fontSize: 10, color: 'var(--white)', fontWeight: 700 }}>{t.id}</span>
          <span style={{ fontSize: 9, padding: '1px 6px', background: sideBg, color: sideColor, fontWeight: 700, borderRadius: 2, letterSpacing: '.06em' }}>
            {isUp ? '▲' : '▼'} {side}
          </span>
          <span style={{ fontSize: 9, padding: '1px 6px', background: statusBadge.bg, color: statusBadge.c, fontWeight: 700, borderRadius: 2, letterSpacing: '.06em', border: `1px solid ${statusBadge.c}55` }}>
            {statusBadge.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: pnlColor }}>{sgnUsd(pnl)}</span>
          <span style={{ fontSize: 9, color: pnlColor, opacity: 0.8 }}>({sgnPct(pnlPct)})</span>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Row 2 compact */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, fontSize: 9, color: 'var(--dim)' }}>
        <span>entry <span style={{ color: 'var(--white)' }}>{cents(t.price)}</span></span>
        <span>exit <span style={{ color: 'var(--white)' }}>{cents(t.exit_price ?? (won ? 1 : 0))}</span></span>
        <span>size <span style={{ color: 'var(--white)' }}>{usd(t.size || 0)}</span></span>
        <span>shares <span style={{ color: 'var(--white)' }}>{num(shares, 2)}</span></span>
        <span>{dualTime(t.opened_at)}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div onClick={e => e.stopPropagation()} style={{
          marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border2)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', fontSize: 9,
        }}>
          <div style={{ gridColumn: '1 / span 2' }}>
            <DetailRow label="OPENED" value={dualDateTime(t.opened_at)} />
          </div>
          <div style={{ gridColumn: '1 / span 2' }}>
            <DetailRow label="CLOSED" value={dualDateTime(t.closed_at)} />
          </div>
          <DetailRow label="DURATION"   value={t.resolve_fmt || `${t.resolve_sec || 0}s`} />
          <DetailRow label="MODE"       value={(t.mode || '—').toUpperCase()} valueColor={t.mode === 'real' ? 'var(--amber)' : 'var(--green)'} />
          <DetailRow label="ENTRY"      value={cents(t.price)} />
          <DetailRow label="EXIT"       value={cents(t.exit_price ?? (won ? 1 : 0))} />
          <DetailRow label="PAYOUT"     value={usd(t.payout || 0)} valueColor={won ? 'var(--green)' : 'var(--dim)'} />
          <DetailRow label="P&L"        value={`${sgnUsd(pnl)} (${sgnPct(pnlPct)})`} valueColor={pnlColor} />
          <DetailRow label="EV"         value={t.ev != null ? (t.ev >= 0 ? `+${t.ev.toFixed(4)}` : t.ev.toFixed(4)) : '—'} valueColor={t.ev >= 0 ? 'var(--green)' : 'var(--red)'} />
          <DetailRow label="CONFIDENCE" value={t.confidence != null ? t.confidence.toFixed(2) : '—'} />
          <DetailRow label="TRUE PROB"  value={t.true_prob != null ? t.true_prob.toFixed(2) : '—'} />
          <DetailRow label="STRATEGY"   value={t.strategy || 'btc5m'} />
          <DetailRow label="COMPOUND BET" value={t.compound_bet != null ? usd(t.compound_bet) : '—'} />
          <DetailRow label="STATUS"     value={(t.status || 'open').toUpperCase()} valueColor={statusBadge.c} />
          <DetailRow label="ORDER ID"   value={t.order_id || '—'} small />
          <DetailRow label="ORDER TYPE" value={t.order_type || '—'} small />
          <DetailRow label="MARKET ID"  value={t.market_id || '—'} small />
          {t.condition_id && <div style={{ gridColumn: '1 / span 2' }}>
            <DetailRow label="CONDITION ID" value={t.condition_id} small mono />
          </div>}
          {t.question && <div style={{ gridColumn: '1 / span 2', marginTop: 4, padding: '4px 6px', background: 'var(--bg2)', borderRadius: 2 }}>
            <span style={{ fontSize: 8, color: 'var(--dim)', letterSpacing: '.07em' }}>MARKET</span>
            <div style={{ fontSize: 10, color: 'var(--white)', marginTop: 1 }}>{t.question}</div>
          </div>}
          <div style={{ gridColumn: '1 / span 2', marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
               style={{ fontSize: 9, color: 'var(--blue)', textDecoration: 'none', padding: '3px 8px', border: '1px solid var(--blue)', borderRadius: 2 }}>
              ↗ View on Polymarket
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function TradeHistory({ hist }) {
  const [tab, setTab] = useState('trades')
  const [page, setPage] = useState(1)
  const perPage = 10
  const pages = Math.max(1, Math.ceil(hist.length / perPage))
  const slice = hist.slice((page - 1) * perPage, page * perPage)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(hist, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `trades_${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      fontSize: 9, fontFamily: 'var(--mono)', letterSpacing: '.07em',
      background: tab === id ? 'var(--green)' : 'transparent',
      color: tab === id ? 'var(--bg)' : 'var(--dim)',
      border: `1px solid ${tab === id ? 'var(--green)' : 'var(--border2)'}`,
      padding: '2px 10px', borderRadius: 2, cursor: 'pointer', fontWeight: tab === id ? 700 : 400,
    }}>{label}</button>
  )

  return (
    <div style={{ background: 'var(--bg1)', borderTop: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {tabBtn('trades', 'TRADES')}
          {tabBtn('daily', 'DAILY')}
          {tab === 'trades' && (
            <button onClick={exportJson} style={{ fontSize: 8, fontFamily: 'var(--mono)', background: 'transparent', color: 'var(--amber)', border: '1px solid var(--amber)', padding: '2px 8px', borderRadius: 2, cursor: 'pointer', letterSpacing: '.05em' }}>EXPORT</button>
          )}
        </div>
        {tab === 'trades' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 9 }}>
            <span style={{ color: 'var(--dim)' }}>PAGE {page}/{pages}</span>
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={pgBtn(page > 1)}>PREV</button>
            <button disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))} style={pgBtn(page < pages)}>NEXT</button>
          </div>
        )}
      </div>

      {tab === 'trades' ? (
        <div style={{ overflowY: 'auto', flex: 1, padding: '6px' }}>
          {slice.length === 0 && <div style={{ padding: '20px', textAlign: 'center', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>no trade history</div>}
          {slice.map((t, i) => {
            const idx = (page - 1) * perPage + i + 1
            return <HistoryCard key={t.id || i} t={t} idx={idx} />
          })}
        </div>
      ) : (
        <DailyTable hist={hist} />
      )}
    </div>
  )
}
const panBtn = (enabled) => ({
  fontSize: 11, fontFamily: 'var(--mono)',
  background: enabled ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)',
  color: enabled ? 'var(--white)' : 'var(--dim2)',
  border: `1px solid ${enabled ? 'var(--border2)' : 'var(--border)'}`,
  padding: '2px 7px', borderRadius: 2,
  cursor: enabled ? 'pointer' : 'not-allowed',
  lineHeight: 1, fontWeight: 600,
})

const pgBtn = (enabled) => ({
  fontSize: 9, fontFamily: 'var(--mono)',
  background: enabled ? 'var(--bg2)' : 'var(--bg1)',
  color: enabled ? 'var(--white)' : 'var(--dim2)',
  border: `1px solid ${enabled ? 'var(--border2)' : 'var(--border)'}`,
  padding: '2px 10px', borderRadius: 1,
  cursor: enabled ? 'pointer' : 'not-allowed', letterSpacing: '.07em',
})

// ─── STRATEGY CONFIG SIDEBAR ─────────────────────────────────
function ConfigModal({ config, setConfig, onClose }) {
  const cfg = config?.config
  const [local, setLocal] = useState(cfg)
  const saveTimer = useRef(null)

  useEffect(() => { setLocal(cfg) }, [cfg])

  const patch = (k, v) => {
    setLocal(prev => ({ ...(prev || {}), [k]: v }))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setConfig({ [k]: v }), 400)
  }

  // Close on backdrop click
  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return (
    <div onClick={onBackdrop} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg1)', border: '1px solid var(--border2)',
        borderRadius: 4, width: 320, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border2)' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--green)', letterSpacing: '.1em', fontWeight: 700 }}>⚙ STRATEGY CONFIG</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--dim)', fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
        </div>
        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
          {!local ? <div style={{ color: 'var(--dim)', fontSize: 10, padding: 8 }}>loading config…</div> : (<>
      <SectionTitle>STRATEGY CONFIG</SectionTitle>

      <Section title="ASSET">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {ASSETS.map(a => (
            <button key={a.sym} disabled={!a.active} style={pillBtn(a.active)}>
              {a.sym}
            </button>
          ))}
        </div>
      </Section>

      <Section title="POSITION">
        <FieldRow>
          <NumField label="Bet Per Trade" suffix="USDC" value={local.bet_size} step={1}
                    onChange={v => patch('bet_size', v)} />
          <BoolField label="Compound" value={local.use_compound}
                     onChange={v => patch('use_compound', v)} />
        </FieldRow>
        <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 4 }}>
          {local.use_compound ? 'Bet = floor(equity/10), min $1' : `Fixed: $${local.bet_size}`}
        </div>
      </Section>

      <Section title="CIRCUIT BREAKERS">
        <div style={{ fontSize: 8, color: 'var(--dim)', marginBottom: 6 }}>
          Polymarket has no SL/TP. Bot pauses on these portfolio-level triggers; positions resolve naturally at window end (auto-claim).
        </div>
        <FieldRow>
          <NumField label="Max Loss Strike" value={local.max_loss_strike} step={1}
                    onChange={v => patch('max_loss_strike', v)} />
          <NumField label="Max Win Strike" value={local.max_win_strike} step={1}
                    onChange={v => patch('max_win_strike', v)} />
        </FieldRow>
        <FieldRow>
          <NumField label="Daily TP" suffix="$" value={local.daily_tp_usd} step={1}
                    onChange={v => patch('daily_tp_usd', v)} />
          <NumField label="Daily SL" suffix="$" value={local.daily_sl_usd} step={1}
                    onChange={v => patch('daily_sl_usd', v)} />
        </FieldRow>
      </Section>

      <Section title="ENTRY TRIGGERS">
        <FieldRow>
          <NumField label="Confidence Min" value={local.conf_threshold} step={0.05}
                    onChange={v => patch('conf_threshold', v)} />
          <NumField label="Trigger Range" suffix="%" value={local.trigger_range} step={0.1}
                    onChange={v => patch('trigger_range', v)} />
        </FieldRow>
      </Section>

      <Section title="PRICE WINDOW">
        <FieldRow>
          <NumField label="Price Min" suffix="¢" value={local.price_min_cents} step={1}
                    onChange={v => patch('price_min_cents', v)} />
          <NumField label="Price Max" suffix="¢" value={local.price_max_cents} step={1}
                    onChange={v => patch('price_max_cents', v)} />
        </FieldRow>
      </Section>

      <Section title="SENTIMENT FILTER">
        <FieldRow>
          <NumField label="Lower" suffix="%" value={local.sentiment_lower} step={0.1}
                    onChange={v => patch('sentiment_lower', v)} />
          <NumField label="Upper" suffix="%" value={local.sentiment_upper} step={0.1}
                    onChange={v => patch('sentiment_upper', v)} />
        </FieldRow>
      </Section>

      <Section title="TRADING HOURS">
        <FieldRow>
          <TextField label="Start" value={local.trading_start} placeholder="HH:MM"
                     onChange={v => patch('trading_start', v)} />
          <TextField label="End" value={local.trading_end} placeholder="HH:MM"
                     onChange={v => patch('trading_end', v)} />
        </FieldRow>
        <BoolField label="Trading Active (master switch)" value={local.trading_active}
                   onChange={v => patch('trading_active', v)} />
      </Section>

          <div style={{ fontSize: 8, color: 'var(--dim)', padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 6 }}>
            Changes auto-save (400ms debounce). Auto-claim USDC on resolve via redeem loop.
          </div>
        </>)}
        </div>
      </div>
    </div>
  )
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--white)', fontWeight: 700, letterSpacing: '.1em', padding: '6px 0', borderBottom: '1px solid var(--border2)', marginBottom: 6 }}>● {children}</div>
}
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 2, padding: 8, background: 'var(--bg2)' }}>
      <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '.1em', marginBottom: 6 }}>| {title}</div>
      {children}
    </div>
  )
}
function FieldRow({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 4 }}>{children}</div>
}
function NumField({ label, value, onChange, step = 1, suffix }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 8, color: 'var(--dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border2)', background: 'var(--bg1)', padding: '2px 4px' }}>
        <input type="number" value={value ?? 0} step={step}
               onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
               style={inputStyle} />
        {suffix && <span style={{ fontSize: 8, color: 'var(--dim)', marginLeft: 4 }}>{suffix}</span>}
      </div>
    </label>
  )
}
function TextField({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 8, color: 'var(--dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ border: '1px solid var(--border2)', background: 'var(--bg1)', padding: '2px 4px' }}>
        <input type="text" value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={inputStyle} />
      </div>
    </label>
  )
}
function BoolField({ label, value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', padding: '3px 6px', background: 'var(--bg1)',
      border: '1px solid var(--border2)', cursor: 'pointer',
      fontFamily: 'var(--mono)', fontSize: 9,
      color: value ? 'var(--green)' : 'var(--dim)', letterSpacing: '.05em',
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: 700 }}>{value ? '● ON' : '○ OFF'}</span>
    </button>
  )
}
const inputStyle = {
  background: 'transparent', border: 'none', color: 'var(--white)',
  fontFamily: 'var(--mono)', fontSize: 10, outline: 'none', width: '100%',
  padding: '2px 0',
}
const pillBtn = (active) => ({
  fontSize: 9, fontFamily: 'var(--mono)', padding: '4px 6px',
  background: active ? 'rgba(0,255,127,.1)' : 'var(--bg1)',
  color: active ? 'var(--green)' : 'var(--dim2)',
  border: `1px solid ${active ? 'var(--green)' : 'var(--border2)'}`,
  cursor: active ? 'pointer' : 'not-allowed', letterSpacing: '.07em',
  borderRadius: 1, fontWeight: active ? 700 : 400,
})

// ─── BOT CONTROLS (compact) ──────────────────────────────────
function Controls({ stats, start, stop, resumeGas }) {
  const running = stats?.running
  const gasPaused = stats?.gas?.paused
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {!running && <button onClick={start} style={ctrlBtn('var(--green)')}>▶ RUN</button>}
      {running && <button onClick={stop} style={ctrlBtn('var(--red)')}>■ STOP</button>}
      {gasPaused && <button onClick={resumeGas} style={ctrlBtn('var(--amber)')}>↻ RESUME GAS</button>}
    </div>
  )
}
const ctrlBtn = (c) => ({
  fontSize: 9, fontFamily: 'var(--mono)', padding: '4px 10px',
  background: 'transparent', color: c, border: `1px solid ${c}`,
  borderRadius: 2, cursor: 'pointer', fontWeight: 700, letterSpacing: '.07em',
})

// ─── MAIN APP ────────────────────────────────────────────────
export default function App() {
  const { stats, pos, hist, log, btc5m, balance, orderbook, config, conn,
          start, stop, resumeGas, setMode, setConfig } = useBot()
  const [showConfig, setShowConfig] = useState(false)
  const [, forceUpdate] = useState(0)
  const latency = useLatency()

  // Refresh USD/IDR rate on mount + every hour
  useEffect(() => {
    fetchUsdIdr().then(() => forceUpdate(x => x + 1))
    const id = setInterval(() => {
      fetchUsdIdr().then(() => forceUpdate(x => x + 1))
    }, 3600000) // 1 hour
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--white)', overflow: 'hidden' }}>
      <Header stats={stats} btc5m={btc5m} balance={balance} conn={conn} config={config} setMode={setMode}
              start={start} stop={stop} resumeGas={resumeGas} onConfigClick={() => setShowConfig(true)} log={log} />
      <StatsGrid stats={stats} btc5m={btc5m} balance={balance} />

      {/* Chart + Orderbook row — 2:1 ratio */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', flex: 1, minHeight: 0, borderBottom: '1px solid var(--border2)', overflow: 'hidden' }}>
        {/* Chart column */}
        <div style={{ borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <BtcChart btc5m={btc5m} orderbook={orderbook} pos={pos} hist={hist} />
          </div>
          {/* Compact info strip under chart */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', borderTop: '1px solid var(--border2)', background: 'var(--bg2)', flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <span>BOT_ID <span style={{ color: 'var(--white)' }}>{stats?.bot_id || '—'}</span></span>
              <span>STREAK <span style={{ color: 'var(--green)' }}>{stats?.win_streak || 0}W</span>/<span style={{ color: 'var(--red)' }}>{stats?.loss_streak || 0}L</span></span>
              <span>GAS <span style={{ color: stats?.gas?.status === 'ok' ? 'var(--green)' : stats?.gas?.status === 'low' ? 'var(--amber)' : 'var(--red)' }}>
                {stats?.gas?.orders_left ?? '—'} orders
              </span></span>
              <span>POL <span style={{ color: 'var(--white)' }}>{num(balance?.pol ?? stats?.gas?.pol_left, 3)}</span></span>
              <span>USD/IDR <span style={{ color: 'var(--amber)' }}>{USD_IDR.toLocaleString('id-ID')}</span></span>
              <span style={{ color: 'var(--dim2)' }}>|</span>
              <LatencyChip label="BNB"  ms={latency.binance} />
              <LatencyChip label="POLY" ms={latency.polymarket} />
              <LatencyChip label="BE"   ms={latency.backend} />
            </span>
          </div>
        </div>
        {/* Orderbook column — split vertically: Polymarket CLOB + Binance */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, borderBottom: '1px solid var(--border2)', overflow: 'hidden' }}>
            <OrderBook orderbook={orderbook} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <BinanceOrderbook />
          </div>
        </div>
      </div>

      {/* Bottom row: Open Positions | Trade History | PNL Calendar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 360px', borderBottom: '1px solid var(--border2)', minHeight: 280, maxHeight: 360 }}>
        <div style={{ borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <OpenPositions pos={pos} btc5m={btc5m} orderbook={orderbook} />
        </div>
        <div style={{ borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <TradeHistory hist={hist} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--dim)', letterSpacing: '.08em', flexShrink: 0 }}>
            PNL CALENDAR
          </div>
          <PnlCalendar hist={hist} />
        </div>
      </div>

      {/* Config modal */}
      {showConfig && <ConfigModal config={config} setConfig={setConfig} onClose={() => setShowConfig(false)} />}
    </div>
  )
}
