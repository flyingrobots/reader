"""Bounded control-record reads and fail-closed reset admission; recovery remains explicit."""
import hashlib
import json
import os
from pathlib import Path
import stat

from .container_process import ProcessError


def read_control_record(path):
    """Read one bounded regular JSON object without waiting on special-file writers."""
    try:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
                raise ValueError('invalid control record')
            data = stream.read(65537)
            if len(data) > 65536:
                raise ValueError('control record exceeds its bound')
            value = json.loads(data)
        if not isinstance(value, dict):raise ValueError('control record must be an object')
        return value
    except (OSError, ValueError, TypeError) as exc:
        raise ProcessError('Invalid setup/reset control record; manual reconciliation is required') from exc


def require_reset_settled(root, repo):
    """Read without modifying custody. Lease expiry never proves deletion finished."""
    key = hashlib.sha256(repo.casefold().encode()).hexdigest()[:16]
    path = Path(root)
    message = ('Previous reset is unconfirmed. Manually reconcile its saved host-client identities, '
               'exact lease and volume state before starting setup or Coding Jobs.')
    try:
        for part in ('.reader', 'container-runtime', key, 'reset.json'):
            path /= part
            if path.is_symlink():
                raise ValueError('symlink reset control path')
        value = read_control_record(path)
        if value is None:return
        if (value.get('state') not in ('completed', 'refused')
                or value.get('control_clients') != []
                or not isinstance(value.get('repo'), str) or value['repo'].casefold() != repo.casefold()
                or value.get('volume') != 'reader-coding-' + key + '-work'):
            raise ValueError('unconfirmed reset')
    except (OSError, ValueError, TypeError, ProcessError) as exc:
        raise ProcessError(message) from exc
