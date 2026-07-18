"""Generate the English page tree under en/ from the Polish source pages.

The English copy already exists inside the Polish markup, carried by data-en,
data-en-title, data-en-placeholder and data-price-en attributes that main.js
applies in the browser. None of the AI crawlers hitting this domain document
JavaScript rendering, and Google recommends a distinct URL per language rather
than adjusting content from browser settings, so a translation that only exists
at runtime is invisible to all of them. This script performs the same swap at
build time and writes real English HTML.

Everything under en/ is a DERIVED ARTIFACT. Never edit it by hand: change the
Polish page and re-run

    build/.venv/bin/python build/build_en.py

The Polish pages own their own hreflang block, so this script never writes to its
own inputs.
"""

from __future__ import annotations

import html
import logging
import posixpath
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import NamedTuple

logger = logging.getLogger("build_en")

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_ORIGIN = "https://helban.dev"
EN_PREFIX = "/en"

# Pages that exist in both languages. The KSeF guide is deliberately absent: it
# covers Polish tax law for a Polish audience and was never translated, so it
# stays a Polish-only URL with no hreflang pair.
TRANSLATED_ROUTES = (
    "/",
    "/privacy/",
    "/case-studies/",
    "/case-studies/wordpress-speed/",
    "/case-studies/notion-operating-system/",
    "/case-studies/generateblocks-pro-traps/",
)

ASSET_ATTRIBUTE = re.compile(r'\b(href|src)="([^"]+)"')
# The pages inline their CSS, and @font-face reaches the woff2 files with a relative
# url(), which no href/src rule would ever see.
CSS_URL = re.compile(r"url\((['\"]?)([^)'\"]+)\1\)")
SKIP_URL = re.compile(r"^(?:https?:|//|#|mailto:|tel:|data:)", re.I)

VOID_ELEMENTS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)


@dataclass(frozen=True)
class PageSpec:
    """One Polish page and the English head metadata its twin needs.

    The body copy comes from the data-* attributes; only these head strings have
    no Polish-side counterpart and must be authored per page.
    """

    route: str
    title: str
    description: str
    og_title: str
    og_description: str

    @property
    def source_path(self) -> Path:
        return REPO_ROOT / self.route.strip("/") / "index.html" if self.route != "/" else REPO_ROOT / "index.html"

    @property
    def output_path(self) -> Path:
        return REPO_ROOT / "en" / self.route.strip("/") / "index.html" if self.route != "/" else REPO_ROOT / "en" / "index.html"

    @property
    def english_url(self) -> str:
        return f"{SITE_ORIGIN}{EN_PREFIX}{self.route}"


PAGES: tuple[PageSpec, ...] = (
    PageSpec(
        route="/",
        title="helban.dev · fast websites, scrapers and automations",
        description=(
            "Adam K, 10 years of C++ embedded. I build fast websites (PageSpeed 97-100), "
            "Python web scrapers, Chrome MV3 extensions and automations. Every service "
            "comes with a live demo you can click."
        ),
        og_title="helban.dev · fast websites, scrapers and automations",
        og_description=(
            "Fast websites and tools, the code stays yours. Sites at PageSpeed 97-100, "
            "Python scrapers, Chrome extensions, automations. Live demos you can click."
        ),
    ),
    PageSpec(
        route="/privacy/",
        title="Privacy policy · helban.dev",
        description=(
            "What happens to the data you type into the contact form on helban.dev: who "
            "processes it, where it goes and how long I keep it. No cookies, no analytics."
        ),
        og_title="Privacy policy · helban.dev",
        og_description=(
            "This site does not track you. The only personal data you leave is what you "
            "type into the contact form yourself."
        ),
    ),
    PageSpec(
        route="/case-studies/",
        title="Case studies · helban.dev",
        description=(
            "Projects written up as numbers, not adjectives: the starting point, the "
            "method, the measurements and the honest finding. Read one before we talk price."
        ),
        og_title="Case studies · helban.dev",
        og_description=(
            "Three projects taken apart, with the numbers that came out of them and the "
            "part that did not work."
        ),
    ),
    PageSpec(
        route="/case-studies/wordpress-speed/",
        title="Speeding up WordPress: 63 to 99 on PageSpeed · helban.dev",
        description=(
            "The same page built three ways: an Elementor build at 63, the same build "
            "tuned in place at 71, and a lean rebuild at 99. Where the page-builder "
            "ceiling actually sits."
        ),
        og_title="Speeding up WordPress: 63 to 99 on PageSpeed",
        og_description=(
            "One page, three builds, measured. How much speed is really recoverable from "
            "a page builder, and where the ceiling is."
        ),
    ),
    PageSpec(
        route="/case-studies/notion-operating-system/",
        title="A company OS in Notion: 17 areas into 8 databases · helban.dev",
        description=(
            "Seventeen company areas collapsed into eight linked Notion databases with no "
            "retyped data, one source of truth and no duplicated fields."
        ),
        og_title="A company OS in Notion: 17 areas into 8 databases",
        og_description=(
            "How seventeen scattered company areas became eight linked databases with "
            "nothing retyped between them."
        ),
    ),
    PageSpec(
        route="/case-studies/generateblocks-pro-traps/",
        title="GenerateBlocks Pro and GP Premium: eight traps outside the docs · helban.dev",
        description=(
            "Eight behaviours of GenerateBlocks Pro and GP Premium that cost real hours "
            "and are not written down anywhere in the official documentation."
        ),
        og_title="GenerateBlocks Pro and GP Premium: eight traps outside the docs",
        og_description=(
            "Eight undocumented behaviours in GenerateBlocks Pro and GP Premium, each one "
            "found the expensive way."
        ),
    ),
)


