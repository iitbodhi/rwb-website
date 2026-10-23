/* RWB App — screens and interactions */
import { createApi } from './api.js';

/* settings from config.js and the website's js/data.js (top-level consts, read by name) */
const C = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {}, SITE = typeof CONFIG !== 'undefined' ? CONFIG : {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app'), tabbar = $('#tabbar'), sheet = $('#sheet');

let api;
const state = { me: null, services: null, fuel: null, bdays: null, guides: null, acc: null, guideTab: 'maint', accCat: 'all', accSort: 'default', adminTab: 'requests', adminMembers: null, adminSearch: '' };
const isAdmin = () => ['admin', 'superadmin'].includes(state.me?.role);

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
function toast(msg, err = false) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, err ? 5000 : 2600);
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
const waTo = (phone, text = '') => `https://wa.me/91${String(phone).replace(/\D/g, '').slice(-10)}${text ? '?text=' + encodeURIComponent(text) : ''}`;
function wishText(people) {
    const names = people.map(p => p.full_name);
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];
    return (C.BIRTHDAY_WISH || 'Happy Birthday {names}!').replace('{names}', list);
}

/* ---------- data loaders (cached until changed) ---------- */
const load = {
    services: async (force) => (state.services = !force && state.services || await api.services()),
    fuel: async (force) => (state.fuel = !force && state.fuel || await api.fuel()),
    bdays: async () => (state.bdays ??= await api.birthdays(isAdmin() ? 7 : 0).catch(() => [])),
    listings: async (force) => (state.listings = !force && state.listings || await api.listings()),
    news: async (force) => (state.news = !force && state.news || await api.news().catch(() => []))
};

/* ---------- mileage maths ----------
   A "tank" runs from one full-tank fill to the next. Litres of any part fills in between are added in.
   Distance = Trip A at the closing fill if entered, otherwise the odometer difference. */
function tanks(logs) {
    const out = []; let start = null, litres = 0, amount = 0, priced = true;
    for (const f of logs) {
        if (!start) { if (f.full_tank) start = f; continue; }
        litres += Number(f.litres); amount += Number(f.amount || 0); priced = priced && f.amount != null;
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
const ROUTES = { home: viewHome, service: viewService, mileage: viewMileage, motomart: viewMotomart, guides: viewGuides, me: viewMe, admin: viewAdmin, news: viewNews, chat: viewChat };
/* screens render one after another, so the screen the rider tapped last always wins */
let renderChain = Promise.resolve();
function render() { renderChain = renderChain.then(doRender, doRender); return renderChain; }
async function doRender() {
    if (!state.me) return;          /* signed out / not loaded yet: boot() shows the right screen */
    const [name, param] = (location.hash.slice(1) || 'home').split('?')[0].split('/');
    state.param = param || null;
    const view = ROUTES[name] || viewHome;
    if (name === 'admin' && !isAdmin()) { location.hash = '#home'; return; }
    if (name === 'admin' && param) state.adminTab = param;
    tabbar.hidden = false;
    tabbar.querySelectorAll('a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === name));
    tabbar.querySelectorAll('a[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
    try { await view(); } catch (e) { app.innerHTML = top('Oops') + `<div class="card empty"><b>Could not load</b>${esc(e.message)}<p style="margin-top:12px"><button class="btn sm" onclick="location.reload()">Try again</button></p></div>`; }
}
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });

const demoBar = () => api?.demo ? `<div class="demo-bar">Demo mode: sample data, saved only on this device. <button data-act="reset-demo">Reset</button></div>` : '';
const BELL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
const seenNews = () => { try { return Number(localStorage.getItem('rwb-news-seen') || 0); } catch { return 0; } };
const unread = () => (state.news || []).some(n => n.id > seenNews());
const initials = m => (m?.full_name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
/* profile photo if the member added one, otherwise their initials */
const face = (m, cls = 'avatar') => `<span class="${cls}">${m?.avatar_url ? `<img src="${esc(m.avatar_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<i>${esc(initials(m))}</i></span>`;
const top = (title, right = '') => `${demoBar()}<header class="top"><img class="logo" src="icons/logo-128.png" alt=""><h1>${esc(title)}</h1>${right}
    <a class="icon-btn" href="#chat" aria-label="Ask Pookie">${AI_ICON}</a>
    <a class="icon-btn bell" href="#news" aria-label="Announcements${unread() ? ' (new)' : ''}">${BELL}${unread() ? '<i class="dot"></i>' : ''}</a>
    <a href="#me" aria-label="My profile" class="avatar-link">${face(state.me)}</a></header>`;

/* delegated clicks: each screen sets its own actions */
let actions = {};
app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = actions[el.dataset.act] || globalActions[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
const globalActions = {
    'reset-demo': () => { if (confirmBox('Reset the demo data?')) { api.resetDemo(); Object.assign(state, { services: null, fuel: null, bdays: null, adminMembers: null, listings: null, news: null }); boot(); } },
    'add-service': () => serviceForm(),
    'add-fuel': () => fuelForm(),
    'wish': () => window.open(waShare(wishText(state.bdays.filter(b => b.day === todayISO()))), '_blank', 'noopener')
};

/* =================== Sign in / access =================== */
const G_ICON = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function viewSignIn() {
    tabbar.hidden = true;
    app.innerHTML = `${demoBar()}<section class="signin">
        <img src="icons/logo-384.png" alt="Ronin Warriors of Bengal">
        <div><h1>RWB App</h1><p class="lead">For members of Ronin Warriors of Bengal. Sign in with the Google account you used on the RWB join form.</p></div>
        <button class="btn gbtn block" data-act="google">${G_ICON} Continue with Google</button>
        <p class="small muted">Not a member yet? <a href="${esc(SITE.JOIN_FORM_URL || 'https://roninwb.in')}" target="_blank" rel="noopener">Join RWB</a> first, or sign in and ask the admins for access.</p>
    </section>`;
    actions = { google: b => busy(b, () => api.signIn()) };
}

async function viewAccess(status, sess) {
    tabbar.hidden = true;
    const req = status === 'pending' || status === 'rejected' ? await api.myRequest().catch(() => null) : null;
    if (status === 'pending') {
        app.innerHTML = `${demoBar()}<section class="signin"><img src="icons/logo-128.png" alt="">
            <div><h1>Request sent</h1><p class="lead">Thanks${req ? ', ' + esc(firstName(req)) : ''}! An RWB admin will check your details and let you in, usually within a day.</p></div>
            <button class="btn block" data-act="recheck">Check again</button>
            <button class="btn ghost block" data-act="out">Sign out</button></section>`;
        actions = { recheck: b => busy(b, boot), out: () => api.signOut() };
        return;
    }
    app.innerHTML = `${demoBar()}<header class="top"><img class="logo" src="icons/logo-128.png" alt=""><h1>Almost there</h1></header>
        ${status === 'rejected' ? '<p class="warn">Your earlier request was not approved. If you think this is a mistake, message an RWB admin on WhatsApp, or send the details again.</p><br>' : ''}
        <p>We couldn't find <b>${esc(sess.email)}</b> in the RWB members list. Maybe you used a different email on the join form.</p>
        <p class="muted" style="margin:8px 0 18px">Fill this in and an admin will link you to your membership. Use the WhatsApp number you're in the RWB group with.</p>
        <form id="req">
            <label>Full name<input name="full_name" required autocomplete="name" value="${esc(req?.full_name || sess.name || '')}"></label>
            <label>WhatsApp number<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="10-digit number" value="${esc(req?.phone || '')}"></label>
            <div class="grid2">
                <label>Date of birth<input name="dob" type="date" value="${esc(req?.dob || '')}"></label>
                <label>Bike number<input name="vrn" placeholder="WB 00 AA 0000" value="${esc(req?.vrn || '')}"></label>
            </div>
            <label>Locality<input name="locality" value="${esc(req?.locality || '')}"></label>
            <button class="btn block">Send to admins</button>
            <button type="button" class="btn ghost block" data-act="out">Use a different Google account</button>
        </form>`;
    actions = { out: () => api.signOut() };
    $('#req').addEventListener('submit', e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (f.phone.replace(/\D/g, '').length < 10) return toast('Please enter a 10-digit WhatsApp number', true);
        busy(e.submitter, async () => { await api.requestAccess(f); boot(); });
    });
}

/* =================== Home =================== */
const ICON = {
    fuel: '<svg viewBox="0 0 24 24"><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M7 8h4M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>',
    wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13v2H6M9 7h6"/></svg>',
    helmet: '<svg viewBox="0 0 24 24"><path d="M3 15a9 9 0 0 1 18 0v2H3zM12 6v5h9M3 17l1 3h8"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    chev: '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
    out: '<svg viewBox="0 0 24 24" class="chev"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>'
};

/* the instrument-cluster card: odometer in the middle, the ring fills up as the next service comes closer */
function cluster(services, fuel) {
    const odo = Math.max(0, ...services.map(s => s.odometer_km), ...fuel.map(f => f.odometer_km));
    const due = services.find(s => s.next_due_km || s.next_due_date);
    const ms = mileageStats(fuel), yr = String(new Date().getFullYear());
    const spent = services.filter(s => s.service_date.startsWith(yr)).reduce((a, s) => a + Number(s.cost || 0), 0);
    let p = 0, cap = 'Add your next service date or km when you log a service', state_ = '';
    if (due?.next_due_km) {
        const span = due.next_due_km - due.odometer_km, left = due.next_due_km - odo;
        p = span > 0 ? Math.min(1, Math.max(0, (odo - due.odometer_km) / span)) : 1;
        cap = left > 0 ? `Next service in <b>${km(left)}</b>` : `Service due. It was due at ${km(due.next_due_km)}`;
        state_ = left <= 0 ? 'due' : left < 500 ? 'soon' : '';
    } else if (due?.next_due_date) {
        const days = Math.round((new Date(due.next_due_date) - new Date(todayISO())) / 864e5);
        const span = Math.max(1, Math.round((new Date(due.next_due_date) - new Date(due.service_date)) / 864e5));
        p = Math.min(1, Math.max(0, 1 - days / span));
        cap = days > 0 ? `Next service in <b>${days} day${days === 1 ? '' : 's'}</b>` : 'Service due now';
        state_ = days <= 0 ? 'due' : days < 10 ? 'soon' : '';
    }
    const R = 52, C = 2 * Math.PI * R, ARC = C * 0.75;      /* a 270° dial, like a tachometer */
    return `<section class="cluster ${state_}">
        <div class="cl-bike"><span>${esc(state.me.bike || 'My bike')}</span>${state.me.vrn ? `<span class="cl-vrn">${esc(state.me.vrn)}</span>` : ''}</div>
        <div class="dial" role="img" aria-label="Odometer ${odo ? odo.toLocaleString('en-IN') + ' km' : 'not recorded yet'}">
            <svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="${R}" stroke-dasharray="${ARC} ${C}"/>
                <circle class="fill" cx="60" cy="60" r="${R}" stroke-dasharray="${(ARC * p).toFixed(1)} ${C}"/></svg>
            <div class="dial-read"><b>${odo ? odo.toLocaleString('en-IN') : '–'}</b><span>km on the clock</span></div>
        </div>
        <p class="cl-cap">${cap}</p>
        <div class="cl-row">
            <div><b>${ms.avg ? ms.avg.toFixed(1) : '–'}</b><span>km/l average</span></div>
            <div><b>${ms.cpk ? '₹' + ms.cpk.toFixed(2) : '–'}</b><span>fuel per km</span></div>
            <div><b>${rs(spent)}</b><span>service in ${yr}</span></div>
        </div>
    </section>`;
}

function newsRow(n, del = false) {
    const href = n.url && n.url.startsWith('#') ? n.url : '#news';
    return `<a class="news-row ${n.kind}" href="${esc(href)}"><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || '📣'}</span>
        <span class="grow"><b>${esc(n.title)}</b>${n.body ? `<span class="news-body">${esc(n.body)}</span>` : ''}<span class="small muted">${timeAgo(n.created_at)}${n.audience === 'admins' ? ', admins only' : ''}</span></span>
        ${del ? `<button class="icon-btn del" data-act="del-news" data-id="${n.id}" aria-label="Delete">✕</button>` : ICON.chev}</a>`;
}

async function viewHome() {
    const [services, fuel, bdays, news, listings] = await Promise.all([load.services(), load.fuel(), load.bdays(), load.news(), load.listings().catch(() => [])]);
    const today = bdays.filter(b => b.day === todayISO());
    const fresh = listings.filter(l => l.status === 'live').slice(0, 8);
    let pushAsk = false; try { pushAsk = pushSupported() && Notification.permission === 'default' && !localStorage.getItem('rwb-push-dismissed'); } catch { /* ignore */ }
    const names = today.map(b => b.full_name.split(' ')[0]);
    app.innerHTML = top(`Hi, ${firstName(state.me)}`) + `
        ${cluster(services, fuel)}
        <nav class="quick" aria-label="Quick actions">
            <button data-act="add-fuel"><span>${ICON.fuel}</span>Add fuel</button>
            <button data-act="add-service"><span>${ICON.wrench}</span>Log service</button>
            <button data-act="sell"><span>${ICON.tag}</span>Sell gear</button>
            <a href="#chat"><span>${ICON.chat}</span>Ask Pookie</a>
        </nav>
        ${isAdmin() ? '<a class="banner admin" href="#admin" id="admin-banner" hidden></a>' : ''}
        ${today.length ? `<div class="banner bday"><span class="b-ico">🎂</span><span class="grow"><b>${esc(names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0])}</b> ${names.length > 1 ? 'have' : 'has'} a birthday today</span><button class="btn sm wa" data-act="wish">Wish</button></div>` : ''}
        ${pushAsk ? `<div class="banner"><span class="b-ico">🔔</span><span class="grow">Get birthdays, Motomart posts and ride news as notifications</span><button class="btn sm" data-act="push-on">Turn on</button><button class="icon-btn" data-act="push-later" aria-label="Not now">✕</button></div>` : ''}
        ${news.length ? `<section class="section"><h2>Latest from RWB <a href="#news">See all</a></h2><div class="group">${news.slice(0, 2).map(n => newsRow(n)).join('')}</div></section>` : ''}
        <section class="section"><h2>Fresh on Motomart <a href="#motomart">See all</a></h2>
            ${fresh.length ? `<div class="strip">${fresh.map(listingCard).join('')}</div>` : `<a class="group-row-card" href="#motomart"><span class="g-ico">${ICON.tag}</span><span class="grow"><b>Nothing for sale yet</b><span class="small muted">Selling old gear? Post it here for fellow riders.</span></span>${ICON.chev}</a>`}</section>
        <section class="section"><h2>Explore</h2><div class="group">
            <a href="#guides" data-guide="maint"><span class="g-ico">${ICON.book}</span><span class="grow"><b>Maintenance guides</b><span class="small muted">How-tos and checklists from our coordinators</span></span>${ICON.chev}</a>
            <a href="#guides" data-guide="acc"><span class="g-ico">${ICON.helmet}</span><span class="grow"><b>Recommended gear</b><span class="small muted">Accessories tested and scored by RWB</span></span>${ICON.chev}</a>
            <a href="https://roninwb.in" target="_blank" rel="noopener"><span class="g-ico">${ICON.globe}</span><span class="grow"><b>roninwb.in</b><span class="small muted">Rides, events, gallery and the team</span></span>${ICON.out}</a>
        </div></section>`;
    actions = {
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); render(); }),
        'push-later': () => { try { localStorage.setItem('rwb-push-dismissed', '1'); } catch { /* ignore */ } render(); },
        sell: () => listingForm(),
        listing: el => location.hash = '#motomart/' + el.dataset.id
    };
    app.querySelectorAll('[data-guide]').forEach(a => a.addEventListener('click', () => state.guideTab = a.dataset.guide));
    if (isAdmin()) api.admin.stats().then(s => {
        const b = $('#admin-banner'), mm = listings.filter(l => l.status === 'pending').length, parts = [];
        if (s.pending) parts.push(`${s.pending} access request${s.pending > 1 ? 's' : ''}`);
        if (mm) parts.push(`${mm} Motomart post${mm > 1 ? 's' : ''}`);
        if (b && parts.length) { b.innerHTML = `<span class="b-ico">${ICON.shield}</span><span class="grow">${parts.join(' and ')} waiting for you</span>${ICON.chev}`; b.href = s.pending ? '#admin' : '#admin/motomart'; b.hidden = false; }
    }).catch(() => {});
}

