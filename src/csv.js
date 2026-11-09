function parseDate(value) {
  if (value == null || value === '') return NaN
  const n=Number(value)
  if(Number.isFinite(n)&&n>0)return n>1e12?Math.floor(n/1000):Math.floor(n)
  const normalized=String(value).trim().replace(/\./g,'-').replace(' ','T')
  const parsed=Date.parse(normalized)
  return Number.isFinite(parsed)?Math.floor(parsed/1000):NaN
}
export function parseCandleCSV(source) {
  const lines=String(source||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim())
  if(lines.length<2)return []
  const firstLine=lines[0]
  const delimiter=[',',';','\t'].sort((a,b)=>firstLine.split(b).length-firstLine.split(a).length)[0]
  const cells=line=>line.split(delimiter).map(x=>x.trim().replace(/^["']|["']$/g,''))
  const header=cells(firstLine).map(x=>x.toLowerCase().replace(/[\s_-]/g,''))
  const aliases={time:['time','epoch','timestamp','datetime','opentime'],date:['date','day'],clock:['time','hour'],open:['open','o'],high:['high','h'],low:['low','l'],close:['close','c','last']}
  const index={}
  for(const [field,names] of Object.entries(aliases))index[field]=header.findIndex(x=>names.includes(x))
  const hasOHLC=['open','high','low','close'].every(k=>index[k]>=0)
  const hasTime=index.time>=0 || (index.date>=0&&index.clock>=0)
  const hasHeader=hasOHLC&&hasTime
  const cols=hasHeader?index:{time:-1,date:0,clock:1,open:2,high:3,low:4,close:5}
  const data=hasHeader?lines.slice(1):lines
  const result=[]
  for(const line of data){
    const row=cells(line)
    const rawTime=cols.date>=0&&cols.clock>=0?`${row[cols.date]||''} ${row[cols.clock]||''}`.trim():row[cols.time]
    const time=parseDate(rawTime),open=Number(row[cols.open]),high=Number(row[cols.high]),low=Number(row[cols.low]),close=Number(row[cols.close])
    if(![time,open,high,low,close].every(Number.isFinite)||time<=0)continue
    if(high<Math.max(open,close,low)||low>Math.min(open,close,high))continue
    result.push({time,open,high,low,close})
  }
  const unique=new Map(result.map(c=>[c.time,c]))
  return [...unique.values()].sort((a,b)=>a.time-b.time)
}
