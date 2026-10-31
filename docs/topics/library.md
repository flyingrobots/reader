# Library dashboard and charts

## Overview

Library explores grouped holdings, arrivals, reading state and shared discussion. Counts describe the current grouped work inventory and current-edition participant state. Opening the dashboard does not file arrivals, infer that documents were read or rebuild every index.

## Totals

Each total is a selection control. Activating it filters the works shown below; activating it again or Clear selection returns to the default latest additions. Physical files, grouped works, editions, annotations and read receipts are different units. A source edit can change current-edition reading state without deleting the older receipt.

## Charts

D3 marks and legends are interactive controls. Selecting a slice, bar, topic or other supported mark shows the underlying works, newest first. Keyboard activation and text labels provide alternatives to color. A chart’s visual area or count is not a factual confidence measure.

## Arrivals over time

Weekly and Calendar views show recorded arrival data under the dashboard’s counting rules. A file’s author date is not necessarily its arrival date. Missing arrival metadata is not evidence a work never entered the library. Calendar/week boundaries and localized display dates should be distinguished when comparing records.

## Reading by topic

Read/unread stacks use participant-scoped current-edition state. Topic totals can overlap when works carry several topics; do not add overlapping categories as a unique-library count. A model result, catalog wrapper or search excerpt does not grant full-document reading coverage.

## A map of the stacks

The shelf map drills through topic, project and work. Activate a shelf to zoom; Reset returns to the full hierarchy. The breadcrumb and picker expose the same navigation as the diagram. A work can appear under multiple memberships without representing additional preserved bytes.

## Latest additions

The works list reflects the active chart/total selection. Show more works extends the bounded list rather than loading the entire vault into one screen. Activating a work opens its primary reading surface; Shift-click uses the supported split-reading action. Open the file picker changes browsing context, not catalog membership.

## Unread discussion

Discussion uses each participant’s inspected thread/comment versions. An unread count is not a task assignment or proof of disagreement. Opening or reading a selected passage must not silently mark a whole document read. Source-anchored quotes and comments retain their author and source/version identity.

## Customize this dashboard

Chart preferences determine which panels are shown. Saved settings live on this browser unless a specific feature says otherwise. Turning off a chart does not delete its data or unsubscribe from preservation. The library model is cached across status refreshes so chart selection is not discarded by unrelated polling.

## Freshness and recovery

This dashboard depends on generated inventory and existing reading/discussion records. If newly filed material is absent, inspect Browse inventory freshness separately from Search indexing. A display filter can also explain a missing work. Do not infer data loss from differences between a grouped-work total and raw filesystem counts.

Implementation: `dashboard.mjs`, `web/src/admin/pages/library.tsx`, chart/gallery models, shelves and participant-scoped engagement. Chart values are derived views; source files and receipts remain authoritative.
