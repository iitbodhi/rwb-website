# Voice clips + timing plan for every how-to video; prints the length of each so they stay under 58 s.
import json, subprocess, wave, os, sys
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad'
V=f'{S}/voice'; T=f'{S}/tut2'
cfg=json.load(open(f'{T}/howto_vo.json'))
LEAD, GAP, TAIL, INTRO_MIN, OUTRO = .35, .3, .45, 3.2, 2.4
def tts(text, f, ls):
    subprocess.run([f'{V}/piper/piper','-m',f'{V}/en-us-ryan-high.onnx','--length_scale',str(ls),'-f',f],
                   input=text.replace('RWB','R.W.B.').encode(), check=True, stderr=subprocess.DEVNULL)
    with wave.open(f) as w: return w.getnframes()/w.getframerate()
def plan(name, ls):
    c=cfg[name]; out=f'{T}/vo_{name}'; os.makedirs(out, exist_ok=True)
    data=json.load(open(f'{T}/data/{name}.json'))
    def block(sents, key):
        t=LEAD; ss=[]
        for i,s in enumerate(sents):
            f=f'{out}/{key}-{i}.wav'; d=tts(s,f,ls); ss.append({'t':round(t,3),'d':round(d,3),'text':s,'wav':f}); t+=d+GAP
        return t-GAP+TAIL, ss
    d, ss = block(c['intro'],'intro'); scenes=[{'kind':'card','dur':max(INTRO_MIN,d),'sents':ss}]
    for i,(sents,sc) in enumerate(zip(c['scenes'], data['scenes'])):
        d, ss = block(sents, f's{i}')
        raw=sum(b['hold'] for b in sc['beats'])
        floor=sum(max(.75 if b.get('tap') else .55, b['hold']*.62) for b in sc['beats'])
        scenes.append({'kind':'app','idx':i,'dur':round(max(d, floor),3),'raw':raw,'sents':ss})
    scenes.append({'kind':'end','dur':OUTRO,'sents':[]})
    return scenes
res={}
for name in (sys.argv[1:] or cfg):
    for ls in (1.0, .94, .9):
        sc=plan(name, ls); tot=sum(s['dur'] for s in sc)
        if tot<=58: break
    res[name]={'total':round(tot,1),'ls':ls,'scenes':sc}
    print(f'{name:9s} {tot:5.1f}s  voice speed {ls}  ' + ' '.join(f"{s['dur']:.1f}" for s in sc))
old=json.load(open(f'{T}/howto_plan.json')) if os.path.exists(f'{T}/howto_plan.json') else {}
old.update(res); json.dump(old, open(f'{T}/howto_plan.json','w'), indent=1)
