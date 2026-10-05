#!/usr/bin/env python3
"""Read-only acceptance of installed Reader search/read using the real index."""
import asyncio
import json
import os
from pathlib import Path
from reader_paths import paths
import subprocess
import sys
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    code, root = paths()
    settings = json.loads(subprocess.check_output(['codex', 'mcp', 'get', 'reader', '--json'], text=True))
    transport = settings['transport']
    assert transport['command'] == str(code / '.venv/bin/python')
    assert transport['args'] == ['-m', 'reader_mcp.cli', '--root', str(root), 'serve']
    helper = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'skills/reader/scripts/reader.py'
    with tempfile.TemporaryDirectory(prefix='reader-search-caller-') as cwd:
        params = StdioServerParameters(command=transport['command'], args=transport['args'], cwd=cwd,
                                       env={'HF_HUB_OFFLINE': '1'})
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as client:
                await client.initialize()
                tools = {t.name for t in (await client.list_tools()).tools}
                assert {'reader_search', 'reader_read'} <= tools
                for query, mode in [(os.environ['READER_VERIFY_QUERY'], 'keyword'), (os.environ['READER_VERIFY_FUZZY_QUERY'], 'fuzzy'),
                                    ('recover stored information after a system failure', 'semantic')]:
                    response = await client.call_tool('reader_search', {'query': query, 'mode': mode, 'limit': 3})
                    assert not response.isError, response
                    result = json.loads(response.content[0].text)
                    assert result['results'], result
                    doc = result['results'][0]
                    response = await client.call_tool('reader_read', {'path': doc['path'],
                        'page': doc['page'], 'start_line': doc['start_line'], 'expected_sha256': doc['sha256']})
                    assert not response.isError, response
                    assert json.loads(response.content[0].text)['text']
                    print(f"PASS {mode}: {doc['path']}")
        response = subprocess.check_output([sys.executable, str(helper), 'search', os.environ['READER_VERIFY_QUERY'],
                                            '--mode', 'keyword', '--limit', '1'], cwd=cwd, text=True, timeout=30)
        assert json.loads(response)['results']
        print('PASS installed helper search from an external working directory')
    # A tiny contrasting corpus checks genuine paraphrase retrieval with the real model.
    # It is separate from unit tests, which deliberately do not download a model.
    from reader_mcp.search import Search
    with tempfile.TemporaryDirectory(prefix='semantic-fixture-', dir=root / '.reader/search-runtime') as scratch:
        fixture = Path(scratch)
        (fixture / 'library').mkdir()
        samples = {
            'medicine.txt': 'The physician prescribed medication to treat the patient.',
            'weather.txt': 'A thunderstorm brought heavy rain, lightning and gusting winds.',
            'storage.txt': 'An append-only journal records transactions so committed data can be recovered after an unexpected shutdown.',
        }
        for name, content in samples.items():
            (fixture / 'library' / name).write_text(content)
        engine = Search(fixture)
        engine._model = Search(root).model()
        engine.index(True)
        for query, expected in [
            ('doctor recommended drugs for an ill person', 'medicine.txt'),
            ('bad weather with electrical flashes', 'weather.txt'),
            ('restore saved records following a power outage', 'storage.txt'),
        ]:
            found = engine.search(query, mode='semantic', limit=1)['results'][0]['path']
            assert found == 'library/' + expected, (query, found, expected)
            print(f'PASS real-model paraphrase: {query} -> {expected}')


if __name__ == '__main__':
    asyncio.run(main())
