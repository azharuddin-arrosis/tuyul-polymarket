import { usd, f2 } from '../utils.js'

export function GasPanel({ gas, onResume }) {
  if (!gas) return null
  const pct  = Math.min(100, ((gas.pol_total - gas.pol_left) / gas.pol_total * 100))
  const barColor = gas.status==='critical'?'#ff4560':gas.status==='low'?'#ffaa00':'#00d68f'

  return (
    <div style={{
      background:'var(--bg2)', border:`1px solid ${gas.status==='ok'?'var(--border)':barColor+'55'}`,
      borderRadius:'var(--r3)', padding:'14px 16px',
      boxShadow: gas.status!=='ok' ? `0 0 12px ${barColor}22` : 'none',
    }}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
        <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>Gas Budget</span>
        <span style={{
          fontSize:10,fontFamily:'var(--mono)',padding:'2px 8px',borderRadius:4,
          background:barColor+'22', color:barColor, border:`1px solid ${barColor}44`,
        }}>{gas.status.toUpperCase()}</span>
      </div>

      {/* POL bar */}
      <div style={{height:6,background:'var(--border2)',borderRadius:3,overflow:'hidden',marginBottom:8}}>
        <div style={{height:'100%',width:`${pct}%`,background:barColor,borderRadius:3,transition:'width .5s'}}/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
        {[
          ['POL tersisa', `${f2(gas.pol_left)} / ${gas.pol_total}`],
          ['TX tersisa',  gas.tx_left],
          ['Gas dipakai', usd(gas.gas_usd)],
          ['Per tx',      `~$${(0.02).toFixed(3)}`],
        ].map(([k,v])=>(
          <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'4px 0',borderBottom:'1px solid var(--border)'}}>
            <span style={{color:'var(--text3)'}}>{k}</span>
            <span style={{fontFamily:'var(--mono)',color: k==='TX tersisa'&&gas.tx_left<=10?barColor:'var(--text)'}}>{v}</span>
          </div>
        ))}
      </div>

      {/* alert thresholds */}
      <div style={{fontSize:10,color:'var(--text3)',display:'flex',gap:12,marginBottom:8}}>
        <span>⚠ Alert: &lt;{gas.alert_tx} tx</span>
        <span>🛑 Stop: &lt;{gas.stop_tx} tx</span>
        <span>🔒 Reserve: {gas.reserve_pol} POL</span>
      </div>

      {gas.paused && (
        <button onClick={onResume} style={{
          width:'100%',padding:'8px',background:'#ff456022',
          border:'1px solid #ff4560',borderRadius:6,
          color:'#ff4560',fontFamily:'var(--mono)',fontSize:11,letterSpacing:'.06em',
        }}>BOT PAUSED — KLIK RESUME SETELAH TOP-UP POL</button>
      )}
    </div>
  )
}
