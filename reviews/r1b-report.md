# Oddable test preview — Review B (every screen, look, usability)

Reviewer B, read-only. Nov 16 2026.
Reviewed: branch `preview` at `9c6d5c21ef4d6aa04071b8ffe55669ee79252143` (the HEAD when I cloned), in /tmp/r1b, run locally with `PREVIEW=1`. The branch has since moved to `50aac11`; see "the branch moved" below.
Nothing in /home/claude/calcutta* was changed. No pushes. No calls to steves-pics, calcutta-odds or Supabase (blocked in the browser harness, zero attempts logged).

## Verdict: SHIP AFTER FIXES

The new parts hang together and most of it is clean: no sideways scrolling inside any of the new screens, no sideways tables, headers sit over their columns, every screen has a Back or Close, and the My Bets banner never covered anything.
It is not ready to show as-is. Six things would trip the owner or a first-time user in the first five minutes (High list below). All six are small fixes.

## What was covered, and what was not

Covered (about 2,340 automatic screen audits, about 450 distinct screens, about 3,700 screenshots in /tmp/r1b-shots):
- Player (RGV Ray): every main screen (Games, Alert, Lock, Helper, road dogs, 2- and 3-game parlays, "Move the line?" from the Alert, the season drill and both parlays, Stats, Best odds, Line moves, Results, Rest of season, Live, Multiview, My Bets and all five drill-downs, Add bet, Ask AI, Survivor, Winning, Losing, other sports) at phone 430x900, small phone 360x740 and desktop 1280x800, in all three themes (navy default, violet light, violet dark).
- Player: Groups (80 screens), Calcutta (23), Golf (80), My stats (50), My handicap (19), Log my play (6), My events and pickleball (22), Start a game catalog, Suggest partners (6), Tournament handicaps, voice. Each at phone, small phone and desktop in navy, plus phone in violet light and violet dark.
- Commissioner (Coach Mo): Groups crawled as commissioner (36 screens, phone, navy: clean), plus scripted paths. Create a group (both steps), Enterprise contact form, invite sheet, members; create a Calcutta (both steps, invite); live auction with a bid, pot, board; closed Main Calcutta; golf home, golf day setup, course picker; event create form and its validation.
- Director (Pro Shop Pat): Tournament handicaps screen only.
- New person: invite link signed out, the demo-person picker, real sign-up (cell + PIN), join preview, join, empty My Bets, Add a bet form.

Not covered, so no claim is made about them:
- A full commissioner and director walk of every screen. The sandbox had 2 CPUs shared with other reviewers' crawlers (load 10+), and those crawls did not finish. Commissioner-only screens I did not open: edit rules, approve/deny requests, mark paid, change auction order, enter-results mode, buy-back, golf teams and handicaps step, score entry, confirm/dispute, reopen.
- Violet themes on small phone and desktop were only audited for the main screens, not the new overlays.
- The "classic view" style and classic.html.
- Anything that needs a real phone: voice, share sheet, text message, camera import, installed-app behaviour.

Harness notes that affect how to read this:
- The sandbox blocks ESPN and OpenGolfAPI. I pointed both (server and browser) at a local stand-in built from the real 2026 nflverse schedule, scores and lines, and the repo's own golf fixtures. Requests that fail only because of the sandbox (weather, ESPN logos) are not counted as defects.
- Themes and viewports after the first were switched in place on the same screen rather than by reloading.
- Both of my local servers were killed once mid-run (another process, not a crash: no error in the log). I restarted them. This showed the documented behaviour: everything typed into the preview is gone after a restart.

## Important: the branch moved while this review ran

I cloned and walked `9c6d5c2`. When I finished, `preview` in /home/claude/calcutta-preview was at `50aac116bb95f7a83688c82a7ae72349b47903a9`: 12 or more new commits, 50 files changed, including `pics/groups.js`, `pics/golf.js`, `pics/events.js`, `pics/preview.js`, `pics/index.html` (now v254) and the group demo seed. Every finding above is for `9c6d5c2`. I did not re-walk the new tip. A read of the new files (no screens run) suggests:

