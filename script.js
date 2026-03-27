/* ================================================================
   RWB v6.3 — script.js
   ✅ Gallery Apps Script bug fixed (removed invalid .setHeaders())
   ✅ Events: correct sheet URL (direct CSV export)
   ✅ Music: looping toggle button in nav
   ✅ Hint texts removed
   ================================================================ */
const CONFIG = {
    /* Direct CSV export — no "Publish to Web" step needed */
    EVENTS_SHEET_URL:  'https://docs.google.com/spreadsheets/d/13qt3ZmYHX1EILkQzqo9TzLWKfKmuAd_QwYzStDTLEzU/export?format=csv&gid=0',
    FORM_SCRIPT_URL:   'https://script.google.com/macros/s/AKfycbxkvBKEBHTLN-Q1QZvLB0o9qiRfuDmcSfUMT0Cay7D-na2ekwTWD-uuCDDswwI-UfFugw/exec',
    GALLERY_SCRIPT_URL:'https://script.google.com/macros/s/AKfycbzrswFdnP-IjFNdXedZDnc9aqg63sOqoLaVCkPC6p2sOzBzKNrjg0ryiYVphZgFlt29YA/exec',
    CORS_PROXY:'https://api.allorigins.win/raw?url='
};

const WARRIORS=[
    {name:'Sayantan Sarkar',        nickname:'Boss',         role:'admin',       roleLabel:'Founder & Admin',    bike:'TVS Ronin 225 (Orange) — Kurama  ·  TVS Ronin 225 (Black) — Shado',photo:'boss.png',   desc:'In the courtroom, he commands with the precision of law. On the open road, he commands with the authority of a man who built something from nothing. Sayantan didn\'t just found RWB — he breathed life into it. The Boss rides first. Always.'},
    {name:'Arnab Das',              nickname:'Boro Admin',   role:'admin',       roleLabel:'Co-Founder & Admin', bike:'TVS Ronin 225 (Galactic Grey) — TD',photo:'arnab.png',  desc:'Some men speak volumes. Arnab lets the tarmac do the talking. While others plan the ride, he\'s already at the next checkpoint. The quiet co-architect of RWB — his actions have always been louder than any engine note.'},
    {name:'Kaustabh Bhattacharjee', nickname:'Pookie',       role:'admin',       roleLabel:'Admin',              bike:'TVS Ronin 225',photo:'pookie.png', desc:'One lakh kilometres and still counting. If roads had a memory, they\'d remember Pookie\'s wheels before anything else. The Pookie of RWB is many things — but "stationary" has never been one of them.'},
    {name:'Debapam Pal',            nickname:'Momo',         role:'admin',       roleLabel:'Admin',              bike:'TVS Ronin 225 (Blue)',photo:'momo.png',   desc:'He debugs systems by day and destroys the pace chart by weekend. That warm, momomolicious smile is the last thing the group sees before he opens the throttle and vanishes into the horizon. The IT giant with a pure rider\'s soul.'},
    {name:'Bodhisatwa Mallick',     nickname:'Dancer Bodhi', role:'admin',       roleLabel:'Admin',              bike:'TVS Ronin 225 (Magma Red) — Sula',photo:'bodhi.png',  desc:'Compact in frame, limitless on the road. Bodhi carries a special hatred for public buses and a special love for the open lane. Whether it\'s the dance floor or the highway — his moves are always the ones everyone watches.'},
    {name:'Rohan Ghosh',            nickname:'Pinky',        role:'coadmin',     roleLabel:'Co-admin',           bike:'Bajaj Dominar 250 (Green) — Domi',photo:'pinky.png',  desc:'Every convoy needs its anchor. Pinky rides sweep — last in the line, first to notice if someone\'s missing. Born with marshal instincts and a protector\'s heart, Rohan ensures no Ronin Warrior ever gets left behind.'},
    {name:'Soumya JS',              nickname:'CC',           role:'coadmin',     roleLabel:'Co-admin',           bike:'TVS Ronin 225 — 2024 Special Edition (Nimbus Grey)',photo:'soumya.png', desc:'Middle-aged, slightly receding hairline, gloriously unrepentant. He draws the route maps with the obsession of a cartographer and loses them with the grace of a philosopher. For Soumya, the journey was never about the destination.'},
    {name:'Arpan Paik',             nickname:'Radio',        role:'coadmin',     roleLabel:'Co-admin',           bike:'RE Himalayan 411 (Mirage Silver)',photo:'arpan.png',  desc:'Where others see asphalt, Radio sees a frequency. Tuned permanently to the channel between throttle and horizon, Arpan runs on adrenaline, breathes adventure, and transmits energy to everyone who rides beside him.'},
    {name:'Ranit Pal Chowdhury',    nickname:'BBC',          role:'coordinator', roleLabel:'Co-ordinator',       bike:'TVS Ronin 225 (Lightning Black) — Kuro',photo:'ranit.png',  desc:'Negotiations are his profession, but the open road is his real boardroom. Fuelled by caffeine and armed with a camera eye, Ranit documents RWB\'s soul one frame at a time. Firmly, fiercely, unapologetically anti-squid.'},
    {name:'Sreejon',                nickname:'Kochi',        role:'coordinator', roleLabel:'Co-ordinator',       bike:'TVS Ronin 225 (Blue) — Pegasus',photo:'sreejon.png',desc:'The calmest presence in any pack. Kochi doesn\'t rush, doesn\'t rattle — he flows. Whether it\'s a 6 AM dawn patrol or a 400 km grind, he glides through it all with butter-smooth ease that makes everyone around him breathe easier.'},
    {name:'Subhankar Biswas',       nickname:'Labubu',       role:'coordinator', roleLabel:'Co-ordinator',       bike:'TVS Ronin 225 (Lightning Black)',photo:'labubu.png', desc:'Every mile he\'s ridden has been a chapter earned, not given. From wide-eyed newcomer to road-tested warrior — Labubu\'s transformation is what RWB is built for. He doesn\'t chase roads. He earns them, one rise and fall at a time.'},
    {name:'Arindam Biswas',         nickname:'Bucky',        role:'coordinator', roleLabel:'Co-ordinator',       bike:'TVS Ronin 225 (Galactic Grey) — Jarvis',photo:'bucky.png',  desc:'He balances ledgers by week and horizons by weekend. Bucky\'s best financial decision was never on a spreadsheet — it was Jarvis, the open road, and the choice to ride further than reason ever suggested.'},
    {name:'Moinak',                 nickname:'Sek-C',        role:'coordinator', roleLabel:'Co-ordinator',       bike:'Apache RTR 200 4V (Red Black)',photo:'moinak.png', desc:'Code compiles by day. Freedom compiles by night. Moinak lives in that precise commit between the daily push and the open road — where IT gives way to throttle, and deadlines give way to the horizon.'},
    {name:'Kaustav Sanyal',         nickname:'Offroader',    role:'coordinator', roleLabel:'Co-ordinator',       bike:'TVS Ronin 225 (Orange) — Ronin-X',photo:'roninx.png', desc:'Tarmac is a starting point, not a destination. Ronin-X takes his machine where maps run out and signal dies — through mud, ridgeline, and raw terrain. For Kaustav, the real road has always been the one nobody paved.'},
    {name:'Sourav Santara',         nickname:'KK',           role:'coordinator', roleLabel:'Co-ordinator',       bike:'TVS Ronin 225 (Galactic Grey)',photo:'sourav.png', desc:'An amateur in title only — behind the bars, KK rides with the hunger of someone discovering the road for the very first time, every time. A certified mountain addict whose Ronin already knows the hill roads better than the GPS does.'}
];

