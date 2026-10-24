/**
 * RWB App ⇄ RWB contact sheet (the Google Sheet with the join form responses)
 *
 * 1. Sheet → app: every new join-form registration reaches the app within seconds.
 * 2. App → sheet: members approved in the app get a new row here, and changes members make in
 *    the app (Me → Edit) update their row. Rows added by the app say "RWB App" in the "Added via" column.
 *
 * SET-UP (once):
 *   a) In this Google Sheet: Extensions → Apps Script → replace everything with this file → fill in SYNC_SECRET → Save.
 *   b) Choose "setup" in the function list at the top → Run → allow access.
 *   c) Deploy → New deployment → ⚙ Select type: Web app → Execute as: Me → Who has access: Anyone → Deploy.
 *      Copy the Web app URL (ends in /exec) and paste it into sheet-sync.sql before running that in Supabase.
 *   If you change this file later: Deploy → Manage deployments → ✏️ → Version: New version → Deploy (same URL).
 */
const SUPABASE_URL = 'https://hcowcybshljgkeixudry.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjb3djeWJzaGxqZ2tlaXh1ZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NDI2MjMsImV4cCI6MjEwODMxODYyM30.LLYjaairRQZ3-Ddwo9kschTeVXjEv84n45RrqEUhi0g';
const SYNC_SECRET = 'PASTE-THE-SYNC-SECRET-HERE';

/* Form question → app field (matched by the start of the column title, not case-sensitive) */
const COLUMNS = {
  full_name: 'full name',
  dob: 'date of birth',
  phone: 'whatsapp no',
  vrn: 'vrn',
  blood_group: 'blood group',
  locality: 'current locality',
  hideout: 'permanent hideout',
  emergency_phone: 'in case of emergency',
  alt_phone: 'mobile no. (alternative)',
  bike: 'do you own a ronin bike',
  joined_at: 'timestamp',
  email: 'email address'
};

/** Run once. Installs the automatic trigger and copies everyone not yet in the app. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onFormSubmitSync').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitSync').forSpreadsheet(ss).onFormSubmit().create();
  syncAll();
}

/** Runs by itself for every new form submission. */
function onFormSubmitSync(e) {
  const sheet = e.range.getSheet();
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = sheet.getRange(e.range.getRow(), 1, 1, sheet.getLastColumn()).getValues()[0];
  const res = send_([toMember_(heads, row)]);
  console.log('Synced new registration: ' + res.join(', '));
}

/** Copies every row of the responses sheet. Safe to run any time: existing members are not changed. */
function syncAll() {
  const sheet = responsesSheet_();
  const data = sheet.getDataRange().getValues();
  const heads = data.shift();
  const members = data.map(r => toMember_(heads, r)).filter(m => m.phone && m.full_name);
  const results = [];
  for (let i = 0; i < members.length; i += 40) results.push(...send_(members.slice(i, i + 40)));
  const count = k => results.filter(r => String(r).indexOf(k) === 0).length;
  console.log(`Done. Added ${count('added')}, already in app ${count('exists')}, skipped ${count('skipped')}, errors ${count('error')}.`);
}

/* ---------- helpers ---------- */
function responsesSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheets().find(s => /form responses/i.test(s.getName())) || ss.getSheets()[0];
}

function send_(members) {
  const reqs = members.map(m => ({
    url: SUPABASE_URL + '/rest/v1/rpc/sheet_upsert_member',
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_secret: SYNC_SECRET, p: m })
  }));
  return UrlFetchApp.fetchAll(reqs).map((r, i) =>
    r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : 'error (' + members[i].full_name + '): ' + r.getContentText());
}

