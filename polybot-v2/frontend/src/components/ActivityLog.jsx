import { STRAT_COLOR } from '../utils.js'

const EVENT_ICON = {
  OPEN:'▲', CLOSE_WON:'✓', CLOSE_LOST:'✗', REJECTED:'–',
  COMPOUND_UP:'⬆', GAS_WARN:'⚠', GAS_STOP:'🛑', GAS_RESUME:'▶',
}

function Tag({ text, color }) {
  return <span style={{fontSize:9,fontFamily:'var(--mono)',padding:'1px 5px',borderRadius:3,background:color+'22',color,border:`1px solid ${color}44`}}>{text}</span>
}

export function ActivityLog({ log, maxH='280px' }) {
  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden'}}>
      <div style={{padding:'9px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',background:'var(--bg3)'}}>
        <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>Activity Log</span>
        <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>{log.length} entries</span>
      </div>
      <div style={{maxHeight:maxH,overflowY:'auto'}}>
        {log.length===0
          ? <div style={{padding:'16px 14px',color:'var(--text3)',fontSize:11,fontFamily:'var(--mono)'}}>_ menunggu sinyal pertama...</div>
          : log.map((e,i)=>{
            const isOpen     = e.event==='OPEN'
            const isClose    = e.event==='CLOSE'
            const won        = e.result==='won'
            const isCompound = e.event==='COMPOUND_UP'
            const isGasWarn  = e.event==='GAS_WARN'
            const isGasStop  = e.event==='GAS_STOP'

            const iconKey = isClose?(won?'CLOSE_WON':'CLOSE_LOST'):e.event
            const icon    = EVENT_ICON[iconKey] || '·'
            const color   = isOpen?'var(--blue)':isClose?(won?'var(--green)':'var(--red)'):
                            isCompound?'var(--green)':isGasStop?'var(--red)':isGasWarn?'var(--amber)':'var(--text3)'

            return (
              <div key={i} style={{
                display:'grid', gridTemplateColumns:'30px 58px 100px 1fr auto',
                alignItems:'center', gap:6, padding:'6px 14px',
                borderBottom:'1px solid var(--border)',
                background: isCompound?'rgba(0,214,143,.04)':isGasStop?'rgba(255,69,96,.04)':
                            i%2===0?'transparent':'rgba(255,255,255,.01)',
                animation:'fadeUp .2s ease',
              }}>
                <span style={{fontFamily:'var(--mono)',fontSize:12,color,textAlign:'center'}}>{icon}</span>
                <span style={{fontFamily:'var(--mono)',fontSize:9,color:'var(--text3)'}}>{e.time}</span>
                <span style={{fontFamily:'var(--mono)',fontSize:9,color,letterSpacing:'.04em'}}>{e.event}</span>
                <span style={{fontSize:11,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {isOpen      && `${e.id} · ${e.question||''}`}
                  {isClose     && `${e.id} · ${e.result?.toUpperCase()} · PnL ${Number(e.pnl)>=0?'+':''}$${Math.abs(Number(e.pnl)).toFixed(3)}`}
                  {isCompound  && `Tier ${e.tier} — max bet sekarang $${e.new_bet}/trade`}
                  {isGasWarn   && (e.message||`Gas menipis: ${e.tx_left} tx tersisa`)}
                  {isGasStop   && (e.message||'Auto-stop: gas tidak cukup')}
                  {e.event==='GAS_RESUME' && 'Bot dilanjutkan setelah gas top-up'}
                  {e.event==='REJECTED'   && (e.reason||'')}
                </span>
                <div style={{display:'flex',gap:4}}>
                  {isOpen     && <Tag text={(e.strategy||'').replace('_','-')} color={STRAT_COLOR[e.strategy]||'#888'}/>}
                  {isClose    && <span style={{fontFamily:'var(--mono)',fontSize:10,color:won?'var(--green)':'var(--red)',whiteSpace:'nowrap'}}>{won?'+':''}{Number(e.pnl)>=0?'':'-'}${Math.abs(Number(e.pnl)).toFixed(2)}</span>}
                  {isCompound && <Tag text={`T${e.tier}`} color="var(--green)"/>}
                  {isGasWarn  && <Tag text="WARN" color="var(--amber)"/>}
                  {isGasStop  && <Tag text="STOP" color="var(--red)"/>}
                </div>
              </div>
            )
          })
        }
      </div>
    </div>
  )
}
