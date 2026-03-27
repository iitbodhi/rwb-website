/* RWB — Ronin Warriors of Bengal | script.js */
'use strict';

const CONFIG = {
    EVENTS_SHEET_URL: 'https://docs.google.com/spreadsheets/d/13qt3ZmYHX1EILkQzqo9TzLWKfKmuAd_QwYzStDTLEzU/export?format=csv&gid=0',
    FORM_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxkvBKEBHTLN-Q1QZvLB0o9qiRfuDmcSfUMT0Cay7D-na2ekwTWD-uuCDDswwI-UfFugw/exec',
    GALLERY_URL: 'https://script.google.com/macros/s/AKfycbzrswFdnP-IjFNdXedZDnc9aqg63sOqoLaVCkPC6p2sOzBzKNrjg0ryiYVphZgFlt29YA/exec',
    CORS: 'https://api.allorigins.win/raw?url='
};

const WARRIORS = [
    {name:'Sayantan Sarkar',nick:'Boss',role:'admin',label:'Founder & Admin',bike:'TVS Ronin 225 (Orange) — Kurama · TVS Ronin 225 (Black) — Shado',photo:'boss.png',desc:"In the courtroom, he commands with the precision of law. On the open road, he commands with the authority of a man who built something from nothing. Sayantan didn't just found RWB — he breathed life into it. The Boss rides first. Always."},
    {name:'Arnab Das',nick:'Boro Admin',role:'admin',label:'Co-Founder & Admin',bike:'TVS Ronin 225 (Galactic Grey) — TD',photo:'arnab.png',desc:"Some men speak volumes. Arnab lets the tarmac do the talking. While others plan the ride, he's already at the next checkpoint. The quiet co-architect of RWB — his actions have always been louder than any engine note."},
    {name:'Kaustabh Bhattacharjee',nick:'Pookie',role:'admin',label:'Admin',bike:'TVS Ronin 225',photo:'pookie.png',desc:'One lakh kilometres and still counting. If roads had a memory, they\'d remember Pookie\'s wheels before anything else. The Pookie of RWB is many things — but "stationary" has never been one of them.'},
    {name:'Debapam Pal',nick:'Momo',role:'admin',label:'Admin',bike:'TVS Ronin 225 (Blue)',photo:'momo.png',desc:'He debugs systems by day and destroys the pace chart by weekend. That warm, momomolicious smile is the last thing the group sees before he opens the throttle and vanishes into the horizon. The IT giant with a pure rider\'s soul.'},
    {name:'Bodhisatwa Mallick',nick:'Dancer Bodhi',role:'admin',label:'Admin',bike:'TVS Ronin 225 (Magma Red) — Sula',photo:'bodhi.png',desc:"Compact in frame, limitless on the road. Bodhi carries a special hatred for public buses and a special love for the open lane. Whether it's the dance floor or the highway — his moves are always the ones everyone watches."},
    {name:'Rohan Ghosh',nick:'Pinky',role:'coadmin',label:'Co-admin',bike:'Bajaj Dominar 250 (Green) — Domi',photo:'pinky.png',desc:"Every convoy needs its anchor. Pinky rides sweep — last in the line, first to notice if someone's missing. Born with marshal instincts and a protector's heart, Rohan ensures no Ronin Warrior ever gets left behind."},
    {name:'Soumya JS',nick:'CC',role:'coadmin',label:'Co-admin',bike:'TVS Ronin 225 — 2024 Special Edition (Nimbus Grey)',photo:'soumya.png',desc:'Middle-aged, slightly receding hairline, gloriously unrepentant. He draws the route maps with the obsession of a cartographer and loses them with the grace of a philosopher. For Soumya, the journey was never about the destination.'},
    {name:'Arpan Paik',nick:'Radio',role:'coadmin',label:'Co-admin',bike:'RE Himalayan 411 (Mirage Silver)',photo:'arpan.png',desc:'Where others see asphalt, Radio sees a frequency. Tuned permanently to the channel between throttle and horizon, Arpan runs on adrenaline, breathes adventure, and transmits energy to everyone who rides beside him.'},
    {name:'Ranit Pal Chowdhury',nick:'BBC',role:'coordinator',label:'Co-ordinator',bike:'TVS Ronin 225 (Lightning Black) — Kuro',photo:'ranit.png',desc:"Negotiations are his profession, but the open road is his real boardroom. Fuelled by caffeine and armed with a camera eye, Ranit documents RWB's soul one frame at a time. Firmly, fiercely, unapologetically anti-squid."},
    {name:'Sreejon',nick:'Kochi',role:'coordinator',label:'Co-ordinator',bike:'TVS Ronin 225 (Blue) — Pegasus',photo:'sreejon.png',desc:"The calmest presence in any pack. Kochi doesn't rush, doesn't rattle — he flows. Whether it's a 6 AM dawn patrol or a 400 km grind, he glides through it all with butter-smooth ease that makes everyone around him breathe easier."},
    {name:'Subhankar Biswas',nick:'Labubu',role:'coordinator',label:'Co-ordinator',bike:'TVS Ronin 225 (Lightning Black)',photo:'labubu.png',desc:"Every mile he's ridden has been a chapter earned, not given. From wide-eyed newcomer to road-tested warrior — Labubu's transformation is what RWB is built for. He doesn't chase roads. He earns them, one rise and fall at a time."},
    {name:'Arindam Biswas',nick:'Bucky',role:'coordinator',label:'Co-ordinator',bike:'TVS Ronin 225 (Galactic Grey) — Jarvis',photo:'bucky.png',desc:"He balances ledgers by week and horizons by weekend. Bucky's best financial decision was never on a spreadsheet — it was Jarvis, the open road, and the choice to ride further than reason ever suggested."},
    {name:'Moinak',nick:'Sek-C',role:'coordinator',label:'Co-ordinator',bike:'Apache RTR 200 4V (Red Black)',photo:'moinak.png',desc:'Code compiles by day. Freedom compiles by night. Moinak lives in that precise commit between the daily push and the open road — where IT gives way to throttle, and deadlines give way to the horizon.'},
    {name:'Kaustav Sanyal',nick:'Offroader',role:'coordinator',label:'Co-ordinator',bike:'TVS Ronin 225 (Orange) — Ronin-X',photo:'roninx.png',desc:"Tarmac is a starting point, not a destination. Ronin-X takes his machine where maps run out and signal dies — through mud, ridgeline, and raw terrain. For Kaustav, the real road has always been the one nobody paved."},
    {name:'Sourav Santara',nick:'KK',role:'coordinator',label:'Co-ordinator',bike:'TVS Ronin 225 (Galactic Grey)',photo:'sourav.png',desc:"An amateur in title only — behind the bars, KK rides with the hunger of someone discovering the road for the very first time, every time. A certified mountain addict whose Ronin already knows the hill roads better than the GPS does."}
];

