// Write routes and their on-disk effects. Each stored format gets a golden shape of the file
// itself (vault-file conformance), recorded from the reference server like the response shapes.
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CLOCK, TODAY, assertShape, files, makeVault, readJson, startServer, until} from './harness.mjs';

const SOLITUDE = 'library/walden/thoreau/solitude.md';
const ESSAY = 'library/walden/thoreau/where-i-lived.md';
const sha = text => createHash('sha256').update(text).digest('hex');
const YOU = sha('You');  // Per-participant files are named by the SHA-256 of the participant's UTF-8 name.
let vault, server, doc, initial;

before(async () => {
  vault = makeVault();
  initial = new Set(files(vault.root));
  server = await startServer(vault);
  doc = (await server.get('/api/document', {path: SOLITUDE})).json;
});

after(async () => {
  await server?.stop();
  vault?.cleanup();
});

async function ok(name, path, body) {
  const response = await server.post(path, body);
  assert.equal(response.status, 200, `${path}: ${response.text.slice(0, 300)}`);
  assertShape(name, response.json);
  return response.json;
}

async function refused(path, body, status = 400) {
  const response = await server.post(path, body);
  assert.equal(response.status, status, `${path}: ${response.text.slice(0, 300)}`);
  assertShape(status === 503 || status === 409 ? 'error-unavailable' : 'error', response.json);
  return response.json;
}

const pinned = stamp => assert.ok(stamp.startsWith(TODAY + 'T12:0'), `${stamp} should follow READER_TEST_CLOCK ${CLOCK}`);

describe('annotations', () => {
  let thread;
  test('POST /api/annotations create: a highlight with a comment lands in annotations/<id>.json', async () => {
    const start = [...doc.text].join('').indexOf('delicious evening');
    thread = await ok('annotation', '/api/annotations', {operation: 'create', path: SOLITUDE, start, end: start + 17, owner: 'You',
      comment: 'A synthetic note.', expected_sha256: doc.sha256, request_id: randomUUID()});
    assert.equal(thread.anchor.quote, 'delicious evening');
    pinned(thread.created_at);
    const file = `annotations/${thread.id}.json`;
    assert.ok(existsSync(join(vault.root, file)));
    assertShape('file-annotation', readJson(vault.root, file));
    assert.equal(readFileSync(join(vault.root, SOLITUDE), 'utf8'), doc.text, 'the source is never modified');
  });
  test('POST /api/annotations create is idempotent by request_id', async () => {
    const request_id = randomUUID();
    const body = {operation: 'create', path: SOLITUDE, start: 0, end: 3, owner: 'You', expected_sha256: doc.sha256, request_id};
    const first = (await server.post('/api/annotations', body)).json;
    const second = (await server.post('/api/annotations', body)).json;
    assert.equal(first.id, second.id);
  });
  test('POST /api/annotations reply and resolve bump the revision on disk', async () => {
    const replied = await ok('annotation', '/api/annotations', {operation: 'reply', thread_id: thread.id, author: 'Archivist', body: 'A reply.', request_id: randomUUID()});
    assert.equal(replied.revision, 2);
    const resolved = await ok('annotation', '/api/annotations', {operation: 'resolve', thread_id: thread.id, resolved: true, expected_revision: 2});
    assert.equal(resolved.resolved, true);
    const stored = readJson(vault.root, `annotations/${thread.id}.json`);
    assert.equal(stored.revision, 3);
    assert.equal(stored.comments.length, 2);
    await refused('/api/annotations', {operation: 'resolve', thread_id: thread.id, resolved: false, expected_revision: 2}, 400);
  });
  test('POST /api/annotations list and a stale source hash', async () => {
    await ok('discussion-threads', '/api/annotations', {operation: 'list', path: SOLITUDE});
    await refused('/api/annotations', {operation: 'create', path: SOLITUDE, start: 0, end: 3, owner: 'You', expected_sha256: '0'.repeat(64), request_id: randomUUID()});
    await refused('/api/annotations', {operation: 'nope'});
  });
});

