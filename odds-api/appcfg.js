// GET /appcfg -> { ok:true, card_theme:"oddable" [, announce:{id,title,body,link,at}] }   PUBLIC: what the Oddable page may know about its settings in My Apps.
// WHITELIST ONLY. The My Apps settings also hold secrets (google_places_key): the answer is built field by field from the list below,
// each value checked against its allowed values, and nothing else from the settings object is ever copied into it.
// announce (v267): the latest "Everyone" message from the owner (`announce` next to `settings` in the My Apps answer, last 14 days). Left out when there is none or when
// anything about it is wrong: announce.js clean() checks every type and length, maps `link` through the fixed list of in-app places, and returns a NEW
// object with those five fields only. It is plain text; the phone shows it with textContent.
// card_theme: colours of the bet cards (score pop-up, Today's bets). Order: My Apps setting `card_theme`, else env CARD_THEME, else "oddable".
const D = { settings: (deps) => require('./appsettings').get(deps), announce: (deps) => require('./appsettings').announce(deps), env: (k) => process.env[k], now: () => Date.now() };
const ANN = require('./announce');
const THEMES = ['oddable', 'black', 'light', 'green'];
const themeOf = (v) => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return THEMES.includes(s) ? s : ''; };
async function cfg() {
  let s = null; try { s = await D.settings(); } catch (e) {}
  const o = { ok: true, card_theme: themeOf(s && s.card_theme) || themeOf(D.env('CARD_THEME')) || 'oddable' };
  let a = null; try { a = ANN.clean(await D.announce(), D.now()); } catch (e) {} // same cached read as the settings; it sits NEXT TO them in the My Apps answer, never inside
  if (a) o.announce = a;
  return o;
}
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
async function handle(req, res) {
  if (req.url.split('?')[0] !== '/appcfg') return false;
  if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET only' }); return true; }
  let c; try { c = await cfg(); } catch (e) { c = { ok: true, card_theme: 'oddable' }; }
  const out = { ok: true, card_theme: c.card_theme }; // rebuilt here too: only ok, card_theme and the five announce fields can leave
  if (D.env('BETPUSH_ENABLED') === '1') out.betpush = true; // v266: tells the page the bet alerts are switched on, so it asks /betpush/status only then (field absent = off: the answer is unchanged)
  if (c.announce) out.announce = { id: String(c.announce.id), title: String(c.announce.title), body: String(c.announce.body), link: String(c.announce.link), at: String(c.announce.at) };
  send(res, 200, out);
  return true;
}
module.exports = { handle, _deps: D, _cfg: cfg, THEMES };
