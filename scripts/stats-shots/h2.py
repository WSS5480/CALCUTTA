# Two phone checks on their own, so they can be run against an older checkout's screens (PICS_DIR=<checkout>/pics node scripts/stats-shots/harness.js):
#   H2  what is typed in Post a round survives the players list arriving 1.5 s later
#   L8  the "Saved" toast and the primary button are at least 4.5:1 in violet dark
# Fails on e214bcf, passes now. Usage: python3 scripts/stats-shots/h2.py
import asyncio, sys
from playwright.async_api import async_playwright
API, WEB = 'http://127.0.0.1:8896', 'http://localhost:8897'
RATIO = """(sel) => { const e = document.querySelector(sel), cs = getComputedStyle(e), L = (c) => { const m = c.match(/[\\d.]+/g).map(Number), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); }, a = L(cs.backgroundColor), b = L(cs.color); return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 10) / 10; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 430, 'height': 900}); pg = await ctx.new_page(); bad = []
        async def route(r):
            u = r.request.url
            if u.startswith('http://127.0.0.1') or u.startswith('http://localhost'):
                if '/stats/guest/list' in u: await asyncio.sleep(1.5)
                await r.continue_()
            else: await r.fulfill(status=200, content_type='application/json', body='{}')
        await ctx.route('**/*', route)
        await pg.add_init_script("localStorage.setItem('odd-tok','t-ann');localStorage.setItem('pics-theme','violet');localStorage.setItem('pics-dark','1');window.ODD_GROUPS_API='%s';window.ODD_STATS_API='%s';" % (API, API))
        await pg.goto(WEB + '/index.html'); await pg.wait_for_function("typeof window.oddStats === 'function'"); await pg.wait_for_timeout(1200)
        await pg.evaluate("window.OddStats.open({t:'hcp'})"); await pg.wait_for_selector('#ostat [data-a=post]'); r1 = await pg.evaluate(RATIO, '#ostat .spri'); await pg.click('#ostat [data-a=post]'); await pg.wait_for_selector('#sf_course')
        await pg.fill('#sf_course', 'Cedar Ridge'); await pg.fill('#sf_total', '86'); await pg.wait_for_selector('#sf_guest', timeout=8000); await pg.wait_for_timeout(300)
        got = [await pg.input_value('#sf_course'), await pg.input_value('#sf_total')]
        print(('  ok  ' if got == ['Cedar Ridge', '86'] else '  FAIL ') + 'H2 typing kept after the players list arrived: ' + str(got)); bad += [] if got == ['Cedar Ridge', '86'] else ['H2']
        print(('  ok  ' if r1 >= 4.5 else '  FAIL ') + 'L8 primary button contrast in violet dark: ' + str(r1) + ':1'); bad += [] if r1 >= 4.5 else ['button']
        await pg.fill('#sf_course', 'Cedar Ridge'); await pg.fill('#sf_total', '86'); await pg.click('#ostat [data-a=save]'); await pg.wait_for_selector('#ostat .stoast'); r2 = await pg.evaluate(RATIO, '#ostat .stoast')
        print(('  ok  ' if r2 >= 4.5 else '  FAIL ') + 'L8 "Saved" toast contrast: ' + str(r2) + ':1'); bad += [] if r2 >= 4.5 else ['toast']
        await b.close(); sys.exit(1 if bad else 0)
asyncio.run(main())
