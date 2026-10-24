/**
 * RWB App ⇄ RWB contact sheet (the Google Sheet with the join form responses)
 *
 * 1. Sheet → app: every new join-form registration reaches the app within seconds.
 * 2. App → sheet: members approved in the app get a new row here, and changes members make in
 *    the app (Me → Edit) update their row. Rows added by the app say "RWB App" in the "Added via" column.
 * 3. A member removed by an admin in the app is removed from this sheet. Their row is first copied to a
 *    "Removed members" tab (with the date), so nothing is lost by mistake.
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
  if (body.action === 'delete') return removeRows_(body.phone, body.full_name);
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

/** Removes every row with this WhatsApp number (people sometimes filled the form twice), keeping a copy. */
function removeRows_(phone, name) {
  const p10 = String(phone || '').replace(/\D/g, '').slice(-10);
  if (p10.length !== 10) return json_({ ok: false, error: 'missing number' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow(), width = sheet.getLastColumn();
    if (last < 2 || col.phone === undefined) return json_({ ok: true, result: 'not found' });
    const data = sheet.getRange(2, 1, last - 1, width).getValues();
    const rows = data.map((r, i) => String(r[col.phone]).replace(/\D/g, '').slice(-10) === p10 ? i + 2 : 0).filter(Boolean);
    if (!rows.length) return json_({ ok: true, result: 'not found' });
    const ss = SpreadsheetApp.getActive();
    let bin = ss.getSheetByName('Removed members');
    if (!bin) { bin = ss.insertSheet('Removed members'); bin.appendRow(['Removed on'].concat(sheet.getRange(1, 1, 1, width).getValues()[0])); }
    rows.forEach(r => bin.appendRow([new Date()].concat(data[r - 2])));
    rows.reverse().forEach(r => sheet.deleteRow(r));      // bottom-up so row numbers stay right
    return json_({ ok: true, result: 'removed', rows: rows.length, name: name || '' });
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

/* ======================= One-time catch-up ======================= */
/**
 * Adds every app member who is missing from this sheet (matched by WhatsApp number).
 * For members who were in the app before the sync was set up. Safe to run again: nobody is added twice
 * and existing rows are never changed. Run it from the editor: choose "addMissingFromApp" → Run,
 * then open View → Execution log to see who was added.
 */
function addMissingFromApp() {
  const r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/sheet_export_members', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_secret: SYNC_SECRET })
  });
  if (r.getResponseCode() !== 200) throw new Error('Could not read the app members: ' + r.getContentText());
  const members = JSON.parse(r.getContentText());
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow();
    if (col.phone === undefined) throw new Error('No "WhatsApp No" column found in ' + sheet.getName());
    const have = new Set(last > 1 ? sheet.getRange(2, col.phone + 1, last - 1, 1).getValues().map(x => String(x[0]).replace(/\D/g, '').slice(-10)) : []);
    const added = [], noNumber = [], rows = []; let already = 0;
    members.forEach(m => {
      const p10 = String(m.phone || '').replace(/\D/g, '').slice(-10);
      if (p10.length !== 10) { noNumber.push(m.full_name); return; }
      if (have.has(p10)) { already++; return; }
      have.add(p10);
      const vals = sheetValues_(m), row = new Array(sheet.getLastColumn()).fill('');
      Object.keys(vals).forEach(k => { if (col[k] !== undefined) row[col[k]] = vals[k]; });
      if (col.joined_at !== undefined) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
      row[col.added] = 'RWB App';
      rows.push(row); added.push(m.full_name + ' (' + p10 + ')');
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    console.log('App members: ' + members.length + '. Already in the sheet: ' + already + '. Added now: ' + added.length + '.');
    if (added.length) console.log('Added:\n' + added.join('\n'));
    if (noNumber.length) console.log('Not added (no WhatsApp number saved in the app, fix it in the app first):\n' + noNumber.join('\n'));
  } finally { lock.releaseLock(); }
}

/* ======================= Join form: same required questions as the app ======================= */
const FORM_ID = '1Grrq_WyGn7I_0-QsluloFMHJ9ENdOmhAJllpIiXym34';
/* Question title starts with → required? (the same answers the app asks for) */
const FORM_REQUIRED = {
  'full name': true, 'date of birth': true, 'whatsapp no': true, 'do you own a ronin bike': true, 'vrn': true,
  'blood group': true, 'current locality': true, 'in case of emergency': true,
  'permanent hideout': false, 'mobile no. (alternative)': false
};
/**
 * Run once from the editor: choose "fixJoinForm" → Run → allow access to Google Forms.
 * Marks the questions above as required (or optional) on the RWB join form and checks that the phone
 * answers look like real numbers. Question titles and order are not changed. The log lists every question.
 */
function fixJoinForm() {
  const form = FormApp.openById(FORM_ID);
  const phoneCheck = FormApp.createTextValidation().setHelpText('Please enter a 10-digit mobile number')
    .requireTextMatchesPattern('^[+]?[0-9][0-9 ()-]{8,16}[0-9]$').build();
  const seen = {};
  form.getItems().forEach((item, i) => {
    const title = String(item.getTitle()).trim(), t = title.toLowerCase();
    const key = Object.keys(FORM_REQUIRED).find(k => t.indexOf(k) === 0);
    let typed = null;
    switch (item.getType()) {
      case FormApp.ItemType.TEXT: typed = item.asTextItem(); break;
      case FormApp.ItemType.PARAGRAPH_TEXT: typed = item.asParagraphTextItem(); break;
      case FormApp.ItemType.MULTIPLE_CHOICE: typed = item.asMultipleChoiceItem(); break;
      case FormApp.ItemType.LIST: typed = item.asListItem(); break;
      case FormApp.ItemType.CHECKBOX: typed = item.asCheckboxItem(); break;
      case FormApp.ItemType.DATE: typed = item.asDateItem(); break;
    }
    let note = '';
    if (key && typed) {
      typed.setRequired(FORM_REQUIRED[key]); seen[key] = true;
      note = FORM_REQUIRED[key] ? 'REQUIRED' : 'optional';
      if (/whatsapp no|in case of emergency|mobile no/.test(key) && item.getType() === FormApp.ItemType.TEXT) { typed.setValidation(phoneCheck); note += ' + number check'; }
    }
    console.log((i + 1) + '. ' + title + '  [' + item.getType() + ']' + (note ? '  → ' + note : ''));
  });
  const missing = Object.keys(FORM_REQUIRED).filter(k => !seen[k]);
  if (missing.length) console.log('Not found on the form (check the titles): ' + missing.join(', '));
  console.log('Email is collected by the form itself (Settings → Responses → Collect email addresses).');
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
