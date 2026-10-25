"""Drive the real RWB App (demo mode, member view), screenshot every step, and write a timeline for player.html."""
import asyncio, json, os, sys, base64
from playwright.async_api import async_playwright

S = '/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut2'
U = 'http://localhost:8766/app/'
UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
HIDE = '.demo-bar{display:none!important} *{caret-color:transparent!important}'
b64 = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f'{S}/assets/{f}', 'rb').read()).decode()

GUIDES = [{"id": "g1", "name": "Chain_Cleaning_and_Lubrication.pdf", "date": "2026-10-20T00:00:00Z", "description": "Step-by-step chain care every 500–700 km"},
          {"id": "g2", "name": "Engine_Oil_Change_Guide.pdf", "date": "2026-10-02T00:00:00Z", "description": "Which oil, how much and how often"},
          {"id": "g3", "name": "Brake_Pad_Check_and_Replacement.pdf", "date": "2026-09-14T00:00:00Z", "description": ""},
          {"id": "g4", "name": "Tyre_Pressure_and_Puncture_Kit.pdf", "date": "2026-08-30T00:00:00Z", "description": "Pressures, checks and roadside fixes"}]
ACC = 'name,category,score,price,link,image\n' + '\n'.join([
    'Rynox Air GT gloves,Gloves,4.5,"2,450",https://example.com/g,http://localhost:8766/tutimg/gloves.png',
    'Mesh riding jacket,Riding jacket,4.2,"5,990",https://example.com/j,http://localhost:8766/tutimg/jacket.png',
    'Quad-lock phone mount,Electronics,4.7,"3,200",https://example.com/m,http://localhost:8766/tutimg/mount.png',
    'Disc lock with alarm,Security,4.0,"1,450",https://example.com/l,http://localhost:8766/tutimg/lock.png'])
PDF_PAGE = """<html><body style="margin:0;background:#525659;font-family:Inter,sans-serif"><div style="background:#fff;margin:14px;padding:28px 24px;min-height:900px">
<h1 style="font:800 30px/1.05 'Barlow Condensed';text-transform:uppercase;margin:0">Chain cleaning &amp; lubrication</h1><div style="height:5px;width:90px;background:#d4501a;margin:12px 0 18px"></div>
<p style="font-size:14px;line-height:1.6;color:#333">Do this every <b>500–700 km</b>, and after any ride in rain.</p>
<ol style="font-size:14px;line-height:1.7;color:#333;padding-left:18px"><li>Put the bike on a paddock stand, engine off.</li><li>Spray chain cleaner on the lower run while turning the wheel.</li><li>Scrub with a 3-sided brush, wipe dry.</li><li>Apply chain lube on the inside of the chain.</li><li>Let it set for 15 minutes before riding.</li><li>Check slack: 25–35 mm at the middle of the lower run.</li></ol></div></body></html>"""
CONFIRM = lambda msg: f"""<div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>
<div style="position:absolute;left:30px;right:30px;top:330px;height:178px;background:#fff;border-radius:22px;padding:24px 24px 0;font-family:Inter,sans-serif;color:#1c1b1f;box-shadow:0 10px 40px rgba(0,0,0,.3)">
<p style="font:500 17px Inter;margin:0 0 10px">roninwb.in says</p><p style="font:400 15px/1.45 Inter;color:#444;margin:0">{msg}</p>
<div style="position:absolute;right:20px;bottom:16px;display:flex;gap:34px;font:600 15px Inter;color:#1a73e8"><span>Cancel</span><span>OK</span></div></div>"""
CONFIRM_OK = [328, 489]