const FALLBACK_GALLERY = [
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-side-view-3.png?isig=0&q=80'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-front-three-quarter.png?isig=0&q=80'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-rear-view.png?isig=0&q=80'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-front-view.png?isig=0&q=80'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-side-view-2.png?isig=0&q=80'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-left-side-view.png?isig=0&q=80'}
];

const isMobile = () => window.innerWidth <= 980;
let _audio = null;
const getAudio = () => {
    if (!_audio) _audio = new (window.AudioContext || window.webkitAudioContext)();
    if (_audio.state === 'suspended') _audio.resume();
    return _audio;
};

let galX = 0, galHalf = 0, galRAF = null, galDrag = 0;
let warList = [...WARRIORS];

/* ═══════════════════════════════════════════════════
   INIT — preloader MUST be first
   ═══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    initPreloader();        /* FIRST — always */
    initTheme();
    initGrain();
    initFireflies();
    initNav();
    initHero();
    initSmoothScroll();
    initParallax();
    initReveal();
    initCounters();
    initAboutPatch();
    buildSpecTagsRow();
    initGallery();
    initEvents();
    initWarriors();
    initForm();
    initLightbox();
});

/* ─── PRELOADER ─── */
function initPreloader() {
    const el = document.getElementById('preloader');
    const hide = () => {
        if (!el || el.classList.contains('gone')) return;
        el.classList.add('gone');
        document.body.classList.remove('loading');
        showHeroElements();
    };
    const t = setTimeout(hide, 900);
    window.addEventListener('load', () => { clearTimeout(t); setTimeout(hide, 80); }, { once: true });
}
function showHeroElements() {
    document.querySelectorAll('.hero-r').forEach((el, i) => {
        setTimeout(() => el.classList.add('in'), i * 120);
    });
}

