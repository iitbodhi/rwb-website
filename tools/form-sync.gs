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
 * 5. Safety net, every 15 minutes (syncWithApp): VRNs lose their spaces, duplicate VRNs are tidied (the row with the most
 *    details and the T&C agreed stays), and every row is checked against the app and repaired: app changes are written
 *    here, anyone missing is added, removed / rejected entries move to their tabs, and gaps in the app are filled from here.
 *
 * SET-UP / UPDATE (keeps the same web address):
 *   a) Extensions → Apps Script → replace everything with this file → put your SYNC_SECRET back → Save.
 *   b) Choose "setup" in the function list → Run → allow access. (Installs the form and edit triggers.)
 *   c) Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *   d) Optional: run "addMissingFromApp" once to label every row's status and add anyone missing.
 * The app's join form copies the Google Form (questions, choices, required answers, the "read carefully" part).
 * It updates by itself every hour; after editing the form, run "publishForm" to update the app straight away.
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
const EDITABLE = ['full_name', 'dob', 'phone', 'email', 'vrn', 'bike', 'blood_group', 'locality', 'hideout', 'emergency_phone', 'alt_phone', 'vrn_verified', 'bike2_vrn', 'bike2_model', 'bike3_vrn', 'bike3_model', 'tnc'];
const AGREED = 'I have read and agree to the RWB Terms & Conditions and Privacy Policy', NOT_AGREED = "I don't agree";   // written in the "read carefully" column for answers given in the app

