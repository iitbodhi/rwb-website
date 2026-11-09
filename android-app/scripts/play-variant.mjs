// Turns the built RWB Android project into the Google Play Store version (run after the APK for roninwb.in is built):
// - marks it as the Play Store app (it then updates through the Play Store, never by downloading an APK)
// - removes the permission Google Play restricts (asking to ignore battery optimisation directly); the app opens the
//   app's settings page instead, where riders choose Battery → Unrestricted.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const app = path.join(root, 'android', 'app', 'src', 'main');
const mf = path.join(app, 'AndroidManifest.xml');
let m = fs.readFileSync(mf, 'utf8');
m = m.replace(/\s*<uses-permission android:name="android\.permission\.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"\s*\/>/g, '');
fs.writeFileSync(mf, m);
const ch = path.join(app, 'res', 'values', 'rwb_channel.xml');
fs.writeFileSync(ch, fs.readFileSync(ch, 'utf8').replace(/>web</, '>play<'));
console.log('play-variant: Play Store version ready (channel=play, battery permission removed)');
