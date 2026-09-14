"""OBJ → glTF binary converter for the Aventador SV Roadster package.

    .venv/Scripts/python tools/build_model.py <package-dir> [out.glb]

Why a bespoke converter instead of Blender: there is no Blender on this
machine, and the OBJ already carries everything we need — per-object names,
materials, UVs and normals. Doing the conversion here also lets us make the
decisions that matter for the slot system at build time and bake them into
the file as glTF `extras`:

  * every mesh gets a `role` (paint / glass / tyre / …) so the page never has
    to guess from names at runtime,
  * paintable panels keep their identity as separate named meshes (with a
    `part` label) while every non-paintable role is merged into a single
    mesh per role, which takes the draw-call count from ~1,400 to ~20,
  * exact-duplicate objects (the package ships several panels twice) are
    dropped, and
  * the car is re-oriented (nose +X, up +Y), scaled to real length, centred
    and put on the ground so the runtime does no normalisation at all.

Run `gltf-transform` afterwards for meshopt compression (see build_model.sh).
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import struct
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

# ────────────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────────────
CAR_LENGTH_M = 4.80          # SV Roadster incl. wing (4.835 with the tall wing)
TEXTURE_MAX = 1024

# Material name → role.  Object-name rules below override these.
MATERIAL_ROLE = {
    'Material.021': 'paint',         # main body shell (artist's red)
    'CAR_PAINT_2': 'paint',
    'Material.022': 'mirror_cap',    # gloss black mirror housings
    'Glass_Clear_Window': 'glass',
    'BLACK_GLASS': 'glass_tint',
    'Glass_-_Optimized': 'glass_tint',
    'GLASS.001': 'lens',
    'RED_GLASS': 'lens_red',
    'ORANGE_GLASS': 'lens_amber',
    'phong15': 'light',
    'CARBON': 'carbon',
    'PLASTIC_BLASK': 'plastic',
    'Material.023': 'plastic',
    'CHASS': 'chassis',
    'Material.025': 'interior',
    'fullINTERIOR': 'interior_tex',
    'fullENGINE': 'engine',
    'fullMETAL': 'metal',
    'GRILLE_S': 'grille',
    'GRILLE_SV': 'grille',
    'GRILE_A': 'grille',
    'MIRROR': 'mirror',
    'CALIPERS': 'caliper',
    'Lamborghini_AventadorLP7504Superveloce_2015CalliperGloss_Materi': 'caliper',
    'Lamborghini_AventadorLP7504Superveloce_2015_Wheel1A_3D_3DWheel1': 'wheel',
    'BADGE': 'drop',                 # marque badges — removed (see brief §9, trademark)
    'Material.024': 'drop',          # marque logo texture
}

# Paintable panels: object-name substring → part label.  The order matters —
# the first match wins.  Everything else with a paint material is 'shell'.
PART_RULES = [
    # (name substring, part label, materials the rule applies to — None = paint only)
    ('spoiler_setsv_me.001',    'wing',         {'CARBON'}),   # carbon in the package; sold as a wrap surface
    ('bumperf_setsv_me',        'front_bumper', None),
    ('bumperr_setsv_me',        'rear_quarter', None),
    ('roof_setr_mesh_l.001',    'roof',         None),
    ('boot_setsv_alta_',        'engine_cover', None),
    ('skirts_setsv_mes',        'sills',        None),
    ('M_CarPaint_Max.043',      'deck',         None),
    ('spoiler_setsv_me',        'shell',        None),
]
PAINT_MATERIALS = {m for m, r in MATERIAL_ROLE.items() if r == 'paint'}

# Textures used by textured roles (relative to <package>/Textures)
ROLE_TEXTURE = {
    'light': 'Image_9.018.png',
    'interior_tex': 'Image_12.019.png',
    'engine': 'Image_1.016.png',
    'carbon': 'black-diagonal-carbon-fiber-seamless-texture-pattern-vector.png',
}

# Base PBR values per role.  The runtime replaces most of these with its own
# materials, but a viewer that opens the .glb on its own should still see a
# sensible car.
ROLE_PBR = {
    'paint':        dict(color=[0.90, 0.90, 0.88, 1], metallic=0.0, roughness=0.35),
    'mirror_cap':   dict(color=[0.02, 0.02, 0.02, 1], metallic=0.0, roughness=0.25),
    'glass':        dict(color=[0.85, 0.90, 0.95, 0.25], metallic=0.0, roughness=0.05, blend=True),
    'glass_tint':   dict(color=[0.05, 0.06, 0.07, 0.75], metallic=0.0, roughness=0.05, blend=True),
    'lens':         dict(color=[0.9, 0.9, 0.9, 0.3], metallic=0.0, roughness=0.1, blend=True),
    'lens_red':     dict(color=[0.6, 0.02, 0.02, 0.8], metallic=0.0, roughness=0.15, blend=True),
    'lens_amber':   dict(color=[0.8, 0.35, 0.02, 0.8], metallic=0.0, roughness=0.15, blend=True),
    'light':        dict(color=[1, 1, 1, 1], metallic=0.6, roughness=0.3),
    'carbon':       dict(color=[1, 1, 1, 1], metallic=0.1, roughness=0.35),
    'plastic':      dict(color=[0.02, 0.02, 0.02, 1], metallic=0.0, roughness=0.75),
    'chassis':      dict(color=[0.03, 0.03, 0.03, 1], metallic=0.2, roughness=0.9),
    'interior':     dict(color=[0.06, 0.06, 0.06, 1], metallic=0.0, roughness=0.8),
    'interior_tex': dict(color=[1, 1, 1, 1], metallic=0.0, roughness=0.8),
    'engine':       dict(color=[1, 1, 1, 1], metallic=0.5, roughness=0.5),
    'metal':        dict(color=[0.55, 0.55, 0.55, 1], metallic=1.0, roughness=0.45),
    'grille':       dict(color=[0.02, 0.02, 0.02, 1], metallic=0.3, roughness=0.7),
    'mirror':       dict(color=[0.9, 0.9, 0.9, 1], metallic=1.0, roughness=0.02),
    'caliper':      dict(color=[0.05, 0.05, 0.05, 1], metallic=0.3, roughness=0.5),
    'tyre':         dict(color=[0.03, 0.03, 0.03, 1], metallic=0.0, roughness=0.9),
    'rim':          dict(color=[0.20, 0.20, 0.21, 1], metallic=1.0, roughness=0.35),
}

TYRE_RADIUS_UNITS = 0.52     # wheel parts whose outer radius exceeds this are rubber


# ────────────────────────────────────────────────────────────────────────────
# OBJ parsing
# ────────────────────────────────────────────────────────────────────────────
def parse_obj(path: Path):
    """Returns (V, VT, VN, objects) where objects is a list of dicts with
    name, material, and a (T,3,3) int array of (v, vt, vn) indices per corner
    (already 0-based, -1 where absent)."""
    V, VT, VN = [], [], []
    objects = []
    cur = None
    mat = None

    def new_obj(name):
        nonlocal cur
        cur = {'name': name, 'material': mat, 'faces': []}
        objects.append(cur)

    with open(path, 'r', errors='ignore') as f:
        for line in f:
            if line.startswith('v '):
                V.append(line.split()[1:4])
            elif line.startswith('vt '):
                VT.append(line.split()[1:3])
            elif line.startswith('vn '):
                VN.append(line.split()[1:4])
            elif line.startswith('o '):
                new_obj(line[2:].strip())
            elif line.startswith('usemtl'):
                mat = line.split()[1]
                if cur is None:
                    new_obj('unnamed')
                cur['material'] = mat
            elif line.startswith('f '):
                corners = []
                for tok in line.split()[1:]:
                    parts = tok.split('/')
                    vi = int(parts[0])
                    ti = int(parts[1]) if len(parts) > 1 and parts[1] else 0
                    ni = int(parts[2]) if len(parts) > 2 and parts[2] else 0
                    corners.append((vi, ti, ni))
                # fan-triangulate (the package is already triangles, but be safe)
                for k in range(1, len(corners) - 1):
                    cur['faces'].append((corners[0], corners[k], corners[k + 1]))

    V = np.asarray(V, dtype=np.float64)
    VT = np.asarray(VT, dtype=np.float64) if VT else np.zeros((0, 2))
    VN = np.asarray(VN, dtype=np.float64) if VN else np.zeros((0, 3))

    def fix(idx, n):
        idx = np.asarray(idx, dtype=np.int64)
        neg = idx < 0
        idx[neg] = n + idx[neg]           # negative indices are relative
        idx[~neg] -= 1                    # 1-based → 0-based; 0 becomes -1 (absent)
        return idx

    out = []
    for o in objects:
        if not o['faces']:
            continue
        F = np.asarray(o['faces'], dtype=np.int64)          # (T,3,3)
        F[..., 0] = fix(F[..., 0], len(V))
        F[..., 1] = fix(F[..., 1], len(VT))
        F[..., 2] = fix(F[..., 2], len(VN))
        out.append({'name': o['name'], 'material': o['material'], 'F': F})
    return V, VT, VN, out


# ────────────────────────────────────────────────────────────────────────────
# Classification
# ────────────────────────────────────────────────────────────────────────────
def classify(obj, V) -> tuple[str, str | None]:
    """→ (role, part)"""
    name, mat = obj['name'], obj['material']
    role = MATERIAL_ROLE.get(mat, 'plastic')
    for needle, part, mats in PART_RULES:
        ok = mat in mats if mats else mat in PAINT_MATERIALS
        if ok and needle in name:
            return 'paint', part
    if role == 'paint':
        return 'paint', 'shell'
    return role, None


def wheel_centres(objects, V):
    """The four biggest wheel objects give the axle positions."""
    big = [o for o in objects if o['material'].endswith('3DWheel1')]
    big.sort(key=lambda o: -len(o['F']))
    centres = []
    for o in big:
        p = V[np.unique(o['F'][..., 0])]
        c = (p.min(0) + p.max(0)) / 2
        if all(np.linalg.norm(c - k) > 1.0 for k in centres):
            centres.append(c)
        if len(centres) == 4:
            break
    return np.asarray(centres)


def wheel_role(obj, V, centres):
    p = V[np.unique(obj['F'][..., 0])]
    c = (p.min(0) + p.max(0)) / 2
    k = centres[np.argmin(np.linalg.norm(centres - c, axis=1))]
    r = np.hypot(p[:, 1] - k[1], p[:, 2] - k[2]).max()      # axle runs along x
    return 'tyre' if r > TYRE_RADIUS_UNITS else 'rim'


# ────────────────────────────────────────────────────────────────────────────
# Geometry building
# ────────────────────────────────────────────────────────────────────────────
def build_primitive(F_list, V, VT, VN, want_uv):
    """Unique (v,vt,vn) corners → indexed arrays."""
    F = np.concatenate(F_list, axis=0).reshape(-1, 3)        # (T*3, 3)
    key = F.copy()
    if not want_uv:
        key[:, 1] = -1
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    pos = V[uniq[:, 0]]
    nrm = np.zeros((len(uniq), 3))
    has_n = uniq[:, 2] >= 0
    nrm[has_n] = VN[uniq[has_n, 2]]
    uv = None
    if want_uv:
        uv = np.zeros((len(uniq), 2))
        has_t = uniq[:, 1] >= 0
        uv[has_t] = VT[uniq[has_t, 1]]
        uv[:, 1] = 1.0 - uv[:, 1]                             # OBJ → glTF flips v
    idx = inv.reshape(-1).astype(np.uint32)
    return pos, nrm, uv, idx


def face_normals_where_missing(pos, nrm, idx):
    missing = np.linalg.norm(nrm, axis=1) < 1e-6
    if not missing.any():
        return nrm
    tri = idx.reshape(-1, 3)
    a, b, c = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
    fn = np.cross(b - a, c - a)
    acc = np.zeros_like(pos)
    for k in range(3):
        np.add.at(acc, tri[:, k], fn)
    n = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)
    nrm = nrm.copy()
    nrm[missing] = n[missing]
    return nrm


def content_hash(obj, V):
    p = V[obj['F'][..., 0].reshape(-1)]
    return hashlib.sha1(np.round(p, 5).tobytes()).hexdigest()


# ────────────────────────────────────────────────────────────────────────────
# GLB writer
# ────────────────────────────────────────────────────────────────────────────
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []
        self.images = []
        self.textures = []
        self.samplers = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
        self.materials = []
        self.meshes = []
        self.nodes = []

    def _view(self, data: bytes, target=None, stride=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        view = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            view['target'] = target
        if stride:
            view['byteStride'] = stride
        self.views.append(view)
        return len(self.views) - 1

    def accessor(self, arr: np.ndarray, ctype: int, atype: str, target: int, minmax=False):
        arr = np.ascontiguousarray(arr)
        vi = self._view(arr.tobytes(), target)
        acc = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': atype}
        if minmax:
            acc['min'] = [float(x) for x in arr.min(0)]
            acc['max'] = [float(x) for x in arr.max(0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def image(self, path: Path):
        im = Image.open(path).convert('RGBA' if path.suffix.lower() == '.png' else 'RGB')
        if max(im.size) > TEXTURE_MAX:
            im.thumbnail((TEXTURE_MAX, TEXTURE_MAX), Image.LANCZOS)
        buf = io.BytesIO()
        if im.mode == 'RGBA' and im.getextrema()[3][0] == 255:
            im = im.convert('RGB')
        im.save(buf, format='PNG', optimize=True)
        vi = self._view(buf.getvalue())
        self.images.append({'bufferView': vi, 'mimeType': 'image/png', 'name': path.stem})
        self.textures.append({'sampler': 0, 'source': len(self.images) - 1})
        return len(self.textures) - 1

    def material(self, name, pbr, tex=None):
        m = {'name': name, 'pbrMetallicRoughness': {
            'baseColorFactor': pbr['color'],
            'metallicFactor': pbr['metallic'],
            'roughnessFactor': pbr['roughness']}}
        if tex is not None:
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': tex}
        if pbr.get('blend'):
            m['alphaMode'] = 'BLEND'
            m['doubleSided'] = True
        self.materials.append(m)
        return len(self.materials) - 1

    def mesh(self, name, pos, nrm, uv, idx, material, extras):
        attrs = {
            'POSITION': self.accessor(pos.astype(np.float32), 5126, 'VEC3', 34962, minmax=True),
            'NORMAL': self.accessor(nrm.astype(np.float32), 5126, 'VEC3', 34962),
        }
        if uv is not None:
            attrs['TEXCOORD_0'] = self.accessor(uv.astype(np.float32), 5126, 'VEC2', 34962)
        if len(pos) < 65536:
            ia = self.accessor(idx.astype(np.uint16), 5123, 'SCALAR', 34963)
        else:
            ia = self.accessor(idx.astype(np.uint32), 5125, 'SCALAR', 34963)
        self.meshes.append({'name': name, 'primitives': [
            {'attributes': attrs, 'indices': ia, 'material': material, 'mode': 4}]})
        self.nodes.append({'name': name, 'mesh': len(self.meshes) - 1, 'extras': extras})

    def write(self, path: Path, asset_extras):
        while len(self.bin) % 4:
            self.bin.append(0)
        gltf = {
            'asset': {'version': '2.0', 'generator': 'lambo/tools/build_model.py', 'extras': asset_extras},
            'scene': 0,
            'scenes': [{'name': 'Aventador SV Roadster', 'nodes': list(range(len(self.nodes)))}],
            'nodes': self.nodes,
            'meshes': self.meshes,
            'materials': self.materials,
            'accessors': self.accessors,
            'bufferViews': self.views,
            'buffers': [{'byteLength': len(self.bin)}],
        }
        if self.images:
            gltf['images'] = self.images
            gltf['textures'] = self.textures
            gltf['samplers'] = self.samplers
        js = json.dumps(gltf, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942))
            f.write(self.bin)
        return total


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────
def main():
    pkg = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('assets/models/car.raw.glb')
    obj_path = pkg / 'Source' / 'svroadster.obj'
    tex_dir = pkg / 'Textures'

    print(f'parsing {obj_path.name} …')
    V, VT, VN, objects = parse_obj(obj_path)
    print(f'  {len(V):,} vertices, {len(objects):,} objects, {sum(len(o["F"]) for o in objects):,} triangles')

    # ── drop exact duplicates ────────────────────────────────────────────────
    seen = {}
    kept = []
    dropped_dupes = 0
    for o in objects:
        h = content_hash(o, V)
        if h in seen:
            dropped_dupes += 1
            continue
        seen[h] = o['name']
        kept.append(o)
    objects = kept
    print(f'  dropped {dropped_dupes} duplicate objects')

    # ── classify ─────────────────────────────────────────────────────────────
    centres = wheel_centres(objects, V)
    for o in objects:
        role, part = classify(o, V)
        if role == 'wheel':
            role = wheel_role(o, V, centres)
        o['role'], o['part'] = role, part
    objects = [o for o in objects if o['role'] != 'drop']

    # ── frame: nose +X, up +Y, metres, centred, wheels on y=0 ────────────────
    # OBJ frame (Blender export): up +Y, nose +Z, width along X.
    R = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=np.float64)   # x'=z, y'=y, z'=-x
    used = np.unique(np.concatenate([o['F'][..., 0].reshape(-1) for o in objects]))
    P = V @ R.T
    N = VN @ R.T
    lo, hi = P[used].min(0), P[used].max(0)
    s = CAR_LENGTH_M / (hi[0] - lo[0])
    P = P * s
    lo, hi = P[used].min(0), P[used].max(0)
    P[:, 0] -= (lo[0] + hi[0]) / 2
    P[:, 2] -= (lo[2] + hi[2]) / 2
    P[:, 1] -= lo[1]
    V, VN = P, N
    lo, hi = V[used].min(0), V[used].max(0)
    print(f'  framed: {hi[0]-lo[0]:.3f} m long, {hi[2]-lo[2]:.3f} m wide, {hi[1]-lo[1]:.3f} m tall; '
          f'wheelbase {abs(centres[0][2]-centres[1][2])*s:.2f} m')

    # ── emit ─────────────────────────────────────────────────────────────────
    glb = GLB()
    tex_index = {}
    mat_index = {}

    def material_for(role):
        if role in mat_index:
            return mat_index[role]
        tex = None
        if role in ROLE_TEXTURE:
            if role not in tex_index:
                tex_index[role] = glb.image(tex_dir / ROLE_TEXTURE[role])
            tex = tex_index[role]
        mat_index[role] = glb.material(role, ROLE_PBR[role], tex)
        return mat_index[role]

    stats = defaultdict(lambda: [0, 0])   # role → [meshes, tris]

    # paintable panels stay separate, named
    paint = [o for o in objects if o['role'] == 'paint']
    for o in paint:
        pos, nrm, uv, idx = build_primitive([o['F']], V, VT, VN, want_uv=False)
        nrm = face_normals_where_missing(pos, nrm, idx)
        glb.mesh(f"paint:{o['part']}", pos, nrm, None, idx, material_for('paint'),
                 {'role': 'paint', 'part': o['part'], 'source': o['name']})
        stats['paint'][0] += 1
        stats['paint'][1] += len(idx) // 3

    # everything else: one mesh per role
    by_role = defaultdict(list)
    for o in objects:
        if o['role'] != 'paint':
            by_role[o['role']].append(o)
    for role, objs in sorted(by_role.items()):
        want_uv = role in ROLE_TEXTURE
        pos, nrm, uv, idx = build_primitive([o['F'] for o in objs], V, VT, VN, want_uv)
        nrm = face_normals_where_missing(pos, nrm, idx)
        glb.mesh(role, pos, nrm, uv, idx, material_for(role),
                 {'role': role, 'sources': len(objs)})
        stats[role][0] += len(objs)
        stats[role][1] += len(idx) // 3

    total = glb.write(out, {
        'source': 'Lamborghini Aventador SV Roadster (Patricars, Payhip)',
        'frame': 'nose +X, up +Y, metres, wheels on y=0',
        'roles': sorted(stats.keys()),
    })
    print(f'wrote {out} ({total/1e6:.2f} MB)')
    print(f'{"role":14s} {"objs":>5s} {"tris":>8s}')
    for role, (n, t) in sorted(stats.items(), key=lambda kv: -kv[1][1]):
        print(f'{role:14s} {n:5d} {t:8,d}')
    print(f'{"total":14s} {sum(v[0] for v in stats.values()):5d} {sum(v[1] for v in stats.values()):8,d}')


if __name__ == '__main__':
    main()
