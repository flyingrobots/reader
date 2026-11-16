"""Durable identities for host control-plane groups, before their launch gate opens.

A missing leader with live descendants is deliberately manual recovery: never signal a reused PID.
Kernel start identities include the boot, with microsecond precision on Darwin and ticks on Linux.
"""
import ctypes
import os
from pathlib import Path
import signal
import socket
import sys
import threading
import time

from .container_process import ProcessError, group_finished


def identity(pid):
    if sys.platform == 'linux':
        try:
            data = Path('/proc/' + str(pid) + '/stat').read_text()[:16384].rsplit(')', 1)[1].split()
            return {'pid': pid, 'group': int(data[2]), 'started': data[19], 'host': socket.gethostname(),
                    'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
        except FileNotFoundError:return None
    if sys.platform == 'darwin':
        class BSDInfo(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint32) for name in ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','rfu')]+[
                ('comm', ctypes.c_char*16), ('name', ctypes.c_char*32)]+[(name, ctypes.c_uint32) for name in ('nfiles','pgid','jobc','tdev','tpgid','nice')]+[
                ('seconds', ctypes.c_uint64), ('microseconds', ctypes.c_uint64)]
        value = BSDInfo()
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        count = lib.proc_pidinfo(pid, 3, 0, ctypes.byref(value), ctypes.sizeof(value))
        if count == 0 and ctypes.get_errno() == 3:return None
        if count != ctypes.sizeof(value) or value.pid != pid:raise ProcessError('Cannot inspect host client birth identity')
        boot = (ctypes.c_long*2)();size = ctypes.c_size_t(ctypes.sizeof(boot))
        if ctypes.CDLL(None).sysctlbyname(b'kern.boottime', ctypes.byref(boot), ctypes.byref(size), None, 0):
            raise ProcessError('Cannot inspect host boot identity')
        return {'pid':pid, 'group':value.pgid, 'started':str(value.seconds)+':'+str(value.microseconds),
                'host':socket.gethostname(), 'boot':str(boot[0])+':'+str(boot[1])}
    raise ProcessError('Durable host-client recovery supports Linux and macOS only')


class Clients:
    def __init__(self, persist, saved=()):
        if not isinstance(saved, (list, tuple)) or len(saved)>64:raise ProcessError('Invalid saved host client journal')
        self.values = {}
        self.lock, self.persist = threading.RLock(), persist
        for item in saved:
            if (not isinstance(item, dict) or set(item) != {'pid','group','started','host','boot'}
                    or type(item['pid']) is not int or item['pid'] <= 1 or item['group'] != item['pid']
                    or any(not isinstance(item[key], str) or not 0<len(item[key])<=256 for key in ('started','host','boot'))
                    or item['pid'] in self.values):raise ProcessError('Invalid saved host client identity')
            self.values[item['pid']] = item

    def _save(self, values):
        self.persist({'control_clients':list(values.values())})
        self.values = values

    def started(self, pid):
        with self.lock:
            if len(self.values)>=64:raise ProcessError('Host client journal reached its bound')
            value = identity(pid)
            if not value or value['group']!=pid:raise ProcessError('Cannot identify gated host client')
            self._save(self.values | {pid:value})

    def finished(self, pid):
        with self.lock:self._save({key:value for key,value in self.values.items() if key!=pid})

    def reconcile(self):
        with self.lock:
            local = identity(os.getpid()) if self.values else None
            for pid, saved in list(self.values.items()):
                if saved['host'] != local['host']:raise ProcessError('Host client journal belongs to another host')
                if saved['boot'] != local['boot']:
                    self.finished(pid)
                    continue
                # Positive absence proof also covers a leader that exited before its descendants.
                if group_finished(pid):self.finished(pid);continue
                current = identity(pid)
                if current != saved:raise ProcessError('Host client group cannot be safely identified; manual reconciliation required')
                os.killpg(pid, signal.SIGTERM)
                deadline=time.monotonic()+2
                while not group_finished(pid) and time.monotonic()<deadline:time.sleep(.05)
                if not group_finished(pid):
                    if identity(pid)!=saved:raise ProcessError('Host client identity changed during recovery; ownership retained')
                    os.killpg(pid, signal.SIGKILL)
                    deadline=time.monotonic()+3
                    while not group_finished(pid) and time.monotonic()<deadline:time.sleep(.05)
                if not group_finished(pid):raise ProcessError('Host client group cleanup remains unconfirmed')
                self.finished(pid)
