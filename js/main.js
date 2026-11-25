/* RWB — main.js (home page only) */

/* Left/right arrows on carousels (swipe works natively on touch) */
$$('.rail').forEach(rail => {
    const track = rail.querySelector('.track');
    rail.querySelector('.prev').onclick = () => track.scrollBy({ left: -track.clientWidth * .8, behavior: 'smooth' });
    rail.querySelector('.next').onclick = () => track.scrollBy({ left: track.clientWidth * .8, behavior: 'smooth' });
    const fit = () => rail.classList.toggle('fits', track.scrollWidth <= track.clientWidth + 2);
    new MutationObserver(fit).observe(track, { childList: true }); new ResizeObserver(fit).observe(track); fit();
});

/* Count-up stats */
const countObs = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    countObs.unobserve(e.target);
    const el = e.target, end = +el.dataset.count, t0 = performance.now();
    (function tick(t) {
        const p = Math.min((t - t0) / 1500, 1);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString('en-IN');
        if (p < 1) requestAnimationFrame(tick);
    })(t0);
}), { threshold: .6 });
$$('[data-count]').forEach(el => countObs.observe(el));

/* Members: the live count from the RWB App (rounded down to the nearest 10, e.g. 643 → 640+) */
fetch(CONFIG.APP_SUPABASE_URL + '/rest/v1/rpc/public_member_count', { method: 'POST', headers: { apikey: CONFIG.APP_SUPABASE_KEY, Authorization: 'Bearer ' + CONFIG.APP_SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(r => r.ok ? r.json() : Promise.reject()).then(n => {
        n = Math.floor(+n / 10) * 10; if (!(n > 0)) return;
        const el = $('#stat-members'); if (el) { if (el.dataset.count !== el.textContent.replace(/\D/g, '')) el.dataset.count = n; else el.textContent = n.toLocaleString('en-IN'); el.dataset.count = n; }
        $$('[data-members]').forEach(e => e.textContent = n.toLocaleString('en-IN'));
    }).catch(() => {});

/* ===== Marquee: a slow, endless strip. Moves with the GPU (transform), eases to a stop on hover,
   can be dragged or swiped (with a little momentum), and sleeps when it's off screen. ===== */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover:hover)').matches;
function marquee(view, { speed = 30, dir = -1, onFrame } = {}) {
    const strip = view.querySelector('.mq-strip');
    const m = { x: 0, cur: 0, v: 0, period: 0, items: [], hover: false, held: false, visible: false, hold: false, still: false, raf: 0, last: 0, dragged: false };
    const place = () => { strip.style.transform = `translate3d(${m.x.toFixed(2)}px,0,0)`; onFrame?.(m); };
    const wrapX = () => { if (m.period) { m.x %= m.period; if (m.x > 0) m.x -= m.period; } };
    function frame(now) {
        const dt = Math.min(now - m.last, 64) / 1000; m.last = now;
        const target = (m.hover || m.held || m.hold || reduceMotion) ? 0 : speed * dir;
        m.cur += (target - m.cur) * (1 - Math.exp(-dt * 2.6));          /* soft start and stop */
        if (!m.held) { m.x += (m.cur + m.v) * dt; m.v *= Math.exp(-dt * 3.2); if (Math.abs(m.v) < 2) m.v = 0; }
        wrapX(); place();
        const idle = !m.held && !m.v && Math.abs(m.cur) < .3 && target === 0;
        m.raf = (m.visible && !m.still && !idle) || m.held ? requestAnimationFrame(frame) : 0;
    }
    const wake = () => { if (!m.raf && m.visible && !m.still) { m.last = performance.now(); m.raf = requestAnimationFrame(frame); } };
    new IntersectionObserver(e => { m.visible = e[0].isIntersecting && !document.hidden; wake(); }, { rootMargin: '120px 0px' }).observe(view);
    document.addEventListener('visibilitychange', () => { m.visible = m.visible && !document.hidden; if (!document.hidden) { m.visible = true; wake(); } });
    if (canHover) { view.addEventListener('mouseenter', () => { m.hover = true; wake(); }); view.addEventListener('mouseleave', () => { m.hover = false; wake(); }); }
    /* drag / swipe (vertical page scroll still works on phones) */
    let sx = 0, sy = 0, lx = 0, lt = 0, vel = 0, id = null, decided = false;
    view.addEventListener('pointerdown', e => { if (m.still || e.button > 0) return; id = e.pointerId; sx = lx = e.clientX; sy = e.clientY; lt = performance.now(); vel = 0; decided = false; m.dragged = false; m.held = true; m.v = 0; wake(); });
    view.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        if (!decided) { const dx = Math.abs(e.clientX - sx), dy = Math.abs(e.clientY - sy); if (dx < 6 && dy < 6) return; decided = true;
            if (dy > dx) { id = null; m.held = false; return; } m.dragged = true; view.setPointerCapture(id); view.classList.add('dragging'); }
        const now = performance.now(), dx = e.clientX - lx; m.x += dx; wrapX(); place();
        vel = .8 * (dx / Math.max(now - lt, 1) * 1000) + .2 * vel; lx = e.clientX; lt = now;
    });
    const up = e => { if (e.pointerId !== id) return; id = null; m.held = false; view.classList.remove('dragging');
        if (m.dragged) { m.v = Math.max(-2600, Math.min(2600, vel)); m.cur = 0; } wake(); };
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
    view.addEventListener('click', e => { if (m.dragged) { e.preventDefault(); e.stopPropagation(); m.dragged = false; } }, true);
    view.addEventListener('dragstart', e => e.preventDefault());
    /* trackpad sideways swipes */
    view.addEventListener('wheel', e => { if (m.still || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); m.x -= e.deltaX; wrapX(); place(); m.cur = 0; wake(); }, { passive: false });
    function measure() {
        const n = m.n; if (!n) return;
        const kids = strip.children;
        m.period = kids[n] ? kids[n].offsetLeft - kids[0].offsetLeft : 0;
        m.items = [...kids].map(k => ({ el: k, c: k.offsetLeft + k.offsetWidth / 2 }));
        wrapX(); place();
    }
    /* fill the strip with enough copies of the set to loop without a gap; a short set just sits still, centred */
    function set(html) {
        strip.innerHTML = html; m.n = strip.children.length; m.x = 0; m.v = 0;
        const one = [...strip.children], setW = strip.scrollWidth;
        m.still = !m.n || setW <= view.clientWidth;
        view.classList.toggle('still', m.still);
        if (!m.still) {
            const copies = Math.ceil(view.clientWidth / setW) + 1;
            for (let c = 0; c < copies; c++) one.forEach(k => { const d = k.cloneNode(true); d.setAttribute('aria-hidden', 'true'); d.tabIndex = -1; strip.append(d); });
        }
        measure(); m.cur = reduceMotion ? 0 : speed * dir; wake();
    }
    let rT = 0, lastW = 0; new ResizeObserver(() => { if (view.clientWidth === lastW) return; const first = !lastW; lastW = view.clientWidth; if (first) return; clearTimeout(rT); rT = setTimeout(() => { if (strip.children.length && m.n) { const html = [...strip.children].slice(0, m.n).map(k => k.outerHTML).join(''); const keep = m.x; set(html); m.x = keep; wrapX(); place(); } }, 150); }).observe(view);
    return { set, m, nudge: steps => { if (m.still) return; m.v += steps * (m.items[1] ? m.items[1].c - m.items[0].c : 300) * 3.2; m.cur = 0; wake(); },
        pause: on => { m.hold = on; wake(); } };
}
/* pictures fade in once they have loaded */
document.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
const markLoaded = root => root.querySelectorAll('img').forEach(i => { if (i.complete && i.naturalWidth) i.classList.add('ok'); });

