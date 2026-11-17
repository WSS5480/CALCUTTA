// Oddable Golf (engine v1, Nov 16 2026). Pro tournament pools (Pick six, One and done) and "our golf day" (every format, heads-up matches, extras).
// A golf contest works on its own (invite link ?join=golf.<code>) or attached to a group as contest type "golf-pro" / "golf-day".
// MONEY STAYS OUTSIDE THE APP: entry, take, per-match amounts, skins and prizes are information only. Nothing is collected, held or paid.
// Storage (Supabase oddable_sync; 'lock:' prefix keeps these rows out of every player list / owner count):
//   'lock:golf:<id>'      one contest (settings, members, picks or the golf day's teams/scores/audit), every change with dbPatchIf on `updated`
//   'lock:golf:idx'       { codes: {code: id}, mine: {memberKey: [ids]} }
//   'lock:golf:courses'   { courses: {id: course} } saved courses typed in by users (no paid course database)
//   'lock:ent'            { keys: {accountKey: true}, courses: {accountKey: [courseId]} } enterprise accounts (STAND-IN for Groups' limits.maxPeople; see HANDOFF)
//                         and the saved courses each enterprise account (a golf course / club) is linked to by the owner (POST /golf/ent, owner token only)
// Members are shown by their Oddable name/handle only; member keys, account ids and phones are never sent to anyone.
'use strict';
const crypto = require('crypto');
const S = require('./golf-score'), F = require('./golf-feed'), CO = require('./golf-courses');
// HANDICAPS: ONE SOURCE, the stats module (odds-api/stats.js; manager decision Nov 16 2026). Golf keeps no index, no override store and no director
// log of its own: stats owns handicapFor / eventSetup / eventOverride / eventLog and the row 'lock:evr:<eventId>'. Contract used here:
//   handicapFor(userKey, {eventId, casual, typed}) -> { oddable: {index, rounds, text}, confirmedIndex, rounds, confirmedRounds, event, setBy, use, needsSet, text }
//       use = the number to play off: the tournament's value when a director set one; the CONFIRMED index in a money game, a flight or a tournament;
//       the full index in a casual round ({casual: true}); null = no usable number yet (the organizer or director sets one).
//       text = what people see next to a handicap: "12.6 · 4 of 20 rounds confirmed".
//   eventSetup(directorId, eventId, {title, sport, lockAt})            once per Enterprise tournament, and again when its first tee time moves
//   eventOverride(directorId, eventId, userKey, {hcp, reason, name})   the director's add / change, for that tournament only (E-H); stats logs it
//   eventLog(callerId, eventId) -> {log: [{at, by, player, old, new, oddable, reason}], locked, lockAt}
// eventId for a golf game = 'golf:<game id>'. When stats.js is not in the build (this branch on its own) nobody has an index: every number is set by
// the organizer, and tournament overrides answer 503. Tests plug a fake with the same shapes into golf._deps.
const NOSTATS = 'Tournament handicaps need the stats module, which is not in this build.';
const noStats = (o) => { const x = o || {}, t = x.typed != null && x.typed !== '' && Number.isFinite(Number(x.typed)) ? Math.round(Number(x.typed) * 10) / 10 : null, use = x.casual ? null : t;
  return { oddable: { index: null, rounds: 0, text: '' }, confirmedIndex: null, rounds: 0, confirmedRounds: 0, event: null, setBy: use != null ? 'organizer' : null, use, needsSet: use == null && !x.casual, text: '' }; };
const mod = (name, need) => { try { const m = require(name); return m && need.every((f) => typeof m[f] === 'function') ? m : null; } catch (e) { return null; } };
const D = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), S: require('./sync'), acct: () => require('./acct'), now: () => Date.now(), ip: (req) => require('./ip').clientIp(req), feed: F, courses: CO, ownerOk: (req) => require('./acct').ownerOk(req), pairing: () => require('./pairing'),
  stats: () => mod('./stats', ['handicapFor', 'eventSetup', 'eventOverride', 'eventLog']), // THE handicap module (not in this branch; in the merged build)
  groups: () => mod('./groups', ['attachGame']), // Groups: attachGame(groupId, accountId, {type, ref, name, pot}) checks the caller is that group's commissioner
  limitsMod: () => mod('./limits', ['maxPeople', 'keyOf']), // the shared limits file (Groups branch)
  handicapFor: async (k, o) => { const st = D.stats(); return st ? st.handicapFor(k, o) : noStats(o); },
  eventSetup: async (d, id, o) => { const st = D.stats(); if (!st) throw bad(503, NOSTATS); return st.eventSetup(d, id, o); },
  eventOverride: async (d, id, k, o) => { const st = D.stats(); if (!st) throw bad(503, NOSTATS); return st.eventOverride(d, id, k, o); },
  eventLog: async (d, id) => { const st = D.stats(); if (!st) throw bad(503, NOSTATS); return st.eventLog(d, id); } };
const HCP_LABEL = 'Oddable Handicap Index', HCP_NOTE = 'Calculated with the World Handicap System method.', EID = (id) => 'golf:' + id;
const ROW = (id) => 'lock:golf:' + id, IDX = 'lock:golf:idx', CRS = 'lock:golf:courses', ENT = 'lock:ent', PLAYS = 'lock:golf:plays';
const DAY = 864e5;
const PRICE = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'; // shared text (OWNER-DECISIONS, Limits and pricing)
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error, extra) => Object.assign(new Error(error), { status, extra });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 40000) c.push(d); }); req.on('end', () => { if (n > 40000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
// Names keep apostrophes and quotes (O'Neil, Sean O'Hair; review fix Nov 16 2026); tags and < > ` \\ and control characters are removed. EVERY consumer escapes on output (pics/golf.js esc/att).
// L7: character references typed as text (&lt; &gt; &#60; ...) are turned back into the character first, so they are stripped like the real thing and never show as "&lt;".
const CHREF = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'", '#60': '<', '#62': '>', '#x3c': '<', '#x3e': '>' };
const clean = (n, max) => String(n == null ? '' : n).replace(/&(lt|gt|amp|quot|apos|#39|#60|#62|#x3c|#x3e);/gi, (m, k) => CHREF[k.toLowerCase()]).replace(/&(lt|gt|#60|#62|#x3c|#x3e);/gi, '').replace(/<[^>]*>/g, '').replace(/[<>`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/^GOLF\./, '').replace(/[^A-Z0-9]/g, ''); return x.length === 10 ? x : ''; }; // 10 chars of 32 = 50 random bits
const sameCode = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkOf = (e) => crypto.createHash('sha256').update('oddable-golf|' + e).digest('hex').slice(0, 24);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// ---------- people cap (owner Nov 16 2026: standard accounts top out at 8 people, organizer included; enterprise lifts it) ----------
// The shared limits file (odds-api/limits.js, Groups branch) is used when it is in the build: maxPeople(keyOf(accountId), gameId), isEnterprise,
// recordPlay(accountKey, gameType, gameId, playerKey). Without it (this branch alone) the STAND-INS below answer with the same signatures.
// Golf always passes the organizer's ACCOUNT ID; the key (limits.keyOf) is worked out here.
const ENTC = { at: 0, keys: {} };
const limits = {
  isEnterprise: async (accountId) => { const L = D.limitsMod(); if (L && typeof L.isEnterprise === 'function') return !!(await L.isEnterprise(L.keyOf(accountId))); return (await limits.maxPeople(accountId)) > 8; },
  maxPeople: async (accountId, groupOrGameId) => { const L = D.limitsMod(); if (L) return L.maxPeople(L.keyOf(accountId), groupOrGameId || '');
    if (D.now() - ENTC.at > 60e3) { try { const r = await D.S.dbGet(ENT); ENTC.keys = (r && r.data && r.data.keys) || {}; } catch (e) {} ENTC.at = D.now(); } return ENTC.keys[accountId] ? 400 : 8; },
  // ENTERPRISE BILLING ($20 per player per game): every play is recorded through the shared limits.recordPlay(accountKey, gameType, gameId, playerKey).
  // Stand-in: row 'lock:golf:plays' { m: { 'YYYY-MM': { <account key>: { <gameId>: { t: gameType, p: [playerKey] } } } } }, one line per player per game.
  recordPlay: async (accountId, gameType, gameId, playerKey) => { const L = D.limitsMod(); if (L && typeof L.recordPlay === 'function') return L.recordPlay(L.keyOf(accountId), gameType, gameId, playerKey);
    const ak = mkOf(accountId), mo = chiDay(D.now()).slice(0, 7), gid = String(gameId).slice(0, 60), pk = String(playerKey).slice(0, 40);
    return mutateRow(PLAYS, () => ({ m: {} }), (d) => { d.m = d.m || {}; const a = ((d.m[mo] = d.m[mo] || {})[ak] = d.m[mo][ak] || {}), g = (a[gid] = a[gid] || { t: String(gameType).slice(0, 20), p: [] }); if (g.p.includes(pk)) return { nochange: true, v: { ok: true, dup: true } }; g.p.push(pk);
      const ms = Object.keys(d.m).sort(); while (ms.length > 14) delete d.m[ms.shift()]; return { ok: true }; }); },
};
// One call per player per game; never blocks or fails a play (billing is counted, the game goes on).
async function recPlays(c, gameType, pids, gameId) { for (const p of pids) { const m = c.members.find((x) => x.pid === p); if (!m) continue; try { await limits.recordPlay(c.orgE, gameType, gameId || c.id, m.guest ? 'g:' + m.gid : m.mk); } catch (e) { console.error('golf: recordPlay', e.message); } } }

// Enterprise course links (owner sets them): which saved courses an enterprise account (a course or club) runs. Events played there record courseId.
async function entRow() { const r = await D.S.dbGet(ENT); return (r && r.data) || {}; }
async function coursesOwnedBy(accountKey) {
  const e = await entRow(), ids = ((e.courses || {})[String(accountKey)] || []).slice(0, 50); if (!ids.length) return [];
  const r = await D.S.dbGet(CRS), all = (r && r.data && r.data.courses) || {};
  return ids.filter((id) => all[id]).map((id) => ({ id, name: all[id].name, tees: all[id].tees, holes: all[id].holes, rating: all[id].rating ?? null, slope: all[id].slope ?? null, city: all[id].city || '' }));
}

// ---------- rate limits ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
const LIM = { create: [8, 3600e3, 20, 3600e3], code: [30, 600e3, 60, 600e3], score: [240, 600e3, 600, 600e3], write: [120, 600e3, 300, 600e3], read: [300, 600e3, 900, 600e3] };
function rate(kind, who, ip) { const L = LIM[kind]; if (limit(kind + '|a|' + who, L[0], L[1]) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const fails = (k) => (RL.get('f|' + k) || []).filter((x) => D.now() - x < 900e3).length;
const fail = (k) => { const a = (RL.get('f|' + k) || []).filter((x) => D.now() - x < 900e3); a.push(D.now()); RL.set('f|' + k, a); };

// ---------- rows ----------
// M8 (review round 3): ONE WRITER AT A TIME PER ROW inside this process (a promise chain per row, as Groups does): 60 scorers saving in the same second
// queue up instead of racing, so nobody burns their tries. The conditional write (dbPatchIf) stays as the guard against another server instance; a
// lost race there waits a short random time and tries again (24 tries). If it still cannot write the answer is 503, which the phone retries by itself.
const QUEUE = new Map();
function serial(key, fn) { const prev = QUEUE.get(key) || Promise.resolve(), run = prev.then(fn, fn), tail = run.then(() => {}, () => {}); QUEUE.set(key, tail); tail.then(() => { if (QUEUE.get(key) === tail) QUEUE.delete(key); }); return run; }
const mutateRow = (id, init, fn) => serial(id, () => mutateRow1(id, init, fn));
async function mutateRow1(id, init, fn) { // read, change, write only if nobody wrote in between; else redo (no lost updates)
  for (let i = 0; i < 24; i++) {
    let row = await D.S.dbGet(id);
    if (!row) { if (!init) throw bad(404, 'Not found'); await D.S.dbPut({ id, salt: 'x', pinhash: 'x', data: init(), updated: 1 }, true); row = await D.S.dbGet(id); if (!row) continue; }
    const data = clone(row.data || {}); const out = await fn(data);
    if (out && out.nochange) return out.v;
    if (await D.S.dbPatchIf(id, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
    await D.sleep(3 + Math.random() * 12 * Math.min(i + 1, 8)); // randomized back-off so racing writers (another instance) spread out
  }
  throw bad(503, 'The server is busy. Your phone will try again by itself.', { busy: true });
}
async function getC(id) { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) throw bad(404, 'Golf game not found'); const r = await D.S.dbGet(ROW(id)); if (!r || !r.data || !r.data.id) throw bad(404, 'Golf game not found'); return r.data; }
const mutC = (id, fn) => { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) throw bad(404, 'Golf game not found'); return mutateRow(ROW(id), null, fn); };
const mutIdx = (fn) => mutateRow(IDX, () => ({ codes: {}, mine: {} }), (d) => { d.codes = d.codes || {}; d.mine = d.mine || {}; return fn(d); });

// ---------- who ----------
async function me(req) { const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to use Golf'); return { e, mk: mkOf(e) }; }
function nameFor(u, given) { const A = D.acct(); if (u.e === 'owner' || (A.isOwnerPhone && A.isOwnerPhone(u.e))) return clean(A.ownerName && A.ownerName(), 24) || 'Owner'; return clean(given, 24) || 'Player'; }
// A member who LEFT a pool after picking in group play keeps the entry (G16): the row stays with `left` set, and is not a member for any route until they rejoin.
const anyMember = (c, mk) => (mk ? c.members.find((m) => m.mk === mk) : undefined);
const memberOf = (c, mk) => { const m = anyMember(c, mk); return m && !m.left ? m : undefined; };
const roOf = (c, mk) => { const m = anyMember(c, mk); return m && m.ro ? m : undefined; }; // X2: a player removed after the start keeps a read-only seat (sees the game, can object)
const isOrg = (c, mk) => c.org === mk;
// Co-organizers (the organizer names them): they can settle disputes and confirm cards on teams they are not part of. They cannot start, finish or reopen.
const isCo = (c, m) => !!m && (c.co || []).includes(m.pid);
// "On the team's side" = plays on it or scores for it. Nobody settles, confirms or forces anything for a team they are on the side of.
const teamSide = (t, pid) => !!t && !!pid && (t.players.includes(pid) || t.scorer === pid);
// Notices every player sees the next time the game is opened or refreshed (reopen, forced finish, a team marked did-not-finish, a late paid change).
const notify = (c, kind, by, text) => { c.notes = c.notes || []; const n = ((c.notes[c.notes.length - 1] || {}).n || 0) + 1; c.notes.push({ n, at: D.now(), kind, by: by ? by.name : '', bp: by ? by.pid : null, text: clean(text, 400) }); if (c.notes.length > 60) c.notes.splice(0, c.notes.length - 60); };
const whoCan = (c, q) => { try { const actor = c.members.find((x) => x.pid === q.by); if (!actor) return []; return q.dir ? whoDir(c, q) : signers(c, q.by, sigOf(c, actor, q.kind, q.p)); } catch (e) { return []; } };
const toSign = (c, m) => (m ? (c.pend || []).filter((q) => whoCan(c, q).includes(m.pid)).length : 0);
const unseenOf = (c, m) => (m ? (c.notes || []).filter((x) => x.n > (m.seen || 0) && x.bp !== m.pid).length + toSign(c, m) + (c.harm || []).filter((e) => e.st === 'open' && e.h > (m.hseen || 0) && harmedBy(c, m.pid, e.sides) && objOpen(c, e, D.now())).length : 0); // new notices + requests waiting for THIS player's signature
// What the server last SENT each member of each team's hole versions: a confirm without its own `revs` is checked against this (confirm pins what was seen).
const SEEN = new Map();
const seenPut = (c, pid) => { const v = {}; Object.keys(c.day.scores || {}).forEach((tid) => { v[tid] = {}; Object.keys(c.day.scores[tid]).forEach((h) => (v[tid][h] = c.day.scores[tid][h].rev)); }); SEEN.delete(c.id + '|' + pid); SEEN.set(c.id + '|' + pid, v); if (SEEN.size > 20000) SEEN.delete(SEEN.keys().next().value); };
const newPid = (c) => { let p; do { p = rnd(6); } while (c.members.some((m) => m.pid === p)); return p; };

// ======================= THE NEUTRAL RULE (manager, Nov 16 2026; review round 3) =======================
// ONE rule, used by every route that can change who gets paid (dispute settlements, changes to confirmed holes, forced Final, reopen, did-not-finish,
// paid / not paid after the start, handicaps, side-game winners, money matches, tiers and payout rules). Nothing below is decided route by route.
//   TIGHTENED IN REVIEW ROUND 4 (Nov 17 2026), at these definitions and nowhere else:
//   INTERESTED (`interested`) = plays on a team, KEEPS or scores ANY card (is a team's scorer, or typed a hole on a card: a typed-in guest's card
//   counts), has a pool entry, or holds a lot in a linked Calcutta. An organizer or co-organizer is NEUTRAL only when he keeps no card, plays on no
//   team and holds no stake.
//   THE AFFECTED SIDE SIGNS (`need`): a change to team X's card, standing, handicap or paid mark by someone who does not play on X needs the signature
//   of X's OWN account-holding player. A helper on another team is never enough, and a neutral organizer needs it too. If X has no account (all
//   typed-in guests) a neutral third account signs (or a neutral organizer acts) and the board says "changed without the team's sign-off" (`d.nso`).
//   Someone who plays on X and changes X's own card needs the OTHER side: an account on a team he is not on.
//   An interested person's action is only ASKED FOR (`c.pend`): every player sees it, and it changes nothing until it is signed (`signers`).
//   Every action is logged with both names (`c.plog`) and announced to all players (`notify`).
//   Not settled by this file (say so in the rules text): two accounts of one person; an organizer and the affected player agreeing a handicap together.
const isBoss = (c, m) => !!m && !!m.mk && (c.org === m.mk || isCo(c, m));
// A pool entrant is a side of one: anyone with a pick, and (while picks are still open) anyone who could still pick.
const proIn = (c, pid) => { const P = c.pro, e = P.entries[pid], O = P.oad || { events: {}, used: {} }; return !!(e && e.picks && e.picks.length) || Object.values(O.events || {}).some((E) => E.picks[pid]) || ((O.used || {})[pid] || []).length > 0 || !(P.game === 'six' && P.lockAt && D.now() >= P.lockAt); };
const acctM = (m) => !!m && !!m.mk && !m.guest && !m.left;
const playsOn = (c, tid, pid) => { const t = c.kind === 'day' ? c.day.teams.find((x) => x.tid === tid) : null; return !!t && t.players.includes(pid); };
const teamsOfP = (c, pid) => (c.kind === 'day' ? c.day.teams.filter((t) => t.players.includes(pid)).map((t) => t.tid) : []);
// The accounts that PLAY on these teams: the only people who can sign for the team.
const acctsOn = (c, tids) => (c.kind === 'day' ? c.members.filter((m) => acctM(m) && c.day.teams.some((t) => tids.includes(t.tid) && t.players.includes(m.pid))).map((m) => m.pid) : []);
// KEEPS a card = is the team's scorer, or typed any hole that is on its card.
const keeps = (c, t, pid) => t.scorer === pid || Object.values((c.day.scores || {})[t.tid] || {}).some((h) => h.bp === pid);
// A STAKE outside the cards: a lot in a linked Calcutta. The Calcutta engine reports who holds lots (`setLotHolders`); until it has, every organizer
// and co-organizer of a game with a linked Calcutta counts as holding one (the safe side).
const lotOf = (c, pid) => { if (!c.calcId) return false; const m = c.members.find((x) => x.pid === pid); if (!acctM(m)) return false; return Array.isArray(c.lotMks) ? c.lotMks.includes(m.mk) : isBoss(c, m); };
// A person's OWN sides: the teams they play on, a typed-in guests' team whose card they keep (nobody else can speak for it), a pool entry, a Calcutta lot.
// Two people who share one of these never sign for each other.
const sidesOf = (c, pid) => { if (!pid) return []; const lot = lotOf(c, pid) ? ['lot:' + pid] : [];
  if (c.kind !== 'day') return (proIn(c, pid) ? ['p:' + pid] : []).concat(lot);
  return c.day.teams.filter((t) => t.players.includes(pid) || (t.players.length > 0 && keeps(c, t, pid) && !acctsOn(c, [t.tid]).length)).map((t) => t.tid).concat(lot); };
const sidesOf0 = sidesOf;
// INTERESTED: an own side, or keeping / scoring ANY card.
const interested = (c, pid) => !!pid && (sidesOf(c, pid).length > 0 || (c.kind === 'day' && c.day.teams.some((t) => t.players.length > 0 && keeps(c, t, pid))));
const neutralBoss = (c, m) => isBoss(c, m) && !interested(c, m.pid);
// Who signs a change to TEAM X's card or standing: someone who plays on X needs the other side; anyone else needs X's own account.
const affTeam = (c, me, tid) => (playsOn(c, tid, me.pid) ? {} : { need: acctsOn(c, [tid]), nt: [tid] });
// Who signs a change to ONE PLAYER's own mark (paid, handicap): the player (or, for a typed-in guest, an account on the guest's team).
const affPlayer = (c, me, pid) => { const ts = c.kind === 'day' ? teamsOfP(c, pid) : ['p:' + pid], tm = c.members.find((m) => m.pid === pid);
  if (pid === me.pid || ts.some((t) => playsOn(c, t, me.pid))) return { not: ts }; return { need: acctM(tm) ? [pid] : acctsOn(c, ts), nt: ts }; };
// "Changed without the team's sign-off": kept on the game and shown on the board next to the team.
const markNso = (c, tids, o) => { if (c.kind !== 'day') return; const d = c.day; d.nso = d.nso || {}; tids.forEach((t) => { if (d.teams.some((x) => x.tid === t)) d.nso[t] = (d.nso[t] || []).concat(o).slice(-10); }); };
// Is anything at stake that the rule protects? Money shown, or an Enterprise tournament (the course usually collects at the counter).
const stakes = (c) => (c.kind === 'day' ? !c.day.solo && (moneyOn(c) || !!c.ent) : (c.pot.entry || 0) > 0);
// STRICT HANDICAPS (H5, M3, M4): any Enterprise tournament (fee or not), any flighted game, any net game with money or a money match. Nobody sets
// their own number there, nobody plays off 0 by default, and the round does not start until every player has a number.
const hStrict = (c) => c.kind === 'day' && !c.day.solo && (!!c.ent || !!((c.day.flights || {}).n) || (moneyOn(c) && netOn(c.day)));
const acctOthers = (c, pid) => c.members.filter((m) => m.mk && !m.guest && !m.left && m.pid !== pid);
// ===================== Golf v1.6: THE DIRECTION RULE (manager, 2026-11-17) =====================
// Six review rounds showed that judging a change by the standings at that moment (the old "benefit test") cannot work: effects that land later slip
// through. It is GONE. Every change after the start in a game with money shown (or an Enterprise tournament) is judged by what it does to a team X:
//   WORSE for X (a higher score on X's card, did not finish, removed, marked not paid, a lower handicap, a side-game win taken away): X's own player signs.
//   BETTER for X (a lower score, more strokes, paid restored, did-not-finish undone, a late player added): a player on ANOTHER team signs, and every other
//   team is told at once. They can turn it down (two players from two other teams can overrule that) or object for 30 minutes after it is applied.
//   A BET between two sides added, changed or removed after the start: both sides sign. "Shorten to 9" (rain): every team with a card signs.
// Nothing here looks at who is winning. Signatures that speak for someone else (another team's witness, an overrule, an uphold) come only from
// ESTABLISHED accounts (`estOk`). A team's own consent is its own players.
const expFinish = (c) => { const d = c.day; if (d.endAt) return d.endAt; return (d.lockAt || d.startAt || 0) + (d.course.par.length >= 18 ? 5.5 : 3) * 3600e3; };
const fmtCT = (ms) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) + ' CT'; } catch (e) { return new Date(ms).toISOString(); } };
const OBJ_MS = 30 * 60e3, HOLD_MS = 15 * 60e3; // objections stay open 30 minutes after a change (Final included); Final waits 15 minutes after a change made a team worse without its signature
// Round 7 fix 1: a change to a CONFIRMED hole (`e.cf`) stays open to objection until 30 minutes after the change OR 30 minutes after Final, whichever
// is later (phones are in the cart; Final is the one moment everyone looks). While the round is not final it stays open. Anything else: 30 minutes.
const objEnd = (c, e) => { const t = e.at + OBJ_MS; if (c.kind !== 'day' || !e.cf) return t; const d = c.day; return d.status !== 'final' ? Infinity : Math.max(t, (d.finalAt || 0) + OBJ_MS); };
const objOpen = (c, e, now) => now <= objEnd(c, e);
// Fix 4: the time to settle up. Disputes stay open until 30 minutes after Final, and objections as above. -> ms, or 0 when the round is not final.
const settleAt = (c) => { const d = c.day; if (c.kind !== 'day' || d.status !== 'final') return 0; let t = (d.finalAt || 0) + OBJ_MS; (c.harm || []).forEach((e) => { if (e.st === 'open') { const v = objEnd(c, e); if (v > t && v !== Infinity) t = v; } }); return t; };
// Fixes 1 and 4: the Final notice. Every team's lowered confirmed holes, and the time to settle up. (Money games and tournaments; inside the write.)
function finalTold(c, me, now) { if (c.kind !== 'day' || !stakes(c)) return; const L = c.day.teams.map((t) => lowLine(c, t.tid)).filter(Boolean);
  notify(c, 'final', me, 'Final at ' + fmtCT(now) + '. Open to disputes until ' + fmtCT(settleAt(c)) + '. Settle up after that.' + (L.length ? ' ' + L.join('. ') + '.' : '')); } // the settle time first: never cut off
// What every player would be paid if the round ended now (DISPLAY ONLY: the CONTESTED marks at Final compare two versions of the round; never used to decide who signs).
function payMap(c) { const o = {}, add = (pid, v) => { if (v) o[pid] = (o[pid] || 0) + v; }; const x = clone(c); x._proj = true; if (x.day.status !== 'final') x.day.status = 'final'; const d = x.day, bd = dayBoard(x), pay = dayPay(x, bd).pids, SM = sideMoney(x, bd);
  Object.keys(pay).forEach((p) => add(p, pay[p])); Object.keys(SM.skins).forEach((p) => add(p, SM.skins[p])); Object.values(SM.side).forEach((sh) => Object.keys(sh).forEach((p) => add(p, sh[p])));
  bd.matches.forEach((m) => { if (!m.amt) return; const v = m.nassau ? [m.nassau.front, m.nassau.back, m.nassau.total].concat((m.nassau.presses || []).map((q) => q.m)).reduce((a, s) => a + Math.sign((s && s.up) || 0), 0) : Math.sign((m.m && m.m.up) || 0); if (!v) return;
    const ps = (id) => (m.kind === 'player' ? [id] : ((d.teams.find((t) => t.tid === id) || {}).players || [])), cents = Math.round(Math.abs(v) * m.amt * 100), A = ps(m.a), B = ps(m.b), sa = shareC(cents, A), sb = shareC(cents, B);
    A.forEach((p) => add(p, Math.sign(v) * (sa[p] || 0))); B.forEach((p) => add(p, -Math.sign(v) * (sb[p] || 0))); });
  return { p: o, bd }; }
// The number a raise is measured from: the number in use for this game, else the player's Oddable index, else none (any number is a raise).
const hBase = (d, pid) => { const src = (d.hsrc || {})[pid]; if (src && src !== 'none' && d.hcp[pid] != null) return Number(d.hcp[pid]); const o = (d.odx || {})[pid]; return o && o.index != null ? Number(o.index) : null; };
// N6: a handicap changes strokes, not today's payout, so it is judged by direction. A HIGHER number helps the player's team and hurts every other team;
// a LOWER one hurts the player's own team.
function hcpBen(c, p) { const d = c.day, base = hBase(d, p.pid), ts = teamsOfP(c, p.pid), mine = (pid) => ts.some((t) => playsOn(c, t, pid)), raise = base == null || Number(p.v) > base + 1e-9, lower = base != null && Number(p.v) < base - 1e-9;
  const gain = new Set(c.members.filter((m) => (raise ? mine(m.pid) || m.pid === p.pid : lower ? !mine(m.pid) && teamsOfP(c, m.pid).length > 0 : false)).map((m) => m.pid));
  const harm = raise ? d.teams.filter((t) => !ts.includes(t.tid) && t.players.length).map((t) => t.tid) : lower ? (ts.length ? ts : ['p:' + p.pid]) : [];
  return { same: !raise && !lower, gain, harm, raise, lower, base }; }
// The kinds the direction rule judges. Everything else (set-up, draw, tiers, reopen, end of season) keeps the round-4 rule (`signers`).
const DIRK = new Set(['correct', 'resolve', 'withdraw', 'remove', 'paid', 'hcp', 'extrareopen', 'final', 'match', 'matchdel', 'oadmoney', 'oadrefresh', 'latejoin', 'short9']);
const dirMode = (c, kind) => kind === 'short9' || (DIRK.has(kind) && stakes(c) && (kind === 'hcp' ? hStrict(c) : c.kind !== 'day' || c.day.status !== 'setup'));
// Every team with a hole that was never confirmed (not counting a team marked did not finish).
const unconfT = (c) => c.day.teams.filter((t) => !(c.day.wd || {})[t.tid] && Object.values(c.day.scores[t.tid] || {}).some((h) => h.st !== 'confirmed' && !(h.st === 'disputed' && h.pst === 'confirmed'))).map((t) => t.tid);
// ---- ESTABLISHED SIGNERS (X5: the organizer's second phone) ----
// ONE bar (round 7 fix 3): an account signs for another team only when its Oddable account is at least SIGNER_MIN_DAYS days old by the SERVER's
// sign-up stamp. The stamp comes from the stats module (`sinceOf(e)` -> { known, t }, old accounts filled in to their first-seen date), else from
// acct.since(e) (Golf alone). Unknown = not established. OWNER DECISION GOLF-AGE (Nov 17 2026): 1 day. Change this one constant to move the bar.
// Looked up before each write (`estFill`, cached 10 minutes) and read synchronously by the rule (`estOk`).
const SIGNER_MIN_DAYS = 1, SIGNER_AGE = SIGNER_MIN_DAYS + ' day' + (SIGNER_MIN_DAYS === 1 ? '' : 's'); // owner GOLF-AGE: 1 day
const EST = new Map();
async function stampOf(e) { const st = D.stats(); if (st && typeof st.sinceOf === 'function') { const si = await st.sinceOf(e); return si && si.known && Number(si.t) ? Number(si.t) : null; }
  const A = D.acct(); return typeof A.since === 'function' ? Number(await A.since(e)) || null : null; }
async function estOf(e) { const now = D.now(), c0 = EST.get(e); if (c0 && Math.abs(now - c0.at) < 600e3) return c0; let v;
  try { const t = await stampOf(e); v = t && now - t >= SIGNER_MIN_DAYS * DAY ? { ok: true } : { ok: false, why: t ? 'signer too new: the Oddable account is less than ' + SIGNER_AGE + ' old' : 'signer too new: the sign-up date is not on file' }; }
  catch (er) { v = { ok: false, why: 'signer not checked' }; }
  v.at = now; EST.set(e, v); if (EST.size > 5000) EST.delete(EST.keys().next().value); return v; }
// THE MONEY SWITCH (fix 3). GOLF_MONEY_ENABLED turns golf with money on, but only when the sign-up stamps the rule needs are really there: the stats module
// must export sinceOf AND say its old accounts were filled in (`sinceBackfilled`, true or a function returning true). Otherwise every witness would read
// "sign-up date is not on file" and money games would fail closed with a 409 nobody understands. So the switch REFUSES to turn on, says why (loudly, in
// the log), and golf stays without money. The port calls `await golf.moneySwitch()` at boot and wraps the money parts of /golf/ in `.on`.
async function moneySwitch(env) { const E = env || process.env, asked = /^(1|true|on|yes)$/i.test(String(E.GOLF_MONEY_ENABLED || '').trim());
  if (!asked) return { on: false, asked: false, why: 'GOLF_MONEY_ENABLED is off.' }; let st = null; try { st = D.stats(); } catch (e) { st = null; }
  let why = ''; if (!st) why = 'the stats module is not in this build';
  else if (typeof st.sinceOf !== 'function') why = 'the stats module does not export sinceOf (the server sign-up stamp golf needs to check who may sign for another team)';
  else { let bf = st.sinceBackfilled; try { if (typeof bf === 'function') bf = await bf(); } catch (e) { bf = false; } if (bf !== true) why = 'the stats module has not filled in the sign-up date of accounts made before the stamp existed (sinceBackfilled is not true)'; }
  if (why) { const msg = 'GOLF_MONEY_ENABLED is set, but golf money stays OFF: ' + why + '. Fix that, then restart.'; console.error('golf: ' + msg); return { on: false, asked: true, why: msg }; }
  return { on: true, asked: true, why: '', minDays: SIGNER_MIN_DAYS }; }
async function estFill(c) { for (const m of (c && c.members) || []) if (m.mk && !m.guest && m.e) await estOf(m.e); }
const estOk = (m) => !!m && !!m.e && !!(EST.get(m.e) || {}).ok;
const estWhy = (m) => (m && m.e && (EST.get(m.e) || {}).why) || 'signer not checked';
// ---- sides ----
const sideTeams = (c, s) => (s.startsWith('p:') ? teamsOfP(c, s.slice(2)) : [s]);
const sName = (c, s) => (s.startsWith('p:') ? mName(c, s.slice(2)) : tName(c, s));
// May member m give side s's OWN consent? A player for himself; for a team (and for a typed-in guest) an account that plays on it.
const speaksFor = (c, m, s) => { if (!acctM(m) || m.ro) return false; if (!s.startsWith('p:')) return playsOn(c, s, m.pid); const pid = s.slice(2); if (m.pid === pid) return true; return !acctM(c.members.find((x) => x.pid === pid)) && teamsOfP(c, pid).some((t) => playsOn(c, t, m.pid)); };
// The direction of a hole change: a higher number for anyone on the card = worse; lower = better. Same strokes with something else changed (a drive,
// putts) counts as better, so another team signs it.
function holeDir(cur, e) { const a = cur || {}; let up = false, down = false;
  const cmp = (x, y) => { const X = x == null ? null : Number(x), Y = y == null ? null : Number(y); if (X === Y) return; if (Y == null || (X != null && Y > X)) up = true; else down = true; };
  if (a.g != null || e.g != null) cmp(a.g, e.g); new Set(Object.keys(a.p || {}).concat(Object.keys(e.p || {}))).forEach((k) => cmp((a.p || {})[k], (e.p || {})[k]));
  if (!up && !down) down = true; return { up, down }; }
const strokesT = (e) => (!e ? null : e.g != null ? Number(e.g) : Object.values(e.p || {}).reduce((s, v) => s + (Number(v) || 0), 0));
// X1: the running total of what a team took off its own confirmed holes, shown with every such request ("Ann has lowered 8 holes by 8 strokes since
// they were confirmed"). d.cum[tid][hole] = the strokes when the hole was first changed after its confirmation. `over` = a change still being asked for.
function lowOf(c, tid, over) { const d = c.day, cm = Object.assign({}, (d.cum || {})[tid] || {}), cur = (h) => (over && Number(over.hole) === Number(h) ? strokesT(over.e) : strokesT((d.scores[tid] || {})[h]));
  if (over && cm[over.hole] == null) { const x = (d.scores[tid] || {})[over.hole] || {}; if (x.st === 'confirmed' || x.pst === 'confirmed') cm[over.hole] = strokesT(x); } let n = 0, s = 0; // only holes that were confirmed
  Object.keys(cm).forEach((h) => { const v = cur(h); if (v != null && cm[h] != null && v < cm[h]) { n++; s += cm[h] - v; } }); if (!n) return null;
  const t = d.teams.find((x) => x.tid === tid), ps = t ? t.players : [], who = ps.length && ps.length <= 2 ? ps.map((p) => mName(c, p)).join(' & ') : tName(c, tid); return { n, s, who, two: ps.length === 2 }; }
function cumNote(c, tid, over) { const L = lowOf(c, tid, over); if (!L) return '';
  return L.who + (L.two ? ' have' : ' has') + ' lowered ' + L.n + ' hole' + (L.n === 1 ? '' : 's') + ' by ' + L.s + ' stroke' + (L.s === 1 ? '' : 's') + ' since they were confirmed'; }
// Fix 1: the line on the Final board row and in the Final notice ("Ann lowered 8 confirmed holes by 8")
const lowLine = (c, tid) => { const L = lowOf(c, tid); return L ? L.who + ' lowered ' + L.n + ' confirmed hole' + (L.n === 1 ? '' : 's') + ' by ' + L.s : ''; };
// The Enterprise director acts alone (owner rule E-H) only when he is neutral: plays in nothing, holds no Calcutta lot and no pool entry.
// Round 7 fix 2: in a tournament the director never plays. He is not put on a team, takes no pool entry, and Start is refused unless he is still
// neutral (that also catches a Calcutta lot bought after the numbers were set).
const DIR_PLAY = 'In a tournament the director runs the event and does not play: no team, no pool entry, no Calcutta lot. Have someone else direct it if you want to play.';
const dirNeutral = (c, m) => !!m && c.org === m.mk && (c.kind !== 'day' || !teamsOfP(c, m.pid).length) && !lotOf(c, m.pid) && !(c.kind === 'pro' && proIn(c, m.pid)); // keeping a walk-in guest's card is allowed: the director runs the event
// WHAT MUST BE SIGNED. -> { g: [groups], worse, better, told, ob, bet, rm }
//   group {k: 'own', s}   one signature from someone who speaks for one of the sides s (the person asking counts when he does)
//   group {k: 'bet', s}   the same, for one side of a bet / one team in "shorten to 9"
//   group {k: 'other', not} one ESTABLISHED account on a team (pool: an entrant) that is none of `not`, never the person asking
//   alt: true             (removal) also satisfied after the expected finish by two established players from two other teams
//   told = the teams told at once that may turn it down or object; ob = the sides whose "no" can be overruled
function dirReq(c, me, kind, p) {
  const d = c.day, R = { g: [], worse: [], better: [], told: [] };
  const all = () => (c.kind === 'day' ? d.teams.filter((t) => t.players.length).map((t) => t.tid) : c.members.filter((m) => !m.left).map((m) => 'p:' + m.pid));
  const tms = (sides) => [...new Set(sides.flatMap((s) => (c.kind === 'day' ? sideTeams(c, s) : [s])))];
  const worse = (sides) => { R.worse = sides; sides.forEach((s) => R.g.push({ k: 'own', s: [s] })); };
  // BETTER: a witness from another team, also not the asker's own team while anyone else could sign (in a two-team game the asker's team is the only other one)
  const better = (sides) => { R.better = sides; const nt = tms(sides), st = [...new Set(nt.concat(c.kind === 'day' ? teamsOfP(c, me.pid) : []))], out = c.members.some((m) => acctM(m) && m.pid !== me.pid && onTeamOrEntrant(c, m).length && !onTeamOrEntrant(c, m).some((t) => st.includes(t)));
    const mine = c.kind === 'day' ? teamsOfP(c, me.pid) : [], third = all().filter((t) => !nt.includes(t) && !mine.includes(t));
    if (!(mine.length && !mine.some((t) => nt.includes(t)) && !third.length)) R.g.push({ k: 'other', not: out ? st : nt }); /* a two-sided game where the asker IS the only other side: it only costs the asker's own team */
    R.told = all().filter((t) => !nt.includes(t)); };
  switch (kind) {
    case 'correct': { const x = holeDir((d.scores[p.tid] || {})[p.hole], p.e); if (x.up) worse([p.tid]); if (x.down) better([p.tid]); break; }
    case 'resolve': { if (c.ent && dirNeutral(c, me)) break; const cur = (d.scores[p.tid] || {})[p.hole] || {}, dT = teamsOfP(c, cur.dfPid);
      if (sameV(p.e, cur)) { R.g.push({ k: 'own', s: dT.length ? dT : ['p:' + cur.dfPid] }); R.keep = true; R.told = dT; break; } // keep the entered score: the side that disputed it agrees
      const x = holeDir(cur, p.e); if (x.up) worse([p.tid]); if (x.down) better([p.tid]); break; }
    case 'withdraw': if (p.on === false) better([p.tid]); else worse([p.tid]); break;
    case 'remove': { const s = p.tid || 'p:' + p.pid; R.g.push({ k: 'own', s: [s], alt: true }); R.rm = true;
      R.worse = p.tid ? [p.tid].concat(acctsOn(c, [p.tid]).map((x) => 'p:' + x)) : ['p:' + p.pid]; R.told = R.worse; break; }
    case 'paid': if (p.paid) better(['p:' + p.pid]); else worse(['p:' + p.pid]); break;
    case 'hcp': { if (c.ent) break; const hb = hcpBen(c, p); if (hb.lower) worse(['p:' + p.pid]); else if (hb.raise) better(['p:' + p.pid]); break; }
    case 'extrareopen': { const w = ((d.win || {})[p.kind] || {})[p.hole] || {}, ws = d.teams.filter((t) => t.tid === w.who || t.players.includes(w.who)).map((t) => t.tid); worse(ws.length ? ws : ['p:' + w.who]); break; }
    case 'final': better([...new Set(unconfT(c).concat(dayBoard(c).rows.filter((r) => !r.wd && r.thru < d.course.par.length).map((r) => r.tid)))]); break;
    case 'match': case 'matchdel': { const m0 = kind === 'match' ? { kind: d.heads.kind, a: p.a, b: p.b } : d.matches.find((m) => m.mid === p.mid) || { kind: 'team' }, sd = (id) => (m0.kind === 'player' ? ['p:' + id] : [id]);
      R.g.push({ k: 'bet', s: sd(m0.a) }, { k: 'bet', s: sd(m0.b) }); R.bet = true; break; }
    case 'oadmoney': case 'oadrefresh': { // a pool entry's direction: what its picked golfer's result does (typed prize money: more than 0 = better)
      const E = (c.pro.oad.events || {})[p.ev] || { picks: {} }, up = [], down = []; Object.keys(E.picks || {}).forEach((pid) => { const g = E.picks[pid].g, nw = Number(((kind === 'oadmoney' ? p.money : p.res) || {})[g]) || 0, od = kind === 'oadmoney' ? 0 : Number((E.res || {})[g]) || 0; if (nw > od) up.push('p:' + pid); else if (nw < od) down.push('p:' + pid); });
      if (down.length) worse(down); if (up.length || !down.length) { R.better = up; R.g.push({ k: 'other', not: up }); R.told = all().filter((t) => !up.includes(t)); } break; }
    case 'latejoin': if (stakes(c)) better([p.tid]); break;
    case 'short9': d.teams.filter((t) => t.players.length && Object.keys(d.scores[t.tid] || {}).length).forEach((t) => R.g.push({ k: 'bet', s: [t.tid] })); R.bet = true; break;
  }
  R.ob = R.bet || R.rm ? [] : R.keep ? R.told : R.worse.concat(R.told);
  // a side with no account at all (typed-in guests only) cannot speak: an established player on another team signs instead
  R.g = R.g.map((g) => (g.k !== 'other' && !c.members.some((m) => g.s.some((s) => speaksFor(c, m, s))) ? { k: 'other', not: tms(g.s), was: g.s } : g));
  return R; }
const onTeamOrEntrant = (c, m) => (c.kind === 'day' ? teamsOfP(c, m.pid) : ['p:' + m.pid]);
// may member m fill group g of request q?
function canG(c, q, g, m) { if (!acctM(m) || m.ro) return false;
  if (g.k === 'other') { if (m.pid === q.by) return false; const ms = onTeamOrEntrant(c, m); if (!ms.length || ms.some((t) => g.not.includes(t)) || !estOk(m)) return false; return !(isBoss(c, m) && isBoss(c, c.members.find((x) => x.pid === q.by))); } // an organizer's request is never witnessed by a fellow organizer / co-organizer
  return g.s.some((s) => speaksFor(c, m, s)); }
// the removal's other way: after the expected finish, two established players from two different other teams (not the removed side, not the asker's)
const altCan = (c, q, g, m) => { if (!acctM(m) || m.ro || !estOk(m) || m.pid === q.by || D.now() < expFinish(c)) return false; const ms = teamsOfP(c, m.pid), ex = new Set(teamsOfP(c, q.by).concat(g.s.flatMap((s) => sideTeams(c, s)))); return ms.length > 0 && !ms.some((t) => ex.has(t)); };
const altOk = (c, q, g) => { if (D.now() < expFinish(c)) return false; const ts = new Set(); (q.alt || []).forEach((a) => { const m = c.members.find((x) => x.pid === a.pid); if (m && altCan(c, q, g, m)) ts.add(a.t); }); return ts.size >= 2; };
const satG = (c, q, g) => [q.by].concat(q.sigs || []).some((pid) => { const m = c.members.find((x) => x.pid === pid); return !!m && canG(c, q, g, m); }) || (!!g.alt && altOk(c, q, g));
const needOf = (c, q) => q.dir.g.filter((g) => !satG(c, q, g));
const hcpWho = (c, pid, v) => { const m = c.members.find((x) => x.pid === pid) || { pid }; return whoDir(c, { by: pid, sigs: [], dir: dirReq(c, m, 'hcp', { pid, v }) }); }; // who may OK a number a player asked for
const whoDir = (c, q) => { if (q.dec) return []; const nd = needOf(c, q), done = [q.by].concat(q.sigs || [], (q.alt || []).map((a) => a.pid)); return c.members.filter((m) => !done.includes(m.pid) && nd.some((g) => canG(c, q, g, m) || (g.alt && altCan(c, q, g, m)))).map((m) => m.pid); };
const gText = (c, g) => (g.k === 'other' ? 'a player on ' + (g.not.length ? 'another team than ' + g.not.map((t) => sName(c, t)).join(' / ') : 'another side') + ' (Oddable account at least ' + SIGNER_AGE + ' old)' : (g.k === 'bet' ? '' : 'its own player: ') + g.s.map((s) => sName(c, s)).join(' / ') + (g.alt ? ' (after the expected finish: or two players from two other teams)' : ''));
// why member m cannot sign (for the 403)
function whyNot(c, q, m) { const nd = needOf(c, q); if (nd.some((g) => g.k === 'other') && isBoss(c, m) && isBoss(c, c.members.find((x) => x.pid === q.by))) return 'You cannot sign this one: an organizer asked for it, and the witness from another team is not an organizer or co-organizer.'; if (nd.some((g) => g.k === 'other' && m.pid !== q.by && onTeamOrEntrant(c, m).length && !onTeamOrEntrant(c, m).some((t) => g.not.includes(t))) && !estOk(m)) return 'You cannot sign this one: ' + estWhy(m) + '.';
  return 'You cannot sign this one. It needs ' + nd.map((g) => gText(c, g)).join(', and ') + (whoDir(c, q).length ? ': ' + andList(names(c, whoDir(c, q))) : '') + '.'; }
// ---- the undo kept for an applied change (objection window): only the fields the change touched, old and new. Members are kept by pid, without the
// "seen" marks, so reading notices never blocks putting a change back. ----
const SNAPK = ['day', 'members', 'pot', 'pro', 'co'], SKIP = new Set(['audit', 'nso', 'eids', 'notes', 'plog', 'pend', 'harm']);
const memSnap = (ms) => { const o = {}; (ms || []).forEach((m) => { const x = clone(m); delete x.seen; delete x.hseen; o[m.pid] = x; }); return o; };
const snap = (c) => { const o = {}; SNAPK.forEach((k) => (o[k] = c[k] === undefined ? null : k === 'members' ? memSnap(c.members) : clone(c[k]))); return o; };
const snapNow = (c, k) => (k === 'members' ? memSnap(c.members) : c[k] === undefined ? null : c[k]);
function diffs(a, b, path, out) { const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (plain(a) && plain(b)) { new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => { if (!SKIP.has(k) && !(path[0] === 'members' && path.length === 2 && (k === 'seen' || k === 'hseen'))) diffs(a[k], b[k], path.concat(k), out); }); return out; }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ k: path, b: a === undefined ? null : a, a: b === undefined ? null : b, u: a === undefined, v: b === undefined }); return out; }
const dlOf = (s0, c) => { const dl = []; SNAPK.forEach((k) => diffs(s0[k], snapNow(c, k), [k], dl)); return dl; };
const memAt = (o, k) => (k[0] === 'members' && Array.isArray(o.members) ? { r: o.members.find((m) => m.pid === k[1]), k: k.slice(2) } : { r: o, k });
const getP = (o, k0) => { const { r, k } = memAt(o, k0); return k.reduce((x, y) => (x == null ? undefined : x[y]), r); };
const setP = (o, k0, v, del) => { if (k0[0] === 'members' && k0.length === 2) { o.members = o.members.filter((m) => m.pid !== k0[1]); if (!del) o.members.push(clone(v)); return; }
  const { r, k } = memAt(o, k0); if (r == null) return; let x = r; for (let i = 0; i < k.length - 1; i++) { if (x[k[i]] == null || typeof x[k[i]] !== 'object') x[k[i]] = {}; x = x[k[i]]; } if (del) delete x[k[k.length - 1]]; else x[k[k.length - 1]] = clone(v); };
// from 'a' (after) back to 'b' (before), or forward again; a field someone changed since is left alone. -> how many fields could not be moved
function moveBack(c, dl, fwd) { let n = 0; dl.forEach((x) => { const cur = getP(c, x.k), want = fwd ? x.b : x.a; if (JSON.stringify(cur === undefined ? null : cur) !== JSON.stringify(want)) { n++; return; } setP(c, x.k, fwd ? x.a : x.b, fwd ? x.v : x.u); }); return n; }
// Record an applied change that other sides may object to (INSIDE a write). info: { obj: sides that may object for 30 minutes, wnc: sides made worse
// WITHOUT their signature (Final waits 15 minutes after it), better: the sides it helps (they never uphold it), st }
function harmRec(c, kind, text, by, sigName, now, info, s0) { if (!info || !((info.obj || []).length || (info.wnc || []).length)) return; const dl = dlOf(s0, c); if (!dl.length) return;
  c.hn = (c.hn || 0) + 1; const st = info.st || 'open';
  c.harm = (c.harm || []).concat({ h: c.hn, kind, text, by: by.pid, byName: by.name, sig: sigName || undefined, at: now, sides: info.obj || [], wnc: info.wnc || [], better: info.better || [], dl, st, up: [], upAt: st === 'upheld' ? now : undefined, cf: info.cf || undefined }).slice(-60);
  if (st === 'open' && (info.obj || []).length) notify(c, 'harm', null, by.name + (sigName ? ', signed by ' + sigName : '') + ': ' + text + '. ' + info.obj.map((s) => sName(c, s)).join(', ') + ' can tap Object ' + (info.cf ? 'until 30 minutes after Final' : 'until ' + fmtCT(now + OBJ_MS)) + ' to undo it.'); }
const onSide = (c, pid, side) => (side.startsWith('p:') ? side.slice(2) === pid : playsOn(c, side, pid));
const harmedBy = (c, pid, sides) => !!pid && (sides || []).some((s) => onSide(c, pid, s));
// WHO MAY SIGN an action by `actorPid`.
//   o.need  THE AFFECTED SIDE: these accounts (team X's own players) and nobody else, whenever one of them exists. Only when X has no account does the
//           rest of this function pick a neutral third account (never on the actor's side, never on X: o.nt).
// Otherwise always: an ACCOUNT (never a typed-in guest), not the actor, on a side (or a boss on no side), and on NO side the actor is on. Then, in order:
//   o.only  only these sides may answer (a press or a match: the other side of the bet)
//   o.ex    never these people while anyone else can (the person who raised a dispute does not sign its settlement either)
//   o.aff   the affected side agreeing always counts (team X's own people for a change to team X's card)
//   1. someone who does not share an organizer role with the actor (actor is organizer / co-organizer -> the signer is neither), not on o.not / o.aff sides
//   2. if there is nobody like that (every other team has an organizer): anyone on a side other than the actor's and the affected one
//   3. if there is still nobody (a two-team game): the other side
// Everyone's own sides in ONE pass over the teams (the same answer as `sidesOf` for each person; a 100-team day asks this for every member).
function sideIdx(c) { const of = {}, add = (pid, s) => { (of[pid] = of[pid] || []).push(s); }, acct = new Set(c.members.filter(acctM).map((m) => m.pid));
  c.day.teams.forEach((t) => { t.players.forEach((p) => add(p, t.tid)); if (!t.players.length || t.players.some((p) => acct.has(p))) return; const ks = new Set(); if (t.scorer) ks.add(t.scorer); Object.values((c.day.scores || {})[t.tid] || {}).forEach((h) => { if (h.bp) ks.add(h.bp); }); ks.forEach((p) => { if (!t.players.includes(p)) add(p, t.tid); }); });
  return (pid) => (of[pid] || []).concat(lotOf(c, pid) ? ['lot:' + pid] : []); }
function signers(c, actorPid, o) {
  o = o || {}; const sidesOf = c.kind === 'day' ? sideIdx(c) : (pid) => sidesOf0(c, pid), actor = c.members.find((m) => m.pid === actorPid), aS = sidesOf(actorPid), aBoss = isBoss(c, actor), hit = (x, l) => !!l && x.s.some((s) => l.includes(s));
  if (o.need) { const own = acctOthers(c, actorPid).filter((m) => o.need.includes(m.pid)); if (own.length) return own.map((m) => m.pid); }
  const base0 = acctOthers(c, actorPid).map((m) => ({ m, s: sidesOf(m.pid) })).filter((x) => (x.s.length || isBoss(c, x.m)) && !hit(x, aS)), baseX = base0.filter((x) => !(o.ex || []).includes(x.m.pid)), base = baseX.length ? baseX : base0;
  if (o.only) return base.filter((x) => hit(x, o.only)).map((x) => x.m.pid);
  const notS = (o.not || []).concat(o.need ? o.nt || [] : []), A = base.filter((x) => hit(x, o.aff)), rest = base.filter((x) => !hit(x, notS) && !hit(x, o.aff));
  let P = rest.filter((x) => !(aBoss && isBoss(c, x.m))); if (!P.length) P = rest; if (!P.length && !A.length && !o.need) P = base;
  return [...new Set(A.concat(P).map((x) => x.m.pid))];
}
const tName = (c, tid) => ((c.day ? c.day.teams : []).find((t) => t.tid === tid) || {}).name || 'Team';
const mName = (c, pid) => (c.members.find((m) => m.pid === pid) || {}).name || 'Player';
const eTxt = (c, e) => (e.g != null ? String(e.g) : Object.keys(e.p || {}).map((p) => mName(c, p) + ' ' + e.p[p]).join(', '));
const why3 = (s, msg) => { const w = clean(s, 120); if (w.length < 3) throw bad(400, msg); return w; };
const liveOnly = (d) => { if (d.status !== 'live') throw bad(409, d.status === 'final' ? 'The round is final. It has to be reopened before anything changes.' : 'The round has not started'); };
const teamOf = (d, tid) => { const t = d.teams.find((x) => x.tid === String(tid)); if (!t) throw bad(404, 'No such team'); return t; };
const plog = (c, o) => { c.plog = (c.plog || []).concat(o); if (c.plog.length > 150) c.plog.splice(0, c.plog.length - 150); };
const matchSides = (d, m) => { const of = (id) => (m.kind === 'team' ? [id] : d.teams.filter((t) => t.players.includes(id)).map((t) => t.tid)); return { a: of(m.a), b: of(m.b) }; };
const mkMatch = (d, x, y, round) => { const H = d.heads; return { mid: rnd(6), kind: H.kind, type: H.type, a: x, b: y, amt: H.amt, net: d.net !== 'gross', offLow: H.offLow, auto: H.auto, press: H.press || 'accept', pct: H.pct, presses: [], round: round || null }; };
const matchIds = (d) => (d.heads.kind === 'player' ? d.teams.flatMap((t) => t.players) : d.teams.filter((t) => t.players.length).map((t) => t.tid));
const matchBegun = (d, m) => { const s = matchSides(d, m); return s.a.concat(s.b).some((tid) => Object.keys(d.scores[tid] || {}).length > 0); };
const putHole = (c, me, p, now, s, what) => { const d = c.day, sc = (d.scores[p.tid] = d.scores[p.tid] || {}), cur = sc[p.hole] || {};
  if (cur.st === 'confirmed' || cur.pst === 'confirmed') { d.cum = d.cum || {}; d.cum[p.tid] = d.cum[p.tid] || {}; if (d.cum[p.tid][p.hole] == null) d.cum[p.tid][p.hole] = strokesT(cur); } // X1: what the card was when first changed after its confirmation
  sc[p.hole] = Object.assign({}, p.e, { by: me.name, bp: what === 'settled' && cur.bp ? cur.bp : me.pid, at: now, rev: (cur.rev || 0) + 1, st: 'confirmed', cf: s ? s.name : me.name + (c.org === me.mk ? ' (organizer)' : ' (co-organizer)'), cfPid: s ? s.pid : me.pid, cfAt: now });
  audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, tid: p.tid, hole: p.hole, what, from: { g: cur.g, p: cur.p, note: cur.note }, to: { g: p.e.g, p: p.e.p } }); };
// THE ACTIONS. chk = may this person ask for it, and does it still fit the game (run again when it is signed); sig = who may sign; run = the change.
// always: the rule applies with or without money (cards also feed handicaps). strict: applies where handicaps are strict. money(c, p): this action
// itself puts money on the game. free(c, me, p): not a power yet (the paid list before the start, a set-up change that touches no rule).
const ACT = {
  resolve: { always: true, // settle a disputed hole. The person who raised the dispute never settles it.
    chk(c, me, p) { const d = c.day; liveOnly(d); const t = teamOf(d, p.tid), cur = (d.scores[t.tid] || {})[p.hole]; if (!cur || cur.st !== 'disputed') throw bad(409, 'Hole ' + p.hole + ' is not disputed. Only a disputed hole can be settled.');
      if (p.rev != null && cur.rev !== p.rev) throw bad(409, 'Hole ' + p.hole + ' changed since this was asked for.'); if (!isBoss(c, me) && !sidesOf(c, me.pid).length) throw bad(403, 'Only the organizer or a scorer settles disputes');
      if (cur.dfPid === me.pid) throw bad(403, 'You raised this dispute, so someone else settles it: ' + t.name + '\'s scorer, another team\'s scorer or an organizer who is not playing.');
      if (dirMode(c, 'resolve')) { // N5: in a money game the settled score is one of the two numbers in the dispute; who signs is the direction rule
        if (![cur, cur.want].filter(Boolean).some((x) => sameV(x, p.e))) throw bad(409, 'The settled score has to be one of the two numbers in the dispute: ' + eTxt(c, cur) + ' (entered)' + (cur.want ? ' or ' + eTxt(c, cur.want) + ' (what ' + (cur.df || 'the other team') + ' says)' : '') + '.', { choices: [cur, cur.want].filter(Boolean).map((x) => ({ g: x.g, p: x.p })) }); return; } },
    ref: true, flag: true, // CASUAL games only: a NEUTRAL organizer is the referee. Money games have no referee (direction rule); an Enterprise director who plays nothing settles alone
    sig: (c, me, p) => { const cur = (c.day.scores[p.tid] || {})[p.hole] || {}, ex = cur.dfPid ? [cur.dfPid] : []; return playsOn(c, teamOf(c.day, p.tid).tid, me.pid) ? {} : Object.assign(affTeam(c, me, p.tid), { ex }); },
    say: (c, me, p) => { const cur = (c.day.scores[p.tid] || {})[p.hole]; return 'settle ' + tName(c, p.tid) + ' hole ' + p.hole + (cur ? ': ' + eTxt(c, cur) + ' → ' : ' as ') + eTxt(c, p.e); }, run: (c, me, p, now, s) => putHole(c, me, p, now, s, 'settled') },
  correct: { always: true, // change a hole that was already confirmed
    chk(c, me, p) { const d = c.day; liveOnly(d); const t = teamOf(d, p.tid), cur = (d.scores[t.tid] || {})[p.hole]; if ((d.wd || {})[t.tid]) throw bad(409, 'This team was marked withdrawn (did not finish).'); if (!cur || cur.st !== 'confirmed') throw bad(409, 'Hole ' + p.hole + ' is not a confirmed hole any more.');
      if (p.rev != null && cur.rev !== p.rev) throw bad(409, 'Hole ' + p.hole + ' changed since this was asked for.'); if (!isBoss(c, me) && t.scorer !== me.pid) throw bad(403, 'Hole ' + p.hole + ' is confirmed. Its scorer or the organizer can ask for a change; someone from another team signs it.'); },
    flag: true, sig: (c, me, p) => affTeam(c, me, teamOf(c.day, p.tid).tid),
    say: (c, me, p) => { const cur = (c.day.scores[p.tid] || {})[p.hole]; return 'change ' + tName(c, p.tid) + ' hole ' + p.hole + ' (confirmed): ' + (cur ? eTxt(c, cur) : '?') + ' → ' + eTxt(c, p.e); }, run: (c, me, p, now, s) => putHole(c, me, p, now, s, 'confirmed hole changed') },
  withdraw: { nk: 'wd', // mark a team did not finish, or put it back. A team with a COMPLETE card can never be marked withdrawn (H3).
    // N1: a team puts ITSELF back in at any time before Final (no signature) and keeps scoring. Marking it is never done alone, never on idle time:
    // only after the round's expected finish (first tee + 5 h 30 for 18 holes, 3 h for 9, or the end the organizer set), and signed under the direction rule.
    free: (c, me, p) => !dirMode(c, 'withdraw') && p.on === false && playsOn(c, p.tid, me.pid), must: (c, me, p) => p.on !== false && !playsOn(c, p.tid, me.pid), // a team may always take ITSELF out
    chk(c, me, p, now) { const d = c.day; if (d.status !== 'live') throw bad(409, d.status === 'final' ? 'The round is final. Reopen scoring first.' : 'The round has not started'); const t = teamOf(d, p.tid), has = !!(d.wd || {})[t.tid];
      if (p.on === false) { if (!isBoss(c, me) && !playsOn(c, t.tid, me.pid)) throw bad(403, 'Only the team itself or the organizer puts a team back in'); if (!has) throw bad(409, t.name + ' is not marked withdrawn.'); return; }
      if (!isBoss(c, me)) throw bad(403, 'Only the organizer marks a team withdrawn'); if (has) throw bad(409, t.name + ' is already marked withdrawn.'); why3(p.reason, 'Give a reason for marking the team withdrawn (3+ characters)');
      if (Object.keys(d.scores[t.tid] || {}).length >= d.course.par.length) throw bad(409, t.name + ' has a complete card (' + d.course.par.length + ' of ' + d.course.par.length + ' holes). A team that finished cannot be marked did not finish. Dispute a hole if a score is wrong.', { complete: true });
      if ((now || D.now()) < expFinish(c)) throw bad(409, 'A team can be marked did not finish only after the round\'s expected finish time, ' + fmtCT(expFinish(c)) + '. Until then it is still playing.', { until: expFinish(c) }); },
    // No money: the team's own account signs (round 4). The 30-minute idle way out is gone (N1).
    flag: true, sig: (c, me, p) => { const t = teamOf(c.day, p.tid), o = affTeam(c, me, t.tid); if (!o.need) return o; if (p.on === false) return { not: [t.tid] }; return o; }, say: (c, me, p) => (p.on === false ? 'put ' + tName(c, p.tid) + ' back in (undo did not finish)' : 'mark ' + tName(c, p.tid) + ' did not finish: ' + clean(p.reason, 120) + ' (no place, no prize money)'),
    run(c, me, p, now, s) { const d = c.day, t = teamOf(d, p.tid); d.wd = d.wd || {}; if (p.on === false) { delete d.wd[t.tid]; audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, tid: t.tid, what: 'withdrawal undone' }); } else { d.wd[t.tid] = { by: me.name, sig: s ? s.name : undefined, at: now, reason: clean(p.reason, 120) }; audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, tid: t.tid, what: 'withdrawn', note: clean(p.reason, 120) }); } } },
  final: { nk: 'forced', // finish a money round while holes were never confirmed
    chk(c, me, p) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer starts or finishes the round'); if (d.status !== 'live') throw bad(409, d.status === 'final' ? 'The round is already final' : 'The round has not started'); finalBlock(c, me); why3(p.reason, 'Give a reason for finishing with unconfirmed holes (3+ characters)'); },
    sig: () => ({}), say: (c, me, p) => { const un = unconfirmed(c, me); return 'finish the round with ' + un.n + ' hole' + (un.n === 1 ? '' : 's') + ' never confirmed. Reason: ' + clean(p.reason, 120); },
    run(c, me, p, now, s) { const d = c.day, un = unconfirmed(c, me); d.forced = { by: me.name, sig: s ? s.name : undefined, at: now, reason: clean(p.reason, 120), holes: un.n, side: un.side, alone: !acctOthers(c, me.pid).length }; audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: 'final forced', note: un.n + ' unconfirmed: ' + clean(p.reason, 120) }); closeDisputes(c, now); d.status = 'final'; d.finalAt = now; c.pend = []; audit(d, { at: now, by: me.name, what: 'final' }); finalTold(c, me, now); } },
  // N3: the time-out Final. Holes still not confirmed 2 hours after the expected finish (the teams were told): those teams rank "not confirmed", no prize money.
  ncfinal: { nk: 'forced', free: () => true,
    chk(c, me, p, now) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer starts or finishes the round'); if (d.status !== 'live') throw bad(409, d.status === 'final' ? 'The round is already final' : 'The round has not started');
      const due = expFinish(c) + 2 * 3600e3; if ((now || D.now()) < due) throw bad(409, 'Teams with holes nobody confirmed have until ' + fmtCT(due) + ' (2 hours after the expected finish) to get them confirmed.', { until: due });
      const un = unconfT(c), late = un.filter((t) => !((d.ncN || {})[t] && (now || D.now()) - d.ncN[t] >= 900e3)); if (late.length) throw bad(409, late.map((t) => tName(c, t)).join(', ') + (late.length === 1 ? ' was' : ' were') + ' told only now (or less than 15 minutes ago) that unconfirmed holes rank them "not confirmed". Try again in 15 minutes.', { told: late }); },
    sig: () => ({}), say: (c) => 'finish the round: ' + unconfT(c).map((t) => tName(c, t)).join(', ') + ' rank "not confirmed" (holes nobody confirmed by ' + fmtCT(expFinish(c) + 2 * 3600e3) + '; no place, no prize money)',
    run(c, me, p, now) { const d = c.day; d.nc = {}; unconfT(c).forEach((t) => (d.nc[t] = { at: now })); audit(d, { at: now, by: me.name, what: 'final: not confirmed', note: Object.keys(d.nc).map((t) => tName(c, t)).join(', ') }); closeDisputes(c, now); d.status = 'final'; d.finalAt = now; c.pend = []; audit(d, { at: now, by: me.name, what: 'final' }); finalTold(c, me, now); } },
  reopen: { nk: 'reopen', // only a Final round, only with a reason
    chk(c, me, p) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer starts or finishes the round'); if (d.status !== 'final') throw bad(409, 'Only a finished round can be reopened'); why3(p.reason, 'Give a reason for reopening the round (3+ characters). Every player is told.'); },
    // H3: where something is at stake a FORCED Final closes the round for good unless someone else signs the reopen, and an interested organizer never reopens alone
    must: (c, me) => stakes(c) && (!!c.day.forced || interested(c, me.pid)), closed: true,
    sig: () => ({}), say: (c, me, p) => 'reopen the round after it was final. Reason: ' + clean(p.reason, 120) + '. Scores, winners and payouts can change until it is finished again; changed holes need a fresh confirmation',
    run(c, me, p, now, s) { const d = c.day, why = clean(p.reason, 120); d.status = 'live'; delete d.forced; delete d.nc; d.reopens = (d.reopens || []).concat({ at: now, by: me.name, sig: s ? s.name : undefined, reason: why }).slice(-20); audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: 'reopen', note: why }); } },
  paid: { nk: 'paid', // the paid list. Before the start the organizer keeps it freely; after it every change is a power; a Final game is closed.
    free: (c, me, p) => (c.kind === 'day' ? c.day.status === 'setup' : !p.started),
    chk(c, me, p) { if (c.org !== me.mk) throw bad(403, 'Only the organizer marks entries paid'); const m = c.members.find((x) => x.pid === p.pid); if (!m) throw bad(404, 'Not a member'); if (!!m.paid === !!p.paid) throw bad(409, m.name + ' is already marked ' + (m.paid ? 'paid' : 'not paid') + '.', { same: true });
      if (c.kind === 'day' && c.day.status === 'final') throw bad(409, 'The paid list is closed: the round is final. Reopen scoring (with a reason) to change it.', { frozen: true });
      if (c.kind === 'pro' && p.done) { if (!p.paid) throw bad(409, 'The paid list is closed: this pool is final. Nobody can be marked not paid now.', { frozen: true }); if (clean(p.reason, 120).length < 3) throw bad(409, 'The paid list is closed: this pool is final. To mark a late payment give a reason; everyone in the pool is told.', { frozen: true, needReason: true }); } },
    // NOT PAID takes the player's own signature (the affected side). PAID after the start adds a share of the prize money: someone who is not on that player's side signs.
    flag: true, pin: true, sig: (c, me, p) => { const o = affPlayer(c, me, p.pid); return !o.need ? {} : p.paid ? { not: o.nt } : o; },
    say: (c, me, p) => 'mark ' + mName(c, p.pid) + (p.paid ? ' paid (was not paid)' : ' not paid (was paid)') + (clean(p.reason, 120) ? '. Reason: ' + clean(p.reason, 120) : ''),
    run(c, me, p, now, s) { const m = c.members.find((x) => x.pid === p.pid); m.paid = !!p.paid; if (ACT.paid.free(c, me, p)) return; if (c.kind === 'pro' && p.done) c.pro.doneAt = c.pro.doneAt || now;
      c.paidLog = (c.paidLog || []).concat({ at: now, by: me.name, sig: s ? s.name : undefined, name: m.name, paid: !!p.paid, reason: clean(p.reason, 120) }).slice(-50); if (c.kind === 'day') audit(c.day, { at: now, by: me.name, sig: s ? s.name : undefined, what: p.paid ? 'marked paid' : 'marked not paid', pid: m.pid, note: m.name }); } },
  hcp: { strict: true, // set or change a player's handicap for this game (in an Enterprise tournament: the director, through the stats module, with a reason)
    chk(c, me, p, now) { const d = c.day, pm = c.members.find((m) => m.pid === p.pid); if (!pm) throw bad(404, 'Not a member'); if (hLocked(d, now)) throw bad(409, 'Handicaps are closed: the ' + (c.ent ? 'tournament' : 'round') + ' has started');
      if (c.ent) { if (c.org !== me.mk) throw bad(403, 'The tournament director sets handicaps'); if (!dirNeutral(c, me)) throw bad(403, 'A tournament director who plays in the event, keeps a card or holds a Calcutta lot in it cannot set handicaps. Have a director who does not play run the tournament.', { notNeutral: true }); why3(p.reason, 'Give a reason for the tournament handicap (3+ characters)'); return; }
      if (!isBoss(c, me)) throw bad(403, 'Only the organizer sets other players\' handicaps'); const src = (d.hsrc || {})[p.pid];
      if (src === 'oddable' || src === 'tournament') throw bad(409, src === 'oddable' ? 'This player has an ' + HCP_LABEL + ' from their rounds in the app; it is the handicap. ' + HCP_NOTE : 'The tournament director set this handicap.'); },
    // A number the player ASKED for (the affected side already agreed): someone who is not on that player's team signs. A number nobody asked for:
    // the player's own account signs (H1). An Enterprise director who is neutral sets tournament numbers alone, with a reason (owner rule E-H).
    pin: true, sig: (c, me, p) => (p.ask ? { not: teamsOfP(c, p.pid) } : affPlayer(c, me, p.pid)),
    say: (c, me, p) => { const d = c.day, old = (d.hsrc || {})[p.pid] && d.hsrc[p.pid] !== 'none' && d.hcp[p.pid] != null ? Number(d.hcp[p.pid]).toFixed(1) : 'none'; return 'set ' + mName(c, p.pid) + '\'s handicap: ' + old + ' → ' + Number(p.v).toFixed(1) + (p.ask ? ' (the number ' + mName(c, p.pid) + ' asked for)' : '') + (clean(p.reason, 80) ? '. Reason: ' + clean(p.reason, 80) : ''); },
    pre: async (c, me, p) => { if (!c.ent) return null; if (!D.stats()) return { local: true }; /* Golf alone (no stats module): the director's number is kept on the game */ const pm = c.members.find((m) => m.pid === p.pid); if (!pm) throw bad(404, 'Not a member'); await D.eventOverride(c.orgE, EID(c.id), keyOfMember(pm), { hcp: p.v, reason: clean(p.reason, 80), name: pm.name, byName: me.name }); return hcpOf(keyOfMember(pm), hOpts(c)); }, // stored and LOGGED by the stats module (one log)
    run(c, me, p, now, s, x) { const d = c.day, old = d.hcp[p.pid] == null ? null : d.hcp[p.pid];
      if (c.ent && x && x.local) { d.hsrc = d.hsrc || {}; d.hcp[p.pid] = p.v; d.hsrc[p.pid] = 'tournament'; if (d.hreq) delete d.hreq[p.pid]; d.tset = d.tset || {}; d.tset[p.pid] = { v: p.v, by: me.name, sig: s ? s.name : undefined, at: now, reason: clean(p.reason, 80), local: true }; }
      else if (c.ent) { if (!x) throw bad(409, 'Try again'); applyIdx(d, p.pid, x); d.tset = d.tset || {}; d.tset[p.pid] = Object.assign({}, d.tset[p.pid], { v: p.v, by: me.name, sig: s ? s.name : undefined, at: now, reason: clean(p.reason, 80) }); }
      else setTyped(d, p.pid, p.v, me, now, s ? s.name : dirMode(c, 'hcp') ? 'not needed: the player\'s own number, not higher' : undefined);
      audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: 'handicap', pid: p.pid, from: old, to: p.v }); } },
  extrareopen: { nk: 'side', // reopen a CONFIRMED closest-to-the-pin / longest-drive winner
    chk(c, me, p) { const d = c.day; if (!isBoss(c, me)) throw bad(403, 'Only the organizer reopens a confirmed winner'); liveOnly(d); const cur = ((d.win || {})[p.kind] || {})[p.hole]; if (!cur || cur.st !== 'confirmed') throw bad(409, 'That winner is not confirmed. Enter the right one.'); why3(p.reason, 'Give a reason for reopening this winner (3+ characters). Every player is told.'); },
    flag: true, sig: (c, me, p) => { const w = ((c.day.win || {})[p.kind] || {})[p.hole] || {}, ws = c.day.teams.filter((t) => t.tid === w.who || t.players.includes(w.who)).map((t) => t.tid); return ws.some((s) => playsOn(c, s, me.pid)) ? {} : { need: acctsOn(c, ws), nt: ws }; },
    say: (c, me, p) => 'reopen the ' + (p.kind === 'ld' ? 'longest drive' : 'closest to the pin') + ' winner on hole ' + p.hole + '. Reason: ' + clean(p.reason, 120) + '. It needs a fresh confirmation',
    run(c, me, p, now, s) { const d = c.day, cur = d.win[p.kind][p.hole]; cur.st = 'reopened'; cur.ro = { by: me.name, sig: s ? s.name : undefined, at: now, reason: clean(p.reason, 120) }; audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, hole: p.hole, what: p.kind + ' reopened', note: clean(p.reason, 120) }); } },
  tiers: { // pick six: the organizer's own tier order (only before anyone has picked; the check is made INSIDE the write, L1)
    chk(c, me, p, now) { if (c.org !== me.mk) throw bad(403, 'Only the organizer sets the tiers'); if (c.pro.lockAt && now >= c.pro.lockAt) throw bad(409, 'Picks are closed'); if (Object.values(c.pro.entries).some((e) => e.picks && e.picks.length)) throw bad(409, 'Someone already picked. Tiers are fixed now.'); },
    sig: () => ({}), say: (c, me, p) => (p.rank.length ? 'change the tier order to the organizer\'s own list (' + p.moved + ' golfer' + (p.moved === 1 ? '' : 's') + ' change tier)' : 'put the tier order back to the neutral default'),
    run(c, me, p, now, s) { const P = c.pro; P.rank = p.rank; P.tiers = p.tiers; P.basis = p.basis; P.tierLog = (P.tierLog || []).concat({ at: now, by: me.name, sig: s ? s.name : undefined, what: p.rank.length ? 'Tier order changed to the organizer\'s own list' : 'Tier order put back to the neutral default', n: p.rank.length, top: p.rank.slice(0, 6), moved: p.moved }).slice(-50); } },
  match: { money: (c) => c.day.heads.amt > 0, // add a heads-up match (a money match is a bet between two sides: before the start the other side signs; after it BOTH sides sign)
    chk(c, me, p) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer sets up matches'); if (d.status === 'final') throw bad(409, 'The round is final'); const ids = matchIds(d); if (p.a === p.b || !ids.includes(p.a) || !ids.includes(p.b)) throw bad(400, 'Pick two different ' + (d.heads.kind === 'player' ? 'players' : 'teams'));
      if (d.matches.length >= 200) throw bad(409, 'Too many matches'); if (d.status !== 'setup' && matchBegun(d, { kind: d.heads.kind, a: p.a, b: p.b })) throw bad(409, 'Matches are set: these sides have started playing.');
      // M3: a money match on a net game switches strict handicaps on, and those are checked at Start. After the start it can only be added where they already are strict (or the match is gross).
      if (d.status !== 'setup' && d.heads.amt > 0 && d.net !== 'gross' && !hStrict(c)) throw bad(409, 'A money match on a net game has to be set before the round starts: handicaps are checked at the start.'); },
    sig: (c, me, p, m0) => { const s = matchSides(c.day, m0 || { kind: c.day.heads.kind, a: p.a, b: p.b }), mine = sidesOf(c, me.pid), inA = s.a.some((x) => mine.includes(x)), inB = s.b.some((x) => mine.includes(x)); return inA && !inB ? { only: s.b } : inB && !inA ? { only: s.a } : inA ? {} : { aff: s.a.concat(s.b) }; },
    say: (c, me, p) => { const d = c.day, nm = (id) => (d.heads.kind === 'player' ? mName(c, id) : tName(c, id)); return 'add a ' + (d.heads.amt > 0 ? '$' + d.heads.amt + ' ' : '') + (d.heads.type === 'nassau' ? 'Nassau' : 'match') + ': ' + nm(p.a) + ' v ' + nm(p.b); },
    run(c, me, p, now, s) { const d = c.day, m = mkMatch(d, p.a, p.b); d.matches.push(m); audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: 'match added', mid: m.mid, note: ACT.match.say(c, me, p).slice(6) }); demoteSelfTyped(c, now); } },
  matchdel: { money: (c, p) => ((c.day.matches.find((m) => m.mid === p.mid) || {}).amt || 0) > 0,
    chk(c, me, p) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer sets up matches'); if (d.status === 'final') throw bad(409, 'The round is final'); const m = d.matches.find((x) => x.mid === p.mid); if (!m) throw bad(404, 'No such match'); if (d.status !== 'setup' && matchBegun(d, m)) throw bad(409, 'Matches are set: these sides have started playing.'); },
    sig: (c, me, p) => ACT.match.sig(c, me, p, c.day.matches.find((m) => m.mid === p.mid)), say: (c, me, p) => { const m = c.day.matches.find((x) => x.mid === p.mid) || {}, nm = (id) => (m.kind === 'player' ? mName(c, id) : tName(c, id)); return 'remove the ' + (m.amt > 0 ? '$' + m.amt + ' ' : '') + 'match ' + nm(m.a) + ' v ' + nm(m.b); },
    run(c, me, p, now, s) { const d = c.day; audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: 'match removed', mid: p.mid }); d.matches = d.matches.filter((m) => m.mid !== p.mid); } },
  draw: { money: (c) => c.day.heads.amt > 0, // draw all the matches (set-up only)
    chk(c, me) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer sets up matches'); if (d.status !== 'setup') throw bad(409, d.status === 'final' ? 'The round is final' : 'Matches are set: the round has started'); },
    sig: () => ({}), say: (c) => 'draw the ' + (c.day.heads.amt > 0 ? '$' + c.day.heads.amt + ' ' : '') + 'matches (' + c.day.heads.pair + ')',
    run(c, me, p, now, s) { const d = c.day, H = d.heads, ids = matchIds(d); let L = ids.slice(); if (H.pair === 'random') { for (let i = L.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [L[i], L[j]] = [L[j], L[i]]; } }
      const pairs = []; if (H.pair === 'bracket') { for (let i = 0; i < Math.floor(L.length / 2); i++) pairs.push([L[i], L[L.length - 1 - i]]); } else if (H.pair === 'foursome' && H.kind === 'player') { d.teams.forEach((t) => { for (let i = 0; i + 1 < t.players.length; i += 2) pairs.push([t.players[i], t.players[i + 1]]); }); } else for (let i = 0; i + 1 < L.length; i += 2) pairs.push([L[i], L[i + 1]]);
      d.matches = pairs.map(([x, y]) => mkMatch(d, x, y, H.pair === 'bracket' ? 1 : null)); audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: 'matches drawn', note: pairs.length + ' matches' }); demoteSelfTyped(c, now); } },
  setup: { money: (c, p) => stakes(c) || !!p.stk, // a set-up change that touches the format, strokes, flights, side games or which board the money follows
    free: (c, me, p) => !p.touch,
    chk(c, me) { if (c.org !== me.mk) throw bad(403, 'Only the organizer changes the setup'); if (c.day.status !== 'setup') throw bad(409, 'The round has started; setup is closed'); },
    pin: true, sig: () => ({}), say: (c, me, p) => 'change the rules of the game: ' + (ruleDiff(c.day, p.x, p.course) || p.touch),
    run(c, me, p, now) { const d = c.day; Object.assign(d, p.x); if (p.course) d.course = p.course; d.teams.forEach((t) => (t.slots = Math.max(t.players.length, Math.min(4, num(t.slots, 1, 4) || d.teamSize)))); demoteSelfTyped(c, now); } },
  remove: { always: true, flag: true, nk: 'remove', // take a player or a team out. Before the start: the organizer. After it (X2): the player's own signature (a team: its player), or, unreachable after the expected finish, two players from two other teams. The removed keep a read-only seat and can object.
    free: (c) => c.day.status === 'setup',
    // M2: an account that has not played a hole 10 minutes after the start (on no team, or on a team with no hole on its card) is removed by the organizer alone, with a notice
    solo: (c, me, p, now) => { const d = c.day; if (d.status !== 'live' || !p.pid || (now || D.now()) - (d.startAt || d.lockAt || 0) < 600e3) return false; return !teamsOfP(c, p.pid).length && !d.teams.some((t) => keeps(c, t, p.pid)); }, // N2: only an account on NO team that keeps no card
    chk(c, me, p) { const d = c.day; if (c.org !== me.mk) throw bad(403, 'Only the organizer removes a player or a team'); if (d.status === 'final') throw bad(409, 'The round is final. It has to be reopened before anyone is removed.');
      if (p.tid) teamOf(d, p.tid); else { const m = c.members.find((x) => x.pid === p.pid); if (!m) throw bad(404, 'Not a member'); if (m.mk === c.org) throw bad(409, 'The organizer cannot be removed'); }
      if (d.status !== 'setup') why3(p.reason, 'Give a reason for removing them (3+ characters). Every player is told.'); },
    sig: (c, me, p) => (p.tid ? affTeam(c, me, teamOf(c.day, p.tid).tid) : affPlayer(c, me, p.pid)),
    say: (c, me, p) => 'remove ' + (p.tid ? tName(c, p.tid) + ' (the whole team, with its card)' : mName(c, p.pid) + (teamsOfP(c, p.pid).length ? ' from ' + teamsOfP(c, p.pid).map((t) => tName(c, t)).join(', ') : '')) + ' from the game' + (clean(p.reason, 120) ? '. Reason: ' + clean(p.reason, 120) : '') + (c.day.status !== 'setup' ? '. Prize money and side games are worked out again without them' : ''),
    run(c, me, p, now, s) { const d = c.day, nm = p.tid ? tName(c, p.tid) : mName(c, p.pid); removeIn(c, p); audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, what: p.tid ? 'team removed' : 'player removed', note: nm + (clean(p.reason, 120) ? ': ' + clean(p.reason, 120) : '') }); } },
  // M4 (round 6): a late player joins an existing team before that team has posted hole 3. Other teams are told; in a money game another team signs.
  latejoin: { nk: 'act',
    chk(c, me, p) { const d = c.day; liveOnly(d); const t = teamOf(d, p.tid), m = c.members.find((x) => x.pid === p.pid); if (!m || m.left) throw bad(404, 'Not a member');
      if (me.pid !== p.pid && !isBoss(c, me)) throw bad(403, 'The player joins, or the organizer adds them'); if (teamsOfP(c, p.pid).length) throw bad(409, m.name + ' is already on a team.');
      if (t.players.length >= t.slots) throw bad(409, 'That team is full'); if (Object.keys(d.scores[t.tid] || {}).some((h) => Number(h) >= 3)) throw bad(409, t.name + ' has posted hole 3 or later. A late player joins a team only before its hole 3.', { late: true });
      if (hStrict(c) && ((d.hsrc || {})[p.pid] || 'none') === 'none') throw bad(409, m.name + ' has no handicap, and handicaps closed at the start. A late player needs an Oddable index in this game.', { needHcp: true }); },
    sig: () => ({}), say: (c, me, p) => 'add ' + mName(c, p.pid) + ' to ' + tName(c, p.tid) + ' (joined late, before hole 3)',
    run(c, me, p, now, s) { const d = c.day, t = teamOf(d, p.tid); t.players.push(p.pid); if (!t.scorer) t.scorer = p.pid; audit(d, { at: now, by: me.name, sig: s ? s.name : undefined, tid: t.tid, what: 'late player added', note: mName(c, p.pid) }); notify(c, 'act', me, mName(c, p.pid) + ' joined ' + t.name + ' late (before hole 3)' + (s && s.name ? ', signed by ' + s.name : '') + '.'); } },
  // M3 (round 6): rain. "Shorten to 9": every team with a card signs; the front nine counts (9-hole handicaps), holes 10 to 18 are set aside (kept in `back9`).
  short9: { nk: 'act', pin: true,
    chk(c, me) { const d = c.day; liveOnly(d); if (d.course.par.length !== 18) throw bad(409, 'The round is already 9 holes.'); if (!isBoss(c, me) && !teamsOfP(c, me.pid).length) throw bad(403, 'A player on a team or the organizer asks for it');
      const open = d.teams.filter((t) => t.players.length && !(d.wd || {})[t.tid] && [1, 2, 3, 4, 5, 6, 7, 8, 9].some((h) => !(d.scores[t.tid] || {})[h])); if (open.length) throw bad(409, open.map((t) => t.name).join(', ') + (open.length === 1 ? ' has' : ' have') + ' not finished the front nine. Shorten to 9 once every team has.', { front: open.map((t) => t.tid) }); },
    sig: () => ({}), say: () => 'shorten the round to 9 holes (rain): the front nine counts and holes 10 to 18 are set aside',
    run(c, me, p, now, s) { const d = c.day, C = d.course, si = C.hcp.slice(0, 9), rank = si.map((v) => si.filter((w) => w < v).length + 1); d.back9 = {};
      d.teams.forEach((t) => { const sc = d.scores[t.tid] || {}; Object.keys(sc).forEach((h) => { if (Number(h) > 9) { (d.back9[t.tid] = d.back9[t.tid] || {})[h] = sc[h]; delete sc[h]; } }); });
      d.course18 = C; d.course = Object.assign({}, C, { holes: 9, par: C.par.slice(0, 9), hcp: rank, rating: Number.isFinite(Number(C.rating)) && C.rating != null ? Math.round(Number(C.rating) / 2 * 10) / 10 : C.rating });
      d.short9 = { at: now, by: me.name, sig: s && s.name ? s.name : undefined }; audit(d, { at: now, by: me.name, sig: s && s.name ? s.name : undefined, what: 'shortened to 9 holes', note: 'rain' }); } },
  // ----- one and done (H2): the prize money, the end of the season and a refreshed result all go through the rule -----
  oadmoney: { always: true, pin: true, nk: 'oad',
    chk(c, me, p, now) { if (c.org !== me.mk) throw bad(403, 'Only the organizer enters prize money'); const E = c.pro.oad.events[p.ev]; if (!E) throw bad(404, 'No picks for that tournament'); if (!(E.lockAt && now >= E.lockAt)) throw bad(409, 'That tournament has not started'); if (E.by === 'money') throw bad(409, 'The tour feed has the prize money for this tournament (two matching reads). Typed prize money is only for a tournament the feed has no earnings for.', { feed: true }); },
    sig: () => ({}), say: (c, me, p) => { const E = c.pro.oad.events[p.ev] || { picks: {} }, nm = (id) => (Object.values(E.picks).find((x) => x.g === id) || {}).n || id, f = (v) => '$' + Number(v || 0).toLocaleString('en-US'); return 'enter the prize money for ' + (E.name || 'the tournament') + ' by hand: ' + Object.keys(p.money).map((id) => nm(id) + ' ' + (E.res ? (E.by === 'points' ? (E.res[id] || 0) + ' points' : f(E.res[id])) : 'no result') + ' → ' + f(p.money[id])).join(', '); },
    run(c, me, p, now, s) { const E = c.pro.oad.events[p.ev]; E.prev = E.res && E.by !== 'money-manual' ? { res: E.res, by: E.by } : E.prev || null; E.res = p.money; E.by = 'money-manual'; E.resAt = E.resAt || now; delete E.read; E.manual = { by: me.name, sig: s ? s.name : undefined, at: now }; c.pro.oad.log = (c.pro.oad.log || []).concat({ at: now, by: me.name, sig: s ? s.name : undefined, what: 'Prize money entered for ' + E.name, money: p.money }).slice(-100); } },
  endseason: { always: true, nk: 'oad',
    chk(c, me) { if (c.org !== me.mk) throw bad(403, 'Only the organizer ends the season'); if (c.pro.oad.ended) throw bad(409, 'The season is already over.', { same: true }); },
    sig: () => ({}), say: () => 'end the season now: the table becomes final and the paid list closes',
    run(c, me, p, now, s) { c.pro.oad.ended = now; c.pro.oad.log = (c.pro.oad.log || []).concat({ at: now, by: me.name, sig: s ? s.name : undefined, what: 'Season ended' }).slice(-100); } },
  oadrefresh: { always: true, pin: true, nk: 'oad', // H6: read a stored result again from the tour feed, within 48 hours of the first one
    chk(c, me, p, now) { if (c.org !== me.mk) throw bad(403, 'Only the organizer refreshes a result'); const E = c.pro.oad.events[p.ev]; if (!E || !E.res) throw bad(409, 'That tournament has no stored result yet.'); if (!E.resAt || now - E.resAt > 48 * 3600e3) throw bad(409, 'A result can be refreshed for 48 hours after it was stored. That time has passed.'); if (c.pro.oad.ended) throw bad(409, 'The season is over. The table is final.'); },
    sig: () => ({}), say: (c, me, p) => { const E = c.pro.oad.events[p.ev] || { picks: {}, res: {} }, ids = [...new Set(Object.values(E.picks).map((x) => x.g))].filter((id) => ((E.res || {})[id] || 0) !== (p.res[id] || 0)), nm = (id) => (Object.values(E.picks).find((x) => x.g === id) || {}).n || id; return 'refresh the result of ' + (E.name || 'the tournament') + ' from the tour feed' + (ids.length ? ': ' + ids.map((id) => nm(id) + ' ' + ((E.res || {})[id] || 0) + ' → ' + (p.res[id] || 0)).join(', ') : ' (no picked golfer changes)'); },
    run(c, me, p, now, s) { const E = c.pro.oad.events[p.ev]; E.prev = { res: E.res, by: E.by }; E.res = p.res; E.by = p.by; delete E.manual; E.refreshed = { by: me.name, sig: s ? s.name : undefined, at: now }; c.pro.oad.log = (c.pro.oad.log || []).concat({ at: now, by: me.name, sig: s ? s.name : undefined, what: 'Result refreshed from the tour feed for ' + E.name }).slice(-100); } },
};
// Take a player or a team out (INSIDE a write). Money is always worked out from who is on a team, so pots, payouts, skins and matches follow by themselves.
function removeIn(c, p) { const d = c.day, live = d.status !== 'setup';
  const dropT = (tid) => { d.teams = d.teams.filter((t) => t.tid !== tid); delete d.scores[tid]; ['wd', 'nso'].forEach((k) => { if (d[k]) delete d[k][tid]; }); if (d.flights && d.flights.of) delete d.flights.of[tid]; d.matches = d.matches.filter((m) => !(m.kind === 'team' && (m.a === tid || m.b === tid))); ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((h) => { if (d.win[k][h].who === tid) delete d.win[k][h]; })); c.pend = (c.pend || []).filter((q) => q.p.tid !== tid); };
  const dropP = (pid) => { const wasOn = d.teams.some((t) => t.players.includes(pid)); d.teams.forEach((t) => { if (!t.players.includes(pid)) return; t.players = t.players.filter((x) => x !== pid); if (t.scorer === pid) t.scorer = t.players[0] || null; Object.values(d.scores[t.tid] || {}).forEach((h) => { if (h.p) delete h.p[pid]; }); });
    d.matches = d.matches.filter((m) => !(m.kind === 'player' && (m.a === pid || m.b === pid))); ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((h) => { if (d.win[k][h].who === pid) delete d.win[k][h]; }));
    ['hcp', 'hsrc', 'hby', 'hreq', 'odx', 'tset'].forEach((k) => { if (d[k]) delete d[k][pid]; }); c.co = (c.co || []).filter((x) => x !== pid); c.pend = (c.pend || []).filter((q) => q.by !== pid && q.p.pid !== pid);
    const m = c.members.find((x) => x.pid === pid); if (live && wasOn && m && m.mk && !m.guest) { m.left = D.now(); m.ro = true; } else c.members = c.members.filter((x) => x.pid !== pid); }; // X2: a removed account keeps a READ-ONLY seat (sees the game, can object)
  if (p.tid) { const t = teamOf(d, p.tid); t.players.slice().forEach((pid) => { const m = c.members.find((x) => x.pid === pid); if (m && m.guest) dropP(pid); }); dropT(t.tid); } // the team's accounts stay in the game, on no team; its typed-in guests go with it
  else { dropP(p.pid); if (live) d.teams.filter((t) => !t.players.length && Object.keys(d.scores[t.tid] || {}).length).forEach((t) => dropT(t.tid)); } }
// What a set-up change changes, old → new, for the people who sign it (M4).
function ruleDiff(d0, x, course) { if (!x) return ''; const out = [], f = (v) => (v == null || v === '' ? 'none' : Array.isArray(v) ? (v.length ? v.join('/') : 'none') : v === true ? 'on' : v === false ? 'off' : String(v)), $ = (v) => '$' + (Math.round(Number(v || 0) * 100) / 100), pc = (v) => (v == null ? 'none' : v + '%');
  const add = (label, a, b, fm) => { if (JSON.stringify(a == null ? null : a) !== JSON.stringify(b == null ? null : b)) out.push(label + ' ' + (fm || f)(a) + ' → ' + (fm || f)(b)); }, fn = (v) => (S.FORMATS[v] || {}).name || f(v);
  add('format', d0.fmt, x.fmt, fn); add('scoring', d0.net, x.net); add('team size', d0.teamSize, x.teamSize); add('team allowances', d0.allow, x.allow); add('handicap percent', d0.pct, x.pct, pc); add('balls that count', d0.count, x.count);
  add('prize money follows', d0.payBy, x.payBy); add('flights', (d0.flights || {}).n || 0, (x.flights || {}).n || 0); add('drives per player', d0.drives, x.drives); add('missing-drive penalty', d0.drivePen, x.drivePen);
  const e0 = d0.extras || { skins: {}, ctp: [], ld: [] }, e1 = x.extras || e0; add('skins', !!e0.skins.on, !!e1.skins.on); add('skins', e0.skins.amt, e1.skins.amt, $); add('net skins', !!e0.skins.net, !!e1.skins.net); add('skins left after the last hole', e0.skins.end || 'split', e1.skins.end || 'split'); add('skins of a withdrawn team', e0.skins.wd || 'stand', e1.skins.wd || 'stand');
  add('closest to the pin holes', e0.ctp, e1.ctp); add('closest to the pin', e0.ctpAmt, e1.ctpAmt, $); add('longest drive holes', e0.ld, e1.ld); add('longest drive', e0.ldAmt, e1.ldAmt, $);
  const h0 = d0.heads || {}, h1 = x.heads || h0; add('matches', !!h0.on, !!h1.on); add('matches between', h0.kind, h1.kind); add('match type', h0.type, h1.type); add('match amount', h0.amt, h1.amt, $); add('match handicap percent', h0.pct, h1.pct, pc); add('strokes off the low player', h0.offLow !== false, h1.offLow !== false); add('presses', h0.press, h1.press); add('match pairing', h0.pair, h1.pair);
  if (course) { const cn = (k) => (k ? clean(k.name, 40) + (k.tees ? ' (' + clean(k.tees, 20) + ')' : '') + ', par ' + (k.par || []).reduce((a, v) => a + v, 0) : 'none'); add('course', cn(d0.course), cn(course), (v) => v); if (cn(d0.course) === cn(course) && JSON.stringify([d0.course.par, d0.course.hcp, d0.course.rating, d0.course.slope]) !== JSON.stringify([course.par, course.hcp, course.rating, course.slope])) out.push('the course card (pars, stroke indexes, rating or slope)'); }
  return out.join(', '); }
const sigOf = (c, me, kind, p) => { const A = ACT[kind]; try { return A.sig(c, me, p) || {}; } catch (e) { return {}; } };
// Does this action wait for a signature? free = not a power yet. solo = the organizer's own call (told to everyone). THE DIRECTION RULE where it
// applies (`dirMode`): it waits while a group of `dirReq` is not filled by the person asking. Otherwise (casual games, set-up) the round-4 rule: an
// AFFECTED account exists -> its signature, whoever asks (only a neutral referee is excepted where the action says so); else asked by someone
// INTERESTED while another account is in the game.
const dirQ = (c, me, kind, p) => ({ by: me.pid, sigs: [], dir: dirReq(c, me, kind, p) });
const gated = (c, me, kind, p) => { const A = ACT[kind]; if (A.free && A.free(c, me, p)) return false; if (A.solo && A.solo(c, me, p)) return false;
  if (dirMode(c, kind)) return needOf(c, dirQ(c, me, kind, p)).length > 0;
  if (A.must && A.must(c, me, p)) return true;
  if (!(A.always || (A.money ? A.money(c, p) : A.strict ? hStrict(c) : stakes(c)))) return false;
  const o = sigOf(c, me, kind, p), others = acctOthers(c, me.pid);
  if (o.need && others.some((m) => o.need.includes(m.pid))) return !((typeof A.ref === 'function' ? A.ref(c, me, p) : A.ref) && neutralBoss(c, me));
  return interested(c, me.pid) && others.length > 0; };
const NOSIGN = 'This needs a second signature from a player with an Oddable account on another team, and nobody in this game can give it.';
const CLOSED = 'This round is closed for good. Reopening it needs the signature of another player with an Oddable account, and nobody in this game can give it.';
const names = (c, pids) => pids.map((p) => mName(c, p));
const andList = (a) => (a.length <= 2 ? a.join(' or ') : a.slice(0, 3).join(', ') + (a.length > 3 ? ' or ' + (a.length - 3) + ' more' : ''));
// After something was carried out: waiting requests that no longer fit the game (the hole was settled another way, the team is gone) are dropped and logged.
function sweep(c, now) { (c.pend || []).slice().forEach((q) => { if (q.kind === 'final') return; const A = ACT[q.kind], actor = c.members.find((m) => m.pid === q.by); try { if (!actor) throw bad(404, 'gone'); A.chk(c, actor, q.p, now); } catch (e) { if (!e.status || e.status >= 500) return; c.pend = c.pend.filter((y) => y !== q); plog(c, { at: now, st: 'expired', n: q.n, kind: q.kind, text: q.text, by: q.byName }); } }); }
const xNote = (c, kind, p) => (kind === 'correct' || kind === 'resolve' ? cumNote(c, p.tid, { hole: p.hole, e: p.e }) : '');
// Ask for an action (INSIDE a write). Nothing to sign: it is done, logged and announced. Otherwise it waits for its signatures and changes nothing.
function propose(c, me, kind, p, now, x) {
  const A = ACT[kind]; A.chk(c, me, p, now); const text = A.say(c, me, p), free = !!(A.free && A.free(c, me, p)), must = !!(A.must && A.must(c, me, p)), dm = dirMode(c, kind);
  const alone = (flag) => { const loud = !free || dm, solo = !acctOthers(c, me.pid).length, nb = neutralBoss(c, me); A.run(c, me, p, now, null, x);
    if ((c.pend || []).length) sweep(c, now);
    if (loud && (A.always || must || stakes(c) || (A.strict && hStrict(c)) || (A.money && A.money(c, p)) || dm)) { const on = !dm && A.sig ? (() => { try { return A.sig(c, me, p) || {}; } catch (e) { return {}; } })() : {}; if ((A.flag && on.nt && on.nt.length) || flag) markNso(c, flag || on.nt, { at: now, by: me.name, what: text }); plog(c, { at: now, st: 'alone', kind, text, by: me.name }); if (!solo) notify(c, A.nk || 'act', me, me.name + (nb ? ' (organizer, not playing)' : '') + ': ' + text + '.'); }
    return { done: true }; };
  if (!gated(c, me, kind, p)) return alone();
  let who, R = null;
  if (dm) { R = dirReq(c, me, kind, p); who = whoDir(c, { by: me.pid, sigs: [], dir: R });
    if (!who.length) { if (!acctOthers(c, me.pid).length) return alone(); /* nobody else in the game has an account (owner question 4): done, logged */
      const nd = needOf(c, { by: me.pid, sigs: [], dir: R }), young = c.members.filter((m) => acctM(m) && !estOk(m) && nd.some((g) => g.k === 'other' && m.pid !== me.pid && onTeamOrEntrant(c, m).length && !onTeamOrEntrant(c, m).some((t) => g.not.includes(t))));
      throw bad(409, 'Nobody in this game can sign this. It needs ' + nd.map((g) => gText(c, g)).join(', and ') + '.' + (young.length ? ' ' + young.map((m) => m.name + ': ' + estWhy(m)).join('; ') + '.' : ''), { noSigner: true }); } }
  else { const o = sigOf(c, me, kind, p); who = signers(c, me.pid, o);
    if (!who.length) { if (!must && !stakes(c) && !(A.money && A.money(c, p))) return alone(); throw bad(409, A.closed ? CLOSED : NOSIGN, { noSigner: true }); } }
  // M3: a request belongs to the person who asked. Nobody else's request replaces it or pushes it off the list; a person's own newer request for the same thing does.
  const key = kind + '|' + me.pid + '|' + [p.tid, p.hole, p.pid, p.kind, p.mid, p.a, p.b, p.ev].filter((v) => v != null).join('|'), keep = (c.pend || []).filter((q) => q.key !== key);
  if (kind !== 'hcp' && keep.filter((q) => q.by === me.pid && q.kind !== 'hcp').length >= 40) throw bad(429, 'You already have 40 requests waiting for a signature. Take one back, or wait until they are answered.', { tooMany: true });
  if (keep.length >= 400) throw bad(429, 'Too many requests are waiting in this game. Answer some of them first.', { tooMany: true });
  const cum = dm && R && R.better.includes(p.tid) ? xNote(c, kind, p) : ''; // the running total goes with a change that LOWERS a card
  c.pend = keep; c.pn = (c.pn || 0) + 1; c.pend.push(Object.assign({ n: c.pn, kind, key, p, by: me.pid, byName: me.name, at: now, text }, R ? { dir: R, sigs: [], cum: cum || undefined } : {}));
  plog(c, { at: now, st: 'asked', n: c.pn, kind, text, by: me.name }); // shown to every player as a waiting card (view: pending) and counted in the badge of those who can sign
  if (R && (R.told.length || R.worse.length)) notify(c, 'harm', me, me.name + ' asks to ' + text + '.' + (cum ? ' ' + cum + '.' : '') + (R.told.length && !R.keep ? ' Other teams can turn it down, or object ' + (kind === 'correct' || kind === 'resolve' ? 'until 30 minutes after Final' : 'for 30 minutes') + ' once signed.' : R.worse.length ? ' It makes ' + R.worse.map((s) => sName(c, s)).join(', ') + ' worse off: their own player signs it or turns it down.' : ''));
  const grp = R ? needOf(c, { by: me.pid, sigs: [], dir: R }).map((g) => names(c, c.members.filter((m) => m.pid !== me.pid && canG(c, { by: me.pid, sigs: [], dir: R }, g, m)).map((m) => m.pid))).filter((a) => a.length) : [];
  return { pending: c.pn, who: names(c, who), grp }; // grp: one list per signature still needed (a bet: one per side, so "Bob AND Cat")
}
const sameV = (x, y) => { const n = (e) => [e.g == null ? null : Number(e.g), e.p ? Object.keys(e.p).sort().map((k) => [k, Number(e.p[k])]) : null]; return JSON.stringify(n(x || {})) === JSON.stringify(n(y || {})); };
// AT FINAL (item 4: no referee in friend games). A dispute nobody settled stays on the card as DISPUTED, and a request a team turned down that nobody
// overruled is kept as the change it would have made (`c.cont`). Both show at Final as CONTESTED: the places and payouts they decide pay no winner.
function closeDisputes(c, now) { if (c.kind !== 'day' || !stakes(c)) return; const d = c.day;
  (c.pend || []).filter((q) => q.dec).forEach((q) => { const actor = c.members.find((m) => m.pid === q.by); if (!actor) return; try { const s0 = snap(c), cl = clone(c); ACT[q.kind].run(cl, actor, clone(q.p), now, { name: 'contested', pid: null }, null); const dl = dlOf(s0, cl); if (!dl.length) return; c.hn = (c.hn || 0) + 1; c.cont = (c.cont || []).concat({ h: c.hn, text: q.text, by: q.byName, dec: q.dec.name, at: now, dl }).slice(-30); } catch (e) { /* it no longer fits the game: nothing to contest */ } });
  d.teams.forEach((t) => Object.keys(d.scores[t.tid] || {}).forEach((h) => { const x = d.scores[t.tid][h]; if (x.st === 'disputed') audit(d, { at: now, by: 'Final', tid: t.tid, hole: Number(h), what: 'dispute not settled: contested' }); })); }
// Sign (or turn down) a waiting action (INSIDE a write). -> { done } | { declined } | { partial } | { expired: message }
function signAct(c, me, n, ok, now, x) {
  const q = (c.pend || []).find((y) => y.n === Number(n)); if (!q) throw bad(404, 'That request is no longer waiting.'); const A = ACT[q.kind], actor = c.members.find((m) => m.pid === q.by), drop = () => { c.pend = c.pend.filter((y) => y !== q); };
  if (!actor || actor.left) { drop(); return { expired: 'The person who asked has left the game.' }; }
  if (q.dir) return signDir(c, me, q, ok, now, x);
  let who = []; try { who = signers(c, q.by, sigOf(c, actor, q.kind, q.p)); } catch (e) { drop(); return { expired: e.message }; }
  if (ok === false) { if (me.pid !== q.by && !who.includes(me.pid)) throw bad(403, 'Only the person who asked or someone who could sign it can turn it down.'); drop(); plog(c, { at: now, st: me.pid === q.by ? 'taken back' : 'turned down', n: q.n, kind: q.kind, text: q.text, by: q.byName, sig: me.name }); notify(c, 'act', me, me.name + (me.pid === q.by ? ' took back the request to ' : ' turned down ' + q.byName + '\'s request to ') + q.text + '. Nothing changed.'); return { declined: true }; }
  if (me.pid === q.by) throw bad(403, 'You asked for this. Someone else has to sign it: ' + (andList(names(c, who)) || 'nobody in this game can') + '.');
  const o = sigOf(c, actor, q.kind, q.p);
  if (!who.includes(me.pid)) throw bad(403, o.need && who.some((p) => o.need.includes(p)) ? 'You cannot sign this one. It changes another team\'s card, standing or mark, so only that team\'s own player signs it: ' + andList(names(c, who)) + '.' : 'You cannot sign this one. It takes a player with an Oddable account who is not on ' + q.byName + '\'s team' + (isBoss(c, actor) ? ' and is not an organizer' : '') + ': ' + (andList(names(c, who)) || 'nobody in this game') + '.');
  try { A.chk(c, actor, q.p, now); } catch (e) { if (e.status === 403 || e.status === 409 || e.status === 404 || e.status === 400) { drop(); plog(c, { at: now, st: 'expired', n: q.n, kind: q.kind, text: q.text, by: q.byName }); return { expired: e.message }; } throw e; }
  const text = A.say(c, actor, q.p);
  // M4: the signature is for exactly what was shown. If the old values moved since it was asked, it is dropped and has to be asked (and signed) again.
  if (A.pin && q.text && text !== q.text) { drop(); plog(c, { at: now, st: 'expired', n: q.n, kind: q.kind, text: q.text, by: q.byName }); return { expired: 'What it would change is no longer what was asked for. It has to be asked for again.' }; }
  drop(); A.run(c, actor, q.p, now, me, x); sweep(c, now); if (A.flag && o.nt && o.nt.length && !(o.need || []).includes(me.pid)) markNso(c, o.nt, { at: now, by: q.byName, sig: me.name, what: text });
  plog(c, { at: now, st: 'signed', n: q.n, kind: q.kind, text, by: q.byName, sig: me.name }); notify(c, A.nk || 'act', me, q.byName + ', signed by ' + me.name + ': ' + text + '.'); return { done: true, kind: q.kind };
}
// Carry out a request whose signatures are complete (or that was overruled), and keep its undo for the objection window.
function applyQ(c, q, now, x, sigNames, overruled) { const A = ACT[q.kind], actor = c.members.find((m) => m.pid === q.by), R = q.dir, s0 = snap(c), text = A.say(c, actor, q.p);
  const h0 = (q.kind === 'correct' || q.kind === 'resolve') && c.kind === 'day' ? (c.day.scores[q.p.tid] || {})[q.p.hole] || {} : {}, cf = h0.st === 'confirmed' || h0.pst === 'confirmed'; // fix 1: a change to a confirmed hole
  c.pend = c.pend.filter((y) => y !== q); A.run(c, actor, q.p, now, { name: sigNames, pid: (q.sigs || [])[0] || null }, x); sweep(c, now);
  const sigT = new Set((q.sigs || []).concat((q.alt || []).map((a) => a.pid), (q.ovr || []).map((a) => a.pid)).flatMap((p) => teamsOfP(c, p).concat('p:' + p))), alt = !!(q.alt || []).length && !(q.sigs || []).some((p) => R.g.some((g) => g.alt && g.s.some((s) => speaksFor(c, c.members.find((m) => m.pid === p) || {}, s))));
  const obj = overruled ? [] : alt ? R.worse : R.told.filter((s) => !sigT.has(s)), wnc = overruled ? (R.keep ? [] : R.worse) : alt ? R.worse : [];
  const noSay = R.g.filter((g) => g.was).flatMap((g) => g.was); if (overruled || alt || noSay.length) markNso(c, [...new Set((overruled || alt ? R.worse || [] : []).concat(noSay))].filter((s) => !s.startsWith('p:')), { at: now, by: q.byName, sig: sigNames, what: text }); // changed without the team's sign-off
  harmRec(c, q.kind, text + (q.cum ? ' (' + q.cum + ')' : ''), actor, sigNames, now, { obj, wnc, better: R.better, st: overruled ? 'upheld' : 'open', cf }, s0);
  plog(c, { at: now, st: overruled ? 'overruled' : 'signed', n: q.n, kind: q.kind, text, by: q.byName, sig: sigNames }); notify(c, A.nk || 'act', null, q.byName + ', ' + (overruled ? 'overruled by ' : 'signed by ') + sigNames + ': ' + text + '.' + (q.cum ? ' ' + q.cum + '.' : '')); return { done: true, kind: q.kind }; }
function signDir(c, me, q, ok, now, x) { const A = ACT[q.kind], drop = () => { c.pend = c.pend.filter((y) => y !== q); }, R = q.dir;
  if (ok === false) {
    if (me.pid === q.by) { drop(); plog(c, { at: now, st: 'taken back', n: q.n, kind: q.kind, text: q.text, by: q.byName, sig: me.name }); notify(c, 'act', me, me.name + ' took back the request to ' + q.text + '. Nothing changed.'); return { declined: true }; }
    if (q.dec) throw bad(409, q.dec.name + ' already turned this down.');
    const s = (R.ob || []).find((y) => onSide(c, me.pid, y) || speaksFor(c, me, y)); // a side it concerns says no: kept, and two players from two other teams can overrule it (item 3)
    if (s && acctM(me)) { q.dec = { pid: me.pid, name: me.name, at: now, s }; q.ovr = []; plog(c, { at: now, st: 'turned down', n: q.n, kind: q.kind, text: q.text, by: q.byName, sig: me.name });
      notify(c, 'harm', me, me.name + ' turned down ' + q.byName + '\'s request to ' + q.text + '. Nothing changed. Two players from two other teams can overrule it; if nobody does, it shows as contested at Final.'); return { declined: true, open: true }; }
    if (whoDir(c, q).includes(me.pid)) { drop(); plog(c, { at: now, st: 'turned down', n: q.n, kind: q.kind, text: q.text, by: q.byName, sig: me.name }); notify(c, 'act', me, me.name + ' turned down ' + q.byName + '\'s request to ' + q.text + '. Nothing changed.'); return { declined: true }; }
    throw bad(403, 'Only the person who asked, someone who could sign it, or a team it concerns can turn it down.'); }
  if (me.pid === q.by) throw bad(403, 'You asked for this. Someone else has to sign it: ' + (andList(names(c, whoDir(c, q))) || 'nobody in this game can') + '.');
  if (q.dec) throw bad(409, q.dec.name + ' turned this down. Two players from two other teams can overrule it (Overrule).', { declined: true });
  const nd = needOf(c, q), can = nd.some((g) => canG(c, q, g, me)), alt = !can && nd.some((g) => g.alt && altCan(c, q, g, me));
  if (!can && !alt) throw bad(403, whyNot(c, q, me));
  if ([q.by].concat(q.sigs || [], (q.alt || []).map((a) => a.pid)).includes(me.pid)) throw bad(409, 'You already signed it.');
  const actor = c.members.find((m) => m.pid === q.by);
  try { A.chk(c, actor, q.p, now); } catch (e) { if (e.status === 403 || e.status === 409 || e.status === 404 || e.status === 400) { drop(); plog(c, { at: now, st: 'expired', n: q.n, kind: q.kind, text: q.text, by: q.byName }); return { expired: e.message }; } throw e; }
  if (A.pin && q.text && A.say(c, actor, q.p) !== q.text) { drop(); plog(c, { at: now, st: 'expired', n: q.n, kind: q.kind, text: q.text, by: q.byName }); return { expired: 'What it would change is no longer what was asked for. It has to be asked for again.' }; }
  if (can) q.sigs = (q.sigs || []).concat(me.pid); else q.alt = (q.alt || []).concat({ pid: me.pid, t: teamsOfP(c, me.pid)[0] });
  const left = needOf(c, q); if (left.length) { plog(c, { at: now, st: 'signed (more needed)', n: q.n, kind: q.kind, text: q.text, by: q.byName, sig: me.name }); notify(c, 'act', me, me.name + ' signed ' + q.byName + '\'s request to ' + q.text + '. Still needed: ' + left.map((g) => gText(c, g)).join(', and ') + '.'); return { partial: true }; }
  return applyQ(c, q, now, x, names(c, (q.sigs || []).concat((q.alt || []).map((a) => a.pid))).join(' and '), false); }
// OVERRULE a "no" (item 3): two established players from two different teams, neither on the asker's team, nor on the side that said no, nor on the side it helps.
function overruleQ(c, me, n, now) { const q = (c.pend || []).find((y) => y.n === Number(n)); if (!q || !q.dir || !q.dec) throw bad(404, 'Nothing turned down to overrule.');
  const ms = teamsOfP(c, me.pid), ex = new Set(teamsOfP(c, q.by).concat(sideTeams(c, q.dec.s), teamsOfP(c, q.dec.pid), (q.dir.better || []).flatMap((s) => sideTeams(c, s))));
  if (!acctM(me) || !ms.length) throw bad(403, 'Only a player on a team can overrule it.'); if (me.pid === q.by || ms.some((t) => ex.has(t))) throw bad(403, 'Only players from two OTHER teams (not the one that asked, not the one that said no, not the one it helps) can overrule it.');
  if (!estOk(me)) throw bad(403, 'You cannot overrule it: ' + estWhy(me) + '.'); if ((q.ovr || []).some((u) => u.pid === me.pid)) throw bad(409, 'You already overruled it.');
  q.ovr = (q.ovr || []).concat({ pid: me.pid, name: me.name, at: now, t: ms[0] }); if (new Set(q.ovr.map((u) => u.t)).size < 2) { notify(c, 'harm', me, me.name + ' would overrule ' + q.dec.name + ' on "' + q.text + '". One more player from a different team is needed.'); return { partial: true }; }
  const actor = c.members.find((m) => m.pid === q.by); try { if (!actor) throw bad(404, 'gone'); ACT[q.kind].chk(c, actor, q.p, now); } catch (e) { if (!e.status || e.status >= 500) throw e; c.pend = c.pend.filter((y) => y !== q); return { expired: e.message }; }
  return applyQ(c, q, now, null, q.ovr.map((u) => u.name).join(' and '), true); }
// OBJECT (inside a write): a player on a side it concerns, within 30 minutes of the change (Final included: the round then reopens by itself, logged,
// everyone told). The change is put back; two established players from two other teams can uphold it.
function objectH(c, me, h, now) { const e = (c.harm || []).find((y) => y.h === Number(h)); if (!e) throw bad(404, 'Nothing to object to.'); if (e.st === 'upheld') throw bad(409, 'Two players from two other teams upheld it. It stands.'); if (e.st !== 'open') throw bad(409, 'That was already objected to.');
  if (!harmedBy(c, me.pid, e.sides)) throw bad(403, 'Only a player on a side it concerns can object.'); if (!objOpen(c, e, now)) throw bad(409, 'The time to object to this ended at ' + fmtCT(objEnd(c, e)) + '.');
  let re = false; if (c.kind === 'day' && c.day.status === 'final' && e.kind !== 'final' && e.kind !== 'ncfinal') { const d = c.day; d.status = 'live'; delete d.forced; delete d.nc; d.reopens = (d.reopens || []).concat({ at: now, by: me.name, auto: true, reason: 'objection: ' + clean(e.text, 80) }).slice(-20); audit(d, { at: now, by: me.name, what: 'reopen', note: 'reopened by itself: ' + me.name + ' objected in time' }); re = true; }
  const left = moveBack(c, e.dl, false); e.st = 'objected'; e.ob = { pid: me.pid, name: me.name, at: now, left }; e.up = [];
  if (c.kind === 'day') audit(c.day, { at: now, by: me.name, what: 'objection: put back', note: e.text }); plog(c, { at: now, st: 'objected', kind: e.kind, text: e.text, by: e.byName, sig: me.name });
  notify(c, 'harm', me, me.name + ' objected to "' + e.text + '". It is put back' + (left ? ' (' + left + ' part' + (left === 1 ? '' : 's') + ' had changed since and stay as they are)' : '') + (re ? '. The round was final: it is open again' : '') + '. Two players from two other teams can uphold it; otherwise it shows as contested at Final.'); return re ? { reopened: true } : {}; }
function dropH(c, me, h, now) { const e = (c.harm || []).find((y) => y.h === Number(h)); if (!e || e.st !== 'objected') throw bad(404, 'Nothing objected to that you can withdraw.'); if (e.by !== me.pid) throw bad(403, 'Only the one who asked for it withdraws it.');
  e.st = 'dropped'; e.drAt = now; if (c.kind === 'day') audit(c.day, { at: now, by: me.name, what: 'change withdrawn after an objection', note: e.text }); notify(c, 'harm', me, me.name + ' withdrew "' + e.text + '" after the objection. It stays put back.'); return {}; }
function upholdH(c, me, h, now) { const e = (c.harm || []).find((y) => y.h === Number(h)); if (!e) throw bad(404, 'Nothing to uphold.'); if (e.st !== 'objected') throw bad(409, 'Only a change someone objected to can be upheld.');
  const ms = teamsOfP(c, me.pid), ex = new Set(teamsOfP(c, e.by).concat(e.ob ? teamsOfP(c, e.ob.pid) : [], (e.better || []).flatMap((s) => sideTeams(c, s)))); if (!acctM(me) || !ms.length) throw bad(403, 'Only a player on a team can uphold it.');
  if (ms.some((t) => ex.has(t)) || harmedBy(c, me.pid, e.sides) || me.pid === e.by) throw bad(403, 'Only players from two OTHER teams (not the one that objected, not the one that asked, not the one it helps) can uphold it.');
  if (!estOk(me)) throw bad(403, 'You cannot uphold it: ' + estWhy(me) + '.'); if ((e.up || []).some((u) => u.pid === me.pid)) throw bad(409, 'You already upheld it.'); e.up = (e.up || []).concat({ pid: me.pid, name: me.name, at: now, t: ms[0] });
  const ts = new Set(); e.up.forEach((u) => ts.add(u.t)); if (ts.size < 2) { notify(c, 'harm', me, me.name + ' upholds "' + e.text + '". One more player from a different team is needed.'); return { partial: true }; }
  const left = moveBack(c, e.dl, true); e.st = 'upheld'; e.upAt = now; if (e.ob) e.wnc = [...new Set((e.wnc || []).concat(e.sides.filter((s) => onSide(c, e.ob.pid, s))))]; if (c.kind === 'day') audit(c.day, { at: now, by: e.up.map((u) => u.name).join(' and '), what: 'upheld after an objection', note: e.text });
  plog(c, { at: now, st: 'upheld', kind: e.kind, text: e.text, by: e.byName, sig: e.up.map((u) => u.name).join(' and ') }); notify(c, 'harm', me, e.up.map((u) => u.name).join(' and ') + ' upheld "' + e.text + '". It stands' + (left ? ' (' + left + ' part' + (left === 1 ? '' : 's') + ' had changed since)' : '') + '.'); return { done: true }; }
// X4: Final waits while a change made a team worse WITHOUT its signature less than 15 minutes ago (so that team can object first).
function holdUntil(c, now) { const t = (c.harm || []).filter((e) => (e.st === 'open' || e.st === 'upheld') && (e.wnc || []).length).map((e) => (e.upAt || e.at) + HOLD_MS).filter((v) => v > now); return t.length ? Math.max(...t) : 0; }
// The Final checks shared by the plain Final and the forced one. -> { un, money }
function finalBlock(c, me) { const d = c.day, n = d.course.par.length, hu = holdUntil(c, D.now());
  if (hu) throw bad(409, 'A change made a team worse off without its signature less than 15 minutes ago. Final waits until ' + fmtCT(hu) + ' so that team can object.', { holdUntil: hu });
  if (!stakes(c) && d.teams.some((t) => Object.values(d.scores[t.tid] || {}).some((h) => h.st === 'disputed'))) throw bad(409, 'Settle the disputed holes first'); // in a money game an unsettled dispute shows as CONTESTED at Final
  const money = stakes(c), bd = dayBoard(c), short = bd.rows.filter((r) => !r.wd && r.thru < n);
  if (money && short.length) throw bad(409, short.map((r) => r.name + ' has played ' + r.thru + ' of ' + n + ' holes').join('; ') + '. Finish the card, or mark the team withdrawn (did not finish: no place, no prize money).' + (n === 18 ? ' Rain? Any team can ask to shorten the round to 9 holes.' : ''), { incomplete: short.map((r) => ({ tid: r.tid, name: r.name, thru: r.thru })) });
  const un = unconfirmed(c, me); if (un.n && money) { const others = acctOthers(c, me.pid).length > 0, mine = others ? un.own : 0, msg = un.n + ' hole' + (un.n === 1 ? ' was' : 's were') + ' never confirmed' + (un.side ? ' (' + un.side + ' side-game winner' + (un.side === 1 ? '' : 's') + ' too)' : '');
    if (mine) throw bad(409, msg + '. ' + mine + ' of them ' + (mine === 1 ? 'is' : 'are') + ' on your own team or entered by you: another team\'s scorer has to confirm ' + (mine === 1 ? 'it' : 'them') + '. A forced finish cannot cover your own side.', { unconfirmed: un.n, side: un.side, own: mine, canForce: false }); }
  return { un, money, msg: un.n + ' hole' + (un.n === 1 ? ' was' : 's were') + ' never confirmed' + (un.side ? ' (' + un.side + ' side-game winner' + (un.side === 1 ? '' : 's') + ' too)' : '') }; }
// One route helper for every power: runs the async step (the stats module, for a director's handicap) only when the action is really carried out.
async function power(c, u, kind, p) {
  const A = ACT[kind], me0 = memberOf(c, u.mk), now = D.now(), direct = !gated(c, me0, kind, p); let x = null, out = null;
  if (A.pre && direct) { A.chk(c, me0, p, now); x = await A.pre(c, me0, p); }
  const g = await mutC(c.id, (d) => { const me = memberOf(d, u.mk); if (!me) throw bad(404, 'Golf game not found'); if (A.pre && !gated(d, me, kind, p) !== direct) throw bad(409, 'The game changed. Try again.'); out = propose(d, me, kind, p, now, x); d.u = now; return d; });
  return { g, out };
}
const powerAns = (out) => (out && out.pending ? { pending: true, n: out.pending, note: 'Asked. It needs ' + (out.grp && out.grp.length > 1 ? out.grp.map((a) => andList(a)).join(' AND ') + ' to sign' : out.who && out.who.length ? 'a signature (' + andList(out.who) + ')' : 'more signatures') + ' and changes nothing until then. Every player can see it.' } : {});

// ---------- validation ----------
function cleanPot(p) {
  p = p || {}; const entry = num(p.entry || 0, 0, 10000); if (entry == null || Math.round(entry) !== entry) throw bad(400, 'Entry must be a whole dollar amount from 0 to 10,000');
  const k = ['none', 'pct', 'flat'].includes(p.take && p.take.kind) ? p.take.kind : 'none'; let v = 0;
  if (k === 'pct') { v = num(p.take.v, 0, 50); if (v == null || !Number.isInteger(v)) throw bad(400, "Organizer's take: a whole percent from 0 to 50"); }
  if (k === 'flat') { v = num(p.take.v, 0, 1e6); if (v == null) throw bad(400, "Organizer's take: a dollar amount, not negative"); }
  return { entry, take: { kind: k, v }, pot: p.pot === 'side' ? 'side' : 'main', split: cleanSplit(p.split) };
}
// Payout table (whole percents, 1-10 places, adding to exactly 100). None = the small-field default (golf-score defaultSplit), sized to the field.
function cleanSplit(a) { if (a == null || a === '' || (Array.isArray(a) && !a.length)) return null; const x = (Array.isArray(a) ? a : String(a).split(/[\s,\/]+/)).filter((v) => v !== '').map(Number);
  if (!x.length || x.length > 10 || x.some((v) => !Number.isInteger(v) || v <= 0) || x.reduce((s0, v) => s0 + v, 0) !== 100) throw bad(400, 'Payout table: whole percents for 1 to 10 places that add up to 100 (e.g. 60 30 10)');
  if (x.some((v, i) => i && v > x[i - 1])) throw bad(400, 'Payout table: a lower place can never pay more than a higher one (e.g. 60 30 10, not 10 30 60)', { rising: true }); return x;
}
function cleanCourse(c) {
  c = c || {}; const holes = Number(c.holes) === 9 ? 9 : 18;
  const o = { name: clean(c.name, 50), tees: clean(c.tees, 20), holes, par: (c.par || []).slice(0, holes).map(Number), hcp: (c.hcp || []).slice(0, holes).map(Number) };
  if (o.name.length < 2) throw bad(400, 'Course name (2+ characters)'); if (!o.tees) throw bad(400, 'Which tees?');
  const er = S.checkCourse(o); if (er) throw bad(400, er);
  // Course Rating and Slope Rating (per tee) feed the unofficial Oddable handicap. Optional, but checked when given.
  const par = o.par.reduce((a, x) => a + x, 0), f = holes / 18;
  if (c.slope != null && c.slope !== '') { const v = num(c.slope, 55, 155); if (v == null || !Number.isInteger(v)) throw bad(400, 'Slope Rating is a whole number from 55 to 155'); o.slope = v; }
  if (c.rating != null && c.rating !== '') { const v = num(c.rating, par - 18 * f, par + 12 * f); if (v == null) throw bad(400, 'Course Rating should be close to par (' + par + '): between ' + (par - 18 * f) + ' and ' + (par + 12 * f)); o.rating = Math.round(v * 10) / 10; }
  if (Array.isArray(c.yards)) { const y = c.yards.slice(0, holes).map((x) => (x == null || x === '' ? null : num(x, 50, 800))); if (y.some((x, i) => x == null && c.yards[i] != null && c.yards[i] !== '')) throw bad(400, 'Yards per hole: 50 to 800'); if (y.some((x) => x != null)) o.yards = y.map((x) => (x == null ? null : Math.round(x))); }
  if (c.src === 'opengolfapi') { o.src = 'opengolfapi'; o.extId = clean(c.extId, 40); o.teeKey = clean(c.teeKey, 40); }
  if (c.city) o.city = clean(c.city, 40); if (c.state) o.state = clean(c.state, 20);
  return o;
}
const SCR4 = { 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] }, SCR_ALLOW = { scramble4: SCR4, scramble2: SCR4, texas: SCR4, florida: SCR4 };
const allowFor = (d, n) => (d.allowStd && SCR_ALLOW[d.fmt] && SCR_ALLOW[d.fmt][n] ? SCR_ALLOW[d.fmt][n] : d.allow);
function cleanDay(b, prev) {
  const fmt = String(b.fmt || ''); if (!S.FORMATS[fmt]) throw bad(400, 'Pick a format'); const F0 = S.FORMATS[fmt];
  const net = ['gross', 'net', 'both'].includes(b.net) ? b.net : 'net';
  const teamSize = Math.max(F0.size[0], Math.min(F0.size[1], num(b.teamSize, 1, 4) || F0.size[1]));
  // Starting allowances (Playbook, Nov 16 2026; every one editable at set-up). Scrambles by team size: 2 players 35/15, 3 players 30/20/10, 4 players
  // 25/20/15/10. Best ball (WHS Appendix C): pairs 85%, best 1 of 3 or 4 75%, best 2 of 3 or 4 85%; a four-ball MATCH plays at 90% and a singles
  // (player v player) match at 100% (heads.pct). Review fix Nov 16 2026: best 2 of 4 was 90 here and singles matches took the format's percent.
  const std = SCR_ALLOW[fmt] ? SCR_ALLOW[fmt][teamSize] || F0.allow : F0.allow || [];
  const allow = (Array.isArray(b.allow) && b.allow.length ? b.allow : std).slice(0, 4).map((x) => num(x, 0, 100)); if (allow.some((x) => x == null)) throw bad(400, 'Allowances are percents from 0 to 100');
  const allowStd = !!SCR_ALLOW[fmt] && JSON.stringify(allow) === JSON.stringify(std); // untouched: a team short a player uses the list for ITS size
  const count = fmt === 'shamble' || fmt === 'bestball' ? (num(b.count, 1, 2) || F0.count) : null;
  const pct0 = fmt === 'bestball' ? (teamSize === 2 ? 85 : count === 1 ? 75 : 85) : F0.pct || 100;
  const pct = num(b.pct == null || b.pct === '' ? pct0 : b.pct, 0, 100); if (pct == null) throw bad(400, 'Handicap percent 0 to 100');
  const drivePen = fmt === 'texas' ? num(b.drivePen == null || b.drivePen === '' ? 2 : b.drivePen, 0, 10) : null; if (fmt === 'texas' && (drivePen == null || !Number.isInteger(drivePen))) throw bad(400, 'Penalty for a missing drive: 0 to 10 strokes');
  const drives = fmt === 'texas' ? num(b.drives == null ? F0.drives : b.drives, 1, 9) : null; if (fmt === 'texas' && drives == null) throw bad(400, 'Drives per player: 1 to 9');
  const date = okDay(b.date) ? b.date : chiDay(D.now());
  const ex = b.extras || {}, holesN = (prev && prev.course && prev.course.holes) || 18, hl = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((h) => Number.isInteger(h) && h >= 1 && h <= holesN))].slice(0, 6);
  const extras = { skins: { on: !!(ex.skins && ex.skins.on), net: !!(ex.skins && ex.skins.net), amt: num((ex.skins && ex.skins.amt) || 0, 0, 10000) || 0, end: ex.skins && ex.skins.end === 'none' ? 'none' : 'split', wd: ex.skins && ex.skins.wd === 'void' ? 'void' : 'stand' }, ctp: hl(ex.ctp), ld: hl(ex.ld), ctpAmt: num(ex.ctpAmt || 0, 0, 10000) || 0, ldAmt: num(ex.ldAmt || 0, 0, 10000) || 0 };
  const hu = b.hu || b.heads || {}, press = hu.press === 'auto2' ? 'auto2' : 'accept', hp = num(hu.pct == null || hu.pct === '' ? (hu.kind === 'player' ? 100 : fmt === 'bestball' ? 90 : pct) : hu.pct, 0, 100);
  const heads = { press, pct: hp == null ? pct : hp, on: !!hu.on, pair: ['bracket', 'foursome', 'pick', 'random'].includes(hu.pair) ? hu.pair : 'pick', kind: hu.kind === 'player' ? 'player' : 'team', type: hu.type === 'nassau' ? 'nassau' : 'match', amt: num(hu.amt || 0, 0, 10000) || 0, auto: press === 'auto2' ? 2 : 0, offLow: hu.offLow !== false };
  const tee = num(b.teeTime, 1e12, 1e14), pl = prev && prev.lockAt, lockAt = tee && prev && prev.status === 'setup' && (!pl || D.now() < pl) ? tee : minT(pl, tee); // L5: the tee time can move later (rain delay) until the old one has come // first tee time = tournament start (handicap edits lock then)
  // FLIGHTS (optional): 2 to 4 handicap flights, set at Start from the handicaps in use (the confirmed index in a money game); each flight has its own
  // gross and net board and its own payout. payBy = which board the prize money follows: gross, net, or half each when both boards are kept.
  const fl = Number(b.flights && typeof b.flights === 'object' ? (b.flights.asked != null ? b.flights.asked : b.flights.n) : b.flights), flights = { n: [2, 3, 4].includes(fl) ? fl : 0 };
  const payBy = net === 'both' ? (['net', 'gross', 'both'].includes(b.payBy) ? b.payBy : 'both') : net;
  // N1: the organizer may set the round's expected end (did not finish and the time-out Final count from it), never sooner than 2 h 30 after the first tee
  const e0 = num(b.endTime, 1e12, 1e14), endAt = e0 && lockAt && e0 >= lockAt + 2.5 * 3600e3 ? e0 : prev && prev.endAt && !b.endTime ? prev.endAt : null;
  return { fmt, net, allow, allowStd, pct, count, drives, drivePen, date, extras, heads, lockAt, teamSize, flights, payBy, endAt };
}

// ---------- invite code + index ----------
async function newCodeFor(id, mk) { return mutIdx((d) => { let code; do { code = rnd(10); } while (d.codes[code]); d.codes[code] = id; d.mine[mk] = (d.mine[mk] || []).concat(id).slice(-200); return code; }); }
async function addMine(mk, id) { await mutIdx((d) => { const a = d.mine[mk] || []; if (a.includes(id)) return { nochange: true }; d.mine[mk] = a.concat(id).slice(-200); return {}; }); }
async function byCode(code, k) { const c = normCode(code); if (!c) { fail(k); throw bad(404, 'No golf game with that code'); } const r = await D.S.dbGet(IDX); const codes = (r && r.data && r.data.codes) || {}; let id = null; Object.keys(codes).forEach((x) => { if (sameCode(x, c)) id = codes[x]; }); if (!id) { fail(k); throw bad(404, 'No golf game with that code'); } return getC(id); }

// ---------- pro: feed + tiers ----------
// H5 (other session's review): once a pick-six tournament is over its final leaderboard is STORED on the game (`c.pro.fin`), and from then on the pool
// never asks the tour feed again. It is stored after two matching "final" reads at least 10 minutes apart, and never from an empty field.
// The first "final" reading is kept too (`c.pro.finRead.b`), only as what is shown when the feed cannot be reached before the second read.
async function boardOf(c) { if (c.pro.fin && c.pro.fin.b) return c.pro.fin.b; try { return await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) { return (c.pro.finRead && c.pro.finRead.b) || null; } }
const readSig = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 20);
const AGAIN = 600e3; // two matching reads this far apart before a "final" reading is kept
async function sixSettle(c) { if (c.pro.game !== 'six' || c.pro.fin) return c; let b = null; try { b = await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) {} if (!b || !b.event || !b.event.done || !(b.golfers || []).length) return c;
  const sig = readSig(b.golfers.map((g) => [g.id, g.pos, g.toPar, g.st])), now = D.now(), r = c.pro.finRead; if (r && r.sig === sig && now - r.at < AGAIN) return c;
  return mutC(c.id, (d) => { const P = d.pro, q = P.finRead; if (P.fin) return { nochange: true, v: d }; if (q && q.sig === sig && now - q.at >= AGAIN) { P.fin = { at: now, b: clone(b) }; delete P.finRead; P.doneAt = P.doneAt || now; } else if (!q || q.sig !== sig) P.finRead = { sig, at: now, b: clone(b) }; else return { nochange: true, v: d }; return d; }); }
// The day's teams with at least one account-holding player each: a MONEY game needs two of them (H3).
const twoAccounts = (c) => c.kind === 'day' && new Set(c.day.teams.filter((t) => acctsOn(c, [t.tid]).length).map((t) => t.tid)).size >= 2 && new Set(c.day.teams.flatMap((t) => acctsOn(c, [t.tid]))).size >= 2;
// Take every money amount off a golf day (H3: a guests-only or one-account game is played as a casual game with no money shown).
function stripMoney(c) { const d = c.day; c.pot.entry = 0; d.extras.skins.amt = 0; d.extras.ctpAmt = 0; d.extras.ldAmt = 0; d.heads.amt = 0; (d.matches || []).forEach((m) => { m.amt = 0; }); }
function fieldMap(b) { const m = {}; (b ? b.golfers : []).forEach((g) => (m[g.id] = g)); return m; }
// Pick six tiers (Playbook, Nov 16 2026): the DEFAULT order is neutral so a playing organizer cannot rig it: the world ranking when the free feed carries
// one for the field (golfer.wr), else alphabetical by last name. An organizer's own list is an EDIT: allowed before anyone picks, logged, and shown to
// every entrant (pro.tierLog). No odds are used (they would cost Odds API credits).
const nameKey = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const lastFirst = (n) => { const w = String(n || '').trim().split(/\s+/); return nameKey(w.slice(-1)[0] || '') + ' ' + nameKey(w.slice(0, -1).join('')); };
const tierBasis = (b, rank) => ((rank || []).length ? 'list' : b.golfers.length && b.golfers.filter((g) => Number(g.wr) > 0).length >= b.golfers.length * 0.8 ? 'wr' : 'alpha');
function buildTiers(b, rank) {
  const gs = b.golfers.slice(), key = nameKey, basis = tierBasis(b, null), neutral = (x, y) => (basis === 'wr' ? (Number(x.wr) || 1e6) - (Number(y.wr) || 1e6) : 0) || (lastFirst(x.name) < lastFirst(y.name) ? -1 : lastFirst(x.name) > lastFirst(y.name) ? 1 : 0) || (x.id < y.id ? -1 : 1);
  const pos = {}; (rank || []).forEach((n, i) => { const k = key(n); if (k && pos[k] == null) pos[k] = i; });
  gs.sort((x, y) => (pos[key(x.name)] ?? 1e6) - (pos[key(y.name)] ?? 1e6) || neutral(x, y));
  return S.tiers(gs.map((g) => g.id));
}
// LOCK (review fix): the lock time is stored once (at create / first pick) and can only move EARLIER: min(stored, first tee, event start).
// A tournament that has begun (feed state not 'pre', or any golfer started) is locked whatever the clock says.
const feedLock = (b) => { if (!b) return null; const x = [b.firstTee, b.event && b.event.start].filter((v) => Number.isFinite(v) && v > 0); return x.length ? Math.min(...x) : null; };
const begun = (b) => !!b && ((b.event && b.event.state && !['pre', 'cal'].includes(b.event.state)) || !!(b.event && b.event.done) || b.golfers.some((g) => g.started));
const minT = (...a) => { const x = a.filter((v) => Number.isFinite(v) && v > 0); return x.length ? Math.min(...x) : null; };
const lockAt = (c, b) => minT(c.pro.lockAt, feedLock(b));
// G16 (owner, Nov 16 2026): in group play a pick saves to the server the moment it is added and is then LOCKED: no edit, delete or re-pick, even before
// the first tee. Group play = the game is attached to a group, or anyone besides the organizer is in it.
const g16 = (c) => !!c.groupId || c.members.length > 1;
const G16MSG = 'Your pick is in and final. In group play a pick cannot be changed once it is added.';
// Is real money shown on this golf day (entry, skins, closest to the pin / longest drive, a match amount)? Then unconfirmed holes block Final.
const moneyOn = (c) => { const d = c.day, e = d.extras; return (c.pot.entry || 0) > 0 || (e.skins.on && e.skins.amt > 0) || (e.ctp.length && e.ctpAmt > 0) || (e.ld.length && e.ldAmt > 0) || (d.matches || []).some((m) => m.amt > 0); };
// Unconfirmed holes and side-game winners (a team marked did-not-finish is out of it). `own` = the part a given member cannot cover with a forced
// finish: holes of a team they play on or score for, holes they entered themselves, and side winners on their team or entered by them.
const unconfirmed = (c, me) => { const d = c.day, wd = d.wd || {}; let n = 0, side = 0, own = 0;
  d.teams.forEach((t) => { if (wd[t.tid]) return; Object.values(d.scores[t.tid] || {}).forEach((h) => { if (h.st === 'confirmed' || (h.st === 'disputed' && h.pst === 'confirmed' && stakes(c))) return; n++; if (me && (teamSide(t, me.pid) || h.bp === me.pid)) own++; }); });
  ['ctp', 'ld'].forEach((k) => Object.values((d.win || {})[k] || {}).forEach((w) => { if (w.st === 'confirmed') return; side++; if (me) { const wT = d.teams.find((t) => t.tid === w.who || t.players.includes(w.who)); if (w.who === me.pid || w.bp === me.pid || teamSide(wT, me.pid)) own++; } }));
  return { n: n + side, holes: n, side, own }; };
const netOn = (d) => d.net !== 'gross' || !!(d.extras.skins.on && d.extras.skins.net);
// Casual = the full Oddable index may be played off. Money shown, flights or a tournament = the confirmed index (stats handicapFor decides from this flag).
const casualOf = (c) => !!c.day.solo || (!moneyOn(c) && !c.ent && !((c.day.flights || {}).n));
const hOpts = (c) => Object.assign(c.ent ? { eventId: EID(c.id) } : {}, casualOf(c) ? { casual: true } : {});
const hLocked = (d, now) => d.status !== 'setup' || (d.lockAt != null && now >= d.lockAt); // handicaps (and director edits) lock at the start

// ---------- payouts (S-ALL: every play shows entry, payout and net; display only, never collected or paid) ----------
// Pool = entry x entrants (everyone in the game, paid or not: it is what the game is played for) minus the organizer's take.
// THE POT COUNTS ONLY ENTRANTS MARKED PAID (manager decision Nov 16 2026, same as Groups and local events). In a golf day that has started, an entrant
// must also be on a team (an organizer or director who is not playing is not in the pot).
const inPlay = (c) => (c.kind === 'day' && c.day.status !== 'setup' ? new Set(c.day.teams.flatMap((t) => t.players)) : null);
const paidPids = (c) => { const on = inPlay(c); return new Set(c.members.filter((m) => m.paid && (!on || on.has(m.pid))).map((m) => m.pid)); };
const entrantsOf = (c) => { const on = inPlay(c); return on ? on.size : c.members.length; };
function poolC(c) { const p = c.pot, potC = Math.round((p.entry || 0) * 100) * paidPids(c).size, takeC = p.take.kind === 'pct' ? Math.round(potC * p.take.v / 100) : p.take.kind === 'flat' ? Math.min(Math.round(p.take.v * 100), potC) : 0; return { potC, takeC, poolC: potC - takeC }; }
// sides: [{key, place, pids:[...]}] in finishing order. Only paid entrants can win pot money: sides with no paid player are skipped and the places are
// counted among the rest. A side's prize is split evenly among its paid players in cents. -> {pid: cents}
function payPids(c, sides) { const paid = paidPids(c), live = sides.map((x) => ({ key: x.key, place: x.place, pids: x.pids.filter((p) => paid.has(p)) })).filter((x) => x.pids.length); live.forEach((x) => (x.pl = live.filter((y) => y.place < x.place).length + 1));
  const pc = poolC(c).poolC, by = S.payouts(pc, live.map((x) => ({ id: x.key, place: x.pl })), c.pot.split), out = {};
  live.forEach((x) => { const n = x.pids.length, each = Math.floor((by[x.key] || 0) / n); let left = (by[x.key] || 0) - each * n; x.pids.forEach((p) => { out[p] = each + (left > 0 ? 1 : 0); if (left > 0) left--; }); }); return out; }
// Which board the prize money follows: gross, net, or half each (set-up says it; "both" boards with no choice = half each).
const payBy = (d) => (d.net === 'gross' ? 'gross' : d.net === 'both' ? d.payBy || 'both' : 'net');
// THE golf-day payout (pays exactly what the set-up says): the pool is shared between the flights in proportion to their PAID players, then inside a
// flight between the gross and net boards (payBy), then by the payout table. Only finished cards rank; a team's prize is split among its paid players.
// -> { pids: {pid: cents} (final rounds only), lines: [{flight, board, pool, players, places: [{place, pct, amt}], won: [{tid, name, place, amt}] | null, notWon}] }
function dayPay(c, bd) {
  const d = c.day, paid = paidPids(c), pool = poolC(c).poolC, fin = d.status === 'final', tp = {}; d.teams.forEach((t) => (tp[t.tid] = t.players.filter((p) => paid.has(p))));
  const groups = bd.flights ? bd.flights.map((f) => ({ name: f.name, rows: bd.rows.filter((r) => r.flight === f.i), fl: true })) : [{ name: null, rows: bd.rows, fl: false }];
  // L3: once the round is Final, a flight where no paid team finished takes no share: its part of the pool is re-scaled to the other flights (shown as `moved`)
  const cnt0 = groups.map((g) => g.rows.reduce((a, r) => a + (tp[r.tid] || []).length, 0)), liveG = groups.map((g) => g.rows.some((r) => (r.placeN || r.placeG) && (tp[r.tid] || []).length)), anyLive = liveG.some(Boolean);
  const cnt = cnt0.map((x, i) => (fin && anyLive && !liveG[i] ? 0 : x)), tot = cnt.reduce((a, x) => a + x, 0), pids = {}, lines = []; let acc = 0, given = 0;
  groups.forEach((g, gi) => { acc += cnt[gi]; const upto = tot ? Math.round(pool * acc / tot) : gi === groups.length - 1 ? pool : 0, share = upto - given; given = upto;
    const pb = payBy(d), boards = pb === 'both' ? [['net', share - Math.floor(share / 2)], ['gross', Math.floor(share / 2)]] : [[pb, share]];
    boards.forEach(([b, cents]) => { const f = (g.fl ? 'fPlace' : 'place') + (b === 'net' ? 'N' : 'G');
      const live = g.rows.filter((r) => r[f] && (tp[r.tid] || []).length).map((r) => ({ key: r.tid, place: r[f], name: r.name })); live.forEach((x) => (x.pl = live.filter((y) => y.place < x.place).length + 1));
      const sides = Math.max(1, fin ? live.length : g.rows.filter((r) => (tp[r.tid] || []).length && !r.dnf).length || g.rows.filter((r) => !r.dnf).length), pz = S.prizes(cents, c.pot.split, sides), sh = S.sharesFor(c.pot.split, sides);
      const byT = fin ? S.payouts(cents, live.map((x) => ({ id: x.key, place: x.pl })), c.pot.split) : {}, won = [];
      live.forEach((x) => { const v = byT[x.key] || 0, ps = tp[x.key], each = Math.floor(v / ps.length); let left = v - each * ps.length; ps.forEach((p) => { const a = each + (left > 0 ? 1 : 0); if (left > 0) left--; pids[p] = (pids[p] || 0) + a; }); if (v > 0) won.push({ tid: x.key, name: x.name, place: x.pl, amt: v / 100 }); }); won.sort((x, y) => x.place - y.place);
      lines.push({ flight: g.name, board: b, pool: cents / 100, players: cnt0[gi], moved: fin && anyLive && !liveG[gi] && cnt0[gi] > 0 ? true : undefined, places: pz.map((v, i) => ({ place: i + 1, pct: sh[i], amt: v / 100 })), won: fin ? won : null, notWon: fin && !live.length && cents > 0 ? cents / 100 : 0 }); }); });
  return { pids, lines };
}
// ITEM 4: NO REFEREE IN FRIEND GAMES. At Final every dispute nobody settled (a disputed hole), every change objected to and not upheld, and every
// request a side turned down that nobody overruled (`c.cont`) is a second version of the round. Places and payouts that differ between the round as it
// stands and that version are CONTESTED: the board shows both numbers and the app names no winner for them. Uncontested places still pay. (Display only.)
function contestOf(c) { if (c.kind !== 'day' || c.day.status !== 'final' || !stakes(c)) return null; const d = c.day, src = [];
  d.teams.forEach((t) => Object.keys(d.scores[t.tid] || {}).forEach((h) => { const x = d.scores[t.tid][h]; if (x.st !== 'disputed' || !x.want) return;
    src.push({ who: 'd:' + (x.dfPid || x.df), text: tName(c, t.tid) + ' hole ' + h + ': ' + eTxt(c, x) + ' entered, ' + eTxt(c, x.want) + ' says ' + (x.df || 'another team'), ap: (y) => { const z = y.day.scores[t.tid][h]; delete z.g; delete z.p; Object.assign(z, clone(x.want)); } }); }));
  (c.harm || []).filter((e) => e.st === 'objected').forEach((e) => src.push({ who: 'a:' + e.by, text: e.text + ' (objected to by ' + ((e.ob || {}).name || 'a team') + ')', ap: (y) => moveBack(y, e.dl, true) }));
  (c.cont || []).forEach((e) => src.push({ who: 'a:' + e.by, text: e.text + ' (turned down by ' + e.dec + ')', ap: (y) => moveBack(y, e.dl, true) }));
  if (!src.length) return null; const byW = {}; src.forEach((x) => (byW[x.who] = (byW[x.who] || []).concat(x))); // also each claimant's claims TOGETHER (eight small changes decide what one does not)
  Object.keys(byW).filter((w) => byW[w].length > 1).forEach((w) => src.push({ all: true, text: byW[w].length + ' claims together: ' + byW[w].map((x) => x.text).slice(0, 3).join('; ') + (byW[w].length > 3 ? '; …' : ''), ap: (y) => byW[w].forEach((x) => x.ap(y)) }));
  const m0 = payMap(c), pids = new Set(), tids = new Set(), alt = {}, items = [];
  src.filter((x) => x.all).concat(src.filter((x) => !x.all)).slice(0, 40).forEach((sr) => { let m1; try { const y = clone(c); sr.ap(y); m1 = payMap(y); } catch (e) { return; } const ps = [];
    let mv = 0; new Set(Object.keys(m0.p).concat(Object.keys(m1.p))).forEach((p) => { if ((m0.p[p] || 0) !== (m1.p[p] || 0)) { pids.add(p); ps.push(p); } });
    m0.bd.rows.forEach((r) => { const r1 = m1.bd.rows.find((z) => z.tid === r.tid); if (!r1) return; const moved = r1.place !== r.place || r1.placeG !== r.placeG || r1.placeN !== r.placeN || r1.fPlaceG !== r.fPlaceG || r1.fPlaceN !== r.fPlaceN;
      if (moved || r1.toParG !== r.toParG || r1.toParN !== r.toParN) { if (moved) { tids.add(r.tid); mv++; } (alt[r.tid] = alt[r.tid] || []).push({ toParG: r1.toParG, toParN: r1.toParN, place: r1.place, placeG: r1.placeG, placeN: r1.placeN }); } });
    items.push({ text: sr.text, names: ps.map((p) => mName(c, p)), decides: ps.length > 0 || mv > 0 }); });
  return { items, pids, tids, alt }; }
function payoutView(c, ct0) { const d = c.day, pc = poolC(c), paid = paidPids(c), ct = ct0 === undefined ? contestOf(c) : ct0;
  const o = { entry: c.pot.entry, entrants: entrantsOf(c), paidN: paid.size, pot: pc.potC / 100, take: pc.takeC / 100, pool: pc.poolC / 100, custom: !!c.pot.split };
  if (c.kind === 'day') { const pay = dayPay(c, dayBoard(c)); o.lines = pay.lines; o.payBy = payBy(d); o.places = pay.lines[0].places; o.split = o.places.map((x) => x.pct);
    if (d.status === 'final') o.frozen = true; // the paid list is frozen at Final; a change needs the logged reopen
    if (d.status === 'final' && !d.solo && c.members.length > 1) { o.final = true; if (stakes(c)) { o.finalAt = d.finalAt || null; o.settleAt = settleAt(c); o.settled = D.now() >= o.settleAt; } /* fix 4: settle up after this time */ o.paid = c.members.map((m) => ({ pid: m.pid, name: m.name, amt: (pay.pids[m.pid] || 0) / 100 })).filter((x) => x.amt > 0);
      if (ct) o.disputes = ct.items; if (ct && (ct.pids.size || ct.tids.size)) { o.paid = o.paid.filter((x) => !ct.pids.has(x.pid)); o.contested = { note: 'Contested — players settle this themselves', items: ct.items, names: [...ct.pids].map((p) => mName(c, p)) }; o.lines.forEach((l) => (l.won || []).forEach((w) => { if (ct.tids.has(w.tid) || (d.teams.find((t) => t.tid === w.tid) || { players: [] }).players.some((p) => ct.pids.has(p))) w.contested = true; })); } } }
  else { const n = Math.max(1, paid.size || c.members.length), pz = S.prizes(pc.poolC, c.pot.split, n), sh = S.sharesFor(c.pot.split, n); o.split = sh; o.places = pz.map((v, i) => ({ place: i + 1, pct: sh[i], amt: v / 100 })); }
  return o; }
const isLocked = (la, b, now) => (la != null && now >= la) || begun(b);

// ---------- golf day: computed board ----------
function dayCtx(c) { const d = c.day, n = d.course.par.length, hcp = {}; c.members.forEach((m) => (hcp[m.pid] = S.playHcp(chOf(d, m.pid), d.pct, n))); return { fmt: d.fmt, course: d.course, hcp, count: d.count }; }
function teamCtx(c, t, net) { const d = c.day, x = dayCtx(c); x.net = net; x.thcp = S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), d.course.par.length); return x; }
function holesOf(c, tid) { const h = {}, s = (c.day.scores[tid] || {}); Object.keys(s).forEach((k) => (h[k] = s[k])); return h; }
// Flights: teams sorted by the handicap in use (team handicap in team-ball formats, else the players' average), split into n flights as evenly as
// possible (low handicaps in Flight A). Never more flights than half the teams. Worked out as a preview during set-up and FIXED at Start.
function flightPlan(c) {
  const d = c.day, want = (d.flights && (d.flights.asked || d.flights.n)) || 0, ts = d.teams.filter((t) => t.players.length), n = Math.min(want, Math.floor(ts.length / 2)); if (!want) return { n: 0 }; if (n < 2) return { n: 0, asked: want, note: 'Flights need at least 4 teams (two per flight). Everyone plays in one flight.' };
  const hv = (t) => (S.FORMATS[d.fmt].ball === 'team' ? S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), d.course.par.length) : t.players.reduce((a, p) => a + (d.hcp[p] || 0), 0) / t.players.length);
  const list = ts.map((t) => ({ tid: t.tid, name: t.name, h: Math.round(hv(t) * 10) / 10 })).sort((a, b) => a.h - b.h || a.name.localeCompare(b.name)), of = {}, groups = []; let k = 0;
  for (let i = 0; i < n; i++) { const m = Math.floor(list.length / n) + (i < list.length % n ? 1 : 0), part = list.slice(k, k + m); k += m; part.forEach((x) => (of[x.tid] = i)); groups.push({ k: 'ABCD'[i], lo: part[0].h, hi: part[part.length - 1].h, teams: m }); }
  return { n, asked: want, of, groups };
}
function dayBoard(c) {
  const d = c.day, n = d.course.par.length, by = d.net === 'gross' ? 'gross' : 'net', st = d.fmt === 'stableford', fin = d.status === 'final', wd = d.wd || {}, FL = d.flights && d.flights.of && d.status !== 'setup' ? d.flights : null;
  const rows = d.teams.filter((t) => t.players.length).map((t) => { const rN = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, true)), rG = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, false));
    const sc = d.scores[t.tid] || {}, disp = Object.keys(sc).filter((h) => sc[h].st === 'disputed').map(Number), conf = Object.keys(sc).filter((h) => sc[h].st === 'confirmed').length;
    const r = { tid: t.tid, name: t.name, thru: rN.thru, gross: rG.gross, net: rN.net, toParG: rG.toParG, toParN: rN.toParN, pts: rN.pts, ptsG: rG.pts, thcp: S.FORMATS[d.fmt].ball === 'team' ? S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), n) : null, disputed: disp, confirmed: conf, of: Object.keys(sc).length };
    if (d.fmt === 'texas') { r.drives = S.texasDrives(t.players, Object.keys(sc).sort((a, b) => a - b).map((h) => sc[h].drive).filter(Boolean), d.drives, n);
      // Playbook: a team that finishes short of the drive count takes the penalty chosen at set-up (default 2 strokes) for EACH missing drive
      const short = r.thru >= n ? Object.values(r.drives.need).reduce((a, x) => a + x, 0) : 0, pen = short * (d.drivePen == null ? 2 : d.drivePen);
      if (pen) { r.pen = { strokes: pen, drives: short, each: d.drivePen == null ? 2 : d.drivePen }; r.gross += pen; r.net += pen; r.toParG += pen; r.toParN += pen; } }
    // DID NOT FINISH (review fix): a team the commissioner marked withdrawn, or (once the round is Final) a card short of all its holes. It ranks last,
    // has no place and wins no pot money. While the round is live an unfinished card still ranks by its score to par so far.
    if (((d.nso || {})[t.tid] || []).length) r.nso = d.nso[t.tid].length; // "changed without the team's sign-off" (H1)
    if (fin && !c._proj) { const lw = lowLine(c, t.tid); if (lw) r.low = lw; } // fix 1: what the team took off its own confirmed holes, on its Final row
    r.wd = wd[t.tid] ? { by: wd[t.tid].by, at: wd[t.tid].at, reason: wd[t.tid].reason } : null; r.nc = !!(d.nc || {})[t.tid]; r.dnf = !!r.wd || r.nc || (fin && !c._proj && r.thru < n); if (FL) r.flight = FL.of[t.tid] == null ? null : FL.of[t.tid];
    return r; });
  const keyOf = (r, b) => (st ? -(b === 'net' ? r.pts : r.ptsG) : b === 'net' ? r.toParN : r.toParG), key = (r) => keyOf(r, by), ord0 = (r) => (r.dnf ? 2 : r.thru > 0 ? 0 : 1);
  // rank a list on one board: ties share a place; no card / did not finish = no place
  const rank = (list, b, f) => { const live = list.filter((r) => r.thru > 0 && !r.dnf).sort((x, y) => keyOf(x, b) - keyOf(y, b)); let p = 0; live.forEach((r, i) => { if (!i || keyOf(live[i - 1], b) !== keyOf(r, b)) p = i + 1; r[f] = p; }); list.forEach((r) => { if (!(r.thru > 0 && !r.dnf)) r[f] = null; }); };
  rank(rows, 'net', 'placeN'); rank(rows, 'gross', 'placeG');
  rows.sort((a, b) => ord0(a) - ord0(b) || key(a) - key(b) || a.name.localeCompare(b.name)); rows.forEach((r) => (r.place = by === 'net' ? r.placeN : r.placeG));
  const out = { rows, by, holes: n, payBy: payBy(d) };
  if (d.net === 'both') { const g = rows.map((r) => ({ tid: r.tid, v: st ? -r.ptsG : r.toParG, o: ord0(r) })).sort((a, b) => a.o - b.o || a.v - b.v); out.gross = g.map((x) => x.tid); }
  if (FL) out.flights = FL.groups.map((g, i) => { const rs = rows.filter((r) => r.flight === i); rank(rs, 'net', 'fPlaceN'); rank(rs, 'gross', 'fPlaceG'); return { i, k: g.k, name: 'Flight ' + g.k, lo: g.lo, hi: g.hi, tids: rs.map((r) => r.tid) }; });
  // skins (per team for team-ball formats, per player otherwise)
  if (d.extras.skins.on || d.fmt === 'skins') {
    const net = d.fmt === 'skins' ? d.net !== 'gross' : d.extras.skins.net, ents = [];
    // A team marked did-not-finish (owner rule question, default "stand"): the skins it won on the holes it played stand, and the skins nobody has won
    // yet carry among the teams still playing. Set-up option "void": the team is taken out of the skins game altogether.
    const inS = (t) => !wd[t.tid] || d.extras.skins.wd !== 'void', outS = (t) => (wd[t.tid] ? { out: true } : {});
    if (S.FORMATS[d.fmt].ball === 'team') d.teams.filter((t) => t.players.length && inS(t)).forEach((t) => { const r = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, net)); ents.push(Object.assign({ id: t.tid, s: r.per.map((x) => (x ? (net ? x.net : x.gross) : null)) }, outS(t))); });
    else { const x = dayCtx(c); d.teams.filter(inS).forEach((t) => t.players.forEach((pid) => { const h = holesOf(c, t.tid); ents.push(Object.assign(outS(t), { id: pid, s: d.course.par.map((_, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[pid]); return g >= 1 ? g - (net ? S.strokesOn(x.hcp[pid] || 0, d.course.hcp[i], n) : 0) : null; }) })); })); }
    out.skins = Object.assign(S.skins(ents, n, d.extras.skins.end), { net, end: d.extras.skins.end || 'split', wd: d.extras.skins.wd === 'void' ? 'void' : 'stand' });
  }
  out.matches = (d.matches || []).map((m) => matchState(c, m));
  out.extras = { ctp: d.extras.ctp.map((h) => ({ hole: h, win: (d.win.ctp || {})[h] || null })), ld: d.extras.ld.map((h) => ({ hole: h, win: (d.win.ld || {})[h] || null })) };
  return out;
}
// One heads-up match: sides are teams or players. Strokes off the low side (commissioner option) by hole index.
function sideScores(c, m, side) {
  const d = c.day, n = d.course.par.length, id = m[side];
  if (m.kind === 'player') { const t = d.teams.find((x) => x.players.includes(id)); const h = t ? holesOf(c, t.tid) : {}; return d.course.par.map((_, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[id]); if (S.FORMATS[d.fmt].ball === 'team') return e && Number(e.g) >= 1 ? Number(e.g) : null; return g >= 1 ? g : null; }); }
  const t = d.teams.find((x) => x.tid === id); if (!t) return d.course.par.map(() => null); const r = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, false)); return r.per.map((x) => (x ? x.gross : null));
}
function sideHcp(c, m, side) { const d = c.day, id = m[side], n = d.course.par.length; if (m.kind === 'player') return S.playHcp(chOf(d, id), m.pct != null ? m.pct : 100, n); /* a singles match plays at 100% unless the organizer set another percent */ const t = d.teams.find((x) => x.tid === id); if (!t) return 0; return Math.round(S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), n)); }
// Team vs team NET match in a player-ball format (four-ball net, review fix): each player's playing handicap, strokes off the LOW player of the
// whole match (commissioner option offLow), net score per player by hole index, then the team's best N net per hole (N = the format's count; all players for stroke/Stableford).
function fourBall(c, m) {
  const d = c.day, n = d.course.par.length, tA = d.teams.find((x) => x.tid === m.a), tB = d.teams.find((x) => x.tid === m.b); if (!tA || !tB) return [d.course.par.map(() => null), d.course.par.map(() => null)];
  const ph = {}; const mp = m.pct != null ? m.pct : d.heads && d.heads.pct != null && d.fmt === 'bestball' ? d.heads.pct : d.pct; tA.players.concat(tB.players).forEach((p) => (ph[p] = S.playHcp(chOf(d, p), mp, n))); const lo = m.offLow !== false ? Math.min(...Object.values(ph)) : 0;
  const k = d.fmt === 'shamble' || d.fmt === 'bestball' ? Number(d.count) || S.FORMATS[d.fmt].count || 1 : null;
  const one = (t) => { const h = holesOf(c, t.tid); return d.course.par.map((_, i) => { const e = h[i + 1]; if (!e || !e.p) return null; const v = t.players.map((p) => { const g = Number(e.p[p]); return g >= 1 ? g - S.strokesOn(ph[p] - lo, d.course.hcp[i], n) : null; }); if (v.some((x) => x == null)) return null; v.sort((x, y) => x - y); return v.slice(0, Math.max(1, Math.min(v.length, k || v.length))).reduce((a, x) => a + x, 0); }); };
  return [one(tA), one(tB)];
}
function matchState(c, m) {
  const d = c.day, n = d.course.par.length; let a = sideScores(c, m, 'a'), b = sideScores(c, m, 'b');
  if (m.net && m.kind === 'team' && S.FORMATS[d.fmt].ball === 'player') [a, b] = fourBall(c, m);
  else if (m.net) { let ha = sideHcp(c, m, 'a'), hb = sideHcp(c, m, 'b'); if (m.offLow !== false) { const lo = Math.min(ha, hb); ha -= lo; hb -= lo; } a = a.map((v, i) => (v == null ? null : v - S.strokesOn(ha, d.course.hcp[i], n))); b = b.map((v, i) => (v == null ? null : v - S.strokesOn(hb, d.course.hcp[i], n))); }
  const o = { mid: m.mid, kind: m.kind, type: m.type, a: m.a, b: m.b, amt: m.amt, net: !!m.net, round: m.round || null };
  o.pct = m.kind === 'player' ? (m.pct != null ? m.pct : 100) : m.pct != null ? m.pct : null;
  if (m.type === 'nassau' && n === 18) { o.nassau = S.nassau(a, b, (m.presses || []).filter((p) => p.st !== 'offered'), m.auto); o.press = m.press || 'accept';
    // next = the next hole of each nine that has really NOT been played (review fix: a closed-out bet stops counting holes, the round does not)
    const nx = (s0) => { const k = S.holesPlayed(a, b, s0, 9); return k < 9 ? s0 + k + 1 : null; }; o.next = { front: nx(0), back: nx(9) };
    o.offers = (m.presses || []).filter((p) => p.st === 'offered').map((p) => ({ from: p.from, nine: p.nine, by: p.by, side: p.side, expired: o.next[p.nine] == null || p.from < o.next[p.nine] })); }
  else o.m = S.match(a, b, 0, n);
  return o;
}

// ---------- views ----------
function nameMap(c) { const m = {}; c.members.forEach((x) => (m[x.pid] = x.name)); return m; }
function pub(c) { return { id: c.id, kind: c.kind, title: c.title, pot: c.pot, orgName: (c.members.find((m) => m.mk === c.org) || {}).name || '', count: c.members.length, max: c.max, groupId: c.groupId || null, courseId: c.courseId || null, created: c.created,
  pro: c.pro ? { tour: c.pro.tour, eventId: c.pro.eventId, eventName: c.pro.eventName, game: c.pro.game, mc: c.pro.mc, tb: c.pro.tb, lockAt: c.pro.lockAt } : null,
  day: c.day ? { flights: c.day.flights || { n: 0 }, payBy: payBy(c.day), course: c.day.course, fmt: c.day.fmt, net: c.day.net, allow: c.day.allow, pct: c.day.pct, count: c.day.count, drives: c.day.drives, drivePen: c.day.drivePen, allowStd: !!c.day.allowStd, forced: c.day.forced || null, date: c.day.date, extras: c.day.extras, heads: c.day.heads, teamSize: c.day.teamSize, status: c.day.status, lockAt: c.day.lockAt || null, open: c.day.teams.filter((t) => t.players.length < t.slots).map((t) => ({ tid: t.tid, name: t.name, free: t.slots - t.players.length })) } : null }; }
async function full(c, u) {
  await estFill(c); const o = pub(c), me1 = memberOf(c, u.mk), ro = me1 ? null : roOf(c, u.mk), me0 = me1 || ro, now = D.now(); o.role = isOrg(c, u.mk) ? 'org' : ro ? 'ro' : me0 ? 'member' : 'none'; if (ro) o.ro = true; o.me = me0 ? me0.pid : null; o.code = me0 ? c.code : undefined;
  o.members = c.members.map((m) => Object.assign({ pid: m.pid, name: m.name, org: m.mk === c.org, paid: !!m.paid, guest: !!m.guest }, isCo(c, m) ? { co: true } : {}, m.left ? { left: true } : {}));
  o.g16 = g16(c); o.co = isCo(c, me0);
  // THE NEUTRAL RULE: what is waiting for a second signature (every player sees it), who can sign, and the log of every power used
  // THE DIRECTION RULE (v1.6): every waiting request with what it still needs; a "no" from a side it concerns stays visible and can be overruled
  o.pending = (c.pend || []).map((q) => { const who = whoCan(c, q), hb = q.kind === 'hcp' && c.kind === 'day' && dirMode(c, 'hcp') ? hcpBen(c, q.p) : null, R = q.dir || null, ob = R ? R.ob || [] : [];
    const ovrEx = q.dec ? new Set(teamsOfP(c, q.by).concat(sideTeams(c, q.dec.s), teamsOfP(c, q.dec.pid), ((R && R.better) || []).flatMap((s) => sideTeams(c, s)))) : null;
    return { raise: hb ? hb.raise : undefined, harm: R ? R.worse.map((x) => sName(c, x)) : [], helps: R ? R.better.map((x) => sName(c, x)) : [], told: R ? R.told.map((x) => sName(c, x)) : [], need: R && !q.dec ? needOf(c, q).map((g) => gText(c, g)) : [], cum: q.cum || null,
      canObject: !!me1 && !q.dec && q.by !== me1.pid && !who.includes(me1.pid) && ob.some((x) => onSide(c, me1.pid, x) || speaksFor(c, me1, x)), dec: q.dec ? q.dec.name : null, ovr: (q.ovr || []).map((x) => x.name),
      canOverrule: !!me1 && !!q.dec && acctM(me1) && estOk(me1) && q.by !== me1.pid && teamsOfP(c, me1.pid).length > 0 && !teamsOfP(c, me1.pid).some((t) => ovrEx.has(t)) && !(q.ovr || []).some((x) => x.pid === me1.pid),
      sigs: (q.sigs || []).concat((q.alt || []).map((a) => a.pid)).map((p) => mName(c, p)), n: q.n, kind: q.kind, text: q.text, by: q.byName, at: q.at, tid: q.p.tid || null, hole: q.p.hole || null, pid: q.p.pid || null, mine: !!me1 && q.by === me1.pid, canSign: !!me1 && who.includes(me1.pid), who: names(c, who), v: q.kind === 'hcp' ? q.p.v : undefined }; });
  // changes open to objection for 30 minutes (Final included); an objected one can be upheld by two established players from two other teams
  o.harm = (c.harm || []).slice(-20).reverse().map((e) => { const ex = new Set(teamsOfP(c, e.by).concat(e.ob ? teamsOfP(c, e.ob.pid) : [], (e.better || []).flatMap((s) => sideTeams(c, s)))), open = objOpen(c, e, now), end = objEnd(c, e);
    return { h: e.h, kind: e.kind, text: e.text, by: e.byName, sig: e.sig || null, at: e.at, until: end === Infinity ? null : end, afterFinal: !!e.cf, open, st: e.st, sides: (e.sides || []).map((x) => sName(c, x)), worse: (e.wnc || []).map((x) => sName(c, x)), mine: !!me0 && harmedBy(c, me0.pid, e.sides),
      canObject: !!me0 && e.st === 'open' && open && harmedBy(c, me0.pid, e.sides), canUphold: !!me1 && e.st === 'objected' && acctM(me1) && estOk(me1) && teamsOfP(c, me1.pid).length > 0 && !harmedBy(c, me1.pid, e.sides) && me1.pid !== e.by && !teamsOfP(c, me1.pid).some((t) => ex.has(t)) && !(e.up || []).some((u) => u.pid === me1.pid), ob: e.ob ? e.ob.name : null, up: (e.up || []).map((u) => u.name), canDrop: !!me1 && e.st === 'objected' && e.by === me1.pid }; });
  o.signerDays = SIGNER_MIN_DAYS; o.signer = me1 && acctM(me1) ? { ok: estOk(me1), why: estOk(me1) ? '' : estWhy(me1) } : null; o.holdUntil = c.kind === 'day' ? holdUntil(c, now) || null : null;
  o.plog = (c.plog || []).slice(-40).reverse(); o.stakes = stakes(c); o.interested = !!me0 && interested(c, me0.pid) && acctOthers(c, me0.pid).length > 0; o.paidLog = (c.paidLog || []).slice(-10).reverse();
  o.notices = (c.notes || []).slice(-12).reverse().map((x) => ({ n: x.n, at: x.at, kind: x.kind, by: x.by, text: x.text, new: !!me0 && x.n > (me0.seen || 0) && x.bp !== me0.pid })); o.unseen = unseenOf(c, me0);
  { const sa = c.kind === 'day' && stakes(c) ? settleAt(c) : 0; if (sa && now >= sa) o.notices.unshift({ n: 0, at: sa, kind: 'settled', by: '', text: 'Payout settled at ' + fmtCT(sa) + '. The time for disputes and objections is over: settle up now.', new: !!me0 && (me0.stSeen || 0) < sa }); } // fix 4
  if (c.kind === 'pro') { o.payout = payoutView(c);
    const b = await boardOf(c), fm = fieldMap(b), la = lockAt(c, b), locked = isLocked(la, b, now); o.pro.lockAt = la; o.pro.locked = locked;
    o.feed = b ? { ok: true, event: b.event, earnings: b.earnings } : { ok: false };
    o.golfers = b ? b.golfers.map((g) => ({ id: g.id, name: g.name, pos: g.pos, toPar: g.toPar, today: g.today, thru: g.thru, st: g.st, tee: g.tee, started: g.started, r: g.rounds })) : [];
    if (c.pro.game === 'six') {
      const tiers = c.pro.tiers || (b && b.golfers.length >= 12 ? buildTiers(b, c.pro.rank) : null); o.tiers = tiers; const basis = c.pro.basis || (b ? tierBasis(b, c.pro.rank) : 'alpha');
      o.tierLog = (c.pro.tierLog || []).slice(-20).reverse(); o.tierBasis = { k: basis, text: basis === 'wr' ? 'Tiers follow the world ranking.' : basis === 'alpha' ? 'Tiers are alphabetical by last name (no free world ranking for this field), so nobody chose the order.' : 'Tiers follow the organizer\'s own list. Every change is logged below.' };
      const ents = Object.keys(c.pro.entries).map((pid) => Object.assign({ pid, name: (c.members.find((m) => m.pid === pid) || {}).name || 'Player' }, c.pro.entries[pid]));
      const lead = b ? b.golfers.filter((g) => g.st === 'active' && g.toPar != null).sort((x, y) => x.toPar - y.toPar)[0] : null;
      const ranked = b ? S.rankSix(ents.filter((e) => e.picks && e.picks.length === 6), fm, c.pro.mc, c.pro.tb, b.event.done && lead ? lead.toPar : null) : [];
      o.entries = ranked.map((r) => { const mine = r.pid === o.me, show = mine || locked; return { pid: r.pid, name: r.name, place: r.place, total: r.total, n: r.n, alive: r.alive, today: show ? r.per.filter((x) => r.counting.includes(x.id)).reduce((a, x) => a + ((fm[x.id] && fm[x.id].today) || 0), 0) : null, picks: show ? r.picks : null, counting: show ? r.counting : null, per: show ? r.per.map((x) => ({ id: x.id, v: x.r ? x.r.v : null, mc: !!(x.r && x.r.mc), wd0: !!(x.r && x.r.wd0) })) : null, guess: show ? r.guess : null, swap: show ? r.swap || null : null }; });
      o.waiting = ents.filter((e) => !(e.picks && e.picks.length === 6)).map((e) => ({ pid: e.pid, name: e.name }));
      // every swap is shown to the whole pool with its time; the golfers' names once picks are locked (before that picks are hidden)
      o.swaps = ents.filter((e) => e.swap).map((e) => ({ pid: e.pid, name: e.name, at: e.swap.at, from: locked || e.pid === o.me ? e.swap.fromN || (fm[e.swap.from] || {}).name || '' : null, to: locked || e.pid === o.me ? e.swap.toN || (fm[e.swap.to] || {}).name || '' : null })).sort((x, y) => y.at - x.at);
      const mine = c.pro.entries[o.me]; o.mine = mine ? { picks: mine.picks, guess: mine.guess, swap: mine.swap || null, at: mine.at || null } : null;
      if (b && b.event.done && ranked.length) { const pm = payPids(c, ranked.map((x) => ({ key: x.pid, place: x.place, pids: [x.pid] }))); o.entries.forEach((e) => (e.payout = (pm[e.pid] || 0) / 100)); }
      if (!locked) o.entries.forEach((e) => { if (e.pid !== o.me) { e.total = null; e.place = null; } });
    } else {
      const oad = c.pro.oad; o.oad = { pointsLabel: 'Oddable points', log: (oad.log || []).slice(-20).reverse().map((x) => ({ at: x.at, by: x.by, what: x.what })), season: oad.season, events: Object.keys(oad.events).map((ev) => { const E = oad.events[ev], lk = E.lockAt && now >= E.lockAt; return { id: ev, name: E.name, lockAt: E.lockAt, locked: !!lk, res: E.res || null, by: E.by || null, manual: E.manual || null, typed: E.by === 'money-manual' ? 'typed by organizer' : null, resAt: E.resAt || null, canRefresh: !!E.res && !!E.resAt && now - E.resAt <= 48 * 3600e3 && !oad.ended, golfers: lk ? [...new Set(Object.values(E.picks).map((p) => p.g))].map((id) => ({ id, name: (Object.values(E.picks).find((p) => p.g === id) || {}).n })) : [], picks: Object.keys(E.picks).filter((p) => lk || p === o.me).map((p) => ({ pid: p, golfer: E.picks[p].g, name: E.picks[p].n, pts: E.res ? (E.res[E.picks[p].g] || 0) : null })) }; }), used: (oad.used[o.me] || []) };
      const tot = {}; c.members.forEach((m) => (tot[m.pid] = 0)); Object.values(oad.events).forEach((E) => { if (!E.res) return; Object.keys(E.picks).forEach((p) => { tot[p] = (tot[p] || 0) + (E.res[E.picks[p].g] || 0); }); });
      o.table = c.members.map((m) => ({ pid: m.pid, name: m.name, total: Math.round(tot[m.pid] * 100) / 100 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)); o.table.forEach((r, i, a) => (r.place = i && a[i - 1].total === r.total ? a[i - 1].place : i + 1));
    }
  } else {
    const d = c.day; o.day.teams = d.teams.map((t) => ({ tid: t.tid, name: t.name, slots: t.slots, players: t.players.map((p) => ({ pid: p, name: nameMap(c)[p] || 'Player', hcp: d.hcp[p] == null ? null : d.hcp[p], hi: hinfo(d, p) })), scorer: t.scorer }));
    o.day.hcp = d.hcp; o.day.hsrc = d.hsrc || {}; o.day.hi = {}; c.members.forEach((m) => (o.day.hi[m.pid] = hinfo(d, m.pid))); o.day.hcpLabel = HCP_LABEL; o.day.hcpNote = HCP_NOTE;
    o.day.flights = d.status === 'setup' ? flightPlan(c) : d.flights || { n: 0 }; o.day.payBy = payBy(d); o.day.wd = d.wd || {}; o.day.nso = d.nso || {}; o.day.startAt = d.startAt || null; o.day.accts2 = twoAccounts(c); o.day.reopens = (d.reopens || []).slice(-5).reverse(); o.day.netOn = netOn(d); o.day.strict = hStrict(c); o.day.makeup = {}; c.members.forEach((m) => { const x = (d.odx || {})[m.pid]; if (x && (x.mk || x.why) && me0 && (isBoss(c, me0) || m.pid === me0.pid)) o.day.makeup[m.pid] = { why: x.why || '', made: x.mk || null }; }); o.day.noStats = !!c.noStats;
    o.day.hreq = {}; Object.keys(d.hreq || {}).forEach((p) => { const hb = dirMode(c, 'hcp') ? hcpBen(c, { pid: p, v: d.hreq[p].v }) : null; o.day.hreq[p] = { v: d.hreq[p].v, at: d.hreq[p].at, raise: hb ? hb.raise : undefined, base: hb ? hb.base : undefined, canOk: !!me1 && p !== me1.pid && (hb && hb.raise ? hcpWho(c, p, d.hreq[p].v).includes(me1.pid) : isBoss(c, me1)) }; });
    o.day.expEnd = d.status === 'live' ? expFinish(c) : null; o.day.nc = d.nc || {}; if (me0) seenPut(c, me0.pid);
    o.ent = !!c.ent; o.day.lockAt = d.lockAt || null; o.day.hlocked = hLocked(d, now); o.day.hobj = c.ent ? d.hobj || {} : {}; o.day.short9 = d.short9 || null; if (c.ent && me0) { /* item 6: every number and ruling is logged and shown to ALL players */ if (!D.stats()) o.day.hlog = d.audit.filter((x) => x.what === 'handicap').slice(-100).reverse().map((x) => ({ name: mName(c, x.pid), by: x.by, at: x.at, old: x.from, new: x.to, oddable: null, reason: ((d.tset || {})[x.pid] || {}).reason || '' })); /* Golf alone: the log is golf's own */ else try { o.day.hlog = (await D.eventLog(c.orgE, EID(c.id))).log.filter((x) => x && (x.field == null || x.field === 'hcp') && x.player && (x.new == null || (Number.isFinite(Number(x.new)) && Math.abs(Number(x.new)) <= 60))).slice(-100).reverse().map((x) => ({ name: x.player, by: x.byName || (!x.by || /^tournament director$/i.test(x.by) ? (c.members.find((m) => m.mk === c.org) || {}).name || 'Tournament director' : x.by), at: x.at, old: x.old, new: x.new, oddable: x.oddable == null ? null : x.oddable, reason: x.reason })); } catch (e) { o.day.hlog = []; } }
    const ct = contestOf(c); o.payout = payoutView(c, ct); o.day.unconfirmed = unconfirmed(c, me0); o.day.money = moneyOn(c); o.day.forced = d.forced || null; o.day.solo = !!d.solo; o.day.unassigned = c.members.filter((m) => !d.teams.some((t) => t.players.includes(m.pid))).map((m) => ({ pid: m.pid, name: m.name }));
    o.day.matches = d.matches; o.day.win = d.win;
    o.day.scores = d.scores; o.board = dayBoard(c); if (ct) o.board.rows.forEach((r) => { if (ct.tids.has(r.tid)) r.contested = true; if (ct.alt[r.tid]) r.alt = ct.alt[r.tid]; }); o.day.audit = d.audit.slice(-60).reverse();
    const myT = d.teams.find((t) => t.players.includes(o.me)); o.day.myTeam = myT ? myT.tid : null; o.day.iScore = d.teams.filter((t) => t.scorer === o.me).map((t) => t.tid);
  }
  return o;
}

// ---------- saved courses ----------
const MYC = 'lock:golf:myc';
async function myCourses(mk) { const r = await D.S.dbGet(MYC), x = ((r && r.data && r.data.by) || {})[mk]; if (!x) return { home: null, recent: [] }; const cr = await D.S.dbGet(CRS), all = (cr && cr.data && cr.data.courses) || {};
  const row = (id) => { const c = all[id]; return c ? { id, name: c.name, tees: c.tees, holes: c.holes, par: c.par, hcp: c.hcp, yards: c.yards || null, rating: c.rating == null ? null : c.rating, slope: c.slope == null ? null : c.slope, city: c.city || '', src: c.src || 'user' } : null; };
  return { home: x.home ? row(x.home) : null, recent: (x.recent || []).filter((id) => id !== x.home).map(row).filter(Boolean) }; }
// ONE "My courses" store: the stats module's (`/stats/mycourses`, kept in the player's own stats row) whenever stats is in the build; golf's own row
// `lock:golf:myc` only when it is not. Same answer either way: { home, recent: [golf course rows] }.
const stMC = () => { const st = D.stats(); return st && ['myCourses', 'myCourseUse', 'myCourseHome'].every((f) => typeof st[f] === 'function') ? st : null; };
async function myCoursesU(u) { const st = stMC(); if (!st) return myCourses(u.mk); let r; try { r = await st.myCourses(u.e); } catch (e) { return { home: null, recent: [] }; }
  const cr = await D.S.dbGet(CRS), all = (cr && cr.data && cr.data.courses) || {}, row = (x) => { const c = x && all[x.id]; return c ? { id: x.id, name: c.name, tees: c.tees, holes: c.holes, par: c.par, hcp: c.hcp, yards: c.yards || null, rating: c.rating ?? null, slope: c.slope ?? null, city: c.city || '', src: c.src || 'user' } : null; };
  const home = row(r && r.home); return { home, recent: ((r && r.recent) || []).filter((x) => !home || x.id !== home.id).map(row).filter(Boolean) }; }
async function myCourseSet(u, a, id, b) { const st = stMC(); if (!st) return false; const cr = await D.S.dbGet(CRS), c = ((cr && cr.data && cr.data.courses) || {})[id]; if (!c) throw bad(404, 'Course not found');
  const sum = (v) => (Array.isArray(v) ? v.reduce((x, y) => x + (Number(y) || 0), 0) : Number(v) || null);
  if (a === 'use') await st.myCourseUse(u.e, { id, name: c.name, city: c.city || '', state: c.state || '', holes: c.par.length === 9 ? 9 : 18, tee: { name: c.tees, rating: c.rating ?? null, slope: c.slope ?? null, par: sum(c.par), yards: sum(c.yards) } });
  else if (a === 'home') await st.myCourseHome(u.e, b.on === false ? null : id); else if (a === 'forget') { if (typeof st.myCourseRemove === 'function') await st.myCourseRemove(u.e, id); } else throw bad(400, 'Unknown change'); return true; }
// Dedupe by name + tees. A user's own entry can be edited until a round uses it. Courses picked from OpenGolfAPI are stored when SELECTED (no bulk copy).
async function saveCourse(c, by, quiet) {
  // key (review fix): the API course id + tee when it came from OpenGolfAPI, else name + city + state + par + tees (same-name courses in other towns stay apart)
  const key = (c.src === 'opengolfapi' && c.extId ? 'og:' + c.extId + '|' + (c.teeKey || c.tees) : [c.name, c.city || '', c.state || '', c.par.reduce((a, x) => a + x, 0), c.tees].join('|')).toLowerCase().replace(/[^a-z0-9|:-]/g, ''), now = D.now(), x = Object.assign({}, c); delete x.id;
  return mutateRow(CRS, () => ({ courses: {} }), (d) => { d.courses = d.courses || {}; const hit = Object.entries(d.courses).find(([, y]) => y.key === key);
    if (hit) { const [id, y] = hit; if (quiet || y.by !== by) return { nochange: true, v: { id, dup: true } }; if (y.used) throw bad(409, 'This course has been used in a round. Save it under a different tees name.'); d.courses[id] = Object.assign(x, { key, by, used: 0, at: y.at || now }); return { id }; }
    if (Object.keys(d.courses).length >= 3000) { if (quiet) return { nochange: true, v: null }; throw bad(503, 'Course list is full'); } let id; do { id = rnd(8); } while (d.courses[id]); d.courses[id] = Object.assign(x, { key, by, used: 0, at: now }); return { id }; });
}
// One player's handicap for a game, normalized from the stats contract. Never throws (no answer = no number; the organizer sets one).
const NOH = { index: null, rounds: 0, confirmedIndex: null, confirmedRounds: 0, text: '', event: null, setBy: null, use: null };
const r1 = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);
async function hcpOf(userKey, opts) { if (!userKey) return NOH; try { const h = await D.handicapFor(userKey, opts || {}), o = (h && h.oddable) || {};
  return { index: r1(o.index), rounds: h.rounds != null ? h.rounds : o.rounds || 0, confirmedIndex: r1(h.confirmedIndex), confirmedRounds: h.confirmedRounds || 0, text: clean(h.text || o.text || '', 60), event: r1(h.event), setBy: h.setBy === 'tournament' ? 'tournament' : h.setBy === 'organizer' ? 'organizer' : null, use: h.setBy === 'organizer' ? null : r1(h.use), reason: h.reason, at: h.at, why: clean(h.why || '', 120), ask: clean(h.ask || '', 240), mk: mkLite(h.makeup), makeup: h.makeup || null }; } catch (e) { return NOH; } }
// THE MAKE-UP OF A NUMBER (stats v1.2, manager Nov 16 2026): the organizer of a money game sees what every player's number is made of before the game
// starts. Kept on the game: the one-line text, the counts and who confirmed (names as stats gives them). The round-by-round list is asked for live (route `makeup`).
const mkLite = (m) => (m && typeof m === 'object' ? { n: Number(m.n) || 0, scored: Number(m.scored) || 0, linked: Number(m.linked) || 0, typed: Number(m.typed) || 0, confirmers: Number(m.confirmers) || 0, need: Number(m.need) || 3, ok: !!m.ok, why: clean(m.why || '', 120), text: clean(m.text || '', 160), who: (Array.isArray(m.who) ? m.who : []).slice(0, 6).map((w) => ({ name: clean(w && w.name, 30), n: Number(w && w.n) || 0 })) } : null);
const mkFull = (m) => { const l = mkLite(m); if (!l) return null; l.rounds = (Array.isArray(m.rounds) ? m.rounds : []).slice(0, 20).map((r) => ({ date: clean(r && r.date, 12), what: clean(r && r.what, 60), score: r && r.score != null ? Number(r.score) : null, diff: r && r.diff != null ? Number(r.diff) : null, used: !!(r && r.used), how: clean(r && r.how, 40), typed: !!(r && r.typed), byName: clean(r && r.byName, 30) })); return l; };
const keyOfMember = (m) => (m.guest ? 'guest:' + m.gid : m.e || null);
// Course handicap used for strokes: the player's handicap (index) for this game converted with the course's rating and slope (WHS).
// A player with no handicap at all (no index, nothing set) plays off 0 strokes, not off the course's rating-minus-par.
// `use === null` (no usable number) is handled HERE, explicitly: such a player has 0 strokes and the stats / ratings maths is never called with null (the
// stats module's strokesOnHole and courseHandicap may throw on it). Where handicaps are strict the round cannot start in that state at all (hStrict).
const chOf = (d, pid) => { const v = d.hcp[pid]; if (v == null || !Number.isFinite(Number(v)) || (d.hsrc || {})[pid] === 'none') return 0; try { const ch = S.courseHcp(Number(v), d.course); return Number.isFinite(ch) ? ch : 0; } catch (e) { return 0; } };
// What the phone shows next to a player. The real-results Oddable index ALWAYS shows, in the stats module's own words ("12.6 · 4 of 20 rounds
// confirmed"); a tournament number, an organizer's number or the confirmed index played off shows next to it, never instead of it (E-H addendum).
function hinfo(d, pid) {
  const o = (d.odx || {})[pid] || null, src = (d.hsrc || {})[pid] || 'none', v = d.hcp[pid] == null ? null : d.hcp[pid], f = (x) => (Math.round(x * 10) / 10).toFixed(1), by = (d.hby || {})[pid] || null, rq = (d.hreq || {})[pid] || null;
  const odd = o && o.index != null ? 'Oddable ' + (o.text || f(o.index) + ' (real results)') : o && o.rounds ? 'Oddable: no index yet' + (o.text && / · /.test(o.text) ? ' · ' + o.text.split(' · ').slice(1).join(' · ') : '') : 'Oddable: no rounds yet';
  const text = src === 'tournament' ? odd + ' · Tournament ' + f(v) + ', set by director' : src === 'typed' ? odd + ' · ' + (by && by.pid !== pid ? 'Set by ' + by.name + ': ' + f(v) + (by.ok ? ', signed by ' + by.ok : '') : 'Entered ' + f(v) + (by && by.ok ? ', OK\'d by ' + by.ok : ''))
    : src === 'oddable' && o && o.index != null && v !== o.index ? odd + ' · Plays off ' + f(v) + ' (confirmed rounds)' : rq ? odd + ' · Asked for ' + f(rq.v) + ': waiting for an OK' : odd;
  return { used: src === 'none' ? null : v, ch: v == null ? null : Math.round(chOf(d, pid)), src, oddable: o && o.index != null ? o.index : null, rounds: (o && o.rounds) || 0, confirmedRounds: (o && o.confirmedRounds) || 0, text, ask: rq ? rq.v : null, set: src === 'tournament' ? (d.tset || {})[pid] || null : null };
}
// Set a member's handicap for this game from the stats answer (H1 / E-H): play off `use` (the tournament's value when the director set one, else the
// confirmed index in a money game / the full index in a casual one). With no usable number the organizer's (or an OK'd) typed number stays.
function applyIdx(d, pid, h) { d.odx = d.odx || {}; d.hsrc = d.hsrc || {}; d.tset = d.tset || {}; d.odx[pid] = Object.assign({ index: h.index, rounds: h.rounds, confirmedIndex: h.confirmedIndex, confirmedRounds: h.confirmedRounds, text: h.text || '' }, h.why ? { why: h.why } : {}, h.mk ? { mk: h.mk } : {});
  if (h.setBy !== 'tournament' && d.tset[pid] && d.tset[pid].local && d.hsrc[pid] === 'tournament') return; // Golf alone: the director's number is kept on the game and stays
  if (h.setBy === 'tournament' && h.use != null) { d.hcp[pid] = h.use; d.hsrc[pid] = 'tournament'; d.tset[pid] = { v: h.use, at: h.at || null, reason: h.reason || '' }; if (d.hreq) delete d.hreq[pid]; return; } // shown as "Set by tournament"; the log itself is the stats module's
  delete d.tset[pid];
  if (h.use != null) { d.hcp[pid] = h.use; d.hsrc[pid] = 'oddable'; if (d.hreq) delete d.hreq[pid]; if (d.hby) delete d.hby[pid]; } else if (d.hsrc[pid] === 'typed' && d.hcp[pid] != null) { /* keeps the number that was set */ } else { d.hcp[pid] = 0; d.hsrc[pid] = 'none'; } }
// A number typed for a player with no usable index. setTyped = it is played off (set by the organizer, OK'd by someone else, or typed in a game with
// no money). askTyped = a player's own number in a MONEY game: it only asks; the organizer (or, for the organizer's own number, another player who is
// not on the organizer's team) has to OK it before it counts (review fix: nobody sets their own number where money is shown).
function setTyped(d, pid, v, by, now, okBy) { d.hsrc = d.hsrc || {}; d.hby = d.hby || {}; d.hcp[pid] = Math.round(v * 10) / 10; d.hsrc[pid] = 'typed'; d.hby[pid] = Object.assign({ pid: by.pid, name: by.name, at: now }, okBy ? { ok: okBy } : {}); if (d.hreq) delete d.hreq[pid]; }
function askTyped(d, pid, v, now) { d.hreq = d.hreq || {}; d.hreq[pid] = { v: Math.round(v * 10) / 10, at: now }; }
// A player's own typed number: asks in a money game, counts at once otherwise. Ignored when the player already has a usable index or a tournament number.
function selfTyped(c, m, v, now) { const d = c.day; if (v == null || ['oddable', 'tournament'].includes((d.hsrc || {})[m.pid])) return false; if (hStrict(c)) return ownAsk(c, m, v, now); setTyped(d, m.pid, v, m, now); return false; }
// N6: a player's own number where handicaps are strict. NOT HIGHER than the number in use / the Oddable index: it counts at once (it only costs the
// player's own team). Higher, or no number to compare with: it is ASKED for, and a player on another team who does not gain signs it. -> asked?
function ownAsk(c, m, v, now) { const d = c.day, base = hBase(d, m.pid); if (!c.ent && base != null && v <= base + 1e-9) { const old = d.hcp[m.pid] == null ? null : d.hcp[m.pid]; setTyped(d, m.pid, v, m, now, 'own number, not higher'); audit(d, { at: now, by: m.name, what: 'handicap', pid: m.pid, from: old, to: v, note: 'own number, not higher than ' + base.toFixed(1) }); return false; } askTyped(d, m.pid, v, now); return true; }
// When a set-up change puts money on a game, numbers players typed for themselves go back to "asked" until someone OKs them.
function demoteSelfTyped(c, now) { const d = c.day; if (!hStrict(c)) return; Object.keys(d.hsrc || {}).forEach((p) => { const by = (d.hby || {})[p]; if (d.hsrc[p] === 'typed' && by && !by.ok && (by.pid === p || (interested(c, by.pid) && acctOthers(c, by.pid).length > 0))) { /* typed by the player, or set alone by someone who plays */ askTyped(d, p, d.hcp[p], now); d.hcp[p] = 0; d.hsrc[p] = 'none'; delete d.hby[p]; } }); }

// Who has partnered with whom (P1 Rotate / Hot pairs): finished golf days these members played together, from the lifetime index of their games.
// -> [{players: [pids of THIS game], date, place, of, result}] one per past team holding 2+ of this game's members.
async function pairHistory(c) {
  const r = await D.S.dbGet(IDX), mine = (r && r.data && r.data.mine) || {}, keyOf = (m) => (m.guest ? 'g:' + m.gid : m.mk), here = {}; c.members.forEach((m) => (here[keyOf(m)] = m.pid));
  const ids = [...new Set(c.members.flatMap((m) => (mine[keyOf(m)] || []).slice(-40)))].filter((id) => id !== c.id).slice(-150), out = [];
  for (const id of ids) { let g; try { g = await getC(id); } catch (e) { continue; } if (g.kind !== 'day' || g.day.status !== 'final' || g.day.solo) continue; const bd = dayBoard(g), tops = bd.rows.filter((x) => x.place === 1).length;
    g.day.teams.forEach((t) => { const ps = t.players.map((p) => g.members.find((m) => m.pid === p)).filter(Boolean).map((m) => here[keyOf(m)]).filter(Boolean); if (ps.length < 2) return; const row = bd.rows.find((x) => x.tid === t.tid);
      out.push({ players: ps, date: g.day.date, place: row && row.place ? row.place : undefined, of: bd.rows.length, result: row && row.place === 1 && tops === 1 && bd.rows.length > 1 ? 'W' : null }); }); }
  return out;
}

// ---------- create ----------
async function create(u, b, ip) {
  rate('create', u.mk, ip); const now = D.now(), kind = b.kind === 'day' ? 'day' : b.kind === 'pro' ? 'pro' : null; if (!kind) throw bad(400, 'Pick Pro tournament or Our golf day');
  const title = clean(b.title, 40); if (title.length < 2) throw bad(400, 'Give it a name (2+ characters)');
  let id; do { id = rnd(10); } while (await D.S.dbGet(ROW(id)));
  // groupId is NEVER taken from the request (review fix): a game is attached to a group only through the Groups module, which checks that the caller is that group's commissioner (attachTo).
  const c = { id, kind, title, org: u.mk, orgE: u.e, created: now, pot: cleanPot(b.pot), groupId: null, members: [], co: [], notes: [], max: await limits.maxPeople(u.e, id) };
  c.members.push({ pid: newPid(c), mk: u.mk, e: u.e, name: nameFor(u, b.myName), joined: now, paid: false }); // e (account key) stays on the server: handicapFor needs it
  c.ent = !!(await limits.isEnterprise(u.e)); // E-H: an Enterprise account's games are tournaments whose director may set handicaps
  if (kind === 'pro') {
    const P = b.pro || {}, tour = F.TOURS[P.tour] ? P.tour : null; if (!tour) throw bad(400, 'Pick a tour');
    const game = P.game === 'oad' ? 'oad' : P.game === 'six' ? 'six' : null; if (!game) throw bad(400, 'Pick a game');
    c.pro = { tour, game, mc: ['w1', 'p10', 'out'].includes(P.mc) ? P.mc : 'w1', tb: P.tb === 'best' ? 'best' : 'score', rank: (Array.isArray(P.rank) ? P.rank : String(P.rank || '').split(/\n/)).map((x) => clean(x, 50)).filter(Boolean).slice(0, 200), tierLog: [], entries: {}, oad: { season: clean(P.season || String(new Date(now).getUTCFullYear()), 8), events: {}, used: {} } };
    if (game === 'six') {
      const ev = clean(P.eventId, 20); if (!ev) throw bad(400, 'Pick a tournament'); let bd = null; try { bd = await D.feed.board(tour, ev); } catch (e) {}
      if (!bd) throw bad(503, 'Could not read the tour leaderboard. Try again in a minute.');
      const la = feedLock(bd); if (!la || isLocked(la, bd, now)) throw bad(409, 'Picks for that tournament are already closed (the first tee time has passed)');
      if (bd.golfers.length >= 12 && bd.golfers.length < 50) { /* tiers shrink in proportion (golf-score tiers) */ } if (bd.golfers.length && bd.golfers.length < S.MIN_FIELD) throw bad(409, 'Pick six needs at least ' + S.MIN_FIELD + ' golfers in the field; this one has ' + bd.golfers.length + '.');
      Object.assign(c.pro, { eventId: ev, eventName: bd.event.name, start: bd.event.start, lockAt: la, tiers: bd.golfers.length >= 12 ? buildTiers(bd, c.pro.rank) : null, basis: tierBasis(bd, c.pro.rank) });
      if (c.pro.rank.length) c.pro.tierLog.push({ at: now, by: c.members[0].name, what: 'Tier order set from the organizer\'s own list at set-up', n: c.pro.rank.length, top: c.pro.rank.slice(0, 6) });
    }
  } else {
    let course; if (b.courseId) { const r = await D.S.dbGet(CRS), cc = r && r.data && r.data.courses && r.data.courses[String(b.courseId)]; if (!cc) throw bad(404, 'Course not found'); course = cleanCourse(cc); course.id = String(b.courseId); } else course = cleanCourse(b.course);
    c.day = Object.assign(cleanDay(b.solo ? Object.assign({}, b.day, { fmt: 'stroke' }) : b.day || {}, { course }), { course, teams: [], hcp: {}, matches: [], win: { ctp: {}, ld: {} }, scores: {}, audit: [], eids: [], status: 'setup' });
    if (c.ent) { try { await D.eventSetup(u.e, EID(id), { title, sport: 'golf', lockAt: c.day.lockAt || undefined }); } catch (e) { if (e.status !== 503) throw e; c.noStats = true; } } // L8: no stats module in the build = the day is still created; handicaps cannot be set until stats is there // E-H: the stats module holds the tournament's handicap edits
    if (b.solo) c.day.solo = true;
    applyIdx(c.day, c.members[0].pid, await hcpOf(u.e, hOpts(c))); selfTyped(c, c.members[0], num((b.day || {}).myHcp, -10, 54), now); // H1: the Oddable index when there is one; a typed number only without one (asked, not set, in a money game)
    if (b.solo) { // a ONE-PLAYER round is a valid game: stroke play, one team of one, starts at once
      Object.assign(c.day, { fmt: 'stroke', solo: true, teamSize: 1, status: 'live' }); c.day.teams.push({ tid: 'T1', name: c.members[0].name, slots: 1, players: [c.members[0].pid], scorer: c.members[0].pid });
    } else { const nT = Math.max(0, Math.min(Math.floor(c.max / Math.max(1, c.day.teamSize)) || 1, num((b.day || {}).teams, 0, 100) || 0));
      for (let i = 0; i < nT; i++) c.day.teams.push({ tid: 'T' + (i + 1), name: 'Team ' + (i + 1), slots: c.day.teamSize, players: [], scorer: null }); }
    if (!course.id) { const saved = await saveCourse(course, course.src === 'opengolfapi' ? 'ogapi' : u.mk, true); if (saved && saved.id) course.id = saved.id; }
    if (course.id) await mutateRow(CRS, () => ({ courses: {} }), (d) => { const x = d.courses && d.courses[course.id]; if (!x) return { nochange: true }; x.used = (x.used || 0) + 1; return {}; });
    if (course.id) { try { await mutateRow(MYC, () => ({ by: {} }), (d) => { d.by = d.by || {}; const x = d.by[u.mk] = d.by[u.mk] || { home: null, recent: [] }; x.recent = [course.id].concat((x.recent || []).filter((y) => y !== course.id)).slice(0, 8); return {}; }); } catch (e) { /* the game is still created */ } }
  }
  if (c.day && c.day.course.id) c.courseId = c.day.course.id;
  c.code = await newCodeFor(id, u.mk); c.u = now;
  await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: c, updated: now }, true);
  if (c.day && c.day.solo) await recPlays(c, 'golf-solo', [c.members[0].pid]); // a solo round is a play the moment it starts
  if (b.groupId) { try { return await attachTo(c, u, clean(b.groupId, 20), b.pot && b.pot.pot); } catch (e) { c.attachError = e.status ? e.message : 'Could not add it to the group'; } }
  return c;
}

// ---------- golf day: score entry ----------
function canScore(c, mk, tid) { const me0 = memberOf(c, mk); const t = c.day.teams.find((x) => x.tid === tid); if (!t) throw bad(404, 'No such team'); return { t, ok: isOrg(c, mk) || (me0 && t.scorer === me0.pid), me0 }; }
// ATTACH TO A GROUP: only when the caller is the golf game's organizer AND that group's commissioner. Groups checks the commissioner
// (groups.attachGame) and calls back attachToGroup(gameId, groupId, contestId), which only accepts an attach this route has just asked for.
const ATT = new Map();
async function attachTo(c, u, groupId, pot) {
  if (!isOrg(c, u.mk)) throw bad(403, 'Only the organizer can attach this to a group'); if (!groupId) throw bad(400, 'Which group?'); const GR = D.groups(); if (!GR) throw bad(503, 'Groups is not in this build, so this game cannot be added to a group yet.');
  const k = c.id + '|' + groupId; ATT.set(k, D.now() + 30e3); let r; try { r = await GR.attachGame(groupId, u.e, { type: 'golf', ref: c.id, name: c.title, pot: pot === 'main' ? 'main' : 'side' }); } finally { ATT.delete(k); }
  const g = await getC(c.id); if (g.groupId !== groupId) return mutC(c.id, (d) => { d.groupId = groupId; d.contestId = (r && r.cid) || d.contestId || null; d.u = D.now(); return d; }); return g;
}
function entryOf(c, t, b) {
  const d = c.day, F0 = S.FORMATS[d.fmt], hole = Number(b.hole); if (!(Number.isInteger(hole) && hole >= 1 && hole <= d.course.par.length)) throw bad(400, 'Pick a hole');
  const e = {}; if (F0.ball === 'team') { e.g = num(b.g, 1, 15); if (e.g == null || !Number.isInteger(e.g)) throw bad(400, 'Strokes 1 to 15'); e.who = t.players.slice(); } // team score + who played (for stats)
  else { e.p = {}; t.players.forEach((p) => { const v = num(b.p && b.p[p], 1, 15); if (v == null || !Number.isInteger(v)) throw bad(400, 'Strokes 1 to 15 for every player on the team'); e.p[p] = v; }); }
  if (d.fmt === 'texas') { if (!t.players.includes(b.drive)) throw bad(400, 'Whose drive was used?'); e.drive = b.drive; }
  if (d.fmt === 'florida' && b.shots) { const sh = (Array.isArray(b.shots) ? b.shots : []).map(String); if (sh.some((p) => !t.players.includes(p))) throw bad(400, 'Unknown player in the shot list'); const er = S.floridaCheck(sh, e.g); if (er) throw bad(400, er); e.shots = sh; }
  if (b.putts != null) { const pu = num(b.putts, 0, 10); if (pu != null) e.putts = pu; }
  return { hole, e };
}
const same = (x, y) => JSON.stringify([x.g, x.p, x.drive, x.shots, x.putts]) === JSON.stringify([y.g, y.p, y.drive, y.shots, y.putts]);
const audit = (d, o) => { d.audit.push(o); if (d.audit.length > 3000) d.audit.splice(0, d.audit.length - 3000); };

// ---------- one and done ----------
function oadRes(b) { const res = {}; const posN = {}; b.golfers.forEach((g) => { const p = parseInt(String(g.pos).replace(/^T/, ''), 10); if (p) posN[p] = (posN[p] || 0) + 1; });
  b.golfers.forEach((g) => { if (b.earnings) res[g.id] = g.st === 'active' ? g.earn || 0 : 0; else { const p = parseInt(String(g.pos).replace(/^T/, ''), 10); res[g.id] = g.st === 'active' && p ? S.finishPoints(p, posN[p]) : 0; } });
  return { res, by: b.earnings ? 'money' : 'points' }; }
async function oadSettle(c) { // stores results of finished events once (prize money if the feed has it for every finisher, else finish points)
  const todo = Object.keys(c.pro.oad.events).filter((ev) => !c.pro.oad.events[ev].res || c.pro.oad.events[ev].by === 'money-manual'); if (!todo.length) return c; // N4: the feed's prize money replaces a typed figure
  const done = {}; for (const ev of todo.slice(0, 3)) { let b = null; try { b = await D.feed.board(c.pro.tour, ev); } catch (e) {} if (!b || !b.event.done) continue;
    const r0 = oadRes(b); if (c.pro.oad.events[ev].res && r0.by !== 'money') continue; done[ev] = r0; }
  // H6: a "final" reading is kept only after TWO MATCHING reads at least 10 minutes apart (the first one of a just-finished event is often not the last word)
  const now = D.now(), sigs = {}; Object.keys(done).forEach((ev) => (sigs[ev] = readSig([done[ev].by, done[ev].res]))); if (!Object.keys(done).some((ev) => { const r = c.pro.oad.events[ev].read; return !r || r.sig !== sigs[ev] || now - r.at >= AGAIN; })) return c;
  return mutC(c.id, (d) => { let ch = false; Object.keys(done).forEach((ev) => { const E = d.pro.oad.events[ev]; if (!E || (E.res && E.by !== 'money-manual')) return; const r = E.read;
      if (r && r.sig === sigs[ev] && now - r.at >= AGAIN) { if (E.by === 'money-manual') { E.prev = { res: E.res, by: E.by, manual: E.manual }; delete E.manual; d.pro.oad.log = (d.pro.oad.log || []).concat({ at: now, by: 'Tour feed', what: 'Prize money from the tour feed replaced the typed figures for ' + E.name }).slice(-100); } Object.assign(E, done[ev], { resAt: now }); delete E.read; ch = true; } else if (!r || r.sig !== sigs[ev]) { E.read = { sig: sigs[ev], at: now }; ch = true; } }); return ch ? d : { nochange: true, v: d }; });
}

// Join a golf game (by its code, or from its group): the people cap, the G16 return of a left entry, the team slot and the handicap (asked, never set, where handicaps are strict).
async function joinC(c, u, b, now) {
  const max = await limits.maxPeople(c.orgE, c.id), tid = b.tid ? String(b.tid) : null, hj = c.kind === 'day' && !anyMember(c, u.mk) ? await hcpOf(u.e, hOpts(c)) : null; let asked = false, late = null; await estFill(c);
      const g = await mutC(c.id, (d) => { let m = anyMember(d, u.mk);
        // G16 (review fix): an entry with a pick belongs to the account. Coming back after leaving gives the SAME entry back, picks still locked.
        if (m && m.left) { delete m.left; m.back = now; }
        else if (!m) { if (d.members.length >= Math.max(max, 0)) throw bad(409, 'This game is full (up to ' + max + ' golfers). ' + PRICE); if (d.kind === 'day' && d.day.status === 'final') throw bad(409, 'This golf day is over'); m = { pid: newPid(d), mk: u.mk, e: u.e, name: nameFor(u, b.myName), joined: now, paid: false }; d.members.push(m);
          if (d.kind === 'day') { applyIdx(d.day, m.pid, hj || NOH); asked = selfTyped(d, m, num(b.hcp, -10, 54), now); } }
        else if (!tid) return { nochange: true, v: d };
        if (tid && d.kind === 'day') { const t = d.day.teams.find((x) => x.tid === tid); if (!t) throw bad(404, 'No such team'); if (d.ent && m.mk === d.org) throw bad(409, DIR_PLAY, { director: true }); if (!t.players.includes(m.pid)) { if (t.players.length >= t.slots) throw bad(409, 'That team is full'); if (d.day.status === 'live') { late = propose(d, m, 'latejoin', { pid: m.pid, tid: t.tid }, now); d.u = now; return d; } /* M4: a late player, before the team's hole 3 */ if (d.day.status !== 'setup') throw bad(409, 'Teams are set: the round has started'); d.day.teams.forEach((x) => (x.players = x.players.filter((p) => p !== m.pid))); t.players.push(m.pid); if (!t.scorer) t.scorer = m.pid; } }
        d.u = now; return d; });
  return { g, asked, late };
}

// The second signature on a waiting action (route `sign`, and `team` op `hcpok` for a handicap). The async step of an action (a director's handicap in
// the stats module) runs here, after the signer has been checked.
async function signRoute(c, u, n, ok) {
  const mem = memberOf(c, u.mk), now = D.now(), q0 = (c.pend || []).find((y) => y.n === Number(n)); if (!mem || !q0) throw bad(404, 'That request is no longer waiting.'); const A = ACT[q0.kind], actor0 = c.members.find((m) => m.pid === q0.by); let x = null, out = null; const was = c.kind === 'day' ? casualOf(c) : null;
  if (ok && A.pre && actor0) { if (!whoCan(c, q0).includes(mem.pid)) throw bad(403, 'You cannot sign this one.'); A.chk(c, actor0, q0.p, now); x = await A.pre(c, actor0, q0.p); }
  let g = await mutC(c.id, (d) => { const me = memberOf(d, u.mk); if (!me) throw bad(404, 'Golf game not found'); out = signAct(d, me, n, ok, now, x); d.u = now; return d; });
  if (out.expired) throw bad(409, 'That request no longer fits the game and was dropped: ' + out.expired, { expired: true });
  if (g.kind === 'day' && g.day.status === 'setup' && casualOf(g) !== was) g = await reIdx(g);
  return { g, out };
}
// OK (or turn down) a number a player asked for (route `team` op `hcpok`, and "Sign all handicaps").
async function hcpOkRoute(c, u, pid, on, now) { let okOut = null;
  const g = await mutC(c.id, (d) => { const D2 = d.day, me = memberOf(d, u.mk), rq = (D2.hreq || {})[pid], pm = d.members.find((m) => m.pid === pid); if (!me || !pm || !rq) throw bad(404, 'No handicap is waiting for an OK'); if (hLocked(D2, now)) throw bad(409, 'Handicaps are closed: the ' + (d.ent ? 'tournament' : 'round') + ' has started');
          if (pid === me.pid) { if (!on) { delete D2.hreq[pid]; d.u = now; return d; } throw bad(403, 'Someone else has to OK your handicap.'); } if (d.ent) throw bad(409, 'In a tournament the director sets the handicap, with a reason.');
          if (dirMode(d, 'hcp')) { // N6: OK-ing a number IS the second signature, under the direction rule (a higher number: an established player on another team; the organizer too, no special case)
            const pp = { pid, v: rq.v }, hb = hcpBen(d, pp), who = hcpWho(d, pid, rq.v);
            if (!on) { if (!isBoss(d, me) && !who.includes(me.pid)) throw bad(403, 'Only the organizer or someone who could sign it turns a handicap down'); delete D2.hreq[pid]; audit(D2, { at: now, by: me.name, what: 'handicap turned down', pid, from: rq.v }); d.u = now; return d; }
            if (hb.raise && !who.includes(me.pid)) throw bad(403, pm.name + ' asks for ' + rq.v.toFixed(1) + (hb.base != null ? ' (higher than ' + hb.base.toFixed(1) + ')' : ' (no number to compare with)') + '. A player on another team (Oddable account at least ' + SIGNER_AGE + ' old) signs it: ' + (andList(names(d, who)) || 'nobody in this game can') + '.', { raise: true });
            const old = D2.hcp[pid] == null ? null : D2.hcp[pid]; setTyped(D2, pid, rq.v, pm, rq.at, hb.raise ? me.name : 'own number, not higher'); audit(D2, { at: now, by: pm.name, sig: hb.raise ? me.name : undefined, what: 'handicap OK', pid, from: old, to: rq.v });
            const text = 'set ' + pm.name + '\'s handicap: ' + (hb.base != null ? hb.base.toFixed(1) : 'none') + ' → ' + rq.v.toFixed(1) + (hb.raise ? ' (higher)' : ''); plog(d, { at: now, st: 'signed', kind: 'hcp', text, by: pm.name, sig: me.name }); notify(d, 'act', me, pm.name + ', signed by ' + me.name + ': ' + text + '.'); d.u = now; return d; }
          const askerBoss = isBoss(d, pm), mine = signers(d, pid, {}).includes(me.pid);
          if (!on) { if (!isBoss(d, me) && !(askerBoss && mine)) throw bad(403, 'Only the organizer turns a handicap down'); delete D2.hreq[pid]; audit(D2, { at: now, by: me.name, what: 'handicap turned down', pid, from: rq.v }); d.u = now; return d; }
          if (askerBoss) { // an organizer's own number: the ask is theirs, and a NEUTRAL signs it
            if (!mine) throw bad(403, 'A player who is not on the organizer\'s team (and is not an organizer) has to OK the organizer\'s handicap.'); setTyped(D2, pid, rq.v, pm, rq.at, me.name); audit(D2, { at: now, by: pm.name, sig: me.name, what: 'handicap OK', pid, to: rq.v });
            const text = 'set ' + pm.name + '\'s handicap to ' + rq.v.toFixed(1); plog(d, { at: now, st: 'signed', kind: 'hcp', text, by: pm.name, sig: me.name }); notify(d, 'act', null, pm.name + ', signed by ' + me.name + ': ' + text + '.'); d.u = now; return d; }
          if (!isBoss(d, me)) throw bad(403, 'Only the organizer OKs handicaps'); const p = { pid, v: rq.v, reason: '', ask: true }; ACT.hcp.chk(d, me, p, now);
          // the organizer SETS the asked number (the neutral rule). Only when nobody else could sign (a two-team game) does the player's own ask count as the signature.
          if (gated(d, me, 'hcp', p) && signers(d, me.pid, ACT.hcp.sig(d, me, p)).includes(pid)) { setTyped(D2, pid, rq.v, pm, rq.at, me.name); audit(D2, { at: now, by: me.name, sig: pm.name, what: 'handicap OK', pid, to: rq.v }); const text = 'set ' + pm.name + '\'s handicap to ' + rq.v.toFixed(1); plog(d, { at: now, st: 'signed', kind: 'hcp', text, by: me.name, sig: pm.name }); notify(d, 'act', null, me.name + ', asked for by ' + pm.name + ': ' + text + '.'); }
          else { okOut = propose(d, me, 'hcp', p, now); if (okOut.pending) { const q2 = d.pend.find((y) => y.n === okOut.pending); if (q2) q2.ask = true; } }
          d.u = now; return d; });
          return { g, okOut }; }
// Money, a money match or flights were switched on or off: the number to play off changes (confirmed index <-> full index), so ask stats again (M3).
async function reIdx(g) { const fresh = {}, now = D.now(); for (const m of g.members) if (keyOfMember(m)) fresh[m.pid] = await hcpOf(keyOfMember(m), hOpts(g));
  return mutC(g.id, (d) => { if (d.day.status !== 'setup') return { nochange: true, v: d }; Object.keys(fresh).forEach((p) => { if (d.members.some((m) => m.pid === p)) applyIdx(d.day, p, fresh[p]); }); demoteSelfTyped(d, now); d.u = now; return d; }); }

// ---------- routes ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/golf/')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), ip = D.ip(req), now = D.now(), op = path.slice(6);
    if (op === 'preview') { // PUBLIC: title + kind only, for the ?join=golf.<code> link before sign-in
      if (fails('i|' + ip) >= 10) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); if (limit('pv|' + ip, 60, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      const c = await byCode(b.code, 'i|' + ip); send(res, 200, { title: c.title, kind: c.kind }); return true;
    }
    if (op === 'ent') { // OWNER ONLY (owner-PIN token, or owner phone + x-dash): enterprise flag and course links for an account. No player sees this.
      if (!D.ownerOk(req)) throw bad(401, 'Owner only'); const acc = String(b.account || '').trim().slice(0, 120); if (!acc) throw bad(400, 'Which account?'); const a = String(b.op || 'get');
      if (a === 'link' || a === 'unlink') { const r = await D.S.dbGet(CRS); if (a === 'link' && !(r && r.data && r.data.courses && r.data.courses[String(b.courseId)])) throw bad(404, 'Course not found'); }
      if (a !== 'get') await mutateRow(ENT, () => ({ keys: {}, courses: {} }), (d) => { d.keys = d.keys || {}; d.courses = d.courses || {}; const cid = String(b.courseId || '');
        if (a === 'enterprise') { if (b.on) d.keys[acc] = true; else delete d.keys[acc]; }
        else if (a === 'link') { const l = d.courses[acc] || []; if (!l.includes(cid)) d.courses[acc] = l.concat(cid).slice(-50); }
        else if (a === 'unlink') { d.courses[acc] = (d.courses[acc] || []).filter((x) => x !== cid); if (!d.courses[acc].length) delete d.courses[acc]; }
        else throw bad(400, 'Unknown change'); return {}; });
      ENTC.at = 0; const e = await entRow(); send(res, 200, { enterprise: !!(e.keys || {})[acc], courses: await coursesOwnedBy(acc) }); return true;
    }
    const u = await me(req);
    if (op === 'events') { rate('read', u.mk, ip); const t = F.TOURS[b.tour] ? b.tour : 'pga'; let ev = []; try { ev = await D.feed.events(t); } catch (e) { throw bad(503, 'Could not read the ' + F.TOURS[t] + ' schedule. Try again in a minute.'); } send(res, 200, { tour: t, tours: F.TOURS, events: ev.filter((e) => !e.end || e.end > now - 3 * DAY).slice(0, 40) }); return true; }
    if (op === 'board') { rate('read', u.mk, ip); const t = F.TOURS[b.tour] ? b.tour : 'pga'; let bd; try { bd = await D.feed.board(t, b.event ? clean(b.event, 20) : ''); } catch (e) { throw bad(503, 'Could not read the leaderboard. Try again in a minute.'); } send(res, 200, bd); return true; }
    if (op === 'courses') { // saved courses (typed in by users or picked from OpenGolfAPI) + a live OpenGolfAPI search; the API being down only drops the second list
      rate('read', u.mk, ip); const r = await D.S.dbGet(CRS), all = Object.entries((r && r.data && r.data.courses) || {}), q = clean(b.q, 40).toLowerCase();
      const saved = all.filter(([, c]) => !q || (c.name + ' ' + (c.city || '')).toLowerCase().includes(q)).slice(0, 50).map(([id, c]) => ({ id, name: c.name, tees: c.tees, holes: c.holes, par: c.par, hcp: c.hcp, yards: c.yards || null, rating: c.rating ?? null, slope: c.slope ?? null, city: c.city || '', src: c.src || 'user', mine: c.by === u.mk, used: c.used || 0 }));
      // COURSE SEARCH (ported from the preview fix, Nov 16 2026): one page of the live list (25; `offset` = "Show more" in the same list), courses near a
      // typed city, and when the course service cannot be reached: a clear message plus the bundled sample courses (never a silent drop to "type it in").
      let api = { ok: false, results: [] }; if (q.length >= 2 || b.state || b.near) api = typeof D.courses.searchSafe === 'function' ? await D.courses.searchSafe(clean(b.q, 60), clean(b.state, 4), clean(b.near, 40), b.offset)
        : await (async () => { try { return { ok: true, results: await D.courses.search(q, clean(b.state, 4), clean(b.near, 40)), attribution: CO.ATTR }; } catch (e) { return { ok: false, down: true, results: [], error: "Couldn't reach the course list. Try again." }; } })();
      let owned = []; try { owned = await coursesOwnedBy(u.e); } catch (e) {} // a golf course / club account sees its own course(s) first
      send(res, 200, { courses: saved, owned, api, my: await myCoursesU(u) }); return true; }
    if (op === 'mycourse') { // MY COURSES (round 4): the courses this account used last and its home course, kept on the server by course id, so a course is not searched for twice
      rate('write', u.mk, ip); const a = String(b.op || 'use'); let id = b.courseId ? String(b.courseId) : null;
      if (a === 'use' && !id) { const cc = cleanCourse(b.course), sv = await saveCourse(cc, cc.src === 'opengolfapi' ? 'ogapi' : u.mk, true); id = sv && sv.id; }
      if (!id) throw bad(400, 'Which course?'); const r = await D.S.dbGet(CRS); if (!(r && r.data && r.data.courses && r.data.courses[id])) throw bad(404, 'Course not found');
      if (!(await myCourseSet(u, a, id, b))) await mutateRow(MYC, () => ({ by: {} }), (d) => { d.by = d.by || {}; const x = d.by[u.mk] = d.by[u.mk] || { home: null, recent: [] };
        if (a === 'use') x.recent = [id].concat((x.recent || []).filter((y) => y !== id)).slice(0, 8); else if (a === 'home') x.home = b.on === false ? null : id; else if (a === 'forget') { x.recent = (x.recent || []).filter((y) => y !== id); if (x.home === id) x.home = null; } else throw bad(400, 'Unknown change'); return {}; });
      send(res, 200, { id, my: await myCoursesU(u) }); return true; }
    if (op === 'coursedetail') { rate('read', u.mk, ip); let c; try { c = await D.courses.detail(String(b.extId || '')); } catch (e) { throw bad(503, "Couldn't reach the course list. Try again."); } send(res, 200, { course: c }); return true; }
    if (op === 'course') { rate('write', u.mk, ip); const c = cleanCourse(b.course); const out = await saveCourse(c, u.mk, false); send(res, 200, out || {}); return true; }
    if (op === 'mine') { rate('read', u.mk, ip); const r = await D.S.dbGet(IDX), ids = ((r && r.data && r.data.mine) || {})[u.mk] || [], out = []; for (const id of ids.slice(-30).reverse()) { try { const c = await getC(id), m = memberOf(c, u.mk) || roOf(c, u.mk); if (m) out.push(Object.assign(pub(c), { role: isOrg(c, u.mk) ? 'org' : m.ro ? 'ro' : 'member', unseen: unseenOf(c, m) })); /* X2: a removed player keeps the game in his list (read-only seat) */ } catch (e) {} } send(res, 200, { games: out }); return true; }
    if (op === 'create') { const c = await create(u, b, ip); send(res, 200, Object.assign({ game: await full(c, u) }, c.attachError ? { attachError: c.attachError } : {})); return true; }
    if (op === 'look' || op === 'join') { // signed-in look-up by code (rules, entry/take, main/side, open team slots) and join
      if (fails('a|' + u.mk) >= 10 || fails('i|' + ip) >= 10) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); rate('code', u.mk, ip);
      let c; try { c = await byCode(b.code, 'a|' + u.mk); } catch (e) { fail('i|' + ip); throw e; }
      if (op === 'look') { send(res, 200, { game: memberOf(c, u.mk) ? await full(c, u) : Object.assign(pub(c), { role: 'none', back: !!anyMember(c, u.mk) }) }); return true; }
      const { g, asked, late } = await joinC(c, u, b, now);
      await addMine(u.mk, c.id); send(res, late && late.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, asked ? { hcpAsked: true } : {}, powerAns(late))); return true;
    }
    if (op === 'gjoin') { // JOIN FROM THE GROUP (integration, Nov 16 2026; like /calcutta/gjoin): a golf game attached to a group is opened and joined by any member
      // of THAT group, by the game's id (the group screen has it). { preview: true } = look first. Not in the group = 403; the people cap still applies.
      rate('code', u.mk, ip); const c = await getC(b.id).catch(() => null); if (!c || !c.groupId) throw bad(404, 'Golf game not found'); const GR = D.groups();
      if (!memberOf(c, u.mk)) { let ok = null; try { ok = GR && typeof GR.memberCheck === 'function' ? await GR.memberCheck(c.groupId, u.e) : null; } catch (e) { ok = null; } if (!ok) throw bad(403, 'Join the group first: this golf game is for its members.', { code: 'group' }); }
      if (b.preview) { send(res, 200, { game: memberOf(c, u.mk) ? await full(c, u) : Object.assign(pub(c), { role: 'none', back: !!anyMember(c, u.mk), viaGroup: true }) }); return true; }
      const { g, asked, late } = await joinC(c, u, b, now); await addMine(u.mk, c.id); send(res, late && late.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, asked ? { hcpAsked: true } : {}, powerAns(late))); return true;
    }
    // ----- everything below needs an id and membership -----
    let c = await getC(b.id); const mem = memberOf(c, u.mk), org = isOrg(c, u.mk);
    if (!mem && !(roOf(c, u.mk) && ['get', 'seen', 'object'].includes(op))) throw bad(404, 'Golf game not found');
    await estFill(c); // who is an ESTABLISHED signer (X5), read by the direction rule inside the write
    if (op === 'get') { rate('read', u.mk, ip); if (c.kind === 'pro' && c.pro.game === 'oad') c = await oadSettle(c); if (c.kind === 'pro' && c.pro.game === 'six') c = await sixSettle(c); send(res, 200, { game: await full(c, u), now }); return true; }
    if (op === 'signall') { // "Sign all handicaps": one signer reviews the list and signs every waiting handicap request they can sign, in one action. Each one is still signed, logged and announced by itself.
      rate('write', u.mk, ip); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); let g = c, n = 0, asked = 0; const skipped = [];
      const canOk = (pid) => { if (!dirMode(c, 'hcp')) return isBoss(c, mem); const rq = c.day.hreq[pid], hb = hcpBen(c, { pid, v: rq.v }); return hb.raise ? hcpWho(c, pid, rq.v).includes(mem.pid) : isBoss(c, mem); };
      for (const pid of Object.keys(c.day.hreq || {})) { if (pid === mem.pid || (Array.isArray(b.pids) && !b.pids.includes(pid)) || !canOk(pid)) continue; try { const r = await hcpOkRoute(g, u, pid, true, now); g = r.g; if (r.okOut && r.okOut.pending) asked++; else n++; } catch (e) { if (!e.status || e.status >= 500) throw e; skipped.push(e.message); } }
      for (const q of (g.pend || []).filter((y) => y.kind === 'hcp' && y.by !== mem.pid && (!Array.isArray(b.ns) || b.ns.includes(y.n)))) { try { const r = await signRoute(g, u, q.n, true); g = r.g; n++; } catch (e) { if (!e.status || e.status >= 500) throw e; if (e.status !== 403) skipped.push(e.message); } }
      if (!n && !asked && !skipped.length) throw bad(409, 'No handicap is waiting for your signature.'); send(res, 200, { game: await full(g, u), signed: n, asked, skipped }); return true; }
    if (op === 'object' || op === 'uphold') { rate('write', u.mk, ip); let out = null; const g = await mutC(c.id, (d) => { const me = memberOf(d, u.mk) || (op === 'object' ? roOf(d, u.mk) : null); if (!me) throw bad(404, 'Golf game not found'); out = op === 'object' ? objectH(d, me, b.h, now) : b.n != null ? overruleQ(d, me, b.n, now) : b.drop ? dropH(d, me, b.h, now) : upholdH(d, me, b.h, now); d.u = now; return d; }); send(res, 200, Object.assign({ game: await full(g, u) }, out || {})); return true; } // TEST 2
    if (op === 'seen') { const g = await mutC(c.id, (d) => { const m = memberOf(d, u.mk) || roOf(d, u.mk), last = ((d.notes || []).slice(-1)[0] || {}).n || 0, lh = d.hn || 0, sa = d.kind === 'day' && stakes(d) ? settleAt(d) : 0, st = sa && D.now() >= sa && (m || {}).stSeen !== sa; if (!m) throw bad(404, 'Golf game not found'); if ((m.seen || 0) >= last && (m.hseen || 0) >= lh && !st) return { nochange: true, v: d }; m.seen = last; m.hseen = lh; if (st) m.stSeen = sa; /* fix 4: the "Payout settled" notice */ return d; }); send(res, 200, { game: await full(g, u) }); return true; }
    if (op === 'leave') { await mutC(c.id, (d) => { if (isOrg(d, u.mk)) throw bad(409, 'The organizer cannot leave'); const m = memberOf(d, u.mk); if (!m) throw bad(404, 'Golf game not found'); const p = m.pid; if (d.kind === 'day' && d.day.status !== 'setup' && (teamsOfP(d, p).length || interested(d, p))) throw bad(409, 'The round has started'); /* M2: someone who is on no team and keeps no card can always leave */
        if (d.kind === 'pro') { const O = d.pro.oad, has = !!(d.pro.entries[p] && d.pro.entries[p].picks && d.pro.entries[p].picks.length) || Object.values(O.events).some((E) => E.picks[p]) || (O.used[p] || []).length > 0;
          // G16 (review fix): once a pick exists in group play the entry is tied to the account. Leaving takes the game off the player's list; the picks
          // stay in the pool, locked, the golfers used stay used, and rejoining restores the same entry.
          if (has) { m.left = now; d.u = now; return {}; }
          if (d.pro.game === 'six' && d.pro.lockAt && now >= d.pro.lockAt) throw bad(409, 'Picks are closed'); }
        d.members = d.members.filter((x) => x.mk !== u.mk); d.co = (d.co || []).filter((x) => x !== p); if (d.day) { d.day.teams.forEach((t) => { t.players = t.players.filter((x) => x !== p); if (t.scorer === p) t.scorer = t.players[0] || null; }); ['hcp', 'hsrc', 'hby', 'hreq', 'odx', 'tset'].forEach((k) => { if (d.day[k]) delete d.day[k][p]; }); } if (d.pro) delete d.pro.entries[p]; d.u = now; return {}; }); send(res, 200, { ok: true }); return true; }
    if (op === 'paid') { // The paid list. Before the start the organizer keeps it; after the start every change goes through THE NEUTRAL RULE (logged, announced);
      // a Final golf day is closed (reopen first), and in a Final pool nobody can be marked NOT paid any more (M1, M2).
      if (!org) throw bad(403, 'Only the organizer marks entries paid'); const p = { pid: String(b.pid), paid: !!b.paid, reason: clean(b.reason, 120), started: false, done: false };
      if (c.kind === 'pro') { if (c.pro.game === 'six') { const bd = await boardOf(c); p.done = !!c.pro.doneAt || (bd ? !!bd.event.done : !!(c.pro.lockAt && now >= c.pro.lockAt + 5 * DAY)); p.started = p.done || isLocked(lockAt(c, bd), bd, now); }
        else { p.done = !!c.pro.oad.ended || chiDay(now) > String(c.pro.oad.season).slice(0, 4) + '-12-31'; p.started = p.done || Object.values(c.pro.oad.events).some((E) => E.lockAt && now >= E.lockAt); } }
      const m0 = c.members.find((x) => x.pid === p.pid); if (!m0) throw bad(404, 'Not a member'); if (!!m0.paid === p.paid) { send(res, 200, { game: await full(c, u) }); return true; }
      const { g, out } = await power(c, u, 'paid', p); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; }
    if (op === 'short9') { rate('write', u.mk, ip); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); const { g, out } = await power(c, u, 'short9', {}); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; } // M3: rain
    if (op === 'sign') { rate('write', u.mk, ip); const r = await signRoute(c, u, b.n, b.ok !== false); send(res, 200, Object.assign({ game: await full(r.g, u) }, r.out)); return true; } // THE NEUTRAL RULE: the second signature (or `ok: false` to turn it down / take it back)
    if (op === 'attach') { rate('write', u.mk, ip); const g = await attachTo(c, u, clean(b.groupId, 20), b.pot); send(res, 200, { game: await full(g, u) }); return true; }
    if (c.kind === 'pro') {
      rate('write', u.mk, ip);
      if (op === 'tiers') { // organizer: rebuild the six tiers from a ranking list (before anyone picks; "someone already picked" is checked INSIDE the write, L1)
        if (!org) throw bad(403, 'Only the organizer sets the tiers'); const bd = await boardOf(c); if (!bd || bd.golfers.length < 12) throw bad(503, 'The field is not posted yet');
        if (isLocked(lockAt(c, bd), bd, now)) throw bad(409, 'Picks are closed');
        const rank = (Array.isArray(b.rank) ? b.rank : String(b.rank || '').split(/\n/)).map((x) => clean(x, 50)).filter(Boolean).slice(0, 200), tiers = buildTiers(bd, rank), was = c.pro.tiers || [];
        const p = { rank, tiers, basis: tierBasis(bd, rank), moved: tiers ? tiers.reduce((a, tier, i) => a + tier.filter((id) => !(was[i] || []).includes(id)).length, 0) : 0 };
        const { g, out } = await power(c, u, 'tiers', p); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true;
      }
      if (op === 'pick' && c.ent && org) throw bad(409, DIR_PLAY, { director: true }); // fix 2: no pool entry for the director
      if (op === 'pick' && c.pro.game === 'six') {
        const bd = await boardOf(c); if (!bd) throw bad(503, 'Could not read the leaderboard to check whether picks are closed. Try again in a minute.'); // fail closed
        const la = lockAt(c, bd); if (!la || isLocked(la, bd, now)) throw bad(409, 'Picks closed at the first tee time');
        const tiers = c.pro.tiers || (bd.golfers.length >= 12 ? buildTiers(bd, c.pro.rank) : null); if (!tiers) throw bad(409, 'The field is not posted yet');
        const picks = (Array.isArray(b.picks) ? b.picks : []).map(String); if (picks.length !== 6) throw bad(400, 'Pick one golfer from each of the six tiers');
        picks.forEach((id, i) => { if (!tiers[i].includes(id)) throw bad(400, 'Tier ' + (i + 1) + ': that golfer is not in this tier'); });
        const guess = c.pro.tb === 'score' ? num(b.guess, -40, 40) : null; if (c.pro.tb === 'score' && (guess == null || !Number.isInteger(guess))) throw bad(400, 'Tiebreaker: guess the winning score to par (e.g. -15)');
        const g = await mutC(c.id, (d) => { const had = d.pro.entries[mem.pid]; if (had && had.picks && had.picks.length === 6 && g16(d)) throw bad(409, G16MSG); if (d.pro.tiers) picks.forEach((id, i) => { if (!d.pro.tiers[i].includes(id)) throw bad(409, 'The tiers changed while you were picking. Check your picks and save again.', { tiers: true }); });
          if (!d.pro.tiers) d.pro.tiers = tiers; d.pro.lockAt = minT(d.pro.lockAt, la); d.pro.entries[mem.pid] = { picks, guess, swap: null, at: now, locked: g16(d) }; if ((d.pend || []).length) sweep(d, now); /* L3: a waiting tier change no longer fits once someone has picked */ d.u = now; return d; }); await recPlays(g, 'golf-six', [mem.pid]); send(res, 200, { game: await full(g, u) }); return true;
      }
      if (op === 'swap' && c.pro.game === 'six') { // ONE replacement for a golfer who withdrew before teeing off
        const bd = await boardOf(c); if (!bd) throw bad(503, 'Could not read the leaderboard. Try again in a minute.'); const fm = fieldMap(bd), e = c.pro.entries[mem.pid];
        if (!e || !e.picks) throw bad(404, 'No picks to swap'); if (e.swap) throw bad(409, 'You already used your one swap');
        const i = e.picks.indexOf(String(b.from)), f = fm[String(b.from)], t = fm[String(b.to)]; if (i < 0 || !f) throw bad(400, 'Pick the golfer to replace');
        if (!(f.st === 'wd' && !f.started)) throw bad(409, 'Swaps are only for a golfer who withdrew before teeing off');
        if (!t || !c.pro.tiers[i].includes(t.id) || t.st !== 'active' || t.started || e.picks.includes(t.id)) throw bad(400, 'The new golfer must be from the same tier and not have teed off yet');
        // WHEN (review fix): only before the replacement's own tee time. A feed with no tee times (the ESPN scoreboard) cannot show who has teed off, so
        // there the swap is only allowed before round 1 starts. Anything else is refused: no picking a replacement once scores are coming in.
        const hasTee = Number.isFinite(t.tee) && t.tee > 0, la = lockAt(c, bd);
        if (hasTee) { if (now >= t.tee) throw bad(409, t.name + ' has already teed off. A swap is only allowed before the new golfer\'s tee time.'); }
        else if (begun(bd) || !la || now >= la) throw bad(409, 'Round 1 has started and the tour feed has no tee times, so a swap can no longer be checked. Swaps are only allowed before round 1 starts.');
        const g = await mutC(c.id, (d) => { const x = d.pro.entries[mem.pid]; if (!x || !x.picks) throw bad(404, 'No picks to swap'); if (x.swap) throw bad(409, 'You already used your one swap'); if (x.picks[i] !== f.id || x.picks.includes(t.id)) throw bad(409, 'Your picks changed. Check them and try again.');
          x.picks[i] = t.id; x.swap = { from: f.id, to: t.id, fromN: f.name, toN: t.name, at: now }; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true; // shown to the whole pool with the time (view: swaps)
      }
      if (op === 'oadmoney' && c.pro.game === 'oad') { // Playbook: the organizer can enter the real prize money for a finished tournament instead of Oddable points
        if (!org) throw bad(403, 'Only the organizer enters prize money'); const ev = clean(b.event, 20), E0 = c.pro.oad.events[ev]; if (!E0) throw bad(404, 'No picks for that tournament'); if (!(E0.lockAt && now >= E0.lockAt)) throw bad(409, 'That tournament has not started');
        const ids = [...new Set(Object.values(E0.picks).map((p) => p.g))], money = {}; for (const id of ids) { const v = num((b.money || {})[id], 0, 1e8); if (v == null) throw bad(400, 'Prize money for every golfer picked (0 if they missed the cut)'); money[id] = Math.round(v * 100) / 100; }
        const { g, out } = await power(c, u, 'oadmoney', { ev, money }); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; } // H2: THE NEUTRAL RULE
      if (op === 'endseason' && c.pro.game === 'oad') { if (!org) throw bad(403, 'Only the organizer ends the season'); if (c.pro.oad.ended) { send(res, 200, { game: await full(c, u) }); return true; } const { g, out } = await power(c, u, 'endseason', {}); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; }
      if (op === 'oadrefresh' && c.pro.game === 'oad') { // H6: read a stored result again (48 hours), through THE NEUTRAL RULE
        if (!org) throw bad(403, 'Only the organizer refreshes a result'); const ev = clean(b.event, 20), E0 = c.pro.oad.events[ev]; if (!E0 || !E0.res) throw bad(409, 'That tournament has no stored result yet.'); let bd = null; try { bd = await D.feed.board(c.pro.tour, ev); } catch (e) {}
        if (!bd || !bd.event.done || !bd.golfers.length) throw bad(503, 'Could not read a final leaderboard for that tournament. Try again in a minute.'); const r = oadRes(bd);
        const { g, out } = await power(c, u, 'oadrefresh', { ev, res: r.res, by: r.by }); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; }
      if (op === 'pick' && c.pro.game === 'oad') {
        const ev = clean(b.event, 20); let bd = null; try { bd = await D.feed.board(c.pro.tour, ev); } catch (e) {} if (!bd) throw bad(503, 'Could not read that tournament. Try again in a minute.');
        const E0 = c.pro.oad.events[ev], la = minT(E0 && E0.lockAt, feedLock(bd)); if (!la || isLocked(la, bd, now)) throw bad(409, 'Picks for this tournament closed at its first tee time');
        const gf = bd.golfers.find((x) => x.id === String(b.golfer)); if (!gf || gf.st !== 'active') throw bad(400, 'Pick a golfer in the field');
        const g = await mutC(c.id, (d) => { const O = d.pro.oad, E = O.events[ev] = O.events[ev] || { name: bd.event.name, lockAt: la, picks: {} }; E.lockAt = minT(E.lockAt, la);
          if (E.picks[mem.pid] && g16(d)) throw bad(409, G16MSG);
          const used = (O.used[mem.pid] || []).filter((x) => !(E.picks[mem.pid] && E.picks[mem.pid].g === x)); if (used.includes(gf.id)) throw bad(409, 'You already used ' + gf.name + ' this season. One and done: never the same golfer twice.');
          E.picks[mem.pid] = { g: gf.id, n: gf.name, at: now }; O.used[mem.pid] = used.concat(gf.id); d.u = now; return d; });
        await recPlays(g, 'golf-oad', [mem.pid], c.id + ':' + ev); send(res, 200, { game: await full(g, u) }); return true;
      }
      throw bad(404, 'not found');
    }
    // ----- golf day -----
    const d0 = c.day;
    if (op === 'setup') { // organizer, before the round starts: format, net, allowances, extras, heads-up options, flights
      if (!org) throw bad(403, 'Only the organizer changes the setup'); if (d0.status !== 'setup') throw bad(409, 'The round has started; setup is closed');
      const x = cleanDay(Object.assign({}, pub(c).day, b.day || {}), d0), was = casualOf(c), course = b.course ? cleanCourse(b.course) : null;
      // THE NEUTRAL RULE: a change to the format, the strokes, the flights, the side games or which board the money follows is a rule of the game
      const touch = ruleDiff(d0, x, course); // M4: every changed rule with its old and new value (also the match settings and the course)
      const c2 = clone(c); Object.assign(c2.day, x); let { g, out } = await power(c, u, 'setup', { x, course, touch, stk: stakes(c2) });
      if (out.done && c.ent && g.day.lockAt && g.day.lockAt !== d0.lockAt) { try { await D.eventSetup(c.orgE, EID(c.id), { title: c.title, sport: 'golf', lockAt: g.day.lockAt }); } catch (e) {} }
      if (out.done && casualOf(g) !== was) g = await reIdx(g); // money or flights were switched on or off: the number to play off changes (confirmed index <-> full index), so ask stats again
      send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true;
    }
    if (op === 'makeup') { // the organizer's approval screen: one player's number, round by round, straight from the stats module (the organizer, a co-organizer, or the player's own)
      rate('read', u.mk, ip); const pm = c.members.find((m) => m.pid === String(b.pid)); if (!pm) throw bad(404, 'Not a member'); if (!isBoss(c, mem) && pm.pid !== mem.pid) throw bad(403, 'Only the organizer sees what another player\'s number is made of');
      const h = keyOfMember(pm) ? await hcpOf(keyOfMember(pm), hOpts(c)) : NOH; send(res, 200, { pid: pm.pid, name: pm.name, guest: !!pm.guest, hi: hinfo(d0, pm.pid), strict: hStrict(c), why: h.why || '', ask: h.ask || '', makeup: mkFull(h.makeup) }); return true; }
    if (op === 'suggest') { // P1 "Suggest partners": ranked suggestions with a one-line reason. It ONLY suggests: nothing is saved, the organizer chooses.
      rate('read', u.mk, ip); if (!org) throw bad(403, 'Only the organizer builds the teams'); const size = Math.max(2, Math.min(4, num(b.teamSize, 2, 4) || Math.max(2, d0.teamSize)));
      if (S.FORMATS[d0.fmt].size[1] < 2 && !b.teamSize) throw bad(409, 'This format has no partners');
      const mode = ['balanced', 'rotate', 'hot'].includes(b.mode) ? b.mode : 'balanced', n = d0.course.par.length;
      const players = c.members.map((m) => ({ id: m.pid, name: m.name, hcp: S.playHcp(chOf(d0, m.pid), 100, n) }));
      const history = mode === 'balanced' ? [] : await pairHistory(c);
      const list = D.pairing().suggestPartners(players, { mode, teamSize: size, history });
      send(res, 200, { mode, teamSize: size, modes: [['balanced', 'Balanced'], ['rotate', 'Rotate'], ['hot', 'Hot pairs']], suggestions: list.map((x) => ({ reason: x.reason, hcps: x.hcps, teams: x.teams.map((t) => t.map((pid) => ({ pid, name: (c.members.find((m) => m.pid === pid) || {}).name || 'Player', hi: hinfo(d0, pid) }))) })), note: 'Suggestions only. You choose the teams. Handicaps: ' + HCP_LABEL + '. ' + HCP_NOTE, history: history.length }); return true;
    }
    if (op === 'team') { // organizer: add / rename / remove a team, set slots, assign a player, set the scorer, set a handicap
      rate('write', u.mk, ip); const a = String(b.op || ''); let guest = null, okOut = null; const maxP = a === 'guest' ? await limits.maxPeople(c.orgE, c.id) : 0;
      if (a === 'kick') { const p = b.tid ? { tid: String(b.tid), reason: clean(b.reason, 120) } : { pid: String(b.pid), reason: clean(b.reason, 120) }; const { g, out } = await power(c, u, 'remove', p); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; } // H7 / M2
      if (a === 'withdraw') { const { g, out } = await power(c, u, 'withdraw', { tid: String(b.tid), on: b.on === false ? false : true, reason: clean(b.reason, 120) }); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; }
      if (a === 'hcp') { // H1 + E-H + H5: the Oddable Handicap Index is the handicap. Where handicaps are STRICT (Enterprise, flights, net money) nobody sets their own
        // number: it is only asked for. The organizer / director sets numbers through THE NEUTRAL RULE (a director also gives a reason; stats logs it).
        const pid = String(b.pid), pm = c.members.find((m) => m.pid === pid); if (!pm) throw bad(404, 'Not a member'); const h = num(b.hcp, -10, 54); if (h == null) throw bad(400, 'Handicap -10 to 54');
        if (hLocked(d0, now)) throw bad(409, 'Handicaps are closed: the ' + (c.ent ? 'tournament' : 'round') + ' has started'); const v = Math.round(h * 10) / 10, self = pid === mem.pid, strict = hStrict(c), src = (d0.hsrc || {})[pid];
        if (!c.ent && !self && dirMode(c, 'hcp') && (d0.hreq || {})[pid] && d0.hreq[pid].v === v) { const { g } = await hcpOkRoute(c, u, pid, true, now); send(res, 200, { game: await full(g, u) }); return true; } // typing the number the player asked for = OK-ing it (same test)
        if (c.ent ? org : isBoss(c, mem) && !(self && strict)) { if (!c.ent && self && !strict) { /* falls through: a casual game, own number */ } else { const { g, out } = await power(c, u, 'hcp', Object.assign({ pid, v, reason: clean(b.reason, 80) }, !self && (d0.hreq || {})[pid] && d0.hreq[pid].v === v ? { ask: true } : {})); /* the very number the player asked for = the player already agreed */ send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; } }
        if (!self) throw bad(403, c.ent ? 'The tournament director sets handicaps' : 'Only the organizer sets other players\' handicaps');
        if (src === 'oddable' || src === 'tournament') throw bad(409, src === 'oddable' ? 'This player has an ' + HCP_LABEL + ' from their rounds in the app; it is the handicap. ' + HCP_NOTE : 'The tournament director set this handicap.');
        const g = await mutC(c.id, (d) => { const D2 = d.day, me = memberOf(d, u.mk); if (!me) throw bad(404, 'Golf game not found'); if (hLocked(D2, now)) throw bad(409, 'Handicaps are closed: the ' + (d.ent ? 'tournament' : 'round') + ' has started');
          if (hStrict(d)) ownAsk(d, me, v, now); else { const old = D2.hcp[pid] == null ? null : D2.hcp[pid]; setTyped(D2, pid, v, me, now); audit(D2, { at: now, by: me.name, what: 'handicap', pid, from: old, to: v }); } d.u = now; return d; });
        const asked = !!((g.day.hreq || {})[pid]); send(res, asked ? 202 : 200, Object.assign({ game: await full(g, u) }, asked ? { pending: true, note: 'Asked. Your handicap counts once ' + (c.ent ? 'the tournament director sets it' : org ? 'a player who is not on your team OKs it' : 'the organizer sets it') + '. Nobody sets their own number in this game.' } : {})); return true; }
      if (a === 'hcpobject') { // item 6: a player objects to the number the tournament director set, before the start. Logged and shown to the director, who decides.
        if (!c.ent) throw bad(409, 'Only in a tournament: in other games a number is signed by the rule.'); const pid = String(b.pid || mem.pid), note = why3(b.note, 'Say what is wrong with the number (3+ characters)');
        const g = await mutC(c.id, (d) => { const D2 = d.day, me = memberOf(d, u.mk), pm = d.members.find((m) => m.pid === pid); if (!me || !pm) throw bad(404, 'Not a member'); if (hLocked(D2, now)) throw bad(409, 'Handicaps are closed: the tournament has started'); if (!speaksFor(d, me, 'p:' + pid)) throw bad(403, 'You can object to your own number, or to a typed-in guest\'s on your team.');
          D2.hobj = D2.hobj || {}; D2.hobj[pid] = (D2.hobj[pid] || []).concat({ at: now, by: me.name, note, v: D2.hcp[pid] == null ? null : D2.hcp[pid] }).slice(-5); audit(D2, { at: now, by: me.name, what: 'handicap objection', pid, note }); notify(d, 'hcp', me, me.name + ' objects to ' + pm.name + '\'s tournament handicap: ' + note + '. The director decides.'); d.u = now; return d; });
        send(res, 200, { game: await full(g, u) }); return true; }
      if (a === 'hcpok') { // OK (or turn down) a number a player asked for
        const pid = String(b.pid), q = (c.pend || []).find((y) => y.kind === 'hcp' && y.p.pid === pid); if (q) { const r = await signRoute(c, u, q.n, b.on !== false); send(res, 200, Object.assign({ game: await full(r.g, u) }, r.out)); return true; }
        const { g, okOut } = await hcpOkRoute(c, u, pid, b.on !== false, now); send(res, okOut && okOut.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(okOut))); return true; }
            if (a === 'guest') guest = { gid: rnd(10).toLowerCase(), token: crypto.randomBytes(16).toString('hex') }; // lower case: the stats / Calcutta guest key form 'g:<guest id>' // claim token shown once to the organizer; only its hash is stored
      const g = await mutC(c.id, (d) => { const D2 = d.day; const T = (id) => { const t = D2.teams.find((x) => x.tid === String(id)); if (!t) throw bad(404, 'No such team'); return t; };
        if (a === 'co') { // the organizer names (or removes) a co-organizer: someone who can settle disputes and confirm cards on teams they are not part of
          if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer names a co-organizer'); if (D2.status === 'final') throw bad(409, 'The round is final'); const p = String(b.pid), pm = d.members.find((m) => m.pid === p); if (!pm || pm.guest || pm.mk === d.org) throw bad(400, 'Pick a player with an Oddable account');
          const on = b.on !== false, has = (d.co || []).includes(p); if (on === has) return { nochange: true, v: d };
          // M5: not while a request of theirs, or one they could sign, is waiting (making or unmaking a co-organizer changes who may sign); logged and announced
          const d2 = Object.assign({}, d, { co: on ? (d.co || []).concat(p) : (d.co || []).filter((x) => x !== p) }); // the game as it would be after the change
          const busy = (d.pend || []).some((q) => { if (q.by === p) return true; try { const actor = d.members.find((x) => x.pid === q.by); return !!actor && (signers(d, q.by, ACT[q.kind].sig(d, actor, q.p)).includes(p) || signers(d2, q.by, ACT[q.kind].sig(d2, actor, q.p)).includes(p)); } catch (e) { return false; } });
          if (busy) throw bad(409, pm.name + ' has a request waiting, or could sign one that is waiting. Answer or take back those requests first; then the co-organizer can be changed.', { pending: true });
          d.co = (d.co || []).filter((x) => x !== p); if (on) d.co.push(p); const me = memberOf(d, u.mk), text = (on ? 'name ' + pm.name + ' co-organizer' : 'remove ' + pm.name + ' as co-organizer');
          audit(D2, { at: now, by: mem.name, what: on ? 'co-organizer named' : 'co-organizer removed', pid: p, note: pm.name }); plog(d, { at: now, st: 'alone', kind: 'co', text, by: mem.name }); notify(d, 'act', me, mem.name + ': ' + text + '.'); d.u = now; return d; }
        if (a === 'scorer') { const t = T(b.tid); if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer picks scorers'); if (D2.status === 'final') throw bad(409, 'The round is final'); if (!t.players.includes(String(b.pid))) throw bad(400, 'The scorer must be on the team'); if (t.scorer === String(b.pid)) return { nochange: true, v: d }; t.scorer = String(b.pid);
          if (D2.status !== 'setup') { const me = memberOf(d, u.mk), text = 'make ' + mName(d, t.scorer) + ' the scorer of ' + t.name; audit(D2, { at: now, by: mem.name, tid: t.tid, what: 'scorer changed', note: mName(d, t.scorer) }); plog(d, { at: now, st: 'alone', kind: 'scorer', text, by: mem.name }); notify(d, 'act', me, mem.name + ': ' + text + '.'); } d.u = now; return d; }
        if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer changes teams'); if (D2.status !== 'setup') throw bad(409, 'Teams are set: the round has started');
        if (a === 'guest') { // a player typed in by name, without an Oddable account (claimable later through the stats module's claim flow)
          if (d.members.length >= maxP) throw bad(409, 'Up to ' + maxP + ' golfers. ' + PRICE); const nm = clean(b.name, 24); if (nm.length < 2) throw bad(400, 'Guest name (2+ characters)');
          const m = { pid: newPid(d), mk: null, guest: true, gid: guest.gid, tok: crypto.createHash('sha256').update(guest.token).digest('hex'), name: nm, joined: now, paid: false }; d.members.push(m); applyIdx(D2, m.pid, NOH);
          if (b.tid) { const t = T(b.tid); if (t.players.length >= t.slots) throw bad(409, 'That team is full'); t.players.push(m.pid); if (!t.scorer) t.scorer = d.members.find((x) => x.mk === d.org).pid; }
          { const gh = num(b.hcp, -10, 54), me = memberOf(d, u.mk); if (gh != null && !d.ent) { try { okOut = propose(d, me, 'hcp', { pid: m.pid, v: Math.round(gh * 10) / 10, reason: '' }, now); } catch (e) { if (!(e.extra && e.extra.noSigner)) throw e; } } } // a guest has no Oddable index: the organizer sets the number (THE NEUTRAL RULE when the organizer plays)
          guest.pid = m.pid; d.u = now; return d; }
        if (a === 'add') { if (D2.teams.length >= 100) throw bad(409, 'Too many teams'); let n = D2.teams.length + 1; while (D2.teams.some((x) => x.tid === 'T' + n)) n++; D2.teams.push({ tid: 'T' + n, name: clean(b.name, 24) || 'Team ' + n, slots: Math.max(1, Math.min(4, num(b.slots, 1, 4) || D2.teamSize)), players: [], scorer: null }); }
        else if (a === 'rename') { const t = T(b.tid); t.name = clean(b.name, 24) || t.name; if (b.slots != null) t.slots = Math.max(t.players.length, Math.min(4, num(b.slots, 1, 4) || t.slots)); }
        else if (a === 'remove') { const t = T(b.tid); D2.teams = D2.teams.filter((x) => x !== t); D2.matches = D2.matches.filter((m) => m.kind !== 'team' || (m.a !== t.tid && m.b !== t.tid)); }
        else if (a === 'assign') { const p = String(b.pid); if (!d.members.some((m) => m.pid === p && !m.left)) throw bad(404, 'Not a member'); if (d.ent && b.tid && d.members.some((m) => m.pid === p && m.mk === d.org)) throw bad(409, DIR_PLAY, { director: true }); D2.teams.forEach((x) => { x.players = x.players.filter((y) => y !== p); if (x.scorer === p) x.scorer = x.players[0] || null; }); if (b.tid) { const t = T(b.tid); if (t.players.length >= t.slots) throw bad(409, 'That team is full'); t.players.push(p); if (!t.scorer) t.scorer = p; } }
        else throw bad(400, 'Unknown team change');
        d.u = now; return d; });
      if (guest) await mutIdx((x) => { x.mine['g:' + guest.gid] = [c.id]; return {}; });
      send(res, 200, Object.assign({ game: await full(g, u) }, guest ? { guest } : {}, okOut && okOut.pending ? { hcpPending: true } : {})); return true;
    }
    if (op === 'match') { // organizer: add / remove / draw heads-up matches (set-up only); the side that is down: press (Nassau); the other side: accept / decline
      rate('write', u.mk, ip); const a = String(b.op || '');
      if (['add', 'remove', 'draw'].includes(a)) { // set-up of matches goes through THE NEUTRAL RULE: a money match is a bet, and the other side signs it. M3: money added here re-checks handicaps.
        const was = casualOf(c), kind = a === 'add' ? 'match' : a === 'remove' ? 'matchdel' : 'draw', p = a === 'add' ? { a: String(b.a), b: String(b.b) } : a === 'remove' ? { mid: String(b.mid) } : {};
        let { g, out } = await power(c, u, kind, p); if (out.done && g.day.status === 'setup' && casualOf(g) !== was) g = await reIdx(g); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; }
      const g = await mutC(c.id, (d) => { const D2 = d.day, boss = isOrg(d, u.mk) || isCo(d, mem);
        // who is on a side of the match: its players and the scorer(s) of their team(s)
        const sideT = (m, s) => (m.kind === 'team' ? D2.teams.filter((t) => t.tid === m[s]) : D2.teams.filter((t) => t.players.includes(m[s])));
        const onSide = (m, s) => (m.kind === 'team' ? sideT(m, s).some((t) => teamSide(t, mem.pid)) : m[s] === mem.pid || sideT(m, s).some((t) => t.scorer === mem.pid));
        const scores = (m, s) => (m.kind === 'player' && m[s] === mem.pid) || sideT(m, s).some((t) => t.scorer === mem.pid);
        if (a === 'press' || a === 'accept' || a === 'decline') { if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final' : 'The round has not started'); } // checked INSIDE the write
        if (a === 'press') { const m = D2.matches.find((x) => x.mid === String(b.mid)); if (!m || m.type !== 'nassau') throw bad(404, 'No such Nassau');
          const inA = onSide(m, 'a'), inB = onSide(m, 'b'), neutral = boss && !inA && !inB; if (!neutral && !scores(m, 'a') && !scores(m, 'b') && !(isOrg(d, u.mk) && (inA || inB))) throw bad(403, 'Only a scorer in this match or the organizer adds a press');
          const from = num(b.from, 1, 18), nine = from <= 9 ? 'front' : 'back'; if (!Number.isInteger(from)) throw bad(400, 'Press from which hole?'); if (m.press === 'auto2') throw bad(409, 'This Nassau presses by itself when a side goes 2 down. No manual presses.'); if (from === 1 || from === 10) throw bad(400, 'A press from hole ' + from + ' is the same as the ' + (from === 1 ? 'front' : 'back') + ' nine bet. Press from a later hole.'); if ((m.presses || []).length >= 8) throw bad(409, 'Too many presses');
          if ((m.presses || []).some((x) => x.from === from)) throw bad(409, 'There is already a press from hole ' + from);
          // review fix: a press is a new bet from the NEXT hole that has not been played (counted from the holes really played, also after the nine's
          // first bet was closed out), called by the side that is DOWN in that nine's newest bet. Never back-dated, never twice from one hole.
          const ms = matchState(d, m), st = ms.nassau, next = ms.next[nine], bets = [st[nine]].concat(st.presses.filter((x) => x.nine === nine).map((x) => x.m)), newest = bets[bets.length - 1];
          if (next == null) throw bad(409, 'Hole ' + from + ' has been played: the ' + nine + ' nine is finished. No press.');
          if (from < next) throw bad(409, 'Hole ' + from + ' has been played. A press starts on the next hole (' + next + ').'); if (from > next) throw bad(409, 'A press starts on the next hole to be played (' + next + ').');
          if (newest.up === 0) throw bad(409, 'The bet is all square: only the side that is down can press.');
          const down = newest.up < 0 ? 'a' : 'b'; if (!neutral && !(isOrg(d, u.mk) ? onSide(m, down) : scores(m, down))) throw bad(403, 'Only the side that is down can press.');
          // "press must be accepted": it counts once the OTHER side accepts, before that hole is played. Only a commissioner who is NOT in the match
          // (does not play or score on either side) can put a press straight in; the organizer's own press is an offer like anyone else's (review fix).
          const stt = 'offered'; m.presses = (m.presses || []).concat({ nine, from, by: mem.name, bp: mem.pid, at: now, st: stt, side: down }); audit(D2, { at: now, by: mem.name, what: stt === 'offered' ? 'press offered' : 'press', mid: m.mid, hole: from }); d.u = now; return d; }
        if (a === 'accept' || a === 'decline') { const m = D2.matches.find((x) => x.mid === String(b.mid)); if (!m || m.type !== 'nassau') throw bad(404, 'No such Nassau'); const from = num(b.from, 1, 18), p = (m.presses || []).find((x) => x.from === from && x.st === 'offered'); if (!p) throw bad(404, 'No press offered from that hole');
          const other = p.side === 'a' ? 'b' : 'a', neutral = boss && !onSide(m, 'a') && !onSide(m, 'b'), mineO = signers(d, p.bp, { only: matchSides(D2, m)[other] }).includes(mem.pid) && !onSide(m, p.side); // the same signer rule: only the OTHER side of the bet
          if (a === 'accept' && !mineO) throw bad(403, 'Only the other side accepts a press. It is a new bet, so the side that is up has to agree.');
          if (a === 'decline' && !neutral && !mineO && p.bp !== mem.pid) throw bad(403, 'The other side (or an organizer who is not in this match) answers a press.'); // the one who offered it may take it back
          if (a === 'accept') { const next = matchState(d, m).next[p.nine]; if (next == null || from < next) { m.presses = m.presses.filter((x) => x !== p); audit(D2, { at: now, by: mem.name, what: 'press expired', mid: m.mid, hole: from }); d.u = now; return d; } p.st = 'accepted'; p.acc = mem.name; p.accAt = now; }
          else m.presses = m.presses.filter((x) => x !== p);
          audit(D2, { at: now, by: mem.name, what: a === 'accept' ? 'press accepted' : 'press declined', mid: m.mid, hole: from }); d.u = now; return d; }
        throw bad(400, 'Unknown match change'); });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'start' || op === 'final' || op === 'reopen') {
      if (!org) throw bad(403, 'Only the organizer starts or finishes the round');
      const fresh = {}; if (op === 'start' && d0.status === 'setup') { for (const m of c.members) if (keyOfMember(m)) fresh[m.pid] = await hcpOf(keyOfMember(m), hOpts(c)); } // H1: the latest index at the first tee
      let need = null, started = false, out = null, told = null;
      const g = await mutC(c.id, (d) => { const D2 = d.day, me = memberOf(d, u.mk); need = null; started = false; out = null; told = null; if (!me) throw bad(404, 'Golf game not found'); // every status check is INSIDE the write
        if (op === 'start') { if (D2.status !== 'setup') return { nochange: true, v: d }; if (!D2.teams.some((t) => t.players.length)) throw bad(409, 'Put players on teams first');
          if (d.ent && !dirNeutral(d, me)) throw bad(409, 'The tournament cannot start: the director is on a team or holds a Calcutta lot or a pool entry. ' + DIR_PLAY, { notNeutral: true }); // fix 2
          // H3: a MONEY game needs two different accounts playing on different teams (somebody else has to be able to see the app and sign). A guests-only
          // or one-account game is played as a casual game with no money shown: `casual: true` takes every amount off and starts it.
          if (moneyOn(d) && !D2.solo && !twoAccounts(d)) { if (!b.casual) throw bad(409, 'A money game needs at least two players with their own Oddable account, on different teams, so a second person can confirm cards and sign changes. Have another player join with the code, or play it as a casual game with no money shown.', { needTwo: true });
            stripMoney(d); audit(D2, { at: now, by: me.name, what: 'money taken off', note: 'casual game: fewer than two accounts on different teams' }); }
          Object.keys(fresh).forEach((p) => { if (d.members.some((m) => m.pid === p)) applyIdx(D2, p, fresh[p]); }); demoteSelfTyped(d, now); // M3: money or a match added since a number was typed: it is asked for again
          // H5 / M3 / M4: where handicaps are strict (Enterprise, flights, net money) the round does not start until EVERY player has a number: never 0 strokes by default
          if (hStrict(d) && (netOn(D2) || (D2.flights || {}).n)) { const miss = D2.teams.flatMap((t) => t.players).filter((p) => (D2.hsrc[p] || 'none') === 'none'); if (miss.length) { need = miss; d.u = now; return d; } } // the fresh numbers are kept; the start is refused below
          D2.teams.forEach((t) => { if (t.players.length && !t.scorer) t.scorer = t.players[0]; }); D2.status = 'live'; D2.startAt = now; D2.lockAt = minT(D2.lockAt, now); D2.flights = flightPlan(d); d.pend = (d.pend || []).filter((q) => !['hcp', 'setup', 'draw', 'match', 'matchdel'].includes(q.kind)); started = true; /* what was still waiting for a signature at the start is dropped: rules, numbers and bets are set BEFORE play */ audit(D2, { at: now, by: me.name, what: 'start' }); }
        else if (op === 'final') { if (D2.status === 'final') return { nochange: true, v: d }; if (D2.status !== 'live') throw bad(409, 'The round has not started');
          // Playbook: money on the line and holes nobody confirmed -> no Final, unless it is forced with a reason. A forced finish NEVER covers the forcer's own
          // side, and by a playing organizer it is only ASKED FOR: a neutral signs it (THE NEUTRAL RULE). Only exception: nobody else in the game has an account.
          const fb = finalBlock(d, me); if (fb.un.n && fb.money) { const due = expFinish(d) + 2 * 3600e3;
            if (b.force) { out = propose(d, me, 'final', { reason: clean(b.reason, 120) }, now); d.u = now; return d; } // counts the holes as entered: signed under the direction rule, never by a team with unconfirmed holes (N3)
            if (now < due) throw bad(409, fb.msg + ". Have another team's player confirm them. From " + fmtCT(due) + ' (2 hours after the expected finish) the round can be finished with those teams ranked "not confirmed".', { unconfirmed: fb.un.n, side: fb.un.side, own: 0, canForce: true, until: due });
            const fresh = unconfT(d).filter((t) => !(D2.ncN || {})[t]); if (fresh.length) { D2.ncN = D2.ncN || {}; fresh.forEach((t) => (D2.ncN[t] = now)); told = fresh.map((t) => tName(d, t)); notify(d, 'harm', me, told.join(', ') + ': holes on your card were never confirmed. Get another team\'s player to confirm them within 15 minutes, or the round finishes with your team ranked "not confirmed" (no place, no prize money).'); d.u = now; return d; }
            out = propose(d, me, 'ncfinal', {}, now); d.u = now; return d; }
          closeDisputes(d, now); delete D2.forced; D2.status = 'final'; D2.finalAt = now; d.pend = []; audit(D2, { at: now, by: me.name, what: 'final' }); finalTold(d, me, now); }
        else out = propose(d, me, 'reopen', { reason: clean(b.reason, 120) }, now); // REOPEN: only a Final round, only with a reason; a playing organizer's reopen needs a neutral's signature
        d.u = now; return d; });
      if (told) throw bad(409, told.join(', ') + (told.length === 1 ? ' was' : ' were') + ' just told that holes on their card were never confirmed. Try Final again in 15 minutes: teams still not confirmed then rank "not confirmed".', { told });
      if (need) { const nm = nameMap(g); throw bad(409, need.map((p) => nm[p] || 'Player').join(', ') + (need.length === 1 ? ' has' : ' have') + ' no handicap yet. In ' + (g.ent ? 'a tournament' : (g.day.flights || {}).n ? 'a flighted game' : 'a net money game') + ' every player needs a number before the round starts: the ' + (g.ent ? 'tournament director' : 'organizer') + ' sets it.', { needHcp: need }); }
      // M10: tell the stats module the tournament has started, so its log locks with golf's (it refuses a time that is not in the future: one second from now)
      if (started && c.ent) { try { await D.eventSetup(c.orgE, EID(c.id), { title: c.title, sport: 'golf', lockAt: D.now() + 1000 }); } catch (e) { /* already locked there */ } }
      if (started) await recPlays(g, 'golf-day', g.day.teams.flatMap((t) => t.players)); // Enterprise billing: one play per player
      send(res, out && out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true;
    }
    if (op === 'score') { // the team's scorer (or the organizer) enters a hole; offline-safe: eid makes a retry harmless; rev guards against overwriting someone else's newer entry
      rate('score', u.mk, ip); if (d0.status !== 'live') throw bad(409, d0.status === 'setup' ? 'The round has not started' : 'The round is final');
      const { t, ok } = canScore(c, u.mk, String(b.tid)); if (!ok) throw bad(403, "Only this team's scorer can enter its scores"); const { hole, e } = entryOf(c, t, b); const eid = clean(b.eid, 40);
      const out = await mutC(c.id, (d) => { const D2 = d.day; if (eid && D2.eids.includes(eid)) return { nochange: true, v: { dup: true, d } };
        if (D2.status !== 'live') throw bad(409, D2.status === 'setup' ? 'The round has not started' : 'The round is final'); if (!canScore(d, u.mk, t.tid).ok) throw bad(403, "Only this team's scorer can enter its scores"); // checked INSIDE the write
        if ((D2.wd || {})[t.tid]) throw bad(409, 'This team was marked withdrawn (did not finish).');
        const sc = D2.scores[t.tid] = D2.scores[t.tid] || {}, cur = sc[hole];
        if (cur && cur.st === 'confirmed') { // a CONFIRMED hole changes only through THE NEUTRAL RULE (asked for; a neutral or the team's own scorer signs)
          if (same(cur, e)) { if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } return { v: d }; } const pw = propose(d, memberOf(d, u.mk), 'correct', { tid: t.tid, hole, e, rev: cur.rev }, now); if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } d.u = now; return { v: d, pw }; }
        if (cur && cur.st === 'disputed') throw bad(409, 'Hole ' + hole + ' is disputed. It has to be settled first.');
        // stale-write guard: only against SOMEONE ELSE'S newer entry. The same scorer's later correction always wins (two offline corrections of one hole, review fix).
        // H1: someone else's entry is never overwritten blind. The phone always sends the version it showed (`rev`); without it the write is refused.
        if (cur && b.rev == null && !same(cur, e) && cur.bp !== mem.pid) throw bad(409, 'Hole ' + hole + ' was entered by ' + (cur.by || 'someone else') + '. Open the card, check it and enter again.', { current: cur, needRev: true });
        if (cur && b.rev != null && Number(b.rev) !== cur.rev && !same(cur, e) && cur.bp !== mem.pid) throw bad(409, 'Hole ' + hole + ' was changed by ' + (cur.by || 'someone') + '. Check it and enter again.', { current: cur });
        if (cur && same(cur, e)) { if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } return { v: d }; }
        sc[hole] = Object.assign(e, { by: mem.name, bp: mem.pid, at: now, rev: ((cur && cur.rev) || 0) + 1, st: 'entered' }); // any change = a new version that needs a fresh confirm
        audit(D2, { at: now, by: mem.name, tid: t.tid, hole, what: cur ? 'changed' : 'entered', from: cur ? { g: cur.g, p: cur.p } : null, to: { g: e.g, p: e.p, drive: e.drive } });
        if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } d.u = now; return { v: d }; });
      const g = out && out.d ? out.d : out.v || out; send(res, out && out.pw && out.pw.pending ? 202 : 200, Object.assign({ game: await full(g, u), dup: !!(out && out.dup) }, powerAns(out && out.pw))); return true;
    }
    if (op === 'confirm' || op === 'dispute') {
      // TWO PEOPLE, NOT BOTH FROM THE TEAM. A hole the team entered is confirmed by someone who does not play on or score for that team (another team's
      // scorer, the organizer or a co-organizer). A hole typed by an outsider (the organizer keeping a team's card) is confirmed by that team's scorer or by
      // another outsider. Nobody confirms a version they typed. CONFIRM PINS WHAT WAS SEEN (review fix): the phone sends the hole versions it showed
      // (`revs`); without them the versions this server last sent that member are used. A hole that changed since is not confirmed.
      rate('score', u.mk, ip); const tid = String(b.tid); if (!d0.teams.some((x) => x.tid === tid)) throw bad(404, 'No such team');
      const from = num(op === 'dispute' ? b.hole : b.from, 1, 18), to = op === 'dispute' ? from : num(b.to, 1, 18); if (from == null || to == null || to < from) throw bad(400, 'Which holes?');
      // L10: a confirm needs the card to have been OPENED from this server (what it last sent this member), and the versions sent along must match it
      const mine0 = (SEEN.get(c.id + '|' + mem.pid) || {})[tid] || null, seen = !mine0 ? null : b.revs && typeof b.revs === 'object' ? b.revs : mine0, note = clean(b.note, 120);
      const g = await mutC(c.id, (d) => { const D2 = d.day; // INSIDE the write. Item 4: in a money game any team can dispute a confirmed hole until 30 minutes after Final (it then shows as contested)
        if (!(op === 'dispute' && D2.status === 'final' && stakes(d) && (b.off || now - (D2.finalAt || 0) <= OBJ_MS))) liveOnly(D2);
        const t = D2.teams.find((x) => x.tid === tid), me = memberOf(d, u.mk); if (!t || !me) throw bad(404, 'No such team'); const mine = teamSide(t, me.pid);
        const sc = D2.scores[t.tid] || {}, stale = [], own = [], self = [], no = [], ownCf = []; let n = 0;
        for (let h = from; h <= to; h++) { const x = sc[h]; if (!x) continue;
          if (op === 'confirm') { if (x.st !== 'entered') continue; if (x.bp === me.pid) { self.push(h); continue; }
            // A confirm is the SECOND SIGNATURE on what the typer entered (the one signer rule): the team's own entry by someone on no side of the typer; a
            // hole typed by an outsider (the organizer keeping a card) by that team's own people, or by a neutral who is not on the typer's team.
            const typer = d.members.some((m) => m.pid === x.bp) ? x.bp : t.scorer, who = signers(d, typer, t.players.includes(typer) ? {} : { need: acctsOn(d, [t.tid]), nt: [t.tid] }); // H1: an outsider's entry on team X's card is confirmed by X's own account (a neutral third only when X has none)
            // N3: in a money game any ESTABLISHED account playing on ANOTHER team (not the typer's) may confirm it too (a false card is disputed: item 4)
            const xtra = !who.includes(me.pid) && stakes(d) && !mine && t.players.includes(typer) /* only what the team typed itself: an outsider's entry is still the team's own to confirm (H1) */ && teamsOfP(d, me.pid).length > 0 && !teamsOfP(d, me.pid).some((tt) => teamsOfP(d, typer).includes(tt)) && estOk(me);
            if (!who.includes(me.pid) && !xtra) { (mine && teamSide(t, typer) ? own : no).push(h); continue; }
            if (!seen || Number(seen[h]) !== x.rev || (mine0 && Number(mine0[h]) !== x.rev)) { stale.push(h); continue; }
            x.st = 'confirmed'; x.cf = me.name; x.cfPid = me.pid; x.cfAt = now; }
          else if (b.off) { if (x.st !== 'disputed' || x.dfPid !== me.pid) continue; x.st = x.pst || 'entered'; delete x.pst; delete x.note; delete x.df; delete x.dfPid; delete x.want; } // the one who raised a dispute may take it back
          else { if (x.st === 'disputed') continue; if (mine) { own.push(h); continue; }
            if (D2.status === 'final' && x.st === 'confirmed' && x.cfPid && (x.cfPid === me.pid || teamsOfP(d, x.cfPid).some((tt) => teamsOfP(d, me.pid).includes(tt)))) { ownCf.push(h); continue; } // fix 5: after Final, never a hole your own team confirmed
            if ((!isBoss(d, me) && !sidesOf(d, me.pid).length) || (stakes(d) && !teamsOfP(d, me.pid).length)) { no.push(h); continue; } // N5: in a money game only a player on a team disputes
            if (stakes(d)) { if (!b.want || typeof b.want !== 'object') throw bad(400, 'Say what hole ' + h + ' should be: the dispute is settled at the entered score or at yours.', { needWant: true }); const w = entryOf(d, t, Object.assign({ drive: x.drive, shots: x.shots }, b.want, { hole: h })).e; if (sameV(w, x)) throw bad(409, 'That is the score already on the card.'); x.want = w.g != null ? { g: w.g } : { p: w.p }; }
            // H1: a CONFIRMED hole is only disputed with a note, and every player is told. The one who raises a dispute never settles it.
            if (x.st === 'confirmed') { if (note.length < 3) throw bad(400, 'Hole ' + h + ' is confirmed. Say what is wrong with it (3+ characters). Every player is told, and someone else settles it.'); notify(d, 'dispute', me, me.name + ' disputed ' + t.name + ' hole ' + h + ', which was confirmed: ' + note + '. Someone else settles it.'); }
            x.pst = x.st; x.st = 'disputed'; x.note = note; x.df = me.name; x.dfPid = me.pid; }
          n++; }
        if (stale.length) throw bad(409, 'Hole' + (stale.length === 1 ? ' ' : 's ') + stale.join(', ') + (seen ? ' changed since you looked at the card.' : ': open the card first.') + ' Check ' + (stale.length === 1 ? 'it' : 'them') + ' and confirm again. Nothing was confirmed.', Object.assign({ stale }, seen ? {} : { openFirst: true }));
        if (!n) { if (ownCf.length) throw bad(403, 'Your team confirmed hole' + (ownCf.length === 1 ? ' ' : 's ') + ownCf.join(', ') + '. After Final a team cannot dispute a hole it confirmed itself.', { ownConfirmed: ownCf });
          if (own.length || (mine && op === 'confirm' && !self.length && !no.length)) throw bad(403, op === 'confirm' ? "You can't confirm a card for a team you play on or score for. Another team's scorer confirms it." : "You can't dispute a hole on your own team's card. Its scorer enters it again, or asks for a confirmed hole to be changed."); if (self.length) throw bad(403, 'You typed ' + (self.length === 1 ? 'that hole' : 'those holes') + ' yourself. Someone else confirms ' + (self.length === 1 ? 'it' : 'them') + '.');
          if (no.length) throw bad(403, op === 'confirm' ? 'You cannot confirm ' + (no.length === 1 ? 'that hole' : 'those holes') + '. ' + (no.length === 1 ? 'It was' : 'They were') + ' typed by someone who does not play on ' + t.name + ', so ' + t.name + '\'s own player confirms ' + (no.length === 1 ? 'it' : 'them') + ' (someone from another team only when ' + t.name + ' has no Oddable account).' : "Another team's scorer (or the organizer) disputes a hole.");
          throw bad(409, op === 'confirm' ? 'No entered holes in that range' : b.off ? 'No dispute of yours on that hole' : 'That hole has no score yet'); }
        audit(D2, { at: now, by: me.name, tid: t.tid, hole: from, to, what: op === 'confirm' ? 'confirmed' : b.off ? 'dispute taken back' : 'disputed', note: op === 'dispute' && !b.off ? note : undefined }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'resolve') {
      // SETTLE A DISPUTE: through THE NEUTRAL RULE. Only a hole that IS disputed, only in a live round, never by the person who raised the dispute. An
      // organizer or co-organizer who is NOT PLAYING settles it alone (logged, everyone told). Anyone on a team only ASKS: the settlement waits, changes
      // nothing, and counts once that team's own scorer or a neutral from another team signs it.
      rate('score', u.mk, ip); const t0 = d0.teams.find((x) => x.tid === String(b.tid)); if (!t0) throw bad(404, 'No such team'); const { hole, e } = entryOf(c, t0, b), cur0 = (d0.scores[t0.tid] || {})[hole];
      const { g, out } = await power(c, u, 'resolve', { tid: t0.tid, hole, e, rev: cur0 ? cur0.rev : null }); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true;
    }
    if (op === 'extraconfirm') { // Playbook: a closest-to-the-pin / longest-drive winner is confirmed like a score, by someone NOT on the winner's team who did not enter it
      const kind = b.kind === 'ld' ? 'ld' : 'ctp', hole = num(b.hole, 1, 18);
      const g = await mutC(c.id, (d) => { const D2 = d.day; if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. It has to be reopened before anything changes.' : 'The round has not started'); // INSIDE the write
        const x = ((D2.win || {})[kind] || {})[hole], me = memberOf(d, u.mk); if (!x || !me) throw bad(404, 'No winner entered for that hole'); if (b.who != null && String(b.who) !== x.who) throw bad(409, 'The winner changed. Check it again.'); if (x.st === 'confirmed') return { nochange: true, v: d };
        const wT = D2.teams.find((t) => t.tid === x.who || t.players.includes(x.who));
        // the one signer rule: the confirm is the second signature on what the typer entered; never the typer, never the typer's team, and not the winner's team unless nobody else can
        const typer = d.members.some((m) => m.pid === x.bp) ? x.bp : null, who = typer ? signers(d, typer, { not: wT ? [wT.tid] : [] }) : []; if (x.bp === me.pid || !who.includes(me.pid)) throw bad(403, "Someone who is not on the winner's team, and did not enter it, confirms the winner.");
        x.st = 'confirmed'; x.cf = me.name; x.cfPid = me.pid; x.cfAt = now; audit(D2, { at: now, by: me.name, hole, what: kind + ' confirmed' }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'extra' || op === 'extrareopen') { // closest to the pin / longest drive winner: organizer or any scorer enters it. LIVE ROUNDS ONLY (review fix).
      const kind = b.kind === 'ld' ? 'ld' : 'ctp', hole = num(b.hole, 1, 18); if (!d0.extras[kind].includes(hole)) throw bad(400, 'That hole has no ' + (kind === 'ld' ? 'longest drive' : 'closest to the pin'));
      if (op === 'extrareopen') { const { g, out } = await power(c, u, 'extrareopen', { kind, hole, reason: clean(b.reason, 120) }); send(res, out.pending ? 202 : 200, Object.assign({ game: await full(g, u) }, powerAns(out))); return true; } // a CONFIRMED winner is reopened only through THE NEUTRAL RULE
      const who = String(b.who || ''); if (op === 'extra' && who && !c.members.some((m) => m.pid === who) && !d0.teams.some((t) => t.tid === who)) throw bad(400, 'Pick the winner');
      const g = await mutC(c.id, (d) => { const D2 = d.day, me = memberOf(d, u.mk); if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. The organizer has to reopen it (with a reason) before a winner can change.' : 'The round has not started'); // INSIDE the write
        D2.win[kind] = D2.win[kind] || {}; const cur = D2.win[kind][hole];
        if (!isOrg(d, u.mk) && !isCo(d, me) && !D2.teams.some((t) => t.scorer === me.pid)) throw bad(403, 'Only a scorer or the organizer enters winners');
        if (cur && cur.st === 'confirmed') throw bad(409, 'That winner is confirmed. It changes only if the organizer reopens it with a reason, and then it is confirmed again.');
        if (!who) delete D2.win[kind][hole]; else D2.win[kind][hole] = { who, note: clean(b.note, 40), by: me.name, bp: me.pid, at: now, st: 'entered' }; audit(D2, { at: now, by: me.name, hole, what: kind + (who ? ' winner' : ' cleared'), to: who || null }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    throw bad(404, 'not found');
  } catch (e) { if (!e.status) console.error('golf:', e.message); send(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Golf error, try again' }, e.extra || {})); return true; }
}

// ---------- adapter (for Groups and the Calcutta engine) ----------
// attachToGroup(gameId, groupId, contestId): called BY THE GROUPS MODULE after it has checked that the caller is that group's commissioner
// (groups.attachGame). It only accepts an attach that the golf organizer has just asked for through /golf/attach (or create with a group), so a
// commissioner cannot pull someone else's golf game into a group, and nobody can attach to a group they do not run. `attach` is the same function
// (older wiring registers it under that name).
async function attachToGroup(id, groupId, contestId) { const gid = clean(groupId, 20), k = String(id) + '|' + gid, t = ATT.get(k); if (!t || t < D.now()) throw bad(403, 'Only the organizer of this golf game, as commissioner of that group, can attach it');
  return mutC(id, (d) => { d.groupId = gid; d.contestId = contestId ? clean(contestId, 20) : null; d.u = D.now(); return { ok: true }; }); }
const attach = attachToGroup;
// potSummary(contestId): information only (Oddable never collects, holds or pays money). perSkin = the value of ONE skin (it was mislabelled per entrant).
async function potSummary(id) { const c = await getC(id), p = c.pot, pc = poolC(c);
  const o = { id: c.id, kind: c.kind, title: c.title, pot: p.pot, entry: p.entry, entrants: entrantsOf(c), paid: paidPids(c).size, expected: p.entry * entrantsOf(c), potTotal: pc.potC / 100, take: pc.takeC / 100, pool: pc.poolC / 100 };
  if (c.day) o.extras = { perSkin: c.day.extras.skins.on ? c.day.extras.skins.amt : 0, ctp: c.day.extras.ctp.length * c.day.extras.ctpAmt, ld: c.day.extras.ld.length * c.day.extras.ldAmt, perMatch: c.day.heads.on ? c.day.heads.amt : 0, matches: c.day.matches.length };
  return o; }
// golfers(eventId, tour): lots source for the Calcutta engine: every golfer in the field, in feed order (the engine decides any "field" bundle).
async function golfers(eventId, tour) { const b = await D.feed.board(F.TOURS[tour] ? tour : 'pga', eventId); return b.golfers.filter((g) => g.st !== 'wd' || g.started).map((g) => ({ id: 'g:' + g.id, name: g.name, label: g.name, src: 'golf-pro', eventId: b.event.id, st: g.st, pos: g.pos, toPar: g.toPar })); }
// teams(contestId): a golf day's teams as lots, with display names only (safe to show).
async function teams(id) { const c = await getC(id); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); const nm = nameMap(c), bd = dayBoard(c); return c.day.teams.filter((t) => t.players.length).map((t) => { const r = bd.rows.find((x) => x.tid === t.tid) || {}; return { id: 't:' + c.id + ':' + t.tid, name: t.name, label: t.name + ' (' + t.players.map((p) => nm[p]).join(', ') + ')', src: 'golf-day', players: t.players.map((p) => nm[p]), place: r.place || null, thru: r.thru || 0 }; }); }
// Players of record for the Calcutta engine (calcutta-calc HANDOFF "Round 3"): each player as an ACCOUNT ID, or 'g:<guest id>' for a guest, so players can
// buy back their own team and get their S-ALL record. SERVER TO SERVER ONLY: this never goes into a golf response, and the engine keeps keys, not ids.
async function teamsOfRecord(id) { const c = await getC(id); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); return c.day.teams.filter((t) => t.players.length).map((t) => ({ id: 't:' + c.id + ':' + t.tid, name: t.name, abbr: t.name.slice(0, 4).toUpperCase(),
  // Round 4 contract: an account that joined the golf day ITSELF is sent as { key: <account id>, name, accepted: true } (it shows in that player's dashboard at once); a guest as 'g:<guest id>'
  players: t.players.map((p) => c.members.find((m) => m.pid === p)).filter(Boolean).map((m) => (m.guest ? 'g:' + m.gid : m.e ? { key: m.e, name: m.name, accepted: true } : null)).filter(Boolean) })); }
// Who is asking (calcutta-calc "Round 4", item 5): the engine passes { viewer: <account id> }. A golf day's teams are shown only to people IN that golf day,
// and only its organizer may build a Calcutta on it. No viewer, a stranger, an unreadable game: refused (null / false), never the list.
const viewerIn = (c, ctx) => { const v = ctx && ctx.viewer ? String(ctx.viewer) : ''; if (!v) return null; return c.members.find((m) => m.e === v && !m.left) || null; };
// GOLF CALCUTTA (manager decision Nov 16 2026): golf registers itself with the Calcutta engine so tour fields and golf-day teams can be auctioned.
// Lot source contract (calcutta.js "PLUGGED SOURCES"): teams() -> lots, results(calc) -> {<lotId>: {wins, winT, reached, reachT, champ, out, place}},
// startTime(calc) -> ms | null, started(calc) -> true once play is under way. Which golf thing a Calcutta is about is read from calc.golf:
//   { gameId }            a golf day's teams (local: its own players are the players of record)      lot ids 't:<gameId>:<tid>'
//   { tour, eventId }     a tour event's field (default: this week's PGA TOUR event)                  lot ids 'g:<golferId>'
// started() NEVER answers true by default (the engine treats true as permanent): a read error, an unknown game id or a missing start time is THROWN,
// and the engine fails closed for as long as that lasts. results() answers {} when it cannot read (nothing is paid).
const calcRef = (calc) => { const g = (calc && (calc.golf || calc.ref || (calc.rules && calc.rules.golf))) || {}; return g.gameId ? { gameId: String(g.gameId) } : { tour: F.TOURS[g.tour] ? g.tour : 'pga', eventId: g.eventId ? clean(g.eventId, 20) : '' }; };
const noRes = (o) => Object.assign({ wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false }, o);
const calcuttaSource = {
  golf: true,
  organizer: async (calc, ctx) => { const r = calcRef(calc); if (!r.gameId) return !!(ctx && ctx.viewer); const c = await getC(r.gameId), m = viewerIn(c, ctx); return !!m && c.kind === 'day' && isOrg(c, m.mk); },
  teams: async (calc, ctx) => { const r = calcRef(calc); if (r.gameId) { const c = await getC(r.gameId); if (!viewerIn(c, ctx)) return null; return teamsOfRecord(r.gameId); } return (await golfers(r.eventId, r.tour)).map((g) => ({ id: g.id, name: g.name, abbr: g.name.split(' ').slice(-1)[0].slice(0, 4).toUpperCase() })); },
  // the scheduled end (the engine opens a commissioner correction 24 h after it when no result came): a tour event's last day; a golf day = 6 hours after its first tee time (noon Central of its date when no tee time was set)
  endTime: async (calc) => { const r = calcRef(calc); if (r.gameId) { const c = await getC(r.gameId); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); return (c.day.lockAt || Date.parse(c.day.date + 'T18:00:00Z')) + 6 * 3600e3; } const b = await D.feed.board(r.tour, r.eventId); return (b && b.event && (b.event.end || (b.event.start ? b.event.start + 4 * DAY : null))) || null; },
  startTime: async (calc) => { const r = calcRef(calc); if (r.gameId) { const c = await getC(r.gameId); return c.day.lockAt || null; } const b = await D.feed.board(r.tour, r.eventId); return feedLock(b); },
  started: async (calc) => { const r = calcRef(calc); // every failure below is thrown, never turned into "started"
    if (r.gameId) { const c = await getC(r.gameId); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); return c.day.status !== 'setup' || (c.day.lockAt != null && D.now() >= c.day.lockAt); }
    const b = await D.feed.board(r.tour, r.eventId); if (!b || !b.event) throw new Error('golf: no leaderboard for that event'); if (begun(b)) return true; const la = feedLock(b); if (!la) throw new Error('golf: the feed has no start time for that event'); return D.now() >= la; },
  results: async (calc) => { try { const r = calcRef(calc);
      if (r.gameId) { const c = await getC(r.gameId); if (c.kind !== 'day' || c.day.status !== 'final') return {}; const bd = dayBoard(c), out = {}; bd.rows.forEach((x) => { if (x.place) out['t:' + c.id + ':' + x.tid] = noRes({ place: x.place, champ: x.place === 1 && bd.rows.filter((y) => y.place === 1).length === 1 }); else if (x.dnf) out['t:' + c.id + ':' + x.tid] = noRes({ out: true }); }); return out; }
      const b = await D.feed.board(r.tour, r.eventId); if (!b.event.done) return {}; const out = {}; b.golfers.forEach((g) => { const pl = parseInt(String(g.pos).replace(/^T/, ''), 10); out['g:' + g.id] = noRes(g.st === 'active' && pl ? { place: pl, champ: pl === 1 && b.golfers.filter((x) => x.pos === g.pos).length === 1 } : { out: true }); }); return out; } catch (e) { return {}; } },
};
// Called once at start-up (server.js) with the Calcutta module: registers the sources and remembers the module for attach.
let CALC = null;
function registerCalcutta(calcMod) { if (!calcMod || typeof calcMod.registerSource !== 'function') return false; calcMod.registerSource('golf', calcuttaSource); calcMod.registerSource('golf-day', Object.assign({}, calcuttaSource, { local: true })); CALC = calcMod; return true; }
// Organizer links a golf game to a Calcutta built in the Calcutta screen: the golf game remembers it and the Calcutta is attached to the same group/contest.
async function linkCalcutta(gameId, calcId, accountKey) { const cid = clean(calcId, 40); if (!cid) throw bad(400, 'Which Calcutta?'); const g = await mutC(gameId, (d) => { if (d.org !== mkOf(accountKey)) throw bad(403, 'Only the organizer links a Calcutta'); d.calcId = cid; d.u = D.now(); return d; });
  if (CALC && typeof CALC.attachToGroup === 'function' && g.groupId) await CALC.attachToGroup(cid, g.groupId, g.contestId || g.id); return { ok: true, calcId: cid, attached: !!(CALC && g.groupId) }; }
// Bets vs the group: Groups' grading only knows football, so a golf bet is classified 'golf' and is honor-system (the member settles it by hand).
function isGolfBet(b) { if (!b) return false; if (String(b.lg || '').toLowerCase() === 'golf') return true; const t = String(b.kt || '') + ' ' + String(b.text || ''); return /\b(PGA|LPGA|LIV|GOLF|MASTERS|US OPEN GOLF|RYDER)\b/i.test(t) || /^KX(PGA|GOLF)/i.test(String(b.kt || '')); }

// ---------- stats contract (consumed by the stats coder: calcutta-stats odds-api/stats.js validate + tot) ----------
// statsFor(userKey, {from, to}) -> normalized records. userKey = the account id from acct.who() (or 'guest:<gid>'). Dates are America/Chicago days.
// Kinds (review fix, Nov 16 2026): 'golf-round' = a round (result W only for the outright winner of a final golf day), 'match' = a heads-up match,
// 'event' = a side prize won (skins, closest to the pin, longest drive) with result 'W' and won = $ (information only), 'golf-pool' = a pool finish
// (result null + place; pick six once the event is final, one and done once the season is over; a running season has no place = open).
// verified = every hole confirmed by someone NOT on that team (never for a solo round).
// S-ALL money on a finished play: entry (stake), payout (won) and net (pl = payout - entry). Always present once the play is final, 0 included.
const money = (c, cents, paid) => ({ stake: paid === false ? 0 : c.pot.entry || 0, won: Math.round(cents || 0) / 100, pl: Math.round((cents || 0) - (paid === false ? 0 : c.pot.entry || 0) * 100) / 100 });
const by0 = (bd) => (bd.payBy === 'gross' ? 'gross' : 'net');
// L11: in a flighted game the place on the record is the place IN THE FLIGHT (the one the money follows); the place among all teams is extra.placeAll.
const placeOf = (bd, row, d) => { if (d.solo) return undefined; if (bd.flights && row.flight != null) { const fp = row[by0(bd) === 'net' ? 'fPlaceN' : 'fPlaceG']; return fp ? { n: fp, of: bd.rows.filter((x) => x.flight === row.flight).length } : undefined; } return row.place ? { n: row.place, of: bd.rows.length } : undefined; };
// Split cents among people exactly (leftover cents one each in list order).
const shareC = (cents, ids) => { const o = {}; if (!ids.length) return o; const each = Math.floor(cents / ids.length); let left = cents - each * ids.length; ids.forEach((p) => { o[p] = each + (left > 0 ? 1 : 0); if (left > 0) left--; }); return o; };
// SIDE MONEY TO THE CENT (review fix): a prize won by a TEAM (team skins, team closest to the pin) is ONE prize split among the team's players, not one
// prize per player, so the records add up to the real money. Where an entry fee is charged, only players marked paid take a share (an unpaid player
// shows no winnings). -> { skins: {pid: cents}, units: {pid: skins}, inSkins: Set(pid), side: {'ctp3': {pid: cents}} }
function sideMoney(c, bd) { const d = c.day, elig = (p) => { const m = c.members.find((x) => x.pid === p); return !!m && (!(c.pot.entry > 0) || !!m.paid); }, team = S.FORMATS[d.fmt].ball === 'team', out = { skins: {}, units: {}, inSkins: new Set(), side: {} };
  const ppl = (id) => { const t = d.teams.find((x) => x.tid === id); return t ? t.players : [id]; };
  if (bd.skins) { d.teams.filter((t) => t.players.length && (!(d.wd || {})[t.tid] || d.extras.skins.wd !== 'void')).forEach((t) => t.players.forEach((p) => out.inSkins.add(p))); const amt = d.extras.skins.amt || 0, ids = Object.keys(bd.skins.wonC || {}); let acc = 0, given = 0;
    ids.forEach((id) => { acc += bd.skins.wonC[id]; const upto = Math.round(acc * amt), cents = upto - given; given = upto; const all = ppl(id), ps = all.filter(elig), sh = shareC(cents, ps); all.forEach((p) => { out.units[p] = Math.round(bd.skins.wonC[id] / all.length * 10) / 1000; out.skins[p] = sh[p] || 0; }); }); }
  ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((hole) => { const w = d.win[k][hole]; if (w.st !== 'confirmed') return; const all = ppl(w.who), sh = shareC(Math.round(((k === 'ctp' ? d.extras.ctpAmt : d.extras.ldAmt) || 0) * 100), all.filter(elig)); out.side[k + hole] = {}; all.forEach((p) => (out.side[k + hole][p] = sh[p] || 0)); }));
  return out; }
// H4 (review round 3): golf NEVER marks a round confirmed. "Confirmed" is decided only by the stats module, from what golf reports truthfully here:
//   extra.card = { others, by, byName, at, guests, holes, of }
//     others  how many OTHER ACCOUNTS (never a typed-in guest, never someone who only joined) played on another team with a complete card in this game
//     by      stats.acctRef() of every account that PLAYS ON ANOTHER TEAM and put the second signature on this card (confirmed the team's entry, or typed
//             a hole the team's scorer then signed). Empty unless EVERY hole of the card carries two signatures from two different teams.
//     guests  typed-in guests in the game (flagged; they never count); extra.guest = this record's player is a typed-in guest
const acctRef = (e) => { const st = D.stats(); if (st && typeof st.acctRef === 'function') { try { return st.acctRef(e); } catch (x) {} } return 'gr' + crypto.createHash('sha256').update('oddable-golf-ref|' + e).digest('hex').slice(0, 22); };
function cardOf(c, t, m, n) { const d = c.day, sc = d.scores[t.tid] || {}, hs = Object.values(sc), acct = (pid) => c.members.find((x) => x.pid === pid && x.mk && !x.guest && x.e), plays = (pid) => d.teams.find((x) => x.players.includes(pid));
  const others = d.solo ? 0 : d.teams.filter((x) => x.tid !== t.tid && Object.keys(d.scores[x.tid] || {}).length >= n).flatMap((x) => x.players).filter((p) => acct(p) && p !== m.pid).length;
  const cnt = {}; let all = hs.length >= n && !d.solo, last = 0;
  hs.forEach((h) => { if (h.st !== 'confirmed') { all = false; return; } const out = [h.cfPid, h.bp].find((p) => p && !teamSide(t, p) && acct(p) && plays(p)), inn = [h.cfPid, h.bp].some((p) => p && teamSide(t, p)); if (!out || !inn) { all = false; return; } cnt[out] = (cnt[out] || 0) + 1; last = Math.max(last, h.cfAt || h.at || 0); });
  const by = all ? Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]) : [];
  return { others, by: by.map((p) => acctRef(acct(p).e)), byName: by.length ? mName(c, by[0]) : undefined, at: by.length ? last : undefined, guests: c.members.filter((x) => x.guest).length, holes: hs.filter((h) => h.st === 'confirmed').length, of: n }; }
async function statsFor(userKey, opt) {
  opt = opt || {}; const gk = /^guest:/.test(String(userKey)) ? String(userKey).slice(6) : null, mk = gk ? null : mkOf(userKey), from = opt.from || '0000-00-00', to = opt.to || '9999-99-99';
  const r = await D.S.dbGet(IDX), ids = ((r && r.data && r.data.mine) || {})[gk ? 'g:' + gk : mk] || [], out = [];
  for (const id of ids) {
    let c; try { c = await getC(id); } catch (e) { continue; } const m = gk ? c.members.find((x) => x.guest && x.gid === gk) : anyMember(c, mk); if (!m) continue; const nm = nameMap(c); // a player who left a pool keeps the result (the entry stayed in)
    if (c.kind === 'day') {
      const d = c.day, date = d.date; if (date < from || date > to) continue; const t = d.teams.find((x) => x.players.includes(m.pid)), bd = dayBoard(c), n = d.course.par.length, cid = d.course.id || null, fin = d.status === 'final', SM = sideMoney(c, bd), unpaid = (c.pot.entry || 0) > 0 && !m.paid;
      if (t) { const row = bd.rows.find((x) => x.tid === t.tid), h = holesOf(c, t.tid), team = S.FORMATS[d.fmt].ball === 'team';
        let score = null, toPar = null, putts = null, thru = 0; const hs = d.course.par.map((_, i) => { const e = h[i + 1]; if (!e) return null; const v = team ? Number(e.g) : Number(e.p && e.p[m.pid]); return v >= 1 ? v : null; });
        if (team) { score = row.gross; toPar = row.toParG; thru = row.thru; } else { let s0 = 0, pp = 0; d.course.par.forEach((par, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[m.pid]); if (g >= 1) { s0 += g; pp += par; thru++; } }); score = thru ? s0 : null; toPar = thru ? s0 - pp : null; }
        // putts are one number per hole entry: credited only in individual formats, to a one-player team or to the scorer who typed them for themself
        if (!team) Object.values(h).forEach((e) => { if (e.putts != null && (t.players.length === 1 || e.bp === m.pid)) putts = (putts || 0) + e.putts; });
        // verified = every hole agreed by two people who are not both from this team (never a solo round)
        const verified = !d.solo && Object.keys(h).length > 0 && Object.values(h).every((e) => e.st === 'confirmed' && e.cfPid && (!teamSide(t, e.cfPid) || (!!e.bp && !teamSide(t, e.bp))));
        const ct = fin ? contestOf(c) : null, cst = !!ct && (ct.pids.has(m.pid) || ct.tids.has(t.tid)), pay = fin && !d.solo && c.members.length > 1 ? dayPay(c, bd).pids : null, mny = fin ? money(c, pay && !cst ? pay[m.pid] : 0, !!m.paid) : { stake: m.paid ? c.pot.entry || undefined : undefined }; // item 4: a CONTESTED payout is not recorded as won
        // What counts toward the index (review fix): only a player's OWN ball for the whole round. Scrambles, alternate shot, Chapman and a SHAMBLE (the
        // team's drive is used) never do; best ball does, when this player holed out on every hole. The stats module decides; these flags tell it.
        const ownBall = !team && d.fmt !== 'shamble' && thru === n, plc = placeOf(bd, row, d), fk = by0(bd) === 'net' ? 'fPlaceN' : 'fPlaceG', wonRound = fin && !cst && !d.solo && !!plc && plc.n === 1 && (bd.flights && row.flight != null ? bd.rows.filter((x) => x.flight === row.flight && x[fk] === 1).length === 1 : bd.rows.filter((x) => x.place === 1).length === 1);
        if (thru) out.push(Object.assign({ src: 'golf', id: 'golf:' + c.id + ':round:' + m.pid, date, sport: 'golf', kind: 'golf-round', groupId: c.groupId || undefined, contestId: c.id, title: c.title + ' · ' + d.course.name, result: wonRound ? 'W' : null, place: plc, score, toPar, verified, extra: { contested: cst || undefined, net: team ? row.net : (S.FORMATS[d.fmt].ball === 'player' && thru ? score - d.course.par.reduce((a, _, i) => a + (hs[i] != null ? S.strokesOn(S.playHcp(chOf(d, m.pid), d.pct, n), d.course.hcp[i], n) : 0), 0) : null), teamNet: row.net, toParNet: row.toParN, courseId: cid, course: d.course.name, tees: d.course.tees, rating: d.course.rating ?? null, slope: d.course.slope ?? null, holes: thru, of: n, putts, format: d.fmt, solo: !!d.solo, card: cardOf(c, t, m, n), guest: m.guest ? true : undefined, team: team ? t.name : undefined, teamScore: row.gross, teamBall: team || d.fmt === 'shamble', ownBall, hcpCounts: ownBall, dnf: fin && row.dnf ? true : undefined, withdrawn: row.wd ? true : undefined, flight: bd.flights && row.flight != null ? bd.flights[row.flight].name : undefined, flightPlace: bd.flights && row.flight != null ? row[by0(bd) === 'net' ? 'fPlaceN' : 'fPlaceG'] || undefined : undefined, placeAll: bd.flights && row.place ? { n: row.place, of: bd.rows.length } : undefined, unpaid: fin && unpaid ? true : undefined, holeScores: hs, pars: d.course.par, hcpIdx: d.course.hcp, at: d.finalAt || c.created, who: team ? t.players.map((p) => nm[p]) : undefined, playingHcp: S.playHcp(chOf(d, m.pid), d.pct, n), hcpSrc: (d.hsrc || {})[m.pid] || 'none', oddableIndex: ((d.odx || {})[m.pid] || {}).index ?? null, guestId: m.guest ? m.gid : undefined, final: fin } }, mny));
        // skins: EVERY player in the skins game gets a record (winners W with their exact share, the rest L with 0), so nobody's dashboard misses the play
        if (fin && bd.skins && SM.inSkins.has(m.pid)) { const cents = SM.skins[m.pid] || 0, un = SM.units[m.pid] || 0, w = un > 0; out.push({ src: 'golf', id: 'golf:' + c.id + ':skins:' + m.pid, date, sport: 'golf', kind: 'event', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · skins', result: w ? 'W' : 'L', stake: 0, won: cents / 100, pl: cents / 100, units: un, verified, extra: { side: 'skins', skins: un, perSkin: d.extras.skins.amt || 0, team: team ? t.name : undefined, unpaid: w && unpaid ? true : undefined, course: d.course.name, courseId: cid } }); }
        ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((hole) => { const w = d.win[k][hole], sh = SM.side[k + hole]; if (!sh || !(w.who === m.pid || w.who === t.tid)) return; out.push({ src: 'golf', id: 'golf:' + c.id + ':' + k + hole + ':' + m.pid, date, sport: 'golf', kind: 'event', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + (k === 'ctp' ? 'closest to the pin' : 'longest drive') + ' #' + hole, result: 'W', stake: 0, won: (sh[m.pid] || 0) / 100, pl: (sh[m.pid] || 0) / 100, verified: true, extra: { side: k, hole: Number(hole), note: w.note, team: w.who === t.tid ? t.name : undefined, unpaid: unpaid ? true : undefined, course: d.course.name, courseId: cid } }); }));
      }
      // A heads-up match is ONE bet between two sides: a team's stake and winnings are split among its players. Money reads like a round's:
      // entry (stake), payout (won = what comes back: 2 x the bet for a win, the bet for a halved match, 0 for a loss), net (pl = won - stake).
      // A Nassau is 3 bets plus every press: stake = one bet (extra.bets = how many), net = the sum of them.
      bd.matches.forEach((x) => { const mine = x.kind === 'player' ? [x.a, x.b].indexOf(m.pid) : t ? [x.a, x.b].indexOf(t.tid) : -1; if (mine < 0) return; const ms = x.m || (x.nassau && x.nassau.total); if (!ms || !ms.done) return;
        const res = ms.res === 'T' ? 'T' : (ms.res === 'W') === (mine === 0) ? 'W' : 'L', sgn = mine === 0 ? 1 : -1, opp = mine === 0 ? x.b : x.a, oppName = x.kind === 'player' ? nm[opp] : (d.teams.find((y) => y.tid === opp) || {}).name;
        const ps = x.kind === 'player' ? [m.pid] : t.players, bets = x.nassau ? 3 + x.nassau.presses.length : 1, cut0 = (dollars) => { const tot = Math.round(Math.abs(dollars) * 100), sh = shareC(tot, ps)[m.pid] || 0; return (dollars < 0 ? -sh : sh) / 100; };
        const stake1 = cut0(x.amt || 0), plM = !x.amt ? 0 : cut0(x.nassau ? sgn * S.nassauMoney(x.nassau, x.amt) : res === 'W' ? x.amt : res === 'L' ? -x.amt : 0), entry = Math.round(stake1 * bets * 100) / 100;
        out.push({ src: 'golf', id: 'golf:' + c.id + ':match:' + x.mid + ':' + m.pid, date, sport: 'golf', kind: 'match', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + (x.type === 'nassau' ? 'Nassau' : 'match') + ' vs ' + oppName, result: res, stake: stake1, pl: plM, won: Math.round((entry + plM) * 100) / 100, opponent: oppName, verified: false, extra: Object.assign({ text: ms.text, short: ms.short, type: x.type, courseId: cid, bets, entry, perMatch: x.amt || 0, players: ps.length }, x.nassau ? { front: x.nassau.front.short, back: x.nassau.back.short, presses: x.nassau.presses.map((p) => ({ from: p.from, short: p.m.short })) } : {}) }); });
    } else if (c.pro.game === 'six') {
      let b = null; try { b = await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) {} if (!b || !b.event.done) continue; const date = chiDay(b.event.end || b.event.start || D.now()); if (date < from || date > to) continue;
      const ents = Object.keys(c.pro.entries).filter((p) => c.pro.entries[p].picks && c.pro.entries[p].picks.length === 6).map((p) => Object.assign({ pid: p, name: nm[p] }, c.pro.entries[p])), lead = b.golfers.filter((g) => g.st === 'active' && g.toPar != null).sort((x, y) => x.toPar - y.toPar)[0];
      const rk = S.rankSix(ents, fieldMap(b), c.pro.mc, c.pro.tb, lead ? lead.toPar : null), mine = rk.find((x) => x.pid === m.pid); if (!mine) continue;
      out.push(Object.assign({ src: 'golf', id: 'golf:' + c.id + ':pool:' + m.pid, date, sport: 'golf', kind: 'golf-pool', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + b.event.name, result: null, place: { n: mine.place, of: rk.length }, score: mine.total, toPar: mine.total, verified: true, extra: { game: 'pick six', event: b.event.name, tour: c.pro.tour } }, money(c, payPids(c, rk.map((x) => ({ key: x.pid, place: x.place, pids: [x.pid] })))[m.pid], !!m.paid)));
    } else { // one and done: ONE record per season; place only once the season is over (organizer ended it, or the Central date is past Dec 31 of the season year)
      const O = c.pro.oad, evs = Object.keys(O.events).map((k) => O.events[k]), settled = evs.filter((E) => E.res); if (!settled.length) continue;
      const last = settled.reduce((a, E) => Math.max(a, E.lockAt || 0), 0), over = !!O.ended || chiDay(D.now()) > String(O.season).slice(0, 4) + '-12-31', date = chiDay(over && O.ended ? O.ended : last || D.now()); if (date < from || date > to) continue;
      const tot = {}; c.members.forEach((x) => (tot[x.pid] = 0)); settled.forEach((E) => Object.keys(E.picks).forEach((p) => { tot[p] = (tot[p] || 0) + (E.res[E.picks[p].g] || 0); }));
      const rows = c.members.map((x) => ({ pid: x.pid, v: Math.round(tot[x.pid] * 100) / 100 })).sort((a, b) => b.v - a.v), place = rows.filter((x) => x.v > tot[m.pid]).length + 1;
      const mnO = over ? money(c, payPids(c, rows.map((x) => ({ key: x.pid, place: rows.filter((y) => y.v > x.v).length + 1, pids: [x.pid] })))[m.pid], !!m.paid) : { stake: m.paid ? c.pot.entry || undefined : undefined };
      out.push(Object.assign({ src: 'golf', id: 'golf:' + c.id + ':oad:' + O.season + ':' + m.pid, date, sport: 'golf', kind: 'golf-pool', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · one and done ' + O.season, result: null, place: over ? { n: place, of: rows.length } : undefined, score: Math.round(tot[m.pid] * 100) / 100, verified: true, extra: { game: 'one and done', season: O.season, events: settled.length, picks: settled.filter((E) => E.picks[m.pid]).map((E) => ({ event: E.name, golfer: E.picks[m.pid].n, pts: E.res[E.picks[m.pid].g] || 0 })), scoredBy: settled[settled.length - 1].by, live: !over } }, mnO));
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// THE CALCUTTA ENGINE TELLS GOLF WHO HOLDS A LOT (contract, round 4): setLotHolders(gameId, [accountKey, ...]) after every sale, buy-back or transfer in a
// Calcutta linked to this golf game. A lot is a stake: its holder is INTERESTED under the neutral rule. Until it has been called for a linked game,
// every organizer and co-organizer of that game is treated as a holder.
async function setLotHolders(gameId, accountKeys) { const mks = [...new Set((Array.isArray(accountKeys) ? accountKeys : []).map((k) => mkOf(String(k))))].slice(0, 2000); await mutC(gameId, (d) => { if (JSON.stringify(d.lotMks || null) === JSON.stringify(mks)) return { nochange: true, v: d }; d.lotMks = mks; d.u = D.now(); return d; }); return { ok: true, holders: mks.length }; }
module.exports = { moneySwitch, SIGNER_MIN_DAYS, setLotHolders, ruleDiff, _rule: { signers, interested, sidesOf, gated, ACT }, calcuttaSource, registerCalcutta, linkCalcutta, handicapFor: (k, o) => D.handicapFor(k, o), pairHistory, HCP_LABEL, HCP_NOTE, handle, attach, attachToGroup, potSummary, golfers, teams, teamsOfRecord, dayPay, statsFor, isGolfBet, limits, coursesOwnedBy, dayBoard, matchState, _deps: D, _mk: mkOf, _reset: () => { RL.clear(); QUEUE.clear(); SEEN.clear(); ATT.clear(); EST.clear(); ENTC.at = 0; ENTC.keys = {}; } };
