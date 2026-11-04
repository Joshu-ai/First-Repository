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
  const viewport = { width: 390, height: 844 };
  // `context` adds browser context options; `before` runs on the page before it loads
  const open = async ({ context, before } = {}) => {
    const ctx = await browser.newContext({ viewport, permissions: ['camera'], ...context });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/40[0-9]|410/.test(m.text()) && errors.push(m.text()));
    if (before) await before(page);
    await page.goto(base);
    return page;
  };
  // records whether the launch splash ever started its fade
  const watchSplash = (page) => page.addInitScript(() => {
    window.splashFaded = false;
    new MutationObserver(() => {
      if (document.getElementById('splash')?.classList.contains('leaving')) window.splashFaded = true;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
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

  // Someone without an avatar gets the white Puff mark on a circle in their own
  // colour: no letter, the mark centred at 80% of the circle, every puff of its
  // trail inside the circle, and at least 3:1 contrast for the white mark.
  const checkPlaceholder = async (loc, where, size) => {
    assert.equal(await loc.count(), 1, `${where}: shows one placeholder avatar`);
    const r = await loc.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const svg = el.querySelector('svg');
      const art = svg.getBoundingClientRect();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const mark = svg.querySelector('g[mask]');
      const reach = Math.max(...[...mark.querySelectorAll('circle')].map((c) => {
        const b = c.getBoundingClientRect();
        return Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy) + b.width / 2;
      }));
      return {
        w: box.width, h: box.height, round: getComputedStyle(el).borderRadius, text: el.textContent.trim(),
        hidden: el.getAttribute('aria-hidden'), art: el.classList.contains('has-art'), fill: mark.getAttribute('fill'),
        artW: art.width, artH: art.height, dx: art.x + art.width / 2 - cx, dy: art.y + art.height / 2 - cy, reach,
        bg: getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number),
      };
    });
    assert.deepEqual([r.w, r.h], [size, size], `${where}: ${size}px circle`);
    assert.equal(r.round, '50%', `${where}: round`);
    assert.equal(r.text, '', `${where}: no initial letter`);
    assert.equal(r.hidden, 'true', `${where}: decorative`);
    assert.equal(r.art, false, `${where}: has-art is only for real avatar art`);
    assert.equal(r.fill, '#ffffff', `${where}: white Puff mark`);
    assert.ok(Math.abs(r.artW - size * 0.8) <= 1, `${where}: mark is 80% of the circle (${r.artW}px)`);
    assert.ok(Math.abs(r.artH - r.artW * 168 / 204) <= 1, `${where}: mark keeps its shape`);
    assert.ok(Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1, `${where}: mark is centred (${r.dx}, ${r.dy})`);
    assert.ok(r.reach < size / 2, `${where}: the trail stays inside the circle`);
    const lum = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [red, green, blue] = r.bg.map(lum);
    const contrast = 1.05 / (0.2126 * red + 0.7152 * green + 0.0722 * blue + 0.05);
    assert.ok(contrast >= 2.95, `${where}: white mark has ${contrast.toFixed(2)}:1 contrast`); // rgb rounding
  };

  try {
    // S00 launch splash: brand violet and the white Puff mark, there before any script runs
    const noJs = await (await browser.newContext({ viewport, javaScriptEnabled: false })).newPage();
    await noJs.goto(base);
    assert.ok(await noJs.locator('#splash svg').isVisible(), 'splash shows without JavaScript');
    assert.equal(await noJs.locator('#splash').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(109, 76, 255)');
    await noJs.context().close();
    // hold the session check to see the splash, then let it go: it fades away
    let release;
    const held = new Promise((r) => (release = r));
    const early = await open({ before: async (page) => {
      await watchSplash(page);
      await page.route('**/api/me', async (route) => { await held; await route.continue(); });
    } });
    await early.locator('#splash svg').waitFor();
    await shot(early, 'S00-splash');
    release();
    await early.locator('#splash').waitFor({ state: 'detached' });
    await early.getByRole('button', { name: 'Sign up' }).waitFor();
    assert.equal(await early.evaluate(() => window.splashFaded), true, 'splash fades out');
    await early.context().close();
    // with reduced motion it just goes, no fade
    const calm = await open({ context: { reducedMotion: 'reduce' }, before: watchSplash });
    await calm.locator('#splash').waitFor({ state: 'detached' });
    assert.equal(await calm.evaluate(() => window.splashFaded), false, 'no fade with reduced motion');
    await calm.context().close();

    const ava = await open();
    const ben = await open();

    // S01 welcome: violet edge to edge, Puff, and both choices in the thumb zone
    await ava.locator('#splash').waitFor({ state: 'detached' });
    await ava.getByRole('heading', { name: 'Poof' }).waitFor();
    assert.ok(await ava.getByRole('img', { name: 'Puff, the Poof mascot' }).isVisible());
    for (const name of ['Log in', 'Sign up']) {
      const b = await ava.getByRole('button', { name }).boundingBox();
      assert.ok(b.height >= 44 && b.width >= viewport.width - 2 * 24, `${name} is a full-width button`);
      assert.ok(b.y > viewport.height * 0.7, `${name} sits in the thumb zone`);
    }
    assert.equal(await ava.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#6d4cff');
    await shot(ava, 'S01-welcome');

    // S01 sign up, one step at a time
    for (const [page, user, name] of [[ava, 'ava', 'Ava'], [ben, 'ben', 'Ben']]) {
      await page.getByRole('button', { name: 'Sign up' }).click();
      await page.getByText('Step 1 of 3').waitFor();
      assert.equal(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#14121f');
      await page.getByLabel('Your name').fill(name);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByText('Step 2 of 3').waitFor();
      if (page === ben) {
        // Ava has the name by now: the live check says so and Continue stays put
        await page.getByLabel('Username').fill('Ava');
        await page.getByText('That username is taken.').waitFor();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByText('That username is taken.').waitFor();
        assert.equal(await page.getByText('Step 3 of 3').count(), 0, 'a taken name does not move on');
        assert.equal(await page.getByLabel('Username').getAttribute('aria-invalid'), 'true');
        // Back keeps the answers, and Enter submits
        await page.getByRole('button', { name: 'Back' }).click();
        await page.getByText('Step 1 of 3').waitFor();
        assert.equal(await page.getByLabel('Your name').inputValue(), 'Ben');
        await page.keyboard.press('Enter');
        await page.getByText('Step 2 of 3').waitFor();
      }
      await page.getByLabel('Username').fill(user);
      await page.getByText(`${user} is available`).waitFor();
      if (page === ava) {
        await checkIcons(page, 'sign up', { Back: 'back' });
        await shot(page, 'S01-signup-username');
      }
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByText('Step 3 of 3').waitFor();
      const password = page.getByLabel('Password', { exact: true });
      await password.fill('password123');
      if (page === ava) {
        await page.getByRole('button', { name: 'Show password' }).click();
        assert.equal(await password.getAttribute('type'), 'text');
        await page.getByRole('button', { name: 'Hide password' }).click();
        assert.equal(await password.getAttribute('type'), 'password');
      }
      await page.keyboard.press('Enter');
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
    // Ava's avatar is real art; Ben (skipped) gets the Puff placeholder
    assert.equal(await ava.locator('.bar .avatar.has-art').count(), 1);
    assert.equal(await ava.locator('.bar .avatar.placeholder').count(), 0);
    assert.equal(await ben.locator('.bar .avatar.has-art').count(), 0);
    await checkPlaceholder(ben.locator('.bar .avatar.placeholder'), 'camera bar', 44);
    const offset = await ben.getByRole('button', { name: 'Profile' }).evaluate((b) => {
      const btn = b.getBoundingClientRect();
      const av = b.querySelector('.avatar').getBoundingClientRect();
      return [av.x + av.width / 2 - (btn.x + btn.width / 2), av.y + av.height / 2 - (btn.y + btn.height / 2)];
    });
    assert.ok(offset.every((d) => Math.abs(d) <= 0.5), `avatar sits centred in the Profile button (${offset})`);

    // S10 Ben's profile: the big placeholder and an invitation to make an avatar
    await ben.getByRole('button', { name: 'Profile' }).click();
    await ben.getByRole('button', { name: 'Make your avatar' }).waitFor();
    await checkPlaceholder(ben.locator('.scroll .avatar'), 'profile', 120);
    await shot(ben, 'S10-profile-placeholder');
    // the same placeholder holds up at 32, 44 and 120px
    await ben.evaluate(() => {
      const src = document.querySelector('.scroll .avatar.placeholder');
      const strip = document.createElement('div');
      strip.id = 'avatar-sizes';
      strip.style.cssText = 'position:fixed;top:0;left:0;z-index:99;display:flex;align-items:center;gap:16px;padding:16px;background:var(--bg)';
      for (const size of [32, 44, 120]) {
        const el = src.cloneNode(true);
        el.dataset.size = size;
        el.style.width = el.style.height = size + 'px';
        const id = 'size' + size;
        el.querySelector('mask').id = id;
        el.querySelector('g[mask]').setAttribute('mask', `url(#${id})`);
        strip.append(el);
      }
      document.body.append(strip);
    });
    for (const size of [32, 44, 120]) {
      await checkPlaceholder(ben.locator(`#avatar-sizes [data-size="${size}"]`), `${size}px placeholder`, size);
    }
    await ben.locator('#avatar-sizes').screenshot({ path: path.join(SHOTS, 'S10-placeholder-sizes.png') });
    await ben.evaluate(() => document.getElementById('avatar-sizes').remove());
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('button', { name: 'Take photo' }).waitFor();
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
    await checkPlaceholder(ava.getByRole('checkbox', { name: /Ben/ }).locator('.avatar'), 'Ben in send to', 44);
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
    assert.equal(await ben.getByRole('button', { name: /Ava, New snap/ }).locator('.avatar.has-art').count(), 1, 'Ben sees Ava\'s avatar art');
    await ben.locator('.puff-pop').waitFor({ state: 'detached' }); // "You are now friends" can still be fading out
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

    // S01 log out lands on the welcome screen; log back in from there
    await ava.getByRole('button', { name: 'Sign up' }).waitFor();
    assert.equal(await ava.evaluate(() => document.documentElement.dataset.chrome), 'brand');
    assert.ok(await ava.locator('#toast').isHidden(), 'no news from the last session on the welcome screen');
    await ava.getByRole('button', { name: 'Log in' }).click();
    await ava.getByRole('heading', { name: 'Log in' }).waitFor();
    await checkIcons(ava, 'log in', { Back: 'back' });
    await ava.getByLabel('Username').fill('ava');
    await ava.getByLabel('Password', { exact: true }).fill('not-my-password');
    await shot(ava, 'S01-login');
    await ava.getByRole('button', { name: 'Log in' }).click();
    await ava.getByText('Wrong username or password.').waitFor();
    await ava.getByLabel('Password', { exact: true }).fill('password123');
    await ava.keyboard.press('Enter');
    await ava.getByRole('button', { name: 'Take photo' }).waitFor();

    assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
    console.log('e2e: all flows passed. Screenshots in replica/clone-screens/');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => { console.error(e); process.exit(1); });
