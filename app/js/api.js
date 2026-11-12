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
    let midCache = null;   /* [user id, member id] */
    const myMemberId = async () => { const u = await uid(); if (midCache?.[0] !== u) midCache = [u, must(await sb.from('members').select('id').eq('user_id', u).single()).id]; return midCache[1]; };

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
            const cap = window.Capacitor;
            if (cap?.isNativePlatform?.()) {
                /* RWB Android app from build 20: Android's own Google account sheet ("Sign in to RWB App"), no browser.
                   Falls back to the browser below if it isn't set up yet, or on an older app. */
                const gid = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GOOGLE_WEB_CLIENT_ID : '';
                if (gid) {
                    try {
                        const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
                        const hashed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, '0')).join('');
                        const r = await cap.registerPlugin('RwbTrack').googleSignIn({ clientId: gid, nonce: hashed });
                        const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: r.idToken, nonce: raw });
                        if (error) throw error;
                        return;
                    } catch (e) {
                        /* anything that went wrong (even a "cancelled" that Android reports when Google isn't set up yet):
                           sign in through the browser instead, so nobody is ever stuck on this screen */
                        try { localStorage.setItem('rwb-gsheet-err', `${new Date().toISOString()} ${e?.code || ''} ${e?.message || e}`); } catch { /* ignore */ }
                        console.warn('Google sheet sign-in failed, using the browser:', e?.code, e?.message || e);
                    }
                }
                /* RWB Android app: Google doesn't allow sign-in inside apps' web views, so it opens in the browser
                   and comes back through in.roninwb.twa://auth (handled by finishNativeSignIn) */
                const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'in.roninwb.twa://auth', skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
                if (error) throw friendly(error);
                await cap.registerPlugin('Browser').open({ url: data.url, windowName: '_self' });
                return;
            }
            const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
            if (error) throw friendly(error);
        },
        async finishNativeSignIn(url) {
            const u = new URL(url.replace('in.roninwb.twa://', 'https://x/')), code = u.searchParams.get('code');
            const h = new URLSearchParams(u.hash.slice(1)), err = u.searchParams.get('error_description') || h.get('error_description');
            if (err) throw new Error(err);
            if (code) { const { error } = await sb.auth.exchangeCodeForSession(code); if (error) throw friendly(error); }
            else if (h.get('access_token')) { const { error } = await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') }); if (error) throw friendly(error); }
        },
        saveFcm: async token => must(await sb.rpc('save_fcm_token', { p_token: token })),
        deleteFcm: async token => must(await sb.rpc('delete_fcm_token', { p_token: token })),
        async signOut() { await sb.auth.signOut(); },

        linkAccount: async () => must(await sb.rpc('link_account')),
        joinForm: async () => must(await sb.rpc('join_form')),
        vrnHint: async (vrn, phone) => { const r = await sb.rpc('vrn_hint', { p_vrn: vrn, p_phone: phone || null }); return r.error ? null : r.data; },
        settings: async () => { const r = await sb.rpc('app_settings'); return r.error ? {} : r.data; },
        myPrefill: async () => must(await sb.rpc('my_prefill')),
        /* filtered to my own member id: admins can read everyone's rows */
        myChanges: async () => must(await sb.from('change_requests').select('kind, slot, new_value, new_model, status, reject_reason, created_at, decided_at').eq('member_id', await myMemberId()).order('created_at', { ascending: false }).limit(20)),
        async requestChange(kind, value, slot = null, model = null) {
            const r = await sb.rpc('request_change', { p_kind: kind, p_value: value ?? '', p_slot: slot, p_model: model });
            if (r.error && /could not find|function/i.test(r.error.message || '')) {   /* before setup file 30: the old way */
                if (kind === 'vrn') return must(await sb.from('members').update({ vrn: value, bike: model }).eq('user_id', await uid()).select().single()) && 'saved';
                throw new Error('Please ask an RWB admin to change this for now.');
            }
            return must(r);
        },
        async requestAccess(f) {
            const args = { p_full_name: f.full_name, p_phone: f.phone, p_dob: f.dob || null, p_vrn: f.vrn || null, p_locality: f.locality || null, p_bike: f.bike || null, p_blood_group: f.blood_group || null, p_hideout: f.hideout || null, p_emergency_phone: f.emergency_phone || null, p_alt_phone: f.alt_phone || null };
            let r = await sb.rpc('request_access', { ...args, p_tnc: !!f.tnc, p_answers: f.answers || null });
            if (r.error && /could not find|function/i.test(r.error.message || '')) r = await sb.rpc('request_access', { ...args, p_tnc: !!f.tnc });
            /* database not updated yet (before setup file 29): send it the old way */
            if (r.error && /could not find|function/i.test(r.error.message || '')) return must(await sb.rpc('request_access', args));
            return must(r);
        },
        myRequest: async () => must(await sb.from('link_requests').select('*').eq('user_id', await uid()).order('created_at', { ascending: false }).limit(1).maybeSingle()),
        me: async () => must(await sb.from('members').select('*').eq('user_id', await uid()).single()),
        updateMe: async f => must(await sb.from('members').update(f).eq('user_id', await uid()).select().single()),
        async setAvatar(file) {   /* file = small square JPEG, or null to remove */
            const me = await uid(), path = `${me}/avatar.jpg`;
            if (!file) { await sb.storage.from('avatars').remove([path]); return must(await sb.from('members').update({ avatar_url: null }).eq('user_id', me).select().single()); }
            must(await sb.storage.from('avatars').upload(path, file, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' }));
            const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
            return must(await sb.from('members').update({ avatar_url: url }).eq('user_id', me).select().single());
        },
        birthdays: async (days = 0) => must(await sb.rpc('birthdays', { p_days: days })),
        directory: async () => must(await sb.rpc('member_directory')),
        setSharing: async p => must(await sb.rpc('set_my_sharing', { p })),
        vrnCheck: async v => must(await sb.rpc('vrn_check', { p_vrn: v })),
        /* setup file 56: member or not + the name partly hidden + area; null when that file isn't run yet */
        async vrnInfo(v) { const r = await sb.rpc('vrn_check_info', { p_vrn: v }); if (r.error) { if (/could not find|function/i.test(r.error.message || '')) return null; throw new Error(r.error.message); } return r.data; },
        agreeTnc: async () => { const r = await sb.rpc('agree_tnc'); if (r.error && /could not find|function/i.test(r.error.message || '')) return must(await sb.rpc('request_change', { p_kind: 'tnc', p_value: 'agree' })); return must(r); },
        withdrawTnc: async () => { const r = await sb.rpc('withdraw_tnc'); if (r.error && /could not find|function/i.test(r.error.message || '')) return must(await sb.rpc('request_change', { p_kind: 'tnc', p_value: 'disagree' })); return must(r); },
        leaveRwb: async note => must(await sb.rpc('leave_rwb', { p_note: note || null })),
        deleteMyAccount: async reason => must(await sb.rpc('delete_my_account', { p_reason: reason || null })),
        rwbAdmins: async () => must(await sb.rpc('rwb_admins')),
        joinHelpAdmins: async () => must(await sb.rpc('join_help_admins')),
        async trackStart(lat, lng, acc, hours, eventId, note) {
            const args = { p_lat: lat, p_lng: lng, p_acc: acc, p_hours: hours, p_event: eventId || null };
            let r = await sb.rpc('track_start', { ...args, p_note: note || null });
            if (r.error && /function|schema cache|p_note/i.test(r.error.message || '')) r = await sb.rpc('track_start', args);   /* before setup file 45 */
            return must(r);
        },
        /* RWB FAM */
        famMe: async () => must(await sb.rpc('fam_me')),
        famInviteInfo: async code => must(await sb.rpc('fam_invite_info', { p_code: code })),
        myFam: async () => must(await sb.rpc('my_fam')),
        removeFam: async id => must(await sb.rpc('remove_fam', { p_id: id })),
        famJoin: async (code, name, phone, address, agree) => must(await sb.rpc('fam_join', { p_code: code, p_name: name, p_phone: phone || null, p_address: address || null, p_agree: !!agree })),
        famUpdate: async (name, phone, address) => must(await sb.rpc('fam_update', { p_name: name, p_phone: phone || null, p_address: address || null })),
        famSetApproved: async ok => must(await sb.rpc('fam_set_approved', { p_ok: !!ok })),
        famAlert: async () => must(await sb.rpc('fam_alert_admins')),
        adminFamList: async () => must(await sb.rpc('admin_fam_list')),
        trackPing: async (lat, lng, acc, spd, hdg) => must(await sb.rpc('track_ping', { p_lat: lat, p_lng: lng, p_acc: acc, p_spd: spd, p_hdg: hdg })),
        trackStop: async () => must(await sb.rpc('track_stop')),
        trackView: async () => must(await sb.rpc('track_view')),
        trackToken: async () => must(await sb.rpc('track_token')),
        trackSos: async (lat, lng, acc) => must(await sb.rpc('track_sos', { p_lat: lat, p_lng: lng, p_acc: acc })),
        trackSosResolve: async id => must(await sb.rpc('track_sos_resolve', { p_id: id })),
        gpsBoard: async () => must(await sb.rpc('gps_board')),
        pookieBoard: async () => must(await sb.rpc('pookie_board')),   /* setup file 59 */
        appSeen: async (copy, build) => { const r = await sb.rpc('app_seen_ping', { p_copy: copy, p_build: build || null }); if (r.error) throw new Error(r.error.message); },   /* setup file 60; quietly ignored before it's run */
        findMyEmail: async (phone, vrn) => must(await sb.rpc('find_my_email', { p_phone: phone, p_vrn: vrn })),
        claimMembership: async (phone, vrn, dob) => must(await sb.rpc('claim_membership', { p_phone: phone, p_vrn: vrn, p_dob: dob })),
        updateMyAnswers: async answers => { const r = await sb.rpc('update_my_answers', { p_answers: answers }); if (r.error && /could not find|function/i.test(r.error.message || '')) throw new Error('Please ask an RWB admin to run setup file 32 first.'); return must(r); },
        myBikes: async () => must(await sb.from('member_bikes').select('slot, vrn, model, verified').eq('member_id', await myMemberId()).order('slot')),
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
            const { id, created_by, created_at, updated_at, reminded_at, source_key, ...row } = rec;
            const go = r => id ? sb.from('events').update(r).eq('id', id).select().single() : sb.from('events').insert(r).select().single();
            let res = await go(row);
            if (res.error && /tag|capacity|on_website/.test(res.error.message || '')) { const { tag, capacity, on_website, ...old } = row; res = await go(old); }   /* before setup file 38 */
            return must(res);
        },
        importEvents: async rows => must(await sb.rpc('admin_import_events', { p_rows: rows })),
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

        /* Calendar (setup file 62): the member's own reminders, and the service / part due dates the database sends
           morning notifications for. myReminders is null when that file isn't run yet. */
        async myReminders() { const r = await sb.from('my_reminders').select('*').eq('source', 'custom').order('due_date'); if (r.error) { if (/relation|does not exist|schema cache/i.test(r.error.message || '')) return null; throw friendly(r.error); } return r.data; },
        async saveReminder(rec) { const { id, ...v } = rec; v.updated_at = new Date().toISOString(); return must(id ? await sb.from('my_reminders').update(v).eq('id', id).select().single() : await sb.from('my_reminders').insert({ ...v, source: 'custom' }).select().single()); },
        deleteReminder: async id => must(await sb.from('my_reminders').delete().eq('id', id)),
        async syncReminders(items) { const r = await sb.rpc('sync_my_reminders', { p_items: items }); if (r.error) { if (/function|schema cache|does not exist/i.test(r.error.message || '')) return null; throw friendly(r.error); } return r.data; },

        /* My Ride (setup file 57): parts and accessories; null when that file isn't run yet */
        async rideParts() { const r = await sb.from('ride_parts').select('*').order('installed_km', { ascending: false, nullsFirst: false }); if (r.error) { if (/relation|does not exist|schema cache/i.test(r.error.message || '')) return null; throw new Error(r.error.message); } return r.data; },
        async saveRidePart(rec) { const { id, ...v } = rec; v.updated_at = new Date().toISOString(); return must(id ? await sb.from('ride_parts').update(v).eq('id', id).select().single() : await sb.from('ride_parts').insert(v).select().single()); },
        deleteRidePart: async id => must(await sb.from('ride_parts').delete().eq('id', id)),
        async rideName() { const r = await sb.from('ride_profile').select('name').maybeSingle(); return r.error ? null : r.data?.name || ''; },
        saveRideName: async name => must(await sb.from('ride_profile').upsert({ name, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })),
        fuel: async () => must(await sb.from('fuel_logs').select('*').order('odometer_km', { ascending: true }).order('fill_date', { ascending: true })),
        async saveFuel(rec) {
            const { id, user_id, created_at, ...row } = rec;
            return id ? must(await sb.from('fuel_logs').update(row).eq('id', id).select().single())
                      : must(await sb.from('fuel_logs').insert(row).select().single());
        },
        deleteFuel: async rec => must(await sb.from('fuel_logs').delete().eq('id', rec.id)),

        /* ---- MotoMart ---- */
        myId: uid,
        listings: async () => must(await sb.from('listings').select('*').order('published_at', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false })),
        photoUrl: path => sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
        async saveListing(rec, newFiles = [], removed = []) {
            const me = await uid(), added = [];
            try {
                for (const f of newFiles) {
                    const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
                    must(await sb.storage.from(PHOTO_BUCKET).upload(path, f, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }));
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
        /* Teach Pookie (setup file 56) */
        teach: {
            next: async skip => must(await sb.rpc('teach_next', { p_skip: skip || [] })),
            answer: async (qid, text) => must(await sb.rpc('teach_answer', { p_qid: qid, p_answer: text })),
            stats: async () => must(await sb.rpc('teach_stats')),
        },
        /* ---- Guides (setup file 66 + the guides-media function: files live on GitHub, served by jsDelivr) ---- */
        async guideItems() {
            const r = await sb.from('guide_items').select('*').order('created_at', { ascending: false }).limit(1000);
            if (r.error) { if (/guide_items|does not exist|schema cache/i.test(r.error.message || '')) return null; throw friendly(r.error); }   /* null: file 66 not run yet */
            return r.data;
        },
        guideCats: async () => { const r = await sb.rpc('guide_my_cats'); return r.error ? [] : r.data || []; },
        guideEdit: async (id, f) => must(await sb.rpc('guide_edit', { p_id: id, p_title: f.title, p_description: f.description || null, p_tags: f.tags || null })),
        async guideOp(op, extra = {}) {
            const token = (await sb.auth.getSession()).data.session?.access_token;
            const r = await fetch(url + '/functions/v1/guides-media', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + token }, body: JSON.stringify({ op, ...extra }) })
                .catch(() => { throw new Error('No internet connection. Please try again.'); });
            const b = await r.json().catch(() => ({ error: r.status === 404 ? 'Uploads are being set up. Please try again later.' : `Something went wrong. Please try again in a minute.` }));
            if (b.error) throw new Error(b.error); return b;
        },
        guideStatus() { return this.guideOp('status'); },
        guideDelete(item) { return this.guideOp('delete', { id: item.id }); },
        /* sends the file with a progress callback (fetch can't report upload progress) */
        async guideUpload(meta, file, thumb, onProgress) {
            const token = (await sb.auth.getSession()).data.session?.access_token;
            const fd = new FormData(); fd.append('op', 'upload'); fd.append('meta', JSON.stringify(meta)); fd.append('file', file, file.name || 'file');
            if (thumb) fd.append('thumb', thumb, 'thumb.jpg');
            return await new Promise((resolve, reject) => {
                const x = new XMLHttpRequest();
                x.open('POST', url + '/functions/v1/guides-media');
                x.setRequestHeader('apikey', key); x.setRequestHeader('Authorization', 'Bearer ' + token);
                x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
                x.upload.onload = () => onProgress?.(1);
                x.onload = () => { let b = {}; try { b = JSON.parse(x.responseText); } catch { /* below */ }
                    if (x.status >= 200 && x.status < 300 && b.item) resolve(b.item);
                    else reject(new Error(b.error || (x.status === 404 ? 'Uploads are being set up. Please try again later.' : x.status === 413 ? 'That file is too big to send.' : `Upload failed (HTTP ${x.status}). Please try again.`))); };
                x.onerror = () => reject(new Error('The upload stopped. Check your internet and try again.'));
                x.ontimeout = () => reject(new Error('The upload took too long. Try again on Wi-Fi.'));
                x.timeout = 10 * 60e3;
                x.send(fd);
            });
        },
        async pookieOp(op, extra = {}) {
            const token = (await sb.auth.getSession()).data.session?.access_token;
            const r = await fetch(url + '/functions/v1/ask-ronin', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + token }, body: JSON.stringify({ op, ...extra }) });
            const b = await r.json().catch(() => ({ error: `The Pookie function answered HTTP ${r.status}. Deploy the latest ask-ronin.` }));
            if (b.error) throw new Error(b.error); return b;
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

        /* report a MotoMart post or a member's profile to the RWB team / Grievance Officer (setup file 55) */
        async report(kind, ref, label, reason, details) {
            const r = await sb.rpc('report_content', { p_kind: kind, p_ref: String(ref ?? ''), p_label: label || '', p_reason: reason, p_details: details || null });
            if (r.error && /could not find|function/i.test(r.error.message || '')) throw new Error('Reporting isn\'t set up yet. Please message an admin or email ronin.warriors.bengal@gmail.com.');
            return must(r);
        },
        admin: {
            sheetSync: async () => must(await sb.rpc('admin_sheet_sync')),
            async appCopies() { const r = await sb.rpc('admin_app_copies'); if (r.error) { if (/could not find the function|PGRST202/i.test((r.error.message || '') + (r.error.code || ''))) { window.rwbCopiesWhy = `${r.error.code || ''} ${r.error.message || ''}`.trim(); return null; } throw new Error(r.error.message); } return r.data; },
            async sheetSyncStatus() { const r = await sb.rpc('admin_sheet_sync_status'); if (r.error) { if (/could not find|function/i.test(r.error.message || '')) return null; throw new Error(r.error.message); } return r.data; },
            teachQueue: async () => must(await sb.rpc('admin_teach_queue')),
            /* answers waiting in Teach Pookie (setup file 61; falls back to the queue on older setups) */
            async pookiePending() { const r = await sb.rpc('admin_pookie_pending'); if (!r.error) return r.data || 0; const q = await sb.rpc('admin_teach_queue'); return q.error ? 0 : (q.data || []).length; },
            teachReview: async (id, ok, text) => must(await sb.rpc('admin_teach_review', { p_id: id, p_ok: ok, p_text: text || null })),
            pookieKnowledge: async () => must(await sb.rpc('admin_pookie_knowledge')),
            pookieForget: async id => must(await sb.rpc('admin_pookie_forget', { p_id: id })),
            pookieAddQuestions: async rows => must(await sb.rpc('admin_pookie_add_questions', { p: rows })),
            stats: async () => must(await sb.rpc('admin_stats')),
            async reports() { const r = await sb.rpc('admin_reports'); if (r.error) { if (/could not find|function/i.test(r.error.message || '')) return null; throw new Error(r.error.message); } return r.data || []; },
            reportDone: async (id, outcome) => must(await sb.rpc('admin_report_done', { p_id: id, p_outcome: outcome })),
            /* duplicates found in the RWB contact sheet (setup file 49); [] until that file is run */
            async dupes() { const r = await sb.rpc('admin_dupes'); if (r.error) { if (/could not find|function/i.test(r.error.message || '')) return []; throw new Error(r.error.message); } return r.data || []; },
            resolveDupe: async (key, remove, ignore = false) => must(await sb.rpc('admin_resolve_dupe', { p_key: key, p_remove: remove || [], p_ignore: !!ignore })),
            async requests() {
                const list = must(await sb.rpc('admin_list_requests'));
                /* when each entry was last changed by the person (setup file 31) */
                let u = await sb.from('link_requests').select('id, updated_at, checks').eq('status', 'pending');
                if (u.error) u = await sb.from('link_requests').select('id, updated_at').eq('status', 'pending');
                if (!u.error) { const m = new Map(u.data.map(x => [x.id, x])); list.forEach(r => { const x = m.get(r.id) || {}; r.updated_at = x.updated_at || null; r.checks = x.checks || {}; }); }
                return list;
            },
            approve: async id => must(await sb.rpc('admin_approve_request', { p_request_id: id })),
            async reject(id, reason = '') {
                const r = await sb.rpc('admin_reject_request', { p_request_id: id, p_reason: reason || null });
                if (r.error && /could not find|function/i.test(r.error.message || '')) return must(await sb.rpc('admin_reject_request', { p_request_id: id }));
                return must(r);
            },
            changes: async () => must(await sb.rpc('admin_list_changes')),
            incomplete: async () => must(await sb.rpc('admin_incomplete')),
            setCheck: async (id, check, value) => must(await sb.rpc('admin_set_request_check', { p_id: id, p_check: check, p_value: value })),
            setSetting: async (key, value) => must(await sb.rpc('admin_set_setting', { p_key: key, p_value: value || '' })),
            remindIncomplete: async () => must(await sb.rpc('remind_incomplete', { p_force: false })),
            markReminded: async id => must(await sb.rpc('admin_mark_reminded', { p_member_id: id })),
            setTnc: async (id, v) => must(await sb.rpc('admin_set_tnc', { p_member_id: id, p_agreed: v })),
            setChangeVrn: async (id, v) => must(await sb.rpc('admin_set_change_vrn', { p_id: id, p_verified: v })),
            decideChange: async (id, ok, reason = '') => must(await sb.rpc('admin_decide_change', { p_id: id, p_approve: ok, p_reason: reason || null })),
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
            { id: 3, source: 'app', email: 'sourav.p@gmail.com', full_name: 'Sourav Paul', phone: '9000000005', dob: '1993-02-10', vrn: 'WB 12 IJ 2222', bike: 'TVS Ronin 225', blood_group: 'B+', locality: 'Barasat', emergency_phone: '9000000079', created_at: daysAgo(0), match_member_id: 5, match_name: 'Sourav Paul', match_linked: false, match_status: 'active', member_since: '2025-03-14', tnc: null, member_tnc: true, vrn_verified: false, vrn_known: true, member_vrn: 'WB 12 IJ 2222', on_app: true, check_entry: 'existing', has_ronin: true, vrn_other: null }];
        const pic = (bg, label) => 'demo:data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="52%" text-anchor="middle" font-family="sans-serif" font-size="54" font-weight="700" fill="#fff">${label}</text></svg>`);
        const L = (id, o) => ({ id, user_id: 'u2', size: '', age: '', condition: 'Good', reason: '', details: '', seller_name: 'Arjun Sen', seller_phone: '9000000002', status: 'live', reject_reason: null, created_at: daysAgo(id), published_at: daysAgo(id), ...o });
        const listings = [
            L(1, { product_name: 'Axor Apex helmet', category: 'Helmet', size: 'L', age: '8 months', condition: 'Like new', reason: 'Upgraded to a modular', price: 4500, photos: [pic('#3d5a80', 'HELMET'), pic('#293241', 'SIDE')] }),
            L(2, { product_name: 'Rynox Stealth Evo jacket', category: 'Riding jacket', size: 'XL', age: '1 year', condition: 'Good', reason: 'Size does not fit anymore', price: 6200, photos: [pic('#6d597a', 'JACKET')], user_id: 'me', seller_name: 'Demo Rider', seller_phone: '9000000001' }),
            L(3, { product_name: 'Ronin 225 crash guard', category: 'Bike protection', age: '6 months', condition: 'Good', reason: 'Sold the bike', price: 1800, photos: [pic('#b56576', 'GUARD')], status: 'sold' }),
            L(4, { product_name: 'Phone mount with charger', category: 'Electronics', age: '3 months', condition: 'Like new', reason: 'Got a new one as a gift', price: 900, photos: [pic('#e56b6f', 'MOUNT')], status: 'pending', published_at: null, user_id: 'u4', seller_name: 'Rahul Ghosh', seller_phone: '9000000004' }),
            L(5, { product_name: 'Rynox gloves, size M', category: 'Gloves', age: '1 month', condition: 'Like new', reason: 'Wrong size', price: 1400, photos: [pic('#5c677d', 'GLOVES')], status: 'sold', sold_at: daysAgo(3) }),
            ...[['Mototorque crash guard for Ronin', 'Protection', 4700, '#1d3557', 'GUARD'], ['Bobo phone mount with charger', 'Navigation', 2199, '#2a9d8f', 'MOUNT'], ['Mototorque bash plate', 'Protection', 1300, '#264653', 'BASH'],
                ['Mototorque rear rack', 'Luggage Option', 4900, '#6c584c', 'RACK'], ['Mototorque saddle stays', 'Luggage Option', 4000, '#7f5539', 'STAYS'], ['Mototorque side stand extender', 'Protection', 450, '#3a5a40', 'STAND']]
                .map(([n, c, p, bg, t], i) => L(10 + i, { kind: 'new', product_name: n, category: c, price: p, link: 'https://mototorque.in/', photos: [pic(bg, t)], user_id: 'me', seller_name: null, seller_phone: null, condition: null })),
            L(20, { kind: 'merch', product_name: 'RWB Jersey (Wanderer)', category: 'Clothing', price: 999, details: 'Essence of Light tone with silhouette adventure print.', photos: [pic('#d4501a', 'JERSEY')], user_id: 'me', seller_name: 'Demo Rider', seller_phone: '9000000001', condition: null }),
            L(21, { kind: 'merch', product_name: 'RWB Sticker (Special Edition)', category: 'Stickers', price: 50, details: '3D embossed matte & glossy waterproof.', photos: [pic('#111111', 'STICKER')], user_id: 'me', seller_name: null, seller_phone: null, condition: null, status: 'sold', sold_at: daysAgo(30) })
        ];
        const news = [
            { id: 1, kind: 'announcement', title: 'Sunday breakfast ride ☕', body: 'Meet at Nicco Park gate, 6:00 AM sharp. Route to Kolaghat. Full tank please!', url: '#news', audience: 'all', created_at: new Date(Date.now() - 36e5 * 5).toISOString() },
            { id: 2, kind: 'motomart', title: 'New on RWB MotoMart', body: 'Axor Apex helmet · ₹4,500', url: '#motomart/1', audience: 'all', created_at: new Date(Date.now() - 36e5 * 26).toISOString() },
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
    const firstOf = m => (m.nickname || m.full_name).split(' ')[0];
    const demoFam = () => { try { return localStorage.getItem('rwb-demo-fam') === '1'; } catch { return false; } };
    const STAFF = ['superadmin', 'admin', 'coordinator'], nk = x => String(x || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    /* what a regular member may see of someone else (admins and coordinators see all) */
    const demoHide = d => { const src = db.members.find(x => x.id === d.id) || {}, sh = k => !!(src.share || {})[k];
        if (STAFF.includes(me().role) || src.user_id === 'me') return d;
        return { ...d, bike: sh('bike') ? d.bike : null, vrn: sh('vrn') ? d.vrn : null, vrn_verified: sh('vrn') ? d.vrn_verified : null, bikes: sh('vrn') ? d.bikes : null, locality: sh('locality') ? d.locality : null, avg_kmpl: sh('mileage') ? d.avg_kmpl : null }; };

    /* sample Guides: picture covers drawn here, videos borrowed from the app's own how-to videos */
    const cover = (a, b, label, w = 360, h = 640) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * .8}" cy="${h * .18}" r="${w * .35}" fill="#fff" opacity=".07"/><text x="50%" y="${h * .5}" text-anchor="middle" font-family="sans-serif" font-size="${w / 9}" font-weight="800" fill="#fff" opacity=".92">${label}</text></svg>`);
    const demoGuides = () => (db.guides ||= [
        ['maint', 'video', 'Chain clean & lube in 50 seconds', 'Kerosene brush, wipe, lube on the inside of the chain, wait 10 minutes.', 'chain, lube, kerosene, motul', 'track', 50, '#3a2117', '#d4501a', 'CHAIN', 2],
        ['maint', 'video', 'Check engine oil level the right way', 'Bike upright on flat ground, engine warm, read the window between the marks.', 'oil, level, window', 'service', 43, '#1d3557', '#457b9d', 'OIL', 6],
        ['maint', 'video', 'Rear brake pad wear check', 'Look through the caliper: under 2 mm of pad means change them.', 'brake, pads', 'mileage', 44, '#2b2d42', '#8d99ae', 'BRAKES', 9],
        ['maint', 'pdf', 'First free service checklist', 'What TVS checks at 750–1,000 km and what to ask for.', 'service, first, checklist', null, null, '#264653', '#2a9d8f', '', 3, 6],
        ['maint', 'pdf', 'Monsoon care for the Ronin', 'Rust, electricals, brakes and chain after rain rides.', 'rain, monsoon, rust', null, null, '#1b4332', '#40916c', '', 12, 9],
        ['maint', 'pdf', 'Tyre pressure & tread guide', 'Pressures for solo and pillion, and when to replace.', 'tyre, pressure, psi', null, null, '#3d405b', '#81b29a', '', 20, 4],
        ['maint', 'image', 'Chain slack: 25–30 mm', 'Measure at the middle of the lower run, on the side stand.', 'chain, slack, adjust', null, null, '#6b2d16', '#e8662e', 'SLACK', 5],
        ['maint', 'image', 'Fuse box map', 'Which fuse does what, under the seat.', 'fuse, electrical', null, null, '#212529', '#495057', 'FUSES', 15],
        ['ride', 'video', 'Hand signals in a group ride', 'Left hand for turn, stop, single file and hazards.', 'group, hand signals', 'events', 40, '#3c1518', '#d4501a', 'SIGNALS', 1],
        ['ride', 'video', 'Staggered formation explained', 'Leader on the right, keep 2 seconds to the rider ahead.', 'group, formation', 'warriorboards', 27, '#14213d', '#fca311', 'FORMATION', 4],
        ['ride', 'pdf', 'RWB group ride rules', 'Briefing, sweep rider, fuel stops, what to carry.', 'rules, group, sweep', null, null, '#370617', '#9d0208', '', 4, 8],
        ['ride', 'image', 'Packing list for a 2-day ride', 'Tick it off the night before.', 'packing, touring, list', null, null, '#023047', '#219ebc', 'PACKING', 7]
    ].map(([cat, kind, title, description, tags, vid, sec, a, b, label, ago, pages], i) => ({
        id: 9000 + i, cat, kind, title, description, tags, user_id: i % 3 ? 'u2' : 'me', uploader: i % 3 ? 'Sultan' : firstOf(me()),
        url: kind === 'video' ? `videos/${vid}.mp4` : kind === 'image' ? cover(a, b, label, 1200, 1200) : 'demo.pdf',
        thumb_url: kind === 'video' ? cover(a, b, label) : kind === 'image' ? cover(a, b, label, 480, 480) : null,
        duration_s: sec, width: kind === 'video' ? 720 : null, height: kind === 'video' ? 1280 : null, pages: kind === 'pdf' ? pages : null,
        bytes: kind === 'video' ? sec * 260e3 : kind === 'pdf' ? 1.2e6 : 280e3, created_at: daysAgo(ago)
    })));
    const demoRem = () => (db.reminders ||= [{ id: 951, source: 'custom', title: 'FASTag recharge', due_date: daysAgo(-5), repeat: 'monthly', notify_days: 1, note: null }]);
    const wait = (v) => new Promise(r => setTimeout(() => r(clone(v)), 120));
    const authFns = [];
    const isBirthday = (dob, d) => dob && dob.slice(5) === iso(d).slice(5);
    const demoDir = () => wait(db.members.filter(m => !m.status || m.status === 'active').map(m => ({ id: m.id, full_name: m.full_name, nickname: m.nickname, avatar_url: m.avatar_url, bike: m.bike, vrn: m.vrn, vrn_verified: !!m.vrn_verified, bikes: m.member_bikes || null, locality: m.locality, role: m.role, phone: ['superadmin', 'admin', 'coordinator'].includes(m.role) ? m.phone : null, on_app: !!m.user_id, avg_kmpl: m.user_id === 'me' ? m.avg_kmpl : ({ 2: 41.9, 3: 44.6, 4: 36.8, 5: 38.2 })[m.id] ?? null })).sort((a, b) => a.full_name.localeCompare(b.full_name)));

    return {
        demo: true,
        session: async () => db.signedIn ? { email: 'demo@example.com', name: 'Demo Rider' } : null,
        onAuthChange: fn => authFns.push(fn),
        async signIn() { db.signedIn = true; save(); authFns.forEach(f => f('SIGNED_IN')); },
        async signOut() { db.signedIn = false; save(); authFns.forEach(f => f('SIGNED_OUT')); },
        resetDemo() { db = seed(); db.signedIn = true; save(); },

        linkAccount: () => { let f = null; try { f = localStorage.getItem('rwb-demo-fam'); } catch { /* ignore */ } return wait(f ? 'not_found' : 'member'); },   /* 'join': the RWB FAM join screen */
        requestAccess: () => wait('pending'),
        myRequest: () => wait(null),
        me: () => wait(me()),
        async updateMe(f) { const bad = Object.keys(f).filter(k => !['full_name', 'nickname', 'dob', 'phone', 'alt_phone', 'bike', 'vrn', 'blood_group', 'locality', 'hideout', 'emergency_phone', 'avatar_url', 'show_on_leaderboard', 'notify', 'odo_km', 'odo_date', 'avg_kmpl', 'kmpl_tanks'].includes(k)); if (bad.length) throw new Error(`Could not find the '${bad[0]}' column of 'members' in the schema cache`); Object.assign(me(), f); save(); return wait(me()); },   /* strict like the real database */
        async setAvatar(file) { me().avatar_url = file ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }) : null; save(); return wait(me()); },
        joinForm: () => wait(window.DEMO_JOIN_FORM || null),
        vrnHint: (vrn, phone) => { const k = x => String(x || '').replace(/[^a-z0-9]/gi, '').toUpperCase(), d = String(phone || '').replace(/\D/g, '').slice(-10);
            const m = db.members.find(x => k(x.vrn) === k(vrn) && x.phone !== d && (x.status || 'active') === 'active');
            return wait(m ? `This VRN is already registered with RWB (${m.email ? 'email ' + m.email.slice(0, 2) + '•••@' + m.email.split('@')[1] + ', ' : ''}WhatsApp ${m.phone.slice(0, 2)}••••••${m.phone.slice(-2)}). If that's you, sign in with that email. Otherwise please message an RWB admin.` : null); },
        settings: () => wait({ wa_group_link: db.groupLink || null }),
        myPrefill: () => wait(null),
        myChanges: () => wait((db.changes || []).filter(c => c.member_id === me().id).slice().reverse()),
        async requestChange(kind, value, slot = null, model = null) {
            const m = me(); db.changes = (db.changes || []).filter(c => !(c.member_id === m.id && c.kind === kind && (c.slot || 0) === (slot || 0) && c.status === 'pending'));
            if (kind === 'bike' && !value) { m.member_bikes = (m.member_bikes || []).filter(b => b.slot !== slot); save(); return 'removed'; }
            if (kind === 'tnc' && value === 'agree') { m.tnc_agreed = true; save(); return 'saved'; }
            const nv = x => String(x || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (kind === 'vrn' && nv(value) === nv(m.vrn)) { if ((model || m.bike) === m.bike) return 'unchanged'; m.bike = model || null; save(); return 'saved'; }
            db.changes.push({ id: nid(), member_id: m.id, full_name: m.full_name, phone: m.phone, kind, slot, new_value: kind === 'phone' ? value.replace(/\D/g, '').slice(-10) : kind === 'vrn' || kind === 'bike' ? value.toUpperCase() : value, new_model: model, old_value: kind === 'name' ? m.full_name : kind === 'phone' ? m.phone : kind === 'vrn' ? [m.vrn, m.bike].filter(Boolean).join(' · ') : kind === 'tnc' ? 'agree' : null, vrn_verified: false, status: 'pending', created_at: new Date().toISOString(), on_app: true });
            save(); return 'pending';
        },
        updateMyAnswers: answers => { me().form_answers = { ...(me().form_answers || {}), ...answers }; save(); return wait(answers); },
        myBikes: () => wait((me().member_bikes || []).slice().sort((a, b) => a.slot - b.slot)),
        async saveBike(slot, vrn, model, mid = null) { if (!mid) return this.requestChange('bike', vrn, slot, model); const m = db.members.find(x => x.id === mid); m.member_bikes = (m.member_bikes || []).filter(b => b.slot !== slot); if (vrn) m.member_bikes.push({ slot, vrn: vrn.toUpperCase(), model: model || null, verified: false }); save(); return vrn ? 'saved' : 'removed'; },
        directory: () => demoDir().then(list => list.map(demoHide)),
        setSharing: p => { const out = Object.fromEntries(['vrn', 'bike', 'locality', 'mileage'].map(k => [k, !!p[k]])); me().share = out; save(); return wait(out); },
        rideParts: () => wait(db.ride ??= [
            { id: 901, kind: 'wear', part: 'engine_oil', brand: 'Motul 7100', spec: '10W-30', installed_on: daysAgo(95), installed_km: 4120, cost: 1150, life_km: 6000, life_days: 180 },
            { id: 902, kind: 'wear', part: 'rear_tyre', brand: 'TVS Eurogrip', spec: '130/70-17', installed_on: daysAgo(210), installed_km: 0, cost: null, life_km: 18000 },
            { id: 903, kind: 'wear', part: 'chain_lube', brand: 'Motul C2', spec: '', installed_on: daysAgo(12), installed_km: 6850, cost: 350, life_km: 500 },
            { id: 904, kind: 'wear', part: 'front_pads', brand: 'TVS genuine', spec: '', installed_on: daysAgo(210), installed_km: 0, life_km: 15000 },
            { id: 905, kind: 'acc', part: 'crash_guard', brand: 'Zana', spec: 'Engine guard', installed_on: daysAgo(150), cost: 2800 }]),
        async saveRidePart(rec) { db.ride ??= []; if (rec.id) Object.assign(db.ride.find(x => x.id === rec.id), rec); else db.ride.push(rec = { ...rec, id: nid() }); save(); return wait(rec); },
        async deleteRidePart(id) { db.ride = (db.ride || []).filter(x => x.id !== id); save(); },
        rideName: () => wait(db.rideName || ''),
        async saveRideName(n) { db.rideName = n; save(); },
        vrnInfo: v => { const m = db.members.find(m => (!m.status || m.status === 'active') && (nk(m.vrn) === nk(v) || (m.member_bikes || []).some(b => nk(b.vrn) === nk(v))));
            if (!m) return wait({ member: false }); const full = !!m.share?.vrn, w = String(m.full_name).trim().split(/\s+/);
            return wait({ member: true, full, name: full ? m.full_name : w.map((x, i) => i ? x[0] + '***' : x.slice(0, 3) + '*'.repeat(Math.max(x.length - 3, 2))).join(' '), area: String(m.locality || '').split(',')[0].trim() || null }); },
        vrnCheck: v => wait(db.members.some(m => (!m.status || m.status === 'active') && (nk(m.vrn) === nk(v) || (m.member_bikes || []).some(b => nk(b.vrn) === nk(v))))),
        agreeTnc: () => { Object.assign(me(), { tnc_agreed: true, tnc_version: window.RWB_TNC?.version || null, tnc_agreed_at: new Date().toISOString() }); save(); return wait('ok'); },
        withdrawTnc: () => { Object.assign(me(), { tnc_agreed: false, tnc_version: null }); save(); return wait('withdrawn'); },
        leaveRwb: () => { me().status = 'left'; save(); return wait('left'); },
        deleteMyAccount: () => { me().status = 'left'; save(); return wait('deleted'); },
        findMyEmail: (phone, vrn) => { const k = v => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), p = String(phone).replace(/\D/g, '').slice(-10);
            const m = db.members.find(x => x.phone === p && (!x.status || x.status === 'active') && (k(x.vrn) === k(vrn) || (x.member_bikes || []).some(b => k(b.vrn) === k(vrn))));
            return wait(m ? { found: true, hint: m.email ? m.email.split('@')[0].slice(0, m.email.split('@')[0].length > 4 ? 3 : 1) + '•••@' + m.email.split('@')[1] : null, on_app: !!m.user_id } : { found: false }); },
        claimMembership: (phone, vrn, dob) => { const p = String(phone).replace(/\D/g, '').slice(-10), m = db.members.find(x => x.phone === p);
            if (!m || m.dob !== dob) return wait({ ok: false });
            return wait({ ok: true, name: m.full_name.split(' ')[0], moved: !!m.user_id }); },
        /* RWB FAM demo: localStorage rwb-demo-fam = 1 makes this phone a FAM user of Demo Rider */
        famMe: () => { if (!demoFam()) return wait(null); const m = db.members.find(x => x.user_id === 'me'), f = db.famMe ||= { id: 91, full_name: 'Rina Mallick', phone: '9830012345', address: 'Salt Lake, Kolkata', email: 'rina.m@gmail.com', approved: true, created_at: new Date().toISOString() };
            return wait({ ...f, active: true, member: f.approved ? { id: m.id, full_name: m.full_name, nickname: m.nickname, avatar_url: m.avatar_url, bike: m.bike, odo: 7982, on_app: true } : { full_name: m.full_name, nickname: m.nickname, avatar_url: m.avatar_url } }); },
        famInviteInfo: code => wait(code === 'RWB-K7Q2' ? { name: firstOf(me()), left: 3 - (db.fam || [1]).length } : null),
        myFam: () => wait({ code: 'RWB-K7Q2', max: 3, fam: db.fam ||= [{ id: 91, full_name: 'Rina Mallick', phone: '9830012345', approved: true, created_at: new Date(Date.now() - 3 * 864e5).toISOString() }] }),
        removeFam: id => { db.fam = (db.fam || []).filter(f => f.id !== id); save(); return wait('removed'); },
        famJoin: () => { localStorage.setItem('rwb-demo-fam', '1'); return wait('joined'); },
        famUpdate: (name, phone, address) => { Object.assign(db.famMe, { full_name: name, phone, address }); save(); return wait('saved'); },
        famSetApproved: ok => { db.famMe.approved = !!ok; save(); return wait(ok ? 'approved' : 'disapproved'); },
        famAlert: () => wait('sent'),
        adminFamList: () => wait([{ id: 91, full_name: 'Rina Mallick', phone: '9830012345', address: 'Salt Lake, Kolkata', email: 'rina.m@gmail.com', approved: true, created_at: new Date(Date.now() - 3 * 864e5).toISOString(), member: { id: 1, full_name: me().full_name, nickname: me().nickname, avatar_url: me().avatar_url, phone: me().phone, status: 'active' } },
            { id: 92, full_name: 'Tapas Sen', phone: '9830098765', address: 'Howrah', email: 'tapas.sen@gmail.com', approved: false, alerted_at: new Date().toISOString(), created_at: new Date(Date.now() - 864e5).toISOString(), member: { id: 2, full_name: 'Arjun Sen', nickname: 'Sultan', phone: '9000000002', status: 'active' } }]),
        /* Track demo: a few sample riders around Kolkata, plus you when sharing */
        trackStart: (lat, lng, acc, hours, ev, note) => { db.track = { note: note || null, event_id: ev || null, lat, lng, acc, at: new Date().toISOString(), since: new Date().toISOString(), until: new Date(Date.now() + hours * 36e5).toISOString() }; save(); return wait(db.track.until); },
        trackPing: (lat, lng, acc, spd) => { if (!db.track) return wait('stopped'); Object.assign(db.track, { lat, lng, acc, spd, at: new Date().toISOString() }); save(); return wait('ok'); },
        trackStop: () => { db.track = null; save(); return wait('stopped'); },
        trackToken: () => wait('demo-key'),
        trackView: () => { const t = Date.now(), ago = s => new Date(t - s * 1000).toISOString(), m = me();
            if (demoFam()) { if (!db.famMe?.approved && db.famMe) return Promise.reject(new Error('Members only'));
                return wait({ riders: [{ id: m.id, name: m.full_name, nick: m.nickname, avatar: m.avatar_url, lat: 22.6120, lng: 88.4020, spd: 0, at: ago(260), event_id: 501, note: 'towards Simlipal!', mine: true, me: false, phone: null },
                    { id: 3, name: 'Priya Dutta', lat: 22.6050, lng: 88.3950, spd: 11, at: ago(30), event_id: 501, mine: false, me: false, phone: null }], sos: [], staff: false, fam: true, rider: m.id, now: new Date(t).toISOString() }); }
            const riders = [{ id: 2, name: 'Arjun Sen', nick: 'Sultan', lat: 22.5850, lng: 88.4170, spd: 14, at: ago(20), note: 'Tea break at Kona' }, { id: 4, name: 'Rahul Ghosh', nick: 'Rocket', lat: 22.6420, lng: 88.4310, spd: 0, at: ago(400) }, { id: 3, name: 'Priya Dutta', lat: 22.5000, lng: 88.3600, spd: 9, at: ago(45), event_id: 501 }]
                .map(r => ({ ...r, avatar: null, role: 'member', phone: ['superadmin', 'admin', 'coordinator'].includes(m.role) ? '90000000' + String(r.id).padStart(2, '0') : null, me: false }));
            if (db.track && Date.parse(db.track.until) > t) riders.push({ id: m.id, name: m.full_name, nick: m.nickname, avatar: m.avatar_url, ...db.track, me: true, phone: null });
            const sos = (db.sos || []).filter(s => !s.resolved).map(s => ({ ...s, name: m.full_name, avatar: m.avatar_url, me: true }));
            return wait({ riders, sos, staff: ['superadmin', 'admin', 'coordinator'].includes(m.role), now: new Date().toISOString() }); },
        trackSos: (lat, lng, acc) => { db.sos = [{ id: Date.now(), lat, lng, acc, at: new Date().toISOString() }]; save(); return wait(db.sos[0].id); },
        trackSosResolve: id => { (db.sos || []).forEach(s => { if (s.id === id) s.resolved = true; }); save(); return wait('done'); },
        appSeen: async () => {},
        pookieBoard: () => wait([{ member_id: 2, full_name: 'Arjun Sen', nickname: 'Sultan', xp: 48, approved: 4 }, { member_id: 3, full_name: 'Priya Dutta', xp: 12, approved: 1 }, { member_id: 1, full_name: me().full_name, xp: 2 + 10 * (db.ta || []).filter(a => a.status === 'approved').length, approved: (db.ta || []).filter(a => a.status === 'approved').length, is_me: true }]),
        gpsBoard: () => wait([{ member_id: 2, full_name: 'Arjun Sen', nickname: 'Sultan', km: 412.6, rides: 9 }, { member_id: 3, full_name: 'Priya Dutta', km: 233.1, rides: 5 }, { member_id: 4, full_name: 'Rahul Ghosh', nickname: 'Rocket', km: 188.4, rides: 4 }, { member_id: 1, full_name: me().full_name, km: 96.2, rides: 2, is_me: true }, { member_id: 5, full_name: 'Sourav Paul', km: 41.0, rides: 1 }]),
        joinHelpAdmins: () => wait(db.members.filter(m => ['superadmin', 'admin'].includes(m.role) && (!m.status || m.status === 'active')).map(m => ({ first_name: (m.nickname || m.full_name).split(' ')[0], phone: m.phone }))),
        rwbAdmins: () => wait(db.members.filter(m => ['superadmin', 'admin'].includes(m.role) && (!m.status || m.status === 'active')).map(m => ({ full_name: m.full_name, nickname: m.nickname, phone: m.phone, role: m.role }))),
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
        importEvents: rows => { let n = 0; rows.forEach(r => { const key = (r.title + r.starts_at.slice(0, 10)).toLowerCase(); if (db.events.some(e => (e.title + String(e.starts_at).slice(0, 10)).toLowerCase() === key)) return; db.events.push({ ...r, id: nid(), status: 'live', capacity: r.capacity ? +r.capacity : null, on_website: true, created_by: 'me' }); n++; }); save(); return wait(n); },
        expenses: id => wait((db.expenses || []).filter(x => x.event_id === id)),
        async saveExpense(rec) { db.expenses ||= []; if (rec.id) Object.assign(db.expenses.find(x => x.id === rec.id), rec); else db.expenses.push({ ...rec, id: nid(), created_by: 'me', created_at: new Date().toISOString() }); save(); return wait(rec); },
        async deleteExpense(id) { db.expenses = db.expenses.filter(x => x.id !== id); save(); },

        myReminders: () => wait(demoRem().filter(r => r.source === 'custom')),
        async saveReminder(rec) { db.reminders ||= []; if (rec.id) Object.assign(db.reminders.find(r => r.id === rec.id), rec); else db.reminders.push(rec = { ...rec, id: nid(), source: 'custom' }); save(); return wait(rec); },
        async deleteReminder(id) { db.reminders = (db.reminders || []).filter(r => r.id !== id); save(); },
        async syncReminders(items) { db.reminders = [...demoRem().filter(r => r.source === 'custom'), ...items.map((x, i) => ({ ...x, id: 990 + i }))]; save(); return wait(items.length); },
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
            const live = ['admin', 'superadmin'].includes(me().role), now = new Date().toISOString();   /* admins: live at once; members and coordinators: approval */
            if (rec.id) { const l = db.listings.find(x => x.id === rec.id); Object.assign(l, rec, { photos, kind: l.kind || 'used' }); if (l.status === 'rejected') l.status = 'pending'; }
            else db.listings.push({ ...rec, kind: rec.kind || 'used', photos, id: nid(), user_id: 'me', status: live ? 'live' : 'pending', created_at: now, published_at: live ? now : null });
            save(); return wait(rec);
        },
        async setListingStatus(id, status, reason = null) { const l = db.listings.find(x => x.id === id); if (status === 'live' && !l.published_at) l.published_at = new Date().toISOString(); Object.assign(l, { status, reject_reason: reason, sold_at: status === 'sold' ? (l.sold_at || new Date().toISOString()) : null }); save(); return wait(l); },
        async deleteListing(rec) { db.listings = db.listings.filter(l => l.id !== rec.id); save(); },
        news: () => wait([...db.news].sort((a, b) => b.created_at.localeCompare(a.created_at))),
        async announce(title, body) { db.news.push({ id: nid(), kind: 'announcement', title, body, url: '#news', audience: 'all', created_at: new Date().toISOString() }); save(); },
        async deleteNews(id) { db.news = db.news.filter(n => n.id !== id); save(); },
        savePush: async () => 'saved', deletePush: async () => 'deleted', saveFcm: async () => 'saved', deleteFcm: async () => 'deleted', finishNativeSignIn: async () => {},
        async ask(messages) {
            await new Promise(r => setTimeout(r, 700));
            const q = messages.at(-1).text.toLowerCase();
            const reply = /chain/.test(q) ? `${me().full_name.split(' ')[0]}, Arjun from RWB swears by this:\n\n- Clean the chain every 500–700 km, sooner after rain\n- Lube the inner side while turning the wheel, wait 15 min\n\nYour chain will thank you 😄`
                : /^(hi|hello|hey|thanks|thank you)\b/.test(q) ? `Hey ${me().full_name.split(' ')[0]}! 👋 Ask me anything RWB warriors taught me.`
                : `Hmm, ${me().full_name.split(' ')[0]}… I don't know that yet. Wait for someone to teach that to me first. 🙏\n\nI've put your question in **Teach Pookie** as URGENT, so the warriors can teach me.`;
            if (/don't know/.test(reply)) { db.tq ??= []; if (!db.tq.some(x => x.question === messages.at(-1).text)) db.tq.unshift({ id: nid(), category: 'Asked by riders', question: messages.at(-1).text, answers: 0, urgent: true, asked: 1 }); }
            db.chatLeft = (db.chatLeft ?? 20) - 1; save();
            const onText = arguments[3]; let shown = '';
            for (const w of reply.split(/(?<= )/)) { shown += w; onText?.(shown); await new Promise(r => setTimeout(r, 25)); }
            return { reply, left: db.chatLeft };
        },
        diagnoseAI: async () => ['version demo', 'settings: OK (demo mode)', 'test answer: "OK"'],
        teach: {
            async next(skip = []) {
                db.tq ??= [['Engine & oil', 'Which engine oil brand and grade do you use in your Ronin 225, and how has the engine felt with it?'], ['Brakes, tyres & suspension', 'What tyre pressures (front and rear) do you run on the Ronin, solo and with a pillion?'], ['Chain & drive', 'How often do you clean and lube the chain on your Ronin, and which products do you use?'], ['Common issues & fixes', 'Have you faced the ISG / engine malfunction warning light coming on? What did it turn out to be?'], ['Riding & touring', 'How does the Ronin handle hills and ghats, like the roads to Darjeeling or Sikkim?']].map(([category, question], i) => ({ id: i + 1, category, question, answers: 0 }));
                db.ta ??= [];
                const open = db.tq.filter(x => !skip.includes(x.id) && !db.ta.some(a => a.question_id === x.id)), q = open.find(x => x.urgent) || open[0];
                return wait({ question: q || null, stats: this._stats() });
            },
            _stats() { const ok = (db.ta || []).filter(a => a.status === 'approved').length, w = (db.ta || []).filter(a => a.status === 'pending').length;
                return { answered: (db.ta || []).length, approved: ok, waiting: w, xp: ok * 10 + w * 2, rank: 1, questions: (db.tq || []).length, urgent: (db.tq || []).filter(x => x.urgent && !(db.ta || []).some(a => a.question_id === x.id)).length, top: [{ name: 'Arjun', xp: 48, approved: 4 }, { name: me().full_name.split(' ')[0], xp: ok * 10 + w * 2, approved: ok, me: true }, { name: 'Priya', xp: 12, approved: 1 }].sort((a, b) => b.xp - a.xp) }; },
            async answer(qid, text) { if (String(text).trim().length < 8) throw new Error('Write a little more so Pookie can learn from it'); const live = me().role === 'admin', q = (db.tq || []).find(x => x.id === qid);
                db.ta.push({ id: nid(), question_id: qid, answer: text, status: live ? 'approved' : 'pending', member_name: me().full_name, created_at: new Date().toISOString() });
                if (live) { (db.know ??= []).push({ id: nid(), source: 'answer', title: q?.question, content: text + ' (RWB rider ' + me().full_name.split(' ')[0] + ')', updated_at: new Date().toISOString() }); if (q) q.urgent = false; }
                save(); return wait({ ...this._stats(), live }); },
            stats() { return wait(this._stats()); },
        },
        /* ---- Guides (demo: sample items; uploads stay on this phone until the page reloads) ---- */
        guideItems: () => wait(demoGuides()),
        guideCats: () => wait({ superadmin: ['app', 'maint', 'ride'], admin: ['maint', 'ride'], coordinator: ['ride'] }[me().role] || []),
        guideStatus: () => wait({ ready: true, repo: 'iitbodhi/rwb-media', bytes: demoGuides().reduce((s, g) => s + (g.bytes || 0), 0), items: demoGuides().length, budget: 900e6, cats: [] }),
        async guideEdit(id, f) { const g = demoGuides().find(x => x.id === id); Object.assign(g, { title: f.title, description: f.description || null, tags: f.tags || null }); save(); return wait(g); },
        async guideDelete(item) { db.guides = demoGuides().filter(g => g.id !== item.id); save(); return wait({ deleted: item.id }); },
        async guideUpload(meta, file, thumb, onProgress) {
            for (let i = 1; i <= 10; i++) { await new Promise(r => setTimeout(r, 120)); onProgress?.(i / 10); }
            const big = file.size > 400e3;   /* small pictures are kept as text so they survive a reload; big files only until it */
            const src = big ? URL.createObjectURL(file) : await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
            const th = thumb ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(thumb); }) : null;
            const g = { id: nid(), ...meta, url: src, thumb_url: th, bytes: file.size, user_id: 'me', uploader: firstOf(me()), created_at: new Date().toISOString() };
            demoGuides().unshift(g); save(); return wait(g);
        },
        async pookieOp(op) { await new Promise(r => setTimeout(r, 900)); return op === 'gen-questions' ? { added: 20 } : (db.gl = (db.gl || 0) + 1) > 3 ? { done: true, total: 3, learned: 3, failed: 0 } : { learned: ['Chain cleaning guide', 'First service checklist', 'Monsoon care'][db.gl - 1], left: 3 - db.gl, total: 3 }; },
        chatNotes: async () => db.chatNotes || '', async saveChatNotes(n) { db.chatNotes = n; save(); },
        async testPush() { db.news.push({ id: nid(), kind: 'admin', title: 'Test notification ✅', body: 'Push notifications are working on this phone.', url: '#news', audience: 'admins', created_at: new Date().toISOString() }); save(); },

        report: (kind, ref, label, reason, details) => { (db.reports ??= []).unshift({ id: Date.now(), created_at: new Date().toISOString(), reporter_name: me().full_name, kind, ref, label, reason, details: details || null, status: 'open' }); save(); return wait(1); },
        admin: {
            sheetSync() { db.syncReq = new Date().toISOString(); setTimeout(() => { db.syncLast = { at: new Date().toISOString(), summary: 'Sync done. Empty rows removed: 0. Cells updated from the app: 3 on 2 rows. Added: 1. Moved to Removed members: 0. (demo)' }; save(); }, 3000); save(); return wait('started'); },
            sheetSyncStatus: () => wait({ requested: db.syncReq || null, last: db.syncLast || null }),
            appCopies: () => wait(db.members.filter(m => m.user_id && m.status !== 'left' && m.status !== 'removed').map((m, i) => ({ member_id: m.id, full_name: m.full_name, nickname: m.nickname, phone: m.phone, avatar_url: m.avatar_url, copy: ['play', 'apk', 'browser', 'apk', 'none'][i % 5], build: [124, 123, null, 116, null][i % 5], seen_at: new Date(Date.now() - i * 864e5).toISOString(), apk_too: i % 5 === 0 }))),
            pookiePending: () => wait((db.ta || []).filter(a => a.status === 'pending').length),
            teachQueue: () => wait((db.ta || []).filter(a => a.status === 'pending').map(a => ({ ...a, question: (db.tq || []).find(q => q.id === a.question_id)?.question, category: (db.tq || []).find(q => q.id === a.question_id)?.category }))),
            teachReview(id, ok, text) { const a = db.ta.find(x => x.id === id); a.status = ok ? 'approved' : 'rejected'; if (ok) { const tq = (db.tq || []).find(q => q.id === a.question_id); if (tq) tq.urgent = false; (db.know ??= []).push({ id: nid(), source: 'answer', title: (db.tq || []).find(q => q.id === a.question_id)?.question, content: (text || a.answer) + ' (RWB rider ' + a.member_name.split(' ')[0] + ')', updated_at: new Date().toISOString() }); } save(); return wait(ok ? 'approved' : 'rejected'); },
            pookieKnowledge: () => wait(db.know || []),
            pookieForget(id) { db.know = (db.know || []).filter(k => k.id !== id); save(); return wait('forgotten'); },
            pookieAddQuestions: rows => wait(rows.length),
            reports: () => wait(db.reports ??= []),
            reportDone: (id, outcome) => { const r = (db.reports || []).find(x => x.id === id); if (r) Object.assign(r, { status: 'done', outcome, handled_by: me().full_name, handled_at: new Date().toISOString() }); save(); return wait('done'); },
            dupes: () => wait(db.dupes ??= [
                { key: 'phone:9000000002', kind: 'phone', value: '9000000002', entries: [
                    { id: 'a1', row: 214, name: 'Rahul Sen', phone: '9000000002', vrn: 'WB06C7788', email: 'rahul@example.com', joined: '12/03/2024 18:20', status: 'In App', filled: 16, tnc: true, best: true, on_app: true, member: 'active' },
                    { id: 'a2', row: 597, name: 'Rahul Sen', phone: '9000000002', vrn: 'WB06C7788', email: 'rahul.sen@example.com', joined: '27/10/2026 09:12', status: 'Member', filled: 12, tnc: true, best: false, on_app: true, member: 'active' }] },
                { key: 'vrn:WB02AB1234', kind: 'vrn', value: 'WB02AB1234', entries: [
                    { id: 'b1', row: 88, name: 'Demo Rider', phone: '9000000001', vrn: 'WB02AB1234', email: 'demo@example.com', joined: '10/01/2024 11:00', status: 'In App', filled: 17, tnc: true, best: true, on_app: true, member: 'active' },
                    { id: 'b2', row: 640, name: 'Sourav Pal', phone: '9000000077', vrn: 'WB02AB1234', email: 'sourav@example.com', joined: '20/10/2026 21:40', status: 'Member', filled: 11, tnc: false, best: false, on_app: false, member: 'active' }] }]),
            async resolveDupe(key, remove, ignore) { db.dupes = (db.dupes || []).filter(g => g.key !== key); save(); return { result: ignore ? 'ignored' : 'done', rows: (remove || []).length }; },
            stats: () => wait({ members: db.members.length, on_app: db.members.filter(m => m.user_id).length, pending: db.requests.length, admins: db.members.filter(m => m.role !== 'member').length }),
            requests: () => wait(db.requests),
            async approve(id) {
                const r = db.requests.find(x => x.id === id);
                const ex = db.members.find(m => m.phone === r.phone);
                if (ex) Object.assign(ex, { full_name: r.full_name, vrn: r.vrn || ex.vrn, locality: r.locality || ex.locality, bike: r.bike || ex.bike, vrn_verified: r.vrn_verified || ex.vrn_verified });
                else db.members.push({ id: nid(), full_name: r.full_name, phone: r.phone, email: r.email, dob: r.dob, vrn: r.vrn, bike: r.bike, locality: r.locality, role: 'member', user_id: r.on_app ? 'u' + id : null, vrn_verified: !!r.vrn_verified, joined_at: iso(today) });
                db.requests = db.requests.filter(x => x.id !== id); save(); return 'approved';
            },
            async reject(id) { db.requests = db.requests.filter(x => x.id !== id); save(); return 'rejected'; },
            changes: () => wait((db.changes || []).filter(c => c.status === 'pending')),
            async setSetting(k, v) { db.groupLink = v || null; save(); return v || ''; },
            async setCheck(id, k, v) {
                const r = db.requests.find(x => x.id === id), c = r.checks ||= {};
                if (k === 'tnc' && !('tnc_orig' in c)) c.tnc_orig = r.tnc ?? null;
                if (v === 'auto') { delete c[k]; delete c['by_' + k]; } else { c[k] = v; c['by_' + k] = me().nickname || me().full_name.split(' ')[0]; }
                if (k === 'vrn') r.vrn_verified = v === 'ok';
                if (k === 'tnc') r.tnc = v === 'ok' ? true : v === 'no' ? false : c.tnc_orig;
                save(); return c;
            },
            incomplete: () => wait(db.members.filter(m => !m.status || m.status === 'active').map(m => ({ id: m.id, full_name: m.full_name, phone: m.phone, on_app: !!m.user_id, tnc_agreed: m.tnc_agreed ?? null, reminded_at: m.reminded_at || null,
                missing: [m.tnc_agreed !== true && 'rules', !m.emergency_phone && 'emergency contact', !m.blood_group && 'blood group', !m.dob && 'date of birth', !m.vrn && 'VRN', !m.locality && 'locality', !m.hideout && 'permanent hideout'].filter(Boolean) })).filter(m => m.missing.length)),
            async remindIncomplete() { return db.members.filter(m => m.user_id && m.user_id !== 'me').length; },
            async markReminded(id) { const m = db.members.find(x => x.id === id); m.reminded_at = new Date().toISOString(); save(); },
            async setTnc(id, v) { db.members.find(x => x.id === id).tnc_agreed = v; save(); return v; },
            async setChangeVrn(id, v) { const c = db.changes.find(x => x.id === id); c.vrn_verified = v; save(); return v; },
            async decideChange(id, ok, reason) {
                const c = db.changes.find(x => x.id === id), m = db.members.find(x => x.id === c.member_id);
                if (ok) { if (c.kind === 'name') m.full_name = c.new_value; else if (c.kind === 'phone') m.phone = c.new_value; else if (c.kind === 'vrn') Object.assign(m, { vrn: c.new_value, bike: c.new_model || m.bike, vrn_verified: c.vrn_verified });
                    else if (c.kind === 'bike') { m.member_bikes = (m.member_bikes || []).filter(b => b.slot !== c.slot); m.member_bikes.push({ slot: c.slot, vrn: c.new_value, model: c.new_model, verified: c.vrn_verified }); } else if (c.kind === 'tnc') m.tnc_agreed = false; }
                Object.assign(c, { status: ok ? 'approved' : 'rejected', reject_reason: ok ? null : reason, decided_at: new Date().toISOString() }); save(); return c.status;
            },
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
