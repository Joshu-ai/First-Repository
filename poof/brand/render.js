'use strict';
// Renders the Poof marketing art from the same code-drawn Puff and avatars the
// app uses, so the brand stays consistent. Run: node brand/render.js
// Output: brand/social-1200x630.png, brand/story-1080x1920.png, brand/puff-1024.png
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = __dirname;
const ICON = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(PUBLIC, 'icon.svg')).toString('base64');

// a fixed cast of friends so the art never changes between runs
const CAST = [
  { bg: 1, skin: 1, face: 0, hair: 2, hairColor: 0, eyes: 1, mouth: 1, acc: 1, shirt: 2 },
  { bg: 2, skin: 4, face: 1, hair: 4, hairColor: 1, eyes: 4, mouth: 4, acc: 0, shirt: 4 },
  { bg: 3, skin: 0, face: 2, hair: 6, hairColor: 5, eyes: 0, mouth: 0, acc: 7, shirt: 7 },
  { bg: 4, skin: 2, face: 0, hair: 1, hairColor: 6, eyes: 1, mouth: 5, acc: 2, shirt: 0 },
  { bg: 5, skin: 5, face: 1, hair: 3, hairColor: 3, eyes: 2, mouth: 1, acc: 5, shirt: 6 },
  { bg: 7, skin: 3, face: 0, hair: 0, hairColor: 0, eyes: 5, mouth: 2, acc: 3, shirt: 1 },
];

const css = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; overflow: hidden; }
  .bg { position: absolute; inset: 0; background:
      radial-gradient(60% 70% at 70% 40%, #9b82ff 0%, transparent 70%),
      radial-gradient(50% 60% at 15% 90%, #ff7a6b55 0%, transparent 70%),
      linear-gradient(160deg, #6a48f5 0%, #2a1f66 100%); }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(#ffffff22 1.5px, transparent 1.5px); background-size: 28px 28px; }
  .puff { position: absolute; filter: drop-shadow(0 30px 40px rgb(20 10 60 / .45)); }
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
  <svg class="spark" style="left:980px;top:60px" width="34" height="34" viewBox="0 0 10 10"><path d="M5 0l1.3 3.7L10 5 6.3 6.3 5 10 3.7 6.3 0 5l3.7-1.3z" fill="currentColor"/></svg>`;
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
    const page = await browser.newPage({ viewport: { width: w, height: h } });
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
  await browser.close();
  console.log('brand art written to', OUT, fs.readdirSync(OUT).filter((f) => f.endsWith('.png')));
})().catch((e) => { console.error(e); process.exit(1); });
