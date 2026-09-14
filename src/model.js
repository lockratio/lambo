/* ═══════════════════════════════════════════════════════════════
   MODEL — loads car.glb, splits meshes by the `role` baked into
   each node's extras, gives every role a material, and merges the
   paintable panels into ONE non-indexed geometry (position + normal
   only) — the contract the slot system depends on.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Role → material. `mobile` drops the expensive transmission pass. */
function materialFor(role, src, mobile){
  const map = src?.map ?? null;
  const M = THREE;
  switch(role){
    case 'glass':
      return mobile
        ? new M.MeshPhysicalMaterial({ color: 0xd6e0e8, transparent: true, opacity: 0.26, roughness: 0.03, metalness: 0, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.0, side: M.DoubleSide, depthWrite: false })
        : new M.MeshPhysicalMaterial({ color: 0xe8eef2, transmission: 0.94, thickness: 0.04, ior: 1.52, roughness: 0.02, metalness: 0, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.0, side: M.DoubleSide, transparent: true, opacity: 1, depthWrite: false });
    case 'glass_tint':
      return new M.MeshPhysicalMaterial({ color: 0x1d2126, transparent: true, opacity: mobile ? 0.82 : 0.78, roughness: 0.06, metalness: 0.1, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.03, side: M.DoubleSide, depthWrite: false });
    case 'lens':
      return new M.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.30, roughness: 0.06, metalness: 0, envMapIntensity: 1.5, clearcoat: 1, depthWrite: false, side: M.DoubleSide });
    case 'lens_red':
      return new M.MeshPhysicalMaterial({ color: 0x9a0b0b, emissive: 0x4a0000, emissiveIntensity: 0.9, transparent: true, opacity: 0.86, roughness: 0.12, metalness: 0, clearcoat: 1, envMapIntensity: 1.2, depthWrite: false });
    case 'lens_amber':
      return new M.MeshPhysicalMaterial({ color: 0xc86a10, emissive: 0x5a2a00, emissiveIntensity: 0.8, transparent: true, opacity: 0.86, roughness: 0.12, metalness: 0, clearcoat: 1, depthWrite: false });
    case 'light':
      return new M.MeshStandardMaterial({ map, color: 0xffffff, metalness: 0.75, roughness: 0.28, envMapIntensity: 1.4 });
    case 'carbon':
      return new M.MeshPhysicalMaterial({ map, color: 0xd9d9d9, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
    case 'plastic':
      return new M.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.72, metalness: 0.0, envMapIntensity: 0.6 });
    case 'chassis':
      return new M.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.95, metalness: 0.05 });
    case 'interior':
      return new M.MeshStandardMaterial({ color: 0x141416, roughness: 0.85, metalness: 0.0 });
    case 'interior_tex':
      return new M.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.85, metalness: 0.0 });
    case 'engine':
      return new M.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.8 });
    case 'metal':
      return new M.MeshStandardMaterial({ color: 0x9a9a9c, roughness: 0.42, metalness: 1.0, envMapIntensity: 1.0 });
    case 'grille':
      return new M.MeshStandardMaterial({ color: 0x050505, roughness: 0.8, metalness: 0.35 });
    case 'mirror':
      return new M.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1.0, envMapIntensity: 1.4 });
    case 'mirror_cap':
      return new M.MeshPhysicalMaterial({ color: 0x08090a, roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 });
    case 'caliper':
      return new M.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.45, metalness: 0.6, envMapIntensity: 1.2 });
    case 'tyre':
      return new M.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.93, metalness: 0.0 });
    case 'rim':
      return new M.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.28, metalness: 1.0, envMapIntensity: 1.2 });
    default:
      return new M.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
  }
}

/** Denormalise any (possibly quantised) attribute into a Float32 attribute. */
function toFloat32(attr){
  const n = attr.count, k = attr.itemSize, out = new Float32Array(n * k);
  for (let i = 0; i < n; i++){
    out[i*k] = attr.getX(i);
    if (k > 1) out[i*k+1] = attr.getY(i);
    if (k > 2) out[i*k+2] = attr.getZ(i);
  }
  return new THREE.Float32BufferAttribute(out, k);
}

/**
 * @returns {{ group, bodyMesh, bodyGeo, triPart:Uint8Array, parts:string[], byRole:Map, byteLength:number }}
 */
export async function loadCar(url, { onProgress, mobile = false, paintMaterial } = {}){
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let byteLength = 0;
  const gltf = await new Promise((res, rej) =>
    loader.load(url, res, (ev) => { byteLength = ev.total || ev.loaded; onProgress?.(ev.loaded, ev.total); }, rej));

  gltf.scene.updateMatrixWorld(true);
  const group = new THREE.Group(); group.name = 'car';
  const byRole = new Map();
  const paintGeos = [], parts = [];
  const paintMeshes = [];

  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const role = o.userData.role ?? 'plastic';
    if (role === 'paint'){
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', toFloat32(o.geometry.attributes.position));
      g.setAttribute('normal',   toFloat32(o.geometry.attributes.normal));
      if (o.geometry.index) g.setIndex(o.geometry.index.clone());
      const nonIndexed = g.index ? g.toNonIndexed() : g;
      nonIndexed.applyMatrix4(o.matrixWorld);
      paintGeos.push(nonIndexed); parts.push(o.userData.part ?? 'shell');
      paintMeshes.push(o);
      return;
    }
    const m = new THREE.Mesh(o.geometry, materialFor(role, o.material, mobile));
    m.name = role; m.userData.role = role;
    m.matrix.copy(o.matrixWorld); m.matrixAutoUpdate = false;
    m.raycast = () => {};                       // only the body is interactive
    const seeThrough = role === 'glass' || role === 'glass_tint' || role.startsWith('lens');
    if (seeThrough) m.renderOrder = 10;
    m.castShadow = !seeThrough && role !== 'interior' && role !== 'interior_tex' && role !== 'engine';
    m.receiveShadow = !seeThrough;
    group.add(m); byRole.set(role, m);
  });

  const bodyGeo = mergeGeometries(paintGeos, false);
  const triCount = bodyGeo.attributes.position.count / 3;
  const triPart = new Uint8Array(triCount);
  let t = 0;
  paintGeos.forEach((g, i) => { const n = g.attributes.position.count / 3; triPart.fill(i, t, t + n); t += n; g.dispose(); });

  const bodyMesh = new THREE.Mesh(bodyGeo, paintMaterial);
  bodyMesh.name = 'body';
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  console.log(`[model] ${url}: ${triCount.toLocaleString()} paint triangles in ${paintGeos.length} panels, ${byRole.size} trim meshes`);
  return { group, bodyMesh, bodyGeo, triPart, parts, byRole, byteLength };
}
