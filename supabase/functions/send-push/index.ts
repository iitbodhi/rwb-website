// RWB App: "send-push" Supabase Edge Function.
// The database calls this whenever a notification is created (new Motomart post, birthday,
// announcement…). It fetches the message and the list of subscribed phones, then sends the pushes.
// Nothing to configure here: the keys live in the database (private.config).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-push-secret") ?? "";
    const { id } = await req.json();
    const { data: job, error } = await sb.rpc("push_job", { p_id: id, p_secret: secret });
    if (error) return new Response(error.message, { status: 403 });
    if (!job || !job.subs?.length) return Response.json({ sent: 0 });

    webpush.setVapidDetails(job.subject, job.vapid_public, job.vapid_private);
    const payload = JSON.stringify(job.payload);
    const subs = job.subs as { endpoint: string; keys: { p256dh: string; auth: string } }[];
    const gone: string[] = [];
    let sent = 0;
    for (let i = 0; i < subs.length; i += 50) {          // 50 at a time
      await Promise.all(subs.slice(i, i + 50).map(async (s) => {
        try {
          await webpush.sendNotification(s, payload, job.urgent ? { TTL: 60 * 60, urgency: "high" } : { TTL: 60 * 60 * 24, urgency: "normal" });   // SOS: delivered at once, even to sleeping phones
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.endpoint);   // phone unsubscribed / app removed
        }
      }));
    }
    if (gone.length) await sb.rpc("push_gone", { p_secret: secret, p_endpoints: gone });
    return Response.json({ sent, removed: gone.length, total: subs.length });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