- Still there: H1 (`#ostat` is still missing from the strip list in preview.js), M11 (`ST.steps` is still used with no `ST` defined), M3 (events standings still print `r.h2h` with no fallback), M7 (sports.html still does not load preview.js, so no strip), the AI-key message (now in ai.js), H6 in substance (groups.js still says engines not built yet show "Coming soon").
- Probably fixed, needs a screen check: H3 (preview.js now saves and restores the invite around the person switch), M5 (the "USGA/GHIN" sentence is gone from golf.js), M6 (catalog.js no longer calls the warning).
- Unknown: H2, H4, H5, M1, M2 and the rest. Layout findings (bottom bar, header height, light-theme colours, two looks) are unlikely to have changed.

The walk should be re-run on the new tip before anyone relies on the "probably fixed" items.

## Check-by-check result

- Page errors: 2 found. "ST is not defined" (🎮 Play → "What is in this test copy") and "Cannot set properties of null (setting 'heard')" (My stats → Log my play → Any other game).
- Console errors and failed requests: every page load logs `/games` 502 and `/odds` 503 (the preview has no odds key, by design) and `/locks` 401 when signed out. `/stats/me` answered 429 Too Many Requests 33 times while moving quickly between stats screens.
- My Bets banner: 0 overlaps in 2,300 audits, at top, middle and bottom scroll positions. It is hidden behind every overlay.
- TEST PREVIEW strip: covers the Back and Close buttons on every My stats / My handicap / Log my play screen (245 of 250 audits). Covers nothing anywhere else. Missing altogether on the other-sports page.
- Sideways scrolling: none in any new screen. No page wider than the screen at 360, 430 or 1280. Two chip rows on the main page scroll sideways on phones (league row, Games/Stats/Best odds row). No tables scroll sideways; lists are wrapped cards.
- Table headers: every header checked sits over its data, numbers right and text left (Groups standings, Calcutta owners and payouts, pot, golf leaderboard, handicap rounds, events standings).
- Drill-downs: every summary tile I tapped opens its detail with a Back that returns (My Bets tiles, Groups place/winnings/pot tiles, Calcutta pot/sold/owner/lot, stats Record/P-L/ROI, by sport, by game type, handicap rounds). "Move the line?" Back returns to the Alert, the season drill or the parlay it came from. No exceptions found.
- Tap targets: all new overlays are 44px or more. Under 44px: bottom bar (5 of 8), header buttons, sign-in tabs, the strip's person switcher.
- Look: two different looks side by side (see Medium list). Light theme has unreadable text.
- Wording: see the wording items in the lists.
- Dead ends: no screen without Back or Close. Dead buttons and "coming soon" items are listed.

## Defects

Screenshot paths are under /tmp/r1b-shots/. "All" means it shows at every viewport and theme checked.

### High

H1. The yellow TEST PREVIEW strip covers the Back and Close buttons in My stats, My handicap, Log my play and every screen under them.
Screen: 🎮 Play → My stats (any). Viewport: all. Theme: all.
The stats overlay starts at the very top of the screen (top 0); its Close button sits at 8 to 52px and the strip covers 0 to 30px. Half of each button is hidden and untappable there. Cause: `#ostat` is missing from the list of overlays that `pics/preview.js` pushes below the strip. Preview-only; the live app has no strip.
Shot: crawl-player-phone-navy-b/005_stats__P_L_-_391_80.png

H2. "Create group" ignores the first tap after you type the entry amount.
Screen: Groups → Create a group → step 2. Viewport: all. Theme: all.
Type an entry (for example 20), tap "Create group": the pot line updates and nothing else happens. No request is sent. A second tap creates the group. Leaving the field redraws the form and the tap lands on a button that no longer exists. With no field edited, one tap works. A commissioner will think the button is broken. Other forms that redraw on field change should be checked for the same thing; the Calcutta bid box and Calcutta create did not have it.
Shot: explore/001_g_created.png (form still showing after the tap)

H3. In the preview, an invite link loses its destination when a signed-out visitor picks a demo person.
Screen: open `?join=g.<code>` signed out → "Who do you want to be?" → Player. Viewport: phone. Theme: navy.
The invite is saved before the pick and gone after it; the person lands on Games with no join screen. The owner cannot test "invite link → join" with the demo people. The real path works: with real sign-up (cell + PIN) the gate shows "You're invited to join <group>", and after sign-up the join preview opens with every rule, then Join works.
Shots: join-newuser/001_join_link_signed_out.png, join-newuser/003_join_after_demo_pick.png, join-signup2/ (working real path)

