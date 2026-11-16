"""Medium reset-record boundary tests: uncertain custody must refuse admission."""
import json
import os

import pytest

from container_coding_fixture import reset_marker
from reader_mcp.container_process import ProcessError
from reader_mcp.container_state import require_reset_settled


@pytest.mark.parametrize('problem', [
    'file-symlink', 'parent-symlink', 'oversized', 'array', 'repo', 'volume', 'fifo',
])
def test_invalid_reset_records_fail_closed_without_modification(tmp_path, problem):
    path = reset_marker(tmp_path, 'completed')
    if problem == 'file-symlink':
        target = path.with_suffix('.original')
        path.rename(target)
        path.symlink_to(target.name)
    elif problem == 'parent-symlink':
        folder = path.parent
        target = folder.with_name(folder.name + '-original')
        folder.rename(target)
        folder.symlink_to(target.name, target_is_directory=True)
    elif problem == 'oversized':path.write_bytes(b' ' * 65537)
    elif problem == 'array':path.write_text('[]')
    elif problem in ('repo', 'volume'):
        record = json.loads(path.read_text())
        record[problem] = 'foreign'
        path.write_text(json.dumps(record))
    else:
        path.unlink()
        os.mkfifo(path)
    before = path.lstat()

    with pytest.raises(ProcessError, match='reset'):
        require_reset_settled(tmp_path, 'acme/widget')

    after = path.lstat()
    assert (after.st_ino, after.st_mode, after.st_mtime_ns) == (before.st_ino, before.st_mode, before.st_mtime_ns)
