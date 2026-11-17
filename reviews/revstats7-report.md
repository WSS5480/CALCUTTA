# Review 7: stats-v1 1426e22 (Player stats v1.5) on 9aeeafa
Scope: only approval authorization, start, new routes, backfill, contract. Clone /tmp/rev7/repo, attack script /tmp/rev7/w/atk.js.

## Verdict: SAFE TO HAND OVER AFTER FIXES (M1 is small; the rest Low)

## Review-6 items: fixed
- H1 guest co-sign: fixed (refused at cosignOk and at cosignToken).
- H2 appointee/mutual: fixed. Co-organizer has no role until eventAccept; appointer and appointee are blocked both ways (also after accept); the mutual-approval block covers approve, set and co-sign; the log says "co-organizer added by ...".
- H3 start: fixed. ready:false 'no start time'; eventStart is 409 while a number is missing; after the start, setup/approve/override/accept/remove/cosign all return 409; the snapshot stayed byte-identical 30 days later after the player's rounds changed; a second start is 409; season per-gameId snapshot.
- H4 codes: fixed. Code issued only to the caller's own session (route passes e); 'cs'+10 chars of 31 symbols (about 8e14), at most 50 open per event, hashed, 10 min, single use (deleted inside the row mutate, race-safe), bound to event + player + field + exact value, re-checked at use. Bare account id: 403. A code for someone else = impossible over the route.
- M4/M5: unprefixed id 400; a re-register by another account 403; non-player approve 404; an empty sport is refused, and any other name becomes other:<slug> (by design: 'curling' accepted).

## Defects
**M1. The admitted residual is undefended, and HANDOFF says otherwise.**
- HANDOFF says the defence is "the stamp rule, the log ... and the age / activity flags". In practice:
  - After the backfill, any phone account with no stamp is stamped "now" on first look (sinceOf), so the stamp rule passes for an account made today.
  - No age or activity flag exists for a CO-SIGNER. The flags cover round confirmers only.
- Repro (atk.js A): tia has no stamp (backfill done) and sits on team B. She accepts, gets a code and co-signs mo's 54.0. The result is ok. Shown: "54.0 set by Coach Mo with Tia Real". There is no flag.
- Fix (cheap, uses existing code): in cosignOk, a SEAT co-signer (not a director or accepted co-organizer) must pass the confirmer test byCheck already uses:
  - joined at least CONF.byAgeDays (30) before, and
  - at least CONF.byActs (3) finished plays confirmed by another account,
  - or be vouched by this event's club.
  - Otherwise 403: "co-signer too new".
- Don't use "has posted a score in this event": it can't exist before the start, and an alt can post anyway.
- Also add the co-signer's join month to `shown` and the log ("with Tia Real, joined Nov 2026"). Fix the HANDOFF sentence.

**L1. A value-less code clears the organizer's own set number.**
- `/stats/event/cosign {eventId, pid}` with no `value` issues a code for null, which clears his own set number.
- Fix: require `value` on the route, or an explicit `clear: true`.

**L2. If `lockAt` passes without `eventStart`, the event can be dead.**
- With a number still missing, the event locks with no snapshot. `ready` stays false forever and nothing can fix it.
- Fix: contract line "if lockAt passes not ready, create a new event id".

**L3. eventApproveAll after the start returns ok with each player under "skipped", not 409.**
- Fix: early 409, so it matches "every change 409".

**L4. Backfill accepts a future `--launch`.**
- A typo like a future year makes every account "joined at launch", so all confirmers are "too new".
- Fix: refuse `launch > now`.

**L5. The mutual-approval check reads the event log, which is trimmed to 2000 lines.**
- A 400-player tournament can roll the earlier line off.
- Fix: keep a small `d.signed` set `{signerPk>playerPk}`.

## Backfill / email accounts
- Checked:
  - `--launch=` parsed (date gets T06:00Z) and validated
  - clamp to launch, plus the `<= now` clamp
  - paging by 1,000 with no cap
  - only 64-hex ids
  - dry run by default
  - `--write` refused with no launch
- Email account with no createdAt (atk.js C):
  - can accept a seat, and the organizer can set its number (works);
  - eventApprove of its Oddable number works only if it has rounds;
  - it can never co-sign or count as a confirmer until acct.createdAt exists.
  - Acceptable, and listed in "main-line must supply". Nothing breaks.

## Contract gaps (HANDOFF v1.5)
1. The residual defence text is wrong (M1).
2. Value-less code = clear (L1): say "always pass value".
3. lockAt passing while not ready = dead event: create a new id (L2).
4. Engines must call eventStart even when lockAt is set (otherwise there is no snapshot, only frozen live rows): say so explicitly.
5. Season gameId: the format is not specified (any 1 to 40 of [\w.:-]); say "fresh random per game".
Otherwise complete and unambiguous; the worked example matches the code.

## Suites (5 runs each)
stats 23, stats-fixes 21, stats-r3 22, stats-r4 15, stats-r5 12, stats-r6 7, groups 27, alert, cfbd: all 5/5 pass, no flakes.

## Not verified
Live Supabase paging, real acct.createdAt, phone screens (out of scope).
