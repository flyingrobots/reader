import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check_container.py'
spec = importlib.util.spec_from_file_location('check_container', SCRIPT)
check_container = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_container)


def test_worker_names_differ_per_checkout():
    first = check_container.worker_name('python', Path('/src/reader-code-rw44'))
    second = check_container.worker_name('python', Path('/src/reader-code-rw45'))
    assert first == 'reader-python-checks-reader-code-rw44'
    assert first != second


def test_worker_name_is_a_valid_docker_name():
    name = check_container.worker_name('web', Path('/src/My Checkout (copy)!'))
    assert name == 'reader-web-checks-my-checkout-copy'
    assert check_container.worker_name('node', Path('/src/...')) == 'reader-node-checks-checkout'
    assert len(check_container.worker_name('node', Path('/src/' + 'x' * 200))) <= 64 + len('reader-node-checks-')
