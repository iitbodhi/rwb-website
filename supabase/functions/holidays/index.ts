// RWB App: "holidays" Supabase Edge Function.
// The Calendar asks this for Indian holidays. It reads Google's free public "Holidays in India" calendar
// (no key or account needed), keeps it in memory for 12 hours, and sends back a short list:
//   { holidays: [{ date: "2026-10-20", name: "Dussehra", type: "public" | "observance" }, …] }
// for last year, this year and the next two. The app also has the West Bengal Government's list built in,
// so if this function is down the Calendar still shows holidays.
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor → name it exactly "holidays" → paste → Deploy.

const ICS = "https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
type Holiday = { date: string; name: string; type: "public" | "observance" };
let cache: { at: number; list: Holiday[] } | null = null;

function parse(ics: string): Holiday[] {
  const text = ics.replace(/\r?\n[ \t]/g, "");          // unfold long lines
  const y = new Date().getUTCFullYear(), out: Holiday[] = [], seen = new Set<string>();
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const get = (k: string) => (block.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, "m"))?.[1] || "").trim();
    const d = get("DTSTART").replace(/[^0-9]/g, "").slice(0, 8);
    if (d.length !== 8) continue;
    const yr = Number(d.slice(0, 4));
    if (yr < y - 1 || yr > y + 2) continue;
    const name = get("SUMMARY").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ").slice(0, 80);
    if (!name) continue;
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const key = date + name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, name, type: /observance/i.test(get("DESCRIPTION")) ? "observance" : "public" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!cache || Date.now() - cache.at > 12 * 3600e3) {
      const r = await fetch(ICS, { headers: { "User-Agent": "RWB-App/1.0 (roninwb.in)" } });
      if (!r.ok) throw new Error("Google calendar " + r.status);
      const list = parse(await r.text());
      if (list.length) cache = { at: Date.now(), list };
    }
    return new Response(JSON.stringify({ holidays: cache?.list || [] }), {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=43200" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ holidays: cache?.list || [], error: String((e as Error).message || e) }), {
      status: cache ? 200 : 502, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
