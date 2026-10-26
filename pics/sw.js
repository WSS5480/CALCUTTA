const C='pics-v2';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Always go to the network first (bypassing the HTTP cache); cache is only an offline fallback.
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
e.respondWith(fetch(r,{cache:'no-store'}).then(res=>{const c=res.clone();caches.open(C).then(x=>x.put(r,c));return res;}).catch(()=>caches.match(r)));});
