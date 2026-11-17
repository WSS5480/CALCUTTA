// The Oddable settings kept in My Apps: ONE cached read shared by everything on this server that needs them (courts.js, appcfg.js).
// POST /api/v1/app/settings {slug, secret} -> { ok:true, settings:{ ... }, announce:{...}|null } through acct.js ma() (same MYAPPS_URL / MYAPPS_SECRET).
// Read at most every 5 minutes, 6 s limit; a failed read is tried again after 1 minute and the last good answer is kept while My Apps is down.
// v267: the same answer carries `announce` NEXT TO `settings` (My Apps API contract 4c: the owner's latest message to everyone, or null). It is kept
// beside the settings from the same read; announce() hands it out RAW too (appcfg.js checks it with announce.js clean()). get() is unchanged.
// get() returns the RAW settings object (it can hold secrets such as google_places_key): callers pick the fields they need and never pass it on.
const D = {
  ma: (path, data) => require('./acct').ma(path, data), maReady: () => require('./acct').maReady(),
  now: () => Date.now(), log: (...a) => console.error('appsettings:', ...a)
};
const SET_TTL = 5 * 6e4, SET_RETRY = 6e4, SET_WAIT = 6000;
let SET;
function reset() { SET = { t: 0, good: null, ann: null, job: null }; }
reset();
async function read(d) {
  let ready = false; try { ready = !!d.maReady(); } catch (e) {}
  if (!ready) return null;
  let timer; const late = new Promise((r) => { timer = setTimeout(() => r(null), SET_WAIT); });
  try {
    const r = await Promise.race([d.ma('/api/v1/app/settings', {}), late]);
    if (!(r && r.ok && r.j && r.j.ok === true && r.j.settings && typeof r.j.settings === 'object')) return null;
    return { settings: r.j.settings, ann: r.j.announce && typeof r.j.announce === 'object' ? r.j.announce : null };
  } catch (e) { try { d.log('settings read failed'); } catch (x) {} return null; } finally { clearTimeout(timer); }
}
// deps (optional) lets a caller supply its own ma / maReady / now / log (tests do); the cache is the same one for every caller.
async function get(deps) {
  const d = Object.assign({}, D, deps || {});
  if (!SET.t || d.now() >= SET.t) {
    if (!SET.job) SET.job = read(d).then((v) => { if (v) { SET.good = v.settings; SET.ann = v.ann; SET.t = d.now() + SET_TTL; } else SET.t = d.now() + SET_RETRY; }).catch(() => { SET.t = d.now() + SET_RETRY; }).then(() => { SET.job = null; });
    await SET.job;
  }
  return SET.good;
}
// The announcement from the same cached read (never a second My Apps call). A good read that says null clears it (that is how "Hide" reaches the phones);
// while My Apps is down the last one is kept, and announce.js clean() drops it once it is 14 days old.
async function announce(deps) { await get(deps); return SET.ann; }
module.exports = { get, announce, _deps: D, _reset: reset };
