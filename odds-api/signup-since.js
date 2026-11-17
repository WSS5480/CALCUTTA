// SIGN-UP DATE (account start) for money golf: the MINIMUM brought from the stats branch (calcutta-stats, stats-v1 54e0b93), nothing else of stats.
// Golf on main (feature session, Nov 17 2026; dark). Money golf needs ONE fact about an account: how old it is by a date the SERVER wrote, so that only an
// account at least SIGNER_MIN_DAYS old (owner GOLF-AGE: 1 day) can sign a change that helps another team (golf.js estOf / stampOf). Main has no such date:
// main's acct.js stamps nothing at sign-up. This file holds the stats branch's code for it, unchanged in meaning:
//   since / sinceSet / sinceKey / SINCE   from stats 54e0b93 odds-api/acct.js (lines 163-174: the row 'lock:acctsince' { t: { <account hash>: ms } }, set once)
//   backfilled / sinceOf / BFROW          from stats 54e0b93 odds-api/stats.js (lines 721-752: the boot guard and the account start)
//   dbIdsPage                             from stats 54e0b93 odds-api/sync.js (every row id, page by page, for the one-time backfill)
//   sinceBackfilled()                     NEW (the name golf's moneySwitch asks for): true only when the one-time backfill has run (marker row present)
// The one-time backfill itself is odds-api/backfill-acctsince.js (also from stats 54e0b93; run it on the server before GOLF_MONEY_ENABLED=1).
// NOT brought: the rest of stats (handicaps, ratings store, approval contract, event log, dashboard). Golf runs its "Golf alone" path for those.
// DARK: nothing here runs unless golf asks, and golf is only reached with GOLF_MONEY_ENABLED=1 (golf-gate.js). Requiring this file reads and writes nothing.
'use strict';
const crypto = require('crypto');
const D = { S: require('./sync'), acct: () => require('./acct'), now: () => Date.now() };
const N = (x) => Number(x) || 0;

// ---------- the stamp row (stats 54e0b93 acct.js) ----------
const SINCE = 'lock:acctsince', sinceKey = (e) => crypto.createHash('sha256').update('oddable-since|' + String(e)).digest('hex').slice(0, 20);
async function since(e) { const r = await D.S.dbGet(SINCE); const v = r && r.data && r.data.t && r.data.t[sinceKey(e)]; return Number(v) > 0 ? Number(v) : null; }
async function sinceSet(e, at) {
  const k = sinceKey(e), now = Number(at) > 0 ? Number(at) : D.now();
  for (let i = 0; i < 5; i++) {
    let r = await D.S.dbGet(SINCE); if (!r) { await D.S.dbPut({ id: SINCE, salt: 'x', pinhash: 'x', data: { t: {} }, updated: 1 }, true); r = await D.S.dbGet(SINCE); if (!r) continue; }
    const t = { ...((r.data && r.data.t) || {}) }; if (Number(t[k]) > 0) return Number(t[k]); t[k] = now; // set once: the first stamp stays
    if (await D.S.dbPatchIf(SINCE, r.updated, { t }, Math.max(D.now(), Number(r.updated || 0) + 1))) return now;
  } throw new Error('Busy, try again');
}