class Rec:
    def __init__(self, page, name):
        self.p, self.name, self.scenes, self.n = page, name, [], 0
        os.makedirs(f'{S}/shots/{name}', exist_ok=True)

    def scene(self, step, title, sub):
        self.scenes.append({'cap': {'step': step, 'title': title, 'sub': sub}, 'beats': []})

    async def _shot(self, tap=None, overlay=None, hold=None):
        self.n += 1
        f = f'shots/{self.name}/{self.n:03d}.png'
        await self.p.add_style_tag(content=HIDE)
        await self.p.screenshot(path=f'{S}/{f}')
        self.scenes[-1]['beats'].append({'img': f, 'tap': tap, 'overlay': overlay, 'hold': hold or (1.8 if tap else 1.5)})

    async def shot(self, hold=None, wait=0):
        if wait: await self.p.wait_for_timeout(wait)
        await self._shot(hold=hold)

    async def _center(self, sel):
        el = self.p.locator(sel).first
        await el.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
        await self.p.wait_for_timeout(250)
        b = await el.bounding_box()
        return el, [round(b['x'] + b['width'] / 2), round(b['y'] + b['height'] / 2)]

    async def tap(self, sel, click=True, wait=750, hold=None):
        el, c = await self._center(sel)
        await self._shot(tap=c, hold=hold)
        if click: await el.click(); await self.p.wait_for_timeout(wait)

    async def type(self, sel, text, wait=300):
        el, c = await self._center(sel)
        await self._shot(tap=c, hold=1.3)
        await el.fill(text); await el.dispatch_event('input'); await self.p.wait_for_timeout(wait)
        await self._shot(hold=1.4)

    async def select(self, sel, value):
        el, c = await self._center(sel)
        await self._shot(tap=c, hold=1.3)
        await el.select_option(value); await el.dispatch_event('change'); await self.p.wait_for_timeout(300)
        await self._shot(hold=1.3)

    async def upload(self, label_sel, input_sel, files, wait=1500):
        el, c = await self._center(label_sel)
        await self._shot(tap=c, hold=1.4)
        await self.p.set_input_files(input_sel, [f'{S}/assets/{f}' for f in files]); await self.p.wait_for_timeout(wait)
        await self._shot(hold=1.6)

    async def confirm(self, sel, msg, wait=900):
        el, c = await self._center(sel)
        await self._shot(tap=c, hold=1.6)
        await self._shot(tap=CONFIRM_OK, overlay=CONFIRM(msg), hold=1.7)
        await el.click(); await self.p.wait_for_timeout(wait)

    def save(self, title, intro, outro):
        json.dump({'title': title, 'intro': intro, 'outro': outro, 'scenes': self.scenes}, open(f'{S}/data/{self.name}.json', 'w'), indent=1)
        beats = sum(len(s['beats']) for s in self.scenes)
        print(self.name, 'scenes', len(self.scenes), 'beats', beats, 'approx', round(sum(b['hold'] for s in self.scenes for b in s['beats']) + 8.5, 1), 's')


async def setup(b, role='member'):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, user_agent=UA, service_workers='block', locale='en-IN', timezone_id='Asia/Kolkata')
    await ctx.add_init_script("try{Object.defineProperty(Notification,'permission',{get:()=>'default'})}catch(e){}; window.open=()=>null;")
    pg = await ctx.new_page()
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('ok')))
    await pg.route('https://script.google.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(GUIDES)))
    await pg.route('https://docs.google.com/**', lambda r: r.fulfill(status=200, content_type='text/csv', body=ACC))
    await pg.route('https://drive.google.com/thumbnail**', lambda r: r.fulfill(status=200, content_type='image/png', body=open(f'{S}/assets/pdfthumb.png', 'rb').read()))
    await pg.route('https://drive.google.com/file/**', lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=PDF_PAGE))
    await pg.route('https://wa.me/**', lambda r: r.abort())
    await pg.route('**/*heic2any*', lambda r: r.abort())
    await pg.goto(U); await pg.evaluate("localStorage.clear(); localStorage.setItem('rwb-theme','light'); localStorage.setItem('rwb-push-dismissed','1')"); await pg.goto(U)
    await pg.wait_for_timeout(500); await pg.click('[data-act=google]'); await pg.wait_for_timeout(900)
    photos = {1: [b64('helmet1.png'), b64('helmet2.png')], 2: [b64('jacket.png')], 3: [b64('lock.png')], 4: [b64('mount.png')]}
    await pg.evaluate("""(ph) => { const k='rwb-app-demo-v2', d=JSON.parse(localStorage.getItem(k));
        Object.assign(d.members[0], { role: ROLE, nickname: ROLE === 'member' ? 'Warrior' : 'Bodhi', full_name: ROLE === 'member' ? 'Warrior Rider' : 'Bodhisatwa Admin' }); const ag = n => new Date(Date.now() - n * 864e5).toISOString(); d.members.find(m => m.id === 3).joined_at = ag(1); d.members.find(m => m.id === 5).joined_at = ag(4); const sp = d.members.find(m => m.id === 5); if (sp) sp.user_id = 'u5';
        for (const l of d.listings) if (ph[l.id]) l.photos = ph[l.id];
        for (const l of d.listings) if (l.user_id === 'me') l.seller_name = 'Warrior Rider';
        localStorage.setItem(k, JSON.stringify(d)); }""".replace('ROLE', repr(role)), {str(k): v for k, v in photos.items()})
    await pg.reload(); await pg.wait_for_timeout(1300)
    return pg

