"""Pull the visible copy out of a helban.dev page, per language side.

Checking the hand-kept draft instead of the shipped file is how a fix lands in one
and not the other, so both language passes read the artifact that gets deployed.
Polish is element content; English lives in data-en attributes and in the built
en/ twin's content.
"""

import re
import sys
from html.parser import HTMLParser

SKIP_CONTENT = {"style", "script"}


class CopyExtractor(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=True)
        self.source = source
        self.chunks: list[str] = []
        self._muted = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIP_CONTENT:
            self._muted += 1
            return
        if self.source == "en":
            english = dict(attrs).get("data-en")
            if english:
                self.chunks.append(english)

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP_CONTENT and self._muted:
            self._muted -= 1

    def handle_data(self, text: str) -> None:
        if self._muted or self.source == "en":
            return
        stripped = text.strip()
        if stripped:
            self.chunks.append(stripped)


def extract(path: str, source: str) -> str:
    extractor = CopyExtractor(source)
    extractor.feed(open(path, encoding="utf-8").read())
    extractor.close()
    joined = "\n\n".join(extractor.chunks)
    return re.sub(r"\n{3,}", "\n\n", joined)


if __name__ == "__main__":
    print(extract(sys.argv[1], sys.argv[2]))
