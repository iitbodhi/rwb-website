/* ================================================================
   RWB v6.3 — script.js
   ✅ Gallery Apps Script bug fixed (removed invalid .setHeaders())
   ✅ Events: correct sheet URL (direct CSV export)
   ✅ Music: looping toggle button in nav
   ✅ Hint texts removed
   ================================================================ */
const CONFIG = {
    /* Direct CSV export — no "Publish to Web" step needed */
    EVENTS_SHEET_URL: 'https://docs.google.com/spreadsheets/d/13qt3ZmYHX1EILkQzqo9TzLWKfKmuAd_QwYzStDTLEzU/export?format=csv&gid=0',
    FORM_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxkvBKEBHTLN-Q1QZvLB0o9qiRfuDmcSfUMT0Cay7D-na2ekwTWD-uuCDDswwI-UfFugw/exec',
    GALLERY_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzrswFdnP-IjFNdXedZDnc9aqg63sOqoLaVCkPC6p2sOzBzKNrjg0ryiYVphZgFlt29YA/exec',
    CORS_PROXY: 'https://api.allorigins.win/raw?url='
};

const WARRIORS = [
    { name: 'Sayantan Sarkar', nickname: 'Boss', role: 'admin', roleLabel: 'Founder & Admin', bike: 'TVS Ronin 225 (Orange) — Kurama  ·  TVS Ronin 225 (Black) — Shado', photo: 'boss.png', desc: 'In the courtroom, he commands with the precision of law. On the open road, he commands with the authority of a man who built something from nothing. Sayantan didn\'t just found RWB — he breathed life into it. The Boss rides first. Always.' },
    { name: 'Arnab Das', nickname: 'Boro Admin', role: 'admin', roleLabel: 'Co-Founder & Admin', bike: 'TVS Ronin 225 (Galactic Grey) — TD', photo: 'arnab.png', desc: 'Some men speak volumes. Arnab lets the tarmac do the talking. While others plan the ride, he\'s already at the next checkpoint. The quiet co-architect of RWB — his actions have always been louder than any engine note.' },
    { name: 'Kaustabh Bhattacharjee', nickname: 'Pookie', role: 'admin', roleLabel: 'Admin', bike: 'TVS Ronin 225', photo: 'pookie.png', desc: 'One lakh kilometres and still counting. If roads had a memory, they\'d remember Pookie\'s wheels before anything else. The Pookie of RWB is many things — but "stationary" has never been one of them.' },
    { name: 'Debapam Pal', nickname: 'Momo', role: 'admin', roleLabel: 'Admin', bike: 'TVS Ronin 225 (Blue)', photo: 'momo.png', desc: 'He debugs systems by day and destroys the pace chart by weekend. That warm, momomolicious smile is the last thing the group sees before he opens the throttle and vanishes into the horizon. The IT giant with a pure rider\'s soul.' },
    { name: 'Bodhisatwa Mallick', nickname: 'Dancer Bodhi', role: 'admin', roleLabel: 'Admin', bike: 'TVS Ronin 225 (Magma Red) — Sula', photo: 'bodhi.png', desc: 'Compact in frame, limitless on the road. Bodhi carries a special hatred for public buses and a special love for the open lane. Whether it\'s the dance floor or the highway — his moves are always the ones everyone watches.' },
    { name: 'Rohan Ghosh', nickname: 'Pinky', role: 'coadmin', roleLabel: 'Co-admin', bike: 'Bajaj Dominar 250 (Green) — Domi', photo: 'pinky.png', desc: 'Every convoy needs its anchor. Pinky rides sweep — last in the line, first to notice if someone\'s missing. Born with marshal instincts and a protector\'s heart, Rohan ensures no Ronin Warrior ever gets left behind.' },
    { name: 'Soumya JS', nickname: 'CC', role: 'coadmin', roleLabel: 'Co-admin', bike: 'TVS Ronin 225 — 2024 Special Edition (Nimbus Grey)', photo: 'soumya.png', desc: 'Middle-aged, slightly receding hairline, gloriously unrepentant. He draws the route maps with the obsession of a cartographer and loses them with the grace of a philosopher. For Soumya, the journey was never about the destination.' },
    { name: 'Arpan Paik', nickname: 'Radio', role: 'coadmin', roleLabel: 'Co-admin', bike: 'RE Himalayan 411 (Mirage Silver)', photo: 'arpan.png', desc: 'Where others see asphalt, Radio sees a frequency. Tuned permanently to the channel between throttle and horizon, Arpan runs on adrenaline, breathes adventure, and transmits energy to everyone who rides beside him.' },
    { name: 'Ranit Pal Chowdhury', nickname: 'BBC', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Lightning Black) — Kuro', photo: 'ranit.png', desc: 'Negotiations are his profession, but the open road is his real boardroom. Fuelled by caffeine and armed with a camera eye, Ranit documents RWB\'s soul one frame at a time. Firmly, fiercely, unapologetically anti-squid.' },
    { name: 'Sreejon', nickname: 'Kochi', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Blue) — Pegasus', photo: 'sreejon.png', desc: 'The calmest presence in any pack. Kochi doesn\'t rush, doesn\'t rattle — he flows. Whether it\'s a 6 AM dawn patrol or a 400 km grind, he glides through it all with butter-smooth ease that makes everyone around him breathe easier.' },
    { name: 'Subhankar Biswas', nickname: 'Labubu', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Lightning Black)', photo: 'labubu.png', desc: 'Every mile he\'s ridden has been a chapter earned, not given. From wide-eyed newcomer to road-tested warrior — Labubu\'s transformation is what RWB is built for. He doesn\'t chase roads. He earns them, one rise and fall at a time.' },
    { name: 'Arindam Biswas', nickname: 'Bucky', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Galactic Grey) — Jarvis', photo: 'bucky.png', desc: 'He balances ledgers by week and horizons by weekend. Bucky\'s best financial decision was never on a spreadsheet — it was Jarvis, the open road, and the choice to ride further than reason ever suggested.' },
    { name: 'Moinak', nickname: 'Sek-C', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'Apache RTR 200 4V (Red Black)', photo: 'moinak.png', desc: 'Code compiles by day. Freedom compiles by night. Moinak lives in that precise commit between the daily push and the open road — where IT gives way to throttle, and deadlines give way to the horizon.' },
    { name: 'Kaustav Sanyal', nickname: 'Offroader', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Orange) — Ronin-X', photo: 'roninx.png', desc: 'Tarmac is a starting point, not a destination. Ronin-X takes his machine where maps run out and signal dies — through mud, ridgeline, and raw terrain. For Kaustav, the real road has always been the one nobody paved.' },
    { name: 'Sourav Santara', nickname: 'KK', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Galactic Grey)', photo: 'sourav.png', desc: 'An amateur in title only — behind the bars, KK rides with the hunger of someone discovering the road for the very first time, every time. A certified mountain addict whose Ronin already knows the hill roads better than the GPS does.' }
];

