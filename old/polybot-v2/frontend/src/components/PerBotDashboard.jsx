// ═══════════════════════════════════════════════════════════════════
// PER BOT DASHBOARD - Modern Dark Theme Design
// PolyBot v3 - Real-time Dashboard Components
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart
} from 'recharts'
import './PerBotDashboard.css'
import { usd, signUsd, idr, pct, f2 } from '../utils.js'

// ═══════════════════════════════════════════════════════════════════
// UTILITY HOOKS
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'polybot_perbot_pnl_history'

function loadPerBotHistory(botName) {
  try {
    const key = `${STORAGE_KEY}_${botName}`
    return JSON.parse(localStorage.getItem(key)) || []
  } catch { return [] }
}

function savePerBotHistory(botName, history) {
  const key = `${STORAGE_KEY}_${botName}`
  localStorage.setItem(key, JSON.stringify(history))
}

// ═══════════════════════════════════════════════════════════════════
// COLOR UTILITIES
// ═══════════════════════════════════════════════════════════════════

const getSignalColor = (signal) => {
  if (signal === 'UP' || signal === 'YES') return 'var(--green)'
  if (signal === 'DOWN' || signal === 'NO') return 'var(--red)'
  return 'var(--text3)'
}

const getConfidenceColor = (conf) => {
  if (conf >= 0.75) return 'var(--green)'
  if (conf >= 0.60) return 'var(--amber)'
  return 'var(--red)'
}

const getPnLColor = (pnl) => pnl >= 0 ? 'var(--green)' : 'var(--red)'

const getWinRateColor = (rate) => {
  if (rate >= 65) return 'var(--green)'
  if (rate >= 50) return 'var(--amber)'
  return 'var(--red)'
}

// ═══════════════════════════════════════════════════════════════════
// PNL CURVE - Real-time Area Chart with Gradient
// ═══════════════════════════════════════════════════════════════════

