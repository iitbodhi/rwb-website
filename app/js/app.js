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
    bdays: async () => (state.bdays ??= await api.birthdays(isAdmin() ? 7 : 0).catch(() => []))
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
const ROUTES = { home: viewHome, service: viewService, mileage: viewMileage, guides: viewGuides, me: viewMe, admin: viewAdmin };
async function render() {
    const name = (location.hash.slice(1) || 'home').split('?')[0];
    const view = ROUTES[name] || viewHome;
    if (name === 'admin' && !isAdmin()) { location.hash = '#home'; return; }
    tabbar.hidden = false;
    tabbar.querySelectorAll('a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === name || (name === 'admin' && a.dataset.tab === 'me')));
    tabbar.querySelectorAll('a[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
    try { await view(); } catch (e) { app.innerHTML = top('Oops') + `<div class="card empty"><b>Could not load</b>${esc(e.message)}<p style="margin-top:12px"><button class="btn sm" onclick="location.reload()">Try again</button></p></div>`; }
}
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });

const demoBar = () => api?.demo ? `<div class="demo-bar">Demo mode: sample data, saved only on this device. <button data-act="reset-demo">Reset</button></div>` : '';
const top = (title, right = '') => `${demoBar()}<header class="top"><img class="logo" src="icons/icon-192.png" alt=""><h1>${esc(title)}</h1>${right}</header>`;

