import { useState, useEffect, useRef, useCallback } from 'react'

// Connect to a specific bot by prefix (/sim1/, /sim2/, etc)
export function useBot(prefix) {
  const [stats, setStats]   = useState(null)
  const [positions, setPos] = useState([])
  const [log, setLog]       = useState([])
  const [markets, setMkts]  = useState([])
  const [history, setHist]  = useState([])
  const [btc5m, setBtc5m]   = useState(null)
  const [conn, setConn]     = useState(false)
  const ws  = useRef(null)
  const tmr = useRef(null)

  const baseUrl = prefix ? `/${prefix.replace(/^\/|\/$/g,'')}` : ''

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const url   = `${proto}://${window.location.host}${baseUrl}/ws`
      ws.current  = new WebSocket(url)
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current) }
      ws.current.onclose = () => { setConn(false); tmr.current=setTimeout(connect,4000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = ({data}) => {
        try {
          const m=JSON.parse(data), d=m.data
          if (m.type==='init') {
            setStats(d.stats); setPos(d.positions||[]); setLog(d.log||[])
            setMkts(d.markets||[]); setHist(d.history||[]); setBtc5m(d.btc5m||null)
          } else if (m.type==='stats')    setStats(d)
          else if (m.type==='positions')  setPos(d)
          else if (m.type==='log')        setLog(p=>[d,...p].slice(0,200))
          else if (m.type==='markets')    setMkts(d)
          else if (m.type==='btc5m')      setBtc5m(d)
        } catch {}
      }
    } catch {}
  }, [baseUrl])

  useEffect(() => {
    connect()
    const id = setInterval(async () => {
      if (ws.current?.readyState===WebSocket.OPEN) return
      try {
        const [s,p,l,mk,h,b] = await Promise.all([
          fetch(`${baseUrl}/api/stats`).then(r=>r.json()),
          fetch(`${baseUrl}/api/positions`).then(r=>r.json()),
          fetch(`${baseUrl}/api/log?limit=40`).then(r=>r.json()),
          fetch(`${baseUrl}/api/markets`).then(r=>r.json()),
          fetch(`${baseUrl}/api/history?limit=30`).then(r=>r.json()),
          fetch(`${baseUrl}/api/btc5m`).then(r=>r.json()),
        ])
        setStats(s); setPos(p); setLog(l); setMkts(mk); setHist(h); setBtc5m(b)
      } catch {}
    }, 6000)
    return () => { clearInterval(id); clearTimeout(tmr.current); ws.current?.close() }
  }, [connect, baseUrl])

  const resumeGas = () => fetch(`${baseUrl}/api/gas/resume`, {method:'POST'})
  const resetBot  = () => fetch(`${baseUrl}/api/reset`,       {method:'POST'})
  return {stats,positions,log,markets,history,btc5m,conn,resumeGas,resetBot}
}

// Cross-bot summary from shared DB
export function useDbSummary() {
  const [summary, setSummary] = useState([])
  const [sessions, setSessions] = useState([])
  useEffect(() => {
    const load = async () => {
      try {
        const [s,ss] = await Promise.all([
          fetch('/api/db/summary').then(r=>r.json()),
          fetch('/api/db/sessions').then(r=>r.json()),
        ])
        setSummary(s); setSessions(ss)
      } catch {}
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])
  return {summary, sessions}
}
