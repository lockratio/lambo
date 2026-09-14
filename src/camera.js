/* ═══════════════════════════════════════════════════════════════
   CAMERA FLIGHTS
   Animated in spherical coordinates *around the destination
   target*, and written through OrbitControls every frame (target
   first, then camera position derived from it) so the orbit pivot
   lands exactly where the panel is and controls never fight the
   animation. The draft lerped camera.position directly — that is
   the bug the brief describes in §0.2(2).
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOut = k => k < 0.5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3) / 2;

export function createFlight(camera, controls, { reduced = false } = {}){
  let fly = null;
  const sph = new THREE.Spherical(), off = new THREE.Vector3();

  /** @param {{target:THREE.Vector3, position?:THREE.Vector3, theta?:number, phi?:number, radius?:number, dur?:number}} spec */
  function flyTo(spec){
    const toT = spec.target.clone();
    let toS;
    if (spec.position){ toS = new THREE.Spherical().setFromVector3(off.subVectors(spec.position, toT)); }
    else toS = new THREE.Spherical(spec.radius ?? 7, spec.phi ?? 1.15, spec.theta ?? 0.8);
    toS.phi = clamp(toS.phi, controls.minPolarAngle + 0.01, controls.maxPolarAngle - 0.01);
    toS.radius = clamp(toS.radius, controls.minDistance, controls.maxDistance);

    const fromT = controls.target.clone();
    const fromS = new THREE.Spherical().setFromVector3(off.subVectors(camera.position, fromT));
    // shortest way round
    let dTheta = toS.theta - fromS.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    toS.theta = fromS.theta + dTheta;

    if (reduced || (spec.dur ?? 900) <= 0){ apply(toT, toS); fly = null; return; }
    controls.autoRotate = false;
    fly = { fromT, toT, fromS, toS, t0: performance.now(), dur: spec.dur ?? 900, done: spec.done };
  }

  function apply(t, s){
    controls.target.copy(t);
    camera.position.setFromSpherical(s).add(t);
    camera.lookAt(t);
  }

  function update(){
    if (!fly) return;
    const k = clamp((performance.now() - fly.t0) / fly.dur, 0, 1), e = easeInOut(k);
    const t = new THREE.Vector3().lerpVectors(fly.fromT, fly.toT, e);
    sph.set(fly.fromS.radius + (fly.toS.radius - fly.fromS.radius) * e,
            fly.fromS.phi    + (fly.toS.phi    - fly.fromS.phi)    * e,
            fly.fromS.theta  + (fly.toS.theta  - fly.fromS.theta)  * e);
    apply(t, sph);
    if (k >= 1){ const d = fly.done; fly = null; d?.(); }
  }

  /** Frame a set of cells: look along their averaged normal from a
      distance that puts the group at ~40 % of the viewport height. */
  function frameCells(cells, { fraction = 0.40, dur = 950, lift = 0.22 } = {}){
    if (!cells.length) return;
    const c = new THREE.Vector3(), n = new THREE.Vector3();
    for (const cl of cells){ c.add(new THREE.Vector3(...cl.c)); n.add(new THREE.Vector3(...cl.n)); }
    c.divideScalar(cells.length); n.divideScalar(cells.length);
    if (n.length() < 0.25) n.set(0, 0.5, Math.sign(c.z) || 1);   // opposite-facing cells cancel → look from outside
    n.y = Math.max(n.y, lift); n.normalize();
    let rad = 0; for (const cl of cells) rad = Math.max(rad, c.distanceTo(new THREE.Vector3(...cl.c)));
    rad = Math.max(rad, 0.35);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const dist = clamp(rad / Math.tan(halfFov) / fraction, 3.2, 12);
    flyTo({ target: c, position: c.clone().addScaledVector(n, dist), dur });
  }

  return { flyTo, frameCells, update, get busy(){ return !!fly; }, cancel(){ fly = null; } };
}
