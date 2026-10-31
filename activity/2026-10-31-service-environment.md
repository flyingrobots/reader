# Preserve installed companion configuration — 2026-10-31

The prior service reconfiguration replaced its saved environment with only variables present in the invoking shell. That dropped the existing READER_COLORFUL path, causing the healthy Colorful Language installation to appear missing. Restored the saved environment through the service installer; the live `/api/prose` status again reports available version 0.4.0 from READER_COLORFUL. No binary rebuild or new installation was needed.

The installer now starts from the previous saved environment, overlays variables supplied by the current shell, and still applies explicit --env overrides last. A synthetic regression test verifies absent shell variables survive reinstall in both saved state and the LaunchAgent, and an explicit override changes the selected value while preserving other tool settings. The focused service test passed. Private configuration values and paths are not retained in this code record.
