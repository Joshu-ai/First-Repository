'use strict';
// Renders the Poof marketing art from the same code-drawn Puff and avatars the
// app uses, so the brand stays consistent. Run: node brand/render.js
// Output (at 2x pixel density): brand/social-1200x630.png, brand/story-1080x1920.png,
// brand/puff-1024.png, plus brand/puff/: every mood as a vector SVG and a
// 2048px transparent PNG, and the solid mark used for the app icon.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = __dirname;
const ICON = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(PUBLIC, 'icon.svg')).toString('base64');

// a fixed cast of friends so the art never changes between runs
const CAST = [
  { expr: 2, face: 0, skin: 1, eyeColor: 0, hair: 3, hairColor: 0, beard: 0, acc: 1, shirt: 2, bg: 1 },
  { expr: 3, face: 1, skin: 4, eyeColor: 1, hair: 5, hairColor: 1, beard: 0, acc: 7, shirt: 4, bg: 2 },
  { expr: 4, face: 3, skin: 0, eyeColor: 4, hair: 6, hairColor: 6, beard: 0, acc: 8, shirt: 7, bg: 3 },
  { expr: 8, face: 2, skin: 2, eyeColor: 3, hair: 7, hairColor: 9, beard: 1, acc: 3, shirt: 0, bg: 4 },
  { expr: 15, face: 1, skin: 5, eyeColor: 2, hair: 9, hairColor: 4, beard: 0, acc: 6, shirt: 6, bg: 5 },
  { expr: 13, face: 0, skin: 3, eyeColor: 0, hair: 2, hairColor: 2, beard: 3, acc: 0, shirt: 1, bg: 0 },
];

