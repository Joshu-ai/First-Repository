'use strict';
// Renders Poof's PNG app icons from public/icon.svg with Playwright, so the
// home screen, the install prompt and system notifications all show the same
// Puff mark as the browser tab. Run: npm run icons
// Output (public/icons/):
//   icon-192.png, icon-512.png   the rounded violet tile as drawn in icon.svg, corners clear ("any")
//   icon-maskable-512.png        violet edge to edge with Puff inside the safe zone ("maskable"):
//                                launchers cut it to a circle, squircle or rounded square
//   apple-touch-icon.png         180px, violet edge to edge (iOS rounds the corners itself and
//                                would fill clear corners with black)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = path.join(PUBLIC, 'icons');
const SOURCE = fs.readFileSync(path.join(PUBLIC, 'icon.svg'), 'utf8');

// The tile is the 512px rect; Puff is the nested <svg> placed on it.
const TILE = /<rect width="512" height="512" rx="\d+" fill="(#[0-9a-f]{6})"\/>/i;
const MARK = /<svg x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" viewBox="([\d. ]+)"/;

// the tile without its rounding: violet to every edge
const square = (svg) => svg.replace(TILE, (_, fill) => `<rect width="512" height="512" fill="${fill}"/>`);

// Puff `width` px wide with his drawn shape (cloud and trail, not the empty
// margin of his viewBox) in the middle of the tile. DRAWN is that shape's
// box in his own units (mascot.js: the puffs and the trail's last circle).
const DRAWN = { x0: 38, y0: 42, x1: 217, y1: 142 };
function centred(svg, width) {
  const [, w, h, box] = svg.match(MARK);
  const [vx, vy, vw] = box.split(' ').map(Number);
  const scale = width / vw;
  const height = (width * Number(h)) / Number(w);
  const x = 256 - ((DRAWN.x0 + DRAWN.x1) / 2 - vx) * scale;
  const y = 256 - ((DRAWN.y0 + DRAWN.y1) / 2 - vy) * scale;
  return svg.replace(MARK, `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width}" height="${height.toFixed(1)}" viewBox="${box}"`);
}

// A maskable icon's safe zone is the circle of 40% radius in the middle
// (205px of 512): launchers may cut away anything outside it. At 340px wide,
// the farthest bit of Puff is about 165px from the centre.
const MASKABLE_WIDTH = 340;

const ICONS = [
  { file: 'icon-192.png', size: 192, svg: SOURCE },
  { file: 'icon-512.png', size: 512, svg: SOURCE },
  { file: 'icon-maskable-512.png', size: 512, svg: centred(square(SOURCE), MASKABLE_WIDTH) },
  { file: 'apple-touch-icon.png', size: 180, svg: square(SOURCE) },
];

(async () => {
  if (!TILE.test(SOURCE) || !MARK.test(SOURCE)) throw new Error('icon.svg no longer has the tile and mark this script expects');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const { file, size, svg } of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}
        svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      await page.screenshot({ path: path.join(OUT, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      await page.close();
      console.log(`public/icons/${file} (${size}x${size})`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
