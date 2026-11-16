import importlib.util
import io
from pathlib import Path
import re
import sys
import tarfile
import warnings

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check_container.py'
spec = importlib.util.spec_from_file_location('check_container', SCRIPT)
check_container = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_container)


def test_worker_names_differ_per_checkout():
    first = check_container.worker_name('python', Path('/src/alpha'))
    second = check_container.worker_name('python', Path('/src/beta'))
    assert first.startswith('reader-python-checks-alpha-')
    assert first != second


def test_worker_name_is_a_valid_docker_name():
    name = check_container.worker_name('web', Path('/src/My Checkout (copy)!'))
    assert name.startswith('reader-web-checks-my-checkout-copy-')
    assert check_container.worker_name('node', Path('/src/...')).startswith('reader-node-checks-checkout-')
    assert len(check_container.worker_name('node', Path('/src/' + 'x' * 200))) <= 64 + len('reader-node-checks-')
    assert all(re.fullmatch(r'[a-z0-9][a-z0-9_.-]*', check_container.worker_name('python', Path(p))) for p in ('/src/My Checkout (copy)!', '/src/...', '/a/b'))


def test_checkouts_with_the_same_folder_name_get_different_workers():
    assert check_container.worker_name('python', Path('/one/reader')) != check_container.worker_name('python', Path('/two/reader'))
    assert check_container.worker_name('python', Path('/one/reader')) == check_container.worker_name('python', Path('/one/reader'))


@pytest.mark.parametrize('argv', [['python', '-k', 'worker_names'], ['python', 'tests/test_check_container.py', '-k', 'worker_names or docker']])
def test_python_takes_a_k_expression(tmp_path, monkeypatch, argv):
    seen = {}
    monkeypatch.setattr(sys, 'argv', ['check_container.py', *argv])
    monkeypatch.setattr(check_container, 'RUNTIME', tmp_path)
    monkeypatch.setattr(check_container.shutil, 'disk_usage', lambda path: type('Usage', (), {'free': 10**12})())

    def docker(*args, **kwargs):
        seen['parsed'] = True
        raise RuntimeError('stop after parsing')
    monkeypatch.setattr(check_container, 'docker', docker)
    with pytest.raises(RuntimeError, match='stop after parsing'):
        check_container.main()
    assert seen


def controls_archive(name='controls/reader-controls.js'):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        info = tarfile.TarInfo(name)
        info.size = 2
        archive.addfile(info, io.BytesIO(b'//'))
    return buffer.getvalue()


def test_built_controls_extract_without_a_deprecation_warning(tmp_path):
    with warnings.catch_warnings():
        warnings.simplefilter('error', DeprecationWarning)
        check_container.extract_controls(controls_archive(), tmp_path)
    assert (tmp_path / 'controls/reader-controls.js').read_bytes() == b'//'


def test_built_controls_refuse_entries_outside_the_folder(tmp_path):
    with pytest.raises(RuntimeError, match='Unexpected entry'):
        check_container.extract_controls(controls_archive('../escape.js'), tmp_path)


def capture_worker_start(tmp_path, monkeypatch, stop_at, kind="web", prepare=None):
    """Capture the real launch/archive boundary with no Docker daemon effects."""
    from types import SimpleNamespace
    root = tmp_path / 'source'
    (root / 'docs/topics').mkdir(parents=True)
    (root / 'docs/topics/indexes.md').write_text('# Canonical index reference\n')
    if prepare:prepare(root)
    monkeypatch.setattr(check_container, 'ROOT', root)
    monkeypatch.setattr(check_container, 'RUNTIME', tmp_path / 'runtime')
    monkeypatch.setattr(sys, 'argv', ['check_container.py', kind])
    monkeypatch.setattr(check_container.shutil, 'disk_usage', lambda _: SimpleNamespace(free=10**12))
    monkeypatch.setattr(check_container.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=1))
    captured = {}

    def docker(*args, **kwargs):
        if args[0] == 'run':
            captured['argv'] = args
            if stop_at == 'run':
                raise RuntimeError('captured boundary')
        if args[:3] == ('exec', check_container.worker_name(kind), 'df'):
            return SimpleNamespace(stdout='Filesystem 1024-blocks Used Available Capacity Mounted\nroot 999999999 0 999999999 0% /\n')
        if 'input' in kwargs:
            captured['archive'] = kwargs['input']
            raise RuntimeError('captured boundary')
        return SimpleNamespace(stdout='')
    monkeypatch.setattr(check_container, 'docker', docker)
    with pytest.raises(RuntimeError, match='captured boundary'):
        check_container.main()
    return captured


