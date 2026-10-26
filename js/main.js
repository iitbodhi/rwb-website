/* RWB — main.js (home page only) */

/* Left/right arrows on carousels (swipe works natively on touch) */
$$('.rail').forEach(rail => {
    const track = rail.querySelector('.track');
    rail.querySelector('.prev').onclick = () => track.scrollBy({ left: -track.clientWidth * .8, behavior: 'smooth' });
    rail.querySelector('.next').onclick = () => track.scrollBy({ left: track.clientWidth * .8, behavior: 'smooth' });
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

/* Warriors: the card in the centre of the screen turns to colour */
const warTrack = $('#warriors-track');
function markCenter() {
    const box = warTrack.getBoundingClientRect(), mid = box.left + box.width / 2;
    let best = null, bestDist = Infinity;
    warTrack.querySelectorAll('.w-card').forEach(c => {
        const r = c.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bestDist) { bestDist = d; best = c; }
        c.classList.remove('in-center');
    });
    best?.classList.add('in-center');
}
let centerRaf = 0;
warTrack.addEventListener('scroll', () => { cancelAnimationFrame(centerRaf); centerRaf = requestAnimationFrame(markCenter); }, { passive: true });
window.addEventListener('resize', markCenter);
function renderWarriors(filter = 'all') {
    const list = filter === 'all' ? WARRIORS : WARRIORS.filter(w => w.role === filter);
    warTrack.innerHTML = list.map(w => `
        <button class="w-card" data-name="${esc(w.name)}">
            <img src="${w.photo}" alt="" loading="lazy">
            <span><b>${esc(w.name)}</b><small>${w.nickname ? `“${esc(w.nickname)}” · ` : ''}${esc(w.roleLabel)}</small></span>
        </button>`).join('');
    warTrack.scrollLeft = 0;
    requestAnimationFrame(markCenter);
}
warTrack.addEventListener('click', e => {
    const w = WARRIORS.find(x => x.name === e.target.closest('.w-card')?.dataset.name); if (!w) return;
    openDialog(`<img src="${w.photo}" alt="${esc(w.name)}"><div>
        <h3>${esc(w.name)}</h3><span class="role">${w.nickname ? `“${esc(w.nickname)}” · ` : ''}${esc(w.roleLabel)}</span>
        <p class="bike">${esc(w.bike)}</p><p>${esc(w.desc)}</p></div>`, 'profile');
});
tabs('#warrior-tabs', renderWarriors);
renderWarriors();

/* Gallery: auto-scrolling loop. Pauses on touch, hover, while a photo is open, and off-screen. */
const galTrack = $('#gallery-track');
const gal = { acc: 0, period: 0, count: 0, pausedUntil: 0, wasPaused: false, open: false, visible: true, hover: false };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const galPause = (ms = 2500) => { gal.pausedUntil = performance.now() + ms; };
['touchstart', 'touchend', 'mousedown', 'mouseup', 'wheel', 'keydown'].forEach(ev => galTrack.addEventListener(ev, () => galPause(), { passive: true }));
if (matchMedia('(hover:hover)').matches) {
    galTrack.addEventListener('mouseenter', () => gal.hover = true);
    galTrack.addEventListener('mouseleave', () => gal.hover = false);
}
new IntersectionObserver(e => gal.visible = e[0].isIntersecting).observe(galTrack);
dialog.addEventListener('close', () => gal.open = false);
function galMeasure() {
    if (gal.count && galTrack.children[gal.count]) gal.period = galTrack.children[gal.count].offsetLeft - galTrack.children[0].offsetLeft;
}
window.addEventListener('resize', galMeasure);
let galLast = 0;
const GAL_SPEED = 120;   /* pixels per second: raise this number to go faster */
(function galLoop(now = performance.now()) {
    const dt = Math.min(now - galLast, 64) / 1000; galLast = now;
    const paused = gal.open || gal.hover || !gal.visible || !gal.period || reduceMotion || performance.now() < gal.pausedUntil;
    if (paused) gal.wasPaused = true;
    else {
        if (gal.wasPaused) { gal.acc = galTrack.scrollLeft; gal.wasPaused = false; }
        gal.acc += GAL_SPEED * dt;
        while (gal.acc >= gal.period) gal.acc -= gal.period;
        galTrack.scrollLeft = gal.acc;
    }
    requestAnimationFrame(galLoop);
})();

async function loadGallery() {
    try {
        const imgs = await (await fetch(CONFIG.GALLERY_SCRIPT_URL)).json();
        if (!imgs.length) throw 0;
        const reps = Math.max(2, Math.ceil(1800 / (imgs.length * 316)));   /* copies so the loop never runs dry */
        let html = '';
        for (let r = 0; r < reps; r++) imgs.forEach((im, i) => {
            html += `<button class="g-item" data-i="${i}" ${r ? 'aria-hidden="true" tabindex="-1"' : `aria-label="Open photo ${i + 1}"`}><img src="${esc(im.url)}" alt="${r ? '' : esc(im.label || 'RWB ride photo')}" loading="lazy" decoding="async"></button>`;
        });
        galTrack.innerHTML = html;
        gal.count = imgs.length; galMeasure();
        galTrack.onclick = e => {
            const b = e.target.closest('.g-item'); if (!b) return;
            gal.open = true;
            openDialog(`<img src="${esc(imgs[b.dataset.i].url)}" alt="">`, 'lb');
        };
    } catch { galTrack.innerHTML = '<p class="muted">Photos will be here soon.</p>'; }
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
    const label = p >= 1 ? 'Seats full' : p >= .6 ? 'Filling fast' : 'Seats available';
    return `<div class="slots ${cls}"><span><b>${Math.max(total - filled, 0)}</b> of ${total} seats left</span><em>${label}</em><div class="slots-bar"><i style="width:${Math.round(p * 100)}%"></i></div></div>`;
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
function renderEvents(rows) {
    const events = rows.filter(r => r.title).map(r => ({ ...r, state: eventState(r) }));
    const list = $('#events-list');
    const draw = f => {
        const shown = events.filter(e => f === 'all' || e.state === f);
        list.innerHTML = shown.length ? shown.map(r => `<article class="ev ${r.state}" data-i="${events.indexOf(r)}">
                <div class="ev-head">${evCal(r)}<div class="ev-main">${evEyebrow(r) ? `<p class="ev-eyebrow">${evEyebrow(r)}</p>` : ''}<h3>${esc(r.title)}</h3>${evFacts(r)}</div></div>
                ${r.description ? `<div class="ev-desc">${evText(r.description)}</div><button class="ev-more" hidden>Read more</button>` : ''}
                ${r.state === 'past' ? '' : `<div class="ev-foot">${slotsHTML(r)}${evActions(r)}</div>`}</article>`).join('')
            : '<p class="muted">Nothing here yet. Check back soon.</p>';
        list.scrollLeft = 0;
        list.querySelectorAll('.ev-desc').forEach(d => { if (d.scrollHeight > d.clientHeight + 4) d.nextElementSibling.hidden = false; });
    };
    list.onclick = e => {
        const b = e.target.closest('.ev-more'); if (!b) return;
        const r = events[b.closest('.ev').dataset.i];
        openDialog(`<div class="ev-head">${evCal(r)}<div class="ev-main">${evEyebrow(r) ? `<p class="ev-eyebrow">${evEyebrow(r)}</p>` : ''}<h3>${esc(r.title)}</h3>${evFacts(r)}</div></div>
            <div class="ev-desc full">${evText(r.description)}</div>${r.state === 'past' ? '' : `<div class="ev-foot">${slotsHTML(r)}${evActions(r)}</div>`}`, 'ev-dialog');
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
        return { id: e.id, title: e.title, description: e.description || '', location: e.location || '', tag: e.tag || '',
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

/* Marketplace (rows come from a Google Sheet)
   Columns: name | description | price | image | category | status   (status "sold" greys out the button) */
function renderMarket(csvText) {
    const track = $('#market-track'), rows = parseCSV(csvText).filter(r => r.name);
    if (!rows.length) { track.innerHTML = '<p class="muted">New products are on the way. Check back soon.</p>'; return; }
    track.innerHTML = rows.map(r => {
        const sold = /sold/i.test(r.status || ''), price = rupees(r.price);
        const img = r.image ? `<img src="${esc(driveImg(r.image))}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">`
                            : `<img class="ph" src="assets/logo.png" alt="">`;
        return `<article class="prod"><div class="prod-img">${img}${r.category ? `<em>${esc(r.category)}</em>` : ''}</div>
            <div class="prod-body"><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p>
            ${price ? `<div class="price">${esc(price)}</div>` : ''}
            <a class="btn ${sold ? 'off' : ''}" href="${CONFIG.INSTAGRAM_DM_URL}" target="_blank" rel="noopener">${sold ? 'Sold out' : 'Contact to order'}</a></div></article>`;
    }).join('');
}
if (CONFIG.MARKET_SHEET_URL) fetchCSV(CONFIG.MARKET_SHEET_URL).then(renderMarket)
    .catch(() => { $('#market-track').innerHTML = '<p class="muted">Products will be listed here soon.</p>'; });
else $('#market-track').innerHTML = '<p class="muted">New products are on the way. Check back soon.</p>';

/* "Download Now" for the RWB App:
   Android -> downloads the .apk (or installs the web app if no .apk is published yet)
   iPhone  -> shows the 3-tap "Add to Home Screen" steps (Apple doesn't allow app files outside the App Store) */
(function appDownload() {
    const btn = document.getElementById('app-download'); if (!btn) return;
    const ua = navigator.userAgent, android = /android/i.test(ua), ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 'ontouchend' in document);
    const note = document.getElementById('app-download-note');
    if (android && CONFIG.APK_URL) {
        btn.href = CONFIG.APK_URL; btn.setAttribute('download', 'RWB-App.apk');
        note.hidden = false;
        note.textContent = 'After it downloads, open the file and tap Install. If Android asks, allow installs from your browser.';
    } else if (android) {
        btn.href = 'app/#install';
    } else if (ios) {
        btn.addEventListener('click', e => {
            e.preventDefault();
            openDialog(`<div class="ios-steps"><h3>Install on iPhone</h3>
                <ol><li>Tap <b>Open the app</b> below (in <b>Safari</b>).</li><li>Tap the <b>Share</b> button <span aria-hidden="true">⬆︎</span> at the bottom.</li>
                <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
                <p class="muted">The RWB icon appears on your home screen. Open it from there and sign in with Google.</p>
                <a class="btn" href="app/">Open the app</a></div>`);
        });
    }
})();
