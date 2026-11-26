// RWB App: "ask-ronin" Supabase Edge Function. The Pookie chatbot.
// How Pookie answers (v8, chat memory + character + RWB notes since pookie-12):
//  1. It looks up what RWB taught it: approved Teach Pookie answers, admin teachings, the Guides PDFs,
//     the RWB team list and the RWB gear list. This lookup is our own code: free and unlimited.
//  2. An AI (Groq first, Gemini as backup) only turns those teachings into a short, friendly reply in Pookie's voice.
//     It is told to use nothing else. If the teachings don't cover the question, Pookie says
//     "I don't know that yet…" and the question goes to Teach Pookie marked URGENT.
//  3. If every AI is down, Pookie still answers from the best matching teaching (or says it doesn't know).
//  5. Knowledge pack (pookie-15): RWB's checked notes on the RWB app (every screen), the Ronin (TVS manual) and other
//     popular bikes, general care, riding and touring. It's a static file on roninwb.in (pookie/kb.json, built from
//     pookie/src/*.md by tools/pookie/build_kb.py), downloaded and kept for 6 hours: no Supabase storage, no egress.
//  4. Chat memory (pookie-12): the phone keeps the conversation and sends the last 12 messages. Follow-ups ("and how
//     often?") and Bengali/Hindi/Banglish questions are first turned into one standalone English search line by a
//     tiny Groq call (free tier), so the right teachings are found. Nothing extra is stored in Supabase.
// The AI keys stay on the server (private.config), never on phones.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getDocumentProxy } from "npm:unpdf@^0.12.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const SITE = "https://roninwb.in";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-left",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------------- Who Pookie is ---------------- */
const PERSONA = `
You are Pookie, the AI buddy inside the RWB App of Ronin Warriors of Bengal (RWB), a TVS Ronin riding community from
West Bengal, India (founded 2023, motto: Explore. Evolve. Inspire.). You are a proper Bengali biker dada at the tea stop:
warm, witty, a little cheeky, quick with a comeback, never formal or robotic.
Your name comes from Kaustabh "Pookie" Bhattacharjee, an RWB admin famous for riding more than one lakh km. He is the real
legend; you are the AI. If asked about Pookie the rider, talk about him. If asked who made you: the RWB team.

THE ONE BIG RULE (facts)
For facts (bike, maintenance, parts, prices, routes, shops, the app, RWB and its people) answer ONLY from the RWB CHECKED NOTES,
TEACHINGS, RWB NOTES and CORE NOTES below, and from what you already said earlier in THIS chat. Checked notes are the
source for numbers and how the app works; riders' teachings add real experience (mention both when they differ). Never use outside
knowledge for facts, never guess, never invent numbers, prices, part numbers, shops, places or people.
If they don't answer a factual question, start your reply with exactly:
[[DONT_KNOW: <the question rewritten as one short, clear, general question in English, no names or personal details>]]
and write nothing else, except: if it's about safety (brakes, steering, tyres, fuel leak, smoke, overheating, a warning
light that stays on), add ONE short line after it telling them to stop if it feels unsafe and get it checked at a TVS service centre.
NO teachings needed (never DONT_KNOW these): greetings, thanks, small talk, jokes, teasing, banter, "naughty" or silly
questions, life/love/office/mood talk, riding motivation. Just be fun and human. Keep any facts inside jokes true.

THIS IS A CONVERSATION
- You remember the chat above. Follow-ups like "and how often?", "why?", "which one is better?", "aur?", "tarpor?",
  "ar ki?" refer to the earlier messages: answer them in that context, never as a brand-new question.
- If something the rider said earlier in the chat (their plan, their bike, their problem) matters, use it.
- If a follow-up is unclear, ask one short question back instead of saying you don't know.
- Questions like "can location be shared only with family?", "how do I add a bike?", "where are my documents?" are about
  the RWB APP unless the rider clearly means another app: answer from the RWB APP teachings. If a question could mean
  the RWB app OR something else and the teachings don't settle it, ask one short question back ("Do you mean in the
  RWB app?") instead of DONT_KNOW.
- When the rider names another bike (Himalayan, XSR, Jawa, KTM, Classic 350…), answer for THAT bike from its teachings,
  never with Ronin figures. Numbers like tyre pressure and oil: add "check your bike's sticker or manual" once.

MATCH THE MOOD
- Serious question → helpful, crisp answer with a light touch.
- Funny, naughty or flirty question → play along with a cheeky, witty comeback in the same spirit (adda style, double
  meanings and bike puns welcome), then steer back to riding if it fits. Keep it PG-13: no explicit sexual detail,
  no slurs, nothing hateful about religion, caste, gender, region or body. No politics (RWB's rule): dodge with a joke.
- If they roast you, roast back gently. Tease RWB folks only in a friendly way they'd laugh at, never insult anyone.
- Sad or stressed rider → kind and supportive first, jokes later.

LANGUAGE (follow the rider's LAST message, not the earlier ones)
- English message → reply in plain English. A single "dada" or "arre" is fine, but no Banglish sentences.
- Bengali script (বাংলা) → Bengali script. Hindi (देवनागरी) → Hindi.
- Banglish ("ki korbo dada") → Banglish in Roman (English) letters, NEVER Bengali script. Hinglish ("kya karu bhai") → Hinglish in Roman letters.
- Use "tumi"/"aap" style politeness by default ("tui" only if the rider uses it first). Teachings are in English: translate them naturally.

HOW YOU TALK
- Short and crisp: 1 to 4 short lines, about 60 words at most. Steps: at most 4 short bullets. No intro, no essay,
  no "I hope this helps", no "as an AI".
- Use the rider's name (from ABOUT THIS RIDER) naturally, once in a while, not in every message.
- At most one or two emoji.
- Credit tips casually: a rider's tip ("Arjun from RWB swears by…"), a guide ("the RWB chain guide says…").
- If two teachings disagree, say so in one line and give both.
- Never help with illegal mods (silencer or catalytic converter removal, loud exhausts, fancy number plates, blinding aux lights).
- You can't see members' private data except ABOUT THIS RIDER. Never make up their data. Never share anyone's phone
  number, address or private details.`;

