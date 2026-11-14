"""Builds one how-to video from a recording (data/NAME.json): voice → timing → frames → music → small MP4 + cover JPG.
python3 make.py NAME [preview times...]"""
import json, os, sys, math, asyncio, wave, subprocess, shutil
import numpy as np
from playwright.async_api import async_playwright

S = '/home/claude/work/tut3'; V = '/home/claude/voice'
CFG = {
    'home': ('Home & My Ride', 'Your bike at a glance', '🏠'),
    'track': ('Track & SOS', 'Live location on rides, and help when you need it', '📍'),
    'service': ('Service', 'Keep every service and bill', '🔧'),
    'mileage': ('Mileage', 'Your real km per litre', '⛽'),
    'motomart': ('MotoMart', 'Buy and sell bike gear', '🛒'),
    'guides': ('Guides & Pookie', 'Bike care guides and the RWB helper', '📘'),
    'events': ('Events', 'Rides, meet-ups and shared costs', '🏍️'),
    'warriorboards': ('Warriorboards', 'Top riders and RWB members', '🏆'),
    'me': ('Me', 'Your profile and settings', '👤'),
    'calendar': ('Calendar & Papers', 'Every date and document in one place', '📅'),
    'coordinators-and-admins': ('Team tools', 'For coordinators and admins', '🛡️'),
    'fam-app': ('RWB FAM', 'For a rider\'s family', '👨‍👩‍👧'),
}
INTRO = {'coordinators-and-admins': 'Team tools, for coordinators and admins.', 'fam-app': 'R W B FAM. The app for a rider\'s family.',
         'guides': 'Guides and Pookie.', 'calendar': 'Calendar, and your bike papers.', 'home': 'Home, and My Ride.', 'track': 'Track, and S O S.'}
LEAD, GAP, TAIL, OUTRO = .35, .35, .55, 2.2
FPS = 30


def tts(text, f, ls):
    subprocess.run([f'{V}/piper/piper', '-m', f'{V}/en-us-ryan-high.onnx', '--length_scale', str(ls), '--sentence_silence', '0.1', '-f', f],
                   input=text.encode(), check=True, stderr=subprocess.DEVNULL)
    with wave.open(f) as w: return w.getnframes() / w.getframerate()


def plan(name, data, ls):
    out = f'{S}/vo/{name}'; os.makedirs(out, exist_ok=True)
    def block(sents, key):
        t = LEAD; ss = []
        for i, s in enumerate(sents):
            f = f'{out}/{key}-{i}.wav'; d = tts(s, f, ls)
            shown = s.replace('R W B', 'RWB').replace('one one two', '112').replace('S O S', 'SOS').replace('R C', 'RC')
            ss.append({'t': round(t, 3), 'd': round(d, 3), 'text': shown, 'wav': f}); t += d + GAP
        return t - GAP + TAIL, ss
    title = CFG[name][0]
    d, ss = block([INTRO.get(name, f'How to use {title}.')], 'intro')
    scenes = [{'kind': 'card', 'dur': max(2.6, d), 'sents': ss}]
    for i, sc in enumerate(data['scenes']):
        d, ss = block(sc['say'], f's{i}')
        floor = sum(max(1.15 if b.get('tap') else .7, b['hold'] * .6) for b in sc['beats'])
        scenes.append({'kind': 'app', 'idx': i, 'dur': round(max(d, floor), 3), 'sents': ss})
    scenes.append({'kind': 'end', 'dur': OUTRO, 'sents': []})
    return scenes