const DEFAULT_GALLERY = [
    { url: 'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-side-view-3.png?isig=0&q=80', label: 'The Warrior', wide: true },
    { url: 'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-front-three-quarter.png?isig=0&q=80', label: 'Front Quarter' },
    { url: 'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-rear-view.png?isig=0&q=80', label: 'Rear View' },
    { url: 'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-front-view.png?isig=0&q=80', label: 'Face of a Warrior', wide: true },
    { url: 'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-side-view-2.png?isig=0&q=80', label: 'Charcoal Ember' },
    { url: 'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-left-side-view.png?isig=0&q=80', label: 'Left Profile' }
];

const isMobile = () => window.innerWidth <= 980;

/* Audio */
let _audioCtx = null, _audioUnlocked = false, _launchMusicPlayed = false;
function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

/* Gallery belt state */
let galScrollX = 0, galHalfWidth = 0, galPaused = false, galRAF = null;
let _galDragDelta = 0;

/* ════ INIT ════ */
document.addEventListener('DOMContentLoaded', () => {
    buildGrain();
    initThemeToggle();
    initPreloader();
    initNav();
    initSmoothScroll();
    initParallax();
    initReveal();
    initCounters();
    initMagnetic();
    initWarriors();
    loadGalleryFromDrive();
    loadEventsFromSheet();
    initFormLogic();
    initAboutLogoRev();
    initBadgeMusic();
    initLightbox();
});

/* 1. GRAIN */
function buildGrain() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'), img = ctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const el = document.getElementById('grain');
    if (el) { el.style.backgroundImage = `url(${c.toDataURL()})`; el.style.backgroundSize = '256px'; }
}

/* 2. THEME */
function initThemeToggle() {
    const btn = document.getElementById('theme-toggle'), html = document.documentElement;
    html.setAttribute('data-theme', localStorage.getItem('rwb-theme') || 'dark');
    btn?.addEventListener('click', () => {
        const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('rwb-theme', next);

        const logo = document.querySelector('.badge-logo-img');
        if (logo) {
            logo.src = next === 'light' ? 'logo-white.png' : 'logo.png';
        }
    });
}

