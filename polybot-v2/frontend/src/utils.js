export const f2  = n => n==null?'—':Number(n).toFixed(2)
export const f4  = n => n==null?'—':Number(n).toFixed(4)
export const pct = n => n==null?'—':`${Number(n).toFixed(1)}%`
export const usd = n => n==null?'—':`$${Number(n).toFixed(2)}`
export const sign= n => Number(n)>=0?`+${f4(n)}`:`${f4(n)}`
export const signUsd = n => Number(n)>=0?`+${usd(n)}`:`-${usd(Math.abs(n))}`

export const CAT_COLOR = {
  crypto:'#4d9fff', sports:'#00d68f', politics:'#ffaa00',
  economics:'#a78bfa', finance:'#ff4560', culture:'#fb923c',
  geopolitics:'#64748b', science:'#06b6d4', tech:'#8b5cf6',
  weather:'#34d399', mentions:'#f472b6', other:'#94a3b8',
}
export const STRAT_COLOR = {
  arb:'#00d68f', no_bias:'#ffaa00', high_prob:'#4d9fff',
  momentum:'#a78bfa',
}
export const STRAT_LABEL = {
  arb:'ARB', no_bias:'NO BIAS', high_prob:'HIGH PROB', momentum:'MOMENTUM',
}