def main(name, preview):
    data = json.load(open(f'{S}/data/{name}.json'))
    for ls in (1.0, .96, .92, .88):
        scenes = plan(name, data, ls); tot = sum(s['dur'] for s in scenes)
        if tot <= 59: break
    print(f'{name}: {tot:.1f}s voice speed {ls} |', ' '.join(f"{s['dur']:.1f}" for s in scenes))
    title, tag, icon = CFG[name]
    shots = [{'cap': s['cap'], 'beats': [{**b, 'img': f"file://{S}/{b['img']}"} for b in s['beats']]} for s in data['scenes']]
    pl = {'scenes': [{**s, 'sents': [{k: v for k, v in x.items() if k != 'wav'} for x in s['sents']]} for s in scenes]}
    html = open(f'{S}/howto2.html').read().replace('<script>/*data*/</script>', '<script>window.SHOTS=%s;window.PLAN=%s;window.CFG=%s;window.LOGO=%r;</script>' % (
        json.dumps(shots), json.dumps(pl), json.dumps({'title': title, 'tag': tag, 'icon': icon}), f'file://{S}/assets/logo-384.png'))
    os.makedirs(f'{S}/build', exist_ok=True); page = f'{S}/build/{name}.html'; open(page, 'w').write(html)
    OUT = f'{S}/frames/{name}'

    async def newpage(p):
        b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width': 1080, 'height': 1920}, device_scale_factor=2 / 3)).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'file://{page}'); await pg.wait_for_timeout(1500)
        return b, pg, errs

    async def shots_(times):
        async with async_playwright() as p:
            b, pg, errs = await newpage(p)
            for t in times: await pg.evaluate(f'render({t})'); await pg.screenshot(path=f'{S}/pv-{name}-{t}.jpg', type='jpeg', quality=80)
            print('errors', errs); await b.close()

    async def worker(p, k, n, total):
        b, pg, errs = await newpage(p)
        for f in range(k, total, n):
            await pg.evaluate(f'render({f / FPS})'); await pg.screenshot(path=f'{OUT}/{f:05d}.jpg', type='jpeg', quality=92)
        if errs: print('errors', errs)
        await b.close()

    async def frames(total):
        async with async_playwright() as p: await asyncio.gather(*[worker(p, k, 6, total) for k in range(6)])

    if preview: asyncio.run(shots_([float(x) for x in preview])); return
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
    asyncio.run(frames(math.ceil(tot * FPS)))
    # voice + soft music underneath (ducked while speaking)
    SR = 22050; v = np.zeros(int((tot + .5) * SR), np.float32); st = 0
    for s in scenes:
        for x in s['sents']:
            with wave.open(x['wav']) as w: a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
            i = int((st + x['t']) * SR); v[i:i + len(a)] += a
        st += s['dur']
    v = v[:int(tot * SR)]; v = v / np.abs(v).max() * .89
    SR2 = 44100; v = np.interp(np.arange(int(len(v) * SR2 / SR)) * SR / SR2, np.arange(len(v)), v).astype(np.float32); n = len(v); t = np.arange(n) / SR2
    f = lambda m: 440 * 2 ** ((m - 69) / 12)
    chords = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]]; bar = 3.0; music = np.zeros(n, np.float32); k = 0
    while k * bar * SR2 < n:
        ch = chords[k % 4]; s0 = int(k * bar * SR2); L = int((bar + 1.2) * SR2); tt = np.arange(L) / SR2
        env = np.minimum(1, tt / .8) * np.exp(-np.maximum(0, tt - bar) / .5)
        seg = sum((np.sin(2 * np.pi * f(m) * tt) + .3 * np.sin(4 * np.pi * f(m) * tt) + .12 * np.sin(6 * np.pi * f(m) * tt)) * (.6 if m < 50 else .35) for m in ch) * env
        for bb in range(6):
            s1 = int(bb * .5 * SR2); tl = tt[:L - s1]; m = ch[(bb + 1) % 4] + 12 + (12 if bb % 3 == 2 else 0)
            seg[s1:] += np.sin(2 * np.pi * f(m) * tl) * np.exp(-tl * 3.5) * .3
        e = min(n, s0 + L); music[s0:e] += seg[:e - s0].astype(np.float32); k += 1
    music = np.convolve(music, np.ones(25) / 25, mode='same'); music /= np.abs(music).max()
    w_ = int(.25 * SR2); envv = np.convolve(np.abs(v), np.ones(w_) / w_, mode='same')
    duck = np.convolve((envv > .01).astype(np.float32), np.ones(int(.4 * SR2)) / int(.4 * SR2), mode='same')
    mix = v * .95 + music * (.10 - .065 * duck) * np.clip(np.minimum(t / .8, (t[-1] - t) / 2.0), 0, 1)
    mix /= max(1, np.abs(mix).max() / .97)
    wav = f'{S}/build/{name}.wav'
    with wave.open(wav, 'w') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR2); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    os.makedirs(f'{S}/out', exist_ok=True); mp4 = f'{S}/out/{name}.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{OUT}/%05d.jpg', '-i', wav, '-c:v', 'libx264', '-preset', 'slower', '-crf', '31',
                    '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-g', '120', '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-shortest', '-movflags', '+faststart', mp4], check=True)
    # cover: the title card, small
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{OUT}/00010.jpg', '-vf', 'scale=360:-2', '-q:v', '5', f'{S}/out/{name}.jpg'], check=True)
    d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], capture_output=True, text=True).stdout.strip()
    print(name, 'done', d, 's', round(os.path.getsize(mp4) / 1e6, 2), 'MB')
    json.dump({'dur': float(d)}, open(f'{S}/out/{name}.json', 'w'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
