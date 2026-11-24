"""Screenshots of the real RWB app (demo mode, dark theme) for the promo."""
import asyncio, os, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiles

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
U = 'http://localhost:8766/app/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots' + ('-light' if os.environ.get('LIGHT') == '1' else ''))
DARK = os.environ.get('LIGHT') != '1'
FONTS = """@font-face{font-family:'Barlow';src:local('Inter');font-weight:100 900}
@font-face{font-family:'Barlow Condensed';src:local('TeX Gyre Heros Cn Bold'),local('TeXGyreHerosCn-Bold');font-weight:100 900}"""
HIDE = ('.demo-bar,#demo-bar{display:none!important} *{caret-color:transparent!important} :focus-visible{outline:none!important;box-shadow:none!important}'
        '#nav-bar,#net-pill{display:none!important} *{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}')


def dark_tile(z, x, y):
    import io
    from PIL import Image, ImageOps, ImageEnhance
    im = Image.open(io.BytesIO(tiles.tile(z, x, y))).convert('RGB')
    im = ImageOps.invert(im); im = ImageEnhance.Brightness(im).enhance(.55); im = ImageEnhance.Color(im).enhance(.35)
    r, g, b = im.split(); im = Image.merge('RGB', (r, g, b.point(lambda v: min(255, int(v * 1.25)))))
    o = io.BytesIO(); im.save(o, 'PNG'); return o.getvalue()


async def setup(b, role='member'):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=int(os.environ.get("DSF","3")), service_workers='block', locale='en-GB', timezone_id='Asia/Kolkata')
    await ctx.add_init_script("try{Object.defineProperty(Notification,'permission',{get:()=>'default'})}catch(e){}; window.open=()=>null;")
    await ctx.route('**/app/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='const APP_CONFIG = {};'))
    await ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    await ctx.grant_permissions(['geolocation']); await ctx.set_geolocation({'latitude': 22.5726, 'longitude': 88.3639})

    async def tf(r):
        z, x, y = r.request.url.split('?')[0].rsplit('.', 1)[0].split('/')[-3:]
        try: body = dark_tile(int(z), int(x), int(y)) if DARK else tiles.tile(int(z), int(x), int(y))
        except Exception: return await r.abort()
        await r.fulfill(status=200, content_type='image/png', body=body)
    for host in ('https://tile.openstreetmap.org/**', 'https://*.arcgisonline.com/**', 'https://server.arcgisonline.com/**', 'https://*.basemaps.cartocdn.com/**'):
        await ctx.route(host, tf)
    appjs = open(f'{REPO}/app/js/app.js').read().replace("return miss.length || moreMissing(m).length ? 'profile' : null;", "return null;")
    await ctx.route('**/app/js/app.js*', lambda r: r.fulfill(status=200, content_type='text/javascript', body=appjs))
    pg = await ctx.new_page()
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('ok')))
    await pg.goto(U)
    await pg.evaluate("localStorage.clear(); localStorage.setItem('rwb-theme','%s'); localStorage.setItem('rwb-push-dismissed','1'); localStorage.setItem('rwb-notif-first','1')" % ('dark' if DARK else 'light')
                      + (";localStorage.setItem('rwb-demo-fam','1')" if role == 'fam' else ''))
    await pg.goto(U)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000); await pg.click('[data-act=google]', timeout=8000); await pg.wait_for_timeout(1200)
    await pg.evaluate("""(role) => { const k='rwb-app-demo-v2', d=JSON.parse(localStorage.getItem(k));
        const m = d.members[0]; m.role = role === 'fam' ? 'member' : role; m.nickname = 'Rohan'; m.full_name = 'Rohan Das';
        localStorage.setItem(k, JSON.stringify(d)); }""", role)
    await pg.reload(); await pg.wait_for_selector('#boot', state='detached', timeout=30000); await pg.wait_for_timeout(1000)
    await pg.add_style_tag(content=FONTS + HIDE)
    return pg


async def snap(pg, name, route=None, wait=1500, js=None, scroll=0):
    if route is not None:
        await pg.evaluate(f"location.hash = '#{route}'"); await pg.wait_for_timeout(wait)
    if js: await pg.evaluate(js); await pg.wait_for_timeout(900)
    if scroll: await pg.evaluate(f"(document.scrollingElement||document.body).scrollTo(0,{scroll})"); await pg.wait_for_timeout(500)
    await pg.add_style_tag(content=FONTS + HIDE); await pg.wait_for_timeout(300)
    await pg.screenshot(path=f'{OUT}/{name}.jpg', type='jpeg', quality=92)
    print('shot', name)


async def main(which):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await setup(b, 'member')
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        for name, route, extra in [('home', 'home', {}), ('home2', 'home', {'scroll': 520}), ('track', 'track', {'wait': 3500}),
                                   ('motomart', 'motomart', {}), ('events', 'events', {}), ('guides', 'guides', {}),
                                   ('calendar', 'calendar', {}), ('gallery', 'gallery', {'wait': 2500}), ('service', 'service', {}),
                                   ('mileage', 'mileage', {}), ('chat', 'chat', {}), ('me', 'me', {}), ('ride', 'ride', {})]:
            if which and name not in which: continue
            try: await snap(pg, name, route, **extra)
            except Exception as e: print('fail', name, e)
        if errs: print('errors', errs[:3])
        await b.close()

if __name__ == "__main__": asyncio.run(main(sys.argv[1:]))
