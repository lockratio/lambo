"""Budgets for what a visitor downloads and waits for. Numbers measured 2026-11-14 on the owner's PC."""
from __future__ import annotations

import re
import time
from pathlib import Path

from sr_local_server_kit.app import App
from sr_local_server_kit.browser import Browser

ROOT = Path(__file__).resolve().parents[2]


def test_first_load_weight_stays_under_budget():
    # measured 4.16 MB: car.glb 1.13 MB and vendored three; budget leaves ~10% headroom
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    local = {ROOT / src.lstrip("./") for src in re.findall(r'(?:src|href)="(\./[^"#?]+)"', html)}
    files = local | {ROOT / "assets/models/car.glb"} | set((ROOT / "src").rglob("*.js")) | set((ROOT / "vendor").rglob("*.js"))
    weight = sum(path.stat().st_size for path in files if path.is_file())
    assert weight < 4_600_000, weight
    assert (ROOT / "assets/brand/lockratio-black.png").stat().st_size < 150_000


def test_page_is_ready_to_paint_slots_within_budget():
    # measured 7.8 s with a cold IndexedDB (car download, slot worker); limited by the worker and loopback stalls
    server = App(root=ROOT).start()
    try:
        with Browser(timeout=30) as page:
            start = time.perf_counter()
            page.open(f"http://127.0.0.1:{server.server_address[1]}/")
            page.wait("window.__slots && window.__slots.cells && window.__slots.cells.length > 0", timeout=60)
            assert time.perf_counter() - start < 15
            assert page.errors == []
    finally:
        server.shutdown()
        server.server_close()
