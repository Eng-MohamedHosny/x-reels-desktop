// X Reels Desktop — background service worker (Manifest V3).
//
// X shows its own mobile Reels viewer when it believes it runs on an Android phone and its service
// worker (which caches the desktop app) is out of the way. No chrome.debugger is needed:
//   - declarativeNetRequest session rules send an Android User-Agent + client hints;
//   - page-shim.js (MAIN world) gives X's JavaScript the same identity, a centered 799px layout,
//     and keeps the service worker away.
// Session state lives in chrome.storage.session so it survives the worker going idle.

importScripts('shims.js'); // identity()

const KEY = 'sessions'; // storage.session: { [tabId]: { since } }
const NAV_RULE = 1;     // shared: page loads whose URL carries the ?xr= marker

const isX = (url) => {
  try {
    const { protocol, hostname: h } = new URL(url);
    return protocol === 'https:' && (h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com'));
  } catch { return false; }
};
const marked = (u, mode) => {
  const x = new URL(u);
  if (mode === 'off') { x.searchParams.delete('xr'); x.searchParams.set('xrm', 'off'); }
  else { x.searchParams.set('xr', Date.now().toString(36)); x.searchParams.set('xrm', 'nd'); }
  return x.href;
};

// ---------- state ----------
async function sessions() { return (await chrome.storage.session.get(KEY))[KEY] || {}; }
let chain = Promise.resolve();
function mutate(fn) {
  chain = chain.catch(() => {}).then(async () => {
    const all = await sessions();
    const out = await fn(all);
    await chrome.storage.session.set({ [KEY]: all });
    return out;
  });
  return chain;
}
async function getSession(tabId) { return (await sessions())[tabId] || null; }
// Toolbar indicator: the icon turns X-blue in a tab where Reels is on.
const ICON_OFF = { 16: 'icons/icon16.png', 32: 'icons/icon32.png' };
const ICON_ON = { 16: 'icons/on16.png', 32: 'icons/on32.png' };
async function setBadge(tabId, on) {
  await chrome.action.setIcon({ tabId, path: on ? ICON_ON : ICON_OFF }).catch(() => {});
  await chrome.action.setTitle({ tabId, title: on ? 'X Reels: on in this tab' : 'X Reels' }).catch(() => {});
}

// ---------- request rules ----------
function androidHeaders() {
  const id = identity();
  return { type: 'modifyHeaders', requestHeaders: [
    { header: 'User-Agent', operation: 'set', value: id.userAgent },
    { header: 'Sec-CH-UA-Mobile', operation: 'set', value: '?1' },
    { header: 'Sec-CH-UA-Platform', operation: 'set', value: '"Android"' },
    { header: 'Sec-CH-UA-Model', operation: 'set', value: '"Pixel 8"' },
    // High-entropy hints: otherwise Chrome would send the real desktop values when X asks for them.
    { header: 'Sec-CH-UA-Platform-Version', operation: 'set', value: '"14.0.0"' },
    { header: 'Sec-CH-UA-Arch', operation: 'set', value: '""' },
    { header: 'Sec-CH-UA-Bitness', operation: 'set', value: '"64"' },
    { header: 'Sec-CH-UA-WoW64', operation: 'set', value: '?0' },
    { header: 'Sec-CH-UA-Form-Factors', operation: 'set', value: '"Mobile"' }] };
}
const tabRule = (tabId) => (tabId % 1000000) * 2 + 10;  // requests made by the tab
const swRule = (tabId) => tabRule(tabId) + 1;           // X's service worker script, blocked
async function setRules(tabId, on) {
  const action = androidHeaders();
  const add = on ? [
    { id: tabRule(tabId), priority: 1, action,
      condition: { tabIds: [tabId], requestDomains: ['x.com', 'twitter.com', 'twimg.com', 'pscp.tv', 'periscope.tv'] } },
    { id: swRule(tabId), priority: 2, action: { type: 'block' },
      condition: { tabIds: [tabId], regexFilter: '^https://(x|twitter)\\.com/sw\\.js', resourceTypes: ['other', 'script', 'xmlhttprequest'] } },
    // A tabIds rule does not match the page load itself, so page loads are matched by the URL marker.
    { id: NAV_RULE, priority: 1, action,
      condition: { regexFilter: '^https://(x|twitter)\\.com/[^#]*[?&]xr=', resourceTypes: ['main_frame'] } }
  ] : [];
  const remove = [tabRule(tabId), swRule(tabId)];
  if (!on && Object.keys(await sessions()).length === 0) remove.push(NAV_RULE);
  if (on) remove.push(NAV_RULE);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: remove, addRules: add });
}

// ---------- actions ----------
// The old page plays the first half of the wave; navigate when it is done (or after a short wait).
const FX_MS = 460;
const preFx = (tabId, mode) => Promise.race([
  chrome.tabs.sendMessage?.(tabId, { type: 'FX_PRE', mode, ms: FX_MS }).catch(() => null),
  new Promise((r) => setTimeout(r, FX_MS + 250))
]);

async function enable(tabId, { reload = true, fx = true } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!isX(tab.url)) throw new Error('Open an X tab first.');
  await mutate((all) => { all[tabId] = { since: Date.now() }; });
  await setRules(tabId, true);
  await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' }).catch(() => {});
  await chrome.tabs.setZoom(tabId, 1).catch(() => {}); // a saved x.com zoom would change the 799px layout
  if (reload && fx) await preFx(tabId, 'enter');
  if (reload) await chrome.tabs.update(tabId, { url: marked(tab.url, 'on') });
  await setBadge(tabId, true);
  return { tabId };
}

async function disable(tabId, { navigate = true } = {}) {
  const was = await getSession(tabId);
  await mutate((all) => { delete all[tabId]; });
  await setRules(tabId, false).catch(() => {});
  await setBadge(tabId, false);
  if (!was || !navigate) return;
  await chrome.tabs.setZoom(tabId, 0).catch(() => {});
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (t && isX(t.url)) await preFx(tabId, 'exit');
  if (t && isX(t.url)) await chrome.tabs.update(tabId, { url: marked(t.url, 'off') }).catch(() => {});
}

// ---------- keeping things right ----------
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading' && (await getSession(tabId))) setBadge(tabId, true);
  if (!info.url || !(await getSession(tabId))) return;
  if (/^https?:/.test(info.url) && !isX(info.url)) return disable(tabId, { navigate: false }); // left X
});
chrome.tabs.onRemoved.addListener((tabId) => { disable(tabId, { navigate: false }); });
chrome.runtime.onStartup.addListener(() => chrome.storage.session.set({ [KEY]: {} }));

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const fromTab = sender.tab?.id;
    switch (msg?.type) {
      case 'ENABLE': return enable(msg.tabId);
      case 'DISABLE': await disable(msg.tabId ?? fromTab); return { ok: true };
      case 'STATUS': {
        const tabId = msg.tabId ?? fromTab;
        return { session: tabId != null ? await getSession(tabId) : null, version: chrome.runtime.getManifest().version };
      }
      // A Reels tab came back without its rules (browser restart, extension reload): switch it on again.
      case 'RESUME':
        if (fromTab == null || (await getSession(fromTab))) return { ok: false };
        await enable(fromTab, { fx: false }); return { ok: true };
      default: return null;
    }
  })().then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true;
});

if (typeof globalThis.__XREELS_TEST__ === 'object') Object.assign(globalThis.__XREELS_TEST__, { enable, disable, sessions, isX, marked });
