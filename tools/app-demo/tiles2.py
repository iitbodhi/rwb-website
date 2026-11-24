"""Nicer stand-in street map tiles (OSM-like look), drawn in z15 world pixels so every zoom lines up."""
import io, math, hashlib
from PIL import Image, ImageDraw

BG, BLD, PARK, WATER = (242, 239, 233), (224, 216, 208), (205, 235, 176), (170, 211, 223)
MINOR, CASE, SEC, SECC, PRI, PRIC = (255, 255, 255), (214, 206, 196), (247, 250, 191), (200, 196, 150), (252, 214, 164), (226, 160, 92)
TH = math.radians(14)
SP = 200          # street spacing, z15 px
CX = (88.36 + 180) / 360 * 256 * 2 ** 15
CY = (1 - math.log(math.tan(math.radians(22.5726)) + 1 / math.cos(math.radians(22.5726))) / math.pi) / 2 * 256 * 2 ** 15
_cache = {}


def h(*a): return int(hashlib.md5(repr(a).encode()).hexdigest()[:8], 16) / 0xffffffff
def rot(u, v): return (u * math.cos(TH) - v * math.sin(TH), u * math.sin(TH) + v * math.cos(TH))
def unrot(X, Y): return (X * math.cos(TH) + Y * math.sin(TH), -X * math.sin(TH) + Y * math.cos(TH))
def river_x(Y): return CX - 1700 + 420 * math.sin((Y - CY) / 2300) + 160 * math.sin((Y - CY) / 700 + 1)


def tile(z, x, y):
    k = (z, x, y)
    if k in _cache: return _cache[k]
    R = 512; f = 2 ** (15 - z)                       # z15 px per tile px (at 256)
    X0, Y0 = x * 256 * f, y * 256 * f; span = 256 * f; s = R / span   # world -> render px
    im = Image.new('RGB', (R, R), BG); d = ImageDraw.Draw(im)
    P = lambda X, Y: ((X - X0) * s, (Y - Y0) * s)
    cs = [unrot(X0 + a * span - CX, Y0 + b * span - CY) for a in (0, 1) for b in (0, 1)]
    u0, u1 = min(c[0] for c in cs) - SP, max(c[0] for c in cs) + SP
    v0, v1 = min(c[1] for c in cs) - SP, max(c[1] for c in cs) + SP
    iu0, iu1, iv0, iv1 = int(u0 // SP), int(u1 // SP) + 1, int(v0 // SP), int(v1 // SP) + 1
    zw = 2 ** (z - 15) * s * 256 / 256                  # z15 px -> render px factor is s; widths in z15 px
    # blocks: buildings / parks
    if (iu1 - iu0) * (iv1 - iv0) < 6000:
        for i in range(iu0, iu1):
            for j in range(iv0, iv1):
                r = h('c', i, j); m = 26
                quad = [rot(i * SP + m, j * SP + m), rot(i * SP + SP - m, j * SP + m), rot(i * SP + SP - m, j * SP + SP - m), rot(i * SP + m, j * SP + SP - m)]
                pts = [P(CX + a, CY + b) for a, b in quad]
                if r < .07: d.polygon(pts, fill=PARK)
                elif z >= 14:
                    for q in range(2):
                        for w_ in range(2):
                            if h('b', i, j, q, w_) < .75:
                                a0, b0 = i * SP + m + 6 + q * (SP - 2 * m) / 2, j * SP + m + 6 + w_ * (SP - 2 * m) / 2
                                bq = [rot(a0, b0), rot(a0 + (SP - 2 * m) / 2 - 12, b0), rot(a0 + (SP - 2 * m) / 2 - 12, b0 + (SP - 2 * m) / 2 - 12), rot(a0, b0 + (SP - 2 * m) / 2 - 12)]
                                d.polygon([P(CX + a, CY + b) for a, b in bq], fill=BLD)
    # river
    pts = [P(river_x(Y), Y) for Y in range(int(Y0 - 600), int(Y0 + span + 600), max(8, int(f * 6)))]
    if pts: d.line(pts, fill=WATER, width=max(2, int(300 * s)), joint='curve')

    def road(a, b, w, fill, case):
        L = [P(CX + p[0], CY + p[1]) for p in (rot(*a), rot(*b))]
        if case: d.line(L, fill=case, width=max(1, int((w + 5) * s)))
        d.line(L, fill=fill, width=max(1, int(w * s)))
    lw = 1 if z >= 14 else 0
    # minor streets (skip some segments for an organic feel)
    for pass_ in (0, 1):
        for i in range(iu0, iu1):
            for j in range(iv0, iv1):
                if i % 4 and h('su', i, j) > .12:
                    a, b = (i * SP, j * SP), (i * SP, j * SP + SP)
                    if pass_ == 0: road(a, b, 22, None, CASE) if False else None
                    road(a, b, 20 if pass_ else 25, MINOR if pass_ else CASE, None)
                if j % 4 and h('sv', i, j) > .12:
                    a, b = (i * SP, j * SP), (i * SP + SP, j * SP)
                    road(a, b, 20 if pass_ else 25, MINOR if pass_ else CASE, None)
    # secondary roads every 4th line
    for pass_ in (0, 1):
        for i in range(iu0, iu1):
            if i % 4 == 0: road((i * SP, v0), (i * SP, v1), 34 if pass_ else 42, SEC if pass_ else SECC, None)
        for j in range(iv0, iv1):
            if j % 4 == 0: road((u0, j * SP), (u1, j * SP), 34 if pass_ else 42, SEC if pass_ else SECC, None)
    # primary curved arterial + a bridge across the river
    for pass_ in (0, 1):
        pts = []
        for Y in range(int(Y0 - 800), int(Y0 + span + 800), max(10, int(f * 8))):
            Xp = CX + 900 + 700 * math.sin((Y - CY) / 3000)
            pts.append(P(Xp, Y))
        d.line(pts, fill=PRI if pass_ else PRIC, width=max(2, int((46 if pass_ else 56) * s)), joint='curve')
        by = CY - 600
        d.line([P(river_x(by) - 600, by), P(CX + 900 + 700 * math.sin(-600 / 3000), by)], fill=PRI if pass_ else PRIC, width=max(2, int((46 if pass_ else 56) * s)))
    im = im.resize((256, 256), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'PNG'); _cache[k] = b.getvalue()
    return _cache[k]


if __name__ == '__main__':
    z = 14; tx = int(CX / 256 / 2); ty = int(CY / 256 / 2)
    W = Image.new('RGB', (768, 768))
    for a in range(3):
        for b in range(3):
            W.paste(Image.open(io.BytesIO(tile(z, tx + a - 1, ty + b - 1))), (a * 256, b * 256))
    W.save('/home/claude/promo/check/tiles2.png')
