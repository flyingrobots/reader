// Golden response shapes for every read route the web UI uses, on the pinned demo vault.
// Shapes are recorded from the reference (Python) server; see harness.mjs for the format.
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {assertShape, makeVault, readJson, snapshot, startServer} from './harness.mjs';

const ESSAY = 'library/walden/thoreau/where-i-lived.md';      // art, readers, a shape, a standfirst
const SOLITUDE = 'library/walden/thoreau/solitude.md';        // highlights, inbound links
const LINKER = 'library/reading-room/solitude-twice.md';      // links to SOLITUDE
const EDITION = 'library/lantern/design/sync-design.md';      // a v1/v2 family with Git history
const PDF = 'library/lantern/reports/lantern-0.9-field-report.pdf';
const PNG = 'library/natural-history/darwin/darwin-diagram.png';

let vault, server, before_reads, chat;

before(async () => {
  vault = makeVault();
  before_reads = snapshot(vault.root);
  server = await startServer(vault);
  const name = readdirSync(join(vault.root, 'chats')).find(n => n.endsWith('.json'));
  chat = readJson(vault.root, 'chats/' + name);
});

after(async () => {
  await server?.stop();
  vault?.cleanup();
});

/** GET a route, check its status and record/compare its JSON shape. */
async function shape(name, path, query = {}, status = 200) {
  const response = await server.get(path, query);
  assert.equal(response.status, status, `${path}: ${response.text.slice(0, 300)}`);
  assert.match(response.headers['content-type'], /^application\/json/);
  assertShape(name, response.json);
  return response.json;
}

describe('library and documents', () => {
  test('GET /api/library: works, participants, metrics and the write token', async () => {
    const body = await shape('library', '/api/library');
    assert.equal(body.participant, 'You');
    assert.ok(body.works.length >= 30 && typeof body.token === 'string' && body.token.length >= 32);
  });
  test('GET /api/library for another participant', () => shape('library-participant', '/api/library', {participant: 'Archivist'}));
  test('GET /api/document', async () => {
    const body = await shape('document', '/api/document', {path: ESSAY});
    assert.equal(body.path, ESSAY);
    assert.match(body.sha256, /^[0-9a-f]{64}$/);
  });
  test('GET /api/document for a PDF', () => shape('document-pdf', '/api/document', {path: PDF}));
  test('GET /api/document for a missing path is 404', () => shape('error', '/api/document', {path: 'library/nowhere.md'}, 404));
  test('GET /api/file serves raw bytes with ranges', async () => {
    const whole = await server.get('/api/file', {path: PNG});
    assert.equal(whole.status, 200);
    assert.equal(whole.headers['content-type'], 'image/png');
    assert.equal(whole.headers['accept-ranges'], 'bytes');
    assert.equal(whole.buffer.subarray(1, 4).toString(), 'PNG');
    const part = await server.raw('GET', '/api/file?path=' + encodeURIComponent(PDF), {headers: {Range: 'bytes=0-3'}});
    assert.equal(part.status, 206);
    assert.equal(part.text, '%PDF');
    assert.match(part.headers['content-range'], /^bytes 0-3\/\d+$/);
    const text = await server.get('/api/file', {path: 'library/lantern/logs/sync-dry-run.log'});
    assert.equal(text.headers['content-type'], 'text/plain; charset=utf-8');
  });
  test('GET /api/readers', () => shape('readers', '/api/readers', {path: ESSAY}));
  test('GET /api/preview', () => shape('preview', '/api/preview', {path: SOLITUDE}));
  test('GET /api/standfirst', async () => {
    const body = await shape('standfirst', '/api/standfirst', {path: ESSAY});
    assert.equal(body.source, 'frontmatter');
  });
  test('GET /api/shape', () => shape('shape', '/api/shape', {path: ESSAY}));
  test('GET /api/next', () => shape('next', '/api/next', {path: ESSAY}));
  test('GET /api/issue', () => shape('issue', '/api/issue', {start: '2026-10-19', end: '2026-10-25'}));
});

