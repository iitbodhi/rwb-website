import asyncio, sys, os, math
from playwright.async_api import async_playwright
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut'
FPS=30
async def worker(b, v, frames, out):
    pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
    await pg.goto(f'file://{S}/tutorial.html?v={v}'); await pg.wait_for_timeout(700)
    for i in frames:
        await pg.evaluate(f'render({i/FPS})')
        await pg.screenshot(path=f'{out}/{i:05d}.jpg', type='jpeg', quality=92)
async def main(v, W=3):
    out=f'{S}/frames-{v}'; os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
        await pg.goto(f'file://{S}/tutorial.html?v={v}'); await pg.wait_for_timeout(500)
        total=await pg.evaluate('TOTAL'); n=int(math.ceil(total*FPS))
        await asyncio.gather(*[worker(b, v, range(k, n, W), out) for k in range(W)])
        await b.close()
    print(v, n, 'frames')
asyncio.run(main(sys.argv[1]))
