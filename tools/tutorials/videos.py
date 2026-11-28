"""The RWB App how-to videos (Nov 2026 app). Each scene = one simple action, with 1-2 short spoken sentences.
Run: python3 videos.py [names]   (demo app served on localhost:8766)"""
import asyncio, sys
from rec import run, HIDE

G = lambda r, h: r.p.evaluate(f"location.hash = '#{h}'")


async def home(r):
    p = r.p
    r.scene('Your Home', ['This is Home. It shows your bike at a glance.'])
    await r.shot(hold=2.2)
    r.scene('Update your km', ['Tap the big kilometre number.', 'Type what your bike shows, and tap Save.'])
    await r.tap('.rw-odo', wait=900)
    await r.type('#sheet input[type=number]', '8120')
    await r.tap('#sheet button.btn.block, #sheet button[type=submit] >> nth=0', wait=1100)
    r.scene('Your bike parts', ['Below it are your parts, like oil, chain and brakes.', 'Red means it needs care soon.'])
    await r.tap('.rw-part.bad', click=False, hold=2.4)
    r.scene('My Ride', ['Tap My Ride to see every part.', 'Tap a part to update it when you change it.'])
    await r.tap('.rw-btn', wait=1200); await r.shot(hold=1.8)
    await G(r, 'home'); await p.wait_for_timeout(1100)
    r.scene('Shortcuts', ['These round buttons are shortcuts. Add fuel, log a service, or sell gear in one tap.'])
    await r.tap('nav.quick', click=False, hold=3.0)
    r.scene('VRN check', ['Saw a Ronin on the road? Type its number here, to see if the rider is in R W B.'])
    await r.type('input[name=v]', 'WB 06 CD 4567')
    await r.tap('form:has(input[name=v]) button.btn', wait=1300); await r.shot(hold=1.8)
    r.save('Home & My Ride')


async def track(r):
    p = r.p
    r.scene('Open Track', ['Tap the orange Track button, in the middle of the bottom bar.'])
    await r.tap('a[data-tab=track]', wait=1100); await r.shot(hold=1.4)
    r.scene('Share your location', ['Before you start a ride, tap Share, and choose how long.', 'Other R W B riders, and your family, can now see where you are.'])
    await r.tap('[data-x=share]', wait=1500)
    if await p.locator('dialog[open] [data-h], #sheet [data-h]').count(): await r.tap('[data-h] >> nth=0', wait=1600)
    if await p.locator('[data-x=go]').count(): await r.tap('[data-x=go]', wait=1600)
    await r.shot(hold=2.0)
    r.scene('See other riders', ['Tap View to see all riders live on the map.', 'Tap a rider to see their speed.'])
    await G(r, 'home'); await p.wait_for_timeout(900)
    await r.tap('a[data-tab=track]', wait=1100)
    await r.tap('[data-x=view]', wait=1800); await r.shot(hold=1.2)
    if await p.locator('[data-act=trk-rider]').count(): await r.tap('[data-act=trk-rider] >> nth=0', wait=1000); await r.shot(hold=1.4)
    r.scene('SOS', ['In trouble? Tap SOS. The R W B team gets your location at once.', 'In an emergency, also call one one two.'])
    await G(r, 'home'); await p.wait_for_timeout(900)
    await r.tap('a[data-tab=track]', wait=1100)
    await r.tap('[data-x=sos]', click=False, hold=2.8)
    r.save('Track & SOS')


async def service(r):
    p = r.p
    r.scene('Open Service', ['Tap Service at the bottom. Every service of your bike is kept here.'])
    await r.tap('a[data-tab=service]', wait=1000); await r.shot(hold=1.6)
    r.scene('Add a service', ['Tap Add service.', "Today's date and your kilometres are already filled in."])
    await r.tap('[data-act=add-service] >> visible=true', wait=900); await r.shot(hold=2.0, focus=150)
    r.scene('Fill in the details', ['Choose the type of service, and your service centre.'])
    await r.select('#sheet select[name=service_type]', 'paid')
    await r.tap('#cp-btn', wait=800); await r.type('#cp-q', 'salt lake', hold=1.2)
    await r.tap('.cp-item:not(.cp-new) >> nth=0', wait=600)
    r.scene('What was done', ['Write what was done, and the total cost.'])
    await r.type('#other-item', 'Engine oil change', hold=1.0); await r.tap('#add-item', wait=500)
    await r.type('#sheet input[name=cost]', '1850')
    r.scene('Add the bill', ['Tap Photo to add a picture of the bill.', 'Then tap Save service.'])
    await r.upload('#sheet label.file-pick >> nth=0', '#sheet label.file-pick >> nth=0 >> input', ['bill.png'])
    await r.tap('#sheet button.btn.block', wait=1300); await r.shot(hold=1.6)
    r.scene('See it any time', ['Tap any service to see it again.', 'Tap Edit to change it, or Delete to remove it.'])
    await r.tap('[data-act=open] >> nth=0', wait=900); await r.shot(hold=2.8, focus=640)
    r.save('Service')