/* ─── GRAIN ─── */
function initGrain() {
    try {
        const el = document.getElementById('firefly-canvas');
        if (!el) return;
        /* grain is done via firefly canvas setup; skip separate grain */
    } catch(e) {}
}

/* ─── THEME ─── */
function initTheme() {
    const html = document.documentElement;
    const btn = document.getElementById('theme-btn');
    html.setAttribute('data-theme', localStorage.getItem('rwb-theme') || 'dark');
    btn?.addEventListener('click', () => {
        const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('rwb-theme', next);
    });
}

/* ─── FIREFLIES ─── */
function initFireflies() {
    try {
        const canvas = document.getElementById('firefly-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let W, H;
        const N = isMobile() ? 30 : 70;
        const resize = () => {
            W = canvas.width = window.innerWidth;
            H = canvas.height = Math.max(document.body.scrollHeight, window.innerHeight * 3);
        };
        window.addEventListener('resize', () => setTimeout(resize, 300), { passive: true });
        window.addEventListener('load', resize, { once: true });
        resize();
        const flies = Array.from({ length: N }, () => {
            const f = {
                reset() { this.x=Math.random()*W; this.y=Math.random()*H; this.vx=(Math.random()-.5)*.45; this.vy=(Math.random()-.5)*.45; this.sz=Math.random()*2+.4; this.maxOp=Math.random()*.55+.1; this.ph=Math.random()*Math.PI*2; this.sp=Math.random()*.015+.005; },
                update(t) { this.x+=this.vx+Math.sin(t*.0008+this.ph)*.3; this.y+=this.vy+Math.cos(t*.0006+this.ph)*.25; this.op=this.maxOp*(0.5+0.5*Math.sin(t*this.sp+this.ph)); if(this.x<-10||this.x>W+10||this.y<-10||this.y>H+10)this.reset(); },
                draw() { ctx.beginPath(); ctx.arc(this.x,this.y,this.sz,0,Math.PI*2); ctx.fillStyle=`rgba(212,160,48,${this.op})`; ctx.fill(); }
            };
            f.reset(); return f;
        });
        let t = 0, scrollY = 0;
        window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });
        (function loop() {
            canvas.style.top = scrollY + 'px';
            ctx.clearRect(0, 0, W, H);
            flies.forEach(f => { f.update(t); f.draw(); });
            t++;
            requestAnimationFrame(loop);
        })();
    } catch(e) {}
}

/* ─── NAV ─── */
function initNav() {
    const nav = document.getElementById('nav');
    const toggle = document.getElementById('nav-toggle');
    const drawer = document.getElementById('nav-drawer');
    const backdrop = document.getElementById('nav-backdrop');
    const scroll = document.getElementById('hero-scroll');
    const links = document.querySelectorAll('.nav-link');
    if (!nav || !toggle || !drawer) return;

    const open = () => {
        toggle.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        drawer.classList.add('open');
        backdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
    };
    const close = () => {
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
        document.body.style.overflow = '';
    };

    toggle.addEventListener('click', e => { e.stopPropagation(); drawer.classList.contains('open') ? close() : open(); });
    backdrop.addEventListener('click', close);
    links.forEach(l => l.addEventListener('click', close));
    document.querySelector('.nav-cta')?.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        nav.classList.toggle('scrolled', y > 60);
        scroll?.classList.toggle('hide', y > 150);
        let cur = '';
        document.querySelectorAll('section[id]').forEach(s => { if (y >= s.offsetTop - 220) cur = s.id; });
        links.forEach(l => l.classList.toggle('active', l.dataset.section === cur));
    }, { passive: true });
}

