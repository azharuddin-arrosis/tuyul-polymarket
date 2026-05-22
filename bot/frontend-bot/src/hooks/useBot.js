import { useState, useEffect, useRef, useCallback } from 'react'

export function useBot() {
  const [stats,   setStats]   = useState(null)
  const [pos,     setPos]     = useState([])
  const [log,     setLog]     = useState([])
  const [hist,    setHist]    = useState([])
  const [btc5m,   setBtc5m]   = useState(null)
  const [gas,     setGas]     = useState(null)
  const [balance, setBalance] = useState(null)   // Sprint 1: live balance
  const [orderbook, setOrderbook] = useState(null)   // Polypox: CLOB book YES/NO
  const [config,  setConfig]  = useState(null)   // Polypox Phase 2: mode + strategy config
  const [conn,    setConn]    = useState(false)
  const ws  = useRef(null)
  const tmr = useRef(null)
  const balTmr = useRef(null)

  const fetchBalance = useCallback(async () => {
    try {
      const b = await fetch('/api/balance').then(r => r.json())
      setBalance(b)
    } catch {}
  }, [])

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws.current  = new WebSocket(`${proto}://${window.location.host}/ws`)
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current); fetchBalance() }
      ws.current.onclose = () => { setConn(false); tmr.current = setTimeout(connect, 3000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = ({ data }) => {
        try {
          const m = JSON.parse(data), d = m.data
          if (m.type === 'init') {
            setStats(d.stats); setPos(d.positions || []); setLog(d.log || [])
            setHist(d.history || [])
            setBtc5m(d.btc5m || null); setGas(d.gas)
            if (d.balance) setBalance(d.balance)
            if (d.orderbook) setOrderbook(d.orderbook)
            if (d.config) setConfig(d.config)
          }
          else if (m.type === 'stats')          { setStats(d); setGas(d.gas) }
          else if (m.type === 'positions')      { setPos(d) }
          else if (m.type === 'history')        { setHist(d) }
          else if (m.type === 'log')            { setLog(p => [d, ...p].slice(0, 300)) }
          else if (m.type === 'btc5m')          { setBtc5m(d) }
          else if (m.type === 'gas')            { setGas(d) }
          else if (m.type === 'gas_stop')       { setGas(g => g ? { ...g, paused: true, status: 'critical' } : g) }
          else if (m.type === 'balance_update') { setBalance(b => ({ ...b, ...d })) }
          else if (m.type === 'orderbook')      { setOrderbook(d) }
          else if (m.type === 'config')         { setConfig(d) }
        } catch {}
      }
    } catch {}
  }, [fetchBalance])

  useEffect(() => {
    connect()
    // Fallback polling when WS is down
    const id = setInterval(async () => {
      if (ws.current?.readyState === WebSocket.OPEN) return
      try {
        const [s, p, l, h, b, g, ob, cf] = await Promise.all([
          fetch('/api/stats').then(r => r.json()),
          fetch('/api/positions').then(r => r.json()),
          fetch('/api/log?limit=60').then(r => r.json()),
          fetch('/api/history?limit=300').then(r => r.json()),
          fetch('/api/btc5m').then(r => r.json()),
          fetch('/api/gas').then(r => r.json()),
          fetch('/api/orderbook').then(r => r.json()),
          fetch('/api/config').then(r => r.json()),
        ])
        setStats(s); setPos(p); setLog(l); setHist(h); setBtc5m(b); setGas(g); setOrderbook(ob); setConfig(cf)
      } catch {}
    }, 5000)
    // Balance polling every 30s (Sprint 1)
    balTmr.current = setInterval(fetchBalance, 30000)
    return () => {
      clearInterval(id)
      clearInterval(balTmr.current)
      clearTimeout(tmr.current)
      ws.current?.close()
    }
  }, [connect, fetchBalance])

  const api = (path) => fetch(path, { method: 'POST' })
  const apiJson = (path, body) => fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json())
  return {
    stats, pos, log, hist, btc5m, gas, balance, orderbook, config, conn,
    start:     () => api('/api/bot/start'),
    stop:      () => api('/api/bot/stop'),
    resumeGas: () => api('/api/gas/resume'),
    reset:     () => { if (confirm('Reset bot?')) api('/api/reset') },
    setMode:   (mode) => apiJson('/api/mode', { mode }),
    setConfig: (patch) => apiJson('/api/config', patch),
  }
}
