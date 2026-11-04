'use strict';
(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const TIMERS = [1, 3, 5, 10, 0]; // 0 = no limit
  const COLORS = ['#ffffff', '#ff5d8f', '#ffd23f', '#3ddc97', '#3db4ff', '#7c5cff', '#111111'];

  const state = {
    me: null,
    tab: 'camera',
    facing: 'user',
    stream: null,
    photo: null, // canvas with the captured image
    editor: null, // { draw canvas, caption, captionY, timer }
    unread: 0,
    events: null,
    refresh: null, // re-render hook for the current screen on live events
    pendingAdd: null, // a username from a Puffcode or /add/<username> link, opened once logged in
    scan: null, // { timer, busy } while the camera is looking for Puffcodes
  };

  // ---------- tiny DOM helper ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function show(screen) {
    app.replaceChildren(screen);
    // the welcome screen is violet edge to edge (status bar too); the rest is dark
    const brand = screen.classList.contains('welcome');
    if (brand) document.documentElement.dataset.chrome = 'brand';
    else delete document.documentElement.dataset.chrome;
    const color = getComputedStyle(document.documentElement).getPropertyValue(brand ? '--brand-bg' : '--bg').trim();
    if (themeMeta && color) themeMeta.setAttribute('content', color);
    const focusable = screen.querySelector('[autofocus]');
    if (focusable) focusable.focus();
  }

  // The launch splash lives in index.html so it paints before any script runs.
  // It goes as soon as the first screen is drawn: a short fade, or straight
  // away when the system asks for less motion.
  function hideSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { splash.remove(); return; }
    splash.classList.add('leaving');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 500); // in case the transition never reports back
  }

  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.me) { state.me = null; renderWelcome(); }
      throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    }
    return data;
  }

  // A person's avatar art, or, until they make one, the white Puff mark on a
  // circle in their own colour. Decorative: the name beside it says who it is.
  function avatar(user, extra = '', size = 44) {
    const box = `width:${size}px;height:${size}px`;
    if (user.avatar) {
      const el = h('span', { class: 'avatar has-art ' + extra, 'aria-hidden': 'true', style: box });
      el.innerHTML = window.PoofAvatar.avatarSVG(user.avatar, size); // built from validated integers only
      return el;
    }
    const el = h('span', {
      class: 'avatar placeholder ' + extra, 'aria-hidden': 'true',
      style: `background:${window.PoofAvatar.placeholderColor(user.username)};${box}`,
    });
    // static mascot markup, no user input; CSS scales it to 80% of the circle
    el.innerHTML = window.mascotSVG('happy', Math.round(size * 0.8), '', 'mark', '#ffffff');
    return el;
  }

  // Puff, the mascot (see mascot.js). Decorative unless given a label.
  function puff(mood, size, label) {
    const el = h('span', { class: 'mascot', 'aria-hidden': label ? null : 'true' });
    el.innerHTML = window.mascotSVG(mood, size, label || ''); // static markup, no user input
    if (!label) el.firstElementChild.removeAttribute('role');
    return el;
  }

  // A drawn interface icon (see icons.js). Always decorative: the button around
  // it carries the accessible name.
  function icon(name, size = 24) {
    const el = h('span', { class: 'icon', 'aria-hidden': 'true' });
    el.innerHTML = window.PoofIcons.svg(name, size); // static markup, no user input
    return el;
  }

  // a quick celebratory pop: Puff appears, then vanishes in a puff
  function puffPop(text, mood = 'wink') {
    const pop = h('div', { class: 'puff-pop', role: 'status' }, puff(mood, 150), h('strong', {}, text));
    document.body.append(pop);
    setTimeout(() => pop.remove(), 1300);
  }

  function ago(ms) {
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  // ---------- welcome, log in, sign up (S01) ----------
  function renderWelcome() {
    stopCamera();
    state.me = null;
    clearTimeout(toastTimer); // news from the last session is not for whoever logs in next
    toastEl.hidden = true;
    show(h('section', { class: 'screen welcome', 'aria-label': 'Welcome' },
      h('div', { class: 'hero' },
        puff('happy', 220, 'Puff, the Poof mascot'),
        h('h1', {}, 'Poof'),
        h('p', { class: 'tagline' }, 'Photos that vanish once they are seen.'),
        state.pendingAdd && h('p', { class: 'invite' }, `Log in or sign up to add @${state.pendingAdd}.`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn block on-brand-quiet', type: 'button', onclick: renderLogin }, 'Log in'),
        h('button', { class: 'btn block on-brand', type: 'button', onclick: () => renderSignup(1, {}) }, 'Sign up'))));
  }

  // One screen of the log in / sign up flow: back arrow, optional step count,
  // a heading, the fields, one note line for hints and errors, and the single
  // action at the bottom. Enter submits.
  function flowScreen({ label, step, back, title, lede, fields, note, action, submit }) {
    const btn = h('button', { class: 'btn block', type: 'submit' }, action);
    const form = h('form', { class: 'screen flow', 'aria-label': label, novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      try { await submit(); } finally { btn.disabled = false; }
    } },
    h('header', { class: 'bar' }, backButton('Back', back),
      h('p', { class: 'step' }, step ? `Step ${step} of 3` : ''), h('span', { class: 'bar-end' })),
    h('div', { class: 'flow-body' }, h('h1', {}, title), lede && h('p', { class: 'lede' }, lede), ...fields, note),
    h('div', { class: 'flow-foot' }, btn));
    show(form);
  }

  // the note under a field: hints, the live username check, and errors
  function noteLine() {
    const el = h('p', { class: 'note', id: 'flow-note', 'aria-live': 'polite' });
    el.set = (text, tone, withIcon) => {
      el.className = 'note' + (tone ? ' ' + tone : '');
      el.replaceChildren(...(withIcon ? [icon(withIcon, 18)] : []), text || '');
      const input = el.closest('form')?.querySelector('input:not([hidden])');
      if (input && tone === 'bad') input.setAttribute('aria-invalid', 'true');
      else if (input) input.removeAttribute('aria-invalid');
    };
    return el;
  }

  // a password box with a Show / Hide switch, so one typo cannot lock you out
  function passwordField(autocomplete, autofocus) {
    const input = h('input', { id: 'flow-password', name: 'password', type: 'password', autocomplete, autofocus,
      autocapitalize: 'none', spellcheck: 'false', 'aria-describedby': 'flow-note' });
    const toggle = h('button', { class: 'reveal', type: 'button', 'aria-label': 'Show password', onclick: () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? 'Show' : 'Hide';
      toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    } }, 'Show');
    return { input, el: h('div', { class: 'field' }, h('label', { for: 'flow-password' }, 'Password'),
      h('div', { class: 'reveal-wrap' }, input, toggle)) };
  }

  function renderLogin() {
    stopCamera();
    const username = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none',
      spellcheck: 'false', autofocus: true, 'aria-describedby': 'flow-note' });
    const password = passwordField('current-password', false);
    const note = noteLine();
    flowScreen({
      label: 'Log in', back: renderWelcome, title: 'Log in', lede: 'Welcome back.',
      fields: [h('label', { class: 'field' }, h('span', {}, 'Username'), username), password.el], note, action: 'Log in',
      submit: async () => {
        if (!username.value.trim() || !password.input.value) {
          note.set('Enter your username and password.', 'bad');
          (username.value.trim() ? password.input : username).focus();
          return;
        }
        note.set('');
        try {
          state.me = await api('/api/login', { username: username.value, password: password.input.value });
          start();
        } catch (e) {
          note.set(e.message, 'bad');
          password.input.focus();
        }
      },
    });
  }

  // Sign up, one question at a time: name, username (checked live), password.
  // `draft` carries the answers between steps, so Back never loses them.
  const cleanUsername = (v) => String(v || '').trim().toLowerCase();
  function renderSignup(step, draft) {
    stopCamera();
    const note = noteLine();
    const back = () => (step === 1 ? renderWelcome() : renderSignup(step - 1, draft));

    if (step === 1) {
      const input = h('input', { name: 'displayName', autocomplete: 'name', autocapitalize: 'words', maxlength: '40',
        value: draft.name || '', autofocus: true, 'aria-describedby': 'flow-note' });
      return flowScreen({
        label: 'Sign up', step, back, title: "What's your name?", lede: 'This is the name your friends see.',
        fields: [h('label', { class: 'field' }, h('span', {}, 'Your name'), input)], note, action: 'Continue',
        submit: () => {
          const name = input.value.trim();
          if (!name) { note.set("Add a name so friends know it's you.", 'bad'); input.focus(); return; }
          renderSignup(2, { ...draft, name });
        },
      });
    }

    if (step === 2) {
      const input = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off',
        spellcheck: 'false', value: draft.username || '', autofocus: true, 'aria-describedby': 'flow-note' });
      let timer;
      let seq = 0;
      let result = draft.checked || null; // { name, available, reason } for the latest name checked
      const paint = () => {
        const name = cleanUsername(input.value);
        if (!name) return note.set('');
        if (!result || result.name !== name) return note.set('Checking…');
        if (result.available) return note.set(`${name} is available`, 'ok', 'check');
        if (result.available === false) return note.set(result.reason, 'bad');
        return note.set(''); // the check could not run; sign up will check again
      };
      const check = async (name) => {
        const mine = ++seq;
        let r;
        try {
          r = { name, ...(await api('/api/users/available?username=' + encodeURIComponent(name))) };
        } catch {
          r = { name, available: null, reason: null };
        }
        if (mine !== seq) return null; // a newer check is on its way
        result = r;
        paint();
        return r;
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        paint();
        const name = cleanUsername(input.value);
        if (name && (!result || result.name !== name)) timer = setTimeout(() => check(name), 300);
      });
      flowScreen({
        label: 'Sign up', step, back: () => { draft.username = input.value; draft.checked = result; back(); },
        title: 'Pick a username', lede: 'Friends find you by it. Use 3 to 20 letters, numbers, dots or underscores.',
        fields: [h('label', { class: 'field' }, h('span', {}, 'Username'), input)], note, action: 'Continue',
        submit: async () => {
          const name = cleanUsername(input.value);
          if (!name) { note.set('Pick a username to continue.', 'bad'); input.focus(); return; }
          clearTimeout(timer);
          const r = result && result.name === name ? result : await check(name);
          if (!r || cleanUsername(input.value) !== name) return; // they kept typing
          if (r.available === false) { note.set(r.reason, 'bad'); input.focus(); return; }
          renderSignup(3, { ...draft, username: name, checked: r });
        },
      });
      // a name carried back from another step gets checked again if needed
      const first = cleanUsername(input.value);
      if (first && (!result || result.name !== first)) check(first);
      paint();
      return undefined;
    }

    const password = passwordField('new-password', true);
    flowScreen({
      label: 'Sign up', step, back, title: 'Set a password', lede: 'Use at least 8 characters.',
      // lets password managers save the new login under the right username
      fields: [h('input', { type: 'text', name: 'username', autocomplete: 'username', value: draft.username,
        readonly: true, hidden: true, tabindex: '-1' }), password.el],
      note, action: 'Create account',
      submit: async () => {
        const pw = password.input.value;
        if (pw.length < 8) { note.set('Passwords need at least 8 characters.', 'bad'); password.input.focus(); return; }
        try {
          state.me = await api('/api/signup', { displayName: draft.name, username: draft.username, password: pw });
          start('avatar');
        } catch (e) {
          // a username problem (say someone took it a moment ago) is fixed on step 2
          if (e.status === 409 || /username/i.test(e.message)) {
            renderSignup(2, { ...draft, checked: { name: draft.username, available: false, reason: e.message } });
            return;
          }
          note.set(e.message, 'bad');
          password.input.focus();
        }
      },
    });
    return undefined;
  }

  // ---------- shell ----------
  function nav(active) {
    const item = (tab, label) => h('button', {
      type: 'button', 'aria-current': active === tab ? 'page' : null, 'aria-label': label,
      onclick: () => go(tab),
    }, icon(tab, 26), label,
    tab === 'chat' && state.unread ? h('span', { class: 'badge' }, state.unread) : null);
    return h('nav', { class: 'nav' + (active === 'camera' ? '' : ' solid') },
      item('chat', 'Chat'), item('camera', 'Camera'), item('stories', 'Stories'));
  }

  function go(tab) {
    state.tab = tab;
    state.refresh = null;
    if (tab !== 'camera') stopCamera();
    if (tab === 'camera') renderCamera();
    else if (tab === 'chat') renderInbox();
    else if (tab === 'stories') renderStories();
    else if (tab === 'friends') renderFriends();
    else if (tab === 'profile') renderProfile();
    else if (tab === 'avatar') renderAvatarMaker();
  }

  function header(title, left, right) {
    return h('header', { class: 'bar' }, left || h('span', { style: 'width:48px' }), h('h1', {}, title),
      right || h('span', { style: 'width:48px' }));
  }
  const meButton = () => h('button', { class: 'icon-btn plain', 'aria-label': 'Profile', onclick: () => go('profile') },
    avatar(state.me));
  const addButton = () => h('button', { class: 'icon-btn plain', 'aria-label': 'Add friends', onclick: () => go('friends') },
    icon('puff-plus', 28));
  const backButton = (label, onclick) => h('button', { class: 'icon-btn plain', type: 'button', 'aria-label': label, onclick }, icon('back'));

  // ---------- camera (S02) ----------
  function stopCamera() {
    stopScan();
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }

  async function renderCamera() {
    const video = h('video', { autoplay: true, playsInline: true, muted: true, class: state.facing === 'user' ? 'mirror' : '' });
    const msg = h('div', { class: 'cam-msg', hidden: true });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => {
      const f = file.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => { openEditor(imageToCanvas(img, img.naturalWidth, img.naturalHeight, false)); URL.revokeObjectURL(img.src); };
      img.onerror = () => toast('That file is not a photo we can read.');
      img.src = URL.createObjectURL(f);
    } });
    const chipSlot = h('div', { class: 'scan-chip-slot', 'aria-live': 'polite' });
    const screen = h('section', { class: 'screen camera', 'aria-label': 'Camera' },
      video, msg,
      h('header', { class: 'bar overlay' }, meButton(), h('h1', {}), addButton()),
      chipSlot,
      h('div', { class: 'shutter-row' },
        h('button', { class: 'icon-btn', 'aria-label': 'Choose a photo', onclick: () => file.click() }, icon('image')),
        h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: () => capture(video) }),
        h('button', { class: 'icon-btn', 'aria-label': 'Flip camera', onclick: () => {
          state.facing = state.facing === 'user' ? 'environment' : 'user';
          stopCamera();
          renderCamera();
        } }, icon('flip'))),
      file, nav('camera'));
    show(screen);
    if (!navigator.mediaDevices?.getUserMedia) {
      msg.hidden = false;
      msg.textContent = 'This browser cannot open the camera. Use the photo button to pick one instead.';
      return;
    }
    try {
      stopCamera();
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.facing, width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: false,
      });
      if (state.tab !== 'camera' || !video.isConnected) return stopCamera();
      video.srcObject = state.stream;
    } catch {
      msg.hidden = false;
      msg.textContent = 'Camera is blocked. Allow camera access in your browser settings, or use the photo button.';
      return undefined;
    }
    // Point the camera at a friend's Puffcode and an "Add @name" chip pops up
    // (where the browser can read codes). It goes again once the code is out of view.
    const detector = await qrDetector();
    if (!detector || state.tab !== 'camera' || !video.isConnected) return undefined;
    let shown = null;
    let hide;
    watchForPuffcodes(detector, video, (name) => {
      if (name === state.me.username) return;
      clearTimeout(hide);
      hide = setTimeout(() => { chipSlot.replaceChildren(); shown = null; }, 3000);
      if (shown === name) return;
      shown = name;
      chipSlot.replaceChildren(h('button', { class: 'scan-chip', type: 'button', onclick: () => renderAddProfile(name) },
        icon('puff-plus', 22), 'Add @' + name));
    });
    return undefined;
  }

  // ---------- reading Puffcodes ----------
  // A QR reader from the browser (BarcodeDetector), or null where there is none.
  let detectorReady = null;
  function qrDetector() {
    if (!detectorReady) {
      detectorReady = (async () => {
        if (!('BarcodeDetector' in window)) return null;
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          if (Array.isArray(formats) && !formats.includes('qr_code')) return null;
          return new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch { return null; }
      })();
    }
    return detectorReady;
  }

  // a copy of a frame or photo with its colours flipped, on an opaque canvas
  // (see-through parts of a saved Puffcode become a clear white margin)
  let frameCanvas = null;
  function flippedFrame(source, w, ht) {
    const scale = Math.min(1, 720 / Math.max(w, ht));
    const c = frameCanvas || (frameCanvas = document.createElement('canvas'));
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(ht * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Look for a Puffcode for this server in a frame or photo. Puffcodes are
  // white on violet, and some readers only see dark codes on light, so the
  // picture is also tried with its colours flipped. -> { name } | { other } | null
  async function findPuffcode(detector, source, w, ht, ways = ['as is', 'flipped']) {
    let seen = false;
    for (const way of ways) {
      let codes = [];
      try { codes = await detector.detect(way === 'as is' ? source : flippedFrame(source, w, ht)); } catch {}
      for (const code of codes) {
        const name = window.PoofPuffcode.parse(code.rawValue, location.host);
        if (name) return { name };
        seen = true;
      }
    }
    return seen ? { other: true } : null;
  }

  // Check the camera for Puffcodes about every 600ms until it stops. Passive
  // checks take turns between the frame as is and flipped, to stay light.
  function watchForPuffcodes(detector, video, found, { other, both = false } = {}) {
    stopScan();
    let turn = 0;
    const scan = { busy: false, timer: null };
    scan.timer = setInterval(async () => {
      if (!video.isConnected) {
        clearInterval(scan.timer);
        if (state.scan === scan) state.scan = null;
        return;
      }
      if (scan.busy || video.readyState < 2 || !video.videoWidth) return;
      scan.busy = true;
      const ways = both ? ['as is', 'flipped'] : [turn++ % 2 ? 'flipped' : 'as is'];
      const r = await findPuffcode(detector, video, video.videoWidth, video.videoHeight, ways);
      scan.busy = false;
      if (state.scan !== scan || !video.isConnected) return;
      if (r?.name) found(r.name);
      else if (r?.other && other) other();
    }, 600);
    state.scan = scan;
  }

  function stopScan() {
    if (state.scan) clearInterval(state.scan.timer);
    state.scan = null;
  }

  function imageToCanvas(source, w, ht, mirror) {
    const scale = Math.min(1, 1080 / Math.max(w, ht));
    const c = h('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(ht * scale);
    const ctx = c.getContext('2d');
    if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  function capture(video) {
    if (!video.videoWidth) return toast('The camera is not ready yet.');
    openEditor(imageToCanvas(video, video.videoWidth, video.videoHeight, state.facing === 'user'));
  }

  // ---------- editor (S03) ----------
  function openEditor(photo) {
    stopCamera();
    state.photo = photo;
    state.editor = { timer: 5, captionY: 0.7, color: COLORS[1], drawing: false, strokes: 0 };
    const ed = state.editor;
    const base = photo;
    const draw = h('canvas', { 'aria-hidden': 'true' });
    draw.width = base.width;
    draw.height = base.height;
    ed.draw = draw;
    const dctx = draw.getContext('2d');
    const history = [];

    const caption = h('input', { class: 'caption', placeholder: 'Add a caption', maxlength: '80', 'aria-label': 'Caption', hidden: true });
    ed.caption = caption;
    const stage = h('div', { class: 'stage' }, base, draw, caption);

    function layout() {
      const r = base.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      draw.style.width = r.width + 'px';
      draw.style.height = r.height + 'px';
      caption.style.top = (r.top - sr.top + ed.captionY * r.height - 20) + 'px';
    }

    // drawing
    let last = null;
    const point = (e) => {
      const r = draw.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (draw.width / r.width), y: (e.clientY - r.top) * (draw.height / r.height) };
    };
    draw.addEventListener('pointerdown', (e) => {
      if (!ed.drawing) return;
      history.push(dctx.getImageData(0, 0, draw.width, draw.height));
      if (history.length > 20) history.shift();
      draw.setPointerCapture(e.pointerId);
      last = point(e);
      dctx.lineCap = 'round';
      dctx.lineJoin = 'round';
      dctx.lineWidth = Math.max(4, draw.width / 90);
      dctx.strokeStyle = ed.color;
      dctx.beginPath();
      dctx.arc(last.x, last.y, dctx.lineWidth / 2, 0, Math.PI * 2);
      dctx.fillStyle = ed.color;
      dctx.fill();
    });
    draw.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = point(e);
      dctx.beginPath();
      dctx.moveTo(last.x, last.y);
      dctx.lineTo(p.x, p.y);
      dctx.stroke();
      last = p;
    });
    const end = () => { last = null; };
    draw.addEventListener('pointerup', end);
    draw.addEventListener('pointercancel', end);
    // tapping the photo (not drawing) adds a caption
    draw.addEventListener('click', () => {
      if (ed.drawing) return;
      caption.hidden = false;
      layout();
      caption.focus();
    });
    // drag the caption up and down
    let drag = null;
    caption.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, start: ed.captionY }; });
    caption.addEventListener('pointermove', (e) => {
      if (!drag || Math.abs(e.clientY - drag.y) < 6) return;
      const r = base.getBoundingClientRect();
      ed.captionY = Math.min(0.95, Math.max(0.05, drag.start + (e.clientY - drag.y) / r.height));
      layout();
    });
    caption.addEventListener('pointerup', () => { drag = null; });
    caption.addEventListener('blur', () => { if (!caption.value.trim()) caption.hidden = true; });

    const penBtn = h('button', { class: 'icon-btn', 'aria-label': 'Draw', 'aria-pressed': 'false', onclick: () => {
      ed.drawing = !ed.drawing;
      penBtn.setAttribute('aria-pressed', String(ed.drawing));
      colors.hidden = !ed.drawing;
      undoBtn.hidden = !ed.drawing;
    } }, icon('pen'));
    const colors = h('div', { class: 'colors', hidden: true }, COLORS.map((c) => h('button', {
      class: 'swatch', style: `background:${c}`, 'aria-label': 'Colour ' + c, 'aria-pressed': String(c === ed.color),
      onclick: (e) => {
        ed.color = c;
        colors.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
      },
    })));
    const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo', hidden: true, onclick: () => {
      const prev = history.pop();
      if (prev) dctx.putImageData(prev, 0, 0);
    } }, icon('undo'));
    const timerLabel = h('span', { class: 'timer-label' });
    const showTimer = () => { timerLabel.textContent = ed.timer ? ed.timer + 's' : '∞'; };
    const timerBtn = h('button', { class: 'icon-btn timer-btn', 'aria-label': 'Timer', onclick: () => {
      ed.timer = TIMERS[(TIMERS.indexOf(ed.timer) + 1) % TIMERS.length];
      showTimer();
    } }, icon('timer', 20), timerLabel);
    showTimer();
    const textBtn = h('button', { class: 'icon-btn', 'aria-label': 'Add caption', onclick: () => {
      caption.hidden = false; layout(); caption.focus();
    } }, icon('text'));

    const screen = h('section', { class: 'screen editor', 'aria-label': 'Edit snap' },
      stage,
      h('div', { class: 'tools' }, textBtn, penBtn, colors, undoBtn, timerBtn),
      h('header', { class: 'bar overlay', style: 'right:auto' },
        h('button', { class: 'icon-btn', 'aria-label': 'Discard', onclick: () => go('camera') }, icon('close'))),
      h('div', { class: 'editor-foot' },
        h('button', { class: 'icon-btn', 'aria-label': 'Save to device', onclick: saveToDevice }, icon('download')),
        h('button', { class: 'btn', onclick: () => renderSendTo() }, 'Send to', icon('send', 20))));
    show(screen);
    requestAnimationFrame(layout);
    window.onresize = layout;
  }

  // burn the drawing and caption into one JPEG
  function flatten() {
    const { draw, caption, captionY } = state.editor;
    const base = state.photo;
    const out = h('canvas');
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(draw, 0, 0);
    const text = caption.value.trim();
    if (text) {
      const size = Math.round(out.width / 22);
      const bandH = size * 2;
      const y = captionY * out.height;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, y - bandH / 2, out.width, bandH);
      ctx.fillStyle = '#fff';
      ctx.font = `${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, out.width / 2, y, out.width - size);
    }
    return out.toDataURL('image/jpeg', 0.85);
  }

  function saveToDevice() {
    const a = h('a', { href: flatten(), download: `poof-${Date.now()}.jpg` });
    document.body.append(a);
    a.click();
    a.remove();
    toast('Saved');
  }

  // ---------- send to (S04) ----------
  async function renderSendTo() {
    const image = flatten();
    const picked = new Set();
    let story = false;
    const who = h('span', { class: 'who' }, 'Pick who gets it');
    const sendLabel = () => ['Send', icon('send', 18)];
    const sendBtn = h('button', { class: 'btn small', disabled: true, onclick: send }, sendLabel());
    const list = h('div', { class: 'scroll', style: 'padding-bottom:96px' }, h('p', { class: 'hint' }, 'Loading friends…'));
    const back = backButton('Back to editing', () => { show(editorScreen); window.onresize?.(); });
    const editorScreen = app.firstElementChild;
    show(h('section', { class: 'screen', 'aria-label': 'Send to' }, header('Send to', back), list,
      h('div', { class: 'send-bar' }, who, sendBtn)));

    function update(friends) {
      const names = friends.filter((f) => picked.has(f.id)).map((f) => f.displayName);
      if (story) names.unshift('My Story');
      who.textContent = names.length ? names.join(', ') : 'Pick who gets it';
      sendBtn.disabled = !names.length;
    }
    async function send() {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        await api('/api/snaps', { to: [...picked], story, image, duration: state.editor.timer });
        puffPop(story && !picked.size ? 'Posted to your story' : 'Poof! Sent', story && !picked.size ? 'party' : 'wink');
        go('chat');
      } catch (e) {
        toast(e.message);
        sendBtn.disabled = false;
        sendBtn.replaceChildren(...sendLabel());
      }
    }
    let data;
    try { data = await api('/api/friends'); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    const toggle = (row, on) => row.setAttribute('aria-checked', String(on));
    const storyRow = h('button', { class: 'row', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
      story = !story; toggle(storyRow, story); update(data.friends);
    } }, h('span', { class: 'avatar ring', style: 'background:var(--surface-2)' }, icon('stories')),
    h('span', { class: 'main' }, h('div', { class: 'name' }, 'My Story'), h('div', { class: 'sub' }, 'Friends can watch for 24 hours')),
    h('span', { class: 'check' }, icon('check', 16)));
    list.replaceChildren(storyRow, h('h2', { class: 'section-title' }, 'Friends'));
    if (!data.friends.length) {
      list.append(h('div', { class: 'empty' }, puff('sleepy', 110), h('strong', {}, 'No friends yet'),
        'Add someone by username to send them snaps. You can still post to your story.',
        h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn ghost small', onclick: () => go('friends') }, 'Add friends'))));
    }
    for (const f of data.friends) {
      const row = h('button', { class: 'row', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
        picked.has(f.id) ? picked.delete(f.id) : picked.add(f.id);
        toggle(row, picked.has(f.id));
        update(data.friends);
      } }, avatar(f), h('span', { class: 'main' }, h('div', { class: 'name' }, f.displayName),
        h('div', { class: 'sub' }, '@' + f.username)),
      f.streak > 1 ? h('span', { class: 'streak' }, f.streak + ' 🔥') : null,
      h('span', { class: 'check' }, icon('check', 16)));
      list.append(row);
    }
  }

  // ---------- inbox (S05) ----------
  const STATUS = {
    'new-snap': ['snap-c', 'fill', 'New snap'],
    'new-chat': ['chat-c', 'fill', 'New chat'],
    opened: ['snap-c', 'outline', 'Opened'],
    delivered: ['snap-c', 'arrow', 'Delivered'],
    received: ['snap-c', 'outline', 'Received'],
    'chat-opened': ['chat-c', 'outline', 'Read'],
    'chat-delivered': ['chat-c', 'arrow', 'Sent'],
    'chat-received': ['chat-c', 'outline', 'Received'],
    'tap-to-chat': ['chat-c', 'outline', 'Tap to chat'],
  };

  async function renderInbox() {
    const list = h('div', { class: 'scroll' }, h('p', { class: 'hint' }, 'Loading…'));
    show(h('section', { class: 'screen', 'aria-label': 'Chats' }, header('Chat', meButton(), addButton()), list, nav('chat')));
    const load = async () => {
      let rows;
      try { rows = await api('/api/inbox'); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      state.unread = rows.reduce((n, r) => n + r.snapIds.length + r.unread, 0);
      app.querySelector('.nav')?.replaceWith(nav('chat'));
      if (!rows.length) {
        list.replaceChildren(h('div', { class: 'empty' }, puff('sleepy', 120), h('strong', {}, 'Nobody to talk to yet'),
          'Add friends by username, then snap them from the camera.',
          h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn small', onclick: () => go('friends') }, 'Add friends'))));
        return;
      }
      list.replaceChildren(...rows.map((r) => {
        const [color, shape, label] = STATUS[r.status];
        return h('div', { style: 'display:flex;align-items:center' },
          h('button', { class: 'row', onclick: () => (r.snapIds.length ? openSnaps(r.friend, r.snapIds) : renderChat(r.friend)),
            'aria-label': `${r.friend.displayName}, ${label}` },
          avatar(r.friend),
          h('span', { class: 'main' },
            h('div', { class: 'name' }, r.friend.displayName),
            h('div', { class: 'sub ' + color }, h('span', { class: `status-icon ${shape}`, 'aria-hidden': 'true' }),
              h('span', {}, label + (r.snapIds.length > 1 ? ` (${r.snapIds.length})` : '')),
              r.lastAt ? h('span', { style: 'color:var(--text-dim)' }, '· ' + ago(r.lastAt)) : null)),
          r.streak > 1 ? h('span', { class: 'streak' }, r.streak + ' 🔥') : null),
          h('button', { class: 'icon-btn plain', style: 'margin-left:8px', 'aria-label': 'Chat with ' + r.friend.displayName,
            onclick: () => renderChat(r.friend) }, icon('chat')));
      }));
    };
    state.refresh = load;
    await load();
  }

  // ---------- snap viewer (S06) ----------
  async function openSnaps(friend, ids) {
    state.refresh = null;
    const queue = [...ids];
    const img = h('img', { alt: 'Snap from ' + friend.displayName });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ring-timer');
    svg.setAttribute('viewBox', '0 0 36 36');
    const track = document.createElementNS(svgNS, 'circle');
    const bar = document.createElementNS(svgNS, 'circle');
    for (const c of [track, bar]) { c.setAttribute('cx', 18); c.setAttribute('cy', 18); c.setAttribute('r', 15); }
    track.style.stroke = 'rgba(255,255,255,.3)';
    bar.style.stroke = '#fff';
    bar.setAttribute('transform', 'rotate(-90 18 18)');
    bar.style.strokeDasharray = String(2 * Math.PI * 15);
    svg.append(track, bar);
    let timer = null;
    let raf = null;
    let viewed = 0;
    const close = () => {
      clearTimeout(timer); cancelAnimationFrame(raf); go('chat');
      if (viewed) puffPop('Poof! Gone for good', 'wow');
    };
    const next = async () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      const id = queue.shift();
      if (!id) return close();
      let snap;
      try { snap = await api(`/api/snaps/${id}/open`, {}); } catch (e) { puffPop(e.message, 'sad'); return next(); }
      img.src = snap.image;
      viewed++;
      svg.style.visibility = snap.duration ? 'visible' : 'hidden';
      if (snap.duration) {
        const startAt = performance.now();
        const total = snap.duration * 1000;
        const tick = () => {
          const p = Math.min(1, (performance.now() - startAt) / total);
          bar.style.strokeDashoffset = String(p * 2 * Math.PI * 15);
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        tick();
        timer = setTimeout(next, total);
      }
    };
    show(h('section', { class: 'screen viewer', 'aria-label': 'Snap' }, img,
      h('button', { class: 'tap', 'aria-label': 'Next', onclick: next }),
      h('div', { class: 'head' }, avatar(friend), h('span', { class: 'who' }, friend.displayName), svg,
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close')))));
    next();
  }

  // ---------- chat thread (S07) ----------
  async function renderChat(friend) {
    const thread = h('div', { class: 'thread', 'aria-live': 'polite' });
    const input = h('input', { placeholder: 'Send a chat', 'aria-label': 'Message', maxlength: '2000', autofocus: true });
    const form = h('form', { class: 'composer', onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await api('/api/chat/' + friend.id, { text }); await load(); } catch (e2) { toast(e2.message); input.value = text; }
    } }, input, h('button', { class: 'btn small', type: 'submit' }, 'Send'));
    const back = backButton('Back', () => go('chat'));
    const cam = h('button', { class: 'icon-btn plain', 'aria-label': 'Snap ' + friend.displayName, onclick: () => go('camera') },
      icon('camera'));
    show(h('section', { class: 'screen', 'aria-label': 'Chat with ' + friend.displayName },
      header(friend.displayName, back, cam), thread, form));
    async function load() {
      let data;
      try { data = await api('/api/chat/' + friend.id); } catch (e) { thread.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
      thread.replaceChildren(h('p', { class: 'hint' }, 'Chats disappear 24 hours after they are read. Tap one to keep it.'),
        ...data.messages.map((m) => h('button', {
          class: 'msg' + (m.from === state.me.id ? ' mine' : '') + (m.saved ? ' saved' : ''),
          'aria-label': (m.saved ? 'Kept message: ' : 'Message: ') + m.text + '. Tap to ' + (m.saved ? 'stop keeping' : 'keep'),
          onclick: async () => { try { await api(`/api/messages/${m.id}/save`, {}); load(); } catch (e) { toast(e.message); } },
        }, m.text, h('small', {}, ago(m.createdAt) + (m.saved ? ' · kept' : '') +
          (m.from === state.me.id ? (m.readAt ? ' · read' : ' · sent') : '')))));
      if (!data.messages.length) thread.append(h('div', { class: 'empty' }, puff('happy', 100), 'Say hi to ' + friend.displayName + ' 👋'));
      if (atBottom || !thread.dataset.loaded) thread.scrollTop = thread.scrollHeight;
      thread.dataset.loaded = '1';
    }
    state.refresh = load;
    await load();
  }

  // ---------- stories (S08) ----------
  async function renderStories() {
    const list = h('div', { class: 'scroll' }, h('p', { class: 'hint' }, 'Loading…'));
    show(h('section', { class: 'screen', 'aria-label': 'Stories' }, header('Stories', meButton(), addButton()), list, nav('stories')));
    const load = async () => {
      let data;
      try { data = await api('/api/stories'); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      const mineRow = h('button', { class: 'row', onclick: () => (data.mine.length ? watch([{ user: state.me, stories: data.mine }], 0, true) : go('camera')) },
        avatar(state.me, data.mine.length ? 'ring' : ''),
        h('span', { class: 'main' }, h('div', { class: 'name' }, 'My Story'),
          h('div', { class: 'sub' }, data.mine.length
            ? `${data.mine.length} snap${data.mine.length > 1 ? 's' : ''} · ${new Set(data.mine.flatMap((s) => s.viewers.map((v) => v.id))).size} viewers`
            : 'Tap to add a snap')));
      const rows = data.friends.map((g, i) => {
        const seen = g.stories.every((s) => s.seen);
        return h('button', { class: 'row', onclick: () => watch(data.friends, i) },
          avatar(g.user, 'ring' + (seen ? ' seen' : '')),
          h('span', { class: 'main' }, h('div', { class: 'name' }, g.user.displayName),
            h('div', { class: 'sub' }, ago(g.stories.at(-1).createdAt) + (seen ? ' · watched' : ''))));
      });
      list.replaceChildren(mineRow, h('h2', { class: 'section-title' }, 'Friends'),
        ...(rows.length ? rows : [h('div', { class: 'empty' }, puff('sleepy', 110), h('strong', {}, 'Nothing new'),
          'When friends post to their story it shows up here for 24 hours.')]));
    };
    state.refresh = load;
    await load();
  }

  function watch(groups, gi, mine = false) {
    state.refresh = null;
    let si = groups[gi].stories.findIndex((s) => !s.seen);
    if (si < 0 || mine) si = 0;
    let timer = null;
    let raf = null;
    const img = h('img', { alt: '' });
    const progress = h('div', { class: 'progress' });
    const who = h('span', { class: 'who' });
    const sub = h('span', { class: 'sub', style: 'font-size:.8rem;opacity:.8' });
    const av = h('span');
    const close = () => { clearTimeout(timer); cancelAnimationFrame(raf); go('stories'); };
    function play() {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      const g = groups[gi];
      const s = g.stories[si];
      img.src = `/api/stories/${s.id}/media`;
      img.alt = 'Story from ' + g.user.displayName;
      who.textContent = mine ? 'My Story' : g.user.displayName;
      sub.textContent = ago(s.createdAt) + (mine ? ` · seen by ${s.viewers.length}${s.viewers.length ? ': ' + s.viewers.map((v) => v.displayName).join(', ') : ''}` : '');
      av.replaceChildren(avatar(g.user));
      progress.replaceChildren(...g.stories.map((_, i) => h('div', {}, h('i', { style: `width:${i < si ? 100 : 0}%` }))));
      if (!mine && !s.seen) { s.seen = true; api(`/api/stories/${s.id}/view`, {}).catch(() => {}); }
      const fill = progress.children[si].firstChild;
      const total = (s.duration || 5) * 1000;
      const startAt = performance.now();
      const tick = () => {
        const p = Math.min(1, (performance.now() - startAt) / total);
        fill.style.width = p * 100 + '%';
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      img.onload = () => { tick(); timer = setTimeout(step.bind(null, 1), total); };
    }
    function step(dir) {
      si += dir;
      if (si < 0) { if (gi > 0 && !mine) { gi--; si = 0; } else si = 0; }
      if (si >= groups[gi].stories.length) {
        if (mine || gi + 1 >= groups.length) return close();
        gi++; si = 0;
      }
      play();
    }
    show(h('section', { class: 'screen viewer', 'aria-label': 'Story' }, img, progress,
      h('button', { class: 'tap', style: 'right:66%', 'aria-label': 'Previous', onclick: () => step(-1) }),
      h('button', { class: 'tap', style: 'left:34%', 'aria-label': 'Next', onclick: () => step(1) }),
      h('div', { class: 'head', style: 'top:12px' }, av,
        h('span', { class: 'who', style: 'display:flex;flex-direction:column' }, who, sub),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close')))));
    play();
  }

  // ---------- add friends (S09) ----------
  async function renderFriends() {
    const results = h('div');
    const requests = h('div');
    let q = '';
    let debounce;
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search by username', 'aria-label': 'Search users',
      autofocus: true, autocapitalize: 'none', oninput: () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { q = search.value.trim(); runSearch(); }, 200);
      } });
    const back = backButton('Back', () => go('chat'));
    show(h('section', { class: 'screen', 'aria-label': 'Add friends' }, header('Add friends', back),
      h('div', { class: 'scroll' }, h('div', { class: 'field search-field' }, icon('search', 20), search),
        h('button', { class: 'btn ghost block scan-btn', type: 'button', onclick: renderScanner }, icon('scan', 20), 'Scan Puffcode'),
        results, requests)));

    async function act(path, body, okText, mood) {
      try {
        await api(path, body);
        if (mood) puffPop(okText, mood); else toast(okText);
        await Promise.all([runSearch(), loadRequests()]);
      } catch (e) { toast(e.message); }
    }
    async function runSearch() {
      if (q.length < 2) { results.replaceChildren(); return; }
      let users;
      try { users = await api('/api/users/search?q=' + encodeURIComponent(q)); } catch (e) { results.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      results.replaceChildren(h('h2', { class: 'section-title' }, 'Results'),
        ...(users.length ? users.map((u) => h('div', { class: 'row' }, avatar(u),
          h('span', { class: 'main' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username)),
          u.status === 'accepted' ? h('span', { class: 'sub' }, 'Friends')
            : u.status === 'pending' ? h('span', { class: 'sub' }, 'Requested')
              : h('button', { class: 'btn small', onclick: () => act('/api/friends/request', { username: u.username }, 'Request sent') },
                icon('plus', 18), 'Add')))
          : [h('p', { class: 'hint' }, 'No one matches "' + q + '".')]));
    }
    async function loadRequests() {
      let data;
      try { data = await api('/api/friends'); } catch { return; }
      requests.replaceChildren(...[
        data.incoming.length ? h('h2', { class: 'section-title' }, 'Added me') : null,
        ...data.incoming.map((u) => h('div', { class: 'row' }, avatar(u),
          h('span', { class: 'main' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username)),
          h('button', { class: 'btn small', onclick: () => act('/api/friends/accept', { userId: u.id }, 'You are now friends', 'love') }, 'Accept'))),
        data.outgoing.length ? h('h2', { class: 'section-title' }, 'Waiting on') : null,
        ...data.outgoing.map((u) => h('div', { class: 'row' }, avatar(u),
          h('span', { class: 'main' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username + ' · pending')))),
        !data.incoming.length && !data.outgoing.length && q.length < 2
          ? h('div', { class: 'empty' }, puff('wow', 110), h('strong', {}, 'Find your friends'), 'Type a username to send a request.') : null,
      ].filter(Boolean));
    }
    state.refresh = () => Promise.all([runSearch(), loadRequests()]);
    loadRequests();
  }

  // ---------- add a friend from a Puffcode or link (S12) ----------
  // One person, where you stand with them, and the one thing to do next.
  async function renderAddProfile(username) {
    stopCamera();
    state.tab = 'add';
    const body = h('div', { class: 'scroll add-profile' }, h('p', { class: 'hint' }, 'Loading…'));
    show(h('section', { class: 'screen', 'aria-label': 'Add friend' },
      header('Add friend', backButton('Back', () => go('friends'))), body));
    const load = async () => {
      let u;
      try {
        u = await api('/api/users/by-username/' + encodeURIComponent(username));
      } catch (e) {
        body.replaceChildren(e.status === 404
          ? h('div', { class: 'empty' }, puff('sad', 110), h('strong', {}, 'No one by that name'),
            `There is nobody called @${username} on Poof. Check the code, or search by username.`,
            h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'button', onclick: () => go('friends') }, 'Find friends')))
          : h('p', { class: 'error' }, e.message));
        return;
      }
      // adding someone who already added you accepts them
      const send = async (btn) => {
        btn.disabled = true;
        try {
          const r = await api('/api/friends/request', { username: u.username });
          if (r.status === 'accepted') puffPop('You are now friends', 'love');
          else toast('Request sent');
          await load();
        } catch (e) { toast(e.message); btn.disabled = false; }
      };
      const note = (text) => h('p', { class: 'profile-note' }, text);
      let next;
      if (u.status === 'none') {
        next = h('button', { class: 'btn block', type: 'button', onclick: () => send(next) }, icon('plus', 20), 'Add friend');
      } else if (u.status === 'incoming') {
        next = [note(`${u.displayName} added you.`),
          h('button', { class: 'btn block', type: 'button', onclick: (e) => send(e.currentTarget) }, 'Accept')];
      } else if (u.status === 'requested') {
        next = [note(`Request sent. You will be friends once ${u.displayName} accepts.`),
          h('button', { class: 'btn ghost block', type: 'button', onclick: () => go('camera') }, 'Done')];
      } else if (u.status === 'friends') {
        next = [note(`You and ${u.displayName} are friends.`),
          h('button', { class: 'btn block', type: 'button', onclick: () => renderChat(u) }, icon('chat', 20), 'Send a chat')];
      } else {
        next = [note('This is your own Puffcode.'),
          h('button', { class: 'btn block', type: 'button', onclick: () => go('profile') }, 'Go to your profile')];
      }
      body.replaceChildren(h('div', { class: 'profile-card' }, avatar(u, '', 96),
        h('h2', { class: 'profile-name' }, u.displayName), h('p', { class: 'profile-user' }, '@' + u.username)),
      h('div', { class: 'profile-next' }, next));
    };
    state.refresh = load;
    await load();
  }

  // ---------- scan a Puffcode (S13) ----------
  // A live camera that reads Puffcodes, plus reading one from a photo. Where
  // the browser cannot read codes, it says to use the phone's camera app,
  // which opens the code's /add/ link in the browser.
  async function renderScanner() {
    stopCamera();
    state.tab = 'scan';
    state.refresh = null;
    const back = backButton('Back', () => go('friends'));
    const detector = await qrDetector();
    if (state.tab !== 'scan') return;
    if (!detector) {
      show(h('section', { class: 'screen', 'aria-label': 'Scan Puffcode' }, header('Scan Puffcode', back),
        h('div', { class: 'scroll' }, h('div', { class: 'empty' }, puff('wink', 120),
          h('strong', {}, "Use your phone's camera"),
          "This browser can't read codes. Open your phone's camera app, point it at the Puffcode, then tap the link it shows."))));
      return;
    }
    const found = (name) => renderAddProfile(name);
    const video = h('video', { autoplay: true, playsInline: true, muted: true });
    const AIM = 'Point your camera at a Puffcode.';
    const note = h('p', { class: 'scan-note', 'aria-live': 'polite' }, AIM);
    let reset;
    const say = (text) => {
      note.textContent = text;
      clearTimeout(reset);
      reset = setTimeout(() => { if (state.stream) note.textContent = AIM; }, 4000);
    };
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      let bitmap;
      try { bitmap = await createImageBitmap(f); } catch { say('That file is not a photo we can read.'); return; }
      const r = await findPuffcode(detector, bitmap, bitmap.width, bitmap.height);
      bitmap.close?.();
      if (r?.name) found(r.name);
      else say(r ? "That code isn't a Puffcode." : 'No Puffcode in that photo. Try another one.');
    } });
    show(h('section', { class: 'screen scanner', 'aria-label': 'Scan Puffcode' }, video,
      h('div', { class: 'scan-frame', 'aria-hidden': 'true' }),
      h('header', { class: 'bar overlay' }, back, h('h1', {}, 'Scan Puffcode'), h('span', { style: 'width:48px' })),
      h('div', { class: 'scan-foot' }, note,
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('image', 20), 'Scan from photo'), file)));
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (state.tab !== 'scan' || !video.isConnected) { stopCamera(); return; }
      video.srcObject = state.stream;
    } catch {
      note.textContent = 'Camera is blocked. Allow camera access, or scan from a photo.';
      return;
    }
    watchForPuffcodes(detector, video, found, { both: true, other: () => say("That code isn't a Puffcode.") });
  }

  // ---------- links to a profile: /add/<username> ----------
  // A Puffcode holds this link. Opened before logging in, it is remembered
  // (in this tab) through the welcome, log in and sign up screens.
  const PENDING_KEY = 'poof.pendingAdd';
  function rememberDeepLink() {
    const name = window.PoofPuffcode.parse(location.href, location.host);
    if (name) {
      state.pendingAdd = name;
      try { sessionStorage.setItem(PENDING_KEY, name); } catch {}
      history.replaceState(null, '', '/');
      return;
    }
    try { state.pendingAdd = sessionStorage.getItem(PENDING_KEY); } catch {}
  }
  // where someone lands once they are in: a remembered link first, else the camera
  function home() {
    const name = state.pendingAdd;
    state.pendingAdd = null;
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    if (name) renderAddProfile(name);
    else go('camera');
  }

  // ---------- avatar maker (S11) ----------
  const TABS = [
    ['expr', 'Expression'], ['face', 'Face'], ['skin', 'Skin'], ['eyeColor', 'Eyes'], ['hair', 'Hair'],
    ['hairColor', 'Hair colour'], ['beard', 'Facial hair'], ['acc', 'Extras'], ['shirt', 'Top'], ['bg', 'Background'],
  ];
  function renderAvatarMaker() {
    const A = window.PoofAvatar;
    const onboarding = !state.me.avatar;
    let cfg = { ...(state.me.avatar || A.random()) };
    let tab = 'expr';
    const preview = h('div', { class: 'avatar-preview' });
    const tabs = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Avatar parts' });
    const grid = h('div', { class: 'option-grid', role: 'radiogroup' });
    const saveBtn = h('button', { class: 'btn', onclick: save }, onboarding ? 'Looks like me' : 'Save');

    function draw() {
      preview.innerHTML = A.avatarSVG(cfg, 180, 'Your avatar');
      tabs.replaceChildren(...TABS.map(([k, label]) => h('button', {
        class: 'chip', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; draw(); },
      }, label)));
      grid.setAttribute('aria-label', TABS.find(([k]) => k === tab)[1]);
      const isColour = A.PARTS[tab][0].startsWith('#');
      grid.replaceChildren(...A.PARTS[tab].map((v, i) => {
        const btn = h('button', {
          class: 'option' + (isColour ? ' swatch-opt' : ''), role: 'radio', 'aria-checked': String(cfg[tab] === i),
          'aria-label': isColour ? `${TABS.find(([k]) => k === tab)[1]} ${i + 1}` : v,
          style: isColour ? `background:${v}` : null,
          onclick: () => { cfg = { ...cfg, [tab]: i }; draw(); },
        });
        if (!isColour) btn.innerHTML = A.avatarSVG({ ...cfg, [tab]: i }, 64);
        return btn;
      }));
    }
    async function save() {
      saveBtn.disabled = true;
      try {
        state.me = await api('/api/me/avatar', { avatar: cfg });
        puffPop(onboarding ? 'Hey, you!' : 'Looking good', 'wink');
        if (onboarding) home(); else go('profile');
      } catch (e) { toast(e.message); saveBtn.disabled = false; }
    }
    const left = onboarding
      ? h('button', { class: 'link', onclick: home }, 'Skip')
      : backButton('Back', () => go('profile'));
    const shuffle = h('button', { class: 'icon-btn plain', 'aria-label': 'Shuffle', onclick: () => { cfg = A.random(); draw(); } },
      icon('shuffle'));
    show(h('section', { class: 'screen', 'aria-label': 'Avatar maker' },
      header(onboarding ? 'Make your avatar' : 'Your avatar', left, shuffle),
      h('div', { class: 'scroll', style: 'padding-bottom:var(--space-4)' }, preview, tabs, grid),
      h('div', { class: 'maker-foot' }, saveBtn)));
    draw();
  }

  // ---------- profile (S10) ----------
  // Your Puffcode up top (your avatar inside it), then sharing, friends, log out.
  const profileLink = () => window.PoofPuffcode.url(state.me.username, location.origin);
  const puffcodeOptions = () => ({ url: profileLink(), username: state.me.username, avatar: state.me.avatar });
  let codeCache = { key: '', markup: '' };
  function puffcodeArt() {
    const opts = puffcodeOptions();
    const key = JSON.stringify(opts);
    if (codeCache.key !== key) codeCache = { key, markup: window.PoofPuffcode.svg({ ...opts, size: 280 }) };
    const el = h('div', { class: 'puffcode' });
    el.innerHTML = codeCache.markup; // built from a checked username, avatar integers and the code's own modules
    return el;
  }

  async function shareProfile() {
    const url = profileLink();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Poof', text: `Add me on Poof: @${state.me.username}`, url });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // they closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast('Your link: ' + url);
    }
  }

  async function savePuffcode(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const a = h('a', { href: await window.PoofPuffcode.png(puffcodeOptions(), 1080), download: `puffcode-${state.me.username}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Puffcode saved');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function renderProfile() {
    const body = h('div', { class: 'scroll' });
    const back = backButton('Back', () => go('camera'));
    show(h('section', { class: 'screen', 'aria-label': 'Profile' }, header('Profile', back), body));
    const load = async () => {
      let friends;
      try { friends = await api('/api/friends'); } catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      body.replaceChildren(
        h('div', { class: 'profile-head' },
          puffcodeArt(),
          h('h2', { class: 'profile-name' }, state.me.displayName),
          h('p', { class: 'profile-user' }, '@' + state.me.username),
          h('p', { class: 'hint' }, 'Friends scan your Puffcode to add you.'),
          h('div', { class: 'profile-actions' },
            h('button', { class: 'btn', type: 'button', onclick: shareProfile }, icon('share', 20), 'Share profile'),
            h('button', { class: 'btn ghost', type: 'button', onclick: savePuffcode }, icon('download', 20), 'Save Puffcode')),
          h('button', { class: 'btn text', type: 'button', onclick: () => go('avatar') },
            state.me.avatar ? 'Edit avatar' : 'Make your avatar')),
        h('h2', { class: 'section-title' }, `Friends (${friends.friends.length})`),
        ...friends.friends.map((f) => h('div', { class: 'row' }, avatar(f),
          h('span', { class: 'main' }, h('div', { class: 'name' }, f.displayName), h('div', { class: 'sub' }, '@' + f.username + (f.streak > 1 ? ` · ${f.streak} 🔥` : ''))),
          h('button', { class: 'btn danger small', onclick: async () => {
            if (!confirm(`Remove ${f.displayName} as a friend?`)) return;
            try { await api('/api/friends/remove', { userId: f.id }); load(); } catch (e) { toast(e.message); }
          } }, 'Remove'))),
        h('div', { style: 'margin-top:32px;display:flex;justify-content:center' },
          h('button', { class: 'btn ghost', onclick: async () => {
            await api('/api/logout', {}).catch(() => {});
            state.me = null;
            state.events?.close();
            renderWelcome();
          } }, 'Log out')));
    };
    state.refresh = load;
    await load();
  }

  // ---------- live updates ----------
  function listen() {
    state.events?.close();
    const es = new EventSource('/api/events');
    state.events = es;
    es.onmessage = async (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'snap') toast('New snap 📸');
      if (ev.type === 'message') toast('New chat 💬');
      if (ev.type === 'friends') toast('Friends updated');
      if (ev.type === 'snap' || ev.type === 'message') {
        state.unread++;
        app.querySelector('.nav')?.replaceWith(nav(state.tab));
      }
      if (state.refresh) state.refresh();
    };
  }

  async function start(first = 'camera') {
    listen();
    if (first === 'camera') home(); else go(first); // draw straight away; the unread badge follows
    try {
      const inbox = await api('/api/inbox');
      state.unread = inbox.reduce((n, r) => n + r.snapIds.length + r.unread, 0);
      app.querySelector('.nav')?.replaceWith(nav(state.tab));
    } catch {}
  }

  (async () => {
    rememberDeepLink();
    try { state.me = await api('/api/me'); } catch { state.me = null; }
    if (state.me) start(); else renderWelcome();
    hideSplash();
  })();
})();
