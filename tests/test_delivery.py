import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import pytest

from reader_mcp.store import Attachment, Store, Submission


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    (root / "inbox").mkdir()
    (root / "library").mkdir()
    return root


def request(**kwargs):
    return Submission.model_validate({"request_id": str(uuid4()), "title": "A report",
                                      "markdown": "# Report\n", **kwargs})


def test_preservation_retry_and_filing(vault, tmp_path):
    original = tmp_path / "report.md"
    original.write_bytes(b"# Exact bytes\r\n![asset](assets/data.bin)\r\n")
    asset = tmp_path / "data.bin"
    asset.write_bytes(bytes(range(256)))
    submission = request(markdown=None, document_path=str(original),
                         attachments=[Attachment(source_path=str(asset), path="assets/data.bin")],
                         provenance={"project": "other-project", "commit": "abc123"})
    store = Store(vault)
    receipt = store.ingest(submission)
    assert receipt["status"] == "awaiting_filing"
    assert receipt["integrity"] == "intact"
    assert Path(receipt["document_path"]).read_bytes() == original.read_bytes()
    bundle = vault / receipt["bundle_path"]
    assert (bundle / "assets/data.bin").read_bytes() == asset.read_bytes()
    assert receipt["provenance"] == {"project": "other-project", "commit": "abc123"}
    assert store.ingest(submission) == receipt
    filed = vault / "library" / "a-collection" / "report"
    filed.parent.mkdir()
    shutil.move(bundle, filed)
    assert store.status(str(submission.request_id))["status"] == "filed"
    assert store.ingest(submission)["document_path"] == str(filed / "report.md")
    (filed / "assets/data.bin").write_bytes(b"changed")
    assert store.status(str(submission.request_id))["integrity"] == "needs_attention"
    with pytest.raises(ValueError, match="changed or missing"):
        store.ingest(submission)


@pytest.mark.parametrize("name", ["../escape.md", "/tmp/escape.md", "a/../../escape", ".obsidian/x",
                                   "a\\b", "a//b", "receipt.json", "index.md", "RECEIPT.JSON", "a./b"])
def test_unsafe_destinations_leave_no_arrival(vault, name):
    with pytest.raises(ValueError):
        Store(vault).ingest(request(filename=name))
    assert list((vault / "inbox").iterdir()) == []


@pytest.mark.parametrize("attachment_name", ["REPORT.md", "report.md/child", "reporT.md"])
def test_collisions_are_rejected(vault, tmp_path, attachment_name):
    asset = tmp_path / "asset"
    asset.write_text("asset")
    with pytest.raises(ValueError, match="Conflicting"):
        Store(vault).ingest(request(attachments=[{"source_path": str(asset), "path": attachment_name}]))


def test_conflicting_retry(vault):
    store = Store(vault)
    submission = request()
    receipt = store.ingest(submission)
    with pytest.raises(ValueError, match="different submission"):
        store.ingest(submission.model_copy(update={"markdown": "changed"}))
    assert store.status(receipt["id"])["integrity"] == "intact"
    assert len(list((vault / "inbox").iterdir())) == 1


def test_unknown_receipt_and_symlink_rejection(vault, tmp_path):
    store = Store(vault)
    assert store.status(str(uuid4()))["status"] == "not_found"
    (vault / "inbox").rmdir()
    (vault / "inbox").symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match="real inbox"):
        Store(vault)


def test_source_fifo_rejected_without_waiting(vault, tmp_path):
    fifo = tmp_path / "fifo"
    os.mkfifo(fifo)
    with pytest.raises(ValueError, match="regular file"):
        Store(vault).ingest(request(markdown=None, document_path=str(fifo)))


def test_failed_publish_leaves_no_partial_bundle(vault, monkeypatch):
    def fail(*args):
        raise OSError("simulated rename failure")
    monkeypatch.setattr(Path, "rename", fail)
    with pytest.raises(OSError, match="simulated"):
        Store(vault).ingest(request())
    assert list((vault / "inbox").iterdir()) == []
    assert list((vault / ".reader/staging").iterdir()) == []


