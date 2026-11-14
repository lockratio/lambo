---
title: lambo agent guide
audience: every agent working in this repo
next: README.md for the site layout; the bank's docs/workspace/app-integration.md for the workspace
---

# lambo

A static site: a 3D Lamborghini whose bodywork is sold as advertising slots. Plain ES modules, everything vendored, published to GitHub Pages as-is (`.nojekyll`). It must stay self-contained: the page never loads from the bank at runtime.

## How it wraps the bank

- Dev server: the bank's `sr_local_server_kit` (no-store caching). There is no server of its own.
- Logo: `assets/brand/lockratio-black.png` is built from the bank's brand kit (`assets/brand/lockratio/v2`) by the recipe `assets/brand/derived.json`. Never edit it by hand. After a brand change run `PY <bank>\tools\trim_png.py --sync assets\brand\derived.json` and commit.
- Tests run on the shared environment `CORE\.venv`. No venv here, no `pip install`.

## Run, test, promote

`PY` is `..\..\CORE\.venv\Scripts\python.exe`.

```powershell
& $PY -m sr_local_server_kit serve --root . --port 8777   # http://127.0.0.1:8777/
& $PY -m sr_core test_runner                             # every tier in tests.json
& $PY -m sr_core promote --dry-run                       # then without the flag
```

## Where to look

| Task | File |
|---|---|
| Prices, zones, slot size | `src/config.js`, `src/zones.js`, `src/slots/worker.js` |
| Info pages, drawer, routing | `index.html`, `src/nav.js` |
| HUD, cart, price table | `src/hud.js` |
| Styling | `styles/main.css` |
| Rebuild the car model | `tools/build_model.sh` (needs `npm install` in `tools/`) |
| Tests | `tests/js` (node), `tests/unit`, `tests/e2e`, `tests/perf` |

## Search the bank first

```powershell
& $PY -m sr_core catalogue --find <term>
```

Generic code goes in the bank (`CORE\DEV\shared_resources`), not here.
