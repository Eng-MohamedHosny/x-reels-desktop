// X Reels Desktop — MAIN world, document_start, every X page.
// Does nothing unless this tab was switched on from the popup (marker kept in sessionStorage,
// which is per tab). The background adds the Android request headers (declarativeNetRequest);
// this script gives X's JavaScript the same Android identity, the centered 799px layout and
// keeps X's service worker away (it would serve the cached desktop app).
(() => {
  const S = window.__xrShims; delete window.__xrShims;
  const FX = window.__xrFx; delete window.__xrFx;
  if (!S || window.top !== window) return;
  const KEY = 'xr-free';
  let ss; try { ss = window.sessionStorage; } catch { return; }
  const url = new URL(location.href);
  const flag = url.searchParams.get('xrm');
  // The wave that opens the new page; 'xr-fx' survives the one service-worker reload below.
  const reveal = () => {
    const m = ss.getItem('xr-fx');
    if (m && FX) FX.reveal(m, () => ss.removeItem('xr-fx')); else ss.removeItem('xr-fx');
  };
  if (flag === 'off') {
    ss.removeItem(KEY); ss.removeItem('xr-swr');
    url.searchParams.delete('xrm'); url.searchParams.delete('xr');
    history.replaceState(history.state, '', url.href);
    ss.setItem('xr-fx', 'exit'); reveal();
    return;
  }
  if (flag === 'nd') { ss.setItem(KEY, '1'); ss.setItem('xr-fx', 'enter'); url.searchParams.delete('xrm'); history.replaceState(history.state, '', url.href); }
  if (ss.getItem(KEY) !== '1') return;

  // The page request carries the Android identity only when the URL has the ?xr= marker
  // (that is what the header rule matches), so a plain reload is redirected once to a marked URL.
  if (!url.searchParams.has('xr')) {
    url.searchParams.set('xr', Date.now().toString(36));
    location.replace(url.href);
    return;
  }

  reveal();
  S.uaShim(S.identity());
  S.centerShim(799);

  const sw = navigator.serviceWorker;
  if (sw) {
    try { sw.register = () => new Promise(() => {}); } catch (_) {}
    if (sw.controller) {
      // This load came from X's cached (desktop) app: remove the worker and load again, once.
      const last = +ss.getItem('xr-swr') || 0;
      sw.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then(() => {
        if (Date.now() - last < 15000) return; // no reload loop
        ss.setItem('xr-swr', String(Date.now()));
        url.searchParams.set('xr', Date.now().toString(36));
        location.replace(url.href);
      }).catch(() => {});
    }
  }
})();