/** Run once (and again after updating this file). Installs the automatic triggers. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().filter(t => ['onFormSubmitSync', 'onSheetEdit', 'publishForm', 'syncAnswers', 'syncWithApp'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitSync').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('publishForm').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncAnswers').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('syncWithApp').timeBased().everyMinutes(15).create();
  columns_(responsesSheet_());
  makeTabs_();
  console.log('Working on the tab "' + responsesSheet_().getName() + '"');
  registerWebhook_();
  publishForm();
  syncTnc();
  syncAnswers();
  syncWithApp();
  console.log('Ready: new form entries go to the approval list, edits here update the app, the app shows the same join form, and the sheet is checked against the app every 15 minutes.');
}

/** Runs by itself for every new form submission: the entry waits for an admin in the app. */
function onFormSubmitSync(e) {
  const sheet = e.range.getSheet(), rowNo = e.range.getRow();
  const col = columns_(sheet);
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (col.vrn !== undefined && cleanVrn_(row[col.vrn]) !== String(row[col.vrn])) { row[col.vrn] = cleanVrn_(row[col.vrn]); sheet.getRange(rowNo, col.vrn + 1).setValue(row[col.vrn]); }
  const m = toMember_(heads, row);
  const res = send_([m]);
  if (String(res[0]) === 'pending') {
    sheet.getRange(rowNo, col.status + 1).setValue(ST.waiting);
    UrlFetchApp.fetchAll([rpc_('sheet_upsert_member_answers', { p_secret: SYNC_SECRET, p_phone: m.phone, p_answers: answers_(heads, row) })]);
  }
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
  /* the Timestamp (when they joined) was changed by hand: the app's "Member since" follows */
  if (col.joined_at !== undefined && col.joined_at + 1 >= c0 && col.joined_at + 1 < c0 + nc) {
    const f = Math.max(2, r0), l = Math.min(r0 + nr - 1, f + 99);
    const vals = sheet.getRange(f, 1, l - f + 1, sheet.getLastColumn()).getValues();
    const rows = vals.map(r => ({ phone: p10_(r[col.phone]), joined_at: r[col.joined_at] instanceof Date ? r[col.joined_at].toISOString() : '' })).filter(x => x.phone.length === 10 && x.joined_at);
    if (rows.length) console.log('Join date sent to the app: ' + UrlFetchApp.fetchAll([rpc_('sheet_set_joined', { p_secret: SYNC_SECRET, p_rows: rows })])[0].getContentText());
  }
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
/* The tab the join form writes into. Set the exact name here if the tab is ever renamed. */
const RESPONSES_TAB = 'Form responses 3';
let responsesCache_;
function responsesSheet_() {
  if (responsesCache_) return responsesCache_;
  const ss = SpreadsheetApp.getActive(), all = ss.getSheets();
  const byName = RESPONSES_TAB && ss.getSheetByName(RESPONSES_TAB);
  /* else: the visible tab linked to the join form (old, hidden response tabs are never used) */
  const linked = all.filter(s => { try { return !!s.getFormUrl(); } catch (e) { return false; } });
  const named = all.filter(s => /form responses/i.test(s.getName()));
  responsesCache_ = byName || linked.find(s => String(s.getFormUrl()).indexOf(FORM_ID) >= 0 && !s.isSheetHidden()) || linked.find(s => !s.isSheetHidden())
    || named.find(s => !s.isSheetHidden()) || linked[0] || named[0] || all[0];
  return responsesCache_;
}
/** Run from the editor to see which tab the script works on, and every tab in this spreadsheet. */
function whichTab() {
  console.log('Working on: "' + responsesSheet_().getName() + '"');
  SpreadsheetApp.getActive().getSheets().forEach(s => { let f = ''; try { f = s.getFormUrl() || ''; } catch (e) { /* none */ }
    console.log('- ' + s.getName() + (s.isSheetHidden() ? ' (hidden)' : '') + (f ? ' (linked to a form)' : '') + ', ' + (s.getLastRow() - 1) + ' rows'); });
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
/* Every answer on a row, by question title (what admins see under "All answers") */
function answers_(heads, row) {
  const skip = /^(timestamp|added via|updated in app|app ·)/i, out = {};
  heads.forEach((h, i) => {
    const t = String(h).trim(); let v = row[i];
    if (!t || skip.test(t) || isHelperHead_(t) || v === '' || v == null) return;
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Kolkata', /date of birth/i.test(t) ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm');
    out[t] = String(v);
  });
  return out;
}

/**
 * Sends the join form's questions to the app, so the app's join form is the same: pages, titles, help text,
 * choices, required answers and the "read carefully" agreement. Runs every hour by itself (and from setup).
 * Edited the form? Run "publishForm" once to update the app straight away.
 */
function publishForm() {
  const form = FormApp.openById(FORM_ID), T = FormApp.ItemType, items = [];
  const typed = it => ({ [T.TEXT]: () => it.asTextItem(), [T.PARAGRAPH_TEXT]: () => it.asParagraphTextItem(), [T.MULTIPLE_CHOICE]: () => it.asMultipleChoiceItem(),
    [T.LIST]: () => it.asListItem(), [T.CHECKBOX]: () => it.asCheckboxItem(), [T.DATE]: () => it.asDateItem(), [T.SCALE]: () => it.asScaleItem() })[it.getType()];
  form.getItems().forEach(it => {
    const type = String(it.getType()), base = { type: type, title: it.getTitle(), help: it.getHelpText() || '' };
    if (it.getType() === T.PAGE_BREAK || it.getType() === T.SECTION_HEADER) { items.push(base); return; }
    const make = typed(it); if (!make) return;             // images, videos and grids are left out
    const q = make();
    base.required = !!q.isRequired();
    if (q.getChoices) base.choices = q.getChoices().map(c => {
      let nav = '';
      try { const n = c.getPageNavigationType(); nav = n === FormApp.PageNavigationType.SUBMIT ? 'submit' : ''; } catch (e) { /* no navigation */ }
      return { value: c.getValue(), ends: nav === 'submit' };
    });
    if (it.getType() === T.MULTIPLE_CHOICE || it.getType() === T.CHECKBOX) { try { base.other = q.hasOtherOption(); } catch (e) { /* ignore */ } }
    if (it.getType() === T.DATE) { try { base.year = q.includesYear(); } catch (e) { base.year = true; } }
    if (it.getType() === T.SCALE) { base.low = q.getLowerBound(); base.high = q.getUpperBound(); }
    items.push(base);
  });
  let collects = true; try { collects = form.collectsEmail(); } catch (e) { /* ignore */ }
  const payload = { title: form.getTitle(), description: form.getDescription() || '', collectsEmail: collects, items: items, updated: new Date().toISOString() };
  const r = UrlFetchApp.fetchAll([rpc_('sheet_set_join_form', { p_secret: SYNC_SECRET, p_form: payload })])[0];
  console.log('Join form sent to the app (' + items.length + ' items): ' + r.getContentText());
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
    const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const extra = {};   // answers to other form questions, written into the column with the same title
    Object.keys(m.answers || {}).forEach(t => { const i = heads.indexOf(String(t).trim()); if (i >= 0 && !Object.values(col).includes(i)) extra[i] = m.answers[t]; });
    if (rowNo) {
      Object.keys(extra).forEach(i => { if (extra[i] !== '' && extra[i] != null) sheet.getRange(rowNo, +i + 1).setValue(extra[i]); });
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
    Object.keys(extra).forEach(i => { row[+i] = extra[i]; });
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

/** The tabs rows move to (made here so admins can see them from day one; rows arrive as things happen). */
function makeTabs_() {
  const ss = SpreadsheetApp.getActive(), sheet = responsesSheet_();
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  [['Removed members', ['Removed on']], ['Rejected', ['Rejected on', 'Note']], ['Older entries', ['Moved on', 'Note']]].forEach(([name, first]) => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name).appendRow(first.concat(heads));
  });
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
    if (col.tnc === undefined && TNC_HEAD.test(t) && !t.startsWith('app ·')) col.tnc = i;
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
/* The app's own columns (and the rules answer, when the app knows it) */
function appValues_(m) {
  const t = v => v == null ? '' : String(v);
  return { ...(m.tnc_agreed == null ? {} : { tnc: m.tnc_agreed ? AGREED : NOT_AGREED }), status: ST.member, vrn_verified: m.vrn_verified ? 'Yes' : '', bike2_vrn: t(m.bike2_vrn), bike2_model: t(m.bike2_model), bike3_vrn: t(m.bike3_vrn), bike3_model: t(m.bike3_model) };
}

/**
 * Tells the app who agreed to the RWB rules on the join form (the "read carefully" answer on each row).
 * Members whose row has no answer stay "not agreed yet": admins see them, and the app asks them to agree.
 * Runs from setup; safe to run again (answers given later in the app are never overwritten).
 */
function syncTnc() {
  const sheet = responsesSheet_(), data = sheet.getDataRange().getValues(), heads = data.shift();
  const rows = data.map(r => toMember_(heads, r)).filter(m => m.phone && (m.tnc === 'yes' || m.tnc === 'no')).map(m => ({ phone: m.phone, tnc: m.tnc }));
  let n = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const r = UrlFetchApp.fetchAll([rpc_('sheet_set_tnc', { p_secret: SYNC_SECRET, p_rows: rows.slice(i, i + 400) })])[0];
    n += Number(r.getContentText()) || 0;
  }
  console.log('Rules answers found on ' + rows.length + ' rows; ' + n + ' members updated in the app.' + (rows.length ? '' : ' (No "read carefully" column was found: everyone will be asked to agree in the app.)'));
}

/**
 * Copies every row's join-form answers (sticker, social media and the rest) into the app, so members see
 * them in Me and admins in each profile. Runs from setup and then every night by itself. Safe to run again.
 */
function syncAnswers() {
  const sheet = responsesSheet_(), data = sheet.getDataRange().getValues(), heads = data.shift();
  const rows = data.map(r => ({ phone: toMember_(heads, r).phone, answers: answers_(heads, r) })).filter(x => x.phone && Object.keys(x.answers).length);
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const r = UrlFetchApp.fetchAll([rpc_('sheet_set_answers', { p_secret: SYNC_SECRET, p_rows: rows.slice(i, i + 100) })])[0];
    if (r.getResponseCode() >= 300) { console.log('Answers not sent (run setup file 32 in Supabase first): ' + r.getContentText().slice(0, 200)); return; }
    n += Number(r.getContentText()) || 0;
  }
  console.log('Answers sent for ' + rows.length + ' rows; ' + n + ' members updated in the app.');
}

