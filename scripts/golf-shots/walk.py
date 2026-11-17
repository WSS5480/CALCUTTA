# Golf phone checks (review rounds 3 and 4). Needs scripts/golf-shots/harness.js on :$PORT (8842) and `python3 -m http.server $WEBPORT` (8843) in pics/.
# Walks the golf screens as five different people at 360x740, 430x900 and 1280x800 in all three themes (navy, violet light, violet dark).
# EVERY screenshot is measured: no sideways scroll, tap targets 44 px or more, the My Bets banner covered by the overlay, no page errors, and
# CONTRAST: every piece of text on the screen against what is really behind it must be 4.5:1 or better (M7).
# Writes only under $OUT (default /tmp/golf-shots4) (screens in <size>_<theme>/, report.json, report.txt).   Run: python3 scripts/golf-shots/walk.py [size] [theme]
import asyncio, json, sys, os, urllib.request
from playwright.async_api import async_playwright
OUT = os.environ.get('OUT', '/tmp/golf-shots4').rstrip('/') + '/'; API = 'http://127.0.0.1:' + os.environ.get('PORT', '8842'); WEB = 'http://localhost:' + os.environ.get('WEBPORT', '8843')
SEED = json.load(open(OUT + 'seed.json'))
SIZES = {'360': (360, 740), '430': (430, 900), '1280': (1280, 800)}
THEMES = {'navy': ('', '1'), 'violet-light': ('violet', '0'), 'violet-dark': ('violet', '1')}
NAMES = {'ann': 'Sir Oddable', 'bob': 'ChalkEater', 'kim': 'Kim Vu', 'lou': "Lou O'Neil", 'pro': 'Palm Valley Pro Shop', 'eve': 'MiddleMan', 'dan': 'PuntReturn'}
MEASURE = r"""(vw) => { const o = document.getElementById('ogolf'); if (!o) return { none: true };
  const pb = document.getElementById('plb'); let cov = null; if (pb && !pb.hidden) { const r = pb.getBoundingClientRect(); if (r.width) { const e = document.elementFromPoint(Math.min(vw - 2, r.left + r.width / 2), r.top + r.height / 2); cov = e ? !!e.closest('#ogolf') : null; } }
  const small = [...o.querySelectorAll('button,a,select,input,textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map(e => (e.getAttribute('data-a') || e.className || e.tagName) + ':' + Math.round(r2(e).width) + 'x' + Math.round(r2(e).height));
  function r2(e) { return e.getBoundingClientRect(); }
  const wide = [...o.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1; }).map(e => (e.className || e.tagName) + ':' + Math.round(r2(e).right)).slice(0, 4);
  // ---- contrast ----
  const P = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const a = m[1].split(/[ ,/]+/).map(Number); return [a[0], a[1], a[2], a.length > 3 && !isNaN(a[3]) ? a[3] : 1]; };
  const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // what is behind an element: every background from the page up, composited; a gradient counts as each of its colours (the worst one decides)
  const backs = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e); let bs = [[255, 255, 255, 1]];
    for (const e of chain) { const cs = getComputedStyle(e), img = cs.backgroundImage, col = P(cs.backgroundColor); if (col && col[3] > 0) bs = bs.map((b) => over(col, b));
      if (img && /gradient/.test(img)) { const stops = (img.match(/rgba?\([^)]+\)/g) || []).map(P).filter(Boolean); if (stops.length) { const nb = []; bs.forEach((b) => stops.forEach((s) => nb.push(over(s, b)))); bs = nb.slice(0, 12); } } } return bs; };
  const bad = [], seen = new Set(); const tw = document.createTreeWalker(o, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { const txt = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!txt) continue; const e = n.parentElement; if (!e || e.closest('select,option')) continue; const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for (let x = e; x && x !== o.parentElement; x = x.parentElement) op *= Number(getComputedStyle(x).opacity || 1); const fg0 = P(cs.color); if (!fg0) continue; fg0[3] *= op;
    let worst = 99, wb = null; backs(e).forEach((b) => { const k = ratio(over(fg0, b), b); if (k < worst) { worst = k; wb = b; } });
    if (worst < 4.5) { const key = (e.className || e.tagName) + '|' + cs.color + '|' + (wb || []).map(Math.round).join(','); if (!seen.has(key)) { seen.add(key); bad.push({ t: txt.slice(0, 40), cls: String(e.className || e.tagName).slice(0, 30), fg: cs.color, bg: 'rgb(' + wb.slice(0, 3).map(Math.round).join(',') + ')', r: Math.round(worst * 100) / 100 }); } } }
  // form fields: the typed text and the field's own background
  [...o.querySelectorAll('input,select,textarea')].forEach((e) => { const r = e.getBoundingClientRect(); if (!r.width) return; const cs = getComputedStyle(e), fg = P(cs.color); let worst = 99, wb = null; backs(e).forEach((b) => { const k = ratio(over(fg, b), b); if (k < worst) { worst = k; wb = b; } }); if (worst < 4.5) bad.push({ t: 'field ' + (e.id || e.tagName), cls: 'field', fg: cs.color, bg: 'rgb(' + wb.slice(0, 3).map(Math.round).join(',') + ')', r: Math.round(worst * 100) / 100 }); });
  return { sw: o.scrollWidth, cw: o.clientWidth, docw: document.documentElement.scrollWidth, h: o.scrollHeight, overBanner: cov, small: small.slice(0, 8), wide, contrast: bad.slice(0, 12), text: o.innerText }; }"""

