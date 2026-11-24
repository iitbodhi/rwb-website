# Website app demo ("Try it here" on roninwb.in)

The app section of `index.html` has a demo (`#app-demo`, `js/app-demo.js`, CSS block "Try it here" at the end of `css/style.css`):
pick a feature, then tap the glowing spot on real app screens (`assets/demo/<feature>-<n>.webp`, dark theme, 600 px wide, ~35 KB each).
Images load only when the section is near the screen, one step at a time.

`F` in `js/app-demo.js` = feature -> `[[image, tap box in app px (390 x 844) or null, caption], ...]`.

## Remaking the screens (after the app changes)
1. Serve the repo: `python3 -m http.server 8766 --directory <repo>`.
2. `DSF=2 python3 cap.py` (or `python3 cap.py track sos` for some) records the demo app (member "Rohan Das", dark) into `shots/` and writes `flows.json`.
   `tiles2.py` draws stand-in street map tiles (real tiles can't be reached from the recording machine); `shoot.py` signs in to the demo app.
   Bodhi's fonts (Barlow) aren't installed there, so close stand-ins are mapped in `shoot.py` (`FONTS`).
3. Convert `shots/*.jpg` to 600 px WebP (q 74) in `assets/demo/`, and paste `flows.json` (as `[img without .jpg, tap, cap]`) into `F`.
