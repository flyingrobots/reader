"""The coding-job HTTP surface (RW-44): article actions, runs, events, archive reads and the registry.

Every answer is browser-safe: host folders appear as `<vault>/…` or `~/…` (#105), credentials never
appear, and archive reads are bounded. GET requests never admit, run, recover or write anything; only
POST `/api/jobs` submits or stops, and only POST `/api/repositories` (from this Mac) edits the registry."""
from . import coding_agents, llm_logs, prompt_blocks
from .coding_jobs import ARTIFACTS, MAX_ARTIFACT, JobsOwned, Runner
from .coding_store import archived_events, valid_id
from .display import shown
from .repositories import RegistryError

PAGE = 50
ACTIVE = ('queued', 'running')


class CodingJobs(Runner):
    def view(self, run):
        """A run as every view shows it, with the derived interruption of an unowned unfinished run."""
        if not run:
            raise ValueError('No coding job with that ID')
        capture = self.captures.get(run['id'])
        status, outcome, message = run.get('status'), run.get('outcome'), run.get('message')
        orphan = status in ACTIVE and not self.owner() and not self.supervisor.held()
        if orphan:
            status, outcome = 'finished', 'interrupted'
            message = 'No Reader server is running this job; it was interrupted and will not restart.'
        git = dict(run.get('git') or {})
        view = {k: run.get(k) for k in ('id', 'request_id', 'predecessor', 'created_at', 'started_at', 'finished_at', 'phase', 'agent', 'source',
                                         'prompt', 'issue', 'pr', 'existing_pr', 'push', 'verification', 'tools', 'log', 'recovered', 'archive_error')}
        view.update(status=status, outcome=outcome, message=message, git=git, agent_label=coding_agents.LABELS.get(run.get('agent'), run.get('agent')),
                    seq=capture.seq if capture else run.get('seq') or 0, active=status in ACTIVE,
                    can_stop=status in ACTIVE and self.owner(), read_only=not self.owner(), unreconciled=orphan)
        return shown(view, self.root)

    def runs(self, repo=None, state=None, path=None, block=None, cursor=0, limit=PAGE):
        rows = []
        for run in self.store.runs():
            view = self.view(run)
            if repo and view['source']['repo'].casefold() != repo.casefold():
                continue
            if path and view['source']['path'] != path or block and view['source']['block_id'] != block:
                continue
            if state == 'active' and not view['active'] or state and state != 'active' and view['outcome'] != state:
                continue
            rows.append(view)
        limit = max(1, min(PAGE, limit))
        return {'runs': rows[cursor:cursor + limit], 'total': len(rows), 'next': cursor + limit if cursor + limit < len(rows) else None,
                'owner': self.owner(), 'read_only': self.supervisor.held(), 'configured': self.registry.configured()}

    def detail(self, run_id):
        return self.view(self.store.load(run_id))

    def events(self, run_id, after=0, limit=500):
        run = self.store.load(run_id)
        view = self.view(run)
        limit = max(1, min(1000, limit))
        if run_id in self.captures:
            newer, contiguous = self.live.after(run_id, after)
            if contiguous:
                rows = [e for e in newer if not e.get('internal')]
                return {'run_id': run_id, 'events': rows[:limit], 'more': len(rows) > limit, 'source': 'live',
                        'next': (rows[:limit][-1]['seq'] if rows else after), 'done': False, 'run': view}
        rows, more = archived_events(self.root, run['log'], after, limit) if run.get('log') else ([], False)
        last = rows[-1]['seq'] if rows else after
        return {'run_id': run_id, 'events': shown(rows, self.root), 'more': more, 'source': 'archive', 'next': last,
                'done': not view['active'] and not more, 'run': view}

    def artifact(self, run_id, name, limit=256 * 1024):
        run = self.store.load(run_id)
        if not run or not run.get('log'):
            raise ValueError('No coding job with that ID')
        if name not in ARTIFACTS:
            raise ValueError('Unknown job artifact')
        return self.log_artifact(run['log'], name, limit)

    def log_artifact(self, relative, name, limit=256 * 1024):
        limit = max(1024, min(MAX_ARTIFACT, int(limit)))
        text, total, truncated = llm_logs.read(self.root, relative, name, limit)
        return {'path': relative, 'name': name, 'available': text is not None, 'text': shown(text, self.root) if text is not None else None,
                'bytes': total, 'truncated': truncated, 'limit': limit}

    def actions(self, path):
        """The article's prompt blocks as the server sees them: registration, agents and run history. Read-only."""
        text, sha = self.articles(path)
        parsed = prompt_blocks.parse(prompt_blocks.body_of(text))
        history = [self.view(run) for run in self.store.runs() if (run.get('source') or {}).get('path') == path]
        blocks = []
        for block in parsed['blocks']:
            try:
                entry, problem = self.registry.entry(block['repo']), None
            except RegistryError as exc:
                entry, problem = None, str(exc)
            agents = [{'name': name, 'label': coding_agents.LABELS[name], 'mode': entry['agent_modes'][name],
                       'available': bool(coding_agents.executable(name, entry, self.environ))} for name in entry['agents']] if entry else []
            blocks.append({'id': block['id'], 'title': block['title'], 'repo': block['repo'], 'issue': block['issue'], 'line': block['line'],
                           'prompt_sha256': block['prompt_sha256'], 'registered': bool(entry), 'problem': problem,
                           'base': entry['base'] if entry else None, 'agents': agents,
                           'issue_url': f'https://github.com/{block["repo"]}/issues/{block["issue"]}' if block['issue'] else None,
                           'runs': [r for r in history if r['source']['block_id'] == block['id']][:20]})
        held = self.supervisor.held()
        return {'path': path, 'sha256': sha, 'blocks': blocks, 'rejected': parsed['rejected'], 'configured': self.registry.configured(),
                'enabled': self.registry.configured() and not held, 'read_only': held}

    def dispatch(self, request):
        action = request.get('action')
        if action == 'submit':
            return self.submit(request)
        if action == 'stop' and set(request) == {'action', 'id'}:
            return self.stop(request['id'])
        raise ValueError('Expected {"action": "submit", …} or {"action": "stop", "id": …}')

    def repositories(self, check=False):
        return self.registry.view(check) | {'agents': [{'name': n, 'label': coding_agents.LABELS[n]} for n in coding_agents.LABELS]}

    def configure(self, request, identity):
        if (identity or {}).get('via') != 'local':
            raise PermissionError('Repositories can be registered only from this Mac')
        action = request.get('action')
        if action == 'register' and set(request) == {'action', 'repo', 'entry'}:
            entry = self.registry.register(request['repo'], request['entry'])
            self.own()
            return self.repositories(True) | {'registered': entry['repo']}
        if action == 'remove' and set(request) == {'action', 'repo'}:
            self.registry.remove(request['repo'])
            return self.repositories()
        if action == 'check' and set(request) == {'action'}:
            return self.repositories(True)
        raise ValueError('Expected {"action": "register", "repo", "entry"}, {"action": "remove", "repo"} or {"action": "check"}')


__all__ = ['CodingJobs', 'JobsOwned', 'valid_id']
