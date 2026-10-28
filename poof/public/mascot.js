'use strict';
// Puff, the Poof mascot: a small cloud that vanishes. Drawn in code so it
// scales anywhere and can change mood. mascotSVG(mood, size, label) -> SVG string.
(() => {
  const INK = '#22184a';
  const LINE = '#7a64e6'; // outline: keeps Puff readable at small sizes and on white
  let uid = 0;

  // face layout
  const LX = 99;
  const RX = 141;
  const EY = 126;
  const MY = 152;

  // ---------- eyes ----------
  function eye(x, id, { dx = 0, dy = 0, big = false, outer = 1 } = {}) {
    const rx = big ? 16 : 14;
    const ry = big ? 17 : 17.5;
    const cx = x + dx;
    const cy = EY + dy;
    return `<ellipse cx="${x}" cy="${EY}" rx="${rx}" ry="${ry}" fill="url(#${id}eye)"/>
<ellipse cx="${cx}" cy="${cy + ry * 0.42}" rx="${rx * 0.66}" ry="${ry * 0.36}" fill="url(#${id}iris)"/>
<ellipse cx="${cx + 4.5}" cy="${cy - 6}" rx="${big ? 6 : 5.2}" ry="${big ? 6.5 : 6.2}" fill="#fff"/>
<circle cx="${cx - 5}" cy="${cy + 5.5}" r="${big ? 2.8 : 2.4}" fill="#fff" opacity=".9"/>
<path d="M${x - rx} ${EY - 5} Q${x} ${EY - ry - 5} ${x + rx} ${EY - 5}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }
  const closedUp = (x) => `<path d="M${x - 13} ${EY + 4} Q${x} ${EY - 11} ${x + 13} ${EY + 4}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`;
  const closedDown = (x, o) => `<path d="M${x - 13} ${EY} Q${x} ${EY + 11} ${x + 13} ${EY}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/><path d="M${x + o * 12} ${EY + 1} l${o * 6} 4" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;
  const chevron = (x, d) => `<path d="M${x - 10 * d} ${EY - 10} L${x + 9 * d} ${EY} L${x - 10 * d} ${EY + 10}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const heartEye = (x, id) => `<path d="M${x} ${EY + 15} C${x - 25} ${EY + 1} ${x - 14} ${EY - 22} ${x} ${EY - 9} C${x + 14} ${EY - 22} ${x + 25} ${EY + 1} ${x} ${EY + 15}Z" fill="url(#${id}heart)" stroke="#b80f3c" stroke-width="2"/><ellipse cx="${x - 7}" cy="${EY - 6}" rx="4.5" ry="3" fill="#fff" opacity=".9" transform="rotate(-30 ${x - 7} ${EY - 6})"/>`;
  const brow = (x, tilt, o, y = EY - 28) => `<path d="M${x - 10} ${y + tilt * o} Q${x} ${y - 5} ${x + 10} ${y - tilt * o}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;

  // ---------- mouths ----------
  const smile = `<path d="M108 ${MY - 2} Q120 ${MY + 11} 132 ${MY - 2}" fill="none" stroke="${INK}" stroke-width="4.8" stroke-linecap="round"/>`;
  function openMouth(id, w = 12, h = 16) {
    const d = `M${120 - w} ${MY - 3} Q120 ${MY - 3 + h * 1.3} ${120 + w} ${MY - 3} Q120 ${MY} ${120 - w} ${MY - 3}Z`;
    return `<clipPath id="${id}mc"><path d="${d}"/></clipPath>
<path d="${d}" fill="url(#${id}mouth)"/>
<ellipse cx="120" cy="${MY - 3 + h * 0.85}" rx="${w * 0.62}" ry="${h * 0.38}" fill="#ff7c93" clip-path="url(#${id}mc)"/>
<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>`;
  }

  // ---------- extras ----------
  const tear = (x, y, s = 1) => `<path d="M${x} ${y} C${x - 6 * s} ${y + 11 * s} ${x - 5 * s} ${y + 17 * s} ${x} ${y + 17 * s} C${x + 5 * s} ${y + 17 * s} ${x + 6 * s} ${y + 11 * s} ${x} ${y}Z" fill="#7fd0ff" stroke="#2f8fd6" stroke-width="1.8"/><ellipse cx="${x - 1.5 * s}" cy="${y + 11 * s}" rx="${1.6 * s}" ry="${2.4 * s}" fill="#fff" opacity=".85"/>`;
  const zz = '<g font-family="system-ui,sans-serif" font-weight="900" fill="#c3b8ff" stroke="#7a64e6" stroke-width="1.5" paint-order="stroke"><text x="186" y="56" font-size="28">z</text><text x="208" y="34" font-size="20">z</text><text x="224" y="16" font-size="14">z</text></g>';
  const blushBig = (id) => `<ellipse cx="76" cy="150" rx="18" ry="11" fill="url(#${id}blush)"/><ellipse cx="164" cy="150" rx="18" ry="11" fill="url(#${id}blush)"/>`;

  // mood -> { eyes, mouth, extra, arms, wisp (default true) }
  const MOODS = {
    happy: { eyes: (id) => eye(LX, id, { outer: -1 }) + eye(RX, id), mouth: (id) => openMouth(id, 10, 12), arms: 'rest' },
    wink: { eyes: (id) => eye(LX, id, { outer: -1 }) + closedUp(RX), mouth: (id) => openMouth(id, 11, 14), arms: 'wave' },
    sleepy: { eyes: () => closedDown(LX, -1) + closedDown(RX, 1), mouth: () => `<ellipse cx="120" cy="${MY + 3}" rx="5.5" ry="4.5" fill="#3e1a3a" stroke="${INK}" stroke-width="2"/>`, extra: () => zz, arms: 'rest' },
    wow: { eyes: (id) => eye(LX, id, { big: true, outer: -1 }) + eye(RX, id, { big: true }) + brow(LX, 0, 1, EY - 34) + brow(RX, 0, 1, EY - 34), mouth: (id) => `<ellipse cx="120" cy="${MY + 5}" rx="8.5" ry="11" fill="url(#${id}mouth)" stroke="${INK}" stroke-width="2.8"/><ellipse cx="120" cy="${MY + 11}" rx="5" ry="3" fill="#ff7c93"/>`, arms: 'up' },
    love: { eyes: (id) => heartEye(LX, id) + heartEye(RX, id), mouth: (id) => openMouth(id, 12, 15), extra: (id) => blushBig(id) + '<path d="M212 74 c-7 -6 -2 -14 4 -9 c6 -5 11 3 4 9 l-4 4z" fill="#ff3f6c" stroke="#b80f3c" stroke-width="1.5"/><path d="M24 90 c-5 -4 -1 -10 3 -6 c4 -4 8 2 3 6 l-3 3z" fill="#ff7a9a"/>', arms: 'cheeks' },
    laugh: { eyes: () => chevron(LX, 1) + chevron(RX, -1), mouth: (id) => openMouth(id, 17, 22), extra: () => tear(72, 122, 0.85) + tear(168, 122, 0.85), arms: 'up' },
    sad: { eyes: (id) => eye(LX, id, { dy: 3, outer: -1 }) + eye(RX, id, { dy: 3 }) + brow(LX, -4, -1) + brow(RX, -4, 1), mouth: () => `<path d="M108 ${MY + 8} Q120 ${MY - 3} 132 ${MY + 8}" fill="none" stroke="${INK}" stroke-width="4.8" stroke-linecap="round"/>`, extra: () => tear(84, 142), arms: 'rest' },
    cool: {
      eyes: (id) => `<path d="M76 114 L164 114 Q167 114 166 118 L163 132 Q159 144 147 144 L140 144 Q129 144 126 133 L124 124 L116 124 L114 133 Q111 144 100 144 L93 144 Q81 144 77 132 L74 118 Q73 114 76 114Z" fill="url(#${id}shades)" stroke="#0b0818" stroke-width="2.4"/><path d="M85 121 L99 121 M131 121 L145 121" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".6"/><path d="M75 116 L62 109 M165 116 L178 109" stroke="#0b0818" stroke-width="3.5" stroke-linecap="round"/>`,
      mouth: () => `<path d="M110 ${MY + 2} Q125 ${MY + 6} 135 ${MY - 7}" fill="none" stroke="${INK}" stroke-width="4.8" stroke-linecap="round"/>`, arms: 'wave',
    },
    shy: { eyes: (id) => eye(LX, id, { dx: -4, dy: 4, outer: -1 }) + eye(RX, id, { dx: -4, dy: 4 }), mouth: () => `<path d="M114 ${MY + 2} Q120 ${MY + 6} 126 ${MY + 2}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`, extra: (id) => blushBig(id) + blushBig(id), arms: 'cheeks' },
    party: {
      eyes: () => closedUp(LX) + closedUp(RX), mouth: (id) => openMouth(id, 15, 20), wisp: false,
      extra: (id) => `<g transform="rotate(14 146 30)"><path d="M120 44 L146 -18 L172 44 Q146 53 120 44Z" fill="url(#${id}hat)" stroke="#b8402f" stroke-width="2.4"/><path d="M129 24 Q146 30 163 24 M137 5 Q146 9 155 5" fill="none" stroke="#ffd23f" stroke-width="5.5" stroke-linecap="round"/><circle cx="146" cy="-20" r="9" fill="#ffd23f" stroke="#d99a12" stroke-width="2.2"/></g>
<g>${[[24, 64, '#3db4ff', 20], [214, 96, '#3ddc97', -30], [40, 30, '#ff5d8f', 40], [206, 44, '#ffd23f', 15], [12, 116, '#7c5cff', -20], [226, 150, '#ff7a6b', 30]].map(([x, y, c, r]) => `<rect x="${x}" y="${y}" width="7" height="13" rx="2" fill="${c}" transform="rotate(${r} ${x + 3} ${y + 6})"/>`).join('')}</g>`,
      arms: 'up',
    },
  };

  // ---------- limbs ----------
  function arms(pose, id) {
    const arm = (d) => `<path d="${d}" fill="url(#${id}limb)" stroke="${LINE}" stroke-width="3.5" stroke-linejoin="round"/>`;
    const restL = 'M38 146 C16 142 4 158 12 170 C20 182 38 172 46 160Z';
    const restR = 'M202 146 C224 142 236 158 228 170 C220 182 202 172 194 160Z';
    switch (pose) {
      case 'wave': return {
        back: arm(restL) + arm('M200 126 C210 104 222 82 234 86 C246 92 236 116 216 142Z'),
        front: '<path d="M242 72 q7 5 5 14 M251 64 q9 7 7 20" fill="none" stroke="#c3b8ff" stroke-width="3.5" stroke-linecap="round"/>',
      };
      case 'up': return { back: arm('M40 132 C18 116 6 92 16 84 C26 78 40 104 54 124Z') + arm('M200 132 C222 116 234 92 224 84 C214 78 200 104 186 124Z'), front: '' };
      case 'cheeks': return { back: '', front: arm('M54 172 C42 162 44 144 58 142 C72 142 76 160 68 170Z') + arm('M186 172 C198 162 196 144 182 142 C168 142 164 160 172 170Z') };
      default: return { back: arm(restL) + arm(restR), front: '' };
    }
  }

  // the cloud: outer puffs, then a central face puff on top so the creases read
  const PUFFS = [[146, 74, 44], [94, 86, 40], [186, 122, 36], [54, 130, 34]];
  const FACE = [120, 130, 64];

  function mascotSVG(mood = 'happy', size = 96, label = 'Puff, the Poof mascot') {
    const m = MOODS[mood] || MOODS.happy;
    const id = 'pf' + (++uid);
    const pose = arms(m.arms, id);
    const all = [...PUFFS, FACE];
    const circles = (grow, attrs = '') => all.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + grow}"${attrs}/>`).join('');
    const sparkle = (x, y, s, c) => `<path d="M${x} ${y - 9 * s} C${x + 1.5 * s} ${y - 2 * s} ${x + 2 * s} ${y - 1.5 * s} ${x + 9 * s} ${y} C${x + 2 * s} ${y + 1.5 * s} ${x + 1.5 * s} ${y + 2 * s} ${x} ${y + 9 * s} C${x - 1.5 * s} ${y + 2 * s} ${x - 2 * s} ${y + 1.5 * s} ${x - 9 * s} ${y} C${x - 2 * s} ${y - 1.5 * s} ${x - 1.5 * s} ${y - 2 * s} ${x} ${y - 9 * s}Z" fill="${c}"/>`;
    const wisp = 'M150 34 C146 18 160 6 174 12 C186 18 182 34 170 34 C162 34 160 24 168 22';
    const label_ = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -30 272 272" width="${size}" height="${size}"${label_}>
<defs>
  <radialGradient id="${id}puff" cx=".36" cy=".3" r=".78"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f7f4ff"/><stop offset=".85" stop-color="#e2daff"/><stop offset="1" stop-color="#cdc1ff"/></radialGradient>
  <radialGradient id="${id}face" cx=".42" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#faf8ff"/><stop offset=".92" stop-color="#e6dfff"/><stop offset="1" stop-color="#d3c8ff"/></radialGradient>
  <radialGradient id="${id}limb" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6ccff"/></radialGradient>
  <linearGradient id="${id}shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".62" stop-color="#8f7cff" stop-opacity="0"/><stop offset="1" stop-color="#7c64f0" stop-opacity=".5"/></linearGradient>
  <linearGradient id="${id}eye" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140d33"/><stop offset=".6" stop-color="#2a1f63"/><stop offset="1" stop-color="#3d2f8a"/></linearGradient>
  <radialGradient id="${id}iris" cx=".5" cy=".6" r=".6"><stop offset="0" stop-color="#b6a6ff"/><stop offset=".6" stop-color="#7c5cff" stop-opacity=".8"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}blush"><stop offset="0" stop-color="#ff6f8e" stop-opacity=".75"/><stop offset=".7" stop-color="#ff8fa6" stop-opacity=".35"/><stop offset="1" stop-color="#ff8fa6" stop-opacity="0"/></radialGradient>
  <linearGradient id="${id}mouth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2346"/><stop offset="1" stop-color="#2a0e2c"/></linearGradient>
  <linearGradient id="${id}heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff86a3"/><stop offset="1" stop-color="#ff2457"/></linearGradient>
  <linearGradient id="${id}shades" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d3175"/><stop offset="1" stop-color="#0b0818"/></linearGradient>
  <linearGradient id="${id}hat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa292"/><stop offset="1" stop-color="#ff5466"/></linearGradient>
  <filter id="${id}blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <clipPath id="${id}clip">${circles(0)}</clipPath>
</defs>
<ellipse cx="120" cy="212" rx="70" ry="9" fill="#0c0820" opacity=".3" filter="url(#${id}blur)"/>
<g fill="url(#${id}limb)" stroke="${LINE}" stroke-width="3.5"><ellipse cx="102" cy="198" rx="14" ry="11"/><ellipse cx="138" cy="198" rx="14" ry="11"/></g>
${pose.back}
${m.wisp === false ? '' : `<path d="${wisp}" fill="none" stroke="${LINE}" stroke-width="13" stroke-linecap="round"/><path d="${wisp}" fill="none" stroke="#fbfaff" stroke-width="7" stroke-linecap="round"/>`}
<g fill="${LINE}">${circles(3.5)}</g>
<g>${PUFFS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}puff)"/>`).join('')}</g>
<g clip-path="url(#${id}clip)">
  <circle cx="${FACE[0]}" cy="${FACE[1]}" r="${FACE[2]}" fill="url(#${id}face)"/>
  <path d="M72 92 A64 64 0 0 1 168 92" fill="none" stroke="#c9bdff" stroke-width="3.5" stroke-linecap="round" opacity=".45"/>
  <rect x="-20" y="0" width="280" height="210" fill="url(#${id}shade)"/>
  <g fill="#fff"><ellipse cx="86" cy="62" rx="16" ry="7" transform="rotate(-30 86 62)" opacity=".95"/><ellipse cx="138" cy="44" rx="10" ry="5" transform="rotate(-18 138 44)" opacity=".9"/><ellipse cx="40" cy="112" rx="8" ry="4" transform="rotate(-45 40 112)" opacity=".85"/><circle cx="104" cy="56" r="3" opacity=".9"/></g>
</g>
${pose.front}
<ellipse cx="78" cy="150" rx="15" ry="9" fill="url(#${id}blush)"/><ellipse cx="162" cy="150" rx="15" ry="9" fill="url(#${id}blush)"/>
<circle cx="83" cy="146" r="2" fill="#fff" opacity=".9"/><circle cx="167" cy="146" r="2" fill="#fff" opacity=".9"/>
${m.eyes(id)}
${m.mouth(id)}
${m.extra ? m.extra(id) : ''}
${sparkle(214, 6, 1.4, '#ff7a6b')}${sparkle(22, 30, 0.9, '#c3b8ff')}<circle cx="226" cy="54" r="3.5" fill="#ffd23f"/>
</svg>`;
  }

  window.mascotSVG = mascotSVG;
  window.mascotMoods = Object.keys(MOODS);
})();
