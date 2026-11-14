/* RWB — guide PDF viewer (website + app). Shows each page as a picture with pdf.js (kept in js/pdfjs, Apache-2.0),
   so there is no Google page, no download/print/open buttons and no selectable text. While a guide is open,
   right-click, Ctrl/⌘+P and Ctrl/⌘+S are blocked and printing gives a blank page.
   Note: this stops casual saving only. Anything shown on a screen can still be photographed or screenshotted. */
(function () {
    const base = (document.currentScript?.src || location.href).replace(/[^/]*$/, '') + 'pdfjs/';
    let lib = null, open = 0;
    const load = () => lib ||= import(base + 'pdf.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.mjs'; return m; });
    const css = document.createElement('style');
    css.textContent = `.pdfv{position:relative;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:#e9e6e0;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.pdfv-pages{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px}
.pdfv-page{position:relative;width:100%;background:#fff;box-shadow:0 2px 10px -4px rgba(0,0,0,.35);border-radius:4px;overflow:hidden}
.pdfv-page canvas{display:block;width:100%;height:100%;pointer-events:none}
.pdfv-page::after{content:"";position:absolute;inset:0}
.pdfv-msg{padding:2.5rem 1.2rem;text-align:center;color:#6b665f;font-size:.95rem}
.pdfv-spin{width:28px;height:28px;margin:0 auto .8rem;border-radius:50%;border:3px solid rgba(0,0,0,.12);border-top-color:#d4501a;animation:pdfv-r .8s linear infinite}
@keyframes pdfv-r{to{transform:rotate(1turn)}}
@media print{html.pdfv-on body{display:none!important}}`;
    document.head.append(css);
    const block = e => { if (open && (e.ctrlKey || e.metaKey) && /^[ps]$/i.test(e.key)) { e.preventDefault(); e.stopPropagation(); } };
    addEventListener('keydown', block, true);
    addEventListener('beforeprint', () => { if (open) document.documentElement.classList.add('pdfv-on'); });

    /* host: an empty element (give it a height). Returns { close } */
    function show(host, url) {
        let alive = true, doc = null, io = null, ro = null, lastW = 0;
        open++; document.documentElement.classList.add('pdfv-on');
        host.classList.add('pdfv'); host.innerHTML = '<div class="pdfv-msg"><div class="pdfv-spin"></div>Opening the guide…</div>';
        const stop = e => e.preventDefault();
        host.addEventListener('contextmenu', stop); host.addEventListener('dragstart', stop);
        const drawPage = async (box, force) => {
            if (!alive || !doc || (box.dataset.w == lastW && !force)) return;
            box.dataset.w = lastW;
            const page = await doc.getPage(+box.dataset.n);
            const w = box.clientWidth || lastW, v1 = page.getViewport({ scale: 1 });
            const dpr = Math.min(devicePixelRatio || 1, 2), vp = page.getViewport({ scale: w / v1.width * dpr });
            const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            if (!alive) return;
            box.querySelector('canvas')?.remove(); box.prepend(c);
        };
        (async () => {
            try {
                const pdfjs = await load();
                doc = await pdfjs.getDocument({ url, disableAutoFetch: true, isEvalSupported: false }).promise;
                if (!alive) return doc.destroy();
                host.innerHTML = '<div class="pdfv-pages"></div>';
                const wrap = host.firstChild; lastW = wrap.clientWidth - 20;
                for (let n = 1; n <= doc.numPages; n++) {
                    const v = (await doc.getPage(n)).getViewport({ scale: 1 });
                    const box = document.createElement('div'); box.className = 'pdfv-page'; box.dataset.n = n;
                    box.style.aspectRatio = `${v.width} / ${v.height}`; box.style.maxWidth = Math.max(v.width * 1.6, 640) + 'px';
                    wrap.append(box);
                }
                io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && drawPage(e.target)), { root: host, rootMargin: '600px 0px' });
                wrap.querySelectorAll('.pdfv-page').forEach(b => io.observe(b));
                let t = 0; ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { const w = wrap.clientWidth - 20; if (Math.abs(w - lastW) < 40) return; lastW = w;
                    wrap.querySelectorAll('.pdfv-page').forEach(b => { const r = b.getBoundingClientRect(), h = host.getBoundingClientRect(); if (r.bottom > h.top - 600 && r.top < h.bottom + 600) drawPage(b, true); else b.dataset.w = ''; }); }, 200); });
                ro.observe(host);
            } catch (e) {
                if (alive) host.innerHTML = '<div class="pdfv-msg">This guide couldn\'t open right now. Check your connection and try again.</div>';
            }
        })();
        return { close() { if (!alive) return; alive = false; io?.disconnect(); ro?.disconnect(); doc?.destroy(); host.innerHTML = '';
            if (--open <= 0) { open = 0; document.documentElement.classList.remove('pdfv-on'); } } };
    }
    window.RWBPdf = { show, preload: load };
})();
