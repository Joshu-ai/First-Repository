# How to Write a Check (Explained Like You're 5): source

The first Short for **InfiniteHowTo369**, series "Grown-up Stuff, Explained Like You're 5".
Upload copy, research and Studio settings are in [PACKAGE.md](PACKAGE.md).
The finished video (`how-to-write-a-check_eli5.mp4`, 63 s, 1080x1920, 30 fps, -14.8 LUFS) is in the project files folder `infinite-how-to/write-a-check/`. It is not committed here because of its size.

Everything is made with free local tools. No paid credits were used.

## Folders

- `voiceover/`: the script and the voice build.
  - `script_lines.json`: the 16 voiced lines.
  - `vo_build.py`: Kokoro TTS (kokoro-onnx), plus pocketsphinx forced alignment for per-word timings. It writes `build/vo.wav` and `build/timing.json`.
  - `samples.py`: the 4 voice samples Josh picked from. He chose `af_heart`.
  - `timing.json`: the timings used for the final cut.
- `scene/`: the Motion Studio scene ("Crayon Desk" style).
  - `check_body.js`: the drawing, camera, captions and sound cues.
  - `build_scene.py`: fits the beat to the voice, then writes `scenes/check_eli5.js` (timing header + body).
- `kit-changes/`: changes made to the Motion Studio Kit for this video.
  - `score.py` and `score.py.diff`: a synth sound-effects bus (`CUES.sfx` with pop, scratch, slide, thud, knock, boing, sparkle, tick), plus `cut_gain`, `drums_gain`, `riser` and `sfx_gain` options.
  - `page.tpl.html`: adds the Fredoka, Caveat and Nunito fonts.
  - `setup.sh`: installs those fonts and links the pre-installed Playwright.

## Rebuild (about 5 minutes)

```bash
# 1. Kit: copy the Motion Studio Kit, then drop in kit-changes/ (score.py, web/page.tpl.html, setup.sh)
bash setup.sh

# 2. Voice (models: github.com/thewh1teagle/kokoro-onnx releases, model-files-v1.0)
cd voiceover && python3 vo_build.py af_heart 1.0

# 3. Scene
cp scene/check_body.js scene/build_scene.py <kit>/scenes/ih/
python3 <kit>/scenes/ih/build_scene.py voiceover/build/timing.json

# 4. Render, score and mux
node render.mjs scenes/check_eli5.js check_final --mb 5 --jobs 4
python3 score.py mix check_final --vo voiceover/build/vo.wav
ffmpeg -i build/check_final/video.mp4 -i build/check_final/mix.wav -c:v copy -c:a aac -b:a 192k \
       -af volume=-0.8dB -movflags +faststart out/check_eli5.mp4
```

The extra `-0.8 dB` keeps the true peak under -1 dBTP (it measures -1.1).

## Checks it passed

- `critique.py plan check_final`: PASS. Every graded frame scored 8/10 or higher (lowest 8, mean 8.4), with no machine flags.
- Loudness: -14.8 LUFS integrated, -1.1 dBTP.
- Loop seam: the last frame flows back into the first.