/* ======================= Safety net: the sheet always matches the app ======================= */
/* Column titles that are just numbers (helper / count columns) are not form questions */
function isHelperHead_(t) { return /^\s*[0-9.]*\s*$/.test(String(t)); }
/* WB 02 AB-1234 → WB02AB1234 */
function cleanVrn_(v) { const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length >= 4 ? s : String(v == null ? '' : v).trim(); }
const p10_ = x => String(x == null ? '' : x).replace(/\D/g, '').slice(-10);

/** Tells the app this sheet's web address, so its instant updates always arrive here. */
function registerWebhook_() {
  let url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not deployed yet */ }
  if (!/\/exec$/.test(url)) { console.log('Web app not deployed yet (Deploy → New deployment → Web app), so instant updates from the app are off. The 15-minute check still works.'); return; }
  const r = UrlFetchApp.fetchAll([rpc_('sheet_set_webhook', { p_secret: SYNC_SECRET, p_url: url })])[0];
  console.log('Web address sent to the app: ' + r.getContentText());
}

/**
 * Runs every 15 minutes by itself (and from setup). Safe to run any time from the editor too.
 *   1. VRNs: spaces and dashes removed.
 *   2. Duplicate VRNs: the row with the most details and the T&C agreed stays; the others move to "Older entries"
 *      (their duplicate member in the app is archived under Left / removed, never someone using the app).
 *   3. Every member's row is checked against the app: app details are written here, missing members are added,
 *      removed members and rejected entries move to their tabs, and empty details in the app are filled from here.
 */
