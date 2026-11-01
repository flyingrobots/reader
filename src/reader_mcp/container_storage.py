"""The managed container's accounting program, executed with isolated, read-only system Python.

Includes the greater of logical size and allocated directory/file blocks and open unlinked regular files on the workspace filesystem.
It is a monitored threshold, not a Docker volume quota. The host guard stops the whole container.
"""
# Kept as source text so measurement cannot import code from the job's writable workspace.
MEASURE = r'''
import json,os,stat
root='/work'
seen=set()
used=0

def account(path,follow=False):
 global used
 try:s=os.stat(path) if follow else os.lstat(path)
 except (FileNotFoundError,ProcessLookupError):return
 key=(s.st_dev,s.st_ino)
 if key not in seen:
  seen.add(key);used+=max(s.st_size,s.st_blocks*512)

def failed(error):raise error
account(root)
for folder,dirs,files in os.walk(root,followlinks=False,onerror=failed):
 for name in dirs+files:account(os.path.join(folder,name))
workdev=os.stat(root).st_dev
for pid in os.listdir('/proc'):
 if not pid.isdigit():continue
 try:fds=os.listdir('/proc/'+pid+'/fd')
 except (FileNotFoundError,ProcessLookupError):continue
 for fd in fds:
  path='/proc/'+pid+'/fd/'+fd
  try:s=os.stat(path)
  except (FileNotFoundError,ProcessLookupError):continue
  if s.st_dev==workdev and stat.S_ISREG(s.st_mode):account(path,True)
 try:maps=open('/proc/'+pid+'/maps').read().splitlines()
 except (FileNotFoundError,ProcessLookupError):continue
 for line in maps:
  fields=line.split(None,5)
  if len(fields)<5:raise RuntimeError('Incomplete workspace map measurement')
  major,minor=(int(value,16) for value in fields[3].split(':'))
  inode=int(fields[4]);key=(workdev,inode)
  if not inode or (major,minor)!=(os.major(workdev),os.minor(workdev)) or key in seen:continue
  if len(fields)>5:
   try:
    linked=os.stat(fields[5])
    if (linked.st_dev,linked.st_ino)==key:
     account(fields[5],True)
     if key in seen:continue
   except (FileNotFoundError,ProcessLookupError):pass
  # A mapping can retain an unlinked inode after its last descriptor closes. If the kernel
  # will not expose its size, refusal is safer than counting only the mapped fragment.
  try:
   mapped='/proc/'+pid+'/map_files/'+fields[0]
   info=os.stat(mapped)
   if (info.st_dev,info.st_ino)!=key:raise RuntimeError('Workspace mapping identity changed')
   account(mapped,True)
  except (FileNotFoundError,ProcessLookupError):
   # A vanished mapping no longer retains storage; a still-present one must be accounted for.
   try:remaining=open('/proc/'+pid+'/maps').read()
   except (FileNotFoundError,ProcessLookupError):continue
   if line not in remaining.splitlines():continue
   raise RuntimeError('Cannot account for a mapped workspace file')
  except PermissionError:
   raise RuntimeError('Cannot account for a mapped workspace file') from None
  if key not in seen:raise RuntimeError('Cannot account for a mapped workspace file')
v=os.statvfs(root)
caps={}
for path in ('/tmp','/dev/shm'):
 fs=os.statvfs(path);caps[path]=fs.f_blocks*fs.f_frsize
print(json.dumps({'workspace_bytes':used,'vm_free_bytes':v.f_bavail*v.f_frsize,'tmpfs_bytes':caps}))
'''

# exec/credential transitions can briefly make a live process's /proc descriptors unreadable.
# Retry a complete scan, never skip a PID or return a partial count. Persistent denial still stops work.
import textwrap

MEASURE = ('import time\ndef _scan():\n' + textwrap.indent(MEASURE.replace(' global used', ' nonlocal used'), ' ')
           + '\nfor _attempt in range(4):\n try:\n  _scan()\n  break\n except PermissionError:\n  if _attempt == 3:raise\n  time.sleep(.05)\n')