/* 5. PRELOADER — max 1.2s */
function initPreloader() {
    const hide = () => { document.getElementById('preloader')?.classList.add('gone'); document.body.classList.remove('loading'); triggerHeroReveal(); };
    const timer = setTimeout(hide, 1200);
    window.addEventListener('load', () => { clearTimeout(timer); setTimeout(hide, 150); });
}
function triggerHeroReveal() {
    document.querySelectorAll('.hero .hero-reveal').forEach(el => {
        setTimeout(() => el.classList.add('visible'), parseInt(el.dataset.delay, 10) || 0);
    });
}

/* 6. NAV */
function initNav() {
    const nav = document.getElementById('nav'),
          toggle = document.getElementById('nav-toggle'),
          right = document.getElementById('nav-right'),
          backdrop = document.getElementById('nav-backdrop'),
          scrl = document.getElementById('hero-scroll'),
          links = document.querySelectorAll('.nav-link');

    const closeMenu = () => {
        toggle.classList.remove('open');
        right.classList.remove('open');
        if (backdrop) backdrop.classList.remove('active');
        document.body.style.overflow = '';
    };
    const openMenu = () => {
        toggle.classList.add('open');
        right.classList.add('open');
        if (backdrop) backdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        nav.classList.toggle('solid', y > 50);
        scrl?.classList.toggle('hide', y > 130);
        let cur = '';
        document.querySelectorAll('section[id]').forEach(s => { if (y >= s.offsetTop - 200) cur = s.id; });
        links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + cur));
    }, { passive: true });

    toggle?.addEventListener('click', e => {
        e.stopPropagation();
        right.classList.contains('open') ? closeMenu() : openMenu();
    });

    if (backdrop) backdrop.addEventListener('click', closeMenu);

    document.addEventListener('click', e => {
        if (!right.classList.contains('open')) return;
        if (!right.contains(e.target) && !toggle.contains(e.target)) closeMenu();
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

    links.forEach(l => l.addEventListener('click', closeMenu));
    document.querySelector('.nav-cta')?.addEventListener('click', closeMenu);
}

/* 7. SMOOTH SCROLL */
function initSmoothScroll() {
    const nav = document.getElementById('nav');
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const t = document.querySelector(a.getAttribute('href'));
            if (!t) return; e.preventDefault();
            window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - nav.offsetHeight, behavior: 'smooth' });
        });
    });
}

/* 8. PARALLAX (desktop only) */
function initParallax() {
    if (isMobile()) return;
    const img = document.getElementById('hero-img');
    window.addEventListener('scroll', () => { if (img) img.style.transform = `translateY(${window.scrollY * 0.32}px) scale(1.08)`; }, { passive: true });
}

/* 9. REVEAL */
function initReveal() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            const el = e.target, d = parseFloat(el.dataset.delay || 0) * 1000;
            setTimeout(() => el.classList.add('revealed'), d);
            obs.unobserve(el);
        });
    }, { threshold: .08, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.reveal-up:not(.hero *), .reveal-left, .reveal-right').forEach(el => obs.observe(el));
}

/* 10. COUNTERS */
function initCounters() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { animateCount(e.target); obs.unobserve(e.target); } });
    }, { threshold: .5 });
    document.querySelectorAll('.stat-num[data-target], .st-num[data-target]').forEach(el => obs.observe(el));
}
function animateCount(el) {
    const target = parseInt(el.dataset.target, 10), steps = 55; let count = 0;
    const t = setInterval(() => {
        count++; el.textContent = Math.floor((1 - Math.pow(1 - count / steps, 3)) * target).toLocaleString();
        if (count >= steps) { el.textContent = target.toLocaleString(); clearInterval(t); }
    }, 1800 / steps);
}

