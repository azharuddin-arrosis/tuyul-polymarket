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
function buildDayMap(hist, withdrawals) {
  const m = {}
  ;(hist || []).forEach(t => {
    if (!t.opened_at) return
    const d = localDateKey(t.opened_at)
    if (!m[d]) m[d] = { pnl: 0, trades: 0, wins: 0, losses: 0, wd: 0 }
    m[d].pnl    = round2(m[d].pnl + (t.pnl || 0))
    m[d].trades++
    if (t.status === 'won')  m[d].wins++
    if (t.status === 'lost') m[d].losses++
  })
  ;(withdrawals || []).forEach(wd => {
    if (!wd.timestamp) return
    const d = localDateKey(wd.timestamp)
    if (!m[d]) m[d] = { pnl: 0, trades: 0, wins: 0, losses: 0, wd: 0 }
    m[d].wd = round2(m[d].wd + (wd.amount || 0))
  })
  return m
}

function CompactCalendar({ hist, withdrawals, onDayClick }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const dayMap = useMemo(() => buildDayMap(hist, withdrawals), [hist, withdrawals])
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
  const mWd     = mEntries.reduce((s, [, v]) => s + v.wd, 0)
  const mNetPnl = mPnl - mWd
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
        {mTrades > 0 || mWd > 0 ? (
          <span style={{ fontSize: 9, color: 'var(--dim)' }}>
            {mTrades}t · {mWins}W/{mTrades-mWins}L · <span style={{ color: mPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(mPnl)}</span>{mWd > 0 && <span style={{ color: 'var(--amber)' }}> − ${mWd.toFixed(2)} WD</span>} = <span style={{ color: mNetPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{sgnUsd(mNetPnl)}</span>
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
          const netPnl = d ? round2(d.pnl - d.wd) : 0
          let bg = 'var(--bg2)', borderColor = 'var(--border)', cl = 'var(--dim2)'
          if (d && (d.pnl !== 0 || d.wd !== 0)) {
            const intensity = Math.min(0.85, 0.20 + (Math.abs(netPnl) / maxAbs) * 0.65)
            if (netPnl > 0) { bg = `rgba(31,217,122,${intensity*0.30})`; borderColor = `rgba(31,217,122,${intensity*0.65})`; cl = 'var(--green)' }
            else if (netPnl < 0) { bg = `rgba(240,64,96,${intensity*0.30})`; borderColor = `rgba(240,64,96,${intensity*0.65})`; cl = 'var(--red)' }
            else cl = 'var(--dim)'
          }
          const clickable = d && onDayClick
          const tooltip = d ? `${key}: ${sgnUsd(d.pnl)}${d.wd > 0 ? ` − ${d.wd.toFixed(1)} WD = ${sgnUsd(netPnl)}` : ''} (${d.wins}W/${d.losses}L) — click for detail` : key
          return (
            <div key={key} title={tooltip}
                 onClick={clickable ? () => onDayClick(key) : undefined}
                 onMouseEnter={clickable ? (e) => { e.currentTarget.style.filter = 'brightness(1.3)' } : undefined}
                 onMouseLeave={clickable ? (e) => { e.currentTarget.style.filter = '' } : undefined}
                 style={{ aspectRatio: '1', border: `1px solid ${isToday ? 'var(--amber)' : borderColor}`, borderRadius: 2, background: bg,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 1,
                          cursor: clickable ? 'pointer' : 'default', transition: 'filter 0.1s', minHeight: 0 }}>
              <span style={{ fontSize: 8, color: isToday ? 'var(--amber)' : 'var(--white)', fontWeight: isToday ? 700 : 400 }}>{day}</span>
              {d && <span style={{ fontSize: 7, color: cl, fontWeight: 700 }}>{netPnl >= 0 ? '+' : '-'}{Math.abs(netPnl).toFixed(1)}</span>}
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
function DayTradesModal({ bot, date, trades, withdrawals, onClose }) {
  const [filter, setFilter] = useState('all') // all | win | loss

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  // Summary stats — newest first (trades only for stats)
  const sorted = useMemo(() =>
    [...trades].sort((a, b) => (b.opened_at || '').localeCompare(a.opened_at || '')),
    [trades])
  const wins   = sorted.filter(t => t.status === 'won').length
  const losses = sorted.filter(t => t.status === 'lost').length
  const opens  = sorted.filter(t => t.status !== 'won' && t.status !== 'lost').length
  const totPnl = sorted.reduce((s, t) => s + (t.pnl || 0), 0)
  const totWd  = (withdrawals || []).reduce((s, wd) => s + (wd.amount || 0), 0)
  const netPnl = round2(totPnl - totWd)
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
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${totWd > 0 ? 7 : 6}, 1fr)`, gap: 8 }}>
            <StatBox label="TRADES"   value={sorted.length} color="var(--white)" />
            <StatBox label="WINS"     value={wins}    sub={`${winRate.toFixed(0)}%`} color="var(--green)" />
            <StatBox label="LOSSES"   value={losses}  sub={`${(100-winRate).toFixed(0)}%`} color="var(--red)" />
            <StatBox label="VOLUME"   value={usd(totSize)} sub="capital wagered" color="var(--dim)" />
            <StatBox label="P&L"      value={sgnUsd(totPnl)} color={totPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
            {totWd > 0 && <StatBox label="WD" value={sgnUsd(-totWd)} color="var(--amber)" />}
            <StatBox label={totWd > 0 ? "NET" : "AVG W/L"} value={totWd > 0 ? sgnUsd(netPnl) : `${sgnUsd(avgWin)} / ${sgnUsd(avgLoss)}`} sub={totWd > 0 ? "after WD" : "per trade"} color={totWd > 0 ? (netPnl >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--white)'} small />
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
                {(() => {
                  // Merge trades + withdrawals, sort newest first
                  const merged = [
                    ...filtered.map(t => ({ type: 'trade', data: t })),
                    ...(filter === 'all' ? (withdrawals || []).map(wd => ({ type: 'wd', data: wd })) : [])
                  ].sort((a, b) => {
                    const timeA = a.data.opened_at || a.data.timestamp || ''
                    const timeB = b.data.opened_at || b.data.timestamp || ''
                    return timeB.localeCompare(timeA)
                  })

                  return merged.map((item, i) => {
                    if (item.type === 'trade') {
                      const t = item.data
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
                        <tr key={t.id || `t${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
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
                    } else {
                      // WD row
                      const wd = item.data
                      const time = new Date(wd.timestamp)
                      const timeLocal = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                      const timeET = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
                      return (
                        <tr key={`wd${i}`} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(232,160,32,.05)' }}>
                          <td style={td}><span style={{ color: 'var(--dim)' }}>{i + 1}</span></td>
                          <td style={td}><span style={{ color: 'var(--amber)', fontWeight: 600 }}>WD</span></td>
                          <td style={td}>
                            <span style={{ color: 'var(--white)' }}>{timeLocal}</span>{' '}
                            <span style={{ color: 'var(--dim)', fontSize: 9 }}>· {timeET.replace(' ', '')} ET</span>
                          </td>
                          <td style={td}><span style={{ color: 'var(--amber)', fontWeight: 700 }}>— WD —</span></td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--dim)' }}>—</td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--amber)' }}>−{usd(wd.amount)}</td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--dim)' }}>—</td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--amber)', fontWeight: 700 }}>−{usd(wd.amount)}</td>
                          <td style={{ ...td, textAlign: 'right', color: 'var(--amber)' }}>—</td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 2, fontSize: 9, fontWeight: 700, letterSpacing: '.07em',
                              background: 'rgba(232,160,32,.15)',
                              color: 'var(--amber)',
                              border: '1px solid rgba(232,160,32,.55)',
                            }}>WD</span>
                          </td>
                        </tr>
                      )
                    }
                  })
                })()}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border2)', background: 'var(--bg2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--dim)' }}>
          <span>Showing {filtered.length} trades{withdrawals && withdrawals.length > 0 && ` + ${withdrawals.length} WD`} {filter !== 'all' ? `(filtered by ${filter.toUpperCase()})` : ''}</span>
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

