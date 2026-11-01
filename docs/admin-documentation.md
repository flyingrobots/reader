# Admin documentation panes

Each registered Admin section has a canonical Markdown reference bundled into the same frontend release as its dashboard. The shared workspace lives in `web/src/admin/documentation.tsx`; `documentation-topics.ts` maps section IDs to source documents. There is no arbitrary-file documentation endpoint or dependency on a private vault’s docs folder.

## Layout and navigation

At desktop widths, dashboard and reference occupy equal columns with independent native scrolling. Hide documentation expands the dashboard; Show documentation restores the split. On narrow screens the panes stack. The Contents selector, heading links and contextual info buttons focus the relevant heading without changing the Admin route. On phones, a documentation action also brings the reference into view. Info buttons reopen a hidden reference.

The shared visibility preference is stored in `localStorage` at `reader.admin.docs.visible.v1`. The older Indexes preference is used only when the shared preference is absent. Selected headings and reference scroll positions are saved per section in `sessionStorage` at `reader.admin.docs.position.<section>`. Hiding preserves the mounted reference. Navigation saves the old section’s position and restores the destination’s. These browser settings do not modify vault documents.

## Topic references

- [Overview](topics/overview.md)
- [Coding Jobs](topics/jobs.md), including run details
- [LLM logs](topics/logs.md), including artifact details
- [Repositories](topics/repositories.md)
- [Voices](topics/voices.md)
- [Models](topics/models.md)
- [Inbox](topics/inbox.md)
- [Indexes](topics/indexes.md)
- [Artwork](topics/artwork.md)
- [Library](topics/library.md)
- [Service & tools](topics/service.md)
- [Settings](topics/settings.md)

## Rendering and component contract

Shadcn Card, Button, Field and NativeSelect frame the reference. Markdown uses Reader’s existing sanitized renderer. Tables receive a scrolling wrapper; heading IDs have an `admin-doc-` prefix and are focusable. Internal heading links stay in the pane. Other repository documentation links open separately. Source files are imported as text and their hashes are recorded in the frontend build metadata.

`AdminDocHelp` resolves explicit section anchors or a title slug, with optional topic-specific aliases. It renders a button only when that heading exists in the current reference. Shared StatusCard titles and Overview summaries use this mechanism. The general reference button always opens Overview. Data inspection, validation messages, warnings and action confirmations remain with their controls; static operating explanations belong in the reference.

When adding a section, register its Markdown source alongside its Admin route and give it an Overview heading. Keep heading IDs unique and update explicit help targets when renaming headings. Describe supported behavior and implementation limits, not plans as completed features.

## Verification

`tests/web_indexes.cjs` checks all twelve canonical topic headings, contextual targets, shared visibility, per-section position restoration, equal desktop columns and phone bounds, alongside the Indexes interaction checks. `npm --prefix web run check` checks component types; `npm --prefix web run build` rebuilds bundled references and their source hashes. These checks do not validate every backend claim in prose; inspect the owning implementation when documenting behavior changes.
