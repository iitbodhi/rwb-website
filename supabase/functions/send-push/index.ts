// RWB App: "send-push" Supabase Edge Function.
// The database calls this whenever a notification is created (new Motomart post, birthday, announcement, SOS…).
// It fetches the message and the phones to send it to, then sends:
//   • web push to browsers / iPhones (keys live in the database, private.config)
//   • Firebase (FCM) to phones using the RWB Android app (needs the FCM_SERVICE_ACCOUNT secret, see the setup guide)
// SOS alerts are sent as urgent; on the Android app they use the "SOS alerts" channel with the siren.
// Talk (voice messages on Track, setup file 50): { talk: id } sends the message to each receiver's phones; the RWB Android
// app plays it out loud by itself (even with the screen off) when the receiver shares their live location, or is FAM.
// { talk_cleanup: true } (every hour) deletes Talk recordings older than 7 days.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

/* ---------- Firebase: a short-lived access token from the service account ---------- */
let fcmAuth: { token: string; exp: number; project: string } | null = null;
async function fcmToken() {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  if (fcmAuth && fcmAuth.exp > Date.now() + 60_000) return fcmAuth;
  const sa = JSON.parse(raw);
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt().setExpirationTime("1h").sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Firebase sign-in failed: " + JSON.stringify(j));
  fcmAuth = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, project: sa.project_id };
  return fcmAuth;
}

type Payload = { title: string; body: string; url: string; tag: string; sos?: boolean };
async function sendFcm(tokens: string[], p: Payload, urgent: boolean) {
  const auth = await fcmToken();
  if (!auth || !tokens.length) return { sent: 0, gone: [] as string[] };
  const gone: string[] = [];
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 50) {
    await Promise.all(tokens.slice(i, i + 50).map(async (token) => {
      const message = {
        token,
        notification: { title: p.title, body: p.body || "" },
        data: { url: p.url || "#home", title: p.title, body: p.body || "", sos: p.sos ? "1" : "0" },
        android: {
          priority: "HIGH",
          ttl: urgent ? "3600s" : "86400s",
          notification: {
            channel_id: p.sos ? "sos" : "rwb",
            tag: p.sos ? "rwb-sos" : p.tag,
            ...(p.sos ? { notification_priority: "PRIORITY_MAX", visibility: "PUBLIC", default_vibrate_timings: true } : {}),
          },
        },
      };
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
        method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (r.ok) { sent++; return; }
      const e = await r.text();
      if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(e)) gone.push(token);   // app removed
    }));
  }
  return { sent, gone };
}

/* ---------- Talk: one voice message to its receivers ---------- */
type TalkJob = { id: number; url: string; secs: number; at: string; from: string; to: string; subject: string; vapid_public: string; vapid_private: string;
  recipients: { aloud: boolean; fcm: string[]; subs: { endpoint: string; keys: { p256dh: string; auth: string } }[] }[] };
