# Admin bookmark restoration

2026-10-27. Reader's original Admin return-scroll check could reach the saved
passage correctly while posting a different block fraction during the return.
Native scrolling and the smooth renderer can describe different positions while
a glide is still running. The scroll debounce previously saved without checking
that distinction.

## Change and scope

Scroll-debounced and end-of-document dwell saves now wait until the rendered
scroll position is within one CSS pixel of the native offset, reusing the
existing 450 ms debounce. Navigation, page-hide and visibility saves still call
the immediate save path, capturing the visible place. No bookmark schema,
backend, dependency, pagination or theme changes are introduced.

## Executed evidence

- The existing return-scroll assertion failed on unchanged main `da03328` in
  the preceding UI work; its report and failed receipt remain preserved.
- A diagnostic run on base `79e87b7` logged visible/native positions at bookmark
  requests. That Admin run passed, so it is not a deterministic RED. Its
  screenshot export initially failed because the helper looked in the wrong
  directory; the test result and export failure are kept separately.
- The new controlled delayed-renderer check fails on unchanged runtime
  `79e87b7`: an automatic bookmark is posted while native and visible positions
  differ. The expected assertion fails; the other seven Admin checks pass
  (`admin-bookmark-red`, 27.21 seconds).
- The first guard passes all eight Admin checks, including the original
  source-offset/block-fraction assertions (`admin-bookmark-green`, 54.57 seconds).
- With the shared guard also applied to the dwell save, the final Admin
  sub-suite again reports all eight checks passed (`admin-bookmark-final`).
  Node syntax checks cover the reading module, request helper and Admin test.

The final reading module SHA-256 is `b378ab63d6fe1a8d7e44852cc64c11b23e760d2d88fcbf48a04132fcb6b0d081`.
The delayed-renderer case freezes GSAP's ticker, introduces a 60 px native
offset for one second, requires no automatic save, then resumes and verifies
the original passage and every subsequent bookmark. It does not loosen the
original restoration tolerance. The test uses synthetic documents and fake
agents; it starts no real model or Inbox job.

Validation reuses the isolated Node 24 worker with a read-only root, no mounts,
3 GiB work and 512 MiB temporary tmpfs limits, 4 CPUs, 6 GiB memory, a
600-second watchdog and an 8 MiB per-run log cap. The first GREEN used
546012 KiB of work tmpfs and 2604 KiB of temporary tmpfs; logs and receipts
remain local. Reviewer approval and current-head CI remain separate merge gates.

## Review follow-up

The final Admin and content-visibility suites passed together
(`admin-bookmark-final`, 120.11 seconds). The larger-document suite verifies
bookmark lines in native and smooth scrolling, find, heading/outline jumps,
source coordinates and two-page layout.

CodeRabbit noted that the no-overwrite assertion could pass without proving
a deferred save ever resumes. A separate case now leaves the new native
position in place, wakes the renderer without another scroll event, requires
a new bookmark request and checks its source block and changed fraction
against the settled viewport. All eight Admin checks pass with that addition
(`admin-bookmark-resume-verified`, 54.88 seconds). The runtime module is unchanged
from the combined Admin/content-visibility run; this follow-up changes only
the test and this record.
