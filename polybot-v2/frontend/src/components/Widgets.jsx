import { useState, useMemo } from 'react'
import { usd, CAT_COLOR, STRAT_COLOR, STRAT_LABEL, fmtDur } from '../utils.js'

/* ─── HealthMonitor ────────────────────────────────── */
export function HealthMonitor({ health }) {
  if (!health) {
    return (
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'8px 10px'}}>
        <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>Health _ connecting...</div>
      </div>
    )
  }

  const { services, last_trade, stats, mode } = health
  
  const getIndicatorColor = (indicator) => {
    return indicator === 'green' ? 'var(--green)' : indicator === 'yellow' ? 'var(--amber)' : 'var(--red)'
  }

  const getIndicatorIcon = (indicator) => {
    return indicator === 'green' ? '✓' : indicator === 'yellow' ? '!' : '✗'
  }

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Health Monitor</span>
        <XTag 
          t={health.status === 'healthy' ? 'HEALTHY' : 'DEGRADED'} 
          c={health.status === 'healthy' ? 'var(--green)' : 'var(--amber)'} 
        />
      </div>

      <div style={{padding:'7px 10px'}}>
        {/* Service Status Grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
          {Object.entries(services).map(([name, data]) => (
            <div key={name} style={{
              padding:'6px 8px',
              background: getIndicatorColor(data.indicator) + '11',
              border:`1px solid ${getIndicatorColor(data.indicator)}33`,
              borderRadius:'var(--r2)'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                <span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text3)',textTransform:'uppercase'}}>{name}</span>
                <span style={{fontSize:9,fontFamily:'var(--mono)',color:getIndicatorColor(data.indicator),fontWeight:700}}>
                  {getIndicatorIcon(data.indicator)}
                </span>
              </div>
              <div style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:getIndicatorColor(data.indicator)}}>
                {data.indicator.toUpperCase()}
              </div>
              {data.seconds_ago !== undefined && (
                <div style={{fontSize:9,fontFamily:'var(--mono)',color:'var(--text3)',marginTop:2}}>
                  {data.seconds_ago}s ago
                </div>
              )}
              {data.latency_ms && (
                <div style={{fontSize:9,fontFamily:'var(--mono)',color:'var(--text3)'}}>
                  {data.latency_ms.toFixed(0)}ms
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Last Trade */}
        {last_trade?.seconds_ago !== null && (
          <div style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text3)',marginBottom:4}}>
            Last trade: {last_trade.seconds_ago !== undefined ? `${last_trade.seconds_ago}s ago` : '—'}
          </div>
        )}

        {/* Quick Stats */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
          <div><span style={{color:'var(--text3)'}}>Trades:</span> {stats?.total_trades || 0}</div>
          <div><span style={{color:'var(--text3)'}}>Open:</span> {stats?.open_positions || 0}</div>
          <div><span style={{color:'var(--text3)'}}>Mode:</span> <span style={{color:mode==='sim'?'var(--amber)':'var(--green)'}}>{mode?.toUpperCase()}</span></div>
        </div>
      </div>
    </div>
  )
}

