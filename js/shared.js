/* RWB — shared.js (loaded on every page): header, footer, dialog and helpers */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Header + footer + popup are built here once, so editing the menu changes every page */
(function buildPage() {
    const here = document.body.dataset.page, home = here === 'home', base = home ? '' : 'index.html';
    const link = (href, label, key) => `<a href="${href}"${key === here ? ' aria-current="page"' : ''}>${label}</a>`;
    /* slow drifting glow behind every page */
    document.body.insertAdjacentHTML('afterbegin', '<div class="bg" aria-hidden="true"><i></i><i></i><i></i></div>');
    document.body.insertAdjacentHTML('afterbegin', `
<header class="nav" id="nav">
  <a href="${home ? '#home' : 'index.html'}" class="nav-brand"><img src="assets/logo.png" alt="" width="40" height="40"><span>RWB</span></a>
  <nav class="nav-links" id="nav-links" aria-label="Main">
    ${link(base + '#join', 'Social')}${link(base + '#events', 'Events')}${link(base + '#gallery', 'Gallery')}${link('maintenance.html', 'Maintenance', 'maintenance')}${link('accessories.html', 'Accessories', 'accessories')}${link(base + '#market', 'Marketplace')}${link(base + '#warriors', 'Warriors')}${link(base + '#about', 'About')}
  </nav>
  <a href="#" class="btn btn-sm join-link" target="_blank" rel="noopener">Join us</a>
  <button class="icon-btn nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
</header>`);
    document.body.insertAdjacentHTML('beforeend', `
<footer class="footer"><p>Copyright of this website is reserved by Ronin Warriors of Bengal. roninwb.in</p></footer>
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

/* Google Drive share link -> direct picture (other links pass through unchanged) */
function driveImg(u) {
    const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=view&)?id=)([\w-]+)/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : u;
}
