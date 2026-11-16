# One page per swipe on touch screens

Change kind: bug fix.

In the Pages layout on a phone, a flick scrolled the paged viewport natively,
so fling momentum carried it across two or more pages before the idle snap
settled on the nearest one. Turning exactly one page was hard. Touch input on
the paged viewport is now handled by Reader: `touch-action: pan-y pinch-zoom`
stops native horizontal panning, the page follows the finger, and release
turns one page when the drag passes a fifth of a page or is a quick flick,
otherwise it springs back. Wheel, keyboard and the desktop 3D page turn are
unchanged.

Validation on the local candidate:

- `tests/web_mobile_page_swipe.cjs` drives real touch gestures through Chrome
  DevTools `Input.synthesizeScrollGesture` with fling enabled at a 390 x 844
  mobile viewport. Before the change a single flick moved two pages; after it,
  flicks turned one page in each direction and a short slow drag sprang back.
- 44 of the 45 browser suites that use the paged layout passed with the change.
  The other, `web_browser`, passed after one test fix:
  `web_browser`'s narrow-screen touch check set only the desktop `layout`
  preference, which the earlier mobile Scroll default now ignores on phones,
  so it failed on main. It now also sets `mobileLayout`.

The tests used a synthetic vault and Chromium mobile emulation. Physical phone
behavior was not tested.
