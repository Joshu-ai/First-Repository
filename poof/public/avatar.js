'use strict';
// Poof avatars: a character built from parts. Shared by the browser (drawing +
// editor) and the server (validation). A config is one small integer per part.
(function (root) {
  const PARTS = {
    expr: ['Smile', 'Grin', 'Laugh', 'Wink', 'Love', 'Wow', 'Sad', 'Angry', 'Cool', 'Sleepy',
      'Silly', 'Shy', 'Nervous', 'Crying laughing', 'Thinking', 'Starstruck'],
    face: ['Round', 'Long', 'Square', 'Heart'],
    skin: ['#ffe0cc', '#f6c7a6', '#e0a882', '#c48a62', '#9a6544', '#6e452e', '#4a2e1f'],
    eyeColor: ['#5b3a22', '#2e1d12', '#7a6a2e', '#3f7a4a', '#3a6fb0', '#6d7a86'],
    hair: ['Bald', 'Crop', 'Side part', 'Afro', 'Long', 'Bun', 'Bob', 'Quiff', 'Buzz', 'Braids', 'Puffs'],
    hairColor: ['#1d1714', '#3b2519', '#6b4226', '#a8672f', '#d9a556', '#efd9a8', '#b5432c', '#8a8a96', '#7c5cff', '#ff6fae', '#2fa7ff'],
    beard: ['None', 'Stubble', 'Moustache', 'Beard', 'Goatee'],
    acc: ['None', 'Round glasses', 'Square glasses', 'Shades', 'Cap', 'Beanie', 'Headphones', 'Earrings', 'Freckles'],
    shirt: ['#7c5cff', '#ff7a6b', '#2fa7ff', '#3ddc97', '#ffcb3d', '#2a2640', '#f4f2ff', '#ff5d8f', '#1f8a70'],
    bg: ['#b9a8ff', '#ffb3a8', '#a6dcff', '#a8ebcf', '#ffe299', '#ffb6d2', '#d6d2e6', '#3a3358'],
  };
  const KEYS = Object.keys(PARTS);
  const INK = '#24193f';
  const MOUTH = '#4a1f2e';
  const TONGUE = '#ff7a8c';

  function normalize(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    const out = {};
    for (const k of KEYS) {
      const v = cfg[k];
      if (!Number.isInteger(v) || v < 0 || v >= PARTS[k].length) return null;
      out[k] = v;
    }
    return out;
  }

  function random() {
    const out = {};
    for (const k of KEYS) out[k] = Math.floor(Math.random() * PARTS[k].length);
    if (Math.random() < 0.6) out.acc = 0;
    if (Math.random() < 0.7) out.beard = 0;
    if (Math.random() < 0.5) out.expr = 0;
    return out;
  }

  // mix a hex colour toward black (amt < 0) or white (amt > 0)
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const ch = (s) => Math.round(((n >> s) & 255) + (t - ((n >> s) & 255)) * p);
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }

  // ---------- head ----------
  const HEADS = [
    '<ellipse cx="100" cy="100" rx="50" ry="54"/>',
    '<ellipse cx="100" cy="100" rx="45" ry="58"/>',
    '<rect x="50" y="46" width="100" height="108" rx="38"/>',
    '<path d="M50 94 C50 34 150 34 150 94 C150 130 124 158 100 158 C76 158 50 130 50 94Z"/>',
  ];

  // ---------- hair: [back layer, front layer] ----------
  function hair(style, c) {
    const d = shade(c, -0.22);
    const hl = `<path d="M68 44 Q84 30 104 29" fill="none" stroke="${shade(c, 0.35)}" stroke-width="4" stroke-linecap="round" opacity=".45"/>`;
    const afro = [[54, 96, 20], [50, 74, 22], [58, 52, 22], [74, 36, 22], [96, 28, 22], [118, 30, 22], [138, 42, 22], [150, 62, 21], [152, 86, 20], [148, 104, 16], [100, 62, 44]];
    switch (style) {
      case 1: return ['', `<path d="M48 100 C40 10 160 10 152 100 C147 78 138 66 124 62 C108 70 84 68 70 62 C58 68 52 80 50 98Z" fill="${c}"/>${hl}`];
      case 2: return ['', `<path d="M48 102 C38 6 162 6 152 102 C149 82 144 70 136 62 C116 76 86 78 58 72 C54 80 51 90 50 100Z" fill="${c}"/><path d="M130 30 C122 44 106 58 86 64" fill="none" stroke="${d}" stroke-width="3" stroke-linecap="round"/>${hl}`];
      case 3: return [`<g fill="${c}">${afro.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`,
        `<path d="M54 86 C54 48 146 48 146 86 C130 64 70 64 54 86Z" fill="${c}"/><g fill="${d}" opacity=".5">${[[70, 40], [96, 30], [124, 36], [62, 64], [140, 62], [88, 52], [114, 50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join('')}</g>`];
      case 4: return [`<path d="M44 98 C36 6 164 6 156 98 L160 172 C150 184 130 178 126 162 L74 162 C70 178 50 184 40 172Z" fill="${d}"/>`,
        `<path d="M48 106 C40 10 160 10 152 106 C144 74 122 58 100 56 C78 58 56 74 50 104Z" fill="${c}"/><path d="M100 26 L100 56" stroke="${d}" stroke-width="3" stroke-linecap="round"/>${hl}`];
      case 5: return [`<circle cx="100" cy="22" r="24" fill="${d}"/><path d="M84 24 Q100 12 116 24" fill="none" stroke="${c}" stroke-width="4" opacity=".7"/>`,
        `<path d="M50 94 C44 16 156 16 150 94 C136 64 64 64 52 92Z" fill="${c}"/>${hl}`];
      case 6: return [`<path d="M42 98 C34 8 166 8 158 98 L158 142 C150 154 136 152 132 142 L68 142 C64 152 50 154 42 142Z" fill="${d}"/>`,
        `<path d="M48 102 C38 8 162 8 152 102 L150 82 C128 74 72 74 52 82Z" fill="${c}"/>${hl}`];
      case 7: return ['', `<path d="M52 94 C48 50 66 40 86 40 C92 20 128 14 142 32 C152 46 152 72 148 94 C140 72 122 62 102 64 C82 64 62 74 52 94Z" fill="${c}"/><path d="M96 38 C104 28 122 24 134 32" fill="none" stroke="${shade(c, 0.35)}" stroke-width="4" stroke-linecap="round" opacity=".5"/>`];
      case 8: return ['', `<path d="M52 88 C46 24 154 24 148 88 C130 66 70 66 54 88Z" fill="${c}" opacity=".75"/>`];
      case 9: return [`<g fill="${d}"><rect x="42" y="92" width="22" height="88" rx="11"/><rect x="136" y="92" width="22" height="88" rx="11"/></g><g stroke="${shade(c, -0.4)}" stroke-width="2" opacity=".5">${[110, 126, 142, 158].map((y) => `<path d="M44 ${y} L62 ${y + 6} M138 ${y} L156 ${y + 6}"/>`).join('')}</g>`,
        `<path d="M48 100 C40 10 160 10 152 100 C144 72 122 60 100 58 C78 60 56 72 50 98Z" fill="${c}"/><path d="M100 40 L100 58 M78 46 L74 64 M122 46 L126 64" stroke="${d}" stroke-width="2.5" stroke-linecap="round"/>`];
      case 10: return [`<g fill="${d}"><circle cx="46" cy="44" r="24"/><circle cx="154" cy="44" r="24"/></g>`,
        `<path d="M50 94 C44 16 156 16 150 94 C136 64 64 64 52 92Z" fill="${c}"/><path d="M100 44 L100 62" stroke="${d}" stroke-width="3" stroke-linecap="round"/>`];
      default: return ['', ''];
    }
  }

  // ---------- eyes ----------
  const EL = 80;
  const ER = 120;
  const EY = 98;
  function openEye(x, eyeC, dx = 0, dy = 0, big = false) {
    const rx = big ? 12 : 10;
    const ry = big ? 13 : 11;
    const ir = big ? 5.5 : 7;
    return `<ellipse cx="${x}" cy="${EY}" rx="${rx}" ry="${ry}" fill="#fff"/>
<circle cx="${x + dx}" cy="${EY + 1 + dy}" r="${ir}" fill="${eyeC}"/><circle cx="${x + dx}" cy="${EY + 1 + dy}" r="${ir * 0.5}" fill="#120c1f"/>
<circle cx="${x + dx + 2.6}" cy="${EY - 2 + dy}" r="2.3" fill="#fff"/>
<path d="M${x - rx - 1} ${EY - 2} Q${x} ${EY - ry - 5} ${x + rx + 1} ${EY - 2}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }
  function lid(x, skin) { // half-closed lid over an open eye
    return `<path d="M${x - 13} ${EY - 14} L${x + 13} ${EY - 14} L${x + 13} ${EY} Q${x} ${EY + 3} ${x - 13} ${EY}Z" fill="${skin}"/><path d="M${x - 11} ${EY} Q${x} ${EY + 3} ${x + 11} ${EY}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }
  const arcUp = (x) => `<path d="M${x - 10} ${EY + 3} Q${x} ${EY - 9} ${x + 10} ${EY + 3}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  const arcDown = (x) => `<path d="M${x - 10} ${EY - 1} Q${x} ${EY + 7} ${x + 10} ${EY - 1}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  const squint = (x, dir) => `<path d="M${x - 8 * dir} ${EY - 7} L${x + 6 * dir} ${EY} L${x - 8 * dir} ${EY + 7}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const heart = (x) => `<path d="M${x} ${EY + 9} C${x - 16} ${EY - 2} ${x - 8} ${EY - 15} ${x} ${EY - 6} C${x + 8} ${EY - 15} ${x + 16} ${EY - 2} ${x} ${EY + 9}Z" fill="#ff3f6c"/><circle cx="${x - 5}" cy="${EY - 5}" r="2" fill="#fff" opacity=".8"/>`;
  const star = (x) => `<path d="M${x} ${EY - 13} L${x + 4} ${EY - 4} L${x + 13} ${EY - 3} L${x + 6} ${EY + 3} L${x + 8} ${EY + 12} L${x} ${EY + 7} L${x - 8} ${EY + 12} L${x - 6} ${EY + 3} L${x - 13} ${EY - 3} L${x - 4} ${EY - 4}Z" fill="#ffc83d" stroke="#e09a12" stroke-width="2" stroke-linejoin="round"/>`;

  // ---------- brows ----------
  function brows(kind, c) {
    const s = `fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"`;
    const P = {
      neutral: ['M68 80 Q80 73 92 78', 'M108 78 Q120 73 132 80'],
      raised: ['M68 72 Q80 63 92 69', 'M108 69 Q120 63 132 72'],
      angry: ['M68 74 L92 83', 'M108 83 L132 74'],
      sad: ['M68 81 L92 73', 'M108 73 L132 81'],
      quirk: ['M68 80 Q80 74 92 79', 'M108 70 Q120 62 132 70'],
      soft: ['M70 79 Q80 75 90 78', 'M110 78 Q120 75 130 79'],
    }[kind];
    return `<path d="${P[0]}" ${s}/><path d="${P[1]}" ${s}/>`;
  }

  // ---------- mouths ----------
  const M = {
    smile: `<path d="M86 125 Q100 138 114 125" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    grin: `<path d="M82 122 Q100 148 118 122Z" fill="${MOUTH}"/><path d="M85 123 L115 123 L113 129 L87 129Z" fill="#fff"/><ellipse cx="100" cy="137" rx="8" ry="4" fill="${TONGUE}"/>`,
    laugh: `<path d="M78 118 Q100 158 122 118Z" fill="${MOUTH}"/><path d="M82 119 L118 119 L116 126 L84 126Z" fill="#fff"/><ellipse cx="100" cy="142" rx="11" ry="6" fill="${TONGUE}"/>`,
    open: `<path d="M86 123 Q100 142 114 123Z" fill="${MOUTH}"/><ellipse cx="100" cy="133" rx="6" ry="3.5" fill="${TONGUE}"/>`,
    o: `<ellipse cx="100" cy="131" rx="7.5" ry="10" fill="${MOUTH}"/><ellipse cx="100" cy="136" rx="5" ry="3" fill="${TONGUE}"/>`,
    frown: `<path d="M87 134 Q100 123 113 134" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    teeth: `<rect x="84" y="122" width="32" height="13" rx="6" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M84 128.5 L116 128.5 M95 122 L95 135 M105 122 L105 135" stroke="${INK}" stroke-width="2"/>`,
    smirk: `<path d="M88 130 Q104 134 115 122" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    tiny: `<ellipse cx="100" cy="131" rx="4.5" ry="4" fill="${MOUTH}"/>`,
    tongue: `<path d="M86 125 Q100 134 114 125" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M93 130 Q100 147 107 130Z" fill="${TONGUE}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M100 132 L100 139" stroke="${shade(TONGUE, -0.3)}" stroke-width="2" stroke-linecap="round"/>`,
    shy: `<path d="M92 127 Q100 133 108 127" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    wavy: `<path d="M84 130 Q89 124 94 130 T104 130 T114 130" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    think: `<path d="M94 131 L112 127" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  };

  const blush = '<ellipse cx="70" cy="118" rx="10" ry="6" fill="#ff5f7e" opacity=".32"/><ellipse cx="130" cy="118" rx="10" ry="6" fill="#ff5f7e" opacity=".32"/>';
  const tear = (x, y) => `<path d="M${x} ${y} C${x - 6} ${y + 10} ${x - 5} ${y + 16} ${x} ${y + 16} C${x + 5} ${y + 16} ${x + 6} ${y + 10} ${x} ${y}Z" fill="#6cc6ff" stroke="#3a9ee0" stroke-width="1.5"/>`;
  const sweat = '<path d="M146 62 C140 72 141 78 146 78 C151 78 152 72 146 62Z" fill="#8fd6ff" stroke="#3a9ee0" stroke-width="1.5"/>';

  // expression -> { brows, eyes, mouth, extra } ; eyes is a function of (eyeColour, skin)
  const EXPR = [
    { b: 'neutral', e: (c) => openEye(EL, c) + openEye(ER, c), m: M.smile },
    { b: 'raised', e: () => arcUp(EL) + arcUp(ER), m: M.grin, x: blush },
    { b: 'raised', e: () => squint(EL, 1) + squint(ER, -1), m: M.laugh, x: blush },
    { b: 'quirk', e: (c) => openEye(EL, c) + arcUp(ER), m: M.smirk },
    { b: 'raised', e: () => heart(EL) + heart(ER), m: M.open, x: blush },
    { b: 'raised', e: (c) => openEye(EL, c, 0, 0, true) + openEye(ER, c, 0, 0, true), m: M.o },
    { b: 'sad', e: (c) => openEye(EL, c, 0, 3) + openEye(ER, c, 0, 3), m: M.frown, x: tear(70, 108) },
    { b: 'angry', e: (c, s) => openEye(EL, c) + openEye(ER, c) + lid(EL, s) + lid(ER, s), m: M.teeth },
    { b: 'quirk', e: (c, s) => openEye(EL, c, 2) + openEye(ER, c, 2) + lid(EL, s) + lid(ER, s), m: M.smirk },
    { b: 'soft', e: () => arcDown(EL) + arcDown(ER), m: M.tiny, x: `<text x="140" y="62" font-size="20" font-weight="800" font-family="system-ui,sans-serif" fill="${INK}" opacity=".6">z</text><text x="154" y="48" font-size="14" font-weight="800" font-family="system-ui,sans-serif" fill="${INK}" opacity=".6">z</text>` },
    { b: 'raised', e: (c) => openEye(EL, c, 0, -2) + squint(ER, -1), m: M.tongue },
    { b: 'soft', e: (c) => openEye(EL, c, -4, 2) + openEye(ER, c, -4, 2), m: M.shy, x: blush + blush },
    { b: 'sad', e: (c) => openEye(EL, c, 0, 0, true) + openEye(ER, c, 0, 0, true), m: M.wavy, x: sweat },
    { b: 'raised', e: () => arcUp(EL) + arcUp(ER), m: M.laugh, x: tear(62, 102) + tear(138, 102) },
    { b: 'quirk', e: (c) => openEye(EL, c, 3, -4) + openEye(ER, c, 3, -4), m: M.think },
    { b: 'raised', e: () => star(EL) + star(ER), m: M.open },
  ];

  function beard(kind, c) {
    const jaw = 'M54 108 C56 150 80 162 100 162 C120 162 144 150 146 108 C140 132 128 142 100 142 C72 142 60 132 54 108Z';
    const stache = `<path d="M82 121 Q91 113 100 118 Q109 113 118 121 Q109 125 100 121 Q91 125 82 121Z" fill="${c}"/>`;
    switch (kind) {
      case 1: return `<path d="${jaw}" fill="${c}" opacity=".22"/><path d="M84 119 Q100 114 116 119" stroke="${c}" stroke-width="5" opacity=".22" stroke-linecap="round"/>`;
      case 2: return stache;
      case 3: return `<path d="${jaw}" fill="${c}"/><path d="M80 130 C84 152 116 152 120 130 C112 140 88 140 80 130Z" fill="${c}"/>${stache}`;
      case 4: return `<path d="M88 138 Q100 160 112 138 Q100 146 88 138Z" fill="${c}"/>${stache}`;
      default: return '';
    }
  }

  function accessory(kind) {
    const lens = (x) => `<circle cx="${x}" cy="${EY}" r="16" fill="#fff" fill-opacity=".12" stroke="${INK}" stroke-width="3.5"/>`;
    switch (kind) {
      case 1: return `${lens(EL)}${lens(ER)}<path d="M96 97 Q100 93 104 97 M64 96 L52 92 M136 96 L148 92" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
      case 2: return `<g fill="#fff" fill-opacity=".12" stroke="${INK}" stroke-width="3.5"><rect x="63" y="86" width="34" height="25" rx="7"/><rect x="103" y="86" width="34" height="25" rx="7"/></g><path d="M97 96 L103 96 M63 94 L52 91 M137 94 L148 91" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
      case 3: return `<g fill="#140f22"><rect x="61" y="86" width="36" height="24" rx="10"/><rect x="103" y="86" width="36" height="24" rx="10"/></g><path d="M97 94 L103 94 M61 92 L52 90 M139 92 L148 90" stroke="#140f22" stroke-width="4" stroke-linecap="round"/><path d="M67 92 L76 92 M109 92 L118 92" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>`;
      case 4: return `<path d="M48 84 C44 30 156 30 152 84Z" fill="#ff7a6b"/><path d="M48 84 Q100 74 152 84" fill="none" stroke="#e0604f" stroke-width="4"/><path d="M100 80 C132 74 170 76 178 88 C150 90 122 88 100 86Z" fill="#e0604f"/><circle cx="100" cy="34" r="5" fill="#e0604f"/>`;
      case 5: return `<path d="M48 86 C42 22 158 22 152 86Z" fill="#2fa7ff"/><rect x="44" y="72" width="112" height="18" rx="9" fill="#1d86d4"/><g stroke="#1d86d4" stroke-width="3" opacity=".5">${[66, 82, 100, 118, 134].map((x) => `<path d="M${x} 40 L${x} 70"/>`).join('')}</g><circle cx="100" cy="24" r="12" fill="#f4f2ff"/>`;
      case 6: return `<path d="M50 102 C44 22 156 22 150 102" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><rect x="36" y="86" width="22" height="38" rx="11" fill="#ff5d8f"/><rect x="142" y="86" width="22" height="38" rx="11" fill="#ff5d8f"/><rect x="42" y="94" width="8" height="22" rx="4" fill="#ffffff" opacity=".35"/>`;
      case 7: return '<circle cx="52" cy="122" r="4.5" fill="#ffcb3d" stroke="#d99a12" stroke-width="1.5"/><circle cx="148" cy="122" r="4.5" fill="#ffcb3d" stroke="#d99a12" stroke-width="1.5"/>';
      case 8: return `<g fill="#9a5a3a" opacity=".45">${[[66, 114], [72, 118], [64, 120], [76, 113], [134, 114], [128, 118], [136, 120], [124, 113]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>`;
      default: return '';
    }
  }

  let uid = 0;
  function avatarSVG(cfg, size = 44, label = '') {
    const c = normalize(cfg);
    if (!c) return '';
    const id = 'pa' + (++uid);
    const skin = PARTS.skin[c.skin];
    const skinD = shade(skin, -0.14);
    const hairC = PARTS.hairColor[c.hairColor];
    const browC = c.hair === 0 && c.beard === 0 ? shade(skin, -0.45) : shade(hairC, -0.15);
    const shirt = PARTS.shirt[c.shirt];
    const bg = PARTS.bg[c.bg];
    const hat = c.acc === 4 || c.acc === 5;
    const [back, front] = hair(c.hair, hairC);
    const ex = EXPR[c.expr];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}"${label ? ` role="img" aria-label="${label.replace(/[<>&"]/g, '')}"` : ' aria-hidden="true"'}>
<defs>
<clipPath id="${id}c"><circle cx="100" cy="100" r="100"/></clipPath>
<radialGradient id="${id}b" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(bg, 0.35)}"/><stop offset="1" stop-color="${bg}"/></radialGradient>
<radialGradient id="${id}s" cx="44%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(skin, 0.1)}"/><stop offset=".75" stop-color="${skin}"/><stop offset="1" stop-color="${skinD}"/></radialGradient>
</defs>
<g clip-path="url(#${id}c)">
<rect width="200" height="200" fill="url(#${id}b)"/>
${back}
<path d="M24 212 C26 178 54 162 84 158 Q100 174 116 158 C146 162 174 178 176 212Z" fill="${shirt}"/>
<path d="M84 158 Q100 176 116 158" fill="none" stroke="${shade(shirt, -0.25)}" stroke-width="5" stroke-linecap="round"/>
<path d="M85 128 L85 160 Q100 172 115 160 L115 128Z" fill="${skinD}"/>
<g fill="${skin}"><ellipse cx="52" cy="104" rx="10" ry="13"/><ellipse cx="148" cy="104" rx="10" ry="13"/></g>
<g fill="${skinD}"><ellipse cx="53" cy="105" rx="5" ry="7"/><ellipse cx="147" cy="105" rx="5" ry="7"/></g>
<g fill="url(#${id}s)">${HEADS[c.face]}</g>
${beard(c.beard, shade(hairC, -0.05))}
${hat ? '' : front}
<path d="M97 104 Q99 114 105 111" fill="none" stroke="${shade(skin, -0.28)}" stroke-width="3.2" stroke-linecap="round"/>
${brows(ex.b, browC)}
${ex.e(PARTS.eyeColor[c.eyeColor], skin)}
${ex.m}
${ex.x || ''}
${accessory(c.acc)}
</g></svg>`;
  }

  const api = { PARTS, KEYS, normalize, random, avatarSVG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoofAvatar = api;
})(typeof window !== 'undefined' ? window : globalThis);
