# Review: feat/calcutta-on-main 3f7fe22 (v274 main 8af1f79 + Calcutta engine c178485)

## Verdict
- Hand over dark: SAFE AFTER FIXES. You need two one-line fixes: D1 and D4.
- Fit for real pots once switched on: NO, until D2 and D3 are fixed. The round-7 money rules held up.

## Defects
D1 HIGH (affects users with the switch OFF). In pics/gate.js setMe (line 507), the new Calcutta line ends with a `// Calcutta ...` comment. Main's `setTimeout(() => { ... window.oddDays() ... }, 0);` now sits inside that comment, so it never runs.
- Effect: the days-left / Pay now renewal card (announce.js) is no longer drawn when the account is read. At page load oddMe() is still null, so the card only shows after the app is backgrounded and reopened.
- Repro: `git diff 8af1f79 3f7fe22 -- pics/gate.js`, hunk @@503.
- Fix: put the comment on its own line and restore the oddDays setTimeout as its own statement.
- No suite caught this; the request-diff could not catch it either (it is phone-side).

D2 CRITICAL (switch ON). Main's v256 team page has a capture-phase document click handler on every `[data-team]` (index.html line 2232). It also fires inside #ocalc and catches Calcutta's buttons that carry data-team: redit1 (x2), rsave, rclear (x2), csave, cremove. Tapping any of them opens main's NFL Team page (z 350) over the Calcutta.
- Effect: the commissioner cannot enter a result by hand, save or remove a correction, or clear a result.
- Repro: Playwright at 360, any theme: commissioner -> a Calcutta -> Teams -> a lot -> "Enter a result by hand". The Team page "15 / 0-0" covers the screen, and every later click times out.
- Fix (either one): in index.html, `if (!t || CFB || t.closest('#ocalc')) return;`, or rename the attribute in pics/calcutta.js to data-tm.
- With that one-line change, 108 screens per run (360 violet-light, 430 cowboys, 1280 violet-dark) gave 0 page errors, no sideways scroll, no small targets, contrast PASS, and the banner was always under the overlay.

D3 MEDIUM (switch ON). Calcutta invite links on main:
- (a) On a phone that does not yet have odd-calc (a brand-new device or a first sign-in), calcJoinRun ignores the link. The code is never saved, so it is lost on the sign-up reload. This goes against the owner decision: "New people sign up from the link and land on that game's join screen".
- (b) Main's grpCapture deletes ANY ?join= parameter, not only g., once /acct/status says Groups exists (GROUPS_ENABLED=1). It runs when status answers, usually before calcJoinRun's 1.5 s timer. With Groups live, c. links are stripped even on Calcutta phones.
- (c) pics/calcutta.js registers with window.OddJoin, which main does not have (no pics/join.js).
- Fix:
  1. grpCapture deletes the parameter only when it matches g.
  2. At load, always copy a c.<code> into sessionStorage, then act after sign-in when calcOn().
  3. For a guest, call oddSignUp('calc:' + code), the same way Groups does.

D4 LOW (test). groups.r3.test.js R-CALC2 fails 5/5, also on pristine main. Exact fix (verified 3/3 green, 37/37):
- `const src = process.env.ODD_CALCUTTA || path.join(__dirname, 'calcutta.js'); ... const ce0 = process.env.CALCUTTA_ENABLED; process.env.CALCUTTA_ENABLED = '1'; try {`
- and at the end of the test: `} finally { if (ce0 === undefined) delete process.env.CALCUTTA_ENABLED; else process.env.CALCUTTA_ENABLED = ce0; }`
- On pristine main (no calcutta.js) it falls back to the stand-in.

D5 LOW (gap, not in the HANDOFF). Main's Groups "Games" catalog (pics/groups.js addGame) has no Calcutta entry. Once the switch is on, the phone has no way to put a Calcutta into a group. groups.wire() registering 'calc' is therefore harmless today, but group pots will never show a Calcutta until someone adds `OddGroups.addGame({key:'calc', ...})`.

