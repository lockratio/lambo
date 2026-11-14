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
| `assets/bg/lines.svg` | The faint geometric line pattern behind the room (generated, see `notes/polish-plan.md`). |
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