const DEFAULT_GALLERY=[
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-side-view-3.png?isig=0&q=80',label:'The Warrior',wide:true},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-front-three-quarter.png?isig=0&q=80',label:'Front Quarter'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-rear-view.png?isig=0&q=80',label:'Rear View'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-front-view.png?isig=0&q=80',label:'Face of a Warrior',wide:true},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-right-side-view-2.png?isig=0&q=80',label:'Charcoal Ember'},
    {url:'https://imgd.aeplcdn.com/664x374/n/cw/ec/198071/ronin-left-side-view.png?isig=0&q=80',label:'Left Profile'}
];

const isMobile=()=>window.innerWidth<=980;

/* Audio */
let _audioCtx=null,_audioUnlocked=false,_launchMusicPlayed=false;
function getAudioCtx(){
    if(!_audioCtx)_audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(_audioCtx.state==='suspended')_audioCtx.resume();
    return _audioCtx;
}

/* Gallery belt state */
let galScrollX=0,galHalfWidth=0,galPaused=false,galRAF=null;
let _galDragDelta=0;

/* ════ INIT ════ */
document.addEventListener('DOMContentLoaded',()=>{
    buildGrain();
    initThemeToggle();
    initCursor();
    initGlobalFireflies();
    initPreloader();
    initNav();
    initSmoothScroll();
    initParallax();
    initReveal();
    initCounters();
    initMagnetic();
    initMobileSpecRow();
    initWarriors();
    loadGalleryFromDrive();
    loadEventsFromSheet();
    initFormLogic();
    initAboutLogoRev();
    initLightbox();
});

/* 1. GRAIN */
function buildGrain(){
    const c=document.createElement('canvas');c.width=c.height=256;
    const ctx=c.getContext('2d'),img=ctx.createImageData(256,256);
    for(let i=0;i<img.data.length;i+=4){const v=Math.random()*255|0;img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255;}
    ctx.putImageData(img,0,0);
    const el=document.getElementById('grain');
    if(el){el.style.backgroundImage=`url(${c.toDataURL()})`;el.style.backgroundSize='256px';}
}

/* 2. THEME */
function initThemeToggle(){
    const btn=document.getElementById('theme-toggle'),html=document.documentElement;
    html.setAttribute('data-theme',localStorage.getItem('rwb-theme')||'dark');
    btn?.addEventListener('click',()=>{
        const next=html.getAttribute('data-theme')==='dark'?'light':'dark';
        html.setAttribute('data-theme',next);localStorage.setItem('rwb-theme',next);
    });
}

/* 3. CURSOR + TRAIL */
function initCursor(){
    if(isMobile())return;
    const cur=document.getElementById('cursor'),fol=document.getElementById('cursor-follower');
    if(!cur||!fol)return;
    let mx=0,my=0,fx=0,fy=0;
    const TRAIL_COUNT=6;const trail=[];
    const trailWrap=document.getElementById('cursor-trail-wrap');
    for(let i=0;i<TRAIL_COUNT;i++){
        const dot=document.createElement('div');dot.className='cursor-trail';
        const sz=Math.max(3,9-i);dot.style.cssText=`width:${sz}px;height:${sz}px;opacity:${(TRAIL_COUNT-i)/TRAIL_COUNT*.3}`;
        trailWrap?.appendChild(dot);trail.push({el:dot,x:0,y:0});
    }
    document.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;cur.style.left=mx+'px';cur.style.top=my+'px';});
    (function af(){
        fx+=(mx-fx)*.11;fy+=(my-fy)*.11;fol.style.left=fx+'px';fol.style.top=fy+'px';
        let lx=mx,ly=my;
        trail.forEach(t=>{t.x+=(lx-t.x)*.14;t.y+=(ly-t.y)*.14;t.el.style.left=t.x+'px';t.el.style.top=t.y+'px';lx=t.x;ly=t.y;});
        requestAnimationFrame(af);
    })();
    document.querySelectorAll('a,button,.gal-card,.warrior-card,.patch-ring,.social-btn').forEach(el=>{
        el.addEventListener('mouseenter',()=>{cur.classList.add('hov');fol.classList.add('hov');});
        el.addEventListener('mouseleave',()=>{cur.classList.remove('hov');fol.classList.remove('hov');});
    });
}

/* 4. FIREFLIES */
function initGlobalFireflies(){
    const canvas=document.getElementById('global-firefly');if(!canvas)return;
    const ctx=canvas.getContext('2d');let W,H;
    const COUNT=isMobile()?35:90;
    const resize=()=>{W=canvas.width=window.innerWidth;H=canvas.height=Math.max(document.body.scrollHeight||5000,window.innerHeight*4);};
    window.addEventListener('resize',()=>setTimeout(resize,400));
    window.addEventListener('load',resize);resize();
    class Firefly{
        constructor(){this.reset();}
        reset(){this.x=Math.random()*W;this.y=Math.random()*H;this.vx=(Math.random()-.5)*.5;this.vy=(Math.random()-.5)*.5;this.size=Math.random()*2.2+.5;this.maxOpacity=Math.random()*.65+.12;this.phase=Math.random()*Math.PI*2;this.speed=Math.random()*.016+.006;this.r=200+Math.random()*55|0;this.g=130+Math.random()*60|0;this.b=20+Math.random()*30|0;}
        update(t){this.x+=this.vx+Math.sin(t*.0008+this.phase)*.4;this.y+=this.vy+Math.cos(t*.0006+this.phase)*.3;this.opacity=this.maxOpacity*(0.5+0.5*Math.sin(t*this.speed+this.phase));if(this.x<-10||this.x>W+10||this.y<-10||this.y>H+10)this.reset();}
        draw(){ctx.beginPath();ctx.arc(this.x,this.y,this.size,0,Math.PI*2);ctx.fillStyle=`rgba(${this.r},${this.g},${this.b},${this.opacity})`;ctx.fill();const g=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.size*4);g.addColorStop(0,`rgba(${this.r},${this.g},${this.b},${this.opacity*.4})`);g.addColorStop(1,`rgba(${this.r},${this.g},${this.b},0)`);ctx.beginPath();ctx.arc(this.x,this.y,this.size*4,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();}
    }
    const flies=Array.from({length:COUNT},()=>new Firefly());
    let t=0,scrollY=0;
    window.addEventListener('scroll',()=>{scrollY=window.scrollY;},{passive:true});
    (function loop(){canvas.style.top=scrollY+'px';if(t%900===0)resize();ctx.clearRect(0,0,W,H);flies.forEach(f=>{f.update(t);f.draw();});t++;requestAnimationFrame(loop);})();
}

