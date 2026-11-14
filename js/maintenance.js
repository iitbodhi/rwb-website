/* RWB — Ronin Maintenance page: the Maintenance PDFs from the RWB App's Guides */
const grid = $('#posts'), search = $('#post-search');
let posts = [];
/* Keyword search: every typed word must appear somewhere (title or description), in any order.
   Ignores case, underscores/dashes, and simple word endings (cleaning = clean, brakes = brake); allows one small typo. */
/* common rider spellings and short forms */
const SYN = { tire: ['tyre'], tires: ['tyre'], break: ['brake'], breaks: ['brake'], lube: ['lubric', 'lubricat'], lubricate: ['lube', 'lubric'], grease: ['lubric', 'lube'],
    puncher: ['puncture'], petrol: ['fuel'], fuel: ['petrol'], mileage: ['kmpl', 'efficiency'], tyre: ['tire'], oil: ['lubricant'], bulb: ['light', 'lamp'], light: ['bulb', 'lamp'],
    cleaning: ['wash'], wash: ['clean'], batt: ['battery'], ecu: ['software'], pads: ['pad'], disc: ['disk'], disk: ['disc'], chian: ['chain'], sprocket: ['chain'] };
const normText = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = w => w.length > 4 ? w.replace(/(ings|ing|ed|es|s)$/, '') : w;
const near = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
function searchMatch(query, text) {
    const words = normText(query).split(' ').filter(Boolean); if (!words.length) return true;
    const hay = normText(text), toks = hay.split(' ');
    const one = w => hay.includes(w) || toks.some(t => { const a = stem(t), b = stem(w); return a.startsWith(b) || b.startsWith(a) && a.length >= 3 || (b.length >= 5 && near(a, b)); });
    return words.every(w => [w, ...(SYN[w] || [])].some(one));
}
function markWords(html, query) {
    const words = normText(query).split(' ').filter(w => w.length >= 2).map(w => stem(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return words.length ? html.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>') : html;
}

const title = n => String(n).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const safe = u => /^https:\/\/(cdn\.jsdelivr\.net\/gh\/iitbodhi\/rwb-media@|roninwb\.in\/)/.test(String(u || '')) ? u : '';

/* Guides come from the RWB App's Guides → Maintenance (PDFs kept on GitHub, shown with our own viewer: no download or print) */
function draw() {
    const q = search.value.trim();
    const shown = posts.filter(p => searchMatch(q, p.title + ' ' + (p.description || '')));
    const count = document.getElementById('post-count');
    if (count) count.textContent = q ? `${shown.length} guide${shown.length === 1 ? '' : 's'} found` : '';
    grid.innerHTML = shown.length ? shown.map(p => `
        <article class="post">
            <button class="post-thumb" data-id="${p.id}" aria-label="Read ${esc(title(p.title))}">PDF
                ${safe(p.thumb) ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" draggable="false" onerror="this.remove()">` : ''}</button>
            <div class="post-body">
                <time datetime="${esc(p.date)}">${fmtDate(p.date)}${p.pages ? ` · ${p.pages} page${p.pages === 1 ? '' : 's'}` : ''}</time>
                <h3>${markWords(esc(title(p.title)), q)}</h3>
                ${p.description ? `<p>${markWords(esc(p.description), q)}</p>` : ''}
                <div class="post-actions"><button class="btn btn-sm" data-id="${p.id}">Read</button></div>
            </div>
        </article>`).join('') : `<p class="muted">${posts.length ? `No guides match “${esc(q)}”. Try fewer or different words.` : 'Guides will be posted here soon.'}</p>`;
}
let viewer = null;
grid.addEventListener('click', e => {
    const id = e.target.closest('[data-id]')?.dataset.id; if (!id) return;
    const p = posts.find(x => String(x.id) === id); if (!p || !safe(p.url)) return;
    openDialog(`<div class="pdf-bar"><b>${esc(title(p.title))}</b>${p.pages ? `<span>${p.pages} page${p.pages === 1 ? '' : 's'}</span>` : ''}</div><div class="pdf-host"></div>`, 'pdf');
    viewer = RWBPdf.show($('#dialog-body .pdf-host'), p.url);
});
dialog.addEventListener('close', () => { viewer?.close(); viewer = null; });
search.addEventListener('input', draw);

(async () => {
    try {
        const r = await fetch(CONFIG.APP_SUPABASE_URL + '/rest/v1/rpc/public_guides', { method: 'POST', headers: { apikey: CONFIG.APP_SUPABASE_KEY, Authorization: 'Bearer ' + CONFIG.APP_SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' });
        if (!r.ok) throw 0;
        posts = (await r.json()).filter(p => safe(p.url));
        draw();
        if (posts.length) setTimeout(() => RWBPdf.preload().catch(() => {}), 1500);   /* the viewer is ready by the time someone taps Read */
    } catch { grid.innerHTML = '<p class="muted">Guides could not be loaded. Please try again later.</p>'; }
})();
