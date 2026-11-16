from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from reader_mcp import container_host_storage as storage
from reader_mcp.container_process import ProcessError


def test_host_accounting_does_not_miss_an_unlinked_client_temporary_file(tmp_path, monkeypatch):
    folder = tmp_path / 'control';folder.mkdir()
    child = subprocess.Popen([sys.executable, '-c',
        'import os,sys,time;f=open(sys.argv[1],"wb");f.write(b"x"*1048576);f.flush();os.unlink(sys.argv[1]);print("ready",flush=True);time.sleep(30)',
        str(folder / 'gone')], stdout=subprocess.PIPE, text=True, start_new_session=True)
    try:
        assert child.stdout.readline().strip() == 'ready' and not list(folder.iterdir())
        monkeypatch.setattr(storage, 'LIMIT', 512 * 1024)
        with pytest.raises(ProcessError, match='control storage exceeded'):
            storage.measure(folder, {child.pid})
    finally:
        child.kill();child.wait(timeout=5);child.stdout.close()


def test_macos_descriptor_records_keep_embedded_newlines_in_names(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.sys, 'platform', 'darwin')
    data = 'p42\0\nf3\0au\0tREG\0s1048576\0k0\0i123\0D0x1\0n/tmp/name\nwith-newline\0\n'
    [file] = list(storage.lsof_files(data))
    assert file['n'] == '/tmp/name\nwith-newline'
    monkeypatch.setattr(storage, 'LIMIT', 512 * 1024)
    def run(argv, **kwargs):return SimpleNamespace(returncode=0, stdout=data, stderr='')
    with pytest.raises(ProcessError, match='control storage exceeded'):
        storage.measure(tmp_path, {42}, run=run)


def test_macos_writable_file_outside_the_control_folder_is_a_guard_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.sys, 'platform', 'darwin')
    data = 'p42\0\nf3\0aw\0tREG\0s20\0k1\0i123\0D0x1\0n/outside/log\0'
    def run(argv, **kwargs):return SimpleNamespace(returncode=0, stdout=data, stderr='')
    with pytest.raises(ProcessError, match='outside its owned'):
        storage.measure(tmp_path, {42}, run=run)
