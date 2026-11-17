---
name: Bug
about: Use when there is a symptom and no known cause. Diagnosis is required before fix work starts.
title: ""
labels: bug
---

```yaml
.dag: issue-dag/2
.id: flyingrobots/reader#NNN
.kind: task
.type: bug
.blocked_by: []
.size_hours: 2
area:
language: ASD-STE100
```

# Bug

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

## 2. Observed
What happens now.
## 2b. Expected
What should happen instead.
## 2c. Reproduction
Steps, or: not reproduced, observed at <time> from <source>.
## 2d. Blast radius
Who is affected, as a population.
How many, with the query that produced the number, marked observed or estimated.
Since when.
Downstream: what consumed the wrong value.
## 2e. Hypothesis
What I think is happening, and the observation that would kill it.
## 2f. Diagnosis
Empty at filing. Required before any fix work starts.

## 3. Prerequisites
- [ ] None. (Each item here must also be in `.blocked_by`, as `flyingrobots/reader#N`.)

## 4. Scope
In:
Out:

## 5. Why now
## 6. Risks
## 7. Definition of Done
A regression test that fails before the fix and passes after it.
## 8. Stakeholders
## 9. Related Issues
