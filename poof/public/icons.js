'use strict';
// Poof's own drawn icon set. One 24x24 grid, 2px stroke, round caps and joins,
// everything in currentColor so an icon takes the colour of its button.
// PoofIcons.svg(name, size = 24) -> static SVG markup (decorative: aria-hidden).
// The button around an icon carries the accessible name, never the icon.
(function (root) {
  // Each entry is the inner markup on the 24x24 grid. Paths are stroked;
  // anything solid sets fill="currentColor" stroke="none" itself.
  const DOT = (x, y, r = 1.25) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
  const ICONS = {
    // an oval speech bubble with its tail low on the left
    chat: '<path d="M12 4c4.97 0 9 3.36 9 7.5S16.97 19 12 19c-1.1 0-2.16-.16-3.13-.47L4 20l1.33-3.62C3.87 15.05 3 13.36 3 11.5 3 7.36 7.03 4 12 4z"/>',
    // the chat bubble with a plus inside: start a new chat
    'chat-new': '<path d="M12 4c4.97 0 9 3.36 9 7.5S16.97 19 12 19c-1.1 0-2.16-.16-3.13-.47L4 20l1.33-3.62C3.87 15.05 3 13.36 3 11.5 3 7.36 7.03 4 12 4z"/><path d="M12 8.5v6M9 11.5h6"/>',
    // two people, one just behind the other: a group
    group: '<circle cx="9.5" cy="8.5" r="3.5"/><path d="M3 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.3a3.2 3.2 0 0 1 0 6.4M18.5 14.6A6.5 6.5 0 0 1 21 20"/>',
    camera: '<path d="M4 8h3l1.5-2.25A1.7 1.7 0 0 1 9.9 5h4.2a1.7 1.7 0 0 1 1.4.75L17 8h3a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    // a story ring broken into three segments, around a face-sized dot
    stories: '<path d="M13.56 3.14A9 9 0 0 1 20.46 15.08M18.89 17.79A9 9 0 0 1 5.11 17.79M3.54 15.08A9 9 0 0 1 10.44 3.14"/><circle cx="12" cy="12" r="4"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
    // two arrows chasing each other round: switch front and back camera
    flip: '<path d="M4.95 9.43A7.5 7.5 0 0 1 17.75 7.18M18.07 3.69l-.32 3.49-3.49-.32M19.05 14.57A7.5 7.5 0 0 1 6.25 16.82M5.93 20.31l.32-3.49 3.49.32"/>',
    flash: '<path d="M13.5 3 5.5 13.5H11L10.5 21l8-10.5H13L13.5 3z"/>',
    // the bolt, cut where the slash crosses it so the two never touch
    'flash-off': '<path d="M13.11 8.87 13.5 3l-2.71 3.55M7.12 11.37 5.5 13.5h3.76M10.89 15.13 10.5 21l2.7-3.55M16.88 12.63l1.62-2.13h-3.76M4 4l16 16"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="15.5" cy="9.5" r="1.5"/><path d="M3.5 17 8.5 12l4 4 2.5-2.5 5.5 5.5"/>',
    // a drawn capital T with small feet, for "add text"
    text: '<path d="M5.5 7.5V5h13v2.5M12 5v14M9.5 19h5"/>',
    pen: '<path d="M4.5 19.5 5.5 15 15.6 4.9a2 2 0 0 1 2.83 0l.67.67a2 2 0 0 1 0 2.83L9 18.5l-4.5 1z"/><path d="M13.5 7l3.5 3.5"/>',
    undo: '<path d="M8.5 14.5 4 10l4.5-4.5"/><path d="M4 10h10a5.5 5.5 0 0 1 0 11h-3"/>',
    timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4M12 3v3.5M18 6.5l1.5-1.5"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    // a paper plane
    send: '<path d="M20.5 3.5 3.5 10.5l7.5 2.5 2.5 7.5 7-17z"/><path d="M20.5 3.5 11 13"/>',
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4M8 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H16"/>',
    scan: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5M7 12h10"/>',
    // two sliders: adjust how things work
    settings: '<path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="15" cy="7.5" r="2.5"/><circle cx="9" cy="16.5" r="2.5"/>',
    trash: '<path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6 7l1 12.1A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.9L18 7M10 11v6M14 11v6"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    // a speaker sending out two waves: the video's sound is on
    sound: '<path d="M3.5 9.5h3l5-4.5v14l-5-4.5h-3z"/><path d="M15.5 9a3.5 3.5 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/>',
    // the same speaker with a cross where the waves were: muted
    'sound-off': '<path d="M3.5 9.5h3l5-4.5v14l-5-4.5h-3z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
    // a die: pick something at random
    shuffle: `<rect x="4" y="4" width="16" height="16" rx="3.5"/>${DOT(8.75, 8.75)}${DOT(12, 12)}${DOT(15.25, 15.25)}`,
  };

  let uid = 0;
  // Puff's solid silhouette (face knocked out) with a plus badge on the corner.
  // Built fresh each call so its mask ids never collide on the page.
  function puffPlus() {
    const id = 'pi' + (++uid);
    const mark = typeof root.mascotSVG === 'function' ? root.mascotSVG('happy', 22, '', 'mark', 'currentColor') : '';
    // crop to the cloud body (the drifting trail is too small to read here) and
    // place it low on the grid, leaving the top right corner for the badge
    const body = mark.replace(/^<svg[^>]*>/, '<svg x="1" y="5.5" width="22" height="16.2" viewBox="36 42 136 100">');
    return `<defs><mask id="${id}g" stroke="none" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="18.5" cy="5.5" r="6.5" fill="#000"/></mask>` +
      `<mask id="${id}b" stroke="none" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="M18.5 3v5M16 5.5h5" stroke="#000"/></mask></defs>` +
      `<g mask="url(#${id}g)" stroke="none">${body}</g>` +
      `<circle cx="18.5" cy="5.5" r="5" fill="currentColor" stroke="none" mask="url(#${id}b)"/>`;
  }

  function svg(name, size = 24) {
    const inner = name === 'puff-plus' ? puffPlus() : ICONS[name];
    if (inner === undefined) throw new Error('Unknown icon: ' + name);
    const s = Number(size) > 0 ? Number(size) : 24;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="i i-${name}">${inner}</svg>`;
  }

  root.PoofIcons = { svg, names: [...Object.keys(ICONS), 'puff-plus'] };
})(typeof window !== 'undefined' ? window : globalThis);
