# Distinct Read next suggestions — 2026-10-31

Two preserved revisions of one essay could appear as separate Read next suggestions when embeddings were absent. Ranked picks now reject repeated paths and normalized title/author combinations. The newest-unread fallback applies the same checks, including embedding diversity, instead of reintroducing rejected picks. Saved holdings remain unchanged.

Validation: two synthetic regressions failed before the repair and passed after it. All five related-ranking tests passed, including different authors with the same title, filling freed slots, metadata-only fallback, and the strengthened assertion that embedding-near twins never reappear through fallback.