const RWB_NOTES = `
RWB NOTES (from the RWB team)
- RWB = Ronin Warriors of Bengal: a TVS Ronin riding family from West Bengal, founded in 2023 by Sayantan "Boss" Sarkar
  with co-founder Arnab "Boro Admin" Das. Motto: Explore. Evolve. Inspire. Website roninwb.in, hashtag #roninwb.
  Riders of other bikes are welcome too. Members are called warriors. No politics in RWB.
- Joining: new riders apply in the RWB app or at roninwb.in/join and an admin approves them. Outsiders contact RWB via
  RWB's Instagram DM, never admins' phone numbers.
- The team: admins run RWB, co-ordinators help with rides, MotoMart and the app (RWB has no co-admins). The RWB TEAM
  teachings list every one of them with their nickname and bike. Bodhi is the admin behind RWB's tech (website, app, designs). Talk about them with respect and fun, using their
  nicknames, like a proud member would ("Pinky rides sweep, nobody gets left behind with him around").
- OWB: RWB's secret, invite-only WhatsApp group. Only a few chosen, old and trusted members get in, picked by the admins.
  It's where the unfiltered, no-holds-barred adda happens. You can't apply for it and you don't ask for it: keep riding,
  stay genuine, be a good warrior, and maybe one day the invite finds you. Never say who is in OWB, never share any link,
  never reveal what is said there (you don't know, and if you did you wouldn't tell 🤐). Keep it mysterious and fun.`;

const CORE_NOTES = `
CORE NOTES (checked by the RWB team)
TVS Ronin 225: 225.9 cc single cylinder, 4-valve, oil-cooled. About 20.1 bhp at 7,750 rpm, 19.93 Nm at 3,750 rpm. 5-speed,
assist and slipper clutch. Tank 14 L (reserve about 2.8 L). Claimed 42 km/l, real-world usually mid-to-high 30s.
41 mm USD fork, rear monoshock with 7-step preload. Brakes 300 mm front, 240 mm rear disc; single-channel ABS on lower
variants, dual-channel on higher ones. 17-inch tubeless tyres: front 110/70-17, rear 130/70-17; pressure 25 psi front, 28 psi rear solo (32 rear with pillion).
Kerb weight about 160 kg, seat 795 mm, ground clearance 181 mm. Manual oil: TVS TRU4 fully synthetic 10W-30, API SL, JASO MA2, 1.3 L at an oil change.
Battery 12 V 6 Ah maintenance-free. Running-in: under about 50 km/h for the first 1,000 km; first free service around
750 to 1,000 km. A warning lamp (engine MIL, ABS, ISG) that stays ON means a fault: get it checked. TVS customer care 1800-258-7111.

THE RWB APP (details are in the RWB APP teachings)
Bottom tabs: Home, Service, Mileage, Track (middle), MotoMart, Warriors, Events. Top right: calendar, ? = Guides, bell = News, photo = Me.
Track has no "family only" sharing: while you share, every RWB member on the app and your RWB FAM can see you.
Sign-in trouble: use the Google account you joined RWB with, or send the short request form for an admin to approve.`;

/** The rider's language, so "I don't know" comes back in it too: Bengali, Hindi, Banglish, Hinglish or English. */
type Lang = "en" | "bn" | "hi" | "bn-r" | "hi-r";
function langOf(t: string): Lang {
  if (/[\u0980-\u09FF]/.test(t)) return "bn";
  if (/[\u0900-\u097F]/.test(t)) return "hi";
  const s = t.toLowerCase().replace(/[^a-z ]+/g, " ");
  const n = (re: RegExp) => (s.match(re) || []).length;
  const bn = n(/\b(ki|kemon|korbo|korte|korle|kore|ache|achhe|achi|hobe|hoy|keno|kothay|kotha|bolo|bol|bhalo|amar|amake|tomar|tomake|tumi|ami|ekta|kichu|naki|dada|ekhon|jabo|lagbe|parbo|eta|ota|oi|ke|keu|naa)\b/g);
  const hi = n(/\b(kya|kaise|kaisa|kitna|kitni|mera|meri|mujhe|kab|kyun|kyu|batao|bata|hai|hain|karu|karun|karna|nahi|nahin|accha|acha|yaar|kaun|kahan|chahiye|sakta|sakte|kar|hoga)\b/g);
  return bn >= 2 && bn > hi ? "bn-r" : hi >= 2 && hi > bn ? "hi-r" : "en";
}
const DONT_KNOW = (name: string, lang: Lang = "en") => {
  const n = name ? ", " + name : "";
  return {
    en: `Hmm${n}… I don't know that yet. Wait for someone to teach that to me first. 🙏\n\nI've put your question in **Teach Pookie** as URGENT, so the warriors can teach me.`,
    bn: `হুম${n}… এটা আমি এখনও জানি না। আগে কেউ আমাকে শিখিয়ে দিক। 🙏\n\nপ্রশ্নটা **Teach Pookie**-তে URGENT করে রেখে দিলাম, warriors-রা শিখিয়ে দেবে।`,
    "bn-r": `Hmm${n}… eta ami ekhono jani na. Age keu amake shikhiye dik. 🙏\n\nTomar proshno ta **Teach Pookie**-te URGENT kore rekhe dilam, warriors ra shikhiye debe.`,
    hi: `हम्म${n}… ये मुझे अभी नहीं पता। पहले कोई मुझे सिखा दे। 🙏\n\nआपका सवाल **Teach Pookie** में URGENT डाल दिया है, warriors मुझे सिखा देंगे।`,
    "hi-r": `Hmm${n}… ye mujhe abhi nahi pata. Pehle koi mujhe sikha de. 🙏\n\nTumhara sawaal **Teach Pookie** mein URGENT daal diya hai, warriors mujhe sikha denge.`,
  }[lang];
};
const DK = /\[\[\s*DONT[\s_-]?KNOW\s*(?::\s*([\s\S]*?))?\]\]/i;

/* ---------------- Teachings: what Pookie knows ---------------- */
type K = { title: string; content: string; source: string; bike?: string; tw?: Set<string>; cw?: Set<string> };
const STOP = new Set(("the a an and or of to in on for with is are was were be my your you it this that what which how when where do does did have has " +
  "can should would will ronin bike tvs 225 any about from like just get got not but its very much more most also there their them they me we our us " +
  "i im i'm please tell know want need ki ke ka er ar ta kore koto kemon hai kya").split(" "));
