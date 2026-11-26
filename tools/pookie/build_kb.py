"""Builds pookie/kb.json (Pookie's knowledge pack) from the Markdown files in pookie/src/.

Each entry in a source file:
    ## Title written like the questions riders ask
    k: extra search words (optional)
    b: tag (app | ronin | any | xsr | himalayan450 | ... ) (optional, default any)
    The answer text (one or more lines).
Lines starting with "#" (one hash) are comments.

The pack lives on roninwb.in (GitHub Pages), NOT in Supabase: the ask-ronin Edge Function downloads it
(cached for 6 hours), so it costs no database space and no Supabase egress.
Run:  python3 tools/pookie/build_kb.py
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC, OUT = ROOT / 'pookie' / 'src', ROOT / 'pookie' / 'kb.json'

def parse(path):
    rows, cur = [], None
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('## '):
            if cur: rows.append(cur)
            cur = {'t': line[3:].strip(), 'k': '', 'b': 'any', 'c': []}
        elif cur is None or (line.startswith('# ') and not cur['c']):
            continue
        elif line.startswith('k:') and not cur['c']:
            cur['k'] = line[2:].strip()
        elif line.startswith('b:') and not cur['c']:
            cur['b'] = line[2:].strip()
        else:
            cur['c'].append(line.rstrip())
    if cur: rows.append(cur)
    out = []
    for r in rows:
        c = re.sub(r'\n{3,}', '\n\n', '\n'.join(r['c']).strip())
        if not c: sys.exit(f'{path.name}: "{r["t"]}" has no answer text')
        if len(c) > 1400: print(f'warning: {path.name}: "{r["t"]}" is long ({len(c)} chars); Pookie only reads the first 900')
        out.append({'t': r['t'], 'k': r['k'], 'b': r['b'], 'c': c})
    return out

rows = []
for f in sorted(SRC.glob('*.md')):
    rows += parse(f)
titles = [r['t'] for r in rows]
dupes = {t for t in titles if titles.count(t) > 1}
if dupes: sys.exit(f'duplicate titles: {dupes}')
OUT.write_text(json.dumps({'v': 1, 'n': len(rows), 'rows': rows}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(rows)} entries, {OUT.stat().st_size // 1024} KB → {OUT.relative_to(ROOT)}')
