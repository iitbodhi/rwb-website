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

let cache: { at: number; text: string } | null = null;
async function siteKnowledge(): Promise<string> {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.text;
  const out: string[] = [];
  try {
    const js = await (await fetch(`${SITE}/js/data.js`)).text();
    const url = (k: string) => js.match(new RegExp(k + ":\\s*'([^']+)'"))?.[1];
    const team = [...js.matchAll(/name:\s*'([^']+)',\s*nickname:\s*'([^']*)',\s*role:\s*'(\w+)',\s*roleLabel:\s*'([^']+)'/g)]
      .map((m) => `${m[1]} ("${m[2]}") – ${m[4]}`);
    if (team.length) out.push("RWB TEAM (admins, co-admins, coordinators):\n" + team.join("\n"));
    const mUrl = url("MAINTENANCE_SCRIPT_URL");
    if (mUrl) {
      const posts = await (await fetch(mUrl)).json() as { name: string; description?: string }[];
      if (Array.isArray(posts) && posts.length) {
        out.push("RWB MAINTENANCE GUIDES available in the app (Guides → Maintenance):\n" +
          posts.slice(0, 60).map((p) => "- " + p.name.replace(/\.pdf$/i, "").replace(/_+/g, " ") + (p.description ? `: ${p.description}` : "")).join("\n"));
      }
    }
    const aUrl = url("ACCESSORIES_SHEET_URL");
    if (aUrl) {
      const rows = (await (await fetch(aUrl)).text()).split(/\r?\n/).slice(1).filter(Boolean).slice(0, 80);
      if (rows.length) out.push("RWB RECOMMENDED GEAR (Guides → Accessories; columns: name, category, RWB score/5, link, price):\n" + rows.join("\n"));
    }
  } catch (_) { /* the bot still works without these */ }
  cache = { at: Date.now(), text: out.join("\n\n") };
  return cache.text;
}

/* ---------------- Gemini with automatic model choice ---------------- */
let workingModel: string | null = null;
async function gemini(key: string, preferred: string[], body: unknown): Promise<string> {
  const tryModel = async (m: string) => {
    const r = await fetch(`${GEMINI}/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, status: r.status, err: (await r.text()).slice(0, 300) };
    const d = await r.json();
    const text = (d.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim();
    return text ? { ok: true, text } : { ok: false, status: 502, err: "empty answer " + (d.candidates?.[0]?.finishReason || d.promptFeedback?.blockReason || "") };
  };
  const errors: string[] = [];
  let order = [...new Set([workingModel, ...preferred].filter(Boolean) as string[])];
  for (let round = 0; round < 2; round++) {
    for (const m of order) {
      const r = await tryModel(m);
      if (r.ok) { workingModel = m; return r.text!; }
      errors.push(`${m}: ${r.status}`);
      if (r.status === 400 && !/not found|not supported|unknown name/i.test(r.err || "")) throw new Error("Gemini rejected the request: " + r.err);
    }
    if (round === 0) {   // none of the preferred names worked: ask Google which Flash models exist now
      const l = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
      if (!l.ok) break;
      const names = ((await l.json()).models || [])
        .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
          m.supportedGenerationMethods?.includes("generateContent") && /flash/i.test(m.name) && !/image|tts|audio|live|embed|thinking-exp/i.test(m.name))
        .map((m: { name: string }) => m.name.replace(/^models\//, ""))
        .sort((a: string, b: string) => (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0) || b.localeCompare(a, undefined, { numeric: true }));
      order = names.filter((n: string) => !order.includes(n)).slice(0, 4);
      if (!order.length) break;
    }
  }
  throw new Error("No Gemini model answered (" + errors.join(", ") + ")");
}

/* ---------------- Request ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: left, error: quotaErr } = await asUser.rpc("chat_take_quota");
  if (quotaErr) return json({ error: quotaErr.message }, 429);

  try {
    const { messages = [], context = null, image = null } = await req.json();
    const server = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
    const { data: cfg, error: cfgErr } = await server.rpc("chat_config");
    if (cfgErr || !cfg?.key) throw new Error("Pookie is not set up yet (Gemini key missing).");

    const history = (Array.isArray(messages) ? messages : []).slice(-12)
      .filter((m: { role: string; text: string }) => m && typeof m.text === "string" && m.text.trim())
      .map((m: { role: string; text: string }) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 2000) }] }));
    if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Please type a question." }, 400);
    if (image && typeof image === "string" && image.length < 1_500_000) {
      history[history.length - 1].parts.push({ inlineData: { mimeType: "image/jpeg", data: image } } as never);
    }

    const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
    const system = [
      BASE_KNOWLEDGE,
      `Today's date: ${today}.`,
      await siteKnowledge(),
      cfg.notes ? "NOTES FROM RWB ADMINS (trust these for RWB-specific info):\n" + cfg.notes : "",
      context ? "ABOUT THIS RIDER (from their own app data, use only if relevant):\n" + JSON.stringify(context).slice(0, 1500) : "",
    ].filter(Boolean).join("\n\n");

    const reply = await gemini(cfg.key, String(cfg.models).split(",").map((s: string) => s.trim()).filter(Boolean), {
      systemInstruction: { parts: [{ text: system }] },
      contents: history,
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    });
    return json({ reply, left });
  } catch (e) {
    await asUser.rpc("chat_refund");
    console.error(e);
    return json({ error: "Pookie couldn't answer right now. Please try again in a minute.", detail: String(e).slice(0, 300) }, 502);
  }
});
