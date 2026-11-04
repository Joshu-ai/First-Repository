'use strict';
// Puffcodes (public/puffcode.js): the link they hold, the knock-out Puff sits
// in (never on a finder, timing, format or version module, and within the
// error budget of every block), and the art. That real readers decode them
// is proven by test/puffcode-scan.py (OpenCV), which this suite cannot run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const window = { URL, TextEncoder };
  window.window = window;
  const ctx = vm.createContext(window);
  for (const f of ['mascot.js', 'avatar.js', 'qr.js', 'puffcode.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx, { filename: f });
  }
  return window;
}
const W = load();
const P = W.PoofPuffcode;
const QR = W.PoofQR;
const AVATAR = { expr: 4, face: 1, skin: 2, eyeColor: 3, hair: 3, hairColor: 4, beard: 0, acc: 2, shirt: 5, bg: 1 };

test('links: <origin>/add/<username>, read back only for this server', () => {
  assert.equal(P.url('ava', 'https://poof.app'), 'https://poof.app/add/ava');
  assert.equal(P.url('ava', 'https://poof.app/'), 'https://poof.app/add/ava');
  assert.equal(P.parse('https://poof.app/add/ava', 'poof.app'), 'ava');
  assert.equal(P.parse('https://poof.app/add/Ava/', 'poof.app'), 'ava', 'any case, trailing slash');
  assert.equal(P.parse('http://poof.app/add/ava?from=code', 'poof.app'), 'ava');
  assert.equal(P.parse('https://poof.app/add/ava', 'other.example'), null, 'a username on another server is someone else');
  for (const bad of ['https://poof.app/add/', 'https://poof.app/add/ab', 'https://poof.app/add/a%20b', 'https://poof.app/add/a/b',
    'https://poof.app/ava', 'javascript:alert(1)//poof.app/add/ava', 'not a link', 'https://poof.app/add/%E0%A4%A']) {
    assert.equal(P.parse(bad, 'poof.app'), null, bad);
  }
});

// every module a reader needs to find and read the code, by position alone
function structural(version) {
  const n = version * 4 + 17;
  const centres = QR.alignmentCentres(version);
  return (x, y) => {
    const corner = (x < 9 && y < 9) || (x >= n - 8 && y < 9) || (x < 9 && y >= n - 8); // finders, separators, format
    const timing = x === 6 || y === 6;
    const versionInfo = version >= 7 && ((x >= n - 11 && x < n - 8 && y < 6) || (y >= n - 11 && y < n - 8 && x < 6));
    const outer = [centres[0], centres[centres.length - 1]];
    const edgeAlignment = centres.length > 0 && centres.some((ax) => centres.some((ay) =>
      (outer.includes(ax) || outer.includes(ay)) && Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2));
    return corner || timing || versionInfo || edgeAlignment;
  };
}

test('the knock-out never touches what readers need and stays within budget', () => {
  for (const version of [...Array(15).keys()].map((i) => i + 1).concat([40])) {
    const width = P.puffWidth(version);
    const L = QR.layout(version, 'H');
    if (!width) continue; // too small for Puff: plan() steps up to a bigger version
    const share = width / L.size;
    assert.ok(share >= P.MIN_SIZE - 1e-9 && share <= P.MAX_SIZE + 1e-9, `version ${version}: Puff is ${share.toFixed(2)} of the code`);
    const cleared = P.knockout(L.size, width);
    const isStructural = structural(version);
    const perBlock = new Array(L.blocks).fill(0);
    const touched = new Set();
    cleared.forEach((row, y) => row.forEach((hit, x) => {
      if (!hit) return;
      assert.ok(!isStructural(x, y), `version ${version}: Puff covers ${x},${y}, which readers need`);
      const cw = L.cells[y][x];
      if (cw >= 0 && !touched.has(cw)) { touched.add(cw); perBlock[L.blockOf[cw]]++; }
    }));
    // level H repairs floor(ec / 2) wrong codewords per block; Puff may use two thirds of that
    const budget = Math.floor(Math.floor(L.ecPerBlock / 2) * P.BUDGET);
    assert.ok(Math.max(...perBlock) <= budget, `version ${version}: worst block loses ${Math.max(...perBlock)} codewords, budget ${budget}`);
    assert.ok(touched.size > 0, `version ${version}: the knock-out is real`);
  }
});