# ---------------------------------------------------------------- the seven videos
async def service(r):
    p = r.p
    r.scene('Step 1', 'Open Service', 'Tap <b>Service</b> in the bottom bar. You see your totals and when your <b>next service</b> is due.')
    await r.tap('a[data-tab=service]', wait=900); await r.shot(hold=2.2)
    r.scene('Step 2', 'Add a service', 'Tap <b>＋ Add service</b>. Today\'s date and your latest km are already filled in.')
    await r.tap('[data-act=add-service] >> visible=true', wait=700); await r.shot(hold=1.6)
    r.scene('Step 3', 'Type and centre', 'Pick the <b>service type</b>, then search the <b>service centre</b> by name, area or pincode. Not listed? Choose <b>Other</b>.')
    await r.select('#sf select[name=service_type]', 'paid')
    await r.tap('#cp-btn', wait=700); await r.type('#cp-q', 'park'); await r.tap('.cp-item:not(.cp-new)', wait=400)
    r.scene('Step 4', 'What was done', 'Tap everything that was done, then add the <b>total cost</b>.')
    for t in ['Engine oil change', 'Oil filter', 'Chain clean & lube']:
        await r.tap(f'#items .chip:text-is("{t}")', wait=200, hold=1.2)
    await r.type('#sf input[name=cost]', '1850')
    r.scene('Step 5', 'Attach the bill', 'Tap <b>📷 Photo</b> for a picture of the bill, or <b>📄 PDF / Word</b> for a file. Then <b>Save service</b>.')
    await r.upload('#pick .file-pick >> nth=0', '#pick input >> nth=0', ['bill.png'])
    await r.tap('#sf > button.btn.block', wait=1100); await r.shot(hold=1.8)
    r.scene('Step 6', 'View and edit', 'Tap a service to see it. <b>🧾 View bill</b> opens the bill; <b>Edit</b> lets you change anything.')
    await r.tap('[data-act=open] >> nth=0', wait=700)
    await r.tap('[data-x=bill]', wait=900); await r.shot(hold=1.5)
    await r.tap('[data-x=back]', wait=700)
    await r.tap('[data-x=edit]', wait=700); await r.type('#sf input[name=cost]', '1950')
    await r.tap('#sf > button.btn.block', wait=1100)
    r.scene('Step 7', 'Delete a record', 'Open it, tap <b>Delete this record</b> and confirm. The bill is deleted too.')
    await r.tap('[data-act=open] >> nth=0', wait=700)
    await r.confirm('[data-x=del]', 'Delete this service record and its bill?'); await r.shot(hold=1.8)
    r.save('Service', 'Log every service, keep your bills and never miss the next one.', 'Your bike\'s full history, always in your pocket.')

async def mileage(r):
    r.scene('Step 1', 'Open Mileage', 'Tap <b>Mileage</b>. Your average km/l, last and best tank, and fuel cost per km are on top.')
    await r.tap('a[data-tab=mileage]', wait=1000); await r.shot(hold=1.8)
    r.scene('Step 2', 'How Trip A works', 'New to it? Tap <b>How to track mileage with Trip A</b>: fill to full, reset Trip A, and at the next full fill enter the Trip A km.')
    await r.tap('#howto summary', wait=500); await r.shot(hold=2.2); await r.tap('#howto summary', wait=400)
    r.scene('Step 3', 'Add a fill-up', 'Tap <b>＋ Add fuel</b>. Enter the litres, the amount, and your <b>Trip A</b> reading. Your km/l shows instantly.')
    await r.tap('[data-act=add-fuel] >> visible=true', wait=700)
    await r.type('#ff input[name=litres]', '9.6'); await r.type('#ff input[name=amount]', '1025'); await r.type('#ff input[name=trip_a_km]', '402')
    await r.tap('#ff > button.btn.block', wait=1100); await r.shot(hold=1.6)
    r.scene('Step 4', 'You vs RWB', 'See how your mileage compares with other warriors, and open <b>Tips to get more km/l</b>.')
    await r.tap('.tips summary', wait=500); await r.shot(hold=2.0)
    r.scene('Step 5', 'Spends and mileage', 'Switch between <b>Weekly, Monthly, 3 months, 6 months</b> and <b>Yearly</b>. Tap any bar to see that period.')
    await r.tap('[data-per=week]', wait=500); await r.tap('.t-hit >> nth=-2', wait=300, click=True); await r.shot(hold=1.6)
    r.scene('Step 6', 'Edit or delete', 'Tap a fill-up to fix it. To remove it, tap <b>Delete this fill-up</b> and confirm.')
    await r.tap('button.item[data-act=open] >> nth=0', wait=700); await r.type('#ff input[name=litres]', '9.8')
    await r.tap('#ff > button.btn.block', wait=1100)
    await r.tap('button.item[data-act=open] >> nth=0', wait=700)
    await r.confirm('#del', 'Delete this fill-up?'); await r.shot(hold=1.6)
    r.save('Mileage', 'Track your real km/l with Trip A, and see how you compare.', 'Fill to full, note Trip A, ride on.')

