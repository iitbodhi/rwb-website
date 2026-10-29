/**
 * RWB App ⇄ RWB contact sheet (the Google Sheet with the join form responses)
 *
 * ONE WAY TO JOIN: roninwb.in → Join us → the RWB join form → a row in "Form responses 3".
 * 1. Join form → approval: every new form entry goes to the app's approval list (it is not a member yet).
 *    Its row here says "Waiting for approval" in the "App · Status" column until an admin decides.
 *      Approved → "Member". Once they sign in to the app (same email; their details are already there) → "In App".
 *    An existing member who fills the form again with the same name, VRN and email is updated straight away (no approval);
 *    a different name, VRN or email waits for an admin.
 *      Rejected → the row is deleted from this tab.
 *    The T&C answer is always written as "Understood & agreed".
 * 2. Sheet → app: editing a member's details here (name, number, VRN, locality…) updates the app within seconds.
 * 3. App → sheet: members approved in the app get a row here; changes in the app (Me → Edit, bikes, VRN verified)
 *    update their row. Rows added by the app say "RWB App" in the "Added via" column.
 * 4. A member removed in the app is removed from this sheet; the row is first copied to the "Removed members" tab.
 * 5. Safety net, every 10 minutes (syncWithApp): VRNs lose their spaces, and every row is checked against the app and repaired.
 *    Whichever side changed since the last check wins: a sheet edit that didn't reach the app is sent again, an app change
 *    is written here. Anyone missing is added, removed / rejected entries move to their tabs, gaps in the app are filled.
 * 6. Duplicates (same WhatsApp number or same VRN) are never removed by themselves: admins get an alert in the app and
 *    choose which entry to keep. Their choice is carried out here (rows move to "Older entries"). Needs setup file 49.
 * 7. A member restored in the app gets their old row back from "Removed members" (with all their answers).
 * 8. Empty rows between entries are removed (after every form entry and every 10 minutes).
 *
 * SET-UP / UPDATE (keeps the same web address):
 *   a) Extensions → Apps Script → replace everything with this file → put your SYNC_SECRET back → Save.
 *   b) Choose "setup" in the function list → Run → allow access. (Installs the form and edit triggers.)
 *   c) Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *   d) Optional: run "addMissingFromApp" once to label every row's status and add anyone missing.
 * The app reads the form's questions (for "More from RWB"). They update by itself every hour; after editing the
 * form, run "publishForm" to update the app straight away. New riders can only join through the form.
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
/* "App · Status": Waiting for approval (new form entry) → Member (approved, hasn't signed in to the app yet) → In App (approved and signed in) */
const ST = { waiting: 'Waiting for approval', member: 'Member', inApp: 'In App' };
const isMemberSt_ = v => v === ST.member || v === ST.inApp;
/* the label for an approved member; null when the app didn't say whether they use it (keep what's there) */
const memberSt_ = m => m.on_app == null ? null : m.on_app ? ST.inApp : ST.member;
/* Columns that update the app when an admin edits them here */
const EDITABLE = ['full_name', 'dob', 'phone', 'email', 'vrn', 'bike', 'blood_group', 'locality', 'hideout', 'emergency_phone', 'alt_phone', 'vrn_verified', 'bike2_vrn', 'bike2_model', 'bike3_vrn', 'bike3_model', 'tnc'];
const AGREED = 'Understood & agreed', NOT_AGREED = "I don't agree";   // the T&C answer, the same from the form, the app and the sheet

/** Run once (and again after updating this file). Installs the automatic triggers. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().filter(t => ['onFormSubmitSync', 'onSheetEdit', 'publishForm', 'syncAnswers', 'syncWithApp'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitSync').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('publishForm').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncAnswers').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('syncWithApp').timeBased().everyMinutes(10).create();
  columns_(responsesSheet_());
  makeTabs_();
  console.log('Working on the tab "' + responsesSheet_().getName() + '"');
  registerWebhook_();
  publishForm();
  syncTnc();
  syncAnswers();
  syncWithApp();
  console.log('Ready: new form entries go to the approval list, edits here update the app, the app shows the same join form, and the sheet is checked against the app every 10 minutes.');
}

/** Runs by itself for every new form submission: the entry waits for an admin in the app. */
function onFormSubmitSync(e) {
  const sheet = e.range.getSheet();
  try { formEntry_(e, sheet); }
  finally {
    /* the form sometimes writes a new entry far below the last one: close the gap (even if sending to the app failed) */
    const lock = LockService.getScriptLock();
    if (lock.tryLock(20000)) { try { const n = compactBlankRows_(sheet); if (n) console.log('Empty rows removed: ' + n); } finally { lock.releaseLock(); } }
  }
}
function formEntry_(e, sheet) {
  const rowNo = e.range.getRow();
  const col = columns_(sheet);
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (col.vrn !== undefined && cleanVrn_(row[col.vrn]) !== String(row[col.vrn])) { row[col.vrn] = cleanVrn_(row[col.vrn]); sheet.getRange(rowNo, col.vrn + 1).setValue(row[col.vrn]); }
  const m = toMember_(heads, row);
  const res = send_([m]);
  if (String(res[0]) === 'pending') {
    sheet.getRange(rowNo, col.status + 1).setValue(ST.waiting);
    UrlFetchApp.fetchAll([rpc_('sheet_upsert_member_answers', { p_secret: SYNC_SECRET, p_phone: m.phone, p_answers: answers_(heads, row) })]);
  } else if (String(res[0]) === 'updated') {
    /* an existing member filled the form again with the same name, VRN and email: their details are updated (no approval);
       their older row stays until an admin picks which one to keep (the app shows it as a duplicate) */
    sheet.getRange(rowNo, col.status + 1).setValue(ST.member);
    UrlFetchApp.fetchAll([rpc_('sheet_set_answers', { p_secret: SYNC_SECRET, p_rows: [{ phone: m.phone, answers: answers_(heads, row) }] })]);
    setStatus_({ status: 'approved', phone: m.phone });
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
    const f = Math.max(2, r0), l = r0 + nr - 1;
    const vals = sheet.getRange(f, 1, l - f + 1, sheet.getLastColumn()).getValues();
    const rows = vals.map(r => ({ phone: p10_(r[col.phone]), joined_at: tsIso_(r[col.joined_at]) })).filter(x => x.phone.length === 10 && x.joined_at);
    if (rows.length) sendOrQueue_([{ fn: 'sheet_set_joined', body: { p_secret: SYNC_SECRET, p_rows: rows } }]);
    else console.log('Timestamp edited, but it is not a date the app understands (use dd/mm/yyyy hh:mm:ss): ' + JSON.stringify(vals.map(r => String(r[col.joined_at]))));
  }
  if (!edited.length) return;
  const first = Math.max(2, r0), last = r0 + nr - 1;
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getRange(first, 1, last - first + 1, sheet.getLastColumn()).getValues();
  const reqs = [];
  rows.forEach(row => {
    const m = Object.assign(toMember_(heads, row), extras_(col, row)), p = {};
    edited.forEach(k => p[k] = m[k]);
    let old = m.phone;
    if (edited.includes('phone')) old = nr === 1 && nc === 1 && e.oldValue != null ? String(e.oldValue).replace(/\D/g, '').slice(-10) : '';
    if (!old && !m.phone) return;
    reqs.push({ fn: 'sheet_edit_member', body: { p_secret: SYNC_SECRET, p: p, p_old_phone: old } });
  });
  for (let i = 0; i < reqs.length; i += 50) sendOrQueue_(reqs.slice(i, i + 50));   // big pastes go in batches
}

