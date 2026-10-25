# Library search and reading

Reader searches local library file paths and contents through its CLI and `reader_search` MCP tool. `reader_read` opens source text at the returned location. Originals remain canonical; `.reader/search.v2.sqlite3` is a disposable SQLite FTS5 and embedding index (format 2). The format 1 index, `.reader/search.sqlite3`, can remain beside it for older Reader processes (see [format 1 beside format 2](#format-1-beside-format-2)). Neither indexing nor retrieval executes document content.

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

The first `index` downloads the English `BAAI/bge-small-en-v1.5` quantized ONNX embedding model through FastEmbed into `.reader/models/`. The model license is MIT. Subsequent searches load local files only. Source text and queries are processed locally; they are not sent to an embedding service. The web reader's Local model settings can instead select `openai:<embedding model>` (older settings: `lmstudio:<embedding model>`), an embedder on the configured OpenAI-compatible provider (LM Studio, Ollama, llama.cpp and others, loopback unless the user allows a server on another machine, in which case queries and passages are sent there); the backend is the format 2 index's `model` setting and part of its embedding signature, so a switch re-embeds every passage on the next semantic build (stored as float16 like any other vector) and a keyword-only build after a switch is refused. Format 1 vectors are reused only when their signature matches. Model setup requires access to Hugging Face. Implementation follows the [FastEmbed query/passage embedding API](https://github.com/qdrant/fastembed/blob/main/fastembed/text/text_embedding.py) and [local model loading guidance](https://qdrant.tech/documentation/edge/edge-fastembed-embeddings/).

For keyword and fuzzy search without downloading a model, run `index --no-semantic`. A later ordinary `index` adds missing embeddings. Hybrid search reports incomplete semantic coverage; explicit semantic search fails when no embeddings exist. A missing model with existing indexed vectors is an explicit setup error; select keyword/fuzzy mode to continue without it.

## Matching and source coordinates

- `keyword`: SQLite FTS5 token matching with BM25 ranking, with more weight on paths. Multiple query tokens are ORed; query text is escaped rather than treated as an FTS expression. This is not a regex or literal-substring mode.
- `fuzzy`: case-insensitive RapidFuzz partial string similarity over paths and content passages, with a 0.70 cutoff. Useful for misspellings; very short queries can be noisy.
- `semantic`: cosine similarity of locally generated query and passage embeddings. Results can share meaning without sharing words. A passage stored once for several files (see [storage](#storage-format)) is returned for its preferred edition only: a `*.reading.*` reading copy over its original, and either over a copy under an `original/` or `originals/` folder, then the shorter path. The Python API's `editions='all'` returns every file that holds it. Similarity is not a probability or factual confidence. The English model may perform poorly on other languages, specialist notation, and code.
- `hybrid` (default): reciprocal-rank fusion of the three channels, using each document's best rank in each channel. Returns one excerpt per file so repeated passages in a long work do not consume every result slot. Distinct files and editions remain distinct results.

All modes reduce the final rank score of administrative `receipt.json` and `SHA256SUMS` files to one fifth unless that filename appears explicitly in the query. Their raw similarity scores are unchanged and the files remain searchable; ordinary searches favor reading material over delivery/checksum records. This is a filename-based ranking rule, not a classification claim.

Results include vault-relative and absolute file paths, SHA-256, source-stated frontmatter when present, matching channels, rank score, excerpt, and source coordinates. Metadata is not inferred from filenames or surrounding catalogs. Results are files, including catalog notes and supporting archival sources; they are not deduplicated intellectual works. Keyword and fuzzy matching still return every file that contains a matching passage. Each response reports `complete`; when the last index run stopped early, it also carries a warning. `--path-prefix library/<collection>/` narrows retrieval; `--limit` accepts 1–50.

Text uses one-based line numbers. PDF results use one-based physical page numbers and line numbers within extracted page text. Excerpts are overlapping windows of at most 1,200 characters, and can begin or end inside a line; model tokenization can further truncate unusually dense text. An excerpt may omit a qualification outside its window. Read surrounding text and linked catalogs before interpreting a result. Relevance does not establish correctness, currency, implementation status, or interoperability.

`reader_read(path, start_line=1, limit=100, page=None, expected_sha256=None)` reads the current source. Pass the search-result hash to reject changed bytes. Limits are 500 lines and 64,000 characters per response; `next_line` supports normal line pagination. A single enormous line can be truncated; open the original to read it in full. PDF reading defaults to physical page 1. `reader_search(query, mode="hybrid", limit=10, path_prefix="library/")` has the same search contract as the CLI.

## Coverage, freshness, and preservation

Indexing walks `library/`, including delivery bundles and research snapshots. It does not search inbox, system documentation, hidden files/directories, operating-system metadata files (`.DS_Store`, `Thumbs.db`, `ehthumbs.db`, `desktop.ini` and AppleDouble `._*` files), or symlinks.

Only reading material is split into passages for content and semantic search. By default that is Markdown, TXT, PDF, HTML, TeX, RST, Edict and BibTeX. Machine files are indexed by path only. These include JSON/JSONL (delivery receipts and manifests), logs, `.err`/`.load` placeholders, lockfiles, SVG, CSV, extensionless files (Makefile, LICENSE, SHA256SUMS) and source code (Rust, Python, JavaScript, TypeScript, MJS, CSS, shell, Coq/V, TOML, YAML, CFF, CLS). Keyword and fuzzy path search still find them, and the index report counts them as `path_only_machine`. To make a type content-searchable, list it in `indexes/settings.json` → `search.content_types` (see [budgets and settings](#budgets-and-settings)). Any text-decodable type above, or `""` for extensionless files, can be listed. UTF-8 is required. PDFs use pypdf text extraction with FontTools for embedded font decoding, without OCR. Raster images and other unsupported formats are path-only. Oversized, unreadable, malformed, or extraction-empty sources appear in the index report's `issues`; inaccessible or unsafe sources are omitted from returned results.

pypdf's per-glyph repair warnings from damaged PDFs (broken ToUnicode maps: "Skipping broken line", "Got invalid hex string") are counted per file, not printed. The text is still extracted. The index result's `pdf_warnings` gives the message and file counts and the worst files. The worker log gets one summary line, so these warnings cannot fill the log budget or bury the real error.

PDF extraction may lose layout, mathematics, and reading order. Original PDF pages remain the reading authority. HTML/code are indexed as source, without rendering or execution. Frontmatter uses the shared versioned codec and retains JSON-compatible custom fields. Results expose metadata status, profile, and diagnostics. Legacy source versions remain absent rather than invented; sidecar revisions and receipt provenance are not inherited. See [metadata contracts and upgrades](metadata.md). Duplicates, corrections, and version relationships remain discoverable through original links and catalogs; there is no inferred relationship graph.

Refresh explicitly after filing, edits, additions, or moves with `reader index`. Unchanged content reuses its vectors. A run publishes in batches of 64 files. Each file's rows change atomically, so a file never shows half-refreshed rows, and SQLite WAL lets searches continue throughout. The `complete` setting is `0` while a run is in progress or after it stopped early; it becomes `1`, with `indexed_at`, only when a run reaches the end of the library and removes deleted paths. `updated_at` records the last batch. A failed file is rolled back and the files before it stay published. A run that stops (at its deadline, a budget, or an error) therefore keeps its work, and the next run continues: files already current are skipped. Completed embedding batches are also checkpointed in `.reader/embedding-cache.sqlite3`, keyed by model fingerprint and passage input (path and text), so retries and index rebuilds can reuse them. Model fingerprints include FastEmbed version and cached model/tokenizer bytes; a changed model clears stored vectors and the next semantic run refreshes them. Each response supplies its index timestamp. Search checks returned source bytes, omits changed/deleted excerpts, and warns to refresh. It cannot discover new material until indexed. References are current paths plus hashes, not persistent identities that follow moves.

## Storage format

Format 2 stores each distinct passage once:

| Table | Holds |
| --- | --- |
| `docs` | One row per library file: path, SHA-256, size, mtime, status (`text`, or `path_only: …`) and metadata columns |
| `passages` | `hash` (SHA-256 of the passage text, unique), `text`, `vector` (float16) and `vector_path` (the file whose path was embedded with it) |
| `chunks` | `path`, `page`, `start_line`, `end_line`, `passage_id`: where each passage occurs. A path-only file has one chunk with no passage |
| `terms` | FTS5 over passage text, external-content on `passages` (text is stored once) |
| `names` | FTS5 over file paths; path matches weigh four times passage text in keyword ranking |
| `settings` | `version` (`2`), model, embedding signature, `complete`, `indexed_at`, `updated_at` |

Identical text in reading copies and their originals is stored once. A shared passage is embedded once. Its input is `path + "\n" + text` for the first file that contributes it, as in format 1, so cached vectors stay valid. Passages no file references are deleted with their FTS rows. Vectors are computed in float32 and stored as float16 (768 bytes for 384 dimensions). Similarity is computed in float32. Tests require overlap@10 of at least 0.99 against float32 ranking. The embedding cache keeps float32.

### Format 1 beside format 2

Older Reader processes read and write the format 1 index `.reader/search.sqlite3` and refuse any other format. Format 2 therefore lives in its own file, and new code never migrates, writes or deletes format 1 in place. Both share `.reader/embedding-cache.sqlite3`, whose format is unchanged; both index writers hold `.reader/search.lock`.

- **Serving.** Until a format 2 build has completed (its `indexed_at` is set), search is served from format 1, read-only. Responses carry `format: 1` and the warning "Serving the format 1 search index read-only; rebuild the search index to upgrade." Read next uses format 1 vectors in the same way. A stopped or partial format 2 build does not switch serving.
- **Seeding.** A format 2 build reuses vectors from the embedding cache by text hash, or from format 1 (opened read-only) when the cache lacks them. Format 1 vectors are reused only when their model fingerprint matches; a keyword-only first build adopts the format 1 fingerprint, so it keeps them. Nothing already embedded is embedded again, and the format 1 file's bytes do not change.
- **Validation.** The first completed format 2 build is checked before search switches to it: `quick_check`, the FTS integrity check, no orphan chunks or passages, and every file with a chunk. A failure keeps serving format 1 and asks for a rebuild.
- **Older processes.** They keep working on their own format 1 index, which goes stale unless they rebuild it. Both files count toward the 4 GiB `.reader/` data budget.
- **Removal.** Remove format 1 only when no older Reader process needs it, with **Remove** on the Behind the scenes search card. Removal is refused while format 1 still serves search, while any index run holds `.reader/search.lock`, and while another process holds the format 1 database's write lock. It then deletes `search.sqlite3` and its `-wal`, `-shm` and `-journal` companions. This check is best effort: a read-only process between queries is not detected, and it reports "Search index missing" afterwards; older code can rebuild its format 1 index with its own `reader index`.

## Budgets and settings

The index's budgets are settings in the vault's `indexes/settings.json`, under an optional `search` object. Unknown keys and out-of-range values are refused by name before a worker starts.

| Setting | Default | Range | Bounds |
| --- | --- | --- | --- |
| `content_types` | `.md .txt .pdf .html .tex .rst .edict .bib` | text-decodable types, `.pdf`, `""` | which files are split into passages |
| `max_passages` | 400,000 | 1–5,000,000 | distinct passages, checked before each file is published |
| `max_database_mib` | 2,048 | 16–3,072 | search database (SQLite `max_page_count` at 4 KiB pages) |
| `max_cache_mib` | 1,024 | 16–2,048 | embedding cache (`max_page_count`) |
| `worker_timeout_minutes` | 60 | 1–240 | guarded worker wall clock |
| `worker_threads` | 4 | 1–8 | inference threads and `OMP_NUM_THREADS` |

`max_database_mib + max_cache_mib` may not exceed 3,584 MiB, so both stay inside the 4 GiB `.reader/` data budget. A breach names its setting and the work already saved, for example: "Search index would hold more than 400,000 passages (indexes/settings.json search.max_passages); 399,980 passages saved. Raise the setting or narrow search.content_types, then run again." SQLite's "database or disk is full" is reported the same way for `max_database_mib` and `max_cache_mib`.

## Resource limits and recovery

CLI indexing uses a serialized, guarded local worker with `worker_threads` inference threads and a `worker_timeout_minutes` wall-clock deadline. Its aggregate CPU-time limit is the deadline times the threads, plus ten minutes. Other limits are a 4 GiB aggregate `.reader/` data budget, a 4 GiB process-group resident-memory threshold, a 16 MiB combined worker log/result threshold, and a 50 GiB minimum host free-space threshold. The environment's build footprint is checked against 20 GiB before launch. No Docker image, volume, or compiler target is created. Model downloads, temporary files, library cache, and worker logs stay under `.reader/`; this includes existing session scratch storage in the data accounting.

The worker receives `READER_INDEX_DEADLINE`, a tenth of the timeout (at most two minutes) before the guard's deadline. It stops cleanly between files at that point and reports `complete: false`, `stopped: "time limit"` and "Stopped at the time limit; N passages saved. Run again to continue." If the worker overruns, the guard kills its process group at the deadline and reports the same message, with the passage count read from the published index. A failed worker is reported by its last `Reader:` error line, or else its last line that is not PDF-repair noise, not by the raw log tail. The full log stays in `.reader/search-runtime/stderr.log`.

Disk accounting tolerates files that disappear during measurement, such as completed SQLite journals. Other measurement errors still fail closed. The guard checks once per second and terminates the worker process group on limit or monitoring failure; it is not a filesystem quota, and transient overshoot is possible. An OS per-file limit bounds each worker output to the larger database budget plus 64 MiB. Indexing also limits sources to 32 MiB, extracted PDF text to 32 MiB, and PDFs to 5,000 pages. These are local workload limits, not isolation against hostile parsers or concurrent filesystem mutation.

`.reader/search-runtime/launch.json` records the launch contract, process group, measurements, and completion status; `stderr.log` and `result.json` are replaced per run. The worker holds `.reader/search.lock`; guarded CLI invocations serialize on `.reader/search-run.lock`. Search does not download a model or refresh the index in the background. Direct Python API callers are responsible for their process resource envelope; the CLI provides the guarded entry point.

On a missing or stale index, run `reader index`. On corruption or incompatible schema/model, stop active Reader search/index processes, remove only `.reader/search.v2.sqlite3` and its `-wal`, `-shm`, or `-journal` companions if present, then rebuild. Search falls back to format 1 meanwhile, if it exists. Leave `.reader/search.sqlite3` to older Reader processes, or remove it as described above. Keep `.reader/models/` and `.reader/embedding-cache.sqlite3` to reuse the download and completed embeddings. If the embedding cache itself is damaged or full, stop index workers and remove only that disposable cache; the next index rebuild regenerates needed vectors within the same resource budget. Never remove inbox/library files or ingestion staging to repair search. Inspect worker logs after failed extraction/model setup or a resource refusal; resolve the reported condition before retrying. Runtime and model caches may be removed while no index/search is running; they contain no canonical source documents.

## Verification

Run `uv run --locked pytest -q` for path/content/fuzzy retrieval, content types, passage deduplication and editions, float16 ranking agreement, budgets, resumable runs, format 1 beside format 2 (`tests/test_index_scale.py` builds real format 1 indexes with the frozen `tests/legacy_search_v1.py`, checks that seeding calls no model and never changes format 1, that format 1 serves until format 2 completes, that older code keeps working, and that removal is refused while busy), PDF warning suppression, deterministic vector ranking, reading, stale-source checks, edit/move/delete refresh, rollback, path confinement, and CLI/MCP boundaries. Deterministic test embeddings verify integration, not model relevance. Actual model retrieval, three contrasting paraphrase fixtures, and installed-client checks are recorded separately in activity. `scripts/verify_search_installation.py` exercises the configured MCP launch command and installed helper against the existing real index without changing library sources.

Readers older than format 2 never open the format 2 file, so they keep working on format 1. Use `reader index --no-semantic` to refresh metadata without model calls or re-embedding unchanged sources. Updated readers require the separate metadata marker.
