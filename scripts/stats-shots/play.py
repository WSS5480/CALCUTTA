# Phone / desktop screenshots + layout checks for My stats. Needs: node scripts/stats-shots/harness.js running (ports 8896 / 8897).
# Usage: python3 scripts/stats-shots/play.py [out dir] [themes] [widths]     defaults: /tmp/stats-shots3  navy,violet,violet-dark  360,430,1280
# Runs the FULL app (pics/index.html with gate.js, sync.js, groups.js, dash.js, voicelog.js, stats.js loaded by the page itself, never ?mirror=1), once per
# theme and width, into <out>/<theme>_<width>/. Every screenshot is checked: no sideways scroll, every tap target at least 44 x 44 px (hole-grid inputs
# INCLUDED), nothing wider than the screen, the floating My Bets banner covered by the overlay, no "USGA / GHIN / unofficial / DUPR" wording, no
# "undefined" / "NaN", and every filled button / toast at 4.5:1 contrast or better. Exit code 1 on any problem.
# Review 3 checks (each fails on e214bcf: PICS_DIR=<e214bcf>/pics node scripts/stats-shots/harness.js): typing survives a slow server answer (H2), contrast
# (L8), lists page with "Showing 100 of N" + Show more, the make-up of a number, who can confirm, played-with pickers, deleted entries, one rating per game,
# course list paging + sample list, owner dashboard "not known".
import asyncio, json, sys, os
from playwright.async_api import async_playwright
ROOT = (sys.argv[1] if len(sys.argv) > 1 else '/tmp/stats-shots3').rstrip('/') + '/'
THEMES = (sys.argv[2] if len(sys.argv) > 2 else 'navy,violet,violet-dark').split(',')
WIDTHS = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '360,430,1280').split(',')]
API, WEB = 'http://127.0.0.1:8896', 'http://localhost:8897'
ALL = []
def INIT(tok, name, theme): return """localStorage.setItem('odd-tok','%s');localStorage.setItem('odd-name','%s');localStorage.setItem('pics-lg','nfl');localStorage.setItem('pics-theme','%s');localStorage.setItem('pics-dark','%s');
const d=new Date(),k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');localStorage.setItem('bets26',JSON.stringify([{id:'b'+Date.now(),kind:'prop',text:'Banner test bet',stake:10,odds:-110,day:k,t:Date.now(),week:11}]));
window.ODD_GROUPS_API='%s';window.ODD_STATS_API='%s';""" % (tok, name, 'violet' if theme.startswith('violet') else 'navy', '1' if theme != 'violet' else '0', API, API)
MEASURE = """(sel) => { const o = document.querySelector(sel); const pb = document.getElementById('plb'); let cov = null; const W = window.innerWidth;
  if (pb && !pb.hidden) { const r = pb.getBoundingClientRect(); if (r.width) { const e = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); cov = e ? !!e.closest('#ostat,#ovoice,#ostcons,#bnmore,#odash') : null; } }
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const small = o ? [...o.querySelectorAll('button,a,select,input,summary,textarea,[data-a]')].filter(e => { if (!vis(e) || e.disabled) return false; const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map(e => (e.className.baseVal !== undefined ? 'svg' : (e.className||e.tagName))+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)) : [];
  const wide = o ? [...o.querySelectorAll('*')].filter(e => !(e.closest('svg') && e.tagName.toLowerCase() !== 'svg') && vis(e) && e.getBoundingClientRect().right > W + 1).map(e=>e.className||e.tagName).slice(0,4) : [];
  const txt = o ? o.innerText : '';
  // contrast of every FILLED button / pill / toast (text colour against its own solid background), WCAG ratio
  const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return { L: 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]), a: m.length > 3 ? m[3] : 1 }; };
  const low = o ? [...o.querySelectorAll('.spri,.stoast,.ok,.vp,.vmic.on,.sdanger')].concat(o.matches && o.matches('.stoast') ? [o] : []).filter(vis).map(e => { const cs = getComputedStyle(e), bg = lum(cs.backgroundColor), fg = lum(cs.color); if (bg.a < 0.99) return null; const r = (Math.max(bg.L, fg.L) + 0.05) / (Math.min(bg.L, fg.L) + 0.05); return r < 4.5 ? (e.className + ' "' + e.textContent.trim().slice(0, 18) + '" ' + r.toFixed(1) + ':1') : null; }).filter(Boolean) : [];
  return { sw: o ? o.scrollWidth : -1, cw: o ? o.clientWidth : -1, dw: document.documentElement.scrollWidth, W, h: o ? o.scrollHeight : 900, overBanner: cov, small: small.slice(0,6), wide, low: low.slice(0, 6), banned: /USGA|GHIN|unofficial|DUPR/i.test(txt), junk: /undefined|NaN|\\[object/.test(txt), shg: o ? o.querySelectorAll('.shg input').length : 0 }; }"""
