# RWB App: one-time setup

The app lives in the `app/` folder of this repo and opens at **https://roninwb.in/app/**.
Until steps 1–7 are done it runs in **demo mode** (sample data, stored only on the phone), so you can try it right away.

Everything below is free. Budget about 45 minutes, done once by one admin (the super admin).

---

## 1. Create the Supabase project (database + logins + bill storage)

1. Go to **supabase.com**, sign up with Google (no card needed).
2. **New project** → name `rwb-app`, set a strong database password (save it somewhere safe), region **Mumbai (ap-south-1)**, plan **Free**.
3. Wait about 2 minutes for it to start.

## 2. Create the tables and security rules

1. Left menu → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/schema.sql` → **Run**. It should say "Success".

## 3. Import the members sheet

1. On your computer, download the join-form responses as CSV (Google Sheet → File → Download → CSV).
2. Run `python3 tools/import_members.py RWB_Contact.csv members_import.csv`
   (or use the `members_import.csv` Claude already made for you).
3. Supabase → **Table Editor** → `members` → **Insert** → **Import data from CSV** → choose `members_import.csv` → **Import**.
4. **Delete `members_import.csv` from your computer afterwards.** It has everyone's phone numbers and blood groups. Never commit it to GitHub.

## 4. Make yourself the super admin

SQL Editor → run, with your own Google email:

```sql
update public.members set role = 'superadmin' where lower(email) = lower('your-email@gmail.com');
```

It should say "1 row affected". If 0, your email isn't in the sheet: add yourself through the join form, re-import, and try again.
The other 4 admins are promoted from inside the app: **Admin → Members → (name) → Make admin**.

## 5. Turn on "Sign in with Google"

**a) In Google Cloud (makes the Google login button work)**

1. Go to **console.cloud.google.com** → create a project called `RWB App`.
2. Open **Google Auth Platform** (also called "OAuth consent screen"):
   - App name `RWB App`, support email = yours, audience **External**.
   - Under **Audience**, click **Publish app** so it's "In production". Otherwise only 100 test users can sign in. No Google review is needed because the app only asks for name and email.
3. **Clients** → **Create client** → type **Web application**:
   - Authorised JavaScript origins: `https://roninwb.in`
   - Authorised redirect URIs: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
     (copy the exact URL from Supabase → Authentication → Sign In / Providers → Google, where it's shown as "Callback URL")
4. Copy the **Client ID** and **Client secret**.

**b) In Supabase**

1. **Authentication → Sign In / Providers → Google** → enable, paste Client ID and secret → Save.
2. On the same page, **turn off the Email provider** (members only use Google).
3. **Authentication → URL Configuration**:
   - Site URL: `https://roninwb.in/app/`
   - Redirect URLs: add `https://roninwb.in/app/`

## 6. Connect the app to Supabase

1. Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
   (Never use the `service_role` key anywhere. It bypasses all security.)
2. Paste both into `app/config.js`:

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJ...',
```

3. Commit and push. GitHub Pages publishes it in about a minute.

## 7. Test it

1. Open **https://roninwb.in/app/** on your phone → Continue with Google.
2. You should land on the home screen with an **Admin** button.
3. Ask one more admin to sign in, then promote them from Admin → Members.
4. Tap **Me → Install RWB app** (Android) or **Share → Add to Home Screen** (iPhone).

---

## How members get in

| Situation | What happens |
|---|---|
| Signs in with the same Google email they used on the join form | In instantly, profile already filled |
| Uses a different email, or is new | Fills a short form → shows up under **Admin → Requests** with the matching sheet row (by WhatsApp number) → an admin taps Approve |
| Leaves the RWB WhatsApp community | **Admin → Members → (name) → Remove from RWB** deletes their profile, app account, service records, fuel log and bills |

## Who can see what

- **Members** see only their own profile, service records, bills and fuel log. On birthdays they see names only (never the year, never phone numbers).
- **Admins** see the member list (to approve, edit and remove people) but **cannot** open anyone's service records, fuel logs or bills.
- **Only the super admin** can make or remove admins. The super admin can't be removed from the app.
- People who aren't signed in see nothing.

## Keeping it free

- The free plan gives 500 MB of database and 1 GB of file storage. Bill photos are shrunk to about 150–250 KB each before upload, which is enough for several thousand bills.
- Free projects pause after 7 days with no activity. The GitHub Action `.github/workflows/keep-supabase-awake.yml` pings the database once a day so this never happens. Check it's enabled under the repo's **Actions** tab.

## Changing things later

- Service items list and birthday wish text: `app/config.js`
- Maintenance guides and accessories: the same Google Drive folder and Sheet as the website (from `js/data.js`)
- After changing any file in `app/`, bump `VERSION` in `app/sw.js` (e.g. `rwb-app-v2`) so phones pick up the new version.

---

# Phase 2: Motomart, announcements and push notifications

1. **SQL Editor → New query** → paste all of `supabase/phase2.sql` → **Run**.
2. **SQL Editor → New query** → paste the private keys file you were given (`4-push-keys-PRIVATE.sql`) → **Run**. Then delete that file. It must never go on GitHub.
3. **Edge Functions → Deploy a new function → Via Editor** → name it exactly `send-push` → replace the sample code with `supabase/functions/send-push/index.ts` → **Deploy**.
4. On your phone: open the app → tap your initials (top right) → **Turn on notifications** → **Send test**.

How it works: every new announcement, approved Motomart post, birthday (8:00 AM daily), new member or access request is saved in the `notifications` table. The database then calls `send-push`, which sends the notification to every phone that turned it on (members can choose which kinds they want).
iPhone users get notifications only after adding the app to their Home Screen (iOS 16.4 or later).

---

# Automatic sync from the Google join form

1. **SQL Editor → New query** → paste `supabase/form-sync.sql` plus the line that sets `sheet_secret` (from the private file you were given) → **Run**.
2. Open the Google Sheet with the join form responses → **Extensions → Apps Script** → paste `tools/form-sync.gs` with `SYNC_SECRET` filled in → **Save**.
3. Pick **setup** in the function list → **Run** → allow access. It copies anyone missing, then every new form submission reaches the app automatically.

Members removed by an admin are not re-added from old rows; if they fill the form again later, they come back.

---

# RWB AI chatbot (free, Google Gemini)

1. Get a free Gemini API key at **aistudio.google.com/apikey** (Create API key).
2. **SQL Editor** → paste `supabase/chat.sql` plus this line with your key → **Run**:
   `insert into private.config (key, value) values ('gemini_key', 'YOUR-KEY') on conflict (key) do update set value = excluded.value;`
3. **Edge Functions → Deploy a new function → Via Editor** → name `ask-ronin` → paste `supabase/functions/ask-ronin/index.ts` → **Deploy**.
4. Admins can teach it RWB-specific info in **Admin → RWB AI**. Limits: 20 questions per member per day (admins 60), 500 in total per day; change `chat_daily_limit` / `chat_global_daily_limit` in `private.config`.
