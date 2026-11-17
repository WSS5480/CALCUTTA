// ONE-TIME BACKFILL of every existing account's start (stats review 5, H1; manager Nov 17 2026). Run it BEFORE the new stats code serves anything, on the
// server (Render shell) with the server's own environment (SUPABASE_URL, SUPABASE_KEY and the account key acct.js signs with):
//   node odds-api/backfill-acctsince.js                 DRY RUN (the default): reads every account, prints what it would write, writes nothing
//   node odds-api/backfill-acctsince.js --write         writes the stamps into 'lock:acctsince', then the marker row 'lock:acctsince:done'
//   --deploy=2026-11-20T15:00:00Z                       the deploy time (default: now); accounts with nothing on file get deploy minus 30 days
// For every synced account (row in oddable_sync) the start is the EARLIEST of: the first bet id time (b<ms>), the first daily-log day; else deploy minus 30
// days. Phone-written data is acceptable HERE because it was written before the rule existed (review 5). The owner PIN account ('owner') gets the
// fallback. A stamp that already exists is never moved (set once), so running it again changes nothing: it is idempotent. Until the marker row exists,
// stats stamps nobody "on first look" (stats.js sinceOf: the boot guard).
const DAY = 864e5, MARK = 'lock:acctsince:done';
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z'));
// The earliest moment one synced row shows the account existed. -> { at, how: 'bet' | 'log' | 'none' }
function startOf(data, nowMs) {
  const d = data || {}; let at = Infinity, how = 'none';
  (Array.isArray(d.bets) ? d.bets : []).forEach((b) => { const m = /^b(\d{12,14})$/.exec(String((b && b.id) || '')); const t = m ? +m[1] : NaN; if (t > 1.4e12 && t <= nowMs && t < at) { at = t; how = 'bet'; } });
  Object.keys(d.log && typeof d.log === 'object' ? d.log : {}).forEach((k) => { if (!okDay(k)) return; const t = Date.parse(k + 'T06:00:00Z'); if (t > 1.4e12 && t <= nowMs && t < at) { at = t; how = 'log'; } }); // 00:00 Chicago (CST) on that day
  return { at: Number.isFinite(at) ? at : null, how };
}
// db = { dbIds, dbGet, dbPut, dbPatchIf } (sync.js); phoneEmail / sinceKey from acct.js. -> a report; writes only when write === true.
async function run(o) {
  const { db, phoneEmail, sinceKey } = o, now = o.now || Date.now(), deploy = o.deploy || now, fallback = deploy - 30 * DAY, log = o.log || (() => {});
  const cur = await db.dbGet('lock:acctsince'), have = (cur && cur.data && cur.data.t) || {}, add = {}, rep = { rows: 0, bet: 0, log: 0, fallback: 0, kept: 0, write: !!o.write, deploy, fallback, sample: [] };
  const ids = (await db.dbIds()).filter((id) => !String(id).startsWith('lock:'));
  const one = (acct, at, how) => { const k = sinceKey(acct); if (Number(have[k]) > 0) { rep.kept++; return; } add[k] = Math.min(at, now); rep[how === 'none' ? 'fallback' : how]++; if (rep.sample.length < 5) rep.sample.push({ key: k.slice(0, 6), start: new Date(add[k]).toISOString().slice(0, 10), from: how === 'none' ? 'deploy - 30 days' : how === 'bet' ? 'first bet' : 'first daily-log day' }); };
  for (const id of ids) { rep.rows++; const row = await db.dbGet(id); const s = startOf(row && row.data, now); one(phoneEmail(id), s.at != null ? s.at : fallback, s.at != null ? s.how : 'none'); }
  one('owner', fallback, 'none');
  rep.added = Object.keys(add).length;
  if (o.write) {
    for (let i = 0; i < 8; i++) { let r = await db.dbGet('lock:acctsince'); if (!r) { await db.dbPut({ id: 'lock:acctsince', salt: 'x', pinhash: 'x', data: { t: {} }, updated: 1 }, true); r = await db.dbGet('lock:acctsince'); if (!r) continue; }
      const t = Object.assign({}, (r.data && r.data.t) || {}); Object.keys(add).forEach((k) => { if (!(Number(t[k]) > 0)) t[k] = add[k]; }); // set once: a stamp written meanwhile wins
      if (await db.dbPatchIf('lock:acctsince', r.updated, Object.assign({}, r.data, { t }), Math.max(Date.now(), Number(r.updated || 0) + 1))) { rep.written = true; break; } }
    if (!rep.written) throw new Error('Could not write lock:acctsince (busy): run it again');
    const m = await db.dbGet(MARK), first = m && m.data && m.data.at ? m.data : null, data = first ? Object.assign({}, first, { runs: (first.runs || 1) + 1, lastAt: now }) : { at: now, deploy, fallback, n: rep.rows, runs: 1 };
    if (m) await db.dbPatchIf(MARK, m.updated, data, Math.max(Date.now(), Number(m.updated || 0) + 1)); else await db.dbPut({ id: MARK, salt: 'x', pinhash: 'x', data, updated: Date.now() }, true);
    rep.marker = true;
  }
  log(JSON.stringify(rep, null, 2)); return rep;
}
module.exports = { run, startOf, MARK };
if (require.main === module) {
  const args = process.argv.slice(2), write = args.includes('--write'), dep = (args.find((a) => a.startsWith('--deploy=')) || '').slice(9), deploy = dep ? Date.parse(dep) : Date.now();
  if (dep && !Number.isFinite(deploy)) { console.error('Bad --deploy time'); process.exit(2); }
  const sync = require('./sync'), acct = require('./acct');
  run({ db: sync, phoneEmail: acct.phoneEmail, sinceKey: acct.sinceKey, write, deploy, log: console.log }).then((r) => { console.log(write ? 'WRITTEN. Marker row ' + MARK + ' is in place.' : 'DRY RUN: nothing written. Add --write to apply.'); process.exit(0); }).catch((er) => { console.error('backfill failed:', er.message); process.exit(1); });
}
