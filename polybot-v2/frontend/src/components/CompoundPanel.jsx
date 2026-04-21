export function CompoundPanel({ stats }) {
  if (!stats) return null
  const t    = stats.compound_tier ?? 0
  const bet  = stats.compound_bet  ?? 2
  const next = stats.compound_next ?? 20
  const prog = stats.compound_prog ?? 0
  const evts = stats.compound_events ?? []

  const tiers = []
  const base=20, step=20
  for (let i=0;i<=10;i++) {
    const cf = i===0?0:base+(i-1)*step
    const ct = i===0?base:base+i*step
    const mb = i===0?2:i
    tiers.push({i,cf,ct,mb,active:t===i,done:stats.capital>=ct})
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* summary */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div>
            <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:3}}>Compound Engine</div>
            <div style={{fontSize:22,fontWeight:600,color:'var(--green)',fontFamily:'var(--mono)'}}>
              Tier {t} <span style={{fontSize:14,color:'var(--text2)'}}>— ${bet}/bet</span>
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10,color:'var(--text3)',marginBottom:2}}>next tier at</div>
            <div style={{fontFamily:'var(--mono)',fontSize:18,color:'var(--amber)'}}>${next}</div>
            <div style={{fontSize:10,color:'var(--text3)'}}>perlu ${(next-Number(stats.capital)).toFixed(2)} lagi</div>
          </div>
        </div>

        {/* progress bar */}
        <div style={{marginBottom:4,display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>
          <span>progress ke tier {t+1}</span>
          <span style={{color:'var(--amber)'}}>{prog}%</span>
        </div>
        <div style={{height:6,background:'var(--border2)',borderRadius:3,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${prog}%`,background:'linear-gradient(90deg,var(--amber),var(--green))',borderRadius:3,transition:'width .6s ease'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>
          <span>${Number(stats.capital).toFixed(2)}</span>
          <span>${next}</span>
        </div>
      </div>

      {/* tier table */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
        <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>
          Tier Table
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr style={{background:'var(--bg3)'}}>
              {['Tier','Capital Range','Max Bet per Trade','Status'].map(h=>(
                <th key={h} style={{padding:'7px 14px',textAlign:'left',fontSize:9,fontFamily:'var(--mono)',color:'var(--text3)',fontWeight:400,letterSpacing:'.07em',textTransform:'uppercase',borderBottom:'1px solid var(--border2)'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map(row=>(
              <tr key={row.i} style={{
                borderBottom:'1px solid var(--border)',
                background: row.active ? 'rgba(0,214,143,.06)' : 'transparent',
              }}>
                <td style={{padding:'8px 14px',fontFamily:'var(--mono)',fontSize:12,color:row.active?'var(--green)':row.done?'var(--text3)':'var(--text2)',fontWeight:row.active?700:400}}>
                  {row.i===0?'PRE':row.i}
                </td>
                <td style={{padding:'8px 14px',fontFamily:'var(--mono)',fontSize:11,color:'var(--text2)'}}>
                  ${row.cf} — ${row.ct}
                </td>
                <td style={{padding:'8px 14px'}}>
                  <span style={{
                    fontFamily:'var(--mono)',fontSize:13,fontWeight:600,
                    color: row.active?'var(--green)':row.done?'var(--text3)':'var(--text)',
                  }}>${row.mb}</span>
                  {row.active && <span style={{marginLeft:8,fontSize:10,color:'var(--green)',background:'rgba(0,214,143,.12)',padding:'1px 7px',borderRadius:3,fontFamily:'var(--mono)'}}>AKTIF</span>}
                </td>
                <td style={{padding:'8px 14px'}}>
                  {row.active ? (
                    <span style={{fontSize:10,color:'var(--green)',fontFamily:'var(--mono)'}}>✓ current</span>
                  ) : row.done ? (
                    <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>✓ passed</span>
                  ) : (
                    <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>locked</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* level-up history */}
      {evts.length>0 && (
        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
          <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>
            Level-up History
          </div>
          {evts.slice().reverse().map((e,i)=>(
            <div key={i} style={{display:'flex',gap:16,padding:'8px 14px',borderBottom:'1px solid var(--border)',fontSize:11,alignItems:'center'}}>
              <span style={{fontFamily:'var(--mono)',color:'var(--green)',minWidth:60}}>↑ Tier {e.new_tier}</span>
              <span style={{color:'var(--text2)'}}>Bet: <span style={{fontFamily:'var(--mono)'}}>${e.old_bet} → ${e.new_bet}</span></span>
              <span style={{color:'var(--text2)'}}>Capital: <span style={{fontFamily:'var(--mono)',color:'var(--green)'}}>${Number(e.capital).toFixed(2)}</span></span>
              <span style={{color:'var(--text3)',marginLeft:'auto',fontFamily:'var(--mono)',fontSize:10}}>{e.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
