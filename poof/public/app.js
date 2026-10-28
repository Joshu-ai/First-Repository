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

  function show(screen) {
    app.replaceChildren(screen);
    const focusable = screen.querySelector('[autofocus]');
    if (focusable) focusable.focus();
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
      if (res.status === 401 && state.me) { state.me = null; renderAuth('login'); }
      throw new Error(data.error || 'Something went wrong.');
    }
    return data;
  }

  function hue(text) {
    let n = 0;
    for (const c of text) n = (n * 31 + c.charCodeAt(0)) % 360;
    return n;
  }
  function avatar(user, extra = '', size = 44) {
    if (user.avatar) {
      const el = h('span', { class: 'avatar has-art ' + extra, 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` });
      el.innerHTML = window.PoofAvatar.avatarSVG(user.avatar, size); // built from validated integers only
      return el;
    }
    return h('span', {
      class: 'avatar ' + extra, 'aria-hidden': 'true',
      style: `background:hsl(${hue(user.username)} 55% 45%);width:${size}px;height:${size}px;font-size:${size / 2.4}px`,
    }, (user.displayName || user.username).slice(0, 1));
  }

  // Puff, the mascot (see mascot.js). Decorative unless given a label.
  function puff(mood, size, label) {
    const el = h('span', { class: 'mascot', 'aria-hidden': label ? null : 'true' });
    el.innerHTML = window.mascotSVG(mood, size, label || ''); // static markup, no user input
    if (!label) el.firstElementChild.removeAttribute('role');
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

  // ---------- auth (S01) ----------
  function renderAuth(mode) {
    stopCamera();
    const err = h('p', { class: 'error', role: 'alert' });
    const signup = mode === 'signup';
    const form = h('form', { class: 'screen auth', onsubmit: async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      err.textContent = '';
      try {
        state.me = await api(signup ? '/api/signup' : '/api/login', data);
        start(signup ? 'avatar' : 'camera');
      } catch (e2) {
        err.textContent = e2.message;
        btn.disabled = false;
      }
    } },
      h('div', { class: 'logo' }, puff('happy', 168, 'Puff, the Poof mascot')),
      h('h1', {}, 'Poof'),
      h('p', {}, signup ? 'Make an account. It takes ten seconds.' : 'Photos that vanish once they are seen.'),
      signup && h('label', { class: 'field' }, h('span', {}, 'Your name'),
        h('input', { name: 'displayName', autocomplete: 'name', maxlength: '40' })),
      h('label', { class: 'field' }, h('span', {}, 'Username'),
        h('input', { name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none', autofocus: true })),
      h('label', { class: 'field' }, h('span', {}, 'Password'),
        h('input', { name: 'password', type: 'password', required: true, minlength: signup ? '8' : null,
          autocomplete: signup ? 'new-password' : 'current-password' })),
      err,
      h('button', { class: 'btn', type: 'submit' }, signup ? 'Create account' : 'Log in'),
      h('button', { class: 'link', type: 'button', onclick: () => renderAuth(signup ? 'login' : 'signup') },
        signup ? 'I already have an account' : 'New here? Sign up'));
    show(form);
  }

  // ---------- shell ----------
  function nav(active) {
    const item = (tab, glyph, label) => h('button', {
      type: 'button', 'aria-current': active === tab ? 'page' : null, 'aria-label': label,
      onclick: () => go(tab),
    }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph), label,
    tab === 'chat' && state.unread ? h('span', { class: 'badge' }, state.unread) : null);
    return h('nav', { class: 'nav' + (active === 'camera' ? '' : ' solid') },
      item('chat', '💬', 'Chat'), item('camera', '◉', 'Camera'), item('stories', '◎', 'Stories'));
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
  const addButton = () => h('button', { class: 'icon-btn plain', 'aria-label': 'Add friends', onclick: () => go('friends') }, '+');

  // ---------- camera (S02) ----------
  function stopCamera() {
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
    const screen = h('section', { class: 'screen camera', 'aria-label': 'Camera' },
      video, msg,
      h('header', { class: 'bar overlay' }, meButton(), h('h1', {}), addButton()),
      h('div', { class: 'shutter-row' },
        h('button', { class: 'icon-btn', 'aria-label': 'Choose a photo', onclick: () => file.click() }, '🖼'),
        h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: () => capture(video) }),
        h('button', { class: 'icon-btn', 'aria-label': 'Flip camera', onclick: () => {
          state.facing = state.facing === 'user' ? 'environment' : 'user';
          stopCamera();
          renderCamera();
        } }, '⟲')),
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
    }
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
    } }, '✎');
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
    } }, '↶');
    const timerBtn = h('button', { class: 'icon-btn', 'aria-label': 'Timer', onclick: () => {
      ed.timer = TIMERS[(TIMERS.indexOf(ed.timer) + 1) % TIMERS.length];
      timerBtn.replaceChildren(timerText());
    } }, timerText());
    function timerText() { return h('span', { class: 'timer-label' }, ed.timer ? ed.timer + 's' : '∞'); }
    const textBtn = h('button', { class: 'icon-btn', 'aria-label': 'Add caption', onclick: () => {
      caption.hidden = false; layout(); caption.focus();
    } }, 'T');

    const screen = h('section', { class: 'screen editor', 'aria-label': 'Edit snap' },
      stage,
      h('div', { class: 'tools' }, textBtn, penBtn, colors, undoBtn, timerBtn),
      h('header', { class: 'bar overlay', style: 'right:auto' },
        h('button', { class: 'icon-btn', 'aria-label': 'Discard', onclick: () => go('camera') }, '✕')),
      h('div', { class: 'editor-foot' },
        h('button', { class: 'icon-btn', 'aria-label': 'Save to device', onclick: saveToDevice }, '⤓'),
        h('button', { class: 'btn', onclick: () => renderSendTo() }, 'Send to ➤')));
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
    const sendBtn = h('button', { class: 'btn small', disabled: true, onclick: send }, 'Send ➤');
    const list = h('div', { class: 'scroll', style: 'padding-bottom:96px' }, h('p', { class: 'hint' }, 'Loading friends…'));
    const back = h('button', { class: 'icon-btn plain', 'aria-label': 'Back to editing', onclick: () => {
      show(editorScreen); window.onresize?.();
    } }, '‹');
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
        sendBtn.textContent = 'Send ➤';
      }
    }
    let data;
    try { data = await api('/api/friends'); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    const toggle = (row, on) => row.setAttribute('aria-checked', String(on));
    const storyRow = h('button', { class: 'row', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
      story = !story; toggle(storyRow, story); update(data.friends);
    } }, h('span', { class: 'avatar ring', style: 'background:var(--surface-2)' }, '◎'),
    h('span', { class: 'main' }, h('div', { class: 'name' }, 'My Story'), h('div', { class: 'sub' }, 'Friends can watch for 24 hours')),
    h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'));
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
      h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'));
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
            onclick: () => renderChat(r.friend) }, '💬'));
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
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕'))));
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
    const back = h('button', { class: 'icon-btn plain', 'aria-label': 'Back', onclick: () => go('chat') }, '‹');
    const cam = h('button', { class: 'icon-btn plain', 'aria-label': 'Snap ' + friend.displayName, onclick: () => go('camera') }, '◉');
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
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕'))));
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
    const back = h('button', { class: 'icon-btn plain', 'aria-label': 'Back', onclick: () => go('chat') }, '‹');
    show(h('section', { class: 'screen', 'aria-label': 'Add friends' }, header('Add friends', back),
      h('div', { class: 'scroll' }, h('div', { class: 'field' }, search), results, requests)));

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
              : h('button', { class: 'btn small', onclick: () => act('/api/friends/request', { username: u.username }, 'Request sent') }, '+ Add')))
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
        go(onboarding ? 'camera' : 'profile');
      } catch (e) { toast(e.message); saveBtn.disabled = false; }
    }
    const left = onboarding
      ? h('button', { class: 'link', onclick: () => go('camera') }, 'Skip')
      : h('button', { class: 'icon-btn plain', 'aria-label': 'Back', onclick: () => go('profile') }, '‹');
    const shuffle = h('button', { class: 'icon-btn plain', 'aria-label': 'Shuffle', onclick: () => { cfg = A.random(); draw(); } }, '🎲');
    show(h('section', { class: 'screen', 'aria-label': 'Avatar maker' },
      header(onboarding ? 'Make your avatar' : 'Your avatar', left, shuffle),
      h('div', { class: 'scroll', style: 'padding-bottom:var(--space-4)' }, preview, tabs, grid),
      h('div', { class: 'maker-foot' }, saveBtn)));
    draw();
  }

  // ---------- profile (S10) ----------
  async function renderProfile() {
    const body = h('div', { class: 'scroll' });
    const back = h('button', { class: 'icon-btn plain', 'aria-label': 'Back', onclick: () => go('camera') }, '‹');
    show(h('section', { class: 'screen', 'aria-label': 'Profile' }, header('Profile', back), body));
    const load = async () => {
      let friends;
      try { friends = await api('/api/friends'); } catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      body.replaceChildren(
        h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:8px;margin:16px 0' },
          avatar(state.me, '', 120),
          h('button', { class: 'btn ghost small', onclick: () => go('avatar') }, state.me.avatar ? 'Edit avatar' : 'Make your avatar'),
          h('div', { class: 'name', style: 'font-size:1.3rem;font-weight:800' }, state.me.displayName),
          h('div', { class: 'sub', style: 'color:var(--text-dim)' }, '@' + state.me.username)),
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
            renderAuth('login');
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
    try {
      const inbox = await api('/api/inbox');
      state.unread = inbox.reduce((n, r) => n + r.snapIds.length + r.unread, 0);
    } catch {}
    go(first);
  }

  (async () => {
    try { state.me = await api('/api/me'); start(); } catch { renderAuth('login'); }
  })();
})();
