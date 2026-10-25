import json
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad'
d=json.load(open(f'{S}/tut2/data/mgmt3.json'))
for sc in d['scenes']:
    for b in sc['beats']: b['img']=f"file://{S}/tut2/{b['img']}"
vo=json.load(open(f'{S}/tut2/vo_timing4.json'))
for v in vo.values():
    for x in v['sents']: x.pop('wav',None)
html=open(f'{S}/tut2/explainer4.html').read().replace('/*CSS*/',open(f'{S}/tut2/ex2.css').read())
html=html.replace('<script>/*data*/</script>', f"<script>window.SHOTS={json.dumps(d['scenes'])};window.VO={json.dumps(vo)};window.LOGO='file://{S}/tut/img/logo-384.png';</script>")
open(f'{S}/tut2/build/mgmt-explainer4.html','w').write(html)