async def motomart(r):
    r.scene('Step 1', 'Browse Motomart', 'Tap <b>Motomart</b>. Search, or tap a category to filter used gear from fellow Ronins.')
    await r.tap('a[data-tab=motomart]', wait=1000)
    await r.type('#mmq', 'helmet', wait=900)
    await r.p.fill('#mmq', ''); await r.p.dispatch_event('#mmq', 'input'); await r.p.wait_for_timeout(900)
    r.scene('Step 2', 'Contact a seller', 'Tap an item for photos and details, then <b>Message seller on WhatsApp</b>.')
    await r.tap('.mm-card:has-text("Axor")', wait=800)
    await r.tap('a.btn.wa', click=False, hold=2.0)
    await r.p.keyboard.press('Escape'); await r.p.wait_for_timeout(400)
    r.scene('Step 3', 'Sell your gear', 'Tap <b>＋ Sell something</b> and add up to 5 clear photos.')
    await r.tap('[data-act=sell] >> visible=true', wait=700)
    await r.upload('#lf .file-pick', '#pics', ['helmet1.png', 'helmet2.png'])
    r.scene('Step 4', 'Fill in the details', 'Name, category, condition and price. The post goes live after the RWB team approves it, usually within a day.')
    await r.type('#lf input[name=product_name]', 'Steelbird SBA-7 helmet')
    await r.select('#lf select[name=category]', 'Helmet'); await r.select('#lf select[name=condition]', 'Like new')
    await r.type('#lf input[name=price]', '3500')
    await r.tap('#lf > button.btn.block', wait=1200); await r.shot(hold=1.4)
    r.scene('Step 5', 'My posts', 'Tap <b>My posts</b> to see yours. A live post can be <b>shared</b> to the WhatsApp group or <b>marked as sold</b>.')
    await r.tap('[data-act=mine]', wait=800)
    await r.tap('.mm-card:has-text("Rynox")', wait=800)
    await r.tap('[data-x=toggle]', wait=1100); await r.shot(hold=1.4)
    r.scene('Step 6', 'Edit or delete', 'Open your post to <b>Edit</b> it, or <b>Delete post</b> to remove it with its photos.')
    await r.tap('.mm-card:has-text("Rynox")', wait=800)
    await r.tap('[data-x=edit]', wait=700); await r.type('#lf input[name=price]', '5800')
    await r.tap('#lf > button.btn.block', wait=1200)
    await r.tap('.mm-card:has-text("Rynox")', wait=800)
    await r.confirm('[data-x=del]', 'Delete this post and its photos?'); await r.shot(hold=1.6)
    r.save('Motomart', 'Buy and sell used riding gear within RWB.', 'Clear photos and a fair price sell fastest.')

async def guides(r):
    r.scene('Step 1', 'Open Guides', 'Tap <b>Guides</b>. <b>Maintenance</b> has how-to guides from our coordinators.')
    await r.tap('a[data-tab=guides]', wait=1200); await r.shot(hold=1.4)
    r.scene('Step 2', 'Search a guide', 'Type any keyword, like <b>chain</b> or <b>brakes</b>. Words can be in any order.')
    await r.type('#gq', 'chain', wait=400)
    r.scene('Step 3', 'Read it in the app', 'Tap a guide to read it right here. <b>Open in Google Drive</b> lets you download it.')
    await r.tap('#gl [data-act=pdf] >> nth=0', wait=1300); await r.shot(hold=2.2)
    await r.p.keyboard.press('Escape'); await r.p.wait_for_timeout(400)
    r.scene('Step 4', 'Recommended gear', 'Switch to <b>Accessories</b> for gear tested and scored by RWB. Filter by category or sort by price or rating.')
    await r.tap('[data-act=tab][data-tab=acc]', wait=1200); await r.shot(hold=1.4)
    await r.select('#asort', 'rating-desc')
    await r.tap('[data-act=cat]:text-is("Gloves")', wait=500)
    r.scene('Step 5', 'View the product', 'Tap <b>View product ↗</b> to open it in the store.')
    await r.tap('a:has-text("View product")', click=False, hold=2.0)
    r.scene('Tip', "Can't find something?", 'Tap <b>Can\'t find it? Ask Pookie</b> and get an answer from the RWB AI.')
    await r.tap('text=Can\'t find it?', wait=1000); await r.shot(hold=1.8)
    r.save('Guides', 'Maintenance how-tos and recommended gear, all in one place.', 'Learn it once, ride better forever.')