/* ─── HERO ─── */
function initHero() {
    /* hero elements revealed by showHeroElements() after preloader */
}

/* ─── SMOOTH SCROLL ─── */
function initSmoothScroll() {
    const nav = document.getElementById('nav');
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const target = document.querySelector(a.getAttribute('href'));
            if (!target) return;
            e.preventDefault();
            window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - (nav?.offsetHeight || 54), behavior: 'smooth' });
        });
    });
}

/* ─── PARALLAX ─── */
function initParallax() {
    if (isMobile()) return;
    const img = document.getElementById('hero-img');
    if (!img) return;
    window.addEventListener('scroll', () => { img.style.transform = `translateY(${window.scrollY * .28}px)`; }, { passive: true });
}

/* ─── REVEAL ─── */
function initReveal() {
    try {
        const obs = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (!e.isIntersecting) return;
                const el = e.target;
                const d = parseFloat(el.dataset.delay || 0) * 1000;
                setTimeout(() => el.classList.add('revealed'), d);
                obs.unobserve(el);
            });
        }, { threshold: .06, rootMargin: '0px 0px -30px 0px' });
        document.querySelectorAll('.rv, .rv-l, .rv-r').forEach(el => obs.observe(el));
    } catch(e) {
        document.querySelectorAll('.rv, .rv-l, .rv-r').forEach(el => el.classList.add('revealed'));
    }
}

/* ─── COUNTERS ─── */
function initCounters() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { animateNum(e.target); obs.unobserve(e.target); } });
    }, { threshold: .5 });
    document.querySelectorAll('.st-num[data-target], .stat-num[data-target]').forEach(el => obs.observe(el));
}
function animateNum(el) {
    const target = parseInt(el.dataset.target, 10);
    const steps = 50;
    let i = 0;
    const t = setInterval(() => {
        i++;
        el.textContent = Math.floor((1 - Math.pow(1 - i / steps, 3)) * target).toLocaleString();
        if (i >= steps) { el.textContent = target.toLocaleString(); clearInterval(t); }
    }, 1800 / steps);
}

/* ─── ABOUT PATCH (rev sound) ─── */
function initAboutPatch() {
    const patch = document.getElementById('patch-logo');
    const hint = document.getElementById('rev-hint');
    if (!patch) return;
    patch.addEventListener('click', () => {
        try { playRev(getAudio()); hint?.classList.add('revving'); setTimeout(() => hint?.classList.remove('revving'), 3000); }
        catch(e) {}
    });
}

function playRev(ctx) {
    const now = ctx.currentTime, dur = 3.2;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(.5, now + .1);
    master.gain.setValueAtTime(.5, now + 1.5);
    master.gain.exponentialRampToValueAtTime(.001, now + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.8;
    lp.frequency.setValueAtTime(260, now); lp.frequency.linearRampToValueAtTime(850, now + .9); lp.frequency.exponentialRampToValueAtTime(240, now + 2.6);
    lp.connect(master);
    const ws = ctx.createWaveShaper(); const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i * 2) / 512 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
    ws.curve = curve; ws.connect(lp);
    const osc = ctx.createOscillator(); const og = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(11, now); osc.frequency.exponentialRampToValueAtTime(48, now + .8); osc.frequency.exponentialRampToValueAtTime(14, now + 2.4);
    og.gain.value = .7; osc.connect(og); og.connect(ws); osc.start(now); osc.stop(now + dur + .1);
    const sub = ctx.createOscillator(); const sg = ctx.createGain();
    sub.type = 'sine'; sub.frequency.setValueAtTime(11, now); sub.frequency.exponentialRampToValueAtTime(48, now + .8); sub.frequency.exponentialRampToValueAtTime(14, now + 2.4);
    sg.gain.setValueAtTime(.55, now); sg.gain.exponentialRampToValueAtTime(.001, now + dur);
    sub.connect(sg); sg.connect(master); sub.start(now); sub.stop(now + dur + .1);
}

