# Course pick flow checks (review 4, H2; owner: "Once I pick a course no way to select or save it").
# Needs: node scripts/stats-shots/harness.js running (ports 8896 / 8897).   Usage: python3 scripts/stats-shots/course.py [out dir] [theme]
# Runs the full app at 360 x 740 and 430 x 900 and walks Post a round and the calculator through a course with MANY tees (5), ONE tee and NO tee data:
#   - the course opens its own screen with the tees as big buttons; one tee is already picked;
#   - "Use this course" and "Back to results" are on screen WITHOUT scrolling (measured: inside the viewport and the top element at their centre);
#   - "Use this course" returns to the form with course and tees filled in and a "Course set" line; with no tee data it still works, with optional
#     typed Rating / Slope / yards, and the screen says the round counts toward the handicap only with Rating and Slope;
#   - the saved round carries courseId; My courses (recent + home course) comes back from the server; the calculator keeps its course across a reload.
# Every check fails on a07ab04 (PICS_DIR=<a07ab04>/pics node scripts/stats-shots/harness.js). Exit code 1 on any failure.
import asyncio, json, sys, os
from playwright.async_api import async_playwright
ROOT = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('STATS_SHOTS_DIR', '/tmp/stats-shots5')).rstrip('/') + '/'  # review 5, L3: never another run's folder
THEME = sys.argv[2] if len(sys.argv) > 2 else 'navy'
API, WEB = 'http://127.0.0.1:8896', 'http://localhost:8897'
SIZES = [(360, 740), (430, 900)]
ALL = []
INIT = """localStorage.setItem('odd-tok','t-%s');localStorage.setItem('odd-name','%s');localStorage.setItem('pics-lg','nfl');localStorage.setItem('pics-theme','%s');localStorage.setItem('pics-dark','%s');window.ODD_GROUPS_API='%s';window.ODD_STATS_API='%s';"""
# Is this control on screen right now, untouched by scrolling, and really the thing a finger would hit there?
ONSCREEN = """(sel) => { const e = document.querySelector(sel); if (!e) return { found: false }; const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
  return { found: true, inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth, hit: !!top && (top === e || e.contains(top)), h: Math.round(r.height), w: Math.round(r.width), bottom: Math.round(r.bottom), vh: window.innerHeight, scrollTop: document.getElementById('ostat').scrollTop, disabled: !!e.disabled }; }"""
LAYOUT = """() => { const o = document.getElementById('ostat'), W = window.innerWidth, vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const small = [...o.querySelectorAll('button,a,select,input,summary,[data-a]')].filter(e => { if (!vis(e) || e.disabled) return false; const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  const wide = [...o.querySelectorAll('*')].filter(e => vis(e) && e.getBoundingClientRect().right > W + 1).map(e => e.className || e.tagName).slice(0, 4), txt = o.innerText;
  return { ok: o.scrollWidth <= o.clientWidth && document.documentElement.scrollWidth <= W && !small.length && !wide.length && !/undefined|NaN|\\[object/.test(txt), small: small.slice(0, 5), wide, sw: o.scrollWidth, cw: o.clientWidth }; }"""

