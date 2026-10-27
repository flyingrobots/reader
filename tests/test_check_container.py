import importlib.util
import io
import sys
import tarfile
import warnings

import pytest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check_container.py'
spec = importlib.util.spec_from_file_location('check_container', SCRIPT)
check_container = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_container)


def test_worker_names_differ_per_checkout():
    first = check_container.worker_name('python', Path('/src/alpha'))
    second = check_container.worker_name('python', Path('/src/beta'))
    assert first == 'reader-python-checks-alpha'
    assert first != second


def test_worker_name_is_a_valid_docker_name():
    name = check_container.worker_name('web', Path('/src/My Checkout (copy)!'))
    assert name == 'reader-web-checks-my-checkout-copy'
    assert check_container.worker_name('node', Path('/src/...')) == 'reader-node-checks-checkout'
    assert len(check_container.worker_name('node', Path('/src/' + 'x' * 200))) <= 64 + len('reader-node-checks-')


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
