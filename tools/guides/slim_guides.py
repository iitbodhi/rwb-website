"""RWB Guides robot (run by .github/workflows/slim-guides.yml every 30 minutes).
For each guide PDF not checked yet (guide_items.slim is null):
  1. makes it lighter with slim_pdf.py, then checks EVERY page still looks the same as the original;
  2. adds a first-page preview picture if the guide has none.
Files are saved to the Guides library by the guides-slim Edge Function, using a one-time key put in the database here.
Needs env DB_URL (the SUPABASE_DB_URL secret, also used by the nightly backup)."""
import base64, json, os, secrets, subprocess, sys, tempfile, urllib.request
import psycopg
from PIL import Image, ImageChops, ImageStat
sys.path.insert(0, os.path.dirname(__file__))
from slim_pdf import slim

FN = 'https://hcowcybshljgkeixudry.supabase.co/functions/v1/guides-slim'
db = psycopg.connect(os.environ['DB_URL'], autocommit=True, prepare_threshold=None)

def send(item_id, kind, data):
    tok = secrets.token_urlsafe(32)
    db.execute('insert into private.slim_tokens(token) values (%s)', (tok,))
    body = json.dumps({'token': tok, 'id': item_id, 'kind': kind, 'data': base64.b64encode(data).decode()}).encode()
    req = urllib.request.Request(FN, body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())

def pages(path, out, dpi=50):
    subprocess.run(['pdftoppm', '-r', str(dpi), '-png', path, out], check=True, timeout=180)
    return sorted(f for f in os.listdir(os.path.dirname(out)) if f.startswith(os.path.basename(out)))

def same_look(a, b, tmp):
    pa, pb = pages(a, os.path.join(tmp, 'a')), pages(b, os.path.join(tmp, 'b'))
    if len(pa) != len(pb) or not pa: return False
    for x, y in zip(pa, pb):
        A = Image.open(os.path.join(tmp, x)).convert('RGB'); B = Image.open(os.path.join(tmp, y)).convert('RGB')
        if A.size != B.size: return False
        if sum(ImageStat.Stat(ImageChops.difference(A, B)).mean) / 3 > 3: return False   # out of 255: invisible JPEG change only
    return True

def mark(item_id, status): db.execute('update public.guide_items set slim = %s where id = %s', (status, item_id))

rows = db.execute("select id, url, bytes, thumb_url from public.guide_items where kind = 'pdf' and slim is null order by id limit 8").fetchall()
print(f'{len(rows)} guide PDF(s) to check')
for item_id, url, size, thumb in rows:
    with tempfile.TemporaryDirectory() as tmp:
        try:
            src, out = os.path.join(tmp, 'in.pdf'), os.path.join(tmp, 'out.pdf')
            with urllib.request.urlopen(url, timeout=120) as r, open(src, 'wb') as f: f.write(r.read())
            status = 'skip'
            before, after = slim(src, out)
            if after < before * 0.85 and same_look(src, out, tmp):
                print(item_id, 'lighter:', before, '->', after, send(item_id, 'pdf', open(out, 'rb').read()))
                status = 'done'
            else: print(item_id, 'kept as it is', before, after)
            if not thumb:
                subprocess.run(['pdftoppm', '-f', '1', '-l', '1', '-singlefile', '-jpeg', '-jpegopt', 'quality=72', '-scale-to-x', '480', '-scale-to-y', '-1', src, os.path.join(tmp, 'cover')], check=True, timeout=60)
                print(item_id, 'preview:', send(item_id, 'thumb', open(os.path.join(tmp, 'cover.jpg'), 'rb').read()))
            mark(item_id, status)
        except Exception as e:
            print(item_id, 'failed:', e); mark(item_id, 'fail')