const SAME: Record<string, string> = { tire: "tyre", tires: "tyres", petrol: "fuel", kms: "km", kmpl: "mileage", lubricant: "lube", oils: "oil" };
const stem = (w: string) => { w = SAME[w] || w; const s = w.replace(/(ing|ed|es|s|e)$/, ""); return s.length >= 3 ? s : w; };
const words = (s: string) => [...new Set(String(s).toLowerCase().replace(/[^a-z0-9ঀ-৿ऀ-ॿ ]+/g, " ").split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
const prep = (k: K): K => ({ ...k, tw: new Set(words(k.title)), cw: new Set(words(k.content)) });

/** Guide PDFs are long: split them into small pieces so only the matching part is used. */
function pieces(title: string, text: string): K[] {
  const out: K[] = []; let cur = "";
  for (const para of text.split(/\n\s*\n|\n(?=#|\*\*|[A-Z][A-Z ]{4,}\n)/)) {
    if (cur && cur.length + para.length > 900) { out.push(prep({ title, content: cur.trim(), source: "guide" })); cur = ""; }
    cur += para + "\n";
    while (cur.length > 1400) { out.push(prep({ title, content: cur.slice(0, 1000).trim(), source: "guide" })); cur = cur.slice(1000); }
  }
  if (cur.trim()) out.push(prep({ title, content: cur.trim(), source: "guide" }));
  return out;
}

/* website extras (team list, guide list, gear list), cached for 6 hours */
let site: { at: number; ttl: number; rows: K[] } | null = null;
let guideList: { id: string; name: string; description?: string }[] = [];
const get = (u: string, ms = 3500) => fetch(u, { signal: AbortSignal.timeout(ms), redirect: "follow" });
async function siteRows(): Promise<K[]> {
  if (site && Date.now() - site.at < site.ttl) return site.rows;
  const rows: K[] = []; let ok = false;
  try {
    const js = await (await get(`${SITE}/js/data.js?t=${Date.now()}`, 3000)).text(); ok = true;   // ?t= skips stale CDN copies
    const url = (k: string) => js.match(new RegExp(k + ":\\s*'([^']+)'"))?.[1];
    /* the RWB team from the website: one teaching per person, plus the whole list grouped by role */
    const un = (x?: string) => String(x || "").replace(/\\'/g, "'").replace(/\s+/g, " ").trim();
    const team = [...js.matchAll(/name:\s*'([^']+)',\s*nickname:\s*'([^']*)',\s*role:\s*'(\w+)',\s*roleLabel:\s*'([^']+)'(?:,\s*bike:\s*'((?:[^'\\]|\\.)*)')?(?:[^{}]*?desc:\s*'((?:[^'\\]|\\.)*)')?/g)]
      .map((m) => ({ name: un(m[1]), nick: un(m[2]), role: m[3], label: un(m[4]), bike: un(m[5]), desc: un(m[6]) }));
    if (team.length) {
      const ROLE: Record<string, string> = { admin: "Admins", coadmin: "Co-admins (coadmin)", coordinator: "Coordinators (co-ordinators)" };
      const groups = Object.keys(ROLE).map((r) => { const ppl = team.filter((t) => t.role === r);
        return ppl.length ? `${ROLE[r]}: ${ppl.map((t) => `${t.name} "${t.nick}" (${t.label})`).join(", ")}` : ""; }).filter(Boolean);
      rows.push(prep({ title: "RWB team list: who are the admins, coadmins, co-admins, coordinators, founder, who runs RWB", source: "site",
        content: `RWB TEAM. ${groups.join(". ")}. Bodhi is also the super admin of the RWB app.` }));
      for (const t of team) rows.push(prep({ title: `RWB team: ${t.nick} = ${t.name}, ${t.label} of RWB`, source: "site",
        content: `${t.name}, nickname "${t.nick}", is ${/^[aeiou]/i.test(t.label) ? "an" : "a"} ${t.label} of RWB.${t.bike ? ` Rides: ${t.bike}.` : ""}${t.desc ? ` From the RWB website: ${t.desc}` : ""}` }));
    }
    const mUrl = url("MAINTENANCE_SCRIPT_URL");
    const [guides] = await Promise.allSettled([mUrl ? get(mUrl).then((r) => r.json()) : Promise.resolve([])]);
    if (guides.status === "fulfilled" && Array.isArray(guides.value)) {
      guideList = (guides.value as { id: string; name: string }[]).filter((p) => /^[\w-]+$/.test(String(p.id)));
      if (guideList.length) rows.push(prep({ title: "RWB maintenance guides list (Home → Explore → Maintenance guides)", source: "site",
        content: guideList.slice(0, 60).map((p) => pdfTitle(p.name) + (p.description ? `: ${p.description}` : "")).join("; ") }));
    }
    /* MotoMart's new accessories and merch (setup file 65); read from the database */
    try {
      const r = await fetch(`${SB_URL}/rest/v1/rpc/public_motomart`, { method: "POST", signal: AbortSignal.timeout(3500),
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}" });
      if (r.ok) {
        const d = await r.json();
        for (const i of (d.items || []).slice(0, 150)) {
          const what = i.kind === "merch" ? "RWB merch" : "New accessory in MotoMart (picked by the RWB team)";
          rows.push(prep({ title: `${what}: ${i.name} (${i.category || "-"})`, source: "gear",
            content: `${what}: ${i.name}, category ${i.category || "-"}, ${i.soon ? "coming soon (not out yet: no price and no orders yet)" : i.price === 0 ? "free (no cost)" : "price ₹" + i.price}${i.status === "sold" ? " (sold out)" : ""}. In the app: MotoMart → ${i.kind === "merch" ? "RWB Merch" : "New"}${i.link ? ", store link " + i.link : ""}.` }));
        }
      }
    } catch (_) { /* Pookie still works without them */ }
  } catch (_) { /* Pookie still works without these */ }
  site = { at: Date.now(), ttl: ok ? 6 * 3600e3 : 600e3, rows };
  return rows;
}

let kcache: { at: number; rows: K[] } | null = null;
// deno-lint-ignore no-explicit-any
async function learnedRows(server: any): Promise<K[]> {
  if (kcache && Date.now() - kcache.at < 3 * 60e3) return kcache.rows;
  const r = await server.from("pookie_knowledge").select("title,content,source").eq("active", true).limit(3000);
  const rows: K[] = [];
  for (const k of (r.error ? [] : r.data) as K[]) {
    if (k.source === "guide") rows.push(...pieces(k.title, k.content)); else rows.push(prep(k));
  }
  kcache = { at: Date.now(), rows };
  return rows;
}

/* the knowledge pack: pookie/kb.json on roninwb.in (built from pookie/src/*.md). Kept for 6 hours; if roninwb.in can't be
   reached the last good copy stays (a first failure retries in 10 minutes). Nothing is stored in Supabase. */
let pack: { at: number; ttl: number; rows: K[] } | null = null;
async function packRows(): Promise<K[]> {
  if (pack && Date.now() - pack.at < pack.ttl) return pack.rows;
  try {
    const r = await get(`${SITE}/pookie/kb.json?t=${Math.floor(Date.now() / 36e5)}`, 4000);   // ?t= changes hourly: skips stale CDN copies
    const d = await r.json() as { rows?: { t: string; k?: string; b?: string; c: string }[] };
    const rows = (d.rows || []).filter((x) => x && x.t && x.c).map((x) => {
      const k = prep({ title: x.t, content: x.c, source: "pack", bike: x.b || "any" });
      for (const w of words(x.k || "")) k.tw!.add(w);   // extra search words count like title words
      return k;
    });
    if (!rows.length) throw new Error("empty pack");
    pack = { at: Date.now(), ttl: 6 * 3600e3, rows };
  } catch (_) {
    pack = { at: Date.now(), ttl: 600e3, rows: pack?.rows || [] };
  }
  return pack.rows;
}
/* which bike a question is about, so a Himalayan question gets Himalayan notes and not Ronin figures */
const BIKES: [string, RegExp][] = [
  ["xsr", /\bxsr\b|xsr ?155/], ["himalayan450", /himalayan ?450|new himalayan|sherpa|himalayan 452/], ["himalayan411", /himalayan ?411|old himalayan/],
  ["himalayan450", /himalayan|himu/], ["guerrilla450", /guer+il+a/], ["re350", /classic ?350|hunter ?350|\bhunter\b|meteor|bullet ?350|\bbullet\b|goan classic|\bclassic\b|royal ?enfield 350|\bre ?350/],
  ["re650", /interceptor|continental gt|\bgt ?650|super meteor|shotgun|bear ?650|\b650\b/], ["jawa", /jawa|yezdi|perak|42 ?fj|bobber/],
  ["ktm", /\bktm\b|duke|\brc ?(200|390|125)\b|390 ?adv/], ["cb350", /cb ?350|h'?ness|hness/], ["speed400", /speed ?400|scrambler ?400|400 ?x\b|speed t4|triumph/],
  ["xpulse", /xpulse|x ?pulse/], ["apache310", /(rtr|rr|apache) ?310/], ["apache160", /apache|rtr ?(160|200)/], ["bajaj", /pulsar|dominar|\bns ?200\b|n250/],
  ["r15", /\br ?15\b|\bmt ?15\b|mt-15/], ["440", /x ?440|mavrick|scram ?440|harley/]];
function bikeOf(text: string): string | null {
  const t = String(text || "").toLowerCase();
  for (const [b, re] of BIKES) if (re.test(t)) return b;
  return null;
}

/** Scores every teaching against the question by shared words. Title words count double. */
function match(rows: K[], text: string, bike: string | null = null) {
  const q = words(text);
  if (!q.length) return [];
  return rows.map((k) => {
    let sc = 0, hit = 0;
    for (const w of q) { if (k.tw!.has(w)) { sc += 2; hit++; } else if (k.cw!.has(w)) { sc += 1; hit++; } }
    /* pack notes about one bike: lift the bike the rider named; without a named bike, the Ronin (RWB's bike) comes first */
    if (k.bike && sc >= 2 && !["any", "app"].includes(k.bike)) sc = k.bike === (bike || "ronin") ? sc + 2 : sc * 0.5;
    else if (bike && bike !== "ronin" && k.source !== "pack" && /ronin/i.test(k.title)) sc *= 0.5;   // Ronin riders' tips don't answer a Himalayan question
    return { k, sc, cover: hit / q.length };
  }).filter((x) => x.sc >= (q.length === 1 ? 1 : 2)).sort((a, b) => b.sc - a.sc || b.cover - a.cover);
}
function teachingsText(found: ReturnType<typeof match>): string {
  const tips = found.filter((x) => !["guide", "pack"].includes(x.k.source)).slice(0, 6), guides = found.filter((x) => x.k.source === "guide").slice(0, 3);
  const notes = found.filter((x) => x.k.source === "pack").slice(0, 4);
  const out: string[] = [];
  if (notes.length) out.push("RWB CHECKED NOTES (from the RWB team: the RWB app, maker manuals and spec sheets; use these for facts and numbers):\n" +
    notes.map((x) => `[${x.k.bike === "app" ? "RWB APP" : x.k.bike && x.k.bike !== "any" ? x.k.bike.toUpperCase() : "GENERAL"}] ${x.k.title}\n${x.k.content.slice(0, 900)}`).join("\n\n"));
  if (tips.length) out.push("TEACHINGS FROM RWB WARRIORS AND ADMINS (riders' own experience):\n" + tips.map((x) => `- Q: ${x.k.title}\n  A: ${x.k.content.slice(0, 600)}`).join("\n"));
  if (guides.length) out.push("FROM THE RWB MAINTENANCE GUIDES:\n" + guides.map((x) => `[${x.k.title}]\n${x.k.content.slice(0, 1000)}`).join("\n\n"));
  return out.join("\n\n") || "TEACHINGS: (nothing taught about this yet)";
}
/** No AI available: answer straight from the best teaching, if it clearly fits. */
function plainAnswer(found: ReturnType<typeof match>, name: string): string | null {
  const best = found.find((x) => x.cover >= 0.6 && x.sc >= 2);
  if (!best) return null;
  const hi = name ? `${name}, ` : "";
  return best.k.source === "guide" ? `${hi}here's what the RWB guide **${best.k.title}** says:\n\n${best.k.content.slice(0, 900)}`
    : best.k.source === "pack" ? `${hi}${best.k.content.slice(0, 900)}`
    : `${hi}here's what RWB taught me about *${best.k.title}*:\n\n${best.k.content.slice(0, 900)}`;
}

/* ---------------- Gemini (backup, and the only one that can look at photos) ---------------- */
const THINKING: (Record<string, unknown> | null)[] = [{ thinkingBudget: 0 }, { thinkingLevel: "low" }, null];
let remembered: { model: string; t: number } | null = null;
async function listFlashModels(key: string): Promise<string[]> {
  try {
    const l = await get(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(key)}`, 5000);
    if (!l.ok) return [];
    return ((await l.json()).models || [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes("generateContent") && /flash/i.test(m.name) && !/image|tts|audio|live|embed|exp/i.test(m.name))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .sort((a: string, b: string) => (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || b.localeCompare(a, undefined, { numeric: true }))
      .slice(0, 6);
  } catch { return []; }
}
/** First model + setting that answers, within a total time budget. stream=true → word by word. */
async function openGemini(key: string, preferred: string[], body: Record<string, unknown>, stream: boolean, log: string[], waitMs = 25000, budgetMs = 45000): Promise<Response> {
  const until = Date.now() + budgetMs;
  const attempt = async (model: string, t: number): Promise<Response | "next-setting" | "next-model"> => {
    const gc = { ...(body.generationConfig as object) } as Record<string, unknown>;
    if (THINKING[t]) gc.thinkingConfig = THINKING[t];
    const ctrl = new AbortController(), t0 = Date.now();
    const timer = setTimeout(() => ctrl.abort(), Math.max(3000, Math.min(stream ? 12000 : waitMs, until - Date.now())));
    try {
      const r = await fetch(`${GEMINI}/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
        method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ ...body, generationConfig: gc }),
      });
      if (!stream && r.ok) await r.clone().arrayBuffer();
      clearTimeout(timer);
      if (r.ok && r.body) { remembered = { model, t }; log.push(`${model} [${JSON.stringify(THINKING[t])}] OK in ${Date.now() - t0} ms`); return r; }
      const err = (await r.text()).replace(/\s+/g, " ").slice(0, 160);
      log.push(`${model} [${JSON.stringify(THINKING[t])}] HTTP ${r.status}: ${err}`);
      // a setting the model doesn't understand shows up as a plain 400 "invalid argument": try the next setting
      if (r.status === 400 && /thinking|unknown name|invalid json payload|not supported|invalid argument/i.test(err)) return "next-setting";
      return "next-model";
    } catch (e) {
      clearTimeout(timer); log.push(`${model}: ${ctrl.signal.aborted ? "no reply in time" : String(e).slice(0, 80)}`); return "next-model";
    }
  };
  const tryAll = async (models: string[]) => {
    for (const m of models) {
      for (let t = remembered?.model === m ? remembered.t : 0; t < THINKING.length; t++) {
        if (Date.now() > until - 2000) { log.push("Gemini: out of time"); return null; }
        const r = await attempt(m, t);
        if (r instanceof Response) return r;
        if (r === "next-model") break;
      }
    }
    return null;
  };
  const first = [...new Set([remembered?.model, ...preferred].filter(Boolean) as string[])];
  let r = await tryAll(first);
  if (!r && Date.now() < until - 4000) { const more = (await listFlashModels(key)).filter((m) => !first.includes(m)); log.push("available Flash models: " + (more.join(", ") || "none found")); r = await tryAll(more); }
  if (r) return r;
  throw new Error("No Gemini model answered");
}
const partsText = (d: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }) =>
  (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");

/* ---------------- Groq (main: fast, free) ---------------- */
const GROQ = "https://api.groq.com/openai/v1";
const GROQ_DEFAULT = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
type Chat = { role: string; content: string }[];
const groqDelta = (d: { choices?: { delta?: { content?: string } }[] }) => d.choices?.[0]?.delta?.content || "";
const groqFull = (d: { choices?: { message?: { content?: string } }[] }) => d.choices?.[0]?.message?.content || "";
let groqRemembered: string | null = null;
async function groqModels(key: string): Promise<string[]> {
  try {
    const l = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    if (!l.ok) return [];
    const ids: string[] = ((await l.json()).data || []).filter((m: { active?: boolean }) => m.active !== false).map((m: { id: string }) => m.id)
      .filter((id: string) => !/guard|whisper|tts|playai|prompt|embed|compound|vision|safeguard|orpheus|allam/i.test(id));
    const rank = (id: string) => { const order = [/gpt-oss-120b/, /llama-4-maverick/, /kimi/, /qwen/, /llama-3\.3-70b/, /gpt-oss-20b/, /llama-4-scout/, /llama/, /gemma/];
      const k = order.findIndex((r) => r.test(id)); return k < 0 ? 99 : k; };
    return ids.sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  } catch { return []; }
}
async function openGroq(key: string, preferred: string[], messages: Chat, stream: boolean, log: string[], maxTokens = 900): Promise<Response> {
  const tryModel = async (model: string) => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), stream ? 12000 : 30000), t0 = Date.now();
    try {
      const r = await fetch(`${GROQ}/chat/completions`, {
        method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: maxTokens, stream, ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}) }),
      });
      if (!stream && r.ok) await r.clone().arrayBuffer();
      clearTimeout(timer);
      if (r.ok && r.body) { groqRemembered = model; log.push(`groq ${model} OK in ${Date.now() - t0} ms`); return r; }
      log.push(`groq ${model} HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, " ").slice(0, 120)}`);
      if (r.status === 401) throw new Error("Groq key not accepted");
    } catch (e) {
      clearTimeout(timer);
      if (String(e).includes("key not accepted")) throw e;
      log.push(`groq ${model}: ${ctrl.signal.aborted ? "no reply in time" : String(e).slice(0, 80)}`);
    }
    return null;
  };
  const tried = new Set<string>();
  for (const m of [groqRemembered, ...preferred, ...GROQ_DEFAULT].filter(Boolean) as string[]) {
    if (tried.has(m) || /llama-3\.(1|3)-/.test(m)) continue; tried.add(m); const r = await tryModel(m); if (r) return r;
  }
  const more = (await groqModels(key)).filter((m) => !tried.has(m));
  log.push("groq models available: " + (more.join(", ") || "none"));
  for (const m of more) { const r = await tryModel(m); if (r) return r; }
  throw new Error("No Groq model answered");
}

