const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const isX = (u) => { try { return /(^|\.)(x|twitter)\.com$/.test(new URL(u).hostname); } catch { return false; } };
const body = document.body;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The press effect: the orb pulls in (anticipation), then chromatic waves, sparks and an edge glow.
// Turning on, the waves run out from the orb; turning off, they fall back into it.
async function pressFx(out) {
  if (reduced) return;
  const orb = $('orb');
  // Chrome sizes the popup to its content, so the effect lives in a fixed layer that cannot grow it,
  // and the page size is pinned while it plays.
  const root = document.documentElement;
  const b = { width: root.clientWidth, height: root.clientHeight };
  root.style.width = b.width + 'px'; root.style.height = b.height + 'px';
  const layer = document.createElement('div'); layer.className = 'fx-layer'; body.append(layer);
  const o = orb.getBoundingClientRect();
  const cx = o.left + o.width / 2; const cy = o.top + o.height / 2;
  const far = Math.hypot(Math.max(cx, b.width - cx), Math.max(cy, b.height - cy)) * 2 + 40;
  body.classList.add('fx');
  orb.animate([{ transform: 'scale(1)' }, { transform: 'scale(.84)', offset: 0.3 }, { transform: 'scale(1.1)', offset: 0.55 }, { transform: 'scale(1)' }],
    { duration: 620, easing: 'cubic-bezier(.3,0,.2,1)' });
  const glow = document.createElement('div'); glow.className = 'edge-glow'; layer.append(glow);
  glow.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });

  const c = document.createElement('canvas'); c.id = 'fx'; layer.append(c);
  const dpr = devicePixelRatio || 1; c.width = b.width * dpr; c.height = b.height * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const sparks = Array.from({ length: 46 }, () => {
    const a = Math.random() * Math.PI * 2; const v = 2 + Math.random() * 4.5; const d = out ? 46 : far / 2.2;
    return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, a, v: out ? v : -v * 0.9, life: 1, s: 0.8 + Math.random() * 1.8 };
  });
  await wait(180); // anticipation: the orb is pulled in first
  for (let i = 0; i < 3; i += 1) {
    const w = document.createElement('div'); w.className = 'wv';
    w.style.left = cx + 'px'; w.style.top = cy + 'px'; w.style.setProperty('--d', far + 'px');
    layer.append(w);
    const from = { transform: `scale(${out ? 0.1 : 1})`, opacity: out ? 1 : 0 };
    const to = { transform: `scale(${out ? 1 : 0.1})`, opacity: out ? 0 : 1 };
    w.animate([from, { opacity: 0.9, offset: 0.3 }, to], { duration: 560, delay: i * 90, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' })
      .finished.then(() => w.remove());
  }
  const t0 = performance.now();
  await new Promise((done) => {
    const tick = (now) => {
      g.clearRect(0, 0, b.width, b.height); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      for (const p of sparks) {
        if (p.life <= 0) continue;
        p.x += Math.cos(p.a) * p.v; p.y += Math.sin(p.a) * p.v; p.v *= 0.97; p.life -= 0.03;
        g.strokeStyle = `rgba(${p.s > 2 ? '220,240,255' : '29,155,240'},${Math.max(0, p.life)})`; g.lineWidth = p.s;
        g.beginPath(); g.moveTo(p.x - Math.cos(p.a) * p.v * 4, p.y - Math.sin(p.a) * p.v * 4); g.lineTo(p.x, p.y); g.stroke();
      }
      if (now - t0 < 560) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  await wait(120);
  layer.remove(); root.style.width = ''; root.style.height = ''; body.classList.remove('fx');
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const st = await send({ type: 'STATUS', tabId: tab?.id });
  const on = !!st?.session;
  $('ver').textContent = chrome.runtime.getManifest().version.replace(/\.0$/, '');

  body.classList.toggle('on', on);
  $('label').textContent = on ? 'Exit Reels' : 'Watch Reels';
  $('orb').setAttribute('aria-label', on ? 'Exit Reels' : 'Watch Reels');
  $('status').textContent = on ? 'Reels is on in this tab' : 'Off in this tab';
  if (!on && (!tab || !isX(tab.url))) { body.classList.add('disabled'); $('status').textContent = 'Open x.com in this tab first'; }

  let busy = false;
  const toggle = async (want) => {
    if (want === on || busy) return;
    busy = true;
    // The press effect runs while the request goes out, so the page's own wave follows right after it.
    const fx = pressFx(want);
    await wait(reduced ? 0 : 240);
    const r = await send({ type: want ? 'ENABLE' : 'DISABLE', tabId: tab.id });
    await fx;
    if (r?.error) { $('status').textContent = r.error; busy = false; } else window.close();
  };
  $('orb').onclick = () => toggle(!on);

  const showKeys = (show) => { $('keys').hidden = !show; $('main').hidden = show; $('kbtn').setAttribute('aria-pressed', String(show)); };
  $('kbtn').onclick = () => showKeys($('keys').hidden);
  $('done').onclick = () => showKeys(false);
})();
