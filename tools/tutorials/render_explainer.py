import asyncio, math, os, sys
from playwright.async_api import async_playwright
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut2'
OUT=f'{S}/frames/mgmtx'; os.makedirs(OUT,exist_ok=True)
async def worker(p,k,n,total):
    b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
    await pg.goto(f'file://{S}/build/mgmt-explainer.html'); await pg.wait_for_timeout(1500)
    for f in range(k,total,n):
        await pg.evaluate(f'render({f/30})'); await pg.screenshot(path=f'{OUT}/{f:05d}.jpg',type='jpeg',quality=88)
    await b.close()
async def main():
    async with async_playwright() as p:
        total=math.ceil(225.4*30); n=4
        await asyncio.gather(*[worker(p,k,n,total) for k in range(n)])
asyncio.run(main())