def flows():
    S = SEED; O = lambda k: ('open', S[k])
    return [
      ('bob', [('shot', 'home_badges'), O('wait'), ('shot', 'live_leaderboard_waiting_card', ['aiting for a second signature', 'Sign it', 'Turn it down', 'Can be signed by']), ('tab', 'card'), ('shot', 'live_scorecard'), ('tab', 'mt'), ('shot', 'live_matches'), ('tab', 'side'), ('shot', 'live_side_games_tab'), ('tab', 'lb'),
               ('click', '[data-a=team][data-tid="T3"]'), ('shot', 'team_short_card'), ('back',), ('click', '[data-a=team][data-tid="T1"]'), ('shot', 'team_disputed_hole_who_settles', ['never settles it']), ('click', '[data-a=confirmv]'), ('shot', 'check_card_flag_confirmed_hole', ['Flag']), ('back',), ('back',),
               ('click', '[data-a=payv]'), ('shot', 'payouts_live_change_waiting', ['aiting for a second signature']), ('back',), ('click', '[data-a=hcpv]'), ('shot', 'players_and_handicaps', ['signed by']), ('back',),
               ('click', '[data-a=auditv]'), ('shot', 'score_history_plain_words', ['Scores confirmed', 'Closest to the pin winner entered', '!ctp winner', '!ctp confirmed']), ('back',), ('click', '[data-a=plogv]'), ('shot', 'organizer_actions_log', ['Organizer actions', 'signed by']), ('back',),
               ('click', '[data-a=sign][data-ok="1"] >> nth=0'), ('shot', 'after_signing_one', []), ('click', '[data-a=sign][data-ok="0"] >> nth=0'), ('shot', 'after_turning_one_down', []), ('back',),
               O('fin'), ('shot', 'final_forced_signed_reopen_waiting', ['never confirmed', 'signed by', 'reopen the round']), ('click', '[data-a=payv]'), ('shot', 'payouts_closed_final', ['The list is closed because the round is final']), ('back',), ('back',),
               O('flt'), ('shot', 'flights_final_board'), ('click', '[data-a=payv]'), ('shot', 'payouts_empty_flight_share_moved', ['its share went to the other flight', '!not won']), ('back',), ('back',),
               O('six'), ('shot', 'pool_final_late_payment_waiting', ['aiting for a second signature']), ('tab', 'mine'), ('shot', 'pool_my_golfers'), ('tab', 'tour'), ('shot', 'pool_tour_board'), ('tab', 'pool'), ('click', '[data-a=payv]'), ('shot', 'pool_payouts'), ('back',), ('back',),
               O('nas'), ('tab', 'mt'), ('click', '[data-a=match] >> nth=0'), ('shot', 'nassau_press_offer'), ('back',), ('back',), ('click', '[data-a=join]'), ('shot', 'join_by_code'), ('back',),
               O('dir'), ('shot', 'direction_rule_waiting', ['Sign it', 'Turned down by']), ('back',)]),
      ('ann', [('shot', 'home_organizer'), O('wait'), ('shot', 'organizer_sees_her_requests_waiting', ['Take it back', '!Sign it']), ('click', '[data-a=team][data-tid="T3"]'), ('shot', 'organizer_team_did_not_finish_waiting'), ('back',),
               ('tab', 'card'), ('select', '#octid', 'T2'), ('click', '[data-a=hole][data-tid="T2"][data-h="5"]'), ('shot', 'ask_to_change_a_confirmed_hole', ['This hole is confirmed', 'Ask to change hole 5']), ('back',), ('tab', 'lb'),
               ('click', '[data-a=final]'), ('shot', 'finish_blocked_disputed'), ('click', '[data-a=payv]'), ('shot', 'organizer_payouts_after_start', ['a change is only asked for']), ('back',), ('click', '[data-a=invite]'), ('shot', 'invite_copy_and_text_it', ['Text it']), ('back',),
               O('fin'), ('shot', 'final_reopen_form_and_waiting'), ('back',), O('cas'), ('click', '[data-a=hcpv]'), ('shot', 'casual_zero_strokes_no_handicap', ['0 strokes: no handicap yet']), ('back',), ('back',),
               O('solo'), ('shot', 'solo_round_two_tabs'), ('tab', 'card'), ('shot', 'solo_scorecard'), ('back',), O('open'), ('shot', 'pool_open_picks'), ('back',),
               O('nso'), ('shot', 'board_changed_without_the_teams_sign_off', ["Changed without the team's sign-off"]), ('back',), O('two'), ('shot', 'money_game_needs_two_accounts', ['A money game needs two players', 'Start as a casual game']), ('back',),
               ('click', '[data-a=newpro]'), ('shot', 'pro_setup_form'), ('back',), ('click', '[data-a=newday]'), ('shot', 'day_setup_form'),
               # round 4, M1: the course pick. Tees as big buttons, "Use this course" on the screen, never a dead end, My courses afterwards.
               ('click', '[data-a=course]'), ('fill', '#oq', 'valley'), ('click', '[data-a=csearch]'), ('shot', 'course_search_results'), ('click', '[data-a=cdir][data-x="og-1"]'), ('shot', 'course_many_tees', ['Pick your tees', 'Use this course', 'Back to results']),
               ('click', '[data-a=tee][data-i="2"]'), ('click', '[data-a=holes]'), ('shot', 'course_tee_selected_holes_open', ['Selected', 'Use this course · White tees']), ('back',), ('click', '[data-a=cdir][data-x="og-3"]'), ('shot', 'course_no_tees_still_usable', ['No tees are on file', 'Use this course', 'Back to results']), ('back',),
               ('click', '[data-a=cdir][data-x="og-4"]'), ('click', '[data-a=tee][data-i="0"]'), ('click', '[data-a=holes]'), ('shot', 'course_holes_missing_still_usable', ['of 18 holes are on file', 'not on file', 'Use this course']), ('back',),
               ('click', '[data-a=cdir][data-x="og-2"]'), ('click', '[data-a=usecourse]'), ('shot', 'course_set_back_on_the_form', ['Course set', 'Palm Valley Golf Club']), ('click', '[data-a=course]'), ('shot', 'my_courses', ['Tap a course to use it']), ('back',), ('back',)]),
      ('kim', [O('ask'), ('shot', 'setup_numbers_waiting_for_signature', ['aiting for a second signature', 'needs a handicap', 'nobody sets their own number', 'OK\'d by Kim Vu']), ('click', '[data-a=hcpv]'), ('shot', 'setup_approve_numbers_make_up', ['What this number is made of', 'See the rounds behind it']), ('click', '[data-a=mkv] >> nth=1'), ('shot', 'number_make_up_rounds_drill_down', ['THE ROUNDS', 'confirmed by']), ('back',), ('back',), ('back',)]),
      ('lou', [('shot', 'home_player_badge'), O('ask'), ('click', '[data-a=hcpv]'), ('shot', 'setup_player_can_ok_a_raise', ['OK 8.0 for Kim Vu', 'Higher than']), ('click', '[data-a=hcpok]'), ('shot', 'setup_after_ok', ['!OK 8.0 for Kim Vu']), ('back',), ('back',)]),
      ('pro', [O('ent'), ('shot', 'tournament_setup_director_not_playing', ['Tournament handicaps', 'HANDICAP CHANGES', '!Start set']), ('click', '[data-a=plogv]'), ('shot', 'tournament_director_actions', ['signed by']), ('back',), ('back',)]),
      ('eve', [O('ent'), ('shot', 'tournament_player_asks_director', ['Ask the director for this number']), ('back',)]),
    ]