function syncWithApp() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('Another sync is running; skipped.'); return; }
  try {
    const vr = tidyVrns_();          // first, so members archived as duplicates aren't added back below
    const exp = UrlFetchApp.fetchAll([rpc_('sheet_export_all', { p_secret: SYNC_SECRET })])[0];
    if (exp.getResponseCode() !== 200) { console.log('Could not read the app (run setup file 34 in Supabase first): ' + exp.getContentText().slice(0, 200)); return; }
    const app = JSON.parse(exp.getContentText());
    const rc = reconcile_(app);
    console.log('Sync done. VRNs cleaned: ' + vr.cleaned + '. Duplicate VRN rows moved: ' + vr.moved + (vr.archived ? ' (archived in the app: ' + vr.archived + ')' : '') +
      '. Cells updated from the app: ' + rc.cells + ' on ' + rc.rows + ' rows. Added: ' + rc.added + '. Moved to Removed members: ' + rc.removed +
      '. Moved to Rejected: ' + rc.rejected + '. Older duplicate rows moved: ' + rc.older + '. App details filled from the sheet: ' + rc.filled + '.');
    if (vr.review.length) console.log('Please check by hand (both are on the app, nothing was changed):\n' + vr.review.join('\n'));
  } finally { lock.releaseLock(); }
}

/** See what the duplicate-VRN tidy-up would do, without changing anything. */
function previewDuplicates() { const r = tidyVrns_(true); console.log((r.plan.join('\n') || 'No duplicate VRNs.') + (r.review.length ? '\nCheck by hand:\n' + r.review.join('\n') : '')); }