/* 5. PRELOADER — max 1.2s */
function initPreloader(){
    const hide=()=>{document.getElementById('preloader')?.classList.add('gone');document.body.classList.remove('loading');triggerHeroReveal();};
    const timer=setTimeout(hide,1200);
    window.addEventListener('load',()=>{clearTimeout(timer);setTimeout(hide,150);});
}
function triggerHeroReveal(){
    document.querySelectorAll('.hero .hero-reveal').forEach(el=>{
        setTimeout(()=>el.classList.add('visible'),parseInt(el.dataset.delay,10)||0);
    });
}

/* 6. NAV */
function initNav(){
    const nav=document.getElementById('nav');
    const toggle=document.getElementById('nav-toggle');
    const right=document.getElementById('nav-right');
    const scrl=document.getElementById('hero-scroll');
    const links=document.querySelectorAll('.nav-link');

    const closeNav=()=>{
        toggle.classList.remove('open');
        right.classList.remove('open');
        document.body.style.overflow='';
    };
    const openNav=()=>{
        toggle.classList.add('open');
        right.classList.add('open');
        document.body.style.overflow='hidden';
    };

    /* Scroll: solidify nav + update active link */
    window.addEventListener('scroll',()=>{
        const y=window.scrollY;
        nav.classList.toggle('solid',y>50);
        scrl?.classList.toggle('hide',y>130);
        let cur='';
        document.querySelectorAll('section[id]').forEach(s=>{
            if(y>=s.offsetTop-200)cur=s.id;
        });
        links.forEach(l=>l.classList.toggle('active',l.getAttribute('href')==='#'+cur));
    },{passive:true});

    /* Toggle button */
    toggle?.addEventListener('click',(e)=>{
        e.stopPropagation();
        right.classList.contains('open')?closeNav():openNav();
    });

    /* Close when a nav link is clicked */
    links.forEach(l=>l.addEventListener('click',closeNav));
    document.querySelector('.nav-cta')?.addEventListener('click',closeNav);

    /* Close when clicking the dim backdrop (outside the drawer panel) */
    document.addEventListener('click',(e)=>{
        if(!right.classList.contains('open'))return;
        if(!right.contains(e.target)&&e.target!==toggle&&!toggle.contains(e.target)){
            closeNav();
        }
    });

    /* Close on Escape key */
    document.addEventListener('keydown',(e)=>{
        if(e.key==='Escape')closeNav();
    });
}

/* 7. SMOOTH SCROLL */
function initSmoothScroll(){
    const nav=document.getElementById('nav');
    document.querySelectorAll('a[href^="#"]').forEach(a=>{
        a.addEventListener('click',e=>{
            const t=document.querySelector(a.getAttribute('href'));
            if(!t)return;e.preventDefault();
            window.scrollTo({top:t.getBoundingClientRect().top+window.scrollY-nav.offsetHeight,behavior:'smooth'});
        });
    });
}

/* 8. PARALLAX (desktop only) */
function initParallax(){
    if(isMobile())return;
    const img=document.getElementById('hero-img');
    window.addEventListener('scroll',()=>{if(img)img.style.transform=`translateY(${window.scrollY*.32}px)`;},{passive:true});
}

/* 9. REVEAL */
function initReveal(){
    const obs=new IntersectionObserver(entries=>{
        entries.forEach(e=>{
            if(!e.isIntersecting)return;
            const el=e.target,d=parseFloat(el.dataset.delay||0)*1000;
            setTimeout(()=>el.classList.add('revealed'),d);
            obs.unobserve(el);
        });
    },{threshold:.08,rootMargin:'0px 0px -50px 0px'});
    document.querySelectorAll('.reveal-up:not(.hero *), .reveal-left, .reveal-right').forEach(el=>obs.observe(el));
}

/* 10. COUNTERS */
function initCounters(){
    const obs=new IntersectionObserver(entries=>{
        entries.forEach(e=>{if(e.isIntersecting){animateCount(e.target);obs.unobserve(e.target);}});
    },{threshold:.5});
    document.querySelectorAll('.stat-num[data-target], .st-num[data-target]').forEach(el=>obs.observe(el));
}
function animateCount(el){
    const target=parseInt(el.dataset.target,10),steps=55;let count=0;
    const t=setInterval(()=>{
        count++;el.textContent=Math.floor((1-Math.pow(1-count/steps,3))*target).toLocaleString();
        if(count>=steps){el.textContent=target.toLocaleString();clearInterval(t);}
    },1800/steps);
}

/* 11. MAGNETIC (desktop only) */
function initMagnetic(){
    if(isMobile())return;
    document.querySelectorAll('.magnetic').forEach(el=>{
        el.addEventListener('mousemove',e=>{const r=el.getBoundingClientRect();const cx=e.clientX-r.left-r.width/2;const cy=e.clientY-r.top-r.height/2;el.style.transform=`translate(${cx*.18}px,${cy*.18}px)`;});
        el.addEventListener('mouseleave',()=>{el.style.transform='';el.style.transition='transform .6s cubic-bezier(.16,1,.3,1)';setTimeout(()=>el.style.transition='',600);});
        el.addEventListener('mouseenter',()=>{el.style.transition='transform .1s ease';});
    });
}

/* ── 11b. MOBILE SPEC TAGS ROW ──
   Moves spec tags into a horizontal flex row below the logo on mobile.
   Must run after DOM is ready. ── */
function initMobileSpecRow(){
    if(window.innerWidth>980)return;
    const wrap=document.querySelector('.patch-wrap');
    if(!wrap)return;
    /* Remove any existing row to avoid duplicates */
    const existing=wrap.querySelector('.spec-row');
    if(existing)existing.remove();
    const t1=document.querySelector('.spec-tag-1');
    const t2=document.querySelector('.spec-tag-2');
    const t3=document.querySelector('.spec-tag-3');
    if(!t1||!t2||!t3)return;
    const row=document.createElement('div');
    row.className='spec-row';
    /* Order: TVS Ronins | Service Camps | Service Centers */
    row.appendChild(t1);
    row.appendChild(t3);
    row.appendChild(t2);
    wrap.appendChild(row);
}

/* ================================================================
   12. WARRIORS — Manual drag + CSS scroll-snap + center highlight
   ================================================================ */
let warCurrentList=[...WARRIORS];

function initWarriors(){
    document.querySelectorAll('.wtab').forEach(tab=>{
        tab.addEventListener('click',()=>{
            document.querySelectorAll('.wtab').forEach(t=>t.classList.remove('active'));
            tab.classList.add('active');
            const f=tab.dataset.filter;
            warCurrentList=f==='all'?[...WARRIORS]:WARRIORS.filter(w=>w.role===f);
            renderWarriorCards(warCurrentList);
        });
    });

    /* Arrow buttons: scroll by one card width */
    const CARD_W=292+20; /* card + margin */
    document.getElementById('war-prev')?.addEventListener('click',()=>{
        const outer=document.getElementById('warriors-track-outer');
        if(outer)outer.scrollBy({left:-CARD_W,behavior:'smooth'});
    });
    document.getElementById('war-next')?.addEventListener('click',()=>{
        const outer=document.getElementById('warriors-track-outer');
        if(outer)outer.scrollBy({left:CARD_W,behavior:'smooth'});
    });

    renderWarriorCards(warCurrentList);
}