describe('search', () => {
  test('GET /api/search fuzzy', () => shape('search-fuzzy', '/api/search', {q: 'solitude', mode: 'fuzzy'}));
  test('GET /api/search keyword', () => shape('search-keyword', '/api/search', {q: 'solitude', mode: 'keyword'}));
  test('GET /api/search/page words', () => shape('search-page-words', '/api/search/page', {q: 'solitude', mode: 'words'}));
  test('GET /api/search/page best with a project facet', async () => {
    const body = await shape('search-page-facet', '/api/search/page', {q: 'solitude', mode: 'best', project: 'Walden'});
    assert.deepEqual(body.filters.project, ['Walden']);
    assert.ok(body.works.every(w => w.projects.includes('Walden')));
  });
  test('GET /api/search/page refuses a non-numeric offset', () => shape('error', '/api/search/page', {q: 'x', offset: 'many'}, 400));
});

describe('annotations, engagement and links', () => {
  test('GET /api/discussion', async () => {
    const body = await shape('discussion', '/api/discussion', {path: SOLITUDE});
    assert.ok(body.threads.length >= 1);
  });
  test('GET /api/links', () => shape('links', '/api/links', {path: SOLITUDE}));
  test('GET /api/link-counts', () => shape('link-counts', '/api/link-counts'));
  test('GET /api/resolve', async () => {
    const body = await shape('resolve', '/api/resolve', {from: LINKER, target: '../walden/thoreau/solitude.md'});
    assert.equal(body.path, SOLITUDE);
  });
  test('GET /api/resolve-batch keeps order and reports per-target errors', async () => {
    const body = await shape('resolve-batch', '/api/resolve-batch', {from: LINKER, target: ['../walden/thoreau/solitude.md', 'nowhere.md']});
    assert.equal(body.results[0].path, SOLITUDE);
    assert.ok(body.results[1].error);
  });
  test('GET /api/embeds', () => shape('embeds', '/api/embeds', {from: ESSAY, target: 'solitude'}));
});

describe('editions, versions and changes', () => {
  test('GET /api/editions', () => shape('editions', '/api/editions', {path: EDITION}));
  test('GET /api/editions/diagnostics', () => shape('editions-diagnostics', '/api/editions/diagnostics'));
  test('GET /api/versions', () => shape('versions', '/api/versions', {path: EDITION}));
  test('GET /api/versions with hashes', () => shape('versions-hashes', '/api/versions', {path: EDITION, hashes: 1}));
  test('GET /api/version at a commit', async () => {
    const versions = (await server.get('/api/versions', {path: EDITION})).json;
    const commit = versions.history[EDITION][0].commit;
    await shape('version', '/api/version', {path: EDITION, commit});
  });
  test('GET /api/changes for a participant', () => shape('changes', '/api/changes', {path: EDITION}));
  test('GET /api/changes between two refs', async () => {  // covers: GET /api/changes?a&b
    const versions = (await server.get('/api/versions', {path: EDITION})).json;
    const old = versions.history[EDITION].at(-1).commit;
    await shape('changes-refs', '/api/changes', {a: `${EDITION}@${old}`, b: EDITION});
  });
});

describe('queue and history', () => {
  test('GET /api/queue', () => shape('queue', '/api/queue'));
  test('GET /api/history', () => shape('history', '/api/history'));
  test('GET /api/history finished', () => shape('history-finished', '/api/history', {filter: 'finished'}));
});

describe('chats, quizzes, prompts and writing', () => {
  test('GET /api/chats', () => shape('chats', '/api/chats', {path: chat.document_path}));
  test('GET /api/chat', async () => {
    const body = await shape('chat', '/api/chat', {id: chat.id});
    assert.equal(body.chat.id, chat.id);
  });
  test('GET /api/chat/raw', () => shape('chat-raw', '/api/chat/raw', {id: chat.id, turn: chat.messages.find(m => m.runtime).id}));
  test('GET /api/quiz', () => shape('quiz', '/api/quiz', {path: ESSAY}));
  test('GET /api/prompt', () => shape('prompt', '/api/prompt', {path: ESSAY}));
  test('GET /api/writing', () => shape('writing', '/api/writing'));
});

