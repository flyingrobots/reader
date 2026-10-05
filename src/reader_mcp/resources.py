"""Free-space reserves for host filesystems and genuinely bounded Linux tmpfs."""
from pathlib import Path
import shutil

GIB = 1024**3


def minimum_free_bytes(path):
    path = Path(path).resolve()
    mounts = Path('/proc/self/mountinfo')
    if mounts.is_file():
        candidates = []
        for line in mounts.read_text().splitlines():
            left, right = line.split(' - ', 1)
            raw = left.split()[4]
            mount = Path(raw.replace('\\040', ' ').replace('\\011', '\t').replace('\\134', '\\'))
            if path == mount or mount in path.parents:
                candidates.append((len(mount.parts), right.split()[0]))
        if candidates and max(candidates)[1] == 'tmpfs':
            total = shutil.disk_usage(path).total
            if 0 < total <= 4*GIB:
                # The kernel enforces the mount's capacity; no environment flag can waive it.
                return max(16*1024**2, min(256*1024**2, total//4))
    return 50*GIB


def has_capacity(path):
    return shutil.disk_usage(path).free >= minimum_free_bytes(path)
