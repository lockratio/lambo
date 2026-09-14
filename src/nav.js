/* ═══════════════════════════════════════════════════════════════
   NAV — hash-routed info pages, the mobile drawer, and the
   rotate-your-phone prompt. Pages live at #/how, #/pricing, …;
   share links keep their own #m=…&c=…&s=… form and never collide.
   ═══════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const PAGES = ['how', 'pricing', 'advertisers', 'faq', 'contact'];

export function pageFromHash(h = location.hash){
  const m = /^#\/([a-z-]*)/i.exec(h);
  if (!m) return null;                       // not a page hash (share link or nothing)
  return PAGES.includes(m[1]) ? m[1] : 'car';
}

export function createNav({ sfx, onPage } = {}){
  const pages = $('#pages'), drawer = $('#drawer');
  const scrim = document.createElement('div'); scrim.id = 'dscrim'; document.body.appendChild(scrim);
  let current = 'car', hideT = null;

  /* ── router ─────────────────────────────────────────────── */
  function show(page){
    if (page === current) return;
    const prev = current; current = page;
    $$('#nav a, #drawer a').forEach(a => a.classList.toggle('on', a.dataset.page === page));
    if (page === 'car'){
      pages.classList.remove('on');
      document.body.classList.remove('paged');
      clearTimeout(hideT); hideT = setTimeout(() => { pages.hidden = true; $$('.page', pages).forEach(p => p.classList.remove('on')); }, 480);
    } else {
      clearTimeout(hideT);
      pages.hidden = false;
      $$('.page', pages).forEach(p => p.classList.toggle('on', p.dataset.page === page));
      $('.pwrap', pages).scrollTop = 0;
      requestAnimationFrame(() => requestAnimationFrame(() => pages.classList.add('on')));
      document.body.classList.add('paged');
    }
    closeDrawer();
    onPage?.(page, prev);
  }
  function route(){ const p = pageFromHash(); if (p !== null) show(p); }
  addEventListener('hashchange', route);
  $('#pageClose').onclick = () => { location.hash = '#/'; sfx?.click(); };
  addEventListener('keydown', e => { if (e.key === 'Escape' && current !== 'car'){ location.hash = '#/'; } });
  $$('#nav a, #drawer a').forEach(a => a.addEventListener('click', () => sfx?.click()));

  /* ── drawer ─────────────────────────────────────────────── */
  const menuBtn = $('#menuBtn');
  function openDrawer(){ drawer.classList.add('on'); scrim.classList.add('on'); menuBtn.setAttribute('aria-expanded', 'true'); sfx?.click(); }
  function closeDrawer(){ drawer.classList.remove('on'); scrim.classList.remove('on'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.onclick = () => drawer.classList.contains('on') ? closeDrawer() : openDrawer();
  $('#drawerClose').onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  $$('#drawer a').forEach(a => a.addEventListener('click', closeDrawer));

  /* ── rotate prompt (mobile, portrait) ───────────────────── */
  const rotate = $('#rotate');
  const portrait = matchMedia('(orientation: portrait)');
  let skipped = false; try { skipped = sessionStorage.getItem('lambo.portrait') === '1'; } catch {}
  function updateRotate(){
    const mobile = document.documentElement.classList.contains('mobile');
    rotate.hidden = !(mobile && portrait.matches && !skipped);
  }
  portrait.addEventListener?.('change', updateRotate);
  $('#rotateSkip').onclick = () => { skipped = true; try { sessionStorage.setItem('lambo.portrait', '1'); } catch {} updateRotate(); };
  $('#rotateFull').onclick = async () => {
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch {}
    try { await screen.orientation?.lock?.('landscape'); } catch {}
    // if the lock was refused (iOS Safari), let them through anyway — the CSS copes with portrait
    setTimeout(() => { if (portrait.matches){ skipped = true; updateRotate(); } }, 600);
  };
  updateRotate();

  route();
  return { show, route, openDrawer, closeDrawer, updateRotate, get page(){ return current; } };
}
