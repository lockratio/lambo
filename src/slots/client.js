/* ═══════════════════════════════════════════════════════════════
   SLOT CLIENT
   Runs the worker (or serves a cached result from IndexedDB) and
   exposes the cell table in a shape the rest of the app consumes.
   ═══════════════════════════════════════════════════════════════ */
import { CONFIG } from '../config.js';

const DB = 'lambo-slots', STORE = 'tables';

function idb(){
  return new Promise((res, rej) => {
    if (!('indexedDB' in self)) return res(null);
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
}
async function cacheGet(key){
  const db = await idb(); if (!db) return null;
  return new Promise(res => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    tx.onsuccess = () => res(tx.result ?? null); tx.onerror = () => res(null);
  });
}
async function cachePut(key, value){
  const db = await idb(); if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); } catch {}
}

async function hashOf(parts){
  const enc = new TextEncoder().encode(parts.join('|'));
  const buf = await crypto.subtle.digest('SHA-1', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
}

/**
 * @param {object} geo  { positions, normals, triPart, parts, byteLength }
 * @param {object[]} campaigns
 * @param {(phase:string, value:number)=>void} onProgress
 */
export async function computeSlots(geo, campaigns, onProgress){
  const key = await hashOf([
    CONFIG.MODEL_URL, geo.byteLength, geo.positions.length, CONFIG.CELL_SIZE, CONFIG.SLOT_ALGO,
    CONFIG.TARGET_AUD, JSON.stringify(campaigns.map(c => [c.id, c.anchor, c.radius, c.zone])),
  ]);

  const cached = await cacheGet(key);
  if (cached){ onProgress?.('cache', 1); return unpack(cached, campaigns); }

  const result = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.phase, m.value);
      else if (m.type === 'done'){ w.terminate(); resolve(m); }
      else if (m.type === 'error'){ w.terminate(); reject(new Error(m.message + '\n' + m.stack)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error('slot worker failed: ' + e.message)); };
    const positions = geo.positions.slice(), normals = geo.normals.slice(), triPart = geo.triPart.slice();
    w.postMessage({ positions, normals, triPart, parts: geo.parts, campaigns:
      campaigns.map(c => ({ id:c.id, anchor:c.anchor, radius:c.radius, zone:c.zone })) },
      [positions.buffer, normals.buffer, triPart.buffer]);
  });
  delete result.type;
  cachePut(key, result);
  return unpack(result, campaigns);
}

/** Typed-array table → array of cell records (what the UI wants). */
function unpack(r, campaigns){
  const n = r.price.length;
  const cells = new Array(n);
  for (let i=0;i<n;i++){
    cells[i] = {
      id: i,
      c: [r.centroid[i*3], r.centroid[i*3+1], r.centroid[i*3+2]],
      n: [r.normal[i*3],   r.normal[i*3+1],   r.normal[i*3+2]],
      area: r.area[i], price: r.price[i], t: r.t[i],
      zone: r.zone[i], part: r.part[i],
      tris: r.tris.subarray(r.offsets[i], r.offsets[i+1]),
      state: r.owner[i] >= 0 ? 1 : 0,      // 0 free · 1 sold · 2 selected
      owner: r.owner[i] >= 0 ? campaigns[r.owner[i]] : null,
    };
  }
  return { cells, triCell: r.triCell, vig: r.vig, meta: r.meta };
}
