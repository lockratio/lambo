# Build brief — Aventador advertising-slot site

Instructions for the next build pass. Read this in full before writing code.

The goal: a full-screen 3D Lamborghini Aventador whose bodywork is divided into
~1,000 purchasable advertising slots, priced by visibility, totalling ~$1.1M AUD.
Visitors orbit the car, paint over panels with a size-adjustable brush, see live
pricing, and reserve slots. A working draft of this already exists — your job is
to replace its placeholder car with the purchased model, then build it out.

---

## 0. Current state of the repo

| Path | State |
|---|---|
| `index.html` | **The working draft.** Single self-contained file, ~1,250 lines. Everything below refers to it. |
| `tools/serve.py` | Dev server. `python tools/serve.py 8777` → http://127.0.0.1:8777/ |
| `MODEL.md` | Earlier model-swap notes. Partly superseded by this document — where they disagree, follow this one. |
| `vendor/three/` | **Broken.** See §0.2. |
| `src/carScene.js` | Unused parallel skeleton. Loads `./assets/models/car.glb`. Not wired to anything. |
| `src/main.js` | Original stub — writes the text "lambo" into `#app`. Dead. |
| `assets/models/` | Empty. This is where the model goes. |
| `styles/main.css` | Near-empty stub. Dead — all CSS lives inside `index.html`. |

### 0.1 What already works in `index.html`

Verified working in Chrome:

- Full-bleed canvas, no page scroll, HUD floats over the car as glass panels
- Orbit / zoom / idle turntable that stops on first interaction
- ~1,041 slots generated from mesh geometry at load
- Price heatmap (single-hue amber ramp), prices normalised so all slots sum to $1.1M
- Two-mode interaction: **Look** (drag orbits, scroll zooms) and **Select** (drag paints, scroll sizes brush)
- Brush with world-space radius, visible ring gizmo, drag-to-paint, drag-from-selected-to-erase
- Cursor tooltip showing zone, summed price, and sold/available state
- Live cart with running total, Reserve (mock) and Clear
- Funding meter with mock sold inventory clustered into advertiser patches
- Panel rail that selects a whole zone and flies the camera to it

### 0.2 Known defects — fix these

1. **`vendor/three/` is unusable.** `vendor/three/three.module.js` contains
   `import { ... } from './three.core.js'`, and `three.core.js` was never copied
   across. Modern three.js splits its build across those two files. Symptom:
   *"Failed to fetch dynamically imported module"* with an HTTP 200 and a correct
   `text/javascript` content-type, which is misleading — the fetch succeeds and
   the nested import is what fails.
   **Fix:** add `three.core.js` from the same three.js release (r169) next to it,
   then point the import map in `index.html` at `./vendor/three/` instead of the
   jsDelivr CDN. The page then runs fully offline. Verify by loading with
   DevTools throttled to Offline.

2. **Panel-rail fly-to does not move the orbit target.** Clicking a panel in the
   right-hand rail switches mode correctly but `controls.target` stays at its
   original value, so the camera swings without recentring. The `flyTo()` lerp
   and `OrbitControls.update()` are fighting over `camera.position` /
   `controls.target` on the same frame. Rewrite the fly as a
   spherical-coordinate animation driven *through* OrbitControls
   (set `controls.target`, then derive `camera.position` from a target
   azimuth/polar/radius) rather than lerping `camera.position` directly.

3. **Placeholder proportions.** `buildCarBody()` produces a generic wedge. This
   disappears entirely once the real model is in — do not spend time on it.

4. **Startup blocks the main thread** for several seconds. See §5.

### 0.3 The contract everything else depends on

The slot system reads **only** these two things from whatever mesh arrives:

```js
bodyGeo.attributes.position   // non-indexed: 3 consecutive vertices per triangle
bodyGeo.attributes.normal
```

It then writes its own `color` attribute, which the material shows via
`vertexColors: true`. Any mesh satisfying that contract works. Keep this true —
it is what makes the model swappable.

---

## 1. Investigate the purchased model folder

**Do this first and write the findings down before changing any code.** Most of
the decisions below depend on what is actually in the package.

### 1.1 Inventory

```bash
find <model-dir> -type f -printf '%10s  %p\n' | sort -k2
```

Record:

- **Formats present.** Look for `.glb`, `.gltf`, `.fbx`, `.obj`, `.blend`, `.max`,
  `.c4d`, `.dae`. A `.glb` is ideal. A `.blend` is the best fallback because
  Blender exports clean glTF.