/* Sheet → app calls: sent now; any that fail (network, Supabase busy) wait and are sent again by syncWithApp */
function sendOrQueue_(calls) {
  let res = [];
  try { res = UrlFetchApp.fetchAll(calls.map(c => rpc_(c.fn, c.body))); } catch (err) { res = []; }
  const failed = calls.filter((c, i) => !res[i] || res[i].getResponseCode() >= 300);
  console.log('Sheet edit sent to the app: ' + res.map(r => r.getContentText()).join(', ') + (failed.length ? ' (' + failed.length + ' will be retried)' : ''));
  if (failed.length) queue_(failed);
}
function queue_(calls) {
  const props = PropertiesService.getScriptProperties();
  let q = []; try { q = JSON.parse(props.getProperty('retry') || '[]'); } catch (e) { q = []; }
  q = q.concat(calls.map(c => ({ fn: c.fn, body: Object.assign({}, c.body, { p_secret: undefined }) }))).slice(-300);
  props.setProperty('retry', JSON.stringify(q));
}
function retryQueued_() {
  const props = PropertiesService.getScriptProperties();
  let q = []; try { q = JSON.parse(props.getProperty('retry') || '[]'); } catch (e) { q = []; }
  if (!q.length) return 0;
  const calls = q.map(c => ({ fn: c.fn, body: Object.assign({}, c.body, { p_secret: SYNC_SECRET }) }));
  let res = []; try { res = UrlFetchApp.fetchAll(calls.map(c => rpc_(c.fn, c.body))); } catch (err) { return 0; }
  const left = q.filter((c, i) => !res[i] || res[i].getResponseCode() >= 300);
  props.setProperty('retry', JSON.stringify(left));
  return q.length - left.length;
}
/* the automatic triggers, reinstalled if one went missing */
function ensureTriggers_() {
  const have = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()), ss = SpreadsheetApp.getActive(), made = [];
  if (!have.includes('onFormSubmitSync')) { ScriptApp.newTrigger('onFormSubmitSync').forSpreadsheet(ss).onFormSubmit().create(); made.push('form'); }
  if (!have.includes('onSheetEdit')) { ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create(); made.push('edit'); }
  if (!have.includes('syncWithApp')) { ScriptApp.newTrigger('syncWithApp').timeBased().everyMinutes(10).create(); made.push('10-minute check'); }
  if (made.length) console.log('Triggers reinstalled: ' + made.join(', '));
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
  if (body.action === 'dupes') { const lk = LockService.getScriptLock(); lk.waitLock(20000); try { return json_({ ok: true, result: applyDupeActions_() }); } finally { lk.releaseLock(); } }
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
      Object.keys(app).forEach(k => {
        if (col[k] === undefined) return;
        if (k === 'status' && app[k] == null) { const cur = sheet.getRange(rowNo, col[k] + 1).getValues()[0][0]; if (isMemberSt_(String(cur))) return; app[k] = ST.member; }
        sheet.getRange(rowNo, col[k] + 1).setValue(app[k]);
      });
      sheet.getRange(rowNo, col.updated + 1).setValue(new Date());
      snapRows_(heads, col, [sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).getValues()[0]]);
      return json_({ ok: true, result: 'updated', row: rowNo });
    }
    /* a member restored in the app: their old row comes back from "Removed members" with every answer */
    const bin = rowsBack_();
    const back = bin.take(m.phone, heads) || (body.old_phone ? bin.take(body.old_phone, heads) : null);
    const row = back || new Array(sheet.getLastColumn()).fill('');
    while (row.length < sheet.getLastColumn()) row.push('');
    Object.keys(vals).forEach(k => { if (col[k] !== undefined && (vals[k] !== '' || !back)) row[col[k]] = vals[k]; });
    Object.keys(app).forEach(k => { if (col[k] !== undefined) row[col[k]] = app[k] == null ? ST.member : app[k]; });
    Object.keys(extra).forEach(i => { if (extra[i] !== '' && extra[i] != null) row[+i] = extra[i]; });
    if (col.joined_at !== undefined && !(back && row[col.joined_at])) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
    if (!back) row[col.added] = 'RWB App';
    if (col.updated !== undefined) row[col.updated] = new Date();
    appendInside_(sheet, [row]);
    bin.flush();
    snapRows_(heads, col, [row]);
    return json_({ ok: true, result: back ? 'restored' : 'added', row: sheet.getLastRow() });
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
      /* their newest row is the member's row; any older entry stays until an admin picks one (shown as a duplicate in the app) */
      mine.sort((a, c) => at(c) - at(a));
      if (!isMemberSt_(String(mine[0].row[col.status]))) sheet.getRange(mine[0].r, col.status + 1).setValue(ST.member);
      return json_({ ok: true, result: 'member', others: mine.length - 1 });
    }
    /* rejected: only the entry that was rejected is deleted (an existing member's older row stays) */
    let hit = mine.filter(x => ts && Math.abs(at(x) - ts) < 2000);
    if (!hit.length) hit = mine.filter(x => String(x.row[col.status]) === ST.waiting);
    if (!hit.length) return json_({ ok: true, result: 'not found' });
    hit.map(x => x.r).sort((a, c) => c - a).forEach(r => sheet.deleteRow(r));
    return json_({ ok: true, result: 'rejected', deleted: hit.length });
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

