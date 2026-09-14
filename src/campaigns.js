/* ═══════════════════════════════════════════════════════════════
   CAMPAIGNS — example advertisers rendered as decals.

   Each campaign in data/campaigns.json owns a patch of slots (the
   worker assigns them from an anchor point). Here we build a logo
   texture per brand on a canvas and project it onto the body with
   DecalGeometry, sized to the patch, oriented to its normal — so
   it wraps over curvature like real vinyl. No UV dependency.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { CONFIG } from './config.js';

export async function loadCampaigns(url = CONFIG.CAMPAIGNS_URL){
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`campaigns: HTTP ${r.status}`);
  return (await r.json()).campaigns;
}

/* ── logo rendering ────────────────────────────────────────── */
const hash = (str) => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const luminance = (hex) => { const c = new THREE.Color(hex); return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b; };

function drawMark(x, kind, cx, cy, r, ink){
  x.fillStyle = ink; x.strokeStyle = ink; x.lineWidth = r * 0.28; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  switch(kind){
    case 'ring':    x.arc(cx, cy, r*0.78, 0, Math.PI*2); x.stroke(); x.beginPath(); x.arc(cx, cy, r*0.28, 0, Math.PI*2); x.fill(); break;
    case 'diamond': x.moveTo(cx, cy-r); x.lineTo(cx+r, cy); x.lineTo(cx, cy+r); x.lineTo(cx-r, cy); x.closePath(); x.fill(); break;
    case 'chevron': x.moveTo(cx-r*0.8, cy-r*0.7); x.lineTo(cx+r*0.2, cy); x.lineTo(cx-r*0.8, cy+r*0.7); x.stroke();
                    x.beginPath(); x.moveTo(cx-r*0.1, cy-r*0.7); x.lineTo(cx+r*0.9, cy); x.lineTo(cx-r*0.1, cy+r*0.7); x.stroke(); break;
    case 'bars':    for (let i=-1;i<=1;i++){ x.fillRect(cx - r*0.9, cy + i*r*0.62 - r*0.16, r*(1.8 - Math.abs(i)*0.6), r*0.32); } break;
    case 'hex':     for (let i=0;i<6;i++){ const a = Math.PI/3*i + Math.PI/6; const px = cx + r*Math.cos(a), py = cy + r*Math.sin(a); i ? x.lineTo(px,py) : x.moveTo(px,py); } x.closePath(); x.fill(); break;
    case 'wave':    x.moveTo(cx-r, cy+r*0.3); x.bezierCurveTo(cx-r*0.5, cy-r*0.9, cx+r*0.5, cy+r*1.3, cx+r, cy-r*0.3); x.stroke(); break;
    case 'square':  x.fillRect(cx-r*0.8, cy-r*0.8, r*1.6, r*1.6); x.fillStyle = 'rgba(0,0,0,0.001)'; break;
    default:        x.arc(cx, cy, r*0.85, 0, Math.PI*2); x.fill();
  }
}

/* ── sticker rendering ─────────────────────────────────────
   Die-cut vinyl: a white border hugging the shape, the brand tile
   inside, a faint edge shadow so it sits *on* the paint. 2:1 tile;
   the transparent margin is what makes the cut look real. */
