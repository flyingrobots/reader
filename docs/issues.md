# Filing issues

Every Reader issue is a task plan that a person or an agent can execute without other context. This page is the standard for its body. The templates in [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/) apply it; GitHub offers them when you open a new issue.

## Choose a type

| Type | Use it when | Template |
| --- | --- | --- |
| Feature | The end state is known and only the work remains. | [feature.md](../.github/ISSUE_TEMPLATE/feature.md) |
| Bug | There is a symptom and no known cause. Diagnosis comes before fix work. | [bug.md](../.github/ISSUE_TEMPLATE/bug.md) |
| Decision | The facts are known; the open item is which option, and who decides. | [decision.md](../.github/ISSUE_TEMPLATE/decision.md) |
| Investigation | A system matters, but we do not yet know which questions to ask. | [investigation.md](../.github/ISSUE_TEMPLATE/investigation.md) |
| Research | One answerable question, and a decision waits on the answer. | [research.md](../.github/ISSUE_TEMPLATE/research.md) |
| Spike | Throwaway code tests an approach inside a time box. | [spike.md](../.github/ISSUE_TEMPLATE/spike.md) |

A Bug with a known cause and a known fix is a Feature-shaped change; file it as a Bug anyway when users see a defect, and fill in Diagnosis at filing.

## Body layout

Each body has these parts, in this order:

1. **Frontmatter.** A fenced `yaml` block that [Taskalisk](#dependencies-and-the-frontier) reads. See [Frontmatter](#frontmatter).
2. **Type heading.** `# Feature`, `# Bug`, `# Decision`, `# Investigation`, `# Research` or `# Spike`.
3. **Execution prompt.** A fenced `text` block that tells an agent how to do the task: the one-sentence outcome, what to read first, to wait for the prerequisites, to stay in scope, to write failing tests first, when to stop, and what to report.
4. **Numbered sections.** Section 1 is Background Context. Section 2 and its lettered parts (2b, 2c, …) depend on the type. Sections 3 to 9 are the same for every type: Prerequisites, Scope (In and Out), Why now, Risks, Definition of Done, Stakeholders, Related Issues.

Rules for the sections:

- Write in [ASD-STE100](https://www.asd-ste100.org/) Simplified Technical English: short sentences, one instruction per sentence, active voice, approved meanings of words. Code names, paths and quoted output stay exact.
- Acceptance Criteria are what the result must satisfy. Definition of Done is the signal to stop, usually including recording the result.
- Write "None" or "Not applicable, because X" instead of padding a section.
- Stakeholders names people only where the record supports a name, and says why each cares.
- An issue must pass the one-outcome test: one sentence with one subject and one verb states its outcome, a reviewer can accept or reject the whole change, and no dependent needs only part of it. Split an issue that fails, and group the parts with a container.
- Never put private vault content (library documents, reading notes, local paths under a home folder) in an issue. The repository is public.

## Frontmatter

```yaml
.dag: issue-dag/2
.id: flyingrobots/reader#123
.kind: task
.type: feature
.blocked_by: [flyingrobots/reader#120]
.size_hours: 3
area: search
language: ASD-STE100
```

| Key | Required | Meaning |
| --- | --- | --- |
| `.dag` | yes | Always `issue-dag/2`. |
| `.id` | yes | This issue, as `owner/repo#number`. The template has `#NNN`; replace it with the real number after GitHub assigns one. |
| `.kind` | yes | `task` for executable work, `container` for a group. |
| `.type` | task | `feature`, `bug`, `decision`, `investigation`, `research` or `spike`. Matches the type heading. |
| `.blocked_by` | task | Issues that must close before this one is correct on a green `main`. `[]` when none. Every Prerequisites item that is an issue appears here. |
| `.children` | container | The member issues. A container has no `.blocked_by` and nothing may name it in `.blocked_by`. |
| `.size_hours` | no | Integer estimate. Above 8 means the issue is probably not one outcome. |
| `.status` | no | `active`, `parked` or `blocked`. Open or closed comes from GitHub. |

Keys without a leading dot (`area`, `language`, notes) are free-form. An unknown dotted key makes Taskalisk fail, so a typo cannot silently drop an edge. Always write references in full (`flyingrobots/reader#12`), never as a bare `#12`.

## Dependencies and the frontier

The `.blocked_by` lists form a dependency graph. Labels, milestones and body text never create edges. Taskalisk compiles the graph from the issue bodies, removes redundant edges, and ranks the open frontier: the open tasks with no open blockers.

```sh
python3 <taskalisk-skill>/scripts/taskalisk.py --from-github
```

Run it from a checkout of this repository. It is read-only. When work shows a missing dependency, add it to the dependent issue's `.blocked_by` line and run the command again; a cycle fails the run.
