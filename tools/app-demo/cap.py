import asyncio, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.pop('LIGHT', None)
import shoot, tiles2  # noqa
shoot.tiles.tile = tiles2.tile
from playwright.async_api import async_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots'); os.makedirs(OUT, exist_ok=True)

class F:
    def __init__(s, pg, name): s.pg, s.name, s.steps = pg, name, []
    async def shot(s, cap, sel=None, click=True, wait=1200, scroll=True):
        pg = s.pg; box = None
        if sel:
            el = pg.locator(sel).first
            if scroll: await el.evaluate("e=>{const r=e.getBoundingClientRect(); if(r.top<70||r.bottom>innerHeight-90) e.scrollIntoView({block:'center',behavior:'instant'})}")
            await pg.wait_for_timeout(300)
            bb = await el.bounding_box(); box = [round(bb['x']), round(bb['y']), round(bb['width']), round(bb['height'])]
        await pg.add_style_tag(content=shoot.FONTS + shoot.HIDE); await pg.wait_for_timeout(250)
        n = len(s.steps) + 1; f = f'{s.name}-{n}.jpg'
        await pg.screenshot(path=f'{OUT}/{f}', type='jpeg', quality=90)
        s.steps.append({'img': f, 'tap': box, 'cap': cap})
        if sel and click: await pg.locator(sel).first.click(); await pg.wait_for_timeout(wait)

async def go(pg, h, w=1300): await pg.evaluate(f"location.hash='#{h}'"); await pg.wait_for_timeout(w)

async def track(f, pg):
    await f.shot('Going for a ride? Tap Track.', '#track-tab')
    await f.shot('Tap View to see who’s riding.', '[data-x=view]', wait=3500)
    await f.shot('Every RWB rider sharing, live. Tap a rider.', '.leaflet-marker-icon:has-text("AS")', scroll=False)
    await f.shot('Speed, distance and directions to them.')
async def sos(f, pg):
    await f.shot('In trouble on the road? Tap Track.', '#track-tab')
    await f.shot('Tap SOS.', '[data-x=sos]', wait=1500)
    await f.shot('Hold for 2 seconds. The RWB team gets your location at once.')
async def fam(f, pg):
    await f.shot('Tap FAM to invite your family.', '[data-act=fam]', wait=1400)
    await f.shot('Up to 3 family members see you’re safe when you share your ride.')
async def service(f, pg):
    await go(pg, 'service')
    await f.shot('Every service, with its bill. Tap Add service.', '[data-act=add-service] >> visible=true', wait=1200)
    await f.shot('Today’s date and your km are filled in for you.')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500); await go(pg, 'mileage')
    await f.shot('And your real km/l, compared with all of RWB.')
async def events(f, pg):
    await go(pg, 'events')
    await f.shot('Coming rides and meets. Tap a ride.', '.evt-card')
    await f.shot('Time, place and the plan. Tap Going.', '[data-act=rsvp][data-s=going]')
    await f.shot('You’re in. Costs are shared right here.')
async def motomart(f, pg):
    await go(pg, 'motomart')
    await f.shot('Gear from riders you trust. Tap an item.', '.mm-card:has-text("Helmet") >> nth=0')
    await f.shot('Photos, price and condition. Message the rider to buy.')
async def pookie(f, pg):
    await f.shot('Got a bike question? Tap Pookie.', '#pookie-fab', wait=1400)
    await f.shot('Tap a question, or type your own.', '[data-act=suggest] >> nth=0', wait=4500)
    await f.shot('Answers from what RWB riders taught Pookie.')
async def boards(f, pg):
    await f.shot('Tap Warriors.', 'a[data-tab=crew]', wait=2600)
    await f.shot('The top riders of RWB. Tap a board.', '[data-act=board][data-b=mileage]', wait=2200)
    await f.shot('Every km you ride with Track counts.')

FLOWS = dict(track=track, sos=sos, fam=fam, service=service, events=events, motomart=motomart, pookie=pookie, boards=boards)

async def main(names):
    res = {}
    FJ = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flows.json')
    if os.path.exists(FJ): res = json.load(open(FJ))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for n in names or FLOWS:
            pg = await shoot.setup(b, 'member')
            f = F(pg, n)
            try: await FLOWS[n](f, pg); res[n] = f.steps; print(n, len(f.steps))
            except Exception as e: print(n, 'FAIL', str(e).split('\n')[0][:200]); await pg.screenshot(path=os.path.join(OUT, f'fail-{n}.png'))
            await pg.context.close()
        await b.close()
    json.dump(res, open(FJ, 'w'), indent=1)
asyncio.run(main(sys.argv[1:]))