async def events(r):
    r.scene('Step 1', 'Find an event', 'Tap <b>Events</b> for upcoming rides and meet-ups. Tap one for the details.')
    await r.tap('a[data-tab=events]', wait=1100); await r.tap('.evt-card >> nth=0', wait=1200); await r.shot(hold=1.4)
    r.scene('Step 2', 'Respond', 'Tap <b>Going</b>, <b>Maybe</b> or <b>Can\'t go</b>. If guests are allowed, switch on <b>Bringing a guest</b>.')
    await r.tap('[data-act=rsvp][data-s=going]', wait=1300)
    await r.tap('label.switch:has(#evt-guest)', wait=1300)
    r.scene('Step 3', 'Share or save it', '<b>Share</b> posts it in WhatsApp. <b>Add to calendar</b> saves it to your calendar. <b>Open in Maps</b> shows the way.')
    await r.tap('[data-act=evt-share]', click=False, hold=1.6)
    r.scene('Step 4', 'Add an expense', 'Paid for something for the group? Tap <b>＋ Add expense</b>, enter it and choose <b>who to split it with</b>.')
    await r.tap('[data-act=exp-add]', wait=700)
    await r.type('#exf input[name=title]', 'Breakfast at Kolaghat'); await r.type('#exf input[name=amount]', '1200')
    await r.tap('.split-row:has-text("Sourav") input', wait=300) if await r.p.locator('.split-row:has-text("Sourav")').count() else None
    await r.tap('#exf > button.btn.block', wait=1200); await r.shot(hold=1.5)
    r.scene('Step 5', 'Settle up', '<b>Settle up</b> shows the fewest payments to clear everyone. <b>Mark paid</b> when you\'re paid, and <b>share</b> it on WhatsApp.')
    await r.tap('[data-act=exp-settle]', wait=800)
    await r.confirm('[data-paid] >> nth=0', 'Record this payment?', wait=1100); await r.shot(hold=1.5)
    r.scene('Step 6', 'Edit or delete', 'Tap an expense to <b>Edit</b> or <b>Delete</b> it. Only the person who added it can change it.')
    await r.tap('button.exp-row >> nth=0', wait=700); await r.tap('#sheet [data-x=edit]', wait=700)
    await r.type('#exf input[name=amount]', '1260'); await r.tap('#exf > button.btn.block', wait=1100)
    await r.tap('button.exp-row >> nth=0', wait=700)
    await r.confirm('#sheet [data-x=del]', 'Delete this expense?'); await r.shot(hold=1.5)
    r.save('Events', 'RSVP to rides and split trip costs, all in one place.', 'See you on the next ride.')

async def me(r):
    r.scene('Step 1', 'Open your profile', 'Tap your <b>photo</b> at the top right. Your details from the RWB join form are here.')
    await r.tap('.top a.avatar-link', wait=900); await r.shot(hold=1.4)
    r.scene('Step 2', 'Add a photo', 'Tap the <b>📷</b> on your picture to add or change your profile photo.')
    await r.upload('.photo-pick', '#pic', ['avatar.png'], wait=1800)
    r.scene('Step 3', 'Edit your details', 'Tap <b>Edit</b> to update your nickname, bike, locality and more, then <b>Save</b>.')
    await r.tap('.profile [data-act=edit]', wait=800)
    await r.type('#mf input[name=locality]', 'Salt Lake, Sector 5')
    await r.tap('#mf > button.btn.block', wait=1100)
    r.scene('Step 4', 'Light or dark', 'Choose <b>Light</b>, <b>Dark</b> or <b>Auto</b> to follow your phone.')
    await r.tap('[data-act=theme][data-t=dark]', wait=600); await r.shot(hold=1.4)
    await r.tap('[data-act=theme][data-t=light]', wait=600)
    r.scene('Step 5', 'Notifications', 'Turn on notifications, and choose which ones you want. RWB announcements and events always come through.')
    await r.tap('#notif-card', click=False, hold=1.8)
    await r.tap('label.toggle-row:has-text("New members on the app")', wait=500)
    r.scene('Step 6', 'WhatsApp and privacy', 'Pick which <b>WhatsApp</b> opens links. Switch off <b>Show me on the leaderboards</b> to stay private.')
    await r.select('#wa-app', 'wa')
    await r.tap('label.toggle-row:has(#lb)', wait=900); await r.shot(hold=1.3)
    await r.tap('label.toggle-row:has(#lb)', wait=900)
    r.scene('Step 7', 'Privacy and sign out', 'Read the <b>Privacy</b> policy any time. <b>Sign out</b> is at the very bottom.')
    await r.tap('[data-act=out]', click=False, hold=2.0)
    r.save('Me', 'Your profile, photo, theme, notifications and privacy.', 'Make the app yours.')

async def crew(r):
    r.scene('Step 1', 'Open RWB', 'Tap the big <b>RWB logo</b> in the middle of the bottom bar.')
    await r.tap('a[data-tab=crew]', wait=1300); await r.shot(hold=1.6)
    r.scene('Step 2', 'Three leaderboards', '<b>Mileage</b> Warriors (best km/l), <b>Service</b> Warriors (most services logged) and <b>Road</b> Warriors (most km).')
    await r.tap('[data-act=board][data-b=service]', wait=600); await r.shot(hold=1.3)
    await r.tap('[data-act=board][data-b=road]', wait=600); await r.shot(hold=1.3)
    r.scene('Step 3', 'The RWB team', 'Admins and coordinators are pinned on top. Tap <b>📞</b> to call or the green button to WhatsApp them, in any emergency.')
    await r.tap('.team-row .call >> nth=0', click=False, hold=2.2)
    r.scene('Step 4', 'Find a member', 'Search by <b>name</b>, <b>place</b> or <b>bike number</b>. Met a Ronin on the road? Type their number plate to see if they\'re with RWB.')
    await r.type('#cq', 'WB 06', wait=400)
    await r.type('#cq', 'WB 99 ZZ 1234', wait=400)
    await r.type('#cq', 'howrah', wait=400)
    r.scene('Tip', 'Your privacy', 'Don\'t want to be on the leaderboards? Turn it off in <b>Me → Privacy</b>. Phone numbers stay hidden, except the RWB team\'s.')
    await r.p.fill('#cq', ''); await r.p.dispatch_event('#cq', 'input'); await r.p.evaluate("window.scrollTo(0,0)"); await r.p.wait_for_timeout(300)
    await r.shot(hold=2.4)
    r.save('RWB members', 'Leaderboards, the RWB team and the member list.', 'Ride together, rank together.')


