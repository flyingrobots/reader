import json
from pathlib import Path
import subprocess
import sys

from reader_mcp.container_storage import MEASURE


def test_measurement_counts_an_open_unlinked_workspace_file(tmp_path):
    child = subprocess.Popen([sys.executable, '-c',
        'import os,sys,time;f=open(sys.argv[1],"wb");f.write(b"x"*1048576);f.flush();os.unlink(sys.argv[1]);print("ready",flush=True);time.sleep(30)',
        str(tmp_path / 'gone')], stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        assert not list(tmp_path.iterdir()), 'Directory-only accounting would miss this retained file'
        script = MEASURE.replace("root='/work'", 'root=' + repr(str(tmp_path)))
        result = subprocess.run([sys.executable, '-I', '-S', '-c', script], capture_output=True, text=True, check=True, timeout=5)
        assert json.loads(result.stdout)['workspace_bytes'] >= 1048576
    finally:
        child.kill();child.wait(timeout=5);child.stdout.close()


def test_measurement_counts_an_unlinked_mapping_after_all_file_descriptors_close(tmp_path):
    script = '''import ctypes,os,sys,time
lib=ctypes.CDLL(None)
lib.mmap.restype=ctypes.c_void_p
fd=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR,0o600)
os.ftruncate(fd,1048576)
address=lib.mmap(None,1048576,3,1,fd,0)
assert address != ctypes.c_void_p(-1).value
ctypes.memset(address,120,1048576)
os.close(fd);os.unlink(sys.argv[1])
print('ready',flush=True);time.sleep(30)
'''
    child = subprocess.Popen([sys.executable, '-c', script, str(tmp_path / 'mapped')], stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'ready' and not list(tmp_path.iterdir())
        program = MEASURE.replace("root='/work'", 'root=' + repr(str(tmp_path)))
        result = subprocess.run([sys.executable, '-I', '-S', '-c', program], capture_output=True, text=True, timeout=5)
        assert ((result.returncode == 0 and json.loads(result.stdout)['workspace_bytes'] >= 1048576)
                or (result.returncode != 0 and 'Cannot account for a mapped workspace file' in result.stderr)), 'Never report a successful undercount of retained mapped data'
    finally:
        child.kill();child.wait(timeout=5);child.stdout.close()


def test_transient_descriptor_denial_retries_a_complete_scan(tmp_path):
    (tmp_path/'retained').write_bytes(b'x'*1048576)
    prefix='''import os
original=os.lstat
remaining=1
def denied(path,*args,**kwargs):
 global remaining
 if str(path)==ROOT and remaining:
  remaining-=1
  raise PermissionError('credential transition')
 return original(path,*args,**kwargs)
os.lstat=denied
'''.replace('ROOT',repr(str(tmp_path)))
    program=prefix+MEASURE.replace("root='/work'",'root='+repr(str(tmp_path)))
    result=subprocess.run([sys.executable,'-I','-S','-c',program],capture_output=True,text=True,timeout=5)
    assert result.returncode==0,result.stderr
    assert json.loads(result.stdout)['workspace_bytes']>=1048576


def test_persistent_descriptor_denial_cannot_return_a_partial_count(tmp_path):
    prefix='''import os
def denied(*args,**kwargs):raise PermissionError('persistent denial')
os.lstat=denied
'''
    result=subprocess.run([sys.executable,'-I','-S','-c',prefix+MEASURE],capture_output=True,text=True,timeout=5)
    assert result.returncode!=0 and not result.stdout
