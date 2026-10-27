import threading

import pytest

from coding_fixture import World
from reader_mcp import repositories


@pytest.fixture
def w(tmp_path):
    world = World(tmp_path)
    yield world
    world.close()


def test_a_registration_past_the_repository_limit_is_refused_and_the_file_kept(w, monkeypatch):
    registry = w.jobs.registry
    registry.write({f'acme/repo{i}': w.entry for i in range(repositories.MAX_REPOSITORIES)})
    before = registry.file.read_bytes()
    monkeypatch.setattr(repositories, 'inspect', lambda entry: [])
    with pytest.raises(repositories.RegistryError, match=str(repositories.MAX_REPOSITORIES)):
        registry.register('acme/extra', w.entry)
    assert registry.file.read_bytes() == before and len(registry.raw()) == repositories.MAX_REPOSITORIES


def test_a_registration_that_would_exceed_the_file_limit_is_refused_and_the_file_kept(w, monkeypatch):
    registry = w.jobs.registry
    before = registry.file.read_bytes()
    monkeypatch.setattr(repositories, 'inspect', lambda entry: [])
    with pytest.raises(repositories.RegistryError, match='256 KiB'):
        registry.register('acme/widget', dict(w.entry, verify={'argv': ['x' * 4096] * 64}))
    assert registry.file.read_bytes() == before


def test_two_servers_registering_at_once_lose_neither_registration(w, monkeypatch):
    monkeypatch.setattr(repositories, 'inspect', lambda entry: [])
    first, second = repositories.Registry(w.vault), repositories.Registry(w.vault)
    both_read, first_written, write = threading.Barrier(2), threading.Event(), repositories.Registry.write

    def coordinated(self, rows):
        try:
            both_read.wait(timeout=0.5)  # Without a shared lock, both servers have read the file by now.
        except threading.BrokenBarrierError:
            pass
        if self is second:
            first_written.wait(timeout=5)
        write(self, rows)
        if self is first:
            first_written.set()
    monkeypatch.setattr(repositories.Registry, 'write', coordinated)
    threads = [threading.Thread(target=r.register, args=(name, w.entry)) for r, name in ((first, 'acme/first'), (second, 'acme/second'))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert {'acme/widget', 'acme/first', 'acme/second'} <= first.raw().keys()
