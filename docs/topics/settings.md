# Reader settings

## Overview

Settings changes the reading experience on this device. Edit the grouped form and use Save preferences. Opening the page or editing a draft field is not the same as saving. Runtime/provider/repository configuration on other Admin pages has its own persistence contract.

## You and the page

The participant/profile name identifies whose read and discussion receipts this device requests. Renaming an identity does not transfer another person’s inspected versions or authorize impersonation. Theme selection changes the palette used by the UI; it does not alter source content or model output.

## Reading

Layout, page-turn behavior, reading speed, recent count, prose-color mode and article-adjacent switches affect presentation. Reading speed estimates time; it does not prove comprehension. A two-page layout is a rendering choice, not a document edition. Turning off an outline, margin panel or Read next does not delete source annotations or rebuild an index.

Prose colors depend on the separate Colorful Language integration. A saved color preference cannot install a missing executable. Check Service & tools for discovery/version problems. Source text remains preserved when grammar classifications change display styling.

## The issue and article art

Issue exclusions control homepage editorial selection. Excluding a section does not remove its works from the library. Art preferences choose supported producers and whether article/homepage art is displayed or requested under the feature’s explicit behavior. Producer availability, remote access and resource limits remain separate prerequisites.

## Inbox

The inbox permission/sandbox preference controls a user-started supported librarian run. It does not create a background filing service, appoint an ordinary courier as librarian or authorize actions embedded in incoming documents. Changing a permission mode does not retroactively change already-running jobs.

## Theme Editor

Theme Editor opens the palette/font/contrast tool. Previewing a theme and saving/using it are distinct actions. Custom theme definitions and installed fonts follow their dedicated storage/discovery flow. A contrast check measures the inspected rendered combination; it is not a proof for arbitrary external diagrams or future content.

## Save preferences

Save writes validated reading preferences to this browser’s storage through the existing settings action and keeps the Settings page open. A failed save remains visible. Clearing browser storage can remove device preferences without deleting the vault. The documentation visibility preference is shared across Admin; reference positions are kept per section for this browsing session.

## What settings do not do

This page does not schedule index rebuilds, register coding repositories, sign in to agent CLIs or change an AI-TTS engine’s global agent assignments. Use the owning Admin page for those controls. A reading preference that enables a feature still needs its companion/provider/runtime to be available.

## Troubleshooting

If a saved feature has no visible effect, distinguish feature visibility, saved value, missing dependency and unsupported document format. If a theme looks wrong, inspect its actual rendered tokens/contrast and the Theme Editor rather than rewriting source documents. If another browser behaves differently, compare device-local preferences and participant identity.

Implementation: SettingsForm in `web/src/reader-controls.tsx`, the Admin Settings panel, theme modules and the application preference/save pipeline.
