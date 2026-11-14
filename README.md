# Be on this Lambo · Aventador advertising slots

A full-screen 3D Lamborghini Aventador SV Roadster in a white studio, its bodywork divided into ~960 purchasable advertising slots priced by visibility and totalling $1.1M AUD. Visitors orbit and pan the car, paint slots with a brush, see live pricing, preview their own artwork on the panel, and reserve. Example advertisers appear as die-cut stickers; info pages (how it works, pricing, advertisers, FAQ, contact) are hash-routed overlays.

No build step. Plain ES modules, everything vendored — the page runs offline and deploys to GitHub Pages as-is.

## Deploy to GitHub Pages

1. Push the repo (the `.venv`, `node_modules` and caches are git-ignored; `assets/`, `vendor/`, `src/`, `styles/`, `data/`, `index.html` are all that the page needs).
2. Settings → Pages → *Deploy from a branch* → `main` / root.
3. Done. `.nojekyll` is present so the `vendor/` folder is served untouched; every URL in the page is relative, so it works at `https://<user>.github.io/<repo>/` or on a custom domain (add a `CNAME` file). Deep links use the hash (`#/pricing`, `#m=…&s=…`) so no server routing is needed.

Placeholder to confirm before launch: the contact address `advertise@lockratio.com` in `index.html`.

## Run

```powershell
..\..\CORE\.venv\Scripts\python.exe -m sr_local_server_kit serve --root . --port 8777   # http://127.0.0.1:8777/
```

That is the workspace bank's static server (no-store caching). Any static server works; ES modules need HTTP, not `file://`.
Tests, promote and the logo copy: see `AGENTS.md`.

## Layout

| Path | What |
|---|---|
| `index.html` | Page shell: top bar + nav, floating header, HUD, info pages, mobile drawer, rotate prompt. |
| `styles/main.css` | All styling. Design tokens (Lock Ratio blue `#1955FF`, purple `#7E37FF`, grey `#808080`, yellow `#D1CC00`, Roboto) live in the `:root` block at the top. Mobile layout is switched on by `html.mobile`, with landscape/portrait media queries inside. |
| `assets/bg/lines.svg` | The faint geometric line pattern behind the room (generated). |
| `assets/brand/` | Lock Ratio logo, a copy built from the bank's brand kit by `assets/brand/derived.json`. Never edit it by hand. |
| `src/nav.js` | Hash router for the info pages (`#/how`, `#/pricing`, …), the mobile drawer and the rotate-your-phone prompt. |
| `src/viewctl.js` | Camera presets (logo = reset to front three-quarter), zoom steps, the Move (pan) tool, auto-rotate, keyboard. |
| `src/sfx.js` | Synthesised interface ticks (brush detents, presets, slot pops). Mutable; preference persists. |
| `src/main.js` | Boot sequence: car first, slots off-thread, then the reveal. |
| `src/config.js` | Every tunable: target value, cell size, zone table + multipliers, geometric split thresholds. Shared with the worker. |
| `src/zones.js` | Panel → zone assignment (named parts + geometric split of the welded shell). |
| `src/slots/worker.js` | Web Worker: partition, sliver merge, pricing, seam shading, campaign seeding. Pure typed-array maths. |
| `src/slots/client.js` | Runs the worker, caches the result in IndexedDB keyed by model + config hash. |
| `src/model.js` | Loads `car.glb`, materials per role, merges paint panels into one non-indexed geometry (the slot contract: position + normal only). |
| `src/paint.js` | White clearcoat paint with the slot-colour mix and the Showroom ⇄ Market wipe; per-cell colour buffer. |
| `src/scene.js` | Renderer, camera, orbit + pan, half-float HDR white-studio environment, key light that follows the camera (so the cast shadow sweeps as you orbit), shadow catcher, contact shadow, view offset that frames the car in the HUD's free area. |
| `src/camera.js` | Flights animated through OrbitControls (target first, spherical position from it). |
| `src/interact.js` | BVH raycast, brush, undo, modes, keyboard. |
| `src/campaigns.js` | Example advertisers rendered as die-cut sticker decals (rect / pill / badge, slight tilt) from `data/campaigns.json`. |
| `src/artwork.js` | Upload preview: fits an image to the selection as a decal, derives the print spec. |
| `src/share.js` | Deep links (`#m=…&c=…&s=…`). |
| `src/hud.js` | All DOM wiring: cart grouped by panel, funding, rail, tooltip, table, onboarding. |
| `assets/models/car.glb` | The car. 1.14 MB, meshopt + WebP. Built by `tools/build_model.sh`. |
| `data/campaigns.json` | Fictional advertisers, anchors in car space. |
| `tools/build_model.py` | OBJ → glTF converter that bakes a `role`/`part` per mesh. See `notes/model-findings.md`. |
| `vendor/` | three r186 (+ addons used), three-mesh-bvh. |

