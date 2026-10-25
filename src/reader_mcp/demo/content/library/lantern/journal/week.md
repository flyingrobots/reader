---
title: "Lantern journal: the week the relay learned to wait"
author: Jonah Reyes
project: Lantern
type: Development journal
topics: [Sync]
added: '@@MON+0@@'
---

# Lantern journal: the week the relay learned to wait

## Monday

Picked up the sync proposal again after the review comments. The retry loop in the first draft had no ceiling on attempts; a phone left in a drawer would wake every fifteen minutes forever. Capped it and wrote the cap into [the design](../design/sync-design.md#retry-and-backoff).

## Tuesday

Measured catch-up on the old laptop that has been offline since September.

| Device | Offline for | Events missing | Catch-up time |
| --- | --- | --- | --- |
| Phone | 2 hours | 14 | 0.3 s |
| Tablet | 9 days | 412 | 1.9 s |
| Old laptop | 41 days | 3,208 | 11.4 s |

Most of the laptop's time went to re-anchoring highlights against two revised essays, not to the network.

## Wednesday

```sh
lantern sync --dry-run --since @@MON-41@@ --device old-laptop
```

The dry run listed 31 orphaned anchors. All 31 were in one document whose author had rewritten the introduction. Every orphan kept its quote; none were moved to a guess. That is the behavior we wanted, and it looks worse than it is: a list of 31 orphans feels like data loss even when it is not.