describe('engagement, bookmarks, queue and history', () => {
  test('POST /api/seen records a read receipt in engagement/<sha256(participant)>.json', async () => {
    const body = await ok('seen', '/api/seen', {participant: 'You', items: [doc.item]});
    assert.equal(body.updated, 1);
    const stored = readJson(vault.root, `engagement/${YOU}.json`);
    assert.equal(stored.participant, 'You');
    assert.ok(stored.items[doc.item.key]);
    pinned(stored.items[doc.item.key].at);
    assertShape('file-engagement', stored);
    await refused('/api/seen', {participant: 'You', items: [{...doc.item, version: '0'.repeat(64)}]});
  });
  test('POST /api/bookmark saves a version-bound position in bookmarks/<sha256(participant)>.json', async () => {
    const saved = await ok('bookmark', '/api/bookmark', {participant: 'You', path: SOLITUDE, source_sha256: doc.sha256, progress: 0.5});
    pinned(saved.updated_at);
    const stored = readJson(vault.root, `bookmarks/${YOU}.json`);
    assert.equal(stored.items[SOLITUDE].progress, 0.5);
    assertShape('file-bookmarks', stored);
    await refused('/api/bookmark', {participant: 'You', path: SOLITUDE, source_sha256: '0'.repeat(64), progress: 0.5});
  });
  test('POST /api/queue add and move rewrite queues/<sha256(participant)>.json', async () => {
    const view = await ok('queue-view', '/api/queue', {action: 'add', path: ESSAY, request_id: randomUUID()});
    assert.ok([view.now?.path, ...view.queued.map(q => q.path)].includes(ESSAY));
    await ok('queue-view', '/api/queue', {action: 'move', path: ESSAY, index: 0, request_id: randomUUID()});
    const stored = readJson(vault.root, `queues/${YOU}.json`);
    assert.equal(stored.items[0].path, ESSAY);
    assertShape('file-queue', stored);
    await refused('/api/queue', {action: 'shuffle'});
    await refused('/api/queue', {action: 'add', path: ESSAY, colour: 'red'});
  });
  test('POST /api/history open appends to history/<sha256(participant)>.jsonl; hide records a hide', async () => {
    const before = readFileSync(join(vault.root, `history/${YOU}.jsonl`), 'utf8').trim().split('\n').length;
    await ok('history-open', '/api/history', {action: 'open', path: SOLITUDE, sha256: doc.sha256});
    const lines = readFileSync(join(vault.root, `history/${YOU}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, before + 1);
    assert.equal(lines.at(-1).path, SOLITUDE);
    assertShape('file-history-line', lines.at(-1));
    await ok('history-hide', '/api/history', {action: 'hide', path: SOLITUDE});
    await refused('/api/history', {action: 'open', path: SOLITUDE, sha256: '0'.repeat(64)});
  });
});

describe('themes', () => {
  test('POST /api/themes save and delete a custom theme in themes/<id>.json', async () => {
    const tokens = (await server.get('/assets/theme-tokens.json')).json;
    const colors = Object.fromEntries(tokens.colors.map(t => [t.name, '#202020']));
    const saved = await ok('theme', '/api/themes', {action: 'save', theme: {id: 'dusk', name: 'Dusk', fonts: {}, light: colors, dark: colors}});
    assert.equal(saved.id, 'dusk');
    assertShape('file-theme', readJson(vault.root, 'themes/dusk.json'));
    assert.deepEqual((await server.get('/api/themes')).json.themes.map(t => t.id), ['dusk']);
    await refused('/api/themes', {action: 'save', theme: {id: 'paper', name: 'Paper', fonts: {}, light: colors, dark: colors}});
    await ok('theme-deleted', '/api/themes', {action: 'delete', id: 'dusk'});
    assert.ok(!existsSync(join(vault.root, 'themes/dusk.json')));
    await refused('/api/themes', {action: 'delete', id: 'dusk'});
  });
});

describe('art', () => {
  test('POST /api/art favorite writes favorite.json beside the generations and commits it', async () => {
    const art = (await server.get('/api/art', {path: ESSAY})).json.art;
    const body = await ok('art-favorite', '/api/art', {action: 'favorite', path: ESSAY, edition: art.edition, generation: art.generation});
    assert.match(body.commit.commit, /^[0-9a-f]{40}$/);
    const stored = readJson(vault.root, 'art/walden/thoreau/where-i-lived.md/favorite.json');
    assert.equal(stored.generation, art.generation);
    assertShape('file-art-favorite', stored);
    await refused('/api/art', {action: 'paint'});
    await refused('/api/art', {action: 'favorite', path: ESSAY, edition: art.edition, generation: 'nope'});
  });
});

describe('writing', () => {
  test('POST /api/writing save creates and commits a notebook piece', async () => {
    const request = {action: 'save', request_id: randomUUID(), title: 'A contract note', slug: 'contract-note', status: 'draft', body: '# A contract note\n\nHello.\n'};
    const saved = await ok('writing-saved', '/api/writing', request);
    assert.match(saved.path, /^library\/notebook\/\d{4}-\d{2}-\d{2}-contract-note\.md$/);
    assert.equal(saved.status, 'committed');
    const text = readFileSync(join(vault.root, saved.path), 'utf8');
    assert.match(text, /^---\n(?:.*\n)*?title: "A contract note"\n(?:.*\n)*?---\n/);
    assert.ok(text.endsWith('# A contract note\n\nHello.\n'));
    // The same request again is idempotent; a new request for the same slug is a 409 with a suggestion.
    assert.equal((await server.post('/api/writing', request)).json.path, saved.path);
    const conflict = await server.post('/api/writing', {...request, request_id: randomUUID()});
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.suggestion, 'contract-note-2');
    await refused('/api/writing', {action: 'save', request_id: 'not-a-uuid', title: 'x', slug: 'x', status: 'draft', body: 'x'});
  });
  test('GET /api/writing lists the new piece', async () => {
    const list = (await server.get('/api/writing')).json;
    assert.ok(list.pieces.some(p => p.path.endsWith('-contract-note.md')));
  });
});

describe('local model, companions, maintenance, inbox and service', () => {
  test('POST /api/local-model settings persists .reader/local-model/settings.json', async () => {
    const body = await ok('local-model-settings', '/api/local-model', {action: 'settings', settings: {tasks: {standfirst: {enabled: false}}}});
    assert.equal(body.settings.tasks.standfirst.enabled, false);
    assert.equal(readJson(vault.root, '.reader/local-model/settings.json').tasks.standfirst.enabled, false);
    await refused('/api/local-model', {action: 'cancel', id: 'nope'});
    await refused('/api/local-model', {action: 'explode'});
  });
  test('POST /api/companions check answers status; set-path refuses a non-executable', async () => {
    await ok('companions-one', '/api/companions', {action: 'check', name: 'wide-md'});
    await refused('/api/companions', {action: 'set-path', name: 'colorful', path: '/nonexistent/colorful'});
    await refused('/api/companions', {action: 'install', name: 'nothing'});
  });
  test('POST /api/maintenance start runs a freshness check to completion', async () => {
    const job = await ok('maintenance-job', '/api/maintenance', {action: 'start', kind: 'check'});
    const done = await until(async () => (await server.get('/api/maintenance')).json.jobs.find(j => j.id === job.id && j.state === 'succeeded'));
    assert.ok(done.result);
    await refused('/api/maintenance', {action: 'start', kind: 'install-wide-md'});
    await refused('/api/maintenance', {action: 'stop'});
  });
  test('POST /api/inbox refuses to start without Codex and to stop when idle', async () => {
    const start = await refused('/api/inbox', {action: 'start'});
    assert.match(start.error, /Codex/);
    await refused('/api/inbox', {action: 'stop'});
    await refused('/api/inbox', {action: 'start', extra: 1});
  });
  test('POST /api/service refuses unknown actions (the suite never sends a real one)', async () => {
    await refused('/api/service', {action: 'bogus'});
    await refused('/api/service', {});
  });
});

describe('speech, prose, quizzes and prompts without their companions', () => {
  test('POST /api/speak is 503 unavailable without AI-TTS', async () => {
    const body = await refused('/api/speak', {path: SOLITUDE, source_sha256: doc.sha256, scope: 'article'}, 503);
    assert.equal(body.unavailable, true);
    await refused('/api/speak', {path: SOLITUDE, source_sha256: doc.sha256, volume: 11});
  });
  test('POST /api/speak/<id> refuses speech Reader did not submit', () => refused('/api/speak/unknown-job', {action: 'pause'}, 403));
  test('POST /api/prose refuses a malformed batch and is 409 unavailable without Colorful', async () => {
    await refused('/api/prose', {texts: ['A sentence.']});
    const body = await refused('/api/prose', {path: SOLITUDE, sha256: doc.sha256, segments: [{id: 'p1', text: 'A sentence.'}]}, 409);
    assert.equal(body.unavailable, true);
  });
  test('POST /api/quiz and /api/prompt refuse malformed requests', async () => {
    await refused('/api/quiz', {action: 'grade'});
    await refused('/api/quiz', {action: 'generate', path: ESSAY, regenerate: 'yes'});
    await refused('/api/prompt', {action: 'nope'});
    await refused('/api/prompt', {action: 'generate', path: ESSAY, regenerate: 'yes'});
  });
});

describe('no stray files', () => {
  test('new durable files appear only in the folders their routes own', () => {
    const created = files(vault.root).filter(p => !initial.has(p) && !p.startsWith('.reader/'));
    assert.ok(created.length >= 4, created.join(', '));
    const owned = /^(annotations|engagement|bookmarks|queues|history|themes|art|library\/notebook|logs\/llm)\//;
    for (const path of created) assert.match(path, owned, path);
  });
});
