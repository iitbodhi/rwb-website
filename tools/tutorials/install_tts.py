# Voice clips per scene -> scene lengths + one voice track per video
import json, subprocess, wave, os, sys, re, numpy as np
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad'; V=f'{S}/voice'; T=f'{S}/tut'
ORIG={'android':[3.6,5.2,5.4,4.4,8.2,7.4,6.4,6.0,4.6],'ios':[3.6,5.6,4.0,6.2,4.6,6.4,4.4,4.4,6.4,6.2,4.6]}
LEAD,TAIL=.35,.55
cfg=json.load(open(f'{T}/install_vo.json')); plan={}
for v,lines in cfg.items():
    os.makedirs(f'{T}/vo_{v}',exist_ok=True); durs=[]; clips=[]
    for i,txt in enumerate(lines):
        f=f'{T}/vo_{v}/{i}.wav'
        subprocess.run([f'{V}/piper/piper','-m',f'{V}/en-us-ryan-high.onnx','-f',f],input=re.sub(r'\bRWB\b','R.W.B.',txt).encode(),check=True,stderr=subprocess.DEVNULL)
        with wave.open(f) as w: sr=w.getframerate(); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16)
        d=len(a)/sr; durs.append(round(max(ORIG[v][i], LEAD+d+TAIL),2)); clips.append(a)
    total=sum(durs); track=np.zeros(int((total+.5)*sr),np.int16); t=0
    for d,a in zip(durs,clips):
        s0=int((t+LEAD)*sr); track[s0:s0+len(a)]=a; t+=d
    with wave.open(f'{T}/vo_{v}.wav','w') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(track.tobytes())
    plan[v]=durs; print(v, round(total,1), durs)
json.dump(plan,open(f'{T}/install_plan.json','w'))
