"""Inject the shared CSS layers into every page's inline <style> block.

The site stays no-build at runtime: the CSS is written into the served HTML,
so nothing render-blocks and the repo remains directly deployable. What the
build removes is the maintenance tax of seven hand-kept copies, which had
already drifted — the type scale, the 44px tap targets, the opaque mobile
menu and the language-toggle contrast all reached index.html and none of the
subpages.

Each page owns a generated region delimited by the markers below; everything
outside it is the page's own CSS and is never touched. Re-running is
idempotent: the region is replaced, not appended.

Usage: build/.venv/bin/python build/build_css.py [--check]

  --check  exit 1 if any page is out of date instead of writing (for a
           pre-deploy guard; nothing is modified)
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Sequence
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CSS_DIR = Path(__file__).resolve().parent / "css"

BEGIN = "/* === generated:begin — build/css/{layers}, injected by build/build_css.py."
BEGIN_TAIL = "\n   Edit those files and re-run the build; do not edit this block. === */"
END = "/* === generated:end === */"

REGION_PATTERN = re.compile(
    r"/\* === generated:begin.*?/\* === generated:end === \*/", re.DOTALL
)
FONT_URL = re.compile(r"url\(fonts/")

# Which layers each page takes. /dziekuje/ is a terminal page with no nav and
# no language toggle, so it takes tokens only; the shell would need five
# overrides to undo on a page that never shows navigation.
PAGE_LAYERS: dict[str, tuple[str, ...]] = {
    "index.html": ("base", "shell"),
    "privacy/index.html": ("base", "shell"),
    "case-studies/index.html": ("base", "shell"),
    "case-studies/wordpress-speed/index.html": ("base", "shell"),
    "case-studies/ksef-woocommerce/index.html": ("base", "shell"),
    "case-studies/notion-operating-system/index.html": ("base", "shell"),
    "case-studies/generateblocks-pro-traps/index.html": ("base", "shell"),
    "dziekuje/index.html": ("base",),
}


def load_layer(name: str) -> str:
    return (CSS_DIR / f"{name}.css").read_text(encoding="utf-8").strip()


def depth_prefix(page: str) -> str:
    """Relative hop from the page back to the site root, for font URLs."""
    return "../" * (len(Path(page).parts) - 1)


def render_region(page: str, layers: Sequence[str]) -> str:
    layer_names = " + ".join(f"{layer}.css" for layer in layers)
    header = BEGIN.format(layers=layer_names) + BEGIN_TAIL
    body = "\n\n".join(load_layer(layer) for layer in layers)
    prefix = depth_prefix(page)
    if prefix:
        body = FONT_URL.sub(f"url({prefix}fonts/", body)
    return f"{header}\n{body}\n{END}"


def rebuilt_page(page: str, layers: Sequence[str]) -> str:
    """The page's HTML carrying a freshly rendered generated region."""
    html = (REPO / page).read_text(encoding="utf-8")
    region = render_region(page, layers)

    if REGION_PATTERN.search(html):
        # A plain replacement string would treat a backslash in the CSS as a
        # group reference, so hand re.sub a function that returns it verbatim.
        return REGION_PATTERN.sub(lambda _: region, html, count=1)

    if "<style>" not in html:
        raise SystemExit(f"{page}: no <style> block to inject into")
    return html.replace("<style>", f"<style>\n{region}", 1)


def stale_pages() -> list[str]:
    return [
        page
        for page, layers in PAGE_LAYERS.items()
        if rebuilt_page(page, layers) != (REPO / page).read_text(encoding="utf-8")
    ]


def write_pages(pages: Sequence[str]) -> None:
    for page in pages:
        (REPO / page).write_text(
            rebuilt_page(page, PAGE_LAYERS[page]), encoding="utf-8"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="report out-of-date pages without writing",
    )
    options = parser.parse_args()

    stale = stale_pages()

    if options.check:
        if stale:
            print("stale pages:", ", ".join(sorted(stale)))
            sys.exit(1)
        print(f"{len(PAGE_LAYERS)} pages up to date")
        return

    write_pages(sorted(stale))
    for page in sorted(stale):
        print(f"updated {page}")
    print(f"{len(stale)} of {len(PAGE_LAYERS)} pages rewritten")


if __name__ == "__main__":
    main()
