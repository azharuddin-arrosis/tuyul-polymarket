/**
 * Unified Dashboard — Single UI for Bot 1 and Bot 2
 * Displays:
 * - Real-time status of both bots
 * - Position data for both bots
 * - P&L for both bots
 * - Signal feed for both bots
 * - Control panel for start/stop/restart
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useUnifiedBots } from './hooks/useUnifiedBots.js'
import { usd, signUsd, pct, XTag } from './utils.js'

// Bot status indicator
function BotStatus({ bot, name, color }) {
  const isRunning = bot.connected
  const isPaused = bot.stats?.running === false
  
  return (
    <div style={{
      background: 'var(--bg2)',
      border: `1px solid ${color}`,
      borderRadius: 'var(--r3)',
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '4px 10px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{
          fontSize: 'var(--fsxs)',
          color: color,
          fontFamily: 'var(--mono)',
          textTransform: 'uppercase',
          fontWeight: 600
        }}>
          {name}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {isRunning ? (
            <XTag t="LIVE" c="var(--green)" />
          ) : (
            <XTag t="OFF" c="var(--red)" />
          )}
          {isPaused && <XTag t="PAUSED" c="var(--amber)" />}
        </div>
      </div>
      <div style={{
        padding: '6px 10px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '4px',
        fontSize: 'var(--fsxs)'
      }}>
        <div>
          <div style={{ color: 'var(--text3)' }}>Equity</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>
            {usd(bot.stats?.capital || 0)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text3)' }}>P&L</div>
          <div style={{
            fontFamily: 'var(--mono)',
            color: (bot.stats?.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'
          }}>
            {signUsd(bot.stats?.pnl || 0)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text3)' }}>Win Rate</div>
          <div style={{
            fontFamily: 'var(--mono)',
            color: (bot.stats?.win_rate || 0) >= 60 ? 'var(--green)' : 'var(--text2)'
          }}>
            {pct(bot.stats?.win_rate || 0)}
          </div>
        </div>
      </div>
    </div>
  )
}

// Position card for single bot
function PositionCard({ position, color }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '50px 1fr 30px 40px 50px',
      gap: '4px',
      padding: '4px 8px',
      borderBottom: '1px solid var(--border)',
      fontSize: 'var(--fsxs)',
      fontFamily: 'var(--mono)',
      alignItems: 'center'
    }}>
      <span style={{ color: 'var(--text3)' }}>{position.id}</span>
      <span style={{
        color: 'var(--text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {position.question?.slice(0, 20)}
      </span>
      <span style={{
        color: position.outcome === 'YES' ? 'var(--green)' : 'var(--amber)'
      }}>
        {position.outcome}
      </span>
      <span style={{ color: 'var(--text2)', textAlign: 'right' }}>
        {position.price?.toFixed(2)}
      </span>
      <span style={{ color: 'var(--text)', textAlign: 'right' }}>
        ${position.size?.toFixed(0)}
      </span>
    </div>
  )
}

// Signal feed item
function SignalItem({ event, color }) {
  const isOpen = event.event === 'OPEN'
  const isClose = event.event === 'CLOSE'
  const won = event.result === 'won'
  
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '14px 40px 1fr auto',
      gap: '3px',
      padding: '2px 8px',
      borderBottom: '1px solid var(--border)',
      fontSize: 'var(--fsxs)',
      fontFamily: 'var(--mono)',
      alignItems: 'center'
    }}>
      <span style={{ color }}>
        {isOpen ? '▲' : isClose ? (won ? '✓' : '✗') : '·'}
      </span>
      <span style={{ color: 'var(--text3)' }}>{event.time}</span>
      <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isOpen && `${event.id} ${event.question?.slice(0, 12)}`}
        {isClose && `${won ? 'WIN' : 'LOSE'} ${signUsd(event.pnl)}`}
        {event.event === 'SALARY' && `💰 GAJIAN ${usd(event.withdrawn)}`}
        {event.event === 'COMPOUND_UP' && `⬆ T${event.tier} ${usd(event.new_bet)}`}
        {!isOpen && !isClose && event.event !== 'SALARY' && event.event !== 'COMPOUND_UP' && event.event}
      </span>
      {isClose && (
        <span style={{ color: won ? 'var(--green)' : 'var(--red)' }}>
          {signUsd(event.pnl)}
        </span>
      )}
      {event.event === 'SALARY' && <XTag t="SALARY" c="var(--gold)" />}
      {event.event === 'COMPOUND_UP' && <XTag t={`T${event.tier}`} c="var(--green)" />}
    </div>
  )
}

// Control panel for bot control
function ControlPanel({ bots, onControl }) {
  const [controlling, setControlling] = useState(null)
  const [confirmMode, setConfirmMode] = useState(null)

  const handleControl = async (botName, action) => {
    if (confirmMode) {
      setControlling(null)
      setConfirmMode(null)
      return
    }
    
    setControlling(botName)
    setConfirmMode(action)
    
    // Auto-confirm after 3 seconds
    setTimeout(() => {
      setControlling(null)
      setConfirmMode(null)
    }, 3000)
  }

  const execControl = async (botName, action) => {
    setControlling('loading')
    try {
      await onControl(botName, action)
    } finally {
      setControlling(null)
      setConfirmMode(null)
    }
  }

  const getButtonColor = (action) => {
    switch (action) {
      case 'start': return 'var(--green)'
      case 'stop': return 'var(--red)'
      case 'restart': return 'var(--amber)'
      default: return 'var(--text)'
    }
  }

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r3)',
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '4px 10px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg3)'
      }}>
        <span style={{
          fontSize: 'var(--fsxs)',
          color: 'var(--text)',
          fontFamily: 'var(--mono)',
          textTransform: 'uppercase',
          fontWeight: 600
        }}>
          ⚡ Bot Control
        </span>
      </div>
      <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* All Bots Row */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleControl('all', 'start')}
            disabled={controlling === 'loading'}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: confirmMode === 'start' && controlling === 'all' ? 'var(--green)' : 'var(--gbg)',
              border: '1px solid var(--green)',
              borderRadius: 'var(--r)',
              color: confirmMode === 'start' && controlling === 'all' ? 'var(--bg)' : 'var(--green)',
              fontFamily: 'var(--mono)',
              fontSize: 'var(--fsxs)',
              cursor: controlling === 'loading' ? 'not-allowed' : 'pointer',
              opacity: controlling === 'loading' ? 0.6 : 1
            }}
          >
            Start All
          </button>
          <button
            onClick={() => handleControl('all', 'stop')}
            disabled={controlling === 'loading'}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: confirmMode === 'stop' && controlling === 'all' ? 'var(--red)' : 'var(--bg2)',
              border: '1px solid var(--red)',
              borderRadius: 'var(--r)',
              color: confirmMode === 'stop' && controlling === 'all' ? 'var(--bg)' : 'var(--red)',
              fontFamily: 'var(--mono)',
              fontSize: 'var(--fsxs)',
              cursor: controlling === 'loading' ? 'not-allowed' : 'pointer',
              opacity: controlling === 'loading' ? 0.6 : 1
            }}
          >
            Stop All
          </button>
          <button
            onClick={() => handleControl('all', 'restart')}
            disabled={controlling === 'loading'}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: confirmMode === 'restart' && controlling === 'all' ? 'var(--amber)' : 'var(--bg2)',
              border: '1px solid var(--amber)',
              borderRadius: 'var(--r)',
              color: confirmMode === 'restart' && controlling === 'all' ? 'var(--bg)' : 'var(--amber)',
              fontFamily: 'var(--mono)',
              fontSize: 'var(--fsxs)',
              cursor: controlling === 'loading' ? 'not-allowed' : 'pointer',
              opacity: controlling === 'loading' ? 0.6 : 1
            }}
          >
            Restart All
          </button>
        </div>

        {/* Individual Bot Controls */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <div style={{ flex: 1, display: 'flex', gap: '2px', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--fsxs)', color: '#00ff88', fontFamily: 'var(--mono)' }}>Bot 1</span>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button
                onClick={() => handleControl('bot1', 'start')}
                disabled={controlling === 'loading'}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: controlling === 'bot1' ? 'var(--green)' : 'var(--gbg)',
                  border: '1px solid #00ff88',
                  borderRadius: 'var(--r)',
                  color: controlling === 'bot1' ? 'var(--bg)' : '#00ff88',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)',
                  cursor: controlling === 'loading' ? 'not-allowed' : 'pointer'
                }}
              >
                ▶
              </button>
              <button
                onClick={() => handleControl('bot1', 'stop')}
                disabled={controlling === 'loading'}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: controlling === 'bot1' ? 'var(--red)' : 'var(--bg2)',
                  border: '1px solid var(--red)',
                  borderRadius: 'var(--r)',
                  color: controlling === 'bot1' ? 'var(--bg)' : 'var(--red)',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)',
                  cursor: controlling === 'loading' ? 'not-allowed' : 'pointer'
                }}
              >
                ■
              </button>
              <button
                onClick={() => handleControl('bot1', 'restart')}
                disabled={controlling === 'loading'}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: controlling === 'bot1' ? 'var(--amber)' : 'var(--bg2)',
                  border: '1px solid var(--amber)',
                  borderRadius: 'var(--r)',
                  color: controlling === 'bot1' ? 'var(--bg)' : 'var(--amber)',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)',
                  cursor: controlling === 'loading' ? 'not-allowed' : 'pointer'
                }}
              >
                ↻
              </button>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', gap: '2px', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--fsxs)', color: '#3a8fd8', fontFamily: 'var(--mono)' }}>Bot 2</span>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button
                onClick={() => handleControl('bot2', 'start')}
                disabled={controlling === 'loading'}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: controlling === 'bot2' ? 'var(--green)' : 'var(--gbg)',
                  border: '1px solid #3a8fd8',
                  borderRadius: 'var(--r)',
                  color: controlling === 'bot2' ? 'var(--bg)' : '#3a8fd8',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)',
                  cursor: controlling === 'loading' ? 'not-allowed' : 'pointer'
                }}
              >
                ▶
              </button>
              <button
                onClick={() => handleControl('bot2', 'stop')}
                disabled={controlling === 'loading'}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: controlling === 'bot2' ? 'var(--red)' : 'var(--bg2)',
                  border: '1px solid var(--red)',
                  borderRadius: 'var(--r)',
                  color: controlling === 'bot2' ? 'var(--bg)' : 'var(--red)',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)',
                  cursor: controlling === 'loading' ? 'not-allowed' : 'pointer'
                }}
              >
                ■
              </button>
              <button
                onClick={() => handleControl('bot2', 'restart')}
                disabled={controlling === 'loading'}
                style={{
                  flex: 1,
                  padding: '4px',
                  background: controlling === 'bot2' ? 'var(--amber)' : 'var(--bg2)',
                  border: '1px solid var(--amber)',
                  borderRadius: 'var(--r)',
                  color: controlling === 'bot2' ? 'var(--bg)' : 'var(--amber)',
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fsxs)',
                  cursor: controlling === 'loading' ? 'not-allowed' : 'pointer'
                }}
              >
                ↻
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Combined stats header
function CombinedStats({ stats }) {
  const winRate = stats.totalTrades > 0 ? (stats.totalWins / stats.totalTrades * 100) : 0
  
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--green)',
      borderRadius: 'var(--r3)',
      padding: '8px 12px'
    }}>
      <div style={{
        fontSize: 'var(--fsxs)',
        color: 'var(--green)',
        fontFamily: 'var(--mono)',
        textTransform: 'uppercase',
        marginBottom: '6px'
      }}>
        Combined Portfolio
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Total Equity</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--mono)' }}>
            {usd(stats.totalEquity)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Total P&L</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: stats.totalPnL >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
            {stats.totalPnL >= 0 ? '+' : ''}{usd(stats.totalPnL)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Win Rate</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: winRate >= 60 ? 'var(--green)' : winRate >= 45 ? 'var(--amber)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
            {pct(winRate)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Bots</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>
            2
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Open Pos</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--mono)' }}>
            {stats.totalOpen}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)' }}>Gajian</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--mono)' }}>
            {usd(stats.totalGajian)}
          </div>
        </div>
      </div>
    </div>
  )
}

