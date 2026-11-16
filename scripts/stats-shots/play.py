# Phone screenshots + layout checks for My stats. Needs: node scripts/stats-shots/harness.js running. Output: /tmp/stats-shots2 (or argv[1]).
# Runs the FULL app (pics/index.html with gate.js, sync.js, groups.js, dash.js, voicelog.js, stats.js loaded by the page itself, never ?mirror=1).
# Every screenshot is checked: no sideways scroll, every tap target at least 44 x 44 px (hole-grid inputs INCLUDED), nothing wider than the screen,
# the floating My Bets banner covered by the overlay, no "USGA / GHIN / unofficial / DUPR" wording. Extra checks at the end; exit code 1 on any problem.
import asyncio, json, sys, os
from playwright.async_api import async_playwright
OUT = (sys.argv[1] if len(sys.argv) > 1 else '/tmp/stats-shots2').rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)
API, WEB = 'http://127.0.0.1:8896', 'http://localhost:8897'
errs, report, checks = [], [], []
def INIT(tok, name): return """localStorage.setItem('odd-tok','%s');localStorage.setItem('odd-name','%s');localStorage.setItem('pics-lg','nfl');
const d=new Date(),k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');localStorage.setItem('bets26',JSON.stringify([{id:'b'+Date.now(),kind:'prop',text:'Banner test bet',stake:10,odds:-110,day:k,t:Date.now(),week:11}]));
window.ODD_GROUPS_API='%s';window.ODD_STATS_API='%s';""" % (tok, name, API, API)
MEASURE = """(sel) => { const o = document.querySelector(sel); const pb = document.getElementById('plb'); let cov = null; const W = window.innerWidth;
  if (pb && !pb.hidden) { const r = pb.getBoundingClientRect(); if (r.width) { const e = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); cov = e ? !!e.closest('#ostat,#ovoice,#ostcons,#bnmore') : null; } }
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const small = o ? [...o.querySelectorAll('button,a,select,input,summary,textarea,[data-a]')].filter(e => { if (!vis(e) || e.disabled) return false; const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map(e => (e.className.baseVal !== undefined ? 'svg' : (e.className||e.tagName))+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)) : [];
  const wide = o ? [...o.querySelectorAll('*')].filter(e => vis(e) && e.getBoundingClientRect().right > W + 1).map(e=>e.className||e.tagName).slice(0,4) : [];
  const txt = o ? o.innerText : '';
  return { sw: o ? o.scrollWidth : -1, cw: o ? o.clientWidth : -1, dw: document.documentElement.scrollWidth, W, h: o ? o.scrollHeight : 900, overBanner: cov, small: small.slice(0,6), wide, banned: /USGA|GHIN|unofficial|DUPR/i.test(txt), shg: o ? o.querySelectorAll('.shg input').length : 0 }; }"""
