// End-to-end check of the real extension against a MOCK x.com (no account, no network).
// x.com is mapped to a local HTTPS server that serves a fake scroll-snap Reels viewer.
// It proves the plumbing (Android identity, centering, reload, exit, keys, wheel, drawer, typing guard);
// it does NOT prove that real X shows its viewer (that is the manual checklist in README).
// Run (Linux needs a display, e.g. xvfb-run):  node tests/e2e/mock-x.e2e.cjs
const { chromium } = require('playwright');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');

const EXT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xreels-e2e-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=x.com',
  '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });

const reels = Array.from({ length: 6 }, (_, i) =>
  `<section class="reel"><video poster="/p${i}.png" muted playsinline></video><b>Reel ${i}</b></section>`).join('');
const VIEWER = `<!doctype html><meta name="viewport" content="width=device-width">
<style>html,body{margin:0;height:100%;background:#000;color:#fff;font:20px sans-serif}
#list{height:100vh;overflow-y:auto;scroll-snap-type:y mandatory}
.reel{height:100vh;scroll-snap-align:start;position:relative}
video{width:100%;height:80%;background:#222;display:block}
#drawer{position:fixed;left:0;right:0;bottom:0;height:35vh;overflow-y:auto;background:#111;display:none}
#drawer p{height:60px;margin:0}
#reply{position:fixed;top:4px;left:4px}</style>
<div id="list">${reels}</div>
<div id="drawer">${'<p>comment</p>'.repeat(40)}</div>
<input id="reply" placeholder="reply">`;
const HOME = `<!doctype html><meta name="viewport" content="width=device-width"><a href="/u/status/1/mediaViewer">reels</a>`;

const seen = []; // [url, user-agent] of page loads, to check what identity the "server" got
const server = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (req, res) => {
  if (!/\.(png|json|js)$/.test(req.url)) seen.push([req.url, req.headers['user-agent'] || '']);
  if (req.url.endsWith('.png')) { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(/mediaViewer/.test(req.url) ? VIEWER : HOME);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    headless: false, viewport: null,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP x.com 127.0.0.1:${port}`,
      '--ignore-certificate-errors', '--no-proxy-server', '--window-size=1920,1040', '--window-position=0,0']
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${extId}/popup/popup.html`);
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
  };

  const page = await ctx.newPage();
  await page.goto('https://x.com/u/status/1/mediaViewer');
  const tabId = await ui.evaluate(async () => (await chrome.tabs.query({ url: 'https://x.com/*' })).pop().id);
  seen.length = 0;
  const en = await ui.evaluate((id) => chrome.runtime.sendMessage({ type: 'ENABLE', tabId: id }), tabId);
  await check('enable answers without error', async () => assert.ok(!en?.error, JSON.stringify(en)));
  await page.waitForURL(/xr=/); await page.waitForSelector('#list'); await page.waitForTimeout(800);

  await check('no debugger is used', async () => {
    const t = await ui.evaluate(async () => (await chrome.debugger?.getTargets?.() || []).filter((x) => x.attached && x.extensionId === chrome.runtime.id).length);
    assert.equal(t, 0);
  });
  await check('the page load sent the Android identity', async () => {
    assert.ok(seen.length && /Android/.test(seen[seen.length - 1][1]), JSON.stringify(seen));
  });
  await check('X sees an Android phone, 799px wide, app centered in the wide tab', async () => {
    const env = await page.evaluate(() => {
      const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;right:0;top:0;height:1px'; document.documentElement.appendChild(probe); const real = probe.getBoundingClientRect().width; probe.remove();
      const b = document.body.getBoundingClientRect();
      return { w: innerWidth, real, left: b.left, right: real - b.right, width: b.width, ua: navigator.userAgent, mob: navigator.userAgentData?.mobile,
        max: matchMedia('(max-width: 799px)').matches, url: location.href };
    });
    assert.equal(env.w, 799); assert.ok(env.real > 1000, 'tab really wide: ' + env.real);
    assert.equal(Math.round(env.width), 799); assert.ok(Math.abs(env.left - env.right) <= 2, JSON.stringify(env));
    assert.match(env.ua, /Android .*Mobile Safari/); assert.equal(env.mob, true); assert.ok(env.max);
    assert.doesNotMatch(env.url, /xrm=/);
  });

  const top = () => page.evaluate(() => Math.round(document.getElementById('list').scrollTop / innerHeight));
  await page.bringToFront();
  await check('ArrowDown moves to the next reel, ArrowUp back', async () => {
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1000); assert.equal(await top(), 1);
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(1000); assert.equal(await top(), 0);
  });
  await check('a burst of 3 ArrowDown presses moves once (debounce)', async () => {
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(1200); assert.equal(await top(), 1);
  });
  await check('trackpad-like wheel stream (40 small deltas) moves one reel', async () => {
    await page.mouse.move(960, 300);
    for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, 8); await page.waitForTimeout(12); }
    await page.waitForTimeout(1200); assert.equal(await top(), 2);
  });
  await check('typing in a reply box: ArrowDown does not change reel', async () => {
    await page.focus('#reply'); await page.keyboard.type('hi'); await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(1000); assert.equal(await top(), 2);
    assert.equal(await page.inputValue('#reply'), 'hi');
  });
  await check('wheel over the comments drawer scrolls the drawer, not the reels', async () => {
    await page.evaluate(() => { document.activeElement.blur(); document.getElementById('drawer').style.display = 'block'; });
    const box = await page.locator('#drawer').boundingBox();
    await page.mouse.move(box.x + 100, box.y + 50);
    await page.mouse.wheel(0, 300); await page.waitForTimeout(1000);
    assert.equal(await top(), 2);
    assert.ok(await page.evaluate(() => document.getElementById('drawer').scrollTop) > 0, 'drawer scrolled');
  });
  await check('a plain reload stays in Reels mode', async () => {
    await page.evaluate(() => { const u = new URL(location.href); u.searchParams.delete('xr'); history.replaceState(null, '', u.href); });
    seen.length = 0;
    await page.reload(); await page.waitForURL(/xr=/); await page.waitForSelector('#list'); await page.waitForTimeout(500);
    assert.ok(/Android/.test(seen[seen.length - 1][1]), JSON.stringify(seen));
    assert.equal(await page.evaluate(() => innerWidth), 799);
  });
  await check('Exit returns the tab to desktop X', async () => {
    await ui.evaluate((id) => chrome.runtime.sendMessage({ type: 'DISABLE', tabId: id }), tabId);
    await page.waitForURL((u) => !/xr/.test(u.search)); await page.waitForTimeout(800);
    const env = await page.evaluate(() => ({ ua: navigator.userAgent, w: innerWidth }));
    assert.doesNotMatch(env.ua, /Android/); assert.ok(env.w > 1000, JSON.stringify(env));
    const st = await ui.evaluate((id) => chrome.runtime.sendMessage({ type: 'STATUS', tabId: id }), tabId);
    assert.equal(st.session, null);
  });
  await check('after Exit a reload stays desktop', async () => {
    seen.length = 0; await page.reload(); await page.waitForTimeout(800);
    assert.doesNotMatch(seen[seen.length - 1][1], /Android/);
    assert.doesNotMatch(await page.evaluate(() => navigator.userAgent), /Android/);
  });

  for (const r of results) console.log(r.join('  '));
  await ctx.close(); server.close();
  process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
