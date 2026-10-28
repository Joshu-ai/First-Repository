'use strict';
// Puff, the Poof mascot: a small cloud that vanishes. Drawn in code so it
// scales anywhere and can change mood. mascotSVG(mood, size, label) -> SVG string.
(() => {
  const INK = '#241a4a';
  let uid = 0;

  // ---------- eyes (centres at 98,122 and 142,122) ----------
  const LX = 95;
  const RX = 145;
  const EY = 120;

  function eye(x, id, { dx = 0, dy = 0, big = false, outer = 1 } = {}) {
    const rx = big ? 14.5 : 12.5;
    const ry = big ? 15.5 : 16.5;
    const cx = x + dx;
    const cy = EY + dy;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id}eye)"/>
<ellipse cx="${cx}" cy="${cy + ry * 0.55}" rx="${rx * 0.62}" ry="${ry * 0.24}" fill="#8d7cff" opacity=".55"/>
<ellipse cx="${cx + 3.5}" cy="${cy - 5.5}" rx="${big ? 5 : 4.4}" ry="${big ? 5.5 : 5.6}" fill="#fff"/>
<circle cx="${cx - 4.2}" cy="${cy + 5}" r="${big ? 2.4 : 2.1}" fill="#fff" opacity=".85"/>
<path d="M${cx + outer * (rx - 3)} ${cy - ry + 5} q${outer * 5} -2 ${outer * 7} -7" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }
  const closedUp = (x) => `<path d="M${x - 11} ${EY + 4} Q${x} ${EY - 10} ${x + 11} ${EY + 4}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  const closedDown = (x, o) => `<path d="M${x - 12} ${EY} Q${x} ${EY + 10} ${x + 12} ${EY}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M${x + o * 11} ${EY + 1} l${o * 5} 4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  const chevron = (x, d) => `<path d="M${x - 9 * d} ${EY - 9} L${x + 8 * d} ${EY} L${x - 9 * d} ${EY + 9}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const heartEye = (x, id) => `<path d="M${x} ${EY + 13} C${x - 22} ${EY} ${x - 12} ${EY - 20} ${x} ${EY - 8} C${x + 12} ${EY - 20} ${x + 22} ${EY} ${x} ${EY + 13}Z" fill="url(#${id}heart)" stroke="#c4123f" stroke-width="1.5"/><ellipse cx="${x - 6}" cy="${EY - 6}" rx="3.5" ry="2.5" fill="#fff" opacity=".85" transform="rotate(-30 ${x - 6} ${EY - 6})"/>`;
  const brow = (x, tilt, o, y = EY - 25) => `<path d="M${x - 9} ${y + tilt * o} Q${x} ${y - 4} ${x + 9} ${y - tilt * o}" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" opacity=".85"/>`;

  // ---------- mouths (centre 120,146) ----------
  const smile = `<path d="M108 144 Q120 156 132 144" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
  const openMouth = (id, w = 14, h = 20) => `<path d="M${120 - w} 142 Q120 ${142 + h * 1.25} ${120 + w} 142 Q120 146 ${120 - w} 142Z" fill="url(#${id}mouth)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
