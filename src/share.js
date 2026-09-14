/* ═══════════════════════════════════════════════════════════════
   DEEP LINKS — selection + camera + mode in the URL hash.
   #m=market&c=θ,φ,r,tx,ty,tz&s=12-15,40,88-90
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

function encodeIds(ids){
  const s = [...ids].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; ){
    let j = i; while (j + 1 < s.length && s[j+1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`); i = j + 1;
  }
  return out.join(',');
}
function decodeIds(str, max){
  const out = [];
  for (const tok of (str || '').split(',')){
    if (!tok) continue;
    const [a, b] = tok.split('-').map(Number);
    if (Number.isNaN(a)) continue;
    for (let i = a; i <= (b ?? a); i++) if (i >= 0 && i < max) out.push(i);
  }
  return out;
}

export function createShare({ camera, controls, cells, getMode }){
  const f = (v) => Number(v.toFixed(3));

  function build({ withCamera = true } = {}){
    const p = new URLSearchParams();
    p.set('m', getMode());
    if (withCamera){
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      p.set('c', [f(s.theta), f(s.phi), f(s.radius), f(controls.target.x), f(controls.target.y), f(controls.target.z)].join(','));
    }
    const sel = cells.filter(c => c.state === 2).map(c => c.id);
    if (sel.length) p.set('s', encodeIds(sel));
    return `${location.origin}${location.pathname}#${p.toString()}`;
  }

  function read(){
    const h = location.hash.replace(/^#/, ''); if (!h) return null;
    const p = new URLSearchParams(h);
    const out = { mode: p.get('m') };
    if (p.get('c')){
      const [theta, phi, radius, tx, ty, tz] = p.get('c').split(',').map(Number);
      if (![theta, phi, radius, tx, ty, tz].some(Number.isNaN)) out.camera = { theta, phi, radius, target: new THREE.Vector3(tx, ty, tz) };
    }
    out.selection = decodeIds(p.get('s'), cells.length);
    out.isLink = !!(out.camera || out.selection.length);
    return out;
  }

  let t;
  function remember(){                       // keep the URL current without spamming history
    clearTimeout(t);
    t = setTimeout(() => {
      const any = cells.some(c => c.state === 2);
      const url = any ? build({ withCamera: false }).replace(location.origin + location.pathname, '') : location.pathname + location.search;
      history.replaceState(null, '', url);
    }, 400);
  }

  async function copy(){
    const url = build();
    history.replaceState(null, '', url.replace(location.origin + location.pathname, ''));
    try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
  }

  return { build, read, remember, copy };
}
