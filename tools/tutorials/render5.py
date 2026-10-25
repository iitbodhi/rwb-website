import asyncio, math, os, sys
from playwright.async_api import async_playwright
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut2'
OUT=f'{S}/frames/mgmt5'; os.makedirs(OUT,exist_ok=True)
URL=f'file://{S}/build/mgmt-explainer5.html'
async def worker(p,k,n,total):
    b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
    await pg.goto(URL); await pg.wait_for_timeout(1500)
    for f in range(k,total,n):
        await pg.evaluate(f'render({f/30})'); await pg.screenshot(path=f'{OUT}/{f:05d}.jpg',type='jpeg',quality=88)
    await b.close()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
        await pg.goto(URL); await pg.wait_for_timeout(1500)
        if len(sys.argv)>1:
            sc=await pg.evaluate('SCENES.map(s=>[s.id,s.start,s.dur])'); print(sc[-1][1]+sc[-1][2])
            for t in sys.argv[1:]:
                await pg.evaluate(f'render({t})'); await pg.screenshot(path=f'{S}/p5-{t}.jpg',type='jpeg',quality=70)
            open(f'{S}/scenes5.json','w').write(str(sc)); await b.close(); return
        total=math.ceil(await pg.evaluate('TOTAL')*30); await b.close(); n=5
        await asyncio.gather(*[worker(p,k,n,total) for k in range(n)])
        print('frames', total)
asyncio.run(main())
