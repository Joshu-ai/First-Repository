'use strict';
// Poof avatars: a little character built from parts. Shared by the browser
// (drawing + editor) and the server (validation). A config is a set of small
// integers, one per part: { bg, skin, face, hair, hairColor, eyes, mouth, acc, shirt }.
(function (root) {
  const PARTS = {
    bg: ['#7c5cff', '#ff7a6b', '#3db4ff', '#3ddc97', '#ffd23f', '#ff5d8f', '#2a2640', '#a9a3c7'],
    skin: ['#ffdfc8', '#f3c39f', '#dba27a', '#b57d55', '#8d5b3c', '#603d27'],
    face: ['Round', 'Oval', 'Soft square'],
    hair: ['None', 'Short', 'Curly', 'Long', 'Bun', 'Spiky', 'Swoop', 'Buzz'],
    hairColor: ['#1f1a17', '#4a2f22', '#8a5a2b', '#d8a24a', '#e8d6b0', '#c2462f', '#7c5cff', '#ff7ab8', '#3db4ff', '#e9e9ef'],
    eyes: ['Dots', 'Happy', 'Wide', 'Sleepy', 'Wink', 'Stars'],
    mouth: ['Smile', 'Grin', 'Oh', 'Flat', 'Tongue', 'Smirk'],
    acc: ['None', 'Glasses', 'Shades', 'Cap', 'Beanie', 'Headphones', 'Freckles', 'Blush'],
    shirt: ['#7c5cff', '#ff7a6b', '#3db4ff', '#3ddc97', '#ffd23f', '#1f1c2e', '#f4f2ff', '#ff5d8f'],
  };
  const KEYS = Object.keys(PARTS);
  const INK = '#2a2257';

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
    out.acc = Math.random() < 0.5 ? 0 : out.acc;
    return out;
  }

  function headShape(face, fill) {
    if (face === 1) return `<ellipse cx="50" cy="54" rx="25" ry="30" fill="${fill}"/>`;
    if (face === 2) return `<rect x="23" y="25" width="54" height="58" rx="18" fill="${fill}"/>`;
    return `<circle cx="50" cy="55" r="28" fill="${fill}"/>`;
  }

  function hairBack(style, c) {
    if (style === 3) return `<path d="M20 50 C18 20 82 20 80 50 L82 88 C74 92 70 80 70 70 L30 70 C30 80 26 92 18 88 Z" fill="${c}"/>`;
    if (style === 4) return `<circle cx="50" cy="20" r="11" fill="${c}"/>`;
    return '';
  }

  function hairFront(style, c) {
    switch (style) {
      case 1: return `<path d="M22 50 C20 16 80 16 78 50 C72 38 58 34 46 38 C36 40 28 42 22 50 Z" fill="${c}"/>`;
      case 2: return `<g fill="${c}">${[[26, 42, 9], [32, 32, 10], [43, 26, 10], [56, 26, 10], [67, 31, 10], [74, 41, 9], [50, 33, 9], [38, 37, 7], [62, 37, 7]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
      case 3: return `<path d="M21 52 C18 16 82 16 79 52 C76 40 64 34 50 40 C36 34 24 40 21 52 Z" fill="${c}"/>`;
      case 4: return `<path d="M22 50 C20 18 80 18 78 50 C70 40 30 40 22 50 Z" fill="${c}"/>`;
      case 5: return `<path d="M22 50 L20 30 L30 36 L32 20 L42 32 L50 14 L58 32 L68 20 L70 36 L80 30 L78 50 C70 40 30 40 22 50 Z" fill="${c}"/>`;
      case 6: return `<path d="M22 52 C18 18 80 12 80 46 C70 44 60 34 54 30 C50 40 34 42 22 52 Z" fill="${c}"/>`;
      case 7: return `<path d="M24 46 C24 22 76 22 76 46 C68 38 32 38 24 46 Z" fill="${c}" opacity=".85"/>`;
      default: return '';
    }
  }

  function eyes(kind) {
    const L = 40;
    const R = 60;
    const Y = 54;
    switch (kind) {
      case 1: return [L, R].map((x) => `<path d="M${x - 5} ${Y + 1} Q${x} ${Y - 5} ${x + 5} ${Y + 1}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`).join('');
      case 2: return [L, R].map((x) => `<circle cx="${x}" cy="${Y}" r="6" fill="#fff"/><circle cx="${x}" cy="${Y + 1}" r="3.4" fill="${INK}"/>`).join('');
      case 3: return [L, R].map((x) => `<path d="M${x - 5} ${Y} Q${x} ${Y + 4} ${x + 5} ${Y}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`).join('');
      case 4: return `<ellipse cx="${L}" cy="${Y}" rx="3.4" ry="4.4" fill="${INK}"/><path d="M${R - 5} ${Y + 1} Q${R} ${Y - 5} ${R + 5} ${Y + 1}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
      case 5: return [L, R].map((x) => `<path d="M${x} ${Y - 6} l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8z" fill="${INK}"/>`).join('');
      default: return [L, R].map((x) => `<ellipse cx="${x}" cy="${Y}" rx="3.4" ry="4.4" fill="${INK}"/><circle cx="${x + 1.2}" cy="${Y - 1.6}" r="1.2" fill="#fff"/>`).join('');
    }
  }

  function mouth(kind) {
    switch (kind) {
      case 1: return `<path d="M42 65 Q50 76 58 65 Z" fill="${INK}"/><path d="M44 65.5 L56 65.5 L55 68 L45 68 Z" fill="#fff"/>`;
      case 2: return `<ellipse cx="50" cy="68" rx="4" ry="5" fill="${INK}"/>`;
      case 3: return `<path d="M44 67 L56 67" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
      case 4: return `<path d="M43 65 Q50 73 57 65" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M47 69 Q50 76 53 69 Z" fill="#ff5d8f"/>`;
      case 5: return `<path d="M44 68 Q52 70 57 64" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
      default: return `<path d="M43 65 Q50 72 57 65" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }

  function accessory(kind, hairColor) {
    switch (kind) {
      case 1: return `<g fill="none" stroke="${INK}" stroke-width="2.4"><circle cx="40" cy="54" r="8"/><circle cx="60" cy="54" r="8"/><path d="M48 54 L52 54 M32 53 L24 50 M68 53 L76 50"/></g>`;
      case 2: return `<g fill="${INK}"><rect x="30" y="48" width="18" height="11" rx="5"/><rect x="52" y="48" width="18" height="11" rx="5"/><rect x="46" y="50" width="8" height="3"/></g><path d="M33 51 L38 51" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
      case 3: return `<path d="M21 44 C21 18 79 18 79 44 Z" fill="#ff7a6b"/><path d="M60 42 C74 40 88 42 90 46 L60 46 Z" fill="#e0604f"/><circle cx="50" cy="22" r="3" fill="#e0604f"/>`;
      case 4: return `<path d="M21 46 C19 14 81 14 79 46 Z" fill="#3db4ff"/><rect x="19" y="40" width="62" height="9" rx="4.5" fill="#2b8fd0"/><circle cx="50" cy="16" r="5" fill="#f4f2ff"/>`;
      case 5: return `<path d="M24 50 C22 14 78 14 76 50" fill="none" stroke="${INK}" stroke-width="4"/><rect x="18" y="46" width="10" height="16" rx="5" fill="#ff5d8f"/><rect x="72" y="46" width="10" height="16" rx="5" fill="#ff5d8f"/>`;
      case 6: return `<g fill="#b5653e" opacity=".55">${[[34, 62], [38, 64], [36, 59], [62, 59], [66, 62], [64, 64]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2"/>`).join('')}</g>`;
      case 7: return '<circle cx="34" cy="63" r="5" fill="#ff7a6b" opacity=".45"/><circle cx="66" cy="63" r="5" fill="#ff7a6b" opacity=".45"/>';
      default: return '';
    }
    // hairColor kept in the signature so accessories can tint later
  }

  let uid = 0;
  function avatarSVG(cfg, size = 44, label = '') {
    const c = normalize(cfg);
    if (!c) return '';
    const skin = PARTS.skin[c.skin];
    const hairC = PARTS.hairColor[c.hairColor];
    const clip = 'pa' + (++uid);
    const hatOn = c.acc === 3 || c.acc === 4;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"${label ? ` role="img" aria-label="${label.replace(/[<>&"]/g, '')}"` : ' aria-hidden="true"'}>
<defs><clipPath id="${clip}"><circle cx="50" cy="50" r="50"/></clipPath></defs>
<g clip-path="url(#${clip})">
<rect width="100" height="100" fill="${PARTS.bg[c.bg]}"/>
${hatOn ? '' : hairBack(c.hair, hairC)}
<path d="M14 104 C16 86 32 80 50 80 C68 80 84 86 86 104 Z" fill="${PARTS.shirt[c.shirt]}"/>
<rect x="44" y="72" width="12" height="11" rx="4" fill="${skin}"/>
<circle cx="23" cy="56" r="5" fill="${skin}"/><circle cx="77" cy="56" r="5" fill="${skin}"/>
${headShape(c.face, skin)}
${hatOn ? '' : hairFront(c.hair, hairC)}
${eyes(c.eyes)}${mouth(c.mouth)}${accessory(c.acc, hairC)}
</g></svg>`;
  }

  const api = { PARTS, KEYS, normalize, random, avatarSVG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoofAvatar = api;
})(typeof window !== 'undefined' ? window : globalThis);
