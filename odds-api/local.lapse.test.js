// v276 (server review A2): the "time ended" check on /local calls no longer stalls when My Apps is slow or down.
// lapsed() keeps each account's last KNOWN answer (2 minutes, then re-asked in the background), never lets "My Apps did not answer" undo a known
// "ended", and waits at most 1.2 s for an account it has never heard about (then lets it in provisionally and asks again 30 s later).
// Run: node odds-api/local.lapse.test.js (no network: the account module is a stub)
const assert = require('assert');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'k';
const L = require('./local'), D = L._deps; let n = 0; const t = (m) => { n++; console.log('  PASS ' + n + ' ' + m); };
let CLOCK = 1e12; D.now = () => CLOCK;
const ST = {}, CALLS = []; let HANG = false; const PEND = []; const release = async () => { PEND.splice(0).forEach((r) => r('unknown')); await new Promise((r) => setImmediate(r)); }; // ST[e]: 'ok' | 'ended' | 'unknown'; HANG: My Apps takes 25 s (as acct.expired's timeout)
D.acct = () => ({ expiredState: (e) => { CALLS.push(e); return HANG ? new Promise((r) => PEND.push(r)) : Promise.resolve(ST[e] || 'ok'); }, expired: async () => { throw new Error('the old call must not be used'); } });
const time = async (f) => { const t0 = Date.now(); const v = await f(); return [v, Date.now() - t0]; };
const KEEP = setInterval(() => {}, 1000); // the waits inside lapsed() do not hold the process open (unref), so the test does
(async () => {
  assert.strictEqual(await L._lapsed(null), false); t('no account: not lapsed, nothing asked');
  ST.a = 'ended'; let [v, ms] = await time(() => L._lapsed('a')); assert.strictEqual(v, true); t('an ended account is ended');
  CALLS.length = 0; [v] = await time(() => L._lapsed('a')); assert.strictEqual(v, true); assert.strictEqual(CALLS.length, 0); t('a known answer is served from the cache (My Apps not asked again)');
  HANG = true; CLOCK += 121e3; [v, ms] = await time(() => L._lapsed('a')); assert.strictEqual(v, true); assert.ok(ms < 200, 'served at once: ' + ms); t('after 2 minutes the last known answer is served at once while My Apps is asked in the background (' + ms + ' ms)');
  [v, ms] = await time(() => L._lapsed('b')); assert.strictEqual(v, false); assert.ok(ms >= 1100 && ms < 2000, 'waited ' + ms); t('a new account with My Apps hanging waits about 1.2 s, then is let in provisionally (' + ms + ' ms, not 25 s)');
  [v, ms] = await time(() => L._lapsed('b')); assert.strictEqual(v, false); assert.ok(ms < 200); t('the provisional answer is served at once for the next 30 s');
  await release(); HANG = false; ST.b = 'ended'; CLOCK += 31e3; /* the hung call has timed out ('unknown') by then */ await L._lapsed('b'); await new Promise((r) => setImmediate(r)); [v] = await time(() => L._lapsed('b')); assert.strictEqual(v, true); t('30 s later it is asked again and a real "ended" locks it out');
  ST.c = 'ended'; await L._lapsed('c'); ST.c = 'unknown'; CLOCK += 121e3; await L._lapsed('c'); await new Promise((r) => setImmediate(r)); [v] = await time(() => L._lapsed('c')); assert.strictEqual(v, true); t('"My Apps did not answer" never turns a known "ended" back into "let in"');
  console.log('local.lapse.test.js: ' + n + ' passed'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
