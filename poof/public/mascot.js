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
  };

  function mascotSVG(mood = 'happy', size = 96, label = 'Puff, the Poof mascot') {
    const f = FACES[mood] || FACES.happy;
    const glints = mood === 'happy' || mood === 'wow' || mood === 'wink'
      ? '<circle cx="50" cy="55" r="1.8" fill="#fff"/>' + (mood === 'wink' ? '' : '<circle cx="74" cy="55" r="1.8" fill="#fff"/>')
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="${size}" height="${Math.round(size * 100 / 120)}" role="img" aria-label="${label}">
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
