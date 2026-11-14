"""Make a guide PDF lighter without changing how it looks (used by .github/workflows/slim-guides.yml).
- Fonts embedded whole (often 1-2 MB) are cut down to the letters the PDF actually uses (glyph numbers kept).
- Very large pictures are re-saved as JPEG, at most 1600 px on the long side (transparency kept).
The caller checks every page against the original before using the result.
Usage: python slim_pdf.py in.pdf out.pdf"""
import io, os, sys
import pikepdf
from PIL import Image
from fontTools import subset
from fontTools.ttLib import TTFont

MAX_SIDE = 1600

def used_glyphs(pdf):
    used = {}
    def fonts_of(res):
        out = {}
        if res is None or '/Font' not in res: return out
        for n, f in res.Font.items():
            if f.get('/Subtype') == '/Type0' and '/DescendantFonts' in f: out[n] = f.DescendantFonts[0]
        return out
    def walk(obj, res, depth=0):
        if depth > 8: return
        fmap = fonts_of(res); cur = None
        for operands, op in pikepdf.parse_content_stream(obj):
            o = str(op)
            if o == 'Tf': cur = fmap.get(str(operands[0]))
            elif o in ('Tj', "'", '"', 'TJ') and cur is not None:
                s = used.setdefault(cur.objgen, set())
                for it in (operands[0] if o == 'TJ' else [operands[-1]]):
                    if isinstance(it, pikepdf.String):
                        b = bytes(it)
                        for i in range(0, len(b) - 1, 2): s.add(b[i] << 8 | b[i + 1])
            elif o == 'Do' and res is not None and '/XObject' in res:
                x = res.XObject.get(str(operands[0]))
                if x is not None and x.get('/Subtype') == '/Form': walk(x, x.get('/Resources', res), depth + 1)
    for pg in pdf.pages: walk(pg, pg.obj.get('/Resources'))
    return used

def slim_fonts(pdf):
    used = used_glyphs(pdf)
    for o in list(pdf.objects):
        if not (isinstance(o, pikepdf.Dictionary) and o.get('/Subtype') == '/CIDFontType2'): continue
        fd = o.get('/FontDescriptor')
        if fd is None or '/FontFile2' not in fd: continue
        if o.get('/CIDToGIDMap') not in (None, pikepdf.Name('/Identity')): continue
        gids = used.get(o.objgen)
        if not gids: continue
        ff = fd.FontFile2; data = ff.read_bytes()
        font = TTFont(io.BytesIO(data))
        for t in ('gvar', 'fvar', 'avar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'cvar'):
            if t in font: del font[t]
        n = len(font['loca']) - 1 if 'loca' in font else len(font.getGlyphOrder())
        opts = subset.Options(); opts.retain_gids = True; opts.notdef_outline = True; opts.layout_features = []
        opts.name_IDs = ['*']; opts.hinting = False; opts.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'DSIG']
        sub = subset.Subsetter(opts); sub.populate(gids=sorted(g for g in gids | {0} if g < n)); sub.subset(font)
        out = io.BytesIO(); font.save(out); nb = out.getvalue()
        if len(nb) < len(data): ff.write(nb); ff.Length1 = len(nb)

def slim_images(pdf):
    for o in list(pdf.objects):
        if not (isinstance(o, pikepdf.Stream) and o.get('/Subtype') == '/Image'): continue
        raw = len(o.read_raw_bytes())
        if raw < 250_000 or str(o.get('/ColorSpace')) not in ('/DeviceRGB', '/DeviceGray') or '/Decode' in o or '/Mask' in o: continue
        if int(o.get('/BitsPerComponent', 8)) != 8: continue
        w, h = int(o.Width), int(o.Height)
        try: im = pikepdf.PdfImage(o).as_pil_image()
        except Exception: continue
        sc = min(1, MAX_SIDE / max(w, h)); nw, nh = max(1, round(w * sc)), max(1, round(h * sc))
        im = im.convert('RGB' if str(o.ColorSpace) == '/DeviceRGB' else 'L')
        if (nw, nh) != (w, h): im = im.resize((nw, nh), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=80, optimize=True); jb = buf.getvalue()
        if len(jb) >= raw * 0.8: continue
        if '/SMask' in o:
            sm = o.SMask
            if (nw, nh) != (w, h):
                try: m = pikepdf.PdfImage(sm).as_pil_image().convert('L').resize((nw, nh), Image.LANCZOS)
                except Exception: continue
                sm.write(m.tobytes()); sm.Width, sm.Height = nw, nh; sm.BitsPerComponent = 8; sm.ColorSpace = pikepdf.Name('/DeviceGray')
                for k in ('/DecodeParms', '/Decode', '/Filter'):
                    if k in sm and k != '/Filter': del sm[k]
        o.write(jb, filter=pikepdf.Name('/DCTDecode')); o.Width, o.Height = nw, nh; o.BitsPerComponent = 8
        if '/DecodeParms' in o: del o['/DecodeParms']

def slim(src, dst):
    pdf = pikepdf.open(src)
    try: slim_fonts(pdf)
    except Exception as e: print('fonts skipped:', e)
    try: slim_images(pdf)
    except Exception as e: print('images skipped:', e)
    pdf.remove_unreferenced_resources()
    pdf.save(dst, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate, recompress_flate=True)
    return os.path.getsize(src), os.path.getsize(dst)

if __name__ == '__main__':
    print(*slim(sys.argv[1], sys.argv[2]))