// ---------- the boot guard and the account start (stats 54e0b93 stats.js) ----------
//   1. The sign-up stamp (row 'lock:acctsince'). WHEN A STAMP EXISTS IT IS THE ONLY ANSWER: nothing the phone or another player can write moves it.
//   2. Accounts older than the stamp get theirs from the ONE-TIME BACKFILL (backfill-acctsince.js): the earliest of the first bet id time and the first
//      daily-log day, never before Oddable's launch, else deploy minus 30 days. It writes the marker row 'lock:acctsince:done'.
//   3. BOOT GUARD: until that marker row exists nothing is stamped "on first look": an account with no stamp reads known: false (golf: "the sign-up date is
//      not on file", it cannot sign for another team). After the backfill, a PHONE account with no stamp first reached Oddable after it, so it is stamped
//      now, once (it can sign for another team SIGNER_MIN_DAYS later). Main's acct.js does not stamp at sign-up, so that first look is the stamp.
//   Email accounts (My Apps) with no stamp: their start is acct.createdAt(account) when main supplies it; main does not, so they read "not on file".
const BFROW = 'lock:acctsince:done'; let BF = { at: 0, v: null }, BFWARN = false, EMWARN = false;
async function backfilled() {
  if (BF.v && BF.v.at) return BF.v; if (D.now() - BF.at < 30e3 && BF.at <= D.now()) return null;
  const r = await D.S.dbGet(BFROW).catch(() => null); BF = { at: D.now(), v: (r && r.data && r.data.at) ? r.data : null };
  if (!BF.v && !BFWARN) { BFWARN = true; console.error('signup-since: ACCOUNT START BACKFILL NOT RUN (row ' + BFROW + ' missing). Run: node odds-api/backfill-acctsince.js --launch=YYYY-MM-DD --write. Until then no account is stamped on first look.'); }
  return BF.v;
}
// -> { t: ms, known: bool }
async function sinceOf(e, now) {
  const t = now || D.now(); if (/^guest:/.test(String(e || ''))) return { t, known: false };
  let stamp = null; try { stamp = Number(await since(e)) || null; } catch (er) {}
  if (stamp && stamp > 1.4e12) return { t: Math.min(stamp, t), known: true };
  const bf = await backfilled(); if (!bf) return { t, known: false };
  if (e !== 'owner' && !/@phone\.oddable$/.test(String(e))) { // an EMAIL account (made on My Apps) with no stamp: its start is the My Apps creation time, never "joined today"
    const A = D.acct(); let c = 0; if (typeof A.createdAt === 'function') { try { c = Number(await A.createdAt(e)) || 0; } catch (er) {} }
    if (!(c > 1.4e12)) { if (!EMWARN) { EMWARN = true; console.error('signup-since: acct.createdAt(account) missing or empty: email accounts with no sign-up stamp read "join date not on file"'); } return { t, known: false }; }
    const at = Math.min(t, Math.max(c, N(bf.launch)));
    try { const got = Number(await sinceSet(e, at)); if (got > 1.4e12) return { t: Math.min(got, t), known: true }; } catch (er) {}
    return { t, known: false };
  }
  try { const got = Number(await sinceSet(e, t)); if (got > 1.4e12) return { t: Math.min(got, t), known: true }; } catch (er) {}
  return { t, known: false };
}
// NEW for golf's moneySwitch: can the sign-up dates be trusted on this database? Only after the one-time backfill (marker row with its time).
async function sinceBackfilled() { BF = BF.v ? BF : { at: 0, v: null }; const v = await backfilled(); return !!(v && v.at); }

// ---------- every row id, page by page (stats 54e0b93 sync.js; main's sync.dbIds stops at 5,000 and skips 'lock:' rows) ----------
const origin = (u) => { try { return new URL(/^https?:/i.test(u.trim()) ? u.trim() : 'https://' + u.trim()).origin; } catch (e) { return ''; } };
async function dbIdsPage(offset, limit) {
  const url = origin(process.env.SUPABASE_URL || ''), key = (process.env.SUPABASE_KEY || '').trim(), hdr = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json' };
  const off = Math.max(0, Math.floor(Number(offset) || 0)), lim = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 1000)));
  const r = await fetch(`${url}/rest/v1/oddable_sync?select=id&order=id.asc&offset=${off}&limit=${lim}`, { headers: hdr, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('db read ' + r.status);
  return (await r.json()).map((x) => String(x.id));
}

module.exports = { since, sinceSet, sinceKey, SINCE, sinceOf, backfilled, sinceBackfilled, BFROW, dbIdsPage, _deps: D, _reset: () => { BF = { at: 0, v: null }; BFWARN = false; EMWARN = false; } };
