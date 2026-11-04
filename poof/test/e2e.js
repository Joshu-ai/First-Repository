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
const PoofWebm = require('../public/webm');

const SHOTS = path.join(__dirname, '..', 'replica', 'clone-screens');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poof-e2e-'));
  const { server, store } = createApp({ dataDir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const errors = [];
  // The only failed requests the run expects, each on purpose: any other
  // console error, a failed request included, fails the test.
  const EXPECTED_FAILS = [
    [/^\/api\/login$/, 401], // the wrong password
    [/^\/api\/stories$/, 401], // a tab logged out from another tab asks for its stories
    [/^\/api\/chat\/[^/]+$/, 503], // a chat that can't be sent
  ];
  const expectedFail = (m) => {
    const status = Number(/status of (\d{3})/.exec(m.text())?.[1]);
    let where = '';
    try { where = new URL(m.location().url).pathname; } catch {}
    return EXPECTED_FAILS.some(([at, code]) => at.test(where) && code === status);
  };
  const viewport = { width: 390, height: 844 };
  // `context` adds browser context options; `before` runs on the page before it
  // loads; `path` is where it starts (a profile link, say)
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !expectedFail(m) && errors.push(`${m.text()} (${m.location().url})`));
    return page;
  };
  const open = async ({ context, before, path: start = '/' } = {}) => {
    const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'], ...context });
    const page = watch(await ctx.newPage());
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
  // records each screen flash (the white cover the front camera's flash
  // puts up): its colour, its size, and how long it stayed
  const watchFlashes = (page) => page.evaluate(() => {
    window.flashes = [];
    new MutationObserver((ms) => ms.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (!n.classList?.contains('screen-flash')) return;
        const r = n.getBoundingClientRect();
        window.flashes.push({ el: n, bg: getComputedStyle(n).backgroundColor, w: r.width, h: r.height, at: performance.now() });
      });
      m.removedNodes.forEach((n) => {
        const f = window.flashes.find((x) => x.el === n);
        if (f) f.ms = performance.now() - f.at;
      });
    })).observe(document.body, { childList: true });
  });
  // the fake camera has no light of its own: stand one in (getCapabilities
  // says torch) and record what the app asks of it, or put things back
  const fakeTorch = (page, on) => page.evaluate((on) => {
    const P = MediaStreamTrack.prototype;
    if (!on) { Object.assign(P, window.realTrack); return; }
    window.realTrack = { getCapabilities: P.getCapabilities, applyConstraints: P.applyConstraints };
    window.torchCalls = [];
    P.getCapabilities = function () { return { ...window.realTrack.getCapabilities.call(this), torch: true }; };
    P.applyConstraints = function (c) {
      const set = c?.advanced?.find((s) => 'torch' in s);
      if (!set) return window.realTrack.applyConstraints.call(this, c);
      window.torchCalls.push(set.torch);
      return Promise.resolve();
    };
  }, on);
  const camVideo = (page, mirrored) => page.waitForFunction((m) => {
    const v = document.querySelector('.camera video');
    return v && v.videoWidth > 0 && v.classList.contains('mirror') === m;
  }, mirrored);
  const pressed = (page, name) => page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
  // Every control on screen (the screen in front, a sheet over it, a banner)
  // is at least 44px each way, measured as laid out, before any transform
  const checkTargets = async (page, where) => {
    const small = await page.evaluate(() => {
      const roots = [document.querySelector('#app > .screen:not(.peek):not(.leaving)'), document.querySelector('#app > .sheet-layer'),
        document.getElementById('banner')].filter(Boolean);
      return roots.flatMap((root) => [...root.querySelectorAll('button, input:not([type="hidden"]), [role="button"], [role="switch"], a[href]')])
        .filter((el) => el.checkVisibility({ visibilityProperty: true }) && (el.offsetWidth < 44 || el.offsetHeight < 44))
        .map((el) => `${el.getAttribute('aria-label') || el.textContent.trim() || el.className} (${el.offsetWidth}x${el.offsetHeight})`);
    });
    assert.deepEqual(small, [], `${where}: controls under 44px: ${small.join(', ')}`);
  };
  const shot = async (page, name) => {
    await checkTargets(page, name);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  // after a reload: wait for the launch splash to fade, so screenshots are clean
  const settled = (page) => page.locator('#splash').waitFor({ state: 'detached' });
  const noToast = (page) => page.locator('#toast').waitFor({ state: 'hidden' });
  // the notification banner at the top (app.js showBanner), when one is showing
  const bannerOf = (page) => page.locator('#banner .banner');
  // video snaps: the upload as sent (its JSON and the clip's bytes), whether
  // a <video> is really playing, and how far the shutter's ring has filled
  const snapPost = (page) => page.waitForRequest((r) => r.url().endsWith('/api/snaps') && r.method() === 'POST');
  const clipOf = (req) => {
    const body = JSON.parse(req.postData());
    return { body, bytes: Buffer.from(body.video.slice(body.video.indexOf(',') + 1), 'base64') };
  };
  const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const playing = (page, sel) => page.waitForFunction((q) => {
    const v = document.querySelector(q);
    return v && !v.paused && v.currentTime > 0 && v.readyState >= 2;
  }, sel);
  const ringFilled = (page, atLeast) => page.waitForFunction((min) => {
    const c = document.querySelector('.shutter-ring .arc');
    return c && c.style.strokeDashoffset !== '' && 100 - parseFloat(c.style.strokeDashoffset) >= min;
  }, atLeast);
  // gestures: a mouse drag from one point to another over about `ms`, in
  // even steps (its speed is what makes a flick or not); `mid` runs halfway,
  // `end` at the end, before letting go
  const drag = async (page, [x0, y0], [x1, y1], { ms = 240, steps = 12, mid, end } = {}) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      if (mid && i === Math.ceil(steps / 2)) await mid();
      await page.waitForTimeout(ms / steps);
    }
    if (end) await end();
    await page.mouse.up();
  };
  // pull to refresh on the list in front: where the list and Puff are, his
  // mood, how he is scaled, and what the status line says
  const pullNow = (page) => page.evaluate(() => {
    const pull = document.querySelector('#app > .screen:not(.peek) .pull');
    const list = pull.nextElementSibling;
    const puff = pull.querySelector('.pull-puff');
    const box = puff.getBoundingClientRect();
    const m = getComputedStyle(puff).transform.match(/^matrix\(([^)]+)\)$/);
    const [sx, , , sy] = m ? m[1].split(',').map(Number) : [1, 0, 0, 1];
    return { state: pull.dataset.state, mood: pull.dataset.mood, top: pull.getBoundingClientRect().top,
      listY: list.getBoundingClientRect().top, moved: list.style.transform, puffTop: box.top, puffBottom: box.bottom,
      opacity: Number(getComputedStyle(puff).opacity), sx, sy, status: pull.querySelector('[role="status"]').textContent };
  });
  const pullIdle = (page) => page.waitForFunction(() => document.querySelector('#app > .screen:not(.peek) .pull')?.dataset.state === 'idle');
  // every change of a pull's state, when it came and how Puff was moving then
  const logPulls = (page) => page.evaluate(() => {
    window.pullLog = [];
    new MutationObserver((ms) => ms.forEach((m) => {
      if (!m.target.classList.contains('pull')) return;
      const svg = m.target.querySelector('.pull-puff svg');
      window.pullLog.push({ state: m.target.dataset.state, t: performance.now(), anim: svg ? getComputedStyle(svg).animationName : '' });
    })).observe(document.getElementById('app'), { subtree: true, attributes: true, attributeFilter: ['data-state'] });
  });
  const pulls = (page) => page.evaluate(() => window.pullLog.splice(0));
  const loaded = (page, pathname) => page.waitForResponse((r) => new URL(r.url()).pathname === pathname);
  // the tab the screen in front says it is on
  const currentTab = (page) => page.evaluate(() =>
    document.querySelector('#app > .screen:not(.peek) .nav [aria-current="page"]')?.getAttribute('aria-label'));
  // nothing left over from a swipe: no neighbour peeking in, nothing moved
  const swipeSettled = (page) => page.waitForFunction(() =>
    !document.querySelector('#app > .peek') && [...document.querySelectorAll('#app > .screen')].every((s) => !s.style.transform));
  // a story's progress bar, 0..100
  const storyBar = (page, i) => page.evaluate((n) => parseFloat(document.querySelectorAll('.viewer .progress i')[n]?.style.width) || 0, i);

  // Controls show Poof's drawn icons (public/icons.js), never emoji or text
  // glyphs: no pictograph at all (🔥, 👋, …), nor the symbols used before.
  // `expected` maps a button's accessible name to its icon name.
  const OLD_GLYPHS = /[\p{Extended_Pictographic}∞◉◎⟲✎↶⤓✕➤‹✓]/u;
  const checkIcons = async (page, where, expected) => {
    const found = await page.evaluate((names) => Object.entries(names).map(([label, name]) => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === label);
      const svg = btn && btn.querySelector('svg.i-' + name);
      return [label, !btn ? 'missing button' : !svg ? 'no icon'
        : svg.closest('[aria-hidden="true"]') && svg.getAttribute('viewBox') === '0 0 24 24' ? 'ok' : 'icon not decorative'];
    }), expected);
    for (const [label, result] of found) assert.equal(result, 'ok', `${where}: "${label}" should show the ${expected[label]} icon`);
    const glyphs = await page.evaluate((src) => [...document.querySelectorAll('button, .row, .chat-row, .empty, .banner')]
      .filter((b) => new RegExp(src, 'u').test(b.textContent) || ['+', 'T', '+ Add'].includes(b.textContent.trim()))
      .map((b) => b.getAttribute('aria-label') || b.textContent.trim()), OLD_GLYPHS.source);
    assert.deepEqual(glyphs, [], `${where}: buttons or rows still use glyph icons: ${glyphs.join(', ')}`);
  };
  // the colour a CSS value comes to on this page, to compare with what is drawn
  const cssColor = (page, value) => page.evaluate((v) => {
    const probe = document.createElement('i');
    probe.style.color = v;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, value);
  // a request held until `release()`: to see what the app shows while it waits
  const holdRequests = async (page, pattern, method = 'POST') => {
    let release;
    const held = new Promise((r) => (release = r));
    const seen = [];
    const going = [];
    await page.route(pattern, (route) => {
      if (route.request().method() !== method) return route.continue();
      seen.push(route.request().url());
      const go = held.then(() => route.continue());
      going.push(go);
      return go;
    });
    // let them go, and once they have, stop holding
    return { seen, release: async () => { release(); await Promise.all(going); await page.unroute(pattern); } };
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
    const ava = await open({ context: { permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] } });
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
        const pick = page.getByRole('radio', { name: 'Round glasses' });
        assert.equal(await pick.locator('.option-check svg.i-check').count(), 1, 'the pick has a check');
        assert.equal(await pick.evaluate((el) => getComputedStyle(el).borderTopColor), await cssColor(page, 'var(--brand)'),
          'and a brand ring: the focus colour is for focus only');
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

    // S02 flash on the back camera. Flip camera keeps keyboard focus where it was.
    await camVideo(ben, true);
    await ben.getByRole('button', { name: 'Flip camera' }).click();
    await camVideo(ben, false);
    assert.equal(await ben.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Flip camera',
      'focus stays on Flip camera after the screen redraws');
    // a back camera the browser cannot light says so
    assert.equal(await pressed(ben, 'Flash'), 'false', 'Flash starts off');
    await ben.getByRole('button', { name: 'Flash' }).click();
    await ben.getByText('This camera has no flash.').waitFor();
    await ben.getByRole('button', { name: 'Flash' }).click();
    assert.equal(await pressed(ben, 'Flash'), 'false');
    // one that has a light: on for the shot, then off, and no white screen
    await fakeTorch(ben, true);
    await watchFlashes(ben);
    await ben.getByRole('button', { name: 'Flash' }).click();
    assert.equal(await pressed(ben, 'Flash'), 'true');
    await ben.getByRole('button', { name: 'Take photo' }).click();
    await ben.getByRole('button', { name: 'Discard' }).waitFor();
    assert.deepEqual(await ben.evaluate(() => window.torchCalls), [true, false], 'the light goes on for the shot, then off');
    assert.equal(await ben.evaluate(() => window.flashes.length), 0, 'no screen flash on the back camera');
    await ben.getByRole('button', { name: 'Discard' }).click();
    await ben.getByRole('button', { name: 'Take photo' }).waitFor();
    assert.equal(await pressed(ben, 'Flash'), 'true', 'Flash stays on');
    await fakeTorch(ben, false);
    // and it is remembered next time Poof opens
    await ben.reload();
    await settled(ben);
    await ben.getByRole('button', { name: 'Take photo' }).waitFor();
    assert.equal(await pressed(ben, 'Flash'), 'true', 'Flash is remembered');
    await checkIcons(ben, 'camera, flash on', { Flash: 'flash' });

    await checkIcons(ava, 'camera', {
      Search: 'search', 'Add friends': 'puff-plus', 'Flip camera': 'flip', Flash: 'flash-off', 'Choose a photo': 'image',
      Chat: 'chat', Camera: 'camera', Stories: 'stories',
    });

    // S09 add friends: search finds Ben, and there is a way to scan a Puffcode
    await ava.getByRole('button', { name: 'Add friends' }).click();
    await ava.getByText('Find your friends').waitFor();
    await ava.getByLabel('Search users').fill('ben');
    await ava.getByRole('button', { name: 'Add', exact: true }).waitFor();
    assert.equal(await ava.getByText('Find your friends').isVisible(), false, 'no "find your friends" beside the results');
    await checkIcons(ava, 'add friends', { Back: 'back', Add: 'plus', 'Scan Puffcode': 'scan' });
    assert.ok((await ava.getByRole('button', { name: 'Scan Puffcode' }).boundingBox()).height >= 44, 'Scan Puffcode is easy to tap');
    assert.equal(await ava.locator('.search-field svg.i-search').count(), 1, 'search field shows the search icon');
    await ava.getByLabel('Search users').fill('');
    await ava.getByText('Find your friends').waitFor();

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
    // Ava sees it live (a banner says so too) and accepts; Ben's screen follows along
    await bannerOf(ava).getByText('Sent you a friend request', { exact: true }).waitFor();
    // Accept says it is working straight away and takes no second tap
    const accepting = await holdRequests(ava, '**/api/friends/accept');
    await ava.getByRole('button', { name: 'Accept' }).click();
    const acceptBusy = ava.getByRole('button', { name: 'Accepting…' });
    await acceptBusy.waitFor();
    assert.equal(await acceptBusy.isDisabled(), true, 'Accept is busy while it is on its way');
    await accepting.release();
    await ava.getByText('You are now friends').waitFor();
    assert.equal(accepting.seen.length, 1, 'one request');
    // a 2-day streak between them (as if they had sent each other poofs yesterday and today)
    const idOf = (username) => store.db.users.find((u) => u.username === username).id;
    store.db.streaks[[idOf('ava'), idOf('ben')].sort().join('|')] = { days: {}, count: 2, lastDay: new Date().toISOString().slice(0, 10) };
    assert.equal(await bannerOf(ava).count(), 0, 'answered, the request banner goes');
    await ben.getByText('You and Ava are friends.').waitFor();
    await ben.getByRole('button', { name: 'Send a chat' }).waitFor();
    // S17 Ben hears it in a banner. From the keyboard: on it, Escape puts it
    // away and focus goes back where it was
    const acceptedBanner = bannerOf(ben);
    await acceptedBanner.getByText('Accepted your friend request', { exact: true }).waitFor();
    await ben.getByRole('button', { name: 'Send a chat' }).focus();
    await acceptedBanner.focus();
    await ben.keyboard.press('Escape');
    await acceptedBanner.waitFor({ state: 'detached', timeout: 1000 });
    assert.equal(await ben.evaluate(() => document.activeElement?.textContent), 'Send a chat', 'focus is back on Send a chat');
    assert.equal(await ben.getByText('You and Ava are friends.').count(), 1, 'Escape on the banner did nothing else');
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

    // S02 camera: Back from Add friends returns to it
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Take photo' }).waitFor();
    await camVideo(ava, true);
    // you and search top left; add friends, flip and flash in a column top
    // right; the shutter big and central with the gallery to its left
    const cam = {};
    for (const name of ['Profile', 'Search', 'Add friends', 'Flip camera', 'Flash', 'Choose a photo', 'Take photo']) {
      cam[name] = await ava.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(cam[name].width >= 44 && cam[name].height >= 44, `${name} is easy to tap`);
    }
    const mid = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    assert.ok(cam.Profile.x < 30 && cam.Profile.y < 80, 'Profile sits top left');
    assert.ok(cam.Search.x > cam.Profile.x + cam.Profile.width && cam.Search.x + cam.Search.width < viewport.width / 2
      && Math.abs(mid(cam.Search).y - mid(cam.Profile).y) <= 1, 'Search sits next to Profile');
    const column = [cam['Add friends'], cam['Flip camera'], cam.Flash];
    assert.ok(column.every((b) => b.x > viewport.width / 2 && Math.abs(mid(b).x - mid(column[0]).x) <= 1),
      'Add friends, Flip camera and Flash line up on the right');
    assert.ok(column[0].y < column[1].y && column[1].y < column[2].y && Math.abs(column[0].y - cam.Profile.y) <= 1,
      'top to bottom from the top bar: Add friends, Flip camera, Flash');
    assert.ok(Math.abs(mid(cam['Take photo']).x - viewport.width / 2) <= 1 && cam['Take photo'].width >= 80,
      'the shutter is big and centred');
    assert.ok(cam['Choose a photo'].x + cam['Choose a photo'].width < cam['Take photo'].x
      && Math.abs(mid(cam['Choose a photo']).y - mid(cam['Take photo']).y) <= 1, 'the gallery sits left of the shutter');
    assert.ok(cam['Take photo'].y + cam['Take photo'].height < (await ava.locator('.nav').boundingBox()).y, 'above the tabs');
    assert.equal(await pressed(ava, 'Flash'), 'false');
    await shot(ava, 'S02-camera');
    // Search opens Add friends, ready to type, and Back comes back here
    await ava.getByRole('button', { name: 'Search', exact: true }).click();
    await ava.getByRole('heading', { name: 'Add friends' }).waitFor();
    assert.equal(await ava.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search users');
    await ava.getByRole('button', { name: 'Back' }).click();
    await camVideo(ava, true);
    // tap: a focus ring where you tapped, and the camera stays put
    await ava.mouse.click(120, 420);
    const ring = await ava.locator('.viewfinder .focus-ring').boundingBox();
    assert.ok(Math.abs(mid(ring).x - 120) <= 2 && Math.abs(mid(ring).y - 420) <= 2, `focus ring at the tap (${mid(ring).x}, ${mid(ring).y})`);
    assert.equal(await ava.locator('.viewfinder .focus-ring').getAttribute('aria-hidden'), 'true');
    await ava.locator('.viewfinder .focus-ring').waitFor({ state: 'detached' });
    await camVideo(ava, true);
    // Flash switches on, and stays on through a flip
    await ava.getByRole('button', { name: 'Flash' }).click();
    assert.equal(await pressed(ava, 'Flash'), 'true');
    await checkIcons(ava, 'camera, flash on', { Flash: 'flash' });
    // double-tap the picture: the other camera (the front one is mirrored, the back one is not)
    await ava.mouse.dblclick(260, 540);
    await camVideo(ava, false);
    assert.equal(await pressed(ava, 'Flash'), 'true', 'Flash stays on after a flip');
    await ava.mouse.dblclick(260, 540);
    await camVideo(ava, true);
    // S02 -> S03: the front camera's flash turns the whole screen white for the shot
    await watchFlashes(ava);
    await ava.getByRole('button', { name: 'Take photo' }).click();
    await ava.getByRole('button', { name: 'Add caption' }).waitFor();
    const flashes = await ava.evaluate(() => window.flashes.map(({ bg, w, h, ms }) => ({ bg, w, h, ms })));
    assert.equal(flashes.length, 1, 'one screen flash');
    assert.equal(flashes[0].bg, 'rgb(255, 255, 255)');
    assert.deepEqual([flashes[0].w, flashes[0].h], [viewport.width, viewport.height], 'it covers the screen');
    assert.ok(flashes[0].ms >= 140 && flashes[0].ms < 600, `it is brief (${Math.round(flashes[0].ms)}ms)`);
    // what you aimed is what you send: the photo is the viewfinder's frame, the
    // screen's shape, and fills the editor edge to edge
    const frame = await ava.evaluate(() => {
      const c = document.querySelector('.stage canvas');
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, aspect: c.width / c.height, screen: innerWidth / innerHeight };
    });
    assert.ok(Math.abs(frame.x) <= 1 && Math.abs(frame.y) <= 1 && Math.abs(frame.w - viewport.width) <= 1
      && Math.abs(frame.h - viewport.height) <= 1, `the photo fills the editor (${JSON.stringify(frame)})`);
    assert.ok(Math.abs(frame.aspect - frame.screen) < 0.005, `cut to the screen's shape (${frame.aspect} for ${frame.screen})`);
    await ava.getByRole('button', { name: 'Add caption' }).click();
    await ava.getByRole('textbox', { name: 'Caption' }).fill('hello from the test');
    // draw a stroke
    await ava.getByRole('button', { name: 'Draw' }).click();
    const box = await ava.locator('.stage canvas').nth(1).boundingBox();
    await ava.mouse.move(box.x + 40, box.y + 66); // in the top bar, below Discard
    await ava.mouse.down();
    await ava.mouse.move(box.x + 200, box.y + 200, { steps: 8 });
    await ava.mouse.up();
    // it is drawn, though it starts under the top bar: the bar lets it through
    assert.equal(await ava.locator('.stage canvas').nth(1).evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
      return false;
    }), true, 'the stroke is on the drawing layer');
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
    // their streak: the count and Poof's streak mark, read out in words
    const sendStreak = ava.getByRole('checkbox', { name: /Ben/ }).locator('.streak');
    assert.deepEqual(await sendStreak.evaluate((el) => [el.textContent, el.getAttribute('role'), el.getAttribute('aria-label'),
      el.querySelectorAll('svg.i-streak').length]), ['2', 'img', '2-day streak', 1]);
    await ava.getByRole('checkbox', { name: /My Story/ }).click();
    await checkIcons(ava, 'send to', { 'Back to editing': 'back', Send: 'send' });
    assert.equal(await ava.locator('.row[aria-checked="true"] .check svg.i-check').count(), 2, 'picked rows show a drawn check');
    await shot(ava, 'S04-send-to');
    await ava.getByRole('button', { name: 'Send', exact: true }).click();
    await ava.getByText('Sent', { exact: true }).waitFor();
    await checkIcons(ava, 'inbox', { 'Chat with Ben': 'chat', 'Add friends': 'puff-plus' });
    assert.equal(await ava.locator('.chat-row[data-friend] .row .streak svg.i-streak').count(), 1, 'the streak mark on the Chat list');
    assert.equal(await ava.locator('.chat-row[data-friend] .status-icon svg.i-mark-sent').count(), 1, 'sent: Puff\'s trail');
    await shot(ava, 'S05-inbox-sender');

    // S16 press and hold Ben's row: his friend card rises from the bottom,
    // and letting go does not also open the row
    const benRow = ava.getByRole('button', { name: 'Ben, Sent, 2-day streak' });
    const rowBox = await benRow.boundingBox();
    await ava.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
    await ava.mouse.down();
    const card = ava.getByRole('dialog', { name: 'Ben' });
    await card.waitFor();
    await ava.mouse.up();
    assert.equal(await ava.locator('section.screen[aria-label="Chat with Ben"]').count(), 0, 'a long press does not open the chat');
    assert.equal(await ava.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true, 'focus moves into the card');
    await card.getByRole('heading', { name: 'Ben' }).waitFor();
    await card.getByText('@ben', { exact: true }).waitFor();
    await card.getByText('2-day streak', { exact: true }).waitFor();
    await card.getByRole('img', { name: 'Puffcode for @ben' }).waitFor();
    await checkPlaceholder(card.locator('.card-top .avatar'), 'Ben on his friend card', 64);
    for (const name of ['Send a chat', 'Remove friend', 'Close']) {
      const b = await card.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(b.width >= 44 && b.height >= 44, `${name} is easy to tap`);
    }
    await checkIcons(ava, 'friend card', { Close: 'close', 'Send a chat': 'chat' });
    await ava.locator('.sheet').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await ava.locator('.puff-pop').waitFor({ state: 'detached' }); // "Poof! Sent" can still be fading out
    const sheetBox = await ava.locator('.sheet').boundingBox();
    assert.ok(Math.abs(sheetBox.y + sheetBox.height - viewport.height) <= 1 && sheetBox.width === viewport.width,
      'a full-width sheet on the bottom edge');
    await shot(ava, 'S16-friend-card');
    // Remove friend asks first, with the safe choice focused; Cancel keeps him
    await card.getByRole('button', { name: 'Remove friend' }).click();
    await card.getByText('Remove Ben?').waitFor();
    assert.equal(await ava.evaluate(() => document.activeElement?.textContent), 'Cancel');
    await shot(ava, 'S16-friend-card-remove');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Remove friend' }).waitFor();
    // Escape closes it and focus goes back to the row
    await ava.keyboard.press('Escape');
    await card.waitFor({ state: 'detached' });
    assert.equal(await ava.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ben, Sent, 2-day streak');
    // from the keyboard: Ben's avatar is a button that opens the card; Close shuts it
    await ava.getByRole('button', { name: "Ben's friend card" }).focus();
    await ava.keyboard.press('Enter');
    await card.waitFor();
    await card.getByRole('button', { name: 'Close' }).click();
    await card.waitFor({ state: 'detached' });
    assert.equal(await ava.evaluate(() => document.activeElement?.getAttribute('aria-label')), "Ben's friend card");
    // and a tap above the card closes it
    await ava.getByRole('button', { name: "Ben's friend card" }).click();
    await card.waitFor();
    await ava.mouse.click(viewport.width / 2, 40);
    await card.waitFor({ state: 'detached' });

    // swipe Ben's row right: Chat shows behind it, and his chat opens
    const slideBox = await benRow.boundingBox();
    const rowY = slideBox.y + slideBox.height / 2;
    await drag(ava, [slideBox.x + 10, rowY], [slideBox.x + 230, rowY], { mid: () => shot(ava, 'S05-swipe-row-to-chat') });
    await ava.locator('section.screen[aria-label="Chat with Ben"]').waitFor();
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();

    // S02 swipe between the tabs, Chat | Camera | Stories: the screen follows
    // the pointer with its neighbour beside it. Chat -> Camera, first with
    // reduced motion: it follows the pointer, then simply is there (no slide)
    await ava.emulateMedia({ reducedMotion: 'reduce' });
    await ava.evaluate(() => {
      window.slid = false;
      new MutationObserver((ms) => {
        if (ms.some((m) => m.target.classList?.contains('sliding') || [...m.addedNodes].some((n) => n.classList?.contains('leaving')))) window.slid = true;
      }).observe(document.getElementById('app'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    });
    await drag(ava, [320, 520], [60, 520]);
    await camVideo(ava, true);
    assert.equal(await currentTab(ava), 'Camera');
    assert.equal(await ava.evaluate(() => window.slid), false, 'no slide with reduced motion');
    assert.equal(await ava.locator('#app > .screen').count(), 1, 'nothing left beside it');
    await ava.emulateMedia({ reducedMotion: 'no-preference' });
    // a short, slow drag springs back
    await drag(ava, [100, 420], [160, 420], { ms: 500 });
    await swipeSettled(ava);
    assert.equal(await currentTab(ava), 'Camera', 'a short drag stays put');
    // a quick flick goes over even when short: Camera -> Stories
    await drag(ava, [300, 420], [230, 420], { ms: 30, steps: 3 });
    await ava.getByRole('heading', { name: 'Stories' }).waitFor();
    // nothing is right of Stories: dragging that way gives a little, then springs back
    await drag(ava, [300, 520], [60, 520]);
    await swipeSettled(ava);
    assert.equal(await currentTab(ava), 'Stories');
    // Stories -> Camera, then Camera -> Chat (the picture slides off as Chat comes in)
    await drag(ava, [60, 520], [320, 520]);
    await camVideo(ava, true);
    let midSwipe;
    await drag(ava, [60, 420], [320, 420], { mid: async () => {
      await shot(ava, 'S02-swipe-to-chat');
      midSwipe = await ava.evaluate(() => {
        const [front, peek] = document.querySelectorAll('#app > .screen');
        return { moved: front.getBoundingClientRect().x, navX: front.querySelector(':scope > .nav').getBoundingClientRect().x,
          peekX: peek?.getBoundingClientRect().x, peekTab: peek && getComputedStyle(peek.querySelector(':scope > .nav')).visibility };
      });
    } });
    assert.ok(midSwipe.moved > 60 && Math.abs(midSwipe.peekX - (midSwipe.moved - viewport.width)) <= 1,
      `mid-swipe the camera has moved right with Chat beside it (${JSON.stringify(midSwipe)})`);
    assert.ok(Math.abs(midSwipe.navX) <= 1 && midSwipe.peekTab === 'hidden', 'and the tab bar stays put');
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();
    assert.equal(await currentTab(ava), 'Chat');
    await swipeSettled(ava);
    assert.equal(await ava.locator('#app > .leaving').count(), 0, 'the camera screen has slid away');

    // S05 pull to refresh. At the top of the Chat list, drag down: the list
    // follows, though less far than the pointer, with Puff rising behind it.
    // Let go early and it springs back, nothing reloaded.
    await logPulls(ava);
    const inboxLoads = [];
    const countInbox = (r) => { if (new URL(r.url()).pathname === '/api/inbox') inboxLoads.push(r); };
    ava.on('request', countInbox);
    const atRest = await pullNow(ava);
    assert.equal(atRest.state, 'idle');
    assert.ok(Math.abs(atRest.listY - atRest.top) <= 1 && !atRest.moved, 'the list starts right under the header');
    let shortPull;
    await drag(ava, [195, 240], [195, 310], { end: async () => { shortPull = await pullNow(ava); } });
    assert.equal(shortPull.state, 'pulling');
    assert.equal(shortPull.mood, 'happy', 'Puff looks happy before the threshold');
    const earlyBy = shortPull.listY - atRest.listY;
    assert.ok(earlyBy > 20 && earlyBy < 60, `the list follows with resistance (${earlyBy}px for 70px)`);
    assert.ok(shortPull.opacity > 0, 'Puff is showing');
    await pullIdle(ava);
    assert.deepEqual((await pulls(ava)).map((p) => p.state), ['pulling', 'idle'], 'a short pull springs back');
    const sprung = await pullNow(ava);
    assert.ok(!sprung.moved && Math.abs(sprung.listY - atRest.listY) <= 1, 'the list is back where it was');
    assert.equal(inboxLoads.length, 0, 'a short pull does not refresh');
    // Pull past the threshold (starting on Ben's row): Puff's eyes go wide and
    // he stretches. Let go: the list reloads while Puff bobs (400ms at least),
    // then he drifts off and the list settles back; the row was not tapped.
    const pullRow = await benRow.boundingBox();
    const rowMid = pullRow.y + pullRow.height / 2;
    const oldRow = await ava.evaluateHandle(() => document.querySelector('.chat-row'));
    let halfway;
    let armed;
    const inboxReload = loaded(ava, '/api/inbox');
    await drag(ava, [195, rowMid], [195, rowMid + 220], { steps: 16,
      mid: async () => { halfway = await pullNow(ava); },
      end: async () => { armed = await pullNow(ava); await shot(ava, 'S05-pull-to-refresh'); } });
    await ava.waitForFunction(() => document.querySelector('#app > .screen:not(.peek) .pull').dataset.state !== 'pulling');
    await shot(ava, 'S05-pull-refreshing');
    assert.equal(halfway.mood, 'happy');
    assert.ok(halfway.opacity > 0.5, 'Puff fades in with the pull');
    assert.equal(armed.mood, 'wow', 'past the threshold his eyes go wide');
    const armedBy = armed.listY - atRest.listY;
    assert.ok(armedBy >= 72 && armedBy <= 160 && armedBy < 220 - 40, `the list comes down past the threshold, resisting (${armedBy}px for 220px)`);
    assert.ok(armed.opacity === 1 && armed.puffTop >= atRest.top - 1 && armed.puffBottom <= armed.listY + 1,
      `Puff shows in the gap above the list (${JSON.stringify(armed)})`);
    assert.ok(armed.sy > armed.sx, 'and stretches with the pull');
    await inboxReload;
    await pullIdle(ava);
    assert.equal(inboxLoads.length, 1, 'letting go reloads the list once');
    assert.equal(await oldRow.evaluate((el) => el.isConnected), false, 'the rows are drawn afresh');
    await ava.getByRole('button', { name: /^Ben, / }).waitFor();
    assert.equal(await ava.locator('section.screen[aria-label="Chat with Ben"]').count(), 0, 'letting go on a row is not a tap');
    const full = await pulls(ava);
    assert.deepEqual(full.map((p) => p.state), ['pulling', 'refreshing', 'done', 'idle']);
    const [, busy, gone] = full;
    assert.equal(busy.anim, 'pull-bob', 'Puff bobs while it refreshes');
    assert.equal(gone.anim, 'pull-drift', 'then drifts off');
    assert.ok(gone.t - busy.t >= 390, `Puff stays long enough to read (${Math.round(gone.t - busy.t)}ms)`);
    const settledPull = await pullNow(ava);
    assert.ok(!settledPull.moved && Math.abs(settledPull.listY - atRest.listY) <= 1, 'the list settles back');
    assert.equal(settledPull.status, 'All up to date', 'and says so to screen readers');
    // with reduced motion: no stretch while pulling, no bob, and a fade, not a drift
    await ava.emulateMedia({ reducedMotion: 'reduce' });
    let calmPull;
    const calmReload = loaded(ava, '/api/inbox');
    await drag(ava, [195, 240], [195, 460], { steps: 16, end: async () => { calmPull = await pullNow(ava); } });
    assert.equal(calmPull.mood, 'wow');
    assert.ok(calmPull.sx === 1 && calmPull.sy === 1, `no stretch with reduced motion (${calmPull.sx}, ${calmPull.sy})`);
    await calmReload;
    await pullIdle(ava);
    const calmLog = await pulls(ava);
    assert.deepEqual(calmLog.map((p) => p.state), ['pulling', 'refreshing', 'done', 'idle']);
    assert.deepEqual([calmLog[1].anim, calmLog[2].anim], ['none', 'pull-fade'], 'Puff keeps still, then fades');
    await ava.emulateMedia({ reducedMotion: 'no-preference' });
    // scrolled down the list, a drag down is just a drag: no pull
    await ava.evaluate(() => {
      const list = document.querySelector('#app > .screen:not(.peek) .pullable');
      list.append(Object.assign(document.createElement('div'), { className: 'test-spacer', style: 'height:2000px' }));
      list.scrollTop = 120;
    });
    const loadsBefore = inboxLoads.length;
    await drag(ava, [195, 300], [195, 520]);
    assert.deepEqual(await pulls(ava), [], 'no pull unless the list is at the top');
    assert.equal(inboxLoads.length, loadsBefore);
    await ava.evaluate(() => document.querySelector('.test-spacer')?.remove());
    ava.off('request', countInbox);
    // the Stories list pulls the same way (letting go on My Story does not open it)
    await ava.getByRole('button', { name: 'Stories', exact: true }).click();
    await ava.getByRole('heading', { name: 'Stories' }).waitFor();
    const myStory = await ava.getByRole('button', { name: /My Story/ }).boundingBox();
    const storiesReload = loaded(ava, '/api/stories');
    await drag(ava, [195, myStory.y + myStory.height / 2], [195, myStory.y + myStory.height / 2 + 220], { steps: 16 });
    await storiesReload;
    await pullIdle(ava);
    assert.deepEqual((await pulls(ava)).map((p) => p.state), ['pulling', 'refreshing', 'done', 'idle']);
    assert.equal(await ava.locator('.viewer').count(), 0, 'letting go on My Story is not a tap');
    await ava.getByRole('button', { name: 'Chat', exact: true }).click();
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();

    // S05 Ben sees a new snap live, S06 opens it once
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByText('New poof', { exact: true }).waitFor();
    // news in the colour of what it is, Poof's solid cloud beside it, and the row bold
    const avaRow = ben.locator('.chat-row[data-friend]');
    assert.equal(await avaRow.locator('.sub').evaluate((el) => getComputedStyle(el).color), await cssColor(ben, 'var(--snap)'),
      'New poof in the poof colour');
    assert.notEqual(await cssColor(ben, 'var(--snap)'), await cssColor(ben, 'var(--text-dim)'));
    assert.equal(await avaRow.locator('.status-icon svg.i-mark-poof').count(), 1);
    assert.equal(await avaRow.locator('.name').evaluate((el) => getComputedStyle(el).fontWeight), '800', 'unread: bold');
    assert.equal(await ben.getByRole('button', { name: "Ava's friend card" }).locator('.avatar.has-art').count(), 1, 'Ben sees Ava\'s avatar art');
    await ben.locator('.puff-pop').waitFor({ state: 'detached' }); // "You are now friends" can still be fading out
    await shot(ben, 'S05-inbox');
    await ben.getByRole('button', { name: /Ava, New poof/ }).click();
    const img = ben.getByRole('img', { name: 'Photo from Ava' });
    await img.waitFor();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    await checkIcons(ben, 'snap viewer', { Close: 'close' });
    await shot(ben, 'S06-snap-viewer');
    // a short, slow drag down follows the pointer, then springs back: the
    // snap stays open, and letting go is not a tap
    await drag(ben, [195, 300], [195, 380], { ms: 500 });
    await swipeSettled(ben);
    assert.ok(await img.isVisible(), 'the snap is still open');
    await ben.getByRole('button', { name: 'Next' }).click(); // tap: on to the next, and after the last it closes
    await ben.getByText('Received').waitFor();
    assert.equal(await avaRow.locator('.status-icon svg.i-mark-poof-open').count(), 1, 'opened: the cloud outlined');
    assert.equal(await avaRow.locator('.name').evaluate((el) => getComputedStyle(el).fontWeight), '600', 'read: not bold');
    await ava.getByText('Seen', { exact: true }).waitFor(); // live update to the sender

    // S14 video snaps: hold the shutter and it records, a ring filling round
    // it while everything else steps back; let go and the video editor opens
    await ava.getByRole('button', { name: 'Camera', exact: true }).click();
    await camVideo(ava, true);
    const shutter = ava.getByRole('button', { name: 'Take photo', exact: true });
    assert.equal(await shutter.evaluate((b) => document.getElementById(b.getAttribute('aria-describedby'))?.textContent),
      'Hold to record a video.', 'the shutter says it can record');
    const restBox = await shutter.boundingBox();
    await ava.mouse.move(restBox.x + restBox.width / 2, restBox.y + restBox.height / 2);
    await ava.mouse.down();
    await ava.locator('.camera.recording').waitFor();
    await ringFilled(ava, 4);
    const ringBox = await ava.locator('.shutter-ring').boundingBox();
    const recBox = await shutter.boundingBox();
    assert.ok(ringBox.x < recBox.x && ringBox.y < recBox.y && ringBox.x + ringBox.width > recBox.x + recBox.width
      && ringBox.y + ringBox.height > recBox.y + recBox.height, 'the ring is drawn round the shutter');
    assert.ok(Math.abs(mid(ringBox).x - mid(restBox).x) <= 1 && Math.abs(mid(ringBox).y - mid(restBox).y) <= 1, 'centred on it');
    assert.ok(recBox.width > restBox.width, 'the shutter grows while it records');
    for (const name of ['Flip camera', 'Choose a photo', 'Chat']) {
      assert.ok(await ava.getByRole('button', { name, exact: true }).isHidden(), `${name} steps back while recording`);
    }
    assert.equal(await ava.locator('.camera [role="status"]').textContent(), 'Recording. Let go to stop.');
    await ringFilled(ava, 15);
    await shot(ava, 'S14-video-recording');
    await ava.mouse.up();
    await ava.locator('[aria-label="Edit video"]').waitFor();
    assert.equal(await ava.getByRole('button', { name: 'Draw' }).count(), 0, 'a hold makes a video, not a photo');
    // the clip loops with its sound on; Mute switches the sound off and on
    await playing(ava, '.video-editor video');
    const preview = ava.locator('.video-editor video');
    assert.deepEqual(await preview.evaluate((v) => [v.loop, v.muted, v.classList.contains('mirror')]), [true, false, true],
      'loops, with sound, mirrored like the front camera');
    assert.equal(await pressed(ava, 'Mute'), 'false');
    await checkIcons(ava, 'video editor', { 'Add caption': 'text', Mute: 'sound', Discard: 'close', 'Send to': 'send' });
    await ava.getByRole('button', { name: 'Mute' }).click();
    assert.equal(await pressed(ava, 'Mute'), 'true');
    assert.equal(await preview.evaluate((v) => v.muted), true, 'muted preview');
    await checkIcons(ava, 'video editor, muted', { Mute: 'sound-off' });
    await ava.getByRole('button', { name: 'Mute' }).click();
    assert.equal(await pressed(ava, 'Mute'), 'false');
    assert.equal(await preview.evaluate((v) => v.muted), false);
    await ava.getByRole('button', { name: 'Add caption' }).click();
    await ava.getByRole('textbox', { name: 'Caption' }).fill('Puff says hi');
    for (const name of ['Add caption', 'Mute', 'Discard', 'Send to']) {
      const b = await ava.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(b.width >= 44 && b.height >= 44, `${name} is easy to tap`);
    }
    await shot(ava, 'S14-video-editor');
    // to Ben and the story: up it goes as a real WebM with picture and sound,
    // the caption beside it
    await ava.getByRole('button', { name: 'Send to', exact: true }).click();
    await ava.getByRole('checkbox', { name: /Ben/ }).click();
    await ava.getByRole('checkbox', { name: /My Story/ }).click();
    const [avaPost] = await Promise.all([snapPost(ava), ava.getByRole('button', { name: 'Send', exact: true }).click()]);
    const avaClip = clipOf(avaPost);
    assert.match(avaClip.body.video, /^data:video\/webm;base64,/);
    assert.ok(avaClip.bytes.subarray(0, 4).equals(WEBM_MAGIC), 'a real WebM file');
    const avaInfo = PoofWebm.info(avaClip.bytes);
    assert.deepEqual(avaInfo.tracks.map((t) => t.codec).sort(), ['A_OPUS', 'V_VP8'], 'with a picture and a sound track');
    assert.ok(avaInfo.tracks.every((t) => avaInfo.blocks[t.number] > 0), 'both of them recorded');
    assert.equal(avaClip.body.caption, 'Puff says hi');
    assert.equal(avaClip.body.mirror, true);
    assert.ok(avaClip.body.duration >= 1 && avaClip.body.duration <= 10, `its length (${avaClip.body.duration}s)`);
    assert.ok(!('image' in avaClip.body));
    await ava.getByText('Sent', { exact: true }).waitFor();

    // S15 Ben opens it from its banner (S17): a <video> plays with its sound,
    // the caption over it; when it ends the viewer moves on (here, it closes)
    // and the snap is gone
    const snapBanner = bannerOf(ben);
    await snapBanner.waitFor();
    assert.equal(await snapBanner.locator('.banner-name').textContent(), 'Ava');
    assert.equal(await snapBanner.locator('.banner-say').textContent(), 'New poof');
    await ben.locator('.chat-row').getByText('New poof', { exact: true }).waitFor();
    await snapBanner.click();
    await playing(ben, '.viewer video');
    assert.equal(await bannerOf(ben).count(), 0, 'the banner went as the snap opened');
    await ben.waitForFunction(() => document.querySelector('.viewer video')?.webkitAudioDecodedByteCount > 0); // its sound plays
    const clipEl = ben.locator('.viewer video');
    assert.equal(await clipEl.getAttribute('aria-label'), 'Video from Ava');
    assert.deepEqual(await clipEl.evaluate((v) => [v.muted, v.loop, v.classList.contains('mirror'), v.src.startsWith('blob:')]),
      [false, false, true, true], 'plays once, with sound, mirrored as Ava saw it');
    const capBox = await ben.locator('.media-caption').boundingBox();
    assert.equal(await ben.locator('.media-caption').textContent(), 'Puff says hi');
    assert.ok(capBox.y > viewport.height / 2 && capBox.y + capBox.height < viewport.height, 'the caption sits over the video');
    await shot(ben, 'S15-video-snap');
    await ben.getByText('Received').waitFor();
    await ava.getByText('Seen', { exact: true }).waitFor();

    // S14 from the keyboard: hold Space on the shutter. On the back camera
    // with Flash on, its light stays on for the recording. Muted, the clip
    // that goes up has no sound in it at all, not just a quiet one
    await ben.getByRole('button', { name: 'Camera', exact: true }).click();
    await camVideo(ben, true);
    await ben.getByRole('button', { name: 'Flip camera' }).click();
    await camVideo(ben, false);
    assert.equal(await pressed(ben, 'Flash'), 'true');
    await fakeTorch(ben, true);
    await ben.getByRole('button', { name: 'Take photo', exact: true }).focus();
    await ben.keyboard.down(' ');
    await ben.locator('.camera.recording').waitFor();
    await ringFilled(ben, 12);
    assert.deepEqual(await ben.evaluate(() => window.torchCalls), [true], 'the light is on while it records');
    await ben.keyboard.up(' ');
    await ben.locator('[aria-label="Edit video"]').waitFor();
    assert.deepEqual(await ben.evaluate(() => window.torchCalls), [true, false], 'and off once it stops');
    await fakeTorch(ben, false);
    assert.equal(await ben.getByRole('button', { name: 'Draw' }).count(), 0, 'letting go of Space does not also take a photo');
    assert.equal(await ben.locator('.video-editor video').evaluate((v) => v.classList.contains('mirror')), false,
      'the back camera is not mirrored');
    await ben.getByRole('button', { name: 'Mute' }).click();
    await ben.getByRole('button', { name: 'Send to', exact: true }).click();
    await ben.getByRole('checkbox', { name: /My Story/ }).click();
    const [benPost] = await Promise.all([snapPost(ben), ben.getByRole('button', { name: 'Send', exact: true }).click()]);
    const benClip = clipOf(benPost);
    assert.ok(benClip.bytes.subarray(0, 4).equals(WEBM_MAGIC));
    const benInfo = PoofWebm.info(benClip.bytes);
    assert.deepEqual(benInfo.tracks.map((t) => t.codec), ['V_VP8'], 'muted: a picture and no sound track');
    assert.ok(benInfo.blocks[benInfo.tracks[0].number] > 0, 'with its frames');
    assert.ok(!benClip.bytes.includes('A_OPUS') && !benClip.bytes.includes('OpusHead'), 'nothing of the sound is left in the file');
    assert.equal(benClip.body.caption, '');
    assert.equal(benClip.body.mirror, false);
    await ben.getByText('Received').waitFor();

    // S07 chat both ways, keep a message
    await ben.getByRole('button', { name: 'Chat with Ava' }).click();
    await ben.getByText('Say hi to Ava.').waitFor();
    // what Ben sends shows at once as his, saying Sending…, until it has gone
    const sending = await holdRequests(ben, '**/api/chat/*');
    await ben.getByLabel('Message').fill('nice photo');
    await ben.getByRole('button', { name: 'Send', exact: true }).click();
    const onItsWay = ben.getByRole('button', { name: 'Sending: nice photo' });
    await onItsWay.waitFor();
    assert.equal(await onItsWay.locator('small').textContent(), 'Sending…');
    assert.equal(await ben.getByLabel('Message').inputValue(), '', 'the box is ready for the next');
    await sending.release();
    await ben.getByRole('button', { name: /^Message: nice photo/ }).waitFor();
    assert.equal(await onItsWay.count(), 0, 'the real one took its place');
    // S17 it drops in on Ava's Chat list as a banner: the Puff mark on Ben's
    // avatar, his name and what he said, in a polite live region; the tab's
    // title counts what is new. Tapping the banner opens his chat
    await ava.locator('.chat-row').getByText('New chat', { exact: true }).waitFor();
    const chatBanner = bannerOf(ava);
    await chatBanner.waitFor();
    assert.equal(await ava.locator('#banner').getAttribute('aria-live'), 'polite');
    assert.equal(await chatBanner.locator('.banner-name').textContent(), 'Ben');
    assert.equal(await chatBanner.locator('.banner-say').textContent(), 'nice photo');
    assert.equal(await chatBanner.locator('.banner-who .avatar').count(), 1, "with Ben's avatar");
    assert.equal(await chatBanner.locator('.banner-mark svg').count(), 1, 'and the Puff mark');
    assert.equal((await chatBanner.textContent()).trim(), 'BenNew chat: nice photo', 'read out as who, then what');
    await chatBanner.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // dropped in
    const bannerBox = await chatBanner.boundingBox();
    assert.ok(bannerBox.y >= 0 && bannerBox.y < 24 && bannerBox.height >= 44 && bannerBox.x >= 0 &&
      bannerBox.x + bannerBox.width <= viewport.width, `at the top, easy to tap, inside the screen (${JSON.stringify(bannerBox)})`);
    const unreadBadge = await ava.locator('.nav .badge').textContent();
    assert.ok(Number(unreadBadge) >= 1);
    // the count is a dark number on pink, and nothing around it is faded
    const badgeLook = await ava.locator('.nav .badge').evaluate((el) => {
      const faded = [];
      for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).opacity !== '1') faded.push(n.className);
      return { color: getComputedStyle(el).color, faded };
    });
    assert.deepEqual(badgeLook, { color: await cssColor(ava, 'var(--on-badge)'), faded: [] });
    assert.equal(await ava.title(), `(${unreadBadge}) Poof`, 'the tab title counts what is new');
    await shot(ava, 'S17-banner');
    await chatBanner.click();
    await ava.locator('section.screen[aria-label="Chat with Ben"]').waitFor();
    await ava.getByText('nice photo').waitFor();
    assert.equal(await bannerOf(ava).count(), 0, 'the banner went as the chat opened');
    await ava.waitForFunction(() => document.title === 'Poof'); // read, so nothing is new
    await ava.getByRole('button', { name: /Message: nice photo/ }).click();
    await ava.getByText('Kept in chat').waitFor();
    // kept: its own mark and the word, not the focus colour
    const kept = ava.getByRole('button', { name: /^Message: nice photo, kept/ });
    await kept.waitFor();
    assert.equal(await kept.locator('small svg.i-kept').count(), 1, 'the kept mark');
    assert.match(await kept.locator('small').textContent(), /^Kept · /);
    const keptLook = await kept.evaluate((el) => getComputedStyle(el).boxShadow);
    assert.ok(keptLook !== 'none' && !keptLook.includes(await cssColor(ava, 'var(--accent)')), `kept is not drawn in the focus colour (${keptLook})`);
    await checkIcons(ava, 'chat', { Back: 'back', 'Send Ben a poof': 'camera' });
    await noToast(ava);
    await shot(ava, 'S07-chat');

    // S07 typing: while Ben types, Ava's open thread shows his avatar and
    // moving dots with "Ben is typing…" (his app says so at most every 2
    // seconds), and her Chat list says Typing… in place of his row's status.
    // Both go 4 seconds after he stops, or as soon as his message arrives.
    const typingPosts = [];
    ben.on('request', (r) => { if (r.method() === 'POST' && /\/api\/chat\/[^/]+\/typing$/.test(r.url())) typingPosts.push(r.url()); });
    const benTyping = ava.getByRole('status').filter({ hasText: 'Ben is typing…' });
    assert.equal(await benTyping.count(), 0, 'nobody is typing yet');
    await ben.getByLabel('Message', { exact: true }).pressSequentially('see you', { delay: 50 });
    await benTyping.waitFor();
    const typedAt = Date.now();
    assert.equal(await benTyping.locator('.avatar').count(), 1, "with Ben's avatar");
    const typingDots = benTyping.locator('.typing-dots i');
    assert.equal(await typingDots.count(), 3);
    assert.equal(await typingDots.first().evaluate((d) => getComputedStyle(d).animationName), 'typing-dot', 'the dots move');
    assert.equal(typingPosts.length, 1, 'seven keystrokes, one typing event: at most one every 2 seconds');
    assert.equal(await ben.getByText(/is typing/).count(), 0, 'Ben does not see himself typing');
    const typingBox = await benTyping.boundingBox();
    const composerBox = await ava.locator('.composer').boundingBox();
    assert.ok(typingBox.y + typingBox.height <= composerBox.y + 1 && typingBox.width <= viewport.width,
      'it sits just above where Ava types, inside the screen');
    await shot(ava, 'S07-chat-typing');
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Ben, Typing…' }).waitFor();
    assert.equal(await ava.locator('.chat-row .typing-dots i').count(), 3, 'small dots where the status was');
    assert.equal(await ava.locator('.chat-row .typing-status').evaluate((el) => getComputedStyle(el).color),
      await ava.evaluate(() => { const c = document.createElement('i'); c.style.color = 'var(--chat)'; document.body.append(c);
        const v = getComputedStyle(c).color; c.remove(); return v; }), 'in the chat colour');
    await shot(ava, 'S05-inbox-typing');
    // 4 seconds after his last typing event, with no more, the row has its status back
    await ava.getByRole('button', { name: 'Ben, Received' }).waitFor({ timeout: 8000 });
    assert.ok(Date.now() - typedAt >= 3000, `Typing… stayed until 4 seconds had passed (${Date.now() - typedAt}ms)`);
    assert.equal(await ava.locator('.chat-row .typing-dots').count(), 0);
    // with the thread open again (and less motion: the dots hold still), Ben
    // types on and sends: his message takes the place of the dots at once
    await ava.getByRole('button', { name: 'Chat with Ben' }).click();
    await ava.getByText('nice photo').waitFor();
    assert.equal(await benTyping.count(), 0, 'it had stopped');
    await ava.emulateMedia({ reducedMotion: 'reduce' });
    await ben.getByLabel('Message', { exact: true }).pressSequentially(' tomorrow', { delay: 50 });
    await benTyping.waitFor();
    const typedAgainAt = Date.now();
    assert.equal(await typingDots.first().evaluate((d) => getComputedStyle(d).animationName), 'none', 'still dots with less motion');
    assert.equal(await typingDots.count(), 3);
    assert.equal(typingPosts.length, 2, 'a new typing event once 2 seconds had passed');
    await ben.getByRole('button', { name: 'Send', exact: true }).click();
    await ava.getByText('see you tomorrow').waitFor();
    assert.equal(await benTyping.count(), 0, 'the message arrived and the dots went');
    assert.equal(await bannerOf(ava).count(), 0, 'no banner for a message into the chat on screen');
    assert.equal(await ava.title(), 'Poof', 'nor anything unread');
    assert.ok(Date.now() - typedAgainAt < 3500, 'gone with the message, not 4 seconds on');
    await ava.emulateMedia({ reducedMotion: 'no-preference' });
    // S07 a chat that can't be sent stays, marked Not sent; a tap sends it again
    await ava.route('**/api/chat/*', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Poof is busy. Try again.' }) })
      : route.continue()));
    await ava.getByLabel('Message', { exact: true }).fill('free later?');
    await ava.getByRole('button', { name: 'Send', exact: true }).click();
    const unsent = ava.getByRole('button', { name: 'Not sent: free later?. Tap to try again' });
    await unsent.waitFor();
    await ava.getByText('Poof is busy. Try again.').waitFor();
    assert.equal(await unsent.locator('small').textContent(), 'Not sent · tap to try again');
    await shot(ava, 'S07-chat-not-sent');
    await ava.unroute('**/api/chat/*');
    await unsent.click();
    await ava.getByRole('button', { name: /^Message: free later\?/ }).waitFor();
    assert.equal(await unsent.count(), 0);
    await ben.getByText('free later?').waitFor();

    // S08 stories: Ben watches, Ava sees the viewer
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('button', { name: 'Stories', exact: true }).click();
    await ben.getByRole('button', { name: /Ava/ }).first().waitFor();
    await shot(ben, 'S08-stories');
    await ben.locator('.scroll .row').nth(1).click();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    await checkIcons(ben, 'story viewer', { Close: 'close' });
    await shot(ben, 'S08-story-viewer');
    // press and hold: the photo's timer and its bar stop until you let go,
    // and letting go of a hold is not a tap
    await ben.mouse.move(300, 450);
    await ben.mouse.down();
    await ben.locator('.viewer.held').waitFor();
    assert.equal(await ben.locator('.viewer [role="status"]').textContent(), 'Paused');
    const heldAt = await storyBar(ben, 0);
    await ben.waitForTimeout(600);
    assert.equal(await storyBar(ben, 0), heldAt, 'the bar stands still while held');
    await ben.mouse.up();
    await ben.waitForFunction((w) => parseFloat(document.querySelectorAll('.viewer .progress i')[0].style.width) > w, heldAt);
    assert.equal(await ben.locator('.viewer.held').count(), 0);
    assert.equal(await storyBar(ben, 1), 0, 'still on the first story');
    assert.ok(await ben.getByRole('img', { name: 'Story from Ava' }).isVisible());
    // from the keyboard: hold Space on Next to pause; letting go is not a tap either
    await ben.getByRole('button', { name: 'Next', exact: true }).focus();
    await ben.keyboard.down(' ');
    await ben.locator('.viewer.held').waitFor();
    const keyHeldAt = await storyBar(ben, 0);
    await ben.waitForTimeout(500);
    assert.equal(await storyBar(ben, 0), keyHeldAt, 'the bar stands still while Space is held');
    await ben.keyboard.up(' ');
    await ben.waitForFunction((w) => parseFloat(document.querySelectorAll('.viewer .progress i')[0].style.width) > w, keyHeldAt);
    assert.equal(await storyBar(ben, 1), 0, 'still on the first story after letting go of Space');
    // each half of the screen is a tap target: left goes back, right goes on
    const [prevBox, nextBox] = await Promise.all(['Previous', 'Next'].map((name) => ben.getByRole('button', { name, exact: true }).boundingBox()));
    assert.ok(Math.abs(prevBox.width - viewport.width / 2) <= 1 && prevBox.x === 0 && Math.abs(nextBox.x - viewport.width / 2) <= 1
      && prevBox.height === viewport.height, 'the story is split into two tap halves');
    // Ava's next story is her video: it plays with its caption, and when it
    // ends the viewer moves on by itself (it was her last, so it closes)
    await ben.getByRole('button', { name: 'Next' }).click();
    await playing(ben, '.viewer video');
    assert.equal(await ben.locator('.viewer video').getAttribute('aria-label'), 'Story from Ava');
    assert.equal(await ben.locator('.media-caption').textContent(), 'Puff says hi');
    await ben.waitForFunction(() => parseFloat(document.querySelectorAll('.progress i')[1]?.style.width) > 0, null,
      { polling: 50 }); // its bar follows the video
    await ben.getByRole('heading', { name: 'Stories' }).waitFor();
    // again: the right half goes on to her video, the left half back to her photo, and Escape closes
    await ben.locator('.scroll .row').nth(1).click();
    await ben.getByRole('img', { name: 'Story from Ava' }).waitFor();
    await ben.getByRole('button', { name: 'Next' }).click();
    await ben.locator('.viewer video').waitFor();
    await ben.getByRole('button', { name: 'Previous' }).click();
    await ben.getByRole('img', { name: 'Story from Ava' }).waitFor();
    assert.equal(await ben.locator('.viewer video').count(), 0, 'back on the photo');
    assert.equal(await storyBar(ben, 1), 0);
    await ben.keyboard.press('Escape');
    await ben.getByRole('heading', { name: 'Stories' }).waitFor();
    // and swipe down: the story shrinks away with the list behind it, and closes
    await ben.locator('.scroll .row').nth(1).click();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    await drag(ben, [195, 250], [195, 640], { mid: () => shot(ben, 'S08-story-swipe-down') });
    await ben.getByRole('heading', { name: 'Stories' }).waitFor();
    await swipeSettled(ben);

    // S17 a banner tapped while a snap is open takes Ben where it says, and
    // the snap's timer stops there: when it would have run out, nothing
    // takes him back to the Chat list
    const benIdNow = await ben.evaluate(() => fetch('/api/me').then((r) => r.json()).then((u) => u.id));
    await ben.getByRole('button', { name: 'Chat', exact: true }).click();
    await ben.getByRole('heading', { name: 'Chat' }).waitFor();
    const SNAP_MS = 4000;
    await ava.evaluate(async ([to, secs]) => {
      const c = document.createElement('canvas');
      c.width = 270;
      c.height = 480;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#3ddc97';
      ctx.fillRect(0, 0, c.width, c.height);
      const r = await fetch('/api/snaps', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [to], image: c.toDataURL('image/png'), duration: secs }) });
      if (!r.ok) throw new Error('could not send the snap: ' + r.status);
    }, [benIdNow, SNAP_MS / 1000]);
    await ben.getByRole('button', { name: /Ava, New poof/ }).click();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    const snapOpenAt = Date.now();
    await ava.evaluate((to) => fetch('/api/chat/' + to, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'wait for me' }) }), benIdNow);
    await bannerOf(ben).click();
    await ben.locator('section.screen[aria-label="Chat with Ava"]').waitFor();
    await ben.getByText('wait for me').waitFor();
    assert.ok(Date.now() - snapOpenAt < SNAP_MS - 500, 'the banner was tapped with the snap still showing');
    await ben.waitForTimeout(SNAP_MS + 600 - (Date.now() - snapOpenAt));
    assert.equal(await ben.locator('section.screen[aria-label="Chat with Ava"]').count(), 1, 'still in the chat once the snap would have run out');
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Stories', exact: true }).click();
    await ava.getByText('2 posts · 1 viewer', { exact: true }).waitFor();
    // Ben's muted story: Ava's browser plays its picture and has no sound to play
    await ava.locator('.scroll .row').nth(1).click();
    await playing(ava, '.viewer video');
    assert.equal(await ava.locator('.viewer video').getAttribute('aria-label'), 'Story from Ben');
    assert.deepEqual(await ava.locator('.viewer video').evaluate((v) => [v.webkitVideoDecodedByteCount > 0, v.webkitAudioDecodedByteCount]),
      [true, 0], 'picture, and not a byte of sound');
    await ava.getByRole('heading', { name: 'Stories' }).waitFor(); // it ended and the viewer closed

    // the system notifications Ava's browser shows are recorded here instead,
    // and the browser's answer to asking for permission is window.permissionAnswer
    await ava.evaluate(() => {
      window.shownNotes = [];
      window.permissionAsks = 0;
      window.permissionAnswer = 'denied';
      window.Notification = class {
        static permission = 'default';
        static async requestPermission() {
          window.permissionAsks++;
          window.Notification.permission = window.permissionAnswer;
          return window.permissionAnswer;
        }
        constructor(title, options) { Object.assign(this, { title, ...options, closed: false }); window.shownNotes.push(this); }
        close() { this.closed = true; this.onclose?.(); }
      };
    });
    // S10 profile, opened from Stories: Back goes back there
    await ava.getByRole('button', { name: 'Profile' }).click();
    await ava.getByText('Friends (1)').waitFor();
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('heading', { name: 'Stories' }).waitFor();
    // S10 profile: Ava's Puffcode, large at the top with her avatar inside it
    await ava.getByRole('button', { name: 'Profile' }).click();
    await ava.getByText('Friends (1)').waitFor();
    // each friend is a row that opens their card (Remove friend is there, and asks first): no Remove on every row
    const benOnProfile = ava.getByRole('button', { name: 'Ben, @ben, 2-day streak' });
    assert.equal(await benOnProfile.locator('.streak svg.i-streak').count(), 1, 'the streak mark');
    assert.equal(await ava.getByRole('button', { name: 'Remove', exact: true }).count(), 0, 'no Remove button on the row');
    await benOnProfile.click();
    const profileCard = ava.getByRole('dialog', { name: 'Ben' });
    await profileCard.getByRole('button', { name: 'Remove friend' }).waitFor();
    await ava.keyboard.press('Escape');
    await profileCard.waitFor({ state: 'detached' });
    assert.equal(await ava.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ben, @ben, 2-day streak', 'focus back on his row');
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

    // S17 Profile > Notifications, a switch. Turned on, it asks the browser:
    // blocked, it stays off and says so; allowed, it is on
    const notifySwitch = ava.getByRole('switch', { name: 'Notifications' });
    assert.equal(await notifySwitch.getAttribute('aria-checked'), 'false');
    assert.ok((await notifySwitch.boundingBox()).height >= 44, 'the switch is easy to tap');
    await notifySwitch.click();
    await ava.getByText('Blocked in this browser. Allow notifications for this site in its settings.').waitFor();
    assert.equal(await notifySwitch.getAttribute('aria-checked'), 'false', 'blocked: still off');
    await ava.evaluate(() => { window.permissionAnswer = 'granted'; });
    await notifySwitch.click();
    await ava.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true');
    assert.equal(await ava.evaluate(() => window.permissionAsks), 2);
    await notifySwitch.scrollIntoViewIfNeeded();
    await noToast(ava);
    await shot(ava, 'S10-profile-notifications');
    // with Poof out of sight, a chat from Ben raises one, titled Poof with his
    // name and the app icon, and no banner; the tab's title counts it
    const benUser = await ben.evaluate(() => fetch('/api/me').then((r) => r.json()));
    const avaUser = await ava.evaluate(() => fetch('/api/me').then((r) => r.json()));
    const setHidden = (page, hidden) => page.evaluate((hide) => {
      if (hide) {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      } else {
        delete document.hidden;
        delete document.visibilityState;
      }
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await setHidden(ava, true);
    await ben.evaluate((to) => fetch('/api/chat/' + to, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'on my way' }) }), avaUser.id);
    await ava.waitForFunction(() => window.shownNotes.length === 1);
    assert.deepEqual(await ava.evaluate(() => (({ title, body, icon, tag }) => ({ title, body, icon, tag }))(window.shownNotes[0])),
      { title: 'Poof', body: 'New chat from Ben', icon: '/icons/icon-192.png', tag: 'chat:' + benUser.id });
    assert.equal(await bannerOf(ava).count(), 0, 'no banner while Poof is out of sight');
    assert.equal(await ava.title(), '(1) Poof');
    const icon192 = await ava.evaluate(() => fetch('/icons/icon-192.png').then(async (r) => [r.status, r.headers.get('content-type')]));
    assert.deepEqual(icon192, [200, 'image/png'], 'the icon it shows is there');
    // clicking it brings Poof back with Ben's chat open, and closes it
    await setHidden(ava, false);
    await ava.evaluate(() => window.shownNotes[0].onclick());
    await ava.locator('section.screen[aria-label="Chat with Ben"]').waitFor();
    await ava.getByText('on my way').waitFor();
    assert.equal(await ava.evaluate(() => window.shownNotes[0].closed), true);
    await ava.waitForFunction(() => document.title === 'Poof');
    // his chat open but out of sight: what he says next waits there unread,
    // counted in the title, until Poof is back in view
    const lastFromBen = () => ben.evaluate((to) => fetch('/api/chat/' + to).then((r) => r.json())
      .then((d) => d.messages.filter((m) => m.from !== to).at(-1)), avaUser.id);
    await setHidden(ava, true);
    await ben.evaluate((to) => fetch('/api/chat/' + to, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'are you there' }) }), avaUser.id);
    await ava.waitForFunction(() => window.shownNotes.length === 2);
    await ava.waitForFunction(() => document.title === '(1) Poof');
    assert.deepEqual([(await lastFromBen()).text, (await lastFromBen()).readAt], ['are you there', null], 'not read while out of sight');
    assert.equal(await ava.getByText('are you there').count(), 0);
    await setHidden(ava, false);
    await ava.getByText('are you there').waitFor();
    await ava.waitForFunction(() => document.title === 'Poof');
    assert.ok((await lastFromBen()).readAt, 'read once back in view');
    // in sight again, news comes as a banner, not a notification; and the
    // switch turns off without asking again
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Profile' }).click();
    await notifySwitch.click();
    assert.equal(await notifySwitch.getAttribute('aria-checked'), 'false');
    assert.equal(await ava.evaluate(() => window.permissionAsks), 2);
    assert.equal(await ava.evaluate(() => window.shownNotes.length), 2, 'one a message, no more');
    // two more tabs of Poof in Ava's browser, on the same session: one she
    // goes on using, one she leaves alone
    const [tabB, tabC] = [watch(await ava.context().newPage()), watch(await ava.context().newPage())];
    for (const tab of [tabB, tabC]) {
      await tab.goto(base);
      await tab.getByRole('button', { name: 'Take photo' }).waitFor();
    }
    await ava.getByRole('button', { name: 'Log out' }).click();

    // S01 log out lands on the welcome screen; log back in from there
    await ava.getByRole('button', { name: 'Sign up' }).waitFor();
    assert.equal(await ava.evaluate(() => document.documentElement.dataset.chrome), 'brand');
    assert.ok(await ava.locator('#toast').isHidden(), 'no news from the last session on the welcome screen');
    assert.equal(await bannerOf(ava).count(), 0, 'no banner either');
    assert.equal(await ava.title(), 'Poof', 'and nothing counted in the title');
    // S01 logged out in one tab, out in them all: the one in use finds out at
    // its next step, the one left alone from its live stream ending. A chat to
    // Ava now shows in neither: no banner, nothing counted
    await tabB.getByRole('button', { name: 'Stories', exact: true }).click();
    await tabB.getByRole('button', { name: 'Sign up' }).waitFor();
    await tabC.getByRole('button', { name: 'Sign up' }).waitFor({ timeout: 10000 });
    await ben.evaluate((to) => fetch('/api/chat/' + to, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'my PIN is 4321, delete this' }) }), avaUser.id);
    await ben.waitForTimeout(800);
    for (const tab of [tabB, tabC]) {
      assert.equal(await bannerOf(tab).count(), 0, 'no banner in a logged-out tab');
      assert.equal(await tab.title(), 'Poof');
      assert.equal(await tab.getByText('4321').count(), 0);
    }
    await tabB.close();
    await tabC.close();
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
    // S17 Ava, in her chat with Ben, hears about it in a banner; she swipes it
    // up out of the way and stays where she was
    const calBanner = bannerOf(ava);
    await calBanner.waitFor();
    assert.equal(await calBanner.locator('.banner-name').textContent(), 'Cal');
    assert.equal(await calBanner.locator('.banner-say').textContent(), 'Sent you a friend request');
    await calBanner.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const calBox = await calBanner.boundingBox();
    const calMid = [calBox.x + calBox.width / 2, calBox.y + calBox.height * 0.75];
    await drag(ava, calMid, [calMid[0], 2], { ms: 180, mid: async () => {
      const y = (await calBanner.boundingBox()).y;
      assert.ok(y < calBox.y - 8, `it follows the pointer up (${y} from ${calBox.y})`);
    } });
    await calBanner.waitFor({ state: 'detached', timeout: 1000 });
    assert.equal(await ava.locator('section.screen[aria-label="Chat with Ben"]').count(), 1, 'swiping it away opens nothing');

    // S02 with a code reader: the camera spots a Puffcode and offers to add them
    await cal.getByRole('button', { name: 'Done' }).click();
    await cal.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
    // S14 with the microphone blocked: it still records and says it has no
    // sound. Held on and on, it stops by itself at 10 seconds. There is
    // nothing to mute, and Discard goes back to the camera
    await cal.evaluate(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => (c?.audio ? Promise.reject(new DOMException('No', 'NotAllowedError')) : real(c));
    });
    const calShutter = await cal.getByRole('button', { name: 'Take photo', exact: true }).boundingBox();
    await cal.mouse.move(calShutter.x + calShutter.width / 2, calShutter.y + calShutter.height / 2);
    await cal.mouse.down();
    await cal.getByText('Recording without sound. Allow the microphone to add sound.').waitFor();
    const recordingFrom = Date.now();
    await cal.locator('[aria-label="Edit video"]').waitFor({ timeout: 15000 }); // still holding
    const recordedFor = Date.now() - recordingFrom;
    assert.ok(recordedFor > 9000 && recordedFor < 11000, `a recording stops itself at 10 seconds (${recordedFor}ms)`);
    await cal.mouse.up();
    assert.equal(await cal.getByRole('button', { name: 'Draw' }).count(), 0, 'letting go afterwards takes no photo');
    assert.equal(await cal.getByRole('button', { name: 'Mute' }).count(), 0, 'no sound, nothing to mute');
    await playing(cal, '.video-editor video');
    await cal.getByRole('button', { name: 'Discard' }).click();
    await cal.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
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

    // S06 Ben snaps Ava again; she swipes it down to close it
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();
    const avaId = await ava.evaluate(() => fetch('/api/me').then((r) => r.json()).then((u) => u.id));
    // S06 a video poof on a slow connection: a tap while it is on its way
    // waits for it (opening one uses it up), and it plays, alone
    const clipUrl = 'data:video/webm;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'clip-with-sound.webm')).toString('base64');
    await ben.evaluate(async ([to, video]) => {
      const r = await fetch('/api/snaps', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [to], video, duration: 0.6 }) });
      if (!r.ok) throw new Error('could not send the video: ' + r.status);
    }, [avaId, clipUrl]);
    const slow = await holdRequests(ava, '**/api/snaps/*/open');
    await ava.getByRole('button', { name: /Ben, New poof/ }).click();
    await ava.waitForFunction(() => document.querySelector('.viewer'));
    await ava.waitForTimeout(200);
    assert.equal(slow.seen.length, 1);
    await ava.getByRole('button', { name: 'Next' }).click();
    await ava.getByRole('button', { name: 'Next' }).click();
    assert.equal(await ava.locator('.viewer').count(), 1, 'the taps did not close it');
    await slow.release();
    const videosPlaying = await ava.waitForFunction(() => {
      const v = document.querySelectorAll('.viewer video');
      return v.length && !v[0].paused && v[0].currentTime > 0 ? v.length : 0;
    });
    assert.equal(await videosPlaying.jsonValue(), 1, 'one video, playing');
    assert.equal(slow.seen.length, 1, 'opened once');
    await ava.getByRole('heading', { name: 'Chat' }).waitFor(); // it ended, and was the last
    await ava.locator('.puff-pop').waitFor({ state: 'detached' });
    await ben.evaluate(async (to) => {
      const c = document.createElement('canvas');
      c.width = 270;
      c.height = 480;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#3db4ff';
      ctx.fillRect(0, 0, c.width, c.height);
      const r = await fetch('/api/snaps', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [to], image: c.toDataURL('image/png'), duration: 10 }) });
      if (!r.ok) throw new Error('could not send the snap: ' + r.status);
    }, avaId);
    // S17 left alone, its banner goes by itself after 4 seconds
    const lastBanner = bannerOf(ava);
    await lastBanner.waitFor();
    const bannerAt = Date.now();
    await lastBanner.waitFor({ state: 'detached', timeout: 8000 });
    const bannerFor = Date.now() - bannerAt;
    assert.ok(bannerFor >= 3600 && bannerFor < 6000, `the banner stayed about 4 seconds (${bannerFor}ms)`);
    await ava.getByRole('button', { name: /Ben, New poof/ }).click();
    await ava.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    await drag(ava, [195, 300], [195, 620], { mid: () => shot(ava, 'S06-snap-swipe-down') });
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();
    await ava.getByText('Received').waitFor();
    await swipeSettled(ava);

    // Ben leaves his chat with Ava for his Chat list
    await ben.getByRole('button', { name: 'Back' }).click();
    await ben.getByRole('heading', { name: 'Chat' }).waitFor();
    // S18 New chat, on the Chat list: Ava starts a group with Ben. One
    // friend picked opens your chat with them; a name (or two or more
    // friends) makes it a group, and the button says which
    const newChat = ava.getByRole('button', { name: 'New chat' });
    const fabBox = await newChat.boundingBox();
    assert.ok(fabBox.width >= 44 && fabBox.height >= 44 && fabBox.x + fabBox.width <= viewport.width
      && fabBox.y + fabBox.height <= (await ava.locator('.nav').boundingBox()).y, 'New chat is easy to tap, above the tabs');
    await checkIcons(ava, 'chat list', { 'New chat': 'chat-new' });
    await newChat.click();
    await ava.getByRole('heading', { name: 'New chat' }).waitFor();
    const startChat = ava.locator('.send-bar .btn');
    assert.equal(await startChat.isDisabled(), true, 'nothing picked yet');
    await ava.getByRole('checkbox', { name: /Ben/ }).click();
    assert.equal(await startChat.textContent(), 'Chat', 'one friend: a chat with him');
    await ava.getByLabel('Group name').fill('Weekend plans');
    assert.equal(await startChat.textContent(), 'Start group', 'named: a group');
    assert.equal(await ava.locator('.send-bar .who').textContent(), 'Ben');
    await checkIcons(ava, 'new chat', { Back: 'back' });
    await shot(ava, 'S18-new-chat');
    await ava.getByRole('button', { name: 'Start group' }).click();
    // S19 its chat opens; Ava says something, and it is new in Ben's Chat
    // list: a row with two stacked avatars, and a banner with the group's name
    const avaGroup = ava.locator('section.screen[aria-label="Chat in Weekend plans"]');
    await avaGroup.waitFor();
    await ava.getByRole('heading', { name: 'Weekend plans' }).waitFor();
    await checkIcons(ava, 'group chat', { Back: 'back', 'Group details': 'group' });
    await ava.getByLabel('Message', { exact: true }).fill('Who is in for Saturday?');
    await ava.getByRole('button', { name: 'Send', exact: true }).click();
    await ava.getByRole('button', { name: /^Message: Who is in for Saturday\?/ }).getByText(/· sent$/).waitFor();
    const benGroupRow = ben.getByRole('button', { name: 'Weekend plans, New chat' });
    await benGroupRow.waitFor();
    assert.equal(await ben.locator('.chat-row[data-group] .avatar-stack .avatar').count(), 2, 'two stacked avatars');
    const groupNote = bannerOf(ben);
    await groupNote.getByText('Ava: Who is in for Saturday?', { exact: true }).waitFor();
    assert.equal(await groupNote.locator('.banner-name').textContent(), 'Weekend plans');
    // Ben opens the group's chat from his Chat list: Ava's message is there
    // under her name and avatar. His reply reaches Ava's open chat (no
    // banner), and each sees the other has read theirs
    await benGroupRow.click();
    await ben.locator('section.screen[aria-label="Chat in Weekend plans"]').waitFor();
    const fromAva = ben.getByRole('button', { name: /^Message from Ava: Who is in for Saturday\?/ });
    await fromAva.waitFor();
    const avaRun = ben.locator('.msg-run').filter({ has: fromAva });
    assert.equal(await avaRun.locator('.msg-sender').textContent(), 'Ava');
    assert.equal(await avaRun.locator('.avatar.has-art').count(), 1, "with Ava's avatar");
    assert.equal(await bannerOf(ben).count(), 0, 'the banner went as the chat opened');
    await ben.getByLabel('Message', { exact: true }).fill('Count me in');
    await ben.getByRole('button', { name: 'Send', exact: true }).click();
    await ava.getByRole('button', { name: /^Message from Ben: Count me in/ }).waitFor();
    assert.equal(await bannerOf(ava).count(), 0, 'no banner for a message into the group on screen');
    await ava.getByRole('button', { name: /^Message: Who is in for Saturday\?/ }).getByText(/· read$/).waitFor();
    await ben.getByRole('button', { name: /^Message: Count me in/ }).getByText(/· read$/).waitFor();
    await shot(ben, 'S19-group-chat');

    // S04 Send to lists groups: Ava snaps the group from the camera
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('button', { name: 'Weekend plans, Received' }).waitFor();
    await ava.getByRole('button', { name: 'Camera', exact: true }).click();
    await camVideo(ava, true);
    await ava.getByRole('button', { name: 'Take photo', exact: true }).click();
    await ava.getByRole('button', { name: 'Send to', exact: true }).click();
    await ava.getByRole('heading', { name: 'Groups' }).waitFor();
    await ava.getByRole('checkbox', { name: /Weekend plans/ }).click();
    assert.equal(await ava.locator('.send-bar .who').textContent(), 'Weekend plans');
    await shot(ava, 'S04-send-to-group');
    const [groupPost] = await Promise.all([snapPost(ava), ava.getByRole('button', { name: 'Send', exact: true }).click()]);
    const groupSnap = JSON.parse(groupPost.postData());
    assert.deepEqual([groupSnap.to, groupSnap.groupIds.length, groupSnap.story], [[], 1, false]);
    await ava.getByRole('button', { name: 'Weekend plans, Sent' }).waitFor();
    // Ben, still in the group's chat, hears it in a banner and opens it from
    // there: the viewer says who sent it, over the group's name. It opens once
    const groupSnapNote = bannerOf(ben);
    await groupSnapNote.getByText('New poof from Ava', { exact: true }).waitFor();
    assert.equal(await groupSnapNote.locator('.banner-name').textContent(), 'Weekend plans');
    await groupSnapNote.click();
    await ben.getByRole('img', { name: 'Photo from Ava' }).waitFor();
    await ben.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
    assert.deepEqual(await ben.locator('.viewer .head .who > span').allTextContents(), ['Ava', 'Weekend plans']);
    await ben.getByRole('button', { name: 'Next' }).click();
    await ben.getByRole('button', { name: 'Weekend plans, Received' }).waitFor();
    await ava.getByRole('button', { name: 'Weekend plans, Seen' }).waitFor();
    await ben.locator('.puff-pop').waitFor({ state: 'detached' });
    await shot(ben, 'S19-group-row');

    // S19 the group card from Ben's row: who is in it (him first), Send a
    // chat, and Leave group, which asks first with the safe choice focused
    await ben.getByRole('button', { name: 'Weekend plans details' }).click();
    const groupCard = ben.getByRole('dialog', { name: 'Weekend plans' });
    await groupCard.waitFor();
    await groupCard.getByText('2 people', { exact: true }).waitFor();
    assert.deepEqual(await groupCard.locator('.members .name').allTextContents(), ['Ben (you)', 'Ava']);
    for (const name of ['Send a chat', 'Leave group', 'Close']) {
      const b = await groupCard.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(b.width >= 44 && b.height >= 44, `${name} is easy to tap`);
    }
    await ben.locator('.sheet').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await shot(ben, 'S19-group-card');
    await groupCard.getByRole('button', { name: 'Leave group' }).click();
    await groupCard.getByText('Leave Weekend plans?').waitFor();
    assert.equal(await ben.evaluate(() => document.activeElement?.textContent), 'Cancel', 'the safe choice is focused');
    await groupCard.getByRole('button', { name: 'Leave', exact: true }).click();
    await groupCard.waitFor({ state: 'detached' });
    await ben.getByText('You left Weekend plans').waitFor();
    await ben.locator('.chat-row[data-group]').waitFor({ state: 'detached' });
    // Ava's chat says he left. She leaves too, from Group details, and with
    // nobody left in it the group is gone
    await ava.getByRole('button', { name: /^Weekend plans, / }).click();
    await avaGroup.waitFor();
    await ava.getByText('Ben left the group.').waitFor();
    await ava.getByRole('button', { name: 'Group details' }).click();
    const avaCard = ava.getByRole('dialog', { name: 'Weekend plans' });
    await avaCard.getByText('Just you', { exact: true }).waitFor();
    assert.equal(await avaCard.getByRole('button', { name: 'Send a chat' }).count(), 0, 'she is in its chat already');
    await avaCard.getByRole('button', { name: 'Leave group' }).click();
    await avaCard.getByRole('button', { name: 'Leave', exact: true }).click();
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();
    await ava.getByText('You left Weekend plans').waitFor();
    await ava.locator('.chat-row[data-group]').waitFor({ state: 'detached' });
    assert.equal(await ava.evaluate(() => document.activeElement?.closest('.chat-row')?.dataset.friend != null), true,
      'focus lands on what is left');

    // S19 a group with no name is called after the others in it, as each sees
    // it: Ben for Ava, Ava for Ben. A long name stays on one line in its header
    const benIdLast = await ben.evaluate(() => fetch('/api/me').then((r) => r.json()).then((u) => u.id));
    const makeGroup = (body) => ava.evaluate((b) => fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b) }).then((r) => r.json()), body);
    const unnamed = await makeGroup({ members: [benIdLast] });
    const long = await makeGroup({ name: 'Ava Lindqvist-Montgomery, Ben and Cal', members: [benIdLast] });
    await ben.locator(`.chat-row[data-group="${unnamed.id}"]`).waitFor();
    assert.equal(await ben.locator(`.chat-row[data-group="${unnamed.id}"] .name`).textContent(), 'Ava');
    await ava.getByRole('button', { name: 'Chat', exact: true }).click();
    const avaUnnamed = ava.locator(`.chat-row[data-group="${unnamed.id}"]`);
    await avaUnnamed.waitFor();
    assert.equal(await avaUnnamed.locator('.name').textContent(), 'Ben', 'not her own name');
    assert.equal(await avaUnnamed.locator('.row').getAttribute('aria-label'), 'Ben, Say hi');
    await ava.locator(`.chat-row[data-group="${long.id}"] .row`).click();
    const title = ava.getByRole('heading', { name: 'Ava Lindqvist-Montgomery, Ben and Cal' });
    await title.waitFor();
    const fit = await title.evaluate((el) => ({ h: el.clientHeight, line: parseFloat(getComputedStyle(el).lineHeight) || 30,
      cut: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow }));
    assert.ok(fit.h <= 32 && fit.cut && fit.ellipsis === 'ellipsis', `one line, cut short with an ellipsis (${JSON.stringify(fit)})`);
    await noToast(ava);
    await shot(ava, 'S19-group-long-name');
    for (const g of [unnamed, long]) {
      for (const page of [ava, ben]) await page.evaluate((id) => fetch(`/api/groups/${id}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), g.id);
    }
    await ava.getByRole('button', { name: 'Back' }).click();
    await ava.getByRole('heading', { name: 'Chat' }).waitFor();
    await ava.locator('.chat-row[data-group]').waitFor({ state: 'detached' });

    // S16 Ava removes Ben from his friend card: it asks first, then he is gone from her chats
    await ava.getByRole('button', { name: "Ben's friend card" }).click();
    const lastCard = ava.getByRole('dialog', { name: 'Ben' });
    await lastCard.getByRole('button', { name: 'Remove friend' }).click();
    await lastCard.getByRole('button', { name: 'Remove', exact: true }).click();
    await lastCard.waitFor({ state: 'detached' });
    await ava.getByText('Removed Ben').waitFor();
    await ava.getByText('Nobody to talk to yet').waitFor();
    assert.equal(await ava.evaluate(() => document.activeElement?.textContent), 'Add friends', 'focus lands on what is left');

    assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
    console.log('e2e: all flows passed. Screenshots in replica/clone-screens/');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => { console.error(e); process.exit(1); });