/** The tabs rows move to (made here so admins can see them from day one; rows arrive as things happen). */
function makeTabs_() {
  const ss = SpreadsheetApp.getActive(), sheet = responsesSheet_();
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  [['Removed members', ['Removed on']], ['Older entries', ['Moved on', 'Note']]].forEach(([name, first]) => {
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
  return { ...(m.tnc_agreed == null ? {} : { tnc: m.tnc_agreed ? AGREED : NOT_AGREED }), status: memberSt_(m), vrn_verified: m.vrn_verified ? 'Yes' : '', bike2_vrn: t(m.bike2_vrn), bike2_model: t(m.bike2_model), bike3_vrn: t(m.bike3_vrn), bike3_model: t(m.bike3_model) };
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
 * "Understood & agreed" on the sheet = agreed to the current RWB Terms in the app (needs setup file 47).
 * Run it from the editor any time (choose "syncTncAgreed" → Run); syncWithApp also runs it after every sync.
 * Rows that say "I don't agree", or have no answer, are left as they are.
 */
function syncTncAgreed() {
  const sheet = responsesSheet_(), data = sheet.getDataRange().getValues(), heads = data.shift();
  const phones = data.map(r => toMember_(heads, r)).filter(m => m.phone && m.tnc === 'yes').map(m => m.phone);
  let n = 0;
  for (let i = 0; i < phones.length; i += 500) {
    const r = UrlFetchApp.fetchAll([rpc_('sheet_agree_tnc', { p_secret: SYNC_SECRET, p_phones: phones.slice(i, i + 500) })])[0];
    if (r.getResponseCode() !== 200) { console.log('Could not update the app (run setup file 47 in Supabase first): ' + r.getContentText().slice(0, 200)); return 0; }
    n += Number(r.getContentText()) || 0;
  }
  console.log('"' + AGREED + '" on ' + phones.length + ' rows; ' + n + ' members now marked as agreed in the app.');
  return n;
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

/* a Timestamp cell (a date, or text like 05/11/2024 20:47:21, India time) → ISO time, or '' */
function tsIso_(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  const m = String(v || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return '';
  const pad = x => String(x || 0).padStart(2, '0');
  return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]) + 'T' + pad(m[4]) + ':' + pad(m[5]) + ':' + pad(m[6]) + '+05:30';
}
/** Select one or more member rows in the sheet, then run this: their Timestamp is sent to the app as the join date. */
function sendJoinDates() {
  const sheet = responsesSheet_(), col = columns_(sheet), sel = SpreadsheetApp.getActiveRange();
  if (!sel || sel.getSheet().getSheetId() !== sheet.getSheetId()) { console.log('Select the member rows in "' + sheet.getName() + '" first.'); return; }
  const f = Math.max(2, sel.getRow()), l = sel.getRow() + sel.getNumRows() - 1;
  const vals = sheet.getRange(f, 1, l - f + 1, sheet.getLastColumn()).getValues();
  const rows = vals.map(r => ({ phone: p10_(r[col.phone]), joined_at: tsIso_(r[col.joined_at]) })).filter(x => x.phone.length === 10 && x.joined_at);
  console.log(rows.length ? 'Join dates sent: ' + rows.map(x => x.phone + ' → ' + x.joined_at).join(', ') + '. Members updated: ' + UrlFetchApp.fetchAll([rpc_('sheet_set_joined', { p_secret: SYNC_SECRET, p_rows: rows })])[0].getContentText() : 'No rows with a WhatsApp number and a Timestamp were selected.');
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
 * Runs every 10 minutes by itself (and from setup). Safe to run any time from the editor too.
 *   1. Sheet edits that couldn't reach the app earlier are sent again; empty rows between entries are removed.
 *   2. Duplicates admins sorted out in the app: the rows they removed move to "Older entries".
 *   3. VRNs lose their spaces; every "agree" answer is written the same way, "Understood & agreed".
 *   4. Every member's row is checked against the app. A field changed here since the last check goes to the app,
 *      a field changed in the app is written here. Missing members are added (a restored member gets their row back
 *      from "Removed members"), removed members move to their tab, rejected entries are deleted.
 *   5. Duplicates (same number, or same VRN on different numbers) are sent to the app for admins to decide.
 */
function syncWithApp() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('Another sync is running; skipped.'); return 'Another sync is running. Try again in a minute.'; }
  const errors = [], step = (name, fn, dflt) => { try { return fn(); } catch (err) { errors.push(name + ': ' + (err && err.message || err)); console.log('⚠️ ' + name + ' failed: ' + (err && err.stack || err)); return dflt; } };
  try {
    step('Triggers', ensureTriggers_);
    const retried = step('Sending earlier sheet edits', retryQueued_, 0);
    const blanks = step('Removing empty rows', compactBlankRows_, 0);
    const dupeDone = step('Duplicates removed by admins', applyDupeActions_, '');
    const vr = step('Tidying VRNs', tidyVrns_, { cleaned: 0, tnc: 0 });
    const exp = step('Reading the app', () => UrlFetchApp.fetchAll([rpc_('sheet_export_all', { p_secret: SYNC_SECRET })])[0]);
    if (!exp || exp.getResponseCode() !== 200) { const m = 'Could not read the app: ' + (exp ? exp.getContentText().slice(0, 200) : errors.join('; ')); console.log(m); return m; }
    const app = JSON.parse(exp.getContentText());
    const rc = step('Checking every row against the app', () => reconcile_(app), null);
    const dupes = step('Finding duplicates', reportDupes_, '');
    step('T&C answers', syncTncAgreed);
    const sum = rc ? 'Sync done. Empty rows removed: ' + blanks + '. VRNs cleaned: ' + vr.cleaned + (vr.tnc ? '. T&C answers set to "' + AGREED + '": ' + vr.tnc : '') +
      (retried ? '. Earlier sheet edits sent: ' + retried : '') + '. Sheet edits sent to the app: ' + rc.toApp + (rc.toAppFailed ? ' (' + rc.toAppFailed + ' will be tried again)' : '') +
      '. Cells updated from the app: ' + rc.cells + ' on ' + rc.rows + ' rows. Added: ' + rc.added + (rc.restored ? ' (' + rc.restored + ' brought back)' : '') +
      '. Moved to Removed members: ' + rc.removed + '. Rejected entries deleted: ' + rc.rejected + '. App details filled from the sheet: ' + rc.filled +
      '. Join dates updated from the sheet: ' + (rc.joined || 0) + '. Duplicates removed by admins: ' + (dupeDone || 'none') + '. Duplicates: ' + (dupes || '–') + '.' : 'Sync stopped.';
    const extra = (rc && rc.addedNames.length ? '\nAdded to the sheet:\n' + rc.addedNames.join('\n') : '') +
      (rc && rc.skipped.length ? '\nApp members not in the sheet (fix their number in the app):\n' + rc.skipped.join('\n') : '') +
      (errors.length ? '\nProblems:\n' + errors.join('\n') : '');
    console.log(sum + extra);
    PropertiesService.getScriptProperties().setProperty('lastSync', new Date().toISOString() + (errors.length ? ' (with problems)' : ''));
    return sum + extra;
  } finally { lock.releaseLock(); }
}
/** RWB → Sync with the app now: runs the check and shows what it did (and any problem). */
function syncNow() {
  const r = syncWithApp();
  try { SpreadsheetApp.getUi().alert('Sync with the app', String(r || 'Done'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(r); }
}

/* VRNs without spaces, and one way of writing the T&C answer (duplicates are no longer touched here: admins decide in the app) */
function tidyVrns_(dry) {
  const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow(), width = sheet.getLastColumn(), out = { cleaned: 0, tnc: 0 };
  if (last < 2 || col.vrn === undefined) return out;
  const data = sheet.getRange(2, 1, last - 1, width).getValues();
  /* 1. no spaces in VRNs (main bike, bikes 2 and 3); only the cells that change are written */
  ['vrn', 'bike2_vrn', 'bike3_vrn'].forEach(k => {
    if (col[k] === undefined) return;
    const idx = [];
    data.forEach((r, i) => { const c = cleanVrn_(r[col[k]]); if (c !== String(r[col[k]])) { r[col[k]] = c; idx.push(i); } });
    if (idx.length && !dry) { writeCells_(sheet, col[k], data, idx); out.cleaned += idx.length; }
  });
  /* 1b. every "agree" answer to the T&C question is written the same way */
  if (col.tnc !== undefined) {
    const idx = [];
    data.forEach((r, i) => { const v = String(r[col.tnc] == null ? '' : r[col.tnc]).trim();
      if (v && v !== AGREED && /(agree|understood|accept|^yes)/i.test(v) && !/(don'?t|do not|not agree|disagree)/i.test(v)) { r[col.tnc] = AGREED; idx.push(i); } });
    if (idx.length && !dry) { writeCells_(sheet, col.tnc, data, idx); out.tnc = idx.length; }
  }
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
  if (k === 'tnc') return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();   // exact, so every row says "Understood & agreed"
  if (k === 'vrn_verified') { const g = x => /^(yes|y|✓|✔|true|verified)$/i.test(t(x)) ? 'yes' : ''; return g(a) === g(b); }
  return t(a instanceof Date ? Utilities.formatDate(a, 'Asia/Kolkata', 'dd/MM/yyyy') : a) === t(b instanceof Date ? Utilities.formatDate(b, 'Asia/Kolkata', 'dd/MM/yyyy') : b);
}

function reconcile_(app) {
  const sheet = responsesSheet_(), col = columns_(sheet), width = sheet.getLastColumn(), last = sheet.getLastRow();
  const heads = sheet.getRange(1, 1, 1, width).getValues()[0].map(h => String(h).trim());
  const data = last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
  const out = { cells: 0, rows: 0, added: 0, restored: 0, removed: 0, rejected: 0, filled: 0, toApp: 0, toAppFailed: 0 };
  /* what each row looked like at the last check: a field that changed here since then is a sheet edit (the sheet wins) */
  const snap = snapLoad_(), keys = rowKeys_(col, data);
  const sheetEdited = (i, k) => { if (!snap || col[k] === undefined) return false; const was = snap[keys[i]]; return !!was && sigField_(was, k) !== h4_(cellStr_(data[i][col[k]])); };
  const byPhone = {}, byEmail = {}, bySnapPhone = {};
  data.forEach((r, i) => {
    const p = p10_(r[col.phone]); if (p.length === 10) (byPhone[p] = byPhone[p] || []).push(i);
    const e = col.email === undefined ? '' : String(r[col.email] || '').trim().toLowerCase(); if (e) (byEmail[e] = byEmail[e] || []).push(i);
    const was = snap && snap[keys[i]]; if (was) { const op = was.split('|')[0]; if (op.length === 10 && op !== p) bySnapPhone[op] = i; }   // number changed here
  });
  const waiting = new Set((app.waiting || []).map(w => p10_(w.phone)));
  const active = (app.members || []).filter(m => m.status === 'active'), activeSet = new Set(active.map(m => p10_(m.phone)));
  const changed = {}, touched = new Set(), gone = new Set(), fills = [], appends = [], joins = [], edits = [];
  const put = (i, c, v) => { if (c === undefined || c < 0) return; data[i][c] = v; (changed[c] = changed[c] || new Set()).add(i); touched.add(i); out.cells++; };
  const move = { removed: [], rejected: [] };
  const coreKeys = ['full_name', 'dob', 'phone', 'email', 'vrn', 'bike', 'blood_group', 'locality', 'hideout', 'emergency_phone', 'alt_phone'];
  const filledCount = r => r.filter(x => x !== '' && x != null).length;
  const bin = rowsBack_();

  out.addedNames = []; out.skipped = [];
  active.forEach(m => {
    const p = p10_(m.phone), em = String(m.email || '').trim().toLowerCase();
    if (p.length !== 10) { out.skipped.push(m.full_name + ' (no 10-digit WhatsApp number in the app)'); return; }
    let rows = (byPhone[p] || []).filter(i => !gone.has(i));
    if (!rows.length && bySnapPhone[p] !== undefined && !gone.has(bySnapPhone[p])) rows = [bySnapPhone[p]];
    if (!rows.length && em) rows = (byEmail[em] || []).filter(i => !gone.has(i) && !activeSet.has(p10_(data[i][col.phone])));
    if (waiting.has(p)) rows = rows.filter(i => String(data[i][col.status]) !== ST.waiting);   // their new entry waits for an admin
    if (!rows.length) {
      if (waiting.has(p) && (byPhone[p] || []).length) return;
      /* not here: a restored member gets their old row back from "Removed members", anyone else a new row */
      const back = bin.take(p, heads);
      const vals = sheetValues_(m), a = appValues_(m), row = back || new Array(width).fill('');
      while (row.length < width) row.push('');
      Object.keys(vals).forEach(k => { if (col[k] !== undefined && (vals[k] !== '' || !back)) row[col[k]] = vals[k]; });
      Object.keys(a).forEach(k => { if (col[k] !== undefined) row[col[k]] = a[k] == null ? ST.member : a[k]; });
      answerCells_(heads, col, m.answers).forEach(([c, v]) => { row[c] = v; });
      if (col.joined_at !== undefined && !(back && row[col.joined_at])) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
      if (!back) row[col.added] = 'RWB App';
      if (col.updated !== undefined) row[col.updated] = new Date();
      if (back) out.restored++;
      out.addedNames.push(m.full_name + (back ? ' (their old row brought back)' : ''));
      appends.push(row); return;
    }
    /* their row: the member's row, else the fullest one (other rows with the same number are left for the admins: duplicates) */
    rows.sort((a, b) => isMemberSt_(String(data[b][col.status])) - isMemberSt_(String(data[a][col.status])) || filledCount(data[b]) - filledCount(data[a]));
    const i = rows[0];
    const row = data[i], sm = Object.assign(toMember_(heads, row), extras_(col, row)), vals = sheetValues_(m), fill = {}, edit = {};
    coreKeys.forEach(k => {
      if (col[k] === undefined) return;
      const appHas = m[k] != null && String(m[k]).trim() !== '', sheetHas = String(row[col[k]] == null ? '' : row[col[k]]).trim() !== '';
      if (!appHas) { if (sheetHas && sm[k]) fill[k] = sm[k]; return; }
      if (same_(k, row[col[k]], k === 'bike' ? vals.bike : m[k])) return;
      if (sheetHas && sm[k] && sheetEdited(i, k)) edit[k] = sm[k];      // changed here since the last check: the app follows the sheet
      else put(i, col[k], vals[k]);                                    // changed in the app: the sheet follows the app
    });
    if (Object.keys(fill).length) fills.push(Object.assign({ phone: p }, fill));
    const a = appValues_(m);
    Object.keys(a).forEach(k => { if (col[k] === undefined || (k === 'status' && a[k] == null && isMemberSt_(String(row[col[k]])))) return;
      const v = k === 'status' && a[k] == null ? ST.member : a[k]; if (same_(k, row[col[k]], v)) return;
      if (EDITABLE.includes(k) && sheetEdited(i, k) && !(k === 'tnc' && !sm.tnc)) edit[k] = sm[k];
      else put(i, col[k], v); });
    if (Object.keys(edit).length) edits.push({ i: i, body: { p_secret: SYNC_SECRET, p: edit, p_old_phone: p } });
    answerCells_(heads, col, m.answers).forEach(([c, v]) => { if (!same_('answer', row[c], v)) put(i, c, v); });
    /* join date: the sheet's Timestamp when it's earlier than the app's (an edit, or an older entry) */
    if (col.joined_at !== undefined) { const t = tsIso_(row[col.joined_at]); if (t && (!m.joined_at || new Date(t).getTime() < new Date(m.joined_at).getTime() - 60000)) joins.push({ phone: p, joined_at: t }); }
  });

  /* members who left or were removed in the app: their rows go to "Removed members" */
  (app.members || []).filter(m => m.status !== 'active' && !activeSet.has(p10_(m.phone))).forEach(m => {
    const p = p10_(m.phone); if (waiting.has(p)) return;
    (byPhone[p] || []).forEach(i => { if (!gone.has(i) && String(data[i][col.status]) !== ST.waiting) { move.removed.push({ i: i, note: (m.status === 'left' ? 'Left' : 'Removed') + (m.removed_note ? ': ' + m.removed_note : '') }); gone.add(i); } });
  });
  /* entries an admin rejected in the app: deleted (no copy kept) */
  (app.rejected || []).forEach(r => {
    const p = p10_(r.phone); if (activeSet.has(p) || waiting.has(p)) return;
    (byPhone[p] || []).forEach(i => { if (!gone.has(i) && String(data[i][col.status]) === ST.waiting) { move.rejected.push({ i: i }); gone.add(i); } });
  });
  /* entries waiting for an admin are labelled */
  waiting.forEach(p => { if (activeSet.has(p)) return; (byPhone[p] || []).forEach(i => { if (!gone.has(i) && !String(data[i][col.status])) put(i, col.status, ST.waiting); }); });

  /* sheet edits the app missed: sent now (rows whose edits don't arrive keep counting as edited until they do) */
  const failed = new Set();
  for (let k = 0; k < edits.length; k += 50) {
    const part = edits.slice(k, k + 50);
    let res = []; try { res = UrlFetchApp.fetchAll(part.map(x => rpc_('sheet_edit_member', x.body))); } catch (err) { res = []; }
    part.forEach((x, j) => { if (!res[j] || res[j].getResponseCode() >= 300) failed.add(x.i); });
  }
  out.toApp = edits.length - failed.size; out.toAppFailed = failed.size;

  /* write only the cells that changed (an admin typing elsewhere in the sheet right now isn't overwritten) */
  touched.forEach(i => { if (col.updated !== undefined && !gone.has(i)) { data[i][col.updated] = new Date(); (changed[col.updated] = changed[col.updated] || new Set()).add(i); } });
  Object.keys(changed).forEach(c => { c = +c; writeCells_(sheet, c, data, [...changed[c]]); });
  out.rows = [...touched].filter(i => !gone.has(i)).length;

  /* what every row looks like now, for the next check */
  const next = {};
  data.forEach((r, i) => { if (gone.has(i)) return; next[keys[i]] = failed.has(i) && snap && snap[keys[i]] ? snap[keys[i]] : rowSig_(col, r); });
  appends.forEach(r => { next[rowKeys_(col, [r])[0]] = rowSig_(col, r); });

  if (appends.length) { appendInside_(sheet, appends.map(r => r.slice(0, width))); out.added = appends.length; bin.flush(); }
  /* moves last (rows below shift up): removed rows are copied to their tab, rejected ones just deleted */
  if (move.removed.length) copyRows_(sheet, data, move.removed, 'Removed members', 'Removed on');
  deleteRowsAt_(sheet, [...gone].map(i => i + 2));
  out.removed = move.removed.length; out.rejected = move.rejected.length;
  snapSave_(next);
  for (let k = 0; k < fills.length; k += 100) out.filled += Number(UrlFetchApp.fetchAll([rpc_('sheet_fill_members', { p_secret: SYNC_SECRET, p_rows: fills.slice(k, k + 100) })])[0].getContentText()) || 0;
  for (let k = 0; k < joins.length; k += 100) { const r = UrlFetchApp.fetchAll([rpc_('sheet_set_joined', { p_secret: SYNC_SECRET, p_rows: joins.slice(k, k + 100) })])[0]; out.joined = (out.joined || 0) + (r.getResponseCode() === 200 ? Number(r.getContentText()) || 0 : 0); }
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

/* new rows go INSIDE the sheet's table (Data → Table), so it grows with them instead of leaving rows below it.
   Rows are inserted above the last row, the last row is moved back to the end, and the new rows fill the space under it:
   every existing row keeps its row number. */
function appendInside_(sheet, rows) {
  if (!rows.length) return;
  const w = Math.max.apply(null, rows.map(r => r.length)), data = rows.map(r => { const x = r.slice(); while (x.length < w) x.push(''); return x; });
  const last = sheet.getLastRow();
  if (last < 2) { sheet.getRange(last + 1, 1, data.length, w).setValues(data); return; }
  const n = data.length, cols = Math.max(w, sheet.getLastColumn());
  try {
    sheet.insertRowsBefore(last, n);                                           // inside the table: it grows by n rows
    sheet.getRange(last + n, 1, 1, cols).moveTo(sheet.getRange(last, 1));       // the old last row goes back to its own row number
    sheet.getRange(last + 1, 1, n, w).setValues(data);                         // the new rows fill the space below it
  } catch (err) {
    console.log('Adding inside the table failed (' + err + '); adding below the last row instead.');
    const end = sheet.getLastRow();
    sheet.getRange(end + 1, 1, n, w).setValues(data);
  }
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

/* write one column's changed cells (in runs of neighbouring rows); cells with formulas are never written */
function writeCells_(sheet, c, data, idxs) {
  if (!idxs.length) return;
  const f = sheet.getRange(2, c + 1, data.length, 1).getFormulas();
  const list = [...new Set(idxs)].filter(i => i < data.length && !f[i][0]).sort((a, b) => a - b);
  if (list.length > 80 && f.every(x => !x[0])) { writeColumn_(sheet, c, data.map(r => [r[c]])); return; }
  for (let k = 0; k < list.length; ) {
    let j = k; while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    sheet.getRange(list[k] + 2, c + 1, j - k + 1, 1).setValues(list.slice(k, j + 1).map(i => [data[i][c]]));
    k = j + 1;
  }
}
/* delete rows (sheet row numbers), bottom-up, neighbouring rows together */
function deleteRowsAt_(sheet, rowNos) {
  const r = [...new Set(rowNos)].sort((a, b) => b - a);
  for (let k = 0; k < r.length; ) {
    let j = k; while (j + 1 < r.length && r[j + 1] === r[j] - 1) j++;
    const n = r[k] - r[j] + 1;
    try { sheet.deleteRows(r[j], n); }
    catch (err) {
      /* couldn't delete (e.g. a table or the last rows of a tab): move the rows below up instead */
      const last = sheet.getLastRow(), cols = sheet.getMaxColumns();
      if (r[k] < last) sheet.getRange(r[k] + 1, 1, last - r[k], cols).moveTo(sheet.getRange(r[j], 1));
      sheet.getRange(Math.max(r[j], last - n + 1), 1, n, cols).clearContent();
    }
    k = j + 1;
  }
}

/* ======================= Empty rows ======================= */
/**
 * Removes empty rows between entries (the join form sometimes writes a new entry far below the last one after rows
 * were moved away). Runs after every form entry and every 10 minutes; run it from the editor any time.
 * A row counts as empty when it has no value at all (helper columns titled with just a number are ignored).
 */
function compactBlankRows_(sheet) {
  sheet = sheet || responsesSheet_();
  const last = sheet.getLastRow(), width = sheet.getLastColumn();
  if (last < 3) return 0;
  const rng = sheet.getRange(2, 1, last - 1, width), vals = rng.getValues(), fx = rng.getFormulas();
  const real = sheet.getRange(1, 1, 1, width).getValues()[0].map(h => !isHelperHead_(h));
  const blank = v => v === '' || v == null || v === false || (typeof v === 'string' && !v.trim());   // unticked checkboxes and spaces count as empty
  const empty = vals.map((r, i) => r.every((v, c) => fx[i][c] ? !real[c] : blank(v)));
  const rows = []; empty.forEach((e, i) => { if (e) rows.push(i + 2); });
  if (!rows.length || rows.length === vals.length) return 0;
  deleteRowsAt_(sheet, rows);
  return rows.length;
}
function removeEmptyRows() { const lock = LockService.getScriptLock(); lock.waitLock(30000); try { console.log('Empty rows removed: ' + compactBlankRows_()); } finally { lock.releaseLock(); } }

/* ======================= Restoring a member: their row comes back from "Removed members" ======================= */
function removedTab_(name, prefix) {
  name = name || 'Removed members'; prefix = prefix || 1;    // the tab's own first columns: "Removed on" (+ "Note" in Older entries)
  const none = { take: () => null, flush: () => 0 };
  const tab = SpreadsheetApp.getActive().getSheetByName(name);
  if (!tab || tab.getLastRow() < 2) return none;
  const tw = tab.getLastColumn(), th = tab.getRange(1, 1, 1, tw).getValues()[0].map(h => String(h).trim());
  const vals = tab.getRange(2, 1, tab.getLastRow() - 1, tw).getValues();
  const pc = th.findIndex((h, i) => i >= prefix && h.toLowerCase().indexOf(COLUMNS.phone) === 0);
  if (pc < 0) return none;
  const used = new Set();
  return {
    /* the newest copy of this number's row, laid out like the responses tab (matched by column title); every copy leaves the tab */
    take(phone, heads) {
      const p = p10_(phone); if (p.length !== 10) return null;
      const hits = []; vals.forEach((r, i) => { if (!used.has(i) && p10_(r[pc]) === p) hits.push(i); });
      if (!hits.length) return null;
      hits.forEach(i => used.add(i));
      const src = vals[hits[hits.length - 1]];
      let matched = 0;
      const row = heads.map(h => { const t = String(h).trim(), j = t ? th.indexOf(t, prefix) : -1; if (j >= prefix) { matched++; return src[j]; } return ''; });
      return matched >= 3 ? row : src.slice(prefix, prefix + heads.length);
    },
    flush() { if (used.size) deleteRowsAt_(tab, [...used].map(i => i + 2)); return used.size; }
  };
}
/* a member without a row: their row comes back from "Removed members", else from "Older entries" */
function rowsBack_() {
  const a = removedTab_('Removed members', 1), b = removedTab_('Older entries', 2);
  return { take: (p, heads) => a.take(p, heads) || b.take(p, heads), flush: () => a.flush() + b.flush() };
}

/* ======================= Sheet edits always reach the app ======================= */
/* Each row's fields (as a short fingerprint) at the last check. When a field differs between the sheet and the app,
   the side that changed since then wins, so an edit here is never overwritten by the app's older value. */
const SNAP_V = 's1';
function cellStr_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') : String(v == null ? '' : v).trim(); }
function h4_(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return ('0000' + (h >>> 0).toString(36)).slice(-4); }
function rowSig_(col, r) { return p10_(r[col.phone]) + '|' + EDITABLE.map(k => col[k] === undefined ? '----' : h4_(cellStr_(r[col[k]]))).join(''); }
function sigField_(sig, k) { const j = EDITABLE.indexOf(k), b = sig.indexOf('|') + 1; return sig.substr(b + j * 4, 4); }
/* a row's lasting name: its Timestamp (else its number); the same Timestamp twice gets #2, #3 */
function rowKeys_(col, data) {
  const seen = {};
  return data.map(r => { const k = (col.joined_at !== undefined && tsIso_(r[col.joined_at])) || 'p' + p10_(r[col.phone]); seen[k] = (seen[k] || 0) + 1; return seen[k] > 1 ? k + '#' + seen[k] : k; });
}
function snapLoad_() {
  const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty('snapN') || 0);
  if (!n || p.getProperty('snapV') !== SNAP_V) return null;
  let s = ''; for (let i = 0; i < n; i++) s += p.getProperty('snap' + i) || '';
  try { return JSON.parse(s); } catch (e) { return null; }
}
function snapSave_(o) {
  const p = PropertiesService.getScriptProperties(), s = JSON.stringify(o), parts = [], old = Number(p.getProperty('snapN') || 0);
  for (let i = 0; i < s.length; i += 8000) parts.push(s.slice(i, i + 8000));
  const props = { snapV: SNAP_V, snapN: String(parts.length) }; parts.forEach((x, i) => { props['snap' + i] = x; });
  p.setProperties(props, false);
  for (let i = parts.length; i < old; i++) p.deleteProperty('snap' + i);
}
/* rows the app just wrote here are up to date: remembered so they don't look like sheet edits */
function snapRows_(heads, col, rows) {
  const s = snapLoad_(); if (!s) return;
  rows.forEach(r => { s[rowKeys_(col, [r])[0]] = rowSig_(col, r); });
  snapSave_(s);
}
/**
 * Optional, from the editor: sends every member row's details from this sheet to the app (the sheet wins everywhere).
 * Use it if the app ever shows something different from the sheet. Empty cells never blank the app.
 */
function sendSheetToApp() {
  const sheet = responsesSheet_(), col = columns_(sheet), data = sheet.getDataRange().getValues(), heads = data.shift();
  const reqs = data.filter(r => isMemberSt_(String(r[col.status]))).map(r => { const m = Object.assign(toMember_(heads, r), extras_(col, r)), p = {};
    EDITABLE.forEach(k => { if (m[k] !== '' && m[k] != null && col[k] !== undefined) p[k] = m[k]; }); return { fn: 'sheet_edit_member', body: { p_secret: SYNC_SECRET, p: p, p_old_phone: m.phone } }; }).filter(x => x.body.p.phone);
  let ok = 0;
  for (let i = 0; i < reqs.length; i += 50) { const res = UrlFetchApp.fetchAll(reqs.slice(i, i + 50).map(c => rpc_(c.fn, c.body))); ok += res.filter(r => r.getResponseCode() < 300).length; }
  console.log('Sent ' + ok + ' of ' + reqs.length + ' member rows to the app.');
}

/* ======================= Duplicates: admins decide in the app ======================= */
/* rows sharing a WhatsApp number, or a VRN (different numbers); entries waiting for approval are left to the approval list */
function findDupes_(col, data) {
  const keys = rowKeys_(col, data), byP = {}, byV = {};
  data.forEach((r, i) => {
    if (String(r[col.status]) === ST.waiting) return;
    const p = p10_(r[col.phone]); if (p.length === 10) (byP[p] = byP[p] || []).push(i);
    if (col.vrn !== undefined) { const v = cleanVrn_(r[col.vrn]); if (v.length >= 6) (byV[v] = byV[v] || []).push(i); }
  });
  const agreed = r => col.tnc !== undefined && /(agree|understood|accept|yes)/i.test(String(r[col.tnc])) && !/(don'?t|not agree|disagree)/i.test(String(r[col.tnc]));
  const filled = r => r.filter(x => x !== '' && x != null).length;
  const when = r => col.joined_at !== undefined && r[col.joined_at] instanceof Date ? r[col.joined_at].getTime() : 0;
  const rank = s => s === ST.inApp ? 2 : s === ST.member ? 1 : 0;
  const score = i => { const r = data[i]; return rank(String(r[col.status])) * 1e9 + (agreed(r) ? 1e8 : 0) + filled(r) * 1e5 + when(r) / 1e8; };
  const t = (r, k) => col[k] === undefined ? '' : String(r[col[k]] == null ? '' : r[col[k]]).trim();
  const entry = (i, best) => { const r = data[i]; return { id: keys[i], row: i + 2, name: t(r, 'full_name'), phone: p10_(r[col.phone]), vrn: cleanVrn_(t(r, 'vrn')), email: t(r, 'email'),
    joined: col.joined_at !== undefined && r[col.joined_at] instanceof Date ? Utilities.formatDate(r[col.joined_at], 'Asia/Kolkata', 'dd/MM/yyyy HH:mm') : t(r, 'joined_at'),
    status: t(r, 'status'), added: col.added === undefined ? '' : String(r[col.added] || ''), filled: filled(r), tnc: agreed(r), best: best }; };
  const groups = [];
  const add = (kind, value, list) => { if (list.length < 2) return; const top = list.slice().sort((a, b) => score(b) - score(a))[0];
    groups.push({ key: kind + ':' + value, kind: kind, value: value, entries: list.map(i => entry(i, i === top)) }); };
  Object.keys(byP).forEach(p => add('phone', p, byP[p]));
  Object.keys(byV).forEach(v => { if (new Set(byV[v].map(i => p10_(data[i][col.phone]))).size > 1) add('vrn', v, byV[v]); });   // same number twice is already a group
  return groups;
}
function reportDupes_() {
  const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow();
  const data = last > 1 ? sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues() : [];
  const groups = findDupes_(col, data);
  const r = UrlFetchApp.fetchAll([rpc_('sheet_set_dupes', { p_secret: SYNC_SECRET, p_groups: groups })])[0];
  if (r.getResponseCode() !== 200) return 'not reported (run setup file 49 in Supabase first)';
  return groups.length + ' found, ' + r.getContentText() + ' shown to admins';
}
/* rows admins chose to remove in the app → "Older entries" (with who decided) */
function applyDupeActions_() {
  const r = UrlFetchApp.fetchAll([rpc_('sheet_dupe_actions', { p_secret: SYNC_SECRET })])[0];
  if (r.getResponseCode() !== 200) return 'not set up (setup file 49)';
  const acts = JSON.parse(r.getContentText() || '[]') || [];
  if (!acts.length) return 'none';
  const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow();
  const data = last > 1 ? sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues() : [];
  const at = {}; rowKeys_(col, data).forEach((k, i) => { at[k] = i; });
  const move = [], done = [];
  acts.forEach(a => { const i = at[a.entry];
    if (i === undefined || move.some(x => x.i === i)) { done.push({ id: a.id, result: 'not found' }); return; }
    move.push({ i: i, note: a.note || 'Duplicate' }); done.push({ id: a.id, result: 'moved' }); });
  if (move.length) moveRowsFast_(sheet, data, move, 'Older entries', 'Moved on');
  UrlFetchApp.fetchAll([rpc_('sheet_dupe_done', { p_secret: SYNC_SECRET, p_done: done })]);
  return move.length + ' moved to Older entries';
}
/** See the duplicates admins are asked about (nothing is changed). */
function previewDuplicates() {
  const sheet = responsesSheet_(), col = columns_(sheet), last = sheet.getLastRow();
  const g = findDupes_(col, last > 1 ? sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues() : []);
  console.log(g.length ? g.map(x => (x.kind === 'vrn' ? 'VRN ' : 'Number ') + x.value + ':\n' + x.entries.map(e => '  row ' + e.row + ': ' + e.name + ' (' + e.phone + ', ' + e.vrn + ')' + (e.best ? '  ← suggested to keep' : '')).join('\n')).join('\n') : 'No duplicates.');
}

/* ======================= The "RWB" menu in the sheet ======================= */
/** Adds the RWB menu when the sheet opens: find a member, sync now, remove empty rows. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('RWB')
    .addItem('🔎 Find a member (sheet + app)', 'findMember')
    .addItem('🔄 Sync with the app now', 'syncNow')
    .addItem('🧹 Remove empty rows', 'removeEmptyRows')
    .addToUi();
}
/** RWB → Find a member: where a name or number is in every tab, and what the app says. Offers to fix a missing row. */
function findMember() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('Find a member', 'Name (or part of it) or WhatsApp number:', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const q = String(a.getResponseText() || '').trim(), qp = p10_(q), ql = q.toLowerCase();
  if (q.length < 3) { ui.alert('Type at least 3 letters or the number.'); return; }
  const hit = (name, phone) => (qp.length === 10 && p10_(phone) === qp) || (ql.length >= 3 && String(name || '').toLowerCase().indexOf(ql) >= 0);
  const lines = [];
  SpreadsheetApp.getActive().getSheets().forEach(sh => {
    if (sh.getLastRow() < 2) return;
    const v = sh.getDataRange().getValues(), h = v[0].map(x => String(x).trim().toLowerCase());
    const nc = h.findIndex(x => x.indexOf(COLUMNS.full_name) === 0), pc = h.findIndex(x => x.indexOf(COLUMNS.phone) === 0);
    if (nc < 0 && pc < 0) return;
    v.slice(1).forEach((r, i) => { if (hit(r[nc], r[pc])) lines.push('• ' + sh.getName() + ', row ' + (i + 2) + ': ' + r[nc] + ' (' + p10_(r[pc]) + ')'); });
  });
  let app = [];
  try { const r = UrlFetchApp.fetchAll([rpc_('sheet_export_all', { p_secret: SYNC_SECRET })])[0]; const d = JSON.parse(r.getContentText());
    app = (d.members || []).filter(m => hit(m.full_name, m.phone)).map(m => '• App: ' + m.full_name + ' (' + (p10_(m.phone) || 'no number') + '), ' + (m.status === 'active' ? 'member' : m.status));
    (d.waiting || []).filter(m => hit(m.full_name, m.phone)).forEach(m => app.push('• App: ' + m.full_name + ' (' + p10_(m.phone) + '), waiting for approval'));
  } catch (e) { app = ['• App: could not check (' + e + ')']; }
  const missing = app.some(x => / member$/.test(x)) && !lines.some(x => x.indexOf('• ' + responsesSheet_().getName() + ',') === 0);
  const msg = (lines.length ? lines.join('\n') : 'Not found in any tab.') + '\n\n' + (app.length ? app.join('\n') : 'Not found in the app.') +
    (missing ? '\n\nThey are a member in the app but have no row in "' + responsesSheet_().getName() + '". Add the row now (from "Removed members" if it is there)?' : '');
  if (missing) { if (ui.alert('Find a member', msg, ui.ButtonSet.YES_NO) === ui.Button.YES) { ui.alert('Sync with the app', String(syncWithApp() || 'Done'), ui.ButtonSet.OK); } }
  else ui.alert('Find a member', msg, ui.ButtonSet.OK);
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
      const m = memberSet.has(p) ? members.find(x => p10(x.phone) === p) : null;
      const want = m ? (memberSt_(m) || (isMemberSt_(String(status[i][0])) ? status[i][0] : ST.member)) : waitSet.has(p) ? ST.waiting : null;
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
      Object.keys(app).forEach(k => { if (col[k] !== undefined) row[col[k]] = app[k] == null ? ST.member : app[k]; });
      if (col.joined_at !== undefined) row[col.joined_at] = m.joined_at ? new Date(m.joined_at) : new Date();
      row[col.added] = 'RWB App';
      rows.push(row); added.push(m.full_name + ' (' + p + ')');
    });
    if (rows.length) appendInside_(sheet, rows);
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
 * The join form's Terms & Conditions question gets one answer, "Understood & agreed", and becomes required,
 * so nobody can send the form without agreeing.
 */
function tncAgreeOnly() {
  const form = FormApp.openById(FORM_ID);
  const item = form.getItems().find(it => TNC_HEAD.test(String(it.getTitle())) && [FormApp.ItemType.MULTIPLE_CHOICE, FormApp.ItemType.CHECKBOX, FormApp.ItemType.LIST].includes(it.getType()));
  if (!item) { console.log('No Terms & Conditions question found on the form.'); return; }
  const q = item.getType() === FormApp.ItemType.MULTIPLE_CHOICE ? item.asMultipleChoiceItem() : item.getType() === FormApp.ItemType.CHECKBOX ? item.asCheckboxItem() : item.asListItem();
  const keep = [AGREED];             // the only answer, stored the same way everywhere
  q.setChoices(keep.map(v => q.createChoice(v)));
  q.setRequired(true);
  try { if (q.showOtherOption) q.showOtherOption(false); } catch (e) { /* not available */ }
  console.log('"' + item.getTitle() + '" now only offers: ' + keep.join(', ') + ' (required).');
  publishForm();
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
