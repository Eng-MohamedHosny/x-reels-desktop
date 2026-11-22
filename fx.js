// X Reels Desktop — the wave transition shown when a tab enters or leaves Reels mode.
// MAIN world, document_start. page-shim.js takes window.__xrFx; the old page plays the
// "cover" half when controls.js forwards the background's FX_PRE (as an 'xr-fx' DOM event),
// the new page plays the "reveal" half once X has drawn something.
//   enter: a wave closes in from the edges, then opens from the center.
//   exit:  a wave grows from the center, then collapses back into it.
(() => {
  if (window.top !== window) return;
  const BLUE = '29,155,240';
  const COVER_MS = 460;
  const REVEAL_MS = 820;
  const MAX_WAIT_MS = 3000;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let fx = null;
  // Real viewport size: page-shim.js later makes innerWidth report 799 in Reels tabs.
  const iw = Object.getOwnPropertyDescriptor(window, 'innerWidth')?.get;
  const ih = Object.getOwnPropertyDescriptor(window, 'innerHeight')?.get;
  const W = () => (iw ? iw.call(window) : document.documentElement.getBoundingClientRect().width);
  const H = () => (ih ? ih.call(window) : 800);

  try {
    CSS.registerProperty({ name: '--xr-r', syntax: '<length-percentage>', inherits: true, initialValue: '0px' });
  } catch (_) {}

  const CSS_TEXT = `
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;--xr-r:0px;display:block}
    .wrap{position:absolute;inset:0;overflow:hidden}
    .bg{position:absolute;inset:0;background:
      radial-gradient(ellipse 70% 60% at 50% 45%,rgba(${BLUE},.22),transparent 70%),
      radial-gradient(ellipse at 50% 50%,#0a1f3d 0%,#050b16 55%,#000 100%);}
    .hole .bg,.hole .edge,.hole canvas{-webkit-mask:radial-gradient(circle at 50% 50%,transparent calc(var(--xr-r) - 70px),#000 var(--xr-r))}
    .disc .bg,.disc .edge,.disc canvas{-webkit-mask:radial-gradient(circle at 50% 50%,#000 var(--xr-r),transparent calc(var(--xr-r) + 70px))}
    .edge{position:absolute;inset:0;box-shadow:inset 0 0 140px 24px rgba(${BLUE},.55),inset 0 0 18px 2px rgba(${BLUE},.9);animation:breathe 1.6s ease-in-out infinite alternate}
    @keyframes breathe{from{opacity:.65}to{opacity:1}}
    canvas{position:absolute;inset:0;width:100%;height:100%}
    .frame{position:absolute;left:50%;top:50%;height:min(64vh,560px);aspect-ratio:9/16;translate:-50% -50%;
      border-radius:34px;border:1.5px solid rgba(${BLUE},.75);
      box-shadow:0 0 0 1px rgba(255,255,255,.06),0 0 38px rgba(${BLUE},.45),inset 0 0 38px rgba(${BLUE},.18),
        -3px 0 0 -1px rgba(255,40,110,.35),3px 0 0 -1px rgba(0,230,255,.35);
      animation:float 1.6s ease-in-out infinite alternate;transition:scale .3s cubic-bezier(.3,0,.2,1),opacity .3s}
    @keyframes float{from{scale:1}to{scale:1.02}}
    .frame::after{content:"";position:absolute;left:50%;top:50%;width:54px;height:54px;translate:-50% -50%;border-radius:50%;
      background:radial-gradient(circle at 35% 30%,#4fb6ff,#1d9bf0 55%,#0b5fae);box-shadow:0 0 30px rgba(${BLUE},.8)}
    .frame::before{content:"";position:absolute;left:50%;top:50%;translate:-35% -50%;z-index:1;border-style:solid;
      border-width:9px 0 9px 15px;border-color:transparent transparent transparent #fff}
    .ring{position:absolute;left:50%;top:50%;width:calc(var(--xr-r) * 2);height:calc(var(--xr-r) * 2);translate:-50% -50%;
      border-radius:50%;border:2px solid rgba(220,240,255,.9);opacity:0;
      box-shadow:-5px 0 0 -1px rgba(255,40,110,.75),5px 0 0 -1px rgba(0,230,255,.8),0 0 40px 6px rgba(${BLUE},.7),inset 0 0 40px 6px rgba(${BLUE},.5)}
    .moving .ring{opacity:1}
    .flash{position:absolute;left:50%;top:50%;width:12px;height:12px;translate:-50% -50%;border-radius:50%;background:#fff;
      box-shadow:0 0 30px 12px rgba(${BLUE},.9);opacity:0;scale:0}
    .fade{transition:opacity .35s ease}
  `;

  function build(mode) {
    const host = document.createElement('xr-fx');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS_TEXT}</style><div class="wrap ${mode === 'enter' ? 'hole' : 'disc'}">
      <div class="bg"></div><canvas></canvas><div class="edge"></div><div class="frame"></div><div class="ring"></div><div class="flash"></div></div>`;
    (document.documentElement || document).appendChild(host);
    const wrap = root.querySelector('.wrap');
    const st = { host, wrap, mode, frame: root.querySelector('.frame'), flash: root.querySelector('.flash'),
      canvas: root.querySelector('canvas'), parts: [], running: true, front: null };
    particles(st);
    return st;
  }

  // Sparks: drift toward the phone while waiting, then ride the wave front.
  function particles(st) {
    const c = st.canvas; const g = c.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => { c.width = W() * dpr; c.height = H() * dpr; };
    size(); addEventListener('resize', size);
    const spawnIdle = () => {
      const a = Math.random() * Math.PI * 2; const d = Math.hypot(W(), H()) * (0.35 + Math.random() * 0.3);
      st.parts.push({ x: W() / 2 + Math.cos(a) * d, y: H() / 2 + Math.sin(a) * d, a, v: -(0.6 + Math.random() * 1.2), life: 1, s: 0.8 + Math.random() * 1.6 });
    };
    const tick = () => {
      if (!st.running) return;
      const cx = W() / 2; const cy = H() / 2;
      if (st.front == null) { if (st.parts.length < 90 && Math.random() < 0.7) spawnIdle(); }
      else for (let i = 0; i < 6; i += 1) {
        const a = Math.random() * Math.PI * 2; const r = st.front;
        st.parts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a, v: (st.frontDir || 1) * (2 + Math.random() * 5), life: 1, s: 1 + Math.random() * 2 });
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W(), H());
      g.globalCompositeOperation = 'lighter';
      st.parts = st.parts.filter((p) => {
        const ox = p.x; const oy = p.y;
        p.x += Math.cos(p.a) * p.v; p.y += Math.sin(p.a) * p.v;
        p.life -= st.front == null ? 0.006 : 0.025;
        if (st.front == null && Math.hypot(p.x - cx, p.y - cy) < 60) p.life -= 0.1;
        if (p.life <= 0) return false;
        g.strokeStyle = `rgba(${p.s > 2 ? '220,240,255' : BLUE},${p.life * 0.9})`;
        g.lineWidth = p.s; g.lineCap = 'round';
        g.beginPath(); g.moveTo(ox - Math.cos(p.a) * p.v * 3, oy - Math.sin(p.a) * p.v * 3); g.lineTo(p.x, p.y); g.stroke();
        return true;
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const farR = () => Math.hypot(W(), H()) / 2 + 90;
  // Moves the wave front from r0 to r1 (px), with a short anticipation pull the other way first.
  function wave(st, r0, r1, ms) {
    return new Promise((done) => {
      st.wrap.classList.add('moving');
      st.frontDir = Math.sign(r1 - r0) || 1;
      const t0 = performance.now();
      const pull = (r1 - r0) * -0.04;
      const ease = (t) => (t < 0.15 ? -Math.sin((t / 0.15) * Math.PI / 2) * 1 : 1 - Math.pow(1 - (t - 0.15) / 0.85, 3));
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const k = ease(t);
        const r = t < 0.15 ? r0 + pull * -k : r0 + (r1 - r0) * k;
        st.front = Math.max(0, r);
        st.host.style.setProperty('--xr-r', st.front + 'px');
        if (t < 1) requestAnimationFrame(step); else { st.wrap.classList.remove('moving'); st.front = null; done(); }
      };
      requestAnimationFrame(step);
    });
  }

  // A brief RGB split on the page itself while the wave passes over it.
  function aberrate(ms) {
    const el = document.documentElement; if (!el) return;
    const prev = el.style.filter;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms); const d = (1 - t) * 4;
      el.style.filter = t < 1 ? `drop-shadow(${d}px 0 0 rgba(255,40,110,.45)) drop-shadow(${-d}px 0 0 rgba(0,230,255,.45))` : prev;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function remove(st) {
    st.running = false; st.host.remove(); if (fx === st) fx = null;
  }

  // Old page: cover it (called just before the tab navigates).
  async function cover(mode) {
    if (fx) remove(fx);
    const st = fx = build(mode);
    if (reduced) { st.wrap.style.opacity = '0'; st.wrap.classList.add('fade'); requestAnimationFrame(() => { st.wrap.style.opacity = '1'; }); return; }
    st.frame.style.opacity = '0';
    const far = farR();
    st.host.style.setProperty('--xr-r', (mode === 'enter' ? far : 0) + 'px');
    aberrate(COVER_MS);
    await wave(st, mode === 'enter' ? far : 0, mode === 'enter' ? 0 : far, COVER_MS);
    st.frame.style.opacity = '';
  }

  // New page: start covered, open once X has drawn its page (or after MAX_WAIT_MS).
  function reveal(mode, onDone) {
    if (fx) remove(fx);
    const st = fx = build(mode);
    const far = farR();
    st.host.style.setProperty('--xr-r', (mode === 'enter' ? 0 : far) + 'px');
    const t0 = Date.now();
    const ready = () => document.querySelector('[data-testid="primaryColumn"], main, [role="main"], video')
      && document.readyState !== 'loading';
    const go = async () => {
      if (reduced) { st.wrap.classList.add('fade'); st.wrap.style.opacity = '0'; setTimeout(() => { remove(st); onDone?.(); }, 380); return; }
      st.frame.style.scale = mode === 'enter' ? '1.15' : '0.6'; st.frame.style.opacity = '0';
      aberrate(REVEAL_MS);
      await wave(st, mode === 'enter' ? 0 : far, mode === 'enter' ? far : 0, REVEAL_MS);
      if (mode === 'exit') {
        st.flash.animate([{ opacity: 0, scale: 0 }, { opacity: 1, scale: 1.6 }, { opacity: 0, scale: 0.2 }], { duration: 320, easing: 'ease-out' });
        await new Promise((r) => setTimeout(r, 320));
      }
      remove(st); onDone?.();
    };
    const wait = () => {
      const waited = Date.now() - t0;
      if ((ready() && waited > 450) || waited > MAX_WAIT_MS) go(); else setTimeout(wait, 80);
    };
    wait();
  }

  document.addEventListener('xr-fx', (e) => { const m = e.detail; if (m === 'enter' || m === 'exit') cover(m); });
  window.__xrFx = { cover, reveal };
})();
