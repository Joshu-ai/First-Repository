'use strict';
// End-to-end: users in separate browsers (Ava, Ben, and later Cal), using
// Chromium's fake camera.
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
  // `context` adds browser context options; `before` runs on the page before it
  // loads; `path` is where it starts (a profile link, say)
  const open = async ({ context, before, path: start = '/' } = {}) => {
    const ctx = await browser.newContext({ viewport, permissions: ['camera'], ...context });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/40[0-9]|410/.test(m.text()) && errors.push(m.text()));
    if (before) await before(page);
    await page.goto(base + start);
    return page;
  };
  // Headless Chromium on Linux has no BarcodeDetector. This stand-in reads a
  // code only when told to (window.fakeCode = { url, from: 'video' | 'photo' })
  // and counts what it was shown, so the app's own scanning flow can be tested.
  // That real readers decode Puffcodes is test/puffcode-scan.py's job.
  const fakeDetector = (page) => page.addInitScript(() => {
    window.fakeCode = null;
    window.detectCalls = { video: 0, photo: 0, flipped: 0 };
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      constructor(options) { this.formats = options.formats; }
      async detect(source) {
        const kind = source instanceof HTMLVideoElement ? 'video' : source instanceof ImageBitmap ? 'photo' : 'flipped';
        window.detectCalls[kind]++;
        const code = window.fakeCode;
        return code && code.from === kind ? [{ format: 'qr_code', rawValue: code.url }] : [];
      }
    };
  });
  // records whether the launch splash ever started its fade
  const watchSplash = (page) => page.addInitScript(() => {
    window.splashFaded = false;
    new MutationObserver(() => {
      if (document.getElementById('splash')?.classList.contains('leaving')) window.splashFaded = true;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  // after a reload: wait for the launch splash to fade, so screenshots are clean
  const settled = (page) => page.locator('#splash').waitFor({ state: 'detached' });
  const noToast = (page) => page.locator('#toast').waitFor({ state: 'hidden' });

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

    // Ava may use the clipboard: Share profile copies her link where there is no share sheet
    const ava = await open({ context: { permissions: ['camera', 'clipboard-read', 'clipboard-write'] } });
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

    // the same placeholder holds up at 32, 44 and 120px
    await ben.evaluate(() => {
      const src = document.querySelector('.bar .avatar.placeholder');
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
    // S10 Ben's profile: his Puffcode, with Puff's own face until he makes an avatar
    await ben.getByRole('button', { name: 'Profile' }).click();
    await ben.getByRole('button', { name: 'Make your avatar' }).waitFor();
    const benCode = ben.getByRole('img', { name: 'Puffcode for @ben' });
    await benCode.waitFor();
    assert.equal(await benCode.locator('svg[viewBox="0 0 200 200"]').count(), 0, 'no avatar art in Ben\'s Puffcode');
    assert.equal(await benCode.locator('mask').count(), 1, 'Puff\'s mark, its face knocked out, sits in the middle');
    await shot(ben, 'S10-profile-placeholder');
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('button', { name: 'Take photo' }).waitFor();
    await checkIcons(ava, 'camera', {
      'Choose a photo': 'image', 'Flip camera': 'flip', 'Add friends': 'puff-plus',
      Chat: 'chat', Camera: 'camera', Stories: 'stories',
    });

    // S09 add friends: search finds Ben, and there is a way to scan a Puffcode
    await ava.getByRole('button', { name: 'Add friends' }).click();
    await ava.getByLabel('Search users').fill('ben');
    await ava.getByRole('button', { name: 'Add', exact: true }).waitFor();
    await checkIcons(ava, 'add friends', { Back: 'back', Add: 'plus', 'Scan Puffcode': 'scan' });
    assert.ok((await ava.getByRole('button', { name: 'Scan Puffcode' }).boundingBox()).height >= 44, 'Scan Puffcode is easy to tap');
    assert.equal(await ava.locator('.search-field svg.i-search').count(), 1, 'search field shows the search icon');
    await ava.getByLabel('Search users').fill('');

    // S12 Ben opens Ava's link (what her Puffcode holds) and sends a request from it
    await ben.goto(base + '/add/ava');
    await ben.getByRole('heading', { name: 'Ava' }).waitFor();
    await settled(ben);
    await ben.getByText('@ava', { exact: true }).waitFor();
    assert.equal(await ben.evaluate(() => location.pathname), '/', 'the link is used up once it opens');
    await checkIcons(ben, 'add from a link', { Back: 'back', 'Add friend': 'plus' });
    const addBtn = await ben.getByRole('button', { name: 'Add friend' }).boundingBox();
    assert.ok(addBtn.height >= 44 && addBtn.width >= viewport.width - 2 * 24, 'Add friend is a full-width button');
    await shot(ben, 'S12-add-from-link');
    await ben.getByRole('button', { name: 'Add friend' }).click();
    await ben.getByText('Request sent. You will be friends once Ava accepts.').waitFor();
    // Ava sees it live and accepts; Ben's screen follows along
    await ava.getByRole('button', { name: 'Accept' }).click();
    await ava.getByText('You are now friends').waitFor();
    await ben.getByText('You and Ava are friends.').waitFor();
    await ben.getByRole('button', { name: 'Send a chat' }).waitFor();
    await ava.locator('.puff-pop').waitFor({ state: 'detached' });
    await ava.getByText('Find your friends').waitFor();
    await shot(ava, 'S09-add-friends');
    assert.ok(!(await ava.locator('.scroll').innerText()).includes('null'), 'stray null text on S09');

    // S13 this browser cannot read codes, so the scanner says to use the phone's camera
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('button', { name: 'Scan Puffcode' }).click();
    await ben.getByText("Use your phone's camera").waitFor();
    assert.equal(await ben.locator('video').count(), 0, 'no camera opens when it cannot read codes');
    await noToast(ben);
    await shot(ben, 'S13-scan-no-reader');
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('heading', { name: 'Add friends' }).waitFor();

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

    // S10 profile: Ava's Puffcode, large at the top with her avatar inside it
    await ava.getByRole('button', { name: 'Profile' }).click();
    await ava.getByText('Friends (1)').waitFor();
    const avaCode = ava.getByRole('img', { name: 'Puffcode for @ava' });
    await avaCode.waitFor();
    const codeBox = await avaCode.boundingBox();
    assert.ok(codeBox.width >= 260 && Math.abs(codeBox.width - codeBox.height) < 1, `Puffcode is large and square (${codeBox.width}px)`);
    assert.ok(codeBox.y < 140, 'Puffcode sits at the top');
    assert.equal(await avaCode.locator('svg[viewBox="0 0 200 200"]').count(), 1, 'her avatar is inside it');
    assert.equal(await avaCode.locator('clipPath').count() >= 1, true, 'clipped to Puff\'s outline');
    assert.equal(await avaCode.locator('rect').first().getAttribute('fill'), '#6d4cff', 'on the brand-violet tile');
    await checkIcons(ava, 'profile', { Back: 'back', 'Share profile': 'share', 'Save Puffcode': 'download' });
    for (const name of ['Share profile', 'Save Puffcode', 'Edit avatar']) {
      assert.ok((await ava.getByRole('button', { name }).boundingBox()).height >= 44, `${name} is easy to tap`);
    }
    await shot(ava, 'S10-profile');
    // Share profile: no share sheet in this browser, so the link is copied
    await ava.getByRole('button', { name: 'Share profile' }).click();
    await ava.getByText('Link copied').waitFor();
    assert.equal(await ava.evaluate(() => navigator.clipboard.readText()), base + '/add/ava');
    // Save Puffcode: a PNG download
    const [download] = await Promise.all([ava.waitForEvent('download'),
      ava.getByRole('button', { name: 'Save Puffcode' }).click()]);
    assert.equal(download.suggestedFilename(), 'puffcode-ava.png');
    const savedPng = path.join(dataDir, 'puffcode-ava.png');
    await download.saveAs(savedPng);
    const png = fs.readFileSync(savedPng);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1080], '1080px square');
    await ava.getByText('Puffcode saved').waitFor();
    await ava.getByRole('button', { name: 'Log out' }).click();

    // S01 log out lands on the welcome screen; log back in from there
    await ava.getByRole('button', { name: 'Sign up' }).waitFor();
    assert.equal(await ava.evaluate(() => document.documentElement.dataset.chrome), 'brand');
    assert.ok(await ava.locator('#toast').isHidden(), 'no news from the last session on the welcome screen');
    // a profile link opened while logged out is remembered through log in
    await ava.goto(base + '/add/ben');
    await ava.getByText('Log in or sign up to add @ben.').waitFor();
    await settled(ava);
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
    await ava.getByText('You and Ben are friends.').waitFor();
    await ava.getByRole('button', { name: 'Send a chat' }).click();
    await ava.getByText('nice photo').waitFor();

    // S12 someone new opens Ava's link before they have an account: Poof
    // remembers it through sign up and opens it once they are in
    const cal = await open({ path: '/add/ava', before: fakeDetector });
    await cal.getByText('Log in or sign up to add @ava.').waitFor();
    await settled(cal);
    await shot(cal, 'S01-welcome-invite');
    await cal.getByRole('button', { name: 'Sign up' }).click();
    await cal.getByLabel('Your name').fill('Cal');
    await cal.keyboard.press('Enter');
    await cal.getByLabel('Username').fill('cal');
    await cal.getByText('cal is available').waitFor();
    await cal.keyboard.press('Enter');
    await cal.getByLabel('Password', { exact: true }).fill('password123');
    await cal.keyboard.press('Enter');
    await cal.getByRole('button', { name: 'Skip' }).click();
    await cal.getByRole('heading', { name: 'Ava' }).waitFor();
    assert.equal(await cal.locator('.profile-card .avatar.has-art').count(), 1, 'Ava\'s avatar');
    await cal.getByRole('button', { name: 'Add friend' }).click();
    await cal.getByText('Request sent. You will be friends once Ava accepts.').waitFor();

    // S02 with a code reader: the camera spots a Puffcode and offers to add them
    await cal.getByRole('button', { name: 'Done' }).click();
    await cal.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
    await cal.evaluate((url) => { window.fakeCode = { url, from: 'video' }; }, base + '/add/ben');
    await cal.getByRole('button', { name: 'Add @ben' }).waitFor();
    await checkIcons(cal, 'camera with a Puffcode in view', { 'Add @ben': 'puff-plus' });
    assert.ok((await cal.getByRole('button', { name: 'Add @ben' }).boundingBox()).height >= 44);
    await noToast(cal);
    await shot(cal, 'S02-camera-puffcode');
    await cal.waitForFunction(() => window.detectCalls.flipped > 0); // white-on-violet codes are tried flipped too
    await cal.getByRole('button', { name: 'Add @ben' }).click();
    await cal.evaluate(() => { window.fakeCode = null; });
    await cal.getByRole('heading', { name: 'Ben' }).waitFor();
    await cal.getByRole('button', { name: 'Add friend' }).waitFor();
    await checkPlaceholder(cal.locator('.profile-card .avatar'), 'Ben on Add friend', 96);

    // S13 the scanner: a live camera, plus scanning a saved Puffcode from a photo
    await cal.getByRole('button', { name: 'Back' }).click();
    await cal.getByRole('button', { name: 'Scan Puffcode' }).click();
    await cal.waitForFunction(() => document.querySelector('.scanner video')?.videoWidth > 0);
    await cal.getByText('Point your camera at a Puffcode.').waitFor();
    await checkIcons(cal, 'scanner', { Back: 'back', 'Scan from photo': 'image' });
    assert.ok((await cal.getByRole('button', { name: 'Scan from photo' }).boundingBox()).height >= 44, 'Scan from photo is easy to tap');
    await noToast(cal);
    await shot(cal, 'S13-scanner');
    // a code that is not a Puffcode for this server says so
    await cal.evaluate(() => { window.fakeCode = { url: 'https://example.com/menu', from: 'video' }; });
    await cal.getByText("That code isn't a Puffcode.").waitFor();
    await cal.evaluate((url) => { window.fakeCode = { url, from: 'photo' }; }, base + '/add/ava');
    await cal.locator('.scanner input[type=file]').setInputFiles(savedPng);
    await cal.getByRole('heading', { name: 'Ava' }).waitFor();
    await cal.getByText('Request sent. You will be friends once Ava accepts.').waitFor();
    assert.equal(await cal.locator('video').count(), 0, 'the camera is off once the code is read');
    // links to nobody, and to yourself
    await cal.goto(base + '/add/nobody_here');
    await cal.getByText('No one by that name').waitFor();
    await cal.getByRole('button', { name: 'Find friends' }).waitFor();
    await cal.goto(base + '/add/cal');
    await cal.getByText('This is your own Puffcode.').waitFor();
    await cal.getByRole('button', { name: 'Go to your profile' }).click();
    await cal.getByRole('img', { name: 'Puffcode for @cal' }).waitFor();

    assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
    console.log('e2e: all flows passed. Screenshots in replica/clone-screens/');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => { console.error(e); process.exit(1); });
