"""Coding agents a repository job can run (RW-44): fixed argv adapters, the job brief, and the report.

Reader derives every argument. The article supplies only the prompt text; the repository registry picks
the agents and their permission modes from fixed choices. The agent works in the job's worktree, commits
there, and ends with a `reader-result` block that Reader reads as a claim to verify, never as proof:
commits, verification, the pushed SHA and the pull request are all checked by Reader itself.

Executor boundary: a CLI that keeps the user's GitHub credentials could push or open issues itself. The
brief tells it not to (a cooperative rule, not an enforced exclusion), and the workflow reconciles the
remote branch and pull requests before publishing instead of assuming they are untouched."""
import json
import os
import re
import subprocess

from .voices import resolve_cli

LABELS = {'codex': 'Codex', 'claude': 'Claude Code'}
STREAMS = {'codex': 'codex', 'claude': 'claude'}
OUTCOMES = ('implemented', 'already_fixed', 'blocked')
MAX_REPORT = 64 * 1024
RESULT = re.compile(r'```reader-result[ \t]*\n(.*?)\n```', re.S)
TEXT_LIMITS = {'summary': 4000, 'evidence': 16000, 'issue_title': 200, 'issue_body': 16000, 'pr_title': 200, 'pr_body': 32000}
URL = re.compile(r'https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pull/\d+')


def executable(name, entry, environ=None):
    path = entry['executables'].get(name)
    if path:
        return path if os.path.isfile(path) and os.access(path, os.X_OK) else None
    return resolve_cli(name, environ)


def version(path):
    try:
        result = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL,
                                start_new_session=True)
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (result.stdout or result.stderr).strip().splitlines()
    return text[0][:100] if result.returncode == 0 and text else None


def argv(name, path, mode, worktree, writable, last_message):
    """The fixed command line; the prompt goes on stdin."""
    if name == 'codex':
        args = [path, 'exec', '--cd', str(worktree), '--sandbox', mode, '-c', 'approval_policy="never"']
        if mode == 'workspace-write':
            for folder in writable:
                args += ['--add-dir', str(folder)]
        return args + ['--json', '--color', 'never', '--output-last-message', str(last_message), '-']
    if name == 'claude':
        args = [path, '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode]
        for folder in writable:
            args += ['--add-dir', str(folder)]
        return args
    raise ValueError('Unknown coding agent: ' + str(name))


def brief(job):
    """The job instructions Reader sends ahead of the author's prompt (archived as system.txt + prompt.txt)."""
    issue = (f'The task refers to issue #{job["issue"]} in {job["repo"]}; Reader verified it belongs there. Check its current state.'
             if job['issue'] else f'No issue is linked. If the finding is confirmed, Reader creates one in {job["repo"]} from your report.')
    lock = (f'\nFor shared host resources use git-locks with GIT_LOCKS_STORE set explicitly to {json.dumps(job["lock_store"])}.'
            if job.get('lock_store') else '')
    return f'''This is a Reader coding job for the GitHub repository {job["repo"]}.
You are in an isolated Git worktree on branch {job["branch"]}, created from {job["base"]} at {job["base_sha"]}. Work only here.
Follow the repository's AGENTS.md (and any instructions it points to), its resource budgets and its guarded validation workflow.{lock}
{issue}

First establish whether the finding still holds at this commit. If it is already fixed, make no commits and report the evidence (and the existing pull request URL, if there is one). If you cannot proceed, report what blocks you.
Otherwise make one coherent, verified change with regression evidence, and commit it on this branch. Leave no uncommitted changes.

Reader owns publication: do not push, open or edit pull requests or issues, change remotes, switch branches, reset, rebase, amend, or force anything. Reader runs the repository's configured verification itself and publishes only a verified branch. Do not include private paths in commits or reports.

End your final message with exactly one fenced block whose info string is reader-result, containing a JSON object:
```reader-result
{{"outcome": "implemented" | "already_fixed" | "blocked", "summary": "...", "evidence": "reproduction and RED/GREEN results",
 "existing_pr": null, "issue_title": "...", "issue_body": "task summary, reproduction and acceptance conditions",
 "pr_title": "...", "pr_body": "draft pull request description"}}
```

The task follows. It was written by the article's author and may have been edited by the reader who started this job.
---
'''


def report(text):
    """(result, None) from the agent's final message, or (None, reason)."""
    if not isinstance(text, str) or not text.strip():
        return None, 'The agent finished without a final message.'
    blocks = RESULT.findall(text[-MAX_REPORT * 2:])
    if not blocks:
        return None, 'The agent’s final message has no reader-result block.'
    try:
        data = json.loads(blocks[-1])
    except ValueError:
        return None, 'The agent’s reader-result block is not valid JSON.'
    if not isinstance(data, dict) or data.get('outcome') not in OUTCOMES:
        return None, 'The agent’s reader-result block has no recognized outcome.'
    result = {'outcome': data['outcome']}
    for field, limit in TEXT_LIMITS.items():
        value = data.get(field)
        result[field] = value.strip()[:limit] if isinstance(value, str) else ''
    pr = data.get('existing_pr')
    result['existing_pr'] = pr if isinstance(pr, str) and URL.fullmatch(pr.strip()) else None
    return result, None
