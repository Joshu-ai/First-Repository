// ===== InfiniteHowTo369 · ELI5 series · "How to Write a Check (Explained Like You're 5)" =====
// Header (TM timing, BEAT, SHOTS, DUR) is injected by build_scene.py from the voiceover's word timings.
window.REF = {
  style: 'Crayon Desk (InfiniteHowTo369 ELI5 series): flat picture-book illustration on warm notebook paper, chunky rounded shapes with soft ink outlines, a mint check as the hero prop, a sneaky raccoon as the running gag',
  palette: 'paper #F7F0E3, ink #2A2433, check mint #DDF0E6, pen-ink blue #1F4FB8, marker yellow #FFD84A, one colour per spot (sky, coral, green, purple, orange, pink)',
  type: 'Fredoka for headings and captions (mixed case), Caveat for handwriting on the check, Nunito for printed check labels, JetBrains Mono for the bottom numbers',
  motion: 'springs only; hard cuts on the beat grid with a small camera kick; push-ins inside shots; the pen writes in sync with the spoken words; bouncy pops for badges and stickers',
};
window.FONTS = ['700 68px Fredoka', '600 54px Fredoka', '700 46px Caveat', '800 18px Nunito', '700 15px Nunito', '500 24px "JetBrains Mono"'];

const W = 1080, H = 1920, cv = document.getElementById('c'), ctx = cv.getContext('2d');
const C = {
  paper: '#F7F0E3', dot: '#E6D9C2', ink: '#2A2433', inkSoft: 'rgba(42,36,51,0.55)', white: '#FFFFFF',
  mint: '#DDF0E6', mintDeep: '#BFE0CF', mintLine: '#6E9C8A', label: '#3B6555', blueInk: '#1F4FB8',
  marker: '#FFD84A', red: '#EF4B45', green: '#2FB574', pink: '#FF9EC1', pinkDeep: '#F07AA6',
  spot: ['#4DA3FF', '#FF6B5A', '#2FB574', '#8B6CF0', '#FF9F1C', '#F0508C'],
  coon: '#8F8A99', coonDark: '#3A3442', coonLight: '#ECE8F1', gold: '#F6C343', goldDeep: '#D99A1E',
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

// ---------- timing helpers (all from the voiceover) ----------
const LW = TM.lines.map((_, li) => TM.words.filter(w => w.line === li));
const ws = (li, wi) => LW[li][wi].start, we = (li, wi) => LW[li][wi].end;
const S = window.SHOTS;
const shotOf = t => { let i = 0; while (i < S.length && t >= S[i] - 1e-6) i++; return i; };
const st = i => (i === 0 ? 0 : S[i - 1]);
const en = i => (i < S.length ? S[i] : window.DUR);

// ---------- textures ----------
const PAPER = (() => {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = C.paper; x.fillRect(0, 0, W, H);
  const r = rng(5);
  for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(120,90,50,${0.02 + r() * 0.035})`; x.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  x.fillStyle = C.dot;
  for (let y = 40; y < H; y += 54) for (let xx = 30; xx < W; xx += 54) { x.beginPath(); x.arc(xx, y, 2.4, 0, 7); x.fill(); }
  return c;
})();
const grain = Array.from({ length: 6 }, (_, g) => {
  const c = document.createElement('canvas'); c.width = 540; c.height = 960; const x = c.getContext('2d');
  const im = x.createImageData(540, 960), r = rng(31 + g * 17);
  for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (r() - .5) * 90; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  x.putImageData(im, 0, 0); return c;
});
const VIG = (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const v = x.createRadialGradient(W / 2, H * .45, H * .25, W / 2, H * .5, H * .85);
  v.addColorStop(0, 'rgba(80,50,20,0)'); v.addColorStop(1, 'rgba(80,50,20,0.22)'); x.fillStyle = v; x.fillRect(0, 0, W, H); return c; })();

// ---------- drawing helpers ----------
function rr(x, y, w, h, r, fill, stroke, lw = 4) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function txt(s, x, y, font, color, align = 'left', base = 'alphabetic') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
}
function circle(x, y, r, fill, stroke, lw = 4) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function ellipse(x, y, rx, ry, rot, fill, stroke, lw = 4) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}
// pop-in scale with a bouncy spring, starting a little early so it lands on the beat
const pop = (t, t0, p = 'bouncy') => Math.max(0, M.spring(t, t0 - 0.06, p));
function scaled(x, y, s, fn) { if (s <= 0.001) return; ctx.save(); ctx.translate(x, y); ctx.scale(s, s); fn(); ctx.restore(); }

// ---------- the check (local units: 1000 x 458) ----------
const CW = 1000, CH = 458;
const F = {
  date:  { x: 716, y: 113, size: 42, text: 'Nov 5, 2026', t0: ws(2, 4) - 0.05, t1: ws(2, 4) + 0.8, spot: 0 },
  payee: { x: 166, y: 199, size: 50, text: 'Pizza Palace', t0: ws(3, 6) - 0.12, t1: ws(3, 6) + 0.66, spot: 1 },
  amt:   { x: 812, y: 203, size: 50, text: '25.50', t0: ws(4, 5) - 0.05, t1: ws(4, 5) + 0.6, spot: 2 },
  words: { x: 48, y: 270, size: 46, spot: 3, segs: [['Twenty-five', ws(6, 7), ws(6, 8) + 0.28], [' and ', ws(6, 9) - 0.04, ws(6, 9) + 0.1], ['50/100', ws(6, 10), we(6, 13)]] },
  memo:  { x: 106, y: 392, size: 42, text: 'pizza night', t0: ws(9, 6) - 0.05, t1: ws(9, 6) + 0.72, spot: 4 },
  sign:  { x: 574, y: 392, size: 60, text: 'Jamie Lee', t0: ws(10, 5) - 0.04, t1: ws(10, 5) + 0.8, spot: 5 },
};
F.words.t0 = F.words.segs[0][1]; F.words.t1 = F.words.segs[2][2];
const DASH = { t0: ws(7, 3) - 0.05, t1: ws(7, 6) + 0.12, y: 262, x1: 824 };
// every pen stroke on the check, as a function of time
const hand0 = sz => `700 ${sz}px Caveat`;
const STROKES = [
  ...['date', 'payee', 'amt', 'memo', 'sign'].map(n => ({ t0: F[n].t0, t1: F[n].t1, pos: t => { const f = F[n], w = measure(f.text, hand0(f.size)); return [f.x + w * clamp((t - f.t0) / (f.t1 - f.t0)), f.y - 6]; } })),
  { t0: F.words.t0, t1: F.words.t1, pos: t => [F.words.x + (wordsEnd() - 14 - F.words.x) * wordsProgress(t, 2), F.words.y - 6] },
  { t0: DASH.t0, t1: DASH.t1, pos: t => [lerp(wordsEnd(), DASH.x1, clamp((t - DASH.t0) / (DASH.t1 - DASH.t0))), DASH.y] },
];
const FL = { t0: -0.24, t1: 0.56 };
const flPoint = p => [580 + 330 * p, 410 + 10 * Math.sin(p * Math.PI * 2.2) - 14 * p * (1 - p)];
function penState(t, i, rest) {
  if (i === 16) return { pos: flPoint(0.3), down: M.spring(t, window.DUR - 0.4, 'snap') };
  let list = isFull(i) ? [] : STROKES.filter(s => s.t1 > st(i) && s.t0 < en(i));
  if (i === 0) list = [{ t0: FL.t0, t1: FL.t1, pos: t => flPoint(clamp((t - FL.t0) / (FL.t1 - FL.t0))) }];
  const act = list.find(s => t >= s.t0 && t < s.t1);
  if (act) return { pos: act.pos(t), down: 1 };
  const prev = list.filter(s => s.t1 <= t).sort((a, b) => b.t1 - a.t1)[0], next = list.filter(s => s.t0 > t).sort((a, b) => a.t0 - b.t0)[0];
  const dNext = next ? M.spring(t, next.t0 - 0.22, 'snap') : 0, dPrev = prev ? 1 - M.spring(t, prev.t1, 'snap') : 0;
  let pos;
  if (prev && next) { const a = prev.pos(prev.t1), b = next.pos(next.t0), k = M.spring(t, prev.t1 + 0.05, 'smooth'); pos = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)]; }
  else if (prev) pos = prev.pos(prev.t1); else if (next) pos = next.pos(next.t0); else pos = rest;
  return { pos, down: Math.max(dNext, dPrev) };
}
// where each spot lives on the check (for highlights, badges and the mini-map)
const SPOT_BOX = [[700, 74, 258, 58], [150, 150, 626, 66], [800, 152, 164, 68], [40, 226, 790, 62], [96, 352, 340, 58], [534, 340, 428, 70]];
const isFull = i => i === 0 || i === 1 || i === 16;            // complete check (title, note diagram, loop)
const fieldP = (f, t, i) => isFull(i) ? 1 : clamp((t - f.t0) / (f.t1 - f.t0));
const wordsW = {};  // measured once per font
function measure(s, font) { const k = font + '|' + s; if (!(k in wordsW)) { ctx.font = font; wordsW[k] = ctx.measureText(s).width; } return wordsW[k]; }
const hand = sz => `700 ${sz}px Caveat`;

function writeText(f, p) {   // returns the pen head x (local) for progress p
  const font = hand(f.size), w = measure(f.text, font);
  if (p <= 0) return f.x;
  ctx.save(); ctx.beginPath(); ctx.rect(f.x - 6, f.y - f.size * 1.2, w * p + 6, f.size * 1.8); ctx.clip();
  txt(f.text, f.x, f.y, font, C.blueInk); ctx.restore();
  return f.x + w * p;
}
function wordsProgress(t, i) {   // piecewise, word-synced
  if (isFull(i)) return 1;
  const segs = F.words.segs, font = hand(F.words.size), full = measure(segs.map(s => s[0]).join(''), font);
  let x = 0;
  for (const [s, a, b] of segs) {
    const w = measure(s, font), k = clamp((t - a) / (b - a));
    if (k < 1) return (x + w * k) / full;
    x += w;
  }
  return 1;
}
function drawWords(p) {
  const f = F.words, s = f.segs.map(q => q[0]).join(''), font = hand(f.size), w = measure(s, font);
  if (p <= 0) return f.x;
  ctx.save(); ctx.beginPath(); ctx.rect(f.x - 6, f.y - f.size * 1.2, w * p + 6, f.size * 1.8); ctx.clip();
  txt(s, f.x, f.y, font, C.blueInk); ctx.restore();
  return f.x + w * p;
}
const wordsEnd = () => F.words.x + measure(F.words.segs.map(q => q[0]).join(''), hand(F.words.size)) + 14;
function signFlourish(p) {   // curvy underline under the signature
  if (p <= 0) return [580, 408];
  const pts = []; const N = 40;
  for (let k = 0; k <= N * p; k++) { const u = k / N; pts.push([580 + 330 * u, 410 + 10 * Math.sin(u * Math.PI * 2.2) - 14 * u * (1 - u)]); }
  ctx.save(); ctx.strokeStyle = C.blueInk; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
  return pts[pts.length - 1];
}

function drawCheckBase() {
  // shadow
  ctx.save(); ctx.shadowColor = 'rgba(60,40,20,0.22)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
  rr(0, 0, CW, CH, 22, C.mint); ctx.restore();
  // security wave pattern
  ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, CW, CH, 22); ctx.clip();
  ctx.strokeStyle = 'rgba(110,156,138,0.16)'; ctx.lineWidth = 2;
  for (let k = -6; k < 30; k++) { ctx.beginPath(); for (let x = 0; x <= CW; x += 20) { const y = k * 22 + 12 * Math.sin(x / 70 + k * .6); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  ctx.restore();
  rr(0, 0, CW, CH, 22, null, C.mintLine, 4); rr(12, 12, CW - 24, CH - 24, 14, null, 'rgba(110,156,138,0.45)', 2);
  // printed details
  txt('Jamie Lee', 40, 56, '800 22px Nunito', C.label);
  txt('12 Maple Street, Anytown', 40, 80, '700 16px Nunito', C.label);
  txt('1001', 958, 58, '800 24px Nunito', C.label, 'right');
  txt('Date', 650, 120, '800 19px Nunito', C.label);
  line(706, 124, 956, 124);
  txt('Pay to the', 40, 184, '800 17px Nunito', C.label); txt('order of', 40, 205, '800 17px Nunito', C.label);
  line(150, 208, 774, 208);
  txt('$', 784, 204, '800 34px Nunito', C.label);
  rr(806, 158, 154, 58, 9, 'rgba(255,255,255,0.65)', C.mintLine, 2.5);
  line(40, 278, 832, 278);
  txt('Dollars', 842, 276, '800 19px Nunito', C.label);
  // bank logo
  ellipse(60, 326, 19, 15, 0, C.pink, C.pinkDeep, 2.5); ellipse(73, 328, 6, 5, 0, C.pinkDeep);
  txt('Piggy Bank & Trust', 88, 334, '800 20px Nunito', C.label);
  txt('Memo', 40, 398, '800 17px Nunito', C.label); line(98, 402, 436, 402);
  line(540, 402, 960, 402);
  // bottom numbers (made up, for the example)
  micr(1);
}
function line(x1, y1, x2, y2, w = 2.5, col = C.mintLine) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.stroke(); }
const MICR = [['123456789', 122], ['000123456789', 360], ['1001', 700]];
function micrSym(x, y, kind, col) {   // simplified bank symbols between the number groups
  ctx.fillStyle = col;
  if (kind === 0) { ctx.fillRect(x, y - 18, 4, 18); ctx.fillRect(x + 7, y - 12, 6, 5); ctx.fillRect(x + 7, y - 4, 6, 4); }
  else { ctx.fillRect(x, y - 18, 4, 9); ctx.fillRect(x + 7, y - 18, 4, 9); ctx.fillRect(x + 14, y - 9, 4, 9); }
}
function micr(a, glow = [0, 0, 0]) {
  ctx.save(); ctx.globalAlpha = a;
  MICR.forEach(([s, x], k) => {
    if (glow[k] > 0) { const w = measure(s, '500 25px "JetBrains Mono"'); rr(x - 8, 420, w + 16, 34, 9, `rgba(255,216,74,${0.85 * glow[k]})`); }
    txt(s, x, 446, '500 25px "JetBrains Mono"', C.ink);
  });
  micrSym(104, 446, 0, C.ink); micrSym(258, 446, 0, C.ink); micrSym(552, 446, 1, C.ink);
  ctx.restore();
}

// camera: maps check-local (cx, cy) to screen (510, sy) at scale s
function withCam(cam, fn) { ctx.save(); ctx.translate(510, cam.sy); ctx.scale(cam.s, cam.s); ctx.translate(-cam.cx, -cam.cy); fn(); ctx.restore(); }
const toScreen = (cam, x, y) => [510 + (x - cam.cx) * cam.s, cam.sy + (y - cam.cy) * cam.s];

function highlight(i, t, t0, k = 1) {
  const [x, y, w, h] = SPOT_BOX[i], p = pop(t, t0, 'bouncy') * k;
  if (p <= 0) return;
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(lerp(.85, 1, clamp(p, 0, 1.2)), lerp(.6, 1, clamp(p, 0, 1.2)));
  ctx.globalAlpha = .55 * clamp(p, 0, 1); rr(-w / 2 - 8, -h / 2 - 6, w + 16, h + 12, 14, C.marker); ctx.restore();
}
function drawCheck(t, i, opts = {}) {
  drawCheckBase();
  if (opts.hl) opts.hl.forEach(([k, t0]) => highlight(k, t, t0));
  let head = null;
  const fields = ['date', 'payee', 'amt', 'memo', 'sign'];
  for (const n of fields) { const f = F[n], p = fieldP(f, t, i); const x = writeText(f, p); if (p > 0 && p < 1) head = [x, f.y - 6]; }
  const wp = wordsProgress(t, i), wx = drawWords(wp); if (wp > 0 && wp < 1) head = [wx, F.words.y - 6];
  const dp = isFull(i) ? 1 : clamp((t - DASH.t0) / (DASH.t1 - DASH.t0));
  if (dp > 0) { const x0 = wordsEnd(); line(x0, DASH.y, lerp(x0, DASH.x1, dp), DASH.y, 4.5, C.blueInk); if (dp < 1) head = [lerp(x0, DASH.x1, dp), DASH.y]; }
  if (opts.flourish != null) { const e = signFlourish(opts.flourish); if (opts.flourish > 0 && opts.flourish < 1) head = e; }
  return head;
}

// ---------- props ----------
function pen(x, y, t, down = 1, rot = -0.62, sc = 1) {   // tip at (x, y)
  const d = clamp(down, 0, 1.2), bob = 3 * Math.sin(t * 38) * clamp(d);
  ctx.save(); ctx.translate(x, y + bob - (1 - d) * 24); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(10, 26, 26, 8, 0, 0, 7); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-11, -34); ctx.lineTo(11, -34); ctx.closePath(); ctx.fillStyle = '#C9CED8'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.stroke();
  circle(0, -4, 3.5, C.ink);
  rr(-16, -96, 32, 64, 10, '#2C4FA8', C.ink, 4);
  rr(-17, -250, 34, 160, 14, '#3D6FE6', C.ink, 4);
  rr(-17, -270, 34, 30, 10, '#2C4FA8', C.ink, 4);
  rr(14, -262, 10, 92, 5, '#C9CED8', C.ink, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-9, -236, 6, 130);
  ctx.restore();
}
function pencil(x, y, rot = -0.62, sc = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-14, -38); ctx.lineTo(14, -38); ctx.closePath(); ctx.fillStyle = '#F2D2A2'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-5, -13); ctx.lineTo(5, -13); ctx.closePath(); ctx.fillStyle = '#4A4452'; ctx.fill();
  rr(-15, -230, 30, 194, 4, '#FFC93C', C.ink, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(-5, -226, 10, 186);
  rr(-15, -256, 30, 28, 4, '#BFC5CF', C.ink, 4); rr(-15, -290, 30, 36, 10, '#FF8FA3', C.ink, 4);
  ctx.restore();
}
function coin(x, y, r, a = 1) {
  ctx.save(); ctx.globalAlpha = a; circle(x, y, r, C.gold, C.goldDeep, 4); circle(x, y, r * .72, null, 'rgba(217,154,30,0.7)', 3);
  txt('$', x, y + r * .36, `700 ${Math.round(r * 1.05)}px Fredoka`, C.goldDeep, 'center'); ctx.restore();
}
function bank(x, y, sc = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  ctx.beginPath(); ctx.moveTo(-150, -110); ctx.lineTo(0, -190); ctx.lineTo(150, -110); ctx.closePath(); ctx.fillStyle = '#FFE3A3'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke();
  rr(-150, -112, 300, 24, 6, '#FFD173', C.ink, 5);
  for (let k = 0; k < 4; k++) rr(-118 + k * 72, -86, 26, 140, 6, '#FFF4DA', C.ink, 4);
  rr(-165, 54, 330, 26, 6, '#FFD173', C.ink, 5); rr(-185, 80, 370, 22, 6, '#F2C26A', C.ink, 5);
  txt('BANK', 0, -128, '700 30px Fredoka', C.ink, 'center');
  ellipse(-50, -146, 15, 12, 0, C.pink, C.ink, 3); txt('$', 30, -140, '700 34px Fredoka', C.goldDeep, 'center');
  ctx.restore();
}
function friend(x, y, sc, t) {   // the pizza chef who gets paid
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  rr(-70, 40, 140, 120, 50, C.spot[1], C.ink, 5);
  circle(0, 0, 66, '#FFD9B8', C.ink, 5);
  // chef hat
  ctx.beginPath(); ctx.arc(-30, -78, 30, 0, 7); ctx.arc(0, -96, 34, 0, 7); ctx.arc(30, -78, 30, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke();
  rr(-46, -66, 92, 26, 8, '#fff', C.ink, 5);
  const blink = (t * 1.3) % 3 < 0.12 ? 0.15 : 1;
  ellipse(-22, -2, 7, 9 * blink, 0, C.ink); ellipse(22, -2, 7, 9 * blink, 0, C.ink);
  ctx.beginPath(); ctx.arc(0, 18, 22, 0.15 * Math.PI, 0.85 * Math.PI); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.stroke();
  circle(-40, 22, 9, 'rgba(255,107,90,0.35)'); circle(40, 22, 9, 'rgba(255,107,90,0.35)');
  ctx.restore();
}
function you(x, y, sc, t) {   // the check writer
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  rr(-70, 40, 140, 120, 50, C.spot[0], C.ink, 5);
  circle(0, 0, 66, '#F3C29B', C.ink, 5);
  ctx.beginPath(); ctx.arc(0, -10, 68, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(40, -50); ctx.quadraticCurveTo(0, -30, -50, -48); ctx.closePath(); ctx.fillStyle = '#5A3B2E'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke();
  const blink = ((t + 1.1) * 1.3) % 3 < 0.12 ? 0.15 : 1;
  ellipse(-22, 0, 7, 9 * blink, 0, C.ink); ellipse(22, 0, 7, 9 * blink, 0, C.ink);
  ctx.beginPath(); ctx.arc(0, 18, 20, 0.15 * Math.PI, 0.85 * Math.PI); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.stroke();
  ctx.restore();
}
function miniCheck(x, y, w, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); const s = w / CW; ctx.scale(s, s); ctx.translate(-CW / 2, -CH / 2);
  drawCheckBase(); for (const n of ['date', 'payee', 'amt', 'memo', 'sign']) writeText(F[n], 1); drawWords(1); line(wordsEnd(), DASH.y, DASH.x1, DASH.y, 4.5, C.blueInk);
  ctx.restore();
}
function piggy(x, y, sc, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  for (const lx of [-50, -18, 22, 52]) rr(lx - 13, 40, 26, 44, 10, C.pinkDeep, C.ink, 4);
  ellipse(0, 0, 110, 80, 0, C.pink, C.ink, 5);
  ctx.beginPath(); ctx.moveTo(-60, -60); ctx.lineTo(-40, -102); ctx.lineTo(-18, -70); ctx.fillStyle = C.pinkDeep; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.stroke();
  ellipse(-108, 6, 26, 30, 0, '#FF86B4', C.ink, 4); ellipse(-114, -2, 4, 7, 0, C.ink); ellipse(-102, 12, 4, 7, 0, C.ink);
  circle(-64, -18, 7, C.ink);
  rr(-6, -74, 50, 10, 5, C.ink);
  ctx.beginPath(); ctx.moveTo(108, -6); ctx.bezierCurveTo(140, -30, 150, 10, 126, 6); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke();
  ctx.restore();
}
// The sneaky raccoon (running gag). mood: 'sneaky' | 'oops' | 'grin'. look: -1..1 pupils.
function raccoon(x, y, sc, t, mood = 'sneaky', look = -1, holding = null) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  // ringed tail behind
  ctx.save(); ctx.translate(120, 120); ctx.rotate(-0.5 + 0.12 * Math.sin(t * 4));
  for (let k = 0; k < 6; k++) ellipse(0, -k * 34, 34 - k * 2, 24, 0, k % 2 ? C.coonDark : C.coon, C.ink, 4);
  ctx.restore();
  // body
  ellipse(0, 150, 105, 95, 0, C.coon, C.ink, 5); ellipse(0, 170, 62, 60, 0, C.coonLight);
  // ears
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 48, -48); ctx.quadraticCurveTo(s * 86, -128, s * 98, -36); ctx.closePath(); ctx.fillStyle = C.coon; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 60, -52); ctx.quadraticCurveTo(s * 84, -102, s * 88, -48); ctx.closePath(); ctx.fillStyle = C.coonDark; ctx.fill(); }
  // head
  ctx.beginPath(); ctx.moveTo(-118, 10); ctx.quadraticCurveTo(-110, -78, 0, -82); ctx.quadraticCurveTo(110, -78, 118, 10); ctx.quadraticCurveTo(70, 74, 0, 78); ctx.quadraticCurveTo(-70, 74, -118, 10); ctx.closePath();
  ctx.fillStyle = C.coon; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke();
  // white brows and muzzle
  ellipse(-40, -40, 30, 12, -0.2, C.coonLight); ellipse(40, -40, 30, 12, 0.2, C.coonLight);
  ellipse(0, 40, 54, 36, 0, C.coonLight);
  // mask
  ctx.beginPath(); ctx.moveTo(-108, 4); ctx.quadraticCurveTo(-80, -40, -20, -16); ctx.quadraticCurveTo(0, -6, 20, -16); ctx.quadraticCurveTo(80, -40, 108, 4); ctx.quadraticCurveTo(70, 34, 20, 14); ctx.quadraticCurveTo(0, 6, -20, 14); ctx.quadraticCurveTo(-70, 34, -108, 4); ctx.closePath();
  ctx.fillStyle = C.coonDark; ctx.fill();
  // eyes
  for (const s of [-1, 1]) {
    circle(s * 46, -2, 17, '#fff', C.ink, 3);
    circle(s * 46 + look * 6, mood === 'oops' ? -4 : 0, 8, C.ink); circle(s * 46 + look * 6 + 3, -4, 2.5, '#fff');
    if (mood === 'sneaky') { ctx.beginPath(); ctx.moveTo(s * 46 - 20, -6); ctx.quadraticCurveTo(s * 46, -24, s * 46 + 20, -6); ctx.lineTo(s * 46 + 20, -22); ctx.lineTo(s * 46 - 20, -22); ctx.closePath(); ctx.fillStyle = C.coonDark; ctx.fill(); }
  }
  if (mood === 'oops') { for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 30, -36); ctx.lineTo(s * 62, -44); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke(); } }
  // nose + mouth
  ellipse(0, 22, 15, 10, 0, C.ink);
  ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.beginPath();
  if (mood === 'sneaky') { ctx.moveTo(-22, 48); ctx.quadraticCurveTo(4, 60, 30, 40); }
  else if (mood === 'oops') { ctx.ellipse(0, 52, 10, 13, 0, 0, 7); }
  else { ctx.moveTo(-30, 42); ctx.quadraticCurveTo(0, 74, 30, 42); }
  ctx.stroke();
  if (mood === 'grin') { ctx.beginPath(); ctx.moveTo(-26, 44); ctx.quadraticCurveTo(0, 70, 26, 44); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); }
  // paws (+ prop)
  if (holding === 'pencil') { pencil(-72, 110, -1.1, .62); }
  ellipse(-70, 112, 26, 20, 0, C.coonDark, C.ink, 4); ellipse(70, 112, 26, 20, 0, C.coonDark, C.ink, 4);
  ctx.restore();
}
function sticker(x, y, rot, s, label, bg, fg = C.ink, font = '700 40px Fredoka') {
  if (s <= 0.001) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  const w = measure(label, font) + 46;
  ctx.save(); ctx.shadowColor = 'rgba(60,40,20,0.25)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6; rr(-w / 2, -36, w, 72, 36, bg); ctx.restore();
  rr(-w / 2, -36, w, 72, 36, null, C.ink, 4);
  txt(label, 0, 14, font, fg, 'center'); ctx.restore();
}
function cross(x, y, r, p) {   // red X drawn in two strokes
  ctx.save(); ctx.lineWidth = 16; ctx.strokeStyle = C.red; ctx.lineCap = 'round';
  const a = clamp(p * 2), b = clamp(p * 2 - 1);
  if (a > 0) { ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x - r + 2 * r * a, y - r + 2 * r * a); ctx.stroke(); }
  if (b > 0) { ctx.beginPath(); ctx.moveTo(x + r, y - r); ctx.lineTo(x + r - 2 * r * b, y - r + 2 * r * b); ctx.stroke(); }
  ctx.restore();
}
function tick(x, y, r, p) {   // green check mark
  if (p <= 0) return; ctx.save(); ctx.lineWidth = 18; ctx.strokeStyle = C.green; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pts = [[x - r, y], [x - r * .3, y + r * .7], [x + r, y - r * .8]]; const L1 = Math.hypot(r * .7, r * .7), L2 = Math.hypot(r * 1.3, r * 1.5), Lt = (L1 + L2) * clamp(p);
  ctx.beginPath(); ctx.moveTo(...pts[0]);
  if (Lt <= L1) ctx.lineTo(lerp(pts[0][0], pts[1][0], Lt / L1), lerp(pts[0][1], pts[1][1], Lt / L1));
  else { ctx.lineTo(...pts[1]); const k = (Lt - L1) / L2; ctx.lineTo(lerp(pts[1][0], pts[2][0], k), lerp(pts[1][1], pts[2][1], k)); }
  ctx.stroke(); ctx.restore();
}

// ---------- header, mini-map, captions ----------
function header(t, t0, n, label) {
  const p = pop(t, t0 - 0.08, 'bouncy'), q = M.spring(t, t0 - 0.16, 'smooth');
  scaled(124, 392, p, () => { circle(0, 0, 50, C.spot[n], C.ink, 5); txt(String(n + 1), 0, 20, '700 58px Fredoka', '#fff', 'center'); });
  const sz = Math.min(56, Math.floor(56 * 540 / measure(label, '600 56px Fredoka')));
  ctx.save(); ctx.globalAlpha = clamp(q * 1.4); txt(label, 192 - 40 * (1 - q), 412, `600 ${sz}px Fredoka`, C.ink); ctx.restore();
}
function headerPlain(t, t0, label, color = C.ink, y = 412, x = 510) {
  const q = M.spring(t, t0 - 0.1, 'smooth'), sz = Math.min(64, Math.floor(64 * 840 / measure(label, '700 64px Fredoka')));
  ctx.save(); ctx.globalAlpha = clamp(q * 1.4); txt(label, x, y + 36 * (1 - q), `700 ${sz}px Fredoka`, color, 'center'); ctx.restore();
}
function minimap(t, t0, cur) {
  const p = M.spring(t, t0 - 0.08, 'smooth'); if (p <= 0) return;
  ctx.save(); ctx.globalAlpha = clamp(p); ctx.translate(850, 392); ctx.scale(.17, .17); ctx.translate(-CW / 2, -CH / 2);
  rr(0, 0, CW, CH, 40, C.mint, C.mintLine, 12);
  SPOT_BOX.forEach(([x, y, w, h], k) => { rr(x, y, w, h, 24, k === cur ? C.spot[k] : 'rgba(110,156,138,0.35)'); });
  ctx.restore();
  const [x, y, w, h] = SPOT_BOX[cur], cx = 850 + (x + w / 2 - CW / 2) * .17, cy = 392 + (y + h / 2 - CH / 2) * .17;
  circle(cx, cy, 10 + 6 * M.pulse(t, 1, 5), null, C.spot[cur], 4);
}
// caption chunks: <= 4 words, break after punctuation
const CHUNKS = (() => {
  const out = [];
  TM.lines.forEach((L, li) => {
    let cur = [];
    LW[li].forEach((w, k) => {
      cur.push(w);
      const len = cur.map(x => x.w).join(' ').length, last = k === LW[li].length - 1;
      if (last || cur.length >= 4 || /[,.:?!]$/.test(w.w) && cur.length >= 2 || len > 17) { out.push(cur); cur = []; }
    });
  });
  return out.map((ws_, k, arr) => ({ words: ws_, t0: ws_[0].start - 0.05, t1: k + 1 < arr.length ? arr[k + 1][0].start - 0.05 : window.DUR + 1 }));
})();
function captions(t) {
  const ch = CHUNKS.find(c => t >= c.t0 && t < c.t1); if (!ch) return;
  const font = '700 70px Fredoka', gap = 20, y = 1120;
  const ww = ch.words.map(w => measure(w.w, font)); const total = ww.reduce((a, b) => a + b, 0) + gap * (ww.length - 1);
  let x = 510 - total / 2; const p = M.spring(t, ch.t0, 'snap');
  ch.words.forEach((w, k) => {
    const on = t >= w.start - 0.03 && (k === ch.words.length - 1 || t < ch.words[k + 1].start - 0.03);
    if (on) { const s = pop(t, w.start - 0.03, 'snap'); ctx.save(); ctx.translate(x + ww[k] / 2, y - 24); ctx.scale(s, s); rr(-ww[k] / 2 - 12, -46, ww[k] + 24, 80, 18, C.marker); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = t >= w.start - 0.03 ? 1 : 0.42;
    ctx.font = font; ctx.lineWidth = 12; ctx.strokeStyle = C.paper; ctx.lineJoin = 'round'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.strokeText(w.w, x, y + 18 * (1 - p)); txt(w.w, x, y + 18 * (1 - p), font, C.ink);
    ctx.restore(); x += ww[k] + gap;
  });
}

// ---------- cameras per shot ----------
const FULL = { cx: 500, cy: 229, s: .86, sy: 820 };
function camFor(i, t) {
  const t0 = st(i), mk = (a, b, tt, p = 'soft') => ({ cx: M.sp(t, tt, a.cx, b.cx, p), cy: M.sp(t, tt, a.cy, b.cy, p), s: M.sp(t, tt, a.s, b.s, p), sy: M.sp(t, tt, a.sy, b.sy, p) });
  const Z = (cx, cy, s, sy = 761) => ({ cx, cy, s, sy });
  switch (i) {
    case 0: return mk(FULL, { ...FULL, s: .9 }, t0);
    case 2: return mk(Z(500, 229, .9), Z(812, 122, 2.0), ws(2, 2) - 0.25, 'heavy');
    case 3: return mk(Z(336, 196, 1.48), Z(336, 196, 1.58), t0);
    case 4: return mk(Z(842, 188, 2.3), Z(842, 188, 2.48), t0);
    case 5: return mk(Z(800, 196, 1.85), Z(800, 196, 1.95), t0);
    case 6: return mk(Z(420, 250, 1.02), Z(420, 250, 1.08), t0);
    case 7: return mk(Z(450, 255, 1.0), Z(450, 255, 1.05), t0);
    case 9: return mk(Z(262, 358, 1.95), Z(262, 358, 2.05), t0);
    case 10: return mk(Z(744, 360, 1.85), Z(744, 360, 1.95), t0);
    case 13: return mk(Z(440, 400, 1.18, 720), Z(440, 400, 1.24, 720), t0);
    case 14: return mk({ ...FULL, sy: 800 }, { ...FULL, s: .9, sy: 800 }, t0);
    case 16: return mk({ ...FULL, s: .82 }, FULL, t0, 'smooth');
    default: return FULL;
  }
}
function kickCam(t, i) { return 1 + (i > 0 ? 0.022 * M.kick(t, st(i), 1, 'bouncy') : 0); }

// ---------- shots ----------
const WIN = { x: 62, y: 478, w: 896, h: 566, r: 44 };
const zoomed = i => ![0, 14, 16].includes(i);
function checkShot(t, i, opts = {}) {
  const cam = camFor(i, t), k = kickCam(t, i), win = zoomed(i);
  if (win) { ctx.save(); ctx.shadowColor = 'rgba(60,40,20,0.22)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12; rr(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r, '#FBF6EC'); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r); ctx.clip(); }
  ctx.save(); ctx.translate(510, cam.sy); ctx.scale(k, k); ctx.translate(-510, -cam.sy);
  let head = null; withCam(cam, () => { head = drawCheck(t, i, opts); if (opts.inCheck) opts.inCheck(cam); });
  if (opts.pen !== false) {
    const ps = penState(t, i, opts.rest || [500, 229]), [x, y] = toScreen(cam, ps.pos[0], ps.pos[1]);
    const e = i === 0 || i === 16 ? 1 : M.spring(t, st(i) - 0.14, 'smooth');
    pen(x + 260 * (1 - e), y + 420 * (1 - e), t, ps.down, -0.62, clamp(cam.s / 1.6, .62, 1.05));
  }
  ctx.restore();
  if (win) { ctx.restore(); rr(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r, null, C.ink, 6); }
  if (opts.screen) opts.screen(cam);
  return cam;
}
const SHOT = [];
SHOT[0] = t => {   // title + finished check, pen finishing the signature flourish (frame 1 = mid-action)
  checkShot(t, 0, { flourish: clamp(0.3 + t / 0.8), rest: [910, 404] });
  txt('How to write', 510, 400, '700 104px Fredoka', C.ink, 'center');
  txt('a check', 510, 508, '700 104px Fredoka', C.ink, 'center');
  sticker(700, 586, -0.07, 1 + 0.03 * M.pulse(t, 2, 4), "explained like you're 5", C.marker, C.ink, '700 40px Fredoka');
};
SHOT[1] = t => {   // a check is a note to your bank
  const t0 = st(1); headerPlain(t, t0, 'A check is a note to your bank');
  you(190, 900, 1.15, t); bank(510, 780, 1.2 * pop(t, t0, 'smooth')); friend(830, 900, 1.15 * pop(t, ws(1, 13), 'bouncy'), t);
  // the check flies from you into the bank, then coins fly out to the friend
  const fly = M.spring(t, ws(1, 6) - 0.2, 'smooth'), fx = lerp(330, 500, fly), fy = lerp(1000, 670, fly) - 110 * Math.sin(Math.PI * clamp(fly));
  if (fly < 0.97) miniCheck(fx, fy, lerp(250, 120, clamp(fly)), lerp(-0.12, 0.1, clamp(fly)));
  for (let k = 0; k < 4; k++) {
    const c = M.spring(t, ws(1, 11) + k * 0.12, 'smooth'); if (c <= 0) continue;
    const x = lerp(580, 800 - k * 34, clamp(c)), y = lerp(740, 1000 - k * 8, clamp(c)) - 140 * Math.sin(Math.PI * clamp(c));
    coin(x, y, 32);
  }
  if (t >= ws(1, 9) - 0.06) { const s = pop(t, ws(1, 9)); scaled(560, 486, s, () => { rr(-210, -54, 420, 92, 28, '#fff', C.ink, 4); ctx.beginPath(); ctx.moveTo(-40, 36); ctx.lineTo(-10, 70); ctx.lineTo(10, 36); ctx.fillStyle = '#fff'; ctx.fill(); txt('"Please pay them!"', 0, 8, '700 40px Caveat', C.blueInk, 'center'); }); }
  txt('You', 190, 760, '700 46px Fredoka', C.inkSoft, 'center'); if (t > ws(1, 13) - 0.06) { ctx.save(); ctx.globalAlpha = clamp(pop(t, ws(1, 13))); txt('Them', 830, 690, '700 46px Fredoka', C.inkSoft, 'center'); ctx.restore(); }
};
SHOT[2] = t => { checkShot(t, 2, { hl: [[0, ws(2, 2)]], rest: [740, 116] }); header(t, st(2), 0, "Today's date"); minimap(t, st(2), 0); };
SHOT[3] = t => { checkShot(t, 3, { hl: [[1, ws(3, 2)]], rest: [190, 196] }); header(t, st(3), 1, 'Who gets paid'); minimap(t, st(3), 1); };
SHOT[4] = t => {
  checkShot(t, 4, { hl: [[2, ws(4, 3)]], rest: [930, 200], inCheck: () => {
    const q = pop(t, ws(4, 6), 'bouncy'); if (q <= 0) return;   // squeeze arrows around the $ | 2 join
    ctx.save(); ctx.globalAlpha = clamp(q); const s = 6 * Math.sin(t * 9);
    for (const d of [-1, 1]) { ctx.save(); ctx.translate(806 + d * (34 + s), 238); ctx.scale(-d, 1); ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(10, 0); ctx.lineTo(-14, 10); ctx.lineWidth = 6; ctx.strokeStyle = C.red; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }
    txt('no gap!', 806, 268, '700 24px Fredoka', C.red, 'center'); ctx.restore();
  } });
  header(t, st(4), 2, 'Amount in numbers'); minimap(t, st(4), 2);
};
SHOT[5] = t => {   // the raccoon tries to sneak a 1 in front, and there's no room
  checkShot(t, 5, { pen: false, rest: [930, 200] });
  const inT = ws(5, 1), bonk = ws(5, 4), outT = ws(5, 9) + 0.05;
  const e = M.spring(t, inT - 0.1, 'bouncy') - M.spring(t, outT, 'smooth');
  const reach = M.spring(t, ws(5, 3), 'smooth') * (1 - M.spring(t, bonk + 0.25, 'snap'));
  const mood = t < bonk ? 'sneaky' : 'oops', shake = t > bonk ? 10 * M.kick(t, bonk, 1, 'bouncy') : 0;
  if (e > 0.004) raccoon(lerp(1460, 860, clamp(e, -0.2, 1.1)) + shake - 60 * reach, 790, .92, t, mood, -1, 'pencil');
  if (t > bonk) { const s = pop(t, bonk); sticker(470, 960, 0.05, s, 'No room!', '#fff', C.red, '700 50px Fredoka'); }
  header(t, st(5), 2, 'Amount in numbers'); minimap(t, st(5), 2);
};
SHOT[6] = t => { checkShot(t, 6, { hl: [[3, ws(6, 4)]], rest: [80, 266] }); header(t, st(6), 3, 'Amount in words'); minimap(t, st(6), 3); };
SHOT[7] = t => {
  checkShot(t, 7, { rest: [DASH.x1, DASH.y] });
  const inT = ws(7, 7) - 0.1, bonk = ws(7, 10), outT = ws(7, 11) + 0.1;
  const e = M.spring(t, inT, 'bouncy') - M.spring(t, outT, 'smooth');
  if (e > 0.004) raccoon(lerp(1460, 900, clamp(e, -0.2, 1.1)) + (t > bonk ? 8 * M.kick(t, bonk, 1) : 0), 850, .74, t, t < bonk ? 'sneaky' : 'oops', -1, 'pencil');
  header(t, st(7), 3, 'Amount in words'); minimap(t, st(7), 3);
};
SHOT[8] = t => {   // secret: the words win (seesaw)
  const t0 = st(8);
  const q = pop(t, t0 - 0.06, 'bouncy'); sticker(510, 400, -0.03, q, 'Psst... a secret', C.spot[3], '#fff', '700 50px Fredoka');
  const tip = M.spring(t, ws(8, 12) - 0.1, 'bouncy'), ang = -0.2 * tip;
  ctx.save(); ctx.translate(510, 860); ctx.scale(1.06, 1.06);
  ctx.beginPath(); ctx.moveTo(-70, 150); ctx.lineTo(0, 10); ctx.lineTo(70, 150); ctx.closePath(); ctx.fillStyle = '#FFD173'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.rotate(ang); rr(-420, -14, 840, 28, 14, '#C98B5A', C.ink, 5);
  // words card (left), numbers card (right) that disagree
  const a = pop(t, st(8) + 0.04) * (1 + 0.1 * M.kick(t, ws(8, 3), 1, 'bouncy')), b = pop(t, st(8) + 0.16) * (1 + 0.1 * M.kick(t, ws(8, 6), 1, 'bouncy'));
  scaled(-250, -100, a, () => { rr(-170, -78, 340, 156, 22, '#fff', C.ink, 5); txt('Twenty-five', 0, -14, '700 52px Caveat', C.blueInk, 'center'); txt('and 50/100', 0, 46, '700 52px Caveat', C.blueInk, 'center'); });
  scaled(250, -100, b, () => { rr(-140, -78, 280, 156, 22, '#fff', C.ink, 5); txt('$52.50', 0, 20, '700 64px Caveat', C.blueInk, 'center'); });
  ctx.restore();
  if (t > ws(8, 7) - 0.06) { const s = pop(t, ws(8, 7)); sticker(510, 600, 0, s, "Don't match!", '#fff', C.red, '700 48px Fredoka'); }
  if (t > ws(8, 14) - 0.1) { // crown on the words card
    const c = pop(t, ws(8, 14)), [cx, cy] = [510 + Math.cos(ang) * -250 - Math.sin(ang) * -100, 880 + Math.sin(ang) * -250 + Math.cos(ang) * -100 - 120];
    scaled(cx, cy, c, () => { ctx.beginPath(); ctx.moveTo(-60, 30); ctx.lineTo(-70, -30); ctx.lineTo(-30, 0); ctx.lineTo(0, -44); ctx.lineTo(30, 0); ctx.lineTo(70, -30); ctx.lineTo(60, 30); ctx.closePath(); ctx.fillStyle = C.gold; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke(); });
    sticker(300, 1000, -0.04, pop(t, ws(8, 14) + 0.12), 'Words win!', C.green, '#fff', '700 44px Fredoka');
  }
};
SHOT[9] = t => {
  checkShot(t, 9, { hl: [[4, ws(9, 3)]], rest: [130, 390] }); header(t, st(9), 4, 'Memo'); minimap(t, st(9), 4);
  sticker(330, 980, -0.06, pop(t, ws(9, 13)), 'optional', '#fff', C.spot[4], '700 44px Fredoka');
};
SHOT[10] = t => {
  checkShot(t, 10, { hl: [[5, ws(10, 3)]], rest: [600, 390] }); header(t, st(10), 5, 'Your signature'); minimap(t, st(10), 5);
  const s = pop(t, ws(10, 9) - 0.05, 'bouncy'); if (s > 0) scaled(830, 990, s, () => { circle(0, 0, 70, '#fff', C.green, 8); tick(0, 0, 36, M.spring(t, ws(10, 9), 'smooth')); });
  sticker(500, 990, 0.04, pop(t, ws(10, 9)), 'Must sign!', '#fff', C.green, '700 44px Fredoka');
};
SHOT[11] = t => {   // pen yes, pencil no; never sign it blank
  const t0 = st(11), swap = ws(11, 5) - 0.1, a = 1 - M.spring(t, swap, 'smooth'), b = M.spring(t, swap, 'smooth');
  if (a > 0.01) {
    ctx.save(); ctx.translate(-700 * (1 - a), 0);
    headerPlain(t, t0, 'Always use a pen');
    pen(330, 1010, t, 1, -0.22, 1.55 * pop(t, t0, 'bouncy')); pencil(690, 1010, 0.22, 1.55 * pop(t, t0 + 0.1, 'bouncy'));
    tick(300, 560, 70, M.spring(t, ws(11, 3) - 0.1, 'smooth')); cross(730, 560, 64, M.spring(t, ws(11, 3), 'smooth'));
    ctx.restore();
  }
  if (b > 0.01) {
    ctx.save(); ctx.translate(800 * (1 - b), 0);
    headerPlain(t, swap, 'Never sign it blank');
    ctx.save(); ctx.translate(510, 800); ctx.scale(.84, .84); ctx.translate(-CW / 2, -CH / 2); drawCheckBase(); writeText(F.sign, 1); ctx.restore();
    const s = pop(t, ws(11, 8) - 0.05, 'heavy'); if (s > 0) scaled(510, 800, s, () => { circle(0, 0, 190, null, C.red, 22); ctx.save(); ctx.rotate(-0.78); rr(-190, -11, 380, 22, 11, C.red); ctx.restore(); });
    ctx.restore();
  }
};
SHOT[12] = t => {   // ...that's like handing the raccoon your piggy bank
  const t0 = st(12); headerPlain(t, t0, 'Never sign it blank');
  const grab = ws(11, 12), run = ws(11, 16);
  const e = M.spring(t, t0 - 0.1, 'bouncy'), go = M.spring(t, run, 'soft');
  const px = lerp(400, 1150, clamp(go, 0, 1.2)), hop = 18 * Math.abs(Math.sin(t * 14)) * clamp(go * 3);
  piggy(px + (t < grab ? -120 * (1 - e) : 0) - 60, 900 - hop - 50 * M.spring(t, grab, 'bouncy') * (1 - go), 1.45, t);
  raccoon(lerp(1200, 780, clamp(e)) + 640 * clamp(go, 0, 1.2), 840 - hop, 1.25, t, t < grab ? 'sneaky' : 'grin', -1);
  for (let k = 0; k < 3; k++) { const c = M.spring(t, run + 0.1 + k * 0.1, 'smooth'); if (c > 0 && c < 1.05) coin(lerp(px - 60, px - 220 - k * 60, clamp(c)), 780 - 160 * Math.sin(Math.PI * clamp(c)) + k * 10, 24, clamp(2 - 2 * c)); }
  sticker(510, 600, -0.04, pop(t, ws(11, 16) + 0.1), 'Bye-bye money!', '#fff', C.red, '700 46px Fredoka');
};
SHOT[13] = t => {   // the bottom numbers
  const glow = [M.spring(t, ws(12, 8) - 0.1, 'smooth'), M.spring(t, ws(12, 12) - 0.1, 'smooth'), M.spring(t, ws(12, 13) + 0.2, 'smooth')];
  const cam = checkShot(t, 13, { pen: false, inCheck: () => micr(1, glow.map(g => clamp(g))) });
  headerPlain(t, st(13), 'The numbers at the bottom');
  const labels = [["Bank's name tag", 0], ['Your account', 1], ['Check #', 2]];
  labels.forEach(([s, k]) => {
    const g = glow[k]; if (g <= 0.01) return;
    const mx = MICR[k][1] + measure(MICR[k][0], '500 25px "JetBrains Mono"') / 2, [x, y] = toScreen(cam, mx, 470);
    const yy = y + 50 + 70 * (k % 2);
    ctx.save(); ctx.globalAlpha = clamp(g); line(x, y - 6, x, yy - 40, 4, C.ink);
    txt(s, clamp(x, 170, 860), yy, '700 40px Fredoka', C.ink, 'center'); ctx.restore();
  });
  const tp = M.spring(t, ws(12, 14) - 0.08, 'bouncy');   // "leave them alone" tape
  if (tp > 0) { ctx.save(); ctx.translate(510 + 700 * (1 - tp), 1000); ctx.rotate(-0.06); ctx.beginPath(); ctx.rect(-560, -40, 1120, 80); ctx.clip();
    ctx.fillStyle = C.marker; ctx.fillRect(-560, -40, 1120, 80); ctx.fillStyle = C.ink; for (let x = -560; x < 560; x += 70) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x + 34, 40); ctx.lineTo(x + 74, -40); ctx.lineTo(x + 40, -40); ctx.fill(); }
    rr(-200, -30, 400, 60, 14, C.marker); txt('Leave them alone', 0, 14, '700 40px Fredoka', C.ink, 'center'); ctx.restore(); }
};
SHOT[14] = t => {   // recap: six spots
  const cam = checkShot(t, 14, { pen: false, screen: c => {
    SPOT_BOX.forEach(([x, y, w, h], k) => {
      const s = pop(t, st(14) + 0.05 + k * 0.121, 'bouncy'), wig = t > ws(13, 8) ? 0.12 * Math.sin(t * 10 + k) : 0;
      const [sx, sy] = toScreen(c, k === 2 ? x + w / 2 : x - 4, k === 2 ? y - 12 : y + 4);
      scaled(sx, sy, s, () => { ctx.rotate(wig); circle(0, 0, 34, C.spot[k], C.ink, 4); txt(String(k + 1), 0, 14, '700 40px Fredoka', '#fff', 'center'); });
    });
  } });
  headerPlain(t, st(14), '6 spots. You did it!', C.ink, 400);
  if (t > ws(13, 8) - 0.06) sticker(510, 548, 0.03, pop(t, ws(13, 8)), 'Which one was new?', C.marker, C.ink, '700 46px Fredoka');
};
SHOT[15] = t => {   // follow card
  const t0 = st(15), p = pop(t, t0 - 0.06, 'smooth');
  scaled(510, 760, p, () => {
    ctx.save(); ctx.shadowColor = 'rgba(60,40,20,0.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; rr(-400, -300, 800, 600, 50, '#fff'); ctx.restore();
    rr(-400, -300, 800, 600, 50, null, C.ink, 5);
    circle(-250, -170, 70, C.spot[2], C.ink, 5); txt('∞', -250, -140, '700 92px Fredoka', '#fff', 'center');
    txt('Infinite How To', -150, -150, '700 62px Fredoka', C.ink);
    txt('Grown-up stuff,', 0, 0, '700 72px Fredoka', C.ink, 'center');
    txt("explained like you're 5", 0, 86, '700 58px Fredoka', C.spot[3], 'center');
    const b = 1 - 0.08 * M.kick(t, ws(14, 0) + 0.15, 1, 'bouncy');
    scaled(0, 200, b, () => { rr(-150, -46, 300, 92, 46, C.red, C.ink, 5); txt('Follow', 0, 18, '700 50px Fredoka', '#fff', 'center'); });
  });
  const rc = M.spring(t, ws(14, 4) - 0.1, 'bouncy'); if (rc > 0.004) raccoon(lerp(1400, 905, rc), 930, .72, t, 'grin', -1);
};
SHOT[16] = t => {   // loop back to the opening frame
  checkShot(t, 16, { flourish: 0, rest: [580, 408] });
  const q = M.spring(t, st(16) - 0.1, 'smooth');
  ctx.save(); ctx.globalAlpha = clamp(q * 1.3);
  txt('How to write', 510, 400 + 40 * (1 - q), '700 104px Fredoka', C.ink, 'center');
  txt('a check', 510, 508 + 40 * (1 - q), '700 104px Fredoka', C.ink, 'center'); ctx.restore();
  sticker(700, 586, -0.07, pop(t, st(16) + 0.3, 'bouncy'), "explained like you're 5", C.marker, C.ink, '700 40px Fredoka');
};

window.render = function (t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(PAPER, 0, 0);
  const i = shotOf(t); SHOT[i](t);
  captions(t);
};
window.post = function (t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(VIG, 0, 0);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .06; ctx.drawImage(grain[((Math.floor(t * 24) % 6) + 6) % 6], 0, 0, W, H); ctx.restore();
};

// ---------- event sound effects, from the same timeline ----------
(() => {
  const E = [], add = (t, kind, gain = .5, dur) => { if (t >= 0 && t < window.DUR) E.push(dur ? { t, kind, gain, dur } : { t, kind, gain }); };
  for (const n of ['date', 'payee', 'amt', 'memo', 'sign']) add(F[n].t0, 'scratch', .55, F[n].t1 - F[n].t0);
  add(F.words.t0, 'scratch', .55, F.words.t1 - F.words.t0); add(DASH.t0, 'scratch', .45, DASH.t1 - DASH.t0);
  add(0, 'scratch', .4, .5);                                          // flourish under the opening frame
  [2, 3, 4, 6, 9, 10].forEach((i, k) => { add(st(i) - 0.04, 'pop', .5); });   // header badges
  add(ws(2, 2), 'pop', .35); add(ws(3, 2), 'pop', .35); add(ws(4, 3), 'pop', .35); add(ws(6, 4), 'pop', .35); add(ws(9, 3), 'pop', .35); add(ws(10, 3), 'pop', .35);
  add(ws(4, 6), 'tick', .5);                                          // squeeze arrows
  add(ws(1, 6) - 0.2, 'slide', .5); add(ws(1, 9), 'pop', .45); for (let k = 0; k < 4; k++) add(ws(1, 11) + k * 0.12 + 0.25, 'tick', .55); add(ws(1, 13), 'pop', .4);
  add(ws(5, 1) - 0.1, 'boing', .5); add(ws(5, 4), 'thud', .8); add(ws(5, 4) + 0.02, 'pop', .4); add(ws(5, 9) + 0.05, 'slide', .4);
  add(ws(7, 7) - 0.1, 'boing', .45); add(ws(7, 10), 'thud', .7); add(ws(7, 11) + 0.1, 'slide', .35);
  add(st(8) - 0.04, 'pop', .5); add(st(8) + 0.04, 'pop', .35); add(st(8) + 0.16, 'pop', .35); add(ws(8, 3), 'tick', .4); add(ws(8, 6), 'tick', .4); add(ws(8, 7), 'thud', .45); add(ws(8, 12) - 0.1, 'thud', .7); add(ws(8, 14), 'sparkle', .45);
  add(ws(9, 13), 'pop', .45);
  add(ws(10, 9) - 0.05, 'knock', .6); add(ws(10, 9), 'pop', .35);
  add(st(11), 'pop', .4); add(st(11) + 0.1, 'pop', .4); add(ws(11, 3) - 0.1, 'sparkle', .3); add(ws(11, 3), 'thud', .45);
  add(ws(11, 5) - 0.1, 'slide', .4); add(ws(11, 8) - 0.05, 'knock', .7);
  add(st(12) - 0.1, 'boing', .45); add(ws(11, 12), 'pop', .4); add(ws(11, 16), 'slide', .5); for (let k = 0; k < 3; k++) add(ws(11, 16) + 0.1 + k * 0.1, 'tick', .5);
  add(ws(12, 8) - 0.1, 'pop', .35); add(ws(12, 12) - 0.1, 'pop', .35); add(ws(12, 13) + 0.2, 'pop', .35); add(ws(12, 14) - 0.08, 'slide', .5);
  for (let k = 0; k < 6; k++) add(st(14) + 0.05 + k * 0.121, 'pop', .4); add(ws(13, 5), 'sparkle', .45); add(ws(13, 8), 'pop', .45);
  add(st(15) - 0.06, 'pop', .45); add(ws(14, 0) + 0.15, 'knock', .35); add(ws(14, 4) - 0.1, 'slide', .35); add(ws(14, 4), 'boing', .4);
  add(st(16) - 0.1, 'slide', .4); add(st(16) + 0.3, 'pop', .4);
  window.CUES = {
    chords: [[36, 48, 55, 64, 67], [43, 55, 62, 67, 71], [45, 57, 64, 67, 72], [41, 53, 60, 65, 69]],
    drums_gain: 0.5, cut_gain: 0.4, riser: false, sfx_gain: 0.55, sfx: E.sort((a, b) => a.t - b.t),
  };
})();
