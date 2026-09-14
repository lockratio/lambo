# Polish pass — 2026-09-15

Brief: white ultra-real car with a few sticker-bomb ads, white-room Tesla-style UI
(Roboto, blue #1955FF / purple #7E37FF, grey #808080, yellow #D1CC00 accent), lateral
pan, mobile-first landscape with an upright nav pane, info pages with transitions,
Lock Ratio logo that resets the camera, ergonomic controls, GitHub Pages ready.

Note on the brief's colour list: "#D1CC00" is a yellow and "#808080" is a grey, so
the labels were read as swapped — grey for text/dark features, yellow as the
tertiary accent. Selected slots use the yellow so they read against the blue→purple
price ramp.

## Stages

| # | Stage | Files | Status |
|---|---|---|---|
| 1 | Design system: tokens, Roboto, off-white room, faint "lightning" line pattern | `styles/main.css`, `assets/bg/lines.svg`, `index.html` | |
| 2 | 3D realism: HDR white-studio environment, white clearcoat paint, cast shadow that sweeps with the orbit, glass glint, white floor | `src/scene.js`, `src/paint.js`, `src/model.js`, `src/config.js` | |
| 3 | Stickers: die-cut sticker decals, slight random tilt, fewer campaigns | `src/campaigns.js`, `data/campaigns.json` | |
| 4 | Camera: centre the car in the free area (view offset), lateral pan (right-drag / shift-drag / Move tool / two-finger), presets, logo → front reset | `src/scene.js`, `src/viewctl.js`, `src/camera.js` | |
| 5 | Nav + pages: top bar, hash-routed overlay pages (How it works, Pricing, Advertisers, FAQ, Contact) with staged transitions; "Be on this Lambo" floating header | `src/nav.js`, `index.html`, `styles/main.css` | |
| 6 | Ergonomics: brush stepper with detents, zoom ±, auto-rotate toggle, sound ticks (mutable), keyboard | `src/sfx.js`, `src/hud.js`, `src/interact.js` | |
| 7 | Mobile: landscape prompt with fullscreen + orientation lock, compact landscape HUD, upright nav drawer, portrait fallback | `src/nav.js`, `styles/main.css` | |
| 8 | GitHub Pages: `.nojekyll`, relative paths, meta/OG, favicon, README deploy notes | root | |

## Decisions log
(appended as work progresses)

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

## Stage status (2026-09-15)
All eight stages built and checked in Chrome (desktop 1536×791, phone landscape 844×390, phone portrait 390×760 via the harness). Not verified on a real touch device — `pointer: coarse` paths (two-finger pan, haptics, orientation lock) are by construction only.

## Bug found on the way
`#view` (the canvas) had `position:fixed; inset:0` but no CSS width/height, so it kept its intrinsic drawing-buffer size (viewport × devicePixelRatio) and overflowed the window by 25 % on a 1.25-DPR screen. That is why the car looked "too far to the right" and why picking drifted. Fixed with `width:100%;height:100%`; all framing numbers were re-tuned afterwards.