/** An AI event stream → plain text for the phone. Holds back the first few characters so an
 *  "I don't know" marker is swapped for Pookie's message before the rider ever sees it. */
function textStream(src: Response, pick: (d: never) => string, onEnd: (full: string) => Promise<void>, dk: (raw: string) => string | null): ReadableStream<Uint8Array> {
  let buf = "", full = "", sent = 0, gate = true;
  const out = (t: string, ctl: TransformStreamDefaultController<string>) => { if (t) { ctl.enqueue(t); sent += t.length; } };
  const release = (ctl: TransformStreamDefaultController<string>, end = false) => {
    if (!gate) return;
    const s = full.trimStart();
    if (!end && (s.length < 14 || (s.startsWith("[[") && !s.includes("]]") && s.length < 600))) return;   // keep waiting
    gate = false;
    out(dk(full) ?? full, ctl);
  };
  const handle = (line: string, ctl: TransformStreamDefaultController<string>) => {
    line = line.trim(); if (!line.startsWith("data:") || line === "data: [DONE]") return;
    try {
      const t = pick(JSON.parse(line.slice(5)) as never); if (!t) return;
      full += t;
      if (gate) release(ctl); else out(t.replace(/\[\[[^\]]*\]\]/g, ""), ctl);
    } catch { /* ignore */ }
  };
  return src.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, string>({
      transform(chunk, ctl) { buf += chunk; let i; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i), ctl); buf = buf.slice(i + 1); } },
      async flush(ctl) {
        if (buf) handle(buf, ctl);
        release(ctl, true);
        if (!sent) out("Sorry, my brain stalled for a second. Ask me again? 🙏", ctl);
        await onEnd(full);
      },
    }))
    .pipeThrough(new TextEncoderStream());
}

