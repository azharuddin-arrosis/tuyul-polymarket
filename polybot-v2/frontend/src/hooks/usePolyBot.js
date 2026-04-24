import { useState, useEffect, useCallback } from 'react'

const API_URL = () => {
  const p = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${p}//${window.location.host}`
}

export function usePolyBot(botName) {
  const [stats,    setStats]    = useState(null)
  const [positions,setPos]      = useState([])
  const [log,      setLog]      = useState([])
  const [markets,  setMarkets]  = useState([])
  const [config,   setConfig]   = useState(null)
  const [gas,      setGas]      = useState(null)
  const [salary,   setSalary]   = useState(null)
  const [history,  setHistory]  = useState([])
  const [btc5m,    setBtc5m]    = useState(null)
  const [connected,setConn]     = useState(false)
  const [lastUpd,  setLastUpd]  = useState(null)
  const [notify,   setNotify]   = useState(null)
  const [health,   setHealth]   = useState(null)  // Health monitoring
  const ws  = useRef(null)
  const tmr = useRef(null)

  const pushNotify = (type, data) => {
    setNotify({type, data})
    setTimeout(()=>setNotify(null), 8000)
  }

  // Poll health status every 10 seconds
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL()}/api/health`)
      if (res.ok) {
        const data = await res.json()
        setHealth(data)
      }
    } catch (e) {
      console.error('Health check failed:', e)
    }
  }, [])

  const connect = useCallback(()=>{
    if (ws.current?.readyState===WebSocket.OPEN) return
    try {
      const wsUrl = (window.location.protocol==='https:'?'wss':'ws') + '://' + window.location.host + '/ws'
      ws.current = new WebSocket(wsUrl)
      ws.current.onopen  = ()=>{ 
        setConn(true); 
        clearTimeout(tmr.current)
        fetchHealth() // Initial health check
      }
      ws.current.onclose = ()=>{ setConn(false); tmr.current=setTimeout(connect,3000) }
      ws.current.onerror = ()=>ws.current?.close()
      ws.current.onmessage = (e)=>{
        try {
          const msg = JSON.parse(e.data)
          setLastUpd(new Date())
          switch(msg.type){
            case 'init':
              setStats(msg.data.stats); setPos(msg.data.positions||[])
              setLog(msg.data.log||[]); setConfig(msg.data.config)
              setMarkets(msg.data.markets||[]); setGas(msg.data.gas)
              setSalary(msg.data.salary); setHistory(msg.data.history||[])
              if(msg.data.btc5m) setBtc5m(msg.data.btc5m)
              break
            case 'stats':   setStats(msg.data); setGas(msg.data.gas); setSalary(msg.data.salary); break
            case 'positions': setPos(msg.data); break
            case 'log':     setLog(p=>[msg.data,...p].slice(0,500)); break
            case 'markets': setMarkets(msg.data); break
            case 'gas':     setGas(msg.data); break
            case 'btc5m':   setBtc5m(msg.data); break
            case 'compound_up': pushNotify('compound',msg.data); break
            case 'salary':      pushNotify('salary',msg.data);   break
            case 'setup':   break
          }
          if (msg.type==='log' && msg.data?.event==='GAS_STOP') pushNotify('gas_stop',msg.data)
          if (msg.type==='log' && msg.data?.event==='GAS_WARN') pushNotify('gas_warn',msg.data)
        } catch{}
      }
    } catch{}
  },[fetchHealth])

  useEffect(()=>{
    connect()
    
    // Health polling interval
    const healthInterval = setInterval(fetchHealth, 10000)
    
    return ()=>{ 
      clearTimeout(tmr.current)
      clearInterval(healthInterval)
      ws.current?.close() 
    }
  },[connect, fetchHealth])

  // REST fallback
  useEffect(()=>{
    if (connected) return
    const id=setInterval(async()=>{
      try {
        const [s,p,l,m,g,sl,h]=await Promise.all([
          fetch('/api/stats').then(r=>r.json()),
          fetch('/api/positions').then(r=>r.json()),
          fetch('/api/log?limit=80').then(r=>r.json()),
          fetch('/api/markets').then(r=>r.json()),
          fetch('/api/gas').then(r=>r.json()),
          fetch('/api/salary').then(r=>r.json()),
          fetch('/api/history?limit=50').then(r=>r.json()),
        ])
        setStats(s);setPos(p);setLog(l);setMarkets(m);setGas(g);setSalary(sl);setHistory(h)
        setLastUpd(new Date())
        fetchHealth() // Also check health via REST
      } catch{}
    },5000)
    return ()=>clearInterval(id)
  },[connected, fetchHealth])

  const setup = async(usdc,pol,mode)=>{
    const r = await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({usdc,pol,mode})})
    return r.json()
  }

  const resumeGas = async()=>fetch('/api/gas/resume',{method:'POST'})

  const setMode = async (newMode) => {
    // Switch between demo (sim) and real mode
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        usdc: stats?.capital || 10,
        pol: config?.pol_balance || 11,
        mode: newMode
      })
    })
    return r.json()
  }

  return {
    stats, positions, log, markets, config, gas, salary, history, btc5m, 
    connected, lastUpd, notify, setup, resumeGas, health, setMode
  }
}