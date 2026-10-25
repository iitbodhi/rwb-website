/* RWB App — data layer.
   One set of functions, two backends:
   - Supabase (real data) when APP_CONFIG has a URL and key
   - Demo (sample data in this browser) when it does not */

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const BILL_BUCKET = 'bills', PHOTO_BUCKET = 'motomart';
const extOf = f => ({ 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/png': 'png' })[f.type] || 'jpg';

export async function createApi() {
    const c = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
    if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) return supabaseApi(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    return demoApi();
}

/* Turn database errors into a sentence a rider can act on */
function friendly(error) {
    if (!error) return null;
    const m = error.message || String(error);
    if (/Failed to fetch|NetworkError|network/i.test(m)) return new Error('No internet connection. Please try again.');
    if (/JWT|session/i.test(m)) return new Error('Your sign-in has expired. Please sign in again.');
    return new Error(m.replace(/^.*?ERROR:\s*/, ''));
}
const must = ({ data, error }) => { if (error) throw friendly(error); return data; };

/* ======================= Supabase ======================= */
async function supabaseApi(url, key) {
    const { createClient } = await import(SUPABASE_JS);
    const sb = createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
    const uid = async () => (await sb.auth.getSession()).data.session?.user?.id;

    return {
        demo: false,
        async session() { const s = (await sb.auth.getSession()).data.session; return s ? { email: s.user.email, name: s.user.user_metadata?.full_name } : null; },
        onAuthChange(fn) {
            /* only react when the signed-in person actually changes (Supabase also fires on token refresh / tab focus) */
            let last;
            sb.auth.onAuthStateChange((ev, s) => {
                const id = s?.user?.id || null;
                if (ev === 'INITIAL_SESSION') { last = id; return; }
                if (id !== last) { last = id; setTimeout(() => fn(id ? 'SIGNED_IN' : 'SIGNED_OUT'), 0); }
            });
        },
        async signIn() {
            const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
            if (error) throw friendly(error);
        },
        async signOut() { await sb.auth.signOut(); },

        linkAccount: async () => must(await sb.rpc('link_account')),
        async requestAccess(f) {
            const args = { p_full_name: f.full_name, p_phone: f.phone, p_dob: f.dob || null, p_vrn: f.vrn || null, p_locality: f.locality || null, p_bike: f.bike || null, p_blood_group: f.blood_group || null, p_hideout: f.hideout || null, p_emergency_phone: f.emergency_phone || null, p_alt_phone: f.alt_phone || null };
            const r = await sb.rpc('request_access', { ...args, p_tnc: !!f.tnc });
            /* database not updated yet (before setup file 29): send it the old way */
            if (r.error && /could not find|function/i.test(r.error.message || '')) return must(await sb.rpc('request_access', args));
            return must(r);
        },
        myRequest: async () => must(await sb.from('link_requests').select('*').maybeSingle()),
        me: async () => must(await sb.from('members').select('*').eq('user_id', await uid()).single()),
        updateMe: async f => must(await sb.from('members').update(f).eq('user_id', await uid()).select().single()),
        async setAvatar(file) {   /* file = small square JPEG, or null to remove */
            const me = await uid(), path = `${me}/avatar.jpg`;
            if (!file) { await sb.storage.from('avatars').remove([path]); return must(await sb.from('members').update({ avatar_url: null }).eq('user_id', me).select().single()); }
            must(await sb.storage.from('avatars').upload(path, file, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' }));
            const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
            return must(await sb.from('members').update({ avatar_url: url }).eq('user_id', me).select().single());
        },
        birthdays: async (days = 0) => must(await sb.rpc('birthdays', { p_days: days })),
        directory: async () => must(await sb.rpc('member_directory')),
        myBikes: async () => must(await sb.from('member_bikes').select('slot, vrn, model, verified').order('slot')),
        saveBike: async (slot, vrn, model, memberId = null) => must(await sb.rpc('save_bike', { p_slot: slot, p_vrn: vrn || '', p_model: model || null, p_member_id: memberId })),
        leaderboard: async () => must(await sb.rpc('odometer_leaderboard')),
        boards: async () => must(await sb.rpc('warrior_boards')),
        centres: async () => must(await sb.from('service_centres').select('id,name,area,pincode').order('name')),
        addCentre: async (name, area, pincode) => must(await sb.rpc('add_service_centre', { p_name: name, p_area: area || null, p_pincode: pincode || null })),
        deleteCentre: async id => must(await sb.from('service_centres').delete().eq('id', id)),

        services: async () => must(await sb.from('service_records').select('*').order('service_date', { ascending: false }).order('odometer_km', { ascending: false })),
        async saveService(rec, file) {
            const me = await uid();
            if (file) {
                const ext = extOf(file);
                const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                must(await sb.storage.from(BILL_BUCKET).upload(path, file, { contentType: file.type, upsert: false }));
                if (rec.bill_path) await sb.storage.from(BILL_BUCKET).remove([rec.bill_path]);
                rec.bill_path = path;
            }
            const { id, user_id, created_at, ...row } = rec;
            return id ? must(await sb.from('service_records').update(row).eq('id', id).select().single())
                      : must(await sb.from('service_records').insert(row).select().single());
        },
        async deleteService(rec) {
            if (rec.bill_path) await sb.storage.from(BILL_BUCKET).remove([rec.bill_path]);
            must(await sb.from('service_records').delete().eq('id', rec.id));
        },
        async removeBill(rec) {
            await sb.storage.from(BILL_BUCKET).remove([rec.bill_path]);
            return must(await sb.from('service_records').update({ bill_path: null }).eq('id', rec.id).select().single());
        },
        billUrl: async path => must(await sb.storage.from(BILL_BUCKET).createSignedUrl(path, 600)).signedUrl,

        /* ---- Events ---- */
        events: async () => must(await sb.from('events').select('*').order('starts_at')),
        eventCounts: async () => must(await sb.rpc('event_counts')) || [],
        myRsvps: async () => must(await sb.from('event_rsvps').select('event_id,status,guests').eq('user_id', await uid())),
        eventPeople: async id => must(await sb.rpc('event_people', { p_event: id })) || [],
        async rsvp(eventId, status, guests = 0) { return must(await sb.from('event_rsvps').upsert({ event_id: eventId, user_id: await uid(), status, guests }, { onConflict: 'event_id,user_id' }).select().single()); },
        async saveEvent(rec) {
            const { id, created_by, created_at, updated_at, reminded_at, ...row } = rec;
            return id ? must(await sb.from('events').update(row).eq('id', id).select().single())
                      : must(await sb.from('events').insert(row).select().single());
        },
        deleteEvent: async id => must(await sb.from('events').delete().eq('id', id)),
        expenses: async id => must(await sb.from('event_expenses').select('*').eq('event_id', id).order('created_at')),
        async saveExpense(rec) {
            const { id, created_by, created_at, ...row } = rec;
            return id ? must(await sb.from('event_expenses').update(row).eq('id', id).select().single())
                      : must(await sb.from('event_expenses').insert(row).select().single());
        },
        deleteExpense: async id => must(await sb.from('event_expenses').delete().eq('id', id)),

        /* ---- My documents (private) ---- */
        docs: async () => must(await sb.from('documents').select('*').order('created_at')),
        async saveDoc(rec, add = [], drop = []) {
            const me = await uid(), files = (rec.files || []).filter(f => !drop.includes(f));
            for (const file of add) {
                const ext = extOf(file);
                const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                must(await sb.storage.from('docs').upload(path, file, { contentType: file.type, upsert: false }));
                files.push(path);
            }
            const { id, user_id, created_at, ...row } = { ...rec, files, updated_at: new Date().toISOString() };
            const saved = id ? must(await sb.from('documents').update(row).eq('id', id).select().single())
                             : must(await sb.from('documents').insert(row).select().single());
            if (drop.length) await sb.storage.from('docs').remove(drop).catch(() => {});
            return saved;
        },
        async deleteDoc(rec) {
            if (rec.files?.length) await sb.storage.from('docs').remove(rec.files).catch(() => {});
            must(await sb.from('documents').delete().eq('id', rec.id));
        },
        docUrl: async path => must(await sb.storage.from('docs').createSignedUrl(path, 900)).signedUrl,

        fuel: async () => must(await sb.from('fuel_logs').select('*').order('odometer_km', { ascending: true }).order('fill_date', { ascending: true })),
        async saveFuel(rec) {
            const { id, user_id, created_at, ...row } = rec;
            return id ? must(await sb.from('fuel_logs').update(row).eq('id', id).select().single())
                      : must(await sb.from('fuel_logs').insert(row).select().single());
        },
        deleteFuel: async rec => must(await sb.from('fuel_logs').delete().eq('id', rec.id)),

        /* ---- Motomart ---- */
        myId: uid,
        listings: async () => must(await sb.from('listings').select('*').order('published_at', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false })),
        photoUrl: path => sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
        async saveListing(rec, newFiles = [], removed = []) {
            const me = await uid(), added = [];
            try {
                for (const f of newFiles) {
                    const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
                    must(await sb.storage.from(PHOTO_BUCKET).upload(path, f, { contentType: 'image/jpeg', upsert: false }));
                    added.push(path);
                }
                const { id, user_id, created_at, updated_at, published_at, status, reject_reason, ...row } = rec;
                row.photos = [...(rec.photos || []).filter(p => !removed.includes(p)), ...added];
                const saved = id ? must(await sb.from('listings').update(row).eq('id', id).select().single())
                                 : must(await sb.from('listings').insert(row).select().single());
                if (removed.length) await sb.storage.from(PHOTO_BUCKET).remove(removed);
                return saved;
            } catch (e) { if (added.length) await sb.storage.from(PHOTO_BUCKET).remove(added); throw e; }
        },
        setListingStatus: async (id, status, reason = null) => must(await sb.from('listings').update({ status, reject_reason: reason }).eq('id', id).select().single()),
        async deleteListing(rec) {
            must(await sb.from('listings').delete().eq('id', rec.id));
            if (rec.photos?.length) await sb.storage.from(PHOTO_BUCKET).remove(rec.photos);
        },

        /* ---- Announcements + push ---- */
        news: async () => must(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(40)),
        announce: async (title, body) => must(await sb.rpc('admin_announce', { p_title: title, p_body: body })),
        deleteNews: async id => must(await sb.from('notifications').delete().eq('id', id)),
        savePush: async (endpoint, p256dh, auth) => must(await sb.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth })),
        deletePush: async endpoint => must(await sb.rpc('delete_push_subscription', { p_endpoint: endpoint })),
        testPush: async () => must(await sb.rpc('admin_test_push')),

        /* ---- Pookie ---- */
        /* Streams the answer (onText(textSoFar) as words arrive). If nothing arrives in 20 s,
           asks again for the whole answer in one go, which works even where streaming is held up. */
        async ask(messages, context, image, onText) {
            const token = (await sb.auth.getSession()).data.session?.access_token;
            const call = (stream, ms) => {
                const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
                return { ctrl, timer, res: fetch(url + '/functions/v1/ask-ronin', {
                    method: 'POST', signal: ctrl.signal,
                    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + (token || key) },
                    body: JSON.stringify({ messages, context, image, stream })
                }) };
            };
            /* the server's own message, plus (for admins) the technical reason in .detail */
            const errorOf = async r => { try { const b = await r.json(); return b?.error ? Object.assign(new Error(b.error), { detail: b.detail, final: true }) : null; } catch { return null; } };
            /* 1) streaming */
            let text = '', left = null;
            const a = call(true, 20000);
            try {
                const r = await a.res;
                const type = r.headers.get('content-type') || '';
                if (!r.ok) { clearTimeout(a.timer); throw (await errorOf(r)) || new Error('stream failed'); }   /* a real answer from the server: no point asking twice */
                if (type.includes('json')) { clearTimeout(a.timer); const b = await r.json(); onText?.(b.reply); return b; }
                left = r.headers.get('x-left');
                const reader = r.body.getReader(), dec = new TextDecoder();
                for (;;) { const { value, done } = await reader.read(); if (done) break; clearTimeout(a.timer); text += dec.decode(value, { stream: true }); onText?.(text); }
                clearTimeout(a.timer);
                if (text.trim()) return { reply: text, left: left === '' || left == null ? null : Number(left) };
            } catch (e) {
                clearTimeout(a.timer);
                if (e.final) throw e;
                if (text.trim()) return { reply: text + '\n\n*(The connection dropped, so this answer may be cut short.)*', left: null };
            }
            /* 2) whole answer at once */
            const b = call(false, 40000);
            try {
                const r = await b.res; clearTimeout(b.timer);
                if (!r.ok) throw (await errorOf(r)) || Object.assign(new Error(`Pookie couldn't answer right now (HTTP ${r.status}). Please try again.`), { final: true });
                const d = await r.json(); onText?.(d.reply); return d;
            } catch (e) {
                clearTimeout(b.timer);
                if (e.final) throw e;
                throw new Error(e.name === 'AbortError' ? 'Pookie is taking too long. Please try again in a minute.'
                    : /fetch|network|load failed/i.test(e.message) ? (navigator.onLine ? 'Pookie\'s server refused the request. An admin can check it in Admin → Pookie → Run a check.' : 'No internet connection. Please try again.') : e.message);
            }
        },
        async diagnoseAI() {
            const token = (await sb.auth.getSession()).data.session?.access_token;
            const r = await fetch(url + '/functions/v1/ask-ronin', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + token }, body: JSON.stringify({ diagnose: true }) })
                .catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
            const body = await r.text();
            try { return JSON.parse(body).log || [JSON.parse(body).error]; } catch {
                return [r.status === 0 ? 'Could not reach the ask-ronin function at all.' : `The function answered HTTP ${r.status}: ${body.slice(0, 300) || '(empty)'}`,
                    r.status === 404 ? 'FIX: the ask-ronin function is not deployed, or it has a different name.'
                    : (r.status === 0 || r.status === 401) ? 'FIX: in Supabase open Edge Functions → ask-ronin → Details (or Settings), turn OFF "Verify JWT with legacy secret" / "Enforce JWT verification", and save. Pookie checks members itself.' : ''];
            }
        },
        chatNotes: async () => must(await sb.rpc('admin_get_chat_notes')),
        saveChatNotes: async notes => must(await sb.rpc('admin_set_chat_notes', { p_notes: notes })),

        admin: {
            stats: async () => must(await sb.rpc('admin_stats')),
            requests: async () => must(await sb.rpc('admin_list_requests')),
            approve: async id => must(await sb.rpc('admin_approve_request', { p_request_id: id })),
            async reject(id, reason = '') {
                const r = await sb.rpc('admin_reject_request', { p_request_id: id, p_reason: reason || null });
                if (r.error && /could not find|function/i.test(r.error.message || '')) return must(await sb.rpc('admin_reject_request', { p_request_id: id }));
                return must(r);
            },
            setReqVrn: async (id, v) => must(await sb.rpc('admin_set_request_vrn', { p_request_id: id, p_verified: v })),
            setVrnVerified: async (memberId, slot, v) => must(await sb.rpc('admin_set_vrn_verified', { p_member_id: memberId, p_slot: slot, p_verified: v })),
            async members() {
                const all = []; let from = 0;
                for (;;) {   /* fetch in pages of 1000 (Supabase's default limit) */
                    let res = await sb.from('members').select('*, member_bikes(slot, vrn, model, verified)').order('full_name').range(from, from + 999);
                    if (res.error) res = await sb.from('members').select('*').order('full_name').range(from, from + 999);   /* before setup file 29 */
                    const page = must(res);
                    all.push(...page); if (page.length < 1000) return all; from += 1000;
                }
            },
            update: async (id, p) => must(await sb.rpc('admin_update_member', { p_member_id: id, p })),
            setRole: async (id, role) => must(await sb.rpc('admin_set_role', { p_member_id: id, p_role: role })),
            async remove(id, userId, reason = 'removed', note = '') {
                if (userId) await sb.storage.from('avatars').remove([`${userId}/avatar.jpg`]).catch(() => {});
                const photos = must(await sb.rpc('admin_listing_photos', { p_member_id: id })) || [];
                if (photos.length) await sb.storage.from(PHOTO_BUCKET).remove(photos);
                const files = must(await sb.rpc('admin_begin_removal', { p_member_id: id })) || [];
                if (files.length) must(await sb.storage.from(BILL_BUCKET).remove(files));
                const docs = await sb.rpc('admin_removal_docs', { p_member_id: id }).then(r => r.data || []).catch(() => []);
                if (docs.length) await sb.storage.from('docs').remove(docs).catch(() => {});
                const r = await sb.rpc('admin_remove_member', { p_member_id: id, p_reason: reason, p_note: note || null });
                if (r.error && /function|schema cache/i.test(r.error.message)) return must(await sb.rpc('admin_remove_member', { p_member_id: id }));   /* before the archive update is installed */
                return must(r);
            },
            restore: async id => must(await sb.rpc('admin_restore_member', { p_member_id: id }))
        }
    };
}

