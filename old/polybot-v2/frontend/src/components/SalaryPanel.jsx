import { usd } from '../utils.js'

export function SalaryPanel({ salary, stats }) {
  if (!salary) return null
  const s = salary

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>

      {/* Progress card */}
      <div style={{background:'var(--bg2)',border:'1px solid rgba(200,168,32,.25)',borderRadius:'var(--r3)'}}>
        <div style={{padding:'4px 10px',borderBottom:'1px solid rgba(200,168,32,.15)',background:'var(--goldbg)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:'var(--fsxs)',color:'var(--gold)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>💰 Salary Engine</span>
          <span style={{fontSize:'var(--fsxs)',color:'var(--gold)',fontFamily:'var(--mono)'}}>{s.salary_count||0}x gajian · total {usd(s.total_withdrawn)}</span>
        </div>
        <div style={{padding:'10px 12px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:10}}>
            <div>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:2}}>Equity saat ini</div>
              <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:600,color:'var(--gold)'}}>{usd(s.current_equity)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:2}}>Next gajian</div>
              <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:600,color:'var(--gold)'}}>{usd(s.next_target)}</div>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)'}}>kurang {usd(s.to_next)}</div>
            </div>
          </div>
          <div style={{height:6,background:'var(--border2)',borderRadius:3,overflow:'hidden',marginBottom:4}}>
            <div style={{height:'100%',width:`${s.progress_pct||0}%`,background:'linear-gradient(90deg,rgba(200,168,32,.5),var(--gold))',borderRadius:3,transition:'width .8s'}}/>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fsxs)',fontFamily:'var(--mono)',color:'var(--text3)'}}>
            <span>${((s.next_target||100)-(s.threshold||100)).toFixed(0)}</span>
            <span style={{color:'var(--gold)'}}>{s.progress_pct||0}%</span>
            <span>{usd(s.next_target)}</span>
          </div>
          {/* Split preview */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginTop:10}}>
            <div style={{padding:'6px 8px',background:'var(--goldbg)',border:'1px solid rgba(200,168,32,.15)',borderRadius:'var(--r2)',textAlign:'center'}}>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:2}}>Jika gajian sekarang</div>
              <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600,color:'var(--gold)'}}>{usd(s.projected_withdraw)}</div>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)'}}>ditarik ({Math.round((s.withdraw_pct||.7)*100)}%)</div>
            </div>
            <div style={{padding:'6px 8px',background:'var(--gbg)',border:'1px solid rgba(0,200,122,.15)',borderRadius:'var(--r2)',textAlign:'center'}}>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginBottom:2}}>Modal lanjutan</div>
              <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600,color:'var(--green)'}}>{usd(s.projected_keep)}</div>
              <div style={{fontSize:'var(--fsxs)',color:'var(--text3)'}}>disimpan ({Math.round((s.keep_pct||.3)*100)}%)</div>
            </div>
          </div>
        </div>
      </div>

      {/* History table */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
        <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)',display:'flex',justifyContent:'space-between'}}>
          <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Riwayat Gajian</span>
          <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)'}}>{(s.events||[]).length} events</span>
        </div>
        {(!s.events||s.events.length===0)
          ? <div style={{padding:'12px',color:'var(--text3)',fontSize:'var(--fsxs)',fontFamily:'var(--mono)'}}>_ belum ada gajian · tunggu equity $100</div>
          : <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>
              {['Waktu','Equity','Ditarik (70%)','Disimpan (30%)','Next Target'].map(h=>(
                <th key={h} className="xls-th" style={{textAlign:'left'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {s.events.slice().reverse().map((e,i)=>(
                <tr key={i} className="xls-tr" style={{borderBottom:'1px solid var(--border)'}}>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text3)'}}>{e.time}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--gold)'}}>${Number(e.equity).toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--green)',fontWeight:600}}>${Number(e.withdrawn).toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--blue)'}}>${Number(e.kept).toFixed(2)}</td>
                  <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--text3)'}}>${e.next_target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>

      {/* Formula */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
        <div style={{padding:'4px 10px',borderBottom:'1px solid var(--border)',background:'var(--bg3)'}}>
          <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Formula</span>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <tbody>
            {[
              ['Trigger','Equity menyentuh $100, $200, $300, dst.'],
              ['Tarik','70% dari total equity'],
              ['Lanjut','30% jadi modal baru'],
              ['Tier','Compound tier reset sesuai modal baru'],
              ['Saran','Naikkan threshold ke $200/$500 untuk compound lebih agresif'],
            ].map(([k,v])=>(
              <tr key={k} className="xls-tr" style={{borderBottom:'1px solid var(--border)'}}>
                <td className="xls-td" style={{fontFamily:'var(--mono)',color:'var(--gold)',width:80,fontSize:'var(--fsxs)'}}>{k}</td>
                <td className="xls-td" style={{color:'var(--text2)'}}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