describe('coding jobs and LLM logs', () => {
  test('GET /api/jobs (no runs yet)', async () => {
    const body = await shape('jobs', '/api/jobs');
    assert.deepEqual(body.runs, []);
  });
  test('GET /api/jobs/actions for an article without prompt blocks', () => shape('jobs-actions', '/api/jobs/actions', {path: ESSAY}));
  test('GET /api/jobs/run, /events and /artifact refuse an unknown run', async () => {
    await shape('error', '/api/jobs/run', {id: 'no-such-run'}, 400);
    await shape('error', '/api/jobs/events', {id: 'no-such-run', after: 0}, 400);
    await shape('error', '/api/jobs/artifact', {id: 'no-such-run', name: 'prompt.txt'}, 400);
  });
  test('GET /api/jobs/stream refuses an unknown run', () => shape('error', '/api/jobs/stream', {id: 'no-such-run', after: 0}, 400));
  test('GET /api/repositories (none registered)', () => shape('repositories', '/api/repositories'));
  test('GET /api/logs, and /api/logs/run and /artifact refuse paths outside the archive', async () => {
    const page = await shape('logs', '/api/logs');
    assert.ok(page.kinds.includes('coding-job'));
    await shape('error', '/api/logs', {kind: 'no-such-kind'}, 400);
    await shape('error', '/api/logs/run', {path: '../outside'}, 400);
    await shape('error', '/api/logs/artifact', {path: '../outside', name: 'prompt.txt'}, 400);
  });
});

describe('art, themes and fonts', () => {
  test('GET /api/art', () => shape('art', '/api/art', {path: ESSAY}));
  test('GET /api/art/prompt', () => shape('art-prompt', '/api/art/prompt', {path: ESSAY}));
  test('GET /api/art/jobs', () => shape('art-jobs', '/api/art/jobs'));
  test('GET /api/art/still refuses a malformed version', () => shape('error', '/api/art/still', {path: ESSAY, edition: 'x', generation: 'y'}, 400));
  test('GET /api/themes', () => shape('themes', '/api/themes'));
  test('GET /api/fonts (from the vault catalogue, no network)', () => shape('fonts', '/api/fonts', {q: 'con'}));
  test('GET /fonts/<family>/<file> refuses an unknown font', async () => {
    const response = await server.get('/fonts/contract-serif/x.woff2');
    assert.equal(response.status, 400);
    assertShape('error', response.json);
  });
});

describe('companions, models, inbox, service and maintenance', () => {
  test('GET /api/health', async () => {
    const body = await shape('health', '/api/health');
    assert.equal(body.status, 'ok');
  });
  test('GET /api/service (not installed, local identity)', async () => {
    const body = await shape('service', '/api/service');
    assert.deepEqual(body.service, {installed: false});
    assert.equal(body.identity.via, 'local');
  });
  test('GET /api/maintenance', () => shape('maintenance', '/api/maintenance'));
  test('GET /api/companions', () => shape('companions', '/api/companions'));
  test('GET /api/companions?name=wide-md', () => shape('companions-one', '/api/companions', {name: 'wide-md'}));
  test('GET /api/companions/log', () => shape('companions-log', '/api/companions/log', {name: 'wide-md'}));
  test('GET /api/prose (Colorful unavailable)', async () => {
    const body = await shape('prose', '/api/prose');
    assert.equal(body.available, false);
  });
  test('GET /api/local-model (dead provider)', () => shape('local-model', '/api/local-model'));
  test('GET /api/inbox', () => shape('inbox', '/api/inbox'));
  test('GET /api/inbox/events', () => shape('inbox-events', '/api/inbox/events', {after: 0}));
  test('GET /api/speak/<id> refuses speech it did not submit', () => shape('error', '/api/speak/unknown-job', {}, 403));
});

describe('the page and its assets', () => {
  test('GET / serves the app shell', async () => {
    const page = await server.get('/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.match(page.text, /<script type="module" src="\/assets\/app\.mjs"><\/script>/);
  });
  test('GET /assets/* serves modules and the manifest', async () => {
    const app = await server.get('/assets/app.mjs');
    assert.equal(app.status, 200);
    assert.match(app.headers['content-type'], /javascript/);
    const manifest = await server.get('/assets/manifest.webmanifest');
    assert.equal(manifest.headers['content-type'], 'application/manifest+json');
    assert.equal((await server.get('/assets/no-such-file.js')).status, 404);
  });
});

describe('reads have no durable side effects', () => {
  test('nothing outside .reader/ changed after every read above', () => {
    // Runs last in this file (node:test keeps declaration order within a file).
    assert.deepEqual(snapshot(vault.root), before_reads);
  });
});
