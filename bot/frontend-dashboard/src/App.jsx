import { useState, useEffect, useMemo } from 'react'

// ─── FORMATTERS ──────────────────────────────────────────────
const usd = (n, d=2) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const sgnUsd = (n) => { const v = Number(n||0); return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}` }
const sgnPct = (n) => { const v = Number(n||0); return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
const pad2   = (n) => String(n).padStart(2, '0')
const localDateKey = (input) => {
  const d = typeof input === 'string' ? new Date(input) : (input || new Date())
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
}
const round2 = (n) => Math.round(n * 100) / 100

// ─── DATA HOOK ───────────────────────────────────────────────
function useDashboard() {
  const [bots, setBots] = useState([])
  const [data, setData] = useState({}) // { bot_id: { stats, hist, health, mode } }

  // Load manifest once on mount
  useEffect(() => {
    fetch('/bots.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { bots: [] })
      .then(d => setBots(d.bots || []))
      .catch(() => setBots([]))
  }, [])

  // Poll each bot every 5s
  useEffect(() => {
    if (bots.length === 0) return
    let cancelled = false
    const poll = async () => {
      const updates = await Promise.all(bots.map(async (b) => {
        try {
          const [stats, hist, gas, storage] = await Promise.all([
            fetch(`http://localhost:${b.backend_port}/api/stats`,          { signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`http://localhost:${b.backend_port}/api/history?limit=300`, { signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : []).catch(() => []),
            fetch(`http://localhost:${b.backend_port}/api/gas`,            { signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`http://localhost:${b.backend_port}/api/storage`,        { signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : null).catch(() => null),
          ])
          return [b.id, { stats, hist, gas, storage, health: !!stats }]
        } catch {
          return [b.id, { stats: null, hist: [], gas: null, storage: null, health: false }]
        }
      }))
      if (!cancelled) {
        setData(prev => {
          const next = { ...prev }
          updates.forEach(([id, d]) => { next[id] = d })
          return next
        })
      }
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [bots])

  return { bots, data }
}

// ─── COMPACT PNL CALENDAR ────────────────────────────────────
function buildDayMap(hist) {
  const m = {}
  ;(hist || []).forEach(t => {
    if (!t.opened_at) return
    const d = localDateKey(t.opened_at)
    if (!m[d]) m[d] = { pnl: 0, trades: 0, wins: 0, losses: 0 }
    m[d].pnl    = round2(m[d].pnl + (t.pnl || 0))
    m[d].trades++
    if (t.status === 'won')  m[d].wins++
    if (t.status === 'lost') m[d].losses++
  })
  return m
}