/* ─── DemoModeToggle ────────────────────────────────── */
export function DemoModeToggle({ currentMode, onSwitch, disabled }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)

  const isDemo = currentMode === 'sim'

  const handleSwitch = async (newMode) => {
    setLoading(true)
    try {
      await onSwitch(newMode)
      setShowConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  if (showConfirm) {
    return (
      <div style={{
        background:'var(--bg1)',border:'1px solid var(--amber)',borderRadius:'var(--r3)',
        padding:'10px',animation:'slideIn .2s ease'
      }}>
        <div style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--amber)',marginBottom:6,fontWeight:600}}>
          ⚠️ CONFIRM MODE SWITCH
        </div>
        <div style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text2)',marginBottom:8}}>
          {isDemo 
            ? 'Switch to REAL mode will trade with actual capital on Polymarket. Are you sure?'
            : 'Switch to DEMO mode will use paper trading. No real money will be used.'
          }
        </div>
        <div style={{display:'flex',gap:6}}>
          <button 
            onClick={() => handleSwitch(isDemo ? 'real' : 'sim')}
            disabled={loading}
            style={{
              flex:1,padding:'6px',borderRadius:'var(--r)',border:'none',
              background:isDemo?'var(--green)':'var(--amber)',color:'var(--bg)',
              fontFamily:'var(--mono)',fontSize:'var(--fsxs)',fontWeight:600,
              cursor:loading?'not-allowed':'pointer',opacity:loading?.6:1
            }}
          >
            {loading ? '...' : isDemo ? 'SWITCH TO REAL' : 'SWITCH TO DEMO'}
          </button>
          <button 
            onClick={() => setShowConfirm(false)}
            disabled={loading}
            style={{
              padding:'6px 12px',borderRadius:'var(--r)',border:'1px solid var(--border)',
              background:'var(--bg2)',color:'var(--text3)',
              fontFamily:'var(--mono)',fontSize:'var(--fsxs)',
              cursor:loading?'not-allowed':'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Trading Mode</span>
        <XTag 
          t={isDemo ? 'DEMO' : 'REAL'} 
          c={isDemo ? 'var(--amber)' : 'var(--green)'} 
        />
      </div>
      <div style={{padding:'8px 10px'}}>
        <div style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text2)',marginBottom:6}}>
          {isDemo 
            ? 'Paper trading with fake capital. No real money used.'
            : 'Live trading on Polymarket with real USDC.'
          }
        </div>
        <button 
          onClick={() => setShowConfirm(true)}
          disabled={disabled}
          style={{
            width:'100%',padding:'6px',borderRadius:'var(--r)',border:`1px solid ${isDemo?'var(--amber)':'var(--green)'}`,
            background: isDemo ? 'var(--amberbg)' : 'var(--gbg)',
            color: isDemo ? 'var(--amber)' : 'var(--green)',
            fontFamily:'var(--mono)',fontSize:'var(--fsxs)',fontWeight:600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1
          }}
        >
          Switch to {isDemo ? 'REAL' : 'DEMO'} Mode
        </button>
      </div>
    </div>
  )
}

/* ─── XTag ──────────────────────────────────────── */
export function XTag({t,c}) {
  return <span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',padding:'0px 5px',borderRadius:'var(--r)',
    background:c+'18',color:c,border:`1px solid ${c}33`,whiteSpace:'nowrap'}}>{t}</span>
}

/* ─── MarketTable ─────────────────────────────── */
const COLS=[
  {k:'resolve_sec',l:'Resolve',w:55,mono:true},
  {k:'category',  l:'Cat',    w:60},
  {k:'question',  l:'Market', w:220},
  {k:'yes_price', l:'YES',    w:48,mono:true},
  {k:'no_price',  l:'NO',     w:48,mono:true},
  {k:'spread',    l:'Spread', w:52,mono:true},
  {k:'volume_24h',l:'Vol24h', w:72,mono:true},
  {k:'signal',    l:'Signal', w:72},
  {k:'outcome',   l:'Side',   w:55},
  {k:'ev',        l:'EV',     w:45,mono:true},
  {k:'true_prob', l:'Prob',   w:45,mono:true},
  {k:'fee',       l:'Fee',    w:42,mono:true},
]

