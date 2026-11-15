import http from 'node:http'
import https from 'node:https'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
const base = process.argv[2] ?? 'http://127.0.0.1:8001/'
assert.match(base,/^https?:\/\//,'Provide an HTTP(S) URL for a Lunar OPS instance you control')
const n = Number(process.argv[3] ?? 100)
const transport = base.startsWith('https:') ? https : http
const agent = new transport.Agent({keepAlive:true,maxSockets:100})
async function request(path, body) {
  const payload = body ? JSON.stringify(body) : undefined
  const url = new URL(path,base)
  return new Promise((resolve,reject)=>{
    const req = transport.request(url,{agent,method:payload?'POST':'GET',
      headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:undefined,
      signal:AbortSignal.timeout(25000)},res=>{
      const chunks=[]
      res.on('data',buffer=>chunks.push(buffer))
      res.on('error',reject)
      res.on('end',()=>{
        const buffer=Buffer.concat(chunks)
        if(res.statusCode!==200) return reject(Error(path+' HTTP '+res.statusCode+' '+buffer.toString().slice(0,100)))
        resolve({text:()=>buffer.toString(), json:()=>JSON.parse(buffer.toString()), arrayBuffer:()=>buffer})
      })
    })
    req.on('error',error=>reject(Error(path+' '+error.code+' '+error.message)))
    req.end(payload)
  })
}
const start=performance.now()
const results=await Promise.allSettled(Array.from({length:n},async()=>{
  const html=await (await request('/')).text()
  assert.match(html,/mission-workspace/)
  const assets=[...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(x=>x[1])
  assert.ok(assets.length>=2)
  const siteList = await Promise.all([
    request('/api/sites').then(r=>r.json()),
    ...assets.map(path=>request(path).then(r=>r.arrayBuffer())),
    request('/lunar-globe-color.webp').then(r=>r.arrayBuffer()),
    request('/lunar-globe-bump.webp').then(r=>r.arrayBuffer()),
  ])
  const site=siteList[0].sites.find(s=>s.id==='Site01')
  assert.ok(site)
  const body={site_id:site.id,start:site.data_from,days:30,step_min:60,use_terrain:true}
  const [analysis,series]=await Promise.all(['analyze','timeseries'].map(p=>request('/api/'+p,body).then(r=>r.json())))
  assert.equal(series.t.length,720)
  assert.equal(analysis.period_hours,720)
  return performance.now()-start
}))
const times=results.filter(r=>r.status==='fulfilled').map(r=>r.value).sort((a,b)=>a-b)
const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason.message)
console.log(JSON.stringify({users:n,success:times.length,errors:errors.length,firstErrors:errors.slice(0,5),p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)}))
if(errors.length) process.exitCode=1

agent.destroy()
