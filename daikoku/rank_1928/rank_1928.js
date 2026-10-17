// Daikoku · $100 invested in 1928, ranked best to worst by its value at the end of 2025.
// Values: Damodaran, "Historical Returns on Stocks, Bonds, Bills, Real Estate and Gold" (NYU Stern, Jan 2026 update, 1928-2025),
// as copied by economics.mba, The College Investor and FinanceWonk (the NYU file was unreachable from the studio).
// Inflation: BLS CPI-U annual averages, 1928 (17.1) and 2025 (321.943). Crash years: Damodaran annual S&P 500 returns incl. dividends.
'use strict';
const LN = D.lines, DUR = D.duration;
const Ls = i => LN[i].start;
const raw = w => w.replace(/[.,?!:]+$/, '').toLowerCase();
const wt = (word, line = 0, which = 'start') => { const w = D.words.find(w => w.line >= line && raw(w.w) === word); return w ? w[which] : Ls(line); };
const CH = buildChunks(D.words);
const num = n => n.toLocaleString('en-US');
const ex = k => k >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(k));          // exponential ease-out
// counters step through round figures (never a precise-looking number that isn't data), whole dollars below $1M, then $1.00M-style
const sig = (v, n) => { if (v < 100) return Math.round(v); const p = Math.pow(10, Math.floor(Math.log10(v)) - n + 1); return Math.round(v / p) * p; };
const money = v => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : '$' + num(v);
const target = lab => parseFloat(lab.replace(/[$,M+]/g, '')) * (lab.includes('M') ? 1e6 : 1);   // counters land on the shown figure

// ---------- data ----------
// v = value of $100 from the start of 1928 to the end of 2025 (bar length); lab = the figure shown.
// Rounded on screen because the figures are secondary copies; where copies disagree the label holds under both
// (S&P 500: $1,157,009 or $1,157,599 -> $1.16M; 10-year T-bonds: $7,718 or $7,753 -> $7,700+).
const RANK = [
  { name: 'S&P 500', v: 1157009, lab: '$1.16M' },
  { name: 'Corporate bonds', v: 53952, lab: '$54,000' },
  { name: 'Gold', v: 21025, lab: '$21,000' },
  { name: 'Treasury bonds', v: 7718, lab: '$7,700+' },
  { name: 'Home prices, no rent', v: 5626, lab: '$5,600' },
  { name: 'Treasury bills', v: 2578, lab: '$2,600' },
  { name: 'Cash in a drawer', v: 100, lab: '$100' },
];
const SP_RATE = '10.0%';         // S&P 500 compounded annual return, 1928-2025 (10.02%)
const INFL = 1883;               // $100 of 1928 money in 2025 dollars: 100 x 321.943 / 17.1
const BUYS = 5.31;               // what $100 buys today, in 1928 dollars: 100 x 17.1 / 321.943
const CRASH = [[1929, -8.30], [1930, -25.12], [1931, -43.84], [1932, -8.64]];

let T = {};
window.init = function () {
  T = {
    b: Ls(1) - .1, h: Ls(7) - .1, i: Ls(8) - .1, j: Ls(9) - .1,
    stocks: wt('stocks', 0), y1928: wt('1928', 0), grew: wt('became', 0),
    names: [Ls(1) - 1, wt('corporate', 1), wt('gold', 2), wt('treasury', 3), wt('home', 4), wt('treasury', 5), wt('cash', 6)],
    nums: [Ls(1) - 1, wt('$54,000', 1), wt('$21,000', 2), wt('$7,700', 3), wt('$5,600', 4), wt('$2,600', 5), wt('$100', 6)],
    drawer: wt('drawer', 6), five: wt('$5', 6),
    fall: wt('stocks', 7), pct: wt('44%', 7), y1931: wt('1931', 7),
    held: wt('held', 8), sold: wt('sold', 8), c100: wt('$100', 9),
  };
  T.land = T.grew + 1.3; T.d = T.five - .15;
  const roll = Array.from({ length: 12 }, (_, i) => T.grew + .05 + i * .1);
  window.EVENTS = {
    hit: [0, T.pct], whoosh: [T.b + .1, T.d, T.h + .1, T.i + .1, T.j + .1],
    tick: roll.concat([T.y1928], T.nums.slice(1), CRASH.map((_, i) => T.fall + i * .14), [T.c100]),
    chime: [T.land], chime_hz: 880, shimmer: [[T.land - .2, T.land + .9]], riser: [[DUR - 1.1, DUR]],
  };
};

