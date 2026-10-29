"""Theme storage and local font caching against synthetic vaults and a fake Google Fonts."""
import json

import pytest

from reader_mcp.themes import COLOR_TOKENS, Themes

CATALOG = ")]}'\n" + json.dumps({'familyMetadataList': [
    {'family': 'Lora', 'category': 'Serif', 'axes': [{'tag': 'wght', 'min': 400.0, 'max': 700.0}], 'fonts': {'400': {}, '400i': {}}, 'subsets': ['latin'], 'popularity': 3, 'isOpenSource': True},
    {'family': 'Inter', 'category': 'Sans Serif', 'axes': [], 'fonts': {'400': {}, '700': {}}, 'subsets': ['latin'], 'popularity': 1, 'isOpenSource': True},
    {'family': 'Bad<script>', 'category': 'Serif', 'axes': [], 'fonts': {'400': {}}, 'popularity': 2},
]})
FACE = "/* {subset} */\n@font-face {{\n  font-family: 'Lora';\n  font-style: {style};\n  font-weight: 400 700;\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/lora/v1/{subset}-{style}.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131;\n}}\n"
CSS = ''.join(FACE.format(subset=subset, style=style) for style in ('normal', 'italic') for subset in ('cyrillic', 'latin', 'latin-ext'))


class FakeFonts:
    def __init__(self):
        self.urls = []

    def __call__(self, url, maximum):
        self.urls.append(url)
        if url == 'https://fonts.google.com/metadata/fonts':
            return CATALOG.encode()
        if url.startswith('https://fonts.googleapis.com/css2?family=Lora'):
            return CSS.encode()
        if url.startswith('https://fonts.gstatic.com/'):
            return b'wOF2' + url.encode()
        if url.endswith('/ofl/lora/OFL.txt'):
            return b'SIL Open Font License 1.1'
        raise OSError('not found: ' + url)


def theme(identifier='dusk', **changes):
    tokens = {token: '#202020' for token in COLOR_TOKENS} | {'ink': '#f0f0f0', 'selection': '#ffcc0044'}
    return {'id': identifier, 'name': 'Dusk', 'fonts': {'serif': 'Lora', 'sans': None, 'mono': None},
            'light': dict(tokens), 'dark': dict(tokens)} | changes


def test_save_list_update_and_delete_preserve_created_at(tmp_path):
    themes = Themes(tmp_path, FakeFonts())
    first = themes.save(theme())
    assert (tmp_path / 'themes/dusk.json').is_file()
    second = themes.save(theme(name='Dusk two'))
    assert second['created_at'] == first['created_at'] and second['name'] == 'Dusk two'
    listed = themes.list()['themes']
    assert [t['id'] for t in listed] == ['dusk'] and listed[0]['light']['selection'] == '#ffcc0044'
    assert themes.delete('dusk') == {'deleted': 'dusk'}
    assert themes.list()['themes'] == []
    with pytest.raises(ValueError):
        themes.delete('dusk')


@pytest.mark.parametrize('bad', [
    theme(identifier='ink'), theme(identifier='night-dark'), theme(identifier='../x'), theme(identifier='Caps'),
    theme(name=''), theme(name='x' * 61),
    theme(light={token: '#202020' for token in COLOR_TOKENS[:-1]}),
    theme(light={token: '#202020' for token in COLOR_TOKENS} | {'extra': '#000000'}),
    theme(dark={token: 'red;}body{display:none' for token in COLOR_TOKENS}),
    theme(dark={token: '#FFFFFF' for token in COLOR_TOKENS}),
    theme(fonts={'serif': "Lora'; }"}), theme(fonts={'display': 'Lora'}),
    theme(headings={'h7': {'size': 20}}), theme(headings={'h1': {'size': 9}}), theme(headings={'h1': {'size': 121}}),
    theme(headings={'h2': {'size': '30px'}}), theme(headings={'h2': {'size': True}}),
    theme(headings={'h3': {'font': "Lora'; }"}}), theme(headings={'h3': {'weight': 700}}), theme(headings=['h1']),
])
def test_invalid_themes_are_refused_without_writing(tmp_path, bad):
    themes = Themes(tmp_path, FakeFonts())
    with pytest.raises(ValueError):
        themes.save(bad)
    assert not list((tmp_path / 'themes').glob('*.json')) if (tmp_path / 'themes').exists() else True


