import { useState, useEffect } from 'react'
import { useBot, useDbSummary } from './hooks/useBot.js'

/* ── helpers ─── */
const u2  = n => n==null?'—':`$${Number(n).toFixed(2)}`
const p1  = n => n==null?'—':`${Number(n).toFixed(1)}%`
const sgn = n => { const v=Number(n); return `${v>=0?'+':'-'}$${Math.abs(v).toFixed(2)}` }
const dur = s => { if(!s||s<=0)return'—'; if(s<60)return`${Math.round(s)}s`; if(s<3600)return`${Math.round(s/60)}m`; return`${(s/3600).toFixed(1)}h` }

const Dot = ({on}) => (
  <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',background:on?'var(--green)':'var(--red)',boxShadow:on?'0 0 4px var(--green)':'none',animation:on?'pulse 2s infinite':'none'}}/>
)
const Chip = ({t,c='#666'}) => (
  <span style={{fontSize:8,fontFamily:'var(--mono)',padding:'0 4px',border:`1px solid ${c}44`,background:`${c}15`,color:c,borderRadius:2,whiteSpace:'nowrap'}}>{t}</span>
)
const Bar = ({pct,color='#fff',h=2}) => (
  <div style={{height:h,background:'#1e1e1e',borderRadius:1,overflow:'hidden'}}>
    <div style={{height:'100%',width:`${Math.min(100,Math.max(0,pct||0))}%`,background:color,transition:'width .5s'}}/>
  </div>
)