export function drawSticker(camp, W = 768, H = 384){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const ink = luminance(camp.colour) > 0.45 ? '#1f2128' : '#ffffff';
  const shape = camp.shape ?? 'rect';
  const M = 22;                                   // transparent margin
  const path = (inset) => {
    x.beginPath();
    if (shape === 'pill')       x.roundRect(M + inset, M + inset, W - 2*(M + inset), H - 2*(M + inset), (H - 2*(M + inset)) / 2);
    else if (shape === 'badge'){ const r = H/2 - M - inset; x.ellipse(W/2, H/2, r * 1.55, r, 0, 0, Math.PI*2); }
    else                        x.roundRect(M + inset, M + inset, W - 2*(M + inset), H - 2*(M + inset), 30);
  };
  // edge shadow
  x.save(); x.shadowColor = 'rgba(0,0,0,0.28)'; x.shadowBlur = 14; x.shadowOffsetY = 3;
  x.fillStyle = '#ffffff'; path(0); x.fill(); x.restore();
  // white die-cut border
  x.fillStyle = '#ffffff'; path(0); x.fill();
  // brand tile
  x.fillStyle = camp.colour; path(14); x.fill();
  if (luminance(camp.colour) > 0.85){ x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 3; path(14); x.stroke(); }
  // gloss: a soft diagonal sheen across the top half
  x.save(); path(14); x.clip();
  const g = x.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(0.45, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();

  const cx0 = shape === 'badge' ? 160 : 132;
  drawMark(x, camp.mark, cx0, H/2, 66, ink);
  x.fillStyle = ink; x.textBaseline = 'middle';
  const words = camp.name.split(' ');
  const tx = cx0 + 96, maxW = W - tx - (shape === 'badge' ? 120 : 60);
  x.font = '500 72px Roboto, "Segoe UI", system-ui, sans-serif';
  if (words.length > 1 && x.measureText(camp.name).width > maxW){
    x.font = '500 62px Roboto, "Segoe UI", system-ui, sans-serif';
    x.fillText(words.slice(0, Math.ceil(words.length/2)).join(' '), tx, H/2 - 40, maxW);
    x.fillText(words.slice(Math.ceil(words.length/2)).join(' '), tx, H/2 + 40, maxW);
  } else {
    x.fillText(camp.name, tx, camp.tag ? H/2 - 16 : H/2, maxW);
    if (camp.tag){
      x.font = '400 26px Roboto, "Segoe UI", system-ui, sans-serif'; x.globalAlpha = 0.75;
      x.fillText(camp.tag.toUpperCase(), tx + 2, H/2 + 42, maxW); x.globalAlpha = 1;
    }
  }
  return c;
}

export function makeLogoTexture(camp){
  const t = new THREE.CanvasTexture(drawSticker(camp));
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* ── decals ────────────────────────────────────────────────── */
export function buildDecals(bodyMesh, cells, campaigns, { mobile = false } = {}){
  const group = new THREE.Group(); group.name = 'decals';
  const byOwner = new Map();
  for (const c of cells) if (c.owner) (byOwner.get(c.owner.id) ?? byOwner.set(c.owner.id, []).get(c.owner.id)).push(c);

  const up = new THREE.Vector3(), tu = new THREE.Vector3(), tv = new THREE.Vector3(), p = new THREE.Vector3();
  const aspect = 2.0, margin = CONFIG.CELL_SIZE * 0.55;
  for (const camp of campaigns){
    const owned = byOwner.get(camp.id); if (!owned?.length) continue;
    const c = new THREE.Vector3(), n = new THREE.Vector3();
    let area = 0;
    for (const cl of owned){ c.addScaledVector(new THREE.Vector3(...cl.c), cl.area); n.addScaledVector(new THREE.Vector3(...cl.n), cl.area); area += cl.area; }
    c.divideScalar(area); n.normalize();
    // image "up": upright on the sides, toward the windscreen on top surfaces, +Y on nose/tail
    if (Math.abs(n.y) > 0.75) up.set(-1, 0, 0); else up.set(0, 1, 0);
    tu.crossVectors(up, n).normalize(); tv.crossVectors(n, tu).normalize();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const cl of owned){
      p.set(...cl.c).sub(c);
      const u = p.dot(tu), v = p.dot(tv);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    let w = (u1 - u0) + margin * 2, h = (v1 - v0) + margin * 2;
    if (w / h > aspect) w = h * aspect; else h = w / aspect;
    w = Math.max(w, 0.16); h = Math.max(h, 0.08);
    // sit the decal on the patch centre (bbox centre), not the area centroid
    const centre = c.clone().addScaledVector(tu, (u0 + u1) / 2).addScaledVector(tv, (v0 + v1) / 2);
    // stickers are slapped on by hand: a small deterministic tilt per brand
    const tilt = (hash(camp.id) - 0.5) * THREE.MathUtils.degToRad(14);
    const tu2 = tu.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(tv, Math.sin(tilt));
    const tv2 = tv.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(tu, -Math.sin(tilt));
    const basis = new THREE.Matrix4().makeBasis(tu2, tv2, n);
    const orient = new THREE.Euler().setFromRotationMatrix(basis);
    const geo = new DecalGeometry(bodyMesh, centre, orient, new THREE.Vector3(w, h, 0.32));
    const mat = new THREE.MeshPhysicalMaterial({
      map: makeLogoTexture(camp), transparent: true, depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      roughness: 0.30, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5; mesh.name = `decal:${camp.id}`; mesh.userData.campaign = camp; mesh.receiveShadow = true;
    mesh.raycast = () => {};
    group.add(mesh);
    camp.slots = owned.length; camp.value = owned.reduce((a, cl) => a + cl.price, 0);
  }
  return group;
}
