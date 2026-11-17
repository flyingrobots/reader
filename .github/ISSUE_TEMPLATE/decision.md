---
name: Decision
about: Use when the facts are known and the open item is which option, and who says so.
title: ""
labels: question
---

```yaml
.dag: issue-dag/2
.id: flyingrobots/reader#NNN
.kind: task
.type: decision
.blocked_by: []
.size_hours: 2
area:
language: ASD-STE100
```

# Decision

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

## 2. The choice
A question with named options.
## 2b. Options and consequences
One line each.
## 2c. Rests on
Evidence, cited by something immutable, or a person, named.
## 2d. Who decides, and by when
## 2e. What is blocked until then
## 2f. Reversible

## 3. Prerequisites
- [ ] None. (Each item here must also be in `.blocked_by`, as `flyingrobots/reader#N`.)

## 4. Scope
In:
Out:

## 5. Why now
## 6. Risks
## 7. Definition of Done
Recorded where the next reader will find it, which is usually not only this issue.
## 8. Stakeholders
## 9. Related Issues
