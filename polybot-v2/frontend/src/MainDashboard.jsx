/**
 * MAIN DASHBOARD — POLYBOT v3
 * Features:
 * - Grid semua bot (status card ringkas)
 * - Cross-bot PnL comparison chart
 * - Best performing bot highlight
 * - DB summary table (W/L/PnL per bot)
 * - Scanner probabilitas global (semua market, semua signal, sorted by EV)
 * - Gas alert center
 * - Quick bot controls (pause/resume/reset individual)
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useUnifiedBots } from './hooks/useUnifiedBots.js'
import { usd, signUsd, pct, f2, fmtDur, CAT_COLOR, STRAT_COLOR } from './utils.js'

// ═══════════════════════════════════════════════════════════════
// UTILITY COMPONENTS
// ═══════════════════════════════════════════════════════════════

function XTag({ t, c }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 5px', borderRadius: '3px',
      fontSize: '8px', fontFamily: 'var(--mono)',
      textTransform: 'uppercase', letterSpacing: '.04em',
      fontWeight: 600, background: c + '20', color: c
    }}>
      {t}
    </span>
  )
}

function Dot({ on, color }) {
  return (
    <span style={{
      display: 'inline-block', width: 5, height: 5,
      borderRadius: '50%', marginRight: 4,
      background: on ? color : 'var(--text4)',
      boxShadow: on ? `0 0 6px ${color}` : 'none',
      animation: on ? 'pulse 2s infinite' : 'none'
    }} />
  )
}

// ═══════════════════════════════════════════════════════════════
// PnL CHART — Cross-bot comparison (simple bar chart)
// ═══════════════════════════════════════════════════════════════

function PnlChart({ bots }) {
  if (!bots || bots.length === 0) return null
  
  const maxPnL = Math.max(...bots.map(b => Math.abs(b.pnlUsdc || b.pnl || 0)), 10)
  const maxEquity = Math.max(...bots.map(b => b.equityUsdc || b.capital || 0), 10)
  
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">PnL Comparison</span>
        <span style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {bots.length} bots
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {bots.map((bot, i) => {
          const pnl = bot.pnlUsdc || bot.pnl || 0
          const equity = bot.equityUsdc || bot.capital || 0
          const isProfit = pnl >= 0
          const barWidth = (Math.abs(pnl) / maxPnL) * 100
          const equityWidth = (equity / maxEquity) * 60
          
          return (
            <div key={bot.name || i} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ 
                  fontSize: '9px', 
                  color: bot.color || 'var(--text2)', 
                  fontFamily: 'var(--mono)',
                  fontWeight: 600
                }}>
                  {bot.display_name}
                </span>
                <span style={{ 
                  fontSize: '10px', 
                  fontFamily: 'var(--mono)', 
                  color: isProfit ? 'var(--neon-green)' : 'var(--neon-red)'
                }}>
                  {signUsd(pnl)}
                </span>
              </div>
              <div style={{ 
                height: 6, background: 'var(--bg4)', 
                borderRadius: 3, position: 'relative', overflow: 'hidden'
              }}>
                {/* Equity bar (background) */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: `${equityWidth}%`, background: 'var(--bg5)',
                  borderRadius: 3
                }} />
                {/* PnL bar (foreground) */}
                <div style={{
                  position: 'absolute', top: 0, height: '100%',
                  width: `${barWidth}%`,
                  background: isProfit ? 'var(--neon-green)' : 'var(--neon-red)',
                  borderRadius: 3,
                  boxShadow: isProfit ? '0 0 8px var(--neon-green)' : '0 0 8px var(--neon-red)',
                  opacity: 0.8
                }} />
              </div>
            </div>
          )
        })}
        
        {/* Legend */}
        <div style={{ 
          display: 'flex', gap: '12px', fontSize: '8px', 
          color: 'var(--text3)', fontFamily: 'var(--mono)',
          marginTop: '4px'
        }}>
          <span><span style={{ 
            display: 'inline-block', width: 8, height: 6, 
            background: 'var(--bg5)', borderRadius: 2, marginRight: 4 
          }} />Equity</span>
          <span><span style={{ 
            display: 'inline-block', width: 8, height: 6, 
            background: 'var(--neon-green)', borderRadius: 2, marginRight: 4,
            boxShadow: '0 0 4px var(--neon-green)'
          }} />PnL</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// BOT STATUS CARD — Compact grid card for each bot
