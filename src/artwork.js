/* ═══════════════════════════════════════════════════════════════
   ARTWORK PREVIEW — the advertiser's own image on their selection.
   File picker → texture → decal sized to the selected patch, with
   a print specification derived from the patch's real dimensions.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { CONFIG } from './config.js';

export const SPEC = {
  dpi: 150,                       // print resolution the wrap shop needs
  marginMm: 15,                   // safe margin inside the patch
  formats: 'PNG, JPG or SVG',
  maxBytes: 25 * 1024 * 1024,
};

/** Tangent frame + bounding box of a set of cells on the body. */
export function patchFrame(cells){
  const c = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
  let area = 0;
  for (const cl of cells){ c.addScaledVector(p.set(...cl.c), cl.area); n.addScaledVector(p.set(...cl.n), cl.area); area += cl.area; }
  c.divideScalar(area); n.normalize();
  // keep only the cells that face roughly the same way, so a selection
  // that wraps around a corner is measured on its dominant face
  const facing = cells.filter(cl => cl.n[0]*n.x + cl.n[1]*n.y + cl.n[2]*n.z > 0.45);
  const use = facing.length >= 2 ? facing : cells;
  const up = Math.abs(n.y) > 0.75 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tu = new THREE.Vector3().crossVectors(up, n).normalize();
  const tv = new THREE.Vector3().crossVectors(n, tu).normalize();
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const cl of use){
    p.set(...cl.c).sub(c);
    const u = p.dot(tu), v = p.dot(tv);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const pad = CONFIG.CELL_SIZE * 0.5;
  const w = (u1 - u0) + pad * 2, h = (v1 - v0) + pad * 2;
  const centre = c.clone().addScaledVector(tu, (u0 + u1) / 2).addScaledVector(tv, (v0 + v1) / 2);
  return { centre, n, tu, tv, w, h, cells: use };
}

export function specFor(frame){
  const wmm = frame.w * 1000, hmm = frame.h * 1000;
  const px = mm => Math.ceil(mm / 25.4 * SPEC.dpi);
  return {
    wmm, hmm,
    minPx: [px(wmm), px(hmm)],
    text: `Patch ${fmt(wmm)} × ${fmt(hmm)} mm · supply at least ${px(wmm).toLocaleString()} × ${px(hmm).toLocaleString()} px (${SPEC.dpi} dpi) as ${SPEC.formats} · keep ${SPEC.marginMm} mm clear inside the edge · no transparency at the edges`,
  };
}
const fmt = mm => mm >= 1000 ? (mm/1000).toFixed(2) + ' m' : Math.round(mm) + '';

export function createArtwork(app, { toast }){
  const { bodyMesh, cells, group: carGroup } = app;
  const layer = new THREE.Group(); layer.name = 'artwork'; carGroup.add(layer);
  let current = null;

  async function fromFile(file){
    if (!file) return;
    if (file.size > SPEC.maxBytes){ toast(`<b>That file is too large.</b> Keep artwork under ${SPEC.maxBytes/1024/1024} MB for the preview.`); return; }
    const sel = cells.filter(c => c.state === 2);
    if (!sel.length){ toast('<b>Select some slots first.</b> Your artwork is fitted to the patch you have painted.'); return; }
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { toast(`<b>Could not read that image.</b> Use ${SPEC.formats}.`); return; }
    // draw into a canvas: ImageBitmap uploads ignore texture.flipY and come out mirrored
    const max = 2048, k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas'); c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height); bitmap.close?.();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    place(tex, c.width / c.height, sel, { name: file.name, px: [Math.round(c.width / k), Math.round(c.height / k)] });
  }

  function place(texture, aspect, sel, meta){
    clear();
    const f = patchFrame(sel);
    let w = f.w, h = f.h;
    if (w / h > aspect) w = h * aspect; else h = w / aspect;   // fit, never stretch
    const basis = new THREE.Matrix4().makeBasis(f.tu, f.tv, f.n);
    const geo = new DecalGeometry(bodyMesh, f.centre, new THREE.Euler().setFromRotationMatrix(basis), new THREE.Vector3(w, h, 0.32));
    const mat = new THREE.MeshStandardMaterial({
      map: texture, transparent: true, depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.42, metalness: 0, envMapIntensity: 0.7,
    });
    current = new THREE.Mesh(geo, mat); current.renderOrder = 6; current.raycast = () => {};
    layer.add(current);
    const spec = specFor(f);
    const short = meta?.px && (meta.px[0] < spec.minPx[0] || meta.px[1] < spec.minPx[1]);
    toast(`<b>${meta?.name ?? 'Artwork'} fitted to your ${sel.length} slots.</b> ${spec.text}.${short ? ` <b>Your file is ${meta.px[0]} × ${meta.px[1]} px — too small for print; fine for a preview.</b>` : ''}`, 12000);
    return spec;
  }

  function clear(){
    if (!current) return;
    layer.remove(current); current.geometry.dispose(); current.material.map?.dispose(); current.material.dispose(); current = null;
  }

  return { fromFile, clear, get placed(){ return !!current; }, specFor: () => { const sel = cells.filter(c => c.state === 2); return sel.length ? specFor(patchFrame(sel)) : null; } };
}
