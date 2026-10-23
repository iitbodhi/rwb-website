// RWB App: "ask-ronin" Supabase Edge Function. The Pookie chatbot.
// The app sends the question here; this function checks the member's daily limit,
// adds RWB knowledge, asks Google Gemini (free tier) and sends the answer back.
// The Gemini key stays on the server (private.config), never on phones.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

/* ---------------- What Pookie knows ---------------- */
const BASE_KNOWLEDGE = `
You are "Pookie" (an AI), the friendly assistant inside the RWB App of Ronin Warriors of Bengal (RWB), a riding community
from West Bengal, India, founded in 2023, built around the TVS Ronin 225 (riders of other bikes are welcome too).
Motto: Explore. Evolve. Inspire. Website: roninwb.in. 500+ members, 20+ patron service centres, 15+ service camps.

ABOUT YOUR NAME: You are named after Kaustabh Bhattacharjee, an RWB admin whose nickname is "Pookie"
(famous for riding more than one lakh kilometres). He is a real person; you are the AI. If someone asks about
"Pookie" the rider/admin, talk about him, not yourself. If asked who made you: the RWB team built the app.

HOW TO ANSWER
- Riders read you on a phone: be short and practical. Use short paragraphs or bullet steps. No long essays.
- Reply in the rider's language (English, Bengali, Hindi or Banglish), matching their style.
- Be honest. Never invent part numbers, torque values, oil quantities, prices or specs you are not sure about.
  If unsure, say so and point to the owner's manual, an authorised TVS service centre, TVS customer care
  (1800-258-7111) or the RWB coordinators.
- Safety first: for brakes, steering, wheels, tyres, fuel leaks, smoke, burning smells, overheating, or a warning
  light that stays ON (engine MIL, ABS, ISG), tell them to stop riding if unsafe and get it checked at a service centre.
- Simple DIY is fine (chain cleaning/lube, tyre pressure, washing, checking oil window, bulbs), with clear steps.
  For anything needing special tools or electrical/engine work, recommend a service centre.
- Do not help with illegal modifications (removing silencer baffles/catalytic converter, loud aftermarket exhausts that
  break the law, fancy/hidden number plates, extra-bright aux lights that dazzle others). Suggest legal alternatives.
- Ride safety: full gear (ATGATT), helmet always, ride within limits, no stunts on public roads.
- You cannot see members' private data except the short "About this rider" section below. Never make up their data.
- If asked about something unrelated to bikes, riding, travel or the app, help briefly and politely.

TVS RONIN 225 FACTS (verified)
- Engine: 225.9 cc single-cylinder, 4-valve, oil-cooled (air-oil), bore x stroke 66 x 66 mm.
- Power about 20.1 bhp (20.4 PS) at 7,750 rpm. Torque 19.93 Nm at 3,750 rpm. 5-speed gearbox, assist and slipper clutch.
- Fuel tank 14 litres (reserve about 2.8 L). Claimed mileage 42 km/l; real-world usually mid-to-high 30s km/l.
- Chassis: double-cradle split synchro stiff frame. 41 mm upside-down front fork. Rear monoshock with 7-step preload adjustment.
- Brakes: 300 mm front disc (2-piston caliper), 240 mm rear disc. ABS: single-channel on lower variants, dual-channel on higher variants.
- Wheels: 17-inch alloys, tubeless tyres. Front tyre 110/70-17. Rear tyre size differs between sources (130/70-17 is commonly listed),
  so tell riders to check the tyre sidewall or manual for the exact size.
- Kerb weight about 160 kg. Seat height 795 mm. Ground clearance 181 mm. Wheelbase 1,357 mm.
- Owner's manual oil: TVS TRU4 Fully Synthetic, SAE 10W-30, API SL, JASO MA2. (Exact oil quantity: check manual/service centre.)
- Battery: 12 V, 6 Ah, maintenance-free.
- Running-in: keep under about 50 km/h for the first 1,000 km. First free service around 750–1,000 km includes an oil change.
- Instrument cluster warning lamps: engine malfunction (MIL), ABS, ISG, side-stand, low fuel, low battery, service reminder.
  A warning lamp that stays ON means a fault: get it checked at an authorised dealer.
- Top variants have SmartXonnect Bluetooth (calls, notifications, turn-by-turn navigation via the TVS Connect app).

GENERAL MAINTENANCE GUIDANCE (typical, not official schedules)
- Chain: clean and lube about every 500–700 km, sooner after rain or dusty rides; check slack regularly.
- Tyre pressure: check cold, weekly, using the values on the sticker/manual. Under-inflation hurts mileage and handling.
- Engine oil: follow the service schedule in the manual or the service centre's advice; change sooner with heavy use.
- After rain/monsoon rides: wash, dry, lube the chain, check brakes.
- Long rides: check tyres, chain, brakes, lights, oil level, carry a puncture kit and tyre inflator.

THE RWB APP (help members find things)
- Bottom tabs: Home, Service, Mileage, Motomart, Guides. Top right: bell = News (announcements), initials = Me (profile, notifications, sign out).
- Home: greeting, today's birthdays (with "Wish on WhatsApp"), quick stats, add fuel/service buttons, latest news, fresh Motomart items.
- Service: log every service with date, km, type (free/paid/AMC/repair/self), which free or AMC service number, work done items,
  cost, next service due (km or date), notes and a photo/PDF of the bill. Tap a record to view the bill, edit or delete.
- Mileage: "+ Add fuel" after each fill-up. Method: fill to full, reset Trip A; next time fill to full again and enter litres and the
  Trip A reading; mileage = Trip A km ÷ litres. Partial top-ups: turn "Full tank" off and don't reset Trip A. Shows average, last,
  best km/l, fuel cost per km and a trend chart.
- Motomart: buy and sell used gear within RWB. "+ Sell something": photos (up to 5), product name, category, size, age, condition,
  reason, price, seller name and WhatsApp. Posts go live after admin approval (usually within 24 hours). Sellers can edit,
  mark as sold, put back on sale or delete. Buyers tap "Message seller on WhatsApp". Filter by category, available/sold, "My posts".
- Guides: Maintenance guides (PDFs from RWB coordinators) and Accessories (gear tested by RWB, with an RWB score out of 5).
- Me: edit profile, turn notifications on/off and choose birthdays / Motomart / new members, install the app.
- Notifications: Me → Turn on notifications. On iPhone the app must first be added to the Home Screen from Safari.
- Install: Android users can download the app from roninwb.in ("Download Now"). iPhone: Safari → Share → Add to Home Screen.
- Problems signing in: use the Google account used on the RWB join form; otherwise fill the short request form and an admin approves it.
- Admins (only admins see this): Admin panel for access requests, Motomart approvals, members, birthdays; News page to post announcements.
`;

