export function Toast({ notify, onDismiss, onResume }) {
  if (!notify) return null
  const isCompound  = notify.type === 'compound'
  const isGasStop   = notify.type === 'gas_stop'
  const isGasWarn   = notify.type === 'gas_warn'
  const d = notify.data

  const color = isCompound ? '#00d68f' : isGasStop ? '#ff4560' : '#ffaa00'

  return (
    <div onClick={isGasStop ? undefined : onDismiss} style={{
      position:'fixed', top:60, right:16, zIndex:9999, width:300,
      background:'#111318', border:`1px solid ${color}`,
      borderLeft:`4px solid ${color}`, borderRadius:10,
      padding:'14px 16px', boxShadow:`0 0 24px ${color}22`,
      animation:'slideRight .3s ease', cursor: isGasStop?'default':'pointer',
    }}>
      {isCompound && <>
        <div style={{fontSize:10,color,fontFamily:'var(--mono)',marginBottom:4,letterSpacing:'.08em'}}>⬆ COMPOUND LEVEL UP</div>
        <div style={{fontSize:17,fontWeight:600,marginBottom:4}}>Tier {d.new_tier} — ${d.new_bet}/bet</div>
        <div style={{fontSize:11,color:'var(--text2)'}}>Capital: <span style={{color,fontFamily:'var(--mono)'}}>${Number(d.capital).toFixed(2)}</span> · was ${d.old_bet} → ${d.new_bet}</div>
        <div style={{fontSize:10,color:'var(--text3)',marginTop:3}}>Next tier at <span style={{fontFamily:'var(--mono)'}}>${d.next}</span></div>
      </>}
      {isGasWarn && <>
        <div style={{fontSize:10,color,fontFamily:'var(--mono)',marginBottom:4,letterSpacing:'.08em'}}>⚠ GAS MENIPIS</div>
        <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>{d.tx_left} transaksi tersisa</div>
        <div style={{fontSize:11,color:'var(--text2)'}}>POL tersisa: <span style={{color,fontFamily:'var(--mono)'}}>{Number(d.pol_left).toFixed(3)} POL</span></div>
        <div style={{fontSize:10,color:'var(--text3)',marginTop:3}}>Top-up segera untuk menghindari auto-stop</div>
      </>}
      {isGasStop && <>
        <div style={{fontSize:10,color,fontFamily:'var(--mono)',marginBottom:4,letterSpacing:'.08em'}}>🛑 BOT AUTO-STOP</div>
        <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>Gas tidak cukup ({d.tx_left} tx)</div>
        <div style={{fontSize:11,color:'var(--text2)',marginBottom:8}}>Bot berhenti otomatis. Top-up POL lalu resume.</div>
        <button onClick={onResume} style={{
          width:'100%', padding:'7px 0', background:color+'22',
          border:`1px solid ${color}`, borderRadius:6, color,
          fontFamily:'var(--mono)', fontSize:11, letterSpacing:'.06em',
        }}>RESUME BOT</button>
      </>}
    </div>
  )
}