/* 11. MAGNETIC (desktop only) */
function initMagnetic() {
    if (isMobile()) return;
    document.querySelectorAll('.magnetic').forEach(el => {
        el.addEventListener('mousemove', e => { const r = el.getBoundingClientRect(); const cx = e.clientX - r.left - r.width / 2; const cy = e.clientY - r.top - r.height / 2; el.style.transform = `translate(${cx * .18}px,${cy * .18}px)`; });
        el.addEventListener('mouseleave', () => { el.style.transform = ''; el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)'; setTimeout(() => el.style.transition = '', 600); });
        el.addEventListener('mouseenter', () => { el.style.transition = 'transform .1s ease'; });
    });
}

/* ================================================================
   12. WARRIORS — Manual drag + CSS scroll-snap + center highlight
   ================================================================ */
let warCurrentList = [...WARRIORS];

function initWarriors() {
    document.querySelectorAll('.wtab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.wtab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const f = tab.dataset.filter;
            warCurrentList = f === 'all' ? [...WARRIORS] : WARRIORS.filter(w => w.role === f);
            renderWarriorCards(warCurrentList);
        });
    });

    /* Arrow buttons: scroll by one card width */
    const CARD_W = 292 + 20; /* card + margin */
    document.getElementById('war-prev')?.addEventListener('click', () => {
        const outer = document.getElementById('warriors-track-outer');
        if (outer) outer.scrollBy({ left: -CARD_W, behavior: 'smooth' });
    });
    document.getElementById('war-next')?.addEventListener('click', () => {
        const outer = document.getElementById('warriors-track-outer');
        if (outer) outer.scrollBy({ left: CARD_W, behavior: 'smooth' });
    });

    renderWarriorCards(warCurrentList);
}

function renderWarriorCards(list) {
    const track = document.getElementById('warriors-track'); if (!track) return;
    track.innerHTML = list.map(w => {
        const init = w.name.split(' ').map(n => n[0]).join('').slice(0, 2);
        return `<div class="warrior-card" data-role="${w.role}">
            <div class="wcard-photo">
                <img src="${w.photo}" alt="${w.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="wcard-placeholder" style="display:none"><span class="wcard-initials">${init}</span></div>
                <div class="wcard-overlay"></div>
                <div class="wcard-role-ribbon ${w.role}">${w.roleLabel}</div>
            </div>
            <div class="wcard-info">
                <div class="wcard-name">${w.name}</div>
                ${w.nickname ? `<span class="wcard-nickname">"${w.nickname}"</span>` : ''}
                <div class="wcard-title">${w.roleLabel}</div>
                <div class="wcard-bike">${w.bike}</div>
                <div class="wcard-divider"></div>
                <div class="wcard-desc">${w.desc}</div>
            </div>
        </div>`;
    }).join('');

    /* Click to toggle permanent color */
    track.querySelectorAll('.warrior-card').forEach(c => {
        c.addEventListener('click', () => {
            const wasOn = c.classList.contains('color-on');
            /* Toggle — but don't toggle if center card already forces color */
            c.classList.toggle('color-on', !wasOn);
        });
    });

    buildWarDots(list.length);
    initWarriorCenterDetect();
    initWarriorDrag();
}

function buildWarDots(total) {
    const dots = document.getElementById('war-dots'); if (!dots) return;
    dots.innerHTML = Array.from({ length: total }, (_, i) => `<div class="war-dot" data-i="${i}"></div>`).join('');
    dots.querySelector('.war-dot')?.classList.add('active');
    const CARD_W = 292 + 20;
    dots.querySelectorAll('.war-dot').forEach(d => {
        d.addEventListener('click', () => {
            const outer = document.getElementById('warriors-track-outer');
            if (outer) outer.scrollTo({ left: parseInt(d.dataset.i) * CARD_W, behavior: 'smooth' });
        });
    });
}

/* CENTER CARD DETECTION — highlight card whose center is closest to track center */
function initWarriorCenterDetect() {
    const outer = document.getElementById('warriors-track-outer'); if (!outer) return;
    const update = () => {
        const outerRect = outer.getBoundingClientRect();
        const outerCenter = outerRect.left + outerRect.width / 2;
        let closest = null, minDist = Infinity;
        outer.querySelectorAll('.warrior-card').forEach(card => {
            const r = card.getBoundingClientRect();
            const cardCenter = r.left + r.width / 2;
            const dist = Math.abs(cardCenter - outerCenter);
            if (dist < minDist) { minDist = dist; closest = card; }
        });
        outer.querySelectorAll('.warrior-card').forEach(c => c.classList.remove('in-center'));
        if (closest) closest.classList.add('in-center');

        /* Update dots */
        const cards = [...outer.querySelectorAll('.warrior-card')];
        const idx = closest ? cards.indexOf(closest) : 0;
        const listLen = warCurrentList.length;
        const dotIdx = idx % listLen;
        document.querySelectorAll('.war-dot').forEach((d, i) => d.classList.toggle('active', i === dotIdx));
    };
    outer.addEventListener('scroll', update, { passive: true });
    /* Also update on window scroll/resize */
    window.addEventListener('scroll', update, { passive: true });
    /* Initial update after render */
    setTimeout(update, 100);
}