def _line_start_offsets(markup: str) -> list[int]:
    offsets = [0]
    for index, character in enumerate(markup):
        if character == "\n":
            offsets.append(index + 1)
    return offsets


class _OpenTranslatable(NamedTuple):
    """An element with a pending translation, held while the parser looks for its end tag."""

    depth: int
    content_start: int
    english: str
    tag: str


class _TranslationCollector(HTMLParser):
    """Records the source spans that main.js would rewrite when switching to EN.

    Element content and attribute values are collected as (start, end, replacement)
    triples against the raw source, so the generated file keeps the hand-tuned
    formatting of everything it does not translate.
    """

    def __init__(self, markup: str) -> None:
        super().__init__(convert_charrefs=False)
        self._markup = markup
        self._line_starts = _line_start_offsets(markup)
        self.replacements: list[tuple[int, int, str]] = []
        self._element_stack: list[str] = []
        self._open_translatable: list[_OpenTranslatable] = []

    def _current_offset(self) -> int:
        line, column = self.getpos()
        return self._line_starts[line - 1] + column

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # A self-closing tag opens and closes at once, so it must never reach the
        # element stack; only its attributes can need translating.
        self._rewrite_start_tag(attrs)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes, content_start = self._rewrite_start_tag(attrs)
        if tag in VOID_ELEMENTS:
            return
        self._element_stack.append(tag)
        english = _english_content(attributes)
        if english is not None:
            self._open_translatable.append(
                _OpenTranslatable(len(self._element_stack), content_start, english, tag)
            )

    def _rewrite_start_tag(self, attrs: list[tuple[str, str | None]]) -> tuple[dict[str, str], int]:
        attributes = {name: (value or "") for name, value in attrs}
        start_tag_text = self.get_starttag_text() or ""
        tag_start = self._current_offset()
        rewritten_tag = _rewrite_localized_attributes(start_tag_text, attributes)
        if rewritten_tag != start_tag_text:
            self.replacements.append((tag_start, tag_start + len(start_tag_text), rewritten_tag))
        return attributes, tag_start + len(start_tag_text)

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID_ELEMENTS:
            return
        if not self._element_stack or self._element_stack[-1] != tag:
            raise ValueError(
                f"unbalanced </{tag}> at offset {self._current_offset()}; this parser "
                f"assumes well-formed markup, open elements: {self._element_stack[-4:]}"
            )
        depth = len(self._element_stack)
        self._element_stack.pop()
        if not self._open_translatable or self._open_translatable[-1].depth != depth:
            return
        pending = self._open_translatable.pop()
        content_end = self._current_offset()
        original = self._markup[pending.content_start:content_end]
        # main.js swaps these by assigning textContent, which would delete any child
        # element. Both it and this script are only correct while the translated
        # element is a text-only leaf, so refuse to translate anything else.
        if "<" in original:
            raise ValueError(
                f"data-en on <{pending.tag}> wraps nested markup, which textContent would "
                f"destroy: {original.strip()[:120]!r}"
            )
        self.replacements.append(
            (pending.content_start, content_end, html.escape(pending.english, quote=False))
        )