/* Warriors: a slow endless strip; the card passing the centre turns to colour */
const warView = $('#warriors-mq');
let warCenter = null;
const warMq = marquee(warView, { speed: 26, dir: -1, onFrame: m => {
    if (m.items.length) {
        const mid = -m.x + warView.clientWidth / 2;
        let best = null, bd = Infinity; for (const it of m.items) { const d = Math.abs(it.c - mid); if (d < bd) { bd = d; best = it.el; } }
        if (best !== warCenter || !warCenter?.isConnected) { warCenter?.classList.remove('in-center'); best?.classList.add('in-center'); warCenter = best; }
    }
} });
function renderWarriors(filter = 'all') {
    const list = filter === 'all' ? WARRIORS : WARRIORS.filter(w => w.role === filter);
    warCenter = null;
    warMq.set(list.map(w => `
        <button class="w-card" data-name="${esc(w.name)}">
            <img src="${w.photo}" alt="" loading="lazy" decoding="async" draggable="false">
            <span><b>${esc(w.name)}</b><small>${w.nickname ? `“${esc(w.nickname)}” · ` : ''}${esc(w.roleLabel)}</small></span>
        </button>`).join(''));
    markLoaded(warView);
    $('#warrior-arrows').hidden = warMq.m.still;
}
warView.addEventListener('click', e => {
    const w = WARRIORS.find(x => x.name === e.target.closest('.w-card')?.dataset.name); if (!w) return;
    warMq.pause(true);
    openDialog(`<img src="${w.photo}" alt="${esc(w.name)}"><div>
        <h3>${esc(w.name)}</h3><span class="role">${w.nickname ? `“${esc(w.nickname)}” · ` : ''}${esc(w.roleLabel)}</span>
        <p class="bike">${esc(w.bike)}</p><p>${esc(w.desc)}</p></div>`, 'profile');
});
$('#warrior-arrows').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) warMq.nudge(+b.dataset.step); });
tabs('#warrior-tabs', renderWarriors);
renderWarriors();

