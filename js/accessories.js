/* RWB — Ronin Accessories page.
   Sheet columns: name | category | score | link | price | image (optional) */
const list = $('#acc-list'), toolbar = $('#acc-toolbar'), countEl = $('#acc-count');
let items = [];
const view = { category: 'all', sort: 'default' };
const SORTS = {
    default: 'Default order',
    'price-asc': 'Price, low to high',
    'price-desc': 'Price, high to low',
    'rating-desc': 'Rating, high to low',
    'rating-asc': 'Rating, low to high'
};
const safeLink = u => /^https?:\/\//i.test(u) ? u : '';

/* numbers used for sorting (blank price or score always goes to the end) */
function priceNum(p) {
    const m = String(p || '').match(/\d[\d,]*(?:\.\d+)?/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : null;
}
function scoreNum(s) { const n = parseFloat(s); return isNaN(n) ? null : Math.max(0, Math.min(5, n)); }
function sortItems(arr) {
    const [key, dir] = view.sort.split('-');
    if (!dir) return arr;
    const val = i => key === 'price' ? priceNum(i.price) : scoreNum(i.score);
    const sign = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x - y) * sign;
    });
}

/* ---------- website preview image ----------
   1) the optional "image" column in the sheet wins (direct image link or Google Drive share link)
   2) otherwise the product link is read by a free link-preview service (microlink.io) to find its picture */
const previewJobs = new Map();
function getPreview(url) {
    const key = 'rwb-pv:' + url;
    try {
        const c = JSON.parse(localStorage.getItem(key));
        if (c && Date.now() - c.t < (c.img ? 7 * 864e5 : 36e5)) return Promise.resolve(c.img);
    } catch { /* storage unavailable: just fetch */ }
    if (!previewJobs.has(url)) previewJobs.set(url, (async () => {
        let img = '';
        try {
            const j = await (await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))).json();
            const u = j?.data?.image?.url || '';
            if (/^https:\/\//i.test(u)) img = u;
        } catch { /* no preview available */ }
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), img })); } catch { /* ignore */ }
        return img;
    })());
    return previewJobs.get(url);
}
function setThumb(box, src) {
    const im = new Image();
    im.alt = ''; im.referrerPolicy = 'no-referrer'; im.decoding = 'async';
    im.onload = () => { box.replaceChildren(im); box.classList.add('has-img'); };
    im.onerror = () => box.remove();
    im.src = src;
}
const thumbObs = new IntersectionObserver(entries => entries.forEach(async e => {
    if (!e.isIntersecting) return;
    thumbObs.unobserve(e.target);
    const box = e.target, src = await getPreview(box.dataset.link);
    src ? setThumb(box, src) : box.remove();
}), { rootMargin: '200px' });

/* ---------- drawing ---------- */
function draw() {
    const filtered = items.filter(i => view.category === 'all' || i.category === view.category);
    const shown = sortItems(filtered);
    countEl.textContent = items.length ? `Showing ${shown.length} of ${items.length} products` : '';
    list.innerHTML = shown.length ? shown.map(i => {
        const score = scoreNum(i.score) ?? 0, link = safeLink(i.link), price = rupees(i.price), own = i.image ? driveImg(i.image) : '';
        const thumb = own ? `<div class="acc-img" data-src="${esc(own)}"></div>` : link ? `<div class="acc-img" data-link="${esc(link)}"></div>` : '';
        return `<article class="acc">${thumb}
            <div class="acc-body">
                ${i.category ? `<span class="acc-cat">${esc(i.category)}</span>` : ''}
                <h3>${esc(i.name)}</h3>
                <div class="acc-row">
                    <div><span class="stars" style="--s:${score}" role="img" aria-label="RWB score ${score} out of 5">★★★★★</span><span class="acc-score">RWB score ${score}/5</span></div>
                    ${price ? `<b class="price">${esc(price)}</b>` : ''}
                </div>
                ${link ? `<a class="btn btn-sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View product</a>` : ''}
            </div></article>`;
    }).join('') : `<p class="muted">${items.length ? 'No products in this category.' : 'Recommended gear will be listed here soon.'}</p>`;
    $$('#acc-list .acc-img').forEach(box => box.dataset.src ? setThumb(box, box.dataset.src) : thumbObs.observe(box));
}

/* ---------- Filter and Sort menus ---------- */
const menus = { filter: $('[data-menu="filter"]'), sort: $('[data-menu="sort"]') };
function closeMenus(except) {
    Object.values(menus).forEach(m => { if (m !== except) { m.querySelector('.menu-panel').hidden = true; m.querySelector('.chip').setAttribute('aria-expanded', 'false'); } });
}
function buildMenu(name, options, current) {
    const m = menus[name];
    m.querySelector('.menu-panel').innerHTML = options.map(([val, label]) =>
        `<button type="button" role="menuitemradio" aria-checked="${val === current}" data-val="${esc(val)}">${esc(label)}</button>`).join('');
}
function refreshToolbar() {
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
    buildMenu('filter', [['all', 'All categories'], ...cats.map(c => [c, c])], view.category);
    buildMenu('sort', Object.entries(SORTS), view.sort);
    const fBtn = menus.filter.querySelector('.chip'), sBtn = menus.sort.querySelector('.chip');
    fBtn.textContent = view.category === 'all' ? 'Filter' : 'Filter: ' + view.category;
    sBtn.textContent = view.sort === 'default' ? 'Sort' : 'Sort: ' + SORTS[view.sort];
    fBtn.classList.toggle('on', view.category !== 'all');
    sBtn.classList.toggle('on', view.sort !== 'default');
    $('#acc-clear').hidden = view.category === 'all' && view.sort === 'default';
    menus.filter.hidden = cats.length < 2;
}
Object.entries(menus).forEach(([name, m]) => {
    const btn = m.querySelector('.chip'), panel = m.querySelector('.menu-panel');
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = panel.hidden; closeMenus(m);
        panel.hidden = !open; btn.setAttribute('aria-expanded', open);
    });
    panel.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        view[name === 'filter' ? 'category' : 'sort'] = b.dataset.val;
        closeMenus(); refreshToolbar(); draw();
        btn.focus();
    });
});
document.addEventListener('click', () => closeMenus());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
$('#acc-clear').addEventListener('click', () => { view.category = 'all'; view.sort = 'default'; refreshToolbar(); draw(); });

(async () => {
    if (!CONFIG.ACCESSORIES_SHEET_URL) { draw(); return; }
    try {
        items = parseCSV(await fetchCSV(CONFIG.ACCESSORIES_SHEET_URL)).filter(r => r.name);
        if (items.length) { toolbar.hidden = false; refreshToolbar(); }
        draw();
    } catch { list.innerHTML = '<p class="muted">Recommendations could not be loaded. Please try again later.</p>'; }
})();