function toMember_(heads, row) {
  const col = {};
  heads.forEach((h, i) => {
    const t = String(h).trim().toLowerCase();
    Object.keys(COLUMNS).forEach(k => { if (col[k] === undefined && t.indexOf(COLUMNS[k]) === 0) col[k] = i; });
  });
  const v = k => col[k] === undefined ? '' : row[col[k]];
  const text = k => String(v(k) || '').replace(/\s+/g, ' ').trim();
  const digits = k => { const d = text(k).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : text(k); };
  const bike = text('bike');
  return {
    full_name: text('full_name'),
    dob: birthday_(v('dob')),
    phone: (String(v('phone')).replace(/\D/g, '')).slice(-10),
    email: text('email').toLowerCase(),
    vrn: text('vrn').toUpperCase(),
    bike: /^(yeah|yes)/i.test(bike) ? 'TVS Ronin 225' : bike,
    blood_group: text('blood_group'),
    locality: text('locality'),
    hideout: text('hideout'),
    emergency_phone: digits('emergency_phone'),
    alt_phone: digits('alt_phone'),
    joined_at: v('joined_at') instanceof Date ? Utilities.formatDate(v('joined_at'), 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ssXXX") : ''
  };
}

/* dd/mm/yyyy or a date cell → yyyy-mm-dd. A clearly wrong year keeps day + month with 1904 ("year unknown"). */
function birthday_(val) {
  let d, m, y;
  if (val instanceof Date) {
    const s = Utilities.formatDate(val, 'Asia/Kolkata', 'yyyy-MM-dd').split('-');
    y = +s[0]; m = +s[1]; d = +s[2];
  } else {
    const p = String(val || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (!p) return '';
    d = +p[1]; m = +p[2]; y = +p[3];
  }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  if (y < 1930 || y > new Date().getFullYear() - 10) y = 1904;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}


/* ======================= App → sheet ======================= */
const ADDED_VIA = 'Added via', UPDATED_IN_APP = 'Updated in app';

/** Open the web-app link in a browser to check it's running. */
function doGet() { return json_({ ok: true, service: 'RWB sheet sync' }); }

/** The app calls this when a member is approved in the app or changes their details. */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (!body || body.secret !== SYNC_SECRET) return json_({ ok: false, error: 'not allowed' });
  const m = body.member || {};
  if (!m.phone || !m.full_name) return json_({ ok: false, error: 'missing name or number' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet = responsesSheet_();
    const col = columns_(sheet);
    const last = sheet.getLastRow();
    const phones = last > 1 && col.phone !== undefined ? sheet.getRange(2, col.phone + 1, last - 1, 1).getValues().map(r => String(r[0]).replace(/\D/g, '').slice(-10)) : [];
    const find = p => { const i = p ? phones.indexOf(String(p).replace(/\D/g, '').slice(-10)) : -1; return i < 0 ? 0 : i + 2; };
    const rowNo = find(body.old_phone) || find(m.phone);
    const vals = sheetValues_(m);
    if (rowNo) {
      /* only filled-in values are written, so answers already in the sheet are never blanked */
      Object.keys(vals).forEach(k => { if (col[k] !== undefined && vals[k] !== '') sheet.getRange(rowNo, col[k] + 1).setValue(vals[k]); });
      sheet.getRange(rowNo, col.updated + 1).setValue(new Date());
      return json_({ ok: true, result: 'updated', row: rowNo });
    }
    const row = new Array(sheet.getLastColumn()).fill('');
    Object.keys(vals).forEach(k => { if (col[k] !== undefined) row[col[k]] = vals[k]; });
    if (col.joined_at !== undefined) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
    row[col.added] = 'RWB App';
    sheet.appendRow(row);
    return json_({ ok: true, result: 'added', row: sheet.getLastRow() });
  } finally { lock.releaseLock(); }
}

/** Column numbers (0-based) for each field, adding "Added via" / "Updated in app" at the end if missing. */
function columns_(sheet) {
  let heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  [ADDED_VIA, UPDATED_IN_APP].forEach(h => {
    if (!heads.some(x => String(x).trim().toLowerCase() === h.toLowerCase())) {
      sheet.getRange(1, heads.length + 1).setValue(h); heads = heads.concat(h);
    }
  });
  const col = {};
  heads.forEach((h, i) => {
    const t = String(h).trim().toLowerCase();
    Object.keys(COLUMNS).forEach(k => { if (col[k] === undefined && t.indexOf(COLUMNS[k]) === 0) col[k] = i; });
    if (t === ADDED_VIA.toLowerCase()) col.added = i;
    if (t === UPDATED_IN_APP.toLowerCase()) col.updated = i;
  });
  return col;
}

/* App member → the values written in the sheet (same style as the form answers) */
function sheetValues_(m) {
  const t = v => v == null ? '' : String(v);
  let dob = '';
  if (m.dob) { const p = String(m.dob).split('-'); dob = p[0] === '1904' ? p[2] + '/' + p[1] : p[2] + '/' + p[1] + '/' + p[0]; }
  const bike = t(m.bike);
  return {
    full_name: t(m.full_name), dob: dob, phone: t(m.phone), email: t(m.email), vrn: t(m.vrn),
    blood_group: t(m.blood_group), locality: t(m.locality), hideout: t(m.hideout),
    emergency_phone: t(m.emergency_phone), alt_phone: t(m.alt_phone),
    bike: /ronin/i.test(bike) ? 'Yes' : bike
  };
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
