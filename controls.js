// X Reels Desktop — desktop controls for X's own Reels viewer.
// Active only in tabs the extension turned into a Reels session.
// X's viewer is a vertical scroll-snap list (one reel per screen), so "next" = scroll it
// by one screen.
(function () {
  if (window.top !== window) return;

  const NAV_DEBOUNCE_MS = 350;
  const SEEK_SECONDS = 5;
  let active = false;
  let lastNav = 0;
  let wheelAccum = 0;
  let wheelTimer = null;

  const safeSend = (msg) => {
    try { return chrome.runtime?.id ? chrome.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null); }
    catch { return Promise.resolve(null); }
  };

  // ---------- what's on screen ----------
  function inViewer() { return /\/mediaViewer\b/i.test(location.pathname); }
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40 && r.bottom > 0 && r.top < innerHeight;
  }
  function currentVideo() {
    let best = null; let bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      if (!isVisible(v)) continue;
      const r = v.getBoundingClientRect();
      const visibleH = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      const score = visibleH * r.width;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }
  function reelList() {
    for (let n = currentVideo()?.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 10) return n;
    }
    return null;
  }
  const videoId = (v) => (v ? (v.getAttribute('poster') || '') + '|' + (v.currentSrc || v.src || '') : null);

  // ---------- actions ----------
  async function go(direction) {
    const now = Date.now();
    if (now - lastNav < NAV_DEBOUNCE_MS) return;
    lastNav = now;
    const before = videoId(currentVideo());
    const list = reelList();
    if (list) list.scrollBy({ top: (direction === 'next' ? 1 : -1) * list.clientHeight, behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 700));
    if (videoId(currentVideo()) === before) { // no scroll container found: scroll the page itself
      (document.scrollingElement || document.documentElement).scrollBy({ top: (direction === 'next' ? 1 : -1) * innerHeight, behavior: 'smooth' });
    }
  }
  function togglePlay() {
    const v = currentVideo();
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }
  // X's player keeps its own mute state and puts it back on the <video> when it re-renders,
  // so setting video.muted alone does nothing (seen on real X). Press X's own mute button instead;
  // X then also keeps the choice for the next reels. Labels cover English and Arabic X.
  const MUTE_LABEL = /^(mute|unmute)$|كتم|الصوت/i;
  function muteButton(v) {
    let n = v;
    for (let depth = 0; n && depth < 12; depth += 1, n = n.parentElement) {
      const b = [...n.querySelectorAll('button, [role="button"]')].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && MUTE_LABEL.test((el.getAttribute('aria-label') || '').trim());
      });
      if (b) return b;
    }
    return null;
  }
  function toggleMute() {
    const v = currentVideo();
    if (!v) return;
    const b = muteButton(v);
    if (b) b.click(); else v.muted = !v.muted;
  }
  function seek(delta) {
    const v = currentVideo();
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta));
  }
  function closeViewer() {
    const close = [...document.querySelectorAll('[role="button"], button')]
      .find((b) => isVisible(b) && /^(close|back)$/i.test((b.getAttribute('aria-label') || '').trim()));
    if (close) close.click(); else history.back();
  }

  // ---------- input ----------
  function typing(e) {
    const t = e.target;
    if (!t || t === document.body) return false;
    if (t.isContentEditable) return true;
    return !!t.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  }
  const KEYS = {
    ArrowDown: () => go('next'), PageDown: () => go('next'), j: () => go('next'),
    ArrowUp: () => go('prev'), PageUp: () => go('prev'), k: () => go('prev'),
    ' ': togglePlay, m: toggleMute, M: toggleMute,
    ArrowRight: () => seek(SEEK_SECONDS), ArrowLeft: () => seek(-SEEK_SECONDS),
    Escape: closeViewer
  };
  function onKey(e) {
    if (!active || !inViewer() || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typing(e)) return;
    const action = KEYS[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }
  // One reel per wheel "flick". A trackpad sends a long stream of small deltas (plus inertia),
  // so: sum deltas until a threshold, move once, then swallow the rest of that gesture
  // (until the stream pauses for GESTURE_GAP_MS) and keep a short cooldown after it.
  const GESTURE_GAP_MS = 220;
  const WHEEL_COOLDOWN_MS = 400;
  let lastWheel = 0;
  let gestureUsed = false;
  let cooldownUntil = 0;
  // The wheel over the comments drawer, a dialog or any other inner scroller scrolls THAT, not the reels.
  function overOtherScroller(e) {
    const list = reelList();
    for (let n = e.target; n && n.nodeType === 1 && n !== document.documentElement && n !== document.body; n = n.parentElement) {
      if (list && n === list) return false;
      if (n.getAttribute?.('role') === 'dialog' && !(list && n.contains?.(list))) return true;
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) return true;
    }
    return false;
  }
  function onWheel(e) {
    if (!active || !inViewer() || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    if (overOtherScroller(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const now = Date.now();
    const newGesture = now - lastWheel > GESTURE_GAP_MS;
    lastWheel = now;
    if (newGesture) { gestureUsed = false; wheelAccum = 0; }
    if (gestureUsed || now < cooldownUntil) return; // rest of the same flick / inertia
    // A line-mode mouse wheel (deltaMode 1) reports ~3 per notch: scale to pixels.
    wheelAccum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    clearTimeout(wheelTimer);
    const fire = () => {
      const d = wheelAccum > 0 ? 'next' : 'prev';
      wheelAccum = 0; gestureUsed = true; cooldownUntil = Date.now() + WHEEL_COOLDOWN_MS;
      go(d);
    };
    if (Math.abs(wheelAccum) >= 60) { fire(); return; }
    wheelTimer = setTimeout(() => { if (Math.abs(wheelAccum) >= 15) fire(); else wheelAccum = 0; }, 120);
  }
  // The background asks the old page to play the first half of the wave before it navigates.
  try {
    chrome.runtime.onMessage.addListener((msg, _s, reply) => {
      if (msg?.type !== 'FX_PRE') return;
      document.dispatchEvent(new CustomEvent('xr-fx', { detail: msg.mode }));
      setTimeout(() => reply({ ok: true }), msg.ms || 460);
      return true;
    });
  } catch (_) {}

  addEventListener('keydown', onKey, true);
  addEventListener('wheel', onWheel, { capture: true, passive: false });

  safeSend({ type: 'STATUS' }).then((r) => {
    active = !!r?.session;
    // page-shim.js keeps this tab in Reels mode across reloads; if the rules are gone
    // (browser restart, extension update), ask the background to switch the tab on again.
    let flagged = false; try { flagged = sessionStorage.getItem('xr-free') === '1'; } catch (_) {}
    if (!active && flagged && r) safeSend({ type: 'RESUME' });
  });

  if (typeof globalThis.__XREELS_TEST__ === 'object') Object.assign(globalThis.__XREELS_TEST__, { onKey, onWheel, overOtherScroller, typing, go, setActive: (v) => { active = v; }, KEYS });
})();
