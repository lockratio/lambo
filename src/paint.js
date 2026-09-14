/* ═══════════════════════════════════════════════════════════════
   PAINT — the body material and the per-vertex colour buffer.

   The material is white clearcoat paint. Slot colour lives in a
   vec4 vertex attribute: rgb = slot colour (heat / sold / selected),
   a = "persistence" — how strongly that colour should survive in
   Showroom mode. A wipe uniform sweeps the mix from tail to nose so
   the reveal reads as vinyl being laid down the car.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { PALETTE } from './config.js';

const srgb = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
const heatCols = PALETTE.heat.map(srgb);
const cSold = srgb(PALETTE.sold), cSel = srgb(PALETTE.selected), cHover = srgb(PALETTE.hover), cPaint = srgb(PALETTE.paint);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function heatAt(t, out = new THREE.Color()){
  t = clamp(t, 0, 1) * (heatCols.length - 1);
  const i = Math.min(heatCols.length - 2, Math.floor(t));
  return out.lerpColors(heatCols[i], heatCols[i+1], t - i);
}
export function heatCss(t){
  const c = heatAt(t); return '#' + c.getHexString(THREE.SRGBColorSpace);
}

export function createPaintMaterial({ mobile = false } = {}){
  const uniforms = {
    uPaint:   { value: cPaint.clone() },
    uWipe:    { value: -4.0 },     // x position of the market/showroom front; < -3 = all showroom
    uGlow:    { value: 0.0 },
    uPersist: { value: 0.85 },
  };
  /* white pearl: a low-roughness base under a glass-smooth clearcoat.
     The HDR softboxes in the environment are what draw the sheen. */
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, color: 0xffffff,
    metalness: 0.0, roughness: mobile ? 0.34 : 0.26,
    clearcoat: 1.0, clearcoatRoughness: mobile ? 0.08 : 0.04,
    envMapIntensity: 1.0,
    specularIntensity: 0.9, specularColor: 0xffffff,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSlotX;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSlotX = (modelMatrix * vec4(transformed, 1.0)).x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSlotX;
        uniform vec3 uPaint; uniform float uWipe; uniform float uGlow; uniform float uPersist;`)
      .replace('#include <color_fragment>', `
        float wipe = clamp((uWipe - vSlotX) / 0.55, 0.0, 1.0);
        float k = max(wipe, vColor.a * uPersist);
        diffuseColor.rgb = mix(uPaint, vColor.rgb, k);
        float slotGlow = uGlow * exp(-pow((vSlotX - uWipe + 0.10) / 0.14, 2.0));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.30, 0.45, 1.0) * slotGlow;`);
  };
  mat.customProgramCacheKey = () => 'slot-paint-v4';
  mat.userData.uniforms = uniforms;
  return mat;
}

/* ─────────────────────────────────────────────────────────────
   Reorder the body so each cell's triangles are contiguous. Then
   a cell repaint is one small GPU update range instead of a 6 MB
   re-upload, and every cell is a (start, count) pair.
   ───────────────────────────────────────────────────────────── */
export function reorderByCell(bodyGeo, cells, triCell, vig, triPart){
  const pos = bodyGeo.attributes.position.array, nrm = bodyGeo.attributes.normal.array;
  const triCount = pos.length / 9;
  const order = new Uint32Array(triCount);
  let w = 0;
  for (const c of cells){ c.start = w; c.count = c.tris.length; for (const t of c.tris) order[w++] = t; }
  const deadStart = w;
  for (let t = 0; t < triCount; t++) if (triCell[t] < 0) order[w++] = t;

  const P = new Float32Array(pos.length), N = new Float32Array(nrm.length), V = new Float32Array(vig.length), TP = new Uint8Array(triCount);
  const newTriCell = new Int32Array(triCount).fill(-1);
  for (let i = 0; i < triCount; i++){
    const t = order[i];
    P.set(pos.subarray(t*9, t*9+9), i*9); N.set(nrm.subarray(t*9, t*9+9), i*9);
    V.set(vig.subarray(t*3, t*3+3), i*3); TP[i] = triPart[t];
  }
  for (const c of cells){ for (let i = c.start; i < c.start + c.count; i++) newTriCell[i] = c.id; delete c.tris; }
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  bodyGeo.setAttribute('normal',   new THREE.Float32BufferAttribute(N, 3));
  bodyGeo.computeBoundingBox(); bodyGeo.computeBoundingSphere();
  return { triCell: newTriCell, vig: V, triPart: TP, deadStart };
}

/* ─────────────────────────────────────────────────────────────
   Colour buffer
   ───────────────────────────────────────────────────────────── */
export function createPainter(bodyGeo, cells, vig, deadStart){
  const vertCount = bodyGeo.attributes.position.count;
  const data = new Float32Array(vertCount * 4);
  const attr = new THREE.BufferAttribute(data, 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  bodyGeo.setAttribute('color', attr);

  // unsellable triangles stay paint-coloured in every mode
  for (let i = deadStart * 3; i < vertCount; i++){ data[i*4] = cPaint.r; data[i*4+1] = cPaint.g; data[i*4+2] = cPaint.b; data[i*4+3] = 0; }

  const _c = new THREE.Color();
  const hovered = new Set();
  let pendingRanges = 0, fullUpdate = false;

  function colourOf(cell, hover){
    let col, a;
    if (cell.state === 2){ col = cSel; a = 1.0; }
    else if (cell.state === 1){ col = cSold; a = 0.40; }
    else { col = heatAt(cell.t, _c); a = 0.0; }
    if (hover){ col = _c.copy(col).lerp(cHover, cell.state === 1 ? 0.22 : 0.45); a = Math.max(a, 1.0); }
    return [col.r, col.g, col.b, a];
  }

  function paintCell(cell, hover = hovered.has(cell.id)){
    const [r, g, b, a] = colourOf(cell, hover);
    const v0 = cell.start * 3, v1 = v0 + cell.count * 3;
    for (let v = v0; v < v1; v++){
      const f = vig[v], i = v * 4;
      data[i] = r*f; data[i+1] = g*f; data[i+2] = b*f; data[i+3] = a;
    }
    if (!fullUpdate){
      if (pendingRanges < 200){ attr.addUpdateRange(v0*4, (v1-v0)*4); pendingRanges++; }
      else { fullUpdate = true; attr.clearUpdateRanges(); }
    }
    attr.needsUpdate = true;
  }
  function flush(){ pendingRanges = 0; fullUpdate = false; }
  function paintAll(){ attr.clearUpdateRanges(); fullUpdate = true; for (const c of cells) paintCell(c); }

  function setHover(ids){
    const next = new Set(ids);
    let changed = false;
    for (const id of hovered) if (!next.has(id)){ hovered.delete(id); paintCell(cells[id], false); changed = true; }
    for (const id of next) if (!hovered.has(id)){ hovered.add(id); paintCell(cells[id], true); changed = true; }
    return changed;
  }

  return { attr, paintCell, paintAll, setHover, flush, hovered, colourOf, heatCss };
}

/* ─────────────────────────────────────────────────────────────
   Showroom ⇄ Market transition
   ───────────────────────────────────────────────────────────── */
export function createModeAnimator(material, { reduced = false } = {}){
  const u = material.userData.uniforms;
  let target = 'showroom', anim = null;
  const X0 = -3.4, X1 = 3.6;

  function set(mode, { instant = false, duration = 2.2 } = {}){
    target = mode;
    const to = mode === 'market' ? X1 : X0;
    if (instant || reduced){ u.uWipe.value = to; u.uGlow.value = 0; anim = null; return; }
    anim = { from: u.uWipe.value, to, t0: performance.now(), dur: duration * 1000 };
  }
  function update(){
    if (!anim) return;
    const k = clamp((performance.now() - anim.t0) / anim.dur, 0, 1);
    const e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
    u.uWipe.value = anim.from + (anim.to - anim.from) * e;
    u.uGlow.value = Math.sin(k * Math.PI) * 1.6;
    if (k >= 1){ anim = null; u.uGlow.value = 0; }
  }
  return { set, update, get mode(){ return target; }, get busy(){ return !!anim; } };
}
