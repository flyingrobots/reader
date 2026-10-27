// The MCP server (`reader serve`): JSON-RPC over stdio, its tool list and schemas, and a few calls.
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertShape, makeVault, mcp} from './harness.mjs';

const SOLITUDE = 'library/walden/thoreau/solitude.md';
const TOOLS = ['reader_attention', 'reader_curate', 'reader_curation', 'reader_highlight', 'reader_ingest', 'reader_mark_seen', 'reader_read',
  'reader_reply', 'reader_resolve_thread', 'reader_search', 'reader_status', 'reader_threads', 'reader_warning'];
let vault, client;

before(async () => {
  vault = makeVault();
  client = await mcp(vault);
});

after(async () => {
  await client?.close();
  vault?.cleanup();
});

/** A tool result's structured content (FastMCP also mirrors it as JSON text). */
function content(result) {
  assert.ok(result, 'a result');
  if (result.structuredContent) return result.structuredContent.result ?? result.structuredContent;
  return JSON.parse(result.content[0].text);
}

describe('MCP over stdio', () => {
  test('initialize names the Reader server and offers tools', () => {
    assert.equal(client.init.result.serverInfo.name, 'Reader');
    assert.ok(client.init.result.capabilities.tools);
  });
  test('tools/list: the thirteen Reader tools, their input schemas and hints', async () => {
    const list = (await client.call('tools/list')).result.tools;
    assert.deepEqual(list.map(t => t.name).sort(), TOOLS);
    for (const tool of list) {
      assert.ok(tool.description && tool.inputSchema?.type === 'object', tool.name);
      assertShape('mcp-tool-' + tool.name, {input: tool.inputSchema, annotations: tool.annotations ?? null});
    }
    const read = list.find(t => t.name === 'reader_read');
    assert.deepEqual(read.inputSchema.required, ['path']);
    assert.equal(list.find(t => t.name === 'reader_search').annotations.readOnlyHint, true);
  });
  test('reader_search and reader_read return sourced passages', async () => {
    const found = content(await client.tool('reader_search', {query: 'solitude', mode: 'keyword', limit: 2}));
    assertShape('mcp-search', found);
    const hit = found.results[0];
    const read = content(await client.tool('reader_read', {path: hit.path, start_line: 1, limit: 3, expected_sha256: hit.sha256}));
    assertShape('mcp-read', read);
    const stale = await client.tool('reader_read', {path: hit.path, expected_sha256: '0'.repeat(64)});
    assert.equal(stale.isError, true);
  });
  test('reader_threads and reader_highlight work on the shared annotations', async () => {
    const threads = content(await client.tool('reader_threads', {path: SOLITUDE}));
    assert.ok(threads.threads.length >= 1);
    const text = readFileSync(join(vault.root, SOLITUDE), 'utf8');
    const start = text.indexOf('delicious evening');  // ASCII prefix: code points equal UTF-16 units here
    const made = content(await client.tool('reader_highlight', {path: SOLITUDE, start, end: start + 17, owner: 'Archivist', comment: 'A synthetic note.',
      expected_sha256: threads.source_sha256, request_id: randomUUID()}));
    assert.equal(made.anchor.quote, 'delicious evening');
    assert.ok(existsSync(join(vault.root, `annotations/${made.id}.json`)));
  });
  test('reader_ingest delivers inline markdown; reader_status finds it', async () => {
    const request_id = randomUUID();
    const delivered = content(await client.tool('reader_ingest', {submission: {request_id, title: 'An MCP delivery', markdown: '# An MCP delivery\n'}}));
    assertShape('mcp-ingest', delivered);
    assert.ok(existsSync(join(vault.root, `inbox/${request_id}/receipt.json`)));
    const status = content(await client.tool('reader_status', {request_id}));
    assertShape('mcp-status', status);
  });
  test('--inline-only refuses a submission that names a local file', async () => {
    const inline = await mcp(vault, ['--inline-only']);
    try {
      const refused = await inline.tool('reader_ingest', {submission: {request_id: randomUUID(), title: 'A file', document_path: join(vault.root, SOLITUDE)}});
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /inline markdown only/);
    } finally {
      await inline.close();
    }
  });
});
