import { useState, useEffect, useRef, useCallback } from 'react'
import { usePolyBot } from './hooks/usePolyBot.js'
import { SetupWizard } from './components/SetupWizard.jsx'
import { PositionCard } from './components/PositionCard.jsx'
import { MarketTable, XTag, Toast, HealthMonitor, DemoModeToggle } from './components/Widgets.jsx'
import { usd, signUsd, idr, pct, CAT_COLOR, STRAT_COLOR, STRAT_LABEL } from './utils.js'

const STORAGE_KEY = 'polybot_pnl_history'

function loadHistory(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY))||[]} catch{ return [] } }
function saveHistory(h){ localStorage.setItem(STORAGE_KEY, JSON.stringify(h)) }

// ═══════════════════════════════════════════════════════════════
// MULTI-BOT ROUTER
// ═══════════════════════════════════════════════════════════════

function BotRouter({ bots, currentBot, onSwitchBot }) {
  if (!bots || bots.length === 0) return null
  
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', 
      borderRadius: 'var(--r3)', padding: '4px 8px',
      display: 'flex', gap: '4px', alignItems: 'center'
    }}>
      <span style={{fontSize: 'var(--fsxs)', color: 'var(--text3)', 
                    fontFamily: 'var(--mono)', textTransform: 'uppercase'}}>
        Bots:
      </span>
      {bots.map((bot, idx) => (
        <button
          key={bot.name}
          onClick={() => onSwitchBot(bot.name)}
          style={{
            background: currentBot === bot.name ? 'var(--bg3)' : 'transparent',
            border: '1px solid var(--border)',
            borderColor: currentBot === bot.name ? bot.color : 'var(--border)',
            borderRadius: 'var(--r)',
            padding: '2px 8px',
            color: currentBot === bot.name ? bot.color : 'var(--text3)',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--fsxs)',
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
        >
          Bot {idx + 1}
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMBINED DASHBOARD
// ═══════════════════════════════════════════════════════════════

function CombinedDashboard({ bots, stats, positions, markets, config, gas, salary, history, log, btc5m, connected }) {
  if (!stats) return null
  
  // Handle both backend /api/state properties (equityUsdc/pnlUsdc) and legacy (capital/pnl)
  const totalEquity = bots?.reduce((sum, b) => sum + (b.equityUsdc || b.capital || 0), 0)
  const totalPnL = bots?.reduce((sum, b) => sum + (b.pnlUsdc || b.pnl || 0), 0)
  const totalWins = bots?.reduce((sum, b) => sum + (b.wins || 0), 0)
  const totalTrades = bots?.reduce((sum, b) => sum + (b.total_trades || 0), 0)
  const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 0
  
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--green)',
        borderRadius: 'var(--r3)', padding: '8px 12px'
      }}>
        <div style={{fontSize: 'var(--fsxs)', color: 'var(--green)', 
                     fontFamily: 'var(--mono)', textTransform: 'uppercase', 
                     marginBottom: '6px'}}>
          Combined Portfolio — All Bots
        </div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px'}}>
          <div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Total Equity</div>
            <div style={{fontSize: 16, fontWeight: 700, color: 'var(--green)', 
                        fontFamily: 'var(--mono)'}}>
              {usd(totalEquity)}
            </div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text2)', fontFamily: 'var(--mono)'}}>
              {idr(totalEquity)}
            </div>
          </div>
          <div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Total P&L</div>
            <div style={{fontSize: 16, fontWeight: 700, 
                        color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)', 
                        fontFamily: 'var(--mono)'}}>
              {totalPnL >= 0 ? '+' : ''}{usd(totalPnL)}
            </div>
            <div style={{fontSize: 'var(--fsxs)', color: totalPnL >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)'}}>
              {idr(totalPnL)}
            </div>
          </div>
          <div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Win Rate</div>
            <div style={{fontSize: 16, fontWeight: 700, 
                        color: winRate >= 60 ? 'var(--green)' : winRate >= 45 ? 'var(--amber)' : 'var(--red)', 
                        fontFamily: 'var(--mono)'}}>
              {pct(winRate)}
            </div>
          </div>
          <div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Bots</div>
            <div style={{fontSize: 16, fontWeight: 700, color: 'var(--text)', 
                        fontFamily: 'var(--mono)'}}>
              {bots?.length || 0}
            </div>
          </div>
          <div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Open Pos</div>
            <div style={{fontSize: 16, fontWeight: 700, color: 'var(--blue)', 
                        fontFamily: 'var(--mono)'}}>
              {positions?.length || 0}
            </div>
          </div>
          <div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Gajian</div>
            <div style={{fontSize: 16, fontWeight: 700, color: 'var(--gold)', 
                        fontFamily: 'var(--mono)'}}>
              {usd(salary?.total_withdrawn || 0)}
            </div>
            <div style={{fontSize: 'var(--fsxs)', color: 'var(--gold)', fontFamily: 'var(--mono)'}}>
              {idr(salary?.total_withdrawn || 0)}
            </div>
          </div>
        </div>
      </div>
      
      {/* Individual bot cards */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '6px'}}>
        {bots?.map(bot => (
          <BotSummaryCard key={bot.name} bot={bot} />
        ))}
      </div>
    </div>
  )
}