/* ---------------- Guides PDFs: read the text ourselves (no AI needed) ---------------- */
const pdfTitle = (n: string) => String(n).replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
function b64(bytes: Uint8Array): string { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); }
async function downloadPdf(id: string): Promise<Uint8Array> {
  let last = "";
  for (const u of [`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, `https://drive.google.com/uc?export=download&id=${id}`]) {
    try {
      const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(25000) });
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (r.ok && String.fromCharCode(...bytes.subarray(0, 4)) === "%PDF") return bytes;
      last = `HTTP ${r.status}`;
    } catch (e) { last = String(e).slice(0, 80); }
  }
  throw new Error(`couldn't download it as a PDF (${last}). Is it shared as "Anyone with the link"?`);
}
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    pages.push((tc.items as { str?: string; hasEOL?: boolean }[]).map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join(""));
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Follow-ups ("and how often?") and Bengali/Hindi questions share no words with the English teachings.
 *  One tiny Groq call (free tier, about half a second) rewrites the rider's last message as a standalone English
 *  search line using the chat so far. "CHAT" = just banter, no teachings needed. Fails quietly ("" = use the words as typed). */
// a small model with its own free-tier budget, so the main answer's per-minute token limit isn't used up
const REWRITE_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"];
async function standalone(key: string, models: string[], turns: { role: string; text: string }[], log: string[]): Promise<string> {
  const convo = turns.slice(-7).map((t) => `${t.role === "model" ? "Pookie" : "Rider"}: ${t.text.slice(0, 400)}`).join("\n");
  const messages = [{ role: "system", content:
    "You turn the rider's LAST message in a chat with Pookie (the AI of a TVS Ronin motorcycle club, RWB) into ONE short, standalone " +
    "search question in English. Use the earlier messages to fill in what words like it, that, this one, same, and?, why?, how often?, " +
    "aur?, tarpor?, ar ki? refer to. Translate Bengali, Hindi, Banglish or Hinglish into English (biker words: borsha/borshay/brishti/baarish = " +
    "rain or monsoon; gari/gaadi = bike; tel = oil or petrol; chaka/pahiya = wheel or tyre; hawa = tyre pressure; kotobar/kitni baar = how often; " +
    "dam/daam = price; kothay/kahan = where; bhalo/accha = good). Keep names, nicknames and product names. " +
    "If the last message is only a greeting, thanks, a joke, teasing, banter or chit-chat with no real question, reply exactly: CHAT. " +
    "Reply with only the question (or CHAT), nothing else." }, { role: "user", content: convo }];
  const until = Date.now() + 4500;
  for (const model of [...new Set([...models, ...REWRITE_MODELS])]) {
    if (Date.now() > until - 800) break;
    try {
      const r = await fetch(`${GROQ}/chat/completions`, { method: "POST", signal: AbortSignal.timeout(Math.min(3000, until - Date.now())),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0, ...(/gpt-oss/.test(model) ? { max_tokens: 300, reasoning_effort: "low" }
          : /qwen/.test(model) ? { max_tokens: 60, reasoning_effort: "none" } : { max_tokens: 60 }) }) });   // qwen's free tier counts output tokens per minute
      if (!r.ok) { log.push(`rewrite ${model} HTTP ${r.status}`); continue; }
      const t = groqFull(await r.json()).replace(/<think>[\s\S]*?<\/think>/g, "").trim().split("\n")[0].replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 300);
      if (t) { log.push(`search line (${model}): ${t}`); return t; }
    } catch (e) { log.push(`rewrite ${model}: ${String(e).slice(0, 60)}`); }
  }
  return "";
}

