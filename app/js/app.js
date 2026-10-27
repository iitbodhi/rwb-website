/* RWB App — screens and interactions */
import { createApi } from './api.js';
import { registerPlugin as capRegister } from '../vendor/capacitor/core.js';   /* Capacitor 7.6.9 (MIT): the Android app's plugins */

/* settings from config.js and the website's js/data.js (top-level consts, read by name) */
const C = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {}, SITE = typeof CONFIG !== 'undefined' ? CONFIG : {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app'), tabbar = $('#tabbar'), sheet = $('#sheet');

let api;
const state = { me: null, services: null, fuel: null, bdays: null, guides: null, acc: null, guideTab: 'maint', accCat: 'all', accSort: 'default', adminTab: 'requests', adminMembers: null, adminSearch: '' };
const isAdmin = () => ['admin', 'superadmin'].includes(state.me?.role);
const isMod = () => ['coordinator', 'admin', 'superadmin'].includes(state.me?.role);   /* Motomart moderators */
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
    docs: async (force) => (state.docs = !force && state.docs || await api.docs().catch(() => []))
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
const ROUTES = { videos: viewVideos, docs: viewDocs, home: viewHome, service: viewService, mileage: viewMileage, motomart: viewMotomart, guides: viewGuides, me: viewMe, admin: viewAdmin, news: viewNews, chat: viewChat, crew: viewCrew, events: viewEvents, terms: viewTerms, track: viewTrack };
/* roninwb.in/app/#terms: Me screen with the Terms & Conditions open, ready to agree */
function viewTerms() {
    history.replaceState(null, '', '#me'); document.body.dataset.route = 'me';
    tabbar.querySelectorAll('a').forEach(a => a.dataset.tab === 'me' ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    viewMe(); actions.rules?.();
}
/* screens render one after another, so the screen the rider tapped last always wins */
let renderChain = Promise.resolve();
function render() { renderChain = renderChain.then(doRender, doRender); return renderChain; }
async function doRender() {
    if (!state.me) return;          /* signed out / not loaded yet: boot() shows the right screen */
    const gate = isFam() ? null : await gateFor(state.me);
    if (gate) { tabbar.hidden = true; document.body.dataset.route = 'gate'; return gate === 'tnc' ? tncGate() : profileGate(); }
    const [name, param] = (location.hash.slice(1) || 'home').split('?')[0].split('/');
    state.param = param || null;
    if (isFam() && !FAM_ROUTES.includes(name)) { location.hash = '#home'; return; }
    const view = isFam() ? famView(name) : ROUTES[name] || viewHome;
    if (name === 'admin' && !isAdmin()) { location.hash = '#home'; return; }
    if (name === 'admin' && param) state.adminTab = param;
    tabbar.hidden = false;
    if (name !== 'chat') state.cameFrom = name;
    document.body.dataset.route = name;
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
const DOC_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M8 13.5h8M8 16.5h5"/></svg>';
const CREW_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.4.2 4 1.7 4.5 4.4"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>';
const docsAlert = () => (state.docs || []).some(d => docStatus(d).level !== 'ok' && docStatus(d).level !== 'none');
/* Android in the browser (not the RWB Android app): a small pulsing "Get app" button; never shown on iPhone */
const getAppBtn = () => !NATIVE && /android/i.test(navigator.userAgent) ? `<a class="get-app" href="${apkUrl()}" download="RWB-App.apk" aria-label="Download the RWB Android app"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>App</span></a>` : '';
const top = (title, right = '') => `${demoBar()}<header class="top"><img class="logo" src="icons/logo-128.png" alt=""><h1>${esc(title)}</h1>${right}${getAppBtn()}
    <a class="icon-btn bell vid-btn" href="#videos" aria-label="How-to videos">${PLAY_ICON}</a>
    <a class="icon-btn bell crew-btn" href="#crew" aria-label="RWB members and leaderboards">${CREW_ICON}</a>
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
    return '';
}

const G_ICON = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function viewSignIn() {
    tabbar.hidden = true;
    app.innerHTML = `${demoBar()}<section class="signin">
        <img src="icons/logo-384.png" alt="Ronin Warriors of Bengal">
        <div><h1>RWB App</h1><p class="lead">For members of Ronin Warriors of Bengal. Sign in with the Google account you used on the RWB join form.</p></div>
        <button class="btn gbtn block" data-act="google">${G_ICON} Continue with Google</button>
        <p class="small muted">Not a member yet? <a href="${esc(JOIN_URL)}" target="_blank" rel="noopener">Join RWB here</a> with the RWB join form. Once an admin approves you, sign in with the same email.</p>
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
const SKIP_Q = /^(timestamp|email( address)?|score)$/i;
const isExtraQ = q => !SKIP_Q.test(String(q).trim()) && !/^\s*[0-9.]*\s*$/.test(String(q)) && !formKey(q);
const ansText = a => Array.isArray(a) ? a.join(', ') : String(a ?? '').trim();
/* the join-form answers that don't have their own field in the profile (sticker, social media and so on) */
const extraAnswers = m => Object.entries(m?.form_answers || {}).filter(([q, a]) => isExtraQ(q) && ansText(a));
/* every such question: from the live join form (even if unanswered) plus anything already on the record */
const moreQs = m => [...new Set([...(joinFormDef?.items || []).filter(i => i.title && !['PAGE_BREAK', 'SECTION_HEADER', 'IMAGE', 'VIDEO'].includes(i.type) && isExtraQ(i.title)).map(i => i.title),
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
let joinFormDef;   // loaded once
async function loadJoinForm() { if (joinFormDef === undefined) joinFormDef = await api.joinForm().catch(() => null); return joinFormDef; }
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
    const head = `<span class="fq-title">${esc(item.title)}${item.required ? ' <span class="req">*</span>' : ''}</span>${item.help ? `<span class="fq-help">${esc(item.help)}</span>` : ''}`;
    if (k === 'tnc' && item.choices) item = { ...item, choices: item.choices.filter(c => !/(don'?t|do not|not agree|disagree)/i.test(c.value)) };   /* joining means agreeing */
    if (item.type === 'MULTIPLE_CHOICE' || item.type === 'CHECKBOX') {
        const multi = item.type === 'CHECKBOX', vals = multi ? String(val || '').split(/,\s*/) : [val];
        return `<fieldset class="fq${k === 'tnc' ? ' fq-tnc' : ''}" data-i="${i}"${item.required ? ' data-req="1"' : ''}><legend>${head}</legend>${k === 'tnc' ? '<button type="button" class="link-btn tnc-link" data-act="tnc-read">Read the full RWB Terms & Conditions ›</button>' : ''}${item.choices.map(c => `<label class="fq-choice"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(c.value)}"${vals.includes(c.value) ? ' checked' : ''}${c.ends ? ' data-ends="1"' : ''}><span>${esc(c.value)}</span></label>`).join('')}</fieldset>`;
    }
    if (item.type === 'LIST') return `<label class="fq" data-i="${i}">${head}<select name="${name}"${req}><option value="">Choose</option>${item.choices.map(c => `<option${c.value === val ? ' selected' : ''}>${esc(c.value)}</option>`).join('')}</select></label>`;
    if (item.type === 'DATE') return `<label class="fq" data-i="${i}">${head}<input type="date" name="${name}" max="${todayISO()}"${req} value="${esc(val)}"></label>`;
    if (item.type === 'PARAGRAPH_TEXT') return `<label class="fq" data-i="${i}">${head}<textarea name="${name}" rows="3"${req}>${esc(val)}</textarea></label>`;
    if (item.type === 'SCALE') return `<label class="fq" data-i="${i}">${head}<select name="${name}"${req}><option value="">Choose</option>${Array.from({ length: (item.high || 5) - (item.low || 1) + 1 }, (_, j) => (item.low || 1) + j).map(n => `<option${String(n) === val ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
    const extra = PHONE_KEYS.includes(k) ? ' inputmode="tel" autocomplete="off"' : k === 'vrn' ? ' autocapitalize="characters"' : k === 'full_name' ? ' autocomplete="name"' : '';
    return `<label class="fq" data-i="${i}">${head}<input name="${name}"${extra}${req} value="${esc(val)}"></label>`;
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
function readForm(def, form) {
    const fd = new FormData(form), out = { answers: {} };
    def.items.forEach((it, i) => {
        if (it.type === 'PAGE_BREAK' || it.type === 'SECTION_HEADER') return;
        const v = (it.type === 'CHECKBOX' ? fd.getAll(`q${i}`).join(', ') : String(fd.get(`q${i}`) ?? '')).replace(/\s+/g, ' ').trim();
        if (v) out.answers[it.title] = v;
        const k = formKey(it.title); if (!k) return;
        if (k === 'tnc') out.tnc = isAgree(v);
        else if (k === 'bike') out.bike = roninAnswer(v);
        else if (k === 'vrn') out.vrn = v.toUpperCase();
        else out[k] = v;
    });
    if (!def.items.some(it => formKey(it.title) === 'tnc')) out.tnc = !!form.querySelector('[name=tnc]')?.checked;
    return out;
}
function checkPage(pg, form) {
    for (const it of pg.items) {
        if (it.type === 'SECTION_HEADER') continue;
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
function liveJoinForm(def, known, sess, filled = false) {
    const pages = formPages(def);
    let at = 0;
    app.innerHTML = `${demoBar()}<header class="top"><img class="logo" src="icons/logo-128.png" alt=""><h1>Join RWB</h1></header>
        <p class="small muted" style="margin:4px 0 14px">Signed in as <b>${esc(sess.email)}</b>${filled ? '. We filled in what RWB already knows; check it and change anything that\'s wrong.' : '. Same questions as the RWB join form.'}</p>
        <form id="req" class="gform" novalidate>${pages.map((pg, n) => `<section class="gpage" data-p="${n}"${n ? ' hidden' : ''}>
            ${pg.title ? `<h2 class="gp-title">${esc(pg.title)}</h2>` : ''}${pg.help ? `<p class="gp-help">${esc(pg.help)}</p>` : ''}
            ${pg.items.map(it => it.type === 'SECTION_HEADER' ? `<div class="fq-section"><b>${esc(it.title)}</b>${it.help ? `<span class="fq-help">${esc(it.help)}</span>` : ''}</div>` : formItemHtml(it, it.i, prefillFor(it, known))).join('')}
            ${n === pages.length - 1 && !def.items.some(it => formKey(it.title) === 'tnc') ? rulesBlock() : ''}
            <div class="gnav">${n ? '<button type="button" class="btn ghost" data-act="gback">Back</button>' : ''}${n < pages.length - 1 ? '<button type="button" class="btn" data-act="gnext">Next</button>' : '<button class="btn">Send to admins</button>'}</div>
            <p class="small muted gp-count">Page ${n + 1} of ${pages.length}</p></section>`).join('')}
        </form>
        <button type="button" class="btn ghost block" data-act="out" style="margin-top:10px">Use a different Google account</button>`;
    const form = $('#req');
    const qIdx = key => def.items.findIndex(it => formKey(it.title) === key);
    vrnWatch(form.querySelector(`[name=q${qIdx('vrn')}]`), form.querySelector(`[name=q${qIdx('phone')}]`));
    const show = n => { at = n; form.querySelectorAll('.gpage').forEach(p => p.hidden = Number(p.dataset.p) !== n); window.scrollTo(0, 0); };
    actions = {
        out: () => api.signOut(),
        'tnc-read': () => showTnc(),
        gnext: () => { const err = checkPage(pages[at], form) || (form.querySelector(`.gpage[data-p="${at}"] .vrn-taken:not([hidden])`) ? vrnTaken(form) : ''); if (err) return toast(err, true); show(at + 1); },
        gback: () => show(at - 1)
    };
    form.addEventListener('submit', e => {
        e.preventDefault();
        for (let n = 0; n < pages.length; n++) { const err = checkPage(pages[n], form); if (err) { show(n); return toast(err, true); } }
        const f = readForm(def, form);
        if (!f.full_name || !f.phone) return toast('Full Name and WhatsApp No. are needed', true);
        if (f.emergency_phone && f.phone && f.emergency_phone.replace(/\D/g, '').slice(-10) === f.phone.replace(/\D/g, '').slice(-10)) return toast('The emergency contact should be someone else\'s number', true);
        if (!f.tnc) return toast('You need to agree to the RWB Terms & Conditions to join.', true);
        if (vrnTaken(form)) return toast(vrnTaken(form), true);
        busy(e.submitter, async () => { await api.requestAccess(f); boot(); });
    });
}

/* Not a member (yet). The only way to join is the RWB join form on roninwb.in: an admin approves the entry, then the
   rider signs in here with the same email and their details are already filled in. */
const JOIN_URL = SITE.JOIN_FORM_URL || 'https://roninwb.in';
async function viewAccess(status, sess) {
    tabbar.hidden = true;
    actions = { recheck: b => busy(b, boot), out: () => api.signOut(), 'help-admins': () => joinHelpSheet(sess), 'fam-join': () => famJoinScreen(sess) };
    if (status === 'pending') {
        app.innerHTML = `${demoBar()}<section class="signin"><img src="icons/logo-128.png" alt="">
            <div><h1>Waiting for approval</h1><p class="lead">We've got your RWB join form. An RWB admin will check your details, usually within a day.</p></div>
            <p class="small muted">Once you're approved you'll get a WhatsApp message. Then open the app and sign in with <b>${esc(sess.email)}</b>: your details will already be there.</p>
            <button class="btn block" data-act="recheck">Check again</button>
            <button class="btn ghost block" data-act="out">Sign out</button></section>`;
        return;
    }
    app.innerHTML = `${demoBar()}<section class="signin no-acct"><img src="icons/logo-128.png" alt="">
        <div><h1>No Account Found!</h1><p class="lead">There's no RWB membership for <b>${esc(sess.email)}</b>.</p></div>
        <form class="card na-card na-find" id="naf" novalidate>
            <b class="na-h">Already in RWB? Find your account</b>
            <p class="small muted">Enter the WhatsApp number and VRN you joined RWB with.</p>
            <label>WhatsApp No.<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98300 11111" required></label>
            <label>VRN<input name="vrn" autocapitalize="characters" autocomplete="off" placeholder="WB02AB1234" required></label>
            <button class="btn block" data-x="find">Find my email</button>
            <div id="na-out" hidden></div>
        </form>
        <div class="card na-card"><p>Still stuck? <button type="button" class="linkish" data-act="help-admins">WhatsApp the Admins</button> to know your registered email.</p></div>
        <div class="card na-card"><p>Not joined yet? <a href="${esc(JOIN_URL)}" target="_blank" rel="noopener">Join here</a></p></div>
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
            if (!r?.found) { out.innerHTML = '<p class="warn small">No RWB member found with that WhatsApp number and VRN. Check both and try again, or WhatsApp the Admins.</p>'; return; }
            if (r.on_app) { out.innerHTML = `<div class="na-hint"><span class="small muted">This membership is already on the app with</span><b>${esc(r.hint || 'another email')}</b></div>
                <button type="button" class="btn block" data-x="switch">Sign in with that account</button>` + verifyForm('', true); }
            else out.innerHTML = (r.hint ? `<div class="na-hint"><span class="small muted">You joined RWB with</span><b>${esc(r.hint)}</b></div>
                <button type="button" class="btn block" data-x="switch">Sign in with that account</button>` : '') + verifyForm(r.hint ? '' : '<p class="small muted">There\'s no email on your RWB record.</p>');
            const sw = out.querySelector('[data-x=switch]'); if (sw) sw.onclick = () => busy(sw, async () => { await api.signOut(); await api.signIn(); });
            const cl = out.querySelector('[data-x=claim]');
            if (cl) cl.onclick = () => { const dob = out.querySelector('[name=dob]').value, v2 = read(), err2 = check(v2);
                if (err2) return toast(err2, true); if (!dob) return toast('Enter your date of birth', true);
                busy(cl, async () => { const res = await api.claimMembership(v2.phone, v2.vrn, dob);
                    if (!res?.ok) return toast('Those details don\'t match your RWB record. Check your date of birth, or WhatsApp the Admins.', true);
                    toast(`Welcome${res.name ? ', ' + res.name : ''}! You're in. 🏍️`); boot(); }); };
        });
    };
}
async function joinHelpSheet(sess) {
    const list = await api.joinHelpAdmins().catch(() => []);
    const msg = a => `Hi ${a.first_name}, I'm ${sess.name || 'an RWB member'}. I signed in to the RWB App with ${sess.email}, but it says No Account Found. Could you tell me which email I registered with?`;
    openSheet('WhatsApp the Admins', `<p class="small muted" style="margin-bottom:10px">Choose an admin. They'll tell you the email you joined with, so you can sign in with it.</p>
        <div class="group">${list.length ? list.map(a => `<div class="bike-row"><span class="g-ico">🛡️</span><span class="grow"><b>${esc(a.first_name)}</b><span class="small muted">RWB admin</span></span>
            <a class="btn sm wa" target="_blank" rel="noopener" href="${waTo(a.phone, msg(a))}">WhatsApp</a></div>`).join('') : '<p class="small muted" style="padding:12px">Could not load the admins. Please try again, or message RWB on Instagram.</p>'}</div>`);
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
    openSheet(n.title, `<p class="small muted" style="margin-bottom:12px">${KIND_ICON[n.kind] || '📣'} ${timeAgo(n.created_at)}${n.audience === 'admins' ? ' · admins only' : n.audience === 'moderators' ? ' · team only' : ''}</p>
        <div class="news-full">${n.body ? linkifyNews(n.body) : '<span class="muted">No details.</span>'}</div>
        <button class="btn ghost block" data-x="share" style="margin-top:16px">Share on WhatsApp</button>`, body => {
        body.querySelector('[data-x=share]').onclick = () => openWA(waShare(`📣 *${n.title}*${n.body ? '\n\n' + n.body : ''}\n\n– RWB App: https://${APP_LINK}`));
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
    if (compact) return `<a class="news-row mini ${n.kind}" href="${esc(href)}"${openAttr}${sw}><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || '📣'}</span>
        <span class="grow"><b>${esc(n.title)}</b><span class="news-line">${n.body ? esc(n.body) + ' · ' : ''}${shortAgo(n.created_at)}${n.audience === 'admins' ? ' · admins' : n.audience === 'moderators' ? ' · team' : ''}</span></span>${ICON.chev}</a>`;
    return `<a class="news-row ${n.kind}" href="${esc(href)}"${openAttr}${sw}><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || '📣'}</span>
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
    return `<a class="banner todo" href="#me"><span class="b-ico">${rules ? '📜' : '✍️'}</span><span class="grow"><b>${rules ? 'Please agree to the RWB Terms & Conditions' : 'Complete your profile'}</b><span class="small muted">${rules && rest.length ? 'And add your ' + rest.join(', ') : rules ? 'Me → Terms & Conditions → Read & agree' : 'Add your ' + rest.join(', ')}</span></span>${ICON.chev}</a>`;
}
async function viewHome() {
    const [services, fuel, bdays, news, listings, docs, evd] = await Promise.all([load.services(), load.fuel(), load.bdays(), load.news(), load.listings().catch(() => []), load.docs(), loadEvents().catch(() => null)]);
    const nextEvt = evd ? evd.events.filter(e => e.status === 'live' && !evtPast(e) && new Date(e.starts_at) - Date.now() < 14 * 864e5)[0] : null;
    const docWarn = docs.map(d => ({ d, st: docStatus(d) })).filter(x => x.st.level === 'bad' || x.st.level === 'warn').sort((a, b) => a.st.days - b.st.days)[0];
    syncKmpl(fuel);
    const today = bdays.filter(b => b.day === todayISO());
    const fresh = listings.filter(l => l.status === 'live').slice(0, 8);
    let pushAsk = false; try { pushAsk = NATIVE ? !localStorage.getItem(FCM_KEY) && !localStorage.getItem('rwb-push-dismissed') : pushSupported() && Notification.permission === 'default' && !localStorage.getItem('rwb-push-dismissed'); } catch { /* ignore */ }
    const names = today.map(b => b.full_name.split(' ')[0]);
    /* "Clear" hides birthdays, Motomart and member updates on this phone; admin announcements stay until an admin deletes them */
    const feed = visibleNews(news);
    app.innerHTML = top(`Hi, ${firstName(state.me)}`) + `
        ${cluster(services, fuel)}
        <nav class="quick" aria-label="Quick actions">
            <button data-act="add-fuel"><span>${ICON.fuel}</span>Add fuel</button>
            <button data-act="add-service"><span>${ICON.wrench}</span>Log service</button>
            <button data-act="fam" class="fam-q" aria-label="RWB FAM: invite your family"><span>${FAM_ICON}</span>FAM</button>
            <button data-act="sell"><span>${ICON.tag}</span>Sell gear</button>
            <a href="#docs" aria-label="Documents${docsAlert() ? ' (something needs renewing)' : ''}"><span>${DOC_ICON}${docsAlert() ? '<i class="dot dot-red"></i>' : ''}</span>Documents</a>
        </nav>
        ${isAdmin() ? `<section class="admin-dock" aria-label="Admin">
            <div class="ad-head"><b>${ICON.shield} Admin</b><span class="small muted" id="ad-sum"></span><a href="#admin" data-adtab="requests" class="ad-all">Open ›</a></div>
            <div class="ad-grid">
                <a href="#admin" data-adtab="requests"><span class="ad-ico">✅</span>Approvals<i class="ad-n" id="ad-req" hidden></i></a>
                <a href="#admin" data-adtab="members"><span class="ad-ico">👥</span>Members</a>
                <a href="#admin" data-adtab="motomart"><span class="ad-ico">🛒</span>Motomart<i class="ad-n" id="ad-mm" hidden></i></a>
                <a href="#admin" data-adtab="bdays"><span class="ad-ico">🎂</span>Birthdays</a>
            </div></section>` : isMod() ? '<a class="banner admin" href="#admin" id="admin-banner" hidden></a>' : ''}
        ${profileTodo(state.me)}
        ${docWarn ? `<a class="banner doc-warn ${docWarn.st.level}" href="#docs"><span class="b-ico">📄</span><span class="grow"><b>${esc(docName(docWarn.d))}</b> ${docWarn.st.days < 0 ? `expired on ${fmtDate(docWarn.d.expiry_date)}` : docWarn.st.days === 0 ? 'expires today' : `expires in ${docWarn.st.days} day${docWarn.st.days === 1 ? '' : 's'}`}. Renew it and update My documents.</span>${ICON.chev}</a>` : ''}
        ${nextEvt ? `<div class="home-evt">${eventCard(nextEvt, evd)}</div>` : ''}
        ${today.length ? `<div class="banner bday"><span class="b-ico">🎂</span><span class="grow"><b>${esc(names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0])}</b> ${names.length > 1 ? 'have' : 'has'} a birthday today</span><button class="btn sm wa" data-act="wish">Wish</button></div>` : ''}
        ${pushAsk ? `<div class="banner"><span class="b-ico">🔔</span><span class="grow">${isMod() ? 'Get birthdays, Motomart posts and ride news as notifications' : 'Get ride news, events and Motomart posts as notifications'}</span><button class="btn sm" data-act="push-on">Turn on</button><button class="icon-btn" data-act="push-later" aria-label="Not now">✕</button></div>` : ''}
        ${vrnCheckCard()}
        ${feed.length ? `<section class="section"><h2>Latest from RWB <span class="h-acts"><button data-act="clear-feed">Clear</button><a href="#news">See all</a></span></h2><div class="group news-mini">${feed.slice(0, 3).map(n => newsRow(n, false, true)).join('')}</div></section>` : ''}
        <section class="section"><h2>Fresh on Motomart <a href="#motomart">See all</a></h2>
            ${fresh.length ? `<div class="strip">${fresh.map(listingCard).join('')}</div>` : `<a class="group-row-card" href="#motomart"><span class="g-ico">${ICON.tag}</span><span class="grow"><b>Nothing for sale yet</b><span class="small muted">Selling old gear? Post it here for fellow riders.</span></span>${ICON.chev}</a>`}</section>
        <section class="section"><h2>Explore</h2><div class="group">
            <a href="#guides" data-guide="maint"><span class="g-ico">${ICON.book}</span><span class="grow"><b>Maintenance guides</b><span class="small muted">How-tos and checklists from our coordinators</span></span>${ICON.chev}</a>
            <a href="#guides" data-guide="acc"><span class="g-ico">${ICON.helmet}</span><span class="grow"><b>Recommended gear</b><span class="small muted">Accessories tested and scored by RWB</span></span>${ICON.chev}</a>
            <a href="https://roninwb.in" target="_blank" rel="noopener"><span class="g-ico">${ICON.globe}</span><span class="grow"><b>roninwb.in</b><span class="small muted">Rides, events, gallery and the team</span></span>${ICON.out}</a>
        </div></section>`;
    swipeToDismiss(app, () => { if (!app.querySelector('.news-mini [data-swipe]')) render(); });
    bindVrnCheck();
    actions = {
        evt: el => location.hash = '#events/' + el.dataset.id,
        'push-on': b => busy(b, async () => { await enablePush(); toast('Notifications are on'); render(); }),
        'push-later': () => { try { localStorage.setItem('rwb-push-dismissed', '1'); } catch { /* ignore */ } render(); },
        sell: () => listingForm(),
        'clear-feed': () => clearNews(news),
        listing: el => location.hash = '#motomart/' + el.dataset.id
    };
    app.querySelectorAll('[data-guide]').forEach(a => a.addEventListener('click', () => state.guideTab = a.dataset.guide));
    if (isMod() && !isAdmin()) {   /* coordinators: Motomart posts to check */
        const mm = listings.filter(l => l.status === 'pending').length, b = $('#admin-banner');
        if (b && mm) { b.innerHTML = `<span class="b-ico">${ICON.tag}</span><span class="grow">${mm} Motomart post${mm > 1 ? 's' : ''} waiting for approval</span>${ICON.chev}`; b.href = '#motomart/review'; b.hidden = false; }
    }
    if (isAdmin()) {
        app.querySelectorAll('[data-adtab]').forEach(a => a.addEventListener('click', () => { state.adminTab = a.dataset.adtab; }));
        api.admin.stats().then(s => {
            const mm = listings.filter(l => l.status === 'pending').length, set = (id, n) => { const el = $('#' + id); if (el) { el.textContent = n; el.hidden = !n; } };
            set('ad-req', s.pending); set('ad-mm', mm);
            const sum = $('#ad-sum'); if (sum) sum.textContent = s.pending || mm ? `${s.pending + mm} waiting for you` : `${s.members} members · all clear`;
            const dock = app.querySelector('.admin-dock'); if (dock) dock.classList.toggle('busy', !!(s.pending || mm));
        }).catch(() => {});
    }
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
const RSVP_TXT = { going: 'Going', maybe: 'Maybe', no: "Can't go" };
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
const EVT_ICON = { clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>' };
/* slots left (when the event has a limit) */
const evtSlots = (e, n) => { if (!e.capacity) return ''; const left = Math.max(e.capacity - n, 0), p = Math.min(n / e.capacity, 1);
    return `<span class="evt-slots ${p >= 1 ? 'full' : p >= .6 ? 'mid' : ''}"><span><b>${left}</b> of ${e.capacity} slots left</span><i><i style="width:${Math.round(p * 100)}%"></i></i></span>`; };
const evtTile = e => `<span class="evt-tile${e.status === 'cancelled' ? ' off' : ''}${evtMulti(e) ? ' multi' : ''}">${evtDay(e.starts_at)}${evtMulti(e) ? `<span class="evt-arr" aria-label="to">↓</span>${evtDay(e.ends_at)}` : ''}</span>`;
const mapsUrl = e => e.map_url || (e.location ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.location) : '');
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
async function loadEvents(force) {
    if (!force && state.evd && Date.now() - state.evd.at < 60e3) return state.evd;
    const [events, counts, mine] = await Promise.all([api.events(), api.eventCounts().catch(() => []), api.myRsvps().catch(() => [])]);
    return state.evd = { at: Date.now(), events, counts: Object.fromEntries(counts.map(c => [c.event_id, c])), mine: Object.fromEntries(mine.map(r => [r.event_id, r])) };
}
async function viewEvents() {
    const d = await loadEvents(true);
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
function eventCard(e, d) {
    const c = d.counts[e.id] || { going: 0, maybe: 0, guests: 0, faces: [] }, me = d.mine[e.id];
    const n = c.going + c.guests;
    return `<button class="card tap evt-card${e.status === 'cancelled' ? ' cancelled' : ''}" data-act="evt" data-id="${e.id}">
        ${evtTile(e)}
        <span class="grow">${evtEyebrow(e)}<b>${esc(e.title)}</b><span class="evt-fact">${EVT_ICON.clock}${esc(evtWhen(e, true))}</span>${e.location ? `<span class="evt-fact">${EVT_ICON.pin}${esc(e.location)}</span>` : ''}
            ${e.status !== 'cancelled' && !evtPast(e) ? evtSlots(e, n) : ''}
            <span class="evt-meta">${e.status === 'cancelled' ? '<span class="badge">Cancelled</span>' : isFam() ? '' : `${n ? faceStack(c.faces, c.going - c.faces.length) : ''}<span class="small muted">${n ? `${n} ${evtPast(e) ? 'went' : 'going'}` : evtPast(e) ? 'Past event' : isFam() ? 'RWB event' : 'Be the first to join'}${c.maybe ? ` · ${c.maybe} maybe` : ''}</span>`}</span></span>
        ${me ? `<span class="evt-me ${me.status}">${RSVP_TXT[me.status]}</span>` : e.status === 'live' && !evtPast(e) && !isFam() ? '<span class="evt-me ask">RSVP</span>' : ''}</button>`;
}
async function eventPage(e) {
    const d = state.evd, me = d.mine[e.id], mod = isMod(), myUid = state.myId ??= await api.myId(), fam = isFam();
    const people = fam ? [] : await api.eventPeople(e.id).catch(() => []);
    const going = people.filter(p => p.status === 'going'), maybe = people.filter(p => p.status === 'maybe'), no = people.filter(p => p.status === 'no');
    const guests = going.reduce((a, p) => a + p.guests, 0);
    const inGroup = me && me.status !== 'no';
    const live = e.status === 'live', past = evtPast(e);
    const ppl = (list, label) => list.length ? `<details class="evt-people"${label === 'Going' ? ' open' : ''}><summary><b>${label}</b> <span class="muted">${list.length}${label === 'Going' && guests ? ` + ${guests} guest${guests > 1 ? 's' : ''}` : ''}</span></summary>
        <div class="evt-plist">${list.map(p => `<div class="row">${face(p, 'avatar sm')}<span class="grow">${esc(p.full_name)}${p.user_id === myUid ? ' <span class="muted">(you)</span>' : ''}</span>${p.guests ? '<span class="badge">+1 guest</span>' : ''}</div>`).join('')}</div></details>` : '';
    app.innerHTML = top('Events') + `
        <a class="back-link" href="#events">‹ All events</a>
        <section class="card evt-hero${live ? '' : ' cancelled'}">
            <div class="evt-head">${evtTile(e)}<div class="evt-head-main">${evtEyebrow(e)}<h2 class="evt-title">${esc(e.title)}</h2>${!live ? '<span class="badge">Cancelled</span>' : past ? '<span class="badge">Ended</span>' : ''}
                <div class="evt-when">${evtMulti(e)
                    ? `<div><span>Starts</span><b>${esc(tfmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><em>${esc(evtTime(e.starts_at))}</em></div><div><span>Ends</span><b>${esc(tfmt(e.ends_at, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><em>${esc(evtTime(e.ends_at))}</em></div>`
                    : `<div><span>When</span><b>${esc(tfmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><em>${esc(evtTime(e.starts_at))}${e.ends_at ? ' – ' + esc(evtTime(e.ends_at)) : ''}</em></div>`}</div>
                ${e.location ? `<div class="evt-place">${EVT_ICON.pin}<span><b>${esc(e.location)}</b>${mapsUrl(e) ? `<a href="${esc(mapsUrl(e))}" target="_blank" rel="noopener">Open in Maps ↗</a>` : ''}</span></div>` : ''}
            </div></div>
            <div class="evt-facts">
                ${live && !past && e.capacity ? `<p><span>🎟</span>${evtSlots(e, going.length + guests)}</p>` : ''}
                ${e.call_link ? `<p><span>📞</span><a href="${esc(e.call_link)}" target="_blank" rel="noopener">Join the call</a></p>` : ''}
                ${e.reminder_minutes != null ? `<p><span>⏰</span>Reminder ${esc(REMINDERS.find(r => r[0] === e.reminder_minutes)?.[1].toLowerCase() || '')} for people going</p>` : ''}
            </div>
            ${e.description ? `<p class="evt-desc">${linkify(e.description)}</p>` : ''}
            ${live && !past && !fam ? `<div class="evt-rsvp" role="group" aria-label="Your response">${['going', 'maybe', 'no'].map(k => `<button class="${me?.status === k ? 'on ' + k : ''}" data-act="rsvp" data-s="${k}" aria-pressed="${me?.status === k}">${{ going: '✓ Going', maybe: '? Maybe', no: "✕ Can't go" }[k]}</button>`).join('')}</div>
                ${e.allow_guests && me?.status === 'going' ? `<label class="switch" style="margin-top:10px">Bringing a guest (+1)<input type="checkbox" id="evt-guest"${me.guests ? ' checked' : ''}></label>` : ''}` : ''}
            <div class="btns evt-actions">${fam ? '' : '<button class="btn sm ghost" data-act="evt-share">Share</button>'}${live && !past ? `<a class="btn sm ghost" href="${esc(gcalUrl(e))}" target="_blank" rel="noopener">Add to calendar</a>` : ''}</div>
        </section>
        ${rideLive(e)}
        ${fam ? '' : `<section class="section"><h2>Who's coming</h2><div class="card">${people.length ? ppl(going, 'Going') + ppl(maybe, 'Maybe') + ppl(no, "Can't go") : '<p class="muted small">No responses yet.</p>'}</div></section>
        <section class="section" id="exp-sec"><h2>Expenses</h2><div id="exp-body">${inGroup || mod ? '<p class="muted small">Loading…</p>' : `<div class="card empty"><b>Split costs with the group</b>Respond Going or Maybe to see and add shared expenses for this event.</div>`}</div></section>`}
        ${mod ? `<section class="section"><h2>Organiser</h2><div class="btns">${live ? '<button class="btn ghost" data-act="evt-edit">Edit</button><button class="btn ghost" data-act="evt-cancel">Cancel event</button>' : ''}<button class="btn danger" data-act="evt-del">Delete</button></div></section>` : ''}`;
    actions = {
        rsvp: b => busy(b, async () => { await api.rsvp(e.id, b.dataset.s, b.dataset.s === 'going' ? (me?.guests || 0) : 0); await loadEvents(true); toast(b.dataset.s === 'going' ? "You're going 🏍️" : b.dataset.s === 'maybe' ? 'Marked as maybe' : 'Marked as can\'t go'); render(); }),
        'evt-share': () => openWA(waShare(`📅 *${e.title}*\n🗓 ${evtWhen(e)}${e.location ? `\n📍 ${e.location}${mapsUrl(e) ? ' ' + mapsUrl(e) : ''}` : ''}${e.description ? `\n\n${e.description}` : ''}\n\n👉 RSVP in the RWB App: https://roninwb.in/app/#events/${e.id}`)),
        'evt-edit': () => eventForm(e),
        'evt-track-share': () => shareSheet(e.id, e.title),
        'evt-cancel': b => { if (confirmBox(`Cancel “${e.title}”? Everyone gets a notification.`)) busy(b, async () => { await api.saveEvent({ id: e.id, status: 'cancelled' }); await loadEvents(true); toast('Event cancelled'); render(); }); },
        'evt-del': b => { if (confirmBox(`Delete “${e.title}” with its RSVPs and expenses? This can't be undone.`)) busy(b, async () => { await api.deleteEvent(e.id); await loadEvents(true); location.hash = '#events'; toast('Deleted'); }); }
    };
    const g = $('#evt-guest'); if (g) g.onchange = () => busy(null, async () => { await api.rsvp(e.id, 'going', g.checked ? 1 : 0); await loadEvents(true); toast(g.checked ? 'Guest added' : 'Guest removed'); render(); });
    if (!fam && (inGroup || mod)) drawExpenses(e, people, myUid);
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
const EVT_TAGS = ['Small Ride', 'Sunday Highs Ride', 'Long Tour', 'Training Session', 'Service Camp', 'Event'];
function eventForm(e = null) {
    const r = e ? { ...e } : { reminder_minutes: 60, allow_guests: false };
    const tagPick = !r.tag ? '' : EVT_TAGS.includes(r.tag) ? r.tag : 'Custom';
    const start = toLocalInput(r.starts_at), end = toLocalInput(r.ends_at), sameDay = !end || end.slice(0, 10) === start.slice(0, 10);
    openSheet(e ? 'Edit event' : 'Create event', `<form id="evf" class="evt-form">
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
            busy(ev.submitter, async () => { const saved = await api.saveEvent(rec); await loadEvents(true); closeSheet(); toast(e ? 'Saved. Members are told if the time or place changed.' : 'Published. Members are notified.'); location.hash = '#events/' + (e?.id ?? saved?.id ?? ''); render(); });
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
    let exps; try { exps = await api.expenses(e.id); } catch (err) { box.innerHTML = `<p class="muted small">${esc(err.message)}</p>`; return; }
    const names = Object.fromEntries(people.map(p => [p.user_id, p.user_id === myUid ? 'You' : (p.nickname || p.full_name.split(' ')[0])]));
    const nm = u => names[u] || 'Someone';
    const crowd = people.filter(p => p.status !== 'no');
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
/* =================== How-to videos (short guides, also posted as RWB Instagram stories) =================== */
const VIDEOS = [
    ['track', 'Track + FAM ✨', 'Live location, SOS and your family in the loop', 111],
    ['service', 'Service', 'Log services, bills and reminders', 43],
    ['mileage', 'Mileage', 'Your real km per litre', 44],
    ['motomart', 'Motomart', 'Buy and sell used riding gear', 43],
    ['guides', 'Guides', 'Maintenance help and tested gear', 34],
    ['events', 'Events', 'Rides, meet-ups and shared costs', 40],
    ['me', 'Me', 'Your profile and settings', 33],
    ['rwb-members', 'RWB', 'Members and leaderboards', 34],
    ['coordinators-and-admins', 'Team tools', 'For coordinators and admins', 45, 'team'],
    ['fam-track', 'Track', 'See where your rider is', 64, 'fam'],
    ['fam-app', 'Your RWB App', 'Home, events, updates, Me and your FAM switch', 95, 'fam']
];
function viewVideos() {
    const list = isFam() ? VIDEOS.filter(v => v[4] === 'fam') : VIDEOS.filter(v => v[4] !== 'fam' && (v[4] !== 'team' || isMod()));
    app.innerHTML = `${top('Videos')}
        <p class="muted" style="margin:-4px 0 16px">${isFam() ? 'Short guides to the RWB App for RWB FAM, with sound and subtitles.' : 'Short guides to every part of the app, with sound and subtitles.'}</p>
        ${!list.length ? '<div class="card empty"><b>Coming soon</b>How-to videos for RWB FAM are on the way.</div>' : ''}
        <div class="vid-grid">${list.map(([id, title, sub, sec, who]) => `
            <button class="vid-tile" data-act="play" data-id="${id}" aria-label="Play: ${esc(title)}, ${sec} seconds">
                <span class="vid-cover"><img src="videos/${id}.jpg" alt="" loading="lazy"><i class="vid-play">▶</i><em>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</em></span>
                <b>${esc(title)}${who === 'team' ? ' <span class="badge coord">Team</span>' : ''}</b><span class="small muted">${esc(sub)}</span>
            </button>`).join('')}</div>
        <p class="small muted" style="text-align:center;margin:18px 0 8px">Also on the RWB Instagram highlights.</p>`;
    actions = {
        play: el => {
            const v = VIDEOS.find(x => x[0] === el.dataset.id);
            openSheet(v[1], `<video class="vid-player" src="videos/${v[0]}.mp4" poster="videos/${v[0]}.jpg" controls autoplay playsinline preload="auto"></video>
                <p class="small muted" style="margin-top:10px;text-align:center">${esc(v[2])} · turn your sound on</p>`);
        }
    };
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
        const q = $('#gq').value.trim();
        const shown = state.guides.filter(p => searchMatch(q, p.name + ' ' + pdfTitle(p.name) + ' ' + (p.description || '')));
        $('#gl').innerHTML = shown.length ? shown.map(p => `<button class="card tap guide" data-act="pdf" data-id="${esc(p.id)}">
            <div class="thumb">PDF<img src="https://drive.google.com/thumbnail?id=${esc(p.id)}&sz=w200" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>
            <div><h3>${markWords(esc(pdfTitle(p.name)), q)}</h3>${p.description ? `<p class="small muted">${markWords(esc(p.description), q)}</p>` : ''}<p class="small muted">${p.date ? fmtDate(String(p.date).slice(0, 10)) : ''}</p></div></button>`).join('')
            : `<div class="card empty">${state.guides.length ? 'No guides match your search.' : '<b>Coming soon</b>Guides will be posted here.'}</div>`;
    };
    $('#gq').oninput = draw; draw();
    actions.pdf = el => { const p = state.guides.find(g => g.id === el.dataset.id); openSheet(pdfTitle(p.name), `<iframe class="pdf" src="https://drive.google.com/file/d/${esc(p.id)}/preview" title="${esc(pdfTitle(p.name))}"></iframe><a class="btn ghost block" style="margin-top:12px" href="https://drive.google.com/file/d/${esc(p.id)}/view" target="_blank" rel="noopener">Open in Google Drive</a>`); };
}
/* Product pictures: the sheet's "image" column wins; otherwise the store page's preview picture is looked up
   (free link-preview service, same as roninwb.in) and remembered on the phone for a week. */
const ACC_ICON = { helmet: '⛑️', jacket: '🧥', glove: '🧤', boot: '🥾', light: '💡', lamp: '💡', fog: '💡', phone: '📱', mount: '📱', lock: '🔒', cover: '🛡️', guard: '🛡️', bag: '🎒', luggage: '🎒', intercom: '🎧', camera: '📷', tyre: '🛞', tire: '🛞', oil: '🛢️', chain: '⛓️', clean: '🧽', care: '🧽' };
const accIcon = c => { const k = String(c || '').toLowerCase(); return Object.entries(ACC_ICON).find(([w]) => k.includes(w))?.[1] || '🏍️'; };
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
            return `<article class="card guide acc"><div class="thumb acc-thumb"${!img && link ? ` data-link="${esc(link)}"` : ''}>${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="acc-ph">${accIcon(i.category)}</span></div>
                <div style="min-width:0">${i.category ? `<span class="badge">${esc(i.category)}</span>` : ''}<h3 style="margin-top:4px">${esc(i.name)}</h3>
                <p class="small"><span class="stars" style="--s:${sc}" aria-label="RWB score ${sc} of 5">★★★★★</span> <span class="muted">${sc}/5</span>${price ? ` · <b>${esc(price)}</b>` : ''}</p>
                ${link ? `<a class="btn sm ghost" style="margin-top:8px" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View product ↗</a>` : ''}</div></article>`;
        }).join('') : '<div class="card empty"><b>Coming soon</b>Recommended gear will be listed here.</div>'}</div>`;
    box.querySelectorAll('.acc-thumb[data-link]').forEach(t => accObs.observe(t));
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
const gateTop = title => `${demoBar()}<header class="top gate-top"><img class="logo" src="icons/logo-128.png" alt=""><h1>${esc(title)}</h1></header>`;
function tncGate() {
    const m = state.me, withdrew = m.tnc_agreed === false, updated = m.tnc_agreed === true;
    app.innerHTML = gateTop('RWB') + `<section class="gate card">
        <p class="gate-kicker">${withdrew ? 'Your app access is paused' : updated ? 'We\'ve updated our Terms' : 'One step before you continue'}</p>
        <h2>RWB Terms &amp; Conditions</h2>
        <p class="small muted" style="margin-bottom:12px">${withdrew ? 'You said you no longer agree to the RWB Terms & Conditions. Agree again to keep using the RWB App, talk to an admin, or leave RWB.' : updated ? 'RWB has new, clearer Terms & Conditions, covering privacy, safety, Motomart and more. Please read them and agree once to keep using the RWB App.' : 'Every RWB member agrees to these. Please read them and agree to keep using the RWB App.'}</p>
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
    const m = state.me, role = (ROLE[m.role] || 'Member') + (m.role === 'coordinator' ? ' (Motomart)' : '');
    const row = (k, v) => `<div><span class="muted">${k}</span><span class="rt">${esc(v || '–')}</span></div>`;
    const theme = getTheme();
    app.innerHTML = top('Me') + `
        <section class="profile">
            <label class="photo-pick" aria-label="Change profile photo">${face(m, 'avatar xl')}<span class="cam">📷</span><input type="file" accept="image/*,.heic,.heif" id="pic" hidden></label>
            <div class="grow"><h2>${esc(m.full_name)}</h2><p class="muted">${esc(role)}${m.nickname ? `, “${esc(m.nickname)}”` : ''}</p></div>
            <button class="btn sm ghost" data-act="edit">Edit</button>
        </section>
        <div class="group kv">
            ${row('WhatsApp', m.phone)}${row('Bike', m.bike)}${row('Registration', m.vrn)}${row('Birthday', m.dob ? fmtDayMonth(m.dob) : '')}${row('Blood group', m.blood_group)}${row('Locality', m.locality)}${row('Emergency contact', m.emergency_phone)}
        </div>
        <div id="my-changes"></div>
        <div id="more-rwb"></div>
        <h2 class="group-title">Follow RWB</h2>${followRwb()}
        <h2 class="group-title">My bikes <span class="small muted" style="text-transform:none;letter-spacing:0;font-weight:500">up to 3</span></h2>
        <div class="group bikes" id="my-bikes">${bikeRows(m, null)}</div>
        ${'tnc_agreed' in m ? `<h2 class="group-title">Terms & Conditions</h2>
        <div class="group"><div class="bike-row"><span class="g-ico">📜</span><span class="grow"><b>${tncOk(m) ? 'You agree to the RWB T&C' : m.tnc_agreed === false ? 'You don\'t agree to the RWB T&C' : 'Please read and agree'}</b><span class="small muted">${tncOk(m) ? (m.tnc_version ? 'Version ' + esc(m.tnc_version) + (m.tnc_agreed_at ? ', agreed ' + fmtDate(String(m.tnc_agreed_at).slice(0, 10)) : '') : 'From the RWB join form') : 'Needed for every RWB member'}</span></span>
            <button class="btn sm ${tncOk(m) ? 'ghost' : ''}" data-act="rules">${tncOk(m) ? 'Read' : 'Read & agree'}</button></div></div>` : ''}


        <h2 class="group-title">Appearance</h2>
        <div class="seg" role="radiogroup" aria-label="Theme">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([k, l]) => `<button role="radio" aria-selected="${theme === k}" aria-checked="${theme === k}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div>

        ${isAndroid ? `<h2 class="group-title">WhatsApp</h2>
        <div class="group"><label class="toggle-row"><span class="grow">Open WhatsApp links in<span class="small muted">For phones with both WhatsApp and WhatsApp Business</span></span>
            <select id="wa-app" style="width:auto;min-height:38px">${Object.entries(WA_APPS).map(([k, [l]]) => `<option value="${k}"${waPref() === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>` : ''}

        <h2 class="group-title">Notifications</h2>
        <div class="card" id="notif-card"><p id="push-state">Checking…</p><div id="push-btn" style="margin-top:10px"></div></div>
        <div class="group" style="margin-top:10px">
            ${[...(isMod() ? [['birthday', 'Birthdays']] : []), ['motomart', 'New Motomart posts'], ['member', 'New members on the app']].map(([k, l]) => `<label class="toggle-row"><span class="grow">${l}</span><span class="switch-only"><input type="checkbox" data-pref="${k}"${(m.notify || {})[k] !== false ? ' checked' : ''}></span></label>`).join('')}
        </div>
        <p class="small muted" style="margin:8px 4px 0">RWB announcements always come through.</p>

        <h2 class="group-title">Privacy</h2>
        <p class="small muted" style="margin:-4px 0 8px">Other members always see your name, nickname and photo. Choose what else they see. RWB admins and coordinators can always see your details.</p>
        <div class="group" id="share-box">${SHARE_OPTS.map(([k, t, d]) => `<label class="toggle-row"><span class="grow">${t}<span class="small muted">${d}</span></span><span class="switch-only"><input type="checkbox" data-share="${k}"${m.share?.[k] ? ' checked' : ''}></span></label>`).join('')}
            <button class="bike-add" data-act="share-all">${SHARE_OPTS.every(([k]) => m.share?.[k]) ? '🔒 Hide all from members' : '👁 Share all with members'}</button></div>
        <div class="group" style="margin-top:12px"><label class="toggle-row"><span class="grow">Show me on the leaderboards<span class="small muted">Other members see your name, photo, km, average mileage and how many services you've logged</span></span><span class="switch-only"><input type="checkbox" id="lb"${m.show_on_leaderboard !== false ? ' checked' : ''}></span></label></div>

        <h2 class="group-title">App</h2>
        <div class="group">
            <a href="../privacy.html" target="_blank" rel="noopener"><span class="g-ico">${ICON.shield}</span><span class="grow"><b>Privacy</b></span>${ICON.out}</a>
            <button data-act="out" class="danger-row"><span class="grow"><b>Sign out</b></span></button>
        </div>
        <p class="small muted" style="text-align:center;margin-top:24px">RWB App, free for every warrior</p>`;
    let myBikes = [], myChanges = [];
    const drawBikes = async () => {
        [myBikes, myChanges] = await Promise.all([api.myBikes().catch(() => []), api.myChanges().catch(() => [])]);
        const g = $('#my-bikes'); if (g) g.innerHTML = bikeRows(state.me, myBikes, false, myChanges.filter(c => c.kind === 'bike' && c.status === 'pending'));
        const ch = $('#my-changes'); if (ch) ch.innerHTML = changesBox(myChanges);
    };
    const drawMore = () => { const el = $('#more-rwb'); if (el) el.innerHTML = moreQs(m).length ? `<h2 class="group-title">More from RWB</h2><div class="group">${answerRows(m, true)}<button class="bike-add" data-act="more-edit">✎ Edit my answers</button></div>` : ''; };
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
            <p class="small muted" style="margin-bottom:10px">Changes to your Full Name, WhatsApp No. and main bike (VRN) are checked by an admin first. Everything else saves straight away. <span class="req">*</span> marks answers every member needs.</p>
            ${joinFields(m, 'me')}
            <button class="btn block">Save details</button></form>`, body => {
            body.querySelector('#mf').onsubmit = e => { e.preventDefault(); saveMyDetails(e.target, m, e.submitter, () => { closeSheet(); render(); }); };
        })
    };
    app.querySelectorAll('[data-pref]').forEach(cb => cb.onchange = async () => {
        const notify = { birthday: true, motomart: true, member: true, ...(state.me.notify || {}), [cb.dataset.pref]: cb.checked };
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
        try { state.me = await api.updateMe({ show_on_leaderboard: e.target.checked }); state.board = null; state.dir = null; toast(e.target.checked ? 'You\'re on the leaderboards' : 'Hidden from the leaderboards'); }
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
    const s = await api.admin.stats();
    const tab = state.adminTab;
    app.innerHTML = top('Admin', '<a class="btn sm ghost" href="#home">Done</a>') + `
        <div class="stats">
            <button class="stat tap" data-act="mfilter" data-f="all"><b>${s.members}</b><span>Members ›</span></button>
            <button class="stat tap" data-act="mfilter" data-f="app"><b>${s.on_app}</b><span>On the app ›</span></button>
            <button class="stat tap ${s.pending ? 'accent' : ''}" data-act="tab" data-tab="requests"><b>${s.pending}</b><span>Waiting ›</span></button></div>
        <div class="seg section scroll" role="tablist">
            <button role="tab" aria-selected="${tab === 'requests'}" data-act="tab" data-tab="requests">Approvals${s.pending ? ` (${s.pending})` : ''}</button>
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
    const ronin = c.ronin === 'ok' ? { ok: true, t: 'Owns a Ronin', s: 'Confirmed' + by('ronin') }
        : c.ronin === 'booked' ? { ok: true, t: 'Ronin booked', s: 'Delivery pending' + by('ronin') }
        : c.ronin === 'no' ? { ok: false, t: 'No Ronin', s: `Answer: ${r.bike || '–'}` + by('ronin') }
        : { ok: !!r.has_ronin, t: r.has_ronin ? 'Has a Ronin' : 'No Ronin', s: `Answer: ${r.bike || '–'}` };
    const vrn = r.vrn_verified ? { ok: true, t: 'VRN verified', s: (c.vrn === 'ok' ? 'Checked' : 'Ticked') + by('vrn') }
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
    const cks = checksOf(r), all = cks.every(c => c.ok);
    const ico = c => c.ok ? '✓' : c.pending ? '' : c.warn || c.unk ? '!' : '✕';
    return `<div class="card req-card" data-id="${r.id}">
        <div class="row" style="gap:8px;align-items:flex-start"><div class="grow"><h3>${esc(r.full_name)}</h3>
            <p class="small muted">${r.source === 'form' ? 'Join form' : 'App request'} · ${timeAgo(r.form_ts || r.created_at)}${r.on_app ? ' · signed in on the app' : ''}</p>
            ${r.updated_at && Date.now() - Date.parse(r.updated_at) < 3 * 864e5 ? `<span class="upd-tag">✏️ Updated ${timeAgo(r.updated_at)}</span>` : ''}</div>
            <span class="req-score ${all ? 'ok' : ''}">${cks.filter(c => c.ok).length}/4</span></div>
        <ul class="checks">${cks.map(c => `<li class="${c.ok ? 'yes' : c.pending ? 'no pend' : c.warn || c.unk ? 'warn' : 'no'} tap-chk" data-act="chk" data-id="${r.id}" data-k="${c.k}" role="button" tabindex="0" aria-label="${esc(c.t)}: change">
            <span class="ci">${ico(c)}</span><span class="grow"><b>${esc(c.t)}</b>${c.k === 'vrn' ? `<small><span class="vrn">${esc(r.vrn || r.member_vrn || 'No VRN given')}</span>${c.s ? ' · ' + esc(c.s) : ''}</small>` : c.s ? `<small>${esc(c.s)}</small>` : ''}</span><span class="chk-edit" aria-hidden="true">›</span>
            ${c.k === 'vrn' && r.vrn ? `<span class="vrn-tools"><button class="link-btn" data-act="copy-vrn" data-v="${esc(r.vrn)}">Copy</button><button class="link-btn" data-act="vrn-sites" data-v="${esc(r.vrn)}">Check VRN ↗</button></span>` : ''}
            ${c.k === 'vrn' && r.vrn_other ? `<small class="dup">⚠ Same VRN as ${esc(r.vrn_other)}</small>` : ''}</li>`).join('')}</ul>
        ${r.match_linked && r.on_app && r.check_entry !== 'new' ? '<p class="warn small" style="margin-bottom:10px">⚠ This number is already linked to another app account.</p>' : ''}
        <details class="answers"><summary>All answers</summary>${r.answers && Object.keys(r.answers).length ? `<dl class="facts">${Object.entries(r.answers).map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}<dt>Phone link</dt><dd><a href="${waTo(r.phone)}" target="_blank" rel="noopener">WhatsApp ${esc(r.phone)}</a></dd></dl>` : `<dl class="facts">
            <dt>WhatsApp</dt><dd><a href="${waTo(r.phone)}" target="_blank" rel="noopener">${esc(r.phone)}</a></dd><dt>Email</dt><dd>${esc(r.email || '–')}</dd>
            ${r.dob ? `<dt>Birthday</dt><dd>${fmtDayMonth(r.dob)}</dd>` : ''}<dt>Bike</dt><dd>${esc(r.bike || '–')}</dd>${r.blood_group ? `<dt>Blood group</dt><dd>${esc(r.blood_group)}</dd>` : ''}
            ${r.locality ? `<dt>Locality</dt><dd>${esc(r.locality)}</dd>` : ''}${r.hideout ? `<dt>Hometown</dt><dd>${esc(r.hideout)}</dd>` : ''}
            ${r.emergency_phone ? `<dt>Emergency</dt><dd>${esc(r.emergency_phone)}</dd>` : ''}${r.alt_phone ? `<dt>Alt. mobile</dt><dd>${esc(r.alt_phone)}</dd>` : ''}</dl>`}</details>
        <div class="btns req-btns" style="margin-top:12px"><button class="btn ghost" data-act="ask" data-id="${r.id}" aria-label="Message ${esc(r.full_name)} on WhatsApp">💬 Message</button><button class="btn ghost" data-act="reject" data-id="${r.id}">Reject</button><button class="btn" data-act="approve" data-id="${r.id}">Approve</button></div></div>`;
}
/* Tap a check: choose how it should count */
function checkSheet(r, k) {
    const c = r.checks || {}, cur = k === 'vrn' ? (r.vrn_verified ? 'ok' : c.vrn === 'no' ? 'no' : 'auto') : k === 'tnc' ? (c.tnc || 'auto') : (c[k] || 'auto');
    const e = entryCheck(r);
    const OPTS = {
        entry: { title: 'New or existing member', opts: [['auto', `Automatic: ${e.t}`, e.s], ['ok', '✓ Checked, looks fine', 'You checked who they are'], ['dup', '⚠ Possible duplicate', 'Already registered under another number or name']] },
        ronin: { title: 'Has a Ronin', opts: [['auto', 'From their answer', `“${r.bike || 'No answer'}”`], ['ok', '✓ Owns a Ronin', 'Confirmed by you'], ['booked', '✓ Ronin booked', 'Delivery pending (counts as yes)'], ['no', '✕ No Ronin', 'Doesn\'t own one']] },
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
const APP_LINK = 'roninwb.in/get';   /* Android → the app file; iPhone and computers → the web app */
function waMsg(kind, x = {}) {
    const first = firstName(x) || 'Warrior', me = firstName(state.me) || 'RWB';
    const T = {
        welcome: `Hi ${first}! 🎉\n\nWelcome to Ronin Warriors of Bengal! We'll add you to our official RWB WhatsApp group within 72 hours. Sit tight.\n\nMeanwhile, get the RWB App: https://${APP_LINK}\nSign in with Google using ${x.email ? `the same email you joined with (${x.email})` : 'the same email you used on the RWB join form'}. Your details are already there.\n\nExplore. Evolve. Inspire. 🏍️\n– ${me}, RWB`,
        existing: `Hi Warrior ${first}! 👋\n\nYou're already in our RWB WhatsApp group, so nothing to worry about. Your RWB App account is ready: just open the app and explore.\n\n📍 Track: live location on rides, SOS to the RWB team\n🔧 Service: records, bills and next-service reminders\n⛽ Mileage: your real km/l and fuel spends\n🛒 Motomart: buy and sell used riding gear\n📘 Guides: maintenance help and tested gear\n📅 Events: rides, RSVPs and shared expenses\n🏍️ RWB: members and leaderboards\n🤖 Pookie: our AI for any bike question\n\nPlease also update your details in the Me tab (you can set your bike model and add up to 3 bikes).\n\n${APP_LINK}\nExplore. Evolve. Inspire.\n– ${me}, RWB`,
        returning: `Hi ${first}! 🎉\n\nWelcome back to Ronin Warriors of Bengal! We'll add you to our official RWB WhatsApp group within 72 hours. Sit tight.\n\nThe RWB App: https://${APP_LINK}\nSign in with Google using ${x.email ? `the same email you joined with (${x.email})` : 'the same email you used on the RWB join form'}.\n\nExplore. Evolve. Inspire. 🏍️\n– ${me}, RWB`,
        rejected: `Hi ${first},\n\nThank you for your interest in Ronin Warriors of Bengal. We're sorry, we couldn't approve your registration this time${x.reason ? `: ${x.reason.replace(/[.\s]+$/, '')}.` : '.'}\n\nIf you think this is a mistake, or things change, just reply here and we'll be happy to help.\n\nRide safe! 🙏\n– ${me}, RWB`,
        change_ok: `Hi ${first}! ✅ Your ${x.what || 'profile'} update in the RWB App is approved. Thanks for keeping your details up to date.\n– ${me}, RWB`,
        change_no: `Hi ${first}, we couldn't approve your ${x.what || 'profile'} update in the RWB App${x.reason ? `: ${x.reason.replace(/[.\s]+$/, '')}.` : '.'} Just reply here if you'd like help with it. 🙏\n– ${me}, RWB`,
        ask: `Hi ${first}! 👋\n\nThanks for registering with Ronin Warriors of Bengal. Before we approve you, could you please help us with:\n${(x.asks || []).map(a => '• ' + a).join('\n') || '• '}\n${(x.asks || []).some(a => /terms/i.test(a)) ? `\n📜 RWB Terms & Conditions: ${TNC_URL}\nIf you agree, just reply “I agree” here.\n` : ''}\n${x.on_app ? 'You can update your details in the RWB App (open it and tap Edit my details), or just reply here.' : 'You can edit your join form response (use the same email), or just reply here.'}\n\nThank you!\n– ${me}, RWB`,
        invite: `Hi ${first}! 👋\n\nRWB now has its own free app for members: service records and reminders, mileage tracker, Motomart for used gear, events, guides and more.\n\n📲 Get it here: https://${APP_LINK}\nSign in with Google using the email you gave on the RWB join form. Don't remember it? The app will help: on the “No Account Found” screen, enter your WhatsApp number and VRN.\n\n🎥 How to install:\nAndroid: ${INSTALL_ANDROID}\niPhone: ${INSTALL_IPHONE}\n\nExplore. Evolve. Inspire.\n– ${me}, RWB`,
        sticker: `Hi ${first}! 👋\n\nIf you haven't got your RWB sticker yet, you can collect it at our next meet-up or ride. 🏍️\n\nIf you already have one, kindly update it in the RWB App → Me → More from RWB: https://roninwb.in/app/#me\n\nThank you!\n– ${me}, RWB`,
        comeback: `Hi ${first}! 👋\n\nIt's ${me} from Ronin Warriors of Bengal. We miss you on the road! If you'd like to come back to RWB, just reply here or fill the join form again at roninwb.in.\n\nRide safe! 🏍️`,
        remind: `Hi ${first}! 👋\n\nA quick one from the RWB team: please complete your RWB profile.${x.rules ? `\n\n📜 Please read and agree to the RWB Terms & Conditions: ${TNC_URL}\nAgree in the app (Me → Terms & Conditions → Read & agree), or just reply “I agree” here.` : ''}${x.missing?.length ? `\n\nMissing: ${x.missing.join(', ')}.` : ''}\n\nIt takes a minute in the RWB App: ${APP_LINK} → Me.${x.on_app ? '' : ' Sign in with Google using the email you gave on the join form.'}\n\nThank you! Explore. Evolve. Inspire.\n– ${me}, RWB`
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
const CHANGE_TXT = { name: 'Name', phone: 'WhatsApp No.', vrn: 'Main bike (VRN)', bike: 'New bike', tnc: 'Terms & Conditions' };
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
async function adminRequests() {
    const [reqs, chg, inc, all] = await Promise.all([api.admin.requests(), api.admin.changes().catch(() => []), api.admin.incomplete().catch(() => null), state.adminMembers ? Promise.resolve(state.adminMembers) : api.admin.members().then(m => (state.adminMembers = m)).catch(() => [])]);
    const digest = () => `🛡️ RWB App: ${reqs.length + chg.length} waiting for approval\n${reqs.length ? `\nNew entries (${reqs.length}):\n${azSort(reqs).slice(0, 15).map(r => `• ${r.full_name} (${r.source === 'form' ? 'form' : 'app'})`).join('\n')}` : ''}${chg.length ? `\n\nProfile changes (${chg.length}):\n${azSort(chg).slice(0, 15).map(c => `• ${c.full_name}: ${CHANGE_TXT[c.kind]}`).join('\n')}` : ''}\n\nOpen: roninwb.in/app → Home → Admin`;
    $('#admin-body').innerHTML = (reqs.length || chg.length ? `<button class="btn ghost block share-admins" data-act="digest">📣 Share this list to the admin WhatsApp group</button>` : '') + (reqs.length || chg.length ? `${reqs.length ? `<p class="small muted" style="margin-bottom:10px">New entries from the RWB join form. Check the 4 points, then approve and add them to the WhatsApp group. Rejected entries are deleted from the sheet.</p>
        <div class="list">${reqs.map(reqCard).join('')}</div>` : ''}
        ${chg.length ? `<h2 class="group-title" style="margin-top:${reqs.length ? 22 : 0}px">Changes to approve</h2><p class="small muted" style="margin-bottom:10px">Members changed an important detail in their profile.</p><div class="list">${chg.map(changeCard).join('')}</div>` : ''}`
        : '<div class="card empty"><b>All clear</b>Nothing waiting for approval.</div>') + (inc ? followUps(inc, all) : '');
    const byCid = id => chg.find(c => c.id === Number(id));
    if (inc) bindFollowUps(inc, all);
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
            if (miss.length && !confirmBox(`Not all 4 checks are ticked:\n• ${miss.join('\n• ')}\n\nApprove ${r.full_name} anyway?`)) return;
            busy(b, async () => {
                await api.admin.approve(r.id); state.adminMembers = null; state.dir = null; toast(`${r.full_name} approved. Now add them to the RWB WhatsApp group.`); await viewAdmin();
                const kind = r.check_entry === 'existing' || r.check_entry === 'recent' ? 'existing' : r.check_entry === 'returning' ? 'returning' : 'welcome';
                tellOnWhatsApp(`Let ${firstName(r)} know`, r.phone, waMsg(kind, r));
            });
        },
        reject: b => rejectSheet(byId(b.dataset.id)),
        ask: b => askSheet(byId(b.dataset.id)),
        chk: el => checkSheet(byId(el.dataset.id), el.dataset.k)
    });
    /* keep the list fresh while it's open: people may update their details after a message */
    clearInterval(state.apprTimer);
    state.apprTimer = setInterval(() => { if (location.hash.startsWith('#admin') && state.adminTab === 'requests' && document.visibilityState === 'visible' && !$('dialog#sheet[open]')) adminRequests(); else if (!location.hash.startsWith('#admin')) clearInterval(state.apprTimer); }, 30000);
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
        if (state.fuView === 'gone') return `🏍️ *We miss these warriors!* 🧡\n\n${firstNames(left)}\n\nIf you're in touch with them, let them know they're always welcome back. They can rejoin with the join form at roninwb.in or the RWB App: https://${APP_LINK}\n\nExplore. Evolve. Inspire.`;
        return `🏍️ *RWB App: a quick to-do for some of our warriors* 🙏\n`
            + (tnc.length ? `\n📜 *Please respond to the RWB Terms & Conditions in the app*\nOpen it directly: https://roninwb.in/app/#terms\n(or RWB App → Me → Terms & Conditions → Read & agree)\n${firstNames(tnc)}\n` : '')
            + (other.length ? `\n✍️ *Please add your missing details* (RWB App → Me → Edit)\n${azSort(other).map(m => `• ${m.full_name}: ${m.missing.join(', ')}`).join('\n')}\n` : '')
            + (sticker.length ? `\n🏷️ *RWB sticker not received yet?*\nCollect it at our next meet-up or ride. Already got one? Update it in the RWB App → Me → More from RWB: https://roninwb.in/app/#me\n${firstNames(sticker)}\n` : '')
            + (notApp.length ? `\n📲 *Not on the RWB App yet?* Get it: https://${APP_LINK}\nSign in with the email you gave on the join form.\nAndroid guide: ${INSTALL_ANDROID}\niPhone guide: ${INSTALL_IPHONE}\n${firstNames(notApp)}\n` : '')
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
    const pre = [!(r.vrn_verified || r.vrn_known) && ASKS[0], !r.has_ronin && ASKS[2], !(r.tnc === true || r.member_tnc === true) && ASKS[3], !r.emergency_phone && ASKS[4]].filter(Boolean);
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
    const quick = ['Not a Ronin owner', 'VRN could not be verified', 'Duplicate entry', 'Did not agree to the T&C'];
    openSheet('Reject ' + firstName(r), `<form id="rj"><p class="small muted" style="margin-bottom:10px">${r.source === 'form' ? 'Their entry is deleted from the sheet (Form responses 3).' : 'They see that the request was not approved.'} The reason is kept for admins for 60 days.</p>
        <div class="chips" style="margin-bottom:10px">${quick.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <label>Reason (optional)<textarea name="reason" rows="2" maxlength="200"></textarea></label>
        <button class="btn danger block">Reject</button></form>`, body => {
        body.querySelectorAll('[data-q]').forEach(c => c.onclick = () => { body.querySelector('[name=reason]').value = c.dataset.q; });
        body.querySelector('#rj').onsubmit = e => { e.preventDefault(); const reason = e.target.reason.value.trim(); busy(e.submitter, async () => { await api.admin.reject(r.id, reason); closeSheet(); toast('Rejected'); await viewAdmin(); tellOnWhatsApp(`Let ${firstName(r)} know`, r.phone, waMsg('rejected', { ...r, reason })); }); };
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
    ${state.memberFilter === 'admins' ? `<p class="small muted" style="margin-bottom:10px">Tap a person to ${state.me.role === 'superadmin' ? 'make them an admin or a coordinator' : 'make them a coordinator'} or change their role. Coordinators can approve Motomart posts.</p>` : ''}${state.memberFilter === 'gone' ? '<p class="small muted" style="margin-bottom:10px">Members who left or were removed, newest first. Their app account and data are deleted; this record stays so you know who left and when. Tap someone to <b>restore</b> them.</p>' : ''}${state.memberFilter === 'new' ? '<p class="small muted" style="margin-bottom:10px">Joined in the last 7 days, through the join form or the app. Add them to the RWB WhatsApp group; the <b>New Member</b> tag goes away after 7 days.</p>' : ''}
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
            <div class="grow"><div class="who">${esc(m.full_name)} ${roleBadge(m)}${isNewMember(m) ? ' <span class="badge new-tag">New Member</span>' : ''}</div>
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
            <dt>WhatsApp</dt><dd>${esc(m.phone || '–')}</dd><dt>Email</dt><dd>${esc(m.email || '–')}</dd>
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
            <p class="small muted" style="margin:-4px 0 12px">Coordinators can approve, reject and delete Motomart posts. They can't manage members.</p>` : ''}
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
        <div class="warn">${m.user_id ? 'Their app account, service records, bills, fuel log, documents and Motomart posts are <b>deleted</b>. ' : ''}Their row is removed from the RWB contact sheet (a copy goes to its “Removed members” tab). Their name stays here under <b>Left / removed</b>, and you can restore them any time.</div>
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
            : `<p class="small" style="margin:4px 0 6px"><b>Using the RWB app (downloaded APK)</b></p><ol class="steps"><li>Open phone <b>Settings → Apps → RWB → Notifications</b></li><li>Turn on <b>Allow notifications</b></li></ol>
               <p class="small" style="margin:12px 0 6px"><b>Using Chrome</b></p><ol class="steps"><li>Tap the icon left of <b>roninwb.in</b> in the address bar</li><li><b>Permissions → Notifications → Allow</b></li></ol>
               <p class="small muted" style="margin-top:10px">Then close and reopen the app, and come back to this page.</p>`;
        return;
    }
    st.textContent = on ? 'On for this phone.' : 'Off for this phone.';
    btn.innerHTML = on ? `<div class="btns">${isAdmin() ? '<button class="btn sm ghost" data-act="push-test">Send test</button>' : ''}<button class="btn sm ghost" data-act="push-off">Turn off</button></div>` : '<button class="btn block" data-act="push-on">Turn on notifications</button>';
}

/* =================== Announcements =================== */
const STICKY = n => n.kind === 'announcement' || n.kind === 'event';   /* only admins can remove these */
const KIND_ICON = { event: '📅', announcement: '📣', birthday: '🎂', motomart: '🛒', member: '🏍️', admin: '🛡️', personal: '🙋', sos: '🆘' };
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
    return `<article class="card news ${n.kind}"><div class="row" style="align-items:flex-start"><span class="news-ico" aria-hidden="true">${KIND_ICON[n.kind] || '📣'}</span>
        <div class="grow"><h3>${esc(n.title)}</h3>${n.body ? `<p>${linkify(n.body)}</p>` : ''}
        <p class="small muted" style="margin-top:6px">${timeAgo(n.created_at)}${n.audience === 'admins' ? ' · admins only' : n.audience === 'moderators' ? ' · team only' : ''}${go ? ` · <a href="${esc(n.url)}">Open</a>` : ''}</p></div>
        ${del ? `<button class="icon-btn" data-act="del-news" data-id="${n.id}" aria-label="Delete">🗑</button>` : ''}</div></article>`;
}
async function viewNews() {
    const all = await load.news(true);
    try { if (all[0]) localStorage.setItem('rwb-news-seen', String(Math.max(...all.map(n => n.id)))); } catch { /* ignore */ }
    const news = visibleNews(all);
    const canClear = news.length > 0;
    app.innerHTML = top('News', canClear ? `<button class="icon-btn clear-btn" data-act="clear-news" aria-label="Clear notifications" title="Clear">${ICON_CLEAR}</button>` : '') + `
        ${isAdmin() ? `<details class="howto" style="margin-bottom:6px"><summary>Post an announcement</summary>
            <form id="ann" style="padding-bottom:16px"><label>Title<input name="title" required maxlength="120" placeholder="e.g. Sunday breakfast ride"></label>
            <label>Message<textarea name="body" maxlength="1000" placeholder="Meeting point, time, anything members should know"></textarea></label>
            <p class="small muted">Goes to everyone's feed and as a notification to every phone that has them on.</p>
            <button class="btn block">Send to all members</button></form></details>` : ''}
        <section class="section">${news.length ? `<p class="small muted swipe-hint">Swipe an alert left or right to hide it.</p><div class="group">${news.map(n => newsRow(n, isAdmin())).join('')}</div>` : `<div class="card empty"><b>${all.length ? 'All caught up' : 'No news yet'}</b>${isFam() ? 'Important announcements from the RWB admins show up here.' : 'Announcements, birthdays and new Motomart posts show up here.'}</div>`}</section>`;
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

/* =================== Motomart =================== */
const CATS = C.MOTOMART_CATEGORIES || ['Helmet', 'Riding jacket', 'Riding pants', 'Riding shoes / boots', 'Gloves', 'Bike protection', 'Bike accessories', 'Rider accessories', 'Luggage', 'Electronics', 'Spare parts', 'Other'];
const CONDITIONS = ['Brand new (unused)', 'Like new', 'Good', 'Fair', 'Needs repair'];
const mmState = { cat: 'all', status: 'all', mine: false, q: '', review: false };
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
    if (state.param === 'review') { if (isMod()) Object.assign(mmState, { review: true, mine: false, status: 'all' }); state.param = null; history.replaceState(null, '', '#motomart'); }
    const all = await load.listings(true);
    const mod = isMod(), waiting = mod ? all.filter(l => l.status === 'pending') : [];
    if (!mod || !waiting.length) mmState.review = false;
    const q = mmState.q.trim().toLowerCase();
    const shown = mmState.review ? waiting : all.filter(l => (mmState.mine ? mine(l) : (['live', 'sold'].includes(l.status) || mine(l))) &&
        (mmState.cat === 'all' || l.category === mmState.cat) && (mmState.status === 'all' || l.status === mmState.status) &&
        (!q || (l.product_name + ' ' + l.category + ' ' + (l.details || '')).toLowerCase().includes(q)));
    const cats = CATS.filter(c => all.some(l => l.category === c));
    app.innerHTML = top('Motomart') + `
        <p class="muted small mm-intro">Used gear from fellow Ronins. Tap an item to see photos and message the seller on WhatsApp.</p>
        <input class="search" type="search" id="mmq" placeholder="Search helmets, jackets, guards…" value="${esc(mmState.q)}" aria-label="Search Motomart">
        <div class="chips hscroll" style="margin-bottom:10px">${['all', ...cats].map(c => `<button class="chip" data-act="cat" data-cat="${esc(c)}" aria-pressed="${mmState.cat === c}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>
        <div class="row" style="margin-bottom:14px;gap:8px">
            <select id="mms" aria-label="Show" style="flex:1"><option value="all">Live and sold</option><option value="live"${mmState.status === 'live' ? ' selected' : ''}>Only available</option><option value="sold"${mmState.status === 'sold' ? ' selected' : ''}>Only sold</option></select>
            <button class="chip" data-act="mine" aria-pressed="${mmState.mine}">My posts</button>${waiting.length ? `<button class="chip warn-chip" data-act="review" aria-pressed="${mmState.review}">To approve (${waiting.length})</button>` : ''}</div>
        ${mmState.review ? '<p class="small muted" style="margin:-4px 0 12px">Check photos, price and details, then approve or reject. Members are notified when a post goes live.</p>' : ''}
        ${shown.length ? `<div class="mm-grid">${shown.map(listingCard).join('')}</div>` : `<div class="card empty"><b>${all.length ? 'Nothing matches' : 'Nothing for sale yet'}</b>${mmState.mine ? 'You haven’t posted anything yet.' : 'Be the first to sell something.'}</div>`}
        <button class="btn fab" data-act="sell">＋ Sell something</button>`;
    actions = {
        cat: el => { mmState.cat = el.dataset.cat; viewMotomart(); },
        mine: () => { mmState.mine = !mmState.mine; mmState.review = false; mmState.status = 'all'; viewMotomart(); },
        review: () => { mmState.review = !mmState.review; mmState.mine = false; viewMotomart(); },
        sell: () => listingForm(),
        listing: el => listingDetail(all.find(l => String(l.id) === el.dataset.id))
    };
    $('#mms').onchange = e => { mmState.status = e.target.value; viewMotomart(); };
    let t; $('#mmq').oninput = e => { clearTimeout(t); t = setTimeout(() => { mmState.q = e.target.value; viewMotomart().then(() => { const i = $('#mmq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
    /* a post opened by link (e.g. from Home): open it once, then forget it so filters don't reopen it */
    if (state.param) { const id = state.param; state.param = null; history.replaceState(null, '', '#motomart'); const l = all.find(x => String(x.id) === id); if (l) listingDetail(l); else toast('That post is no longer available', true); }
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
    openWA(waShare(text));
}

function listingDetail(l) {
    const own = mine(l), adm = isMod();
    const contact = `Hi ${l.seller_name.split(' ')[0]}, I saw your ${l.product_name} (${price(l.price)}) on RWB Motomart. Is it still available?`;
    const fact = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
    openSheet(l.product_name, `
        ${l.photos?.length ? `<div class="gallery">${l.photos.map((p, i) => `<img src="${esc(api.photoUrl(p))}" alt="Photo ${i + 1} of ${esc(l.product_name)}">`).join('')}</div>${l.photos.length > 1 ? `<p class="small muted" style="text-align:center;margin-top:4px">Swipe for ${l.photos.length} photos</p>` : ''}` : ''}
        <div class="row" style="margin:12px 0 4px;justify-content:space-between"><b class="mm-price" style="font-size:1.9rem">${price(l.price)}</b>
            <span class="badge ${l.status === 'live' ? 'ok' : l.status === 'sold' ? '' : 'orange'}">${{ live: 'Available', sold: 'Sold', pending: 'Waiting for approval', rejected: 'Not approved' }[l.status]}</span></div>
        ${l.status === 'rejected' && l.reject_reason ? `<p class="warn" style="margin:8px 0">Admin note: ${esc(l.reject_reason)}. Edit the post to send it again.</p>` : ''}
        ${l.status === 'pending' && own && !adm ? '<p class="warn" style="margin:8px 0">An admin will check and publish your post, usually within 24 hours.</p>' : ''}
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
            <label class="file-pick"><input type="file" accept="image/*,.heic,.heif" multiple id="pics"><span>📷 Add photos</span></label></fieldset>
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
        <div id="chatlog" class="chatlog" aria-live="polite"></div>
        <form id="ask" class="askbar">
            <div id="att" class="att" hidden></div>
            <div class="row">
                <label class="icon-btn" aria-label="Add a photo" title="Add a photo">📷<input type="file" accept="image/*,.heic,.heif" id="aphoto" hidden></label>
                <textarea id="q" rows="1" maxlength="1500" placeholder="Ask Pookie…" aria-label="Your question"></textarea>
                <button class="btn send" aria-label="Send">➤</button>
            </div>
            <p class="muted ai-note">Pookie is an AI and can make mistakes.<span id="left"></span></p>
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

/* =================== RWB: three leaderboards + members =================== */
const MEDAL = ['🥇', '🥈', '🥉'];
const kmTxt = n => Number(n).toLocaleString('en-IN') + ' km';
const kmplTxt = v => Number(v).toFixed(1) + ' km/l';
const BOARDS = {
    gps: { title: 'Track Warriors', sub: 'Kilometres ridden while sharing live location with Track', how: 'How to get on it: tap <b>Track</b> (the middle button) → <b>Share</b> before you ride. Every km you ride while sharing counts, checked by GPS.', has: r => r.km > 0, val: r => Number(r.km), big: r => `${Number(r.km).toLocaleString('en-IN', { maximumFractionDigits: r.km < 100 ? 1 : 0 })} km`, small: r => r.rides ? `${r.rides} ride${r.rides === 1 ? '' : 's'}` : '', empty: 'No one yet! Tap Track → Share on your next ride to be the first Track Warrior.' },
    mileage: { title: 'Mileage Warriors', sub: 'Best average km/l, from full-tank fill-ups', has: r => r.kmpl > 0, val: r => Number(r.kmpl), big: r => kmplTxt(r.kmpl), small: r => r.km ? kmTxt(r.km) : '', empty: 'Add a full-tank fill-up with your Trip A reading to get on this board.' },
    service: { title: 'Service Warriors', sub: 'Most services logged in the app', has: r => r.services > 0, val: r => r.services * 1e5 + (r.last_service ? Date.parse(r.last_service) / 864e5 : 0), big: r => `${r.services} service${r.services === 1 ? '' : 's'}`, small: r => [r.kmpl ? kmplTxt(r.kmpl) : '', r.last_service ? 'last ' + fmtDayMonth(r.last_service) : ''].filter(Boolean).join(' · '), empty: 'Log your services to get on this board.' },
    road: { title: 'Road Warriors', sub: 'Most km on the odometer', has: r => r.km > 0, val: r => r.km, big: r => kmTxt(r.km), small: r => r.kmpl ? kmplTxt(r.kmpl) : '', empty: 'Update your odometer on Home, or add a fill-up or service, to get on this board.' }
};
const rankBoard = (rows, key) => rows.filter(BOARDS[key].has).sort((a, b) => BOARDS[key].val(b) - BOARDS[key].val(a) || a.full_name.localeCompare(b.full_name)).map((r, i) => ({ ...r, rank: i + 1 }));
function boardHtml(key, raw) {
    const B = BOARDS[key], board = rankBoard(key === 'gps' ? (state.gps || []) : raw, key);
    const me = board.find(r => r.is_me), top3 = board.slice(0, 3), rest = board.slice(3, 6);
    const podium = top3.length ? `<div class="podium">${[top3[1], top3[0], top3[2]].map((r, i) => r ? `<div class="pod p${[2, 1, 3][i]}${r.is_me ? ' me' : ''}">
            ${face(r, 'avatar pod-face')}<span class="pod-medal">${MEDAL[r.rank - 1]}</span><b>${esc(r.nickname || r.full_name.split(' ')[0])}</b><span class="pod-km">${B.big(r)}</span><span class="pod-sub">${esc(B.small(r))}</span></div>` : '<div></div>').join('')}</div>` : '';
    return `<div class="seg board-seg" role="tablist" aria-label="Leaderboard">${Object.entries(BOARDS).map(([k, b]) => `<button role="tab" aria-selected="${k === key}" data-act="board" data-b="${k}">${b.title.replace(' Warriors', '')}</button>`).join('')}</div>
            <div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:2px"><h2 class="board-title">${B.title}</h2><span class="small muted">${board.length} rider${board.length === 1 ? '' : 's'}</span></div>
            <p class="small muted" style="margin-bottom:6px">${B.sub}</p>${B.how && !isFam() ? `<p class="small board-how">${B.how}</p>` : ''}
            ${board.length ? podium + (rest.length ? `<ol class="board-list" start="4">${rest.map(r => `<li class="${r.is_me ? 'me' : ''}"><span class="rk">${r.rank}</span>${face(r, 'avatar sm')}<span class="grow"><b>${esc(r.full_name)}</b><span class="small muted">${esc(r.bike || '')}</span></span><span class="num km">${B.big(r)}<small>${esc(B.small(r))}</small></span></li>`).join('')}</ol>` : '')
                + (me && me.rank > 6 ? `<p class="board-me">You're <b>#${me.rank}</b> of ${board.length} with ${B.big(me)}</p>` : '')
                + (!me ? `<p class="small muted" style="margin-top:10px">${state.me.show_on_leaderboard === false ? 'You\'re hidden from the leaderboards (Me → Privacy).' : B.empty}</p>` : '')
              : `<p class="muted" style="margin-top:8px">${B.empty}</p>`}
            <p class="board-dots" aria-hidden="true">${Object.keys(BOARDS).map(k => `<i${k === key ? ' class="on"' : ''}></i>`).join('')}</p>`;
}
const CREW_F = all => { const n = all.filter(m => m.on_app).length; return { all: 'Everyone', app: `On app (${n})`, noapp: `Not on app (${all.length - n})` }; };
async function viewCrew() {
    const raw = state.board ??= await api.boards().catch(() => api.leaderboard().then(rs => rs.map(r => ({ ...r, services: 0, kmpl: null }))).catch(() => []));
    if (!state.gps || Date.now() - (state.gpsAt || 0) > 120e3) { state.gps = await api.gpsBoard().catch(() => []); state.gpsAt = Date.now(); }
    state.boardKey = 'gps';   /* Track Warriors first every time the tab opens */
    app.innerHTML = top('RWB') + `
        <section class="board card" id="board">${boardHtml(state.boardKey, raw)}</section>
        <section class="section"><h2>Members</h2><div id="crew-body"><p class="muted">Loading…</p></div></section>`;
    const keys = Object.keys(BOARDS);
    const showBoard = (k, dir = 0) => { state.boardKey = k; const el = $('#board'); if (!el) return; el.innerHTML = boardHtml(k, raw);
        if (dir) { el.classList.remove('slide-l', 'slide-r'); void el.offsetWidth; el.classList.add(dir > 0 ? 'slide-l' : 'slide-r'); } };
    actions = { board: el => showBoard(el.dataset.b, Math.sign(keys.indexOf(el.dataset.b) - keys.indexOf(state.boardKey))) };
    /* swipe left / right to change leaderboard */
    let sx = null, sy = 0;
    $('#board').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    $('#board').addEventListener('touchend', e => {
        if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const i = keys.indexOf(state.boardKey), j = Math.min(keys.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)));
        if (j !== i) showBoard(keys[j], dx < 0 ? 1 : -1);
    }, { passive: true });
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
            const yes = await api.vrnCheck(v), key = vrnKey(v);
            const owns = x => vrnKey(x.vrn) === key || (x.member_bikes || x.bikes || []).some(b => vrnKey(b.vrn) === key);
            let who = '', full = null;
            if (yes && isAdmin()) { const all = await api.admin.members().catch(() => state.adminMembers || []); state.adminMembers = all; full = all.find(x => !isGone(x) && owns(x)); }   /* always fresh */
            else if (yes && isMod()) { const dir = state.dir ??= teamFirst(await api.directory().catch(() => [])); const m = dir.find(owns); if (m) who = m.full_name; }
            out.hidden = false; out.className = 'vcr ' + (yes ? 'yes' : 'no');
            out.innerHTML = !yes ? '<b>❌ Naah. Not an RWB Member.</b><span>Approach the rider politely and let them know about RWB (Ronin Warriors of Bengal) or simply ask them to visit <a href="https://roninwb.in" target="_blank" rel="noopener">roninwb.in</a></span>'
                : full ? vrnAdminCard(full, key) : `<b>✅ Yeah! RWB Member.</b>${who ? `<span>${esc(who)}</span>` : ''}`;
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
function hideBoot() {
    const b = document.getElementById('boot'); if (!b || b.dataset.out) return;
    b.dataset.out = '1'; const wait = Math.max(0, 900 - (performance.now() - (window.BOOT_T || 0)));
    setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 600); }, wait);
}
async function boot() {
    try {
        if (await nativeOutdated()) return nativeBlocker();   /* an old RWB Android app: must install the new build first */
        if (!NATIVE && /android/i.test(navigator.userAgent)) return nativeBlocker(true);   /* Android browser: use the RWB Android app (iPhone stays on the web app) */
        const sess = await api.session();
        if (!sess) return viewSignIn();
        const status = await api.linkAccount();
        if (status !== 'member') {   /* not a member: in someone's RWB FAM, or joining with an invite code? */
            const fam = status === 'pending' ? null : await api.famMe().catch(() => null);
            if (fam) return bootFam(fam);
            if (status !== 'pending' && famCodeSaved()) return famJoinScreen(sess);
            return viewAccess(status, sess);
        }
        state.fam = null; delete document.body.dataset.fam;
        state.me = await api.me();
        api.settings().then(v => { state.settings = v || {}; }).catch(() => { state.settings = {}; });
        await load.news(true);
        await render();
        if (!trk.resumed) { trk.resumed = true; resumeShare(); if (NATIVE) { nativePushOn(false).catch(() => {}); setTimeout(nativeUpdateAsk, 2500); } else setTimeout(appPromo, 1500); }
    } catch (e) {
        tabbar.hidden = true;
        app.innerHTML = `<section class="signin"><img src="icons/logo-128.png" alt=""><div><h1>Can't connect</h1><p class="lead">${esc(e.message || 'Please check your internet connection.')}</p></div><button class="btn block" onclick="location.reload()">Try again</button></section>`;
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
    if (trk.svc) {   /* the RWB Track service shares in the background; here we only follow your position for the map */
        if ('geolocation' in navigator) trk.watch = navigator.geolocation.watchPosition(p => onFix(posOf(p)), () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 });
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
async function startShare(hours, eventId = null, note = '') {
    const p = await gpsFix(30000);
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, TRACK_NOTE_MAX);
    const until = await api.trackStart(p.lat, p.lng, p.acc, hours, eventId, note);
    trk.until = Date.parse(until) || Date.now() + hours * 36e5; trk.event = eventId; trk.note = note; trk.sent = p; trk.sentAt = Date.now(); trk.last = p;
    trk.svc = false; let svc = null;
    if (await hasSvc()) svc = await svcStart().catch(e => { toast(`Background sharing couldn't start: ${e.message || e}. Sharing works while the app is open.`, true); return null; });
    trackSave({ until: trk.until, event: eventId, note, svc: trk.svc });
    startWatch();
    if (svc && svc.battery === false) setTimeout(() => batteryAsk(), 900);
    toast(`You're sharing your live location 📍 ${hours >= 12 ? 'until you stop' : 'for ' + TRACK_HOURS.find(h => h[0] === hours)[1]}`);
}
async function stopShare(quiet = false) {
    const was = sharing() || trackSaved();
    trk.until = 0; trk.event = null; trackSave(null); stopWatch(); trackBadge();
    if (trk.svc || svcOk) RwbTrack()?.stop().catch(() => {}); trk.svc = false;
    if (!quiet && was) { await api.trackStop().catch(() => {}); toast('Stopped sharing your location'); }
    if (location.hash.startsWith('#track')) refreshTrack();
}
/* after reopening the app: carry on sharing if the time isn't up */
function resumeShare() {
    const s = trackSaved(); if (!s) return;
    if (s.until <= Date.now()) { trackSave(null); return; }
    trk.until = s.until; trk.event = s.event || null; trk.note = s.note || ''; trk.svc = !!s.svc; startWatch();
    if (trk.svc) svcCheck(); else gpsFix(60000).then(sendFix).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (sharing() && trk.svc) { if (trk.watch == null) startWatch(); svcCheck(); }
    else if (sharing()) { keepAwake(true); if (trk.watch == null && trk.native == null) startWatch(); gpsFix(20000).then(sendFix).catch(() => {}); }
    if (location.hash.startsWith('#track')) refreshTrack();
});
/* ---------- RWB Track service (RWB Android app from build 2.0.x with the service): shares with the screen off ---------- */
const RwbTrack = () => Native('RwbTrack');
let svcOk = null;
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
    try { const st = await RwbTrack().status(); if (!st.running) await svcStart(); } catch { /* ignore */ } finally { svcBusy = false; }
}
/* on the Track screen: is the background sharing healthy? (last GPS fix, last position sent, last problem) */
async function svcHealth() {
    let st; try { st = await RwbTrack().status(); } catch { return; }
    const el = $('#trk-health') || (() => { const e = document.createElement('p'); e.id = 'trk-health'; e.className = 'small trk-health'; $('#trk-status')?.after(e); return e; })();
    const ago = ms => !ms ? 'never' : Date.now() - ms < 90e3 ? `${Math.max(1, Math.round((Date.now() - ms) / 1000))} s ago` : `${Math.round((Date.now() - ms) / 6e4)} min ago`;
    const ok = st.running && st.sent && Date.now() - st.sent < 150e3;
    el.innerHTML = `${ok ? '🟢' : '🟠'} Background sharing ${st.running ? 'on' : '<b>stopped</b>'} · sent ${ago(st.sent)} · GPS ${ago(st.fix)}${st.acc ? ` (±${st.acc} m)` : ''}${st.error ? `<br><span class="warn">${esc(st.error)}</span>` : ''}${st.battery ? '' : ' · <button class="linkish" data-act="trk-batt">Allow in background</button>'}`;
    actions['trk-batt'] = () => batteryAsk(true);
    if (!st.running) svcCheck();
}
/* phones stop apps in the background to save battery: ask once in a while to let RWB run */
function batteryAsk(force = false) {
    try { if (!force && Date.now() - Number(localStorage.getItem('rwb-batt-asked') || 0) < 3 * 864e5) return; localStorage.setItem('rwb-batt-asked', String(Date.now())); } catch { /* ignore */ }
    openSheet('Keep Track running', `<p class="small" style="margin-bottom:10px">Your phone may stop Track to save battery when the screen is off. Allow RWB to run in the background so your live location never pauses.</p>
        <button class="btn block" data-x="allow">Allow RWB in the background</button>
        <ol class="small help-steps" style="margin-top:14px"><li>Tap <b>Allow</b> when Android asks.</li><li>On Xiaomi, Redmi, Poco, Realme, Oppo, Vivo or OnePlus, also open <b>Settings → Apps → RWB → Battery</b> and choose <b>No restrictions</b> (or turn on <b>Autostart</b>).</li><li>Don't swipe RWB away from recent apps while you ride.</li></ol>
        <button class="btn ghost block" data-x="later" style="margin-top:10px">Later</button>`, body => {
        body.querySelector('[data-x=allow]').onclick = () => { RwbTrack()?.battery().catch(() => {}); closeSheet(); };
        body.querySelector('[data-x=later]').onclick = () => closeSheet();
    });
}
/* ---------- old RWB Android apps: a blocker that can't be skipped ---------- */
/* Builds before 105 (2.0.5) don't have the new background Track service or the new icon. versionCode = 100 + build number. */
const MIN_NATIVE_BUILD = 105;
async function nativeOutdated() {
    if (!NATIVE) return false;
    try { const i = await Native('App').getInfo(); const b = Number(i.build); if (b) return b < MIN_NATIVE_BUILD; } catch { /* ignore */ }
    return !(await hasSvc());
}
function nativeBlocker(web = false) {
    tabbar.hidden = true; document.body.dataset.route = 'gate'; document.body.classList.add('blocked');
    const html = `<div class="blocker" role="alertdialog" aria-modal="true" aria-labelledby="blk-h"><div class="blk-card">
        <img src="icons/logo-128.png" alt="" class="blk-logo">
        <p class="blk-kicker">New RWB App</p>
        <h1 id="blk-h">Get the new RWB app</h1>
        ${web ? `<p>On Android, RWB now works through the <b>RWB Android app</b>. <b>Track</b> (live location with the screen off) and <b>RWB FAM</b> only work there.</p>
        <ol class="blk-steps">
            <li>Tap <b>Download the new app</b> below.</li>
            <li>Open the downloaded file and tap <b>Install</b> (allow installs from Chrome if Android asks). Have an older RWB app? Uninstall it first.</li>
            <li>Open <b>RWB</b> from your apps and sign in with Google.</li>
            <li>Added RWB to your home screen from Chrome before? Remove that old shortcut.</li>
        </ol>` : `<p>This version of the RWB app is out of date. <b>Track</b> (live location with the screen off) and <b>RWB FAM</b> only work on the new app.</p>
        <ol class="blk-steps">
            <li>Tap <b>Download the new app</b> below (it opens the RWB website).</li>
            <li><b>Uninstall this RWB app</b>: press and hold the RWB icon → <b>Uninstall</b> (or Settings → Apps → RWB → Uninstall).</li>
            <li>Open the downloaded file, tap <b>Install</b>, then open RWB and sign in with Google.</li>
        </ol>`}
        <button class="btn block" data-x="get">⬇ Download the new app</button>
        <p class="small muted" style="margin-top:12px">${web ? 'On iPhone? Open roninwb.in/app in Safari.' : 'Or open <b>roninwb.in/get</b> in Chrome.'} Your RWB account, records and settings stay safe.</p>
    </div></div>`;
    app.innerHTML = html;
    const bind = () => app.querySelector('[data-x=get]')?.addEventListener('click', () => {
        if (web) { const a = document.createElement('a'); a.href = apkUrl(); a.download = 'RWB-App.apk'; document.body.append(a); a.click(); a.remove(); return; }
        const url = 'https://roninwb.in/get/';
        (Native('Browser')?.open({ url }) || Promise.reject()).catch(() => { location.href = url; });
    });
    bind();
    /* keep it on screen whatever happens */
    new MutationObserver(() => { if (!app.querySelector('.blocker')) { app.innerHTML = html; bind(); } tabbar.hidden = true; }).observe(app, { childList: true, subtree: false });
    addEventListener('hashchange', () => { if (!app.querySelector('.blocker')) { app.innerHTML = html; bind(); } }, true);
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
}
/* an older RWB Android app (without the Track service): ask to update once per visit */
async function nativeUpdateAsk() {
    if (!NATIVE || await hasSvc()) return;
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
/* the middle Track button shows a live dot while sharing */
function trackBadge() { document.getElementById('track-tab')?.classList.toggle('live', sharing()); }

/* ---------- the middle button: Share / View / SOS ---------- */
document.getElementById('track-tab')?.addEventListener('click', e => { e.preventDefault(); if (!state.me) return; if (isFam()) { if (location.hash.startsWith('#track')) refreshTrack(); else location.hash = '#track'; } else trackMenu(); });
function trackMenu() {
    const on = sharing();
    openSheet('Track', `<div class="trk-menu">
        <button type="button" class="trk-opt share${on ? ' on' : ''}" data-x="share"><span class="trk-ico">${on ? '🟢' : '📍'}</span><b>${on ? 'Sharing live' : 'Share'}</b><small>${on ? esc(leftTxt(trk.until)) + ' · tap to stop or change' : 'Share your live location'}</small></button>
        <button type="button" class="trk-opt view" data-x="view"><span class="trk-ico">🗺️</span><b>View</b><small>See riders live on the map</small></button>
        <button type="button" class="trk-opt sos" data-x="sos"><span class="trk-ico">🆘</span><b>SOS</b><small>Alert the RWB team with your location</small></button></div>`, body => {
        body.querySelector('[data-x=share]').onclick = () => shareSheet();
        body.querySelector('[data-x=view]').onclick = () => { closeSheet(); location.hash = '#track'; };
        body.querySelector('[data-x=sos]').onclick = () => sosSheet();
    });
}
function shareSheet(eventId = null, eventTitle = '') {
    const on = sharing();
    openSheet(on ? 'Sharing your location' : 'Share live location', `${on ? `<div class="trk-live"><span class="dot"></span><span class="grow"><b>You're sharing live</b><span class="small muted">${esc(leftTxt(trk.until))}${trk.event ? ' · for an event ride' : ''}</span></span></div>
            <button class="btn danger block" data-x="stop" style="margin:12px 0 18px">Stop sharing</button><p class="small muted" style="margin-bottom:8px">Or share for:</p>` : `<p class="small muted" style="margin-bottom:12px">Every RWB member on the app can see you on the Track map while you share.${eventTitle ? ` You'll show as riding <b>${esc(eventTitle)}</b>.` : ''}</p>`}
        <label class="trk-note">Add a note <span class="muted small">(optional)</span><input id="trk-note" maxlength="${TRACK_NOTE_MAX}" placeholder="e.g. towards Simlipal!" value="${esc(on ? trk.note || '' : '')}" autocomplete="off"><small class="hint"><span id="trk-note-n">${on ? (trk.note || '').length : 0}</span>/${TRACK_NOTE_MAX} · shows next to your name on the map</small></label>
        <div class="trk-hours">${TRACK_HOURS.map(([h, t]) => `<button type="button" class="chip" data-h="${h}">${t}</button>`).join('')}</div>
        ${NativeGeo() ? '<p class="small muted" style="margin-top:12px">Keeps sharing with the screen locked. A small notification shows while it runs.</p>'
            : '<p class="small muted trk-tip" style="margin-top:12px">💡 Keep the RWB App open on your phone mount: we keep the screen awake. If you lock the phone or switch apps, sharing pauses until you come back. Plug in a charger for long rides.</p>' + (/android/i.test(navigator.userAgent) ? '<p class="small" style="margin-top:8px">📲 <a href="' + apkUrl() + '"><b>Get the RWB Android app</b></a> to keep sharing with the screen locked.</p>' : '')}`, body => {
        body.querySelector('[data-x=stop]')?.addEventListener('click', e => busy(e.currentTarget, async () => { await stopShare(); closeSheet(); }));
        const note = body.querySelector('#trk-note'); note.oninput = () => { body.querySelector('#trk-note-n').textContent = note.value.length; };
        body.querySelectorAll('[data-h]').forEach(b => b.onclick = () => busy(b, async () => {
            await startShare(Number(b.dataset.h), eventId ?? (on ? trk.event : null), note.value); closeSheet();
            if (!location.hash.startsWith('#track') && !location.hash.startsWith('#events/')) location.hash = '#track'; else refreshTrack();
        }));
    });
}

/* ---------- SOS: press and hold, so it can't go by accident ---------- */
function sosSheet() {
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
        api.rwbAdmins().then(list => { const el = body.querySelector('#sos-admins'); if (el) el.innerHTML = list.length ? `<div class="group">${list.slice(0, 6).map(a => `<div class="bike-row"><span class="grow"><b>${esc(a.full_name)}</b></span><a class="btn sm ghost" href="tel:+91${esc(a.phone)}">📞 Call</a></div>`).join('')}</div>` : ''; }).catch(() => {});
    });
}
async function sendSos() {
    let p = trk.last && Date.now() - trk.last.t < 120000 ? trk.last : null;
    try { p = await gpsFix(30000); } catch (e) { if (!p) { toast(e.message, true); return false; } }
    try { await api.trackSos(p.lat, p.lng, p.acc); }
    catch (e) { toast(e.message || 'SOS not sent. Call an admin.', true); return false; }
    navigator.vibrate?.([200, 100, 200]);
    closeSheet(); toast('🆘 SOS sent to the RWB team with your location');
    location.hash = '#track/sos';
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
function riderIcon(L, r, sos = false) {
    const stale = !sos && Date.now() - Date.parse(r.at) > 5 * 6e4;
    const pic = r.avatar ? `<img src="${esc(r.avatar)}" alt="" onerror="this.remove()">` : '';
    return L.divIcon({ className: 'trk-pin-wrap', iconSize: [46, 58], iconAnchor: [23, 50],
        html: `<div class="trk-pin${r.me ? ' me' : ''}${stale ? ' stale' : ''}${sos ? ' sos' : ''}"><span class="trk-face">${pic}<i>${esc(initials({ full_name: r.name }))}</i></span>${sos ? '<em>SOS</em>' : `<em>${esc(r.nick || r.name.split(' ')[0])}</em>`}</div>` });
}
async function viewTrack() {
    const param = state.param || '';
    trk.filter = /^e\d+$/.test(param) ? Number(param.slice(1)) : null;
    app.innerHTML = top('Track') + `<section class="trk-wrap">
        <div class="trk-map-box"><div id="trk-map" class="trk-map"><p class="muted" style="padding:20px">Loading the map…</p></div><div class="trk-signal" id="trk-signal" role="status" hidden></div></div>
        <div class="trk-bar">
            <div class="trk-status" id="trk-status"></div>
            <div class="trk-actions"${isFam() ? ' hidden' : ''}><button class="btn" data-act="trk-share" id="trk-share"></button><button class="btn sos-btn" data-act="trk-sos">🆘 SOS</button></div>
        </div>
        <div id="trk-list" class="trk-list"></div></section>`;
    actions = { 'trk-share': () => shareSheet(trk.filter, trk.filter ? (state.evd?.events || []).find(e => e.id === trk.filter)?.title : ''), 'trk-sos': () => sosSheet(),
        'trk-all': () => { location.hash = '#track'; }, 'trk-rider': el => openRider(el.dataset.k), 'trk-fit': () => fitAll(true) };
    if (isFam()) trk.filter = null;
    trk.fitted = false; trk.sosFocused = false; trk.focus = null; trk.markers.clear(); trk.sosMarkers.clear(); trk.map = null;
    let L; try { L = trk.L = await loadLeaflet(); } catch (e) { $('#trk-map').innerHTML = `<p class="warn" style="margin:16px">${esc(e.message)}</p>`; }
    if (L && $('#trk-map')) {
        $('#trk-map').innerHTML = '';
        const map = trk.map = L.map('trk-map', { zoomControl: false, attributionControl: true }).setView([22.5726, 88.3639], 11);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: darkMode() ? 'trk-tiles-dark' : '',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
        L.control.zoom({ position: 'topright' }).addTo(map);
        const fit = L.control({ position: 'topright' }); fit.onAdd = () => { const d = L.DomUtil.create('button', 'trk-fit'); d.type = 'button'; d.title = 'Show everyone'; d.innerHTML = '⤢'; d.onclick = () => fitAll(true); return d; }; fit.addTo(map);
    }
    await refreshTrack();
    clearInterval(trk.poll);
    trk.poll = setInterval(() => { if (!location.hash.startsWith('#track')) return clearInterval(trk.poll); if (document.visibilityState === 'visible') refreshTrack(); }, 15000);
    clearInterval(trk.sigTick);
    trk.sigTick = setInterval(() => { if (!location.hash.startsWith('#track')) return clearInterval(trk.sigTick); trackSignal(); }, 7000);
}
async function refreshTrack() {
    if (!$('#trk-status')) return;
    let d; try { d = trk.data = await api.trackView(); } catch (e) { $('#trk-status').innerHTML = `<span class="warn small">${esc(e.message)}</span>`; return; }
    const riders = trk.filter ? d.riders.filter(r => r.event_id === trk.filter) : d.riders;
    const ev = trk.filter ? (state.evd?.events || []).find(e => e.id === trk.filter) : null;
    const rider = d.fam ? riders.find(r => r.mine) : null, rName = esc(firstName(state.fam?.member));
    if (trk.svc && sharing()) svcHealth();
    $('#trk-status').innerHTML = d.fam ? `<span class="small muted">${rider ? `<b>${rName}</b> is sharing live${riders.length > 1 ? ` · ${riders.length - 1} more on the same ride` : ''}` : `${rName} isn't sharing a live location right now. You'll see them here when they share on Track.`}${d.sos.length ? ' · <b class="sos-txt">SOS</b>' : ''}</span>` : `${sharing() ? `<span class="trk-live-pill"><span class="dot"></span>You're live · ${esc(leftTxt(trk.until))}</span>` : ''}
        <span class="small muted">${riders.length ? `${riders.length} rider${riders.length === 1 ? '' : 's'} live${ev ? ` on ${esc(ev.title)}` : ''}` : 'No one is sharing right now'}${d.sos.length ? ` · <b class="sos-txt">${d.sos.length} SOS</b>` : ''}</span>
        ${trk.filter ? '<button class="linkish small" data-act="trk-all">Show everyone</button>' : ''}`;
    const sb = $('#trk-share'); if (sb) sb.textContent = sharing() ? '🟢 Sharing · Stop / change' : '📍 Share my location';
    $('#trk-list').innerHTML = [...d.sos.map(s => ({ ...s, k: 's' + s.id, sos: true })), ...riders.map(r => ({ ...r, k: 'r' + r.id }))].map(r => `<button class="trk-row${r.sos ? ' sos' : ''}" data-act="trk-rider" data-k="${r.k}">${face({ full_name: r.name, avatar_url: r.avatar }, 'avatar sm')}
        <span class="grow"><b>${r.sos ? '🆘 ' : ''}${esc(r.name)}${r.me ? ' <span class="muted">(you)</span>' : r.mine ? ' <span class="muted">(your rider)</span>' : ''}</b>${r.note && !r.sos ? `<span class="trk-note-txt">“${esc(r.note)}”</span>` : ''}<span class="small muted">${r.sos ? 'SOS ' + timeAgo(r.at) : `${r.spd > 1 ? Math.round(r.spd * 3.6) + ' km/h · ' : ''}updated ${timeAgo(r.at)}`}${trk.last && !r.me ? ' · ' + kmAway(r) : ''}</span></span><span class="chev">›</span></button>`).join('');
    drawMarkers(riders, d.sos);
    if (!trk.fitted && trk.map) { trk.fitted = true; fitAll(false); }
    if (state.param === 'sos' && d.sos[0] && trk.map && !trk.sosFocused) { trk.sosFocused = true; trk.map.setView([d.sos[0].lat, d.sos[0].lng], 15); }
    if (d.staff) alertNewSos(d.sos);
    trackSignal();
}
const kmAway = r => { const m = distM(trk.last, r); return m < 1000 ? `${Math.round(m)} m away` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km away`; };
function drawMarkers(riders, sos) {
    const L = trk.L, map = trk.map; if (!L || !map) return;
    const sync = (store, list, key, isSos) => {
        const keep = new Set();
        list.forEach(r => { const k = key(r); keep.add(k); let m = store.get(k);
            if (!m) { m = L.marker([r.lat, r.lng], { icon: riderIcon(L, r, isSos), zIndexOffset: isSos ? 1000 : r.me ? 500 : 0 }).addTo(map); m.on('click', () => openRider((isSos ? 's' : 'r') + (isSos ? r.id : r.id))); store.set(k, m); }
            else { m.setLatLng([r.lat, r.lng]); m.setIcon(riderIcon(L, r, isSos)); } });
        [...store.keys()].forEach(k => { if (!keep.has(k)) { map.removeLayer(store.get(k)); store.delete(k); } });
    };
    sync(trk.markers, riders, r => r.id, false); sync(trk.sosMarkers, sos, s => s.id, true);
}
function fitAll(animate) {
    const map = trk.map, d = trk.data; if (!map || !d) return;
    const pts = [...(trk.filter ? d.riders.filter(r => r.event_id === trk.filter) : d.riders), ...d.sos].map(r => [r.lat, r.lng]);
    if (trk.last) pts.push([trk.last.lat, trk.last.lng]);
    if (!pts.length) { gpsFix(60000).then(p => { trk.last = p; map.setView([p.lat, p.lng], 13); }).catch(() => {}); return; }
    if (pts.length === 1) map.setView(pts[0], 14, { animate }); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 15, animate });
}
function openRider(k) {
    const d = trk.data; if (!d) return;
    const r = k[0] === 's' ? d.sos.find(s => 's' + s.id === k) : d.riders.find(x => 'r' + x.id === k); if (!r) return;
    const sos = k[0] === 's', mine = r.me;
    if (!sos && !mine) { trk.focus = r.id; trackSignal(); }
    trk.map?.setView([r.lat, r.lng], Math.max(trk.map.getZoom(), 14));
    openSheet(sos ? '🆘 SOS' : r.name, `<div class="vc-who" style="margin-bottom:12px">${face({ full_name: r.name, avatar_url: r.avatar }, 'avatar')}<span class="grow"><b>${esc(r.name)}</b>${r.nick ? ` <span class="muted">“${esc(r.nick)}”</span>` : ''}
        <span class="small muted">${sos ? 'Sent SOS ' + timeAgo(r.at) : `Updated ${timeAgo(r.at)}${r.spd > 1 ? ' · ' + Math.round(r.spd * 3.6) + ' km/h' : ''}${r.acc ? ' · ±' + Math.round(r.acc) + ' m' : ''}`}${trk.last && !mine ? ' · ' + kmAway(r) : ''}</span></span></div>
        ${r.note && !sos ? `<p class="trk-note-txt big">“${esc(r.note)}”</p>` : ''}
        <div class="btns">${r.phone ? `<a class="btn" href="tel:+91${esc(r.phone)}">📞 Call</a>` : ''}<a class="btn ghost" href="${mapsLink(r)}" target="_blank" rel="noopener">🗺️ Open in Google Maps</a></div>
        ${sos && (mine || d.staff) ? `<button class="btn ${mine ? '' : 'ghost'} block" data-x="safe" style="margin-top:12px">${mine ? "✅ I'm safe now" : '✅ Mark as resolved'}</button>` : ''}`, body => {
        body.querySelector('[data-x=safe]')?.addEventListener('click', e => busy(e.currentTarget, async () => { await api.trackSosResolve(r.id); closeSheet(); toast('SOS closed. The RWB team is told.'); refreshTrack(); }));
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
const FAM_ROUTES = ['home', 'track', 'events', 'me', 'news', 'crew', 'videos'];
const FAM_CODE_KEY = 'rwb-fam-code';
const FAM_ICON = '<svg viewBox="0 0 24 24"><circle cx="8" cy="7.5" r="2.6"/><circle cx="16.5" cy="8.5" r="2.1"/><path d="M3.5 19c.4-3.4 2.2-5.6 4.5-5.6s4.1 2.2 4.5 5.6M13.4 14.6c.8-.9 1.8-1.4 3.1-1.4 2 0 3.5 1.7 3.9 4.6"/><path d="M12 21.2s-2.6-1.6-2.6-3.3a1.4 1.4 0 0 1 2.6-.7 1.4 1.4 0 0 1 2.6.7c0 1.7-2.6 3.3-2.6 3.3z"/></svg>';
const famCodeNorm = c => { const t = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return t ? 'RWB-' + t.replace(/^RWB/, '').slice(0, 8) : ''; };
const famCodeSaved = () => { try { return localStorage.getItem(FAM_CODE_KEY) || ''; } catch { return ''; } };
const famLink = code => `https://roninwb.in/fam/?c=${encodeURIComponent(code)}`;
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
    app.innerHTML = `${demoBar()}<section class="signin fam-join"><img src="icons/logo-128.png" alt="">
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
    let pushAsk = false; try { pushAsk = NATIVE ? !localStorage.getItem(FCM_KEY) && !localStorage.getItem('rwb-push-dismissed') : pushSupported() && Notification.permission === 'default' && !localStorage.getItem('rwb-push-dismissed'); } catch { /* ignore */ }
    app.innerHTML = top(`Hi, ${firstName(state.me)}`) + `
        <section class="card fam-rider">
            <div class="row">${face(m, 'avatar lg')}<span class="grow"><span class="small muted">Your RWB rider</span><b>${esc(m.full_name || 'RWB member')}</b>${m.nickname ? `<span class="small muted">“${esc(m.nickname)}”</span>` : ''}</span></div>
            <div class="fam-odo"><span class="fam-odo-l">${esc(m.bike || 'Motorcycle')} · odometer</span><b>${m.odo ? Number(m.odo).toLocaleString('en-IN') : '–'}</b><em>km</em></div>
            <a class="btn block" href="#track">📍 Where is ${esc(first)}?</a>
        </section>
        ${pushAsk ? `<div class="banner"><span class="b-ico">🔔</span><span class="grow">Get important RWB announcements as notifications</span><button class="btn sm" data-act="push-on">Turn on</button><button class="icon-btn" data-act="push-later" aria-label="Not now">✕</button></div>` : ''}
        ${vrnCheckCard()}
        ${up.length ? `<section class="section"><h2>RWB events <a href="#events">See all</a></h2><div class="list home-evt">${up.map(e => eventCard(e, evd)).join('')}</div></section>` : ''}
        ${feed.length ? `<section class="section"><h2>Important updates <span class="h-acts"><a href="#news">See all</a></span></h2><div class="group news-mini">${feed.slice(0, 3).map(n => newsRow(n, false, true)).join('')}</div></section>` : ''}
        <section class="section"><h2>Explore</h2><div class="group">
            <a href="https://roninwb.in" target="_blank" rel="noopener"><span class="g-ico">${ICON.globe}</span><span class="grow"><b>roninwb.in</b><span class="small muted">Rides, events, gallery and the team</span></span>${ICON.out}</a>
        </div></section>`;
    swipeToDismiss(app, () => { if (!app.querySelector('.news-mini [data-swipe]')) render(); });
    bindVrnCheck();
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
            <button data-act="out" class="danger-row"><span class="grow"><b>Sign out</b></span></button>
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
        <p class="small muted" style="margin:10px 0">They can't see expenses, RSVPs, Motomart, Service, Mileage or anyone's phone numbers, and they can't share or send SOS.</p>
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
function Native(name) { if (!NATIVE) return null; try { return nativePlugins[name] ??= capRegister(name); } catch (e) { console.error(e); return null; } }
const FCM_KEY = 'rwb-fcm';
async function nativePushOn(ask = true) {
    const P = Native('PushNotifications'); if (!P) return false;
    let st = await P.checkPermissions();
    if (st.receive !== 'granted' && ask) st = await P.requestPermissions();
    if (st.receive !== 'granted') { if (ask) throw new Error('Notifications are off for the RWB app: Settings → Apps → RWB → Notifications → Allow.'); return false; }
    await P.createChannel({ id: 'rwb', name: 'RWB updates', description: 'Events, announcements, Motomart and more', importance: 4, visibility: 1, vibration: true }).catch(() => {});
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
        if (document.querySelector('dialog#sheet[open]')) return closeSheet();
        if (document.querySelector('.sos-alarm')) return document.querySelector('.sos-alarm').remove();
        const h = location.hash.slice(1).split('/')[0];
        if (h && h !== 'home') { if (canGoBack) history.back(); else location.hash = '#home'; } else App.minimizeApp();
    });
    App.addListener('resume', () => { if (sharing()) gpsFix(30000).then(sendFix).catch(() => {}); });
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
    el.innerHTML = android ? `<div class="promo-card"><span class="promo-ico">🚀</span><h2>New update available</h2>
            <p>The new <b>RWB Android app</b> is here: <b>Live Track keeps going with the screen locked</b>, a real SOS siren and faster notifications.</p>
            <a class="btn block" href="${apkUrl()}" data-x="get">Download the update</a>
            <p class="small muted">Open the file when it's downloaded and tap <b>Update</b> (or Install). Sign in once and you're set.</p>
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
    api.onAuthChange(ev => { if (ev === 'SIGNED_OUT') { trk.until = 0; trackSave(null); stopWatch(); trk.resumed = false; if (trk.svc) RwbTrack()?.stop().catch(() => {}); trk.svc = false; } chat.msgs = null; chat.left = null; Object.assign(state, { me: null, fam: null, services: null, fuel: null, bdays: null, adminMembers: null, listings: null, news: null, board: null, dir: null }); delete document.body.dataset.fam; if (ev === 'SIGNED_OUT') history.replaceState(null, '', location.pathname); boot(); });
    boot();
})();
