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
