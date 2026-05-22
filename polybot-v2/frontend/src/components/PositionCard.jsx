import { useState, useEffect } from 'react'
import { STRAT_COLOR, CAT_COLOR, fmtDur } from '../utils.js'

export function PositionCard({ pos }) {
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{ const id=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(id) },[])

  const elapsed = (now - new Date(pos.opened_at).getTime()) / 1000
  const resolve = pos.resolve_sec || 86400
  const remain  = Math.max(0, resolve - elapsed)
  const prog    = Math.min(100, (elapsed/resolve)*100)
  const sc      = STRAT_COLOR[pos.strategy]||'#888'
  const bc      = remain<60?'var(--red)':remain<600?'var(--amber)':sc

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderLeft:`2px solid ${sc}`,borderRadius:'var(--r3)',padding:'6px 10px',animation:'fadeUp .2s ease',fontSize:'var(--fs)'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3,alignItems:'center'}}>
        <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{pos.id}</span>
        <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:bc}}>⏱ {remain<1?'resolving':fmtDur(remain)}</span>
      </div>
      <div style={{fontSize:'var(--fs)',color:'var(--text)',marginBottom:5,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={pos.question}>{pos.question}</div>
      <div style={{display:'flex',gap:4,marginBottom:5,flexWrap:'wrap',alignItems:'center'}}>
        <XTag t={pos.outcome}   c={pos.outcome==='YES'?'var(--green)':'var(--amber)'}/>
        <XTag t={pos.strategy?.replace('_','-')} c={sc}/>
        <XTag t={pos.category} c={CAT_COLOR[pos.category]||'#888'}/>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>
          @{pos.price?.toFixed(3)} · ${pos.size?.toFixed(2)} · EV {(pos.ev*100).toFixed(0)}%
        </span>
      </div>
      <div style={{height:2,background:'var(--border2)',borderRadius:1,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${prog}%`,background:bc,transition:'width 1s linear'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:2,fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>
        <span>+{fmtDur(elapsed)}</span>
        <span>{pos.resolve_fmt||fmtDur(resolve)}</span>
      </div>
    </div>
  )
}

function XTag({t,c}) {
  return <span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',padding:'0px 5px',borderRadius:'var(--r)',background:c+'18',color:c,border:`1px solid ${c}33`}}>{t}</span>
}
