import { useState, useMemo } from 'react'
import { usd, pct, CAT_COLOR, STRAT_COLOR, STRAT_LABEL } from '../utils.js'

const COLS = [
  { key:'category',   label:'Kategori',   w:90  },
  { key:'question',   label:'Market',     w:260 },
  { key:'yes_price',  label:'YES',        w:60  },
  { key:'no_price',   label:'NO',         w:60  },
  { key:'spread',     label:'Spread',     w:60  },
  { key:'volume',     label:'Volume',     w:90  },
  { key:'signal',     label:'Signal',     w:90  },
  { key:'outcome',    label:'Side',       w:60  },
  { key:'ev',         label:'EV',         w:60  },
  { key:'true_prob',  label:'True Prob',  w:80  },
  { key:'fee',        label:'Fee',        w:55  },
]

function Tag({ text, color }) {
  return (
    <span style={{
      fontSize:9, fontFamily:'var(--mono)', padding:'1px 6px',
      borderRadius:3, background:color+'22', color, border:`1px solid ${color}44`,
      letterSpacing:'.05em', whiteSpace:'nowrap',
    }}>{text}</span>
  )
}

export function MarketTable({ markets }) {
  const [sort,  setSort]  = useState({key:'volume',dir:-1})
  const [cat,   setCat]   = useState('all')
  const [sigF,  setSigF]  = useState('all')
  const [search,setSearch]= useState('')
  const [selectedMarket, setSelectedMarket] = useState(null)

  const cats = useMemo(() => ['all',...new Set(markets.map(m=>m.category).filter(Boolean))], [markets])

  const rows = useMemo(() => {
    let r = [...markets]
    if (cat !== 'all')  r = r.filter(m=>m.category===cat)
    if (sigF!== 'all')  r = r.filter(m=>m.signal===sigF || (sigF==='signal'&&m.signal!=='—'))
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(m=>m.question.toLowerCase().includes(q)||m.category.includes(q))
    }
    r.sort((a,b)=> {
      const av=a[sort.key]??0, bv=b[sort.key]??0
      return typeof av==='string' ? av.localeCompare(bv)*sort.dir : (av-bv)*sort.dir
    })
    return r
  }, [markets, cat, sigF, search, sort])

  const toggle = key => setSort(s=>s.key===key?{key,dir:-s.dir}:{key,dir:-1})
  const arrow  = key => sort.key===key ? (sort.dir>0?'↑':'↓') : ''

  // Build a map from market question to its market_id for links
  const marketUrl = row => row.id ? `https://polymarket.com/event/${row.id}` : null

  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
      {/* market detail modal */}
      {selectedMarket && (
        <div style={{
          position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',
          background:'rgba(0,0,0,.7)',
        }} onClick={()=>setSelectedMarket(null)}>
          <div style={{
            background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',
            padding:'20px 24px',minWidth:400,maxWidth:520,boxShadow:'0 20px 60px rgba(0,0,0,.5)',
          }} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--text)',maxWidth:440,lineHeight:1.4}}>
                {selectedMarket.question}
              </div>
              <button onClick={()=>setSelectedMarket(null)} style={{
                background:'transparent',border:'none',color:'var(--text3)',cursor:'pointer',
                fontSize:18,padding:'4px 8px',lineHeight:1,
              }}>×</button>
            </div>

            <a href={marketUrl(selectedMarket)} target="_blank" rel="noopener noreferrer" style={{
              display:'inline-block',marginBottom:16,fontSize:11,color:'var(--blue)',
              fontFamily:'var(--mono)',textDecoration:'none',
            }}>
              → View on Polymarket ↗
            </a>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:16}}>
              {[
                ['YES', selectedMarket.yes_price?.toFixed(4) || '—', selectedMarket.yes_price >= 0.6 ? 'var(--green)' : 'var(--text2)'],
                ['NO', selectedMarket.no_price?.toFixed(4) || '—', 'var(--text2)'],
                ['Volume', selectedMarket.volume >= 1e6 ? `$${(selectedMarket.volume/1e6).toFixed(1)}M` : `$${(selectedMarket.volume/1e3).toFixed(0)}K`, 'var(--text2)'],
              ].map(([label, value, color])=>(
                <div key={label} style={{textAlign:'center',background:'var(--bg3)',borderRadius:'var(--r)',padding:'10px'}}>
                  <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:2}}>{label}</div>
                  <div style={{fontSize:14,fontWeight:700,color,fontFamily:'var(--mono)'}}>{value}</div>
                </div>
              ))}
            </div>

            {selectedMarket.signal !== '—' && (
              <div style={{background:'var(--bg3)',borderRadius:'var(--r)',padding:'12px',marginBottom:16}}>
                <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:8}}>SIGNAL DETECTED</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8}}>
                  {[
                    ['Strategy', selectedMarket.signal.replace('_','-')],
                    ['Side', selectedMarket.outcome],
                    ['EV', `${(selectedMarket.ev*100).toFixed(1)}%`],
                    ['True Prob', `${(selectedMarket.true_prob*100).toFixed(1)}%`],
                  ].map(([label, value])=>(
                    <div key={label} style={{textAlign:'center'}}>
                      <div style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:2}}>{label}</div>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--text)',fontFamily:'var(--mono)'}}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[
                ['Category', selectedMarket.category?.toUpperCase() || '—'],
                ['End Date', selectedMarket.end_date ? new Date(selectedMarket.end_date).toLocaleDateString() : '—'],
              ].map(([label, value])=>(
                <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{fontSize:11,color:'var(--text3)'}}>{label}</span>
                  <span style={{fontSize:11,color:'var(--text2)',fontFamily:'var(--mono)'}}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* main table wrapper */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:'var(--r3)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
      {/* toolbar */}
      <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',background:'var(--bg3)'}}>
        <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)',marginRight:4}}>
          {rows.length} market
        </span>

        {/* category filter */}
        <select value={cat} onChange={e=>setCat(e.target.value)} style={{
          background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:'var(--r)',
          color:'var(--text2)',fontSize:10,fontFamily:'var(--mono)',padding:'3px 6px',
        }}>
          {cats.map(c=><option key={c} value={c}>{c==='all'?'ALL CATEGORIES':c.toUpperCase()}</option>)}
        </select>

        {/* signal filter */}
        <select value={sigF} onChange={e=>setSigF(e.target.value)} style={{
          background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:'var(--r)',
          color:'var(--text2)',fontSize:10,fontFamily:'var(--mono)',padding:'3px 6px',
        }}>
          {['all','signal','arb','no_bias','high_prob'].map(s=><option key={s} value={s}>
            {s==='all'?'ALL SIGNALS':s==='signal'?'HAS SIGNAL':s.replace('_',' ').toUpperCase()}
          </option>)}
        </select>

        {/* search */}
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="cari market..." style={{
            background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:'var(--r)',
            color:'var(--text)',fontSize:10,fontFamily:'var(--mono)',padding:'3px 8px',
            width:160, outline:'none',
          }}
        />

        <span style={{marginLeft:'auto',fontSize:10,color:'var(--text3)',fontFamily:'var(--mono)'}}>
          klik header untuk sort
        </span>
      </div>

      {/* table */}
      <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 280px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:900}}>
          <colgroup>
            {COLS.map(c=><col key={c.key} style={{width:c.w}}/>)}
          </colgroup>
          <thead style={{position:'sticky',top:0,zIndex:10,background:'var(--bg3)'}}>
            <tr>
              {COLS.map(c=>(
                <th key={c.key} onClick={()=>toggle(c.key)} style={{
                  padding:'7px 10px', textAlign:'left', cursor:'pointer',
                  fontFamily:'var(--mono)',fontSize:9,color:'var(--text3)',fontWeight:500,
                  letterSpacing:'.07em',textTransform:'uppercase',
                  borderBottom:'2px solid var(--border2)',
                  userSelect:'none', whiteSpace:'nowrap',
                }}>
                  {c.label} <span style={{color:'var(--blue)',opacity:.7}}>{arrow(c.key)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0 && (
              <tr><td colSpan={COLS.length} style={{padding:'24px',textAlign:'center',color:'var(--text3)',fontFamily:'var(--mono)',fontSize:11}}>
                _ belum ada data market
              </td></tr>
            )}
            {rows.map((row,i)=>{
              const hasSig = row.signal && row.signal!=='—'
              const catC   = CAT_COLOR[row.category] || '#94a3b8'
              const sigC   = STRAT_COLOR[row.signal]  || 'transparent'
              return (
                <tr key={row.id||i} onClick={()=>setSelectedMarket(row)} style={{
                  borderBottom:'1px solid var(--border)',
                  background: hasSig ? sigC+'11' : i%2===0?'transparent':'rgba(255,255,255,.012)',
                  animation: hasSig ? 'flash .5s ease' : 'none',
                  cursor:'pointer',
                }}>
                  {/* category */}
                  <td style={{padding:'6px 10px'}}>
                    <Tag text={row.category?.toUpperCase()} color={catC}/>
                  </td>
                  {/* question */}
                  <td style={{padding:'6px 10px',fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    <span title={row.question}>{row.question}</span>
                    {row.id && (
                      <a href={`https://polymarket.com/event/${row.id}`} target="_blank" rel="noopener noreferrer"
                        onClick={e=>e.stopPropagation()}
                        style={{marginLeft:6,color:'var(--blue)',fontSize:10,textDecoration:'none'}}
                        title="View on Polymarket">
                        ↗
                      </a>
                    )}
                  </td>
                  {/* yes */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,
                    color: row.yes_price>=0.6&&row.yes_price<=0.85?'var(--green)':row.yes_price>0.85?'var(--amber)':'var(--text2)'}}>
                    {row.yes_price?.toFixed(3)}
                  </td>
                  {/* no */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,color:'var(--text2)'}}>
                    {row.no_price?.toFixed(3)}
                  </td>
                  {/* spread */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,
                    color: row.spread<0?'var(--green)':row.spread<0.02?'var(--amber)':'var(--text3)'}}>
                    {row.spread?.toFixed(3)}
                  </td>
                  {/* volume */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,color:'var(--text2)'}}>
                    {row.volume>=1e6?`$${(row.volume/1e6).toFixed(1)}M`:row.volume>=1e3?`$${(row.volume/1e3).toFixed(0)}K`:`$${row.volume?.toFixed(0)}`}
                  </td>
                  {/* signal */}
                  <td style={{padding:'6px 10px'}}>
                    {hasSig
                      ? <Tag text={STRAT_LABEL[row.signal]||row.signal} color={sigC}/>
                      : <span style={{color:'var(--text3)',fontSize:10}}>—</span>
                    }
                  </td>
                  {/* outcome */}
                  <td style={{padding:'6px 10px'}}>
                    {hasSig && row.outcome!=='—'
                      ? <Tag text={row.outcome} color={row.outcome==='YES'?'var(--green)':row.outcome==='NO'?'var(--amber)':'var(--blue)'}/>
                      : <span style={{color:'var(--text3)',fontSize:10}}>—</span>
                    }
                  </td>
                  {/* ev */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,
                    color: row.ev>0.10?'var(--green)':row.ev>0.05?'var(--amber)':'var(--text3)'}}>
                    {hasSig?`${(row.ev*100).toFixed(1)}%`:'—'}
                  </td>
                  {/* true prob */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,color:'var(--text2)'}}>
                    {hasSig?`${(row.true_prob*100).toFixed(1)}%`:'—'}
                  </td>
                  {/* fee */}
                  <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:11,color:'var(--text3)'}}>
                    {(row.fee*100).toFixed(2)}%
                  </td>
                </tr>
              )
})}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  )
}