/* Gallery: two strips drifting in opposite directions. Tap a photo to open it; arrows/swipe inside the viewer. */
const galA = marquee($('#gallery-a'), { speed: 22, dir: -1 }), galB = marquee($('#gallery-b'), { speed: 22, dir: 1 });
dialog.addEventListener('close', () => { galA.pause(false); galB.pause(false); warMq.pause(false); });
/* Google Photos/Drive links (lh3.googleusercontent.com/d/ID) can be asked for a smaller WebP copy: about 5x lighter */
const gSized = (u, spec) => /^https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+$/.test(u) ? `${u}=${spec}` : u;
try { localStorage.removeItem('rwb-gal-v1'); } catch { /* ignore */ }   /* the old saved list had every photo */
const GAL_KEY = 'rwb-gal-v2';   /* the RWB Gallery script gives the website 30 photos a day (a new random pick daily); members see them all in the app */
/* sizes that match the screen: phones show ~150 px tall strips, so h400 (~45 KB) is sharp there; big screens keep h560.
   The viewer gets 1080 px wide on phones (~250 KB) and 1920 on computers. */
const DPW = innerWidth * (devicePixelRatio || 1), G_STRIP = innerWidth < 760 ? 'h400-rw' : 'h560-rw', G_BIG = DPW <= 1240 ? 'w1080-rw' : 'w1920-rw';
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function showGallery(imgs) {
    /* photos only roll: they don't open when tapped (the full gallery is in the RWB App, for members and RWB FAM) */
    const tile = (im, i, k) => `<span class="g-item g-still"><img src="${esc(gSized(im.url, G_STRIP))}" alt="RWB ride photo" ${k < 5 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" draggable="false"></span>`;
    const pick = shuffle(imgs.map((_, i) => i)).slice(0, 30), half = Math.ceil(pick.length / 2);
    const rowA = pick.length < 12 ? pick : pick.slice(0, half), rowB = pick.length < 12 ? [...pick].reverse() : pick.slice(half);
    galA.set(rowA.map((i, k) => tile(imgs[i], i, k)).join(''));
    galB.set(rowB.map((i, k) => tile(imgs[i], i, k)).join(''));
    $('#gallery-b').hidden = false;
    $$('.mq-gal').forEach(markLoaded);
    gal.list = imgs;
}
const gal = { list: [] };
const galBig = i => gSized(gal.list[i].url, G_BIG);
function galShow(i) {
    const imgs = gal.list; i = (i + imgs.length) % imgs.length;
    const body = $('#dialog-body');
    if (body.classList.contains('lb') && dialog.open) { const img = body.querySelector('img'); const u = galBig(i); if (img.getAttribute('src') !== u) { img.classList.remove('ok'); img.src = u; } body.dataset.i = i; body.querySelector('.lb-n').textContent = `${i + 1} / ${imgs.length}`; }
    else { openDialog(`<img src="${esc(galBig(i))}" alt="${esc(imgs[i].label || 'RWB ride photo')}" draggable="false">
        <button class="lb-nav prev" aria-label="Previous photo">‹</button><button class="lb-nav next" aria-label="Next photo">›</button><span class="lb-n">${i + 1} / ${imgs.length}</span>`, 'lb');
        $('#dialog-body').dataset.i = i; }
    [i + 1, i - 1].forEach(k => { const n = new Image(); n.decoding = 'async'; n.src = galBig((k + imgs.length) % imgs.length); });   /* the next and previous photos are ready before the swipe */
}