async def staff(r):
    p = r.p
    r.scene('Coordinators + admins', 'Approve Motomart posts', 'A <b>waiting for approval</b> alert appears on Home. In Motomart tap <b>To approve</b>, check photos and price, then <b>Approve</b> or <b>Reject</b> with a reason.')
    await r.tap('a[data-tab=motomart]', wait=900, hold=1.3)
    await r.tap('[data-act=review]', wait=700, hold=1.3)
    await r.tap('.mm-card >> nth=0', wait=700, hold=1.3)
    await r.tap('#sheet [data-x=approve]', wait=1000, hold=1.4); await r.shot(hold=1.0)
    r.scene('Admins', 'Access requests', 'Someone signed in with a different Google account? Open <b>Admin</b> from <b>Me</b>. Check their details, then <b>Approve</b>. They\'re added to the RWB contact sheet too.')
    await r.tap('.top a.avatar-link', wait=800, hold=1.2)
    await r.tap('a[href="#admin"]', wait=1000, hold=1.3)
    await r.tap('[data-act=approve] >> nth=0', wait=1000, hold=1.5)
    r.scene('Admins', 'New members', 'In the <b>RWB</b> tab, tap <b>New</b> to see who joined this week (form or app). Add them to the WhatsApp group; the <b>New Member</b> tag goes after 7 days. Sort by <b>Newest first</b> any time.')
    await r.tap('a[data-tab=crew]', wait=1100, hold=1.2)
    await r.tap('[data-act=mf][data-f=new]', wait=700, hold=1.4); await r.shot(hold=1.4)
    r.scene('Admins', 'Make a coordinator', 'Tap any member: <b>WhatsApp</b> them, <b>Edit details</b>, or <b>Make coordinator</b> so they can approve Motomart posts. Only the super admin can make admins.')
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=1.3)
    await r.tap('#sheet [data-x=role][data-to=coordinator]', click=False, hold=1.6)
    await p.keyboard.press('Escape'); await p.wait_for_timeout(300)
    r.scene('Admins', 'Remove a member', 'Tap <b>Remove from RWB</b>, choose <b>Left the group</b> or <b>Removed by admin</b>, add a note and type REMOVE. Their app data is deleted and their sheet row removed.')
    await r.tap('[data-act=mf][data-f=all]', wait=600, hold=1.0)
    await p.fill('#mq', 'arjun'); await p.dispatch_event('#mq', 'input'); await p.wait_for_timeout(300)
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=1.2)
    await r.tap('#sheet [data-x=remove]', wait=600, hold=1.3)
    await p.check('#rmf input[value=left]'); await p.fill('#rmf input[name=note]', 'Moved to Bangalore'); await p.fill('#rmf input[name=ok]', 'REMOVE'); await p.wait_for_timeout(200)
    await r.tap('#rmf button.danger', wait=1100, hold=1.5)
    r.scene('Admins', 'Left / removed', 'They stay on record under <b>Left / removed</b>: greyed out with the date, who did it and why. Tap one to <b>Restore</b>. Rejoining through the form or app restores them too.')
    await p.fill('#mq', ''); await p.dispatch_event('#mq', 'input'); await p.wait_for_timeout(300)
    await r.tap('[data-act=mf][data-f=gone]', wait=700, hold=1.4)
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=1.3)
    await r.tap('#sheet [data-x=restore]', click=False, hold=1.4)
    await p.keyboard.press('Escape'); await p.wait_for_timeout(300)
    r.scene('Coordinators + admins', 'Create an event', 'In <b>Events</b> tap <b>＋ Create event</b>: name, date, time, place, reminder and guests. <b>Publish</b> and every member is notified.')
    await r.tap('a[data-tab=events]', wait=1000, hold=1.1)
    await r.tap('[data-act=evt-new]', wait=700, hold=1.2)
    await p.fill('#evf [name=title]', 'Sunday ride to Gadiara'); await p.fill('#evf [name=d1]', '2026-11-08'); await p.fill('#evf [name=t1]', '05:30'); await p.fill('#evf [name=location]', 'Science City, Kolkata'); await p.wait_for_timeout(300)
    await r.shot(hold=1.6)
    await r.tap('#evf > button.btn.block', wait=1200, hold=1.4); await r.shot(hold=1.3)
    r.scene('Admins', 'Announcements', 'Tap the <b>bell</b>, open <b>Post an announcement</b> and send. It goes to everyone\'s phone. Only admins can delete announcements and events from the feed.')
    await r.tap('.top a.bell[href="#news"]', wait=900, hold=1.1)
    await r.tap('details.howto summary', wait=500, hold=1.1)
    await p.fill('#ann [name=title]', 'Helmet check this Sunday'); await p.fill('#ann [name=body]', 'Bring your helmet to the breakfast ride for a free fit check.'); await p.wait_for_timeout(200)
    await r.confirm('#ann button.btn.block', 'Send “Helmet check this Sunday” to all members?', wait=1000); await r.shot(hold=1.2)
    r.scene('Admins', 'Birthdays + Pookie', 'In <b>Admin</b>: <b>Birthdays</b> shows today and the next 7 days with a ready message. <b>Pookie</b> lets you add RWB facts the AI should know.')
    await r.tap('.top a.avatar-link', wait=700, hold=1.0)
    await r.tap('a[href="#admin"]', wait=900, hold=1.0)
    await r.tap('[data-act=tab][data-tab=bdays]', wait=900, hold=1.5)
    await r.tap('[data-act=tab][data-tab=ai]', wait=1100, hold=1.3); await r.shot(hold=2.0)
    r.save('Coordinators & admins', 'Everything the RWB team can do in the app, in one minute.', 'Thanks for keeping RWB running.')