/* =================== Service records =================== */
async function viewService() {
    const list = await load.services();
    const total = list.reduce((a, s) => a + Number(s.cost || 0), 0);
    const due = list.find(s => s.next_due_km || s.next_due_date);
    app.innerHTML = top('Service') + `
        <div class="stats">
            <div class="stat"><b>${list.length}</b><span>Services logged</span></div>
            <div class="stat"><b>${rs(total)}</b><span>Total spent</span></div>
            <div class="stat accent"><b>${due ? (due.next_due_km ? km(due.next_due_km).replace(' km', '') : fmtDayMonth(due.next_due_date)) : '–'}</b><span>${due?.next_due_km ? 'Next due (km)' : 'Next due'}</span></div>
        </div>
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
            ${s.next_due_km || s.next_due_date ? `<dt>Next due</dt><dd>${[s.next_due_km && km(s.next_due_km), s.next_due_date && fmtDate(s.next_due_date)].filter(Boolean).join(' or ')}</dd>` : ''}
            ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}
        </dl>
        ${s.items?.length ? `<p class="small muted">Work done</p><div class="tags" style="margin-bottom:16px">${s.items.map(i => `<span class="badge">${esc(i)}</span>`).join('')}</div>` : ''}
        <div class="btns" style="margin-bottom:10px">${s.bill_path ? '<button class="btn ghost" data-x="bill">🧾 View bill</button>' : ''}<button class="btn" data-x="edit">Edit</button></div>
        <button class="btn danger block" data-x="del">Delete this record</button>`, body => {
        body.querySelector('[data-x=edit]').onclick = () => serviceForm(s);
        body.querySelector('[data-x=del]').onclick = e => { if (confirmBox('Delete this service record and its bill?')) busy(e.target, async () => { await api.deleteService(s); await load.services(true); closeSheet(); render(); toast('Deleted'); }); };
        const b = body.querySelector('[data-x=bill]'); if (b) b.onclick = () => showBill(s);
    });
}
async function showBill(s) {
    const url = await api.billUrl(s.bill_path).catch(e => toast(e.message, true)); if (!url) return;
    const pdf = /\.pdf($|\?)/i.test(s.bill_path) || url.startsWith('data:application/pdf');
    openSheet('Bill', `<div class="bill-view">${pdf ? `<iframe class="pdf" src="${esc(url)}" title="Bill"></iframe>` : `<img src="${esc(url)}" alt="Bill for service on ${esc(fmtDate(s.service_date))}">`}</div>
        <div class="btns" style="margin-top:14px"><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener" download>Open / download</a><button class="btn ghost" data-x="back">Back</button></div>`,
        body => body.querySelector('[data-x=back]').onclick = () => serviceDetail(s));
}

