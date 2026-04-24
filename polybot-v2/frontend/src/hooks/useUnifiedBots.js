/**
 * Unified Bot Hook — connects to both Bot 1 and Bot 2
 * Provides aggregated data and individual bot control
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const BOT1_API = () => import.meta.env.VITE_BOT1_API_URL || 'http://localhost:8001'
const BOT2_API = () => import.meta.env.VITE_BOT2_API_URL || 'http://localhost:8002'

function useBotApi(baseUrl) {
  const [stats, setStats] = useState(null)
  const [positions, setPositions] = useState([])
  const [log, setLog] = useState([])
  const [markets, setMarkets] = useState([])
  const [config, setConfig] = useState(null)
  const [gas, setGas] = useState(null)
  const [salary, setSalary] = useState(null)
  const [history, setHistory] = useState([])
  const [btc5m, setBtc5m] = useState(null)
  const [connected, setConnected] = useState(false)
  const ws = useRef(null)
  const tmr = useRef(null)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const wsUrl = (window.location.protocol === 'https:' ? 'wss:' : 'ws:')
        + '//' + new URL(baseUrl()).host + '/ws'
      ws.current = new WebSocket(wsUrl)
      
      ws.current.onopen = () => {
        setConnected(true)
        clearTimeout(tmr.current)
      }
      
      ws.current.onclose = () => {
        setConnected(false)
        tmr.current = setTimeout(connect, 3000)
      }
      
      ws.current.onerror = () => ws.current?.close()
      
      ws.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          switch (msg.type) {
            case 'init':
              setStats(msg.data.stats)
              setPositions(msg.data.positions || [])
              setLog(msg.data.log || [])
              setConfig(msg.data.config)
              setMarkets(msg.data.markets || [])
              setGas(msg.data.gas)
              setSalary(msg.data.salary)
              setHistory(msg.data.history || [])
              if (msg.data.btc5m) setBtc5m(msg.data.btc5m)
              break
            case 'stats':
              setStats(msg.data)
              setGas(msg.data.gas)
              setSalary(msg.data.salary)
              break
            case 'positions':
              setPositions(msg.data)
              break
            case 'log':
              setLog(p => [msg.data, ...p].slice(0, 500))
              break
            case 'markets':
              setMarkets(msg.data)
              break
            case 'gas':
              setGas(msg.data)
              break
            case 'btc5m':
              setBtc5m(msg.data)
              break
          }
        } catch {}
      }
    } catch {}
  }, [baseUrl])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(tmr.current)
      ws.current?.close()
    }
  }, [connect])

  // REST fallback
  useEffect(() => {
    if (connected) return
    const id = setInterval(async () => {
      try {
        const [s, p, l, m, g, sl, h] = await Promise.all([
          fetch(`${baseUrl()}/api/stats`).then(r => r.json()),
          fetch(`${baseUrl()}/api/positions`).then(r => r.json()),
          fetch(`${baseUrl()}/api/log?limit=80`).then(r => r.json()),
          fetch(`${baseUrl()}/api/markets`).then(r => r.json()),
          fetch(`${baseUrl()}/api/gas`).then(r => r.json()),
          fetch(`${baseUrl()}/api/salary`).then(r => r.json()),
          fetch(`${baseUrl()}/api/history?limit=50`).then(r => r.json()),
        ])
        setStats(s)
        setPositions(p)
        setLog(l)
        setMarkets(m)
        setGas(g)
        setSalary(sl)
        setHistory(h)
      } catch {}
    }, 5000)
    return () => clearInterval(id)
  }, [connected, baseUrl])

  const setup = async (usdc, pol, mode) => {
    const r = await fetch(`${baseUrl()}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usdc, pol, mode })
    })
    return r.json()
  }

  const resumeGas = async () => fetch(`${baseUrl()}/api/gas/resume`, { method: 'POST' })

  const setMode = async (newMode) => {
    const r = await fetch(`${baseUrl()}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usdc: stats?.capital || 10,
        pol: config?.pol_balance || 11,
        mode: newMode
      })
    })
    return r.json()
  }

  const start = async () => {
    const r = await fetch(`${baseUrl()}/api/start`, { method: 'POST' })
    return r.json()
  }

  const stop = async () => {
    const r = await fetch(`${baseUrl()}/api/stop`, { method: 'POST' })
    return r.json()
  }

  const restart = async () => {
    const r = await fetch(`${baseUrl()}/api/restart`, { method: 'POST' })
    return r.json()
  }

  const fetchState = async () => {
    const r = await fetch(`${baseUrl()}/api/state`)
    return r.json()
  }

  return {
    stats,
    positions,
    log,
    markets,
    config,
    gas,
    salary,
    history,
    btc5m,
    connected,
    setup,
    resumeGas,
    setMode,
    start,
    stop,
    restart,
    fetchState,
  }
}

export function useUnifiedBots() {
  const bot1 = useBotApi(BOT1_API)
  const bot2 = useBotApi(BOT2_API)
  const [selectedBot, setSelectedBot] = useState('all')

  // Aggregate stats from both bots
  const combinedStats = {
    totalEquity: (bot1.stats?.capital || 0) + (bot2.stats?.capital || 0),
    totalPnL: (bot1.stats?.pnl || 0) + (bot2.stats?.pnl || 0),
    totalWins: (bot1.stats?.wins || 0) + (bot2.stats?.wins || 0),
    totalTrades: (bot1.stats?.total_trades || 0) + (bot2.stats?.total_trades || 0),
    totalOpen: (bot1.stats?.open_count || 0) + (bot2.stats?.open_count || 0),
    totalGajian: (bot1.salary?.total_withdrawn || 0) + (bot2.salary?.total_withdrawn || 0),
  }

  const combinedPositions = [...bot1.positions, ...bot2.positions]
  const combinedLog = [...bot1.log, ...bot2.log].sort((a, b) => {
    const ta = a.time || ''
    const tb = b.time || ''
    return tb.localeCompare(ta)
  })

  // Control functions
  const controlBot = async (botName, action) => {
    if (botName === 'bot1') {
      if (action === 'start') return bot1.start()
      if (action === 'stop') return bot1.stop()
      if (action === 'restart') return bot1.restart()
    } else if (botName === 'bot2') {
      if (action === 'start') return bot2.start()
      if (action === 'stop') return bot2.stop()
      if (action === 'restart') return bot2.restart()
    } else if (botName === 'all') {
      if (action === 'start') {
        await bot1.start()
        await bot2.start()
      } else if (action === 'stop') {
        await bot1.stop()
        await bot2.stop()
      } else if (action === 'restart') {
        await bot1.restart()
        await bot2.restart()
      }
    }
  }

  return {
    bot1,
    bot2,
    selectedBot,
    setSelectedBot,
    combinedStats,
    combinedPositions,
    combinedLog,
    controlBot,
  }
}