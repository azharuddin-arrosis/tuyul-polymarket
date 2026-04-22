import { useState, useEffect } from 'react'
import { usePolyBot } from './hooks/usePolyBot.js'
import { SetupWizard } from './components/SetupWizard.jsx'
import { SalaryPanel } from './components/SalaryPanel.jsx'
import { PositionCard } from './components/PositionCard.jsx'
import { MarketTable, GasPanel, Toast, ActivityLog, XTag } from './components/Widgets.jsx'
import { usd, pct, CAT_COLOR, STRAT_COLOR } from './utils.js'

/* ─── Primitive UI ──────────────────────────── */
function Dot({on}){return <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',marginRight:4,background:on?'var(--green)':'var(--red)',boxShadow:on?'0 0 4px var(--green)':'none',animation:on?'pulse 2s infinite':'none'}}/>}

/* Stat card — Excel cell style */
function Stat({label,value,sub,color,mono,accent}){
  return(
    <div style={{background:'var(--bg2)',border:`1px solid ${accent||'var(--border)'}`,borderRadius:'var(--r3)',padding:'6px 10px',minWidth:0}}>
      <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:1}}>{label}</div>
      <div style={{fontSize:15,fontWeight:600,color:color||'var(--text)',fontFamily:mono?'var(--mono)':'var(--sans)',lineHeight:1.2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{value}</div>
      {sub&&<div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sub}</div>}
    </div>
  )
}

/* Mini compound row */
function CompoundRow({stats}){
  if(!stats) return null
  const t=stats.compound_tier??0, b=stats.compound_bet??1, p=stats.compound_prog??0
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'6px 10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em'}}>Compound</span>
        <span style={{fontFamily:'var(--mono)',fontSize:'var(--fss)',color:'var(--green)',fontWeight:600}}>T{t} · ${b}/bet</span>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
        <span style={{color:'var(--text3)'}}>Next:</span>
        <span style={{color:'var(--amber)'}}>${stats.compound_next??20}</span>
        <span style={{color:'var(--text3)',marginLeft:'auto'}}>{p}%</span>
      </div>
      <div style={{height:3,background:'var(--border2)',borderRadius:1,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${p}%`,background:'linear-gradient(90deg,var(--amber),var(--green))',borderRadius:1,transition:'width .6s'}}/>
      </div>
    </div>
  )
}

/* Mini salary row */
function SalaryRow({salary}){
  if(!salary) return null
  return(
    <div style={{background:'var(--bg2)',border:'1px solid rgba(200,168,32,.2)',borderRadius:'var(--r3)',padding:'6px 10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--gold)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em'}}>💰 Salary</span>
        <span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{salary.salary_count||0}x · {usd(salary.total_withdrawn)}</span>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
        <span style={{color:'var(--text3)'}}>Next:</span>
        <span style={{color:'var(--gold)'}}>{usd(salary.next_target)}</span>
        <span style={{color:'var(--text3)'}}>−{usd(salary.to_next)}</span>
      </div>
      <div style={{height:3,background:'var(--border2)',borderRadius:1,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${salary.progress_pct||0}%`,background:'linear-gradient(90deg,rgba(200,168,32,.4),var(--gold))',borderRadius:1,transition:'width .8s'}}/>
      </div>
    </div>
  )
}

