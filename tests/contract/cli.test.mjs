// The `reader` CLI: one JSON document on stdout, `Reader: <message>` on stderr and exit 1 on
// refusal. Runs READER_CLI_CMD against fresh synthetic vaults.
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertShape, cli, makeVault, readJson} from './harness.mjs';

const SOLITUDE = 'library/walden/thoreau/solitude.md';
const WIDE_MD_REVISION = 'c167101b32bbe37954429e9de5db33efcdc0a16c';  // the wide-md revision the receipt must name
let vault;

before(() => { vault = makeVault(); });
after(() => vault?.cleanup());

function ok(name, args, options) {
  const run = cli(vault, args, options);
  assert.equal(run.status, 0, `reader ${args.join(' ')}: ${run.stderr}`);
  assert.ok(run.json !== undefined, 'stdout is one JSON document');
  if (name) assertShape(name, run.json);
  return run.json;
}

function refused(args, options) {
  const run = cli(vault, args, options);
  assert.equal(run.status, 1, `reader ${args.join(' ')} should fail: ${run.stdout}`);
  assert.match(run.stderr, /^Reader: /m);
  return run;
}

describe('delivery', () => {
  test('reader ingest (stdin) writes an inbox bundle with receipt.json; a retry is idempotent', () => {
    const request_id = randomUUID();
    const submission = {request_id, title: 'A contract delivery', filename: 'note.md', markdown: '# A contract delivery\n\nSynthetic.\n',
      provenance: {project: 'Contract', source: 'tests/contract', author: 'A tester', report_date: '2026-10-21'}};
    const result = ok('cli-ingest', ['ingest', '-'], {input: JSON.stringify(submission)});
    const receipt = readJson(vault.root, `inbox/${request_id}/receipt.json`);
    assert.equal(receipt.id, request_id);
    const bytes = readFileSync(join(vault.root, `inbox/${request_id}/note.md`));
    assert.equal(receipt.files[0].sha256, createHash('sha256').update(bytes).digest('hex'));
    assertShape('file-receipt', receipt);
    const again = ok(null, ['ingest', '-'], {input: JSON.stringify(submission)});
    assert.equal(again.request_id ?? again.id, result.request_id ?? result.id);
    const status = ok('cli-status', ['status', request_id]);
    assert.ok(JSON.stringify(status).includes(request_id));
    refused(['ingest', '-'], {input: JSON.stringify({...submission, title: ''})});
  });
  test('reader status for an unknown delivery reports not_found', () => {
    const status = ok(null, ['status', randomUUID()]);
    assert.match(JSON.stringify(status), /not_found/);
  });
});

describe('search and read', () => {
  test('reader search keyword and fuzzy', () => {
    const keyword = ok('cli-search', ['search', 'solitude', '--mode', 'keyword', '--limit', '3']);
    assert.ok(keyword.results.length >= 1 && keyword.results.length <= 3);
    ok(null, ['search', 'solitude', '--mode', 'fuzzy']);
  });
  test('reader read with a hash check', () => {
    const found = ok(null, ['search', 'solitude', '--mode', 'keyword', '--limit', '1']).results[0];
    const read = ok('cli-read', ['read', found.path, '--start-line', '1', '--limit', '5', '--expected-sha256', found.sha256]);
    assert.ok(read.text || read.lines);
    refused(['read', found.path, '--expected-sha256', '0'.repeat(64)]);
    refused(['read', '../outside.md']);
  });
  test('reader index --no-semantic refreshes the keyword index', () => {
    const result = ok(null, ['index', '--no-semantic'], {timeout: 90000});
    assert.equal(typeof result, 'object');
  });
});

describe('annotations, curation and queue', () => {
  test('reader annotate lists threads from a JSON request on stdin', () => {
    const list = ok('cli-annotate-list', ['annotate', '-'], {input: JSON.stringify({operation: 'list', path: SOLITUDE})});
    assert.ok(list.threads.length >= 1);
    refused(['annotate', '-'], {input: JSON.stringify({operation: 'erase'})});
  });
  test('reader curation list pages a participant\'s pending works', () => {
    ok('cli-curation', ['curation', 'list', '--participant', 'Archivist', '--limit', '5']);
  });
  test('reader queue add and list', () => {
    ok('cli-queue', ['queue', 'add', SOLITUDE, '--participant', 'You', '--by', 'Archivist', '--reason', 'A synthetic suggestion.']);
    const list = ok('cli-queue', ['queue', 'list', '--participant', 'You']);
    assert.ok(JSON.stringify(list).includes(SOLITUDE));
  });
});

