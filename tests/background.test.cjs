// Unit tests for background.js with a mocked chrome API. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const calls = [];
  const store = { session: {} };
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const tabs = new Map();
  let rules = new Map();
  const chrome = {
    storage: { session: {
      get: async (k) => ({ [k]: store.session[k] }),
      set: async (o) => { Object.assign(store.session, JSON.parse(JSON.stringify(o))); }
    } },
    action: { setIcon: async (o) => calls.push(['setIcon', o]), setTitle: async () => {} },
    tabs: {
      get: async (id) => { if (!tabs.has(id)) throw new Error('no tab'); return tabs.get(id); },
      update: async (id, o) => { Object.assign(tabs.get(id), o); calls.push(['tabs.update', o.url]); },
      setZoom: async () => {}, setZoomSettings: async () => {},
      onUpdated: on('updated'), onRemoved: on('removed')
    },
    declarativeNetRequest: { updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
      for (const id of removeRuleIds) rules.delete(id);
      for (const r of addRules) { if (rules.has(r.id)) throw new Error('duplicate rule id ' + r.id); rules.set(r.id, r); }
    } },
    runtime: { onMessage: on('message'), onStartup: on('startup'), getManifest: () => ({ version: 'test' }) }
  };
  const hooks = {};
  const ctx = { chrome, navigator: { userAgent: 'Mozilla/5.0 Chrome/157.0.0.0' }, setTimeout, console, URL, Promise, Date, __XREELS_TEST__: hooks };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), ctx);
  const send = (msg, sender = {}) => new Promise((r) => listeners.message(msg, sender, r));
  return { hooks, calls, store, listeners, tabs, rules: () => rules, send };
}
const xTab = (t, id = 7, url = 'https://x.com/home') => t.tabs.set(id, { id, url });

test('enable: Android headers for the tab, page loads matched by the ?xr= marker, SW blocked, page reloaded marked', async () => {
  const t = load(); xTab(t);
  await t.send({ type: 'ENABLE', tabId: 7 });
  const rules = [...t.rules().values()];
  const nav = rules.find((r) => r.condition.resourceTypes?.includes('main_frame'));
  assert.match(nav.condition.regexFilter, /xr=/);
  const tabRule = rules.find((r) => r.condition.tabIds?.includes(7) && r.action.type === 'modifyHeaders');
  const ua = tabRule.action.requestHeaders.find((h) => h.header === 'User-Agent').value;
  assert.match(ua, /Android.*Chrome\/157.*Mobile Safari/);
  assert.ok(rules.some((r) => r.action.type === 'block' && /sw\\\.js/.test(r.condition.regexFilter)));
  const url = t.calls.find((c) => c[0] === 'tabs.update')[1];
  assert.match(url, /xr=/); assert.match(url, /xrm=nd/);
  assert.ok(t.store.session.sessions[7]);
});

test('enable refuses a non-X tab', async () => {
  const t = load(); xTab(t, 7, 'https://example.com/');
  const r = await t.send({ type: 'ENABLE', tabId: 7 });
  assert.match(r.error, /X tab/);
  assert.equal(t.rules().size, 0);
});

test('two Reels tabs: rules do not collide; exiting one keeps the other working', async () => {
  const t = load(); xTab(t, 7); xTab(t, 8);
  await t.send({ type: 'ENABLE', tabId: 7 });
  await t.send({ type: 'ENABLE', tabId: 8 });
  await t.send({ type: 'DISABLE', tabId: 7 });
  const rules = [...t.rules().values()];
  assert.ok(rules.some((r) => r.condition.tabIds?.includes(8)));
  assert.ok(!rules.some((r) => r.condition.tabIds?.includes(7)));
  assert.ok(rules.some((r) => r.condition.resourceTypes?.includes('main_frame')), 'page-load rule kept for tab 8');
});

test('exit: all rules removed, page loaded with ?xrm=off so page-shim forgets the tab', async () => {
  const t = load(); xTab(t);
  await t.send({ type: 'ENABLE', tabId: 7 });
  t.tabs.get(7).url = 'https://x.com/alice/status/1/mediaviewer?xr=abc';
  await t.send({ type: 'DISABLE', tabId: 7 });
  assert.equal(t.rules().size, 0);
  const url = t.calls.filter((c) => c[0] === 'tabs.update').pop()[1];
  assert.match(url, /xrm=off/); assert.doesNotMatch(url, /xr=/);
  assert.equal((await t.send({ type: 'STATUS', tabId: 7 })).session, null);
});

test('leaving X or closing the tab ends the session without navigating', async () => {
  const t = load(); xTab(t);
  await t.send({ type: 'ENABLE', tabId: 7 });
  const nav = () => t.calls.filter((c) => c[0] === 'tabs.update').length;
  const n = nav();
  await t.listeners.updated(7, { url: 'https://example.com/' });
  assert.equal(t.rules().size, 0);
  assert.equal(nav(), n);
});

test('RESUME switches a flagged tab back on, once', async () => {
  const t = load(); xTab(t);
  assert.deepEqual(await t.send({ type: 'RESUME' }, { tab: { id: 7 } }), { ok: true });
  assert.deepEqual(await t.send({ type: 'RESUME' }, { tab: { id: 7 } }), { ok: false });
});

test('toolbar icon turns blue in a Reels tab and back on exit', async () => {
  const t = load(); xTab(t);
  await t.send({ type: 'ENABLE', tabId: 7 });
  assert.match(t.calls.filter((c) => c[0] === 'setIcon').pop()[1].path[16], /on16/);
  await t.send({ type: 'DISABLE', tabId: 7 });
  assert.match(t.calls.filter((c) => c[0] === 'setIcon').pop()[1].path[16], /icon16/);
});
