/* RWB — Ronin Maintenance page: lists the PDFs in a Google Drive folder */
const grid = $('#posts'), search = $('#post-search');
let posts = [];
const title = n => n.replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim();
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = posts.filter(p => (title(p.name) + ' ' + p.description).toLowerCase().includes(q));
    grid.innerHTML = shown.length ? shown.map(p => `
        <article class="post">
            <button class="post-thumb" data-id="${p.id}" aria-label="Read ${esc(title(p.name))}">PDF
                <img src="https://drive.google.com/thumbnail?id=${p.id}&sz=w600" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></button>
            <div class="post-body">
                <time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>
                <h3>${esc(title(p.name))}</h3>
                ${p.description ? `<p>${esc(p.description)}</p>` : ''}
                <div class="post-actions">
                    <button class="btn btn-sm" data-id="${p.id}">Read</button>
                    <a class="btn btn-sm btn-ghost" href="https://drive.google.com/uc?export=download&id=${p.id}" target="_blank" rel="noopener">Download</a>
                </div>
            </div>
        </article>`).join('') : `<p class="muted">${posts.length ? 'No guides match your search.' : 'Guides will be posted here soon.'}</p>`;
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