/* DRAG support for warriors */
function initWarriorDrag() {
    const outer = document.getElementById('warriors-track-outer'); if (!outer) return;
    let startX = 0, startScroll = 0, dragging = false;
    const start = (x) => { startX = x; startScroll = outer.scrollLeft; dragging = true; outer.classList.add('dragging'); };
    const move = (x) => { if (!dragging) return; outer.scrollLeft = startScroll - (x - startX); };
    const end = () => { dragging = false; outer.classList.remove('dragging'); };
    outer.addEventListener('mousedown', e => { start(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (dragging) move(e.clientX); });
    window.addEventListener('mouseup', end);
    /* Touch: handled natively by browser scroll */
}

/* ================================================================
   13. GALLERY — Collage belt: variable card widths
   Tries Drive script → CORS proxy → default
   ================================================================ */
async function loadGalleryFromDrive() {
    const track = document.getElementById('gal-belt-track');
    if (!track) return;

    // Skeleton loading
    track.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton-box';
        track.appendChild(sk);
    }

    try {
        const res = await fetch(CONFIG.GALLERY_SCRIPT_URL);
        const images = await res.json();

        // Preload first 5 images
        images.slice(0, 5).forEach(img => {
            const preload = new Image();
            preload.src = img.url;
        });

        setTimeout(() => {
            track.innerHTML = '';
            buildGalleryBelt(images);
        }, 400);

    } catch (e) {
        console.error("Gallery failed", e);
    }
}

/* ── Collage widths pattern ── */
const COLLAGE_PATTERN = [360, 240, 280, 200, 340, 260, 300, 220, 380, 240];
function getCardWidth(idx) { return COLLAGE_PATTERN[idx % COLLAGE_PATTERN.length]; }

function buildGalleryBelt(images) {
    const wrap = document.getElementById('gal-belt-wrap');
    const outer = document.getElementById('gal-belt-outer');
    const track = document.getElementById('gal-belt-track');
    if (!track) return;

    /* Duplicate for seamless loop */
    const doubled = [...images, ...images];
    galHalfWidth = images.reduce((sum, _, i) => sum + getCardWidth(i) + 6, 0) + 6;

    track.innerHTML = doubled.map((img, idx) => {
        const w = getCardWidth(idx % images.length);
        return `<div class="gal-card" style="width:${w}px">
            <img src="${img.url}" alt="${img.label || 'RWB Memory'}" loading="eager"
                 onerror="this.parentElement.style.opacity='.15'">
        </div>`;
    }).join('');

    /* No paused overlay — just tap to open lightbox directly */

    /* Lightbox on tap/click */
    track.querySelectorAll('.gal-card').forEach(card => {
        card.addEventListener('click', () => {
            if (Math.abs(_galDragDelta) > 5) return;
            const src = card.querySelector('img')?.src;
            if (!src || src.includes('undefined')) return;
            const lb = document.getElementById('lightbox'); const img = document.getElementById('lb-img');
            if (!lb || !img) return;
            img.src = src; img.alt = 'RWB Memory'; lb.classList.add('open'); document.body.style.overflow = 'hidden';
        });
    });

    /* Drag/touch */
    initGalleryDrag(outer);

    startGalleryScroll();
}

function initGalleryDrag(el) {
    if (!el) return;
    let startX = 0, dragging = false, dragDelta = 0;
    const start = (x) => { startX = x; dragging = true; dragDelta = 0; el.classList.add('dragging'); };
    const move = (x) => {
        if (!dragging) return;
        const dx = startX - x; dragDelta += Math.abs(dx);
        galScrollX = Math.max(0, galScrollX + dx * .8);
        startX = x; _galDragDelta = dragDelta;
    };
    const end = () => { dragging = false; el.classList.remove('dragging'); setTimeout(() => { _galDragDelta = 0; }, 120); };
    el.addEventListener('mousedown', e => { start(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (dragging) move(e.clientX); });
    window.addEventListener('mouseup', end);
    el.addEventListener('touchstart', e => { start(e.touches[0].clientX); }, { passive: true });
    el.addEventListener('touchmove', e => { if (dragging) move(e.touches[0].clientX); }, { passive: true });
    el.addEventListener('touchend', end);
}

function startGalleryScroll() {
    if (galRAF) cancelAnimationFrame(galRAF);
    (function scroll() {
        if (!galPaused) {
            galScrollX += 1.4; /* faster — was 0.55 */
            if (galHalfWidth > 0 && galScrollX >= galHalfWidth) galScrollX -= galHalfWidth;
            const track = document.getElementById('gal-belt-track');
            if (track) track.style.transform = `translateX(-${galScrollX}px)`;
        }
        galRAF = requestAnimationFrame(scroll);
    })();
}

/* ================================================================
   14. EVENTS — IST local date + date range display
   Sheet columns: EventDate | Month | Day | EndDay(optional) | Title | Time | Location | Description | Tag | TotalSlots | FilledSlots
   Day can be "11" or "11-17" — displayed as-is
   EndDay: optional end date for multi-day events (e.g. "17")
   ================================================================ */
function loadEventsFromSheet() {
    if (!CONFIG.EVENTS_SHEET_URL) return;
    const load = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(); return r.text(); });
    load(CONFIG.EVENTS_SHEET_URL)
        .then(csv => parseAndRenderEvents(csv))
        .catch(() => load(CONFIG.CORS_PROXY + encodeURIComponent(CONFIG.EVENTS_SHEET_URL))
            .then(csv => parseAndRenderEvents(csv))
            .catch(() => {
                const el = document.getElementById('events-list');
                if (el) el.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-family:\'Cormorant Garamond\',serif;padding:2rem;font-style:italic;">Check back soon for events!</p>';
            })
        );
}