function renderWarriorCards(list){
    const track=document.getElementById('warriors-track');if(!track)return;
    track.innerHTML=list.map(w=>{
        const init=w.name.split(' ').map(n=>n[0]).join('').slice(0,2);
        return`<div class="warrior-card" data-role="${w.role}">
            <div class="wcard-photo">
                <img src="${w.photo}" alt="${w.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="wcard-placeholder" style="display:none"><span class="wcard-initials">${init}</span></div>
                <div class="wcard-overlay"></div>
                <div class="wcard-role-ribbon ${w.role}">${w.roleLabel}</div>
            </div>
            <div class="wcard-info">
                <div class="wcard-name">${w.name}</div>
                ${w.nickname?`<span class="wcard-nickname">"${w.nickname}"</span>`:''}
                <div class="wcard-title">${w.roleLabel}</div>
                <div class="wcard-bike">${w.bike}</div>
                <div class="wcard-divider"></div>
                <div class="wcard-desc">${w.desc}</div>
            </div>
        </div>`;
    }).join('');

    /* Click to toggle permanent color */
    track.querySelectorAll('.warrior-card').forEach(c=>{
        c.addEventListener('click',()=>{
            const wasOn=c.classList.contains('color-on');
            /* Toggle — but don't toggle if center card already forces color */
            c.classList.toggle('color-on',!wasOn);
        });
    });

    buildWarDots(list.length);
    initWarriorCenterDetect();
    initWarriorDrag();
}

function buildWarDots(total){
    const dots=document.getElementById('war-dots');if(!dots)return;
    dots.innerHTML=Array.from({length:total},(_,i)=>`<div class="war-dot" data-i="${i}"></div>`).join('');
    dots.querySelector('.war-dot')?.classList.add('active');
    const CARD_W=292+20;
    dots.querySelectorAll('.war-dot').forEach(d=>{
        d.addEventListener('click',()=>{
            const outer=document.getElementById('warriors-track-outer');
            if(outer)outer.scrollTo({left:parseInt(d.dataset.i)*CARD_W,behavior:'smooth'});
        });
    });
}

/* CENTER CARD DETECTION — highlight card whose center is closest to track center */
function initWarriorCenterDetect(){
    const outer=document.getElementById('warriors-track-outer');if(!outer)return;
    const update=()=>{
        const outerRect=outer.getBoundingClientRect();
        const outerCenter=outerRect.left+outerRect.width/2;
        let closest=null,minDist=Infinity;
        outer.querySelectorAll('.warrior-card').forEach(card=>{
            const r=card.getBoundingClientRect();
            const cardCenter=r.left+r.width/2;
            const dist=Math.abs(cardCenter-outerCenter);
            if(dist<minDist){minDist=dist;closest=card;}
        });
        outer.querySelectorAll('.warrior-card').forEach(c=>c.classList.remove('in-center'));
        if(closest)closest.classList.add('in-center');

        /* Update dots */
        const cards=[...outer.querySelectorAll('.warrior-card')];
        const idx=closest?cards.indexOf(closest):0;
        const listLen=warCurrentList.length;
        const dotIdx=idx%listLen;
        document.querySelectorAll('.war-dot').forEach((d,i)=>d.classList.toggle('active',i===dotIdx));
    };
    outer.addEventListener('scroll',update,{passive:true});
    /* Also update on window scroll/resize */
    window.addEventListener('scroll',update,{passive:true});
    /* Initial update after render */
    setTimeout(update,100);
}

/* DRAG support for warriors */
function initWarriorDrag(){
    const outer=document.getElementById('warriors-track-outer');if(!outer)return;
    let startX=0,startScroll=0,dragging=false;
    const start=(x)=>{startX=x;startScroll=outer.scrollLeft;dragging=true;outer.classList.add('dragging');};
    const move=(x)=>{if(!dragging)return;outer.scrollLeft=startScroll-(x-startX);};
    const end=()=>{dragging=false;outer.classList.remove('dragging');};
    outer.addEventListener('mousedown',e=>{start(e.clientX);e.preventDefault();});
    window.addEventListener('mousemove',e=>{if(dragging)move(e.clientX);});
    window.addEventListener('mouseup',end);
    /* Touch: handled natively by browser scroll */
}

/* ================================================================
   13. GALLERY — Collage belt: variable card widths
   Tries Drive script → CORS proxy → default
   ================================================================ */
async function loadGalleryFromDrive() {
    const track = document.getElementById('gal-belt-track');
    if (!track) return;

    // Skeleton loading
    track.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton-box';
        track.appendChild(sk);
    }

    try {
        const res = await fetch(CONFIG.GALLERY_SCRIPT_URL);
        const images = await res.json();

        // Preload first 5 images
        images.slice(0, 5).forEach(img => {
            const preload = new Image();
            preload.src = img.url;
        });

        setTimeout(() => {
         track.innerHTML = '';
         buildGalleryBelt(images);
        }, 400);

    } catch (e) {
        console.error("Gallery failed", e);
    }
}

/* ── Collage widths pattern ── */
const COLLAGE_PATTERN=[360,240,280,200,340,260,300,220,380,240];
function getCardWidth(idx){return COLLAGE_PATTERN[idx%COLLAGE_PATTERN.length];}

function buildGalleryBelt(images){
    const wrap=document.getElementById('gal-belt-wrap');
    const outer=document.getElementById('gal-belt-outer');
    const track=document.getElementById('gal-belt-track');
    if(!track)return;

    /* Duplicate for seamless loop */
    const doubled=[...images,...images];
    galHalfWidth=images.reduce((sum,_,i)=>sum+getCardWidth(i)+6,0)+6;

    track.innerHTML=doubled.map((img,idx)=>{
        const w=getCardWidth(idx%images.length);
        /* Use object-fit:contain so full image is visible, no crop */
        return`<div class="gal-card" style="width:${w}px">
            <img src="${img.url}" alt="${img.label||'RWB Memory'}" loading="eager"
                 style="object-fit:cover;object-position:center"
                 onerror="this.parentElement.style.opacity='.15'">
        </div>`;
    }).join('');

    /* No paused overlay — just tap to open lightbox directly */

    /* Lightbox on tap/click */
    track.querySelectorAll('.gal-card').forEach(card=>{
        card.addEventListener('click',()=>{
            if(Math.abs(_galDragDelta)>5)return;
            const src=card.querySelector('img')?.src;
            if(!src||src.includes('undefined'))return;
            const lb=document.getElementById('lightbox');const img=document.getElementById('lb-img');
            if(!lb||!img)return;
            img.src=src;img.alt='RWB Memory';lb.classList.add('open');document.body.style.overflow='hidden';
        });
    });

    /* Drag/touch */
    initGalleryDrag(outer);

    startGalleryScroll();
}

function initGalleryDrag(el){
    if(!el)return;
    let startX=0,dragging=false,dragDelta=0;
    const start=(x)=>{startX=x;dragging=true;dragDelta=0;el.classList.add('dragging');};
    const move=(x)=>{
        if(!dragging)return;
        const dx=startX-x;dragDelta+=Math.abs(dx);
        galScrollX=Math.max(0,galScrollX+dx*.8);
        startX=x;_galDragDelta=dragDelta;
    };
    const end=()=>{dragging=false;el.classList.remove('dragging');setTimeout(()=>{_galDragDelta=0;},120);};
    el.addEventListener('mousedown',e=>{start(e.clientX);e.preventDefault();});
    window.addEventListener('mousemove',e=>{if(dragging)move(e.clientX);});
    window.addEventListener('mouseup',end);
    el.addEventListener('touchstart',e=>{start(e.touches[0].clientX);},{passive:true});
    el.addEventListener('touchmove',e=>{if(dragging)move(e.touches[0].clientX);},{passive:true});
    el.addEventListener('touchend',end);
}

