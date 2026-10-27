"""Python side of the lock interop tests. It takes the lock exactly as
reader_mcp.annotations.Annotations.locked does: open(path, 'a'), then fcntl.flock(LOCK_EX).

usage: py_lock.py hold LOCK LOG   print 'locked', wait for a stdin line, log 'py-release', exit
       py_lock.py wait LOCK LOG   print 'waiting', block for the lock, log 'py-acquired', print 'locked', exit
       py_lock.py try LOCK        print 'locked' or 'busy' without waiting
       py_lock.py count LOCK COUNTER N   increment COUNTER N times, each under the lock
"""
import fcntl, sys

def say(word):
    print(word, flush=True)

def log(path, word):
    with open(path, 'a') as stream:
        stream.write(word + '\n')

mode, lock_path = sys.argv[1], sys.argv[2]
if mode == 'hold':
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        say('locked')
        sys.stdin.readline()
        log(sys.argv[3], 'py-release')
elif mode == 'wait':
    say('waiting')
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        log(sys.argv[3], 'py-acquired')
        say('locked')
elif mode == 'try':
    with open(lock_path, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            say('busy')
        else:
            say('locked')
elif mode == 'count':
    counter = sys.argv[3]
    for _ in range(int(sys.argv[4])):
        with open(lock_path, 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with open(counter) as stream:
                value = int(stream.read())
            with open(counter, 'w') as stream:
                stream.write(str(value + 1))
    say('done')
else:
    sys.exit('unknown mode ' + mode)