function BotCard({ bot, data, onStart, onStop, onDayClick, onWithdrawal, onHistory }) {
  const { stats, hist, gas, storage, health } = data || {}
  const withdrawals = stats?.withdrawal_history || []
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
      borderTop: `2px solid ${health ? 'var(--green)' : 'var(--red)'}`,
      borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden',
    }}>
      {/* Header row — bot id + mode + status + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        {/* Left: id + mode badge + status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--white)', letterSpacing: '.04em' }}>{bot.id}</span>
          <span style={{ fontSize: 7, padding: '1px 5px', background: `${modeColor}22`, color: modeColor, border: `1px solid ${modeColor}44`, borderRadius: 2, fontWeight: 700, letterSpacing: '.06em' }}>{mode}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, boxShadow: `0 0 4px ${statusColor}`, animation: running ? 'pulse 2s infinite' : 'none', flexShrink: 0 }} />
            <span style={{ fontSize: 7, color: statusColor, fontWeight: 700, letterSpacing: '.06em' }}>{statusLabel}</span>
          </span>
          <span style={{ fontSize: 7, color: 'var(--dim)' }}>:{bot.backend_port}</span>
          {pending > 0 && <span style={{ fontSize: 7, color: 'var(--amber)', fontWeight: 700 }}>· {pending} open</span>}
        </div>
        {/* Right: all buttons same size/style */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {!running && health && <button onClick={() => onStart(bot)} style={btnStyle('var(--green)')}>▶ RUN</button>}
          {running  && health && <button onClick={() => onStop(bot)}  style={btnStyle('var(--red)')}>■ STOP</button>}
          {!health  && <span style={{ fontSize: 7, color: 'var(--red)' }}>OFFLINE</span>}
          {equity >= 100 && onWithdrawal && <button onClick={() => onWithdrawal(bot)} style={btnStyle('var(--amber)')}>💰 WD</button>}
          {onHistory && <button onClick={() => onHistory(bot)} style={btnStyle('var(--dim2)')}>HIST</button>}
          <button onClick={openDetail} style={btnStyle('var(--blue)')}>↗ OPEN</button>
        </div>
      </div>

      {/* Stats grid — 4 cols */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, flexShrink: 0 }}>
        <Stat label="EQUITY"    value={usd(equity)} color="var(--white)" />
        <Stat label="TOTAL PNL" value={sgnUsd(pnl)} sub={`${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%`} color={pnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Stat label="DAILY PNL" value={sgnUsd(dailyPnl)} sub="today" color={dailyPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Stat label="WIN RATE"  value={`${winRate.toFixed(0)}%`} sub={`${wins}W ${losses}L`} color={winRate >= 55 ? 'var(--green)' : winRate >= 45 ? 'var(--amber)' : 'var(--red)'} />
      </div>

      {/* Storage + Gas — compact */}
      <StorageRow storage={storage} gas={gas} />

      {/* Calendar — flex 1 fills remaining space */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <CompactCalendar hist={hist || []} withdrawals={withdrawals || []} onDayClick={(dateKey) => onDayClick && onDayClick(bot, dateKey, hist || [], withdrawals || [])} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--bg2)', padding: '4px 6px', borderRadius: 2, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 6, color: 'var(--dim)', letterSpacing: '.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 11, color: color || 'var(--white)', fontWeight: 700, marginTop: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 6, color: 'var(--dim2)', marginTop: 1 }}>{sub}</div>}
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
  const [wdModal, setWdModal] = useState(null) // { botId, capital, mode, percent }
  const [wdLoading, setWdLoading] = useState(false)
  const [wdResult, setWdResult] = useState(null) // { ok, message, error }

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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => setWdModal({ botId: b.id, capital: s.capital, mode, percent: 50, backendPort: b.backend_port })}
                        style={{
                          fontFamily: 'var(--mono)', fontSize: 8, padding: '4px 10px',
                          background: 'var(--green)', color: 'var(--bg)', border: 'none', borderRadius: 2,
                          cursor: 'pointer', fontWeight: 700,
                        }}
                      >
                        WD NOW →
                      </button>
                      <span style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                        suggest 50%
                      </span>
                    </div>
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

      {/* Withdrawal Modal */}
      {wdModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999,
        }} onClick={() => setWdModal(null)}>
          <div style={{
            background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 4, padding: 16, maxWidth: 500,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--white)' }}>
              Withdrawal: <span style={{ color: 'var(--amber)' }}>{wdModal.botId}</span> [{wdModal.mode}]
            </div>

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 2, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 6 }}>Current Capital</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
                ${Number(wdModal.capital).toFixed(2)}
              </div>
            </div>

            <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 6 }}>Suggestion: Withdraw {wdModal.percent}%</div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 2, padding: 8, marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 9 }}>
              <div style={{ color: 'var(--amber)', marginBottom: 4 }}>Withdraw Amount</div>
              <div style={{ color: 'var(--green)', fontWeight: 700 }}>
                ${(wdModal.capital * wdModal.percent / 100).toFixed(2)}
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 8, marginTop: 4 }}>
                Keep: ${(wdModal.capital * (100 - wdModal.percent) / 100).toFixed(2)}
              </div>
            </div>

            {wdResult && (
              <div style={{
                background: wdResult.ok ? 'var(--green)' : 'var(--red)', borderRadius: 2, padding: 10,
                marginBottom: 14, fontSize: 9, color: 'var(--white)', fontFamily: 'var(--mono)',
              }}>
                {wdResult.ok ? '✓ Withdrawal successful!' : `✗ ${wdResult.error}`}
              </div>
            )}

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--amber)', borderRadius: 2, padding: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 8, color: 'var(--amber)', marginBottom: 6, fontFamily: 'var(--mono)' }}>EXECUTING:</div>
              <div style={{ fontSize: 8, color: 'var(--white)', fontFamily: 'var(--mono)', wordBreak: 'break-all', lineHeight: 1.4 }}>
                ./wd.sh confirm <span style={{ color: 'var(--green)' }}>{wdModal.botId}</span> <span style={{ color: 'var(--amber)' }}>dry_run</span> --amount=<span style={{ color: 'var(--cyan)' }}>{(wdModal.capital * wdModal.percent / 100).toFixed(2)}</span>
              </div>
              <button
                onClick={async () => {
                  setWdLoading(true)
                  setWdResult(null)
                  try {
                    const amount = (wdModal.capital * wdModal.percent / 100).toFixed(2)
                    const url = `http://localhost:${wdModal.backendPort}/api/withdrawal/execute?bot_id=${wdModal.botId}&amount=${amount}`
                    const response = await fetch(url, { method: 'POST' })
                    const result = await response.json()
                    if (result.ok) {
                      setWdResult({ ok: true, message: `${wdModal.botId}: $${amount} withdrawn` })
                      setTimeout(() => {
                        setWdModal(null)
                        setWdResult(null)
                      }, 2000)
                    } else {
                      setWdResult({ ok: false, error: result.error || 'Unknown error' })
                    }
                  } catch (e) {
                    setWdResult({ ok: false, error: e.message })
                  }
                  setWdLoading(false)
                }}
                disabled={wdLoading}
                style={{
                  marginTop: 8, fontFamily: 'var(--mono)', fontSize: 8, padding: '6px 12px',
                  background: wdLoading ? 'var(--dim)' : 'var(--green)', color: 'var(--bg)',
                  border: 'none', borderRadius: 2, cursor: wdLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                }}
              >
                {wdLoading ? 'EXECUTING...' : 'EXECUTE WITHDRAWAL'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setWdModal(null)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 8, padding: '6px 12px',
                  background: 'var(--border)', color: 'var(--white)', border: 'none', borderRadius: 2,
                  cursor: 'pointer', fontWeight: 700,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MAIN APP ────────────────────────────────────────────────
export default function App() {
  const { bots, data } = useDashboard()
  const [now, setNow] = useState(new Date())
  const [dayModal, setDayModal] = useState(null) // { bot, date, trades, withdrawals }
  const [view, setView] = useState('dashboard') // 'dashboard' | 'withdrawal'
  const [wdModal, setWdModal] = useState(null) // { botId, capital, mode, percent, backendPort }
  const [wdLoading, setWdLoading] = useState(false)
  const [wdResult, setWdResult] = useState(null) // { ok, message, error }
  const [historyModal, setHistoryModal] = useState(null) // { botId, history }
  const [historyLoading, setHistoryLoading] = useState(false)
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  const openDayModal = (bot, dateKey, hist, wdList) => {
    const trades = (hist || []).filter(t => t.opened_at && localDateKey(t.opened_at) === dateKey)
    const withdrawals = (wdList || []).filter(wd => wd.timestamp && localDateKey(wd.timestamp) === dateKey)
    setDayModal({ bot, date: dateKey, trades, withdrawals })
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

  const handleWithdrawal = (bot) => {
    const s = data[bot.id]?.stats
    if (s && s.capital >= 100) {
      const mode = s.mode_raw === 'dry_run' ? 'DRY' : s.mode_raw === 'real' ? 'REAL' : '?'
      setWdModal({ botId: bot.id, capital: s.capital, mode, percent: 50, backendPort: bot.backend_port })
    }
  }

  const handleHistory = async (bot) => {
    setHistoryLoading(true)
    try {
      const response = await fetch(`http://localhost:${bot.backend_port}/api/withdrawal/history?bot_id=${bot.id}`)
      const result = await response.json()
      if (result.ok) {
        setHistoryModal({ botId: bot.id, history: result.history || [] })
      } else {
        alert(`Failed to load history: ${result.error}`)
      }
    } catch (e) {
      alert(`Error loading history: ${e.message}`)
    }
    setHistoryLoading(false)
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

  // Render withdrawal view if active, otherwise dashboard
  if (view === 'withdrawal') {
    return <WithdrawalView bots={bots} data={data} onBack={() => setView('dashboard')} />
  }

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: 'var(--bg)', padding: '8px 12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header — compact single row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 16, fontFamily: 'var(--mono)', letterSpacing: '.03em' }}>
            <span style={{ color: 'var(--green)' }}>Poly</span><span style={{ color: 'var(--white)' }}>pox</span>
            <span style={{ color: 'var(--dim)', fontSize: 10, marginLeft: 10 }}>Multi-Bot</span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--dim)' }}>
            {now.toLocaleString('en-GB', { hour12: false })}
            {' · '}
            <span style={{ color: 'var(--amber)' }}>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })} ET</span>
          </div>
        </div>

        {/* Right: aggregate + WD button */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontFamily: 'var(--mono)' }}>
          <Sum label="ALIVE"  value={`${agg.alive}/${bots.length}`} />
          <Sum label="EQUITY" value={usd(agg.equity)} />
          <Sum label="PNL"    value={sgnUsd(agg.totalPnl)} color={agg.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Sum label="DAILY"  value={sgnUsd(agg.dailyPnl)} color={agg.dailyPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Sum label="W/L"    value={`${agg.wins}/${agg.losses}`} />
          <button onClick={() => setView('withdrawal')} style={{ background: 'transparent', border: '1px solid var(--amber)', color: 'var(--amber)', fontFamily: 'var(--mono)', fontSize: 9, padding: '4px 10px', cursor: 'pointer', borderRadius: 2 }}>
            💰 WD
          </button>
        </div>
      </div>

      {/* Bot cards grid — fills remaining height */}
      {bots.length === 0 ? (
        <div style={{ flex: 1, background: 'var(--bg1)', border: '1px solid var(--border2)', borderRadius: 4, padding: 30, textAlign: 'center', color: 'var(--dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          No bots registered. Run <code style={{ background: 'var(--bg2)', padding: '2px 6px', marginLeft: 6, borderRadius: 2, color: 'var(--amber)' }}>./orchestrator.sh discover</code>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: `repeat(${Math.min(bots.length, 4)}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(bots.length / Math.min(bots.length, 4))}, 1fr)`, gap: 8 }}>
          {bots.map(b => <BotCard key={b.id} bot={b} data={data[b.id]} onStart={startBot} onStop={stopBot} onDayClick={openDayModal} onWithdrawal={handleWithdrawal} onHistory={handleHistory} />)}
        </div>
      )}

      {dayModal && (
        <DayTradesModal
          bot={dayModal.bot}
          date={dayModal.date}
          trades={dayModal.trades}
          withdrawals={dayModal.withdrawals}
          onClose={() => setDayModal(null)}
        />
      )}

      {/* Withdrawal Modal (App level) */}
      {wdModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999,
        }} onClick={() => setWdModal(null)}>
          <div style={{
            background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 4, padding: 16, maxWidth: 500,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--white)' }}>
              Withdrawal: <span style={{ color: 'var(--amber)' }}>{wdModal.botId}</span> [{wdModal.mode}]
            </div>

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 2, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 6 }}>Current Capital</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
                ${Number(wdModal.capital).toFixed(2)}
              </div>
            </div>

            <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 6 }}>Suggestion: Withdraw {wdModal.percent}%</div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 2, padding: 8, marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 9 }}>
              <div style={{ color: 'var(--amber)', marginBottom: 4 }}>Withdraw Amount</div>
              <div style={{ color: 'var(--green)', fontWeight: 700 }}>
                ${(wdModal.capital * wdModal.percent / 100).toFixed(2)}
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 8, marginTop: 4 }}>
                Keep: ${(wdModal.capital * (100 - wdModal.percent) / 100).toFixed(2)}
              </div>
            </div>

            {wdResult && (
              <div style={{
                background: wdResult.ok ? 'var(--green)' : 'var(--red)', borderRadius: 2, padding: 10,
                marginBottom: 14, fontSize: 9, color: 'var(--white)', fontFamily: 'var(--mono)',
              }}>
                {wdResult.ok ? '✓ Withdrawal successful!' : `✗ ${wdResult.error}`}
              </div>
            )}

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--amber)', borderRadius: 2, padding: 10, marginBottom: 14 }}>
              <button
                onClick={async () => {
                  setWdLoading(true)
                  setWdResult(null)
                  try {
                    const amount = (wdModal.capital * wdModal.percent / 100).toFixed(2)
                    const url = `http://localhost:${wdModal.backendPort}/api/withdrawal/execute?bot_id=${wdModal.botId}&amount=${amount}`
                    const response = await fetch(url, { method: 'POST' })
                    const result = await response.json()
                    if (result.ok) {
                      setWdResult({ ok: true, message: `${wdModal.botId}: $${amount} withdrawn` })
                      setTimeout(() => {
                        setWdModal(null)
                        setWdResult(null)
                      }, 2000)
                    } else {
                      setWdResult({ ok: false, error: result.error || 'Unknown error' })
                    }
                  } catch (e) {
                    setWdResult({ ok: false, error: e.message })
                  }
                  setWdLoading(false)
                }}
                disabled={wdLoading}
                style={{
                  width: '100%', fontFamily: 'var(--mono)', fontSize: 8, padding: '8px 12px',
                  background: wdLoading ? 'var(--dim)' : 'var(--green)', color: 'var(--bg)',
                  border: 'none', borderRadius: 2, cursor: wdLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                }}
              >
                {wdLoading ? 'EXECUTING...' : 'EXECUTE WITHDRAWAL'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setWdModal(null)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 8, padding: '6px 12px',
                  background: 'var(--border)', color: 'var(--white)', border: 'none', borderRadius: 2,
                  cursor: 'pointer', fontWeight: 700,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal History Modal */}
      {historyModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999,
        }} onClick={() => setHistoryModal(null)}>
          <div style={{
            background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 4, padding: 16, maxWidth: 700,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)', maxHeight: '80vh', overflowY: 'auto',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 14, color: 'var(--white)' }}>
              Withdrawal History: <span style={{ color: 'var(--amber)' }}>{historyModal.botId}</span>
            </div>

            {historyModal.history.length === 0 ? (
              <div style={{ color: 'var(--dim)', fontSize: 9, textAlign: 'center', padding: 20 }}>
                (no withdrawals yet)
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', fontSize: 8, borderCollapse: 'collapse', fontFamily: 'var(--mono)',
                  borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                }}>
                  <thead>
                    <tr style={{ background: 'var(--bg2)' }}>
                      <th style={{ padding: 8, textAlign: 'left', color: 'var(--amber)', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>DATE</th>
                      <th style={{ padding: 8, textAlign: 'right', color: 'var(--amber)', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>BEFORE</th>
                      <th style={{ padding: 8, textAlign: 'right', color: 'var(--amber)', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>WITHDRAWN</th>
                      <th style={{ padding: 8, textAlign: 'right', color: 'var(--amber)', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>AFTER</th>
                      <th style={{ padding: 8, textAlign: 'center', color: 'var(--amber)', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>MODE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyModal.history.map((h, i) => {
                      const date = h.timestamp ? h.timestamp.split('T')[0] : '—'
                      const modeColor = h.mode === 'DRY_RUN' || h.mode === 'dry_run' ? 'var(--amber)' : 'var(--red)'
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                          <td style={{ padding: 8, color: 'var(--white)' }}>{date}</td>
                          <td style={{ padding: 8, textAlign: 'right', color: 'var(--dim2)' }}>${Number(h.capital_before).toFixed(2)}</td>
                          <td style={{ padding: 8, textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>${Number(h.amount_withdrawn).toFixed(2)}</td>
                          <td style={{ padding: 8, textAlign: 'right', color: 'var(--cyan)' }}>${Number(h.capital_after).toFixed(2)}</td>
                          <td style={{ padding: 8, textAlign: 'center', color: modeColor, fontWeight: 600 }}>
                            {h.mode === 'DRY_RUN' || h.mode === 'dry_run' ? 'DRY' : 'REAL'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                onClick={() => setHistoryModal(null)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 8, padding: '6px 12px',
                  background: 'var(--border)', color: 'var(--white)', border: 'none', borderRadius: 2,
                  cursor: 'pointer', fontWeight: 700,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
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
