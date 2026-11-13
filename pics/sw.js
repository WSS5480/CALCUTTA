const C='pics-v157';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Always go to the network first (bypassing the HTTP cache); cache is only an offline fallback.
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
e.respondWith(fetch(r,{cache:'no-store'}).then(res=>{const c=res.clone();caches.open(C).then(x=>x.put(r,c));return res;}).catch(()=>caches.match(r)));});

self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){}
e.waitUntil(self.registration.showNotification(d.title||'Oddable',{body:d.body||'',tag:d.tag||'oddable',data:{url:d.url||'/'},icon:'/icon-192.png',badge:'/icon-192.png'}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/';
e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c)return c.focus();}return clients.openWindow(u);}));});
