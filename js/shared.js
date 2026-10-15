/* RWB — shared.js (loaded on every page): header, footer, dialog and helpers */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Header + footer + popup are built here once, so editing the menu changes every page */
(function buildPage() {
    const here = document.body.dataset.page, home = here === 'home', base = home ? '' : 'index.html';
    const link = (href, label, key) => `<a href="${href}"${key === here ? ' aria-current="page"' : ''}>${label}</a>`;
    document.body.insertAdjacentHTML('afterbegin', `
<header class="nav" id="nav">
  <a href="${home ? '#home' : 'index.html'}" class="nav-brand"><img src="assets/logo.png" alt="" width="40" height="40"><span>RWB</span></a>
  <nav class="nav-links" id="nav-links" aria-label="Main">
    ${link(base + '#events', 'Rides &amp; Events')}${link('maintenance.html', 'Ronin Maintenance', 'maintenance')}${link('accessories.html', 'Ronin Accessories', 'accessories')}${link('#social', 'Social')}${link(base + '#market', 'RWB Marketplace')}${link(base + '#warriors', 'Meet The Warriors')}${link(base + '#gallery', 'Gallery')}${link(base + '#about', 'About')}
  </nav>
  <a href="#" class="btn btn-sm join-link" target="_blank" rel="noopener">Join us</a>
  <button class="icon-btn nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
</header>`);
    document.body.insertAdjacentHTML('beforeend', `
<footer class="footer" id="social">
<div class="social">
  <a href="https://www.instagram.com/ronin_warriors_bengal" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/></svg></a>
  <a href="https://www.facebook.com/profile.php?id=61556220173720" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
  <a href="https://whatsapp.com/channel/0029VaiK6QHEgGfTItym9t2H" target="_blank" rel="noopener" aria-label="WhatsApp channel"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.556 4.118 1.528 5.845L0 24l6.345-1.505A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.366l-.359-.213-3.718.881.899-3.63-.234-.374A9.818 9.818 0 1 1 12 21.818z"/></svg></a>
  <a href="mailto:ronin.warriors.bengal@gmail.com" aria-label="Email"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 4 10 9 10-9"/></svg></a>
</div>
  <p>Copyright of this website is reserved by Ronin Warriors of Bengal. roninwb.in</p>
</footer>
<dialog id="dialog" aria-label="Details"><button class="dialog-close" aria-label="Close">✕</button><div id="dialog-body"></div></dialog>`);
})();

$$('.join-link').forEach(a => a.href = CONFIG.JOIN_FORM_URL);
$$('.ig-link').forEach(a => a.href = CONFIG.INSTAGRAM_URL);

/* Mobile menu */
const navToggle = $('#nav-toggle'), navLinks = $('#nav-links');
const setNav = open => { navLinks.classList.toggle('open', open); navToggle.setAttribute('aria-expanded', open); };
navToggle.addEventListener('click', () => setNav(!navLinks.classList.contains('open')));
navLinks.addEventListener('click', e => { if (e.target.tagName === 'A') setNav(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setNav(false); });

/* Popup (photo viewer, warrior profile, PDF reader). Clicking a photo closes it. */
const dialog = $('#dialog'), dialogBody = $('#dialog-body');
function openDialog(html, cls = '') { dialogBody.className = cls; dialogBody.innerHTML = html; dialog.showModal(); }
dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('.dialog-close') || e.target.closest('.lb img')) dialog.close(); });
dialog.addEventListener('close', () => { dialogBody.innerHTML = ''; });

/* Filter buttons */
function tabs(sel, onChange) {
    $(sel).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        $$(sel + ' button').forEach(x => x.classList.toggle('active', x === b));
        onChange(b.dataset.filter);
    });
}

/* Google Sheet (CSV) loading. Handles quotes and line breaks inside cells. */
const fetchText = u => fetch(u).then(r => { if (!r.ok) throw 0; return r.text(); });
const fetchCSV = u => fetchText(u).catch(() => fetchText(CONFIG.CORS_PROXY + encodeURIComponent(u)));
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
const rupees = p => !p ? '' : /^[\d,.]+$/.test(p) ? '₹' + p : p;
