"""Fail-closed admission for a previous destructive reset; recovery remains explicit."""
import hashlib
import json
import os
from pathlib import Path
import stat

from .container_process import ProcessError


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
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
                raise ValueError('invalid reset record')
            data = stream.read(65537)
            if len(data) > 65536:
                raise ValueError('reset record exceeds its bound')
            value = json.loads(data)
        if (not isinstance(value, dict) or value.get('state') not in ('completed', 'refused')
                or value.get('control_clients') != []
                or not isinstance(value.get('repo'), str) or value['repo'].casefold() != repo.casefold()
                or value.get('volume') != 'reader-coding-' + key + '-work'):
            raise ValueError('unconfirmed reset')
    except (OSError, ValueError, TypeError) as exc:
        raise ProcessError(message) from exc