/* PnL sparkline */
function Spark({history}){
  if(history.length<2) return <div style={{height:36,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ no data</div>
  const vals=history.map(h=>h.v)
  const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1
  const W=400,H=36,p=2
  const pts=history.map((h,i)=>`${p+(i/(history.length-1))*(W-2*p)},${H-p-((h.v-mn)/rng)*(H-2*p)}`).join(' ')
  const last=vals[vals.length-1]
  const col=last>=0?'#00c87a':'#f04060'
  return(
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}
function usePnlHistory(cap,init){
  const [h,setH]=useState([{t:0,v:0}])
  useEffect(()=>{ if(cap==null) return; setH(p=>[...p,{t:p.length,v:Number((cap-(init||10)).toFixed(4))}].slice(-120)) },[cap])
  return h
}

/* History table */
function HistoryTable({history}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Trade History</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{history.length} trades</span>
      </div>
      <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 180px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:760}}>
          <colgroup>
            <col style={{width:90}}/><col style={{width:200}}/><col style={{width:55}}/><col style={{width:50}}/><col style={{width:50}}/><col style={{width:55}}/><col style={{width:75}}/><col style={{width:45}}/><col style={{width:70}}/><col style={{width:55}}/>
          </colgroup>
          <thead style={{position:'sticky',top:0}}>
            <tr>
              {['ID','Market','Result','Side','Price','Bet','PnL','EV','Strategy','Resolve'].map(h=>(
                <th key={h} className="xls-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.length===0&&<tr><td colSpan={10} style={{padding:'12px',textAlign:'center',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ belum ada trade selesai</td></tr>}
            {history.map((t,i)=>{
              const won=t.status==='won'
              return(
                <tr key={t.id||i} className="xls-tr" style={{borderBottom:'1px solid var(--border)'}}>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{t.id}</td>
                  <td className="xls-td" style={{color:'var(--text)'}} title={t.question}>{t.question}</td>
                  <td className="xls-td">
                    <span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',padding:'0 4px',borderRadius:'var(--r)',background:won?'var(--gbg)':'var(--rbg)',color:won?'var(--green)':'var(--red)',border:`1px solid ${won?'#00c87a':'#f04060'}33`}}>{t.status?.toUpperCase()}</span>
                  </td>
                  <td className="xls-td"><span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:t.outcome==='YES'?'var(--green)':'var(--amber)'}}>{t.outcome}</span></td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text2)',textAlign:'right'}}>{t.price?.toFixed(3)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text)',textAlign:'right'}}>${t.size?.toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontWeight:600,textAlign:'right',color:Number(t.pnl)>=0?'var(--green)':'var(--red)'}}>{Number(t.pnl)>=0?'+':'-'}${Math.abs(Number(t.pnl)).toFixed(4)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text3)',fontSize:'var(--fsxs)'}}>{(t.ev*100).toFixed(0)}%</td>
                  <td className="xls-td" style={{fontSize:'var(--fsxs)',color:'var(--text3)'}}>{t.strategy?.replace('_','-')}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{t.resolve_fmt||'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* Config table */
function ConfigTable({config}){
  if(!config) return null
  const sections=[
    {t:'Bot',rows:[['Mode',config.mode],['Min Bet','$1.00'],['Max Open',config.max_open],['Min EV',`${((config.min_ev||.04)*100).toFixed(0)}%`],['Daily Loss',`$${config.daily_loss}`],['Scan',`${config.scan_sec}s`],['Markets','≤7d resolve only']]},
    {t:'Compound',rows:[['Base',`$${config.compound_base}`],['Step',`$${config.compound_step}`],['Increment',`+$${config.compound_inc}/tier`],['Max Bet',`$${config.compound_max_bet}`],['$20→T1',`$1 · $40→T2 $2 · $60→T3 $3`]]},
    {t:'Salary',rows:[['Threshold',`$${config.salary_threshold}`],['Tarik',`${((config.salary_withdraw_pct||.7)*100).toFixed(0)}%`],['Simpan',`${((config.salary_keep_pct||.3)*100).toFixed(0)}%`],['Formula','Equity $100 → tarik $70 → lanjut $30']]},
    {t:'Gas',rows:[['Reserve','50% POL dikunci'],['Per TX','~$0.02'],['Alert',`<${config.gas_alert_tx} TX`],['Stop',`<${config.gas_stop_tx} TX`]]},
    {t:'Real Mode',rows:[['Wallet','MetaMask (EVM/Polygon)'],['Phantom','❌ Tidak bisa (Solana)'],['POLY_PRIVATE_KEY','0x... dari MetaMask'],['POLY_API_KEY','dari polymarket.com/profile'],['USDC','Harus ada di Polygon wallet']]},
  ]
  return(
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:8}}>
      {sections.map(({t,rows})=>(
        <div key={t} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
          <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)'}}>
            <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>{t}</span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <tbody>
              {rows.map(([k,v])=>(
                <tr key={k} className="xls-tr" style={{borderBottom:'1px solid var(--border)'}}>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text3)',fontSize:'var(--fsxs)',width:110,whiteSpace:'nowrap'}}>{k}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text)',fontSize:'var(--fsxs)',wordBreak:'break-all',whiteSpace:'normal'}}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

/* ─── TABS ─────────────────────────────────── */
const TABS=['overview','markets','positions','salary','history','config']

/* ─── MAIN APP ─────────────────────────────── */
export default function App(){
  const {stats,positions,log,markets,config,gas,salary,history,connected,lastUpd,notify,setup,resumeGas}=usePolyBot()
  const [tab,setTab]=useState('overview')
  const [ready,setReady]=useState(false)
  const hist=usePnlHistory(stats?.capital, stats?.initial)
  const pnl=stats?.pnl??0, isPos=pnl>=0

  const doSetup=async(usdc,pol,mode)=>{ await setup(usdc,pol,mode); setReady(true) }
  useEffect(()=>{ if(stats?.capital) setReady(true) },[stats])

  if(!ready) return <SetupWizard onSetup={doSetup}/>

  return(
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>
      <Toast notify={notify} onDismiss={()=>{}} onResume={resumeGas}/>

      {/* ── HEADER ── */}
      <header style={{height:32,background:'var(--bg1)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',padding:'0 10px',gap:8,position:'sticky',top:0,zIndex:100,flexShrink:0}}>
        <span style={{fontFamily:'var(--mono)',fontSize:11,fontWeight:700,color:'var(--green)',letterSpacing:'.1em'}}>
          POLY<span style={{color:'var(--text3)'}}>BOT</span><span style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginLeft:3}}>v3</span>
        </span>
        <div style={{width:1,height:12,background:'var(--border)'}}/>
        <Dot on={connected}/><span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:connected?'var(--green)':'var(--red)'}}>{connected?'LIVE':'···'}</span>
        {stats&&<XTag t={stats.mode} c={stats.mode==='SIM'?'var(--amber)':'var(--green)'}/>}
        {(stats?.compound_tier??0)>0&&<XTag t={`T${stats.compound_tier}·$${stats.compound_bet}`} c="var(--green)"/>}
        {gas?.status==='critical'&&<XTag t="GAS CRIT" c="var(--red)"/>}
        {gas?.status==='low'&&<XTag t="GAS LOW" c="var(--amber)"/>}
        {stats?.daily_stopped&&<XTag t="DAILY STOP" c="var(--red)"/>}
        {(salary?.salary_count||0)>0&&<XTag t={`💰${salary.salary_count}x`} c="var(--gold)"/>}
        <div style={{marginLeft:'auto',display:'flex',gap:1}}>
          {TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              background:tab===t?'var(--bg3)':'transparent',
              border:`1px solid ${tab===t?'var(--border2)':'transparent'}`,
              color:tab===t?'var(--text)':'var(--text3)',
              fontFamily:'var(--mono)',fontSize:'var(--fsxs)',padding:'2px 8px',
              borderRadius:'var(--r)',textTransform:'uppercase',letterSpacing:'.06em',
            }}>{t}</button>
          ))}
          <button onClick={()=>setReady(false)} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--text3)',fontFamily:'var(--mono)',fontSize:'var(--fsxs)',padding:'2px 7px',borderRadius:'var(--r)',marginLeft:4,textTransform:'uppercase',letterSpacing:'.06em'}}>RST</button>
        </div>
        {lastUpd&&<span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{lastUpd.toLocaleTimeString()}</span>}
      </header>

      {/* ── BODY ── */}
      <main style={{flex:1,padding:'8px 10px',display:'flex',flexDirection:'column',gap:8,maxWidth:1600,width:'100%',margin:'0 auto'}}>

        {/* OVERVIEW */}
        {tab==='overview'&&(<>
          {/* stat grid — compact */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:6}}>
            <Stat label="Equity"   value={usd(stats?.capital)} sub={`avail ${usd(stats?.available)} + ${usd(stats?.locked)} locked`} mono/>
            <Stat label="PnL"      value={`${pnl>=0?'+':''}${usd(pnl)}`} sub={`${pct(stats?.roi_pct)} ROI`} color={isPos?'var(--green)':'var(--red)'} mono/>
            <Stat label="Win Rate" value={pct(stats?.win_rate)} sub={`${stats?.wins??0}W ${stats?.losses??0}L`} color={stats?.win_rate>=60?'var(--green)':stats?.win_rate>=45?'var(--amber)':'var(--red)'}/>
            <Stat label="Daily"    value={`${(stats?.daily_pnl??0)>=0?'+':''}${usd(stats?.daily_pnl)}`} color={(stats?.daily_pnl??0)>=0?'var(--green)':'var(--red)'} mono/>
            <Stat label="Salary"   value={usd(salary?.total_withdrawn)} sub={`${salary?.salary_count??0}x gajian`} color="var(--gold)" accent="rgba(200,168,32,.2)"/>
            <Stat label="Open"     value={stats?.open_count??0} sub={`/${config?.max_open??3}`} color="var(--blue)"/>
            <Stat label="Compound" value={`T${stats?.compound_tier??0}`} sub={`$${stats?.compound_bet??1}/bet`} color="var(--green)" mono/>
            <Stat label="Gas TX"   value={gas?.tx_left??'—'} sub={`${(gas?.pol_left??0).toFixed(2)} POL`} color={gas?.status==='ok'?'var(--text)':gas?.status==='low'?'var(--amber)':'var(--red)'} mono/>
          </div>

          {/* 2-col: chart+log | sidebar */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 200px',gap:8,flex:1}}>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {/* PnL chart */}
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'6px 10px'}}>
                <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:4}}>PNL CURVE · {usd(pnl)} ({pct(stats?.roi_pct)})</div>
                <Spark history={hist}/>
              </div>

              {/* positions mini-table */}
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
                <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Open Positions ({positions.length})</span>
                </div>
                {positions.length===0
                  ?<div style={{padding:'8px 10px',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ tidak ada posisi terbuka</div>
                  :<table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
                    <colgroup><col style={{width:88}}/><col style={{width:'auto'}}/><col style={{width:48}}/><col style={{width:52}}/><col style={{width:55}}/><col style={{width:45}}/><col style={{width:60}}/></colgroup>
                    <thead><tr>
                      {['ID','Market','Side','@Price','Bet','EV','Remain'].map(h=><th key={h} className="xls-th">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {positions.map((p,i)=>{
                        const elapsed=(Date.now()-new Date(p.opened_at).getTime())/1000
                        const remain=Math.max(0,(p.resolve_sec||86400)-elapsed)
                        const bc=remain<60?'var(--red)':remain<600?'var(--amber)':'var(--text2)'
                        return(
                          <tr key={p.id} className="xls-tr" style={{borderBottom:'1px solid var(--border)',animation:'fadeUp .2s ease'}}>
                            <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{p.id}</td>
                            <td className="xls-td" style={{color:'var(--text)',fontSize:'var(--fsxs)'}} title={p.question}>{p.question}</td>
                            <td className="xls-td"><span style={{fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:p.outcome==='YES'?'var(--green)':'var(--amber)'}}>{p.outcome}</span></td>
                            <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text2)'}}>{p.price?.toFixed(3)}</td>
                            <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--text)'}}>${p.size?.toFixed(2)}</td>
                            <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:p.ev>.1?'var(--green)':'var(--amber)'}}>{(p.ev*100).toFixed(0)}%</td>
                            <td className="xls-td" style={{fontFamily:'var(--mono)',textAlign:'right',color:bc,fontSize:'var(--fsxs)'}}>{remain<1?'res…':remain<3600?`${Math.round(remain/60)}m`:remain<86400?`${(remain/3600).toFixed(1)}h`:`${(remain/86400).toFixed(1)}d`}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                }
              </div>

              <ActivityLog log={log} maxH="220px"/>
            </div>

            {/* sidebar */}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <SalaryRow salary={salary}/>
              <CompoundRow stats={stats}/>
              <GasPanel gas={gas} onResume={resumeGas}/>
            </div>
          </div>
        </>)}

        {tab==='markets'&&<MarketTable markets={markets}/>}

        {tab==='positions'&&(
          positions.length===0
            ?<div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'20px',textAlign:'center',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ tidak ada posisi terbuka</div>
            :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:6}}>
              {positions.map(p=><PositionCard key={p.id} pos={p}/>)}
            </div>
        )}

        {tab==='salary'&&<SalaryPanel salary={salary} stats={stats}/>}
        {tab==='history'&&<HistoryTable history={history}/>}
        {tab==='config'&&<ConfigTable config={config}/>}

      </main>
    </div>
  )
}