/* ─── SPEC TAGS ROW (mobile only) ─── */
function buildSpecTagsRow() {
    /* Spec tags are now absolute on all screen sizes — no DOM manipulation needed */
}

/* ─── GALLERY ─── */
async function initGallery() {
    const track = document.getElementById('gal-track');
    if (!track) return;

    /* skeletons */
    track.innerHTML = '';
    for (let i = 0; i < 8; i++) {
        const sk = document.createElement('div');
        sk.className = 'gal-skel';
        sk.style.cssText = `width:${200 + (i % 3) * 80}px;height:100%;flex-shrink:0`;
        track.appendChild(sk);
    }

    let images = null;
    try {
        const r = await fetch(CONFIG.GALLERY_URL);
        const j = await r.json();
        if (Array.isArray(j) && j.length) images = j;
    } catch(e) {}

    if (!images) {
        try {
            const r = await fetch(CONFIG.CORS + encodeURIComponent(CONFIG.GALLERY_URL));
            const j = await r.json();
            if (Array.isArray(j) && j.length) images = j;
        } catch(e) {}
    }

    if (!images) images = FALLBACK_GALLERY;
    buildGallery(images);
}

const GAL_WIDTHS = [300, 220, 260, 190, 320, 240, 280, 210, 340, 230];
function buildGallery(images) {
    const outer = document.getElementById('gal-outer');
    const track = document.getElementById('gal-track');
    if (!track) return;

    const doubled = [...images, ...images];
    galHalf = images.reduce((s, _, i) => s + GAL_WIDTHS[i % GAL_WIDTHS.length] + 5, 0) + 5;
    galX = 0;

    track.innerHTML = doubled.map((img, idx) => {
        const w = GAL_WIDTHS[idx % images.length];
        return `<div class="gal-card" style="width:${w}px"><img src="${img.url}" alt="RWB Memory" loading="eager" onerror="this.parentElement.style.opacity='.1'"></div>`;
    }).join('');

    track.querySelectorAll('.gal-card').forEach(card => {
        card.addEventListener('click', () => {
            if (Math.abs(galDrag) > 5) return;
            const src = card.querySelector('img')?.src;
            if (!src) return;
            const lb = document.getElementById('lightbox');
            const img = document.getElementById('lb-img');
            if (lb && img) { img.src = src; lb.classList.add('open'); document.body.style.overflow = 'hidden'; }
        });
    });

    initGalleryDrag(outer);
    runGallery();
}

function initGalleryDrag(el) {
    if (!el) return;
    let sx = 0, dragging = false, delta = 0;
    const start = x => { sx = x; dragging = true; delta = 0; el.classList.add('dragging'); };
    const move = x => { if (!dragging) return; const dx = sx - x; delta += Math.abs(dx); galX = Math.max(0, galX + dx * .8); sx = x; galDrag = delta; };
    const end = () => { dragging = false; el.classList.remove('dragging'); setTimeout(() => { galDrag = 0; }, 150); };
    el.addEventListener('mousedown', e => { start(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (dragging) move(e.clientX); });
    window.addEventListener('mouseup', end);
    el.addEventListener('touchstart', e => { start(e.touches[0].clientX); }, { passive: true });
    el.addEventListener('touchmove', e => { if (dragging) move(e.touches[0].clientX); }, { passive: true });
    el.addEventListener('touchend', end);
}

function runGallery() {
    if (galRAF) cancelAnimationFrame(galRAF);
    (function loop() {
        galX += .9;
        if (galHalf > 0 && galX >= galHalf) galX -= galHalf;
        const track = document.getElementById('gal-track');
        if (track) track.style.transform = `translateX(-${galX}px)`;
        galRAF = requestAnimationFrame(loop);
    })();
}

/* ─── EVENTS ─── */
function initEvents() {
    const load = url => fetch(url).then(r => { if (!r.ok) throw new Error(); return r.text(); });
    load(CONFIG.EVENTS_SHEET_URL)
        .then(renderEvents)
        .catch(() => load(CONFIG.CORS + encodeURIComponent(CONFIG.EVENTS_SHEET_URL))
            .then(renderEvents)
            .catch(() => {
                const el = document.getElementById('ev-list');
                if (el) el.innerHTML = '<p class="ev-loading">Check back soon for events!</p>';
            })
        );
}

function toLocalDate(str) {
    if (!str) return null;
    const p = str.split('-');
    if (p.length !== 3) return null;
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d) ? null : d;
}
function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