function BotSummaryCard({ bot }) {
  if (!bot) return null
  
  const winRate = bot.total_trades > 0 ? (bot.wins / bot.total_trades * 100) : 0
  // Handle backend /api/state properties (equityUsdc/pnlUsdc) and legacy (capital/pnl)
  const equity = bot.equityUsdc || bot.capital || 0
  const pnl = bot.pnlUsdc || bot.pnl || 0
  
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 'var(--r3)', overflow: 'hidden'
    }}>
      <div style={{
        padding: '4px 10px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg3)', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span style={{
          fontSize: 'var(--fsxs)', color: bot.color || 'var(--green)',
          fontFamily: 'var(--mono)', textTransform: 'uppercase',
          fontWeight: 600
        }}>
          {bot.display_name}
        </span>
        <XTag t={bot.mode} c={bot.mode === 'sim' ? 'var(--amber)' : 'var(--green)'} />
      </div>
      <div style={{padding: '6px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px'}}>
        <div>
          <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Equity</div>
          <div style={{fontFamily: 'var(--mono)', color: 'var(--text)'}}>
            {usd(equity)}
          </div>
          <div style={{fontSize: 'var(--fsxs)', fontFamily: 'var(--mono)', color: 'var(--text2)'}}>
            {idr(equity)}
          </div>
        </div>
        <div>
          <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>P&L</div>
          <div style={{fontFamily: 'var(--mono)', 
                      color: pnl >= 0 ? 'var(--green)' : 'var(--red)'}}>
            {signUsd(pnl)}
          </div>
          <div style={{fontSize: 'var(--fsxs)', fontFamily: 'var(--mono)', 
                      color: pnl >= 0 ? 'var(--green)' : 'var(--red)'}}>
            {idr(pnl)}
          </div>
        </div>
        <div>
          <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>Wins</div>
          <div style={{fontFamily: 'var(--mono)', color: winRate >= 60 ? 'var(--green)' : 'var(--text2)'}}>
            {pct(winRate)}
          </div>
          <div style={{fontSize: 'var(--fsxs)', fontFamily: 'var(--mono)', color: 'var(--text3)'}}>
            {bot.wins || 0}W {bot.losses || 0}L
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// WITHDRAWAL PANEL
// ═══════════════════════════════════════════════════════════════

function WithdrawalPanel({ botName, salary, onWithdraw }) {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  
  if (!salary) return null
  
  const projected = salary.projected_withdraw || 0
  const canWithdraw = projected > 0 && !salary.paused
  
  const handleWithdraw = async () => {
    setLoading(true)
    try {
      await onWithdraw(botName, amount)
      setAmount('')
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--gold)',
      borderRadius: 'var(--r3)', overflow: 'hidden'
    }}>
      <div style={{
        padding: '4px 10px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg3)', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span style={{fontSize: 'var(--fsxs)', color: 'var(--gold)', 
                     fontFamily: 'var(--mono)', textTransform: 'uppercase', 
                     fontWeight: 600}}>
          💰 Withdrawal
        </span>
        <span style={{fontSize: 'var(--fsxs)', color: 'var(--text3)', 
                     fontFamily: 'var(--mono)'}}>
          {salary.salary_count || 0} payouts
        </span>
      </div>
      
      <div style={{padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px'}}>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: 'var(--fsxs)'}}>
          <div>
            <span style={{color: 'var(--text3)'}}>Available:</span>{' '}
            <span style={{color: 'var(--gold)', fontFamily: 'var(--mono)'}}>
               {usd(projected)}
             </span>
          </div>
          <div>
            <span style={{color: 'var(--text3)'}}>Next Target:</span>{' '}
            <span style={{color: 'var(--text)', fontFamily: 'var(--mono)'}}>
              ${salary.next_target}
            </span>
          </div>
        </div>
        
        <div style={{display: 'flex', gap: '4px'}}>
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{flex: 1, fontFamily: 'var(--mono)'}}
          />
          <button
            onClick={handleWithdraw}
            disabled={loading || !canWithdraw}
            style={{
              background: canWithdraw ? 'var(--goldbg)' : 'var(--bg3)',
              border: '1px solid var(--gold)',
              borderRadius: 'var(--r)',
              color: canWithdraw ? 'var(--gold)' : 'var(--text3)',
              padding: '4px 12px',
              fontFamily: 'var(--mono)',
              fontSize: 'var(--fsxs)',
              cursor: canWithdraw ? 'pointer' : 'not-allowed',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Processing...' : 'Withdraw'}
          </button>
        </div>
        
        <div style={{fontSize: 'var(--fsxs)', color: 'var(--text3)'}}>
          Next payout at ${salary.next_target} equity
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════��═��════════════════════════════
// SPARKLINE & HISTORY (existing)
// ═══════════════════════════════════════════════════════════════

function Sparkline({history}){
  if(history.length<2) return <div style={{height:30,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)',fontSize:9}}>_ no data</div>
  const vals=history.map(h=>h.v)
  const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1
  const W=180,H=28,p=2
  const pts=history.map((h,i)=>`${p+(i/(history.length-1))*(W-2*p)},${H-p-((h.v-mn)/rng)*(H-2*p)}`).join(' ')
  const last=vals[vals.length-1]
  const col=last>=0?'var(--green)':'var(--red)'
  return(
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

function usePnlHistory(capital, initial){
  const history=useRef(loadHistory())
  useEffect(()=>{
    if(capital==null) return
    const init=initial||10
    history.current=[...history.current,{t:Date.now(),v:Number((capital-init).toFixed(4))}].slice(-120)
    saveHistory(history.current)
  },[capital])
  return history.current
}

// ═══════════════════════════════════════════════════════════════
// WIDGET COMPONENTS (from existing app)
// ═══════════════════════════════════════════════════════════════

function Dot({on}){return <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',marginRight:4,background:on?'var(--green)':'var(--red)',boxShadow:on?'0 0 4px var(--green)':'none',animation:on?'pulse 2s infinite':'none'}}/>}

function Stat({label,value,sub,color}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'4px 8px',minWidth:0}}>
      <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:2}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:color||'var(--text)',fontFamily:'var(--mono)',lineHeight:1.2}}>{value}</div>
      {sub&&<div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:2}}>{sub}</div>}
    </div>
  )
}

function MiniScanner({markets}){
  const rows = markets?.slice(0,10) || []
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:600}}>Global Scanner</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{rows.length}</span>
      </div>
      <div style={{overflowY:'auto',maxHeight:140}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
          <colgroup><col style={{width:35}}/><col style={{width:'auto'}}/><col style={{width:35}}/><col style={{width:35}}/><col style={{width:30}}/><col style={{width:30}}/></colgroup>
          <thead>
            <tr>
              <th className="xls-th">T</th>
              <th className="xls-th">Market</th>
              <th className="xls-th">YES</th>
              <th className="xls-th">NO</th>
              <th className="xls-th">Sig</th>
              <th className="xls-th">EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.length===0&&<tr><td colSpan={6} style={{padding:'8px',textAlign:'center',color:'var(--text3)',fontSize:'var(--fsxs)'}}>_ scanning...</td></tr>}
            {rows.map((r,i)=>{
              const hasSig=r.signal&&r.signal!=='—'
              return(
                <tr key={r.id||i} className="xls-tr" style={{background:hasSig?'var(--gbg)':''}}>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{r.resolve_fmt||'?'}</td>
                  <td className="xls-td" style={{color:'var(--text)',fontSize:'var(--fsxs)'}} title={r.question}>{r.question?.slice(0,20)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',textAlign:'right',color:r.yes_price>=.55?'var(--green)':'var(--text2)'}}>{r.yes_price?.toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',textAlign:'right',color:'var(--text2)'}}>{r.no_price?.toFixed(2)}</td>
                  <td className="xls-td" style={{fontSize:'var(--fsxs)',color:hasSig?'var(--green)':'var(--text3)'}}>{r.signal||'—'}</td>
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
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>Open ({positions.length})</span>
      </div>
      <div style={{overflowY:'auto',maxHeight:60}}>
        {positions.length===0
          ?<div style={{padding:'6px 10px',color:'var(--text3)',fontSize:'var(--fsxs)'}}>_ none</div>
          :<table style={{width:'100%',borderCollapse:'collapse'}}>
            <colgroup><col style={{width:50}}/><col style={{width:'auto'}}/><col style={{width:30}}/><col style={{width:35}}/><col style={{width:35}}/></colgroup>
            <tbody>
              {positions.map(p=>(
                <tr key={p.id} className="xls-tr">
                  <td className="xls-td" style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:'var(--text3)'}}>{p.id}</td>
                  <td className="xls-td" style={{color:'var(--text)',fontSize:'var(--fsxs)'}}>{p.question?.slice(0,18)}</td>
                  <td className="xls-td"><span style={{fontSize:'var(--fsxs)',color:p.outcome==='YES'?'var(--green)':'var(--amber)'}}>{p.outcome}</span></td>
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

function HistoryPanel({history}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>Trade History</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{history.length} trades</span>
      </div>
      <div style={{overflowY:'auto',maxHeight:80}}>
        {history.length===0&&<div style={{padding:'6px 10px',color:'var(--text3)',fontSize:'var(--fsxs)'}}>_ no closed trades</div>}
        {history.slice(0,15).map((t,i)=>{
          const won=t.status==='won'
          return(
            <div key={t.id||i} style={{
              display:'grid',gridTemplateColumns:'50px 1fr 40px 50px',
              alignItems:'center',gap:4,padding:'2px 10px',
              borderBottom:'1px solid var(--border)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',
            }}>
              <span style={{color:'var(--text3)'}}>{t.id}</span>
              <span style={{color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.question?.slice(0,20)}</span>
              <span style={{
                padding:'0 3px',borderRadius:2,fontSize:'var(--fsxs)',
                background:won?'var(--gbg)':'var(--rbg)',color:won?'var(--green)':'var(--red)',
              }}>{won?'WIN':'LOSE'}</span>
<span style={{color:won?'var(--green)':'var(--red)',textAlign:'right'}}>
                 {signUsd(t.pnl)}
               </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActivityLog({log}){
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>Activity</span>
      </div>
      <div style={{maxHeight:80,overflowY:'auto'}}>
        {log.length===0&&<div style={{padding:'6px',color:'var(--text3)',fontSize:'var(--fsxs)'}}>_ waiting...</div>}
        {log.slice(0,12).map((e,i)=>{
          const isO=e.event==='OPEN',isC=e.event==='CLOSE',won=e.result==='won'
          const color=isO?'var(--blue)':isC?(won?'var(--green)':'var(--red)'):'var(--text3)'
          const icon=isO?'▲':isC?(won?'✓':'✗'):'·'
          return(
            <div key={i} style={{
              display:'grid',gridTemplateColumns:'14px 40px 1fr auto',
              alignItems:'center',gap:3,padding:'2px 8px',
              borderBottom:'1px solid var(--border)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',
            }}>
              <span style={{color}}>{icon}</span>
              <span style={{color:'var(--text3)'}}>{e.time}</span>
<span style={{color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                 {isO&&`${e.id} ${e.question?.slice(0,12)}`}
                 {isC&&`${won?'WIN':'LOSE'} ${signUsd(e.pnl)}`}
                 {e.event==='SALARY'&&`💰 GAJIAN ${usd(e.withdrawn)}`}
                 {e.event==='COMPOUND_UP'&&`⬆ T${e.tier} ${usd(e.new_bet)}`}
                 {!isO&&!isC&&e.event!=='SALARY'&&e.event!=='COMPOUND_UP'&&e.event}
               </span>
               {isC&&<span style={{color:won?'var(--green)':'var(--red)'}}>{signUsd(e.pnl)}</span>}
              {e.event==='SALARY'&&<XTag t="SALARY" c="var(--gold)"/>}
              {e.event==='COMPOUND_UP'&&<XTag t={`T${e.tier}`} c="var(--green)"/>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SalaryPanel({salary}){
  if(!salary) return null
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--gold)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--gold)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>💰 Gajian</span>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{salary.salary_count||0}x</span>
      </div>
      <div style={{padding:'6px 10px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
        <div><span style={{color:'var(--text3)'}}>Total:</span> <span style={{color:'var(--gold)'}}>{usd(salary.total_withdrawn)}</span></div>
        <div><span style={{color:'var(--text3)'}}>Target:</span> <span style={{color:'var(--text)'}}>{usd(salary.next_target)}</span></div>
        <div><span style={{color:'var(--text3)'}}>Next:</span> <span style={{color:'var(--gold)'}}>{usd(salary.to_next)}</span></div>
        <div><span style={{color:'var(--text3)'}}>Progress:</span> <span style={{color:'var(--text)'}}>{salary.progress_pct}%</span></div>
      </div>
    </div>
  )
}

function CompoundPanel({stats}){
  if(!stats) return null
  const t=stats.compound_tier??0,b=stats.compound_bet??1,p=stats.compound_prog??0
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--green)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--green)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>Compound</span>
        <span style={{fontFamily:'var(--mono)',color:'var(--green)'}}>T{t} · ${b}/bet</span>
      </div>
      <div style={{padding:'6px 10px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
        <div><span style={{color:'var(--text3)'}}>Next Tier:</span> <span style={{color:'var(--text)'}}>${stats.compound_next}</span></div>
        <div><span style={{color:'var(--text3)'}}>Progress:</span> <span style={{color:'var(--amber)'}}>{p}%</span></div>
      </div>
      <div style={{height:3,background:'var(--border2)',borderRadius:1,margin:'4px 10px 6px'}}>
        <div style={{height:'100%',width:`${p}%`,background:'var(--green)',borderRadius:1}}/>
      </div>
    </div>
  )
}

function GasPanel({gas,onResume}){
  if(!gas) return null
  const bc=gas.status==='critical'?'var(--red)':gas.status==='low'?'var(--amber)':'var(--text)'
  return(
    <div style={{background:'var(--bg2)',border:`1px solid ${gas.status==='ok'?'var(--border)':bc}`,borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>⛽ Gas</span>
        <XTag t={gas.status.toUpperCase()} c={bc}/>
      </div>
      <div style={{padding:'6px 10px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
        <div><span style={{color:'var(--text3)'}}>POL:</span> <span style={{color:bc}}>{gas.pol_left?.toFixed(2)}</span></div>
        <div><span style={{color:'var(--text3)'}}>TX:</span> <span style={{color:bc}}>{gas.tx_left}</span></div>
        <div><span style={{color:'var(--text3)'}}>Usable:</span> <span style={{color:'var(--text)'}}>{gas.pol_usable?.toFixed(2)}</span></div>
      </div>
      {gas.paused&&<button onClick={onResume} style={{margin:'4px 10px 6px',padding:'4px',background:'var(--rbg)',border:'1px solid var(--red)',borderRadius:'var(--r)',color:'var(--red)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>RESUME</button>}
    </div>
  )
}

function BTC5mPanel({data}){
  if(!data) return null
  const {predicted_dir,confidence,in_entry_zone}=data
  const dirColor=predicted_dir==='UP'?'var(--green)':predicted_dir==='DOWN'?'var(--red)':'var(--text3)'
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>⚡ BTC5M</span>
        <div style={{display:'flex',gap:4}}>
          {in_entry_zone&&<XTag t="ENTRY" c="var(--amber)"/>}
          {predicted_dir&&<XTag t={predicted_dir} c={dirColor}/>}
        </div>
      </div>
      <div style={{padding:'6px 10px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>
        <div><span style={{color:'var(--text3)'}}>Dir:</span> <span style={{color:dirColor}}>{predicted_dir||'—'}</span></div>
        <div><span style={{color:'var(--text3)'}}>Conf:</span> <span style={{color:confidence>=.7?'var(--green)':confidence>=.6?'var(--amber)':'var(--text3)'}}>{confidence?`${(confidence*100).toFixed(0)}%`:'—'}</span></div>
      </div>
    </div>
  )
}

function ConfigPanel({config}){
  if(!config) return null
  return(
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)'}}>
        <span style={{fontSize:'var(--fsxs)',color:'var(--text)',fontFamily:'var(--mono)',textTransform:'uppercase',fontWeight:600}}>Config</span>
      </div>
      <div style={{padding:'6px 10px',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text2)'}}>
        <div><span style={{color:'var(--text3)'}}>Mode:</span> {config.mode}</div>
        <div><span style={{color:'var(--text3)'}}>Min Bet:</span> $1.00</div>
        <div><span style={{color:'var(--text3)'}}>Max Open:</span> {config.max_open}</div>
        <div><span style={{color:'var(--text3)'}}>Min EV:</span> {((config.min_ev||.04)*100).toFixed(0)}%</div>
        <div><span style={{color:'var(--text3)'}}>Daily Loss:</span> ${config.daily_loss}</div>
        <div><span style={{color:'var(--text3)'}}>Comp Base:</span> ${config.compound_base}</div>
        <div><span style={{color:'var(--text3)'}}>Comp Step:</span> ${config.compound_step}</div>
        <div><span style={{color:'var(--text3)'}}>Sal Thresh:</span> ${config.salary_threshold}</div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP WITH MULTI-BOT ROUTING
// ═══════════════════════════════════════════════════════════════

export default function App(){
  // Get bot from URL path
  const path = window.location.pathname
  const botName = path.startsWith('/dashboard/') ? path.split('/')[2] : null
  
  const {stats,positions,log,markets,config,gas,salary,history,btc5m,connected,lastUpd,notify,setup,resumeGas,health,setMode,allBots}=usePolyBot(botName)
  const [ready,setReady]=useState(true)
  const [currentBot, setCurrentBot] = useState(botName || 'all')
  
  const pnl=stats?.pnl??0,isPos=pnl>=0
  const hist=usePnlHistory(stats?.capital, stats?.initial)
  const doSetup=async(usdc,pol,mode)=>{ await setup(usdc,pol,mode); setReady(true) }
  
  // Convert allBots object to array for rendering
  const allBotsArray = allBots ? Object.entries(allBots).map(([name, data]) => ({
    name,
    display_name: name === 'bot1' ? 'Bot 1' : name === 'bot2' ? 'Bot 2' : name,
    color: name === 'bot1' ? '#00ff88' : name === 'bot2' ? '#3a8fd8' : '#ffffff',
    mode: data?.mode || 'sim',
    ...data
  })) : []
  
  // Bot list for router (use allBotsArray if available)
  const botList = allBotsArray.length > 0 ? [
    { name: 'all', display_name: 'All Bots', color: '#ffffff', mode: stats?.mode || 'sim' },
    ...allBotsArray
  ] : [
    { name: 'all', display_name: 'All Bots', color: '#ffffff', mode: stats?.mode || 'sim' },
    { name: 'bot1', display_name: 'Bot 1', color: '#00ff88', mode: stats?.mode || 'sim' },
    { name: 'bot2', display_name: 'Bot 2', color: '#3a8fd8', mode: stats?.mode || 'sim' }
  ]
  
  useEffect(()=>{
    if(stats && stats.capital) setReady(true)
  },[stats])
  
  if(!stats) {
    return (
      <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{fontFamily:'var(--mono)',color:'var(--text3)',fontSize:12}}>Connecting...</div>
      </div>
    )
  }
  
  if(!ready) return <SetupWizard onSetup={doSetup}/>
  
  return(
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>
      <Toast notify={notify} onDismiss={()=>{}} onResume={resumeGas}/>
      
      <header style={{height:26,background:'var(--bg1)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',padding:'0 10px',gap:6,flexShrink:0}}>
        <span style={{fontFamily:'var(--mono)',fontSize:11,fontWeight:700,color:'var(--green)',letterSpacing:'.1em'}}>
          POLY<span style={{color:'var(--text)'}}>BOT</span><span style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginLeft:2}}>v3</span>
        </span>
        <BotRouter 
          bots={botList} 
          currentBot={currentBot} 
          onSwitchBot={(name) => {
            setCurrentBot(name);
            window.location.href = name === 'all' ? '/dashboard' : `/dashboard/${name}`;
          }} 
        />
        <div style={{width:1,height:10,background:'var(--border)'}}/>
        <Dot on={connected}/><span style={{fontFamily:'var(--mono)',fontSize:'var(--fsxs)',color:connected?'var(--green)':'var(--red)'}}>{connected?'LIVE':'···'}</span>
        {stats&&<XTag t={stats.mode} c={stats.mode==='SIM'?'var(--amber)':'var(--green)'}/>}
        {(stats?.compound_tier??0)>0&&<XTag t={`T${stats.compound_tier}·$${stats.compound_bet}`} c="var(--green)"/>}
        {salary?.salary_count>0&&<XTag t={`💰${salary.salary_count}`} c="var(--gold)"/>}
        {gas?.status==='critical'&&<XTag t="GAS" c="var(--red)"/>}
        {gas?.status==='low'&&<XTag t="GAS" c="var(--amber)"/>}
        <div style={{marginLeft:'auto',display:'flex',gap:4}}>
          <button onClick={()=>setReady(false)} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--text3)',fontFamily:'var(--mono)',fontSize:'var(--fsxs)',padding:'2px 6px',borderRadius:'var(--r)'}}>RST</button>
        </div>
        {lastUpd&&<span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{lastUpd.toLocaleTimeString()}</span>}
      </header>
      
      <main style={{flex:1,padding:'6px 8px',display:'flex',flexDirection:'column',gap:6,overflowY:'auto'}}>
        {/* Combined dashboard for /dashboard */}
        {currentBot === 'all' && (
          <CombinedDashboard 
            bots={allBotsArray}
            stats={stats}
            positions={positions}
            markets={markets}
            config={config}
            gas={gas}
            salary={salary}
            history={history}
            log={log}
            btc5m={btc5m}
            connected={connected}
          />
        )}
        
        {/* Individual bot dashboard */}
        {currentBot !== 'all' && (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:4}}>
              <Stat label="Equity" value={usd(stats?.capital)} sub={`${usd(stats?.available)} + ${usd(stats?.locked)} locked`} color="var(--text)"/>
              <Stat label="PnL" value={signUsd(pnl)} sub={`${pct(stats?.roi_pct)} ROI`} color={isPos?'var(--green)':'var(--red)'}/>
              <Stat label="Win" value={pct(stats?.win_rate)} sub={`${stats?.wins??0}W ${stats?.losses??0}L`} color={stats?.win_rate>=60?'var(--green)':stats?.win_rate>=45?'var(--amber)':'var(--red)'}/>
              <Stat label="Daily" value={signUsd(stats?.daily_pnl??0)} color={(stats?.daily_pnl??0)>=0?'var(--green)':'var(--red)'}/>
              <Stat label="Gajian" value={usd(salary?.total_withdrawn)} color="var(--gold)"/>
              <Stat label="Open" value={stats?.open_count??0} color="var(--blue)"/>
              <Stat label="Tier" value={`T${stats?.compound_tier??0}`} color="var(--green)"/>
              <Stat label="Gas" value={`${gas?.tx_left??'—'}`} color={gas?.status==='ok'?'var(--text)':gas?.status==='low'?'var(--amber)':'var(--red)'}/>
            </div>
            
            {botName && (
              <WithdrawalPanel botName={botName} salary={salary} onWithdraw={async () => {}} />
            )}
            
            <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'4px 8px'}}>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:2}}>PnL Curve · {pnl>=0?'+':''}${pnl.toFixed(2)} ({pct(stats?.roi_pct)})</div>
              <Sparkline history={hist}/>
            </div>
            
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <MiniScanner markets={markets}/>
                <OpenPositions positions={positions}/>
                <HistoryPanel history={history}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <ActivityLog log={log}/>
                <BTC5mPanel data={btc5m}/>
                <HealthMonitor health={health}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <SalaryPanel salary={salary}/>
                <CompoundPanel stats={stats}/>
                <GasPanel gas={gas} onResume={resumeGas}/>
                <ConfigPanel config={config}/>
                <DemoModeToggle 
                  currentMode={stats?.mode || 'sim'} 
                  onSwitch={setMode}
                  disabled={!connected}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}