/* ---------------- RWB website knowledge (cached, never slows answers down) ---------------- */
let cache: { at: number; ttl: number; text: string } | null = null;
const get = (u: string, ms = 3500) => fetch(u, { signal: AbortSignal.timeout(ms), redirect: "follow" });
async function siteKnowledge(): Promise<string> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.text;
  const out: string[] = [];
  let ok = false;
  try {
    const js = await (await get(`${SITE}/js/data.js`, 3000)).text();
    ok = true;
    const url = (k: string) => js.match(new RegExp(k + ":\\s*'([^']+)'"))?.[1];
    const team = [...js.matchAll(/name:\s*'([^']+)',\s*nickname:\s*'([^']*)',\s*role:\s*'(\w+)',\s*roleLabel:\s*'([^']+)'/g)]
      .map((m) => `${m[1]} ("${m[2]}") – ${m[4]}`);
    if (team.length) out.push("RWB TEAM (admins, co-admins, coordinators):\n" + team.join("\n"));
    const mUrl = url("MAINTENANCE_SCRIPT_URL"), aUrl = url("ACCESSORIES_SHEET_URL");
    const [guides, gear] = await Promise.allSettled([   // both at once, 3.5 s max each
      mUrl ? get(mUrl).then((r) => r.json()) : Promise.resolve([]),
      aUrl ? get(aUrl).then((r) => r.text()) : Promise.resolve(""),
    ]);
    if (guides.status === "fulfilled" && Array.isArray(guides.value) && guides.value.length) {
      out.push("RWB MAINTENANCE GUIDES available in the app (Guides → Maintenance):\n" +
        (guides.value as { name: string; description?: string }[]).slice(0, 60)
          .map((p) => "- " + String(p.name).replace(/\.pdf$/i, "").replace(/_+/g, " ") + (p.description ? `: ${p.description}` : "")).join("\n"));
    }
    if (gear.status === "fulfilled" && gear.value) {
      const rows = String(gear.value).split(/\r?\n/).slice(1).filter(Boolean).slice(0, 80);
      if (rows.length) out.push("RWB RECOMMENDED GEAR (Guides → Accessories; columns: name, category, RWB score/5, link, price):\n" + rows.join("\n"));
    }
  } catch (_) { /* the bot still works without these */ }
  // keep for 6 hours; if the website didn't answer, try again in 10 minutes
  cache = { at: Date.now(), ttl: ok ? 6 * 3600e3 : 600e3, text: out.join("\n\n") };
  return cache.text;
}

