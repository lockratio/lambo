/* ═══════════════════════════════════════════════════════════════
   INTERACTION — hover, brush painting, undo, modes, keyboard.
   Raycasts go through a BVH (mandatory at this triangle count)
   and are throttled to one per animation frame.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { PALETTE } from './config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createInteraction(app, { onSelectionChange, onHover, onModeChange } = {}){
  const { canvas, camera, controls, bodyMesh, bodyGeo, cells, triCell, painter, scene } = app;

  // indirect: the BVH must not rearrange the triangle order — cells are (start, count) ranges into it
  bodyGeo.boundsTree = new MeshBVH(bodyGeo, { indirect: true });
  bodyMesh.raycast = acceleratedRaycast;
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const ptr = new THREE.Vector2();

  const BR_MIN = 0.001, BR_MAX = 0.62;
  const state = {
    mode: 'look', brush: 0, painting: false, erase: false,
    hover: [], lastHit: null, lastEvent: null, dirty: false, down: null,
  };
  const brushRadius = () => BR_MIN + Math.pow(state.brush, 1.7) * (BR_MAX - BR_MIN);
  const singleBrush = () => brushRadius() <= BR_MIN * 1.5;

  /* brush gizmo — a ring hugging the surface */
  const gizmo = new THREE.Mesh(
    new THREE.RingGeometry(0.90, 1.0, 80),
    new THREE.MeshBasicMaterial({ color: PALETTE.selected, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
  gizmo.renderOrder = 999; gizmo.visible = false; scene.add(gizmo);
  const _z = new THREE.Vector3(0, 0, 1);

  /* ── picking ────────────────────────────────────────────── */
  function pick(e){
    const r = canvas.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObject(bodyMesh, false)[0] ?? null;
    if (hit && hit.face){
      // ignore back faces seen through the open cockpit
      const n = hit.face.normal; const d = ray.ray.direction;
      if (n.x*d.x + n.y*d.y + n.z*d.z > 0) return null;
    }
    return hit;
  }
  function cellsUnder(hit){
    if (!hit) return [];
    const r = state.mode === 'select' ? brushRadius() : BR_MIN;
    if (r <= BR_MIN * 1.5){ const id = triCell[hit.faceIndex]; return id >= 0 ? [id] : []; }
    const out = [], p = hit.point, fn = hit.face.normal, r2 = r * r;
    for (const c of cells){
      const dx = c.c[0]-p.x, dy = c.c[1]-p.y, dz = c.c[2]-p.z;
      if (dx*dx + dy*dy + dz*dz > r2) continue;
      if (c.n[0]*fn.x + c.n[1]*fn.y + c.n[2]*fn.z < 0.25) continue;
      out.push(c.id);
    }
    return out;
  }

  /* ── undo ───────────────────────────────────────────────── */
  const undoStack = [];
  function snapshot(){ undoStack.push(Uint8Array.from(cells, c => c.state)); if (undoStack.length > 60) undoStack.shift(); }
  function undo(){
    const s = undoStack.pop(); if (!s) return false;
    let changed = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i].state !== s[i] && cells[i].state !== 1){ cells[i].state = s[i]; painter.paintCell(cells[i]); changed++; }
    if (changed) onSelectionChange?.();
    return true;
  }

  /* ── painting ───────────────────────────────────────────── */
  function applyBrush(ids, erase){
    let changed = false;
    for (const id of ids){
      const c = cells[id];
      if (c.state === 1) continue;
      const want = erase ? 0 : 2;
      if (c.state !== want){ c.state = want; changed = true; painter.paintCell(c); }
    }
    if (changed) onSelectionChange?.();
    return changed;
  }
  function selectCells(ids, { add = true, record = true } = {}){
    if (record) snapshot();
    if (!add) for (const c of cells) if (c.state === 2){ c.state = 0; painter.paintCell(c); }
    applyBrush(ids, false) || onSelectionChange?.();
  }
  function deselectCells(ids){ snapshot(); applyBrush(ids, true); }
  function selectZone(zone, { add = true } = {}){ selectCells(cells.filter(c => c.zone === zone && c.state !== 1).map(c => c.id), { add }); }
  function clear(){
    if (!cells.some(c => c.state === 2)) return;
    snapshot();
    for (const c of cells) if (c.state === 2){ c.state = 0; painter.paintCell(c); }
    onSelectionChange?.();
  }

  /* ── modes ──────────────────────────────────────────────── */
  function setMode(m){
    if (state.mode === m) return;
    state.mode = m;
    canvas.classList.toggle('mode-select', m === 'select');
    controls.enableZoom = m === 'look';
    if (m !== 'select') gizmo.visible = false;
    onModeChange?.(m);
  }
  function setBrush(v){ state.brush = clamp(v, 0, 1); if (state.lastHit) state.dirty = true; }

  /* ── pointer plumbing ───────────────────────────────────── */
  canvas.addEventListener('pointermove', e => { state.lastEvent = e; state.dirty = true; }, { passive: true });
  canvas.addEventListener('pointerleave', () => { state.lastEvent = null; state.lastHit = null; painter.setHover([]); gizmo.visible = false; onHover?.([], null, null); });

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    state.down = { x: e.clientX, y: e.clientY, moved: false };
    if (state.mode !== 'select') return;                  // Look: OrbitControls has it
    const hit = pick(e); if (!hit) return;
    const ids = cellsUnder(hit);
    const first = ids.find(id => cells[id].state !== 1);
    state.erase = first !== undefined && cells[first].state === 2;
    state.painting = true; controls.enabled = false;
    snapshot(); applyBrush(ids, state.erase);
    canvas.setPointerCapture?.(e.pointerId);
  });
  addEventListener('pointermove', e => { if (state.down && Math.hypot(e.clientX - state.down.x, e.clientY - state.down.y) > 6) state.down.moved = true; }, { passive: true });
  addEventListener('pointerup', e => {
    if (state.down && !state.down.moved && state.mode === 'look' && e.button === 0 && e.target === canvas && !canvas.classList.contains('mode-pan') && !e.shiftKey){
      const hit = pick(e);
      if (hit){ const ids = cellsUnder(hit); if (ids.length){ setMode('select'); snapshot(); applyBrush(ids, false); } }
    }
    state.down = null; state.painting = false; controls.enabled = true;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    if (state.mode !== 'select') return;
    e.preventDefault();
    setBrush(state.brush - Math.sign(e.deltaY) * 0.055);
    onBrushChange?.();
  }, { passive: false });

  let onBrushChange = null;

  addEventListener('keydown', e => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z'){ e.preventDefault(); undo(); return; }
    if (mod) return;
    switch(e.key){
      case 'Escape': setMode('look'); break;
      case 's': case 'S': setMode('select'); break;
      case 'l': case 'L': setMode('look'); break;
      case '[': case ',': setBrush(state.brush - 0.06); onBrushChange?.(); break;
      case ']': case '.': setBrush(state.brush + 0.06); onBrushChange?.(); break;
      case 'Delete': case 'Backspace': clear(); break;
    }
  });

  ['pointerdown', 'wheel', 'touchstart'].forEach(ev => canvas.addEventListener(ev, () => { controls.autoRotate = false; }, { once: true, passive: true }));

  /* one raycast per frame, however fast the trackpad fires */
  function frame(){
    if (!state.dirty || !state.lastEvent) return;
    state.dirty = false;
    const e = state.lastEvent;
    const hit = pick(e); state.lastHit = hit;
    const ids = cellsUnder(hit);
    state.hover = ids;
    painter.setHover(ids);
    if (hit && state.mode === 'select' && !singleBrush()){
      gizmo.visible = true;
      gizmo.position.copy(hit.point).addScaledVector(hit.face.normal, 0.01);
      gizmo.quaternion.setFromUnitVectors(_z, hit.face.normal);
      const s = brushRadius(); gizmo.scale.set(s, s, s);
    } else gizmo.visible = false;
    if (state.painting && hit) applyBrush(ids, state.erase);
    onHover?.(ids, e, hit);
  }

  return {
    state, frame, setMode, setBrush, brushRadius, singleBrush,
    selectCells, deselectCells, selectZone, clear, undo,
    get canUndo(){ return undoStack.length > 0; },
    set onBrushChange(fn){ onBrushChange = fn; },
    get mode(){ return state.mode; },
  };
}
