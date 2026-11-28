/* RWB App — works without internet (Nov 2026).
   Wraps the live data layer (api.js):
   - Reads: every answer is kept on the phone (IndexedDB). With no internet the saved copy is shown.
   - Writes a rider makes on the road (fuel, service, reminders, parts, ride name, RSVPs, profile) go into an
     outbox on the phone when there's no internet, show up in the app at once, and are sent by themselves when
     the internet is back (in the order they were made).
   - Everything else (Pookie, live Track, uploads, admin actions, MotoMart posts) needs the internet and says so.
   Saved copies and the outbox belong to one Google account; nothing here costs anything (no extra service). */

const DB_NAME = 'rwb-offline', STORE = 'kv';
const OFFLINE_MSG = 'You\'re offline. This needs the internet: try again once you\'re connected.';
const isNetErr = e => !navigator.onLine || /No internet connection|Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET|timed? ?out/i.test(e?.message || String(e || ''));

/* ---- tiny IndexedDB key/value store (falls back to memory if the browser blocks it) ---- */
let dbP = null; const mem = new Map();
function idb() {
    if (dbP) return dbP;
    dbP = new Promise(res => {
        try {
            const r = indexedDB.open(DB_NAME, 1);
            r.onupgradeneeded = () => r.result.createObjectStore(STORE);
            r.onsuccess = () => res(r.result);
            r.onerror = () => res(null);
        } catch { res(null); }
    });
    return dbP;
}
async function kvGet(k) {
    const db = await idb(); if (!db) return mem.get(k);
    return new Promise(res => { try { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(undefined); } });
}
/* signing out: the saved copies go (a shared phone keeps nobody's data); changes still waiting to sync stay */
async function kvClearSaved() {
    const db = await idb(); if (!db) { for (const k of [...mem.keys()]) if (!String(k).endsWith('|__outbox')) mem.delete(k); return; }
    return new Promise(res => { try {
        const t = db.transaction(STORE, 'readwrite'), st = t.objectStore(STORE), q = st.openCursor();
        q.onsuccess = () => { const c = q.result; if (!c) return; if (!String(c.key).endsWith('|__outbox')) c.delete(); c.continue(); };
        t.oncomplete = () => res(); t.onerror = () => res();
    } catch { res(); } });
}
async function kvSet(k, v) {
    const db = await idb(); if (!db) { mem.set(k, v); return; }
    return new Promise(res => { try { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); } catch { res(); } });
}

/* for api.js: data the app keeps on the phone between visits (e.g. the admin member list, file 79). Cleared on sign-out. */
export const savedGet = k => kvGet('keep|' + k).catch(() => undefined);
export const savedSet = (k, v) => kvSet('keep|' + k, v).catch(() => {});

/* ---- what can be read offline (the saved copy) ---- */
const READS = ['linkAccount', 'settings', 'myPrefill', 'myChanges', 'me', 'birthdays', 'directory', 'rwbAdmins', 'joinHelpAdmins', 'famMe', 'myFam',
    'gpsBoard', 'pookieBoard', 'warriorPeriod', 'myBikes', 'leaderboard', 'boards', 'centres', 'services', 'events', 'eventCounts', 'myRsvps', 'eventPeople', 'expenses',
    'docs', 'myReminders', 'rideParts', 'rideName', 'fuel', 'myId', 'listings', 'news', 'guideItems', 'guideCats', 'chatNotes', 'adminFamList', 'joinForm'];
const ADMIN_READS = ['stats', 'members', 'appCopies', 'sheetSyncStatus', 'joinList', 'requests', 'changes', 'incomplete', 'dupes', 'reports', 'teachQueue', 'pookiePending', 'pookieKnowledge'];