test('typical links make a version 6 or bigger code with a good-sized Puff', () => {
  for (const link of ['https://poof.app/add/ava', 'http://localhost:3000/add/abcdefghijklmnopqrst',
    'https://a-much-longer-poof-host.example.com/add/puff.fan_2026']) {
    const plan = P.plan(link);
    assert.ok(plan.qr.version >= 6, `${link}: version ${plan.qr.version}`);
    assert.equal(plan.qr.ecl, 'H');
    assert.ok(plan.width / plan.qr.size >= P.MIN_SIZE - 1e-9);
    // the code holds the link: it is the encoder's own matrix for that text, at that version
    assert.equal(JSON.stringify(plan.qr.modules), JSON.stringify(QR.encode(link, { minVersion: plan.qr.version }).modules));
  }
});

// every open tag is closed in order
function balanced(markup) {
  const stack = [];
  for (const [, close, name, selfClose] of markup.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>/g)) {
    if (selfClose) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0;
}

test('the art: violet tile, a dot per dark module, rounded finders, Puff in the middle', () => {
  const link = 'https://poof.app/add/ava';
  const plan = P.plan(link);
  const n = plan.qr.size;
  const svg = P.svg({ url: link, username: 'ava', avatar: AVATAR, size: 300 });
  assert.ok(balanced(svg), 'well-formed markup');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 (\d+) \1" width="300" height="300" role="img" aria-label="Puffcode for @ava"/);
  assert.equal(Number(svg.match(/viewBox="0 0 (\d+)/)[1]), n + 2 * P.QUIET, 'a quiet zone round the code');
  assert.match(svg, /<rect width="\d+" height="\d+" rx="[\d.]+" fill="#6d4cff"\/>/, 'brand-violet rounded tile');
  const inFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  let expected = 0;
  plan.qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark && !inFinder(x, y) && !plan.cleared[y][x]) expected++; }));
  const dots = svg.match(/<path d="([^"]*)" fill="#ffffff"\/>/)[1];
  assert.equal((dots.match(/M/g) || []).length, expected, 'one white dot per dark data module outside Puff');
  assert.equal((dots.match(/a0\.5 0\.5 0 1 0 1 0/g) || []).length, expected, 'every dot is round');
  const finders = svg.match(/<path d="([^"]*)" fill="#ffffff" fill-rule="evenodd"\/>/)[1];
  assert.equal((finders.match(/M/g) || []).length, 9, 'three finders, three rounded squares each');
  // with an avatar: the avatar art, clipped to Puff's outline, on its own background colour
  assert.ok(svg.includes(`<clipPath id="`) && svg.includes(W.mascotCloud.path), 'clipped to Puff');
  assert.ok(svg.includes(`fill="${W.PoofAvatar.PARTS.bg[AVATAR.bg]}"`), 'the avatar background fills the window');
  assert.ok(svg.includes('viewBox="0 0 200 200"'), 'the avatar art is inside');
});

test('no avatar (or a broken one): Puff\'s own face instead; labels are escaped', () => {
  for (const avatar of [null, { ...AVATAR, hair: 99 }, 'nonsense']) {
    const svg = P.svg({ url: 'https://poof.app/add/ben', username: 'ben', avatar });
    assert.ok(!svg.includes('viewBox="0 0 200 200"'), 'no avatar art');
    assert.match(svg, /<mask id="pf\d+k"/, 'the solid Puff mark with its face knocked out');
    assert.ok(balanced(svg));
  }
  const svg = P.svg({ url: 'https://poof.app/add/ben', label: 'Ben\'s "code" <b>&' });
  assert.ok(svg.includes('aria-label="Ben&#39;s &#34;code&#34; &#60;b&#62;&#38;"'), 'label escaped');
  assert.throws(() => P.svg({ url: 'x'.repeat(2000) }), /too long for a Puffcode/);
});
