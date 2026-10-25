/**
 * RWB App ⇄ RWB contact sheet (the Google Sheet with the join form responses)
 *
 * 1. Join form → approval: every new form entry goes to the app's approval list (it is not a member yet).
 *    Its row here says "Waiting for approval" in the "App · Status" column until an admin decides.
 *      Approved → "Member".   Rejected → the row moves to the "Rejected" tab (with the reason).
 * 2. Sheet → app: editing a member's details here (name, number, VRN, locality…) updates the app within seconds.
 * 3. App → sheet: members approved in the app get a row here; changes in the app (Me → Edit, bikes, VRN verified)
 *    update their row. Rows added by the app say "RWB App" in the "Added via" column.
 * 4. A member removed in the app is removed from this sheet; the row is first copied to the "Removed members" tab.
 *
 * SET-UP / UPDATE (keeps the same web address):
 *   a) Extensions → Apps Script → replace everything with this file → put your SYNC_SECRET back → Save.
 *   b) Choose "setup" in the function list → Run → allow access. (Installs the form and edit triggers.)
 *   c) Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *   d) Optional: run "addMissingFromApp" once to label every row's status and add anyone missing.
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
/* The join form's "rules / terms" question (if it has one): agreed when the answer says agree/understood */
const TNC_HEAD = /read carefully|agree|terms|t\s*&\s*c|tnc|rules|declar|consent/i;
/* Columns the app keeps up to date, added at the end of the sheet when missing */
const ADDED_VIA = 'Added via', UPDATED_IN_APP = 'Updated in app';
const APP_COLS = { status: 'App · Status', vrn_verified: 'App · VRN verified', bike2_vrn: 'App · Bike 2 VRN', bike2_model: 'App · Bike 2 model', bike3_vrn: 'App · Bike 3 VRN', bike3_model: 'App · Bike 3 model' };
const ST = { waiting: 'Waiting for approval', member: 'Member' };
/* Columns that update the app when an admin edits them here */
const EDITABLE = ['full_name', 'dob', 'phone', 'email', 'vrn', 'bike', 'blood_group', 'locality', 'hideout', 'emergency_phone', 'alt_phone', 'vrn_verified', 'bike2_vrn', 'bike2_model', 'bike3_vrn', 'bike3_model'];

/** Run once (and again after updating this file). Installs the automatic triggers. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().filter(t => ['onFormSubmitSync', 'onSheetEdit'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitSync').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  columns_(responsesSheet_());
  console.log('Ready: new form entries go to the approval list, and edits here update the app.');
}

/** Runs by itself for every new form submission: the entry waits for an admin in the app. */
function onFormSubmitSync(e) {
  const sheet = e.range.getSheet(), rowNo = e.range.getRow();
  const col = columns_(sheet);
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).getValues()[0];
  const res = send_([toMember_(heads, row)]);
  if (String(res[0]) === 'pending') sheet.getRange(rowNo, col.status + 1).setValue(ST.waiting);
  console.log('New form entry: ' + res.join(', '));
}

/** Runs by itself when someone edits this sheet: the changed details go to the app. */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getSheetId() !== responsesSheet_().getSheetId()) return;
  const r0 = e.range.getRow(), nr = e.range.getNumRows(), c0 = e.range.getColumn(), nc = e.range.getNumColumns();
  if (r0 + nr - 1 < 2) return;                                   // header row
  const col = columns_(sheet), byIdx = {};
  Object.keys(col).forEach(k => byIdx[col[k]] = k);
  const edited = [];
  for (let c = c0; c < c0 + nc; c++) { const k = byIdx[c - 1]; if (k && EDITABLE.includes(k)) edited.push(k); }
  if (!edited.length) return;
  const first = Math.max(2, r0), last = Math.min(r0 + nr - 1, first + 99);
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getRange(first, 1, last - first + 1, sheet.getLastColumn()).getValues();
  const reqs = [];
  rows.forEach(row => {
    const m = Object.assign(toMember_(heads, row), extras_(col, row)), p = {};
    edited.forEach(k => p[k] = m[k]);
    let old = m.phone;
    if (edited.includes('phone')) old = nr === 1 && nc === 1 && e.oldValue != null ? String(e.oldValue).replace(/\D/g, '').slice(-10) : '';
    if (!old && !m.phone) return;
    reqs.push(rpc_('sheet_edit_member', { p_secret: SYNC_SECRET, p: p, p_old_phone: old }));
  });
  if (!reqs.length) return;
  const out = UrlFetchApp.fetchAll(reqs).map(r => r.getContentText());
  console.log('Sheet edit sent to the app: ' + out.join(', '));
}

