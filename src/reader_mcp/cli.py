"""CLI fallback and stdio server entry point."""

import argparse
import json
import os
from pathlib import Path
import sys
import sqlite3

from .store import Store, Submission


def main():
    parser = argparse.ArgumentParser(description="Deliver, search, and read Reader documents")
    parser.add_argument("--root", default=os.environ.get("READER_ROOT"),
                        help="Reader vault path (or READER_ROOT)")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("ingest", help="Read a submission JSON file; use - for stdin")
    ingest.add_argument("request")
    annotate = commands.add_parser("annotate", help="Read/write shared passage annotations from JSON; - reads stdin")
    annotate.add_argument("request")
    reading = commands.add_parser("reading-copy", help="Create an unwrapped Markdown reading derivative using wide-md")
    reading.add_argument("path", help="Library-relative original Markdown path")
    status = commands.add_parser("status", help="Inspect a receipt by UUID")
    status.add_argument("request_id")
    commands.add_parser("serve", help="Run the local MCP server over stdio")
    index = commands.add_parser("index", help="Refresh the rebuildable library search index")
    index.add_argument("--no-semantic", action="store_true", help="Skip model download and embedding")
    search = commands.add_parser("search", help="Search library paths and contents")
    search.add_argument("query")
    search.add_argument("--mode", choices=["hybrid", "keyword", "fuzzy", "semantic"], default="hybrid")
    search.add_argument("--limit", type=int, default=10)
    search.add_argument("--path-prefix", default="library/")
    read = commands.add_parser("read", help="Read source text at a search result")
    read.add_argument("path")
    read.add_argument("--start-line", type=int, default=1)
    read.add_argument("--limit", type=int, default=100)
    read.add_argument("--page", type=int)
    read.add_argument("--expected-sha256")
    validate = commands.add_parser("validate-metadata", help="Validate document and catalog frontmatter")
    validate.add_argument("paths", nargs="*", help="Library-relative Markdown paths; default all library Markdown")
    validate.add_argument("--allow-legacy", action="store_true",
                          help="Accept legacy metadata without inventing source schema or revision values")
    validate.add_argument("--profile", choices=["auto", "document", "catalog"], default="auto")
    metadata_schema = commands.add_parser("metadata-schema", help="Print the versioned metadata JSON Schema")
    metadata_schema.add_argument("--profile", choices=["document", "catalog"], default="document")
    catalog = commands.add_parser("catalog", help="Version library metadata and mirror it to SQLite")
    catalog.add_argument("action", choices=["plan", "migrate", "sync", "check", "schema"])
    args = parser.parse_args()
    if args.command == "metadata-schema":
        from .metadata import schema
        print(json.dumps(schema(args.profile), indent=2))
        return
    if not args.root:
        parser.error("Pass --root or set READER_ROOT")
    try:
        if args.command == "validate-metadata":
            from .metadata import validate_paths
            result = validate_paths(Path(args.root).expanduser().resolve(strict=True), args.paths,
                                    allow_legacy=args.allow_legacy, profile=args.profile)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            if not result['valid']:
                sys.exit(1)
            return
        store = Store(Path(args.root))
        if args.command == "serve":
            from .server import serve
            serve(store)
            return
        if args.command == "ingest":
            request = sys.stdin.read() if args.request == "-" else Path(args.request).read_text()
            result = store.ingest(Submission.model_validate_json(request))
        elif args.command == "annotate":
            from .annotations import Annotations
            request = sys.stdin.read() if args.request == "-" else Path(args.request).read_text()
            result = Annotations(store.root).dispatch(json.loads(request))
        elif args.command == "reading-copy":
            from .reading import reading_copy
            result = reading_copy(store.root, args.path)
        elif args.command == "status":
            result = store.status(args.request_id)
        elif args.command == "catalog":
            from .catalog import Catalog, Metadata
            result = Metadata.model_json_schema() if args.action == "schema" else Catalog(store.root).run(args.action)
        else:
            from .search import Search
            engine = Search(store.root)
            if args.command == "index":
                if os.environ.get("READER_INDEX_WORKER") == "1":
                    result = engine.index(semantic=not args.no_semantic)
                else:
                    from .search_guard import run_index
                    result = run_index(store.root, semantic=not args.no_semantic)
            elif args.command == "search":
                result = engine.search(args.query, args.mode, args.limit, args.path_prefix)
            else:
                result = engine.read(args.path, args.start_line, args.limit, args.page, args.expected_sha256)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, TypeError, OSError, sqlite3.Error) as exc:
        print(f"Reader: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
