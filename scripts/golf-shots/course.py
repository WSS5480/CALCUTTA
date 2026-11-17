# Golf flow checks, review round 4 (headless Chromium). Needs the harness and a static server for pics/ (see harness.js):
#   PORT=8862 OUT=/tmp/golf-shots4 node scripts/golf-shots/harness.js &    (cd pics && python3 -m http.server 8863 &)
#   PORT=8862 WEBPORT=8863 OUT=/tmp/golf-shots4 python3 scripts/golf-shots/course.py
# M1 COURSE PICK at 360x740 and 430x900: a course with many tees, one tee, no tees and incomplete holes. On each one "Use this course" is on the screen
# WITHOUT scrolling, confirms the pick, and the set-up form comes back with the course and tees filled in and "Course set". My courses lists it afterwards.
# H4 NO SIGNAL: the app is reopened while the server cannot be reached: the list and the scorecard are still there, a score typed there waits on the phone
# and is sent when the signal is back. Screens in $OUT/flow. Exit code 1 when any check fails. Writes only under $OUT.
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright
OUT = os.environ.get('OUT', '/tmp/golf-shots4').rstrip('/') + '/flow/'; API = 'http://127.0.0.1:' + os.environ.get('PORT', '8842'); WEB = 'http://localhost:' + os.environ.get('WEBPORT', '8843')
os.makedirs(OUT, exist_ok=True); BAD = []; OKN = [0]
def check(ok, what):
    if ok: OKN[0] += 1
    else: BAD.append(what); print('   FAIL ' + what)
def api(who, name, op, body):
    rq = urllib.request.Request(API + '/golf/' + op, data=json.dumps(dict(body, myName=name)).encode(), headers={'content-type': 'application/json', 'x-token': 't-' + who})
    return json.loads(urllib.request.urlopen(rq, timeout=30).read())
STATE = """() => { const o = document.getElementById('ogolf'), vh = window.innerHeight, vw = window.innerWidth, b = o.querySelector('[data-a=usecourse]'), r = b ? b.getBoundingClientRect() : null;
  const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null, tees = [...o.querySelectorAll('.oteeb')].map((e) => ({ t: e.innerText.replace(/\\s+/g, ' '), on: e.getAttribute('aria-checked') === 'true', y: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height) }));
  const small = [...o.querySelectorAll('button,a,select,input')].filter((e) => { const q = e.getBoundingClientRect(); return q.width && (q.height < 44 || q.width < 44) && e.type !== 'checkbox'; }).map((e) => (e.getAttribute('data-a') || e.id || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  return { h1: (o.querySelector('h1') || {}).innerText || '', use: r ? { y: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= vh + 1, hit: !!top && (top === b || b.contains(top)), t: b.innerText.replace(/\\s+/g, ' ') } : null, tees, back: !![...o.querySelectorAll('button')].find((e) => /Back to results/.test(e.innerText)),
    sideways: o.scrollWidth > o.clientWidth + 1 || document.documentElement.scrollWidth > vw + 1, small, note: (o.querySelector('.oasked') || {}).innerText || '', err: (o.querySelector('.oerr') || {}).innerText || '', course: (o.querySelector('[data-a=course]') || {}).innerText || '', text: o.innerText, scrollTop: o.scrollTop }; }"""