## A. Safe for the live app (switch unset)
- Request diff, main vs branch with the switch unset: 30 requests (health, acct status/me/time/owner, groups on/bet status/create/get, calcutta on/peek/board/create, /calcutta, /calcuttaX, OPTIONS, appcfg, golfday, lines, sync GET/POST, alert GET/POST, betpush, courts, locks, unknown). 0 differences. /calcutta/on gives 404 on both.
- server.js: both new lines need CALCUTTA_ENABLED === '1'. Unset means no require, no wire(), no watcher and no ESPN reads.
- acct.js: cFlag returns the same `me` object.
- Phone: calcOn() needs odd-calc, which only the server's `me.calcutta` sets. With it off: no menu item, calcutta.js is never requested, and the #ocalc guards are inert. The guard additions to sync.js and index.html change nothing for other users.
- The rest of the phone change does not clash with the five-tab bar (Calcutta sits in More), OddGroups, golf day or pickleball. The exceptions are D1 and D2.
- Suites: all 37 files (main's plus the 8 Calcutta files), 5 runs, 6 at a time. All passed 5/5 except groups.r3 0/5 (D4). No flakiness seen.
- Switches: ENABLED / OWNER_ONLY / TESTERS copy main's GROUPS_* logic line for line.
  - With owner-only on, a non-owner gets: on {on:false}, peek 404, board/create/join/list 403 {off:true}. The menu is driven by me.calcutta, which comes from the same onFor.
- groups.wire() when both switches are on: it registers only 'pot:calc'. The engine has no inviteInfo, golf/events/stats are null, and C.wireGroups is itself gated.
- Old groups.js Calcutta code: `kind:'calcutta'` contests cannot be created ("coming soon" refusals at lines 872/973), and pots sum only `ext` contests. So there is no double counting and no duplicate menu. The HANDOFF retire list is right.
- Main has not moved: origin/main is still 8af1f79, so the branch fast-forwards with no rebase needed. The merge guide is accurate except that it misses D1, D2, D3 and D5.

## B. Round 7 rules (own probes /tmp/rcmp/a.js, b.js)
- "Event finished": refused on place/champion tables (409 byresults). It is a proposal. The commissioner and members without a lot cannot confirm (eve: 404).
  - Once confirmed, unwon money goes back by price paid. Example: wins-only table, pool 1000, comm L1 $100 -> comm $280, others $240.
  - Two lot owners objecting withdraw it, and a re-proposal is refused (409 disputed).
  - Reopen needs a confirm.
- Objections are kept per subject. A single objection lapses after 7 days, and re-objecting after that gets 409 lapsed.
- Toggling spam: 20 taps gave 2 new pinned notices.
- H3: on a typed-name commissioner lot, only bob (whose lot lost the final) could confirm. cat and dan got 403.
- Feed final with the accomplice confirming at once: two honest objectors withdraw even the confirmed correction (comm $796.88 -> $130). Re-posting is refused. At day 31 the game is "off": over, no champion, money back by price.
- Commissioner + one accomplice:
  - Feed events: they keep a false correction only if fewer than two other lot owners object before the feed reports. On a table with one honest owner, the objection lapses after 7 days.
  - Custom tables: no accomplice is needed. The commissioner types any result directly (own team 1st: 200, no confirm; reopen + wins 5 = the whole $1,000). Members get notices and history only. This is by design, but the owner should know it before real Custom pots.
- Money generator (/tmp/rcmp/gen.js): 20,000 random Custom tables: 2 to 10 lots, unsold lots, typed names, buy-backs, pct/flat take, roll/carry with and without carryOk, places/champ/rounds/wins, 4,114 early finishes. Results:
  - pot/take/pool exact; owners = lots = paidOut; paid + unclaimed + inPlay = pool to the cent; inPlay 0 when over.
  - No early-ended leftover went anywhere except by price, unless every owner had agreed to carry.
  - 0 defects.

## Not verified
- The live server: the egress proxy refused calcutta-odds.onrender.com, so I could not check live GROUPS_ENABLED (it decides whether D3b bites today).
- Only 3 viewport/theme combinations were walked after the D2 fix, not all 12.

## Coder's own calls
- Keeping the old groups.js Calcutta code until the main session retires it: agree.
- Stats no-op TODO: agree.
- events hooks (My Apps alerts) not wired: fine while dark; needed before live auctions.