def _english_content(attributes: Mapping[str, str]) -> str | None:
    if "data-en" in attributes:
        return html.unescape(attributes["data-en"])
    # Only the visible .price span shows the amount; the order buttons carry the
    # same data attributes for prefill and must keep their "Order" label.
    css_classes = attributes.get("class", "").split()
    if "price" in css_classes and "data-price-pl" in attributes:
        return html.unescape(attributes.get("data-price-en", ""))
    return None


def _rewrite_localized_attributes(start_tag_text: str, attributes: Mapping[str, str]) -> str:
    rewritten = start_tag_text
    for source_attribute, target_attribute in (
        ("data-en-placeholder", "placeholder"),
        ("data-en-title", "title"),
    ):
        if source_attribute not in attributes:
            continue
        english_value = html.escape(html.unescape(attributes[source_attribute]), quote=True)
        # The lookbehind is load-bearing: \b would also match inside the source
        # attribute (data-en-placeholder contains "placeholder"), so with count=1 the
        # rewrite silently hit the wrong attribute whenever data-en-* came first.
        rewritten = re.sub(
            rf'(?<![\w-]){target_attribute}="[^"]*"',
            f'{target_attribute}="{english_value}"',
            rewritten,
            count=1,
        )
    return rewritten


def apply_translations(markup: str) -> str:
    collector = _TranslationCollector(markup)
    collector.feed(markup)
    collector.close()
    rewritten = markup
    for start, end, replacement in sorted(collector.replacements, reverse=True):
        rewritten = rewritten[:start] + replacement + rewritten[end:]
    logger.info("Applied %d translated spans", len(collector.replacements))
    return rewritten


def absolutize_urls(markup: str, source_route: str) -> str:
    """Make every relative href/src root-absolute.

    The Polish pages sit at different depths and reach assets with ../ hops. Their
    English twins sit one level deeper under /en/, so a relative path that worked
    at /privacy/ would 404 at /en/privacy/.
    """

    base_directory = posixpath.dirname(source_route.rstrip("/") + "/index.html")

    def to_root_absolute(url: str) -> str | None:
        if SKIP_URL.match(url) or url.startswith("/"):
            return None
        resolved = posixpath.normpath(posixpath.join(base_directory, url))
        return f'/{resolved.lstrip("/")}'

    def replace_attribute(match: re.Match[str]) -> str:
        attribute, url = match.group(1), match.group(2)
        absolute = to_root_absolute(url)
        return match.group(0) if absolute is None else f'{attribute}="{absolute}"'

    def replace_css_url(match: re.Match[str]) -> str:
        quote, url = match.group(1), match.group(2)
        absolute = to_root_absolute(url)
        return match.group(0) if absolute is None else f"url({quote}{absolute}{quote})"

    return CSS_URL.sub(replace_css_url, ASSET_ATTRIBUTE.sub(replace_attribute, markup))


def retarget_internal_links(markup: str) -> str:
    """Point page links on an English page at their English twins.

    Routes with no English twin (the KSeF guide) are left alone, so a reader who
    follows one lands on the Polish original rather than a 404.
    """

    def replace(match: re.Match[str]) -> str:
        attribute, url = match.group(1), match.group(2)
        if not url.startswith("/"):
            return match.group(0)
        path, separator, fragment = url.partition("#")
        route = path or "/"
        if route not in TRANSLATED_ROUTES:
            return match.group(0)
        return f'{attribute}="{EN_PREFIX}{route}{separator}{fragment}"'

    return ASSET_ATTRIBUTE.sub(replace, markup)


def drop_polish_only_elements(markup: str) -> str:
    """Remove elements marked data-pl-only from the English build.

    Some links only mean something to a Polish reader (a profile on a Polish
    classifieds board). Translating them would be worse than dropping them: it
    advertises a channel the English visitor cannot use.
    """

    pattern = re.compile(r"[ \t]*<(?P<tag>\w+)[^>]*\bdata-pl-only\b[^>]*>.*?</(?P=tag)>\n?", re.S)
    dropped = len(pattern.findall(markup))
    if dropped:
        logger.info("Dropped %d Polish-only element(s)", dropped)
    return pattern.sub("", markup)


