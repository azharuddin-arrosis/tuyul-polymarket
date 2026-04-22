import { useState, useEffect, useRef, useCallback } from 'react'

const WS_URL = () => {
  const p = window.location.protocol==='https:'?'wss':'ws'
  return `${p}://${window.location.host}/ws`
}

export function usePolyBot() {
  const [stats,    setStats]    = useState(null)
  const [positions,setPos]      = useState([])
  const [log,      setLog]      = useState([])
  const [markets,  setMarkets]  = useState([])
  const [config,   setConfig]   = useState(null)
  const [gas,      setGas]      = useState(null)
  const [salary,   setSalary]   = useState(null)
  const [history,  setHistory]  = useState([])
  const [connected,setConn]     = useState(false)
  const [lastUpd,  setLastUpd]  = useState(null)
  const [notify,   setNotify]   = useState(null)
  const ws  = useRef(null)
  const tmr = useRef(null)

  const pushNotify = (type, data) => {
    setNotify({type, data})
    setTimeout(()=>setNotify(null), 8000)
  }

  const connect = useCallback(()=>{
    if (ws.current?.readyState===WebSocket.OPEN) return
    try {
      ws.current = new WebSocket(WS_URL())
      ws.current.onopen  = ()=>{ setConn(true); clearTimeout(tmr.current) }
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
              break
            case 'stats':   setStats(msg.data); setGas(msg.data.gas); setSalary(msg.data.salary); break
            case 'positions': setPos(msg.data); break
            case 'log':     setLog(p=>[msg.data,...p].slice(0,500)); break
            case 'markets': setMarkets(msg.data); break
            case 'gas':     setGas(msg.data); break
            case 'compound_up': pushNotify('compound',msg.data); break
            case 'salary':      pushNotify('salary',msg.data);   break
            case 'setup':   break
          }
          if (msg.type==='log' && msg.data?.event==='GAS_STOP') pushNotify('gas_stop',msg.data)
          if (msg.type==='log' && msg.data?.event==='GAS_WARN') pushNotify('gas_warn',msg.data)
        } catch{}
      }
    } catch{}
  },[])

  useEffect(()=>{
    connect()
    return ()=>{ clearTimeout(tmr.current); ws.current?.close() }
  },[connect])

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
      } catch{}
    },5000)
    return ()=>clearInterval(id)
  },[connected])

  const setup = async(usdc,pol,mode)=>{
    const r = await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({usdc,pol,mode})})
    return r.json()
  }

  const resumeGas = async()=>fetch('/api/gas/resume',{method:'POST'})

  return {stats,positions,log,markets,config,gas,salary,history,connected,lastUpd,notify,setup,resumeGas}
}