/* ======================= Demo (sample data in this browser) ======================= */
function demoApi() {
    const KEY = 'rwb-app-demo-v2';
    const iso = d => d.toISOString().slice(0, 10);
    const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
    const today = new Date();
    const md = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return `1992-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    function seed() {
        const members = [
            { id: 1, full_name: 'Demo Rider', nickname: 'Demo', dob: '1994-03-12', phone: '9000000001', email: 'demo@example.com', vrn: 'WB 02 AB 1234', bike: 'TVS Ronin 225', blood_group: 'B+', locality: 'Salt Lake', hideout: 'Kolkata', emergency_phone: '9000000099', alt_phone: '', role: 'superadmin', user_id: 'me', joined_at: '2024-01-10' },
            { id: 2, full_name: 'Arjun Sen', nickname: 'Sultan', dob: md(0), phone: '9000000002', email: 'arjun@example.com', vrn: 'WB 06 CD 4567', bike: 'TVS Ronin 225', blood_group: 'O+', locality: 'Howrah', role: 'member', user_id: 'u2', joined_at: '2024-02-01' },
            { id: 3, full_name: 'Priya Dutta', nickname: '', dob: md(0), phone: '9000000003', email: 'priya@example.com', vrn: 'WB 20 EF 7890', bike: 'TVS Ronin 225', blood_group: 'A+', locality: 'Durgapur', role: 'coordinator', user_id: null, joined_at: '2024-03-15' },
            { id: 4, full_name: 'Rahul Ghosh', nickname: 'Rocket', dob: md(3), phone: '9000000004', email: 'rahul@example.com', vrn: 'WB 74 GH 1111', bike: 'TVS Ronin 225', blood_group: 'AB+', locality: 'Siliguri', role: 'admin', user_id: 'u4', joined_at: '2023-11-20' },
            { id: 5, full_name: 'Sourav Paul', nickname: '', dob: md(6), phone: '9000000005', email: 'sourav@example.com', vrn: 'WB 12 IJ 2222', bike: 'TVS Apache RTR 200 4V', blood_group: 'B-', locality: 'Barasat', role: 'member', user_id: null, joined_at: '2025-05-02' }
        ];
        const services = [
            { id: 1, service_date: daysAgo(210), odometer_km: 980, service_center: 'TVS Partner, Salt Lake', service_type: 'free', service_no: 1, items: ['Engine oil change', 'Oil filter', 'General check-up'], cost: 0, next_due_km: 4000, next_due_date: null, notes: '', bill_path: null },
            { id: 2, service_date: daysAgo(95), odometer_km: 4120, service_center: 'TVS Partner, Salt Lake', service_type: 'free', service_no: 2, items: ['Engine oil change', 'Chain clean & lube', 'Chain adjustment', 'General check-up'], cost: 450, next_due_km: 8000, next_due_date: daysAgo(-80), notes: 'Asked them to check the rear brake squeal.', bill_path: 'demo-bill' },
            { id: 3, service_date: daysAgo(12), odometer_km: 6850, service_center: 'Self', service_type: 'self', service_no: null, items: ['Chain clean & lube'], cost: 350, next_due_km: null, next_due_date: null, notes: 'Motul chain kit', bill_path: null }
        ];
        const fuel = []; let odo = 6000, id = 1;
        const fills = [[9.1, true], [4.0, false], [5.3, true], [9.6, true], [8.8, true], [10.2, true], [9.0, true]];
        const kmpl = [41.2, 0, 0, 43.0, 39.5, 42.4, 44.1];
        fills.forEach(([l, full], i) => {
            const dist = i === 0 ? 0 : i === 1 ? 160 : i === 2 ? Math.round(9.3 * 42.1 - 160) : Math.round(l * kmpl[i]);
            odo += dist;
            fuel.push({ id: id++, fill_date: daysAgo(70 - i * 10), odometer_km: odo, litres: l, amount: Math.round(l * 104.9), full_tank: full, trip_a_km: i === 0 ? null : full ? (i === 2 ? 392 : dist) : null, notes: '' });
        });
        const requests = [
            { id: 1, source: 'app', email: 'newrider@example.com', full_name: 'Kunal Das', phone: '9000000010', dob: '1998-08-21', vrn: 'WB 26 KL 3333', bike: 'TVS Ronin 225', blood_group: 'O+', locality: 'Kalyani', emergency_phone: '9000000077', created_at: daysAgo(1), match_member_id: null, match_name: null, match_linked: false, tnc: true, vrn_verified: false, on_app: true, check_entry: 'new', has_ronin: true, vrn_other: null },
            { id: 2, source: 'form', email: 'riya@example.com', full_name: 'Riya Basu', phone: '9000000011', dob: '1996-04-02', vrn: 'WB 02 AB 1234', bike: 'Royal Enfield Hunter', blood_group: 'A+', locality: 'Behala', emergency_phone: '9000000078', created_at: daysAgo(0), match_member_id: null, match_name: null, match_linked: false, tnc: true, vrn_verified: false, on_app: false, check_entry: 'new', has_ronin: false, vrn_other: 'Demo Rider' },
            { id: 3, source: 'form', email: '', full_name: 'Sourav Paul', phone: '9000000005', dob: '1993-02-10', vrn: 'WB 12 IJ 2222', bike: 'TVS Ronin 225', blood_group: 'B+', locality: 'Barasat', emergency_phone: '9000000079', created_at: daysAgo(0), match_member_id: 5, match_name: 'Sourav Paul', match_linked: false, match_status: 'active', member_since: '2025-03-14', tnc: null, vrn_verified: true, on_app: false, check_entry: 'existing', has_ronin: true, vrn_other: null }];
        const pic = (bg, label) => 'demo:data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="52%" text-anchor="middle" font-family="sans-serif" font-size="54" font-weight="700" fill="#fff">${label}</text></svg>`);
        const L = (id, o) => ({ id, user_id: 'u2', size: '', age: '', condition: 'Good', reason: '', details: '', seller_name: 'Arjun Sen', seller_phone: '9000000002', status: 'live', reject_reason: null, created_at: daysAgo(id), published_at: daysAgo(id), ...o });
        const listings = [
            L(1, { product_name: 'Axor Apex helmet', category: 'Helmet', size: 'L', age: '8 months', condition: 'Like new', reason: 'Upgraded to a modular', price: 4500, photos: [pic('#3d5a80', 'HELMET'), pic('#293241', 'SIDE')] }),
            L(2, { product_name: 'Rynox Stealth Evo jacket', category: 'Riding jacket', size: 'XL', age: '1 year', condition: 'Good', reason: 'Size does not fit anymore', price: 6200, photos: [pic('#6d597a', 'JACKET')], user_id: 'me', seller_name: 'Demo Rider', seller_phone: '9000000001' }),
            L(3, { product_name: 'Ronin 225 crash guard', category: 'Bike protection', age: '6 months', condition: 'Good', reason: 'Sold the bike', price: 1800, photos: [pic('#b56576', 'GUARD')], status: 'sold' }),
            L(4, { product_name: 'Phone mount with charger', category: 'Electronics', age: '3 months', condition: 'Like new', reason: 'Got a new one as a gift', price: 900, photos: [pic('#e56b6f', 'MOUNT')], status: 'pending', published_at: null, user_id: 'u4', seller_name: 'Rahul Ghosh', seller_phone: '9000000004' })
        ];
        const news = [
            { id: 1, kind: 'announcement', title: 'Sunday breakfast ride ☕', body: 'Meet at Nicco Park gate, 6:00 AM sharp. Route to Kolaghat. Full tank please!', url: '#news', audience: 'all', created_at: new Date(Date.now() - 36e5 * 5).toISOString() },
            { id: 2, kind: 'motomart', title: 'New on RWB Motomart', body: 'Axor Apex helmet · ₹4,500', url: '#motomart/1', audience: 'all', created_at: new Date(Date.now() - 36e5 * 26).toISOString() },
            { id: 3, kind: 'member', title: 'A new Ronin joined the app 🏍️', body: 'Say hello to Rahul Ghosh!', url: '#home', audience: 'all', created_at: new Date(Date.now() - 36e5 * 50).toISOString() }
        ];
        return { signedIn: false, members, services, fuel, requests, listings, news, nextId: 100 };
    }
    let db; try { db = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage blocked */ }
    if (!db) db = seed();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
    const clone = x => JSON.parse(JSON.stringify(x));
    const nid = () => ++db.nextId;
    const personOf = uidv => { const m = db.members.find(x => x.user_id === uidv) || {}; return { full_name: m.full_name || 'Rider', nickname: m.nickname || '', avatar_url: m.avatar_url || null }; };
    const me = () => db.members.find(m => m.user_id === 'me');
    const wait = (v) => new Promise(r => setTimeout(() => r(clone(v)), 120));
    const authFns = [];
    const isBirthday = (dob, d) => dob && dob.slice(5) === iso(d).slice(5);

    return {
        demo: true,
        session: async () => db.signedIn ? { email: 'demo@example.com', name: 'Demo Rider' } : null,
        onAuthChange: fn => authFns.push(fn),
        async signIn() { db.signedIn = true; save(); authFns.forEach(f => f('SIGNED_IN')); },
        async signOut() { db.signedIn = false; save(); authFns.forEach(f => f('SIGNED_OUT')); },
        resetDemo() { db = seed(); db.signedIn = true; save(); },

        linkAccount: () => wait('member'),
        requestAccess: () => wait('pending'),
        myRequest: () => wait(null),
        me: () => wait(me()),
        async updateMe(f) { Object.assign(me(), f); save(); return wait(me()); },
        async setAvatar(file) { me().avatar_url = file ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }) : null; save(); return wait(me()); },
        myBikes: () => wait((me().member_bikes || []).slice().sort((a, b) => a.slot - b.slot)),
        async saveBike(slot, vrn, model, mid = null) { const m = mid ? db.members.find(x => x.id === mid) : me(); m.member_bikes = (m.member_bikes || []).filter(b => b.slot !== slot); if (vrn) m.member_bikes.push({ slot, vrn: vrn.toUpperCase(), model: model || null, verified: false }); save(); return vrn ? 'saved' : 'removed'; },
        directory: () => wait(db.members.filter(m => !m.status || m.status === 'active').map(m => ({ id: m.id, full_name: m.full_name, nickname: m.nickname, avatar_url: m.avatar_url, bike: m.bike, vrn: m.vrn, vrn_verified: !!m.vrn_verified, bikes: m.member_bikes || null, locality: m.locality, role: m.role, phone: ['superadmin', 'admin', 'coordinator'].includes(m.role) ? m.phone : null, on_app: !!m.user_id, avg_kmpl: m.user_id === 'me' ? m.avg_kmpl : ({ 2: 41.9, 3: 44.6, 4: 36.8, 5: 38.2 })[m.id] ?? null })).sort((a, b) => a.full_name.localeCompare(b.full_name))),
        async boards() {
            const myKm = Math.max(0, me().odo_km || 0, ...db.fuel.map(f => f.odometer_km), ...db.services.map(x => x.odometer_km));
            const rows = [['Rahul Ghosh', 'Rocket', 18420, 36.8, 5, 'TVS Ronin 225'], ['Arjun Sen', 'Sultan', 11250, 41.9, 3, 'TVS Ronin 225'], ['Sourav Paul', '', 5310, 38.2, 1, 'TVS Apache RTR 200 4V'], ['Priya Dutta', '', 2400, 44.6, 2, 'TVS Ronin 225'], ['Kaustabh Roy', 'Pookie', 26100, 34.1, 7, 'TVS Ronin 225']]
                .map(([n, k, km, kmpl, sv, b], i) => ({ member_id: 100 + i, full_name: n, nickname: k, km, kmpl, services: sv, last_service: '2026-0' + (i + 3) + '-1' + i, bike: b, is_me: false }));
            if (me().show_on_leaderboard !== false) rows.push({ member_id: 1, full_name: me().full_name, nickname: me().nickname, avatar_url: me().avatar_url, km: myKm || null, kmpl: me().avg_kmpl ?? null, services: db.services.length, last_service: db.services.map(x => x.service_date).sort().at(-1) || null, bike: me().bike, is_me: true });
            return wait(rows);
        },
        async leaderboard() {
            const myKm = Math.max(0, me().odo_km || 0, ...db.fuel.map(f => f.odometer_km), ...db.services.map(x => x.odometer_km));
            const rows = [['Rahul Ghosh', 'Rocket', 18420, 'TVS Ronin 225'], ['Arjun Sen', 'Sultan', 11250, 'TVS Ronin 225'], ['Sourav Paul', '', 5310, 'TVS Apache RTR 200 4V']].map(([n, k, km, b]) => ({ full_name: n, nickname: k, km, bike: b, is_me: false }));
            if (me().show_on_leaderboard !== false) rows.push({ full_name: me().full_name, nickname: me().nickname, avatar_url: me().avatar_url, km: myKm, bike: me().bike, is_me: true });
            return wait(rows.sort((a, b) => b.km - a.km).map((r, i) => ({ ...r, rank: i + 1, member_id: i + 1 })));
        },
        async birthdays(days = 0) {
            const out = [];
            for (let i = 0; i <= days; i++) {
                const d = new Date(today); d.setDate(d.getDate() + i);
                db.members.filter(m => isBirthday(m.dob, d)).forEach(m => out.push({ member_id: m.id, full_name: m.full_name, nickname: m.nickname, day: iso(d), phone: m.phone, on_app: !!m.user_id }));
            }
            return wait(out);
        },

        centres: () => wait([...(db.centres ||= [['Seven Point Motors', '88 Park Street', '700017'], ['Shaw Wheels', 'Narayantala West, Baguiati', '700059'], ['Subir Udyog', '36 Chowringhee Road', '700071'], ['Radharani Auto Centre', 'Roy Bahadur Road, Behala', '700034'], ['Ashvavahan', 'Sector 5, Salt Lake', '700091']].map(([name, area, pincode], i) => ({ id: i + 1, name, area, pincode })))].sort((a, b) => a.name.localeCompare(b.name))),
        async addCentre(name, area, pincode) { const c = { id: nid(), name, area: area || null, pincode: pincode || null }; db.centres.push(c); save(); return c.id; },
        async deleteCentre(id) { db.centres = db.centres.filter(c => c.id !== id); save(); },
        services: () => wait([...db.services].sort((a, b) => b.service_date.localeCompare(a.service_date) || b.odometer_km - a.odometer_km)),
        async saveService(rec, file) {
            if (file) rec.bill_path = 'demo:' + await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
            if (rec.id) Object.assign(db.services.find(s => s.id === rec.id), rec); else db.services.push({ ...rec, id: nid() });
            save(); return wait(rec);
        },
        async deleteService(rec) { db.services = db.services.filter(s => s.id !== rec.id); save(); },
        async removeBill(rec) { const s = db.services.find(x => x.id === rec.id); s.bill_path = null; save(); return wait(s); },
        /* events (demo) */
        events() {
            if (!db.events) {
                const at = (d, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
                db.events = [
                    { id: 501, title: 'Sunday breakfast ride', description: 'Meet at Nicco Park gate. Full tank please! Route: Kolkata to Kolaghat and back.', starts_at: at(1, 6), ends_at: at(1, 11), location: 'Nicco Park, Salt Lake', map_url: null, call_link: null, reminder_minutes: 60, allow_guests: true, status: 'live', created_by: 'u4' },
                    { id: 502, title: 'Night ride to Princep Ghat', description: 'Easy city ride, chai at the end.', starts_at: at(9, 21, 30), ends_at: null, location: 'Princep Ghat', reminder_minutes: 60, allow_guests: false, status: 'live', created_by: 'u4' },
                    { id: 503, title: 'Mandarmani overnighter', description: 'Two days, one night by the sea.', starts_at: at(-12, 5), ends_at: at(-11, 18), location: 'Mandarmani', reminder_minutes: 1440, allow_guests: true, status: 'live', created_by: 'u4' }];
                db.rsvps = [{ event_id: 501, user_id: 'u2', status: 'going', guests: 0 }, { event_id: 501, user_id: 'u4', status: 'going', guests: 1 }, { event_id: 501, user_id: 'u5', status: 'maybe', guests: 0 },
                    { event_id: 503, user_id: 'me', status: 'going', guests: 0 }, { event_id: 503, user_id: 'u2', status: 'going', guests: 0 }, { event_id: 503, user_id: 'u4', status: 'going', guests: 1 }];
                db.expenses = [{ id: 601, event_id: 503, kind: 'expense', title: 'Hotel (2 rooms)', amount: 3200, paid_by: 'u4', split: [{ u: 'me', w: 1 }, { u: 'u2', w: 1 }, { u: 'u4', w: 2 }], created_by: 'u4', created_at: at(-12, 20) },
                    { id: 602, event_id: 503, kind: 'expense', title: 'Dinner', amount: 1440, paid_by: 'me', split: [{ u: 'me', w: 1 }, { u: 'u2', w: 1 }, { u: 'u4', w: 2 }], created_by: 'me', created_at: at(-12, 22) },
                    { id: 603, event_id: 503, kind: 'expense', title: 'Fuel top-up for the group', amount: 600, paid_by: 'u2', split: [{ u: 'me', w: 1 }, { u: 'u2', w: 1 }], created_by: 'u2', created_at: at(-11, 9) }];
                save();
            }
            return wait([...db.events].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
        },
        eventCounts() {
            const out = {}; for (const r of db.rsvps || []) { const o = out[r.event_id] ||= { event_id: r.event_id, going: 0, maybe: 0, guests: 0, faces: [] }; if (r.status === 'going') { o.going++; o.guests += r.guests; if (o.faces.length < 4) o.faces.push({ full_name: personOf(r.user_id).full_name, avatar_url: personOf(r.user_id).avatar_url }); } if (r.status === 'maybe') o.maybe++; }
            return wait(Object.values(out));
        },
        myRsvps: () => wait((db.rsvps || []).filter(r => r.user_id === 'me')),
        eventPeople: id => wait((db.rsvps || []).filter(r => r.event_id === id).map(r => ({ ...personOf(r.user_id), user_id: r.user_id, status: r.status, guests: r.guests }))),
        async rsvp(eventId, status, guests = 0) { db.rsvps ||= []; const e = db.events.find(x => x.id === eventId); if (!e.allow_guests || status !== 'going') guests = 0; const r = db.rsvps.find(x => x.event_id === eventId && x.user_id === 'me'); if (r) Object.assign(r, { status, guests }); else db.rsvps.push({ event_id: eventId, user_id: 'me', status, guests }); save(); return wait({ status, guests }); },
        async saveEvent(rec) { let row; if (rec.id) { row = db.events.find(e => e.id === rec.id); Object.assign(row, rec); } else { row = { status: 'live', ...rec, id: nid(), created_by: 'me' }; db.events.push(row); } save(); return wait(row); },
        async deleteEvent(id) { db.events = db.events.filter(e => e.id !== id); save(); },
        expenses: id => wait((db.expenses || []).filter(x => x.event_id === id)),
        async saveExpense(rec) { db.expenses ||= []; if (rec.id) Object.assign(db.expenses.find(x => x.id === rec.id), rec); else db.expenses.push({ ...rec, id: nid(), created_by: 'me', created_at: new Date().toISOString() }); save(); return wait(rec); },
        async deleteExpense(id) { db.expenses = db.expenses.filter(x => x.id !== id); save(); },

        docs: () => wait([...(db.docs ||= [])]),
        async saveDoc(rec, add = [], drop = []) {
            const files = (rec.files || []).filter(f => !drop.includes(f));
            for (const f of add) files.push('demo:' + await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }));
            db.docs ||= [];
            const row = { ...rec, files };
            if (rec.id) Object.assign(db.docs.find(d => d.id === rec.id), row); else db.docs.push({ ...row, id: nid() });
            save(); return wait(row);
        },
        async deleteDoc(rec) { db.docs = db.docs.filter(d => d.id !== rec.id); save(); },
        docUrl: async path => path.slice(5),
        billUrl: async path => path.startsWith('demo:') ? path.slice(5) : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="80" font-family="sans-serif" font-size="32">Sample bill</text><text x="40" y="140" font-family="sans-serif" font-size="20" fill="#666">Your uploaded bill shows here.</text></svg>'),

        fuel: () => wait([...db.fuel].sort((a, b) => a.odometer_km - b.odometer_km || a.fill_date.localeCompare(b.fill_date))),
        async saveFuel(rec) { if (rec.id) Object.assign(db.fuel.find(s => s.id === rec.id), rec); else db.fuel.push({ ...rec, id: nid() }); save(); return wait(rec); },
        async deleteFuel(rec) { db.fuel = db.fuel.filter(s => s.id !== rec.id); save(); },

        myId: async () => 'me',
        listings: () => wait([...db.listings].filter(l => ['live', 'sold'].includes(l.status) || l.user_id === 'me' || ['coordinator', 'admin', 'superadmin'].includes(me().role)).sort((a, b) => String(b.published_at || '9').localeCompare(String(a.published_at || '9')))),
        photoUrl: path => path.startsWith('demo:') ? path.slice(5) : path,
        async saveListing(rec, newFiles = [], removed = []) {
            const added = await Promise.all(newFiles.map(f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r('demo:' + fr.result); fr.readAsDataURL(f); })));
            const photos = [...(rec.photos || []).filter(p => !removed.includes(p)), ...added];
            if (rec.id) { const l = db.listings.find(x => x.id === rec.id); Object.assign(l, rec, { photos }); if (l.status === 'rejected') l.status = 'pending'; }
            else db.listings.push({ ...rec, photos, id: nid(), user_id: 'me', status: 'pending', created_at: new Date().toISOString(), published_at: null });
            save(); return wait(rec);
        },
        async setListingStatus(id, status, reason = null) { const l = db.listings.find(x => x.id === id); if (status === 'live' && !l.published_at) l.published_at = new Date().toISOString(); Object.assign(l, { status, reject_reason: reason }); save(); return wait(l); },
        async deleteListing(rec) { db.listings = db.listings.filter(l => l.id !== rec.id); save(); },
        news: () => wait([...db.news].sort((a, b) => b.created_at.localeCompare(a.created_at))),
        async announce(title, body) { db.news.push({ id: nid(), kind: 'announcement', title, body, url: '#news', audience: 'all', created_at: new Date().toISOString() }); save(); },
        async deleteNews(id) { db.news = db.news.filter(n => n.id !== id); save(); },
        savePush: async () => 'saved', deletePush: async () => 'deleted',
        async ask(messages) {
            await new Promise(r => setTimeout(r, 700));
            const q = messages.at(-1).text.toLowerCase();
            const reply = /chain/.test(q) ? 'For the Ronin 225 chain:\n\n1. **Clean** it every 500–700 km (sooner after rain) with a chain cleaner and brush.\n2. **Dry** it, then **lube** the inner side of the rollers while turning the wheel.\n3. Let it sit 15–20 minutes before riding.\n\nCheck the slack too. If it looks loose or kinked, get it adjusted at a service centre.'
                : '*(Demo mode: this is a sample answer.)*\n\nOnce Pookie is connected, I can help with your Ronin 225, maintenance, riding tips and using the RWB App.';
            db.chatLeft = (db.chatLeft ?? 20) - 1; save();
            const onText = arguments[3]; let shown = '';
            for (const w of reply.split(/(?<= )/)) { shown += w; onText?.(shown); await new Promise(r => setTimeout(r, 25)); }
            return { reply, left: db.chatLeft };
        },
        diagnoseAI: async () => ['version demo', 'settings: OK (demo mode)', 'test answer: "OK"'],
        chatNotes: async () => db.chatNotes || '', async saveChatNotes(n) { db.chatNotes = n; save(); },
        async testPush() { db.news.push({ id: nid(), kind: 'admin', title: 'Test notification ✅', body: 'Push notifications are working on this phone.', url: '#news', audience: 'admins', created_at: new Date().toISOString() }); save(); },

        admin: {
            stats: () => wait({ members: db.members.length, on_app: db.members.filter(m => m.user_id).length, pending: db.requests.length, admins: db.members.filter(m => m.role !== 'member').length }),
            requests: () => wait(db.requests),
            async approve(id) {
                const r = db.requests.find(x => x.id === id);
                db.members.push({ id: nid(), full_name: r.full_name, phone: r.phone, email: r.email, dob: r.dob, vrn: r.vrn, locality: r.locality, role: 'member', user_id: 'u' + id, joined_at: iso(today) });
                db.requests = db.requests.filter(x => x.id !== id); save(); return 'approved';
            },
            async reject(id) { db.requests = db.requests.filter(x => x.id !== id); save(); return 'rejected'; },
            async setReqVrn(id, v) { const r = db.requests.find(x => x.id === id); if (r) r.vrn_verified = v; save(); return v; },
            async setVrnVerified(mid, slot, v) { const m = db.members.find(x => x.id === mid); if (slot === 1) m.vrn_verified = v; else { const b = (m.member_bikes || []).find(x => x.slot === slot); if (b) b.verified = v; } save(); return v; },
            members: () => wait([...db.members].sort((a, b) => a.full_name.localeCompare(b.full_name))),
            async update(id, p) { Object.assign(db.members.find(m => m.id === id), p); save(); return 'saved'; },
            async setRole(id, role) { db.members.find(m => m.id === id).role = role; save(); return role; },
            async remove(id, userId, reason = 'removed', note = '') {
                const m = db.members.find(x => x.id === id);
                if (m.role === 'superadmin') throw new Error('The super admin cannot be removed');
                Object.assign(m, { status: reason, removed_at: new Date().toISOString(), removed_by: me().nickname || me().full_name, removed_note: note || null, user_id: null, role: 'member' }); save(); return reason;
            },
            async restore(id) { Object.assign(db.members.find(x => x.id === id), { status: 'active', removed_at: null, removed_by: null, removed_note: null, joined_at: new Date().toISOString() }); save(); return 'restored'; }
        }
    };
}
