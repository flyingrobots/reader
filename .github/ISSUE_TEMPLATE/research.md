---
name: Research
about: Use when there is one answerable question and a decision waits on the answer.
title: ""
labels: research
---

```yaml
.dag: issue-dag/2
.id: flyingrobots/reader#NNN
.kind: task
.type: research
.blocked_by: []
.size_hours: 2
area:
language: ASD-STE100
```

# Research

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

## 2. The Question
One sentence, answerable.
## 2b. What decision waits on it
If nothing does, do not file this.
## 2c. What would settle it
The observation, the method, and where the data lives.
## 2d. Aperture
What this cannot see, so a negative result is not read as a positive.
## 2e. Possible answers and what each implies
Written before looking.
## 2f. Evidence
Empty at filing. The value, the command that produced it, the timestamp.

## 3. Prerequisites
- [ ] None. (Each item here must also be in `.blocked_by`, as `flyingrobots/reader#N`.)

## 4. Scope
In:
Out:

## 5. Why now
## 6. Risks
## 7. Definition of Done
An answer under Evidence, or a declared unanswerable-because.
## 8. Stakeholders
## 9. Related Issues
