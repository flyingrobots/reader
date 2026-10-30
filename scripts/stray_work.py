#!/usr/bin/env python3
"""Report finished work that has not reached the base branch, and checkouts that can go. Reports only.

Run it at the end of an agent turn, or whenever:

    python3 scripts/stray_work.py              # text report
    python3 scripts/stray_work.py --fetch      # fetch origin first
    python3 scripts/stray_work.py --prs --json # include open pull requests (gh), as JSON
    python3 scripts/stray_work.py --strict     # exit 1 while any work is unlanded

Work counts as landed when the base already contains it: the ref is an ancestor of the base, or merging it into the base
would change nothing (a squash or cherry-pick landed the same content). Everything else is unlanded, including a ref
that conflicts with the base; that may be an older copy of work the base has since changed, so inspect it.

A worktree is reported as removable when it is clean, its HEAD is landed, and it is neither the main checkout nor the
Reader service's live checkout. A branch the Reader service follows is reported as in use. Nothing is deleted.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def git(repo, *args, check=True):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True)
    if check and result.returncode:
        raise SystemExit(f'git {" ".join(args)} failed: {result.stderr.strip()}')
    return result


def lines(repo, *args):
    return [line for line in git(repo, *args).stdout.splitlines() if line]


def landed(repo, ref, base, base_tree):
    """True when the base already holds this ref's content: an ancestor, or a merge that changes nothing."""
    if git(repo, 'merge-base', '--is-ancestor', ref, base, check=False).returncode == 0:
        return True
    merged = git(repo, 'merge-tree', '--write-tree', base, ref, check=False)
    return merged.returncode == 0 and merged.stdout.split('\n', 1)[0].strip() == base_tree


def describe(repo, ref, base):
    count = int(git(repo, 'rev-list', '--count', f'{base}..{ref}').stdout)
    date, _, subject = git(repo, 'log', '-1', '--format=%cs%x00%s', ref).stdout.strip().partition('\0')
    return {'ahead': count, 'last': date, 'subject': subject}


def worktrees(repo):
    rows, row = [], {}
    for line in git(repo, 'worktree', 'list', '--porcelain').stdout.splitlines() + ['']:
        if not line:
            if row:
                rows.append(row)
            row = {}
        elif line.startswith('worktree '):
            row['path'] = line[9:]
        elif line.startswith('HEAD '):
            row['head'] = line[5:]
        elif line.startswith('branch '):
            row['branch'] = line[7:].removeprefix('refs/heads/')
        elif line == 'detached':
            row['branch'] = None
        elif line.startswith('prunable'):
            row['prunable'] = True
    return rows


def reader_service():
    """The Reader service's followed ref and live checkout, when it is installed for this user."""
    state = Path.home() / 'Library/Application Support/Reader/service.json'
    try:
        data = json.loads(state.read_text())
    except (OSError, ValueError):
        return {}
    return {'source': data.get('source'), 'live': data.get('live'), 'repo': data.get('repo')}


def open_prs(repo):
    result = subprocess.run(['gh', 'pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,headRefName'],
                            cwd=repo, capture_output=True, text=True)
    if result.returncode:
        return None
    return {pr['headRefName']: pr['number'] for pr in json.loads(result.stdout)}


