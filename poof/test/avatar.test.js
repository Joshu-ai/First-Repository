'use strict';
// Placeholder avatars (public/avatar.js + the 'mark' Puff from mascot.js):
// someone without an avatar shows the white Puff mark on a circle in their
// own colour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Avatar = require('../public/avatar');

const lightness = (css) => Number(css.match(/^hsl\((\d+) 55% (\d+)%\)$/)[2]);

test('placeholder colour: steady per username, the same hue rule as before', () => {
  assert.equal(Avatar.placeholderColor('ben'), Avatar.placeholderColor('ben'));
  assert.notEqual(Avatar.placeholderColor('ben'), Avatar.placeholderColor('ava'));
  // the hue is the one letter avatars always used, so nobody's colour jumps
  let n = 0;
  for (const c of 'ben') n = (n * 31 + c.charCodeAt(0)) % 360;
  assert.equal(Avatar.nameHue('ben'), n);
  assert.match(Avatar.placeholderColor('ben'), new RegExp(`^hsl\\(${n} 55% \\d+%\\)$`));
});

test('placeholder colour: the white mark keeps 3:1 contrast on every hue', () => {
  for (let h = 0; h < 360; h++) {
    const css = Avatar.hueColor(h);
    assert.match(css, /^hsl\(\d+ 55% \d+%\)$/);
    const l = lightness(css);
    const contrast = Avatar.contrastWithWhite(h, 55, l);
    // at least 3:1 (which also means no circle is ever a bright yellow) ...
    assert.ok(contrast >= 3, `hue ${h}: ${contrast.toFixed(2)}:1 is too faint`);
    // ... and darkened no further than needed, so colours stay lively
    if (l < 45) assert.ok(Avatar.contrastWithWhite(h, 55, l + 1) < 3, `hue ${h} is darker than it needs to be`);
    assert.ok(l >= 30, `hue ${h} is muddy at ${l}%`);
  }
  assert.equal(Avatar.hueColor(219), 'hsl(219 55% 45%)', 'blues need no darkening');
});

test('placeholder mark: white, decorative, no text', () => {
  const window = {};
  window.window = window;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mascot.js'), 'utf8'),
    vm.createContext(window), { filename: 'mascot.js' });
  for (const size of [26, 35, 96]) { // 80% of a 32, 44 and 120px circle
    const svg = window.mascotSVG('happy', size, '', 'mark', '#ffffff');
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.doesNotMatch(svg, /role=|aria-label|<text/);
    assert.match(svg, new RegExp(`width="${size}"`));
    assert.match(svg, /<g fill="#ffffff" mask="url\(#pf\d+k\)">/);
  }
  // each one gets its own mask id, so many on one screen never clash
  const ids = [1, 2, 3].map(() => window.mascotSVG('happy', 35, '', 'mark', '#ffffff').match(/mask id="([^"]+)"/)[1]);
  assert.equal(new Set(ids).size, 3);
});
