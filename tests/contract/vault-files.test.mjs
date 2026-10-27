// Stored formats a port must read and write byte-compatibly, and the cross-process rules that let
// two implementations share one vault during a strangler migration: flock-guarded writers and the
// single chat owner per vault (#20, #72). Lock holders here are plain external processes (perl).
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {assertShape, cli, makeVault, readJson, sleep, startServer} from './harness.mjs';

const SOLITUDE = 'library/walden/thoreau/solitude.md';
let vault;

before(() => {
  vault = makeVault();
  // Rebuild every index the CLI owns, so the files below are this implementation's output.
  for (const args of [['index', '--no-semantic'], ['browse'], ['catalog', 'sync']]) {
    const run = cli(vault, args, {timeout: 90000});
    assert.equal(run.status, 0, `${args.join(' ')}: ${run.stderr}`);
  }
});

after(() => vault?.cleanup());

/** Tables, columns (name, type, pk, notnull) and indexes, ignoring FTS shadow tables. */
function schema(file) {
  const db = new DatabaseSync(join(vault.root, file), {readOnly: true});
  try {
    const tables = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .filter(t => !/_(data|idx|docsize|config|content)$/.test(t.name));
    const out = {};
    for (const t of tables) {
      if (t.type === 'index') { out['index ' + t.name] = t.sql ? t.sql.replace(/\s+/g, ' ') : 'auto'; continue; }
      const columns = /VIRTUAL TABLE/i.test(t.sql) ? t.sql.replace(/\s+/g, ' ') :
        db.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => `${c.name} ${c.type}${c.pk ? ' pk' : ''}${c.notnull ? ' not null' : ''}`);
      out['table ' + t.name] = columns;
    }
    out.user_version = db.prepare('PRAGMA user_version').get().user_version;
    return out;
  } finally {
    db.close();
  }
}

function golden(name, value) {
  const file = join(import.meta.dirname, 'golden', name + '.json');
  if (process.env.READER_CONTRACT_UPDATE === '1') {
    writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
    return;
  }
  assert.deepEqual(value, JSON.parse(readFileSync(file, 'utf8')), `${name} differs from tests/contract/golden/${name}.json`);
}

describe('SQLite stores (exact schemas)', () => {
  for (const [name, file] of [['sqlite-search', '.reader/search.v2.sqlite3'], ['sqlite-links', '.reader/links.sqlite3'],
    ['sqlite-catalog', '.reader/catalog.sqlite3'], ['sqlite-embedding-cache', '.reader/embedding-cache.sqlite3']]) {
    test(`${file}`, () => golden(name, schema(file)));
  }
  test('the search index is readable by another process while the server runs (WAL)', () => {
    const db = new DatabaseSync(join(vault.root, '.reader/search.v2.sqlite3'), {readOnly: true});
    try {
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
      assert.ok(db.prepare('SELECT count(*) AS n FROM docs').get().n >= 30);
    } finally {
      db.close();
    }
  });
});

describe('JSON and Markdown stores (shapes)', () => {
  test('voices.json', () => assertShape('file-voices', readJson(vault.root, 'voices.json')));
  test('indexes/coverage.json', () => assertShape('file-coverage', readJson(vault.root, 'indexes/coverage.json')));
  test('indexes/settings.json', () => assertShape('file-browse-settings', readJson(vault.root, 'indexes/settings.json')));
  test('inbox/<uuid>/receipt.json', () => {
    const bundle = readdirSync(join(vault.root, 'inbox')).find(n => /^[0-9a-f-]{36}$/.test(n));
    assertShape('file-receipt', readJson(vault.root, `inbox/${bundle}/receipt.json`));
  });
  test('art/<path>/<sha256>/<generation>/{provenance,scene}.json', () => {
    const base = 'art/walden/thoreau/where-i-lived.md';
    const edition = readdirSync(join(vault.root, base)).find(n => /^[0-9a-f]{64}$/.test(n));
    const generation = readdirSync(join(vault.root, base, edition))[0];
    assertShape('file-art-provenance', readJson(vault.root, `${base}/${edition}/${generation}/provenance.json`));
    assertShape('file-art-scene', readJson(vault.root, `${base}/${edition}/${generation}/scene.json`));
  });
  test('catalog notes and library documents keep YAML frontmatter', () => {
    const text = readFileSync(join(vault.root, SOLITUDE), 'utf8');
    assert.match(text, /^---\nfrontmatter_schema_version: 1\n/);
    const index = readFileSync(join(vault.root, 'indexes/index.md'), 'utf8');
    assert.ok(index.length > 100);
  });
});

describe('sharing a vault between two server processes', {timeout: 60000}, () => {
  test('annotation writers serialize on .reader/annotations.lock (flock)', async () => {
    const server = await startServer(vault);
    try {
      const doc = (await server.get('/api/document', {path: SOLITUDE})).json;
      const hold = spawn('/usr/bin/perl', ['-e', 'use Fcntl ":flock"; $| = 1; open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; print "held\\n"; sleep 2;',
        join(vault.root, '.reader/annotations.lock')], {stdio: ['ignore', 'pipe', 'inherit']});
      const exited = new Promise(ok => hold.once('exit', ok));
      await new Promise(ok => hold.stdout.once('data', ok));
      const started = Date.now();
      const start = doc.text.indexOf('delicious evening');
      const made = await server.post('/api/annotations', {operation: 'create', path: SOLITUDE, start, end: start + 17, owner: 'You',
        expected_sha256: doc.sha256, request_id: randomUUID()});
      const waited = Date.now() - started;
      assert.equal(made.status, 200, made.text);
      assert.ok(waited >= 1200, `the write waited ${waited} ms for the external lock holder`);
      await exited;
    } finally {
      await server.stop();
    }
  });
  test('only one server owns chat for a vault; a second refuses chat writes with 409', async () => {
    const first = await startServer(vault);
    const second = await startServer(vault);
    try {
      const created = await first.post('/api/chat', {action: 'create', path: SOLITUDE, request_id: randomUUID()});
      assert.equal(created.status, 200, created.text);
      const ownership = (await second.get('/api/chats', {path: SOLITUDE})).json.owner;
      assert.equal(ownership.writable, false);
      const refused = await second.post('/api/chat', {action: 'create', path: SOLITUDE, request_id: randomUUID()});
      assert.equal(refused.status, 409, refused.text);
      // Reads still work from the second server.
      assert.equal((await second.get('/api/chat', {id: created.json.chat.id})).status, 200);
    } finally {
      await second.stop();
      await first.stop();
    }
    await sleep(100);
  });
});