function PnLCurve({ history, pnl, roiPct, isLoading }) {
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return []
    return history.map((h, i) => ({
      time: i,
      value: Number(h.v?.toFixed(2) || 0),
      label: new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }))
  }, [history])

  const isPositive = pnl >= 0
  const gradientId = `pnlGradient_${Math.random().toString(36).substr(2, 9)}`
  
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: 'var(--bg3)',
          border: '1px solid var(--border2)',
          borderRadius: 'var(--r2)',
          padding: '8px 10px',
          boxShadow: 'var(--shadow-md)'
        }}>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            {payload[0].payload.label}
          </div>
          <div style={{ 
            fontSize: 'var(--fs)', 
            color: getPnLColor(payload[0].value),
            fontFamily: 'var(--mono)',
            fontWeight: 700
          }}>
            {payload[0].value >= 0 ? '+' : ''}${payload[0].value.toFixed(2)}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📈 P&L Curve</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)',
            color: getPnLColor(pnl),
            fontWeight: 700,
            textShadow: isPositive ? 'var(--shadow-glow-green)' : 'var(--shadow-glow-red)'
          }}>
            {pnl >= 0 ? '+' : ''}{usd(pnl)}
          </span>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)',
            color: 'var(--text3)',
            background: 'var(--bg4)',
            padding: '2px 6px',
            borderRadius: 'var(--r)'
          }}>
            {roiPct ? `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>
      <div style={{ padding: '8px', height: '160px' }}>
        {isLoading ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text3)'
          }}>
            Loading...
          </div>
        ) : chartData.length < 2 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text3)',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)'
          }}>
            Waiting for data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPositive ? '#00ff9d' : '#ff3366'} stopOpacity={0.4}/>
                  <stop offset="95%" stopColor={isPositive ? '#00ff9d' : '#ff3366'} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis 
                dataKey="time" 
                hide 
                axisLine={false} 
                tickLine={false}
              />
              <YAxis 
                hide 
                axisLine={false} 
                tickLine={false}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={isPositive ? '#00ff9d' : '#ff3366'}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ 
                  r: 4, 
                  fill: isPositive ? '#00ff9d' : '#ff3366',
                  stroke: 'var(--bg)',
                  strokeWidth: 2
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// OPEN POSITIONS - With Countdown Timer
// ═══════════════════════════════════════════════════════════════════

function OpenPositionsWithCountdown({ positions }) {
  const [now, setNow] = useState(Date.now())
  
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const getCountdown = (endTime) => {
    if (!endTime) return '--:--'
    const left = Math.max(0, Math.floor((endTime * 1000 - now) / 1000))
    const hours = Math.floor(left / 3600)
    const mins = Math.floor((left % 3600) / 60)
    const secs = left % 60
    if (hours > 0) return `${hours}h${mins}m`
    if (mins > 0) return `${mins}m${secs}s`
    return `${secs}s`
  }

  const isUrgent = (endTime) => {
    if (!endTime) return false
    const left = (endTime * 1000 - now) / 1000
    return left < 300 // Less than 5 min
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📋 Open Positions</span>
        <span className="badge badge-blue">{positions?.length || 0}</span>
      </div>
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {!positions || positions.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: 'var(--text3)',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)'
          }}>
            No open positions
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="xls-th">ID</th>
                <th className="xls-th">Market</th>
                <th className="xls-th">Side</th>
                <th className="xls-th">Price</th>
                <th className="xls-th">Size</th>
                <th className="xls-th">Countdown</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, i) => {
                const urgent = isUrgent(pos.endTime)
                return (
                  <tr key={pos.id || i} className="xls-tr">
                    <td className="xls-td" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>
                      {pos.id}
                    </td>
                    <td className="xls-td" style={{ fontSize: 'var(--fsxs)', maxWidth: '100px' }}>
                      {pos.question?.slice(0, 15) || '—'}
                    </td>
                    <td className="xls-td">
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 'var(--fsxs)',
                        color: pos.outcome === 'YES' ? 'var(--green)' : 'var(--amber)',
                        fontWeight: 600
                      }}>
                        {pos.outcome || '—'}
                      </span>
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      textAlign: 'right',
                      color: pos.outcome === 'YES' ? 'var(--green)' : 'var(--text2)'
                    }}>
                      {pos.price != null ? f2(pos.price) : '—'}
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      textAlign: 'right',
                      color: 'var(--text)'
                    }}>
                      ${pos.size?.toFixed(0) || '0'}
                    </td>
                    <td className="xls-td" style={{ textAlign: 'right' }}>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 'var(--fsxs)',
                        color: urgent ? 'var(--red)' : 'var(--amber)',
                        fontWeight: urgent ? 700 : 500,
                        animation: urgent ? 'countPulse 0.5s ease-in-out infinite' : 'none'
                      }}>
                        {getCountdown(pos.endTime)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL SCANNER - Signal Strength
// ═══════════════════════════════════════════════════════════════════

function GlobalScanner({ markets }) {
  const rows = markets?.slice(0, 12) || []

  const getSignalStrength = (ev) => {
    if (ev >= 0.15) return { label: 'STRONG', color: 'var(--green)' }
    if (ev >= 0.08) return { label: 'MED', color: 'var(--amber)' }
    if (ev >= 0.03) return { label: 'WEAK', color: 'var(--text3)' }
    return { label: '—', color: 'var(--text3)' }
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">🔍 Global Scanner</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>
          {rows.length} markets
        </span>
      </div>
      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className="xls-th" style={{ width: '40px' }}>Res</th>
              <th className="xls-th">Market</th>
              <th className="xls-th" style={{ width: '40px' }}>Yes</th>
              <th className="xls-th" style={{ width: '40px' }}>No</th>
              <th className="xls-th" style={{ width: '32px' }}>Sig</th>
              <th className="xls-th" style={{ width: '36px' }}>EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ 
                  padding: '16px', 
                  textAlign: 'center', 
                  color: 'var(--text3)',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)'
                }}>
                  Scanning markets...
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const hasSignal = r.signal && r.signal !== '—'
              const strength = getSignalStrength(r.ev)
              return (
                <tr key={r.id || i} className="xls-tr" style={{ background: hasSignal ? 'var(--green-glow)' : '' }}>
                  <td className="xls-td" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>
                    {r.resolve_fmt || '?'}
                  </td>
                  <td className="xls-td" style={{ fontSize: 'var(--fsxs)' }} title={r.question}>
                    {r.question?.slice(0, 18)}
                  </td>
                  <td className="xls-td" style={{ 
                    fontFamily: 'var(--mono)', 
                    textAlign: 'right',
                    color: r.yes_price >= 0.55 ? 'var(--green)' : 'var(--text2)'
                  }}>
                    {r.yes_price?.toFixed(2)}
                  </td>
                  <td className="xls-td" style={{ 
                    fontFamily: 'var(--mono)', 
                    textAlign: 'right',
                    color: 'var(--text2)'
                  }}>
                    {r.no_price?.toFixed(2)}
                  </td>
                  <td className="xls-td">
                    <span style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 'var(--fsxs)',
                      color: getSignalColor(r.signal)
                    }}>
                      {r.signal || '—'}
                    </span>
                  </td>
                  <td className="xls-td" style={{ textAlign: 'right' }}>
                    <span style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 'var(--fsxs)',
                      color: strength.color,
                      fontWeight: hasSignal ? 600 : 400
                    }}>
                      {hasSignal ? `${(r.ev * 100).toFixed(0)}%` : '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// BTC5M PANEL - Price, Direction, Confidence, Indicators
// ═══════════════════════════════════════════════════════════════════

function BTC5mPanel({ data }) {
  if (!data) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">⚡ BTC5M</span>
        </div>
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: 'var(--text3)',
          fontFamily: 'var(--mono)',
          fontSize: 'var(--fsxs)'
        }}>
          Waiting for data...
        </div>
      </div>
    )
  }

  const { price, predicted_dir, confidence, in_entry_zone, rsi, macd, ema_fast, ema_slow, volume } = data
  const dirColor = getSignalColor(predicted_dir)
  const confColor = getConfidenceColor(confidence)

  const indicators = [
    { name: 'RSI', value: rsi, color: rsi > 70 ? 'var(--red)' : rsi < 30 ? 'var(--green)' : 'var(--text2)' },
    { name: 'MACD', value: macd, color: macd > 0 ? 'var(--green)' : 'var(--red)' },
    { name: 'EMA9', value: ema_fast, color: 'var(--text2)' },
    { name: 'EMA21', value: ema_slow, color: 'var(--text2)' },
  ]

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">⚡ BTC5M</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {in_entry_zone && <span className="badge badge-amber">ENTRY</span>}
          {predicted_dir && (
            <span className="badge" style={{ 
              background: `${dirColor}20`, 
              borderColor: dirColor,
              color: dirColor 
            }}>
              {predicted_dir}
            </span>
          )}
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Price Display */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '8px',
          background: 'var(--bg3)',
          borderRadius: 'var(--r2)'
        }}>
          <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>BTC Price</span>
          <span style={{ 
            fontFamily: 'var(--mono)', 
            fontSize: '16px', 
            fontWeight: 700,
            color: 'var(--text)'
          }}>
            ${price?.toLocaleString() || '—'}
          </span>
        </div>

        {/* Direction & Confidence */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{
            padding: '8px',
            background: 'var(--bg3)',
            borderRadius: 'var(--r2)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', marginBottom: '4px' }}>Direction</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: '14px', 
              fontWeight: 700,
              color: dirColor,
              textShadow: predicted_dir ? `0 0 10px ${dirColor}` : 'none'
            }}>
              {predicted_dir || '—'}
            </div>
          </div>
          <div style={{
            padding: '8px',
            background: 'var(--bg3)',
            borderRadius: 'var(--r2)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', marginBottom: '4px' }}>Confidence</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: '14px', 
              fontWeight: 700,
              color: confColor
            }}>
              {confidence != null ? `${(confidence * 100).toFixed(0)}%` : '—'}
            </div>
          </div>
        </div>

        {/* Technical Indicators */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(2, 1fr)', 
          gap: '4px',
          padding: '6px',
          background: 'var(--bg4)',
          borderRadius: 'var(--r2)'
        }}>
          {indicators.map((ind, i) => (
            <div key={ind.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>{ind.name}</span>
              <span style={{ 
                fontFamily: 'var(--mono)', 
                fontSize: 'var(--fsxs)', 
                color: ind.color,
                fontWeight: 500
              }}>
                {ind.value?.toFixed(2) || '—'}
              </span>
            </div>
          ))}
        </div>

        {/* Volume */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          fontSize: 'var(--fsxs)'
        }}>
          <span style={{ color: 'var(--text3)' }}>Volume</span>
          <span style={{ 
            fontFamily: 'var(--mono)', 
            color: 'var(--text2)'
          }}>
            {volume ? `${(volume / 1000000).toFixed(1)}M` : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// COMPOUND PROGRESS BAR
// ═══════════════════════════════════════════════════════════

function CompoundProgressBar({ stats }) {
  if (!stats) return null

  const { compound_tier = 0, compound_bet = 1, compound_prog = 0, compound_next = 0 } = stats
  const progress = Math.min(100, Math.max(0, compound_prog))

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📊 Compound</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span className="badge badge-green">Tier {compound_tier}</span>
          <span style={{ 
            fontFamily: 'var(--mono)', 
            fontSize: 'var(--fsxs)', 
            color: 'var(--green)'
          }}>
            ${compound_bet}/bet
          </span>
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Progress Bar */}
        <div className="progress-bar" style={{ height: '8px' }}>
          <div 
            className="progress-fill" 
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Current Bet</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: 'var(--fs)', 
              fontWeight: 700,
              color: 'var(--text)'
            }}>
              ${compound_bet}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Next Tier</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: 'var(--fs)', 
              fontWeight: 700,
              color: 'var(--green)'
            }}>
              ${compound_next}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          fontSize: 'var(--fsxs)'
        }}>
          <span style={{ color: 'var(--text3)' }}>Progress</span>
          <span style={{ 
            fontFamily: 'var(--mono)', 
            color: progress >= 80 ? 'var(--green)' : 'var(--amber)',
            fontWeight: 600
          }}>
            {progress.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════��═��═══════
// SALARY TRACKER
// ═══════════════════════════════════════════════════════════════════

function SalaryTracker({ salary }) {
  if (!salary) return null

  const { total_withdrawn = 0, salary_count = 0, to_next = 0, next_target = 0, progress_pct = 0 } = salary

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">💰 Salary</span>
        <span className="badge badge-gold">{salary_count}x</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Total Withdrawn */}
        <div style={{
          padding: '10px',
          background: 'var(--gold-glow)',
          borderRadius: 'var(--r2)',
          border: '1px solid var(--gold-dim)'
        }}>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', marginBottom: '2px' }}>
            Total Withdrawn
          </div>
          <div style={{ 
            fontFamily: 'var(--mono)', 
            fontSize: '18px', 
            fontWeight: 700,
            color: 'var(--gold)'
          }}>
            {usd(total_withdrawn)}
          </div>
          <div style={{ 
            fontFamily: 'var(--mono)', 
            fontSize: 'var(--fsxs)', 
            color: 'var(--gold)',
            opacity: 0.8
          }}>
            {idr(total_withdrawn)}
          </div>
        </div>

        {/* Progress to Next Payout */}
        <div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: 'var(--fsxs)',
            marginBottom: '4px'
          }}>
            <span style={{ color: 'var(--text3)' }}>Next Payout</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
              @ ${next_target}
            </span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ 
                width: `${Math.min(100, progress_pct)}%`,
                background: 'linear-gradient(90deg, var(--gold-dim), var(--gold))'
              }}
            />
          </div>
        </div>

        {/* Amount to Next */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          fontSize: 'var(--fsxs)'
        }}>
          <span style={{ color: 'var(--text3)' }}>To Next</span>
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>
            {usd(to_next)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// GAS METER
// ═══════════════════════════════════════════════════════════════════

function GasMeter({ gas, onResume }) {
  if (!gas) return null

  const { status, pol_left = 0, tx_left = 0, pol_usable = 0, paused = false } = gas
  const statusColor = status === 'ok' ? 'var(--green)' : status === 'low' ? 'var(--amber)' : 'var(--red)'

  const getStatusLabel = () => {
    if (status === 'critical') return 'CRITICAL'
    if (status === 'low') return 'LOW'
    return 'OK'
  }

  // Calculate gas percentage for visualization
  const gasPercent = Math.min(100, (pol_usable / 50) * 100) // 50 POL = 100%

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">⛽ Gas</span>
        <span className="badge" style={{ 
          background: `${statusColor}20`, 
          borderColor: statusColor,
          color: statusColor 
        }}>
          {getStatusLabel()}
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Gas Visual Meter */}
        <div className="progress-bar" style={{ height: '10px', background: 'var(--bg4)' }}>
          <div 
            style={{
              height: '100%',
              width: `${gasPercent}%`,
              background: status === 'critical' 
                ? 'linear-gradient(90deg, var(--red-dim), var(--red))'
                : status === 'low'
                  ? 'linear-gradient(90deg, var(--amber-dim), var(--amber))'
                  : 'linear-gradient(90deg, var(--green-dim), var(--green))',
              borderRadius: '2px',
              transition: 'width 0.3s'
            }}
          />
        </div>

        {/* Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          <div>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>POL Balance</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: 'var(--fs)', 
              fontWeight: 600,
              color: statusColor
            }}>
              {pol_left?.toFixed(1) || '0.0'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>TX Left</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: 'var(--fs)', 
              fontWeight: 600,
              color: statusColor
            }}>
              {tx_left || 0}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Usable</div>
            <div style={{ 
              fontFamily: 'var(--mono)', 
              fontSize: 'var(--fs)', 
              fontWeight: 600,
              color: 'var(--text)'
            }}>
              {pol_usable?.toFixed(1) || '0.0'}
            </div>
          </div>
        </div>

        {/* Resume Button */}
        {paused && (
          <button
            onClick={onResume}
            style={{
              width: '100%',
              padding: '8px',
              background: 'var(--red-glow)',
              border: '1px solid var(--red)',
              borderRadius: 'var(--r2)',
              color: 'var(--red)',
              fontFamily: 'var(--mono)',
              fontSize: 'var(--fsxs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            ⚠️ Resume Bot
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRADE HISTORY TABLE
// ═══════════════════════════════════════════════════════════════════

function TradeHistoryTable({ history }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📜 Trade History</span>
        <span style={{ 
          fontFamily: 'var(--mono)', 
          fontSize: 'var(--fsxs)', 
          color: 'var(--text3)',
          background: 'var(--bg4)',
          padding: '2px 6px',
          borderRadius: 'var(--r)'
        }}>
          {history?.length || 0} trades
        </span>
      </div>
      <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
        {!history || history.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: 'var(--text3)',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)'
          }}>
            No closed trades yet
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="xls-th" style={{ width: '40px' }}>ID</th>
                <th className="xls-th">Market</th>
                <th className="xls-th" style={{ width: '50px' }}>Result</th>
                <th className="xls-th" style={{ width: '70px' }}>P&L</th>
                <th className="xls-th" style={{ width: '50px' }}>ROI</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((t, i) => {
                const won = t.status === 'won'
                return (
                  <tr key={t.id || i} className="xls-tr">
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      fontSize: 'var(--fsxs)', 
                      color: 'var(--text3)'
                    }}>
                      {t.id}
                    </td>
                    <td className="xls-td" style={{ fontSize: 'var(--fsxs)' }}>
                      {t.question?.slice(0, 16) || '—'}
                    </td>
                    <td className="xls-td">
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 'var(--fsxs)',
                        fontWeight: 600,
                        background: won ? 'var(--green-glow)' : 'var(--red-glow)',
                        color: won ? 'var(--green)' : 'var(--red)',
                        padding: '2px 6px',
                        borderRadius: 'var(--r)'
                      }}>
                        {won ? 'WIN' : 'LOSE'}
                      </span>
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      textAlign: 'right',
                      color: getPnLColor(t.pnl),
                      fontWeight: 600
                    }}>
                      {signUsd(t.pnl)}
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      textAlign: 'right',
                      color: t.roi_pct != null ? getPnLColor(t.roi_pct) : 'var(--text3)'
                    }}>
                      {t.roi_pct != null ? `${t.roi_pct.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════

function ActivityLog({ log }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📝 Activity Log</span>
      </div>
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {!log || log.length === 0 ? (
          <div style={{
            padding: '16px',
            textAlign: 'center',
            color: 'var(--text3)',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)'
          }}>
            Waiting for activity...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {log.slice(0, 15).map((e, i) => {
              const isOpen = e.event === 'OPEN'
              const isClose = e.event === 'CLOSE'
              const won = e.result === 'won'
              
              let icon, color, message
              if (isOpen) {
                icon = '▲'
                color = 'var(--blue)'
                message = `${e.id} ${e.question?.slice(0, 12)}`
              } else if (isClose) {
                icon = won ? '✓' : '✗'
                color = won ? 'var(--green)' : 'var(--red)'
                message = `${won ? 'WIN' : 'LOSE'} ${signUsd(e.pnl)}`
              } else if (e.event === 'SALARY') {
                icon = '💰'
                color = 'var(--gold)'
                message = `GAJIAN ${usd(e.withdrawn)}`
              } else if (e.event === 'COMPOUND_UP') {
                icon = '⬆'
                color = 'var(--green)'
                message = `Tier ${e.tier} → $${e.new_bet}`
              } else {
                icon = '·'
                color = 'var(--text3)'
                message = e.event
              }

              return (
                <div 
                  key={i} 
                  className="xls-tr"
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '20px 50px 1fr auto', 
                    gap: '6px',
                    padding: '6px 10px',
                    alignItems: 'center',
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  <span style={{ color, fontSize: 'var(--fsxs)' }}>{icon}</span>
                  <span style={{ 
                    fontFamily: 'var(--mono)', 
                    fontSize: 'var(--fsxs)', 
                    color: 'var(--text3)'
                  }}>
                    {e.time}
                  </span>
                  <span style={{ 
                    fontFamily: 'var(--mono)', 
                    fontSize: 'var(--fsxs)', 
                    color: 'var(--text2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {message}
                  </span>
                  {(isClose || e.event === 'SALARY') && (
                    <span style={{ 
                      fontFamily: 'var(--mono)', 
                      fontSize: 'var(--fsxs)', 
                      color: color,
                      fontWeight: 600
                    }}>
                      {isClose ? signUsd(e.pnl) : ''}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PER BOT DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function PerBotDashboard({ 
  botName,
  stats, 
  positions, 
  markets, 
  config, 
  gas, 
  salary, 
  history, 
  log, 
  btc5m,
  connected,
  onResumeGas 
}) {
  const [pnlHistory, setPnlHistory] = useState([])
  
  // Initialize PnL history from storage
  useEffect(() => {
    setPnlHistory(loadPerBotHistory(botName))
  }, [botName])
  
  // Update PnL history when capital changes
  useEffect(() => {
    if (stats?.capital == null) return
    const initial = stats.initial || 10
    const newPnL = stats.capital - initial
    const updatedHistory = [...pnlHistory, { t: Date.now(), v: newPnL }].slice(-120)
    setPnlHistory(updatedHistory)
    savePerBotHistory(botName, updatedHistory)
  }, [stats?.capital])
  
  // Calculate real-time PnL
  const pnl = stats?.pnl ?? 0
  const roiPct = stats?.roi_pct ?? 0
  const winRate = stats?.win_rate ?? 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '12px'
    }}>
      {/* Top Stats Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '10px'
      }}>
        <div className="stat-card">
          <div className="stat-label">Equity</div>
          <div className="stat-value" style={{ color: 'var(--text)' }}>
            {usd(stats?.capital)}
          </div>
          <div className="stat-sub">
            {usd(stats?.available)} available
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">P&L</div>
          <div className="stat-value" style={{ color: getPnLColor(pnl) }}>
            {signUsd(pnl)}
          </div>
          <div className="stat-sub">
            {roiPct >= 0 ? '+' : ''}{roiPct.toFixed(1)}% ROI
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className="stat-value" style={{ color: getWinRateColor(winRate) }}>
            {pct(winRate)}
          </div>
          <div className="stat-sub">
            {stats?.wins ?? 0}W {stats?.losses ?? 0}L
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Daily P&L</div>
          <div className="stat-value" style={{ 
            color: getPnLColor(stats?.daily_pnl ?? 0) 
          }}>
            {signUsd(stats?.daily_pnl ?? 0)}
          </div>
          <div className="stat-sub">
            {stats?.daily_trades ?? 0} trades today
          </div>
        </div>
      </div>

      {/* PnL Curve */}
      <PnLCurve 
        history={pnlHistory} 
        pnl={pnl} 
        roiPct={roiPct}
        isLoading={!stats}
      />

      {/* Main Content Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '12px'
      }}>
        {/* Left Column */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <GlobalScanner markets={markets} />
          <OpenPositionsWithCountdown positions={positions} />
          <TradeHistoryTable history={history} />
        </div>

        {/* Right Column */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <BTC5mPanel data={btc5m} />
          <CompoundProgressBar stats={stats} />
          <SalaryTracker salary={salary} />
          <GasMeter gas={gas} onResume={onResumeGas} />
          <ActivityLog log={log} />
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ═══════════════════════════════════════════════════════════════════

export default PerBotDashboard