function tidyVrns_(dry) {
  const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow(), width = sheet.getLastColumn(), out = { cleaned: 0, moved: 0, archived: 0, review: [], plan: [] };
  if (last < 2 || col.vrn === undefined) return out;
  const data = sheet.getRange(2, 1, last - 1, width).getValues(), heads = sheet.getRange(1, 1, 1, width).getValues()[0];
  /* 1. no spaces in VRNs (main bike, bikes 2 and 3) */
  ['vrn', 'bike2_vrn', 'bike3_vrn'].forEach(k => {
    if (col[k] === undefined) return;
    const cells = []; let n = 0;
    data.forEach(r => { const c = cleanVrn_(r[col[k]]); if (c !== String(r[col[k]])) { r[col[k]] = c; n++; } cells.push([r[col[k]]]); });
    if (n && !dry) { writeColumn_(sheet, col[k], cells); out.cleaned += n; }
  });
  /* 2. duplicate VRNs */
  const groups = {};
  data.forEach((r, i) => {
    const v = cleanVrn_(r[col.vrn]); if (v.length < 6 || String(r[col.status]) === ST.waiting) return;
    (groups[v] = groups[v] || []).push(i);
  });
  const dups = Object.keys(groups).filter(v => groups[v].length > 1);
  if (!dups.length) return out;
  const phones = [...new Set([].concat(...dups.map(v => groups[v].map(i => p10_(data[i][col.phone])))))].filter(p => p.length === 10);
  const ow = UrlFetchApp.fetchAll([rpc_('sheet_vrn_owners', { p_secret: SYNC_SECRET, p_phones: phones })])[0];
  if (ow.getResponseCode() !== 200) { out.review.push('Duplicate VRNs not tidied: run setup file 34 in Supabase first.'); return out; }
  const own = JSON.parse(ow.getContentText() || '{}') || {};
  const agreed = r => col.tnc !== undefined && /(agree|understood|accept|yes)/i.test(String(r[col.tnc])) && !/(don'?t|not agree|disagree)/i.test(String(r[col.tnc]));
  const filled = r => r.filter((x, c) => x !== '' && x != null && !isHelperHead_(heads[c])).length;
  const when = r => col.joined_at !== undefined && r[col.joined_at] instanceof Date ? r[col.joined_at].getTime() : 0;
  const score = i => { const r = data[i], o = own[p10_(r[col.phone])] || {};
    return (o.on_app ? 1e9 : 0) + (o.status === 'active' ? 1e8 : 0) + (agreed(r) || o.tnc ? 1e7 : 0) + filled(r) * 1e4 + when(r) / 1e10; };
  const move = [], archive = [];
  dups.forEach(v => {
    const rows = groups[v].slice().sort((a, b) => score(b) - score(a)), keep = rows[0], keepPhone = p10_(data[keep][col.phone]), keepName = String(data[keep][col.full_name] || '');
    rows.slice(1).forEach(i => {
      const p = p10_(data[i][col.phone]), o = own[p] || {}, name = String(data[i][col.full_name] || '');
      if (p !== keepPhone && o.on_app) { out.review.push(v + ': ' + keepName + ' and ' + name + ' (' + p + ') both use the app'); return; }
      move.push({ i: i, note: 'Duplicate VRN ' + v + ' (kept ' + keepName + ')' });
      if (p !== keepPhone && o.status === 'active') archive.push({ phone: p, vrn: v, kept: keepName });
      out.plan.push(v + ': keep ' + keepName + ' (' + keepPhone + '), move ' + name + ' (' + p + ')' + (p !== keepPhone && o.status === 'active' ? ' and archive them in the app' : ''));
    });
  });
  if (dry || !move.length) return out;
  if (archive.length) out.archived = Number(UrlFetchApp.fetchAll([rpc_('sheet_archive_duplicates', { p_secret: SYNC_SECRET, p_rows: archive })])[0].getContentText()) || 0;
  moveRowsFast_(sheet, data, move, 'Older entries', 'Moved on');
  out.moved = move.length;
  return out;
}

/* a birthday in any form (date cell, dd/mm/yyyy, dd/mm, yyyy-mm-dd) → yyyy-mm-dd, year 1904 when unknown */
function dobKey_(v) {
  if (v instanceof Date) return birthday_(v);
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dm = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (dm) return '1904-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0');
  return birthday_(s);
}
/* the app's value and the sheet's value mean the same thing? */
function same_(k, a, b) {
  const t = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().toLowerCase();
  if (/phone/.test(k)) return p10_(a) === p10_(b);
  if (/vrn$/.test(k) && k !== 'vrn_verified') return cleanVrn_(a) === cleanVrn_(b);
  if (k === 'dob') return dobKey_(a) === dobKey_(b);
  if (k === 'blood_group') { const g = x => t(x).replace(/\s|ve\b/g, '').replace(/pos(itive)?/, '+').replace(/neg(ative)?/, '-'); return g(a) === g(b); }
  if (k === 'bike') { const g = x => /yeah|yes|ronin/i.test(String(x)) ? 'ronin' : t(x); return g(a) === g(b); }
  if (k === 'tnc') { const g = x => !t(x) ? '' : /(don'?t|not agree|disagree)/i.test(String(x)) ? 'no' : /(agree|understood|accept|yes)/i.test(String(x)) ? 'yes' : t(x); return g(a) === g(b); }
  if (k === 'vrn_verified') { const g = x => /^(yes|y|✓|✔|true|verified)$/i.test(t(x)) ? 'yes' : ''; return g(a) === g(b); }
  return t(a instanceof Date ? Utilities.formatDate(a, 'Asia/Kolkata', 'dd/MM/yyyy') : a) === t(b instanceof Date ? Utilities.formatDate(b, 'Asia/Kolkata', 'dd/MM/yyyy') : b);
}

function reconcile_(app) {
  const sheet = responsesSheet_(), col = columns_(sheet), width = sheet.getLastColumn(), last = sheet.getLastRow();
  const heads = sheet.getRange(1, 1, 1, width).getValues()[0].map(h => String(h).trim());
  const data = last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
  const out = { cells: 0, rows: 0, added: 0, removed: 0, rejected: 0, older: 0, filled: 0 };
  const byPhone = {}, byEmail = {};
  data.forEach((r, i) => {
    const p = p10_(r[col.phone]); if (p.length === 10) (byPhone[p] = byPhone[p] || []).push(i);
    const e = col.email === undefined ? '' : String(r[col.email] || '').trim().toLowerCase(); if (e) (byEmail[e] = byEmail[e] || []).push(i);
  });
  const waiting = new Set((app.waiting || []).map(w => p10_(w.phone)));
  const active = (app.members || []).filter(m => m.status === 'active'), activeSet = new Set(active.map(m => p10_(m.phone)));
  const changed = {}, touched = new Set(), gone = new Set(), fills = [], appends = [];
  const put = (i, c, v) => { if (c === undefined || c < 0) return; data[i][c] = v; (changed[c] = changed[c] || new Set()).add(i); touched.add(i); out.cells++; };
  const move = { older: [], removed: [], rejected: [] };
  const coreKeys = ['full_name', 'dob', 'phone', 'email', 'vrn', 'bike', 'blood_group', 'locality', 'hideout', 'emergency_phone', 'alt_phone'];
  const filledCount = r => r.filter(x => x !== '' && x != null).length;

  active.forEach(m => {
    const p = p10_(m.phone), em = String(m.email || '').trim().toLowerCase();
    if (p.length !== 10) return;
    let rows = (byPhone[p] || []).filter(i => !gone.has(i));
    if (!rows.length && em) rows = (byEmail[em] || []).filter(i => !gone.has(i) && !activeSet.has(p10_(data[i][col.phone])));
    if (waiting.has(p)) rows = rows.filter(i => String(data[i][col.status]) !== ST.waiting);   // their new entry waits for an admin
    if (!rows.length) {
      if (waiting.has(p) && (byPhone[p] || []).length) return;
      const vals = sheetValues_(m), a = appValues_(m), row = new Array(width).fill('');
      Object.keys(vals).forEach(k => { if (col[k] !== undefined) row[col[k]] = vals[k]; });
      Object.keys(a).forEach(k => { if (col[k] !== undefined) row[col[k]] = a[k]; });
      answerCells_(heads, col, m.answers).forEach(([c, v]) => { row[c] = v; });
      if (col.joined_at !== undefined) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
      row[col.added] = 'RWB App'; if (col.updated !== undefined) row[col.updated] = new Date();
      appends.push(row); return;
    }
    /* their row: the member's row, else the fullest one; older copies with the same number move away */
    rows.sort((a, b) => (String(data[b][col.status]) === ST.member) - (String(data[a][col.status]) === ST.member) || filledCount(data[b]) - filledCount(data[a]));
    const i = rows[0];
    rows.slice(1).forEach(j => { if (p10_(data[j][col.phone]) === p) { move.older.push({ i: j, note: 'Older entry of ' + m.full_name }); gone.add(j); } });
    const row = data[i], sm = toMember_(heads, row), vals = sheetValues_(m), fill = {};
    coreKeys.forEach(k => {
      if (col[k] === undefined) return;
      const appHas = m[k] != null && String(m[k]).trim() !== '', sheetHas = String(row[col[k]] == null ? '' : row[col[k]]).trim() !== '';
      if (!appHas) { if (sheetHas && sm[k]) fill[k] = sm[k]; return; }
      if (!same_(k, row[col[k]], k === 'bike' ? vals.bike : m[k])) put(i, col[k], vals[k]);
    });
    if (Object.keys(fill).length) fills.push(Object.assign({ phone: p }, fill));
    const a = appValues_(m);
    Object.keys(a).forEach(k => { if (col[k] !== undefined && !same_(k, row[col[k]], a[k])) put(i, col[k], a[k]); });
    answerCells_(heads, col, m.answers).forEach(([c, v]) => { if (!same_('answer', row[c], v)) put(i, c, v); });
  });

  /* members who left or were removed in the app: their rows go to "Removed members" */
  (app.members || []).filter(m => m.status !== 'active' && !activeSet.has(p10_(m.phone))).forEach(m => {
    const p = p10_(m.phone); if (waiting.has(p)) return;
    (byPhone[p] || []).forEach(i => { if (!gone.has(i) && String(data[i][col.status]) !== ST.waiting) { move.removed.push({ i: i, note: (m.status === 'left' ? 'Left' : 'Removed') + (m.removed_note ? ': ' + m.removed_note : '') }); gone.add(i); } });
  });
  /* entries an admin rejected in the app */
  (app.rejected || []).forEach(r => {
    const p = p10_(r.phone); if (activeSet.has(p) || waiting.has(p)) return;
    (byPhone[p] || []).forEach(i => { if (!gone.has(i) && String(data[i][col.status]) === ST.waiting) { move.rejected.push({ i: i, note: r.reason || '' }); gone.add(i); } });
  });
  /* entries waiting for an admin are labelled */
  waiting.forEach(p => { if (activeSet.has(p)) return; (byPhone[p] || []).forEach(i => { if (!gone.has(i) && !String(data[i][col.status])) put(i, col.status, ST.waiting); }); });

  /* write: whole columns at once where the column has no formulas, else cell by cell */
  touched.forEach(i => { if (col.updated !== undefined && !gone.has(i)) { data[i][col.updated] = new Date(); (changed[col.updated] = changed[col.updated] || new Set()).add(i); } });
  Object.keys(changed).forEach(c => {
    c = +c; const rowsSet = changed[c], f = sheet.getRange(2, c + 1, data.length, 1).getFormulas();
    if (f.every(x => !x[0])) writeColumn_(sheet, c, data.map(r => [r[c]]));
    else rowsSet.forEach(i => { if (!f[i][0]) sheet.getRange(i + 2, c + 1).setValue(data[i][c]); });
  });
  out.rows = [...touched].filter(i => !gone.has(i)).length;
  if (appends.length) { sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, width).setValues(appends); out.added = appends.length; }
  /* moves last (rows below shift up), all three tabs in one pass */
  const all = [].concat(move.older.map(x => Object.assign({ tab: 'Older entries', title: 'Moved on' }, x)), move.removed.map(x => Object.assign({ tab: 'Removed members', title: 'Removed on' }, x)), move.rejected.map(x => Object.assign({ tab: 'Rejected', title: 'Rejected on' }, x)));
  ['Older entries', 'Removed members', 'Rejected'].forEach(t => { const list = all.filter(x => x.tab === t); if (list.length) copyRows_(sheet, data, list, t, list[0].title); });
  [...new Set(all.map(x => x.i))].sort((a, b) => b - a).forEach(i => sheet.deleteRow(i + 2));
  out.older = move.older.length; out.removed = move.removed.length; out.rejected = move.rejected.length;
  for (let k = 0; k < fills.length; k += 100) out.filled += Number(UrlFetchApp.fetchAll([rpc_('sheet_fill_members', { p_secret: SYNC_SECRET, p_rows: fills.slice(k, k + 100) })])[0].getContentText()) || 0;
  return out;
}

/* the member's other answers (sticker, social media…) → [column, value] for columns with the same title */
function answerCells_(heads, col, answers) {
  const own = new Set(Object.values(col)), out = [];
  Object.keys(answers || {}).forEach(t => {
    const c = heads.indexOf(String(t).trim()), v = answers[t];
    if (c < 0 || own.has(c) || isHelperHead_(t) || v == null || String(v).trim() === '') return;
    out.push([c, v]);
  });
  return out;
}

function writeColumn_(sheet, c, cells) { if (cells.length) sheet.getRange(2, c + 1, cells.length, 1).setValues(cells); }

/* copy rows (by index in data) to a tab with a date and a note, in one write */
function copyRows_(sheet, data, list, tabName, dateTitle) {
  const ss = SpreadsheetApp.getActive(), width = sheet.getLastColumn();
  let tab = ss.getSheetByName(tabName);
  const first = tabName === 'Removed members' ? [dateTitle] : [dateTitle, 'Note'];
  if (!tab) { tab = ss.insertSheet(tabName); tab.appendRow(first.concat(sheet.getRange(1, 1, 1, width).getValues()[0])); }
  const rows = list.map(x => (tabName === 'Removed members' ? [new Date()] : [new Date(), x.note || '']).concat(data[x.i]));
  const w = Math.max(...rows.map(r => r.length)); rows.forEach(r => { while (r.length < w) r.push(''); });
  tab.getRange(tab.getLastRow() + 1, 1, rows.length, w).setValues(rows);
}
function moveRowsFast_(sheet, data, list, tabName, dateTitle) {
  copyRows_(sheet, data, list, tabName, dateTitle);
  [...new Set(list.map(x => x.i))].sort((a, b) => b - a).forEach(i => sheet.deleteRow(i + 2));
}

/* ======================= Coloured rows: red = removed (broke the T&C), grey = left ======================= */
const COLOUR_NOTES = { removed: 'Violated the RWB Terms & Conditions', left: 'Left RWB' };
/* a row's colour (the colour most of its cells have) → 'removed' (red), 'left' (grey) or '' */
function rowKind_(bgs) {
  const count = {}; bgs.forEach(c => { c = String(c).toLowerCase(); if (c !== '#ffffff' && c !== 'white') count[c] = (count[c] || 0) + 1; });
  const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  if (!top || count[top] < bgs.length / 2) return { kind: '', colour: top || '' };
  const m = top.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/); if (!m) return { kind: '', colour: top };
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16));
  if (r >= 190 && g <= 120 && b <= 120 && r - g >= 90) return { kind: 'removed', colour: top };
  if (Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12 && r >= 100 && r <= 200) return { kind: 'left', colour: top };
  return { kind: '', colour: top };
}
function colouredRows_() {
  const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow(), width = sheet.getLastColumn();
  if (last < 2) return { sheet: sheet, col: col, data: [], list: [], colours: {} };
  const data = sheet.getRange(2, 1, last - 1, width).getValues(), bgs = sheet.getRange(2, 1, last - 1, width).getBackgrounds();
  const list = [], colours = {};
  bgs.forEach((row, i) => {
    const k = rowKind_(row); if (k.colour) colours[k.colour] = (colours[k.colour] || 0) + 1;
    if (k.kind) list.push({ i: i, kind: k.kind, colour: k.colour, name: String(data[i][col.full_name] || ''), phone: p10_(data[i][col.phone]), vrn: col.vrn === undefined ? '' : String(data[i][col.vrn] || '') });
  });
  return { sheet: sheet, col: col, data: data, list: list, colours: colours };
}
/** See which rows are red (removed) or grey (left), without changing anything. */
function previewColouredRows() {
  const c = colouredRows_();
  console.log('Row colours found: ' + JSON.stringify(c.colours) + ' (red = removed, grey = left; other colours like yellow are left alone)');
  console.log(c.list.length ? c.list.map(x => (x.kind === 'removed' ? 'RED  → Removed: ' : 'GREY → Left:    ') + x.name + ' (' + x.phone + (x.vrn ? ', ' + x.vrn : '') + ')').join('\n') : 'No red or grey rows.');
}
/**
 * Red rows: removed from RWB for breaking the T&C. Grey rows: left RWB.
 * Each is marked so in the app (RWB → Left / removed, with the note; they can be restored there) and the row moves
 * to the "Removed members" tab (its App · Status says why). Run previewColouredRows first to check the list.
 */
