'use strict';
// End-to-end: two users in two browsers, using Chromium's fake camera.
// Run: npm run test:e2e   (needs Playwright + Chromium available)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../server');

const SHOTS = path.join(__dirname, '..', 'replica', 'clone-screens');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poof-e2e-'));
  const { server } = createApp({ dataDir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const errors = [];
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/40[0-9]|410/.test(m.text()) && errors.push(m.text()));
    await page.goto(base);
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

  // Controls show Poof's drawn icons (public/icons.js), never emoji or text
  // glyphs. `expected` maps a button's accessible name to its icon name.
  const OLD_GLYPHS = /[💬◉◎🖼⟲✎↶⤓✕➤‹🎲✓]/u;
  const checkIcons = async (page, where, expected) => {
    const found = await page.evaluate((names) => Object.entries(names).map(([label, name]) => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === label);
      const svg = btn && btn.querySelector('svg.i-' + name);
      return [label, !btn ? 'missing button' : !svg ? 'no icon'
        : svg.closest('[aria-hidden="true"]') && svg.getAttribute('viewBox') === '0 0 24 24' ? 'ok' : 'icon not decorative'];
    }), expected);
    for (const [label, result] of found) assert.equal(result, 'ok', `${where}: "${label}" should show the ${expected[label]} icon`);
    const glyphs = await page.evaluate((src) => [...document.querySelectorAll('button')]
      .filter((b) => new RegExp(src, 'u').test(b.textContent) || ['+', 'T', '+ Add'].includes(b.textContent.trim()))
      .map((b) => b.getAttribute('aria-label') || b.textContent.trim()), OLD_GLYPHS.source);
    assert.deepEqual(glyphs, [], `${where}: buttons still use glyph icons: ${glyphs.join(', ')}`);
  };

  try {
    const ava = await open();
    const ben = await open();

    // S01 sign up
    await shot(ava, 'S01-login');
    for (const [page, user, name] of [[ava, 'ava', 'Ava'], [ben, 'ben', 'Ben']]) {
      await page.getByRole('button', { name: 'New here? Sign up' }).click();
      await page.getByLabel('Your name').fill(name);
      await page.getByLabel('Username').fill(user);
      await page.getByLabel('Password').fill('password123');
      await page.getByRole('button', { name: 'Create account' }).click();
      // S11 avatar maker runs once, right after sign up
      await page.getByRole('heading', { name: 'Make your avatar' }).waitFor();
      if (page === ava) {
        await page.getByRole('radio', { name: 'Love' }).click(); // expression tab opens first
        await page.getByRole('tab', { name: 'Hair', exact: true }).click();
        await page.getByRole('radio', { name: 'Afro' }).click();
        await page.getByRole('tab', { name: 'Extras' }).click();
        await page.getByRole('radio', { name: 'Round glasses' }).click();
        await checkIcons(page, 'avatar maker', { Shuffle: 'shuffle' });
        await shot(page, 'S11-avatar-maker');
        await page.getByRole('button', { name: 'Looks like me' }).click();
      } else {
        await page.getByRole('button', { name: 'Skip' }).click();
      }
      await page.getByRole('button', { name: 'Take photo' }).waitFor();
    }
    // Ava's avatar is real art; Ben (skipped) keeps a letter
    assert.equal(await ava.locator('.bar .avatar.has-art').count(), 1);
    assert.equal(await ben.locator('.bar .avatar.has-art').count(), 0);
    await checkIcons(ava, 'camera', {
      'Choose a photo': 'image', 'Flip camera': 'flip', 'Add friends': 'puff-plus',
      Chat: 'chat', Camera: 'camera', Stories: 'stories',
    });

    // S09 add friend, accept
    await ava.getByRole('button', { name: 'Add friends' }).click();
    await ava.getByLabel('Search users').fill('ben');
    await ava.getByRole('button', { name: 'Add', exact: true }).waitFor();
    await checkIcons(ava, 'add friends', { Back: 'back', Add: 'plus' });
    assert.equal(await ava.locator('.search-field svg.i-search').count(), 1, 'search field shows the search icon');
    await ava.getByRole('button', { name: 'Add', exact: true }).click();
    await ava.getByText('Requested').waitFor();
    await ben.getByRole('button', { name: 'Add friends' }).click();
    await ben.getByRole('button', { name: 'Accept' }).click();
    await ben.getByText('You are now friends').waitFor();
    await shot(ben, 'S09-add-friends');
    assert.ok(!(await ben.locator('.scroll').innerText()).includes('null'), 'stray null text on S09');

    // S02 camera -> S03 editor
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Camera', exact: true }).click();
    await ava.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
    await shot(ava, 'S02-camera');
    await ava.getByRole('button', { name: 'Take photo' }).click();
    await ava.getByRole('button', { name: 'Add caption' }).click();
    await ava.getByRole('textbox', { name: 'Caption' }).fill('hello from the test');
    // draw a stroke
    await ava.getByRole('button', { name: 'Draw' }).click();
    const box = await ava.locator('.stage canvas').nth(1).boundingBox();
    await ava.mouse.move(box.x + 40, box.y + 60);
    await ava.mouse.down();
    await ava.mouse.move(box.x + 200, box.y + 160, { steps: 8 });
    await ava.mouse.up();
    await ava.getByRole('button', { name: 'Timer' }).click(); // 5s -> 10s
    await ava.getByRole('button', { name: 'Timer' }).getByText('10s').waitFor();
    await checkIcons(ava, 'editor', {
      'Add caption': 'text', Draw: 'pen', Undo: 'undo', Timer: 'timer', Discard: 'close',
      'Save to device': 'download', 'Send to': 'send',
    });
    await shot(ava, 'S03-editor');

    // S04 send to Ben and the story
    await ava.getByRole('button', { name: 'Send to', exact: true }).click();
    await ava.getByRole('checkbox', { name: /Ben/ }).click();
    await ava.getByRole('checkbox', { name: /My Story/ }).click();
    await checkIcons(ava, 'send to', { 'Back to editing': 'back', Send: 'send' });
    assert.equal(await ava.locator('.row[aria-checked="true"] .check svg.i-check').count(), 2, 'picked rows show a drawn check');
    await shot(ava, 'S04-send-to');
    await ava.getByRole('button', { name: 'Send', exact: true }).click();
    await ava.getByText('Delivered').waitFor();
    await checkIcons(ava, 'inbox', { 'Chat with Ben': 'chat', 'Add friends': 'puff-plus' });
    await shot(ava, 'S05-inbox-sender');

    // S05 Ben sees a new snap live, S06 opens it once
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByText('New snap', { exact: true }).waitFor();
    await shot(ben, 'S05-inbox');
    await ben.getByRole('button', { name: /Ava, New snap/ }).click();
    const img = ben.getByRole('img', { name: 'Snap from Ava' });
    await img.waitFor();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    await checkIcons(ben, 'snap viewer', { Close: 'close' });
    await shot(ben, 'S06-snap-viewer');
    await ben.getByRole('button', { name: 'Next' }).click(); // tap to close
    await ben.getByText('Received').waitFor();
    await ava.getByText('Opened', { exact: true }).waitFor(); // live update to the sender

    // S07 chat both ways, keep a message
    await ben.getByRole('button', { name: 'Chat with Ava' }).click();
    await ben.getByLabel('Message').fill('nice photo');
    await ben.getByRole('button', { name: 'Send', exact: true }).click();
    await ben.getByText('nice photo').waitFor();
    await ava.getByText('New chat', { exact: true }).waitFor();
    await ava.getByRole('button', { name: 'Chat with Ben' }).click();
    await ava.getByText('nice photo').waitFor();
    await ava.getByRole('button', { name: /Message: nice photo/ }).click();
    await ava.getByText(/kept/).waitFor();
    await checkIcons(ava, 'chat', { Back: 'back', 'Snap Ben': 'camera' });
    await shot(ava, 'S07-chat');

    // S08 stories: Ben watches, Ava sees the viewer
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('button', { name: 'Stories', exact: true }).click();
    await ben.getByRole('button', { name: /Ava/ }).first().waitFor();
    await shot(ben, 'S08-stories');
    await ben.locator('.scroll .row').nth(1).click();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    await checkIcons(ben, 'story viewer', { Close: 'close' });
    await shot(ben, 'S08-story-viewer');
    await ben.getByRole('button', { name: 'Close' }).click();
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Stories', exact: true }).click();
    await ava.getByText(/1 viewers/).waitFor();

    // S10 profile + logout
    await ava.getByRole('button', { name: 'Profile' }).click();
    await ava.getByText('Friends (1)').waitFor();
    await checkIcons(ava, 'profile', { Back: 'back' });
    await shot(ava, 'S10-profile');
    await ava.getByRole('button', { name: 'Log out' }).click();
    await ava.getByRole('button', { name: 'Log in' }).waitFor();

    assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
    console.log('e2e: all flows passed. Screenshots in replica/clone-screens/');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => { console.error(e); process.exit(1); });