def test_subprocess_retries_from_other_project(vault, tmp_path):
    project = tmp_path / "other-project"
    project.mkdir()
    submission = request()
    args = [sys.executable, "-m", "reader_mcp.cli", "--root", str(vault), "ingest", "-"]
    def deliver(_):
        return subprocess.run(args, input=submission.model_dump_json(), capture_output=True,
                              text=True, cwd=project, check=True, timeout=20)
    with ThreadPoolExecutor(max_workers=4) as workers:
        receipts = [json.loads(p.stdout) for p in workers.map(deliver, range(4))]
    assert all(r == receipts[0] for r in receipts)
    assert len(list((vault / "inbox").iterdir())) == 1


def test_size_limit_and_missing_attachment(vault, tmp_path, monkeypatch):
    import reader_mcp.store as module
    monkeypatch.setattr(module, "MAX_FILE", 10)
    with pytest.raises(ValueError, match="32 MiB"):
        Store(vault).ingest(request(markdown="x" * 11))
    with pytest.raises(FileNotFoundError):
        Store(vault).ingest(request(attachments=[{"source_path": str(tmp_path / "absent"), "path": "a"}]))
    assert list((vault / "inbox").iterdir()) == []


def test_mcp_boundary_from_other_project(vault, tmp_path):
    async def exercise():
        project = tmp_path / "mcp-caller"
        project.mkdir()
        parameters = StdioServerParameters(command=sys.executable,
            args=["-m", "reader_mcp.cli", "--root", str(vault), "serve"], cwd=str(project))
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as client:
                await client.initialize()
                tools = await client.list_tools()
                assert {tool.name for tool in tools.tools} == {"reader_ingest", "reader_status", "reader_search", "reader_read", "reader_threads", "reader_highlight", "reader_reply", "reader_resolve_thread", "reader_attention", "reader_mark_seen", "reader_warning"}
                submission = request()
                result = await client.call_tool("reader_ingest", {"submission": submission.model_dump(mode="json")})
                assert not result.isError, result
                receipt = json.loads(result.content[0].text)
                assert receipt["integrity"] == "intact"
                assert Path(receipt["document_path"]).read_text() == submission.markdown
                status = await client.call_tool("reader_status", {"request_id": str(submission.request_id)})
                assert not status.isError
                assert json.loads(status.content[0].text)["status"] == "awaiting_filing"
                bad = submission.model_copy(update={"filename": "../escape.md"})
                rejected = await client.call_tool("reader_ingest", {"submission": bad.model_dump(mode="json")})
                assert rejected.isError
                note=vault / "library/annotation-test.md"
                note.write_text("An exact passage for discussion.\n")
                highlight=await client.call_tool("reader_highlight",{"path":"library/annotation-test.md","start":3,"end":16,"owner":"Reader librarian","comment":"A source-grounded observation."})
                assert not highlight.isError,highlight
                warning=await client.call_tool("reader_warning",{"path":"library/annotation-test.md","start":0,"end":2,"owner":"Reader librarian","comment":"Concern: fixture claim has no evidence."})
                assert not warning.isError and json.loads(warning.content[0].text)['kind']=='warning',warning
                thread=json.loads(highlight.content[0].text)
                reply=await client.call_tool("reader_reply",{"thread_id":thread["id"],"author":"You","body":"Please explain.","reply_to":thread["comments"][0]["id"]})
                assert not reply.isError,reply
                listed=await client.call_tool("reader_threads",{"path":"library/annotation-test.md"})
                assert len(next(t for t in json.loads(listed.content[0].text)["threads"] if t["id"]==thread["id"])["comments"])==2
                attention=await client.call_tool("reader_attention",{"participant":"Reader librarian","path":"library/annotation-test.md"})
                assert not attention.isError,attention
                items=json.loads(attention.content[0].text)["items"]
                seen=await client.call_tool("reader_mark_seen",{"participant":"Reader librarian","items":[{"key":i["key"],"version":i["version"]} for i in items]})
                assert not seen.isError,seen
                attention=await client.call_tool("reader_attention",{"participant":"You","path":"library/annotation-test.md"})
                assert all(not i["read"] and i["seen_by"][0]["participant"]=="Reader librarian" for i in json.loads(attention.content[0].text)["items"])
    asyncio.run(exercise())