const css = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; overflow: hidden; }
  .bg { position: absolute; inset: 0; background: #6d4cff; }
  .dots { display: none; }
  .puff { position: absolute; filter: drop-shadow(0 18px 24px rgb(20 10 60 / .3)); }
  .puff svg { width: 100%; height: auto; display: block; }
  .av { position: absolute; border-radius: 50%; box-shadow: 0 0 0 6px #ffffff, 0 18px 30px rgb(20 10 60 / .4); }
  .av svg { display: block; }
  .bubble { position: absolute; background: #fff; color: #2a2257; font-weight: 800; border-radius: 999px; padding: 10px 22px; box-shadow: 0 12px 24px rgb(20 10 60 / .35); white-space: nowrap; }
  h1 { font-size: var(--h1); line-height: .95; letter-spacing: -.02em; font-weight: 900; }
  h1 em { font-style: normal; color: #ffd9d4; }
  p { font-size: var(--p); opacity: .9; margin-top: 18px; font-weight: 500; }
  .wordmark { display: inline-flex; align-items: center; gap: 12px; font-weight: 900; font-size: var(--wm); }
  .wordmark img { width: var(--wmi); height: var(--wmi); border-radius: 22%; box-shadow: 0 6px 16px rgb(0 0 0 / .25); }
  .spark { position: absolute; color: #ffd9d4; }
`;

function social(m, a) {
  return `<div class="bg"></div><div class="dots"></div>
  <div style="position:absolute;left:72px;top:96px;width:560px;--h1:84px;--p:28px;--wm:34px;--wmi:52px">
    <div class="wordmark"><img alt="">Poof</div>
    <h1 style="margin-top:40px">Snap it.<br>Send it.<br><em>Poof.</em></h1>
    <p>Photos that vanish once they're seen.</p>
  </div>
  <div class="puff" style="left:690px;top:150px;width:430px">${m('wink', 430)}</div>
  <div class="av" style="left:650px;top:70px">${a(0, 96)}</div>
  <div class="av" style="left:1060px;top:90px">${a(1, 84)}</div>
  <div class="av" style="left:1080px;top:430px">${a(2, 92)}</div>
  <div class="av" style="left:700px;top:470px">${a(3, 80)}</div>
  <div class="bubble" style="left:820px;top:520px;font-size:24px">New snap from Ava 📸</div>
`;
}

function story(m, a) {
  return `<div class="bg"></div><div class="dots"></div>
  <div style="position:absolute;left:0;right:0;top:150px;text-align:center;--wm:56px;--wmi:88px">
    <div class="wordmark"><img alt="">Poof</div>
  </div>
  <div class="av" style="left:110px;top:420px">${a(0, 150)}</div>
  <div class="av" style="left:820px;top:380px">${a(1, 140)}</div>
  <div class="av" style="left:70px;top:1060px">${a(4, 130)}</div>
  <div class="av" style="left:860px;top:1020px">${a(2, 140)}</div>
  <div class="av" style="left:470px;top:360px">${a(5, 120)}</div>
  <div class="puff" style="left:190px;top:560px;width:700px">${m('happy', 700)}</div>
  <div class="bubble" style="left:540px;top:1180px;font-size:38px">Opened ✨</div>
  <div style="position:absolute;left:0;right:0;top:1340px;text-align:center;--h1:128px;--p:44px">
    <h1>Snap it.<br>Send it. <em>Poof.</em></h1>
    <p>Photos that vanish once they're seen.</p>
  </div>`;
}

(async () => {
  const browser = await chromium.launch();
  const render = async (name, w, h, body) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><style>${css}</style><body></body>`);
    await page.addScriptTag({ path: path.join(PUBLIC, 'mascot.js') });
    await page.addScriptTag({ path: path.join(PUBLIC, 'avatar.js') });
    await page.evaluate(({ body: fnSrc, cast }) => {
      const m = (mood, size) => window.mascotSVG(mood, size, '');
      const a = (i, size) => window.PoofAvatar.avatarSVG(cast[i], size);
      // eslint-disable-next-line no-new-func
      document.body.innerHTML = new Function('m', 'a', 'return (' + fnSrc + ')(m, a)')(m, a);
    }, { body: body.toString(), cast: CAST });
    await page.evaluate((src) => document.querySelectorAll('img').forEach((i) => { i.src = src; }), ICON);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await page.screenshot({ path: path.join(OUT, name) });
    await page.close();
  };
  await render('social-1200x630.png', 1200, 630, social);
  await render('story-1080x1920.png', 1080, 1920, story);
  await render('puff-1024.png', 1024, 1024, (m) =>
    `<div style="position:absolute;inset:0;display:grid;place-items:center"><div class="puff" style="width:860px">${m('happy', 860)}</div></div>`);
  // Puff on its own: vector SVG + 2048px transparent PNG for each mood and the mark
  const PUFF = path.join(OUT, 'puff');
  fs.mkdirSync(PUFF, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 2 });
  await page.setContent('<!doctype html><style>html,body{margin:0;background:transparent}body{width:1024px;height:1024px;display:grid;place-items:center}svg{display:block}</style><body></body>');
  await page.addScriptTag({ path: path.join(PUBLIC, 'mascot.js') });
  const variants = [...(await page.evaluate(() => window.mascotMoods)).map((mood) => [mood, mood, 'char', '#ffffff']),
    ['mark', 'happy', 'mark', '#6d4cff'], ['mark-white', 'happy', 'mark', '#ffffff']];
  for (const [name, mood, variant, color] of variants) {
    // draw it, then crop the viewBox to the artwork with even padding so every file is centred
    const svg = await page.evaluate(({ mood, variant, color }) => {
      document.body.innerHTML = window.mascotSVG(mood, 960, 'Puff, the Poof mascot', variant, color);
      const el = document.querySelector('svg');
      // the belly shade is clipped to the body but getBBox ignores clipping, so leave it out
      const shade = el.querySelector('g[clip-path]');
      if (shade) shade.style.display = 'none';
      const b = el.getBBox();
      if (shade) shade.style.display = '';
      const side = Math.max(b.width, b.height) * 1.2;
      const x = b.x + b.width / 2 - side / 2;
      const y = b.y + b.height / 2 - side / 2;
      el.setAttribute('viewBox', [x, y, side, side].map((v) => +v.toFixed(2)).join(' '));
      el.setAttribute('width', 960);
      el.setAttribute('height', 960);
      return el.outerHTML;
    }, { mood, variant, color });
    fs.writeFileSync(path.join(PUFF, `${name}.svg`), svg.replace(/ width="\d+" height="\d+"/, '') + '\n');
    await page.screenshot({ path: path.join(PUFF, `${name}.png`), omitBackground: true });
  }
  await page.close();
  await browser.close();
  console.log('brand art written to', OUT, fs.readdirSync(OUT).filter((f) => f.endsWith('.png')), '+', fs.readdirSync(PUFF).length, 'files in puff/');
})().catch((e) => { console.error(e); process.exit(1); });
