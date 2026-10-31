# Explain indexing and model use — 2026-10-31

Added a visible How indexing works shadcn Card with expandable operation/model-use details. The explanation distinguishes deterministic code from semantic embedding inference, avoids claiming bit-identical database/vector output, and states the default local model and configured-provider privacy boundary. It explains vector caching and separation from generative Models jobs.

Evidence read: Search.model, model_signature, cache_key, embed_batch and the indexing path; ProviderEmbedder and embedding backend defaults; browse calendar input and maintenance checks. Validation: frontend typecheck/build and focused Indexes browser checks, including visible explanation and expandable model/privacy details. No model inference or live rebuild was started for this text change.

Expansion coverage also exposed a help popover reopening through focus restoration after Escape. Explanatory popovers now keep focus on their trigger instead of automatically moving it into plain-text content; pointer/keyboard open and Escape-close checks pass.