def survey(repo, base='origin/main', fetch=False, prs=False, service=None):
    repo = Path(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').stdout.strip()).parent
    if fetch:
        remote = base.split('/', 1)[0]
        git(repo, 'fetch', '--quiet', '--prune', remote)
    base_tree = git(repo, 'rev-parse', base + '^{tree}').stdout.strip()
    service = reader_service() if service is None else service
    pulls = open_prs(repo) if prs else None
    trees = worktrees(repo)
    checked_out = {row.get('branch'): row['path'] for row in trees if row.get('branch')}
    report = {'repo': str(repo), 'base': base, 'unlanded': [], 'landed_branches': [], 'worktrees': [], 'remote_unlanded': [],
              'service': service or None, 'prs_checked': pulls is not None}

    for branch in lines(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'):
        upstream = git(repo, 'rev-parse', '--abbrev-ref', f'{branch}@{{upstream}}', check=False).stdout.strip() or None
        entry = {'branch': branch, 'worktree': checked_out.get(branch), 'upstream': upstream}
        if service and service.get('source') in (branch, f'refs/heads/{branch}'):
            entry['in_use'] = 'followed by the Reader service'
        if landed(repo, branch, base, base_tree):
            report['landed_branches'].append(entry)
            continue
        entry |= describe(repo, branch, base)
        if upstream:
            entry['unpushed'] = int(git(repo, 'rev-list', '--count', f'{upstream}..{branch}').stdout)
        if pulls is not None:
            entry['pr'] = pulls.get(branch)
        report['unlanded'].append(entry)

    for ref in lines(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes'):
        if ref.endswith('/HEAD') or '/' not in ref or ref == base or landed(repo, ref, base, base_tree):
            continue
        entry = {'ref': ref} | describe(repo, ref, base)
        if pulls is not None:
            entry['pr'] = pulls.get(ref.split('/', 1)[1])
        report['remote_unlanded'].append(entry)

    main_checkout = str(repo)
    for row in trees:
        path = row['path']
        entry = {'path': path, 'branch': row.get('branch')}
        if row.get('prunable') or not Path(path).is_dir():
            report['worktrees'].append(entry | {'state': 'missing', 'note': 'run git worktree prune'})
            continue
        dirty = len([line for line in git(path, 'status', '--porcelain').stdout.splitlines() if line])
        head_landed = landed(repo, row['head'], base, base_tree)
        entry |= {'dirty': dirty, 'landed': head_landed}
        if path == main_checkout:
            entry['state'] = 'main checkout'
        elif service and service.get('live') and Path(path).resolve() == Path(service['live']).resolve():
            entry['state'] = 'Reader service live checkout'
        elif dirty:
            entry['state'] = 'uncommitted changes'
        elif not head_landed:
            entry['state'] = 'unlanded commits'
        else:
            entry['state'] = 'removable'
        report['worktrees'].append(entry)
    return report


def text(report):
    out = [f'Base {report["base"]} in {report["repo"]}']
    service = report.get('service')
    if service and service.get('source'):
        out.append(f'Reader service follows {service["source"]} (live checkout {service.get("live")})')
    out.append('')
    out.append(f'Unlanded local branches: {len(report["unlanded"])}')
    for row in report['unlanded']:
        where = f' · worktree {row["worktree"]}' if row.get('worktree') else ''
        push = (' · not pushed' if not row.get('upstream') else f' · {row["unpushed"]} unpushed' if row.get('unpushed') else ' · pushed')
        pr = '' if not report['prs_checked'] else f' · PR #{row["pr"]}' if row.get('pr') else ' · no PR'
        use = f' · {row["in_use"]}' if row.get('in_use') else ''
        out.append(f'  {row["branch"]}: {row["ahead"]} commits, last {row["last"]} "{row["subject"]}"{push}{pr}{where}{use}')
    out.append(f'Unlanded remote branches: {len(report["remote_unlanded"])}')
    for row in report['remote_unlanded']:
        pr = '' if not report['prs_checked'] else f' · PR #{row["pr"]}' if row.get('pr') else ' · no PR'
        out.append(f'  {row["ref"]}: {row["ahead"]} commits, last {row["last"]} "{row["subject"]}"{pr}')
    landed_branches = report['landed_branches']
    out.append(f'Landed local branches (safe to delete): {len(landed_branches)}')
    for row in landed_branches:
        notes = [f'worktree {row["worktree"]}' if row.get('worktree') else '', row.get('in_use', '')]
        notes = ' · '.join(note for note in notes if note)
        out.append(f'  {row["branch"]}' + (f' · {notes}' if notes else ''))
    out.append(f'Worktrees: {len(report["worktrees"])}')
    for row in report['worktrees']:
        detail = f' ({row["dirty"]} changed files)' if row.get('dirty') else ''
        out.append(f'  {row["state"]}: {row["path"]} [{row["branch"] or "detached"}]{detail}')
    return '\n'.join(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    parser.add_argument('--repo', default='.', help='Any checkout of the repository (default: here)')
    parser.add_argument('--base', default='origin/main', help='Where finished work should land (default origin/main)')
    parser.add_argument('--fetch', action='store_true', help="Fetch the base's remote first")
    parser.add_argument('--prs', action='store_true', help='Look up open pull requests with gh')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--strict', action='store_true', help='Exit 1 while any local or remote work is unlanded')
    args = parser.parse_args(argv)
    report = survey(args.repo, args.base, fetch=args.fetch, prs=args.prs)
    print(json.dumps(report, indent=2) if args.json else text(report))
    return 1 if args.strict and (report['unlanded'] or report['remote_unlanded']) else 0


if __name__ == '__main__':
    sys.exit(main())
