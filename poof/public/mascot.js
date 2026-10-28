'use strict';
// Puff, the Poof mascot: a cloud drifting off in a trail of little puffs,
// the way a snap goes "poof". Flat and bold so it reads as a mark at 16px and
// still has room for expression. mascotSVG(mood, size, label, variant) -> SVG
// variant: 'char' (white body, ink outline) | 'mark' (solid, for icons; colour = fill)
(() => {
  const INK = '#1c1538';
  const SHADE = '#e6e0ff';
  const ACCENT = '#ff5a6e';
  const DRIFT = '#a48dff'; // the trail: light enough for dark screens, strong enough for light ones
  let uid = 0;

  // silhouette: one big puff, two side puffs, a flat rounded base, traced as a
  // single outline. Wherever two puffs meet, a small concave fillet joins them,
  // so the edge flows instead of pinching into a notch.
  function cloudPath() {
    // clockwise round the outside: bottom-left corner, left puff, top puff,
    // right puff, bottom-right corner; then a straight base back to the start
    const C = [[61, 121, 21], [64, 106, 28], [104, 82, 40], [142, 102, 30], [147, 121, 21]];
    const FILLET = [18, 12, 12, 18];
    const MID = [104, 112];
    const n = (v) => +v.toFixed(2);
    function fillet([x1, y1, r1], [x2, y2, r2], f) {
      const R1 = r1 + f;
      const R2 = r2 + f;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const d = Math.hypot(dx, dy);
      const l = (R1 * R1 - R2 * R2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, R1 * R1 - l * l));
      const mx = x1 + (dx * l) / d;
      const my = y1 + (dy * l) / d;
      const a = [mx - (dy * h) / d, my + (dx * h) / d];
      const b = [mx + (dy * h) / d, my - (dx * h) / d];
      const P = Math.hypot(a[0] - MID[0], a[1] - MID[1]) > Math.hypot(b[0] - MID[0], b[1] - MID[1]) ? a : b;
      return {
        t1: [x1 + ((P[0] - x1) * r1) / R1, y1 + ((P[1] - y1) * r1) / R1],
        t2: [x2 + ((P[0] - x2) * r2) / R2, y2 + ((P[1] - y2) * r2) / R2],
      };
    }
    // clockwise arc on circle c from point p to point q (screen coords, y down)
    function arc([cx, cy, r], p, q) {
      let delta = Math.atan2(q[1] - cy, q[0] - cx) - Math.atan2(p[1] - cy, p[0] - cx);
      while (delta < 0) delta += Math.PI * 2;
      return `A${r} ${r} 0 ${delta > Math.PI ? 1 : 0} 1 ${n(q[0])} ${n(q[1])}`;
    }
    let cur = [C[0][0], C[0][1] + C[0][2]];
    let d = `M${n(cur[0])} ${n(cur[1])}`;
    for (let i = 0; i < C.length; i++) {
      if (i < C.length - 1) {
        const { t1, t2 } = fillet(C[i], C[i + 1], FILLET[i]);
        d += arc(C[i], cur, t1) + `A${FILLET[i]} ${FILLET[i]} 0 0 0 ${n(t2[0])} ${n(t2[1])}`;
        cur = t2;
      } else {
        d += arc(C[i], cur, [C[i][0], C[i][1] + C[i][2]]) + 'Z';
      }
    }
    return d;
  }
  const BODY = `<path d="${cloudPath()}"/>`;
  const TRAIL = { normal: [[186, 122, 8.5], [204, 108, 5.5], [214, 95, 3]], droop: [[184, 132, 8], [198, 146, 5], [206, 158, 3]] };

  // ---------- face parts (eyes at 91/117, y 100; mouth at y 120) ----------
  const L = 91;
  const R = 117;
  const pill = (x, ink, h = 22, y = 100) => `<rect x="${x - 6.5}" y="${y - h / 2}" width="13" height="${h}" rx="6.5" fill="${ink}"/>`;
  const arcUp = (x, ink) => `<path d="M${x - 8} 104 Q${x} 92 ${x + 8} 104" fill="none" stroke="${ink}" stroke-width="5.5" stroke-linecap="round"/>`;
  const arcDown = (x, ink) => `<path d="M${x - 8} 99 Q${x} 108 ${x + 8} 99" fill="none" stroke="${ink}" stroke-width="5.5" stroke-linecap="round"/>`;
  const round = (x, ink, bg) => `<circle cx="${x}" cy="100" r="9.5" fill="${ink}"/><circle cx="${x + 3}" cy="96.5" r="2.8" fill="${bg}"/>`;
  const heart = (x) => `<path d="M${x} 110 C${x - 15} 101 ${x - 9} 88 ${x} 95 C${x + 9} 88 ${x + 15} 101 ${x} 110Z" fill="${ACCENT}"/>`;
  const stroke = (d, ink, w = 5) => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  // mood -> face(ink, bg) plus optional trail shape and extras
  const MOODS = {
    happy: { face: (k) => pill(L, k) + pill(R, k) + stroke('M96 120 Q104 127 112 120', k) },
    wink: { face: (k) => pill(L, k) + arcUp(R, k) + stroke('M95 119 Q105 128 114 117', k) },
    sleepy: {
      face: (k) => arcDown(L, k) + arcDown(R, k) + `<ellipse cx="104" cy="122" rx="4.5" ry="4" fill="${k}"/>`,
      trail: (k) => `<g fill="${k}" font-family="system-ui,sans-serif" font-weight="900"><text x="178" y="128" font-size="20">z</text><text x="196" y="110" font-size="14">z</text><text x="208" y="96" font-size="10">z</text></g>`,
    },
    wow: { face: (k, bg) => round(L, k, bg) + round(R, k, bg) + `<ellipse cx="104" cy="124" rx="5.5" ry="7" fill="${k}"/>` },
    love: { face: (k) => heart(L) + heart(R) + stroke('M96 120 Q104 127 112 120', k) },
    laugh: { face: (k) => arcUp(L, k) + arcUp(R, k) + `<path d="M93 115 Q104 134 115 115Z" fill="${k}"/>` },
    sad: {
      face: (k, bg) => pill(L, k, 20, 102) + pill(R, k, 20, 102) +
        `<path d="M82 90 L100 90 L82 99Z M126 90 L108 90 L126 99Z" fill="${bg}"/>` + stroke('M96 126 Q104 119 112 126', k),
      droop: true,
    },
    cool: {
      face: (k) => `<path d="M76 94 L132 94 L130 104 Q128 111 120 111 Q111 111 109 104 L107 99 L101 99 L99 104 Q97 111 88 111 Q80 111 78 104Z" fill="${k}"/>` +
        stroke('M97 122 Q106 125 113 117', k),
    },
    shy: {
      face: (k) => pill(L - 2, k, 16, 103) + pill(R - 2, k, 16, 103) + stroke('M99 121 Q103 124 107 121', k, 4.5) +
        `<ellipse cx="78" cy="116" rx="8" ry="4.5" fill="${ACCENT}" opacity=".35"/><ellipse cx="130" cy="116" rx="8" ry="4.5" fill="${ACCENT}" opacity=".35"/>`,
    },
    party: {
      face: (k) => arcUp(L, k) + arcUp(R, k) + `<path d="M93 115 Q104 134 115 115Z" fill="${k}"/>`,
      hat: (k) => `<g transform="rotate(14 112 46)"><path d="M97 54 L112 16 L127 54Z" fill="${ACCENT}" stroke="${k}" stroke-width="5" stroke-linejoin="round"/><path d="M102 42 L122 42" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="112" cy="14" r="6" fill="#ffd23f" stroke="${k}" stroke-width="3"/></g>`,
    },
  };

  function mascotSVG(mood = 'happy', size = 96, label = 'Puff, the Poof mascot', variant = 'char', color = '#ffffff') {
    const m = MOODS[mood] || MOODS.happy;
    const id = 'pf' + (++uid);
    const dots = (m.droop ? TRAIL.droop : TRAIL.normal).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
    const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
    let art;
    if (variant === 'mark') {
      // solid silhouette with the face knocked out: for icons and tiny sizes
      const k = '#000';
      art = `<defs><mask id="${id}k" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="200"><rect width="240" height="200" fill="#fff"/>${m.face(k, '#fff')}</mask></defs>
<g fill="${color}" mask="url(#${id}k)">${BODY}${m.trail ? '' : dots}</g>${m.trail ? m.trail(color) : ''}${m.hat ? m.hat(color) : ''}`;
    } else {
      art = `<defs><clipPath id="${id}c">${BODY}</clipPath></defs>
<g fill="${INK}" stroke="${INK}" stroke-width="12" stroke-linejoin="round">${BODY}</g>
<g fill="#fff">${BODY}</g>
<g clip-path="url(#${id}c)"><ellipse cx="128" cy="160" rx="92" ry="34" fill="${SHADE}"/></g>
<g class="puff-trail" fill="${DRIFT}">${m.trail ? m.trail(DRIFT) : dots}</g>
${m.face(INK, '#fff')}${m.hat ? m.hat(INK) : ''}`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 2 204 168" width="${size}" height="${Math.round(size * 168 / 204)}"${a11y}>${art}</svg>`;
  }

  window.mascotSVG = mascotSVG;
  window.mascotMoods = Object.keys(MOODS);
})();
