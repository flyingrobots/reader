# Library search and reading

Reader searches local library file paths and contents through its CLI and `reader_search` MCP tool. `reader_read` opens source text at the returned location. Originals remain canonical; `.reader/search.sqlite3` is a disposable SQLite FTS5 and embedding index. Neither indexing nor retrieval executes document content.

## Agent skill and MCP

The installed `$reader` skill supports library search, source reading, and document delivery. Ask “Use $reader to find documents about crash recovery.” It prefers the `reader_search` and `reader_read` MCP tools and falls back to its colocated CLI helper. Both routes use the same engine and source-hash checks. The skill explains result limits, PDF coordinates, index freshness, and the distinction between relevance and verification.

The existing installer in [delivery setup](delivery.md#setup-and-dependencies) registers the local stdio server and symlinks `skills/reader`; no separate search server or skill installation is required. An installed symlink picks up skill changes directly. Start a fresh agent session if its skill catalog still has the older delivery-only description; reconnect an existing MCP client if it has cached an older tool list. Installation checks exercise tool calls and the helper, not automatic skill selection by a model.

## Setup and use

Set `READER_ROOT` to the private vault path. From the code checkout:

```sh
uv sync --locked
uv run --locked reader --root "$READER_ROOT" index
uv run --locked reader --root "$READER_ROOT" search "recover work after a crash"
uv run --locked reader --root "$READER_ROOT" search "transactons" --mode fuzzy
uv run --locked reader --root "$READER_ROOT" search "example" --mode keyword --limit 5
uv run --locked reader --root "$READER_ROOT" search "durable storage" --mode semantic --path-prefix library/reactions/
uv run --locked reader --root "$READER_ROOT" read library/index.md --start-line 1 --limit 40
```

The existing installed helper accepts the same commands from any project:

```sh
python3 "$HOME/.codex/skills/reader/scripts/reader.py" search "recover work after a crash"
```

All responses are JSON. Set `READER_ROOT` instead of passing `--root` if preferred. Restart an existing MCP connection after updating Reader to discover the new tools. No global reinstallation is needed for an existing registration pointing at this checkout.

The first `index` downloads the English `BAAI/bge-small-en-v1.5` quantized ONNX embedding model through FastEmbed into `.reader/models/`. The model license is MIT. Subsequent searches load local files only. Source text and queries are processed locally; they are not sent to an embedding service. Model setup requires access to Hugging Face. Implementation follows the [FastEmbed query/passage embedding API](https://github.com/qdrant/fastembed/blob/main/fastembed/text/text_embedding.py) and [local model loading guidance](https://qdrant.tech/documentation/edge/edge-fastembed-embeddings/).

For keyword and fuzzy search without downloading a model, run `index --no-semantic`. A later ordinary `index` adds missing embeddings. Hybrid search reports incomplete semantic coverage; explicit semantic search fails when no embeddings exist. A missing model with existing indexed vectors is an explicit setup error; select keyword/fuzzy mode to continue without it.

## Matching and source coordinates

- `keyword`: SQLite FTS5 token matching with BM25 ranking, with more weight on paths. Multiple query tokens are ORed; query text is escaped rather than treated as an FTS expression. This is not a regex or literal-substring mode.
- `fuzzy`: case-insensitive RapidFuzz partial string similarity over paths and content passages, with a 0.70 cutoff. Useful for misspellings; very short queries can be noisy.
- `semantic`: cosine similarity of locally generated query and passage embeddings. Results can share meaning without sharing words. Similarity is not a probability or factual confidence. The English model may perform poorly on other languages, specialist notation, and code.
- `hybrid` (default): reciprocal-rank fusion of the three channels, using each document's best rank in each channel. Returns one excerpt per file so repeated passages in a long work do not consume every result slot. Distinct files and editions remain distinct results.

All modes reduce the final rank score of administrative `receipt.json` and `SHA256SUMS` files to one fifth unless that filename appears explicitly in the query. Their raw similarity scores are unchanged and the files remain searchable; ordinary searches favor reading material over delivery/checksum records. This is a filename-based ranking rule, not a classification claim.

Results include vault-relative and absolute file paths, SHA-256, source-stated frontmatter when present, matching channels, rank score, excerpt, and source coordinates. Metadata is not inferred from filenames or surrounding catalogs. Results are files, including catalog notes and supporting archival sources; they are not deduplicated intellectual works. `--path-prefix library/<collection>/` narrows retrieval; `--limit` accepts 1–50.

Text uses one-based line numbers. PDF results use one-based physical page numbers and line numbers within extracted page text. Excerpts are overlapping windows of at most 1,200 characters, and can begin or end inside a line; model tokenization can further truncate unusually dense text. An excerpt may omit a qualification outside its window. Read surrounding text and linked catalogs before interpreting a result. Relevance does not establish correctness, currency, implementation status, or interoperability.

`reader_read(path, start_line=1, limit=100, page=None, expected_sha256=None)` reads the current source. Pass the search-result hash to reject changed bytes. Limits are 500 lines and 64,000 characters per response; `next_line` supports normal line pagination. A single enormous line can be truncated; open the original to read it in full. PDF reading defaults to physical page 1. `reader_search(query, mode="hybrid", limit=10, path_prefix="library/")` has the same search contract as the CLI.

## Coverage, freshness, and preservation

Indexing walks `library/`, including supported text inside delivery bundles and research snapshots. It does not search inbox, system documentation, hidden files/directories, or symlinks. Supported text extensions are Markdown, TXT, RST, TeX, HTML, CSV, JSON, YAML, TOML, Python, Rust, JavaScript, TypeScript, CSS, shell, BibTeX, Edict, CFF, CLS, logs, Coq/V files, MJS, lockfiles, SVG source, and extensionless text (including licenses and checksum lists). UTF-8 is required. PDFs use pypdf text extraction with FontTools for embedded font decoding, without OCR. Raster images and other unsupported formats are path-only; SVG is searchable as XML source, not image understanding. Oversized, unreadable, malformed, or extraction-empty sources appear in the index report's `issues`; inaccessible or unsafe sources are omitted from returned results.

PDF extraction may lose layout, mathematics, and reading order. Original PDF pages remain the reading authority. HTML/code are indexed as source, without rendering or execution. Frontmatter uses the shared versioned codec and retains JSON-compatible custom fields. Results expose metadata status, profile, and diagnostics. Legacy source versions remain absent rather than invented; sidecar revisions and receipt provenance are not inherited. See [metadata contracts and upgrades](metadata.md). Duplicates, corrections, and version relationships remain discoverable through original links and catalogs; there is no inferred relationship graph.

Refresh explicitly after filing, edits, additions, or moves with `reader index`. Unchanged content reuses its vectors; changed files are replaced and removed paths are deleted in one transaction. SQLite WAL lets readers continue using the preceding completed index during a refresh. A failed refresh preserves that completed index. Completed embedding batches are independently checkpointed in `.reader/embedding-cache.sqlite3`, keyed by model fingerprint and passage input, so retries and index rebuilds can reuse them. Model fingerprints include FastEmbed version and cached model/tokenizer bytes; a changed model requires vector refresh before semantic queries. Each response supplies its index timestamp. Search checks returned source bytes, omits changed/deleted excerpts, and warns to refresh. It cannot discover new material until indexed. References are current paths plus hashes, not persistent identities that follow moves.

After upgrading FastEmbed, run `reader index` with semantic indexing enabled before using semantic or hybrid search. The embedding fingerprint includes the FastEmbed version, so a metadata-only refresh cannot make vectors from the previous version current. Reader requires FastEmbed 0.8.1 or newer in the 0.8 line and Pillow 12.3 or newer in the 12.x line.

## Resource limits and recovery

CLI indexing uses a serialized, guarded local worker with two inference threads, a 30-minute wall-clock timeout, a 3,600-second aggregate CPU-time limit, a 4 GiB aggregate `.reader/` data budget, a 4 GiB process-group resident-memory threshold, a 16 MiB combined worker log/result threshold, and a 50 GiB minimum host free-space threshold. The environment's build footprint is checked against 20 GiB before launch. No Docker image, volume, or compiler target is created. Model downloads, temporary files, library cache, and worker logs stay under `.reader/`; this includes existing session scratch storage in the data accounting.

The guard checks once per second and terminates the worker process group on limit or monitoring failure; it is not a filesystem quota, and transient overshoot is possible. An OS per-file limit bounds worker outputs to 512 MiB. SQLite's maximum page count bounds each of the search and embedding-cache databases to 512 MiB at the standard 4 KiB page size. Indexing also limits sources to 32 MiB, extracted PDF text to 32 MiB, PDFs to 5,000 pages, and the index to 100,000 chunks. These are local workload limits, not isolation against hostile parsers or concurrent filesystem mutation.

`.reader/search-runtime/launch.json` records the launch contract, process group, measurements, and completion status; `stderr.log` and `result.json` are replaced per run. The worker holds `.reader/search.lock`; guarded CLI invocations serialize on `.reader/search-run.lock`. Search does not download a model or refresh the index in the background. Direct Python API callers are responsible for their process resource envelope; the CLI provides the guarded entry point.

On a missing or stale index, run `reader index`. On corruption or incompatible schema/model, stop active Reader search/index processes, remove only `.reader/search.sqlite3` and its `-wal`, `-shm`, or legacy `-journal` companions if present, then rebuild. Keep `.reader/models/` and `.reader/embedding-cache.sqlite3` to reuse the download and completed embeddings. If the embedding cache itself is damaged or full, stop index workers and remove only that disposable cache; the next index rebuild regenerates needed vectors within the same resource budget. Never remove inbox/library files or ingestion staging to repair search. Inspect worker logs after failed extraction/model setup or a resource refusal; resolve the reported condition before retrying. Runtime and model caches may be removed while no index/search is running; they contain no canonical source documents.

## Verification

Run `uv run --locked pytest -q` for path/content/fuzzy retrieval, deterministic vector ranking, reading, stale-source checks, edit/move/delete refresh, rollback, path confinement, and CLI/MCP boundaries. Deterministic test embeddings verify integration, not model relevance. Actual model retrieval, three contrasting paraphrase fixtures, and installed-client checks are recorded separately in activity. `scripts/verify_search_installation.py` exercises the configured MCP launch command and installed helper against the existing real index without changing library sources.

Metadata upgrades preserve search layout version 1 for existing read-only clients. Stop old index writers before adding metadata columns; their positional inserts are incompatible. Use `reader index --no-semantic` to refresh metadata without model calls or re-embedding unchanged sources. Updated readers require the separate metadata marker.