function parseLocalDate(str) {
    if (!str) return null;
    /* Handle "2025-04-12" → local midnight */
    const p = str.split('-');
    if (p.length !== 3) return null;
    const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    return isNaN(d) ? null : d;
}
function getLocalToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

function parseCSV(csv) {
    const lines = csv.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return [];
    const headers = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
        const vals = splitCSVRow(line); const row = {};
        headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); }); return row;
    }).filter(r => r.title);
}
function splitCSVRow(row) {
    const result = []; let cur = '', inQ = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') { if (inQ && row[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
        else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
        else cur += ch;
    }
    result.push(cur); return result;
}

function parseAndRenderEvents(csv) {
    const rows = parseCSV(csv); if (!rows.length) return;
    const container = document.getElementById('events-list'); if (!container) return;
    const today = getLocalToday();

    container.innerHTML = rows.map((row, idx) => {
        const evDate = row['eventdate'] || row['event_date'] || row['date'] || '';
        const endDate = row['enddate'] || row['end_date'] || ''; /* optional end date */
        const month = (row['month'] || '').toUpperCase();
        /* Day can be "11" or "11-17" from sheet */
        const day = row['day'] || '';
        const endDay = row['endday'] || row['end_day'] || '';
        /* Build display day: if endDay exists and different, show "11-17" */
        const displayDay = endDay && endDay !== day ? `${day}-${endDay}` : day;

        const title = row['title'] || ''; if (!title) return '';
        const time = row['time'] || ''; const loc = row['location'] || '';
        const desc = row['description'] || row['desc'] || ''; const tag = row['tag'] || '';
        const total = row['totalslots'] || row['total_slots'] || row['total'] || '0';
        const filled = row['filledslots'] || row['filled_slots'] || row['filled'] || '0';

        /* Classify using local date */
        let evClass = '';
        const evDateObj = parseLocalDate(evDate);
        /* For multi-day: use end date for expiry if available */
        const endDateObj = endDate ? parseLocalDate(endDate) : evDateObj;
        if (evDateObj) {
            if (endDateObj && endDateObj < today) evClass = 'ev-past';
            else if (evDateObj > today) evClass = '';
            else evClass = 'ev-live'; /* starts today */
        }

        return `<article class="event-card ${evClass} reveal-up" data-delay="${idx * .1}"
            data-event-date="${evDate}" data-total="${total}" data-filled="${filled}">
            <div class="event-date">
                <span class="ev-month">${month}</span>
                ${displayDay.includes('-') ? `
                    <div class="date-block">
                     <span class="start">${displayDay.split('-')[0]}</span>
                     <span class="arrow">↓</span>
                     <span class="end">${displayDay.split('-')[1]}</span>
                    </div>
                ` : `<span class="ev-day">${displayDay}</span>`}
            </div>
            <div class="event-info">
                <h3 class="ev-title">${title}</h3>
                <p class="ev-meta">🕔 ${time}&nbsp;·&nbsp;${loc}</p>
                <p class="ev-desc">${desc}</p>
                <div class="ev-slot-wrap"></div>
            </div>
            <div class="ev-tag">${tag}</div>
        </article>`;
    }).join('');

    processEventCards(container.querySelectorAll('.event-card'));

    /* Default: upcoming */
    document.querySelectorAll('.etab').forEach(t => t.classList.remove('active'));
    const upTab = document.querySelector('.etab[data-filter="upcoming"]');
    if (upTab) upTab.classList.add('active');
    applyEventFilter('upcoming');

    initEventsTabs();
    initReveal();
    initEventsTilt();
}