def test_worker_explicitly_bounds_shared_memory(tmp_path, monkeypatch):
    argv = capture_worker_start(tmp_path, monkeypatch, 'run')['argv']
    assert '--shm-size' in argv, 'A daemon default must not escape the declared data budget'
    assert argv[argv.index('--shm-size') + 1] == '64m'


def test_web_archive_contains_canonical_markdown_dependencies(tmp_path, monkeypatch):
    data = capture_worker_start(tmp_path, monkeypatch, 'archive')['archive']
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        assert 'docs/topics/indexes.md' in archive.getnames(), 'The frontend imports its reference at build time'
        assert archive.extractfile('docs/topics/indexes.md').read() == b'# Canonical index reference\n'


def test_python_transfer_compresses_bounded_formatter_without_raising_source_cap(tmp_path, monkeypatch):
    import gzip
    formatter=b'fixed Linux formatter bytes\0'*150000
    def prepare(root):
        (root/'src').mkdir()
        (root/'src/payload.dat').write_bytes(b'x'*(21*1024**2))
        folder=root/'.reader/tooling/bin';folder.mkdir(parents=True)
        (folder/'wide-md').write_bytes(formatter)
    data=capture_worker_start(tmp_path,monkeypatch,'archive',kind='python',prepare=prepare)['archive']
    assert len(data)<=24*1024**2, 'The existing source transport bound stays intact'
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        assert '.reader/tooling/bin/wide-md' not in archive.getnames()
        packed=archive.extractfile('.reader/tooling/bin/wide-md.gz').read()
        assert gzip.decompress(packed)==formatter, 'Compression preserves the existing pinned artifact bytes'


def test_formatter_restore_preserves_artifact_and_removes_transfer_copy(tmp_path):
    import gzip
    import subprocess
    folder=tmp_path/'.reader/tooling/bin';folder.mkdir(parents=True)
    data=b'fixed executable bytes'
    (folder/'wide-md.gz').write_bytes(gzip.compress(data))
    subprocess.run([sys.executable,'-c',check_container.FORMATTER_RESTORE],cwd=tmp_path,check=True,timeout=5)
    assert (folder/'wide-md').read_bytes()==data
    assert (folder/'wide-md').stat().st_mode & 0o777 == 0o755
    assert not (folder/'wide-md.gz').exists()


def test_formatter_restore_rejects_expansion_beyond_existing_artifact_bound(tmp_path):
    import gzip
    import subprocess
    folder=tmp_path/'.reader/tooling/bin';folder.mkdir(parents=True)
    (folder/'wide-md.gz').write_bytes(gzip.compress(b'x'*(17*1024**2)))
    result=subprocess.run([sys.executable,'-c',check_container.FORMATTER_RESTORE],cwd=tmp_path,capture_output=True,text=True,timeout=5)
    assert result.returncode!=0 and 'Formatter artifact limit' in result.stderr
    assert not (folder/'wide-md').exists()


def test_validation_home_does_not_alias_the_source_tree(tmp_path, monkeypatch):
    argv = capture_worker_start(tmp_path, monkeypatch, 'run')['argv']
    assert 'HOME=/work/validation-home' in argv
    assert 'HOME=/work' not in argv, 'The export privacy guard must not mistake source paths for HOME'