dialog.addEventListener('click', e => { const n = e.target.closest('.lb-nav'); if (n) { e.stopPropagation(); galShow(+$('#dialog-body').dataset.i + (n.classList.contains('next') ? 1 : -1)); } });
dialog.addEventListener('keydown', e => { if (!$('#dialog-body').classList.contains('lb')) return; if (e.key === 'ArrowRight') galShow(+$('#dialog-body').dataset.i + 1); if (e.key === 'ArrowLeft') galShow(+$('#dialog-body').dataset.i - 1); });
let galTx = null; dialog.addEventListener('touchstart', e => { galTx = e.touches[0].clientX; }, { passive: true });
dialog.addEventListener('touchend', e => { if (galTx === null || !$('#dialog-body').classList.contains('lb')) return; const dx = e.changedTouches[0].clientX - galTx; galTx = null; if (Math.abs(dx) > 50) galShow(+$('#dialog-body').dataset.i + (dx < 0 ? 1 : -1)); }, { passive: true });
/* the photo list is kept on the phone, so the gallery shows at once on the next visit; a fresh list is fetched in the background */
async function loadGallery() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(GAL_KEY)); } catch { /* ignore */ }
    if (saved?.length) showGallery(saved);
    try {
        const got = await (await fetch(CONFIG.GALLERY_SCRIPT_URL)).json(), imgs = (Array.isArray(got) ? got : []).filter(im => im?.url).slice(0, 30);
        if (!imgs.length) throw 0;
        try { localStorage.setItem(GAL_KEY, JSON.stringify(imgs.slice(0, 30).map(({ url }) => ({ url })))); } catch { /* full */ }
        if (!saved?.length || saved.map(x => x.url).join() !== imgs.map(x => x.url).join()) showGallery(imgs);   /* a new day's pick shows at once */
    } catch { if (!saved?.length) { $('#gallery-a .mq-strip').innerHTML = '<p class="muted mq-wait">Photos will be here soon.</p>'; $('#gallery-b').hidden = true; } }
}
loadGallery();

/* Events: from the RWB App (public details only); the old Google Sheet is the backup.
   Each row: title, description, location, tag, eventdate/enddate (YYYY-MM-DD), d1/d2 (day chips), when (time line), slots */