## Rebuilding the model

```bash
cd tools && npm install            # gltf-transform, three (for vendoring), three-mesh-bvh
bash tools/build_model.sh "<path to Lamborghini_Aventador_SV_Roadster>"
```

Python deps (`numpy`, `pillow`) come from the workspace environment `CORE\.venv`.

## Debug flags

| Query | Effect |
|---|---|
| `?debug=zones` | Paint each zone a distinct hue to check the split. |
| `?mobile=1` | Force the mobile layout and render path. `tools/phone.html?w=844&h=390` wraps the app in a phone-sized iframe for checking it on a desktop. |
| `?tick` | Drive frames from a worker timer instead of `requestAnimationFrame` (for hidden-tab automation only). |

`window.__slots` exposes the scene, cells, interaction and HUD objects in the console.

## Keyboard

`S` select · `L` / `Esc` look · `[` `]` brush size · `Ctrl+Z` undo · `Delete` clear · `M` market / showroom · `R` reset view · `1`–`4` front / side / rear / top · `+` `−` zoom · `H` move tool · hold `Shift` or right-drag to move the car sideways.

## Not built yet

Backend (inventory, atomic reservations with TTL, payments with GST, artwork review) and the legal items in `FABLE-BRIEF.md` §9 — model licence confirmation, trademark advice, advertising standards.

## Design decisions

The brief: a white, realistic car with a few sticker ads in a white room, Roboto, blue `#1955FF` and purple `#7E37FF`, grey `#808080`, yellow `#D1CC00`, mobile-first landscape.

- **Landing view is the Showroom** (white car + stickers). The price heat map wipes in the first time the visitor enters Select mode or clicks Market — the brief wanted the white car to be the showcase.
- **Colour list read as swapped**: `#D1CC00` is used as the yellow accent (your selection), `#808080` as the grey for text/dark features.
- **Environment is a half-float DataTexture**, not a canvas: the softboxes are thin (≈3° tall) and 4–6× brighter than the room, so they draw crisp highlight lines without blowing out the diffuse. First attempt used wide, very bright strips and the bonnet clipped to white at any exposure (measured with `gl.readPixels`: 236/255 at exposure 0.5). Walls run 0.46 → 1.02 floor-to-ceiling so flanks fall off (bonnet ≈ 231, door ≈ 182 in sRGB).
- **Shadow**: key light orbits with the camera at a fixed offset (`KEY_AZ`), so the cast shadow sweeps across the floor as you turn the car; a ShadowMaterial catcher keeps the floor the same off-white as the page.
- **Car framing**: `camera.setViewOffset` shifts the projection centre left/down on desktop (right rail + cart, top bar + hero) — the orbit target stays on the car so panning/rotation feel right. On phones the FOV and preset distance change with orientation instead.
- **Pan**: right-drag, Shift+drag, two-finger drag, or the Move tool; the orbit target is clamped to a box around the car every frame.
- **Mobile**: portrait shows a rotate prompt with a "Go landscape & full screen" button (`requestFullscreen` + `screen.orientation.lock`, silently skipped where unsupported, e.g. iOS Safari) and a "continue in portrait" escape. The nav drawer is DOM, so it is upright in either orientation. Landscape puts the headline in the bar and gives the car the height.
- **Sounds**: synthesised WebAudio blips (no files), created lazily on the first gesture, `navigator.vibrate` on phones, toggle in the dock persisted in `localStorage`.
- **Logo**: the source PNG has real alpha with a dark RGB fill under it; cropped by alpha, 720 px wide. Clicking it resets to the front three-quarter view.
- Contact address `advertise@lockratio.com` is a placeholder to confirm.
- `tools/phone.html` is a dev harness (iframe at a phone size) because the automation window could not be resized.
- The canvas `#view` needs `width:100%;height:100%`. Without it the canvas keeps its drawing-buffer size and overflows the window on a screen with a device pixel ratio above 1, and picking drifts.
- Not checked on a real touch device: two-finger pan, haptics and the orientation lock were checked only in a desktop browser at phone sizes.
