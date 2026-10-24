import json, sys
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad'
d=json.load(open(f'{S}/tut2/data/mgmt.json'))
for sc in d['scenes']:
    for b in sc['beats']: b['img']=f"file://{S}/tut2/{b['img']}"
html=open(f'{S}/tut2/explainer.html').read().replace('<script>/*data*/</script>', f"<script>window.SHOTS={json.dumps(d['scenes'])};window.LOGO='file://{S}/tut/img/logo-384.png';</script>")
open(f'{S}/tut2/build/mgmt-explainer.html','w').write(html)