async def mgmt(r):
    p = r.p
    # A: approving an app join request
    r.scene('In the app', 'Approve a join request', 'A banner on <b>Home</b> (and a notification) says someone is waiting. Open it, check their details and tap <b>Approve</b>.')
    await r.shot(hold=1.6)
    await r.tap('#admin-banner', wait=1000, hold=1.6)
    await r.p.evaluate("document.querySelector('[data-act=approve]').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300); await r.shot(hold=2.6)
    await r.tap('[data-act=approve] >> nth=0', wait=1000, hold=1.8)
    # B: tracking new members
    r.scene('In the app', 'Find new members', 'In the <b>RWB</b> tab tap <b>New</b>: everyone who joined in the last 7 days, from the form or the app, with a green <b>New Member</b> tag.')
    await r.tap('a[data-tab=crew]', wait=1100, hold=1.4)
    await r.tap('[data-act=mf][data-f=new]', wait=800, hold=1.6); await r.shot(hold=2.4)
    r.scene('In the app', 'Add them on WhatsApp', 'Tap a new member to see their details and <b>WhatsApp</b> them, or use their number to add them to the RWB group. <b>Newest first</b> sorting works any time.')
    await r.tap('[data-act=member] >> nth=0', wait=800, hold=1.6)
    await r.tap('#sheet a.btn.wa', click=False, hold=2.4)
    await p.keyboard.press('Escape'); await p.wait_for_timeout(300)
    await r.select('#msort', 'new')
    # C: removing
    r.scene('In the app', 'Remove from RWB', 'Tap the member → <b>Remove from RWB</b>. Pick <b>Left the group</b> or <b>Removed by admin</b>, add a note, type <b>REMOVE</b>.')
    await r.tap('[data-act=mf][data-f=all]', wait=600, hold=1.2)
    await p.fill('#mq', 'arjun'); await p.dispatch_event('#mq', 'input'); await p.wait_for_timeout(300)
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=1.6)
    await r.tap('#sheet [data-x=remove]', wait=600, hold=2.2)
    await p.check('#rmf input[value=left]'); await p.fill('#rmf input[name=note]', 'Moved to Bangalore'); await p.fill('#rmf input[name=ok]', 'REMOVE'); await p.wait_for_timeout(200)
    await r.shot(hold=2.4)
    await r.tap('#rmf button.danger', wait=1100, hold=1.8)
    # D: left / removed + restore
    r.scene('In the app', 'Left / removed, and Restore', 'They\'re kept under <b>Left / removed</b>: greyed out, with the date, who did it and why. Tap one and <b>Restore to RWB</b> to undo.')
    await p.fill('#mq', ''); await p.dispatch_event('#mq', 'input'); await p.wait_for_timeout(300)
    await r.tap('[data-act=mf][data-f=gone]', wait=700, hold=1.6); await r.shot(hold=2.0)
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=2.4)
    await r.tap('#sheet [data-x=restore]', wait=1000, hold=1.8); await r.shot(hold=1.6)
    r.save('Member management', '', '')

