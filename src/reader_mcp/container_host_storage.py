"""Account bounded CLI metadata/temp data, including writable open-but-unlinked client files.

Clients are trusted Docker/devcontainer tools, launched in their own process groups. Repository host
initialization is unsupported. Linux uses procfs; macOS requires lsof's machine-readable descriptor
fields. Failure to inspect the active clients is a guard failure, never a zero-byte measurement.
"""
import os
from pathlib import Path
import stat
import sys

from .container_process import ProcessError, execute

LIMIT = 8 * 1024**2


def lsof_files(data):
    """Parse NUL-delimited file records; newlines are record separators, not field delimiters."""
    file = {}
    for raw in data.split('\0'):
        field = raw.lstrip('\n')
        if not field:
            continue
        if field[0] in ('p', 'f'):
            if file:
                yield file
            file = {}
        if field[0] != 'p':
            file[field[0]] = field[1:]
    if file:
        yield file


def measure(folder, groups, run=execute):
    folder = Path(folder)
    seen, used = set(), 0

    def account(info):
        nonlocal used
        key = (info.st_dev, info.st_ino)
        if key not in seen:
            seen.add(key)
            used += max(info.st_size, info.st_blocks * 512)
            if used > LIMIT:
                raise ProcessError('Runtime control storage exceeded 8 MiB')

    def failed(error):raise error
    if folder.is_symlink():
        raise ProcessError('Symlink in runtime control storage')
    if folder.exists():
        account(folder.stat())
        for directory, dirs, files in os.walk(folder, followlinks=False, onerror=failed):
            for name in dirs + files:
                path = Path(directory) / name
                if path.is_symlink():
                    raise ProcessError('Symlink in runtime control storage')
                try:account(path.stat())
                except FileNotFoundError:pass  # A closed/deleted CLI temporary file no longer retains blocks.
    if not groups:
        return used
    if sys.platform == 'linux':
        for pid in os.listdir('/proc'):
            if not pid.isdigit():continue
            try:
                fields = Path('/proc', pid, 'stat').read_text().rsplit(')', 1)[1].split()
                if int(fields[2]) not in groups:continue
                names = os.listdir('/proc/' + pid + '/fd')
            except (FileNotFoundError, ProcessLookupError):continue
            for name in names:
                try:
                    descriptor = Path('/proc', pid, 'fd', name)
                    info = descriptor.stat()
                    flags = next(line.split()[1] for line in Path('/proc', pid, 'fdinfo', name).read_text().splitlines() if line.startswith('flags:'))
                    if not stat.S_ISREG(info.st_mode):continue
                    if info.st_nlink and not int(flags, 8) & os.O_ACCMODE:continue
                    target = os.readlink(descriptor)
                    if info.st_nlink and not target.startswith(str(folder) + '/'):
                        raise ProcessError('Control-plane client writes outside its owned data folder')
                    account(info)
                except (FileNotFoundError, ProcessLookupError):continue
            try:maps = Path('/proc', pid, 'maps').read_text().splitlines()
            except (FileNotFoundError, ProcessLookupError):continue
            for line in maps:
                fields = line.split(None, 5)
                if len(fields) < 6 or fields[4] == '0':continue
                name, perms = fields[5], fields[1]
                major, minor = (int(value, 16) for value in fields[3].split(':'))
                key = (os.makedev(major, minor), int(fields[4]))
                if key in seen:continue
                if name.startswith(str(folder) + '/'):
                    try:
                        info = Path(name).stat()
                        if (info.st_dev, info.st_ino) == key:
                            account(info);continue
                    except (FileNotFoundError, ProcessLookupError):pass
                    try:
                        info = Path('/proc', pid, 'map_files', fields[0]).stat()
                        account(info)
                    except (FileNotFoundError, ProcessLookupError):
                        try:remaining = Path('/proc', pid, 'maps').read_text().splitlines()
                        except (FileNotFoundError, ProcessLookupError):continue
                        if line in remaining:
                            raise ProcessError('Cannot account for a mapped control-plane file')
                    except PermissionError:
                        raise ProcessError('Cannot account for a mapped control-plane file') from None
                elif 'w' in perms and perms.endswith('s') and name.startswith('/') and not name.startswith(('/memfd:', '/dev/zero')):
                    raise ProcessError('Control-plane client maps writable storage outside its owned folder')
    elif sys.platform == 'darwin':
        result = run(['/usr/sbin/lsof', '-nP', '-a', '-g' + ','.join(str(g) for g in sorted(groups)), '-F0paftsnkiD'],
                     timeout=5, limit=1024**2)
        if result.returncode not in (0, 1) or result.stderr:
            raise ProcessError('Could not inspect control-plane client descriptors')
        for file in lsof_files(result.stdout):
            if file.get('t') != 'REG':continue
            if file.get('a') not in ('w', 'u') and file.get('k') != '0':continue
            try:
                key = (int(file['D'], 16), int(file['i']))
                links, size = int(file['k']), int(file['s'])
                if size < 0 or links < 0:raise ValueError()
                if links and not file['n'].startswith(str(folder) + '/'):
                    raise ProcessError('Control-plane client writes outside its owned data folder')
                if key not in seen:
                    seen.add(key);used += size
            except (KeyError, ValueError) as exc:
                raise ProcessError('Incomplete control-plane descriptor measurement') from exc
    else:
        raise ProcessError('Host descriptor accounting is unsupported on this platform')
    if used > LIMIT:
        raise ProcessError('Runtime control storage exceeded 8 MiB')
    return used
