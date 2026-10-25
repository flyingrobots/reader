#!/usr/bin/env python3
"""Refresh explicitly pinned browser assets, without running npm install scripts."""
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/reader_mcp/web_ui/vendor'
PACKAGES = {
    'd3': ('7.9.0', {'dist/d3.min.js': 'd3.min.js'}),
    'gsap': ('3.15.0', {'dist/gsap.min.js': 'gsap.min.js', 'dist/ScrollTrigger.min.js': 'ScrollTrigger.min.js', 'dist/ScrollSmoother.min.js': 'ScrollSmoother.min.js'}),
    'markdown-it': ('15.0.3', {'dist/browser/markdown-it.umd.min.js': 'markdown-it.min.js'}),
    'dompurify': ('3.4.17', {'dist/purify.min.js': 'purify.min.js'}),
    '@fontsource-variable/newsreader': ('5.3.0', {'files/newsreader-latin-wght-normal.woff2': 'newsreader.woff2', 'files/newsreader-latin-wght-italic.woff2': 'newsreader-italic.woff2'}),
    '@fontsource-variable/manrope': ('5.3.0', {'files/manrope-latin-wght-normal.woff2': 'manrope.woff2'}),
    'pdfjs-dist': ('6.4.299', {'build/pdf.min.mjs': 'pdf.min.mjs', 'build/pdf.worker.min.mjs': 'pdf.worker.min.mjs'}),
}


def fetch(url, maximum):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise RuntimeError('Vendor download exceeds its bound')
    return data


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for package, (version, files) in PACKAGES.items():
        metadata = json.loads(fetch(f'https://registry.npmjs.org/{package}/{version}', 2 * 1024**2))
        url = metadata['dist']['tarball']
        data = fetch(url, 16 * 1024**2)
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        if integrity != metadata['dist']['integrity']:
            raise RuntimeError('Package integrity mismatch: ' + package)
        payloads = {}
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            if package == 'pdfjs-dist':
                files = dict(files)
                for member in archive.getmembers():
                    if member.isfile() and member.name.startswith(('package/standard_fonts/', 'package/cmaps/')):
                        name = member.name.removeprefix('package/')
                        files[name] = name
            for source, dest in files.items():
                member = archive.getmember('package/' + source)
                if not member.isfile() or member.size > 4 * 1024**2:
                    raise RuntimeError('Unexpected vendor payload')
                body = archive.extractfile(member).read()
                (OUT / dest).parent.mkdir(parents=True, exist_ok=True)
                (OUT / dest).write_bytes(body)
                payloads[dest] = hashlib.sha256(body).hexdigest()
            license_files = [m for m in archive.getmembers() if m.isfile() and Path(m.name).name.upper().startswith(('LICENSE', 'OFL'))]
            if not license_files and package == 'gsap':
                # GSAP distributes its license URL/notices in README and JS headers.
                readme = archive.extractfile('package/README.md').read()
                (OUT / 'gsap-UPSTREAM-README.md').write_bytes(readme)
                license_files = []
            if not license_files and package != 'gsap':
                raise RuntimeError('Missing license: ' + package)
            for i, member in enumerate(license_files):
                if member.size > 128 * 1024:
                    raise RuntimeError('Unexpectedly large license')
                dest = package.replace('@', '').replace('/', '-') + f'-LICENSE-{i}.txt'
                (OUT / dest).write_bytes(archive.extractfile(member).read())
        manifest.append({'package': package, 'version': version, 'license': metadata.get('license'), 'tarball': url, 'integrity': integrity, 'files_sha256': payloads})
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Vendored', sum(len(x['files_sha256']) for x in manifest), 'browser assets; no runtime CDN requests')


if __name__ == '__main__':
    main()