/* ---- what can be saved offline: the outbox, and how each change shows up in the saved lists until it's sent ---- */
const byOdoAsc = (a, b) => (a.odometer_km - b.odometer_km) || String(a.fill_date || '').localeCompare(String(b.fill_date || ''));
const byDateDesc = (a, b) => String(b.service_date || '').localeCompare(String(a.service_date || '')) || (b.odometer_km - a.odometer_km);
const QUEUE = {
    saveFuel: { list: 'fuel', save: a => a[0], sort: byOdoAsc },
    deleteFuel: { list: 'fuel', del: a => a[0]?.id },
    saveService: { list: 'services', save: a => a[0], sort: byDateDesc },
    deleteService: { list: 'services', del: a => a[0]?.id },
    saveReminder: { list: 'myReminders', save: a => ({ source: 'custom', ...a[0] }) },
    deleteReminder: { list: 'myReminders', del: a => a[0] },
    saveRidePart: { list: 'rideParts', save: a => a[0] },
    deleteRidePart: { list: 'rideParts', del: a => a[0] },
    saveRideName: { value: 'rideName', set: a => a[0] },
    rsvp: { list: 'myRsvps', upsert: a => ({ event_id: a[0], status: a[1], guests: a[2] || 0 }), key: 'event_id' },
    updateMe: { patch: 'me', with: a => a[0] },
    updateMyAnswers: { patch: 'me', with: a => ({ form_answers: { ...(a[0] || {}) } }), deep: 'form_answers' },
    syncReminders: { latestOnly: true }
};
const SILENT = ['appSeen'];   /* "which copy of the app" pings: skipped offline */