/* ---------------- Gemini: fast settings, automatic model choice, streaming ---------------- */
// Newer Flash models "think" before answering, which is slow. These ask for little or no thinking;
// if a model doesn't understand one setting, the next one is tried.
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

/** Finds the first model + setting that answers. stream=true → word-by-word answer, false → whole answer at once. */
async function openGemini(key: string, preferred: string[], body: Record<string, unknown>, stream: boolean, log: string[]): Promise<Response> {
  const attempt = async (model: string, t: number): Promise<Response | "next-setting" | "next-model"> => {
    const gc = { ...(body.generationConfig as object) } as Record<string, unknown>;
    if (THINKING[t]) gc.thinkingConfig = THINKING[t];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), stream ? 15000 : 30000);
    const t0 = Date.now();
    try {
      const r = await fetch(`${GEMINI}/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ ...body, generationConfig: gc }),
      });
      if (!stream && r.ok) await r.clone().arrayBuffer();   // whole answer must arrive before the timer
      clearTimeout(timer);
      if (r.ok && r.body) { remembered = { model, t }; log.push(`${model} [${JSON.stringify(THINKING[t])}] OK in ${Date.now() - t0} ms`); return r; }
      const err = (await r.text()).replace(/\s+/g, " ").slice(0, 200);
      log.push(`${model} [${JSON.stringify(THINKING[t])}] HTTP ${r.status}: ${err}`);
      if (r.status === 400 && /thinking|unknown name|invalid json payload|not supported/i.test(err)) return "next-setting";
      return "next-model";
    } catch (e) {
      clearTimeout(timer); log.push(`${model}: ${ctrl.signal.aborted ? "no reply in time" : String(e).slice(0, 80)}`); return "next-model";
    }
  };
  const tryAll = async (models: string[]) => {
    for (const m of models) {
      for (let t = remembered?.model === m ? remembered.t : 0; t < THINKING.length; t++) {
        const r = await attempt(m, t);
        if (r instanceof Response) return r;
        if (r === "next-model") break;
      }
    }
    return null;
  };
  const first = [...new Set([remembered?.model, ...preferred].filter(Boolean) as string[])];
  let r = await tryAll(first);
  if (!r) { const more = (await listFlashModels(key)).filter((m) => !first.includes(m)); log.push("available Flash models: " + (more.join(", ") || "none found")); r = await tryAll(more); }
  if (r) return r;
  throw new Error("No Gemini model answered");
}

const partsText = (d: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }) =>
  (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");

/* ---------------- Groq (free backup: very fast open models, used when Gemini fails) ---------------- */
const GROQ = "https://api.groq.com/openai/v1";
type Chat = { role: string; content: string }[];
const groqDelta = (d: { choices?: { delta?: { content?: string } }[] }) => d.choices?.[0]?.delta?.content || "";
const groqFull = (d: { choices?: { message?: { content?: string } }[] }) => d.choices?.[0]?.message?.content || "";
let groqRemembered: string | null = null;
/** Groq's current chat models, best first (names change over time, so we ask instead of guessing). */
async function groqModels(key: string): Promise<string[]> {
  try {
    const l = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    if (!l.ok) return [];
    const ids: string[] = ((await l.json()).data || []).filter((m: { active?: boolean }) => m.active !== false).map((m: { id: string }) => m.id)
      .filter((id: string) => !/guard|whisper|tts|playai|prompt|embed|compound|vision|safeguard|orpheus/i.test(id));
    const rank = (id: string) => { const order = [/gpt-oss-120b/, /llama-3\.3-70b/, /llama-4-maverick/, /kimi/, /qwen/, /llama-4-scout/, /gpt-oss-20b/, /llama/, /gemma/];
      const k = order.findIndex((r) => r.test(id)); return k < 0 ? 99 : k; };
    return ids.sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  } catch { return []; }
}
async function openGroq(key: string, preferred: string[], messages: Chat, stream: boolean, log: string[]): Promise<Response> {
  const tryModel = async (model: string) => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), stream ? 15000 : 30000), t0 = Date.now();
    try {
      const r = await fetch(`${GROQ}/chat/completions`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 1500, stream }),
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
  for (const m of [groqRemembered, ...preferred].filter(Boolean) as string[]) {
    if (tried.has(m)) continue; tried.add(m); const r = await tryModel(m); if (r) return r;
  }
  const more = (await groqModels(key)).filter((m) => !tried.has(m));
  log.push("groq models available: " + (more.join(", ") || "none"));
  for (const m of more) { const r = await tryModel(m); if (r) return r; }
  throw new Error("No Groq model answered");
}

/** An event stream (Gemini or Groq) → plain text, passed on piece by piece as it arrives. */
function textStream(src: Response, pick: (d: never) => string, onEmpty: () => Promise<void>): ReadableStream<Uint8Array> {
  let buf = "", sent = 0;
  const handle = (line: string, ctl: TransformStreamDefaultController<string>) => {
    line = line.trim(); if (!line.startsWith("data:") || line === "data: [DONE]") return;
    try { const t = pick(JSON.parse(line.slice(5)) as never); if (t) { ctl.enqueue(t); sent += t.length; } } catch { /* ignore */ }
  };
  return src.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, string>({
      transform(chunk, ctl) { buf += chunk; let i; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i), ctl); buf = buf.slice(i + 1); } },
      async flush(ctl) { if (buf) handle(buf, ctl); if (!sent) { await onEmpty(); ctl.enqueue("Sorry, I couldn't come up with an answer. Please ask again in a different way."); } },
    }))
    .pipeThrough(new TextEncoderStream());
}

const VERSION = "pookie-6";
const list = (s: unknown, dflt: string) => String(s || dflt).split(",").map((x) => x.trim()).filter(Boolean);

/* ---------------- Request ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now(), log: string[] = [`version ${VERSION}`];
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const server = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  const input = await req.json().catch(() => ({})) as { messages?: { role: string; text: string }[]; context?: unknown; image?: string; stream?: boolean; diagnose?: boolean };

  /* Admin → Pookie → "Run a check": test every step and report, without using anyone's quota */
  if (input.diagnose) {
    const adm = await asUser.rpc("is_admin");
    if (adm.error || !adm.data) return json({ log: [`version ${VERSION}`, "Your sign-in reached Pookie's server, but it couldn't confirm you are an admin: " + (adm.error?.message || "not an admin")] });
    log.push("sign-in check: OK (the server can see you)");
    const cfg = await server.rpc("chat_config");
    const c = cfg.data || {};
    log.push(cfg.error ? "settings: ERROR " + cfg.error.message : `settings: OK. Gemini key ${c.key ? "present" : "MISSING"}, Groq backup key ${c.groq_key ? "present" : "not added"}`);
    const k0 = Date.now(); const kn = await siteKnowledge(); log.push(`website knowledge: ${kn.length} characters in ${Date.now() - k0} ms`);
    if (c.key) {
      try {
        const r = await openGemini(c.key, list(c.models, "gemini-flash-latest"), {
          contents: [{ role: "user", parts: [{ text: "Reply with just: OK" }] }], generationConfig: { temperature: 0, maxOutputTokens: 20 } }, false, log);
        log.push("GEMINI WORKS. Test answer: " + JSON.stringify(partsText(await r.json())));
      } catch (e) { log.push("GEMINI FAILED: " + String(e)); }
    }
    if (c.groq_key) {
      try {
        const r = await openGroq(c.groq_key, list(c.groq_models, ""), [{ role: "user", content: "Reply with just: OK" }], false, log);
        log.push("GROQ WORKS. Test answer: " + JSON.stringify(groqFull(await r.json())));
      } catch (e) { log.push("GROQ FAILED: " + String(e)); }
    }
    log.push(`total ${Date.now() - t0} ms`);
    return json({ log });
  }

  const [quota, cfgRes, knowledge] = await Promise.all([asUser.rpc("chat_take_quota"), server.rpc("chat_config"), siteKnowledge()]);
  if (quota.error) return json({ error: quota.error.message }, 429);
  const refund = async () => { await asUser.rpc("chat_refund"); };

  try {
    const cfg = cfgRes.data;
    if (cfgRes.error || !(cfg?.key || cfg?.groq_key)) throw new Error("Pookie is not set up yet (no AI key).");
    const { messages = [], context = null, image = null, stream = true } = input;
    const live = stream !== false;

    const turns = (Array.isArray(messages) ? messages : []).slice(-12)
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ role: m.role === "model" ? "model" : "user", text: m.text.slice(0, 2000) }));
    if (!turns.length || turns[turns.length - 1].role !== "user") { await refund(); return json({ error: "Please type a question." }, 400); }
    const hasImage = !!(image && typeof image === "string" && image.length < 1_500_000);

    const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
    const system = [
      BASE_KNOWLEDGE, `Today's date: ${today}.`, knowledge,
      cfg.notes ? "NOTES FROM RWB ADMINS (trust these for RWB-specific info):\n" + cfg.notes : "",
      context ? "ABOUT THIS RIDER (from their own app data, use only if relevant):\n" + JSON.stringify(context).slice(0, 1500) : "",
    ].filter(Boolean).join("\n\n");

    let upstream: Response | null = null, pick: (d: never) => string = partsText as never, full: (d: never) => string = partsText as never;
    const viaGemini = async () => {
      const contents = turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] as Record<string, unknown>[] }));
      if (hasImage) contents[contents.length - 1].parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
      upstream = await openGemini(cfg.key, list(cfg.models, "gemini-flash-latest,gemini-flash-lite-latest"), {
        systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } }, live, log);
      pick = partsText as never; full = partsText as never;
    };
    const viaGroq = async () => {
      const msgs: Chat = [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))];
      if (hasImage) msgs[msgs.length - 1].content += "\n\n(The rider attached a photo, but photos can't be looked at right now. Ask them to describe what they see.)";
      upstream = await openGroq(cfg.groq_key, list(cfg.groq_models, ""), msgs, live, log);
      pick = groqDelta as never; full = groqFull as never;
    };
    const order = [cfg.groq_key && viaGroq, cfg.key && viaGemini].filter(Boolean) as (() => Promise<void>)[];
    if (hasImage && cfg.key) order.reverse();   // only Gemini can look at photos
    for (const step of order) { if (upstream) break; try { await step(); } catch (e) { log.push(String(e)); } }
    if (!upstream) throw new Error("No AI service answered");
    console.log(log.join(" | "));
    if (!live) {
      const reply = full(await upstream.json() as never).trim();
      if (!reply) { await refund(); return json({ error: "Pookie couldn't come up with an answer. Please ask again in a different way." }, 502); }
      return json({ reply, left: quota.data });
    }
    return new Response(textStream(upstream, pick, refund), {
      headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "x-left": String(quota.data ?? "") },
    });
  } catch (e) {
    await refund();
    console.error(String(e), log.join(" | "));
    return json({ error: "Pookie couldn't answer right now. Please try again in a minute.", detail: log.slice(-8).join(" | ") }, 502);
  }
});
