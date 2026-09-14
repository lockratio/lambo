/* ═══════════════════════════════════════════════════════════════
   BOOT
   1. scene + white car as soon as the glTF is parsed
   2. slots computed off-thread (or restored from IndexedDB)
   3. heatmap wipes in, stickers land as decals, HUD goes live
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { CONFIG, ZONES } from './config.js';
import { createScene, reducedMotion } from './scene.js';
import { loadCar } from './model.js';
import { createPaintMaterial, reorderByCell, createPainter, createModeAnimator } from './paint.js';
import { computeSlots } from './slots/client.js';
import { createFlight } from './camera.js';
import { createInteraction } from './interact.js';
import { loadCampaigns, buildDecals } from './campaigns.js';
import { createShare } from './share.js';
import { createLoader, createHUD } from './hud.js';
import { createArtwork } from './artwork.js';
import { createSfx } from './sfx.js';
import { createNav, pageFromHash } from './nav.js';
import { createViewControls, PRESETS } from './viewctl.js';

const params  = new URLSearchParams(location.search);
const mq      = matchMedia('(max-width: 760px), ((pointer: coarse) and (max-width: 1100px)), ((pointer: coarse) and (max-height: 520px))');
const isMobile = () => mq.matches || params.has('mobile');
document.documentElement.classList.toggle('mobile', isMobile());
document.body.classList.toggle('mobile', isMobile());
const mobile  = isMobile();
const reduced = reducedMotion();
const loader  = createLoader();
const canvas  = document.getElementById('view');
const sfx     = createSfx();
const nav     = createNav({ sfx });

window.__errors = [];
addEventListener('error', e => window.__errors.push(`${e.message} @ ${e.filename?.split('/').slice(-2).join('/')}:${e.lineno}`));
addEventListener('unhandledrejection', e => window.__errors.push('unhandled: ' + (e.reason?.stack ?? e.reason)));

boot().catch(err => {
  console.error(err);
  loader.fail('Something went wrong loading the car. ' + (err?.message ?? ''));
});

async function boot(){
  const sc = createScene(canvas, { mobile, timerLoop: params.has('tick') });
  const paintMat = createPaintMaterial({ mobile });
  const modeAnim = createModeAnimator(paintMat, { reduced });
  const campaignsP = loadCampaigns().catch(err => { console.warn('[campaigns]', err); return []; });

  /* frame the car in the space the HUD leaves free */
  const layout = () => {
    const m = isMobile();
    document.documentElement.classList.toggle('mobile', m); document.body.classList.toggle('mobile', m);
    const landscape = innerWidth > innerHeight;
    if (m){ sc.camera.fov = landscape ? 30 : 40; sc.setShift(0, landscape ? -14 : -Math.round(innerHeight * 0.16)); }
    else  { sc.camera.fov = 30; sc.setShift(Math.min(140, innerWidth * 0.09), 34); }
    nav.updateRotate();
  };
  layout();
  mq.addEventListener?.('change', layout);
  addEventListener('resize', layout);

  /* ── 1. the car ──────────────────────────────────────────── */
  const car = await loadCar(CONFIG.MODEL_URL, {
    onProgress: (l, t) => loader.set('download', t ? l / t : 0.5), mobile, paintMaterial: paintMat,
  });
  // placeholder colour attribute so the paint shader has a vColor before slots exist
  {
    const n = car.bodyGeo.attributes.position.count, a = new Float32Array(n * 4);
    const p = paintMat.userData.uniforms.uPaint.value;
    for (let i = 0; i < n; i++){ a[i*4] = p.r; a[i*4+1] = p.g; a[i*4+2] = p.b; }
    car.bodyGeo.setAttribute('color', new THREE.BufferAttribute(a, 4));
  }
  sc.scene.add(car.group);
  sc.ensureEnvironment();
  await sc.renderer.compileAsync(sc.scene, sc.camera);
  loader.done();

  const flight = createFlight(sc.camera, sc.controls, { reduced });
  sc.onFrame(() => { flight.update(); modeAnim.update(); });

  /* intro: a slow pull-in from low and far — unless a deep link says where to be */
  const rest = PRESETS.hero;
  const hashNow = /[cs]=/.test(location.hash);
  if (!hashNow){
    const fit = mobile ? (innerWidth > innerHeight ? 0.72 : 1.45) : 1;
    sc.controls.target.copy(rest.target);
    sc.camera.position.set(10.5 * fit, 1.1, 8.2 * fit);
    flight.flyTo({ target: rest.target, position: rest.target.clone().addScaledVector(rest.position.clone().sub(rest.target), fit), dur: reduced ? 0 : 2600 });
  }

  /* ── 2. slots ────────────────────────────────────────────── */
  const campaigns = await campaignsP;
  const pill = document.getElementById('pricing');
  const slots = await computeSlots({
    positions: car.bodyGeo.attributes.position.array, normals: car.bodyGeo.attributes.normal.array,
    triPart: car.triPart, parts: car.parts, byteLength: car.byteLength,
  }, campaigns, (phase, v) => {
    pill.hidden = false;
    pill.querySelector('b').textContent = phase === 'cache' ? 'Restoring slots' : phase === 'measure' ? 'Measuring panels' : phase === 'partition' ? 'Laying out slots' : 'Pricing slots';
    pill.querySelector('i').style.transform = `scaleX(${v.toFixed(3)})`;
  });
  pill.hidden = true;

  const { cells } = slots;
  const re = reorderByCell(car.bodyGeo, cells, slots.triCell, slots.vig, car.triPart);
  const painter = createPainter(car.bodyGeo, cells, re.vig, re.deadStart);
  car.bodyGeo.dispose();                       // drop the pre-slot GPU buffers; re-uploaded next frame
  painter.paintAll();

  if (params.get('debug') === 'zones') debugZones(cells, painter);

  const decals = buildDecals(car.bodyMesh, cells, campaigns, { mobile });
  car.group.add(decals);
  console.log(`[slots] ${cells.length.toLocaleString()} slots · ${campaigns.filter(c => c.slots).length} campaigns · rate $${Math.round(slots.meta.rate)}/m²·pt`);

  /* ── 3. app wiring ───────────────────────────────────────── */
  const app = {
    canvas, ...sc, ...car, cells, triCell: re.triCell, painter, modeAnim, flight, campaigns, mobile, slotMeta: slots.meta, sfx, nav,
  };
  app.share = createShare({ camera: sc.camera, controls: sc.controls, cells, getMode: () => modeAnim.mode });

  let hud;
  const ix = createInteraction(app, {
    onSelectionChange: () => hud.updateCart(),
    onHover: (ids, e) => hud.showTip(ids, e),
    onModeChange: (m) => hud.reflectMode(m),
  });
  hud = createHUD(app, ix);
  app.artwork = createArtwork(app, { toast: hud.toast });
  hud.wireArtwork(app.artwork);
  hud.reflectMode('look'); hud.reflectBrush();
  hud.buildRail(); hud.updateFunding(); hud.updateCart(); hud.buildPages();
  const vc = createViewControls(app, { sfx, ix });
  app.viewctl = vc;
  sc.onFrame(() => { ix.frame(); vc.frame(); });
  sc.afterFrame(() => painter.flush());
  document.body.classList.add('ready');

  /* deep link or the showroom → market reveal */
  const link = app.share.read();
  if (link?.isLink){
    if (link.camera) flight.flyTo({ target: link.camera.target, theta: link.camera.theta, phi: link.camera.phi, radius: link.camera.radius, dur: 0 });
    if (link.selection?.length){ ix.selectCells(link.selection, { record: false }); ix.setMode('select'); }
    hud.setView(link.mode === 'showroom' ? 'showroom' : 'market');
    if (link.mode !== 'showroom') modeAnim.set('market', { instant: true });
  } else {
    /* land in the showroom (white car, stickers); the price map wipes in
       the first time the visitor starts selecting or picks Market */
    setTimeout(() => { if (nav.page === 'car') hud.onboard(); }, reduced ? 400 : 4200);
  }

  addEventListener('hashchange', () => {
    const l = app.share.read(); if (!l?.isLink) return;
    if (l.camera) flight.flyTo({ target: l.camera.target, theta: l.camera.theta, phi: l.camera.phi, radius: l.camera.radius, dur: 800 });
    if (l.selection) ix.selectCells(l.selection, { add: false });
  });

  window.__slots = { THREE, ...app, ix, hud, slots, vc };   // console handle
}

/* ?debug=zones — paint every zone a distinct hue to check the split */
function debugZones(cells, painter){
  const keys = Object.keys(ZONES);
  const col = new THREE.Color();
  const attr = painter.attr, data = attr.array;
  for (const c of cells){
    col.setHSL(keys.indexOf(c.zone) / keys.length, 0.75, 0.5);
    for (let v = c.start * 3; v < (c.start + c.count) * 3; v++){ data[v*4] = col.r; data[v*4+1] = col.g; data[v*4+2] = col.b; data[v*4+3] = 1; }
  }
  attr.needsUpdate = true;
  console.table(keys.map(k => ({ zone: k, cells: cells.filter(c => c.zone === k).length })));
}
