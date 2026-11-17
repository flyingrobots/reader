---
name: Spike
about: Use to test an approach with throwaway code inside a time box.
title: ""
labels: spike
---

```yaml
.dag: issue-dag/2
.id: flyingrobots/reader#NNN
.kind: task
.type: spike
.blocked_by: []
.size_hours: 2
area:
language: ASD-STE100
```

# Spike

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

## 2. The approach being tested
## 2b. What would make us adopt it
## 2c. What would make us reject it
## 2d. What gets deleted afterwards
The code this produces is throwaway. Say so here.
## 2e. Time box
## 2f. Findings

## 3. Prerequisites
- [ ] None. (Each item here must also be in `.blocked_by`, as `flyingrobots/reader#N`.)

## 4. Scope
In:
Out:

## 5. Why now
## 6. Risks
## 7. Definition of Done
Adopt or reject, recorded, and the throwaway deleted.
## 8. Stakeholders
## 9. Related Issues
