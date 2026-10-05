#!/usr/bin/env python3
"""Exercise installed MCP and skill routes; remove only this run's verified fixture."""

import asyncio
import json
import os
from pathlib import Path
from reader_paths import paths
import shutil
import subprocess
import sys
import tempfile
from uuid import uuid4

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from reader_mcp.store import Store


async def main():
    code, root = paths()
    settings = json.loads(subprocess.check_output(["codex", "mcp", "get", "reader", "--json"], text=True))
    transport = settings["transport"]
    assert transport["command"] == str(code / ".venv/bin/python")
    assert transport["args"] == ["-m", "reader_mcp.cli", "--root", str(root), "serve"]
    skill = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills/reader"
    assert skill.resolve() == code / "skills/reader"
    request_id = str(uuid4())
    store = Store(root)
    try:
        with tempfile.TemporaryDirectory(prefix="reader-other-project-") as other:
            project = Path(other)
            document = project / "report.md"
            document.write_bytes(b"# Reader installation fixture\r\n[Attachment](assets/sample.bin)\r\n")
            attachment = project / "sample.bin"
            attachment.write_bytes(bytes(range(256)))
            submission = {"request_id": request_id, "title": "Temporary installation verification",
                          "filename": "report.md", "document_path": str(document),
                          "attachments": [{"source_path": str(attachment), "path": "assets/sample.bin"}],
                          "provenance": {"project": "reader-installation-verification"}}
            params = StdioServerParameters(command=transport["command"], args=transport["args"], cwd=other)
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    listed = await client.list_tools()
                    assert {t.name for t in listed.tools} == {"reader_ingest", "reader_status", "reader_search", "reader_read", "reader_threads", "reader_highlight", "reader_reply", "reader_resolve_thread", "reader_warning", "reader_attention", "reader_mark_seen"}
                    delivered = await client.call_tool("reader_ingest", {"submission": submission})
                    assert not delivered.isError, delivered
                    receipt = json.loads(delivered.content[0].text)
                    assert receipt["status"] == "awaiting_filing" and receipt["integrity"] == "intact"
                    assert Path(receipt["document_path"]).read_bytes() == document.read_bytes()
                    assert (root / receipt["bundle_path"] / "assets/sample.bin").read_bytes() == attachment.read_bytes()
                    checked = await client.call_tool("reader_status", {"request_id": request_id})
                    assert not checked.isError
                    assert json.loads(checked.content[0].text) == receipt
            request_file = project / "submission.json"
            request_file.write_text(json.dumps(submission))
            helper = skill / "scripts/reader.py"
            retried = json.loads(subprocess.check_output(
                [sys.executable, str(helper), "ingest", str(request_file)], cwd=other, text=True))
            assert retried == receipt
            checked = json.loads(subprocess.check_output(
                [sys.executable, str(helper), "status", request_id], cwd=other, text=True))
            assert checked == receipt
            print("PASS: installed MCP discovery, ingestion, attachment preservation, and receipt lookup;")
            print("installed skill helper retried and checked the same receipt from another project.")
    finally:
        result = store.status(request_id)
        if result["status"] != "not_found":
            expected = root / "inbox" / request_id
            assert result["bundle_path"] == str(expected.relative_to(root))
            assert result["provenance"] == {"project": "reader-installation-verification"}
            assert result["integrity"] == "intact", "Fixture changed; preserve it for inspection"
            shutil.rmtree(expected)
            print("Removed only this run's verified temporary inbox bundle.")


if __name__ == "__main__":
    asyncio.run(main())
