# How to Write a Check (Explained Like You're 5): source

The first Short for **InfiniteHowTo369**, series "Grown-up Stuff, Explained Like You're 5".
Upload copy, research and Studio settings are in [PACKAGE.md](PACKAGE.md).
The finished video (`how-to-write-a-check_eli5.mp4`, 62 s, 1080x1920, 30 fps, -15.0 LUFS) is in the project files folder `infinite-how-to/write-a-check/`. It is not committed here because of its size.

This is the **second cut**. An independent review of the first cut asked for a real-life example (the check now pays rent to "Oak Street Rentals"), a faster hook (spot one starts at about 5 s), a clearer raccoon joke, and a few clipped or crowded frames. PACKAGE.md lists every change.

Everything is made with free local tools. No paid credits were used.

## Folders

- `voiceover/`: the script and the voice build.
  - `script_lines.json`: the 16 voiced lines (62.3 s).
  - `vo_build.py`: Kokoro TTS (kokoro-onnx), plus pocketsphinx forced alignment for per-word timings. It writes `build/vo.wav` and `build/timing.json`.
  - `samples.py`: the 4 voice samples Josh picked from. He chose `af_heart`.
  - `timing.json`: the timings used for the final cut.
- `scene/`: the Motion Studio scene ("Crayon Desk" style).
  - `check_body.js`: the drawing, camera, captions and sound cues.
  - `build_scene.py`: fits the beat to the voice, snaps every cut to a whole frame, then writes `scenes/check_eli5.js` (timing header + body).
- `kit-changes/`: changes made to the Motion Studio Kit for this video.
  - `score.py` and `score.py.diff`: a synth sound-effects bus (`CUES.sfx` with pop, scratch, slide, thud, knock, boing, sparkle, tick), plus `cut_gain`, `drums_gain`, `riser` and `sfx_gain` options. It also reads `window.SFX` from the scene.
  - `render.mjs` and `render.mjs.diff`: passes `window.SFX` to the score.
  - `page.tpl.html`: adds the Fredoka, Caveat and Nunito fonts.
  - `setup.sh`: installs those fonts and links the pre-installed Playwright (it searches the usual global module folders).

## Rebuild (about 5 minutes)

```bash
# 1. Kit: copy the Motion Studio Kit, then drop in kit-changes/ (score.py, render.mjs, web/page.tpl.html, setup.sh)
bash setup.sh

# 2. Voice (models: github.com/thewh1teagle/kokoro-onnx releases, model-files-v1.0)
cd voiceover && python3 vo_build.py af_heart 1.0

# 3. Scene
cp scene/check_body.js scene/build_scene.py <kit>/scenes/ih/
python3 <kit>/scenes/ih/build_scene.py voiceover/build/timing.json

# 4. Render, score and mux
node render.mjs scenes/check_eli5.js check_v2 --mb 5 --jobs 4
python3 score.py mix check_v2 --vo voiceover/build/vo.wav
ffmpeg -i build/check_v2/video.mp4 -i build/check_v2/mix.wav -c:v copy -c:a aac -b:a 192k \
       -af volume=-1.0dB -movflags +faststart out/check_eli5.mp4
```

The extra `-1.0 dB` keeps the true peak under -1 dBTP (it measures -1.2).

## Two timing rules this video taught the kit

- **Cuts sit on whole frames.** The renderer splits segments at `round(cut * 30)`, so a cut time between frames made one frame show the old shot inside the new segment. `build_scene.py` now rounds every cut to a frame.
- **Discrete switches sit at mid-frame.** Motion blur averages 5 samples across +/- 1/120 s. A caption chunk that changed inside that window showed two captions on top of each other. Caption and word-highlight switches are now placed at `(k + 0.5) / 30`, outside the blur window.

## Checks it passed

- `critique.py plan check_v2`: PASS. All 141 review frames scored 8/10 or higher (lowest 8, mean 8.8), with no machine flags.
- Loudness: -15.0 LUFS integrated, -1.2 dBFS true peak.
- Loop seam: the last frame flows back into the first (the raccoon peeks over the same check).