H4. My Bets shows "undefined" on every demo bet.
Screen: My Bets, daily log and every drill-down. Viewport: all. Theme: all.
Each row reads "Against the app · app had undefined" and "KC @ HOU · wk undefined · game not loaded". One total bet reads "Under to win · $25". The demo bets are on made-up games that are not in the schedule. This is the first screen the owner will open as RGV Ray.
Shot: main-player-phone-navy/032_mybets_s50.png

H5. Violet light theme: key text is unreadable.
Screen: Games (Alert card), season drill, parlays, header. Viewport: all. Theme: violet light.
Yellow on white at 1.6:1 contrast (golf match results and side-game totals too, 1.3 to 1.6:1): "Live pick: can change until 1 hour before kickoff…", "(early look)" and the "↔ Move the line?" buttons. "ⓘ Disclosures" is white on pale lilac (1.2:1). Green unit totals on white 1.9:1. In Calcutta the gold pot amounts on white are 1.6:1 and the "Side pot" badge 1.4:1. The required screen text for D5/D9 cannot be read in this theme.
Shot: main-player-phone-navy/002_home_games_wk11_live_picks__phone_violet-light.png

H6. A commissioner cannot put a Calcutta, golf day or local event in a group.
Screen: Groups → a group (commissioner). Viewport: all. Theme: all.
"+ Add a Calcutta", "+ Add a golf contest" and "+ Add a local event" are greyed out with "Coming soon". The owner decision is that a group holds several contests of every kind. Calcutta, golf and events exist, but only from 🎮 Play and not tied to the group. Golf and Calcutta screens even say "prizes are in the group's pots". Either wire these three buttons or take them off the screen.
Shot: explore/001_g_created_hub.png

### Medium

M1. Two looks in one app. Main screens, Calcutta, Golf, My stats and the Play hub are navy; Groups, My events, Start a game and the invite and join sheets are dark violet with purple buttons. Header bars differ too: Calcutta has a centred title with pill buttons, Golf a plain gradient header, Groups plain text links. In the violet light theme the main app goes white while Groups, events and the catalog stay dark and their bet titles turn purple on dark (2.8:1). All viewports.
Shots: crawl-player-phone-navy/001_groups__root.png, crawl-player-phone-navy-c/001_calcutta__root.png, crawl-player-phone-navy/008_groups__Winnings_6__phone_violet-light.png

M2. Bottom bar: 8 buttons, 5 narrower than 44px, confirmed. At 430 and at 360 wide: Games 42, Live 34, My Bets 46, Survivor 47, Winning 46, Losing 39, Groups 43, Play 34 (all 48 high, 10px labels). Desktop rail is fine (87x70). Recommended layout: five tabs of 72px or more — Games, Live, My Bets, Groups, Play. Move Survivor into Play (or a "More" sheet) and make Winning and Losing two chips at the top of Games, where they already act as filters.
Shot: main-player-phone-navy/001_home_games_wk10__small_navy.png

M3. Events standings show "H2H undefined · scored 55" under every player. Screen: My events → Friday Night Pickleball → Standings. All viewports and themes.
Shot: crawl-player-phone-navy/044_groups__My_events_Friday_Night_P_Standings.png

M4. Developer text shown to users. Ask AI: "Claude is not connected yet. Add ANTHROPIC_API_KEY to the calcutta-odds service in Render." Other sports page: "🚧 Live lines: under construction for NBA." 3-game parlay: "12 seasons (2014-2025): history not run yet for the 3-game rule." Golf score history uses raw codes: "ld winner · hole 4", "ctp winner · hole 3", "final". Tournament handicaps: "Tee off 2026-11-21".
Shots: main-player-phone-navy/041_ask_ai.png, main-player-phone-navy/048_nba_page.png, main-player-phone-navy/019_parlay_three.png

M5. "GHIN" and "USGA" appear on screen. Golf → Solo round: "unofficial Oddable handicap (not an official USGA/GHIN index)". The same screens say "unofficial Oddable handicap" and "My handicap (unofficial)" where decision H1 names it "Oddable Handicap Index" with the one line "Calculated with the World Handicap System method." The My handicap page has it right.
Shot: crawl-player-phone-navy-g/004_golf__Solo_round.png

