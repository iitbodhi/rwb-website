// RWB App: "guides-slim" Supabase Edge Function (setup file 74). Used only by the Guides robot
// (.github/workflows/slim-guides.yml), which makes guide PDFs lighter and adds preview pictures.
// POST JSON { token, id, kind: "pdf" | "thumb", data: base64 }. The token is a one-time key the robot puts in
// private.slim_tokens (it can, because it has the database secret); without a fresh key nothing happens.
//   pdf:   replaces the guide's file in rwb-media with the lighter copy (must be a real PDF and smaller).
//   thumb: saves a JPEG preview picture for the guide.
// Deploy with "Verify JWT" off. Uses the same GITHUB_TOKEN secret as guides-media.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
const GH_REPO = Deno.env.get("GITHUB_REPO") || "iitbodhi/rwb-media";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function put(path: string, bytes: Uint8Array, message: string, sha?: string | null) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, { method: "PUT",
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "rwb-guides" },
      body: JSON.stringify({ message, content: encodeBase64(bytes), branch: "main", ...(sha ? { sha } : {}) }) });
    if (r.ok) { const d = await r.json(); return { sha: d.content.sha as string, commit: d.commit.sha as string }; }
    if ([409, 502, 503].includes(r.status)) { await new Promise((ok) => setTimeout(ok, 800 * (a + 1))); continue; }
    throw new Error(`github ${r.status} ${(await r.text()).slice(0, 150)}`);
  }
  throw new Error("github busy");
}
const cdn = (commit: string, path: string) => `https://cdn.jsdelivr.net/gh/${GH_REPO}@${commit}/${path}`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  let b: { token?: string; id?: number; kind?: string; data?: string };
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const ok = await db.rpc("slim_use_token", { p_token: String(b.token || "") });
  if (ok.error || ok.data !== true) return json({ error: "not allowed" }, 403);
  const row = await db.from("guide_items").select("id,kind,path,file_sha,bytes,title,thumb_path,thumb_sha").eq("id", Number(b.id)).maybeSingle();
  if (!row.data || row.data.kind !== "pdf" || !row.data.path) return json({ error: "no such guide" }, 404);
  const g = row.data;
  let bytes: Uint8Array;
  try { bytes = decodeBase64(String(b.data || "")); } catch { return json({ error: "bad file" }, 400); }
  try {
    if (b.kind === "pdf") {
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-" || !g.bytes || bytes.length >= g.bytes || bytes.length > 20_000_000) return json({ error: "not a smaller PDF" }, 400);
      const f = await put(g.path, bytes, `Guides: lighter copy of "${g.title}"`, g.file_sha);
      const up = await db.from("guide_items").update({ url: cdn(f.commit, g.path), file_sha: f.sha, bytes: bytes.length }).eq("id", g.id);
      if (up.error) throw new Error(up.error.message);
      return json({ ok: true, bytes: bytes.length });
    }
    if (b.kind === "thumb") {
      if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) || bytes.length > 300_000) return json({ error: "not a small JPEG" }, 400);
      const mine = !!g.thumb_path && g.thumb_path.endsWith("-thumb.jpg");
      const tp = mine ? g.thumb_path! : g.path.replace(/\.pdf$/i, "") + "-thumb.jpg";
      const t = await put(tp, bytes, `Guides: preview for "${g.title}"`, mine ? g.thumb_sha : null);
      const up = await db.from("guide_items").update({ thumb_url: cdn(t.commit, tp), thumb_path: tp, thumb_sha: t.sha }).eq("id", g.id);
      if (up.error) throw new Error(up.error.message);
      return json({ ok: true });
    }
    return json({ error: "kind?" }, 400);
  } catch (e) { console.error(e); return json({ error: String((e as Error).message || e).slice(0, 200) }, 502); }
});
