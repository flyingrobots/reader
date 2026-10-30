"""The committed web bundle matches its sources, so a merge or a forgotten rebuild cannot ship stale controls.

web/build.mjs records the SHA-256 of every source it read and every file it wrote in build-meta.json. These checks
compare those records with the working tree, without running the build. When one fails, run `npm run build` in web/.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parents[1]
CONTROLS = ROOT / 'src/reader_mcp/web_ui/controls'
META = json.loads((CONTROLS / 'build-meta.json').read_text())
REBUILD = 'run `npm run build` in web/ and commit the result'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_bundle_was_built_from_the_current_sources():
    stale = [path for path, digest in META['sources'].items()
             if not (ROOT / 'web' / path).is_file() or sha256(ROOT / 'web' / path) != digest]
    assert not stale, f'sources changed since the last build: {stale[:5]}; {REBUILD}'


def test_bundle_files_are_exactly_the_recorded_build_outputs():
    files = {str(path.relative_to(CONTROLS)) for path in CONTROLS.rglob('*') if path.is_file()} - {'build-meta.json'}
    assert sorted(files - set(META['outputs'])) == [], f'files the build did not write; {REBUILD}'
    assert sorted(set(META['outputs']) - files) == [], f'build outputs are missing; {REBUILD}'
    edited = [name for name, record in META['outputs'].items()
              if sha256(CONTROLS / name) != record['sha256'] or (CONTROLS / name).stat().st_size != record['bytes']]
    assert not edited, f'outputs differ from what the build wrote (a hand edit or a merge): {edited[:5]}; {REBUILD}'
