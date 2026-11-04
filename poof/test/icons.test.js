'use strict';
// The drawn icon set (public/icons.js): one grid, one stroke, currentColor,
// decorative markup only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const window = {};
  window.window = window;
  const ctx = vm.createContext(window);
  for (const f of ['mascot.js', 'icons.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx, { filename: f });
  }
  return window.PoofIcons;
}

const REQUIRED = ['chat', 'camera', 'stories', 'back', 'close', 'plus', 'search', 'flip', 'flash', 'flash-off',
  'image', 'text', 'pen', 'undo', 'timer', 'download', 'send', 'share', 'scan', 'settings', 'trash', 'user',
  'puff-plus', 'check', 'shuffle', 'sound', 'sound-off', 'chat-new', 'group', 'no-limit', 'streak', 'kept',
  'mark-poof', 'mark-poof-open', 'mark-chat', 'mark-chat-open', 'mark-sent', 'mark-sent-open'];

// every open tag is closed in order (no stray or unbalanced markup)
function balanced(markup) {
  const stack = [];
  for (const [, close, name, selfClose] of markup.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>/g)) {
    if (selfClose) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0;
}

test('every icon the app needs exists and follows the grid', () => {
  const I = load();
  for (const name of REQUIRED) {
    assert.ok(I.names.includes(name), `missing icon ${name}`);
    const svg = I.svg(name);
    const root = svg.match(/^<svg[^>]*>/)[0];
    assert.match(root, /viewBox="0 0 24 24"/, name);
    assert.match(root, /width="24" height="24"/, name);
    assert.match(root, /stroke="currentColor"/, name);
    assert.match(root, /stroke-width="2"/, name);
    assert.match(root, /stroke-linecap="round"/, name);
    assert.match(root, /stroke-linejoin="round"/, name);
    assert.match(root, /fill="none"/, name);
    assert.match(root, /aria-hidden="true"/, name);
    assert.match(root, /focusable="false"/, name);
    assert.doesNotMatch(svg, /role="img"|aria-label|<text|<title/, `${name} must stay decorative`);
    assert.ok(balanced(svg), `${name} markup is unbalanced`);
    // colour comes from the button: outside masks, only currentColor or none
    const visible = svg.replace(/<mask[\s\S]*?<\/mask>/g, '');
    for (const [, value] of visible.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
      assert.ok(['none', 'currentColor'].includes(value), `${name} hard-codes the colour ${value}`);
    }
  }
});

test('size is honoured and bad input is refused', () => {
  const I = load();
  assert.match(I.svg('close', 18), /width="18" height="18"/);
  assert.match(I.svg('close', 'x'), /width="24" height="24"/);
  assert.equal(I.svg('chat'), I.svg('chat'), 'plain icons are static markup');
  assert.throws(() => I.svg('<img src=x onerror=alert(1)>'), /Unknown icon/);
  assert.throws(() => I.svg('nope'), /Unknown icon/);
});

test('puff-plus is the solid Puff silhouette with a plus badge', () => {
  const I = load();
  const a = I.svg('puff-plus');
  const b = I.svg('puff-plus');
  assert.match(a, /<svg x="1" y="5\.5" width="22" height="16\.2" viewBox="36 42 136 100">/, 'embeds Puff cropped to the cloud');
  assert.match(a, /<g fill="currentColor" mask="url\(#pf\d+k\)"><path d="M/, 'uses the solid mark variant');
  assert.match(a, /<circle cx="18\.5" cy="5\.5" r="5" fill="currentColor"/, 'has the badge');
  const ids = (s) => [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids(a).length >= 3);
  assert.equal(new Set([...ids(a), ...ids(b)]).size, ids(a).length + ids(b).length, 'mask ids never repeat');
});