function applyEventFilter(f) {
    document.querySelectorAll('.event-card').forEach(card => {
        const past = card.classList.contains('ev-past');
        const live = card.classList.contains('ev-live');
        let show = true;
        if (f === 'upcoming') show = !past && !live;
        else if (f === 'live') show = live;
        else if (f === 'past') show = past;
        card.style.display = show ? '' : 'none';
    });
    /* If no upcoming events, show all to avoid blank screen */
    const visible = [...document.querySelectorAll('.event-card')].filter(c => c.style.display !== 'none');
    if (visible.length === 0 && f === 'upcoming') {
        document.querySelectorAll('.event-card').forEach(c => c.style.display = '');
        const allTab = document.querySelector('.etab[data-filter="all"]');
        if (allTab) { document.querySelectorAll('.etab').forEach(t => t.classList.remove('active')); allTab.classList.add('active'); }
    }
}

function processEventCards(cards) {
    cards.forEach(card => {
        const total = parseInt(card.dataset.total || '0', 10);
        const filled = parseInt(card.dataset.filled || '0', 10);
        const sw = card.querySelector('.ev-slot-wrap'); if (!sw || total === 0) return;
        const pct = Math.min(filled / total, 1);
        const cls = pct >= 1 ? 'red' : pct >= .6 ? 'yellow' : 'green';
        const lbl = pct >= 1 ? 'Slots Full' : pct >= .6 ? 'Filling Fast' : 'Available';
        sw.innerHTML = `<div class="ev-slot-bar-wrap"><div class="ev-slot-label">${filled} / ${total} Slots</div><div class="ev-slot-bar"><div class="ev-slot-fill ${cls}" style="width:0%" data-pct="${Math.round(pct * 100)}"></div></div></div><div class="ev-status"><span class="status-dot ${cls}"></span><span>${lbl}</span></div>`;
        setTimeout(() => { const f = sw.querySelector('.ev-slot-fill'); if (f) f.style.width = f.dataset.pct + '%'; }, 500);
        if (pct < 1) {
            const igUrl = 'https://www.instagram.com/ronin_warriors_bengal';
            sw.style.cursor = 'pointer';
            sw.addEventListener('click', () => window.open(igUrl, '_blank'));
            const b = document.createElement('div'); b.className = 'ev-join-banner';
            const t = '◆ Want to join? Contact RWB for more details! &nbsp;&nbsp;';
            b.innerHTML = `<div class="ev-join-track">${t.repeat(6)}</div>`;
            b.addEventListener('click', () => window.open(igUrl, '_blank'));
            card.appendChild(b);
        }
    });
}
function initEventsTabs() {
    document.querySelectorAll('.etab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.etab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active'); applyEventFilter(tab.dataset.filter);
        });
    });
}
function initEventsTilt() {
    if (isMobile()) return;
    document.querySelectorAll('.event-card').forEach(card => {
        card.addEventListener('mousemove', e => {
            if (card.classList.contains('ev-past')) return;
            const r = card.getBoundingClientRect();
            card.style.transform = `translateX(6px) perspective(700px) rotateX(${-((e.clientY - r.top) / r.height - .5) * 2.5}deg) rotateY(${((e.clientX - r.left) / r.width - .5) * 2.5}deg)`;
        });
        card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
}

/* 15. ABOUT LOGO REV */
function initAboutLogoRev() {
    const logo = document.getElementById('about-logo-rev');
    const hint = document.getElementById('logo-rev-hint');
    if (!logo) return;
    logo.addEventListener('click', () => {
        try {
            _audioUnlocked = true;
            if (_bgMusicPlaying && _bgAudio) {
                const preVol = _bgAudio.volume;
                _fadeVolume(_bgAudio, preVol, preVol * 0.22, 300);
                setTimeout(() => { if (_bgMusicPlaying && _bgAudio) _fadeVolume(_bgAudio, _bgAudio.volume, preVol, 1500); }, 3600);
            }
            playRoninRev(getAudioCtx());
            hint?.classList.add('revving');
            setTimeout(() => hint?.classList.remove('revving'), 3000);
        } catch (e) { console.warn('Audio:', e); }
    });
}


/* ══ BACKGROUND MUSIC PLAYER ══ */
let _bgAudio = null;
let _bgMusicPlaying = false;
let _bgFadeTimer = null;

function initBadgeMusic() {
    document.querySelectorAll('.hero-badge').forEach(badge => {
        badge.style.cursor = 'pointer';
        badge.title = 'Click to play / stop music';
        badge.addEventListener('click', toggleBgMusic);
    });
}

function toggleBgMusic() {
    if (!_bgAudio) {
        _bgAudio = new Audio('music.mp3');
        _bgAudio.loop = true;
        _bgAudio.volume = 0;
    }
    if (_bgMusicPlaying) {
        _fadeVolume(_bgAudio, _bgAudio.volume, 0, 1200, () => {
            _bgAudio.pause();
            _bgMusicPlaying = false;
            document.querySelectorAll('.hero-badge .badge-ring').forEach(r => r.classList.remove('music-on'));
        });
    } else {
        _bgAudio.volume = 0;
        _bgAudio.play()
            .then(() => {
                _bgMusicPlaying = true;
                document.querySelectorAll('.hero-badge .badge-ring').forEach(r => r.classList.add('music-on'));
                _fadeVolume(_bgAudio, 0, 0.65, 1500, null);
            })
            .catch(e => console.warn('Music play blocked:', e));
    }
}

function _fadeVolume(audio, from, to, ms, cb) {
    clearInterval(_bgFadeTimer);
    const steps = 40;
    const diff = (to - from) / steps;
    let i = 0;
    audio.volume = Math.max(0, Math.min(1, from));
    _bgFadeTimer = setInterval(() => {
        i++;
        audio.volume = Math.max(0, Math.min(1, from + diff * i));
        if (i >= steps) {
            clearInterval(_bgFadeTimer);
            audio.volume = Math.max(0, Math.min(1, to));
            if (cb) cb();
        }
    }, ms / steps);
}

function playRoninRev(ctx) {
    const now = ctx.currentTime; const dur = 3.2;
    const master = ctx.createGain(); master.connect(ctx.destination);
    master.gain.setValueAtTime(0, now); master.gain.linearRampToValueAtTime(.52, now + .1);
    master.gain.setValueAtTime(.52, now + 1.5); master.gain.exponentialRampToValueAtTime(.001, now + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.8;
    lp.frequency.setValueAtTime(260, now); lp.frequency.linearRampToValueAtTime(850, now + .9); lp.frequency.exponentialRampToValueAtTime(240, now + 2.6);
    lp.connect(master);
    const ws = ctx.createWaveShaper(); const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i * 2) / 512 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
    ws.curve = curve; ws.connect(lp);
    const osc = ctx.createOscillator(); const og = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(11, now); osc.frequency.exponentialRampToValueAtTime(48, now + .8); osc.frequency.exponentialRampToValueAtTime(14, now + 2.4);
    og.gain.value = .72; osc.connect(og); og.connect(ws); osc.start(now); osc.stop(now + dur + .1);
    const sub = ctx.createOscillator(); const sg = ctx.createGain();
    sub.type = 'sine'; sub.frequency.setValueAtTime(11, now); sub.frequency.exponentialRampToValueAtTime(48, now + .8); sub.frequency.exponentialRampToValueAtTime(14, now + 2.4);
    sg.gain.setValueAtTime(.58, now); sg.gain.exponentialRampToValueAtTime(.001, now + dur);
    sub.connect(sg); sg.connect(master); sub.start(now); sub.stop(now + dur + .1);
    const lfo = ctx.createOscillator(); const lfog = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.setValueAtTime(11, now); lfo.frequency.exponentialRampToValueAtTime(48, now + .8); lfo.frequency.exponentialRampToValueAtTime(14, now + 2.4);
    lfog.gain.value = .22; lfo.connect(lfog); lfog.connect(master.gain); lfo.start(now); lfo.stop(now + dur + .1);
    const mid = ctx.createOscillator(); const mg = ctx.createGain();
    mid.type = 'square'; mid.frequency.setValueAtTime(22, now); mid.frequency.exponentialRampToValueAtTime(96, now + .8); mid.frequency.exponentialRampToValueAtTime(28, now + 2.4);
    mg.gain.value = .17; mid.connect(mg); mg.connect(ws); mid.start(now); mid.stop(now + dur + .1);
}

/* ── MILES V2 ── */
function initMilesDownload() {
    var btn = document.getElementById('miles-download-btn');
    var msg = document.getElementById('miles-coming-soon');
    if (!btn || !msg) return;
    btn.addEventListener('click', function() {
        msg.classList.toggle('active');
        if (msg.classList.contains('active')) {
            msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}