async def mileage(r):
    p = r.p
    r.scene('Open Mileage', ['Tap Mileage. It shows how many kilometres your bike gives, in one litre.'])
    await r.tap('a[data-tab=mileage]', wait=1100); await r.shot(hold=1.8)
    r.scene('First time?', ['Fill the tank full, and set Trip A on your bike to zero.', 'Tap here, to see how.'])
    await r.tap('summary:has-text("Trip A")', wait=600); await r.shot(hold=2.4)
    await p.locator('summary:has-text("Trip A")').click(); await p.wait_for_timeout(400)
    r.scene('Add a fill-up', ['At your next full tank, tap Add fuel.', 'Type the litres, the money you paid, and the Trip A number.'])
    await r.tap('[data-act=add-fuel] >> visible=true', wait=900)
    await r.type('#sheet input[name=litres]', '9.6', hold=1.0)
    await r.type('#sheet input[name=amount]', '1025', hold=1.0)
    await r.type('#sheet input[name=trip_a_km]', '402', hold=1.2)
    await r.tap('#sheet button.btn.block', wait=1300)
    r.scene('Your mileage', ['Your mileage shows at once.', 'See how you compare with other R W B riders.'])
    await p.evaluate("scrollTo(0,0)"); await r.shot(hold=1.6)
    await r.tap('h2:has-text("You vs RWB") + *', click=False, hold=2.2)
    r.scene('Fix a mistake', ['Typed something wrong? Tap the fill-up, and fix it.'])
    await r.tap('button.item[data-act=open] >> nth=0', wait=900); await r.shot(hold=2.0)
    r.save('Mileage')


async def motomart(r):
    p = r.p
    r.scene('Open MotoMart', ['Tap MotoMart. Riders buy and sell bike gear here.'])
    await r.tap('a[data-tab=motomart]', wait=1200); await r.shot(hold=1.6)
    r.scene('Find something', ['Tap a type, like Helmets, to see only those.'])
    await r.tap('[data-act=cat][data-cat=Helmets]', wait=900); await r.shot(hold=1.4)
    r.scene('Buy it', ['Tap an item to see its photos and price.', 'To buy, tap Message seller on WhatsApp.'])
    await r.tap('.mm-card >> nth=0', wait=1000)
    await r.tap('#sheet a:has-text("WhatsApp") >> nth=0', click=False, hold=2.4)
    await r.back()
    r.scene('Sell your gear', ['To sell, tap Sell something, and add clear photos.'])
    await r.tap('[data-act=cat][data-cat=all]', wait=600)
    await r.tap('[data-act=sell] >> visible=true', wait=900)
    await r.upload('#sheet label.file-pick', '#sheet label.file-pick input', ['helmet1.png', 'helmet2.png'])
    r.scene('Add the details', ['Type the name, choose the type and condition, and set your price.'])
    await r.type('#sheet input[name=product_name]', 'Steelbird SBA-7 helmet', hold=1.0)
    await r.select('#sheet select[name=category]', 'Helmets')
    await r.select('#sheet select[name=condition]', 'Like new')
    await r.type('#sheet input[name=price]', '3500', hold=1.0)
    r.scene('Post it', ['Tap Send for approval.', 'The R W B team checks it, usually within a day.'])
    await r.tap('#sheet button.btn.block', wait=1500); await r.shot(hold=1.2)
    await r.tap('.mm-card:has-text("Steelbird")', click=False, hold=2.4)
    r.save('MotoMart')


