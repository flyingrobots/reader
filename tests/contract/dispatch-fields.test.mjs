// Medium HTTP contract: #164 rejects malformed field sets before domain writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {files, makeVault, startServer} from './harness.mjs';

const DOC = 'library/walden/thoreau/solitude.md';
const ID = '00000000-0000-4000-8000-000000000001';
const EXTRA = 'private_field()';
// Public request fields, independently enumerated from the route contract.
const routes = [
  {path: '/api/annotations', selector: 'operation', actions: [
    ['list', {path: DOC}], ['create', {path: DOC, start: 0, end: 3, owner: 'You'}],
    ['reply', {thread_id: ID, author: 'You', body: 'A reply'}], ['resolve', {thread_id: ID, resolved: true}],
    ['attention', {participant: 'You'}], ['seen', {participant: 'You', items: []}],
  ]},
  {path: '/api/chat', selector: 'action', actions: [
    ['create', {path: DOC}], ['send', {id: ID, body: 'Hello'}], ['paste', {id: ID, body: 'A reply'}],
    ['cancel', {turn_id: ID}], ['retry', {id: ID, message_id: ID}],
    ['hand', {id: ID, message_id: ID, decision: 'decline'}], ['settings', {id: ID, chime_ins: 'off'}], ['hush', {id: ID}],
  ]},
  {path: '/api/quiz', selector: 'action', actions: [
    ['result', {path: DOC, edition: 'a'.repeat(64), quiz_id: ID, answers: {}, expected_sha256: 'a'.repeat(64)}],
  ], extraActions: [['generate', {path: DOC}], ['review', {path: DOC}]]},
];

const durable = root => Object.fromEntries(files(root).filter(path => !path.startsWith('.reader/')).map(path =>
  [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));

async function fixture(t, options = {}) {
  const vault = makeVault();
  let server;
  t.after(async () => {await server?.stop(); vault.cleanup();});
  server = await startServer(vault, options);
  return {vault, server};
}

async function accepted(server, route, body) {
  const response = await server.post(route, body);
  assert.equal(response.status, 200, response.text);
  return response.json;
}

test('annotation dispatch preserves optional fields, defaults and source bytes', async t => {
  const {server, vault} = await fixture(t);
  const source = readFileSync(join(vault.root, DOC));
  const post = body => accepted(server, '/api/annotations', body);
  const made = await post({operation: 'create', path: DOC, start: 0, end: 3, owner: 'You', request_id: ID,
    comment: 'A warning', kind: 'warning', expected_sha256: createHash('sha256').update(source).digest('hex')});
  assert.equal(made.kind, 'warning');
  const reply = await post({operation: 'reply', thread_id: made.id, author: 'You', body: 'A reply',
    reply_to: made.comments[0].id, request_id: ID.replace(/1$/, '2')});
  assert.equal(reply.comments.at(-1).reply_to, made.comments[0].id);
  const resolved = await post({operation: 'resolve', thread_id: made.id, resolved: true, expected_revision: reply.revision});
  assert.equal(resolved.resolved, true);
  assert.ok((await post({operation: 'list', path: DOC})).threads.some(thread => thread.id === made.id));
  const attention = await post({operation: 'attention', participant: 'You', path: DOC, offset: 0, limit: 100});
  const items = [attention.items[0]];
  assert.equal((await post({operation: 'seen', participant: 'You', items, read: false})).read, false);
  assert.equal((await post({operation: 'seen', participant: 'You', items})).read, true);
  const minimal = await post({operation: 'create', path: DOC, start: 0, end: 3, owner: 'You'});
  assert.equal(minimal.kind, 'highlight');
  assert.equal(minimal.initial_comment, '');
  assert.deepEqual(readFileSync(join(vault.root, DOC)), source);
});

test('chat dispatch preserves the server participant, optional author and reuse behavior', async t => {
  const {server} = await fixture(t, {participant: 'Server reader'});
  const post = body => accepted(server, '/api/chat', body);
  const minimal = await post({action: 'create', path: DOC});
  assert.equal(minimal.chat.started_by, 'Server reader');
  const explicit = await post({action: 'create', path: DOC, request_id: ID, author: 'Named reader', reuse: false});
  assert.equal(explicit.chat.id, ID);
  assert.equal(explicit.chat.started_by, 'Named reader');
  // Reuse on a separate document avoids equal-clock ordering between the two creations above.
  const other = 'library/walden/thoreau/where-i-lived.md';
  const first = await post({action: 'create', path: other});
  assert.equal((await post({action: 'create', path: other, request_id: ID.replace(/1$/, '3'), reuse: true})).chat.id, first.chat.id);
  assert.equal((await post({action: 'settings', id: minimal.chat.id, chime_ins: 'off'})).chat.settings.chime_ins, 'off');
  assert.equal((await post({action: 'hush', id: minimal.chat.id})).ok, true);
});

async function refused(server, vault, route, body) {
  const before = durable(vault.root);
  const response = await server.post(route, body);
  assert.deepEqual(durable(vault.root), before, 'a rejected field set changes no durable file');
  assert.equal(response.status, 400, `${route}: ${JSON.stringify(body)}: ${response.text}`);
  assert.deepEqual(Object.keys(response.json), ['error']);
  assert.equal(typeof response.json.error, 'string');
  assert.doesNotMatch(response.json.error, /\(\)|positional argument|keyword argument|unhashable type|has no attribute/,
    'field errors contain no Python invocation details or echoed arbitrary identifiers');
  return response.json.error;
}

for (const route of routes) {
  test(`${route.path} rejects every missing required field with plain guidance and no writes`, async t => {
    const {server, vault} = await fixture(t);
    let witnesses = 0;
    for (const [action, fields] of route.actions) {
      for (const missing of Object.keys(fields)) {
        const body = {[route.selector]: action, ...fields};
        delete body[missing];
        const message = await refused(server, vault, route.path, body);
        assert.match(message, new RegExp(`\\b${missing}\\b`), 'guidance names the omitted public field');
        witnesses++;
      }
    }
    assert.equal(witnesses, route.actions.reduce((sum, [, fields]) => sum + Object.keys(fields).length, 0));
    assert.ok(witnesses > 0);
  });

  test(`${route.path} rejects extra fields deterministically without echoing them or writing`, async t => {
    const {server, vault} = await fixture(t);
    for (const [action, fields] of [...route.actions, ...(route.extraActions || [])]) {
      const body = {[route.selector]: action, ...fields, [EXTRA]: true};
      const message = await refused(server, vault, route.path, body);
      assert.match(message, /fields/i, 'guidance identifies the field-set contract');
      assert.ok(!message.includes(EXTRA));
      const reordered = Object.fromEntries(Object.entries(body).reverse());
      assert.equal(await refused(server, vault, route.path, reordered), message, 'JSON key order does not alter guidance');
    }
  });

  test(`${route.path} refuses missing, unknown and non-string selectors without Python details`, async t => {
    const {server, vault} = await fixture(t);
    for (const selector of [undefined, null, [], {}, 7, 'private_selector()']) {
      const body = selector === undefined ? {} : {[route.selector]: selector};
      const message = await refused(server, vault, route.path, body);
      assert.match(message, new RegExp(route.selector), 'guidance names action or operation');
    }
  });
}
