// Unit tests for controls.js keyboard/wheel logic with a tiny fake DOM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(pathname = '/u/status/1/mediaViewer') {
  const sent = [];
  const hooks = {};
  const list = { scrollHeight: 5000, clientHeight: 900, scrolled: [], scrollBy(o) { this.scrolled.push(o.top); } };
  const ctx = {
    window: null, location: { pathname }, innerHeight: 900, innerWidth: 799,
    document: { querySelectorAll: () => [], documentElement: {}, body: {},
      // no reel list in the fake DOM -> controls.js scrolls the page; record each move as 'SWIPE'
      scrollingElement: { scrollBy: (o) => sent.push({ type: 'SWIPE', direction: o.top > 0 ? 'next' : 'prev' }) } },
    addEventListener: () => {}, getComputedStyle: () => ({ overflowY: 'auto' }),
    localStorage: { getItem: () => null, setItem: () => {} }, history: { back: () => {} },
    chrome: { runtime: { id: 'x', sendMessage: async (m) => { sent.push(m); return { session: { mode: 'window' } }; } } },
    HTMLVideoElement: class {}, setTimeout, clearTimeout, Date, Promise, console, __XREELS_TEST__: hooks
  };
  ctx.window = ctx; ctx.window.top = ctx; ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controls.js'), 'utf8'), ctx);
  hooks.setActive(true);
  return { hooks, sent, list, ctx };
}
const key = (k, extra = {}) => ({ key: k, target: { isContentEditable: false, closest: () => null }, preventDefault() { this.p = true; }, stopImmediatePropagation() {}, ...extra });

test('typing in a reply box never triggers shortcuts', () => {
  const { hooks } = load();
  const e = key('ArrowDown', { target: { isContentEditable: false, closest: () => ({}) } });
  hooks.onKey(e);
  assert.equal(e.p, undefined);
});

test('shortcuts only inside the viewer, not on the timeline', () => {
  const { hooks } = load('/home');
  const e = key('ArrowDown');
  hooks.onKey(e);
  assert.equal(e.p, undefined);
});

test('modifier keys are left to the browser', () => {
  const { hooks } = load();
  const e = key('ArrowDown', { ctrlKey: true });
  hooks.onKey(e);
  assert.equal(e.p, undefined);
});

test('ArrowDown / ArrowUp / Space / M / Escape are handled in the viewer', () => {
  const { hooks } = load();
  for (const k of ['ArrowDown', 'ArrowUp', ' ', 'm', 'Escape', 'ArrowRight']) {
    const e = key(k);
    hooks.onKey(e);
    assert.equal(e.p, true, k);
  }
});

test('nav is debounced (~350ms): a burst of keys moves once', async () => {
  const { hooks, sent } = load();
  hooks.onKey(key('ArrowDown')); hooks.onKey(key('ArrowDown')); hooks.onKey(key('ArrowDown'));
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(sent.filter((m) => m.type === 'SWIPE').length, 1);
});

test('wheel: one flick = one reel, horizontal wheel ignored', async () => {
  const { hooks, sent } = load();
  const w = (dy, dx = 0) => ({ deltaY: dy, deltaX: dx, target: null, preventDefault() {}, stopImmediatePropagation() {} });
  for (let i = 0; i < 6; i += 1) hooks.onWheel(w(40));
  hooks.onWheel(w(0, 200));
  await new Promise((r) => setTimeout(r, 900));
  const swipes = sent.filter((m) => m.type === 'SWIPE');
  assert.equal(swipes.length, 1);
  assert.equal(swipes[0].direction, 'next');
});

const wheelEv = (dy, target = null) => ({ deltaY: dy, deltaX: 0, target, preventDefault() { this.p = true; }, stopImmediatePropagation() {} });

test('trackpad: a long stream of small deltas (with inertia) moves only one reel', async () => {
  const { hooks, sent } = load();
  for (let i = 0; i < 40; i += 1) { hooks.onWheel(wheelEv(8)); await new Promise((r) => setTimeout(r, 15)); } // ~600ms of scrolling
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(sent.filter((m) => m.type === 'SWIPE').length, 1);
});

test('two separate flicks move two reels', async () => {
  const { hooks, sent } = load();
  hooks.onWheel(wheelEv(100));
  await new Promise((r) => setTimeout(r, 1000));
  hooks.onWheel(wheelEv(100));
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(sent.filter((m) => m.type === 'SWIPE').length, 2);
});

test('wheel over the comments drawer scrolls the drawer, not the reels', async () => {
  const { hooks, sent } = load();
  const drawer = { nodeType: 1, scrollHeight: 2000, clientHeight: 400, getAttribute: () => null, parentElement: null };
  const comment = { nodeType: 1, scrollHeight: 50, clientHeight: 50, getAttribute: () => null, parentElement: drawer };
  // getComputedStyle in the fake DOM says overflowY:auto for everything; the comment itself does not overflow.
  const e = wheelEv(120, comment);
  hooks.onWheel(e);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(e.p, undefined, 'event left to the page');
});


test('M presses X\'s own mute button (setting video.muted alone is undone by X)', () => {
  const { hooks, ctx } = load();
  let clicks = 0;
  const rect = (w, h) => () => ({ width: w, height: h, top: 0, bottom: h, left: 0, right: w });
  const btn = { getAttribute: (a) => (a === 'aria-label' ? 'Unmute' : null), getBoundingClientRect: rect(40, 40), click: () => { clicks += 1; } };
  const player = { querySelectorAll: () => [btn], parentElement: null };
  const video = { muted: true, parentElement: player, querySelectorAll: () => [], getBoundingClientRect: rect(799, 800) };
  ctx.document.querySelectorAll = (q) => (q === 'video' ? [video] : []);
  hooks.onKey(key('m'));
  assert.equal(clicks, 1);
  assert.equal(video.muted, true, 'left to X');
});

test('M falls back to video.muted when X shows no mute button', () => {
  const { hooks, ctx } = load();
  const video = { muted: true, parentElement: null, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 799, height: 800, top: 0, bottom: 800 }) };
  ctx.document.querySelectorAll = (q) => (q === 'video' ? [video] : []);
  hooks.onKey(key('M'));
  assert.equal(video.muted, false);
});
