// Shared set-up for the Groups test suites (Groups Phase 1, Nov 16 2026). require() it FIRST in a suite.
// 1. The suites ported from 1e47e93 test Groups "open, as designed", so the Phase 1 switches are set that way here: GROUPS_ENABLED=1 (Groups on, and the
//    bet-sync merge stamps / locks), GROUPS_OWNER_ONLY and GROUPS_TESTERS unset. The switches themselves are tested in groups.phase1.test.js.
// 2. Phase 1 ships NO phone code. The ported suites also hold checks that read the Groups PHONE files (pics/groups.js, pics/join.js, the Groups hooks in
//    pics/index.html / sports.html / sw.js) and one that reads the preview branch's HANDOFF wording. Those run only when that code is there:
//      - in this tree, once Phase 2 adds pics/groups.js (they will then need the Phase 2 wording / version numbers), or
//      - ODD_PREVIEW_ROOT=<a checkout of 1e47e93> node odds-api/<suite>   (reads the phone files and HANDOFF.md from that checkout).
//    Otherwise each one is SKIPPED and counted, never silently passed: the suite prints how many were skipped when it ends.
const fs = require('fs'), path = require('path');
process.env.GROUPS_ENABLED = '1'; delete process.env.GROUPS_OWNER_ONLY; delete process.env.GROUPS_TESTERS;
const here = path.join(__dirname, '..'), has = (r) => !!r && fs.existsSync(path.join(r, 'pics', 'groups.js'));
const env = process.env.ODD_PREVIEW_ROOT ? path.resolve(process.env.ODD_PREVIEW_ROOT) : process.env.ODD_ROOT ? path.resolve(process.env.ODD_ROOT) : '';
// v272 (Groups phase 2): this tree now HAS pics/groups.js, but it is a new, smaller file written for the owner-only phase (my groups, create, invite, join,
// members, contest, leave + the bet step), not the 1e47e93 preview file these 15 checks describe (Kalshi tag, partner pairs, extra seats, the v254 markers, the
// preview HANDOFF wording). So they no longer switch on by themselves: they run ONLY against a checkout named in ODD_PREVIEW_ROOT / ODD_ROOT, and are skipped and
// counted otherwise. The v272 phone code has its own checks: node odds-api/groups.phone.test.js (server side) and the Playwright runs listed in HANDOFF "## v272".
const ROOT = has(env) && env !== here ? env : null;
let skipped = 0;
const phone = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'); // a phone file (or HANDOFF.md) of the tree that has the Groups phone code
// phoneCheck(fn): run fn(phone) when the Groups phone code is there; else count one skipped check.
const phoneCheck = (fn) => { if (!ROOT) { skipped++; return undefined; } return fn(phone); };
process.on('exit', () => { if (skipped) console.log('  NOTE: ' + skipped + ' phone / preview-wording check(s) SKIPPED: they describe the 1e47e93 preview phone file, not the v272 one (see groups.phone.test.js). Run them with ODD_PREVIEW_ROOT=<checkout of 1e47e93>.'); });
module.exports = { ROOT, phone, phoneCheck, skipped: () => skipped };