const VERSION = "pookie-15";
const list = (s: unknown, dflt: string) => String(s || dflt).split(",").map((x) => x.trim()).filter(Boolean);

/* ---------------- Request ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now(), log: string[] = [`version ${VERSION}`];
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const server = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  const input = await req.json().catch(() => ({})) as { messages?: { role: string; text: string }[]; context?: Record<string, unknown> | null; image?: string; stream?: boolean; diagnose?: boolean; op?: string; retry?: boolean };

  /* Admin → Pookie → "Run a check" */
  if (input.diagnose) {
    const adm = await asUser.rpc("is_admin");
    if (adm.error || !adm.data) return json({ log: [`version ${VERSION}`, "Your sign-in reached Pookie's server, but it couldn't confirm you are an admin: " + (adm.error?.message || "not an admin")] });
    log.push("sign-in check: OK (the server can see you)");
    const cfg = await server.rpc("chat_config");
    const c = cfg.data || {};
    log.push(cfg.error ? "settings: ERROR " + cfg.error.message : `settings: OK. Groq key ${c.groq_key ? "present" : "MISSING"}, Gemini key ${c.key ? "present" : "not added"}`);
    const [sr, lr, pr] = await Promise.all([siteRows(), learnedRows(server), packRows()]);
    log.push(`teachings: ${lr.length} pieces from Teach Pookie, admins and guides; ${sr.length} from the website (team, guides list, gear); ${pr.length} checked notes (knowledge pack)`);
    const un = await server.rpc("pookie_log_unknown", { p_question: "" });
    log.push(un.error ? "URGENT questions: NOT READY. Run setup file 61. " + un.error.message : "URGENT questions: OK");
    if (c.groq_key) {
      try { const r = await openGroq(c.groq_key, list(c.groq_models, ""), [{ role: "user", content: "Reply with just: OK" }], false, log, 200); log.push("GROQ WORKS. Test answer: " + JSON.stringify(groqFull(await r.json()))); }
      catch (e) { log.push("GROQ FAILED: " + String(e)); }
    }
    if (c.key) {
      try { const r = await openGemini(c.key, list(c.models, "gemini-flash-latest"), { contents: [{ role: "user", parts: [{ text: "Reply with just: OK" }] }], generationConfig: { temperature: 0, maxOutputTokens: 20 } }, false, log, 12000, 25000);
        log.push("GEMINI WORKS. Test answer: " + JSON.stringify(partsText(await r.json()))); }
      catch (e) { log.push("Gemini not answering right now (only needed for photos and scanned PDFs): " + String(e)); }
    }
    log.push(`total ${Date.now() - t0} ms`);
    return json({ log });
  }

  /* Admin → Pookie: read the Guides PDFs (one per call, the app repeats), or write new Teach Pookie questions */
  if (input.op === "learn-guides" || input.op === "gen-questions") {
    const adm = await asUser.rpc("is_admin");
    if (adm.error || !adm.data) return json({ error: "Admins only" }, 403);
    const c = (await server.rpc("chat_config")).data || {};
    if (input.op === "learn-guides") {
      site = null; await siteRows();
      /* PDFs added in the app's Guides (setup file 66), kept on GitHub and served by jsDelivr */
      const up = await server.from("guide_items").select("id,title,description,url").eq("kind", "pdf").in("cat", ["maint", "ride"]);
      const pdfs: { id: string; name: string; description?: string; url?: string }[] = [...guideList,
        ...((up.error ? [] : up.data) as { id: number; title: string; description: string; url: string }[]).map((g) => ({ id: "gi-" + g.id, name: g.title, description: g.description, url: g.url }))];
      if (!pdfs.length) return json({ error: "Couldn't get the list of guides from roninwb.in. Try again in a minute." }, 502);
      const have = await server.from("pookie_knowledge").select("ref,active,content").eq("source", "guide");
      if (have.error) return json({ error: "Run setup file 56 in Supabase first. " + have.error.message }, 400);
      const failed = new Set((have.data || []).filter((r: { active: boolean; content: string }) => !r.active && r.content.startsWith("FAILED")).map((r: { ref: string }) => r.ref));
      const done = new Set((have.data || []).map((r: { ref: string }) => r.ref).filter((r: string) => input.retry ? !failed.has(r) : true));
      const todo = pdfs.filter((p) => !done.has(p.id));
      const learned = pdfs.filter((p) => done.has(p.id) && !failed.has(p.id)).length;
      if (!todo.length) return json({ done: true, total: pdfs.length, learned, failed: input.retry ? 0 : failed.size });
      const p = todo[0], title = pdfTitle(p.name);
      const save = (content: string, active: boolean) => server.from("pookie_knowledge").upsert({ source: "guide", ref: p.id, title, content, active, updated_at: new Date().toISOString() }, { onConflict: "source,ref" });
      // marked first, so if the server stops part-way the next run moves on instead of getting stuck on this PDF
      await save("FAILED: reading stopped part-way (the PDF may be too big or complex). Try a smaller PDF.", false);
      try {
        const bytes = p.url ? new Uint8Array(await (await fetch(p.url, { signal: AbortSignal.timeout(25000) })).arrayBuffer()) : await downloadPdf(p.id);
        if (String.fromCharCode(...bytes.subarray(0, 4)) !== "%PDF") throw new Error("couldn't download it as a PDF");
        if (bytes.length > 18e6) throw new Error("it is bigger than 18 MB");
        let text = "";
        try { text = await pdfText(bytes); log.push(`text: ${text.length} characters`); } catch (e) { log.push("text reader: " + String(e).slice(0, 100)); }
        if (text.replace(/\s/g, "").length < 200) {   // a scanned (photo) PDF: only Gemini can read it
          if (!c.key) throw new Error("it has no text (a scanned PDF?). Add a Gemini key to read scanned PDFs, or upload a text PDF.");
          const g = await openGemini(c.key, list(c.models, "gemini-flash-latest,gemini-flash-lite-latest"), {
            contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: b64(bytes) } }, { text:
              `Copy out the useful content of this RWB maintenance guide ("${title}") as short notes: every fact, step, interval, quantity, torque, part, warning and tip. ` +
              "Only what the PDF says. If it has no readable content, reply exactly: NO TEXT" }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } }, false, log, 60000, 90000);
          text = partsText(await g.json()).trim();
          if (!text || /^NO TEXT/i.test(text)) throw new Error("no readable text in it");
        }
        await save(text.slice(0, 20000), true); kcache = null;
        return json({ learned: title, left: todo.length - 1, total: pdfs.length });
      } catch (e) {
        const why = String((e as Error).message || e).replace(/No Gemini model answered/, "it has no text and Gemini is busy right now; try again later").slice(0, 300);
        await save("FAILED: " + why, false);
        return json({ failed: title, reason: why, left: todo.length - 1, total: pdfs.length });
      }
    }
    /* gen-questions: 20 new questions for Teach Pookie */
    const have = await server.from("pookie_questions").select("question,category").limit(600);
    if (have.error) return json({ error: "Run setup file 56 in Supabase first. " + have.error.message }, 400);
    const cats = [...new Set((have.data || []).map((q: { category: string }) => q.category))];
    const ask = "You help an assistant learn from experienced TVS Ronin 225 owners in West Bengal, India. Write 20 NEW, specific, friendly questions to ask them " +
      "(maintenance, problems and fixes, parts and prices, tyres, brakes, electricals, chain, mileage, monsoon and hill riding, touring, accessories, paperwork, local workshops and routes). " +
      `Use these categories where they fit: ${cats.join(", ")}. Do not repeat or rephrase any of these existing questions:\n` +
      (have.data || []).slice(0, 300).map((q: { question: string }) => "- " + q.question).join("\n") +
      '\n\nReply with ONLY a JSON array like [{"category":"Engine & oil","question":"..."}].';
    let txt = "";
    try { if (c.groq_key) txt = groqFull(await (await openGroq(c.groq_key, list(c.groq_models, ""), [{ role: "user", content: ask }], false, log, 4000)).json()); }
    catch (e) { log.push(String(e)); }
    if (!txt && c.key) {
      try { txt = partsText(await (await openGemini(c.key, list(c.models, "gemini-flash-latest"), { contents: [{ role: "user", parts: [{ text: ask }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 4096 } }, false, log)).json()); }
      catch (e) { log.push(String(e)); }
    }
    let rows: { category: string; question: string }[] = [];
    try { rows = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1)); } catch { /* below */ }
    rows = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.question === "string" && r.question.trim().length > 15)
      .map((r) => ({ category: String(r.category || "General").slice(0, 40), question: r.question.trim().slice(0, 300), source: "ai" }));
    if (!rows.length) return json({ error: "The AI didn't return usable questions. Try again.", detail: log.slice(-4).join(" | ") }, 502);
    const ins = await server.from("pookie_questions").upsert(rows, { onConflict: "question", ignoreDuplicates: true }).select("id");
    return json({ added: ins.data?.length ?? 0 });
  }

  /* ---------------- A rider's question ---------------- */
  const [quota, cfgRes, sRows, lRows, pRows] = await Promise.all([asUser.rpc("chat_take_quota"), server.rpc("chat_config"), siteRows(), learnedRows(server), packRows()]);
  if (quota.error) return json({ error: quota.error.message }, 429);
  const refund = async () => { await asUser.rpc("chat_refund"); };

  try {
    const cfg = cfgRes.data || {};
    const { messages = [], context = null, image = null, stream = true } = input;
    const live = stream !== false;
    const turns = (Array.isArray(messages) ? messages : []).slice(-12)
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ role: m.role === "model" ? "model" : "user", text: m.text.replace(/\[\[[^\]]*\]\]/g, "").slice(0, m.role === "model" ? 700 : 1500) }));
    if (!turns.length || turns[turns.length - 1].role !== "user") { await refund(); return json({ error: "Please type a question." }, 400); }
    const hasImage = !!(image && typeof image === "string" && image.length < 1_500_000);
    const name = String((context as Record<string, unknown> | null)?.first_name || "").slice(0, 30);
    const lastQ = turns[turns.length - 1].text;
    const lang = langOf(lastQ);

    // what RWB taught Pookie that fits this question (the last question counts most)
    const asked = turns.filter((t) => t.role === "user").slice(-2).map((t) => t.text).join(" ");
    const all = [...lRows, ...sRows, ...pRows];
    const userText = turns.filter((t) => t.role === "user").map((t) => t.text).join(" ");
    let bike = bikeOf(lastQ) || bikeOf(userText) || bikeOf(String((context as Record<string, unknown> | null)?.bike || ""));
    const direct = match(all, lastQ, bike);
    // a follow-up, a Bengali/Hindi question, or a weak match → find the teachings with a standalone English search line
    const prior = turns.length > 1, weak = !direct.length || direct[0].cover < 0.5;
    const short = words(lastQ).length <= 6 || /\b(it|that|this|those|them|same|also|why|which|aur|ar|tarpor|seta|eta|oita|ota|wo|woh|ye|isko|usko|uska)\b/i.test(lastQ);
    let line = "";
    if (cfg.groq_key && !hasImage && (lang !== "en" || (prior && (weak || short)))) {
      line = await standalone(cfg.groq_key, list(cfg.rewrite_models, ""), turns, log);
      if (/^CHAT\b/i.test(line)) line = "";
    }
    if (line && !bikeOf(lastQ)) bike = bikeOf(line) || bike;
    const found = [...(line ? match(all, line, bike) : []), ...direct, ...match(all, asked, bike)].filter((x, i, a) => a.findIndex((y) => y.k === x.k) === i);

    // "I don't know" → Pookie's message, the question goes to Teach Pookie as URGENT, and the question is free
    let logged = false;
    const unknown = async (q: string) => { if (logged) return; logged = true; await server.rpc("pookie_log_unknown", { p_question: q }); await refund(); };
    const dk = (raw: string) => { const m = raw.match(DK); if (!m) return null; const rest = raw.replace(DK, "").trim(); return DONT_KNOW(name, lang) + (rest ? "\n\n" + rest : ""); };
    const onEnd = async (full: string) => { const m = full.match(DK); if (m) await unknown((m[1] || line || lastQ).trim()); else if (!full.trim()) await refund(); };

    const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
    const system = [PERSONA, `Today's date: ${today}.`, teachingsText(found), RWB_NOTES, CORE_NOTES,
      context ? "ABOUT THIS RIDER (their own app data; use only if it helps):\n" + JSON.stringify(context).slice(0, 1000) : ""].filter(Boolean).join("\n\n");

    let upstream: Response | null = null, pick: (d: never) => string = partsText as never, full: (d: never) => string = partsText as never;
    const viaGroq = async () => {
      const msgs: Chat = [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))];
      if (hasImage) msgs[msgs.length - 1].content += "\n\n(The rider attached a photo, but you can't see photos right now. Ask them to describe it.)";
      upstream = await openGroq(cfg.groq_key, list(cfg.groq_models, ""), msgs, live, log);
      pick = groqDelta as never; full = groqFull as never;
    };
    const viaGemini = async () => {
      const contents = turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] as Record<string, unknown>[] }));
      if (hasImage) contents[contents.length - 1].parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
      upstream = await openGemini(cfg.key, list(cfg.models, "gemini-flash-latest,gemini-flash-lite-latest"), {
        systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.5, maxOutputTokens: 600 } }, live, log, 20000, 20000);
      pick = partsText as never; full = partsText as never;
    };
    const order = [cfg.groq_key && viaGroq, cfg.key && viaGemini].filter(Boolean) as (() => Promise<void>)[];
    if (hasImage && cfg.key) order.reverse();   // only Gemini can look at photos
    for (const step of order) { if (upstream) break; try { await step(); } catch (e) { log.push(String(e)); } }
    console.log(log.join(" | "));

    if (!upstream) {   // every AI is down: answer straight from the teachings
      await refund();
      const plain = plainAnswer(found, name);
      if (plain) return json({ reply: plain, left: quota.data });
      await unknown(line || lastQ);
      return json({ reply: DONT_KNOW(name, lang), left: quota.data });
    }
    if (!live) {
      const raw = full(await (upstream as Response).json() as never).trim();
      if (!raw) { await refund(); return json({ error: "Pookie couldn't come up with an answer. Please ask again in a different way." }, 502); }
      await onEnd(raw);
      return json({ reply: (dk(raw) ?? raw).replace(/\[\[[^\]]*\]\]/g, "").trim(), left: quota.data });
    }
    return new Response(textStream(upstream as Response, pick, onEnd, dk), {
      headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "x-left": String(quota.data ?? "") },
    });
  } catch (e) {
    await refund();
    console.error(String(e), log.join(" | "));
    return json({ error: "Pookie couldn't answer right now. Please try again in a minute.", detail: log.slice(-8).join(" | ") }, 502);
  }
});