export function withOffline(api) {
    let ns = null;   /* the Google account the saved copies belong to */
    let syncing = false;
    const key = (name, args) => `${ns || 'anon'}|${name}|${JSON.stringify(args || [])}`;
    const outboxKey = () => `${ns || 'anon'}|__outbox`;
    const getOutbox = async () => (await kvGet(outboxKey())) || [];
    /* the app's own background refreshes (latestOnly) aren't counted as the rider's changes */
    const followUp = o => o.fn === 'updateMe' && o.args[0] && Object.keys(o.args[0]).every(k => /^(odo_|avg_kmpl|kmpl_tanks)/.test(k));   /* odometer and mileage stats the app updates by itself after a fill-up or service */
    const visible = list => list.filter(o => !QUEUE[o.fn]?.latestOnly && !followUp(o)).length;
    const setOutbox = async list => { await kvSet(outboxKey(), list); emit('rwb-outbox', { count: visible(list) }); };
    const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* ignore */ } };

    /* the pending changes laid over a list, so the rider sees them straight away */
    async function overlay(name, args, data) {
        const box = await getOutbox(); if (!box.length) return data;
        let out = data;
        for (const op of box) {
            const q = QUEUE[op.fn]; if (!q) continue;
            if (q.list === name && Array.isArray(out)) {
                if (q.save) { const rec = q.save(op.args); const i = out.findIndex(x => x.id === rec.id); out = i >= 0 ? out.map((x, j) => j === i ? { ...x, ...rec } : x) : [...out, { ...rec }]; if (q.sort) out = [...out].sort(q.sort); }
                else if (q.del) { const id = q.del(op.args); out = out.filter(x => x.id !== id); }
                else if (q.upsert) { const rec = q.upsert(op.args); const i = out.findIndex(x => x[q.key] === rec[q.key]); out = i >= 0 ? out.map((x, j) => j === i ? { ...x, ...rec } : x) : [...out, rec]; }
            } else if (q.value === name) out = q.set(op.args);
            else if (q.patch === name && out && typeof out === 'object') { const p = q.with(op.args); out = q.deep ? { ...out, [q.deep]: { ...(out[q.deep] || {}), ...p[q.deep] } } : { ...out, ...p }; }
        }
        return out;
    }

    /* Fast start (Nov 28 2026): while the app is opening, reads answer from the saved copy at once and the network
       call runs behind it (the same calls as before, so no extra data). Once the first screen is up (fastDone),
       if anything came back different, 'rwb-fresh' tells the app to redraw; that redraw uses the answers just
       fetched (`fresh`, kept 30 s), so nothing is downloaded twice. */
    let fast = false, bg = [], changed = new Set(), redrawing = false;
    const fresh = new Map();
    function fastStart() { fast = true; bg = []; changed = new Set(); setTimeout(fastDone, 10000); }
    async function fastDone() {
        if (!fast) return; fast = false;
        const list = bg; bg = [];
        await Promise.allSettled(list);
        if (changed.size) emit('rwb-fresh', { names: [...changed] }); else fresh.clear();
        changed = new Set();
    }
    /* the app's redraw after 'rwb-fresh': reads inside it use the answers just fetched */
    async function redraw(run) {
        redrawing = true;
        try { return await run(); } finally { redrawing = false; fresh.clear(); }
    }

    function wrapRead(obj, name, prefix = '') {
        const fn = obj[name]; if (typeof fn !== 'function') return;
        const k = prefix + name;
        obj[name] = async (...args) => {
            const kk = key(k, args), f = redrawing && fresh.get(kk);
            if (f && Date.now() - f.at < 30000) return overlay(k, args, f.v);
            if (fast && navigator.onLine) {
                const saved = await kvGet(kk);
                if (saved !== undefined) {
                    bg.push(fn.apply(obj, args).then(v => {
                        if (v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) return;
                        fresh.set(kk, { v, at: Date.now() });
                        if (JSON.stringify(v) !== JSON.stringify(saved)) { changed.add(k); kvSet(kk, v); }
                    }).catch(() => {}));
                    return overlay(k, args, saved);
                }
            }
            if (navigator.onLine) {
                try {
                    const v = await fn.apply(obj, args);
                    /* an empty answer on a patchy connection never replaces a good saved copy */
                    if (v != null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) kvSet(key(k, args), v);
                    return overlay(k, args, v);
                }
                catch (e) { if (!isNetErr(e)) throw e; }
            }
            const saved = await kvGet(key(k, args));
            if (saved === undefined) throw new Error(OFFLINE_MSG);
            return overlay(k, args, saved);
        };
    }

    /* a change made offline: kept in the outbox (a new record gets a temporary negative id until it's sent) */
    async function queue(name, args) {
        const box = await getOutbox();
        const q = QUEUE[name];
        if (q.latestOnly) { await setOutbox([...box.filter(o => o.fn !== name), { fn: name, args, at: Date.now() }]); return Array.isArray(args[0]) ? args[0].length : null; }
        if (q.save) {
            const rec = { ...q.save(args) };
            if (rec.id == null) rec.id = -Date.now() - Math.floor(Math.random() * 1000);
            const a = [...args]; a[0] = { ...args[0], id: rec.id };
            /* editing a record that isn't sent yet: just update the waiting change */
            const i = box.findIndex(o => o.fn === name && o.args[0]?.id === rec.id);
            if (i >= 0) { box[i] = { ...box[i], args: [{ ...box[i].args[0], ...a[0] }, ...a.slice(1)] }; await setOutbox(box); }
            else await setOutbox([...box, { fn: name, args: a, at: Date.now() }]);
            return rec;
        }
        if (q.del) {
            const id = q.del(args);
            /* deleting something that was never sent: forget it */
            if (typeof id === 'number' && id < 0) { await setOutbox(box.filter(o => !(QUEUE[o.fn]?.list === q.list && (QUEUE[o.fn].save?.(o.args)?.id === id)))); return null; }
            await setOutbox([...box, { fn: name, args, at: Date.now() }]);
            return null;
        }
        await setOutbox([...box, { fn: name, args, at: Date.now() }]);
        if (q.patch) { const saved = await kvGet(key(q.patch, [])); return saved ? overlay(q.patch, [], saved) : q.with(args); }   /* the whole record, as the app expects */
        return q.upsert ? q.upsert(args) : null;
    }

    function wrapWrite(obj, name) {
        const fn = obj[name]; if (typeof fn !== 'function') return;
        obj[name] = async (...args) => {
            /* something already waiting: keep the order, queue behind it */
            if (navigator.onLine && !(await getOutbox()).length) {
                try { return await fn.apply(obj, args); }
                catch (e) { if (!isNetErr(e)) throw e; }
            }
            const r = await queue(name, args);
            if (navigator.onLine) setTimeout(sync, 1500);
            return r;
        };
    }

    /* send the waiting changes, oldest first; stops at the first network problem and tries again later */
    const real = {};
    async function sync() {
        if (syncing || !navigator.onLine || !ns) return;
        if (!(await getOutbox()).length) return;   /* nothing waiting: no sign-in check, no network (battery) */
        const s = await real.session?.().catch(() => null);
        if (!s || s.email !== ns) return;   /* only the account that made the changes sends them */
        syncing = true;
        let done = 0; const failed = []; const ids = new Map();
        try {
            let box = await getOutbox();
            while (box.length) {
                const op = box[0], q = QUEUE[op.fn] || {};
                let args = op.args.map(a => (a && typeof a === 'object' && !(a instanceof Blob) && !Array.isArray(a)) ? { ...a } : a);
                /* a record made offline: insert it (no temporary id), and remember its real id for later changes */
                const fix = id => (typeof id === 'number' && id < 0) ? ids.get(id) ?? id : id;
                let tmp = null;
                if (q.save && args[0]?.id < 0) { tmp = args[0].id; if (ids.has(tmp)) args[0].id = ids.get(tmp); else delete args[0].id; }
                if (q.del) { if (typeof args[0] === 'object') args[0] = { ...args[0], id: fix(args[0].id) }; else args[0] = fix(args[0]); }
                try {
                    const r = await real[op.fn](...args);
                    if (tmp != null && r?.id != null) ids.set(tmp, r.id);
                    if (!q.latestOnly && !followUp(op)) done++;
                } catch (e) {
                    if (isNetErr(e)) break;
                    failed.push(e.message || String(e));
                }
                box = (await getOutbox()).slice(1);
                await setOutbox(box);
            }
        } finally { syncing = false; }
        if (done || failed.length) emit('rwb-synced', { done, failed });
    }

    /* ---- wrap ---- */
    for (const n of READS) wrapRead(api, n);
    if (api.admin) for (const n of ADMIN_READS) wrapRead(api.admin, n, 'admin.');
    for (const n of Object.keys(QUEUE)) { real[n] = api[n]?.bind(api); wrapWrite(api, n); }
    for (const n of SILENT) { const f = api[n]; if (typeof f === 'function') api[n] = async (...a) => navigator.onLine ? f.apply(api, a) : null; }

    /* signed-in account: kept so the app opens offline even when the sign-in needs refreshing */
    const session = api.session.bind(api); real.session = session;
    api.session = async () => {
        let s = null;
        try { s = await session(); } catch (e) { if (!isNetErr(e)) throw e; }
        if (s) { ns = s.email; try { localStorage.setItem('rwb-off-sess', JSON.stringify(s)); } catch { /* ignore */ } return s; }
        if (!navigator.onLine) { try { const c = JSON.parse(localStorage.getItem('rwb-off-sess') || 'null'); if (c) { ns = c.email; return c; } } catch { /* ignore */ } }
        return null;
    };
    const signOut = api.signOut.bind(api);
    api.signOut = async () => { try { localStorage.removeItem('rwb-off-sess'); } catch { /* ignore */ } ns = null; await kvClearSaved(); return signOut(); };

    api.offline = {
        pending: async () => visible(await getOutbox()),
        sync,
        isNetErr,
        fastStart,
        fastDone,
        redraw
    };
    window.addEventListener('online', () => setTimeout(sync, 800));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
    setInterval(() => { if (navigator.onLine && !document.hidden) sync(); }, 60000);
    setTimeout(sync, 4000);
    return api;
}
