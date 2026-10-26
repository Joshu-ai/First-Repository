'use strict';
// Puff, the Poof mascot: a small cloud that vanishes. Drawn in code so it
// scales anywhere and can change mood. mascotSVG(mood, size) -> SVG string.
(() => {
  const FACES = {
    happy: {
      eyes: '<ellipse cx="48" cy="58" rx="5" ry="6.5"/><ellipse cx="72" cy="58" rx="5" ry="6.5"/>',
      mouth: '<path d="M53 70 Q60 77 67 70" fill="none" stroke-width="3.5" stroke-linecap="round"/>',
    },
    wink: {
      eyes: '<ellipse cx="48" cy="58" rx="5" ry="6.5"/><path d="M66 59 Q72 53 78 59" fill="none" stroke-width="3.5" stroke-linecap="round"/>',
      mouth: '<path d="M53 69 Q60 78 67 69 Z" stroke-width="2" stroke-linejoin="round"/>',
    },
    sleepy: {
      eyes: '<path d="M42 59 Q48 64 54 59" fill="none" stroke-width="3.5" stroke-linecap="round"/><path d="M66 59 Q72 64 78 59" fill="none" stroke-width="3.5" stroke-linecap="round"/>',
      mouth: '<ellipse cx="60" cy="72" rx="3" ry="2.5"/>',
      extra: '<text x="8" y="26" font-size="14" font-weight="800" font-family="system-ui,sans-serif" fill="#a9a3c7">z</text><text x="20" y="14" font-size="10" font-weight="800" font-family="system-ui,sans-serif" fill="#a9a3c7">z</text>',
    },
    wow: {
      eyes: '<circle cx="48" cy="57" r="6.5"/><circle cx="72" cy="57" r="6.5"/>',
      mouth: '<ellipse cx="60" cy="73" rx="5" ry="6"/>',
    },
    love: {
      eyes: '<path d="M48 64 C38 57 42 49 48 54 C54 49 58 57 48 64Z M72 64 C62 57 66 49 72 54 C78 49 82 57 72 64Z" fill="#ff3f6c" stroke="none"/>',
      mouth: '<path d="M53 69 Q60 78 67 69 Z" stroke-width="2" stroke-linejoin="round"/>',
    },
    laugh: {
      eyes: '<path d="M43 53 L52 58 L43 63 M77 53 L68 58 L77 63" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
      mouth: '<path d="M50 67 Q60 84 70 67 Z" stroke-width="2" stroke-linejoin="round"/><ellipse cx="60" cy="76" rx="4.5" ry="2.5" fill="#ff7a8c" stroke="none"/>',
    },
    sad: {
      eyes: '<ellipse cx="48" cy="60" rx="5" ry="6"/><ellipse cx="72" cy="60" rx="5" ry="6"/><path d="M41 49 L53 46 M67 46 L79 49" fill="none" stroke-width="3" stroke-linecap="round"/>',
      mouth: '<path d="M53 75 Q60 69 67 75" fill="none" stroke-width="3.5" stroke-linecap="round"/>',
      extra: '<path d="M40 66 C36 73 37 77 40 77 C43 77 44 73 40 66Z" fill="#6cc6ff"/>',
    },
    cool: {
      eyes: '<rect x="38" y="52" width="19" height="12" rx="5"/><rect x="63" y="52" width="19" height="12" rx="5"/><path d="M57 56 L63 56" fill="none" stroke-width="3"/><path d="M42 56 L48 56 M67 56 L73 56" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>',
      mouth: '<path d="M54 72 Q62 74 68 68" fill="none" stroke-width="3.5" stroke-linecap="round"/>',
    },
    shy: {
      eyes: '<ellipse cx="45" cy="60" rx="4.5" ry="5.5"/><ellipse cx="69" cy="60" rx="4.5" ry="5.5"/>',
      mouth: '<path d="M55 71 Q59 74 63 71" fill="none" stroke-width="3" stroke-linecap="round"/>',
      extra: '<circle cx="38" cy="69" r="7" fill="#ff5f7e" opacity=".45"/><circle cx="82" cy="69" r="7" fill="#ff5f7e" opacity=".45"/>',
    },
    party: {
      eyes: '<path d="M43 59 Q48 52 53 59 M67 59 Q72 52 77 59" fill="none" stroke-width="3.5" stroke-linecap="round"/>',
      mouth: '<path d="M50 67 Q60 82 70 67 Z" stroke-width="2" stroke-linejoin="round"/>',
      extra: '<path d="M50 20 L60 -4 L70 20 Z" fill="#ff7a6b" transform="translate(0 2)"/><path d="M53 15 L67 15 M56 8 L64 8" stroke="#ffd23f" stroke-width="2.5"/><circle cx="60" cy="-2" r="3.5" fill="#ffd23f"/><g fill="#3db4ff"><rect x="22" y="14" width="4" height="7" rx="1" transform="rotate(25 24 17)"/><rect x="92" y="34" width="4" height="7" rx="1" transform="rotate(-30 94 37)"/></g><g fill="#3ddc97"><rect x="30" y="34" width="4" height="7" rx="1" transform="rotate(-20 32 37)"/><rect x="88" y="10" width="4" height="7" rx="1" transform="rotate(40 90 13)"/></g>',
    },
  };

  function mascotSVG(mood = 'happy', size = 96, label = 'Puff, the Poof mascot') {
    const f = FACES[mood] || FACES.happy;
    const glints = mood === 'happy' || mood === 'wow' || mood === 'wink'
      ? '<circle cx="50" cy="55" r="1.8" fill="#fff"/>' + (mood === 'wink' ? '' : '<circle cx="74" cy="55" r="1.8" fill="#fff"/>')
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -8 120 108" width="${size}" height="${Math.round(size * 108 / 120)}" role="img" aria-label="${label}">
  <g fill="#d9d1ff">
    <circle cx="36" cy="64" r="22"/><circle cx="58" cy="44" r="27"/><circle cx="84" cy="62" r="21"/>
    <rect x="22" y="62" width="78" height="28" rx="14"/>
  </g>
  <g fill="#ffffff">
    <circle cx="36" cy="61" r="21"/><circle cx="58" cy="41" r="26"/><circle cx="84" cy="59" r="20"/>
    <rect x="22" y="58" width="78" height="28" rx="14"/>
  </g>
  <circle cx="38" cy="69" r="5.5" fill="#ff7a6b" opacity=".55"/>
  <circle cx="82" cy="69" r="5.5" fill="#ff7a6b" opacity=".55"/>
  <g fill="#2a2257" stroke="#2a2257">${f.eyes}${f.mouth}</g>
  ${glints}
  <path d="M104 14 l2.2 5.8 5.8 2.2 -5.8 2.2 -2.2 5.8 -2.2 -5.8 -5.8 -2.2 5.8 -2.2z" fill="#ff7a6b"/>
  ${mood === 'sleepy' ? '' : '<circle cx="14" cy="26" r="3" fill="#7c5cff"/>'}
  ${f.extra || ''}
</svg>`;
  }

  window.mascotSVG = mascotSVG;
  window.mascotMoods = Object.keys(FACES);
})();
