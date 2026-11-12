// RWB App: "guides-media" Supabase Edge Function. Puts Guides videos, PDFs and images on GitHub (free), not in Supabase.
//
// Why: Supabase's free plan has 1 GB of storage and a small monthly data allowance. A few riding videos watched by
// 600 members would use it up. Instead, files go into a public GitHub repository (iitbodhi/rwb-media) and phones load
// them through jsDelivr, a free CDN that serves any public GitHub file (up to 20 MB each) with no data limit.
// Each link is pinned to the exact commit, so it never changes and is cached everywhere.
//
// What it does:
//   upload  (form: op, meta, file, thumb): checks the person may post in that category, checks the file really is a
//           video / PDF / JPEG and is small enough, saves it (and its preview picture) on GitHub, adds it to guide_items.
//   delete  ({ op, id }): removes the item and its files (only the person who added it, or an admin).
//   status  ({ op }): is storage set up, how much is used, where may I post.
//
// Setup (once, by Bodhi):
//   1. GitHub → New repository → name rwb-media → Public → tick "Add a README" → Create.
//   2. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
//        name "RWB Guides", expiry 1 year (set a reminder), Repository access: Only select repositories → rwb-media,
//        Permissions → Repository permissions → Contents: Read and write. Generate, copy the token.
//   3. Supabase → Edge Functions → Secrets: add GITHUB_TOKEN = the token. (Optional: GITHUB_REPO, default iitbodhi/rwb-media.)
//   4. Supabase → Edge Functions → Deploy a new function → name guides-media → paste this file → Deploy.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
const GH_REPO = Deno.env.get("GITHUB_REPO") || "iitbodhi/rwb-media";
const GH_BRANCH = Deno.env.get("GITHUB_BRANCH") || "main";
const CDN = (sha: string, path: string) => `https://cdn.jsdelivr.net/gh/${GH_REPO}@${sha}/${path}`;

/* the same limits as the app */
const MAX = { video: 20_000_000, pdf: 10_000_000, image: 1_000_000, thumb: 300_000 };
const MAX_SECONDS = 61;
const PER_DAY = { admin: 25, coordinator: 10 };
const BUDGET = 900_000_000;   // GitHub asks for repositories under about 1 GB; stop a little before

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (error: string, status = 400) => json({ error }, status);

/* what a file really is, from its first bytes (not from its name) */
function sniff(b: Uint8Array): { kind: string; ext: string; mime: string } | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length > 12 && s(4, 4) === "ftyp") {
    const brand = s(8, 4);
    return brand === "qt  " ? { kind: "video", ext: "mov", mime: "video/quicktime" } : { kind: "video", ext: "mp4", mime: "video/mp4" };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "video", ext: "webm", mime: "video/webm" };
  if (s(0, 5) === "%PDF-") return { kind: "pdf", ext: "pdf", mime: "application/pdf" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", ext: "jpg", mime: "image/jpeg" };
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return { kind: "image", ext: "webp", mime: "image/webp" };
  return null;
}
const slug = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item";
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

/* ---------- GitHub ---------- */
async function gh(method: string, path: string, body?: unknown) {
  return await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
    method,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rwb-guides" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function putFile(path: string, bytes: Uint8Array, message: string): Promise<{ sha: string; commit: string }> {
  const content = encodeBase64(bytes);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await gh("PUT", path, { message, content, branch: GH_BRANCH });
    if (r.ok) { const d = await r.json(); return { sha: d.content.sha, commit: d.commit.sha }; }
    if (r.status === 409 || r.status === 502 || r.status === 503) { await new Promise((ok) => setTimeout(ok, 700 * (attempt + 1))); continue; }   // someone else saved at the same moment
    const t = await r.text();
    if (r.status === 401 || r.status === 403) throw new Error("GitHub refused the upload. The GITHUB_TOKEN may have expired or can't write to " + GH_REPO + ".");
    if (r.status === 404) throw new Error("GitHub can't find " + GH_REPO + ". Check the repository name and that the token can reach it.");
    throw new Error(`GitHub said ${r.status}: ${t.slice(0, 160)}`);
  }
  throw new Error("GitHub is busy. Please try again in a minute.");
}
async function deleteFile(path: string | null, sha: string | null) {
  if (!path || !sha) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await gh("DELETE", path, { message: `Remove ${path}`, sha, branch: GH_BRANCH });
    if (r.ok || r.status === 404 || r.status === 422) return;
    if (r.status === 409) { await new Promise((ok) => setTimeout(ok, 700 * (attempt + 1))); continue; }
    throw new Error(`GitHub said ${r.status} when deleting`);
  }
}

