const C='pics-v297';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Always go to the network first (bypassing the HTTP cache); cache is only an offline fallback.
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin||/[?&]c=/.test(r.url))return;
e.respondWith(fetch(r,{cache:'no-store'}).then(res=>{if(res.ok){const c=res.clone();caches.open(C).then(x=>x.put(r,c));}return res;}).catch(()=>caches.match(r)));});

// Push (v266). My Apps sends three kinds, all shown with their title / body / tag:
//  - renewal reminders: url = the hosted pay page on My Apps (absolute) + actions [{action:'pay',title:'Pay now'}];
//  - broadcasts: url = a path inside the app ("/pga.html");
//  - bet-score alerts (tag 'bet-<game id>'): url '/?open=bets'. The same tag replaces the older alert for that game; `renotify` sounds again for the new score.
// With Oddable open and visible its own score pop-up already shows the score, so a bet alert is skipped, EXCEPT on Apple devices: Safari takes the
// permission away from a site whose pushes show nothing, so there every push is shown (the server also holds bet alerts back while the app is open).
const BET=/^bet-/,MYAPPS='https://my-apps-management.onrender.com',APPLE=/iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent)&&!/Chrome|Chromium|Edg\/|Firefox/.test(self.navigator.userAgent);
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){}if(!d||typeof d!=='object')d={};
const tag=String(d.tag||'oddable'),bet=BET.test(tag),o={body:d.body||'',tag,data:{url:d.url||'/'},icon:'/icon-192.png',badge:'/icon-192.png'};if(bet||d.renotify===true)o.renotify=true;
const acts=(Array.isArray(d.actions)?d.actions:[]).filter(a=>a&&typeof a.action==='string'&&typeof a.title==='string'&&a.action&&a.title).slice(0,2).map(a=>({action:a.action.slice(0,30),title:a.title.slice(0,40)}));if(acts.length)o.actions=acts;
const show=()=>self.registration.showNotification(d.title||'Oddable',o);
e.waitUntil(bet&&!APPLE?clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>l.some(c=>c.visibilityState==='visible')?undefined:show(),show):show());});
// Where a tap may go: a path inside Oddable, or a page on My Apps (the pay page). Anything else opens Oddable's front page.
const dest=u=>{try{const x=new URL(String(u||'/'),location.origin);if(x.origin===location.origin)return{u:x.pathname+x.search+x.hash,same:true};if(x.protocol==='https:'&&x.origin===MYAPPS)return{u:x.href,same:false};}catch(z){}return{u:'/',same:true};};
// A tap on the alert or on one of its buttons (action 'pay' = the same url) goes to the payload's url: an open Oddable window is brought forward and
// taken there (bet alerts: told to show My Bets, no reload); with no window open, or for the My Apps pay page, a window is opened.
self.addEventListener('notificationclick',e=>{e.notification.close();const t=dest(e.notification.data&&e.notification.data.url),open=()=>clients.openWindow(t.u);
e.waitUntil(t.same?clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{const c=l.find(x=>'focus' in x);if(!c)return open();
if(/[?&]open=bets\b/.test(t.u)){try{c.postMessage({type:'bp-open'});}catch(x){}return c.focus();}
if(t.u==='/')return c.focus();
return Promise.resolve(c.focus()).then(w=>{const k=w||c;return k.navigate?k.navigate(t.u):open();}).catch(open);},open):open());});
