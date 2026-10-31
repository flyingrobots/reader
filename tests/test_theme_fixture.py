"""The browser suites' own theme, so they never depend on a product theme someone has edited.

`user-reader-test` (light) and `user-reader-test-dark` (the app prefixes user themes with `user-`) are frozen in tests/fixtures/: reader-test-theme.json holds the color tokens
(first copied from Paper and Ink, never updated with them) and reader-test-theme.css the stylesheet the app generates from
that JSON (tests/fixtures/make_test_theme.cjs writes it; web_themes checks it still matches). The web fixture installs the
JSON into the synthetic vault, so /api/themes lists it, and serves a script that runs before app.mjs: it seeds the
browser's theme cache with the CSS, so the first paint is already themed, and gives preferences without a theme
`user-reader-test-dark`. A suite that names a theme (?theme=…, or a theme in its preferences) keeps it.
"""
import json
from pathlib import Path
from urllib.parse import urlsplit

FIXTURES = Path(__file__).with_name('fixtures')
THEME = FIXTURES / 'reader-test-theme.json'
CSS = FIXTURES / 'reader-test-theme.css'
SCRIPT = '/__reader-test/theme.js'
DEFAULT = 'user-reader-test-dark'
IDS = ['user-reader-test', 'user-reader-test-dark']


def install(root):
    """Put the frozen theme in the vault's theme folder (Themes reads ROOT/themes/<id>.json)."""
    folder = Path(root) / 'themes'
    folder.mkdir(exist_ok=True)
    (folder / 'reader-test.json').write_text(THEME.read_text())


def script():
    css = CSS.read_text() if CSS.is_file() else ''
    return ('(()=>{try{'
            f'const ids={json.dumps(IDS)},cache={{css:{json.dumps(css)},links:[],ids}};'
            "const known=JSON.parse(localStorage.getItem('reader.themes.v1')||'null');"
            "if(!known||!ids.every(id=>known.ids?.includes(id)))localStorage.setItem('reader.themes.v1',JSON.stringify(cache));"
            "const prefs=JSON.parse(localStorage.getItem('reader.preferences.v1')||'{}');"
            f"if(!prefs.theme){{prefs.theme={json.dumps(DEFAULT)};localStorage.setItem('reader.preferences.v1',JSON.stringify(prefs));}}"
            '}catch{}})();').encode()


def handler(base):
    """A WebHandler subclass that serves the seeding script and loads it first on the page."""
    class TestThemeHandler(base):
        def do_GET(self):
            if urlsplit(self.path).path == SCRIPT:
                body = script()
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def send_file(self, file, raw=False):
            if raw or file.name != 'index.html':
                return super().send_file(file, raw)
            body = file.read_bytes().replace(b'<head>', b'<head>\n  <script src="' + SCRIPT.encode() + b'"></script>', 1)
            self.response_headers(200, 'text/html', len(body), raw=False)
            self.end_headers()
            self.wfile.write(body)

    return TestThemeHandler
