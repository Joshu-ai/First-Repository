'use strict';
// Puffcode: Poof's scannable profile code. A QR code (PoofQR, error
// correction level H) of <origin>/add/<username>, drawn the Poof way: a
// brand-violet rounded tile, white rounded dots, the three finder patterns as
// rounded squares, and a knock-out in the middle where the person's avatar
// sits inside a white Puff (or, with no avatar yet, Puff's own face).
//
// White on violet is a light-on-dark ("reflectance reversed") QR code. Phone
// camera apps read those; the in-app scanner also tries each frame inverted
// for detectors that only read dark-on-light codes.
//
// The knock-out is sized from the code's own module layout (PoofQR.layout):
// it never covers a finder, timing, format or version module, and it never
// costs any error correction block more than two thirds of what level H can
// repair, counting every codeword it touches as wrong. The last third is left
// for glare, blur and a shaky hand. Shorter codes, whose blocks are smaller,
// step up a version until Puff fits at a readable size.
//
// PoofPuffcode.svg({ url, avatar, username, size, label }) -> SVG markup
// PoofPuffcode.png(options, px) -> Promise<PNG data URL> (browser only)
// PoofPuffcode.url(username, origin) / .parse(text, host) -> link <-> username
(function (root) {
  const VIOLET = '#6d4cff'; // the brand violet (--brand-bg in styles.css)
  const WHITE = '#ffffff';
  const QUIET = 4; // violet margin round the code, in modules: the quiet zone the QR standard asks for
  // Dot size and finder rounding were tuned with test/puffcode-scan.py: full
  // dots and gently rounded finders keep strict readers (OpenCV) reading.
  const DOT = 0.5; // dot radius, in modules
  const FINDER = [0.25, 0.2, 0.6]; // corner radii: the finder's 7x7 square, its 5x5 hole, the 3x3 centre
  const RIM = 0.4; // white rim round Puff, in modules
  const GAP = 0.2; // clear violet between the rim and the nearest dot
  const BUDGET = 2 / 3; // share of each block's repair capacity Puff may use
  const MIN_SIZE = 0.34; // Puff's width as a share of the code, at the least
  const MAX_SIZE = 0.42; // and at the most
  const USERNAME = /^[a-z0-9_.]{3,20}$/;

  const deps = () => ({ QR: root.PoofQR, cloud: root.mascotCloud, mascotSVG: root.mascotSVG, Avatar: root.PoofAvatar });

  // ---------- links ----------
  const url = (username, origin) => String(origin).replace(/\/+$/, '') + '/add/' + username;
  // the username in a Puffcode link, or null. With `host`, only links to that
  // host count: a username on another server is somebody else.
  function parse(text, host) {
    let u;
    try { u = new URL(String(text)); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || (host && u.host !== host)) return null;
    const m = /^\/add\/([^/]+)\/?$/.exec(u.pathname);
    if (!m) return null;
    let name;
    try { name = decodeURIComponent(m[1]).toLowerCase(); } catch { return null; }
    return USERNAME.test(name) ? name : null;
  }

  // ---------- where Puff goes ----------
  // Puff `width` modules wide, centred on a code `n` modules across: the
  // mascot-to-module transform.
  function placement(n, width) {
    const [bx, by, bw, bh] = deps().cloud.box;
    const k = width / bw;
    return { k, tx: n / 2 - (bx + bw / 2) * k, ty: n / 2 - (by + bh / 2) * k };
  }

  // is (px, py) inside Puff's outline, or within `reach` of it? (mascot units)
  let edges = null; // flat: ax, ay, dx, dy, squared length per edge
  function nearPuff(px, py, reach) {
    if (!edges) {
      const o = deps().cloud.outline;
      edges = new Float64Array(o.length * 5);
      o.forEach((a, i) => {
        const b = o[(i + o.length - 1) % o.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        edges.set([a[0], a[1], dx, dy, dx * dx + dy * dy || 1], i * 5);
      });
    }
    const r2 = reach * reach;
    let inside = false;
    for (let i = 0; i < edges.length; i += 5) {
      const ax = edges[i];
      const ay = edges[i + 1];
      const dx = edges[i + 2];
      const dy = edges[i + 3];
      if ((ay > py) !== (ay + dy > py) && px < (dx * (py - ay)) / dy + ax) inside = !inside;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / edges[i + 4]));
      const ex = px - ax - t * dx;
      const ey = py - ay - t * dy;
      if (ex * ex + ey * ey < r2) return true;
    }
    return inside;
  }

  // modules whose dot would come within GAP of Puff's white rim
  function knockout(n, width) {
    const [bx, by, bw, bh] = deps().cloud.box;
    const { k, tx, ty } = placement(n, width);
    const reach = (RIM + GAP + DOT) / k; // in mascot units
    const out = Array.from({ length: n }, () => new Array(n).fill(false));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = (x + 0.5 - tx) / k;
        const py = (y + 0.5 - ty) / k;
        const nearBox = px > bx - reach && px < bx + bw + reach && py > by - reach && py < by + bh + reach;
        out[y][x] = nearBox && nearPuff(px, py, reach);
      }
    }
    return out;
  }

  // the cost of a knock-out: the most codewords it touches in any one block,
  // and whether it touches anything a reader needs to find the code
  function cost(layout, cleared) {
    const per = new Array(layout.blocks).fill(0);
    const seen = new Set();
    const mid = layout.alignment.slice(1, -1); // the inner alignment patterns of big codes: readers find the code without them
    const isInnerAlignment = (x, y) => mid.some((a) => Math.abs(x - a) <= 2) && mid.some((a) => Math.abs(y - a) <= 2);
    let structural = 0;
    cleared.forEach((row, y) => row.forEach((hit, x) => {
      if (!hit) return;
      const cw = layout.cells[y][x];
      if (cw >= 0) {
        if (!seen.has(cw)) { seen.add(cw); per[layout.blockOf[cw]]++; }
      } else if (layout.fixed[y][x] && !isInnerAlignment(x, y)) structural++;
    }));
    return { worst: Math.max(...per), touched: seen.size, structural };
  }

  // The biggest Puff (MIN_SIZE to MAX_SIZE of the code's width) a version
  // takes within budget, in modules; 0 when even the smallest will not fit.
  const fits = new Map();
  function puffWidth(version) {
    if (fits.has(version)) return fits.get(version);
    const layout = deps().QR.layout(version, 'H');
    const budget = Math.floor(Math.floor(layout.ecPerBlock / 2) * BUDGET);
    const ok = (share) => {
      const c = cost(layout, knockout(layout.size, layout.size * share));
      return c.worst <= budget && c.structural === 0;
    };
    let best = 0;
    if (ok(MIN_SIZE)) {
      for (let step = Math.round((MAX_SIZE - MIN_SIZE) * 100); step >= 0; step--) {
        const share = MIN_SIZE + step / 100;
        if (step === 0 || ok(share)) { best = layout.size * share; break; }
      }
    }
    fits.set(version, best);
    return best;
  }

  // the code for a link: the smallest version that holds it and has room for Puff
  function plan(text) {
    const { QR } = deps();
    const bytes = new TextEncoder().encode(String(text)).length;
    for (let v = 1; v <= QR.MAX_VERSION; v++) {
      if (QR.capacity(v, 'H') < bytes || !puffWidth(v)) continue;
      const qr = QR.encode(text, { ecl: 'H', minVersion: v });
      return { qr, width: puffWidth(v), cleared: knockout(qr.size, puffWidth(v)) };
    }
    throw new Error('That link is too long for a Puffcode.');
  }

  // ---------- drawing ----------
  const f = (v) => +v.toFixed(3);
  const roundRect = (x, y, w, h, r) => `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(h - 2 * r)}` +
    `a${r} ${r} 0 0 1 ${-r} ${r}h${f(2 * r - w)}a${r} ${r} 0 0 1 ${-r} ${-r}v${f(2 * r - h)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let uid = 0;

  function svg({ url: link, avatar = null, username = '', size = 280, label } = {}) {
    const { cloud, mascotSVG, Avatar } = deps();
    const { qr, width, cleared } = plan(link);
    const n = qr.size;
    const tile = n + 2 * QUIET;
    const inFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

    let dots = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.modules[y][x] || inFinder(x, y) || cleared[y][x]) continue;
        dots += `M${f(QUIET + x + 0.5 - DOT)} ${f(QUIET + y + 0.5)}a${DOT} ${DOT} 0 1 0 ${2 * DOT} 0a${DOT} ${DOT} 0 1 0 ${-2 * DOT} 0`;
      }
    }
    let finders = '';
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const x = QUIET + fx;
      const y = QUIET + fy;
      finders += roundRect(x, y, 7, 7, FINDER[0]) + roundRect(x + 1, y + 1, 5, 5, FINDER[1]) + roundRect(x + 2, y + 2, 3, 3, FINDER[2]);
    }

    // Puff, in mascot units, moved onto the code
    const p = placement(n, width);
    const rim = f((2 * RIM) / p.k);
    const [bx, by, bw, bh] = cloud.box;
    const id = 'pc' + (++uid);
    const config = avatar && Avatar ? Avatar.normalize(avatar) : null;
    let inside;
    if (config) {
      // the avatar seen through a Puff-shaped window, its face in the big puff
      const s = 0.68;
      inside = `<clipPath id="${id}w"><path d="${cloud.path}"/></clipPath>` +
        `<path d="${cloud.path}" fill="${WHITE}" stroke="${WHITE}" stroke-width="${rim}" stroke-linejoin="round"/>` +
        `<g clip-path="url(#${id}w)"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${Avatar.PARTS.bg[config.bg]}"/>` +
        `<g transform="translate(${f(bx + bw / 2 - 100 * s)} ${f(by + bh / 2 + 4 - 100 * s)}) scale(${s})">${Avatar.avatarSVG(config, 200)}</g></g>`;
    } else {
      // no avatar yet: Puff's solid mark, its face showing the violet through
      const mark = mascotSVG('happy', bw, '', 'mark', WHITE).replace(/^<svg[^>]*>/,
        `<svg x="${bx}" y="${by}" width="${bw}" height="${bh}" viewBox="${bx} ${by} ${bw} ${bh}">`); // cropped to the body: no trail
      inside = `<path d="${cloud.path}" fill="none" stroke="${WHITE}" stroke-width="${rim}" stroke-linejoin="round"/>${mark}`;
    }
    const name = label || (username ? `Puffcode for @${username}` : 'Puffcode');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile} ${tile}" width="${size}" height="${size}" role="img" aria-label="${esc(name)}" class="puffcode-art">` +
      `<rect width="${tile}" height="${tile}" rx="${f(tile * 0.12)}" fill="${VIOLET}"/>` +
      `<path d="${dots}" fill="${WHITE}"/><path d="${finders}" fill="${WHITE}" fill-rule="evenodd"/>` +
      `<g transform="translate(${f(QUIET + p.tx)} ${f(QUIET + p.ty)}) scale(${f(p.k)})">${inside}</g></svg>`;
  }

  // The same art as a PNG, `px` pixels square, for saving and sharing. The
  // tile sits on a clear margin (MARGIN of the width each side), so a reader
  // given the file alone still sees space round the code, as a camera would.
  const MARGIN = 0.06;
  function png(options, px = 1080) {
    const inset = Math.round(px * MARGIN);
    const markup = svg({ ...options, size: px - 2 * inset });
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        canvas.getContext('2d').drawImage(img, inset, inset, px - 2 * inset, px - 2 * inset);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not draw the Puffcode.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    });
  }

  root.PoofPuffcode = { svg, png, url, parse, plan, puffWidth, knockout, cost, QUIET, DOT, BUDGET, MIN_SIZE, MAX_SIZE, MARGIN, VIOLET };
})(typeof window !== 'undefined' ? window : globalThis);