const todayYMD = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function eventState(row) {
    const today = todayYMD(), start = row.eventdate, end = row.enddate || start;
    if (!start) return 'upcoming';
    return end < today ? 'past' : start > today ? 'upcoming' : 'live';
}
const ICON = {
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
};
function slotsHTML(row) {
    const total = +(row.totalslots || 0), filled = +(row.filledslots || 0);
    if (!total) return '';
    const p = Math.min(filled / total, 1), cls = p >= 1 ? 'full' : p >= .6 ? 'mid' : '';
    const label = p >= 1 ? 'Slots full' : p >= .6 ? 'Filling fast' : 'Slots available';
    return `<div class="slots ${cls}"><span><b>${Math.max(total - filled, 0)}</b> of ${total} slots left</span><em>${label}</em><div class="slots-bar"><i style="width:${Math.round(p * 100)}%"></i></div></div>`;
}
const dayChip = d => `<span class="ev-day"><small>${esc(d.m)}</small><b>${esc(d.d)}</b><em>${esc(d.w)}</em></span>`;
function evCal(r) {
    return `<div class="ev-cal${r.d2 ? ' multi' : ''}">${dayChip(r.d1)}${r.d2 ? `<span class="ev-arrow" aria-label="to"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></span>${dayChip(r.d2)}` : ''}</div>`;
}
function evFacts(r) {
    return `<ul class="ev-facts">${r.when ? `<li>${ICON.clock}<span>${esc(r.when)}</span></li>` : ''}${r.location ? `<li>${ICON.pin}<span>${esc(r.location)}</span></li>` : ''}</ul>`;
}
const evEyebrow = r => [r.state === 'live' ? 'Happening now' : '', r.tag, r.days > 1 ? `${r.days} days` : ''].filter(Boolean).map(esc).join(' · ');
const evText = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
function evActions(r) {
    if (r.state === 'past') return '';
    const full = r.totalslots && +r.filledslots >= +r.totalslots;
    return `<div class="ev-cta">${r.id ? `<a class="btn btn-sm" href="app/#events/${r.id}">RSVP in the app</a>` : ''}${full ? '' : `<a class="${r.id ? 'ev-ask' : 'btn btn-sm'}" href="${CONFIG.INSTAGRAM_DM_URL}" target="_blank" rel="noopener">${r.id ? 'Not a member? Ask us' : 'Enquire now'}</a>`}</div>`;
}
/* the event's cover photo from the app (file 86), 16:9 like WhatsApp events; only a jsDelivr link is accepted */
const evCover = (r, big) => /^https:\/\/cdn\.jsdelivr\.net\//.test(r.cover || '') ? `<div class="ev-cover${big ? ' big' : ''}"><img src="${esc(r.cover)}" alt="" loading="lazy" draggable="false"></div>` : '';
function renderEvents(rows) {
    const events = rows.filter(r => r.title).map(r => ({ ...r, state: eventState(r) }));
    const list = $('#events-list');
    const draw = f => {
        const shown = events.filter(e => f === 'all' || e.state === f);
        list.innerHTML = shown.length ? shown.map(r => `<article class="ev ${r.state}${r.cover ? ' has-cover' : ''}" data-i="${events.indexOf(r)}">
                ${evCover(r)}<div class="ev-head">${evCal(r)}<div class="ev-main">${evEyebrow(r) ? `<p class="ev-eyebrow">${evEyebrow(r)}</p>` : ''}<h3>${esc(r.title)}</h3>${evFacts(r)}<button class="ev-more">See details ›</button></div></div>
                ${r.state === 'past' ? '' : `<div class="ev-foot">${slotsHTML(r)}${evActions(r)}</div>`}</article>`).join('')
            : '<p class="muted">Nothing here yet. Check back soon.</p>';
        list.scrollLeft = 0;
    };
    list.onclick = e => {
        const b = e.target.closest('.ev-more'); if (!b) return;
        const r = events[b.closest('.ev').dataset.i];
        openDialog(`${evCover(r, true)}<div class="ev-head">${evCal(r)}<div class="ev-main">${evEyebrow(r) ? `<p class="ev-eyebrow">${evEyebrow(r)}</p>` : ''}<h3>${esc(r.title)}</h3>${evFacts(r)}</div></div>
            ${r.description ? `<div class="ev-desc full">${evText(r.description)}</div>` : ''}${r.state === 'past' ? '' : `<div class="ev-foot">${slotsHTML(r)}${evActions(r)}</div>`}`, 'ev-dialog');
    };
    const first = events.some(e => e.state === 'upcoming') ? 'upcoming' : events.some(e => e.state === 'live') ? 'live' : 'all';
    $$('#event-tabs button').forEach(b => b.classList.toggle('active', b.dataset.filter === first));
    draw(first); tabs('#event-tabs', draw);
}
/* Events from the RWB App (times shown in India time) */
function appEventRows(list) {
    const ist = (d, o) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
    const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const hm = d => ist(d, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
    const chip = d => ({ m: ist(d, { month: 'short' }).toUpperCase(), d: ist(d, { day: 'numeric' }), w: ist(d, { weekday: 'short' }).toUpperCase() });
    const rows = list.map(e => {
        const s = new Date(e.starts_at), en = e.ends_at ? new Date(e.ends_at) : null, multi = !!en && ymd(en) !== ymd(s);
        const days = multi ? Math.round((new Date(ymd(en)) - new Date(ymd(s))) / 864e5) + 1 : 1;
        return { id: e.id, cover: e.cover_url || '', title: e.title, description: e.description || '', location: e.location || '', tag: e.tag || '',
            d1: chip(s), d2: multi ? chip(en) : null, days,
            when: multi ? `${ist(s, { weekday: 'short' })} ${hm(s)} → ${ist(en, { weekday: 'short' })} ${hm(en)}` : en ? `${hm(s)} – ${hm(en)}` : hm(s),
            eventdate: ymd(s), enddate: en ? ymd(en) : '', totalslots: e.capacity || '', filledslots: e.taken || 0 };
    });
    return sortEvents(rows);
}
/* upcoming first (soonest on top), then past (newest on top) */
function sortEvents(rows) {
    const today = todayYMD(), over = r => (r.enddate || r.eventdate || '') < today;
    return rows.sort((a, b) => over(a) - over(b) || (over(a) ? (b.eventdate || '').localeCompare(a.eventdate || '') : (a.eventdate || '').localeCompare(b.eventdate || '')));
}
/* backup: rows from the old events sheet (eventdate, enddate, time, title, location, description, tag, totalslots, filledslots) */
function sheetEventRows(csvText) {
    const ymd = v => { const m = String(v || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || String(v || '').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
        if (!m) return ''; const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; };
    const chip = v => { const d = new Date(v + 'T12:00:00'); return { m: d.toLocaleString('en-IN', { month: 'short' }).toUpperCase(), d: String(d.getDate()), w: d.toLocaleString('en-IN', { weekday: 'short' }).toUpperCase() }; };
    return sortEvents(parseCSV(csvText).filter(r => r.title).map(r => {
        const s = ymd(r.eventdate || r.event_date || r.date), en = ymd(r.enddate || r.end_date), multi = !!s && !!en && en > s;
        return { title: r.title, description: r.description || r.desc || '', location: r.location || '', tag: r.tag || '', when: r.time || '',
            d1: s ? chip(s) : { m: r.month || '', d: r.day || '', w: '' }, d2: multi ? chip(en) : null,
            days: multi ? Math.round((new Date(en) - new Date(s)) / 864e5) + 1 : 1,
            eventdate: s, enddate: multi ? en : '', totalslots: r.totalslots || r.total_slots || '', filledslots: r.filledslots || r.filled_slots || 0 };
    }));
}
const loadAppEvents = () => fetch(CONFIG.APP_SUPABASE_URL + '/rest/v1/rpc/public_events', { method: 'POST', headers: { apikey: CONFIG.APP_SUPABASE_KEY, Authorization: 'Bearer ' + CONFIG.APP_SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(r => { if (!r.ok) throw 0; return r.json(); }).then(appEventRows);
loadAppEvents()
    .catch(() => fetchCSV(CONFIG.EVENTS_SHEET_URL).then(sheetEventRows))   /* backup: the old sheet */
    .then(renderEvents)
    .catch(() => { $('#events-list').innerHTML = '<p class="muted">Events will be listed here soon.</p>'; });

/* RWB Merch: listed by admins and coordinators in the RWB App (MotoMart → RWB Merch).
   Rows: name | description | price | image | category | status   (status "sold" greys out the button) */
function renderMarket(rows) {
    const track = $('#market-track');
    rows = rows.filter(r => r.name);
    if (!rows.length) { track.innerHTML = '<p class="muted">New products are on the way. Check back soon.</p>'; return; }
    track.innerHTML = rows.map(r => {
        const sold = /sold/i.test(r.status || ''), price = r.soon ? 'Coming soon' : r.price === 0 ? 'Free' : typeof r.price === 'number' ? inr(r.price) : rupees(r.price);
        const img = r.image ? `<img src="${esc(driveImg(r.image))}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">`
                            : `<img class="ph" src="assets/logo-96.webp" alt="">`;
        return `<article class="prod${sold ? ' sold' : ''}"><div class="prod-img">${img}${r.category ? `<em>${esc(r.category)}</em>` : ''}</div>
            <div class="prod-body"><h3>${esc(r.name)}</h3><p>${esc(r.description || '')}</p>
            ${price ? `<div class="price">${esc(price)}</div>` : ''}
            ${r.soon && !sold ? '<span class="btn off soon">Coming Soon</span>' : `<a class="btn ${sold ? 'off' : ''}" href="${CONFIG.INSTAGRAM_DM_URL}" target="_blank" rel="noopener">${sold ? 'Sold out' : 'Get now'}</a>`}</div></article>`;
    }).join('');
}
loadMotomart().then(d => d.items.filter(i => i.kind === 'merch'))
    .then(renderMarket)
    .catch(() => { $('#market-track').innerHTML = '<p class="muted">Products will be listed here soon.</p>'; });

/* The RWB App section: the right buttons for this phone, and the promo video (plays muted when on screen; tap for sound) */
(function appSection() {
    const ua = navigator.userAgent, android = /android/i.test(ua), ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 'ontouchend' in document);
    const dl = document.getElementById('app-download'), io = document.getElementById('app-ios'), note = document.getElementById('app-download-note');
    if (dl && CONFIG.APK_URL) dl.href = CONFIG.APK_URL;
    if (android) { dl?.classList.add('ax-pri'); io?.remove(); if (note) note.textContent = 'Tap Download, open the file and tap Install (allow installs from your browser if Android asks). Then sign in with the Google account from your RWB join form.'; }
    else if (ios) { io?.classList.add('ax-pri'); dl?.remove();
        io?.addEventListener('click', e => { e.preventDefault();
            openDialog(`<div class="ios-steps"><h3>RWB App on iPhone</h3>
                <ol><li>Tap <b>Open the app</b> below (in <b>Safari</b>).</li><li>Tap the <b>Share</b> button <span aria-hidden="true">⬆︎</span> at the bottom.</li>
                <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
                <p class="muted">The RWB icon appears on your home screen. Open it from there and sign in with Google.</p>
                <a class="btn" href="app/">Open the app</a></div>`); }); }
    else dl?.classList.add('ax-pri');
    const v = document.getElementById('app-video'), snd = document.getElementById('app-sound'); if (!v) return;
    const play = () => v.play().catch(() => {});
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { if (!v.dataset.started) { v.dataset.started = 1; v.preload = 'auto'; } play(); } else v.pause(); }), { threshold: .35 }).observe(v);
    snd?.addEventListener('click', () => {
        if (v.muted) { v.muted = false; if (!snd.dataset.once) { snd.dataset.once = 1; v.currentTime = 0; } play(); snd.classList.add('on'); snd.setAttribute('aria-label', 'Mute'); }
        else { v.muted = true; snd.classList.remove('on'); snd.setAttribute('aria-label', 'Turn sound on'); }
    });
    v.addEventListener('click', () => snd?.click());
})();
