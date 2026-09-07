#!/usr/bin/env python3
"""Prove that a lead carries where it came from — the hidden `source` field.

`js/source.js` records the FIRST touch of a visit on every page and writes it into the
contact form. Four cases, each a different truth the field has to tell:

  external   a visitor arrives from another site, walks to the home page, and the form
             still names the site that sent him, not helban.dev
  direct     no referrer at all says so plainly instead of inventing one
  campaign   utm tags from the landing URL ride along
  no script  the field keeps the value baked into the HTML, because that is what a
             no-JS visitor actually submits

The check serves the repo on one port and a stand-in "external site" on another, so the
cross-origin referrer is real rather than faked with an override.

    build/.venv/bin/python build/check_source_field.py

Mutation control (the reason to trust a green run): make `externalReferrer` in
js/source.js return "" unconditionally and the EXTERNAL case must go red; drop the
`value="bez JS"` attribute from the form field and NO SCRIPT must go red.

Nothing here submits the form. A live POST would deliver a fake lead to the real inbox,
which has already happened once on this site.
"""

from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import Browser, sync_playwright

SITE_ROOT = Path(__file__).resolve().parent.parent
SITE_PORT = 8090
EXTERNAL_PORT = 8091
SITE = f"http://localhost:{SITE_PORT}"
EXTERNAL = f"http://localhost:{EXTERNAL_PORT}"
ENTRY_PAGE = "/case-studies/wordpress-speed/"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """One page load is ~15 requests; the access log buries the four verdicts."""

    def log_message(self, format: str, *args: object) -> None:
        pass


def serve(directory: Path, port: int) -> socketserver.TCPServer:
    handler = partial(QuietHandler, directory=str(directory))
    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def source_value(browser: Browser, *, javascript: bool, walk_from_external: bool,
                 query: str = "") -> str:
    context = browser.new_context(java_script_enabled=javascript)
    page = context.new_page()
    if walk_from_external:
        page.goto(f"{EXTERNAL}/", wait_until="load")
        page.click("#entry")
        page.wait_for_url(f"{SITE}{ENTRY_PAGE}")
    page.goto(f"{SITE}/{query}", wait_until="load")
    value = page.input_value("#fSource")
    # The field is only worth anything if it actually travels with the submission.
    in_form_data = page.evaluate(
        "() => new FormData(document.getElementById('orderForm')).get('source')"
    ) if javascript else value
    context.close()
    if in_form_data != value:
        raise AssertionError(f"pole ma '{value}', a FormData niesie '{in_form_data}'")
    return value


def main() -> int:
    with TemporaryDirectory() as external_dir:
        (Path(external_dir) / "index.html").write_text(
            f'<!doctype html><meta charset="utf-8"><title>Stand-in</title>'
            f'<a id="entry" href="{SITE}{ENTRY_PAGE}">case study</a>',
            encoding="utf-8",
        )
        site_server = serve(SITE_ROOT, SITE_PORT)
        external_server = serve(Path(external_dir), EXTERNAL_PORT)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                cases = {
                    "EXTERNAL": (
                        source_value(browser, javascript=True, walk_from_external=True),
                        f"localhost:{EXTERNAL_PORT} → {ENTRY_PAGE}",
                    ),
                    "DIRECT": (
                        source_value(browser, javascript=True, walk_from_external=False),
                        "wejście bezpośrednie → /",
                    ),
                    "CAMPAIGN": (
                        source_value(browser, javascript=True, walk_from_external=False,
                                     query="?utm_source=newsletter&utm_medium=email"),
                        "wejście bezpośrednie → / (utm_source=newsletter, utm_medium=email)",
                    ),
                    "NO SCRIPT": (
                        source_value(browser, javascript=False, walk_from_external=False),
                        "bez JS",
                    ),
                }
                browser.close()
        finally:
            site_server.shutdown()
            external_server.shutdown()

    failures = 0
    for case, (measured, expected) in cases.items():
        verdict = "OK " if measured == expected else "BŁĄD"
        if measured != expected:
            failures += 1
        print(f"{verdict} {case}: {measured!r}")
        if measured != expected:
            print(f"     oczekiwane: {expected!r}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