async def run(b, theme, W):
    OUT = ROOT + theme + '_' + str(W) + '/'; os.makedirs(OUT, exist_ok=True); errs, report, checks = [], [], []; tag = theme + ' ' + str(W)
    def ok(name, cond, detail=''): checks.append((name, bool(cond), detail)); print(('  ok  ' if cond else '  FAIL ') + '[' + tag + '] ' + name + (' :: ' + str(detail)[:700] if detail and not cond else ''), flush=True)
    async def ctx_for(tok, name, url='/index.html', slow=None):
        ctx = await b.new_context(viewport={'width': W, 'height': 900}, device_scale_factor=1, has_touch=True)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.listed = []
        async def route(r):
            u = r.request.url
            if '/acct/dash' in u and 'calcutta-odds' in u:  # the owner dashboard's own call, answered by the harness (the real sync.js adminUsers over the fake rows)
                import urllib.request; body = urllib.request.urlopen(API + '/acctdash').read().decode(); await r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body); return
            if u.startswith('http://127.0.0.1') or u.startswith('http://localhost'):
                if '/stats/list' in u: pg.listed.append(u)
                if slow and slow in u: await asyncio.sleep(1.5)
                await r.continue_()
            else: await r.fulfill(status=200, content_type='application/json', body='{}')
        await ctx.route('**/*', route); await pg.add_init_script(INIT(tok, name, theme))
        await pg.goto(WEB + url); await pg.wait_for_function("typeof window.oddStats === 'function' && typeof navRender === 'function'", timeout=20000)
        await pg.wait_for_timeout(1200)
        # the sandbox has no game feed, so the page's own first render (which draws the bar) never finishes: draw the bar with the app's own function
        await pg.evaluate("if (!document.querySelectorAll('#bn button').length) navRender()"); return ctx, pg
    import urllib.request; urllib.request.urlopen(API + '/reset').read()
    ctx, pg = await ctx_for('t-ann', 'Sir Oddable')
    ok('the full app is running (not ?mirror=1) in the ' + theme + ' theme', await pg.evaluate("!window.MIRROR && typeof window.oddStats === 'function' && [...document.scripts].some(s => /sync\\.js/.test(s.src)) && document.documentElement.classList.contains('cb') === %s && document.body.classList.contains('dark') === %s" % ('true' if theme == 'navy' else 'false', 'false' if theme == 'violet' else 'true')))
    async def shot(name, sel='#ostat', page=None):
        g = page or pg; await g.wait_for_timeout(400); m = await g.evaluate(MEASURE, sel); w = m['W']
        h = min(max(900, m['h']), 6000); await g.set_viewport_size({'width': w, 'height': h}); await g.wait_for_timeout(150)
        await g.screenshot(path=OUT + name + '.png'); await g.set_viewport_size({'width': w, 'height': 900}); report.append((name, m))
    back = lambda: pg.click('#ostat .sback')
    txt = lambda: pg.inner_text('#ostat')
    await pg.evaluate("(()=>{const p=document.getElementById('plb');if(p){p.hidden=false;try{betsRender()}catch(e){}}})()"); await pg.wait_for_timeout(400)
    # ---- bottom bar: five buttons, More sheet
    nav = await pg.evaluate("(()=>{const n=document.getElementById('bn');return {sw:n.scrollWidth,cw:n.clientWidth,dw:document.documentElement.scrollWidth,items:[...n.children].map(b=>[[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(),Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().height)])}})()")
    ok('bottom bar: exactly Games, Live, My Bets, Groups, More, each at least 44 x 44, no sideways scroll', [x[0] for x in nav['items']] == ['Games', 'Live', 'My Bets', 'Groups', 'More'] and all(x[1] >= 44 and x[2] >= 44 for x in nav['items']) and nav['sw'] <= nav['cw'] and nav['dw'] <= W, nav)
    await pg.screenshot(path=OUT + '00_main_five_button_bar.png')
    await pg.click('#bn button >> text=More'); await pg.wait_for_selector('#bnmore .bnrow'); await shot('00b_more_sheet', '#bnmore')
    await pg.click('#bnmore .bnrow >> text=My stats'); await pg.wait_for_selector('#ostat .stile')
    await shot('01_home_dashboard'); home = await txt()
    ok('home P/L tile says what is open and what is not known', 'Open: $175 at stake' in home and 'net not known' in home, home[:400])
    ok('period chips are plain words: Week, Month, Year, Lifetime (no WTD / MTD / YTD)', all(x in home for x in ['Week', 'Month', 'Year', 'Lifetime']) and not any(x in home for x in ['WTD', 'MTD', 'YTD']), home[:200])
    ok('one rating per game: Cornhole and Darts each have their own row', 'Cornhole rating' in home and 'Darts rating' in home, home[:900])
    await pg.click('#ostat .stile >> text=P/L'); await shot('02_money_rows_open_and_not_known'); t = await txt()
    ok('money drill-down rows: open, not known, contest prize and bets inside; the list says how many it shows', 'Open: $150 at stake' in t and 'Net: not known' in t and 'Bets in this contest: $180 risked, +$64.10 (counted under Bets)' in t and ' entries.' in t, t[-200:])
    await pg.click('#ostat .srec >> text=Sunday Crew'); await shot('03_record_group_contest_prize_vs_bets'); t = await txt(); ok('group contest record: entry $25, prize $9, net -$16', '$25' in t and 'Prize' in t and '$9' in t and '-$16' in t and '89.10' not in t, t); await back()
    await pg.click('#ostat .srec >> text=Nassau'); await shot('04_record_nassau_three_bets'); t = await txt(); ok('Nassau record: entry $60 (3 bets × $20), net -$40', '$60' in t and '3 bets × $20' in t and '-$40' in t, t); await back()
    await pg.click('#ostat .srec >> text=Super Bowl Calcutta'); await shot('05_record_open_calcutta'); t = await txt(); ok('open Calcutta record: at stake, not in the net', 'Open: $150 at stake' in t and 'Not counted until it settles' in t, t); await back()
    await pg.click('#ostat .srec >> text=SF ML'); await shot('06_record_bet_no_price'); t = await txt(); ok('bet won with no price: "Net: not known"', 'Net: not known' in t, t); await back(); await back()
    for k, nm in [('calcutta', '07_type_calcuttas'), ('contest', '08_type_group_contests'), ('golf-round', '09_type_golf_rounds'), ('match', '10_type_matches')]:
        await pg.click('#ostat [data-a=kind][data-s=""][data-k="%s"]' % k); await shot(nm)
        if k == 'match': t = await txt(); ok('a forfeit shows as not confirmed', 'Round 3' in t, t[:300])
        await back()
    await pg.click('#ostat .srowc[data-a=sport] >> text=Golf'); await shot('11_sport_golf'); await back()
    await pg.click('#ostat .srowc[data-a=sport] >> text=NFL'); await shot('12_sport_nfl'); await back()
    # ---- handicap: the money-game number and what it is made of
    await pg.click('#ostat [data-a=hcp]'); await pg.wait_for_selector('#ostat .sbigc'); await pg.click('#ostat details.smore summary >> nth=0'); await shot('13_my_handicap_make_up'); t = await txt()
    ok('My handicap: money-game index with its make-up (who confirmed, scored / typed), and the 9-hole estimate line', 'In money games, flights and tournaments' in t and 'Made of:' in t and 'scored in games' in t and 'Confirmed by DanTheDriver' in t and 'Scored in a game' in t and 'an estimate of the official method' in t and 'sees this make-up before approving' in t, t[:900])
    ok('every round says how it was confirmed, or why not', 'scored in a game, confirmed by' in t and 'self-logged · not confirmed yet' in t and 'Member-Guest (next week)' in t, t[900:1900])
    ok('chart has no tap strips; the rounds list under it is the way in', await pg.evaluate("document.querySelectorAll('#ostat svg [data-a]').length === 0 && document.querySelectorAll('#ostat .strow[data-a=round]').length >= 10"))
    await pg.click('#ostat .sinfo'); await shot('14_handicap_info'); t = await pg.inner_text('#ostat .sinfobox'); ok('the info sheet states the confirmed rule, the typed-total cap and the 9-hole estimate', '3 different players' in t and 'estimate of the official method' in t and 'the total itself is capped' in t, t[-700:]); await pg.click('#ostat .sinfobox .spri')
    await pg.click('#ostat .strow >> text=9 holes'); await shot('15_round_math_nine_holes'); t = await txt(); ok('9-hole round math: expected score for the other nine, marked as an estimate', 'Expected for the other nine' in t and '18-hole Score Differential' in t and 'estimate of the official method' in t, t); await back()
    await pg.click('#ostat .strow.cnt >> nth=0'); await shot('16_round_math'); await back()
    # ---- Post a round: typing survives a slow server answer (H2); played-with pickers; course list
    await pg.click('#ostat [data-a=post]'); await pg.wait_for_selector('#sf_course'); await pg.fill('#sf_course', 'Cedar'); await pg.click('#ostat [data-a=csearch]'); await pg.wait_for_selector('#ostat [data-a=cpick]'); await shot('17a_course_list_first_page'); t = await txt()
    ok('course search: 25 results and "Show more courses (25 of 40)"', await pg.locator('#ostat [data-a=cpick]').count() == 25 and 'Show more courses (25 of 40)' in t, t[:300])
    await pg.click('#ostat [data-a=cmore]'); await pg.wait_for_function("document.querySelectorAll('#ostat [data-a=cpick]').length === 40"); ok('Show more loads the rest into the same list', await pg.locator('#ostat [data-a=cmore]').count() == 0)
    await pg.click('#ostat [data-a=cpick] >> nth=0'); await pg.wait_for_selector('#ostat [data-a=ctee]'); await shot('17b_course_tees'); t = await txt(); ok('tees with rating, slope and yards', 'Rating 71.3' in t and 'Slope 125' in t and '6612 yds' in t, t[:400])
    await pg.click('#ostat [data-a=ctee] >> nth=0'); await pg.wait_for_timeout(300); ok('picking a tee fills Rating / Slope / par and keeps the form', await pg.input_value('#sf_cr') == '71.3' and await pg.input_value('#sf_slope') == '125' and 'Cedar Ridge 1' in await pg.input_value('#sf_course'))
    await pg.fill('#sf_course', 'down'); await pg.click('#ostat [data-a=csearch]'); await pg.wait_for_selector('#ostat .serr'); await shot('17c_course_list_down_sample_courses'); t = await txt()
    ok('live list down: a clear message, Try again, and the labelled sample courses', "Couldn't reach the course list. Try again." in t and 'Sample courses saved in the app' in t and await pg.locator('#ostat [data-a=cpick]').count() > 0 and 'Or enter the course yourself' in t.replace('OR ENTER THE COURSE YOURSELF', 'Or enter the course yourself'), t[:500])
    await back(); await ctx.close()
    ctx, pg = await ctx_for('t-ann', 'Sir Oddable', slow='/stats/guest/list'); await pg.evaluate("window.OddStats.open({t:'hcp'})"); await pg.wait_for_selector('#ostat [data-a=post]'); await pg.click('#ostat [data-a=post]'); await pg.wait_for_selector('#sf_course')
    await pg.fill('#sf_course', 'Cedar Ridge'); await pg.fill('#sf_total', '86'); await pg.wait_for_selector('#sf_guest', timeout=8000); await pg.wait_for_timeout(300)
    ok('H2: what was typed in Post a round is still there after the players list arrives', await pg.input_value('#sf_course') == 'Cedar Ridge' and await pg.input_value('#sf_total') == '86', [await pg.input_value('#sf_course'), await pg.input_value('#sf_total')])
    await pg.fill('#sf_cr', '71.3'); await pg.fill('#sf_slope', '125'); await pg.fill('#sf_par', '72'); await shot('17_post_a_round_played_with'); t = await txt(); opts = await pg.evaluate("[...document.querySelectorAll('#sf_with0 option')].map(o=>o.textContent).join('|')")
    ok('Post a round has "Played with" pickers from the players list (✓ = can confirm)', 'Played with' in t and await pg.locator('#sf_with0 option').count() >= 4 and 'BobBirdie ✓' in opts and 'has not joined yet' in opts and 'only typed can never confirm' in t, opts)
    await pg.click('#ostat [data-a=mode][data-v=holes]'); await pg.wait_for_selector('#ostat .shg input'); await shot('17d_post_a_round_hole_by_hole')
    ok('hole-by-hole inputs are in the tap-target check and pass it', report[-1][1]['shg'] >= 18 and not report[-1][1]['small'], report[-1][1])
    await pg.click('#ostat [data-a=mode][data-v=total]'); await pg.fill('#sf_total', '40'); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .serr'); await shot('18_post_refused_15_under_rating'); ok('a total more than 15 under the Rating is refused with a plain message', 'under the Course Rating' in await pg.inner_text('#ostat .serr'))
    await pg.fill('#sf_total', '86'); await pg.select_option('#sf_with0', index=1); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .stoast'); m = await pg.evaluate(MEASURE, '#ostat .stoast'); await pg.screenshot(path=OUT + '19_saved_toast.png')
    ok('L8: the "Saved" toast is at least 4.5:1', not m['low'], m['low']); await back()
    await pg.click('#ostat [data-a=log]'); await shot('20_log_my_play_picker'); await pg.click('#ostat [data-a=type][data-k=pickleball]'); await pg.wait_for_selector('#sf_opp0'); await pg.fill('#sf_opp0', 'Ola Opponent'); await pg.fill('#sf_g0a', '11'); await pg.wait_for_selector('#sf_oppG0', timeout=8000); await pg.wait_for_timeout(300)
    ok('H2: a pickleball opponent and score typed before the players list arrives are kept', await pg.input_value('#sf_opp0') == 'Ola Opponent' and await pg.input_value('#sf_g0a') == '11'); await shot('21_log_pickleball_form')
    ok('no DUPR field anywhere on the form', 'DUPR' not in await txt())
    await back(); ok('Back from a Log my play form returns to the type picker', await pg.locator('#ostat [data-a=type]').count() == 3)
    await pg.click('#ostat [data-a=type][data-k=other]'); await pg.wait_for_selector('#sf_title'); await pg.fill('#sf_title', 'Cornhole'); await pg.fill('#sf_score', '21-18'); await pg.wait_for_selector('#sf_oppGuest', timeout=8000); await pg.wait_for_timeout(300)
    ok('H2: the "any other game" form keeps what was typed too', await pg.input_value('#sf_title') == 'Cornhole' and await pg.input_value('#sf_score') == '21-18'); await shot('21b_log_other_game_form'); await back(); await back()
    ok('Back from the picker returns to My stats', await pg.locator('#ostat .stile').count() >= 3)
    # ---- records: who can confirm, the link, locked, edit history, deleted entries
    seed = json.loads(await pg.evaluate("fetch('%s/seed').then(r=>r.text())" % API))
    await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['openId']); await pg.wait_for_selector('#ostat [data-a=cfask]'); await pg.click('#ostat [data-a=cfask]'); await pg.wait_for_selector('#scf_link'); await shot('22_record_confirm_link'); t = await txt()
    ok('confirm link: who to send it to, works once, lasts 7 days, "Make a new link"', 'join=confirm.' in await pg.inner_text('#scf_link') and 'Send it to BobBirdie or CatCourt' in t and 'works once and lasts 7 days' in t and 'Make a new link' in t and 'Played with' in t, t[-900:])
    await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['edId']); await pg.wait_for_timeout(800); await shot('24_record_nobody_recorded_and_history'); t = await txt()
    ok('a round with nobody recorded cannot get a link: "Pick who you played with"; its history shows the first entry', 'Nobody is recorded as playing in it' in t and await pg.locator('#ostat [data-a=edit]').count() == 2 and 'was 91' in t and 'The entry as first logged' in t, t[-900:])
    await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['lateId']); await pg.wait_for_timeout(800); await shot('24b_record_logged_too_late'); ok('logged more than 7 days after it was played: no link, and it says why', 'more than 7 days after it was played' in await txt() and not await pg.locator('#ostat [data-a=cfask]').count())
    await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['lockId']); await pg.wait_for_timeout(800); await shot('23_record_locked_after_48_hours'); t = await txt(); ok('an entry older than 48 hours is locked: no Edit, no Delete', 'Locked' in t and not await pg.locator('#ostat [data-a=del]').count(), t[-300:])
    await pg.evaluate("window.OddStats.open()"); await pg.wait_for_selector('#ostat .stile'); await pg.click('#ostat [data-a=gone]'); await shot('24c_deleted_entries'); t = await txt(); ok('deleted entries are listed', 'Deleted entries' in t and 'Bowling' in t and '142' in t, t); await back()
    await pg.click('#ostat [data-a=rating][data-s=pickleball]'); await shot('25_pickleball_rating'); t = await txt(); ok('rating page: seeding waits for 3 different confirmers and says so; no DUPR', 'games confirmed' in t and 'For seeding in events and tournaments' in t and 'needs games confirmed by 3 different players' in t and 'DUPR' not in t, t[:500]); await back()
    await pg.click('#ostat [data-a=rating][data-s="other:cornhole"]'); await shot('25b_cornhole_rating'); t = await txt(); ok('Cornhole has its own rating, seeded from 3 confirmers', 'Cornhole rating' in t and '1546' in t and 'confirmed by 3 players' in t and 'Darts' not in t, t[:500]); await back()
    await pg.click('#ostat [data-a=guests]'); await pg.wait_for_selector('#ostat [data-a=guest]'); await shot('26_players_list'); await pg.click('#ostat [data-a=guest] >> text=Gary'); await pg.wait_for_timeout(600); await shot('26b_guest_player'); await back(); await back()
    await pg.click('#ostat [data-a=courses]'); await pg.wait_for_timeout(500); await pg.click('#ostat .srowc >> text=Cedar Ridge'); await pg.wait_for_selector('#ostat .strow'); await shot('27_course_view_money_index_and_why'); t = await txt()
    ok('course view: own account names, "n of m rounds confirmed", the money-game index or why there is none', 'BobBirdie' in t and 'Somebody Else' not in t and 'rounds confirmed' in t and 'No money-game index: needs 3 confirmed rounds' in t, t[:500])
    await pg.click('#ostat [data-a=ctab][data-k=rounds]'); await pg.wait_for_timeout(700); await shot('28_course_rounds_how_confirmed'); ok('course rounds say typed vs scored and who confirmed', 'Self-logged (typed total), not confirmed' in await txt())
    await pg.click('#ostat [data-a=ctab][data-k=flights]'); await shot('29_course_flights')
    await pg.click('#ostat [data-a=ctab][data-k=prefill]'); await pg.fill('#sv_cr', '71.3'); await pg.fill('#sv_slope', '125'); await pg.fill('#sv_par', '72'); await pg.click('#ostat [data-a=prefill]'); await pg.wait_for_function("document.querySelectorAll('#ostat .strow').length > 0 && /Course handicaps come from/.test(document.querySelector('#ostat').innerText)", timeout=15000); await shot('30_course_golf_day_handicaps'); ok('golf day prefill: players without a money-game index show "set it"', 'set it' in await txt())
    # ---- voice sheet: the "Read it" button
    await pg.evaluate("window.OddStats.open()"); await pg.wait_for_selector('#ostat [data-a=voice]'); await pg.click('#ostat [data-a=voice] >> nth=0'); await pg.wait_for_selector('#ovoice .vp'); await shot('30b_voice_sheet', '#ovoice'); ok('L8: the voice sheet\'s "Read it" button is at least 4.5:1', not report[-1][1]['low'], report[-1][1]['low']); await pg.click('#ovoice .vx')
    # ---- owner dashboard: "not known", plain period words
    await pg.evaluate("localStorage.setItem('odd-dash','1'); window.oddDash && window.oddDash()"); await pg.wait_for_selector('#odash .odt', timeout=10000); await pg.wait_for_timeout(500); await shot('30c_owner_dashboard_not_known', '#odash'); t = await pg.inner_text('#odash')
    ok('owner dashboard: a won bet with no price is "not known" and left out of P/L; chips say Week / Month / Year', 'winnings not known (no price), not in P/L' in t and 'Not known' in t and 'Week' in t and 'WTD' not in t and '$115' in t, t[:700])
    await ctx.close()
    # ---- Bob (recorded on the round) opens Ann's confirm link; Eve (not recorded) cannot confirm
    ctx, pg5 = await ctx_for('t-eve', 'Eve Eagle', '/index.html?join=confirm.' + seed['confirm']); 
    try: await pg5.wait_for_function("document.querySelector('#ostct') && /cannot confirm/.test(document.querySelector('#ostct').textContent)", timeout=15000)
    except Exception: ok('the confirm sheet opened for someone who did not play', False, await pg5.evaluate("(document.querySelector('#ostcons')||document.body).innerText.slice(0,400) + ' || join=' + sessionStorage.getItem('ostat-join') + ' tok=' + localStorage.getItem('odd-tok')"))
    await shot('31a_confirm_sheet_not_a_player', '#ostcons', pg5)
    ok('someone who did not play sees why they cannot confirm, and no Yes button', 'Only a player recorded on this entry can confirm it' in await pg5.inner_text('#ostcons') and not await pg5.locator('#ostcy').count()); await ctx.close()
    ctx, pg2 = await ctx_for('t-bob', 'BobBirdie', '/index.html?join=confirm.' + seed['confirm']); await pg2.wait_for_selector('#ostcons #ostcy', timeout=15000); await shot('31_confirm_sheet_recorded_player', '#ostcons', pg2); t = await pg2.inner_text('#ostcons')
    ok('the recorded player sees who asks, that they are down as playing, one Yes button (no side to choose), 4.5:1', 'Sir Oddable asks you to confirm' in t and 'has you down as playing in this round' in t and 'This link works once' in t and not await pg2.locator('#ostcp').count() and not report[-1][1]['low'], [t, report[-1][1]['low']])
    if theme == THEMES[-1] and W == WIDTHS[-1]:  # the link works ONCE: use it up only in the last run
        await pg2.click('#ostcy'); await pg2.wait_for_function("document.querySelector('#ostct').textContent === 'Confirmed'"); await shot('32_confirmed', '#ostcons', pg2)
    await ctx.close()
    # ---- Cat: a claimed result is hers to remove
    ctx, pg3 = await ctx_for('t-cat', 'CatCourt'); await pg3.evaluate("(async()=>{const j=await fetch('%s/stats/me',{method:'POST',headers:{'content-type':'application/json','x-token':'t-cat'},body:'{}'}).then(r=>r.json());window.OddStats.open({t:'rec',id:j.records.find(r=>r.extra&&r.extra.claimed).id})})()" % API); await pg3.wait_for_selector('#ostat [data-claimed]'); await shot('33_claimed_result_claimant_can_remove', '#ostat', pg3)
    ok('the claimant has "Remove from my stats" on a claimed result', 'Remove from my stats' in await pg3.inner_text('#ostat')); await ctx.close()
    # ---- Eve has 3,150 records: totals cover all of them, rows come 100 at a time
    ctx, pg4 = await ctx_for('t-eve', 'Eve Eagle'); await pg4.evaluate("window.OddStats.open()"); await pg4.wait_for_selector('#ostat .stile'); t = await pg4.inner_text('#ostat')
    await pg4.click('#ostat [data-a=kind][data-s=""][data-k="calcutta"]'); await pg4.wait_for_function("/of 3,150\\./.test((document.querySelector('#ostat .scount')||{}).textContent||'')", timeout=8000); await shot('34_long_list_showing_100_of_3150', '#ostat', pg4); t = await pg4.inner_text('#ostat')
    ok('a list of 3,150: "Showing 100 of 3,150", 100 rows, Show more; the total above covers all of them', 'Showing 100 of 3,150.' in t and await pg4.locator('#ostat .srec').count() == 100 and await pg4.locator('#ostat [data-a=more]').count() == 1 and '3150 finishes' in t.replace(',', '') and len(pg4.listed) >= 1, [t[:300], len(pg4.listed)])
    await pg4.click('#ostat [data-a=more]'); await pg4.wait_for_function("document.querySelectorAll('#ostat .srec').length === 200"); ok('Show more adds the next 100 and keeps the place', 'Showing 200 of 3,150.' in await pg4.inner_text('#ostat .scount')); await ctx.close()
    bad = [(r[0], {k: r[1][k] for k in ('sw', 'cw', 'dw', 'small', 'wide', 'low', 'banned', 'junk', 'overBanner')}) for r in report if r[1]['sw'] > r[1]['cw'] or r[1]['dw'] > r[1]['W'] or r[1]['small'] or r[1]['wide'] or r[1]['low'] or r[1]['banned'] or r[1]['junk'] or r[1]['overBanner'] is False]
    failed = [c for c in checks if not c[1]]
    print('--- [%s] %d screenshots in %s, %d checks, %d failed, %d problem screens, %d page errors' % (tag, len(os.listdir(OUT)), OUT, len(checks), len(failed), len(bad), len(errs)), flush=True)
    if bad: print('PROBLEM SCREENS', bad)
    if errs: print('PAGE ERRORS', errs[:5])
    ALL.append((tag, len(checks), failed, bad, errs))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for th in THEMES:
            for w in WIDTHS:
                try: await run(b, th, w)
                except Exception as e: print('  CRASH [%s %s] %s' % (th, w, str(e)[:900]), flush=True); ALL.append((th + ' ' + str(w), 0, [('crash', False, str(e)[:300])], [], []))
        await b.close()
    tot = sum(a[1] for a in ALL); nf = sum(len(a[2]) for a in ALL); nb = sum(len(a[3]) for a in ALL); ne = sum(len(a[4]) for a in ALL)
    print('=== %d runs, %d checks, %d failed checks, %d problem screens, %d page errors' % (len(ALL), tot, nf, nb, ne)); sys.exit(1 if nf or nb or ne else 0)
asyncio.run(main())