async def run(b, who, name, W, H):
    OUT = ROOT + 'course_%d/' % W; os.makedirs(OUT, exist_ok=True); checks, errs = [], []; tag = '%dx%d' % (W, H)
    def ok(n, cond, detail=''): checks.append((n, bool(cond))); print(('  ok  ' if cond else '  FAIL ') + '[' + tag + '] ' + n + (' :: ' + str(detail)[:600] if detail and not cond else ''), flush=True)
    ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, has_touch=True); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    async def route(r):
        u = r.request.url
        if u.startswith('http://127.0.0.1') or u.startswith('http://localhost'): await r.continue_()
        else: await r.fulfill(status=200, content_type='application/json', body='{}')
    await ctx.route('**/*', route); await pg.add_init_script(INIT % (who, name, 'violet' if THEME.startswith('violet') else 'navy', '1' if THEME != 'violet' else '0', API, API))
    async def boot():
        await pg.goto(WEB + '/index.html'); await pg.wait_for_function("typeof window.oddStats === 'function'", timeout=20000); await pg.wait_for_timeout(800)
    n = [0]
    async def shot(nm): n[0] += 1; await pg.wait_for_timeout(250); await pg.screenshot(path=OUT + '%02d_%s.png' % (n[0], nm)); lay = await pg.evaluate(LAYOUT); ok('layout ' + nm + ': no sideways scroll, every target 44 px or more', lay['ok'], lay)
    txt = lambda: pg.inner_text('#ostat')
    me = lambda: pg.evaluate("fetch('%s/stats/me',{method:'POST',headers:{'content-type':'application/json','x-token':localStorage.getItem('odd-tok')},body:'{}'}).then(r=>r.json())" % API)
    async def post_form():
        await pg.evaluate("window.OddStats.open({t:'hcp'})"); await pg.wait_for_selector('#ostat [data-a=post]'); await pg.click('#ostat [data-a=post]'); await pg.wait_for_selector('#sf_course')
    async def search(q='Cedar'):
        await pg.fill('#sf_course', q); await pg.click('#ostat [data-a=csearch]'); await pg.wait_for_selector('#ostat [data-a=cpick]')
    async def open_course(i):
        await pg.click('#ostat [data-a=cpick] >> nth=%d' % i)
        try: await pg.wait_for_selector('#ostat .sbar [data-a=cuse]:not([disabled])', timeout=6000); return True
        except Exception: return False
    async def bar(label, back='Back to results'):
        u, bk = await pg.evaluate(ONSCREEN, '#ostat [data-a=cuse]'), await pg.evaluate(ONSCREEN, '#ostat [data-a=cback]')
        ok(label + ': "Use this course" is on screen without scrolling, at the bottom, and tappable', u.get('found') and u['inView'] and u['hit'] and u['scrollTop'] == 0 and u['h'] >= 44 and not u['disabled'], u)
        ok(label + ': "' + back + '" is on screen without scrolling', bk.get('found') and bk['inView'] and bk['hit'] and (await pg.inner_text('#ostat [data-a=cback]')).strip() == back, [bk, await pg.inner_text('#ostat [data-a=cback]')])
    await boot()

    # ---------- A. many tees ----------
    await post_form(); await pg.fill('#sf_total', '88'); await search(); await shot('results')
    opened = await open_course(0); ok('A (5 tees): tapping a course opens its own screen', opened, (await txt())[:300])
    if not opened: await ctx.close(); ALL.append((tag, checks, errs)); return
    await shot('many_tees'); t = await txt()
    ok('A: the tees are big buttons with Rating, Slope, par and yards', await pg.locator('#ostat .stee').count() == 5 and 'Rating 71.3 · Slope 125 · Par 72 · 6,612 yds' in t and await pg.evaluate("[...document.querySelectorAll('#ostat .stee')].every(e => e.getBoundingClientRect().height >= 56 && e.getBoundingClientRect().width >= window.innerWidth - 40)"), t[:400])
    ok('A: with several tees none is picked yet', await pg.locator('#ostat .stee[aria-pressed=true]').count() == 0); await bar('A')
    await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_timeout(200); ok('A: "Use this course" before a tee is picked says what to do (no dead end)', 'Tap your tees first' in await txt() and await pg.locator('#ostat .sbar').count() == 1)
    await pg.click('#ostat .stee >> text=Blue'); ok('A: the picked tee is marked', await pg.get_attribute('#ostat .stee.on', 'aria-pressed') == 'true' and '✓ Blue' in await pg.inner_text('#ostat .stee.on')); await bar('A, tee picked'); await shot('many_tees_blue_picked')
    await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_selector('#ostat .scset'); await shot('form_course_set'); v = [await pg.input_value(s) for s in ['#sf_course', '#sf_tees', '#sf_cr', '#sf_slope', '#sf_par', '#sf_total']]
    ok('A: back on the form with course, tees, Rating, Slope and par filled in, and what was typed kept', v == ['Cedar Ridge 1', 'Blue', '71.3', '125', '72', '88'], v)
    cs = await pg.inner_text('#ostat .scset'); ok('A: the form says "Course set" with the course, the tees and a Change button', 'Course set' in cs and 'Cedar Ridge 1 · Blue tees' in cs and 'Rating 71.3' in cs and await pg.locator('#ostat .scset [data-a=cchange]').count() == 1, cs)
    ok('A: the course field is on screen after returning', (await pg.evaluate(ONSCREEN, '#sf_course'))['inView'])
    await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .stoast'); j = await me(); r = [x for x in j['records'] if x.get('title', '').startswith('Cedar Ridge 1')]
    ok('A: the saved round carries courseId, tees, Rating and Slope', len(r) >= 1 and r[0]['extra'].get('courseId') == 'c0' and r[0]['extra'].get('cr') == 71.3 and r[0]['extra'].get('slope') == 125 and r[0]['extra'].get('yards') == 6612, r[0]['extra'] if r else None)
    ok('A: the course is under My courses on the server', [c['id'] for c in j['myCourses']['recent']][:1] == ['c0'] and j['myCourses']['recent'][0]['tees'] == 'Blue', j.get('myCourses'))

    # ---------- B. one tee ----------
    await post_form(); await search(); await open_course(1); await shot('one_tee')
    ok('B (1 tee): the one tee is already picked', await pg.locator('#ostat .stee').count() == 1 and await pg.get_attribute('#ostat .stee', 'aria-pressed') == 'true', (await txt())[:300]); await bar('B')
    await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_selector('#ostat .scset'); v = [await pg.input_value(s) for s in ['#sf_course', '#sf_tees', '#sf_cr', '#sf_slope']]
    ok('B: one tap fills the form', v == ['Cedar Ridge 2', 'Blue', '71.3', '125'] and 'Course set' in await pg.inner_text('#ostat .scset'), v)

    # ---------- D. Back to results ----------
    await pg.fill('#sf_total', '91'); await search(); await open_course(4); await pg.click('#ostat [data-a=cback]'); await pg.wait_for_selector('#sf_course')
    ok('D: "Back to results" returns to the form with the results still listed and the typing kept', await pg.locator('#ostat [data-a=cpick]').count() == 25 and await pg.input_value('#sf_total') == '91', [await pg.locator('#ostat [data-a=cpick]').count(), await pg.input_value('#sf_total')])

    # ---------- C. no tee data ----------
    opened = await open_course(2); ok('C (no tee data): the course still opens its own screen', opened); await shot('no_tees'); t = await txt()
    ok('C: it says there are no ratings on file, that typing them is optional, and when the round counts', 'No ratings on file for this course' in t and 'Enter Course Rating and Slope from the scorecard if you have them' in t and 'counts toward your handicap only when Course Rating and Slope are filled in' in t and await pg.locator('#sp_cr').count() == 1 and await pg.locator('#sp_yards').count() == 1, t[:500]); await bar('C')
    ph = [await pg.get_attribute('#sp_cr', 'placeholder'), await pg.get_attribute('#sp_slope', 'placeholder'), await pg.get_attribute('#sp_yards', 'placeholder')]
    ok('C (review 5, L1): the example numbers read as examples ("e.g. ..."), not as ratings on file', all(x and x.startswith('e.g. ') for x in ph), ph)
    await pg.fill('#sp_cr', '70.5'); await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_timeout(200); ok('C: only one of Rating / Slope typed is caught on this screen', 'Enter both Course Rating and Slope, or leave both empty' in await txt())
    await pg.fill('#sp_cr', ''); await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_selector('#ostat .scset');
    fm = await pg.evaluate("""() => { const f = document.getElementById('sf_format'), t = [...document.querySelectorAll('.stoast')]; if (!f) return { found: false }; const a = f.getBoundingClientRect(); return { found: true, over: t.filter(x => { const b = x.getBoundingClientRect(); return b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; }).length, toasts: t.length }; }""")
    ok('C (review 5, L2): nothing pops up (over the Format field or anywhere) after "Use this course"', fm.get('found') and fm.get('over') == 0 and fm.get('toasts') == 0, fm)
    await shot('form_course_set_no_ratings'); cs = await pg.inner_text('#ostat .scset')
    ok('C: "Use this course" with nothing typed sets the course and says the round will not count toward the handicap', await pg.input_value('#sf_course') == 'Cedar Ridge 3' and 'Course set' in cs and 'No ratings on file' in cs and 'counts toward your handicap only when' in cs, cs)
    await pg.fill('#sf_cr', ''); await pg.fill('#sf_slope', ''); await pg.fill('#sf_tees', ''); await pg.fill('#sf_total', '95'); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .stoast'); j = await me(); r = [x for x in j['records'] if x.get('title', '').startswith('Cedar Ridge 3')]
    ok('C: the round is logged with its courseId and marked as not counting toward the index', len(r) == 1 and r[0]['extra'].get('courseId') == 'c2' and 'no Course Rating and Slope' in r[0]['extra'].get('hcpNote', ''), r[0]['extra'] if r else None)
    await post_form(); await search(); await open_course(2); await pg.fill('#sp_tees', 'White'); await pg.fill('#sp_cr', '70.5'); await pg.fill('#sp_slope', '122'); await pg.fill('#sp_yards', '6100'); await shot('no_tees_typed'); await bar('C, typed'); await pg.click('#ostat [data-a=chome]'); await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_selector('#ostat .scset')
    v = [await pg.input_value(s) for s in ['#sf_course', '#sf_tees', '#sf_cr', '#sf_slope']]; ok('C: typed Rating / Slope / tees come back to the form', v == ['Cedar Ridge 3', 'White', '70.5', '122'] and 'Rating 70.5 · Slope 122' in await pg.inner_text('#ostat .scset'), v)
    await pg.fill('#sf_total', '93'); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .stoast'); j = await me(); r = [x for x in j['records'] if x.get('title', '').startswith('Cedar Ridge 3') and x['extra'].get('cr') == 70.5]
    ok('C: with typed Rating and Slope the round counts toward the index and keeps the typed yards', len(r) == 1 and r[0]['extra'].get('yards') == 6100 and r[0]['extra'].get('hcpNote', '').startswith('Counts toward your handicap'), r[0]['extra'] if r else None)

    # ---------- E. My courses ----------
    mc = j['myCourses']; ok('E: My courses on the server: the home course first, then the recent ones', mc['home'] and mc['home']['id'] == 'c2' and [c['id'] for c in mc['recent']] == ['c2', 'c1', 'c0'] and mc['recent'][0]['home'] is True, mc)
    await post_form(); await pg.wait_for_selector('#ostat [data-a=cmine]'); await shot('form_my_courses'); t = await txt()
    ok('E: Post a round offers My courses (home course first) before any search', 'MY COURSES' in t.upper() and await pg.locator('#ostat [data-a=cmine]').count() == 3 and '🏠 Cedar Ridge 3' in await pg.inner_text('#ostat [data-a=cmine] >> nth=0') and 'Home course' in t, t[:500])
    await pg.click('#ostat [data-a=cmine] >> nth=2'); await pg.wait_for_selector('#ostat .sbar [data-a=cuse]'); ok('E: a course from My courses opens with its tees picked', await pg.get_attribute('#ostat .stee', 'aria-pressed') == 'true' and 'Rating 71.3' in await txt()); await bar('E', 'Back')  # opened from My courses there are no results to go back to: the second button is a plain Back
    await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_selector('#ostat .scset'); ok('E: and fills the form', [await pg.input_value('#sf_course'), await pg.input_value('#sf_cr')] == ['Cedar Ridge 1', '71.3'])
    await pg.fill('#sf_course', 'Somewhere Else'); await pg.wait_for_timeout(150); ok('E: typing another course name drops the picked course', await pg.locator('#ostat .scset').count() == 0)

    # ---------- F. calculator ----------
    await pg.evaluate("window.OddStats.open({t:'hcp'})"); await pg.wait_for_selector('#sc_name'); await pg.fill('#sc_name', 'Cedar'); await pg.click('#ostat [data-a=csearch][data-for=calc]'); await pg.wait_for_selector('#ostat [data-a=cpick]'); await pg.click('#ostat [data-a=cpick] >> nth=0'); await pg.wait_for_selector('#ostat .sbar [data-a=cuse]:not([disabled])'); await bar('F (calculator)')
    await pg.click('#ostat .stee >> text=White'); await pg.click('#ostat [data-a=cuse]'); await pg.wait_for_selector('#ostat .scset'); await shot('calculator_course_set'); v = [await pg.input_value(s) for s in ['#sc_name', '#sc_cr', '#sc_slope', '#sc_par']]
    ok('F: the calculator gets the course, Rating, Slope and par, says "Course set", and works out a course handicap', v == ['Cedar Ridge 1', '69.8', '121', '72'] and 'Course set' in await pg.inner_text('#ostat .scset') and (await pg.inner_text('#sc_out')).strip().lstrip('-').isdigit(), [v, await pg.inner_text('#sc_out')])
    await boot(); await pg.evaluate("window.OddStats.open({t:'hcp'})"); await pg.wait_for_selector('#sc_name'); v = [await pg.input_value(s) for s in ['#sc_name', '#sc_cr', '#sc_slope', '#sc_par']]; await shot('calculator_after_reload')
    ok('F: after reloading the app the calculator still has its course', v == ['Cedar Ridge 1', '69.8', '121', '72'] and 'Course set' in await pg.inner_text('#ostat .scset'), v)
    ok('no page errors', not errs, errs[:3]); await ctx.close(); ALL.append((tag, checks, errs))

async def main():
    import urllib.request; urllib.request.urlopen(API + '/reset').read()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for i, (W, H) in enumerate(SIZES):
            who = ['dan', 'eve'][i]  # a different player per size, so each run starts with no courses of its own
            try: await run(b, who, {'dan': 'DanTheDriver', 'eve': 'Eve Eagle'}[who], W, H)
            except Exception as e: print('  CRASH [%dx%d] %s' % (W, H, str(e)[:900]), flush=True); ALL.append(('%dx%d' % (W, H), [('crash', False)], []))
        await b.close()
    tot = sum(len(a[1]) for a in ALL); nf = sum(1 for a in ALL for c in a[1] if not c[1])
    print('=== course flow: %d sizes, %d checks, %d failed' % (len(ALL), tot, nf)); sys.exit(1 if nf else 0)
asyncio.run(main())