async function sendTalk(secret: string, id: number) {
  const { data: job, error } = await sb.rpc("talk_push_job", { p_id: id, p_secret: secret });
  if (error) return new Response(error.message, { status: 403 });
  if (!job) return Response.json({ sent: 0 });
  const t = job as TalkJob;
  const len = t.secs >= 60 ? `${Math.floor(t.secs / 60)}:${String(t.secs % 60).padStart(2, "0")}` : `0:${String(t.secs).padStart(2, "0")}`;
  const title = `🎙️ ${t.from}`, body = `Voice message (${len})${t.to && t.to !== "you" ? " · " + t.to : ""}`;
  const auth = await fcmToken().catch(() => null);
  const goneFcm: string[] = [], goneWeb: string[] = [];
  let android = 0, web = 0;
  const subsAll = t.recipients.flatMap((r) => r.subs);
  if (subsAll.length && t.vapid_public) webpush.setVapidDetails(t.subject, t.vapid_public, t.vapid_private);
  await Promise.all(t.recipients.map(async (r) => {
    /* Android app: a data message, so the app itself decides to play it out loud or show "tap to play" */
    if (auth) await Promise.all(r.fcm.map(async (token) => {
      const message = { token, android: { priority: "HIGH", ttl: "900s" },
        data: { type: "talk", id: String(t.id), audio: t.url, from: t.from, to: t.to || "", secs: String(t.secs), at: t.at,
                aloud: r.aloud ? "1" : "0", title, body, url: "#track/talk" } };
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
        method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      if (res.ok) { android++; return; }
      const e = await res.text();
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(e)) goneFcm.push(token);
    }));
    /* browsers and iPhones: a notification that opens Track → Talk */
    await Promise.all(r.subs.map(async (s) => {
      try { await webpush.sendNotification(s, JSON.stringify({ title, body, url: "#track/talk", tag: "talk-" + t.id }), { TTL: 900, urgency: "high" }); web++; }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) goneWeb.push(s.endpoint); }
    }));
  }));
  if (goneFcm.length) await sb.rpc("fcm_gone", { p_secret: secret, p_tokens: goneFcm });
  if (goneWeb.length) await sb.rpc("push_gone", { p_secret: secret, p_endpoints: goneWeb });
  return Response.json({ talk: t.id, android, web });
}
/* ---------- Talk: recordings older than 7 days (and deleted ones) are removed ---------- */
async function talkCleanup(secret: string) {
  const { data, error } = await sb.rpc("talk_expired", { p_secret: secret });
  if (error) return new Response(error.message, { status: 403 });
  const list = (data ?? []) as { id: number; path: string }[];
  if (!list.length) return Response.json({ removed: 0 });
  const { error: e2 } = await sb.storage.from("talk").remove(list.map((x) => x.path));
  if (e2) return new Response(e2.message, { status: 500 });
  const { data: n } = await sb.rpc("talk_purge", { p_secret: secret, p_ids: list.map((x) => x.id) });
  return Response.json({ removed: n ?? 0 });
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-push-secret") ?? "";
    const reqBody = await req.json();
    if (reqBody.talk) return await sendTalk(secret, Number(reqBody.talk));
    if (reqBody.talk_cleanup) return await talkCleanup(secret);
    const { id } = reqBody;
    const { data: job, error } = await sb.rpc("push_job", { p_id: id, p_secret: secret });
    if (error) return new Response(error.message, { status: 403 });
    if (!job) return Response.json({ sent: 0 });

    /* web push (browsers, iPhone) */
    let sent = 0;
    const gone: string[] = [];
    const subs = (job.subs ?? []) as { endpoint: string; keys: { p256dh: string; auth: string } }[];
    if (subs.length) {
      webpush.setVapidDetails(job.subject, job.vapid_public, job.vapid_private);
      const payload = JSON.stringify(job.payload);
      for (let i = 0; i < subs.length; i += 50) {          // 50 at a time
        await Promise.all(subs.slice(i, i + 50).map(async (s) => {
          try {
            await webpush.sendNotification(s, payload, job.urgent ? { TTL: 60 * 60, urgency: "high" } : { TTL: 60 * 60 * 24, urgency: "normal" });
            sent++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) gone.push(s.endpoint);   // phone unsubscribed / app removed
          }
        }));
      }
      if (gone.length) await sb.rpc("push_gone", { p_secret: secret, p_endpoints: gone });
    }

    /* the RWB Android app */
    let fcm = { sent: 0, gone: [] as string[] };
    try { fcm = await sendFcm((job.fcm ?? []) as string[], job.payload as Payload, !!job.urgent); }
    catch (e) { console.error(String(e)); }
    if (fcm.gone.length) await sb.rpc("fcm_gone", { p_secret: secret, p_tokens: fcm.gone });

    return Response.json({ sent, removed: gone.length, total: subs.length, android: fcm.sent, android_removed: fcm.gone.length });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