function startGalleryScroll(){
    if(galRAF)cancelAnimationFrame(galRAF);
    (function scroll(){
        if(!galPaused){
            galScrollX+=1.4; /* faster — was 0.55 */
            if(galHalfWidth>0&&galScrollX>=galHalfWidth)galScrollX-=galHalfWidth;
            const track=document.getElementById('gal-belt-track');
            if(track)track.style.transform=`translateX(-${galScrollX}px)`;
        }
        galRAF=requestAnimationFrame(scroll);
    })();
}

/* ================================================================
   14. EVENTS — IST local date + date range display
   Sheet columns: EventDate | Month | Day | EndDay(optional) | Title | Time | Location | Description | Tag | TotalSlots | FilledSlots
   Day can be "11" or "11-17" — displayed as-is
   EndDay: optional end date for multi-day events (e.g. "17")
   ================================================================ */
function loadEventsFromSheet(){
    if(!CONFIG.EVENTS_SHEET_URL)return;
    const load=(url)=>fetch(url).then(r=>{if(!r.ok)throw new Error();return r.text();});
    load(CONFIG.EVENTS_SHEET_URL)
        .then(csv=>parseAndRenderEvents(csv))
        .catch(()=>load(CONFIG.CORS_PROXY+encodeURIComponent(CONFIG.EVENTS_SHEET_URL))
            .then(csv=>parseAndRenderEvents(csv))
            .catch(()=>{
                const el=document.getElementById('events-list');
                if(el)el.innerHTML='<p style="text-align:center;color:var(--text-muted);font-family:\'Cormorant Garamond\',serif;padding:2rem;font-style:italic;">Check back soon for events!</p>';
            })
        );
}

function parseLocalDate(str){
    if(!str)return null;
    /* Handle "2025-04-12" → local midnight */
    const p=str.split('-');
    if(p.length!==3)return null;
    const d=new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
    return isNaN(d)?null:d;
}
function getLocalToday(){const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}