def test_headings_default_to_null_and_round_trip_per_level(tmp_path):
    themes = Themes(tmp_path, FakeFonts())
    plain = themes.save(theme())
    assert plain['headings'] == {level: {'font': None, 'size': None} for level in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6')}
    saved = themes.save(theme(headings={'h1': {'font': 'Lora', 'size': 44}, 'h4': {'size': 18.25}, 'h6': None}))
    assert saved['headings']['h1'] == {'font': 'Lora', 'size': 44}
    assert saved['headings']['h4'] == {'font': None, 'size': 18.2}
    assert saved['headings']['h6'] == {'font': None, 'size': None}
    assert themes.list()['themes'][0]['headings'] == saved['headings']
    # A theme file written before headings existed still reads, with every level at its default.
    stored = json.loads((tmp_path / 'themes/dusk.json').read_text())
    del stored['headings']
    (tmp_path / 'themes/dusk.json').write_text(json.dumps(stored))
    assert themes.list()['themes'][0]['headings']['h2'] == {'font': None, 'size': None}


def test_font_search_filters_catalog_and_install_keeps_latin_subsets_locally(tmp_path):
    fetcher = FakeFonts()
    themes = Themes(tmp_path, fetcher)
    assert [f['family'] for f in themes.search('')['families']] == ['Inter', 'Lora']
    assert [f['family'] for f in themes.search('lo')['families']] == ['Lora']
    installed = themes.install('Lora')
    folder = tmp_path / 'themes/fonts/lora'
    assert installed['stylesheet'] == '/fonts/lora/font.css' and installed['license'] == 'OFL-1.1'
    css = (folder / 'font.css').read_text()
    assert 'fonts.gstatic.com' not in css and css.count('@font-face') == 4 and "url('/fonts/lora/" in css
    assert 'cyrillic' not in ' '.join(p.name for p in folder.iterdir())
    manifest = json.loads((folder / 'manifest.json').read_text())
    assert len(manifest['files']) == 4 and all(len(f['sha256']) == 64 for f in manifest['files'])
    assert (folder / 'LICENSE.txt').read_bytes() == b'SIL Open Font License 1.1'
    assert 'ital,wght@0,400..700;1,400..700' in next(u for u in fetcher.urls if 'css2' in u)
    count = len(fetcher.urls)
    assert themes.install('Lora')['family'] == 'Lora' and len(fetcher.urls) == count, 'reinstall is a no-op'
    assert themes.font_file('lora', 'font.css') == folder / 'font.css'
    with pytest.raises(ValueError):
        themes.font_file('lora', '../manifest.json')
    with pytest.raises(ValueError):
        themes.install('Bad<script>')
    with pytest.raises(ValueError):
        themes.install('Not A Family')


def test_catalog_is_cached_in_vault_between_instances(tmp_path):
    fetcher = FakeFonts()
    Themes(tmp_path, fetcher).search('')
    Themes(tmp_path, fetcher).search('')
    assert fetcher.urls.count('https://fonts.google.com/metadata/fonts') == 1


def test_default_fetcher_refuses_non_google_hosts():
    from reader_mcp.themes import fetch
    for url in ('http://fonts.googleapis.com/css2', 'https://example.com/font.woff2', 'file:///etc/passwd'):
        with pytest.raises(ValueError):
            fetch(url, 10)


@pytest.mark.parametrize('variant', ['light', 'dark'])
def test_monocolor_shipped_tokens_preserve_palette_and_contrast(variant):
    """Test the shipped CSS, including derived prose and mode colors, not just its inputs."""
    import re
    from reader_mcp.themes import FAMOUS
    from pathlib import Path
    import reader_mcp.themes as module

    theme = next(t for t in FAMOUS['themes'] if t['id'] == 'monocolor')
    palette = set(theme['palette'].values())
    assert len(palette) == 10
    css = (Path(module.__file__).parent / 'web_ui/controls/famous-themes.css').read_text()
    identifier = 'monocolor' + ('-dark' if variant == 'dark' else '')
    block = re.search(r':root\[data-theme="' + identifier + r'"\]\{([^}]+)\}', css)[1]
    props = dict(item.split(':', 1) for item in block.split(';'))
    names = COLOR_TOKENS + module.TOKENS['prose_derived'] + [t['name'] for t in module.TOKENS['prose']]
    names += [n for n in module.TOKENS['derived'] if n.startswith('mode-')]
    for name in names:
        assert props['--' + name] in palette, (name, props['--' + name])
    assert props['color-scheme'] == variant
    assert props['--shadow'] == 'none'

    def luminance(value):
        rgb = [int(value[i:i+2], 16) / 255 for i in (1, 3, 5)]
        return sum((v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) * w
                   for v, w in zip(rgb, [.2126, .7152, .0722]))

    def ratio(a, b):
        low, high = sorted([luminance(props['--' + a]), luminance(props['--' + b])])
        return (high + .05) / (low + .05)

    for surface in ('bg', 'surface', 'raised'):
        for ink in ('ink', 'muted', 'faint', 'accent', 'rust', 'warning'):
            assert ratio(ink, surface) >= 4.5, (variant, ink, surface)
    assert ratio('ink', 'bg') >= 7
    assert ratio('accent-ink', 'accent') >= 4.5
    for highlight in ('selection', 'own', 'other'):
        assert ratio('ink', highlight) >= 4.5

    prose_roles = [t['name'] for t in module.TOKENS['prose']]
    assert len({props['--' + role] for role in prose_roles}) >= (4 if variant == 'light' else 5)
    for role in prose_roles:
        assert ratio(role, 'bg') >= 4.5
        assert ratio(role, 'prose-wash') >= 4.5
    assert ratio('prose-recede', 'bg') >= 3
