'use strict';
// Renders Puffcodes to PNG with the real app code in a real browser, for the
// scan check (test/puffcode-scan.py runs this, then decodes every PNG).
// Run on its own: node test/puffcode-render.js <out-dir>
// Writes <out-dir>/cases.json: [{ file, url, how }] plus the PNGs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../server');

const AVATARS = [
  null, // no avatar yet: Puff's own face
  { expr: 4, face: 1, skin: 2, eyeColor: 3, hair: 3, hairColor: 4, beard: 0, acc: 2, shirt: 5, bg: 1 },
  { expr: 0, face: 0, skin: 6, eyeColor: 1, hair: 9, hairColor: 0, beard: 0, acc: 0, shirt: 1, bg: 7 },
  { expr: 13, face: 3, skin: 0, eyeColor: 4, hair: 5, hairColor: 10, beard: 3, acc: 3, shirt: 6, bg: 4 },
];
// usernames from the shortest to the longest allowed, and origins from short
// to long (the longest steps the code up to a bigger version)
const USERS = ['ava', 'ben', 'li.na', 'dee_dee', 'puff.fan_2026', 'abcdefghijklmnopqrst'];
const ORIGINS = ['https://poof.app', 'http://localhost:3000', 'http://192.168.1.20:3000', 'https://a-much-longer-poof-host.example.com'];

(async () => {
  const out = path.resolve(process.argv[2] || 'puffcodes');
  fs.mkdirSync(out, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poof-puffcode-'));
  const { server } = createApp({ dataDir });
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const cases = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.PoofPuffcode);
    let i = 0;
    for (const origin of ORIGINS) {
      for (const username of USERS) {
        const avatar = AVATARS[i % AVATARS.length];
        const url = `${origin}/add/${username}`;
        const base = `${String(++i).padStart(2, '0')}-${username}`;
        // 1. the saved PNG ("Save Puffcode"), 1080px
        const png = await page.evaluate(({ url, username, avatar }) => window.PoofPuffcode.png({ url, username, avatar }, 1080),
          { url, username, avatar });
        fs.writeFileSync(path.join(out, base + '-saved.png'), Buffer.from(png.split(',')[1], 'base64'));
        cases.push({ file: base + '-saved.png', url, how: 'saved PNG, 1080px' });
        // 2. as the profile screen shows it: 280 CSS px on the dark app background
        await page.evaluate(({ url, username, avatar }) => {
          document.getElementById('shot')?.remove();
          const box = document.createElement('div');
          box.id = 'shot';
          box.style.cssText = 'position:fixed;inset:0;z-index:999;display:grid;place-items:center;background:var(--bg)';
          box.innerHTML = window.PoofPuffcode.svg({ url, username, avatar, size: 280 });
          document.body.append(box);
        }, { url, username, avatar });
        await page.locator('#shot').screenshot({ path: path.join(out, base + '-screen.png') });
        cases.push({ file: base + '-screen.png', url, how: 'on screen, 280px on the dark background' });
      }
    }
    fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(cases, null, 2));
    console.log(`rendered ${cases.length} Puffcodes to ${out}`);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => { console.error(e); process.exit(1); });
