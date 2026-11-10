"""Read the process table without starting `ps`.

`/bin/ps` is setuid root, and macOS never lets a sandboxed process start a setuid program, so supervisors that shell
out to it fail inside the test sandbox (scripts/test_jail.py). macOS answers through libproc and Linux through /proc;
both give the same pids, parents, process groups and resident memory as `ps`. An unreadable table raises OSError, so
callers that guard memory keep failing closed.
"""
import ctypes
import os
from pathlib import Path
import sys
import time

# struct proc_bsdinfo and struct proc_taskinfo from <sys/proc_info.h>.
PROC_PIDTBSDINFO = 3
PROC_PIDTASKINFO = 4
SZOMB = 5  # <sys/proc.h>: an exited process its parent has not reaped
LSTART = '%a %b %e %H:%M:%S %Y'  # `ps -o lstart=`, so start times recorded before this module still match


class BSDInfo(ctypes.Structure):
    _fields_ = [('flags', ctypes.c_uint32), ('status', ctypes.c_uint32), ('xstatus', ctypes.c_uint32),
                ('pid', ctypes.c_uint32), ('ppid', ctypes.c_uint32), ('uid', ctypes.c_uint32), ('gid', ctypes.c_uint32),
                ('ruid', ctypes.c_uint32), ('rgid', ctypes.c_uint32), ('svuid', ctypes.c_uint32), ('svgid', ctypes.c_uint32),
                ('rfu_1', ctypes.c_uint32), ('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32),
                ('nfiles', ctypes.c_uint32), ('pgid', ctypes.c_uint32), ('pjobc', ctypes.c_uint32),
                ('e_tdev', ctypes.c_uint32), ('e_tpgid', ctypes.c_uint32), ('nice', ctypes.c_int32),
                ('start_tvsec', ctypes.c_uint64), ('start_tvusec', ctypes.c_uint64)]


class TaskInfo(ctypes.Structure):
    _fields_ = [('virtual_size', ctypes.c_uint64), ('resident_size', ctypes.c_uint64), ('total_user', ctypes.c_uint64),
                ('total_system', ctypes.c_uint64), ('threads_user', ctypes.c_uint64), ('threads_system', ctypes.c_uint64),
                ('policy', ctypes.c_int32), ('faults', ctypes.c_int32), ('pageins', ctypes.c_int32),
                ('cow_faults', ctypes.c_int32), ('messages_sent', ctypes.c_int32), ('messages_received', ctypes.c_int32),
                ('syscalls_mach', ctypes.c_int32), ('syscalls_unix', ctypes.c_int32), ('csw', ctypes.c_int32),
                ('threadnum', ctypes.c_int32), ('numrunning', ctypes.c_int32), ('priority', ctypes.c_int32)]


_libproc = None


def libproc():
    global _libproc
    if _libproc is None:
        library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        library.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
        library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        library.proc_listpgrppids.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        _libproc = library
    return _libproc


def pid_info(pid, flavor, struct):
    """The structure for one process, or None when it has exited or cannot be inspected."""
    value = struct()
    filled = libproc().proc_pidinfo(pid, flavor, 0, ctypes.byref(value), ctypes.sizeof(value))
    return value if filled == ctypes.sizeof(value) else None


def mac_pids():
    library = libproc()
    for _ in range(3):
        count = library.proc_listallpids(None, 0)
        if count <= 0:
            break
        # Room for processes started between the two calls.
        buffer = (ctypes.c_int * (count + 64))()
        found = library.proc_listallpids(buffer, ctypes.sizeof(buffer))
        if 0 < found <= count + 64:
            return [pid for pid in buffer[:found] if pid > 0]
    raise OSError(ctypes.get_errno(), 'Cannot list processes')


def mac_rows():
    rows = []
    for pid in mac_pids():
        bsd, task = pid_info(pid, PROC_PIDTBSDINFO, BSDInfo), pid_info(pid, PROC_PIDTASKINFO, TaskInfo)
        if bsd is not None:
            rows.append((pid, bsd.ppid, bsd.pgid, task.resident_size if task is not None else 0))
    return rows


def linux_stat(pid):
    """Fields of /proc/PID/stat after the command name, which may itself contain spaces and parentheses."""
    text = (Path('/proc') / str(pid) / 'stat').read_text()
    return text[text.rindex(')') + 2:].split()


def linux_rows():
    page = os.sysconf('SC_PAGE_SIZE')
    rows = []
    for entry in os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            fields = linux_stat(int(entry))
        except (OSError, ValueError):
            continue  # exited while listing
        rows.append((int(entry), int(fields[1]), int(fields[2]), int(fields[21]) * page))
    return rows


def rows():
    """(pid, ppid, pgid, resident bytes) for every process this user can inspect. Raises OSError when the table
    cannot be read at all."""
    if sys.platform == 'darwin':
        return mac_rows()
    if sys.platform.startswith('linux'):
        return linux_rows()
    raise OSError(f'Reading the process table is not supported on {sys.platform}')


def group_rss(pgid):
    """Resident bytes of every process in one process group."""
    return sum(rss for pid, parent, group, rss in rows() if group == pgid)


def group_alive(pgid):
    """Whether any process is still in the group, including members this user cannot inspect."""
    if sys.platform == 'darwin':
        buffer = (ctypes.c_int * 4096)()
        found = libproc().proc_listpgrppids(pgid, buffer, ctypes.sizeof(buffer))
        if found < 0:
            raise OSError(ctypes.get_errno(), 'Cannot list the process group')
        return found > 0
    return any(group == pgid for pid, parent, group, rss in rows())


def running(pid):
    """Whether the process exists and has not exited. A zombie still answers kill(pid, 0) until it is reaped."""
    try:
        if sys.platform == 'darwin':
            bsd = pid_info(pid, PROC_PIDTBSDINFO, BSDInfo)
            return bsd is not None and bsd.status != SZOMB
        return linux_stat(pid)[0] not in ('Z', 'X')
    except (OSError, ValueError):
        return False


def started(pid):
    """The process's start time as `ps -o lstart=` prints it, to recognize it after a restart (pids are reused), or
    None when it is not running."""
    try:
        if sys.platform == 'darwin':
            bsd = pid_info(pid, PROC_PIDTBSDINFO, BSDInfo)
            return time.strftime(LSTART, time.localtime(bsd.start_tvsec)) if bsd is not None else None
        if sys.platform.startswith('linux'):
            boot = next(int(line.split()[1]) for line in Path('/proc/stat').read_text().splitlines() if line.startswith('btime '))
            ticks = int(linux_stat(pid)[19])
            return time.strftime(LSTART, time.localtime(boot + ticks // os.sysconf('SC_CLK_TCK')))
    except (OSError, ValueError, StopIteration):
        return None
    return None
