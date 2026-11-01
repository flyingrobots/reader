"""An explicit shared git-locks lease for one concrete Docker worker and its persistent outputs."""
import json
import math
import os
import time
import uuid

from .container_process import ProcessError, execute


class Lease:
    def __init__(self, executable, store, key, seconds, run=execute):
        self.tool, self.key, self.run = executable, key, run
        self.env = dict(os.environ, GIT_LOCKS_STORE=str(store))
        self.job = 'reader-container-' + uuid.uuid4().hex
        self.seconds = math.ceil(seconds) + 120
        self.acquisition = None

    def acquire(self):
        result = self.run([self.tool, 'claim', '--job', self.job, '--holder', 'reader-coding-job',
            '--ttl', str(self.seconds), '--note', 'Reader managed coding container', self.key],
            env=self.env, timeout=15, limit=65536)
        if result.returncode:
            raise ProcessError('Container resource is unavailable: ' + result.stderr[-1000:])
        try:
            receipt = json.loads(result.stdout)
            if receipt['event'] != 'claimed' or receipt['job'] != self.job or receipt['paths'] != [self.key]:
                raise ValueError('Unexpected acquisition')
            self.acquisition = receipt['acquisition']
            if not isinstance(self.acquisition, str) or not self.acquisition:
                raise ValueError('Missing acquisition')
        except (ValueError, KeyError, TypeError) as exc:
            raise ProcessError('Unreadable container lease receipt; do not start the workload') from exc
        return self

    def check(self):
        result = self.run([self.tool, 'show', '--job', self.job], env=self.env, timeout=10, limit=65536)
        try:
            receipt = json.loads(result.stdout)
            valid = (result.returncode == 0 and receipt['state'] == 'live' and receipt['job'] == self.job
                     and receipt['acquisition'] == self.acquisition and receipt['paths'] == [self.key]
                     and receipt['expires'] > time.time() + 30)
        except (ValueError, KeyError, TypeError):
            valid = False
        if not valid:
            raise ProcessError('Container resource lease was lost or is about to expire')

    def release(self):
        if not self.acquisition:
            return
        result = self.run([self.tool, 'release', '--job', self.job, '--acquisition', self.acquisition],
                          env=self.env, timeout=15, limit=65536)
        if result.returncode:
            raise ProcessError('Could not release the container resource lease')
        self.acquisition = None