<clipPath id="${id}mc"><path d="M${120 - w} 142 Q120 ${142 + h * 1.25} ${120 + w} 142 Q120 146 ${120 - w} 142Z"/></clipPath>
<ellipse cx="120" cy="${142 + h * 0.75}" rx="${w * 0.6}" ry="${h * 0.32}" fill="#ff7c93" clip-path="url(#${id}mc)"/>`;

  // ---------- extras ----------
  const tear = (x, y, s = 1) => `<path d="M${x} ${y} C${x - 6 * s} ${y + 11 * s} ${x - 5 * s} ${y + 17 * s} ${x} ${y + 17 * s} C${x + 5 * s} ${y + 17 * s} ${x + 6 * s} ${y + 11 * s} ${x} ${y}Z" fill="#7fd0ff" stroke="#3a9ee0" stroke-width="1.5"/><ellipse cx="${x - 1.5 * s}" cy="${y + 11 * s}" rx="${1.6 * s}" ry="${2.4 * s}" fill="#fff" opacity=".8"/>`;
  const zz = `<g font-family="system-ui,sans-serif" font-weight="900" fill="#b8acff"><text x="168" y="54" font-size="26">z</text><text x="188" y="34" font-size="19">z</text><text x="204" y="18" font-size="13">z</text></g>`;
  const blushBig = (id) => `<ellipse cx="76" cy="142" rx="17" ry="11" fill="url(#${id}blush)"/><ellipse cx="164" cy="142" rx="17" ry="11" fill="url(#${id}blush)"/>`;

  // mood -> { eyes(id), mouth(id), extra(id), arms: 'rest' | 'wave' | 'up' | 'cheeks' }
  const MOODS = {
    happy: { eyes: (id) => eye(LX, id, { outer: -1 }) + eye(RX, id), mouth: () => smile, arms: 'rest' },
    wink: { eyes: (id) => eye(LX, id, { outer: -1 }) + closedUp(RX) + brow(RX, 2, 1), mouth: (id) => openMouth(id, 11, 14), arms: 'wave' },
    sleepy: { eyes: () => closedDown(LX, -1) + closedDown(RX, 1), mouth: () => '<ellipse cx="120" cy="150" rx="5" ry="4" fill="#4a2340"/>', extra: () => zz, arms: 'rest' },
    wow: { eyes: (id) => eye(LX, id, { big: true, outer: -1 }) + eye(RX, id, { big: true }) + brow(LX, 0, 1, EY - 30) + brow(RX, 0, 1, EY - 30), mouth: (id) => `<ellipse cx="120" cy="152" rx="8" ry="11" fill="url(#${id}mouth)" stroke="${INK}" stroke-width="2.4"/><ellipse cx="120" cy="158" rx="5" ry="3" fill="#ff7c93"/>`, arms: 'up' },
    love: { eyes: (id) => heartEye(LX, id) + heartEye(RX, id), mouth: (id) => openMouth(id, 12, 15), extra: (id) => blushBig(id) + `<path d="M196 70 c-6 -5 -2 -12 3 -8 c5 -4 9 3 3 8 l-3 3z" fill="#ff3f6c"/><path d="M40 84 c-4 -3 -1 -8 2 -5 c3 -3 6 2 2 5 l-2 2z" fill="#ff7a9a"/>`, arms: 'cheeks' },
    laugh: { eyes: () => chevron(LX, 1) + chevron(RX, -1), mouth: (id) => openMouth(id, 17, 24), extra: () => tear(74, 118, 0.8) + tear(166, 118, 0.8), arms: 'up' },
    sad: { eyes: (id) => eye(LX, id, { dy: 3, outer: -1 }) + eye(RX, id, { dy: 3 }) + brow(LX, -4, -1) + brow(RX, -4, 1), mouth: () => `<path d="M108 156 Q120 146 132 156" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`, extra: () => tear(86, 134), arms: 'rest' },
    cool: {
      eyes: (id) => `<path d="M80 110 L160 110 Q162 110 161 113 L158 126 Q155 136 144 136 L138 136 Q128 136 125 126 L123 118 L117 118 L115 126 Q112 136 102 136 L96 136 Q85 136 82 126 L79 113 Q78 110 80 110Z" fill="url(#${id}shades)" stroke="#0e0a1c" stroke-width="2"/><path d="M88 116 L100 116 M132 116 L144 116" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/><path d="M80 112 L68 106 M160 112 L172 106" stroke="#0e0a1c" stroke-width="3" stroke-linecap="round"/>`,
      mouth: () => `<path d="M110 150 Q124 154 134 142" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`, arms: 'wave',
    },
    shy: { eyes: (id) => eye(LX, id, { dx: -3, dy: 3, outer: -1 }) + eye(RX, id, { dx: -3, dy: 3 }), mouth: () => `<path d="M113 150 Q119 154 125 150" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>`, extra: (id) => blushBig(id) + blushBig(id), arms: 'cheeks' },
    party: {
      eyes: () => closedUp(LX) + closedUp(RX), mouth: (id) => openMouth(id, 15, 20),
      extra: (id) => `<g transform="rotate(12 150 30)"><path d="M126 46 L150 -14 L174 46 Q150 54 126 46Z" fill="url(#${id}hat)" stroke="#c94a3a" stroke-width="2"/><path d="M134 26 Q150 31 166 26 M141 8 Q150 11 159 8" fill="none" stroke="#ffd23f" stroke-width="5" stroke-linecap="round"/><circle cx="150" cy="-16" r="8" fill="#ffd23f" stroke="#e0a812" stroke-width="2"/></g>
