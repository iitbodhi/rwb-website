import json, subprocess, wave, os, re
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad'
V=f'{S}/voice'; OUT=f'{S}/tut2/vo'; os.makedirs(OUT, exist_ok=True)
VOICE=os.environ.get('VOICE','en-us-ryan-high')
vo=json.load(open(f'{S}/tut2/vo.json'))
def say(t):
    t=t.replace('RWB','R.W.B.').replace('REMOVE','remove').replace('Ride safe','Ride safe!')
    return t
LEAD, GAP, TAIL = .6, .38, .9
timing={}
for sid, sents in vo.items():
    t=LEAD; out=[]
    for i, s in enumerate(sents):
        f=f'{OUT}/{sid}-{i}.wav'
        subprocess.run([f'{V}/piper/piper','-m',f'{V}/{VOICE}.onnx','--length_scale','1.06','-f',f], input=say(s).encode(), check=True, stderr=subprocess.DEVNULL)
        with wave.open(f) as w: d=w.getnframes()/w.getframerate()
        out.append({'t':round(t,3),'d':round(d,3),'text':s,'wav':f}); t+=d+GAP
    timing[sid]={'dur':round(t-GAP+TAIL,3),'sents':out}
json.dump(timing, open(f'{S}/tut2/vo_timing.json','w'), indent=1)
print({k:v['dur'] for k,v in timing.items()}, 'total', round(sum(v['dur'] for v in timing.values()),1))
