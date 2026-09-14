/* ═══════════════════════════════════════════════════════════════
   VIEW CONTROLS — camera presets, zoom steps, the Move (pan) tool,
   auto-rotate, and the keyboard for all of it. The Lock Ratio logo
   is the reset button.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

const T = (y = 0.34) => new THREE.Vector3(0, y, 0);
export const PRESETS = {
  hero:  { target: T(0.36), position: new THREE.Vector3(6.1, 1.85, 4.6) },     // front three-quarter — the reset
  front: { target: T(0.42), position: new THREE.Vector3(7.4, 1.35, 0.05) },
  side:  { target: T(0.40), position: new THREE.Vector3(0.25, 1.15, 7.3) },
  rear:  { target: T(0.50), position: new THREE.Vector3(-7.3, 1.7, 0.05) },
  top:   { target: T(0.30), position: new THREE.Vector3(0.8, 8.4, 0.05) },
};

export function createViewControls(app, { sfx, ix } = {}){
  const { canvas, camera, controls, flight } = app;
  const $ = (s) => document.querySelector(s);

  /* ── presets ────────────────────────────────────────────── */
  /* phones sit closer: the short edge is what limits the framing */
  const fit = () => app.mobile ? (innerWidth > innerHeight ? 0.72 : 1.45) : 1;
  function preset(name, { dur = 900 } = {}){
    const p = PRESETS[name] ?? PRESETS.hero;
    controls.autoRotate = false;
    const position = p.target.clone().addScaledVector(p.position.clone().sub(p.target), fit());
    flight.flyTo({ target: p.target, position, dur });
  }
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { preset(b.dataset.preset); sfx?.click(); }));
  $('#logo').addEventListener('click', (e) => {
    // on the car page the logo is "reset"; elsewhere it is also the way home, which the hash handles
    if (!document.body.classList.contains('paged')) e.preventDefault();
    preset('hero'); sfx?.click();
  });

  /* ── zoom steps ─────────────────────────────────────────── */
  const sph = new THREE.Spherical(), off = new THREE.Vector3();
  function zoom(k){
    controls.autoRotate = false;
    sph.setFromVector3(off.subVectors(camera.position, controls.target));
    const r = THREE.MathUtils.clamp(sph.radius * k, controls.minDistance, controls.maxDistance);
    flight.flyTo({ target: controls.target, radius: r, phi: sph.phi, theta: sph.theta, dur: 320 });
    sfx?.tick();
  }
  $('#zoomIn').onclick = () => zoom(0.78);
  $('#zoomOut').onclick = () => zoom(1.28);

  /* ── Move tool ──────────────────────────────────────────── */
  let pan = false, shiftHeld = false;
  function applyButtons(){
    const p = pan || shiftHeld;
    controls.mouseButtons.LEFT = p ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = p ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    canvas.classList.toggle('mode-pan', p);
  }
  function setPan(on){
    pan = on;
    if (on && ix?.mode !== 'look') ix?.setMode('look');
    $('#panBtn').setAttribute('aria-pressed', String(on));
    controls.autoRotate = false;
    applyButtons();
  }
  $('#panBtn').onclick = () => { setPan(!pan); sfx?.click(); };
  addEventListener('keydown', e => { if (e.key === 'Shift' && !shiftHeld){ shiftHeld = true; applyButtons(); } });
  addEventListener('keyup',   e => { if (e.key === 'Shift'){ shiftHeld = false; applyButtons(); } });
  addEventListener('blur',    () => { shiftHeld = false; applyButtons(); });

  /* ── auto-rotate ────────────────────────────────────────── */
  const spinBtn = $('#spinBtn');
  spinBtn.onclick = () => { controls.autoRotate = !controls.autoRotate; sfx?.click(); };
  let lastSpin = null;
  function frame(){
    if (controls.autoRotate !== lastSpin){ lastSpin = controls.autoRotate; spinBtn.setAttribute('aria-pressed', String(lastSpin)); }
  }

  /* ── keyboard ───────────────────────────────────────────── */
  addEventListener('keydown', e => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains('paged')) return;
    switch(e.key){
      case 'r': case 'R': case 'Home': preset('hero'); sfx?.click(); break;
      case '1': preset('front'); sfx?.click(); break;
      case '2': preset('side');  sfx?.click(); break;
      case '3': preset('rear');  sfx?.click(); break;
      case '4': preset('top');   sfx?.click(); break;
      case '+': case '=': zoom(0.78); break;
      case '-': case '_': zoom(1.28); break;
      case 'h': case 'H': setPan(!pan); sfx?.click(); break;
      default: return;
    }
    e.preventDefault();
  });

  return { preset, zoom, setPan, frame, get pan(){ return pan; } };
}