function parseCSV(csv) {
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = splitRow(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
        const vals = splitRow(line); const row = {};
        headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
        return row;
    }).filter(r => r.title);
}
function splitRow(row) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '"') { if (q && row[i+1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === ',' && !q) { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur); return out;
}

function renderEvents(csv) {
    const rows = parseCSV(csv);
    const list = document.getElementById('ev-list');
    if (!list || !rows.length) return;
    const now = today();

    list.innerHTML = rows.map((row, i) => {
        const evDate = row['eventdate'] || row['event_date'] || row['date'] || '';
        const endDate = row['enddate'] || row['end_date'] || '';
        const month = (row['month'] || '').toUpperCase();
        const day = row['day'] || '';
        const endDay = row['endday'] || row['end_day'] || '';
        const title = row['title'] || ''; if (!title) return '';
        const time = row['time'] || '', loc = row['location'] || '';
        const desc = row['description'] || row['desc'] || '';
        const tag = row['tag'] || '';
        const total = parseInt(row['totalslots'] || row['total_slots'] || '0', 10);
        const filled = parseInt(row['filledslots'] || row['filled_slots'] || '0', 10);

        const dateHTML = (endDay && endDay !== day)
            ? `<div class="ev-day-range"><span class="ev-d">${day}</span><span class="ev-arr">↓</span><span class="ev-d2">${endDay}</span></div>`
            : `<span class="ev-day">${day}</span>`;

        const d0 = toLocalDate(evDate);
        const d1 = toLocalDate(endDate) || d0;
        let cls = '';
        if (d0) { if (d1 && d1 < now) cls = 'ev-past'; else if (d0 > now) cls = ''; else cls = 'ev-live'; }

        return `<article class="ev-card ${cls} rv" data-delay="${i * .06}" data-date="${evDate}" data-total="${total}" data-filled="${filled}">
            <div class="ev-date"><span class="ev-month">${month}</span>${dateHTML}</div>
            <div class="ev-info">
                <h3 class="ev-title">${title}</h3>
                <p class="ev-meta">🕔 ${time}&nbsp;·&nbsp;${loc}</p>
                <p class="ev-desc">${desc}</p>
                <div class="ev-slot-area"></div>
            </div>
            <div class="ev-tag">${tag}</div>
        </article>`;
    }).join('');

    list.querySelectorAll('.ev-card').forEach(card => processCard(card));

    /* tabs */
    document.querySelectorAll('.ev-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.ev-tab[data-f="upcoming"]')?.classList.add('active');
    applyFilter('upcoming');

    document.querySelectorAll('.ev-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.ev-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            applyFilter(tab.dataset.f);
        });
    });

    initReveal();
}

function applyFilter(f) {
    const cards = [...document.querySelectorAll('.ev-card')];
    cards.forEach(c => {
        const past = c.classList.contains('ev-past');
        const live = c.classList.contains('ev-live');
        let show = true;
        if (f === 'upcoming') show = !past && !live;
        else if (f === 'live') show = live;
        else if (f === 'past') show = past;
        c.style.display = show ? '' : 'none';
    });
    const visible = cards.filter(c => c.style.display !== 'none');
    if (!visible.length && f === 'upcoming') {
        cards.forEach(c => c.style.display = '');
        document.querySelectorAll('.ev-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.ev-tab[data-f="all"]')?.classList.add('active');
    }
}

