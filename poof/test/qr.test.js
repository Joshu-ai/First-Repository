'use strict';
// The QR Code encoder (public/qr.js), checked against the spec and against an
// independent encoder. test/fixtures/qr-reference.json holds matrices made by
// the Python "qrcode" package at level H with the same mask our encoder picks:
//   pip install qrcode
//   q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, mask_pattern=MASK, border=0)
//   q.add_data(qrcode.util.QRData(TEXT.encode(), mode=qrcode.util.MODE_8BIT_BYTE)); q.make(fit=True)
//   rows = [''.join('1' if c else '0' for c in row) for row in q.get_matrix()]
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const QR = require('../public/qr');

const rows = (modules) => modules.map((r) => r.map((d) => (d ? '1' : '0')).join(''));

test('matches the Python qrcode package bit for bit (level H, same mask)', () => {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qr-reference.json'), 'utf8'));
  assert.ok(ref.codes.some((c) => c.version >= 7), 'one fixture is big enough to carry version information');
  for (const code of ref.codes) {
    const mine = QR.encode(code.text);
    assert.equal(mine.ecl, 'H');
    assert.equal(mine.version, code.version, `${code.text}: version`);
    assert.equal(mine.mask, code.mask, `${code.text}: the mask our penalty score picks`);
    assert.equal(mine.size, code.rows.length);
    assert.deepEqual(rows(mine.modules), code.rows, `${code.text}: every module`);
  }
});

test('picks the smallest version that fits, up to version 10 and beyond', () => {
  // byte-mode capacity at level H, versions 1-10 (ISO/IEC 18004 table 7)
  const H = [7, 14, 24, 34, 44, 58, 64, 84, 98, 119];
  H.forEach((cap, i) => {
    const version = i + 1;
    assert.equal(QR.capacity(version, 'H'), cap, `capacity of version ${version}`);
    assert.equal(QR.encode('x'.repeat(cap)).version, version, `${cap} bytes fit version ${version}`);
    assert.equal(QR.encode('x'.repeat(cap + 1)).version, version + 1, `${cap + 1} bytes need version ${version + 1}`);
  });
  assert.equal(QR.capacity(40, 'H'), 1273);
  assert.equal(QR.encode('x'.repeat(1273)).version, 40);
  assert.throws(() => QR.encode('x'.repeat(1274)), /Too much data/);
  assert.equal(QR.encode('hi', { minVersion: 6 }).version, 6, 'a minimum version can be asked for');
  assert.equal(QR.encode('ab', { ecl: 'L' }).version, 1);
});

test('tries all 8 masks and keeps the lowest penalty', () => {
  for (const text of ['https://poof.app/add/ava', 'http://localhost:3000/add/ben', 'x'.repeat(50), 'héllo ☁']) {
    const best = QR.encode(text);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => QR.penalty(QR.encode(text, { mask }).modules));
    const lowest = Math.min(...scores);
    assert.equal(scores.indexOf(lowest), best.mask, `${text}: masks scored ${scores.join(', ')}`);
    assert.deepEqual(best.modules, QR.encode(text, { mask: best.mask }).modules);
  }
  assert.throws(() => QR.encode('a', { mask: 8 }), /Mask must be 0-7/);
});

test('the penalty score follows the four standard rules', () => {
  // all light 21x21: rule 1 (21 runs of 21 in each direction), rule 2 (20x20 blocks), rule 4 (50% off)
  const light = Array.from({ length: 21 }, () => new Array(21).fill(false));
  assert.equal(QR.penalty(light), 42 * (3 + 16) + 400 * 3 + 100);
  // a checkerboard has no runs, no blocks, no finder look-alikes and half dark
  const board = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (__, x) => (x + y) % 2 === 0));
  assert.equal(QR.penalty(board), 10 * Math.floor(Math.abs((221 * 100) / 441 - 50) / 5));
});

test('format and version information use the standard BCH codes', () => {
  assert.equal(QR.formatBits('H', 0).toString(2).padStart(15, '0'), '001011010001001');
  assert.equal(QR.formatBits('L', 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(QR.versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
  assert.deepEqual(QR.alignmentCentres(1), []);
  assert.deepEqual(QR.alignmentCentres(2), [6, 18]);
  assert.deepEqual(QR.alignmentCentres(10), [6, 28, 50]);
  assert.deepEqual(QR.alignmentCentres(32), [6, 34, 60, 86, 112, 138]);
});

test('finders, timing and the dark module sit where readers look for them', () => {
  const { size, modules: m } = QR.encode('https://poof.app/add/ava');
  const finder = (x0, y0) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[y0 + y][x0 + x], ring !== 2, `finder module ${x0 + x},${y0 + y}`);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, 'horizontal timing');
    assert.equal(m[i][6], i % 2 === 0, 'vertical timing');
  }
  assert.equal(m[size - 8][8], true, 'the dark module');
});

test('layout maps every data module to a codeword and block', () => {
  for (const version of [1, 5, 7, 10]) {
    const L = QR.layout(version, 'H');
    const counts = new Map();
    L.cells.flat().forEach((cw) => cw >= 0 && counts.set(cw, (counts.get(cw) || 0) + 1));
    const total = counts.size;
    assert.equal(L.blockOf.length, total, `version ${version}: every codeword has a block`);
    assert.ok([...counts.values()].every((n) => n === 8), 'each codeword covers 8 modules');
    for (let b = 0; b < L.blocks; b++) {
      const inBlock = L.blockOf.filter((x) => x === b).length;
      assert.ok(inBlock >= L.ecPerBlock + 1, `block ${b} holds its data and ${L.ecPerBlock} error correction codewords`);
    }
  }
});

test('the same file works in the browser as window.PoofQR', () => {
  const window = { TextEncoder };
  window.window = window;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'qr.js'), 'utf8'), vm.createContext(window));
  assert.equal(typeof window.PoofQR.encode, 'function');
  // (arrays from another realm: compare their contents)
  assert.equal(JSON.stringify(window.PoofQR.encode('https://poof.app/add/ava').modules),
    JSON.stringify(QR.encode('https://poof.app/add/ava').modules));
});