// ═══════════════════════════════════════════════════════════════

function BotStatusCard({ bot, onControl }) {
  if (!bot) return null
  
  const equity = bot.equityUsdc || bot.capital || 0
  const pnl = bot.pnlUsdc || bot.pnl || 0
  const winRate = (bot.total_trades || 0) > 0 
    ? ((bot.wins || 0) / (bot.total_trades || 1) * 100) 
    : 0
  const isProfit = pnl >= 0
  const isBest = bot.isBest
  
  return (
    <div style={{
      background: 'var(--bg2)',
      border: `1px solid ${isBest ? 'var(--neon-green)' : 'var(--border)'}`,
      borderRadius: 'var(--r3)',
      overflow: 'hidden',
      boxShadow: isBest ? '0 0 12px var(--neon-green-glow)' : 'none',
      transition: 'all 0.2s ease'
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--border)',
        background: isBest ? 'var(--neon-green-glow)' : 'var(--bg3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Dot on={bot.connected} color={bot.color || 'var(--neon-green)'} />
          <span style={{
            fontSize: '9px',
            color: bot.color || 'var(--neon-green)',
            fontFamily: 'var(--mono)',
            textTransform: 'uppercase',
            fontWeight: 700,
            letterSpacing: '.05em'
          }}>
            {bot.display_name}
          </span>
          {isBest && (
            <XTag t="BEST" c="var(--neon-green)" />
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <XTag t={bot.mode || 'sim'} c={bot.mode === 'real' ? 'var(--neon-cyan)' : 'var(--neon-amber)'} />
        </div>
      </div>
      
      {/* Stats Grid */}
      <div style={{ 
        padding: '8px 10px', 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: '6px' 
      }}>
        {/* Equity */}
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            EQUITY
          </div>
          <div style={{ 
            fontSize: '14px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: 'var(--text)' 
          }}>
            {usd(equity)}
          </div>
        </div>
        
        {/* P&L */}
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            P&L
          </div>
          <div style={{ 
            fontSize: '14px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: isProfit ? 'var(--neon-green)' : 'var(--neon-red)' 
          }}>
            {signUsd(pnl)}
          </div>
          <div style={{ fontSize: '8px', fontFamily: 'var(--mono)', color: isProfit ? 'var(--neon-green)' : 'var(--neon-red)' }}>
            {pnl >= 0 ? '+' : ''}{((pnl / (bot.initial_capital || 1)) * 100).toFixed(1)}%
          </div>
        </div>
        
        {/* Win Rate */}
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            WINS
          </div>
          <div style={{ 
            fontSize: '14px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: winRate >= 60 ? 'var(--neon-green)' : winRate >= 45 ? 'var(--neon-amber)' : 'var(--neon-red)' 
          }}>
            {pct(winRate)}
          </div>
          <div style={{ fontSize: '8px', fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
            {bot.wins || 0}W {bot.losses || 0}L
          </div>
        </div>
      </div>
      
      {/* Quick Stats Row */}
      <div style={{
        padding: '4px 10px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg4)',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '8px',
        fontFamily: 'var(--mono)',
        color: 'var(--text3)'
      }}>
        <span>Open: {bot.open_count || 0}</span>
        <span>Trades: {bot.total_trades || 0}</span>
      </div>
      
      {/* Quick Controls */}
      <div style={{
        padding: '4px 6px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        gap: '3px'
      }}>
        <button
          onClick={() => onControl?.(bot.name, 'start')}
          disabled={bot.running}
          style={{
            flex: 1,
            padding: '3px 4px',
            background: bot.running ? 'var(--gbg)' : 'var(--bg3)',
            border: '1px solid',
            borderColor: bot.running ? 'var(--border)' : 'var(--neon-green)',
            borderRadius: 'var(--r)',
            color: bot.running ? 'var(--text4)' : 'var(--neon-green)',
            fontSize: '8px',
            fontFamily: 'var(--mono)',
            cursor: bot.running ? 'not-allowed' : 'pointer',
            opacity: bot.running ? 0.4 : 1
          }}
        >
          ▶
        </button>
        <button
          onClick={() => onControl?.(bot.name, 'stop')}
          disabled={!bot.running}
          style={{
            flex: 1,
            padding: '3px 4px',
            background: !bot.running ? 'var(--rbg)' : 'var(--bg3)',
            border: '1px solid',
            borderColor: !bot.running ? 'var(--border)' : 'var(--neon-red)',
            borderRadius: 'var(--r)',
            color: !bot.running ? 'var(--text4)' : 'var(--neon-red)',
            fontSize: '8px',
            fontFamily: 'var(--mono)',
            cursor: !bot.running ? 'not-allowed' : 'pointer',
            opacity: !bot.running ? 0.4 : 1
          }}
        >
          ■
        </button>
        <button
          onClick={() => onControl?.(bot.name, 'restart')}
          style={{
            flex: 1,
            padding: '3px 4px',
            background: 'var(--bg3)',
            border: '1px solid var(--neon-amber)',
            borderRadius: 'var(--r)',
            color: 'var(--neon-amber)',
            fontSize: '8px',
            fontFamily: 'var(--mono)',
            cursor: 'pointer'
          }}
        >
          ↻
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DB SUMMARY TABLE — W/L/PnL per bot
// ═══════════════════════════════════════════════════════════════

function DbSummaryTable({ bots }) {
  if (!bots || bots.length === 0) return null
  
  const totalWins = bots.reduce((sum, b) => sum + (b.wins || 0), 0)
  const totalLosses = bots.reduce((sum, b) => sum + (b.losses || 0), 0)
  const totalTrades = totalWins + totalLosses
  const totalPnL = bots.reduce((sum, b) => sum + (b.pnlUsdc || b.pnl || 0), 0)
  const totalEquity = bots.reduce((sum, b) => sum + (b.equityUsdc || b.capital || 0), 0)
  
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Database Summary</span>
        <span style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {totalTrades} total trades
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
          <thead>
            <tr>
              <th className="xls-th" style={{ textAlign: 'left' }}>Bot</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>Wins</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>Losses</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>Win%</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>P&L</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>Equity</th>
            </tr>
          </thead>
          <tbody>
            {bots.map((bot, i) => {
              const wins = bot.wins || 0
              const losses = bot.losses || 0
              const trades = wins + losses
              const winRate = trades > 0 ? (wins / trades * 100) : 0
              const pnl = bot.pnlUsdc || bot.pnl || 0
              const equity = bot.equityUsdc || bot.capital || 0
              const isBest = bot.isBest
              
              return (
                <tr key={bot.name || i} className="xls-tr" style={{ background: isBest ? 'var(--neon-green-glow)' : '' }}>
                  <td className="xls-td" style={{ 
                    fontFamily: 'var(--mono)', 
                    color: bot.color || 'var(--text2)',
                    fontWeight: 600
                  }}>
                    {bot.display_name}
                  </td>
                  <td className="xls-td" style={{ 
                    textAlign: 'right', 
                    fontFamily: 'var(--mono)', 
                    color: 'var(--neon-green)' 
                  }}>
                    {wins}
                  </td>
                  <td className="xls-td" style={{ 
                    textAlign: 'right', 
                    fontFamily: 'var(--mono)', 
                    color: 'var(--neon-red)' 
                  }}>
                    {losses}
                  </td>
                  <td className="xls-td" style={{ 
                    textAlign: 'right', 
                    fontFamily: 'var(--mono)', 
                    color: winRate >= 60 ? 'var(--neon-green)' : winRate >= 45 ? 'var(--neon-amber)' : 'var(--neon-red)' 
                  }}>
                    {pct(winRate)}
                  </td>
                  <td className="xls-td" style={{ 
                    textAlign: 'right', 
                    fontFamily: 'var(--mono)', 
                    color: pnl >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' 
                  }}>
                    {signUsd(pnl)}
                  </td>
                  <td className="xls-td" style={{ 
                    textAlign: 'right', 
                    fontFamily: 'var(--mono)', 
                    color: 'var(--text)' 
                  }}>
                    {usd(equity)}
                  </td>
                </tr>
              )
            })}
            {/* Totals row */}
            <tr style={{ 
              background: 'var(--bg4)', 
              borderTop: '1px solid var(--border2)'
            }}>
              <td className="xls-td" style={{ 
                fontFamily: 'var(--mono)', 
                color: 'var(--text)',
                fontWeight: 700
              }}>
                TOTAL
              </td>
              <td className="xls-td" style={{ 
                textAlign: 'right', 
                fontFamily: 'var(--mono)', 
                color: 'var(--neon-green)',
                fontWeight: 700
              }}>
                {totalWins}
              </td>
              <td className="xls-td" style={{ 
                textAlign: 'right', 
                fontFamily: 'var(--mono)', 
                color: 'var(--neon-red)',
                fontWeight: 700
              }}>
                {totalLosses}
              </td>
              <td className="xls-td" style={{ 
                textAlign: 'right', 
                fontFamily: 'var(--mono)', 
                color: totalTrades > 0 ? (totalWins / totalTrades * 100 >= 60 ? 'var(--neon-green)' : 'var(--neon-amber)') : 'var(--text3)',
                fontWeight: 700
              }}>
                {totalTrades > 0 ? pct(totalWins / totalTrades * 100) : '—'}
              </td>
              <td className="xls-td" style={{ 
                textAlign: 'right', 
                fontFamily: 'var(--mono)', 
                color: totalPnL >= 0 ? 'var(--neon-green)' : 'var(--neon-red)',
                fontWeight: 700
              }}>
                {signUsd(totalPnL)}
              </td>
              <td className="xls-td" style={{ 
                textAlign: 'right', 
                fontFamily: 'var(--mono)', 
                color: 'var(--text)',
                fontWeight: 700
              }}>
                {usd(totalEquity)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL SCANNER — All markets, all signals, sorted by EV
// ═══════════════════════════════════════════════════════════════

function GlobalScanner({ markets }) {
  const rows = markets || []
  
  // Sort by EV descending, show signals first
  const sortedRows = useMemo(() => {
    return [...rows]
      .filter(r => r.signal && r.signal !== '—')
      .sort((a, b) => (b.ev || 0) - (a.ev || 0))
      .slice(0, 20)
  }, [rows])
  
  const totalSignals = rows.filter(r => r.signal && r.signal !== '—').length
  
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title" style={{ color: 'var(--neon-cyan)' }}>
          ⚡ Global Scanner
        </span>
        <span style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {totalSignals} signals · {sortedRows.length} shown
        </span>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {sortedRows.length === 0 ? (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center', 
            color: 'var(--text3)', 
            fontSize: '9px',
            fontFamily: 'var(--mono)'
          }}>
            Scanning markets...
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
            <thead>
              <tr>
                <th className="xls-th">T</th>
                <th className="xls-th">Market</th>
                <th className="xls-th">Price</th>
                <th className="xls-th">Signal</th>
                <th className="xls-th" style={{ textAlign: 'right' }}>EV</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => {
                const ev = row.ev || 0
                const evPct = (ev * 100).toFixed(0)
                const catColor = CAT_COLOR[row.category] || 'var(--text3)'
                
                return (
                  <tr key={row.id || i} className="xls-tr" style={{ 
                    background: ev > 0.1 ? 'var(--neon-green-glow)' : ev > 0.05 ? 'var(--abg)' : '' 
                  }}>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      color: 'var(--text3)',
                      fontSize: '8px'
                    }}>
                      {row.resolve_fmt || '?'}
                    </td>
                    <td className="xls-td" style={{ 
                      color: 'var(--text)',
                      maxWidth: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }} title={row.question}>
                      {row.question}
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      color: (row.yes_price || 0) >= 0.55 ? 'var(--neon-green)' : 'var(--text2)',
                      textAlign: 'right'
                    }}>
                      {f2(row.yes_price)}
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      color: STRAT_COLOR[row.signal] || 'var(--text3)',
                      fontSize: '8px'
                    }}>
                      {row.signal}
                    </td>
                    <td className="xls-td" style={{ 
                      fontFamily: 'var(--mono)', 
                      color: ev > 0.1 ? 'var(--neon-green)' : ev > 0.05 ? 'var(--neon-amber)' : 'var(--text3)',
                      textAlign: 'right',
                      fontWeight: 600
                    }}>
                      {evPct}%
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

// ═══════════════════════════════════════════════════════════════
// GAS ALERT CENTER — All bots gas status
// ══════════════════════════════════════════════════════��═��══════

function GasAlertCenter({ bots }) {
  const gasData = bots?.map(b => b.gas).filter(Boolean) || []
  
  const totalPol = gasData.reduce((sum, g) => sum + (g.pol_left || 0), 0)
  const totalTx = gasData.reduce((sum, g) => sum + (g.tx_left || 0), 0)
  const criticalCount = gasData.filter(g => g.status === 'critical').length
  const lowCount = gasData.filter(g => g.status === 'low').length
  
  const alertColor = criticalCount > 0 
    ? 'var(--neon-red)' 
    : lowCount > 0 
      ? 'var(--neon-amber)' 
      : 'var(--neon-green)'
  
  return (
    <div className="card" style={{ 
      borderColor: criticalCount > 0 ? 'var(--neon-red)' : lowCount > 0 ? 'var(--neon-amber)' : 'var(--border)' 
    }}>
      <div className="card-header">
        <span className="card-title" style={{ color: alertColor }}>
          ⛽ Gas Alert Center
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {criticalCount > 0 && <XTag t="CRIT" c="var(--neon-red)" />}
          {lowCount > 0 && <XTag t="LOW" c="var(--neon-amber)" />}
          {criticalCount === 0 && lowCount === 0 && <XTag t="OK" c="var(--neon-green)" />}
        </div>
      </div>
      <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        {/* Summary */}
        <div style={{ 
          gridColumn: '1 / -1', 
          display: 'grid', 
          gridTemplateColumns: 'repeat(3, 1fr)', 
          gap: '8px',
          padding: '6px',
          background: 'var(--bg4)',
          borderRadius: 'var(--r2)'
        }}>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Total POL</div>
            <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
              {totalPol.toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Total TX</div>
            <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: alertColor }}>
              {totalTx}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Bots</div>
            <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
              {gasData.length}
            </div>
          </div>
        </div>
        
        {/* Individual bot gas */}
        {gasData.map((gas, i) => {
          const statusColor = gas.status === 'critical' 
            ? 'var(--neon-red)' 
            : gas.status === 'low' 
              ? 'var(--neon-amber)' 
              : 'var(--neon-green)'
          
          return (
            <div key={i} style={{
              padding: '6px',
              background: 'var(--bg3)',
              borderRadius: 'var(--r2)',
              borderLeft: `2px solid ${statusColor}`
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '4px' 
              }}>
                <span style={{ 
                  fontSize: '8px', 
                  fontFamily: 'var(--mono)', 
                  color: bots[i]?.color || 'var(--text2)'
                }}>
                  {bots[i]?.display_name || `Bot ${i + 1}`}
                </span>
                <XTag t={gas.status?.toUpperCase() || '?'} c={statusColor} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', fontSize: '8px', fontFamily: 'var(--mono)' }}>
                <div><span style={{ color: 'var(--text3)' }}>POL:</span> <span style={{ color: statusColor }}>{gas.pol_left?.toFixed(1)}</span></div>
                <div><span style={{ color: 'var(--text3)' }}>TX:</span> <span style={{ color: statusColor }}>{gas.tx_left}</span></div>
                <div><span style={{ color: 'var(--text3)' }}>Used:</span> <span style={{ color: 'var(--text2)' }}>{gas.pct_used}%</span></div>
                <div><span style={{ color: 'var(--text3)' }}>Paused:</span> <span style={{ color: gas.paused ? 'var(--neon-red)' : 'var(--neon-green)' }}>
                  {gas.paused ? 'YES' : 'NO'}
                </span></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// COMBINED PORTFOLIO HEADER
// ═══════════════════════════════════════════════════════════════

function CombinedPortfolio({ bots }) {
  if (!bots || bots.length === 0) return null
  
  const totalEquity = bots.reduce((sum, b) => sum + (b.equityUsdc || b.capital || 0), 0)
  const totalPnL = bots.reduce((sum, b) => sum + (b.pnlUsdc || b.pnl || 0), 0)
  const totalWins = bots.reduce((sum, b) => sum + (b.wins || 0), 0)
  const totalLosses = bots.reduce((sum, b) => sum + (b.losses || 0), 0)
  const totalTrades = totalWins + totalLosses
  const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 0
  const totalOpen = bots.reduce((sum, b) => sum + (b.open_count || 0), 0)
  const totalGajian = bots.reduce((sum, b) => sum + (b.salary?.total_withdrawn || 0), 0)
  
  // Find best bot
  const bestBot = bots.reduce((best, b) => {
    if (!best) return b
    const bPnl = b.pnlUsdc || b.pnl || 0
    const bestPnl = best.pnlUsdc || best.pnl || 0
    return bPnl > bestPnl ? b : best
  }, null)
  
  // Mark best bot
  bots.forEach(b => {
    b.isBest = bestBot && b.name === bestBot.name
  })
  
  const isProfit = totalPnL >= 0
  
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid',
      borderColor: isProfit ? 'var(--neon-green)' : 'var(--neon-red)',
      borderRadius: 'var(--r3)',
      padding: '10px 14px',
      boxShadow: isProfit ? 'var(--shadow-glow-green)' : 'var(--shadow-glow-red)'
    }}>
      <div style={{
        fontSize: '9px',
        color: isProfit ? 'var(--neon-green)' : 'var(--neon-red)',
        fontFamily: 'var(--mono)',
        textTransform: 'uppercase',
        letterSpacing: '.1em',
        marginBottom: '8px'
      }}>
        Combined Portfolio
        {bestBot && (
          <span style={{ marginLeft: '8px', color: 'var(--text3)' }}>
            • Best: {bestBot.display_name}
          </span>
        )}
      </div>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(6, 1fr)', 
        gap: '12px' 
      }}>
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Total Equity
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: 'var(--neon-green)' 
          }}>
            {usd(totalEquity)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Total P&L
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: isProfit ? 'var(--neon-green)' : 'var(--neon-red)' 
          }}>
            {isProfit ? '+' : ''}{usd(totalPnL)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Win Rate
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: winRate >= 60 ? 'var(--neon-green)' : winRate >= 45 ? 'var(--neon-amber)' : 'var(--neon-red)' 
          }}>
            {pct(winRate)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Bots
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: 'var(--text)' 
          }}>
            {bots.length}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Open Pos
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: 'var(--neon-cyan)' 
          }}>
            {totalOpen}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Gajian
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 700, 
            fontFamily: 'var(--mono)', 
            color: 'var(--neon-gold)' 
          }}>
            {usd(totalGajian)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function MainDashboard() {
  const { bot1, bot2, combinedStats, combinedLog, controlBot } = useUnifiedBots()
  
  // Convert bots to array with display names
  const bots = useMemo(() => {
    const botList = []
    if (bot1?.connected || bot1?.stats) {
      botList.push({
        name: 'bot1',
        display_name: 'Bot 1',
        color: '#00ff9f',
        mode: bot1.stats?.mode || 'sim',
        connected: bot1.connected,
        running: bot1.stats?.running,
        ...bot1.stats,
        equityUsdc: bot1.stats?.capital || 0,
        pnlUsdc: bot1.stats?.pnl || 0,
        gas: bot1.gas,
        salary: bot1.salary
      })
    }
    if (bot2?.connected || bot2?.stats) {
      botList.push({
        name: 'bot2',
        display_name: 'Bot 2',
        color: '#00ddff',
        mode: bot2.stats?.mode || 'sim',
        connected: bot2.connected,
        running: bot2.stats?.running,
        ...bot2.stats,
        equityUsdc: bot2.stats?.capital || 0,
        pnlUsdc: bot2.stats?.pnl || 0,
        gas: bot2.gas,
        salary: bot2.salary
      })
    }
    
    // Find best performing bot
    const bestBot = botList.reduce((best, b) => {
      if (!best) return b
      const bPnl = b.pnlUsdc || b.pnl || 0
      const bestPnl = best.pnlUsdc || best.pnl || 0
      return bPnl > bestPnl ? b : best
    }, null)
    
    botList.forEach(b => {
      b.isBest = bestBot && b.name === bestBot.name
    })
    
    return botList
  }, [bot1, bot2])
  
  // Combined markets from both bots
  const combinedMarkets = useMemo(() => {
    const markets = []
    if (bot1?.markets) markets.push(...bot1.markets)
    if (bot2?.markets) markets.push(...bot2.markets)
    // Deduplicate and sort by EV
    const seen = new Set()
    return markets
      .filter(m => {
        if (seen.has(m.id)) return false
        seen.add(m.id)
        return true
      })
      .sort((a, b) => (b.ev || 0) - (a.ev || 0))
  }, [bot1?.markets, bot2?.markets])
  
  const [lastUpd, setLastUpd] = useState(new Date())
  
  useEffect(() => {
    const id = setInterval(() => setLastUpd(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  
  const bothConnected = bot1?.connected && bot2?.connected
  
  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'var(--bg)', 
      display: 'flex', 
      flexDirection: 'column' 
    }}>
      {/* Header */}
      <header style={{
        height: 28,
        background: 'linear-gradient(180deg, var(--bg1) 0%, var(--bg) 100%)',
        borderBottom: '1px solid var(--border)',
        borderBottom: '1px solid var(--border2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 8,
        flexShrink: 0
      }}>
        <span style={{ 
          fontFamily: 'var(--mono)', 
          fontSize: 12, 
          fontWeight: 700, 
          color: 'var(--neon-green)', 
          letterSpacing: '.15em' 
        }}>
          POLY<span style={{ color: 'var(--text)' }}>BOT</span>
          <span style={{ 
            fontSize: '8px', 
            color: 'var(--text3)', 
            marginLeft: 4,
            fontWeight: 400
          }}>
            v3
          </span>
        </span>
        
        {/* Connection status */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          padding: '2px 8px',
          background: 'var(--bg2)',
          borderRadius: 'var(--r)',
          border: '1px solid var(--border)'
        }}>
          <Dot on={bothConnected} color="#00ff9f" />
          <span style={{ 
            fontFamily: 'var(--mono)', 
            fontSize: '8px', 
            color: bothConnected ? 'var(--neon-green)' : 'var(--neon-red)',
            textTransform: 'uppercase',
            letterSpacing: '.05em'
          }}>
            {bothConnected ? 'ALL LIVE' : 'PARTIAL'}
          </span>
        </div>
        
        {/* Bot indicators */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <XTag t="B1" c={bot1?.connected ? 'var(--neon-green)' : 'var(--neon-red)'} />
          <XTag t="B2" c={bot2?.connected ? 'var(--neon-cyan)' : 'var(--neon-red)'} />
        </div>
        
        <div style={{ flex: 1 }} />
        
        {/* Quick controls */}
        <div style={{ display: 'flex', gap: '3px' }}>
          <button
            onClick={() => controlBot('all', 'start')}
            style={{
              padding: '3px 8px',
              background: 'var(--gbg)',
              border: '1px solid var(--neon-green)',
              borderRadius: 'var(--r)',
              color: 'var(--neon-green)',
              fontSize: '8px',
              fontFamily: 'var(--mono)',
              cursor: 'pointer'
            }}
          >
            START ALL
          </button>
          <button
            onClick={() => controlBot('all', 'stop')}
            style={{
              padding: '3px 8px',
              background: 'var(--rbg)',
              border: '1px solid var(--neon-red)',
              borderRadius: 'var(--r)',
              color: 'var(--neon-red)',
              fontSize: '8px',
              fontFamily: 'var(--mono)',
              cursor: 'pointer'
            }}
          >
            STOP ALL
          </button>
          <button
            onClick={() => controlBot('all', 'restart')}
            style={{
              padding: '3px 8px',
              background: 'var(--abg)',
              border: '1px solid var(--neon-amber)',
              borderRadius: 'var(--r)',
              color: 'var(--neon-amber)',
              fontSize: '8px',
              fontFamily: 'var(--mono)',
              cursor: 'pointer'
            }}
          >
            RESTART
          </button>
        </div>
        
        <span style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {lastUpd.toLocaleTimeString()}
        </span>
      </header>
      
      {/* Main Content */}
      <main style={{ 
        flex: 1, 
        padding: '8px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px',
        overflowY: 'auto'
      }}>
        {/* Combined Portfolio Header */}
        <CombinedPortfolio bots={bots} />
        
        {/* Bot Grid - compact status cards */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: bots.length >= 2 ? 'repeat(2, 1fr)' : '1fr',
          gap: '8px'
        }}>
          {bots.map(bot => (
            <BotStatusCard 
              key={bot.name} 
              bot={bot} 
              onControl={controlBot} 
            />
          ))}
        </div>
        
        {/* PnL Comparison Chart */}
        <PnlChart bots={bots} />
        
        {/* Bottom Grid */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '8px' 
        }}>
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* DB Summary Table */}
            <DbSummaryTable bots={bots} />
            
            {/* Gas Alert Center */}
            <GasAlertCenter bots={bots} />
          </div>
          
          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Global Scanner */}
            <GlobalScanner markets={combinedMarkets} />
            
            {/* Recent Activity */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Activity Feed</span>
                <span style={{ fontSize: '8px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                  {combinedLog?.length || 0} events
                </span>
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                {(!combinedLog || combinedLog.length === 0) ? (
                  <div style={{ 
                    padding: '20px', 
                    textAlign: 'center', 
                    color: 'var(--text3)', 
                    fontSize: '9px',
                    fontFamily: 'var(--mono)'
                  }}>
                    Waiting for activity...
                  </div>
                ) : (
                  combinedLog.slice(0, 20).map((e, i) => {
                    const isOpen = e.event === 'OPEN'
                    const isClose = e.event === 'CLOSE'
                    const won = e.result === 'won'
                    const color = isOpen 
                      ? 'var(--neon-cyan)' 
                      : isClose 
                        ? (won ? 'var(--neon-green)' : 'var(--neon-red)') 
                        : 'var(--text3)'
                    const icon = isOpen ? '▲' : isClose ? (won ? '✓' : '✗') : '·'
                    
                    return (
                      <div 
                        key={i} 
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '14px 40px 1fr auto',
                          gap: '4px',
                          padding: '3px 8px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: '8px',
                          fontFamily: 'var(--mono)'
                        }}
                      >
                        <span style={{ color }}>{icon}</span>
                        <span style={{ color: 'var(--text3)' }}>{e.time}</span>
                        <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isOpen && `${e.id} ${e.question?.slice(0, 12)}`}
                          {isClose && `${won ? 'WIN' : 'LOSE'} ${signUsd(e.pnl)}`}
                          {e.event === 'SALARY' && `💰 GAJIAN ${usd(e.withdrawn)}`}
                          {e.event === 'COMPOUND_UP' && `⬆ T${e.tier}`}
                          {!isOpen && !isClose && e.event !== 'SALARY' && e.event !== 'COMPOUND_UP' && e.event}
                        </span>
                        {isClose && (
                          <span style={{ color: won ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                            {signUsd(e.pnl)}
                          </span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}