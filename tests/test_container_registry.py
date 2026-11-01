from copy import deepcopy
import subprocess

import pytest

from coding_fixture import World
from container_coding_fixture import entry
from reader_mcp import repositories


@pytest.fixture
def registered(tmp_path):
    world = World(tmp_path)
    store = tmp_path / 'authority.git'
    subprocess.run(['git', 'init', '--bare', str(store)], check=True, capture_output=True)
    yield world, entry(world, store)
    world.close()


def test_container_registration_needs_no_checkout_and_never_probes_host_git(registered, monkeypatch):
    world, raw = registered
    monkeypatch.setattr(repositories, 'git', lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('Host Git was used')))
    result = repositories.validate('acme/widget', raw, world.vault)
    assert result['checkout'] is None and result['worktree_root'] is None
    assert result['environment']['revision'] == world.base_sha and repositories.inspect(result) == []
    world.jobs.registry.register('acme/widget', raw)
    assert world.jobs.registry.entry('acme/widget')['environment']['image_id'] == raw['environment']['image_id']


@pytest.mark.parametrize('change', ['consent', 'digest', 'host-lock', 'deadline', 'host-checkout'])
def test_approval_and_execution_boundaries_are_not_silently_rewritten(registered, change):
    world, original = registered
    raw = deepcopy(original)
    if change == 'consent':raw['environment']['consent'] = False
    elif change == 'digest':raw['environment']['sha256'] = '0' * 64
    elif change == 'host-lock':raw['verify']['lock'] = {'store': str(world.tmp)}
    elif change == 'deadline':raw['environment']['timeout_seconds'] = 300
    else:raw['checkout'] = str(world.checkout)
    with pytest.raises(repositories.RegistryError):
        repositories.validate('acme/widget', raw, world.vault)


def test_self_hashed_custom_configuration_cannot_claim_to_be_readers_inference(registered):
    import hashlib,json
    world,original=registered
    raw=deepcopy(original)
    raw['environment']['configuration']['containerEnv']={'PROJECT':'operator-modified'}
    raw['environment']['sha256']=hashlib.sha256(json.dumps(raw['environment']['configuration'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    with pytest.raises(repositories.RegistryError,match='proposal'):
        repositories.validate('acme/widget',raw,world.vault)
