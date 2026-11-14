"""Base for recording the RWB App in demo mode: sign in with a role, screenshot each step, remember where the finger taps."""
import asyncio, json, os, base64

S = '/home/claude/work/tut3'
U = 'http://localhost:8766/app/'
HIDE = ('.demo-bar,#demo-bar{display:none!important} *{caret-color:transparent!important} :focus-visible{outline:none!important;box-shadow:none!important}'
        '#nav-bar{display:none!important}')
b64 = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f'{S}/assets/{f}', 'rb').read()).decode()


class Rec:
    def __init__(self, page, name):
        self.p, self.name, self.scenes, self.n = page, name, [], 0
        os.makedirs(f'{S}/shots/{name}', exist_ok=True)

    def scene(self, title, say):
        """title: big words on top. say: list of short spoken sentences (also shown as subtitles)."""
        self.scenes.append({'cap': {'title': title}, 'say': say if isinstance(say, list) else [say], 'beats': []})

    async def _shot(self, tap=None, box=None, overlay=None, hold=None, focus=None):
        self.n += 1
        f = f'shots/{self.name}/{self.n:03d}.png'
        await self.p.add_style_tag(content=HIDE)
        await self.p.wait_for_timeout(120)
        await self.p.screenshot(path=f'{S}/{f}')
        self.scenes[-1]['beats'].append({'img': f, 'tap': tap, 'box': box, 'overlay': overlay, 'focus': focus, 'hold': hold or (2.0 if tap else 1.6)})

    async def shot(self, hold=None, wait=0, focus=None):
        """focus: the y (in app pixels, 0-844) the zoomed view should centre on; default: where it looked last"""
        if wait: await self.p.wait_for_timeout(wait)
        await self._shot(hold=hold, focus=focus)

    async def _center(self, sel, scroll=True):
        el = self.p.locator(sel).first
        if scroll: await el.evaluate("e => { const r = e.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 90) e.scrollIntoView({block: 'center', behavior: 'instant'}); }")
        await self.p.wait_for_timeout(250)
        b = await el.bounding_box()
        return el, [round(b['x'] + b['width'] / 2), round(b['y'] + b['height'] / 2)], [round(b['x']), round(b['y']), round(b['width']), round(b['height'])]

    async def tap(self, sel, click=True, wait=800, hold=None, scroll=True):
        el, c, box = await self._center(sel, scroll)
        await self._shot(tap=c, box=box, hold=hold)
        if not click: self.scenes[-1]['beats'][-1]['point'] = True
        if click: await el.click(); await self.p.wait_for_timeout(wait)

    async def type(self, sel, text, wait=300, hold=1.6):
        el, c, box = await self._center(sel)
        await self._shot(tap=c, box=box, hold=1.5)
        await el.fill(text); await el.dispatch_event('input'); await self.p.wait_for_timeout(wait)
        await self._shot(hold=hold)

    async def select(self, sel, value):
        el, c, box = await self._center(sel)
        await self._shot(tap=c, box=box, hold=1.5)
        await el.select_option(value); await el.dispatch_event('change'); await self.p.wait_for_timeout(300)
        await self._shot(hold=1.4)

    async def upload(self, label_sel, input_sel, files, wait=1500):
        el, c, box = await self._center(label_sel)
        await self._shot(tap=c, box=box, hold=1.6)
        await self.p.set_input_files(input_sel, [f'{S}/assets/{f}' for f in files]); await self.p.wait_for_timeout(wait)
        await self._shot(hold=1.7)

    async def back(self, wait=500):
        await self.p.keyboard.press('Escape'); await self.p.wait_for_timeout(wait)

    def save(self, title):
        json.dump({'title': title, 'scenes': self.scenes}, open(f'{S}/data/{self.name}.json', 'w'), indent=1)
        beats = sum(len(s['beats']) for s in self.scenes)
        print(self.name, 'scenes', len(self.scenes), 'beats', beats, 'raw', round(sum(b['hold'] for s in self.scenes for b in s['beats']), 1), 's')


async def setup(b, role='member', w=390, h=844, scale=2):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=scale, service_workers='block', locale='en-GB', timezone_id='Asia/Kolkata')
    await ctx.add_init_script("try{Object.defineProperty(Notification,'permission',{get:()=>'default'})}catch(e){}; window.open=()=>null;")
    await ctx.route('**/app/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='const APP_CONFIG = {};'))
    await ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    await ctx.route('**/tutimg/*', lambda r: r.fulfill(status=200, content_type='image/png', body=open(f"{S}/assets/{r.request.url.rsplit('/',1)[1]}", 'rb').read()))
    await ctx.grant_permissions(['geolocation']); await ctx.set_geolocation({'latitude': 22.5726, 'longitude': 88.3639})
    import tiles; await tiles.route(ctx)
    api = open('/home/claude/rwb-website/app/js/api.js').read().replace(": 'demo.pdf',", ": (title === 'First free service checklist' ? 'https://guides.rwb.test/checklist.pdf' : 'demo.pdf'),")
    await ctx.route('**/app/js/api.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=api))
    pg = await ctx.new_page()
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('ok')))
    await pg.route('https://guides.rwb.test/**', lambda r: r.fulfill(status=200, content_type='application/pdf', body=open(f'{S}/assets/checklist.pdf', 'rb').read()))
    await pg.route('https://wa.me/**', lambda r: r.abort())
    await pg.route('**/*heic2any*', lambda r: r.abort())
    await pg.goto(U)
    await pg.evaluate("localStorage.clear(); localStorage.setItem('rwb-theme','light'); localStorage.setItem('rwb-push-dismissed','1'); localStorage.setItem('rwb-notif-first','1')" + (";localStorage.setItem('rwb-demo-fam','1')" if role == 'fam' else ''))
    await pg.goto(U)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000); await pg.click('[data-act=google]', timeout=8000); await pg.wait_for_timeout(1200)
    await pg.evaluate("""(role) => { const k='rwb-app-demo-v2', d=JSON.parse(localStorage.getItem(k));
        const m = d.members[0]; m.role = role === 'fam' ? 'member' : role;
        if (role === 'member' || role === 'fam') { m.nickname = 'Rohan'; m.full_name = 'Rohan Das'; } else { m.nickname = 'Bodhi'; m.full_name = 'Bodhi'; }
        localStorage.setItem(k, JSON.stringify(d)); }""", role)
    await pg.reload(); await pg.wait_for_selector('#boot', state='detached', timeout=30000); await pg.wait_for_timeout(1000)
    return pg


async def run(videos, roles, names):
    from playwright.async_api import async_playwright
    import shutil
    os.makedirs(f'{S}/data', exist_ok=True)
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for n in names:
            shutil.rmtree(f'{S}/shots/{n}', ignore_errors=True)
            pg = await setup(b, roles.get(n, 'member'))
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            r = Rec(pg, n)
            try: await videos[n](r)
            except Exception as e:
                print(n, 'FAILED:', str(e).split('\n')[0][:300], '| scene', len(r.scenes), r.scenes[-1]['cap']['title'] if r.scenes else '')
                await pg.screenshot(path=f'{S}/fail-{n}.png')
            if errs: print(n, 'page errors', errs[:3])
            await pg.context.close()
        await b.close()
