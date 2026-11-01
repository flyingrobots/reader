"""Bounded command transport for the Docker/devcontainer control plane.

This supervises the client process group. The runtime must separately stop the owned container on
cancellation/failure: killing a Docker client does not kill processes already running in a container.
"""
import os
import selectors
import signal
import subprocess
import time

MAX_OUTPUT = 4 * 1024**2
MAX_STREAM = 64 * 1024**2


class ProcessError(RuntimeError):
    pass


def reap(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=3)


def execute(argv, *, timeout=15, env=None, stdin=subprocess.DEVNULL, cancelled=lambda: False,
            output=None, limit=MAX_OUTPUT, started=None, finished=None, capture_limit=MAX_OUTPUT):
    """A CompletedProcess with bounded combined streams; callbacks run before accepting more output."""
    if timeout <= 0 or not 0 < limit <= MAX_STREAM or not 0 <= capture_limit <= MAX_OUTPUT:
        raise ProcessError('Command deadline or output limit is invalid')
    deadline = time.monotonic() + timeout
    child = subprocess.Popen(argv, env=env, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True)
    selector = None
    buffers = {child.stdout: bytearray(), child.stderr: bytearray()}
    names = {child.stdout: 'stdout', child.stderr: 'stderr'}
    used = 0
    try:
        if started:
            started(child.pid)
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
            if selector:
                selector.close()
        finally:
            try:
                reap(child)
            finally:
                try:
                    for stream in buffers:
                        stream.close()
                finally:
                    if finished:
                        finished(child.pid)