async def guides(r):
    p = r.p
    r.scene('Open Guides', ['Tap the question mark at the top. This is Guides.'])
    await r.tap('a.guide-btn', wait=1300); await r.shot(hold=1.4)
    r.scene('Three kinds', ['App has short videos, like this one.', 'Maintenance has bike care guides. Ride has riding tips.'])
    await r.tap('[data-act=gcat][data-c=app]', wait=1000); await r.shot(hold=1.2)
    await r.tap('[data-act=gcat][data-c=maint]', wait=1000); await r.shot(hold=1.0)
    r.scene('Read a guide', ['Tap any guide to read it, right inside the app.'])
    await r.tap('.gd-doc >> nth=0', wait=3000); await r.shot(hold=2.4, focus=260)
    await r.back(700)
    r.scene('Ask Pookie', ['Have a question? Tap Pookie, the R W B helper.', 'Ask anything about your Ronin.'])
    await r.tap('#pookie-fab', wait=1200)
    await r.tap('[data-act=suggest] >> nth=0', wait=4500); await r.shot(hold=2.6, focus=220)
    r.scene('Teach Pookie', ['You can also teach Pookie what you know, and earn points.'])
    await r.tap('a.teach-chip', wait=1400); await r.shot(hold=2.2)
    r.save('Guides & Pookie')


async def events(r):
    p = r.p
    r.scene('Open Events', ['Tap Events. You see the coming rides and meet-ups.'])
    await r.tap('a[data-tab=events]', wait=1100); await r.shot(hold=1.4)
    r.scene('See the plan', ['Tap a ride to see the time, the place, and the plan.'])
    await r.tap('.evt-card >> nth=0', wait=1300); await r.shot(hold=1.8)
    r.scene('Say if you are coming', ['Tap Going, Maybe, or Can\'t go, so the team knows.'])
    await r.tap('[data-act=rsvp][data-s=going]', wait=1300); await r.shot(hold=1.2)
    r.scene('Find the way', ['Tap Open in Maps for directions.', 'Tap Add to calendar, so you don\'t forget.'])
    await r.tap('a:has-text("Open in Maps")', click=False, hold=1.8)
    await r.tap('a:has-text("Add to calendar")', click=False, hold=1.8)
    r.scene('Share the costs', ['Spent money for the group? Add it under Expenses.', 'The app shows who pays whom.'])
    await r.tap('[data-act=exp-add]', wait=900)
    await r.type('#exf input[name=title]', 'Breakfast at Kolaghat', hold=1.0); await r.type('#exf input[name=amount]', '1200', hold=1.0)
    await r.tap('#exf button.btn.block', wait=1300); await r.shot(hold=1.4)
    if await p.locator('[data-act=exp-settle]').count(): await r.tap('[data-act=exp-settle]', wait=900); await r.shot(hold=1.8)
    r.save('Events')


async def warriorboards(r):
    p = r.p
    r.scene('Warriorboards', ['Tap Warriors. These are the top riders of R W B.'])
    await r.tap('a[data-tab=crew]', wait=2600); await r.shot(hold=2.0)
    r.scene('Five boards', ['Tap a tile to see another board, like Mileage, or Service.'])
    await r.tap('[data-act=board][data-b=mileage]', wait=2200); await r.shot(hold=1.2)
    await r.tap('[data-act=board][data-b=service]', wait=2200); await r.shot(hold=1.2)
    r.scene('Your rank', ['Your own rank is on every tile.'])
    await r.tap('[data-act=board][data-b=gps]', click=False, hold=2.4)
    r.scene('Find a rider', ['Tap R W B Members, to find any rider by name.'])
    await r.tap('a.lb-mem', wait=1400); await r.shot(hold=1.2)
    await r.type('#cq', 'priya', wait=600, hold=2.0)
    r.save('Warriorboards')


async def me(r):
    p = r.p
    r.scene('Your profile', ['Tap your picture at the top right. This is your profile.'])
    await r.tap('a.avatar-link', wait=1000); await r.shot(hold=1.4)
    r.scene('Add a photo', ['Tap the camera, to add your photo.'])
    await r.upload('label.photo-pick', '#pic', ['avatar.png'], wait=2000)
    r.scene('Change your details', ['Tap Edit to change your details. Then tap Save.'])
    await r.tap('.profile [data-act=edit]', wait=900)
    await r.type('#sheet input[name=locality]', 'Salt Lake, Sector 5', hold=1.2)
    await r.tap('#sheet button.btn.block', wait=1300)
    r.scene('Light or dark', ['Pick Light or Dark, whichever is easier on your eyes.'])
    await r.tap('[data-act=theme][data-t=dark]', wait=700); await r.shot(hold=1.4)
    await r.tap('[data-act=theme][data-t=light]', wait=700)
    r.scene('Notifications', ['Choose which alerts you want on your phone.'])
    await r.tap('button:has-text("Turn on notifications")', click=False, hold=2.6)
    r.scene('Privacy', ['Don\'t want to be on the Warriorboards? Switch it off here.'])
    await r.tap('label.toggle-row:has(#lb)', click=False, hold=2.4)
    r.save('Me')


