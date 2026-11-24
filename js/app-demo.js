/* RWB website: "Try it here" app demo. Real app screens (assets/demo), the visitor taps the glowing spot to go on.
   Data: feature -> [[image, tap box in app px (390 x 844) or null, caption], ...]. Remake: tools/app-demo (see README there). */
(() => {
    const root = document.getElementById('app-demo'); if (!root) return;
    const F = {"track": [["track-1", [167, 780, 56, 64], "Going for a ride? Tap Track."], ["track-2", [20, 654, 350, 78], "Tap View to see who’s riding."], ["track-3", [214, 284, 56, 62], "Every RWB rider sharing, live. Tap a rider."], ["track-4", null, "Speed, distance and directions to them."]], "sos": [["sos-1", [167, 780, 56, 64], "In trouble on the road? Tap Track."], ["sos-2", [20, 742, 350, 78], "Tap SOS."], ["sos-3", null, "Hold for 2 seconds. The RWB team gets your location at once."]], "fam": [["fam-1", [161, 467, 68, 77], "Tap FAM to invite your family."], ["fam-2", null, "Up to 3 family members see you’re safe when you share your ride."]], "service": [["service-1", [234, 720, 140, 44], "Every service, with its bill. Tap Add service."], ["service-2", null, "Today’s date and your km are filled in for you."], ["service-3", null, "And your real km/l, compared with all of RWB."]], "events": [["events-1", [16, 130, 358, 128], "Coming rides and meets. Tap a ride."], ["events-2", [33, 353, 103, 44], "Time, place and the plan. Tap Going."], ["events-3", null, "You’re in. Costs are shared right here."]], "motomart": [["motomart-1", [260, 486, 114, 191], "Gear from riders you trust. Tap an item."], ["motomart-2", null, "Photos, price and condition. Message the rider to buy."]], "pookie": [["pookie-1", [320, 710, 54, 54], "Got a bike question? Tap Pookie."], ["pookie-2", [71, 362, 247, 29], "Tap a question, or type your own."], ["pookie-3", null, "Answers from what RWB riders taught Pookie."]], "boards": [["boards-1", [279, 780, 56, 64], "Tap Warriors."], ["boards-2", [89, 240, 67, 83], "The top riders of RWB. Tap a board."], ["boards-3", null, "Track km, mileage, service: there's a board for each."]]};
    const AW = 390, AH = 844, SRC = n => `assets/demo/${n}.webp`;
    const tabs = [...root.querySelectorAll('.axd-tab')], scr = root.querySelector('.axd-scr'), [ia, ib] = root.querySelectorAll('.axd-img');
    const hot = root.querySelector('.axd-hot'), rip = root.querySelector('.axd-rip'), cap = root.querySelector('.axd-cap');
    const dots = root.querySelector('.axd-dots'), next = root.querySelector('.axd-next');
    let f = 'track', i = 0, front = ia, started = false, seq = 0;
    const pre = n => { const im = new Image(); im.src = SRC(n); };
    function show() {
        const steps = F[f], st = steps[i], last = i === steps.length - 1;
        const back = front === ia ? ib : ia, tok = ++seq;
        const swap = () => { if (tok !== seq || front === back) return; back.classList.add('on'); front.classList.remove('on'); front = back; };
        back.onload = swap; back.src = SRC(st[0]);
        if (back.complete && back.naturalWidth) swap();
        cap.textContent = st[2];
        dots.innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
        if (st[1]) { const [x, y, w, h] = st[1], p = 6;
            Object.assign(hot.style, { left: (x - p) / AW * 100 + '%', top: (y - p) / AH * 100 + '%', width: (w + 2 * p) / AW * 100 + '%', height: (h + 2 * p) / AH * 100 + '%' });
            hot.hidden = false; hot.setAttribute('aria-label', st[2]); }
        else hot.hidden = true;
        next.textContent = last ? (tabs.findIndex(t => t.dataset.f === f) < tabs.length - 1 ? 'Next feature \u2192' : 'Start again') : 'Next';
        if (steps[i + 1]) pre(steps[i + 1][0]);
    }
    function pick(k, focus) {
        f = k; i = 0;
        tabs.forEach(t => { const on = t.dataset.f === k; t.setAttribute('aria-selected', on); if (on && focus) t.focus(); });
        show();
    }
    function go() {
        if (i < F[f].length - 1) { i++; show(); return; }
        const n = tabs.findIndex(t => t.dataset.f === f);
        pick(tabs[(n + 1) % tabs.length].dataset.f);
        if (matchMedia('(max-width: 899px)').matches) tabs[(n + 1) % tabs.length].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    hot.addEventListener('click', e => {
        const r = scr.getBoundingClientRect(), h = hot.getBoundingClientRect();
        rip.style.left = (h.left + h.width / 2 - r.left) + 'px'; rip.style.top = (h.top + h.height / 2 - r.top) + 'px';
        rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go');
        setTimeout(go, 170); e.stopPropagation();
    });
    scr.addEventListener('click', () => { if (hot.hidden) return; hot.classList.remove('nudge'); void hot.offsetWidth; hot.classList.add('nudge'); });
    next.addEventListener('click', go);
    tabs.forEach((t, n) => {
        t.addEventListener('click', () => pick(t.dataset.f));
        t.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (d) { e.preventDefault(); pick(tabs[(n + d + tabs.length) % tabs.length].dataset.f, true); } });
    });
    const start = () => { if (started) return; started = true; pick(f); };
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { start(); io.disconnect(); } }, { rootMargin: '400px' }); io.observe(root); }
    else start();
})();
