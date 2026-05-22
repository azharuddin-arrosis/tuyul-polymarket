export const f2  = n => n==null?'—':Number(n).toFixed(2)
export const f3  = n => n==null?'—':Number(n).toFixed(3)
export const f4  = n => n==null?'—':Number(n).toFixed(4)
export const pct = n => n==null?'—':`${Number(n).toFixed(1)}%`
export const id = n => n==null?'—':`${Number(n).toFixed(0)}`
export const usd = n => {
  if (n == null) return '—';
  const v = Number(n);
  if (v === 0) return '$0.00';
  return '$' + v.toFixed(2);
}
export const idr = n => n==null?'—':`Rp${(Number(n)*16000).toLocaleString('id-ID',{minimumFractionDigits:0,maximumFractionDigits:0})}`
export const signUsd = n => {
  const v = Number(n);
  if (v >= 0) return '+$' + v.toFixed(2);
  return '-$' + Math.abs(v).toFixed(2);
}
export const fmtDur = sec => {
  if(!sec||sec<=0) return '—'
  if(sec<60)    return `${Math.round(sec)}s`
  if(sec<3600)  return `${Math.round(sec/60)}m`
  if(sec<86400) return `${(sec/3600).toFixed(1)}h`
  return `${(sec/86400).toFixed(1)}d`
}
export const CAT_COLOR={
  crypto:'#3a8fd8',sports:'#00c87a',politics:'#e09000',
  economics:'#8878e0',finance:'#f04060',culture:'#d06820',
  geopolitics:'#4a6080',science:'#0aa8c0',tech:'#7060d0',
  weather:'#20c090',other:'#5a7090',
}
export const STRAT_COLOR={arb:'#00c87a',no_bias:'#e09000',high_prob:'#3a8fd8',momentum:'#8878e0'}
export const STRAT_LABEL={arb:'ARB',no_bias:'NO BIAS',high_prob:'HI PROB',momentum:'MOM'}