def rewrite_language_switcher(markup: str, spec: PageSpec) -> str:
    """Re-render the two switcher links for the English side.

    Runs after retarget_internal_links, which would otherwise push the "PL" link at
    /en/ as well and leave the visitor with no way back to Polish.
    """

    polish_link = (
        f'<a id="langPl" class="hit44" href="{spec.route}" data-lang-link="pl">PL</a>'
    )
    english_link = (
        f'<a id="langEn" class="hit44" href="{EN_PREFIX}{spec.route}" '
        f'aria-current="page" data-lang-link="en">EN</a>'
    )
    markup = re.sub(r'<a id="langPl"[^>]*>PL</a>', polish_link, markup, count=1)
    markup = re.sub(r'<a id="langEn"[^>]*>EN</a>', english_link, markup, count=1)
    return markup


def rewrite_head(markup: str, spec: PageSpec) -> str:
    rewritten = markup.replace('<html lang="pl">', '<html lang="en">', 1)

    rewritten = re.sub(
        r"<title>.*?</title>",
        f"<title>{html.escape(spec.title, quote=False)}</title>",
        rewritten,
        count=1,
        flags=re.S,
    )
    for attribute_selector, value in (
        ('name="description"', spec.description),
        ('property="og:title"', spec.og_title),
        ('property="og:description"', spec.og_description),
    ):
        rewritten = re.sub(
            rf'<meta {re.escape(attribute_selector)} content="[^"]*">',
            f'<meta {attribute_selector} content="{html.escape(value, quote=True)}">',
            rewritten,
            count=1,
        )

    rewritten = re.sub(
        r'<link rel="canonical" href="[^"]*">',
        f'<link rel="canonical" href="{spec.english_url}">',
        rewritten,
        count=1,
    )
    rewritten = re.sub(
        r'<meta property="og:url" content="[^"]*">',
        f'<meta property="og:url" content="{spec.english_url}">',
        rewritten,
        count=1,
    )
    return rewritten


def build_page(spec: PageSpec) -> None:
    source = spec.source_path
    if not source.is_file():
        raise FileNotFoundError(f"missing Polish source for {spec.route}: {source}")

    markup = source.read_text(encoding="utf-8")
    markup = drop_polish_only_elements(markup)
    markup = apply_translations(markup)
    markup = absolutize_urls(markup, spec.route)
    markup = retarget_internal_links(markup)
    markup = rewrite_language_switcher(markup, spec)
    markup = rewrite_head(markup, spec)

    spec.output_path.parent.mkdir(parents=True, exist_ok=True)
    spec.output_path.write_text(markup, encoding="utf-8")
    logger.info("Wrote %s (%d bytes)", spec.output_path.relative_to(REPO_ROOT), len(markup))


def build_sitemap() -> None:
    """Rewrite sitemap.xml with both language trees.

    The KSeF guide appears once, under its Polish URL only.
    """

    polish_only_routes = ("/case-studies/ksef-woocommerce/",)
    priority_by_route = {
        "/": "1.0",
        "/case-studies/": "0.7",
        "/privacy/": "0.3",
    }
    changefreq_by_route = {
        "/": "monthly",
        "/case-studies/": "monthly",
        "/case-studies/ksef-woocommerce/": "monthly",
        "/privacy/": "yearly",
    }

    entries: list[str] = []
    for route in TRANSLATED_ROUTES:
        for location in (f"{SITE_ORIGIN}{route}", f"{SITE_ORIGIN}{EN_PREFIX}{route}"):
            entries.append(
                "  <url>\n"
                f"    <loc>{location}</loc>\n"
                f"    <changefreq>{changefreq_by_route.get(route, 'yearly')}</changefreq>\n"
                f"    <priority>{priority_by_route.get(route, '0.8')}</priority>\n"
                "  </url>"
            )
    for route in polish_only_routes:
        entries.append(
            "  <url>\n"
            f"    <loc>{SITE_ORIGIN}{route}</loc>\n"
            f"    <changefreq>{changefreq_by_route.get(route, 'yearly')}</changefreq>\n"
            "    <priority>0.8</priority>\n"
            "  </url>"
        )

    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(entries)
        + "\n</urlset>\n"
    )
    (REPO_ROOT / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    logger.info("Wrote sitemap.xml with %d URLs", len(entries))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for spec in PAGES:
        build_page(spec)
    build_sitemap()
    logger.info("Built %d English pages", len(PAGES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