async def calendar(r):
    p = r.p
    r.scene('Your calendar', ['Tap the calendar at the top.', 'Rides, service dates and paper renewals are all here.'])
    await r.tap('a.cal-btn', wait=1300); await r.shot(hold=1.6)
    r.scene('Tap a day', ['Tap a day with a dot, to see what is on it.'])
    await r.tap('[data-act=cal-day][data-d="2026-11-16"]', wait=900); await r.shot(hold=1.8)
    r.scene('Add a reminder', ['Tap Reminder to add your own, like a FASTag recharge.'])
    await r.tap('[data-act=cal-add]', wait=900)
    if await p.locator('#sheet input[name=title]').count(): await r.type('#sheet input[name=title]', 'Pay bike insurance', hold=1.4)
    await r.back(600)
    r.scene('Your papers', ['Keep your bike papers in Documents.', 'Licence, R C, pollution, and insurance.'])
    await G(r, 'home'); await p.wait_for_timeout(1000)
    await r.tap('nav.quick a[href="#docs"]', wait=1200); await r.shot(hold=1.4)
    r.scene('Add a paper', ['Tap one, add a photo, and the expiry date.', 'The app reminds you before it runs out.'])
    await r.tap('[data-act=doc-new][data-kind=insurance]', wait=1000)
    await r.shot(hold=2.4, focus=620)
    r.scene('Only for you', ['Only you can see your papers. Not the admins, and not other riders.'])
    await r.back(600); await p.evaluate('scrollTo(0,0)')
    await r.tap('text=Only you can see these', click=False, hold=2.6)
    r.save('Calendar & Documents')


async def team(r):
    p = r.p
    r.scene('Your Admin panel', ['Admins and coordinators get extra tools.', 'Tap Open on the Admin card, on Home.'])
    await r.tap('a[href="#admin"] >> nth=0', wait=1600); await r.shot(hold=1.4)
    r.scene('Approve new riders', ['Approvals has people who filled the join form.', 'Check the points, then approve or reject.'])
    await r.tap('[data-act=tab][data-tab=requests] >> nth=-1', wait=900)
    await p.evaluate("scrollBy(0, 330)"); await p.wait_for_timeout(300); await r.shot(hold=2.4)
    r.scene('MotoMart posts', ['In MotoMart, check each post before it goes live.'])
    await r.tap('[data-act=tab][data-tab=motomart]', wait=1300); await r.shot(hold=2.0)
    r.scene('Members', ['In Members, tap anyone to message them, or change their details.'])
    await r.tap('[data-act=tab][data-tab=members]', wait=1500); await r.shot(hold=1.2)
    if await p.locator('[data-act=member]').count(): await r.tap('[data-act=member] >> nth=0', wait=900); await r.shot(hold=1.4); await r.back()
    r.scene('Reports and Pookie', ['Answer Reports within a day.', 'In Pookie, check what riders teach it.'])
    await r.tap('[data-act=tab][data-tab=reports]', wait=1300); await r.shot(hold=1.2)
    await r.tap('[data-act=tab][data-tab=ai]', wait=1300); await r.shot(hold=1.4)
    r.scene('Create a ride', ['To plan a ride, open Events and tap Create event.'])
    await r.tap('a[data-tab=events]', wait=1100)
    await r.tap('[data-act=evt-new]', wait=1000); await r.shot(hold=1.8)
    r.save('Team tools')