M6. Starting a pickleball game shows a betting warning. Start a game → tap the Pickleball chip (also Golf, Basketball): "⚠️ Not a pick model yet. Bet at own risk. Cancel / Continue". It is the other-sports warning firing inside the game catalog. A commissioner setting up a round robin will not know what it means.
Shot: crawl-player-phone-navy/013_groups__Start_a_game_Pickleball.png

M7. The other-sports page is a different app. Tapping NBA/MLB/NHL/NCAAB (after the warning) opens a page with no TEST PREVIEW strip, a version pill reading v127 instead of v253, and a 5-button bottom bar with no Survivor, Groups or Play. A "Stats & locked" tab uses "locked" for records.
Shot: main-player-phone-navy/048_nba_page.png

M8. "Lock" is used for things other than the weekly model picks, all over the new screens: "Rules lock then", "rules locked ›", "🔒 Rules locked · Locked at Sun, Nov 15", "Rules lock at the first kickoff", "RULES LOCK WHEN THE AUCTION STARTS", "🔒 Locked rules", "Starts (rules lock then)", "A round locks for picking", "Picks lock at the first tee time", sign-in screen "locked records", stats "🔒 Sharing". Note the owner's own decisions use "rules lock at start", so this needs his call; if the rule stands, use "rules are final at kickoff" / "set" / "closed". "Double lock" does not appear anywhere. "Oddable" is spelled right everywhere.
Shot: crawl-player-phone-navy/024_groups__Your_place_3_NFL_standing.png

M9. After joining a group, nothing tells a new player how to bet. The hub shows the contest, pot, Invite people and Members. The only hint is "any bet in My Bets" inside the rules line. There is no "Add a bet" button in the group, and the Add-bet form does not say the bet will count for the group. New-player test: join works without help; placing the first bet for the group needs help.
Shot: join-signup2/004_joined_new_user.png

M10. Enterprise contact is only reachable from Groups → Create → step 2. Calcutta home, Golf home, My events and the game info pages print "Need more than 8? … Contact us." as plain text with nothing to tap.
Shots: crawl-player-phone-navy-c/001_calcutta__root.png, explore/001_enterprise_contact2.png (the form itself, which works and returns to step 2)

M11. "What is in this test copy" (bottom of 🎮 Play) does nothing. It throws "ST is not defined". All viewports.
Shot: flowx/001_about_test_copy.png

M12. Page error in Log my play → "Any other game": "Cannot set properties of null (setting 'heard')". The form still shows; the voice part of it is broken.
Shot: crawl-player-phone-navy-b/037_stats___Log_my_play__Any_other_ga.png

M13. Voice says two different things. 🎮 Play → "Log my score by voice — Preview: in progress … the phone screen is still being built". My stats → "🎤 Log my score" opens a finished-looking sheet with Hold to talk and Read it. Pick one message for the preview ("works, but this test copy has no AI key").

M14. Header takes up to half the phone screen on every main view. Header height is 381px at 430 wide and 429px at 360 wide (58% of a 740px screen), including an 86px empty gap between the version pill and the league row. On My Bets, Live and Survivor the content starts below the fold.
Shot: main-player-phone-navy/032_mybets.png

M15. Sign-in screen shown to an invited person carries "Owner? Owner PIN / Enter with PIN" and "This app is in development. Credit card payments are coming soon." The Sign in / Create account tabs are 38px high.
Shot: join-signup/001_gate_signup_from_invite.png

M16. Items still marked "Preview: in progress" or "Coming soon" on screen: Suggest partners, Tournament handicaps, Log my score by voice (Play hub); Head-to-head, Bankroll challenge, Survivor formats and the weekly high-score prize (Create a group); Add a Calcutta / golf contest / local event (group hub); Golf tournament (Calcutta event list); several catalog games marked Planned. The two stand-in screens (partners, tournament handicaps) work and read well; the director's screen shows "Oddable 12.4 (real results) · Tournament 10.0, set by director" as decided.

### Low

