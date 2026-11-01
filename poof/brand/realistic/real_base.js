// Draw Puff as a "real" cloud (no outline, fluffy lit volume, sky behind) to use as
// the starting image for photoreal image-to-image. usage: node real_base.js <out_dir> <mood...>
const { chromium } = require('playwright');
const path = require('path');

// same silhouette as mascot.js: big top puff, two side puffs, flat base, trail of three
const PUFFS = [[104, 82, 40], [64, 106, 28], [142, 102, 30], [61, 121, 21], [147, 121, 21]];
const FILL = [[80, 118, 26], [104, 120, 28], [128, 118, 26], [104, 100, 30]];
const TRAIL = [[186, 122, 8.5], [204, 108, 5.5], [214, 95, 3]];
const L = 91;
const R = 117;
const eye = (x, y = 100, h = 22) => `<rect x="${x - 6.5}" y="${y - h / 2}" width="13" height="${h}" rx="6.5" fill="#1c1538"/><ellipse cx="${x + 2}" cy="${y - 5}" rx="2.4" ry="3" fill="#fff" opacity=".9"/>`;
const arcUp = (x) => `<path d="M${x - 8} 104 Q${x} 92 ${x + 8} 104" fill="none" stroke="#1c1538" stroke-width="5" stroke-linecap="round"/>`;
const heart = (x) => `<path d="M${x} 110 C${x - 15} 101 ${x - 9} 88 ${x} 95 C${x + 9} 88 ${x + 15} 101 ${x} 110Z" fill="#ff3f63"/>`;
const smile = '<path d="M96 120 Q104 127 112 120" fill="none" stroke="#1c1538" stroke-width="4.5" stroke-linecap="round"/>';
const FACES = {
  happy: eye(L) + eye(R) + smile,
  wink: eye(L) + arcUp(R) + '<path d="M95 119 Q105 128 114 117" fill="none" stroke="#1c1538" stroke-width="4.5" stroke-linecap="round"/>',
  laugh: arcUp(L) + arcUp(R) + '<path d="M93 115 Q104 134 115 115Z" fill="#3a1630"/>',
  love: heart(L) + heart(R) + smile,
  wow: '<circle cx="91" cy="100" r="9.5" fill="#1c1538"/><circle cx="117" cy="100" r="9.5" fill="#1c1538"/><circle cx="94" cy="96.5" r="2.8" fill="#fff"/><circle cx="120" cy="96.5" r="2.8" fill="#fff"/><ellipse cx="104" cy="124" rx="5.5" ry="7" fill="#3a1630"/>',
  sleepy: '<path d="M83 99 Q91 108 99 99 M109 99 Q117 108 125 99" fill="none" stroke="#1c1538" stroke-width="5" stroke-linecap="round"/><ellipse cx="104" cy="122" rx="4.5" ry="4" fill="#3a1630"/>',
  sad: eye(L, 102, 20) + eye(R, 102, 20) + '<path d="M82 90 L100 90 L82 99Z M126 90 L108 90 L126 99Z" fill="#f4f6fb"/><path d="M96 126 Q104 119 112 126" fill="none" stroke="#1c1538" stroke-width="4.5" stroke-linecap="round"/>',
  cool: '<path d="M76 94 L132 94 L130 104 Q128 111 120 111 Q111 111 109 104 L107 99 L101 99 L99 104 Q97 111 88 111 Q80 111 78 104Z" fill="#141022"/><path d="M82 98 L90 98 M112 98 L120 98" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".6"/><path d="M97 122 Q106 125 113 117" fill="none" stroke="#1c1538" stroke-width="4.5" stroke-linecap="round"/>',
  shy: eye(L - 2, 103, 16) + eye(R - 2, 103, 16) + '<path d="M99 121 Q103 124 107 121" fill="none" stroke="#1c1538" stroke-width="4" stroke-linecap="round"/><ellipse cx="78" cy="116" rx="8" ry="4.5" fill="#ff7a90" opacity=".45"/><ellipse cx="130" cy="116" rx="8" ry="4.5" fill="#ff7a90" opacity=".45"/>',
  party: arcUp(L) + arcUp(R) + '<path d="M93 115 Q104 134 115 115Z" fill="#3a1630"/><g transform="rotate(14 112 46)"><path d="M97 54 L112 16 L127 54Z" fill="#ff5a6e"/><path d="M102 42 L122 42" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="112" cy="14" r="6" fill="#ffd23f"/></g>',
};

function svg(mood) {
  // each puff: a soft lit sphere (bright top-left, shaded underside)
  const ball = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#lit)"/>`;
  const fluff = [];
  // small bumps around the edge make the outline billowy instead of geometric
  for (const [x, y, r] of PUFFS) {
    for (let a = 0; a < 360; a += 24) {
      const t = (a * Math.PI) / 180;
      fluff.push(ball(x + Math.cos(t) * r * 0.82, y + Math.sin(t) * r * 0.82, r * 0.34));
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mood === 'party' ? '20 4 204 186' : '20 30 204 160'}" width="768" height="602">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b9be0"/><stop offset="1" stop-color="#b9dcf7"/></linearGradient>
  <radialGradient id="lit" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f1f4fa"/><stop offset="1" stop-color="#c7d0e0"/></radialGradient>
  <linearGradient id="under" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#9aa8c4" stop-opacity="0"/><stop offset="1" stop-color="#8592b3" stop-opacity=".55"/></linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="5"/><feGaussianBlur stdDeviation=".9"/></filter>
  <clipPath id="body">${PUFFS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}<rect x="40" y="100" width="128" height="42" rx="21"/></clipPath>
</defs>
<rect x="0" y="0" width="260" height="220" fill="url(#sky)"/>
<g filter="url(#soft)">
  ${PUFFS.map(([x, y, r]) => ball(x, y, r)).join('')}${FILL.map(([x, y, r]) => ball(x, y, r)).join('')}
  ${fluff.join('')}
  <rect x="40" y="100" width="128" height="42" rx="21" fill="url(#lit)"/>
  <rect x="20" y="60" width="200" height="100" fill="url(#under)" clip-path="url(#body)"/>
  ${TRAIL.map(([x, y, r]) => ball(x, y, r)).join('')}
</g>
${FACES[mood]}
</svg>`;
}

(async () => {
  const [out, ...moods] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 768, height: 602 } });
  for (const mood of moods) {
    await p.setContent(`<body style="margin:0">${svg(mood)}</body>`);
    await p.screenshot({ path: path.join(out, `${mood}.png`), clip: { x: 0, y: 0, width: 768, height: 602 } });
  }
  await b.close();
})();
