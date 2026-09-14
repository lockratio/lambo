/* ═══════════════════════════════════════════════════════════════
   SCENE — renderer, camera, orbit + pan, lights, white-studio
   environment, cast shadow and contact shadow. Knows nothing
   about slots.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* where the orbit pivot is allowed to be dragged (car space, metres) */
const PAN_BOX = { x: 2.8, y0: 0.05, y1: 1.5, z: 2.2 };

export function createScene(canvas, { mobile = false, timerLoop = false } = {}){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.6 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 90);
  camera.position.set(8.4, 2.3, 5.9);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.34, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 2.6;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.10;
  controls.maxPolarAngle = 1.50;
  controls.enablePan = true;                 // lateral "pull across": right-drag, shift-drag, two fingers, or the Move tool
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.9;
  controls.keyPanSpeed = 14;
  controls.zoomSpeed = 0.9;
  controls.autoRotate = !reducedMotion();
  controls.autoRotateSpeed = 0.28;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  /* ── lights ────────────────────────────────────────────────
     The environment lights the paint; the key light exists to
     cast the shadow and to give the tyres and trim some shape.
     It follows the camera's azimuth at an offset, so the shadow
     sweeps across the floor as you orbit. */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd3da, 0.14));
  const key = new THREE.DirectionalLight(0xffffff, 0.45);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 24;
  key.shadow.camera.left = -3.6; key.shadow.camera.right = 3.6;
  key.shadow.camera.top = 3.2;   key.shadow.camera.bottom = -3.2;
  key.shadow.bias = -0.00035; key.shadow.normalBias = 0.025;
  key.target.position.set(0, 0.3, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xf4f7ff, 0.18); fill.position.set(-4, 3, -6); scene.add(fill);

  const KEY_AZ = 0.85, KEY_EL = 0.98, KEY_R = 11;    // offset from the camera, elevation, distance
  const _o = new THREE.Vector3();
  function trackLight(){
    _o.subVectors(camera.position, controls.target);
    const az = Math.atan2(_o.z, _o.x) + KEY_AZ;
    key.position.set(Math.cos(az) * Math.cos(KEY_EL) * KEY_R, Math.sin(KEY_EL) * KEY_R, Math.sin(az) * Math.cos(KEY_EL) * KEY_R);
  }
  trackLight();

  scene.add(buildShadowCatcher());
  scene.add(buildContactShadow());

  /* ── framing ───────────────────────────────────────────────
     The HUD occupies the right-hand column and the top strip, so
     the car is framed in the *free* area: a view offset nudges the
     projection centre left/down without touching the orbit. */
  let shiftX = 0, shiftY = 0;
  function resize(){
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    const fw = w + 2 * Math.abs(shiftX), fh = h + 2 * Math.abs(shiftY);
    camera.aspect = fw / fh;
    if (shiftX || shiftY) camera.setViewOffset(fw, fh, shiftX > 0 ? 2 * shiftX : 0, shiftY < 0 ? 2 * -shiftY : 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  /** Shift the car's on-screen centre: +x = left, +y = down (CSS px). */
  function setShift(x, y){ shiftX = x; shiftY = y; resize(); }
  addEventListener('resize', resize); resize();

  /* Environment is generated after the first frame so the car shows
     up a beat sooner; until then the lights above carry it. */
  let envBuilt = false;
  function ensureEnvironment(){
    if (envBuilt) return; envBuilt = true;
    scene.environment = buildStudioEnv(renderer, mobile ? 512 : 1024);
    scene.environmentIntensity = 1.0;
  }

  /* A hook that throws must not take the whole page with it: three's
     animation loop stops re-requesting frames after an uncaught
     exception. Log it (once per hook) and keep rendering. */
  const hooks = new Set(), after = new Set(), failed = new WeakSet();
  const safely = (fn, ...args) => {
    try { fn(...args); }
    catch (err){ if (!failed.has(fn)){ failed.add(fn); console.error('[frame hook]', err); } }
  };
  let last = performance.now();
  const loop = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const h of hooks) safely(h, dt, now);
    controls.update();
    clampTarget();
    trackLight();
    renderer.render(scene, camera);
    for (const h of after) safely(h);
  };
  function clampTarget(){
    const t = controls.target;
    const cx = THREE.MathUtils.clamp(t.x, -PAN_BOX.x, PAN_BOX.x), cy = THREE.MathUtils.clamp(t.y, PAN_BOX.y0, PAN_BOX.y1), cz = THREE.MathUtils.clamp(t.z, -PAN_BOX.z, PAN_BOX.z);
    if (cx !== t.x || cy !== t.y || cz !== t.z){ camera.position.add(_o.set(cx - t.x, cy - t.y, cz - t.z)); t.set(cx, cy, cz); }
  }
  if (timerLoop){
    /* debug only (?tick): drive frames from a worker timer so a hidden
       tab — where requestAnimationFrame never fires — still renders */
    const w = new Worker(URL.createObjectURL(new Blob(['onmessage = () => setTimeout(() => postMessage(0), 33)'], { type: 'text/javascript' })));
    w.onmessage = () => { loop(); w.postMessage(0); };   // ping-pong: never queue frames faster than they render
    w.postMessage(0);
  } else renderer.setAnimationLoop(loop);

  return { renderer, scene, camera, controls, resize, setShift, ensureEnvironment, key,
           onFrame: (fn) => (hooks.add(fn), () => hooks.delete(fn)),
           afterFrame: (fn) => (after.add(fn), () => after.delete(fn)) };
}