// Bot selector
function BotSelector({ selected, onSelect }) {
  const bots = [
    { id: 'all', label: 'All', color: '#ffffff' },
    { id: 'bot1', label: 'Bot 1', color: '#00ff88' },
    { id: 'bot2', label: 'Bot 2', color: '#3a8fd8' },
  ]
  
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r3)',
      padding: '4px 8px',
      display: 'flex',
      gap: '4px',
      alignItems: 'center'
    }}>
      <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>
        View:
      </span>
      {bots.map(bot => (
        <button
          key={bot.id}
          onClick={() => onSelect(bot.id)}
          style={{
            background: selected === bot.id ? 'var(--bg3)' : 'transparent',
            border: '1px solid',
            borderColor: selected === bot.id ? bot.color : 'var(--border)',
            borderRadius: 'var(--r)',
            padding: '2px 8px',
            color: selected === bot.id ? bot.color : 'var(--text3)',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)',
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
        >
          {bot.label}
        </button>
      ))}
    </div>
  )
}

// Main Unified Dashboard
export default function UnifiedDashboard() {
  const {
    bot1,
    bot2,
    selectedBot,
    setSelectedBot,
    combinedStats,
    combinedPositions,
    combinedLog,
    controlBot,
  } = useUnifiedBots()

  const [lastUpd, setLastUpd] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setLastUpd(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Get current bot data based on selection
  const currentBot = selectedBot === 'all' ? null : selectedBot === 'bot1' ? bot1 : bot2

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        height: 26,
        background: 'var(--bg1)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 6,
        flexShrink: 0
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: '.1em' }}>
          POLY<span style={{ color: 'var(--text)' }}>BOT</span>
          <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', marginLeft: 2 }}>UNIFIED</span>
        </span>
        <BotSelector selected={selectedBot} onSelect={setSelectedBot} />
        <div style={{ width: 1, height: 10, background: 'var(--border)' }} />
        <span style={{
          display: 'inline-block',
          width: 5,
          height: 5,
          borderRadius: '50%',
          marginRight: 4,
          background: (bot1.connected && bot2.connected) ? 'var(--green)' : 'var(--red)',
          boxShadow: (bot1.connected && bot2.connected) ? '0 0 4px var(--green)' : 'none'
        }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fsxs)', color: (bot1.connected && bot2.connected) ? 'var(--green)' : 'var(--red)' }}>
          {(bot1.connected && bot2.connected) ? 'ALL LIVE' : 'PARTIAL'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <XTag t="BOT1" c={bot1.connected ? 'var(--green)' : 'var(--red)'} />
          <XTag t="BOT2" c={bot2.connected ? 'var(--green)' : 'var(--red)'} />
        </div>
        <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
          {lastUpd.toLocaleTimeString()}
        </span>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
        {/* Combined Stats */}
        <CombinedStats stats={combinedStats} />

        {/* Bot Cards Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <BotStatus bot={bot1} name="Bot 1" color="#00ff88" />
          <BotStatus bot={bot2} name="Bot 2" color="#3a8fd8" />
        </div>

        {/* Control Panel */}
        <ControlPanel bots={{ bot1, bot2 }} onControl={controlBot} />

        {/* Content Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {/* Positions Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r3)', overflow: 'hidden' }}>
              <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
                <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Open Positions ({combinedPositions.length})
                </span>
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                {combinedPositions.length === 0 ? (
                  <div style={{ padding: '6px 10px', color: 'var(--text3)', fontSize: 'var(--fsxs)' }}>_ none</div>
                ) : (
                  combinedPositions.map((pos, i) => (
                    <PositionCard key={`${pos.id}-${i}`} position={pos} color="#00ff88" />
                  ))
                )}
              </div>
            </div>

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r3)', overflow: 'hidden' }}>
              <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 600 }}>Bot 1 Gas</span>
                <XTag t={bot1.gas?.status || '—'} c={bot1.gas?.status === 'ok' ? 'var(--green)' : bot1.gas?.status === 'low' ? 'var(--amber)' : 'var(--red)'} />
              </div>
              <div style={{ padding: '6px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 'var(--fsxs)', fontFamily: 'var(--mono)' }}>
                <div><span style={{ color: 'var(--text3)' }}>POL:</span> <span>{bot1.gas?.pol_left?.toFixed(2) || '—'}</span></div>
                <div><span style={{ color: 'var(--text3)' }}>TX:</span> <span>{bot1.gas?.tx_left || '—'}</span></div>
                <div><span style={{ color: 'var(--text3)' }}>Usable:</span> <span>{bot1.gas?.pol_usable?.toFixed(2) || '—'}</span></div>
              </div>
            </div>

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r3)', overflow: 'hidden' }}>
              <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 600 }}>Bot 2 Gas</span>
                <XTag t={bot2.gas?.status || '—'} c={bot2.gas?.status === 'ok' ? 'var(--green)' : bot2.gas?.status === 'low' ? 'var(--amber)' : 'var(--red)'} />
              </div>
              <div style={{ padding: '6px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 'var(--fsxs)', fontFamily: 'var(--mono)' }}>
                <div><span style={{ color: 'var(--text3)' }}>POL:</span> <span>{bot2.gas?.pol_left?.toFixed(2) || '—'}</span></div>
                <div><span style={{ color: 'var(--text3)' }}>TX:</span> <span>{bot2.gas?.tx_left || '—'}</span></div>
                <div><span style={{ color: 'var(--text3)' }}>Usable:</span> <span>{bot2.gas?.pol_usable?.toFixed(2) || '—'}</span></div>
              </div>
            </div>
          </div>

          {/* Signal/Log Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r3)', overflow: 'hidden' }}>
              <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
                <span style={{ fontSize: 'var(--fsxs)', color: 'var(--text)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 600 }}>Signal Feed</span>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {combinedLog.length === 0 ? (
                  <div style={{ padding: '6px', color: 'var(--text3)', fontSize: 'var(--fsxs)' }}>_ waiting...</div>
                ) : (
                  combinedLog.slice(0, 30).map((e, i) => (
                    <SignalItem key={i} event={e} color="#00ff88" />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}