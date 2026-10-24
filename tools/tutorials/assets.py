import asyncio
from playwright.async_api import async_playwright
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut2/assets'
def prod(emoji, bg1, bg2, label=''):
    return f"""<body style="margin:0;width:600px;height:600px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,{bg1},{bg2});font-family:Barlow">
      <div style="font-size:300px;line-height:1;filter:drop-shadow(0 30px 30px rgba(0,0,0,.35))">{emoji}</div>
      {f'<div style="position:absolute;bottom:30px;color:#fff;font:600 30px Barlow;opacity:.85">{label}</div>' if label else ''}</body>"""
HELMET1 = '''<body style="margin:0;width:600px;height:600px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#cfd8e3,#7d8ea3);font-family:Barlow">
<svg width="420" height="400" viewBox="0 0 420 400" style="filter:drop-shadow(0 30px 30px rgba(0,0,0,.35))">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c0392b" stop-opacity=".75"/><stop offset=".5" stop-color="#c0392b"/><stop offset="1" stop-color="#111"/></linearGradient>
<linearGradient id="v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b3a4a"/><stop offset="1" stop-color="#0b1118"/></linearGradient></defs>
<path d="M60 250 C40 120 140 30 250 40 C350 50 395 140 380 230 L370 300 C365 330 340 345 310 345 L120 345 C85 345 65 320 62 290 Z" fill="url(#g)"/>
<path d="M120 150 C170 120 300 115 365 160 L372 235 C330 220 200 215 125 240 Z" fill="url(#v)"/>
<path d="M140 165 C200 140 280 138 340 160" stroke="#fff" stroke-opacity=".35" stroke-width="8" fill="none" stroke-linecap="round"/>
<path d="M90 300 L330 300" stroke="#000" stroke-opacity=".35" stroke-width="10"/><circle cx="110" cy="235" r="14" fill="#222"/>
<path d="M150 70 C190 55 240 52 280 60" stroke="#fff" stroke-opacity=".3" stroke-width="10" fill="none" stroke-linecap="round"/></svg>
<div style="position:absolute;bottom:30px;color:#fff;font:600 30px Barlow;opacity:.85">Front</div></body>'''
HELMET2 = '''<body style="margin:0;width:600px;height:600px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#e8dccb,#a68f72);font-family:Barlow">
<svg width="420" height="400" viewBox="0 0 420 400" style="filter:drop-shadow(0 30px 30px rgba(0,0,0,.35))">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3b57" stop-opacity=".75"/><stop offset=".5" stop-color="#1f3b57"/><stop offset="1" stop-color="#111"/></linearGradient>
<linearGradient id="v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b3a4a"/><stop offset="1" stop-color="#0b1118"/></linearGradient></defs>
<path d="M60 250 C40 120 140 30 250 40 C350 50 395 140 380 230 L370 300 C365 330 340 345 310 345 L120 345 C85 345 65 320 62 290 Z" fill="url(#g)"/>
<path d="M120 150 C170 120 300 115 365 160 L372 235 C330 220 200 215 125 240 Z" fill="url(#v)"/>
<path d="M140 165 C200 140 280 138 340 160" stroke="#fff" stroke-opacity=".35" stroke-width="8" fill="none" stroke-linecap="round"/>
<path d="M90 300 L330 300" stroke="#000" stroke-opacity=".35" stroke-width="10"/><circle cx="110" cy="235" r="14" fill="#222"/>
<path d="M150 70 C190 55 240 52 280 60" stroke="#fff" stroke-opacity=".3" stroke-width="10" fill="none" stroke-linecap="round"/></svg>
<div style="position:absolute;bottom:30px;color:#fff;font:600 30px Barlow;opacity:.85">Side</div></body>'''
PAGES = {
 'helmet1.png': HELMET1,
 'helmet2.png': HELMET2,
 'gloves.png': prod('🧤','#f0e1d4','#c79a78'),
 'jacket.png': prod('🧥','#d9e4d7','#7f9a7a'),
 'mount.png': prod('📱','#dfe0ef','#8e90b8'),
 'lock.png': prod('🔒','#efe3c9','#bf9f5c'),
 'avatar.png': prod('🏍️','#ffcf9e','#e8662e'),
 'bill.png': """<body style="margin:0;width:600px;height:820px;background:#fbfaf7;font-family:Inter,sans-serif;color:#222;padding:40px;box-sizing:border-box">
   <div style="display:flex;justify-content:space-between;border-bottom:2px solid #222;padding-bottom:14px"><div><b style="font-size:30px">SEVEN POINT MOTORS</b><br><span style="color:#666">Authorised TVS Service · Park Street</span></div><div style="text-align:right;color:#666">INVOICE<br>#SPM-20817</div></div>
   <p style="margin:22px 0;color:#444">Vehicle: TVS Ronin 225 · Odometer: 8,240 km</p>
   <table style="width:100%;border-collapse:collapse;font-size:20px">""" + ''.join(f'<tr><td style="padding:10px 0;border-bottom:1px solid #ddd">{a}</td><td style="text-align:right;border-bottom:1px solid #ddd">₹{b}</td></tr>' for a,b in [('Engine oil 1.3 L','980'),('Oil filter','210'),('Chain clean & lube','250'),('Labour','410')]) + """
   <tr><td style="padding:14px 0;font-weight:700">Total</td><td style="text-align:right;font-weight:700">₹1,850</td></tr></table>
   <p style="margin-top:60px;color:#999;font-size:16px">Thank you for riding with us.</p></body>""",
 'pdfthumb.png': """<body style="margin:0;width:600px;height:780px;background:#fff;font-family:Inter;padding:50px;box-sizing:border-box"><div style="font:800 46px/1.05 Barlow Condensed;text-transform:uppercase">Chain cleaning<br>& lubrication</div><div style="height:6px;width:120px;background:#d4501a;margin:18px 0 30px"></div>""" + ''.join(f'<div style="height:14px;background:#e5e5e5;border-radius:7px;margin:16px 0;width:{w}%"></div>' for w in [92,85,96,70,88,90,60,94,80]) + "</body>",
}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page()
        for name, html in PAGES.items():
            await pg.set_content(html); await pg.wait_for_timeout(150)
            await pg.set_viewport_size({'width':600,'height':820 if name=='bill.png' else 780 if name=='pdfthumb.png' else 600})
            await pg.screenshot(path=f'{S}/{name}')
        await b.close()
asyncio.run(main())