// scene timeline with out-then-in fades: the old scene clears before the new one draws, so text never stacks on text
function runSeq(t, scenes, half = .2) {
  for (const s of scenes) {
    const a = Math.min(inv(s.t0, s.t0 + half, t), 1 - inv(s.t1 - half, s.t1, t));
    if (a <= 0) continue;
    ctx.save(); ctx.globalAlpha = 1;
    if (a < 1) { const L = layer(); L.x.clearRect(0, 0, W, H); const prev = swap(L.x); s.draw(t); swap(prev); ctx.globalAlpha = a; ctx.drawImage(L.c, 0, 0); }
    else s.draw(t);
    ctx.restore();
  }
}

// ---------- icons: one 5 px stroke family ----------
function stroke(fn, { color = DK.ink, w = 5, a = 1 } = {}) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath(); fn(); ctx.stroke(); ctx.restore(); }
// a generic banknote: border, inner frame, blank oval; flip turns it about its vertical axis (0..1 = half a turn, same face either end)
function bill(cx, cy, w, h, { color = DK.ink, w: lw = 5, a = 1, flip = 0, label = '', plain = false } = {}) {
  if (a <= 0) return;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(.03, Math.abs(Math.cos(flip * Math.PI))), 1);
  stroke(() => { ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(18, h * .14)); }, { color, w: lw, a });
  if (!plain) {
    if (h > 90) stroke(() => { ctx.roundRect(-w / 2 + 18, -h / 2 + 18, w - 36, h - 36, 8); }, { color, w: 2, a: a * .5 });
    stroke(() => { ctx.ellipse(0, 0, h * .2, h * .26, 0, 0, Math.PI * 2); }, { color, w: Math.min(lw * .8, h * .06), a });
    if (label) for (const [x, y] of [[-w / 2 + 62, -h / 2 + 46], [w / 2 - 62, h / 2 - 46]]) dtext(label, x, y, 34, { color, a, shadow: false });
  }
  ctx.restore();
}
// a light band sweeping across a text's fill as it lands
function sweepFill(t, t0, t1, base) {
  const sw = inv(t0, t1, t);
  if (sw <= 0 || sw >= 1) return base;
  const sx = lerp(60, 1020, E.io(sw)), g = ctx.createLinearGradient(sx - 140, 0, sx + 140, 0);
  g.addColorStop(0, base); g.addColorStop(.5, '#FFF1CC'); g.addColorStop(1, base); return g;
}

// 1 · hero: $100 compounding into $1.16M (the counter runs along a log path, like compounding)
// g = roll start, fl = bill flip (the loop's last line replays the flip; it ends on the face it started on)
function sceneHook(t, g, fl) {
  const k = E.io(inv(g, g + 1.3, t)), land = g + 1.3, goal = target(RANK[0].lab);
  const big = k >= 1 ? RANK[0].lab : money(sig(100 * Math.pow(goal / 100, k), 3));
  const before = 1 - ex(inv(g - .05, g + .25, t)), after = ex(inv(g + .1, g + .45, t));
  ltext('Put into the S&P 500 in 1928', 540, 512, { size: DK.size.label, color: DK.ink, a: before });
  ltext('$100 in 1928 became', 540, 512, { size: DK.size.label, color: DK.ink, a: after });
  dtext(big, 540, 650, DK.size.big, { color: sweepFill(t, land - .2, land + .6, DK.gold), tab: true });
  ltext('U.S. large stocks, dividends reinvested', 540, 760, { size: DK.size.small, a: ex(inv(T.stocks - .1, T.stocks + .3, t)) * before });
  ltext('by the end of 2025, dividends reinvested', 540, 760, { size: DK.size.small, a: after });
  // before the roll: the $100 bill and its year
  const ba = 1 - ex(inv(g, g + .3, t)), ck = ex(inv(T.y1928 - .15, T.y1928 + .25, t)) * ba;
  bill(540, 950, 400, 190, { color: DK.ink2, a: ba, flip: E.io(clamp((t - fl) / .6)), label: '100' });
  if (ck > 0) { panel(470, 1074, 140, 56, { r: 28, a: ck, stroke: 'rgba(243,235,216,.5)', lw: 2 }); ltext('1928', 540, 1102, { size: 30, color: DK.ink, a: ck, weight: 700 }); }
  // as it rolls: the span and the rate
  const p = ex(inv(g + .4, g + .8, t)), q = ex(inv(g + .7, g + 1.1, t));
  if (p > 0) {
    panel(110, 870, 840, 220, { a: p, stroke: 'rgba(243,235,216,.22)', lw: 2 });
    line([[530, 905], [530, 1055]], { color: DK.rule, w: 2, a: p });
    dtext('98 years', 320, 950, DK.size.stat, { a: p, shadow: false });
    ltext('1928 through 2025', 320, 1022, { size: DK.size.small, a: p });
    dtext(SP_RATE, 740, 950, DK.size.stat, { a: q, shadow: false });
    ltext('a year, compounded', 740, 1022, { size: DK.size.small, a: q });
  }
}

