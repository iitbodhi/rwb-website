/* RWB — Ronin Maintenance page: lists the PDFs in a Google Drive folder */
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

const title = n => n.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function draw() {
    const q = search.value.trim();
    const shown = posts.filter(p => searchMatch(q, p.name + ' ' + title(p.name) + ' ' + (p.description || '')));
    const count = document.getElementById('post-count');
    if (count) count.textContent = q ? `${shown.length} guide${shown.length === 1 ? '' : 's'} found` : '';
    grid.innerHTML = shown.length ? shown.map(p => `
        <article class="post">
            <button class="post-thumb" data-id="${p.id}" aria-label="Read ${esc(title(p.name))}">PDF
                <img src="https://drive.google.com/thumbnail?id=${p.id}&sz=w600" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></button>
            <div class="post-body">
                <time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>
                <h3>${markWords(esc(title(p.name)), q)}</h3>
                ${p.description ? `<p>${markWords(esc(p.description), q)}</p>` : ''}
                <div class="post-actions">
                    <button class="btn btn-sm" data-id="${p.id}">Read</button>
                    <a class="btn btn-sm btn-ghost" href="https://drive.google.com/uc?export=download&id=${p.id}" target="_blank" rel="noopener">Download</a>
                </div>
            </div>
        </article>`).join('') : `<p class="muted">${posts.length ? `No guides match “${esc(q)}”. Try fewer or different words.` : 'Guides will be posted here soon.'}</p>`;
}
grid.addEventListener('click', e => {
    const id = e.target.closest('[data-id]')?.dataset.id; if (!id || !/^[\w-]+$/.test(id)) return;
    const p = posts.find(x => x.id === id);
    openDialog(`<div class="pdf-bar"><b>${esc(title(p.name))}</b>
        <a href="https://drive.google.com/file/d/${id}/view" target="_blank" rel="noopener">Open in new tab</a></div>
        <iframe src="https://drive.google.com/file/d/${id}/preview" title="${esc(title(p.name))}"></iframe>`, 'pdf');
});
search.addEventListener('input', draw);

(async () => {
    if (!CONFIG.MAINTENANCE_SCRIPT_URL) { draw(); return; }
    try {
        posts = (await (await fetch(CONFIG.MAINTENANCE_SCRIPT_URL)).json()).filter(p => /^[\w-]+$/.test(p.id));
        posts.sort((a, b) => b.date.localeCompare(a.date));  /* newest first */
        draw();
    } catch { grid.innerHTML = '<p class="muted">Guides could not be loaded. Please try again later.</p>'; }
})();