/* ---------- Request ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("POST only", 405);
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const server = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return fail("Please sign in again.", 401);
  const me = await server.from("members").select("full_name,nickname,role,status").eq("user_id", u.user.id).maybeSingle();
  if (!me.data || ["left", "removed"].includes(me.data.status)) return fail("Only RWB members can do this.", 403);
  const role = me.data.role as string;

  const isForm = (req.headers.get("content-type") || "").includes("multipart/form-data");
  let form: FormData | null = null, body: Record<string, unknown> = {};
  try { if (isForm) form = await req.formData(); else body = await req.json(); }
  catch { return fail("The upload didn't arrive in one piece. Please try again (a stronger network helps)."); }
  const op = String(form?.get("op") ?? body.op ?? "");

  if (op === "status") {
    const use = await asUser.rpc("guide_usage");
    if (use.error) return json({ ready: false, why: "Run setup file 66 (guides.sql) in Supabase. " + use.error.message });
    return json({ ready: !!GH_TOKEN, why: GH_TOKEN ? "" : "Add the GITHUB_TOKEN secret in Supabase → Edge Functions → Secrets.", repo: GH_REPO, ...use.data, budget: BUDGET });
  }

  if (!GH_TOKEN) return fail("Guides uploads aren't switched on yet: the GITHUB_TOKEN secret is missing in Supabase.", 503);

  /* ---------- delete ---------- */
  if (op === "delete") {
    const id = Number(body.id);
    const ok = await asUser.rpc("guide_can_manage", { p_id: id });
    if (ok.error) return fail(ok.error.message);
    if (!ok.data) return fail("You can't delete this item.", 403);
    const row = await server.from("guide_items").select("*").eq("id", id).single();
    if (row.error) return fail("That item is already gone.", 404);
    try {
      await deleteFile(row.data.path, row.data.file_sha);
      await deleteFile(row.data.thumb_path, row.data.thumb_sha);
    } catch (e) { console.error("delete", e); /* the list entry still goes, so members never see it again */ }
    await server.from("guide_items").delete().eq("id", id);
    return json({ deleted: id });
  }

  /* ---------- upload ---------- */
  if (op !== "upload" || !form) return fail("Unknown request.");
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(String(form.get("meta") || "{}")); } catch { /* checked below */ }
  const cat = String(meta.cat || ""), kind = String(meta.kind || "");
  if (!["app", "maint", "ride"].includes(cat) || !["video", "pdf", "image"].includes(kind)) return fail("Choose a category and a type.");
  if (cat === "app" && kind !== "video") return fail("The App category only has videos.");
  const can = await asUser.rpc("guide_can", { p_cat: cat });
  if (can.error) return fail("Run setup file 66 (guides.sql) in Supabase first. " + can.error.message);
  if (!can.data) return fail(cat === "app" ? "Only the super admin can add App videos." : cat === "maint" ? "Only admins can add Maintenance guides." : "Only admins and coordinators can add Ride guides.", 403);

  const title = clean(meta.title, 80);
  if (title.length < 2) return fail("Please add a title.");
  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file arrived. Please choose it again.");
  if (file.size > MAX[kind as keyof typeof MAX]) return fail(`That file is too big (${(file.size / 1e6).toFixed(1)} MB). The limit is ${MAX[kind as keyof typeof MAX] / 1e6} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const real = sniff(bytes);
  if (!real || real.kind !== kind) return fail(kind === "video" ? "That isn't an MP4, MOV or WebM video." : kind === "pdf" ? "That isn't a real PDF file." : "That isn't a JPEG or WebP picture.");
  const secs = Number(meta.duration_s) || null;
  if (kind === "video" && (!secs || secs > MAX_SECONDS)) return fail("Videos must be 60 seconds or shorter.");

  let thumb: Uint8Array | null = null;
  const tf = form.get("thumb");
  if (tf instanceof File && tf.size) {
    if (tf.size > MAX.thumb) return fail("The preview picture is too big.");
    thumb = new Uint8Array(await tf.arrayBuffer());
    if (sniff(thumb)?.mime !== "image/jpeg") thumb = null;
  }

  const use = await asUser.rpc("guide_usage");
  if (!use.error) {
    const limit = role === "superadmin" ? Infinity : role === "admin" ? PER_DAY.admin : PER_DAY.coordinator;
    if (use.data.today >= limit) return fail(`You've added ${use.data.today} items in the last 24 hours. Please add more tomorrow.`, 429);
    if (use.data.bytes + bytes.length > BUDGET) return fail("Guides storage is full (about 900 MB). Ask Bodhi to delete old videos first.", 507);
  }

  const month = new Date().toISOString().slice(0, 7);
  const base = `${cat}/${kind}s/${month}/${slug(title)}-${crypto.randomUUID().slice(0, 8)}`;
  const who = clean(me.data.nickname || me.data.full_name, 60);
  let saved: { path: string; sha: string }[] = [];
  try {
    let thumbUrl: string | null = null, tp: string | null = null, tsha: string | null = null;
    if (thumb) {
      tp = `${base}-thumb.jpg`;
      const t = await putFile(tp, thumb, `Guides: preview for "${title}" (${who})`);
      saved.push({ path: tp, sha: t.sha }); tsha = t.sha; thumbUrl = CDN(t.commit, tp);
    }
    const path = `${base}.${real.ext}`;
    const f = await putFile(path, bytes, `Guides: ${kind} "${title}" in ${cat} (${who})`);
    saved.push({ path, sha: f.sha });
    const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
    const row = {
      cat, kind, title,
      description: clean(meta.description, 400) || null,
      tags: clean(meta.tags, 200) || null,
      url: CDN(f.commit, path), thumb_url: thumbUrl, path, thumb_path: tp, file_sha: f.sha, thumb_sha: tsha,
      bytes: bytes.length, duration_s: kind === "video" ? Math.round(secs! * 10) / 10 : null,
      width: n(meta.width), height: n(meta.height), pages: kind === "pdf" ? n(meta.pages) : null,
      user_id: u.user.id, uploader: who,
    };
    const ins = await server.from("guide_items").insert(row).select().single();
    if (ins.error) throw new Error(ins.error.message);
    saved = [];
    return json({ item: ins.data });
  } catch (e) {
    for (const s of saved) await deleteFile(s.path, s.sha).catch(() => {});   // don't leave half an upload on GitHub
    return fail(String((e as Error).message || e).slice(0, 300), 502);
  }
});
