// GOLF ON MAIN (Nov 17 2026): copied from the stats branch (stats-v1 54e0b93) for money golf's sign-up date check; only the command-line block at the end
// changed (sinceKey and the paged id reader come from signup-since.js). Run it once on the server BEFORE GOLF_MONEY_ENABLED=1 (golf stays off until it has).
// ONE-TIME BACKFILL of every existing account's start (stats review 5, H1; manager Nov 17 2026). Run it BEFORE the new stats code serves anything, on the
// server (Render shell) with the server's own environment (SUPABASE_URL, SUPABASE_KEY and the account key acct.js signs with):
//   node odds-api/backfill-acctsince.js                 DRY RUN (the default): reads every account, prints what it would write, writes nothing
//   node odds-api/backfill-acctsince.js --write         writes the stamps into 'lock:acctsince', then the marker row 'lock:acctsince:done'
//   --deploy=2026-11-20T15:00:00Z                       the deploy time (default: now); accounts with nothing on file get deploy minus 30 days
//   --launch=2025-09-01                                 ODDABLE'S LAUNCH DATE (review 6, M1): no start is ever earlier. Without it the floor is the
//                                                       earliest server-stamped row in the table (the hourly price log 'plog:YYYY-MM-DD-HH', written
//                                                       only by the server). With neither, --write is refused. The floor is kept in the marker row.
// Every row id is read page by page (no 5,000 limit); only account rows (sha256 ids, 64 hex) are stamped; price logs and other rows are skipped.
// For every synced account (row in oddable_sync) the start is the EARLIEST of: the first bet id time (b<ms>), the first daily-log day; else deploy minus 30
// days. Phone-written data is acceptable HERE because it was written before the rule existed (review 5). The owner PIN account ('owner') gets the
// fallback. A stamp that already exists is never moved (set once), so running it again changes nothing: it is idempotent. Until the marker row exists,
// stats stamps nobody "on first look" (stats.js sinceOf: the boot guard).
const DAY = 864e5, MARK = 'lock:acctsince:done';
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z'));
// The earliest moment one synced row shows the account existed. -> { at, how: 'bet' | 'log' | 'none' }
function startOf(data, nowMs, floor) {
  const d = data || {}; let at = Infinity, how = 'none';
  (Array.isArray(d.bets) ? d.bets : []).forEach((b) => { const m = /^b(\d{12,14})$/.exec(String((b && b.id) || '')); const t = m ? +m[1] : NaN; if (t > 1.4e12 && t <= nowMs && t < at) { at = t; how = 'bet'; } });
  Object.keys(d.log && typeof d.log === 'object' ? d.log : {}).forEach((k) => { if (!okDay(k)) return; const t = Date.parse(k + 'T06:00:00Z'); if (t > 1.4e12 && t <= nowMs && t < at) { at = t; how = 'log'; } }); // 00:00 Chicago (CST) on that day
  if (Number.isFinite(at) && floor > 0 && at < floor) at = floor; // phone-written bet ids and log days are never trusted for a date before the launch
  return { at: Number.isFinite(at) ? at : null, how };
}
// Every row id in the table, page by page (sync.js dbIdsPage); a db without paging falls back to dbIds.
const ACCT_ID = /^[0-9a-f]{64}$/, PAGE = 1000;
async function allIds(db) {
  if (typeof db.dbIdsPage !== 'function') return (await db.dbIds()).map(String);
  const out = []; for (let off = 0; off < 5e6; off += PAGE) { const p = (await db.dbIdsPage(off, PAGE)) || []; p.forEach((id) => out.push(String(id))); if (p.length < PAGE) break; }
  return out;
}
// db = { dbIds | dbIdsPage, dbGet, dbPut, dbPatchIf } (sync.js); phoneEmail / sinceKey from acct.js. -> a report; writes only when write === true.
async function run(o) {
  const { db, phoneEmail, sinceKey } = o, now = o.now || Date.now(), deploy = o.deploy || now, log = o.log || (() => {});
  const all = await allIds(db), plog = all.map((id) => /^plog:(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(String(id))).filter(Boolean).map((m) => Date.parse(m[1] + 'T' + m[2] + ':00:00Z')).filter(Number.isFinite);
  const launch = Number(o.launch) > 1.4e12 ? Number(o.launch) : plog.length ? Math.min(...plog) : null, fallback = Math.max(deploy - 30 * DAY, launch || 0);
  if (launch && launch > now) throw new Error('The launch date is in the future: check --launch'); // review 7 (L4)
  if (o.write && !launch) throw new Error('Oddable launch date unknown: pass --launch=YYYY-MM-DD (no price-log row to take it from)');
  const cur = await db.dbGet('lock:acctsince'), have = (cur && cur.data && cur.data.t) || {}, add = {}, rep = { rows: 0, skipped: 0, bet: 0, log: 0, fallback: 0, kept: 0, write: !!o.write, deploy, launch, launchFrom: Number(o.launch) > 1.4e12 ? '--launch' : launch ? 'earliest price-log row' : 'unknown', fallback, sample: [] };
  const ids = all.filter((id) => { if (ACCT_ID.test(String(id))) return true; rep.skipped++; return false; });
  const one = (acct, at, how) => { const k = sinceKey(acct); if (Number(have[k]) > 0) { rep.kept++; return; } add[k] = Math.min(at, now); rep[how === 'none' ? 'fallback' : how]++; if (rep.sample.length < 5) rep.sample.push({ key: k.slice(0, 6), start: new Date(add[k]).toISOString().slice(0, 10), from: how === 'none' ? 'deploy - 30 days' : how === 'bet' ? 'first bet' : 'first daily-log day' }); };
  for (const id of ids) { rep.rows++; const row = await db.dbGet(id); const s = startOf(row && row.data, now, launch); one(phoneEmail(id), s.at != null ? s.at : fallback, s.at != null ? s.how : 'none'); }
  one('owner', fallback, 'none');
  rep.added = Object.keys(add).length;
  if (o.write) {
    for (let i = 0; i < 8; i++) { let r = await db.dbGet('lock:acctsince'); if (!r) { await db.dbPut({ id: 'lock:acctsince', salt: 'x', pinhash: 'x', data: { t: {} }, updated: 1 }, true); r = await db.dbGet('lock:acctsince'); if (!r) continue; }
      const t = Object.assign({}, (r.data && r.data.t) || {}); Object.keys(add).forEach((k) => { if (!(Number(t[k]) > 0)) t[k] = add[k]; }); // set once: a stamp written meanwhile wins
      if (await db.dbPatchIf('lock:acctsince', r.updated, Object.assign({}, r.data, { t }), Math.max(Date.now(), Number(r.updated || 0) + 1))) { rep.written = true; break; } }
    if (!rep.written) throw new Error('Could not write lock:acctsince (busy): run it again');
    const m = await db.dbGet(MARK), first = m && m.data && m.data.at ? m.data : null, data = first ? Object.assign({}, first, { runs: (first.runs || 1) + 1, lastAt: now }) : { at: now, deploy, fallback, launch, n: rep.rows, runs: 1 };
    if (m) await db.dbPatchIf(MARK, m.updated, data, Math.max(Date.now(), Number(m.updated || 0) + 1)); else await db.dbPut({ id: MARK, salt: 'x', pinhash: 'x', data, updated: Date.now() }, true);
    rep.marker = true;
  }
  log(JSON.stringify(rep, null, 2)); return rep;
}
module.exports = { run, startOf, allIds, MARK };
if (require.main === module) {
  const args = process.argv.slice(2), write = args.includes('--write'), dep = (args.find((a) => a.startsWith('--deploy=')) || '').slice(9), deploy = dep ? Date.parse(dep) : Date.now();
  const la = (args.find((a) => a.startsWith('--launch=')) || '').slice(9), launch = la ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(la) ? la + 'T06:00:00Z' : la) : null;
  if (dep && !Number.isFinite(deploy)) { console.error('Bad --deploy time'); process.exit(2); } if (la && !Number.isFinite(launch)) { console.error('Bad --launch date'); process.exit(2); }
  const sync = require('./sync'), acct = require('./acct'), SS = require('./signup-since'); // golf on main: the stamp row and the paged id reader live in signup-since.js (main's acct.js / sync.js have neither)
  run({ db: Object.assign({}, sync, { dbIdsPage: SS.dbIdsPage }), phoneEmail: acct.phoneEmail, sinceKey: SS.sinceKey, write, deploy, launch, log: console.log }).then((r) => { console.log(write ? 'WRITTEN. Marker row ' + MARK + ' is in place.' : 'DRY RUN: nothing written. Add --write to apply.'); process.exit(0); }).catch((er) => { console.error('backfill failed:', er.message); process.exit(1); });
}
