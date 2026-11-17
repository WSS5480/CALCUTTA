# Player stats v1.4 review (reviewer 6): 9aeeafa on 250a4b9
Clone: /tmp/rev6/repo (read-only). Attack scripts: /tmp/rev6/w/atk.js; review-5 repro re-run: /tmp/rev6/w5/atk.js. Shots: /tmp/rev6/shots.

## Verdict: SHIP AFTER FIXES
OK to hand to the port session after H1 and H2 are fixed in stats. They are small. H3 and H4 are engine-contract items: the port session must do them before any money game.

## Defects
### High
**H1. A guest can co-sign the organizer's own number.**
- Repro: `eventSetup(mo, 'C1', {players: [{key: mo, team: 'A'}, {key: 'guest:zzzzzz111111', team: 'B'}]})`, then `eventOverride(mo, 'C1', mo, {hcp: 30, reason: 'x', cosign: 'guest:zzzzzz111111'})`. Result: ok, changed.
- Cause: `cosignOk` accepts any key that is in `ev.pl` on another team.
- Fix: in `cosignOk`, refuse `guest:` keys and accounts with no stamp. Also require proof of the co-signer's tap (H4).

**H2. The organizer chooses who co-signs for him.**
- (a) He lists his second account in `coOrganizers`. It then approves his 54.0 with no co-sign. The log reads "approved by Zed Real" only.
- (b) He registers his alt as a player on a team he named himself. The alt co-signs.
- (c) Mo and his co-organizer approve each other with no co-sign (J1).
- Fix:
  - A co-organizer only becomes active after accepting on their own phone.
  - A co-organizer or co-signer the organizer appointed cannot sign for the organizer. Only a director, or a player on the other team who has accepted their seat, can.
  - The log and `shown` should say "(co-organizer added by Coach Mo)".

### High: engine contract (blocks money use, not the port)
**H3. Without `lockAt`, numbers can be changed after the round.**
- `lockAt` is optional for kind game, flight and season.
- Repro: an `eventOverride` of an opponent to 2.0, 10 days after the game, returns ok.
- Also, a "game" approval with no lock never lapses, so an engine that reuses an event id carries approvals across games.
- Fix: require `lockAt` (or a new `eventStart(eventId)`) when `money: true`. Engines snapshot `use` at Start. Engines use a fresh id per game.

**H4. A co-sign is only an account id the engine passes in.**
- Stats cannot know that the person tapped.
- Fix: add a co-sign token route. The co-signer confirms on their own phone and gets a short-lived token, which `eventApprove` / `eventOverride` verify.

### Medium
- **M1. Backfill trusts bet ids and log days the phone can write, at any time before it runs.** A user syncs bet `b1450000000000` and gets stamped 2015 (verified with `startOf`). Fix: floor every start at Oddable's launch date.
- **M2. The fallback date clusters accounts.** Every account with no bets or log gets the same date (deploy minus 30 days), so any 3 of them confirming trip "N confirmers joined within a week". Launch-week honest clubs are flagged for 180 days too. Throwaways made 8 days apart never trip it. Fix: exclude fallback-stamped accounts from the flag and keep it as information only. It is information only now, which is acceptable.
- **M3. `eventApproveAll` is slow for big fields.** It calls `eventApprove`, which does `CACHE.clear()` once per player, so a 40-player approve-all recomputes every player about 80 times. This adds to the old M3 live-latency risk. Fix: clear once at the end.
- **M4. An unknown sport silently becomes golf.** `evSport` maps an unknown game name to golf, so the event uses handicaps. Fix: throw 400.
- **M5. An event id can be taken first.** Whoever registers an id first owns it, and the real organizer gets 403. Fix: engines prefix ids (`golf:` / `ev:`) and use random ids.

### Low
- The backfill reads `dbIds` with limit 5000 and no paging. Non-`lock:` rows such as `plog:` get junk stamps.
- Email accounts made on My Apps before the deploy read as "joined today" after the backfill (documented).
- The organizer cannot remove a player who drops out, so `ready` stays false until he sets a number for them.
- An approve or set adds an unregistered player to the event, who can then read the log.
- `vouchLog` filters by club name, not id.
- A vouch counts in every game, not just that club's (review 5 suggested only inside the club's games).

## Verified
- **Review-5 items:**
  - H2 is dead: the stamp stays the only date.
  - H3 is dead: one-hole guest games make nobody a confirmer, and 4 aged throwaways give `use` null plus the warning "4 confirmers joined within a week".
  - H1 is handled by the backfill: it is idempotent, has a dry run and writes the marker last. Its boot guard fails safe: with no marker, the join date reads "not on file" and nobody is stamped.
  - If the backfill is forgotten: everyone reads UNCONFIRMED and organizers still approve. Nothing breaks and nothing leaks.
- **Approvals:**
  - Approve after lock: 409.
  - Approving a number different from `suggested`: 409. A different number has to be set with `eventOverride`, which logs the old value, the new value, the real Oddable number and the reason.
  - Season lapse at a move of 1.0 works.
  - Approvals are per event id.
  - Approve-all skips the approver.
- **No HTTP route** creates events or adds people, approves, sets or vouches. A stranger reading the log gets 404.
- **Vouch:** only an Enterprise account that owns the course (code read plus r5).
- **Tests, 10 of 10 each:** stats, stats-fixes, stats-r3, stats-r4, stats-r5, groups, alert, cfbd.
- **Screens:**
  - play.py: 9 runs (navy, violet, violet-dark at 360, 430, 1280), 459 checks, 0 failed, 0 page errors.
  - course.py: 110 checks per theme in all three themes, 0 failed.
  - I looked at the make-up, the CONFIRMED pill and the "Course set" card (360, 1280 dark): they read fine.

## Honest flows: all workable
- Club of 40: one tap, and a vouch makes them CONFIRMED.
- Rotating foursome: CONFIRMED.
- Couple: UNCONFIRMED; one tap approves.
- Season: re-approve only on a move of 1.0 or more.
- An organizer who also plays needs a co-organizer or a player on the other team every game. Workable.

## Contract gaps (HANDOFF v1.4)
1. Who the organizer is in a game a player creates (the creator), and that his own number needs a co-sign every time.
2. `lockAt` is required for money events, and engines snapshot `use` at Start (H3).
3. There is no way to prove a co-sign or a co-organizer accepted (H4, H2).
4. Event id format, namespace and freshness (M5).
5. Removing a player.
6. An unknown sport (M4).
7. A season lapse mid-week: block that week's start until it is approved again.
8. Whether events with `money: false` are registered at all.
9. Vouch: no route, and course ownership depends on the golf engine.
