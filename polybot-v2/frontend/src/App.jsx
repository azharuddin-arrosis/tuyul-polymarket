import { useState, useEffect } from 'react'
import { usePolyBot } from './hooks/usePolyBot.js'
import { Toast } from './components/Toast.jsx'
import { GasPanel } from './components/GasPanel.jsx'
import { MarketTable } from './components/MarketTable.jsx'
import { CompoundPanel } from './components/CompoundPanel.jsx'
import { ActivityLog } from './components/ActivityLog.jsx'
import { usd, pct, signUsd, CAT_COLOR } from './utils.js'

/* ─── tiny shared UI ─────────────────────────────── */
function Dot({ on }) {
  return <span style={{
    display:'inline-block',width:6,height:6,borderRadius:'50%',marginRight:5,
    background: on?'var(--green)':'var(--red)',
    boxShadow: on?'0 0 5px var(--green)':'0 0 5px var(--red)',
    animation: on?'pulse 2s infinite':'none',
  }}/>
}
function Badge({ text, color }) {
  return <span style={{
    fontSize:9,fontFamily:'var(--mono)',padding:'2px 8px',borderRadius:4,letterSpacing:'.08em',
    background:color+'22',color,border:`1px solid ${color}44`,
  }}>{text}</span>
}
function StatCard({ label, value, sub, color, mono }) {
  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'12px 14px'}}>
      <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:2}}>{label}</div>
      <div style={{fontSize:20,fontWeight:600,color:color||'var(--text)',fontFamily:mono?'var(--mono)':'var(--sans)'}}>{value}</div>
      {sub && <div style={{fontSize:10,color:'var(--text3)',marginTop:1}}>{sub}</div>}
    </div>
  )
}
function PnlSparkline({ history }) {
  if (history.length < 2) return null
  const min = Math.min(...history.map(h=>h.v))
  const max = Math.max(...history.map(h=>h.v))
  const range = max - min || 1
  const W=200, H=40, pad=4
  const pts = history.map((h,i)=>{
    const x = pad + (i/(history.length-1))*(W-2*pad)
    const y = H-pad - ((h.v-min)/range)*(H-2*pad)
    return `${x},${y}`
  }).join(' ')
  const last = history[history.length-1].v
  const color = last>=0?'#00d68f':'#ff4560'
  return (
    <svg width={W} height={H} style={{display:'block'}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

/* ─── PnL history hook ────────────────────────────── */
function usePnlHistory(capital, initial) {
  const [hist, setHist] = useState([{t:0,v:0}])
  useEffect(()=>{
    if (capital==null) return
    setHist(h=>[...h,{t:h.length,v:Number((capital-(initial||10)).toFixed(4))}].slice(-80))
  },[capital])
  return hist
}

/* ─── Real-mode info panel ─────────────────────────── */
function RealModeInfo({ config }) {
  const req = config?.real_requirements
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
      {/* vs sim */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
        <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>SIM vs REAL — Perbedaan</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead>
            <tr style={{background:'var(--bg3)'}}>
              {['Aspek','SIM','REAL'].map(h=><th key={h} style={{padding:'7px 12px',textAlign:'left',fontSize:9,fontFamily:'var(--mono)',color:'var(--text3)',fontWeight:400,letterSpacing:'.06em',borderBottom:'1px solid var(--border)'}}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {[
              ['Kecepatan gerak','Auto-resolve 25-90s','Tergantung market resolusi (menit-minggu)'],
              ['Data market','Real dari Gamma API','Real dari Gamma API (sama)'],
              ['Order eksekusi','Virtual, tidak dikirim','Kirim ke CLOB via EIP-712'],
              ['Gas','Simulasi counter','POL nyata dari wallet'],
              ['PnL','Virtual (tidak nyata)','USDC nyata di wallet'],
              ['API key','Tidak perlu','Wajib: POLY_API_KEY + SECRET'],
              ['Private key','Tidak perlu','EVM private key (bukan Phantom)'],
              ['USDC','Tidak perlu','Harus ada di Polygon wallet'],
              ['Risiko','Nol','Nyata — bisa rugi'],
            ].map(([a,s,r])=>(
              <tr key={a} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'7px 12px',color:'var(--text2)'}}>{a}</td>
                <td style={{padding:'7px 12px',fontFamily:'var(--mono)',fontSize:10,color:'var(--text3)'}}>{s}</td>
                <td style={{padding:'7px 12px',fontFamily:'var(--mono)',fontSize:10,color:'var(--amber)'}}>{r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* requirements */}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{background:'rgba(255,69,96,.06)',border:'1px solid rgba(255,69,96,.3)',borderRadius:'var(--r3)',padding:'14px 16px'}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--red)',marginBottom:8}}>⚠ PENTING: Phantom Tidak Kompatibel</div>
          <div style={{fontSize:11,color:'var(--text2)',lineHeight:1.7}}>
            <strong style={{color:'var(--text)'}}>Phantom</strong> adalah wallet Solana. Polymarket berjalan di <strong style={{color:'var(--text)'}}>Polygon (EVM/Ethereum-compatible)</strong>.<br/><br/>
            Kamu butuh wallet EVM seperti <strong style={{color:'var(--green)'}}>MetaMask</strong> atau export private key ke format EVM.<br/><br/>
            Phantom wallet tidak bisa digunakan untuk sign order EIP-712 di Polygon.
          </div>
        </div>

        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
          <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>Requirements untuk REAL mode</div>
          <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:6}}>
            {[
              ['1. Wallet','MetaMask atau wallet EVM (bukan Phantom)'],
              ['2. Private Key','EVM private key dari MetaMask → Export Account'],
              ['3. POLY_API_KEY','Dari polymarket.com/profile > API Keys'],
              ['4. POLY_SECRET','Didapat bersamaan dengan API Key'],
              ['5. POLY_PASSPHRASE','Set saat buat API Key'],
              ['6. USDC on Polygon','Deposit USDC ke alamat Polygon wallet kamu'],
              ['7. POL for gas','Min 5 POL di wallet yang sama untuk gas fee'],
              ['8. .env update','BOT_MODE=real + isi semua POLY_* vars'],
            ].map(([k,v])=>(
              <div key={k} style={{display:'flex',gap:12,padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:11}}>
                <span style={{fontFamily:'var(--mono)',color:'var(--green)',minWidth:70,fontSize:10}}>{k}</span>
                <span style={{color:'var(--text2)'}}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'12px 14px'}}>
          <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.07em'}}>Checklist sebelum GO LIVE</div>
          {['Min 50 sim trades selesai','Win rate sim > 55%','USDC & POL sudah ada di wallet','API key sudah di-generate','BOT_MODE=real di .env','Test dulu dengan bet $0.50'].map(item=>(
            <div key={item} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',fontSize:11,color:'var(--text2)'}}>
              <span style={{width:12,height:12,border:'1px solid var(--border2)',borderRadius:3,display:'inline-block',flexShrink:0}}/>
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── CONFIG TABLE ─────────────────────────────────── */
function ConfigTable({ config }) {
  if (!config) return null
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
      {[
        {title:'Bot Config',rows:[['Mode',config.mode],['Capital',`$${config.usdc_capital}`],['POL',`${config.pol_balance}`],['Scan',`${config.scan_sec}s`]]},
        {title:'Risk Config',rows:[['Min EV',`${(config.min_ev*100).toFixed(0)}%`],['Prob Range',`${(config.prob_min*100).toFixed(0)}–${(config.prob_max*100).toFixed(0)}%`],['Daily Loss',`$${config.daily_loss}`],['Max Open',config.max_open],['Max Bet',`$${config.max_bet}`],['Min Bet',`$${config.min_bet}`]]},
        {title:'Compound',rows:[['Base',`$${config.compound_base}`],['Step',`$${config.compound_step}`],['Increment',`+$${config.compound_inc}/tier`],['Max Bet',`$${config.compound_max_bet}`]]},
      ].map(({title,rows})=>(
        <div key={title} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
          <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>{title}</div>
          <div style={{padding:'10px 14px',display:'flex',flexDirection:'column',gap:6}}>
            {rows.map(([k,v])=>(
              <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'4px 0',borderBottom:'1px solid var(--border)'}}>
                <span style={{color:'var(--text3)'}}>{k}</span>
                <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── TABS ─────────────────────────────────────────── */
const TABS = ['overview','markets','compound','history','config','real']

/* ─── MAIN APP ─────────────────────────────────────── */
export default function App() {
  const { stats, positions, log, markets, config, gas, connected, lastUpd, notify, resumeGas } = usePolyBot()
  const [tab, setTab] = useState('overview')
  const pnlHist = usePnlHistory(stats?.capital, stats?.initial)
  const pnl  = stats?.pnl ?? 0
  const isPos = pnl >= 0

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>
      <Toast notify={notify} onDismiss={()=>{}} onResume={resumeGas}/>

      {/* ─── HEADER ─── */}
      <header style={{
        height:48,background:'var(--bg1)',borderBottom:'1px solid var(--border)',
        display:'flex',alignItems:'center',padding:'0 20px',gap:16,
        position:'sticky',top:0,zIndex:100,flexShrink:0,
      }}>
        <span style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'var(--green)',letterSpacing:'.1em'}}>
          POLY<span style={{color:'var(--text3)'}}>BOT</span>
        </span>
        <div style={{width:1,height:18,background:'var(--border)'}}/>
        <div style={{display:'flex',alignItems:'center'}}>
          <Dot on={connected}/>
          <span style={{fontFamily:'var(--mono)',fontSize:10,color:connected?'var(--green)':'var(--red)'}}>{connected?'LIVE':'RECONNECTING'}</span>
        </div>
        {stats && <Badge text={stats.mode} color={stats.mode==='SIM'?'var(--amber)':'var(--green)'}/>}
        {(stats?.compound_tier??0)>0 && (
          <Badge text={`TIER ${stats.compound_tier} · $${stats.compound_bet}/bet`} color="var(--green)"/>
        )}
        {gas?.status==='critical' && <Badge text="⛽ GAS CRITICAL" color="var(--red)"/>}
        {gas?.status==='low'      && <Badge text="⚠ GAS LOW" color="var(--amber)"/>}
        {gas?.paused              && <Badge text="🛑 BOT PAUSED" color="var(--red)"/>}

        <div style={{marginLeft:'auto',display:'flex',gap:2}}>
          {TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              background:tab===t?'var(--bg3)':'transparent',
              border:`1px solid ${tab===t?'var(--border2)':'transparent'}`,
              color:tab===t?'var(--text)':'var(--text3)',
              fontFamily:'var(--mono)',fontSize:9,padding:'4px 10px',
              borderRadius:'var(--r)',textTransform:'uppercase',letterSpacing:'.07em',
              transition:'all .15s',
            }}>{t}</button>
          ))}
        </div>
        {lastUpd && <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)'}}>{lastUpd.toLocaleTimeString()}</span>}
      </header>

      {/* ─── BODY ─── */}
      <main style={{flex:1,padding:'16px 20px',maxWidth:1600,width:'100%',margin:'0 auto',display:'flex',flexDirection:'column',gap:12}}>

        {/* ── OVERVIEW ── */}
        {tab==='overview' && (<>
          {/* stat row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}>
            <StatCard label="Capital"    value={usd(stats?.capital)} sub={`start ${usd(stats?.initial)}`} mono/>
            <StatCard label="Total PnL"  value={`${pnl>=0?'+':''}${usd(pnl)}`} sub={`${pct(stats?.roi_pct)} ROI`} color={isPos?'var(--green)':'var(--red)'} mono/>
            <StatCard label="Win Rate"   value={pct(stats?.win_rate)} sub={`${stats?.wins??0}W / ${stats?.losses??0}L`} color={stats?.win_rate>=60?'var(--green)':stats?.win_rate>=45?'var(--amber)':'var(--red)'}/>
            <StatCard label="Compound"   value={`T${stats?.compound_tier??0}`} sub={`$${stats?.compound_bet??2}/bet`} color="var(--green)" mono/>
            <StatCard label="Open"       value={stats?.open_count??0} sub={`max ${config?.max_open??5}`} color="var(--blue)"/>
            <StatCard label="Daily PnL"  value={`${(stats?.daily_pnl??0)>=0?'+':''}${usd(stats?.daily_pnl)}`} color={(stats?.daily_pnl??0)>=0?'var(--green)':'var(--red)'} mono/>
            <StatCard label="Scans"      value={(stats?.scan_count??0).toLocaleString()} sub={`${stats?.signals_found??0} signals`}/>
            <StatCard label="Gas TX left" value={gas?.tx_left??'—'} sub={`${(gas?.pol_left??0).toFixed(2)} POL`} color={gas?.status==='ok'?'var(--green)':gas?.status==='low'?'var(--amber)':'var(--red)'} mono/>
          </div>

          {/* chart + gas + positions */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:12}}>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {/* PnL sparkline */}
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'14px'}}>
                <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:10,textTransform:'uppercase',letterSpacing:'.07em'}}>PnL Curve</div>
                <PnlSparkline history={pnlHist}/>
              </div>
              {/* open positions mini table */}
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
                <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>
                  Posisi Terbuka ({positions.length})
                </div>
                {positions.length===0
                  ? <div style={{padding:'16px 14px',color:'var(--text3)',fontSize:11,fontFamily:'var(--mono)'}}>_ tidak ada posisi terbuka</div>
                  : <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                    <thead><tr style={{background:'var(--bg3)'}}>
                      {['ID','Market','Side','Price','Size','EV','Strat','Cat'].map(h=>(
                        <th key={h} style={{padding:'5px 10px',textAlign:'left',fontSize:9,fontFamily:'var(--mono)',color:'var(--text3)',fontWeight:400,letterSpacing:'.06em',textTransform:'uppercase',borderBottom:'1px solid var(--border2)'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {positions.map((p,i)=>(
                        <tr key={p.id} style={{borderBottom:'1px solid var(--border)',background:i%2===0?'transparent':'rgba(255,255,255,.01)'}}>
                          <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:10,color:'var(--text3)'}}>{p.id}</td>
                          <td style={{padding:'6px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.question}>{p.question}</td>
                          <td style={{padding:'6px 10px'}}>
                            <span style={{fontSize:9,fontFamily:'var(--mono)',padding:'1px 5px',borderRadius:3,background:(p.outcome==='YES'?'#00d68f':'#ffaa00')+'22',color:p.outcome==='YES'?'var(--green)':'var(--amber)'}}>{p.outcome}</span>
                          </td>
                          <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:'var(--text2)'}}>{p.price?.toFixed(3)}</td>
                          <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:'var(--text)'}}>${p.size?.toFixed(2)}</td>
                          <td style={{padding:'6px 10px',fontFamily:'var(--mono)',color:p.ev>0.10?'var(--green)':'var(--amber)'}}>{(p.ev*100).toFixed(0)}%</td>
                          <td style={{padding:'6px 10px'}}>
                            <span style={{fontSize:9,fontFamily:'var(--mono)',color:'var(--blue)'}}>{p.strategy?.replace('_','-')}</span>
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <span style={{fontSize:9,fontFamily:'var(--mono)',color:CAT_COLOR[p.category]||'#888'}}>{p.category}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              </div>
            </div>

            {/* right sidebar */}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <GasPanel gas={gas} onResume={resumeGas}/>
              {/* compound mini */}
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'14px'}}>
                <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:10,textTransform:'uppercase',letterSpacing:'.07em'}}>Compound</div>
                {[['Tier',`T${stats?.compound_tier??0}`],['Max Bet',`$${stats?.compound_bet??2}`],['Next',`$${stats?.compound_next??20}`]].map(([k,v])=>(
                  <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:5}}>
                    <span style={{color:'var(--text2)'}}>{k}</span>
                    <span style={{fontFamily:'var(--mono)',color:k==='Next'?'var(--amber)':'var(--green)',fontWeight:600}}>{v}</span>
                  </div>
                ))}
                <div style={{height:4,background:'var(--border2)',borderRadius:2,overflow:'hidden',marginTop:8}}>
                  <div style={{height:'100%',width:`${stats?.compound_prog??0}%`,background:'linear-gradient(90deg,var(--amber),var(--green))',transition:'width .6s ease',borderRadius:2}}/>
                </div>
                <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginTop:3,textAlign:'right'}}>{stats?.compound_prog??0}%</div>
              </div>
            </div>
          </div>

          <ActivityLog log={log} maxH="260px"/>
        </>)}

        {/* ── MARKETS (Excel table) ── */}
        {tab==='markets' && <MarketTable markets={markets}/>}

        {/* ── COMPOUND ── */}
        {tab==='compound' && <CompoundPanel stats={stats}/>}

        {/* ── HISTORY ── */}
        {tab==='history' && <ActivityLog log={log.filter(e=>['CLOSE','COMPOUND_UP','GAS_WARN','GAS_STOP'].includes(e.event))} maxH="calc(100vh - 120px)"/>}

        {/* ── CONFIG ── */}
        {tab==='config' && <ConfigTable config={config}/>}

        {/* ── REAL INFO ── */}
        {tab==='real' && <RealModeInfo config={config}/>}

      </main>
    </div>
  )
}
