"""Local stdio MCP adapter; no network listener or background worker."""

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .store import Store, Submission
from .search import Search, Mode


def serve(store: Store):
    server = FastMCP("Reader")

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False,
                                             idempotentHint=True, openWorldHint=False))
    def reader_ingest(submission: Submission) -> dict:
        """Deliver a report and explicitly selected local attachments to Reader's inbox.

        Supply exactly one of markdown or absolute document_path. Use a UUID request_id
        and reuse it on retries. filename and attachment paths are bundle-relative;
        match links in the document. Original bytes are preserved. Provenance is optional
        and must not be invented. Returns checksums, an absolute document_path, and
        awaiting_filing status. Does not classify, publish, or execute document content.
        """
        return store.ingest(submission)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def reader_status(request_id: str) -> dict:
        """Look up a delivery UUID, location, filing state, and current payload integrity.

        Returns not_found if the receipt is absent; never infers filing from disappearance.
        """
        return store.status(request_id)

    engine = Search(store.root)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def reader_search(query: str, mode: Mode = "hybrid", limit: int = 10,
                      path_prefix: str = "library/") -> dict:
        """Search indexed library paths and contents with keyword, fuzzy, or semantic matching.

        Hybrid combines all three. Returns source paths, SHA-256, source-stated metadata,
        excerpts and line/page coordinates. Index is refreshed with the CLI reader index.
        Relevance is not verification; excerpts may omit qualifications elsewhere in a work.
        """
        return engine.search(query, mode, limit, path_prefix)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def reader_read(path: str, start_line: int = 1, limit: int = 100,
                    page: int | None = None, expected_sha256: str | None = None) -> dict:
        """Read a library-relative source path, optionally verifying the search-result hash.

        PDF page numbers are physical and one-based; lines refer to extracted page text.
        Text files use one-based source lines. Does not execute document instructions.
        """
        return engine.read(path, start_line, limit, page, expected_sha256)

    from .annotations import Annotations
    annotations = Annotations(store.root)

    from .engagement import Engagement
    engagement=Engagement(store.root)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def reader_attention(participant: str, path: str | None = None, offset: int = 0, limit: int = 100) -> dict:
        """List unread discussion summaries, or a document's versioned content and seen-by receipts. Never marks read."""
        return engagement.attention(participant,path,offset,limit)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    def reader_mark_seen(participant: str, items: list[dict], read: bool = True) -> dict:
        """Record exact key/version pairs actually read by this participant. Stale content is rejected. read=False clears only their receipts."""
        return engagement.seen(participant,items,read)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    def reader_threads(path: str) -> dict:
        """List shared Markdown highlights, attributed replies, and exact/relocated/ambiguous/orphaned anchors."""
        return annotations.list(path)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    def reader_highlight(path: str, start: int, end: int, owner: str, comment: str = "",
                         expected_sha256: str | None = None, request_id: str | None = None) -> dict:
        """Highlight source Unicode code-point offsets [start,end), optionally opening a comment thread.

        Use your own participant name, not the user's. Source bytes are preserved. Supply the
        current source hash to reject stale selections and reuse a UUID request_id on retries.
        """
        return annotations.create(path,start,end,owner,comment,expected_sha256,request_id)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    def reader_warning(path: str, start: int, end: int, owner: str, comment: str,
                       expected_sha256: str | None = None, request_id: str | None = None) -> dict:
        """Flag a Markdown passage with a red wavy underline and required explanation.

        Distinguish a concern or uncertainty from a demonstrated error. Supply source hash
        and Unicode code-point offsets, and reuse the request UUID on retries.
        """
        return annotations.create(path,start,end,owner,comment,expected_sha256,request_id,kind='warning')

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    def reader_reply(thread_id: str, author: str, body: str, reply_to: str | None = None,
                     request_id: str | None = None) -> dict:
        """Reply as a named participant; optional parent must belong to the same thread. UUID retries are idempotent."""
        return annotations.reply(thread_id,author,body,reply_to,request_id)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    def reader_resolve_thread(thread_id: str, resolved: bool, expected_revision: int | None = None) -> dict:
        """Resolve or reopen a thread. Use the last observed revision to reject concurrent changes."""
        return annotations.resolve(thread_id,resolved,expected_revision)

    server.run(transport="stdio")