/* ─────────────────────────────────────────────────────────────
   Studio: a white room with HDR softboxes. Built as a half-float
   equirectangular texture so the strips can be many times brighter
   than the walls — that contrast is what draws a hard highlight
   down the bodywork and the glint across the windscreen. No HDR
   download, no canvas 8-bit ceiling.
   Rows run floor → ceiling (DataTexture, flipY off).
   ───────────────────────────────────────────────────────────── */
function buildStudioEnv(renderer, W = 1024){
  const H = W / 2;
  const data = new Uint16Array(W * H * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // soft-edged rectangle in (u, up) space; u wraps
  const rect = (u, up, u0, u1, v0, v1, feather = 0.012) => {
    let du = u; if (u1 > 1 && u < u0) du = u + 1;
    const fu = sm(u0 - feather, u0 + feather, du) * (1 - sm(u1 - feather, u1 + feather, du));
    const fv = sm(v0 - feather, v0 + feather, up) * (1 - sm(v1 - feather, v1 + feather, up));
    return fu * fv;
  };
  for (let y = 0; y < H; y++){
    const up = y / (H - 1);                       // 0 floor … 1 ceiling
    for (let x = 0; x < W; x++){
      const u = x / W;                            // 0.5 = +X (nose), 0.75 = +Z (driver side)
      /* the room */
      let r, g, b;
      /* mid-grey walls rising to a bright ceiling, darker floor: that
         vertical gradient is what makes white paint read as a form
         instead of a cut-out — tops go bright, flanks fall off. */
      if (up >= 0.5){ const k = (up - 0.5) * 2; r = g = b = 0.46 + 0.56 * k * k; }      // walls → ceiling
      else          { const k = up * 2;         r = g = b = 0.26 + 0.22 * k * k; }      // floor
      // a barely-cool tint on the walls so pure white paint still reads as white
      b += 0.02; g += 0.005;
      /* softboxes (HDR) */
      let s = 0;
      /* thin and bright: a narrow strip draws a crisp highlight line
         while adding little to the diffuse irradiance, so the white
         paint keeps its headroom instead of blowing out */
      s += 6.0 * rect(u, up, 0.30, 0.70, 0.855, 0.885, 0.004);  // long overhead strip, forward
      s += 4.5 * rect(u, up, 0.80, 1.20, 0.855, 0.885, 0.004);  // long overhead strip, aft
      s += 3.0 * rect(u, up, 0.00, 1.00, 0.740, 0.750, 0.002);  // thin ring light → windscreen glint
      s += 3.0 * rect(u, up, 0.68, 0.82, 0.58, 0.66, 0.006);    // window, driver side
      s += 2.5 * rect(u, up, 0.18, 0.32, 0.58, 0.66, 0.006);    // window, passenger side
      s += 2.0 * rect(u, up, 0.42, 0.58, 0.59, 0.65, 0.006);    // window ahead of the nose
      s += 0.4 * rect(u, up, 0.00, 1.00, 0.20, 0.34, 0.06);     // floor bounce
      const i = (y * W + x) * 4;
      data[i] = half(r + s); data[i+1] = half(g + s); data[i+2] = half(b + s * 1.02); data[i+3] = half(1);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(t).texture;
  pm.dispose(); t.dispose();
  return env;
}

/* The floor is the page itself. This invisible plane only catches
   the key light's shadow, so it stays the same off-white as the
   room around it. */
function buildShadowCatcher(){
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.ShadowMaterial({ color: 0x1b1f2e, opacity: 0.22, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.0; m.renderOrder = -2; m.receiveShadow = true;
  return m;
}

/* Soft ambient-occlusion pool under the car and the tyres; the cast
   shadow sits on top of it. */
function buildContactShadow(){
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const blob = (cx, cy, rx, ry, a) => {
    x.save(); x.translate(cx, cy); x.scale(rx, ry);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(20,24,40,${a})`); g.addColorStop(0.5, `rgba(20,24,40,${a*0.5})`); g.addColorStop(1, 'rgba(20,24,40,0)');
    x.fillStyle = g; x.fillRect(-1, -1, 2, 2); x.restore();
  };
  blob(W/2, H/2, W*0.47, H*0.40, 0.42);          // whole underbody
  for (const [u, v] of [[0.76,0.16],[0.76,0.84],[0.21,0.16],[0.21,0.84]]) blob(u*W, v*H, 40, 28, 0.75);   // tyres
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 3.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.003; m.renderOrder = -1;
  return m;
}