function parseCSV(csv){
    const lines=csv.split('\n').map(l=>l.trim()).filter(l=>l);
    if(lines.length<2)return[];
    const headers=splitCSVRow(lines[0]).map(h=>h.trim().toLowerCase());
    return lines.slice(1).map(line=>{
        const vals=splitCSVRow(line);const row={};
        headers.forEach((h,i)=>{row[h]=(vals[i]||'').trim();});return row;
    }).filter(r=>r.title);
}
function splitCSVRow(row){
    const result=[];let cur='',inQ=false;
    for(let i=0;i<row.length;i++){
        const ch=row[i];
        if(ch==='"'){if(inQ&&row[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;}}
        else if(ch===','&&!inQ){result.push(cur);cur='';}
        else cur+=ch;
    }
    result.push(cur);return result;
}

function parseAndRenderEvents(csv){
    const rows=parseCSV(csv);if(!rows.length)return;
    const container=document.getElementById('events-list');if(!container)return;
    const today=getLocalToday();

    container.innerHTML=rows.map((row,idx)=>{
        const evDate=row['eventdate']||row['event_date']||row['date']||'';
        const endDate=row['enddate']||row['end_date']||''; /* optional end date */
        const month=(row['month']||'').toUpperCase();
        /* Day can be "11" or "11-17" from sheet */
        const day=row['day']||'';
        const endDay=row['endday']||row['end_day']||'';
        /* Build display day: if endDay exists and different, show "11-17" */
        const displayDay=endDay&&endDay!==day?`${day}-${endDay}`:day;

        const title=row['title']||'';if(!title)return'';
        const time=row['time']||'';const loc=row['location']||'';
        const desc=row['description']||row['desc']||'';const tag=row['tag']||'';
        const total=row['totalslots']||row['total_slots']||row['total']||'0';
        const filled=row['filledslots']||row['filled_slots']||row['filled']||'0';

        /* Classify using local date */
        let evClass='';
        const evDateObj=parseLocalDate(evDate);
        /* For multi-day: use end date for expiry if available */
        const endDateObj=endDate?parseLocalDate(endDate):evDateObj;
        if(evDateObj){
            if(endDateObj&&endDateObj<today)evClass='ev-past';
            else if(evDateObj>today)evClass='';
            else evClass='ev-live'; /* starts today */
        }

        return`<article class="event-card ${evClass} reveal-up" data-delay="${idx*.1}"
            data-event-date="${evDate}" data-total="${total}" data-filled="${filled}">
            <div class="event-date">
                <span class="ev-month">${month}</span>
                ${displayDay.includes('-') ? `
                    <div class="date-block">
                     <span class="start">${displayDay.split('-')[0]}</span>
                     <span class="arrow">↓</span>
                     <span class="end">${displayDay.split('-')[1]}</span>
                    </div>
                ` : `<span class="ev-day">${displayDay}</span>`}
            </div>
            <div class="event-info">
                <h3 class="ev-title">${title}</h3>
                <p class="ev-meta">🕔 ${time}&nbsp;·&nbsp;${loc}</p>
                <p class="ev-desc">${desc}</p>
                <div class="ev-slot-wrap"></div>
            </div>
            <div class="ev-tag">${tag}</div>
        </article>`;
    }).join('');

    processEventCards(container.querySelectorAll('.event-card'));

    /* Default: upcoming */
    document.querySelectorAll('.etab').forEach(t=>t.classList.remove('active'));
    const upTab=document.querySelector('.etab[data-filter="upcoming"]');
    if(upTab)upTab.classList.add('active');
    applyEventFilter('upcoming');

    initEventsTabs();
    initReveal();
    initEventsTilt();
}

function applyEventFilter(f){
    document.querySelectorAll('.event-card').forEach(card=>{
        const past=card.classList.contains('ev-past');
        const live=card.classList.contains('ev-live');
        let show=true;
        if(f==='upcoming')show=!past&&!live;
        else if(f==='live')show=live;
        else if(f==='past')show=past;
        card.style.display=show?'':'none';
    });
    /* If no upcoming events, show all to avoid blank screen */
    const visible=[...document.querySelectorAll('.event-card')].filter(c=>c.style.display!=='none');
    if(visible.length===0&&f==='upcoming'){
        document.querySelectorAll('.event-card').forEach(c=>c.style.display='');
        const allTab=document.querySelector('.etab[data-filter="all"]');
        if(allTab){document.querySelectorAll('.etab').forEach(t=>t.classList.remove('active'));allTab.classList.add('active');}
    }
}

function processEventCards(cards){
    cards.forEach(card=>{
        const total=parseInt(card.dataset.total||'0',10);
        const filled=parseInt(card.dataset.filled||'0',10);
        const sw=card.querySelector('.ev-slot-wrap');if(!sw||total===0)return;
        const pct=Math.min(filled/total,1);
        const cls=pct>=1?'red':pct>=.6?'yellow':'green';
        const lbl=pct>=1?'Slots Full':pct>=.6?'Filling Fast':'Available';
        sw.innerHTML=`<div class="ev-slot-bar-wrap"><div class="ev-slot-label">${filled} / ${total} Slots</div><div class="ev-slot-bar"><div class="ev-slot-fill ${cls}" style="width:0%" data-pct="${Math.round(pct*100)}"></div></div></div><div class="ev-status"><span class="status-dot ${cls}"></span><span>${lbl}</span></div>`;
        setTimeout(()=>{const f=sw.querySelector('.ev-slot-fill');if(f)f.style.width=f.dataset.pct+'%';},500);
        if(pct<1){const b=document.createElement('div');b.className='ev-join-banner';const t='◆ Want to join? Contact RWB for more details! &nbsp;&nbsp;';b.innerHTML=`<div class="ev-join-track">${t.repeat(6)}</div>`;card.appendChild(b);}
    });
}
function initEventsTabs(){
    document.querySelectorAll('.etab').forEach(tab=>{
        tab.addEventListener('click',()=>{
            document.querySelectorAll('.etab').forEach(t=>t.classList.remove('active'));
            tab.classList.add('active');applyEventFilter(tab.dataset.filter);
        });
    });
}
function initEventsTilt(){
    if(isMobile())return;
    document.querySelectorAll('.event-card').forEach(card=>{
        card.addEventListener('mousemove',e=>{
            if(card.classList.contains('ev-past'))return;
            const r=card.getBoundingClientRect();
            card.style.transform=`translateX(6px) perspective(700px) rotateX(${-((e.clientY-r.top)/r.height-.5)*2.5}deg) rotateY(${((e.clientX-r.left)/r.width-.5)*2.5}deg)`;
        });
        card.addEventListener('mouseleave',()=>{card.style.transform='';});
    });
}

/* 15. ABOUT LOGO REV */
function initAboutLogoRev(){
    const logo=document.getElementById('about-logo-rev');const hint=document.getElementById('logo-rev-hint');
    if(!logo)return;
    logo.addEventListener('click',()=>{
        try{_audioUnlocked=true;playRoninRev(getAudioCtx());hint?.classList.add('revving');setTimeout(()=>hint?.classList.remove('revving'),3000);}
        catch(e){console.warn('Audio:',e);}
    });
}
function playRoninRev(ctx){
    const now=ctx.currentTime;const dur=3.2;
    const master=ctx.createGain();master.connect(ctx.destination);
    master.gain.setValueAtTime(0,now);master.gain.linearRampToValueAtTime(.52,now+.1);
    master.gain.setValueAtTime(.52,now+1.5);master.gain.exponentialRampToValueAtTime(.001,now+dur);
    const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.Q.value=2.8;
    lp.frequency.setValueAtTime(260,now);lp.frequency.linearRampToValueAtTime(850,now+.9);lp.frequency.exponentialRampToValueAtTime(240,now+2.6);
    lp.connect(master);
    const ws=ctx.createWaveShaper();const curve=new Float32Array(512);
    for(let i=0;i<512;i++){const x=(i*2)/512-1;curve[i]=Math.tanh(x*3)/Math.tanh(3);}
    ws.curve=curve;ws.connect(lp);
    const osc=ctx.createOscillator();const og=ctx.createGain();
    osc.type='sawtooth';osc.frequency.setValueAtTime(11,now);osc.frequency.exponentialRampToValueAtTime(48,now+.8);osc.frequency.exponentialRampToValueAtTime(14,now+2.4);
    og.gain.value=.72;osc.connect(og);og.connect(ws);osc.start(now);osc.stop(now+dur+.1);
    const sub=ctx.createOscillator();const sg=ctx.createGain();
    sub.type='sine';sub.frequency.setValueAtTime(11,now);sub.frequency.exponentialRampToValueAtTime(48,now+.8);sub.frequency.exponentialRampToValueAtTime(14,now+2.4);
    sg.gain.setValueAtTime(.58,now);sg.gain.exponentialRampToValueAtTime(.001,now+dur);
    sub.connect(sg);sg.connect(master);sub.start(now);sub.stop(now+dur+.1);
    const lfo=ctx.createOscillator();const lfog=ctx.createGain();
    lfo.type='sine';lfo.frequency.setValueAtTime(11,now);lfo.frequency.exponentialRampToValueAtTime(48,now+.8);lfo.frequency.exponentialRampToValueAtTime(14,now+2.4);
    lfog.gain.value=.22;lfo.connect(lfog);lfog.connect(master.gain);lfo.start(now);lfo.stop(now+dur+.1);
    const mid=ctx.createOscillator();const mg=ctx.createGain();
    mid.type='square';mid.frequency.setValueAtTime(22,now);mid.frequency.exponentialRampToValueAtTime(96,now+.8);mid.frequency.exponentialRampToValueAtTime(28,now+2.4);
    mg.gain.value=.17;mid.connect(mg);mg.connect(ws);mid.start(now);mid.stop(now+dur+.1);
}

/* 16. FORM */
function initFormLogic(){
    const form=document.getElementById('contact-form');if(!form)return;
    form.addEventListener('submit',async e=>{
        e.preventDefault();
        const btn=document.getElementById('submit-btn'),txt=document.getElementById('submit-text'),arr=document.getElementById('submit-arrow');
        btn.disabled=true;txt.textContent='Sending…';arr.textContent='⏳';
        const follows=[...form.querySelectorAll('input[name="follows"]:checked')].map(cb=>cb.value).join(', ')||'None selected';
        const data={
            name:form.querySelector('#name')?.value||'',email:form.querySelector('#email')?.value||'',
            phone:form.querySelector('#phone')?.value||'',alt_phone:form.querySelector('#alt-phone')?.value||'',
            dob:form.querySelector('#dob')?.value||'',blood_group:form.querySelector('#blood')?.value||'',
            vrn:form.querySelector('#vrn')?.value||'',bike:form.querySelector('#bike')?.value||'',
            riding_experience:form.querySelector('#riding-exp')?.value||'',
            current_locality:form.querySelector('#locality')?.value||'',
            permanent_locality:form.querySelector('#permanent')?.value||'',
            emergency_contact:form.querySelector('#emergency')?.value||'',
            sticker_received:form.querySelector('#sticker-received')?.value||'',
            sticker_on_bike:form.querySelector('#sticker-stuck')?.value||'',
            follows,message:form.querySelector('#message')?.value||''
        };
        try{
            await fetch(CONFIG.FORM_SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
            btn.disabled=false;txt.textContent='✓ Application Sent!';arr.textContent='';
            btn.style.cssText='background:#22c55e;border-color:#22c55e;color:#fff;';
            showFormStatus('success','✓ Received! We\'ll reach out on WhatsApp within 48 hours. Ride Safe. ◆');
            form.reset();
            setTimeout(()=>{txt.textContent='Send My Application';arr.textContent='→';btn.style.cssText='';hideFormStatus();},7000);
        }catch(err){
            btn.disabled=false;txt.textContent='Error — Try Again';arr.textContent='→';
            showFormStatus('error','✗ Something went wrong. Please try again.');
            setTimeout(()=>{txt.textContent='Send My Application';hideFormStatus();},4000);
        }
    });
}
function showFormStatus(type,msg){const el=document.getElementById('form-status');if(!el)return;el.textContent=msg;el.className='form-status form-status--'+type;el.style.display='block';}
function hideFormStatus(){const el=document.getElementById('form-status');if(el)el.style.display='none';}

/* ================================================================
   17. BACKGROUND MUSIC — Fast energetic biker cinematic track
   ================================================================ */
let _musicOn=true; /* Default ON — autoplay on first interaction */
let _musicCtx=null;
let _musicMaster=null;
let _musicOscs=[];
let _musicNoise=null;
let _musicScheduler=null;
let _musicStarted=false;

function initLaunchMusic(){
    // Disabled completely — no background music
    return;
}

function updateMusicBtn(){
    const btn=document.getElementById('music-toggle');
    if(!btn)return;
    btn.setAttribute('aria-label',_musicOn?'Music On':'Music Off');
    btn.classList.toggle('music-on',_musicOn);
    btn.title=_musicOn?'Music: ON (click to turn off)':'Music: OFF (click to turn on)';
}

/* ══════════════════════════════════════════════════════════════════
   ENERGETIC BIKER MUSIC ENGINE
   Vibe: Fast-paced cinematic action — 130 BPM
   • Driving 4-on-the-floor kick pattern
   • Aggressive distorted power chords (E minor)
   • Propulsive synth bass
   • High energy lead stabs
   • Crash/cymbal on bar accents
   ══════════════════════════════════════════════════════════════════ */

const BPM=130;
const B=60/BPM;   /* beat duration */
const BAR16=B*4;  /* 4 beats = 1 bar */
const LOOP_BARS=8;
const LOOP_LEN=BAR16*LOOP_BARS;

/* E minor power chord frequencies */
const E2=82.41,B2=123.47,E3=164.81,G3=196.00,B3=246.94,E4=329.63,G4=392.00,D4=293.66,A3=220.00,A2=110.00,B1=61.74;

function makeWaveShaper(ctx,k){
    const n=512,c=new Float32Array(n);
    for(let i=0;i<n;i++){const x=i*2/n-1;c[i]=((Math.PI+k)*x)/(Math.PI+k*Math.abs(x));}
    const ws=ctx.createWaveShaper();ws.curve=c;ws.oversample='4x';return ws;
}
function makeBiquad(ctx,type,freq,Q){
    const f=ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;if(Q)f.Q.value=Q;return f;
}

function trigNote(ctx,dest,freq,t,dur,gain,type='sawtooth',detune=0){
    const o=ctx.createOscillator();
    const e=ctx.createGain();
    o.type=type;o.frequency.value=freq;o.detune.value=detune;
    e.gain.setValueAtTime(0,t);
    e.gain.linearRampToValueAtTime(gain,t+0.008);
    e.gain.setValueAtTime(gain,t+dur*0.7);
    e.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(e);e.connect(dest);
    o.start(t);o.stop(t+dur+0.02);
}

function trigKick(ctx,dest,t){
    /* Punchy kick */
    const o=ctx.createOscillator();const e=ctx.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(160,t);
    o.frequency.exponentialRampToValueAtTime(40,t+0.08);
    e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(1,t+0.004);
    e.gain.exponentialRampToValueAtTime(0.001,t+0.22);
    const dist=makeWaveShaper(ctx,200);const lp=makeBiquad(ctx,'lowpass',120);
    o.connect(e);e.connect(dist);dist.connect(lp);lp.connect(dest);
    o.start(t);o.stop(t+0.25);
    /* Sub click layer */
    const o2=ctx.createOscillator();const e2=ctx.createGain();
    o2.type='sine';o2.frequency.setValueAtTime(60,t);
    e2.gain.setValueAtTime(0.6,t);e2.gain.exponentialRampToValueAtTime(0.001,t+0.1);
    o2.connect(e2);e2.connect(dest);o2.start(t);o2.stop(t+0.12);
}

function trigSnare(ctx,dest,t){
    /* Snare: noise burst + tone */
    const bufSize=Math.floor(ctx.sampleRate*0.18);
    const buf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<bufSize;i++)d[i]=(Math.random()*2-1);
    const ns=ctx.createBufferSource();ns.buffer=buf;
    const e=ctx.createGain();const hp=makeBiquad(ctx,'highpass',1200);
    e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(0.35,t+0.003);
    e.gain.exponentialRampToValueAtTime(0.001,t+0.18);
    ns.connect(e);e.connect(hp);hp.connect(dest);ns.start(t);
    /* Tone layer */
    const o=ctx.createOscillator();const e2=ctx.createGain();
    o.type='triangle';o.frequency.value=220;
    e2.gain.setValueAtTime(0.18,t);e2.gain.exponentialRampToValueAtTime(0.001,t+0.12);
    o.connect(e2);e2.connect(dest);o.start(t);o.stop(t+0.14);
}

function trigHihat(ctx,dest,t,gain=0.06,open=false){
    const bufSize=Math.floor(ctx.sampleRate*(open?0.18:0.04));
    const buf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<bufSize;i++)d[i]=(Math.random()*2-1);
    const ns=ctx.createBufferSource();ns.buffer=buf;
    const e=ctx.createGain();const hp=makeBiquad(ctx,'highpass',8000);
    e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(gain,t+0.002);
    e.gain.exponentialRampToValueAtTime(0.001,t+(open?0.18:0.04));
    ns.connect(e);e.connect(hp);hp.connect(dest);ns.start(t);
}