function moveColouredRows() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const c = colouredRows_();
    if (!c.list.length) { console.log('No red or grey rows.'); return; }
    const r = UrlFetchApp.fetchAll([rpc_('sheet_mark_gone', { p_secret: SYNC_SECRET, p_rows: c.list.filter(x => x.phone.length === 10).map(x => ({ phone: x.phone, status: x.kind, note: COLOUR_NOTES[x.kind] })) })])[0];
    if (r.getResponseCode() !== 200) { console.log('Not done (run setup file 35 in Supabase first): ' + r.getContentText().slice(0, 200)); return; }
    const res = JSON.parse(r.getContentText() || '{}');
    c.list.forEach(x => { if (c.col.status !== undefined) c.data[x.i][c.col.status] = x.kind === 'removed' ? 'Removed: ' + COLOUR_NOTES.removed : COLOUR_NOTES.left; });
    moveRowsFast_(c.sheet, c.data, c.list.map(x => ({ i: x.i })), 'Removed members', 'Removed on');
    console.log('Moved ' + c.list.length + ' rows to "Removed members".\n' + c.list.map(x => (x.kind === 'removed' ? 'Removed: ' : 'Left: ') + x.name + ' (' + x.phone + ') → app: ' + (res[x.phone] || 'no number')).join('\n'));
  } finally { lock.releaseLock(); }
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
  'permanent hideout': true, 'mobile no. (alternative)': false
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