export function MarketTable({ markets }) {
  const [sort, setSort]  = useState({k:'resolve_sec',d:1})
  const [cat,  setCat]   = useState('all')
  const [sigF, setSigF]  = useState('all')
  const [q,    setQ]     = useState('')

  const cats = useMemo(()=>['all',...new Set(markets.map(m=>m.category).filter(Boolean))]  ,[markets])

  const rows = useMemo(()=>{
    let r=[...markets]
    if(cat!=='all') r=r.filter(m=>m.category===cat)
    if(sigF==='signal') r=r.filter(m=>m.signal&&m.signal!=='—')
    else if(sigF!=='all') r=r.filter(m=>m.signal===sigF)
    if(q){ const ql=q.toLowerCase(); r=r.filter(m=>m.question?.toLowerCase().includes(ql)||m.category?.includes(ql)) }
    r.sort((a,b)=>{ const av=a[sort.k]??0,bv=b[sort.k]??0; return typeof av==='string'?av.localeCompare(bv)*sort.d:(av-bv)*sort.d })
    return r
  },[markets,cat,sigF,q,sort])

  const toggle=k=>setSort(s=>s.k===k?{k,d:-s.d}:{k,d:1})
  const arr=k=>sort.k===k?(sort.d>0?'↑':'↓'):''

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      {/* toolbar */}
      <div style={{display:'flex',gap:6,padding:'4px 8px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',alignItems:'center',flexWrap:'wrap'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',minWidth:60}}>{rows.length} mkts</span>
        <select value={cat} onChange={e=>setCat(e.target.value)} style={{width:'auto',padding:'2px 5px',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r)',color:'var(--text2)'}}>
          {cats.map(c=><option key={c} value={c}>{c==='all'?'ALL':c.toUpperCase().slice(0,6)}</option>)}
        </select>
        <select value={sigF} onChange={e=>setSigF(e.target.value)} style={{width:'auto',padding:'2px 5px',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r)',color:'var(--text2)'}}>
          {['all','signal','arb','no_bias','high_prob'].map(s=><option key={s} value={s}>{s==='all'?'ALL SIG':s==='signal'?'HAS SIG':s.replace('_',' ').toUpperCase()}</option>)}
        </select>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="filter..." style={{width:110,padding:'2px 6px',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r)',color:'var(--text)',outline:'none'}}/>
        <span style={{marginLeft:'auto',fontSize:'var(--fsxs)',color:'var(--text3)'}}>fast-resolve ≤7d only</span>
      </div>
      {/* table */}
      <div style={{overflowX:'auto',overflowY:'auto',flex:1}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:820}}>
          <colgroup>{COLS.map(c=><col key={c.k} style={{width:c.w}}/>)}</colgroup>
          <thead style={{position:'sticky',top:0,zIndex:5}}>
            <tr>
              {COLS.map(c=>(
                <th key={c.k} className="xls-th" onClick={()=>toggle(c.k)}>
                  {c.l} <span style={{color:'var(--blue)',opacity:.6}}>{arr(c.k)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0&&<tr><td colSpan={COLS.length} style={{padding:'14px',textAlign:'center',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ scanning...</td></tr>}
            {rows.map((row,i)=>{
              const hs=row.signal&&row.signal!=='—'
              const cc=CAT_COLOR[row.category]||'#5a7090'
              const sc=STRAT_COLOR[row.signal]||'transparent'
              const rs=row.resolve_sec||0
              const rc=rs<3600?'var(--green)':rs<86400?'var(--blue)':rs<604800?'var(--amber)':'var(--text3)'
              const wonNum=Number(row.yes_price)
              return (
                <tr key={row.id||i} className="xls-tr" style={{background:hs?sc+'10':'',animation:hs?'flash .4s ease':'none'}}>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:rc,fontWeight:600}}>{row.resolve_fmt||'?'}</td>
                  <td className="xls-td"><XTag t={(row.category||'').slice(0,5).toUpperCase()} c={cc}/></td>
                  <td className="xls-td" style={{color:'var(--text)'}} title={row.question}>{row.question}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:wonNum>=.55&&wonNum<=.88?'var(--green)':'var(--text2)',textAlign:'right'}}>{row.yes_price?.toFixed(3)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text2)',textAlign:'right'}}>{row.no_price?.toFixed(3)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:row.spread<0?'var(--green)':'var(--text3)',textAlign:'right'}}>{row.spread?.toFixed(3)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text2)',textAlign:'right',fontSize:'var(--fsxs)'}}>
                    {(row.volume_24h||0)>=1e6?`$${((row.volume_24h||0)/1e6).toFixed(1)}M`:(row.volume_24h||0)>=1e3?`$${((row.volume_24h||0)/1e3).toFixed(0)}K`:`$${(row.volume_24h||0).toFixed(0)}`}
                  </td>
                  <td className="xls-td">{hs?<XTag t={STRAT_LABEL[row.signal]||row.signal} c={sc}/>:<span style={{color:'var(--text3)',fontSize:'var(--fsxs)'}}>—</span>}</td>
                  <td className="xls-td">{hs&&row.outcome!=='—'?<XTag t={row.outcome} c={row.outcome==='YES'?'var(--green)':row.outcome==='NO'?'var(--amber)':'var(--blue)'}/>:<span style={{color:'var(--text3)',fontSize:'var(--fsxs)'}}>—</span>}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:row.ev>.10?'var(--green)':row.ev>.05?'var(--amber)':'var(--text3)'}}>{hs?`${(row.ev*100).toFixed(1)}%`:'—'}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text2)'}}>{hs?`${(row.true_prob*100).toFixed(0)}%`:'—'}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text3)',fontSize:'var(--fsxs)'}}>{((row.fee||0)*100).toFixed(2)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── GasPanel ────────────────────────────────── */
export function GasPanel({ gas, onResume }) {
  if (!gas) return null
  const pct = Math.min(100,((gas.pol_used||0)/(gas.pol_total||11)*100))
  const bc  = gas.status==='critical'?'var(--red)':gas.status==='low'?'var(--amber)':'var(--green)'
  return (
    <div style={{background:'var(--bg2)',border:`1px solid ${gas.status==='ok'?'var(--border)':bc+'44'}`,borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>⛽ Gas</span>
        <XTag t={gas.status.toUpperCase()} c={bc}/>
      </div>
      <div style={{padding:'7px 10px'}}>
        <div style={{height:4,background:'var(--border2)',borderRadius:2,overflow:'hidden',marginBottom:6}}>
          <div style={{height:'100%',width:`${pct}%`,background:bc,borderRadius:2,transition:'width .5s'}}/>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            {[
              ['POL left',  `${(gas.pol_left||0).toFixed(3)} / ${gas.pol_total}`, null],
              ['Usable 50%',`${(gas.pol_usable||0).toFixed(3)} POL`,              null],
              ['TX left',    gas.tx_left,                                          gas.tx_left<=10?bc:null],
              ['Gas paid',   usd(gas.gas_usd),                                    null],
            ].map(([k,v,c])=>(
              <tr key={k}>
                <td style={{padding:'2px 0',fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{k}</td>
                <td style={{padding:'2px 0',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:c||'var(--text)',textAlign:'right'}}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:5,display:'flex',gap:8,fontFamily:'var(--mono)'}}>
          <span>⚠&lt;{gas.alert_tx}tx</span><span>🛑&lt;{gas.stop_tx}tx</span><span>50% rsv</span>
        </div>
        {gas.paused&&<button onClick={onResume} style={{marginTop:6,width:'100%',padding:'5px',background:'var(--rbg)',border:'1px solid var(--red)',borderRadius:'var(--r2)',color:'var(--red)',fontFamily:'var(--mono)',fontSize:'var(--fsxs)'}}>RESUME SETELAH TOP-UP POL</button>}
      </div>
    </div>
  )
}

/* ─── Toast ──────────────────────────────────── */
export function Toast({ notify, onDismiss, onResume }) {
  if (!notify) return null
  const d=notify.data
  const isSal=notify.type==='salary',isCmp=notify.type==='compound'
  const isGS=notify.type==='gas_stop',isGW=notify.type==='gas_warn'
  const c=isSal?'var(--gold)':isCmp?'var(--green)':isGS?'var(--red)':'var(--amber)'
  return (
    <div onClick={isGS?undefined:onDismiss} style={{
      position:'fixed',top:44,right:12,zIndex:9999,width:260,
      background:'var(--bg1)',border:`1px solid ${c}`,borderLeft:`3px solid ${c}`,
      borderRadius:'var(--r3)',padding:'10px 12px',
      boxShadow:`0 0 16px ${c}20`,animation:'slideIn .3s ease',
      cursor:isGS?'default':'pointer',
    }}>
      {isSal&&<>
        <div style={{fontSize:'var(--fsxs)',color:c,fontFamily:'var(--mono)',marginBottom:3}}>💰 GAJIAN!</div>
        <div style={{fontSize:14,fontWeight:600,marginBottom:3}}>+${Number(d.withdrawn).toFixed(2)} ditarik</div>
        <div style={{fontSize:'var(--fsxs)',color:'var(--text2)'}}>Modal lanjutan: <span style={{color:'var(--green)',fontFamily:'var(--mono)'}}>${Number(d.kept).toFixed(2)}</span> · next at ${d.next_target}</div>
      </>}
      {isCmp&&<>
        <div style={{fontSize:'var(--fsxs)',color:c,fontFamily:'var(--mono)',marginBottom:3}}>⬆ COMPOUND T{d.new_tier}</div>
        <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>${d.new_bet}/bet</div>
        <div style={{fontSize:'var(--fsxs)',color:'var(--text2)'}}>Capital: <span style={{color,fontFamily:'var(--mono)'}}>${Number(d.capital).toFixed(2)}</span></div>
      </>}
      {isGW&&<>
        <div style={{fontSize:'var(--fsxs)',color:c,fontFamily:'var(--mono)',marginBottom:3}}>⚠ GAS MENIPIS</div>
        <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{d.tx_left} TX tersisa</div>
        <div style={{fontSize:'var(--fsxs)',color:'var(--text2)',fontFamily:'var(--mono)'}}>{(d.pol_left||0).toFixed(3)} POL</div>
      </>}
      {isGS&&<>
        <div style={{fontSize:'var(--fsxs)',color:c,fontFamily:'var(--mono)',marginBottom:3}}>🛑 BOT STOP</div>
        <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Gas habis</div>
        <button onClick={onResume} style={{width:'100%',padding:'5px',background:c+'22',border:`1px solid ${c}`,borderRadius:'var(--r2)',color:c,fontFamily:'var(--mono)',fontSize:'var(--fsxs)',cursor:'pointer'}}>RESUME</button>
      </>}
    </div>
  )
}

/* ─── ActivityLog ────────────────────────────── */
const EICON={OPEN:'▲',CLOSE_WON:'✓',CLOSE_LOST:'✗',REJECTED:'–',COMPOUND_UP:'⬆',SALARY:'$',GAS_WARN:'!',GAS_STOP:'■',GAS_RESUME:'▶',DAILY_RESET:'○'}

export function ActivityLog({ log, maxH='260px' }) {
  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Log</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{log.length}</span>
      </div>
      <div style={{maxHeight:maxH,overflowY:'auto'}}>
        {log.length===0&&<div style={{padding:'10px',color:'var(--text3)',fontFamily:'var(--mono)',fontSize:'var(--fsxs)'}}>_ waiting...</div>}
        {log.map((e,i)=>{
          const isO=e.event==='OPEN',isC=e.event==='CLOSE',won=e.result==='won'
          const isSal=e.event==='SALARY',isCmp=e.event==='COMPOUND_UP'
          const isGW=e.event==='GAS_WARN',isGS=e.event==='GAS_STOP'
          const ik=isC?(won?'CLOSE_WON':'CLOSE_LOST'):e.event
          const icon=EICON[ik]||'·'
          const color=isO?'var(--blue)':isC?(won?'var(--green)':'var(--red)'):
                      isSal?'var(--gold)':isCmp?'var(--green)':isGS?'var(--red)':isGW?'var(--amber)':'var(--text3)'
          return (
            <div key={i} style={{
              display:'grid',gridTemplateColumns:'18px 52px 88px 1fr auto',
              alignItems:'center',gap:4,padding:'3px 10px',
              borderBottom:'1px solid var(--border)',height:'var(--row)',
              background:isSal?'var(--goldbg)':isCmp?'var(--gbg)':isGS?'var(--rbg)':i%2===0?'transparent':'rgba(255,255,255,.008)',
              animation:'fadeUp .15s ease',
            }}>
              <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color,textAlign:'center'}}>{icon}</span>
              <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{e.time}</span>
              <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color,letterSpacing:'.03em'}}>{e.event}</span>
              <span style={{fontSize:'var(--fsxs)',color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {isO  && `${e.id} · ${e.question||''} [${e.resolve_fmt||'?'}]`}
                {isC  && `${e.id} · ${e.result?.toUpperCase()} · ${Number(e.pnl)>=0?'+':''}$${Math.abs(Number(e.pnl)).toFixed(3)}`}
                {isSal&& `Gajian $${Number(e.withdrawn||0).toFixed(2)} → modal $${Number(e.kept||0).toFixed(2)}`}
                {isCmp&& `T${e.tier} · $${e.new_bet}/bet`}
                {isGW && (e.message||'')}
                {isGS && (e.message||'')}
                {e.event==='REJECTED'&&(e.reason||'')}
              </span>
              <div>
                {isO  && <XTag t={(e.strategy||'').replace('_','-')} c={STRAT_COLOR[e.strategy]||'#888'}/>}
                {isC  && <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:won?'var(--green)':'var(--red)',whiteSpace:'nowrap'}}>{won?'+':'-'}${Math.abs(Number(e.pnl)).toFixed(2)}</span>}
                {isSal&& <XTag t="SALARY" c="var(--gold)"/>}
                {isCmp&& <XTag t={`T${e.tier}`} c="var(--green)"/>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── BTC5m Signal Panel ─────────────────────── */
export function BTC5mPanel({ data }) {
  if (!data) return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'8px 10px'}}>
      <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>BTC 5M _ connecting...</div>
    </div>
  )

  const {slug,secs_left,btc_price,predicted_dir,confidence,entry_fired,in_entry_zone,signal,stats} = data
  const dirColor = predicted_dir==='UP'?'var(--green)':predicted_dir==='DOWN'?'var(--red)':'var(--text3)'
  const zoneColor = in_entry_zone?'var(--amber)':'var(--text3)'
  const prog = secs_left>0 ? Math.round((300-secs_left)/300*100) : 100

  const fmtConf = c => c ? `${(c*100).toFixed(0)}%` : '—'
  const sig = signal || {}

  return (
    <div style={{background:'var(--bg2)',border:`1px solid ${predicted_dir?dirColor+'44':'var(--border)'}`,borderRadius:'var(--r3)',overflow:'hidden'}}>
      {/* header */}
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>⚡ BTC 5M Signal</span>
        <div style={{display:'flex',gap:4,alignItems:'center'}}>
          {in_entry_zone&&<span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--amber)',padding:'0 4px',background:'var(--abg)',borderRadius:'var(--r)'}}>ENTRY ZONE</span>}
          {entry_fired&&<span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--green)',padding:'0 4px',background:'var(--gbg)',borderRadius:'var(--r)'}}>FIRED</span>}
        </div>
      </div>

      <div style={{padding:'7px 10px'}}>
        {/* price + countdown */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:7}}>
          <div>
            <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:1}}>BTC Price</div>
            <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600,color:'var(--text)'}}>${btc_price?.toLocaleString()??'—'}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:1}}>Window closes</div>
            <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600,color:zoneColor}}>{secs_left??'—'}s</div>
          </div>
        </div>

        {/* window progress */}
        <div style={{height:3,background:'var(--border2)',borderRadius:1,overflow:'hidden',marginBottom:7}}>
          <div style={{height:'100%',width:`${prog}%`,background:in_entry_zone?'var(--amber)':predicted_dir?dirColor:'var(--blue)',borderRadius:1,transition:'width 1s linear'}}/>
        </div>

        {/* prediction */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:7}}>
          <div style={{padding:'5px 8px',background:predicted_dir?dirColor+'11':'var(--bg3)',border:`1px solid ${predicted_dir?dirColor+'33':'var(--border)'}`,borderRadius:'var(--r2)',textAlign:'center'}}>
            <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:1}}>Predict</div>
            <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:dirColor||'var(--text3)'}}>{predicted_dir||'—'}</div>
          </div>
          <div style={{padding:'5px 8px',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--r2)',textAlign:'center'}}>
            <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:1}}>Confidence</div>
            <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:confidence>=.7?'var(--green)':confidence>=.6?'var(--amber)':'var(--text3)'}}>{fmtConf(confidence)}</div>
          </div>
        </div>

        {/* indicator grid */}
        <table style={{width:'100%',borderCollapse:'collapse',marginBottom:7}}>
          <tbody>
            {[
              ['EMA(3>8)',  sig.ema_up!==undefined ? (sig.ema_up?'▲ BULL':'▼ BEAR') : '—', sig.ema_up?'var(--green)':'var(--red)'],
              ['RSI(7)',    sig.rsi!==undefined ? sig.rsi.toFixed(1) : '—', sig.rsi<35?'var(--green)':sig.rsi>65?'var(--red)':'var(--text2)'],
              ['Vol Spike', sig.vol_spike!==undefined ? (sig.vol_spike?'YES':'no') : '—', sig.vol_spike?'var(--amber)':'var(--text3)'],
              ['Candles',   sig.candle_bias||'—', sig.candle_bias==='up'?'var(--green)':'var(--red)'],
              ['Score',     sig.up_score!==undefined?`▲${sig.up_score} ▼${sig.down_score}`:'—', 'var(--text2)'],
            ].map(([k,v,c])=>(
              <tr key={k} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'2px 0',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text3)',width:70}}>{k}</td>
                <td style={{padding:'2px 0',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:c,textAlign:'right'}}>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* BTC5m stats */}
        {stats&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text3)'}}>
          <span>W:{stats.wins||0}</span>
          <span>L:{stats.losses||0}</span>
          <span>WR:{stats.total>0?`${Math.round(stats.wins/(stats.total||1)*100)}%`:'—'}</span>
          <span style={{color:'var(--text3)',maxWidth:100,overflow:'hidden',textOverflow:'ellipsis'}}>{slug?.slice(-8)||''}</span>
        </div>}
      </div>
    </div>
  )
}
