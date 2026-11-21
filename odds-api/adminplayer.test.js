// Run: node odds-api/adminplayer.test.js  (no network: Supabase + My Apps are in-memory fakes)
// v293: POST /acct/admin/player — My Apps (People) adds an Oddable player (cell + name + PIN) or resets a PIN, with the shared app secret.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001' });
['GATE_OFF', 'GATE_KEY', 'GROUPS_ENABLED'].forEach((k) => delete process.env[k]);
const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, REG = [];
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: (s || 200) < 400, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); if (p === '/api/v1/auth/register') { if (REG.includes(b.email)) return ok({ error: 'taken' }, 409); REG.push(b.email); return ok({ ok: true, account: b.email }); } if (p === '/api/v1/auth/login') return ok({ ok: true, account: b.email }); if (p === '/api/v1/account') return ok({ email: b.email, role: 'user', plan: 'pro', expires_on: null }); return ok({ ok: true }); }
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) return ok({});
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (!url.includes('/oddable_sync')) return ok([]);
  if (m === 'GET') { const id = eq('id'); return ok(id ? (DB[id] ? [DB[id]] : []) : Object.values(DB)); }
  if (m === 'POST') { const row = JSON.parse(opt.body); if (DB[row.id] && /ignore-duplicates/.test((opt.headers || {}).Prefer || '')) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id], row); return ok([DB[row.id]], 201); }
  if (m === 'PATCH') { const id = eq('id'); if (!DB[id]) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  return ok([]);
};
const ACCT = require('./acct'), SYNC = require('./sync');
const srv = http.createServer(async (req, res) => { if (req.url.startsWith('/acct') && await ACCT.handle(req, res)) return; if (req.url.startsWith('/sync') && await SYNC.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let n = 0; const t = (x) => { n++; console.log('  PASS ' + n + ' ' + x); };
srv.listen(0, async () => {
  const P = srv.address().port, post = async (u, b) => { const r = await real('http://127.0.0.1:' + P + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J(b) }); return { s: r.status, j: await r.json() }; };
  try {
    let r = await post('/acct/admin/player', { secret: 'nope', phone: '9565550123', name: 'Tim', pin: '123456' }); assert.strictEqual(r.s, 401); t('wrong secret: 401');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '95655', name: 'Tim', pin: '123456' }); assert.strictEqual(r.s, 400); t('bad cell number: 400');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '9565550123', name: 'Tim', pin: '12' }); assert.strictEqual(r.s, 400); t('short PIN: 400');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '(956) 555-0001', name: 'X', pin: '123456', mode: 'reset' }); assert.strictEqual(r.s, 403); t('owner phone: refused');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '9565550123', name: 'T', pin: '123456' }); assert.strictEqual(r.s, 400); t('add needs a name (2+)');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '(956) 555-0123', name: 'Tim', pin: '123456' }); assert.strictEqual(r.s, 200, J(r.j)); assert.ok(/@phone\.oddable$/.test(r.j.account)); t('add: player created');
    r = await post('/acct/phone', { phone: '9565550123', pin: '123456' }); assert.strictEqual(r.s, 200, J(r.j)); assert.ok(r.j.token); t('the new player signs in with cell + PIN');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '9565550123', name: 'Tim', pin: '654321' }); assert.strictEqual(r.s, 409); t('add twice: 409 already has an account');
    const id = SYNC.idOf('9565550123'); DB[id].data = { bets: [{ id: 'b1' }] };
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '9565550123', pin: '777777', mode: 'reset' }); assert.strictEqual(r.s, 200, J(r.j)); t('reset: 200');
    assert.deepStrictEqual(DB[id].data, { bets: [{ id: 'b1' }] }); t('reset: bets untouched');
    r = await post('/acct/phone', { phone: '9565550123', pin: '123456' }); assert.strictEqual(r.s, 401); r = await post('/acct/phone', { phone: '9565550123', pin: '777777' }); assert.strictEqual(r.s, 200); t('reset: old PIN refused, new PIN works');
    r = await post('/acct/admin/player', { secret: 's3cret', phone: '9565559999', pin: '777777', mode: 'reset' }); assert.strictEqual(r.s, 404); t('reset unknown number: 404');
    console.log('\nALL ' + n + ' ADMIN PLAYER TESTS PASSED'); srv.close(); process.exit(0);
  } catch (e) { console.error(e); srv.close(); process.exit(1); }
});