describe('metadata, catalog and browse', () => {
  test('reader metadata-schema prints a JSON Schema', () => {
    const schema = ok(null, ['metadata-schema', '--profile', 'document'], {root: false});
    assert.ok(schema.$schema || schema.properties);
  });
  test('reader catalog check reports the SQL mirror', () => {
    ok('cli-catalog-check', ['catalog', 'check']);
  });
  test('reader validate-metadata accepts the demo and rejects an invented field type', () => {
    const result = ok('cli-validate', ['validate-metadata', SOLITUDE]);
    assert.equal(result.valid, true);
    mkdirSync(join(vault.root, 'library/contract'), {recursive: true});
    writeFileSync(join(vault.root, 'library/contract/bad.md'), '---\nfrontmatter_schema_version: 1\ndocument_revision: "one"\ntitle: Bad\n---\n\nBody.\n');
    const bad = cli(vault, ['validate-metadata', 'library/contract/bad.md']);
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).valid, false);
    refused(['catalog', 'check']);  // the catalog refuses invalid metadata too
  });
  test('reader browse refreshes navigation; browse --check is fresh, then stale after a new work', () => {
    ok(null, ['browse']);
    const fresh = ok('cli-browse-check', ['browse', '--check']);
    assert.equal(fresh.status, 'current');
    writeFileSync(join(vault.root, 'library/contract/new-work.md'),
      '---\nfrontmatter_schema_version: 1\ndocument_revision: 1\ntitle: A new work\nauthor: A tester\ntype: Note\nadded: 2026-10-21\n---\n\n# A new work\n');
    const stale = cli(vault, ['browse', '--check']);
    assert.equal(stale.status, 1, stale.stderr);
    assert.equal(JSON.parse(stale.stdout).status, 'stale');
  });
});

describe('reading copies', () => {
  test('reader reading-copy refuses without wide-md, then writes an unwrapped derivative with a fake formatter', () => {
    const path = 'library/contract/wrapped.md';
    mkdirSync(join(vault.root, 'library/contract'), {recursive: true});
    const original = '---\ntitle: Wrapped prose\nauthor: A tester\n---\n\n# Wrapped prose\n\nThis paragraph was\nwrapped by hand at a\nnarrow width.\n\nA second one.\n';
    writeFileSync(join(vault.root, path), original);
    assert.match(refused(['reading-copy', path]).stderr, /wide-md/);
    // A stand-in formatter (awk): joins wrapped lines inside paragraphs, keeps frontmatter and blocks.
    const bin = join(vault.root, '.reader/tooling/bin');
    mkdirSync(bin, {recursive: true});
    const tool = join(bin, 'wide-md');
    writeFileSync(tool, `#!/bin/sh\nexec /usr/bin/awk '
NR==1 && $0=="---" {fm=1; print; next}
fm==1 {print; if ($0=="---") fm=2; next}
/^$/ {if (buf!="") {print buf; buf=""} print; next}
/^(#|- |> |[|])/ {if (buf!="") {print buf; buf=""} print; next}
{buf = (buf=="" ? $0 : buf " " $0)}
END {if (buf!="") print buf}'\n`);
    chmodSync(tool, 0o755);
    writeFileSync(join(vault.root, '.reader/tooling/installed.json'), JSON.stringify({revision: WIDE_MD_REVISION,
      executable_sha256: createHash('sha256').update(readFileSync(tool)).digest('hex')}));
    const made = ok('cli-reading-copy', ['reading-copy', path]);
    assert.equal(made.status, 'created');
    assert.equal(made.reading_copy, 'library/contract/wrapped.reading.md');
    const copy = readFileSync(join(vault.root, made.reading_copy), 'utf8');
    assert.match(copy, /^---\n[\s\S]*reading_source: library\/contract\/wrapped\.md\n/);
    assert.match(copy, /This paragraph was wrapped by hand at a narrow width\./);
    assert.equal(readFileSync(join(vault.root, path), 'utf8'), original, 'the original is never modified');
    assert.equal(ok(null, ['reading-copy', path]).status, 'existing');
    refused(['reading-copy', made.reading_copy]);
  });
});

describe('the demo', () => {
  test('reader demo --no-serve builds a marked vault and never needs --root', () => {
    const dir = join(vault.box, 'another-demo');
    const run = cli(vault, ['demo', '--no-serve', '--dir', dir], {root: false, timeout: 120000});
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(dir, '.reader-demo-vault')) && existsSync(join(dir, 'voices.json')));
  });
  test('a command without --root or READER_ROOT is refused', () => {
    const run = cli(vault, ['search', 'x'], {root: false});
    assert.notEqual(run.status, 0);
  });
});