function CompactCalendar({ hist, onDayClick }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const dayMap = useMemo(() => buildDayMap(hist), [hist])
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'short' })
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWd = ((new Date(year, month, 1).getDay() + 6) % 7)
  const days = ['M','T','W','T','F','S','S']

  const allPnls = Object.values(dayMap).map(d => Math.abs(d.pnl))
  const maxAbs  = allPnls.length ? Math.max(...allPnls, 0.01) : 1

  const cells = []
  for (let i = 0; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const dateKey = (d) => `${year}-${pad2(month+1)}-${pad2(d)}`
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const cellSize = 28

  // Month summary
  const prefix = `${year}-${pad2(month + 1)}-`
  const mEntries = Object.entries(dayMap).filter(([k]) => k.startsWith(prefix))
  const mPnl    = mEntries.reduce((s, [, v]) => s + v.pnl, 0)
  const mTrades = mEntries.reduce((s, [, v]) => s + v.trades, 0)
  const mWins   = mEntries.reduce((s, [, v]) => s + v.wins, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={prevMonth} style={navBtn}>◀</button>
          <span style={{ color: 'var(--white)', fontSize: 10, fontWeight: 700, minWidth: 80, textAlign: 'center' }}>{monthName} {year}</span>
          <button onClick={nextMonth} style={navBtn}>▶</button>
        </div>
        {mTrades > 0 ? (
          <span style={{ fontSize: 9, color: 'var(--dim)' }}>
            {mTrades}t · {mWins}W/{mTrades-mWins}L · <span style={{ color: mPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(mPnl)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 8, color: 'var(--dim2)' }}>no trades</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
        {days.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 7, color: 'var(--dim)' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />
          const key = dateKey(day)
          const d = dayMap[key]
          const isToday = key === localDateKey(today)
          let bg = 'var(--bg2)', borderColor = 'var(--border)', cl = 'var(--dim2)'
          if (d) {
            const intensity = Math.min(0.85, 0.20 + (Math.abs(d.pnl) / maxAbs) * 0.65)
            if (d.pnl > 0) { bg = `rgba(31,217,122,${intensity*0.30})`; borderColor = `rgba(31,217,122,${intensity*0.65})`; cl = 'var(--green)' }
            else if (d.pnl < 0) { bg = `rgba(240,64,96,${intensity*0.30})`; borderColor = `rgba(240,64,96,${intensity*0.65})`; cl = 'var(--red)' }
            else cl = 'var(--dim)'
          }
          const clickable = d && onDayClick
          return (
            <div key={key} title={d ? `${key}: ${sgnUsd(d.pnl)} (${d.wins}W/${d.losses}L) — click for detail` : key}
                 onClick={clickable ? () => onDayClick(key) : undefined}
                 onMouseEnter={clickable ? (e) => { e.currentTarget.style.filter = 'brightness(1.3)' } : undefined}
                 onMouseLeave={clickable ? (e) => { e.currentTarget.style.filter = '' } : undefined}
                 style={{ aspectRatio: '1', border: `1px solid ${isToday ? 'var(--amber)' : borderColor}`, borderRadius: 2, background: bg,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 1,
                          cursor: clickable ? 'pointer' : 'default', transition: 'filter 0.1s', minHeight: 32 }}>
              <span style={{ fontSize: 8, color: isToday ? 'var(--amber)' : 'var(--white)', fontWeight: isToday ? 700 : 400 }}>{day}</span>
              {d && <span style={{ fontSize: 7, color: cl, fontWeight: 700 }}>{d.pnl >= 0 ? '+' : '-'}{Math.abs(d.pnl).toFixed(1)}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
const navBtn = {
  background: 'transparent', border: '1px solid var(--border2)', color: 'var(--white)',
  fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 6px', cursor: 'pointer', borderRadius: 2,
}

// ─── DAY TRADES MODAL (with WIN/LOSS filter + summary) ──────
function DayTradesModal({ bot, date, trades, onClose }) {
  const [filter, setFilter] = useState('all') // all | win | loss

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  // Summary stats — newest first
  const sorted = useMemo(() =>
    [...trades].sort((a, b) => (b.opened_at || '').localeCompare(a.opened_at || '')),
    [trades])
  const wins   = sorted.filter(t => t.status === 'won').length
  const losses = sorted.filter(t => t.status === 'lost').length
  const opens  = sorted.filter(t => t.status !== 'won' && t.status !== 'lost').length
  const totPnl = sorted.reduce((s, t) => s + (t.pnl || 0), 0)
  const totSize = sorted.reduce((s, t) => s + (t.size || 0), 0)
  const totWinPnl  = sorted.filter(t => t.status === 'won').reduce((s, t) => s + (t.pnl || 0), 0)
  const totLossPnl = sorted.filter(t => t.status === 'lost').reduce((s, t) => s + (t.pnl || 0), 0)
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses) * 100) : 0
  const avgWin  = wins   > 0 ? totWinPnl  / wins   : 0
  const avgLoss = losses > 0 ? totLossPnl / losses : 0

  // Filter
  const filtered = sorted.filter(t => {
    if (filter === 'win')  return t.status === 'won'
    if (filter === 'loss') return t.status === 'lost'
    return true
  })

  // Date formatting (dual)
  const d = new Date(date + 'T00:00:00')
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  const filterBtn = (id, label, count, color) => (
    <button onClick={() => setFilter(id)} style={{
      fontFamily: 'var(--mono)', fontSize: 9, padding: '4px 12px', letterSpacing: '.07em',
      background: filter === id ? color : 'transparent',
      color: filter === id ? '#000' : color,
      border: `1px solid ${color}`,
      borderRadius: 2, cursor: 'pointer', fontWeight: 700,
    }}>{label} {count != null && <span style={{ opacity: 0.85 }}>({count})</span>}</button>
  )

  return (
    <div onClick={onBackdrop} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg1)', border: '1px solid var(--border2)', borderRadius: 4,
        width: '90%', maxWidth: 920, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, color: 'var(--white)', fontWeight: 700, letterSpacing: '.03em' }}>{bot.id}</span>
              <span style={{ fontSize: 8, color: 'var(--dim)', letterSpacing: '.08em', padding: '2px 6px', border: '1px solid var(--border2)', borderRadius: 2 }}>
                BE :{bot.backend_port}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 3, fontFamily: 'var(--mono)' }}>{dateLabel}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--dim)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>

        {/* Summary stats grid */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
            <StatBox label="TRADES"   value={sorted.length} color="var(--white)" />
            <StatBox label="WINS"     value={wins}    sub={`${winRate.toFixed(0)}%`} color="var(--green)" />
            <StatBox label="LOSSES"   value={losses}  sub={`${(100-winRate).toFixed(0)}%`} color="var(--red)" />
            <StatBox label="VOLUME"   value={usd(totSize)} sub="capital wagered" color="var(--dim)" />
            <StatBox label="NET P&L"  value={sgnUsd(totPnl)} color={totPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
            <StatBox label="AVG W/L"  value={`${sgnUsd(avgWin)} / ${sgnUsd(avgLoss)}`} sub="per trade" color="var(--white)" small />
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 8, color: 'var(--dim)', letterSpacing: '.08em', marginRight: 4 }}>FILTER</span>
          {filterBtn('all',  'ALL',  sorted.length, 'var(--blue)')}
          {filterBtn('win',  'WIN',  wins,          'var(--green)')}
          {filterBtn('loss', 'LOSS', losses,        'var(--red)')}
          {opens > 0 && <span style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--amber)' }}>· {opens} still open</span>}
        </div>

        {/* Trade table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--dim)', fontSize: 10 }}>no trades match filter</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 10 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)', position: 'sticky', top: 0 }}>
                  <th style={th}>#</th>
                  <th style={th}>ID</th>
                  <th style={th}>TIME (LOCAL · ET)</th>
                  <th style={th}>SIDE</th>
                  <th style={{ ...th, textAlign: 'right' }}>ENTRY</th>
                  <th style={{ ...th, textAlign: 'right' }}>SIZE</th>
                  <th style={{ ...th, textAlign: 'right' }}>SHARES</th>
                  <th style={{ ...th, textAlign: 'right' }}>P&L</th>
                  <th style={{ ...th, textAlign: 'right' }}>P&L %</th>
                  <th style={{ ...th, textAlign: 'center' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => {
                  const won  = t.status === 'won'
                  const lost = t.status === 'lost'
                  const side = (t.outcome || '—').toUpperCase()
                  const isUp = side === 'UP' || side === 'YES'
                  const sc = isUp ? 'var(--green)' : 'var(--red)'
                  const time = new Date(t.opened_at)
                  const timeLocal = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                  const timeET = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
                  const pnl = t.pnl || 0
                  const pnlPct = t.size ? (pnl / t.size) * 100 : 0
                  const shares = t.shares || (t.size || 0) / Math.max(t.price || 0.01, 0.01)
                  return (
                    <tr key={t.id || i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={td}><span style={{ color: 'var(--dim)' }}>{i + 1}</span></td>
                      <td style={td}><span style={{ color: 'var(--white)', fontWeight: 600 }}>{t.id}</span></td>
                      <td style={td}>
                        <span style={{ color: 'var(--white)' }}>{timeLocal}</span>{' '}
                        <span style={{ color: 'var(--dim)', fontSize: 9 }}>· {timeET.replace(' ', '')} ET</span>
                      </td>
                      <td style={td}><span style={{ color: sc, fontWeight: 700 }}>{isUp ? '▲' : '▼'} {side}</span></td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--white)' }}>{Math.round((t.price || 0) * 100)}¢</td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--white)' }}>{usd(t.size)}</td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--dim)' }}>{shares.toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'right', color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(pnl)}</td>
                      <td style={{ ...td, textAlign: 'right', color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{sgnPct(pnlPct)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 2, fontSize: 9, fontWeight: 700, letterSpacing: '.07em',
                          background: won ? 'rgba(31,217,122,.15)' : lost ? 'rgba(240,64,96,.15)' : 'rgba(232,160,32,.15)',
                          color:      won ? 'var(--green)'         : lost ? 'var(--red)'         : 'var(--amber)',
                          border:     `1px solid ${won ? 'var(--green)' : lost ? 'var(--red)' : 'var(--amber)'}55`,
                        }}>{won ? 'WIN' : lost ? 'LOSS' : 'OPEN'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border2)', background: 'var(--bg2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--dim)' }}>
          <span>Showing {filtered.length} of {sorted.length} trades</span>
          <span>ESC or click outside to close</span>
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, sub, color, small }) {
  return (
    <div style={{ background: 'var(--bg2)', padding: '6px 10px', borderRadius: 2, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 7, color: 'var(--dim)', letterSpacing: '.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: small ? 10 : 14, color: color || 'var(--white)', fontWeight: 700, marginTop: 2, fontFamily: 'var(--mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 7, color: 'var(--dim2)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
const th = { padding: '6px 10px', textAlign: 'left', fontSize: 7, color: 'var(--dim)', letterSpacing: '.08em', fontWeight: 600, borderBottom: '1px solid var(--border)' }
const td = { padding: '5px 10px', verticalAlign: 'middle' }

// ─── BOT CARD ────────────────────────────────────────────────
function GasBar({ orders }) {
  if (orders == null) return null
  const pct = Math.min(100, Math.max(0, orders / 200 * 100))
  const color = orders <= 3 ? 'var(--red)' : orders <= 10 ? 'var(--amber)' : 'var(--green)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 9, color, fontWeight: 700, minWidth: 30 }}>{orders}</span>
    </div>
  )
}

function StorageRow({ storage, gas }) {
  if (!storage && !gas) return null
  const totalMb = (storage?.data_mb ?? 0)
  const logMb   = ((storage?.log_be_mb ?? 0) + (storage?.log_fe_mb ?? 0))
  const polLeft = gas?.pol_left ?? null
  const ordersLeft = gas?.orders_left ?? null
  const gasColor = ordersLeft == null ? 'var(--dim)' : ordersLeft <= 3 ? 'var(--red)' : ordersLeft <= 10 ? 'var(--amber)' : 'var(--green)'
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 7, color: 'var(--dim)', letterSpacing: '.08em', fontWeight: 600 }}>STORAGE & GAS</span>
        <div style={{ display: 'flex', gap: 10, fontSize: 8, color: 'var(--dim)' }}>
          <span>data <span style={{ color: 'var(--white)' }}>{totalMb.toFixed(1)}MB</span></span>
          <span>logs <span style={{ color: 'var(--white)' }}>{logMb.toFixed(1)}MB</span></span>
          <span>db <span style={{ color: 'var(--white)' }}>{(storage?.db_mb ?? 0).toFixed(2)}MB</span></span>
          {polLeft != null && <span>POL <span style={{ color: gasColor, fontWeight: 700 }}>{polLeft.toFixed(2)}</span></span>}
        </div>
      </div>
      {ordersLeft != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 7, color: 'var(--dim)', minWidth: 60 }}>GAS ORDERS</span>
          <div style={{ flex: 1 }}><GasBar orders={ordersLeft} /></div>
          {ordersLeft <= 10 && (
            <span style={{ fontSize: 7, color: gasColor, fontWeight: 700, letterSpacing: '.06em' }}>
              {ordersLeft <= 3 ? '⚠ CRITICAL' : '⚠ LOW'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function BotCard({ bot, data, onStart, onStop, onDayClick }) {
  const { stats, hist, gas, storage, health } = data || {}
  const mode    = stats?.mode || '—'
  const running = stats?.running
  const equity  = stats?.capital ?? 0
  const pnl     = stats?.pnl ?? 0
  const roiPct  = stats?.roi_pct ?? 0
  const dailyPnl= stats?.daily_pnl ?? 0
  const wins    = stats?.wins ?? 0
  const losses  = stats?.losses ?? 0
  const winRate = stats?.win_rate ?? 0
  const pending = stats?.open_count ?? 0

  const modeColor = mode === 'REAL' ? 'var(--red)' : mode === 'DRY_RUN' ? 'var(--amber)' : 'var(--blue)'
  const statusColor = health ? (running ? 'var(--green)' : 'var(--amber)') : 'var(--red)'
  const statusLabel = !health ? 'OFFLINE' : running ? 'RUNNING' : 'PAUSED'

  const openDetail = () => window.open(`http://localhost:${bot.frontend_port}`, '_blank')

  return (
    <div style={{
      background: 'var(--bg1)', border: '1px solid var(--border2)',
      borderTop: `3px solid ${health ? 'var(--green)' : 'var(--red)'}`,
      borderRadius: 4, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--white)', letterSpacing: '.04em' }}>{bot.id}</span>
            <span style={{ fontSize: 9, padding: '2px 7px', background: `${modeColor}22`, color: modeColor, border: `1px solid ${modeColor}55`, borderRadius: 2, fontWeight: 700, letterSpacing: '.07em' }}>
              {mode}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 8, color: 'var(--dim)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, boxShadow: `0 0 4px ${statusColor}`, animation: running ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ color: statusColor, fontWeight: 700, letterSpacing: '.07em' }}>{statusLabel}</span>
            <span>·</span>
            <span>BE :{bot.backend_port}</span>
            <span>·</span>
            <span>FE :{bot.frontend_port}</span>
          </div>
        </div>
        <button onClick={openDetail} style={{
          fontFamily: 'var(--mono)', fontSize: 9, padding: '4px 10px',
          background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer', fontWeight: 700, letterSpacing: '.07em',
        }}>↗ OPEN</button>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Stat label="EQUITY" value={usd(equity)} color="var(--white)" />
        <Stat label="TOTAL PNL" value={sgnUsd(pnl)} sub={`${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%`} color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Stat label="DAILY PNL" value={sgnUsd(dailyPnl)} sub="today" color={dailyPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Stat label="WIN RATE" value={`${winRate.toFixed(0)}%`} sub={`${wins}W ${losses}L`} color={winRate >= 55 ? 'var(--green)' : winRate >= 45 ? 'var(--amber)' : 'var(--red)'} />
      </div>

      {/* Pending + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <span style={{ fontSize: 9, color: 'var(--dim)' }}>
          PENDING <span style={{ color: pending > 0 ? 'var(--amber)' : 'var(--dim2)', fontWeight: 700 }}>{pending}</span>
        </span>
        <div style={{ display: 'flex', gap: 5 }}>
          {!running && health && <button onClick={() => onStart(bot)} style={btnStyle('var(--green)')}>▶ RUN</button>}
          {running && <button onClick={() => onStop(bot)} style={btnStyle('var(--red)')}>■ STOP</button>}
          {!health && <span style={{ fontSize: 8, color: 'var(--red)' }}>start via terminal</span>}
        </div>
      </div>

      {/* Storage + Gas */}
      <StorageRow storage={storage} gas={gas} />

      {/* Calendar */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <CompactCalendar hist={hist || []} onDayClick={(dateKey) => onDayClick && onDayClick(bot, dateKey, hist || [])} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--bg2)', padding: '5px 7px', borderRadius: 2, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 7, color: 'var(--dim)', letterSpacing: '.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, color: color || 'var(--white)', fontWeight: 700, marginTop: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 7, color: 'var(--dim2)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

const btnStyle = (c) => ({
  fontFamily: 'var(--mono)', fontSize: 9, padding: '3px 9px',
  background: 'transparent', color: c, border: `1px solid ${c}`,
  borderRadius: 2, cursor: 'pointer', fontWeight: 700, letterSpacing: '.07em',
})

// ─── WITHDRAWAL VIEW ─────────────────────────────────────────
function WithdrawalView({ bots, data, onBack }) {
  const ready = bots.filter(b => {
    const s = data[b.id]?.stats
    return s && s.capital >= 100
  })
  const waiting = bots.filter(b => {
    const s = data[b.id]?.stats
    return s && s.capital < 100
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', padding: '14px' }}>
      <button
        onClick={onBack}
        style={{
          marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 9, padding: '6px 12px',
          background: 'var(--border)', color: 'var(--white)', border: 'none', borderRadius: 2,
          cursor: 'pointer', fontWeight: 700, letterSpacing: '.07em',
        }}
      >
        ← Back to Dashboard
      </button>

      <div style={{ maxWidth: 1000 }}>
        {/* Ready for WD */}
        {ready.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 10, letterSpacing: '.08em' }}>
              ✓ READY FOR WITHDRAWAL
            </h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {ready.map(b => {
                const s = data[b.id]?.stats
                const cap = usd(s.capital)
                const mode = s.mode_raw === 'dry_run' ? 'DRY' : s.mode_raw === 'real' ? 'REAL' : '?'
                return (
                  <div key={b.id} style={{
                    background: 'var(--bg1)', border: '1px solid var(--green)', borderLeft: '3px solid var(--green)',
                    borderRadius: 3, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--white)' }}>{b.id}</span>
                      <span style={{ marginLeft: 8, fontSize: 9, color: mode === 'DRY' ? 'var(--amber)' : 'var(--red)', fontWeight: 600 }}>
                        [{mode}]
                      </span>
                      <span style={{ marginLeft: 12, fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>
                        {cap} available
                      </span>
                    </div>
                    <span style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                      ./wd.sh suggest {b.id} 50
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Waiting */}
        {waiting.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 10, letterSpacing: '.08em' }}>
              ⏳ WAITING ({waiting.length})
            </h2>
            <div style={{ display: 'grid', gap: 6 }}>
              {waiting.map(b => {
                const s = data[b.id]?.stats
                const cap = usd(s.capital)
                const need = usd(100 - s.capital)
                return (
                  <div key={b.id} style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 2,
                    padding: 8, display: 'flex', justifyContent: 'space-between', fontSize: 9,
                  }}>
                    <span style={{ fontWeight: 600 }}>{b.id}: {cap}</span>
                    <span style={{ color: 'var(--dim)' }}>need +{need} → $100</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Quick Commands */}
        <div style={{ marginTop: 30, background: 'var(--bg1)', border: '1px solid var(--border2)', borderRadius: 3, padding: 12 }}>
          <h3 style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', marginBottom: 8, letterSpacing: '.07em' }}>
            QUICK COMMANDS
          </h3>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--dim2)', lineHeight: 1.6 }}>
            <div><span style={{ color: 'var(--blue)' }}>DRY_RUN:</span> <code>./wd.sh confirm {'{'}bot{'}'} dry_run --amount=X</code></div>
            <div><span style={{ color: 'var(--red)' }}>REAL:</span> <code>./wd.sh sync {'{'}bot{'}'} --balance=X --pol=Y</code></div>
            <div style={{ marginTop: 6, color: 'var(--dim)' }}><span style={{ color: 'var(--amber)' }}>Status:</span> <code>./wd.sh status</code> (terminal)</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 20, fontSize: 8, color: 'var(--dim)', textAlign: 'center', paddingBottom: 20 }}>
          Run commands in <code style={{ background: 'var(--bg2)', padding: '2px 5px', borderRadius: 1, color: 'var(--amber)' }}>
            bot/
          </code> directory · Use <code style={{ background: 'var(--bg2)', padding: '2px 5px', borderRadius: 1, color: 'var(--amber)' }}>
            ./wd.sh --help
          </code> for details
        </div>
      </div>
    </div>
  )
}

// ─── MAIN APP ────────────────────────────────────────────────
export default function App() {
  const { bots, data } = useDashboard()
  const [now, setNow] = useState(new Date())
  const [dayModal, setDayModal] = useState(null) // { bot, date, trades }
  const [view, setView] = useState('dashboard') // 'dashboard' | 'withdrawal'
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  const openDayModal = (bot, dateKey, hist) => {
    const trades = (hist || []).filter(t => t.opened_at && localDateKey(t.opened_at) === dateKey)
    setDayModal({ bot, date: dateKey, trades })
  }

  // If withdrawal view is active, show it instead
  if (view === 'withdrawal') {
    return <WithdrawalView bots={bots} data={data} onBack={() => setView('dashboard')} />
  }

  const startBot = async (bot) => {
    try {
      const r = await fetch(`http://localhost:${bot.backend_port}/api/bot/start`, { method: 'POST' })
      const d = await r.json()
      if (!d.ok && d.reason === 'gas_insufficient') {
        const msg = `⚠ ${bot.id} — Gas insufficient!\n\n` +
                    `Sisa: ${d.orders_left} transaksi\n` +
                    `Threshold: ≤${d.threshold} (auto-stop)\n` +
                    `POL balance: ${d.pol_left} POL\n\n` +
                    `Top-up POL ke wallet bot, lalu coba lagi.\n` +
                    `Atau force-start dengan: POST /api/bot/start?force=true`
        alert(msg)
      } else if (!d.ok) {
        alert(`${bot.id}: ${d.message || d.reason || 'Failed to start'}`)
      }
    } catch (e) {
      alert(`Failed to reach ${bot.id} backend (${bot.backend_port})`)
    }
  }
  const stopBot = (bot) => {
    fetch(`http://localhost:${bot.backend_port}/api/bot/stop`, { method: 'POST' })
      .catch(() => alert(`Failed to stop ${bot.id}`))
  }

  // Aggregate stats across bots
  const agg = useMemo(() => {
    let equity = 0, totalPnl = 0, dailyPnl = 0, trades = 0, wins = 0, losses = 0, alive = 0
    bots.forEach(b => {
      const d = data[b.id]
      if (d?.health) alive++
      const s = d?.stats
      if (!s) return
      equity   += s.capital ?? 0
      totalPnl += s.pnl ?? 0
      dailyPnl += s.daily_pnl ?? 0
      trades   += s.total_trades ?? 0
      wins     += s.wins ?? 0
      losses   += s.losses ?? 0
    })
    return { equity, totalPnl, dailyPnl, trades, wins, losses, alive }
  }, [bots, data])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 22, fontFamily: 'var(--mono)', letterSpacing: '.03em' }}>
            <span style={{ color: 'var(--green)' }}>Poly</span><span style={{ color: 'var(--white)' }}>pox</span>
            <span style={{ color: 'var(--dim)', fontSize: 14, marginLeft: 12 }}>Multi-Bot Dashboard</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>
            {now.toLocaleString('en-GB', { hour12: false })}
            {' · '}
            <span style={{ color: 'var(--amber)' }}>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })} ET</span>
          </div>
        </div>

        {/* Right side: WD button + aggregate summary */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
          <button
            onClick={() => setView('withdrawal')}
            style={{
              background: 'transparent',
              border: '1px solid var(--amber)',
              color: 'var(--amber)',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              padding: '6px 12px',
              cursor: 'pointer',
              borderRadius: 2,
              transition: 'all 200ms',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--amber)'
              e.target.style.color = 'var(--bg)'
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent'
              e.target.style.color = 'var(--amber)'
            }}
          >
            💰 WITHDRAWAL
          </button>

          {/* Aggregate summary */}
          <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--mono)' }}>
          <Sum label="BOTS ALIVE"  value={`${agg.alive}/${bots.length}`} />
          <Sum label="TOTAL EQUITY" value={usd(agg.equity)} />
          <Sum label="TOTAL PNL"   value={sgnUsd(agg.totalPnl)} color={agg.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Sum label="DAILY"       value={sgnUsd(agg.dailyPnl)} color={agg.dailyPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Sum label="W/L"         value={`${agg.wins}/${agg.losses}`} />
          </div>
        </div>
      </div>

      {/* Bot cards grid */}
      {bots.length === 0 ? (
        <div style={{ background: 'var(--bg1)', border: '1px solid var(--border2)', borderRadius: 4, padding: 30, textAlign: 'center', color: 'var(--dim)' }}>
          No bots registered.<br />
          Run <code style={{ background: 'var(--bg2)', padding: '2px 6px', borderRadius: 2, color: 'var(--amber)' }}>./orchestrator.sh discover</code> to scan <code style={{ color: 'var(--amber)' }}>backend/envs/real*.env</code>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 14 }}>
          {bots.map(b => <BotCard key={b.id} bot={b} data={data[b.id]} onStart={startBot} onStop={stopBot} onDayClick={openDayModal} />)}
        </div>
      )}

      <div style={{ marginTop: 24, padding: '8px 12px', background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 9, color: 'var(--dim)' }}>
        <span style={{ color: 'var(--amber)' }}>Tip:</span> Auto-refresh setiap 5s · Click <span style={{ color: 'var(--blue)' }}>↗ OPEN</span> untuk detail · Click <span style={{ color: 'var(--green)' }}>calendar day</span> untuk lihat trade detail · Manage via <code style={{ color: 'var(--amber)' }}>./orchestrator.sh</code>
      </div>

      {dayModal && (
        <DayTradesModal
          bot={dayModal.bot}
          date={dayModal.date}
          trades={dayModal.trades}
          onClose={() => setDayModal(null)}
        />
      )}
    </div>
  )
}

function Sum({ label, value, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 7, color: 'var(--dim)', letterSpacing: '.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: color || 'var(--white)', fontWeight: 700, marginTop: 1 }}>{value}</div>
    </div>
  )
}
