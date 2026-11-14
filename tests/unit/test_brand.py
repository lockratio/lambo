"""The logo is a build output of the bank's Lock Ratio brand kit, never hand-kept artwork."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image
from sr_core.workspace import current

RECIPE = Path(__file__).resolve().parents[2] / "assets" / "brand" / "derived.json"


def trim_png():
    spec = importlib.util.spec_from_file_location("trim_png", Path(current().bank_root()) / "tools" / "trim_png.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_logo_matches_a_rebuild_from_the_bank_brand_kit():
    assert trim_png().stale(RECIPE) == [], "rebuild: PY <bank>/tools/trim_png.py --sync assets/brand/derived.json"


def test_check_fails_when_the_logo_is_edited_by_hand(tmp_path):
    copy = tmp_path / "derived.json"
    copy.write_bytes(RECIPE.read_bytes())
    image = Image.open(RECIPE.parent / "lockratio-black.png").convert("RGBA")
    image.putpixel((0, 0), (255, 0, 0, 255))
    image.save(tmp_path / "lockratio-black.png")
    assert trim_png().stale(copy) != []
