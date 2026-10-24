# Builds one how-to video: page → frames → voice + music → MP4 (+ cover JPG)
import json, os, sys, math, asyncio, wave, subprocess, shutil
import numpy as np
from playwright.async_api import async_playwright
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad'; T=f'{S}/tut2'
name=sys.argv[1]; preview=sys.argv[2:]
cfg=json.load(open(f'{T}/howto_vo.json'))[name]; plan=json.load(open(f'{T}/howto_plan.json'))[name]
data=json.load(open(f'{T}/data/{name}.json'))
for sc in data['scenes']:
    for b in sc['beats']: b['img']=f"file://{T}/{b['img']}"
pl={'scenes':[{k:v for k,v in s.items()} for s in plan['scenes']]}
for s in pl['scenes']:
    s['sents']=[{k:v for k,v in x.items() if k!='wav'} for x in s['sents']]
html=open(f'{T}/howto.html').read().replace('/*CSS*/',open(f'{T}/ex2.css').read())
html=html.replace('<script>/*data*/</script>', '<script>window.SHOTS=%s;window.PLAN=%s;window.CFG=%s;window.LOGO=%r;</script>'%(json.dumps(data['scenes']),json.dumps(pl),json.dumps(cfg),f'file://{S}/tut/img/logo-384.png'))
page=f'{T}/build/howto-{name}.html'; open(page,'w').write(html)
OUT=f'{T}/frames/h-{name}'
async def shots(times):
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(f'file://{page}'); await pg.wait_for_timeout(1500)
        for t in times: await pg.evaluate(f'render({t})'); await pg.screenshot(path=f'{T}/pv-{name}-{t}.jpg',type='jpeg',quality=70)
        print('errors',errs, 'total', await pg.evaluate('TOTAL')); await b.close()
async def worker(p,k,n,total):
    b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1080,'height':1920})).new_page()
    await pg.goto(f'file://{page}'); await pg.wait_for_timeout(1500)
    for f in range(k,total,n):
        await pg.evaluate(f'render({f/30})'); await pg.screenshot(path=f'{OUT}/{f:05d}.jpg',type='jpeg',quality=88)
    await b.close()
async def frames(total):
    async with async_playwright() as p: await asyncio.gather(*[worker(p,k,4,total) for k in range(4)])
if preview:
    asyncio.run(shots([float(x) for x in preview])); sys.exit()
tot=sum(s['dur'] for s in plan['scenes'])
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
asyncio.run(frames(math.ceil(tot*30)))
# voice track
SR=22050; v=np.zeros(int((tot+.5)*SR),np.float32); st=0
for s in plan['scenes']:
    for x in s['sents']:
        with wave.open(x['wav']) as w: a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
        i=int((st+x['t'])*SR); v[i:i+len(a)]+=a
    st+=s['dur']
v=v[:int(tot*SR)]; v=v/np.abs(v).max()*.89
SR2=44100; v=np.interp(np.arange(int(len(v)*SR2/SR))*SR/SR2, np.arange(len(v)), v).astype(np.float32); n=len(v); t=np.arange(n)/SR2
f=lambda m: 440*2**((m-69)/12)
chords=[[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,59]]; bar=3.0; music=np.zeros(n,np.float32); k=0
while k*bar*SR2 < n:
    ch=chords[k%4]; s0=int(k*bar*SR2); L=int((bar+1.2)*SR2); tt=np.arange(L)/SR2
    env=np.minimum(1,tt/.8)*np.exp(-np.maximum(0,tt-bar)/.5)
    seg=sum((np.sin(2*np.pi*f(m)*tt)+.3*np.sin(4*np.pi*f(m)*tt)+.12*np.sin(6*np.pi*f(m)*tt))*(.6 if m<50 else .35) for m in ch)*env
    for b in range(6):
        s1=int(b*.5*SR2); tl=tt[:L-s1]; m=ch[(b+1)%4]+12+(12 if b%3==2 else 0)
        seg[s1:]+=np.sin(2*np.pi*f(m)*tl)*np.exp(-tl*3.5)*.3
    e=min(n,s0+L); music[s0:e]+=seg[:e-s0].astype(np.float32); k+=1
music=np.convolve(music,np.ones(25)/25,mode='same'); music/=np.abs(music).max()
w_=int(.25*SR2); envv=np.convolve(np.abs(v),np.ones(w_)/w_,mode='same')
duck=np.convolve((envv>.01).astype(np.float32),np.ones(int(.4*SR2))/int(.4*SR2),mode='same')
mix=v*.95+music*(.11-.065*duck)*np.clip(np.minimum(t/.8,(t[-1]-t)/2.0),0,1)
mix/=max(1,np.abs(mix).max()/.97)
with wave.open(f'{T}/h-{name}.wav','w') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR2); w.writeframes((np.stack([mix,mix],1)*32767).astype(np.int16).tobytes())
os.makedirs(f'{T}/out/stories',exist_ok=True)
mp4=f"{T}/out/stories/RWB-How-to-{cfg['file']}.mp4"
subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','30','-i',f'{OUT}/%05d.jpg','-i',f'{T}/h-{name}.wav','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',mp4],check=True)
shutil.copy(f'{OUT}/00000.jpg', f"{T}/out/stories/Cover-{cfg['file']}.jpg")
d=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],capture_output=True,text=True).stdout.strip()
print(name,'done',d,'s')