// 2 · the ladder: every choice, best to worst, on a log scale from $100
const RX = 470, RW = 430, LO = 2, HI = Math.log10(1.2e6);
const bx = v => RX + RW * (Math.log10(v) - LO) / (HI - LO);
const RY = i => 500 + i * 92;
function axis() {
  for (const [v, s] of [[100, '$100'], [1e3, '$1K'], [1e4, '$10K'], [1e5, '$100K'], [1e6, '$1M']]) {
    line([[bx(v), 476], [bx(v), 1100]], { color: DK.rule, w: 1.2 });
    ltext(s, bx(v), 1126, { size: DK.size.tick, color: DK.ink3, weight: 500 });
  }
  ltext('Log scale: each line is 10× · rounded', 950, 1164, { size: 28, color: DK.ink2, weight: 500, align: 'right' });
}
// the name lands on its word, then the bar grows on the figure's word
function row(i, t, aName, aNum) {
  const r = RANK[i], y = RY(i), on = ex(inv(aName - .2, aName + .15, t)), bo = ex(inv(aNum - .3, aNum, t)), k = ex(inv(aNum - .25, aNum + .45, t));
  if (on <= 0) return;
  const last = i === RANK.length - 1, col = i === 0 ? DK.gold : last ? DK.loss : '#9A9E90';   // solid, so the inflation line passes behind
  dtext(String(i + 1), 92, y + 2, 40, { color: i === 0 ? DK.gold : DK.ink2, a: on, shadow: false, tab: true });
  ltext(r.name, 126, y, { size: 30, color: last ? DK.loss : DK.ink, a: on, align: 'left', weight: i === 0 ? 700 : 600 });
  if (bo <= 0) return;
  const v = k >= 1 ? r.v : Math.pow(10, LO + (Math.log10(r.v) - LO) * k), x = Math.max(RX + 34, bx(v));
  ctx.save(); ctx.globalAlpha *= bo; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(RX, y - 17, x - RX, 34, 17); ctx.fill(); ctx.restore();
  const s = k >= 1 ? r.lab : money(sig(Math.pow(10, LO + (Math.log10(target(r.lab)) - LO) * k), 2));
  if (bx(r.v) > 780) dtext(s, x - 18, y + 2, 30, { color: '#1C1407', a: bo, align: 'right', shadow: false, tab: true });
  else dtext(s, x + 14, y + 2, 34, { color: last ? DK.loss : DK.ink, a: bo, align: 'left', shadow: false, tab: true });
}
function sceneLadder(t) {
  axis();
  const ia = ex(inv(T.drawer - .1, T.drawer + .4, t)), xi = bx(INFL);
  if (ia > 0) {
    // the line breaks behind the last row's label
    line([[xi, 476], [xi, RY(6) - 28]], { color: DK.ink2, w: 3, a: ia, dash: [10, 10] });
    line([[xi, RY(6) + 28], [xi, 1100]], { color: DK.ink2, w: 3, a: ia, dash: [10, 10] });
    ltext(`Just keeping up with prices: $${num(INFL)}`, xi, 452, { size: 28, color: DK.ink2, a: ia, weight: 700 });
  }
  RANK.forEach((_, i) => row(i, t, T.names[i], T.nums[i]));
}

