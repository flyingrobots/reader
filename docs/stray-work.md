# Stray work report

`scripts/stray_work.py` lists finished work that has not reached `origin/main`, and checkouts that can be removed. It only reports; it never deletes, pushes or merges.

```sh
python3 scripts/stray_work.py              # text report for this repository
python3 scripts/stray_work.py --fetch      # fetch origin first
python3 scripts/stray_work.py --prs        # mark which branches have an open pull request (needs gh)
python3 scripts/stray_work.py --json       # machine-readable report
python3 scripts/stray_work.py --strict     # exit 1 while any local or remote work is unlanded
```

Run it at the end of an agent turn, before deleting branches or worktrees, and before handing work off.

## What counts as landed

A branch, remote branch or worktree HEAD is **landed** when `origin/main` (or `--base`) already holds its content:

- it is an ancestor of the base; or
- merging it into the base would change nothing (`git merge-tree --write-tree` returns the base's tree). This is how squash merges and cherry-picks are recognized.

Everything else is **unlanded**, including a ref that conflicts with the base. A conflicting ref may be an older copy of work the base has since changed, so inspect it rather than assuming it is new.

For each unlanded local branch the report gives the commit count, the last commit's date and subject, whether it was pushed (no upstream, or how many commits the upstream lacks), its worktree and, with `--prs`, its open pull request.

## Worktree states

| State | Meaning |
| --- | --- |
| main checkout | The repository's primary checkout; never removable. |
| Reader service live checkout | The checkout the [Reader service](web.md) serves from; never removable. |
| uncommitted changes | Has modified or untracked files; someone may be working there. |
| unlanded commits | Clean, but its HEAD is not in the base. |
| removable | Clean, landed, and neither of the above. `git worktree remove PATH` is safe. |
| missing | Its directory is gone; `git worktree prune` clears it. |

When the Reader service is installed, the branch it follows is marked *followed by the Reader service* even when landed. Deleting it would stop the preview from updating.

## Limits

Landed is a content test against one base. It does not show whether a branch's work is still wanted, and a ref that conflicts is reported as unlanded even when the base holds a newer version of the same change. The report covers one repository; run it in each repository you use.

`tests/test_stray_work.py` builds a synthetic repository with each case: an ancestor, a squash-landed branch, an unpushed branch, a pushed but unmerged branch, a conflicting older copy, removable, dirty and unlanded worktrees, and the service's checkout and followed branch.
