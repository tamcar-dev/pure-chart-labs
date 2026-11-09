const CACHE='pure-chart-shell-v2'
const SHELL=['/','/index.html','/manifest.webmanifest']
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()})
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})())})
self.addEventListener('fetch',event=>{
  const req=event.request
  if(req.method!=='GET')return
  const url=new URL(req.url)
  if(url.origin!==self.location.origin)return
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{if(res.ok)caches.open(CACHE).then(c=>c.put('/index.html',res.clone()));return res}).catch(()=>caches.match('/index.html')))
    return
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{
    if(res.ok)caches.open(CACHE).then(c=>c.put(req,res.clone()))
    return res
  }).catch(()=>hit)))
})
