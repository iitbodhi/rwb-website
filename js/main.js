/* RWB — main.js */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Links */
$$('.join-link').forEach(a => a.href = CONFIG.JOIN_FORM_URL);
$$('.ig-link').forEach(a => a.href = CONFIG.INSTAGRAM_URL);

/* Tabs helper */
function tabs(sel, onChange) {
    $(sel).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        $$(sel + ' button').forEach(x => x.classList.toggle('active', x === b));
        onChange(b.dataset.filter);
    });
}

/* Mobile nav */
const navToggle = $('#nav-toggle'), navLinks = $('#nav-links');
const setNav = open => { navLinks.classList.toggle('open', open); navToggle.setAttribute('aria-expanded', open); };
navToggle.addEventListener('click', () => setNav(!navLinks.classList.contains('open')));
navLinks.addEventListener('click', e => { if (e.target.tagName === 'A') setNav(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setNav(false); });

/* Left/right arrow buttons on every carousel (swipe works natively on touch) */
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

/* Dialog (lightbox + warrior profile) */
const dialog = $('#dialog'), dialogBody = $('#dialog-body');
function openDialog(html, cls = '') { dialogBody.className = cls; dialogBody.innerHTML = html; dialog.showModal(); }
dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('.dialog-close')) dialog.close(); });

/* Warriors: card in the centre of the screen turns to colour */
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

/* Gallery (images come from the Google Drive Apps Script) */
async function loadGallery() {
    const track = $('#gallery-track');
    try {
        const imgs = await (await fetch(CONFIG.GALLERY_SCRIPT_URL)).json();
        if (!imgs.length) throw 0;
        track.innerHTML = imgs.map((im, i) =>
            `<button class="g-item" data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${esc(im.url)}" alt="${esc(im.label || 'RWB ride photo')}" loading="lazy" decoding="async"></button>`).join('');
        track.onclick = e => { const b = e.target.closest('.g-item'); if (b) openDialog(`<img src="${esc(imgs[b.dataset.i].url)}" alt="">`, 'lb'); };
    } catch { track.innerHTML = '<p class="muted">Photos will be here soon.</p>'; }
}
loadGallery();

/* Events (rows come from the Google Sheet) */
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


const fetchText = u => fetch(u).then(r => { if (!r.ok) throw 0; return r.text(); });
const fetchCSV = u => fetchText(u).catch(() => fetchText(CONFIG.CORS_PROXY + encodeURIComponent(u)));
function eventState(row) {
    const today = getLocalToday(), start = parseLocalDate(row.eventdate || row.event_date || row.date);
    const end = parseLocalDate(row.enddate || row.end_date) || start;
    if (!start) return 'upcoming';
    return end < today ? 'past' : start > today ? 'upcoming' : 'live';
}
function slotsHTML(row) {
    const total = +(row.totalslots || row.total_slots || row.total || 0), filled = +(row.filledslots || row.filled_slots || row.filled || 0);
    if (!total) return '';
    const p = Math.min(filled / total, 1), cls = p >= 1 ? 'full' : p >= .6 ? 'mid' : '';
    const label = p >= 1 ? 'Slots full' : p >= .6 ? 'Filling fast' : 'Slots available';
    return `<div class="slots ${cls}">${filled} / ${total} · ${label}<div class="slots-bar"><i style="width:${Math.round(p * 100)}%"></i></div></div>
        ${p < 1 ? `<a class="ev-link" href="${CONFIG.INSTAGRAM_URL}" target="_blank" rel="noopener">Ask about joining on Instagram</a>` : ''}`;
}
function renderEvents(csvText) {
    const events = parseCSV(csvText).map(r => ({ ...r, state: eventState(r) }));
    const list = $('#events-list');
    const draw = f => {
        const shown = events.filter(e => f === 'all' || e.state === f);
        list.innerHTML = shown.length ? shown.map(r => {
            const day = r.endday && r.endday !== r.day ? `${r.day}–${r.endday}` : r.day;
            return `<article class="ev ${r.state === 'past' ? 'past' : ''}">
                <div class="ev-top"><div class="ev-date"><small>${esc(r.month)}</small><b>${esc(day)}</b></div>${r.tag ? `<span class="ev-tag">${esc(r.tag)}</span>` : ''}</div>
                <h3>${esc(r.title)}</h3><p class="ev-meta">${esc([r.time, r.location].filter(Boolean).join(' · '))}</p>
                <p class="ev-desc">${esc(r.description || r.desc)}</p>${r.state === 'past' ? '' : slotsHTML(r)}</article>`;
        }).join('') : '<p class="muted">Nothing here yet. Check back soon.</p>';
        list.scrollLeft = 0;
    };
    const first = events.some(e => e.state === 'upcoming') ? 'upcoming' : 'all';
    $$('#event-tabs button').forEach(b => b.classList.toggle('active', b.dataset.filter === first));
    draw(first); tabs('#event-tabs', draw);
}
fetchCSV(CONFIG.EVENTS_SHEET_URL).then(renderEvents)
    .catch(() => { $('#events-list').innerHTML = '<p class="muted">Events will be listed here soon.</p>'; });

/* Marketplace (rows come from a Google Sheet)
   Sheet columns: name | description | price | image | category | status
   image can be a normal image link or a Google Drive share link.
   status: put "sold" to grey out the button; leave blank otherwise. */
function driveImg(u) {
    const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=view&)?id=)([\w-]+)/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : u;
}
function renderMarket(csvText) {
    const track = $('#market-track');
    const rows = parseMarketRows(csvText);
    if (!rows.length) { track.innerHTML = '<p class="muted">New products are on the way. Check back soon.</p>'; return; }
    track.innerHTML = rows.map(r => {
        const sold = /sold/i.test(r.status || '');
        const price = r.price ? (/^[\d,.]+$/.test(r.price) ? '₹' + r.price : r.price) : '';
        const img = r.image ? `<img src="${esc(driveImg(r.image))}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">`
                            : `<img class="ph" src="assets/logo.png" alt="">`;
        return `<article class="prod"><div class="prod-img">${img}${r.category ? `<em>${esc(r.category)}</em>` : ''}</div>
            <div class="prod-body"><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p>
            ${price ? `<div class="price">${esc(price)}</div>` : ''}
            <a class="btn ${sold ? 'off' : ''}" href="${CONFIG.INSTAGRAM_DM_URL}" target="_blank" rel="noopener">${sold ? 'Sold out' : 'Contact to order'}</a></div></article>`;
    }).join('');
}
function parseMarketRows(csvText) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const heads = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map(l => { const v = splitCSVRow(l), o = {}; heads.forEach((h, i) => o[h] = (v[i] || '').trim()); return o; }).filter(r => r.name);
}
if (CONFIG.MARKET_SHEET_URL) fetchCSV(CONFIG.MARKET_SHEET_URL).then(renderMarket)
    .catch(() => { $('#market-track').innerHTML = '<p class="muted">Products will be listed here soon.</p>'; });
else $('#market-track').innerHTML = '<p class="muted">New products are on the way. Check back soon.</p>';
