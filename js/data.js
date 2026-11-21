/* Site settings — edit URLs here */
const CONFIG = {
    JOIN_FORM_URL: 'https://roninwb.in/join/',
    /* Events come from the RWB App (create and edit them there). The sheet below is only a backup. */
    APP_SUPABASE_URL: 'https://hcowcybshljgkeixudry.supabase.co',
    APP_SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjb3djeWJzaGxqZ2tlaXh1ZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NDI2MjMsImV4cCI6MjEwODMxODYyM30.LLYjaairRQZ3-Ddwo9kschTeVXjEv84n45RrqEUhi0g',
    EVENTS_SHEET_URL: 'https://docs.google.com/spreadsheets/d/13qt3ZmYHX1EILkQzqo9TzLWKfKmuAd_QwYzStDTLEzU/export?format=csv&gid=0',
    GALLERY_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwTNLg43T131BwLCqZ1Lk12eL5lohygAa_Hmfa8FtPy7q0oZtEuQdvM3NHKXc5OPNuf/exec',
    /* RWB App: admins and coordinators add/delete gallery photos (GALLERY_SCRIPT_URL is the RWB Gallery script,
       tools/gallery.gs, deployed by Bodhi on 21 Nov 2026; the old list-only script can't save photos). */
    GALLERY_EDIT: true,
    CORS_PROXY: 'https://api.allorigins.win/raw?url=',
    INSTAGRAM_URL: 'https://www.instagram.com/ronin_warriors_bengal',
    /* Opens a direct message to RWB on Instagram (used by "Contact to order") */
    INSTAGRAM_DM_URL: 'https://ig.me/m/ronin_warriors_bengal',
    /* RWB Merch and Ronin Accessories come from MotoMart in the RWB App (setup file 65) */
    /* Ronin Maintenance guides now come from the RWB App (Guides → Maintenance → + Add). The old Drive folder is no longer used. */
    /* RWB App for Android (.apk). Leave empty until the file is in the repo; then "Download Now" downloads it */
    APK_URL: 'download/RWB-App.apk'
};

/* Team — role: admin | coordinator. Photos live in assets/warriors/ */
const WARRIORS = [
    { name: 'Sayantan Sarkar', nickname: 'Boss', role: 'admin', roleLabel: 'Founder & Admin', bike: 'TVS Ronin 225 (Orange) — Kurama  ·  TVS Ronin 225 (Black) — Shado', photo: 'assets/warriors/boss.webp', desc: 'A lawyer by profession and the one who started it all. Sayantan turned a handful of riders into the RWB family, and he still leads from the front. Objection overruled: the Boss rides first.' },
    { name: 'Arnab Das', nickname: 'Boro Admin', role: 'admin', roleLabel: 'Co-Founder & Admin', bike: 'TVS Ronin 225 (Galactic Grey) — TD', photo: 'assets/warriors/arnab.webp', desc: 'The quiet co-founder who lets the tarmac do the talking. While the group is still planning the ride, Arnab is usually at the next checkpoint already, waiting with a grin.' },
    { name: 'Kaustabh Bhattacharjee', nickname: 'Pookie', role: 'admin', roleLabel: 'Admin', bike: 'TVS Ronin 225', photo: 'assets/warriors/pookie.webp', desc: 'One lakh kilometres and still counting. If roads had a memory, they\'d remember Pookie first. Yes, the RWB app\'s AI is named after him, and no, it hasn\'t caught up on his mileage.' },
    { name: 'Debapam Pal', nickname: 'Momo', role: 'admin', roleLabel: 'Admin', bike: 'TVS Ronin 225 (Blue)', photo: 'assets/warriors/momo.webp', desc: 'IT professional on weekdays, pace-chart menace on weekends. That warm Momo smile is usually the last thing the group sees before he disappears into the horizon.' },
    { name: 'Bodhisatwa Mallick', nickname: 'Bodhi', role: 'admin', roleLabel: 'Admin', bike: 'TVS Ronin 225 (Magma Red) — Sula', photo: 'assets/warriors/bodhi.webp', desc: 'The tech brain behind RWB: the website, the app, the designs and every "can someone fix this?" message. The shortest and newest admin, who once finished a whole tour on one footpeg after the other broke. First to try new gear, so you know what fits your ride. Proof that height doesn\'t matter in riding. Skill does.' },
    { name: 'Rohan Ghosh', nickname: 'Pinky', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'Bajaj Dominar 250 (Green) — Domi', photo: 'assets/warriors/pinky.webp', desc: 'Rides sweep: last in the line, first to notice if someone\'s missing. With Pinky behind you, no Ronin Warrior ever gets left behind.' },
    { name: 'Soumya JS', nickname: 'CC', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 — 2024 Special Edition (Nimbus Grey)', photo: 'assets/warriors/soumya.webp', desc: 'Draws route maps with a cartographer\'s obsession and loses them with a philosopher\'s calm. Proudly middle-aged and happily unrepentant, because for CC the journey always beats the destination.' },
    { name: 'Arpan Paik', nickname: 'Radio', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'RE Himalayan 411 (Mirage Silver)', photo: 'assets/warriors/arpan.webp', desc: 'Permanently tuned to the frequency between throttle and horizon. Radio runs on adrenaline and broadcasts his energy to everyone riding beside him, no subscription needed.' },
    { name: 'Ranit Pal Chowdhury', nickname: 'BBC', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Lightning Black) — Kuro', photo: 'assets/warriors/ranit.webp', desc: 'Negotiates for a living, rides for the soul. Fuelled by caffeine and armed with a camera, BBC captures RWB one frame at a time, and he is firmly, loudly anti-squid.' },
    { name: 'Sreejon', nickname: 'Kochi', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Blue) — Pegasus', photo: 'assets/warriors/sreejon.webp', desc: 'The calmest rider in any pack. A 6 AM start or a 400 km grind, Kochi glides through it so smoothly that everyone around him relaxes too.' },
    { name: 'Subhankar Biswas', nickname: 'Labubu', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Lightning Black)', photo: 'assets/warriors/labubu.webp', desc: 'From wide-eyed newcomer to road-tested warrior, Labubu is what RWB is built for. He doesn\'t chase roads, he earns them, one climb at a time.' },
    { name: 'Arindam Biswas', nickname: 'Bucky', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Galactic Grey) — Jarvis', photo: 'assets/warriors/bucky.webp', desc: 'Balances ledgers on weekdays and horizons on weekends. His best investment never made it to a spreadsheet: Jarvis, his Ronin.' },
    { name: 'Moinak', nickname: 'Sek-C', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'Apache RTR 200 4V (Red Black)', photo: 'assets/warriors/moinak.webp', desc: 'Pushes code by day, pushes throttle by weekend. Sek-C lives in the sweet spot between the daily deploy and the open road.' },
    { name: 'Kaustav Sanyal', nickname: 'Offroader', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Orange) — Ronin-X', photo: 'assets/warriors/roninx.webp', desc: 'Treats tarmac as a suggestion. Where the map ends and the signal dies, Offroader and Ronin-X are just getting started.' },
    { name: 'Sourav Santara', nickname: 'KK', role: 'coordinator', roleLabel: 'Co-ordinator', bike: 'TVS Ronin 225 (Galactic Grey)', photo: 'assets/warriors/sourav.webp', desc: 'An "amateur" in name only. A certified mountain addict whose Ronin knows the hill roads better than the GPS does.' }
];