// 3 · the drawer: still $100, but it buys what $5.31 did in 1928 (bill area drawn to scale)
function sceneDrawer(t) {
  ltext('Cash kept in a drawer since 1928', 540, 512, { size: DK.size.label, color: DK.ink });
  const k = E.io(inv(T.five - .05, T.five + .5, t)), sc = lerp(1, Math.sqrt(BUYS / 100), k);
  const BW = 400, BH = 190, cy = 760;
  bill(540, cy, BW, BH, { color: 'rgba(243,235,216,.24)', w: 3, plain: true });
  ctx.save(); ctx.fillStyle = 'rgba(238,94,82,.2)'; ctx.globalAlpha = k; ctx.beginPath(); ctx.roundRect(540 - BW * sc / 2, cy - BH * sc / 2, BW * sc, BH * sc, 8); ctx.fill(); ctx.restore();
  bill(540, cy, BW * sc, BH * sc, { color: k > .5 ? DK.loss : DK.ink, w: k > .5 ? 4 : 5, label: k < .3 ? '100' : '' });
  const f = ex(inv(T.five + .15, T.five + .5, t));
  dtext(`$${BUYS.toFixed(2)}`, 540, 990, DK.size.stat, { color: DK.loss, a: f });
  ltext('of 1928 buying power', 540, 1062, { size: DK.size.small, color: DK.ink, a: f });
}

// 4 · the other side: four losing years in a row, 1929-1932 (bars to scale)
function sceneCrash(t) {
  ltext('S&P 500, year by year', 540, 512, { size: DK.size.label, color: DK.ink });
  const p = ex(inv(T.pct - .2, T.pct + .25, t));
  dtext('−43.84%', 540, 620, 120, { color: DK.loss, a: p });
  ltext('in 1931 alone', 540, 712, { size: DK.size.small, color: DK.ink, a: ex(inv(T.y1931 - .2, T.y1931 + .2, t)) });
  const base = 800, s = 6.6, bw = 130, gap = 46, x0 = 510 - (4 * bw + 3 * gap) / 2;
  line([[x0 - 20, base], [x0 + 4 * bw + 3 * gap + 20, base]], { color: DK.ink3, w: 2 });
  CRASH.forEach(([yr, r], i) => {
    const x = x0 + i * (bw + gap), k = ex(inv(T.fall + i * .14, T.fall + i * .14 + .5, t)), h = -r * s * k, hot = yr === 1931;
    ltext(String(yr), x + bw / 2, base - 26, { size: DK.size.tick, color: hot ? DK.ink : DK.ink3, weight: 600 });
    ctx.save(); ctx.globalAlpha = hot ? 1 : .55; ctx.fillStyle = DK.loss; ctx.beginPath(); ctx.roundRect(x, base + 4, bw, Math.max(0, h), [0, 0, 10, 10]); ctx.fill(); ctx.restore();
    ltext(`${r.toFixed(2).replace('-', '−')}%`, x + bw / 2, base + 4 + h + 30, { size: 28, color: hot ? DK.loss : DK.ink2, a: ex(inv(.6, 1, k)), weight: 700 });
  });
}

// 5 · the question: two neutral answers, each lit on its word
function sceneAsk(t) {
  const hk = ex(inv(T.held - .15, T.held + .25, t)), sk = ex(inv(T.sold - .15, T.sold + .25, t));
  ltext('Through four losing years in a row?', 510, 640, { color: DK.ink });
  for (const [x, lab, k] of [[300, 'Held on', hk], [720, 'Sold', sk]]) {
    panel(x - 190, 740, 380, 200, { stroke: `rgba(243,235,216,${.3 + .55 * k})`, lw: 2 + 2 * k, a: .6 + .4 * k });
    dtext(lab, x, 840, 64, { color: DK.ink, a: .55 + .45 * k, shadow: false });
  }
}

window.render = function (t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  dkBackground(t);
  runSeq(t, [
    { t0: -1, t1: T.b, draw: tt => sceneHook(tt, T.grew, T.y1928) },
    { t0: T.b, t1: T.d, draw: tt => sceneLadder(tt) },
    { t0: T.d, t1: T.h, draw: tt => sceneDrawer(tt) },
    { t0: T.h, t1: T.i, draw: tt => sceneCrash(tt) },
    { t0: T.i, t1: T.j, draw: tt => sceneAsk(tt) },
    { t0: T.j, t1: DUR + 9, draw: tt => sceneHook(tt - DUR, T.grew, T.c100 - DUR) },
  ]);
  dkHeader(t);
  captions(t, CH, { y: 1262, size: DK.size.caption });
  finish(t);
};
