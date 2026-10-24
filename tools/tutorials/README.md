# RWB App how-to videos

Tools used to make the 9:16 tutorial videos (1080x1920, 30 fps).

* `tutorial.html` + `render_install.py`: the install videos (Android and iPhone), drawn phone screens. `tutorial.html?v=android|ios`.
* `record.py`: drives the real app in demo mode as a member, screenshots every step and records tap positions (one function per video).
* `player.html` + `render_screens.py`: turns those screenshots into the animated phone video with captions.
* `assets.py`: sample pictures used in the videos (bill, helmet, gear, profile photo).

Pipeline: serve a copy of the site with `SUPABASE_URL` blanked (demo mode) on localhost:8766, run `python3 assets.py`,
`python3 record.py [names]`, `python3 render_screens.py <name>`, then
`ffmpeg -framerate 30 -i frames/<name>/%05d.jpg -f lavfi -i anullsrc=r=44100:cl=stereo -shortest -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -movflags +faststart out.mp4`.
Paths inside the scripts point at the working folder they were made in; change `S` at the top of each script.