function processCard(card) {
    const total = parseInt(card.dataset.total, 10);
    const filled = parseInt(card.dataset.filled, 10);
    const area = card.querySelector('.ev-slot-area');
    if (!area || !total) return;
    const pct = Math.min(filled / total, 1);
    const cls = pct >= 1 ? 'red' : pct >= .6 ? 'yellow' : 'green';
    const lbl = pct >= 1 ? 'Slots Full' : pct >= .6 ? 'Filling Fast' : 'Available';
    area.innerHTML = `<div class="ev-slots"><div class="ev-slot-bar-wrap"><div class="ev-slot-lbl">${filled} / ${total} Slots</div><div class="ev-slot-bar"><div class="ev-slot-fill ${cls}" style="width:0" data-pct="${Math.round(pct*100)}"></div></div></div><div class="ev-status"><span class="ev-dot ${cls}"></span><span>${lbl}</span></div></div>`;
    setTimeout(() => { const f = area.querySelector('.ev-slot-fill'); if (f) f.style.width = f.dataset.pct + '%'; }, 500);
    if (pct < 1) {
        const b = document.createElement('div');
        b.className = 'ev-banner';
        const t = '◆ Want to join? Contact RWB for more details! &nbsp;&nbsp;';
        b.innerHTML = `<div class="ev-banner-track">${t.repeat(6)}</div>`;
        card.appendChild(b);
    }
}

/* ─── WARRIORS ─── */
function initWarriors() {
    document.querySelectorAll('.war-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.war-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const f = tab.dataset.f;
            warList = f === 'all' ? [...WARRIORS] : WARRIORS.filter(w => w.role === f);
            renderWarriors();
        });
    });
    const CW = 292;
    document.getElementById('war-prev')?.addEventListener('click', () => {
        document.getElementById('war-outer')?.scrollBy({ left: -CW, behavior: 'smooth' });
    });
    document.getElementById('war-next')?.addEventListener('click', () => {
        document.getElementById('war-outer')?.scrollBy({ left: CW, behavior: 'smooth' });
    });
    renderWarriors();
}

function renderWarriors() {
    const track = document.getElementById('war-track');
    if (!track) return;
    track.innerHTML = warList.map(w => {
        const initials = w.name.split(' ').map(n => n[0]).join('').slice(0, 2);
        return `<div class="war-card" data-role="${w.role}">
            <div class="wcard-photo">
                <img src="${w.photo}" alt="${w.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="wcard-placeholder" style="display:none"><span class="wcard-initials">${initials}</span></div>
                <div class="wcard-overlay"></div>
                <div class="wcard-ribbon ${w.role}">${w.label}</div>
            </div>
            <div class="wcard-body">
                <div class="wcard-name">${w.name}</div>
                ${w.nick ? `<span class="wcard-nick">"${w.nick}"</span>` : ''}
                <div class="wcard-role">${w.label}</div>
                <div class="wcard-bike">${w.bike}</div>
                <div class="wcard-div"></div>
                <div class="wcard-desc">${w.desc}</div>
            </div>
        </div>`;
    }).join('');

    track.querySelectorAll('.war-card').forEach(c => {
        c.addEventListener('click', () => c.classList.toggle('color-on'));
    });

    buildDots();
    detectCenter();
    initWarDrag();
}

function buildDots() {
    const dots = document.getElementById('war-dots');
    if (!dots) return;
    dots.innerHTML = Array.from({ length: warList.length }, (_, i) =>
        `<div class="war-dot${i === 0 ? ' active' : ''}" data-i="${i}"></div>`
    ).join('');
    const CW = 292;
    dots.querySelectorAll('.war-dot').forEach(d => {
        d.addEventListener('click', () => {
            document.getElementById('war-outer')?.scrollTo({ left: +d.dataset.i * CW, behavior: 'smooth' });
        });
    });
}

