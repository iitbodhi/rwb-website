/* RWB — main.js */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Join links all point to the Google Form */
$$('.join-link').forEach(a => a.href = CONFIG.JOIN_FORM_URL);
$('#year').textContent = new Date().getFullYear();

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

/* Music (toggle in nav) */
let bgAudio = null;
$('#music-btn').addEventListener('click', e => {
    bgAudio ||= Object.assign(new Audio('assets/music.mp3'), { loop: true, volume: .6 });
    const on = bgAudio.paused;
    on ? bgAudio.play().catch(() => {}) : bgAudio.pause();
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.setAttribute('aria-label', on ? 'Pause music' : 'Play music');
});

/* Engine rev on logo click */
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
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

let audioCtx = null;
$('#rev-btn').addEventListener('click', () => { try { playRoninRev(getAudioCtx()); } catch (e) { console.warn(e); } });

/* Warriors */
function renderWarriors(filter = 'all') {
    const list = filter === 'all' ? WARRIORS : WARRIORS.filter(w => w.role === filter);
    $('#warriors-grid').innerHTML = list.map(w => `
        <button class="w-card" data-name="${esc(w.name)}">
            <img src="${w.photo}" alt="" loading="lazy">
            <span><b>${esc(w.name)}</b><small>${w.nickname ? `“${esc(w.nickname)}” · ` : ''}${esc(w.roleLabel)}</small></span>
        </button>`).join('');
}
$('#warriors-grid').addEventListener('click', e => {
    const w = WARRIORS.find(x => x.name === e.target.closest('.w-card')?.dataset.name); if (!w) return;
    openDialog(`<img src="${w.photo}" alt="${esc(w.name)}"><div>
        <h3>${esc(w.name)}</h3><span class="role">${w.nickname ? `“${esc(w.nickname)}” · ` : ''}${esc(w.roleLabel)}</span>
        <p class="bike">${esc(w.bike)}</p><p>${esc(w.desc)}</p></div>`, 'profile');
});
tabs('#warrior-tabs', renderWarriors);
renderWarriors();

/* Gallery (images come from the Google Drive Apps Script) */
const GALLERY_PREVIEW = 9;
async function loadGallery() {
    const grid = $('#gallery-grid'), more = $('#gallery-more');
    try {
        const imgs = await (await fetch(CONFIG.GALLERY_SCRIPT_URL)).json();
        if (!imgs.length) throw 0;
        const draw = n => grid.innerHTML = imgs.slice(0, n).map((im, i) =>
            `<button data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${esc(im.url)}" alt="${esc(im.label || 'RWB ride photo')}" loading="lazy"></button>`).join('');
        draw(GALLERY_PREVIEW);
        if (imgs.length > GALLERY_PREVIEW) {
            more.hidden = false; more.textContent = `Show all ${imgs.length} photos`;
            more.onclick = () => { draw(imgs.length); more.hidden = true; };
        }
        grid.onclick = e => { const b = e.target.closest('button'); if (b) openDialog(`<img src="${esc(imgs[b.dataset.i].url)}" alt="">`, 'lb'); };
    } catch { grid.innerHTML = '<p class="muted">Photos will be here soon.</p>'; }
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
                <div class="ev-date"><small>${esc(r.month)}</small><b>${esc(day)}</b></div>
                <div><h3>${esc(r.title)}</h3><p class="ev-meta">${esc([r.time, r.location].filter(Boolean).join(' · '))}</p>
                    <p class="ev-desc">${esc(r.description || r.desc)}</p>${r.state === 'past' ? '' : slotsHTML(r)}</div>
                ${r.tag ? `<span class="ev-tag">${esc(r.tag)}</span>` : ''}</article>`;
        }).join('') : '<p class="muted">Nothing here yet. Check back soon.</p>';
    };
    /* If nothing is upcoming, fall back to showing everything */
    let first = events.some(e => e.state === 'upcoming') ? 'upcoming' : 'all';
    $$('#event-tabs button').forEach(b => b.classList.toggle('active', b.dataset.filter === first));
    draw(first); tabs('#event-tabs', draw);
}
fetchText(CONFIG.EVENTS_SHEET_URL).catch(() => fetchText(CONFIG.CORS_PROXY + encodeURIComponent(CONFIG.EVENTS_SHEET_URL)))
    .then(renderEvents).catch(() => { $('#events-list').innerHTML = '<p class="muted">Events will be listed here soon.</p>'; });
