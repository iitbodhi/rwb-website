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
    ${link(base + '#join', 'Social')}${link(base + '#events', 'Events')}${link(base + '#gallery', 'Gallery')}${link('maintenance.html', 'Maintenance', 'maintenance')}${link('accessories.html', 'Accessories', 'accessories')}${link(base + '#market', 'Marketplace')}${link(base + '#warriors', 'Warriors')}${link(base + '#app', 'App')}${link(base + '#about', 'About')}
  </nav>
  <a href="#" class="btn btn-sm join-link" target="_blank" rel="noopener">Join us</a>
  <button class="icon-btn nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
</header>`);
    document.body.insertAdjacentHTML('beforeend', `
<footer class="footer"><p>Copyright of this website is reserved by Ronin Warriors of Bengal. roninwb.in</p><p class="footer-link"><a href="team-guide.html">Team guide</a> for admins and coordinators · <a href="privacy.html">Privacy policy</a> · <a href="terms.html">Terms &amp; Conditions</a></p></footer>
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

/* ===== Motion: scroll reveals, split headings, nav and scroll progress ===== */
(function motion() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.add('js');
    const prog = document.createElement('div'); prog.className = 'scroll-prog'; document.body.append(prog);
    const nav = document.getElementById('nav');
    let ticking = false;
    const onScroll = () => { ticking = false; const h = document.documentElement.scrollHeight - innerHeight;
        prog.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`; nav?.classList.toggle('scrolled', scrollY > 10); };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll();
    /* split a heading into words that rise in */
    const split = el => { if (el.dataset.done) return; el.dataset.done = 1; let k = 0;
        const walk = node => [...node.childNodes].forEach(n => {
            if (n.nodeType === 3) { const frag = document.createDocumentFragment();
                n.textContent.split(/(\s+)/).forEach(w => { if (!w) return; if (/^\s+$/.test(w)) { frag.append(w); return; }
                    const o = document.createElement('span'); o.className = 'w'; const i = document.createElement('span'); i.textContent = w; i.style.setProperty('--d', (k++ * .07) + 's'); o.append(i); frag.append(o); });
                n.replaceWith(frag); }
            else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n); });
        walk(el); };
    const hero = document.querySelector('.hero h1'); if (hero && !reduce) { split(hero); hero.querySelectorAll('.w > span').forEach((x, i) => x.style.setProperty('--d', (.15 + i * .1) + 's')); }
    document.querySelectorAll('[data-split]').forEach(el => { split(el); el.classList.add('split'); });
    const auto = '.section h2, .section .lead, .section > .wrap > p, .section .rail, .section .tabs, .stats, .page-head > *, .teaser, .join .btn, .social, .footer';
    document.querySelectorAll(auto).forEach(el => { if (!el.closest('[data-reveal]') && !el.hasAttribute('data-split')) el.setAttribute('data-reveal', el.getAttribute('data-reveal') || ''); });
    /* siblings come in one after another */
    document.querySelectorAll('[data-reveal]').forEach(el => { const sib = [...el.parentElement.children].filter(x => x.hasAttribute('data-reveal')); const i = sib.indexOf(el); if (i > 0 && !el.style.getPropertyValue('--d')) el.style.setProperty('--d', Math.min(i * .08, .6) + 's'); });
    const targets = document.querySelectorAll('[data-reveal], [data-split], .section h2');
    if (reduce || !('IntersectionObserver' in window)) { targets.forEach(el => el.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    targets.forEach(el => io.observe(el));
    /* never leave anything hidden (e.g. a printed page or a very tall element) */
    setTimeout(() => document.querySelectorAll('[data-reveal]:not(.in)').forEach(el => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('in'); }), 2500);
})();