- **Texture set.** Count, resolution, and naming — base colour / albedo, normal,
  roughness, metallic, AO, opacity. Note the total size on disk; car packages
  routinely ship 4K or 8K textures that are far too heavy for the web.
- **Whether textures are embedded** (`.glb`) or external (`.gltf` + `.bin` + a
  textures folder).
- **Any licence or readme file.** Read it. See §9.

### 1.2 Open it and answer these questions

Load it in Blender (or https://gltf-viewer.donmccurdy.com/ for glTF) and record:

1. **Triangle count.** The Sketchfab listing said ~134k, which is good for the
   web, but the purchased package may be the un-decimated source and much heavier.
2. **Is the body split into separately-named meshes?** This is the single most
   important question. If you find objects like `hood`, `door_L`, `roof`,
   `bumper_F`, `fender_R`, you can define advertising zones from **real panel
   names** instead of the geometric heuristics the draft uses — dramatically
   better pricing and selection. If it is one welded mesh, keep the geometric
   approach.
3. **Which meshes are NOT bodywork?** Glass, tyres, rims, brake calipers,
   headlights, tail lights, grilles, vents, mirrors, interior, badges,
   numberplate, exhaust tips. These must be excluded from the sellable surface —
   nobody is buying ad space on a tyre. List their exact names.
4. **Orientation and units.** Which axis is up (Blender is Z-up, three.js is
   Y-up)? Which way does the nose point? What is the length in scene units — is
   1 unit 1 metre, 1 cm, or 1 inch?
5. **UV layout.** Open the UV editor on a body panel. **Are the left and right
   sides stacked on top of each other in UV space?** Car models almost always
   mirror their UVs to halve texture memory. If they are mirrored, texture-space
   approaches (§7 Option A) will paint both sides of the car at once and are off
   the table until you generate a second, non-overlapping UV set.
6. **Are there shape keys, armatures, or animation?** Usually not on a car, but
   check — they complicate merging geometry.

### 1.3 Decide the pipeline from those answers

| Finding | Action |
|---|---|
| `.glb` present, <150k tris, Y-up, metres | Drop it straight in. Go to §2. |
| `.glb` present but heavy | Optimise first — §2.2. |
| Only `.fbx` / `.obj` / `.blend` | Convert in Blender — §2.1. |
| Body is separate named panels | Use name-based zones — §4.2. Much better. |
| UVs mirrored | Rule out the texture-atlas ad approach for now — §7. |

---

## 2. Get a web-ready `.glb`

### 2.1 Converting in Blender

1. Import the source file.
2. Delete cameras, lights, and any studio/backdrop geometry that shipped with it.
3. Set the scene to metric, 1 unit = 1 metre. Scale the car so it measures
   **4.78 m long, 2.03 m wide, 1.14 m tall** (real Aventador dimensions).
4. Rotate so the nose points along **+X** and up is **+Y** after export
   (Blender's glTF exporter handles the Z-up → Y-up conversion; verify the
   result rather than trusting it).
5. Apply all transforms (`Ctrl+A` → All Transforms).
6. Place the origin at the centre of the car, on the ground plane, so the wheels
   sit at y = 0.
7. Keep the object hierarchy and object names — you need them for §4.2.
8. Export as **glTF Binary (.glb)**, +Y up, with materials and textures included.

Save it as **`assets/models/car.glb`** — the loader already looks for that path.

### 2.2 Optimising

Use [gltf-transform](https://gltf-transform.dev/):

```bash
npx @gltf-transform/cli optimize in.glb assets/models/car.glb \
  --texture-compress webp --texture-size 2048 --compress meshopt
```

Targets:

- **Under 150k triangles.** Decimate in Blender if needed, but protect panel
  edges and silhouettes — use a Decimate modifier with "Planar" on flat panels
  rather than "Collapse" everywhere.
- **Under ~8 MB total.** Textures dominate; 2K is plenty at the zoom levels this
  page uses.
- **Meshopt or Draco compression.** If you use these, the loader must register
  the matching decoder:

  ```js
  import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
  loader.setMeshoptDecoder(MeshoptDecoder);
  ```

  Forgetting this produces a silent load failure.
- Keep an **uncompressed high-poly copy** outside the repo for future re-bakes.

---

## 3. Wire the model in

The loader is already written. In `index.html`, find:

```js
const MODEL_URLS = ['./assets/models/car.glb', './assets/models/aventador.glb'];
const CAR_LENGTH = 4.78;
async function loadRealCar(){ ... }
const realGeo  = await loadRealCar();
const usingReal = !!realGeo;
const bodyGeo  = realGeo ?? buildCarBody();
```

It already: probes each URL with a `HEAD` request, loads via `GLTFLoader`, bakes
each mesh's world matrix, strips all attributes except position and normal,
converts to non-indexed, merges everything into one geometry, auto-rotates if the
model was authored across Z, scales to `CAR_LENGTH`, and re-centres onto the
ground plane. It falls back to the procedural body if no file is found, and hides
the procedural wheels when a real model loads.

**So the first step is literally just to drop the file in and reload.** Then:

1. Check the console line `[slots] loaded ./assets/models/car.glb — N triangles`.
2. If the car faces backwards, set `PRE_ROTATE = Math.PI` (it is a named constant
   inside `loadRealCar`).
3. Confirm the car sits on the ground and is centred. The fake contact shadow is
   a flat plane at y ≈ 0 — if the car floats or sinks, the normalisation needs
   adjusting, not the shadow.
4. Open `window.__slots` in the console (a draft-only debug handle) to inspect
   `camera`, `controls`, `cells`, `bodyGeo`, `STATE`.

Once it renders, **delete `buildCarBody()` and `buildWheel()`** and the
`usingReal` fallback branch. Also delete `src/carScene.js`, `src/main.js`, and
`styles/main.css` — they are dead scaffolding and will confuse the next reader.

---

## 4. Split the mesh by role, and fix the zones

### 4.1 Paintable vs non-paintable

The current loader merges **every** mesh into one blob, which means glass,
wheels, lights and interior all become sellable slots. Change it to build two
groups while traversing:

```js
const NON_PAINTABLE = /glass|window|windshield|tyre|tire|wheel|rim|brake|caliper|
                       light|lamp|grille|vent|mirror|interior|seat|badge|logo|
                       exhaust|plate/i;
```

- **Paintable** meshes → merged into `bodyGeo`, get slots, use the slot material.
- **Non-paintable** meshes → added to the scene with their **original materials
  from the glTF**, and excluded from the raycast.

Glass in particular needs its own transmissive material and must stay
semi-transparent — do not let it become an opaque amber tile.

Note the windscreen is listed in the price table as a premium slot. Decide
deliberately: either keep glass non-paintable and drop that zone, or treat the
windscreen as a special decal-only surface. Real-world legality favours the
latter — a fully covered windscreen is not road legal, and a perforated
window-graphic is what actually gets sold.

### 4.2 Zones from panel names

If §1.2(2) found named panels, replace the geometric `zoneOf(c, n)` function with
a name lookup built while traversing the glTF: record, for each triangle range,
which source mesh it came from, and map mesh name → zone. Keep the geometric
function as the fallback for unmatched meshes.

This is a significant quality win: "Driver's door" is a better thing to sell than
"Door", and pricing per real panel is defensible to an advertiser.

### 4.3 Re-tune the slot grid

`CELL_SIZE = 0.148` (metres) and the `calibrate()` block derive `AXIS_Y` and
`D_THETA` from the mesh bounding box, so slot size stays roughly constant on any
model. After swapping, check the resulting slot count — aim for **800–1,500**.
Fewer and the brush feels coarse; more and the price per slot drops below a
sensible minimum order.

Cell edges will be noticeably crisper on the real model than on the placeholder,
because cell boundaries snap to triangle edges and the real mesh has much smaller
triangles. This is expected.

---

## 5. Make it load fast

The draft does all its work synchronously at startup and blocks the main thread
for several seconds — the loading screen genuinely cannot animate during it.
Fix in this order, highest impact first.

1. **Move slot generation into a Web Worker.** The partition pass, the per-vertex
   gutter shading pass, pricing, and the mock sold-inventory seeding are all pure
   maths over typed arrays. Transfer `position` and `normal` as transferable
   `ArrayBuffer`s, return the cell table and a `Uint32Array` of triangle→cell
   ids. This alone removes nearly all the jank.

2. **Render before the slots exist.** Show the car in plain white paint as soon
   as the glTF is parsed. Fade the heatmap in when the worker reports back. The
   visitor sees a car in about a second instead of a spinner for five.

3. **Report real progress.** `GLTFLoader.load()` gives an `onProgress` callback
   with `loaded`/`total` — drive the loading bar from it instead of the current
   indeterminate sweep. Follow it with a determinate "pricing panels…" phase fed
   by worker progress messages.

4. **`await renderer.compileAsync(scene, camera)`** before the first frame.
   Shader compilation for a clearcoat physical material is a visible hitch
   otherwise.

5. **Cache the computed slot table in IndexedDB**, keyed by a hash of the model
   file plus `CELL_SIZE`. Second visit skips the whole computation.

6. **Lazy-load the environment map.** Render with a cheap ambient light first,
   swap in the PMREM-generated studio environment a frame later.

7. **Raycast cost.** Every pointer move raycasts the body mesh. At 150k triangles
   three.js's default raycast is a linear scan and will drop frames. Add a BVH
   (`three-mesh-bvh`) — this becomes mandatory above roughly 50k triangles.

8. **Throttle hover work** to one raycast per animation frame rather than per
   pointer event. Trackpads fire far more often than 60 Hz.

---

## 6. White paint

This is not just a colour change — the current material derives its colour
entirely from the per-slot vertex colours, so "white" and "heatmap" are in direct
conflict. Resolve it deliberately.

### 6.1 The material

```js
new THREE.MeshPhysicalMaterial({
  color: 0xeceae6,        // NOT pure white — 1.0 blows out under ACES tonemapping
  metalness: 0.0,
  roughness: 0.38,
  clearcoat: 1.0,
  clearcoatRoughness: 0.06,
  envMapIntensity: 1.1,
})
```

White paint reads as white through its **shading**, not its albedo. What sells it:
a bright studio environment with visible rectangular softboxes (the existing
`studioEnv()` already builds strip lights — keep that), strong clearcoat, and a
dark background for the silhouette to read against. Push exposure down slightly
(`toneMappingExposure ≈ 0.95`) so the highlights roll off instead of clipping.

Against a white car, the current dark-grey "sold" colour will read as dirt. Move
sold slots to a **light warm grey** and let *unsold* slots carry the amber.

### 6.2 Blending paint and data

Add a uniform via `material.onBeforeCompile` that mixes between the white paint
albedo and the slot colour:

```js
// uSlotMix: 0 = showroom white, 1 = full price heatmap
diffuseColor.rgb = mix(PAINT_WHITE, vColor.rgb, uSlotMix);
```

Then expose it in the UI as a **"Showroom / Market" toggle or slider**:

- **Showroom** — a clean white Aventador. This is the shot people share.
- **Market** — the heatmap. This is the shot that sells slots.
- Your own selection and any sold slots should stay visible in *both* modes at
  reduced strength, so the car never looks unsold.

Default to Showroom for the first few seconds, then animate to Market. That
transition — a pristine white car dissolving into a priced grid — is the single
most persuasive moment available to this page. Build it deliberately.

---

## 7. Showing example advertising on the car

Right now a sold slot is just a flat colour. Advertisers need to see their
artwork on the car, and browsers need to see that the car is filling up.

### Option A — dynamic texture atlas *(best, needs clean UVs)*

Render all campaign artwork into an offscreen canvas laid out in the model's UV
space, upload as a texture, and blend it over the paint in the shader. Scales to
hundreds of ads at one draw call, and the same canvas can be exported as a
print-ready wrap file.

**Blocked if the UVs are mirrored (§1.2.5).** Unblocking means generating a second
non-overlapping UV set with `xatlas` as a one-off build step and shipping it as a
`uv2` attribute.

### Option B — decal projection *(recommended to start)*

`DecalGeometry` from `three/addons/geometries/DecalGeometry.js` projects an image
onto the mesh surface along a direction, generating geometry that conforms to the
body's curvature — it wraps over a fender correctly.

```js
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
```

For each campaign: take the selection's centroid and averaged normal (the panel
rail already computes exactly these two values), build a decal oriented to that
normal, sized to the selection's bounding box, textured with the logo. No UV
dependency. Good up to roughly 30–50 decals before draw calls hurt.

### Option C — average colour *(what the draft does)*

Tint the slot with the advertiser's dominant brand colour. Nearly free. Useful as
the far-zoom LOD: show colours from a distance, swap to real decals when the
camera is close.

### Build an example mode

Ship `data/campaigns.json` with 12–20 fictional brands — name, brand colour, a
placeholder logo SVG, and a list of slot ids — and render them as decals. Two
reasons this matters more than it looks:

1. A car that visibly has ads on it proves the product works. An empty car looks
   like a prototype.
2. It is the honest preview an advertiser needs before paying.

Keep example brands obviously fictional. Do not render real companies' logos on
the car to imply they are customers.

Then add **artwork upload**: file picker → canvas → live decal at the current
selection, with a real specification (minimum resolution per slot at 150 dpi
print, accepted formats, safe margins, no transparency at the edges). This is the
feature that converts a browser into a buyer, and it should be iteration two.

---

## 8. UI improvements

The existing HUD layout is sound — keep the structure. All styling runs off CSS
custom properties in one `:root` block at the top of `index.html`; re-skinning to
Lock Ratio branding means editing that block only.

Priorities:

1. **Mobile.** Currently only a non-broken fallback, not a designed experience.
   It needs its own layout: tap-to-select preset panels rather than a freehand
   brush, pinch-zoom, a bottom sheet for pricing, and a much lighter render path
   (halve pixel ratio, drop clearcoat, skip the environment map).
2. **Onboarding.** First-time visitors do not know they can paint. A 3-second
   ghosted hand animation dragging across a panel, once, would carry more than
   the current text hint.
3. **Selection summary.** The cart shows a count and a total. It should group by
   panel — "Bonnet ×12 · $14,400" — and let you remove a group.
4. **Undo.** Painting is destructive and a mis-drag can wipe a careful selection.
   `Ctrl+Z` over a stack of selection snapshots.
5. **Price transparency.** Clicking a slot should explain *why* it costs what it
   does — panel, area, visibility multiplier. This is what makes the pricing feel
   fair rather than arbitrary.
6. **Deep links.** Encode the current selection and camera angle into the URL so
   people can share a specific configuration. Cheap, and it is the main organic
   growth mechanism this project has.
7. **Sold-slot attribution.** Hovering a sold slot shows the advertiser. Make it
   a link. It is part of what the advertiser is buying.
8. **Accessibility.** Keyboard access to panel selection, a text/table view of
   all slots and prices, and respect for `prefers-reduced-motion` (the turntable
   already checks it — extend to the camera flights).
9. **Loading state.** Replace "Preparing the car…" with something on-brand and
   determinate, and never show it for more than about a second once §5 is done.

---

## 9. The rest of the project

### Backend — the part that does not exist at all

Everything is currently client-side mock data. You need:

- **Slot inventory** in a real database, with the price table generated once and
  versioned. Never trust a price sent from the client.
- **Reservation with a TTL.** Slots held for ~15 minutes during checkout, then
  released. This needs to be atomic — two advertisers must not be able to buy the
  same slot.
- **Payments.** Stripe is the obvious choice. Remember GST for an Australian
  entity and that the price displayed must include it.
- **Artwork review queue.** You are putting other people's images on a physical
  car that drives in public. You need a human approval step and clear content
  rules published up front — no political content, no adult content, no competitor
  disparagement, and a right of refusal.
- **A signed contract per advertiser**: duration, what happens if the car is sold
  or written off, refund terms, where and how often the car will be seen.

### Legal — resolve before launch, not after

- **Model licence.** Confirm the Payhip licence covers use in a commercial,
  public, interactive web product. Many 3D marketplace licences cover renders and
  games but restrict resale-adjacent commercial use. Get this in writing.
- **Trademark.** The site is named after, and sells space on, a Lamborghini. You
  are using their trade dress commercially. Take advice. Consider removing badges
  from the model and naming the site after the project rather than the marque.
- **Attribution.** If you end up using a CC-BY model instead, attribution must
  appear on the page. `#credit` in the HUD is where it goes.
- **Advertising standards.** Australian consumer law applies to what your
  advertisers put on the car, and some of that exposure lands on you.

### Sequencing

1. Real model in, white paint, showroom/market toggle — the thing you can show people.
2. Worker-based loading and the BVH — the thing that stops it feeling broken.
3. Example campaigns as decals — the thing that proves the concept.
4. Backend, reservations, payments — the thing that takes the money.
5. Artwork upload and review — the thing that fulfils the order.

Do not build 4 before 1–3 are convincing. The hard part of this project is not
the transaction, it is persuading an advertiser that a slot on a car is worth
four figures. Everything in steps 1–3 exists to make that case.
