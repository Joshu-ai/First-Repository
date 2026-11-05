// Headless render loop: Chrome paints each frame from code, ffmpeg encodes.
// Renders one segment per shot so a failed shot can be re-rendered alone and spliced back.
//
// usage: node render.mjs <scene.js> <key> [--fps 30] [--mb 5] [--draft] [--only 2,5] [--stills 1.2,3.4]
//   --mb N     motion blur: N samples across a 180-degree shutter (final: 5, draft: 1)
//   --draft    fast preview: no motion blur, fast encode
//   --only     re-render just these segment numbers, then re-splice video.mp4
//   --stills   write full-res JPEG stills at these times instead of video
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [sceneArg, key] = process.argv.slice(2);
if (!sceneArg || !key) { console.error('usage: node render.mjs <scene.js> <key> [options]'); process.exit(2); }
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const flag = n => process.argv.includes(n);
const draft = flag('--draft');
const fps = +arg('--fps', 30), mb = +arg('--mb', draft ? 1 : 5);
const out = path.join(here, 'build', key), segDir = path.join(out, 'seg');
fs.mkdirSync(segDir, { recursive: true });

const CHROME = process.env.CHROME || '';
const jobs = +arg('--jobs', 1);
async function openPage() {
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  await page.goto('file://' + path.join(here, 'web', 'page.html') + '?scene=' + encodeURIComponent('file://' + path.resolve(sceneArg)));
  await page.waitForFunction(() => typeof window.render === 'function' && window.DUR > 0);
  await page.evaluate(async () => { if (window.FONTS) await Promise.all(window.FONTS.map(f => document.fonts.load(f))); await document.fonts.ready; });
  const missing = await page.evaluate(() => (window.FONTS || []).filter(f => !document.fonts.check(f)));
  if (missing.length) { console.error('fonts failed to load:', missing); process.exit(1); }
  const grab = async t => {
    await page.evaluate(([t, fps, mb]) => window.M.renderMB(t, fps, mb), [t, fps, mb]);
    return page.screenshot({ type: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
  };
  return { browser, page, grab };
}
const W0 = await openPage(), { page, grab } = W0;
const meta = await page.evaluate(() => ({ dur: window.DUR, shots: window.SHOTS || [], beat: window.BEAT || null, cues: window.CUES || {}, sfx: window.SFX || null }));

if (arg('--stills')) {
  for (const t of arg('--stills').split(',').map(Number)) fs.writeFileSync(path.join(out, `still_${t.toFixed(2)}.jpg`), await grab(t));
  await W0.browser.close(); process.exit();
}

// segments: one per shot, long shots split at <= 4 s
const N = Math.round(meta.dur * fps);
const cuts = [0, ...meta.shots.map(t => Math.round(t * fps)).filter(f => f > 0 && f < N), N];
const segs = [];
for (let i = 0; i < cuts.length - 1; i++) {
  const a = cuts[i], b = cuts[i + 1], parts = Math.ceil((b - a) / (4 * fps));
  for (let p = 0; p < parts; p++) segs.push([a + Math.round((b - a) * p / parts), a + Math.round((b - a) * (p + 1) / parts)]);
}
fs.writeFileSync(path.join(out, 'render.json'), JSON.stringify({ ...meta, fps, frames: N, segments: segs }, null, 1));

const only = arg('--only') ? new Set(arg('--only').split(',').map(Number)) : null;
const t0 = Date.now(); let done = 0;
const queue = segs.map((_, s) => s).filter(s => !only || only.has(s));
const workers = [W0, ...await Promise.all(Array.from({ length: Math.max(0, Math.min(jobs, queue.length) - 1) }, openPage))];
async function work(Wk) { while (queue.length) await renderSeg(Wk, queue.shift()); }
async function renderSeg({ grab }, s) {
  const file = path.join(segDir, String(s).padStart(3, '0') + '.mp4');
  const [a, b] = segs[s];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '22' : '15', '-pix_fmt', 'yuv420p',
    '-g', String(fps * 2), '-r', String(fps), '-video_track_timescale', String(fps * 1000), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    const buf = await grab(f / fps);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    done++;
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  console.log(`segment ${s} frames ${a}-${b - 1} done (${((Date.now() - t0) / 1000).toFixed(0)}s, ${(done / ((Date.now() - t0) / 1000)).toFixed(1)} fps)`);
}
await Promise.all(workers.map(work));
await Promise.all(workers.map(w => w.browser.close()));

// splice all segments into video.mp4 (stream copy, frame-exact)
const list = segs.map((_, s) => `file '${path.join(segDir, String(s).padStart(3, '0') + '.mp4')}'`).join('\n');
fs.writeFileSync(path.join(out, 'concat.txt'), list);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(out, 'concat.txt'), '-c', 'copy', path.join(out, 'video.mp4')]);
const got = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path.join(out, 'video.mp4')]).toString().trim();
console.log(`video.mp4: ${got} frames (expected ${N})`);
if (+got !== N) { console.error('frame count mismatch'); process.exitCode = 1; }
