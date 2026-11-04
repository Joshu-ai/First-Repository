'use strict';
// PoofQR: a QR Code encoder written from scratch (ISO/IEC 18004) for Puffcodes.
// Byte mode (UTF-8), error correction L/M/Q/H (Puffcodes use H, which
// survives about 30% damage), the smallest version that fits (1-40), and all
// 8 masks tried and scored with the standard penalty rules.
//
// PoofQR.encode(text, { ecl = 'H', mask, minVersion }) ->
//   { version, size, ecl, mask, modules }   modules[y][x] === true is a dark module
// PoofQR.layout(version, ecl) -> which codeword (and block) every module carries,
//   so a picture placed over the code can be checked against the error budget.
// Works in the browser (window.PoofQR) and in Node (module.exports).
(function (root) {
  // ---------- tables, by version (index 0 unused) ----------
  // error correction codewords in each block
  const EC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  // number of error correction blocks
  const BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 }; // as written in the format information
  const MAX_VERSION = 40;

  // ---------- GF(256) arithmetic, primitive polynomial x^8+x^4+x^3+x^2+1 ----------
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  // Reed-Solomon generator polynomial (x - a^0)(x - a^1)...(x - a^(n-1)),
  // highest power first; the leading 1 is left out.
  const generators = new Map();
  function generator(n) {
    if (generators.has(n)) return generators.get(n);
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = next;
    }
    const out = g.slice(1);
    generators.set(n, out);
    return out;
  }

  // the n error correction codewords for one block of data codewords
  function reedSolomon(data, n) {
    const g = generator(n);
    const rem = new Array(n).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem.shift();
      rem.push(0);
      if (factor) for (let j = 0; j < n; j++) rem[j] ^= gmul(g[j], factor);
    }
    return rem;
  }

  // remainder of value * x^degree divided by poly (a BCH code over GF(2))
  function bch(value, degree, poly) {
    let r = value << degree;
    for (let bit = 31 - Math.clz32(r); bit >= degree; bit--) {
      if ((r >>> bit) & 1) r ^= poly << (bit - degree);
    }
    return r;
  }
  const formatBits = (ecl, mask) => {
    const data = (ECL_BITS[ecl] << 3) | mask;
    return ((data << 10) | bch(data, 10, 0x537)) ^ 0x5412;
  };
  const versionBits = (version) => (version << 12) | bch(version, 12, 0x1f25);

  // ---------- symbol layout ----------
  const sizeOf = (version) => version * 4 + 17;

  function alignmentCentres(version) {
    if (version === 1) return [];
    const size = sizeOf(version);
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((size - 13) / (count * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  // The fixed patterns: finders with their separators, timing, alignment,
  // the dark module, and room for the format and version information.
  // Returns { size, grid, fixed } with grid[y][x] the colour and fixed[y][x]
  // true for every module that is not data.
  function functionPatterns(version) {
    const size = sizeOf(version);
    const grid = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { grid[y][x] = dark; fixed[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, ring !== 2 && ring !== 4); // 4 is the light separator
        }
      }
    }
    const centres = alignmentCentres(version);
    const last = centres.length - 1;
    centres.forEach((ay, i) => centres.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // finder corners
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));
    drawFormat(grid, 0, fixed);
    if (version >= 7) {
      const bits = versionBits(version);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }
    return { size, grid, fixed };
  }

  // The 15 format bits, twice: round the top-left finder, and split between
  // the other two. Bit 0 is the least significant. `fixed`, when given, marks
  // the modules as reserved.
  function drawFormat(grid, bits, fixed) {
    const size = grid.length;
    const set = (x, y, i) => { grid[y][x] = ((bits >>> i) & 1) === 1; if (fixed) fixed[y][x] = true; };
    for (let i = 0; i <= 5; i++) set(8, i, i);
    set(8, 7, 6);
    set(8, 8, 7);
    set(7, 8, 8);
    for (let i = 9; i < 15; i++) set(14 - i, 8, i);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
    grid[size - 8][8] = true; // the dark module, always dark
    if (fixed) fixed[size - 8][8] = true;
  }

  // Data modules in placement order: two columns at a time from the right,
  // snaking up then down, stepping over the vertical timing column.
  function dataOrder(fixed) {
    const size = fixed.length;
    const order = [];
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        const y = upward ? size - 1 - v : v;
        for (const x of [right, right - 1]) if (!fixed[y][x]) order.push([x, y]);
      }
      upward = !upward;
    }
    return order;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  // ---------- capacity ----------
  function blockShape(version, ecl) {
    const total = Math.floor(dataOrder(functionPatterns(version).fixed).length / 8);
    const blocks = BLOCKS[ecl][version];
    const ec = EC_PER_BLOCK[ecl][version];
    const shortLen = Math.floor(total / blocks); // data + ec codewords in a short block
    const longBlocks = total % blocks;
    const dataCodewords = total - ec * blocks;
    return { total, blocks, ec, shortData: shortLen - ec, shortBlocks: blocks - longBlocks, dataCodewords };
  }
  const shapes = new Map();
  const shape = (version, ecl) => {
    const key = version + ecl;
    if (!shapes.has(key)) shapes.set(key, blockShape(version, ecl));
    return shapes.get(key);
  };
  const countBits = (version) => (version < 10 ? 8 : 16);

  // ---------- encoding ----------
  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
  }

  function dataCodewords(bytes, version, ecl) {
    const capacity = shape(version, ecl).dataCodewords * 8;
    const bits = [];
    const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    put(0b0100, 4); // byte mode
    put(bytes.length, countBits(version));
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, capacity - bits.length)); // terminator
    put(0, (8 - (bits.length % 8)) % 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
    for (let pad = 0; out.length < capacity / 8; pad++) out.push(pad % 2 ? 0x11 : 0xec);
    return out;
  }

  // split into blocks, add each block's error correction, then interleave
  function interleave(data, version, ecl) {
    const s = shape(version, ecl);
    const blocks = [];
    let at = 0;
    for (let i = 0; i < s.blocks; i++) {
      const len = s.shortData + (i < s.shortBlocks ? 0 : 1);
      const d = data.slice(at, at + len);
      at += len;
      blocks.push({ data: d, ec: reedSolomon(d, s.ec) });
    }
    const out = [];
    for (let i = 0; i <= s.shortData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
    for (let i = 0; i < s.ec; i++) for (const b of blocks) out.push(b.ec[i]);
    return out;
  }

  // ---------- penalty (the four standard rules) ----------
  function penalty(grid) {
    const n = grid.length;
    let score = 0;
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(grid[i], grid.map((row) => row[i]));
    for (const line of lines) {
      // rule 1: five or more of the same colour in a row
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && line[i] === line[i - 1]) run++;
        else { if (run >= 5) score += 3 + run - 5; run = 1; }
      }
      // rule 3: a finder-like 1:1:3:1:1 run with four light modules on either side
      for (let i = 0; i + 7 <= n; i++) {
        if (!(line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6])) continue;
        const light = (from, to) => from >= 0 && to <= n && line.slice(from, to).every((d) => !d);
        if (light(i - 4, i)) score += 40;
        if (light(i + 7, i + 11)) score += 40;
      }
    }
    // rule 2: every 2x2 block of one colour
    for (let y = 0; y + 1 < n; y++) {
      for (let x = 0; x + 1 < n; x++) {
        const c = grid[y][x];
        if (grid[y][x + 1] === c && grid[y + 1][x] === c && grid[y + 1][x + 1] === c) score += 3;
      }
    }
    // rule 4: dark modules away from half, in steps of 5%
    let dark = 0;
    for (const row of grid) for (const d of row) if (d) dark++;
    score += 10 * Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
    return score;
  }

  function encode(text, options = {}) {
    const ecl = options.ecl || 'H';
    if (!(ecl in ECL_BITS)) throw new Error('Unknown error correction level: ' + ecl);
    const bytes = utf8(String(text));
    let version = Math.max(1, Math.min(MAX_VERSION, options.minVersion || 1));
    while (version <= MAX_VERSION && 4 + countBits(version) + bytes.length * 8 > shape(version, ecl).dataCodewords * 8) version++;
    if (version > MAX_VERSION) throw new Error('Too much data for a QR code.');

    const codewords = interleave(dataCodewords(bytes, version, ecl), version, ecl);
    const { size, grid, fixed } = functionPatterns(version);
    const order = dataOrder(fixed);
    const bit = (i) => i < codewords.length * 8 && ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;

    const build = (mask) => {
      const m = grid.map((row) => row.slice());
      order.forEach(([x, y], i) => { m[y][x] = bit(i) !== MASKS[mask](x, y); }); // remainder bits start light
      drawFormat(m, formatBits(ecl, mask));
      return m;
    };
    let best = null;
    const masks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
    for (const mask of masks) {
      if (!MASKS[mask]) throw new Error('Mask must be 0-7.');
      const modules = build(mask);
      const score = penalty(modules);
      if (!best || score < best.score) best = { mask, modules, score };
    }
    return { version, size, ecl, mask: best.mask, modules: best.modules };
  }

  // Which codeword every module carries: cells[y][x] is the codeword's place in
  // the interleaved stream, or -1 for function patterns and remainder bits.
  // blockOf[i] names the block that codeword i belongs to.
  function layout(version, ecl = 'H') {
    const s = shape(version, ecl);
    const { size, fixed } = functionPatterns(version);
    const cells = Array.from({ length: size }, () => new Array(size).fill(-1));
    dataOrder(fixed).forEach(([x, y], i) => { if (i < s.total * 8) cells[y][x] = i >>> 3; });
    const blockOf = [];
    for (let i = 0; i <= s.shortData; i++) {
      for (let b = 0; b < s.blocks; b++) if (i < s.shortData || b >= s.shortBlocks) blockOf.push(b);
    }
    for (let i = 0; i < s.ec; i++) for (let b = 0; b < s.blocks; b++) blockOf.push(b);
    return { size, fixed, cells, blockOf, blocks: s.blocks, ecPerBlock: s.ec, alignment: alignmentCentres(version) };
  }

  // data bytes a version holds in byte mode
  const capacity = (version, ecl = 'H') => shape(version, ecl).dataCodewords - Math.ceil((4 + countBits(version)) / 8);

  const api = { encode, layout, penalty, capacity, formatBits, versionBits, alignmentCentres, MAX_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoofQR = api;
})(typeof window !== 'undefined' ? window : globalThis);