function trigCrash(ctx,dest,t){
    const bufSize=Math.floor(ctx.sampleRate*0.9);
    const buf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<bufSize;i++)d[i]=(Math.random()*2-1);
    const ns=ctx.createBufferSource();ns.buffer=buf;
    const e=ctx.createGain();const hp=makeBiquad(ctx,'highpass',5000);
    e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(0.12,t+0.002);
    e.gain.exponentialRampToValueAtTime(0.001,t+0.9);
    ns.connect(e);e.connect(hp);hp.connect(dest);ns.start(t);
}

function scheduleLoop(ctx,masterGain,loopStart){
    /* ── DRUMS ── */
    for(let bar=0;bar<LOOP_BARS;bar++){
        const bs=loopStart+bar*BAR16;
        for(let beat=0;beat<4;beat++){
            const bt=bs+beat*B;
            /* 4-on-floor kick */
            trigKick(ctx,masterGain,bt);
            /* Snare on 2 & 4 */
            if(beat===1||beat===3)trigSnare(ctx,masterGain,bt);
            /* 8th note hihat */
            trigHihat(ctx,masterGain,bt,0.055);
            trigHihat(ctx,masterGain,bt+B*0.5,0.04);
            /* Offbeat open hihat */
            if(beat===0||beat===2)trigHihat(ctx,masterGain,bt+B*0.75,0.03,true);
        }
        /* Crash on bar 1 and bar 5 */
        if(bar===0||bar===4)trigCrash(ctx,masterGain,bs);
        /* Extra kick ghost on + of 2 */
        trigKick(ctx,masterGain,bs+B*1.5);
        /* 16th note rush fill on bar 7 beat 3-4 */
        if(bar===7){
            for(let s=0;s<8;s++)trigHihat(ctx,masterGain,bs+B*2+s*B*0.25,0.05+s*0.003);
        }
    }

    /* ── BASS (distorted, driving) ── */
    const bassLine=[
        [E2,0,0.9],[E2,1,0.45],[A2,1.5,0.45],[B2,2,0.45],[E2,2.5,0.45],[E2,3,0.45],[D4/8,3.5,0.45],
        [E2,4,0.9],[E2,5,0.45],[A2,5.5,0.45],[G3/2,6,0.9],[B2,7,0.45],[A2,7.5,0.45],
        [E2,8,0.9],[E2,9,0.45],[B2,9.5,0.45],[E2,10,0.45],[A2,10.5,0.45],[E2,11,0.9],[E2,11.5,0.45],
        [E2,12,0.9],[E2,13,0.45],[A2,13.5,0.45],[G3/2,14,0.9],[B1,15,0.45],[E2,15.5,0.45]
    ];
    const bassWs=makeWaveShaper(ctx,120);
    const bassLp=makeBiquad(ctx,'lowpass',300);
    const bassG=ctx.createGain();bassG.gain.value=0.6;
    bassWs.connect(bassLp);bassLp.connect(bassG);bassG.connect(masterGain);
    bassLine.forEach(([freq,beat,dur])=>{
        const t=loopStart+beat*B;
        const o=ctx.createOscillator();const e=ctx.createGain();
        o.type='sawtooth';o.frequency.value=freq;
        e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(0.8,t+0.01);
        e.gain.setValueAtTime(0.8,t+dur*B*0.75);e.gain.exponentialRampToValueAtTime(0.001,t+dur*B);
        o.connect(e);e.connect(bassWs);o.start(t);o.stop(t+dur*B+0.02);
    });

    /* ── POWER CHORDS (distorted guitar-like) ── */
    const chordWs=makeWaveShaper(ctx,180);
    const chordLp=makeBiquad(ctx,'lowpass',3500);
    const chordHp=makeBiquad(ctx,'highpass',180);
    const chordG=ctx.createGain();chordG.gain.value=0.28;
    chordWs.connect(chordLp);chordLp.connect(chordHp);chordHp.connect(chordG);chordG.connect(masterGain);

    const chordPattern=[
        {notes:[E3,B3],beat:0,dur:1.8},
        {notes:[E3,B3],beat:2,dur:0.4},
        {notes:[E3,B3],beat:2.5,dur:0.4},
        {notes:[A3,E4],beat:4,dur:1.8},
        {notes:[A3,E4],beat:6,dur:0.4},
        {notes:[G3,D4],beat:6.5,dur:0.4},
        {notes:[E3,B3],beat:8,dur:1.8},
        {notes:[E3,B3],beat:10,dur:0.4},
        {notes:[E3,B3],beat:10.5,dur:0.4},
        {notes:[B2,G3],beat:12,dur:1.8},
        {notes:[A2,E3],beat:14,dur:0.4},
        {notes:[B2,B3],beat:14.5,dur:1.4},
    ];
    chordPattern.forEach(({notes,beat,dur})=>{
        const t=loopStart+beat*B;
        notes.forEach((freq,i)=>{
            /* Slightly detune for thickness */
            const det=i===0?-6:6;
            const o=ctx.createOscillator();const e=ctx.createGain();
            o.type='sawtooth';o.frequency.value=freq;o.detune.value=det;
            e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(0.7,t+0.015);
            e.gain.setValueAtTime(0.7,t+dur*B*0.7);e.gain.exponentialRampToValueAtTime(0.001,t+dur*B);
            o.connect(e);e.connect(chordWs);o.start(t);o.stop(t+dur*B+0.02);
        });
    });

    /* ── LEAD STABS (bright, aggressive) ── */
    const leadG=ctx.createGain();leadG.gain.value=0.14;
    leadG.connect(masterGain);
    const leadWs=makeWaveShaper(ctx,60);
    leadWs.connect(leadG);
    const leadHp=makeBiquad(ctx,'highpass',600);
    leadHp.connect(leadWs);

    const leadLine=[
        [E4,0,0.4],[E4,0.5,0.25],[G4,0.75,0.5],
        [E4,2,0.4],[D4,2.5,0.4],[E4,3,0.8],
        [G4,4,0.4],[G4,4.5,0.25],[A3*2,4.75,0.5],
        [E4,6,0.4],[D4,6.5,0.4],[B3,7,0.8],
        [E4,8,0.4],[E4,8.5,0.25],[G4,8.75,0.5],
        [E4,10,0.4],[G4,10.5,0.4],[A3*2,11,0.8],
        [B3,12,0.5],[A3,12.5,0.5],[G3,13,0.5],[E4,13.5,0.5],
        [B3,14,0.3],[E4,14.5,0.3],[G4,15,0.95]
    ];
    leadLine.forEach(([freq,beat,dur])=>{
        const t=loopStart+beat*B;
        trigNote(ctx,leadHp,freq,t,dur*B,0.8,'square');
    });

    /* ── SCHEDULE NEXT LOOP ── */
    const nextLoopAt=loopStart+LOOP_LEN;
    const inMs=(nextLoopAt-0.3-ctx.currentTime)*1000;
    if(inMs>0&&_musicOn){
        _musicScheduler=setTimeout(()=>{if(_musicOn)scheduleLoop(ctx,masterGain,nextLoopAt);},inMs);
    }
}