async def fam(r):
    p = r.p
    r.scene('Welcome to RWB FAM', ['This is the app for a rider\'s family.', 'Home shows your rider\'s bike and coming rides.'])
    await r.shot(hold=2.4)
    r.scene('Where is my rider?', ['Tap Where is your rider. When your rider shares, you see them live on the map.'])
    await r.tap('a:has-text("Where is"), button:has-text("Where is") >> nth=0', wait=1800); await r.shot(hold=2.2)
    r.scene('Rides', ['Tap Events, to see the rides your rider is joining.'])
    await r.tap('a[data-tab=events]', wait=1300); await r.shot(hold=1.8)
    r.scene('Your settings', ['Tap your picture to see your settings.', 'You can switch R W B FAM off here, any time.'])
    await r.tap('a.avatar-link', wait=1100)
    await r.tap('text=RWB FAM is on', click=False, hold=2.4)
    r.save('RWB FAM')


async def fam_invite(r):
    """Rider sends the RWB FAM invite, then the family member installs the app, signs in and joins with the code."""
    p = r.p
    await p.evaluate("""() => { const k='rwb-app-demo-v2', d=JSON.parse(localStorage.getItem(k)); d.fam=[]; localStorage.setItem(k, JSON.stringify(d)); }""")
    await p.reload(); await p.wait_for_selector('#boot', state='detached', timeout=30000); await p.wait_for_timeout(1000); await p.add_style_tag(content=HIDE); await p.wait_for_timeout(300)
    r.scene('Invite your family', ['Rider, on Home, tap the FAM button.'])
    await r.tap('[data-act=fam]', wait=1300)
    r.scene('Your invite code', ['This is your invite code. Up to three family members can join.'])
    await r.tap('#sheet .fam-code', click=False, hold=2.6)
    r.scene('Send it', ['Tap WhatsApp, and send the invite to your family.'])
    await r.tap('#sheet [data-x=wa]', click=False, hold=2.4)
    # the family's phone: the invite page from the link
    r.scene('Family: open the link', ['Family, tap the link in the message.', 'Then tap Get it on Google Play, and install the R W B app.'])
    fp = await p.context.new_page()
    await fp.add_init_script("Object.defineProperty(navigator,'userAgent',{get:()=>'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'})")
    await fp.goto('http://localhost:8766/fam/?c=RWB-K7Q2&p=1'); await fp.wait_for_timeout(1500)
    r.p = fp; await r.tap('#go', click=False, hold=2.8); r.p = p; await fp.close()
    # signed out, a Google account that isn't in RWB
    await p.evaluate("""() => { const k='rwb-app-demo-v2', d=JSON.parse(localStorage.getItem(k)); d.signedIn=false; localStorage.setItem(k, JSON.stringify(d));
        localStorage.setItem('rwb-demo-join','1'); localStorage.removeItem('rwb-fam-code'); }""")
    await p.reload(); await p.wait_for_selector('#boot', state='detached', timeout=30000); await p.wait_for_timeout(2500); await p.add_style_tag(content=HIDE); await p.wait_for_timeout(300)
    r.scene('Sign in', ['Open the app, and tap Continue with Google.', 'Remember which Google account you use.'])
    await r.tap('[data-act=google]', wait=1500)
    r.scene('Join RWB FAM', ['You will see No Account Found. That is fine.', 'Tap Join R W B FAM.'])
    await r.tap('.no-acct [data-act=fam-join]', wait=1200)
    r.scene('Type the code', ['Type the invite code from the message, and your name.'])
    await r.type('#fj input[name=code]', 'RWB-K7Q2', hold=1.0)
    await p.locator('#fj input[name=code]').blur(); await p.wait_for_timeout(500)
    await r.type('#fj input[name=name]', 'Rina Mallick', hold=1.2)
    r.scene('Agree and join', ['Tick the box, and tap Join R W B FAM.'])
    await r.tap('#fj input[name=agree]', wait=400)
    await r.tap('#fj [data-x=join]', wait=2200)
    await p.evaluate('scrollTo(0,0)'); await p.wait_for_timeout(1500)
    r.scene('You are in', ['Done! You can now see your rider live, when they share on Track.'])
    await r.tap('.fam-rider', click=False, hold=2.6)
    r.save('Invite your family')


VIDEOS = {'home': home, 'track': track, 'service': service, 'mileage': mileage, 'motomart': motomart, 'guides': guides, 'events': events,
          'warriorboards': warriorboards, 'me': me, 'calendar': calendar, 'coordinators-and-admins': team, 'fam-app': fam, 'fam-invite': fam_invite}
ROLES = {'coordinators-and-admins': 'superadmin', 'fam-app': 'fam'}
if __name__ == '__main__':
    asyncio.run(run(VIDEOS, ROLES, sys.argv[1:] or list(VIDEOS)))