async def mgmt2(r):
    p = r.p
    # 0: the approval list and its 4 checks
    r.scene('In the app', 'The approval list', '')
    await r.shot(hold=1.4)
    await r.tap('#admin-banner', wait=1100, hold=1.5)
    await p.evaluate("document.querySelector('.req-card[data-id=\"1\"] .checks').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300); await r.shot(hold=2.6)
    # 1: tick VRN verified, then approve
    r.scene('In the app', 'Verify the VRN, then approve', '')
    await r.tap('.req-card[data-id="1"] [data-act=copy-vrn]', wait=500, hold=1.4)
    await r.tap('.req-card[data-id="1"] .vrn-tick', wait=900, hold=1.6)
    await p.evaluate("document.querySelector('.req-card[data-id=\"1\"] .checks').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300); await r.shot(hold=1.8)
    await r.tap('.req-card[data-id="1"] [data-act=approve]', wait=1100, hold=1.6); await r.shot(hold=1.4)
    # 2: reject with a reason
    r.scene('In the app', 'Reject, with a reason', '')
    await p.evaluate("document.querySelector('.req-card[data-id=\"2\"] .checks').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300); await r.shot(hold=2.4)
    await r.tap('.req-card[data-id="2"] [data-act=reject]', wait=800, hold=1.4)
    await r.tap('#rj [data-q="Not a Ronin owner"]', wait=400, hold=1.4)
    await r.tap('#rj button.btn.danger', wait=1100, hold=1.6)
    # 3: an existing member filling the form again
    r.scene('In the app', 'Existing member, again', '')
    await p.evaluate("document.querySelector('.req-card[data-id=\"3\"] .checks').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300); await r.shot(hold=2.4)
    await r.tap('.req-card[data-id="3"] [data-act=approve]', wait=1200, hold=1.6); await r.shot(hold=1.4)
    # 4: new members → WhatsApp, and verify bikes
    r.scene('In the app', 'New members and bikes', '')
    await r.tap('a[data-tab=crew]', wait=1100, hold=1.3)
    await r.tap('[data-act=mf][data-f=new]', wait=800, hold=1.5); await r.shot(hold=1.6)
    await r.tap('[data-act=member] >> nth=0', wait=900, hold=1.6)
    await p.evaluate("document.querySelector('#sheet .group.bikes').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300)
    await r.tap('#sheet [data-x=vv][data-slot="1"]', wait=1000, hold=1.6)
    await p.evaluate("document.querySelector('#sheet .group.bikes').scrollIntoView({block:'center'})"); await p.wait_for_timeout(300); await r.shot(hold=1.6)
    await r.tap('#sheet a.btn.wa', click=False, hold=1.8)
    await p.keyboard.press('Escape'); await p.wait_for_timeout(300)
    # 5: remove
    r.scene('In the app', 'Remove from RWB', '')
    await r.tap('[data-act=mf][data-f=all]', wait=600, hold=1.2)
    await p.fill('#mq', 'arjun'); await p.dispatch_event('#mq', 'input'); await p.wait_for_timeout(300)
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=1.5)
    await r.tap('#sheet [data-x=remove]', wait=600, hold=2.0)
    await p.check('#rmf input[value=left]'); await p.fill('#rmf input[name=note]', 'Moved to Bangalore'); await p.fill('#rmf input[name=ok]', 'REMOVE'); await p.wait_for_timeout(200)
    await r.shot(hold=2.2)
    await r.tap('#rmf button.danger', wait=1100, hold=1.6)
    # 6: restore
    r.scene('In the app', 'Restore', '')
    await p.fill('#mq', ''); await p.dispatch_event('#mq', 'input'); await p.wait_for_timeout(300)
    await r.tap('[data-act=mf][data-f=gone]', wait=700, hold=1.5); await r.shot(hold=1.6)
    await r.tap('[data-act=member] >> nth=0', wait=700, hold=2.0)
    await r.tap('#sheet [data-x=restore]', wait=1000, hold=1.6); await r.shot(hold=1.4)
    # 7: members add their bikes
    r.scene('In the app', 'My bikes', '')
    await r.tap('.top a.avatar-link', wait=1000, hold=1.4)
    await p.evaluate("document.querySelector('#my-bikes').scrollIntoView({block:'center'})"); await p.wait_for_timeout(500); await r.shot(hold=1.6)
    await r.tap('#my-bikes .bike-add', wait=700, hold=1.4)
    await r.type('#bk input[name=vrn]', 'WB 20 AA 1234')
    await r.tap('#bk button.btn.block', wait=1100, hold=1.4)
    await p.evaluate("document.querySelector('#my-bikes').scrollIntoView({block:'center'})"); await p.wait_for_timeout(400); await r.shot(hold=2.0)
    r.save('Member management', '', '')

VIDEOS = {'service': service, 'mileage': mileage, 'motomart': motomart, 'guides': guides, 'events': events, 'me': me, 'crew': crew, 'staff': staff, 'mgmt': mgmt, 'mgmt2': mgmt2}

async def main(names):
    os.makedirs(f'{S}/data', exist_ok=True)
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for n in names:
            import shutil; shutil.rmtree(f'{S}/shots/{n}', ignore_errors=True)
            pg = await setup(b, 'superadmin' if n in ('staff', 'mgmt', 'mgmt2') else 'member')
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            r = Rec(pg, n)
            try: await VIDEOS[n](r)
            except Exception as e: print(n, 'FAILED:', str(e).split('\n')[0][:300])
            if errs: print(n, 'page errors', errs[:3])
            await pg.context.close()
        await b.close()

asyncio.run(main(sys.argv[1:] or list(VIDEOS)))
