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
    serve_parser = commands.add_parser("serve", help="Run the local MCP server over stdio")
    serve_parser.add_argument("--inline-only", action="store_true",
                              help="Refuse ingest requests that name local files (used for remote sessions)")
    web = commands.add_parser("web", help="Open the local zen reading web application")
    web.add_argument("--port", type=int, default=8766)
    web.add_argument("--participant", default="You")
    demo = commands.add_parser("demo", help="Build a disposable example vault (public-domain texts) and open the web reader on it")
    from .demo import add_arguments as demo_arguments
    demo_arguments(demo)
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
    browse = commands.add_parser("browse", help="Refresh Markdown work indexes and the README dashboard")
    browse.add_argument("--check", action="store_true", help="Check freshness without writing navigation files")
    catalog = commands.add_parser("catalog", help="Version library metadata and mirror it to SQLite")
    catalog.add_argument("action", choices=["plan", "migrate", "sync", "check", "schema"])
    curation = commands.add_parser("curation", help="Discover filed works or record explicit curator coverage")
    curation_commands = curation.add_subparsers(dest="curation_action", required=True)
    curation_list = curation_commands.add_parser("list", help="List pending works or inspect one exact work")
    curation_list.add_argument("--participant", required=True)
    curation_list.add_argument("--key")
    curation_list.add_argument("--offset", type=int, default=0)
    curation_list.add_argument("--limit", type=int, default=25)
    curation_list.add_argument("--since", help="Optional aware ISO arrival/catalog-date filter; not a filing watermark")
    curation_list.add_argument("--expected-snapshot", help="Reject a changed queue while paging")
    curation_mark = curation_commands.add_parser("mark", help="Record a JSON disposition; - reads stdin")
    curation_mark.add_argument("request")
    queue = commands.add_parser("queue", help="Read or add to a participant's reading queue (voices: --by and --reason)")
    queue_commands = queue.add_subparsers(dest="queue_action", required=True)
    queue_add = queue_commands.add_parser("add", help="Suggest a library document; a voice's item stays under Suggested until pinned")
    queue_add.add_argument("path", help="Library-relative document path")
    queue_add.add_argument("--participant", required=True, help="Whose queue, e.g. You")
    queue_add.add_argument("--by", help="Who is adding it; defaults to the participant")
    queue_add.add_argument("--reason", help="Required when --by names someone else; shown beside the suggestion")
    queue_list = queue_commands.add_parser("list", help="Print Now reading, Queued and Suggested")
    queue_list.add_argument("--participant", required=True)
    args = parser.parse_args()
    if args.command == "metadata-schema":
        from .metadata import schema
        print(json.dumps(schema(args.profile), indent=2))
        return
    if args.command == "demo":  # Never uses --root or READER_ROOT: it builds its own vault.
        from .demo import run as run_demo
        try:
            run_demo(args)
        except (ValueError, OSError, sqlite3.Error) as exc:
            print(f"Reader: {exc}", file=sys.stderr)
            sys.exit(1)
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
        if args.command == "web":
            from .web import serve_web
            serve_web(store.root, args.port, args.participant)
            return
        if args.command == "serve":
            from .server import serve
            serve(store, inline_only=args.inline_only)
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
        elif args.command == "curation":
            from .curation import Curation
            curator = Curation(store.root)
            if args.curation_action == 'list':
                result = curator.pending(args.participant, args.key, args.offset, args.limit, args.since, args.expected_snapshot)
            else:
                request = sys.stdin.read() if args.request == '-' else Path(args.request).read_text()
                result = curator.mark(**json.loads(request))
        elif args.command == "queue":
            from uuid import uuid4
            from .web import WebLibrary
            library = WebLibrary(store.root)
            if args.queue_action == "add":
                library.queue.change(args.participant, "add", args.path, request_id=str(uuid4()),
                                     added_by=args.by, reason=args.reason)
            result = library.queue_view(args.participant)
        elif args.command == "browse":
            from .browse import Browse
            result = Browse(store.root).run(check=args.check)
            if args.check and result["status"] == "stale":
                print(json.dumps(result, ensure_ascii=False, indent=2))
                sys.exit(1)
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
