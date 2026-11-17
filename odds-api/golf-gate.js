// MONEY GOLF ON MAIN: THE SWITCHES (feature session, Nov 17 2026; dark). Main-only glue around odds-api/golf.js (the golf-v1 engine, Golf v1.7.1).
// Money golf sits BESIDE main's casual Golf days (golfday.js, /golfday, behind the Groups switches) and Golf GPS (golfcourse.js, /golfcourse); it does not
// replace or merge with either (owner has not decided). Its routes are /golf/<op> only (the slash matters: /golfday and /golfcourse never reach this file).
// The same pattern as main's Groups switches (groups.js) and the Calcutta switches (calcutta.js), read on every request:
//   GOLF_MONEY_ENABLED     the master switch. Unless it is exactly "1", money golf is OFF for everybody and server.js never even requires this file:
//                          /golf/* answers what main answers today (404 {"error":"not found"}). With "1", golf.moneySwitch() must ALSO say yes at boot:
//                          it needs the server sign-up dates (signup-since.js) with old accounts filled in (backfill-acctsince.js run once). If not,
//                          it stays OFF and says so in the log ("golf money stays OFF: ..."); every caller gets the blocked answers below.
//   GOLF_MONEY_OWNER_ONLY  "1" (and enabled): only the owner-PIN sign-in, the owner's phone accounts (acct.js isOwnerPhone) and GOLF_MONEY_TESTERS.
//   GOLF_MONEY_TESTERS     comma-separated ACCOUNT KEYS (limits.keyOf(account id), 24 hex characters each), like GROUPS_TESTERS / CALCUTTA_TESTERS.
// BLOCKED callers: /golf/on -> 200 {on:false}; /golf/preview -> 404 (the answer for a bad invite code); everything else -> 403 {error, off:true}. An
// account whose paid time has ended (acct.js expired) gets 403 {expired:true}, like Groups and Calcutta. Nothing is read from the database for a blocked caller.
// Oddable never collects, holds or pays money: money golf shows amounts only (golf.js, pics/golf.js).
'use strict';
const ENABLED = () => process.env.GOLF_MONEY_ENABLED === '1';
const OWNER_ONLY = () => process.env.GOLF_MONEY_OWNER_ONLY === '1';
const TESTERS = () => String(process.env.GOLF_MONEY_TESTERS || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[0-9a-f]{24}$/.test(x));
const D = { golf: () => require('./golf'), acct: () => require('./acct'), limits: () => require('./limits') };
let ST = { on: false, asked: false, why: 'not checked yet' }, BOOT = null;
const on = () => ENABLED() && ST.on === true;
function allowed(e) { // e = the account id inside a valid sign-in token, or null
  if (!on()) return false; if (!OWNER_ONLY()) return true; if (!e) return false;
  try { return e === 'owner' || !!D.acct().isOwnerPhone(e) || TESTERS().includes(D.limits().keyOf(e)); } catch (er) { return false; }
}
const onFor = (e) => allowed(e || null);
const signedIn = (req) => { try { return D.acct().who(req) || null; } catch (e) { return null; } };
async function lapsed(e) { if (!e) return false; try { const A = D.acct(); return typeof A.expired === 'function' ? !!(await A.expired(e)) : false; } catch (er) { return false; } }
const OFF_MSG = 'Golf is not open for this account yet.', LAPSED_MSG = 'Your time has ended. Pay to use Golf again.';
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
// Boot (server.js, once, only with GOLF_MONEY_ENABLED=1): ask golf.moneySwitch(), then wire golf to the other engines ONLY if it said yes.
//   Groups: golf's group attach / "open from a group" calls reach groups.js only while GROUPS_ENABLED=1 (else golf answers 503 "Groups is not ...");
//           the golf pot is registered with groups.wire({ golf }) (Calcutta / events / stats passed as null: they wire themselves).
//   Calcutta: golf's lot sources ('golf', 'golf-day') are registered with the Calcutta engine when it is in the build AND CALCUTTA_ENABLED=1.
function boot() {
  if (!ENABLED()) { ST = { on: false, asked: false, why: 'GOLF_MONEY_ENABLED is off.' }; return Promise.resolve(ST); }
  if (BOOT) return BOOT;
  BOOT = (async () => { let s; try { s = await D.golf().moneySwitch(process.env); } catch (e) { s = { on: false, asked: true, why: 'golf money stays OFF: the check failed (' + (e && e.message) + ')' }; console.error('golf: ' + s.why); }
    ST = s; if (!s.on) return ST;
    const G = D.golf(), g0 = G._deps.groups; G._deps.groups = () => (process.env.GROUPS_ENABLED === '1' ? g0() : null);
    try { const GG = require('./groups'); if (typeof GG.wire === 'function') GG.wire({ calcutta: null, golf: G, events: null, stats: null }); } catch (e) { console.error('golf wiring:', e && e.message); }
    if (process.env.CALCUTTA_ENABLED === '1') { try { G.registerCalcutta(require('./calcutta')); } catch (e) { /* no Calcutta engine in this build */ } }
    console.log('golf: money golf is ON (GOLF_MONEY_ENABLED=1' + (OWNER_ONLY() ? ', owner only' : '') + '; signers need an account at least ' + s.minDays + ' day old)');
    return ST; })();
  return BOOT;
}
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/golf/')) return false;
  if (req.method === 'OPTIONS') return false;
  const e = signedIn(req);
  if (path === '/golf/on') { req.resume(); send(res, 200, { on: onFor(e) }); return true; }
  if (!allowed(e)) { req.resume(); if (path === '/golf/preview') send(res, 404, { error: 'This invite link is not valid or has expired.' }); else send(res, 403, { error: OFF_MSG, off: true }); return true; }
  if (await lapsed(e)) { req.resume(); send(res, 403, { error: LAPSED_MSG, expired: true }); return true; }
  return D.golf().handle(req, res);
}
module.exports = { boot, handle, onFor, on, state: () => Object.assign({}, ST), OFF_MSG, _deps: D, _set: (s) => { ST = s; BOOT = null; } };
