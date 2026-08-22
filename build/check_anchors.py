#!/usr/bin/env python3
"""Fail the build when an in-page anchor points at an id that does not exist.

Written after a footer link to `#case-studies` survived the section being removed from the
home page in July: the repo's own CLAUDE.md recorded the rule ("nothing may anchor to it")
and the footer never got it, in both language trees. Nothing was watching, so it shipped.

    python3 build/check_anchors.py            # every page in the repo
    python3 build/check_anchors.py --self-test   # positive control, must report a break

Exit 1 on the first page with a dead anchor.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Sequence
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", ".venv", "node_modules", ".impeccable"}
ANCHOR_HREF = re.compile(r'href\s*=\s*"#([^"]+)"')
ELEMENT_ID = re.compile(r'\bid\s*=\s*"([^"]+)"')
# `#top` is a browser built-in: it scrolls to the document start with no element behind it.
ALWAYS_VALID = {"top"}


def pages() -> list[Path]:
    return sorted(
        path for path in REPO_ROOT.rglob("*.html")
        if not any(part in SKIP_DIRS for part in path.parts)
    )


def dead_anchors(markup: str) -> list[str]:
    present = set(ELEMENT_ID.findall(markup)) | ALWAYS_VALID
    return sorted({target for target in ANCHOR_HREF.findall(markup) if target not in present})


def report(page_paths: Sequence[Path]) -> int:
    broken_pages = 0
    for page in page_paths:
        missing = dead_anchors(page.read_text(encoding="utf-8"))
        if missing:
            broken_pages += 1
            relative = page.relative_to(REPO_ROOT)
            for target in missing:
                print(f"{relative}: href=\"#{target}\" nie ma odpowiednika id=\"{target}\"")
    print(f"Sprawdzono {len(page_paths)} stron, z martwymi kotwicami: {broken_pages}")
    return 1 if broken_pages else 0


def self_test() -> int:
    """A checker that cannot fail is decoration; prove it fails on a page that is broken."""
    intact = '<a href="#services">x</a><section id="services"></section>'
    broken = '<a href="#services">x</a><section id="something-else"></section>'
    if dead_anchors(intact):
        print("KONTROLA UJEMNA PADŁA: zdrowa strona zgłoszona jako zepsuta")
        return 1
    if dead_anchors(broken) != ["services"]:
        print("KONTROLA DODATNIA PADŁA: zepsuta strona przeszła")
        return 1
    print("Kontrole zdane: zdrowa strona cicho, zepsuta zgłoszona.")
    return 0


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("--self-test", action="store_true")
    options = cli.parse_args()
    return self_test() if options.self_test else report(pages())


if __name__ == "__main__":
    sys.exit(main())
