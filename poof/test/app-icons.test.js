'use strict';
// The PNG app icons (public/icons/, made by scripts/render-icons.js): listed
// in the manifest and the page at their real sizes, and drawn the way each
// use needs (clear corners; edge to edge; Puff inside the maskable safe zone).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PUBLIC = path.join(__dirname, '..', 'public');
const VIOLET = [0x6d, 0x4c, 0xff];

// A minimal PNG reader for what Chromium writes: 8-bit RGB or RGBA, not
// interlaced. Returns { width, height, px(x, y) -> [r, g, b, a] }.
function readPng(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is a PNG`);
  let at = 8;
  let ihdr;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  assert.equal(ihdr.depth, 8, '8 bits a channel');
  assert.ok([2, 6].includes(ihdr.color), 'RGB or RGBA');
  assert.equal(ihdr.interlace, 0);
  const bpp = ihdr.color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * bpp;
  const out = Buffer.alloc(ihdr.height * stride);
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y ? out[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      out[y * stride + i] = (line[i] + pred) & 0xff;
    }
  }
  const px = (x, y) => {
    const o = y * stride + x * bpp;
    return [out[o], out[o + 1], out[o + 2], bpp === 4 ? out[o + 3] : 255];
  };
  return { width: ihdr.width, height: ihdr.height, px };
}

const near = ([r, g, b], [R, G, B], tol = 3) => Math.abs(r - R) <= tol && Math.abs(g - G) <= tol && Math.abs(b - B) <= tol;
const isViolet = (p) => p[3] === 255 && near(p, VIOLET);
const isWhite = (p) => p[3] === 255 && near(p, [255, 255, 255], 8);

test('the manifest lists the PNG icons at their real sizes, a maskable one among them', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
  const pngs = manifest.icons.filter((i) => i.type === 'image/png');
  assert.deepEqual(pngs.map((i) => [i.src, i.sizes, i.purpose]), [
    ['/icons/icon-192.png', '192x192', 'any'],
    ['/icons/icon-512.png', '512x512', 'any'],
    ['/icons/icon-maskable-512.png', '512x512', 'maskable'],
  ]);
  for (const i of pngs) {
    const png = readPng(path.join(PUBLIC, i.src));
    assert.equal(`${png.width}x${png.height}`, i.sizes, i.src);
  }
  assert.ok(manifest.icons.some((i) => i.src === '/icon.svg'), 'the vector icon stays for browsers that take it');
});

test('the page links an apple-touch-icon that is 180px and violet to every edge', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon.png">/);
  const png = readPng(path.join(PUBLIC, 'icons', 'apple-touch-icon.png'));
  assert.deepEqual([png.width, png.height], [180, 180]);
  for (const [x, y] of [[0, 0], [179, 0], [0, 179], [179, 179]]) {
    assert.ok(isViolet(png.px(x, y)), `corner ${x},${y} is solid violet (iOS would paint a clear one black)`);
  }
  assert.ok(isWhite(png.px(70, 90)), 'with white Puff in the middle');
});

test('the "any" icons are the rounded tile: clear corners, violet, white Puff', () => {
  for (const size of [192, 512]) {
    const png = readPng(path.join(PUBLIC, 'icons', `icon-${size}.png`));
    assert.equal(png.px(0, 0)[3], 0, `${size}: the corner is clear`);
    assert.equal(png.px(size - 1, size - 1)[3], 0, `${size}: and the other one`);
    assert.ok(isViolet(png.px(size >> 1, Math.round(size * 0.1))), `${size}: violet tile`);
    assert.ok(isWhite(png.px(Math.round(size * 0.4), Math.round(size * 0.55))), `${size}: white Puff`);
  }
});

test('the maskable icon is violet to the edges and Puff stays inside the safe zone', () => {
  const png = readPng(path.join(PUBLIC, 'icons', 'icon-maskable-512.png'));
  const safe = 0.4 * 512; // the circle launchers never cut into
  let outside = 0;
  let puff = 0;
  let far = 0;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const p = png.px(x, y);
      const d = Math.hypot(x + 0.5 - 256, y + 0.5 - 256);
      if (isViolet(p)) continue;
      if (d > safe) outside++;
      else { puff++; far = Math.max(far, d); }
    }
  }
  assert.equal(outside, 0, 'nothing but violet outside the safe zone');
  assert.ok(puff > 512 * 512 * 0.1, `Puff is a good size (${puff} px)`);
  assert.ok(far < safe - 16, `with room to spare (his farthest pixel is ${far.toFixed(0)}px out of ${safe}px)`);
});
