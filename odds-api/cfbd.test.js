// Run: node odds-api/cfbd.test.js   (no network: checks that /cfbd/* is owner-only; stops before any CFBD call because no key is set)
process.env.MYAPPS_URL = 'http://myapps.invalid'; process.env.MYAPPS_SECRET = 'test-secret'; process.env.OWNER_PIN = '4321'; delete process.env.CFBD_API_KEY; delete process.env.OWNER_PHONE;
const assert = require('assert'), http = require('http'), acct = require('./acct'), cfbd = require('./cfbd');
const srv = http.createServer(async (req, res) => { if (req.url.startsWith('/acct')) { if (await acct.handle(req, res)) return; } if (req.url.startsWith('/cfbd')) { if (await cfbd.handle(req, res)) return; } res.statusCode = 404; res.end('{}'); });
srv.listen(0, async () => {
  const B = 'http://127.0.0.1:' + srv.address().port;
  try {
    for (const p of ['/cfbd/backtest', '/cfbd/current', '/cfbd/conf', '/cfbd/slices', '/cfbd/backtest?fresh=1']) { const r = await fetch(B + p); assert.strictEqual(r.status, 401, p + ' open without a token'); }
    let r = await fetch(B + '/cfbd/backtest', { headers: { 'x-token': 'abc.def' } }); assert.strictEqual(r.status, 401, 'junk token refused');
    r = await fetch(B + '/acct/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '4321' }) }); const tok = (await r.json()).token; assert.ok(tok, 'owner token minted by the existing /acct/owner');
    r = await fetch(B + '/cfbd/backtest', { headers: { 'x-token': tok } }); assert.strictEqual(r.status, 503, 'owner passes the gate (then stops: no CFBD key in this test)'); const t = await r.text(); assert.ok(/CFBD_API_KEY not set/.test(t));
    process.env.OWNER_PIN = '9999'; r = await fetch(B + '/cfbd/backtest', { headers: { 'x-token': tok } }); assert.strictEqual(r.status, 401, 'changing OWNER_PIN signs old owner tokens out');
    console.log('cfbd.test.js: all passed');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  srv.close();
});
