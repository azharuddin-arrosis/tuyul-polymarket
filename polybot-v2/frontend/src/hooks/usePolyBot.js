import { useState, useEffect, useRef, useCallback } from 'react'

const WS = () => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws`
}

export function usePolyBot() {
  const [stats, setStats]       = useState(null)
  const [positions, setPos]     = useState([])
  const [log, setLog]           = useState([])
  const [markets, setMarkets]   = useState([])
  const [config, setConfig]     = useState(null)
  const [gas, setGas]           = useState(null)
  const [connected, setConn]    = useState(false)
  const [lastUpd, setLastUpd]   = useState(null)
  const [notify, setNotify]     = useState(null)
  const [history, setHistory]   = useState([])
  const ws  = useRef(null)
  const tmr = useRef(null)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      ws.current = new WebSocket(WS())
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current) }
      ws.current.onclose = () => { setConn(false); tmr.current = setTimeout(connect, 3000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          setLastUpd(new Date())
          switch(msg.type) {
            case 'init':
              setStats(msg.data.stats); setPos(msg.data.positions||[])
              setLog(msg.data.log||[]); setConfig(msg.data.config)
              setMarkets(msg.data.markets||[]); setGas(msg.data.gas)
              setHistory(msg.data.history||[])
              break
            case 'stats':    setStats(msg.data); setGas(msg.data.gas); break
            case 'positions': setPos(msg.data); break
            case 'log':      setLog(p=>[msg.data,...p].slice(0,200)); break
            case 'markets':  setMarkets(msg.data); break
            case 'gas':      setGas(msg.data); break
            case 'compound_up':
              setNotify({type:'compound',data:msg.data})
              setTimeout(()=>setNotify(null),7000)
              break
          }
          // gas alerts from log
          if (msg.type === 'log' && ['GAS_WARN','GAS_STOP'].includes(msg.data?.event)) {
            setNotify({type: msg.data.event==='GAS_STOP'?'gas_stop':'gas_warn', data:msg.data})
            setTimeout(()=>setNotify(null),10000)
          }
        } catch{}
      }
    } catch{}
  }, [])

  useEffect(() => { connect(); return ()=>{ clearTimeout(tmr.current); ws.current?.close() } }, [connect])

  // REST fallback
  useEffect(() => {
    if (connected) return
    const id = setInterval(async()=>{
      try {
        const [s,p,l,m,g,h] = await Promise.all([
          fetch('/api/stats').then(r=>r.json()),
          fetch('/api/positions').then(r=>r.json()),
          fetch('/api/log?limit=50').then(r=>r.json()),
          fetch('/api/markets').then(r=>r.json()),
          fetch('/api/gas').then(r=>r.json()),
          fetch('/api/history?limit=20').then(r=>r.json()),
        ])
        setStats(s); setPos(p); setLog(l); setMarkets(m); setGas(g); setHistory(h); setLastUpd(new Date())
      } catch{}
    }, 5000)
    return ()=>clearInterval(id)
  }, [connected])

  const resumeGas = async () => {
    await fetch('/api/gas/resume', {method:'POST'})
  }

  return { stats, positions, log, markets, config, gas, connected, lastUpd, notify, resumeGas, history }
}