async def run(pw, W, H):
    b = await pw.chromium.launch(); ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, has_touch=True); pg = await ctx.new_page(); errs = []; net = {'off': False}; dialogs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    def on_dialog(d): dialogs.append(d.message); asyncio.ensure_future(d.accept())
    pg.on('dialog', on_dialog)
    async def route(r):
        u = r.request.url
        if u.startswith(API) and net['off']: await r.abort('internetdisconnected')
        elif u.startswith('http://127.0.0.1') or u.startswith('http://localhost'): await r.continue_()
        else: await r.fulfill(status=200, content_type='application/json', body='{}')
    await ctx.route('**/*', route)
    await pg.add_init_script("window.ODD_GOLF_API=%s;try{localStorage.setItem('pics-dark','1');if(!localStorage.getItem('odd-tok')){localStorage.setItem('odd-tok','t-max');localStorage.setItem('odd-name','Max Trevino');}localStorage.setItem('pics-lg','nfl');}catch(e){}" % json.dumps(API))
    async def boot():
        await pg.goto(WEB + '/index.html?mirror=1'); await pg.wait_for_timeout(1000)
        if not await pg.evaluate("typeof window.oddGolf === 'function'"): await pg.add_script_tag(url=WEB + '/golf.js')
        await pg.evaluate("window.oddGolf()"); await pg.wait_for_selector('#ogolf [data-a=newday]'); await pg.wait_for_timeout(600)
    n = [0]
    async def st(tag):
        await pg.wait_for_timeout(450); n[0] += 1; await pg.screenshot(path=OUT + '%d_%02d_%s.png' % (W, n[0], tag)); m = await pg.evaluate(STATE)
        check(not m['sideways'], '[%d] %s: sideways scroll' % (W, tag)); check(not m['small'], '[%d] %s: small tap targets %s' % (W, tag, m['small'][:4])); check('undefined' not in m['text'] and 'NaN' not in m['text'], '[%d] %s: junk text' % (W, tag)); return m
    async def click(sel): await pg.click('#ogolf ' + sel, timeout=6000); await pg.wait_for_timeout(500)
    async def to_results():
        await pg.evaluate("(()=>{const o=document.getElementById('ogolf');const c=o&&o.querySelector('[data-a=close]');if(c)c.click()})()"); await pg.wait_for_timeout(250)
        await pg.evaluate("window.oddGolf()"); await pg.wait_for_selector('#ogolf [data-a=newday]'); await click('[data-a=newday]'); await click('[data-a=course]'); await pg.fill('#ogolf #oq', 'valley'); await click('[data-a=csearch]'); await pg.wait_for_selector('#ogolf [data-a=cdir]')
    def use_ok(m, tag): check(bool(m['use']) and m['use']['inView'] and m['use']['hit'] and m['scrollTop'] == 0, '[%d] %s: "Use this course" is not on the screen without scrolling %s' % (W, tag, m['use'])); check(m['back'], '[%d] %s: no "Back to results"' % (W, tag))
    def set_ok(m, tag, name, tees): check('Course set' in m['note'] and name in m['note'], '[%d] %s: no "Course set" (%r, err %r)' % (W, tag, m['note'], m['err'])); check(name in m['course'] and (tees + ' tees') in m['course'], '[%d] %s: the form does not show the course and tees: %r' % (W, tag, m['course'])); check(m['h1'] != name, '[%d] %s: still on the course screen' % (W, tag))
    await boot()
    # 1. many tees
    await to_results(); await click('[data-a=cdir][data-x="og-1"]'); m = await st('many_tees_first_view'); check(len(m['tees']) == 5 and all(t['h'] >= 56 for t in m['tees']) and m['tees'][0]['y'] < 260, '[%d] many tees: five big tee buttons at the top %s' % (W, m['tees'])); check(not any(t['on'] for t in m['tees']), '[%d] many tees: nothing preselected' % W); use_ok(m, 'many tees')
    check(all(('/' in t['t'] and 'yards' in t['t']) for t in m['tees']), '[%d] many tees: each shows rating / slope and yards' % W)
    await click('[data-a=usecourse]'); m = await st('many_tees_tapped_use_too_early'); check('Tap your tees first' in m['err'] and m['h1'].startswith('Palm Valley'), '[%d] many tees: tapping Use before a tee explains what to do' % W)
    await click('[data-a=tee][data-i="2"]'); m = await st('many_tees_white_selected'); check(m['tees'][2]['on'] and 'Selected' in m['tees'][2]['t'] and sum(1 for t in m['tees'] if t['on']) == 1, '[%d] many tees: the tapped tee is selected' % W); check('White tees' in m['use']['t'], '[%d] many tees: the button names the tees' % W); use_ok(m, 'many tees, selected')
    await click('[data-a=usecourse]'); m = await st('many_tees_course_set'); set_ok(m, 'many tees', 'Palm Valley Golf Club', 'White'); check('70 / 121' in m['course'], '[%d] many tees: rating / slope on the form' % W)
    # 2. one tee: preselected
    await to_results(); await click('[data-a=cdir][data-x="og-2"]'); m = await st('one_tee_first_view'); check(len(m['tees']) == 1 and m['tees'][0]['on'], '[%d] one tee: it is preselected' % W); use_ok(m, 'one tee'); await click('[data-a=usecourse]'); m = await st('one_tee_course_set'); set_ok(m, 'one tee', 'Palm Valley Golf Club', 'White')
    # 3. no tees: par only, rating / slope optional
    await to_results(); await click('[data-a=cdir][data-x="og-3"]'); m = await st('no_tees_first_view'); check('No tees are on file' in m['text'] and not m['tees'], '[%d] no tees: says so' % W); use_ok(m, 'no tees'); await click('[data-a=usecourse]'); m = await st('no_tees_course_set'); set_ok(m, 'no tees', 'Palm Valley Golf Club', 'Regular'); check('par 72' in m['course'], '[%d] no tees: par-only card' % W)
    # 4. incomplete holes (10 of 18): still usable, after a plain question
    await to_results(); await click('[data-a=cdir][data-x="og-4"]'); m = await st('ten_holes_first_view'); use_ok(m, 'incomplete holes'); await click('[data-a=tee][data-i="1"]'); m = await st('ten_holes_tee_selected'); check('Only 10 of 18 holes are on file' in m['text'], '[%d] incomplete: says what is missing' % W); use_ok(m, 'incomplete holes, selected')
    await click('[data-a=holes]'); m = await st('ten_holes_shown'); check(m['text'].count('not on file') >= 8, '[%d] incomplete: holes 11 to 18 are marked "not on file"' % W); check(m['use']['inView'] and m['use']['hit'], '[%d] incomplete: the button stays on the screen with the holes open' % W)
    dialogs.clear(); await click('[data-a=usecourse]'); m = await st('ten_holes_course_set'); check(len(dialogs) == 1 and 'Only 10 of 18' in dialogs[0], '[%d] incomplete: the user is asked once before standard pars are used' % W); set_ok(m, 'incomplete holes', 'Palm Valley Golf Club', 'White')
    # the game is really created on that course, and My courses has it next time
    await pg.fill('#ogolf #otitle', 'Course test %d' % W); await click('[data-a=createday]'); await pg.wait_for_timeout(700); m = await st('game_created'); check('Palm Valley' in m['text'] and not m['err'], '[%d] the game is created on the picked course (%r)' % (W, m['err']))
    await pg.evaluate("(()=>{const o=document.getElementById('ogolf');const c=o&&o.querySelector('[data-a=close]');if(c)c.click()})()"); await pg.evaluate("window.oddGolf()"); await pg.wait_for_selector('#ogolf [data-a=newday]'); await click('[data-a=newday]'); await click('[data-a=course]'); await pg.wait_for_selector('#ogolf [data-a=cmy]')
    m = await st('my_courses'); check('my courses' in m['text'].lower(), '[%d] My courses is listed' % W)
    if await pg.locator('#ogolf [data-a=chome][data-on="1"]').count(): await click('[data-a=chome][data-on="1"] >> nth=0')
    m = await st('my_courses_home'); check('Home course' in m['text'], '[%d] a home course can be set' % W); await click('[data-a=cmy] >> nth=0'); m = await st('my_course_used'); check('Course set' in m['note'], '[%d] a course from My courses is used with one tap' % W)
    # ---------- H4: reopened with no signal ----------
    par = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5]; si = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10]
    g = api('max', 'Max Trevino', 'create', {'kind': 'day', 'solo': True, 'title': 'Solo offline %d' % W, 'course': {'name': 'Palm Valley Golf Club', 'tees': 'White', 'holes': 18, 'par': par, 'hcp': si, 'rating': 70.0, 'slope': 121}, 'day': {'fmt': 'stroke'}, 'pot': {'entry': 0}})['game']
    await boot(); await click('[data-a=open][data-id="%s"]' % g['id']); await pg.wait_for_timeout(700); m = await st('online_game_open'); check('Solo offline' in m['text'], '[%d] offline: the game opens with signal' % W)
    net['off'] = True; await boot(); m = await st('offline_home'); check('Offline' in m['text'] and ('Solo offline %d' % W) in m['text'], '[%d] offline: the list of games is still there, marked Offline' % W)
    await click('[data-a=open][data-id="%s"]' % g['id']); await pg.wait_for_timeout(900); m = await st('offline_game'); check("Offline — scores will send when you're back" in m['text'], '[%d] offline: the game shows the Offline line' % W); check('Palm Valley' in m['text'] or 'Solo offline' in m['text'], '[%d] offline: the game is shown from the phone' % W)
    await click('[data-tab=card]'); m = await st('offline_scorecard'); check(await pg.locator('#ogolf [data-a=hole][data-h="1"]').count() > 0, '[%d] offline: the scorecard is there' % W)
    await click('[data-a=hole][data-h="1"] >> nth=0'); await click('[data-a=savehole]'); await pg.wait_for_timeout(700); await click('.oback'); m = await st('offline_score_waiting'); check('waiting to send' in m['text'], '[%d] offline: a score typed with no signal waits on the phone' % W)
    net['off'] = False; await pg.evaluate("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(1500)
    sc = api('max', 'Max Trevino', 'get', {'id': g['id']})['game']['day']['scores']; check(bool(sc.get('T1', {}).get('1')), '[%d] offline: the score is sent when the signal is back' % W); m = await st('back_online')
    check('waiting to send' not in m['text'], '[%d] offline: nothing is left waiting' % W)
    check(not errs, '[%d] page errors: %s' % (W, errs[:3])); await b.close()
async def main():
    async with async_playwright() as pw:
        for W, H in ((360, 740), (430, 900)): await run(pw, W, H)
    print('\n%d checks passed, %d failed' % (OKN[0], len(BAD))); [print(' - ' + x) for x in BAD]; sys.exit(1 if BAD else 0)
asyncio.run(main())
