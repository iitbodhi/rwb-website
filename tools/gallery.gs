/* RWB Gallery: the photo list for roninwb.in and the RWB App, plus adding and deleting photos from the app.
   Photos live in one Google Drive folder (Bodhi's). Nothing is stored in Supabase.

   SET UP (once, by Bodhi):
   1. script.google.com → New project → name it "RWB Gallery" → paste this whole file over the sample code.
   2. GALLERY_FOLDER_ID below is already filled in (the "RWB Gallery" folder in My Drive → RWB). Only change it if
      the gallery moves to a different folder: the ID is the part of the folder's address after /folders/.
   3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy → allow access.
   4. Copy the Web app URL (ends in /exec) and send it to Claude.
   To change this file later: paste the new version, then Deploy → Manage deployments → ✏️ → Version: New version → Deploy
   (the URL stays the same).

   HOW IT STAYS SAFE
   - Without a pass (roninwb.in, or anyone who finds this link) the list is only 30 photos, a new random pick every
     day (India time). The full list needs a one-time "view" pass that only signed-in members and RWB FAM get in the
     app (Supabase gallery_ticket('view'), file 81).
   - Adding or deleting needs a one-time pass from the RWB App (Supabase gallery_ticket, file 80). Only active
     admins and coordinators get passes; each works once, for 15 minutes, for one action (and, for a delete, one photo).
   - Only photos inside the gallery folder (or folders inside it) can be deleted. New photos go into the gallery folder itself. Deleted photos go to Drive's Bin (recoverable for 30 days).
*/
const GALLERY_FOLDER_ID = '1YAcK37FXENO-vwc6VaNw6bytjxHy5r66';
const SUPABASE_URL = 'https://hcowcybshljgkeixudry.supabase.co';
/* the app's public "anon" key (already public in roninwb.in/app/config.js; it is not a secret) */
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjb3djeWJzaGxqZ2tlaXh1ZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NDI2MjMsImV4cCI6MjEwODMxODYyM30.LLYjaairRQZ3-Ddwo9kschTeVXjEv84n45RrqEUhi0g';
const MAX_BYTES = 6 * 1024 * 1024;   /* the app sends photos shrunk to ~0.5–1 MB; anything over 6 MB is refused */
const CACHE_KEY = 'gal-list-v1', CACHE_SECONDS = 600;

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

const PUBLIC_COUNT = 30;
/* ---------- the list ----------
   with a member/FAM pass (?pass=…): { full: true, list: [{ url, label, id }] }, newest first
   without:                         [{ url, label }] — 30 photos, the same random pick for everyone all day */
function doGet(e) {
  const pass = e && e.parameter && e.parameter.pass;
  if (pass) { const p = usePass_(pass); if (p.ok && p.action === 'view') return json_({ full: true, list: list_() }); }
  return json_(daily_());
}
function daily_() {
  const all = list_(), day = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  let seed = 0; for (let i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) | 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = all.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; }
  return a.slice(0, PUBLIC_COUNT).map(x => ({ url: x.url, label: '' }));
}
/* the full list, newest first, kept 10 minutes in the script's cache */
function list_() {
  const cache = CacheService.getScriptCache(), n = Number(cache.get(CACHE_KEY + ':n') || 0);
  if (n) {
    const parts = cache.getAll(Array.from({ length: n }, (_, i) => CACHE_KEY + ':' + i));
    const text = Array.from({ length: n }, (_, i) => parts[CACHE_KEY + ':' + i]).join('');
    if (text.length && parts[CACHE_KEY + ':' + (n - 1)] != null) { try { return JSON.parse(text); } catch (e) { /* rebuild */ } }
  }
  const out = [];
  galleryFolders_().forEach(folder => {   /* the gallery folder and any folders inside it (e.g. one per ride) */
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed() || !/^image\//.test(f.getMimeType())) continue;
      out.push({ t: f.getDateCreated().getTime(), id: f.getId(), label: f.getName().replace(/\.[^.]+$/, '') });
    }
  });
  out.sort((a, b) => b.t - a.t);
  const list = out.map(x => ({ url: 'https://lh3.googleusercontent.com/d/' + x.id, label: x.label, id: x.id }));
  const text = JSON.stringify(list), size = 90000, chunks = {};
  for (let i = 0; i * size < text.length; i++) chunks[CACHE_KEY + ':' + i] = text.slice(i * size, (i + 1) * size);
  try { chunks[CACHE_KEY + ':n'] = String(Object.keys(chunks).length); cache.putAll(chunks, CACHE_SECONDS); } catch (e) { /* too big to cache: fine */ }
  return list;
}
function galleryFolders_() {
  const all = [], queue = [DriveApp.getFolderById(GALLERY_FOLDER_ID)];
  while (queue.length && all.length < 200) {
    const f = queue.shift(); if (f.isTrashed()) continue; all.push(f);
    const subs = f.getFolders(); while (subs.hasNext()) queue.push(subs.next());
  }
  return all;
}
function clearCache_() { CacheService.getScriptCache().remove(CACHE_KEY + ':n'); }

/* ---------- add / delete (from the RWB App) ---------- */
function doPost(e) {
  let body; try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  const pass = usePass_(body.token);
  if (!pass.ok) return json_({ ok: false, error: 'This request has expired. Please try again.' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (pass.action === 'add') {
      if (!body.data || !/^image\/(jpeg|webp|png)$/.test(body.type || '')) return json_({ ok: false, error: 'Only photos can be added' });
      const bytes = Utilities.base64Decode(body.data);
      if (bytes.length > MAX_BYTES) return json_({ ok: false, error: 'That photo is too big' });
      const name = 'RWB ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HHmmss') + (body.type === 'image/png' ? '.png' : body.type === 'image/webp' ? '.webp' : '.jpg');
      const file = DriveApp.getFolderById(GALLERY_FOLDER_ID).createFile(Utilities.newBlob(bytes, body.type, name));
      file.setDescription('Added in the RWB App by ' + pass.who + ' (' + pass.role + ')');
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* the folder's sharing applies */ }
      clearCache_();
      return json_({ ok: true, item: { url: 'https://lh3.googleusercontent.com/d/' + file.getId(), label: name.replace(/\.[^.]+$/, ''), id: file.getId() } });
    }
    if (pass.action === 'delete') {
      let file; try { file = DriveApp.getFileById(pass.file); } catch (err) { clearCache_(); return json_({ ok: true, gone: true }); }
      const ids = galleryFolders_().map(f => f.getId()), inFolder = file.getParents(); let ok = false;
      while (inFolder.hasNext()) if (ids.indexOf(inFolder.next().getId()) >= 0) ok = true;
      if (!ok) return json_({ ok: false, error: 'That photo isn\'t in the RWB Gallery' });
      file.setTrashed(true);   /* Drive's Bin keeps it 30 days */
      clearCache_();
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } finally { lock.releaseLock(); }
}
function usePass_(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return { ok: false };
  const r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/gallery_use_ticket', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_token: token })
  });
  try { return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : { ok: false }; } catch (e) { return { ok: false }; }
}

/* Run this once from the editor (select "test" → Run) to check the folder ID: it logs how many photos it found. */
function test() { clearCache_(); Logger.log(list_().length + ' photos found'); }