function startMusicLoop(){
    try{
        stopMusicLoop();
        _musicCtx=getAudioCtx();
        const ctx=_musicCtx;const now=ctx.currentTime+0.05;

        _musicMaster=ctx.createGain();
        _musicMaster.gain.setValueAtTime(0,now);
        _musicMaster.gain.linearRampToValueAtTime(0.55,now+1.5); /* Quick fade-in */

        /* Compressor for punch */
        const comp=ctx.createDynamicsCompressor();
        comp.threshold.value=-18;comp.knee.value=8;
        comp.ratio.value=4;comp.attack.value=0.003;comp.release.value=0.15;
        _musicMaster.connect(comp);comp.connect(ctx.destination);

        scheduleLoop(ctx,_musicMaster,now);
    }catch(e){console.warn('Music:',e);}
}

function stopMusicLoop(){
    try{
        clearTimeout(_musicScheduler);_musicScheduler=null;
        if(_musicMaster&&_musicCtx){
            const now=_musicCtx.currentTime;
            _musicMaster.gain.setValueAtTime(_musicMaster.gain.value,now);
            _musicMaster.gain.linearRampToValueAtTime(0,now+1.5);
        }
        _musicOscs.forEach(o=>{try{o.stop(_musicCtx.currentTime+1.6);}catch(e){}});
        if(_musicNoise){try{_musicNoise.stop(_musicCtx.currentTime+1.6);}catch(e){}}
        _musicOscs=[];_musicNoise=null;_musicMaster=null;
    }catch(e){}
}

/* 18. LIGHTBOX */
function initLightbox(){
    const lb=document.getElementById('lightbox'),img=document.getElementById('lb-img');
    const close=()=>{lb.classList.remove('open');document.body.style.overflow='';};
    document.getElementById('lb-bg')?.addEventListener('click',close);
    document.getElementById('lb-close')?.addEventListener('click',close);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
}


