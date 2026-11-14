"""The site in a headless browser, served the way tools and the docs serve it."""
from __future__ import annotations

from pathlib import Path

import pytest
from sr_local_server_kit.app import App
from sr_local_server_kit.browser import Browser

ROOT = Path(__file__).resolve().parents[2]
READY = "window.__slots && window.__slots.cells && window.__slots.cells.length > 0"


@pytest.fixture
def page():
    server = App(root=ROOT).start()
    try:
        with Browser(timeout=20) as browser:
            browser.open(f"http://127.0.0.1:{server.server_address[1]}/")
            browser.wait(READY, timeout=60)
            yield browser
            assert browser.errors == [], browser.errors
    finally:
        server.shutdown()
        server.server_close()


def total(page) -> int:
    return int("".join(ch for ch in page.text("#cartTotal") if ch.isdigit()) or 0)


def test_every_info_page_opens_from_the_nav_and_closes_back_to_the_car(page):
    for name in ("how", "pricing", "advertisers", "faq", "contact"):
        page.click(f'#nav a[data-page="{name}"]')
        page.wait(f"!document.getElementById('pages').hidden && document.querySelector('.page.on[data-page=\"{name}\"]') !== null")
        assert page.eval("location.hash") == f"#/{name}"
    page.click("#pageClose")
    page.wait("document.getElementById('pages').hidden")
    assert page.eval("location.hash") in ("", "#/")


def test_view_controls_switch_mode_zoom_and_reset(page):
    page.click("#vMarket")
    page.wait("document.getElementById('vMarket').getAttribute('aria-pressed') === 'true'")
    page.click("#vShowroom")
    page.wait("document.getElementById('vMarket').getAttribute('aria-pressed') === 'false'")
    before = page.eval("__slots.camera.position.length()")
    page.click("#zoomIn")
    page.wait(f"__slots.camera.position.length() < {before} - 0.01")
    page.click("#logo")
    page.wait(f"Math.abs(__slots.camera.position.length() - {before}) < 0.05", timeout=10)


def test_selecting_a_whole_panel_from_the_price_table_fills_the_cart_and_clear_empties_it(page):
    page.click('#nav a[data-page="pricing"]')
    page.click("#priceTable")
    page.click("#tableDlg button.mini:not([disabled])")
    page.eval("document.getElementById('tableDlg').open && document.getElementById('tableClose').click()")
    page.wait("!document.getElementById('reserve').disabled")
    assert total(page) > 0
    page.eval("document.getElementById('clear').click()")
    page.wait("document.getElementById('reserve').disabled")
    assert total(page) == 0


def test_dragging_the_brush_across_the_car_selects_slots(page):
    page.click("#mSelect")
    # screen point of the free slot whose centre is nearest the camera, so the drag starts on the paint
    x, y = page.eval("""(() => { const { camera, cells, THREE, canvas } = __slots, r = canvas.getBoundingClientRect();
      const free = cells.filter(c => c.state === 0), cam = camera.position;
      const c = free.reduce((a, b) => Math.hypot(...a.c.map((v, i) => v - cam.getComponent(i))) <= Math.hypot(...b.c.map((v, i) => v - cam.getComponent(i))) ? a : b);
      const v = new THREE.Vector3(...c.c).project(camera);
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; })()""")
    mouse = lambda kind, dx, buttons: page.call("Input.dispatchMouseEvent", {"type": kind, "x": x + dx, "y": y, "button": "left", "buttons": buttons, "clickCount": 1})
    mouse("mouseMoved", 0, 0)
    mouse("mousePressed", 0, 1)
    for step in range(1, 6):
        mouse("mouseMoved", step * 4, 1)
    mouse("mouseReleased", 20, 0)
    page.wait("!document.getElementById('reserve').disabled")
    assert total(page) > 0
