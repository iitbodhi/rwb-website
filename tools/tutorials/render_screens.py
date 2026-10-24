import asyncio, sys, os, math, json, shutil
from playwright.async_api import async_playwright
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut2'
FPS=30
async def page_for(b, v):
    pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
    await pg.goto(f'file://{S}/build/{v}.html'); await pg.wait_for_timeout(1200); return pg
async def worker(b, v, frames, out):
    pg=await page_for(b, v)
    for i in frames:
        await pg.evaluate(f'render({i/FPS})'); await pg.screenshot(path=f'{out}/{i:05d}.jpg', type='jpeg', quality=90)
async def main(v, W=3, preview=None):
    os.makedirs(f'{S}/build', exist_ok=True)
    data=json.load(open(f'{S}/data/{v}.json'))
    html=open(f'{S}/player.html').read().replace('<script>/*data*/</script>', f'<script>window.TUT={json.dumps(data)};</script>')
    open(f'{S}/build/{v}.html','w').write(html)
    async with async_playwright() as p:
        b=await p.chromium.launch()
        if preview:
            pg=await page_for(b, v)
            for t in preview: await pg.evaluate(f'render({t})'); await pg.screenshot(path=f'{S}/pv-{v}-{t}.jpg', type='jpeg', quality=70)
            print(v, 'total', await pg.evaluate('TOTAL')); await b.close(); return
        out=f'{S}/frames/{v}'; shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
        pg=await page_for(b, v); total=await pg.evaluate('TOTAL'); n=int(math.ceil(total*FPS))
        await asyncio.gather(*[worker(b, v, range(k, n, W), out) for k in range(W)]); await b.close()
    print(v, round(total,1), 's', n, 'frames')
args=sys.argv[1:]
if args and args[0]=='preview': asyncio.run(main(args[1], preview=[float(x) for x in args[2:]]))
else: asyncio.run(main(args[0]))
