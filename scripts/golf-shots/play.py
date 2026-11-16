# Golf phone checks, review round 2 (430x900). Needs scripts/golf-shots/harness.js on :8822 and `python3 -m http.server 8823` in pics/.
# Every screenshot is measured: no sideways scroll, tap targets 44 px or more, the My Bets banner covered by the overlay, no page errors.
import asyncio, json, urllib.request
from playwright.async_api import async_playwright
OUT = '/tmp/golf-shots2/'
SEED = json.load(open(OUT + 'seed.json'))
errs, report = [], []
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 430, 'height': 900}, device_scale_factor=1, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Looks like a 5')))
        async def route(r):
            u = r.request.url
            if u.startswith('http://127.0.0.1') or u.startswith('http://localhost'): await r.continue_()
            else: await r.fulfill(status=200, content_type='application/json', body='{}')
        await ctx.route('**/*', route)
        await pg.add_init_script("if(!localStorage.getItem('odd-tok')){localStorage.setItem('odd-tok','t-ann');localStorage.setItem('odd-name','Sir Oddable');}localStorage.setItem('pics-lg','nfl');const d=new Date(),k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');localStorage.setItem('bets26',JSON.stringify([{id:'b'+Date.now(),kind:'prop',text:'Banner test bet',stake:10,odds:-110,day:k,t:Date.now(),week:11}]));window.ODD_GOLF_API='http://127.0.0.1:8822';")
        await pg.goto('http://localhost:8823/index.html?mirror=1'); await pg.wait_for_timeout(1500)
        n = [0]
        async def shot(name):
            await pg.wait_for_timeout(450)
            m = await pg.evaluate("""() => { const o = document.getElementById('ogolf'); const pb = document.getElementById('plb'); let cov = null;
              if (pb && !pb.hidden) { const r = pb.getBoundingClientRect(); if (r.width) { const e = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); cov = e ? !!e.closest('#ogolf') : null; } }
              const small = [...o.querySelectorAll('button,a,select,input,textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map(e => (e.getAttribute('data-a')||e.className||e.tagName)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height));
              const wide = [...o.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.right > 431; }).map(e => e.className || e.tagName).slice(0,4);
              return { sw: o.scrollWidth, cw: o.clientWidth, h: o.scrollHeight, overBanner: cov, small: small.slice(0,8), wide }; }""")
            h = max(900, m['h']); await pg.set_viewport_size({'width': 430, 'height': h}); await pg.wait_for_timeout(200)
            n[0] += 1; fn = '%02d_%s' % (n[0], name); await pg.screenshot(path=OUT + fn + '.png'); await pg.set_viewport_size({'width': 430, 'height': 900})
            bad = []
            if m['sw'] > m['cw'] or m['wide']: bad.append('SIDEWAYS ' + str(m['wide']))
            if m['small']: bad.append('SMALL ' + str(m['small']))
            if m['overBanner'] is False: bad.append('BANNER SHOWS')
            report.append((fn, 'ok' if not bad else '; '.join(bad)))
        async def click(sel): await pg.click('#ogolf ' + sel); await pg.wait_for_timeout(550)
        async def back(): await click('.oback')
        async def who(tok, name):
            await pg.evaluate("(()=>{const o=document.getElementById('ogolf');if(o){const c=o.querySelector('[data-a=close]');if(c)c.click()}})()")
            await pg.evaluate("localStorage.setItem('odd-tok','t-%s');localStorage.setItem('odd-name',%s)" % (tok, json.dumps(name)))
            await pg.reload(); await pg.wait_for_timeout(1200); await pg.add_script_tag(url='http://localhost:8823/golf.js')
            await pg.evaluate("(()=>{const p=document.getElementById('plb');if(p){p.hidden=false;try{betsRender()}catch(e){}}})()")
            await pg.evaluate("window.oddGolf()"); await pg.wait_for_selector('#ogolf [data-a=newpro]'); await pg.wait_for_timeout(800)
        async def opn(key): await click('[data-a=open][data-id="%s"]' % SEED[key]); await pg.wait_for_timeout(900)
        async def txt(): return await pg.evaluate("document.getElementById('ogolf').innerText")
        def has(label, t, needle): report.append(('CHECK ' + label, needle in t))
        def hasnt(label, t, needle): report.append(('CHECK ' + label, needle not in t))
        try:
          # ---- course search (Steve's report) ----
          await who('ann', 'Sir Oddable'); await click('[data-a=newday]'); await click('[data-a=course]'); await pg.fill('#oq', 'valley'); await click('[data-a=csearch]'); await pg.wait_for_timeout(600); await shot('course_search_list'); t = await txt()
          has('search lists real courses', t, 'Palm Valley Golf Club'); has('Show more button', t, 'Show more courses (25 of 60)'); has('Enter a course yourself is a separate last option', t, 'Enter a course yourself'); hasnt('no "Type a course in"', t, 'Type a course in')
          await click('[data-a=cmore]'); await pg.wait_for_timeout(600); t = await txt(); has('Show more adds to the SAME list', t, 'Show more courses (50 of 60)'); has('still the course list screen', t, 'Pick a course'); hasnt('did not drop to the manual screen', t, 'Save and use this course'); await shot('course_search_show_more_same_list')
          await click('[data-a=cmore]'); await pg.wait_for_timeout(600); t = await txt(); hasnt('last page: no more button', t, 'Show more courses'); report.append(('CHECK 60 courses listed', await pg.evaluate("document.querySelectorAll('#ogolf [data-a=cdir]').length") == 60))
          await click('[data-a=cdir] >> nth=0'); await pg.wait_for_timeout(700); await click('[data-a=tee] >> nth=1'); await shot('course_tees_and_lengths'); t = await txt(); has('course opens tees', t, 'Blue'); has('lengths', t, '6198'); has('Play the tees', t, 'Play the White tees')
          await back(); urllib.request.urlopen('http://127.0.0.1:8822/__down').read(); await pg.fill('#oq', 'mcallen'); await click('[data-a=csearch]'); await pg.wait_for_timeout(600); await shot('course_service_down_fallback_list'); t = await txt()
          has('says the service cannot be reached', t, "Couldn't reach the course list. Try again."); has('offers the bundled list', t, 'Sample courses saved in the app'); has('fallback course', t, 'McAllen Country Club'); has('manual still separate', t, 'Enter a course yourself')
          await click('[data-a=cdir] >> nth=0'); await pg.wait_for_timeout(700); await shot('course_fallback_tees'); t = await txt(); has('fallback course opens with tees', t, 'Slope'); urllib.request.urlopen('http://127.0.0.1:8822/__up').read()
          await back(); await click('[data-a=cmanual]'); await shot('course_enter_yourself'); t = await txt(); has('manual screen title', t, 'Enter a course yourself'); await back(); await back()
          await shot('day_setup_flights_payby'); t = await txt(); has('flights in set-up', t, 'Handicap flights'); has('singles 100% / best ball wording', t, 'Only your own ball for the whole round counts')
          await pg.select_option('#oflights', '2'); await pg.select_option('#onet', 'both'); await pg.wait_for_timeout(300); await shot('day_setup_flights_on_both_boards'); t = await txt(); has('prize money goes to', t, 'Prize money goes to'); await back()
          # ---- reopen: notice for the other player; own-side block for the organizer ----
          await who('bob', 'ChalkEater'); await shot('home_new_notice_badge'); t = await txt(); has('home list shows a notice badge', t, '1 new')
          await opn('flip'); await shot('reopen_notice_for_player'); t = await txt(); has('player is told about the reopen', t, 'Sir Oddable reopened the round after it was final. Reason: Hole 7 was written down wrong'); has('reopened banner', t, 'Reopened after it was final')
          await click('[data-a=seen]'); t = await txt(); hasnt('Got it clears the notice', t, 'Got it')
          await click('[data-a=team] >> nth=1'); await shot('team_detail_from_leaderboard'); t = await txt(); has('team screen', t.lower(), 'scorecard'); has('can check the card', t, 'Check and confirm this card'); await back(); t = await txt(); has('Back returns to the leaderboard', t, 'Leaderboard'); has('Back lands on the same game', t, 'Saturday skins')
          await click('[data-a=team] >> nth=1'); await click('[data-a=confirmv]'); await shot('confirm_card_pins_versions'); t = await txt(); has('confirm note', t, 'You confirm exactly the scores shown here'); await back(); await back()
          await click('[data-tab=side]'); await click('[data-a=extra]'); await shot('side_winner_confirmed_locked_for_scorer'); t = await txt(); has('confirmed winner locked', t, 'A confirmed winner changes only if the organizer reopens it with a reason')
          await who('ann', 'Sir Oddable'); await opn('flip'); await click('[data-a=final]'); await pg.wait_for_timeout(700); await shot('finish_blocked_own_side'); t = await txt(); has('organizer cannot finish over her own hole', t, 'on your own team or typed by you'); hasnt('no force button for her own side', t, 'Finish anyway')
          await click('[data-tab=side]'); await click('[data-a=extra]'); await shot('side_winner_reopen_form_organizer'); t = await txt(); has('organizer reopen form', t, 'Reopen this winner'); await back()
          # ---- final round: reopen needs a reason; paid list frozen; payouts re-scaled ----
          await back(); await opn('fin'); await shot('final_round_reopen_reason'); t = await txt(); has('reopen asks why', t, 'Reopen scoring: why? (every player is told)')
          await click('[data-a=reopen]'); t = await txt(); has('no reopen without a reason', t, 'Say why the round is reopened'); await shot('reopen_needs_reason')
          await click('[data-a=payv]'); await shot('payouts_frozen_rescaled'); t = await txt(); has('paid list frozen', t, 'The list is frozen because the round is final'); has('re-scaled places', t, '62.5%'); has('whole pool paid', t, '$25'); report.append(('CHECK no paid switches when frozen', await pg.evaluate("document.querySelectorAll('#ogolf [data-a=paid]').length") == 0)); await back()
          # ---- did not finish ----
          await back(); await opn('dnf'); await click('[data-a=final]'); await pg.wait_for_timeout(700); await shot('finish_blocked_short_card'); t = await txt(); has('Final blocked by a short card', t, 'Not everyone has finished'); has('names the team', t, '1 of 18 holes')
          await click('[data-a=team][data-tid=T3]'); await shot('team_detail_withdraw_form'); t = await txt(); has('withdraw form', t, 'Mark this team did not finish: why?')
          await pg.fill('#owd', 'Called away after one hole'); await click('[data-a=wd]'); await pg.wait_for_timeout(600); await shot('team_marked_did_not_finish'); t = await txt(); has('marked', t, 'Marked withdrawn by Sir Oddable'); await back()
          await shot('leaderboard_did_not_finish_last'); t = await txt(); has('DNF row', t, 'Did not finish: Called away after one hole'); has('no place no money', t, 'no place, no prize money')
          await click('[data-a=final]'); await pg.wait_for_timeout(700); await click('[data-a=payv]'); await shot('payouts_after_dnf'); t = await txt(); has('winner paid', t, 'RoadDogRay'); hasnt('DNF player wins nothing', t.upper().split('WHO WON WHAT')[1].split('WHO HAS PAID')[0], 'TEASERTINA'); await back()
          # ---- flights ----
          await back(); await opn('flt'); await shot('flights_leaderboard_all'); t = await txt(); has('flight picker', t, 'All flights'); has('net / gross chips', t, 'Gross board')
          await pg.select_option('#olbf', '1'); await pg.wait_for_timeout(300); await click('[data-lbb=gross]'); await shot('flights_flight_b_gross_board'); t = await txt(); has('Flight B only', t, 'OverUnderDog'); hasnt('Flight A hidden', t, 'ChalkEater')
          await click('[data-a=team] >> nth=0'); await shot('flights_team_detail'); t = await txt(); has('flight place on the team screen', t, 'in the flight'); await back()
          await click('[data-a=payv]'); await shot('flights_payouts_per_flight_and_board'); t = await txt(); has('payout per flight', t, 'FLIGHT A · NET BOARD'); has('gross board too', t, 'FLIGHT B · GROSS BOARD'); has('says where the money goes', t, 'Half to the gross board, half to the net board'); await back()
          await click('[data-a=hcpv]'); await shot('players_handicaps_confirmed_line'); t = await txt(); has('stats line shown', t, 'rounds confirmed'); await back()
          # ---- money game set-up: numbers asked for, OKs, start blocked ----
          await who('kim', 'Kim Vu'); await opn('ask'); await shot('money_setup_handicaps_needed'); t = await txt(); has('who needs a number', t, 'need a handicap'); has('asked line', t, 'Asked for 20.0: waiting for an OK'); has('OK button for a player', t, "OK 20.0 for Lou O'Neil"); has('own number waits', t, 'Asked for 8.0: waiting for an OK'); has('flights preview', t, 'Flights (set when the round starts)')
          await click('[data-a=start]'); await pg.wait_for_timeout(900); await shot('start_blocked_until_numbers'); t = await txt(); has('Start blocked', t, 'no handicap yet')
          await click('[data-a=hcpok] >> nth=0'); await pg.wait_for_timeout(500); await shot('handicap_okd_by_organizer'); t = await txt(); has('set after OK', t, "Entered 20.0, OK'd by Kim Vu"); await click('[data-a=hcpv]'); await shot('players_handicaps_co_organizer_switch'); t = await txt(); has('co-organizer switch', t, 'Co-organizer'); await back()
          await who('lou', "Lou O'Neil"); await opn('ask'); await shot('player_oks_organizer_number'); t = await txt(); has('player can OK the organizer', t, 'OK 8.0 for Kim Vu')
          await click('[data-a=hcpok]'); await pg.wait_for_timeout(500); await click('[data-a=hcpv]'); await shot('organizer_number_okd_by_player'); t = await txt(); has('organizer number OK\'d by another player', t, "Entered 8.0, OK'd by Lou O'Neil")
          await who('ivy', 'Ivy'); await opn('ask'); await shot('player_asks_for_a_number'); t = await txt(); has('ask wording', t, 'Ask the organizer to OK it'); await pg.fill('#omh', '18'); await click('[data-a=myhcp]'); await pg.wait_for_timeout(500); await shot('player_number_asked_not_set'); t = await txt(); has('asked, not set', t, 'Asked for 18.0: waiting for an OK')
          # ---- Nassau press after a closed-out nine ----
          await who('ann', 'Sir Oddable'); await opn('nas'); await click('[data-tab=mt]'); await click('[data-a=match]'); await shot('nassau_closed_out_press_next_hole'); t = await txt(); has('press from the next unplayed hole', t, 'from hole 8'); hasnt('no back-dated press', t, 'from hole 6')
          await click('[data-a=press]'); await pg.wait_for_timeout(600); await shot('organizer_press_is_an_offer'); t = await txt(); has('organizer press only offered', t, 'Press offered from hole 8'); await back(); await back()
          # ---- dispute on the organizer's own team ----
          await opn('dis'); await click('[data-a=team] >> nth=0'); await shot('dispute_on_organizers_team_organizer_view'); t = await txt(); has('organizer cannot settle own team', t, "another team's scorer or a co-organizer settles it"); report.append(('CHECK no settle button for the organizer', await pg.evaluate("document.querySelectorAll('#ogolf [data-settle]').length") == 0))
          await who('bob', 'ChalkEater'); await opn('dis'); await click('[data-a=team] >> nth=0'); await shot('dispute_on_organizers_team_other_scorer_view'); t = await txt(); has('other scorer can settle', t, 'Settle hole 3')
          # ---- pick six: swap shown to the pool, rules wording ----
          await who('ann', 'Sir Oddable'); await opn('six'); await shot('pool_swap_shown_to_everyone'); t = await txt(); has('swap list', t, 'SWAPS'); has('swap names', t, SEED['wdName'] + ' (withdrew) → ' + SEED['lateName']); has('left member kept', t, 'HookAndLadder')
          await click('[data-a=info]'); await shot('pick_six_rules_tiers_wording'); t = await txt(); has('tiers wording', t, 'alphabetical by last name until a ranking is available'); has('swap rule wording', t, "only before the new golfer's own tee time")
        except Exception as e:
          report.append(('FAILED', str(e)[:300])); await pg.screenshot(path=OUT + 'zz_fail.png'); report.append(('ogolf text', (await pg.evaluate("(document.getElementById('ogolf')||{}).innerText||''"))[:700]))
        await b.close()
asyncio.run(main())
bad = 0
for r in report:
    print(r)
    if r[0] == 'FAILED' or (r[0].startswith('CHECK') and r[1] is not True) or (not r[0].startswith('CHECK') and r[0] not in ('FAILED', 'ogolf text') and r[1] != 'ok'): bad += 1
print('PAGE ERRORS', errs); print('SCREENS', len([r for r in report if not r[0].startswith('CHECK') and r[0] not in ('FAILED', 'ogolf text')]), 'CHECKS', len([r for r in report if r[0].startswith('CHECK')]), 'PROBLEMS', bad)