/**
 * Run once from the editor: choose "tncAgreeOnly" → Run → allow access to Google Forms.
 * The join form's Terms & Conditions question keeps only the "agree" answer and becomes required,
 * so nobody can send the form without agreeing (the app's join form already works this way).
 */
function tncAgreeOnly() {
  const form = FormApp.openById(FORM_ID);
  const item = form.getItems().find(it => TNC_HEAD.test(String(it.getTitle())) && [FormApp.ItemType.MULTIPLE_CHOICE, FormApp.ItemType.CHECKBOX, FormApp.ItemType.LIST].includes(it.getType()));
  if (!item) { console.log('No Terms & Conditions question found on the form.'); return; }
  const q = item.getType() === FormApp.ItemType.MULTIPLE_CHOICE ? item.asMultipleChoiceItem() : item.getType() === FormApp.ItemType.CHECKBOX ? item.asCheckboxItem() : item.asListItem();
  const keep = q.getChoices().map(c => c.getValue()).filter(v => !/(don'?t|do not|not agree|disagree)/i.test(v));
  if (!keep.length) keep.push(AGREED);
  q.setChoices(keep.map(v => q.createChoice(v)));
  q.setRequired(true);
  try { if (q.showOtherOption) q.showOtherOption(false); } catch (e) { /* not available */ }
  console.log('"' + item.getTitle() + '" now only offers: ' + keep.join(', ') + ' (required).');
  publishForm();
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
