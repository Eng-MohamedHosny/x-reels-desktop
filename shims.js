// Shared by background.js (importScripts) and page-shim.js (MAIN world content script).
// Pure functions: background.js uses identity(); the page runs all three.
function identity() {
  const major = (navigator.userAgent.match(/(?:Chrome|Chromium|Edg)\/(\d+)/) || [])[1] || '130';
  const brands = [{ brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }, { brand: 'Not_A Brand', version: '99' }];
  return {
    userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`,
    platform: 'Linux armv8l',
    userAgentMetadata: {
      brands, fullVersionList: brands.map((b) => ({ brand: b.brand, version: `${b.version}.0.0.0` })),
      fullVersion: `${major}.0.0.0`, platform: 'Android', platformVersion: '14.0.0',
      architecture: 'arm', model: 'Pixel 8', mobile: true, bitness: '64', wow64: false
    }
  };
}

function centerShim(W) {
  const def = (o, n, get) => { try { Object.defineProperty(o, n, { configurable: true, get }); } catch (_) {} };
  def(window, 'innerWidth', () => W); def(window, 'outerWidth', () => W);
  def(screen, 'width', () => W); def(screen, 'availWidth', () => W);
  if (window.visualViewport) def(window.visualViewport, 'width', () => W);
  const cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true,
    get() { return this === document.documentElement ? W : cw.get.call(this); } });
  // X's viewer also measured the root element directly, so hide the real width from the
  // other ways a page can measure the root element.
  const gbr = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = gbr.call(this);
    return this === document.documentElement ? new DOMRect(r.x, r.y, W, r.height) : r;
  };
  const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true,
    get() { return this === document.documentElement ? W : ow.get.call(this); } });
  const RO = window.ResizeObserver;
  if (RO) window.ResizeObserver = class extends RO {
    constructor(cb) {
      super((entries, obs) => cb(entries.map((e) => (e.target === document.documentElement || e.target === document.body
        ? { target: e.target, contentRect: new DOMRect(0, 0, W, e.contentRect.height),
          borderBoxSize: [{ inlineSize: W, blockSize: e.contentRect.height }], contentBoxSize: [{ inlineSize: W, blockSize: e.contentRect.height }] }
        : e)), obs));
    }
  };
  const mm = window.matchMedia.bind(window);
  window.matchMedia = function (q) {
    const c = String(q).replace(/\s+/g, '').toLowerCase(); let f = null;
    for (const m of c.matchAll(/\((min|max)-width:(\d+(?:\.\d+)?)px\)/g)) { const v = +m[2]; const r = m[1] === 'min' ? W >= v : W <= v; f = f === null ? r : f && r; }
    const res = mm(q);
    if (f !== null) { try { Object.defineProperty(res, 'matches', { configurable: true, value: f }); } catch (_) {} }
    return res;
  };
  const css = `html{background:#000!important;overflow-x:hidden!important}
body,#react-root{width:${W}px!important;min-width:${W}px!important;max-width:${W}px!important;margin-left:auto!important;margin-right:auto!important}
#layers{position:fixed!important;top:0!important;bottom:0!important;left:calc(50% - ${W / 2}px)!important;width:${W}px!important;transform:translateZ(0)!important;pointer-events:none!important}
#layers>*{pointer-events:auto}`;
  // Inside X's viewer route, make #react-root the box that fixed-position children are laid out in
  // (a transform does that), so the viewer is 799px wide and centered instead of running to the right edge.
  const css2 = `html.xr-viewer,html.xr-viewer body{overflow:hidden!important}
html.xr-viewer #react-root *{max-width:100%!important}
html.xr-viewer #react-root [role="group"]{width:100%!important;left:0!important;right:0!important}
#layers [role="group"]{width:100%!important;left:0!important;right:0!important;max-width:100%!important}
html.xr-viewer #react-root{position:fixed!important;top:0!important;bottom:0!important;left:calc(50% - ${W / 2}px)!important;height:100vh!important;transform:translateZ(0)!important;overflow:hidden!important}`;
  const route = () => document.documentElement?.classList.toggle('xr-viewer', /\/mediaviewer\b/i.test(location.pathname));
  for (const k of ['pushState', 'replaceState']) { const o = history[k]; history[k] = function () { const r = o.apply(this, arguments); route(); return r; }; }
  addEventListener('popstate', route);
  route();
  const add = () => { route(); if (document.getElementById('xr-center')) return; const st = document.createElement('style'); st.id = 'xr-center'; st.textContent = css + css2; (document.head || document.documentElement).appendChild(st); };
  if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true });
  document.addEventListener('DOMContentLoaded', add, { once: true });
}

function uaShim(id) {
  const def = (o, n, v) => { try { Object.defineProperty(o, n, { configurable: true, get: () => v }); } catch (_) {} };
  const m = id.userAgentMetadata;
  const data = { brands: m.brands, mobile: true, platform: 'Android',
    getHighEntropyValues: async (h) => { const v = { ...m, uaFullVersion: m.fullVersion }; return Object.fromEntries([['brands', m.brands], ['mobile', true], ['platform', 'Android'], ...(h || []).filter((k) => k in v).map((k) => [k, v[k]])]); },
    toJSON: () => ({ brands: m.brands, mobile: true, platform: 'Android' }) };
  def(Navigator.prototype, 'userAgent', id.userAgent);
  def(Navigator.prototype, 'appVersion', id.userAgent.replace(/^Mozilla\//, ''));
  def(Navigator.prototype, 'platform', id.platform);
  def(Navigator.prototype, 'userAgentData', data);
}

// In a page (MAIN world) hand the functions to page-shim.js, which removes this global again.
if (typeof window !== 'undefined' && typeof importScripts !== 'function') window.__xrShims = { identity, centerShim, uaShim };