# v1.6 (round 6): only the screens the direction rule changed. FLOWSET=v16 python3 scripts/golf-shots/walk.py
def flows16():
    S = SEED; O = lambda k: ('open', S[k])
    return [
      ('ann', [O('dir'), ('shot', 'v16_objection_window', ['Changes you can object to', 'Object: put it back', 'has lowered 2 holes by 2 strokes', 'Take it back']), ('click', '[data-a=info][data-k=rule] >> nth=0'), ('shot', 'v16_rule_sheet', ['The rule', 'CONTESTED']), ('back',),
               ('click', '[data-a=hobject] >> nth=0'), ('shot', 'v16_after_objecting', ['put back after']), ('back',), O('rain'), ('shot', 'v16_rain_shorten_to_9', ['shorten the round to 9 holes', 'Sign it']), ('back',)]),
      ('bob', [O('dir'), ('shot', 'v16_worse_for_my_team_sign_or_no', ['Sign it', 'Turn it down', 'worse for', 'Turned down by']), ('back',), O('cst'), ('shot', 'v16_contested_board', ['Contested']), ('click', '[data-a=payv]'), ('shot', 'v16_contested_payouts', ['Contested — players settle this themselves', 'Places nobody disputes still pay']), ('back',), ('back',)]),
      ('dan', [O('dir'), ('shot', 'v16_overrule_a_no', ['Overrule the no']), ('back',), O('ro'), ('shot', 'v16_read_only_seat', ['read-only seat', 'Object: put it back']), ('back',)]),
      ('pro', [O('ent'), ('shot', 'v16_director_sees_objection', ['objects to', 'The director decides']), ('back',)]),
      ('eve', [O('ent'), ('click', '[data-a=hcpv]'), ('shot', 'v16_player_sees_log_and_objects', ['HANDICAP CHANGES', 'Object to my number']), ('back',), ('back',)]),
    ]