function detectCenter() {
    const outer = document.getElementById('war-outer');
    if (!outer) return;
    const upd = () => {
        const mid = outer.getBoundingClientRect().left + outer.offsetWidth / 2;
        let best = null, bestD = Infinity;
        outer.querySelectorAll('.war-card').forEach(c => {
            const r = c.getBoundingClientRect();
            const d = Math.abs(r.left + r.width / 2 - mid);
            if (d < bestD) { bestD = d; best = c; }
        });
        outer.querySelectorAll('.war-card').forEach(c => c.classList.remove('center'));
        if (best) best.classList.add('center');
        const cards = [...outer.querySelectorAll('.war-card')];
        const idx = best ? cards.indexOf(best) % warList.length : 0;
        document.querySelectorAll('.war-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    };
    outer.addEventListener('scroll', upd, { passive: true });
    setTimeout(upd, 100);
}

function initWarDrag() {
    const outer = document.getElementById('war-outer');
    if (!outer) return;
    let sx = 0, ss = 0, drag = false;
    outer.addEventListener('mousedown', e => { sx = e.clientX; ss = outer.scrollLeft; drag = true; outer.classList.add('dragging'); e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (drag) outer.scrollLeft = ss - (e.clientX - sx); });
    window.addEventListener('mouseup', () => { drag = false; outer.classList.remove('dragging'); });
}

/* ─── FORM ─── */
function initForm() {
    const form = document.getElementById('join-form');
    if (!form) return;
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('form-submit');
        const txt = document.getElementById('submit-text');
        const arr = document.getElementById('submit-arrow');
        btn.disabled = true; txt.textContent = 'Sending…'; arr.textContent = '⏳';

        const follows = [...form.querySelectorAll('input[name="follows"]:checked')].map(cb => cb.value).join(', ') || 'None selected';
        const data = {
            name: form.querySelector('#f-name')?.value || '',
            email: form.querySelector('#f-email')?.value || '',
            phone: form.querySelector('#f-phone')?.value || '',
            alt_phone: form.querySelector('#f-alt')?.value || '',
            dob: form.querySelector('#f-dob')?.value || '',
            blood_group: form.querySelector('#f-blood')?.value || '',
            vrn: form.querySelector('#f-vrn')?.value || '',
            emergency_contact: form.querySelector('#f-emergency')?.value || '',
            bike: form.querySelector('#f-bike')?.value || '',
            riding_experience: form.querySelector('#f-exp')?.value || '',
            current_locality: form.querySelector('#f-loc')?.value || '',
            permanent_locality: form.querySelector('#f-perm')?.value || '',
            sticker_received: form.querySelector('#f-sticker-got')?.value || '',
            sticker_on_bike: form.querySelector('#f-sticker-on')?.value || '',
            follows,
            message: form.querySelector('#f-msg')?.value || ''
        };

        const status = document.getElementById('form-status');
        try {
            await fetch(CONFIG.FORM_SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            btn.disabled = false; txt.textContent = '✓ Application Sent!'; arr.textContent = '';
            btn.style.cssText = 'background:#22c55e;border-color:#22c55e;color:#000';
            if (status) { status.textContent = "✓ Received! We'll reach out on WhatsApp within 48 hours. Ride Safe. ◆"; status.className = 'form-status ok'; status.style.display = 'block'; }
            form.reset();
            setTimeout(() => { txt.textContent = 'Send My Application'; arr.textContent = '→'; btn.style.cssText = ''; if (status) status.style.display = 'none'; }, 7000);
        } catch(err) {
            btn.disabled = false; txt.textContent = 'Error — Try Again'; arr.textContent = '→';
            if (status) { status.textContent = '✗ Something went wrong. Please try again.'; status.className = 'form-status err'; status.style.display = 'block'; }
            setTimeout(() => { txt.textContent = 'Send My Application'; if (status) status.style.display = 'none'; }, 4000);
        }
    });
}

/* ─── LIGHTBOX ─── */
function initLightbox() {
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    const close = () => { lb.classList.remove('open'); document.body.style.overflow = ''; };
    document.getElementById('lb-bg')?.addEventListener('click', close);
    document.getElementById('lb-close')?.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && lb.classList.contains('open')) close(); });
}
