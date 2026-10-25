import wave, numpy as np
S='/tmp/claude-0/-home-claude/298ce0ef-b0f8-5ec3-a03d-16ae7e00049c/scratchpad/tut2'
SR=44100
with wave.open(f'{S}/vo_track5.wav') as w: sr=w.getframerate(); v=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
v=np.interp(np.arange(int(len(v)*SR/sr))*sr/SR, np.arange(len(v)), v).astype(np.float32)
n=len(v); t=np.arange(n)/SR
def ma(x,w):
    c=np.cumsum(np.concatenate([np.zeros(1,np.float64),x.astype(np.float64)])); h=w//2; i=np.arange(len(x)); lo=np.clip(i-h,0,len(x)); hi=np.clip(i-h+w,0,len(x)); return ((c[hi]-c[lo])/w).astype(np.float32)
f=lambda m: 440*2**((m-69)/12)
chords=[[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,59]]
bar=4.0; music=np.zeros(n,np.float32); k=0
while k*bar*SR < n:
    ch=chords[k%4]; s0=int(k*bar*SR); L=int((bar+1.5)*SR); tt=np.arange(L)/SR
    env=np.minimum(1,tt/1.2)*np.exp(-np.maximum(0,tt-bar)/0.6)
    seg=sum((np.sin(2*np.pi*f(m)*tt)+0.3*np.sin(4*np.pi*f(m)*tt)+0.12*np.sin(6*np.pi*f(m)*tt))*(0.6 if m<50 else 0.35) for m in ch)*env
    for b in range(4):
        st=int(b*SR); tl=tt[:L-st]; m=ch[(b+1)%4]+12
        seg[st:]+=np.sin(2*np.pi*f(m)*tl)*np.exp(-tl*3.0)*0.35
    e=min(n,s0+L); music[s0:e]+=seg[:e-s0].astype(np.float32); k+=1
music=ma(music,25); music/=np.abs(music).max()
w_=int(.25*SR); envv=ma(np.abs(v),w_)
duck=(envv>0.01).astype(np.float32); w2=int(.4*SR); duck=ma(duck,w2)
gain=0.10-0.06*duck
fade=np.clip(np.minimum(t/1.5,(t[-1]-t)/3.0),0,1)
mix=v*0.95+music*gain*fade
mix/=max(1,np.abs(mix).max()/0.97)
st=np.stack([mix,mix],1)
with wave.open(f'{S}/final_audio5.wav','w') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype(np.int16).tobytes())
print('ok', n/SR)
