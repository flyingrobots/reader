"""Bounded command transport for the Docker/devcontainer control plane.

This supervises the client process group. The runtime must separately stop the owned container on
cancellation/failure: killing a Docker client does not kill processes already running in a container.
"""
import os
import selectors
import signal
import subprocess
import sys
import time

MAX_OUTPUT = 4 * 1024**2
MAX_STREAM = 64 * 1024**2


class ProcessError(RuntimeError):
    pass


def _process_table():
    # Fixed single-process OS utility: bounded capture and direct-child cleanup avoid recursive
    # process-group verification while the caller is itself proving group termination.
    argv = ['/bin/ps', '-axo', 'pgid=,stat=']
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    buffers = {child.stdout: bytearray(), child.stderr: bytearray()}
    used, deadline = 0, time.monotonic() + 2
    try:
        for stream in buffers:selector.register(stream, selectors.EVENT_READ)
        while selector.get_map() or child.poll() is None:
            if time.monotonic() >= deadline:raise ProcessError('Process-table query deadline exceeded')
            for key, _ in selector.select(.05):
                data = os.read(key.fd, min(16384, MAX_OUTPUT-used+1))
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                used += len(data)
                if used > MAX_OUTPUT:raise ProcessError('Process-table query output limit exceeded')
                buffers[key.fileobj].extend(data)
        return subprocess.CompletedProcess(argv, child.wait(timeout=2),
            buffers[child.stdout].decode('utf-8', 'replace'), buffers[child.stderr].decode('utf-8', 'replace'))
    finally:
        selector.close()
        try:
            if child.poll() is None:child.kill()
            child.wait(timeout=3)
        finally:
            for stream in buffers:stream.close()


def group_finished(group, run=None):
    """A positive process-table answer: the group is absent or contains only zombies.

    Darwin can return EPERM when signalling an already-finished group. Never treat EPERM itself
    as proof of cleanup, and never ignore a live or unreadable process-table entry.
    """
    try:
        result = _process_table() if run is None else run(['/bin/ps', '-axo', 'pgid=,stat='], capture_output=True, text=True, timeout=2)
        if result.returncode or result.stderr or not result.stdout.strip() or len(result.stdout) > MAX_OUTPUT:
            return False
        for line in result.stdout.splitlines():
            if not line.strip():continue
            fields = line.split()
            if len(fields) != 2 or not fields[0].isdigit():return False
            if int(fields[0]) == group and not fields[1].startswith('Z'):return False
        return True
    except (OSError, subprocess.TimeoutExpired, ProcessError):
        return False


def reap(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except PermissionError:
        if process.poll() is None or not group_finished(process.pid):raise
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            if process.poll() is None or not group_finished(process.pid):raise
        process.wait(timeout=3)
        deadline = time.monotonic()+3
        while not group_finished(process.pid) and time.monotonic()<deadline:time.sleep(.05)
        if not group_finished(process.pid):raise ProcessError('Host client group cleanup remains unconfirmed')


def execute(argv, *, timeout=15, env=None, stdin=subprocess.DEVNULL, cancelled=lambda: False,
            output=None, limit=MAX_OUTPUT, started=None, finished=None, capture_limit=MAX_OUTPUT):
    """A CompletedProcess with bounded combined streams; callbacks run before accepting more output."""
    if timeout <= 0 or not 0 < limit <= MAX_STREAM or not 0 <= capture_limit <= MAX_OUTPUT:
        raise ProcessError('Command deadline or output limit is invalid')
    deadline = time.monotonic() + timeout
    gate_read, gate_write = os.pipe() if started else (None, None)
    # The trusted child cannot exec the real command until the parent durably records its identity.
    # A parent crash before release closes the pipe; EOF exits without executing the command.
    launch = ([sys.executable, '-I', '-S', '-c',
        'import os,sys;fd=int(sys.argv[1]);ok=os.read(fd,1)==b"G";os.close(fd);'
        'sys.exit(125) if not ok else os.execvpe(sys.argv[2],sys.argv[2:],os.environ)',
        str(gate_read), *map(str,argv)] if started else argv)
    try:
        child = subprocess.Popen(launch, env=env, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 start_new_session=True, pass_fds=(gate_read,) if started else ())
    except BaseException:
        if started:os.close(gate_write)
        raise
    finally:
        if started:os.close(gate_read)
    selector = None
    buffers = {child.stdout: bytearray(), child.stderr: bytearray()}
    names = {child.stdout: 'stdout', child.stderr: 'stderr'}
    used = 0
    try:
        if started:
            started(child.pid)
            os.write(gate_write, b"G")
            os.close(gate_write)
            gate_write = None
        selector = selectors.DefaultSelector()
        for stream in buffers:
            selector.register(stream, selectors.EVENT_READ)
        while selector.get_map() or child.poll() is None:
            if cancelled():
                raise ProcessError('Container command cancelled')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProcessError('Container command deadline exceeded')
            for key, _ in selector.select(min(.1, remaining)):
                chunk = os.read(key.fd, min(16384, limit - used + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                used += len(chunk)
                if used > limit:
                    raise ProcessError('Container command output limit exceeded')
                if output:
                    output(names[key.fileobj], chunk)
                if capture_limit:
                    buffers[key.fileobj].extend(chunk)
                    if len(buffers[key.fileobj]) > capture_limit:
                        del buffers[key.fileobj][:-capture_limit]
        return subprocess.CompletedProcess(argv, child.wait(timeout=max(.001, deadline - time.monotonic())),
                buffers[child.stdout].decode('utf-8', 'replace'), buffers[child.stderr].decode('utf-8', 'replace'))
    finally:
        try:
            if gate_write is not None:os.close(gate_write)
            if selector:
                selector.close()
        finally:
            reaped = False
            try:
                reap(child)
                reaped = True
            finally:
                try:
                    for stream in buffers:
                        stream.close()
                finally:
                    if finished and reaped:
                        finished(child.pid)