/* delegated clicks: each screen sets its own actions */
let actions = {};
app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = actions[el.dataset.act] || globalActions[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
const globalActions = {
    'reset-demo': () => { if (confirmBox('Reset the demo data?')) { api.resetDemo(); Object.assign(state, { services: null, fuel: null, bdays: null, adminMembers: null }); boot(); } },
    'add-service': () => serviceForm(),
    'add-fuel': () => fuelForm(),
    'wish': () => window.open(waShare(wishText(state.bdays.filter(b => b.day === todayISO()))), '_blank', 'noopener')
};

/* =================== Sign in / access =================== */
const G_ICON = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function viewSignIn() {
    tabbar.hidden = true;
    app.innerHTML = `${demoBar()}<section class="signin">
        <img src="icons/icon-512.png" alt="Ronin Warriors of Bengal">
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
        app.innerHTML = `${demoBar()}<section class="signin"><img src="icons/icon-192.png" alt="">
            <div><h1>Request sent</h1><p class="lead">Thanks${req ? ', ' + esc(firstName(req)) : ''}! An RWB admin will check your details and let you in, usually within a day.</p></div>
            <button class="btn block" data-act="recheck">Check again</button>
            <button class="btn ghost block" data-act="out">Sign out</button></section>`;
        actions = { recheck: b => busy(b, boot), out: () => api.signOut() };
        return;
    }
    app.innerHTML = `${demoBar()}<header class="top"><img class="logo" src="icons/icon-192.png" alt=""><h1>Almost there</h1></header>
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
async function viewHome() {
    const [services, fuel, bdays] = await Promise.all([load.services(), load.fuel(), load.bdays()]);
    const today = bdays.filter(b => b.day === todayISO());
    const ms = mileageStats(fuel);
    const last = services[0];
    const due = services.find(s => s.next_due_km || s.next_due_date);
    const odoNow = Math.max(0, ...services.map(s => s.odometer_km), ...fuel.map(f => f.odometer_km));
    const yr = String(new Date().getFullYear());
    const spent = services.filter(s => s.service_date.startsWith(yr)).reduce((a, s) => a + Number(s.cost || 0), 0);
    let dueText = '–', dueSub = 'Next service';
    if (due?.next_due_km) { const left = due.next_due_km - odoNow; dueText = left > 0 ? km(left) : 'Due now'; dueSub = left > 0 ? `to next service (${km(due.next_due_km)})` : `next service was at ${km(due.next_due_km)}`; }
    else if (due?.next_due_date) { dueText = fmtDayMonth(due.next_due_date); dueSub = 'Next service date'; }

    app.innerHTML = top('RWB', isAdmin() ? '<a class="btn sm ghost" href="#admin">Admin</a>' : '') + `
        <div class="hero"><h2>Hi, ${esc(firstName(state.me))}</h2><p>${esc([state.me.bike, state.me.vrn].filter(Boolean).join(' · ') || 'Ride safe, Ronin.')}</p></div>
        ${today.length ? `<section class="section"><div class="card bday"><h3>🎂 Birthdays today</h3>
            <ul>${today.map(b => `<li>${esc(b.full_name)}${b.nickname ? ` <span class="muted">(${esc(b.nickname)})</span>` : ''}</li>`).join('')}</ul>
            <button class="btn wa sm" data-act="wish">Wish on WhatsApp</button></div></section>` : ''}
        <section class="section"><div class="stats">
            <div class="stat accent"><b>${ms.avg ? ms.avg.toFixed(1) : '–'}</b><span>Avg km/l</span></div>
            <div class="stat"><b>${dueText}</b><span>${esc(dueSub)}</span></div>
            <div class="stat"><b>${last ? km(last.odometer_km).replace(' km', '') : '–'}</b><span>Last service (km)</span></div>
            <div class="stat"><b>${rs(spent)}</b><span>Service spend ${yr}</span></div>
        </div></section>
        <section class="section"><div class="btns"><button class="btn" data-act="add-fuel">＋ Fuel fill-up</button><button class="btn ghost" data-act="add-service">＋ Service</button></div></section>
        ${isAdmin() ? `<section class="section"><a class="card tap row" href="#admin" style="text-decoration:none"><div class="grow"><h3>Admin panel</h3><p class="muted small" id="admin-hint">Members, access requests, birthdays</p></div><span class="kmpl">›</span></a></section>` : ''}
        <section class="section"><h2>Explore</h2><div class="list">
            <a class="card tap row" href="#guides" data-guide="maint" style="text-decoration:none"><div class="grow"><h3>Ronin maintenance</h3><p class="muted small">Service guides and how-tos from our coordinators</p></div><span class="kmpl">›</span></a>
            <a class="card tap row" href="#guides" data-guide="acc" style="text-decoration:none"><div class="grow"><h3>Recommended gear</h3><p class="muted small">Accessories rated by RWB</p></div><span class="kmpl">›</span></a>
            <a class="card tap row" href="https://roninwb.in" target="_blank" rel="noopener" style="text-decoration:none"><div class="grow"><h3>roninwb.in</h3><p class="muted small">Rides, events, gallery and the team</p></div><span class="kmpl">↗</span></a>
        </div></section>`;
    actions = {};
    app.querySelectorAll('[data-guide]').forEach(a => a.addEventListener('click', () => state.guideTab = a.dataset.guide));
    if (isAdmin()) api.admin.stats().then(s => { const h = $('#admin-hint'); if (h && s.pending) h.innerHTML = `<b style="color:var(--orange)">${s.pending} access request${s.pending > 1 ? 's' : ''} waiting</b>`; }).catch(() => {});
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
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that photo. Try a JPG or PNG.')); i.src = URL.createObjectURL(file); });
    let max = 1600, q = 0.72, blob;
    for (let tries = 0; tries < 6; tries++) {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
        if (blob.size <= 250e3) break;
        max = Math.round(max * 0.82); q = Math.max(0.5, q - 0.05);
    }
    URL.revokeObjectURL(img.src);
    return new File([blob], 'bill.jpg', { type: 'image/jpeg' });
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
        <div id="guide-body"><p class="muted">Loading…</p></div>`;
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

function viewMe() {
    const m = state.me;
    app.innerHTML = top('Me') + `
        <div class="card"><h3>${esc(m.full_name)}</h3><p class="muted">${esc([m.nickname && `“${m.nickname}”`, m.role !== 'member' && (m.role === 'superadmin' ? 'Super admin' : 'Admin')].filter(Boolean).join(' · ') || 'RWB member')}</p>
            <dl class="facts">
                <dt>WhatsApp</dt><dd>${esc(m.phone || '–')}</dd>
                <dt>Bike</dt><dd>${esc([m.bike, m.vrn].filter(Boolean).join(' · ') || '–')}</dd>
                <dt>Birthday</dt><dd>${m.dob ? fmtDayMonth(m.dob) : '–'}</dd>
                <dt>Blood group</dt><dd>${esc(m.blood_group || '–')}</dd>
                <dt>Locality</dt><dd>${esc(m.locality || '–')}</dd>
                <dt>Emergency</dt><dd>${esc(m.emergency_phone || '–')}</dd>
            </dl>
            <button class="btn ghost block" data-act="edit">Edit my details</button></div>
        ${isAdmin() ? '<a class="card tap row section" href="#admin" style="text-decoration:none;display:flex"><div class="grow"><h3>Admin panel</h3><p class="small muted">Members, access requests, birthdays</p></div><span class="kmpl">›</span></a>' : ''}
        ${isStandalone() ? '' : `<div class="card section"><h3>Install the app</h3><p class="small muted" style="margin-bottom:12px">${isIOS() ? 'In Safari, tap the Share button, then “Add to Home Screen”.' : 'Add RWB to your home screen. It opens like any other app and uses almost no space.'}</p>${!isIOS() ? '<button class="btn block" data-act="install">Install RWB app</button>' : ''}</div>`}
        <div class="section btns"><button class="btn ghost" data-act="out">Sign out</button></div>
        <p class="small muted section" style="text-align:center">RWB App · free for every Ronin · <a href="https://roninwb.in" target="_blank" rel="noopener">roninwb.in</a></p>`;
    actions = {
        out: () => api.signOut(),
        install: async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); } else toast('Use your browser menu: “Install app” or “Add to Home screen”'); },
        edit: () => openSheet('My details', `<form id="mf">
            <p class="small muted">Name and WhatsApp number can be changed by an admin.</p>
            <label>Nickname<input name="nickname" value="${esc(m.nickname || '')}" maxlength="40"></label>
            <div class="grid2"><label>Date of birth<input type="date" name="dob" value="${esc(m.dob && !m.dob.startsWith('1904') ? m.dob : '')}"></label>
                <label>Blood group<select name="blood_group">${['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(b => `<option${(m.blood_group || '').replace(/\s/g, '').toUpperCase().startsWith(b) && b ? ' selected' : ''} value="${b}">${b || '–'}</option>`).join('')}</select></label></div>
            <div class="grid2"><label>Bike<input name="bike" value="${esc(m.bike || '')}"></label><label>Bike number<input name="vrn" value="${esc(m.vrn || '')}"></label></div>
            <label>Locality<input name="locality" value="${esc(m.locality || '')}"></label>
            <label>Hometown<input name="hideout" value="${esc(m.hideout || '')}"></label>
            <div class="grid2"><label>Emergency contact<input name="emergency_phone" inputmode="tel" value="${esc(m.emergency_phone || '')}"></label><label>Other mobile<input name="alt_phone" inputmode="tel" value="${esc(m.alt_phone || '')}"></label></div>
            <button class="btn block">Save</button></form>`, body => {
            body.querySelector('#mf').onsubmit = e => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.target)); Object.keys(d).forEach(k => d[k] = d[k].trim() || null);
                if (!d.dob && m.dob?.startsWith('1904')) delete d.dob;   /* keep "year unknown" birthday */
                if (!d.blood_group && m.blood_group) delete d.blood_group;
                busy(e.submitter, async () => { state.me = await api.updateMe(d); closeSheet(); render(); toast('Saved'); });
            };
        })
    };
}

/* =================== Admin =================== */
async function viewAdmin() {
    const s = await api.admin.stats();
    const tab = state.adminTab;
    app.innerHTML = top('Admin', '<a class="btn sm ghost" href="#me">Done</a>') + `
        <div class="stats"><div class="stat"><b>${s.members}</b><span>Members</span></div><div class="stat"><b>${s.on_app}</b><span>On the app</span></div><div class="stat ${s.pending ? 'accent' : ''}"><b>${s.pending}</b><span>Waiting</span></div></div>
        <div class="seg section" role="tablist">
            <button role="tab" aria-selected="${tab === 'requests'}" data-act="tab" data-tab="requests">Requests${s.pending ? ` (${s.pending})` : ''}</button>
            <button role="tab" aria-selected="${tab === 'members'}" data-act="tab" data-tab="members">Members</button>
            <button role="tab" aria-selected="${tab === 'bdays'}" data-act="tab" data-tab="bdays">Birthdays</button></div>
        <div id="admin-body"><p class="muted">Loading…</p></div>`;
    actions = { tab: el => { state.adminTab = el.dataset.tab; viewAdmin(); } };
    try { await ({ requests: adminRequests, members: adminMembers, bdays: adminBdays })[tab](); }
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
    $('#admin-body').innerHTML = `<input class="search" type="search" id="mq" placeholder="Search name, number or bike no." value="${esc(state.adminSearch)}" aria-label="Search members"><p class="small muted" id="mcount" style="margin:-4px 0 10px"></p><div class="list" id="ml"></div><button class="btn ghost block section" id="more" hidden>Show more</button>`;
    let limit = 50;
    const draw = () => {
        const q = state.adminSearch.trim().toLowerCase(), qd = q.replace(/\D/g, '');
        const hits = all.filter(m => !q || m.full_name.toLowerCase().includes(q) || (m.nickname || '').toLowerCase().includes(q) || (qd.length >= 3 && (m.phone || '').includes(qd)) || (m.vrn || '').toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')));
        $('#mcount').textContent = `${hits.length} member${hits.length === 1 ? '' : 's'}`;
        $('#ml').innerHTML = hits.slice(0, limit).map(m => `<button class="card tap row member-row" data-act="member" data-id="${m.id}">
            <div class="grow"><div class="who">${esc(m.full_name)} ${m.role !== 'member' ? `<span class="badge orange">${m.role === 'superadmin' ? 'Super admin' : 'Admin'}</span>` : ''}</div>
            <div class="meta">${esc([m.phone, m.vrn, m.locality].filter(Boolean).join(' · '))}</div></div>
            ${m.user_id ? '<span class="badge ok">On app</span>' : ''}</button>`).join('') || '<div class="card empty">No one matches.</div>';
        $('#more').hidden = hits.length <= limit;
    };
    $('#mq').oninput = e => { state.adminSearch = e.target.value; limit = 50; draw(); };
    $('#more').onclick = () => { limit += 100; draw(); };
    draw();
    actions.member = el => memberSheet(all.find(m => String(m.id) === el.dataset.id));
}
function memberSheet(m) {
    const superA = state.me.role === 'superadmin', self = m.user_id && m.user_id === state.me.user_id;
    const canRemove = !self && m.role !== 'superadmin' && (m.role !== 'admin' || superA);
    openSheet(m.full_name, `
        <div class="tags" style="margin:0 0 10px">${m.user_id ? '<span class="badge ok">On the app</span>' : '<span class="badge">Not on the app yet</span>'}${m.role !== 'member' ? `<span class="badge orange">${m.role === 'superadmin' ? 'Super admin' : 'Admin'}</span>` : ''}</div>
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
            busy(rm, async () => { await api.admin.remove(m.id); state.adminMembers = state.adminMembers.filter(x => x.id !== m.id); closeSheet(); toast(`${m.full_name} removed`); viewAdmin(); });
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

/* =================== Boot =================== */
async function boot() {
    try {
        const sess = await api.session();
        if (!sess) return viewSignIn();
        const status = await api.linkAccount();
        if (status !== 'member') return viewAccess(status, sess);
        state.me = await api.me();
        await render();
    } catch (e) {
        tabbar.hidden = true;
        app.innerHTML = `<section class="signin"><img src="icons/icon-192.png" alt=""><div><h1>Can't connect</h1><p class="lead">${esc(e.message || 'Please check your internet connection.')}</p></div><button class="btn block" onclick="location.reload()">Try again</button></section>`;
    }
}

(async () => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    try { api = await createApi(); }
    catch { app.innerHTML = `<section class="signin"><h1>Can't load</h1><p class="lead">Please check your internet connection.</p><button class="btn block" onclick="location.reload()">Try again</button></section>`; return; }
    api.onAuthChange(ev => { Object.assign(state, { me: null, services: null, fuel: null, bdays: null, adminMembers: null }); if (ev === 'SIGNED_OUT') location.hash = ''; boot(); });
    boot();
})();