/** Sends every row to the app. Safe to run any time: rows already handled are skipped. */
function syncAll() {
  const sheet = responsesSheet_();
  const data = sheet.getDataRange().getValues();
  const heads = data.shift();
  const members = data.map(r => toMember_(heads, r)).filter(m => m.phone && m.full_name);
  const results = [];
  for (let i = 0; i < members.length; i += 40) results.push(...send_(members.slice(i, i + 40)));
  const count = k => results.filter(r => String(r).indexOf(k) === 0).length;
  console.log(`Done. New entries waiting for approval ${count('pending')}, already handled ${count('exists')}, skipped ${count('skipped')}, errors ${count('error')}.`);
}

/* ---------- helpers ---------- */
function responsesSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheets().find(s => /form responses/i.test(s.getName())) || ss.getSheets()[0];
}

function rpc_(fn, payload) {
  return {
    url: SUPABASE_URL + '/rest/v1/rpc/' + fn,
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify(payload)
  };
}

function send_(members) {
  return UrlFetchApp.fetchAll(members.map(m => rpc_('sheet_upsert_member', { p_secret: SYNC_SECRET, p: m }))).map((r, i) =>
    r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : 'error (' + members[i].full_name + '): ' + r.getContentText());
}

function toMember_(heads, row) {
  const col = {};
  let tnc;
  heads.forEach((h, i) => {
    const t = String(h).trim().toLowerCase();
    Object.keys(COLUMNS).forEach(k => { if (col[k] === undefined && t.indexOf(COLUMNS[k]) === 0) col[k] = i; });
    if (tnc === undefined && TNC_HEAD.test(t) && !t.startsWith('app ·')) tnc = i;
  });
  const v = k => col[k] === undefined ? '' : row[col[k]];
  const text = k => String(v(k) || '').replace(/\s+/g, ' ').trim();
  const digits = k => { const d = text(k).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : text(k); };
  const bike = text('bike');
  const agree = tnc === undefined ? '' : String(row[tnc] || '').trim();
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
    tnc: !agree ? '' : /(don'?t|do not|not agree|disagree|^no\b)/i.test(agree) ? 'no' : /(agree|understood|accept|yes|i do)/i.test(agree) ? 'yes' : '',
    joined_at: v('joined_at') instanceof Date ? Utilities.formatDate(v('joined_at'), 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ssXXX") : ''
  };
}
/* The app's own columns on a row: VRN verified and bikes 2 and 3 */
function extras_(col, row) {
  const t = k => col[k] === undefined ? '' : String(row[col[k]] || '').replace(/\s+/g, ' ').trim();
  return {
    vrn_verified: /^(yes|y|✓|✔|true|verified)$/i.test(t('vrn_verified')) ? 'yes' : 'no',
    bike2_vrn: t('bike2_vrn').toUpperCase(), bike2_model: t('bike2_model'),
    bike3_vrn: t('bike3_vrn').toUpperCase(), bike3_model: t('bike3_model')
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
/** Open the web-app link in a browser to check it's running. */
function doGet() { return json_({ ok: true, service: 'RWB sheet sync' }); }

/** The app calls this when a member is approved, changes their details, is removed, or an entry is decided. */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (!body || body.secret !== SYNC_SECRET) return json_({ ok: false, error: 'not allowed' });
  if (body.action === 'delete') return removeRows_(body.phone, body.full_name);
  if (body.action === 'status') return setStatus_(body);
  const m = body.member || {};
  if (!m.phone || !m.full_name) return json_({ ok: false, error: 'missing name or number' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet = responsesSheet_();
    const col = columns_(sheet);
    const last = sheet.getLastRow();
    const phones = last > 1 && col.phone !== undefined ? sheet.getRange(2, col.phone + 1, last - 1, 1).getValues().map(r => String(r[0]).replace(/\D/g, '').slice(-10)) : [];
    const find = p => { const i = p ? phones.lastIndexOf(String(p).replace(/\D/g, '').slice(-10)) : -1; return i < 0 ? 0 : i + 2; };
    const rowNo = find(body.old_phone) || find(m.phone);
    const vals = sheetValues_(m), app = appValues_(m);
    if (rowNo) {
      /* form answers: only filled-in values are written, so answers already in the sheet are never blanked */
      Object.keys(vals).forEach(k => { if (col[k] !== undefined && vals[k] !== '') sheet.getRange(rowNo, col[k] + 1).setValue(vals[k]); });
      /* the app's own columns always follow the app */
      Object.keys(app).forEach(k => { if (col[k] !== undefined) sheet.getRange(rowNo, col[k] + 1).setValue(app[k]); });
      sheet.getRange(rowNo, col.updated + 1).setValue(new Date());
      return json_({ ok: true, result: 'updated', row: rowNo });
    }
    const row = new Array(sheet.getLastColumn()).fill('');
    Object.keys(vals).forEach(k => { if (col[k] !== undefined) row[col[k]] = vals[k]; });
    Object.keys(app).forEach(k => { if (col[k] !== undefined) row[col[k]] = app[k]; });
    if (col.joined_at !== undefined) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
    row[col.added] = 'RWB App';
    sheet.appendRow(row);
    return json_({ ok: true, result: 'added', row: sheet.getLastRow() });
  } finally { lock.releaseLock(); }
}

/** An entry was approved or rejected in the app. */
function setStatus_(b) {
  const p10 = String(b.phone || '').replace(/\D/g, '').slice(-10);
  if (p10.length !== 10) return json_({ ok: false, error: 'missing number' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow(), width = sheet.getLastColumn();
    if (last < 2) return json_({ ok: true, result: 'not found' });
    const data = sheet.getRange(2, 1, last - 1, width).getValues();
    const mine = data.map((r, i) => ({ r: i + 2, row: r })).filter(x => String(x.row[col.phone]).replace(/\D/g, '').slice(-10) === p10);
    if (!mine.length) return json_({ ok: true, result: 'not found' });
    const at = x => x.row[col.joined_at] instanceof Date ? x.row[col.joined_at].getTime() : 0;
    const ts = b.form_ts ? new Date(b.form_ts).getTime() : 0;
    if (b.status === 'approved') {
      /* keep their newest row as the member's row; older duplicate entries move to a tab of their own */
      mine.sort((a, c) => at(c) - at(a));
      sheet.getRange(mine[0].r, col.status + 1).setValue(ST.member);
      const older = mine.slice(1);
      if (older.length) moveRows_(sheet, older.map(x => x.r), 'Older entries', 'Moved on', '');
      return json_({ ok: true, result: 'member', moved: older.length });
    }
    /* rejected: only the entry that was rejected leaves (an existing member's older row stays) */
    let hit = mine.filter(x => ts && Math.abs(at(x) - ts) < 2000);
    if (!hit.length) hit = mine.filter(x => String(x.row[col.status]) === ST.waiting);
    if (!hit.length) return json_({ ok: true, result: 'not found' });
    moveRows_(sheet, hit.map(x => x.r), 'Rejected', 'Rejected on', b.reason || '');
    return json_({ ok: true, result: 'rejected', rows: hit.length });
  } finally { lock.releaseLock(); }
}

/** Copies rows to another tab (with the date, and a note), then deletes them here, bottom-up. */
function moveRows_(sheet, rowNos, tabName, dateTitle, note) {
  const ss = SpreadsheetApp.getActive(), width = sheet.getLastColumn();
  let tab = ss.getSheetByName(tabName);
  if (!tab) { tab = ss.insertSheet(tabName); tab.appendRow([dateTitle, 'Note'].concat(sheet.getRange(1, 1, 1, width).getValues()[0])); }
  rowNos.forEach(r => tab.appendRow([new Date(), note].concat(sheet.getRange(r, 1, 1, width).getValues()[0])));
  rowNos.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
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

/** Column numbers (0-based) for each field, adding the app's columns at the end if missing. */
function columns_(sheet) {
  let heads = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  [ADDED_VIA, UPDATED_IN_APP].concat(Object.values(APP_COLS)).forEach(h => {
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
    Object.keys(APP_COLS).forEach(k => { if (t === APP_COLS[k].toLowerCase()) col[k] = i; });
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
/* The app's own columns */
function appValues_(m) {
  const t = v => v == null ? '' : String(v);
  return { status: ST.member, vrn_verified: m.vrn_verified ? 'Yes' : '', bike2_vrn: t(m.bike2_vrn), bike2_model: t(m.bike2_model), bike3_vrn: t(m.bike3_vrn), bike3_model: t(m.bike3_model) };
}

/* ======================= Catch-up ======================= */
/**
 * Adds every app member missing from this sheet (matched by WhatsApp number), and fills in the
 * "App · Status" column: Member, or Waiting for approval. Safe to run again: nobody is added twice.
 * Run it from the editor: choose "addMissingFromApp" → Run, then open the Execution log.
 */
function addMissingFromApp() {
  const r = UrlFetchApp.fetchAll([rpc_('sheet_export_members', { p_secret: SYNC_SECRET })])[0];
  if (r.getResponseCode() !== 200) throw new Error('Could not read the app members: ' + r.getContentText());
  const all = JSON.parse(r.getContentText()), members = all.filter(m => !m.pending), waiting = all.filter(m => m.pending);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow();
    if (col.phone === undefined) throw new Error('No "WhatsApp No" column found in ' + sheet.getName());
    const p10 = x => String(x || '').replace(/\D/g, '').slice(-10);
    const sheetPhones = last > 1 ? sheet.getRange(2, col.phone + 1, last - 1, 1).getValues().map(x => p10(x[0])) : [];
    const status = last > 1 ? sheet.getRange(2, col.status + 1, last - 1, 1).getValues() : [];
    const memberSet = new Set(members.map(m => p10(m.phone))), waitSet = new Set(waiting.map(m => p10(m.phone)));
    let labelled = 0;
    sheetPhones.forEach((p, i) => {
      const want = memberSet.has(p) ? ST.member : waitSet.has(p) ? ST.waiting : null;
      if (want && status[i][0] !== want) { status[i][0] = want; labelled++; }
    });
    if (status.length) sheet.getRange(2, col.status + 1, status.length, 1).setValues(status);
    const have = new Set(sheetPhones), added = [], noNumber = [], rows = [];
    let already = 0;
    members.forEach(m => {
      const p = p10(m.phone);
      if (p.length !== 10) { noNumber.push(m.full_name); return; }
      if (have.has(p)) { already++; return; }
      have.add(p);
      const vals = sheetValues_(m), app = appValues_(m), row = new Array(sheet.getLastColumn()).fill('');
      Object.keys(vals).forEach(k => { if (col[k] !== undefined) row[col[k]] = vals[k]; });
      Object.keys(app).forEach(k => { if (col[k] !== undefined) row[col[k]] = app[k]; });
      if (col.joined_at !== undefined) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
      row[col.added] = 'RWB App';
      rows.push(row); added.push(m.full_name + ' (' + p + ')');
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    console.log('Members: ' + members.length + '. Already in the sheet: ' + already + '. Added now: ' + added.length + '. Status labels updated: ' + labelled + '. Waiting for approval: ' + waiting.length + '.');
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
