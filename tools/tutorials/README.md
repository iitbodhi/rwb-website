# RWB App how-to videos (Guides → App)

The 12 built-in how-to videos in `app/videos/` (listed in `VIDEOS` in `app/js/app.js`). Remade in Nov 2026 for the current app,
in plain words for riders who aren't tech savvy: one action per step, a voice that says what to tap, subtitles,
the phone screen zoomed in on the part being used, an orange box around the button and a finger that taps it.

Each video is 720x1280, under 60 s, about 1 MB (H.264 crf 31, 48 kbps mono audio). Videos stream from the server
(the service worker never stores them), so they cost the phone no storage.

## Files
* `videos.py`: what each video shows and says (one function per video; `r.scene(title, [sentences])`, then taps).
  Write "R W B", "S O S", "one one two" in the spoken text: the subtitles show them as RWB, SOS and 112.
* `rec.py`: drives the real app in demo mode (member "Rohan Das"; admin role for team tools, FAM for the family video),
  screenshots each step and remembers where the finger taps.
* `tiles.py`: stand-in street-map tiles for Track (the real map tiles can't be reached from the recording machine).
* `make.py`: voice (Piper, en-us-ryan-high), timing, frames from `howto2.html`, soft music, MP4 + cover JPG.
* `probe.py` / `sheet.py`: helpers to look at a screen's buttons and check a recording before rendering.
* `tutorial.html`, `render_install.py`, `install_*`, `mix_install.py`: the older install videos. `explainer*`: promo explainers.

## Remaking a video
1. Serve the repo: `python3 -m http.server 8766 --directory <repo>`.
2. Fonts: Barlow + Barlow Condensed installed locally (`~/.fonts`). Voice: Piper binary and `en-us-ryan-high.onnx`
   (GitHub releases of rhasspy/piper, tag `v0.0.2` has the voice) in the folder `V` at the top of `make.py`.
3. Change `S` at the top of `rec.py` / `make.py` to a work folder that has `assets/` (run `assets.py` and `checklist_pdf.py`; add `logo-384.png`: the logo at 384 px).
4. `python3 videos.py service` then `python3 sheet.py service` (check the steps), then `python3 make.py service`.
5. Copy `out/service.mp4` and `out/service.jpg` to `app/videos/`, update the seconds in `VIDEOS`, bump `VERSION` in `app/sw.js`.
