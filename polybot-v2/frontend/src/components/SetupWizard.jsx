import { useState } from 'react'

export function SetupWizard({ onSetup }) {
  const [usdc,setUsdc]=useState('10')
  const [pol, setPol] =useState('11')
  const [mode,setMode]=useState('sim')
  const [busy,setBusy]=useState(false)

  const polNum = parseFloat(pol)||0
  const txEst  = Math.floor((polNum*0.5)/(0.02/0.40))

  const go = async()=>{ setBusy(true); await onSetup(parseFloat(usdc)||10,polNum,mode); setBusy(false) }

  const R = ({label,children,hint}) => (
    <div style={{display:'grid',gridTemplateColumns:'110px 1fr',gap:8,alignItems:'center',marginBottom:8}}>
      <label style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em',textAlign:'right'}}>{label}</label>
      <div>{children}{hint&&<div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:2,fontFamily:'var(--mono)'}}>{hint}</div>}</div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:420}}>
        <div style={{textAlign:'center',marginBottom:20}}>
          <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:700,color:'var(--green)',letterSpacing:'.12em'}}>
            POLY<span style={{color:'var(--text3)'}}>BOT</span><span style={{fontSize:10,color:'var(--text3)',marginLeft:6}}>v3</span>
          </div>
          <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:4}}>Forward-test · real market timing</div>
        </div>

        <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)'}}>
          {/* header row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr',background:'var(--bg3)',borderBottom:'1px solid var(--border)',padding:'5px 12px'}}>
            <span style={{fontSize:'var(--fsxs)',color:'var(--text3)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.06em'}}>Setup Modal & Gas</span>
          </div>

          <div style={{padding:'14px 16px'}}>
            <R label="USDC Modal" hint={`min bet $1.00 · Polymarket floor`}>
              <input type="number" min="1" step="1" value={usdc} onChange={e=>setUsdc(e.target.value)} style={{width:'100%'}}/>
            </R>
            <R label="POL (gas)" hint={`50% reserve → ~${txEst} TX usable · $0.02/tx`}>
              <input type="number" min="0.5" step="0.1" value={pol} onChange={e=>setPol(e.target.value)} style={{width:'100%'}}/>
            </R>
            <R label="Mode">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {[{v:'sim',l:'SIM',d:'Virtual · timing real'},{v:'real',l:'REAL',d:'Order nyata ke Polymarket'}].map(({v,l,d})=>(
                  <div key={v} onClick={()=>setMode(v)} style={{
                    padding:'7px 10px',borderRadius:'var(--r2)',cursor:'pointer',
                    border:`1px solid ${mode===v?'var(--blue)':'var(--border)'}`,
                    background:mode===v?'var(--bbg)':'var(--bg3)',
                  }}>
                    <div style={{fontSize:'var(--fss)',fontWeight:500,color:mode===v?'var(--blue)':'var(--text)',fontFamily:'var(--mono)'}}>{l}</div>
                    <div style={{fontSize:'var(--fsxs)',color:'var(--text3)',marginTop:2}}>{d}</div>
                  </div>
                ))}
              </div>
            </R>

            {/* Salary info - compact */}
            <div style={{margin:'10px 0',padding:'7px 10px',background:'var(--goldbg)',border:'1px solid rgba(200,168,32,.2)',borderRadius:'var(--r2)',fontSize:'var(--fsxs)',color:'var(--text2)',fontFamily:'var(--mono)',lineHeight:1.7}}>
              💰 SALARY · every $100 → tarik 70% + lanjut 30%
            </div>

            {mode==='real'&&(
              <div style={{marginBottom:10,padding:'7px 10px',background:'var(--rbg)',border:'1px solid rgba(240,64,96,.3)',borderRadius:'var(--r2)',fontSize:'var(--fsxs)',color:'var(--red)',fontFamily:'var(--mono)',lineHeight:1.7}}>
                ⚠ Butuh MetaMask (EVM) · BUKAN Phantom/Solana
              </div>
            )}

            <button onClick={go} disabled={busy} style={{
              width:'100%',padding:'8px',marginTop:6,
              background:busy?'var(--bg4)':'var(--green)',border:'none',
              borderRadius:'var(--r2)',color:busy?'var(--text2)':'#000',
              fontWeight:600,fontSize:'var(--fss)',fontFamily:'var(--mono)',letterSpacing:'.06em',
            }}>
              {busy?'STARTING...`':`START ${mode.toUpperCase()} — $${usdc} / ${pol} POL`}
            </button>
          </div>
        </div>

        <div style={{textAlign:'center',marginTop:10,fontSize:'var(--fsxs)',color:'var(--text3)'}}>
          BTC 5m · Soccer · Crypto daily · max resolve 7d
        </div>
      </div>
    </div>
  )
}
