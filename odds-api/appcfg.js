// GET /appcfg -> { ok:true, card_theme:"oddable" }   PUBLIC: what the Oddable page may know about its settings in My Apps.
// WHITELIST ONLY. The My Apps settings also hold secrets (google_places_key): the answer is built field by field from the list below,
// each value checked against its allowed values, and nothing else from the settings object is ever copied into it.
// card_theme: colours of the bet cards (score pop-up, Today's bets). Order: My Apps setting `card_theme`, else env CARD_THEME, else "oddable".
const D = { settings: (deps) => require('./appsettings').get(deps), env: (k) => process.env[k] };
const THEMES = ['oddable', 'black', 'light', 'green'];
const themeOf = (v) => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return THEMES.includes(s) ? s : ''; };
async function cfg() {
  let s = null; try { s = await D.settings(); } catch (e) {}
  return { ok: true, card_theme: themeOf(s && s.card_theme) || themeOf(D.env('CARD_THEME')) || 'oddable' };
}
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
async function handle(req, res) {
  if (req.url.split('?')[0] !== '/appcfg') return false;
  if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET only' }); return true; }
  let c; try { c = await cfg(); } catch (e) { c = { ok: true, card_theme: 'oddable' }; }
  send(res, 200, { ok: true, card_theme: c.card_theme }); // rebuilt here too: only these two fields can leave
  return true;
}
module.exports = { handle, _deps: D, _cfg: cfg, THEMES };
