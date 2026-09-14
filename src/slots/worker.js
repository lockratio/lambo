/* ═══════════════════════════════════════════════════════════════
   SLOT WORKER
   Pure maths over typed arrays: partitions the paintable surface
   into sellable cells, merges slivers, prices them, shades cell
   seams, and seeds the mock sold inventory from the campaign list.

   in : { positions:Float32Array (non-indexed, 9 floats/tri),
          normals:Float32Array, triPart:Uint8Array (part index/tri),
          parts:string[], campaigns:[{anchor:[x,y,z], radius}] }
   out: see `finish()` — all buffers transferred, nothing copied.
   ═══════════════════════════════════════════════════════════════ */
import { CONFIG, ZONES } from '../config.js';
import { GEO } from '../config.js';
import { zoneOf } from '../zones.js';

const post = (type, data, transfer) => self.postMessage({ type, ...data }, transfer || []);
const progress = (phase, value) => post('progress', { phase, value });

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

self.onmessage = (e) => {
  const { positions, normals, triPart, parts, campaigns } = e.data;
  try { run(positions, normals, triPart, parts, campaigns || []); }
  catch (err){ post('error', { message: err.message, stack: err.stack }); }
};

function run(P, N, triPart, parts, campaigns){
  const CELL = CONFIG.CELL_SIZE;
  const triCount = P.length / 9;
  const triCell = new Int32Array(triCount).fill(-1);

  /* per-triangle scratch */
  const tArea = new Float32Array(triCount);
  const tC = new Float32Array(triCount * 3);
  const tN = new Float32Array(triCount * 3);
  const tZone = new Array(triCount);

  /* ── 1. triangle metrics + zone ─────────────────────────────── */
  for (let t = 0; t < triCount; t++){
    const i = t * 9;
    const ax=P[i],ay=P[i+1],az=P[i+2], bx=P[i+3],by=P[i+4],bz=P[i+5], cx=P[i+6],cy=P[i+7],cz=P[i+8];
    const abx=bx-ax,aby=by-ay,abz=bz-az, acx=cx-ax,acy=cy-ay,acz=cz-az;
    let nx=aby*acz-abz*acy, ny=abz*acx-abx*acz, nz=abx*acy-aby*acx;
    const len=Math.hypot(nx,ny,nz);
    tArea[t]=len*0.5;
    if (len<1e-12) continue;
    nx/=len; ny/=len; nz/=len;
    tN[t*3]=nx; tN[t*3+1]=ny; tN[t*3+2]=nz;
    const mx=(ax+bx+cx)/3, my=(ay+by+cy)/3, mz=(az+bz+cz)/3;
    tC[t*3]=mx; tC[t*3+1]=my; tC[t*3+2]=mz;
    tZone[t] = zoneOf(parts[triPart[t]], [mx,my,mz], [nx,ny,nz]);
    if ((t & 4095) === 0) progress('measure', t / triCount);
  }

  /* ── 2. partition: tri-planar grid per part × zone ──────────── */
  const cellByKey = new Map();
  const cells = [];                       // {id, key, tris[], cx,cy,cz, nx,ny,nz, area, zone, part, axis, u, v}
  for (let t = 0; t < triCount; t++){
    const area = tArea[t];
    if (area < 1e-9) continue;
    const nx=tN[t*3], ny=tN[t*3+1], nz=tN[t*3+2];
    const cx=tC[t*3], cy=tC[t*3+1], cz=tC[t*3+2];

    /* not for sale: underside, and anything facing into the car */
    if (ny < GEO.UNDER_N && cy < GEO.UNDER_Y) continue;
    const ox = 0, oy = cy - GEO.AXIS_Y, oz = cz;           // outward = away from the long axis
    const outward = ny*oy + nz*oz;
    if (outward < -0.04 && Math.abs(nx) < 0.85) continue;  // inward-facing skin (door inners, arch liners)
    if (cy < 0.12) continue;                               // splitter lip, too low to see

    /* dominant axis picks the projection plane, so slots are square
       on the surface instead of stretched */
    const ax=Math.abs(nx), ay=Math.abs(ny), az=Math.abs(nz);
    let axis, u, v;
    if (ay >= ax && ay >= az){ axis = ny>0?'Y+':'Y-'; u=cx; v=cz; }
    else if (az >= ax)       { axis = nz>0?'Z+':'Z-'; u=cx; v=cy; }
    else                     { axis = nx>0?'X+':'X-'; u=cz; v=cy; }
    const gu = Math.floor(u / CELL), gv = Math.floor(v / CELL);
    const part = triPart[t], zone = tZone[t];
    const key = `${part}|${zone}|${axis}|${gu}|${gv}`;

    let cell = cellByKey.get(key);
    if (!cell){
      cell = { id:cells.length, key, tris:[], cx:0,cy:0,cz:0, nx:0,ny:0,nz:0, area:0, zone, part, axis, gu, gv };
      cellByKey.set(key, cell); cells.push(cell);
    }
    cell.tris.push(t);
    cell.cx += cx*area; cell.cy += cy*area; cell.cz += cz*area;
    cell.nx += nx*area; cell.ny += ny*area; cell.nz += nz*area;
    cell.area += area;
    if ((t & 4095) === 0) progress('partition', t / triCount);
  }

  /* ── 3. merge slivers into their grid neighbours ────────────── */
  const nominal = CELL * CELL;
  const alive = new Set(cells.map(c => c.id));
  const findCell = (c, du, dv) => cellByKey.get(`${c.part}|${c.zone}|${c.axis}|${c.gu+du}|${c.gv+dv}`);
  for (let pass = 0; pass < 3; pass++){
    let merged = 0;
    for (const c of cells){
      if (!alive.has(c.id)) continue;
      if (c.area >= nominal * 0.32) continue;
      let best = null, bestScore = -1;
      for (let du=-1; du<=1; du++) for (let dv=-1; dv<=1; dv++){
        if (!du && !dv) continue;
        const nb = findCell(c, du, dv);
        if (!nb || nb === c || !alive.has(nb.id)) continue;
        // prefer edge neighbours over corners, then the larger one
        const score = nb.area * ((du && dv) ? 0.6 : 1.0);
        if (score > bestScore){ best = nb; bestScore = score; }
      }
      if (!best) continue;
      best.tris.push(...c.tris);
      best.cx += c.cx; best.cy += c.cy; best.cz += c.cz;
      best.nx += c.nx; best.ny += c.ny; best.nz += c.nz;
      best.area += c.area;
      c.tris = []; alive.delete(c.id); merged++;
    }
    if (!merged) break;
  }
  /* isolated crumbs with no neighbour stay unsellable */
  const kept = cells.filter(c => alive.has(c.id) && c.area >= nominal * 0.10);
  kept.forEach((c, i) => c.id = i);
  for (const c of kept){
    c.cx/=c.area; c.cy/=c.area; c.cz/=c.area;
    const l=Math.hypot(c.nx,c.ny,c.nz)||1; c.nx/=l; c.ny/=l; c.nz/=l;
    for (const t of c.tris) triCell[t] = c.id;
  }
  progress('partition', 1);

  /* ── 4. price ───────────────────────────────────────────────── */
  let raw = 0;
  for (const c of kept){ c.raw = c.area * (ZONES[c.zone]?.mult ?? 1); raw += c.raw; }
  const rate = CONFIG.TARGET_AUD / raw;               // $ per (m² × multiplier)
  let lo = Infinity, hi = -Infinity;
  for (const c of kept){
    c.price = Math.max(CONFIG.MIN_PRICE, Math.round(c.raw * rate / CONFIG.ROUND_TO) * CONFIG.ROUND_TO);
    lo = Math.min(lo, c.price); hi = Math.max(hi, c.price);
  }
  /* colour by rank, not by value: a handful of premium slots would
     otherwise push everything else into the two darkest steps */
  const byPrice = [...kept].sort((a, b) => a.price - b.price);
  byPrice.forEach((c, i) => { c.t = byPrice.length > 1 ? i / (byPrice.length - 1) : 0.5; });

  /* ── 5. seams: vertices shared by two cells darken ──────────── */
  const vertCount = P.length / 3;
  const vig = new Float32Array(vertCount).fill(1);
  {
    const owner = new Map();            // quantised position → cell id | -2 (shared)
    const q = 1 / 0.0015;
    const keyOf = (i) => `${Math.round(P[i*3]*q)},${Math.round(P[i*3+1]*q)},${Math.round(P[i*3+2]*q)}`;
    for (const c of kept) for (const t of c.tris) for (let k=0;k<3;k++){
      const i = t*3+k, key = keyOf(i);
      const o = owner.get(key);
      if (o === undefined) owner.set(key, c.id);
      else if (o !== c.id && o !== -2) owner.set(key, -2);
    }
    for (const c of kept){
      let maxD = 0;
      for (const t of c.tris) for (let k=0;k<3;k++){
        const i=t*3+k; const d=Math.hypot(P[i*3]-c.cx, P[i*3+1]-c.cy, P[i*3+2]-c.cz);
        if (d>maxD) maxD=d;
      }
      for (const t of c.tris) for (let k=0;k<3;k++){
        const i=t*3+k;
        const seam = owner.get(keyOf(i)) === -2 ? 0.50 : 1.0;
        const d = maxD>1e-6 ? Math.hypot(P[i*3]-c.cx, P[i*3+1]-c.cy, P[i*3+2]-c.cz)/maxD : 0;
        const s = Math.max(0, (d-0.6)/0.4);
        vig[i] = seam * (1 - 0.12 * s*s);
      }
    }
    progress('price', 1);
  }

  /* ── 6. sold inventory from campaigns ───────────────────────── */
  const owner = new Int16Array(kept.length).fill(-1);
  campaigns.forEach((camp, ci) => {
    const [ax, ay, az] = camp.anchor;
    let seed = null, sd = Infinity;
    for (const c of kept){
      if (owner[c.id] >= 0) continue;
      if (camp.zone && c.zone !== camp.zone) continue;
      const d = Math.hypot(c.cx-ax, c.cy-ay, c.cz-az);
      if (d < sd){ sd = d; seed = c; }
    }
    if (!seed) return;
    const r = camp.radius ?? 0.3;
    for (const c of kept){
      if (owner[c.id] >= 0) continue;
      if (c.zone !== seed.zone) continue;
      if (c.nx*seed.nx + c.ny*seed.ny + c.nz*seed.nz < 0.35) continue;
      if (Math.hypot(c.cx-seed.cx, c.cy-seed.cy, c.cz-seed.cz) > r) continue;
      owner[c.id] = ci;
    }
  });

  finish(kept, triCell, vig, owner, { lo, hi, rate, triCount });
}

function finish(kept, triCell, vig, owner, meta){
  const n = kept.length;
  const centroid = new Float32Array(n*3), normal = new Float32Array(n*3);
  const area = new Float32Array(n), price = new Float32Array(n), t = new Float32Array(n);
  const offsets = new Uint32Array(n+1);
  let total = 0;
  for (let i=0;i<n;i++){ offsets[i]=total; total += kept[i].tris.length; }
  offsets[n]=total;
  const tris = new Uint32Array(total);
  const zone = new Array(n), part = new Uint8Array(n);
  for (let i=0;i<n;i++){
    const c = kept[i];
    centroid.set([c.cx,c.cy,c.cz], i*3); normal.set([c.nx,c.ny,c.nz], i*3);
    area[i]=c.area; price[i]=c.price; t[i]=c.t; zone[i]=c.zone; part[i]=c.part;
    tris.set(c.tris, offsets[i]);
  }
  post('done', { centroid, normal, area, price, t, zone, part, offsets, tris, triCell, vig, owner, meta },
       [centroid.buffer, normal.buffer, area.buffer, price.buffer, t.buffer, part.buffer,
        offsets.buffer, tris.buffer, triCell.buffer, vig.buffer, owner.buffer]);
}
