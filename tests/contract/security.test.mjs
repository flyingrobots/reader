// Security contract: identity (Host/Origin/proxy), CSRF token and JSON-only writes, body limits,
// path traversal and symlink refusals, response headers, and the harness's own read-only rules.
import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertShape, assertSynthetic, makeVault, startServer} from './harness.mjs';

const DOC = 'library/walden/thoreau/solitude.md';
const PNG = 'library/natural-history/darwin/darwin-diagram.png';
const TAILNET = 'reader-host.example-tailnet.invalid';
let vault, server, errors = [];

before(async () => {
  vault = makeVault();
  server = await startServer(vault);
});

after(async () => {
  await server?.stop();
  vault?.cleanup();
});

function refused(response, status = 403) {
  assert.equal(response.status, status, response.text.slice(0, 200));
  if (response.json) errors.push(response.json.error);
  return response;
}

const tailnet = (login = 'user@example.com', extra = {}) => ({
  Host: TAILNET, 'X-Forwarded-Host': TAILNET, 'X-Forwarded-For': '100.64.0.2', 'X-Forwarded-Proto': 'https',
  ...(login === null ? {} : {'Tailscale-User-Login': login}), 'Tailscale-User-Name': 'A Tester', ...extra,
});

describe('identity: Host, Origin and proxies', () => {
  test('an unexpected Host is refused: JSON under /api/, an HTML page elsewhere', async () => {
    const api = refused(await server.raw('GET', '/api/library', {headers: {Host: 'untrusted.example'}}));
    assertShape('error', api.json);
    assert.equal(api.json.error, 'Unexpected Host');
    const page = refused(await server.raw('GET', '/', {headers: {Host: 'untrusted.example'}}));
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.doesNotMatch(page.text, /app\.mjs/);
  });
  test('localhost:<port> is the same local origin as 127.0.0.1:<port>', async () => {
    assert.equal((await server.raw('GET', '/api/health', {headers: {Host: `localhost:${server.port}`}})).status, 200);
    assert.equal((await server.raw('GET', '/api/health', {headers: {Origin: `http://localhost:${server.port}`}})).status, 200);
  });
  test('a cross-origin request is refused, reads and writes alike', async () => {
    refused(await server.raw('GET', '/api/library', {headers: {Origin: 'https://untrusted.example'}}));
    refused(await server.post('/api/seen', await receipt(), {headers: {Origin: 'https://untrusted.example'}}));
    refused(await server.raw('GET', '/api/library', {headers: {Origin: `http://127.0.0.1:${server.port + 1}`}}));
  });
  test('any forwarding or Tailscale header makes a request proxied, refused without a trusted proxy', async () => {
    refused(await server.raw('GET', '/api/library', {headers: tailnet()}));
    refused(await server.raw('GET', '/api/library', {headers: {'X-Forwarded-For': '10.0.0.1'}}));
    // An identity header on a loopback Host never grants anything.
    refused(await server.raw('GET', '/api/service', {headers: {'Tailscale-User-Login': 'user@example.com'}}));
  });
  test('client-sent front headers never grant an identity', async () => {
    // Only the trusted front may set these; a front must replace them, and a server without one ignores them.
    const claimed = JSON.stringify({via: 'tailscale', login: 'user@example.com', name: 'A Tester'});
    const response = await server.raw('GET', '/api/service', {headers: {'X-Reader-Identity': claimed, 'X-Reader-Front-Secret': 'guess'}});
    assert.equal(response.status, 200, response.text.slice(0, 200));
    assert.deepEqual(response.json.identity, {via: 'local', login: null, name: null});
  });
  test('with the tailscale proxy configured, only listed logins on listed hosts pass, never Funnel', async () => {
    mkdirSync(join(vault.root, '.reader'), {recursive: true});
    const config = join(vault.root, '.reader/web-config.json');
    writeFileSync(config, JSON.stringify({trusted_proxy: 'tailscale', allowed_hosts: [TAILNET], allowed_logins: ['user@example.com'],
      allowed_origins: ['https://' + TAILNET]}));
    try {
      const ok = await server.raw('GET', '/api/service', {headers: tailnet()});
      assert.equal(ok.status, 200, ok.text);
      assert.deepEqual(ok.json.identity, {via: 'tailscale', login: 'user@example.com', name: 'A Tester'});
      assert.equal((await server.raw('GET', '/api/library', {headers: tailnet('USER@example.com')})).status, 200);
      for (const login of [null, '', 'someone@example.net']) {
        const page = refused(await server.raw('GET', '/', {headers: tailnet(login)}));
        assert.match(page.text, /Not allowed/);
        refused(await server.raw('GET', '/api/library', {headers: tailnet(login)}));
      }
      refused(await server.raw('GET', '/api/library', {headers: tailnet('user@example.com', {'Tailscale-Funnel-Request': '?1'})}));
      refused(await server.raw('GET', '/api/library', {headers: tailnet('user@example.com', {'X-Forwarded-Host': 'other.example.invalid'})}));
      // The tailnet origin is accepted for a write; any other origin is not.
      const token = (await server.raw('GET', '/api/library', {headers: tailnet()})).json.token;
      const body = await receipt();
      const write = headers => server.raw('POST', '/api/seen', {body,
        headers: {...tailnet(), 'Content-Type': 'application/json', 'X-Reader-Token': token, ...headers}});
      assert.equal((await write({Origin: 'https://' + TAILNET})).status, 200);
      refused(await write({Origin: 'http://' + TAILNET}));
      // A broken config refuses proxied requests but never locks out the local user.
      writeFileSync(config, '{not json');
      refused(await server.raw('GET', '/api/library', {headers: tailnet()}));
      assert.equal((await server.get('/api/library')).status, 200);
    } finally {
      writeFileSync(config, '{}');
    }
  });
});

