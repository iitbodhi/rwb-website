# RWB — handover note for Claude (read this first)

**Owner:** Bodhi, the RWB super admin. He doesn't code, so explain everything in plain words. Send previews (screenshots or video) before making any redesign or policy text live. Small fixes can go straight live. Keep everything on free plans.

**What RWB is:** the TVS Ronin community app for Ronin Warriors of Bengal.
- Website: roninwb.in, served by GitHub Pages from this repo (iitbodhi/rwb-website). Pushing to `main` makes it live in about 2–10 minutes.
- The app: `app/` folder. The Android app (package `in.roninwb.twa`, built with Capacitor) loads its screens from roninwb.in/app. So **web changes reach every installed copy without a new build**.
- A new Android build is needed only for native changes: icon, the Track background service, notifications, Google sign-in sheet, permissions. Those live in `android-app/`.
- Any change under `android-app/**` triggers `.github/workflows/android.yml`. Build N gets versionCode 100+N and version 2.0.N. The build makes the RWB-Play-N .aab (Bodhi uploads it to Play Console → Closed testing) and also updates `download/RWB-App.apk`.
- Backend: Supabase (Mumbai), free plan. Watch the egress usage.
- Member sheet: the RWB_Contact Google Sheet, synced every 12 hours by `tools/form-sync.gs` (Apps Script).

## Where things are
- `app/index.html`: app shell and the "Nightfall" intro, which plays on every open.
- `app/js/app.js`: all screens. Routes are in `ROUTES`.
- `app/js/api.js`: two implementations, a live one (Supabase) and a demo one (localStorage, used when SUPABASE_URL is blank).
  - **Every new call must be added to both, and in the same object.** Live admin calls belong inside `admin: {}`. A past bug came from live admin calls sitting outside it.
- `app/css/app.css`: styles. New blocks are appended at the end.
- `app/sw.js`: **bump `VERSION` (rwb-app-vNNN) on every web change.**
- `supabase/*.sql`: setup files. Bodhi runs each one himself in the Supabase SQL Editor. Files are numbered as sent to him; the last was 64 (speed.sql), so the next is **65**. Make each file safe to run twice and end it with `notify pgrst, 'reload schema';`.
- `supabase/functions/ask-ronin`: Pookie, the AI. Bodhi deploys it by pasting into Supabase → Edge Functions. Since v8 (file 61) it answers only from teachings (`pookie_knowledge`: rider answers, admin answers, Guides PDF text read with unpdf, plus the website team/gear lists); the AI (Groq first, Gemini backup) only words the reply. Unknown questions → "I don't know that yet…" and `pookie_log_unknown` marks them URGENT in Teach Pookie. The old "Admin notes for Pookie" box is gone (its lines became `admin` teachings).
- Calendar (`#calendar`, button left of How-to videos; not for RWB FAM): `viewCalendar` in app.js shows RWB events plus vehicle dates: document expiry, next service, My Ride parts due (km-based dates guessed from riding rate), logged services/parts/fill-ups and members' own reminders (`my_reminders`). Bodhi removed birthdays and holidays (keep events!) (the `holidays` Edge Function is gone too). Day/month/filter taps only redraw (`drawCal`), data loads once per visit. The app syncs service/part due dates to `my_reminders` (`sync_my_reminders`); the `rwb-reminders` cron (8:30 IST) sends kind `reminder` notifications.
- Changing a member's email (file 63): admins edit it in Edit details. If the member is on the app, `admin_update_member` unlinks them at once (`user_id` → null, old uid kept in `members.move_from`, old push tokens deleted); `link_account` returns `moved` to the old account and the app signs it out with a note. When they sign in with the new email, `link_account` relinks and `private.move_account` carries every auth.users-linked row across (also used by `claim_membership`); `rwb.quiet_join` skips the "new Ronin joined" note. `private.account_moves` + `my_old_folders()` let the new account open files still in the old account's storage folder.
- Speed (file 64 + Nov 2026 CSS): RLS checks are wrapped as `(select auth.uid())` / `(select is_member())` so they run once per request, and every `user_id` column has an index. New policies: write them that way, or re-run speed.sql (safe). Screen entrance animation is 0.2 s with no stagger; `html.lite` (≤4 GB / ≤4 cores) keeps decorations still; `html.scrolling` pauses them while scrolling/tapping. Keep new screens cache-first (show what's loaded, refresh in the background).
- `privacy.html`, `js/terms.js`: legal text. Terms version is 2.0. The Grievance Officer is Sayantan Sarkar (ronin.warriors.bengal@gmail.com). Update these whenever a feature changes what data is collected or shown.
- `app/videos/`: how-to videos, each under 60 s. `tools/tutorials/record2.py` records the demo app, `howto_tts.py` adds the voice, `howto_make.py` renders.

## Rules
- Never commit secrets: keystore, passwords, the sync secret or service-account JSON. They go in GitHub or Supabase secrets only. `form-sync.gs` keeps the placeholder `PASTE-THE-SYNC-SECRET-HERE`.
- Keep Bodhi's personal email private.
- Don't draw brand logos.
- **Commits:** use `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, end the message with the attribution lines from the system reminder, then `git pull --rebase origin main && git push origin HEAD:main`.

## Testing
- **Serve the site:** `python3 -m http.server 8766 --directory <repo>`.
- **Demo mode:** with Playwright, serve an empty `APP_CONFIG` for `**/app/config.js`. Wait for `#boot` to be detached before clicking, then click `[data-act=google]`. You sign in as the demo admin.
- **Demo role switch:**
  - Member: edit `localStorage['rwb-app-demo-v2']` and set `members[0].role`.
  - RWB FAM: set `localStorage['rwb-demo-fam']='1'`.
- **Use the default Playwright user agent.** An Android user agent shows the "Get the app" blocker.
- **The shell can't reach Supabase or roninwb.in.** For anything about live data, ask Bodhi to run SQL in the SQL Editor and send a screenshot.

## Status (Nov 2026)
- **Play closed test:** live. Build 24 is the current upload. Bodhi's account needs 12+ testers for 14 days, then he can apply for production.
- **After production approval:** switch the website download buttons, /get and the FAM links to Play, and set `PLAY_TRACK` to production.
- **Admin → App copies** shows who uses the Play, APK or browser copy.
