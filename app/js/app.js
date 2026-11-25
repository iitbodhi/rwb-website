/* RWB App — screens and interactions */
import { createApi } from './api.js';
import { registerPlugin as capRegister } from '../vendor/capacitor/core.js';   /* Capacitor 7.6.9 (MIT): the Android app's plugins */

/* settings from config.js and the website's js/data.js (top-level consts, read by name) */
const C = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {}, SITE = typeof CONFIG !== 'undefined' ? CONFIG : {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* links typed by people (product pages, call links): only web, mail, phone or in-app links, never javascript: */
const safeUrl = u => { const t = String(u ?? '').trim(); return /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(t) ? t : '#'; };
const app = $('#app'), tabbar = $('#tabbar'), sheet = $('#sheet');

let api;
const state = { me: null, services: null, fuel: null, bdays: null, acc: null, accCat: 'all', accSort: 'default', adminTab: 'requests', adminMembers: null, adminSearch: '' };
const isAdmin = () => ['admin', 'superadmin'].includes(state.me?.role);
const isMod = () => ['coordinator', 'admin', 'superadmin'].includes(state.me?.role);   /* MotoMart moderators */
const ROLE = { superadmin: 'Admin', admin: 'Admin', coordinator: 'Coordinator', member: 'Member' };
const TEAM_ORDER = { superadmin: 0, admin: 1, coordinator: 2 };
const isTeam = m => m.role in TEAM_ORDER;
const roleBadge = m => isTeam(m) ? `<span class="badge ${m.role === 'coordinator' ? 'coord' : 'orange'}">${ROLE[m.role]}</span>` : '';
const teamFirst = list => [...list].sort((a, b) => (TEAM_ORDER[a.role] ?? 3) - (TEAM_ORDER[b.role] ?? 3) || a.full_name.localeCompare(b.full_name));
/* joined (through the form or approved in the app) in the last 7 days: shown to admins so they can add them to the WhatsApp group */
const isGone = m => m?.status === 'left' || m?.status === 'removed';
const GONE_TXT = { left: 'Left', removed: 'Removed' };
const isNewMember = m => { if (isGone(m)) return false; const t = Date.parse(m?.joined_at || ''); return t > 0 && Date.now() - t < 7 * 864e5; };
const vrnKey = v => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* ---------- formatting ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const parts = iso => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; };
const fmtDate = iso => { if (!iso) return ''; const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`; };
const fmtDayMonth = iso => { if (!iso) return ''; const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]}`; };
const km = n => n == null || n === '' ? '–' : Number(n).toLocaleString('en-IN') + ' km';
const rs = n => n == null || n === '' ? '–' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const num = v => v === '' || v == null ? null : Number(v);
const firstName = m => (m?.nickname || (m?.full_name || '').split(' ')[0] || 'Rider');
const SERVICE_TYPES = { free: 'Free service', paid: 'Paid service', amc: 'AMC service', repair: 'Repair', self: 'Self / DIY' };

/* ---------- toast + sheet ---------- */
let toastTimer;
function toast(msg, err = false, actionLabel = '', action = null) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '') + (action ? ' has-act' : ''); t.hidden = false;
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = actionLabel; b.onclick = () => { t.hidden = true; action(); }; t.append(' ', b); }
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, err ? 5000 : action ? 4500 : 2600);
}
function openSheet(title, html, bind) {
    $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html;
    if (!sheet.open) sheet.showModal();
    $('#sheet-body').scrollTop = 0; sheet.scrollTop = 0;
    bind?.($('#sheet-body'));
}
const closeSheet = () => sheet.open && sheet.close();
$('#sheet-close').addEventListener('click', closeSheet);
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('close', () => { $('#sheet-body').innerHTML = ''; });

/* Photos, videos and guide PDFs can't be saved: no long-press "Download image", no right-click, no dragging out,
   no download button on videos (Nov 2026). A member's OWN bills and documents (.bill-view, .doc-page) keep their
   long-press and "Open / download", since only they can see them. Screenshots still work: this stops casual saving only. */
const OWN_FILES = '.bill-view, .doc-page';
document.addEventListener('contextmenu', e => { const t = e.target; if (t.closest?.('img, video, canvas, picture, .pdfv') && !t.closest(OWN_FILES)) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (/^(IMG|VIDEO)$/.test(e.target.tagName) && !e.target.closest(OWN_FILES)) e.preventDefault(); });
document.addEventListener('loadstart', e => { const v = e.target; if (v.tagName !== 'VIDEO') return;
    v.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback'); v.disablePictureInPicture = true; v.setAttribute('disableremoteplayback', ''); }, true);

/* run an async action with a busy button and a friendly error */
async function busy(btn, fn) {
    const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }
    try { return await fn(); }
    catch (e) { toast(e.message || 'Something went wrong', true); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}
const confirmBox = (msg) => window.confirm(msg);

/* ---------- WhatsApp ---------- */
const waShare = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
/* Phones with both WhatsApp and WhatsApp Business: on Android we open the app the rider chose (regular
   WhatsApp by default) instead of letting the phone pick. If that app isn't installed, the normal link opens. */
const isAndroid = /Android/i.test(navigator.userAgent);
const WA_APPS = { wa: ['WhatsApp', 'com.whatsapp'], biz: ['WhatsApp Business', 'com.whatsapp.w4b'], ask: ['Let my phone decide', null] };
const waPref = () => { try { const v = localStorage.getItem('rwb-wa-app'); return WA_APPS[v] ? v : 'wa'; } catch { return 'wa'; } };
function waIntent(url) {
    const pkg = WA_APPS[waPref()][1];
    if (!isAndroid || !pkg) return url;
    const u = new URL(url);
    /* group invite link: open it in the chosen app as-is (never as a chat with a "phone number") */
    if (u.hostname === 'chat.whatsapp.com') return `intent://chat.whatsapp.com${u.pathname}#Intent;scheme=https;package=${pkg};S.browser_fallback_url=${encodeURIComponent(url)};end`;
    if (u.hostname !== 'wa.me' && u.hostname !== 'api.whatsapp.com') return url;
    const phone = u.pathname.replace(/\D/g, ''), text = u.searchParams.get('text') || '';
    const q = [phone && 'phone=' + phone, text && 'text=' + encodeURIComponent(text)].filter(Boolean).join('&');
    return `intent://send/?${q}#Intent;scheme=whatsapp;package=${pkg};S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
function openWA(url) {
    /* the RWB Android app can't open intent:// links: hand the normal WhatsApp link to Android, which opens WhatsApp */
    if (window.Capacitor?.isNativePlatform?.()) { location.href = url; return; }
    const i = waIntent(url); if (i !== url) location.href = i; else window.open(url, '_blank', 'noopener');
}
/* every WhatsApp link in the app goes through the chosen app */
document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="https://wa.me/"]');
    if (!a || !isAndroid || waPref() === 'ask') return;
    e.preventDefault(); openWA(a.href);
}, true);
const waTo = (phone, text = '') => `https://wa.me/91${String(phone).replace(/\D/g, '').slice(-10)}${text ? '?text=' + encodeURIComponent(text) : ''}`;
const andList = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a.at(-1) : a[0] || '';
/* Birthday wishes: everyone writes their own. The RWB team (admins, coordinators) also get 3 ready-made
   messages for the official club wish; tapping one fills the box so it can still be edited. */
const TEAM_WISHES = [
    ['Club wish', '🎂 Happy Birthday {names}! 🏍️\n\nWishing you many more miles of open roads, safe rides and endless adventures. Have a great one!\n\n— Ronin Warriors of Bengal 🧡'],
    ['Brotherhood', 'Happy Birthday {names}! 🙌\nProud to ride with you. Wishing you health, happiness and a thousand more kilometres with the RWB family. 🧡🏍️'],
    ['Short', 'Happy Birthday {names}! 🎂 Have a fantastic day! 🧡']
];
function wishSheet(people) {
    if (!people.length) return;
    const names = andList(people.map(b => b.full_name)), team = isMod();
    openSheet(`Wish ${people.length > 1 ? 'them' : firstName(people[0])}`, `
        <p class="small muted" style="margin-bottom:10px">Write a wish for <b>${esc(names)}</b>, then choose the RWB group in WhatsApp.</p>
        ${team ? `<p class="small muted" style="margin-bottom:6px">Team templates (tap to use, then edit if you like)</p><div class="chips" style="margin-bottom:10px">${TEAM_WISHES.map(([k], i) => `<button type="button" class="chip" data-tpl="${i}">${esc(k)}</button>`).join('')}</div>` : ''}
        <textarea id="wish-own" maxlength="1000" placeholder="Type your wish…" aria-label="Your birthday wish"></textarea>
        <button class="btn wa block" id="wish-go" style="margin-top:12px">Send on WhatsApp</button>`, body => {
        const own = body.querySelector('#wish-own');
        setTimeout(() => own.focus(), 60);
        body.querySelectorAll('[data-tpl]').forEach(c => c.onclick = () => {
            body.querySelectorAll('[data-tpl]').forEach(x => x.setAttribute('aria-pressed', x === c));
            own.value = TEAM_WISHES[Number(c.dataset.tpl)][1].replaceAll('{names}', names); own.focus();
        });
        body.querySelector('#wish-go').onclick = () => {
            const txt = own.value.trim();
            if (!txt) { toast('Type your wish first', true); own.focus(); return; }
            openWA(waShare(txt)); closeSheet();
        };
    });
}

/* ---------- data loaders (cached until changed) ---------- */
const load = {
    services: async (force) => (state.services = !force && state.services || await api.services()),
    fuel: async (force) => (state.fuel = !force && state.fuel || await api.fuel()),
    bdays: async () => (state.bdays ??= isMod() ? await api.birthdays(isAdmin() ? 7 : 0).catch(() => []) : []),   /* birthdays: admins and coordinators only */
    listings: async (force) => (state.listings = !force && state.listings || await api.listings()),
    news: async (force) => (state.news = !force && state.news || (await api.news().catch(() => [])).filter(n => !isFam() || n.kind === 'announcement')),   /* RWB FAM: admin announcements only */
    docs: async (force) => (state.docs = !force && state.docs || await api.docs().catch(() => [])),
    reminders: async () => state.reminders !== undefined ? state.reminders : (state.reminders = await api.myReminders().catch(() => [])),   /* null: setup file 62 not run yet */
    ride: async (force) => (state.ride = !force && state.ride || { parts: await api.rideParts().catch(() => null), name: await api.rideName().catch(() => '') })
};

/* ---------- mileage maths ----------
   A "tank" runs from one full-tank fill to the next. Litres of any part fills in between are added in.
   Distance = Trip A at the closing fill if entered, otherwise the odometer difference. */
function tanks(logs) {
    const out = []; let start = null, litres = 0, amount = 0, priced = true;
    for (const f of logs) {
        litres += Number(f.litres); amount += Number(f.amount || 0); priced = priced && f.amount != null;
        /* the very first full tank counts too when it has a Trip A reading (Trip A was reset at an earlier full tank) */
        if (!start && !(f.full_tank && f.trip_a_km > 0)) { if (f.full_tank) { start = f; litres = 0; amount = 0; priced = true; } continue; }
        if (f.full_tank) {
            const dist = f.trip_a_km != null ? Number(f.trip_a_km) : f.odometer_km - start.odometer_km;
            if (dist > 0 && litres > 0) out.push({ end: f, dist, litres, kmpl: dist / litres, amount: priced ? amount : null });
            start = f; litres = 0; amount = 0; priced = true;
        }
    }
    return out;
}
function mileageStats(logs) {
    const t = tanks(logs);
    const dist = t.reduce((a, x) => a + x.dist, 0), lit = t.reduce((a, x) => a + x.litres, 0);
    const pricedT = t.filter(x => x.amount != null), pd = pricedT.reduce((a, x) => a + x.dist, 0), pa = pricedT.reduce((a, x) => a + x.amount, 0);
    return { tanks: t, avg: lit ? dist / lit : null, last: t.at(-1)?.kmpl ?? null, best: t.length ? Math.max(...t.map(x => x.kmpl)) : null, cpk: pd ? pa / pd : null };
}

/* ---------- router ---------- */
const ROUTES = { calendar: viewCalendar, docs: viewDocs, home: viewHome, service: viewService, mileage: viewMileage, motomart: viewMotoMart, guides: viewGuides, gallery: viewGallery, me: viewMe, admin: viewAdmin, news: viewNews, chat: viewChat, teach: viewTeach, ride: viewRide, crew: viewCrew, members: viewMembers, events: viewEvents, terms: viewTerms, track: viewTrack };
/* roninwb.in/app/#terms: Me screen with the Terms & Conditions open, ready to agree */
function viewTerms() {
    history.replaceState(null, '', '#me'); document.body.dataset.route = 'me';
    tabbar.querySelectorAll('a').forEach(a => a.dataset.tab === 'me' ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    viewMe(); actions.rules?.();
}
/* screens render one after another, so the screen the rider tapped last always wins */
let renderChain = Promise.resolve(), renderQueued = false;
function render() {
    if (renderQueued) return renderChain;          /* one queued render is enough: it shows the latest screen */
    renderQueued = true;
    const run = () => { renderQueued = false; return doRender(); };
    renderChain = renderChain.then(run, run);
    return renderChain;
}
/* A screen that is still loading when the rider moves on never paints over the new one:
   its next write to the page stops it (navN changes on every navigation). */
let navN = 0, paintN = -1, lastRoute = '', topFor = -1;
/* Screen changes: if the next screen takes a moment, the old one gently dims (and can't be tapped) and a thin
   line at the top shows progress. Fast screens (most, they're cache-first) show neither: they just glide in. */
/* pictures fade in once loaded (CSS hides the listed thumbnails until then; already-cached ones show at once) */
/* pictures already shown once this session are drawn at once on the next screen (no lazy wait), so faces don't blink */
const seenImg = new Set();
document.addEventListener('load', e => { const t = e.target; if (t.tagName === 'IMG') { t.classList.add('in'); seenImg.add(t.getAttribute('src')); } }, true);   /* on document: a picture's load never reaches window */
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.querySelectorAll) n.querySelectorAll('img').forEach(i => { if (i.complete && i.naturalWidth) i.classList.add('in'); }); })
    .observe(document.getElementById('app'), { childList: true, subtree: true });
const navUI = (() => {
    const root = document.documentElement, bar = document.createElement('div'); bar.id = 'nav-bar'; bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);
    let dimT = 0, barT = 0, on = false;
    return {
        start(change) { clearTimeout(dimT); clearTimeout(barT);
            if (change) dimT = setTimeout(() => root.classList.add('nav-wait'), 90);
            barT = setTimeout(() => { on = true; bar.className = ''; void bar.offsetWidth; bar.className = 'go'; }, 160); },
        painted() { clearTimeout(dimT); root.classList.remove('nav-wait'); },
        done() { clearTimeout(dimT); clearTimeout(barT); root.classList.remove('nav-wait');
            if (on) { on = false; bar.className = 'done'; setTimeout(() => { if (bar.className === 'done') bar.className = ''; }, 450); } }
    };
})();
const STALE = new Error('stale screen');
(() => {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(app, 'innerHTML', { configurable: true, get() { return d.get.call(this); },
        set(v) { if (paintN >= 0 && paintN !== navN) throw STALE; d.set.call(this, v); navUI.painted();
            /* a new screen starts at its scroll spot in the same frame it's drawn (scrolling a frame later made it jump) */
            if (topFor === navN) { topFor = -1; if (navScroll != null) window.scrollTo(0, navScroll); } } });
})();
/* still on the screen that started loading? (for parts filled in after the first paint) */
const stillHere = n => n === navN;
/* smoothness: while the screen is being scrolled, the decorative animations (drifting background glows, Pookie's float,
   the spinning tab ring) pause, so the phone spends every frame on the scroll itself */
(() => {
    let t = 0; const root = document.documentElement;
    const on = () => { if (!t) root.classList.add('scrolling'); clearTimeout(t); t = setTimeout(() => { t = 0; root.classList.remove('scrolling'); }, 220); };
    addEventListener('scroll', on, { passive: true, capture: true });
    addEventListener('touchmove', on, { passive: true });
    addEventListener('wheel', on, { passive: true });
    addEventListener('pointerdown', on, { passive: true });
    /* lighter phones (4 GB memory or less, or few cores): keep the decorations still all the time */
    const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
    if ((mem && mem <= 4) || (cores && cores <= 4)) root.classList.add('lite');
})();
async function doRender() {
    if (!state.me) return;          /* signed out / not loaded yet: boot() shows the right screen */
    const gate = isFam() ? null : await gateFor(state.me);
    if (gate) { tabbar.hidden = true; document.body.dataset.route = 'gate'; return gate === 'tnc' ? tncGate() : profileGate(); }
    const [name, param] = (location.hash.slice(1) || 'home').split('?')[0].split('/');
    state.param = param || null;
    if (name === 'videos') { history.replaceState(null, '', '#guides/app'); return void render(); }   /* old How-to videos link */
    if (isFam() && !FAM_ROUTES.includes(name)) { location.hash = '#home'; return; }
    const view = isFam() ? famView(name) : ROUTES[name] || viewHome;
    if (name === 'admin' && !isMod()) { location.hash = '#home'; return; }   /* coordinators get their own smaller panel */
    if (name === 'admin' && param) state.adminTab = param;
    tabbar.hidden = false;
    if (name !== 'chat') state.cameFrom = name;
    if (name === 'motomart' && document.body.dataset.route !== 'motomart') Object.assign(mmState, { branch: 'all', cat: 'all', q: '', mine: false, review: false });   /* MotoMart always opens on All */
    if (name === 'guides' && document.body.dataset.route !== 'guides') Object.assign(gState, { cat: isFam() ? 'app' : 'maint', type: 'all', q: '' });   /* Guides always opens on Maintenance */
    document.body.dataset.route = name;
    tabbar.querySelectorAll('a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === (name === 'members' ? 'crew' : name)));
    tabbar.querySelectorAll('a[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
    /* the entrance animation plays when the screen changes, not when the same screen refreshes */
    const route = name + '/' + (param || '');
    app.classList.toggle('same', route === lastRoute); lastRoute = route;
    liveCheck();   /* Track button ring: throttled to once per ~2 min */
    if (route !== app.dataset.shown) { app.classList.add('enter'); clearTimeout(app._enterT); app._enterT = setTimeout(() => app.classList.remove('enter'), 420); }
    paintN = navN; topFor = navN;
    navUI.start(route !== app.dataset.shown); app.dataset.shown = route;
    pingCopy().catch(() => {});
    try { await view(); } catch (e) { if (e === STALE) return; paintN = -1; app.innerHTML = top('Oops') + `<div class="card empty"><b>Could not load</b>${esc(e.message)}<p style="margin-top:12px"><button class="btn sm" onclick="location.reload()">Try again</button></p></div>`; }
    finally { paintN = -1; navUI.done(); }
    const y = navScroll; navScroll = null;
    if (y != null) requestAnimationFrame(() => window.scrollTo(0, y));
}
/* Scroll: a new screen starts at the top; going back returns to where the rider was on that screen */
let navIdx = 0, navMax = 0, navScroll = null;
const navPos = {};
try { history.replaceState({ ...(history.state || {}), rwbNav: 0 }, ''); } catch { /* ignore */ }
window.addEventListener('hashchange', () => {
    navPos[navIdx] = window.scrollY;
    navN++;
    const idx = history.state?.rwbNav;
    if (idx != null) { navIdx = idx; navScroll = navPos[idx] || 0; }       /* back / forward to a screen seen before */
    else { navIdx = ++navMax; try { history.replaceState({ ...(history.state || {}), rwbNav: navIdx }, ''); } catch { /* ignore */ } navScroll = 0; }
    closeSheet(); closeMmSearch(); gdClose(true); render();
});

const demoBar = () => api?.demo ? `<div class="demo-bar">Demo mode: sample data, saved only on this device. <button data-act="reset-demo">Reset</button></div>` : '';
const BELL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
const seenNews = () => { try { return Number(localStorage.getItem('rwb-news-seen') || 0); } catch { return 0; } };
const unread = () => (state.news || []).some(n => n.id > seenNews());
const initials = m => (m?.full_name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
/* profile photo if the member added one, otherwise their initials */
const face = (m, cls = 'avatar') => `<span class="${cls}">${m?.avatar_url ? `<img src="${esc(m.avatar_url)}" alt=""${seenImg.has(m.avatar_url) ? ' decoding="sync"' : ' loading="lazy"'} onerror="this.remove()">` : ''}<i>${esc(initials(m))}</i></span>`;
const CREW_F = all => { const n = all.filter(m => m.on_app).length; return { all: 'Everyone', app: `On app (${n})`, noapp: `Not on app (${all.length - n})` }; };
const CREW_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.4.2 4 1.7 4.5 4.4"/></svg>';
const CAL_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M7.8 14h.01M12 14h.01M16.2 14h.01M7.8 17.2h.01M12 17.2h.01" stroke-width="2.4"/></svg>';
const docsAlert = () => (state.docs || []).some(d => docStatus(d).level !== 'ok' && docStatus(d).level !== 'none');
/* Android in the browser (not the RWB Android app): a small pulsing "Get app" button; never shown on iPhone */
const getAppBtn = () => !NATIVE && /android/i.test(navigator.userAgent) ? `<a class="get-app" href="${PLAY_URL}" aria-label="Get the RWB app on Google Play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>App</span></a>` : '';
/* quiet shimmer bars instead of a "Loading…" line */
const SKEL = (n = 3) => `<div class="skel" aria-hidden="true">${'<i></i>'.repeat(n)}</div><span class="sr-only">Loading</span>`;
const top = (title, right = '') => `${demoBar()}<header class="top"><img class="logo" src="icons/logo-128.webp" alt="RWB" decoding="sync"><h1>${esc(title)}</h1>${right}${getAppBtn()}
    ${isFam() ? '' : `<a class="icon-btn bell cal-btn" href="#calendar" aria-label="Calendar${calAlert() ? ' (something due soon)' : ''}">${CAL_ICON}${calAlert() ? '<i class="dot"></i>' : ''}</a>`}
    <a class="icon-btn bell guide-btn" href="#guides" aria-label="Guides and how-to videos">${HELP_ICON}</a>
    <a class="icon-btn bell" href="#news" aria-label="Announcements${unread() ? ' (new)' : ''}">${BELL}${unread() ? '<i class="dot"></i>' : ''}</a>
    <a href="#me" aria-label="My profile" class="avatar-link">${face(state.me)}</a></header>`;

/* delegated clicks: each screen sets its own actions */
let actions = {};
app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = actions[el.dataset.act] || globalActions[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
const globalActions = {
    'reset-demo': () => { if (confirmBox('Reset the demo data?')) { api.resetDemo(); Object.assign(state, { services: null, fuel: null, bdays: null, adminMembers: null, listings: null, news: null, board: null, dir: null }); boot(); } },
    'add-service': () => serviceForm(),
    'add-fuel': () => fuelForm(),
    'chat-close': () => { if (history.length > 1 && state.cameFrom) history.back(); else location.hash = '#home'; },
    'odo': () => odoSheet(),
    'wish': () => wishSheet(state.bdays.filter(b => b.day === todayISO())),
    'hello': el => helloSheet(el.dataset.name),
    'news-open': el => { const n = NEWS_MAP.get(el.dataset.nid); if (n) newsSheet(n); },
    fam: () => famSheet(),
    'fam-all': () => famAdminSheet()
};
/* Welcome a new Ronin in the RWB WhatsApp group */
function helloSheet(name) {
    const first = String(name || '').trim().split(/\s+/)[0] || 'Warrior';
    const T = [`Welcome to RWB, ${name}! 🏍️🎉`, `Welcome to the RWB family, ${first}! 🧡 Glad to have you with us. Explore. Evolve. Inspire. 🏍️`, `Hey ${first}, welcome aboard! 🙌 See you on the next ride! 🏍️`];
    openSheet(`Welcome ${first}`, `<p class="small muted" style="margin-bottom:8px">Say hello in the RWB WhatsApp group. Pick a message or write your own.</p>
        <div class="list" id="hello-t" style="margin-bottom:10px">${T.map((t, i) => `<button type="button" class="chip" style="text-align:left;white-space:normal" aria-pressed="${i === 0}" data-i="${i}">${esc(t)}</button>`).join('')}</div>
        <textarea id="wa-text" rows="4">${esc(T[0])}</textarea>
        <button class="btn wa block" data-x="send" style="margin-top:10px">${state.settings?.wa_group_link ? 'Copy & open the RWB group' : 'Send in the RWB group'}</button>`, body => {
        body.querySelectorAll('#hello-t .chip').forEach(c => c.onclick = () => { body.querySelectorAll('#hello-t .chip').forEach(x => x.setAttribute('aria-pressed', x === c)); body.querySelector('#wa-text').value = T[Number(c.dataset.i)]; });
        body.querySelector('[data-x=send]').onclick = () => { const t = body.querySelector('#wa-text').value.trim(); closeSheet(); toGroup(t); };
    });
}

/* =================== Sign in / access =================== */
/* =================== Member details: the same questions as the RWB join form =================== */
/* Titles, order and required answers match the Google join form, so the app, the form and the contact sheet stay uniform. */
const JOIN_REQUIRED = ['full_name', 'dob', 'phone', 'bike', 'vrn', 'blood_group', 'locality', 'emergency_phone', 'hideout'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RONIN = [['TVS Ronin 225', 'Yes'], ['No Ronin yet', 'Not yet']];
const normBlood = s => {
    const t = String(s || '').toUpperCase().replace(/\s/g, ''), g = t.match(/^(AB|A|B|O)/);
    const sign = /NEG|-|−/.test(t) ? '-' : /POS|\+/.test(t) ? '+' : '';
    return g && sign ? g[1] + sign : String(s || '');
};
/* mode: 'join' (app join request), 'me' (Me → Edit), 'admin' (admin edits a member: only name and number required) */
function joinFields(v = {}, mode = 'join') {
    v = v || {};
    const need = k => mode === 'admin' ? k === 'full_name' || k === 'phone' : JOIN_REQUIRED.includes(k);
    const rq = k => need(k) ? ' required' : '';
    const L = (k, title, input, hint = '') => `<label><span>${esc(formTitle(k, title))}${need(k) ? ' <span class="req">*</span>' : ''}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
    const APPROVE = mode === 'me' ? '<span class="needs-ok">Changes need an admin\'s approval</span>' : '';
    const val = k => esc(v[k] || '');
    const tel = (k, ph) => `<input name="${k}" inputmode="tel" autocomplete="off" placeholder="${ph}"${rq(k)} value="${val(k)}">`;
    const sel = (k, opts, cur) => {
        const list = cur && !opts.some(o => o[0] === cur) ? [[cur, cur], ...opts] : opts;
        return `<select name="${k}"${rq(k)}><option value="">Choose…</option>${list.map(o => `<option value="${esc(o[0])}"${o[0] === cur ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    };
    const dob = v.dob && !String(v.dob).startsWith('1904') ? String(v.dob).slice(0, 10) : '';
    return [
        L('full_name', 'Full Name', `<input name="full_name" autocomplete="name"${rq('full_name')} value="${val('full_name')}">`, APPROVE),
        mode !== 'join' ? L('nickname', 'Nickname', `<input name="nickname" maxlength="40" value="${val('nickname')}">`, 'Optional, only used in the app') : '',
        L('dob', 'Date of Birth', `<input type="date" name="dob" max="${todayISO()}"${rq('dob')} value="${esc(dob)}">`, v.dob && !dob && mode === 'me' ? 'Only your birthday was saved so far. Please add the year too.' : ''),
        L('phone', 'WhatsApp No.', tel('phone', '10-digit number'), mode === 'join' ? 'The number you\'re in the RWB WhatsApp group with' : APPROVE),
        L('alt_phone', 'Mobile No. (alternative)', tel('alt_phone', 'Optional')),
        mode === 'admin' ? L('email', 'Email', `<input type="email" name="email" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" value="${val('email')}">`,
            v.user_id ? 'The Google account they sign in to the app with. If you change it, they\'re signed out of the app at once and must sign in with the new email. Their records and role come along.' : v.move_from ? 'Waiting for them to sign in with this email. Their records come along when they do.' : 'They sign in to the app with this Google account')  : mode === 'me' ? L('email', 'Email', `<input type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${val('email')}">`,
            APPROVE + '<br>The Google account you sign in with. Once it\'s approved you\'re signed out; sign in again with the new email. Your records come along.'): '',
        L('bike', 'Do you own a Ronin bike?', sel('bike', RONIN, v.bike || (mode === 'join' ? 'TVS Ronin 225' : ''))),
        L('vrn', 'VRN please', `<input name="vrn" autocapitalize="characters" placeholder="WB 02 AB 1234"${rq('vrn')} value="${val('vrn')}">`, mode === 'me' ? 'Your main bike. ' + APPROVE : 'Your Ronin\'s registration number'),
        L('blood_group', 'Blood group', sel('blood_group', BLOOD.map(b => [b, b]), normBlood(v.blood_group))),
        L('locality', 'Current Locality', `<input name="locality" placeholder="Area, city"${rq('locality')} value="${val('locality')}">`),
        L('hideout', 'Permanent Hideout', `<input name="hideout" placeholder="Home town"${rq('hideout')} value="${val('hideout')}">`),
        L('emergency_phone', 'In case of emergency, contact (number)', tel('emergency_phone', '10-digit number'), 'A family member or friend we can call')
    ].join('');
}
/* RWB Terms & Conditions: what every member agrees to (the join form's "Please read carefully" section, in full) */
const TNC_UPDATED = window.RWB_TNC?.updated || '';
const TNC_URL = 'https://roninwb.in/terms.html';
const TNC = window.RWB_TNC?.sections || [['RWB Terms & Conditions', ['Please read them at roninwb.in/terms.html']]];
const RWB_RULES = TNC.flatMap(([, pts]) => pts);   /* plain list, used where only text fits */
const tncDoc = () => `<article class="tnc-doc"><p class="tnc-meta">Ronin Warriors of Bengal · Last updated ${TNC_UPDATED} · <a href="${TNC_URL}" target="_blank" rel="noopener">roninwb.in/terms</a></p>
    ${TNC.map(([h, pts], i) => `<section><h3>${i + 1}. ${esc(h)}</h3>${pts.length > 1 ? `<ol>${pts.map((t, j) => `<li><span>${i + 1}.${j + 1}</span>${esc(t)}</li>`).join('')}</ol>` : `<p>${esc(pts[0])}</p>`}</section>`).join('')}</article>`;
const showTnc = () => openSheet('RWB Terms & Conditions', tncDoc());
const rulesBlock = () => `<details class="rules"><summary>Read the RWB Terms & Conditions</summary>${tncDoc()}</details>
    <label class="check-row"><input type="checkbox" name="tnc" required> <span>I have read and agree to the RWB Terms & Conditions <span class="req">*</span></span></label>`;

/* Form → clean values (trimmed; VRN in capitals) */
function joinData(form) {
    const d = Object.fromEntries(new FormData(form));
    Object.keys(d).forEach(k => d[k] = String(d[k]).replace(/\s+/g, ' ').trim());
    if ('tnc' in d) d.tnc = d.tnc === 'on';
    if (d.vrn) d.vrn = d.vrn.toUpperCase();
    return d;
}
/* Returns a message for the first problem, or '' when everything is fine */
function joinCheck(d, mode, ownPhone) {
    const n = x => String(x || '').replace(/\D/g, '');
    const need = k => mode === 'admin' ? k === 'full_name' || k === 'phone' : JOIN_REQUIRED.includes(k);
    const names = { full_name: 'Full Name', dob: 'Date of Birth', phone: 'WhatsApp No.', bike: 'Do you own a Ronin bike?', vrn: 'VRN', blood_group: 'Blood group', locality: 'Current Locality', emergency_phone: 'the emergency contact number' };
    for (const k of Object.keys(names)) if (k in d && need(k) && !d[k]) return `Please fill in ${names[k]}`;
    if ('full_name' in d && d.full_name.length < 3) return 'Please enter your full name';
    if ('phone' in d && n(d.phone).length < 10) return 'WhatsApp No. needs a 10-digit number';
    if (d.alt_phone && n(d.alt_phone).length < 10) return 'Mobile No. (alternative) needs a 10-digit number';
    if (d.emergency_phone && n(d.emergency_phone).length < 10) return 'The emergency contact needs a 10-digit number';
    const own = n(d.phone || ownPhone).slice(-10);
    if (d.emergency_phone && own && n(d.emergency_phone).slice(-10) === own) return 'The emergency contact should be someone else\'s number';
    if (d.vrn && d.vrn.replace(/[^A-Z0-9]/g, '').length < 6) return 'Please check the VRN (for example WB 02 AB 1234)';
    if (d.dob && (d.dob > todayISO() || d.dob < '1930-01-01')) return 'Please check the Date of Birth';
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return 'Please check the email';
    return '';
}

const G_ICON = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function viewSignIn() {
    tabbar.hidden = true;
    app.innerHTML = `${demoBar()}<section class="signin">
        <img class="si-icon" src="icons/app-icon-256.webp" alt="RWB App">
        ${JOIN_MODE ? `<div><h1>Join RWB</h1><p class="lead">Ronin owner or not, every rider is welcome. Continue with Google to fill the RWB join form: your Google email becomes your RWB email.</p></div>
        <button class="btn gbtn block" data-act="google">${G_ICON} Continue with Google</button>
        <p class="small muted">Already a member? Continue with the Google account you use for RWB.</p>`
        : `<div><h1>RWB App</h1><p class="lead">For members of Ronin Warriors of Bengal. Sign in with the Google account you use for RWB.</p></div>
        <button class="btn gbtn block" data-act="google">${G_ICON} Continue with Google</button>
        <p class="small muted">New to RWB? Tap <b>Continue with Google</b>, then <b>Join RWB</b>. Every rider is welcome.</p>`}
        ${(() => { try { const e = localStorage.getItem('rwb-gsheet-err'); return e ? `<p class="small muted" style="opacity:.6;font-size:11px;word-break:break-all">Google sheet: ${esc(e)}</p>` : ''; } catch { return ''; } })()}
    </section>`;
    actions = { google: b => busy(b, () => api.signIn()) };
}

/* =================== The join form, exactly as the RWB Google Form =================== */
/* The sheet's script publishes the form's questions; the app shows the same pages, titles, help text, choices and
   required answers. Answers to the questions the app knows also fill the member record; every answer is kept. */
const FORM_KEYS = [['full_name', /^full name/i], ['dob', /^date of birth/i], ['phone', /^whatsapp no/i], ['vrn', /^vrn/i], ['blood_group', /^blood group/i],
    ['locality', /^current locality/i], ['hideout', /^permanent hideout/i], ['emergency_phone', /^in case of emergency/i], ['alt_phone', /^mobile no\.? ?\(alternative\)/i],
    ['bike', /^do you own a ronin/i], ['tnc', /read carefully|agree|terms|t\s*&\s*c|tnc|rules|declar|consent/i]];
/* RWB on social media; join-form questions that mention one get a "Visit" button */
/* RWB on social media; join-form questions that mention one get a "Visit" button (no link yet = no button) */
const SOCIAL = [
    ['Facebook group', null, /(fb|facebook) group/i, '👥'],
    ['Facebook', 'https://www.facebook.com/profile.php?id=61556220173720', /facebook|\bfb\b/i, 'img/social-facebook.png'],
    ['Instagram', 'https://www.instagram.com/ronin_warriors_bengal', /insta|\big\b/i, 'img/social-instagram.png'],
    ['WhatsApp channel', 'https://whatsapp.com/channel/0029VaiK6QHEgGfTItym9t2H', /channel/i, 'img/social-whatsapp.png']];
const FOLLOW = SOCIAL.filter(x => x[1]);
const SKIP_Q = /^(timestamp|email( address)?|score|which bike do you ride now\?|where are you with a ronin\?|anything you'd like to tell us\?)$/i;
const isExtraQ = q => !SKIP_Q.test(String(q).trim()) && !/^\s*[0-9.]*\s*$/.test(String(q)) && !formKey(q);
const ansText = a => Array.isArray(a) ? a.join(', ') : String(a ?? '').trim();
/* the join-form answers that don't have their own field in the profile (sticker, social media and so on) */
const extraAnswers = m => Object.entries(m?.form_answers || {}).filter(([q, a]) => isExtraQ(q) && ansText(a));
/* every such question: from the live join form (even if unanswered) plus anything already on the record */
/* a member's answers, with the Ronin answer worked out from their bike when the join form didn't ask (sticker questions are for Ronin owners) */
const memberAns = m => { const k = roninKind(m); return { [RONIN_Q]: k === 'yes' ? R_YES : k === 'booked' ? R_BOOKED : R_NOT, ...(m?.form_answers || {}) }; };
const moreQs = m => [...new Set([...(joinFormDef?.items || []).filter(i => i.title && !['PAGE_BREAK', 'SECTION_HEADER', 'IMAGE', 'VIDEO'].includes(i.type) && isExtraQ(i.title) && (!i.show || i.show(memberAns(m)))).map(i => i.title),
    ...extraAnswers(m).map(([q]) => q)])];
const answerRows = (m, mine) => (mine ? moreQs(m).map(q => [q, m.form_answers?.[q]]) : extraAnswers(m)).map(([q, a]) => { const so = SOCIAL.find(x => x[2].test(q)); return `<div class="ans-row"><span class="grow"><small>${esc(q)}</small><b class="${ansText(a) ? '' : 'muted'}">${esc(ansText(a) || 'Not answered yet')}</b></span>${so?.[1] && mine ? `<a class="btn sm ghost" href="${so[1]}" target="_blank" rel="noopener">Visit ↗</a>` : ''}</div>`; }).join('');
const followRwb = () => `<div class="follow-rwb">${FOLLOW.map(([n, u, , ic]) => `<a href="${u}" target="_blank" rel="noopener"><img class="fi" src="${ic}" alt="" width="40" height="40" loading="lazy">${esc(n)}</a>`).join('')}</div>`;
/* "More from RWB" questions as form fields; choice questions (sticker, social media) are required, text ones only if the form says so */
const moreItem = q => (joinFormDef?.items || []).find(i => i.title === q);
const moreRequired = q => { const it = moreItem(q); return !!it && (it.required || (it.choices || []).length > 0); };
function moreFieldsHtml(m, qs, strict) {
    return qs.map((q, i) => { const it = moreItem(q), cur = ansText(m.form_answers?.[q]), ch = (it?.choices || []).map(c => c.value).filter(Boolean), req = strict && moreRequired(q);
        return `<label><span>${esc(q)}${req ? ' <span class="req">*</span>' : ''}</span>${ch.length ? `<select name="mq${i}"${req ? ' required' : ''}><option value="">Choose…</option>${[...new Set([...ch, ...(cur && !ch.includes(cur) ? [cur] : [])])].map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`
            : `<input name="mq${i}" maxlength="300" value="${esc(cur)}"${req ? ' required' : ''}>`}</label>`; }).join('');
}
const readMore = (form, m, qs) => { const out = {}; qs.forEach((q, i) => { const el = form.elements[`mq${i}`]; if (!el) return; const v = el.value.trim(); if (v !== ansText(m.form_answers?.[q])) out[q] = v; }); return out; };
const moreMissing = m => moreQs(m).filter(q => moreRequired(q) && !ansText(m.form_answers?.[q]));
function moreSheet(m, done) {
    const qs = moreQs(m);
    openSheet('More from RWB', `<form id="more">${moreFieldsHtml(m, qs, false)}
        <p class="small muted" style="margin:-4px 0 12px">Saved straight away, no approval needed.</p><button class="btn block">Save</button></form>`, body => {
        body.querySelector('#more').onsubmit = e => { e.preventDefault(); const out = readMore(e.target, m, qs);
            if (!Object.keys(out).length) { closeSheet(); return; }
            busy(e.submitter, async () => { const saved = await api.updateMyAnswers(out); m.form_answers = { ...(m.form_answers || {}), ...saved }; closeSheet(); toast('Saved'); done(); }); };
    });
}
const formKey = title => (FORM_KEYS.find(([, re]) => re.test(String(title || '').trim())) || [])[0] || null;
const PHONE_KEYS = ['phone', 'emergency_phone', 'alt_phone'];
const isAgree = v => /(agree|understood|accept|yes|i do)/i.test(v || '') && !/(don'?t|do not|not agree|disagree|^no\b)/i.test(v || '');
const roninAnswer = v => /^(yes|yeah|yep)/i.test(String(v || '').trim()) ? 'TVS Ronin 225' : String(v || '').trim();
/* =================== The RWB join form (setup file 75: RWB's own form, the Google Form is retired) ===================
   The question titles are the same as on the old Google Form, so answers land in the same sheet columns and in
   Me → More from RWB. Every rider is welcome: Ronin owners, Ronin booked, and riders without a Ronin. */
const RONIN_Q = 'Do you own a Ronin bike?', R_YES = 'Yeah!', R_BOOKED = 'Booked, waiting for delivery', R_NOT = 'Not yet';
const OTHER_BIKE_Q = 'Which bike do you ride now?', STICKER_Q = 'Have you received RWB sticker?';
const PLAN_Q = 'Where are you with a Ronin?', P_BUY = 'Planning to buy one', P_OTHER = 'I ride another bike', P_NONE = 'No bike yet';
const NOTE_Q = 'Anything you\'d like to tell us?';
const TNC_Q = 'Please read carefully before proceeding\nRWB Terms & Conditions\nBy choosing “Understood & agreed”, you confirm that:\n• You are 18 or older and hold a valid motorcycle driving licence. Membership is free and mainly for TVS Ronin owners; admins may approve or decline any registration.\n• Your details are true and complete, and the VRN you give is your own. Admins may verify it. One membership per person.\n• You take part in rides and events voluntarily and at your own risk. You will obey traffic laws, wear an ISI-certified helmet and proper gear, keep your papers valid, and never ride drunk, race or perform stunts. RWB, its admins, coordinators and volunteers are not liable for any accident, injury, loss or damage.\n• You will respect every member and the public, and follow ride leads. No harassment, hate, spam, scams or unapproved promotions in RWB groups, the app or at events.\n• RWB is a free, non-profit, volunteer community and is not affiliated with TVS Motor Company.\n• Photos and videos from RWB rides and events may be shared on RWB’s website and social media.\n• Your details are used only to run the community. Other members see only your name, nickname and photo unless you choose to share more. RWB never sells your data.\n• Admins may remove members who break these rules. You can leave any time, and your app data is then deleted. \nFull Terms & Conditions: https://roninwb.in/terms.html\nPrivacy Policy: https://roninwb.in/privacy.html';
const ronin = a => a[RONIN_Q] || '';
const DONE = ['Done!', 'Maybe later'];
const JOIN_DEF = { title: '', description: '', items: [
    { type: 'SECTION_HEADER', title: 'Warm welcome!', help: 'A few details so the RWB team knows you, and can act fast in an emergency on a ride. Every rider is welcome, with or without a Ronin.' },
    { type: 'MULTIPLE_CHOICE', title: RONIN_Q, required: true, choices: [{ value: R_YES }, { value: R_BOOKED }, { value: R_NOT }] },
    { type: 'TEXT', title: 'VRN please', required: true, help: 'Your Ronin\'s registration number, for example WB02AB1234. Not the engine or chassis number. An admin may verify it.', show: a => ronin(a) === R_YES },
    { type: 'MULTIPLE_CHOICE', title: PLAN_Q, required: true, choices: [{ value: P_BUY }, { value: P_OTHER }, { value: P_NONE }], show: a => ronin(a) === R_NOT },
    { type: 'TEXT', title: OTHER_BIKE_Q, required: true, help: 'For example, Royal Enfield Hunter 350.', show: a => ronin(a) === R_NOT && a[PLAN_Q] === P_OTHER },
    { type: 'PAGE_BREAK', title: 'About you' },
    { type: 'TEXT', title: 'Full Name', required: true },
    { type: 'DATE', title: 'Date of Birth', required: true, help: 'RWB is for riders aged 18 and over.' },
    { type: 'TEXT', title: 'WhatsApp No.', required: true, help: 'Your 10-digit WhatsApp number. Only this number is added to the RWB group.' },
    { type: 'TEXT', title: 'Mobile No. (alternative)', help: 'Optional, if different from your WhatsApp number.' },
    { type: 'TEXT', title: 'In case of emergency, contact (number)', required: true, help: 'Someone close to you we can call in an emergency.' },
    { type: 'LIST', title: 'Blood group', required: true, choices: ['A +ve', 'B +ve', 'AB +ve', 'O +ve', 'A -ve', 'B -ve', 'AB -ve', 'O -ve', 'Other'].map(value => ({ value })) },
    { type: 'PAGE_BREAK', title: 'Where you ride from' },
    { type: 'PARAGRAPH_TEXT', title: 'Current Locality', required: true, help: 'Nearest city, town, area or landmark. Not your full address.' },
    { type: 'PARAGRAPH_TEXT', title: 'Permanent Hideout', required: true, help: 'Your hometown: nearest city, town or district. Not your full address.' },
    { type: 'PAGE_BREAK', title: 'A few more things' },
    { type: 'MULTIPLE_CHOICE', title: STICKER_Q, required: true, choices: [{ value: 'Yeah!' }, { value: 'Not yet...' }], show: a => ronin(a) === R_YES },
    { type: 'MULTIPLE_CHOICE', title: 'Have you fixed the sticker to your bike?', required: true, choices: [{ value: 'Of course!' }, { value: 'Not yet...' }], show: a => ronin(a) === R_YES && a[STICKER_Q] === 'Yeah!' },
    { type: 'MULTIPLE_CHOICE', title: 'Are you willing to collect sticker?', required: true, choices: [{ value: 'Hell yeah!' }, { value: 'Maybe later' }], show: a => ronin(a) === R_YES && a[STICKER_Q] === 'Not yet...' },
    { type: 'MULTIPLE_CHOICE', title: 'Are you following us on our FB page (link below)?', required: true, choices: DONE.map(value => ({ value })) },
    { type: 'MULTIPLE_CHOICE', title: 'Have you joined our FB group (link below)?', required: true, choices: DONE.map(value => ({ value })) },
    { type: 'MULTIPLE_CHOICE', title: 'Are you following us on our Instagram page (link below)?', required: true, choices: DONE.map(value => ({ value })) },
    { type: 'MULTIPLE_CHOICE', title: 'Are you following us on our WhatsApp channel (link below)?', required: true, choices: DONE.map(value => ({ value })) },
    { type: 'PARAGRAPH_TEXT', title: NOTE_Q, help: 'Optional. For example: thinking of booking a Ronin next month, or how you heard about RWB.', max: 500 },
    { type: 'PAGE_BREAK', title: 'Terms & Conditions' },
    { type: 'MULTIPLE_CHOICE', title: TNC_Q, label: 'RWB Terms & Conditions', help: TNC_Q.split('\n').slice(3, -2).join('\n'), required: true, choices: [{ value: 'Understood & agreed' }] }
] };
/* the Ronin answer → the member's bike: a Ronin, a booked Ronin, or the bike they ride now */
function bikeFromJoin(a) {
    const r = ronin(a);
    if (r === R_YES || /^(yes|yeah|yep)/i.test(r)) return 'TVS Ronin 225';
    if (r === R_BOOKED) return 'TVS Ronin 225 (booked)';
    if (a[PLAN_Q] && a[PLAN_Q] !== P_OTHER) return 'No bike yet';
    return String(a[OTHER_BIKE_Q] || '').trim() || 'No bike yet';
}
/* Ronin owner, Ronin booked, or a Non-Ronin rider: from the join answer, else from the bike */
const roninKind = x => { const r = ronin(x?.answers || x?.form_answers || {}), b = String(x?.bike || '');
    if (r === R_BOOKED || /booked/i.test(b)) return 'booked';
    if (r === R_NOT || /^nope/i.test(r)) return 'no';
    if (r === R_YES || /ronin/i.test(b) || /^\s*(yes|yeah|yep)\b/i.test(b)) return 'yes';
    return b ? 'no' : 'yes'; };
const RONIN_TAG = { booked: '<span class="badge ronin-tag booked">Ronin booked</span>', no: '<span class="badge ronin-tag">Non-Ronin</span>', yes: '' };
let joinFormDef;   // loaded once
async function loadJoinForm() { joinFormDef = JOIN_DEF; return joinFormDef; }
const formTitle = (key, fallback) => (joinFormDef?.items || []).find(i => i.type !== 'PAGE_BREAK' && i.type !== 'SECTION_HEADER' && formKey(i.title) === key)?.title || fallback;

/* the value to show for a question, from what RWB already knows about this person */
function prefillFor(item, known) {
    const k = formKey(item.title), ans = known?.answers || {};
    if (ans[item.title] != null) return String(ans[item.title]);
    if (!k || k === 'tnc' || !known) return '';
    let v = known[k]; if (v == null) return '';
    v = String(v);
    if (k === 'dob') return v.startsWith('1904') ? '' : v.slice(0, 10);
    if (item.choices) {
        const norm = x => String(x).toLowerCase().replace(/[^a-z0-9+-]/g, '');
        if (k === 'bike' && /ronin/i.test(v)) return (item.choices.find(c => /^(yes|yeah|yep)/i.test(c.value)) || {}).value || v;
        return (item.choices.find(c => norm(c.value) === norm(v)) || {}).value || '';
    }
    return v;
}
function formItemHtml(item, i, val) {
    const k = formKey(item.title), name = `q${i}`, req = item.required ? ' required' : '';
    const head = `<span class="fq-title">${esc(item.label || item.title)}${item.required ? ' <span class="req">*</span>' : ''}</span>${item.help ? `<span class="fq-help">${esc(item.help)}</span>` : ''}`;
    if (k === 'tnc' && item.choices) item = { ...item, choices: item.choices.filter(c => !/(don'?t|do not|not agree|disagree)/i.test(c.value)) };   /* joining means agreeing */
    if (item.type === 'MULTIPLE_CHOICE' || item.type === 'CHECKBOX') {
        const multi = item.type === 'CHECKBOX', vals = multi ? String(val || '').split(/,\s*/) : [val];
        return `<fieldset class="fq${k === 'tnc' ? ' fq-tnc' : ''}" data-i="${i}"${item.required ? ' data-req="1"' : ''}${item.show ? ' hidden' : ''}><legend>${head}</legend>${k === 'tnc' ? '<button type="button" class="link-btn tnc-link" data-act="tnc-read">Read the full RWB Terms & Conditions ›</button>' : ''}${item.choices.map(c => `<label class="fq-choice"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(c.value)}"${vals.includes(c.value) ? ' checked' : ''}${c.ends ? ' data-ends="1"' : ''}><span>${esc(c.value)}</span></label>`).join('')}</fieldset>`;
    }
    if (item.type === 'LIST') return `<label class="fq" data-i="${i}"${item.show ? ' hidden' : ''}>${head}<select name="${name}"${req}><option value="">Choose</option>${item.choices.map(c => `<option${c.value === val ? ' selected' : ''}>${esc(c.value)}</option>`).join('')}</select></label>`;
    if (item.type === 'DATE') return `<label class="fq" data-i="${i}"${item.show ? ' hidden' : ''}>${head}<input type="date" name="${name}" max="${todayISO()}"${req} value="${esc(val)}"></label>`;
    if (item.type === 'PARAGRAPH_TEXT') return `<label class="fq" data-i="${i}"${item.show ? ' hidden' : ''}>${head}<textarea name="${name}" rows="3"${req}${item.max ? ` maxlength="${item.max}"` : ''}>${esc(val)}</textarea></label>`;
    if (item.type === 'SCALE') return `<label class="fq" data-i="${i}"${item.show ? ' hidden' : ''}>${head}<select name="${name}"${req}><option value="">Choose</option>${Array.from({ length: (item.high || 5) - (item.low || 1) + 1 }, (_, j) => (item.low || 1) + j).map(n => `<option${String(n) === val ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
    const extra = PHONE_KEYS.includes(k) ? ' inputmode="tel" autocomplete="off"' : k === 'vrn' ? ' autocapitalize="characters"' : k === 'full_name' ? ' autocomplete="name"' : '';
    return `<label class="fq" data-i="${i}"${item.show ? ' hidden' : ''}>${head}<input name="${name}"${extra}${req} value="${esc(val)}"></label>`;
}
/* the form split into pages at each page break (like Google Forms) */
function formPages(def) {
    const pages = [{ title: def.title, help: def.description, items: [] }];
    def.items.forEach((it, i) => {
        if (it.type === 'PAGE_BREAK') pages.push({ title: it.title, help: it.help, items: [] });
        else pages.at(-1).items.push({ ...it, i });
    });
    return pages.filter((p, n) => n === 0 || p.items.length);
}
/* the answers so far, for questions shown only after a certain answer (it.show) */
function formAnswers(def, form) {
    const fd = new FormData(form), a = {};
    def.items.forEach((it, i) => { if (it.type !== 'PAGE_BREAK' && it.type !== 'SECTION_HEADER') a[it.title] = String(fd.get(`q${i}`) ?? '').trim(); });
    return a;
}
const itemShown = (it, a) => !it.show || it.show(a);
function readForm(def, form) {
    const fd = new FormData(form), out = { answers: {} }, now = formAnswers(def, form);
    def.items.forEach((it, i) => {
        if (it.type === 'PAGE_BREAK' || it.type === 'SECTION_HEADER' || !itemShown(it, now)) return;
        const v = (it.type === 'CHECKBOX' ? fd.getAll(`q${i}`).join(', ') : String(fd.get(`q${i}`) ?? '')).replace(/\s+/g, ' ').trim();
        if (v) out.answers[it.title] = v;
        const k = formKey(it.title); if (!k) return;
        if (k === 'tnc') out.tnc = isAgree(v);
        else if (k === 'bike') out.bike = def === JOIN_DEF ? bikeFromJoin(now) : roninAnswer(v);
        else if (k === 'vrn') out.vrn = v.toUpperCase();
        else out[k] = v;
    });
    if (!def.items.some(it => formKey(it.title) === 'tnc')) out.tnc = !!form.querySelector('[name=tnc]')?.checked;
    return out;
}
function checkPage(pg, form, def) {
    const now = def ? formAnswers(def, form) : {};
    for (const it of pg.items) {
        if (it.type === 'SECTION_HEADER' || (it.show && !it.show(now))) continue;
        const k = formKey(it.title), name = `q${it.i}`;
        const v = it.type === 'CHECKBOX' || it.type === 'MULTIPLE_CHOICE' ? [...form.querySelectorAll(`[name=${name}]:checked`)].map(x => x.value).join(', ') : String(form.elements[name]?.value || '').trim();
        if (it.required && !v) return `Please answer: ${it.title}`;
        if (k === 'tnc' && v && !isAgree(v)) return 'You need to agree to the RWB Terms & Conditions to join.';
        if (it.type === 'MULTIPLE_CHOICE' && form.querySelector(`[name=${name}]:checked`)?.dataset.ends) return 'You need to agree to the RWB Terms & Conditions to join.';
        if (v && PHONE_KEYS.includes(k) && v.replace(/\D/g, '').length < 10) return `${it.title} needs a 10-digit number`;
        if (v && k === 'vrn' && v.replace(/[^A-Za-z0-9]/g, '').length < 6) return 'Please check the VRN (for example WB 02 AB 1234)';
        if (v && k === 'dob' && (v > todayISO() || v < '1930-01-01')) return 'Please check the Date of Birth';
    }
    return '';
}
/* As soon as a VRN is typed: is it already registered to someone else? (only a few characters of their email and number are shown) */
function vrnWatch(vrnInput, phoneInput) {
    if (!vrnInput) return;
    const box = document.createElement('small'); box.className = 'vrn-taken'; box.hidden = true; vrnInput.after(box);
    let last = '';
    const check = async () => {
        const key = vrnInput.value.replace(/[^a-z0-9]/gi, '').toUpperCase(); if (key.length < 6 || key === last) return; last = key;
        const h = await api.vrnHint(vrnInput.value, phoneInput?.value || '').catch(() => null);
        box.textContent = h ? '⚠ ' + h : ''; box.hidden = !h;
    };
    vrnInput.addEventListener('change', check); vrnInput.addEventListener('blur', check);
}
const vrnTaken = form => form.querySelector('.vrn-taken:not([hidden])')?.textContent.replace(/^⚠ /, '') || '';
function liveJoinForm(def, known, sess, filled = false, back = null) {
    const pages = formPages(def);
    let at = 0;
    const stepName = n => pages[n].title || (n ? '' : 'Welcome');
    app.innerHTML = `${demoBar()}<header class="top"><img class="logo" src="icons/logo-128.webp" alt="RWB" decoding="sync"><h1>${filled ? 'Update my answers' : 'Join RWB'}</h1></header>
        <div class="jf-prog" aria-live="polite"><div class="jf-bar"><i id="jf-fill"></i></div><span class="jf-step" id="jf-step"></span></div>
        <p class="jx-acct"><span class="jx-dot" aria-hidden="true"></span>${esc(sess.email)}</p>
        <form id="req" class="gform jf" novalidate>${pages.map((pg, n) => `<section class="gpage" data-p="${n}"${n ? ' hidden' : ''}>
            ${pg.title ? `<h2 class="gp-title">${esc(pg.title)}</h2>` : ''}${pg.help ? `<p class="gp-help">${esc(pg.help)}</p>` : ''}
            ${pg.items.map(it => it.type === 'SECTION_HEADER' ? `<div class="fq-section"><b>${esc(it.title)}</b>${it.help ? `<span class="fq-help">${esc(it.help)}</span>` : ''}</div>` : formItemHtml(it, it.i, prefillFor(it, known))).join('')}
            ${n === pages.length - 1 && !def.items.some(it => formKey(it.title) === 'tnc') ? rulesBlock() : ''}
            <div class="gnav">${n ? '<button type="button" class="btn ghost" data-act="gback">Back</button>' : ''}${n < pages.length - 1 ? '<button type="button" class="btn" data-act="gnext">Continue</button>' : `<button class="btn">${filled ? 'Send again' : 'Send to the admins'}</button>`}</div></section>`).join('')}
        </form>
        <p class="jx-links">${back ? '<button type="button" class="link-btn" data-act="jback">Cancel</button><span aria-hidden="true">·</span>' : ''}<button type="button" class="link-btn" data-act="out">Use a different Google account</button></p>`;
    const form = $('#req');
    const qIdx = key => def.items.findIndex(it => formKey(it.title) === key);
    vrnWatch(form.querySelector(`[name=q${qIdx('vrn')}]`), form.querySelector(`[name=q${qIdx('phone')}]`));
    /* "Visit" links next to the social media questions */
    def.items.forEach((it, i) => { const so = SOCIAL.find(x => x[1] && x[2].test(it.title) && /follow|join/i.test(it.title)); const el = form.querySelector(`.fq[data-i="${i}"] legend`);
        if (so && el) el.insertAdjacentHTML('beforeend', ` <a class="fq-visit" href="${so[1]}" target="_blank" rel="noopener">Open ${esc(so[0])} ↗</a>`); });
    /* questions that depend on an earlier answer (VRN only for Ronin owners, and so on) */
    const relayout = () => { const a = formAnswers(def, form); def.items.forEach((it, i) => { if (!it.show) return; const el = form.querySelector(`.fq[data-i="${i}"]`); if (el) el.hidden = !it.show(a); }); };
    form.addEventListener('change', relayout); relayout();
    const show = n => { at = n; form.querySelectorAll('.gpage').forEach(p => p.hidden = Number(p.dataset.p) !== n); window.scrollTo(0, 0);
        $('#jf-fill').style.width = `${Math.round((n + 1) / pages.length * 100)}%`; $('#jf-step').textContent = `Step ${n + 1} of ${pages.length}${stepName(n) ? ' · ' + stepName(n) : ''}`; };
    show(0);
    actions = {
        out: () => api.signOut(),
        jback: () => back?.(),
        'tnc-read': () => showTnc(),
        gnext: () => { const err = checkPage(pages[at], form, def) || (form.querySelector(`.gpage[data-p="${at}"] .vrn-taken:not([hidden])`) ? vrnTaken(form) : ''); if (err) return toast(err, true); show(at + 1); },
        gback: () => show(at - 1)
    };
    form.addEventListener('submit', e => {
        e.preventDefault();
        for (let n = 0; n < pages.length; n++) { const err = checkPage(pages[n], form, def); if (err) { show(n); return toast(err, true); } }
        const f = readForm(def, form);
        if (!f.full_name || !f.phone) return toast('Full Name and WhatsApp No. are needed', true);
        if (f.emergency_phone && f.phone && f.emergency_phone.replace(/\D/g, '').slice(-10) === f.phone.replace(/\D/g, '').slice(-10)) return toast('The emergency contact should be someone else\'s number', true);
        if (isMinor(f.dob)) return toast('RWB is for riders aged 18 and over. Please check your date of birth.', true);
        if (!f.tnc) return toast('You need to agree to the RWB Terms & Conditions to join.', true);
        if (vrnTaken(form)) return toast(vrnTaken(form), true);
        busy(e.submitter, async () => { await api.requestAccess(f); toast(filled ? 'Sent again to the admins 👍' : 'Sent to the RWB admins 👍'); boot(); });
    });
}

/* Not a member (yet). New riders join right here (or on roninwb.in/join, which opens this): sign in with Google, fill
   the RWB join form, an admin approves, and they're in. Riders waiting, on hold or not approved see where they stand. */
const JOIN_URL = 'https://roninwb.in/join/';
/* riders who aren't members yet reach RWB on Instagram (admins' numbers and the RWB WhatsApp group stay private) */
const RWB_IG_DM = SITE.INSTAGRAM_DM_URL || 'https://ig.me/m/ronin_warriors_bengal';
const JOIN_MODE = (() => { try { if (/[?&]join\b/.test(location.search) || location.hash === '#join') sessionStorage.setItem('rwb-join', '1'); return sessionStorage.getItem('rwb-join') === '1'; } catch { return false; } })();
async function startJoin(sess, mine = null) {
    await loadJoinForm();
    const back = () => viewAccess(mine?.status || 'not_found', sess, true);
    liveJoinForm(JOIN_DEF, mine ? { ...mine, answers: mine.answers || {} } : { full_name: sess.name || '' }, sess, !!mine, back);
}
const ago = t => t ? timeAgo(t) : '';
async function viewAccess(status, sess, noJump = false) {
    tabbar.hidden = true;
    actions = { recheck: b => busy(b, boot), out: () => api.signOut(), 'fam-join': () => famJoinScreen(sess) };
    if (status === 'pending' || status === 'hold' || status === 'rejected') {
        const mine = await api.myJoin().catch(() => null) || { status };
        const canApply = mine.can_apply !== false;
        actions.edit = b => busy(b, () => startJoin(sess, mine));
        /* Google Play: anyone who can make an account in the app can delete it there too */
        actions.delreq = () => openSheet('Delete my request', `<p style="margin-bottom:10px">This deletes your RWB join request and your sign-in (<b>${esc(sess.email)}</b>) from RWB. The admins won't see your request any more.</p>
            <p class="small muted" style="margin-bottom:14px">You can always apply again later at roninwb.in/join.</p>
            <button class="btn danger block" data-x="del">Delete my request</button><button class="btn ghost block" data-x="no" style="margin-top:8px">Keep it</button>`, body => {
            body.querySelector('[data-x=no]').onclick = () => closeSheet();
            body.querySelector('[data-x=del]').onclick = e => busy(e.currentTarget, async () => {
                await api.deleteMyAccount('Deleted their join request'); closeSheet();
                await api.signOut().catch(() => {}); try { sessionStorage.removeItem('rwb-join'); } catch { /* ignore */ }
                toast('Your request and sign-in are deleted'); boot();
            });
        });
        const I = { pending: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
            hold: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/></svg>',
            rejected: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>' };
        const S = {
            pending: { h: 'Request sent', lead: 'Your request is with the RWB admins. They usually check within a day.' },
            hold: { h: 'On hold', lead: 'The RWB admins have paused your request for now.' },
            rejected: { h: 'Not approved', lead: canApply ? 'The RWB admins couldn\'t approve your request this time.' : 'The RWB admins couldn\'t approve your request.' }
        }[status];
        const steps = status === 'rejected' ? '' : `<ol class="jx-steps">
            <li class="done"><i aria-hidden="true"></i><span><b>Request sent</b><small>${ago(mine.created_at) || 'Done'}</small></span></li>
            <li class="${status === 'hold' ? 'paused' : 'now'}"><i aria-hidden="true"></i><span><b>Admin check</b><small>${status === 'hold' ? 'On hold' + (mine.decided_at ? ' · ' + ago(mine.decided_at) : '') : 'Usually within a day'}</small></span></li>
            <li><i aria-hidden="true"></i><span><b>Welcome to RWB</b><small>The app opens with ${esc(sess.email)}</small></span></li></ol>`;
        const note = status === 'hold' && mine.hold_note ? ['Note from the admins', mine.hold_note] : status === 'rejected' && mine.reason ? ['Reason', mine.reason] : null;
        const tip = { pending: 'You\'ll get a notification and a WhatsApp message once you\'re approved.', hold: 'Changed something, or got your Ronin? Update your answers and the request goes back to the admins.',
            rejected: canApply ? 'If things have changed, or you think this was a mistake, you can apply again.' : 'You can\'t send a new request. If you think this is a mistake, contact RWB.' }[status];
        const btns = { pending: '<button class="btn block" data-act="recheck">Check again</button><button class="btn ghost block" data-act="edit">Edit my answers</button>',
            hold: '<button class="btn block" data-act="edit">Update my answers</button><a class="btn ghost block" href="${RWB_IG_DM}" target="_blank" rel="noopener">Contact RWB</a>',
            rejected: (canApply ? '<button class="btn block" data-act="edit">Apply again</button>' : '') + `<a class="btn ${canApply ? 'ghost ' : ''}block" href="${RWB_IG_DM}" target="_blank" rel="noopener">Contact RWB</a>` }[status];
        const links = { pending: '<a class="link-btn" href="${RWB_IG_DM}" target="_blank" rel="noopener">Contact RWB</a><span aria-hidden="true">·</span><button class="link-btn" data-act="out">Sign out</button>',
            hold: '<button class="link-btn" data-act="recheck">Check again</button><span aria-hidden="true">·</span><button class="link-btn" data-act="out">Sign out</button>',
            rejected: '<button class="link-btn" data-act="out">Sign out</button>' }[status];
        app.innerHTML = `${demoBar()}<section class="jx ${status}">
            <div class="jx-hero"><div class="jx-ico" aria-hidden="true">${I[status]}</div><h1>${S.h}</h1><p class="jx-lead">${S.lead}</p></div>
            ${steps}
            ${note ? `<div class="jx-note"><span>${note[0]}</span><b>${esc(note[1])}</b></div>` : ''}
            <p class="jx-tip">${tip}</p>
            <div class="jx-actions">${btns}</div>
            <p class="jx-links">${links}</p>
            <p class="jx-links jx-del"><button class="link-btn" data-act="delreq">Delete my request</button></p>
            <p class="jx-acct"><span class="jx-dot" aria-hidden="true"></span>${esc(sess.email)}</p></section>`;
        return;
    }
    /* came from roninwb.in/join: straight to the form */
    if (JOIN_MODE && !noJump) return startJoin(sess);
    actions.join = b => busy(b, () => startJoin(sess));
    app.innerHTML = `${demoBar()}<section class="signin no-acct"><img src="icons/app-icon-256.webp" alt="">
        <div><h1>No Account Found!</h1><p class="lead">There's no RWB membership for <b>${esc(sess.email)}</b>.</p></div>
        <div class="card na-card na-join"><b class="na-h">New to RWB?</b><p class="small muted">Every rider is welcome, with or without a Ronin. It takes about 3 minutes.</p>
            <button type="button" class="btn block" data-act="join">Join RWB</button></div>
        <form class="card na-card na-find" id="naf" novalidate>
            <b class="na-h">Already in RWB? Find your account</b>
            <p class="small muted">Enter the WhatsApp number and VRN you joined RWB with.</p>
            <label>WhatsApp No.<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98300 11111" required></label>
            <label>VRN<input name="vrn" autocapitalize="characters" autocomplete="off" placeholder="WB02AB1234" required></label>
            <button class="btn block" data-x="find">Find my email</button>
            <div id="na-out" hidden></div>
        </form>
        <div class="card na-card"><p>Still stuck? <a class="linkish" href="${RWB_IG_DM}" target="_blank" rel="noopener">Contact RWB</a> on Instagram to know your registered email.</p></div>
        <div class="card na-card"><p>Family of an RWB member? <button type="button" class="linkish" data-act="fam-join">Join RWB FAM with an invite code</button></p></div>
        <button class="btn ghost block" data-act="out">Use a different Google account</button></section>`;
    bindFindAccount(sess);
}
/* "No Account Found!": find the email you joined with (a hint), or verify with your date of birth and use this Google account */
function bindFindAccount(sess) {
    const f = $('#naf'), out = $('#na-out');
    const read = () => ({ phone: f.phone.value.replace(/\D/g, '').slice(-10), vrn: f.vrn.value.toUpperCase().replace(/[^A-Z0-9]/g, '') });
    const check = v => v.phone.length !== 10 ? 'Enter your 10-digit WhatsApp number' : v.vrn.length < 6 ? 'Enter your full VRN, e.g. WB02AB1234' : '';
    const verifyForm = (lead = '', moving = false) => `${lead}<div class="na-verify"><b class="na-h">Can't use that email?</b>
        <p class="small muted">Verify with your date of birth and continue with the Google account you're signed in with (<b>${esc(sess.email)}</b>). It becomes your RWB email.${moving ? ' Your other Google account will no longer open the RWB App, and the admins are told.' : ''}</p>
        <label>Date of birth<input type="date" name="dob" max="${todayISO()}"></label>
        <button type="button" class="btn ghost block" data-x="claim">Verify &amp; continue</button></div>`;
    f.onsubmit = e => {
        e.preventDefault(); const v = read(), err = check(v); if (err) return toast(err, true);
        busy(f.querySelector('[data-x=find]'), async () => {
            const r = await api.findMyEmail(v.phone, v.vrn); out.hidden = false;
            if (!r?.found) { out.innerHTML = '<p class="warn small">No RWB member found with that WhatsApp number and VRN. Check both and try again, or contact RWB on Instagram.</p>'; return; }
            if (r.on_app) { out.innerHTML = `<div class="na-hint"><span class="small muted">This membership is already on the app with</span><b>${esc(r.hint || 'another email')}</b></div>
                <button type="button" class="btn block" data-x="switch">Sign in with that account</button>` + verifyForm('', true); }
            else out.innerHTML = (r.hint ? `<div class="na-hint"><span class="small muted">You joined RWB with</span><b>${esc(r.hint)}</b></div>
                <button type="button" class="btn block" data-x="switch">Sign in with that account</button>` : '') + verifyForm(r.hint ? '' : '<p class="small muted">There\'s no email on your RWB record.</p>');
            const sw = out.querySelector('[data-x=switch]'); if (sw) sw.onclick = () => busy(sw, async () => { await api.signOut(); await api.signIn(); });
            const cl = out.querySelector('[data-x=claim]');
            if (cl) cl.onclick = () => { const dob = out.querySelector('[name=dob]').value, v2 = read(), err2 = check(v2);
                if (err2) return toast(err2, true); if (!dob) return toast('Enter your date of birth', true);
                busy(cl, async () => { const res = await api.claimMembership(v2.phone, v2.vrn, dob);
                    if (!res?.ok) return toast('Those details don\'t match your RWB record. Check your date of birth, or contact RWB on Instagram.', true);
                    toast(`Welcome${res.name ? ', ' + res.name : ''}! You're in. 🏍️`); boot(); }); };
        });
    };
}
async function joinHelpSheet(sess, status = '') {
    const list = await api.joinHelpAdmins().catch(() => []);
    const msg = a => status === 'pending' || status === 'hold' || status === 'rejected'
        ? `Hi ${a.first_name}, I'm ${sess.name || 'a rider'}. I sent an RWB join request in the RWB App with ${sess.email}${status === 'hold' ? ' and it\'s on hold' : status === 'rejected' ? ' and it wasn\'t approved' : ''}. Could you help me with it?`
        : `Hi ${a.first_name}, I'm ${sess.name || 'an RWB member'}. I signed in to the RWB App with ${sess.email}, but it says No Account Found. Could you tell me which email I registered with?`;
    openSheet('WhatsApp the Admins', `<p class="small muted" style="margin-bottom:10px">Choose an admin. ${status && status !== 'not_found' ? 'They\'ll help you with your join request.' : 'They\'ll tell you the email you joined with, so you can sign in with it.'}</p>
        <div class="group">${list.length ? list.map(a => `<div class="bike-row"><span class="g-ico">🛡️</span><span class="grow"><b>${esc(a.first_name)}</b><span class="small muted">RWB admin</span></span>
            <a class="btn sm wa" target="_blank" rel="noopener" href="${waTo(a.phone, msg(a))}">WhatsApp</a></div>`).join('') : '<p class="small muted" style="padding:12px">Could not load the admins. Please try again, or message RWB on Instagram.</p>'}</div>`);
}

/* =================== Home =================== */
const ICON = {
    fuel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="ac" x="7" y="6.5" width="5" height="4" rx=".8"/><path d="M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5v15M3.5 20.5h12M14 9h2a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8.5L18 6"/><rect x="7" y="6.5" width="5" height="4" rx=".8"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M3.5 4.5a1 1 0 0 1 1-1h7.1l3.2 3.2L3.5 15.6z"/><path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1l8.9 8.9-8.1 8.1z"/><circle cx="8" cy="8" r="1.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M6.5 3H9v15H6.5A1.5 1.5 0 0 0 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M5 19.5v-15A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zm0 0A1.5 1.5 0 0 0 6.5 21H19M12 7.5h4M12 10.5h3"/></svg>',
    helmet: '<svg viewBox="0 0 24 24"><path d="M3 15a9 9 0 0 1 18 0v2H3zM12 6v5h9M3 17l1 3h8"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    chev: '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
    out: '<svg viewBox="0 0 24 24" class="chev"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M9.5 14.5h5v6h-5z"/><path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z"/></svg>',
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M6.3 8h14.2l-1.8 6.7a1.6 1.6 0 0 1-1.6 1.2h-8a1.6 1.6 0 0 1-1.6-1.3z"/><path d="M3 4h2.2l2.3 10.6a1.6 1.6 0 0 0 1.6 1.3h8a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6.3"/><circle cx="10" cy="19.8" r="1.3"/><circle cx="17" cy="19.8" r="1.3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M5.5 5h13a2 2 0 0 1 2 2v3h-17V7a2 2 0 0 1 2-2z"/><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><rect x="7.5" y="13.5" width="3" height="3" rx=".7"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5V10H3z"/><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M8 14h8M8 17h5"/></svg>',
    approve: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M12 3l7.5 2.8v5.7c0 4.6-3.2 7.7-7.5 9-4.3-1.3-7.5-4.4-7.5-9V5.8z"/><path d="M12 3l7.5 2.8v5.7c0 4.6-3.2 7.7-7.5 9-4.3-1.3-7.5-4.4-7.5-9V5.8z"/><path d="m8.8 12.2 2.2 2.2 4.4-4.6"/></svg>',
    members: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ac" cx="9" cy="8" r="3"/><circle cx="9" cy="8" r="3"/><path d="M3.5 19.5c.5-3.5 2.6-5.7 5.5-5.7s5 2.2 5.5 5.7M15 5.3a3 3 0 0 1 0 5.4M17 14.2c1.9.6 3.2 2.5 3.5 5.3"/></svg>',
    cake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M5 14a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1.5c-1.2 1-2.3 1-3.5 0s-2.3-1-3.5 0-2.3 1-3.5 0-2.3-1-3.5 0z"/><path d="M4 20.5h16M5 20.5V14a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6.5M5 15.5c1.2-1 2.3-1 3.5 0s2.3 1 3.5 0 2.3-1 3.5 0 2.3 1 3.5 0M8 12V9.5M12 12V9.5M16 12V9.5M8 7.2c-.7-.6-.7-1.5 0-2.2.7.7.7 1.6 0 2.2zM12 7.2c-.7-.6-.7-1.5 0-2.2.7.7.7 1.6 0 2.2zM16 7.2c-.7-.6-.7-1.5 0-2.2.7.7.7 1.6 0 2.2z"/></svg>',
    mega: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M4 10v4h3l7 4V6L7 10z"/><path d="M4 10v4h3l7 4V6L7 10zM17.5 9a4 4 0 0 1 0 6M8 14.5l1.2 4.5"/></svg>',
    bike: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ac" cx="6" cy="16" r="3.4"/><circle cx="6" cy="16" r="3.4"/><circle cx="18" cy="16" r="3.4"/><path d="m6 16 4-6h4.5l3.5 6M10 10 8.6 7H6.5M14.5 10l1.6-3H19"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 3.8 2.8 19.5h18.4zM12 10v4.2M12 16.9v.1"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M6 16.5V11a6 6 0 0 1 12 0v5.5z"/><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M13.5 3v4.5H18z"/><path d="M6.5 3h7L18 7.5V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM13.5 3v4.5H18M8.5 12.5h7M8.5 16h5"/></svg>',
    terms: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M13.5 3v4.5H18z"/><path d="M6.5 3h7L18 7.5V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM13.5 3v4.5H18M8.8 14.2l2 2 4-4.2"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ac" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9M12 17.2v.1"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ac" cx="9" cy="8" r="3.2"/><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.5-3.6 2.6-5.8 5.5-5.8 1.3 0 2.4.4 3.3 1.2M14.5 20l.4-2.4 4.6-4.6a1.3 1.3 0 0 1 1.9 1.9l-4.6 4.6z"/></svg>'
};
const DOC_ICON = ICON.folder;

/* the newest odometer reading: from whichever entry (service or fill-up) has the latest date */
function latestOdo(services = [], fuel = []) {
    const me = state.me || {}, manual = me.odo_km != null && me.odo_date ? [{ km: me.odo_km, d: me.odo_date, src: 'update', manual: true }] : [];
    const all = [...manual, ...services.map(s => ({ km: s.odometer_km, d: s.service_date, src: 'service' })), ...fuel.map(f => ({ km: f.odometer_km, d: f.fill_date, src: 'fill-up' }))]
        .filter(x => x.km > 0).sort((a, b) => b.d.localeCompare(a.d) || b.km - a.km);
    return all[0] || null;
}

function odoSheet() {
    const cur = latestOdo(state.services || [], state.fuel || []);
    openSheet('Update odometer', `<form id="of">
        <p class="small muted">Enter the km shown on your bike's odometer right now. It shows on Home and the leaderboard, and fills in by itself next time you add fuel or a service.</p>
        <label>Odometer (km)<input type="number" name="km" required min="0" max="2000000" inputmode="numeric" value="${cur?.km ?? ''}" autofocus></label>
        ${cur ? `<p class="small muted">Last reading: ${km(cur.km)} on ${fmtDayMonth(cur.d)}</p>` : ''}
        <button class="btn block">Save</button></form>`, body => {
        const f = body.querySelector('#of'); setTimeout(() => f.km.select(), 50);
        f.onsubmit = e => {
            e.preventDefault(); const v = Math.round(Number(f.km.value));
            if (cur && v < cur.km && !confirmBox(`${km(v)} is lower than your last reading (${km(cur.km)}). Save anyway?`)) return;
            busy(e.submitter, async () => { const m = await api.updateMe({ odo_km: v, odo_date: todayISO() }); Object.assign(state.me, m || { odo_km: v, odo_date: todayISO() }); state.board = null; closeSheet(); render(); toast('Odometer updated'); });
        };
    });
}
function syncKmpl(fuel) {
    if (!state.me || !fuel) return;
    const ms = mileageStats(fuel), v = ms.avg && ms.avg >= 5 && ms.avg <= 120 ? Math.round(ms.avg * 100) / 100 : null, t = ms.tanks.length;
    const cur = state.me.avg_kmpl == null ? null : Number(state.me.avg_kmpl);
    if (cur === v && (state.me.kmpl_tanks ?? 0) === t) return;
    Object.assign(state.me, { avg_kmpl: v, kmpl_tanks: t }); state.board = null; state.dir = null;
    api.updateMe({ avg_kmpl: v, kmpl_tanks: t }).catch(() => { /* boards catch up next time */ });
}
const currentOdo = () => latestOdo(state.services || [], state.fuel || [])?.km ?? '';

/* ---------- next service, from the TVS Ronin service chart (owner's manual) ----------
   1st free: 750–1,000 km or 30–45 days · 2nd free: 5,500–6,000 km or 6 months · 3rd free: 11,500–12,000 km or 12 months
   then every 6,000 km or 6 months, whichever comes first. Worked out automatically; riders can't edit it. */
const addMonths = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = (m - 1) + n, Y = y + Math.floor(t / 12), M = ((t % 12) + 12) % 12; const last = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate(); return `${Y}-${String(M + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };   /* pure date maths: no time-zone slips */
const ORD = ['1st', '2nd', '3rd'];
function nextService(services = [], odo = 0) {
    const last = [...services].filter(s => s.odometer_km > 0).sort((a, b) => b.service_date.localeCompare(a.service_date) || b.odometer_km - a.odometer_km)[0];
    let r;
    if (!last) {
        r = odo < 1000 ? { km: 1000, base: 0, label: '1st free service', date: null }
            : { km: Math.ceil((odo + 1) / 6000) * 6000, base: Math.floor(odo / 6000) * 6000, label: 'Next service', date: null, guess: true };
    } else {
        const b = last.odometer_km, n = last.service_type === 'free' && last.service_no ? last.service_no : b < 3000 ? 1 : b < 9000 ? 2 : b < 15000 ? 3 : 4;
        if (n === 1) r = { km: 6000, date: addMonths(last.service_date, 5), label: '2nd free service' };
        else if (n === 2) r = { km: Math.max(b + 6000, 11500), date: addMonths(last.service_date, 6), label: '3rd free service' };
        else r = { km: b + 6000, date: addMonths(last.service_date, 6), label: 'Regular service' };
        r.base = b; r.from = last.service_date;
    }
    r.kmLeft = r.km - odo;
    r.daysLeft = r.date ? Math.round((new Date(r.date) - new Date(todayISO())) / 864e5) : null;
    const pk = r.km > r.base ? (odo - r.base) / (r.km - r.base) : 1;
    const pd = r.date && r.from ? 1 - r.daysLeft / Math.max(1, Math.round((new Date(r.date) - new Date(r.from)) / 864e5)) : 0;
    r.p = Math.min(1, Math.max(0, pk, pd));
    r.status = r.kmLeft <= 0 || (r.daysLeft != null && r.daysLeft <= 0) ? 'due' : r.kmLeft <= 500 || (r.daysLeft != null && r.daysLeft <= 15) ? 'soon' : '';
    return r;
}
function dueText(n) {
    if (n.status === 'due') return n.kmLeft <= 0 ? `Service due. It was due at ${km(n.km)}` : `Service due. It was due on ${fmtDayMonth(n.date)}`;
    const byKm = `<b>${km(n.kmLeft)}</b>`, byDate = n.date ? `<b>${n.daysLeft} day${n.daysLeft === 1 ? '' : 's'}</b>` : '';
    return `${n.label} in ${byKm}${byDate ? ` or ${byDate}` : ''}`;
}

/* the instrument-cluster card: odometer in the middle (tap to update), the ring fills up as the next service comes closer */
function cluster(services, fuel) {
    const last = latestOdo(services, fuel), odo = last?.km || 0;
    const ms = mileageStats(fuel), yr = String(new Date().getFullYear());
    const spent = services.filter(s => s.service_date.startsWith(yr)).reduce((a, s) => a + Number(s.cost || 0), 0);
    const n = nextService(services, odo), p = odo ? n.p : 0, state_ = odo ? n.status : '';
    const cap = !odo ? 'Tap the dial and enter the km on your bike' : dueText(n);
    const alert = state_ ? `<div class="svc-alert ${state_}"><span class="svc-dot"></span><span class="grow"><b>${state_ === 'due' ? 'Service due' : 'Service due soon'}</b><span>${n.label} · at ${km(n.km)}${n.date ? ` or by ${fmtDayMonth(n.date)}` : ''}, whichever comes first</span></span><button class="btn sm" data-act="add-service">Log it</button></div>` : '';
    const R = 52, C = 2 * Math.PI * R, ARC = C * 0.75;      /* a 270° dial, like a tachometer */
    return `<section class="cluster ${state_}">
        <div class="cl-bike"><span>${esc(state.me.bike || 'My bike')}</span>${state.me.vrn ? `<span class="cl-vrn">${esc(state.me.vrn)}</span>` : ''}</div>
        <button class="dial" data-act="odo" aria-label="Odometer ${odo ? odo.toLocaleString('en-IN') + ' km' : 'not recorded yet'}. Tap to update">
            <svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="${R}" stroke-dasharray="${ARC} ${C}"/>
                <circle class="fill" cx="60" cy="60" r="${R}" stroke-dasharray="${(ARC * p).toFixed(1)} ${C}"/></svg>
            <div class="dial-read"><b>${odo ? odo.toLocaleString('en-IN') : '–'}</b><span>${last ? `km, ${last.manual ? 'updated' : `from your`} ${fmtDayMonth(last.d)}${last.manual ? '' : ' ' + last.src}` : 'tap to enter km'}</span><i class="dial-edit">Tap to update</i></div>
        </button>
        ${alert || `<p class="cl-cap">${cap}</p>`}
        <div class="cl-row">
            <div><b>${ms.avg ? ms.avg.toFixed(1) : '–'}</b><span>km/l average</span></div>
            <div><b>${ms.cpk ? '₹' + ms.cpk.toFixed(2) : '–'}</b><span>fuel per km</span></div>
            <div><b>${rs(spent)}</b><span>service in ${yr}</span></div>
        </div>
    </section>`;
}

/* =================== My Ride: parts and accessories tracker ===================
   Wear parts: life from the TVS Ronin owner's manual where it gives one (oil and oil filter 6,000 km / 6 months, air filter
   and spark plug 12,000 km, brake fluid 21,000 km / 2 years, chain lube about every 500 km, fork oil 36,000 km), otherwise
   typical figures for this class of bike. Every figure can be changed per part. */
const PI = {   /* part icons */
    tyre: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
    drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    chain: '<rect x="2.5" y="9" width="9" height="6" rx="3"/><rect x="12.5" y="9" width="9" height="6" rx="3"/><path d="M9 12h6"/>',
    disc: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 5.5v.1M18.5 12h-.1M12 18.5v-.1M5.5 12h.1M16.6 7.4l-.1.1M7.4 16.6l.1-.1"/>',
    air: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
    plug: '<path d="M10 2.5h4v4h-4zM9 6.5h6l-1 5h-4zM12 11.5v4M10.5 15.5h3l-1.5 6z"/>',
    batt: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5h3v2M14 7V5h3v2M7.5 13h3M15 11.5v3M13.5 13h3"/>',
    cable: '<path d="M4 20c4-1 4-7 8-8s4-7 8-8"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="4" r="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/><circle cx="12" cy="12" r="6.5"/>',
    fork: '<path d="M8 3v11a4 4 0 0 0 8 0V3M8 8h8"/><path d="M12 18v3"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>'
};
const pIco = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${PI[k] || PI.star}</svg>`;
/* brand and product lists (pick from these, or "Other" to type your own) */
const OIL_BRANDS = ['TVS TRU4 Fully Synthetic', 'TVS TRU4 Semi Synthetic', 'Motul 7100 4T', 'Motul 5100 4T', 'Motul 3100 Gold 4T', 'Motul 300V Factory Line', 'Motul H-Tech 100 4T',
    'Idemitsu IRG7', 'Idemitsu IRG5', 'Idemitsu IRG3', 'Castrol Power1 Ultimate', 'Castrol Power1 4T', 'Castrol Activ 4T', 'Liqui Moly Motorbike 4T Synth Street Race', 'Liqui Moly Motorbike 4T Street',
    'Shell Advance Ultra', 'Shell Advance AX7', 'Mobil 1 Racing 4T', 'Mobil Super Moto', 'Gulf Syntrac 4T', 'Gulf Pride 4T Plus', 'Eneos Racing', 'Repsol Moto Racing 4T', 'Ipone Stroke 4',
    'Valvoline Champ 4T', 'Amsoil Metric Motorcycle Oil', 'IndianOil Servo 4T Synth', 'HP Racer4', 'Petronas Sprinta F900'],
    TYRE_BRANDS = ['TVS Eurogrip Remora (stock)', 'TVS Eurogrip Protorq Extreme', 'TVS Eurogrip Roadhound', 'TVS Eurogrip Trailhound', 'MRF Revz', 'MRF Zapper', 'CEAT Zoom Rad X1', 'CEAT Zoom Cruz',
    'Apollo Tramplr XR', 'Apollo Tramplr ST', 'Apollo Alpha H1', 'Reise TourR', 'Reise TrailR', 'Reise TorqR', 'Michelin Road 6', 'Michelin Pilot Street 2', 'Michelin Anakee Street',
    'Pirelli Diablo Rosso III', 'Pirelli Angel GT II', 'Pirelli Scorpion Trail II', 'Metzeler Sportec M9 RR', 'Metzeler Tourance Next 2', 'Metzeler Roadtec 02', 'Bridgestone Battlax BT46',
    'Continental ContiRoadAttack 4', 'Dunlop Sportmax Roadsmart IV', 'Maxxis Victra'],
    PAD_BRANDS = ['TVS genuine', 'Brembo', 'EBC (organic)', 'EBC Sintered HH', 'Vesrah', 'Rolon', 'Ferodo Platinum', 'Ferodo Sinter Grip', 'SBS', 'Galfer', 'Bendix', 'Endurance'],
    CHAIN_BRANDS = ['TVS genuine', 'Rolon O-ring', 'Rolon Gold', 'DID 520 VX3', 'DID 520 ERV3', 'RK 520 XSO', 'EK 520 SRX2', 'Regina', 'JT Sprockets'],
    LUBE_BRANDS = ['Motul C2 Chain Lube Road', 'Motul C4 Factory Line', 'Motul C3 Off Road', 'Liqui Moly Chain Lube', 'Liqui Moly Chain Spray White', 'Castrol Chain Spray O-R', 'Muc-Off Chain Lube',
    'WD-40 Specialist Motorbike Chain Lube', 'Ipone X-Trem Chain Road', 'Shell Advance Chain Lube', 'Gear oil (DIY)'],
    ACC_BRANDS = ['Zana', 'Rynox', 'ViaTerra', 'Autofy', 'Moto Torque', 'Bobo', 'GRS', 'HJG', 'Maddog', 'Hella', 'Philips', 'Osram', 'Givi', 'SW-Motech', 'Barkbusters', 'Quad Lock',
    'Ultimateaddons', 'Raida', 'DSG', 'Carbon Racing', 'Oxford', 'TVS genuine accessory'];
const WEAR = [   /* key, name, icon, typical km, typical days, where the figure comes from, spec hint, brands, service-log words */
    ['engine_oil', 'Engine oil', 'drop', 6000, 180, 'TVS manual: every service', '10W-30', OIL_BRANDS, /engine oil|oil change/i],
    ['oil_filter', 'Oil filter', 'drop', 6000, 180, 'TVS manual: every service', 'Paper element', ['TVS genuine', 'K&N', 'Uno Minda', 'Bosch', 'Hiflofiltro'], /oil filter/i],
    ['chain_lube', 'Chain lube', 'chain', 500, null, 'TVS manual: about every 500 km', 'Spray', LUBE_BRANDS, /chain (clean|lube|lubric)/i],
    ['rear_tyre', 'Rear tyre', 'tyre', 18000, null, 'Typical; depends on riding and load', '130/70-17', TYRE_BRANDS, /rear tyre|rear tire|tyre change|new tyre/i],
    ['front_tyre', 'Front tyre', 'tyre', 25000, null, 'Typical; depends on riding', '110/70-17', TYRE_BRANDS, /front tyre|front tire/i],
    ['front_pads', 'Front brake pads', 'disc', 15000, null, 'Typical; check pad thickness at service', 'Sintered / organic', PAD_BRANDS, /front (brake )?pad|brake pad/i],
    ['rear_pads', 'Rear brake pads', 'disc', 20000, null, 'Typical; check pad thickness at service', 'Sintered / organic', PAD_BRANDS, /rear (brake )?pad/i],
    ['chain_kit', 'Chain & sprockets', 'chain', 20000, null, 'Typical with regular lube', 'O-ring 520', CHAIN_BRANDS, /chain (kit|set|sprocket)|sprocket/i],
    ['air_filter', 'Air filter', 'air', 12000, 365, 'TVS manual: 12,000 km; sooner if dusty', 'Paper element', ['TVS genuine', 'K&N', 'BMC', 'DNA', 'Uno Minda', 'Pipercross'], /air filter/i],
    ['spark_plug', 'Spark plug', 'plug', 12000, 365, 'TVS manual: 12,000 km or 1 year', '', ['TVS genuine', 'NGK', 'NGK Iridium IX', 'Denso Iridium Power', 'Bosch'], /spark plug/i],
    ['brake_fluid', 'Brake fluid', 'drop', 21000, 730, 'TVS manual: 21,000 km or 2 years', 'DOT 4', ['TVS genuine DOT 4', 'Motul DOT 4', 'Motul RBF 600', 'Castrol React Performance DOT 4', 'Liqui Moly DOT 4', 'Bosch DOT 4'], /brake fluid|brake oil/i],
    ['battery', 'Battery', 'batt', null, 1095, 'Typical: about 3 years', '12 V 6 Ah', ['TVS genuine', 'Exide Xplore', 'Amaron Pro Bike Rider', 'Bosch', 'Livguard', 'Yuasa', 'SF Sonic'], /battery/i],
    ['clutch_cable', 'Clutch cable', 'cable', 20000, null, 'Typical; replace if frayed or stiff', '', ['TVS genuine', 'Uno Minda', 'Rolon', 'Local'], /clutch cable/i],
    ['throttle_cable', 'Accelerator cable', 'cable', 25000, null, 'Typical; replace if frayed or sticky', '', ['TVS genuine', 'Uno Minda', 'Rolon', 'Local'], /(accelerator|throttle) cable/i],
    ['clutch_plates', 'Clutch plates', 'gear', 30000, null, 'Typical; replace if the clutch slips', '', ['TVS genuine', 'Rolon', 'EBC', 'FCC'], /clutch plate/i],
    ['fork_oil', 'Front fork oil', 'fork', 36000, null, 'TVS manual: 36,000 km, if needed', '', ['TVS genuine', 'Motul Fork Oil Expert 10W', 'Motul Fork Oil Factory Line', 'Liqui Moly Fork Oil 10W', 'Castrol Fork Oil'], /fork oil/i]
].map(([key, name, ico, km, days, src, spec, brands, re]) => ({ key, name, ico, km, days, src, spec, brands, re }));
const ACCS = [['nav', 'Navigation screen / phone mount'], ['crash_guard', 'Crash guard'], ['bash_plate', 'Bash plate'], ['saddle_stay', 'Saddle stay'], ['top_rack', 'Top rack'],
    ['top_box', 'Top box'], ['saddle_bags', 'Saddle bags'], ['tank_bag', 'Tank bag'], ['knuckle_guards', 'Knuckle guards'], ['handlebar', 'Handlebar'], ['exhaust', 'Exhaust'],
    ['aux_lights', 'Aux / fog lights'], ['windscreen', 'Windscreen / visor'], ['seat', 'Seat / seat cover'], ['tank_pad', 'Tank pad'], ['usb_charger', 'USB charger'],
    ['mirrors', 'Mirrors'], ['grips', 'Handlebar grips'], ['levers', 'Brake & clutch levers'], ['frame_sliders', 'Frame sliders'], ['tail_tidy', 'Tail tidy'], ['horn', 'Horn'], ['dashcam', 'Dash cam']]
    .map(([key, name]) => ({ key, name }));
const wearOf = k => WEAR.find(w => w.key === k), accName = p => p.name || ACCS.find(a => a.key === p.part)?.name || 'Accessory';
const partName = p => p.kind === 'acc' ? accName(p) : (wearOf(p.part)?.name || p.name || 'Part');
/* how much of its life a part has used: the larger of distance and time */
function partWear(p, odo) {
    const usedKm = p.installed_km != null && odo ? Math.max(0, odo - p.installed_km) : null;
    const usedDays = p.installed_on ? Math.max(0, Math.round((Date.parse(todayISO()) - Date.parse(p.installed_on)) / 864e5)) : null;
    const pk = p.life_km && usedKm != null ? usedKm / p.life_km : null, pd = p.life_days && usedDays != null ? usedDays / p.life_days : null;
    const pc = Math.max(pk ?? 0, pd ?? 0), known = pk != null || pd != null;
    const lvl = !known ? '' : pc >= 1 ? 'bad' : pc >= .8 ? 'warn' : 'ok';
    const txt = pk != null ? `${km(usedKm).replace(' km', '')} / ${km(p.life_km)}` : pd != null ? `${Math.round(usedDays / 30)} of ${Math.round(p.life_days / 30)} months` : '';
    const left = pk != null ? p.life_km - usedKm : null;
    return { pc, known, lvl, txt, usedKm, usedDays, left };
}
/* the newest service record that mentions this part (to suggest it when it isn't tracked yet) */
const fromLog = (w, services) => services.filter(s => (s.items || []).some(i => w.re.test(i)) || w.re.test(s.notes || '')).sort((a, b) => b.odometer_km - a.odometer_km)[0];
const curParts = parts => (parts || []).filter(p => !p.retired_on);
const rideTitle = r => (r?.name || '').trim() || 'My Ride';

function rideWidget(services, fuel, ride) {
    const last = latestOdo(services, fuel), odo = last?.km || 0, ms = mileageStats(fuel);
    const n = nextService(services, odo), state_ = odo ? n.status : '';
    const lastFill = [...fuel].sort((a, b) => b.fill_date.localeCompare(a.fill_date) || b.odometer_km - a.odometer_km)[0];
    const lastSvc = services[0];
    const tracked = curParts(ride?.parts).filter(p => p.kind === 'wear').map(p => ({ p, w: partWear(p, odo) })).filter(x => x.w.known).sort((a, b) => b.w.pc - a.w.pc);
    /* odometer: mechanical-style digit wheels that roll into place */
    const digits = String(Math.max(0, Math.round(odo))).padStart(6, '0').split('');
    const firstReal = digits.findIndex(d => d !== '0');
    const wheels = digits.map((d, i) => `<span class="od-w${odo && i < firstReal ? ' lead' : ''}${i === 5 ? ' unit' : ''}"><span class="od-r" style="--d:${d};--i:${i}">${'0123456789'.split('').map(x => `<i>${x}</i>`).join('')}</span></span>`).join('');
    /* small alert pills: service due, then worn parts */
    const pills = [];
    if (state_) pills.push(`<button class="rw-pill ${state_ === 'due' ? 'bad' : 'warn'}" data-act="add-service">${state_ === 'due' ? 'Service due' : 'Service soon'} · ${km(n.km)}</button>`);
    tracked.filter(x => x.w.lvl === 'bad').forEach(x => pills.push(`<a class="rw-pill bad" href="#ride">${esc(partName(x.p))}: replace</a>`));
    tracked.filter(x => x.w.lvl === 'warn').forEach(x => pills.push(`<a class="rw-pill warn" href="#ride">${esc(partName(x.p))}: ${x.w.left != null ? km(x.w.left) + ' left' : 'nearly due'}</a>`));
    if (!pills.length && odo) pills.push(`<span class="rw-pill ok">${tracked.length ? 'All tracked parts OK' : 'Next: ' + dueText(n).replace(/^[A-Z]/, c => c.toLowerCase())}</span>`);
    /* parts: pages of 3, swipe left and right */
    const pages = []; for (let k = 0; k < tracked.length; k += 3) pages.push(tracked.slice(k, k + 3));
    const row = ({ p, w }) => `<a class="rw-part ${w.lvl}" href="#ride"><span class="rw-ico">${pIco(wearOf(p.part)?.ico)}</span><span class="grow"><span class="rw-pn"><b>${esc(partName(p))}</b><em>${esc(p.brand || '')}</em><span class="rw-km">${w.lvl === 'bad' ? '<b>Replace</b>' : esc(w.txt)}</span></span>
        <span class="rw-bar"><i style="--w:${Math.min(100, Math.round(w.pc * 100))}%"></i></span></span></a>`;
    const partsHtml = ride?.parts === null ? '' : pages.length ? `<div class="rw-car" id="rw-car">${pages.map(pg => `<div class="rw-page">${pg.map(row).join('')}</div>`).join('')}</div>
        ${pages.length > 1 ? `<p class="rw-dots" aria-hidden="true">${pages.map((_, k) => `<i${k ? '' : ' class="on"'}></i>`).join('')}</p>` : ''}`
      : `<a class="rw-empty" href="#ride">${pIco('tyre')}<span class="grow"><b>Track your tyres, oil, chain and brake pads</b><span>See how much life each part has left</span></span>${ICON.chev}</a>`;
    const stat = (ico, b, t) => `<span class="rw-st">${ico}<b>${b}</b>${t ? `<em>${t}</em>` : ''}</span>`;
    return `<section class="cluster ride-w ${state_}">
        <div class="rw-top"><div class="grow"><b class="rw-name">${esc(rideTitle(ride))}</b><span class="rw-bike">${esc(state.me.bike || 'My bike')}${state.me.vrn ? ` · ${esc(state.me.vrn)}` : ''}</span></div>
            <a class="rw-btn" href="#ride">My Ride ${ICON.chev}</a></div>
        <div class="rw-mid"><button class="rw-odo" data-act="odo" aria-label="Odometer ${odo ? odo.toLocaleString('en-IN') + ' km' : 'not recorded yet'}. Tap to update">
            <span class="od-box">${wheels}<span class="od-km">km</span></span>
            <span class="od-sub">${last ? `${last.manual ? 'Updated' : 'From ' + last.src} ${fmtDayMonth(last.d)}` : 'Tap to enter your km'}<i>Update ›</i></span></button>
            ${tracked.length ? (() => { const ok = Math.round(100 * tracked.filter(x => x.w.lvl !== 'bad').length / tracked.length), C = 2 * Math.PI * 21;
                return `<a class="rw-health ${ok >= 80 ? 'ok' : ok >= 50 ? 'warn' : 'bad'}" href="#ride" aria-label="Ride health ${ok}%"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="21" class="t"/><circle cx="25" cy="25" r="21" class="f" style="--c:${C.toFixed(1)};--o:${(C * (1 - ok / 100)).toFixed(1)}"/></svg><b>${ok}<small>%</small></b><span>health</span></a>`; })() : ''}</div>
        <div class="rw-pills">${pills.slice(0, 3).join('')}${pills.length > 3 ? `<a class="rw-pill more" href="#ride">+${pills.length - 3}</a>` : ''}</div>
        <div class="rw-line">${stat(pIco('drop'), ms.avg ? ms.avg.toFixed(1) : '–', 'km/l')}${stat(ICON.fuel, lastFill ? fmtDayMonth(lastFill.fill_date) : '–', lastFill ? Number(lastFill.litres).toFixed(1) + ' L' : '')}${stat(ICON.wrench, lastSvc ? fmtDayMonth(lastSvc.service_date) : '–', lastSvc && odo ? km(Math.max(0, odo - lastSvc.odometer_km)).replace(' km', '') + ' km ago' : '')}</div>
        ${partsHtml}
    </section>`;
}
/* Home dial: swipe pages of parts; the dots follow */
function bindRideWidget() {
    const car = $('#rw-car'), dots = app.querySelectorAll('.rw-dots i'); if (!car || !dots.length) return;
    car.addEventListener('scroll', () => { const k = Math.round(car.scrollLeft / car.clientWidth); dots.forEach((d, i) => d.classList.toggle('on', i === k)); }, { passive: true });
}

/* --- My Ride screen --- */
async function viewRide() {
    const [services, fuel, ride] = await Promise.all([load.services(), load.fuel(), load.ride(true)]);
    if (ride.parts === null) { app.innerHTML = top('My Ride') + `<div class="card empty"><b>My Ride isn't set up yet</b>An admin needs to run setup file 57 (my-ride.sql) in Supabase.</div>`; return; }
    const odo = latestOdo(services, fuel)?.km || 0, cur = curParts(ride.parts);
    const wear = WEAR.map(w => ({ w, p: cur.find(p => p.kind === 'wear' && p.part === w.key) }));
    const tracked = wear.filter(x => x.p).map(x => ({ ...x, s: partWear(x.p, odo) }));
    const health = tracked.filter(x => x.s.known).length ? Math.round(100 * tracked.filter(x => x.s.known && x.s.lvl !== 'bad').length / tracked.filter(x => x.s.known).length) : null;
    const accs = cur.filter(p => p.kind === 'acc');
    const spent = (ride.parts || []).reduce((a, p) => a + Number(p.cost || 0), 0);
    const due = tracked.filter(x => x.s.lvl === 'bad' || x.s.lvl === 'warn').length;
    const C = 2 * Math.PI * 34;
    app.innerHTML = top('My Ride') + `
        <section class="cluster ride-hero">
            <div class="rw-top"><div class="grow"><b class="rw-name">${esc(rideTitle(ride))}</b><span class="rw-bike">${esc(state.me.bike || 'My bike')}${state.me.vrn ? ` · ${esc(state.me.vrn)}` : ''}</span></div>
                <button class="rw-btn" data-act="ride-name">Rename</button></div>
            <div class="rh-row">
                <div class="rh-ring" aria-label="${health == null ? 'Add parts to see ride health' : `Ride health ${health}%`}"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" class="t"/><circle cx="40" cy="40" r="34" class="f ${health == null ? '' : health >= 80 ? 'ok' : health >= 50 ? 'warn' : 'bad'}" style="--c:${C.toFixed(1)};--o:${(C * (1 - (health ?? 0) / 100)).toFixed(1)}"/></svg><b>${health == null ? '–' : `${health}<small>%</small>`}</b><span>health</span></div>
                <div class="rh-facts"><div><b class="num">${odo ? odo.toLocaleString('en-IN') : '–'}</b><span>km on the odometer</span></div>
                    <div><b>${tracked.length}</b><span>part${tracked.length === 1 ? '' : 's'} tracked${due ? ` · <em>${due} need${due === 1 ? 's' : ''} attention</em>` : ''}</span></div>
                    <div><b>${rs(spent)}</b><span>spent on parts and mods</span></div></div>
            </div>
        </section>
        <section class="section"><h2>Wear parts</h2><p class="small muted" style="margin:-4px 0 10px">Life figures come from the TVS Ronin manual where it gives one, otherwise typical figures. Tap a part to set its brand, km and life.</p>
            <div class="group ride-list">${wear.map(({ w, p }) => {
                if (p) { const st = partWear(p, odo); return `<button class="rl-row ${st.lvl}" data-part="${w.key}"><span class="rw-ico">${pIco(w.ico)}</span><span class="grow"><span class="rw-pn"><b>${w.name}</b><em>${esc([p.brand, p.spec].filter(Boolean).join(' · ') || 'Brand not set')}</em></span>
                    ${st.known ? `<span class="rw-bar"><i style="--w:${Math.min(100, Math.round(st.pc * 100))}%"></i></span><span class="rl-sub">${st.lvl === 'bad' ? '<b>Past its life: replace soon</b> · ' : st.lvl === 'warn' ? '<b>Nearly due</b> · ' : ''}${esc(st.txt)}${st.left != null && st.left > 0 ? ` · ${km(st.left)} left` : ''}</span>` : '<span class="rl-sub">Add the km or date it was fitted to track it</span>'}</span>${ICON.chev}</button>`; }
                const hint = fromLog(w, services);
                return `<button class="rl-row add" data-part="${w.key}"><span class="rw-ico">${pIco(w.ico)}</span><span class="grow"><span class="rw-pn"><b>${w.name}</b></span><span class="rl-sub">${hint ? `In your service log at ${km(hint.odometer_km)} · tap to track` : 'Not tracked · tap to add'}</span></span><span class="rl-plus">+</span></button>`; }).join('')}</div></section>
        <section class="section"><h2>Accessories & mods</h2>
            <div class="group ride-list">${accs.map(p => `<button class="rl-row" data-acc="${p.id}"><span class="rw-ico">${pIco('star')}</span><span class="grow"><span class="rw-pn"><b>${esc(accName(p))}</b><em>${esc([p.brand, p.spec].filter(Boolean).join(' · '))}</em></span>
                <span class="rl-sub">${[p.installed_on ? 'Fitted ' + fmtDate(p.installed_on) : '', p.cost ? rs(p.cost) : ''].filter(Boolean).join(' · ') || 'Tap to add details'}</span></span>${ICON.chev}</button>`).join('')}
                <button class="rl-row add" data-act="acc-add"><span class="rw-ico">${pIco('wrench')}</span><span class="grow"><b>Add an accessory or mod</b><span class="rl-sub">Crash guard, top rack, exhaust, aux lights…</span></span><span class="rl-plus">+</span></button></div></section>`;
    actions = {};
    actions['ride-name'] = () => openSheet('Name your ride', `<form id="rnf"><label>Ride name<input name="n" maxlength="40" value="${esc(ride.name || '')}" placeholder="e.g. Black Pearl"></label><p class="small muted">Shows on your Home screen. Only you see it.</p><button class="btn block">Save</button></form>`, b => {
        b.querySelector('#rnf').onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { await api.saveRideName(e.target.n.value.trim()); state.ride = null; closeSheet(); toast('Saved'); render(); }); }; });
    actions['acc-add'] = () => openSheet('Add an accessory', `<div class="acc-pick">${ACCS.map(a => `<button class="chip" data-k="${a.key}">${esc(a.name)}</button>`).join('')}<button class="chip" data-k="custom">Something else…</button></div>`, b =>
        b.querySelectorAll('[data-k]').forEach(c => c.onclick = () => partSheet({ kind: 'acc', part: c.dataset.k, name: c.dataset.k === 'custom' ? '' : null }, odo, ride)));
    app.querySelectorAll('[data-part]').forEach(b => b.onclick = () => { const w = wearOf(b.dataset.part), p = cur.find(x => x.kind === 'wear' && x.part === w.key);
        const hint = !p && fromLog(w, services);
        partSheet(p || { kind: 'wear', part: w.key, life_km: w.km, life_days: w.days, installed_km: hint ? hint.odometer_km : odo || null, installed_on: hint ? hint.service_date : todayISO(), cost: null }, odo, ride, !p && hint); });
    app.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => partSheet(cur.find(x => x.id === Number(b.dataset.acc)), odo, ride));
}
/* add / edit one part; "Replaced it" keeps the old one as history and starts a fresh one */
function partSheet(p, odo, ride, fromHint = null) {
    const w = p.kind === 'wear' ? wearOf(p.part) : null, isNew = !p.id;
    const hist = (ride.parts || []).filter(x => x.retired_on && x.part === p.part && x.kind === p.kind).sort((a, b) => (b.retired_on || '').localeCompare(a.retired_on || ''));
    const title = w ? w.name : p.part === 'custom' ? (p.name || 'Accessory') : accName(p);
    openSheet(title, `<form id="ptf">
        ${fromHint ? `<p class="small banner-lite">Filled in from your service log (${fmtDate(fromHint.service_date)}, ${km(fromHint.odometer_km)}). Check and save.</p>` : ''}
        ${p.kind === 'acc' && p.part === 'custom' ? `<label>What is it?<input name="name" maxlength="60" required value="${esc(p.name || '')}" placeholder="e.g. Fog lamp switch"></label>` : ''}
        ${(() => { const list = w?.brands || ACC_BRANDS, cur = p.brand || '', known = !cur || list.includes(cur);
            return `<label>Brand<select name="brand_pick"><option value="">Choose…</option>${list.map(b => `<option${b === cur ? ' selected' : ''}>${esc(b)}</option>`).join('')}<option value="__other"${known ? '' : ' selected'}>Other (type the name)</option></select></label>
            <label class="pt-other"${known ? ' hidden' : ''}>Brand name<input name="brand_other" maxlength="60" value="${known ? '' : esc(cur)}" placeholder="Type the brand and model"></label>`; })()}
        <label>${w ? 'Grade / size / type' : 'Model'}<input name="spec" maxlength="60" value="${esc(p.spec || '')}" placeholder="${w ? esc(w.spec || '') : 'Model or variant'}"></label>
        <div class="row2"><label>Fitted on<input type="date" name="installed_on" value="${esc(p.installed_on || '')}" max="${todayISO()}"></label>
            <label>At odometer (km)<input type="number" inputmode="numeric" name="installed_km" min="0" value="${p.installed_km ?? ''}" placeholder="${odo || ''}"></label></div>
        <label>Cost (₹)<input type="number" inputmode="decimal" name="cost" min="0" value="${p.cost ?? ''}" placeholder="optional"></label>
        ${w ? `<div class="row2"><label>Expected life (km)<input type="number" inputmode="numeric" name="life_km" min="0" value="${p.life_km ?? ''}" placeholder="${w.km ?? ''}"></label>
            <label>or months<input type="number" inputmode="numeric" name="life_m" min="0" value="${p.life_days ? Math.round(p.life_days / 30) : ''}" placeholder="${w.days ? Math.round(w.days / 30) : ''}"></label></div>
            <p class="small muted" style="margin-top:-6px">${esc(w.src)}${w.km ? ` (${km(w.km)}${w.days ? ` or ${Math.round(w.days / 30)} months` : ''})` : w.days ? ` (${Math.round(w.days / 30)} months)` : ''}. Whichever comes first counts.</p>` : ''}
        <label>Notes<textarea name="notes" maxlength="1000" rows="2" placeholder="Where you bought it, warranty, anything useful">${esc(p.notes || '')}</textarea></label>
        <button class="btn block">${isNew ? 'Save' : 'Save changes'}</button>
        ${!isNew && w ? '<button type="button" class="btn ghost block" data-x="replaced" style="margin-top:8px">I replaced it: start a new one</button>' : ''}
        ${!isNew ? `<button type="button" class="btn ghost block danger" data-x="del" style="margin-top:8px">Remove</button>` : ''}
        ${hist.length ? `<details class="pt-hist"><summary class="small">Earlier ${w ? w.name.toLowerCase() : 'ones'} (${hist.length})</summary>${hist.map(h => `<p class="small"><b>${esc([h.brand, h.spec].filter(Boolean).join(' · ') || title)}</b> · ${h.installed_km != null && h.retired_km != null ? km(h.retired_km - h.installed_km) + ' ridden' : ''}${h.retired_on ? ` · replaced ${fmtDate(h.retired_on)}` : ''}${h.cost ? ` · ${rs(h.cost)}` : ''}</p>`).join('')}</details>` : ''}
    </form>`, b => {
        const f = b.querySelector('#ptf');
        f.brand_pick.onchange = () => { const o = f.querySelector('.pt-other'); o.hidden = f.brand_pick.value !== '__other'; if (!o.hidden) f.brand_other.focus(); };
        const read = () => { const d = Object.fromEntries(new FormData(f)); const num = v => v === '' || v == null ? null : Number(v);
            const brand = d.brand_pick === '__other' ? (d.brand_other || '').trim() : d.brand_pick || '';
            return { ...(p.id ? { id: p.id } : {}), kind: p.kind, part: p.part, name: p.part === 'custom' ? (d.name || '').trim() || null : null, brand: brand || null, spec: (d.spec || '').trim() || null,
                installed_on: d.installed_on || null, installed_km: num(d.installed_km), cost: num(d.cost), notes: (d.notes || '').trim() || null,
                ...(() => { if (!w) return { life_km: null, life_days: null }; const lk = num(d.life_km), lm = num(d.life_m);
                    return lk == null && lm == null ? { life_km: w.km, life_days: w.days } : { life_km: lk, life_days: lm != null ? lm * 30 : null }; })() }; };
        const done = msg => { state.ride = null; closeSheet(); toast(msg); render(); };
        f.onsubmit = e => { e.preventDefault(); const r = read(); if (r.installed_km != null && odo && r.installed_km > odo + 50) return toast(`That's more than your odometer (${km(odo)}). Update the odometer on Home first.`, true);
            busy(e.submitter, async () => { await api.saveRidePart(r); done('Saved'); }); };
        f.querySelector('[data-x=replaced]')?.addEventListener('click', e => busy(e.target, async () => {
            await api.saveRidePart({ id: p.id, retired_on: todayISO(), retired_km: odo || null });
            await api.saveRidePart({ kind: p.kind, part: p.part, brand: p.brand, spec: p.spec, installed_on: todayISO(), installed_km: odo || null, life_km: p.life_km, life_days: p.life_days });
            state.ride = null; closeSheet(); toast(`New ${title.toLowerCase()} started at ${km(odo)}. Edit it to add the brand and cost.`); render(); }));
        f.querySelector('[data-x=del]')?.addEventListener('click', e => { if (confirmBox(`Remove ${title}?`)) busy(e.target, async () => { await api.deleteRidePart(p.id); done('Removed'); }); });
    });
}

/* posts without a page of their own (announcements, blood requests…) open in a window with the full message */
const NEWS_MAP = new Map();
/* Alerts hidden on this phone (swipe left, or Clear). Important ones ask first. */
const IMPORTANT = n => n.kind === 'announcement' || n.kind === 'event';   /* admin announcements and events */
const hiddenNews = () => { try { return new Set(JSON.parse(localStorage.getItem('rwb-news-hidden') || '[]')); } catch { return new Set(); } };
const hideNews = ids => { const h = hiddenNews(); ids.forEach(id => h.add(Number(id))); try { localStorage.setItem('rwb-news-hidden', JSON.stringify([...h].slice(-400))); } catch { /* ignore */ } };
const unhideNews = id => { const h = hiddenNews(); h.delete(Number(id)); try { localStorage.setItem('rwb-news-hidden', JSON.stringify([...h])); } catch { /* ignore */ } };
/* what this phone shows: not hidden, and (important, or newer than the last Clear) */
function visibleNews(list) {
    let clearedAt = 0; try { clearedAt = Number(localStorage.getItem('rwb-feed-cleared') || 0); } catch { /* ignore */ }
    const h = hiddenNews();
    return list.filter(n => !h.has(Number(n.id)) && (IMPORTANT(n) || n.id > clearedAt));
}
function onlyTeamSheet(n) {
    openSheet('Important alert', `<p style="margin-bottom:6px"><b>${esc(n.title)}</b></p><p class="small muted" style="margin-bottom:14px">Only RWB admins and coordinators can remove important alerts (announcements and events). It will go away once an admin removes it or the event is over.</p>
        <button class="btn block" data-x="ok">OK</button>`, body => { body.querySelector('[data-x=ok]').onclick = () => closeSheet(); });
}
function askHideImportant(n, yes0, no0) {
    let done = false; const yes = () => { if (!done) { done = true; yes0(); } }, no = () => { if (!done) { done = true; no0(); } };
    openSheet('Hide this alert?', `<p style="margin-bottom:6px"><b>${esc(n.title)}</b></p><p class="small muted" style="margin-bottom:14px">This is an important ${n.kind === 'event' ? 'event' : 'announcement from the RWB admins'}. It will be hidden on this phone only; it stays for other members.</p>
        <button class="btn danger block" data-x="hide">Yes, hide it</button><button class="btn ghost block" data-x="keep" style="margin-top:8px">Keep it</button>`, body => {
        body.querySelector('[data-x=hide]').onclick = () => { closeSheet(); yes(); };
        body.querySelector('[data-x=keep]').onclick = () => { closeSheet(); no(); };
    });
    /* closing the sheet any other way keeps it */
    const sh = $('#sheet'); if (sh) sh.addEventListener('close', () => no(), { once: true });
}
/* swipe a row to the left to hide it */
function swipeToDismiss(root, after) {
    root.querySelectorAll('[data-swipe]').forEach(el => {
        let x0 = 0, y0 = 0, dx = 0, drag = false, locked = false, pid = null;
        const reset = () => { el.style.transition = 'transform .2s, opacity .2s'; el.style.transform = ''; el.style.opacity = ''; };
        const gone = () => {
            const id = el.dataset.swipe, h = el.offsetHeight;
            el.style.transition = 'transform .2s, opacity .2s'; el.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`; el.style.opacity = '0';
            setTimeout(() => { el.style.transition = 'height .2s, padding .2s, margin .2s'; el.style.height = h + 'px'; el.style.overflow = 'hidden';
                requestAnimationFrame(() => { el.style.height = '0px'; el.style.paddingTop = '0'; el.style.paddingBottom = '0'; el.style.marginTop = '0'; el.style.marginBottom = '0'; }); }, 180);
            setTimeout(() => { hideNews([id]); el.remove(); after?.(); toast('Hidden', false, 'Undo', () => { unhideNews(id); render(); }); }, 420);
        };
        el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; x0 = e.clientX; y0 = e.clientY; dx = 0; drag = true; locked = false; pid = e.pointerId; el.style.transition = ''; });
        el.addEventListener('pointermove', e => {
            if (!drag) return;
            const mx = e.clientX - x0, my = e.clientY - y0;
            if (!locked) { if (Math.abs(mx) < 10 && Math.abs(my) < 10) return; if (Math.abs(my) > Math.abs(mx)) { drag = false; return; } locked = true; try { el.setPointerCapture(pid); } catch { /* ignore */ } el.classList.add('swiping'); }
            dx = mx; el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(1 - Math.min(.55, Math.abs(dx) / el.offsetWidth));
        });
        const end = () => {
            if (!drag) return; drag = false; if (!locked) return;
            el.classList.remove('swiping'); el.dataset.swiped = '1'; setTimeout(() => delete el.dataset.swiped, 400);
            if (Math.abs(dx) < el.offsetWidth * 0.33) return reset();
            const n = NEWS_MAP.get(String(el.dataset.swipe));
            if (n && IMPORTANT(n) && !isMod() && !isFam()) { reset(); onlyTeamSheet(n); }   /* members can't remove announcements or events */
            else if (n && IMPORTANT(n)) { el.style.transform = `translateX(${Math.sign(dx) * el.offsetWidth * 0.33}px)`; askHideImportant(n, gone, reset); } else gone();
        };
        el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
        el.addEventListener('click', e => { if (el.dataset.swiped) { e.preventDefault(); e.stopPropagation(); } }, true);
    });
}
/* "Clear": routine updates only; admin announcements and events stay (swipe them away one by one) */
function clearNews(list) {
    if (isFam()) {
        const all = visibleNews(list); if (!all.length) return;
        openSheet('Clear notifications?', `<p class="small muted" style="margin-bottom:14px">All ${all.length} notification${all.length > 1 ? 's' : ''} will be hidden on this phone. You can't bring them back.</p>
            <button class="btn danger block" data-x="yes">Yes, clear all</button><button class="btn ghost block" data-x="no" style="margin-top:8px">Cancel</button>`, body => {
            body.querySelector('[data-x=no]').onclick = () => closeSheet();
            body.querySelector('[data-x=yes]').onclick = () => { hideNews(all.map(n => n.id)); closeSheet(); render(); toast('Cleared'); };
        });
        return;
    }
    const routine = visibleNews(list).filter(n => !IMPORTANT(n));
    try { localStorage.setItem('rwb-feed-cleared', String(Math.max(0, ...list.map(n => n.id)))); } catch { /* ignore */ }
    hideNews(routine.map(n => n.id));
    render(); toast(routine.length ? 'Cleared. Announcements and events stay.' : (isMod() ? 'Only announcements and events left. Swipe one to hide it.' : 'Only announcements and events left. Admins remove these.'));
}
const linkifyNews = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(?<![\w/])((?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5})(?!\d)/g, m => { const d = m.replace(/\D/g, '').slice(-10); return `<a href="tel:+91${d}">${m}</a> <a class="wa-mini" href="${waTo(d)}" target="_blank" rel="noopener" aria-label="WhatsApp ${d}">WhatsApp</a>`; });
function newsSheet(n) {
    openSheet(n.title, `<p class="small muted" style="margin-bottom:12px"><span class="inl-ico">${KIND_ICON[n.kind] || ICON.mega}</span> ${timeAgo(n.created_at)}${n.audience === 'admins' ? ' · admins only' : n.audience === 'moderators' ? ' · team only' : ''}</p>
        <div class="news-full">${n.body ? linkifyNews(n.body) : '<span class="muted">No details.</span>'}</div>
        <button class="btn ghost block" data-x="share" style="margin-top:16px">Share on WhatsApp</button>`, body => {
        body.querySelector('[data-x=share]').onclick = () => openWA(waShare(`📣 *${n.title}*${n.body ? '\n\n' + n.body : ''}\n\n– RWB App: ${getLink()}`));
    });
}
function newsRow(n, del = false, compact = false) {
    NEWS_MAP.set(String(n.id), n);
    const sw = ` data-swipe="${n.id}"`;
    const href = n.url && n.url.startsWith('#') ? n.url : '#news';
    const own = !n.url || /^#(news|home)?$/.test(n.url);
    const hello = n.kind === 'member' && /say hello to (.+?)!?$/i.exec(n.body || '');
    if (hello && !del) return newsRow({ ...n, kind: 'member' }, true, compact).replace('<a class="news-row', `<a data-act="hello" data-name="${esc(hello[1])}" class="news-row`).replace(/<button class="icon-btn del"[^]*?<\/button>/, ICON.chev);
    const openAttr = own ? ` data-act="news-open" data-nid="${n.id}"` : '';
    if (compact) return `<a class="news-row mini ${n.kind}" href="${esc(href)}"${openAttr}${sw}><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || ICON.mega}</span>
        <span class="grow"><b>${esc(n.title)}</b><span class="news-line">${n.body ? esc(n.body) + ' · ' : ''}${shortAgo(n.created_at)}${n.audience === 'admins' ? ' · admins' : n.audience === 'moderators' ? ' · team' : ''}</span></span>${ICON.chev}</a>`;
    return `<a class="news-row ${n.kind}" href="${esc(href)}"${openAttr}${sw}><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || ICON.mega}</span>
        <span class="grow"><b>${esc(n.title)}</b>${n.body ? `<span class="news-body">${esc(n.body)}</span>` : ''}<span class="small muted">${timeAgo(n.created_at)}${n.audience === 'admins' ? ', admins only' : n.audience === 'moderators' ? ', team only' : ''}</span></span>
        ${del ? `<button class="icon-btn del" data-act="del-news" data-id="${n.id}" aria-label="Delete">✕</button>` : ICON.chev}</a>`;
}

/* What a member still needs to fill in (shown on Home until done) */
/* agreed to the current version of the Terms? (the version is known once setup file 36 is run) */
const TNC_VERSION = window.RWB_TNC?.version || '';
const tncOk = m => m.tnc_agreed === true && (!('tnc_version' in m) || !TNC_VERSION || m.tnc_version === TNC_VERSION);
function missingOf(m) {
    const out = [];
    if ('tnc_agreed' in m && !tncOk(m)) out.push('rules');   /* known once setup file 30 is run */
    if (!m.emergency_phone) out.push('emergency contact');
    if (!m.blood_group) out.push('blood group');
    if (!m.dob) out.push('date of birth');
    if (!m.vrn) out.push('VRN');
    if (!m.locality) out.push('locality');
    if (!m.hideout) out.push('permanent hideout');
    return out;
}
function profileTodo(m) {
    const miss = missingOf(m || {}); if (!miss.length) return '';
    const rules = miss.includes('rules'), rest = miss.filter(x => x !== 'rules');
    return `<a class="banner todo" href="#me"><span class="b-ico">${rules ? ICON.terms : ICON.profile}</span><span class="grow"><b>${rules ? 'Please agree to the RWB Terms & Conditions' : 'Complete your profile'}</b><span class="small muted">${rules && rest.length ? 'And add your ' + rest.join(', ') : rules ? 'Me → Terms & Conditions → Read & agree' : 'Add your ' + rest.join(', ')}</span></span>${ICON.chev}</a>`;
}
async function viewHome() {
    const [services, fuel, bdays, news, listings, docs, evd, ride] = await Promise.all([load.services(), load.fuel(), load.bdays(), load.news(), load.listings().catch(() => []), load.docs(), loadEvents().catch(() => null), load.ride().catch(() => ({ parts: null, name: '' }))]);
    const nextEvt = evd ? evd.events.filter(e => e.status === 'live' && !evtPast(e) && new Date(e.starts_at) - Date.now() < 14 * 864e5)[0] : null;
    const docWarn = docs.map(d => ({ d, st: docStatus(d) })).filter(x => x.st.level === 'bad' || x.st.level === 'warn').sort((a, b) => a.st.days - b.st.days)[0];
    syncKmpl(fuel); whenIdle(() => syncReminders(services, fuel, ride));
    const today = bdays.filter(b => b.day === todayISO());
    /* Fresh on MotoMart: the 4 latest Pre-owned posts first, then RWB Merch, then the other Pre-owned posts,
       then new accessories (the list already comes newest first) */
    const live = listings.filter(l => l.status === 'live'), ofKind = k => live.filter(l => kindOf(l) === k);
    const pre = ofKind('used');
    const fresh = [...pre.slice(0, 4), ...ofKind('merch'), ...pre.slice(4), ...ofKind('new')].slice(0, 10);
    firstNotifAsk();
    let pushAsk = false; try { pushAsk = NATIVE ? !localStorage.getItem(FCM_KEY) && !localStorage.getItem('rwb-push-dismissed') : pushSupported() && Notification.permission === 'default' && !localStorage.getItem('rwb-push-dismissed'); } catch { /* ignore */ }
    const names = today.map(b => b.full_name.split(' ')[0]);
    /* "Clear" hides birthdays, MotoMart and member updates on this phone; admin announcements stay until an admin deletes them */
    const feed = visibleNews(news);
    app.innerHTML = top(`Hi, ${firstName(state.me)}`) + `
        ${rideWidget(services, fuel, ride)}
        <nav class="quick" aria-label="Quick actions">
            <button data-act="add-fuel"><span>${ICON.fuel}</span>Add fuel</button>
            <button data-act="add-service"><span>${ICON.wrench}</span>Log service</button>
            <button data-act="fam" class="fam-q" aria-label="RWB FAM: invite your family"><span>${FAM_ICON}</span>FAM</button>
            <button data-act="sell"><span>${ICON.cart}</span>Sell gear</button>
            <a href="#docs" aria-label="Documents${docsAlert() ? ' (something needs renewing)' : ''}"><span>${DOC_ICON}${docsAlert() ? '<i class="dot dot-red"></i>' : ''}</span>Documents</a>
        </nav>
        ${isAdmin() ? `<section class="admin-dock" aria-label="Admin">
            <div class="ad-head"><b>${ICON.shield} Admin</b><span class="small muted" id="ad-sum"></span><a href="#admin" data-adtab="requests" class="ad-all">Open ›</a></div>
            <div class="ad-grid">
                <a href="#admin" data-adtab="requests"><span class="ad-ico">${ICON.approve}</span>Approvals<i class="ad-n" id="ad-req" hidden></i></a>
                <a href="#admin" data-adtab="members"><span class="ad-ico">${ICON.members}</span>Members</a>
                <a href="#admin" data-adtab="motomart"><span class="ad-ico">${ICON.cart}</span>MotoMart<i class="ad-n" id="ad-mm" hidden></i></a>
                <a href="#admin" data-adtab="bdays"><span class="ad-ico">${ICON.cake}</span>Birthdays</a>
                <a href="#admin" data-adtab="guides"><span class="ad-ico">${ICON.help}</span>Guides</a>
            </div><a class="ad-dupes" href="#admin" data-adtab="dupes" id="ad-dupes" hidden></a><a class="ad-dupes" href="#admin" data-adtab="ai" id="ad-pookie" hidden></a></section>` : isMod() ? `<section class="admin-dock coord-dock" aria-label="Coordinator">
            <div class="ad-head"><b>${ICON.shield} Coordinator</b><span class="small muted" id="ad-sum"></span><a href="#admin" data-adtab="motomart" class="ad-all">Open ›</a></div>
            <div class="ad-grid">
                <a href="#admin" data-adtab="motomart"><span class="ad-ico">${ICON.cart}</span>MotoMart<i class="ad-n" id="ad-mm" hidden></i></a>
                <a href="#admin" data-adtab="ai"><span class="ad-ico">${ICON.chat}</span>Pookie<i class="ad-n" id="ad-ai" hidden></i></a>
                <a href="#admin" data-adtab="reports"><span class="ad-ico">${ICON.alert}</span>Reports<i class="ad-n" id="ad-rep" hidden></i></a>
                <a href="#admin" data-adtab="guides"><span class="ad-ico">${ICON.help}</span>Guides</a>
            </div></section>` : ''}
        ${profileTodo(state.me)}
        ${docWarn ? `<a class="banner doc-warn ${docWarn.st.level}" href="#docs"><span class="b-ico">${ICON.file}</span><span class="grow"><b>${esc(docName(docWarn.d))}</b> ${docWarn.st.days < 0 ? `expired on ${fmtDate(docWarn.d.expiry_date)}` : docWarn.st.days === 0 ? 'expires today' : `expires in ${docWarn.st.days} day${docWarn.st.days === 1 ? '' : 's'}`}. Renew it and update My documents.</span>${ICON.chev}</a>` : ''}
        ${nextEvt ? `<div class="home-evt">${eventCard(nextEvt, evd)}</div>` : ''}
        ${today.length ? `<div class="banner bday"><span class="b-ico">${ICON.cake}</span><span class="grow"><b>${esc(names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0])}</b> ${names.length > 1 ? 'have' : 'has'} a birthday today</span><button class="btn sm wa" data-act="wish">Wish</button></div>` : ''}
        ${pushAsk ? `<div class="banner"><span class="b-ico">${ICON.bell}</span><span class="grow">${isMod() ? 'Get birthdays, MotoMart posts and ride news as notifications' : 'Get ride news, events and MotoMart posts as notifications'}</span><button class="btn sm" data-act="push-on">Turn on</button><button class="icon-btn" data-act="push-later" aria-label="Not now">✕</button></div>` : ''}
        ${vrnCheckCard()}
        ${feed.length ? `<section class="section"><h2>Latest from RWB <span class="h-acts"><button data-act="clear-feed">Clear</button><a href="#news">See all</a></span></h2><div class="group news-mini">${feed.slice(0, 3).map(n => newsRow(n, false, true)).join('')}</div></section>` : ''}
        <section class="section"><h2>Fresh on MotoMart <a href="#motomart">See all</a></h2>
            ${fresh.length ? `<div class="strip">${fresh.map(listingCard).join('')}</div>` : `<a class="group-row-card" href="#motomart"><span class="g-ico">${ICON.tag}</span><span class="grow"><b>Nothing for sale yet</b><span class="small muted">Selling old gear? Post it here for fellow riders.</span></span>${ICON.chev}</a>`}</section>
        ${galSection()}
        <section class="section"><h2>Explore</h2><div class="group">
            <a href="#teach"><span class="g-ico">${ICON.chat}</span><span class="grow"><b>Teach Pookie</b><span class="small muted" id="teach-sub">Answer Pookie's Ronin questions, earn XP and help every rider</span></span>${ICON.chev}</a>
            <a href="#guides/maint"><span class="g-ico">${ICON.book}</span><span class="grow"><b>Maintenance guides</b><span class="small muted">Short videos, PDFs and pictures from the RWB team</span></span>${ICON.chev}</a>
            <a href="#motomart/new"><span class="g-ico">${ICON.helmet}</span><span class="grow"><b>New accessories</b><span class="small muted">Picked by the RWB team, in MotoMart</span></span>${ICON.chev}</a>
            <a href="https://roninwb.in" target="_blank" rel="noopener"><span class="g-ico">${ICON.globe}</span><span class="grow"><b>roninwb.in</b><span class="small muted">Rides, events, gallery and the team</span></span>${ICON.out}</a>
        </div></section>`;
    swipeToDismiss(app, () => { if (!app.querySelector('.news-mini [data-swipe]')) render(); });
    bindVrnCheck(); bindRideWidget(); teachUrgent('#teach-sub'); watchPreviews(app); bindHomeGallery(navN);
    actions = {
        evt: el => location.hash = '#events/' + el.dataset.id,
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); render(); }),
        'push-later': () => { try { localStorage.setItem('rwb-push-dismissed', '1'); } catch { /* ignore */ } render(); },
        sell: () => listingForm(),
        'clear-feed': () => clearNews(news),
        listing: el => location.hash = '#motomart/' + el.dataset.id
    };
    if (isMod() && !isAdmin()) coordDock(listings);
    if (isAdmin()) {
        app.querySelectorAll('[data-adtab]').forEach(a => a.addEventListener('click', () => { state.adminTab = a.dataset.adtab; }));
        api.admin.dupes().then(g => { state.dupes = g; const a = $('#ad-dupes'); if (!a || !g.length) return;
            a.innerHTML = `<span class="b-ico">${ICON.alert}</span><span class="grow"><b>${g.length} possible duplicate${g.length > 1 ? 's' : ''}</b> in the sheet · you choose which entry stays</span>${ICON.chev}`; a.hidden = false;
            app.querySelector('.admin-dock')?.classList.add('busy'); }).catch(() => {});
        api.admin.pookiePending?.().then(n => { pookieBadge(n); const a = $('#ad-pookie'); if (!a || !n) return;
            a.innerHTML = `<span class="b-ico">${ICON.chat}</span><span class="grow"><b>${n} Pookie answer${n > 1 ? 's' : ''}</b> to check · approve what's right</span>${ICON.chev}`; a.hidden = false;
            app.querySelector('.admin-dock')?.classList.add('busy'); }).catch(() => {});
        api.admin.stats().then(s => {
            const mm = listings.filter(l => l.status === 'pending').length, set = (id, n) => { const el = $('#' + id); if (el) { el.textContent = n; el.hidden = !n; } };
            set('ad-req', s.pending); set('ad-mm', mm);
            const sum = $('#ad-sum'); if (sum) sum.textContent = s.pending || mm ? `${s.pending + mm} waiting for you` : `${s.members} members · all clear`;
            const dock = app.querySelector('.admin-dock'); if (dock) dock.classList.toggle('busy', !!(s.pending || mm || state.dupes?.length));
        }).catch(() => {});
    }
}

/* =================== RWB Gallery (Nov 2026): the same photos as roninwb.in's gallery ===================
   Only members and RWB FAM get the full list (a "view" pass, file 81); the website and everyone else get 30 a day.
   The list comes from the RWB Gallery Apps Script (SITE.GALLERY_SCRIPT_URL in js/data.js, source tools/gallery.gs) and the
   photos from Google (lh3.googleusercontent.com), so the gallery never touches Supabase (no egress, no storage).
   The list is kept on the phone (GAL_KEY) and shown at once; a fresh copy is asked for at most every 12 hours.
   Photos are asked for as small WebP copies: ~420 px tall in the strip, 400 px wide in the grid, 1080 px (phones) or 1600 px in the viewer;
   sw.js keeps them on the phone (rwb-gal-img-v1 / rwb-gal-big-v1), so the second look is instant and works offline.
   Admins and coordinators add and delete photos (when SITE.GALLERY_EDIT is on): the app gets a one-time pass from
   Supabase (gallery_ticket, file 80, a few bytes) and sends the photo straight to the script, which saves it in Drive.
   No saving: photos can't be long-pressed, dragged or right-clicked, and in the Android app (build 25+) screenshots and
   screen recording are blocked while gallery photos are on screen (RwbTrack.secure → FLAG_SECURE). */
const GAL_KEY = 'rwb-app-gal-v2', GAL_TTL = 12 * 36e5, GAL_STRIP = 16, GAL_PAGE = 60;
/* the sharp viewer copy: 1080 px wide is pin-sharp on any phone (~250 KB, half of 1600 px); tablets/computers get 1600 */
const GAL_BIG = (innerWidth * (devicePixelRatio || 1)) <= 1240 ? 'w1080-rw' : 'w1600-rw';
const galSized = (u, spec) => /^https:\/\/lh3\.googleusercontent\.com\/d\/[\w-]+$/.test(u) ? `${u}=${spec}` : u;
const galId = it => it.id || (it.url.match(/\/d\/([\w-]{10,})/) || [])[1] || '';
const galCanEdit = () => isMod() && !isFam() && (!!SITE.GALLERY_EDIT || api.demo);
const galSaved = () => { try { const s = JSON.parse(localStorage.getItem(GAL_KEY)); return s?.list?.length ? s : null; } catch { return null; } };
const galKeep = () => { try { localStorage.setItem(GAL_KEY, JSON.stringify({ t: Date.now(), list: state.gal.filter(x => !x.local) })); } catch { /* full */ } };
let galJob = null;
function galFetch() {
    if (!SITE.GALLERY_SCRIPT_URL) return Promise.resolve(galSaved()?.list || []);
    /* the full list needs a one-time "view" pass (members and RWB FAM, file 81); without one the script gives only
       the public pick of 30, which never replaces a bigger saved list */
    return galJob ??= (api.demo ? Promise.resolve('') : api.galleryTicket('view').catch(() => ''))
        .then(pass => fetch(SITE.GALLERY_SCRIPT_URL + (pass ? '?pass=' + encodeURIComponent(pass) : '')))
        .then(r => r.json()).then(a => {
        const full = !!a?.full, raw = full ? a.list : a;
        const list = (Array.isArray(raw) ? raw : []).filter(im => /^https:\/\//.test(im?.url || '')).map(({ url, label, id }) => ({ url, label: label || '', ...(id ? { id } : {}) }));
        if (!list.length) throw 0;   /* an empty answer never replaces a saved list */
        const had = state.gal?.length || galSaved()?.list?.length || 0;
        if (!full && list.length < had) throw 0;
        state.gal = list; galKeep(); return list;
    }).catch(() => state.gal || galSaved()?.list || []).finally(() => { galJob = null; });
}
/* cache-first: the saved list now (refreshed quietly in the background when it's old), else wait for the first download */
function loadGal() {
    if (state.gal?.length) return Promise.resolve(state.gal);
    const s = galSaved();
    if (s) { state.gal = s.list; if (Date.now() - (s.t || 0) > GAL_TTL) whenIdle(galFetch); return Promise.resolve(s.list); }
    return galFetch();
}
const galShuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* screenshots: Android blocks them while any gallery photo is on screen (the strip in view, the Gallery screen, the viewer) */
const galSec = new Set(); let galSecOn = false;
function galSecure(key, on) {
    if (on) galSec.add(key); else galSec.delete(key);
    const want = galSec.size > 0; if (want === galSecOn) return; galSecOn = want;
    RwbTrack()?.secure?.({ on: want }).catch(() => {});   /* older app builds don't have it: nothing happens */
}
addEventListener('hashchange', () => { if (!location.hash.startsWith('#gallery')) galSecure('screen', false); });

/* Home (members and RWB FAM): one slow rolling strip of 16 random photos (a fresh pick each time the app opens).
   It can be swiped, sleeps when off screen or when the app is in the background, and pauses while the page scrolls. */
const galSection = () => `<section class="section gal-home" id="home-gal"><h2>RWB Gallery <a href="#gallery">See all</a></h2><div class="gal-mq" aria-label="RWB ride photos"><div class="gal-strip"><div class="gal-skel" aria-hidden="true"><i></i><i></i><i></i></div></div></div></section>`;
async function bindHomeGallery(n) {
    const list = await loadGal().catch(() => []);
    const box = $('#home-gal'); if (!stillHere(n) || !box) return;
    if (!list.length) { box.remove(); return; }
    if (!state.galPick || state.galPick.some(i => !list[i])) state.galPick = galShuffle(list.map((_, i) => i)).slice(0, GAL_STRIP);
    const view = box.querySelector('.gal-mq');
    view.querySelector('.gal-strip').innerHTML = state.galPick.map((i, k) => `<button class="gal-tile" data-gi="${i}" aria-label="Open photo ${k + 1}"><img src="${esc(galSized(list[i].url, 'h420-rw'))}" alt="" ${k < 3 ? '' : 'loading="lazy"'} decoding="async" draggable="false" referrerpolicy="no-referrer" onload="this.classList.add('in')"></button>`).join('');
    galRoll(view, i => galViewer(list, i));
}
function galRoll(view, onOpen) {
    const strip = view.querySelector('.gal-strip'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = strip.children.length;
    [...strip.children].forEach(k => { const d = k.cloneNode(true); d.setAttribute('aria-hidden', 'true'); d.tabIndex = -1; strip.append(d); });   /* a second copy so it loops without a gap */
    const m = { x: 0, cur: 0, v: 0, period: 0, held: false, seen: false, raf: 0, last: 0, dragged: false };
    const SPEED = -20, root = document.documentElement;
    const measure = () => { m.period = strip.children[n] ? strip.children[n].offsetLeft - strip.children[0].offsetLeft : 0; };
    const wrap = () => { if (m.period) { m.x %= m.period; if (m.x > 0) m.x -= m.period; } };
    const place = () => { strip.style.transform = `translate3d(${m.x.toFixed(1)}px,0,0)`; };
    function frame(now) {
        if (!view.isConnected) { m.raf = 0; return; }
        const dt = Math.min(now - m.last, 64) / 1000; m.last = now;
        const target = m.held || still || root.classList.contains('scrolling') || gdLayer ? 0 : SPEED;
        m.cur += (target - m.cur) * (1 - Math.exp(-dt * 2.6));
        if (!m.held) { m.x += (m.cur + m.v) * dt; m.v *= Math.exp(-dt * 3.2); if (Math.abs(m.v) < 2) m.v = 0; }
        if (!m.period) measure();
        wrap(); place();
        m.raf = m.seen && !document.hidden ? requestAnimationFrame(frame) : 0;
    }
    const wake = () => { if (!m.raf && m.seen && !document.hidden && view.isConnected) { m.last = performance.now(); m.raf = requestAnimationFrame(frame); } };
    const io = new IntersectionObserver(e => { m.seen = e[0].isIntersecting; galSecure('strip', m.seen); wake(); }, { rootMargin: '80px 0px' }); io.observe(view);
    document.addEventListener('visibilitychange', wake);
    new MutationObserver((_, o) => { if (!view.isConnected) { io.disconnect(); galSecure('strip', false); document.removeEventListener('visibilitychange', wake); o.disconnect(); } }).observe(app, { childList: true });
    let sx = 0, sy = 0, lx = 0, lt = 0, vel = 0, id = null, decided = false;
    view.addEventListener('pointerdown', e => { if (e.button > 0) return; id = e.pointerId; sx = lx = e.clientX; sy = e.clientY; lt = performance.now(); vel = 0; decided = false; m.dragged = false; m.held = true; m.v = 0; wake(); });
    view.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        if (!decided) { const dx = Math.abs(e.clientX - sx), dy = Math.abs(e.clientY - sy); if (dx < 6 && dy < 6) return; decided = true;
            if (dy > dx) { id = null; m.held = false; return; } m.dragged = true; view.setPointerCapture(id); }
        const now = performance.now(), dx = e.clientX - lx; m.x += dx; if (!m.period) measure(); wrap(); place();
        vel = .8 * (dx / Math.max(now - lt, 1) * 1000) + .2 * vel; lx = e.clientX; lt = now;
    });
    const up = e => { if (e.pointerId !== id) return; id = null; m.held = false; if (m.dragged) { m.v = Math.max(-2400, Math.min(2400, vel)); m.cur = 0; } wake(); };
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
    view.addEventListener('click', e => {
        if (m.dragged) { e.preventDefault(); e.stopPropagation(); m.dragged = false; return; }
        const t = e.target.closest('.gal-tile'); if (t) onOpen(+t.dataset.gi);
    });
    measure(); m.cur = still ? 0 : SPEED; wake();
}

/* Gallery screen (#gallery): every photo, newest first, in a mosaic (a big tile every 12 photos), 60 at a time:
   more load as you scroll down, so the screen opens fast however many photos there are */
async function viewGallery() {
    const n = navN, edit = galCanEdit();
    galSecure('screen', true);
    app.innerHTML = top('RWB Gallery') + `<section class="gal-head"><div class="grow"><p class="gal-sub" id="gal-sub">Moments from RWB rides and meets</p></div>
            ${edit ? `<button class="btn sm gal-add" data-act="gal-add"><span aria-hidden="true">＋</span> Add photos</button>` : ''}</section>
        <div id="gal-body">${SKEL(4)}</div>`;
    actions = { 'gal-add': () => galAddPicker() };
    const list = await loadGal().catch(() => []);
    if (!stillHere(n)) return;
    galDrawGrid(list);
}
function galDrawGrid(list) {
    const body = $('#gal-body'); if (!body) return;
    const sub = $('#gal-sub'); if (sub && list.length) sub.textContent = `${list.length.toLocaleString('en-IN')} photos from RWB rides and meets`;
    if (!list.length) { body.innerHTML = `<div class="card empty gal-empty"><span class="gal-empty-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8.5 6l1.5-2.5h4L15.5 6"/></svg></span><b>Photos will be here soon</b>Ride photos from RWB rides and meets show up here.</div>`; return; }
    body.innerHTML = `<div class="gal-grid"></div><div class="gal-more" aria-hidden="true"></div><p class="gal-end" hidden>That's every photo · ride more, there'll be more 🏍️</p>`;
    const grid = body.querySelector('.gal-grid'), more = body.querySelector('.gal-more');
    let shown = 0;
    const cell = (im, i) => `<button class="gal-cell${i % 12 === 0 ? ' big' : ''}${i % 24 === 12 ? ' r' : ''}" data-gi="${i}" aria-label="Open photo ${i + 1}"><img src="${esc(galSized(im.url, i % 12 === 0 ? 'w800-rw' : 'w400-rw'))}" alt="" ${i < 9 ? '' : 'loading="lazy"'} decoding="async" draggable="false" referrerpolicy="no-referrer" onload="this.classList.add('in')"></button>`;
    const io = new IntersectionObserver(e => { if (e[0].isIntersecting) page(); }, { rootMargin: '800px 0px' });
    function page() {
        const end = Math.min(shown + GAL_PAGE, list.length);
        grid.insertAdjacentHTML('beforeend', list.slice(shown, end).map((im, k) => cell(im, shown + k)).join(''));
        shown = end; if (shown >= list.length) { io.disconnect(); more.remove(); body.querySelector('.gal-end').hidden = false; }
    }
    page(); if (more.isConnected) io.observe(more);
    grid.onclick = e => { const c = e.target.closest('.gal-cell'); if (c) galViewer(list, +c.dataset.gi); };
}

/* full-screen viewer: swipe left or right forever (after the last photo comes the first again), double-tap to zoom,
   the phone's Back button closes it. Only three slides exist; they are reused as you swipe, so even thousands of
   photos open instantly. The small grid copy shows at once while the sharp one loads. */
function galViewer(list, start = 0) {
    if (!list.length) return;
    const L = gdOverlay('gd-player gd-viewer gal-viewer', 'Photo');
    galSecure('viewer', true); L.cleanup.push(() => galSecure('viewer', false));
    const many = () => list.length > 1, at = i => ((i % list.length) + list.length) % list.length;
    const slide = () => `<figure class="gd-ph-slide"><div class="gd-zoom"><img alt="" draggable="false" decoding="async" referrerpolicy="no-referrer"></div></figure>`;
    L.el.innerHTML = `<div class="gd-hreel gal-reel">${slide() + slide() + slide()}</div>
        <div class="gd-ptop"><button class="gd-glass" data-x="close" aria-label="Close">${GD_ICO.close}</button>
            <span class="gd-count"><b></b> / <i></i></span>
            <span class="gd-pr">${galCanEdit() ? `<button class="gd-glass" data-x="more" aria-label="Photo options">${GD_ICO.more}</button>` : ''}</span></div>`;
    const reel = L.el.querySelector('.gal-reel');
    let cur = at(start);
    const fill = (fig, i) => {
        const it = list[at(i)], img = fig.querySelector('img'), z = fig.querySelector('.gd-zoom'), u = galSized(it.url, GAL_BIG);
        fig.dataset.i = at(i); z.classList.remove('zoomed');
        if (img.dataset.u === u) return;
        img.dataset.u = u; img.classList.remove('in'); img.onload = () => img.classList.add('in'); img.src = u;
        z.style.backgroundImage = `url("${galSized(it.url, 'w400-rw').replace(/"/g, '%22')}")`;
    };
    const draw = () => {
        const [a, b, c] = reel.children; fill(a, cur - 1); fill(b, cur); fill(c, cur + 1);
        reel.classList.toggle('one', !many());
        L.el.querySelector('.gd-count b').textContent = cur + 1; L.el.querySelector('.gd-count i').textContent = list.length;
        L.el.querySelector('.gd-count').hidden = !many();
        [cur + 2, cur - 2].forEach(k => { const p = new Image(); p.referrerPolicy = 'no-referrer'; p.src = galSized(list[at(k)].url, GAL_BIG); });   /* the next ones are ready before the swipe */
    };
    const middle = () => { reel.scrollLeft = many() ? reel.clientWidth : 0; };
    draw(); requestAnimationFrame(middle);
    /* after each swipe settles: keep the photo in the middle slide and move the spare slide to the other side */
    const settle = () => {
        if (!many() || reel.style.overflowX === 'hidden') return;
        const k = Math.round(reel.scrollLeft / reel.clientWidth); if (k === 1) return;
        if (k === 2) { cur = at(cur + 1); reel.append(reel.firstElementChild); fill(reel.lastElementChild, cur + 1); }
        else { cur = at(cur - 1); reel.prepend(reel.lastElementChild); fill(reel.firstElementChild, cur - 1); }
        middle(); draw();
    };
    let st = 0; const onScroll = () => { clearTimeout(st); st = setTimeout(settle, 140); };
    if ('onscrollend' in window) reel.addEventListener('scrollend', () => { clearTimeout(st); settle(); }); else reel.addEventListener('scroll', onScroll, { passive: true });
    const onResize = () => middle(); addEventListener('resize', onResize); L.cleanup.push(() => removeEventListener('resize', onResize));
    /* double-tap zooms into that spot; again zooms out. A single tap hides the buttons */
    let lastTap = 0;
    reel.addEventListener('click', e => {
        const z = e.target.closest('.gd-zoom'); if (!z) return;
        const now = Date.now(); if (now - lastTap > 320) { lastTap = now; L.el.classList.toggle('chrome-off'); return; }
        lastTap = 0; L.el.classList.remove('chrome-off');
        const on = !z.classList.contains('zoomed'), img = z.querySelector('img'), r = img.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        z.classList.toggle('zoomed', on); reel.style.overflowX = on ? 'hidden' : '';
        if (on) requestAnimationFrame(() => { z.scrollLeft = fx * z.scrollWidth - z.clientWidth / 2; z.scrollTop = fy * z.scrollHeight - z.clientHeight / 2; });
    });
    L.el.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') reel.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * reel.clientWidth, behavior: 'smooth' }); });
    L.el.addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (!x) return; e.stopPropagation();
        if (x.dataset.x === 'close') gdClose();
        if (x.dataset.x === 'more') galPhotoMenu(list[cur], () => {
            if (!list.length) return gdClose();
            cur = at(cur); [...reel.children].forEach(f => { f.querySelector('img').dataset.u = ''; }); draw(); middle();
        });
    });
}

/* ---------- admins and coordinators: add and delete photos ---------- */
function galPhotoMenu(it, after) {
    openSheet('Photo', `<div class="gal-menu"><span class="gal-menu-th" style="background-image:url('${esc(galSized(it.url, 'w400-rw'))}')"></span>
            <p class="small muted">This photo is in the RWB Gallery on the app and on roninwb.in.</p></div>
        <button class="btn danger block" data-x="del">Delete from the gallery</button>
        <p class="small muted gal-note">It moves to the bin of the RWB Gallery Google Drive folder, where the RWB super admin can restore it for 30 days.</p>`, body => {
        body.querySelector('[data-x=del]').onclick = e => {
            if (!confirmBox('Delete this photo from the RWB Gallery?\n\nIt disappears from the app and roninwb.in.')) return;
            busy(e.target, async () => { await galDelete(it); closeSheet(); toast('Photo deleted'); after?.(); galRefreshScreens(); });
        };
    });
}
async function galSend(token, payload) {
    if (api.demo) return { ok: true, item: payload.data ? { url: 'data:' + payload.type + ';base64,' + payload.data, label: '', id: 'demo' + Date.now() + Math.random().toString(36).slice(2, 8) } : null };
    let r;
    try { r = await fetch(SITE.GALLERY_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ token, ...payload }) }); }   /* plain text body: no CORS preflight */
    catch { throw new Error(navigator.onLine === false ? 'You\'re offline. Connect to the internet and try again.' : 'Couldn\'t reach the RWB Gallery. Please try again.'); }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || 'Couldn\'t update the RWB Gallery. Please try again.');
    return j;
}
async function galDelete(it) {
    const id = galId(it); if (!id) throw new Error('This photo can\'t be deleted from the app');
    await galSend(await api.galleryTicket('delete', id), {});
    const list = state.gal || [], i = list.indexOf(it); if (i >= 0) list.splice(i, 1);
    state.galPick = null; galKeep();
}
const galB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
async function galAddOne(f) {
    const okType = /^image\/(jpe?g|png|webp|heic|heif)$/i.test(f.type) || (!f.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!okType) throw new Error('Not a photo');
    if (f.size > 25 * 1024 * 1024) throw new Error('Over 25 MB');
    const ph = await compressImage(f, 2048, 900e3);   /* sharp on any phone screen, ~0.5–0.9 MB */
    const j = await galSend(await api.galleryTicket('add'), { type: 'image/jpeg', data: await galB64(ph) });
    if (j.item) { (state.gal ??= []).unshift(api.demo ? { ...j.item, local: true } : j.item); state.galPick = null; galKeep(); }
}
function galAddPicker() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = () => { const files = [...inp.files].slice(0, 20); if (files.length) galAddSheet(files); };
    inp.click();
}
function galAddSheet(files) {
    const urls = files.map(f => URL.createObjectURL(f));
    openSheet(`Add ${files.length} photo${files.length > 1 ? 's' : ''}`, `<div class="gal-pick">${urls.map((u, i) => `<span class="gal-pick-t" data-i="${i}" style="background-image:url('${u}')"><i></i></span>`).join('')}</div>
        <div class="gal-rules"><b>Before you add</b><ul>
            <li>Photos from RWB rides, meets and events only</li>
            <li>Everyone in them is happy to be on the app and roninwb.in</li>
            <li>No phone numbers, documents or anything private in the picture</li></ul></div>
        <button class="btn block" data-x="go">Add to the RWB Gallery</button>
        <p class="small muted gal-note">They show on the app and roninwb.in for everyone. Photos are made lighter on your phone first (up to 20 at a time).</p>`, body => {
        const go = body.querySelector('[data-x=go]');
        go.onclick = async () => {
            go.disabled = true; let done = 0, bad = 0;
            for (let i = 0; i < files.length; i++) {
                const t = body.querySelector(`.gal-pick-t[data-i="${i}"]`); t?.classList.add('busy');
                go.textContent = `Adding ${i + 1} of ${files.length}…`;
                try { await galAddOne(files[i]); done++; t?.classList.replace('busy', 'ok'); }
                catch (e) { bad++; t?.classList.replace('busy', 'bad'); if (/pass|admins|offline|lot of photos/i.test(e.message)) { toast(e.message, true); break; } }
            }
            urls.forEach(u => URL.revokeObjectURL(u));
            if (done) toast(`${done} photo${done > 1 ? 's' : ''} added to the RWB Gallery${bad ? ` · ${bad} couldn't be added` : ''}`, !!bad);
            else if (!bad) toast('Nothing was added', true);
            setTimeout(closeSheet, done && !bad ? 400 : 1600); galRefreshScreens();
        };
    });
    sheet.addEventListener('close', () => urls.forEach(u => URL.revokeObjectURL(u)), { once: true });
}
/* redraw what's on screen after an add or delete (the phone's list is already updated) */
function galRefreshScreens() {
    if (document.body.dataset.route === 'gallery') galDrawGrid(state.gal || []);
    else if ($('#home-gal')) render();
}

/* =================== Service records =================== */
async function viewService() {
    const list = await load.services();
    const total = list.reduce((a, s) => a + Number(s.cost || 0), 0);
    const odo = latestOdo(list, state.fuel || await load.fuel())?.km || 0, n = nextService(list, odo);
    app.innerHTML = top('Service') + `
        <div class="stats">
            <div class="stat"><b>${list.length}</b><span>Services logged</span></div>
            <div class="stat"><b>${rs(total)}</b><span>Total spent</span></div>
        </div>
        ${odo ? `<div class="card next-svc ${n.status}"><div class="row"><span class="grow"><span class="small muted">${esc(n.label)}${n.guess ? ' (log your last service for exact dates)' : ''}</span><b>${km(n.km)}${n.date ? ` <span class="muted" style="font-weight:500">or by</span> ${fmtDate(n.date)}` : ''}</b><span class="small muted">${n.status === 'due' ? 'Due now' : `${km(Math.max(0, n.kmLeft))} to go${n.daysLeft != null ? ` · ${n.daysLeft} days left` : ''}`}, whichever comes first</span></span><span class="svc-chip ${n.status}">${n.status === 'due' ? 'Due' : n.status === 'soon' ? 'Soon' : 'On track'}</span></div>
            <p class="small muted" style="margin-top:8px">Worked out from the TVS Ronin service chart: every 6,000 km or 6 months after the free services.</p></div>` : ''}
        <section class="section">${list.length ? `<div class="list">${list.map(serviceCard).join('')}</div>` :
            `<div class="card empty"><b>No services yet</b>Add your last service: date, km, what was done and the bill. It's your bike's history in one place.</div>`}</section>
        <button class="btn fab" data-act="add-service">＋ Add service</button>`;
    actions = { open: el => serviceDetail(list.find(s => String(s.id) === el.dataset.id)) };
}
function serviceCard(s) {
    const p = parts(s.service_date), n = s.items?.length || 0;
    const label = SERVICE_TYPES[s.service_type] + (s.service_no && ['free', 'amc'].includes(s.service_type) ? ` #${s.service_no}` : '');
    return `<button class="card tap item" data-act="open" data-id="${s.id}">
        <div class="date"><b>${p.d}</b><span>${MONTHS[p.m - 1]} ${String(p.y).slice(2)}</span></div>
        <div style="min-width:0"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="badge ${s.service_type === 'amc' ? 'orange' : s.service_type === 'free' ? 'ok' : ''}">${esc(label)}</span>${s.bill_path ? '<span class="badge">🧾 Bill</span>' : ''}</div>
            <p style="margin-top:6px;font-weight:600">${km(s.odometer_km)}${s.service_center ? ` · <span class="muted" style="font-weight:400">${esc(s.service_center)}</span>` : ''}</p>
            <p class="small muted" style="margin-top:2px">${n ? esc(s.items.slice(0, 3).join(', ')) + (n > 3 ? ` +${n - 3} more` : '') : 'No items listed'}</p></div>
        <div class="right">${rs(s.cost)}</div></button>`;
}
function serviceDetail(s) {
    const label = SERVICE_TYPES[s.service_type] + (s.service_no && ['free', 'amc'].includes(s.service_type) ? ` #${s.service_no}` : '');
    openSheet(fmtDate(s.service_date), `
        <dl class="facts">
            <dt>Type</dt><dd>${esc(label)}</dd>
            <dt>Odometer</dt><dd>${km(s.odometer_km)}</dd>
            ${s.service_center ? `<dt>Where</dt><dd>${esc(s.service_center)}</dd>` : ''}
            <dt>Cost</dt><dd>${rs(s.cost)}</dd>
            ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}
        </dl>
        ${s.items?.length ? `<p class="small muted">Work done</p><div class="tags" style="margin-bottom:16px">${s.items.map(i => `<span class="badge">${esc(i)}</span>`).join('')}</div>` : ''}
        <div class="btns" style="margin-bottom:10px">${s.bill_path ? '<button class="btn ghost" data-x="bill">🧾 View bill</button>' : ''}<button class="btn" data-x="edit">Edit</button></div>
        <button class="btn danger block" data-x="del">Delete this record</button>`, body => {
        body.querySelector('[data-x=edit]').onclick = () => serviceForm(s);
        body.querySelector('[data-x=del]').onclick = e => { if (confirmBox('Delete this service record and its bill?')) busy(e.target, async () => { await api.deleteService(s); await load.services(true); state.board = null; closeSheet(); render(); toast('Deleted'); }); };
        const b = body.querySelector('[data-x=bill]'); if (b) b.onclick = () => showBill(s);
    });
}
async function showBill(s) {
    const url = await api.billUrl(s.bill_path).catch(e => toast(e.message, true)); if (!url) return;
    const k = pathKind(s.bill_path.startsWith('demo:') ? s.bill_path : s.bill_path);
    openSheet('Bill', `<div class="bill-view">${k === 'pdf' ? `<iframe class="pdf" src="${esc(url)}" title="Bill"></iframe>` : k === 'word' ? wordCard(url, 'Bill') : `<img src="${esc(url)}" alt="Bill for service on ${esc(fmtDate(s.service_date))}">`}</div>
        <div class="btns" style="margin-top:14px"><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener" download>Open / download</a><button class="btn ghost" data-x="back">Back</button></div>`,
        body => body.querySelector('[data-x=back]').onclick = () => serviceDetail(s));
}

/* Any phone photo works: JPG, PNG, WebP, AVIF, and HEIC/HEIF from iPhones and OnePlus/Samsung phones.
   Browsers can't show HEIC directly, so those are converted on the phone first (the converter loads only when needed). */
const isHeic = f => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '');
const isImageFile = f => f.type.startsWith('image/') || isHeic(f) || /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name || '');
let heicLib;
async function loadImage(file) {
    if (!isImageFile(file)) throw new Error('Please choose a photo.');
    const open = blob => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
    try { return await open(file); }
    catch {
        if (!isHeic(file)) throw new Error('Could not read that photo. Please try another one.');
        toast('Converting iPhone photo…');
        heicLib ??= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js'; sc.onload = () => res(window.heic2any); sc.onerror = () => rej(new Error('Could not load the photo converter. Check your internet.')); document.head.appendChild(sc); });
        const conv = await (await heicLib)({ blob: file, toType: 'image/jpeg', quality: 0.9 });
        return open(Array.isArray(conv) ? conv[0] : conv).catch(() => { throw new Error('Could not read that photo. Please try another one.'); });
    }
}

/* Two separate pickers: some Android phones open only the gallery when one button accepts photos AND files,
   so "Photo" opens gallery/camera and "PDF / Word" opens the phone's file manager. */
const PHOTO_ACCEPT = 'image/*,.heic,.heif';
const DOC_ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const fileKind = f => { const n = (f.name || '').toLowerCase(), t = f.type || ''; return t === MIME.pdf || n.endsWith('.pdf') ? 'pdf' : t === MIME.docx || n.endsWith('.docx') ? 'docx' : t === MIME.doc || n.endsWith('.doc') ? 'doc' : 'image'; };
const pathKind = p => /\.pdf($|\?)/i.test(p) || String(p).startsWith('demo:data:application/pdf') ? 'pdf' : /\.docx?($|\?)/i.test(p) || /^demo:data:application\/(msword|vnd\.openxml)/.test(p) ? 'word' : 'image';
/* PDFs and Word files are kept as they are (phones sometimes leave the type blank, so set it from the name) */
function asDocFile(f, maxMB) {
    const k = fileKind(f);
    if (f.size > maxMB * 1e6) throw new Error(`That ${k === 'pdf' ? 'PDF' : 'Word file'} is over ${maxMB} MB. Add photos of the pages instead.`);
    return f.type === MIME[k] ? f : new File([f], f.name, { type: MIME[k] });
}
const pickers = (id, multiple = false) => `<div class="pick-pair" id="${id}">
    <label class="file-pick"><input type="file" accept="${PHOTO_ACCEPT}"${multiple ? ' multiple' : ''}><span>📷 Photo</span></label>
    <label class="file-pick"><input type="file" accept="${DOC_ACCEPT}"${multiple ? ' multiple' : ''}><span>📄 PDF / Word</span></label></div>`;
const wordCard = (url, name) => `<div class="word-card"><span class="word-ico">W</span><span class="grow"><b>${esc(name)}</b><span class="small muted">Word document. Opens in your phone's document app.</span></span><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener" download>Open</a></div>`;

/* shrink photos so free storage lasts: about 150–250 KB each */
async function compressBill(file) {
    if (fileKind(file) !== 'image') return asDocFile(file, 2);
    if (!isImageFile(file)) throw new Error('Please choose a photo, a PDF or a Word file.');
    return compressImage(file, 1600, 250e3);
}
async function compressImage(file, maxSide = 1400, target = 220e3) {
    const img = await loadImage(file);
    let max = maxSide, q = 0.72, blob;
    for (let tries = 0; tries < 6; tries++) {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
        if (blob.size <= target) break;
        max = Math.round(max * 0.82); q = Math.max(0.5, q - 0.05);
    }
    URL.revokeObjectURL(img.src);
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

function serviceForm(s = null) {
    const r = s ? { ...s } : { service_date: todayISO(), service_type: 'paid', items: [], odometer_km: currentOdo() };
    const known = new Set(C.SERVICE_ITEMS || []);
    const extra = (r.items || []).filter(i => !known.has(i));
    let file = null;
    openSheet(s ? 'Edit service' : 'Add service', `<form id="sf">
        <div class="grid2">
            <label>Date<input type="date" name="service_date" required max="${todayISO()}" value="${esc(r.service_date)}"></label>
            <label>Odometer (km)<input type="number" name="odometer_km" required min="0" inputmode="numeric" value="${esc(r.odometer_km ?? '')}"></label>
        </div>
        <div class="grid2">
            <label>Service type<select name="service_type">${Object.entries(SERVICE_TYPES).map(([k, v]) => `<option value="${k}"${k === r.service_type ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
            <label id="sno-wrap"><span id="sno-label">Which one?</span><select name="service_no"><option value="">–</option>${Array.from({ length: 12 }, (_, i) => `<option${r.service_no === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        </div>
        <div class="field"><span class="flabel">Service centre</span>${centrePicker(r.service_center)}</div>
        <fieldset><legend>Work done <span class="hint muted small">(tap all that apply)</span></legend>
            <div class="chips" id="items">${[...known, ...extra].map(i => `<button type="button" class="chip" aria-pressed="${r.items.includes(i)}">${esc(i)}</button>`).join('')}</div>
            <div class="row"><input id="other-item" placeholder="Something else? Type and add" class="grow"><button type="button" class="btn sm ghost" id="add-item">Add</button></div>
        </fieldset>
        <label>Total cost (₹)<input type="number" name="cost" min="0" step="1" inputmode="numeric" value="${esc(r.cost ?? '')}"></label>
        <label>Notes<textarea name="notes" maxlength="2000" placeholder="Anything worth remembering">${esc(r.notes || '')}</textarea></label>
        <div>
            <p class="flabel" id="pick-text" style="margin-bottom:6px">${r.bill_path ? '🧾 Bill attached. Pick a new one to replace it' : 'Bill / invoice (optional)'}</p>${pickers('pick')}
            ${r.bill_path ? '<button type="button" class="btn sm ghost" id="rm-bill" style="margin-top:8px">Remove attached bill</button>' : ''}
        </div>
        <button class="btn block">${s ? 'Save changes' : 'Save service'}</button>
    </form>`, body => {
        const f = body.querySelector('#sf'), type = f.service_type, sno = body.querySelector('#sno-wrap');
        const syncType = () => { sno.hidden = !['free', 'amc'].includes(type.value); body.querySelector('#sno-label').textContent = type.value === 'amc' ? 'Which AMC service?' : 'Which free service?'; };
        type.onchange = syncType; syncType();
        const centre = bindCentrePicker(body);
        const chips = body.querySelector('#items');
        chips.onclick = e => { const c = e.target.closest('.chip'); if (c) c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); };
        const addOther = () => { const v = body.querySelector('#other-item').value.trim(); if (!v) return; chips.insertAdjacentHTML('beforeend', `<button type="button" class="chip" aria-pressed="true">${esc(v)}</button>`); body.querySelector('#other-item').value = ''; };
        body.querySelector('#add-item').onclick = addOther;
        body.querySelector('#other-item').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } };
        body.querySelectorAll('#pick input').forEach(inp => inp.onchange = async e => {
            const fl = e.target.files[0]; if (!fl) return;
            body.querySelector('#pick-text').textContent = 'Preparing…';
            try { file = await compressBill(fl); body.querySelector('#pick-text').textContent = `🧾 ${fl.name} (${Math.round(file.size / 1024)} KB) ready`; }
            catch (err) { file = null; body.querySelector('#pick-text').textContent = 'Bill / invoice (optional)'; toast(err.message, true); }
            e.target.value = '';
        });
        const rm = body.querySelector('#rm-bill');
        if (rm) rm.onclick = () => { if (confirmBox('Remove the attached bill?')) busy(rm, async () => { const u = await api.removeBill(s); r.bill_path = null; Object.assign(s, u); await load.services(true); rm.remove(); body.querySelector('#pick-text').textContent = 'Bill / invoice (optional)'; toast('Bill removed'); }); };
        f.onsubmit = e => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(f));
            const rec = {
                id: s?.id, bill_path: r.bill_path || null,
                service_date: d.service_date, odometer_km: num(d.odometer_km), service_type: d.service_type,
                service_no: ['free', 'amc'].includes(d.service_type) ? num(d.service_no) : null,
                service_center: centre.value(),
                items: [...chips.querySelectorAll('.chip[aria-pressed=true]')].map(c => c.textContent),
                cost: num(d.cost), next_due_km: null, next_due_date: null, notes: d.notes.trim() || null
            };
            if (centre.isOther() && !rec.service_center) { toast('Type the service centre name, or pick one from the list', true); return; }
            busy(e.submitter, async () => { await centre.remember(); await api.saveService(rec, file); await load.services(true); state.board = null; closeSheet(); location.hash === '#service' ? render() : (location.hash = '#service'); toast(s ? 'Saved' : 'Service added'); });
        };
    });
}

/* ---------- service centre picker: searchable TVS list + "Other" ---------- */
const CHEV_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const centreLabel = c => c.name + (c.area ? ', ' + c.area : '');
function centrePicker(current) {
    return `<div class="cp" id="cp">
        <button type="button" class="cp-btn" id="cp-btn" aria-expanded="false"><span id="cp-val" class="${current ? '' : 'muted'}">${esc(current || 'Choose a TVS service centre')}</span>${CHEV_DOWN}</button>
        <div class="cp-panel" id="cp-panel" hidden>
            <input type="search" id="cp-q" placeholder="Search name, area or pincode" autocomplete="off" aria-label="Search service centres">
            <div class="cp-list" id="cp-list" role="listbox"><p class="small muted" style="padding:10px">Loading…</p></div>
        </div>
        <div class="cp-other" id="cp-other" hidden>
            <input id="cp-name" maxlength="120" placeholder="Service centre name">
            <div class="grid2"><input id="cp-area" maxlength="120" placeholder="Area / city"><input id="cp-pin" maxlength="6" inputmode="numeric" placeholder="Pincode"></div>
            <p class="small muted">It'll be added to the list so other members can pick it too.</p>
        </div></div>`;
}
function bindCentrePicker(body) {
    const $b = q => body.querySelector(q);
    const btn = $b('#cp-btn'), panel = $b('#cp-panel'), list = $b('#cp-list'), q = $b('#cp-q'), other = $b('#cp-other'), val = $b('#cp-val');
    let chosen = val.classList.contains('muted') ? null : val.textContent, isOther = false, all = [];
    const show = open => { panel.hidden = !open; btn.setAttribute('aria-expanded', open); if (open) { draw(); setTimeout(() => q.focus(), 30); } };
    const setVal = (text, otherMode = false) => { isOther = otherMode; chosen = otherMode ? null : text; val.textContent = text; val.classList.toggle('muted', !text || otherMode && false); other.hidden = !otherMode; show(false); if (otherMode) setTimeout(() => $b('#cp-name').focus(), 30); };
    const draw = () => {
        const t = q.value.trim().toLowerCase(), digits = t.replace(/\D/g, '');
        const hits = all.filter(c => !t || [c.name, c.area].some(v => (v || '').toLowerCase().includes(t)) || (digits.length >= 2 && (c.pincode || '').startsWith(digits)));
        list.innerHTML = hits.slice(0, 80).map(c => `<div class="cp-item" role="option" data-id="${c.id}"><span class="grow"><b>${esc(c.name)}</b><span class="small muted">${esc([c.area, c.pincode].filter(Boolean).join(' · '))}</span></span>${isAdmin() ? `<button type="button" class="icon-btn cp-del" data-del="${c.id}" aria-label="Remove ${esc(c.name)} from the list">✕</button>` : ''}</div>`).join('')
            + (hits.length ? '' : `<p class="small muted" style="padding:10px 12px">No centre matches “${esc(q.value)}”.</p>`)
            + `<div class="cp-item cp-new" role="option" data-other="1"><span class="grow"><b>Other</b><span class="small muted">Not in the list? Type the name</span></span>＋</div>`;
    };
    btn.onclick = async () => {
        if (!panel.hidden) return show(false);
        show(true);
        try { all = state.centres ??= await api.centres(); } catch { all = []; }
        draw();
    };
    q.oninput = draw;
    list.onclick = e => {
        const del = e.target.closest('[data-del]');
        if (del) { const c = all.find(x => String(x.id) === del.dataset.del); if (c && confirmBox(`Remove “${c.name}” from the list for everyone?`)) api.deleteCentre(c.id).then(() => { state.centres = all = all.filter(x => x !== c); draw(); toast('Removed'); }).catch(err => toast(err.message, true)); return; }
        const it = e.target.closest('.cp-item'); if (!it) return;
        if (it.dataset.other) { setVal('Other (type below)', true); return; }
        const c = all.find(x => String(x.id) === it.dataset.id); if (c) setVal(centreLabel(c));
    };
    return {
        isOther: () => isOther,
        value: () => {
            if (!isOther) return chosen;
            const n = $b('#cp-name').value.trim(), a = $b('#cp-area').value.trim();
            return n ? n + (a ? ', ' + a : '') : null;
        },
        remember: async () => {
            const n = $b('#cp-name').value.trim(); if (!isOther || !n) return;
            try { await api.addCentre(n, $b('#cp-area').value.trim(), $b('#cp-pin').value.trim()); state.centres = null; } catch { /* the service still saves */ }
        }
    };
}

/* ---------- how my mileage compares with other warriors ---------- */
async function drawVs(el, mine) {
    if (!el) return;
    const rows = state.board ??= await api.boards().catch(() => []);
    const others = rows.filter(r => !r.is_me && r.kmpl > 0).map(r => Number(r.kmpl));
    if (!mine) { el.innerHTML = '<p class="small muted">Add a full-tank fill-up with your Trip A reading to see how your mileage compares with other warriors.</p>'; return; }
    if (others.length < 2) { el.innerHTML = `<p class="small muted">Your average is <b>${kmplTxt(mine)}</b>. Comparison appears once a few more warriors log full-tank fill-ups.</p>`; return; }
    const avg = others.reduce((a, b) => a + b, 0) / others.length, best = Math.max(mine, ...others), worst = Math.min(mine, ...others);
    const diff = (mine - avg) / avg * 100, all = [...others, mine].sort((a, b) => b - a), rank = all.indexOf(mine) + 1;
    const better = all.filter(v => v < mine).length / (all.length - 1) * 100;
    const pos = v => ((v - worst) / Math.max(.1, best - worst) * 100).toFixed(1);
    const good = diff >= 0;
    el.innerHTML = `<div class="vs-head"><span class="vs-big ${good ? 'up' : 'down'}">${good ? '▲' : '▼'} ${Math.abs(diff).toFixed(0)}%</span>
            <span class="grow"><b>${good ? 'Better' : 'Lower'} than the RWB average</b><span class="small muted">You get ${kmplTxt(mine)} · RWB average ${kmplTxt(avg)}</span></span></div>
        <div class="vs-scale" aria-hidden="true"><span class="vs-mark avg" style="left:${pos(avg)}%"></span><span class="vs-mark you" style="left:${pos(mine)}%"></span></div>
        <div class="vs-ends small muted"><span>${kmplTxt(worst)}</span><span>${kmplTxt(best)}</span></div>
        <div class="vs-legend small"><span><i class="you"></i>You</span><span><i class="avg"></i>RWB average</span></div>
        <div class="vs-stats"><div><b>#${rank}</b><span>of ${all.length} Mileage Warriors</span></div><div><b>${better.toFixed(0)}%</b><span>of riders you beat</span></div><div><b>${kmplTxt(best)}</b><span>best in RWB</span></div></div>`;
}
const TIPS = `<details class="howto tips"><summary>Tips to get more km/l</summary>
    <div class="tips-grid">
        <div><h4 class="do">Do</h4><ul>
            <li>Keep tyre pressure at the value on your owner's manual or swingarm sticker. Check it cold, every week.</li>
            <li>Ride smooth: gentle throttle, early upshifts, steady cruising instead of sprint-and-brake.</li>
            <li>Cruise in top gear at a steady, moderate speed on highways.</li>
            <li>Clean and lube the chain every 500–700 km, and keep its slack right.</li>
            <li>Service on time: fresh oil, a clean air filter and a healthy spark plug all help.</li>
            <li>Read the road ahead and roll off early instead of braking hard.</li>
        </ul></div>
        <div><h4 class="dont">Don't</h4><ul>
            <li>Don't rev hard in low gears or hold the bike at high RPM.</li>
            <li>Don't ride with the clutch half-pressed or the brake dragging.</li>
            <li>Don't idle for long at signals or while waiting; switch off.</li>
            <li>Don't carry weight you don't need, and keep luggage tight and low.</li>
            <li>Don't judge mileage from one tank. Compare full-tank to full-tank over a few fills.</li>
        </ul></div>
    </div></details>`;

/* ---------- Spends + mileage over time: two panels on one shared time axis (no second y-scale) ---------- */
const PERIODS = { week: ['Weekly', 12], month: ['Monthly', 12], quarter: ['3 months', 8], half: ['6 months', 6], year: ['Yearly', 5] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function bucketOf(iso, per) {
    const [y, m, d] = iso.split('-').map(Number);
    if (per === 'week') { const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return dt.toISOString().slice(0, 10); }
    const mm = per === 'month' ? m - 1 : per === 'quarter' ? Math.floor((m - 1) / 3) * 3 : per === 'half' ? (m > 6 ? 6 : 0) : 0;
    return `${y}-${String(mm + 1).padStart(2, '0')}-01`;
}
function stepBack(key, per) {
    if (per === 'week') { const dt = new Date(key + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - 7); return dt.toISOString().slice(0, 10); }
    return addMonths(key, -({ month: 1, quarter: 3, half: 6, year: 12 }[per]));
}
function bucketLabel(key, per, long = false) {
    const [y, m, d] = key.split('-').map(Number), yy = String(y).slice(2);
    if (per === 'week') return long ? `Week of ${d} ${MON[m - 1]} ${y}` : `${d} ${MON[m - 1]}`;
    if (per === 'month') return long ? `${MON[m - 1]} ${y}` : `${MON[m - 1]}${m === 1 ? ' ' + yy : ''}`;
    if (per === 'quarter') return long ? `${MON[m - 1]}–${MON[m + 1]} ${y}` : `Q${(m + 2) / 3} '${yy}`;
    if (per === 'half') return long ? (m === 1 ? `Jan–Jun ${y}` : `Jul–Dec ${y}`) : `${m === 1 ? 'H1' : 'H2'} '${yy}`;
    return String(y);
}
function trendData(logs, svcs, tnks, per) {
    const n = PERIODS[per][1], keys = [bucketOf(todayISO(), per)];
    while (keys.length < n) keys.unshift(stepBack(keys[0], per));
    const B = new Map(keys.map(k => [k, { key: k, fuel: 0, service: 0, dist: 0, litres: 0, has: false }]));
    for (const f of logs) { const b = B.get(bucketOf(f.fill_date, per)); if (b && f.amount != null) { b.fuel += Number(f.amount); b.has = true; } }
    for (const s of svcs) { const b = B.get(bucketOf(s.service_date, per)); if (b && s.cost != null) { b.service += Number(s.cost); b.has = true; } }
    for (const t of tnks) { const b = B.get(bucketOf(t.end.fill_date, per)); if (b) { b.dist += t.dist; b.litres += t.litres; b.has = true; } }
    let rows = [...B.values()];
    const first = rows.findIndex(r => r.has);
    rows = first < 0 ? [] : rows.slice(Math.min(first, rows.length - 2 < 0 ? 0 : first));
    return rows.map(r => ({ ...r, spend: r.fuel + r.service, kmpl: r.litres ? r.dist / r.litres : null }));
}
const rsShort = v => v >= 1e5 ? '₹' + (v / 1e5).toFixed(v >= 1e6 ? 0 : 1) + 'L' : v >= 1000 ? '₹' + (v / 1000).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : '₹' + Math.round(v);
function drawTrend(el, logs, svcs, tnks) {
    let per = 'month'; try { per = localStorage.getItem('rwb-trend') || 'month'; } catch { /* ignore */ }
    if (!PERIODS[per]) per = 'month';
    const rows = trendData(logs, svcs, tnks, per);
    let active = rows.length - 1; while (active > 0 && !rows[active].has) active--;
    const W = 600, L = 46, Rp = 10, H1 = 116, GAP = 44, H2 = 92, TOP = 24, AX = 22, H = TOP + H1 + GAP + H2 + AX;
    const n = rows.length, slot = n ? (W - L - Rp) / n : 0, cx = i => L + slot * (i + .5);
    const maxS = Math.max(1, ...rows.map(r => r.spend)), niceS = (() => { const p = 10 ** Math.floor(Math.log10(maxS)); return Math.ceil(maxS / p / (maxS / p > 5 ? 2 : 1)) * p * (maxS / p > 5 ? 2 : 1); })();
    const ys = v => TOP + H1 - (v / niceS) * H1;
    const km = rows.filter(r => r.kmpl != null).map(r => r.kmpl);
    const lo = km.length ? Math.floor(Math.min(...km) - 2) : 0, hi = km.length ? Math.ceil(Math.max(...km) + 2) : 1;
    const top2 = TOP + H1 + GAP, ym = v => top2 + H2 - (v - lo) / (hi - lo) * H2;
    const bw = Math.min(28, slot * .56), every = Math.ceil(n / 6);
    const pts = rows.map((r, i) => r.kmpl == null ? null : [cx(i), ym(r.kmpl)]);
    const path = pts.filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const svg = n ? `<svg class="tchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spends and mileage, ${PERIODS[per][0].toLowerCase()}">
        <rect class="t-band" id="t-band" x="${cx(active) - Math.min(slot, 70) / 2}" y="${TOP - 6}" width="${Math.min(slot, 70)}" height="${H - AX - TOP + 8}" rx="8"/>
        <text class="t-title" x="0" y="11">Spent (₹)</text>
        ${[0, .5, 1].map(f => `<line class="t-grid" x1="${L}" x2="${W - Rp}" y1="${ys(niceS * f)}" y2="${ys(niceS * f)}"/><text class="t-tick" x="${L - 6}" y="${ys(niceS * f) + 4}" text-anchor="end">${f ? rsShort(niceS * f) : '0'}</text>`).join('')}
        ${rows.map((r, i) => r.spend ? `<path class="t-bar" d="M${cx(i) - bw / 2} ${ys(0)}V${ys(r.spend) + 4}q0 -4 4 -4h${bw - 8}q4 0 4 4V${ys(0)}z"/>` : '').join('')}
        <text class="t-title" x="0" y="${top2 - 18}">Mileage (km/l)</text>
        ${km.length ? [lo, (lo + hi) / 2, hi].map(v => `<line class="t-grid" x1="${L}" x2="${W - Rp}" y1="${ym(v)}" y2="${ym(v)}"/><text class="t-tick" x="${L - 6}" y="${ym(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('') : `<text class="t-tick" x="${(L + W) / 2}" y="${top2 + H2 / 2}" text-anchor="middle">No full-tank readings in this range</text>`}
        <path class="t-line" d="${path}"/>
        ${pts.map(p => p ? `<circle class="t-dot" cx="${p[0]}" cy="${p[1]}" r="4.5"/>` : '').join('')}
        ${rows.map((r, i) => i % every === (n - 1) % every ? `<text class="t-x" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${bucketLabel(r.key, per)}</text>` : '').join('')}
        ${rows.map((r, i) => `<rect class="t-hit" data-i="${i}" x="${cx(i) - slot / 2}" y="0" width="${slot}" height="${H}"/>`).join('')}
    </svg>` : '<p class="muted small" style="padding:8px 0">No spends or fill-ups yet.</p>';
    el.innerHTML = `<div class="seg scroll t-seg" role="tablist" aria-label="Period">${Object.entries(PERIODS).map(([k, [lab]]) => `<button role="tab" aria-selected="${k === per}" data-per="${k}">${lab}</button>`).join('')}</div>
        <div class="t-read" id="t-read" aria-live="polite"></div>${svg}
        <div class="t-key"><span><i class="k-bar"></i>Spent on fuel + service (₹)</span><span><i class="k-line"></i>Mileage (km/l)</span></div>
        ${n ? `<details class="t-table"><summary>Show as table</summary><table><thead><tr><th>Period</th><th>Fuel</th><th>Service</th><th>km/l</th></tr></thead><tbody>${[...rows].reverse().filter(r => r.has).map(r => `<tr><td>${bucketLabel(r.key, per, true)}</td><td>${rs(r.fuel)}</td><td>${rs(r.service)}</td><td>${r.kmpl ? r.kmpl.toFixed(1) : '–'}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
    const read = () => {
        const r = rows[active]; if (!r) return;
        el.querySelector('#t-read').innerHTML = `<b>${bucketLabel(r.key, per, true)}</b><span><i class="k-bar"></i>${rs(r.spend)}${r.spend ? ` <span class="muted">(fuel ${rs(r.fuel)} · service ${rs(r.service)})</span>` : ''}</span><span><i class="k-line"></i>${r.kmpl ? r.kmpl.toFixed(1) + ' km/l' : '<span class="muted">no full-tank reading</span>'}</span>`;
        const band = el.querySelector('#t-band'); if (band) band.setAttribute('x', cx(active) - Math.min(slot, 70) / 2);
    };
    read();
    const pick = e => { const t = e.target.closest('.t-hit'); if (t) { active = Number(t.dataset.i); read(); } };
    const sv = el.querySelector('svg'); if (sv) { sv.addEventListener('pointermove', pick); sv.addEventListener('click', pick); }
    el.querySelectorAll('[data-per]').forEach(b => b.onclick = () => { try { localStorage.setItem('rwb-trend', b.dataset.per); } catch { /* ignore */ } drawTrend(el, logs, svcs, tnks); });
}

/* =================== Events (like WhatsApp events) + expense splitter =================== */
const RSVP_TXT = { going: 'Going' };
const REMINDERS = [[null, 'No reminder'], [0, 'At start time'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before']];
const evtPast = e => new Date(e.ends_at || new Date(new Date(e.starts_at).getTime() + 6 * 36e5)) < new Date();
const tfmt = (iso, o) => new Date(iso).toLocaleString('en-IN', o);
const evtTime = iso => tfmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
/* an event over more than one calendar day (e.g. a weekend trip) */
const evtMulti = e => !!e.ends_at && new Date(e.starts_at).toDateString() !== new Date(e.ends_at).toDateString();
const evtDays = e => Math.round((new Date(new Date(e.ends_at).toDateString()) - new Date(new Date(e.starts_at).toDateString())) / 864e5) + 1;
function evtWhen(e, short = false) {
    const wd = iso => tfmt(iso, { weekday: 'short' });
    if (evtMulti(e)) return short ? `${wd(e.starts_at)} ${evtTime(e.starts_at)} → ${wd(e.ends_at)} ${evtTime(e.ends_at)}`
        : `${tfmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${evtTime(e.starts_at)} → ${tfmt(e.ends_at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${evtTime(e.ends_at)}`;
    const day = short ? wd(e.starts_at) + ',' : tfmt(e.starts_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${day}${short ? '' : ','} ${evtTime(e.starts_at)}${e.ends_at ? ' – ' + evtTime(e.ends_at) : ''}`;
}
const evtDay = iso => `<span class="evt-d"><i>${tfmt(iso, { month: 'short' }).toUpperCase()}</i><b>${tfmt(iso, { day: 'numeric' })}</b><em>${tfmt(iso, { weekday: 'short' }).toUpperCase()}</em></span>`;
/* the small line above an event's name, like the website: TAG · 2 DAYS */
const evtEyebrow = e => { const t = [e.tag, evtMulti(e) ? `${evtDays(e)} days` : ''].filter(Boolean); return t.length ? `<span class="evt-eyebrow">${esc(t.join(' · '))}</span>` : ''; };
const EVT_ICON = { clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>', edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/></svg>' };
/* slots left (when the event has a limit) */
const evtSlots = (e, n) => { if (!e.capacity) return ''; const left = Math.max(e.capacity - n, 0), p = Math.min(n / e.capacity, 1);
    return `<span class="evt-slots ${p >= 1 ? 'full' : p >= .6 ? 'mid' : ''}"><span><b>${left}</b> of ${e.capacity} slots left</span><i><i style="width:${Math.round(p * 100)}%"></i></i></span>`; };
const evtTile = e => `<span class="evt-tile${e.status === 'cancelled' ? ' off' : ''}${evtMulti(e) ? ' multi' : ''}">${evtDay(e.starts_at)}${evtMulti(e) ? `<span class="evt-arr" aria-label="to">↓</span>${evtDay(e.ends_at)}` : ''}</span>`;
const mapsUrl = e => e.map_url || (e.location ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.location) : '');
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
let evLoading = null;
async function loadEvents(force) {
    if (!force && state.evd && Date.now() - state.evd.at < 60e3) return state.evd;
    if (evLoading) return evLoading;                     /* one request at a time, shared by every screen */
    evLoading = Promise.all([api.events(), api.eventCounts().catch(() => []), api.myRsvps().catch(() => [])]).then(([events, counts, mine]) =>
        state.evd = { at: Date.now(), events, counts: Object.fromEntries(counts.map(c => [c.event_id, c])), mine: Object.fromEntries(mine.filter(r => r.status === 'going').map(r => [r.event_id, r])) });   /* Going only (file 86) */
    try { return await evLoading; } finally { evLoading = null; }
}
/* Events open straight away from what's already loaded; fresh data is fetched in the background and the
   screen only redraws (without the entrance animation) if something actually changed and the rider is still on it. */
const evSig = d => JSON.stringify([d.events, d.counts, d.mine]);
function eventsRefresh(n) {
    if (state.evd && Date.now() - state.evd.at < 15e3) return;
    const before = state.evd ? evSig(state.evd) : '';
    loadEvents(true).then(d => { if (stillHere(n) && evSig(d) !== before) render(); }).catch(() => {});
}
async function viewEvents() {
    const n = navN;
    let d = state.evd || await loadEvents(true);
    /* a link to an event that isn't loaded yet (just posted): fetch before saying it's gone */
    if (state.param && !d.events.some(x => String(x.id) === state.param) && Date.now() - d.at > 3e3) d = await loadEvents(true);
    eventsRefresh(n);
    if (state.param) { const e = d.events.find(x => String(x.id) === state.param); if (e) return eventPage(e); toast('That event is no longer available', true); }
    const tab = state.evtTab || 'up';
    const up = d.events.filter(e => !evtPast(e)), past = d.events.filter(evtPast).reverse();
    const list = tab === 'up' ? up : past;
    app.innerHTML = top('Events') + `
        ${isMod() ? '<button class="btn block evt-create" data-act="evt-new">＋ Create event</button>' : ''}
        ${isAdmin() ? '<button class="btn ghost block" data-act="evt-import" style="margin-top:8px">⇩ Import past events from the website sheet</button>' : ''}
        <div class="seg" role="tablist" style="margin-top:${isMod() ? 14 : 0}px"><button role="tab" aria-selected="${tab === 'up'}" data-act="evt-tab" data-t="up">Upcoming${up.length ? ` (${up.length})` : ''}</button><button role="tab" aria-selected="${tab === 'past'}" data-act="evt-tab" data-t="past">Past</button></div>
        ${list.length ? `<div class="list">${list.map(e => eventCard(e, d)).join('')}</div>`
            : `<div class="card empty"><b>${tab === 'up' ? 'No upcoming events' : 'No past events yet'}</b>${tab === 'up' ? (isMod() ? 'Create a ride or meet-up and every member gets a notification.' : 'Rides and meet-ups posted by the RWB team show up here.') : ''}</div>`}`;
    actions = { evt: el => location.hash = '#events/' + el.dataset.id, 'evt-new': () => eventForm(), 'evt-import': () => importSheetEvents(), 'evt-tab': el => { state.evtTab = el.dataset.t; viewEvents(); } };
}
function faceStack(faces = [], more = 0) {
    return `<span class="faces">${faces.map(f => face(f, 'avatar xs')).join('')}${more > 0 ? `<span class="avatar xs more">+${more}</span>` : ''}</span>`;
}
/* Events v2 (file 86): only "Going", a landscape cover photo (like WhatsApp events), team-only WhatsApp sharing */
const evtCover = (e, cls = '') => e.cover_url
    ? `<span class="evt-cover ${cls}"><img src="${esc(e.cover_url)}" alt="" loading="lazy" onload="this.classList.add('in')" onerror="this.parentNode.classList.add('none')"></span>`
    : `<span class="evt-cover blank ${cls}"><b>${esc(tfmt(e.starts_at, { day: 'numeric' }))}</b><em>${esc(tfmt(e.starts_at, { month: 'short' }))}</em></span>`;
function eventCard(e, d) {
    const c = d.counts[e.id] || { going: 0, guests: 0, faces: [] }, me = d.mine[e.id], fam = isFam();
    const n = c.going + c.guests, past = evtPast(e), off = e.status === 'cancelled';
    return `<button class="card tap evt-card v2${off ? ' cancelled' : ''}${past ? ' past' : ''}" data-act="evt" data-id="${e.id}">
        ${evtCover(e, 'sm')}
        <span class="evt-cbody">
            <span class="evt-crow">${evtTile(e)}<span class="grow">${evtEyebrow(e)}<b>${esc(e.title)}</b><span class="evt-fact">${EVT_ICON.clock}${esc(evtWhen(e, true))}</span>${e.location ? `<span class="evt-fact">${EVT_ICON.pin}${esc(e.location)}</span>` : ''}${!off && !past ? evtSlots(e, n) : ''}</span></span>
            <span class="evt-meta">${off ? '<span class="badge">Cancelled</span>' : fam ? '<span class="small muted">RWB event</span>' : `${n ? faceStack(c.faces, c.going - c.faces.length) : ''}<span class="small muted">${n ? `${n} ${past ? 'went' : 'going'}` : past ? 'Past event' : 'Be the first to join'}</span>`}
                ${me ? `<span class="evt-me going">${past ? 'You went' : "You're going"}</span>` : !off && !past && !fam ? '<span class="evt-me ask">Join</span>' : ''}</span>
        </span></button>`;
}
state.evPeople = {};
async function eventPage(e) {
    const n = navN, d = state.evd, me = d.mine[e.id], mod = isMod(), myUid = state.myId ??= await api.myId(), fam = isFam();
    /* who's going: shown from the last visit straight away, then refreshed */
    const cached = state.evPeople[e.id], people = fam ? [] : (cached || []).filter(p => p.status === 'going');
    if (!fam) api.eventPeople(e.id).then(p => {
        state.evPeople[e.id] = p;
        if (!stillHere(n)) return;
        if (!cached || JSON.stringify(p) !== JSON.stringify(cached)) render(); else if (me || mod) drawExpenses(e, p.filter(x => x.status === 'going'), myUid);
    }).catch(() => { if (!cached) { state.evPeople[e.id] = []; if (stillHere(n)) render(); } });
    const going = people, guests = going.reduce((a, p) => a + p.guests, 0), cnt = d.counts[e.id];
    const headcount = cached ? going.length + guests : cnt ? cnt.going + cnt.guests : 0;
    const live = e.status === 'live', past = evtPast(e), full = !!e.capacity && headcount >= e.capacity;
    /* the RWB team (admins + coordinators) can add or take anyone off the list (file 86), also after the event */
    const team = mod && !fam && live && !!cached && people.every(p => 'member_id' in p);
    const row = p => `<div class="row">${face(p, 'avatar sm')}<span class="grow">${esc(p.full_name)}${p.user_id && p.user_id === myUid ? ' <span class="muted">(you)</span>' : ''}${p.set_by_name || (mod && p.on_app === false) ? `<span class="evt-by">${[mod && p.on_app === false ? 'Not on the app' : '', p.set_by_name ? 'Added by ' + esc(p.set_by_name) : ''].filter(Boolean).join(' · ')}</span>` : ''}</span>${p.guests ? '<span class="badge">+1 guest</span>' : ''}${team && p.member_id != null ? `<button class="evt-pm" data-act="evt-pm" data-m="${p.member_id}" aria-label="Change ${esc(p.full_name)}">${EVT_ICON.edit}</button>` : ''}</div>`;
    const when = evtMulti(e)
        ? `<div><span>Starts</span><b>${esc(tfmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><em>${esc(evtTime(e.starts_at))}</em></div><i class="evt-wto" aria-hidden="true">→</i><div><span>Ends</span><b>${esc(tfmt(e.ends_at, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><em>${esc(evtTime(e.ends_at))}</em></div>`
        : `<div><span>When</span><b>${esc(tfmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><em>${esc(evtTime(e.starts_at))}${e.ends_at ? ' – ' + esc(evtTime(e.ends_at)) : ''}</em></div>`;
    const calBtn = live && !past ? `<a class="evt-calbtn" href="${esc(gcalUrl(e))}" target="_blank" rel="noopener" aria-label="Add to calendar">${ICON.cal}</a>` : '';
    const join = !live || past || fam ? (calBtn ? `<div class="evt-jrow">${calBtn}</div>` : '')
        : `<div class="evt-jrow">${me ? `<div class="evt-join on"><span class="evt-yes">✓ You're going</span><button class="link-btn" data-act="rsvp" data-s="no">Not going</button></div>`
            : full ? '<button class="btn evt-go" disabled>Event full</button>' : '<button class="btn evt-go" data-act="rsvp" data-s="going">I\'m going 🏍️</button>'}${calBtn}</div>
            ${me && e.allow_guests ? `<label class="switch evt-guestsw">Bringing a guest (+1)<input type="checkbox" id="evt-guest"${me.guests ? ' checked' : ''}></label>` : ''}`;
    app.innerHTML = top('Events') + `
        <a class="back-link" href="#events">‹ All events</a>
        <section class="card evt-hero v2${live ? '' : ' cancelled'}">
            <div class="evt-cwrap">${evtCover(e, 'big')}${mod && !fam ? `<button class="evt-sharebtn" data-act="evt-share" aria-label="Share event">${EVT_ICON.share}</button>` : ''}</div>
            <div class="evt-hbody">
                ${evtEyebrow(e)}<h2 class="evt-title">${esc(e.title)}</h2>${!live ? '<span class="badge">Cancelled</span>' : past ? '<span class="badge">Ended</span>' : ''}
                <div class="evt-when">${when}</div>
                ${e.location ? `<div class="evt-place v2">${EVT_ICON.pin}<b>${esc(e.location)}</b>${mapsUrl(e) ? `<a href="${esc(mapsUrl(e))}" target="_blank" rel="noopener">Maps ↗</a>` : ''}</div>` : ''}
                ${live && !past && e.capacity ? evtSlots(e, headcount) : ''}
                ${e.call_link || (e.reminder_minutes != null && live && !past) ? `<div class="evt-chips">${e.call_link ? `<a href="${esc(safeUrl(e.call_link))}" target="_blank" rel="noopener">📞 Join the call</a>` : ''}${e.reminder_minutes != null && live && !past ? `<span>⏰ Reminder ${esc(REMINDERS.find(r => r[0] === e.reminder_minutes)?.[1].toLowerCase() || '')}</span>` : ''}</div>` : ''}
                ${join}
            </div>
        </section>
        ${e.description ? `<section class="section"><h2>About</h2><div class="card evt-about"><p class="evt-desc clamp" id="evt-desc">${linkify(e.description)}</p><button class="link-btn evt-more" id="evt-more" hidden>Show more</button></div></section>` : ''}
        ${rideLive(e)}
        ${fam ? '' : `<section class="section"><div class="evt-whohead"><h2>${past ? 'Who went' : "Who's going"}${cached && headcount ? ` <span class="muted">${headcount}</span>` : ''}</h2>${team ? `<span class="btns">${going.length ? '<button class="btn sm ghost" data-act="evt-copy">Share list</button>' : ''}<button class="btn sm" data-act="evt-add">＋ Add rider</button></span>` : ''}</div>
            <div class="card">${!cached ? SKEL(2) : going.length ? `<div class="evt-plist">${going.map(row).join('')}</div>${guests ? `<p class="small muted" style="margin-top:10px">${going.length} rider${going.length === 1 ? '' : 's'} + ${guests} guest${guests === 1 ? '' : 's'}</p>` : ''}` : `<p class="muted small">${past ? 'Nobody was on the list.' : 'Nobody yet. Be the first!'}</p>`}</div></section>
        <section class="section" id="exp-sec"><h2>Expenses</h2><div id="exp-body">${me || mod ? SKEL(2) : `<div class="card empty"><b>Split costs with the group</b>Join the event to see and add shared expenses.</div>`}</div></section>`}
        ${mod ? `<section class="section"><h2>Organiser</h2><div class="btns">${live ? '<button class="btn ghost" data-act="evt-edit">Edit</button><button class="btn ghost" data-act="evt-cancel">Cancel event</button>' : ''}<button class="btn danger" data-act="evt-del">Delete</button></div></section>` : ''}`;
    actions = {
        rsvp: b => busy(b, async () => { const go = b.dataset.s === 'going';
            if (!go && !confirmBox(`Not going to “${e.title}” anymore?`)) return;
            await api.rsvp(e.id, go ? 'going' : 'no', 0); delete state.evPeople[e.id]; await loadEvents(true); toast(go ? "You're going 🏍️ Everyone can see you joined." : "You're off the list"); render(); }),
        'evt-share': b => { if (b.disabled) return; b.disabled = true; shareEvent(e, headcount).catch(er => toast(er.message || 'Could not share', true)).finally(() => { b.disabled = false; }); },
        'evt-edit': () => eventForm(e),
        'evt-add': () => evtTeamFind(e),
        'evt-pm': b => { const p = people.find(x => String(x.member_id) === b.dataset.m); if (p) evtTeamPick(e, { member_id: p.member_id, full_name: p.full_name, nickname: p.nickname, avatar_url: p.avatar_url, on_app: p.on_app, status: 'going', guests: p.guests }); },
        'evt-copy': () => evtShareList(e, going),
        'evt-track-share': () => shareSheet(e.id, e.title),
        'evt-cancel': b => { if (confirmBox(`Cancel “${e.title}”? Everyone gets a notification.`)) busy(b, async () => { await api.saveEvent({ id: e.id, status: 'cancelled' }); await loadEvents(true); toast('Event cancelled'); render(); }); },
        'evt-del': b => { if (confirmBox(`Delete “${e.title}” with its RSVPs and expenses? This can't be undone.`)) busy(b, async () => { if (e.cover_url) await api.eventCover(e.id, null).catch(() => {}); await api.deleteEvent(e.id); await loadEvents(true); location.hash = '#events'; toast('Deleted'); }); }
    };
    const g = $('#evt-guest'); if (g) g.onchange = () => busy(null, async () => { try { await api.rsvp(e.id, 'going', g.checked ? 1 : 0); } catch (er) { g.checked = false; throw er; } delete state.evPeople[e.id]; await loadEvents(true); toast(g.checked ? 'Guest added' : 'Guest removed'); render(); });
    if (!fam && cached && (me || mod)) drawExpenses(e, going, myUid);
    const dsc = $('#evt-desc'), more = $('#evt-more');   /* About: 3 lines, Show more / Show less */
    if (dsc && more) { if (dsc.scrollHeight > dsc.clientHeight + 4) { more.hidden = false; more.onclick = () => { const open = dsc.classList.toggle('clamp'); more.textContent = open ? 'Show more' : 'Show less'; }; } else dsc.classList.remove('clamp'); }
}
/* ---- WhatsApp sharing: only admins and coordinators (members open the event in the app) ---- */
function eventShareText(e, heads) {
    return `📅 *${e.title}*${e.tag ? ` · ${e.tag}` : ''}\n🗓 ${evtWhen(e)}${e.location ? `\n📍 ${e.location}${mapsUrl(e) ? '\n🗺 ' + mapsUrl(e) : ''}` : ''}${e.capacity ? `\n🎟 ${Math.max(e.capacity - heads, 0)} of ${e.capacity} slots left` : heads ? `\n🏍️ ${heads} going` : ''}${e.description ? `\n\n${e.description}` : ''}\n\n👉 Join in the RWB App: https://roninwb.in/app/#events/${e.id}`;
}
/* The event's share card: a 1080×1350 picture (fits WhatsApp, Instagram and Facebook) with the cover, title, date, place
   and slots, shared with the event text through the phone's share menu (admins and coordinators only). */
const cardImg = src => new Promise((res, rej) => { const i = new Image(); if (!src.startsWith('data:')) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function eventCard1080(e, heads) {
    const W = 1080, H = 1350, CH = 560, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), D = "'Barlow Condensed','Arial Narrow',sans-serif", B = "'Barlow',system-ui,sans-serif";
    await Promise.all(['800 100px "Barlow Condensed"', '600 40px "Barlow"', '700 40px "Barlow"'].map(f => document.fonts?.load(f).catch(() => {})));
    x.fillStyle = '#0f0b09'; x.fillRect(0, 0, W, H);
    /* cover, or the orange banner */
    let cover = null; if (e.cover_url) cover = await cardImg(e.cover_url).catch(() => null);
    if (cover) { const r = Math.max(W / cover.naturalWidth, CH / cover.naturalHeight), w = cover.naturalWidth * r, h = cover.naturalHeight * r; x.save(); x.beginPath(); x.rect(0, 0, W, CH); x.clip(); x.drawImage(cover, (W - w) / 2, (CH - h) / 2, w, h); x.restore(); }
    else { const g = x.createLinearGradient(0, 0, W, CH); g.addColorStop(0, '#3a1d0e'); g.addColorStop(.55, '#a8431a'); g.addColorStop(1, '#f0712f'); x.fillStyle = g; x.fillRect(0, 0, W, CH);
        x.fillStyle = 'rgba(255,255,255,.95)'; x.font = `800 260px ${D}`; x.textBaseline = 'alphabetic'; x.fillText(tfmt(e.starts_at, { day: 'numeric' }), 64, CH - 110);
        x.font = `700 64px ${B}`; x.fillText(tfmt(e.starts_at, { month: 'long' }).toUpperCase(), 72, CH - 40); }
    const fade = x.createLinearGradient(0, CH - 220, 0, CH + 2); fade.addColorStop(0, 'rgba(15,11,9,0)'); fade.addColorStop(1, '#0f0b09'); x.fillStyle = fade; x.fillRect(0, CH - 220, W, 222);
    /* text */
    let y = CH + 40; const L = 72, maxW = W - 2 * L;
    const pill = (t, px, py, bg, fg, f) => { x.font = f; const w = x.measureText(t).width + 56; x.fillStyle = bg; x.beginPath(); x.roundRect(px, py, w, 72, 36); x.fill(); x.fillStyle = fg; x.textBaseline = 'middle'; x.fillText(t, px + 28, py + 38); return w; };
    const when = `${tfmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })} · ${evtTime(e.starts_at)}`.toUpperCase();
    pill(when, L, y - 36, '#f0712f', '#fff', `700 34px ${B}`);
    y += 90;
    if (e.tag) { x.font = `700 30px ${B}`; x.fillStyle = '#f5a06d'; x.textBaseline = 'alphabetic'; x.fillText([...e.tag.toUpperCase()].join(String.fromCharCode(8202)), L, y); y += 22; }
    x.font = `800 104px ${D}`; x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
    const words = e.title.toUpperCase().split(/\s+/), lines = []; let ln = '';
    for (const w of words) { const t = ln ? ln + ' ' + w : w; if (x.measureText(t).width > maxW && ln) { lines.push(ln); ln = w; } else ln = t; }
    if (ln) lines.push(ln);
    if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/\s*\S*$/, '') + '…'; }
    for (const t of lines) { y += 96; x.fillText(t, L, y); }
    y += 24;
    const fact = (icon, t) => { if (y > H - 230) return; y += 60; x.font = `600 40px ${B}`; x.fillStyle = '#f0712f'; x.fillText(icon, L, y); x.fillStyle = 'rgba(255,255,255,.88)';
        let s2 = t; while (x.measureText(s2).width > maxW - 64 && s2.length > 4) s2 = s2.slice(0, -2); x.fillText(s2 === t ? t : s2 + '…', L + 64, y); };
    if (evtMulti(e)) fact('⏱', `Till ${tfmt(e.ends_at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${evtTime(e.ends_at)}`);
    else if (e.ends_at) fact('⏱', `${evtTime(e.starts_at)} – ${evtTime(e.ends_at)}`);
    if (e.location) fact('📍', e.location);
    if (e.capacity) fact('🎟', `${Math.max(e.capacity - heads, 0)} of ${e.capacity} slots left`);
    else if (heads) fact('🏍', `${heads} rider${heads === 1 ? '' : 's'} going`);
    await cardBrand(x, W, H, 'JOIN THE RIDE');
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    return new File([blob], `rwb-${(e.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event'}.jpg`, { type: 'image/jpeg' });
}
/* the RWB bar at the bottom of every share card: club logo, name, roninwb.in and a button */
async function cardBrand(x, W, H, cta) {
    const L = 72, D = "'Barlow Condensed','Arial Narrow',sans-serif", B = "'Barlow',system-ui,sans-serif", by = H - 150;
    x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(0, by - 2, W, 2);
    const logo = await cardImg('icons/logo-384.png').catch(() => null);
    if (logo) { x.save(); x.beginPath(); x.arc(L + 48, by + 74, 48, 0, Math.PI * 2); x.clip(); x.drawImage(logo, L, by + 26, 96, 96); x.restore(); }
    x.font = `700 32px ${B}`; const jw = x.measureText(cta).width + 64;
    const jg = x.createLinearGradient(W - L - jw, 0, W - L, 0); jg.addColorStop(0, '#ffa766'); jg.addColorStop(1, '#cf5119');
    x.fillStyle = jg; x.beginPath(); x.roundRect(W - L - jw, by + 40, jw, 72, 36); x.fill(); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(cta, W - L - jw + 32, by + 78);
    const fit = (t, mw) => { while (x.measureText(t).width > mw && t.length > 3) t = t.slice(0, -2).trimEnd() + '…'; return t; }, tw = W - L - jw - 28 - (L + 124);
    x.textBaseline = 'alphabetic'; x.fillStyle = '#fff'; x.font = `800 46px ${D}`; x.fillText('RWB', L + 124, by + 70);
    x.fillStyle = 'rgba(255,255,255,.62)'; x.font = `600 26px ${B}`; x.fillText(fit('Ronin Warriors of Bengal · roninwb.in', tw), L + 124, by + 108);
}
/* hand a share card to the phone: the Android app's share menu, the browser's, or a sheet to save it */
async function shareCard(file, text, title) {
    const T = RwbTrack();
    if (T?.shareImage) { try { await T.shareImage({ data: await blobB64(file), name: file.name, text, title }); return; } catch (er) { if (!/not implemented|unimplemented/i.test(er?.message || '')) throw er; } }
    try { if (navigator.canShare?.({ files: [file], text })) { await navigator.share({ files: [file], text }); return; } }
    catch (er) { if (er?.name === 'AbortError') return; }
    const url = URL.createObjectURL(file);
    openSheet('Share', `<img class="evt-cardprev" src="${url}" alt="">
        <div class="btns" style="margin-top:12px"><a class="btn" href="${url}" download="${esc(file.name)}">Save picture</a>${text ? '<button class="btn ghost" data-x="wa">WhatsApp text</button>' : ''}</div>`, body => {
        const wa = body.querySelector('[data-x=wa]'); if (wa) wa.onclick = () => openWA(waShare(text));
    });
}
const blobB64 = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(b); });
async function shareEvent(e, heads) {
    await shareCard(await eventCard1080(e, heads), eventShareText(e, heads), e.title);
}
function evtShareList(e, going) {
    const total = going.length + going.reduce((a, p) => a + p.guests, 0);
    const text = `📅 *${e.title}*\n🗓 ${evtWhen(e)}\n\n*${evtPast(e) ? 'Went' : 'Going'} (${total})*\n${going.map((p, i) => `${i + 1}. ${p.full_name}${p.nickname ? ` (${p.nickname})` : ''}${p.guests ? ' +1 guest' : ''}`).join('\n')}${evtPast(e) ? '' : `\n\n👉 Not on the list? Join in the RWB App: https://roninwb.in/app/#events/${e.id}`}`;
    openWA(waShare(text));
}
/* ---- RWB team: manage who's going (file 86) ---- */
const teamErr = er => /event_(team_set|find_members)|schema cache|function/i.test(er?.message || '') ? new Error('This needs a quick update on the RWB server first. Please try again later.') : er;
async function evtTeamSaved(e, msg) {
    delete state.evPeople[e.id];
    const [p] = await Promise.all([api.eventPeople(e.id).catch(() => null), loadEvents(true)]);
    if (p) state.evPeople[e.id] = p;
    toast(msg);
    if (location.hash === '#events/' + e.id) render();
}
/* search members (name, nickname, bike number or last 4+ digits of the phone) */
function evtTeamFind(e) {
    openSheet('Add a rider', `<input type="search" id="evf-q" class="evt-find" placeholder="Name, nickname, bike number or phone" autocomplete="off" enterkeyhint="search" aria-label="Search members">
        <div id="evf-res" class="group evt-findres"></div>`, body => {
        const q = body.querySelector('#evf-q'), res = body.querySelector('#evf-res'); let t, seq = 0, rows = [];
        const draw = () => { res.innerHTML = rows.length ? rows.map((m, i) => `<button class="bike-row evt-fr" data-i="${i}">${face(m, 'avatar sm')}<span class="grow"><b>${esc(m.full_name)}</b><span class="small muted">${[m.nickname, m.vrn, m.on_app ? '' : 'Not on the app'].filter(Boolean).map(esc).join(' · ')}</span></span>${m.status === 'going' ? '<span class="evt-me going">Going</span>' : '<span class="evt-add-go">＋</span>'}</button>`).join('')
            : q.value.trim().length >= 2 ? '<p class="small muted" style="padding:12px">No member found. Try another spelling, the bike number or the phone number.</p>' : ''; };
        const run = async () => { const v = q.value.trim(), my = ++seq; if (v.length < 2) { rows = []; draw(); return; }
            try { const r = await api.eventFind(e.id, v); if (my === seq) { rows = r; draw(); } } catch (er) { if (my === seq) toast(teamErr(er).message, true); } };
        q.oninput = () => { clearTimeout(t); t = setTimeout(run, 300); };
        res.onclick = ev => { const b = ev.target.closest('.evt-fr'); if (!b) return; const m = rows[+b.dataset.i];
            if (m.status === 'going') return evtTeamPick(e, m, true);
            const nm = m.nickname || m.full_name.split(' ')[0];
            busy(b, async () => { try { await api.eventTeamSet(e.id, m.member_id, 'going', 0); } catch (er) { throw teamErr(er); }
                m.status = 'going'; draw(); toast(`${nm} is on the Going list`); evtTeamSaved(e, `${nm} is on the Going list`).catch(() => {}); }); };
        setTimeout(() => q.focus(), 60);
    });
}
/* one member on the list: +1 guest, or take them off */
function evtTeamPick(e, m, fromFind = false) {
    const name = m.nickname || (m.full_name || '').split(' ')[0] || 'this rider', past = evtPast(e);
    openSheet(m.full_name || 'Rider', `<div class="row" style="margin-bottom:12px">${face(m, 'avatar')}<span class="grow"><b>${esc(m.full_name)}</b><span class="small muted" style="display:block">On the ${past ? 'Went' : 'Going'} list${m.on_app ? '' : ' · not on the app yet'}</span></span></div>
        ${e.allow_guests ? `<label class="switch">Bringing a guest (+1)<input type="checkbox" id="evt-tg"${m.guests ? ' checked' : ''}></label>` : ''}
        <button class="btn ghost block evt-offbtn" data-x="off" style="margin-top:14px">Take ${esc(name)} off the list</button>
        ${fromFind ? '<button class="btn ghost block" data-x="back" style="margin-top:8px">‹ Back to search</button>' : ''}`, body => {
        const set = (b, st, guests = 0) => busy(b, async () => {
            try { await api.eventTeamSet(e.id, m.member_id, st, guests); } catch (er) { throw teamErr(er); }
            closeSheet();
            await evtTeamSaved(e, st === null ? `${name} taken off the list` : guests ? `+1 guest added for ${name}` : `Guest removed for ${name}`);
        });
        body.querySelector('[data-x=off]').onclick = ev => set(ev.currentTarget, null);
        const g = body.querySelector('#evt-tg'); if (g) g.onchange = () => set(null, 'going', g.checked ? 1 : 0);
        const bk = body.querySelector('[data-x=back]'); if (bk) bk.onclick = () => evtTeamFind(e);
    });
}
function gcalUrl(e) {
    const z = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 36e5).toISOString();
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${z(e.starts_at)}/${z(end)}&details=${encodeURIComponent((e.description || '') + '\n\nhttps://roninwb.in/app/#events/' + e.id)}&location=${encodeURIComponent(e.location || '')}`;
}
/* One-time move: the website's old events sheet → past events in the app (no notifications) */
function csvRows(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) { const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; } else cur += c; }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const heads = (rows.shift() || []).map(h => h.trim().toLowerCase().replace(/[\s_]+/g, ''));
    return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(heads.map((h, i) => [h, (r[i] || '').trim()])));
}
function sheetDate(d, t) {
    let m = String(d || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), y, mo, da;
    if (m) [, y, mo, da] = m; else { m = String(d || '').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (!m) return null; [, da, mo, y] = m; }
    const tm = String(t || '').match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
    let h = tm ? +tm[1] : 6; const mi = tm && tm[2] ? +tm[2] : 0; if (tm && tm[3]) { if (/pm/i.test(tm[3]) && h < 12) h += 12; if (/am/i.test(tm[3]) && h === 12) h = 0; }
    const pad = x => String(x).padStart(2, '0');
    return `${y}-${pad(mo)}-${pad(da)}T${pad(h)}:${pad(mi)}:00+05:30`;
}
async function importSheetEvents() {
    const SITE = typeof CONFIG !== 'undefined' ? CONFIG : {};   /* the website's settings (js/data.js) */
    const url = SITE.EVENTS_SHEET_URL; if (!url) return toast('The website events sheet link was not found', true);
    toast('Reading the website events sheet…');
    let text = '';
    try { text = await fetch(url).then(r => { if (!r.ok) throw 0; return r.text(); }); }
    catch { try { text = await fetch(SITE.CORS_PROXY + encodeURIComponent(url)).then(r => r.text()); } catch { return toast('Could not read the sheet. Check your internet and try again.', true); } }
    const today = todayISO();
    const rows = csvRows(text).filter(r => r.title).map(r => {
        const d1 = r.eventdate || r.date, d2 = r.enddate, times = String(r.time || '').split(/[–—-]|\bto\b/i);
        const starts_at = sheetDate(d1, times[0]);
        let ends_at = d2 && d2 !== d1 ? sheetDate(d2, times[1] || '8 PM') : times[1] ? sheetDate(d1, times[1]) : null;
        return { title: r.title, description: r.description || r.desc || '', location: r.location || '', tag: r.tag || '', capacity: r.totalslots || '', starts_at, ends_at, past: (d2 || d1 || '') < today && !!starts_at };
    }).filter(x => x.starts_at);
    const past = rows.filter(x => new Date(x.ends_at || x.starts_at) < new Date());
    openSheet('Import past events', `<p class="small muted" style="margin-bottom:10px">${past.length} past event${past.length === 1 ? '' : 's'} found in the website sheet. They're added to the app as past events (no notifications), and stay on roninwb.in. Events already imported are skipped.${rows.length > past.length ? ` ${rows.length - past.length} upcoming one${rows.length - past.length === 1 ? ' is' : 's are'} left out: create upcoming events in the app.` : ''}</p>
        <div class="group">${past.map(x => `<div class="bike-row"><span class="g-ico">📅</span><span class="grow"><b>${esc(x.title)}</b><span class="small muted">${esc(fmtDate(x.starts_at.slice(0, 10)))}${x.location ? ' · ' + esc(x.location) : ''}${x.tag ? ' · ' + esc(x.tag) : ''}</span></span></div>`).join('') || '<p class="small muted" style="padding:12px">Nothing to import.</p>'}</div>
        ${past.length ? `<button class="btn block" data-x="go" style="margin-top:14px">Import ${past.length} event${past.length === 1 ? '' : 's'}</button>` : ''}`, body => {
        const go = body.querySelector('[data-x=go]');
        if (go) go.onclick = () => busy(go, async () => { const n = await api.importEvents(past.map(({ past: _, ...x }) => x)); await loadEvents(true); closeSheet(); toast(n ? `${n} past event${n === 1 ? '' : 's'} added` : 'Already imported'); state.evtTab = 'past'; render(); });
    });
}
/* event cover: crop to 16:9 (pos 0–1 slides the crop along the long side) and shrink to ≤ ~260 KB WebP (JPEG where WebP can't be made) */
async function makeCover(img, pos = .5) {
    const W0 = img.naturalWidth, H0 = img.naturalHeight, R = 16 / 9;
    let sw = W0, sh = W0 / R, sx = 0, sy = (H0 - sh) * pos;
    if (sh > H0) { sh = H0; sw = H0 * R; sy = 0; sx = (W0 - sw) * pos; }
    let blob;
    for (const [w0, q] of [[1280, .74], [1280, .62], [1024, .6], [880, .55]]) {
        const w = Math.min(w0, Math.round(sw)), h = Math.round(w / R);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h); cx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        blob = await new Promise(r => cv.toBlob(r, 'image/webp', q));
        if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q + .06));
        if (blob.size <= 260e3) break;
    }
    return new File([blob], blob.type === 'image/webp' ? 'cover.webp' : 'cover.jpg', { type: blob.type });
}
const EVT_TAGS = ['Small Ride', 'Sunday Highs Ride', 'Long Tour', 'Training Session', 'Service Camp', 'Event'];
function eventForm(e = null) {
    const r = e ? { ...e } : { reminder_minutes: 60, allow_guests: false };
    const tagPick = !r.tag ? '' : EVT_TAGS.includes(r.tag) ? r.tag : 'Custom';
    const start = toLocalInput(r.starts_at), end = toLocalInput(r.ends_at), sameDay = !end || end.slice(0, 10) === start.slice(0, 10);
    const cov = { url: r.cover_url || null, img: null, pos: .5, file: null, changed: false };
    openSheet(e ? 'Edit event' : 'Create event', `<form id="evf" class="evt-form">
        <div class="evt-cpick"><button type="button" class="evt-cprev" id="cv-prev" aria-label="Cover photo"></button>
            <input type="file" id="cv-file" accept="${PHOTO_ACCEPT}" hidden>
            <label id="cv-pos-wrap" hidden>Move the photo<input type="range" id="cv-pos" min="0" max="100" value="50"></label>
            <div class="btns" id="cv-btns"></div>
</div>
        <input name="title" class="evt-name" required maxlength="100" placeholder="Event name" value="${esc(r.title || '')}" aria-label="Event name">
        <textarea name="description" maxlength="2000" placeholder="Description (optional)" aria-label="Description">${esc(r.description || '')}</textarea>
        <div class="grid2"><label>Date<input type="date" name="d1" required value="${start.slice(0, 10)}"></label><label>Time<input type="time" name="t1" required value="${start.slice(11, 16)}"></label></div>
        <label class="switch"><span>Same day<span class="hint" style="display:block">Turn off for trips or rides that end on another day</span></span><input type="checkbox" id="same-day"${sameDay ? ' checked' : ''}></label>
        <div class="grid2" id="end-wrap"><label id="d2-wrap"${sameDay ? ' hidden' : ''}>End date<input type="date" name="d2" value="${end.slice(0, 10)}"></label><label>End time <span class="hint" id="t2-hint"${sameDay ? '' : ' hidden'}>(optional)</span><input type="time" name="t2" value="${end.slice(11, 16)}"></label></div>
        <label>Location<input name="location" maxlength="200" placeholder="e.g. Nicco Park gate, Salt Lake" value="${esc(r.location || '')}"></label>
        <label>Google Maps link <span class="hint">(optional; we'll search the location if empty)</span><input name="map_url" type="url" inputmode="url" placeholder="https://maps.app.goo.gl/…" value="${esc(r.map_url || '')}"></label>
        <label>Call link <span class="hint">(optional, WhatsApp or Meet)</span><input name="call_link" type="url" inputmode="url" placeholder="https://call.whatsapp.com/…" value="${esc(r.call_link || '')}"></label>
        <label>Reminder<select name="reminder">${REMINDERS.map(([v, t]) => `<option value="${v ?? ''}"${v === r.reminder_minutes ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="grid2"><label>Tag <span class="hint">(optional)</span><select name="tag_pick">${['', ...EVT_TAGS, 'Custom'].map(t => `<option value="${esc(t)}"${t === tagPick ? ' selected' : ''}>${t ? esc(t) : 'No tag'}</option>`).join('')}</select></label>
            <label>Slots <span class="hint">(optional)</span><input name="capacity" type="number" inputmode="numeric" min="1" max="10000" placeholder="No limit" value="${r.capacity || ''}"></label></div>
        <label id="tag-custom"${tagPick === 'Custom' ? '' : ' hidden'}>Custom tag<input name="tag" maxlength="40" placeholder="e.g. Night Ride" value="${esc(tagPick === 'Custom' ? r.tag || '' : '')}"></label>
        <label class="switch"><span>Show on roninwb.in<span class="hint" style="display:block">Title, date, place and slots left appear on the website's Events</span></span><input type="checkbox" name="on_website"${r.on_website !== false ? ' checked' : ''}></label>
        <label class="switch"><span>Allow guests<span class="hint" style="display:block">People can bring one additional guest</span></span><input type="checkbox" name="allow_guests"${r.allow_guests ? ' checked' : ''}></label>
        <button class="btn block">${e ? 'Save changes' : 'Publish event'}</button>
        ${e ? '' : '<p class="small muted" style="text-align:center">Every member gets a notification.</p>'}</form>`, body => {
        const f = body.querySelector('#evf'), sd = body.querySelector('#same-day');
        /* cover photo: picked, cropped to 16:9 and shrunk on the phone; saved after the event */
        const cvPrev = body.querySelector('#cv-prev'), cvFile = body.querySelector('#cv-file'), cvPos = body.querySelector('#cv-pos'), cvBtns = body.querySelector('#cv-btns');
        const cvDraw = () => {
            const src = cov.file ? URL.createObjectURL(cov.file) : cov.url;
            cvPrev.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '<span class="evt-cadd"><b>＋</b>Add a cover photo</span>';
            cvPrev.classList.toggle('has', !!src);
            cvBtns.innerHTML = src ? '<button type="button" class="btn sm ghost" data-c="pick">Change photo</button><button type="button" class="btn sm ghost" data-c="del">Remove</button>' : '';
            const r0 = cov.img ? (cov.img.naturalWidth / cov.img.naturalHeight) : 16 / 9;
            body.querySelector('#cv-pos-wrap').hidden = !cov.img || Math.abs(r0 - 16 / 9) < .08;
        };
        const cvMake = async () => { cov.file = await makeCover(cov.img, cov.pos); cov.changed = true; cvDraw(); };
        cvPrev.onclick = () => cvFile.click();
        cvBtns.onclick = ev => { const c = ev.target.closest('[data-c]')?.dataset.c; if (c === 'pick') cvFile.click(); if (c === 'del') { cov.file = null; cov.img = null; cov.url = null; cov.changed = true; cvDraw(); } };
        cvFile.onchange = () => { const fl = cvFile.files[0]; cvFile.value = ''; if (fl) busy(null, async () => { cov.img = await loadImage(fl); cov.pos = .5; cvPos.value = 50; await cvMake(); }); };
        let cvT; cvPos.oninput = () => { cov.pos = cvPos.value / 100; clearTimeout(cvT); cvT = setTimeout(() => cvMake().catch(() => {}), 120); };
        cvDraw();
        const nextDay = d => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + 1); return x.toLocaleDateString('en-CA'); };
        const syncEnd = () => {
            const same = sd.checked;
            body.querySelector('#d2-wrap').hidden = same; body.querySelector('#t2-hint').hidden = !same;
            f.d2.required = f.t2.required = !same; f.d2.min = f.d1.value || '';
            if (!same && f.d1.value && (!f.d2.value || f.d2.value <= f.d1.value)) f.d2.value = nextDay(f.d1.value);
        };
        sd.onchange = syncEnd; f.d1.addEventListener('change', syncEnd); syncEnd();
        f.tag_pick.onchange = () => { const c = f.tag_pick.value === 'Custom'; body.querySelector('#tag-custom').hidden = !c; if (c) setTimeout(() => f.tag.focus(), 30); };
        if (!e) setTimeout(() => f.title.focus(), 60);
        f.onsubmit = ev => {
            ev.preventDefault();
            const v = Object.fromEntries(new FormData(f)), same = sd.checked;
            const starts = new Date(`${v.d1}T${v.t1}`), ends = same ? (v.t2 ? new Date(`${v.d1}T${v.t2}`) : null) : new Date(`${v.d2}T${v.t2}`);
            if (isNaN(starts)) { toast('Pick a date and time', true); return; }
            if (!same && (isNaN(ends) || v.d2 <= v.d1)) { toast('Pick an end date after the start date, or turn on Same day', true); return; }
            if (same && ends && ends <= starts) { toast('The end time must be after the start. Ends after midnight? Turn off Same day.', true); return; }
            if (!e && starts < new Date(Date.now() - 36e5) && !confirmBox('This event is in the past. Publish anyway?')) return;
            const rec = { id: e?.id, title: v.title.trim(), description: v.description.trim() || null, starts_at: starts.toISOString(), ends_at: ends ? ends.toISOString() : null,
                location: v.location.trim() || null, map_url: v.map_url.trim() || null, call_link: v.call_link.trim() || null,
                reminder_minutes: v.reminder === '' ? null : Number(v.reminder), allow_guests: !!f.allow_guests.checked,
                tag: (v.tag_pick === 'Custom' ? (v.tag || '').trim() : v.tag_pick) || null, capacity: v.capacity ? Math.max(1, Math.round(Number(v.capacity))) : null, on_website: !!f.on_website.checked };
            busy(ev.submitter, async () => { const saved = await api.saveEvent(rec);
                if (cov.changed) { try { await api.eventCover(e?.id ?? saved.id, cov.file); } catch (er) { toast('The event is saved, but the photo wasn\'t: ' + er.message, true); } }
                await loadEvents(true); closeSheet(); toast(e ? 'Saved. Members are told if the time or place changed.' : 'Published. Members are notified.'); location.hash = '#events/' + (e?.id ?? saved?.id ?? ''); render(); });
        };
    });
}

/* ---------- expense splitter ---------- */
const paise = v => Math.round(Number(v) * 100);
const rsP = p => '₹' + (Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
function balancesOf(exps) {
    const bal = new Map(), add = (u, v) => bal.set(u, (bal.get(u) || 0) + v);
    for (const x of exps) {
        const amt = paise(x.amount), W = x.split.reduce((a, s) => a + s.w, 0);
        add(x.paid_by, amt);
        let given = 0; const parts = x.split.map(s => { const p = Math.floor(amt * s.w / W); given += p; return [s.u, p]; });
        for (let i = 0; given < amt; i = (i + 1) % parts.length) { parts[i][1]++; given++; }     /* leftover paise, one each */
        parts.forEach(([u, p]) => add(u, -p));
    }
    return bal;
}
/* fewest payments: repeatedly settle the biggest debtor with the biggest creditor (at most one fewer payment than people) */
function settleUp(bal) {
    const cr = [...bal].filter(([, v]) => v > 0).map(([u, v]) => ({ u, v })), dr = [...bal].filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v })), out = [];
    while (cr.length && dr.length) {
        cr.sort((a, b) => b.v - a.v); dr.sort((a, b) => b.v - a.v);
        const c = cr[0], d = dr[0], amt = Math.min(c.v, d.v);
        if (amt > 0) out.push({ from: d.u, to: c.u, amt });
        c.v -= amt; d.v -= amt;
        if (!c.v) cr.shift(); if (!d.v) dr.shift();
    }
    return out;
}
async function drawExpenses(e, people, myUid) {
    const box = $('#exp-body'); if (!box) return;
    let exps; try { exps = await api.expenses(e.id); } catch (err) { if (box.isConnected) box.innerHTML = `<p class="muted small">${esc(err.message)}</p>`; return; }
    if (!box.isConnected) return;
    const names = Object.fromEntries(people.map(p => [p.user_id, p.user_id === myUid ? 'You' : (p.nickname || p.full_name.split(' ')[0])]));
    const nm = u => names[u] || 'Someone';
    const crowd = people.filter(p => p.status === 'going' && p.user_id);   /* costs are split only between riders going who are on the app */
    const bal = balancesOf(exps), mine = bal.get(myUid) || 0;
    const spent = exps.filter(x => x.kind === 'expense').reduce((a, x) => a + paise(x.amount), 0);
    const myShare = exps.filter(x => x.kind === 'expense').reduce((a, x) => { const W = x.split.reduce((s, y) => s + y.w, 0), me = x.split.find(y => y.u === myUid); return a + (me ? paise(x.amount) * me.w / W : 0); }, 0);
    const transfers = settleUp(bal);
    box.innerHTML = `<div class="card exp-sum">
            <div class="exp-stats"><div><b>${rsP(spent)}</b><span>group spent</span></div><div><b>${rsP(Math.round(myShare))}</b><span>your share</span></div>
                <div><b class="${mine > 0 ? 'pos' : mine < 0 ? 'neg' : ''}">${mine ? rsP(mine) : '₹0'}</b><span>${mine > 0 ? 'you get back' : mine < 0 ? 'you owe' : 'all settled'}</span></div></div>
            <div class="btns"><button class="btn" data-act="exp-add">＋ Add expense</button><button class="btn ghost" data-act="exp-settle"${exps.length ? '' : ' disabled'}>Settle up</button></div></div>
        ${exps.length ? `<div class="group" style="margin-top:10px">${[...exps].reverse().map(x => x.kind === 'settlement'
            ? `<div class="exp-row settle"><span class="exp-ico">🤝</span><span class="grow"><b>${esc(nm(x.paid_by))} paid ${esc(nm(x.split[0].u))}</b><span class="small muted">Settlement · ${tfmt(x.created_at, { day: 'numeric', month: 'short' })}</span></span><span class="num">${rsP(paise(x.amount))}</span>${x.created_by === myUid || isMod() ? `<button class="icon-btn" data-act="exp-del" data-id="${x.id}" aria-label="Undo this payment">✕</button>` : ''}</div>`
            : `<button class="exp-row" data-act="exp-open" data-id="${x.id}"><span class="exp-ico">🧾</span><span class="grow"><b>${esc(x.title || 'Expense')}</b><span class="small muted">${esc(nm(x.paid_by))} paid · split ${x.split.length} way${x.split.length > 1 ? 's' : ''}${x.split.some(s => s.w > 1) ? ' (with guests)' : ''}</span></span><span class="num">${rsP(paise(x.amount))}</span></button>`).join('')}</div>`
            : '<p class="small muted" style="margin-top:10px">No expenses yet. Add fuel, food, hotel or anything the group shares, and choose who it’s split between.</p>'}`;
    actions['exp-add'] = () => expenseForm(e, crowd, myUid);
    actions['exp-open'] = el => { const x = exps.find(y => String(y.id) === el.dataset.id); if (x) expenseView(e, x, crowd, myUid, nm); };
    actions['exp-del'] = el => { if (confirmBox('Undo this payment?')) busy(el, async () => { await api.deleteExpense(Number(el.dataset.id)); drawExpenses(e, people, myUid); }); };
    actions['exp-settle'] = () => settleSheet(e, bal, transfers, people, myUid, nm, spent);
}
function expenseView(e, x, crowd, myUid, nm) {
    const W = x.split.reduce((a, s) => a + s.w, 0), canEdit = x.created_by === myUid || isMod();
    openSheet(x.title || 'Expense', `<p class="exp-amt">${rsP(paise(x.amount))}</p><p class="muted small" style="margin-bottom:12px">Paid by <b>${esc(nm(x.paid_by))}</b> · added ${tfmt(x.created_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
        <div class="group">${x.split.map(s => `<div><span class="grow">${esc(nm(s.u))}${s.w > 1 ? ` <span class="muted small">(+${s.w - 1} guest)</span>` : ''}</span><span class="num">${rsP(Math.round(paise(x.amount) * s.w / W))}</span></div>`).join('')}</div>
        ${canEdit ? '<div class="btns" style="margin-top:14px"><button class="btn ghost" data-x="edit">Edit</button><button class="btn danger" data-x="del">Delete</button></div>' : ''}`, body => {
        if (!canEdit) return;
        body.querySelector('[data-x=edit]').onclick = () => expenseForm(e, crowd, myUid, x);
        body.querySelector('[data-x=del]').onclick = ev => { if (confirmBox('Delete this expense?')) busy(ev.target, async () => { await api.deleteExpense(x.id); closeSheet(); render(); toast('Deleted'); }); };
    });
}
function expenseForm(e, crowd, myUid, x = null) {
    const w = p => 1 + (p.guests || 0);
    const inSplit = new Set(x ? x.split.map(s => s.u) : crowd.map(p => p.user_id));
    openSheet(x ? 'Edit expense' : 'Add expense', `<form id="exf">
        <label>What was it for?<input name="title" required maxlength="80" placeholder="e.g. Breakfast at Kolaghat" value="${esc(x?.title || '')}"></label>
        <div class="grid2"><label>Amount (₹)<input name="amount" type="number" required min="1" max="1000000" step="0.01" inputmode="decimal" value="${x ? x.amount : ''}"></label>
            <label>Paid by<select name="paid_by">${crowd.map(p => `<option value="${p.user_id}"${(x ? x.paid_by : myUid) === p.user_id ? ' selected' : ''}>${esc(p.user_id === myUid ? 'You' : p.full_name)}</option>`).join('')}</select></label></div>
        <fieldset><legend>Split between <button type="button" class="link-btn" id="all" style="margin-left:8px">All</button> <button type="button" class="link-btn" id="none" style="margin-left:8px">None</button></legend>
            <div class="split-list">${crowd.map(p => `<label class="split-row"><input type="checkbox" value="${p.user_id}"${inSplit.has(p.user_id) ? ' checked' : ''}>${face(p, 'avatar xs')}<span class="grow">${esc(p.user_id === myUid ? 'You' : p.full_name)}${p.guests ? ' <span class="muted small">+1 guest, 2 shares</span>' : ''}</span><span class="num small muted" data-share></span></label>`).join('')}</div></fieldset>
        <p class="calc" id="each"></p>
        <button class="btn block">${x ? 'Save changes' : 'Add expense'}</button></form>`, body => {
        const f = body.querySelector('#exf'), boxes = [...body.querySelectorAll('.split-row input')];
        const upd = () => {
            const amt = paise(f.amount.value || 0), chosen = crowd.filter(p => boxes.find(b => b.value === p.user_id).checked), W = chosen.reduce((a, p) => a + w(p), 0);
            boxes.forEach(b => { const p = crowd.find(q => q.user_id === b.value); b.closest('label').querySelector('[data-share]').textContent = b.checked && amt && W ? rsP(Math.round(amt * w(p) / W)) : ''; });
            body.querySelector('#each').textContent = chosen.length && amt ? `Split ${chosen.length} way${chosen.length > 1 ? 's' : ''}` : '';
        };
        f.oninput = upd; upd();
        body.querySelector('#all').onclick = () => { boxes.forEach(b => b.checked = true); upd(); };
        body.querySelector('#none').onclick = () => { boxes.forEach(b => b.checked = false); upd(); };
        f.onsubmit = ev => {
            ev.preventDefault();
            const chosen = crowd.filter(p => boxes.find(b => b.value === p.user_id).checked);
            if (!chosen.length) { toast('Pick at least one person', true); return; }
            const rec = { id: x?.id, event_id: e.id, kind: 'expense', title: f.title.value.trim(), amount: Math.round(Number(f.amount.value) * 100) / 100, paid_by: f.paid_by.value, split: chosen.map(p => ({ u: p.user_id, w: w(p) })) };
            busy(ev.submitter, async () => { await api.saveExpense(rec); closeSheet(); render(); toast(x ? 'Saved' : 'Expense added'); });
        };
    });
}
function settleSheet(e, bal, transfers, people, myUid, nm, spent) {
    const full = u => (people.find(p => p.user_id === u)?.full_name) || 'Someone';
    const lines = [...bal].filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    const shareText = () => `💸 *${e.title}*: settle up\nGroup spent ${rsP(spent)}\n\n${transfers.length ? transfers.map(t => `• ${full(t.from)} → ${full(t.to)}: *${rsP(t.amt)}*`).join('\n') : 'Everyone is settled ✅'}\n\nDetails in the RWB App: https://roninwb.in/app/#events/${e.id}`;
    openSheet('Settle up', `
        <p class="small muted" style="margin-bottom:10px">The fewest payments that clear everyone's balance.</p>
        ${transfers.length ? `<div class="group">${transfers.map((t, i) => `<div class="xfer"><span class="grow"><b>${esc(nm(t.from))}</b> <span class="muted">pays</span> <b>${esc(nm(t.to))}</b></span><span class="num">${rsP(t.amt)}</span>${t.from === myUid || t.to === myUid || isMod() ? `<button class="btn sm ghost" data-paid="${i}">Mark paid</button>` : ''}</div>`).join('')}</div>`
            : '<div class="card empty"><b>All settled ✅</b>Nobody owes anything.</div>'}
        ${lines.length ? `<details class="tech" style="margin-top:12px"><summary>Everyone's balance</summary><div class="group" style="margin-top:8px">${lines.map(([u, v]) => `<div><span class="grow">${esc(full(u))}</span><span class="num ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? 'gets ' : 'owes '}${rsP(v)}</span></div>`).join('')}</div></details>` : ''}
        <button class="btn wa block" id="xshare" style="margin-top:14px">Share on WhatsApp</button>`, body => {
        body.querySelector('#xshare').onclick = () => openWA(waShare(shareText()));
        body.querySelectorAll('[data-paid]').forEach(b => b.onclick = () => {
            const t = transfers[Number(b.dataset.paid)];
            if (!confirmBox(`Record that ${full(t.from)} paid ${full(t.to)} ${rsP(t.amt)}?`)) return;
            busy(b, async () => { await api.saveExpense({ event_id: e.id, kind: 'settlement', title: 'Settlement', amount: t.amt / 100, paid_by: t.from, split: [{ u: t.to, w: 1 }] }); closeSheet(); render(); toast('Payment recorded'); });
        });
    });
}

/* =================== My documents (private to each rider) =================== */
const DOC_KINDS = {
    dl: { name: 'Driving licence', short: 'DL', icon: '🪪', expiry: 'Valid till', number: 'DL number' },
    rc: { name: 'Registration (RC)', short: 'RC', icon: '📘', expiry: 'Registration valid till', number: 'Registration number' },
    puc: { name: 'Pollution (PUC)', short: 'PUC', icon: '🌫️', expiry: 'Valid till', number: 'Certificate number' },
    insurance: { name: 'Insurance', short: 'Insurance', icon: '🛡️', expiry: 'Policy end date', number: 'Policy number' },
    other: { name: 'Other document', short: 'Other', icon: '📄', expiry: 'Expiry date (if any)', number: 'Number (if any)' }
};
const docName = d => d.kind === 'other' ? (d.title || 'Document') : DOC_KINDS[d.kind].name;
function docStatus(d) {
    if (!d?.expiry_date) return { level: 'none', days: Infinity, text: '' };
    const days = Math.round((new Date(d.expiry_date) - new Date(todayISO())) / 864e5);
    if (days < 0) return { level: 'bad', days, text: 'Expired' };
    if (days <= 30) return { level: 'warn', days, text: days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left` };
    return { level: 'ok', days, text: 'Valid' };
}
/* =================== Built-in how-to videos (app/videos, also posted as RWB Instagram stories): shown in Guides → App =================== */
const VIDEOS = [   /* [file, title, what it covers, seconds, who]; who: undefined = members, 'team' = coordinators + admins, 'fam' = RWB FAM */
    ['home', 'Home & My Ride', 'Update your km, check your parts, VRN check', 37],
    ['track', 'Track & SOS', 'Share your location on rides, see riders, SOS', 31],
    ['service', 'Service', 'Add a service and its bill', 37],
    ['mileage', 'Mileage', 'Your real km per litre with Trip A', 34],
    ['motomart', 'MotoMart', 'Buy and sell bike gear', 37],
    ['guides', 'Guides & Pookie', 'Read guides and ask Pookie', 29],
    ['events', 'Events', 'Join rides and share costs', 32],
    ['warriorboards', 'Warriorboards', 'Top riders and finding members', 21],
    ['me', 'Me', 'Your photo, details, theme and privacy', 26],
    ['calendar', 'Calendar & Papers', 'Reminders, and your licence, RC, PUC and insurance', 36],
    ['coordinators-and-admins', 'Team tools', 'For coordinators and admins', 36, 'team'],
    ['fam-app', 'RWB FAM', 'Where is my rider, rides and settings', 27, 'fam']
];

/* =================== Calendar: everything with a date in one place ===================
   RWB events (past and coming) plus vehicle dates: document renewals, next service, My Ride parts falling due,
   the member's own reminders, and logged services, parts and fill-ups. (No holidays or birthdays: Bodhi removed them.) Renewal, service and part dates also reach the phone as
   notifications (setup file 62: the database sends them every morning at 8:30). */
const CS = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CAL_CATS = {
    event: ['Events', CS('<path d="M5.5 21V4h11l-2 4 2 4h-11"/>'), 1],
    renew: ['Renewals', CS('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"/>'), 1],
    service: ['Service', CS('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'), 1],
    ride: ['My Ride', CS('<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z"/><circle cx="12" cy="12" r="3"/>'), 1],
    mine: ['Reminders', CS('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.3 1.6M4.5 4 2.5 6M19.5 4l2 2"/>'), 1],
    fuel: ['Fill-ups', CS('<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>'), 0]
};
const CAL_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoAdd = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysTo = iso => Math.round((Date.parse(iso) - Date.parse(todayISO())) / 864e5);
const localDay = ts => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const wdOf = iso => CAL_WD[new Date(iso + 'T00:00:00Z').getUTCDay()];
const longDay = iso => { const p = parts(iso); return `${wdOf(iso)}, ${p.d} ${MONTHS[p.m - 1]}${p.y !== parts(todayISO()).y ? ' ' + p.y : ''}`; };
const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
const calOff = () => { try { const v = JSON.parse(localStorage.getItem('rwb-cal-off') || 'null'); return new Set(v || Object.keys(CAL_CATS).filter(k => !CAL_CATS[k][2])); } catch { return new Set(['fuel']); } };


/* how many km a day this rider usually rides (from odometer readings over the last year): used to guess when a km-based due falls */
function kmPerDay(services = [], fuel = []) {
    const me = state.me || {};
    const pts = [...services.map(s => [s.service_date, s.odometer_km]), ...fuel.map(f => [f.fill_date, f.odometer_km]), ...(me.odo_km && me.odo_date ? [[me.odo_date, me.odo_km]] : [])]
        .filter(p => p[0] && p[1] > 0).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    if (pts.length < 2) return null;
    const last = pts.at(-1), first = pts.find(p => (Date.parse(last[0]) - Date.parse(p[0])) / 864e5 <= 365);
    const days = (Date.parse(last[0]) - Date.parse(first[0])) / 864e5, kms = last[1] - first[1];
    return days >= 14 && kms > 0 ? kms / days : null;
}
/* next service and My Ride parts with a date: by time (from the manual), or guessed from how much you ride */
function dueItems(services = [], fuel = [], rideParts = null) {
    const last = latestOdo(services, fuel), odo = last?.km || 0, rate = kmPerDay(services, fuel), out = [];
    const byKm = left => rate && last ? (left <= 0 ? todayISO() : isoAdd(last.d > todayISO() ? todayISO() : last.d, Math.ceil(left / rate))) : null;
    const pick = (a, b) => { const x = [a, b].filter(d => d && d < isoAdd(todayISO(), 1100)).sort(); return x[0] ? { date: x[0], est: x[0] === b && x[0] !== a } : null; };
    if (odo) {
        const n = nextService(services, odo), p = pick(n.date, byKm(n.kmLeft));
        if (p) out.push({ key: 'service', source: 'service', cat: 'service', title: `${n.label} due`, date: p.date, est: p.est, url: '#service',
            note: `At ${km(n.km)}${n.date ? ` or by ${fmtDate(n.date)}` : ''}, whichever comes first${p.est ? '. Date guessed from how much you ride' : ''}` });
    }
    for (const pt of curParts(rideParts).filter(x => x.kind === 'wear')) {
        const w = wearOf(pt.part); if (!w) continue;
        const dDate = pt.installed_on && pt.life_days ? isoAdd(pt.installed_on, pt.life_days) : null;
        const dKm = pt.life_km && pt.installed_km != null && odo ? byKm(pt.life_km - Math.max(0, odo - pt.installed_km)) : null;
        const p = pick(dDate, dKm); if (!p) continue;
        out.push({ key: 'part:' + pt.part, source: 'part', cat: 'ride', title: `${w.name} due`, date: p.date, est: p.est, url: '#ride',
            note: [pt.brand, pt.life_km ? `life ${km(pt.life_km)}` : '', pt.life_days ? `${Math.round(pt.life_days / 30)} months` : ''].filter(Boolean).join(' · ') + (p.est ? '. Date guessed from how much you ride' : '') });
    }
    return out;
}
/* the database sends the morning reminders, so it needs these dates; sent only when something changed */
function syncReminders(services, fuel, ride) {
    if (!api?.syncReminders || isFam() || ride?.parts === null || state.remSyncOff) return;
    const items = dueItems(services, fuel, ride?.parts).filter(i => i.date >= isoAdd(todayISO(), -1))
        .map(({ key, source, title, date, url, note }) => ({ key, source, title, due_date: date, url, note: note.slice(0, 300) }));
    const sig = JSON.stringify(items);
    try { if (localStorage.getItem('rwb-rem-sig') === sig) return; } catch { /* ignore */ }
    state.remSyncOff = true;   /* at most once per app open; the next open tries again if something changed */
    api.syncReminders(items).then(r => { if (r !== null) try { localStorage.setItem('rwb-rem-sig', sig); } catch { /* ignore */ } }).catch(() => { /* next time */ });
}
/* run non-urgent work when the phone is idle, so screens open without a hitch */
const whenIdle = f => (window.requestIdleCallback ? requestIdleCallback(() => f(), { timeout: 3000 }) : setTimeout(f, 400));

/* every dated thing between two days (inclusive), as calendar items */
function calItems(d, from, to) {
    const out = [], inR = iso => iso >= from && iso <= to;
    for (const e of d.events) {
        const s = localDay(e.starts_at), end = e.ends_at ? localDay(e.ends_at) : s, mine = d.rsvp[e.id], past = evtPast(e);
        for (let x = s; x <= end && x <= to; x = isoAdd(x, 1)) if (inR(x)) out.push({ id: 'e' + e.id, date: x, cat: 'event', title: e.title, first: x === s,
            sub: [x === s ? evtTime(e.starts_at) : 'Continues', e.location, e.status === 'cancelled' ? 'Cancelled' : mine ? RSVP_TXT[mine.status] : past ? 'Past event' : ''].filter(Boolean).join(' · '),
            off: e.status === 'cancelled', start: e.starts_at, end: e.ends_at, location: e.location, note: e.description, href: '#events/' + e.id, btn: 'Open event' });
    }
    for (const doc of d.docs) if (doc.expiry_date && inR(doc.expiry_date)) {
        const st = docStatus(doc);
        out.push({ id: 'd' + doc.id, date: doc.expiry_date, cat: 'renew', title: `${docName(doc)} ${st.days < 0 ? 'expired' : 'expires'}`, sub: st.days < 0 ? 'Renew it and update My documents' : 'Renew before this day',
            level: st.level === 'ok' ? '' : st.level, href: '#docs', btn: 'Open My documents', note: doc.doc_number ? `${DOC_KINDS[doc.kind].number.replace(' (if any)', '')}: ${doc.doc_number}` : '' });
    }
    for (const i of d.due) if (inR(i.date)) { const n = daysTo(i.date);
        out.push({ id: i.key, date: i.date, cat: i.cat, title: i.title, sub: (i.est ? 'Estimated date' : 'Due') + (n < 0 ? ' · overdue' : ''), note: i.note, level: n <= 0 ? 'bad' : n <= 15 ? 'warn' : '', href: i.url, btn: i.cat === 'service' ? 'Open Service' : 'Open My Ride' }); }
    for (const s of d.services) if (inR(s.service_date)) out.push({ id: 's' + s.id, date: s.service_date, cat: 'service', title: SERVICE_TYPES[s.service_type] || 'Service', sub: [km(s.odometer_km), s.cost ? rs(s.cost) : ''].filter(Boolean).join(' · '), href: '#service', btn: 'Open Service', done: 1 });
    for (const pt of d.parts || []) {
        if (pt.installed_on && inR(pt.installed_on)) out.push({ id: 'pf' + pt.id, date: pt.installed_on, cat: 'ride', title: `${partName(pt)} fitted`, sub: [pt.brand, pt.installed_km != null ? km(pt.installed_km) : ''].filter(Boolean).join(' · '), href: '#ride', btn: 'Open My Ride', done: 1 });
        if (pt.retired_on && inR(pt.retired_on)) out.push({ id: 'pr' + pt.id, date: pt.retired_on, cat: 'ride', title: `${partName(pt)} replaced`, sub: pt.brand || '', href: '#ride', btn: 'Open My Ride', done: 1 });
    }
    for (const f of d.fuel) if (inR(f.fill_date)) out.push({ id: 'f' + f.id, date: f.fill_date, cat: 'fuel', title: `Fuel: ${Number(f.litres).toFixed(1)} L`, sub: [km(f.odometer_km), f.amount != null ? rs(f.amount) : ''].filter(Boolean).join(' · '), href: '#mileage', btn: 'Open Mileage', done: 1 });
    for (const r of d.mine || []) {
        let x = r.due_date, k = 0;
        while (x <= to && k++ < 400) {
            if (inR(x)) out.push({ id: 'r' + r.id + x, date: x, cat: 'mine', title: r.title, sub: r.repeat === 'monthly' ? 'Every month' : r.repeat === 'yearly' ? 'Every year' : 'Reminder',
                note: r.note, rec: r, level: daysTo(x) < 0 ? '' : daysTo(x) <= 1 ? 'warn' : '', recur: r.repeat });
            if (r.repeat === 'none') break;
            x = addMonths(r.due_date, r.repeat === 'monthly' ? k : 12 * k);
        }
    }
    const order = { renew: 0, service: 1, ride: 2, mine: 3, event: 4, fuel: 5 };
    return out.filter(i => !d.off.has(i.cat)).sort((a, b) => a.date.localeCompare(b.date) || (a.done || 0) - (b.done || 0) || order[a.cat] - order[b.cat] || String(a.start || '').localeCompare(String(b.start || '')));
}
const calAlert = () => docsAlert() || !!state.calSoon;
/* Google Calendar "add this" link (opens the Google Calendar app or website) */
function calGcalUrl(it) {
    const p = new URLSearchParams({ action: 'TEMPLATE', text: it.title, details: [it.sub, it.note, 'From the RWB App: https://roninwb.in/app/'].filter(Boolean).join('\n') });
    const f = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    if (it.start) p.set('dates', `${f(it.start)}/${f(it.end || new Date(Date.parse(it.start) + 2 * 36e5).toISOString())}`);
    else p.set('dates', `${it.date.replace(/-/g, '')}/${isoAdd(it.date, 1).replace(/-/g, '')}`);
    if (it.location) p.set('location', it.location);
    if (it.recur === 'monthly' || it.recur === 'yearly') p.set('recur', `RRULE:FREQ=${it.recur.toUpperCase()}`);
    return 'https://calendar.google.com/calendar/render?' + p;
}

/* loads once when the Calendar opens; tapping days, months and filters only redraws (no network) */
async function viewCalendar() {
    const n = navN;
    const [services, fuel, docs, ride, evd, mine] = await Promise.all([load.services(), load.fuel(), load.docs(), load.ride().catch(() => ({ parts: null })),
        loadEvents().catch(() => ({ events: [], mine: {} })), load.reminders()]);
    if (!stillHere(n)) return;
    state.calData = { events: evd.events || [], rsvp: evd.mine || {}, docs, services, fuel, parts: ride.parts || [], due: dueItems(services, fuel, ride.parts), mine };
    drawCal();
    whenIdle(() => syncReminders(services, fuel, ride));
}
const CAL_CHEV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CAL_FILTER = CS('<path d="M4 6h16M7 12h10M10 18h4"/>');
function drawCal(turn = 0) {   /* turn: +1 / -1 = page to the next / previous month */
    const D = state.calData; if (!D) return;
    const today = todayISO(), off = calOff(), data = { ...D, off };
    const month = state.calMonth || today.slice(0, 7), sel = state.calDay || today;
    const [Y, M] = month.split('-').map(Number);
    const first = `${month}-01`, startPad = new Date(first + 'T00:00:00Z').getUTCDay(), gridFrom = isoAdd(first, -startPad);
    const daysIn = new Date(Date.UTC(Y, M, 0)).getUTCDate(), cells = 42, gridTo = isoAdd(gridFrom, cells - 1);
    const all = calItems(data, gridFrom < today ? gridFrom : today, isoAdd(gridTo > today ? gridTo : today, 45));
    const byDay = new Map(); all.forEach(i => (byDay.get(i.date) || byDay.set(i.date, []).get(i.date)).push(i));
    /* overdue renewals, service and parts first, then what's coming in the next 45 days */
    const overdue = calItems({ ...data, off: new Set(['event', 'fuel', 'mine']) }, isoAdd(today, -60), isoAdd(today, -1)).filter(i => !i.done && i.level);
    const soon = all.filter(i => i.date >= today && i.date <= isoAdd(today, 45) && !i.done && i.cat !== 'fuel' && (i.cat !== 'event' || i.first));
    state.calSoon = [...overdue, ...soon].some(i => ['renew', 'service', 'ride', 'mine'].includes(i.cat) && daysTo(i.date) <= 7);
    const upcoming = [...overdue, ...soon.filter(i => i.date > today || (sel !== today && i.cat !== 'event'))], showAll = state.calAll;
    const short = iso => { const n = daysTo(iso); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 0 ? `${-n}d late` : `${parts(iso).d} ${MONTHS[parts(iso).m - 1]}`; };
    const row = (i, when) => `<button class="cal-it c-${i.cat}${i.off ? ' off' : ''}${i.soft ? ' soft' : ''}${i.level ? ' ' + i.level : ''}" data-act="cal-it" data-id="${esc(i.id)}" data-d="${i.date}">
        <span class="cal-ico">${CAL_CATS[i.cat][1]}</span><span class="grow"><b>${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span>${when ? `<span class="cal-when">${short(i.date)}</span>` : ''}</button>`;
    const dayHtml = x => { const its = byDay.get(x) || [];
        return `<h2>${x === today ? 'Today' : esc(longDay(x))}</h2>${its.length ? `<div class="cal-list">${its.map(i => row(i)).join('')}</div>` : `<p class="cal-none">${x < today ? 'Nothing on this day.' : 'Nothing planned. Tap ＋ to add a reminder.'}</p>`}`; };
    const cell = k => {
        const x = isoAdd(gridFrom, k), its = byDay.get(x) || [], p = parts(x);
        const cats = [...new Set(its.map(i => i.cat))], ic = cats.length > 3 ? [...cats.slice(0, 2), '+'] : cats;
        return `<button class="cd${p.m !== M ? ' other' : ''}${x === today ? ' today' : ''}${x === sel ? ' sel' : ''}" data-act="cal-day" data-d="${x}" aria-label="${esc(longDay(x))}${its.length ? `, ${its.length} item${its.length > 1 ? 's' : ''}` : ''}">
            <b>${p.d}</b><span class="cdi">${ic.map(c => c === '+' ? '<i class="more">+</i>' : `<i class="c-${c}">${CAL_CATS[c][1]}</i>`).join('')}</span></button>`;
    };
    const list = showAll ? upcoming.slice(0, 30) : upcoming.slice(0, 5);
    const headHtml = `<h2>${MONTHS_LONG[M - 1]} <span>${Y}</span></h2>
                ${month !== today.slice(0, 7) ? '<button class="cal-today" data-act="cal-today">Today</button>' : ''}
                <button class="cal-nav" data-act="cal-f-open" aria-label="Show or hide kinds" aria-expanded="${!!state.calFilt}">${CAL_FILTER}</button>
                <button class="cal-nav" data-act="cal-mv" data-n="-1" aria-label="Previous month">${CAL_CHEV('M15 6l-6 6 6 6')}</button>
                <button class="cal-nav" data-act="cal-mv" data-n="1" aria-label="Next month">${CAL_CHEV('M9 6l6 6-6 6')}</button>`;
    const filtHtml = state.calFilt ? `<div class="cal-filters" role="group" aria-label="Show on the calendar">${Object.entries(CAL_CATS).map(([k, [name, svg]]) => `<button class="c-${k}" data-act="cal-f" data-k="${k}" aria-pressed="${!off.has(k)}">${svg}${name}</button>`).join('')}</div>` : '';
    const gridHtml = CAL_WD.map(w => `<span class="cw">${w[0]}</span>`).join('') + Array.from({ length: cells }, (_, k) => cell(k)).join('');
    const upHtml = upcoming.length ? `<section class="section"><h2>Coming up</h2><div class="cal-list">${list.map(i => row(i, 1)).join('')}</div>
            ${upcoming.length > 5 ? `<button class="cal-more" data-act="cal-all">${showAll ? 'Show less' : `Show all ${Math.min(upcoming.length, 30)}`}</button>` : ''}</section>` : '';
    const belowHtml = `<section class="section cal-day" id="cal-day">${dayHtml(sel)}</section>${upHtml}
        ${data.mine === null && isAdmin() ? '<p class="cal-none">Own reminders need setup file 62 (calendar.sql).</p>' : ''}`;
    const fade = el => { el.classList.remove('cal-fade'); void el.offsetWidth; el.classList.add('cal-fade'); };
    const card = $('#cal-card');
    if (!card) {
        app.innerHTML = top('Calendar') + `
        <section class="cal-card" id="cal-card">
            <div class="cal-head" id="cal-head">${headHtml}</div>
            <div id="cal-filt">${filtHtml}</div>
            <div class="cal-pager" id="cal-pager"><div class="cal-grid" id="cal-grid">${gridHtml}</div></div>
        </section>
        <div id="cal-below">${belowHtml}</div>
        <button class="btn fab" data-act="cal-add" aria-label="Add a reminder">＋ Reminder</button>`;
        calSwipe();
    } else {
        /* already on screen: change only what changed, so nothing else blinks */
        const head = $('#cal-head'); if (turn) setTimeout(() => { if (head.isConnected) head.innerHTML = headHtml; }, 190); else head.innerHTML = headHtml;   /* the month name changes as the page flips over */
        if ($('#cal-filt').innerHTML !== filtHtml) $('#cal-filt').innerHTML = filtHtml;
        const pager = $('#cal-pager'), oldG = $('#cal-grid');
        pager.querySelectorAll('.cal-leaf').forEach(l => l.remove()); oldG.classList.remove('cal-under', 'next', 'prev');
        if (turn && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            /* the old month lifts off like a calendar page; the new month is underneath */
            const leaf = oldG; leaf.removeAttribute('id'); leaf.classList.add('cal-leaf', turn > 0 ? 'next' : 'prev');
            const g = document.createElement('div'); g.className = 'cal-grid cal-under ' + (turn > 0 ? 'next' : 'prev'); g.addEventListener('animationend', () => g.classList.remove('cal-under', 'next', 'prev'), { once: true }); g.id = 'cal-grid'; g.innerHTML = gridHtml;
            pager.prepend(g);
            const done = () => leaf.remove(); leaf.addEventListener('animationend', done, { once: true }); setTimeout(done, 400);
        } else oldG.innerHTML = gridHtml;
        const below = $('#cal-below');
        if (below.dataset.html !== belowHtml) { below.innerHTML = belowHtml; fade(below); }
    }
    $('#cal-below').dataset.html = belowHtml;
    const pool = [...all, ...overdue], find = el => pool.find(i => i.id === el.dataset.id && i.date === el.dataset.d);
    actions = {
        'cal-day': el => {
            const x = el.dataset.d; state.calDay = x;
            if (x.slice(0, 7) !== month || x === today || sel === today) { const t = x.slice(0, 7) > month ? 1 : x.slice(0, 7) < month ? -1 : 0; state.calMonth = x.slice(0, 7); return drawCal(t); }   /* today's items move between Today and Coming up */
            app.querySelector('.cd.sel')?.classList.remove('sel'); el.classList.add('sel');
            const dd = $('#cal-day'); dd.innerHTML = dayHtml(x); fade(dd);
        },
        'cal-mv': el => { const d = addMonths(first, Number(el.dataset.n)); state.calMonth = d.slice(0, 7); state.calDay = d.slice(0, 7) === today.slice(0, 7) ? today : d; drawCal(Number(el.dataset.n)); },
        'cal-today': () => { const back = month < today.slice(0, 7) ? 1 : month > today.slice(0, 7) ? -1 : 0; state.calMonth = null; state.calDay = null; drawCal(back); },
        'cal-f-open': () => { state.calFilt = !state.calFilt; drawCal(); },
        'cal-f': el => { off.has(el.dataset.k) ? off.delete(el.dataset.k) : off.add(el.dataset.k); try { localStorage.setItem('rwb-cal-off', JSON.stringify([...off])); } catch { /* ignore */ } drawCal(); },
        'cal-all': () => { state.calAll = !state.calAll; drawCal(); },
        'cal-it': el => { const i = find(el); if (i) calItemSheet(i); },
        'cal-add': () => data.mine === null ? toast('Reminders aren\'t set up yet. Ask an RWB admin.', true) : reminderForm({ due_date: sel >= today ? sel : today })
    };
}
/* swipe the month left or right (set once per visit, on the page holder, so it keeps working after page turns) */
function calSwipe() {
    const g = $('#cal-pager'); let x0 = null, y0 = 0, swiped = false;
    g.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; }, { passive: true });
    g.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; setTimeout(() => swiped = false, 300); actions['cal-mv']?.({ dataset: { n: dx < 0 ? 1 : -1 } }); } }, { passive: true });
    g.addEventListener('pointercancel', () => { x0 = null; }, { passive: true });
    g.addEventListener('click', e => { if (swiped) { e.preventDefault(); e.stopPropagation(); } }, true);
}
function calItemSheet(i) {
    const n = daysTo(i.date), r = i.rec;
    openSheet(i.title, `<p class="cal-sh-when c-${i.cat}"><span class="cal-ico">${CAL_CATS[i.cat][1]}</span><span><b>${esc(i.start ? evtWhen({ starts_at: i.start, ends_at: i.end }) : longDay(i.date))}</b><small>${CAL_CATS[i.cat][0]} · ${inDays(n)}</small></span></p>
        ${i.sub ? `<p class="small" style="margin:12px 0 4px">${esc(i.sub)}</p>` : ''}
        ${i.note ? `<p class="small muted" style="white-space:pre-line;margin-bottom:6px">${esc(String(i.note).slice(0, 600))}</p>` : ''}
        <div class="list" style="margin-top:14px">
            ${i.href ? `<a class="btn block" href="${esc(i.href)}">${esc(i.btn || 'Open')}</a>` : ''}
            ${r ? '<button class="btn block" data-x="edit">Edit reminder</button>' : ''}
            ${!i.done && n >= -1 ? `<a class="btn ghost block" href="${esc(calGcalUrl(i))}" target="_blank" rel="noopener">Add to Google Calendar</a>` : ''}
            ${r ? '<button class="btn ghost block danger" data-x="del">Delete reminder</button>' : ''}</div>`, body => {
        body.querySelector('[data-x=edit]')?.addEventListener('click', () => reminderForm(r));
        body.querySelector('[data-x=del]')?.addEventListener('click', e => { if (confirmBox(`Delete “${r.title}”?`)) busy(e.target, async () => { await api.deleteReminder(r.id); state.reminders = undefined; closeSheet(); toast('Deleted'); viewCalendar(); }); });
    });
}
const REM_IDEAS = ['FASTag recharge', 'Chain clean & lube', 'Tyre pressure check', 'Bike loan EMI', 'Wash the bike', 'Helmet visor change', 'Road tax', 'Ride permit'];
function reminderForm(r = {}) {
    const editing = !!r.id;
    openSheet(editing ? 'Edit reminder' : 'New reminder', `<form id="remf">
        ${editing ? '' : `<div class="chips" style="margin-bottom:10px">${REM_IDEAS.map(t => `<button type="button" class="chip" data-idea="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
        <label>What<input name="title" required maxlength="80" value="${esc(r.title || '')}" placeholder="e.g. FASTag recharge"></label>
        <div class="row2"><label>Date<input type="date" name="due_date" required value="${esc(r.due_date || todayISO())}" min="${editing ? '' : todayISO()}"></label>
            <label>Repeat<select name="repeat">${[['none', 'Does not repeat'], ['monthly', 'Every month'], ['yearly', 'Every year']].map(([v, t]) => `<option value="${v}"${(r.repeat || 'none') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
        <label>Notify me<select name="notify_days">${[[0, 'On the day'], [1, '1 day before and on the day'], [3, '3 days before and on the day'], [7, '1 week before and on the day'], [30, '1 month before and on the day']].map(([v, t]) => `<option value="${v}"${(r.notify_days ?? 1) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Note<input name="note" maxlength="300" value="${esc(r.note || '')}" placeholder="Optional"></label>
        <p class="small muted">Only you see your reminders. The notification comes at about 8:30 AM.</p>
        <button class="btn block">${editing ? 'Save changes' : 'Add reminder'}</button></form>`, body => {
        const f = body.querySelector('#remf');
        body.querySelectorAll('[data-idea]').forEach(c => c.onclick = () => { f.title.value = c.dataset.idea; if (/EMI|FASTag/.test(c.dataset.idea)) f.repeat.value = 'monthly'; if (/Road tax/.test(c.dataset.idea)) f.repeat.value = 'yearly'; f.title.focus(); });
        f.onsubmit = e => {
            e.preventDefault(); const v = Object.fromEntries(new FormData(f));
            const rec = { ...(r.id ? { id: r.id } : {}), title: v.title.trim(), due_date: v.due_date, repeat: v.repeat, notify_days: Number(v.notify_days), note: v.note.trim() || null };
            busy(e.submitter, async () => { await api.saveReminder(rec); state.reminders = undefined; state.calMonth = rec.due_date.slice(0, 7); state.calDay = rec.due_date; closeSheet(); toast(editing ? 'Saved' : 'Reminder added'); location.hash === '#calendar' ? viewCalendar() : (location.hash = '#calendar'); });
        };
    });
}

async function viewDocs() {
    const docs = await load.docs(true);
    const slot = k => docs.find(d => d.kind === k);
    const card = (d, k) => {
        const K = DOC_KINDS[k || d.kind], st = docStatus(d);
        return `<button class="doc-card ${d ? 'has' : 'empty'} ${st.level}" data-act="${d ? 'doc' : 'doc-new'}" data-id="${d?.id ?? ''}" data-kind="${k || d.kind}">
            <span class="doc-ico">${K.icon}</span>
            <span class="grow"><b>${esc(d ? docName(d) : K.name)}</b>
                <span class="small muted">${d ? esc([d.doc_number, d.expiry_date ? `${K.expiry.replace(' (if any)', '')} ${fmtDate(d.expiry_date)}` : ''].filter(Boolean).join(' · ') || `${d.files.length} page${d.files.length === 1 ? '' : 's'}`) : 'Tap to add'}</span></span>
            ${d ? (st.text ? `<span class="doc-chip ${st.level}">${st.text}</span>` : '') : '<span class="doc-add">＋</span>'}</button>`;
    };
    const others = docs.filter(d => d.kind === 'other');
    app.innerHTML = top('Documents') + `
        <p class="doc-lock"><span>🔒</span>Only you can see these. Not admins, not other members.</p>
        <section class="section"><h2>Your bike papers</h2><div class="doc-grid">${['dl', 'rc', 'puc', 'insurance'].map(k => card(slot(k), k)).join('')}</div></section>
        <section class="section"><h2>Other documents</h2>${others.length ? `<div class="doc-grid">${others.map(d => card(d)).join('')}</div>` : ''}
            <button class="btn ghost block" data-act="doc-new" data-kind="other" style="margin-top:${others.length ? 10 : 0}px">＋ Add another document</button>
            <p class="small muted" style="margin-top:10px">For example: Aadhaar, PAN, service warranty, extended warranty or a ride permit. Photos are kept sharp enough to read; PDF and Word files up to 3 MB.</p></section>`;
    actions = {
        doc: el => docView(docs.find(d => String(d.id) === el.dataset.id)),
        'doc-new': el => docForm({ kind: el.dataset.kind, files: [] })
    };
}
async function docView(d) {
    const K = DOC_KINDS[d.kind], st = docStatus(d);
    openSheet(docName(d), `
        ${st.text ? `<p class="doc-chip ${st.level}" style="display:inline-block;margin-bottom:10px">${st.level === 'bad' ? `Expired on ${fmtDate(d.expiry_date)}` : st.level === 'warn' ? `${st.text} · renew soon` : `Valid till ${fmtDate(d.expiry_date)}`}</p>` : ''}
        <dl class="facts">${d.doc_number ? `<dt>${K.number.replace(' (if any)', '')}</dt><dd>${esc(d.doc_number)}</dd>` : ''}${d.expiry_date ? `<dt>${K.expiry.replace(' (if any)', '')}</dt><dd>${fmtDate(d.expiry_date)}</dd>` : ''}${d.notes ? `<dt>Notes</dt><dd>${esc(d.notes)}</dd>` : ''}</dl>
        <div class="doc-pages" id="pages">${d.files.length ? d.files.map((_, i) => `<div class="doc-page" data-i="${i}"><p class="small muted">Loading page ${i + 1}…</p></div>`).join('') : '<p class="muted small">No pages attached.</p>'}</div>
        <div class="btns" style="margin-top:14px"><button class="btn ghost" data-x="edit">Edit</button><button class="btn danger" data-x="del">Delete</button></div>`, async body => {
        body.querySelector('[data-x=edit]').onclick = () => docForm(d);
        body.querySelector('[data-x=del]').onclick = e => { if (confirmBox(`Delete ${docName(d)} and its pages?`)) busy(e.target, async () => { await api.deleteDoc(d); await load.docs(true); closeSheet(); render(); toast('Deleted'); }); };
        for (const [i, path] of d.files.entries()) {
            const box = body.querySelector(`.doc-page[data-i="${i}"]`);
            try {
                const url = await api.docUrl(path), k = pathKind(path);
                if (box) box.innerHTML = (k === 'pdf' ? `<iframe class="pdf" src="${esc(url)}" title="Page ${i + 1}"></iframe>` : k === 'word' ? wordCard(url, `${docName(d)}, file ${i + 1}`) : `<img src="${esc(url)}" alt="${esc(docName(d))}, page ${i + 1}">`)
                    + `<a class="small link-btn" href="${esc(url)}" target="_blank" rel="noopener" download>Open full size</a>`;
            } catch { if (box) box.innerHTML = '<p class="small muted">Could not load this page. Check your internet.</p>'; }
        }
    });
}
function docForm(d) {
    const K = DOC_KINDS[d.kind], editing = !!d.id;
    let keep = [...(d.files || [])], add = [], drop = [];
    openSheet(editing ? `Edit ${docName(d)}` : `Add ${K.name.toLowerCase()}`, `<form id="docf">
        ${d.kind === 'other' ? `<label>Name<input name="title" required maxlength="80" placeholder="e.g. Aadhaar card" value="${esc(d.title || '')}"></label>` : ''}
        <label>${K.number}<input name="doc_number" maxlength="60" autocapitalize="characters" value="${esc(d.doc_number || '')}"></label>
        <label>${K.expiry}<input type="date" name="expiry_date" value="${esc(d.expiry_date || '')}"></label>
        <fieldset><legend>Photos, PDF or Word <span class="hint muted small">(up to 4 files, e.g. front and back)</span></legend>
            <div class="thumbs" id="dthumbs"></div>
            ${pickers('dpick', true)}</fieldset>
        <label>Notes<input name="notes" maxlength="500" placeholder="Anything to remember (optional)" value="${esc(d.notes || '')}"></label>
        <button class="btn block">${editing ? 'Save changes' : 'Save document'}</button></form>`, body => {
        const f = body.querySelector('#docf'), thumbs = body.querySelector('#dthumbs');
        const draw = () => {
            const tag = k => k === 'pdf' ? 'PDF' : k === 'word' || k === 'doc' || k === 'docx' ? 'Word' : '';
            thumbs.innerHTML = [...keep.map((p, i) => `<div class="thumb"><div class="doc-thumb">${tag(pathKind(p)) || 'Page ' + (i + 1)}</div><button type="button" data-k="${i}" aria-label="Remove page">✕</button></div>`),
                ...add.map((x, i) => `<div class="thumb">${fileKind(x) !== 'image' ? `<div class="doc-thumb">${tag(fileKind(x))}</div>` : `<img src="${x.url}" alt="">`}<button type="button" data-a="${i}" aria-label="Remove page">✕</button></div>`)].join('');
        };
        draw();
        thumbs.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.k != null) { drop.push(keep[b.dataset.k]); keep.splice(b.dataset.k, 1); } else { URL.revokeObjectURL(add[b.dataset.a].url); add.splice(b.dataset.a, 1); } draw(); };
        body.querySelectorAll('#dpick input').forEach(inp => inp.onchange = async e => {
            for (const fl of [...e.target.files]) {
                if (keep.length + add.length >= 4) { toast('Up to 4 pages per document', true); break; }
                try {
                    let out;
                    if (fileKind(fl) !== 'image') out = asDocFile(fl, 3);
                    else out = await compressImage(fl, 2200, 480e3);      /* sharper than bills so small print stays readable */
                    add.push(Object.assign(out, { url: URL.createObjectURL(out) }));
                } catch (err) { toast(err.message, true); }
            }
            e.target.value = ''; draw();
        });
        f.onsubmit = e => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(f));
            if (!keep.length && !add.length && !v.doc_number.trim()) { toast('Add a photo of the document or at least its number', true); return; }
            const rec = { id: d.id, kind: d.kind, title: d.kind === 'other' ? v.title.trim() : null, doc_number: v.doc_number.trim().toUpperCase() || null, expiry_date: v.expiry_date || null, notes: v.notes.trim() || null, files: keep };
            busy(e.submitter, async () => { await api.saveDoc(rec, add, drop); await load.docs(true); closeSheet(); location.hash === '#docs' ? render() : (location.hash = '#docs'); toast('Saved'); });
        };
    });
}

/* =================== Mileage =================== */
const HOWTO = `<details class="howto" id="howto"><summary>How to track mileage with Trip A</summary>
    <ol>
        <li><b>Fill the tank to full</b> (till the nozzle auto-cuts, same pump if you can) and <b>reset Trip A to 0</b>. Add it here as a full tank. This first entry starts the tracking.</li>
        <li><b>Ride normally.</b> Don't reset Trip A in between.</li>
        <li>At the next fill-up, <b>fill to full again</b>. Enter the litres and the <b>Trip A reading</b> before you reset it.</li>
        <li><b>Reset Trip A</b> and ride on. Every full fill-up gives you a new reading.</li>
    </ol>
    <div class="formula">Mileage (km/l) = Trip A km ÷ litres filled</div>
    <p><b>Only topped up a little?</b> Add it with “Full tank” turned off and <b>don't</b> reset Trip A. The app adds those litres into the next full-tank reading.</p>
    <p><b>Trip B:</b> leave it for something longer, like resetting it at every service to see the km since your last oil change.</p>
    <p class="muted small">No Trip A reading? Just enter the odometer each time and the app works it out from that.</p>
</details>`;

async function viewMileage() {
    const [logs, svcs] = await Promise.all([load.fuel(), load.services()]), ms = mileageStats(logs);
    syncKmpl(logs);
    const byEnd = new Map(ms.tanks.map(t => [t.end.id, t]));
    const f1 = v => v == null ? '–' : v.toFixed(1);
    app.innerHTML = top('Mileage') + HOWTO + `
        <section class="section"><div class="stats">
            <div class="stat accent"><b>${f1(ms.avg)}</b><span>Average km/l</span></div>
            <div class="stat"><b>${f1(ms.last)}</b><span>Last tank</span></div>
            <div class="stat"><b>${f1(ms.best)}</b><span>Best tank</span></div>
            <div class="stat"><b>${ms.cpk ? '₹' + ms.cpk.toFixed(2) : '–'}</b><span>Fuel cost / km</span></div>
        </div></section>
        <section class="section"><h2>You vs RWB</h2><div class="card vs" id="vs"><p class="small muted">Comparing…</p></div></section>
        ${TIPS}
        ${logs.length || svcs.length ? `<section class="section"><h2>Spends and mileage</h2><div class="card trend" id="trend"></div></section>` : ''}
        <section class="section"><h2>Fill-ups</h2>${logs.length ? `<div class="list">${[...logs].reverse().map(f => fuelCard(f, byEnd.get(f.id))).join('')}</div>` :
            `<div class="card empty"><b>No fill-ups yet</b>Fill to full, add the litres and your Trip A reading here, then reset Trip A. Your mileage shows straight away.</div>`}</section>
        <button class="btn fab" data-act="add-fuel">＋ Add fuel</button>`;
    actions = { open: el => fuelForm(logs.find(f => String(f.id) === el.dataset.id)) };
    if ($('#trend')) drawTrend($('#trend'), logs, svcs, ms.tanks);
    drawVs($('#vs'), ms.avg);
}
function fuelCard(f, t) {
    const p = parts(f.fill_date);
    return `<button class="card tap item" data-act="open" data-id="${f.id}">
        <div class="date"><b>${p.d}</b><span>${MONTHS[p.m - 1]} ${String(p.y).slice(2)}</span></div>
        <div><p style="font-weight:600">${Number(f.litres).toFixed(2)} L ${f.full_tank ? '<span class="badge ok">Full</span>' : '<span class="badge">Top-up</span>'}</p>
            <p class="small muted">${km(f.odometer_km)}${f.trip_a_km != null ? ` · Trip A ${Number(f.trip_a_km).toLocaleString('en-IN')}` : ''}${f.amount != null ? ` · ${rs(f.amount)}` : ''}</p></div>
        <div class="right">${t ? `<span class="kmpl">${t.kmpl.toFixed(1)}</span><br><span class="small muted">km/l</span>` : ''}</div></button>`;
}
function chart(t, avg) {
    const W = 600, H = 200, P = { l: 34, r: 12, t: 12, b: 24 };
    const ys = t.map(x => x.kmpl), lo = Math.floor(Math.min(...ys, avg) - 2), hi = Math.ceil(Math.max(...ys, avg) + 2);
    const X = i => P.l + (t.length === 1 ? 0 : i * (W - P.l - P.r) / (t.length - 1)), Y = v => P.t + (hi - v) * (H - P.t - P.b) / (hi - lo);
    const ticks = [lo, Math.round((lo + hi) / 2), hi];
    const pts = t.map((x, i) => `${X(i).toFixed(1)},${Y(x.kmpl).toFixed(1)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mileage per tank, average ${avg.toFixed(1)} km per litre">
        ${ticks.map(v => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        <line class="avg" x1="${P.l}" x2="${W - P.r}" y1="${Y(avg)}" y2="${Y(avg)}"/>
        <polyline class="ln" points="${pts}"/>
        ${t.map((x, i) => `<circle class="dot" cx="${X(i)}" cy="${Y(x.kmpl)}" r="4"><title>${fmtDate(x.end.fill_date)}: ${x.kmpl.toFixed(1)} km/l</title></circle>`).join('')}
        <text x="${P.l}" y="${H - 6}">${fmtDayMonth(t[0].end.fill_date)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${fmtDayMonth(t.at(-1).end.fill_date)}</text>
    </svg><p class="small muted" style="margin-top:6px">km/l per tank · dashed line is your average</p>`;
}

function fuelForm(f = null) {
    const logs = state.fuel || [];
    const prev = logs.filter(x => !f || x.id !== f.id);
    const r = f ? { ...f } : { fill_date: todayISO(), full_tank: true, odometer_km: currentOdo() };
    openSheet(f ? 'Edit fill-up' : 'Add fuel', `<form id="ff">
        <div class="grid2">
            <label>Date<input type="date" name="fill_date" required max="${todayISO()}" value="${esc(r.fill_date)}"></label>
            <label>Odometer (km)<input type="number" name="odometer_km" required min="0" inputmode="numeric" value="${esc(r.odometer_km ?? '')}"></label>
        </div>
        <div class="grid2">
            <label>Litres filled<input type="number" name="litres" required min="0.1" max="99" step="0.01" inputmode="decimal" value="${esc(r.litres ?? '')}"></label>
            <label>Amount paid (₹)<input type="number" name="amount" min="0" step="0.01" inputmode="decimal" value="${esc(r.amount ?? '')}"></label>
        </div>
        <label class="switch">Filled to full tank<input type="checkbox" name="full_tank"${r.full_tank ? ' checked' : ''}></label>
        <label id="trip-wrap">Trip A reading (km)<span class="hint">The Trip A number before you reset it</span><input type="number" name="trip_a_km" min="0" step="0.1" inputmode="decimal" value="${esc(r.trip_a_km ?? '')}"></label>
        <p class="calc" id="calc"></p>
        <label>Notes<input name="notes" maxlength="500" placeholder="Pump, highway run, etc." value="${esc(r.notes || '')}"></label>
        <button class="btn block">${f ? 'Save changes' : 'Save fill-up'}</button>
        ${f ? '<button type="button" class="btn danger block" id="del">Delete this fill-up</button>' : ''}
    </form>`, body => {
        const form = body.querySelector('#ff'), calc = body.querySelector('#calc');
        const update = () => {
            const d = Object.fromEntries(new FormData(form)); const full = form.full_tank.checked;
            body.querySelector('#trip-wrap').hidden = !full;
            const L = num(d.litres), A = num(d.amount), odo = num(d.odometer_km), msg = [];
            if (L && A) msg.push(`₹${(A / L).toFixed(2)} per litre`);
            if (full && L && odo != null) {
                const draft = { id: '__new', fill_date: d.fill_date, odometer_km: odo, litres: L, amount: A, full_tank: true, trip_a_km: num(d.trip_a_km) };
                const seq = [...prev, draft].sort((a, b) => a.odometer_km - b.odometer_km || a.fill_date.localeCompare(b.fill_date));
                const t = tanks(seq).find(x => x.end.id === '__new');
                if (t) msg.push(`<b style="color:var(--orange)">${t.kmpl.toFixed(1)} km/l</b> for this tank (${Math.round(t.dist)} km on ${t.litres.toFixed(2)} L)`);
                else if (!prev.some(x => x.full_tank && x.odometer_km < odo)) msg.push('Add the Trip A reading to see this tank’s mileage. Then reset Trip A.');
            }
            calc.innerHTML = msg.join(' · ');
        };
        form.oninput = update; update();
        const del = body.querySelector('#del');
        if (del) del.onclick = () => { if (confirmBox('Delete this fill-up?')) busy(del, async () => { await api.deleteFuel(f); await load.fuel(true); state.board = null; closeSheet(); render(); toast('Deleted'); }); };
        form.onsubmit = e => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(form)), full = form.full_tank.checked;
            const rec = { id: f?.id, fill_date: d.fill_date, odometer_km: num(d.odometer_km), litres: num(d.litres), amount: num(d.amount), full_tank: full, trip_a_km: full ? num(d.trip_a_km) : null, notes: d.notes.trim() || null };
            const before = prev.filter(x => x.fill_date <= rec.fill_date).sort((a, b) => b.odometer_km - a.odometer_km)[0];
            if (before && rec.odometer_km < before.odometer_km && !confirmBox(`The odometer (${km(rec.odometer_km)}) is lower than an earlier fill-up (${km(before.odometer_km)}). Save anyway?`)) return;
            busy(e.submitter, async () => { await api.saveFuel(rec); await load.fuel(true); state.board = null; closeSheet(); location.hash === '#mileage' ? render() : (location.hash = '#mileage'); toast(f ? 'Saved' : 'Fill-up added'); });
        };
    });
}

/* =================== Guides: Maintenance + Accessories (same sources as roninwb.in) =================== */
function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
        else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const heads = (rows.shift() || []).map(h => h.trim().toLowerCase());
    return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(heads.map((h, i) => [h, (r[i] || '').trim()])));
}
const fetchText = u => fetch(u).then(r => { if (!r.ok) throw new Error('load'); return r.text(); });
const fetchCSV = u => fetchText(u).catch(() => SITE.CORS_PROXY ? fetchText(SITE.CORS_PROXY + encodeURIComponent(u)) : Promise.reject(new Error('load')));
const driveImg = u => { const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=view&)?id=)([\w-]+)/); return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400` : u; };
const priceNum = p => { const m = String(p || '').match(/\d[\d,]*(?:\.\d+)?/); return m ? parseFloat(m[0].replace(/,/g, '')) : null; };
const safeLink = u => /^https?:\/\//i.test(u) ? u : '';
/* Keyword search: every typed word must appear somewhere (title or description), in any order.
   Ignores case, underscores/dashes, and simple word endings (cleaning = clean, brakes = brake); allows one small typo. */
/* common rider spellings and short forms */
const SYN = { tire: ['tyre'], tires: ['tyre'], break: ['brake'], breaks: ['brake'], lube: ['lubric', 'lubricat'], lubricate: ['lube', 'lubric'], grease: ['lubric', 'lube'],
    puncher: ['puncture'], petrol: ['fuel'], fuel: ['petrol'], mileage: ['kmpl', 'efficiency'], tyre: ['tire'], oil: ['lubricant'], bulb: ['light', 'lamp'], light: ['bulb', 'lamp'],
    cleaning: ['wash'], wash: ['clean'], batt: ['battery'], ecu: ['software'], pads: ['pad'], disc: ['disk'], disk: ['disc'], chian: ['chain'], sprocket: ['chain'] };
const normText = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = w => w.length > 4 ? w.replace(/(ings|ing|ed|es|s)$/, '') : w;
const near = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
function searchMatch(query, text) {
    const words = normText(query).split(' ').filter(Boolean); if (!words.length) return true;
    const hay = normText(text), toks = hay.split(' ');
    const one = w => hay.includes(w) || toks.some(t => { const a = stem(t), b = stem(w); return a.startsWith(b) || b.startsWith(a) && a.length >= 3 || (b.length >= 5 && near(a, b)); });
    return words.every(w => [w, ...(SYN[w] || [])].some(one));
}
function markWords(html, query) {
    const words = normText(query).split(' ').filter(w => w.length >= 2).map(w => stem(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return words.length ? html.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>') : html;
}
const pdfTitle = n => n.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/* =================== Guides (the ? button): App, Maintenance and Ride (setup file 66) ===================
   One place for every how-to. Three categories at the top (Maintenance opens first), and inside each one
   short videos ("shorts"), PDFs and pictures, with keyword search. App only has videos.
   Who adds what: Bodhi (super admin) App + Maintenance + Ride, admins Maintenance + Ride, coordinators Ride.
   Files don't use Supabase storage: the guides-media Edge Function keeps them in the free GitHub repo rwb-media and
   phones load them from jsDelivr (free CDN). The old Drive maintenance PDFs and the built-in app videos still show. */
const HELP_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.25.9c0 1.8-2.65 2.4-2.65 4.1"/><path d="M12 17.3h.01" stroke-width="2.4"/></svg>';
const GS = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const GD_ICO = {
    app: GS('<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.6h3"/><path d="M10.6 8.4v5.2l4.3-2.6z" fill="currentColor"/>'),
    maint: GS('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
    ride: GS('<path d="M8.5 3 4 21M15.5 3 20 21M12 4.2v2.6M12 10.4v3.2M12 17.4v3"/>'),
    video: GS('<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor"/>'),
    pdf: GS('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"/>'),
    image: GS('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17.5 5-4.5 4 3.5 2.5-2 4.5 3.5"/>'),
    all: GS('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    close: GS('<path d="M6 6l12 12M18 6 6 18"/>'),
    sound: GS('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    mute: GS('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5m0-5-5 5"/>'),
    more: GS('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
    upload: GS('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>')
};
const GD_CATS = {
    app: ['App', 'Short videos on using every part of the RWB App.'],
    maint: ['Maintenance', 'Keep your Ronin healthy. Videos, PDFs and pictures from the RWB team.'],
    ride: ['Ride', 'Group riding, safety and touring tips from the RWB team.']
};
const GD_KIND = { video: 'Videos', pdf: 'PDFs', image: 'Pictures' };
const GD_ONE = { video: 'Video', pdf: 'PDF', image: 'Picture' };
const GD_SUGG = { app: ['Track', 'Service', 'Mileage', 'MotoMart', 'Events', 'Pookie'], maint: ['Chain', 'Oil', 'Brakes', 'Tyres', 'Battery', 'Monsoon', 'Service'], ride: ['Group ride', 'Signals', 'Rain', 'Night', 'Packing', 'Touring'] };
/* limits: what fits jsDelivr (20 MB a file), GitHub's free repository size and a phone's data plan */
const GD_LIM = { sec: 60, videoMB: 20, aimMB: 14, side: 1280, pdfMB: 10, imgInMB: 15 };
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm';
const PDF_ACCEPT = 'application/pdf,.pdf';
const gState = { cat: 'maint', type: 'all', q: '' };
const mb = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const mmss = s => s == null || !isFinite(s) ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const gdDay = it => it.created_at ? fmtDayMonth(String(it.created_at).slice(0, 10)) : '';
const gdCatsFor = () => isFam() ? ['app'] : ['app', 'maint', 'ride'];

/* everything shown in Guides: uploads, the built-in app videos and the old Drive maintenance PDFs */
function builtinGuides() {
    const list = isFam() ? VIDEOS.filter(v => v[4] === 'fam') : VIDEOS.filter(v => v[4] !== 'fam' && (v[4] !== 'team' || isMod()));
    return list.map(([id, title, sub, sec, who], i) => ({ id: 'b-' + id, builtin: true, cat: 'app', kind: 'video', title, description: sub, tags: who === 'team' ? 'team coordinators admins' : '',
        url: `videos/${id}.mp4`, thumb_url: `videos/${id}.jpg`, duration_s: sec, team: who === 'team', uploader: 'RWB', order: i }));
}
/* The old Google Drive maintenance PDFs were moved into Guides (setup file 73, Nov 2026), so there is no Drive list any more */
async function driveGuides() { return []; }
/* The old Drive PDF list is slow (a Google script), so Guides never waits for it: it joins in when it arrives.
   The last list is also kept on the phone, so Guides opens instantly next time and refreshes in the background. */
const GD_KEY = 'rwb-gd-v2';   /* v2: the Drive PDFs moved into Guides (Nov 2026) */
const gdBuild = (db, drive, cats, setup = true) => ({ db, drive, setup, cats, all: [...db, ...drive, ...builtinGuides()] });
function gdFromPhone() {
    if (state.gd || isFam()) return state.gd;
    try { const c = JSON.parse(localStorage.getItem(GD_KEY)); if (c?.me === state.me?.id) state.gd = gdBuild(c.db || [], c.drive || [], c.cats || [], c.setup !== false); } catch { /* ignore */ }
    return state.gd;
}
let gdDriveJob = null;
async function loadGuides(force = false) {
    if (state.gd && !force) return state.gd;
    const [db, cats] = await Promise.all([
        isFam() ? Promise.resolve([]) : api.guideItems().catch(e => { if (!state.gd) throw e; return state.gd.db; }),
        isMod() ? api.guideCats().catch(() => []) : Promise.resolve([])
    ]);
    state.myId ??= await api.myId().catch(() => null);
    state.gd = gdBuild(db || [], state.gd?.drive || [], cats, db !== null);
    if (!isFam()) gdDriveJob ??= driveGuides().then(drive => {
        state.gd = gdBuild(state.gd.db, drive, state.gd.cats, state.gd.setup); gdSave();
        if (location.hash.startsWith('#guides')) drawGuides();
    }).catch(() => {}).finally(() => { gdDriveJob = null; });
    gdSave();
    return state.gd;
}
function gdSave() { if (isFam() || !state.gd) return; try { localStorage.setItem(GD_KEY, JSON.stringify({ me: state.me?.id, db: state.gd.db, drive: state.gd.drive, cats: state.gd.cats, setup: state.gd.setup })); } catch { /* full or blocked */ } }
const gdCanPost = cat => !!state.gd?.cats?.includes(cat);
const gdCanManage = it => !it.builtin && !it.drive && gdCanPost(it.cat) && (isAdmin() || it.user_id === state.myId);
const gdText = it => [it.title, it.description, it.tags, GD_CATS[it.cat]?.[0], GD_KIND[it.kind], it.uploader].filter(Boolean).join(' ');
/* newest first, built-in app videos in their own order after uploads */
const gdSort = list => [...list].sort((a, b) => (a.builtin - b.builtin) || (a.builtin ? a.order - b.order : String(b.created_at || '').localeCompare(String(a.created_at || ''))));
const gdIn = (cat, q = gState.q) => gdSort((state.gd?.all || []).filter(it => it.cat === cat && searchMatch(q, gdText(it))));

/* ---------- cards ---------- */
function gdShort(it, rail = false) {
    return `<button class="gd-short${rail ? ' in-rail' : ''}" data-act="gopen" data-id="${esc(it.id)}" aria-label="Play: ${esc(it.title)}">
        <span class="gd-cover">${it.thumb_url ? `<img src="${esc(it.thumb_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<span class="gd-ph">${GD_ICO.video}</span>`}
            ${it.duration_s ? `<i class="gd-dur">${mmss(it.duration_s)}</i>` : ''}<i class="gd-play">${GD_ICO.play}</i>${it.team ? '<i class="gd-team">Team</i>' : ''}${it.width && it.height && it.width > it.height ? '<i class="gd-land">Landscape</i>' : ''}</span>
        <b class="gd-t">${markWords(esc(it.title), gState.q)}</b><span class="gd-s">${esc([it.builtin ? 'RWB App' : it.uploader, gdDay(it)].filter(Boolean).join(' · '))}</span></button>`;
}
function gdDoc(it) {
    const meta = [it.pages ? `${it.pages} page${it.pages === 1 ? '' : 's'}` : '', it.bytes ? mb(it.bytes) : '', it.uploader, gdDay(it)].filter(Boolean).join(' · ');
    return `<button class="gd-doc" data-act="gopen" data-id="${esc(it.id)}"><span class="gd-doc-ico">${GD_ICO.pdf}<em>PDF</em></span>
        <span class="grow"><b>${markWords(esc(it.title), gState.q)}</b>${it.description ? `<span class="gd-desc">${markWords(esc(it.description), gState.q)}</span>` : ''}<span class="gd-meta">${esc(meta)}</span></span>${ICON.chev}</button>`;
}
function gdPic(it) {
    return `<button class="gd-pic" data-act="gopen" data-id="${esc(it.id)}" aria-label="${esc(it.title)}"><img src="${esc(it.thumb_url || it.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><span class="gd-pic-t">${esc(it.title)}</span></button>`;
}
const gdSection = (title, n, kind, body) => `<section class="section gd-sec"><h2>${title}${n > 0 ? ` <button data-act="gtype" data-t="${kind}">See all ${n} ›</button>` : ''}</h2>${body}</section>`;

/* ---------- the screen ---------- */
async function viewGuides() {
    const p = state.param;
    if (p && gdCatsFor().includes(p)) { Object.assign(gState, { cat: p, type: 'all', q: '' }); history.replaceState(null, '', '#guides'); state.param = null; }
    if (!gdCatsFor().includes(gState.cat)) gState.cat = gdCatsFor()[0];
    const cats = gdCatsFor();
    app.innerHTML = top('Guides') + `
        ${cats.length > 1 ? `<div class="gd-head">
            <div class="gd-cats" role="tablist" aria-label="Guides">${cats.map(c => `<button role="tab" aria-selected="${c === gState.cat}" data-act="gcat" data-c="${c}">${GD_ICO[c]}<span>${GD_CATS[c][0]}</span><i class="gd-qn" hidden></i></button>`).join('')}</div>
            <button class="mm-search-btn gd-sbtn" data-act="gsearch" aria-label="Search guides">${SEARCH_ICO}</button></div>` : ''}
        <div id="gd-body">${gdFromPhone() ? '' : GD_SKEL}</div><div class="mm-fabs" id="gd-fab" hidden></div>`;
    actions = {
        gcat: el => { const c = el.dataset.c; if (c === gState.cat) return; gState.cat = c; gState.type = 'all'; gdPill(); drawGuides(true); },
        gtype: el => { gState.type = el.dataset.t; drawGuides(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
        gsearch: () => gdSearch(),
        'gq-clear': () => { gState.q = ''; drawGuides(); },
        gopen: el => gdOpen(el.dataset.id),
        gadd: () => gdForm({ cat: gState.cat, kind: gState.type !== 'all' ? gState.type : null }, () => { if (location.hash.startsWith('#guides')) viewGuides(); })
    };
    gdPill(); requestAnimationFrame(() => app.querySelector('.gd-cats')?.classList.add('ready'));
    if (typeof RWBPdf !== 'undefined') setTimeout(() => RWBPdf.preload().catch(() => {}), 1200);   /* PDFs open fast */
    const n = navN;
    if (state.gd) { drawGuides(); loadGuides(true).then(() => stillHere(n) && drawGuides()).catch(() => {}); return; }   /* cache first, fresh copy in the background */
    try { await loadGuides(); } catch (e) { if (stillHere(n)) $('#gd-body').innerHTML = `<div class="card empty"><b>Could not load Guides</b>${esc(e.message)}<p style="margin-top:12px"><button class="btn sm" onclick="location.reload()">Try again</button></p></div>`; return; }
    if (stillHere(n)) drawGuides();
}
/* while the very first list loads: a quiet placeholder in the shape of the real screen */
const GD_SKEL = `<div class="gd-skel" aria-hidden="true"><i class="sk-line"></i><div class="sk-row"><i class="sk-pill"></i><i class="sk-pill"></i><i class="sk-pill"></i></div>
    <i class="sk-h"></i><div class="sk-row"><i class="sk-short"></i><i class="sk-short"></i><i class="sk-short"></i></div><i class="sk-h"></i><i class="sk-doc"></i><i class="sk-doc"></i></div><span class="sr-only">Loading</span>`;
/* the white pill slides under the chosen category, sized to its label */
function gdPill() {
    const bar = app.querySelector('.gd-cats'); if (!bar) return;
    bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.c === gState.cat));
    const b = bar.querySelector(`[data-c="${gState.cat}"]`); if (!b) return;
    bar.style.setProperty('--x', b.offsetLeft + 'px'); bar.style.setProperty('--w', b.offsetWidth + 'px');
}
addEventListener('resize', () => gdPill());
function drawGuides(fade = false) {
    const box = $('#gd-body'); if (!box || !state.gd) return;
    const cat = gState.cat, q = gState.q.trim(), list = gdIn(cat);
    const by = k => list.filter(it => it.kind === k);
    const v = by('video'), d = by('pdf'), im = by('image');
    if (cat === 'app') gState.type = 'all';
    /* while searching, each category tab shows how many matches it has */
    app.querySelectorAll('.gd-cats button').forEach(b => { const c = b.querySelector('.gd-qn'), k = q ? gdIn(b.dataset.c).length : 0; c.hidden = !k; c.textContent = k; });
    const types = cat === 'app' ? [] : ['all', 'video', 'pdf', 'image'].filter(k => k === 'all' || by(k).length);
    if (!types.includes(gState.type)) gState.type = 'all';
    const t = gState.type;
    let body = '';
    if (!list.length) {
        body = `<div class="card empty gd-empty"><span class="gd-empty-ico">${GD_ICO[cat]}</span><b>${q ? `Nothing in ${GD_CATS[cat][0]} matches “${esc(q)}”` : 'Nothing here yet'}</b>${q ? 'Try another word, or another category above.' : gdCanPost(cat) ? 'Be the first: tap “＋ Add” below.' : 'The RWB team is adding guides here soon.'}</div>`;
    } else if (cat === 'app' || t === 'video') {
        body = `<div class="gd-shorts">${(cat === 'app' ? list : v).map(it => gdShort(it)).join('')}</div>`;
    } else if (t === 'pdf') body = `<div class="group gd-docs">${d.map(gdDoc).join('')}</div>`;
    else if (t === 'image') body = `<div class="gd-pics">${im.map(gdPic).join('')}</div>`;
    else {
        body = (v.length ? gdSection('Shorts', v.length > 2 ? v.length : 0, 'video', `<div class="gd-rail">${v.slice(0, 12).map(it => gdShort(it, true)).join('')}</div>`) : '')
            + (d.length ? gdSection('PDF guides', d.length > 4 ? d.length : 0, 'pdf', `<div class="group gd-docs">${d.slice(0, 4).map(gdDoc).join('')}</div>`) : '')
            + (im.length ? gdSection('Pictures', im.length > 6 ? im.length : 0, 'image', `<div class="gd-pics">${im.slice(0, 6).map(gdPic).join('')}</div>`) : '');
    }
    const count = list.length, setupNote = !state.gd.setup && isAdmin() && !isFam() ? '<p class="small muted gd-note">Uploads switch on after setup file 66 (guides.sql) is run in Supabase.</p>' : '';
    box.innerHTML = `<div class="gd-pane${fade ? ' gd-in' : ''}">
        <p class="gd-intro"><span>${GD_CATS[cat][1]}</span>${count ? `<b>${count} ${count === 1 ? 'item' : 'items'}</b>` : ''}</p>
        ${types.length > 2 ? `<div class="gd-types" role="tablist">${types.map(k => `<button class="gd-type" role="tab" aria-selected="${t === k}" data-act="gtype" data-t="${k}">${GD_ICO[k]}<span>${k === 'all' ? 'All' : GD_KIND[k]}</span><i>${k === 'all' ? list.length : by(k).length}</i></button>`).join('')}</div>` : ''}
        ${q ? `<div class="mm-qbar"><span>${list.length} result${list.length === 1 ? '' : 's'} for <b>“${esc(q)}”</b></span><button class="linkish" data-act="gq-clear">Clear ✕</button></div>` : ''}
        ${body}${setupNote}
        ${cat === 'maint' ? `<a class="card tap row gd-link" href="#motomart/new"><span class="ai-badge sm">${ICON.helmet}</span><div class="grow"><h3>Looking for accessories?</h3><p class="small muted">They’re in MotoMart → New</p></div><span class="kmpl">›</span></a>` : ''}
        ${isFam() ? '' : `<a class="card tap row ai-card gd-link" href="#chat"><span class="ai-badge sm">${AI_ICON}</span><div class="grow"><h3>Can't find it?</h3><p class="small muted">Ask Pookie: it reads these guides too</p></div><span class="kmpl">›</span></a>`}
        </div>`;
    /* the add button sits outside the animated list, so it stays pinned above the tab bar */
    const fab = $('#gd-fab'), canAdd = gdCanPost(cat) && state.gd.setup;
    if (fab) { fab.hidden = !canAdd; fab.innerHTML = canAdd ? `<button class="btn fab-1" data-act="gadd">＋ Add to ${GD_CATS[cat][0]}</button>` : ''; }
}

/* ---------- search: drops down over Guides with live matches from every category ---------- */
function gdSearch() {
    document.querySelector('.mm-search')?.remove();
    const box = document.createElement('div'); box.className = 'mm-search gd-search'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Search Guides');
    const items = state.gd?.all || [];
    const sugg = (GD_SUGG[gState.cat] || []).filter(w => items.some(it => it.cat === gState.cat && searchMatch(w, gdText(it))));
    box.innerHTML = `<div class="mm-search-bar"><span class="mm-s-ico">${SEARCH_ICO}</span><input type="search" enterkeyhint="search" placeholder="Search chain, brakes, group ride…" value="${esc(gState.q)}" aria-label="Search"><button class="linkish" data-x="close">Cancel</button></div><div class="mm-sugg" role="listbox"></div>`;
    document.body.append(box);
    const input = box.querySelector('input'), list = box.querySelector('.mm-sugg');
    const go = q => { gState.q = q; gState.type = 'all';
        if (q && !gdIn(gState.cat, q).length) { const c = gdCatsFor().find(k => gdIn(k, q).length); if (c) { gState.cat = c; gdPill(); } }
        closeMmSearch(); drawGuides(); };
    const row = it => `<button class="mm-s-row" data-id="${esc(it.id)}"><span class="mm-s-img gd-s-img">${it.thumb_url ? `<img src="${esc(it.thumb_url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${GD_ICO[it.kind]}</span>
        <span class="grow"><b>${markWords(esc(it.title), input.value)}</b><small>${GD_CATS[it.cat][0]} · ${GD_ONE[it.kind]}${it.duration_s ? ' · ' + mmss(it.duration_s) : ''}</small></span></button>`;
    const draw = () => {
        const q = input.value.trim();
        if (!q) {
            const fresh = gdSort(items.filter(it => it.cat === gState.cat && !it.builtin)).slice(0, 4);
            list.innerHTML = (sugg.length ? `<p class="mm-s-h">Try</p><div class="chips">${sugg.map(c => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '')
                + (fresh.length ? `<p class="mm-s-h">New in ${GD_CATS[gState.cat][0]}</p>${fresh.map(row).join('')}` : '');
            return;
        }
        const hits = gdSort(items.filter(it => searchMatch(q, gdText(it)))).sort((a, b) => (b.cat === gState.cat) - (a.cat === gState.cat));
        list.innerHTML = hits.length ? hits.slice(0, 7).map(row).join('') + `<button class="mm-s-all" data-all="1">See all ${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}” ›</button>`
            : `<p class="mm-s-none">Nothing matches “${esc(q)}” yet. <a href="#chat">Ask Pookie</a></p>`;
    };
    input.oninput = draw;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value.trim()); } if (e.key === 'Escape') closeMmSearch(); };
    box.onclick = e => {
        if (e.target === box || e.target.closest('[data-x=close]')) return closeMmSearch();
        const c = e.target.closest('[data-q]'); if (c) { input.value = c.dataset.q; draw(); input.focus(); return; }
        if (e.target.closest('[data-all]')) return go(input.value.trim());
        const r = e.target.closest('[data-id]'); if (r) { closeMmSearch(); gdOpen(r.dataset.id); }
    };
    draw(); requestAnimationFrame(() => { box.classList.add('on'); input.focus(); });
}

/* ---------- opening an item ---------- */
function gdOpen(id) {
    const it = state.gd?.all.find(x => String(x.id) === String(id)); if (!it) return;
    /* videos and pictures open with their neighbours, so the rider can swipe through what's on screen */
    const same = gdIn(it.cat).filter(x => x.kind === it.kind);
    const list = same.some(x => x.id === it.id) ? same : [it];
    if (it.kind === 'video') return gdPlayer(list, list.indexOf(it));
    if (it.kind === 'image') return gdViewer(list, list.indexOf(it));
    gdPdf(it);
}
/* PDFs open in our own viewer (js/pdfview.js): pages as pictures, no download, print or "open" buttons */
function gdPdf(it) {
    const demo = api.demo && !/^https:/.test(it.url || ''), ok = !demo && typeof RWBPdf !== 'undefined';
    let v = null;
    openSheet(it.title, `${it.description ? `<p class="small muted" style="margin:-4px 0 10px">${esc(it.description)}</p>` : ''}
        ${ok ? '<div class="gd-pdfhost"></div>' : `<div class="card empty gd-empty"><span class="gd-empty-ico">${GD_ICO.pdf}</span><b>PDF preview</b>${demo ? 'In the real app the PDF opens here.' : 'Please update the app and try again.'}</div>`}
        <p class="gd-meta" style="margin:10px 2px">${esc([it.pages ? it.pages + ' pages' : '', it.bytes ? mb(it.bytes) : '', it.uploader, gdDay(it)].filter(Boolean).join(' · '))}</p>
        <div class="gd-sheet-acts">${ok ? '<button class="btn ghost" data-x="full">Full screen</button>' : ''}${gdCanManage(it) ? `<button class="btn ghost" data-x="manage">${GD_ICO.more} Manage</button>` : ''}</div>`, body => {
        if (ok) { v = RWBPdf.show(body.querySelector('.gd-pdfhost'), it.url, { poster: it.thumb_url }); sheet.addEventListener('close', () => v?.close(), { once: true }); }
        body.querySelector('[data-x=full]')?.addEventListener('click', () => { v?.close(); v = null; closeSheet(); gdPdfFull(it); });
        body.querySelector('[data-x=manage]')?.addEventListener('click', () => gdManage(it));
    });
}
function gdPdfFull(it) {
    const L = gdOverlay('gd-player gd-pdfx', it.title);
    L.el.innerHTML = `<div class="gd-pdfx-host"></div><div class="gd-ptop"><button class="gd-glass" data-x="close" aria-label="Close">${GD_ICO.close}</button><span class="gd-count gd-pdfx-t">${esc(it.title)}</span><span></span></div>`;
    const v = RWBPdf.show(L.el.querySelector('.gd-pdfx-host'), it.url, { poster: it.thumb_url }); L.cleanup.push(() => v.close());
    L.el.querySelector('[data-x=close]').addEventListener('click', () => gdClose());
}

/* full-screen overlays (video player, picture viewer) close with the phone's Back button too */
let gdLayer = null;
function gdOverlay(cls, label) {
    gdClose(true);
    const el = document.createElement('div'); el.className = cls; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label);
    document.body.append(el); document.documentElement.classList.add('gd-locked');
    try { history.pushState({ ...(history.state || {}), gdLayer: 1 }, ''); } catch { /* ignore */ }
    gdLayer = { el, pushed: true, cleanup: [] };
    requestAnimationFrame(() => el.classList.add('on'));
    return gdLayer;
}
function gdClose(silent = false) {
    if (!gdLayer) return;
    const L = gdLayer; gdLayer = null;
    L.cleanup.forEach(f => { try { f(); } catch { /* ignore */ } });
    L.el.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    L.el.classList.remove('on'); setTimeout(() => L.el.remove(), 200);
    document.documentElement.classList.remove('gd-locked');
    if (!silent && L.pushed && history.state?.gdLayer) history.back();
}
addEventListener('popstate', () => { if (gdLayer) { gdLayer.pushed = false; gdClose(true); } });
addEventListener('keydown', e => { if (gdLayer && e.key === 'Escape') gdClose(); });

let gdMuted = false;
function gdPlayer(list, start = 0) {
    const L = gdOverlay('gd-player', 'Video');
    L.el.innerHTML = `<div class="gd-reel">${list.map((it, i) => `<section class="gd-slide" data-i="${i}">
            <video playsinline preload="none" ${it.thumb_url ? `poster="${esc(it.thumb_url)}"` : ''} data-src="${esc(it.url)}" disablepictureinpicture disableremoteplayback oncontextmenu="return false"></video>
            <div class="gd-shade"></div><span class="gd-paused">${GD_ICO.play}</span><span class="gd-spin"></span>
            <div class="gd-info"><b>${esc(it.title)}</b>${it.description ? `<p>${esc(it.description)}</p>` : ''}<span>${esc([it.builtin ? 'RWB App' : it.uploader, gdDay(it), mmss(it.duration_s)].filter(Boolean).join(' · '))}</span></div>
            <div class="gd-bar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100"><i></i></div></section>`).join('')}</div>
        <div class="gd-ptop"><button class="gd-glass" data-x="close" aria-label="Close">${GD_ICO.close}</button>
            ${list.length > 1 ? `<span class="gd-count"><b>${start + 1}</b> / ${list.length}</span>` : '<span></span>'}
            <span class="gd-pr">${gdCanManage(list[start]) ? `<button class="gd-glass" data-x="manage" aria-label="Manage">${GD_ICO.more}</button>` : ''}<button class="gd-glass" data-x="mute" aria-label="${gdMuted ? 'Sound on' : 'Mute'}">${gdMuted ? GD_ICO.mute : GD_ICO.sound}</button></span></div>
        ${list.length > 1 ? '<div class="gd-hint">Swipe up for the next one</div>' : ''}`;
    const reel = L.el.querySelector('.gd-reel'), slides = [...L.el.querySelectorAll('.gd-slide')];
    let cur = -1, raf = 0;
    const vid = i => slides[i]?.querySelector('video');
    const load = (i, pre) => { const v = vid(i); if (v && !v.src) { v.preload = pre; v.src = v.dataset.src; } };
    const tick = () => { const v = vid(cur), bar = slides[cur]?.querySelector('.gd-bar i');
        if (v && bar) { const d = isFinite(v.duration) && v.duration ? v.duration : list[cur].duration_s || 0; bar.style.width = d ? Math.min(100, v.currentTime / d * 100) + '%' : '0'; }
        raf = requestAnimationFrame(tick); };
    const play = async i => {
        const v = vid(i); if (!v) return; v.muted = gdMuted;
        try { await v.play(); }
        catch { if (!gdMuted) { v.muted = true; try { await v.play(); toast('Tap 🔈 for sound'); } catch { slides[i].classList.add('paused'); } } else slides[i].classList.add('paused'); }
    };
    const activate = i => {
        if (i === cur) return; cur = i;
        slides.forEach((s, k) => { const v = vid(k); if (k !== i && v) { v.pause(); s.classList.remove('paused'); } });
        load(i, 'auto'); load(i + 1, 'auto'); load(i + 2, 'metadata');
        const c = L.el.querySelector('.gd-count b'); if (c) c.textContent = i + 1;
        const pr = L.el.querySelector('.gd-pr'), canM = gdCanManage(list[i]), mbtn = pr.querySelector('[data-x=manage]');
        if (canM && !mbtn) pr.insertAdjacentHTML('afterbegin', `<button class="gd-glass" data-x="manage" aria-label="Manage">${GD_ICO.more}</button>`); else if (!canM && mbtn) mbtn.remove();
        const v = vid(i); v.currentTime = 0; play(i);
    };
    slides.forEach((s, i) => {
        const v = vid(i);
        v.addEventListener('waiting', () => s.classList.add('wait')); v.addEventListener('playing', () => { s.classList.remove('wait', 'paused'); });
        v.addEventListener('pause', () => { if (i === cur && !v.ended) s.classList.add('paused'); });
        v.addEventListener('ended', () => { if (i < slides.length - 1) reel.scrollTo({ top: slides[i + 1].offsetTop, behavior: 'smooth' }); else { v.currentTime = 0; play(i); } });
        v.addEventListener('error', () => { s.classList.remove('wait'); s.classList.add('broken'); });
        s.addEventListener('click', e => {
            if (e.target.closest('.gd-bar')) return;
            if (v.paused) { s.classList.remove('paused'); play(i); } else v.pause();
        });
        const bar = s.querySelector('.gd-bar');
        const seek = e => { const r = bar.getBoundingClientRect(), d = isFinite(v.duration) && v.duration ? v.duration : list[i].duration_s; if (d) v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d; };
        bar.addEventListener('pointerdown', e => { seek(e); bar.setPointerCapture(e.pointerId); bar.onpointermove = seek; });
        bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
    });
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.intersectionRatio > .6) activate(Number(e.target.dataset.i)); }), { root: reel, threshold: [.6] });
    slides.forEach(s => io.observe(s));
    L.cleanup.push(() => io.disconnect(), () => cancelAnimationFrame(raf));
    L.el.addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (!x) return; e.stopPropagation();
        if (x.dataset.x === 'close') gdClose();
        if (x.dataset.x === 'mute') { gdMuted = !gdMuted; const v = vid(cur); if (v) v.muted = gdMuted; x.innerHTML = gdMuted ? GD_ICO.mute : GD_ICO.sound; x.setAttribute('aria-label', gdMuted ? 'Sound on' : 'Mute'); }
        if (x.dataset.x === 'manage') { const it = list[cur]; gdClose(); setTimeout(() => gdManage(it), 250); }
    });
    L.el.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && cur < slides.length - 1) reel.scrollTo({ top: slides[cur + 1].offsetTop, behavior: 'smooth' }); if (e.key === 'ArrowUp' && cur > 0) reel.scrollTo({ top: slides[cur - 1].offsetTop, behavior: 'smooth' }); });
    requestAnimationFrame(() => { reel.scrollTop = slides[start].offsetTop; activate(start); tick(); L.el.tabIndex = -1; L.el.focus(); });
}
function gdViewer(list, start = 0) {
    const L = gdOverlay('gd-player gd-viewer', 'Picture');
    L.el.innerHTML = `<div class="gd-hreel">${list.map((it, i) => `<figure class="gd-ph-slide" data-i="${i}"><div class="gd-zoom"><img src="${esc(it.url)}" alt="${esc(it.title)}" referrerpolicy="no-referrer" draggable="false"></div>
            <figcaption class="gd-info"><b>${esc(it.title)}</b>${it.description ? `<p>${esc(it.description)}</p>` : ''}<span>${esc([it.uploader, gdDay(it)].filter(Boolean).join(' · '))} · double-tap to zoom</span></figcaption></figure>`).join('')}</div>
        <div class="gd-ptop"><button class="gd-glass" data-x="close" aria-label="Close">${GD_ICO.close}</button>
            ${list.length > 1 ? `<span class="gd-count"><b>${start + 1}</b> / ${list.length}</span>` : '<span></span>'}
            <span class="gd-pr">${gdCanManage(list[start]) ? `<button class="gd-glass" data-x="manage" aria-label="Manage">${GD_ICO.more}</button>` : ''}</span></div>`;
    const reel = L.el.querySelector('.gd-hreel'), slides = [...reel.children];
    let cur = start;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.intersectionRatio > .6) { cur = Number(e.target.dataset.i); const c = L.el.querySelector('.gd-count b'); if (c) c.textContent = cur + 1;
        const pr = L.el.querySelector('.gd-pr'); pr.innerHTML = gdCanManage(list[cur]) ? `<button class="gd-glass" data-x="manage" aria-label="Manage">${GD_ICO.more}</button>` : ''; } }), { root: reel, threshold: [.6] });
    slides.forEach(s => io.observe(s)); L.cleanup.push(() => io.disconnect());
    /* double-tap (or double-click) zooms into that spot; again zooms out */
    let lastTap = 0;
    reel.addEventListener('click', e => {
        const z = e.target.closest('.gd-zoom'); if (!z) return;
        const now = Date.now(); if (now - lastTap > 320) { lastTap = now; L.el.classList.toggle('chrome-off'); return; }
        lastTap = 0; L.el.classList.remove('chrome-off');
        const on = !z.classList.contains('zoomed'), img = z.querySelector('img'), r = img.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        z.classList.toggle('zoomed', on); reel.style.overflowX = on ? 'hidden' : '';
        if (on) requestAnimationFrame(() => { z.scrollLeft = fx * z.scrollWidth - z.clientWidth / 2; z.scrollTop = fy * z.scrollHeight - z.clientHeight / 2; });
    });
    L.el.addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (!x) return; e.stopPropagation();
        if (x.dataset.x === 'close') gdClose();
        if (x.dataset.x === 'manage') { const it = list[cur]; gdClose(); setTimeout(() => gdManage(it), 250); }
    });
    requestAnimationFrame(() => { reel.scrollLeft = slides[start].offsetLeft; });
}

/* ---------- edit / delete (the person who added it, or an admin) ---------- */
function gdManage(it) {
    openSheet('Manage', `<form id="gde">
        <div class="gd-mhead"><span class="gd-ath">${it.thumb_url ? `<img src="${esc(it.thumb_url)}" alt="" referrerpolicy="no-referrer">` : GD_ICO[it.kind]}</span><span class="grow"><b>${GD_CATS[it.cat][0]} · ${GD_ONE[it.kind]}</b><span class="small muted">${esc([it.uploader, gdDay(it), it.bytes ? mb(it.bytes) : '', mmss(it.duration_s)].filter(Boolean).join(' · '))}</span></span></div>
        <label>Title<input name="title" required minlength="2" maxlength="80" value="${esc(it.title)}"></label>
        <label>Description <span class="hint">optional</span><textarea name="description" maxlength="400" rows="3">${esc(it.description || '')}</textarea></label>
        <label>Search keywords <span class="hint">optional, helps people find it</span><input name="tags" maxlength="200" placeholder="chain, lube, kerosene" value="${esc(it.tags || '')}"></label>
        <button class="btn block">Save changes</button>
        <button type="button" class="btn danger block" data-x="del" style="margin-top:10px">Delete from Guides</button></form>`, body => {
        body.querySelector('#gde').onsubmit = e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); busy(e.submitter || e.target.querySelector('.btn'), async () => {
            await api.guideEdit(it.id, f); await loadGuides(true); closeSheet(); toast('Saved'); gdRefresh(); }); };
        body.querySelector('[data-x=del]').onclick = el => { if (!confirmBox(`Delete “${it.title}” from Guides? It's removed for everyone.`)) return;
            busy(el.currentTarget || el.target, async () => { await api.guideDelete(it); await loadGuides(true); closeSheet(); toast('Deleted'); gdRefresh(); }); };
    });
}
function gdRefresh() { if (location.hash.startsWith('#guides')) drawGuides(); else if (location.hash.startsWith('#admin') && state.adminTab === 'guides') adminGuides(); }

/* ---------- adding: one sheet for videos, PDFs and pictures, with the rules shown up front ---------- */
const GD_RULES = {
    video: [['Hold the phone upright', 'Portrait (9:16) fills the screen; sideways videos show small on phones.'], [`${GD_LIM.sec} seconds or less`, 'Short and to the point. Trim it in your gallery first.'],
        ['We make it small for you', `The app turns it into 720p (about ${GD_LIM.aimMB} MB or less) before sending. Keep this screen open while it works.`], ['MP4, MOV or WebM', 'Good light, steady hands, speak clearly. No music you don’t own.']],
    pdf: [[`PDF only, up to ${GD_LIM.pdfMB} MB`, 'Bigger? Use a PDF compressor or split it.'], ['Typed text, not photos of pages', 'Pookie reads the text, so typed PDFs help him answer questions.'], ['A clear title', 'Like “Chain cleaning in 5 steps”.']],
    image: [['JPG, PNG, WebP or HEIC', `Up to ${GD_LIM.imgInMB} MB. GIF, SVG and other files aren't allowed, for safety.`], ['We shrink it to about 300 KB', 'Still sharp on a phone, light on everyone’s data.'], ['Charts, diagrams, checklists', 'One idea per picture works best.']]
};
function gdForm(pre = {}, onDone) {
    const cats = state.gd?.cats || [];
    if (!cats.length) return toast('Only admins and coordinators can add to Guides', true);
    const f = { cat: cats.includes(pre.cat) ? pre.cat : cats.includes('ride') && !cats.includes('maint') ? 'ride' : cats.includes('maint') ? 'maint' : cats[0], kind: pre.kind || 'video', file: null, out: null, thumb: null, meta: {}, ok: false, shrink: false, keep: false, job: null };
    if (f.cat === 'app') f.kind = 'video';
    const segCats = () => cats.length > 1 ? `<div class="seg gd-fseg" role="tablist">${cats.map(c => `<button type="button" role="tab" aria-selected="${f.cat === c}" data-cat="${c}">${GD_ICO[c]} ${GD_CATS[c][0]}</button>`).join('')}</div>`
        : `<p class="gd-fixed">${GD_ICO[f.cat]} <b>${GD_CATS[f.cat][0]}</b> <span class="small muted">· ${f.cat === 'ride' && !isAdmin() ? 'coordinators add Ride guides' : ''}</span></p>`;
    const kinds = () => f.cat === 'app' ? `<p class="small muted gd-applabel">${GD_ICO.video} App guides are short videos only.</p>`
        : `<div class="gd-kinds">${['video', 'pdf', 'image'].map(k => `<button type="button" class="gd-kind" aria-pressed="${f.kind === k}" data-kind="${k}">${GD_ICO[k]}<b>${GD_ONE[k]}</b><small>${k === 'video' ? `≤ ${GD_LIM.sec} s` : k === 'pdf' ? `≤ ${GD_LIM.pdfMB} MB` : 'JPG · PNG · HEIC'}</small></button>`).join('')}</div>`;
    const rules = () => `<ul class="gd-rules">${GD_RULES[f.kind].map(([b, s]) => `<li><i>✓</i><span><b>${b}</b> ${s}</span></li>`).join('')}
        <li class="pub"><i>!</i><span><b>Everyone can see it.</b> Files are public on the internet. No member’s face without their OK, no number plates, phone numbers or bills.</span></li></ul>`;
    const accept = () => f.kind === 'video' ? VIDEO_ACCEPT : f.kind === 'pdf' ? PDF_ACCEPT : MM_ACCEPT;
    openSheet('Add to Guides', `<form id="gdf" novalidate>
        <div id="gdf-top"></div>
        <label class="gd-drop" id="gdf-drop"><input type="file" id="gdf-file" hidden><span class="gd-drop-ico">${GD_ICO.upload}</span><b id="gdf-pick">Choose a video</b><small class="muted" id="gdf-hint"></small></label>
        <div id="gdf-prev"></div>
        <label>Title<input name="title" required minlength="2" maxlength="80" placeholder="e.g. Chain clean & lube in 50 seconds"></label>
        <label>Description <span class="hint">optional</span><textarea name="description" maxlength="400" rows="2" placeholder="One or two lines: what it shows, any part names or numbers"></textarea></label>
        <label>Search keywords <span class="hint">optional</span><input name="tags" maxlength="200" placeholder="chain, lube, kerosene"></label>
        <div class="gd-progress" id="gdf-prog" hidden><div class="row"><b id="gdf-step">Uploading</b><span class="grow"></span><span id="gdf-pct">0%</span></div><div class="bar"><i></i></div><small class="muted" id="gdf-sub"></small></div>
        <button class="btn block" id="gdf-go" disabled>Add to ${GD_CATS[f.cat][0]}</button>
        <button type="button" class="btn ghost block" id="gdf-stop" hidden style="margin-top:8px">Stop</button>
    </form>`, body => {
        const $b = s => body.querySelector(s), input = $b('#gdf-file');
        const drawTop = () => { $b('#gdf-top').innerHTML = segCats() + kinds() + rules(); input.accept = accept(); $b('#gdf-pick').textContent = `Choose a ${GD_ONE[f.kind].toLowerCase()}`;
            $b('#gdf-hint').textContent = f.kind === 'video' ? 'From your gallery or files' : f.kind === 'pdf' ? 'From your files' : 'From your gallery'; $b('#gdf-go').textContent = `Add to ${GD_CATS[f.cat][0]}`; };
        const reset = () => { if (f.prevUrl) URL.revokeObjectURL(f.prevUrl); Object.assign(f, { file: null, out: null, thumb: null, meta: {}, ok: false, shrink: false, keep: false, prevUrl: null }); input.value = ''; $b('#gdf-prev').innerHTML = ''; $b('#gdf-drop').hidden = false; $b('#gdf-go').disabled = true; };
        drawTop();
        $b('#gdf-top').addEventListener('click', e => {
            const c = e.target.closest('[data-cat]'), k = e.target.closest('[data-kind]');
            if (c) { f.cat = c.dataset.cat; if (f.cat === 'app' && f.kind !== 'video') { f.kind = 'video'; reset(); } drawTop(); }
            if (k && k.dataset.kind !== f.kind) { f.kind = k.dataset.kind; reset(); drawTop(); }
        });
        input.onchange = async () => {
            const file = input.files[0]; if (!file) return;
            /* picked a different kind of file than the tile says? switch to the right tile instead of refusing it */
            const ext = (file.name || '').toLowerCase().split('.').pop();
            const real = /^video\//.test(file.type) || /^(mp4|mov|m4v|webm)$/.test(ext) ? 'video' : file.type === 'application/pdf' || ext === 'pdf' ? 'pdf' : /^image\//.test(file.type) || /^(jpe?g|png|webp|heic|heif)$/.test(ext) ? 'image' : null;
            if (real && real !== f.kind && (f.cat !== 'app' || real === 'video')) { f.kind = real; drawTop(); }
            reset(); f.file = file; $b('#gdf-drop').hidden = true;
            $b('#gdf-prev').innerHTML = `<div class="gd-preview"><span class="gd-pmedia">${GD_ICO[f.kind]}</span><div class="grow"><b>${esc(file.name || 'File')}</b><p class="small muted">Checking…</p></div></div>`;
            try { await gdCheck(f); } catch (e) { f.checks = [['bad', 'Can’t use this file', e.message]]; f.ok = false; }
            drawPrev();
            const t = body.querySelector('[name=title]'); if (!t.value && f.ok) t.value = (file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b(VID|IMG|PXL|Screenshot)\s?\d[\d ]*/gi, '').trim().slice(0, 80);
        };
        const drawPrev = () => {
            const m = f.meta, media = f.prevUrl ? (f.kind === 'video' ? `<video src="${f.prevUrl}" muted playsinline preload="metadata"${f.thumbUrl ? ` poster="${f.thumbUrl}"` : ''}></video>` : `<img src="${f.prevUrl}" alt="">`) : GD_ICO[f.kind];
            $b('#gdf-prev').innerHTML = `<div class="gd-preview"><span class="gd-pmedia ${f.kind}">${media}</span><div class="grow"><b>${esc(f.file.name || GD_ONE[f.kind])}</b>
                <p class="small muted">${esc([mb(f.file.size), m.duration_s ? mmss(m.duration_s) : '', m.width ? `${m.width}×${m.height}` : '', m.pages ? `${m.pages} pages` : ''].filter(Boolean).join(' · '))}</p>
                <button type="button" class="linkish" data-x="again">Choose another</button></div></div>
                <ul class="gd-checks">${f.checks.map(([lv, b, s]) => `<li class="${lv}"><i>${lv === 'ok' ? '✓' : lv === 'warn' ? '!' : '✕'}</i><span><b>${b}</b>${s ? ' ' + s : ''}</span></li>`).join('')}</ul>
                ${f.shrink && f.file.size <= GD_LIM.videoMB * 1e6 ? `<label class="switch gd-keep"><span>Send the original instead <small class="muted">(bigger, uses more data for everyone)</small></span><input type="checkbox" id="gdf-keep"${f.keep ? ' checked' : ''}></label>` : ''}`;
            $b('#gdf-go').disabled = !f.ok;
            $b('[data-x=again]').onclick = () => { reset(); input.click(); };
            const k = $b('#gdf-keep'); if (k) k.onchange = () => { f.keep = k.checked; };
        };
        const prog = (step, p, sub = '') => { const box = $b('#gdf-prog'); if (!box) return; box.hidden = false; $b('#gdf-step').textContent = step; $b('#gdf-pct').textContent = p == null ? '' : Math.round(p * 100) + '%';
            box.querySelector('.bar i').style.width = p == null ? '100%' : Math.round(p * 100) + '%'; box.classList.toggle('busy', p == null); $b('#gdf-sub').textContent = sub; };
        $b('#gdf').onsubmit = async e => {
            e.preventDefault();
            const form = Object.fromEntries(new FormData(e.target)), title = String(form.title || '').trim();
            if (!f.ok) return toast('Choose a file first', true);
            if (title.length < 2) { body.querySelector('[name=title]').focus(); return toast('Please add a title', true); }
            const go = $b('#gdf-go'), stop = $b('#gdf-stop'); go.disabled = true; go.hidden = true;
            body.querySelectorAll('#gdf-top button, [data-x=again]').forEach(b => b.disabled = true);
            try {
                let out = f.out || f.file;
                if (f.kind === 'video' && f.shrink && !f.keep) {
                    stop.hidden = false; f.job = { stop: false }; stop.onclick = () => { f.job.stop = true; };
                    prog('Making it small', 0, 'Keep this screen open. It takes about as long as the video.');
                    out = await shrinkVideo(f.file, f.meta, p => prog('Making it small', p, 'Keep this screen open. It takes about as long as the video.'), f.job);
                    if (out.dims) Object.assign(f.meta, out.dims);
                    stop.hidden = true;
                    if (out.size > GD_LIM.videoMB * 1e6) throw new Error(`Even after shrinking it's ${mb(out.size)}. Please trim it shorter.`);
                }
                prog('Uploading', 0, `${mb(out.size)}${out.size > 5e6 ? ' · Wi-Fi is faster' : ''}`);
                const meta = { cat: f.cat, kind: f.kind, title, description: form.description || '', tags: form.tags || '', ...f.meta };
                await api.guideUpload(meta, out, f.thumb, p => p >= 1 ? prog('Publishing', null, 'Saving it to the RWB library…') : prog('Uploading', p, `${mb(out.size)}`));
                await loadGuides(true);
                closeSheet(); toast(`Added to ${GD_CATS[f.cat][0]} ✓`);
                Object.assign(gState, { cat: f.cat, type: 'all', q: '' });
                onDone?.();
            } catch (err) {
                $b('#gdf-prog') && ($b('#gdf-prog').hidden = true); stop.hidden = true; go.hidden = false; go.disabled = false;
                body.querySelectorAll('#gdf-top button, [data-x=again]').forEach(b => b.disabled = false);
                toast(err.message || 'Something went wrong', true);
            }
        };
    });
}
/* Reads the chosen file and lists what's fine (✓), worth fixing (!) and blocking (✕). */
async function gdCheck(f) {
    const file = f.file, c = f.checks = [];
    const ext = (file.name || '').toLowerCase().split('.').pop();
    if (f.kind === 'pdf') {
        if (!(file.type === 'application/pdf' || ext === 'pdf')) throw new Error('Please choose a PDF file.');
        const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        if (String.fromCharCode(...head) !== '%PDF-') throw new Error('This isn’t a real PDF (it may be renamed). Save it as PDF and try again.');
        if (file.size > GD_LIM.pdfMB * 1e6) c.push(['bad', `${mb(file.size)}: too big.`, `The limit is ${GD_LIM.pdfMB} MB. Compress it (search “compress PDF”) or split it.`]);
        else c.push(['ok', `${mb(file.size)}`, `under ${GD_LIM.pdfMB} MB`]);
        try { const txt = new TextDecoder('latin1').decode(await file.arrayBuffer()); const n = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length; if (n) { f.meta.pages = n; c.push(['ok', `${n} page${n === 1 ? '' : 's'}`, '']); }
            if (n && !/\/Font\b/.test(txt)) c.push(['warn', 'Looks like scanned pages.', 'Pookie can’t read photos of text; a typed PDF works better.']); } catch { /* fine */ }
        if (file.size > 3e6 && file.size <= GD_LIM.pdfMB * 1e6) c.push(['ok', 'Heavy PDF: no problem.', 'RWB makes it lighter for members automatically, within about an hour of adding it. It looks exactly the same.']);
        f.out = file; f.ok = !c.some(x => x[0] === 'bad');
        if (f.ok && typeof RWBPdf !== 'undefined') try { f.thumb = await RWBPdf.cover(file); } catch { /* no preview picture: the RWB robot adds one */ }
        return;
    }
    if (f.kind === 'image') {
        const okType = /^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.type) || /^(jpe?g|png|webp|heic|heif)$/.test(ext);
        if (!okType) throw new Error('Please choose a JPG, PNG, WebP or HEIC picture. GIF, SVG and other files aren’t allowed.');
        if (file.size > GD_LIM.imgInMB * 1e6) throw new Error(`That picture is ${mb(file.size)}. Please choose one under ${GD_LIM.imgInMB} MB, or take a screenshot of it.`);
        f.out = await compressImage(file, 1600, 320e3);
        f.thumb = await compressImage(file, 480, 45e3);
        const img = await loadImage(f.out); f.meta.width = img.naturalWidth; f.meta.height = img.naturalHeight; URL.revokeObjectURL(img.src);
        if (f.out.size > 1e6) throw new Error('That picture couldn’t be made small enough. Try a screenshot of it.');
        f.prevUrl = URL.createObjectURL(f.out);
        c.push(['ok', `${mb(file.size)} → ${mb(f.out.size)}`, 'shrunk to save space']);
        c.push(['ok', `${f.meta.width}×${f.meta.height}`, 'sharp on any phone']);
        f.ok = true; return;
    }
    /* video */
    const okType = /^video\/(mp4|quicktime|webm|x-m4v)$/i.test(file.type) || /^(mp4|mov|m4v|webm)$/.test(ext);
    if (!okType) throw new Error('Please choose an MP4, MOV or WebM video.');
    if (file.size > 400e6) throw new Error(`That video is ${mb(file.size)}. Please trim it to ${GD_LIM.sec} seconds first.`);
    const info = await probeVideo(file);
    Object.assign(f.meta, { duration_s: Math.round(info.duration * 10) / 10, width: info.width, height: info.height });
    f.prevUrl = URL.createObjectURL(file);
    try { f.thumb = await videoFrame(f.prevUrl, Math.min(1.2, info.duration / 3)); f.thumbUrl = URL.createObjectURL(f.thumb); } catch { /* no preview picture; fine */ }
    const long = Math.max(info.width, info.height), portrait = info.height >= info.width;
    if (info.duration > GD_LIM.sec + .5) c.push(['bad', `${mmss(info.duration)}: too long.`, `Trim it to ${GD_LIM.sec} seconds or less in your gallery’s editor, then choose it again.`]);
    else c.push(['ok', `${mmss(info.duration)} long`, `under ${GD_LIM.sec} s`]);
    c.push(portrait ? ['ok', 'Portrait', 'fills a phone screen'] : ['warn', 'Sideways (landscape).', 'It will work, but shows small on phones. Portrait is better next time.']);
    f.shrink = long > GD_LIM.side || file.size > GD_LIM.aimMB * 1e6;
    const canShrink = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
    if (f.shrink && !canShrink && file.size > GD_LIM.videoMB * 1e6) c.push(['bad', `${mb(file.size)}: too big,`, `and this phone can’t shrink videos. Export it at 720p in your gallery or video editor (under ${GD_LIM.videoMB} MB).`]);
    else if (f.shrink && !canShrink) { f.shrink = false; c.push(['warn', `${mb(file.size)}`, 'This phone can’t shrink it, so it goes as it is.']); }
    else if (f.shrink) c.push(['warn', `${info.width}×${info.height} · ${mb(file.size)}`, `We’ll make it 720p (about ${mb(Math.min(file.size, estSize(info.duration)))}) before sending.`]);
    else c.push(['ok', `${info.width}×${info.height} · ${mb(file.size)}`, 'already small, sent as it is']);
    f.ok = !c.some(x => x[0] === 'bad');
}
const estSize = sec => Math.round(sec * (videoBps(sec) + 96e3) / 8);
const videoBps = sec => Math.max(900e3, Math.min(2.2e6, GD_LIM.aimMB * 8e6 / Math.max(sec, 1) - 128e3));
function probeVideo(file) {
    return new Promise((res, rej) => {
        const v = document.createElement('video'), url = URL.createObjectURL(file); let done = false;
        const end = (err, val) => { if (done) return; done = true; clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); err ? rej(err) : res(val); };
        const t = setTimeout(() => end(new Error('This phone couldn’t open that video. Try MP4, or share it to yourself on WhatsApp and pick that copy.')), 20000);
        v.preload = 'metadata'; v.muted = true; v.playsInline = true;
        v.onloadedmetadata = () => {
            const finish = () => v.videoWidth ? end(null, { duration: v.duration, width: v.videoWidth, height: v.videoHeight }) : end(new Error('This phone can’t play that video (it may be HEVC/H.265). Record in “Most compatible” / H.264, or share it via WhatsApp first and pick that copy.'));
            if (isFinite(v.duration) && v.duration > 0) return finish();
            v.ondurationchange = () => { if (isFinite(v.duration) && v.duration > 0) { v.ondurationchange = null; v.currentTime = 0; finish(); } };   /* some WebM files only know their length at the end */
            v.currentTime = 1e7;
        };
        v.onerror = () => end(new Error('This phone couldn’t open that video. Try an MP4.'));
        v.src = url;
    });
}
function videoFrame(src, at) {
    return new Promise((res, rej) => {
        const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = src;
        const t = setTimeout(() => rej(new Error('no frame')), 12000);
        v.onloadeddata = () => { v.currentTime = at; };
        v.onseeked = () => {
            const w = 360, h = Math.round(w * v.videoHeight / v.videoWidth) || 640, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(v, 0, 0, w, h); clearTimeout(t);
            cv.toBlob(b => b ? res(new File([b], 'thumb.jpg', { type: 'image/jpeg' })) : rej(new Error('no frame')), 'image/jpeg', .78);
        };
        v.onerror = () => { clearTimeout(t); rej(new Error('no frame')); };
    });
}
/* Re-records the video at 720p on the phone itself (canvas + MediaRecorder), sound included. Free, no server:
   the phone plays it once, silently, so it takes about as long as the video. */
async function shrinkVideo(file, meta, onProgress, job) {
    const mime = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
    if (!mime) throw new Error('This phone can’t shrink videos. Export it at 720p in your gallery or video editor and choose it again.');
    const scale = Math.min(1, GD_LIM.side / Math.max(meta.width, meta.height)), even = n => Math.max(2, Math.round(n / 2) * 2);
    const W = even(meta.width * scale), H = even(meta.height * scale);
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    v.src = url; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('Couldn’t read the video to shrink it.')); });
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
    const stream = cv.captureStream(30);
    let ac = null;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); const src = ac.createMediaElementSource(v), dest = ac.createMediaStreamDestination(); src.connect(dest);   /* not to the speaker: silent while it works */
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t)); await ac.resume(); }
    catch { v.muted = true; ac = null; }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoBps(meta.duration_s), audioBitsPerSecond: 96e3 });
    const chunks = []; rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise(ok => { rec.onstop = ok; });
    const total = meta.duration_s || v.duration || 1;
    let alive = true;
    const draw = () => { if (!alive) return; cx.drawImage(v, 0, 0, W, H); onProgress?.(Math.min(.99, v.currentTime / total));
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw); };
    try {
        cx.drawImage(v, 0, 0, W, H);
        rec.start(1000);
        await v.play();
        draw();
        await new Promise((ok, no) => {
            v.onended = ok; v.onerror = () => no(new Error('The video stopped while shrinking. Try again.'));
            const watch = setInterval(() => { if (!alive) return clearInterval(watch); if (job?.stop) { clearInterval(watch); no(new Error('Stopped')); } else if (v.paused && !v.ended) v.play().catch(() => {}); }, 400);
        });
    } finally {
        alive = false; v.pause();
        if (rec.state !== 'inactive') rec.stop();
        await stopped; stream.getTracks().forEach(t => t.stop()); ac?.close().catch(() => {}); URL.revokeObjectURL(url);
    }
    onProgress?.(1);
    const type = mime.split(';')[0];
    const out = new File([new Blob(chunks, { type })], 'video.' + (type === 'video/mp4' ? 'mp4' : 'webm'), { type });
    out.dims = { width: W, height: H };
    return out;
}

/* ---------- Admin / Coordinator panel → Guides: everything sorted into its branch ---------- */
const gpState = { cat: null, type: 'all' };
async function adminGuides() {
    const body = $('#admin-body'); if (!body) return;
    const [g, st] = await Promise.all([loadGuides(true), api.guideStatus().catch(e => ({ ready: false, why: e.message }))]);
    if (!$('#admin-body')) return;
    const cats = g.cats || [];
    if (!g.setup) { body.innerHTML = '<div class="card empty"><b>Guides aren\'t set up yet</b>Run setup file 66 (guides.sql) in Supabase → SQL Editor, then deploy the guides-media function.</div>'; return; }
    if (!cats.length) { body.innerHTML = '<div class="card empty"><b>Nothing to manage</b>Only admins and coordinators add to Guides.</div>'; return; }
    if (!cats.includes(gpState.cat)) gpState.cat = cats.includes('maint') ? 'maint' : cats[0];
    const cat = gpState.cat, mine = gdSort(g.db.filter(it => it.cat === cat));
    const by = k => mine.filter(it => it.kind === k);
    const types = cat === 'app' ? ['video'] : ['all', 'video', 'pdf', 'image'];
    if (!types.includes(gpState.type)) gpState.type = types[0];
    const shown = gpState.type === 'all' ? mine : by(gpState.type);
    const used = st.bytes ?? g.db.reduce((s, it) => s + (it.bytes || 0), 0), budget = st.budget || 900e6, pct = Math.min(100, used / budget * 100);
    body.innerHTML = `
        <div class="card gd-store">
            <div class="row"><span class="gd-store-ico">${HELP_ICON}</span><div class="grow"><b>Guides library</b><p class="small muted">${cats.map(c => GD_CATS[c][0]).join(', ')}: you can add ${cats.length > 1 ? 'to these' : 'here'}.${isAdmin() ? '' : ' You can change or delete your own items.'}</p></div></div>
            <div class="gd-meter" aria-label="Storage used"><i style="width:${pct.toFixed(1)}%"></i></div>
            <p class="small muted">${mb(used)} of ${mb(budget)} used · ${g.db.length} item${g.db.length === 1 ? '' : 's'}</p>
            ${st.ready === false ? `<p class="small gd-warn">${state.me?.role === 'superadmin' && st.why ? esc(st.why) : 'Uploads are being set up. Please try again later.'}</p>` : ''}
        </div>
        <button class="btn block gd-up" data-act="gup">${GD_ICO.upload} Add to Guides</button>
        ${cats.length > 1 ? `<div class="seg section gd-pseg" role="tablist">${cats.map(c => `<button role="tab" aria-selected="${c === cat}" data-act="gpcat" data-c="${c}">${GD_CATS[c][0]} <span class="muted">${g.db.filter(i => i.cat === c).length}</span></button>`).join('')}</div>` : `<h3 class="gd-ptitle section">${GD_ICO[cat]} ${GD_CATS[cat][0]}</h3>`}
        ${types.length > 1 ? `<div class="gd-types">${types.map(k => `<button class="gd-type" aria-selected="${gpState.type === k}" data-act="gptype" data-t="${k}">${GD_ICO[k]}<span>${k === 'all' ? 'All' : GD_KIND[k]}</span><i>${k === 'all' ? mine.length : by(k).length}</i></button>`).join('')}</div>` : ''}
        ${shown.length ? `<div class="group gd-alist">${shown.map(it => `<div class="gd-arow">
            <button class="gd-ath ${it.kind}" data-act="gpopen" data-id="${it.id}" aria-label="Open ${esc(it.title)}">${it.thumb_url ? `<img src="${esc(it.thumb_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${GD_ICO[it.kind]}</button>
            <span class="grow"><b>${esc(it.title)}</b><span class="small muted">${esc([GD_ONE[it.kind], it.duration_s ? mmss(it.duration_s) : it.pages ? it.pages + ' pages' : '', it.bytes ? mb(it.bytes) : '', it.uploader, gdDay(it)].filter(Boolean).join(' · '))}</span></span>
            ${gdCanManage(it) ? `<button class="icon-btn" data-act="gpman" data-id="${it.id}" aria-label="Manage ${esc(it.title)}">${GD_ICO.more}</button>` : ''}</div>`).join('')}</div>`
            : `<div class="card empty"><b>No ${gpState.type === 'all' ? 'items' : GD_KIND[gpState.type].toLowerCase()} in ${GD_CATS[cat][0]} yet</b>Tap “Add to Guides” to post the first one.</div>`}
        <p class="small muted" style="text-align:center;margin:14px 8px 0">Members see these in Guides (the ? button at the top). ${cat === 'maint' ? 'The older Google Drive PDFs still show there too.' : ''}</p>`;
    Object.assign(actions, {
        gup: () => gdForm({ cat, kind: gpState.type === 'all' ? null : gpState.type }, () => { gpState.cat = gState.cat; adminGuides(); }),
        gpcat: el => { gpState.cat = el.dataset.c; gpState.type = 'all'; adminGuides(); },
        gptype: el => { gpState.type = el.dataset.t; adminGuides(); },
        gpopen: el => gdOpenFrom(shown, el.dataset.id),
        gpman: el => gdManage(g.db.find(it => String(it.id) === el.dataset.id))
    });
}
function gdOpenFrom(list, id) {
    const it = list.find(x => String(x.id) === String(id)); if (!it) return;
    const same = list.filter(x => x.kind === it.kind);
    if (it.kind === 'video') gdPlayer(same, same.indexOf(it)); else if (it.kind === 'image') gdViewer(same, same.indexOf(it)); else gdPdf(it);
}

/* MotoMart product pictures that weren't saved with a post: the store page's preview picture is looked up
   (free link-preview service, same as roninwb.in) and remembered on the phone for a week. */
const accJobs = new Map();
function accPreview(url) {
    const key = 'rwb-pv:' + url;
    try { const c = JSON.parse(localStorage.getItem(key)); if (c && Date.now() - c.t < (c.img ? 7 * 864e5 : 36e5)) return Promise.resolve(c.img); } catch { /* ignore */ }
    if (!accJobs.has(url)) accJobs.set(url, (async () => {
        let img = '';
        try { const j = await (await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))).json(); const u = j?.data?.image?.url || ''; if (/^https:\/\//i.test(u)) img = u; } catch { /* no preview */ }
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), img })); } catch { /* ignore */ }
        return img;
    })());
    return accJobs.get(url);
}
const accObs = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(async e => {
    if (!e.isIntersecting) return; accObs.unobserve(e.target);
    const box = e.target, src = await accPreview(box.dataset.link); if (!src) return;
    const im = new Image(); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.decoding = 'async';
    im.onload = () => { box.prepend(im); box.classList.add('has-img'); }; im.src = src;
}), { rootMargin: '200px' }) : { observe() {} };
/* =================== Me =================== */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
/* opened from "Download Now" on the website */
function installSheet() {
    if (isStandalone()) return;
    openSheet('Install RWB App', `<p style="margin-bottom:14px">Add RWB to your phone. It opens like a normal app, works offline and gets notifications. It uses almost no space.</p>
        ${installEvt ? '<button class="btn block" data-x="go">Install now</button>' : isIOS() ? '<ol style="padding-left:20px;display:grid;gap:6px"><li>Tap <b>Share</b> at the bottom of Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>'
            : '<ol style="padding-left:20px;display:grid;gap:6px"><li>Tap the <b>⋮</b> menu at the top right of Chrome</li><li>Choose <b>Install app</b> (or <b>Add to Home screen</b>)</li><li>Tap <b>Install</b></li></ol>'}
        <p class="small muted" style="margin-top:14px">Then open RWB from your home screen and sign in with Google.</p>`, body => {
        const go = body.querySelector('[data-x=go]');
        if (go) go.onclick = async () => { installEvt.prompt(); const r = await installEvt.userChoice; installEvt = null; closeSheet(); if (r.outcome === 'accepted') toast('Installing… find RWB on your home screen'); };
    });
}

/* Bikes: the main bike is on the member record (Edit details); bikes 2 and 3 can be added here */
const vBadge = ok => ok ? '<span class="badge ok">✓ Verified</span>' : '';
function bikeRows(m, extra, admin = false, waiting = []) {
    const main = `<div class="bike-row"><span class="g-ico">🏍️</span><span class="grow"><b>${esc(m.vrn || 'No VRN yet')}</b><span class="small muted">${esc(m.bike || 'Main bike')} · main bike</span></span>${vBadge(m.vrn_verified)}${admin ? `<button class="btn sm ghost" data-x="vv" data-slot="1">${m.vrn_verified ? 'Unverify' : 'Verify'}</button>` : `<button class="btn sm ghost" data-act="bike" data-slot="1">Edit</button>`}</div>`;
    if (extra === null) return main + '<p class="small muted" style="padding:10px 14px">Loading…</p>';
    const rows = extra.map(b => `<div class="bike-row"><span class="g-ico">🏍️</span><span class="grow"><b>${esc(b.vrn)}</b><span class="small muted">${esc(b.model || 'Model not set')}</span></span>${vBadge(b.verified)}${admin ? `<button class="btn sm ghost" data-x="vv" data-slot="${b.slot}">${b.verified ? 'Unverify' : 'Verify'}</button>` : `<button class="btn sm ghost" data-act="bike" data-slot="${b.slot}">Edit</button>`}</div>`).join('');
    const wait = waiting.map(c => `<div class="bike-row"><span class="g-ico">⏳</span><span class="grow"><b>${esc(c.new_value)}</b><span class="small muted">${esc(c.new_model || '')} · waiting for an admin</span></span></div>`).join('');
    const free = [2, 3].find(sl => !extra.some(b => b.slot === sl) && !waiting.some(c => c.slot === sl));
    return main + rows + wait + (!admin && free ? `<button class="bike-add" data-act="bike" data-slot="${free}">＋ Add a bike</button>` : '');
}
function changesBox(list) {
    const wait = list.filter(c => c.status === 'pending' && c.kind !== 'bike'), no = list.filter(c => c.status === 'rejected' && Date.now() - Date.parse(c.decided_at || c.created_at) < 14 * 864e5);
    if (!wait.length && !no.length) return '';
    return `<div class="card section chg-box">${wait.map(c => `<p>⏳ <b>${esc(CHANGE_TXT[c.kind])}</b> → ${esc(c.kind === 'tnc' ? 'no longer agree' : c.new_value + (c.new_model ? ' · ' + c.new_model : ''))} <span class="muted">· waiting for an admin</span></p>`).join('')}
        ${no.map(c => `<p>✕ <b>${esc(CHANGE_TXT[c.kind])}</b> change to ${esc(c.new_value)} wasn't approved${c.reject_reason ? `: ${esc(c.reject_reason)}` : ''}</p>`).join('')}</div>`;
}
/* Me → Edit (and the "complete your profile" screen): important details go to the admins, the rest saves now */
const PROFILE_FIELDS = ['full_name', 'nickname', 'dob', 'phone', 'alt_phone', 'bike', 'vrn', 'blood_group', 'locality', 'hideout', 'emergency_phone'];
function saveMyDetails(form, m, submitter, done) {
    const all = joinData(form), d = Object.fromEntries(Object.entries(all).filter(([k]) => PROFILE_FIELDS.includes(k)));   /* only real profile fields (not "More from RWB" answers) */
    const err = joinCheck(d, 'me', m.phone);
    if (err) return toast(err, true);
    Object.keys(d).forEach(k => d[k] = d[k] || null);
    const ask = [];
    if (d.full_name && d.full_name !== m.full_name) ask.push(['name', d.full_name]);
    if (d.phone && d.phone.replace(/\D/g, '').slice(-10) !== m.phone) ask.push(['phone', d.phone]);
    const em = String(all.email || '').trim().toLowerCase();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Please check the email', true);
    if (em && em !== String(m.email || '').toLowerCase()) ask.push(['email', em]);
    if ((d.vrn && vrnKey(d.vrn) !== vrnKey(m.vrn)) || (d.bike && d.bike !== m.bike)) ask.push(['vrn', d.vrn || m.vrn, d.bike || m.bike]);
    ['full_name', 'phone', 'vrn', 'bike'].forEach(k => delete d[k]);
    busy(submitter, async () => {
        state.me = await api.updateMe(d);
        for (const [kind, v, model] of ask) { await api.requestChange(kind, v, null, model); if (kind === 'vrn') state.vrnSent = true; }
        done();
        toast(ask.length ? `Saved. ${ask.map(a => CHANGE_TXT[a[0]]).join(', ')} sent to the admins for approval` : 'Details saved');
    });
}

/* =================== Blockers: T&C first, then a complete profile =================== */
async function gateFor(m) {
    if ('tnc_agreed' in m && !tncOk(m)) return 'tnc';
    let miss = missingOf(m).filter(x => x !== 'rules');
    if (miss.includes('VRN') && (state.vrnSent || (await api.myChanges().catch(() => [])).some(c => c.kind === 'vrn' && c.status === 'pending'))) { state.vrnSent = true; miss = miss.filter(x => x !== 'VRN'); }
    await loadJoinForm();
    return miss.length || moreMissing(m).length ? 'profile' : null;
}
const gateTop = title => `${demoBar()}<header class="top gate-top"><img class="logo" src="icons/logo-128.webp" alt="RWB" decoding="sync"><h1>${esc(title)}</h1></header>`;
function tncGate() {
    const m = state.me, withdrew = m.tnc_agreed === false, updated = m.tnc_agreed === true;
    app.innerHTML = gateTop('RWB') + `<section class="gate card">
        <p class="gate-kicker">${withdrew ? 'Your app access is paused' : updated ? 'We\'ve updated our Terms' : 'One step before you continue'}</p>
        <h2>RWB Terms &amp; Conditions</h2>
        <p class="small muted" style="margin-bottom:12px">${withdrew ? 'You said you no longer agree to the RWB Terms & Conditions. Agree again to keep using the RWB App, talk to an admin, or leave RWB.' : updated ? 'RWB has new, clearer Terms & Conditions, covering privacy, safety, MotoMart and more. Please read them and agree once to keep using the RWB App.' : 'Every RWB member agrees to these. Please read them and agree to keep using the RWB App.'}</p>
        <div class="gate-doc">${tncDoc()}</div>
        <p class="small muted" style="margin-top:8px">How we handle your data: <a href="../privacy.html" target="_blank" rel="noopener">RWB Privacy Policy ↗</a></p>
        <button class="btn block" data-act="g-agree" style="margin-top:14px">I agree to the RWB Terms &amp; Conditions</button>
        <button class="btn ghost block" data-act="g-msg" style="margin-top:8px">💬 Message an admin</button>
        <button class="btn danger block" data-act="g-leave" style="margin-top:8px">Disagree &amp; leave RWB</button></section>`;
    actions = {
        'g-agree': b => busy(b, async () => { await api.agreeTnc(); state.me = await api.me(); toast('Thank you! Welcome back.'); render(); }),
        'g-msg': () => adminsSheet(),
        'g-leave': b => { if (!confirmBox('Leave Ronin Warriors of Bengal? Your RWB membership ends and you\'ll be signed out of the app. An admin can add you back later if you change your mind.')) return;
            busy(b, async () => { await api.leaveRwb('Did not agree to the RWB Terms & Conditions'); toast('You have left RWB. Ride safe!'); setTimeout(() => api.signOut(), 1200); }); }
    };
}
async function adminsSheet() {
    const list = await api.rwbAdmins().catch(() => []);
    const me = firstName(state.me);
    openSheet('Message an admin', `<p class="small muted" style="margin-bottom:10px">Choose who to message on WhatsApp.</p>
        <div class="group">${list.length ? list.map(a => `<div class="bike-row"><span class="g-ico">🛡️</span><span class="grow"><b>${esc(a.full_name)}</b><span class="small muted">${a.role === 'superadmin' ? 'Super admin' : 'Admin'}</span></span>
            <a class="btn sm wa" target="_blank" rel="noopener" href="${waTo(a.phone, `Hi ${firstName(a)}, it's ${me} from RWB. I have a question about the RWB Terms & Conditions.`)}">WhatsApp</a></div>`).join('') : '<p class="small muted" style="padding:12px">Could not load the admins. Please try again.</p>'}</div>`);
}
function profileGate() {
    const m = state.me, miss = [...missingOf(m).filter(x => x !== 'rules' && !(x === 'VRN' && state.vrnSent)), ...(moreMissing(m).length ? ['More from RWB'] : [])];
    const qs = moreQs(m);
    app.innerHTML = gateTop('RWB') + `<section class="gate card">
        <p class="gate-kicker">Almost there, ${esc(firstName(m))}</p>
        <h2>Complete your profile</h2>
        <p class="small muted" style="margin-bottom:8px">Every RWB member keeps these details up to date, for rides, emergencies and the member list. Please fill in what's missing to continue.</p>
        <div class="fu-miss" style="margin-bottom:14px">${miss.map(x => `<span>${esc(x)}</span>`).join('')}</div>
        <form id="mf">${joinFields(m, 'me')}
            ${qs.length ? `<h3 class="gate-sub">More from RWB</h3>${moreFieldsHtml(m, qs, true)}` : ''}
            <button class="btn block">Save and continue</button></form></section>`;
    actions = {};
    $('#mf').onsubmit = e => { e.preventDefault(); const form = e.target, more = readMore(form, m, qs);
        saveMyDetails(form, m, e.submitter, async () => {
            if (Object.keys(more).length) { const saved = await api.updateMyAnswers(more).catch(err => { toast(err.message, true); return {}; }); state.me.form_answers = { ...(state.me.form_answers || {}), ...saved }; }
            render(); }); };
}

function rulesSheet(m, done) {
    openSheet('RWB Terms & Conditions', `${tncDoc()}
        ${!tncOk(m) ? '<button class="btn block" data-x="agree" style="margin-top:16px">I agree to the RWB Terms & Conditions</button>'
            : '<p class="small muted" style="margin-top:16px">You agreed to these Terms & Conditions as an RWB member.</p><button class="btn ghost block" data-x="disagree" style="margin-top:8px">I no longer agree</button>'}`, body => {
        const a = body.querySelector('[data-x=agree]'), d = body.querySelector('[data-x=disagree]');
        if (a) a.onclick = () => busy(a, async () => { await api.agreeTnc(); state.me = await api.me(); closeSheet(); toast('Thank you!'); render(); });
        if (d) d.onclick = () => { if (confirmBox('No longer agree to the RWB Terms & Conditions? Your access to the RWB App pauses until you agree again, and the admins are told.')) busy(d, async () => { await api.withdrawTnc(); state.me = await api.me(); closeSheet(); render(); }); };
    });
}
const BIKE_MODELS = ['TVS Ronin 225', 'TVS Apache RTR 160 4V', 'TVS Apache RTR 200 4V', 'TVS Apache RTR 310', 'Royal Enfield Hunter 350', 'Royal Enfield Classic 350', 'Honda CB350', 'Bajaj Pulsar', 'KTM Duke'];
function bikeSheet(slot, b, done) {
    const main = slot === 1;
    openSheet(main ? 'Edit main bike' : b ? 'Edit bike' : 'Add a bike', `<form id="bk">
        <label><span>VRN <span class="req">*</span></span><input name="vrn" required autocapitalize="characters" placeholder="WB 02 AB 1234" value="${esc(b?.vrn || '')}"></label>
        <label><span>Model</span><input name="model" list="bike-models" value="${esc(b?.model || 'TVS Ronin 225')}"><small class="hint">${main ? 'Changing only the model saves straight away. A new VRN is checked and approved by an admin.' : 'Change it if it\'s a different bike. An admin checks the VRN and approves it.'}</small></label>
        <datalist id="bike-models">${BIKE_MODELS.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        <button class="btn block">Save bike</button>${b && !main ? '<button type="button" class="btn danger block" data-x="del" style="margin-top:8px">Remove this bike</button>' : ''}</form>`, body => {
        body.querySelector('#bk').onsubmit = e => {
            e.preventDefault(); const v = e.target.vrn.value.replace(/\s+/g, ' ').trim().toUpperCase();
            if (v.replace(/[^A-Z0-9]/g, '').length < 6) return toast('Please check the VRN (for example WB 02 AB 1234)', true);
            busy(e.submitter, async () => { const r = main ? await api.requestChange('vrn', v, null, e.target.model.value.trim()) : await api.saveBike(slot, v, e.target.model.value.trim()); if (main) state.me = await api.me(); closeSheet(); state.dir = null; toast(r === 'pending' ? 'Sent to the admins for approval' : r === 'unchanged' ? 'Nothing changed' : 'Bike saved'); main ? render() : done(); });
        };
        const del = body.querySelector('[data-x=del]');
        if (del) del.onclick = () => { if (confirmBox('Remove this bike from your profile?')) busy(del, async () => { await api.saveBike(slot, ''); closeSheet(); state.dir = null; toast('Bike removed'); done(); }); };
    });
}

function viewMe() {
    const m = state.me, role = (ROLE[m.role] || 'Member') + (m.role === 'coordinator' ? ' (MotoMart)' : '');
    const ST = { mail: 'M3 6h18v12H3zM3 7l9 6 9-6', phone: 'M7 3h10v18H7zM11 18h2', bike: 'M5 17a3 3 0 1 0 0-.01M19 17a3 3 0 1 0 0-.01M5 17l4-7h5l3 7M9 10l-1-3H6m8 3 2-3h2', plate: 'M3 7h18v10H3zM7 12h.01M10 12h7', cake: 'M5 11h14v9H5zM12 11V8m0-3v.01M5 15c2 1.5 4.5 1.5 7 0s5-1.5 7 0', drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z', pin: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 10h.01', sos: 'M12 3l9 16H3zM12 10v4M12 17h.01' };
    const stI = (k, c) => `<span class="st-ico ${c}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ST[k]}"/></svg></span>`;
    const row = (k, v, ic, c) => `<div>${stI(ic, c)}<span class="grow">${k}</span><span class="rt">${esc(v || '–')}</span></div>`;
    const theme = getTheme();
    app.innerHTML = top('Me') + `
        <section class="profile me-hero">
            <label class="photo-pick" aria-label="Change profile photo">${face(m, 'avatar xl')}<span class="cam">📷</span><input type="file" accept="image/*,.heic,.heif" id="pic" hidden></label>
            <div class="grow"><h2>${esc(m.full_name)}</h2><p class="muted">${m.nickname ? `“${esc(m.nickname)}” · ` : ''}${esc(role)}</p></div>
            <button class="btn sm" data-act="edit">Edit profile</button>
        </section>
        <div id="my-changes"></div>
        <h2 class="st-title">Personal details</h2>
        <div class="group kv st-group">
            ${row('WhatsApp', m.phone, 'phone', 'c-green')}${row('Email', m.email, 'mail', 'c-blue')}${row('Bike', m.bike, 'bike', 'c-orange')}${row('Registration', m.vrn, 'plate', 'c-blue')}${row('Birthday', m.dob ? fmtDayMonth(m.dob) : '', 'cake', 'c-pink')}${row('Blood group', m.blood_group, 'drop', 'c-red')}${row('Locality', m.locality, 'pin', 'c-teal')}${row('Emergency contact', m.emergency_phone, 'sos', 'c-red')}
        </div>
        <h2 class="st-title">My bikes <span>up to 3</span></h2>
        <div class="group bikes st-group" id="my-bikes">${bikeRows(m, null)}</div>

        <h2 class="st-title">Notifications</h2>
        <div class="card st-card" id="notif-card"><p id="push-state">Checking…</p><div id="push-btn" style="margin-top:10px"></div></div>
        <div class="group st-group">
            ${[...(isMod() ? [['birthday', 'Birthdays']] : []), ['reminder', 'Renewal, service and my reminders'], ['track', 'Riders who start sharing on Track'], ['rsvp', 'Riders joining events'], ['motomart', 'New MotoMart posts'], ['member', 'New members on the app']].map(([k, l]) => `<label class="toggle-row"><span class="grow">${l}</span><span class="switch-only"><input type="checkbox" data-pref="${k}"${(m.notify || {})[k] !== false ? ' checked' : ''}></span></label>`).join('')}
        </div>
        <p class="st-foot">RWB announcements always come through.</p>

        <h2 class="st-title">Privacy</h2>
        <div class="group st-group"><label class="toggle-row"><span class="grow">Show me on the Warriorboards<span class="small muted">Other members see your name, photo, km, average mileage and how many services you've logged</span></span><span class="switch-only"><input type="checkbox" id="lb"${m.show_on_leaderboard !== false ? ' checked' : ''}></span></label></div>
        <p class="st-foot">Other members always see your name, nickname and photo. Choose what else they see below. RWB admins and coordinators can always see your details.</p>
        <div class="group st-group" id="share-box">${SHARE_OPTS.map(([k, t, d]) => `<label class="toggle-row"><span class="grow">${t}<span class="small muted">${d}</span></span><span class="switch-only"><input type="checkbox" data-share="${k}"${m.share?.[k] ? ' checked' : ''}></span></label>`).join('')}
            <button class="bike-add" data-act="share-all">${SHARE_OPTS.every(([k]) => m.share?.[k]) ? '🔒 Hide all from members' : '👁 Share all with members'}</button></div>

        <h2 class="st-title">Appearance</h2>
        <div class="seg st-seg" role="radiogroup" aria-label="Theme">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([k, l]) => `<button role="radio" aria-selected="${theme === k}" aria-checked="${theme === k}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div>
        ${isAndroid ? `<h2 class="st-title">WhatsApp</h2>
        <div class="group"><label class="toggle-row"><span class="grow">Open WhatsApp links in<span class="small muted">For phones with both WhatsApp and WhatsApp Business</span></span>
            <select id="wa-app" style="width:auto;min-height:38px">${Object.entries(WA_APPS).map(([k, [l]]) => `<option value="${k}"${waPref() === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>` : ''}

        <div id="more-rwb"></div>
        <h2 class="st-title">Follow RWB</h2>${followRwb()}
        ${'tnc_agreed' in m ? `<h2 class="st-title">Terms & Conditions</h2>
        <div class="group"><div class="bike-row"><span class="g-ico">📜</span><span class="grow"><b>${tncOk(m) ? 'You agree to the RWB T&C' : m.tnc_agreed === false ? 'You don\'t agree to the RWB T&C' : 'Please read and agree'}</b><span class="small muted">${tncOk(m) ? (m.tnc_version ? 'Version ' + esc(m.tnc_version) + (m.tnc_agreed_at ? ', agreed ' + fmtDate(String(m.tnc_agreed_at).slice(0, 10)) : '') : 'From the RWB join form') : 'Needed for every RWB member'}</span></span>
            <button class="btn sm ${tncOk(m) ? 'ghost' : ''}" data-act="rules">${tncOk(m) ? 'Read' : 'Read & agree'}</button></div></div>` : ''}

        <h2 class="st-title">App</h2>
        <div class="group st-group">
            <a href="../privacy.html" target="_blank" rel="noopener"><span class="g-ico">${ICON.shield}</span><span class="grow"><b>Privacy</b></span>${ICON.out}</a>
            <button data-report="other"><span class="g-ico">🚩</span><span class="grow"><b>Report a problem</b><span class="small muted">Something wrong, unsafe or abusive in the app? Tell the RWB team</span></span></button>
</div>
        <div class="group st-group">
            <button data-act="out" class="danger-row"><span class="grow"><b>Sign out</b></span></button>
            <button data-del-acct class="danger-row"><span class="grow"><b>Delete my account</b><span class="small muted">Deletes your RWB App account and what you added in the app</span></span></button>
        </div>
        <div class="me-foot"><img src="icons/app-icon-256.webp" alt=""><p><b>RWB App</b><br>Free for every warrior · Explore. Evolve. Inspire.</p></div>`;
    let myBikes = [], myChanges = [];
    const drawBikes = async () => {
        [myBikes, myChanges] = await Promise.all([api.myBikes().catch(() => []), api.myChanges().catch(() => [])]);
        const g = $('#my-bikes'); if (g) g.innerHTML = bikeRows(state.me, myBikes, false, myChanges.filter(c => c.kind === 'bike' && c.status === 'pending'));
        const ch = $('#my-changes'); if (ch) ch.innerHTML = changesBox(myChanges);
    };
    const drawMore = () => { const el = $('#more-rwb'); if (el) el.innerHTML = moreQs(m).length ? `<h2 class="st-title">More from RWB</h2><div class="group st-group">${answerRows(m, true)}<button class="bike-add" data-act="more-edit">✎ Edit my answers</button></div>` : ''; };
    drawBikes(); drawMore(); loadJoinForm().then(drawMore);
    actions = {
        'more-edit': () => moreSheet(m, drawMore),
        bike: el => { const sl = Number(el.dataset.slot); bikeSheet(sl, sl === 1 ? { vrn: state.me.vrn || '', model: state.me.bike || 'TVS Ronin 225' } : myBikes.find(b => b.slot === sl), drawBikes); },
        rules: () => rulesSheet(m, drawBikes),
        out: async () => { await disablePush(true).catch(() => {}); api.signOut(); },
        theme: el => { setTheme(el.dataset.t); app.querySelectorAll('[data-act=theme]').forEach(b => { const on = b === el; b.setAttribute('aria-selected', on); b.setAttribute('aria-checked', on); }); },
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); drawPushState(); }),
        'push-off': b => busy(b, async () => { await disablePush(); toast('Notifications are off on this phone'); drawPushState(); }),
        'push-test': b => busy(b, async () => { await api.testPush(); toast('Test sent. It should arrive in a few seconds.'); }),
        edit: () => openSheet('My details', `<form id="mf">
            <p class="small muted" style="margin-bottom:10px">Changes to your Full Name, WhatsApp No., Email and main bike (VRN) are checked by an admin first. Everything else saves straight away. <span class="req">*</span> marks answers every member needs.</p>
            ${joinFields(m, 'me')}
            <button class="btn block">Save details</button></form>`, body => {
            body.querySelector('#mf').onsubmit = e => { e.preventDefault(); saveMyDetails(e.target, m, e.submitter, () => { closeSheet(); render(); }); };
        })
    };
    app.querySelectorAll('[data-pref]').forEach(cb => cb.onchange = async () => {
        const notify = { birthday: true, reminder: true, track: true, rsvp: true, motomart: true, member: true, ...(state.me.notify || {}), [cb.dataset.pref]: cb.checked };
        try { state.me = await api.updateMe({ notify }); toast('Saved'); } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
    });
    const wa = $('#wa-app'); if (wa) wa.onchange = () => { try { localStorage.setItem('rwb-wa-app', wa.value); } catch { /* ignore */ } toast(`WhatsApp links open in ${WA_APPS[wa.value][0] === 'Let my phone decide' ? 'whichever app your phone picks' : WA_APPS[wa.value][0]}`); };
    const saveShare = async next => { try { const out = await api.setSharing(next); state.me = { ...state.me, share: out }; m.share = out; state.dir = null; state.board = null;
            $('#share-box').querySelectorAll('[data-share]').forEach(x => x.checked = !!out[x.dataset.share]);
            $('#share-box [data-act=share-all]').textContent = SHARE_OPTS.every(([k]) => out[k]) ? '🔒 Hide all from members' : '👁 Share all with members'; return out; }
        catch (err) { toast(err.message, true); $('#share-box').querySelectorAll('[data-share]').forEach(x => x.checked = !!m.share?.[x.dataset.share]); } };
    $('#share-box').querySelectorAll('[data-share]').forEach(x => x.onchange = async () => { const next = Object.fromEntries(SHARE_OPTS.map(([k]) => [k, !!m.share?.[k]])); next[x.dataset.share] = x.checked; if (await saveShare(next)) toast(x.checked ? 'Shared with members' : 'Hidden from members'); });
    actions['share-all'] = async () => { const all = !SHARE_OPTS.every(([k]) => m.share?.[k]); if (await saveShare(Object.fromEntries(SHARE_OPTS.map(([k]) => [k, all])))) toast(all ? 'Your details are shared with members' : 'Your details are hidden from members'); };
    $('#lb').onchange = async e => {
        try { state.me = await api.updateMe({ show_on_leaderboard: e.target.checked }); state.board = null; state.dir = null; state.gps = null; state.gpsAt = 0; state.pookieBoard = null; toast(e.target.checked ? 'You\'re on the Warriorboards' : 'Hidden from the Warriorboards'); }
        catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
    };
    $('#pic').onchange = async e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try { toast('Uploading photo…'); state.me = await api.setAvatar(await squarePhoto(f)); render(); toast('Profile photo updated'); }
        catch (err) { toast(err.message, true); }
    };
    if (m.avatar_url) app.querySelector('.profile .grow').insertAdjacentHTML('beforeend', '<button class="link-btn small" data-act="rm-pic">Remove photo</button>');
    actions['rm-pic'] = b => { if (confirmBox('Remove your profile photo?')) busy(b, async () => { state.me = await api.setAvatar(null); render(); toast('Photo removed'); }); };
    drawPushState();
}

/* centre-cropped square, 320 px, about 20–40 KB: thousands of members fit in the free storage */
async function squarePhoto(file) {
    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'); cv.width = cv.height = 320;
    cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
    URL.revokeObjectURL(img.src);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

/* =================== Admin =================== */
async function viewAdmin() {
    if (!isAdmin()) return viewCoord();
    const s = await api.admin.stats();
    const tab = state.adminTab;
    app.innerHTML = top('Admin', '<a class="btn sm ghost" href="#home">Done</a>') + `
        <div class="stats">
            <button class="stat tap" data-act="mfilter" data-f="all"><b>${s.members}</b><span>Members ›</span></button>
            <button class="stat tap" data-act="mfilter" data-f="app"><b>${s.on_app}</b><span>On the app ›</span></button>
            <button class="stat tap ${s.pending ? 'accent' : ''}" data-act="tab" data-tab="requests"><b>${s.pending}</b><span>Waiting ›</span></button></div>
        <div class="copies" id="copies" hidden></div>
        <div class="sync-row" id="sync-row" hidden><span class="grow small" id="sync-txt"></span><button class="btn sm ghost" data-act="sheet-sync">Sync sheet now</button></div>
        <div class="seg section scroll" role="tablist">
            <button role="tab" aria-selected="${tab === 'requests'}" data-act="tab" data-tab="requests">Approvals${s.pending ? ` (${s.pending})` : ''}</button>
            <button role="tab" aria-selected="${tab === 'motomart'}" data-act="tab" data-tab="motomart">MotoMart<span id="mm-count"></span></button>
            <button role="tab" aria-selected="${tab === 'dupes'}" data-act="tab" data-tab="dupes">Duplicates<span id="dupe-count"></span></button>
            <button role="tab" aria-selected="${tab === 'members'}" data-act="tab" data-tab="members">Members</button>
            <button role="tab" aria-selected="${tab === 'bdays'}" data-act="tab" data-tab="bdays">Birthdays</button>
            <button role="tab" aria-selected="${tab === 'reports'}" data-act="tab" data-tab="reports">Reports<span id="rep-count"></span></button>
            <button role="tab" aria-selected="${tab === 'ai'}" data-act="tab" data-tab="ai">Pookie<span id="ai-count"></span></button>
            <button role="tab" aria-selected="${tab === 'guides'}" data-act="tab" data-tab="guides">Guides</button></div>
        <div id="admin-body">${SKEL(4)}</div>`;
    actions = { tab: el => { state.adminTab = el.dataset.tab; viewAdmin(); }, mfilter: el => { state.adminTab = 'members'; state.memberFilter = el.dataset.f; state.adminSearch = ''; viewAdmin(); } };
    load.listings(true).then(ls => { const n = ls.filter(l => l.status === 'pending').length; const c = $('#mm-count'); if (c && n) c.textContent = ` (${n})`; }).catch(() => {});
    api.admin.dupes().then(g => { state.dupes = g; const c = $('#dupe-count'); if (c && g.length) c.textContent = ` (${g.length})`; }).catch(() => {});
    syncStatus(); appCopies();
    actions['sheet-sync'] = el => busy(el, async () => {
        await api.admin.sheetSync(); const t0 = Date.now(); const txt = $('#sync-txt'); if (txt) txt.textContent = 'Syncing with the member sheet… (about a minute)';
        for (let i = 0; i < 36; i++) {   /* up to 3 minutes */
            await new Promise(r => setTimeout(r, 5000)); const st = await api.admin.sheetSyncStatus().catch(() => null);
            if (st?.last?.at && Date.parse(st.last.at) >= t0 - 5000) { syncStatus(st); openSheet('Sheet synced', `<p class="small" style="white-space:pre-wrap">${esc(st.last.summary || 'Done')}</p>`); return; }
            if (!$('#sync-txt')) return;   /* left the Admin screen */
        }
        if ($('#sync-txt')) $('#sync-txt').textContent = 'The sheet hasn\'t answered yet. It may still be working; check again in a few minutes.';
    });
    api.admin.pookiePending?.().then(n => { pookieBadge(n); const c = $('#ai-count'); if (c && n) c.textContent = ` (${n})`; }).catch(() => {});
    api.admin.reports?.().then(rs => { const n = (rs || []).filter(r => r.status === 'open').length; const c = $('#rep-count'); if (c && n) c.textContent = ` (${n})`; }).catch(() => {});
    try { await (({ requests: adminRequests, motomart: adminMotoMart, dupes: adminDupes, members: adminMembers, bdays: adminBdays, reports: adminReports, ai: adminAI, guides: adminGuides })[tab] || adminRequests)(); }
    catch (e) { $('#admin-body').innerHTML = `<div class="card empty"><b>Could not load</b>${esc(e.message)}</div>`; }
}
/* Coordinators' panel (setup file 65): MotoMart posts, Teach Pookie answers and reports. They check other people's
   posts and answers; their own are checked by an admin or another coordinator. */
const COORD_TABS = { motomart: ['MotoMart', () => adminMotoMart()], ai: ['Pookie', () => adminAI()], reports: ['Reports', () => adminReports()], guides: ['Guides', () => adminGuides()] };
async function coordCounts() {
    state.myId ??= await api.myId();
    const [ls, ai, rs] = await Promise.all([load.listings(true).catch(() => []), api.admin.pookiePending?.().catch(() => 0), api.admin.reports?.().catch(() => [])]);
    return { motomart: ls.filter(l => l.status === 'pending' && !mine(l)).length, ai: ai || 0, reports: (rs || []).filter(r => r.status === 'open').length };
}
function coordDock() {
    app.querySelectorAll('[data-adtab]').forEach(a => a.addEventListener('click', () => { state.adminTab = a.dataset.adtab; }));
    coordCounts().then(n => {
        const set = (id, v) => { const el = $('#' + id); if (el) { el.textContent = v; el.hidden = !v; } };
        set('ad-mm', n.motomart); set('ad-ai', n.ai); set('ad-rep', n.reports);
        const all = n.motomart + n.ai + n.reports, sum = $('#ad-sum'); if (sum) sum.textContent = all ? `${all} waiting for you` : 'all clear 👍';
        app.querySelector('.coord-dock')?.classList.toggle('busy', !!all);
    }).catch(() => {});
}
async function viewCoord() {
    if (!COORD_TABS[state.adminTab]) state.adminTab = 'motomart';
    const tab = state.adminTab;
    app.innerHTML = top('Panel') + `
        <div class="coord-hero"><span class="ad-ico">${ICON.shield}</span><div><b>Your coordinator panel</b><p class="small muted">Approve MotoMart posts and Pookie answers, handle members' reports and add Ride guides. Your own posts and answers go to an admin or another coordinator.</p></div></div>
        <div class="seg section scroll" role="tablist">${Object.entries(COORD_TABS).map(([k, [label]]) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-tab="${k}">${label}<span id="c-${k}"></span></button>`).join('')}</div>
        <div id="admin-body">${SKEL(4)}</div>`;
    actions = { tab: el => { state.adminTab = el.dataset.tab; viewAdmin(); } };
    coordCounts().then(n => Object.entries(n).forEach(([k, v]) => { const c = $('#c-' + k); if (c) c.textContent = v ? ` (${v})` : ''; if (k === 'ai') pookieBadge(v); })).catch(() => {});
    try { await COORD_TABS[tab][1](); }
    catch (e) { $('#admin-body').innerHTML = `<div class="card empty"><b>Could not load</b>${esc(e.message)}</div>`; }
}
/* which copy of the app this is, noted once a day so admins can see who is on the Play test */
const PLAY_TEST_URL = 'https://play.google.com/apps/testing/in.roninwb.twa';
async function pingCopy() {
    if (!state.me || isFam() || api.demo) return;
    const copy = !NATIVE ? 'browser' : (await nativeInfo()).channel === 'play' ? 'play' : 'apk';
    const key = new Date().toISOString().slice(0, 10) + copy;
    try { if (localStorage.getItem('rwb-seen-2') === key) return; } catch { /* ignore */ }
    let build = null; if (NATIVE) try { build = Number((await Native('App').getInfo()).build) || null; } catch { /* ignore */ }
    try { await api.appSeen(copy, build); localStorage.setItem('rwb-seen-2', key); } catch { /* try again next time */ }
}
const COPY_NAME = { play: 'Play Store', apk: 'Old APK', browser: 'Browser only', none: 'Not seen lately' };
const nudgeText = m => `Hi ${(m.nickname || m.full_name || '').split(' ')[0] || 'Warrior'}! 👋\n\nThe RWB App is now on the Google Play Store! 🎉 The app you have now won't get updates any more, so please move to the Play Store version (2 minutes):\n\n1️⃣ Uninstall the RWB app you have now (press and hold its icon → Uninstall).\n2️⃣ Install RWB from Google Play: ${PLAY_URL}\n3️⃣ Open RWB and sign in with Google as before. All your data is still there.\n\nRide safe! 🏍️`;
/* Admin: how many members use each copy, and who to nudge to the Play test */
async function appCopies() {
    const box = $('#copies'); if (!box) return;
    const rows = await api.admin.appCopies?.().catch(e => ({ err: e.message || String(e) }));
    if (!$('#copies')) return;
    if (rows?.err) { box.hidden = false; box.innerHTML = `<p class="small muted">App copies couldn't load: ${esc(rows.err)} <button class="btn sm ghost" data-act="copies-retry">Try again</button></p>`; actions['copies-retry'] = () => appCopies(); return; }
    if (rows === null || rows === undefined) { box.hidden = false; box.innerHTML = `<p class="small muted">App copies: run setup file 60 (app-copies.sql) in Supabase to see who uses the Play Store test.${window.rwbCopiesWhy ? `<br><span style="opacity:.7">Supabase says: ${esc(window.rwbCopiesWhy)}</span>` : ''} <button class="btn sm ghost" data-act="copies-retry">Check again</button></p>`; actions['copies-retry'] = () => appCopies(); return; }
    const n = k => rows.filter(r => r.copy === k).length;
    box.hidden = false;
    box.innerHTML = `<div class="cp-head"><b>App copies</b><span class="small muted">last 30 days</span></div>
        <div class="cp-grid">${['play', 'apk', 'browser', 'none'].map(k => `<button class="cp ${k}" data-act="copies" data-k="${k}"><b>${n(k)}</b><span>${COPY_NAME[k]}</span></button>`).join('')}</div>
        ${n('apk') ? `<button class="btn sm block" data-act="copies" data-k="apk" style="margin-top:8px">Move ${n('apk')} old-APK rider${n('apk') === 1 ? '' : 's'} to Google Play</button>` : ''}`;
    actions.copies = el => copiesSheet(rows, el.dataset.k);
}
function copiesSheet(rows, k) {
    const list = rows.filter(r => r.copy === k);
    openSheet(COPY_NAME[k] + ` (${list.length})`, `<p class="small muted" style="margin-bottom:10px">${k === 'play' ? 'These riders opened the Play Store copy. They count towards Google\'s 12 testers.' : k === 'apk' ? 'These riders use the APK from roninwb.in. Tap WhatsApp to send a ready message asking them to join the Play test. Add their Gmail to the tester list in Play Console when they reply.' : k === 'browser' ? 'These riders only used the app in a browser lately.' : 'App accounts that haven\'t opened the app in 30 days (or since this count started).'}</p>
        <div class="cp-list">${list.map(r => `<div class="row cp-row">${face(r, 'avatar sm')}<span class="grow"><b>${esc(r.full_name)}</b><span class="small muted">${r.seen_at ? 'seen ' + timeAgo(r.seen_at) : 'not seen yet'}${r.build ? ' · build ' + (r.build - 100) : ''}${r.copy === 'play' && r.apk_too ? ' · also has the APK' : ''}</span></span>
            ${r.phone && k !== 'play' ? `<a class="btn sm ghost" href="${waTo(r.phone, nudgeText(r))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`).join('') || '<p class="muted">No one here.</p>'}</div>`);
}
/* Admin: when the member sheet last checked itself against the app (every 12 hours, or "Sync sheet now") */
async function syncStatus(st) {
    const row = $('#sync-row'); if (!row) return; row.hidden = false;
    st ??= await api.admin.sheetSyncStatus?.().catch(() => null); const t = $('#sync-txt'); if (!t) return;
    t.textContent = st?.last?.at ? `Member sheet synced ${timeAgo(st.last.at)}` : 'Member sheet';
}
/* Reports from members (Grievance Officer's queue): acknowledge within 24 h, resolve within 7 days, 2 h for nudity,
   sexual content, impersonation or morphed photos */
async function adminReports() {
    const rs = await api.admin.reports();
    const body = $('#admin-body'); if (!body) return;
    if (rs === null) { body.innerHTML = '<div class="card empty"><b>Reports aren\'t set up yet</b>Run setup file 55 (reports.sql) in Supabase → SQL Editor.</div>'; return; }
    const urgent = r => /nud|sexual|impersonat|fake profile|morphed/i.test(r.reason);
    const due = r => { const h = urgent(r) ? 2 : 7 * 24, left = Date.parse(r.created_at) + h * 36e5 - Date.now();
        return left <= 0 ? '<b class="warn">Overdue</b>' : left < 36e5 * 3 ? `<b class="warn">${Math.max(1, Math.round(left / 6e4))} min left</b>` : `${Math.round(left / 36e5 / (left > 48 * 36e5 ? 24 : 1))} ${left > 48 * 36e5 ? 'days' : 'h'} left`; };
    const open = rs.filter(r => r.status === 'open').sort((a, b) => urgent(b) - urgent(a)), done = rs.filter(r => r.status !== 'open');
    const card = r => `<div class="card" style="margin-bottom:10px${r.status === 'open' && urgent(r) ? ';border:2px solid var(--danger,#c0392b)' : ''}">
        <div class="row" style="justify-content:space-between;gap:8px"><b>${urgent(r) ? '🚨 ' : '🚩 '}${esc(r.reason)}</b><span class="small muted">${timeAgo(r.created_at)}</span></div>
        <p class="small" style="margin:4px 0">${r.kind === 'listing' ? 'MotoMart post' : 'Report'}${r.label ? ': <b>' + esc(r.label) + '</b>' : ''}</p>
        ${r.details ? `<p class="small" style="margin:4px 0;white-space:pre-wrap">${esc(r.details)}</p>` : ''}
        <p class="small muted">From ${esc(r.reporter_name || 'a member')}${r.status === 'open' ? ' · ' + due(r) : ` · ✅ ${esc(r.outcome || 'Handled')} (${esc(r.handled_by || '')}, ${timeAgo(r.handled_at)})`}</p>
        ${r.status === 'open' ? `<div class="btns" style="margin-top:8px">${r.kind === 'listing' && r.ref ? `<button class="btn ghost sm" data-act="rep-open" data-ref="${esc(r.ref)}">Open post</button>` : ''}<button class="btn sm" data-act="rep-done" data-id="${r.id}">Mark resolved</button></div>` : ''}</div>`;
    body.innerHTML = `<p class="small muted" style="margin-bottom:12px">Members' reports. Reply to the person within 24 hours and resolve within 7 days. 🚨 Nudity, sexual content, impersonation or morphed photos: remove within 2 hours. </p>
        <details class="card" style="margin-bottom:12px"><summary><b>📋 How to handle complaints and data breaches</b></summary><div class="small" style="margin-top:8px">
            <p><b>A report or complaint</b> (in the app, by email to ronin.warriors.bengal@gmail.com, or on WhatsApp)</p>
            <ol><li>Within <b>24 hours</b>: reply to the person ("We got your complaint and are looking into it").</li>
            <li>🚨 Nudity, sexual content, impersonation or a morphed photo of a person: remove it (delete the post, or remove the photo/nickname) within <b>2 hours</b>, then check the details.</li>
            <li>Otherwise check it against the RWB Terms. Remove the content, warn or suspend the member if needed.</li>
            <li>Within <b>7 days</b>: tell the person what you did, then tap <b>Mark resolved</b> here with a short note. Tell Sayantan (Grievance Officer) about anything serious.</li>
            <li>Police, court or government order to remove something: remove it within <b>3 hours</b> and tell the super admin. Keep the order.</li></ol>
            <p style="margin-top:8px"><b>A data breach</b> (member data leaked, an admin's phone or Google account lost or hacked, the member sheet shared by mistake, strange admin activity)</p>
            <ol><li>Stop it now: change the Google password, sign out other devices, remove the person's admin role in the app, and turn off sharing on the member sheet.</li>
            <li>Tell the super admin and Sayantan straight away. Write down what happened, when, which data and how many members.</li>
            <li>Serious cyber incidents: report to <b>CERT-In within 6 hours</b> (incident@cert-in.org.in).</li>
            <li>Tell the members affected without delay: what happened, what it means for them, and what they should do (for example, watch for scam calls).</li>
            <li>Report to the <b>Data Protection Board of India</b> as the DPDP rules require (an initial report straight away and a full report within 72 hours).</li></ol>
        </div></details>
        ${open.length ? open.map(card).join('') : '<div class="card empty"><b>No open reports</b>All clear 👍</div>'}
        ${done.length ? `<details style="margin-top:14px"><summary class="small muted">Resolved (last 60 days): ${done.length}</summary>${done.map(card).join('')}</details>` : ''}`;
    actions['rep-done'] = el => { const out = prompt('What did you do? (e.g. "Post removed", "Warned the member", "No action: not against the Terms")'); if (out === null) return;
        busy(el, async () => { await api.admin.reportDone(Number(el.dataset.id), out); toast('Resolved'); adminReports(); }); };
    actions['rep-open'] = async el => { const ls = await load.listings(true).catch(() => []); const l = ls.find(x => String(x.id) === el.dataset.ref); if (l) listingDetail(l); else toast('That post is no longer there (deleted)'); };
}
/* Every new entry (join form or app) waits here. Admins see 4 checks before approving. */
/* free sites to look up a VRN; the admin picks any one (or all three) */
const VRN_SITES = [
    ['CarInfo', 'https://www.carinfo.app/rto-vehicle-registration-detail', 'Quick lookup, no sign-in'],
    ['Motorpedia', 'https://themotorpedia.com/vahan-check', 'Vahan check: owner and RC details'],
    ['VAHAN (official, Govt. of India)', 'https://vahan.parivahan.gov.in/nrservices/', 'Know Your Vehicle Details · free, mobile OTP sign-in']];
const vrnSites = (vrn, hint = 'Mark it verified only if the owner name matches.') => `<p class="small muted" style="margin:12px 0 8px">Tap a site. <b class="vrn">${esc(vrn)}</b> is copied, so just paste it there. ${hint}</p>
    <div class="vrn-sites">${VRN_SITES.map(([n, u, d], i) => `<a class="vrn-site" href="${u}" target="_blank" rel="noopener" data-vrn="${esc(vrn)}"><span class="n">${i + 1}</span><span class="grow"><b>${esc(n)}</b><small>${esc(d)}</small></span>${ICON.out}</a>`).join('')}</div>`;
document.addEventListener('click', e => { const a = e.target.closest('a.vrn-site'); if (a) navigator.clipboard?.writeText(a.dataset.vrn).catch(() => {}); });
function vrnSheet(vrn) {
    navigator.clipboard?.writeText(vrn).catch(() => {});
    openSheet('Check VRN', vrnSites(vrn));
}
function entryCheck(r) {
    const since = r.member_since ? fmtDate(String(r.member_since).slice(0, 10)) : '';
    if (r.check_entry === 'existing') return { ok: true, t: 'Existing member', s: `Member since ${since}.${r.on_app ? ' Approving links this app account to them' : ' Approving updates their details'}.` };
    if (r.check_entry === 'returning') return { ok: false, warn: true, t: 'Returning member', s: `${r.match_status === 'left' ? 'Left' : 'Removed'}${r.match_removed_at ? ' on ' + fmtDate(String(r.match_removed_at).slice(0, 10)) : ''}. Approving restores them.` };
    if (r.check_entry === 'recent') return { ok: true, t: 'New member', s: `Joined on ${since} and filled the form again.` };
    return { ok: true, t: 'New member', s: 'Not in the member list yet.' };
}
/* The 4 checks: worked out automatically, and every one can be set by an admin (who set it is shown) */
function checksOf(r) {
    const e = entryCheck(r), c = r.checks || {}, by = k => c['by_' + k] ? ` · set by ${c['by_' + k]}` : '';
    const entry = c.entry === 'ok' ? { ok: true, t: e.t, s: 'Checked' + by('entry') }
        : c.entry === 'dup' ? { ok: false, warn: true, t: 'Possible duplicate', s: 'Flagged for a closer look' + by('entry') }
        : { ok: e.ok, warn: e.warn, t: e.t, s: e.s };
    const kind = c.ronin === 'ok' ? 'yes' : c.ronin === 'booked' ? 'booked' : c.ronin === 'no' ? 'no' : roninKind(r);
    const notBike = v => !v || /^\s*(nope|no|nah|not yet|none|n\/?a|yes|yeah|-+)\b|^no bike/i.test(v);
    const other = [r.answers?.[OTHER_BIKE_Q], kind === 'no' ? r.bike : ''].find(v => !notBike(v)) || '';
    const ronin = kind === 'yes' ? { ok: true, t: 'Owns a Ronin', s: c.ronin ? 'Confirmed' + by('ronin') : `Answer: ${r.answers?.[RONIN_Q] || r.bike || '–'}` }
        : kind === 'booked' ? { ok: true, t: 'Ronin booked', s: 'Delivery pending' + by('ronin') }
        : { ok: true, t: 'Non-Ronin rider', s: (r.answers?.[PLAN_Q] === P_BUY ? 'Planning to buy a Ronin' : other ? `Rides: ${other}` : r.answers?.[PLAN_Q] === P_NONE ? 'No bike yet' : 'No Ronin yet') + by('ronin') + ' · welcome too' };
    const vrn = kind !== 'yes' && !r.vrn_verified ? { ok: true, t: 'No VRN needed', s: kind === 'booked' ? 'They can add it in Me after delivery' : 'Non-Ronin rider' }
        : r.vrn_verified ? { ok: true, t: 'VRN verified', s: (c.vrn === 'ok' ? 'Checked' : 'Ticked') + by('vrn') }
        : c.vrn === 'no' ? { ok: false, t: 'VRN couldn\'t be verified', s: 'Marked' + by('vrn') }
        : r.vrn_known ? { ok: true, t: 'VRN verified', s: 'Verified earlier, same VRN on their record' }
        : { ok: false, unk: true, pending: true, t: 'VRN not checked yet', s: 'Tap to mark it after checking' };
    const tnc = r.tnc === true ? { ok: true, t: 'Agreed to the T&C', s: c.tnc === 'ok' ? 'Confirmed' + by('tnc') : '' }
        : r.tnc === false ? { ok: false, t: 'Did not agree to the T&C', s: c.tnc === 'no' ? 'Marked' + by('tnc') : 'From their answer' }
        : r.member_tnc === true ? { ok: true, t: 'Agreed to the T&C', s: 'When they joined RWB' }
        : { ok: false, unk: true, t: 'T&C answer not found', s: 'Tap to send them the T&C, or mark it once they agree' };
    return [{ k: 'entry', ...entry }, { k: 'ronin', ...ronin }, { k: 'vrn', ...vrn }, { k: 'tnc', ...tnc }];
}
function reqCard(r) {
    const cks = checksOf(r), all = cks.every(c => c.ok), st = r.status || 'pending';
    const ico = c => c.ok ? '✓' : c.pending ? '' : c.warn || c.unk ? '!' : '✕';
    const btns = st === 'rejected' ? `<button class="btn ghost" data-act="ask" data-id="${r.id}">💬 Message</button><button class="btn ghost" data-act="reopen" data-id="${r.id}">Move back to New</button>`
        : `<button class="btn ghost" data-act="ask" data-id="${r.id}" aria-label="Message ${esc(r.full_name)} on WhatsApp">💬 Message</button>${st === 'hold' ? `<button class="btn ghost" data-act="reopen" data-id="${r.id}">Back to New</button>` : `<button class="btn ghost" data-act="hold" data-id="${r.id}">On hold</button>`}<button class="btn ghost" data-act="reject" data-id="${r.id}">Reject</button><button class="btn" data-act="approve" data-id="${r.id}">Approve</button>`;
    return `<div class="card req-card st-${st}" data-id="${r.id}">
        <div class="row" style="gap:8px;align-items:flex-start"><div class="grow"><h3>${esc(r.full_name)} ${RONIN_TAG[roninKind(r)]}</h3>
            <p class="small muted">${r.source === 'form' ? 'Google Form' : 'RWB join form'} · ${timeAgo(r.form_ts || r.created_at)}${r.on_app ? ' · signed in' : ''}</p>
            ${st === 'hold' ? `<p class="req-note hold">⏸️ On hold${r.decided_by ? ` by ${esc(r.decided_by)}` : ''} ${r.decided_at ? timeAgo(r.decided_at) : ''}${r.hold_note ? `<b>“${esc(r.hold_note)}”</b>` : ''}</p>` : ''}
            ${st === 'rejected' ? `<p class="req-note rej">Rejected${r.decided_by ? ` by ${esc(r.decided_by)}` : ''} ${r.decided_at ? timeAgo(r.decided_at) : ''}${r.spam ? ' · <span class="badge danger-tag">Spam: can\'t apply again</span>' : ''}${r.reject_reason ? `<b>“${esc(r.reject_reason)}”</b>` : ''}</p>` : ''}
            ${st === 'pending' && r.updated_at && Date.now() - Date.parse(r.updated_at) < 3 * 864e5 ? `<span class="upd-tag">✏️ Updated ${timeAgo(r.updated_at)}</span>` : ''}</div>
            <span class="req-score ${all ? 'ok' : ''}">${cks.filter(c => c.ok).length}/4</span></div>
        ${r.answers?.[NOTE_Q] ? `<div class="req-msg"><span>💬 Message from ${esc(firstName(r))}</span><p>${esc(r.answers[NOTE_Q])}</p></div>` : ''}
        <ul class="checks">${cks.map(c => `<li class="${c.ok ? 'yes' : c.pending ? 'no pend' : c.warn || c.unk ? 'warn' : 'no'} tap-chk" data-act="chk" data-id="${r.id}" data-k="${c.k}" role="button" tabindex="0" aria-label="${esc(c.t)}: change">
            <span class="ci">${ico(c)}</span><span class="grow"><b>${esc(c.t)}</b>${c.k === 'vrn' ? `<small>${c.t === 'No VRN needed' ? '' : `<span class="vrn">${esc(r.vrn || r.member_vrn || 'No VRN given')}</span>`}${c.s ? (c.t === 'No VRN needed' ? '' : ' · ') + esc(c.s) : ''}</small>` : c.s ? `<small>${esc(c.s)}</small>` : ''}</span><span class="chk-edit" aria-hidden="true">›</span>
            ${c.k === 'vrn' && r.vrn && c.t !== 'No VRN needed' ? `<span class="vrn-tools"><button class="link-btn" data-act="copy-vrn" data-v="${esc(r.vrn)}">Copy</button><button class="link-btn" data-act="vrn-sites" data-v="${esc(r.vrn)}">Check VRN ↗</button></span>` : ''}
            ${c.k === 'vrn' && r.vrn_other ? `<small class="dup">⚠ Same VRN as ${esc(r.vrn_other)}</small>` : ''}</li>`).join('')}</ul>
        ${r.match_linked && r.on_app && r.check_entry !== 'new' ? '<p class="warn small" style="margin-bottom:10px">⚠ This number is already linked to another app account.</p>' : ''}
        ${isMinor(r.dob) ? `<p class="warn small" style="margin-bottom:10px">⛔ Under 18 (age ${ageOf(r.dob)} from the date of birth given). RWB is for riders 18 and over, so this entry can't be approved. Reject it, or check the date of birth with them if it's a typo.</p>` : ''}
        <details class="answers"><summary>All answers</summary>${r.answers && Object.keys(r.answers).length ? `<dl class="facts">${Object.entries(r.answers).map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}<dt>Phone link</dt><dd><a href="${waTo(r.phone)}" target="_blank" rel="noopener">WhatsApp ${esc(r.phone)}</a></dd></dl>` : `<dl class="facts">
            <dt>WhatsApp</dt><dd><a href="${waTo(r.phone)}" target="_blank" rel="noopener">${esc(r.phone)}</a></dd><dt>Email</dt><dd>${esc(r.email || '–')}</dd>
            ${r.dob ? `<dt>Birthday</dt><dd>${fmtDayMonth(r.dob)}</dd>` : ''}<dt>Bike</dt><dd>${esc(r.bike || '–')}</dd>${r.blood_group ? `<dt>Blood group</dt><dd>${esc(r.blood_group)}</dd>` : ''}
            ${r.locality ? `<dt>Locality</dt><dd>${esc(r.locality)}</dd>` : ''}${r.hideout ? `<dt>Hometown</dt><dd>${esc(r.hideout)}</dd>` : ''}
            ${r.emergency_phone ? `<dt>Emergency</dt><dd>${esc(r.emergency_phone)}</dd>` : ''}${r.alt_phone ? `<dt>Alt. mobile</dt><dd>${esc(r.alt_phone)}</dd>` : ''}</dl>`}</details>
        <div class="btns req-btns ${st === 'rejected' ? 'two' : 'four'}" style="margin-top:12px">${btns}</div></div>`;
}
/* age from a date of birth (YYYY-MM-DD); RWB is 18+ (Terms, Privacy Policy and the DPDP Act's rules for children) */
function ageOf(dob) {
    const d = String(dob || '').slice(0, 10).split('-').map(Number); if (d.length < 3 || !d[0] || d[0] < 1910) return null;
    const n = new Date(); let a = n.getFullYear() - d[0]; if (n.getMonth() + 1 < d[1] || (n.getMonth() + 1 === d[1] && n.getDate() < d[2])) a--; return a;
}
const isMinor = dob => { const a = ageOf(dob); return a !== null && a < 18; };
/* Tap a check: choose how it should count */
function checkSheet(r, k) {
    const c = r.checks || {}, cur = k === 'vrn' ? (r.vrn_verified ? 'ok' : c.vrn === 'no' ? 'no' : 'auto') : k === 'tnc' ? (c.tnc || 'auto') : (c[k] || 'auto');
    const e = entryCheck(r);
    const OPTS = {
        entry: { title: 'New or existing member', opts: [['auto', `Automatic: ${e.t}`, e.s], ['ok', '✓ Checked, looks fine', 'You checked who they are'], ['dup', '⚠ Possible duplicate', 'Already registered under another number or name']] },
        ronin: { title: 'Ronin', opts: [['auto', 'From their answer', `“${r.answers?.[RONIN_Q] || r.bike || 'No answer'}”`], ['ok', '✓ Owns a Ronin', 'Confirmed by you'], ['booked', '✓ Ronin booked', 'Delivery pending'], ['no', '✓ Non-Ronin rider', 'Doesn\'t own one. Welcome too']] },
        vrn: { title: 'VRN verified', opts: [['ok', '✓ Verified', 'Checked with Check VRN, the RC, or with the rider'], ['no', '✕ Couldn\'t verify', 'The number or the owner didn\'t match'], ['auto', 'Not checked yet', r.vrn_known ? 'Same VRN as on their member record (counts as verified)' : '']] },
        tnc: { title: 'Agreed to the T&C', opts: [['auto', 'From their answer', r.tnc == null && !(c.tnc_orig ?? null) ? 'No answer on record' : ''], ['ok', '✓ Agreed', 'For example, they replied “I agree” on WhatsApp'], ['no', '✕ Doesn\'t agree', '']] }
    }[k];
    openSheet(OPTS.title, `<p class="small muted" style="margin-bottom:10px">${esc(r.full_name)} · choose how this check counts.</p>
        <div class="chk-opts">${OPTS.opts.map(([v, t, sub]) => `<button type="button" class="chk-opt${v === cur ? ' on' : ''}" data-v="${v}"><b>${esc(t)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}</div>
        ${k === 'vrn' && r.vrn ? `<div class="btns" style="margin-top:12px"><button class="btn ghost" data-x="copy">Copy ${esc(r.vrn)}</button></div>${vrnSites(r.vrn)}` : ''}
        ${k === 'tnc' ? `<button class="btn wa block" data-x="tnc-send" style="margin-top:12px">Send them the T&C on WhatsApp</button>` : ''}`, body => {
        body.querySelectorAll('.chk-opt').forEach(b => b.onclick = () => busy(b, async () => { await api.admin.setCheck(r.id, k, b.dataset.v); closeSheet(); toast('Saved'); adminRequests(); }));
        const cp = body.querySelector('[data-x=copy]'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(r.vrn); toast('VRN copied'); } catch { toast(r.vrn); } };
        const ts = body.querySelector('[data-x=tnc-send]'); if (ts) ts.onclick = () => { tellOnWhatsApp(`Message ${firstName(r)}`, r.phone, waMsg('ask', { ...r, asks: ['Agree to the RWB Terms & Conditions'] })); };
    });
}
/* Ready-made WhatsApp messages; the admin can edit them before sending (free: sent from the admin's own WhatsApp) */
/* Where to get the app. Inside the Play Store app (and once RWB is public on Play) only the Play Store link is ever shown:
   Google rejects apps that point people to an APK outside Play ("Device and Network Abuse", Nov 2026). */
let PLAY_APP = false;
const getLink = () => PLAY_APP || PLAY_LIVE ? PLAY_URL : 'https://roninwb.in/get';
const playOnly = () => PLAY_APP || PLAY_LIVE;
function waMsg(kind, x = {}) {
    const first = firstName(x) || 'Warrior', me = firstName(state.me) || 'RWB';
    /* one place for every rider, whether they joined in the app, on the website or on the old Google Form */
    const joinLink = `roninwb.in/join and continue with Google using ${x.email ? x.email : 'the email you joined with'}`;
    const T = {
        welcome: `Hi ${first}! 🎉\n\nWelcome to Ronin Warriors of Bengal! We'll add you to our official RWB WhatsApp group within 72 hours. Sit tight.\n\nMeanwhile, get the RWB App: ${getLink()}\nSign in with Google using ${x.email ? `the same email you joined with (${x.email})` : 'the same email you used on the RWB join form'}. Your details are already there.\n\nExplore. Evolve. Inspire. 🏍️\n– ${me}, RWB`,
        existing: `Hi Warrior ${first}! 👋\n\nYou're already in our RWB WhatsApp group, so nothing to worry about. Your RWB App account is ready: just open the app and explore.\n\n📍 Track: live location on rides, SOS to the RWB team\n🔧 Service: records, bills and next-service reminders\n⛽ Mileage: your real km/l and fuel spends\n🛒 MotoMart: buy and sell used riding gear\n📘 Guides: maintenance help and tested gear\n📅 Events: rides, RSVPs and shared expenses\n🗓️ Calendar: events plus renewal, service and parts due dates, with reminders\n🏍️ RWB: members and leaderboards\n🤖 Pookie: our AI for any bike question\n\nPlease also update your details in the Me tab (you can set your bike model and add up to 3 bikes).\n\n${getLink()}\nExplore. Evolve. Inspire.\n– ${me}, RWB`,
        returning: `Hi ${first}! 🎉\n\nWelcome back to Ronin Warriors of Bengal! We'll add you to our official RWB WhatsApp group within 72 hours. Sit tight.\n\nThe RWB App: ${getLink()}\nSign in with Google using ${x.email ? `the same email you joined with (${x.email})` : 'the same email you used on the RWB join form'}.\n\nExplore. Evolve. Inspire. 🏍️\n– ${me}, RWB`,
        rejected: `Hi ${first},\n\nThank you for your interest in Ronin Warriors of Bengal. We're sorry, we couldn't approve your registration this time${x.reason ? `: ${x.reason.replace(/[.\s]+$/, '')}.` : '.'}\n\nIf things change, you can apply again: open ${joinLink}. If you think this is a mistake, just reply here.\n\nRide safe! 🙏\n– ${me}, RWB`,
        hold: `Hi ${first}! 👋\n\nThanks for your interest in Ronin Warriors of Bengal. Your join request is on hold for now${x.note ? `: ${x.note.replace(/[.\s]+$/, '')}.` : '.'}\n\nTo see your request or update your answers, open ${joinLink}. Any questions? Just reply here.\n– ${me}, RWB`,
        change_ok: `Hi ${first}! ✅ Your ${x.what || 'profile'} update in the RWB App is approved. Thanks for keeping your details up to date.\n– ${me}, RWB`,
        change_no: `Hi ${first}, we couldn't approve your ${x.what || 'profile'} update in the RWB App${x.reason ? `: ${x.reason.replace(/[.\s]+$/, '')}.` : '.'} Just reply here if you'd like help with it. 🙏\n– ${me}, RWB`,
        ask: `Hi ${first}! 👋\n\nThanks for registering with Ronin Warriors of Bengal. Before we approve you, could you please help us with:\n${(x.asks || []).map(a => '• ' + a).join('\n') || '• '}\n${(x.asks || []).some(a => /terms/i.test(a)) ? `\n📜 RWB Terms & Conditions: ${TNC_URL}\nIf you agree, just reply “I agree” here.\n` : ''}\nTo update your answers, open ${joinLink}. Or just reply here.\n\nThank you!\n– ${me}, RWB`,
        invite: `Hi ${first}! 👋\n\nRWB now has its own free app for members: service records and reminders, a calendar that reminds you of renewals and service dates, mileage tracker, MotoMart for used gear, events, guides and more.\n\n📲 Get it here: ${getLink()}\nSign in with Google using the email you gave on the RWB join form. Don't remember it? The app will help: on the “No Account Found” screen, enter your WhatsApp number and VRN.${playOnly() ? `\n\n🎥 iPhone: ${INSTALL_IPHONE}` : `\n\n🎥 How to install:\nAndroid: ${INSTALL_ANDROID}\niPhone: ${INSTALL_IPHONE}`}\n\nExplore. Evolve. Inspire.\n– ${me}, RWB`,
        sticker: `Hi ${first}! 👋\n\nIf you haven't got your RWB sticker yet, you can collect it at our next meet-up or ride. 🏍️\n\nIf you already have one, kindly update it in the RWB App → Me → More from RWB: https://roninwb.in/app/#me\n\nThank you!\n– ${me}, RWB`,
        comeback: `Hi ${first}! 👋\n\nIt's ${me} from Ronin Warriors of Bengal. We miss you on the road! If you'd like to come back to RWB, just reply here or fill the join form again at roninwb.in.\n\nRide safe! 🏍️`,
        remind: `Hi ${first}! 👋\n\nA quick one from the RWB team: please complete your RWB profile.${x.rules ? `\n\n📜 Please read and agree to the RWB Terms & Conditions: ${TNC_URL}\nAgree in the app (Me → Terms & Conditions → Read & agree), or just reply “I agree” here.` : ''}${x.missing?.length ? `\n\nMissing: ${x.missing.join(', ')}.` : ''}\n\nIt takes a minute in the RWB App: ${getLink()} → Me.${x.on_app ? '' : ' Sign in with Google using the email you gave on the join form.'}\n\nThank you! Explore. Evolve. Inspire.\n– ${me}, RWB`
    };
    return T[kind];
}
const INSTALL_ANDROID = 'https://roninwb.in/app/videos/track.mp4', INSTALL_IPHONE = 'https://roninwb.in/app/videos/install-iphone.mp4';
/* Send a message to the RWB WhatsApp group: with the saved group link it's copied and the group opens (paste it);
   otherwise WhatsApp's share screen opens with the message ready (long lists use the phone's share sheet). */
async function toGroup(text) {
    const link = state.settings?.wa_group_link;
    if (link) {
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
        toast('Message copied. Paste it in the RWB group.');
        setTimeout(() => openWA(link), 600);
        return;
    }
    if (text.length > 1800 && navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    openWA(waShare(text));
}
function tellOnWhatsApp(title, phone, text, done) {
    openSheet(title, `<p class="small muted" style="margin-bottom:8px">Sent from your own WhatsApp. Change anything you like first.</p>
        <textarea id="wa-text" rows="12" style="font-size:.9rem;line-height:1.45">${esc(text)}</textarea>
        <button class="btn wa block" data-x="send" style="margin-top:10px">Send on WhatsApp</button>
        <button class="btn ghost block" data-x="skip" style="margin-top:8px">Not now</button>`, body => {
        body.querySelector('[data-x=send]').onclick = () => { openWA(waTo(phone, body.querySelector('#wa-text').value)); closeSheet(); done?.(true); };
        body.querySelector('[data-x=skip]').onclick = () => { closeSheet(); done?.(false); };
    });
}
const azSort = l => [...l].sort((a, b) => String(a.full_name || '').trim().localeCompare(String(b.full_name || '').trim(), 'en', { sensitivity: 'base' }));
const CHANGE_TXT = { name: 'Name', phone: 'WhatsApp No.', email: 'Email', vrn: 'Main bike (VRN)', bike: 'New bike', tnc: 'Terms & Conditions' };
function changeCard(c) {
    const isVrn = c.kind === 'vrn' || c.kind === 'bike';
    return `<div class="card req-card change-card" data-cid="${c.id}">
        <div class="row" style="gap:8px;align-items:flex-start"><div class="grow"><h3>${esc(c.full_name)}</h3><p class="small muted">Change request · ${timeAgo(c.created_at)}</p></div><span class="badge orange">${esc(CHANGE_TXT[c.kind])}${c.slot ? ' ' + c.slot : ''}</span></div>
        ${c.kind === 'tnc' ? '<p class="warn" style="margin:12px 0">They no longer agree to the RWB Terms & Conditions. If they\'re leaving, use <b>Remove from RWB</b> on their profile.</p>'
            : `<div class="chg"><span class="old">${esc(c.old_value || (c.kind === 'bike' ? 'No bike in this slot' : '–'))}</span><span class="arr">→</span><span class="new">${esc(c.new_value)}${c.new_model ? ` · ${esc(c.new_model)}` : ''}</span></div>`}
        ${isVrn ? `<ul class="checks"><li class="${c.vrn_verified ? 'yes' : 'no'}"><label class="vrn-tick"><input type="checkbox" data-act="chg-vrn" data-cid="${c.id}"${c.vrn_verified ? ' checked' : ''}><span class="ci">${c.vrn_verified ? '✓' : '✕'}</span>
            <span class="grow"><b>VRN verified</b><small><span class="vrn">${esc(c.new_value)}</span> · tick once you've checked it</small></span></label>
            <span class="vrn-tools"><button class="link-btn" data-act="copy-vrn" data-v="${esc(c.new_value)}">Copy</button><button class="link-btn" data-act="vrn-sites" data-v="${esc(c.new_value)}">Check VRN ↗</button></span>
            ${c.vrn_other ? `<small class="dup">⚠ Same VRN as ${esc(c.vrn_other)}</small>` : ''}</li></ul>` : ''}
        <div class="btns req-btns" style="margin-top:12px"><button class="btn ghost" data-act="chg-msg" data-cid="${c.id}">💬 Message</button><button class="btn ghost" data-act="chg-no" data-cid="${c.id}">${c.kind === 'tnc' ? 'Dismiss' : 'Reject'}</button><button class="btn" data-act="chg-ok" data-cid="${c.id}">${c.kind === 'tnc' ? 'Record it' : 'Approve'}</button></div></div>`;
}
/* ---------- Duplicates in the RWB contact sheet: found every 10 minutes, never removed without an admin ---------- */
const phoneTxt = p => String(p || '').replace(/^(\d{5})(\d{5})$/, '$1 $2');
function dupeCard(g) {
    const phones = new Set(g.entries.map(e => e.phone));
    const head = g.kind === 'vrn' ? `Same VRN <b class="vrn">${esc(g.value)}</b> on ${phones.size} numbers` : `Same WhatsApp number <b>${esc(phoneTxt(g.value))}</b>`;
    return `<section class="card dupe" data-key="${esc(g.key)}">
        <p class="dupe-h"><span class="dupe-ico">${g.kind === 'vrn' ? '🏍️' : '📱'}</span><span class="grow">${head}</span></p>
        <div class="dupe-list">${g.entries.map(e => `<div class="dupe-e${e.best ? '' : ' rm'}" data-id="${esc(e.id)}">
            <div class="dupe-who"><b>${esc(e.name || 'No name')}</b>${e.best ? '<span class="badge ok">Suggested to keep</span>' : ''}
                <span class="small muted">Row ${e.row} · ${esc(phoneTxt(e.phone))}${e.vrn ? ` · <span class="vrn">${esc(e.vrn)}</span>` : ''}</span>
                <span class="small muted">${e.joined ? 'Sent ' + esc(e.joined) : ''}${e.email ? ` · ${esc(e.email)}` : ''}</span>
                <span class="dupe-tags">${e.status ? `<span class="badge">${esc(e.status)}</span>` : ''}${e.on_app ? '<span class="badge ok">On the app</span>' : ''}${e.tnc ? '<span class="badge">T&amp;C ✓</span>' : ''}<span class="badge">${e.filled} answers</span>${e.added === 'RWB App' ? '<span class="badge">Added by the app</span>' : ''}</span></div>
            <div class="seg dupe-pick" role="group" aria-label="Keep or remove"><button data-act="dupe-pick" data-v="keep" aria-pressed="${!!e.best}">Keep</button><button data-act="dupe-pick" data-v="rm" aria-pressed="${!e.best}">Remove</button></div>
        </div>`).join('')}</div>
        <div class="btns"><button class="btn" data-act="dupe-go">Apply</button><button class="btn ghost" data-act="dupe-skip">Not a duplicate</button></div>
    </section>`;
}
async function adminDupes() {
    const list = state.dupes = await api.admin.dupes();
    const c = $('#dupe-count'); if (c) c.textContent = list.length ? ` (${list.length})` : '';
    $('#admin-body').innerHTML = list.length ? `<p class="small muted" style="margin-bottom:10px">The same rider twice in the RWB contact sheet: the same WhatsApp number, or the same VRN on different numbers. Nothing is removed until you choose. Pick <b>Keep</b> or <b>Remove</b> for each entry, then Apply.</p>
        <div class="list">${list.map(dupeCard).join('')}</div>`
        : '<div class="card empty"><b>No duplicates</b>The sheet is checked every 10 minutes. If the same rider shows up twice (same WhatsApp number, or the same VRN on different numbers), you decide here which entry stays.</div>';
    const groupOf = el => list.find(g => g.key === el.closest('.dupe').dataset.key);
    Object.assign(actions, {
        'dupe-pick': b => { const row = b.closest('.dupe-e'); row.classList.toggle('rm', b.dataset.v === 'rm'); row.querySelectorAll('[data-act=dupe-pick]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); },
        'dupe-go': b => {
            const g = groupOf(b), card = b.closest('.dupe');
            const rm = [...card.querySelectorAll('.dupe-e.rm')].map(x => g.entries.find(e => e.id === x.dataset.id));
            if (!rm.length) return toast('Mark at least one entry Remove, or tap Not a duplicate', true);
            if (rm.length === g.entries.length) return toast('Keep at least one entry', true);
            const keepPhones = new Set(g.entries.filter(e => !rm.includes(e)).map(e => e.phone));
            const lines = rm.map(e => keepPhones.has(e.phone) || e.member !== 'active'
                ? `• ${e.name} (row ${e.row}): the row moves to the "Older entries" tab`
                : `• ${e.name} (${phoneTxt(e.phone)}): removed from RWB${e.on_app ? ', and their app account is deleted' : ''}. You can restore them from Members → Left / removed`);
            if (!confirmBox(`Remove ${rm.length === 1 ? 'this entry' : 'these entries'}?\n\n${lines.join('\n')}`)) return;
            busy(b, async () => { await api.admin.resolveDupe(g.key, rm.map(e => e.id)); state.adminMembers = null; state.dir = null; toast('Done. The sheet updates in a few seconds'); await adminDupes(); });
        },
        'dupe-skip': b => { const g = groupOf(b); if (confirmBox('Keep all of these entries? This group won\'t be shown again.')) busy(b, async () => { await api.admin.resolveDupe(g.key, [], true); toast('Marked as not a duplicate'); await adminDupes(); }); }
    });
}
async function adminRequests() {
    /* the approval list shows first; the follow-ups (they need every member) fill in under it when they arrive */
    const later = Promise.all([api.admin.incomplete().catch(() => null), state.adminMembers ? Promise.resolve(state.adminMembers) : api.admin.members().then(m => (state.adminMembers = m)).catch(() => [])]);
    state.joinView ||= 'pending';
    const view = state.joinView;
    const [jl, chg] = await Promise.all([api.admin.joinList(view), view === 'pending' ? api.admin.changes().catch(() => []) : Promise.resolve([])]);
    const reqs = jl.list || [], cnt = jl.counts || {};
    const seg = `<div class="seg join-seg" role="tablist" aria-label="Join requests">${[['pending', 'New'], ['hold', 'On hold'], ['rejected', 'Rejected']].map(([k, t]) => `<button role="tab" aria-selected="${view === k}" data-act="jview" data-v="${k}">${t}${cnt[k] ? ` (${cnt[k]})` : ''}</button>`).join('')}</div>`;
    const lead = { pending: 'New join requests. Check the 4 points, then approve and add them to the WhatsApp group. Non-Ronin riders are welcome too.', hold: 'Paused requests. The rider sees your note in the app and can update their answers; an update brings them back to New.', rejected: 'Rejected in the last 60 days. The rider sees the reason and can apply again, unless marked as spam.' }[view];
    const digest = () => `🛡️ RWB App: ${reqs.length + chg.length} waiting for approval\n${reqs.length ? `\nNew entries (${reqs.length}):\n${azSort(reqs).slice(0, 15).map(r => `• ${r.full_name} (${r.source === 'form' ? 'form' : 'app'})`).join('\n')}` : ''}${chg.length ? `\n\nProfile changes (${chg.length}):\n${azSort(chg).slice(0, 15).map(c => `• ${c.full_name}: ${CHANGE_TXT[c.kind]}`).join('\n')}` : ''}\n\nOpen: roninwb.in/app → Home → Admin`;
    $('#admin-body').innerHTML = seg + (view === 'pending' && (reqs.length || chg.length) ? `<button class="btn ghost block share-admins" data-act="digest">📣 Share this list to the admin WhatsApp group</button>` : '') + (reqs.length || chg.length ? `${reqs.length ? `<p class="small muted" style="margin-bottom:10px">${lead}</p>
        <div class="list">${reqs.map(reqCard).join('')}</div>` : ''}
        ${chg.length ? `<h2 class="group-title" style="margin-top:${reqs.length ? 22 : 0}px">Changes to approve</h2><p class="small muted" style="margin-bottom:10px">Members changed an important detail in their profile.</p><div class="list">${chg.map(changeCard).join('')}</div>` : ''}`
        : `<div class="card empty"><b>${view === 'pending' ? 'All clear' : 'Nobody here'}</b>${view === 'pending' ? 'Nothing waiting for approval.' : view === 'hold' ? 'No requests on hold.' : 'No rejected requests in the last 60 days.'}</div>`) + (view === 'pending' ? '<div id="fu-box"></div>' : '');
    const byCid = id => chg.find(c => c.id === Number(id));
    const fuBox = $('#fu-box');
    later.then(([inc, all]) => { if (!inc || !fuBox?.isConnected) return; fuBox.outerHTML = followUps(inc, all); bindFollowUps(inc, all); }).catch(() => {});
    Object.assign(actions, {
        digest: () => openWA(waShare(digest())),
        'chg-msg': b => { const c = byCid(b.dataset.cid); tellOnWhatsApp(`Message ${firstName(c)}`, c.phone, `Hi ${firstName(c)}! 👋 About your ${CHANGE_TXT[c.kind].toLowerCase()} update in the RWB App: \n\n– ${firstName(state.me)}, RWB`); },
        'chg-ok': b => { const c = byCid(b.dataset.cid); if ((c.kind === 'vrn' || c.kind === 'bike') && !c.vrn_verified && !confirmBox('The VRN isn\'t ticked as verified. Approve anyway?')) return;
            busy(b, async () => { await api.admin.decideChange(c.id, true); state.adminMembers = null; state.dir = null; toast(c.kind === 'tnc' ? 'Recorded' : 'Change approved'); await viewAdmin();
                if (c.kind !== 'tnc') tellOnWhatsApp(`Let ${firstName(c)} know`, c.phone, waMsg('change_ok', { ...c, what: CHANGE_TXT[c.kind].toLowerCase() })); }); },
        'chg-no': b => { const c = byCid(b.dataset.cid); reasonSheet(`Reject ${firstName(c)}'s change`, ['Could not verify the VRN', 'Please message an admin', 'Not allowed'], async reason => { await api.admin.decideChange(c.id, false, reason); toast(c.kind === 'tnc' ? 'Dismissed' : 'Change rejected'); await viewAdmin();
            if (c.kind !== 'tnc') tellOnWhatsApp(`Let ${firstName(c)} know`, c.phone, waMsg('change_no', { ...c, reason, what: CHANGE_TXT[c.kind].toLowerCase() })); }); }
    });
    $('#admin-body').querySelectorAll('[data-act=chg-vrn]').forEach(cb => cb.onchange = async () => {
        try { await api.admin.setChangeVrn(Number(cb.dataset.cid), cb.checked); await adminRequests(); toast(cb.checked ? 'VRN marked as verified' : 'VRN unmarked'); }
        catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
    });
    const byId = id => reqs.find(r => r.id === Number(id));
    Object.assign(actions, {
        'vrn-sites': b => vrnSheet(b.dataset.v),
        'copy-vrn': async b => { try { await navigator.clipboard.writeText(b.dataset.v); toast('VRN copied'); } catch { toast(b.dataset.v); } },
        approve: b => {
            const r = byId(b.dataset.id), miss = checksOf(r).filter(c => !c.ok).map(c => c.t);
            if (miss.length && !confirmBox(`Not all 4 checks are green:\n• ${miss.join('\n• ')}\n\nApprove ${r.full_name} anyway?`)) return;
            busy(b, async () => {
                await api.admin.approve(r.id); state.adminMembers = null; state.dir = null; toast(`${r.full_name} approved. Now add them to the RWB WhatsApp group.`); await viewAdmin();
                const kind = r.check_entry === 'existing' || r.check_entry === 'recent' ? 'existing' : r.check_entry === 'returning' ? 'returning' : 'welcome';
                tellOnWhatsApp(`Let ${firstName(r)} know`, r.phone, waMsg(kind, r));
            });
        },
        reject: b => rejectSheet(byId(b.dataset.id)),
        hold: b => holdSheet(byId(b.dataset.id)),
        reopen: b => { const r = byId(b.dataset.id); if (confirmBox(`Move ${r.full_name} back to New?${r.spam ? ' They will be able to apply again.' : ''}`)) busy(b, async () => { await api.admin.reopen(r.id); toast('Moved back to New'); state.joinView = 'pending'; await adminRequests(); }); },
        jview: el => { state.joinView = el.dataset.v; adminRequests(); },
        ask: b => askSheet(byId(b.dataset.id)),
        chk: el => checkSheet(byId(el.dataset.id), el.dataset.k)
    });
    /* keep the list fresh while it's open: people may update their details after a message */
    clearInterval(state.apprTimer);
    state.apprTimer = setInterval(() => { if (location.hash.startsWith('#admin') && state.adminTab === 'requests' && state.joinView === 'pending' && document.visibilityState === 'visible' && !$('dialog#sheet[open]')) adminRequests(); else if (!location.hash.startsWith('#admin')) clearInterval(state.apprTimer); }, 30000);
}
/* Follow-ups: Terms & Conditions, missing details, not on the app, and people who left — with a view filter */
const FU_VIEWS = { app: 'On the app', all: 'Members', gone: 'Left / removed' };
function followUps(inc, all) {
    state.fuView ||= 'all';
    return `<h2 class="group-title" style="margin-top:24px">Follow-ups</h2>
        <div class="seg fu-seg" role="tablist" aria-label="Follow-up view">${Object.entries(FU_VIEWS).map(([k, v]) => `<button role="tab" aria-selected="${state.fuView === k}" data-act="fu-view" data-v="${k}">${v}</button>`).join('')}</div>
        <div id="fu-body"></div>`;
}
function bindFollowUps(inc, all) {
    const gone = (all || []).filter(isGone), notApp = (all || []).filter(m => !isGone(m) && !m.user_id), notAppAll = notApp;
    /* "Have you received RWB sticker?" answered with anything but a yes */
    const stickerQ = m => Object.keys(m.form_answers || {}).find(q => /sticker/i.test(q) && /receiv|got/i.test(q) && !/willing/i.test(q));
    const noSticker = (all || []).filter(m => { if (isGone(m)) return false; const q = stickerQ(m); return q && !/^\s*(yes|yeah|yep|done|got|received|already|ha+n?)\b/i.test(ansText(m.form_answers[q])); });
    const rowHtml = (m, kind) => `<div class="fu-row" data-mid="${m.id}"><div class="grow"><b>${esc(m.full_name)}</b>${m.on_app || m.user_id ? ' <span class="badge ok">On the app</span>' : ''}
            ${kind === 'gone' ? `<div class="small muted">${esc(GONE_TXT?.[m.status] || 'Left')}${m.removed_at ? ' · ' + fmtDate(String(m.removed_at).slice(0, 10)) : ''}</div>` : kind === 'notapp' ? `<div class="small muted">${esc([m.vrn, m.locality].filter(Boolean).join(' · ') || 'Not on the app yet')}</div>` : kind === 'sticker' ? `<div class="small muted">Answered: “${esc(ansText(m.form_answers[stickerQ(m)]))}”${m.locality ? ' · ' + esc(m.locality) : ''}</div>`
                : `<div class="fu-miss">${m.missing.map(x => `<span>${esc(x === 'rules' ? 'T&C' : x)}</span>`).join('')}</div>`}${m.reminded_at ? `<small class="muted">Reminded ${timeAgo(m.reminded_at)}</small>` : ''}</div>
        <div class="fu-btns"><button class="btn sm wa" data-act="fu-wa" data-kind="${kind}" data-mid="${m.id}">WhatsApp</button>${kind === 'todo' && m.missing.includes('rules') ? `<button class="btn sm ghost" data-act="fu-agree" data-mid="${m.id}">Agreed</button>` : ''}</div></div>`;
    const block = (id, title, sub, list, kind) => `<details class="fu card section" id="${id}"${list.length && list.length < 6 ? ' open' : ''}><summary><b>${title}</b> <span class="badge ${list.length ? 'orange' : ''}">${list.length}</span><span class="small muted">${sub}</span></summary>
        ${list.length ? `<input class="search" type="search" placeholder="Search name" data-fu="${id}" style="margin:10px 0"><div class="fu-list"></div><button class="btn ghost block" data-more="${id}" hidden>Show more</button>` : '<p class="small muted" style="margin-top:8px">Nobody here.</p>'}</details>`;
    const draw = () => {
        const v = state.fuView, onApp = m => m.on_app;
        const scope = v === 'app' ? inc.filter(onApp) : inc;
        const tnc = scope.filter(m => m.missing.includes('rules')), other = scope.filter(m => !m.missing.includes('rules'));
        const lists = v === 'gone' ? [['fu-gone', 'Left / removed', 'Say hello, or invite them back.', gone, 'gone']]
            : [['fu-rules', 'Not agreed to the T&C', 'No “read carefully” answer on record, or they said no. Tap Agreed if they confirmed to you.', tnc, 'todo'],
               ['fu-other', 'Missing details', 'Emergency contact, blood group, birthday, VRN, locality or permanent hideout.', other, 'todo'],
               ['fu-sticker', 'RWB sticker not received', 'Tell them where to collect it, or to update the app if they already have one.', v === 'app' ? noSticker.filter(m => m.user_id) : noSticker, 'sticker'],
               ...(v === 'all' ? [['fu-notapp', 'Not on the app', 'Send them the app link with the Android and iPhone install videos.', notApp, 'notapp']] : [])];
        $('#fu-body').innerHTML = `<p class="small muted" style="margin:10px 0">${v === 'gone' ? 'Members who left or were removed.' : 'Members on the app get an in-app reminder every Sunday. For everyone else, tap WhatsApp to send a ready-made reminder.'}</p>
            ${lists.map(([id, t, sub, list, kind]) => block(id, t, sub, list, kind)).join('')}
            ${(v === 'gone' ? gone.length : tnc.length + other.length + (v === 'all' ? notApp.length : 0) + (v === 'app' ? noSticker.filter(m => m.user_id) : noSticker).length) ? `<button class="btn block section" data-act="fu-share">📣 Share ${FU_VIEWS[v] === 'Members' ? 'all' : `“${FU_VIEWS[v]}”`} follow-ups to the RWB group</button>` : ''}
            ${v !== 'gone' ? `<button class="btn ghost block" data-act="fu-remind" style="margin-top:8px">🔔 Send in-app reminders now (members on the app)</button>` : ''}
            <details class="fu card section"><summary><b>RWB WhatsApp group link</b><span class="small muted">Optional. Lets members and admins open the group in one tap.</span></summary>
                <form id="grp" style="margin-top:10px"><input name="link" type="url" placeholder="https://chat.whatsapp.com/…" value="${esc(state.settings?.wa_group_link || '')}">
                <p class="small muted" style="margin:6px 0 10px">In WhatsApp: open the RWB group → tap its name → Invite via link → Copy link. Only members can see it in the app.</p>
                <button class="btn block">Save link</button></form></details>`;
        lists.forEach(([id, , , list, kind]) => {
            const box = $('#' + id); if (!box || !list.length) return;
            let lim = 25, q = '';
            const paint = () => { const hits = list.filter(m => !q || m.full_name.toLowerCase().includes(q)); box.querySelector('.fu-list').innerHTML = hits.slice(0, lim).map(m => rowHtml(m, kind)).join('') || '<p class="small muted">No one matches.</p>'; box.querySelector('[data-more]').hidden = hits.length <= lim; };
            box.querySelector('[data-fu]').oninput = e => { q = e.target.value.trim().toLowerCase(); lim = 25; paint(); };
            box.querySelector('[data-more]').onclick = () => { lim += 50; paint(); };
            paint();
        });
        $('#grp').onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { const v = await api.admin.setSetting('wa_group_link', e.target.link.value); state.settings = { ...(state.settings || {}), wa_group_link: v || null }; toast(v ? 'Group link saved' : 'Group link removed'); }); };
    };
    draw();
    const byMid = id => inc.find(m => m.id === Number(id)) || (all || []).find(m => m.id === Number(id));
    /* what the selected tab shows: On the app → only app users; Members → everyone; Left / removed → only them */
    const inTab = () => {
        const v = state.fuView, scope = v === 'app' ? inc.filter(m => m.on_app) : v === 'gone' ? [] : inc;
        return { tnc: scope.filter(m => m.missing.includes('rules')), other: scope.filter(m => !m.missing.includes('rules')), app: v === 'all' ? notAppAll : [], gone: v === 'gone' ? gone : [], sticker: v === 'gone' ? [] : v === 'app' ? noSticker.filter(m => m.user_id) : noSticker };
    };
    const shareAll = (pick = { tnc: true, other: true, app: true, gone: true, sticker: true }) => {
        const t = inTab(), tnc = pick.tnc ? t.tnc : [], other = pick.other ? t.other : [], notApp = pick.app ? t.app : [], left = pick.gone ? t.gone : [], sticker = pick.sticker ? t.sticker : [];
        const firstNames = l => azSort(l).map(m => `• ${m.full_name}`).join('\n');
        if (state.fuView === 'gone') return `🏍️ *We miss these warriors!* 🧡\n\n${firstNames(left)}\n\nIf you're in touch with them, let them know they're always welcome back. They can rejoin with the join form at roninwb.in or the RWB App: ${getLink()}\n\nExplore. Evolve. Inspire.`;
        return `🏍️ *RWB App: a quick to-do for some of our warriors* 🙏\n`
            + (tnc.length ? `\n📜 *Please respond to the RWB Terms & Conditions in the app*\nOpen it directly: https://roninwb.in/app/#terms\n(or RWB App → Me → Terms & Conditions → Read & agree)\n${firstNames(tnc)}\n` : '')
            + (other.length ? `\n✍️ *Please add your missing details* (RWB App → Me → Edit)\n${azSort(other).map(m => `• ${m.full_name}: ${m.missing.join(', ')}`).join('\n')}\n` : '')
            + (sticker.length ? `\n🏷️ *RWB sticker not received yet?*\nCollect it at our next meet-up or ride. Already got one? Update it in the RWB App → Me → More from RWB: https://roninwb.in/app/#me\n${firstNames(sticker)}\n` : '')
            + (notApp.length ? `\n📲 *Not on the RWB App yet?* Get it: ${getLink()}\nSign in with the email you gave on the join form.${playOnly() ? '' : `\nAndroid guide: ${INSTALL_ANDROID}`}\niPhone guide: ${INSTALL_IPHONE}\n${firstNames(notApp)}\n` : '')
            + `\nThank you! Explore. Evolve. Inspire.`;
    };
    Object.assign(actions, {
        'fu-view': el => { state.fuView = el.dataset.v; document.querySelectorAll('.fu-seg [role=tab]').forEach(t => t.setAttribute('aria-selected', t === el)); draw(); },
        'fu-wa': b => {
            const m = byMid(b.dataset.mid), kind = b.dataset.kind;
            const text = kind === 'sticker' ? waMsg('sticker', m) : kind === 'notapp' ? waMsg('invite', m) : kind === 'gone' ? waMsg('comeback', m) : waMsg('remind', { ...m, rules: m.missing.includes('rules'), missing: m.missing.filter(x => x !== 'rules') });
            openWA(waTo(m.phone, text));
            if (kind === 'todo' || kind === 'notapp') { api.admin.markReminded(m.id).catch(() => {}); m.reminded_at = new Date().toISOString(); }
        },
        'fu-agree': b => { const m = byMid(b.dataset.mid); if (confirmBox(`Record that ${m.full_name} agreed to the RWB Terms & Conditions?`)) busy(b, async () => { await api.admin.setTnc(m.id, true); toast('Recorded'); adminRequests(); }); },
        'fu-share': () => {
            const t = inTab(), v = state.fuView, n = { tnc: t.tnc.length, other: t.other.length, app: t.app.length, gone: t.gone.length, sticker: t.sticker.length };
            const opt = (k, label) => v === 'app' && k === 'app' ? '' : `<label class="share-pick"><input type="checkbox" name="${k}"${n[k] ? ' checked' : ' disabled'}> <span class="grow">${label}</span><span class="badge ${n[k] ? 'orange' : ''}">${n[k]}</span></label>`;
            openSheet('Share follow-ups to the RWB group', `<p class="small muted" style="margin-bottom:8px">Only names from the <b>${FU_VIEWS[v]}</b> tab, one per line, A–Z.${v === 'gone' ? '' : ' Choose what to include:'}</p>
                <form id="sp" class="group" style="margin-bottom:10px">${v === 'gone' ? opt('gone', '👋 Left / removed members') : opt('tnc', '📜 Respond to the Terms & Conditions in the app') + opt('other', '✍️ Missing details') + opt('sticker', '🏷️ RWB sticker not received') + opt('app', '📲 Not on the app (with Android & iPhone install videos)')}</form>
                <textarea id="wa-text" rows="12" style="font-size:.85rem;line-height:1.45"></textarea>
                <button class="btn wa block" data-x="send" style="margin-top:10px">${state.settings?.wa_group_link ? 'Copy & open the RWB group' : 'Send in the RWB group'}</button>`, body => {
                const f = body.querySelector('#sp'), ta = body.querySelector('#wa-text');
                const upd = () => { ta.value = shareAll({ tnc: !!f.tnc?.checked, other: !!f.other?.checked, app: !!f.app?.checked, gone: !!f.gone?.checked, sticker: !!f.sticker?.checked }); };
                f.onchange = upd; upd();
                body.querySelector('[data-x=send]').onclick = () => { const t = ta.value.trim(); closeSheet(); toGroup(t); };
            });
        },
        'fu-remind': b => busy(b, async () => { const n = await api.admin.remindIncomplete(); toast(n ? `Reminder sent to ${n} member${n > 1 ? 's' : ''} on the app` : 'Everyone on the app was reminded in the last week'); adminRequests(); })
    });
}
/* Ask the applicant for something before deciding (they can update their details; the card refreshes by itself) */
function askSheet(r) {
    const ASKS = ['Confirm your bike\'s VRN (registration number)', 'Share a photo of your RC', 'Confirm that you own a TVS Ronin', 'Agree to the RWB Terms & Conditions', 'Add an emergency contact number', 'Check your WhatsApp number'];
    const pre = [roninKind(r) === 'yes' && !(r.vrn_verified || r.vrn_known) && ASKS[0], !(r.tnc === true || r.member_tnc === true) && ASKS[3], !r.emergency_phone && ASKS[4]].filter(Boolean);
    openSheet(`Message ${firstName(r)}`, `<p class="small muted" style="margin-bottom:8px">Pick what you need from them. When they update their details, this card refreshes by itself.</p>
        <div class="chips" id="ask-chips" style="margin-bottom:10px">${ASKS.map(a => `<button type="button" class="chip" aria-pressed="${pre.includes(a)}" data-a="${esc(a)}">${esc(a)}</button>`).join('')}</div>
        <textarea id="wa-text" rows="11" style="font-size:.9rem;line-height:1.45"></textarea>
        <button class="btn wa block" data-x="send" style="margin-top:10px">Send on WhatsApp</button>`, body => {
        const ta = body.querySelector('#wa-text');
        const draw = () => { ta.value = waMsg('ask', { ...r, asks: [...body.querySelectorAll('#ask-chips [aria-pressed=true]')].map(c => c.dataset.a) }); };
        body.querySelectorAll('#ask-chips .chip').forEach(c => c.onclick = () => { c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); draw(); });
        draw();
        body.querySelector('[data-x=send]').onclick = () => { openWA(waTo(r.phone, ta.value)); closeSheet(); };
    });
}
function reasonSheet(title, quick, done) {
    openSheet(title, `<form id="rs"><div class="chips" style="margin-bottom:10px">${quick.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <label>Reason (optional, the member sees it in their profile)<textarea name="reason" rows="2" maxlength="200"></textarea></label><button class="btn danger block">Reject</button></form>`, body => {
        body.querySelectorAll('[data-q]').forEach(c => c.onclick = () => { body.querySelector('[name=reason]').value = c.dataset.q; });
        body.querySelector('#rs').onsubmit = e => { e.preventDefault(); const reason = e.target.reason.value.trim(); busy(e.submitter, async () => { closeSheet(); await new Promise(r => setTimeout(r, 50)); await done(reason); }); };
    });
}
function rejectSheet(r) {
    const quick = ['VRN could not be verified', 'Duplicate entry', 'Did not agree to the T&C', 'Details look fake'];
    openSheet('Reject ' + firstName(r), `<form id="rj"><p class="small muted" style="margin-bottom:10px">They see the reason in the app${r.source === 'form' ? ', and their entry is deleted from the sheet' : ''}. They can apply again unless you mark it as spam. Not sure yet? Use <b>On hold</b> instead.</p>
        <div class="chips" style="margin-bottom:10px">${quick.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <label>Reason (the rider sees this)<textarea name="reason" rows="2" maxlength="200"></textarea></label>
        <label class="check-row"><input type="checkbox" name="spam"> <span><b>Spam or fake</b><small class="muted"> They can't send a new request. You can undo it from Rejected.</small></span></label>
        <button class="btn danger block">Reject</button></form>`, body => {
        body.querySelectorAll('[data-q]').forEach(c => c.onclick = () => { body.querySelector('[name=reason]').value = c.dataset.q; });
        body.querySelector('#rj').onsubmit = e => { e.preventDefault(); const reason = e.target.reason.value.trim(), spam = e.target.spam.checked; busy(e.submitter, async () => { await api.admin.reject(r.id, reason, spam); closeSheet(); toast(spam ? 'Rejected as spam' : 'Rejected'); await viewAdmin(); if (!spam) tellOnWhatsApp(`Let ${firstName(r)} know`, r.phone, waMsg('rejected', { ...r, reason })); }); };
    });
}
/* On hold: not yes, not no. The rider sees the note in the app (and gets a notification) and can update their answers */
function holdSheet(r) {
    const quick = ['We\'ll call you soon to say hello', 'Waiting for your Ronin delivery. Add the VRN when you get it', 'Please send a photo of your RC on WhatsApp', 'Please check your details and send them again'];
    openSheet('Put ' + firstName(r) + ' on hold', `<form id="hd"><p class="small muted" style="margin-bottom:10px">They see your note when they open roninwb.in/join or the RWB app${r.on_app ? ' (and get a notification)' : ''}. You can also send it on WhatsApp next. When they update their answers, the request comes back to New.</p>
        <div class="chips" style="margin-bottom:10px">${quick.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <label>Note for the rider<textarea name="note" rows="2" maxlength="300"></textarea></label>
        <button class="btn block">Put on hold</button></form>`, body => {
        body.querySelectorAll('[data-q]').forEach(c => c.onclick = () => { body.querySelector('[name=note]').value = c.dataset.q; });
        body.querySelector('#hd').onsubmit = e => { e.preventDefault(); const note = e.target.note.value.trim(); busy(e.submitter, async () => { await api.admin.hold(r.id, note); closeSheet(); toast('On hold'); await viewAdmin(); tellOnWhatsApp(`Let ${firstName(r)} know`, r.phone, waMsg('hold', { ...r, note })); }); };
    });
}
async function adminMembers() {
    state.adminMembers ??= await api.admin.members();
    const all = state.adminMembers;
    state.famAll ??= await api.adminFamList().catch(() => []);
    const famOf = id => state.famAll.filter(f => f.member?.id === id);
    const nNew = all.filter(isNewMember).length, nGone = all.filter(isGone).length;
    const live = all.filter(m => !isGone(m)), nApp = live.filter(m => m.user_id).length;
    const F = { all: 'Everyone', new: `New${nNew ? ` (${nNew})` : ''}`, app: `On app (${nApp})`, noapp: `Not on app (${live.length - nApp})`, admins: 'RWB team', gone: `Left / removed${nGone ? ` (${nGone})` : ''}` };
    state.memberFilter ||= 'all'; state.memberSort ||= 'team';
    const SORTS = { team: 'Team, A–Z', new: 'Newest first', old: 'Oldest first' };
    $('#admin-body').innerHTML = `<div class="chips" style="margin-bottom:10px">${Object.entries(F).map(([k, v]) => `<button class="chip" data-act="mf" data-f="${k}" aria-pressed="${state.memberFilter === k}">${v}</button>`).join('')}<button class="chip fam-chip" data-act="fam-all">👨‍👩‍👧 RWB FAM${state.famAll?.length ? ` (${state.famAll.length})` : ''}</button></div>
    ${state.memberFilter === 'admins' ? `<p class="small muted" style="margin-bottom:10px">Tap a person to ${state.me.role === 'superadmin' ? 'make them an admin or a coordinator' : 'make them a coordinator'} or change their role. Coordinators can approve MotoMart posts.</p>` : ''}${state.memberFilter === 'gone' ? '<p class="small muted" style="margin-bottom:10px">Members who left or were removed, newest first. Their app account and data are deleted; this record stays so you know who left and when. Tap someone to <b>restore</b> them.</p>' : ''}${state.memberFilter === 'new' ? '<p class="small muted" style="margin-bottom:10px">Joined in the last 7 days, through the join form or the app. Add them to the RWB WhatsApp group; the <b>New Member</b> tag goes away after 7 days.</p>' : ''}
    <div class="row" style="gap:8px;margin-bottom:12px"><input class="search" type="search" id="mq" placeholder="Search name, number, bike no. or place" value="${esc(state.adminSearch)}" aria-label="Search members" style="margin:0;flex:1">
        <select id="msort" aria-label="Sort" style="width:auto;flex:none;max-width:44%">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${state.memberSort === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="small muted" id="mcount" style="margin:-4px 0 10px"></p><div class="list" id="ml"></div><button class="btn ghost block section" id="more" hidden>Show more</button>`;
    let limit = 50;
    const draw = () => {
        const q = state.adminSearch.trim().toLowerCase(), qd = q.replace(/\D/g, '');
        const gone = state.memberFilter === 'gone';
        const picked = all.filter(m => gone ? isGone(m) : !isGone(m) && (state.memberFilter === 'app' ? m.user_id : state.memberFilter === 'noapp' ? !m.user_id : state.memberFilter === 'admins' ? isTeam(m) : state.memberFilter === 'new' ? isNewMember(m) : true));
        const jt = m => Date.parse(m.joined_at || m.created_at || 0) || 0;
        const sort = (state.memberFilter === 'new' || gone) && state.memberSort === 'team' ? 'new' : state.memberSort;
        const gt = m => Date.parse(m.removed_at || 0) || 0;
        const pool = gone ? [...picked].sort((a, b) => sort === 'old' ? gt(a) - gt(b) : gt(b) - gt(a)) : sort === 'new' ? [...picked].sort((a, b) => jt(b) - jt(a)) : sort === 'old' ? [...picked].sort((a, b) => jt(a) - jt(b)) : teamFirst(picked);
        const hits = pool.filter(m => !q || m.full_name.toLowerCase().includes(q) || (m.nickname || '').toLowerCase().includes(q) || (qd.length >= 3 && (m.phone || '').includes(qd)) || (vrnKey(q).length >= 2 && [m.vrn, ...(m.member_bikes || []).map(b => b.vrn)].some(v => vrnKey(v).includes(vrnKey(q)))) || (m.locality || '').toLowerCase().includes(q) || (m.hideout || '').toLowerCase().includes(q));
        $('#mcount').textContent = `${hits.length} ${state.memberFilter === 'app' ? 'on the app' : state.memberFilter === 'noapp' ? 'not on the app yet' : state.memberFilter === 'admins' ? 'in the RWB team' : state.memberFilter === 'new' ? 'new in the last 7 days' : gone ? 'left or removed' : 'member' + (hits.length === 1 ? '' : 's')}`;
        $('#ml').innerHTML = hits.slice(0, limit).map(m => isGone(m) ? `<button class="card tap row member-row gone-row" data-act="member" data-id="${m.id}">${face(m, 'avatar sm')}
            <div class="grow"><div class="who">${esc(m.full_name)} <span class="badge gone-tag ${m.status}">${GONE_TXT[m.status]}</span></div>
            <div class="meta">${GONE_TXT[m.status]} ${m.removed_at ? fmtDate(String(m.removed_at).slice(0, 10)) : ''}${m.removed_by ? ` · by ${esc(m.removed_by)}` : ''}${m.removed_note ? ` · “${esc(m.removed_note)}”` : ''} · ${esc(m.phone || '')}</div></div></button>`
            : `<button class="card tap row member-row" data-act="member" data-id="${m.id}">${face(m, 'avatar sm')}
            <div class="grow"><div class="who">${esc(m.full_name)} ${roleBadge(m)}${RONIN_TAG[roninKind(m)]}${isNewMember(m) ? ' <span class="badge new-tag">New Member</span>' : ''}</div>
            <div class="meta">${sort !== 'team' || isNewMember(m) ? `<span class="joined">Joined ${fmtDate(String(m.joined_at || m.created_at).slice(0, 10))}</span> · ` : ''}${m.avg_kmpl ? `<b class="kmpl-tag">${kmplTxt(m.avg_kmpl)}</b> · ` : ''}${esc([m.phone, m.vrn, m.locality].filter(Boolean).join(' · '))}</div></div>
            ${famOf(m.id).length ? `<span class="badge fam-badge" title="RWB FAM">👨‍👩‍👧 ${famOf(m.id).length}</span>` : ''}${m.user_id ? '<span class="badge ok">On app</span>' : ''}</button>`).join('') || '<div class="card empty">No one matches.</div>';
        $('#more').hidden = hits.length <= limit;
    };
    $('#mq').oninput = e => { state.adminSearch = e.target.value; limit = 50; draw(); };
    $('#more').onclick = () => { limit += 100; draw(); };
    draw();
    actions.member = el => memberSheet(all.find(m => String(m.id) === el.dataset.id));
    actions.mf = el => { state.memberFilter = el.dataset.f; adminMembers(); };
    $('#msort').onchange = e => { state.memberSort = e.target.value; limit = 50; draw(); };
}
function memberSheet(m) {
    if (isGone(m)) return goneSheet(m);
    const superA = state.me.role === 'superadmin', self = m.user_id && m.user_id === state.me.user_id;
    const canRemove = !self && m.role !== 'superadmin' && (m.role !== 'admin' || superA);
    openSheet(m.full_name, `
        ${m.avatar_url ? `<img class="member-photo" src="${esc(m.avatar_url)}" alt="">` : ''}<div class="tags" style="margin:0 0 10px">${m.user_id ? '<span class="badge ok">On the app</span>' : '<span class="badge">Not on the app yet</span>'}${roleBadge(m)}${isNewMember(m) ? '<span class="badge new-tag">New Member</span>' : ''}</div>
        <dl class="facts">
            <dt>WhatsApp</dt><dd>${esc(m.phone || '–')}</dd><dt>Email</dt><dd>${esc(m.email || '–')}${m.move_from && !m.user_id ? '<br><span class="small muted">Email changed: waiting for them to sign in with it</span>' : ''}</dd>
            <dt>Birthday</dt><dd>${m.dob ? fmtDayMonth(m.dob) : '–'}</dd>
            <dt>Blood group</dt><dd>${esc(m.blood_group || '–')}</dd><dt>Locality</dt><dd>${esc(m.locality || '–')}</dd>
            <dt>Hometown</dt><dd>${esc(m.hideout || '–')}</dd><dt>Emergency</dt><dd>${esc(m.emergency_phone || '–')}</dd>
            <dt>Joined</dt><dd>${m.joined_at ? fmtDate(String(m.joined_at).slice(0, 10)) : '–'}</dd>
        </dl>
        ${(() => { const fl = (state.famAll || []).filter(f => f.member?.id === m.id); return fl.length ? `<h3 class="group-title">RWB FAM <span class="small muted" style="text-transform:none;letter-spacing:0">${fl.length} of ${FAM_MAX}</span></h3><div class="list ms-fam">${fl.map(famAdminCard).join('')}</div>` : ''; })()}
        ${extraAnswers(m).length ? `<details class="answers" style="margin:-6px 0 12px"><summary>Other join-form answers (${extraAnswers(m).length})</summary><div class="group" style="margin-top:8px">${answerRows(m, false)}</div></details>` : ''}
        <p class="small muted" style="margin:2px 0 6px">Bikes · check each VRN, then mark it verified</p>
        <div class="group bikes" style="margin-bottom:12px">${bikeRows(m, (m.member_bikes || []).slice().sort((a, b) => a.slot - b.slot), true)}</div>
        <div class="btns" style="margin-bottom:10px">${m.phone ? `<a class="btn wa" href="${waTo(m.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button class="btn ghost" data-x="edit">Edit details</button></div>
        ${!self && m.role !== 'superadmin' && (m.role !== 'admin' || superA) ? `<div class="btns" style="margin-bottom:10px">
            ${m.role === 'admin' ? '' : `<button class="btn ghost" data-x="role" data-to="${m.role === 'coordinator' ? 'member' : 'coordinator'}">${m.role === 'coordinator' ? 'Remove coordinator' : 'Make coordinator'}</button>`}
            ${superA ? `<button class="btn ghost" data-x="role" data-to="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Remove admin rights' : 'Make admin'}</button>` : ''}</div>
            <p class="small muted" style="margin:-4px 0 12px">Coordinators can approve, reject and delete MotoMart posts. They can't manage members.</p>` : ''}
        ${canRemove ? `<button class="btn danger block" data-x="remove">Remove from RWB</button><p class="small muted" style="margin-top:6px">Use when someone leaves the RWB WhatsApp community. Deletes their profile${m.user_id ? ', app account, service records, fuel log and bills' : ''}, and their row in the RWB contact sheet (a copy goes to its “Removed members” tab). This can't be undone in the app.</p>` : ''}`, body => {
        bindFamRemove(body, () => { closeSheet(); state.adminMembers && adminMembers(); });
        body.querySelector('[data-x=edit]').onclick = () => memberEdit(m);
        body.querySelectorAll('[data-x=vv]').forEach(btn => btn.onclick = () => {
            const slot = Number(btn.dataset.slot), b = (m.member_bikes || []).find(x => x.slot === slot), now = slot === 1 ? !m.vrn_verified : !b?.verified;
            busy(btn, async () => { await api.admin.setVrnVerified(m.id, slot, now); if (slot === 1) m.vrn_verified = now; else b.verified = now; state.dir = null; toast(now ? 'VRN verified' : 'Marked as not verified'); memberSheet(m); });
        });
        body.querySelectorAll('[data-x=role]').forEach(role => role.onclick = () => {
            const to = role.dataset.to;
            if (to !== 'member' && !m.user_id && !confirmBox(`${m.full_name} hasn't signed in to the app yet. They'll get ${ROLE[to].toLowerCase()} rights when they do. Continue?`)) return;
            busy(role, async () => { await api.admin.setRole(m.id, to); m.role = to; state.dir = null; toast(to === 'member' ? 'Role removed' : `Now ${to === 'admin' ? 'an admin' : 'a coordinator'}`); memberSheet(m); adminMembers(); });
        });
        const rm = body.querySelector('[data-x=remove]');
        if (rm) rm.onclick = () => removeSheet(m);
    });
}
function removeSheet(m) {
    openSheet(`Remove ${firstName(m)}?`, `<form id="rmf">
        <fieldset><legend>Why?</legend>
            <label class="wish-opt"><input type="radio" name="why" value="left" checked><span><b>Left the group</b><span class="wish-prev">They left the RWB WhatsApp group or asked to leave</span></span></label>
            <label class="wish-opt"><input type="radio" name="why" value="removed"><span><b>Removed by admin</b><span class="wish-prev">The RWB team removed them</span></span></label></fieldset>
        <label>Note <span class="hint">(optional, only admins see it)</span><input name="note" maxlength="200" placeholder="e.g. Moved to Bangalore"></label>
        <div class="warn">${m.user_id ? 'Their app account, service records, bills, fuel log, documents and MotoMart posts are <b>deleted</b>. ' : ''}Their row is removed from the RWB contact sheet (a copy goes to its “Removed members” tab). Their name stays here under <b>Left / removed</b>, and you can restore them any time.</div>
        <label>Type <b>REMOVE</b> to confirm<input name="ok" autocomplete="off" autocapitalize="characters"></label>
        <button class="btn danger block">Remove ${esc(firstName(m))}</button></form>`, body => {
        const f = body.querySelector('#rmf');
        f.onsubmit = e => {
            e.preventDefault();
            if (f.ok.value.trim().toUpperCase() !== 'REMOVE') { toast('Type REMOVE to confirm', true); return; }
            const why = f.why.value, note = f.note.value.trim();
            busy(e.submitter, async () => { await api.admin.remove(m.id, m.user_id, why, note); state.adminMembers = null; closeSheet(); toast(`${m.full_name} moved to Left / removed`); state.dir = null; state.board = null; render(); });
        };
    });
}
function goneSheet(m) {
    openSheet(m.full_name, `
        <div class="gone-card ${m.status}"><b>${GONE_TXT[m.status]}${m.removed_at ? ' on ' + fmtDate(String(m.removed_at).slice(0, 10)) : ''}</b>
            <span>${m.removed_by ? `By ${esc(m.removed_by)}` : ''}${m.removed_note ? `${m.removed_by ? ' · ' : ''}“${esc(m.removed_note)}”` : ''}</span></div>
        <dl class="facts">
            <dt>WhatsApp</dt><dd>${esc(m.phone || '–')}</dd><dt>Email</dt><dd>${esc(m.email || '–')}</dd>
            <dt>Bike</dt><dd>${esc([m.bike, m.vrn].filter(Boolean).join(' · ') || '–')}</dd><dt>Locality</dt><dd>${esc(m.locality || '–')}</dd>
            <dt>Joined</dt><dd>${m.joined_at ? fmtDate(String(m.joined_at).slice(0, 10)) : '–'}</dd>
        </dl>
        <button class="btn block" data-x="restore">Restore to RWB</button>
        <p class="small muted" style="margin-top:8px">Adds them back to the member list and the RWB contact sheet with a <b>New Member</b> tag. If they had the app, they sign in again and an admin approves them. People who register again through the form or the app are restored automatically.</p>`, body => {
        body.querySelector('[data-x=restore]').onclick = e => busy(e.target, async () => { await api.admin.restore(m.id); state.adminMembers = null; state.dir = null; closeSheet(); toast(`${m.full_name} restored`); render(); });
    });
}
function memberEdit(m) {
    openSheet('Edit ' + firstName(m), `<form id="ae">
        ${joinFields(m, 'admin')}
        <button class="btn block">Save</button></form>`, body => {
        body.querySelector('#ae').onsubmit = e => {
            e.preventDefault();
            const d = joinData(e.target), err = joinCheck(d, 'admin');
            if (err) return toast(err, true);
            if (!d.dob && m.dob?.startsWith('1904')) delete d.dob;   /* keep a "year unknown" birthday */
            if ('email' in d) {
                d.email = d.email.replace(/\s/g, '').toLowerCase();
                if (!d.email && m.user_id) return toast('They\'re on the app, so they need an email', true);
            }
            const emailChanged = 'email' in d && d.email !== String(m.email || '').toLowerCase();
            const self = m.user_id && m.user_id === state.me.user_id;
            if (emailChanged && m.user_id && !confirmBox(`Change ${self ? 'your' : firstName(m) + "'s"} email to ${d.email}?\n\n${self ? 'You' : firstName(m)} will be signed out of the RWB App and must sign in with ${d.email}. ${self ? 'Your' : 'Their'} records and role come along.`)) return;
            busy(e.submitter, async () => {
                const r = await api.admin.update(m.id, d);
                Object.assign(m, d, { phone: d.phone.replace(/\D/g, '').slice(-10), dob: d.dob || null, email: d.email || null });
                if (r === 'moved') { if (self) return location.reload(); m.move_from = m.user_id; m.user_id = null; }
                toast(r === 'moved' ? `Saved. ${firstName(m)} is signed out; ask them to sign in with ${d.email}` : 'Saved'); state.dir = null; memberSheet(m); adminMembers();
            });
        };
    });
}
async function adminBdays() {
    state.bdays = await api.birthdays(7);
    const today = state.bdays.filter(b => b.day === todayISO()), later = state.bdays.filter(b => b.day !== todayISO());
    const personal = b => `Happy Birthday ${firstName(b)}! 🎂 Have a fantastic day and many more miles ahead. — RWB 🧡`;
    $('#admin-body').innerHTML = `
        <div class="card bday"><h3>Today</h3>${today.length ? `<ul>${today.map(b => `<li class="row" style="justify-content:space-between;margin:6px 0"><span>${esc(b.full_name)}</span>${b.phone ? `<a class="btn sm ghost" href="${waTo(b.phone, personal(b))}" target="_blank" rel="noopener">Message</a>` : ''}</li>`).join('')}</ul>
            <p class="small muted" style="margin-bottom:10px">“Wish in group” opens WhatsApp with the message ready. Pick the RWB community, then type @ and their name to tag them before sending.</p>
            <button class="btn wa block" data-act="wish">Wish in group on WhatsApp</button>` : '<p class="muted">No birthdays today.</p>'}</div>
        <section class="section"><h2>Next 7 days</h2>${later.length ? `<div class="list">${later.map(b => `<div class="card row"><div class="grow"><b>${esc(b.full_name)}</b><p class="small muted">${fmtDayMonth(b.day)}</p></div></div>`).join('')}</div>` : '<p class="muted">None in the coming week.</p>'}</section>`;
}

/* Running inside the downloaded Android app (APK)? Android tells the page once, at launch; remember it. */
const isTWA = () => { try { if (document.referrer.startsWith('android-app://in.roninwb.app')) localStorage.setItem('rwb-twa', '1'); return localStorage.getItem('rwb-twa') === '1'; } catch { return false; } };
isTWA();

/* =================== Theme =================== */
const getTheme = () => { try { return localStorage.getItem('rwb-theme') || 'light'; } catch { return 'light'; } };
function setTheme(t) {
    try { localStorage.setItem('rwb-theme', t); } catch { /* ignore */ }
    document.documentElement.dataset.theme = t;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const m = document.getElementById('theme-color'); if (m) m.content = dark ? '#0b0908' : '#fbf3ec';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => getTheme() === 'system' && setTheme('system'));

/* =================== Push notifications =================== */
const pushSupported = () => NATIVE || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function enablePush() {
    if (NATIVE) { await nativePushOn(true); try { localStorage.setItem('rwb-push-dismissed', '1'); } catch { /* ignore */ } return; }
    if (!pushSupported()) throw new Error(isIOS() ? 'On iPhone: first add RWB to your Home Screen (Share → Add to Home Screen), open it from there, then turn on notifications.' : 'This browser does not support notifications. Try Chrome.');
    if (!C.VAPID_PUBLIC_KEY) throw new Error('Notifications are not set up yet.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { drawPushState(); throw new Error(isTWA() ? 'Notifications are off for the RWB app. See the steps on the Me page.' : 'Notifications are blocked. See the steps on the Me page.'); }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(C.VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    await api.savePush(j.endpoint, j.keys.p256dh, j.keys.auth);
}
async function disablePush(quiet = false) {
    if (NATIVE) { let t = null; try { t = localStorage.getItem(FCM_KEY); } catch { /* ignore */ } if (t) await api.deleteFcm(t).catch(e => { if (!quiet) throw e; }); await Native('PushNotifications').unregister().catch(() => {}); try { localStorage.removeItem(FCM_KEY); } catch { /* ignore */ } return; }
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return;
    const sub = await reg.pushManager.getSubscription(); if (!sub) return;
    await api.deletePush(sub.endpoint).catch(e => { if (!quiet) throw e; });
    await sub.unsubscribe();
}
/* what the phone reports about notifications: a screenshot of this tells us exactly what's wrong */
async function pushDetails() {
    const out = [];
    try {
        out.push(`Inside RWB app: ${isTWA() ? 'yes' : 'no'} (opened from: ${document.referrer || 'nothing'})`);
        out.push(`Full-screen app mode: ${isStandalone() ? 'yes' : 'no'}`);
        out.push(`Notification permission: ${'Notification' in window ? Notification.permission : 'not supported'}`);
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
        out.push(`Service worker: ${reg ? 'ready' : 'missing'}`);
        if (reg?.pushManager) {
            out.push(`Push permission: ${await reg.pushManager.permissionState({ userVisibleOnly: true }).catch(e => 'error ' + e.message)}`);
            out.push(`Subscribed: ${(await reg.pushManager.getSubscription()) ? 'yes' : 'no'}`);
        }
        out.push(`Browser: ${(navigator.userAgent.match(/(Chrome|SamsungBrowser|Firefox|Version)\/[\d.]+/g) || []).join(', ')}`);
    } catch (e) { out.push('error: ' + e.message); }
    return out.join('\n');
}
async function drawPushState() {
    const st = $('#push-state'), btn = $('#push-btn'); if (!st) return;
    if (NATIVE) {
        const p = await Native('PushNotifications').checkPermissions().catch(() => ({ receive: 'prompt' }));
        let tok = null; try { tok = localStorage.getItem(FCM_KEY); } catch { /* ignore */ }
        const on = p.receive === 'granted' && !!tok;
        st.textContent = p.receive === 'denied' ? 'Notifications are off for the RWB app. Turn them on in Settings → Apps → RWB → Notifications, then tap Turn on.' : on ? 'On for this phone (RWB app).' : 'Off for this phone.';
        btn.innerHTML = on ? `<div class="btns">${isAdmin() ? '<button class="btn sm ghost" data-act="push-test">Send test</button>' : ''}<button class="btn sm ghost" data-act="push-off">Turn off</button></div>` : '<button class="btn block" data-act="push-on">Turn on notifications</button>';
        return;
    }
    pushDetails().then(t => { const c = $('#notif-card'); if (!c) return; c.querySelector('details.tech')?.remove(); c.insertAdjacentHTML('beforeend', `<details class="tech"><summary>Notification details</summary><pre class="diag">${esc(t)}</pre></details>`); });
    let on = false;
    if (pushSupported()) { const reg = await navigator.serviceWorker.getRegistration(); on = !!(reg && await reg.pushManager.getSubscription()) && Notification.permission === 'granted'; }
    if (!pushSupported()) { st.textContent = isIOS() && !isStandalone() ? 'On iPhone, notifications work after you add RWB to your Home Screen and open it from there.' : 'This browser does not support notifications.'; btn.innerHTML = ''; return; }
    if (Notification.permission === 'denied') {
        st.innerHTML = 'Notifications are blocked on this phone. The app can\'t ask again, so allow them once in your settings:';
        if (isTWA()) {
            btn.innerHTML = `<ol class="steps"><li>Open phone <b>Settings → Apps → RWB → Notifications</b></li><li>Turn on <b>Allow notifications</b> and also <b>every category</b> listed under it (tap <b>Notification categories</b> if you see it)</li><li>Go back to <b>App info</b> and tap <b>Force stop</b>. The app only checks this setting when it starts.</li><li>Open RWB again and come back here</li></ol>
                <p class="small muted" style="margin-top:8px">Nothing to change in Chrome: the RWB app handles its own notifications.</p>
                <button class="btn sm" data-act="push-on" style="margin-top:10px">I've allowed it, try again</button>`;
            return;
        }
        btn.innerHTML = isIOS() ? `<ol class="steps"><li>Open iPhone <b>Settings → Notifications</b></li><li>Find <b>RWB</b> and turn on <b>Allow Notifications</b></li><li>Come back here and tap <b>Turn on</b></li></ol><button class="btn sm" data-act="push-on" style="margin-top:10px">Turn on</button>`
            : `<p class="small" style="margin:4px 0 6px"><b>Using the RWB Android app</b></p><ol class="steps"><li>Open phone <b>Settings → Apps → RWB → Notifications</b></li><li>Turn on <b>Allow notifications</b></li></ol>
               <p class="small" style="margin:12px 0 6px"><b>Using Chrome</b></p><ol class="steps"><li>Tap the icon left of <b>roninwb.in</b> in the address bar</li><li><b>Permissions → Notifications → Allow</b></li></ol>
               <p class="small muted" style="margin-top:10px">Then close and reopen the app, and come back to this page.</p>`;
        return;
    }
    st.textContent = on ? 'On for this phone.' : 'Off for this phone.';
    btn.innerHTML = on ? `<div class="btns">${isAdmin() ? '<button class="btn sm ghost" data-act="push-test">Send test</button>' : ''}<button class="btn sm ghost" data-act="push-off">Turn off</button></div>` : '<button class="btn block" data-act="push-on">Turn on notifications</button>';
}

/* =================== Announcements =================== */
const STICKY = n => n.kind === 'announcement' || n.kind === 'event';   /* only admins can remove these */
const KIND_ICON = { event: ICON.cal, announcement: ICON.mega, birthday: ICON.cake, motomart: ICON.cart, member: ICON.bike, admin: ICON.approve, personal: ICON.profile, sos: ICON.alert, reminder: ICON.cal, track: ICON.pin, rsvp: ICON.cal };
function shortAgo(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
    const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function timeAgo(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const linkify = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');
function newsCard(n, del = false) {
    const go = n.url && n.url !== '#news' && n.url.startsWith('#');
    return `<article class="card news ${n.kind}"><div class="row" style="align-items:flex-start"><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || ICON.mega}</span>
        <div class="grow"><h3>${esc(n.title)}</h3>${n.body ? `<p>${linkify(n.body)}</p>` : ''}
        <p class="small muted" style="margin-top:6px">${timeAgo(n.created_at)}${n.audience === 'admins' ? ' · admins only' : n.audience === 'moderators' ? ' · team only' : ''}${go ? ` · <a href="${esc(safeUrl(n.url))}">Open</a>` : ''}</p></div>
        ${del ? `<button class="icon-btn" data-act="del-news" data-id="${n.id}" aria-label="Delete">🗑</button>` : ''}</div></article>`;
}
async function viewNews() {
    const all = await load.news(true);
    try { if (all[0]) localStorage.setItem('rwb-news-seen', String(Math.max(...all.map(n => n.id)))); } catch { /* ignore */ }
    const news = visibleNews(all);
    const canClear = news.length > 0;
    app.innerHTML = top('News') + `
        ${isAdmin() ? `<details class="howto" style="margin-bottom:6px"><summary>Post an announcement</summary>
            <form id="ann" style="padding-bottom:16px"><label>Title<input name="title" required maxlength="120" placeholder="e.g. Sunday breakfast ride"></label>
            <label>Message<textarea name="body" maxlength="1000" placeholder="Meeting point, time, anything members should know"></textarea></label>
            <p class="small muted">Goes to everyone's feed and as a notification to every phone that has them on.</p>
            <button class="btn block">Send to all members</button></form></details>` : ''}
        <section class="section">${news.length ? `<div class="news-bar"><p class="small muted swipe-hint">Swipe an alert left or right to hide it.</p>${canClear ? '<button class="clear-all" data-act="clear-news">Clear all</button>' : ''}</div><div class="group">${news.map(n => newsRow(n, isAdmin())).join('')}</div>` : `<div class="card empty"><b>${all.length ? 'All caught up' : 'No news yet'}</b>${isFam() ? 'Important announcements from the RWB admins show up here.' : 'Announcements, birthdays and new MotoMart posts show up here.'}</div>`}</section>`;
    swipeToDismiss(app, () => { if (!app.querySelector('[data-swipe]')) render(); });
    actions = {
        'clear-news': () => clearNews(all), 'del-news': b => { if (confirmBox('Delete this from the feed?')) busy(b, async () => { await api.deleteNews(Number(b.dataset.id)); render(); }); } };
    const f = $('#ann');
    if (f) f.onsubmit = e => {
        e.preventDefault(); const d = Object.fromEntries(new FormData(f));
        if (!confirmBox(`Send “${d.title}” to all members?`)) return;
        busy(e.submitter, async () => { await api.announce(d.title.trim(), d.body.trim()); toast('Announcement sent'); render(); });
    };
}

const ICON_CLEAR = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11M3 12h8M3 18h6"/><path d="m15 14 5 5m0-5-5 5"/></svg>';

/* =================== MotoMart ===================
   One shop, three kinds of post (setup file 65):
   - used:  members sell their own gear; an admin or coordinator approves it; buyers WhatsApp the seller
   - new:   new accessories listed by admins/coordinators with a link to the store ("Check product")
   - merch: RWB merch listed by admins/coordinators
   Sold used posts are greyed out and deleted (with photos) 15 days later. roninwb.in shows new accessories and merch. */
const CONDITIONS = ['Brand new (unused)', 'Like new', 'Good', 'Fair', 'Needs repair'];
/* MotoMart categories (Nov 21 2026): one fixed list in groups, each with its own icon. No "Other": every post picks one of these.
   [name, short name for the round tiles (blank = the part before " and " or ","), icon] */
const MM_GROUPS = [
    ['Helmets and riding gear', [
        ['Helmets', '', '<path d="M3.5 15.5a8.5 8.5 0 0 1 17 0v1.5h-17z"/><path d="M12 7v5.5h8.3M3.5 17l1 2.5h7"/>'],
        ['Visors, pinlocks and helmet parts', '', '<path d="M4 14a8 8 0 0 1 16 0"/><path d="M6.5 11.5h11a1.5 1.5 0 0 1 0 3h-11a1.5 1.5 0 0 1 0-3z"/>'],
        ['Riding jackets', '', '<path d="M8.5 3.5 12 6l3.5-2.5L20 6.5 18 11l-1.5-.8V20.5h-9V10.2L6 11 4 6.5z"/><path d="M12 6v14.5"/>'],
        ['Riding pants', '', '<path d="M7 3h10l1 18h-4.5L12 10l-1.5 11H6z"/><path d="M7 6.5h10"/>'],
        ['Riding gloves', '', '<path d="M8 21v-3.5L5.6 14a1.5 1.5 0 0 1 2.3-1.9L9 13.3V5.5a1.3 1.3 0 0 1 2.6 0V11V4.3a1.3 1.3 0 0 1 2.6 0V11V5.3a1.3 1.3 0 0 1 2.6 0V12V8.5a1.3 1.3 0 0 1 2.6 0v5.5c0 3-1.5 4.8-3.5 5.8V21z"/>'],
        ['Riding boots', '', '<path d="M6 3h7v9.5l5.5 3a2.5 2.5 0 0 1 1.5 2.3V20H6z"/><path d="M6 17h14M6 7h7"/>'],
        ['Rain gear', '', '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0M12 3v-.5"/>'],
        ['Base layers and balaclavas', '', '<path d="M12 3a7 7 0 0 0-7 7v6c0 2.8 3 5 7 5s7-2.2 7-5v-6a7 7 0 0 0-7-7z"/><path d="M7.5 10.5h9v2.5h-9z"/>'],
        ['Body armour and knee guards', '', '<path d="M8 3h8v6a4 4 0 0 1-8 0z"/><path d="M8.5 13.5 8 21h8l-.5-7.5"/><circle cx="12" cy="8.5" r="1.8"/>']]],
    ['Communication and electronics', [
        ['Mesh intercoms', '', '<rect x="8" y="10" width="8" height="10" rx="2"/><path d="M12 13.5v3.5M8.5 7a5 5 0 0 1 7 0M5.5 4.5a9 9 0 0 1 13 0"/>'],
        ['Bluetooth headsets', '', '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>'],
        ['Navigation screens and GPS', '', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="m10 12.5 5-3-2 4.5-.8-1.7z"/><path d="M12 16v4M8.5 20h7"/>'],
        ['Phone mounts', '', '<rect x="7.5" y="3.5" width="9" height="15" rx="1.8"/><path d="M5 7V5a2 2 0 0 1 2-2M19 7V5a2 2 0 0 0-2-2M5 15v2a2 2 0 0 0 2 2M19 15v2a2 2 0 0 1-2 2M12 19v2.5M8 21.5h8M10.5 16h3"/>'],
        ['Chargers and USB sockets', '', '<path d="M9 3v4M15 3v4M6.5 7h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 15.5V21"/>'],
        ['Action cameras and dashcams', '', '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M7 7l1.5-2.5h4L14 7"/>'],
        ['Tyre pressure monitors (TPMS)', 'TPMS', '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 3.5-4"/><circle cx="12" cy="13" r="1.3"/><path d="M8 20h8"/>'],
        ['GPS trackers and alarms', '', '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>']]],
    ['Bike protection', [
        ['Crash guards', '', '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>'],
        ['Bash plates and sump guards', '', '<path d="M3 9h18l-2.5 7.5a2 2 0 0 1-1.9 1.5H7.4a2 2 0 0 1-1.9-1.5z"/><path d="M8 12.5h.01M12 12.5h.01M16 12.5h.01"/>'],
        ['Frame and engine sliders', 'Sliders', '<ellipse cx="12" cy="7.5" rx="6" ry="2.5"/><path d="M6 7.5v8.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7.5M12 10v11"/>'],
        ['Radiator and headlight grills', 'Grills', '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>'],
        ['Tank pads and tank grips', '', '<path d="M5 9c0-3 3-5 7-5s7 2 7 5c0 6-3.5 11-7 11S5 15 5 9z"/><path d="M9 8.5v6M12 8v8M15 8.5v6"/>'],
        ['Bike covers', '', '<path d="M3 18c0-6 4-11 9-11s9 5 9 11z"/><path d="M3 18h18M12 7V4.5"/>']]],
    ['Luggage and touring', [
        ['Saddle bags and saddle stays', '', '<rect x="3" y="8" width="7" height="11" rx="2"/><rect x="14" y="8" width="7" height="11" rx="2"/><path d="M10 10h4M3 12.5h7M14 12.5h7"/>'],
        ['Tail bags', '', '<rect x="3" y="9" width="18" height="10" rx="3"/><path d="M8 9V6.5h8V9M9 9v10M15 9v10"/>'],
        ['Tank and handlebar bags', 'Tank bags', '<path d="M5 10a7 3 0 0 1 14 0v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 13.5h8M12 10V7"/>'],
        ['Top boxes and top racks', '', '<rect x="4" y="4" width="16" height="11" rx="3"/><path d="M4 9h16M10.5 11.5h3M7 15v4M17 15v4M5 19h14"/>'],
        ['Backpacks and hydration packs', '', '<path d="M6 10a6 6 0 0 1 12 0v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9 4.5V3h6v1.5M9 14h6v4H9z"/>'],
        ['Bungee cords and cargo nets', '', '<path d="M7 3v3a2 2 0 0 1-4 0M17 21v-3a2 2 0 0 1 4 0M7 6c0 6 10 6 10 12"/>'],
        ['Jerry cans and fuel bottles', '', '<path d="M6 6h7l5 5v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path d="M15 3h3v3M9 11l5 5M14 11l-5 5"/>']]],
    ['Lights and horns', [
        ['Fog and auxiliary lights', 'Fog lights', '<circle cx="9" cy="12" r="5.5"/><path d="M17 8.5h4M17 12h4M17 15.5h4"/>'],
        ['Headlight and indicator bulbs', 'Bulbs', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'],
        ['Horns', '', '<path d="M3 10v4h3l9 5V5L6 10z"/><path d="M18.5 9a4 4 0 0 1 0 6"/>']]],
    ['Comfort and controls', [
        ['Handlebars and risers', '', '<path d="M3 8c2 0 3 1 4 3h10c1-2 2-3 4-3"/><path d="M10 11v4h4v-4M12 15v5"/>'],
        ['Grips and bar-end weights', '', '<rect x="3" y="9" width="12" height="6" rx="2"/><path d="M6.5 9v6M9 9v6M11.5 9v6M15 12h3"/><rect x="18" y="10" width="3" height="4" rx="1"/>'],
        ['Seats and seat covers', '', '<path d="M3 13c2-3 5-3 8-2s6 1 10 0c0 3-2 5-5 5H7c-2.5 0-4-1.3-4-3z"/><path d="M7 16v3M16 16v3"/>'],
        ['Windscreens and wind visors', '', '<path d="M7 21 5 8c0-3 3-5 7-5s7 2 7 5l-2 13z"/><path d="M8.5 8.5c1-1.5 2.3-2 3.5-2"/>'],
        ['Footpegs and foot rests', '', '<rect x="3" y="10" width="13" height="4" rx="2"/><path d="M6.5 10v4M9.5 10v4M12.5 10v4M16 12h5M19 9v6"/>'],
        ['Mirrors', '', '<ellipse cx="14" cy="8" rx="6" ry="4.5"/><path d="M10 11.5 5 20M3.5 20h3"/>'],
        ['Levers', '', '<path d="M3 9h6l11 4.5a1.5 1.5 0 0 1-.6 2.9L8 14H3z"/><circle cx="6" cy="11.5" r="1"/>'],
        ['Throttle locks and cruise control', '', '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 8.5 8.5M12 3.5v2M20.5 12h-2M3.5 12h2"/><circle cx="12" cy="12" r="1"/>']]],
    ['Looks', [
        ['Stickers and decals', '', '<path d="M20 12.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7.5z"/><path d="M12.5 20c0-4.1 3.4-7.5 7.5-7.5"/>'],
        ['Number plates and frames', '', '<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M6 12h3M11 12h2.5M15.5 12h2.5"/>']]],
    ['Maintenance and spares', [
        ['Tyres and tubes', '', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 3.5V8M12 16v4.5M3.5 12H8M16 12h4.5"/>'],
        ['Chain and sprockets', '', '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5M5.3 5.3l2.5 2.5M16.2 16.2l2.5 2.5M5.3 18.7l2.5-2.5M16.2 7.8l2.5-2.5"/>'],
        ['Brake pads and discs', '', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 6.2h.01M17.8 12h.01M12 17.8h.01M6.2 12h.01"/>'],
        ['Engine oil and filters', '', '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>'],
        ['Batteries', '', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M6.5 7V5h3v2M14.5 7V5h3v2M6.5 13.5h3M15 12v3M13.5 13.5h3"/>'],
        ['Exhausts', '', '<rect x="6" y="8.5" width="13" height="7" rx="3.5"/><path d="M2.5 14H6M19 12h2.5M10 8.5v7"/>'],
        ['Cleaning and care', '', '<path d="M9 9h5v2.5a2 2 0 0 0 1 1.7 2 2 0 0 1 1 1.8V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5a2 2 0 0 1 1-1.8 2 2 0 0 0 1-1.7z"/><path d="M9 9V6h6l-2 3M18 5h.01M20 7h.01M18 9h.01"/>'],
        ['Tools and puncture kits', '', '<path d="M14.7 6.3a4 4 0 0 1 5.2-1.6L17 7.6 18.4 9l2.9-2.9a4 4 0 0 1-5.6 5.2L7 20a2 2 0 0 1-3-3l8.7-8.7a4 4 0 0 1 2-2z"/>'],
        ['Locks and security', '', '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11M12 15v2"/>'],
        ['First aid kits', '', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M12 10.5v6M9 13.5h6"/>'],
        ['Paddock stands', '', '<path d="M4 20 8 8h8l4 12M8 8V5M16 8V5M6 14h12"/>'],
        ['Other spare parts', '', '<path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>']]]
];
const MERCH_GROUP = [
    ['Clothing', '', '<path d="M8.5 3.5 12 5l3.5-1.5L21 7l-2 4-2-1v10.5H7V10l-2 1-2-4z"/>'],
    ['Stickers', '', '<path d="M20 12.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7.5z"/><path d="M12.5 20c0-4.1 3.4-7.5 7.5-7.5"/>'],
    ['Keychains and patches', '', '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 19 4M16 7l2 2M14 9l1.5 1.5"/>'],
    ['Accessories', '', '<path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1l8.9 8.9-8.1 8.1z"/><circle cx="8" cy="8" r="1.5"/>']];
const MM_CATS = MM_GROUPS.flatMap(([, items]) => items.map(i => i[0]));
const MERCH_CATS = MERCH_GROUP.map(i => i[0]);
const MM_SHORT = Object.fromEntries([...MM_GROUPS.flatMap(([, items]) => items), ...MERCH_GROUP].map(([n, s]) => [n, s || n.split(/ and |, /)[0]]));
const MM_KIND = { used: 'Pre-owned', new: 'New', merch: 'RWB Merch' };
const SOLD_DAYS = 15;
const mmState = { branch: 'all', cat: 'all', sort: 'price-asc', q: '', mine: false, review: false, swept: false };
const price = n => Number(n) === 0 ? 'Free' : '₹' + Number(n).toLocaleString('en-IN');
/* a "Coming soon" merch post has no price yet: it shows "Coming soon" and can't be ordered */
const soon = l => kindOf(l) === 'merch' && !!l.coming_soon;
const lprice = l => soon(l) ? 'Coming soon' : price(l.price);
const photo = (l, i = 0) => l.photos?.[i] ? api.photoUrl(l.photos[i]) : i === 0 && l.image_url ? l.image_url : '';
/* grids, strips and search show the small preview copy; if a post has none yet, the full photo (Nov 2026) */
const thumb = l => l.photos?.[0] ? (api.thumbUrl ? api.thumbUrl(l.photos[0]) : api.photoUrl(l.photos[0])) : l.image_url || '';
const thumbImg = (l, cls = '') => { const t = thumb(l), f = photo(l); return t ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(t)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="if(this.dataset.f||'${esc(f)}'===this.getAttribute('src'))this.remove();else{this.dataset.f=1;this.src='${esc(f)}'}">` : ''; };
const allPhotos = l => l.photos?.length ? l.photos.map(p => api.photoUrl(p)) : l.image_url ? [l.image_url] : [];
const mine = l => l.user_id === state.myId;
const kindOf = l => l.kind || 'used';
const soldAt = l => new Date(l.sold_at || l.updated_at || l.published_at || l.created_at || Date.now());
const goneOn = l => new Date(soldAt(l).getTime() + SOLD_DAYS * 864e5);
const expired = l => kindOf(l) === 'used' && l.status === 'sold' && goneOn(l) < new Date();
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/* Every post's category is one of MM_CATS (merch: MERCH_CATS). Old posts with older names are shown under the closest new one. */
const CAT_OLD = [[/mesh/, 'Mesh intercoms'], [/headset|bluetooth/, 'Bluetooth headsets'], [/intercom/, 'Mesh intercoms'], [/visor|pinlock/, 'Visors, pinlocks and helmet parts'], [/helmet/, 'Helmets'],
    [/pant|trouser/, 'Riding pants'], [/glove/, 'Riding gloves'], [/boot|shoe/, 'Riding boots'], [/rain/, 'Rain gear'], [/balaclava|base layer/, 'Base layers and balaclavas'], [/armou?r|knee|elbow/, 'Body armour and knee guards'],
    [/jacket|riding gear|apparel|suit|jersey/, 'Riding jackets'], [/tracker|alarm/, 'GPS trackers and alarms'], [/navig|gps|electr/, 'Navigation screens and GPS'], [/mount|phone/, 'Phone mounts'], [/charg|usb/, 'Chargers and USB sockets'],
    [/camera|dashcam/, 'Action cameras and dashcams'], [/tpms|pressure/, 'Tyre pressure monitors (TPMS)'], [/cover/, 'Bike covers'], [/bash|sump/, 'Bash plates and sump guards'], [/slider/, 'Frame and engine sliders'],
    [/grill/, 'Radiator and headlight grills'], [/tank ?(pad|grip)/, 'Tank pads and tank grips'], [/crash|guard|protect|frame/, 'Crash guards'], [/saddle|pannier/, 'Saddle bags and saddle stays'], [/tank ?bag|handlebar bag|bar bag/, 'Tank and handlebar bags'],
    [/top ?box|rack/, 'Top boxes and top racks'], [/backpack|hydration/, 'Backpacks and hydration packs'], [/bungee|cargo|net\b/, 'Bungee cords and cargo nets'], [/jerry|fuel/, 'Jerry cans and fuel bottles'],
    [/fog|aux/, 'Fog and auxiliary lights'], [/light|lamp|bulb|indicator/, 'Headlight and indicator bulbs'], [/horn/, 'Horns'], [/handle ?bar|riser/, 'Handlebars and risers'], [/grip|bar.?end/, 'Grips and bar-end weights'],
    [/seat/, 'Seats and seat covers'], [/windscreen|windshield/, 'Windscreens and wind visors'], [/peg|foot/, 'Footpegs and foot rests'], [/mirror/, 'Mirrors'], [/lever/, 'Levers'], [/throttle|cruise/, 'Throttle locks and cruise control'],
    [/sticker|decal/, 'Stickers and decals'], [/number|plate/, 'Number plates and frames'], [/tyre|tire|tube/, 'Tyres and tubes'], [/chain|sprocket/, 'Chain and sprockets'], [/brake|disc/, 'Brake pads and discs'],
    [/oil|filter/, 'Engine oil and filters'], [/batter/, 'Batteries'], [/exhaust|silencer/, 'Exhausts'], [/clean|wash|polish|lube/, 'Cleaning and care'], [/tool|puncture/, 'Tools and puncture kits'], [/lock/, 'Locks and security'],
    [/first aid/, 'First aid kits'], [/stand/, 'Paddock stands'], [/luggage|bag/, 'Tail bags'], [/spare|part|accessor/, 'Other spare parts']];
function catGroup(l) {
    const c = String(typeof l === 'string' ? l : l.category || '').trim();
    const k = c.toLowerCase();
    if (typeof l !== 'string' && kindOf(l) === 'merch') return MERCH_CATS.find(x => x.toLowerCase() === k) || (/key|patch/.test(k) ? 'Keychains and patches' : c || 'Accessories');
    return MM_CATS.find(x => x.toLowerCase() === k) || CAT_OLD.find(([re]) => re.test(k))?.[1] || c || 'Other spare parts';
}
const S = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const CAT_ICO = {
    all: S('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    other: S('<path d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1l8.9 8.9-8.1 8.1z"/><circle cx="8" cy="8" r="1.5"/>'),
    ...Object.fromEntries([...MM_GROUPS.flatMap(([, items]) => items), ...MERCH_GROUP].map(([n, , p]) => [n, S(p)]))
};
const catIco = c => CAT_ICO[c] || CAT_ICO.other;
const SEARCH_ICO = S('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>');

function listingCard(l) {
    const img = photo(l), k = kindOf(l), sold = l.status === 'sold';
    const cs = MM_SHORT[catGroup(l)] || catGroup(l);
    const sub = k === 'new' ? [cs, hostOf(l.link)].filter(Boolean).join(' · ') : k === 'merch' ? cs : [l.condition, l.size && 'Size ' + l.size].filter(Boolean).join(' · ') || cs;
    const flag = { pending: 'Waiting for approval', rejected: 'Not approved' }[l.status];
    return `<button class="mm-card tap${sold ? ' is-sold' : ''}" data-act="listing" data-id="${l.id}">
        <div class="mm-img"${!img && l.link ? ` data-link="${esc(safeUrl(l.link))}"` : ''}>${thumbImg(l)}<span class="mm-ph">${catIco(catGroup(l))}</span>
            <span class="mm-kind k-${k}">${MM_KIND[k]}</span>${soon(l) && !sold ? '<span class="mm-sold mm-soon-tag">Coming soon</span>' : ''}${flag ? `<span class="mm-flag ${l.status}">${flag}</span>` : ''}${sold ? `<span class="mm-sold">${k === 'used' ? 'Sold' : 'Sold out'}</span>` : ''}</div>
        <div class="mm-body"><b class="mm-price">${lprice(l)}</b><span class="mm-name">${esc(l.product_name)}</span><span class="mm-sub">${esc(sub)}</span></div></button>`;
}
/* store pictures that weren't saved with the post are looked up from the product link (same free preview service as before) */
const watchPreviews = root => root.querySelectorAll('.mm-img[data-link]').forEach(b => accObs.observe(b));

function mmVisible(all) {
    return all.filter(l => !expired(l) && (['live', 'sold'].includes(l.status) || mine(l)));
}
function mmSort(list) {
    const by = { 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price,
        newest: (a, b) => String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)) }[mmState.sort];
    return [...list].sort((a, b) => (a.status === 'sold') - (b.status === 'sold') || by(a, b));   /* sold always last */
}
const mmText = l => [l.product_name, l.category, catGroup(l), MM_KIND[kindOf(l)], l.details, l.condition, hostOf(l.link)].filter(Boolean).join(' ');

/* sold used posts are removed for good after 15 days: the team (or the seller) deletes them, with their photos, when they open MotoMart */
async function sweepSold(all) {
    if (mmState.swept) return; mmState.swept = true;
    const old = all.filter(l => expired(l) && (isMod() || mine(l)));
    for (const l of old) { try { await api.deleteListing(l); } catch { /* try again next time */ } }
    if (old.length) state.listings = null;
}

/* redraw MotoMart in place: keep the scroll position, no entrance animation, no new download */
function mmRedraw() { const y = scrollY; mmState.local = true; viewMotoMart().then(() => scrollTo(0, y)).catch(() => {}); }
async function viewMotoMart() {
    state.myId ??= await api.myId();
    const p = state.param;
    if (p === 'review') { if (isMod()) Object.assign(mmState, { review: true, mine: false }); }
    else if (['new', 'used', 'merch'].includes(p)) Object.assign(mmState, { branch: p, cat: 'all', review: false, mine: false });
    if (['review', 'new', 'used', 'merch'].includes(p)) { state.param = null; history.replaceState(null, '', '#motomart'); }
    const all = await load.listings(!mmState.local); mmState.local = false;   /* tabs, filters and sorting reuse what's loaded */
    sweepSold(all);
    const mod = isMod(), waiting = mod ? all.filter(l => l.status === 'pending' && (isAdmin() || !mine(l))) : [];
    if (!mod || !waiting.length) mmState.review = false;
    const base = mmVisible(all).filter(l => mmState.branch === 'all' || kindOf(l) === mmState.branch);
    const cats = [...new Set(base.filter(l => l.status !== 'pending' && l.status !== 'rejected').map(catGroup))]
        .sort((a, b) => (MM_CATS.concat(MERCH_CATS).indexOf(a) + 1 || 99) - (MM_CATS.concat(MERCH_CATS).indexOf(b) + 1 || 99) || a.localeCompare(b));
    if (mmState.cat !== 'all' && !cats.includes(mmState.cat)) mmState.cat = 'all';
    const q = mmState.q.trim();
    const shown = mmState.review ? waiting : mmSort(base.filter(l => (!mmState.mine || mine(l)) && (mmState.cat === 'all' || catGroup(l) === mmState.cat) && searchMatch(q, mmText(l))));
    const branchBtn = (k, label) => `<button role="tab" aria-selected="${mmState.branch === k}" data-act="branch" data-b="${k}">${label}</button>`;
    const fabLabel = mmState.branch === 'merch' ? 'List merch' : 'List accessory';
    app.innerHTML = top('MotoMart') + `
        <div class="mm-head">
            <div class="mm-branches" role="tablist" aria-label="Shop">${branchBtn('all', 'All')}${branchBtn('new', 'New')}${branchBtn('used', 'Pre-owned')}${branchBtn('merch', 'RWB Merch')}</div>
            <button class="mm-search-btn" data-act="search" aria-label="Search MotoMart">${SEARCH_ICO}</button>
        </div>
        ${cats.length > 1 && !mmState.review ? `<div class="mm-cats" role="list">${['all', ...cats].map(c => `<button class="mm-cat" role="listitem" data-act="cat" data-cat="${esc(c)}" aria-pressed="${mmState.cat === c}"><span class="mm-cat-ico">${catIco(c)}</span><span>${c === 'all' ? 'All' : esc(MM_SHORT[c] || c)}</span></button>`).join('')}</div>` : ''}
        ${q ? `<div class="mm-qbar"><span>${shown.length} result${shown.length === 1 ? '' : 's'} for <b>“${esc(q)}”</b></span><button class="linkish" data-act="q-clear">Clear ✕</button></div>` : ''}
        <div class="mm-tools">
            ${mmState.review ? '' : `<label class="mm-sort"><span class="sr-only">Sort</span><select id="mms">${[['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['newest', 'Newest first']].map(([k, v]) => `<option value="${k}"${mmState.sort === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`}
            <button class="chip" data-act="mine" aria-pressed="${mmState.mine}">My posts</button>${waiting.length ? `<button class="chip warn-chip" data-act="review" aria-pressed="${mmState.review}">To approve (${waiting.length})</button>` : ''}
        </div>
        ${mmState.review ? '<p class="small muted" style="margin:-2px 0 12px">Check photos, price and details, then approve or reject. Members are notified when a post goes live.</p>' : ''}
        ${shown.length ? `<div class="mm-grid">${shown.map(listingCard).join('')}</div>` : `<div class="card empty"><b>${base.length ? 'Nothing matches' : mmState.branch === 'merch' ? 'No merch yet' : mmState.branch === 'new' ? 'No accessories yet' : 'Nothing for sale yet'}</b>${mmState.mine ? 'You haven’t posted anything yet.' : q ? 'Try another word, or clear the search.' : mmState.branch === 'used' || mmState.branch === 'all' ? 'Selling old gear? Be the first to post it.' : 'The RWB team will add them here soon.'}</div>`}
        <div class="mm-fabs">${mod ? `<button class="btn fab-2" data-act="list">＋ ${fabLabel}</button>` : ''}<button class="btn fab-1" data-act="sell">＋ Sell something</button></div>`;
    watchPreviews(app);
    actions = {
        branch: el => { mmState.branch = el.dataset.b; mmState.cat = 'all'; mmState.review = false; mmRedraw(); },
        cat: el => { mmState.cat = el.dataset.cat; mmRedraw(); },
        mine: () => { mmState.mine = !mmState.mine; mmState.review = false; mmRedraw(); },
        review: () => { mmState.review = !mmState.review; mmState.mine = false; mmRedraw(); },
        search: () => mmSearch(mmVisible(all)),
        'q-clear': () => { mmState.q = ''; mmRedraw(); },
        sell: () => listingForm(),
        list: () => teamForm(null, mmState.branch === 'merch' ? 'merch' : 'new'),
        listing: el => listingDetail(all.find(l => String(l.id) === el.dataset.id))
    };
    const s = $('#mms'); if (s) s.onchange = e => { mmState.sort = e.target.value; mmRedraw(); };
    /* a post opened by link (e.g. from Home or a WhatsApp share): open it once, then forget it so filters don't reopen it */
    if (state.param) { const id = state.param; state.param = null; history.replaceState(null, '', '#motomart'); const l = all.find(x => String(x.id) === id); if (l && !expired(l)) listingDetail(l); else toast('That post is no longer available', true); }
}

/* Search: a small bar that drops down over the shop, with live matches as you type.
   Back (button or swipe) and leaving MotoMart close it. */
const closeMmSearch = () => document.querySelectorAll('.mm-search').forEach(b => { b.classList.remove('on'); setTimeout(() => b.remove(), 180); });
function mmSearch(items) {
    document.querySelector('.mm-search')?.remove();
    const box = document.createElement('div'); box.className = 'mm-search'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Search MotoMart');
    const popular = [...new Set(items.filter(l => l.status === 'live').map(catGroup))].slice(0, 6);
    box.innerHTML = `<div class="mm-search-bar"><span class="mm-s-ico">${SEARCH_ICO}</span><input type="search" enterkeyhint="search" placeholder="Search helmets, guards, jerseys…" value="${esc(mmState.q)}" aria-label="Search"><button class="linkish" data-x="close">Cancel</button></div><div class="mm-sugg" role="listbox"></div>`;
    document.body.append(box);
    const input = box.querySelector('input'), list = box.querySelector('.mm-sugg');
    const close = closeMmSearch;
    const go = q => { mmState.q = q; mmState.review = false; close(); mmRedraw(); };
    const draw = () => {
        const q = input.value.trim();
        if (!q) { list.innerHTML = popular.length ? `<p class="mm-s-h">Popular</p><div class="chips">${popular.map(c => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''; return; }
        const hits = mmSort(items.filter(l => searchMatch(q, mmText(l))));
        list.innerHTML = hits.length ? hits.slice(0, 6).map(l => { const img = photo(l); return `<button class="mm-s-row" data-id="${l.id}"><span class="mm-s-img">${img ? thumbImg(l) : catIco(catGroup(l))}</span>
                <span class="grow"><b>${markWords(esc(l.product_name), q)}</b><small>${MM_KIND[kindOf(l)]} · ${esc(catGroup(l))}${l.status === 'sold' ? ' · sold' : ''}</small></span><b class="mm-s-price">${lprice(l)}</b></button>`; }).join('')
            + `<button class="mm-s-all" data-all="1">See all ${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}” ›</button>`
            : `<p class="mm-s-none">Nothing matches “${esc(q)}” yet.</p>`;
    };
    input.oninput = draw;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value.trim()); } if (e.key === 'Escape') close(); };
    box.onclick = e => {
        if (e.target === box || e.target.closest('[data-x=close]')) return close();
        const c = e.target.closest('[data-q]'); if (c) { input.value = c.dataset.q; draw(); input.focus(); return; }
        if (e.target.closest('[data-all]')) return go(input.value.trim());
        const r = e.target.closest('[data-id]'); if (r) { close(); listingDetail(items.find(l => String(l.id) === r.dataset.id)); }
    };
    draw(); requestAnimationFrame(() => { box.classList.add('on'); input.focus(); });
}

/* WhatsApp shares never carry the seller's full name or number: members open the app to contact them */
const maskName = n => String(n || '').trim().split(/\s+/).filter(Boolean).map(w => w[0] + '•'.repeat(Math.min(Math.max(w.length - 1, 2), 5))).join(' ') || '–';
const maskPhone = p => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `${d.slice(0, 2)}••••••${d.slice(-2)}` : '–'; };
function sellPostText(l) {
    const url = `https://roninwb.in/app/#motomart/${l.id}`, k = kindOf(l);
    if (k === 'new') return `🆕 *RWB MOTOMART · New accessory*\n\n${l.product_name}\nCategory: ${catGroup(l)}\nPrice: ${lprice(l)}${l.details ? `\n\n${l.details}` : ''}\n\n👉 See it and open the store page in the RWB App: ${url}`;
    if (k === 'merch') return `🔥 *RWB MERCH*\n\n${l.product_name}\nPrice: ${lprice(l)}${l.details ? `\n${l.details}` : ''}\n\n👉 Order in the RWB App: ${url}`;
    return `📌 *RWB MOTOMART · Pre-owned*\n\nProduct Name: ${l.product_name}\nSize: ${l.size || '–'}\nCategory: ${l.category}\nAge: ${l.age || '–'}\nCondition: ${l.condition || '–'}\nReason for Selling: ${l.reason || '–'}\nSelling Price: ${lprice(l)}\nSeller: ${maskName(l.seller_name)} · ${maskPhone(l.seller_phone)}${l.details ? `\n\n${l.details}` : ''}\n\n🔒 The seller's contact is in the RWB App only.\n👉 Photos & contact: ${url}`;
}
/* MotoMart share card: 1080×1350 with the product photo, kind, name, price and details (never the seller's name or number) */
async function listingCard1080(l) {
    const W = 1080, H = 1350, PH = 760, L = 64, k = kindOf(l), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), D = "'Barlow Condensed','Arial Narrow',sans-serif", F = "'Barlow',system-ui,sans-serif";
    await Promise.all(['800 100px "Barlow Condensed"', '600 40px "Barlow"', '700 40px "Barlow"'].map(f => document.fonts?.load(f).catch(() => {})));
    x.fillStyle = '#0f0b09'; x.fillRect(0, 0, W, H);
    const src = allPhotos(l)[0], im = src ? await cardImg(src).catch(() => null) : null;
    if (im) {   /* blurred fill behind, the whole product in front */
        const c = Math.max(W / im.naturalWidth, PH / im.naturalHeight), f = Math.min(W / im.naturalWidth, PH / im.naturalHeight);
        x.save(); x.beginPath(); x.rect(0, 0, W, PH); x.clip(); x.filter = 'blur(40px) brightness(.55)';
        x.drawImage(im, (W - im.naturalWidth * c) / 2 - 40, (PH - im.naturalHeight * c) / 2 - 40, im.naturalWidth * c + 80, im.naturalHeight * c + 80);
        x.filter = 'none'; x.drawImage(im, (W - im.naturalWidth * f) / 2, (PH - im.naturalHeight * f) / 2, im.naturalWidth * f, im.naturalHeight * f); x.restore();
    } else { const g = x.createLinearGradient(0, 0, W, PH); g.addColorStop(0, '#3a1d0e'); g.addColorStop(.55, '#a8431a'); g.addColorStop(1, '#f0712f'); x.fillStyle = g; x.fillRect(0, 0, W, PH);
        x.fillStyle = 'rgba(255,255,255,.9)'; x.textAlign = 'center'; x.font = `800 96px ${D}`; x.fillText('RWB MOTOMART', W / 2, PH / 2 + 30); x.textAlign = 'left'; }
    const fade = x.createLinearGradient(0, PH - 200, 0, PH + 2); fade.addColorStop(0, 'rgba(15,11,9,0)'); fade.addColorStop(1, '#0f0b09'); x.fillStyle = fade; x.fillRect(0, PH - 200, W, 202);
    /* kind badge on the photo */
    const kt = { used: 'PRE-OWNED', new: 'NEW', merch: 'RWB MERCH' }[k]; x.font = `700 28px ${F}`; const kw = x.measureText(kt).width + 48;
    x.fillStyle = k === 'merch' ? '#f0712f' : 'rgba(15,11,9,.72)'; x.beginPath(); x.roundRect(L, 48, kw, 56, 28); x.fill(); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(kt, L + 24, 78);
    /* name, price, details */
    x.textBaseline = 'alphabetic'; let y = PH + 14;
    x.fillStyle = '#f5a06d'; x.font = `700 28px ${F}`; x.fillText([...catGroup(l).toUpperCase()].join(String.fromCharCode(8202)).slice(0, 60), L, y += 30);
    x.fillStyle = '#fff'; x.font = `800 84px ${D}`;
    const words = String(l.product_name || '').toUpperCase().split(/\s+/), lines = []; let ln = '';
    for (const w of words) { const t = ln ? ln + ' ' + w : w; if (x.measureText(t).width > W - 2 * L && ln) { lines.push(ln); ln = w; } else ln = t; }
    if (ln) lines.push(ln); if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].replace(/\s*\S*$/, '') + '…'; }
    for (const t of lines) x.fillText(t, L, y += 82);
    y += 26; x.font = `800 72px ${D}`; const pr = lprice(l), pw = x.measureText(pr).width + 56;
    const pg = x.createLinearGradient(L, 0, L + pw, 0); pg.addColorStop(0, '#ffa766'); pg.addColorStop(1, '#cf5119');
    x.fillStyle = pg; x.beginPath(); x.roundRect(L, y, pw, 92, 22); x.fill(); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(pr, L + 28, y + 50);
    const chips = (k === 'used' ? [l.condition, l.size && `Size ${l.size}`, l.age] : k === 'new' ? [l.link && hostOf(l.link)] : ['Official RWB']).filter(Boolean);
    let cx = L + pw + 20; x.font = `600 28px ${F}`;
    for (const c of chips) { const cw = x.measureText(c).width + 40; if (cx + cw > W - L) break; x.fillStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.roundRect(cx, y + 18, cw, 56, 28); x.fill(); x.fillStyle = 'rgba(255,255,255,.88)'; x.fillText(c, cx + 20, y + 47); cx += cw + 12; }
    await cardBrand(x, W, H, k === 'merch' ? 'ORDER NOW' : k === 'new' ? 'SEE IT' : 'SEE IN APP');
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    return new File([blob], `rwb-motomart-${l.id}.jpg`, { type: 'image/jpeg' });
}
async function shareListing(l) {
    return shareCard(await listingCard1080(l), sellPostText(l), l.product_name);
}

/* RWB Merch "Get now": the post's own link (Google Form, store…) if it has one, otherwise RWB's Instagram DM.
   (No WhatsApp: the old "Direct orders to WhatsApp" switch was removed in Nov 2026.) */
const IG_DM = () => SITE.INSTAGRAM_DM_URL || 'https://ig.me/m/ronin_warriors_bengal';
const merchHref = l => l.link && safeUrl(l.link) !== '#' ? safeUrl(l.link) : IG_DM();

function listingDetail(l) {
    if (!l) return toast('That post is no longer available', true);
    const own = mine(l), adm = isMod(), judge = isAdmin() || (adm && !own), k = kindOf(l), sold = l.status === 'sold', team = k !== 'used';
    const pics = allPhotos(l);
    const fact = (key, v) => v ? `<dt>${key}</dt><dd>${esc(v)}</dd>` : '';
    const contact = `Hi ${String(l.seller_name || '').split(' ')[0]}, I saw your ${l.product_name} (${lprice(l)}) on RWB MotoMart. Is it still available?`;
    const statusTxt = { live: 'Available', sold: k === 'used' ? 'Sold' : 'Sold out', pending: 'Waiting for approval', rejected: 'Not approved' }[l.status];
    openSheet(l.product_name, `<div class="mm-detail${sold ? ' is-sold' : ''}">
        <div class="mm-gal">${pics.length ? `<div class="gallery">${pics.map((u, i) => `<img src="${esc(u)}" alt="Photo ${i + 1} of ${esc(l.product_name)}" referrerpolicy="no-referrer">`).join('')}</div>`
            : `<div class="mm-gal-ph"${l.link ? ` data-link="${esc(safeUrl(l.link))}"` : ''}><span class="mm-ph">${catIco(catGroup(l))}</span></div>`}
            <span class="mm-kind k-${k}">${MM_KIND[k]}</span>${sold ? `<span class="mm-sold">${statusTxt}</span>` : ''}${l.status === 'live' && (adm || own) && !(soon(l) && !adm) ? `<button class="evt-sharebtn mm-share" data-x="share" aria-label="Share">${EVT_ICON.share}</button>` : ''}</div>
        ${pics.length > 1 ? `<p class="small muted" style="text-align:center;margin-top:4px">Swipe for ${pics.length} photos</p>` : ''}
        <div class="mm-d-head"><b class="mm-price">${lprice(l)}</b>${soon(l) && l.status === 'live' ? '' : `<span class="badge ${l.status === 'live' ? 'ok' : sold ? '' : 'orange'}">${statusTxt}</span>`}</div>
        <p class="mm-d-cat">${esc(catGroup(l))}${k === 'new' && l.link ? ` · from <b>${esc(hostOf(l.link))}</b>` : ''}</p>
        ${l.status === 'rejected' && l.reject_reason ? `<p class="warn" style="margin:8px 0">Admin note: ${esc(l.reject_reason)}. Edit the post to send it again.</p>` : ''}
        ${l.status === 'pending' && own && !isAdmin() ? `<p class="warn" style="margin:8px 0">${adm ? 'An admin or another coordinator' : 'An admin or coordinator'} will check and publish your post, usually within 24 hours.</p>` : ''}
        ${sold && k === 'used' ? `<p class="mm-note">This item is sold. The post and its photos are deleted on ${fmtDate(goneOn(l).toISOString().slice(0, 10))}.</p>` : ''}
        ${k === 'used' ? `<dl class="facts">${fact('Size', l.size)}${fact('Age', l.age)}${fact('Condition', l.condition)}${fact('Reason', l.reason)}${fact('Seller', l.seller_name)}${fact('Posted', l.published_at ? fmtDate(String(l.published_at).slice(0, 10)) : '')}</dl>` : ''}
        ${l.details ? `<p style="margin:10px 0 16px">${linkify(l.details)}</p>` : ''}
        <div class="list">
            ${k === 'new' && l.link && !sold ? `<a class="btn block mm-cta" href="${esc(safeUrl(l.link))}" target="_blank" rel="noopener noreferrer">Check product ↗</a><p class="small muted" style="text-align:center;margin-top:-4px">Sold by ${esc(hostOf(l.link) || 'the store')}, not by RWB. Price and stock can change.</p>` : ''}
            ${k === 'merch' && !sold && soon(l) ? `<span class="btn block mm-soon" role="note">Coming Soon</span>` : ''}
            ${k === 'merch' && !sold && !soon(l) ? `<a class="btn block mm-cta" href="${esc(merchHref(l))}" target="_blank" rel="noopener noreferrer">Get now</a>` : ''}
            ${k === 'used' && !own && l.status === 'live' ? `<a class="btn wa block" href="${waTo(l.seller_phone, contact)}" target="_blank" rel="noopener">Message seller on WhatsApp</a>` : ''}
            ${judge && l.status === 'pending' ? `<div class="btns"><button class="btn ghost" data-x="reject">Reject</button><button class="btn" data-x="approve">Approve</button></div>` : ''}
            ${(own && k === 'used' || adm && k === 'merch') && ['live', 'sold'].includes(l.status) ? `<button class="btn ${l.status === 'live' ? '' : 'ghost'} block" data-x="toggle">${l.status === 'live' ? (team ? 'Mark as sold out' : 'Mark as sold') : (team ? 'Back in stock' : 'Put back on sale')}</button>` : ''}
            ${own && k === 'used' || adm && team ? '<button class="btn ghost block" data-x="edit">Edit</button>' : ''}
            ${!own && k === 'used' && l.status === 'live' ? `<button class="linkish" data-report="listing" data-ref="${l.id}" data-label="${esc(l.product_name + ' · ' + (l.seller_name || ''))}" style="margin:6px auto 0;display:block;color:var(--muted)">🚩 Report this post</button>` : ''}
            ${own || adm ? '<button class="btn danger block" data-x="del">Delete</button>' : ''}
        </div></div>`, body => {
        const ph = body.querySelector('.mm-gal-ph[data-link]'); if (ph) accObs.observe(ph);
        const on = (x, fn) => { const b = body.querySelector(`[data-x=${x}]`); if (b) b.onclick = () => fn(b); };
        const after = async msg => { await load.listings(true); closeSheet(); render(); toast(msg); };
        on('approve', b => busy(b, async () => { await api.setListingStatus(l.id, 'live'); await after('Approved. It’s live and members are notified.'); }));
        on('reject', b => { const r = window.prompt('Reason (the seller will see this):', 'Please add clearer photos'); if (r === null) return; busy(b, async () => { await api.setListingStatus(l.id, 'rejected', r.trim() || null); await after('Rejected'); }); });
        on('toggle', b => busy(b, async () => { await api.setListingStatus(l.id, l.status === 'live' ? 'sold' : 'live'); await after(l.status === 'live' ? (team ? 'Marked as sold out' : `Marked as sold 🎉 It’s removed after ${SOLD_DAYS} days.`) : 'Back on sale'); }));
        on('share', b => { if (b.disabled) return; b.disabled = true; shareListing(l).catch(er => toast(er.message || 'Could not share', true)).finally(() => { b.disabled = false; }); });
        on('edit', () => team ? teamForm(l, k) : listingForm(l));
        on('del', b => { if (confirmBox('Delete this post and its photos?')) busy(b, async () => { await api.deleteListing(l); await after('Deleted'); }); });
    });
}

/* category picker: the fixed list, in groups (no "Other"). An old post keeps its old name until it's re-saved. */
function catField(list, cur) {
    const opt = c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`;
    const body = list === MM_CATS ? MM_GROUPS.map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(i => opt(i[0])).join('')}</optgroup>`).join('') : list.map(opt).join('');
    return `<label>Category<select name="category" required><option value="">Choose…</option>${cur && !list.includes(cur) ? opt(cur) : ''}${body}</select></label>`;
}
const catValue = d => d.category;

/* photos: up to MAX, shown as small tiles you can remove */
function photoPicker(body, kept, removed, added, MAX, onChange = () => {}) {
    const thumbs = body.querySelector('#thumbs');
    const draw = () => {
        thumbs.innerHTML = [...kept.map(p => ({ src: api.photoUrl(p), k: 'k:' + p })), ...added.map((f, i) => ({ src: f.url, k: 'a:' + i }))]
            .map(t => `<div class="thumb"><img src="${esc(t.src)}" alt=""><button type="button" aria-label="Remove photo" data-k="${esc(t.k)}">✕</button></div>`).join('');
        body.querySelector('.file-pick').hidden = kept.length + added.length >= MAX;
        onChange();
    };
    thumbs.onclick = e => {
        const k = e.target.closest('button')?.dataset.k; if (!k) return;
        if (k.startsWith('k:')) { const p = k.slice(2); kept.splice(kept.indexOf(p), 1); removed.push(p); }
        else { const i = Number(k.slice(2)); URL.revokeObjectURL(added[i].url); added.splice(i, 1); }
        draw();
    };
    body.querySelector('#pics').onchange = async e => {
        const all = [...e.target.files]; e.target.value = '';
        if (all.length > MAX - kept.length - added.length) toast(`Up to ${MAX} photo${MAX === 1 ? '' : 's'}: the first ${Math.max(0, MAX - kept.length - added.length)} are added`);
        for (const f of all.slice(0, MAX - kept.length - added.length)) {
            try { const c = await mmPhoto(f); added.push({ file: c, url: URL.createObjectURL(c) }); draw(); }
            catch (err) { toast(err.message, true); }
        }
    };
    draw();
}
/* MotoMart photos: only real pictures (JPG, PNG, WebP, HEIC), under 15 MB, shrunk on the phone to a ~200 KB JPEG.
   The database also refuses anything that isn't a small JPEG/WebP in the poster's own folder (setup file 65). */
const MM_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
async function mmPhoto(f) {
    const okType = /^image\/(jpe?g|png|webp|heic|heif)$/i.test(f.type) || (!f.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!okType) throw new Error('Please choose a photo (JPG, PNG, WebP or HEIC). Other files can’t be added.');
    if (f.size > 15 * 1024 * 1024) throw new Error('That photo is over 15 MB. Please choose a smaller one or take a screenshot.');
    const c = await compressImage(f, 1400, 200e3);
    if (c.size > 400 * 1024) throw new Error('That photo couldn’t be made small enough. Try a screenshot of it.');
    return c;
}

function listingForm(l = null) {
    const r = l ? { ...l } : { seller_name: state.me.full_name, seller_phone: state.me.phone || '', photos: [] };
    const kept = [...(r.photos || [])], removed = [], added = [];
    const MAX = 4, cur = l ? catGroup(l.category) : '';
    openSheet(l ? 'Edit post' : 'Sell on MotoMart', `<form id="lf">
        ${l ? '' : `<p class="small muted">${isAdmin() ? 'As an admin, your post goes live at once.' : 'Your post goes live after an admin or coordinator approves it, usually within 24 hours.'} Members can then message you on WhatsApp. Once you mark it sold, it’s removed after 15 days.</p>`}
        <fieldset><legend>Photos <span class="hint muted small">(1 to ${MAX}, clear and well lit · JPG, PNG or HEIC)</span></legend>
            <div class="thumbs" id="thumbs"></div>
            <label class="file-pick"><input type="file" accept="${MM_ACCEPT}" multiple id="pics"><span>📷 Add photos</span></label></fieldset>
        <label>Product name<input name="product_name" required maxlength="120" placeholder="e.g. Axor Apex helmet, matte black" value="${esc(r.product_name || '')}"></label>
        ${catField(MM_CATS, cur)}
        <div class="grid2">
            <label>Size<input name="size" maxlength="60" placeholder="L / 42 / Free size" value="${esc(r.size || '')}"></label>
            <label>Age<input name="age" maxlength="60" placeholder="e.g. 8 months" value="${esc(r.age || '')}"></label>
        </div>
        <label>Condition<select name="condition" required><option value="">Choose…</option>${CONDITIONS.map(c => `<option${c === r.condition ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Reason for selling<input name="reason" maxlength="300" value="${esc(r.reason || '')}"></label>
        <label>Selling price (₹)<input name="price" type="number" required min="0" step="1" inputmode="numeric" value="${esc(r.price ?? '')}"></label>
        <label>More details <span class="hint">optional</span><textarea name="details" maxlength="1000" placeholder="Bill available? Any scratches? Pickup area?">${esc(r.details || '')}</textarea></label>
        <div class="grid2">
            <label>Seller name<input name="seller_name" required maxlength="80" value="${esc(r.seller_name || '')}"></label>
            <label>Seller WhatsApp<input name="seller_phone" required inputmode="tel" value="${esc(r.seller_phone || '')}"></label>
        </div>
        <p class="small muted">Shared on WhatsApp, your name and number are hidden (like A•••• S•• · 98••••••10). Members see them only inside the app.</p>
        <button class="btn block">${l ? (l.status === 'rejected' ? 'Save and send for approval' : 'Save changes') : isAdmin() ? 'Publish' : 'Send for approval'}</button>
    </form>`, body => {
        photoPicker(body, kept, removed, added, MAX);
        body.querySelector('#lf').onsubmit = e => {
            e.preventDefault();
            if (kept.length + added.length === 0) return toast('Please add at least one photo', true);
            const d = Object.fromEntries(new FormData(e.target));
            const phone = d.seller_phone.replace(/\D/g, '').slice(-10);
            if (phone.length !== 10) return toast('Seller WhatsApp needs 10 digits', true);
            const category = catValue(d); if (!category) return toast('Choose a category', true);
            const rec = { id: l?.id, kind: 'used', photos: kept.concat(removed), product_name: d.product_name.trim(), category, size: d.size.trim() || null, age: d.age.trim() || null,
                condition: d.condition, reason: d.reason.trim() || null, price: Number(d.price), details: d.details.trim() || null, seller_name: d.seller_name.trim(), seller_phone: phone };
            busy(e.submitter, async () => {
                await api.saveListing(rec, added.map(a => a.file), removed);
                added.forEach(a => URL.revokeObjectURL(a.url));
                await load.listings(true); closeSheet();
                if (location.hash.startsWith('#motomart')) render(); else location.hash = '#motomart';
                toast(l && l.status !== 'rejected' ? 'Saved' : isAdmin() ? 'Live on MotoMart 👍' : 'Sent for approval 👍');
            });
        };
    });
}

/* Read a product page's title and picture (free preview service). Returns {title, image}; blank when the store blocks it. */
async function linkPreview(url) {
    try {
        const j = await (await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout?.(9000) })).json();
        const image = j?.data?.image?.url || '';
        return { title: String(j?.data?.title || '').trim(), image: /^https:\/\//i.test(image) ? image : '' };
    } catch { return { title: '', image: '' }; }
}

/* Admins and coordinators: list a new accessory or RWB merch. Goes live at once. */
function teamForm(l = null, kind = 'new') {
    if (!isMod()) return;
    let k = l ? kindOf(l) : kind, image_url = l?.image_url || '', pv = 0;
    const kept = [...(l?.photos || [])], removed = [], added = [];
    openSheet(l ? 'Edit listing' : 'List on MotoMart', `<form id="tf">
        ${l ? '' : `<div class="seg" role="tablist"><button type="button" role="tab" data-k="new" aria-selected="${k === 'new'}">New accessory</button><button type="button" role="tab" data-k="merch" aria-selected="${k === 'merch'}">RWB Merch</button></div>`}
        <p class="small muted" id="tf-help"></p>
        <label><span id="link-l"></span><input name="link" type="url" inputmode="url" maxlength="1000" placeholder="https://…" value="${esc(l?.link || '')}"></label>
        <div class="tf-pv" id="tf-pv" hidden></div>
        <label>Product name<input name="product_name" required maxlength="120" placeholder="e.g. Mototorque crash guard for Ronin" value="${esc(l?.product_name || '')}"></label>
        <div id="tf-cat"></div>
        <label class="switch tf-soon"><span>Coming Soon<span class="hint" style="display:block">Tease it before launch: members see “Coming Soon” and can’t order or contact anyone. No price needed. Turn it off when it’s ready.</span></span><input type="checkbox" name="soon"${l && soon(l) ? ' checked' : ''}></label>
        <label class="switch tf-free"><span>Free<span class="hint" style="display:block">Given away at no cost. Shown as “Free” instead of a price.</span></span><input type="checkbox" name="free"${l && kindOf(l) === 'merch' && !soon(l) && Number(l.price) === 0 ? ' checked' : ''}></label>
        <label id="tf-price">Price (₹)<input name="price" type="number" required min="0" step="1" inputmode="numeric" value="${esc(l && soon(l) ? '' : l?.price ?? '')}"></label>
        <label>Description <span class="hint">optional</span><textarea name="details" maxlength="1000" placeholder="Fits Ronin 225? Colour, sizes, offer…">${esc(l?.details || '')}</textarea></label>
        <fieldset><legend>Photo <span class="hint muted small" id="ph-hint"></span></legend>
            <div class="thumbs" id="thumbs"></div>
            <label class="file-pick"><input type="file" accept="${MM_ACCEPT}" multiple id="pics"><span>📷 Add photo or screenshot</span></label></fieldset>
        <button class="btn block">${l ? 'Save changes' : isAdmin() ? 'Publish' : 'Send for approval'}</button>
    </form>`, body => {
        const f = body.querySelector('#tf'), pvBox = body.querySelector('#tf-pv'), link = f.link;
        const needPhoto = () => !image_url && kept.length + added.length === 0;
        const drawPv = (state_, msg = '') => {
            pvBox.hidden = !state_;
            pvBox.className = 'tf-pv ' + (state_ || '');
            pvBox.innerHTML = state_ === 'busy' ? '<span class="spin"></span> Getting the picture from the website…'
                : state_ === 'ok' ? `<img src="${esc(image_url)}" alt="" referrerpolicy="no-referrer"><span class="grow"><b>✓ Picture found on the website</b><small>${kept.length + added.length ? 'Your own photo is shown first.' : 'This is shown on MotoMart. Add your own photo below to use that instead.'}</small></span><button type="button" class="linkish" data-x="pv-off">Remove</button>`
                : state_ === 'none' ? `<span class="grow"><b>Couldn’t get a picture from this website</b><small>${msg || 'Please add one photo or a screenshot of the product below.'}</small></span>` : '';
            const off = pvBox.querySelector('[data-x=pv-off]'); if (off) off.onclick = () => { image_url = ''; drawPv('none', 'Add one photo or a screenshot below.'); hint(); };
        };
        const hint = () => { const h = body.querySelector('#ph-hint'); if (h) h.textContent = needPhoto() ? '(needed: 1 photo or screenshot)' : '(optional)'; };
        const fetchPv = async () => {
            const u = link.value.trim(); if (!/^https?:\/\//i.test(u)) return;
            const my = ++pv; drawPv('busy');
            const r = await linkPreview(u); if (my !== pv || !f.isConnected) return;
            if (r.image) { image_url = r.image; drawPv('ok'); } else { image_url = ''; drawPv('none'); }
            if (r.title && !f.product_name.value.trim()) f.product_name.value = r.title.replace(/\s*[|–-]\s*[^|–-]*$/, '').slice(0, 120);
            hint();
        };
        const freeUI = () => {
            const m = k === 'merch', sn = m && f.soon.checked, fr = m && !sn && f.free.checked;
            body.querySelector('.tf-soon').hidden = !m;
            body.querySelector('.tf-free').hidden = !m || sn;
            body.querySelector('#tf-price').hidden = sn || fr; f.price.required = !(sn || fr);
        };
        f.free.onchange = f.soon.onchange = freeUI;
        const setKind = nk => {
            k = nk;
            body.querySelectorAll('.seg [data-k]').forEach(b => b.setAttribute('aria-selected', b.dataset.k === k));
            const when = isAdmin() ? 'It goes live at once' : 'An admin or another coordinator approves it, then it goes live';
            body.querySelector('#tf-help').textContent = k === 'new' ? `A new accessory from a store. ${when} on the app and roninwb.in. Members tap “Check product” to open the store page.`
                : `RWB merch. ${when} on the app and roninwb.in, and members get a notification.`;
            body.querySelector('#link-l').innerHTML = k === 'new' ? 'Product link <span class="hint">the store page</span>' : 'Order link <span class="hint">optional · Google Form or any website. “Get now” opens it; with no link it opens RWB’s Instagram DM</span>';
            link.required = k === 'new';
            freeUI();
            const cur = l?.category || ''; const list = k === 'merch' ? MERCH_CATS : MM_CATS;
            body.querySelector('#tf-cat').innerHTML = catField(list, l ? catGroup({ ...l, kind: k }) : '');
        };
        body.querySelectorAll('.seg [data-k]').forEach(b => b.onclick = () => setKind(b.dataset.k));
        setKind(k);
        photoPicker(body, kept, removed, added, 3, () => { hint(); if (image_url && !pvBox.hidden) drawPv('ok'); });
        if (image_url) drawPv('ok');
        link.addEventListener('change', fetchPv);
        link.addEventListener('paste', () => setTimeout(fetchPv, 50));
        f.onsubmit = e => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(f));
            if (pvBox.classList.contains('busy')) return toast('One moment, still reading the website…');
            if (needPhoto()) return toast('Add one photo or a screenshot of the product', true);
            const category = catValue(d); if (!category) return toast('Choose a category', true);
            const rec = { id: l?.id, kind: k, photos: kept.concat(removed), product_name: d.product_name.trim(), category, price: k === 'merch' && (f.soon.checked || f.free.checked) ? 0 : Number(d.price), coming_soon: k === 'merch' && f.soon.checked,
                details: d.details.trim() || null, link: d.link.trim() || null, image_url: image_url || null,
                seller_name: null, seller_phone: null, wa_orders: false,
                size: null, age: null, condition: null, reason: null };
            busy(e.submitter, async () => {
                await api.saveListing(rec, added.map(a => a.file), removed);
                added.forEach(a => URL.revokeObjectURL(a.url));
                await load.listings(true); closeSheet();
                mmState.branch = k; mmState.cat = 'all';
                if (location.hash.startsWith('#motomart')) render(); else location.hash = '#motomart';
                toast(l ? 'Saved' : isAdmin() ? `Live on MotoMart${k === 'merch' ? ' · members are notified' : ''} 👍` : 'Sent for approval 👍');
            });
        };
    });
}

async function adminMotoMart() {
    state.myId ??= await api.myId();
    const pend = (await load.listings(true)).filter(l => l.status === 'pending' && (isAdmin() || !mine(l)));   /* coordinators don't approve their own */
    $('#admin-body').innerHTML = pend.length ? `<p class="small muted" style="margin-bottom:10px">Check photos, price and details, then approve. Members are notified when a post goes live. You can then share it to the WhatsApp group from the post.</p><div class="mm-grid">${pend.map(listingCard).join('')}</div>`
        : '<div class="card empty"><b>All clear</b>No MotoMart posts waiting for approval.</div>';
    actions.listing = el => listingDetail(pend.find(l => String(l.id) === el.dataset.id));
}

/* =================== Pookie chatbot =================== */
const CHAT_KEY = () => 'rwb-chat-' + (state.me?.id || 'x');
const chat = { msgs: null, busy: false, image: null, left: null };
const loadChat = () => { if (chat.msgs) return; try { chat.msgs = JSON.parse(localStorage.getItem(CHAT_KEY())) || []; } catch { chat.msgs = []; } };
const saveChat = () => { try { localStorage.setItem(CHAT_KEY(), JSON.stringify(chat.msgs.slice(-40))); } catch { /* ignore */ } };
const SUGGEST = ['Which chain lube works in monsoon?', 'What tyre pressure do RWB riders use?', 'Which engine oil for the Ronin 225?', 'Who are the RWB admins?', 'What is OWB? 👀', 'Ronin niye ekta joke bolo 😄'];
const AI_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/></svg>';

/* tiny, safe markdown: **bold**, *italic*, lists, links, paragraphs */
function md(text) {
    const lines = esc(String(text || '').replace(/\[\[[^\]]*\]\]/g, '').trim()).split(/\n/); let html = '', list = null;
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
        const l = raw.trim(), ul = l.match(/^[-*•]\s+(.*)/), ol = l.match(/^\d+[.)]\s+(.*)/), h = l.match(/^#{1,4}\s+(.*)/);
        if (ul || ol) { const t = ul ? 'ul' : 'ol'; if (list !== t) { close(); html += `<${t}>`; list = t; } html += `<li>${inline((ul || ol)[1])}</li>`; }
        else { close(); if (h) html += `<p><b>${inline(h[1])}</b></p>`; else if (l) html += `<p>${inline(l)}</p>`; }
    }
    close(); return html;
}

/* a short summary of the rider's own bike data, so answers can be personal */
function riderContext() {
    const s = state.services || [], f = state.fuel || [], m = state.me || {};
    const last = s[0], ms = f.length ? mileageStats(f) : null;
    const odo = latestOdo(s, f)?.km || 0, due = odo ? nextService(s, odo) : null;
    return {
        first_name: firstName(m), bike: m.bike || null, odometer_km: odo || null,
        last_service: last ? { date: last.service_date, km: last.odometer_km, type: SERVICE_TYPES[last.service_type], number: last.service_no, items: last.items } : null,
        next_service_due: due ? { km: due.km, date: due.date, which: due.label, status: due.status || 'on track' } : null,
        average_kmpl: ms?.avg ? Number(ms.avg.toFixed(1)) : null, last_tank_kmpl: ms?.last ? Number(ms.last.toFixed(1)) : null
    };
}

async function viewChat() {
    loadChat();
    await Promise.all([load.services().catch(() => []), load.fuel().catch(() => [])]);
    app.innerHTML = top('Pookie', (chat.msgs.length ? '<button class="btn sm ghost" data-act="clear">New chat</button>' : '') + '<button class="icon-btn chat-close" data-act="chat-close" aria-label="Close Pookie">✕</button>') + `
        <a class="teach-chip" href="#teach"><span>${ICON.book}</span><span class="grow" id="chip-sub"><b>Teach Pookie</b> · answer Ronin questions, earn XP</span>${ICON.chev}</a>
        <div id="chatlog" class="chatlog" aria-live="polite"></div>
        <form id="ask" class="askbar">
            <div id="att" class="att" hidden></div>
            <div class="row">
                <label class="icon-btn" aria-label="Add a photo" title="Add a photo">📷<input type="file" accept="image/*,.heic,.heif" id="aphoto" hidden></label>
                <textarea id="q" rows="1" maxlength="1500" placeholder="Ask Pookie…" aria-label="Your question"></textarea>
                <button class="btn send" aria-label="Send">➤</button>
            </div>
            <p class="muted ai-note">Pookie answers from what RWB warriors taught it.<span id="left"></span></p>
        </form>`;
    drawChat(); teachUrgent('#chip-sub', true);
    const q = $('#q'), form = $('#ask');
    const grow = () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; };
    q.oninput = grow;
    q.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); form.requestSubmit(); } };
    $('#aphoto').onchange = async e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try { const c = await compressImage(f, 1024, 180e3); chat.image = { file: c, url: URL.createObjectURL(c) }; drawAttach(); }
        catch (err) { toast(err.message, true); }
    };
    form.onsubmit = e => { e.preventDefault(); sendChat(q.value); };
    actions = {
        clear: () => { if (confirmBox('Start a new chat? This clears the conversation on this phone.')) { chat.msgs = []; saveChat(); viewChat(); } },
        suggest: el => sendChat(el.textContent),
        'rm-att': () => { URL.revokeObjectURL(chat.image.url); chat.image = null; drawAttach(); }
    };
    if (state.param === 'new') { /* opened from a "help" link */ }
    drawAttach();
    if (chat.left != null) $('#left').textContent = ` ${chat.left} question${chat.left === 1 ? '' : 's'} left today.`;
}
function drawAttach() {
    const a = $('#att'); if (!a) return;
    a.hidden = !chat.image;
    a.innerHTML = chat.image ? `<div class="thumb"><img src="${esc(chat.image.url)}" alt="Photo to send"><button type="button" data-act="rm-att" aria-label="Remove photo">✕</button></div>` : '';
}
function drawChat() {
    const log = $('#chatlog'); if (!log) return;
    log.innerHTML = chat.msgs.length ? chat.msgs.map(m => `<div class="msg ${m.role}">${m.img ? `<img src="${esc(m.img)}" alt="" class="msg-img">` : ''}${m.role === 'model' ? md(m.text) : `<p>${esc(m.text).replace(/\n/g, '<br>')}</p>`}${m.err ? '<p class="small" style="margin-top:6px"><button class="btn sm ghost" data-act="retry">Try again</button></p>' : ''}</div>`).join('')
        + (chat.busy ? '<div class="msg model typing"><span></span><span></span><span></span></div>' : '')
        : `<div class="chat-hello"><div class="ai-badge">${AI_ICON}</div><h2>Hey ${esc(firstName(state.me))}, Pookie here 🏍️</h2>
            <p class="muted">Ask me about Ronin care, gear, routes, RWB and this app, then keep the chat going with follow-ups. Bangla, Hindi or English, your choice. If I don't know something, I'll ask the warriors to teach me.</p>
            <div class="chips sugg">${SUGGEST.map(s => `<button class="chip" data-act="suggest">${esc(s)}</button>`).join('')}</div></div>`;
    actions.retry = () => { const last = [...chat.msgs].reverse().find(m => m.role === 'user'); chat.msgs = chat.msgs.filter(m => !m.err); if (last) { chat.msgs.pop(); sendChat(last.text); } };
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
}
async function sendChat(text) {
    text = (text || '').trim();
    if (chat.busy || (!text && !chat.image)) return;
    if (!text) text = 'What can you tell me from this photo?';
    let imgB64 = null, imgUrl = null;
    if (chat.image) {
        imgUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(chat.image.file); });
        imgB64 = imgUrl.split(',')[1]; URL.revokeObjectURL(chat.image.url); chat.image = null; drawAttach();
    }
    chat.msgs.push({ role: 'user', text, img: imgUrl && imgUrl.length < 400e3 ? imgUrl : null });
    const q = $('#q'); if (q) { q.value = ''; q.style.height = 'auto'; }
    chat.busy = true; drawChat();
    let live = null, frame = 0;
    const onText = t => {
        if (!live) { live = { role: 'model', text: '' }; chat.msgs.push(live); chat.busy = false; drawChat(); }
        live.text = t;
        if (!frame) frame = requestAnimationFrame(() => {   /* redraw at most once per screen refresh */
            frame = 0; const el = [...document.querySelectorAll('#chatlog .msg.model')].pop();
            if (el) { el.innerHTML = md(live.text); window.scrollTo({ top: document.body.scrollHeight }); }
        });
    };
    try {
        const history = chat.msgs.filter(m => !m.err).slice(-12).map(m => ({ role: m.role, text: m.text }));   /* Pookie remembers the last 12 messages */
        const r = await api.ask(history, riderContext(), imgB64, onText);
        if (live) live.text = r.reply; else chat.msgs.push({ role: 'model', text: r.reply });
        chat.left = r.left;
        const l = $('#left'); if (l && r.left != null) l.textContent = ` ${r.left} question${r.left === 1 ? '' : 's'} left today.`;
    } catch (e) {
        if (live && live.text) live.text += '\n\n*(Connection lost. The answer may be incomplete.)*';
        else { if (live) chat.msgs.pop(); chat.msgs.push({ role: 'model', text: (e.message || 'Something went wrong. Please try again.') + (isAdmin() && e.detail ? `\n\n*Admin info: ${e.detail}*` : ''), err: true }); }
    } finally {
        chat.busy = false; saveChat(); drawChat();
    }
}

/* "N URGENT questions" on the Teach Pookie links (questions riders asked that Pookie didn't know) */
function teachUrgent(sel, chip) {
    if (isFam()) return;
    api.teach?.stats().then(st => { const el = $(sel); if (!el || !st?.urgent) return;
        el.innerHTML = chip ? `<b>Teach Pookie</b> · <span class="tq-urgent">URGENT</span> ${st.urgent} question${st.urgent > 1 ? 's' : ''} to answer`
            : `<span class="tq-urgent">URGENT</span> ${st.urgent} rider question${st.urgent > 1 ? 's' : ''} Pookie couldn't answer. Can you?`; }).catch(() => {});
}
/* =================== Teach Pookie: members answer Pookie's Ronin questions; admins check; Pookie learns =================== */
const TEACH_LEVELS = [[0, 'Rookie', 'helmet'], [30, 'Rider', 'bike'], [100, 'Mechanic', 'wrench'], [250, 'Road Guru', 'globe'], [500, 'Ronin Sensei', 'approve']];
const teachLevel = xp => { let i = 0; while (i + 1 < TEACH_LEVELS.length && xp >= TEACH_LEVELS[i + 1][0]) i++; const [from, name, ico] = TEACH_LEVELS[i], next = TEACH_LEVELS[i + 1];
    return { name, ico, next: next?.[1], need: next ? next[0] - xp : 0, p: next ? (xp - from) / (next[0] - from) : 1 }; };
async function viewTeach() {
    const skip = state.teachSkip ??= [];
    let d; try { d = await api.teach.next(skip); } catch (e) {
        app.innerHTML = top('Teach Pookie') + `<div class="card empty"><b>Teach Pookie isn't set up yet</b>${/function|could not find/i.test(e.message) ? 'An admin needs to run setup file 56 in Supabase.' : esc(e.message)}</div>`; return; }
    const st = d.stats || {}, lv = teachLevel(st.xp || 0), q = d.question;
    app.innerHTML = top('Teach Pookie') + `
        <section class="teach-hero card">
            <div class="th-row"><span class="th-badge" aria-hidden="true">${ICON[lv.ico]}</span><div class="grow"><b class="th-level">${lv.name}</b>
                <span class="small muted">${st.xp || 0} XP${lv.next ? ` · ${lv.need} XP to ${lv.next}` : ' · top level!'}</span></div>
                <div class="th-num"><b>${st.approved || 0}</b><span>taught</span></div></div>
            <div class="th-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lv.p * 100)}"><i style="width:${Math.round(lv.p * 100)}%"></i></div>
            <p class="small muted" style="margin-top:8px">Answer from your own experience with the Ronin. Pookie answers riders <b>only</b> from what warriors teach it, so every answer counts. Admins check each one first. <b>+10 XP</b> for each answer they approve.</p>
            ${st.urgent ? `<p class="small th-urgent"${q?.urgent ? '' : ' data-x="unskip" role="button" tabindex="0" style="cursor:pointer"'}><span class="tq-urgent">URGENT</span> ${st.urgent} question${st.urgent > 1 ? 's' : ''} from riders that Pookie couldn't answer${q?.urgent || !skip.length ? '' : ' · <b>Show</b>'}</p>` : ''}
        </section>
        ${q ? `<section class="teach-q card" id="tq">
            <div class="tq-head"><span class="tq-ava" aria-hidden="true">${ICON.chat}</span><div><b>Pookie asks</b>${q.urgent ? '<span class="tq-urgent">URGENT</span>' : ''}<span class="tq-cat">${esc(q.category)}</span></div></div>
            ${q.urgent ? `<p class="small tq-why">A warrior asked Pookie this and it didn't know${q.asked > 1 ? ` (asked ${q.asked} times)` : ''}. Your answer helps right away.</p>` : ''}
            <p class="tq-text" id="tq-text" aria-live="polite">${esc(q.question)}</p>
            <form id="tqf"><label class="sr-only" for="tqa">Your answer</label>
                <textarea id="tqa" name="a" rows="4" maxlength="1500" placeholder="Share what you know: brands, km, prices, steps, what worked and what didn't…"></textarea>
                <div class="tq-btns"><button type="button" class="btn ghost sm" data-x="skip">Skip</button><button class="btn sm grow">Teach Pookie</button></div></form>
            <p class="small muted" style="margin-top:8px">${q.answers ? `${q.answers} rider${q.answers > 1 ? 's have' : ' has'} answered this already. Yours adds more.` : 'Nobody has answered this yet. Be the first!'}</p>
        </section>` : skip.length ? `<div class="card empty"><b>That's all for now</b>You skipped ${skip.length} question${skip.length > 1 ? 's' : ''}.<p style="margin-top:12px"><button type="button" class="btn sm" data-x="unskip">Show skipped questions</button></p></div>`
            : `<div class="card empty"><b>You've answered every question 🙌</b>Thank you! Admins add new questions regularly, so check back soon.</div>`}
        ${(st.top || []).length ? `<section class="section"><h2>Top teachers</h2><ol class="group teach-top">${st.top.map((t, i) => `<li class="${t.me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="grow"><b>${esc(t.name)}${t.me ? ' (you)' : ''}</b><span class="small muted">${t.approved} taught</span></span><b class="xp">${t.xp} XP</b></li>`).join('')}</ol></section>` : ''}
        <p class="small muted" style="text-align:center;margin:18px 8px 0">Pookie also reads the maintenance PDFs in Guides. Please don't share anyone's private details in answers.</p>`;
    /* skipped questions come back (a mistaken Skip used to hide an URGENT one until the app restarted) */
    app.querySelectorAll('[data-x=unskip]').forEach(el => el.onclick = () => { skip.length = 0; render(); });
    if (!q) return;
    /* Pookie "types" the question */
    const qt = $('#tq-text'), full = q.question;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { let k = 0; qt.textContent = ''; const tick = () => { k += 2; qt.textContent = full.slice(0, k); if (k < full.length) setTimeout(tick, 14); }; tick(); }
    const f = $('#tqf');
    f.querySelector('[data-x=skip]').onclick = () => { skip.push(q.id); render(); };
    f.onsubmit = e => { e.preventDefault(); const t = f.a.value.trim();
        if (t.length < 8) return toast('Write a little more so Pookie can learn from it', true);
        busy(e.submitter, async () => { const before = st.xp || 0, s2 = await api.teach.answer(q.id, t);
            const card = $('#tq'); card.classList.add('tq-done'); card.insertAdjacentHTML('beforeend', `<div class="tq-xp" aria-hidden="true">+${Math.max(2, (s2.xp || 0) - before)} XP</div>`);
            toast(s2.live ? 'Pookie knows it now 🎓 (admin answers go live at once)' : 'Thanks! An admin will check it, then Pookie learns it 🎓');
            setTimeout(render, 900); }); };
}
/* coordinators: just the Teach Pookie answers to check (not their own) */
async function coordAI() {
    const queue = await api.admin.teachQueue();
    const body = $('#admin-body'); if (!body) return;
    const draw = () => {
        const left = body.querySelectorAll('.tq-review').length; pookieBadge(left);
        const c = $('#c-ai'); if (c) c.textContent = left ? ` (${left})` : '';
        if (!left) body.querySelector('.tq-list').innerHTML = '<p class="muted">Nothing waiting 👍</p>';
    };
    body.innerHTML = `<div class="card"><h3>Answers to check${queue.length ? ` (${queue.length})` : ''}</h3>
        <p class="small muted" style="margin:4px 0 10px">From Teach Pookie. Approve what's right (fix the wording first if needed), reject what's wrong. Pookie uses approved answers from the next question.</p>
        <div class="tq-list">${queue.length ? queue.map(a => `<div class="tq-review" data-id="${a.id}"><p class="small muted">${esc(a.category || '')} · ${esc(a.member_name || 'member')} · ${timeAgo(a.created_at)}</p>
            <b>${esc(a.question)}</b><textarea rows="3" maxlength="1500">${esc(a.answer)}</textarea>
            <div class="btns"><button class="btn ghost sm" data-x="no">Reject</button><button class="btn sm" data-x="ok">Approve</button></div></div>`).join('') : '<p class="muted">Nothing waiting 👍</p>'}</div></div>`;
    body.querySelectorAll('.tq-review').forEach(r => r.querySelectorAll('[data-x]').forEach(b => b.onclick = () => busy(b, async () => {
        const ok = b.dataset.x === 'ok'; await api.admin.teachReview(Number(r.dataset.id), ok, r.querySelector('textarea').value.trim());
        r.remove(); toast(ok ? 'Approved. Pookie knows it now 🎓' : 'Rejected'); draw(); })));
}
/* the little number on the floating Pookie bubble: answers waiting for an admin */
function pookieBadge(n) {
    const fab = document.getElementById('pookie-fab'); if (!fab) return;
    let b = fab.querySelector('.fab-n'); if (!b) { b = document.createElement('i'); b.className = 'fab-n'; fab.appendChild(b); }
    b.textContent = n > 99 ? '99+' : n || ''; b.hidden = !n; fab.setAttribute('aria-label', n ? `Ask Pookie (${n} answer${n > 1 ? 's' : ''} waiting for admins)` : 'Ask Pookie, the RWB AI');
}
async function adminAI() {
    if (!isAdmin()) return coordAI();
    const [queue, know] = await Promise.all([api.admin.teachQueue?.().catch(() => null), api.admin.pookieKnowledge?.().catch(() => null)]);
    const ready = queue !== null && know !== null;
    const nAns = (know || []).filter(k => k.source === 'answer').length, nGuide = (know || []).filter(k => k.source === 'guide').length, nAdm = (know || []).filter(k => k.source === 'admin').length;
    if (queue) { pookieBadge(queue.length); const c = $('#ai-count'); if (c) c.textContent = queue.length ? ` (${queue.length})` : ''; }
    $('#admin-body').innerHTML = (ready ? `<div class="card"><h3>Answers to check${queue.length ? ` (${queue.length})` : ''}</h3>
        <p class="small muted" style="margin:4px 0 10px">From Teach Pookie. Approve what's right (edit it first if needed); Pookie uses approved answers from the next question.</p>
        ${queue.length ? queue.map(a => `<div class="tq-review" data-id="${a.id}"><p class="small muted">${esc(a.category || '')} · ${esc(a.member_name || 'member')} · ${timeAgo(a.created_at)}</p>
            <b>${esc(a.question)}</b><textarea rows="3" maxlength="1500">${esc(a.answer)}</textarea>
            <div class="btns"><button class="btn ghost sm" data-x="no">Reject</button><button class="btn sm" data-x="ok">Approve</button></div></div>`).join('')
          : '<p class="muted">Nothing waiting 👍</p>'}</div>
        <div class="card section"><h3>Learn from the Guides PDFs</h3>
        <p class="small muted" style="margin:4px 0 10px">Pookie reads the text of each maintenance PDF in Guides. Run this again after adding new PDFs. The PDFs must be shared as "Anyone with the link". Scanned (photo) PDFs also need the Gemini key.</p>
        <p class="small"><b>${nGuide}</b> guide${nGuide === 1 ? '' : 's'} learned</p>
        <button class="btn ghost block" id="learn">Learn from Guides</button><pre id="learn-out" class="diag" hidden></pre></div>
        <div class="card section"><h3>What Pookie has learned</h3>
        <p class="small muted" style="margin:4px 0 10px"><b>${nAns}</b> rider answer${nAns === 1 ? '' : 's'}, <b>${nGuide}</b> guide${nGuide === 1 ? '' : 's'}${nAdm ? ` and <b>${nAdm}</b> admin note${nAdm === 1 ? '' : 's'}` : ''}. Pookie answers only from these, so remove anything that's wrong or out of date. Tip: your own answers in Teach Pookie go live at once.</p>
        ${(know || []).length ? `<details><summary class="small">Show all</summary>${know.map(k => `<div class="kn-row"><span class="grow"><span class="small muted">${k.source === 'guide' ? '📄 Guide' : k.source === 'admin' ? '🛡️ Admin' : '🧑 Rider'}</span><b>${esc(k.title)}</b><span class="small">${esc(k.content.slice(0, 160))}${k.content.length > 160 ? '…' : ''}</span></span><button class="btn ghost sm" data-forget="${k.id}">Forget</button></div>`).join('')}</details>` : ''}
        </div>
        <div class="card section"><h3>Pookie's questions</h3>
        <p class="small muted" style="margin:4px 0 10px">Members see these in Teach Pookie, the least-answered first. Add your own, or let the AI write 20 new ones.</p>
        <form id="addq" class="row" style="gap:8px"><input name="q" maxlength="300" placeholder="e.g. Which oil filter do you use?" style="flex:1"><button class="btn sm">Add</button></form>
        <button class="btn ghost block" id="genq" style="margin-top:10px">✨ Write 20 new questions with AI</button></div>`
      : `<div class="card"><h3>Teach Pookie</h3><p class="small muted">Run setup file 56 in Supabase (and deploy the latest ask-ronin function) to turn on Teach Pookie, the answers queue and learning from the Guides PDFs.</p></div>`) + `
        <div class="card section"><h3>Is Pookie working?</h3>
        <p class="small muted" style="margin:4px 0 12px">Runs a quick test of every step (settings, teachings, AI keys) and shows what happened. Doesn't use anyone's daily questions.</p>
        <button class="btn ghost block" id="diag">Run a check</button><pre id="diag-out" class="diag" hidden></pre></div>`;
    $('#diag').onclick = e => busy(e.target, async () => { const out = $('#diag-out'); out.hidden = false; out.textContent = 'Checking… (up to 30 seconds)'; out.textContent = (await api.diagnoseAI()).filter(Boolean).join('\n'); });
    if (!ready) return;
    const body = $('#admin-body');
    body.querySelectorAll('.tq-review').forEach(r => r.querySelectorAll('[data-x]').forEach(b => b.onclick = () => busy(b, async () => {
        const ok = b.dataset.x === 'ok'; await api.admin.teachReview(Number(r.dataset.id), ok, r.querySelector('textarea').value.trim());
        r.remove(); toast(ok ? 'Approved. Pookie knows it now 🎓' : 'Rejected');
        const left = body.querySelectorAll('.tq-review').length; pookieBadge(left); const c = $('#ai-count'); if (c) c.textContent = left ? ` (${left})` : ''; })));
    body.querySelectorAll('[data-forget]').forEach(b => b.onclick = () => { if (confirmBox('Remove this from what Pookie knows?')) busy(b, async () => { await api.admin.pookieForget(Number(b.dataset.forget)); b.closest('.kn-row').remove(); toast('Pookie forgot it'); }); });
    $('#learn').onclick = e => busy(e.target, async () => {
        const out = $('#learn-out'); out.hidden = false; out.textContent = 'Reading the Guides PDFs, one at a time (a few seconds each)…\n';
        let errs = 0, finished = false;
        for (let i = 0; i < 80 && errs < 3; i++) {
            let r; try { r = await api.pookieOp('learn-guides', { retry: i === 0 }); errs = 0; }
            catch (err) { errs++; out.textContent += `✗ ${err.message || 'The server stopped on this one'}${errs < 3 ? ' · moving on…' : ''}\n`; continue; }
            if (r.done) { finished = true; out.textContent += `\nDone. ${r.learned} of ${r.total} guides learned${r.failed ? ` (${r.failed} couldn't be read, see above)` : ''}.`; break; }
            out.textContent += r.learned ? `✓ ${r.learned}\n` : `✗ ${r.failed}: ${r.reason}\n`;
        }
        toast(finished ? 'Pookie has read the guides 📄' : 'Stopped. Press Learn from Guides again to carry on.', !finished);
    });
    $('#genq').onclick = e => busy(e.target, async () => { const r = await api.pookieOp('gen-questions'); toast(`${r.added} new question${r.added === 1 ? '' : 's'} added`); });
    $('#addq').onsubmit = e => { e.preventDefault(); const q = e.target.q.value.trim(); if (q.length < 12) return toast('Write the full question', true);
        busy(e.submitter, async () => { const n = await api.admin.pookieAddQuestions([{ category: 'General', question: q }]); toast(n ? 'Question added' : 'That question is already there'); e.target.reset(); }); };
}

/* =================== RWB: leaderboards =================== */
const MEDAL = ['🥇', '🥈', '🥉'];
const kmTxt = n => Number(n).toLocaleString('en-IN') + ' km';
const kmplTxt = v => Number(v).toFixed(1) + ' km/l';
const BOARDS = {
    gps: { title: 'Track Warriors', sub: 'Kilometres ridden while sharing live location with Track', how: 'How to get on it: tap <b>Track</b> (the middle button) → <b>Share</b> before you ride. Every km you ride while sharing counts, checked by GPS.', has: r => r.km > 0, val: r => Number(r.km), big: r => `${Number(r.km).toLocaleString('en-IN', { maximumFractionDigits: r.km < 100 ? 1 : 0 })} km`, small: r => r.rides ? `${r.rides} ride${r.rides === 1 ? '' : 's'}` : '', empty: 'No one yet! Tap Track → Share on your next ride to be the first Track Warrior.' },
    mileage: { title: 'Mileage Warriors', sub: 'Best average km/l, from full-tank fill-ups', subP: 'Best average km/l of the tanks in this period', has: r => r.kmpl > 0, val: r => Number(r.kmpl), big: r => kmplTxt(r.kmpl), small: r => r.km ? kmTxt(r.km) : '', empty: 'Add a full-tank fill-up with your Trip A reading to get on this board.' },
    service: { title: 'Service Warriors', sub: 'Most services logged in the app', subP: 'Most services done in this period', has: r => r.services > 0, val: r => r.services * 1e5 + (r.last_service ? Date.parse(r.last_service) / 864e5 : 0), big: r => `${r.services} service${r.services === 1 ? '' : 's'}`, small: r => [r.kmpl ? kmplTxt(r.kmpl) : '', r.last_service ? 'last ' + fmtDayMonth(r.last_service) : ''].filter(Boolean).join(' · '), empty: 'Log your services to get on this board.' },
    road: { title: 'Road Warriors', sub: 'Most km on the odometer', subP: 'Most km ridden, from odometer readings', has: r => r.km > 0, val: r => r.km, big: r => kmTxt(r.km), small: r => r.kmpl ? kmplTxt(r.kmpl) : '', empty: 'Update your odometer on Home, or add a fill-up or service, to get on this board.' },
    pookie: { title: 'Pookie Warriors', sub: 'Most XP from teaching Pookie about the Ronin', subP: 'Most XP earned teaching Pookie in this period', how: 'How to get on it: open <a href="#teach"><b>Teach Pookie</b></a> and answer its questions. <b>10 XP</b> for every answer the admins approve, 2 XP while it waits.', has: r => r.xp > 0, val: r => r.xp * 1000 + r.approved, big: r => `${r.xp} XP`, small: r => `${r.approved} taught`, empty: 'Answer a question in Teach Pookie to get on this board.' }
};
const rankBoard = (rows, key) => rows.filter(BOARDS[key].has).sort((a, b) => BOARDS[key].val(b) - BOARDS[key].val(a) || a.full_name.localeCompare(b.full_name)).map((r, i) => ({ ...r, rank: i + 1 }));
const LB_ICON = { gps: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M12 21.5s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><path d="M12 21.5s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10.5" r="2.4"/></svg>',
    mileage: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="ac" x="7" y="6.5" width="5" height="4" rx=".8"/><path d="M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5v15M3.5 20.5h12M14 9h2a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8.5L18 6"/><rect x="7" y="6.5" width="5" height="4" rx=".8"/></svg>',
    service: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    road: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M4 19a8 8 0 1 1 16 0z"/><path d="M4 19a8 8 0 1 1 16 0M12 19l3.5-5.5M7 15.5h.01M8.5 11.5h.01M12 10h.01M15.5 11.5h.01"/></svg>',
    pookie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M3 9l9-4.5L21 9l-9 4.5z"/><path d="M3 9l9-4.5L21 9l-9 4.5zM7 11v4.5c1.4 1.3 3 2 5 2s3.6-.7 5-2V11M21 9v5"/></svg>' };
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4.5v1.5A3 3 0 0 0 7.4 10.5M17 6h2.5v1.5a3 3 0 0 1-2.9 3M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z"/></svg>';
const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8l4.2 3.6L12 5l4.3 6.6L20.5 8l-1.8 10H5.3z"/></svg>';
const lbRows = (key, raw) => rankBoard(lbSrc(key, raw).filter(r => !(r.is_me && state.me?.show_on_leaderboard === false)), key);   /* hidden riders never see themselves, even on a saved copy */
const lbName = r => esc(r.nickname || r.full_name.split(' ')[0]);
function boardHtml(key, raw) {
    const B = BOARDS[key], board = lbRows(key, raw);
    const me = board.find(r => r.is_me), top3 = board.slice(0, 3), rest = board.slice(3, 10);
    const pod = (r, p) => r ? `<div class="lp lp${p}${r.is_me ? ' me' : ''}" style="--d:${[0, .5, .25, .7][p]}s">
            <div class="lp-who"><span class="lp-ring">${p === 1 ? `<span class="lp-crown">${CROWN}</span>` : ''}${face(r, 'avatar lp-face')}</span>
            <b>${lbName(r)}</b><span class="lp-val lb-count">${B.big(r)}</span><span class="lp-sub">${esc(B.small(r))}</span></div>
            <div class="lp-step"><span>${p}</span></div></div>` : `<div class="lp lp${p} empty" style="--d:${[0, .5, .25, .7][p]}s"><div class="lp-who"><span class="lp-ring"><span class="avatar lp-face"><i>?</i></span></span><b>Open spot</b></div><div class="lp-step"><span>${p}</span></div></div>`;
    const sub = (state.boardPer || 'all') !== 'all' && B.subP ? B.subP : B.sub;
    return `<div class="lb-head"><span class="lb-ico">${LB_ICON[key]}</span><div class="grow"><h2 class="board-title">${B.title}</h2><p class="small muted">${sub}</p></div><span class="lb-n"><b class="lb-count">${board.length}</b><small>rider${board.length === 1 ? '' : 's'}</small></span>${isMod() && !isFam() ? `<button class="lb-share" data-act="lb-share" aria-label="Share ${B.title}">${EVT_ICON.share}</button>` : ''}</div>
        ${board.length ? `<div class="lb-stage"><i class="lb-rays"></i>${[1, 2, 3].map(i => `<i class="lb-spark s${i}"></i>`).join('')}<div class="lb-podium">${pod(top3[1], 2)}${pod(top3[0], 1)}${pod(top3[2], 3)}</div></div>`
            + (rest.length ? `<ol class="lb-list" start="4">${rest.map((r, i) => `<li class="${r.is_me ? 'me' : ''}" style="--i:${i}"><span class="rk">${r.rank}</span>${face(r, 'avatar sm')}<span class="grow"><b>${esc(r.full_name)}</b><span class="small muted">${esc(r.bike || '')}</span></span><span class="num km"><span class="lb-count">${B.big(r)}</span><small>${esc(B.small(r))}</small></span></li>`).join('')}</ol>` : '')
            + (me && me.rank > 10 ? `<p class="lb-me">You're <b>#${me.rank}</b> of ${board.length} with ${B.big(me)}. ${board[me.rank - 2] ? `Just <b>${esc(lbGap(key, board[me.rank - 2], me))}</b> behind #${me.rank - 1}.` : ''}</p>` : '')
            + (!me && !isFam() ? `<p class="small muted lb-note">${state.me.show_on_leaderboard === false ? 'You\'re hidden from the Warriorboards (Me → Privacy).' : B.empty}</p>` : '')
          : `<div class="lb-empty"><span class="lb-trophy">${TROPHY}</span><b>Be the first!</b><span class="muted">${B.empty}</span></div>`}
        ${B.how && !isFam() ? `<p class="small board-how">${B.how}</p>` : ''}`;
}
/* Warriorboards by period (file 87): everyone (members + RWB FAM) can switch; the numbers for a period come in one small call,
   kept for 10 minutes (and offline). "All time" uses the boards as before. */
const LB_PERIODS = [['7', 'Week'], ['30', 'Month'], ['90', '3M'], ['180', '6M'], ['365', 'Year'], ['all', 'All']];
const lbPerLabel = p => p === 'all' ? 'All time' : ({ 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 3 months', 180: 'Last 6 months', 365: 'Last 12 months' })[p];
async function lbPeriodLoad(p) {
    if (p === 'all') return;
    const c = state.wp?.[p]; if (c && Date.now() - c.at < 10 * 60e3) return;
    const rows = await api.warriorPeriod(Number(p));
    (state.wp ??= {})[p] = { at: Date.now(), rows: rows || [] };
}
const lbSrc = (key, raw) => {
    const p = state.boardPer || 'all', pr = p !== 'all' && state.wp?.[p]?.rows;
    if (pr) return key === 'gps' ? pr.map(r => ({ ...r, km: Number(r.gps_km) })) : pr;
    return key === 'gps' ? (state.gps || []) : key === 'pookie' ? (state.pookieBoard || []) : raw;
};
/* the board's share card (admins and coordinators): 1080×1350, glowing stage, podium with the top 3, #4–#8 with bars */
async function boardCard1080(key, raw) {
    const B = BOARDS[key], rows = lbRows(key, raw).slice(0, 8), per = state.boardPer || 'all';
    const W = 1080, H = 1350, L = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), D = "'Barlow Condensed','Arial Narrow',sans-serif", F = "'Barlow',system-ui,sans-serif";
    await Promise.all(['800 100px "Barlow Condensed"', '600 40px "Barlow"', '700 40px "Barlow"'].map(f => document.fonts?.load(f).catch(() => {})));
    const name = r => (r.nickname || r.full_name.split(' ')[0] || '').trim();
    const fit = (t, mw) => { while (x.measureText(t).width > mw && t.length > 3) t = t.slice(0, -2).trimEnd() + '…'; return t; };
    const lin = (x0, y0, x1, y1, stops) => { const g = x.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };
    const rad = (cx, cy, r, c0, c1) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
    /* stage: deep night, ember glows, light rays */
    x.fillStyle = lin(0, 0, 0, H, [[0, '#1d0d06'], [.5, '#0e0806'], [1, '#090605']]); x.fillRect(0, 0, W, H);
    x.fillStyle = rad(W / 2, 520, 620, 'rgba(240,113,47,.42)', 'rgba(240,113,47,0)'); x.fillRect(0, 0, W, H);
    x.fillStyle = rad(120, 60, 420, 'rgba(255,167,102,.22)', 'rgba(255,167,102,0)'); x.fillRect(0, 0, W, H);
    x.fillStyle = rad(W - 80, 980, 460, 'rgba(207,81,25,.20)', 'rgba(207,81,25,0)'); x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, 560); x.globalAlpha = .07; x.fillStyle = '#ffd6b0';
    for (let i = 0; i < 18; i++) { x.rotate(Math.PI / 9); x.beginPath(); x.moveTo(0, 0); x.lineTo(-38, -900); x.lineTo(38, -900); x.closePath(); x.fill(); }
    x.restore();
    for (const [sx, sy, s] of [[180, 380, 5], [905, 330, 4], [820, 520, 3], [250, 600, 3], [980, 640, 3], [95, 520, 2]]) { x.fillStyle = 'rgba(255,214,176,.75)'; x.beginPath(); x.arc(sx, sy, s, 0, Math.PI * 2); x.fill(); }
    /* header: board icon, kicker, title, period */
    const ico = await cardImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LB_ICON[key].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ').replace(/class="ac"/g, 'fill="rgba(255,255,255,.25)" stroke="none"'))).catch(() => null);
    x.fillStyle = lin(W / 2 - 46, 52, W / 2 + 46, 144, [[0, '#ffa766'], [1, '#cf5119']]); x.beginPath(); x.roundRect(W / 2 - 46, 50, 92, 92, 26); x.fill();
    if (ico) x.drawImage(ico, W / 2 - 30, 66, 60, 60);
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#f5a06d'; x.font = `700 26px ${F}`; x.fillText([...'RWB WARRIORBOARDS'].join(String.fromCharCode(8202)), W / 2, 182);
    let ts = 104; do { x.font = `800 ${ts}px ${D}`; ts -= 4; } while (x.measureText(B.title.toUpperCase()).width > W - 2 * L && ts > 60);
    x.fillStyle = lin(0, 190, 0, 272, [[0, '#ffffff'], [1, '#ffd9bd']]); x.fillText(B.title.toUpperCase(), W / 2, 272);
    const ist = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    const pt = per === 'all' ? 'ALL TIME' : `${lbPerLabel(per).toUpperCase()}  ·  ${ist(new Date(Date.now() - (Number(per) - 1) * 864e5))} – ${ist(new Date())}`;
    x.font = `700 26px ${F}`; const pw = x.measureText(pt).width + 52;
    x.fillStyle = 'rgba(255,255,255,.08)'; x.strokeStyle = 'rgba(255,167,102,.55)'; x.lineWidth = 2; x.beginPath(); x.roundRect((W - pw) / 2, 292, pw, 50, 25); x.fill(); x.stroke();
    x.fillStyle = '#ffd2b3'; x.textBaseline = 'middle'; x.fillText(pt, W / 2, 318);
    /* podium */
    const pics = await Promise.all(rows.slice(0, 3).map(r => r.avatar_url ? cardImg(r.avatar_url).catch(() => null) : null));
    const MET = [['#fff2b8', '#ffcf4d', '#c98a12'], ['#ffffff', '#d5dbe3', '#8d97a5'], ['#ffd9b8', '#e79a62', '#9c5426']];
    const base = 890, colW = 300;
    const step = (i, cx, h) => {
        const top = base - h, m = MET[i];
        x.fillStyle = lin(0, top, 0, base, [[0, m[1]], [1, 'rgba(0,0,0,0)']]); x.globalAlpha = .9;
        x.beginPath(); x.roundRect(cx - colW / 2 + 12, top, colW - 24, h, [22, 22, 0, 0]); x.fill(); x.globalAlpha = 1;
        x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(cx - colW / 2 + 34, top + 10, colW - 68, 3);
        x.fillStyle = 'rgba(40,20,8,.55)'; x.textBaseline = 'alphabetic'; x.font = `800 ${i ? 84 : 108}px ${D}`; x.fillText(String(i + 1), cx, top + (i ? 86 : 110));
    };
    const who = (i, cx, h, r0) => {
        const r = rows[i]; if (!r) return;
        const m = MET[i], vy = base - h - 22, ny = vy - (i ? 44 : 50), cy = ny - (i ? 46 : 56) - r0 - 10;
        x.fillStyle = rad(cx, cy, r0 + 70, 'rgba(255,190,120,.35)', 'rgba(255,190,120,0)'); x.fillRect(cx - r0 - 80, cy - r0 - 80, 2 * r0 + 160, 2 * r0 + 160);
        x.fillStyle = lin(cx - r0, cy - r0, cx + r0, cy + r0, [[0, m[0]], [.5, m[1]], [1, m[2]]]); x.beginPath(); x.arc(cx, cy, r0 + 9, 0, Math.PI * 2); x.fill();
        x.save(); x.beginPath(); x.arc(cx, cy, r0, 0, Math.PI * 2); x.clip();
        if (pics[i]) { const im = pics[i], s = Math.max(2 * r0 / im.naturalWidth, 2 * r0 / im.naturalHeight); x.drawImage(im, cx - im.naturalWidth * s / 2, cy - im.naturalHeight * s / 2, im.naturalWidth * s, im.naturalHeight * s); }
        else { x.fillStyle = lin(0, cy - r0, 0, cy + r0, [[0, '#4a2a19'], [1, '#24140c']]); x.fillRect(cx - r0, cy - r0, 2 * r0, 2 * r0); x.fillStyle = '#ffe6d3'; x.textBaseline = 'middle'; x.font = `800 ${Math.round(r0 * .78)}px ${D}`; x.fillText(initials(r), cx, cy + 4); }
        x.restore();
        if (i === 0) {   /* crown */
            const cy0 = cy - r0 - 26; x.fillStyle = lin(0, cy0 - 40, 0, cy0 + 18, [[0, '#fff2b8'], [1, '#e0a21a']]);
            x.beginPath(); x.moveTo(cx - 52, cy0 + 16); x.lineTo(cx - 60, cy0 - 30); x.lineTo(cx - 24, cy0 - 6); x.lineTo(cx, cy0 - 44); x.lineTo(cx + 24, cy0 - 6); x.lineTo(cx + 60, cy0 - 30); x.lineTo(cx + 52, cy0 + 16); x.closePath(); x.fill();
        }
        x.textBaseline = 'alphabetic'; x.fillStyle = '#fff'; x.font = `800 ${i ? 46 : 56}px ${D}`; x.fillText(fit(name(r).toUpperCase(), colW - 10), cx, ny);
        x.fillStyle = '#ffb27a'; x.font = `700 ${i ? 32 : 38}px ${F}`; x.fillText(fit(B.big(r), colW - 10), cx, vy);
    };
    const cols = [[1, W / 2 - colW, 130, 74], [0, W / 2, 180, 88], [2, W / 2 + colW, 100, 74]];
    if (rows.length) { cols.forEach(([i, cx, h]) => rows[i] && step(i, cx, h)); cols.forEach(([i, cx, h, r0]) => who(i, cx, h, r0)); }
    else { x.fillStyle = 'rgba(255,255,255,.75)'; x.textBaseline = 'alphabetic'; x.font = `700 44px ${F}`; x.fillText('Be the first on this board!', W / 2, 640); }
    x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(L, base, W - 2 * L, 2);
    /* #4–#8 with a bar for the score */
    const rest = rows.slice(3, 8), top1 = rows[0] ? B.val(rows[0]) : 1;
    let y = base + 24; const rh = rest.length > 4 ? 54 : 62;
    x.textAlign = 'left';
    for (const r of rest) {
        x.fillStyle = 'rgba(255,255,255,.06)'; x.beginPath(); x.roundRect(L, y, W - 2 * L, rh - 10, 16); x.fill();
        const pct = Math.max(.04, Math.min(1, B.val(r) / (top1 || 1)));
        x.fillStyle = lin(L, 0, L + (W - 2 * L) * pct, 0, [[0, 'rgba(240,113,47,.38)'], [1, 'rgba(240,113,47,.08)']]); x.beginPath(); x.roundRect(L, y, (W - 2 * L) * pct, rh - 10, 16); x.fill();
        x.textBaseline = 'middle'; const my = y + (rh - 10) / 2 + 2;
        x.fillStyle = '#ffb27a'; x.font = `800 34px ${D}`; x.fillText(`#${r.rank}`, L + 24, my);
        x.fillStyle = '#fff'; x.font = `600 32px ${F}`; x.fillText(fit(name(r), 520), L + 110, my);
        x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `700 30px ${F}`; x.fillText(B.big(r), W - L - 24, my); x.textAlign = 'left';
        y += rh;
    }
    await cardBrand(x, W, H, 'JOIN RWB');
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .92));
    return new File([blob], `rwb-${key}-warriors-${per === 'all' ? 'all-time' : per + '-days'}.jpg`, { type: 'image/jpeg' });
}
async function shareBoard(key, raw) {
    const B = BOARDS[key], top3 = lbRows(key, raw).slice(0, 3);
    const text = `🏆 *RWB ${B.title}* · ${lbPerLabel(state.boardPer || 'all')}\n${top3.map((r, i) => `${MEDAL[i]} ${r.nickname || r.full_name.split(' ')[0]} · ${B.big(r)}`).join('\n')}\n\n👉 https://roninwb.in`;
    await shareCard(await boardCard1080(key, raw), text, B.title);
}
/* how far behind the next rider you are, in the board's own units */
function lbGap(key, ahead, me) {
    const d = { gps: ahead.km - me.km, mileage: ahead.kmpl - me.kmpl, service: ahead.services - me.services, road: ahead.km - me.km, pookie: ahead.xp - me.xp }[key];
    return key === 'mileage' ? kmplTxt(Math.max(d, 0.1)) : key === 'service' ? `${Math.max(d, 1)} service${d > 1 ? 's' : ''}` : key === 'pookie' ? `${Math.max(d, 1)} XP` : kmTxt(Math.max(Math.round(d), 1));
}
/* numbers roll up from zero when a board appears */
function lbCount(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('.lb-count').forEach((el, n) => {
        const txt = el.textContent, m = txt.match(/\d[\d,]*(\.\d+)?/); if (!m) return;
        const end = parseFloat(m[0].replace(/,/g, '')), dec = m[1] ? m[1].length - 1 : 0, t0 = performance.now() + Math.min(n, 8) * 60, dur = 1100;
        const fmt = v => txt.replace(m[0], v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
        el.textContent = fmt(0);
        const step = t => { const k = Math.min(1, Math.max(0, (t - t0) / dur)); el.textContent = fmt(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
    });
}
async function viewCrew() {
    const raw = state.board ??= await api.boards().catch(() => api.leaderboard().then(rs => rs.map(r => ({ ...r, services: 0, kmpl: null }))).catch(() => []));
    if (!state.gps || Date.now() - (state.gpsAt || 0) > 120e3) { [state.gps, state.pookieBoard] = await Promise.all([api.gpsBoard().catch(() => []), api.pookieBoard?.().catch(() => []) ?? []]); state.gpsAt = Date.now(); }
    state.boardKey ??= 'gps'; state.boardPer ??= 'all';
    if (state.boardPer !== 'all') await lbPeriodLoad(state.boardPer).catch(() => { state.boardPer = 'all'; });
    const keys = Object.keys(BOARDS);
    const mine = Object.fromEntries(keys.map(k => [k, lbRows(k, raw).find(r => r.is_me)?.rank || 0]));
    const best = keys.filter(k => mine[k]).sort((a, b) => mine[a] - mine[b])[0];
    app.innerHTML = top('RWB') + `
        <section class="lb-hero"><div class="grow"><span class="lb-kick">RWB Hall of Fame</span><h2>Warriorboards</h2>
            <p>${best ? `Your best: <b>#${mine[best]}</b> in ${BOARDS[best].title}${mine[best] <= 3 ? ' 🔥' : ''}` : isFam() ? 'The riders leading RWB right now' : 'Ride, log and teach Pookie to climb the ranks'}</p>
            <a class="lb-mem" href="#members">${CREW_ICON}RWB Members ›</a></div>
            <span class="lb-cup"><img src="icons/logo-384.png" alt="RWB"></span></section>
        <div class="lb-tabs" role="tablist" aria-label="Warriorboard">${keys.map(k => `<button role="tab" aria-selected="${k === state.boardKey}" data-act="board" data-b="${k}">
            <span class="lt-ico">${LB_ICON[k]}</span><b>${BOARDS[k].title.replace(' Warriors', '')}</b><small>${mine[k] ? `You #${mine[k]}` : '—'}</small></button>`).join('')}</div>
        <div class="lb-per" role="tablist" aria-label="Period">${LB_PERIODS.map(([v, t]) => `<button role="tab" aria-selected="${v === state.boardPer}" data-act="lb-per" data-p="${v}" aria-label="${lbPerLabel(v)}">${t}</button>`).join('')}</div>
        <section class="board card lb-card" id="board">${boardHtml(state.boardKey, raw)}</section>
        <p class="board-dots" aria-hidden="true">${keys.map(k => `<i${k === state.boardKey ? ' class="on"' : ''}></i>`).join('')}</p>
        <a class="mem-entry" href="#members"><span class="mem-faces">${[...new Map([...(state.gps || []), ...raw].filter(r => r.full_name).map(r => [r.full_name, r])).values()].slice(0, 4).map(r => face(r, 'avatar sm')).join('')}</span>
            <span class="grow"><b>RWB Members</b><span class="small muted">${state.dir ? `${state.dir.length} riders · ` : ''}Find a rider · RWB team contacts</span></span>${ICON.chev}</a>`;
    lbCount($('#board'));
    const showBoard = (k, dir = 0) => { state.boardKey = k; const el = $('#board'); if (!el) return; app.classList.remove('same'); el.innerHTML = boardHtml(k, raw);
        app.querySelectorAll('.lb-tabs [data-b]').forEach(b => b.setAttribute('aria-selected', b.dataset.b === k));
        app.querySelector(`.lb-tabs [data-b="${k}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
        app.querySelectorAll('.board-dots i').forEach((d, i) => d.classList.toggle('on', keys[i] === k));
        el.classList.remove('slide-l', 'slide-r'); void el.offsetWidth; if (dir) el.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
        lbCount(el); };
    actions = { board: el => { if (el.dataset.b !== state.boardKey) showBoard(el.dataset.b, Math.sign(keys.indexOf(el.dataset.b) - keys.indexOf(state.boardKey))); },
        'lb-per': el => { const p = el.dataset.p; if (p === state.boardPer) return;
            app.querySelectorAll('.lb-per button').forEach(b => b.setAttribute('aria-selected', b === el));
            lbPeriodLoad(p).then(() => { state.boardPer = p; if (location.hash === '#crew') render(); })
                .catch(() => { toast('Couldn\'t load that period. Check your internet and try again.', true); app.querySelectorAll('.lb-per button').forEach(b => b.setAttribute('aria-selected', b.dataset.p === state.boardPer)); }); },
        'lb-share': el => { if (el.disabled) return; el.disabled = true; shareBoard(state.boardKey, raw).catch(er => toast(er.message || 'Could not share', true)).finally(() => { el.disabled = false; }); } };
    /* swipe left / right to change leaderboard */
    let sx = null, sy = 0;
    $('#board').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    $('#board').addEventListener('touchend', e => {
        if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const i = keys.indexOf(state.boardKey), j = Math.min(keys.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)));
        if (j !== i) showBoard(keys[j], dx < 0 ? 1 : -1);
    }, { passive: true });
}
/* =================== RWB members (directory; admins get their member tools) =================== */
async function viewMembers() {
    app.innerHTML = top('RWB') + `<a class="back-link" href="#crew">‹ Warriorboards</a><h2 class="mem-title">RWB Members</h2>
        <p class="small muted" style="margin:-2px 0 12px">Find riders and reach the RWB team for help</p><div id="crew-body">${SKEL(5)}</div>`;
    actions = {};
    if (isMod() && !isAdmin()) $('#crew-body').insertAdjacentHTML('beforebegin', '<button class="btn ghost block" data-act="fam-all" style="margin-bottom:12px">👨‍👩‍👧 RWB FAM members</button>');
    if (isAdmin()) {   /* admins get their full member tools here too */
        $('#crew-body').id = 'admin-body';
        await adminMembers(); return;
    }
    const all = state.dir ??= teamFirst(await api.directory());
    const team = all.filter(isTeam), others = all.filter(m => !isTeam(m));
    const name = m => `${esc(m.full_name)}${m.nickname ? ` <span class="muted" style="font-weight:400">“${esc(m.nickname)}”</span>` : ''}`;
    $('#crew-body').innerHTML = (team.length ? `<div class="team card"><h3 class="team-title">RWB team <span class="small muted">for help or emergencies</span></h3>
            ${team.map(m => `<div class="row member-row team-row">${face(m, 'avatar sm')}
                <div class="grow"><div class="who">${name(m)} ${roleBadge(m)}</div><div class="meta">${esc(m.phone ? m.phone.replace(/(\d{5})(\d{5})/, '$1 $2') : '')}${m.vrn ? ` · ${esc(m.vrn)}` : ''}${m.avg_kmpl ? ` · <b class="kmpl-tag">${kmplTxt(m.avg_kmpl)}</b>` : ''}</div></div>
                ${m.phone ? `<a class="icon-btn call" href="tel:+91${esc(m.phone)}" aria-label="Call ${esc(m.full_name)}">${ICON_PHONE}</a><a class="icon-btn wa-btn" href="${waTo(m.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(m.full_name)}">${ICON_WA}</a>` : ''}</div>`).join('')}</div>` : '')
        + `<div class="chips" id="cf" style="margin-bottom:10px">${Object.entries(CREW_F(all)).map(([k, v]) => `<button class="chip" data-f="${k}" aria-pressed="${(state.crewFilter || 'all') === k}">${v}</button>`).join('')}</div>
        <input class="search" type="search" id="cq" placeholder="${isMod() ? 'Search name, bike number or place' : 'Search members by name'}" value="${esc(state.crewSearch || '')}" aria-label="Search members">
        <p class="small muted" id="ccount" style="margin:-4px 0 10px"></p><div class="list" id="cl"></div><button class="btn ghost block section" id="cmore" hidden>Show more</button>`;
    let limit = 50;
    const draw = () => {
        const q = (state.crewSearch || '').trim().toLowerCase(), qv = vrnKey(q);
        const f = state.crewFilter || 'all', inF = m => f === 'all' || (f === 'app' ? m.on_app : !m.on_app);
        const pool = (q || f !== 'all' ? all : others).filter(inF);   /* while searching or filtering, the team is included too */
        const hits = pool.filter(m => !q || [m.full_name, m.nickname, m.bike, m.locality].some(v => (v || '').toLowerCase().includes(q)) || (qv.length >= 2 && [m.vrn, ...(m.bikes || []).map(b => b.vrn)].some(v => vrnKey(v).includes(qv))));
        $('#ccount').textContent = q ? `${hits.length} found${isMod() && qv.length >= 4 && !hits.length ? '. That bike isn\'t registered with RWB.' : ''}` : f === 'app' ? `${hits.length} members on the app` : f === 'noapp' ? `${hits.length} members not on the app yet` : `${all.length} members in RWB`;
        $('#cl').innerHTML = hits.slice(0, limit).map(m => `<div class="card row member-row">${face(m, 'avatar sm')}
            <div class="grow"><div class="who">${name(m)} ${roleBadge(m)}${m.on_app ? ' <span class="badge ok">On app</span>' : ''}</div>
            <div class="meta">${m.avg_kmpl ? `<b class="kmpl-tag">${kmplTxt(m.avg_kmpl)}</b> · ` : ''}${esc([m.bike, m.locality].filter(Boolean).join(', ') || 'RWB member')}</div></div>
            ${m.vrn ? `<span class="vrn${m.vrn_verified ? ' ok' : ''}" title="${m.vrn_verified ? 'VRN verified by RWB' : ''}">${esc(qv.length >= 2 && !vrnKey(m.vrn).includes(qv) ? ((m.bikes || []).find(b => vrnKey(b.vrn).includes(qv))?.vrn || m.vrn) : m.vrn)}${m.vrn_verified ? ' ✓' : ''}</span>` : ''}</div>`).join('') || (q ? '<div class="card empty">No one matches.</div>' : '');
        $('#cmore').hidden = hits.length <= limit;
    };
    $('#cq').oninput = e => { state.crewSearch = e.target.value; limit = 50; draw(); };
    $('#cf').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; state.crewFilter = b.dataset.f; limit = 50; $('#cf').querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); };
    $('#cmore').onclick = () => { limit += 100; draw(); };
    draw();
}
/* VRN check on Home: members learn only "member or not"; admins and coordinators also see who it is */
const vrnCheckCard = () => `<form class="card vrn-check" id="vcf"><b>🔎 VRN check</b><span class="small muted">Spotted a Ronin? See if the rider is in RWB.</span>
    <div class="row" style="gap:8px;margin-top:8px"><input name="v" autocapitalize="characters" autocomplete="off" placeholder="WB 02 AB 1234" aria-label="Vehicle number" style="flex:1"><button class="btn">Check</button></div><div id="vcr" class="vcr" hidden></div></form>`;
function bindVrnCheck() {
    const vcf = $('#vcf'); if (!vcf) return;
    vcf.onsubmit = e => {
        e.preventDefault(); const v = e.target.v.value, out = $('#vcr');
        if (vrnKey(v).length < 6) return toast('Type the full bike number, e.g. WB 02 AB 1234', true);
        busy(e.submitter, async () => {
            const info = isMod() ? null : await api.vrnInfo?.(v).catch(() => null);   /* members: name partly hidden + area */
            const yes = info ? !!info.member : await api.vrnCheck(v), key = vrnKey(v);
            const owns = x => vrnKey(x.vrn) === key || (x.member_bikes || x.bikes || []).some(b => vrnKey(b.vrn) === key);
            let who = '', full = null;
            if (yes && isAdmin()) { const all = await api.admin.members().catch(() => state.adminMembers || []); state.adminMembers = all; full = all.find(x => !isGone(x) && owns(x)); }   /* always fresh */
            else if (yes && isMod()) { const dir = state.dir ??= teamFirst(await api.directory().catch(() => [])); const m = dir.find(owns); if (m) who = m.full_name; }
            out.hidden = false; out.className = 'vcr ' + (yes ? 'yes' : 'no');
            out.innerHTML = !yes ? '<b>❌ Naah. Not an RWB Member.</b><span>Approach the rider politely and let them know about RWB (Ronin Warriors of Bengal) or simply ask them to visit <a href="https://roninwb.in" target="_blank" rel="noopener">roninwb.in</a></span>'
                : full ? vrnAdminCard(full, key) : `<b>✅ Yeah! RWB Member.</b>${who ? `<span>${esc(who)}</span>` : ''}${info?.name ? `<span class="vc-who"><b>${esc(info.name)}</b>${info.area ? ` · ${esc(info.area)}` : ''}</span>${info.full ? '' : '<span class="small muted">Name partly hidden for the rider\'s privacy.</span>'}` : ''}`;
            out.insertAdjacentHTML('afterbegin', '<button type="button" class="vcr-x" aria-label="Close">✕</button>');
            out.querySelector('.vcr-x').onclick = () => { out.hidden = true; out.innerHTML = ''; vcf.reset(); };
            const op = out.querySelector('[data-x=vc-open]'); if (op) op.onclick = () => memberSheet(full);
            if (!yes && isAdmin()) out.insertAdjacentHTML('beforeend', vrnLookup(v.toUpperCase().replace(/[^A-Z0-9]/g, ''), 'Not in RWB, but you can still see who it\'s registered to.'));
            const vb = out.querySelector('[data-x=vc-verify]');
            if (vb && full) vb.onclick = () => { const slot = vrnKey(full.vrn) === key ? 1 : (full.member_bikes || []).find(b => vrnKey(b.vrn) === key)?.slot;
                if (!slot) return; busy(vb, async () => { await api.admin.setVrnVerified(full.id, slot, true); if (slot === 1) full.vrn_verified = true; else (full.member_bikes.find(b => b.slot === slot) || {}).verified = true;
                    state.dir = null; toast('VRN marked as verified'); out.innerHTML = vrnAdminCard(full, key); out.insertAdjacentHTML('afterbegin', '<button type="button" class="vcr-x" aria-label="Close">✕</button>');
                    out.querySelector('.vcr-x').onclick = () => { out.hidden = true; out.innerHTML = ''; vcf.reset(); }; const o2 = out.querySelector('[data-x=vc-open]'); if (o2) o2.onclick = () => memberSheet(full); }); };
        });
    };
}
/* admins: everything about the rider whose VRN was checked */
function vrnAdminCard(m, key) {
    const bike = vrnKey(m.vrn) === key ? { slot: 1, vrn: m.vrn, model: m.bike, verified: m.vrn_verified } : (m.member_bikes || []).find(b => vrnKey(b.vrn) === key) || {};
    const row = (k, v) => v ? `<div><span class="muted">${k}</span><span>${v}</span></div>` : '';
    return `<b>✅ Yeah! RWB Member.</b>
        <div class="vc-who">${face(m, 'avatar sm')}<span class="grow"><b>${esc(m.full_name)}</b>${m.nickname ? ` <span class="muted">“${esc(m.nickname)}”</span>` : ''}<span class="small muted">${m.user_id ? 'On the app' : 'Not on the app yet'}${m.role !== 'member' ? ' · ' + esc(ROLE[m.role] || m.role) : ''}</span></span></div>
        <div class="vc-facts">
            ${row('Bike', esc([bike.model || (bike.slot === 1 ? m.bike : ''), bike.slot > 1 ? `bike ${bike.slot}` : 'main bike'].filter(Boolean).join(' · ')))}
            ${row('VRN', `<span class="vrn${bike.verified ? ' ok' : ''}">${esc(bike.vrn || '')}</span> ${bike.verified ? '✓ verified' : 'not verified yet'}`)}
            ${row('WhatsApp', esc(m.phone || ''))}${row('Alternative', esc(m.alt_phone || ''))}
            ${row('Locality', esc(m.locality || ''))}${row('Hometown', esc(m.hideout || ''))}
            ${row('Blood group', esc(m.blood_group || ''))}${row('Emergency', esc(m.emergency_phone || ''))}
            ${row('Birthday', m.dob ? fmtDayMonth(m.dob) : '')}${row('Member since', m.joined_at ? fmtDate(String(m.joined_at).slice(0, 10)) : '')}
            ${row('T&C', tncOk(m) ? 'Agreed' : m.tnc_agreed === false ? 'Does not agree' : 'Not agreed yet')}
        </div>
        <div class="btns" style="margin-top:10px">${m.phone ? `<a class="btn sm ghost" href="tel:+91${esc(m.phone)}">📞 Call</a><a class="btn sm wa" href="${waTo(m.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button type="button" class="btn sm" data-x="vc-open">Open profile</button></div>
        ${vrnLookup(String(bike.vrn || key).toUpperCase().replace(/[^A-Z0-9]/g, ''), `Check that the owner name matches <b>${esc(m.full_name)}</b>.`, bike.slot ? { verified: !!bike.verified } : null)}`;
}
/* admins: the 3 VRN lookup sites (same as in approvals), right under a VRN check result */
const vrnLookup = (vrn, hint, ver = null) => `<div class="vc-sites"><b class="vc-sub">Check this VRN</b>${vrnSites(vrn, hint)}
    ${ver ? (ver.verified ? '<p class="small muted" style="margin-top:8px">✓ This VRN is already marked as verified.</p>' : '<button type="button" class="btn sm block" data-x="vc-verify" style="margin-top:10px">✓ Name matches: mark VRN verified</button>') : ''}</div>`;
const SHARE_OPTS = [['vrn', 'VRN and bike numbers', 'Your registration numbers'], ['bike', 'Bike model', 'e.g. TVS Ronin 225'], ['locality', 'Locality', 'The area you live in'], ['mileage', 'Average mileage', 'In the member list']];
const ICON_PHONE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
const ICON_WA = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.4-.3z"/></svg>';

/* =================== Boot =================== */
/* the app is ready: let the intro finish (tap skips it), then fade it out */
function hideBoot() {
    const b = document.getElementById('boot'); if (!b || b.dataset.out) return;
    b.dataset.out = '1';
    const go = () => { if (b.classList.contains('out')) return; b.classList.add('out'); setTimeout(() => b.remove(), 600); };
    window.hideBootNow = go;
    const end = window.INTRO_END ?? (window.BOOT_T || 0) + 900;
    setTimeout(go, Math.max(0, end - performance.now()));
}
/* ---------- Works offline (offline.js): a small pill shows when there's no internet or changes are waiting ---------- */
function initOffline() {
    const pill = document.createElement('button'); pill.id = 'net-pill'; pill.type = 'button'; pill.hidden = true; document.body.append(pill);
    let pending = 0;
    const plural = n => `${n} change${n === 1 ? '' : 's'}`;
    const draw = () => {
        const off = !navigator.onLine;
        pill.hidden = !(off || pending) || !state.me;
        pill.className = off ? 'off' : 'sync';
        pill.innerHTML = `<i aria-hidden="true"></i>${off ? `Offline${pending ? ` · ${plural(pending)} waiting` : ''}` : `Syncing ${plural(pending)}…`}`;
    };
    pill.onclick = () => toast(navigator.onLine ? 'Sending your changes to RWB…'
        : 'No internet. You can still see your saved data, and log fuel, services, reminders and parts. They sync by themselves once you\'re back online.');
    api.offline.pending().then(n => { pending = n; draw(); }).catch(() => {});
    window.addEventListener('rwb-outbox', e => { pending = e.detail.count; draw(); });
    window.addEventListener('offline', draw);
    window.addEventListener('online', () => { draw(); if (state.me && !$('dialog#sheet[open]')) render(); });
    window.addEventListener('rwb-synced', e => {
        const { done, failed } = e.detail;
        if (failed.length) toast(`${failed.length === 1 ? 'A change' : plural(failed.length)} couldn't be saved: ${failed[0]}`, true);
        else if (done) toast(`✓ ${plural(done)} synced`);
        Object.assign(state, { services: null, fuel: null, ride: null, docs: null, reminders: undefined });
        if (state.me && !$('dialog#sheet[open]')) render();
    });
    new MutationObserver(draw).observe(document.getElementById('tabbar'), { attributes: true, attributeFilter: ['hidden'] });
    draw();
}
async function boot() {
    try {
        if (await nativeOutdated()) return nativeBlocker();   /* an old RWB Android app: must install the new build first */
        const androidWeb = !NATIVE && /android/i.test(navigator.userAgent);
        if (androidWeb && !JOIN_MODE) return nativeBlocker(true);   /* Android browser: use the RWB Android app (iPhone stays on the web app); joining from roninwb.in/join works in the browser */
        const sess = await api.session();
        if (!sess) return viewSignIn();
        const status = await api.linkAccount();
        if (androidWeb && status === 'member') { try { sessionStorage.removeItem('rwb-join'); } catch { /* ignore */ } return nativeBlocker(true); }
        if (status === 'moved') {   /* an admin changed their RWB email: this Google account is signed out */
            await api.signOut().catch(() => {});
            viewSignIn();
            const note = document.createElement('div'); note.className = 'warn'; note.style.marginTop = '12px';
            note.innerHTML = '<b>Your RWB email was changed.</b> An RWB admin changed the email on your membership, so this Google account no longer opens the RWB App. Sign in with your new email. Everything you saved is still there.';
            app.querySelector('.signin')?.appendChild(note);
            return;
        }
        if (status !== 'member') {   /* not a member: in someone's RWB FAM, or joining with an invite code? */
            const fam = status !== 'not_found' ? null : await api.famMe().catch(() => null);
            if (fam) return bootFam(fam);
            if (status === 'not_found' && famCodeSaved()) return famJoinScreen(sess);
            return viewAccess(status, sess);
        }
        state.fam = null; delete document.body.dataset.fam;
        state.me = await api.me();
        { const back = takeReturn(); if (back && !location.hash.startsWith(back)) history.replaceState(null, '', back); }   /* back from Android's settings */
        api.settings().then(v => { state.settings = v || {}; }).catch(() => { state.settings = {}; });
        await load.news(true);
        await render();
        if (!state.movedCheck) {   /* coming back to the app: was their email changed meanwhile? (at most every 10 min) */
            state.movedCheck = Date.now();
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'visible' || Date.now() - state.movedCheck < 600000) return;
                state.movedCheck = Date.now();
                api.linkAccount().then(st => { if (st === 'moved') location.reload(); }).catch(() => {});
            });
        }
        if (!trk.resumed) { trk.resumed = true; resumeShare(); if (NATIVE) { nativePushOn(false).catch(() => {}); setTimeout(nativeUpdateAsk, 2500); if (sharing()) setTimeout(() => RwbTrack()?.perms?.().then(p => notifCheck({ notif: p?.notifications })).catch(() => {}), 1500); } else setTimeout(appPromo, 1500); }
    } catch (e) {
        tabbar.hidden = true;
        const off = !navigator.onLine || /offline|internet/i.test(e.message || '');
        app.innerHTML = `<section class="signin"><img src="icons/app-icon-256.webp" alt=""><div><h1>${off ? 'You\'re offline' : 'Can\'t connect'}</h1><p class="lead">${off ? 'Connect to the internet once, and the RWB App keeps your data on this phone so it opens without internet next time.' : esc(e.message || 'Please check your internet connection.')}</p></div><button class="btn block" onclick="location.reload()">Try again</button></section>`;
    } finally { hideBoot(); }
}


/* =================== Track: live location on rides, SOS, Track Warriors =================== */
/* Sharing: the phone sends its position adaptively (often while moving, rarely when stopped) and keeps the screen awake.
   Inside the RWB Android app the native background plugin is used instead, so it keeps going with the screen locked.
   View: a map of everyone sharing (refreshed every 15 s while it's open). SOS: an urgent alert to the RWB team. */
const LEAFLET = 'vendor/leaflet/';   /* Leaflet 1.9.4 (BSD-2), bundled with the app */
const TRACK_KEY = 'rwb-track';
const TRACK_NOTE_MAX = 60;
const TRACK_HOURS = [[1, '1 hour'], [4, '4 hours'], [8, '8 hours'], [12, 'Until I stop']];
const trk = { watch: null, native: null, last: null, sent: null, sentAt: 0, until: 0, event: null, lock: null, tick: null, map: null, L: null, markers: new Map(), sosMarkers: new Map(), data: null, poll: null, fitted: false, filter: null };
const NativeGeo = () => Native('BackgroundGeolocation');
const trackSaved = () => { try { return JSON.parse(localStorage.getItem(TRACK_KEY) || 'null'); } catch { return null; } };
const trackSave = v => { try { v ? localStorage.setItem(TRACK_KEY, JSON.stringify(v)) : localStorage.removeItem(TRACK_KEY); } catch { /* ignore */ } };
const sharing = () => trk.until > Date.now();
const distM = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
    return 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2)); };
const leftTxt = until => { const m = Math.max(0, Math.round((until - Date.now()) / 6e4)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`; };
const mapsLink = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
const posOf = p => ({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), spd: p.coords.speed ?? null, hdg: p.coords.heading ?? null, t: p.timestamp || Date.now() });

/* one GPS fix (asks for permission the first time) */
function gpsFix(maxAge = 15000) {
    return new Promise((ok, no) => {
        if (!('geolocation' in navigator)) return no(new Error('This phone can\'t share its location.'));
        navigator.geolocation.getCurrentPosition(p => ok(posOf(p)), e => no(geoError(e)), { enableHighAccuracy: true, timeout: 20000, maximumAge: maxAge });
    });
}
function geoError(e) {
    if (e?.code === 1) { setTimeout(locationHelp, 50); return new Error('Location permission is off for the RWB App'); }
    if (e?.code === 3) return new Error('No GPS signal yet. Step into the open and try again.');
    return new Error(e?.message || 'Could not get your location');
}
function locationHelp() {
    openSheet('Allow location', `<p class="small" style="margin-bottom:10px">Track needs your location. It's off for the RWB App right now.</p>
        <ol class="small help-steps"><li>Open your phone's <b>Settings → Apps</b> (or <b>Chrome → Site settings</b>).</li><li>Find <b>RWB</b> (or <b>roninwb.in</b>) → <b>Permissions → Location</b>.</li><li>Choose <b>Allow</b> (or <b>Allow while using the app</b>), then come back and tap Share again.</li></ol>
        <p class="small muted" style="margin-top:10px">Also turn on <b>Location / GPS</b> in the quick settings.</p>`);
}

/* the screen stays awake while sharing (browsers pause GPS when the screen goes off) */
async function keepAwake(on) {
    try {
        if (on && !trk.lock && 'wakeLock' in navigator && document.visibilityState === 'visible') { trk.lock = await navigator.wakeLock.request('screen'); trk.lock.addEventListener('release', () => { trk.lock = null; }); }
        if (!on && trk.lock) { await trk.lock.release(); trk.lock = null; }
    } catch { /* not supported */ }
}

/* send a position when it matters: every 10-20 s while moving, every 60 s when stopped */
function onFix(p) {
    trk.last = p;
    if (!sharing() || trk.svc) return;   /* the RWB Track service sends positions itself */
    const now = Date.now(), gap = now - trk.sentAt, moved = trk.sent ? distM(trk.sent, p) : Infinity;
    const fast = (p.spd ?? 0) > 8, every = fast ? 10000 : 20000;
    if ((moved >= 30 && gap >= every) || gap >= 60000 || (!trk.sent && p.acc <= 100)) sendFix(p);
}
async function sendFix(p) {
    trk.sent = p; trk.sentAt = Date.now();
    try { const r = await api.trackPing(p.lat, p.lng, p.acc, p.spd, p.hdg); if (r === 'stopped') stopShare(true); }
    catch { /* offline: the next fix goes */ }
}
function startWatch() {
    stopWatch();
    const nat = trk.svc ? null : NativeGeo();
    if (trk.svc) {   /* the RWB Track service does all the GPS work (one GPS user = less battery); its last fix is read when needed */
    } else if (nat) {   /* the RWB Android app: keeps going with the screen locked (a notification shows while it runs) */
        nat.addWatcher({ backgroundTitle: 'RWB is sharing your location', backgroundMessage: 'Tap to open the RWB App. Stop sharing in Track.', requestPermissions: true, stale: false, distanceFilter: 25 },
            (loc, err) => { if (err) { if (err.code === 'NOT_AUTHORIZED') locationHelp(); return; } if (loc) onFix({ lat: loc.latitude, lng: loc.longitude, acc: Math.round(loc.accuracy || 0), spd: loc.speed ?? null, hdg: loc.bearing ?? null, t: loc.time || Date.now() }); })
            .then(id => { trk.native = id; }).catch(() => {});
    } else if ('geolocation' in navigator) {
        trk.watch = navigator.geolocation.watchPosition(p => onFix(posOf(p)), e => { if (e.code === 1) { stopShare(); locationHelp(); } }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
        keepAwake(true);
    }
    clearInterval(trk.tick);
    trk.tick = setInterval(() => {   /* heartbeat + the time limit */
        if (!sharing()) return stopShare();
        if (trk.svc) { svcCheck(); return trackBadge(); }
        if (trk.last && Date.now() - trk.sentAt > 60000) sendFix(trk.last);
        trackBadge();
    }, 30000);
    trackBadge();
}
function stopWatch() {
    if (trk.watch != null) { navigator.geolocation.clearWatch(trk.watch); trk.watch = null; }
    if (trk.native != null) { NativeGeo()?.removeWatcher({ id: trk.native }).catch(() => {}); trk.native = null; }
    clearInterval(trk.tick); keepAwake(false);
}
/* Location switched off on the phone: the RWB Android app asks "Turn on location?" (the usual Android pop-up) */
async function locationOn() {
    if (!NATIVE) return true;
    try { const r = await RwbTrack()?.ensureLocation(); return r ? !!r.on : true; } catch { return true; }   /* older app: carry on */
}
/* a position fast: a precise GPS fix if it comes quickly, else the phone's quick estimate, so Share never waits long */
function quickStartFix() {
    return new Promise((ok, no) => {
        if (!('geolocation' in navigator)) return no(new Error('This phone can\'t share its location.'));
        let done = false; const fin = (f, v) => { if (!done) { done = true; f(v); } };
        navigator.geolocation.getCurrentPosition(p => fin(ok, posOf(p)), e => {
            if (e?.code === 1) return fin(no, geoError(e));
            navigator.geolocation.getCurrentPosition(p => fin(ok, posOf(p)), e2 => fin(no, e2?.code === 1 ? geoError(e2) : new Error('Can\'t find your location. Check that Location is on, then try again.')), { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
        }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    });
}
/* Google Play's "prominent disclosure": shown BEFORE Android asks for location */
const LOC_DISCLOSURE = `<div class="loc-disclosure"><b>📍 How RWB uses your location</b><p class="small">RWB collects your <b>location</b> to share your live position with the RWB members on the Track map, with your RWB FAM and with the RWB team for <b>SOS</b>, <b>even when the app is closed or not in use</b>. This happens <b>only while you share</b> (you pick 1, 4 or 8 hours, or until you stop) and stops when you tap Stop. Your location is never sold or used for ads.</p></div>`;
function locDisclosure() {
    return new Promise(res => {
        let done = false; const fin = v => { if (!done) { done = true; res(v); } };
        openSheet('Location for Track', `${LOC_DISCLOSURE}
            <p class="small" style="margin:12px 0">Next, Android asks for your location. Choose <b>While using the app</b>, then on the next screen choose <b>Allow all the time</b>, so sharing keeps going with the screen off.</p>
            <button class="btn block" data-x="go">Continue</button><button class="btn ghost block" data-x="no" style="margin-top:8px">Not now</button>`, body => {
            body.querySelector('[data-x=go]').onclick = () => { fin(true); closeSheet(); };
            body.querySelector('[data-x=no]').onclick = () => { fin(false); closeSheet(); };
        });
        sheet.addEventListener('close', () => fin(false), { once: true });
    });
}
/* RWB Android app, before sharing: the notice, Android's location pop-up and the notifications pop-up (so the
   "RWB is sharing your location" notification shows). Returns { ok, bg }: ok false only if location was refused;
   bg true when "Allow all the time" should be asked AFTER sharing has started (that page is in Android's settings,
   and Android can restart the app when you come back from it, so sharing must already be running by then). */
async function nativeTrackPerms() {
    const T = RwbTrack(); if (!NATIVE || !T?.perms) return { ok: true, bg: false };
    let p = await T.perms().catch(() => null); if (!p) return { ok: true, bg: false };
    const needFg = !p.fine && !p.coarse;
    let askBg = !p.background; try { askBg = askBg && (needFg || Date.now() - Number(localStorage.getItem('rwb-bg-asked') || 0) > 3 * 864e5); } catch { /* ignore */ }
    if (needFg || askBg) {
        const go = await locDisclosure();
        if (!go) return { ok: !needFg, bg: false };
        try { localStorage.setItem('rwb-bg-asked', String(Date.now())); } catch { /* ignore */ }
        if (needFg) { p = await T.askLocation().catch(() => p); if (!p.fine && !p.coarse) return { ok: false, bg: false }; }
    }
    if (!p.notifications) p = await T.askNotifications().catch(() => p) || p;
    return { ok: true, bg: askBg && !p.background, notif: p.notifications !== false };
}
/* opening one of Android's settings pages: remember where we were, so coming back (even if Android restarted the
   app) lands on the Track map instead of the home page */
const RETURN_KEY = 'rwb-return';
function markReturn(hash = '#track') { try { localStorage.setItem(RETURN_KEY, JSON.stringify({ hash, at: Date.now() })); } catch { /* ignore */ } }
function takeReturn() {
    try { const v = JSON.parse(localStorage.getItem(RETURN_KEY) || 'null'); localStorage.removeItem(RETURN_KEY); return v && Date.now() - v.at < 15 * 6e4 ? v.hash : null; } catch { return null; }
}
/* after sharing started: "Allow all the time" (Android 11+ opens RWB's location page), then back to the map */
async function bgAfterShare(perm) {
    const T = RwbTrack(); if (!perm?.bg || !T?.askBackground) return notifCheck(perm);
    const ok = await new Promise(res => {
        openSheet('One more step', `<p class="small" style="margin-bottom:12px">You're sharing now ✅. To keep it going with the screen off for the whole ride, Android's next screen asks about location: choose <b>Allow all the time</b>, then come back to RWB.</p>
            <button class="btn block" data-x="go">Open</button><button class="btn ghost block" data-x="no" style="margin-top:8px">Later</button>`, body => {
            body.querySelector('[data-x=go]').onclick = () => { res(true); closeSheet(); };
            body.querySelector('[data-x=no]').onclick = () => { res(false); closeSheet(); };
        });
        sheet.addEventListener('close', () => res(false), { once: true });
    });
    if (!ok) return notifCheck(perm);
    markReturn('#track');
    await T.askBackground().catch(() => {});
    try { localStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
    if (location.hash !== '#track') location.hash = '#track'; else refreshTrack();
    if (sharing() && trk.svc) svcCheck();
    notifCheck(perm);
}
/* notifications turned off (or the pop-up refused twice, so Android won't show it again): the sharing notification
   can't show, so say how to turn them on */
async function notifCheck(perm) {
    if (!perm || perm.notif !== false) return;
    try { if (Date.now() - Number(localStorage.getItem('rwb-notif-tip') || 0) < 864e5) return; localStorage.setItem('rwb-notif-tip', String(Date.now())); } catch { /* ignore */ }
    openSheet('Turn on notifications', `<p class="small" style="margin-bottom:12px">Notifications are off for RWB, so the <b>"RWB is sharing your live location"</b> notification can't show (and you won't get SOS alerts). Sharing still works.</p>
        <p class="small" style="margin-bottom:12px">Tap <b>Open settings</b> → <b>Notifications</b> → turn them <b>on</b>, then come back.</p>
        <button class="btn block" data-x="go">Open settings</button><button class="btn ghost block" data-x="no" style="margin-top:8px">Later</button>`, body => {
        body.querySelector('[data-x=go]').onclick = () => { markReturn('#track'); RwbTrack()?.settings().catch(() => {}); closeSheet(); };
        body.querySelector('[data-x=no]').onclick = () => closeSheet();
    });
}
async function startShare(hours, eventId = null, note = '') {
    const wasOn = sharing(), perm = await nativeTrackPerms();
    if (!perm.ok) throw new Error('RWB needs your location to share it. Tap Share again and allow location.');
    if (!(await locationOn())) throw new Error('Location is off. Turn on Location to share your live location.');
    try { localStorage.removeItem(STOP_KEY); } catch { /* ignore */ }
    const p = await quickStartFix();
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, TRACK_NOTE_MAX);
    const until = await api.trackStart(p.lat, p.lng, p.acc, hours, eventId, note);
    trk.until = Date.parse(until) || Date.now() + hours * 36e5; if (!wasOn) trk.myTop = 0; trk.event = eventId; trk.note = note; trk.sent = p; trk.sentAt = Date.now(); trk.last = p;
    trk.svc = false; let svc = null;
    if (await hasSvc()) svc = await svcStart().catch(e => { svcErr = String(e?.message || e); toast(`Background sharing couldn't start: ${svcErr}. Sharing works while the app is open.`, true); return null; });
    trackSave({ until: trk.until, event: eventId, note, svc: trk.svc });
    startWatch();
    toast(`You're sharing your live location 📍 ${hours >= 12 ? 'until you stop' : 'for ' + TRACK_HOURS.find(h => h[0] === hours)[1]}`);
    if (perm.bg || perm.notif === false) setTimeout(() => bgAfterShare(perm), 700);
    else if (svc && (svc.battery === false || svc.bgLocation === false)) setTimeout(() => batteryAsk(), 900);
}
/* stopping is instant on the phone; the server is told in the background (tried again until it works) */
const STOP_KEY = 'rwb-track-stop';
function stopSend(tries = 0) {
    if (sharing()) { try { localStorage.removeItem(STOP_KEY); } catch { /* ignore */ } return; }   /* sharing again since: nothing to stop */
    api.trackStop().then(() => { try { localStorage.removeItem(STOP_KEY); } catch { /* ignore */ } if (location.hash.startsWith('#track')) refreshTrack(); })
        .catch(() => { if (tries < 5) setTimeout(() => stopSend(tries + 1), 3000 * (tries + 1)); });
}
async function stopShare(quiet = false) {
    const was = sharing() || trackSaved();
    trk.until = 0; trk.event = null; trackSave(null); stopWatch(); trackBadge();
    if (trk.svc || svcOk) RwbTrack()?.stop().catch(() => {}); trk.svc = false;
    if (!quiet && was) { try { localStorage.setItem(STOP_KEY, '1'); } catch { /* ignore */ } stopSend(); toast('Stopped sharing your location'); }
    if (location.hash.startsWith('#track')) {
        if (trk.data) { trk.data.riders = trk.data.riders.filter(r => !r.me); }   /* off the map straight away */
        refreshTrack();
    }
}
/* a stop that didn't reach the server (no signal): sent when the app opens again */
setTimeout(() => { try { if (localStorage.getItem(STOP_KEY) && !sharing() && state.me) stopSend(); } catch { /* ignore */ } }, 4000);
/* after reopening the app: carry on sharing if the time isn't up */
function resumeShare() {
    const s = trackSaved(); if (!s) return;
    if (s.until <= Date.now()) { trackSave(null); return; }
    trk.until = s.until; trk.event = s.event || null; trk.note = s.note || ''; trk.svc = !!s.svc; startWatch();
    if (!trk.svc && NATIVE) hasSvc().then(ok => ok && svcStart().then(() => { trackSave({ ...s, svc: true }); }).catch(e => { svcErr = String(e?.message || e); })).catch(() => {});
    if (trk.svc) svcCheck(); else gpsFix(60000).then(sendFix).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    { const back = takeReturn(); if (back && state.me && !location.hash.startsWith(back)) location.hash = back; }
    if (sharing() && trk.svc) { if (trk.watch == null) startWatch(); svcCheck(); }
    else if (sharing()) { keepAwake(true); if (trk.watch == null && trk.native == null) startWatch(); gpsFix(20000).then(sendFix).catch(() => {}); }
    if (location.hash.startsWith('#track')) refreshTrack();
});
/* ---------- RWB Track service (RWB Android app from build 2.0.x with the service): shares with the screen off ---------- */
const RwbTrack = () => Native('RwbTrack');
let svcOk = null, svcErr = '';
async function hasSvc() {
    if (!NATIVE) return false; if (svcOk !== null) return svcOk;
    try { await RwbTrack().status(); svcOk = true; } catch { svcOk = false; }
    return svcOk;
}
async function svcStart() {
    const key = await api.trackToken();      /* a sharing key that works only while you share (setup file 46) */
    const r = await RwbTrack().start({ url: C.SUPABASE_URL, anon: C.SUPABASE_ANON_KEY, key, until: trk.until });
    trk.svc = true; return r;
}
/* the service stopped (phone restarted it, killed it…) but the time isn't up: start it again */
let svcBusy = false;
async function svcCheck() {
    if (!trk.svc || svcBusy || !sharing()) return; svcBusy = true;
    try {
        const st = await RwbTrack().status();
        if (st.lat && st.fix) trk.last = { lat: +st.lat, lng: +st.lng, acc: st.acc || null, t: st.fix };
        if (!st.running) {
            if (st.stopped && st.stopped >= (st.started || 0)) { await stopShare(true); toast(/notification/.test(st.why || '') ? 'You stopped sharing from the notification' : 'Sharing stopped'); }
            else await svcStart();   /* Android stopped it: start again */
        }
    } catch { /* ignore */ } finally { svcBusy = false; }
}
/* on the Track screen: is the background sharing healthy? (last GPS fix, last position sent, last problem) */
async function svcHealth() {
    let st; try { st = await RwbTrack().status(); } catch { return; }
    if (!trk.svc) {   /* sharing only while the app is open: say so, with a button to start the background service */
        const el = $('#trk-health') || (() => { const e = document.createElement('p'); e.id = 'trk-health'; e.className = 'small trk-health'; $('#trk-status')?.after(e); return e; })();
        el.innerHTML = `🟠 Background sharing <b>off</b>: sharing pauses when the screen is off.${svcErr ? `<br><span class="warn">${esc(svcErr)}</span>` : ''} · <button class="linkish" data-act="trk-svc">Turn on</button> · <button class="linkish" data-act="trk-report">Track report</button>`;
        actions['trk-svc'] = async () => { try { await svcStart(); svcErr = ''; trackSave({ until: trk.until, event: trk.event, note: trk.note, svc: true }); toast('Background sharing is on 📍'); refreshTrack(); } catch (e) { svcErr = String(e?.message || e); toast(`Couldn't start: ${svcErr}`, true); svcHealth(); } };
        actions['trk-report'] = () => trackReport();
        return;
    }
    if (st.lat && st.fix) trk.last = { lat: +st.lat, lng: +st.lng, acc: st.acc || null, t: st.fix };
    const el = $('#trk-health') || (() => { const e = document.createElement('p'); e.id = 'trk-health'; e.className = 'small trk-health'; $('#trk-status')?.after(e); return e; })();
    const ago = ms => !ms ? 'never' : Date.now() - ms < 90e3 ? `${Math.max(1, Math.round((Date.now() - ms) / 1000))} s ago` : `${Math.round((Date.now() - ms) / 6e4)} min ago`;
    const ok = st.running && st.sent && Date.now() - st.sent < 150e3;
    el.innerHTML = `${ok ? '🟢' : '🟠'} Background sharing ${st.running ? 'on' : '<b>stopped</b>'} · sent ${ago(st.sent)} · GPS ${ago(st.fix)}${st.acc ? ` (±${st.acc} m)` : ''}${st.error ? `<br><span class="warn">${esc(st.error)}</span>` : ''}${st.battery && st.bgLocation ? '' : ' · <button class="linkish" data-act="trk-batt">Make Track unstoppable</button>'}`;
    actions['trk-batt'] = () => batteryAsk(true);
    if (!el.querySelector('[data-act=trk-report]')) el.insertAdjacentHTML('beforeend', ' · <button class="linkish" data-act="trk-report">Track report</button>');
    actions['trk-report'] = () => trackReport();
    if (!st.running) svcCheck();
}
/* Report a MotoMart post, or anything else, to the RWB team (the Grievance Officer's queue, setup file 55) */
const REPORT_REASONS = {
    listing: ['Scam or fraud', 'Stolen, fake or illegal item', 'Wrong or misleading details', 'Abusive or offensive', 'Nudity or sexual content', 'Someone else\'s photos or details', 'Other'],
    other: ['Abuse, threats or harassment', 'Impersonation or fake profile', 'Nudity or sexual content', 'Morphed or fake photo of a person', 'My private details shared without consent', 'Scam or fraud', 'Something isn\'t working', 'Other']
};
function reportSheet(kind, ref = '', label = '') {
    const rs = REPORT_REASONS[kind] || REPORT_REASONS.other;
    openSheet(kind === 'listing' ? 'Report this post' : 'Report a problem', `<form id="rpf">
        ${label ? `<p class="small muted" style="margin-bottom:10px">${esc(label)}</p>` : ''}
        <fieldset><legend>What's wrong?</legend>${rs.map((r, i) => `<label class="check-row"><input type="radio" name="reason" value="${esc(r)}"${i ? '' : ' required'}><span>${esc(r)}</span></label>`).join('')}</fieldset>
        <label>Details <span class="muted small">${kind === 'listing' ? '(optional)' : '(who or what, where in the app, when)'}</span><textarea name="details" rows="3" maxlength="1000" placeholder="${kind === 'listing' ? 'Anything that helps the admins check' : 'e.g. a member\'s profile photo, a Track note, a MotoMart post'}"></textarea></label>
        <p class="small muted">Only the RWB team sees your report and your name. We reply within 24 hours and sort it out within 7 days; nudity, sexual content, impersonation or a morphed photo is removed within 2 hours. Grievance Officer: Sayantan Sarkar, <a href="mailto:ronin.warriors.bengal@gmail.com?subject=Grievance">ronin.warriors.bengal@gmail.com</a>. In danger? Call <a href="tel:112"><b>112</b></a>.</p>
        <button class="btn block">Send report</button></form>`, body => {
        const f = body.querySelector('#rpf');
        f.onsubmit = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f));
            if (!d.reason) return toast('Choose what\'s wrong', true);
            if (kind !== 'listing' && !String(d.details || '').trim()) return toast('Add a few details so the admins can find it', true);
            busy(f.querySelector('button.btn'), async () => { await api.report(kind, ref, label, d.reason, d.details); closeSheet(); toast('Thanks. The RWB team will look into it 🙏'); }); };
    });
}
document.addEventListener('click', e => {
    const b = e.target.closest('[data-report]'); if (!b) return;
    e.preventDefault(); reportSheet(b.dataset.report, b.dataset.ref || '', b.dataset.label || '');
});
/* Me → Delete my account (Google Play asks every app with accounts to offer this) */
document.addEventListener('click', e => {
    const b = e.target.closest('[data-del-acct]'); if (!b) return;
    const fam = isFam();
    if (!confirmBox(fam ? 'Delete your RWB FAM account?\n\nYou will no longer see your rider on Track or RWB updates. Your rider can invite you again later.'
        : 'Delete your RWB App account?\n\nYou leave RWB, and your app account, service records, bills, fuel log and documents are deleted. This can\'t be undone (an admin can add you back as a member).')) return;
    const typed = prompt('Type DELETE to confirm'); if (String(typed || '').trim().toUpperCase() !== 'DELETE') return toast('Not deleted');
    busy(b, async () => { stopShare(true); await api.deleteMyAccount(); toast('Your account is deleted. Ride safe!'); setTimeout(() => api.signOut(), 1200); });
});
/* the last 150 Track events from the phone, to send to the RWB team if sharing stops with the screen off */
async function trackReport() {
    let st = {}, lg = ''; try { st = await RwbTrack().status(); lg = (await RwbTrack().log()).log || ''; } catch { return toast('Update the RWB app to get a Track report', true); }
    const text = `RWB Track report · ${new Date().toLocaleString('en-IN')}\nApp build ${await Native('App')?.getInfo?.().then(i => i.version + ' (' + i.build + ')').catch(() => '?') || '?'} · service ${trk.svc ? 'on' : 'OFF'}${svcErr ? ' (' + svcErr + ')' : ''} · battery ${st.battery ? 'unrestricted' : 'RESTRICTED'} · location ${st.bgLocation ? 'all the time' : 'only while using'} · ${navigator.userAgent.replace(/.*Android/, 'Android').slice(0, 60)}\n\n${lg || '(no events yet)'}`;
    try { if (navigator.share) { await navigator.share({ title: 'RWB Track report', text }); return; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(text); toast('Track report copied: paste it in WhatsApp to the RWB team'); } catch { toast('Could not copy the report', true); }
}
/* two phone settings make Track unstoppable: no battery restrictions, and location "Allow all the time" */
async function batteryAsk(force = false) {
    try { if (!force && Date.now() - Number(localStorage.getItem('rwb-batt-asked') || 0) < 3 * 864e5) return; localStorage.setItem('rwb-batt-asked', String(Date.now())); } catch { /* ignore */ }
    let st = {}; try { st = await RwbTrack().status(); } catch { /* ignore */ }
    if (!force && st.battery && st.bgLocation) return;
    const item = (ok, title, how, x, btn) => `<div class="trk-set${ok ? ' ok' : ''}"><span class="ts-ico">${ok ? '✅' : '⚠️'}</span><span class="grow"><b>${title}</b><span class="small muted">${how}</span></span>${ok ? '' : `<button class="btn sm" data-x="${x}">${btn}</button>`}</div>`;
    openSheet('Make Track unstoppable', `${LOC_DISCLOSURE}
        <p class="small" style="margin-bottom:12px">Two phone settings keep your live location going with the screen off, the app minimised or swiped away, for the whole ride.</p>
        ${item(st.battery, 'Battery: no restrictions', 'So the phone never pauses RWB to save battery.', 'allow', 'Allow')}
        ${item(st.bgLocation, 'Location: Allow all the time', 'Settings → Permissions → Location → <b>Allow all the time</b>. Only used while you share.', 'always', 'Open settings')}
        <ol class="small help-steps" style="margin-top:14px"><li>Samsung: also Settings → Battery → Background usage limits → add RWB to <b>Never sleeping apps</b>.</li><li>Xiaomi, Redmi, Poco, Realme, Oppo, Vivo, OnePlus: Settings → Apps → RWB → Battery → <b>No restrictions</b>, and turn on <b>Autostart</b>.</li></ol>
        <button class="btn ghost block" data-x="later" style="margin-top:10px">Done</button>`, body => {
        body.querySelector('[data-x=allow]')?.addEventListener('click', () => { markReturn(location.hash || '#track'); RwbTrack()?.battery().catch(() => {}); closeSheet(); });
        body.querySelector('[data-x=always]')?.addEventListener('click', () => { markReturn(location.hash || '#track'); RwbTrack()?.settings().catch(() => {}); closeSheet(); });
        body.querySelector('[data-x=later]').onclick = () => closeSheet();
    });
}
/* ---------- old RWB Android apps: a blocker that can't be skipped ---------- */
/* Builds before 106 (2.0.6) don't have the new background Track service or the new icon. versionCode = 100 + build number. */
const MIN_NATIVE_BUILD = 106;
/* the newest published build: download/latest.json is written by the build robot together with the new app file */
let latestBuild = null, latestAt = 0;
async function newestBuild() {
    if (latestBuild && Date.now() - latestAt < 30 * 6e4) return latestBuild;
    try { const r = await fetch(`https://roninwb.in/download/latest.json?v=${Date.now()}`, { cache: 'no-store' }); const j = await r.json(); if (j.build) { latestBuild = Number(j.build); latestAt = Date.now(); } } catch { /* offline: use what we know */ }
    return Math.max(latestBuild || 0, MIN_NATIVE_BUILD);
}
/* the Google Play Store listing (set PLAY_LIVE once the app is public on the Play Store) */
const PLAY_LIVE = true, PLAY_URL = 'https://play.google.com/store/apps/details?id=in.roninwb.twa';
/* which RWB Android app this is: "play" (from the Play Store) or "web" (the APK from roninwb.in) */
let nativeInfoP = null;
const nativeInfo = () => nativeInfoP ??= (async () => { try { return await RwbTrack().info(); } catch { return { channel: 'web' }; } })();
async function nativeOutdated() {
    if (!NATIVE) return false;
    if (PLAY_LIVE && (await nativeInfo()).channel !== 'play') return true;   /* the old APK copy: move to the Play Store version */
    if ((await nativeInfo()).channel === 'play') {
        /* Play Store app: only when the Play Store actually has the newer version (it can take a day to be approved) */
        try { const r = await RwbTrack().playUpdate({ start: false }); return !!r?.available; } catch { return false; }
    }
    try { const i = await Native('App').getInfo(); const b = Number(i.build); if (b) return b < await newestBuild(); } catch { /* ignore */ }
    return !(await hasSvc());
}
/* back in the app after a while: a new build may have come out meanwhile */
async function updateCheck() { if (NATIVE && !document.body.classList.contains('blocked') && await nativeOutdated()) nativeBlocker(); }
async function nativeBlocker(web = false) {
    const play = !web && NATIVE && (await nativeInfo()).channel === 'play';
    if (play) return playBlocker();
    if (!web && NATIVE && PLAY_LIVE) return moveToPlayBlocker();
    if (web && PLAY_LIVE) return playGetBlocker();
    tabbar.hidden = true; document.body.dataset.route = 'gate'; document.body.classList.add('blocked');
    const html = `<div class="blocker" role="alertdialog" aria-modal="true" aria-labelledby="blk-h"><div class="blk-card">
        <img src="icons/app-icon-256.webp" alt="" class="blk-logo">
        <p class="blk-kicker">${web ? 'RWB Android app' : 'RWB App'}</p>
        <h1 id="blk-h">${web ? 'Get the RWB app' : 'New Update Available'}</h1>
        ${web ? `<p>On Android, RWB works through the <b>RWB Android app</b>. <b>Track</b> (live location with the screen off) and <b>RWB FAM</b> only work there.</p>
        <ol class="blk-steps">
            <li>Remove the RWB web app: press and hold its icon on your home screen → <b>Uninstall</b> / <b>Remove</b>.</li>
            <li>Tap <b>Download the RWB app</b> below.</li>
            <li>Open the downloaded file and tap <b>Install</b> (allow installs from Chrome if Android asks).</li>
            <li>Open <b>RWB</b> and sign in with Google.</li>
        </ol>` : `<p>Click to update. The new version downloads; open it and tap <b>Update</b>.</p>
        <ol class="blk-steps">
            <li>Tap <b>Update now</b> below.</li>
            <li>When the download finishes, open it and tap <b>Update</b> (allow installs if Android asks).</li>
            <li>Open RWB again. You stay signed in.</li>
        </ol>`}
        <button class="btn block" data-x="get">${web ? '⬇ Download the RWB app' : '⬇ Update now'}</button>
        <p class="small muted" style="margin-top:12px">${web ? 'On iPhone? Open roninwb.in/app in Safari.' : 'Download didn\'t start? Open <b>roninwb.in/get</b> in Chrome.'} Your RWB account, records and settings stay safe.</p>
    </div></div>`;
    app.innerHTML = html;
    const bind = () => app.querySelector('[data-x=get]')?.addEventListener('click', () => {
        if (web) { const a = document.createElement('a'); a.href = apkUrl(); a.download = 'RWB-App.apk'; document.body.append(a); a.click(); a.remove(); return; }
        const url = apkUrl();   /* straight to the newest app file: Android shows it as an update */
        (Native('Browser')?.open({ url }) || Promise.reject()).catch(() => { location.href = url; });
    });
    bind();
    /* keep it on screen whatever happens */
    new MutationObserver(() => { if (!app.querySelector('.blocker')) { app.innerHTML = html; bind(); } tabbar.hidden = true; }).observe(app, { childList: true, subtree: false });
    addEventListener('hashchange', () => { if (!app.querySelector('.blocker')) { app.innerHTML = html; bind(); } }, true);
}
/* Play Store app: Google's own update screen; the Play Store page if that can't open */
function playBlocker() {
    keepBlocker(`<div class="blocker" role="alertdialog" aria-modal="true" aria-labelledby="blk-h"><div class="blk-card">
        <img src="icons/app-icon-256.webp" alt="" class="blk-logo"><p class="blk-kicker">RWB App</p>
        <h1 id="blk-h">New Update Available</h1>
        <p>A new version of RWB is on the Google Play Store. Tap <b>Update now</b>: it takes a moment and you stay signed in.</p>
        <button class="btn block" data-x="get">⬆ Update now</button>
        <p class="small muted" style="margin-top:12px">Your RWB account, records and settings stay safe.</p></div></div>`, async () => {
        try { const r = await RwbTrack().playUpdate({ start: true }); if (r?.started) return; } catch { /* fall back */ }
        RwbTrack()?.openStore().catch(() => { location.href = PLAY_URL; });
    });
}
/* the old APK copy (from roninwb.in), now that RWB is on the Play Store: Android can't put the Play copy over the APK
   (they're signed differently), so the old app is uninstalled first. Accounts and records are online, nothing is lost. */
function moveToPlayBlocker() {
    keepBlocker(`<div class="blocker" role="alertdialog" aria-modal="true" aria-labelledby="blk-h"><div class="blk-card">
        <img src="icons/app-icon-256.webp" alt="" class="blk-logo"><p class="blk-kicker">RWB App</p>
        <h1 id="blk-h">RWB is now on Google Play</h1>
        <p>This copy of RWB won't get updates any more. Move to the Google Play version in a minute:</p>
        <ol class="blk-steps"><li>Tap <b>Open Google Play</b> below.</li>
            <li>Go to your home screen, press and hold the <b>RWB</b> icon and tap <b>Uninstall</b>.</li>
            <li>Back in the Play Store, tap <b>Install</b>. Open RWB and sign in with Google.</li></ol>
        <button class="btn block" data-x="get">▶ Open Google Play</button>
        <p class="small muted" style="margin-top:12px">Your RWB account, records and settings are saved online and stay safe.</p></div></div>`, () => {
        (RwbTrack()?.openStore?.() || Promise.reject()).catch(() => (Native('Browser')?.open({ url: PLAY_URL }) || Promise.reject()).catch(() => { location.href = PLAY_URL; }));
    });
}
/* Android browser, once RWB is on the Play Store: install it from there */
function playGetBlocker() {
    keepBlocker(`<div class="blocker" role="alertdialog" aria-modal="true" aria-labelledby="blk-h"><div class="blk-card">
        <img src="icons/app-icon-256.webp" alt="" class="blk-logo"><p class="blk-kicker">RWB Android app</p>
        <h1 id="blk-h">Get RWB on Google Play</h1>
        <p>On Android, RWB works through the <b>RWB app from the Google Play Store</b>. <b>Track</b> and <b>RWB FAM</b> only work there.</p>
        <ol class="blk-steps"><li>Remove the RWB web app if it's on your home screen (press and hold its icon → <b>Remove</b>).</li>
            <li>Tap <b>Get it on Google Play</b> below and tap <b>Install</b>.</li><li>Open <b>RWB</b> and sign in with Google.</li></ol>
        <button class="btn block" data-x="get">▶ Get it on Google Play</button>
        <p class="small muted" style="margin-top:12px">On iPhone? Open roninwb.in/app in Safari. Your RWB account, records and settings stay safe.</p></div></div>`, () => { location.href = PLAY_URL; });
}
function keepBlocker(html, go) {
    tabbar.hidden = true; document.body.dataset.route = 'gate'; document.body.classList.add('blocked');
    const show = () => { app.innerHTML = html; app.querySelector('[data-x=get]')?.addEventListener('click', go); };
    show();
    new MutationObserver(() => { if (!app.querySelector('.blocker')) show(); tabbar.hidden = true; }).observe(app, { childList: true, subtree: false });
    addEventListener('hashchange', () => { if (!app.querySelector('.blocker')) show(); }, true);
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
}
/* an older RWB Android app (without the Track service): ask to update once per visit */
async function nativeUpdateAsk() {
    if (!NATIVE || (await nativeInfo()).channel === 'play' || await hasSvc()) return;   /* the Play Store app only ever updates through Play */
    try { if (sessionStorage.getItem('rwb-native-update')) return; sessionStorage.setItem('rwb-native-update', '1'); } catch { /* ignore */ }
    const el = document.createElement('div'); el.className = 'promo'; el.setAttribute('role', 'dialog');
    el.innerHTML = `<div class="promo-card"><span class="promo-ico">🚀</span><h2>Update the RWB app</h2>
        <p>The new version keeps <b>Track sharing with your screen off</b> for the whole ride.</p>
        <button class="btn block" data-x="get">Download the update</button>
        <p class="small muted">Open the file when it's downloaded and tap <b>Update</b>. Your account stays signed in.</p>
        <button class="btn ghost block" data-x="later">Later</button></div>`;
    el.addEventListener('click', e => { const x = e.target.closest('[data-x]')?.dataset.x; if (e.target === el || x === 'later') el.remove();
        if (x === 'get') { el.remove(); (Native('Browser')?.open({ url: apkUrl() }) || Promise.reject()).catch(() => { location.href = apkUrl(); }); } });
    document.body.append(el);
}
/* the middle Track button lights up (spinning green ring + dot) while ANYONE is sharing on Track, so everyone opening the app sees
   a ride is live. The count comes from track_live_count (file 85, a few bytes): on open, on coming back to the app, every 2 min while visible,
   and whenever the Track map loads its riders. Your own sharing lights it at once. */
var liveRide = { n: 0, at: 0 };   /* var: doRender may run before this line */
function trackBadge() { document.getElementById('track-tab')?.classList.toggle('live', sharing() || (liveRide?.n || 0) > 0); }
async function liveCheck(force) {
    if (!liveRide || !state.me || document.hidden || (!force && Date.now() - liveRide.at < 110e3)) return;
    liveRide.at = Date.now();
    try { liveRide.n = Number(await api.trackLiveCount()) || 0; } catch { /* offline: keep the last answer */ }
    trackBadge();
}
setInterval(() => liveCheck(), 120e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveCheck(); });

/* ---------- the middle button: Share / View / SOS ---------- */
document.getElementById('track-tab')?.addEventListener('click', e => { e.preventDefault(); if (!state.me) return; if (isFam()) { if (location.hash.startsWith('#track')) refreshTrack(); else location.hash = '#track'; } else trackMenu(); });
function trackMenu() {
    const on = sharing();
    openSheet('Track', `<div class="trk-menu">
        <button type="button" class="trk-opt share${on ? ' on' : ''}" data-x="share"><span class="trk-ico">${on ? '🟢' : '📍'}</span><b>${on ? 'Sharing live' : 'Share'}</b><small>${on ? esc(leftTxt(trk.until)) + ' · tap to stop or change' : 'Share your live location'}</small></button>
        <button type="button" class="trk-opt view" data-x="view"><span class="trk-ico">🗺️</span><b>View</b><small>See riders live on the map</small></button>
        <button type="button" class="trk-opt sos${mySos() ? ' on' : ''}" data-x="sos"><span class="trk-ico">🆘</span><b>${mySos() ? 'SOS sent' : 'SOS'}</b><small>${mySos() ? 'Tap to cancel or see it' : 'Alert the RWB team with your location'}</small></button></div>`, body => {
        body.querySelector('[data-x=share]').onclick = () => shareSheet();
        body.querySelector('[data-x=view]').onclick = () => { closeSheet(); location.hash = '#track'; };
        body.querySelector('[data-x=sos]').onclick = () => sosSheet();
    });
}
/* RWB events on right now (from 3 hours before the start to 3 hours after the end) */
const eventsNow = () => { const t = Date.now(); return (state.evd?.events || []).filter(e => e.status === 'live' && t >= Date.parse(e.starts_at) - 3 * 36e5
    && t <= (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 12 * 36e5) + 3 * 36e5); };
function shareSheet(eventId = null, eventTitle = '') {
    const on = sharing();
    openSheet(on ? 'Sharing your location' : 'Share live location', `${on ? `<div class="trk-live"><span class="dot"></span><span class="grow"><b>You're sharing live</b><span class="small muted">${esc(leftTxt(trk.until))}${trk.event ? ' · for an event ride' : ''}</span></span></div>
            <button class="btn danger block" data-x="stop" style="margin:12px 0 18px">Stop sharing</button><p class="small muted" style="margin-bottom:8px">Or share for:</p>` : `<p class="small muted" style="margin-bottom:12px">Every RWB member on the app can see you on the Track map while you share, and gets a notification that you've started riding.${eventTitle ? ` You'll show as riding <b>${esc(eventTitle)}</b>.` : ''}</p>`}
        <div class="trk-evpick" id="trk-evpick" hidden></div>
        <label class="trk-note">Add a note <span class="muted small">(optional)</span><input id="trk-note" maxlength="${TRACK_NOTE_MAX}" placeholder="e.g. towards Simlipal!" value="${esc(on ? trk.note || '' : '')}" autocomplete="off"><small class="hint"><span id="trk-note-n">${on ? (trk.note || '').length : 0}</span>/${TRACK_NOTE_MAX} · shows next to your name on the map</small></label>
        <div class="trk-hours">${TRACK_HOURS.map(([h, t]) => `<button type="button" class="chip" data-h="${h}">${t}</button>`).join('')}</div>
        ${NativeGeo() ? '<p class="small muted" style="margin-top:12px">Keeps sharing with the screen locked. A small notification shows while it runs.</p>'
            : '<p class="small muted trk-tip" style="margin-top:12px">💡 Keep the RWB App open on your phone mount: we keep the screen awake. If you lock the phone or switch apps, sharing pauses until you come back. Plug in a charger for long rides.</p>' + (/android/i.test(navigator.userAgent) ? '<p class="small" style="margin-top:8px">📲 <a href="' + apkUrl() + '"><b>Get the RWB Android app</b></a> to keep sharing with the screen locked.</p>' : '')}`, body => {
        body.querySelector('[data-x=stop]')?.addEventListener('click', () => { closeSheet(); stopShare(); });
        const note = body.querySelector('#trk-note'); note.oninput = () => { body.querySelector('#trk-note-n').textContent = note.value.length; };
        /* riding an RWB event that's on now? pick it, so you show under it on the map (Going to one picks it for you) */
        let pick = eventId ?? (on ? trk.event : null);
        const evBox = body.querySelector('#trk-evpick'), drawEv = () => {
            const list = eventsNow(); if (pick && !list.some(e => e.id === pick)) { const e = (state.evd?.events || []).find(x => x.id === pick); if (e) list.unshift(e); }
            if (!list.length || isFam()) { evBox.hidden = true; return; }
            if (pick == null && !on) { const going = list.find(e => state.evd?.mine?.[e.id]?.status === 'going'); if (going) pick = going.id; }
            evBox.hidden = false;
            evBox.innerHTML = `<p class="small muted">Riding an RWB event?</p><div class="trk-evs"><button type="button" class="chip" aria-pressed="${!pick}" data-ev="">No event</button>${list.map(e => `<button type="button" class="chip" aria-pressed="${e.id === pick}" data-ev="${e.id}">🏍️ ${esc(e.title)}</button>`).join('')}</div>`;
            evBox.querySelectorAll('[data-ev]').forEach(c => c.onclick = () => { pick = c.dataset.ev ? Number(c.dataset.ev) : null; drawEv(); });
        };
        drawEv(); if (!isFam()) loadEvents().then(() => { if (evBox.isConnected) drawEv(); }).catch(() => {});
        body.querySelectorAll('[data-h]').forEach(b => b.onclick = () => busy(b, async () => {
            await startShare(Number(b.dataset.h), pick, note.value); closeSheet();
            if (!location.hash.startsWith('#track') && !location.hash.startsWith('#events/')) location.hash = '#track'; else refreshTrack();
        }));
    });
}

/* ---------- SOS: press and hold, so it can't go by accident ---------- */
/* my open SOS (so the SOS button shows "Cancel SOS" instead of sending another) */
const SOS_KEY = 'rwb-my-sos';
const mySos = () => { try { const v = JSON.parse(localStorage.getItem(SOS_KEY) || 'null'); return v && Date.now() - v.at < 24 * 36e5 ? v : null; } catch { return null; } };
const setMySos = v => { try { v ? localStorage.setItem(SOS_KEY, JSON.stringify(v)) : localStorage.removeItem(SOS_KEY); } catch { /* ignore */ } };
function sosSentSheet(s) {
    openSheet('SOS', `<div class="sos-sent"><span class="sos-pulse">🆘</span><b>SOS sent</b><span class="small">${esc(timeAgo(new Date(s.at).toISOString()))}. Every RWB admin and coordinator got an urgent alert with your location.</span></div>
        <button class="btn block" data-x="map" style="margin-top:14px">🗺️ See it on the map</button>
        <button class="btn ghost block sos-cancel" data-x="cancel" style="margin-top:10px">✅ Cancel SOS · I'm safe</button>
        <p class="small muted" style="margin:14px 0 8px">In danger right now? Call <a href="tel:112"><b>112</b></a> (emergency).</p>
        <div id="sos-admins" class="small muted"></div>`, body => {
        body.querySelector('[data-x=map]').onclick = () => { closeSheet(); location.hash = '#track/sos'; };
        body.querySelector('[data-x=cancel]').onclick = e => busy(e.currentTarget, async () => {
            await api.trackSosResolve(s.id); setMySos(null); closeSheet(); toast("SOS cancelled. The RWB team is told you're safe.");
            if (location.hash.startsWith('#track')) refreshTrack();
        });
        sosAdmins(body);
    });
}
function sosAdmins(body) {
    api.rwbAdmins().then(list => { const el = body.querySelector('#sos-admins'); if (el) el.innerHTML = list.length ? `<div class="group">${list.slice(0, 6).map(a => `<div class="bike-row"><span class="grow"><b>${esc(a.full_name)}</b></span><a class="btn sm ghost" href="tel:+91${esc(a.phone)}">📞 Call</a></div>`).join('')}</div>` : ''; }).catch(() => {});
}
function sosSheet() {
    const open = mySos(); if (open) return sosSentSheet(open);
    openSheet('SOS', `<p class="small" style="margin-bottom:14px">Sends an <b>urgent alert with your location</b> to every RWB admin and coordinator. Use it only in a real emergency.</p>
        <button type="button" class="sos-hold" id="sos-hold"><span class="sos-fill"></span><b>Hold for 2 seconds</b><small>to send SOS</small></button>
        <p class="small muted" style="margin:14px 0 8px">In danger right now? Call <a href="tel:112"><b>112</b></a> (emergency).</p>
        <div id="sos-admins" class="small muted">Loading the RWB team…</div>`, body => {
        const b = body.querySelector('#sos-hold'); let t = null;
        const go = () => { b.classList.remove('holding'); b.disabled = true; b.querySelector('b').textContent = 'Sending…'; sendSos().then(ok => { if (!ok) { b.disabled = false; b.querySelector('b').textContent = 'Hold for 2 seconds'; } }); };
        const down = e => { e.preventDefault(); if (b.disabled) return; b.classList.add('holding'); navigator.vibrate?.(30); t = setTimeout(go, 2000); };
        const up = () => { clearTimeout(t); b.classList.remove('holding'); };
        b.addEventListener('pointerdown', down); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, up));
        b.addEventListener('contextmenu', e => e.preventDefault());
        sosAdmins(body);
    });
}
/* the fastest good position: the background service's last fix, the app's, the phone's cached one, then a quick network fix */
async function quickFix() {
    if (trk.svc) { try { const st = await RwbTrack().status(); if (st.lat && st.fix && Date.now() - st.fix < 180000) return { lat: +st.lat, lng: +st.lng, acc: st.acc || null, t: st.fix }; } catch { /* ignore */ } }
    if (trk.last && Date.now() - trk.last.t < 120000) return trk.last;
    return new Promise((ok, no) => {
        if (!('geolocation' in navigator)) return no(new Error('This phone can\'t share its location.'));
        navigator.geolocation.getCurrentPosition(p => ok(posOf(p)), () => gpsFix(30000).then(ok, no), { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
    });
}
async function sendSos() {
    let p; try { p = await quickFix(); } catch (e) { toast(e.message, true); return false; }
    let id; try { id = await api.trackSos(p.lat, p.lng, p.acc); }
    catch (e) { toast(e.message || 'SOS not sent. Call an admin.', true); return false; }
    setMySos({ id, at: Date.now() });
    navigator.vibrate?.([200, 100, 200]);
    toast('🆘 SOS sent to the RWB team with your location');
    sosSentSheet(mySos());
    /* a sharper position follows (updates the same SOS, no second alert) */
    if (!p.acc || p.acc > 40) gpsFix(0).then(q => api.trackSos(q.lat, q.lng, q.acc)).catch(() => {});
    return true;
}

/* ---------- the map ---------- */
let leafletReady = null;
function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return leafletReady ??= new Promise((ok, no) => {
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css'; document.head.append(css);
        const s = document.createElement('script'); s.src = LEAFLET + 'leaflet.min.js'; s.onload = () => ok(window.L); s.onerror = () => { leafletReady = null; no(new Error('The map could not load. Check your internet.')); }; document.head.append(s);
    });
}
const darkMode = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
/* map styles: Clean (CARTO, has a real night map), Street (OpenStreetMap), Satellite (Esri + place names) */
const TRK_STYLE_KEY = 'rwb-trk-style';
const TRK_STYLES = [['street', 'Street', 'Every lane and landmark'], ['clean', 'Clean', 'Softer colours, a proper night map'], ['satellite', 'Satellite', 'Real photos from above']];
const trkStyle = () => { try { const s = localStorage.getItem(TRK_STYLE_KEY); return TRK_STYLES.some(x => x[0] === s) ? s : 'street'; } catch { return 'street'; } };
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI = n => `https://server.arcgisonline.com/ArcGIS/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`;
function trkTiles(L, map) {
    (trk.tiles || []).forEach(t => map.removeLayer(t)); trk.tiles = [];
    const s = trkStyle(), dark = darkMode(), add = (url, o) => trk.tiles.push(L.tileLayer(url, { maxZoom: 19, ...o }).addTo(map));
    if (s === 'satellite') {
        add(ESRI('World_Imagery'), { maxNativeZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
        add(ESRI('Reference/World_Boundaries_and_Places'), { maxNativeZoom: 18, className: 'trk-labels' });
    } else if (s === 'clean') {
        if (dark) { add(ESRI('Canvas/World_Dark_Gray_Base'), { maxNativeZoom: 16, attribution: 'Tiles © Esri, HERE, Garmin, © OpenStreetMap contributors' }); add(ESRI('Canvas/World_Dark_Gray_Reference'), { maxNativeZoom: 16 }); }
        else add(ESRI('World_Street_Map'), { maxNativeZoom: 18, attribution: 'Tiles © Esri, HERE, Garmin, © OpenStreetMap contributors' });
    } else add('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { className: dark ? 'trk-tiles-dark' : '', attribution: OSM_ATTR });
    map.getContainer().dataset.style = s;
}
function layersSheet() {
    const cur = trkStyle();
    openSheet('Map style', `<div class="trk-styles">${TRK_STYLES.map(([k, t, s]) => `<button type="button" class="trk-style${k === cur ? ' on' : ''}" data-s="${k}"><span class="ts-prev ${k}"></span><b>${t}</b><small>${s}</small></button>`).join('')}</div>`, body => {
        body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { try { localStorage.setItem(TRK_STYLE_KEY, b.dataset.s); } catch { /* ignore */ } if (trk.map) trkTiles(trk.L, trk.map); closeSheet(); });
    });
}

/* ---------- what each rider is doing right now ---------- */
const kmhOf = r => (r.spd != null && r.spd >= 0 ? r.spd * 3.6 : null);
const durTxt = ms => { const m = Math.max(1, Math.round(ms / 6e4)); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`; };
function rState(r) {
    const now = Date.now(), age = now - Date.parse(r.at);
    if (age > SIG_STALE) return { k: 'stale', txt: `Last seen ${timeAgo(r.at)}` };
    const kmh = kmhOf(r), still = r.moved_at ? now - Date.parse(r.moved_at) : 0;
    if (kmh != null && kmh >= 4 && still < 150000) return { k: 'move', kmh: Math.round(kmh), txt: `${Math.round(kmh)} km/h` };
    return { k: 'stop', txt: still > 150000 ? `Stopped · ${durTxt(still)}` : 'Stopped' };
}
const evName = r => r.event || (r.event_id ? (state.evd?.events || []).find(e => e.id === r.event_id)?.title : '') || '';
const rideKm = r => (r.ride_km > 0 ? `${Number(r.ride_km).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km` : '');
const distTxt = m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

const TI = {   /* small line icons for the map buttons */
    layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c.5-3.6 3-5.6 6-5.6s5.5 2 6 5.6"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.4c2.6.1 4.2 1.8 4.5 4.6"/></svg>',
    me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" class="fill"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>',
    shrink: '<svg viewBox="0 0 24 24"><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>'
};
function riderIcon(L, r, sos = false, dim = false) {
    const st = sos ? { k: 'sos' } : rState(r), pic = r.avatar ? `<img src="${esc(r.avatar)}" alt="" onerror="this.remove()">` : '';
    const arrow = st.k === 'move' && r.hdg != null ? `<b class="trk-hdg" style="--h:${Math.round(r.hdg)}deg"></b>` : '';
    const label = sos ? 'SOS' : esc(r.nick || r.name.split(' ')[0]);
    const html = `<div class="trk-pin ${st.k}${r.me ? ' me' : ''}${sos ? ' sos' : ''}${dim ? ' dim' : ''}"><span class="trk-ring">${arrow}<span class="trk-face">${pic}<i>${esc(initials({ full_name: r.name }))}</i></span></span><em>${label}${st.k === 'move' ? `<small>${st.kmh}</small>` : ''}</em></div>`;
    return { html, icon: () => L.divIcon({ className: 'trk-pin-wrap', iconSize: [56, 62], iconAnchor: [28, 26], html }) };
}
async function viewTrack() {
    const param = state.param || '';
    trk.filter = /^e\d+$/.test(param) ? Number(param.slice(1)) : null;
    if (isFam()) trk.filter = null;
    app.innerHTML = top('Track') + `<section class="trk-wrap">
        <div class="trk-map-box" id="trk-box"><div id="trk-map" class="trk-map"></div>
            <div class="trk-chips" id="trk-chips"></div>
            <div class="trk-fab"><button type="button" class="tf" data-act="trk-full" aria-label="Full screen" id="trk-fullb">${TI.full}</button><button type="button" class="tf" data-act="trk-layers" aria-label="Map style">${TI.layers}</button>
                <span class="tf-zoom"><button type="button" class="tf" data-act="trk-zin" aria-label="Zoom in">${TI.plus}</button><button type="button" class="tf" data-act="trk-zout" aria-label="Zoom out">${TI.minus}</button></span>
                <button type="button" class="tf" data-act="trk-fit" aria-label="Show everyone">${TI.fit}</button><button type="button" class="tf me" data-act="trk-me" aria-label="Centre on me" id="trk-meb">${TI.me}</button></div>
            <div class="trk-hud" id="trk-hud" hidden></div>
            <div class="trk-follow" id="trk-follow" hidden></div>
            <div class="trk-signal" id="trk-signal" role="status" hidden></div>
        </div>
        <div class="trk-bar">
            <div class="trk-status" id="trk-status"></div>
            <div class="trk-actions"${isFam() ? ' hidden' : ''}><button class="btn" data-act="trk-share" id="trk-share"></button><button class="btn sos-btn" data-act="trk-sos">🆘 SOS</button></div>
        </div>
        <div class="trk-stats" id="trk-stats"></div>
        <div id="trk-list" class="trk-list">${SKEL(3)}</div></section>`;
    actions = { 'trk-share': () => shareSheet(trk.filter, trk.filter ? (state.evd?.events || []).find(e => e.id === trk.filter)?.title : ''), 'trk-sos': () => sosSheet(),
        'trk-all': () => setFilter(null), 'trk-ev': el => setFilter(Number(el.dataset.e)), 'trk-rider': el => openRider(el.dataset.k), 'trk-fit': () => { trkFollow(null); fitAll(true); },
        'trk-me': () => centreMe(), 'trk-layers': () => layersSheet(), 'trk-full': () => trkFull(), 'trk-zin': () => trk.map?.zoomIn(), 'trk-zout': () => trk.map?.zoomOut(),
        'trk-unfollow': () => trkFollow(null) };
    $('#trk-box').addEventListener('click', e => {   /* full screen: the box sits outside the page, so its buttons need their own listener */
        if (app.contains(e.currentTarget)) return;
        const el = e.target.closest('[data-act]'), fn = el && actions[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
    });
    trk.fitted = false; trk.sosFocused = false; trk.focus = null; trk.follow = null; trk.markers.clear(); trk.sosMarkers.clear(); trk.map = null; trk.meDot = null; trk.tiles = []; document.querySelectorAll('body > .trk-map-box').forEach(b => b.remove()); trk.boxHome = null; document.body.classList.remove('trk-full-on');
    let L; try { L = trk.L = await loadLeaflet(); } catch (e) { $('#trk-map').innerHTML = `<p class="warn" style="margin:16px">${esc(e.message)}</p>`; }
    if (L && $('#trk-map')) {
        const map = trk.map = L.map('trk-map', { zoomControl: false, attributionControl: true, zoomSnap: 0.5 }).setView([22.5726, 88.3639], 11);
        map.attributionControl.setPrefix(false); map.attributionControl.setPosition('bottomright');
        trkTiles(L, map);
        map.on('dragstart', () => { if (trk.follow) trkFollow(null); });
    }
    if (!isFam()) loadEvents().then(() => { if (location.hash.startsWith('#track')) refreshTrack(true); }).catch(() => {});
    await refreshTrack();
    viewWatch(true);
    clearInterval(trk.poll);
    trk.poll = setInterval(() => { if (!location.hash.startsWith('#track')) { viewWatch(false); return clearInterval(trk.poll); } if (document.visibilityState === 'visible') refreshTrack(); }, 15000);
    clearInterval(trk.sigTick);
    trk.sigTick = setInterval(() => { if (!location.hash.startsWith('#track')) return clearInterval(trk.sigTick); trackSignal(); hud(); }, 7000);
}
function setFilter(id) {
    trk.filter = id || null; trk.fitted = false;
    history.replaceState(null, '', id ? `#track/e${id}` : '#track');
    refreshTrack(true);
}
/* full-screen map (the phone's Back button or the button again closes it) */
function trkFull(on) {
    const box = $('#trk-box'); if (!box) return;
    on = on ?? !box.classList.contains('full');
    /* moved to <body> while full screen: the screen's own entrance effect would otherwise keep it inside the page */
    if (on && !trk.boxHome) { trk.boxHome = document.createComment('trk-box'); box.before(trk.boxHome); document.body.append(box); }
    if (!on && trk.boxHome) { trk.boxHome.isConnected ? trk.boxHome.replaceWith(box) : box.remove(); trk.boxHome = null; }
    box.classList.toggle('full', on); document.body.classList.toggle('trk-full-on', on);
    const b = $('#trk-fullb'); if (b) { b.innerHTML = on ? TI.shrink : TI.full; b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); }
    setTimeout(() => trk.map?.invalidateSize(), 30);
}
addEventListener('hashchange', () => { if (!location.hash.startsWith('#track')) { if (trk.boxHome) trkFull(false); document.body.classList.remove('trk-full-on'); viewWatch(false); } });
document.addEventListener('visibilitychange', () => { if (location.hash.startsWith('#track') && trk.map) viewWatch(document.visibilityState === 'visible'); });

/* ---------- your own position on the map, live speed (only while the Track screen is open) ---------- */
async function viewWatch(on) {
    if (!on || !('geolocation' in navigator)) { if (trk.vw != null) { navigator.geolocation.clearWatch(trk.vw); trk.vw = null; } return; }
    if (trk.vw != null) return;
    if (!NATIVE && !trk.vfix) {   /* don't pop the browser's location question just for looking at the map */
        try { const p = await navigator.permissions?.query({ name: 'geolocation' }); if (p && p.state !== 'granted') return; } catch { /* unknown: carry on */ }
    }
    trk.vw = navigator.geolocation.watchPosition(p => onViewFix(posOf(p)), () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function onViewFix(p) {
    const prev = trk.vfix; let spd = p.spd;
    if ((spd == null || Number.isNaN(spd)) && prev) { const dt = (p.t - prev.t) / 1000; if (dt > 0.5 && dt < 20) spd = distM(prev, p) / dt; }
    p.kmh = spd != null && p.acc <= 60 ? spd * 3.6 : null;
    if (p.kmh != null && p.kmh < 3) p.kmh = 0;
    if (sharing() && p.kmh) trk.myTop = Math.max(trk.myTop || 0, p.kmh);
    trk.vfix = p; onFix(p);
    if (!prev && trk.data) refreshTrack(true);   /* first fix: distances in the list */
    drawMe(); hud();
    if (trk.follow === 'me' && trk.map) trk.map.panTo([p.lat, p.lng], { animate: true, duration: 0.4 });
}
function drawMe() {
    const L = trk.L, map = trk.map, p = trk.vfix; if (!L || !map || !p) return;
    const mine = trk.data?.riders.find(r => r.me), mk = mine && trk.markers.get(mine.id);
    if (mk) mk.setLatLng([p.lat, p.lng]);   /* sharing: your pin follows your phone, not the last sent spot */
    if (!trk.meDot) {
        trk.meAcc = L.circle([p.lat, p.lng], { radius: p.acc || 30, className: "trk-acc", color: "#3b82f6", weight: 1, opacity: .35, fillOpacity: .12, interactive: false }).addTo(map);
        trk.meDot = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'trk-me-wrap', iconSize: [22, 22], iconAnchor: [11, 11], html: '<span class="trk-me-dot"></span>' }), interactive: false, zIndexOffset: 400 }).addTo(map);
    }
    trk.meDot.setLatLng([p.lat, p.lng]); trk.meAcc.setLatLng([p.lat, p.lng]).setRadius(Math.min(p.acc || 30, 300));
    trk.meDot.getElement()?.classList.toggle('hide', !!mk); trk.meAcc.getElement?.()?.classList.toggle('hide', !!mk);
}
function hud() {
    const el = $('#trk-hud'); if (!el) return;
    const p = trk.vfix, fresh = p && Date.now() - p.t < 30000;
    if (!fresh || isFam()) { el.hidden = true; return; }
    const mine = trk.data?.riders.find(r => r.me), top = Math.round(Math.max(mine?.top_spd ? mine.top_spd * 3.6 : 0, trk.myTop || 0));
    el.hidden = false;
    el.innerHTML = `<span class="hud-spd"><b>${p.kmh == null ? '–' : Math.round(p.kmh)}</b><small>km/h</small></span><span class="hud-sub">${sharing()
        ? `<span class="dot"></span>${mine && rideKm(mine) ? `${rideKm(mine)} this ride` : 'Live'}${top ? ` · top ${top}` : ''}`
        : 'Your speed'}${p.acc > 60 ? ' · weak GPS' : ''}</span>`;
}
async function centreMe() {
    const map = trk.map; if (!map) return;
    const b = $('#trk-meb');
    if (trk.follow === 'me') { trkFollow(null); return; }
    let p = trk.vfix && Date.now() - trk.vfix.t < 30000 ? trk.vfix : null;
    if (!p) { b?.classList.add('busy'); try { p = await gpsFix(10000); onViewFix(p); viewWatch(true); } catch (e) { toast(e.message, true); return; } finally { b?.classList.remove('busy'); } }
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate: true });
    trkFollow('me');
}
/* keep the map on you or on one rider as they move; dragging the map stops it */
function trkFollow(who) {
    trk.follow = who;
    $('#trk-meb')?.classList.toggle('on', who === 'me');
    const el = $('#trk-follow'); if (!el) return;
    const r = who && who !== 'me' ? trk.data?.riders.find(x => x.id === who) : null;
    el.hidden = !r;
    if (r) el.innerHTML = `<span>Following <b>${esc(r.nick || firstName({ full_name: r.name }))}</b></span><button type="button" data-act="trk-unfollow" aria-label="Stop following">✕</button>`;
}
async function refreshTrack(redraw) {
    if (!$('#trk-status')) return;
    let d = trk.data;
    if (!redraw || !d) { try { d = trk.data = await api.trackView(); liveRide.n = (d.riders || []).length; liveRide.at = Date.now(); trackBadge(); } catch (e) { $('#trk-status').innerHTML = `<span class="warn small">${esc(e.message)}</span>`; if ($('#trk-list .skel')) $('#trk-list').innerHTML = ''; return; } }
    if (!$('#trk-status')) return;
    const f = trk.filter, onEv = r => f && r.event_id === f;
    const ev = f ? (state.evd?.events || []).find(e => e.id === f) || { title: d.riders.find(onEv)?.event || 'this ride' } : null;
    const rider = d.fam ? d.riders.find(r => r.mine) : null, rName = esc(firstName(state.fam?.member));
    if (NATIVE && sharing()) svcHealth();
    if (!d.fam) { const mine = d.sos.find(x => x.me); if (mine) setMySos({ id: mine.id, at: Date.parse(mine.at) || Date.now() }); else setMySos(null); }
    const sosB = app.querySelector('[data-act=trk-sos]'); if (sosB) sosB.textContent = mySos() ? '🆘 SOS sent · Cancel' : '🆘 SOS';
    const moving = d.riders.filter(r => rState(r).k === 'move');
    $('#trk-status').innerHTML = d.fam ? `<span class="small muted">${rider ? `<b>${rName}</b> is sharing live${d.riders.length > 1 ? ` · ${d.riders.length - 1} more on the same ride` : ''}` : `${rName} isn't sharing a live location right now. You'll see them here when they share on Track.`}${d.sos.length ? ' · <b class="sos-txt">SOS</b>' : ''}</span>`
        : `${sharing() ? `<span class="trk-live-pill"><span class="dot"></span>You're live · ${esc(leftTxt(trk.until))}</span>` : ''}${d.sos.length ? `<b class="sos-txt small">${d.sos.length} SOS</b>` : ''}${d.riders.length ? '' : '<span class="small muted">No one is sharing right now</span>'}`;
    const sb = $('#trk-share'); if (sb) sb.textContent = sharing() ? '🟢 Sharing · Stop / change' : '📍 Share my location';
    /* the event chips on the map: everyone, then every event someone is riding */
    const evs = new Map(); d.riders.forEach(r => { if (r.event_id) { const x = evs.get(r.event_id) || { id: r.event_id, title: evName(r), n: 0 }; x.n++; evs.set(r.event_id, x); } });
    if (f && !evs.has(f)) evs.set(f, { id: f, title: ev?.title || 'Ride', n: 0 });
    const chips = $('#trk-chips');
    if (chips) chips.innerHTML = d.fam || (!evs.size && !d.riders.length) ? '' : `<button type="button" class="tc${f ? '' : ' on'}" data-act="trk-all">Everyone <b>${d.riders.length}</b></button>${[...evs.values()].map(x => `<button type="button" class="tc ev${x.id === f ? ' on' : ''}" data-act="trk-ev" data-e="${x.id}">🏍️ ${esc(x.title || 'Event ride')} <b>${x.n}</b></button>`).join('')}`;
    /* numbers at a glance */
    const group = f ? d.riders.filter(onEv) : d.riders;
    let spread = 0; if (f && group.length > 1) group.forEach((a, i) => group.slice(i + 1).forEach(b => { spread = Math.max(spread, distM(a, b)); }));
    const gm = group.filter(r => rState(r).k === 'move'), avg = gm.length ? Math.round(gm.reduce((s, r) => s + kmhOf(r), 0) / gm.length) : 0;
    const tile = (v, l) => `<span class="ts"><b>${v}</b><small>${l}</small></span>`;
    const stats = $('#trk-stats');
    if (stats) stats.innerHTML = !d.riders.length ? '' : f
        ? tile(group.length, 'on this ride') + tile(group.length > 1 ? distTxt(spread) : '–', 'group spread') + tile(avg ? avg : '–', 'avg km/h moving')
        : tile(d.riders.length, d.riders.length === 1 ? 'rider live' : 'riders live') + tile(moving.length, 'on the move') + tile(d.riders.filter(r => r.event_id).length, 'on RWB events');
    /* the list: SOS, you, this ride's riders, then the closest */
    const here = trk.vfix || trk.last, near = r => (here ? distM(here, r) : 0);
    const sorted = [...d.riders].sort((a, b) => (b.me - a.me) || (!!b.mine - !!a.mine) || ((onEv(b) ? 1 : 0) - (onEv(a) ? 1 : 0)) || (here ? near(a) - near(b) : a.name.localeCompare(b.name)));
    const row = r => { const st = r.sos ? { k: 'sos' } : rState(r), en = !r.sos && evName(r), km = !r.sos && rideKm(r);
        return `<button class="trk-row ${st.k}${f && !r.sos && !onEv(r) ? ' dim' : ''}" data-act="trk-rider" data-k="${r.k}"><span class="tr-face">${face({ full_name: r.name, avatar_url: r.avatar }, 'avatar sm')}</span>
        <span class="grow"><b class="tr-name">${r.sos ? '🆘 ' : ''}${esc(r.name)}${r.me ? ' <span class="muted">(you)</span>' : r.mine ? ' <span class="muted">(your rider)</span>' : ''}</b>
            ${en ? `<span class="tr-ev">🏍️ ${esc(en)}</span>` : ''}${r.note && !r.sos ? `<span class="trk-note-txt">“${esc(r.note)}”</span>` : ''}
            <span class="tr-meta">${r.sos ? 'SOS ' + timeAgo(r.at) : [st.k === 'move' ? '' : st.txt, here && !r.me ? distTxt(near(r)) + ' away' : '', km ? km + ' ridden' : ''].filter(Boolean).join(' · ') || 'Live'}</span></span>
        ${st.k === 'move' ? `<span class="tr-spd"><b>${st.kmh}</b><small>km/h</small></span>` : '<span class="chev">›</span>'}</button>`; };
    const sosRows = d.sos.map(s => row({ ...s, k: 's' + s.id, sos: true })).join('');
    const mainRows = sorted.filter(r => !f || r.me || onEv(r)).map(r => row({ ...r, k: 'r' + r.id })).join('');
    const otherRows = f ? sorted.filter(r => !r.me && !onEv(r)).map(r => row({ ...r, k: 'r' + r.id })).join('') : '';
    $('#trk-list').innerHTML = sosRows + (mainRows || (f ? '<p class="small muted trk-empty">No one is sharing for this ride yet.</p>' : '')) + (otherRows ? `<h3 class="trk-sub">Also riding now</h3>${otherRows}` : '');
    drawMarkers(d.riders, d.sos);
    drawMe(); hud();
    if (trk.follow && trk.follow !== 'me' && trk.map) { const r = d.riders.find(x => x.id === trk.follow); if (r) trk.map.panTo([r.lat, r.lng]); else trkFollow(null); }
    if (!trk.fitted && trk.map) { trk.fitted = true; fitAll(false); }
    if (state.param === 'sos' && d.sos[0] && trk.map && !trk.sosFocused) { trk.sosFocused = true; trk.map.setView([d.sos[0].lat, d.sos[0].lng], 15); }
    if (d.staff) alertNewSos(d.sos);
    trackSignal();
}
const kmAway = r => distTxt(distM(trk.vfix || trk.last, r)) + ' away';
function drawMarkers(riders, sos) {
    const L = trk.L, map = trk.map; if (!L || !map) return;
    const sync = (store, list, isSos) => {
        const keep = new Set();
        list.forEach(r => { const k = r.id; keep.add(k); let m = store.get(k);
            const ic = riderIcon(L, r, isSos, !isSos && trk.filter && r.event_id !== trk.filter && !r.me);
            const z = isSos ? 1000 : r.me ? 500 : trk.filter && r.event_id === trk.filter ? 300 : 0;
            if (!m) { m = L.marker([r.lat, r.lng], { icon: ic.icon(), zIndexOffset: z }).addTo(map); m.on('click', () => openRider((isSos ? 's' : 'r') + r.id)); m._h = ic.html; store.set(k, m); }
            else { if (!(r.me && trk.vfix)) m.setLatLng([r.lat, r.lng]); if (m._h !== ic.html) { m.setIcon(ic.icon()); m._h = ic.html; } m.setZIndexOffset(z); } });
        [...store.keys()].forEach(k => { if (!keep.has(k)) { map.removeLayer(store.get(k)); store.delete(k); } });
    };
    sync(trk.markers, riders, false); sync(trk.sosMarkers, sos, true);
}
function fitAll(animate) {
    const map = trk.map, d = trk.data; if (!map || !d) return;
    const group = trk.filter ? d.riders.filter(r => r.event_id === trk.filter) : d.riders;
    const pts = [...(group.length ? group : d.riders), ...d.sos].map(r => [r.lat, r.lng]);
    const here = trk.vfix || trk.last; if (here && (!trk.filter || !group.length)) pts.push([here.lat, here.lng]);
    if (!pts.length) { gpsFix(60000).then(p => { trk.last = p; map.setView([p.lat, p.lng], 13); }).catch(() => {}); return; }
    if (pts.length === 1) map.setView(pts[0], 14, { animate }); else map.fitBounds(pts, { paddingTopLeft: [30, 70], paddingBottomRight: [70, 40], maxZoom: 15, animate });
}
function openRider(k) {
    const d = trk.data; if (!d) return;
    const r = k[0] === 's' ? d.sos.find(s => 's' + s.id === k) : d.riders.find(x => 'r' + x.id === k); if (!r) return;
    const sos = k[0] === 's', mine = r.me, st = sos ? null : rState(r), en = !sos && evName(r), here = trk.vfix || trk.last;
    if (!sos && !mine) { trk.focus = r.id; trackSignal(); }
    trk.map?.setView([r.lat, r.lng], Math.max(trk.map.getZoom(), 15));
    const stat = (v, l) => `<span class="rs"><b>${v}</b><small>${l}</small></span>`;
    const top = r.top_spd ? Math.round(r.top_spd * 3.6) : 0;
    openSheet(sos ? '🆘 SOS' : r.name, `<div class="vc-who" style="margin-bottom:12px">${face({ full_name: r.name, avatar_url: r.avatar }, 'avatar')}<span class="grow"><b>${esc(r.name)}</b>${r.nick ? ` <span class="muted">“${esc(r.nick)}”</span>` : ''}
        <span class="small muted">${sos ? 'Sent SOS ' + timeAgo(r.at) : `<span class="rs-state ${st.k}">${st.k === 'move' ? 'Moving' : st.k === 'stop' ? st.txt : 'Signal lost'}</span> · updated ${timeAgo(r.at)}${r.acc ? ' · ±' + Math.round(r.acc) + ' m' : ''}`}</span></span></div>
        ${en ? `<a class="rs-ev" href="#events/${r.event_id}">🏍️ <span class="grow"><small>Riding</small><b>${esc(en)}</b></span>›</a>` : ''}
        ${r.note && !sos ? `<p class="trk-note-txt big">“${esc(r.note)}”</p>` : ''}
        ${sos ? '' : `<div class="rs-grid">${stat(st.k === 'move' ? st.kmh : 0, 'km/h now')}${stat(top || '–', 'top km/h')}${stat(rideKm(r) || '0 km', 'this ride')}
            ${stat(r.since ? durTxt(Date.now() - Date.parse(r.since)).replace(' h', 'h').replace(' min', 'm') : '–', 'sharing for')}${stat(here && !mine ? distTxt(distM(here, r)) : '–', mine ? 'that’s you' : 'from you')}${stat(r.until ? (Date.parse(r.until) - Date.now() > 11 * 36e5 ? 'Open' : new Date(r.until).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })) : '–', 'sharing till')}</div>`}
        <div class="btns rs-btns">${r.phone ? `<a class="btn" href="tel:+91${esc(r.phone)}">📞 Call</a>` : ''}<a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}" target="_blank" rel="noopener">🧭 Directions</a>${!sos && !mine ? `<button class="btn ghost" data-x="follow">${trk.follow === r.id ? '✓ Following' : '🎯 Follow'}</button>` : ''}</div>
        ${sos && (mine || d.staff) ? `<button class="btn ${mine ? '' : 'ghost'} block" data-x="safe" style="margin-top:12px">${mine ? "✅ I'm safe now" : '✅ Mark as resolved'}</button>` : ''}`, body => {
        body.querySelector('[data-x=safe]')?.addEventListener('click', e => busy(e.currentTarget, async () => { await api.trackSosResolve(r.id); closeSheet(); toast('SOS closed. The RWB team is told.'); refreshTrack(); }));
        body.querySelector('[data-x=follow]')?.addEventListener('click', () => { closeSheet(); trkFollow(trk.follow === r.id ? null : r.id); if (trk.follow) trk.map?.setView([r.lat, r.lng], Math.max(trk.map.getZoom(), 15)); });
    });
}

/* ---------- SOS alarm for the RWB team: a loud 10-second siren while the app is open ---------- */
let sirenCtx = null;
function siren(seconds = 10) {
    try {
        sirenCtx ??= new (window.AudioContext || window.webkitAudioContext)(); const ctx = sirenCtx; ctx.resume?.();
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
        o.type = 'sawtooth'; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.1);
        for (let i = 0; i < seconds * 2; i++) { o.frequency.setValueAtTime(650, t + i * 0.5); o.frequency.linearRampToValueAtTime(1350, t + i * 0.5 + 0.45); }
        g.gain.setValueAtTime(0.35, t + seconds - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + seconds);
    } catch { /* no audio */ }
    navigator.vibrate?.([800, 300, 800, 300, 800, 300, 800, 300, 800, 300, 800]);
}
/* unlock audio on the first tap, so the siren can play later */
addEventListener('pointerdown', () => { if (!sirenCtx && isMod()) { try { sirenCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ } } }, { once: true });
const seenSos = () => { try { return JSON.parse(localStorage.getItem('rwb-sos-seen') || '[]'); } catch { return []; } };
function alertNewSos(list) {
    const seen = seenSos(), fresh = list.filter(s => !s.me && !seen.includes(s.id) && Date.now() - Date.parse(s.at) < 30 * 6e4);
    if (!fresh.length) return;
    try { localStorage.setItem('rwb-sos-seen', JSON.stringify([...seen, ...fresh.map(s => s.id)].slice(-50))); } catch { /* ignore */ }
    sosAlarm(fresh[0].name, fresh[0].id);
}
function sosAlarm(name, id) {
    siren(10);
    document.querySelector('.sos-alarm')?.remove();
    const el = document.createElement('div'); el.className = 'sos-alarm'; el.setAttribute('role', 'alertdialog');
    el.innerHTML = `<b>🆘 SOS</b><span>${esc(name || 'A rider')} needs help</span><div class="btns"><button class="btn" data-x="see">See on map</button><button class="btn ghost" data-x="ok">Dismiss</button></div>`;
    el.querySelector('[data-x=see]').onclick = () => { el.remove(); sirenCtx?.suspend?.().then(() => sirenCtx.resume()); location.hash = '#track/sos'; trk.sosFocused = false; };
    el.querySelector('[data-x=ok]').onclick = () => el.remove();
    document.body.append(el);
    if (id) try { localStorage.setItem('rwb-sos-seen', JSON.stringify([...seenSos(), id].slice(-50))); } catch { /* ignore */ }
}
/* an SOS push arrived while the app is open (the service worker passes it on) */
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'sos' && state.me && isMod()) sosAlarm(String(e.data.title || '').replace(/^🆘 SOS: /, '')); });

/* ---------- Events: ride live ---------- */
function rideLive(e) {
    const s = Date.parse(e.starts_at), en = Date.parse(e.ends_at || e.starts_at) + (e.ends_at ? 0 : 6 * 36e5);
    if (e.status !== 'live' || Date.now() < s - 6 * 36e5 || Date.now() > en + 6 * 36e5) return '';
    const mine = sharing() && trk.event === e.id;
    if (isFam()) return `<section class="section"><h2>Ride live</h2><div class="card trk-event"><p class="small muted" style="margin-bottom:10px">See your rider and the group on the map while they share their live location for this ride.</p>
        <a class="btn" href="#track">🗺️ See on map</a></div></section>`;
    return `<section class="section"><h2>Ride live</h2><div class="card trk-event">
        <p class="small muted" style="margin-bottom:10px">Share your live location for this ride so the group and the RWB team can see where everyone is.</p>
        <div class="btns"><button class="btn" data-act="evt-track-share">${mine ? '🟢 Sharing · Stop / change' : '📍 Share for this ride'}</button><a class="btn ghost" href="#track/e${e.id}">🗺️ See riders on map</a></div></div></section>`;
}


/* =================== RWB FAM: up to 3 family members per RWB member =================== */
/* A member shares an invite (link + code). Family members sign in with any Google account and get a simple, read-only RWB App:
   their rider's odometer and live location (when shared on Track), RWB events, admin announcements, members and the VRN check.
   They can turn RWB FAM off at any time (nothing is shown then) and alert the admins if they were added without their consent. */
const FAM_MAX = 3;
const isFam = () => state.me?.role === 'fam';
const famOn = () => isFam() && state.fam?.approved !== false && state.fam?.active !== false;
const FAM_ROUTES = ['home', 'track', 'events', 'me', 'news', 'crew', 'members', 'videos', 'guides', 'gallery'];
const FAM_CODE_KEY = 'rwb-fam-code';
const FAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ac" d="M12 21.2s-2.6-1.6-2.6-3.3a1.4 1.4 0 0 1 2.6-.7 1.4 1.4 0 0 1 2.6.7c0 1.7-2.6 3.3-2.6 3.3z"/><circle cx="8" cy="7.5" r="2.6"/><circle cx="16.5" cy="8.5" r="2.1"/><path d="M3.5 19c.4-3.4 2.2-5.6 4.5-5.6s4.1 2.2 4.5 5.6M13.4 14.6c.8-.9 1.8-1.4 3.1-1.4 2 0 3.5 1.7 3.9 4.6"/><path d="M12 21.2s-2.6-1.6-2.6-3.3a1.4 1.4 0 0 1 2.6-.7 1.4 1.4 0 0 1 2.6.7c0 1.7-2.6 3.3-2.6 3.3z"/></svg>';
const famCodeNorm = c => { const t = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return t ? 'RWB-' + t.replace(/^RWB/, '').slice(0, 8) : ''; };
const famCodeSaved = () => { try { return localStorage.getItem(FAM_CODE_KEY) || ''; } catch { return ''; } };
const famLink = code => `https://roninwb.in/fam/?c=${encodeURIComponent(code)}${playOnly() ? '&p=1' : ''}`;
/* roninwb.in/app/?fam=RWB-XXXX (from the invite page): remember the code until the person signs in */
(() => { try { const u = new URL(location.href), c = u.searchParams.get('fam'); if (!c) return;
    localStorage.setItem(FAM_CODE_KEY, famCodeNorm(c)); u.searchParams.delete('fam'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch { /* ignore */ } })();

/* signed in, not a member, but in someone's RWB FAM */
async function bootFam(f) {
    state.fam = f;
    state.me = { role: 'fam', full_name: f.full_name, phone: f.phone, address: f.address, email: f.email, avatar_url: null, notify: {} };
    document.body.dataset.fam = famOn() ? '1' : 'off';
    try { localStorage.removeItem(FAM_CODE_KEY); } catch { /* ignore */ }
    if (famOn()) await load.news(true); else state.news = [];
    await render();
    if (!trk.resumed) { trk.resumed = true; if (NATIVE) nativePushOn(false).catch(() => {}); else setTimeout(appPromo, 1500); }
}
async function famReload() { state.fam = await api.famMe(); state.news = null; state.evd = null; state.board = null; state.dir = null; await bootFam(state.fam); }
function famView(name) {
    if (name === 'me') return viewFamMe;
    if (!famOn()) return viewFamOff;
    return name === 'home' ? viewFamHome : ROUTES[name];
}

/* ---------- joining with an invite code ---------- */
function famJoinScreen(sess, code = famCodeSaved()) {
    tabbar.hidden = true; document.body.dataset.route = 'gate';
    app.innerHTML = `${demoBar()}<section class="signin fam-join"><img src="icons/app-icon-256.webp" alt="">
        <div><h1>Join RWB FAM</h1><p class="lead">An RWB member invited you to their family circle in the RWB App.</p></div>
        <form class="card na-card" id="fj" novalidate>
            <label>Invite code<input name="code" autocapitalize="characters" autocomplete="off" placeholder="RWB-XXXX" value="${esc(code)}" required></label>
            <p class="small fam-who" id="fj-who" hidden></p>
            <label>Your name<input name="name" autocomplete="name" maxlength="80" value="${esc(sess.name || '')}" required></label>
            <label>Mobile number <span class="muted small">(optional)</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98300 11111"></label>
            <label>Address <span class="muted small">(optional)</span><textarea name="address" rows="2" maxlength="300" placeholder="Area, city"></textarea></label>
            <div class="fam-remember"><b>🔑 Remember this Google account</b><span>${esc(sess.email)}</span><span class="small muted">You'll sign in with it every time. If you forget it, only the RWB member who invited you can help.</span></div>
            <label class="check-row"><input type="checkbox" name="agree"><span>I have read and agree to the <button type="button" class="linkish" data-x="tnc">RWB Terms &amp; Conditions</button> and <a href="../privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
            <button class="btn block" data-x="join">Join RWB FAM</button>
        </form>
        <button class="btn ghost block" data-x="out">Use a different Google account</button></section>`;
    const f = $('#fj'), who = $('#fj-who');
    const look = async () => { const c = famCodeNorm(f.code.value); if (c.length < 8) { who.hidden = true; return; }
        const r = await api.famInviteInfo(c).catch(() => null); who.hidden = false;
        who.innerHTML = !r ? '<span class="warn">That code isn\'t valid. Check it with the person who invited you.</span>' : r.left > 0 ? `✓ Invited by <b>${esc(r.name)}</b>` : `<span class="warn">${esc(r.name)}'s RWB FAM is full (3 of 3).</span>`; };
    f.code.addEventListener('change', look); f.code.addEventListener('blur', look); if (code) look();
    app.querySelector('[data-x=tnc]').onclick = () => openSheet('RWB Terms & Conditions', tncDoc());
    app.querySelector('[data-x=out]').onclick = () => api.signOut();
    f.onsubmit = e => {
        e.preventDefault(); const c = famCodeNorm(f.code.value), ph = f.phone.value.replace(/\D/g, '').slice(-10);
        if (c.length < 8) return toast('Enter the invite code, e.g. RWB-K7Q2', true);
        if (f.name.value.trim().length < 2) return toast('Please enter your name', true);
        if (f.phone.value.trim() && ph.length !== 10) return toast('Enter a 10-digit mobile number, or leave it empty', true);
        if (!f.agree.checked) return toast('Please agree to the Terms & Conditions and Privacy Policy', true);
        busy(f.querySelector('[data-x=join]'), async () => { await api.famJoin(c, f.name.value.trim(), ph, f.address.value.trim(), true); toast('Welcome to RWB FAM 🧡'); boot(); });
    };
}

/* ---------- FAM: Home ---------- */
async function viewFamHome() {
    const f = state.fam, m = f.member || {}, first = firstName(m);
    const [news, evd] = await Promise.all([load.news(), loadEvents().catch(() => null)]);
    const up = evd ? evd.events.filter(e => e.status === 'live' && !evtPast(e)).slice(0, 3) : [];
    const feed = visibleNews(news);
    firstNotifAsk();
    let pushAsk = false; try { pushAsk = NATIVE ? !localStorage.getItem(FCM_KEY) && !localStorage.getItem('rwb-push-dismissed') : pushSupported() && Notification.permission === 'default' && !localStorage.getItem('rwb-push-dismissed'); } catch { /* ignore */ }
    app.innerHTML = top(`Hi, ${firstName(state.me)}`) + `
        <section class="card fam-rider">
            <div class="row">${face(m, 'avatar lg')}<span class="grow"><span class="small muted">Your RWB rider</span><b>${esc(m.full_name || 'RWB member')}</b>${m.nickname ? `<span class="small muted">“${esc(m.nickname)}”</span>` : ''}</span></div>
            <div class="fam-odo"><span class="fam-odo-l">${esc(m.bike || 'Motorcycle')} · odometer</span><b>${m.odo ? Number(m.odo).toLocaleString('en-IN') : '–'}</b><em>km</em></div>
            <a class="btn block" href="#track">📍 Where is ${esc(first)}?</a>
        </section>
        ${pushAsk ? `<div class="banner"><span class="b-ico">${ICON.bell}</span><span class="grow">Get important RWB announcements as notifications</span><button class="btn sm" data-act="push-on">Turn on</button><button class="icon-btn" data-act="push-later" aria-label="Not now">✕</button></div>` : ''}
        ${vrnCheckCard()}
        ${up.length ? `<section class="section"><h2>RWB events <a href="#events">See all</a></h2><div class="list home-evt">${up.map(e => eventCard(e, evd)).join('')}</div></section>` : ''}
        ${feed.length ? `<section class="section"><h2>Important updates <span class="h-acts"><a href="#news">See all</a></span></h2><div class="group news-mini">${feed.slice(0, 3).map(n => newsRow(n, false, true)).join('')}</div></section>` : ''}
        ${galSection()}
        <section class="section"><h2>Explore</h2><div class="group">
            <a href="https://roninwb.in" target="_blank" rel="noopener"><span class="g-ico">${ICON.globe}</span><span class="grow"><b>roninwb.in</b><span class="small muted">Rides, events, gallery and the team</span></span>${ICON.out}</a>
        </div></section>`;
    swipeToDismiss(app, () => { if (!app.querySelector('.news-mini [data-swipe]')) render(); });
    bindVrnCheck(); bindHomeGallery(navN);
    actions = {
        evt: el => location.hash = '#events/' + el.dataset.id,
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); render(); }),
        'push-later': () => { try { localStorage.setItem('rwb-push-dismissed', '1'); } catch { /* ignore */ } render(); }
    };
}
/* FAM turned off: nothing is shown */
function viewFamOff() {
    const gone = state.fam?.active === false;
    app.innerHTML = top('RWB') + `<div class="card empty fam-off"><span class="fam-off-ico">${FAM_ICON}</span>
        <b>${gone ? 'RWB FAM is paused' : 'RWB FAM is turned off'}</b>${gone ? 'The RWB member who invited you is no longer active in RWB, so nothing is shared with you right now.' : 'You turned off RWB FAM, so you can\'t see any rider, location or event. Turn it back on any time in Me → RWB FAM.'}
        <p style="margin-top:14px"><a class="btn sm" href="#me">Open Me</a></p></div>`;
    actions = {};
}

/* ---------- FAM: Me ---------- */
function viewFamMe() {
    const f = state.fam, m = f.member || {}, theme = getTheme();
    const row = (k, v) => `<div><span class="muted">${k}</span><span class="rt">${esc(v || '–')}</span></div>`;
    app.innerHTML = top('Me') + `
        <section class="profile">${face(state.me, 'avatar xl')}
            <div class="grow"><h2>${esc(f.full_name)}</h2><p class="muted">RWB FAM</p></div>
            <button class="btn sm ghost" data-act="edit">Edit</button></section>
        <div class="group kv">${row('Name', f.full_name)}${row('Contact', f.phone ? f.phone.replace(/(\d{5})(\d{5})/, '$1 $2') : '')}${row('Address', f.address)}${row('Google account', f.email)}</div>

        <h2 class="group-title">RWB FAM</h2>
        <div class="group"><div class="bike-row fam-by">${face(m, 'avatar')}<span class="grow"><span class="small muted">Added by</span><b>${esc(m.full_name || 'An RWB member')}</b><span class="small muted">${f.created_at ? 'Since ' + fmtDate(String(f.created_at).slice(0, 10)) : ''}</span></span></div>
            <label class="toggle-row"><span class="grow">${f.approved ? 'RWB FAM is on' : 'RWB FAM is off'}<span class="small muted">${f.approved ? `You can see ${esc(firstName(m))}'s live location when shared, odometer and RWB events` : 'Nothing is shared with you. Turn on to see it again.'}</span></span><span class="switch-only"><input type="checkbox" id="fam-ok"${f.approved ? ' checked' : ''}></span></label></div>

        <h2 class="group-title">Follow RWB</h2>${followRwb()}

        <h2 class="group-title">Terms & Conditions</h2>
        <div class="group"><div class="bike-row"><span class="g-ico">📜</span><span class="grow"><b>You agree to the RWB T&C</b><span class="small muted">When you joined RWB FAM${f.created_at ? ', ' + fmtDate(String(f.created_at).slice(0, 10)) : ''}</span></span><button class="btn sm ghost" data-act="rules">Read</button></div></div>

        <h2 class="group-title">Appearance</h2>
        <div class="seg" role="radiogroup" aria-label="Theme">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([k, l]) => `<button role="radio" aria-selected="${theme === k}" aria-checked="${theme === k}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div>

        <h2 class="group-title">Notifications</h2>
        <div class="card" id="notif-card"><p id="push-state">Checking…</p><div id="push-btn" style="margin-top:10px"></div></div>
        <p class="small muted" style="margin:8px 4px 0">You get important RWB announcements only.</p>

        <h2 class="group-title">App</h2>
        <div class="group">
            <a href="../privacy.html" target="_blank" rel="noopener"><span class="g-ico">${ICON.shield}</span><span class="grow"><b>Privacy</b></span>${ICON.out}</a>
            <button data-report="other"><span class="g-ico">🚩</span><span class="grow"><b>Report a problem</b><span class="small muted">Something wrong, unsafe or abusive in the app? Tell the RWB team</span></span></button>
            <button data-act="out" class="danger-row"><span class="grow"><b>Sign out</b></span></button>
            <button data-del-acct class="danger-row"><span class="grow"><b>Delete my account</b><span class="small muted">Deletes your RWB App account and what you added in the app</span></span></button>
        </div>
        <p class="small muted" style="text-align:center;margin-top:24px">RWB App · RWB FAM</p>`;
    actions = {
        rules: () => openSheet('RWB Terms & Conditions', tncDoc() + '<p class="small muted" style="margin-top:16px">You agreed to these when you joined RWB FAM. To stop, turn RWB FAM off or ask the member who invited you to remove you.</p>'),
        out: async () => { await disablePush(true).catch(() => {}); api.signOut(); },
        theme: el => { setTheme(el.dataset.t); app.querySelectorAll('[data-act=theme]').forEach(b => { const on = b === el; b.setAttribute('aria-selected', on); b.setAttribute('aria-checked', on); }); },
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); drawPushState(); }),
        'push-off': b => busy(b, async () => { await disablePush(); toast('Notifications are off on this phone'); drawPushState(); }),
        edit: () => openSheet('My details', `<form id="ff">
            <label>Name<input name="name" maxlength="80" required value="${esc(f.full_name)}"></label>
            <label>Contact number<input name="phone" type="tel" inputmode="numeric" placeholder="98300 11111" value="${esc(f.phone || '')}"></label>
            <label>Address<textarea name="address" rows="2" maxlength="300">${esc(f.address || '')}</textarea></label>
            <button class="btn block">Save</button></form>`, body => {
            const ff = body.querySelector('#ff');
            ff.onsubmit = e => { e.preventDefault(); const ph = ff.phone.value.replace(/\D/g, '').slice(-10);
                if (ff.phone.value.trim() && ph.length !== 10) return toast('Enter a 10-digit number, or leave it empty', true);
                busy(e.submitter, async () => { await api.famUpdate(ff.name.value.trim(), ph, ff.address.value.trim()); closeSheet(); toast('Saved'); await famReload(); }); };
        })
    };
    $('#fam-ok').onchange = async e => {
        const on = e.target.checked;
        try { await api.famSetApproved(on); } catch (err) { e.target.checked = !on; return toast(err.message, true); }
        await famReload();
        if (on) toast('RWB FAM is on again'); else famAlertAsk(m);
    };
    drawPushState();
}
/* after turning RWB FAM off: tell the admins? */
function famAlertAsk(m) {
    openSheet('RWB FAM is off', `<p style="margin-bottom:14px">Do you want to alert the RWB Admins about this member adding you to RWB FAM without your consent/knowledge?</p>
        <div class="fam-by bike-row" style="margin-bottom:14px">${face(m, 'avatar')}<span class="grow"><b>${esc(m.full_name || 'RWB member')}</b><span class="small muted">Added you to RWB FAM</span></span></div>
        <button class="btn danger block" data-x="msg">Message the RWB Admins</button><button class="btn ghost block" data-x="no" style="margin-top:8px">Cancel</button>`, body => {
        body.querySelector('[data-x=no]').onclick = () => closeSheet();
        body.querySelector('[data-x=msg]').onclick = e => busy(e.currentTarget, async () => {
            const r = await api.famAlert().catch(() => 'sent');
            const list = await api.joinHelpAdmins().catch(() => []), me = state.fam;
            const msg = a => `Hi ${a.first_name}, I'm ${me.full_name}${me.phone ? ' (' + me.phone + ')' : ''}. ${m.full_name || 'An RWB member'} added me to their RWB FAM without my consent/knowledge. I've turned it off in the RWB App. Please look into it.`;
            openSheet('Admins alerted', `<p class="small" style="margin-bottom:10px">${r === 'already' ? 'The RWB Admins were already alerted today.' : '✓ The RWB Admins got an alert in the app.'} You can also WhatsApp an admin:</p>
                <div class="group">${list.length ? list.map(a => `<div class="bike-row"><span class="g-ico">🛡️</span><span class="grow"><b>${esc(a.first_name)}</b><span class="small muted">RWB admin</span></span>
                    <a class="btn sm wa" target="_blank" rel="noopener" href="${waTo(a.phone, msg(a))}">WhatsApp</a></div>`).join('') : '<p class="small muted" style="padding:12px">Could not load the admins right now.</p>'}</div>`);
        });
    });
}

/* ---------- members: my RWB FAM (Home → FAM) ---------- */
async function famSheet() {
    let d; try { d = await api.myFam(); } catch (e) { return toast(/function|schema/i.test(e.message) ? 'RWB FAM is coming soon' : e.message, true); }
    const list = d.fam || [], max = d.max || FAM_MAX, full = list.length >= max, me = state.me;
    const msg = `Hi! 🧡 I've added you to my RWB FAM in the RWB App (Ronin Warriors of Bengal).\n\nYou'll see where I am when I share my live location on rides, my bike's odometer, RWB events and important updates.\n\n1️⃣ Open ${famLink(d.code)}\n2️⃣ Sign in with any Google account (remember which one!)\n3️⃣ Enter my code: *${d.code}*\n\n– ${firstName(me)}`;
    openSheet('RWB FAM', `<div class="fam-intro"><span class="fam-intro-ico">${FAM_ICON}</span><p><b>Keep your family in the loop.</b> Invite up to ${max} family members. On the RWB App they see your live location when you share it on Track (and riders on the same event ride), your odometer, RWB events and important announcements.</p></div>
        <p class="small muted" style="margin:10px 0">They can't see expenses, RSVPs, MotoMart, Service, Mileage or anyone's phone numbers, and they can't share or send SOS.</p>
        <h3 class="group-title" style="margin-top:6px">Your FAM <span class="small muted" style="text-transform:none;letter-spacing:0">${list.length} of ${max}</span></h3>
        <div class="group" id="fam-list">${list.length ? list.map(x => `<div class="bike-row">${face(x, 'avatar sm')}<span class="grow"><b>${esc(x.full_name)}</b><span class="small muted">${x.phone ? esc(x.phone.replace(/(\d{5})(\d{5})/, '$1 $2')) + ' · ' : ''}joined ${fmtDate(String(x.created_at).slice(0, 10))}${x.approved === false ? ' · <b class="warn">turned off by them</b>' : ''}</span></span>
            <button class="btn sm ghost" data-rm="${x.id}" data-n="${esc(x.full_name)}">Remove</button></div>`).join('') : '<p class="small muted" style="padding:14px">No one yet. Share your invite below.</p>'}</div>
        ${full ? `<p class="small muted" style="margin-top:12px">Your RWB FAM is full (${max} of ${max}). Remove someone to invite another person; the invite link and code stop working while it's full.</p>` : `
        <h3 class="group-title">Invite</h3>
        <ol class="small help-steps"><li>Send your invite on WhatsApp or SMS.</li><li>They open the link: Android gets the RWB app, iPhone uses the web app.</li><li>They sign in with any Google account and enter your code.</li></ol>
        <div class="fam-code"><span class="small muted">Your invite code</span><b>${esc(d.code)}</b></div>
        <p class="small muted" style="margin:8px 0 12px">Tell them to remember the Google account they use. If they forget it, only you can help them.</p>
        <div class="btns"><button class="btn wa" data-x="wa">WhatsApp</button><a class="btn ghost" href="sms:?&body=${encodeURIComponent(msg.replace(/\*/g, ''))}">SMS</a><button class="btn ghost" data-x="copy">Copy</button></div>`}
        ${isMod() ? '<button class="btn ghost block" data-x="all" style="margin-top:16px">👨‍👩‍👧 See all RWB FAM members</button>' : ''}`, body => {
        body.querySelector('[data-x=wa]')?.addEventListener('click', () => openWA(waShare(msg)));
        body.querySelector('[data-x=copy]')?.addEventListener('click', () => { navigator.clipboard?.writeText(msg.replace(/\*/g, '')).then(() => toast('Invite copied'), () => toast(famLink(d.code))); });
        body.querySelector('[data-x=all]')?.addEventListener('click', () => famAdminSheet());
        body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (confirmBox(`Remove ${b.dataset.n} from your RWB FAM? They lose access straight away.`)) busy(b, async () => { await api.removeFam(Number(b.dataset.rm)); toast('Removed'); famSheet(); }); });
    });
}

/* ---------- admins and coordinators: every RWB FAM member ---------- */
async function famAdminSheet() {
    let list; try { list = state.famAll = await api.adminFamList(); } catch (e) { return toast(e.message, true); }
    const card = famAdminCard;
    openSheet(`RWB FAM (${list.length})`, `<p class="small muted" style="margin-bottom:10px">Family members invited by RWB members (up to 3 each). ${isAdmin() ? 'You can remove anyone.' : 'Only admins can remove someone.'}</p>
        ${list.length > 4 ? '<input class="search" type="search" id="fam-q" placeholder="Search name, number or member" aria-label="Search RWB FAM">' : ''}
        <div class="list" id="fam-all">${list.length ? list.map(card).join('') : '<div class="card empty"><b>No RWB FAM members yet</b>Members invite family from Home → FAM.</div>'}</div>`, body => {
        const q = body.querySelector('#fam-q'); if (q) q.oninput = () => { const t = q.value.trim().toLowerCase(); body.querySelectorAll('.fam-adm').forEach(c => c.hidden = !!t && !c.dataset.q.includes(t)); };
        bindFamRemove(body, famAdminSheet);
    });
}
function bindFamRemove(body, after) {
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (confirmBox(`Remove ${b.dataset.n} from RWB FAM? They lose access straight away.`)) busy(b, async () => { await api.removeFam(Number(b.dataset.rm)); state.famAll = null; toast('Removed'); after(); }); });
}
function famAdminCard(x) {
    return `<div class="card fam-adm${x.approved === false ? ' off' : ''}" data-q="${esc([x.full_name, x.phone, x.email, x.member?.full_name, x.member?.nickname].join(' ').toLowerCase())}">
        <div class="row">${face(x, 'avatar sm')}<span class="grow"><b>${esc(x.full_name)}</b><span class="small muted">FAM of <b>${esc(x.member?.full_name || '–')}</b>${x.member?.nickname ? ` “${esc(x.member.nickname)}”` : ''}</span></span>
            ${x.approved === false ? '<span class="badge">Turned off</span>' : '<span class="badge ok">On</span>'}</div>
        ${x.alerted_at ? `<p class="small warn" style="margin-top:8px">⚠️ Says they were added without consent (${timeAgo(x.alerted_at)})</p>` : ''}
        <dl class="facts small" style="margin:10px 0 0">${x.phone ? `<dt>Contact</dt><dd><a href="tel:+91${esc(x.phone)}">${esc(x.phone)}</a> · <a href="${waTo(x.phone)}" target="_blank" rel="noopener">WhatsApp</a></dd>` : ''}
            <dt>Google</dt><dd>${esc(x.email || '–')}</dd>${x.address ? `<dt>Address</dt><dd>${esc(x.address)}</dd>` : ''}<dt>Joined</dt><dd>${fmtDate(String(x.created_at).slice(0, 10))}</dd>
            ${x.member?.phone ? `<dt>Member</dt><dd><a href="tel:+91${esc(x.member.phone)}">${esc(x.member.phone)}</a></dd>` : ''}</dl>
        ${isAdmin() ? `<button class="btn sm danger" data-rm="${x.id}" data-n="${esc(x.full_name)}" style="margin-top:10px">Remove from RWB FAM</button>` : ''}</div>`;
}

/* ---------- Track: "don't panic" while a rider's location isn't updating ---------- */
/* 13 openers × 16 lines; stepping both together runs through 203 different messages before repeating */
const SIG_OPEN = ["Don't panic.", "Don't worry.", 'Stay calm.', 'No need to worry.', 'All okay.', 'Relax.', 'Hang tight.', 'Take a breath.', 'Nothing to fear.', 'Keep calm.', 'Just a signal gap.', 'This happens on rides.', 'Patience, please.'];
const SIG_LINE = ['{n} is facing poor signal.', '{n} is passing through a low-network area.', "{n}'s phone is looking for a network.", '{n} may be on a stretch with weak coverage.',
    "The pin moves again once {n}'s phone finds signal.", '{n} is probably riding through a no-signal zone.', "Mobile networks are patchy here. {n}'s pin will catch up.", '{n} might be in a forest or ghat section with no towers.',
    "Weak signal on {n}'s route right now.", "{n}'s phone sends the location as soon as it can.", 'Hills and forests often block the signal. {n} will show up again soon.', '{n} could be at a stop with the phone tucked away.',
    'The last known spot is on the map. {n} should reappear soon.', "Rural roads often lose network. {n}'s pin will refresh.", '{n} is likely between towers. Updates resume on their own.', 'A weak network or battery saver can pause updates for a while.'];
const SIG_COUNT = 203;
const signalMsg = (i, n) => `${SIG_OPEN[i % 13]} ${SIG_LINE[i % 16].replaceAll('{n}', n)}`;
const SIG_STALE = 3 * 6e4;
function trackSignal() {
    const el = $('#trk-signal'), d = trk.data; if (!el || !d) return;
    const r = isFam() ? d.riders.find(x => x.mine) : trk.focus ? d.riders.find(x => x.id === trk.focus && !x.me) : null;
    const stale = r && Date.now() - Date.parse(r.at) > SIG_STALE;
    if (!stale || trk.sigHidden === r.id + '@' + r.at) { el.hidden = true; return; }
    trk.sigI = ((trk.sigI ?? Math.floor(Math.random() * SIG_COUNT)) + 1) % SIG_COUNT;
    el.hidden = false;
    el.innerHTML = `<span class="sig-ico" aria-hidden="true">📶</span><span class="grow"><b>${esc(signalMsg(trk.sigI, firstName({ full_name: r.name, nickname: r.nick })))}</b><span class="small">Last update ${timeAgo(r.at)}</span></span><button type="button" class="icon-btn" aria-label="Hide">✕</button>`;
    el.querySelector('button').onclick = () => { trk.sigHidden = r.id + '@' + r.at; el.hidden = true; };
}

/* =================== Inside the RWB Android app (Capacitor) =================== */
/* a roninwb.in/app link opened the app: an RWB FAM invite (?fam=CODE) and/or a screen (#events/12) */
function appLink(url) {
    try { const u = new URL(url), c = u.searchParams.get('fam');
        if (c) { localStorage.setItem(FAM_CODE_KEY, famCodeNorm(c)); if (!state.me) boot(); else if (!isFam()) toast('You\'re already signed in as an RWB member. Sign out to join RWB FAM with another Google account.'); }
        if (u.hash.length > 1) location.hash = u.hash;
    } catch { /* ignore */ }
}
/* The Android app opens this same web app; these bits use the phone's own features there:
   notifications through Firebase (with the SOS siren channel), Google sign-in through the browser,
   the Back button, links to WhatsApp / phone / Maps, and background location for Track. */
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const nativePlugins = {};
if (NATIVE) nativeInfo().then(i => { PLAY_APP = i?.channel === 'play'; }).catch(() => {});
function Native(name) { if (!NATIVE) return null; try { return nativePlugins[name] ??= capRegister(name); } catch (e) { console.error(e); return null; } }
const FCM_KEY = 'rwb-fcm';
/* RWB Android app: right after the first sign-in, Android asks "Allow RWB to send you notifications?" once */
function firstNotifAsk() {
    if (!NATIVE) return;
    try { if (localStorage.getItem('rwb-notif-first')) return; localStorage.setItem('rwb-notif-first', '1'); } catch { return; }
    setTimeout(() => nativePushOn(true).then(ok => {
        if (!ok) return; try { localStorage.setItem('rwb-push-dismissed', '1'); } catch { /* ignore */ }
        if (!location.hash || location.hash.startsWith('#home')) render();
    }).catch(() => {}), 700);
}
async function nativePushOn(ask = true) {
    const P = Native('PushNotifications'); if (!P) return false;
    let st = await P.checkPermissions();
    if (st.receive !== 'granted' && ask) st = await P.requestPermissions();
    if (st.receive !== 'granted') { if (ask) throw new Error('Notifications are off for the RWB app: Settings → Apps → RWB → Notifications → Allow.'); return false; }
    await P.createChannel({ id: 'rwb', name: 'RWB updates', description: 'Events, announcements, MotoMart and more', importance: 4, visibility: 1, vibration: true }).catch(() => {});
    await P.createChannel({ id: 'sos', name: 'SOS alerts', description: 'A rider needs help (10-second siren)', importance: 5, visibility: 1, vibration: true, sound: 'sos.wav', lights: true, lightColor: '#FF0000' }).catch(() => {});
    await P.register();
    return true;
}
if (NATIVE) try {
    document.documentElement.classList.add('native-app');
    const P = Native('PushNotifications'), App = Native('App');
    P.addListener('registration', t => { try { localStorage.setItem(FCM_KEY, t.value); } catch { /* ignore */ } if (state.me) api.saveFcm(t.value).catch(() => {}); });
    P.addListener('pushNotificationActionPerformed', a => { const u = a.notification?.data?.url; if (u && u.startsWith('#')) location.hash = u; });
    P.addListener('pushNotificationReceived', n => {   /* arrived while the app is open */
        const d = n.data || {};
        if (d.sos === '1' && isMod()) sosAlarm(String(n.title || d.title || '').replace(/^🆘 SOS: /, ''));
        else if (n.title || d.title) toast(n.title || d.title);
        load.news?.(true).catch(() => {});
    });
    App.addListener('appUrlOpen', async e => {
        const url = e.url || '';
        if (url.startsWith('in.roninwb.twa://auth')) {
            try { await api.finishNativeSignIn(url); Native('Browser').close().catch(() => {}); } catch (err) { toast(err.message || 'Sign-in failed', true); }
        } else if (url.startsWith('https://roninwb.in/app')) appLink(url);
    });
    App.getLaunchUrl?.().then(r => { if (r?.url?.startsWith('https://roninwb.in/app')) appLink(r.url); }).catch(() => {});
    App.addListener('backButton', ({ canGoBack }) => {
        if (document.body.classList.contains('blocked')) return App.minimizeApp();
        if (gdLayer) return gdClose();   /* a photo, video or PDF open full screen: back closes it (on Home it used to close the app) */
        if (document.querySelector('dialog#sheet[open]')) return closeSheet();
        if (document.body.classList.contains('trk-full-on')) return trkFull(false);   /* full-screen Track map: back shrinks it */
        if (document.querySelector('.mm-search')) return closeMmSearch();   /* MotoMart search open: back closes it */
        if (document.querySelector('.sos-alarm')) return document.querySelector('.sos-alarm').remove();
        const h = location.hash.slice(1).split('/')[0];
        if (h && h !== 'home') { if (canGoBack) history.back(); else location.hash = '#home'; } else App.minimizeApp();
    });
    App.addListener('resume', () => { updateCheck(); });
    App.addListener('resume', () => { if (sharing() && trk.svc) svcCheck(); else if (sharing()) gpsFix(30000).then(sendFix).catch(() => {}); });
    /* links that leave the app (WhatsApp, phone, Google Maps, Instagram…) open in their own apps */
    document.addEventListener('click', e => {
        const a = e.target.closest('a[href]'); if (!a) return;
        const href = a.href, external = /^(tel|mailto|sms|whatsapp|intent|geo|upi):/i.test(href) || (/^https?:/i.test(href) && new URL(href).host !== location.host);
        if (a.target === '_blank' || external) { e.preventDefault(); location.href = href; }
    }, true);
    window.open = url => { if (url) location.href = url; return null; };
} catch (e) { console.error('Android app setup', e); }


/* =================== "Get the new app" pop-ups (web version only) =================== */
/* Android in the browser or the old app: the new RWB Android app (Track in the background, SOS siren).
   iPhone: a friendly note that the web app is the iPhone app, and Track works while the screen is on. */
const APK_BASE = 'https://roninwb.in/download/RWB-App.apk';
/* always the newest build: a fresh ?v= on every link, so no phone, browser or cache hands out an older copy */
const apkUrl = () => `${APK_BASE}?v=${Date.now()}`;
const APK_URL = APK_BASE;
function appPromo() {
    if (NATIVE || document.querySelector('.promo')) return;
    const android = /android/i.test(navigator.userAgent), ios = isIOS();
    if (!android && !ios) return;
    const key = android ? 'rwb-promo-android' : 'rwb-promo-ios';
    try { if (android ? sessionStorage.getItem(key) : Date.now() - Number(localStorage.getItem(key) || 0) < 7 * 864e5) return; } catch { /* ignore */ }
    const seen = () => { try { android ? sessionStorage.setItem(key, '1') : localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ } };
    const el = document.createElement('div'); el.className = 'promo'; el.setAttribute('role', 'dialog');
    el.innerHTML = android ? `<div class="promo-card"><span class="promo-ico">🚀</span><h2>RWB is on Google Play</h2>
            <p>Get the <b>RWB Android app</b>: <b>Live Track keeps going with the screen locked</b>, a real SOS siren and faster notifications.</p>
            <a class="btn block" href="${PLAY_URL}" data-x="get">▶ Get it on Google Play</a>
            <button class="btn ghost block" data-x="later">Later</button></div>`
        : `<div class="promo-card"><span class="promo-ico">🙈</span><h2>Oops, no funds!</h2>
            <p>An iPhone app costs ₹8,000 a year and RWB runs on pure passion. 🧡</p>
            <p>So this <b>is</b> your RWB App on iPhone: everything works here, and <b>Live Track works while your screen is on</b>.</p>
            <button class="btn block" data-x="later">Ride on 🏍️</button></div>`;
    el.addEventListener('click', e => { const x = e.target.closest('[data-x]')?.dataset.x; if (e.target === el || x === 'later' || x === 'get') { seen(); if (x !== 'get') e.preventDefault(); el.remove(); } });
    document.body.append(el);
}
/* =================== Pookie bubble: floats gently; drag it anywhere with a finger, it sticks to the nearest side =================== */
(function pookieDrag() {
    const fab = document.getElementById('pookie-fab'); if (!fab) return;
    const KEY = 'rwb-pookie-pos', M = 12;
    const SIZE = 54;   /* the bubble's size: measured sizes are 0 while it's hidden (loading, sign-in) */
    const bounds = () => {
        const W = document.documentElement.clientWidth || innerWidth, H = window.visualViewport?.height || innerHeight;
        const tab = document.getElementById('tabbar'), tr = tab && !tab.hidden ? tab.getBoundingClientRect() : null;
        const tb = tr && tr.height ? Math.min(tr.top, H) : H - 84;
        const minY = 76;
        return { minY, maxY: Math.max(minY + 20, tb - SIZE - 14), maxX: Math.max(M, W - SIZE - M) };
    };
    const place = (x, y) => { const b = bounds(); fab.style.left = Math.min(Math.max(M, x), b.maxX) + 'px'; fab.style.top = Math.min(Math.max(b.minY, y), b.maxY) + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; };
    const restore = () => {
        let p = null; try { p = JSON.parse(localStorage.getItem(KEY)); } catch { /* ignore */ }
        if (!p) { fab.removeAttribute('style'); return; }
        const b = bounds(); place(p.side === 'left' ? M : b.maxX, b.minY + p.y * (b.maxY - b.minY));
    };
    let start = null, moved = false;
    fab.addEventListener('pointerdown', e => {
        const r = fab.getBoundingClientRect(); start = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top }; moved = false;
        fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', e => {
        if (!start) return;
        if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
        if (!moved) { moved = true; fab.classList.add('dragging'); }
        place(e.clientX - start.dx, e.clientY - start.dy);
    });
    const end = () => {
        if (!start) return; start = null;
        if (!moved) return;
        fab.classList.remove('dragging'); fab.classList.add('snapping');
        const r = fab.getBoundingClientRect(), b = bounds(), side = r.left + r.width / 2 < innerWidth / 2 ? 'left' : 'right';
        place(side === 'left' ? M : b.maxX, r.top);
        const y = (Math.min(Math.max(b.minY, r.top), b.maxY) - b.minY) / Math.max(1, b.maxY - b.minY);
        try { localStorage.setItem(KEY, JSON.stringify({ side, y: Math.round(y * 1000) / 1000 })); } catch { /* ignore */ }
        setTimeout(() => fab.classList.remove('snapping'), 320);
    };
    fab.addEventListener('pointerup', end); fab.addEventListener('pointercancel', end);
    /* a drag is not a tap */
    fab.addEventListener('click', e => { if (moved) { e.preventDefault(); moved = false; } });
    /* re-check the spot whenever the screen or the bottom bar changes, so it can never sit off-screen */
    const later = () => requestAnimationFrame(() => requestAnimationFrame(restore));
    addEventListener('resize', later); window.visualViewport?.addEventListener('resize', later);
    addEventListener('orientationchange', later); addEventListener('pageshow', later);
    addEventListener('hashchange', () => setTimeout(restore, 60));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later(); });
    const tabEl = document.getElementById('tabbar'); if (tabEl) new MutationObserver(later).observe(tabEl, { attributes: true, attributeFilter: ['hidden'] });
    restore();
})();

(async () => {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        const hadSW = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
        /* a new version just installed: reload once so the rider sees it straight away */
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW && !reloaded && !$('dialog#sheet[open]')) { reloaded = true; location.reload(); } });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {}); });
    }
    try { api = await createApi(); }
    catch { app.innerHTML = `<section class="signin"><h1>Can't load</h1><p class="lead">Please check your internet connection.</p><button class="btn block" onclick="location.reload()">Try again</button></section>`; return; }
    if (location.hash === '#install') { history.replaceState(null, '', location.pathname); setTimeout(installSheet, 1200); }
    if (api.offline) initOffline();
    api.onAuthChange(ev => { if (ev === 'SIGNED_OUT') { trk.until = 0; trackSave(null); stopWatch(); trk.resumed = false; if (trk.svc) RwbTrack()?.stop().catch(() => {}); trk.svc = false; } chat.msgs = null; chat.left = null; Object.assign(state, { me: null, fam: null, services: null, fuel: null, bdays: null, adminMembers: null, listings: null, news: null, board: null, dir: null }); delete document.body.dataset.fam; if (ev === 'SIGNED_OUT') history.replaceState(null, '', location.pathname); boot(); });
    boot();
})();