async function receipt() {
  const doc = (await server.get('/api/document', {path: DOC})).json;
  return {participant: 'You', items: [doc.item]};
}

describe('writes: token, JSON and body limits', () => {
  test('a write without the token, with a wrong token or not as JSON is refused', async () => {
    const body = await receipt();
    refused(await server.post('/api/seen', body, {token: null}));
    refused(await server.post('/api/seen', body, {token: 'not-the-token'}));
    refused(await server.post('/api/seen', body, {headers: {'Content-Type': 'text/plain'}}));
    const ok = await server.post('/api/seen', body);
    assert.equal(ok.status, 200, ok.text);
  });
  test('an empty, oversized or non-object body is a 400', async () => {
    const token = await server.ensureToken();
    const headers = {'Content-Type': 'application/json', 'X-Reader-Token': token};
    refused(await server.raw('POST', '/api/seen', {headers, body: ''}), 400);
    refused(await server.raw('POST', '/api/seen', {headers, body: JSON.stringify({pad: 'x'.repeat(130 * 1024)})}), 400);
    refused(await server.raw('POST', '/api/seen', {headers, body: '[1, 2]'}), 400);
    refused(await server.raw('POST', '/api/seen', {headers, body: '{broken'}), 400);
  });
  test('an unknown write route is a 404 and an unknown read route is a 404', async () => {
    refused(await server.post('/api/no-such-route', {}), 404);
    refused(await server.get('/api/no-such-route'), 404);
  });
});

describe('paths: traversal, hidden files and symlinks', () => {
  test('document paths outside the library or not normalized are refused', async () => {
    // Sent as written: %2e%2e is a percent-encoded `..` the server must decode and still refuse.
    for (const path of ['../outside', 'library/../outside', '/etc/passwd', 'library/.hidden', 'library//' + DOC.slice(8), 'library/%2e%2e/outside', '.git/config', '.reader/web-config.json']) {
      refused(await server.raw('GET', '/api/document?path=' + path), 400);
    }
    refused(await server.get('/api/document', {path: 'library/walden'}), 400);
  });
  test('raw files refuse traversal and symlinks', async () => {
    symlinkSync(join(vault.root, DOC), join(vault.root, 'library/link.md'));
    refused(await server.get('/api/file', {path: 'library/link.md'}), 400);
    refused(await server.get('/api/file', {path: '../vault/' + DOC}), 400);
    refused(await server.get('/api/file', {path: '.git/HEAD'}), 400);
  });
  test('static assets never leave the web folder', async () => {
    refused(await server.raw('GET', '/assets/../../pyproject.toml'), 404);
    refused(await server.raw('GET', '/assets/%2e%2e/%2e%2e/pyproject.toml'), 404);
  });
  test('font files take only a slug and a known file name', async () => {
    refused(await server.raw('GET', '/fonts/..%2f..%2f/x.woff2'), 400);
    refused(await server.raw('GET', '/fonts/a/../../etc'), 404);
  });
  test('a range outside the file is a 416', async () => {
    const response = await server.raw('GET', '/api/file?path=' + encodeURIComponent(PNG), {headers: {Range: 'bytes=99999999-'}});
    refused(response, 416);
  });
});

describe('response headers', () => {
  test('JSON and pages carry nosniff, no-store, no-referrer and the app CSP', async () => {
    for (const path of ['/api/library', '/']) {
      const response = await server.get(path);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      const csp = response.headers['content-security-policy'];
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /frame-ancestors 'self'/);
      assert.match(csp, /object-src 'none'/);
    }
  });
  test('raw vault files are sandboxed', async () => {
    const response = await server.get('/api/file', {path: DOC});
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.match(response.headers['content-security-policy'], /^default-src 'none'; sandbox/);
  });
  test('no error message names the vault or home folder (#105)', () => {
    assert.ok(errors.length > 10);
    for (const message of errors) {
      assert.ok(!message.includes(vault.root) && !message.includes(vault.box), message);
    }
  });
});

describe('the harness itself', () => {
  test('refuses to run against a vault it did not build', () => {
    assert.throws(() => assertSynthetic(vault.box), /did not build/);
    assert.throws(() => assertSynthetic('/'), /did not build/);
    assert.equal(assertSynthetic(vault.root), vault.root);
  });
});
