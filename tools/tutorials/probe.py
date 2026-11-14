"""probe.py ROLE OUTNAME 'python steps using p'  -> screenshot + list of clickable things"""
import asyncio, sys
from playwright.async_api import async_playwright
from rec import setup, S
JS = """() => [...document.querySelectorAll('a,button,input,select,textarea,label,[data-act],summary')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight; })
 .map(e => { const a = [...e.attributes].filter(x => /^(data-|id$|class$|href$|name$|type$)/.test(x.name)).map(x => x.name + '=' + x.value.slice(0, 40)).join(' ');
   return e.tagName.toLowerCase() + ' [' + a + '] ' + (e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 50); })"""
async def main(role, out, code):
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); p = await setup(b, role, scale=1)
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        ns = {'p': p}
        exec('async def _f(p):\n' + '\n'.join('    ' + l for l in code.split('\n')), ns)
        try: await ns['_f'](p)
        except Exception as e: print('STEP ERROR', str(e)[:300])
        await p.wait_for_timeout(600)
        await p.screenshot(path=f'{S}/probe/{out}.png')
        if '--noels' not in sys.argv: print('\n'.join(await p.evaluate(JS)))
        print('errs', errs[:3]); await b.close()
asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3]))
