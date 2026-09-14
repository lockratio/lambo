# Model investigation — Aventador SV Roadster (Patricars, Payhip)

Findings from the brief's §1 investigation, recorded before any code changed.
Package location: `Bank_DATABASE/Media/3D_MODELS/Lamborghini_Aventador_SV_Roadster`.

## Inventory

| File | Size | Notes |
|---|---|---|
| `Source/svroadster.obj` + `.mtl` | 16.3 MB | **Used.** 135,757 vertices, 134,129 triangles (already triangulated), 1,394 named objects, UVs + normals. |
| `Source/svroadster.fbx` | 11.5 MB | Same content, binary. Not needed. |
| `Source/svroadster.dae` | 37 MB | Same content, Blender 4.1.1 Collada export. Used only to read the material → texture bindings. |
| `Source/svroadster.blend` / `.blend1` | 7.7 MB | Source scene. No Blender on the build machine, so not used. |
| `Source/svroadster.stl` | 6.7 MB | Geometry only. Ignored. |
| `Textures/*.png` (8) | ≤ 1024² | Interior (Image_12), lights (Image_9), engine (Image_1), badge (Image_10), carbon weave, plus four unreferenced small maps. |
| `…lamborghini-brand-logo….jpg` | — | Marque logo. **Not shipped** (trademark). |

No licence or readme file ships in the package. The Payhip licence terms still need to be confirmed in writing for commercial, public, interactive use (brief §9).

## Answers to §1.2

1. **Triangle count:** 134,129 in the package → **125,286 shipped** after dropping 17 exact-duplicate objects and the badges.
2. **Is the body split into named panels?** Partly. The main shell (hood, fenders, doors, upper rear quarters) is **one welded mesh** of 17,056 triangles, confusingly named `…spoiler_setsv_me` (material `Material.021`, the artist's red). Separate paint meshes exist for: front bumper, rear bumper/lower quarter section, roof panels, engine cover, sills, and the windscreen frame/roof rails ("deck"). The rear wing is a separate carbon mesh. Zones are therefore a **hybrid**: named parts map straight to zones, the shell is split geometrically (`src/zones.js`).
3. **Non-bodywork meshes:** glass (`Glass_Clear_Window`, `BLACK_GLASS`, `Glass_-_Optimized`), lenses (`GLASS.001`, `RED_GLASS`, `ORANGE_GLASS`), lights (`phong15`), carbon trim (`CARBON`), black plastic (`PLASTIC_BLASK`, `Material.023`), chassis (`CHASS`), interior (`Material.025`, `fullINTERIOR`), engine (`fullENGINE`), metal (`fullMETAL`), grilles (`GRILLE_S/SV`, `GRILE_A`), mirror glass (`MIRROR`), gloss-black mirror caps (`Material.022`), badges (`BADGE`), wheels (1,298 `polySurface*` objects sharing one material; split into tyre/rim by radius) and callipers. All excluded from the sellable surface and from the raycast.
4. **Orientation / units:** Blender OBJ export, **Y up, nose along +Z**, width along X; 8.63 units long → not metres. The converter rotates to nose +X, scales to 4.80 m, centres X/Z and puts the tyres on y = 0. Resulting car: 4.80 × 2.26 (incl. mirrors) × 1.09 m, wheelbase 2.68 m — matches the real car.
5. **UVs:** present on every object but only meaningful on textured trim (carbon tiles far outside 0–1). The paint meshes have no usable atlas, so the texture-atlas ad approach (brief §7 A) is off the table; decals (§7 B) are used.
6. **Shape keys / armatures / animation:** none.

## Pipeline chosen

`tools/build_model.py` (OBJ → glTF, roles baked into node extras) → `gltf-transform optimize` with meshopt + WebP, no join/palette/simplify so panel identity survives → `assets/models/car.glb` (**1.14 MB**, 125k triangles, 20 draw calls + 8 named paint panels).
Rebuild with `bash tools/build_model.sh "<package-dir>"`.
