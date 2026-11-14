"""Stand-in street map tiles for the recordings (the real map tiles can't be reached from here).
Drawn from world pixel positions, so neighbouring tiles join up."""
import io, math, hashlib
from PIL import Image, ImageDraw

BG, BLOCK, PARK, WATER, ROAD, MAJOR, EDGE = (242, 239, 233), (232, 228, 220), (205, 235, 192), (170, 211, 223), (255, 255, 255), (252, 214, 164), (214, 208, 198)
_cache = {}


def h(*a):
    return int(hashlib.md5(repr(a).encode()).hexdigest()[:8], 16) / 0xffffffff


def tile(z, x, y):
    k = (z, x, y)
    if k in _cache: return _cache[k]
    S = 256; X0, Y0 = x * S, y * S
    im = Image.new('RGB', (S, S), BG); d = ImageDraw.Draw(im)
    step = 120  # street spacing in world pixels at this zoom
    gx0, gy0 = X0 // step - 1, Y0 // step - 1
    for i in range(gx0, gx0 + S // step + 3):
        for j in range(gy0, gy0 + S // step + 3):
            bx, by = i * step - X0, j * step - Y0
            r = h(z, i, j)
            fill = PARK if r < .12 else BLOCK
            d.rectangle([bx + 9, by + 9, bx + step - 9, by + step - 9], fill=fill)
            if fill == BLOCK and r > .5:  # a few buildings
                d.rectangle([bx + 18, by + 18, bx + step // 2 - 4, by + step // 2 - 4], fill=(224, 219, 210))
    # river
    pts = []
    for px in range(-20, S + 21, 6):
        wx = X0 + px
        wy = 300 * math.sin(wx / 900) + 140 * math.sin(wx / 310 + 1)
        base = (y * S) // 4096 * 4096 + 2600
        pts.append((px, base + wy - Y0))
    d.line(pts, fill=WATER, width=34)
    # streets
    for i in range(gx0, gx0 + S // step + 3):
        bx = i * step - X0; major = i % 4 == 0
        d.line([(bx, 0), (bx, S)], fill=EDGE, width=20 if major else 14); d.line([(bx, 0), (bx, S)], fill=MAJOR if major else ROAD, width=16 if major else 10)
    for j in range(gy0, gy0 + S // step + 3):
        by = j * step - Y0; major = j % 4 == 0
        d.line([(0, by), (S, by)], fill=EDGE, width=20 if major else 14); d.line([(0, by), (S, by)], fill=MAJOR if major else ROAD, width=16 if major else 10)
    b = io.BytesIO(); im.save(b, 'PNG'); _cache[k] = b.getvalue()
    return _cache[k]


async def route(ctx):
    async def f(r):
        z, x, y = r.request.url.rsplit('.', 1)[0].split('/')[-3:]
        await r.fulfill(status=200, content_type='image/png', body=tile(int(z), int(x), int(y)))
    await ctx.route('https://tile.openstreetmap.org/**', f)