def ok(name, cond, detail=''): checks.append((name, bool(cond), detail)); print(('  ok  ' if cond else '  FAIL ') + name + (' :: ' + str(detail) if detail and not cond else ''), flush=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctx_for(tok, name, w=430, url='/index.html'):
            ctx = await b.new_context(viewport={'width': w, 'height': 900}, device_scale_factor=1, has_touch=True)
            pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            async def route(r):
                u = r.request.url
                if u.startswith('http://127.0.0.1') or u.startswith('http://localhost'): await r.continue_()
                else: await r.fulfill(status=200, content_type='application/json', body='{}')
            await ctx.route('**/*', route); await pg.add_init_script(INIT(tok, name))
            await pg.goto(WEB + url); await pg.wait_for_function("typeof window.oddStats === 'function' && typeof navRender === 'function'", timeout=20000)
            await pg.wait_for_timeout(1500)
            # the sandbox has no game feed, so the page's own first render (which draws the bar) never finishes: draw the bar with the app's own function
            await pg.evaluate("if (!document.querySelectorAll('#bn button').length) navRender()"); return ctx, pg
        ctx, pg = await ctx_for('t-ann', 'Sir Oddable')
        ok('the full app is running (not ?mirror=1): gate, sync, groups and stats scripts loaded by the page', await pg.evaluate("!window.MIRROR && typeof window.oddStats === 'function' && [...document.scripts].some(s => /sync\\.js/.test(s.src)) && [...document.scripts].some(s => /gate\\.js/.test(s.src))"))
        async def shot(name, sel='#ostat', page=None):
            g = page or pg; await g.wait_for_timeout(450); m = await g.evaluate(MEASURE, sel); w = m['W']
            h = min(max(900, m['h']), 6000); await g.set_viewport_size({'width': w, 'height': h}); await g.wait_for_timeout(200)
            await g.screenshot(path=OUT + name + '.png'); await g.set_viewport_size({'width': w, 'height': 900}); report.append((name, m)); print(name, {k: m[k] for k in ('sw', 'cw', 'dw', 'overBanner', 'small', 'wide', 'banned', 'shg')}, flush=True)
        back = lambda: pg.click('#ostat .sback')
        await pg.evaluate("(()=>{const p=document.getElementById('plb');if(p){p.hidden=false;try{betsRender()}catch(e){}}})()"); await pg.wait_for_timeout(500)
        # ---- bottom bar: five buttons, More sheet
        nav = await pg.evaluate("(()=>{const n=document.getElementById('bn');return {sw:n.scrollWidth,cw:n.clientWidth,items:[...n.children].map(b=>[[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(),Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().height)])}})()")
        ok('bottom bar has exactly five buttons: Games, Live, My Bets, Groups, More', [x[0] for x in nav['items']] == ['Games', 'Live', 'My Bets', 'Groups', 'More'], nav)
        ok('every bottom-bar button is at least 44 x 44 at 430px, no sideways scroll', all(x[1] >= 44 and x[2] >= 44 for x in nav['items']) and nav['sw'] <= nav['cw'], nav)
        await pg.screenshot(path=OUT + '00_main_five_button_bar.png')
        await pg.click('#bn button >> text=More'); await pg.wait_for_selector('#bnmore .bnrow'); rows = await pg.evaluate("[...document.querySelectorAll('#bnmore .bnrow')].map(b=>[b.querySelector('b').textContent,Math.round(b.getBoundingClientRect().height)])")
        ok('More sheet holds Survivor, Winning, Losing, My stats (and Dashboard for the owner), each 44px or taller', [r[0] for r in rows][:4] == ['Survivor', 'Winning', 'Losing', 'My stats'] and all(r[1] >= 44 for r in rows), rows)
        await shot('00b_more_sheet', '#bnmore')
        await pg.evaluate("localStorage.setItem('odd-dash','1')"); await pg.click('#bnmore .bnx'); await pg.click('#bn button >> text=More'); rows2 = await pg.evaluate("[...document.querySelectorAll('#bnmore .bnrow b')].map(b=>b.textContent)"); ok('the owner also gets Dashboard in More', rows2[-1] == 'Dashboard', rows2); await shot('00c_more_sheet_owner', '#bnmore')
        await pg.click('#bnmore .bnrow >> text=My stats'); await pg.wait_for_selector('#ostat .stile'); ok('More > My stats opens the dashboard and closes the sheet', await pg.evaluate("!document.getElementById('bnmore') && !!document.getElementById('ostat')"))
        await shot('01_home_dashboard'); home = await pg.inner_text('#ostat')
        ok('home P/L tile says what is open and what is not known', 'Open: $175 at stake' in home and 'net not known' in home, home[:400])
        ok('home handicap card shows confirmed rounds', 'rounds confirmed' in home and 'games confirmed' in home)
        await pg.click('#ostat .stile >> text=P/L'); await shot('02_money_rows_open_and_not_known'); txt = await pg.inner_text('#ostat')
        ok('money drill-down rows: "Open: $150 at stake", "Net: not known", contest prize and bets inside', 'Open: $150 at stake' in txt and 'Net: not known' in txt and 'Bets in this contest: $180 risked, +$64.10 (counted under Bets)' in txt and 'Group bet' in txt, txt[:300])
        await pg.click('#ostat .srec >> text=Sunday Crew'); await shot('03_record_group_contest_prize_vs_bets'); t = await pg.inner_text('#ostat'); ok('group contest record: entry $25, prize $9, net -$16; never $89.10', '$25' in t and 'Prize' in t and '$9' in t and '-$16' in t and '89.10' not in t, t); await back()
        await pg.click('#ostat .srec >> text=Nassau'); await shot('04_record_nassau_three_bets'); t = await pg.inner_text('#ostat'); ok('Nassau record: entry $60 (3 bets × $20), net -$40', '$60' in t and '3 bets × $20' in t and '-$40' in t, t); await back()
        await pg.click('#ostat .srec >> text=Super Bowl Calcutta'); await shot('05_record_open_calcutta'); t = await pg.inner_text('#ostat'); ok('open Calcutta record: at stake, not in the net', 'Open: $150 at stake' in t and 'Not counted until it settles' in t, t); await back()
        await pg.click('#ostat .srec >> text=SF ML'); await shot('06_record_bet_no_price'); t = await pg.inner_text('#ostat'); ok('bet won with no price: "Net: not known"', 'Net: not known' in t, t); await back(); await back()
        for k, nm in [('calcutta', '07_type_calcuttas'), ('contest', '08_type_group_contests'), ('golf-round', '09_type_golf_rounds'), ('match', '10_type_matches')]:
            await pg.click('#ostat [data-a=kind][data-s=""][data-k="%s"]' % k); await shot(nm); await back()
        await pg.click('#ostat .srowc[data-a=sport] >> text=Golf'); await shot('11_sport_golf'); await back()
        await pg.click('#ostat .srowc[data-a=sport] >> text=NFL'); await shot('12_sport_nfl'); await back()
        # ---- handicap
        await pg.click('#ostat [data-a=hcp]'); await pg.wait_for_selector('#ostat .sbigc'); await shot('13_my_handicap_confirmed'); t = await pg.inner_text('#ostat')
        ok('My handicap: "x · n of 20 rounds confirmed", the money-game index, self-logged marks, tournament card with its log', 'of 20 rounds confirmed' in t and 'In money games, flights and tournaments' in t and 'self-logged, not confirmed' in t and 'scored in the app' in t and 'Member-Guest (next week)' in t and 'Paired with a guest' in t, t[:600])
        ok('chart has no tap strips; the rounds list under it is the way in', await pg.evaluate("document.querySelectorAll('#ostat svg [data-a]').length === 0 && document.querySelectorAll('#ostat .strow[data-a=round]').length >= 10"))
        await pg.click('#ostat .sinfo'); await shot('14_handicap_info'); await pg.click('#ostat .sinfobox .spri')
        await pg.click('#ostat .strow >> text=9 holes'); await shot('15_round_math_nine_holes'); t = await pg.inner_text('#ostat'); ok('9-hole round math shows the expected score for the other nine', 'Expected for the other nine' in t and '18-hole Score Differential' in t, t); await back()
        await pg.click('#ostat .strow.cnt >> nth=0'); await shot('16_round_math'); await back()
        await pg.click('#ostat [data-a=post]'); await pg.wait_for_selector('#sf_course'); await pg.fill('#sf_course', 'Cedar Ridge'); await pg.fill('#sf_cr', '71.3'); await pg.fill('#sf_slope', '125'); await pg.fill('#sf_par', '72')
        await pg.click('#ostat [data-a=mode][data-v=holes]'); await pg.wait_for_selector('#ostat .shg input'); await shot('17_post_a_round_hole_by_hole')
        ok('hole-by-hole inputs are in the tap-target check and pass it', report[-1][1]['shg'] >= 18 and not report[-1][1]['small'], report[-1][1])
        await pg.click('#ostat [data-a=mode][data-v=total]'); await pg.fill('#sf_total', '40'); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .serr'); await shot('18_post_refused_15_under_rating'); ok('a total more than 15 under the Rating is refused with a plain message', 'under the Course Rating' in await pg.inner_text('#ostat .serr'))
        await pg.fill('#sf_total', '86'); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .stoast'); await shot('19_after_post'); await back()
        # ---- log my play: back from a form returns to the type picker
        await pg.click('#ostat [data-a=log]'); await shot('20_log_my_play_picker'); await pg.click('#ostat [data-a=type][data-k=pickleball]'); await pg.wait_for_selector('#sf_opp0'); await shot('21_log_pickleball_form')
        ok('no DUPR field anywhere on the form', not await pg.locator('#sd_dupr').count() and 'DUPR' not in await pg.inner_text('#ostat'))
        await back(); ok('Back from a Log my play form returns to the type picker', await pg.locator('#ostat [data-a=type]').count() == 3 and 'Log my play' in await pg.inner_text('#ostat h1')); await back()
        ok('Back from the picker returns to My stats', await pg.locator('#ostat .stile').count() >= 3)
        # ---- records: confirm link, locked, edit history
        seed = await pg.evaluate("fetch('%s/seed').then(r=>r.json())" % API)
        await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['openId']); await pg.wait_for_selector('#ostat [data-a=cfask]'); await pg.click('#ostat [data-a=cfask]'); await pg.wait_for_selector('#scf_link'); await shot('22_record_get_it_confirmed')
        ok('a self-logged round offers a confirm link', 'join=confirm.' in await pg.inner_text('#scf_link'))
        await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['lockId']); await pg.wait_for_timeout(900); await shot('23_record_locked_after_48_hours'); t = await pg.inner_text('#ostat'); ok('an entry older than 48 hours is locked: no Edit, no Delete', 'Locked' in t and not await pg.locator('#ostat [data-a=edit]').count() and not await pg.locator('#ostat [data-a=del]').count(), t)
        await pg.evaluate("window.OddStats.open({t:'rec', id:'%s'})" % seed['edId']); await pg.wait_for_timeout(900); await shot('24_record_edit_history'); t = await pg.inner_text('#ostat'); ok('an edited entry shows its history (was 91)', 'CHANGES' in t.upper() and 'was 91' in t, t)
        await pg.evaluate("window.OddStats.open()"); await pg.wait_for_selector('#ostat .stile')
        await pg.click('#ostat [data-a=rating]'); await shot('25_pickleball_rating_confirmed'); t = await pg.inner_text('#ostat'); ok('rating page: "x · n of m games confirmed", seeding rating, no DUPR', 'games confirmed' in t and 'For seeding in events and tournaments' in t and 'DUPR' not in t, t[:300]); await back()
        await pg.click('#ostat [data-a=guests]'); await pg.wait_for_selector('#ostat [data-a=guest]'); await pg.click('#ostat [data-a=guest] >> nth=0'); await pg.wait_for_timeout(700); await shot('26_guest_player'); await back(); await back()
        await pg.click('#ostat [data-a=courses]'); await pg.wait_for_timeout(500); await pg.click('#ostat .srowc >> text=Cedar Ridge'); await pg.wait_for_selector('#ostat .strow'); await shot('27_course_view_confirmed_counts'); t = await pg.inner_text('#ostat')
        ok('course view: players under their own account names with "n of m rounds confirmed"', 'BobBirdie' in t and 'Somebody Else' not in t and 'rounds confirmed' in t and 'Confirmed index' in t, t[:400])
        await pg.click('#ostat [data-a=ctab][data-k=rounds]'); await pg.wait_for_timeout(800); await shot('28_course_rounds_self_logged_marked'); ok('course rounds mark self-logged', 'Self-logged, not confirmed' in await pg.inner_text('#ostat'))
        await pg.click('#ostat [data-a=ctab][data-k=flights]'); await shot('29_course_flights_confirmed_only')
        await pg.click('#ostat [data-a=ctab][data-k=prefill]'); await pg.fill('#sv_cr', '71.3'); await pg.fill('#sv_slope', '125'); await pg.fill('#sv_par', '72'); await pg.click('#ostat [data-a=prefill]'); await pg.wait_for_timeout(900); await shot('30_course_golf_day_handicaps'); ok('golf day prefill: confirmed players get a course handicap, the rest "set it"', 'set it' in await pg.inner_text('#ostat'))
        await ctx.close()
        # ---- Bob opens Ann's confirm link (the page reads ?join=confirm.<code> itself)
        ctx, pg2 = await ctx_for('t-bob', 'BobBirdie', 430, '/index.html?join=confirm.' + seed['confirm']); await pg2.wait_for_selector('#ostcons #ostcy', timeout=15000); await shot('31_confirm_sheet_other_player', '#ostcons', pg2)
        ok('the other player sees who asks and what they confirm', 'Sir Oddable asks you to confirm' in await pg2.inner_text('#ostcons')); await pg2.click('#ostcy'); await pg2.wait_for_function("document.querySelector('#ostct').textContent === 'Confirmed'"); await shot('32_confirmed', '#ostcons', pg2); await ctx.close()
        # ---- Cat: a claimed result is hers to remove
        ctx, pg3 = await ctx_for('t-cat', 'CatCourt'); await pg3.evaluate("navGo('stats')"); await pg3.wait_for_selector('#ostat .stile'); await pg3.click('#ostat .stile >> text=Record'); await pg3.wait_for_timeout(300)
        await pg3.evaluate("(async()=>{const j=await fetch('%s/stats/me',{method:'POST',headers:{'content-type':'application/json','x-token':'t-cat'},body:'{}'}).then(r=>r.json());window.OddStats.open({t:'rec',id:j.records.find(r=>r.extra&&r.extra.claimed).id})})()" % API); await pg3.wait_for_selector('#ostat [data-claimed]'); await shot('33_claimed_result_claimant_can_remove', '#ostat', pg3)
        ok('the claimant has "Remove from my stats" on a claimed result', 'Remove from my stats' in await pg3.inner_text('#ostat')); await ctx.close()
        # ---- 360px: bar and dashboard
        ctx, pg4 = await ctx_for('t-ann', 'Sir Oddable', 360); nav = await pg4.evaluate("(()=>{const n=document.getElementById('bn');return {sw:n.scrollWidth,cw:n.clientWidth,dw:document.documentElement.scrollWidth,items:[...n.children].map(b=>[Math.round(b.getBoundingClientRect().width),Math.round(b.getBoundingClientRect().height)])}})()")
        ok('at 360px: five buttons, each at least 44 x 44, no sideways scroll', len(nav['items']) == 5 and all(x[0] >= 44 and x[1] >= 44 for x in nav['items']) and nav['sw'] <= nav['cw'] and nav['dw'] <= 360, nav); await pg4.screenshot(path=OUT + '34_360px_bar.png')
        await pg4.evaluate("navGo('more')"); await pg4.wait_for_selector('#bnmore .bnrow'); await shot('35_360px_more_sheet', '#bnmore', pg4); await pg4.click('#bnmore .bnrow >> text=My stats'); await pg4.wait_for_selector('#ostat .stile'); await shot('36_360px_dashboard', '#ostat', pg4)
        await pg4.click('#ostat [data-a=hcp]'); await pg4.wait_for_selector('#ostat .sbigc'); await shot('37_360px_handicap', '#ostat', pg4); await ctx.close(); await b.close()
    bad = [r for r in report if r[1]['sw'] > r[1]['cw'] or r[1]['dw'] > r[1]['W'] or r[1]['small'] or r[1]['wide'] or r[1]['banned'] or r[1]['overBanner'] is False]
    failed = [c for c in checks if not c[1]]
    print('---\n%d screenshots in %s, %d checks' % (len(report) + 2, OUT, len(checks))); print('PROBLEM SCREENS', bad); print('FAILED CHECKS', [(c[0], c[2]) for c in failed]); print('PAGE ERRORS', errs)
    sys.exit(1 if bad or failed or errs else 0)
asyncio.run(main())
