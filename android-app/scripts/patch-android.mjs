// Turns the standard Capacitor Android project into the RWB App:
// permissions (location in the background, notifications), the sign-in return link, links to roninwb.in,
// the notification icon and channels, our icons and SOS sound, the version number and release signing.
// Runs on GitHub after `npx cap add android`.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const android = path.join(root, 'android');
const app = path.join(android, 'app');
const read = f => fs.readFileSync(f, 'utf8');
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const must = (s, what) => { if (!s) throw new Error('patch-android: ' + what + ' not found'); return s; };

/* ---------- AndroidManifest.xml ---------- */
const mf = path.join(app, 'src/main/AndroidManifest.xml');
let m = read(mf);
const perms = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION',
  'POST_NOTIFICATIONS', 'WAKE_LOCK', 'VIBRATE', 'RECEIVE_BOOT_COMPLETED', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'];
const add = perms.filter(p => !m.includes(`android.permission.${p}"`)).map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
m = m.replace('</manifest>', `${add}\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>`);
// the main activity: sign-in comes back through in.roninwb.twa://auth, and roninwb.in/app links open in the app
const filters = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="in.roninwb.twa" android:host="auth" />
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="roninwb.in" android:pathPrefix="/app" />
            </intent-filter>
        </activity>`;
must(m.match(/<\/activity>/), 'main activity');
m = m.replace('</activity>', filters);
// notifications: our icon, colour and default channel
m = m.replace('<application', '<application android:usesCleartextTraffic="false"');
m = m.replace(/(<application[^>]*>)/, `$1
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_rwb" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/rwb_orange" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="rwb" />
        <service android:name=".TrackService" android:exported="false" android:foregroundServiceType="location" />`);
write(mf, m);

/* ---------- RWB Track: our own background service (keeps sharing with the screen off) ---------- */
const javaRoot = path.join(app, 'src/main/java');
const findMain = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name);
  if (e.isDirectory()) { const r = findMain(f); if (r) return r; } else if (e.name === 'MainActivity.java') return dir; } return null; };
const mainDir = must(findMain(javaRoot), 'MainActivity.java');
const pkg = must(read(path.join(mainDir, 'MainActivity.java')).match(/^package\s+([\w.]+);/m), 'MainActivity package')[1];
for (const f of fs.readdirSync(path.join(root, 'native')))
  write(path.join(mainDir, f), read(path.join(root, 'native', f)).replace(/^package\s+[\w.]+;/m, `package ${pkg};`));
console.log('patch-android: RWB Track service added in ' + path.relative(app, mainDir));

/* ---------- resources: icons, notification icon, SOS sound, colours, texts ---------- */
const res = path.join(app, 'src/main/res');
const copyDir = (from, to) => { for (const e of fs.readdirSync(from, { withFileTypes: true })) {
  const a = path.join(from, e.name), b = path.join(to, e.name);
  if (e.isDirectory()) copyDir(a, b); else { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(a, b); } } };
copyDir(path.join(root, 'res'), res);
// the start-up picture: RWB logo on dark instead of Capacitor's
(function splash(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  const f = path.join(dir, e.name);
  if (e.isDirectory()) splash(f); else if (e.name === 'splash.png') fs.copyFileSync(path.join(root, dir.includes('land') ? 'splash-land.png' : 'splash.png'), f); } })(res);
write(path.join(res, 'values/rwb_colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="rwb_orange">#D4501A</color>
</resources>
`);
const strings = path.join(res, 'values/strings.xml');
let s = read(strings);
if (!s.includes('capacitor_background_geolocation_notification_channel_name'))
  s = s.replace('</resources>', '    <string name="capacitor_background_geolocation_notification_channel_name">Live location (Track)</string>\n</resources>');
s = s.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">RWB</string>')
     .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">RWB</string>');
write(strings, s);

/* ---------- app/build.gradle: version and release signing ---------- */
const bg = path.join(app, 'build.gradle');
let g = read(bg);
const run = Number(process.env.GITHUB_RUN_NUMBER || 1);
g = must(g.replace(/versionCode\s+\d+/, `versionCode ${100 + run}`), 'versionCode')
       .replace(/versionName\s+"[^"]*"/, `versionName "2.0.${run}"`);
if (process.env.RWB_KEYSTORE) {
  g = g.replace(/android\s*\{/, `android {
    signingConfigs {
        release {
            storeFile file(System.getenv("RWB_KEYSTORE"))
            storePassword System.getenv("RWB_STORE_PASSWORD")
            keyAlias System.getenv("RWB_KEY_ALIAS")
            keyPassword System.getenv("RWB_KEY_PASSWORD")
        }
    }`);
  g = must(g.replace(/buildTypes\s*\{\s*release\s*\{/, 'buildTypes {\n        release {\n            signingConfig signingConfigs.release'), 'release build type');
}
write(bg, g);
console.log('patch-android: done (versionCode ' + (100 + run) + (process.env.RWB_KEYSTORE ? ', signed' : ', unsigned check build') + ')');
