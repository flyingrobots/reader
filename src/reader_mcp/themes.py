"""User themes and locally cached Google Fonts, stored in the private vault.

Themes live in ``themes/<id>.json``. Font families downloaded from Google Fonts
live in ``themes/fonts/<slug>/`` with their stylesheet, woff2 files, license and
a manifest. Reading never contacts Google: only an explicit catalog search or
font installation does, and only over HTTPS to the hosts listed below.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

TOKENS = json.loads((Path(__file__).with_name('web_ui') / 'theme-tokens.json').read_text())
COLOR_TOKENS = [token['name'] for token in TOKENS['colors']]
FONT_ROLES = [font['name'] for font in TOKENS['fonts']]
FAMOUS = json.loads((Path(__file__).with_name('web_ui') / 'famous-themes.json').read_text())
BUILT_IN = {'ink', 'paper', 'orchid', 'harvest'} | {theme['id'] for theme in FAMOUS['themes']}
THEME_ID = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?')
HEX = re.compile(r'#(?:[0-9a-f]{6}|[0-9a-f]{8})')
FAMILY = re.compile(r'[A-Za-z0-9][A-Za-z0-9 ]{0,63}')
MAX_THEMES = 64
MAX_THEME_BYTES = 64 * 1024
MAX_FAMILIES = 32
MAX_FONT_FILE = 4 * 1024**2
MAX_FAMILY_BYTES = 16 * 1024**2
MAX_FONT_FILES = 8
MAX_CATALOG = 16 * 1024**2
CATALOG_TTL = 7 * 24 * 3600
SUBSETS = ('latin', 'latin-ext')
HOSTS = {'fonts.google.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com'}
# Google returns woff2 only to user agents it recognizes as modern browsers.
AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'


def now():
    return datetime.now(timezone.utc).isoformat()


def slug(family):
    return re.sub(r'[^a-z0-9]+', '-', family.lower()).strip('-')


def fetch(url, maximum):
    """HTTPS GET to an allowed Google Fonts host, refusing redirects elsewhere and oversized bodies."""
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname not in HOSTS:
        raise ValueError('Font downloads are limited to Google Fonts over HTTPS')
    with urlopen(Request(url, headers={'User-Agent': AGENT}), timeout=20) as response:
        final = urlsplit(response.geturl())
        if final.scheme != 'https' or final.hostname not in HOSTS:
            raise ValueError('Google Fonts redirected outside the allowed hosts')
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError('Google Fonts response exceeds its size limit')
    return data


def atomic_write(folder, name, data):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=folder, prefix='.theme-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, folder / name)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


class Themes:
    def __init__(self, root, fetcher=fetch):
        self.root = Path(root).resolve(strict=True)
        self.folder = self.root / 'themes'
        self.fonts = self.folder / 'fonts'
        self.fetch = fetcher
        self.catalog_cache = None
        self.catalog_lock = threading.Lock()

    @contextmanager
    def locked(self):
        runtime = self.root / '.reader'
        runtime.mkdir(exist_ok=True)
        for folder in (self.folder, self.fonts):
            if folder.is_symlink():
                raise ValueError('Theme folders must not be symlinks')
            folder.mkdir(exist_ok=True)
        with (runtime / 'themes.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    # Themes

    def validate(self, theme):
        if not isinstance(theme, dict):
            raise ValueError('Expected a theme object')
        identifier = theme.get('id')
        if not isinstance(identifier, str) or not THEME_ID.fullmatch(identifier) or identifier.endswith('-dark') or identifier in BUILT_IN:
            raise ValueError('Theme id must be 1–40 lowercase letters, digits or hyphens, not a built-in name or ending in -dark')
        name = theme.get('name')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60 or any(ord(c) < 32 for c in name):
            raise ValueError('Theme name must be 1–60 printable characters')
        fonts = theme.get('fonts', {})
        if not isinstance(fonts, dict) or set(fonts) - set(FONT_ROLES):
            raise ValueError('Unknown font role')
        for family in fonts.values():
            if family is not None and (not isinstance(family, str) or not FAMILY.fullmatch(family)):
                raise ValueError('Font family names use letters, digits and spaces only')
        result = {'schema_version': 1, 'id': identifier, 'name': name.strip(),
                  'fonts': {role: fonts.get(role) for role in FONT_ROLES}}
        for variant in ('light', 'dark'):
            tokens = theme.get(variant)
            if not isinstance(tokens, dict) or set(tokens) != set(COLOR_TOKENS):
                raise ValueError(f'The {variant} variant must define exactly the standard color tokens')
            for token, value in tokens.items():
                if not isinstance(value, str) or not HEX.fullmatch(value):
                    raise ValueError(f'{variant} {token} must be a lowercase #rrggbb or #rrggbbaa color')
            result[variant] = {token: tokens[token] for token in COLOR_TOKENS}
        return result

    def path(self, identifier):
        if not isinstance(identifier, str) or not THEME_ID.fullmatch(identifier):
            raise ValueError('Invalid theme id')
        return self.folder / (identifier + '.json')

    def read(self, file):
        if file.is_symlink() or file.stat().st_size > MAX_THEME_BYTES:
            raise ValueError('Unsafe or oversized theme')
        data = json.loads(file.read_text())
        if data.get('schema_version') != 1 or file.stem != data.get('id'):
            raise ValueError('Invalid theme identity/schema')
        return self.validate(data) | {key: data[key] for key in ('created_at', 'updated_at') if key in data}

    def list(self):
        if self.folder.is_symlink():
            raise ValueError('Theme folder must not be a symlink')
        themes = [self.read(file) for file in sorted(self.folder.glob('*.json'))] if self.folder.is_dir() else []
        return {'themes': themes, 'fonts': self.installed()}

    def save(self, theme):
        theme = self.validate(theme)
        with self.locked():
            file = self.path(theme['id'])
            previous = self.read(file) if file.exists() else None
            if not previous and len(list(self.folder.glob('*.json'))) >= MAX_THEMES:
                raise ValueError(f'At most {MAX_THEMES} themes')
            stamp = now()
            theme |= {'created_at': previous.get('created_at', stamp) if previous else stamp, 'updated_at': stamp}
            data = (json.dumps(theme, ensure_ascii=False, indent=2) + '\n').encode()
            if len(data) > MAX_THEME_BYTES:
                raise ValueError('Theme exceeds 64 KiB')
            atomic_write(self.folder, file.name, data)
        return theme

    def delete(self, identifier):
        with self.locked():
            file = self.path(identifier)
            if not file.exists() or file.is_symlink():
                raise ValueError('No such theme')
            file.unlink()
        return {'deleted': identifier}

    def dispatch(self, request):
        action = request.get('action')
        if action == 'save':
            return self.save(request.get('theme'))
        if action == 'delete':
            return self.delete(request.get('id'))
        if action == 'install-font':
            return self.install(request.get('family'))
        raise ValueError('Unknown theme action')

    # Fonts

    def catalog(self):
        """Google Fonts family metadata, cached in memory and in the vault for a week."""
        with self.catalog_lock:
            if self.catalog_cache and time.time() - self.catalog_cache[0] < CATALOG_TTL:
                return self.catalog_cache[1]
            cache = self.fonts / '.catalog.json'
            if cache.is_file() and not cache.is_symlink() and time.time() - cache.stat().st_mtime < CATALOG_TTL:
                families = json.loads(cache.read_text())
            else:
                raw = self.fetch('https://fonts.google.com/metadata/fonts', MAX_CATALOG).decode()
                listing = json.loads(raw[raw.index('{'):])['familyMetadataList']
                families = [{'family': item['family'], 'category': item.get('category', ''),
                             'axes': [axis for axis in item.get('axes', []) if axis.get('tag') == 'wght'],
                             'styles': sorted(item.get('fonts', {})), 'subsets': item.get('subsets', []),
                             'popularity': item.get('popularity', 0)}
                            for item in listing if FAMILY.fullmatch(item.get('family', '')) and item.get('isOpenSource', True)]
                with self.locked():
                    atomic_write(self.fonts, '.catalog.json', json.dumps(families).encode())
            self.catalog_cache = (time.time(), families)
            return families

    def search(self, query, limit=40):
        query = (query or '').strip().lower()
        if len(query) > 64:
            raise ValueError('Font search exceeds 64 characters')
        families = self.catalog()
        hits = [item for item in families if query in item['family'].lower()] if query else families
        hits.sort(key=lambda item: (not item['family'].lower().startswith(query), item['popularity'] or 10**6))
        return {'families': [{'family': item['family'], 'category': item['category']} for item in hits[:limit]],
                'installed': self.installed()}

    def installed(self):
        families = []
        if self.fonts.is_dir() and not self.fonts.is_symlink():
            for manifest in sorted(self.fonts.glob('*/manifest.json')):
                if manifest.parent.name.startswith('.') or manifest.is_symlink() or manifest.parent.is_symlink():
                    continue
                data = json.loads(manifest.read_text())
                families.append({'family': data['family'], 'slug': manifest.parent.name, 'category': data.get('category', ''),
                                 'license': data.get('license'), 'stylesheet': f'/fonts/{manifest.parent.name}/font.css'})
        return families

    def install(self, family):
        if not isinstance(family, str) or not FAMILY.fullmatch(family):
            raise ValueError('Font family names use letters, digits and spaces only')
        item = next((entry for entry in self.catalog() if entry['family'] == family), None)
        if not item:
            raise ValueError('That family is not in the Google Fonts catalog')
        existing = next((entry for entry in self.installed() if entry['family'] == family), None)
        if existing:
            return existing
        if len(self.installed()) >= MAX_FAMILIES:
            raise ValueError(f'At most {MAX_FAMILIES} downloaded font families')
        italic = any(style.endswith('i') for style in item['styles'])
        if item['axes']:
            low, high = int(item['axes'][0]['min']), int(item['axes'][0]['max'])
            weights = [f'{low}..{high}']
        else:
            available = sorted({int(style.rstrip('i')) for style in item['styles']})
            weights = [str(weight) for weight in available if weight in (400, 700)] or [str(available[0])]
        spec = ';'.join([f'0,{w}' for w in weights] + ([f'1,{w}' for w in weights] if italic else []))
        url = 'https://fonts.googleapis.com/css2?family=' + family.replace(' ', '+') + ':ital,wght@' + spec + '&display=swap'
        css = self.fetch(url, 1024**2).decode()
        faces, total = [], 0
        for label, block in re.findall(r'/\*\s*([a-z0-9-]+)\s*\*/\s*(@font-face\s*{[^}]*})', css):
            if label not in SUBSETS:
                continue
            source = re.search(r'url\((https://fonts\.gstatic\.com/[A-Za-z0-9_./-]+\.woff2)\)', block)
            style = re.search(r'font-style:\s*(normal|italic)', block)
            weight = re.search(r'font-weight:\s*(\d+(?: \d+)?)', block)
            ranges = re.search(r'unicode-range:\s*([U+0-9A-Fa-f, ?-]+);', block)
            if not (source and style and weight and ranges):
                raise ValueError('Unexpected Google Fonts stylesheet')
            faces.append({'url': source.group(1), 'style': style.group(1), 'weight': weight.group(1), 'subset': label, 'unicode_range': ranges.group(1).strip()})
        if not faces or len(faces) > MAX_FONT_FILES:
            raise ValueError('Google Fonts returned no usable latin woff2 files' if not faces else 'Too many font files for one family')
        license_text, license_id = None, None
        for folder, name in (('ofl', 'OFL.txt'), ('apache', 'LICENSE.txt'), ('ufl', 'UFL.txt')):
            try:
                license_text = self.fetch(f'https://raw.githubusercontent.com/google/fonts/main/{folder}/{slug(family).replace("-", "")}/{name}', 256 * 1024)
                license_id = {'ofl': 'OFL-1.1', 'apache': 'Apache-2.0', 'ufl': 'UFL-1.0'}[folder]
                break
            except Exception:  # noqa: BLE001 - try the next license location
                continue
        files = []
        for index, face in enumerate(faces):
            data = self.fetch(face['url'], MAX_FONT_FILE)
            total += len(data)
            if total > MAX_FAMILY_BYTES or data[:4] != b'wOF2':
                raise ValueError('Font download is oversized or not woff2')
            name = f"{face['subset']}-{face['style']}-{index}.woff2"
            files.append((name, data, face))
        target = slug(family)
        stylesheet = ''.join(
            f"@font-face{{font-family:'{family}';font-style:{face['style']};font-weight:{face['weight']};font-display:swap;"
            f"src:url('/fonts/{target}/{name}') format('woff2');unicode-range:{face['unicode_range']}}}\n"
            for name, _, face in files)
        manifest = {'schema_version': 1, 'family': family, 'category': item['category'], 'license': license_id,
                    'license_file': 'LICENSE.txt' if license_text else None, 'source': url, 'downloaded_at': now(),
                    'files': [{'name': name, 'source': face['url'], 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data, face in files]}
        with self.locked():
            folder = self.fonts / target
            if folder.exists():
                raise ValueError('That family is already being installed')
            staging = Path(tempfile.mkdtemp(dir=self.fonts, prefix='.install-'))
            try:
                for name, data, _ in files:
                    (staging / name).write_bytes(data)
                if license_text:
                    (staging / 'LICENSE.txt').write_bytes(license_text)
                (staging / 'font.css').write_text(stylesheet)
                (staging / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
                os.replace(staging, folder)
            finally:
                if staging.exists():
                    for file in staging.iterdir():
                        file.unlink()
                    staging.rmdir()
        return next(entry for entry in self.installed() if entry['family'] == family)

    def font_file(self, slug_name, name):
        if not re.fullmatch(r'[a-z0-9-]{1,64}', slug_name or '') or not re.fullmatch(r'[a-z0-9-]{1,40}\.woff2|font\.css|LICENSE\.txt', name or ''):
            raise ValueError('Invalid font path')
        file = self.fonts / slug_name / name
        if self.fonts.is_symlink() or file.parent.is_symlink() or file.is_symlink() or not file.is_file():
            raise ValueError('No such font file')
        return file
