import importlib.util
import re
from pathlib import Path

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
