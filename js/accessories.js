/* RWB — Ronin Accessories page. Sheet columns: name | category | score | link | price */
const list = $('#acc-list'), catTabs = $('#acc-tabs');
let items = [];
const safeLink = u => /^https?:\/\//i.test(u) ? u : '';

function draw(filter = 'all') {
    const shown = items.filter(i => filter === 'all' || i.category === filter);
    list.innerHTML = shown.length ? shown.map(i => {
        const score = Math.max(0, Math.min(5, parseFloat(i.score) || 0)), link = safeLink(i.link), price = rupees(i.price);
        return `<article class="acc">
            ${i.category ? `<span class="acc-cat">${esc(i.category)}</span>` : ''}
            <h3>${esc(i.name)}</h3>
            <div class="acc-row">
                <div><span class="stars" style="--s:${score}" role="img" aria-label="RWB score ${score} out of 5">★★★★★</span><span class="acc-score">RWB score ${score}/5</span></div>
                ${price ? `<b class="price">${esc(price)}</b>` : ''}
            </div>
            ${link ? `<a class="btn btn-sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View product</a>` : ''}
        </article>`;
    }).join('') : '<p class="muted">Recommended gear will be listed here soon.</p>';
}

(async () => {
    if (!CONFIG.ACCESSORIES_SHEET_URL) { draw(); return; }
    try {
        items = parseCSV(await fetchCSV(CONFIG.ACCESSORIES_SHEET_URL)).filter(r => r.name);
        const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
        if (cats.length > 1) {
            catTabs.innerHTML = ['All', ...cats].map((c, n) => `<button class="${n ? '' : 'active'}" data-filter="${esc(n ? c : 'all')}">${esc(c)}</button>`).join('');
            tabs('#acc-tabs', draw);
        }
        draw();
    } catch { list.innerHTML = '<p class="muted">Recommendations could not be loaded. Please try again later.</p>'; }
})();
