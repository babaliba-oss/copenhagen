# The trailer

How the launch trailer (gtcopenhagen.com, 76 s, 16:9 and a 4:5 feed version) was cut from two in-game recordings:
`?cinematic` drives (see `docs/COPENHAGEN.md`) screen-recorded at 60 fps, today and 1760. Nothing here is needed to
run the game.

- `edl.json` — the edit: one entry per shot (`src` m/h, `t` seconds into the recording, `in` offset into the cut,
  `d` duration, `cap` caption, `act` section), plus the title, the "Press Y" card, split screens, the wipe and the end
  card. Every duration is a multiple of 0.6 s so cuts land on beats at 100 BPM.
- `build.py <cuts dir> <out dir> [--final] [--feed] [--only=ids]` — assembles it with ffmpeg and PIL. Cuts are
  `cNN.mp4` (1080p60, cropped from the recordings with `crop=3402:1914:9:300,scale=1920:1080,fps=60`); overlays use the
  game's own fonts from `public/fonts`; the game logo goes next to this file as `logo.png`. `--feed` makes the 4:5
  version (centre crop, captions in a band below). Music is muxed from `music.wav` with loudnorm to -16 LUFS.
- `music.py out.wav <seconds>` — the score, synthesised with numpy (nothing sampled): a pulse for today, a plucked
  cittern, squeezebox and fiddle for 1760, both together for the two-era shots, bells for Christmas, one Picardy chord
  at the end. Sections and their drops are read from `edl.json`, each with its own bar grid, so every drop lands on
  its cut.
- `patch.py in.mp4 out.mp4` — paints a brief near-camera object out of a cut (frames whose lower region deviates from
  their neighbours get it replaced by a blend of the clean frames either side).
- `scan.py trailer.mp4` — the check: per-frame difference spikes away from cuts, dark frames, duplicate frames, per-shot
  motion.