/* shrink photos so free storage lasts: about 150–250 KB each */
async function compressBill(file) {
    if (file.type === 'application/pdf') { if (file.size > 2e6) throw new Error('That PDF is over 2 MB. Please upload a photo of the bill instead.'); return file; }
    if (!file.type.startsWith('image/')) throw new Error('Please choose a photo or a PDF.');
    return compressImage(file, 1600, 250e3);
}
async function compressImage(file, maxSide = 1400, target = 220e3) {
    if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that photo. Try a JPG or PNG.')); i.src = URL.createObjectURL(file); });
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
    const r = s ? { ...s } : { service_date: todayISO(), service_type: 'paid', items: [] };
    const known = new Set(C.SERVICE_ITEMS || []);
    const extra = (r.items || []).filter(i => !known.has(i));
    const centres = [...new Set((state.services || []).map(x => x.service_center).filter(Boolean))];
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
        <label>Service centre<input name="service_center" list="centres" placeholder="Where was it done?" value="${esc(r.service_center || '')}"><datalist id="centres">${centres.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <fieldset><legend>Work done <span class="hint muted small">(tap all that apply)</span></legend>
            <div class="chips" id="items">${[...known, ...extra].map(i => `<button type="button" class="chip" aria-pressed="${r.items.includes(i)}">${esc(i)}</button>`).join('')}</div>
            <div class="row"><input id="other-item" placeholder="Something else? Type and add" class="grow"><button type="button" class="btn sm ghost" id="add-item">Add</button></div>
        </fieldset>
        <label>Total cost (₹)<input type="number" name="cost" min="0" step="1" inputmode="numeric" value="${esc(r.cost ?? '')}"></label>
        <div class="grid2">
            <label>Next service at (km)<input type="number" name="next_due_km" min="0" inputmode="numeric" value="${esc(r.next_due_km ?? '')}"></label>
            <label>or by date<input type="date" name="next_due_date" value="${esc(r.next_due_date || '')}"></label>
        </div>
        <label>Notes<textarea name="notes" maxlength="2000" placeholder="Anything worth remembering">${esc(r.notes || '')}</textarea></label>
        <div>
            <label class="file-pick" id="pick"><input type="file" accept="image/*,application/pdf"><span id="pick-text">${r.bill_path ? '🧾 Bill attached. Tap to replace' : '📷 Add bill / invoice (photo or PDF)'}</span></label>
            ${r.bill_path ? '<button type="button" class="btn sm ghost" id="rm-bill" style="margin-top:8px">Remove attached bill</button>' : ''}
        </div>
        <button class="btn block">${s ? 'Save changes' : 'Save service'}</button>
    </form>`, body => {
        const f = body.querySelector('#sf'), type = f.service_type, sno = body.querySelector('#sno-wrap');
        const syncType = () => { sno.hidden = !['free', 'amc'].includes(type.value); body.querySelector('#sno-label').textContent = type.value === 'amc' ? 'Which AMC service?' : 'Which free service?'; };
        type.onchange = syncType; syncType();
        const chips = body.querySelector('#items');
        chips.onclick = e => { const c = e.target.closest('.chip'); if (c) c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); };
        const addOther = () => { const v = body.querySelector('#other-item').value.trim(); if (!v) return; chips.insertAdjacentHTML('beforeend', `<button type="button" class="chip" aria-pressed="true">${esc(v)}</button>`); body.querySelector('#other-item').value = ''; };
        body.querySelector('#add-item').onclick = addOther;
        body.querySelector('#other-item').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } };
        body.querySelector('#pick input').onchange = async e => {
            const fl = e.target.files[0]; if (!fl) return;
            body.querySelector('#pick-text').textContent = 'Preparing…';
            try { file = await compressBill(fl); body.querySelector('#pick-text').textContent = `🧾 ${fl.name} (${Math.round(file.size / 1024)} KB) ready`; }
            catch (err) { file = null; body.querySelector('#pick-text').textContent = '📷 Add bill / invoice (photo or PDF)'; toast(err.message, true); }
        };
        const rm = body.querySelector('#rm-bill');
        if (rm) rm.onclick = () => { if (confirmBox('Remove the attached bill?')) busy(rm, async () => { const u = await api.removeBill(s); r.bill_path = null; Object.assign(s, u); await load.services(true); rm.remove(); body.querySelector('#pick-text').textContent = '📷 Add bill / invoice (photo or PDF)'; toast('Bill removed'); }); };
        f.onsubmit = e => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(f));
            const rec = {
                id: s?.id, bill_path: r.bill_path || null,
                service_date: d.service_date, odometer_km: num(d.odometer_km), service_type: d.service_type,
                service_no: ['free', 'amc'].includes(d.service_type) ? num(d.service_no) : null,
                service_center: d.service_center.trim() || null,
                items: [...chips.querySelectorAll('.chip[aria-pressed=true]')].map(c => c.textContent),
                cost: num(d.cost), next_due_km: num(d.next_due_km), next_due_date: d.next_due_date || null, notes: d.notes.trim() || null
            };
            busy(e.submitter, async () => { await api.saveService(rec, file); await load.services(true); closeSheet(); location.hash === '#service' ? render() : (location.hash = '#service'); toast(s ? 'Saved' : 'Service added'); });
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
    const logs = await load.fuel(), ms = mileageStats(logs);
    const byEnd = new Map(ms.tanks.map(t => [t.end.id, t]));
    const f1 = v => v == null ? '–' : v.toFixed(1);
    app.innerHTML = top('Mileage') + HOWTO + `
        <section class="section"><div class="stats">
            <div class="stat accent"><b>${f1(ms.avg)}</b><span>Average km/l</span></div>
            <div class="stat"><b>${f1(ms.last)}</b><span>Last tank</span></div>
            <div class="stat"><b>${f1(ms.best)}</b><span>Best tank</span></div>
            <div class="stat"><b>${ms.cpk ? '₹' + ms.cpk.toFixed(2) : '–'}</b><span>Fuel cost / km</span></div>
        </div></section>
        ${ms.tanks.length >= 2 ? `<section class="section"><h2>Trend</h2><div class="card">${chart(ms.tanks, ms.avg)}</div></section>` : ''}
        <section class="section"><h2>Fill-ups</h2>${logs.length ? `<div class="list">${[...logs].reverse().map(f => fuelCard(f, byEnd.get(f.id))).join('')}</div>` :
            `<div class="card empty"><b>No fill-ups yet</b>Next time you fill to full, reset Trip A and add the entry here. Your mileage shows from the second full tank.</div>`}</section>
        <button class="btn fab" data-act="add-fuel">＋ Add fuel</button>`;
    if (logs.length < 2) $('#howto').open = true;
    actions = { open: el => fuelForm(logs.find(f => String(f.id) === el.dataset.id)) };
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
    const r = f ? { ...f } : { fill_date: todayISO(), full_tank: true };
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
                else if (!prev.some(x => x.full_tank && x.odometer_km < odo)) msg.push('This starts your tracking. Mileage shows from the next full tank.');
            }
            calc.innerHTML = msg.join(' · ');
        };
        form.oninput = update; update();
        const del = body.querySelector('#del');
        if (del) del.onclick = () => { if (confirmBox('Delete this fill-up?')) busy(del, async () => { await api.deleteFuel(f); await load.fuel(true); closeSheet(); render(); toast('Deleted'); }); };
        form.onsubmit = e => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(form)), full = form.full_tank.checked;
            const rec = { id: f?.id, fill_date: d.fill_date, odometer_km: num(d.odometer_km), litres: num(d.litres), amount: num(d.amount), full_tank: full, trip_a_km: full ? num(d.trip_a_km) : null, notes: d.notes.trim() || null };
            const before = prev.filter(x => x.fill_date <= rec.fill_date).sort((a, b) => b.odometer_km - a.odometer_km)[0];
            if (before && rec.odometer_km < before.odometer_km && !confirmBox(`The odometer (${km(rec.odometer_km)}) is lower than an earlier fill-up (${km(before.odometer_km)}). Save anyway?`)) return;
            busy(e.submitter, async () => { await api.saveFuel(rec); await load.fuel(true); closeSheet(); location.hash === '#mileage' ? render() : (location.hash = '#mileage'); toast(f ? 'Saved' : 'Fill-up added'); });
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
const pdfTitle = n => n.replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim();

async function viewGuides() {
    const tab = state.guideTab;
    app.innerHTML = top('Guides') + `<div class="seg" role="tablist">
            <button role="tab" aria-selected="${tab === 'maint'}" data-act="tab" data-tab="maint">Maintenance</button>
            <button role="tab" aria-selected="${tab === 'acc'}" data-act="tab" data-tab="acc">Accessories</button></div>
        <div id="guide-body"><p class="muted">Loading…</p></div>
        <a class="card tap row ai-card section" href="#chat" style="text-decoration:none;display:flex"><span class="ai-badge sm">${AI_ICON}</span><div class="grow"><h3>Can't find it?</h3><p class="small muted">Ask Pookie</p></div><span class="kmpl">›</span></a>`;
    actions = { tab: el => { state.guideTab = el.dataset.tab; viewGuides(); } };
    tab === 'maint' ? drawMaint() : drawAcc();
}
async function drawMaint() {
    const box = $('#guide-body');
    if (!state.guides) {
        try { state.guides = SITE.MAINTENANCE_SCRIPT_URL ? (await (await fetch(SITE.MAINTENANCE_SCRIPT_URL)).json()).filter(p => /^[\w-]+$/.test(p.id)).sort((a, b) => String(b.date).localeCompare(String(a.date))) : []; }
        catch { box.innerHTML = '<div class="card empty"><b>Could not load guides</b>Check your internet and try again.</div>'; return; }
    }
    box.innerHTML = `<input class="search" type="search" placeholder="Search guides" aria-label="Search guides" id="gq"><div class="list" id="gl"></div>`;
    const draw = () => {
        const q = $('#gq').value.trim().toLowerCase();
        const shown = state.guides.filter(p => (pdfTitle(p.name) + ' ' + (p.description || '')).toLowerCase().includes(q));
        $('#gl').innerHTML = shown.length ? shown.map(p => `<button class="card tap guide" data-act="pdf" data-id="${esc(p.id)}">
            <div class="thumb">PDF<img src="https://drive.google.com/thumbnail?id=${esc(p.id)}&sz=w200" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>
            <div><h3>${esc(pdfTitle(p.name))}</h3>${p.description ? `<p class="small muted">${esc(p.description)}</p>` : ''}<p class="small muted">${p.date ? fmtDate(String(p.date).slice(0, 10)) : ''}</p></div></button>`).join('')
            : `<div class="card empty">${state.guides.length ? 'No guides match your search.' : '<b>Coming soon</b>Guides will be posted here.'}</div>`;
    };
    $('#gq').oninput = draw; draw();
    actions.pdf = el => { const p = state.guides.find(g => g.id === el.dataset.id); openSheet(pdfTitle(p.name), `<iframe class="pdf" src="https://drive.google.com/file/d/${esc(p.id)}/preview" title="${esc(pdfTitle(p.name))}"></iframe><a class="btn ghost block" style="margin-top:12px" href="https://drive.google.com/file/d/${esc(p.id)}/view" target="_blank" rel="noopener">Open in Google Drive</a>`); };
}
async function drawAcc() {
    const box = $('#guide-body');
    if (!state.acc) {
        try { state.acc = SITE.ACCESSORIES_SHEET_URL ? parseCSV(await fetchCSV(SITE.ACCESSORIES_SHEET_URL)).filter(r => r.name) : []; }
        catch { box.innerHTML = '<div class="card empty"><b>Could not load gear</b>Check your internet and try again.</div>'; return; }
    }
    const cats = [...new Set(state.acc.map(i => i.category).filter(Boolean))];
    const sorts = { default: 'Default order', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low', 'rating-desc': 'Rating: high to low' };
    let list = state.acc.filter(i => state.accCat === 'all' || i.category === state.accCat);
    const [key, dir] = state.accSort.split('-');
    if (dir) { const v = i => key === 'price' ? priceNum(i.price) : parseFloat(i.score); const s = dir === 'asc' ? 1 : -1; list = [...list].sort((a, b) => { const x = v(a), y = v(b); return x == null || isNaN(x) ? 1 : y == null || isNaN(y) ? -1 : (x - y) * s; }); }
    box.innerHTML = `${cats.length > 1 ? `<div class="chips" style="margin-bottom:10px">${['all', ...cats].map(c => `<button class="chip" data-act="cat" data-cat="${esc(c)}" aria-pressed="${state.accCat === c}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>` : ''}
        <select class="search" id="asort" aria-label="Sort">${Object.entries(sorts).map(([k, v]) => `<option value="${k}"${k === state.accSort ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <div class="list">${list.length ? list.map(i => {
            const sc = Math.max(0, Math.min(5, parseFloat(i.score) || 0)), link = safeLink(i.link), img = i.image ? driveImg(i.image) : '';
            const price = i.price ? (/^[\d,.]+$/.test(i.price) ? '₹' + i.price : i.price) : '';
            return `<article class="card guide"><div class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : 'GEAR'}</div>
                <div style="min-width:0">${i.category ? `<span class="badge">${esc(i.category)}</span>` : ''}<h3 style="margin-top:4px">${esc(i.name)}</h3>
                <p class="small"><span class="stars" style="--s:${sc}" aria-label="RWB score ${sc} of 5">★★★★★</span> <span class="muted">${sc}/5</span>${price ? ` · <b>${esc(price)}</b>` : ''}</p>
                ${link ? `<a class="btn sm ghost" style="margin-top:8px" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View product ↗</a>` : ''}</div></article>`;
        }).join('') : '<div class="card empty"><b>Coming soon</b>Recommended gear will be listed here.</div>'}</div>`;
    $('#asort').onchange = e => { state.accSort = e.target.value; drawAcc(); };
    actions.cat = el => { state.accCat = el.dataset.cat; drawAcc(); };
}

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

function viewMe() {
    const m = state.me, role = m.role === 'superadmin' ? 'Super admin' : m.role === 'admin' ? 'Admin' : 'Member';
    const row = (k, v) => `<div><span class="muted">${k}</span><span class="rt">${esc(v || '–')}</span></div>`;
    const theme = getTheme();
    app.innerHTML = top('Me') + `
        <section class="profile">
            <label class="photo-pick" aria-label="Change profile photo">${face(m, 'avatar xl')}<span class="cam">📷</span><input type="file" accept="image/*" id="pic" hidden></label>
            <div class="grow"><h2>${esc(m.full_name)}</h2><p class="muted">${esc(role)}${m.nickname ? `, “${esc(m.nickname)}”` : ''}</p></div>
            <button class="btn sm ghost" data-act="edit">Edit</button>
        </section>
        <div class="group kv">
            ${row('WhatsApp', m.phone)}${row('Bike', m.bike)}${row('Registration', m.vrn)}${row('Birthday', m.dob ? fmtDayMonth(m.dob) : '')}${row('Blood group', m.blood_group)}${row('Locality', m.locality)}${row('Emergency contact', m.emergency_phone)}
        </div>
        ${isAdmin() ? `<div class="group section"><a href="#admin"><span class="g-ico">${ICON.shield}</span><span class="grow"><b>Admin panel</b><span class="small muted">Members, requests, Motomart, birthdays, Pookie</span></span>${ICON.chev}</a></div>` : ''}

        <h2 class="group-title">Appearance</h2>
        <div class="seg" role="radiogroup" aria-label="Theme">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([k, l]) => `<button role="radio" aria-selected="${theme === k}" aria-checked="${theme === k}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div>

        <h2 class="group-title">Notifications</h2>
        <div class="card" id="notif-card"><p id="push-state">Checking…</p><div id="push-btn" style="margin-top:10px"></div></div>
        <div class="group" style="margin-top:10px">
            ${[['birthday', 'Birthdays'], ['motomart', 'New Motomart posts'], ['member', 'New members on the app']].map(([k, l]) => `<label class="toggle-row"><span class="grow">${l}</span><span class="switch-only"><input type="checkbox" data-pref="${k}"${(m.notify || {})[k] !== false ? ' checked' : ''}></span></label>`).join('')}
        </div>
        <p class="small muted" style="margin:8px 4px 0">RWB announcements always come through.</p>

        <h2 class="group-title">App</h2>
        <div class="group">
            ${isStandalone() ? '' : `<button data-act="install"><span class="g-ico">${ICON.dl}</span><span class="grow"><b>Install the app</b><span class="small muted">${isIOS() ? 'Safari → Share → Add to Home Screen' : 'Add RWB to your home screen'}</span></span>${ICON.chev}</button>`}
            <a href="../privacy.html" target="_blank" rel="noopener"><span class="g-ico">${ICON.shield}</span><span class="grow"><b>Privacy</b></span>${ICON.out}</a>
            <button data-act="out" class="danger-row"><span class="grow"><b>Sign out</b></span></button>
        </div>
        <p class="small muted" style="text-align:center;margin-top:24px">RWB App, free for every warrior</p>`;
    actions = {
        out: async () => { await disablePush(true).catch(() => {}); api.signOut(); },
        theme: el => { setTheme(el.dataset.t); app.querySelectorAll('[data-act=theme]').forEach(b => { const on = b === el; b.setAttribute('aria-selected', on); b.setAttribute('aria-checked', on); }); },
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); drawPushState(); }),
        'push-off': b => busy(b, async () => { await disablePush(); toast('Notifications are off on this phone'); drawPushState(); }),
        'push-test': b => busy(b, async () => { await api.testPush(); toast('Test sent. It should arrive in a few seconds.'); }),
        install: () => installEvt ? (async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); })() : installSheet(),
        edit: () => openSheet('My details', `<form id="mf">
            <p class="small muted">Your name and WhatsApp number can only be changed by an admin.</p>
            <label>Nickname<input name="nickname" value="${esc(m.nickname || '')}" maxlength="40"></label>
            <div class="grid2"><label>Date of birth<input type="date" name="dob" value="${esc(m.dob && !m.dob.startsWith('1904') ? m.dob : '')}"></label>
                <label>Blood group<select name="blood_group">${['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(b => `<option${(m.blood_group || '').replace(/\s/g, '').toUpperCase().startsWith(b) && b ? ' selected' : ''} value="${b}">${b || '–'}</option>`).join('')}</select></label></div>
            <div class="grid2"><label>Bike<input name="bike" value="${esc(m.bike || '')}"></label><label>Registration<input name="vrn" value="${esc(m.vrn || '')}"></label></div>
            <label>Locality<input name="locality" value="${esc(m.locality || '')}"></label>
            <label>Hometown<input name="hideout" value="${esc(m.hideout || '')}"></label>
            <div class="grid2"><label>Emergency contact<input name="emergency_phone" inputmode="tel" value="${esc(m.emergency_phone || '')}"></label><label>Other mobile<input name="alt_phone" inputmode="tel" value="${esc(m.alt_phone || '')}"></label></div>
            <button class="btn block">Save details</button></form>`, body => {
            body.querySelector('#mf').onsubmit = e => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.target)); Object.keys(d).forEach(k => d[k] = d[k].trim() || null);
                if (!d.dob && m.dob?.startsWith('1904')) delete d.dob;   /* keep "year unknown" birthday */
                if (!d.blood_group && m.blood_group) delete d.blood_group;
                busy(e.submitter, async () => { state.me = await api.updateMe(d); closeSheet(); render(); toast('Details saved'); });
            };
        })
    };
    app.querySelectorAll('[data-pref]').forEach(cb => cb.onchange = async () => {
        const notify = { birthday: true, motomart: true, member: true, ...(state.me.notify || {}), [cb.dataset.pref]: cb.checked };
        try { state.me = await api.updateMe({ notify }); toast('Saved'); } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
    });
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
    if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that photo. Try a JPG or PNG.')); i.src = URL.createObjectURL(file); });
    const side = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'); cv.width = cv.height = 320;
    cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
    URL.revokeObjectURL(img.src);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

/* =================== Admin =================== */
async function viewAdmin() {
    const s = await api.admin.stats();
    const tab = state.adminTab;
    app.innerHTML = top('Admin', '<a class="btn sm ghost" href="#me">Done</a>') + `
        <div class="stats">
            <button class="stat tap" data-act="mfilter" data-f="all"><b>${s.members}</b><span>Members ›</span></button>
            <button class="stat tap" data-act="mfilter" data-f="app"><b>${s.on_app}</b><span>On the app ›</span></button>
            <button class="stat tap ${s.pending ? 'accent' : ''}" data-act="tab" data-tab="requests"><b>${s.pending}</b><span>Waiting ›</span></button></div>
        <div class="seg section scroll" role="tablist">
            <button role="tab" aria-selected="${tab === 'requests'}" data-act="tab" data-tab="requests">Requests${s.pending ? ` (${s.pending})` : ''}</button>
            <button role="tab" aria-selected="${tab === 'motomart'}" data-act="tab" data-tab="motomart">Motomart<span id="mm-count"></span></button>
            <button role="tab" aria-selected="${tab === 'members'}" data-act="tab" data-tab="members">Members</button>
            <button role="tab" aria-selected="${tab === 'bdays'}" data-act="tab" data-tab="bdays">Birthdays</button>
            <button role="tab" aria-selected="${tab === 'ai'}" data-act="tab" data-tab="ai">Pookie</button></div>
        <div id="admin-body"><p class="muted">Loading…</p></div>`;
    actions = { tab: el => { state.adminTab = el.dataset.tab; viewAdmin(); }, mfilter: el => { state.adminTab = 'members'; state.memberFilter = el.dataset.f; state.adminSearch = ''; viewAdmin(); } };
    load.listings(true).then(ls => { const n = ls.filter(l => l.status === 'pending').length; const c = $('#mm-count'); if (c && n) c.textContent = ` (${n})`; }).catch(() => {});
    try { await ({ requests: adminRequests, motomart: adminMotomart, members: adminMembers, bdays: adminBdays, ai: adminAI })[tab](); }
    catch (e) { $('#admin-body').innerHTML = `<div class="card empty"><b>Could not load</b>${esc(e.message)}</div>`; }
}
async function adminRequests() {
    const reqs = await api.admin.requests();
    $('#admin-body').innerHTML = reqs.length ? `<div class="list">${reqs.map(r => `<div class="card">
        <h3>${esc(r.full_name)}</h3>
        <dl class="facts"><dt>Google</dt><dd>${esc(r.email || '–')}</dd><dt>WhatsApp</dt><dd><a href="${waTo(r.phone)}" target="_blank" rel="noopener">${esc(r.phone)}</a></dd>
            ${r.vrn ? `<dt>Bike no.</dt><dd>${esc(r.vrn)}</dd>` : ''}${r.locality ? `<dt>Locality</dt><dd>${esc(r.locality)}</dd>` : ''}${r.dob ? `<dt>Birthday</dt><dd>${fmtDayMonth(r.dob)}</dd>` : ''}<dt>Asked</dt><dd>${fmtDate(String(r.created_at).slice(0, 10))}</dd></dl>
        <p class="${r.match_member_id ? (r.match_linked ? 'warn' : 'badge ok') : 'badge'}" style="margin-bottom:12px">${r.match_member_id ? (r.match_linked ? `⚠ This number belongs to ${esc(r.match_name)}, who is already on the app with another account.` : `✓ Matches sheet entry: ${esc(r.match_name)}`) : 'Not in the members sheet: approving adds them as a new member'}</p>
        <div class="btns"><button class="btn ghost" data-act="reject" data-id="${r.id}">Reject</button><button class="btn" data-act="approve" data-id="${r.id}">Approve</button></div></div>`).join('')}</div>`
        : '<div class="card empty"><b>All clear</b>No one is waiting for access.</div>';
    Object.assign(actions, {
        approve: b => busy(b, async () => { await api.admin.approve(Number(b.dataset.id)); state.adminMembers = null; toast('Approved'); viewAdmin(); }),
        reject: b => { if (confirmBox('Reject this request?')) busy(b, async () => { await api.admin.reject(Number(b.dataset.id)); toast('Rejected'); viewAdmin(); }); }
    });
}
async function adminMembers() {
    state.adminMembers ??= await api.admin.members();
    const all = state.adminMembers;
    const F = { all: 'Everyone', app: 'On the app', admins: 'Admins' };
    state.memberFilter ||= 'all';
    $('#admin-body').innerHTML = `<div class="chips" style="margin-bottom:10px">${Object.entries(F).map(([k, v]) => `<button class="chip" data-act="mf" data-f="${k}" aria-pressed="${state.memberFilter === k}">${v}</button>`).join('')}</div>
    ${state.memberFilter !== 'all' && state.me.role === 'superadmin' ? '<p class="small muted" style="margin-bottom:10px">Tap a person to make them an admin or remove their admin rights.</p>' : ''}<input class="search" type="search" id="mq" placeholder="Search name, number or bike no." value="${esc(state.adminSearch)}" aria-label="Search members"><p class="small muted" id="mcount" style="margin:-4px 0 10px"></p><div class="list" id="ml"></div><button class="btn ghost block section" id="more" hidden>Show more</button>`;
    let limit = 50;
    const draw = () => {
        const q = state.adminSearch.trim().toLowerCase(), qd = q.replace(/\D/g, '');
        const pool = all.filter(m => state.memberFilter === 'app' ? m.user_id : state.memberFilter === 'admins' ? m.role !== 'member' : true);
        const hits = pool.filter(m => !q || m.full_name.toLowerCase().includes(q) || (m.nickname || '').toLowerCase().includes(q) || (qd.length >= 3 && (m.phone || '').includes(qd)) || (m.vrn || '').toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')));
        $('#mcount').textContent = `${hits.length} ${state.memberFilter === 'app' ? 'on the app' : state.memberFilter === 'admins' ? (hits.length === 1 ? 'admin' : 'admins') : 'member' + (hits.length === 1 ? '' : 's')}`;
        $('#ml').innerHTML = hits.slice(0, limit).map(m => `<button class="card tap row member-row" data-act="member" data-id="${m.id}">${face(m, 'avatar sm')}
            <div class="grow"><div class="who">${esc(m.full_name)} ${m.role !== 'member' ? `<span class="badge orange">${m.role === 'superadmin' ? 'Super admin' : 'Admin'}</span>` : ''}</div>
            <div class="meta">${esc([m.phone, m.vrn, m.locality].filter(Boolean).join(' · '))}</div></div>
            ${m.user_id ? '<span class="badge ok">On app</span>' : ''}</button>`).join('') || '<div class="card empty">No one matches.</div>';
        $('#more').hidden = hits.length <= limit;
    };
    $('#mq').oninput = e => { state.adminSearch = e.target.value; limit = 50; draw(); };
    $('#more').onclick = () => { limit += 100; draw(); };
    draw();
    actions.member = el => memberSheet(all.find(m => String(m.id) === el.dataset.id));
    actions.mf = el => { state.memberFilter = el.dataset.f; adminMembers(); };
}
function memberSheet(m) {
    const superA = state.me.role === 'superadmin', self = m.user_id && m.user_id === state.me.user_id;
    const canRemove = !self && m.role !== 'superadmin' && (m.role !== 'admin' || superA);
    openSheet(m.full_name, `
        ${m.avatar_url ? `<img class="member-photo" src="${esc(m.avatar_url)}" alt="">` : ''}<div class="tags" style="margin:0 0 10px">${m.user_id ? '<span class="badge ok">On the app</span>' : '<span class="badge">Not on the app yet</span>'}${m.role !== 'member' ? `<span class="badge orange">${m.role === 'superadmin' ? 'Super admin' : 'Admin'}</span>` : ''}</div>
        <dl class="facts">
            <dt>WhatsApp</dt><dd>${esc(m.phone || '–')}</dd><dt>Email</dt><dd>${esc(m.email || '–')}</dd>
            <dt>Birthday</dt><dd>${m.dob ? fmtDayMonth(m.dob) : '–'}</dd><dt>Bike</dt><dd>${esc([m.bike, m.vrn].filter(Boolean).join(' · ') || '–')}</dd>
            <dt>Blood group</dt><dd>${esc(m.blood_group || '–')}</dd><dt>Locality</dt><dd>${esc(m.locality || '–')}</dd>
            <dt>Hometown</dt><dd>${esc(m.hideout || '–')}</dd><dt>Emergency</dt><dd>${esc(m.emergency_phone || '–')}</dd>
            <dt>Joined</dt><dd>${m.joined_at ? fmtDate(String(m.joined_at).slice(0, 10)) : '–'}</dd>
        </dl>
        <div class="btns" style="margin-bottom:10px">${m.phone ? `<a class="btn wa" href="${waTo(m.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button class="btn ghost" data-x="edit">Edit details</button></div>
        ${superA && !self && m.role !== 'superadmin' ? `<button class="btn ghost block" data-x="role" style="margin-bottom:10px">${m.role === 'admin' ? 'Remove admin rights' : 'Make admin'}</button>` : ''}
        ${canRemove ? `<button class="btn danger block" data-x="remove">Remove from RWB</button><p class="small muted" style="margin-top:6px">Use when someone leaves the RWB WhatsApp community. Deletes their profile${m.user_id ? ', app account, service records, fuel log and bills' : ''}. This can't be undone.</p>` : ''}`, body => {
        body.querySelector('[data-x=edit]').onclick = () => memberEdit(m);
        const role = body.querySelector('[data-x=role]');
        if (role) role.onclick = () => {
            const to = m.role === 'admin' ? 'member' : 'admin';
            if (to === 'admin' && !m.user_id && !confirmBox(`${m.full_name} hasn't signed in to the app yet. They'll get admin rights when they do. Continue?`)) return;
            busy(role, async () => { await api.admin.setRole(m.id, to); m.role = to; toast(to === 'admin' ? 'Now an admin' : 'Admin rights removed'); memberSheet(m); adminMembers(); });
        };
        const rm = body.querySelector('[data-x=remove]');
        if (rm) rm.onclick = () => {
            const typed = window.prompt(`This permanently deletes ${m.full_name}${m.user_id ? ' and all their app data' : ''}.\n\nType REMOVE to confirm.`);
            if ((typed || '').trim().toUpperCase() !== 'REMOVE') return;
            busy(rm, async () => { await api.admin.remove(m.id, m.user_id); state.adminMembers = state.adminMembers.filter(x => x.id !== m.id); closeSheet(); toast(`${m.full_name} removed`); viewAdmin(); });
        };
    });
}
function memberEdit(m) {
    openSheet('Edit ' + firstName(m), `<form id="ae">
        <label>Full name<input name="full_name" required value="${esc(m.full_name)}"></label>
        <label>Nickname<input name="nickname" value="${esc(m.nickname || '')}"></label>
        <div class="grid2"><label>WhatsApp<input name="phone" inputmode="tel" required value="${esc(m.phone || '')}"></label><label>Date of birth<input type="date" name="dob" value="${esc(m.dob || '')}"></label></div>
        <div class="grid2"><label>Bike<input name="bike" value="${esc(m.bike || '')}"></label><label>Bike number<input name="vrn" value="${esc(m.vrn || '')}"></label></div>
        <div class="grid2"><label>Blood group<input name="blood_group" value="${esc(m.blood_group || '')}"></label><label>Locality<input name="locality" value="${esc(m.locality || '')}"></label></div>
        <button class="btn block">Save</button></form>`, body => {
        body.querySelector('#ae').onsubmit = e => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.target));
            if (d.phone.replace(/\D/g, '').length < 10) return toast('WhatsApp number needs 10 digits', true);
            busy(e.submitter, async () => { await api.admin.update(m.id, d); Object.assign(m, d, { phone: d.phone.replace(/\D/g, '').slice(-10), dob: d.dob || null }); toast('Saved'); memberSheet(m); adminMembers(); });
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
    const m = document.getElementById('theme-color'); if (m) m.content = dark ? '#121110' : '#f7f7f5';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => getTheme() === 'system' && setTheme('system'));

/* =================== Push notifications =================== */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function enablePush() {
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
    pushDetails().then(t => { const c = $('#notif-card'); if (!c) return; c.querySelector('details.tech')?.remove(); c.insertAdjacentHTML('beforeend', `<details class="tech"><summary>Notification details</summary><pre class="diag">${esc(t)}</pre></details>`); });
    let on = false;
    if (pushSupported()) { const reg = await navigator.serviceWorker.getRegistration(); on = !!(reg && await reg.pushManager.getSubscription()) && Notification.permission === 'granted'; }
    if (!pushSupported()) { st.textContent = isIOS() && !isStandalone() ? 'On iPhone, notifications work after you add RWB to your Home Screen and open it from there.' : 'This browser does not support notifications.'; btn.innerHTML = ''; return; }
    if (Notification.permission === 'denied') {
        st.innerHTML = 'Notifications are blocked on this phone. The app can\'t ask again, so allow them once in your settings:';
        if (isTWA()) {
            btn.innerHTML = `<ol class="steps"><li>Open phone <b>Settings → Apps → RWB → Notifications</b></li><li>Turn on <b>Allow notifications</b></li><li>Close RWB fully (swipe it away) and open it again</li></ol>
                <p class="small muted" style="margin-top:8px">Nothing to change in Chrome: the RWB app handles its own notifications.</p>
                <button class="btn sm" data-act="push-on" style="margin-top:10px">I've allowed it, try again</button>`;
            return;
        }
        btn.innerHTML = isIOS() ? `<ol class="steps"><li>Open iPhone <b>Settings → Notifications</b></li><li>Find <b>RWB</b> and turn on <b>Allow Notifications</b></li><li>Come back here and tap <b>Turn on</b></li></ol><button class="btn sm" data-act="push-on" style="margin-top:10px">Turn on</button>`
            : `<p class="small" style="margin:4px 0 6px"><b>Using the RWB app (downloaded APK)</b></p><ol class="steps"><li>Open phone <b>Settings → Apps → RWB → Notifications</b></li><li>Turn on <b>Allow notifications</b></li></ol>
               <p class="small" style="margin:12px 0 6px"><b>Using Chrome</b></p><ol class="steps"><li>Tap the icon left of <b>roninwb.in</b> in the address bar</li><li><b>Permissions → Notifications → Allow</b></li></ol>
               <p class="small muted" style="margin-top:10px">Then close and reopen the app, and come back to this page.</p>`;
        return;
    }
    st.textContent = on ? 'On for this phone.' : 'Off for this phone.';
    btn.innerHTML = on ? `<div class="btns">${isAdmin() ? '<button class="btn sm ghost" data-act="push-test">Send test</button>' : ''}<button class="btn sm ghost" data-act="push-off">Turn off</button></div>` : '<button class="btn block" data-act="push-on">Turn on notifications</button>';
}

/* =================== Announcements =================== */
const KIND_ICON = { announcement: '📣', birthday: '🎂', motomart: '🛒', member: '🏍️', admin: '🛡️' };
function timeAgo(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const linkify = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');
function newsCard(n, del = false) {
    const go = n.url && n.url !== '#news' && n.url.startsWith('#');
    return `<article class="card news ${n.kind}"><div class="row" style="align-items:flex-start"><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || '📣'}</span>
        <div class="grow"><h3>${esc(n.title)}</h3>${n.body ? `<p>${linkify(n.body)}</p>` : ''}
        <p class="small muted" style="margin-top:6px">${timeAgo(n.created_at)}${n.audience === 'admins' ? ' · admins only' : ''}${go ? ` · <a href="${esc(n.url)}">Open</a>` : ''}</p></div>
        ${del ? `<button class="icon-btn" data-act="del-news" data-id="${n.id}" aria-label="Delete">🗑</button>` : ''}</div></article>`;
}
async function viewNews() {
    const news = await load.news(true);
    try { if (news[0]) localStorage.setItem('rwb-news-seen', String(Math.max(...news.map(n => n.id)))); } catch { /* ignore */ }
    app.innerHTML = top('News') + `
        ${isAdmin() ? `<details class="howto" style="margin-bottom:6px"><summary>Post an announcement</summary>
            <form id="ann" style="padding-bottom:16px"><label>Title<input name="title" required maxlength="120" placeholder="e.g. Sunday breakfast ride"></label>
            <label>Message<textarea name="body" maxlength="1000" placeholder="Meeting point, time, anything members should know"></textarea></label>
            <p class="small muted">Goes to everyone's feed and as a notification to every phone that has them on.</p>
            <button class="btn block">Send to all members</button></form></details>` : ''}
        <section class="section">${news.length ? `<div class="group">${news.map(n => newsRow(n, isAdmin())).join('')}</div>` : '<div class="card empty"><b>No news yet</b>Announcements, birthdays and new Motomart posts show up here.</div>'}</section>`;
    actions = { 'del-news': b => { if (confirmBox('Delete this from the feed?')) busy(b, async () => { await api.deleteNews(Number(b.dataset.id)); render(); }); } };
    const f = $('#ann');
    if (f) f.onsubmit = e => {
        e.preventDefault(); const d = Object.fromEntries(new FormData(f));
        if (!confirmBox(`Send “${d.title}” to all members?`)) return;
        busy(e.submitter, async () => { await api.announce(d.title.trim(), d.body.trim()); toast('Announcement sent'); render(); });
    };
}

/* =================== Motomart =================== */
const CATS = C.MOTOMART_CATEGORIES || ['Helmet', 'Riding jacket', 'Riding pants', 'Riding shoes / boots', 'Gloves', 'Bike protection', 'Bike accessories', 'Rider accessories', 'Luggage', 'Electronics', 'Spare parts', 'Other'];
const CONDITIONS = ['Brand new (unused)', 'Like new', 'Good', 'Fair', 'Needs repair'];
const mmState = { cat: 'all', status: 'all', mine: false, q: '' };
const price = n => '₹' + Number(n).toLocaleString('en-IN');
const photo = (l, i = 0) => l.photos?.[i] ? api.photoUrl(l.photos[i]) : '';
const mine = l => l.user_id === state.myId;

function listingCard(l) {
    const img = photo(l);
    return `<button class="mm-card tap" data-act="listing" data-id="${l.id}">
        <div class="mm-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span>No photo</span>'}${l.status !== 'live' ? `<span class="mm-flag ${l.status}">${{ sold: 'Sold', pending: 'Waiting for approval', rejected: 'Not approved' }[l.status]}</span>` : ''}</div>
        <div class="mm-body"><b class="mm-price">${price(l.price)}</b><span class="mm-name">${esc(l.product_name)}</span><span class="small muted">${esc([l.condition, l.size && 'Size ' + l.size].filter(Boolean).join(' · ') || l.category)}</span></div></button>`;
}

async function viewMotomart() {
    state.myId ??= await api.myId();
    const all = await load.listings(true);
    const q = mmState.q.trim().toLowerCase();
    const shown = all.filter(l => (mmState.mine ? mine(l) : (['live', 'sold'].includes(l.status) || mine(l))) &&
        (mmState.cat === 'all' || l.category === mmState.cat) && (mmState.status === 'all' || l.status === mmState.status) &&
        (!q || (l.product_name + ' ' + l.category + ' ' + (l.details || '')).toLowerCase().includes(q)));
    const cats = CATS.filter(c => all.some(l => l.category === c));
    app.innerHTML = top('Motomart') + `
        <p class="muted small" style="margin:-6px 0 12px">Used gear from fellow Ronins. Tap an item to see photos and message the seller on WhatsApp.</p>
        <input class="search" type="search" id="mmq" placeholder="Search helmets, jackets, guards…" value="${esc(mmState.q)}" aria-label="Search Motomart">
        <div class="chips hscroll" style="margin-bottom:10px">${['all', ...cats].map(c => `<button class="chip" data-act="cat" data-cat="${esc(c)}" aria-pressed="${mmState.cat === c}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>
        <div class="row" style="margin-bottom:14px;gap:8px">
            <select id="mms" aria-label="Show" style="flex:1"><option value="all">Live and sold</option><option value="live"${mmState.status === 'live' ? ' selected' : ''}>Only available</option><option value="sold"${mmState.status === 'sold' ? ' selected' : ''}>Only sold</option></select>
            <button class="chip" data-act="mine" aria-pressed="${mmState.mine}">My posts</button></div>
        ${shown.length ? `<div class="mm-grid">${shown.map(listingCard).join('')}</div>` : `<div class="card empty"><b>${all.length ? 'Nothing matches' : 'Nothing for sale yet'}</b>${mmState.mine ? 'You haven’t posted anything yet.' : 'Be the first to sell something.'}</div>`}
        <button class="btn fab" data-act="sell">＋ Sell something</button>`;
    actions = {
        cat: el => { mmState.cat = el.dataset.cat; viewMotomart(); },
        mine: () => { mmState.mine = !mmState.mine; mmState.status = 'all'; viewMotomart(); },
        sell: () => listingForm(),
        listing: el => listingDetail(all.find(l => String(l.id) === el.dataset.id))
    };
    $('#mms').onchange = e => { mmState.status = e.target.value; viewMotomart(); };
    let t; $('#mmq').oninput = e => { clearTimeout(t); t = setTimeout(() => { mmState.q = e.target.value; viewMotomart().then(() => { const i = $('#mmq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
    if (state.param) { const l = all.find(x => String(x.id) === state.param); if (l) listingDetail(l); else toast('That post is no longer available', true); }
}

function sellPostText(l) {
    return `📌 *RWB MOTOMART*\n\nProduct Name: ${l.product_name}\nSize: ${l.size || '–'}\nCategory: ${l.category}\nAge: ${l.age || '–'}\nCondition: ${l.condition || '–'}\nReason for Selling: ${l.reason || '–'}\nSelling Price: ${price(l.price)}\nSeller Name: ${l.seller_name}\nSeller Phone: ${l.seller_phone}${l.details ? `\n\n${l.details}` : ''}\n\n👉 Photos & contact in the RWB App: https://roninwb.in/app/#motomart/${l.id}`;
}
async function shareListing(l) {
    const text = sellPostText(l);
    try {   /* phones that can share photos straight into WhatsApp */
        if (navigator.canShare && l.photos?.length) {
            const files = await Promise.all(l.photos.slice(0, 4).map(async (p, i) => new File([await (await fetch(api.photoUrl(p))).blob()], `rwb-motomart-${l.id}-${i + 1}.jpg`, { type: 'image/jpeg' })));
            if (navigator.canShare({ files, text })) { await navigator.share({ files, text }); return; }
        }
    } catch (e) { if (e.name === 'AbortError') return; }
    window.open(waShare(text), '_blank', 'noopener');
}

function listingDetail(l) {
    const own = mine(l), adm = isAdmin();
    const contact = `Hi ${l.seller_name.split(' ')[0]}, I saw your ${l.product_name} (${price(l.price)}) on RWB Motomart. Is it still available?`;
    const fact = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
    openSheet(l.product_name, `
        ${l.photos?.length ? `<div class="gallery">${l.photos.map((p, i) => `<img src="${esc(api.photoUrl(p))}" alt="Photo ${i + 1} of ${esc(l.product_name)}">`).join('')}</div>${l.photos.length > 1 ? `<p class="small muted" style="text-align:center;margin-top:4px">Swipe for ${l.photos.length} photos</p>` : ''}` : ''}
        <div class="row" style="margin:12px 0 4px;justify-content:space-between"><b class="mm-price" style="font-size:1.9rem">${price(l.price)}</b>
            <span class="badge ${l.status === 'live' ? 'ok' : l.status === 'sold' ? '' : 'orange'}">${{ live: 'Available', sold: 'Sold', pending: 'Waiting for approval', rejected: 'Not approved' }[l.status]}</span></div>
        ${l.status === 'rejected' && l.reject_reason ? `<p class="warn" style="margin:8px 0">Admin note: ${esc(l.reject_reason)}. Edit the post to send it again.</p>` : ''}
        ${l.status === 'pending' && own ? '<p class="warn" style="margin:8px 0">An admin will check and publish your post, usually within 24 hours.</p>' : ''}
        <dl class="facts">${fact('Category', l.category)}${fact('Size', l.size)}${fact('Age', l.age)}${fact('Condition', l.condition)}${fact('Reason', l.reason)}${fact('Seller', l.seller_name)}${fact('Posted', l.published_at ? fmtDate(String(l.published_at).slice(0, 10)) : '')}</dl>
        ${l.details ? `<p style="margin-bottom:16px">${linkify(l.details)}</p>` : ''}
        <div class="list">
            ${!own && l.status === 'live' ? `<a class="btn wa block" href="${waTo(l.seller_phone, contact)}" target="_blank" rel="noopener">Message seller on WhatsApp</a>` : ''}
            ${adm && l.status === 'pending' ? `<div class="btns"><button class="btn ghost" data-x="reject">Reject</button><button class="btn" data-x="approve">Approve</button></div>` : ''}
            ${own && ['live', 'sold'].includes(l.status) ? `<button class="btn ${l.status === 'live' ? '' : 'ghost'} block" data-x="toggle">${l.status === 'live' ? 'Mark as sold' : 'Put back on sale'}</button>` : ''}
            ${(own || adm) && l.status !== 'rejected' ? '<button class="btn ghost block" data-x="share">Share to WhatsApp group</button>' : ''}
            ${own ? '<button class="btn ghost block" data-x="edit">Edit post</button>' : ''}
            ${own || adm ? '<button class="btn danger block" data-x="del">Delete post</button>' : ''}
        </div>`, body => {
        const on = (x, fn) => { const b = body.querySelector(`[data-x=${x}]`); if (b) b.onclick = () => fn(b); };
        const after = async msg => { await load.listings(true); closeSheet(); render(); toast(msg); };
        on('approve', b => busy(b, async () => { await api.setListingStatus(l.id, 'live'); await after('Approved. It’s live and members are notified.'); }));
        on('reject', b => { const r = window.prompt('Reason (the seller will see this):', 'Please add clearer photos'); if (r === null) return; busy(b, async () => { await api.setListingStatus(l.id, 'rejected', r.trim() || null); await after('Rejected'); }); });
        on('toggle', b => busy(b, async () => { await api.setListingStatus(l.id, l.status === 'live' ? 'sold' : 'live'); await after(l.status === 'live' ? 'Marked as sold 🎉' : 'Back on sale'); }));
        on('share', b => busy(b, () => shareListing(l)));
        on('edit', () => listingForm(l));
        on('del', b => { if (confirmBox('Delete this post and its photos?')) busy(b, async () => { await api.deleteListing(l); await after('Deleted'); }); });
    });
}

function listingForm(l = null) {
    const r = l ? { ...l } : { seller_name: state.me.full_name, seller_phone: state.me.phone || '', photos: [] };
    let kept = [...(r.photos || [])], removed = [], added = [];
    const MAX = 5;
    openSheet(l ? 'Edit post' : 'Sell on Motomart', `<form id="lf">
        ${l ? '' : '<p class="small muted">Your post goes live after an admin approves it, usually within 24 hours. Members can then message you on WhatsApp.</p>'}
        <fieldset><legend>Photos <span class="hint muted small">(1 to ${MAX}, clear and well lit)</span></legend>
            <div class="thumbs" id="thumbs"></div>
            <label class="file-pick"><input type="file" accept="image/*" multiple id="pics"><span>📷 Add photos</span></label></fieldset>
        <label>Product name<input name="product_name" required maxlength="120" placeholder="e.g. Axor Apex helmet, matte black" value="${esc(r.product_name || '')}"></label>
        <div class="grid2">
            <label>Category<select name="category" required><option value="">Choose…</option>${CATS.map(c => `<option${c === r.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label>Size<input name="size" maxlength="60" placeholder="L / 42 / Free size" value="${esc(r.size || '')}"></label>
        </div>
        <div class="grid2">
            <label>Age<input name="age" maxlength="60" placeholder="e.g. 8 months" value="${esc(r.age || '')}"></label>
            <label>Condition<select name="condition" required><option value="">Choose…</option>${CONDITIONS.map(c => `<option${c === r.condition ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        </div>
        <label>Reason for selling<input name="reason" maxlength="300" value="${esc(r.reason || '')}"></label>
        <label>Selling price (₹)<input name="price" type="number" required min="0" step="1" inputmode="numeric" value="${esc(r.price ?? '')}"></label>
        <label>More details <span class="hint">optional</span><textarea name="details" maxlength="1000" placeholder="Bill available? Any scratches? Pickup area?">${esc(r.details || '')}</textarea></label>
        <div class="grid2">
            <label>Seller name<input name="seller_name" required maxlength="80" value="${esc(r.seller_name || '')}"></label>
            <label>Seller WhatsApp<input name="seller_phone" required inputmode="tel" value="${esc(r.seller_phone || '')}"></label>
        </div>
        <button class="btn block">${l ? (l.status === 'rejected' ? 'Save and send for approval' : 'Save changes') : 'Send for approval'}</button>
    </form>`, body => {
        const thumbs = body.querySelector('#thumbs');
        const draw = () => {
            thumbs.innerHTML = [...kept.map(p => ({ src: api.photoUrl(p), k: 'k:' + p })), ...added.map((f, i) => ({ src: f.url, k: 'a:' + i }))]
                .map(t => `<div class="thumb"><img src="${esc(t.src)}" alt=""><button type="button" aria-label="Remove photo" data-k="${esc(t.k)}">✕</button></div>`).join('');
            body.querySelector('.file-pick').hidden = kept.length + added.length >= MAX;
        };
        thumbs.onclick = e => {
            const k = e.target.closest('button')?.dataset.k; if (!k) return;
            if (k.startsWith('k:')) { const p = k.slice(2); kept = kept.filter(x => x !== p); removed.push(p); }
            else { const i = Number(k.slice(2)); URL.revokeObjectURL(added[i].url); added.splice(i, 1); }
            draw();
        };
        body.querySelector('#pics').onchange = async e => {
            const files = [...e.target.files].slice(0, MAX - kept.length - added.length); e.target.value = '';
            for (const f of files) {
                try { const c = await compressImage(f); added.push({ file: c, url: URL.createObjectURL(c) }); draw(); }
                catch (err) { toast(err.message, true); }
            }
        };
        draw();
        body.querySelector('#lf').onsubmit = e => {
            e.preventDefault();
            if (kept.length + added.length === 0) return toast('Please add at least one photo', true);
            const d = Object.fromEntries(new FormData(e.target));
            const phone = d.seller_phone.replace(/\D/g, '').slice(-10);
            if (phone.length !== 10) return toast('Seller WhatsApp needs 10 digits', true);
            const rec = { id: l?.id, photos: kept.concat(removed), product_name: d.product_name.trim(), category: d.category, size: d.size.trim() || null, age: d.age.trim() || null,
                condition: d.condition, reason: d.reason.trim() || null, price: Number(d.price), details: d.details.trim() || null, seller_name: d.seller_name.trim(), seller_phone: phone };
            busy(e.submitter, async () => {
                await api.saveListing(rec, added.map(a => a.file), removed);
                added.forEach(a => URL.revokeObjectURL(a.url));
                await load.listings(true); closeSheet();
                if (location.hash.startsWith('#motomart')) render(); else location.hash = '#motomart';
                toast(l && l.status !== 'rejected' ? 'Saved' : 'Sent to admins for approval 👍');
            });
        };
    });
}

async function adminMotomart() {
    const pend = (await load.listings(true)).filter(l => l.status === 'pending');
    $('#admin-body').innerHTML = pend.length ? `<p class="small muted" style="margin-bottom:10px">Check photos, price and details, then approve. Members are notified when a post goes live. You can then share it to the WhatsApp group from the post.</p><div class="mm-grid">${pend.map(listingCard).join('')}</div>`
        : '<div class="card empty"><b>All clear</b>No Motomart posts waiting for approval.</div>';
    state.myId ??= await api.myId();
    actions.listing = el => listingDetail(pend.find(l => String(l.id) === el.dataset.id));
}

/* =================== Pookie chatbot =================== */
const CHAT_KEY = () => 'rwb-chat-' + (state.me?.id || 'x');
const chat = { msgs: null, busy: false, image: null, left: null };
const loadChat = () => { if (chat.msgs) return; try { chat.msgs = JSON.parse(localStorage.getItem(CHAT_KEY())) || []; } catch { chat.msgs = []; } };
const saveChat = () => { try { localStorage.setItem(CHAT_KEY(), JSON.stringify(chat.msgs.slice(-40))); } catch { /* ignore */ } };
const SUGGEST = ['My chain is making noise. What should I do?', 'Which engine oil does the Ronin 225 use?', 'How do I track mileage with Trip A?', 'How do I sell my old helmet on Motomart?', 'Tips for a long ride to the hills', 'Engine warning light is on. Is it safe to ride?'];
const AI_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/></svg>';

/* tiny, safe markdown: **bold**, *italic*, lists, links, paragraphs */
function md(text) {
    const lines = esc(text).split(/\n/); let html = '', list = null;
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
    const last = s[0], due = s.find(x => x.next_due_km || x.next_due_date), ms = f.length ? mileageStats(f) : null;
    const odo = Math.max(0, ...s.map(x => x.odometer_km), ...f.map(x => x.odometer_km));
    return {
        first_name: firstName(m), bike: m.bike || null, odometer_km: odo || null,
        last_service: last ? { date: last.service_date, km: last.odometer_km, type: SERVICE_TYPES[last.service_type], number: last.service_no, items: last.items } : null,
        next_service_due: due ? { km: due.next_due_km, date: due.next_due_date } : null,
        average_kmpl: ms?.avg ? Number(ms.avg.toFixed(1)) : null, last_tank_kmpl: ms?.last ? Number(ms.last.toFixed(1)) : null
    };
}

async function viewChat() {
    loadChat();
    await Promise.all([load.services().catch(() => []), load.fuel().catch(() => [])]);
    app.innerHTML = top('Pookie', chat.msgs.length ? '<button class="btn sm ghost" data-act="clear">New chat</button>' : '') + `
        <div id="chatlog" class="chatlog" aria-live="polite"></div>
        <form id="ask" class="askbar">
            <div id="att" class="att" hidden></div>
            <div class="row">
                <label class="icon-btn" aria-label="Add a photo" title="Add a photo">📷<input type="file" accept="image/*" id="aphoto" hidden></label>
                <textarea id="q" rows="1" maxlength="1500" placeholder="Ask Pookie…" aria-label="Your question"></textarea>
                <button class="btn send" aria-label="Send">➤</button>
            </div>
            <p class="small muted ai-note">Pookie uses Google Gemini and can make mistakes. Check anything safety-related with a mechanic. Don't share personal details.<span id="left"></span></p>
        </form>`;
    drawChat();
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
        : `<div class="chat-hello"><div class="ai-badge">${AI_ICON}</div><h2>Hi ${esc(firstName(state.me))}, I'm Pookie</h2>
            <p class="muted">Ask me about your Ronin 225, maintenance, a strange noise, riding tips, or how to use this app. You can also send a photo of a part or a warning light.</p>
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
        const history = chat.msgs.filter(m => !m.err).map(m => ({ role: m.role, text: m.text }));
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

/* Admin: teach Pookie RWB-specific things */
async function adminAI() {
    const notes = await api.chatNotes();
    $('#admin-body').innerHTML = `<div class="card"><h3>Teach Pookie</h3>
        <p class="small muted" style="margin:4px 0 12px">Anything written here, Pookie knows and trusts. For example: patron service centres with area and phone, RWB ride rules, the sticker process, recommended oil brands, tyre pressures your coordinators use, upcoming ride details. Members never see this text directly.</p>
        <form id="ainotes"><textarea name="notes" rows="12" maxlength="8000" placeholder="e.g. Patron service centres:\n- Example Motors, Salt Lake Sector 5 (10% off for RWB members)\n\nRide rules: helmet and riding jacket compulsory on all RWB rides…">${esc(notes)}</textarea>
        <button class="btn block">Save notes</button></form></div>
        <div class="card section"><h3>Is Pookie working?</h3>
        <p class="small muted" style="margin:4px 0 12px">Runs a quick test of every step (settings, Gemini key, models) and shows what happened. Doesn't use anyone's daily questions.</p>
        <button class="btn ghost block" id="diag">Run a check</button><pre id="diag-out" class="diag" hidden></pre></div>`;
    $('#diag').onclick = e => busy(e.target, async () => { const out = $('#diag-out'); out.hidden = false; out.textContent = 'Checking… (up to 30 seconds)'; out.textContent = (await api.diagnoseAI()).filter(Boolean).join('\n'); });
    $('#ainotes').onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { await api.saveChatNotes(e.target.notes.value.trim()); toast('Saved. Pookie will use this from the next question.'); }); };
}

/* =================== Boot =================== */
async function boot() {
    try {
        const sess = await api.session();
        if (!sess) return viewSignIn();
        const status = await api.linkAccount();
        if (status !== 'member') return viewAccess(status, sess);
        state.me = await api.me();
        await load.news(true);
        await render();
    } catch (e) {
        tabbar.hidden = true;
        app.innerHTML = `<section class="signin"><img src="icons/logo-128.png" alt=""><div><h1>Can't connect</h1><p class="lead">${esc(e.message || 'Please check your internet connection.')}</p></div><button class="btn block" onclick="location.reload()">Try again</button></section>`;
    }
}

(async () => {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
    try { api = await createApi(); }
    catch { app.innerHTML = `<section class="signin"><h1>Can't load</h1><p class="lead">Please check your internet connection.</p><button class="btn block" onclick="location.reload()">Try again</button></section>`; return; }
    if (location.hash === '#install') { history.replaceState(null, '', location.pathname); setTimeout(installSheet, 1200); }
    api.onAuthChange(ev => { chat.msgs = null; chat.left = null; Object.assign(state, { me: null, services: null, fuel: null, bdays: null, adminMembers: null, listings: null, news: null }); if (ev === 'SIGNED_OUT') history.replaceState(null, '', location.pathname); boot(); });
    boot();
})();
