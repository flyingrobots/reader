---
name: Investigation
about: Use when a system matters but we do not yet know what questions to ask about it.
title: ""
labels: investigation
---

```yaml
.dag: issue-dag/2
.id: flyingrobots/reader#NNN
.kind: task
.type: investigation
.blocked_by: []
.size_hours: 2
area:
language: ASD-STE100
```

# Investigation

```text
Do this task in the flyingrobots/reader repository: <one sentence that states the outcome>.
Read these first: AGENTS.md, docs/testing.md, and <the files and documents this task touches>.
Do not start until each issue in the Prerequisites section is closed.
Stay in the Scope section. Do not change what the Scope section excludes.
Write each failing test before the code that makes it pass.
Stop when each item in the Definition of Done is true.
Report what you did, what you verified, and what you did not verify.
```

## 1. Background Context

## 2. What we do not understand
The area, not a question. If you have one question, file Research instead.
## 2b. Where to look
Surfaces, repositories, dashboards, people.
## 2c. Time box
## 2d. Findings
Empty at filing. One line per finding, each with the issue it became.

## 3. Prerequisites
- [ ] None. (Each item here must also be in `.blocked_by`, as `flyingrobots/reader#N`.)

## 4. Scope
In:
Out:

## 5. Why now
## 6. Risks
## 7. Definition of Done
The map exists and every finding has a typed issue.
## 8. Stakeholders
## 9. Related Issues