# v1.7 (round 7): the screens the six fixes changed. FLOWSET=v17 python3 scripts/golf-shots/walk.py
def flows17():
    S = SEED; O = lambda k: ('open', S[k])
    return [
      ('ann', [O('low'), ('shot', 'v17_final_row_lowered', ['lowered 2 confirmed holes by 2', 'Changes you can object to', '30 minutes after Final']), ('click', '[data-a=payv]'), ('shot', 'v17_payout_settle_time', ['Open to disputes until', 'Settle up after that']), ('back',),
               ('click', '[data-a=team][data-tid=T3]'), ('shot', 'v17_team_disputed_wording', ['Another team settles it by picking one of the two numbers', '!settles it alone']), ('back',),
               ('click', '[data-a=info][data-k=rule] >> nth=0'), ('shot', 'v17_rule_sheet_7_lines', ['Tap Object (until 30 min after Final)', 'Tell players', 'Confirm only the cards you watched', 'at least 1 day old']), ('back',)]),
      ('bob', [O('low'), ('shot', 'v17_notice_final_lowered', ['lowered 2 confirmed holes by 2', 'Settle up after that']), ('back',)]),
    ]

async def run(size, theme, pw, rep):
    global SEED; SEED = json.loads(urllib.request.urlopen(API + '/__reseed', timeout=120).read())  # a fresh seed for every size and theme
    W, H = SIZES[size]; tv, dk = THEMES[theme]; outdir = OUT + size + '_' + theme + '/'; os.makedirs(outdir, exist_ok=True)
    b = await pw.chromium.launch(); ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, has_touch=size != '1280'); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('Looks like a 5')))
    async def route(r):
        u = r.request.url
        if u.startswith('http://127.0.0.1') or u.startswith('http://localhost'): await r.continue_()
        else: await r.fulfill(status=200, content_type='application/json', body='{}')
    await ctx.route('**/*', route)
    await pg.add_init_script("window.ODD_GOLF_API=%s;try{%s;localStorage.setItem('pics-dark',%s);if(!localStorage.getItem('odd-tok')){localStorage.setItem('odd-tok','t-ann');localStorage.setItem('odd-name','Sir Oddable');}localStorage.setItem('pics-lg','nfl');}catch(e){}" % (json.dumps(API), ("localStorage.setItem('pics-theme','violet')" if tv else "localStorage.removeItem('pics-theme')"), json.dumps(dk)))
    await pg.goto(WEB + '/index.html?mirror=1'); await pg.wait_for_timeout(1200)
    n = [0]
    async def shot(name, needles):
        await pg.wait_for_timeout(420); m = await pg.evaluate(MEASURE, W)
        if m.get('none'): rep.append({'k': size + '/' + theme, 'shot': name, 'bad': ['NO GOLF SCREEN']}); return
        h = min(max(H, m['h']), 9000); await pg.set_viewport_size({'width': W, 'height': h}); await pg.wait_for_timeout(160); m = await pg.evaluate(MEASURE, W)
        n[0] += 1; fn = '%02d_%s' % (n[0], name); await pg.screenshot(path=outdir + fn + '.png'); await pg.set_viewport_size({'width': W, 'height': H})
        bad = []
        if m['sw'] > m['cw'] or m['wide'] or m['docw'] > W: bad.append('SIDEWAYS ' + str(m['wide']) + ' ' + str(m['sw']) + '>' + str(m['cw']))
        if m['small']: bad.append('SMALL ' + str(m['small']))
        if m['overBanner'] is False: bad.append('BANNER SHOWS')
        if m['contrast']: bad.append('CONTRAST ' + '; '.join('%s "%s" %s on %s = %s' % (c['cls'], c['t'], c['fg'], c['bg'], c['r']) for c in m['contrast']))
        t = m['text']
        for nd in needles or []:
            neg = nd.startswith('!'); s = nd[1:] if neg else nd
            if (s in t) == neg: bad.append(('SHOULD NOT SAY ' if neg else 'MISSING TEXT ') + repr(s))
        for junk in ['undefined', 'NaN', '[object', 'Double lock']:
            if junk in t: bad.append('JUNK ' + junk)
        rep.append({'k': size + '/' + theme, 'shot': fn, 'bad': bad})
    async def click(sel): await pg.click('#ogolf ' + sel, timeout=6000); await pg.wait_for_timeout(520)
    async def who(tok):
        await pg.evaluate("(()=>{const o=document.getElementById('ogolf');if(o){const c=o.querySelector('[data-a=close]');if(c)c.click();else o.remove()}})()")
        await pg.evaluate("localStorage.setItem('odd-tok','t-%s');localStorage.setItem('odd-name',%s)" % (tok, json.dumps(NAMES[tok])))
        await pg.reload(); await pg.wait_for_timeout(1100)
        if not await pg.evaluate("typeof window.oddGolf === 'function'"): await pg.add_script_tag(url=WEB + '/golf.js')  # ?mirror=1 pages do not load the overlay themselves
        await pg.evaluate("(()=>{const p=document.getElementById('plb');if(p){p.hidden=false;try{betsRender()}catch(e){}}})()")
        await pg.evaluate("window.oddGolf()"); await pg.wait_for_selector('#ogolf [data-a=newpro]'); await pg.wait_for_timeout(700)
    for tok, steps in (flows17() if os.environ.get('FLOWSET') == 'v17' else flows16() if os.environ.get('FLOWSET') == 'v16' else flows()):
        try:
            await who(tok)
            for st in steps:
                if st[0] == 'open': await click('[data-a=open][data-id="%s"]' % st[1]); await pg.wait_for_timeout(700)
                elif st[0] == 'shot': await shot(tok + '_' + st[1], st[2] if len(st) > 2 else [])
                elif st[0] == 'tab': await click('[data-tab=%s]' % st[1])
                elif st[0] == 'click': await click(st[1])
                elif st[0] == 'back': await click('.oback')
                elif st[0] == 'fill': await pg.fill('#ogolf ' + st[1], st[2]); await pg.wait_for_timeout(200)
                elif st[0] == 'select': await pg.select_option('#ogolf ' + st[1], st[2]); await pg.wait_for_timeout(450)
        except Exception as e:
            rep.append({'k': size + '/' + theme, 'shot': tok + ' FLOW STOPPED', 'bad': [str(e).split('\n')[0][:200]]})
            try: await pg.screenshot(path=outdir + 'ZZ_' + tok + '_stopped.png')
            except Exception: pass
    if errs: rep.append({'k': size + '/' + theme, 'shot': 'PAGE ERRORS', 'bad': list(dict.fromkeys(errs))[:6]})
    await b.close()

async def main():
    sizes = [a for a in sys.argv[1:] if a in SIZES] or list(SIZES); themes = [a for a in sys.argv[1:] if a in THEMES] or list(THEMES); rep = []
    async with async_playwright() as pw:
        for s in sizes:
            for t in themes: await run(s, t, pw, rep)
    bad = [r for r in rep if r['bad']]; lines = ['%s %s: %s' % (r['k'], r['shot'], ' | '.join(r['bad']) if r['bad'] else 'ok') for r in rep]
    json.dump(rep, open(OUT + 'report.json', 'w'), indent=1); open(OUT + 'report.txt', 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(l[:420] for l in lines if not l.endswith(': ok'))); print('%d screens, %d with a problem (report: %sreport.txt)' % (len(rep), len(bad), OUT)); sys.exit(1 if bad else 0)
asyncio.run(main())
