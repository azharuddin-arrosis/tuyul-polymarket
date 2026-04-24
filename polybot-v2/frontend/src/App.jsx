import { useState, useEffect } from 'react'
import { usePolyBot } from './hooks/usePolyBot.js'
import { SetupWizard } from './components/SetupWizard.jsx'
import { PositionCard } from './components/PositionCard.jsx'
import { XTag } from './components/Widgets.jsx'
import { usd, pct } from './utils.js'

function Dot({on}){return <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',marginRight:4,background:on?'var(--green)':'var(--red)',boxShadow:on?'0 0 4px var(--green)':'none',animation:on?'pulse 2s infinite':'none'}}/>}

function Stat({label,value,sub,color}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'4px 8px',minWidth:0}}>
      <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:1}}>{label}</div>
      <div style={{fontSize:14,fontWeight:600,color:color||'var(--text)',fontFamily:'var(--mono)',lineHeight:1.2}}>{value}</div>
      {sub&&<div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:1}}>{sub}</div>}
    </div>
  )
}

function MiniScanner({markets}){
  const rows = markets?.slice(0,15) || []
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:600}}>Global Scanner</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{rows.length} markets</span>
      </div>
      <div style={{overflowY:'auto',maxHeight:200}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
          <colgroup><col style={{width:40}}/><col style={{width:'auto'}}/><col style={{width:40}}/><col style={{width:40}}/><col style={{width:40}}/><col style={{width:40}}/></colgroup>
          <thead>
            <tr>
              <th className="xls-th">Resolve</th>
              <th className="xls-th">Market</th>
              <th className="xls-th">YES</th>
              <th className="xls-th">NO</th>
              <th className="xls-th">Signal</th>
              <th className="xls-th">EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.length===0&&<tr><td colSpan={6} style={{padding:'10px',textAlign:'center',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ scanning...</td></tr>}
            {rows.map((r,i)=>{
              const hasSig=r.signal&&r.signal!=='—'
              const sig=r.signal||'—'
              return(
                <tr key={r.id||i} className="xls-tr" style={{background:hasSig?'var(--gbg)':''}}>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{r.resolve_fmt||'?'}</td>
                  <td className="xls-td" style={{color:'var(--text)',fontSize:'var(--fsxs)'}} title={r.question}>{r.question?.slice(0,30)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',textAlign:'right',color:r.yes_price>=.55?'var(--green)':'var(--text2)'}}>{r.yes_price?.toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',textAlign:'right',color:'var(--text2)'}}>{r.no_price?.toFixed(2)}</td>
                  <td className="xls-td" style={{fontSize:'var(--fsxs)',color:hasSig?'var(--green)':'var(--text3)'}}>{sig}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',textAlign:'right',color:r.ev>.1?'var(--green)':'var(--text3)'}}>{hasSig?`${(r.ev*100).toFixed(0)}%`:'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OpenPositions({positions}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:600}}>Open Positions</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{positions.length}</span>
      </div>
      <div style={{overflowY:'auto',maxHeight:140}}>
        {positions.length===0
          ?<div style={{padding:'8px 10px',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ no open positions</div>
          :<table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
            <colgroup><col style={{width:70}}/><col style={{width:'auto'}}/><col style={{width:35}}/><col style={{width:40}}/><col style={{width:40}}/></colgroup>
            <thead><tr>
              <th className="xls-th">ID</th>
              <th className="xls-th">Market</th>
              <th className="xls-th">Side</th>
              <th className="xls-th">Price</th>
              <th className="xls-th">Bet</th>
            </tr></thead>
            <tbody>
              {positions.map(p=>(
                <tr key={p.id} className="xls-tr">
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{p.id}</td>
                  <td className="xls-td" style={{color:'var(--text)',fontSize:'var(--fsxs)'}} title={p.question}>{p.question?.slice(0,25)}</td>
                  <td className="xls-td"><span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:p.outcome==='YES'?'var(--green)':'var(--amber)'}}>{p.outcome}</span></td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text2)'}}>{p.price?.toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text)'}}>${p.size?.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>
    </div>
  )
}

function ActivityLog({log}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:600}}>Activity Log</span>
      </div>
      <div style={{maxHeight:120,overflowY:'auto'}}>
        {log.length===0&&<div style={{padding:'6px 10px',color:'var(--text3)',fontFamily:'var(--mono)',fontSize:'var(--fsxs)'}}>_ waiting...</div>}
        {log.slice(0,30).map((e,i)=>{
          const isO=e.event==='OPEN',isC=e.event==='CLOSE',won=e.result==='won'
          const color=isO?'var(--blue)':isC?(won?'var(--green)':'var(--red)'):'var(--text3)'
          const icon=isO?'▲':isC?(won?'✓':'✗'):'·'
          return(
            <div key={i} style={{
              display:'grid',gridTemplateColumns:'16px 48px 1fr auto',
              alignItems:'center',gap:4,padding:'2px 10px',
              borderBottom:'1px solid var(--border)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',
              background:i%2===0?'transparent':'rgba(255,255,255,.02)',
            }}>
              <span style={{color}}>{icon}</span>
              <span style={{color:'var(--text3)'}}>{e.time}</span>
              <span style={{color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {isO&&`${e.id} ${e.question?.slice(0,20)} [${e.outcome}]`}
                {isC&&`${e.id} ${won?'WIN':'LOSE'} ${Number(e.pnl)>=0?'+':''}$${Math.abs(Number(e.pnl)).toFixed(2)}`}
                {!isO&&!isC&&e.event}
              </span>
              {isC&&<span style={{color:won?'var(--green)':'var(--red)',whiteSpace:'nowrap'}}>{won?'+':'-'}${Math.abs(Number(e.pnl)).toFixed(2)}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function App(){
  const {stats,positions,log,markets,gas,salary,connected,lastUpd,notify,setup,resumeGas}=usePolyBot()
  const [ready,setReady]=useState(false)
  const pnl=stats?.pnl??0,isPos=pnl>=0

  const doSetup=async(usdc,pol,mode)=>{ await setup(usdc,pol,mode); setReady(true) }
  useEffect(()=>{ if(stats?.capital) setReady(true) },[stats])

  if(!ready) return <SetupWizard onSetup={doSetup}/>

  return(
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>
      <header style={{height:28,background:'var(--bg1)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',padding:'0 10px',gap:8,flexShrink:0}}>
        <span style={{fontFamily:'var(--mono)',fontSize:11,fontWeight:700,color:'var(--green)',letterSpacing:'.1em'}}>
          POLY<span style={{color:'var(--text)'}}>BOT</span><span style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginLeft:3}}>v3</span>
        </span>
        <div style={{width:1,height:12,background:'var(--border)'}}/>
        <Dot on={connected}/><span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:connected?'var(--green)':'var(--red)'}}>{connected?'LIVE':'···'}</span>
        {stats&&<XTag t={stats.mode} c={stats.mode==='SIM'?'var(--amber)':'var(--green)'}/>}
        {(stats?.compound_tier??0)>0&&<XTag t={`T${stats.compound_tier}·$${stats.compound_bet}`} c="var(--green)"/>}
        {salary?.salary_count>0&&<XTag t={`💰${salary.salary_count}`} c="var(--gold)"/>}
        {gas?.status==='critical'&&<XTag t="GAS" c="var(--red)"/>}
        {gas?.status==='low'&&<XTag t="GAS" c="var(--amber)"/>}
        <div style={{marginLeft:'auto',display:'flex',gap:4}}>
          <button onClick={()=>setReady(false)} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--text3)',fontFamily:'var(--mono)',fontSize:'var(--fsxs)',padding:'2px 6px',borderRadius:'var(--r)',textTransform:'uppercase'}}>RST</button>
        </div>
        {lastUpd&&<span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{lastUpd.toLocaleTimeString()}</span>}
      </header>

      <main style={{flex:1,padding:'6px 8px',display:'flex',flexDirection:'column',gap:6}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:4}}>
          <Stat label="Equity" value={usd(stats?.capital)} color="var(--text)"/>
          <Stat label="PnL" value={`${pnl>=0?'+':''}${usd(pnl)}`} color={isPos?'var(--green)':'var(--red)'}/>
          <Stat label="Win Rate" value={pct(stats?.win_rate)} color={stats?.win_rate>=60?'var(--green)':stats?.win_rate>=45?'var(--amber)':'var(--red)'}/>
          <Stat label="Daily" value={`${(stats?.daily_pnl??0)>=0?'+':''}${usd(stats?.daily_pnl)}`} color={(stats?.daily_pnl??0)>=0?'var(--green)':'var(--red)'}/>
          <Stat label="Salary" value={usd(salary?.total_withdrawn)} color="var(--gold)"/>
          <Stat label="Open" value={stats?.open_count??0} color="var(--blue)"/>
          <Stat label="Tier" value={`T${stats?.compound_tier??0}`} color="var(--green)"/>
          <Stat label="Gas" value={`${gas?.tx_left??'—'}`} color={gas?.status==='ok'?'var(--text)':gas?.status==='low'?'var(--amber)':'var(--red)'}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,flex:1}}>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <MiniScanner markets={markets}/>
            <OpenPositions positions={positions}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <ActivityLog log={log}/>
          </div>
        </div>
      </main>
    </div>
  )
}