<g>${[[34, 60, '#3db4ff', 20], [206, 92, '#3ddc97', -30], [48, 30, '#ff5d8f', 40], [200, 40, '#ffd23f', 15], [22, 110, '#7c5cff', -20], [218, 150, '#ff7a6b', 30]].map(([x, y, c, r]) => `<rect x="${x}" y="${y}" width="6" height="12" rx="2" fill="${c}" transform="rotate(${r} ${x + 3} ${y + 6})"/>`).join('')}</g>`,
      arms: 'up',
    },
  };

  function arms(pose, id) {
    const arm = (d) => `<path d="${d}" fill="url(#${id}body)" stroke="#c9bdfb" stroke-width="2.5"/>`;
    const restL = 'M32 146 C12 144 2 160 10 170 C18 180 34 170 40 158Z';
    const restR = 'M208 146 C228 144 238 160 230 170 C222 180 206 170 200 158Z';
    switch (pose) {
      case 'wave': return { back: arm(restL) + arm('M204 128 C214 106 226 84 238 88 C250 94 238 118 218 144Z') +
        '<path d="M244 76 q6 4 4 12 M252 70 q8 6 6 18" fill="none" stroke="#b8acff" stroke-width="3" stroke-linecap="round"/>', front: '' };
      case 'up': return { back: arm('M36 132 C16 116 6 92 16 86 C26 82 38 106 50 124Z') + arm('M204 132 C224 116 234 92 224 86 C214 82 202 106 190 124Z'), front: '' };
      case 'cheeks': return { back: '', front: arm('M58 166 C48 156 50 140 62 138 C74 138 78 154 70 164Z') + arm('M182 166 C192 156 190 140 178 138 C166 138 162 154 170 164Z') };
      default: return { back: arm(restL) + arm(restR), front: '' };
    }
  }

  function mascotSVG(mood = 'happy', size = 96, label = 'Puff, the Poof mascot') {
    const m = MOODS[mood] || MOODS.happy;
    const id = 'pf' + (++uid);
    const pose = arms(m.arms, id);
    const lobes = [[120, 86, 60], [66, 124, 44], [174, 122, 46], [92, 154, 40], [150, 156, 40], [158, 60, 26]];
    const lobeSet = (dy = 0, grow = 0) => lobes.map(([x, y, r]) => `<circle cx="${x}" cy="${y + dy}" r="${r + grow}"/>`).join('') +
      `<rect x="${52 - grow}" y="${118 + dy}" width="${136 + grow * 2}" height="${56 + grow}" rx="${28 + grow}"/>`;
    const sparkle = (x, y, s, c) => `<path d="M${x} ${y - 9 * s} C${x + 1.5 * s} ${y - 2 * s} ${x + 2 * s} ${y - 1.5 * s} ${x + 9 * s} ${y} C${x + 2 * s} ${y + 1.5 * s} ${x + 1.5 * s} ${y + 2 * s} ${x} ${y + 9 * s} C${x - 1.5 * s} ${y + 2 * s} ${x - 2 * s} ${y + 1.5 * s} ${x - 9 * s} ${y} C${x - 2 * s} ${y - 1.5 * s} ${x - 1.5 * s} ${y - 2 * s} ${x} ${y - 9 * s}Z" fill="${c}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -34 272 272" width="${size}" height="${size}" role="img" aria-label="${label}">
<defs>
  <radialGradient id="${id}body" gradientUnits="userSpaceOnUse" cx="100" cy="60" r="150"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f6f3ff"/><stop offset="1" stop-color="#cfc4ff"/></radialGradient>
  <linearGradient id="${id}shadow" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#b9abff" stop-opacity="0"/><stop offset="1" stop-color="#9d8cff" stop-opacity=".55"/></linearGradient>
  <radialGradient id="${id}eye" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#4b3d8f"/><stop offset=".6" stop-color="#2a2057"/><stop offset="1" stop-color="#160f33"/></radialGradient>
  <radialGradient id="${id}blush"><stop offset="0" stop-color="#ff6f8e" stop-opacity=".7"/><stop offset="1" stop-color="#ff6f8e" stop-opacity="0"/></radialGradient>
  <linearGradient id="${id}mouth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2346"/><stop offset="1" stop-color="#2e1030"/></linearGradient>
  <linearGradient id="${id}heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a9a"/><stop offset="1" stop-color="#ff2457"/></linearGradient>
  <linearGradient id="${id}shades" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2f6e"/><stop offset="1" stop-color="#0e0a1c"/></linearGradient>
  <linearGradient id="${id}hat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a8a"/><stop offset="1" stop-color="#ff5d6b"/></linearGradient>
  <filter id="${id}blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
  <clipPath id="${id}clip">${lobeSet()}</clipPath>
</defs>
<ellipse cx="120" cy="204" rx="74" ry="9" fill="#120c2a" opacity=".28" filter="url(#${id}blur)"/>
<g fill="#c9bdfb">${lobeSet(0, 3)}</g>
${pose.back}
<g fill="url(#${id}body)">${lobeSet()}</g>
<g clip-path="url(#${id}clip)">
  <rect x="0" y="0" width="240" height="210" fill="url(#${id}shadow)"/>
  <g fill="none" stroke="#d6ccff" stroke-width="3" stroke-linecap="round" opacity=".9">
    <path d="M106 182 Q118 172 132 182"/>
  </g>
  <g fill="#ffffff" opacity=".9"><ellipse cx="96" cy="50" rx="20" ry="9" transform="rotate(-24 96 50)"/><ellipse cx="54" cy="104" rx="10" ry="5" transform="rotate(-40 54 104)"/><ellipse cx="160" cy="44" rx="7" ry="4" transform="rotate(-30 160 44)"/></g>
</g>
<g fill="url(#${id}body)" stroke="#c9bdfb" stroke-width="2.5"><ellipse cx="100" cy="194" rx="15" ry="9"/><ellipse cx="140" cy="194" rx="15" ry="9"/></g>
<ellipse cx="76" cy="142" rx="13" ry="8" fill="url(#${id}blush)"/><ellipse cx="164" cy="142" rx="13" ry="8" fill="url(#${id}blush)"/>
${pose.front}
${m.eyes(id)}
${m.mouth(id)}
${m.extra ? m.extra(id) : ''}
${sparkle(206, 14, 1.3, '#ff7a6b')}${sparkle(30, 40, 0.8, '#b8acff')}<circle cx="214" cy="56" r="3" fill="#ffd23f"/>
</svg>`;
  }

  window.mascotSVG = mascotSVG;
  window.mascotMoods = Object.keys(MOODS);
})();