L1. Jargon on My stats: "WTD / MTD / YTD". Use "Week / Month / Year / Lifetime".
L2. Create group: "1 settled bets" in the dropdown.
L3. "Line moves" tab says only "Nothing here yet." No reason given.
L4. The week 10 Alert reads "0 picks in week 10 … not posted yet" on a Monday because the preview rebuilds from nothing at each start and will not pick games already played. Expect this on every wake-up of the free server; week 11 shows live picks correctly.
L5. Small tap targets on the main page: Add bet and Ask AI 40px high, team search 35px, conference picker 37px, Disclosures 40px, "Move the line?" 40px. The strip's person switcher is 24px high.
L6. Two chip rows scroll sideways on phones (league row; Games/Stats/Best odds/Line moves/Results/Rest of season). Chips, not tables, but "Results" and "Rest of season" start off-screen with no hint.
L7. Buttons with no name for screen readers: the on/off switches in Create a group, the Members request switch, some hole steppers.
L8. Play hub says "Demo: Saturday scramble"; the demo day is "Saturday Best Ball".
L9. Demo bets in the group are on made-up games (GB@CHI, KC@BUF on Nov 15) while the Games tab shows the real week 10 schedule. Fine for a demo, confusing side by side.
L10. Add-bet menu: "Import screenshot" is set in a larger font than the other four items.
L11. `/stats/me` returned "Too Many Requests" when moving quickly through stats screens. Check the limit is not reachable by normal tapping.
L12. Violet dark theme: white text on lilac buttons is 2.7:1 (Back, Analyze, Log my play, Save, Create a Calcutta).
L13. Groups muted grey text is 3.0:1 and the yellow "Coming soon" 4.1:1 on the dark cards (all themes).
L14. Rest of season chart: the top team label looks clipped at the top edge of the chart (seen in one screenshot, not measured).
L15. My stats "Money" list shows the group contest (+$64.10) and the same four bets individually. Flagged for the rules reviewer: check totals do not count them twice.

## First-time user test

New player with an invite link:
- Real path (cell + PIN): works without help up to "joined". The gate names the group, sign-up needs name, cell and PIN, the join preview shows every rule and the take before joining.
- Confusing: the Owner PIN box on the sign-in screen; after joining, no pointer to My Bets (M9); in the preview the demo-person route drops the invite (H3).
- Placing a bet: My Bets → Add bet → Add a bet → Single → pick the game → side, line, stake. Clear once found. The empty state text helps ("Tap Add a bet, pick a game…").

Commissioner:
- Group: two short steps, good explanations, live pot preview. Blocked by H2 (first tap ignored). Step 2 is long: 20-plus controls on one page.
- Calcutta: works. For NFL playoffs the commissioner must mark all 32 teams Out / Own lot / Field by hand ("Pick all" helps). Created screen says "Invite people, then start the auction", which is the right next step. Cannot be attached to the group (H6).
- Golf day: one long setup page with ⓘ on every format; course search and saved course work. "Your handicap" is a blank box rather than the Oddable index. I did not get past "Next: teams and handicaps" in the time available, so no verdict on the second half.
- Event: form is clear; the "Not a pick model yet" warning on the way in (M6) is the confusing step.

## The 10 changes that would most improve it

1. Push the stats overlay below the preview strip (add `#ostat` to the list in preview.js).
2. Stop forms redrawing on field change so the first tap on Create group always lands.
3. Keep the invite through the demo-person pick, so the owner can test invite → join as Ray.
4. Seed My Bets with bets on real scheduled games, and never print "undefined": hide the piece when the value is missing.
5. Fix the light theme: dark amber for the live-pick line and "Move the line?", dark text for Disclosures, darker gold and green on white.
6. One look for every overlay: move Groups, My events, Start a game and the share/join sheets to the navy palette and one shared header bar.
7. Bottom bar down to five tabs (Games, Live, My Bets, Groups, Play), each 72px or wider.
8. In a group, give the commissioner working Add Calcutta / golf / event buttons, and give members an "Add a bet" button with a line saying it counts here.
9. Replace developer and rule-breaking wording: the API-key message, "under construction", "history not run yet", "H2H undefined", raw audit codes, USGA/GHIN, WTD/MTD/YTD, and settle the "lock" wording with the owner.
10. Shrink the main header on phones (remove the 86px gap, collapse on scroll) and put a working "Contact us" link wherever the 8-person limit is mentioned.

## Files

- Screenshots: /tmp/r1b-shots/ (one folder per walk; file names carry the screen, viewport and theme)
- Worst 12: /tmp/r1b-shots/worst.png
- Automatic audit data: /tmp/r1b-shots/*.json; crawl text logs: /tmp/r1b-shots/crawl-*.log; flow logs: /tmp/r1b-shots/flow-*.log, joinflow.log, signup.log
- Harness (outside the repo): /tmp/r1b-tools/