/* ── single bot card ─── */
function BotCard({prefix, label, mode}) {
  const {stats,positions,log,btc5m,conn,resumeGas,resetBot} = useBot(prefix)
  const [expanded, setExpanded] = useState(false)

  const pnl   = stats?.pnl ?? 0
  const isPos = pnl >= 0
  const gas   = stats?.gas
  const sal   = stats?.salary
  const b5s   = stats?.btc5m_stats || {}
  const borderC = mode==='real' ? '#ffaa00' : '#333'

  return (
    <div style={{
      background:'#0a0a0a', border:`1px solid ${borderC}`,
      borderRadius:4, overflow:'hidden', display:'flex', flexDirection:'column'
    }}>
      {/* header */}
      <div style={{
        display:'flex', alignItems:'center', gap:6, padding:'3px 8px',
        background:'#0f0f0f', borderBottom:'1px solid #1e1e1e',
        cursor:'pointer'
      }} onClick={()=>setExpanded(e=>!e)}>
        <Dot on={conn}/>
        <span style={{fontFamily:'var(--mono)',fontSize:10,fontWeight:700,color:'#fff'}}>{label}</span>
        <Chip t={mode.toUpperCase()} c={mode==='real'?'var(--amber)':'#666'}/>
        {stats?.compound_tier>0&&<Chip t={`T${stats.compound_tier}`} c="var(--green)"/>}
        {btc5m?.predicted_dir&&<Chip t={`BTC ${btc5m.predicted_dir}`} c={btc5m.predicted_dir==='UP'?'var(--green)':'var(--red)'}/>}
        {gas?.paused&&<Chip t="PAUSED" c="var(--red)"/>}
        <span style={{marginLeft:'auto',fontSize:8,color:'#444'}}>{expanded?'▲':'▼'}</span>
      </div>

      {/* stat strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',borderBottom:'1px solid #1e1e1e'}}>
        {[
          ['EQUITY', u2(stats?.capital), isPos?'var(--green)':'var(--red)'],
          ['P&L',    sgn(pnl),           isPos?'var(--green)':'var(--red)'],
          ['WIN',    p1(stats?.win_rate), stats?.win_rate>=60?'var(--green)':stats?.win_rate>=45?'var(--amber)':'var(--red)'],
          ['W/L',    `${stats?.wins??0}/${stats?.losses??0}`, '#aaa'],
          ['OPEN',   stats?.open_count??0, '#aaa'],
          ['GAS TX', gas?.tx_left??'—',   gas?.status==='ok'?'#aaa':gas?.status==='low'?'var(--amber)':'var(--red)'],
        ].map(([l,v,c])=>(
          <div key={l} style={{padding:'2px 5px',borderRight:'1px solid #1e1e1e'}}>
            <div style={{fontSize:7,color:'#444',fontFamily:'var(--mono)',letterSpacing:'.05em'}}>{l}</div>
            <div style={{fontSize:10,fontWeight:700,fontFamily:'var(--mono)',color:c||'#fff',whiteSpace:'nowrap'}}>{v}</div>
          </div>
        ))}
      </div>

      {/* compound + gas bars */}
      <div style={{padding:'2px 8px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,borderBottom:'1px solid #1e1e1e'}}>
        <div>
          <div style={{fontSize:7,color:'#444',fontFamily:'var(--mono)',marginBottom:2}}>COMPOUND T{stats?.compound_tier??0} · ${stats?.compound_bet??2}/bet → ${stats?.compound_next??10}</div>
          <Bar pct={stats?.compound_prog??0} color="#fff" h={2}/>
        </div>
        <div>
          <div style={{fontSize:7,color:'#444',fontFamily:'var(--mono)',marginBottom:2}}>GAS {(gas?.pol_left||0).toFixed(2)} POL · 50% rsv</div>
          <Bar pct={Math.min(100,((gas?.pol_used||0)/(gas?.pol_total||11))*100)} color={gas?.status==='critical'?'var(--red)':gas?.status==='low'?'var(--amber)':'#fff'} h={2}/>
        </div>
      </div>

      {/* BTC5m mini */}
      {btc5m && (
        <div style={{padding:'2px 8px',display:'flex',gap:12,alignItems:'center',borderBottom:'1px solid #1e1e1e'}}>
          <span style={{fontSize:8,color:'#444',fontFamily:'var(--mono)'}}>BTC5M</span>
          <span style={{fontFamily:'var(--mono)',fontSize:9,fontWeight:700,color:'#fff'}}>${btc5m.btc_price?.toLocaleString()??'—'}</span>
          <span style={{fontFamily:'var(--mono)',fontSize:9,color:btc5m.predicted_dir==='UP'?'var(--green)':btc5m.predicted_dir==='DOWN'?'var(--red)':'#444'}}>{btc5m.predicted_dir||'—'} {btc5m.confidence?(btc5m.confidence*100).toFixed(0)+'%':''}</span>
          <span style={{fontFamily:'var(--mono)',fontSize:8,color:btc5m.in_entry_zone?'var(--amber)':'#444'}}>{btc5m.secs_left??'—'}s{btc5m.in_entry_zone?' ⚡':''}</span>
          <span style={{fontSize:8,color:'#444',fontFamily:'var(--mono)',marginLeft:'auto'}}>{b5s.wins??0}W/{b5s.losses??0}L</span>
        </div>
      )}

      {/* salary */}
      {sal && (
        <div style={{padding:'2px 8px',borderBottom:'1px solid #1e1e1e'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
            <span style={{fontSize:7,color:'#444',fontFamily:'var(--mono)'}}>💰 SALARY {sal.salary_count??0}x · ${Number(sal.total_withdrawn||0).toFixed(2)} total</span>
            <span style={{fontSize:7,color:'var(--amber)',fontFamily:'var(--mono)'}}>{sal.progress_pct??0}% → ${sal.next_target??100}</span>
          </div>
          <Bar pct={sal.progress_pct??0} color="var(--amber)" h={1}/>
        </div>
      )}

      {/* expanded: log + positions */}
      {expanded && (
        <div style={{maxHeight:180,overflowY:'auto'}}>
          {/* recent log */}
          {log.slice(0,15).map((e,i)=>{
            const isO=e.event==='OPEN',isC=e.event==='CLOSE',won=e.result==='won'
            const c=isO?'var(--blue)':isC?(won?'var(--green)':'var(--red)'):e.event==='SALARY'?'var(--amber)':'#444'
            return(
              <div key={i} style={{display:'flex',gap:6,padding:'0 8px',height:16,alignItems:'center',borderBottom:'1px solid #111',background:i%2===0?'transparent':'rgba(255,255,255,.008)'}}>
                <span style={{fontFamily:'var(--mono)',fontSize:8,color:'#333',minWidth:50}}>{e.time}</span>
                <span style={{fontFamily:'var(--mono)',fontSize:8,color:c,minWidth:70}}>{e.event}</span>
                <span style={{fontSize:8,color:'#555',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
                  {isO&&`${e.id} · ${e.question||''}`}
                  {isC&&`${e.id} · ${e.result?.toUpperCase()} PnL ${Number(e.pnl)>=0?'+':''}$${Math.abs(Number(e.pnl)).toFixed(3)}`}
                  {e.event==='SALARY'&&`Gajian $${Number(e.withdrawn||0).toFixed(2)}`}
                  {e.event==='REJECTED'&&(e.reason||'')}
                </span>
                {isC&&<span style={{fontFamily:'var(--mono)',fontSize:8,color:won?'var(--green)':'var(--red)',whiteSpace:'nowrap'}}>{won?'+':'-'}${Math.abs(Number(e.pnl)).toFixed(2)}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* action buttons */}
      <div style={{display:'flex',gap:4,padding:'3px 8px',borderTop:'1px solid #1e1e1e'}}>
        {gas?.paused&&<button onClick={e=>{e.stopPropagation();resumeGas()}} style={{padding:'1px 6px',background:'transparent',border:'1px solid var(--red)',color:'var(--red)',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>RESUME</button>}
        <button onClick={e=>{e.stopPropagation();if(confirm(`Reset ${label}?`))resetBot()}} style={{padding:'1px 6px',background:'transparent',border:'1px solid #2a2a2a',color:'#444',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>RESET</button>
        <span style={{marginLeft:'auto',fontSize:7,color:'#333',fontFamily:'var(--mono)',alignSelf:'center'}}>scan #{stats?.scan_count?.toLocaleString()??'—'}</span>
      </div>
    </div>
  )
}

/* ── DB summary table ─── */
function DbSummary({summary,sessions}) {
  return (
    <div style={{background:'#0a0a0a',border:'1px solid #1e1e1e',borderRadius:4,overflow:'hidden'}}>
      <div style={{padding:'3px 8px',background:'#0f0f0f',borderBottom:'1px solid #1e1e1e'}}>
        <span style={{fontSize:9,color:'#444',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>Cross-Bot DB Summary</span>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr>{['Bot','Trades','Wins','PnL','Avg PnL','Total Bet','Last Trade'].map(h=>(
              <th key={h} style={{padding:'2px 8px',fontSize:8,fontFamily:'var(--mono)',color:'#444',textTransform:'uppercase',letterSpacing:'.05em',borderBottom:'1px solid #1e1e1e',textAlign:'left',background:'#141414',whiteSpace:'nowrap'}}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {summary.length===0&&<tr><td colSpan={7} style={{padding:'6px',textAlign:'center',color:'#333',fontSize:8,fontFamily:'var(--mono)'}}>no data — trades will appear here as bots run</td></tr>}
            {summary.map((b,i)=>{
              const wr = b.total>0 ? (b.wins/b.total*100).toFixed(1) : '0.0'
              return(
                <tr key={b.bot_id} style={{borderBottom:'1px solid #111',background:i%2===0?'transparent':'rgba(255,255,255,.008)'}}>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#fff'}}>{b.bot_id}</td>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#aaa'}}>{b.total}</td>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#aaa'}}>{b.wins} ({wr}%)</td>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,fontWeight:700,color:Number(b.total_pnl)>=0?'var(--green)':'var(--red)'}}>{Number(b.total_pnl)>=0?'+':''}${Number(b.total_pnl).toFixed(3)}</td>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:Number(b.avg_pnl)>=0?'var(--green)':'var(--red)'}}>{Number(b.avg_pnl)>=0?'+':''}${Number(b.avg_pnl).toFixed(3)}</td>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#aaa'}}>${Number(b.total_bet).toFixed(2)}</td>
                  <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:8,color:'#444'}}>{b.last_trade?.slice(11,19)||'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── bot config table ─── */
const BOT_CONFIG = [
  {prefix:'sim1',  label:'SIM 1',  mode:'sim'},
  {prefix:'sim2',  label:'SIM 2',  mode:'sim'},
  {prefix:'sim3',  label:'SIM 3',  mode:'sim'},
  {prefix:'sim4',  label:'SIM 4',  mode:'sim'},
  {prefix:'sim5',  label:'SIM 5',  mode:'sim'},
  {prefix:'real1', label:'REAL 1', mode:'real'},
  {prefix:'real2', label:'REAL 2', mode:'real'},
]

/* ── main app ─── */
export default function App() {
  const {summary, sessions} = useDbSummary()
  const [showReal, setShowReal] = useState(false)

  const visibleBots = BOT_CONFIG.filter(b => showReal ? true : b.mode==='sim')

  return (
    <div style={{height:'100vh',background:'#000',display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* top bar */}
      <div style={{height:28,background:'#080808',borderBottom:'1px solid #1e1e1e',display:'flex',alignItems:'center',padding:'0 10px',gap:10,flexShrink:0}}>
        <span style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#fff',letterSpacing:'.08em'}}>
          POLY<span style={{color:'#333'}}>BOT</span>
          <span style={{fontSize:9,color:'#444',marginLeft:6}}>MULTI</span>
        </span>
        <div style={{width:1,height:14,background:'#1e1e1e'}}/>
        <span style={{fontSize:9,color:'#444',fontFamily:'var(--mono)'}}>{BOT_CONFIG.filter(b=>b.mode==='sim').length} SIM · {BOT_CONFIG.filter(b=>b.mode==='real').length} REAL configured</span>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={()=>setShowReal(r=>!r)} style={{padding:'2px 8px',background:'transparent',border:`1px solid ${showReal?'var(--amber)':'#2a2a2a'}`,color:showReal?'var(--amber)':'#444',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>
            {showReal?'HIDE REAL':'SHOW REAL'}
          </button>
        </div>
      </div>

      {/* bot grid */}
      <div style={{flex:1,overflowY:'auto',padding:'8px 10px',display:'flex',flexDirection:'column',gap:8}}>

        {/* bot cards grid */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:8}}>
          {visibleBots.map(b=>(
            <BotCard key={b.prefix} {...b}/>
          ))}
        </div>

        {/* cross-bot DB summary */}
        <DbSummary summary={summary} sessions={sessions}/>

        {/* sessions */}
        {sessions.length>0&&(
          <div style={{background:'#0a0a0a',border:'1px solid #1e1e1e',borderRadius:4,overflow:'hidden'}}>
            <div style={{padding:'3px 8px',background:'#0f0f0f',borderBottom:'1px solid #1e1e1e'}}>
              <span style={{fontSize:9,color:'#444',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>Bot Sessions (DB)</span>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>{['Bot','Mode','Started','Capital','POL','Notes'].map(h=>(
                  <th key={h} style={{padding:'2px 8px',fontSize:8,fontFamily:'var(--mono)',color:'#444',textTransform:'uppercase',letterSpacing:'.05em',borderBottom:'1px solid #1e1e1e',textAlign:'left',background:'#141414'}}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {sessions.slice(0,10).map((s,i)=>(
                    <tr key={i} style={{borderBottom:'1px solid #111'}}>
                      <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#fff'}}>{s.bot_id}</td>
                      <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:s.mode==='real'?'var(--amber)':'#aaa'}}>{s.mode.toUpperCase()}</td>
                      <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:8,color:'#444'}}>{s.started_at?.slice(0,19)||'—'}</td>
                      <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#aaa'}}>${s.capital}</td>
                      <td style={{padding:'2px 8px',fontFamily:'var(--mono)',fontSize:9,color:'#aaa'}}>{s.pol}</td>
                      <td style={{padding:'2px 8px',fontSize:8,color:'#444'}}>{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* quick reference */}
        <div style={{background:'#0a0a0a',border:'1px solid #1e1e1e',borderRadius:4,padding:'8px 10px'}}>
          <div style={{fontSize:9,color:'#444',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6}}>Quick Reference</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:6,fontSize:8,fontFamily:'var(--mono)',color:'#444',lineHeight:1.8}}>
            <div>
              <div style={{color:'#fff',marginBottom:3}}>Run bots:</div>
              <div style={{color:'#666'}}>docker compose --profile sim up -d</div>
              <div style={{color:'#666'}}>docker compose up sim1 sim2 -d</div>
              <div style={{color:'#666'}}>docker compose --profile real up -d</div>
            </div>
            <div>
              <div style={{color:'#fff',marginBottom:3}}>Logs:</div>
              <div style={{color:'#666'}}>docker compose logs -f sim1</div>
              <div style={{color:'#666'}}>docker compose logs -f --tail=50</div>
              <div style={{color:'#666'}}>cat data/trades.db (SQLite)</div>
            </div>
            <div>
              <div style={{color:'#fff',marginBottom:3}}>DB API (shared):</div>
              <div style={{color:'#666'}}>/api/db/summary — cross-bot stats</div>
              <div style={{color:'#666'}}>/api/db/trades?bot_id=sim1</div>
              <div style={{color:'#666'}}>/api/db/sessions — all sessions</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
