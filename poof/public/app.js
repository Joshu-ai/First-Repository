'use strict';
(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const TIMERS = [1, 3, 5, 10, 0]; // 0 = no limit
  const COLORS = ['#ffffff', '#ff5d8f', '#ffd23f', '#3ddc97', '#3db4ff', '#6d4cff', '#111111'];
  const FLASH_KEY = 'poof.flash'; // the camera's Flash switch, remembered on this device
  const TYPING_SEND_MS = 2000; // while you type, your friend is told at most this often
  const TYPING_SHOW_MS = 4000; // and a friend shows as typing until this long passes with no more from them
  const BANNER_MS = 4000; // a notification banner goes by itself after this long
  const PREVIEW_MAX = 60; // characters of a message shown in its banner (the server sends no more)
  const NOTIFY_KEY = 'poof.notify'; // Notifications on the Profile screen, remembered on this device
  const APP_TITLE = 'Poof'; // the tab's title; with unread poofs and chats, "(2) Poof"

  const state = {
    me: null,
    tab: 'camera',
    facing: 'user',
    flash: (() => { try { return localStorage.getItem(FLASH_KEY) === 'on'; } catch { return false; } })(),
    friendsBack: null, // the tab Add friends goes back to: wherever it was opened from
    profileBack: null, // and the tab Profile goes back to
    stream: null,
    photo: null, // canvas with the captured image
    editor: null, // { draw canvas, caption, captionY, timer } for a photo, { kind: 'video', muted } for a video
    recording: null, // a hold of the shutter that is recording (or about to)
    clip: null, // the recorded video being edited: { blob, type, sound, silent, seconds, mirror, url }
    unread: 0,
    events: null,
    refresh: null, // re-render hook for the current screen on live events
    pendingAdd: null, // a username from a Puffcode or /add/<username> link, opened once logged in
    scan: null, // { timer, busy } while the camera is looking for Puffcodes
    sheet: null, // the bottom sheet that is open: { layer, sheet, scrim, screen, back }
    onEscape: null, // what Escape does on this screen (the viewers close)
    typing: new Map(), // friends typing to you now: their id -> the timer that ends it
    onTyping: null, // how this screen shows a friend starting or stopping typing: (friendId) => {}
    chatWith: null, // the chat on screen, a friend's id or 'g:' + a group's: its messages need no banner
    onLeave: null, // run when the screen is replaced (the viewers stop their clocks and videos)
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
    const leave = state.onLeave;
    state.onLeave = null;
    leave?.();
    closeSheet({ restore: false, animate: false });
    state.onEscape = null;
    state.onTyping = null;
    state.chatWith = null;
    const old = app.firstElementChild;
    app.replaceChildren(screen);
    // a tab's screen is kept (once out of the page, focus and all) to show beside its neighbour during a swipe
    if (old && old !== screen && old.dataset.tab) keepPeek(old);
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

  // A 401 means this browser is logged out (here, or in another tab): back
  // to the welcome screen, which also ends everything of the last session.
  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error("Couldn't reach Poof. Check your connection."), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.me) renderWelcome();
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

  // A group's picture: two of its people's avatars, one tucked behind the
  // other (the others in it first; with just one other, them and you).
  // Decorative, like a single avatar: the group's name is beside it.
  function groupAvatar(members, size = 44) {
    const others = members.filter((u) => u.id !== state.me.id);
    const shown = others.length === 1 ? [others[0], state.me] : (others.length ? others : members).slice(0, 2);
    if (shown.length < 2) return avatar(shown[0] || state.me, '', size);
    const small = Math.round(size * 0.68);
    return h('span', { class: 'avatar-stack', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` },
      avatar(shown[1], 'stack-back', small), avatar(shown[0], 'stack-front', small));
  }
  const peopleCount = (n) => (n === 1 ? 'Just you' : `${n} people`);

  // A streak: the count of days in a row and Poof's own streak mark, read
  // out as "3-day streak". Shown from 2 days.
  const streakWords = (n) => `${n}-day streak`;
  const streakBadge = (n) => (n > 1
    ? h('span', { class: 'streak', role: 'img', 'aria-label': streakWords(n) }, String(n), icon('streak', 16)) : null);

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

  // ---------- gestures ----------
  // pointerDrag follows one pointer from down to up. Once it has moved SLOP
  // px it is a drag along one axis, and `lock` says whether this gesture
  // takes it; when it doesn't, the browser keeps it (so lists still scroll).
  // `end` always runs, with the speed at the end for flicks.
  const SLOP = 10;
  const FLICK = 0.45; // px per ms: a flick this fast goes over whatever its length
  const SLIDE_MS = 220; // --slide in styles.css; the fallback for transitionend
  const LONG_PRESS_MS = 500;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pointerDrag(el, hooks) {
    let g = null;
    const listen = (on) => {
      const fn = on ? 'addEventListener' : 'removeEventListener';
      window[fn]('pointermove', onMove, true);
      window[fn]('pointerup', onUp, true);
      window[fn]('pointercancel', onCancel, true);
    };
    function onMove(e) {
      if (!g || e.pointerId !== g.id) return;
      g.dx = e.clientX - g.x0;
      g.dy = e.clientY - g.y0;
      g.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (g.samples.length > 12) g.samples.shift();
      if (!g.axis) {
        if (Math.hypot(g.dx, g.dy) < SLOP) return;
        g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
        g.moved = true;
        if (!hooks.lock(g)) return;
        g.dragging = true;
        try { el.setPointerCapture(g.id); } catch {}
        document.documentElement.classList.add('dragging');
        window.getSelection?.()?.removeAllRanges();
      }
      if (g.dragging) hooks.move(g);
    }
    function finish(e, cancelled) {
      if (!g || (e && e.pointerId !== g.id)) return;
      const done = g;
      g = null;
      listen(false);
      document.documentElement.classList.remove('dragging');
      // speed over the last 100ms; a pointer that stopped before letting go has none
      const t = e ? e.timeStamp : performance.now();
      const recent = done.samples.filter((p) => t - p.t <= 100);
      if (e) recent.push({ x: e.clientX, y: e.clientY, t });
      const [a, b] = [recent[0], recent[recent.length - 1]];
      const dt = recent.length > 1 ? Math.max(1, b.t - a.t) : 0;
      hooks.end(done, { cancelled, vx: dt ? (b.x - a.x) / dt : 0, vy: dt ? (b.y - a.y) / dt : 0 });
    }
    const onUp = (e) => finish(e, false);
    const onCancel = (e) => finish(e, true);
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (g) finish(null, true); // one whose end never reached us
      if (hooks.accept && !hooks.accept(e)) return;
      g = { id: e.pointerId, type: e.pointerType, target: e.target, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0,
        axis: null, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
      listen(true);
      hooks.down?.(g, e);
    });
  }

  // After a drag, a hold or a long press, the click the browser sends on
  // letting go is not a tap. The next press or key clears this.
  let swallowUntil = 0;
  const swallowClick = () => { swallowUntil = performance.now() + 600; };
  window.addEventListener('pointerdown', () => { swallowUntil = 0; }, true);
  window.addEventListener('keydown', () => { swallowUntil = 0; }, true);
  window.addEventListener('click', (e) => {
    if (performance.now() > swallowUntil) return;
    swallowUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Move elements to where `apply` puts them over --slide, then `done`;
  // straight there with less motion. Returns a function that finishes now.
  function glide(els, apply, done) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      els[0].removeEventListener('transitionend', onEnd);
      els.forEach((el) => el.classList.remove('sliding'));
      done?.();
    };
    const onEnd = (e) => { if (e.target === els[0]) finish(); };
    if (reduceMotion()) { apply(); finish(); return finish; }
    els.forEach((el) => el.classList.add('sliding'));
    void els[0].offsetWidth; // start from where they are now
    apply();
    els[0].addEventListener('transitionend', onEnd);
    setTimeout(finish, SLIDE_MS + 120);
    return finish;
  }

  // ---------- swiping between the tabs ----------
  // Chat | Camera | Stories, the order of the tabs. Drag sideways and the
  // screen follows the finger with its neighbour beside it; let go past a
  // quarter of the width, or flick, and it moves over, else it springs back.
  // The neighbour is the screen last drawn for that tab (or a plain outline
  // of it), never live: the real one is drawn as it slides in.
  const TAB_ORDER = ['chat', 'camera', 'stories'];
  const TAB_TITLES = { chat: 'Chat', camera: 'Camera', stories: 'Stories' };
  let peeks = {}; // tab -> the screen last drawn for it
  let sliding = null; // finishes the slide between two tabs that is still running

  function keepPeek(el) {
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    el.classList.add('peek');
    // the camera's picture stays as a still (see freezeFrame); nothing live
    el.querySelectorAll('video').forEach((v) => { v.srcObject = null; v.remove(); });
    peeks[el.dataset.tab] = el;
  }

  function peekFor(tab) {
    let el = peeks[tab];
    if (!el) {
      el = tab === 'camera'
        ? h('section', { class: 'screen camera' }, h('div', { class: 'shutter-row' }, h('span', { class: 'shutter' })), nav('camera'))
        : h('section', { class: 'screen' }, header(TAB_TITLES[tab], meButton(), addButton()), h('div', { class: 'scroll' }), nav(tab));
      el.inert = true;
      el.setAttribute('aria-hidden', 'true');
      el.classList.add('peek');
    }
    el.classList.remove('sliding', 'leaving');
    el.style.transform = el.style.opacity = el.style.borderRadius = '';
    const tabs = navOf(el);
    if (tabs) tabs.style.transform = tabs.style.visibility = '';
    return el;
  }

  // The tab bar stays put while screens slide under it: the moving screen's
  // own bar is moved back by as much, and the neighbour's is not drawn.
  const navOf = (el) => el?.querySelector(':scope > .nav') || null;
  function holdNav(el, x) {
    const tabs = navOf(el);
    if (tabs) tabs.style.transform = x ? `translateX(${-x}px)` : '';
  }
  function hideNav(el) {
    const tabs = navOf(el);
    if (tabs) tabs.style.visibility = 'hidden';
  }

  // the camera's last frame, kept from the peek to sit under the live picture until it starts
  function takeStill() {
    const still = peeks.camera?.querySelector('.still');
    still?.remove();
    return still || null;
  }

  function slideTo(tab, from, x) {
    const w = app.clientWidth;
    const dir = x < 0 ? -1 : 1; // the way the screens travel
    go(tab);
    const fresh = app.firstElementChild;
    if (reduceMotion() || !fresh || fresh === from) return;
    // the old screen slides off as the new one comes in from where its peek was
    from.classList.add('leaving');
    from.style.transform = `translateX(${x}px)`;
    hideNav(from);
    app.append(from);
    fresh.style.transform = `translateX(${x - dir * w}px)`;
    holdNav(fresh, x - dir * w);
    sliding = glide([fresh, navOf(fresh), from].filter(Boolean), () => {
      fresh.style.transform = '';
      holdNav(fresh, 0);
      from.style.transform = `translateX(${dir * w}px)`;
    }, () => {
      if (from.classList.contains('leaving')) { from.classList.remove('leaving'); from.remove(); }
      sliding = null;
    });
  }

  function tabGestures(screen, tab) {
    screen.dataset.tab = tab;
    screen.classList.add('tab-screen');
    const at = TAB_ORDER.indexOf(tab);
    let press = null;
    const cancelPress = () => { clearTimeout(press); press = null; };

    function tabMove(g) {
      const w = app.clientWidth;
      const side = g.dx < 0 ? TAB_ORDER[at + 1] : TAB_ORDER[at - 1];
      if (side !== g.side) { // a change of direction brings the other neighbour
        g.peek?.remove();
        g.side = side;
        g.peek = side ? peekFor(side) : null;
        if (g.peek) { hideNav(g.peek); app.append(g.peek); }
      }
      // with nothing that way it gives a little, then stops
      g.x = side ? g.dx : Math.sign(g.dx) * Math.min(Math.abs(g.dx) * 0.3, 56);
      screen.style.transform = `translateX(${g.x}px)`;
      holdNav(screen, g.x);
      if (g.peek) g.peek.style.transform = `translateX(${g.x + (g.dx < 0 ? w : -w)}px)`;
    }
    function tabEnd(g, { cancelled, vx }) {
      const w = app.clientWidth;
      const flick = Math.abs(vx) > FLICK;
      const back = flick && Math.sign(vx) !== Math.sign(g.dx); // flicked the other way
      if (!cancelled && g.side && !back && (Math.abs(g.dx) > w * 0.25 || flick)) return slideTo(g.side, screen, g.x);
      const peek = g.peek;
      glide([screen, navOf(screen), peek].filter(Boolean), () => {
        screen.style.transform = '';
        holdNav(screen, 0);
        if (peek) peek.style.transform = `translateX(${g.dx < 0 ? w : -w}px)`;
      }, () => peek?.remove());
      return undefined;
    }
    // a chat row dragged right slides over to show Chat behind it; far enough opens the chat
    function rowMove(g) {
      const w = g.row.clientWidth;
      const x = Math.max(0, g.dx);
      g.row.querySelector('.row-slide').style.transform = `translateX(${x <= w / 2 ? x : w / 2 + (x - w / 2) * 0.3}px)`;
      g.row.classList.toggle('armed', x > w * 0.3);
    }
    function rowEnd(g, { cancelled, vx }) {
      const row = g.row;
      if (!cancelled && (g.dx > row.clientWidth * 0.3 || (vx > FLICK && g.dx > 24))) return row.openChat();
      const slide = row.querySelector('.row-slide');
      glide([slide], () => { slide.style.transform = ''; }, () => row.classList.remove('swiping', 'armed'));
      return undefined;
    }

    pointerDrag(screen, {
      accept: (e) => !screen.inert && !screen.classList.contains('recording') && !e.target.closest('input, textarea, .shutter'),
      // press and hold a chat row for the friend card
      down: (g) => {
        const row = g.target.closest('.chat-row');
        if (!row?.openCard) return;
        press = setTimeout(() => {
          press = null;
          g.pressed = true;
          swallowClick();
          if (g.type === 'touch') { try { navigator.vibrate?.(10); } catch {} }
          row.openCard();
        }, LONG_PRESS_MS);
      },
      lock: (g) => {
        cancelPress();
        if (g.pressed || g.axis !== 'x') return false;
        g.row = tab === 'chat' && g.dx > 0 ? g.target.closest('.chat-row') : null;
        if (g.row) g.row.classList.add('swiping');
        else { sliding?.(); screen.classList.remove('sliding'); }
        return true;
      },
      move: (g) => (g.row ? rowMove(g) : tabMove(g)),
      end: (g, fling) => {
        cancelPress();
        if (g.pressed) return swallowClick();
        if (!g.dragging) return undefined;
        swallowClick();
        return g.row ? rowEnd(g, fling) : tabEnd(g, fling);
      },
    });
  }

  // ---------- viewer gestures ----------
  // Snap and story viewers: a tap goes on (their tap buttons do that), and a
  // drag down follows the finger, the list it came from showing behind;
  // let go far enough down, or flick, and it closes. Stories also pause
  // while pressed: the timer and progress bar stop until you let go.
  const STORY_HOLD_MS = 250; // pressed longer than this is a hold, not a tap
  function viewerGestures(screen, { from, close, pause, resume, holdToPause = false }) {
    const status = h('p', { class: 'sr-only', role: 'status' });
    screen.append(status);
    let holdTimer = null;
    let behind = null;
    const dismiss = () => {
      if (reduceMotion()) return close();
      glide([screen], () => {
        screen.style.transform = `translateY(${screen.clientHeight}px) scale(.6)`;
        screen.style.opacity = '0';
      }, close);
      return undefined;
    };
    pointerDrag(screen, {
      accept: (e) => !e.target.closest('.head button'),
      down: (g) => {
        if (!holdToPause) return;
        g.paused = true;
        pause();
        holdTimer = setTimeout(() => { g.held = true; screen.classList.add('held'); status.textContent = 'Paused'; }, STORY_HOLD_MS);
      },
      lock: (g) => {
        clearTimeout(holdTimer);
        if (g.axis !== 'y' || g.dy < 0) return false;
        if (!g.paused) { g.paused = true; pause(); }
        behind = peekFor(from);
        screen.before(behind);
        return true;
      },
      move: (g) => {
        const dy = Math.max(0, g.dy);
        const p = Math.min(1, dy / screen.clientHeight);
        screen.style.transform = `translateY(${dy}px) scale(${1 - p * 0.25})`;
        screen.style.borderRadius = Math.round(Math.min(1, p * 4) * 24) + 'px';
      },
      end: (g, { cancelled, vy }) => {
        clearTimeout(holdTimer);
        screen.classList.remove('held');
        status.textContent = '';
        if (g.dragging) {
          swallowClick();
          if (!cancelled && (g.dy > screen.clientHeight * 0.2 || (vy > FLICK && g.dy > 24))) return dismiss();
          const peek = behind;
          behind = null;
          glide([screen], () => { screen.style.transform = ''; screen.style.borderRadius = ''; }, () => peek?.remove());
        } else if (g.held || g.moved) swallowClick(); // a hold, or a slide sideways, is not a tap
        if (g.paused) resume();
        return undefined;
      },
    });
    if (!holdToPause) return;
    // from the keyboard, as on the shutter: hold Space on Previous or Next
    // to pause; a short press is still a tap (Space clicks on letting go)
    let key = null;
    screen.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || e.repeat || key || !e.target.closest('.tap')) return;
      pause();
      key = { held: false };
      key.timer = setTimeout(() => { key.held = true; screen.classList.add('held'); status.textContent = 'Paused'; }, STORY_HOLD_MS);
    });
    screen.addEventListener('keyup', (e) => {
      if (e.key !== ' ' || !key) return;
      clearTimeout(key.timer);
      if (key.held) {
        swallowClick();
        screen.classList.remove('held');
        status.textContent = '';
      }
      key = null;
      resume();
    });
  }

  // ---------- pull to refresh ----------
  // At the top of the Chat or Stories list, drag down: the list follows with
  // growing resistance and Puff rises from behind its top edge, stretching a
  // little. Past PULL_AT his eyes go wide; let go there and the list waits
  // while state.refresh() runs (Puff bobs, his trail puffs pulse), then he
  // drifts off up and to the right as the list settles back. Let go sooner
  // and it springs back. Less motion: no rise, stretch, bob or drift; Puff
  // just fades in and out. Only a drag that starts with the list at the top
  // and goes down is a pull; everything else stays the browser's.
  const PULL_AT = 72; // px the list comes down to refresh, and where it waits meanwhile
  const PULL_MAX = 160; // the furthest it ever comes, however far the pointer goes
  const PULL_MIN_MS = 400; // Puff stays at least this long, so the refresh reads
  const PULL_PUFF = 60; // Puff's width
  const PULL_DONE_MS = 700; // the fallback for his drift (or fade) reporting back
  const pulled = (dy) => PULL_MAX * (1 - Math.exp((-0.8 * Math.max(0, dy)) / PULL_MAX)); // rubber band

  function pullToRefresh(screen, list) {
    const status = h('p', { class: 'sr-only', role: 'status' });
    const holder = h('span', { class: 'pull-puff' });
    const pull = h('div', { class: 'pull', 'data-state': 'idle' }, holder, status);
    list.before(pull);
    list.classList.add('pullable');
    let busy = false; // a pull is under way, from the press to Puff gone

    const setMood = (mood) => {
      if (pull.dataset.mood === mood) return;
      pull.dataset.mood = mood;
      holder.replaceChildren(puff(mood, PULL_PUFF));
    };
    // Puff for the list `d` px down. He rises from behind the list's edge to
    // the middle of the gap by PULL_AT, growing and stretching; past it he
    // keeps to the middle and stretches a little more.
    function place(d, { stretch = true, reduce = reduceMotion() } = {}) {
      const p = Math.min(1, d / PULL_AT);
      holder.style.opacity = String(Math.min(1, p * 1.2));
      if (reduce) {
        holder.style.transform = `translate(-50%, -50%) translateY(${PULL_AT / 2}px)`;
        return;
      }
      const over = Math.max(0, d - PULL_AT) / (PULL_MAX - PULL_AT);
      const y = p < 1 ? d - (PULL_AT / 2) * p * p : d / 2;
      const s = 0.5 + 0.5 * p;
      const sx = stretch ? s * (1 - 0.04 * p - 0.06 * over) : s;
      const sy = stretch ? s * (1 + 0.06 * p + 0.12 * over) : s;
      holder.style.transform = `translate(-50%, -50%) translateY(${y.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    }
    function settle() {
      pull.dataset.state = 'idle';
      holder.style.transform = holder.style.opacity = '';
      busy = false;
    }
    function springBack() {
      glide([list, holder], () => { list.style.transform = ''; place(0); }, settle);
    }
    async function refresh(load) {
      pull.dataset.state = 'refreshing';
      setMood('happy');
      status.textContent = 'Refreshing…';
      glide([list, holder], () => { list.style.transform = `translateY(${PULL_AT}px)`; place(PULL_AT, { stretch: false }); });
      let ok;
      try { [ok] = await Promise.all([load(), wait(PULL_MIN_MS)]); } catch { ok = false; }
      status.textContent = ok === false ? 'Couldn’t refresh' : 'All up to date';
      // off he goes over the list as it settles back (with less motion: he fades, then it moves)
      const reduce = reduceMotion();
      setMood('wink');
      pull.dataset.state = 'done';
      const back = () => glide([list], () => { list.style.transform = ''; });
      if (!reduce) back();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (reduce) back();
        settle();
      };
      const svg = holder.querySelector('svg');
      svg?.addEventListener('animationend', (e) => { if (e.target === svg) finish(); });
      setTimeout(finish, PULL_DONE_MS);
    }

    pointerDrag(list, {
      accept: () => !busy && !screen.inert && list.scrollTop <= 0,
      lock: (g) => {
        if (g.axis !== 'y' || g.dy <= 0 || list.scrollTop > 0) return false;
        busy = true;
        g.from = g.dy; // the list starts moving from here, not with a jump
        g.d = 0;
        g.reduce = reduceMotion();
        status.textContent = '';
        setMood('happy');
        pull.dataset.state = 'pulling';
        return true;
      },
      move: (g) => {
        g.d = pulled(g.dy - g.from);
        list.style.transform = `translateY(${g.d.toFixed(1)}px)`;
        place(g.d, { reduce: g.reduce });
        setMood(g.d >= PULL_AT ? 'wow' : 'happy');
      },
      end: (g, { cancelled }) => {
        if (!g.dragging) return;
        swallowClick();
        const load = state.refresh;
        if (!cancelled && g.d >= PULL_AT && load && app.firstElementChild === screen) refresh(load);
        else springBack();
      },
    });

    // On a touch screen the browser would take a drag down as its own (the
    // list can't scroll up, but it would still try), and the pull would never
    // start: at the top, a drag down is kept back for it. A drag up scrolls.
    let touchY = null;
    list.addEventListener('touchstart', (e) => {
      touchY = list.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    }, { passive: true });
    list.addEventListener('touchmove', (e) => {
      if (touchY == null || !e.cancelable) return;
      if (pull.dataset.state === 'pulling' || e.touches[0].clientY > touchY) e.preventDefault();
    }, { passive: false });
  }

  // A countdown that can pause: onTick(0..1) each frame, then onDone.
  function countdown(ms, onTick, onDone) {
    let spent = 0;
    let from = null;
    let timer = null;
    let raf = null;
    let over = false;
    const frame = () => { onTick(Math.min(1, (spent + performance.now() - from) / ms)); raf = requestAnimationFrame(frame); };
    const halt = () => { clearTimeout(timer); cancelAnimationFrame(raf); };
    const c = {
      resume() {
        if (over || from != null) return;
        from = performance.now();
        timer = setTimeout(() => { c.stop(); onTick(1); onDone(); }, ms - spent);
        frame();
      },
      pause() {
        if (from == null) return;
        spent += performance.now() - from;
        from = null;
        halt();
        onTick(Math.min(1, spent / ms));
      },
      stop() { over = true; from = null; halt(); },
    };
    c.resume();
    return c;
  }

  // ---------- bottom sheets ----------
  // A card that rises from the bottom; the screen behind goes inert. It
  // closes with Close, Escape, a tap above it or a drag down on its top,
  // and focus goes back to what opened it (`back` finds that).
  function openSheet({ labelledby, head, body, back }) {
    closeSheet({ restore: false, animate: false });
    const screen = app.firstElementChild;
    const top = h('div', { class: 'sheet-head' }, h('span', { class: 'grab', 'aria-hidden': 'true' }), head,
      h('button', { class: 'icon-btn plain sheet-close', type: 'button', 'aria-label': 'Close', onclick: () => closeSheet() }, icon('close')));
    const sheet = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledby, tabindex: '-1' },
      top, h('div', { class: 'sheet-body' }, body));
    const scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
    const layer = h('div', { class: 'sheet-layer' }, scrim, sheet);
    if (screen) screen.inert = true;
    app.append(layer);
    state.sheet = { layer, sheet, scrim, screen, back };
    pointerDrag(top, {
      lock: (g) => g.axis === 'y' && g.dy > 0,
      move: (g) => { sheet.style.transform = `translateY(${Math.max(0, g.dy)}px)`; },
      end: (g, { cancelled, vy }) => {
        if (!g.dragging) return;
        swallowClick();
        if (!cancelled && (g.dy > sheet.offsetHeight * 0.3 || (vy > FLICK && g.dy > 24))) closeSheet();
        else glide([sheet], () => { sheet.style.transform = ''; });
      },
    });
    sheet.focus();
    return sheet;
  }

  function closeSheet({ restore = true, animate = true } = {}) {
    const s = state.sheet;
    if (!s) return;
    state.sheet = null;
    if (s.screen) s.screen.inert = false;
    if (restore) s.back?.()?.focus();
    if (!animate || reduceMotion() || !s.layer.isConnected) { s.layer.remove(); return; }
    s.layer.inert = true;
    glide([s.sheet, s.scrim], () => {
      s.sheet.style.transform = 'translateY(100%)';
      s.scrim.style.opacity = '0';
    }, () => s.layer.remove());
  }

  // Escape closes the sheet that is open, else the viewer on screen
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const close = state.sheet ? () => closeSheet() : state.onEscape;
    if (!close) return;
    e.preventDefault();
    close();
  });

  // ---------- welcome, log in, sign up (S01) ----------
  function renderWelcome() {
    stopCamera();
    state.me = null;
    // nothing of the last session carries on: its live stream, who was typing, its news
    state.events?.close();
    state.events = null;
    for (const timer of state.typing.values()) clearTimeout(timer);
    state.typing.clear();
    state.refresh = null;
    state.friendsBack = null;
    state.profileBack = null;
    clearTimeout(toastTimer); // news from the last session is not for whoever logs in next
    toastEl.hidden = true;
    dismissBanner({ animate: false, restore: false });
    closeNotes([...notes.keys()]);
    setUnread(0);
    show(h('section', { class: 'screen welcome', 'aria-label': 'Welcome' },
      h('div', { class: 'hero' },
        puff('happy', 220, 'Puff, the Poof mascot'),
        h('h1', {}, 'Poof'),
        h('p', { class: 'tagline' }, 'Photos that vanish once they are seen.'),
        state.pendingAdd && h('p', { class: 'invite' }, `Log in or sign up to add @${state.pendingAdd}.`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn block on-brand-quiet', type: 'button', onclick: renderLogin }, 'Log in'),
        h('button', { class: 'btn block on-brand', type: 'button', onclick: () => renderSignup(1, {}) }, 'Sign up'))));
    peeks = {}; // nor are their screens, kept for swipes (show() just kept the last one)
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
    }, icon(tab, 26), h('span', { class: 'tab-label' }, label),
    tab === 'chat' && state.unread ? h('span', { class: 'badge' }, state.unread) : null);
    return h('nav', { class: 'nav' + (active === 'camera' ? '' : ' solid') },
      item('chat', 'Chat'), item('camera', 'Camera'), item('stories', 'Stories'));
  }

  // ---------- unread count ----------
  // New poofs plus unread chats: on the Chat tab's badge and in the tab's
  // title, "(2) Poof", so it shows from another tab too. Badges are updated
  // where they are (the tab bar is never swapped mid-swipe), peeks included.
  const countUnread = (rows) => rows.reduce((n, r) => n + r.snapIds.length + r.unread, 0);
  function setUnread(n) {
    state.unread = Math.max(0, n | 0);
    document.title = state.unread ? `(${state.unread}) ${APP_TITLE}` : APP_TITLE;
    const tabs = [app, ...Object.values(peeks)].flatMap((el) => [...el.querySelectorAll('.nav button[aria-label="Chat"]')]);
    for (const tab of tabs) {
      let badge = tab.querySelector('.badge');
      if (!state.unread) { badge?.remove(); continue; }
      if (!badge) tab.append(badge = h('span', { class: 'badge' }));
      badge.textContent = state.unread;
    }
  }
  // the count from the server, after something was read or opened
  async function syncUnread() {
    try { setUnread(countUnread(await api('/api/inbox'))); } catch {}
  }

  function go(tab) {
    // Add friends opened from a main tab goes back there; from its own
    // sub-screens (scanner, someone's card) it keeps the tab it had
    if (tab === 'friends' && ['camera', 'chat', 'stories'].includes(state.tab)) state.friendsBack = state.tab;
    if (tab === 'profile' && ['camera', 'chat', 'stories'].includes(state.tab)) state.profileBack = state.tab; // so does Profile
    state.tab = tab;
    state.refresh = null;
    if (tab !== 'camera') stopCamera();
    // the screen's drawing, for whoever wants to wait for it
    if (tab === 'camera') return renderCamera(undefined, takeStill());
    if (tab === 'chat') return renderInbox();
    if (tab === 'stories') return renderStories();
    if (tab === 'friends') return renderFriends();
    if (tab === 'profile') return renderProfile();
    if (tab === 'avatar') return renderAvatarMaker();
    return undefined;
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
    abortRecording();
    freezeFrame();
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }

  // As the camera stops, its picture is left as a still in its place, so a
  // swipe away slides the picture off (not a black screen), and a swipe back
  // shows it until the camera is live again.
  function freezeFrame() {
    if (!state.stream) return;
    const v = [...app.querySelectorAll('.camera video')].find((x) => x.srcObject === state.stream);
    if (!v || !v.videoWidth || v.readyState < 2) return;
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const still = h('canvas', { class: 'still' + (v.classList.contains('mirror') ? ' mirror' : ''), 'aria-hidden': 'true' });
    still.width = Math.round(v.videoWidth * scale);
    still.height = Math.round(v.videoHeight * scale);
    try { still.getContext('2d').drawImage(v, 0, 0, still.width, still.height); } catch { return; }
    v.replaceWith(still);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const camTrack = () => state.stream?.getVideoTracks()[0] || null;
  function trackCaps(track) {
    try { return track?.getCapabilities?.() || {}; } catch { return {}; }
  }
  // The front camera, by what the camera says about itself where it does
  // (laptop webcams often say nothing), else by which one was asked for.
  function onFrontCamera(track) {
    let said;
    try { said = track?.getSettings?.().facingMode; } catch {}
    return said ? said === 'user' : state.facing === 'user';
  }
  // How the flash fires on the camera in use: the back camera's light where
  // the browser can switch it on, a white screen on the front camera, else none.
  function flashKind(track) {
    if (onFrontCamera(track)) return 'screen';
    return trackCaps(track).torch ? 'torch' : null;
  }

  // Tap the viewfinder: a focus ring where you tapped, and the camera focuses
  // there where it can. Double-tap: switch cameras.
  function viewfinderGestures(viewfinder, video, flip) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let down = null;
    let lastTap = null;
    viewfinder.addEventListener('pointerdown', (e) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    });
    viewfinder.addEventListener('pointerup', (e) => {
      if (!down || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12;
      down = null;
      if (moved) return; // a drag, not a tap
      if (lastTap && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 48) {
        lastTap = null;
        flip();
        return;
      }
      lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (video.videoWidth) focusAt(e.clientX, e.clientY);
    });
    viewfinder.addEventListener('pointercancel', () => { down = null; });

    function focusAt(x, y) {
      const box = viewfinder.getBoundingClientRect();
      viewfinder.querySelector('.focus-ring')?.remove();
      const ring = h('span', { class: 'focus-ring', 'aria-hidden': 'true',
        style: `left:${x - box.left}px;top:${y - box.top}px` });
      viewfinder.append(ring);
      ring.addEventListener('animationend', () => ring.remove());
      setTimeout(() => ring.remove(), reduce.matches ? 700 : 900);
      // where the browser lets us, focus on that spot of the picture: map the
      // tap through the cover crop (and the mirror) to 0..1 of the frame
      const track = camTrack();
      if (!track || !trackCaps(track).focusMode) return;
      if (!navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest) return;
      const vb = video.getBoundingClientRect();
      const scale = Math.max(vb.width / video.videoWidth, vb.height / video.videoHeight);
      const fx = (x - vb.left - (vb.width - video.videoWidth * scale) / 2) / (video.videoWidth * scale);
      const fy = (y - vb.top - (vb.height - video.videoHeight * scale) / 2) / (video.videoHeight * scale);
      const clamp = (v) => Math.min(1, Math.max(0, v));
      const point = { x: clamp(video.classList.contains('mirror') ? 1 - fx : fx), y: clamp(fy) };
      track.applyConstraints({ advanced: [{ pointsOfInterest: [point] }] }).catch(() => {});
    }
  }

  // `focus` names a control to keep focus on after the screen is redrawn
  // (Flip camera redraws it), so keyboard users stay where they were.
  // `still` is the camera's last frame, shown under the picture until it is live.
  async function renderCamera(focus, still = null) {
    const video = h('video', { autoplay: true, playsInline: true, muted: true, class: state.facing === 'user' ? 'mirror' : '' });
    if (still) video.addEventListener('playing', () => still.remove(), { once: true });
    const msg = h('div', { class: 'cam-msg', hidden: true });
    const viewfinder = h('div', { class: 'viewfinder' });
    const flip = (from) => {
      state.facing = state.facing === 'user' ? 'environment' : 'user';
      stopCamera();
      renderCamera(from);
    };
    viewfinderGestures(viewfinder, video, () => flip());
    const flashBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Flash', onclick: () => {
      state.flash = !state.flash;
      try { localStorage.setItem(FLASH_KEY, state.flash ? 'on' : 'off'); } catch {}
      paintFlash();
      const track = camTrack();
      if (state.flash && track && !flashKind(track)) toast('This camera has no flash.');
    } });
    const paintFlash = () => {
      flashBtn.setAttribute('aria-pressed', String(state.flash));
      flashBtn.replaceChildren(icon(state.flash ? 'flash' : 'flash-off'));
    };
    paintFlash();
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => {
      const f = file.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => { openEditor(imageToCanvas(img, img.naturalWidth, img.naturalHeight, false)); URL.revokeObjectURL(img.src); };
      img.onerror = () => toast('That file is not a photo we can read.');
      img.src = URL.createObjectURL(f);
    } });
    const chipSlot = h('div', { class: 'scan-chip-slot', 'aria-live': 'polite' });
    // a tap takes a photo; holding records a video (see holdToRecord)
    const recordable = Boolean(clipType());
    const shutter = h('button', { class: 'shutter', type: 'button', 'aria-label': 'Take photo',
      'aria-describedby': recordable ? 'shutter-hint' : null }, shutterRing());
    const recStatus = h('p', { class: 'sr-only', role: 'status' });
    // top left: you and search; top right, a column: add friends, then the
    // camera's own switches. The shutter is the one big thing, low and central.
    const screen = h('section', { class: 'screen camera', 'aria-label': 'Camera' },
      still, video, msg, viewfinder,
      h('header', { class: 'bar overlay cam-bar' },
        h('h1', { class: 'sr-only' }, 'Camera'),
        meButton(),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Search', onclick: () => go('friends') }, icon('search')),
        h('div', { class: 'cam-tools' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Add friends', onclick: () => go('friends') }, icon('puff-plus', 28)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Flip camera', onclick: () => flip('Flip camera') }, icon('flip')),
          flashBtn)),
      chipSlot,
      h('div', { class: 'shutter-row' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Choose a photo', onclick: () => file.click() }, icon('image')),
        shutter),
      recordable && h('p', { id: 'shutter-hint', class: 'sr-only' }, 'Hold to record a video.'), recStatus,
      file, nav('camera'));
    holdToRecord(shutter, video, screen, recStatus);
    tabGestures(screen, 'camera');
    show(screen);
    if (focus) screen.querySelector(`[aria-label="${focus}"]`)?.focus();
    if (!navigator.mediaDevices?.getUserMedia) {
      still?.remove();
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
      still?.remove();
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

  // `source` (or the w x ht part of it from sx, sy) on a canvas, 1080px at most along its longer side
  function imageToCanvas(source, w, ht, mirror, sx = 0, sy = 0) {
    const scale = Math.min(1, 1080 / Math.max(w, ht));
    const c = h('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(ht * scale));
    const ctx = c.getContext('2d');
    if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, sx, sy, w, ht, 0, 0, c.width, c.height);
    return c;
  }

  // The frame as the viewfinder shows it: the live picture fills the screen
  // (object-fit: cover), so its middle is cut to the screen's shape. That
  // part, and only that, is the photo: what you aimed is what you send.
  function viewfinderFrame(video, mirror) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const box = video.getBoundingClientRect();
    const aim = box.width > 0 && box.height > 0 ? box.width / box.height : vw / vh;
    const w = vw / vh > aim ? vh * aim : vw;
    const ht = vw / vh > aim ? vh : vw / aim;
    return imageToCanvas(video, w, ht, mirror, (vw - w) / 2, (vh - ht) / 2);
  }

  // Take the frame, with the flash when it is on: the back camera's light
  // (on, a moment for the picture to brighten, the frame, off), or on the
  // front camera a full white screen that lights your face for the frame.
  const TORCH_SETTLE_MS = 300;
  const SCREEN_FLASH_MS = 150;
  let shooting = false;
  async function capture(video) {
    if (!video.videoWidth) return toast('The camera is not ready yet.');
    if (shooting) return undefined;
    const track = camTrack();
    const kind = state.flash ? flashKind(track) : null;
    const take = () => viewfinderFrame(video, state.facing === 'user');
    if (!kind) return openEditor(take());
    shooting = true;
    let photo = null;
    let light = null;
    try {
      if (kind === 'torch') {
        try { await track.applyConstraints({ advanced: [{ torch: true }] }); await wait(TORCH_SETTLE_MS); } catch {}
      } else {
        light = h('div', { class: 'screen-flash', 'aria-hidden': 'true' });
        document.body.append(light);
        await wait(SCREEN_FLASH_MS);
      }
      if (video.isConnected && video.videoWidth) photo = take();
    } finally {
      if (kind === 'torch') track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      light?.remove();
      shooting = false;
    }
    // they may have left the camera while the flash was firing
    if (photo && state.tab === 'camera') openEditor(photo);
    return undefined;
  }

  // ---------- video snaps: hold the shutter (S14) ----------
  // Hold the shutter for a moment and it records, up to 10 seconds, with a
  // ring filling round it; let go and the video editor opens. A tap is still
  // a photo. Holding Space on the shutter does the same from the keyboard.
  const HOLD_MS = 350;
  const CLIP_MAX_MS = 10000;
  const CLIP_MAX_BYTES = 11 * 1024 * 1024; // the server's limit for a video
  const CLIP_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  let clipTypeFound;
  // the first format this browser can record that Poof can send, or ''
  function clipType() {
    if (clipTypeFound === undefined) {
      clipTypeFound = typeof window.MediaRecorder !== 'function' ? '' : CLIP_TYPES.find((t) => {
        try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
      }) || '';
    }
    return clipTypeFound;
  }

  const isWebm = () => clipType().startsWith('video/webm');

  // A recording that stops very soon after it starts can hold no frames at
  // all; a WebM is checked for them, anything else for having any bytes.
  async function hasPicture(blob) {
    if (!blob.size) return false;
    if (!blob.type.startsWith('video/webm')) return true;
    try {
      const { tracks, blocks } = window.PoofWebm.info(await blob.arrayBuffer());
      return tracks.some((t) => t.type === 1 && blocks[t.number] > 0);
    } catch { return true; } // a layout webm.js doesn't know: let the browser judge it
  }

  // the same video with no sound in it at all, for Mute
  async function silentCopy(clip) {
    if (clip.silent) return clip.silent;
    try {
      return new Blob([window.PoofWebm.stripAudio(await clip.blob.arrayBuffer())], { type: clip.type });
    } catch {
      throw new Error("This video can't be muted. Turn Mute off to send it, or record it again.");
    }
  }

  // the progress ring drawn round the shutter while it records
  function shutterRing() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(svgNS, 'svg');
    ring.setAttribute('class', 'shutter-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    ring.setAttribute('aria-hidden', 'true');
    for (const part of ['track', 'arc']) {
      const c = document.createElementNS(svgNS, 'circle');
      for (const [k, v] of [['class', part], ['cx', 50], ['cy', 50], ['r', 46], ['pathLength', 100]]) c.setAttribute(k, v);
      ring.append(c);
    }
    return ring;
  }

  // The microphone is asked for only once a hold has started, so a tap for a
  // photo never asks for it or turns it on. Null when there is none or it's blocked.
  async function openMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      return s.getAudioTracks()[0] || null;
    } catch { return null; }
  }

  function recorder(tracks) {
    const type = clipType();
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    // the plain type (no codecs), so the data URL it becomes is well formed
    const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: type.split(';')[0] })); });
    rec.finish = () => {
      if (rec.state !== 'inactive') { try { rec.stop(); } catch {} }
      return done;
    };
    return rec;
  }

  // stop a recording without keeping it (the camera is closing)
  function abortRecording() {
    const r = state.recording;
    if (!r) return;
    state.recording = null;
    r.aborted = true;
    clearTimeout(r.cap);
    cancelAnimationFrame(r.raf);
    r.full?.finish();
    r.silent?.finish();
    r.mic?.stop();
  }

  function holdToRecord(shutter, video, screen, status) {
    const arc = shutter.querySelector('.shutter-ring .arc');
    let press = null; // from pointer (or Space) down to up
    let swallowUntil = 0; // the click that follows letting go of a recording is not a photo

    const looks = (on) => {
      screen.classList.toggle('recording', on);
      shutter.classList.toggle('recording', on);
      if (!on) arc.style.strokeDashoffset = '';
    };
    const down = () => {
      if (press || state.recording || shooting || !clipType() || !video.videoWidth) return;
      const r = { phase: 'pressed' };
      r.timer = setTimeout(() => startClip(r), HOLD_MS);
      press = r;
    };
    const up = () => {
      const r = press;
      if (!r) return;
      press = null;
      clearTimeout(r.timer);
      if (r.phase === 'pressed') return; // a tap: the click that follows takes the photo
      swallowUntil = performance.now() + 600;
      r.released = true;
      if (r.phase === 'recording') stopClip(r);
    };

    async function startClip(r) {
      const track = camTrack();
      if (!track || !video.isConnected || state.tab !== 'camera') return;
      r.phase = 'starting';
      state.recording = r;
      looks(true);
      const mic = await openMic();
      if (r.aborted || r.released || !video.isConnected) {
        mic?.stop();
        if (state.recording === r) state.recording = null;
        if (!r.aborted) { looks(false); toast('Keep holding to record a video.'); }
        return;
      }
      try {
        r.full = recorder(mic ? [track, mic] : [track]);
        // Muted, a video carries no sound at all. A WebM has its sound track
        // taken out when it's sent (webm.js). An MP4 (older Safari) can't be,
        // so a second copy records without the microphone; only there, as
        // two encoders at once can starve each other on a computer.
        r.silent = mic && !isWebm() ? recorder([track]) : null;
        r.full.start();
        r.silent?.start();
      } catch {
        mic?.stop();
        state.recording = null;
        looks(false);
        toast("This browser can't record video. Tap for a photo instead.");
        return;
      }
      r.mic = mic;
      if (!mic) toast('Recording without sound. Allow the microphone to add sound.');
      r.torch = state.flash && flashKind(track) === 'torch';
      if (r.torch) track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
      r.phase = 'recording';
      r.startedAt = performance.now();
      status.textContent = 'Recording. Let go to stop.';
      r.cap = setTimeout(() => stopClip(r), CLIP_MAX_MS);
      const tick = () => {
        const p = Math.min(1, (performance.now() - r.startedAt) / CLIP_MAX_MS);
        arc.style.strokeDashoffset = String(100 * (1 - p));
        if (r.phase === 'recording') r.raf = requestAnimationFrame(tick);
      };
      tick();
    }

    async function stopClip(r) {
      if (r.phase !== 'recording') return;
      r.phase = 'stopping';
      clearTimeout(r.cap);
      cancelAnimationFrame(r.raf);
      const seconds = Math.min(CLIP_MAX_MS, performance.now() - r.startedAt) / 1000;
      const [full, silent] = await Promise.all([r.full.finish(), r.silent?.finish()]);
      r.mic?.stop();
      if (r.torch) camTrack()?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      status.textContent = '';
      if (state.recording === r) state.recording = null;
      if (r.aborted || state.tab !== 'camera' || !video.isConnected) return;
      if (!(await hasPicture(full))) {
        looks(false);
        toast("That video didn't record. Hold a little longer.");
        return;
      }
      openVideoEditor({ blob: full, type: full.type, sound: Boolean(r.mic), silent: silent || null, seconds,
        mirror: video.classList.contains('mirror') });
    }

    shutter.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      try { shutter.setPointerCapture(e.pointerId); } catch {}
      down();
    });
    shutter.addEventListener('pointerup', up);
    shutter.addEventListener('pointercancel', up);
    shutter.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press is a recording, not a menu
    shutter.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat) down(); });
    shutter.addEventListener('keyup', (e) => { if (e.key === ' ') up(); });
    shutter.addEventListener('click', () => {
      if (performance.now() < swallowUntil || state.recording) return;
      capture(video);
    });
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

    // the photo as large as fits on the stage, its drawing layer over it and
    // the caption at its height (a photo from the camera fills the stage)
    function layout() {
      const sr = stage.getBoundingClientRect();
      if (!sr.width || !sr.height) return;
      const k = Math.min(sr.width / base.width, sr.height / base.height);
      const w = base.width * k;
      const ht = base.height * k;
      for (const c of [base, draw]) { c.style.width = w + 'px'; c.style.height = ht + 'px'; }
      caption.style.top = ((sr.height - ht) / 2 + ed.captionY * ht - (caption.offsetHeight || 48) / 2) + 'px';
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
    // each colour a full-size tap target, its dot drawn inside (styles.css .swatch)
    const colors = h('div', { class: 'colors', hidden: true }, COLORS.map((c) => h('button', {
      class: 'swatch', style: `--swatch:${c}`, 'aria-label': 'Colour ' + c, 'aria-pressed': String(c === ed.color),
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
    const showTimer = () => { timerLabel.replaceChildren(ed.timer ? ed.timer + 's' : icon('no-limit', 16)); };
    const timerBtn = h('button', { class: 'icon-btn timer-btn', 'aria-label': 'Timer', onclick: () => {
      ed.timer = TIMERS[(TIMERS.indexOf(ed.timer) + 1) % TIMERS.length];
      showTimer();
    } }, icon('timer', 20), timerLabel);
    showTimer();
    const textBtn = h('button', { class: 'icon-btn', 'aria-label': 'Add caption', onclick: () => {
      caption.hidden = false; layout(); caption.focus();
    } }, icon('text'));

    const screen = h('section', { class: 'screen editor', 'aria-label': 'Edit photo' },
      stage,
      h('div', { class: 'tools' }, textBtn, penBtn, colors, undoBtn, timerBtn),
      h('header', { class: 'bar overlay', style: 'right:auto' },
        h('button', { class: 'icon-btn', 'aria-label': 'Discard', onclick: () => go('camera') }, icon('close'))),
      h('div', { class: 'editor-foot' },
        h('button', { class: 'icon-btn', 'aria-label': 'Save to device', onclick: saveToDevice }, icon('download')),
        h('button', { class: 'btn', onclick: () => renderSendTo(() => ({ image: flatten(), duration: state.editor.timer })) },
          'Send to', icon('send', 20))));
    screen.resume = layout; // back from Send to
    show(screen);
    layout();
    requestAnimationFrame(layout);
    window.onresize = layout;
  }

  // ---------- video editor (S14) ----------
  // The clip loops while you add a caption (sent beside the video and shown
  // over it) or mute it. One thing to do next: Send to.
  function dropClip() {
    if (state.clip?.url) URL.revokeObjectURL(state.clip.url);
    state.clip = null;
  }

  // Play a video; where the browser won't start one with sound on its own,
  // play it silently rather than not at all.
  function playClip(v) {
    const p = v.play();
    if (!p) return;
    p.catch((e) => {
      if (e?.name !== 'NotAllowedError' || !v.isConnected) return;
      v.muted = true;
      v.play().catch(() => {});
    });
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the video.'));
    reader.readAsDataURL(blob);
  });

  function dataUrlToBlob(url) {
    const comma = url.indexOf(',');
    const bin = atob(url.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: url.slice(5, comma).split(';')[0] });
  }

  function openVideoEditor(clip) {
    stopCamera();
    dropClip();
    clip.url = URL.createObjectURL(clip.blob);
    state.clip = clip;
    state.photo = null;
    const ed = (state.editor = { kind: 'video', muted: false });
    const video = h('video', { class: clip.mirror ? 'mirror' : null, loop: true, playsInline: true, 'aria-label': 'Your video' });
    video.muted = !clip.sound;
    video.src = clip.url;
    const caption = h('input', { class: 'caption', placeholder: 'Add a caption', maxlength: '80', 'aria-label': 'Caption', hidden: true });
    const openCaption = () => { caption.hidden = false; caption.focus(); };
    video.addEventListener('click', openCaption); // tap the video to add a caption, as on a photo
    caption.addEventListener('blur', () => { if (!caption.value.trim()) caption.hidden = true; });
    caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') caption.blur(); });

    const tools = [h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Add caption', onclick: openCaption }, icon('text'))];
    if (clip.sound) {
      const mute = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mute', onclick: () => {
        ed.muted = !ed.muted;
        video.muted = ed.muted;
        paintMute();
      } });
      const paintMute = () => {
        mute.setAttribute('aria-pressed', String(ed.muted));
        mute.replaceChildren(icon(ed.muted ? 'sound-off' : 'sound'));
      };
      paintMute();
      tools.push(mute);
    }

    // muted, it sends a copy with no sound track
    const payload = async () => {
      const blob = ed.muted ? await silentCopy(clip) : clip.blob;
      if (blob.size > CLIP_MAX_BYTES) throw new Error('This video is too big to send. Try a shorter one.');
      return { video: await blobToDataUrl(blob), caption: caption.value.trim(), duration: Math.round(clip.seconds * 10) / 10, mirror: clip.mirror };
    };
    const screen = h('section', { class: 'screen editor video-editor', 'aria-label': 'Edit video' },
      h('div', { class: 'stage' }, video, caption),
      h('div', { class: 'tools' }, tools),
      h('header', { class: 'bar overlay', style: 'right:auto' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Discard', onclick: () => { dropClip(); go('camera'); } }, icon('close'))),
      h('div', { class: 'editor-foot end' },
        h('button', { class: 'btn', type: 'button', onclick: () => renderSendTo(payload) }, 'Send to', icon('send', 20))));
    screen.resume = () => playClip(video); // a video taken out of the page pauses
    show(screen);
    playClip(video);
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
  // `payload` gives the snap's media fields: {image, duration} from the photo
  // editor, {video, caption, duration, mirror} from the video editor.
  const SEND_MAX = 64; // friends and groups one poof can go to (the server's limit too)
  async function renderSendTo(payload) {
    const media = Promise.resolve().then(payload); // ready by the time Send is tapped
    media.catch(() => {}); // reported when Send is tapped
    const picked = new Set();
    const pickedGroups = new Set();
    let story = false;
    let data;
    let groups = [];
    const who = h('span', { class: 'who' }, 'Pick who gets it');
    const sendLabel = () => ['Send', icon('send', 18)];
    const sendBtn = h('button', { class: 'btn small', disabled: true, onclick: send }, sendLabel());
    const list = h('div', { class: 'scroll', style: 'padding-bottom:96px' }, h('p', { class: 'hint' }, 'Loading friends…'));
    const back = backButton('Back to editing', () => { show(editorScreen); editorScreen.resume?.(); });
    const editorScreen = app.firstElementChild;
    show(h('section', { class: 'screen', 'aria-label': 'Send to' }, header('Send to', back), list,
      h('div', { class: 'send-bar' }, who, sendBtn)));

    function update() {
      const names = [...(story ? ['My Story'] : []),
        ...groups.filter((g) => pickedGroups.has(g.id)).map((g) => g.name),
        ...data.friends.filter((f) => picked.has(f.id)).map((f) => f.displayName)];
      who.textContent = names.length ? names.join(', ') : 'Pick who gets it';
      sendBtn.disabled = !names.length;
    }
    async function send() {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      const storyOnly = story && !picked.size && !pickedGroups.size;
      try {
        await api('/api/snaps', { to: [...picked], groupIds: [...pickedGroups], story, ...(await media) });
        dropClip();
        puffPop(storyOnly ? 'Posted to your story' : 'Poof! Sent', storyOnly ? 'party' : 'wink');
        go('chat');
      } catch (e) {
        toast(e.message);
        sendBtn.disabled = false;
        sendBtn.replaceChildren(...sendLabel());
      }
    }
    try { [data, groups] = await Promise.all([api('/api/friends'), api('/api/groups')]); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    const toggle = (row, on) => row.setAttribute('aria-checked', String(on));
    const full = () => {
      if (picked.size + pickedGroups.size < SEND_MAX) return false;
      toast(`You can send a poof to up to ${SEND_MAX} friends and groups at once.`);
      return true;
    };
    const storyRow = h('button', { class: 'row', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
      story = !story; toggle(storyRow, story); update();
    } }, h('span', { class: 'avatar ring', style: 'background:var(--surface-2)' }, icon('stories')),
    h('span', { class: 'main' }, h('div', { class: 'name' }, 'My Story'), h('div', { class: 'sub' }, 'Friends can watch for 24 hours')),
    h('span', { class: 'check' }, icon('check', 16)));
    list.replaceChildren(storyRow);
    // groups you are in: everyone in one gets the snap, to open once each
    if (groups.length) list.append(h('h2', { class: 'section-title' }, 'Groups'));
    for (const g of groups) {
      const row = h('button', { class: 'row', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
        if (!pickedGroups.has(g.id) && full()) return;
        pickedGroups.has(g.id) ? pickedGroups.delete(g.id) : pickedGroups.add(g.id);
        toggle(row, pickedGroups.has(g.id));
        update();
      } }, groupAvatar(g.members), h('span', { class: 'main' }, h('div', { class: 'name' }, g.name),
        h('div', { class: 'sub' }, peopleCount(g.members.length))),
      h('span', { class: 'check' }, icon('check', 16)));
      list.append(row);
    }
    list.append(h('h2', { class: 'section-title' }, 'Friends'));
    if (!data.friends.length) {
      list.append(h('div', { class: 'empty' }, puff('sleepy', 110), h('strong', {}, 'No friends yet'),
        'Add someone by username to send them poofs. You can still post to your story.',
        h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn ghost small', onclick: () => go('friends') }, 'Add friends'))));
    }
    for (const f of data.friends) {
      const row = h('button', { class: 'row', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
        if (!picked.has(f.id) && full()) return;
        picked.has(f.id) ? picked.delete(f.id) : picked.add(f.id);
        toggle(row, picked.has(f.id));
        update();
      } }, avatar(f), h('span', { class: 'main' }, h('div', { class: 'name' }, f.displayName),
        h('div', { class: 'sub' }, '@' + f.username)),
      streakBadge(f.streak),
      h('span', { class: 'check' }, icon('check', 16)));
      list.append(row);
    }
  }

  // ---------- inbox (S05) ----------
  // Each row's latest news, in Poof's own marks (icons.js): a cloud for a
  // poof and a bubble for a chat, solid while new and outlined once opened;
  // Puff's trail of puffs for one you sent, solid until it is seen or read.
  // Poofs in violet, chats in teal. [colour, mark, words, new]
  const STATUS = {
    'new-snap': ['snap-c', 'mark-poof', 'New poof', true],
    'new-chat': ['chat-c', 'mark-chat', 'New chat', true],
    opened: ['snap-c', 'mark-sent-open', 'Seen'],
    delivered: ['snap-c', 'mark-sent', 'Sent'],
    received: ['snap-c', 'mark-poof-open', 'Received'],
    'chat-opened': ['chat-c', 'mark-sent-open', 'Read'],
    'chat-delivered': ['chat-c', 'mark-sent', 'Sent'],
    'chat-received': ['chat-c', 'mark-chat-open', 'Received'],
    'tap-to-chat': ['chat-c', 'mark-chat-open', 'Say hi'],
  };

  // ---------- typing (S07) ----------
  // A friend shows as typing until TYPING_SHOW_MS pass with no new typing
  // event from them, or their message arrives. The screen in front (the
  // Chat list or their thread) redraws its part through state.onTyping.
  function setTyping(friendId, on) {
    const was = state.typing.has(friendId);
    clearTimeout(state.typing.get(friendId));
    if (on) state.typing.set(friendId, setTimeout(() => setTyping(friendId, false), TYPING_SHOW_MS));
    else state.typing.delete(friendId);
    if (was !== on) state.onTyping?.(friendId);
  }

  // three dots that rise and fall in turn (they hold still with less motion)
  const typingDots = () => h('span', { class: 'typing-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));

  // A Chat list row's status into `sub`: its mark and colour, how many new
  // poofs, and how long ago; the row is marked unread while there is news.
  // Returns the status's words, for the row's name.
  function statusLine(sub, r) {
    const [color, mark, label, fresh] = STATUS[r.status];
    sub.className = 'sub ' + color;
    sub.closest('.chat-row')?.classList.toggle('unread', Boolean(fresh));
    sub.replaceChildren(...[h('span', { class: 'status-icon' }, icon(mark, 16)),
      h('span', { class: 'label' }, label + (r.snapIds.length > 1 ? ` (${r.snapIds.length})` : '')),
      r.lastAt ? h('span', { class: 'when' }, '· ' + ago(r.lastAt)) : null].filter(Boolean));
    return label;
  }

  // A row per friend: their avatar opens their friend card (so does pressing
  // and holding the row), the row opens new snaps or the chat, and swiping
  // the row right opens the chat too. While they type, Typing… stands in
  // for the row's status.
  function inboxRow(r) {
    const f = r.friend;
    const find = (sel) => () => app.querySelector(`.chat-row[data-friend="${CSS.escape(f.id)}"] ${sel}`);
    const chat = () => renderChat(f);
    const sub = h('div', { class: 'sub' });
    const streak = r.streak > 1 ? ', ' + streakWords(r.streak) : '';
    const open = h('button', { class: 'row', type: 'button', onclick: () => (r.snapIds.length ? openSnaps(f, r.snapIds) : chat()) },
      h('span', { class: 'main' }, h('div', { class: 'name' }, f.displayName), sub),
      streakBadge(r.streak));
    const setStatus = () => {
      if (state.typing.has(f.id)) {
        sub.className = 'sub chat-c typing-status';
        sub.replaceChildren(typingDots(), h('span', {}, 'Typing…'));
        open.setAttribute('aria-label', `${f.displayName}, Typing…${streak}`);
        return;
      }
      open.setAttribute('aria-label', `${f.displayName}, ${statusLine(sub, r)}${streak}`);
    };
    const row = h('div', { class: 'chat-row', 'data-friend': f.id },
      h('div', { class: 'row-reveal', 'aria-hidden': 'true' }, icon('chat'), 'Chat'),
      h('div', { class: 'row-slide' },
        h('button', { class: 'row-avatar', type: 'button', 'aria-label': `${f.displayName}'s friend card`,
          onclick: () => openFriendCard(f, r.streak, find('.row-avatar')) }, avatar(f)),
        open,
        h('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Chat with ' + f.displayName, onclick: chat }, icon('chat'))));
    setStatus();
    row.setStatus = setStatus;
    row.openChat = chat;
    row.openCard = () => openFriendCard(f, r.streak, find('.row'));
    // a right click, the menu key or Shift+F10 opens the card too
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openFriendCard(f, r.streak, find(e.target.closest('.row-avatar') ? '.row-avatar' : '.row'));
    });
    return row;
  }

  // A group's row, like a friend's: its people's avatars stacked (they open
  // the group card, as pressing and holding the row does), the row opens new
  // snaps or the group's chat, and swiping it right opens the chat.
  function groupInboxRow(r) {
    const g = r.group;
    const find = (sel) => () => app.querySelector(`.chat-row[data-group="${CSS.escape(g.id)}"] ${sel}`);
    const chat = () => renderGroupChat(g);
    const sub = h('div', { class: 'sub' });
    const open = h('button', { class: 'row', type: 'button',
      onclick: () => (r.snapIds.length ? openSnaps(null, r.snapIds, g) : chat()) },
    h('span', { class: 'main' }, h('div', { class: 'name' }, g.name), sub));
    const row = h('div', { class: 'chat-row', 'data-group': g.id },
      h('div', { class: 'row-reveal', 'aria-hidden': 'true' }, icon('chat'), 'Chat'),
      h('div', { class: 'row-slide' },
        h('button', { class: 'row-avatar', type: 'button', 'aria-label': `${g.name} details`,
          onclick: () => openGroupCard(g, find('.row-avatar')) }, groupAvatar(g.members)),
        open,
        h('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Chat in ' + g.name, onclick: chat }, icon('chat'))));
    open.setAttribute('aria-label', `${g.name}, ${statusLine(sub, r)}`);
    row.openChat = chat;
    row.openCard = () => openGroupCard(g, find('.row'));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openGroupCard(g, find(e.target.closest('.row-avatar') ? '.row-avatar' : '.row'));
    });
    return row;
  }

  async function renderInbox() {
    const list = h('div', { class: 'scroll has-fab' }, h('p', { class: 'hint' }, 'Loading…'));
    // the one thing to start from here: a chat with a friend, or a group
    const fab = h('button', { class: 'fab', type: 'button', 'aria-label': 'New chat', onclick: renderNewChat }, icon('chat-new', 28));
    const screen = h('section', { class: 'screen', 'aria-label': 'Chats' }, header('Chat', meButton(), addButton()), list, fab, nav('chat'));
    tabGestures(screen, 'chat');
    pullToRefresh(screen, list);
    show(screen);
    // false when it couldn't load (pull to refresh says so)
    const load = async () => {
      let rows;
      try { rows = await api('/api/inbox'); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return false; }
      setUnread(countUnread(rows));
      if (!rows.length) {
        list.replaceChildren(h('div', { class: 'empty' }, puff('sleepy', 120), h('strong', {}, 'Nobody to talk to yet'),
          'Add friends by username, then send them a poof from the camera.',
          h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn small', onclick: () => go('friends') }, 'Add friends'))));
        return;
      }
      list.replaceChildren(...rows.map((r) => (r.group ? groupInboxRow(r) : inboxRow(r))));
    };
    state.refresh = load;
    state.onTyping = (id) => list.querySelector(`.chat-row[data-friend="${CSS.escape(id)}"]`)?.setStatus();
    await load();
  }

  // ---------- friend card (S16) ----------
  // Press and hold a chat row, or tap the friend's avatar: who they are,
  // your streak, their Puffcode, and Send a chat. Remove friend asks first.
  function openFriendCard(friend, streak, back) {
    if (state.sheet) return;
    const name = friend.displayName;
    const actions = h('div', { class: 'card-actions' });
    const showActions = () => actions.replaceChildren(
      h('button', { class: 'btn block', type: 'button', onclick: () => { closeSheet({ restore: false }); renderChat(friend); } },
        icon('chat', 20), 'Send a chat'),
      h('button', { class: 'btn danger block', type: 'button', onclick: askRemove }, 'Remove friend'));
    function askRemove() {
      const cancel = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
        showActions();
        actions.querySelector('.danger')?.focus();
      } }, 'Cancel');
      actions.replaceChildren(
        h('div', { class: 'card-confirm' }, h('strong', {}, `Remove ${name}?`),
          h('p', {}, `You won't be able to send poofs or chat with ${name} until you're friends again.`)),
        h('div', { class: 'card-confirm-actions' }, cancel,
          h('button', { class: 'btn danger outline', type: 'button', onclick: remove }, 'Remove')));
      cancel.focus(); // the safe choice
    }
    async function remove(e) {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/friends/remove', { userId: friend.id });
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        return;
      }
      closeSheet({ restore: false });
      toast(`Removed ${name}`);
      await state.refresh?.();
      app.querySelector('.chat-row .row, .scroll .btn')?.focus();
    }

    const head = h('div', { class: 'card-top' }, avatar(friend, '', 64),
      h('div', { class: 'card-who' },
        h('h2', { id: 'card-name', class: 'card-name' }, name),
        h('p', { class: 'card-user' }, '@' + friend.username),
        h('p', { class: 'card-streak' }, streak > 1 ? `${streak}-day streak` : 'No streak yet')));
    const body = [];
    if (window.PoofPuffcode) {
      const code = h('div', { class: 'puffcode card-code' });
      // built from a checked username, avatar integers and the code's own modules
      code.innerHTML = window.PoofPuffcode.svg({ url: window.PoofPuffcode.url(friend.username, location.origin),
        username: friend.username, avatar: friend.avatar, size: 184 });
      body.push(code, h('p', { class: 'hint' }, `Friends can scan this to add @${friend.username}.`));
    }
    body.push(actions);
    showActions();
    openSheet({ labelledby: 'card-name', head, body, back });
  }

  // ---------- group card (S19) ----------
  // A group's people, and Leave group, which asks first. From the Chat list
  // it has Send a chat too; from the group's own chat (`inThread`) it doesn't.
  function openGroupCard(group, back, { inThread = false } = {}) {
    if (state.sheet) return;
    const name = group.name;
    const actions = h('div', { class: 'card-actions' });
    const showActions = () => actions.replaceChildren(...[
      inThread ? null : h('button', { class: 'btn block', type: 'button', onclick: () => { closeSheet({ restore: false }); renderGroupChat(group); } },
        icon('chat', 20), 'Send a chat'),
      h('button', { class: 'btn danger block', type: 'button', onclick: askLeave }, 'Leave group'),
    ].filter(Boolean));
    function askLeave() {
      const cancel = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
        showActions();
        actions.querySelector('.danger')?.focus();
      } }, 'Cancel');
      actions.replaceChildren(
        h('div', { class: 'card-confirm' }, h('strong', {}, `Leave ${name}?`),
          h('p', {}, "You won't see its chats or poofs any more. The others will see that you left.")),
        h('div', { class: 'card-confirm-actions' }, cancel,
          h('button', { class: 'btn danger outline', type: 'button', onclick: leave }, 'Leave')));
      cancel.focus(); // the safe choice
    }
    async function leave(e) {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api(`/api/groups/${group.id}/leave`, {});
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        return;
      }
      closeSheet({ restore: false });
      toast(`You left ${name}`);
      await (inThread ? go('chat') : state.refresh?.());
      app.querySelector('.chat-row .row, .scroll .btn')?.focus();
    }
    const me = state.me.id;
    // you first, then everyone else as the group lists them
    const people = [...group.members].sort((a, b) => Number(b.id === me) - Number(a.id === me));
    const head = h('div', { class: 'card-top' }, groupAvatar(group.members, 64),
      h('div', { class: 'card-who' },
        h('h2', { id: 'card-name', class: 'card-name' }, name),
        h('p', { class: 'card-user' }, peopleCount(group.members.length))));
    const list = h('ul', { class: 'members', 'aria-label': 'People in ' + name }, ...people.map((u) => h('li', { class: 'row' },
      avatar(u, '', 36),
      h('span', { class: 'main' }, h('div', { class: 'name' }, u.id === me ? `${u.displayName} (you)` : u.displayName),
        h('div', { class: 'sub' }, '@' + u.username)))));
    showActions();
    openSheet({ labelledby: 'card-name', head, body: [list, actions], back });
  }

  // ---------- snap viewer (S06) ----------
  // A photo shows for its timer; a video plays once with its caption over it,
  // the ring following along, and moves on when it ends. Tap for the next;
  // swipe down (or Escape) to close. Dragging pauses the timer. A group's
  // snaps (`group`, no `friend`) can each be from someone else: the head
  // shows who sent the one on screen, over the group's name.
  async function openSnaps(friend, ids, group = null) {
    state.refresh = null;
    const queue = [...ids];
    const about = group ? 'g:' + group.id : friend.id;
    const av = h('span', { class: 'head-avatar' }, group ? groupAvatar(group.members || []) : avatar(friend));
    const who = h('span', { class: 'who' + (group ? ' stacked' : '') }, group ? group.name : friend.displayName);
    const fromName = (snap) => (snap.sender || friend).displayName;
    const showSender = (snap) => {
      if (!group || !snap.sender) return;
      av.replaceChildren(avatar(snap.sender));
      who.replaceChildren(h('span', {}, snap.sender.displayName), h('span', { class: 'sub' }, group.name));
    };
    const media = h('div', { class: 'media' });
    const caption = h('p', { class: 'media-caption', hidden: true });
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
    let clock = null; // a photo's countdown
    let raf = null;
    let viewed = 0;
    let clip = null; // the video on screen: { el, url }
    let paused = false; // while being dragged
    let closed = false;
    let loading = false; // a poof is on its way: a tap now must not open (and use up) another
    const stopMedia = () => {
      clock?.stop();
      clock = null;
      cancelAnimationFrame(raf);
      if (!clip) return;
      clip.el.pause();
      URL.revokeObjectURL(clip.url);
      clip = null;
    };
    const ring = (p) => { bar.style.strokeDashoffset = String(p * 2 * Math.PI * 15); };
    const close = () => {
      if (closed) return;
      closed = true;
      stopMedia();
      go('chat');
      if (viewed) puffPop('Poof! Gone for good', 'wow');
    };
    const pause = () => { paused = true; clock?.pause(); clip?.el.pause(); };
    const resume = () => { paused = false; clock?.resume(); if (clip) playClip(clip.el); };
    // On to the next poof. Opening one uses it up, so while one is on its way
    // (a video can take a while) taps wait: each poof is shown once it arrives.
    const next = async () => {
      if (closed || loading) return undefined;
      stopMedia();
      const id = queue.shift();
      if (!id) return close();
      loading = true;
      let snap;
      try { snap = await api(`/api/snaps/${id}/open`, {}); } catch (e) {
        loading = false;
        if (closed) return undefined;
        puffPop(e.message, 'sad');
        return next();
      }
      loading = false;
      if (closed) return undefined; // closed while it was on its way
      stopMedia(); // nothing else plays alongside it
      viewed++;
      setUnread(state.unread - 1);
      showSender(snap);
      caption.textContent = snap.caption || '';
      caption.hidden = !snap.caption;
      if (snap.video) {
        const v = h('video', { class: snap.mirror ? 'mirror' : null, playsInline: true, 'aria-label': 'Video from ' + fromName(snap) });
        clip = { el: v, url: URL.createObjectURL(dataUrlToBlob(snap.video)) };
        v.src = clip.url;
        media.replaceChildren(v);
        svg.style.visibility = 'visible';
        // the recorded length, where the file itself doesn't say
        const length = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : snap.duration || 10);
        const tick = () => {
          ring(Math.min(1, v.currentTime / length()));
          raf = requestAnimationFrame(tick);
        };
        v.addEventListener('ended', () => { if (clip?.el === v) next(); });
        v.addEventListener('error', () => { if (clip?.el === v) toast('This video could not play. Tap to go on.'); });
        ring(0);
        tick();
        if (!paused) playClip(v);
        return undefined;
      }
      media.replaceChildren(h('img', { alt: 'Photo from ' + fromName(snap), src: snap.image, draggable: 'false' }));
      svg.style.visibility = snap.duration ? 'visible' : 'hidden';
      if (snap.duration) {
        clock = countdown(snap.duration * 1000, ring, next);
        if (paused) clock.pause();
      }
      return undefined;
    };
    const screen = h('section', { class: 'screen viewer', 'aria-label': 'Poof' }, media, caption,
      h('button', { class: 'tap', type: 'button', 'aria-label': 'Next', onclick: next }),
      h('div', { class: 'head' }, av, who, svg,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))));
    viewerGestures(screen, { from: 'chat', close, pause, resume });
    show(screen);
    state.onEscape = close;
    state.onLeave = () => { closed = true; stopMedia(); }; // left for another screen (a banner tapped)
    dismissBannerFor(about, ['snap']);
    closeNotes(['snap:' + about]);
    next();
  }

  // ---------- sending a chat ----------
  // What you send shows at once as your bubble, saying Sending…, and the real
  // one takes its place when the chat reloads. One that can't be sent stays,
  // marked Not sent: a tap sends it again. `post(text)` sends; `reload()`
  // redraws the thread, and `show()` puts what is still on its way back at
  // its end.
  function outbox(thread, post, reload) {
    const waiting = [];
    const paint = (m) => {
      const failed = m.state === 'failed';
      m.el.className = 'msg mine pending' + (failed ? ' failed' : '');
      m.el.setAttribute('aria-label', (failed ? 'Not sent: ' : 'Sending: ') + m.text + (failed ? '. Tap to try again' : ''));
      m.el.replaceChildren(m.text, h('small', {}, failed ? 'Not sent · tap to try again' : 'Sending…'));
    };
    async function send(m) {
      m.state = 'sending';
      paint(m);
      try { await post(m.text); } catch (e) {
        m.state = 'failed';
        paint(m);
        toast(e.message);
        return;
      }
      waiting.splice(waiting.indexOf(m), 1); // the reload draws the real one where it was
      await reload();
    }
    return {
      add(text) {
        const m = { text, state: 'sending' };
        m.el = h('button', { type: 'button', onclick: () => { if (m.state === 'failed') send(m); } });
        waiting.push(m);
        thread.querySelector(':scope > .empty')?.remove();
        thread.append(m.el);
        thread.scrollTop = thread.scrollHeight;
        return send(m);
      },
      get size() { return waiting.length; },
      show() { if (waiting.length) thread.append(...waiting.map((m) => m.el)); },
    };
  }

  // A chat bubble, yours or theirs: tap it to keep it (or stop keeping it).
  // Kept ones carry their own mark and the word Kept, and a toast says so.
  function bubble(m, { mine, label, meta, reload }) {
    return h('button', {
      class: 'msg' + (mine ? ' mine' : '') + (m.saved ? ' saved' : ''), type: 'button',
      'aria-label': label + (m.saved ? ', kept' : '') + '. Tap to ' + (m.saved ? 'stop keeping it' : 'keep it'),
      onclick: async () => {
        let r;
        try { r = await api(`/api/messages/${m.id}/save`, {}); } catch (e) { toast(e.message); return; }
        toast(r.saved ? 'Kept in chat' : 'No longer kept');
        reload();
      },
    }, m.text, h('small', {}, m.saved ? [icon('kept', 12), 'Kept · '] : null, meta));
  }

  // ---------- chat thread (S07) ----------
  async function renderChat(friend) {
    const thread = h('div', { class: 'thread', 'aria-live': 'polite' });
    const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    // while you type, your friend is told (at most every TYPING_SEND_MS);
    // a message waits for the last of those so it never arrives first
    let typingAt = 0;
    let typingSent = null;
    let canType = true;
    const typed = () => {
      if (!canType || !input.value.trim() || Date.now() - typingAt < TYPING_SEND_MS) return;
      typingAt = Date.now();
      typingSent = api(`/api/chat/${friend.id}/typing`, {}).catch((e) => { if (e.status === 403) canType = false; });
    };
    const input = h('input', { placeholder: 'Send a chat', 'aria-label': 'Message', maxlength: '2000', autofocus: true, oninput: typed });
    const outgoing = outbox(thread, async (text) => {
      await typingSent;
      typingAt = 0; // the next message's first keystroke says so straight away
      await api('/api/chat/' + friend.id, { text });
    }, () => load());
    const form = h('form', { class: 'composer', onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      outgoing.add(text);
    } }, input, h('button', { class: 'btn small', type: 'submit' }, 'Send'));
    // your friend typing to you: their avatar, moving dots and the words,
    // just above where you type, until they stop or their message arrives
    const typing = h('div', { class: 'typing', role: 'status' });
    const showTyping = () => {
      const on = state.typing.has(friend.id);
      if (on === typing.hasChildNodes()) return;
      const stay = nearBottom();
      typing.replaceChildren(...(on ? [avatar(friend, '', 32),
        h('span', { class: 'typing-bubble' }, typingDots()),
        h('span', { class: 'typing-text' }, friend.displayName + ' is typing…')] : []));
      if (stay) thread.scrollTop = thread.scrollHeight;
    };
    const back = backButton('Back', () => go('chat'));
    const cam = h('button', { class: 'icon-btn plain', 'aria-label': `Send ${friend.displayName} a poof`, onclick: () => go('camera') },
      icon('camera'));
    show(h('section', { class: 'screen', 'aria-label': 'Chat with ' + friend.displayName },
      header(friend.displayName, back, cam), thread, typing, form));
    state.onTyping = (id) => { if (id === friend.id) showTyping(); };
    state.chatWith = friend.id;
    dismissBannerFor(friend.id, ['chat', 'friend']);
    closeNotes(['chat:' + friend.id]);
    showTyping();
    async function load() {
      let data;
      try { data = await api('/api/chat/' + friend.id); } catch (e) { thread.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      const atBottom = nearBottom();
      thread.replaceChildren(h('p', { class: 'hint' }, 'Chats disappear 24 hours after they are read. Tap one to keep it.'),
        ...data.messages.map((m) => {
          const mine = m.from === state.me.id;
          return bubble(m, { mine, label: 'Message: ' + m.text, reload: load,
            meta: ago(m.createdAt) + (mine ? (m.readAt ? ' · read' : ' · sent') : '') });
        }));
      if (!data.messages.length && !outgoing.size) thread.append(h('div', { class: 'empty' }, puff('happy', 100), 'Say hi to ' + friend.displayName + '.'));
      outgoing.show();
      if (atBottom || !thread.dataset.loaded) thread.scrollTop = thread.scrollHeight;
      thread.dataset.loaded = '1';
      if (state.unread) syncUnread(); // opening the chat read what was new in it
    }
    // Loading the chat reads it. While Poof is out of sight what comes in
    // waits (unread, and counted in the tab's title) until it is back in view.
    let stale = false;
    const refresh = () => {
      if (document.hidden) { stale = true; return undefined; }
      stale = false;
      return load();
    };
    const onVisible = () => { if (stale && !document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    state.onLeave = () => document.removeEventListener('visibilitychange', onVisible);
    state.refresh = refresh;
    await load();
  }

  // ---------- group chat (S19) ----------
  // Like a chat with a friend. Messages from the others come in runs under
  // the sender's name and avatar; yours say Sent, read by whom so far, or
  // Read once everyone has. A line says when someone left. Group details,
  // top right, lists who is in it and has Leave group.
  async function renderGroupChat(group) {
    const key = 'g:' + group.id;
    let current = { members: [], ...group }; // the group as last loaded
    const thread = h('div', { class: 'thread', 'aria-live': 'polite' });
    const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    const input = h('input', { placeholder: 'Send a chat', 'aria-label': 'Message', maxlength: '2000', autofocus: true });
    const outgoing = outbox(thread, (text) => api(`/api/groups/${group.id}/chat`, { text }), () => load());
    const form = h('form', { class: 'composer', onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      outgoing.add(text);
    } }, input, h('button', { class: 'btn small', type: 'submit' }, 'Send'));
    const back = backButton('Back', () => go('chat'));
    const details = h('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Group details',
      onclick: () => openGroupCard(current, () => app.querySelector('.bar [aria-label="Group details"]'), { inThread: true }) }, icon('group'));
    const bar = header(group.name, back, details);
    const screen = h('section', { class: 'screen', 'aria-label': 'Chat in ' + group.name }, bar, thread, form);
    show(screen);
    state.chatWith = key;
    dismissBannerFor(key, ['chat', 'group']);
    closeNotes(['chat:' + key]);

    // who has read your message, out of everyone else in the group now
    const readLine = (m, others) => {
      const readers = others.filter((u) => m.readBy.includes(u.id));
      if (!readers.length) return ' · sent';
      if (readers.length === others.length) return ' · read';
      return ' · read by ' + (readers.length > 2 ? readers.length : readers.map((u) => u.displayName).join(' and '));
    };
    async function load() {
      let data;
      try { data = await api(`/api/groups/${group.id}/chat`); } catch (e) {
        thread.replaceChildren(h('p', { class: 'error' }, e.status === 404 ? "You're not in this group any more." : e.message));
        return;
      }
      current = data.group;
      // an unnamed group's name follows who is in it
      bar.querySelector('h1').textContent = current.name;
      screen.setAttribute('aria-label', 'Chat in ' + current.name);
      const people = new Map(data.people.map((u) => [u.id, u]));
      const others = current.members.filter((u) => u.id !== state.me.id);
      const someone = (id) => people.get(id) || { id, username: id, displayName: 'Someone', avatar: null };
      const atBottom = nearBottom();
      const items = [h('p', { class: 'hint' }, 'Chats disappear 24 hours after everyone has read them. Tap one to keep it.')];
      let run = null; // the others' messages in a row from one person, under their name
      for (const m of data.messages) {
        if (m.event === 'left') {
          items.push(h('p', { class: 'thread-note' }, `${someone(m.from).displayName} left the group.`));
          run = null;
          continue;
        }
        const mine = m.from === state.me.id;
        const sender = someone(m.from);
        const el = bubble(m, { mine, label: 'Message' + (mine ? '' : ' from ' + sender.displayName) + ': ' + m.text,
          meta: ago(m.createdAt) + (mine ? readLine(m, others) : ''), reload: load });
        if (mine) { items.push(el); run = null; continue; }
        if (run?.from !== m.from) {
          run = { from: m.from, col: h('div', { class: 'msg-col' }, h('span', { class: 'msg-sender' }, sender.displayName)) };
          items.push(h('div', { class: 'msg-run' }, avatar(sender, '', 28), run.col));
        }
        run.col.append(el);
      }
      if (!data.messages.length && !outgoing.size) items.push(h('div', { class: 'empty' }, puff('happy', 100), 'Say hi to everyone in ' + current.name + '.'));
      thread.replaceChildren(...items);
      outgoing.show();
      if (atBottom || !thread.dataset.loaded) thread.scrollTop = thread.scrollHeight;
      thread.dataset.loaded = '1';
      if (state.unread) syncUnread(); // opening the chat read what was new in it
    }
    // as with a friend's chat: what comes in while Poof is out of sight waits, unread
    let stale = false;
    const refresh = () => {
      if (document.hidden) { stale = true; return undefined; }
      stale = false;
      return load();
    };
    const onVisible = () => { if (stale && !document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    state.onLeave = () => document.removeEventListener('visibilitychange', onVisible);
    state.refresh = refresh;
    await load();
  }

  // ---------- new chat (S18) ----------
  // Pick friends. One opens your chat with them; two or more, or a name,
  // start a group (up to GROUP_MAX people with you) and open its chat.
  const GROUP_MAX = 32; // the server's limit too
  async function renderNewChat() {
    state.refresh = null;
    const picked = new Set();
    let friends = [];
    const isGroup = () => picked.size > 1 || !!name.value.trim();
    function update() {
      const names = friends.filter((f) => picked.has(f.id)).map((f) => f.displayName);
      who.textContent = names.length ? names.join(', ') : 'Pick friends to chat with';
      startBtn.textContent = isGroup() ? 'Start group' : 'Chat';
      startBtn.disabled = !picked.size;
    }
    async function start() {
      const chosen = friends.filter((f) => picked.has(f.id));
      if (!chosen.length) return;
      if (!isGroup()) { renderChat(chosen[0]); return; }
      startBtn.disabled = true;
      try {
        renderGroupChat(await api('/api/groups', { name: name.value.trim(), members: chosen.map((f) => f.id) }));
      } catch (e) {
        toast(e.message);
        startBtn.disabled = false;
      }
    }
    const name = h('input', { id: 'group-name', maxlength: '40', placeholder: 'Optional', autocomplete: 'off',
      'aria-describedby': 'group-name-note', oninput: update });
    const who = h('span', { class: 'who' }, 'Pick friends to chat with');
    const startBtn = h('button', { class: 'btn small', type: 'button', disabled: true, onclick: start }, 'Chat');
    const rows = h('div', {}, h('p', { class: 'hint' }, 'Loading friends…'));
    const list = h('div', { class: 'scroll pick-list' },
      h('div', { class: 'field' }, h('label', { for: 'group-name' }, 'Group name'), name,
        h('p', { class: 'note', id: 'group-name-note' }, 'Pick two or more friends, or give it a name, to start a group.')),
      rows);
    show(h('section', { class: 'screen', 'aria-label': 'New chat' }, header('New chat', backButton('Back', () => go('chat'))), list,
      h('div', { class: 'send-bar' }, who, startBtn)));

    let data;
    try { data = await api('/api/friends'); } catch (e) { rows.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    friends = data.friends;
    if (!friends.length) {
      rows.replaceChildren(h('div', { class: 'empty' }, puff('sleepy', 110), h('strong', {}, 'No friends yet'),
        'Add someone by username, then start a chat with them here.',
        h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn ghost small', onclick: () => go('friends') }, 'Add friends'))));
      return;
    }
    rows.replaceChildren(h('h2', { class: 'section-title' }, 'Friends'), ...friends.map((f) => {
      const row = h('button', { class: 'row', type: 'button', role: 'checkbox', 'aria-checked': 'false', onclick: () => {
        if (!picked.has(f.id) && picked.size + 1 >= GROUP_MAX) { toast(`Groups can have up to ${GROUP_MAX} people.`); return; }
        picked.has(f.id) ? picked.delete(f.id) : picked.add(f.id);
        row.setAttribute('aria-checked', String(picked.has(f.id)));
        update();
      } }, avatar(f), h('span', { class: 'main' }, h('div', { class: 'name' }, f.displayName), h('div', { class: 'sub' }, '@' + f.username)),
      h('span', { class: 'check' }, icon('check', 16)));
      return row;
    }));
  }

  // ---------- stories (S08) ----------
  async function renderStories() {
    const list = h('div', { class: 'scroll' }, h('p', { class: 'hint' }, 'Loading…'));
    const screen = h('section', { class: 'screen', 'aria-label': 'Stories' }, header('Stories', meButton(), addButton()), list, nav('stories'));
    tabGestures(screen, 'stories');
    pullToRefresh(screen, list);
    show(screen);
    const load = async () => {
      let data;
      try { data = await api('/api/stories'); } catch (e) { list.replaceChildren(h('p', { class: 'error' }, e.message)); return false; }
      const viewers = new Set(data.mine.flatMap((s) => s.viewers.map((v) => v.id))).size;
      const mineRow = h('button', { class: 'row', onclick: () => (data.mine.length ? watch([{ user: state.me, stories: data.mine }], 0, true) : go('camera')) },
        avatar(state.me, data.mine.length ? 'ring' : ''),
        h('span', { class: 'main' }, h('div', { class: 'name' }, 'My Story'),
          h('div', { class: 'sub' }, data.mine.length
            ? `${data.mine.length} ${data.mine.length === 1 ? 'post' : 'posts'} · ${viewers} ${viewers === 1 ? 'viewer' : 'viewers'}`
            : 'Tap to add to your story')));
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

  // Tap the right half for the next story, the left half for the one
  // before; press and hold to pause; swipe down (or Escape) to close.
  function watch(groups, gi, mine = false) {
    state.refresh = null;
    let si = groups[gi].stories.findIndex((s) => !s.seen);
    if (si < 0 || mine) si = 0;
    let clock = null; // a photo story's countdown
    let raf = null;
    let clip = null; // the video story on screen
    let paused = false; // held, or being dragged
    let closed = false;
    const media = h('div', { class: 'media' });
    const caption = h('p', { class: 'media-caption', hidden: true });
    const progress = h('div', { class: 'progress' });
    const who = h('span', { class: 'who' });
    const sub = h('span', { class: 'sub', style: 'font-size:.8rem;opacity:.8' });
    const av = h('span');
    const stopMedia = () => {
      clock?.stop();
      clock = null;
      cancelAnimationFrame(raf);
      clip?.pause();
      clip = null;
    };
    const close = () => {
      if (closed) return;
      closed = true;
      stopMedia();
      go('stories');
    };
    const pause = () => { paused = true; clock?.pause(); clip?.pause(); };
    const resume = () => { paused = false; clock?.resume(); if (clip) playClip(clip); };
    function play() {
      stopMedia();
      const g = groups[gi];
      const s = g.stories[si];
      const src = `/api/stories/${s.id}/media`;
      const label = 'Story from ' + g.user.displayName;
      caption.textContent = s.caption || '';
      caption.hidden = !s.caption;
      who.textContent = mine ? 'My Story' : g.user.displayName;
      sub.textContent = ago(s.createdAt) + (mine ? ` · seen by ${s.viewers.length}${s.viewers.length ? ': ' + s.viewers.map((v) => v.displayName).join(', ') : ''}` : '');
      av.replaceChildren(avatar(g.user));
      progress.replaceChildren(...g.stories.map((_, i) => h('div', {}, h('i', { style: `width:${i < si ? 100 : 0}%` }))));
      if (!mine && !s.seen) { s.seen = true; api(`/api/stories/${s.id}/view`, {}).catch(() => {}); }
      const fill = progress.children[si].firstChild;
      if (s.type === 'video') {
        // plays once, its bar following the video, then on to the next story
        const v = h('video', { class: s.mirror ? 'mirror' : null, playsInline: true, preload: 'auto', 'aria-label': label });
        v.src = src;
        clip = v;
        media.replaceChildren(v);
        const length = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : s.duration || 10);
        const tick = () => {
          fill.style.width = Math.min(1, v.currentTime / length()) * 100 + '%';
          raf = requestAnimationFrame(tick);
        };
        v.addEventListener('playing', () => { if (clip !== v) return; cancelAnimationFrame(raf); tick(); });
        v.addEventListener('ended', () => { if (clip === v) step(1); });
        v.addEventListener('error', () => { if (clip === v) toast('This video could not play. Tap to go on.'); });
        if (!paused) playClip(v);
        return;
      }
      const img = h('img', { alt: label, draggable: 'false' });
      const total = (s.duration || 5) * 1000;
      // a photo that finishes loading after you've tapped on is no longer shown: leave it be
      img.onload = () => {
        if (!img.isConnected || closed) return;
        clock = countdown(total, (p) => { fill.style.width = p * 100 + '%'; }, () => step(1));
        if (paused) clock.pause();
      };
      img.src = src;
      media.replaceChildren(img);
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
    const screen = h('section', { class: 'screen viewer', 'aria-label': 'Story' }, media, caption, progress,
      h('button', { class: 'tap prev', type: 'button', 'aria-label': 'Previous', onclick: () => step(-1) }),
      h('button', { class: 'tap next', type: 'button', 'aria-label': 'Next', onclick: () => step(1) }),
      h('div', { class: 'head', style: 'top:12px' }, av,
        h('span', { class: 'who', style: 'display:flex;flex-direction:column' }, who, sub),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))));
    viewerGestures(screen, { from: 'stories', close, pause, resume, holdToPause: true });
    show(screen);
    state.onEscape = close;
    state.onLeave = () => { closed = true; stopMedia(); };
    play();
  }

  // ---------- add friends (S09) ----------
  async function renderFriends() {
    const results = h('div');
    const requests = h('div');
    // shown only with nothing typed and no requests either way
    const empty = h('div', { class: 'empty', hidden: true }, puff('wow', 110), h('strong', {}, 'Find your friends'),
      'Type a username to send a request.');
    let q = '';
    let hasRequests = true; // until they have loaded
    const paintEmpty = () => { empty.hidden = q.length >= 2 || hasRequests; };
    let debounce;
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search by username', 'aria-label': 'Search users',
      autofocus: true, autocapitalize: 'none', oninput: () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { q = search.value.trim(); runSearch(); }, 200);
      } });
    const back = backButton('Back', () => go(state.friendsBack || 'chat'));
    show(h('section', { class: 'screen', 'aria-label': 'Add friends' }, header('Add friends', back),
      h('div', { class: 'scroll' }, h('div', { class: 'field search-field' }, icon('search', 20), search),
        h('button', { class: 'btn ghost block scan-btn', type: 'button', onclick: renderScanner }, icon('scan', 20), 'Scan Puffcode'),
        results, requests, empty)));

    // Add and Accept: the button says what it is doing at once and takes no
    // second tap; it comes back as it was if that doesn't work
    async function act(btn, doing, path, body, okText, mood) {
      const was = [...btn.childNodes];
      btn.disabled = true;
      btn.replaceChildren(doing);
      try {
        await api(path, body);
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        btn.replaceChildren(...was);
        return;
      }
      if (mood) puffPop(okText, mood); else toast(okText);
      await Promise.all([runSearch(), loadRequests()]);
    }
    async function runSearch() {
      paintEmpty();
      if (q.length < 2) { results.replaceChildren(); return; }
      let users;
      try { users = await api('/api/users/search?q=' + encodeURIComponent(q)); } catch (e) { results.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
      results.replaceChildren(h('h2', { class: 'section-title' }, 'Results'),
        ...(users.length ? users.map((u) => h('div', { class: 'row' }, avatar(u),
          h('span', { class: 'main' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username)),
          u.status === 'accepted' ? h('span', { class: 'sub' }, 'Friends')
            : u.status === 'pending' ? h('span', { class: 'sub' }, 'Requested')
              : h('button', { class: 'btn small', type: 'button',
                onclick: (e) => act(e.currentTarget, 'Adding…', '/api/friends/request', { username: u.username }, 'Request sent') },
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
          h('button', { class: 'btn small', type: 'button', onclick: (e) => {
            dismissBannerFor(u.id, ['friend']); // their request is answered
            act(e.currentTarget, 'Accepting…', '/api/friends/accept', { userId: u.id }, 'You are now friends', 'love');
          } }, 'Accept'))),
        data.outgoing.length ? h('h2', { class: 'section-title' }, 'Waiting on') : null,
        ...data.outgoing.map((u) => h('div', { class: 'row' }, avatar(u),
          h('span', { class: 'main' }, h('div', { class: 'name' }, u.displayName), h('div', { class: 'sub' }, '@' + u.username + ' · pending')))),
      ].filter(Boolean));
      hasRequests = data.incoming.length + data.outgoing.length > 0;
      paintEmpty();
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
        body.replaceChildren(h('p', { class: 'error' }, e.message));
        return;
      }
      if (u.status === 'missing') {
        body.replaceChildren(h('div', { class: 'empty' }, puff('sad', 110), h('strong', {}, 'No one by that name'),
          `There is nobody called @${username} on Poof. Check the code, or search by username.`,
          h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'button', onclick: () => go('friends') }, 'Find friends'))));
        return;
      }
      // adding someone who already added you accepts them
      const send = async (btn) => {
        btn.disabled = true;
        try {
          const r = await api('/api/friends/request', { username: u.username });
          if (r.status === 'accepted') { dismissBannerFor(u.id, ['friend']); puffPop('You are now friends', 'love'); }
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
        if (cfg[tab] === i) btn.append(h('span', { class: 'option-check' }, icon('check', 14)));
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
      ? h('button', { class: 'link', type: 'button', onclick: home }, 'Skip')
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
    const back = backButton('Back', () => go(state.profileBack || 'camera'));
    show(h('section', { class: 'screen', 'aria-label': 'Profile' }, header('Profile', back), body));
    // a friend's row opens their card (Send a chat, and Remove friend, which asks first)
    const friendRow = (f) => h('button', { class: 'row', type: 'button', 'data-friend': f.id, 'aria-haspopup': 'dialog',
      'aria-label': `${f.displayName}, @${f.username}${f.streak > 1 ? ', ' + streakWords(f.streak) : ''}`,
      onclick: () => openFriendCard(f, f.streak, () => app.querySelector(`.scroll .row[data-friend="${CSS.escape(f.id)}"]`)) },
    avatar(f), h('span', { class: 'main' }, h('div', { class: 'name' }, f.displayName), h('div', { class: 'sub' }, '@' + f.username)),
    streakBadge(f.streak));
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
        ...friends.friends.map(friendRow),
        h('h2', { class: 'section-title' }, 'Settings'),
        notifySetting(),
        h('div', { style: 'margin-top:32px;display:flex;justify-content:center' },
          h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
            state.events?.close(); // nothing more comes in from here on
            state.events = null;
            await api('/api/logout', {}).catch(() => {});
            renderWelcome();
          } }, 'Log out')));
    };
    state.refresh = load;
    await load();
  }

  // ---------- notifications (S17) ----------
  // Something new from a friend: a new snap, a chat, a friend request or
  // its acceptance. With Poof on screen it drops in as a banner at the top;
  // with Poof out of sight and Notifications on (Profile), snaps and chats
  // raise a system notification instead.
  const bannerRegion = document.getElementById('banner');
  let banner = null; // the banner showing: { el, key, about, kind, timer, holds, back, done }
  const notes = new Map(); // system notifications showing: key -> Notification

  // whole characters, so an emoji is never cut in half
  function previewText(text) {
    const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
    return chars.length > PREVIEW_MAX ? chars.slice(0, PREVIEW_MAX - 1).join('').trimEnd() + '\u2026' : chars.join('');
  }

  // What an event from the server says, and what opening it does. `said`
  // is the system notification's text (snaps and chats only); `lead` is
  // read out before a chat's words, which on screen speak for themselves.
  function noticeFor(ev) {
    const who = ev.sender;
    if (!who?.id) return null;
    const name = who.displayName;
    // in a group: the group's name on top, the sender's avatar and name below
    const g = typeof ev.group === 'object' ? ev.group : null;
    if (g) {
      const about = 'g:' + g.id;
      const base = { about, who, title: g.name };
      if (ev.type === 'snap') {
        return { ...base, key: 'snap:' + about, kind: 'snap', line: 'New poof from ' + name, said: `New poof from ${name} in ${g.name}`,
          open: () => openGroupSnapsFrom(g) };
      }
      if (ev.type === 'message') {
        return { ...base, key: 'chat:' + about, kind: 'chat', line: `${name}: ${previewText(ev.preview)}`, lead: 'New chat: ',
          said: `New chat from ${name} in ${g.name}`, open: () => openGroupChatFrom(g) };
      }
      if (ev.type === 'group' && ev.kind === 'added') {
        return { ...base, key: 'group:' + about, kind: 'group', line: name + ' added you', open: () => openGroupChatFrom(g) };
      }
      return null; // someone leaving only refreshes what is on screen
    }
    if (ev.type === 'snap') {
      return { key: 'snap:' + who.id, who, kind: 'snap', line: 'New poof', said: `New poof from ${name}`, open: () => openSnapsFrom(who) };
    }
    if (ev.type === 'message') {
      return { key: 'chat:' + who.id, who, kind: 'chat', line: previewText(ev.preview) || 'New chat', lead: 'New chat: ',
        said: `New chat from ${name}`, open: () => openChatWith(who) };
    }
    if (ev.type === 'friends' && ev.kind === 'request') {
      return { key: 'friend:' + who.id, who, kind: 'friend', line: 'Sent you a friend request', open: () => go('friends') };
    }
    if (ev.type === 'friends' && ev.kind === 'accepted') {
      return { key: 'friend:' + who.id, who, kind: 'friend', line: 'Accepted your friend request', open: () => openChatWith(who) };
    }
    return null; // avatar changes, removals and the rest only refresh what is on screen
  }

  // making a snap (editing, picking who gets it, recording): no banner to
  // cover the tools or to tap away the work by accident
  const creating = () => !!state.recording || !!app.firstElementChild?.matches('.editor, [aria-label="Send to"]');

  function notify(ev) {
    const n = noticeFor(ev);
    if (!n) return;
    if (document.hidden) systemNotify(n);
    else if (!creating()) showBanner(n);
  }

  // Whatever is on screen gives way to a friend's chat or snaps (opened
  // from a banner or a system notification).
  function leaveScreen() {
    state.tab = 'chat';
    state.refresh = null;
    stopCamera();
    dropClip();
  }
  function openChatWith(who) {
    leaveScreen();
    renderChat(who);
  }
  async function openSnapsFrom(who) {
    leaveScreen();
    let rows;
    try { rows = await api('/api/inbox'); } catch (e) { toast(e.message); go('chat'); return; }
    const row = rows.find((r) => r.friend?.id === who.id);
    if (row?.snapIds.length) openSnaps(row.friend, row.snapIds);
    else go('chat'); // opened already, somewhere else
  }
  function openGroupChatFrom(g) {
    leaveScreen();
    renderGroupChat(g);
  }
  async function openGroupSnapsFrom(g) {
    leaveScreen();
    let rows;
    try { rows = await api('/api/inbox'); } catch (e) { toast(e.message); go('chat'); return; }
    const row = rows.find((r) => r.group?.id === g.id);
    if (row?.snapIds.length) openSnaps(null, row.snapIds, row.group);
    else go('chat'); // opened already, or no longer in the group
  }

  // The banner: the Puff mark on the friend's avatar, their name (or the
  // group's), and the news. Tap it to open that. Swipe it up, or press Escape on it, to put it
  // away; else it goes by itself after BANNER_MS, though not while a finger
  // is on it or it has keyboard focus. One at a time: the newest wins.
  function showBanner(n) {
    const old = banner;
    const again = old && old.key === n.key; // more of the same: no second drop-in
    const hadFocus = old?.el.contains(document.activeElement);
    const mark = h('span', { class: 'banner-mark', 'aria-hidden': 'true' });
    mark.innerHTML = window.mascotSVG('happy', 16, '', 'mark', '#ffffff'); // static markup, no user input
    const card = h('button', { type: 'button', class: `banner ${n.kind}${again ? ' again' : ''}`,
      onclick: () => { dismissBanner({ animate: false, restore: false }); n.open(); } },
    h('span', { class: 'banner-who' }, avatar(n.who, '', 40), mark),
    h('span', { class: 'banner-text' },
      h('strong', { class: 'banner-name' }, n.title || n.who.displayName),
      h('span', { class: 'banner-line' },
        n.kind === 'snap' || n.kind === 'chat' ? h('span', { class: 'status-icon' }, icon(n.kind === 'snap' ? 'mark-poof' : 'mark-chat', 16)) : null,
        n.lead ? h('span', { class: 'sr-only' }, n.lead) : null,
        h('span', { class: 'banner-say' }, n.line))));
    const b = { el: card, key: n.key, about: n.about || n.who.id, kind: n.kind, timer: null, holds: new Set(), back: old?.back || null, done: false };
    const run = () => {
      clearTimeout(b.timer);
      if (!b.done && !b.holds.size) b.timer = setTimeout(() => { if (banner === b) dismissBanner(); }, BANNER_MS);
    };
    b.hold = (why) => { b.holds.add(why); clearTimeout(b.timer); };
    b.release = (why) => { b.holds.delete(why); run(); };
    card.addEventListener('focusin', (e) => {
      if (!b.back && e.relatedTarget && !card.contains(e.relatedTarget)) b.back = e.relatedTarget;
      b.hold('focus');
    });
    card.addEventListener('focusout', () => b.release('focus'));
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // this Escape is the banner's, not the screen's
      dismissBanner();
    });
    // drag it up and it follows; past a third of its height, or flicked, it goes
    pointerDrag(card, {
      lock: (g) => {
        if (g.axis !== 'y') return false;
        card.style.animation = 'none'; // still dropping in: from here it follows the finger
        return true;
      },
      down: () => b.hold('touch'),
      move: (g) => { card.style.transform = `translateY(${g.dy < 0 ? g.dy : Math.min(g.dy * 0.25, 12)}px)`; },
      end: (g, { cancelled, vy }) => {
        if (g.dragging) {
          swallowClick();
          if (!cancelled && (g.dy < -card.offsetHeight / 3 || (vy < -FLICK && g.dy < -12))) { dismissBanner(); return; }
          glide([card], () => { card.style.transform = ''; });
        }
        b.release('touch');
      },
    });
    if (old) { old.done = true; clearTimeout(old.timer); }
    banner = b;
    bannerRegion.replaceChildren(card);
    if (hadFocus) card.focus();
    run();
  }

  // Put the banner away: sliding up and out, or at once (when what it was
  // about is being opened). Focus that was on it goes back where it came from.
  function dismissBanner({ animate = true, restore = true } = {}) {
    const b = banner;
    if (!b) return;
    banner = null;
    b.done = true;
    clearTimeout(b.timer);
    const hadFocus = b.el.contains(document.activeElement);
    b.el.inert = true;
    if (hadFocus && restore && b.back?.isConnected) b.back.focus();
    if (!animate || reduceMotion()) { b.el.remove(); return; }
    b.el.style.animation = 'none'; // were it still dropping in, its transform would win
    glide([b.el], () => {
      b.el.style.transform = 'translateY(calc(-100% - var(--space-5)))';
      b.el.style.opacity = '0';
    }, () => b.el.remove());
  }
  // a friend's (or a group's, 'g:' + its id) chat or snaps are open: their
  // banner about that has done its job
  function dismissBannerFor(about, kinds) {
    if (banner && banner.about === about && kinds.includes(banner.kind)) dismissBanner({ animate: false, restore: false });
  }

  // ---------- system notifications ----------
  // Only while Poof is open in a tab or window that is out of sight: there is
  // no push service, so a closed Poof hears nothing (the tab's title still
  // counts what is new). Some browsers (Chrome on Android) show them only
  // from a service worker; there it quietly does nothing.
  const notifySupported = () => typeof window.Notification === 'function';
  const notifyWanted = () => { try { return localStorage.getItem(NOTIFY_KEY) === 'on'; } catch { return false; } };
  const notifyOn = () => notifySupported() && window.Notification.permission === 'granted' && notifyWanted();
  function setNotifyWanted(on) {
    try { if (on) localStorage.setItem(NOTIFY_KEY, 'on'); else localStorage.removeItem(NOTIFY_KEY); } catch {}
  }

  function systemNotify(n) {
    if (!n.said || !notifyOn()) return;
    let note;
    try {
      note = new window.Notification(APP_TITLE, { body: n.said, icon: '/icons/icon-192.png', tag: n.key });
    } catch { return; }
    notes.set(n.key, note); // the same tag replaces the last one for this friend
    note.onclick = () => {
      window.focus();
      note.close();
      n.open();
    };
    note.onclose = () => { if (notes.get(n.key) === note) notes.delete(n.key); };
  }
  function closeNotes(keys) {
    for (const key of keys) {
      notes.get(key)?.close();
      notes.delete(key);
    }
  }

  // Profile > Notifications: a switch. Turning it on asks the browser once;
  // blocked or unsupported, it says so and stays off.
  function notifySetting() {
    const note = h('span', { class: 'sub', id: 'notify-note' });
    const sw = h('button', { type: 'button', class: 'row setting', role: 'switch', 'aria-checked': 'false',
      'aria-labelledby': 'notify-label', 'aria-describedby': 'notify-note', onclick: flip },
    h('span', { class: 'main' }, h('span', { class: 'name', id: 'notify-label' }, 'Notifications'), note),
    h('span', { class: 'switch', 'aria-hidden': 'true' }));
    let asking = false;
    function draw() {
      const supported = notifySupported();
      const on = notifyOn();
      sw.setAttribute('aria-checked', String(on));
      sw.disabled = !supported;
      note.textContent = !supported ? "This browser can't show notifications."
        : window.Notification.permission === 'denied' ? 'Blocked in this browser. Allow notifications for this site in its settings.'
          : on ? 'New poofs and chats will show up while Poof is in the background.'
            : 'Hear about new poofs and chats while Poof is in the background.';
    }
    async function flip() {
      if (asking || !notifySupported()) return;
      if (notifyOn()) { setNotifyWanted(false); draw(); return; }
      asking = true;
      let permission = window.Notification.permission;
      if (permission !== 'granted') {
        try {
          permission = await new Promise((resolve) => {
            const asked = window.Notification.requestPermission(resolve); // older Safari only calls back
            if (asked?.then) asked.then(resolve, () => resolve(window.Notification.permission));
          });
        } catch { permission = window.Notification.permission; }
      }
      asking = false;
      setNotifyWanted(permission === 'granted');
      draw();
    }
    draw();
    return sw;
  }

  // ---------- live updates ----------
  function listen() {
    state.events?.close();
    const es = new EventSource('/api/events');
    state.events = es;
    for (const timer of state.typing.values()) clearTimeout(timer);
    state.typing.clear();
    es.onmessage = async (e) => {
      const ev = JSON.parse(e.data);
      // typing only changes who shows as typing; nothing needs reloading
      if (ev.type === 'typing') { setTyping(ev.from, true); return; }
      if (ev.type === 'message' && !ev.group) setTyping(ev.from, false);
      // a message into the chat on screen is read there and then: no banner, nothing unread
      const into = ev.group ? 'g:' + ev.group.id : ev.from;
      const seen = ev.type === 'message' && into === state.chatWith && !document.hidden;
      if ((ev.type === 'snap' || ev.type === 'message') && !seen) setUnread(state.unread + 1);
      if (!seen) notify(ev);
      if (state.refresh) state.refresh();
    };
    // The browser reconnects a dropped stream by itself. One it has given up
    // on (the server says 204 once this browser is logged out, here or in
    // another tab) means: check who is logged in, and go on from there.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && state.events === es) recheckSession();
    };
  }
  async function recheckSession() {
    state.events = null;
    let user;
    try { ({ user } = await api('/api/session')); } catch { user = undefined; }
    if (!state.me || state.events) return; // logged out here meanwhile, or listening again
    if (user === null) renderWelcome(); // logged out elsewhere: nothing of theirs stays on screen
    else if (user && user.id !== state.me.id) location.reload(); // someone else has logged in on this browser
    else setTimeout(() => { if (state.me && !state.events) listen(); }, 5000); // still in: try the stream again
  }

  async function start(first = 'camera') {
    listen();
    if (first === 'camera') home(); else go(first); // draw straight away; the unread badge follows
    syncUnread();
  }

  (async () => {
    rememberDeepLink();
    try { state.me = (await api('/api/session')).user; } catch { state.me = null; }
    if (state.me) start(); else renderWelcome();
    hideSplash();
  })();
})();
