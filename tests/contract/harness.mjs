// Language-neutral harness for the Reader contract suite (D1: the TypeScript port's gate).
//
// The suite talks to "the implementation under test" only through processes, HTTP, stdio and
// files on disk. Three commands name it; each is a JSON array of argv or a whitespace-separated
// string, and defaults to the Python implementation in this checkout:
//
//   READER_SERVER_CMD   run as `<cmd> --root VAULT web --port 0 --participant NAME`; must bind
//                       127.0.0.1 and print a line containing http://127.0.0.1:PORT on stdout.
//   READER_CLI_CMD      run as `<cmd> --root VAULT <subcommand> ...` (the `reader` CLI).
//   READER_MCP_CMD      run as `<cmd> --root VAULT serve [--inline-only]` (MCP over stdio).
//
// READER_FIXTURE_CMD builds each synthetic vault (`<cmd> DIR`); it defaults to the reference
// generator tests/contract/fixtures/build_vault.py (the demo vault pinned to 2026-10-21 12:00 UTC).
// READER_PYTHON picks the interpreter for the defaults. READER_CONTRACT_UPDATE=1 rewrites the
// golden shapes in tests/contract/golden/ instead of comparing against them.
//
// Read-only harness rules: every vault is a fresh synthetic one under the OS temp folder carrying
// the `.reader-contract-vault` marker, and assertSynthetic() refuses anything else, so the suite can
// never be pointed at a real library. Children get a scrubbed environment: a temporary HOME, a
// minimal PATH, no READER_ROOT or GIT_LOCKS_STORE, dead model/speech endpoints, no agent CLI
// search folders and git-locks disabled. Only the demo's scripted voices (no AI) ever run.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../..');
export const CLOCK = '2026-10-21T12:00:00Z';
export const TODAY = '2026-10-21';
export const PARTICIPANT = 'You';
const MARKER = '.reader-contract-vault';
const GOLDEN = join(HERE, 'golden');

function python() {
  if (process.env.READER_PYTHON) return process.env.READER_PYTHON;
  const local = join(REPO, '.venv/bin/python');
  return existsSync(local) ? local : 'python3';
}

function command(name, fallback) {
  const raw = process.env[name];
  if (!raw) return {argv: fallback, reference: true};
  return {argv: raw.trim().startsWith('[') ? JSON.parse(raw) : raw.trim().split(/\s+/), reference: false};
}

export const SERVER = command('READER_SERVER_CMD', [python(), '-m', 'reader_mcp.cli']);
export const CLI = command('READER_CLI_CMD', [python(), '-m', 'reader_mcp.cli']);
export const MCP = command('READER_MCP_CMD', [python(), '-m', 'reader_mcp.cli']);
export const FIXTURE = command('READER_FIXTURE_CMD', [python(), join(HERE, 'fixtures/build_vault.py')]);

// ---------------------------------------------------------------------------------------- vaults

const scratch = () => realpathSync(tmpdir());

/** Refuse any vault that is not one this suite built (the read-only harness rule). */
export function assertSynthetic(root) {
  const real = realpathSync(root);
  const base = scratch();
  if (!real.startsWith(base + sep) || !existsSync(join(real, MARKER)) || !existsSync(join(real, '.reader-demo-vault'))) {
    throw new Error(`Refusing a vault the contract suite did not build: ${root}`);
  }
  return real;
}

/** A fresh synthetic vault: the pinned demo, plus the suite's marker and dead local-model provider. */
export function makeVault() {
  const box = mkdtempSync(join(scratch(), 'reader-contract-'));
  const root = join(box, 'vault');
  const home = join(box, 'home');
  mkdirSync(home);
  mkdirSync(join(box, 'tmp'));
  const env = sandbox(box, FIXTURE.reference ? {PYTHONPATH: join(REPO, 'src')} : {});
  const done = spawnSync(FIXTURE.argv[0], [...FIXTURE.argv.slice(1), root], {env, cwd: box, encoding: 'utf8', timeout: 120000});
  if (done.status !== 0) throw new Error(`fixture build failed (${done.status}): ${done.stderr || done.error}`);
  writeFileSync(join(root, MARKER), 'Synthetic vault built by tests/contract; safe to delete.\n');
  // A local-model provider on a port nothing listens on: status probes fail fast and never reach a real server.
  mkdirSync(join(root, '.reader/local-model'), {recursive: true});
  writeFileSync(join(root, '.reader/local-model/settings.json'),
    JSON.stringify({provider: {preset: 'lmstudio', base_url: 'http://127.0.0.1:9/v1', model: 'contract-model', allow_remote: false}}));
  // A fresh font catalogue so /api/fonts never fetches Google Fonts.
  mkdirSync(join(root, 'themes/fonts'), {recursive: true});
  writeFileSync(join(root, 'themes/fonts/.catalog.json'),
    JSON.stringify([{family: 'Contract Serif', category: 'serif', axes: [], styles: ['400'], subsets: ['latin'], popularity: 1}]));
  return {root: assertSynthetic(root), box, home, cleanup: () => rmSync(box, {recursive: true, force: true})};
}

/** The scrubbed child environment (see the header). */
export function sandbox(box, extra = {}) {
  const dead = join(box, 'nothing-here');
  return {
    HOME: join(box, 'home'), TMPDIR: join(box, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', READER_TEST_CLOCK: CLOCK,
    READER_CLI_CANDIDATES: '', READER_GIT_LOCKS: 'none', READER_GIT_LOCKS_CANDIDATES: '',
    READER_LMS: join(dead, 'lms'), READER_LMSTUDIO_URL: 'http://127.0.0.1:9/v1', READER_CODEX: join(dead, 'codex'),
    READER_COLORFUL: join(dead, 'colorful'), AI_TTS_HOME: join(dead, 'ai-tts'), AI_TTS_SOCKET: join(dead, 'ai-tts.sock'),
    READER_LAUNCHCTL: '/usr/bin/false', READER_SERVICE_LAUNCHCTL: '/usr/bin/false', READER_SERVICE_TAILSCALE: '/usr/bin/false',
    READER_SERVICE_GIT_LOCKS: '/usr/bin/false',
    ...extra,
  };
}

function referenceEnv(cmd) {
  return cmd.reference ? {PYTHONPATH: join(REPO, 'src')} : {};
}

// ---------------------------------------------------------------------------------------- server

/** Start the server under test on a synthetic vault. Returns a client bound to it. */
export async function startServer(vault, {participant = PARTICIPANT, env = {}} = {}) {
  assertSynthetic(vault.root);
  const child = spawn(SERVER.argv[0], [...SERVER.argv.slice(1), '--root', vault.root, 'web', '--port', '0', '--participant', participant],
    {env: sandbox(vault.box, {...referenceEnv(SERVER), ...env}), cwd: vault.box, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  const port = await new Promise((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error('server did not announce its URL within 30 s: ' + stderr)), 30000);
    child.stdout.on('data', d => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); ok(Number(m[1])); }
    });
    child.on('exit', code => { clearTimeout(timer); fail(new Error(`server exited (${code}) before announcing: ${stderr}`)); });
  });
  child.stdout.resume();
  const server = new Client(port);
  server.child = child;
  server.vault = vault;
  server.stop = async () => {
    if (child.exitCode !== null) return;
    const gone = new Promise(ok => child.once('exit', ok));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000);
    await gone;
    clearTimeout(timer);
  };
  return server;
}

export class Client {
  constructor(port) {
    this.port = port;
    this.host = `127.0.0.1:${port}`;
    this.origin = `http://127.0.0.1:${port}`;
    this.token = null;
  }

  /** One HTTP exchange with full control of headers (Host, Origin, proxy headers). */
  raw(method, path, {headers = {}, body, timeout = 20000} = {}) {
    return new Promise((ok, fail) => {
      const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const request = http.request({host: '127.0.0.1', port: this.port, method, path, agent: false,
        headers: {Host: this.host, ...(data ? {'Content-Length': data.length} : {}), ...headers}}, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          ok({status: response.statusCode, headers: response.headers, buffer, text, json});
        });
      });
      request.setTimeout(timeout, () => request.destroy(new Error(`timeout: ${method} ${path}`)));
      request.on('error', fail);
      if (data) request.write(data);
      request.end();
    });
  }

  async get(path, query = {}, options = {}) {
    return this.raw('GET', path + qs(query), options);
  }

  async ensureToken() {
    if (!this.token) {
      const library = await this.get('/api/library');
      assert.equal(library.status, 200, library.text);
      this.token = library.json.token;
    }
    return this.token;
  }

  /** A same-origin JSON write with the per-process token. */
  async post(path, body, {headers = {}, token} = {}) {
    const value = token === undefined ? await this.ensureToken() : token;
    return this.raw('POST', path, {body, headers: {'Content-Type': 'application/json', ...(value === null ? {} : {'X-Reader-Token': value}), ...headers}});
  }

  /** Open a Server-Sent Events stream; resolves once headers arrive. */
  stream(path, query = {}, headers = {}) {
    return new Promise((ok, fail) => {
      const request = http.request({host: '127.0.0.1', port: this.port, method: 'GET', path: path + qs(query), agent: false,
        headers: {Host: this.host, Accept: 'text/event-stream', ...headers}}, response => {
        const events = [];
        const waiters = [];
        let buffer = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          buffer += chunk;
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const event = {event: 'message', data: '', id: null};
            for (const line of block.split('\n')) {
              const [field, ...rest] = line.split(':');
              const value = rest.join(':').replace(/^ /, '');
              if (field === 'event') event.event = value;
              else if (field === 'data') event.data += value;
              else if (field === 'id') event.id = value;
            }
            try { event.json = JSON.parse(event.data); } catch { event.json = undefined; }
            events.push(event);
            for (const w of [...waiters]) w();
          }
        });
        const handle = {
          status: response.statusCode, headers: response.headers, events, response, request,
          /** Wait for an event matching `match` (a name or predicate). */
          next(match, timeout = 20000) {
            const test = typeof match === 'function' ? match : e => e.event === match;
            return new Promise((done, failed) => {
              const look = () => {
                const found = events.find(test);
                if (found) { cleanup(); done(found); }
              };
              const timer = setTimeout(() => { cleanup(); failed(new Error(`no ${typeof match === 'string' ? match : 'matching'} event in ${timeout} ms; saw ${events.map(e => e.event)}`)); }, timeout);
              const cleanup = () => { clearTimeout(timer); const i = waiters.indexOf(look); if (i >= 0) waiters.splice(i, 1); };
              waiters.push(look);
              look();
            });
          },
          close() { request.destroy(); },
          text: () => new Promise(done => { let t = ''; response.on('data', c => { t += c; }); response.on('end', () => done(t)); }),
        };
        ok(handle);
      });
      request.on('error', fail);
      request.end();
    });
  }
}

export function qs(query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined && item !== null) params.append(k, String(item));
  }
  const s = params.toString();
  return s ? '?' + s : '';
}

// ---------------------------------------------------------------------------------------- CLI and MCP

/** Run the CLI under test: `<cmd> --root VAULT ...args`. */
export function cli(vault, args, {input, root = true, timeout = 60000} = {}) {
  if (root) assertSynthetic(vault.root);
  const argv = [...CLI.argv.slice(1), ...(root ? ['--root', vault.root] : []), ...args];
  const done = spawnSync(CLI.argv[0], argv, {env: sandbox(vault.box, referenceEnv(CLI)), cwd: vault.box, input, encoding: 'utf8', timeout});
  let json;
  try { json = JSON.parse(done.stdout); } catch { json = undefined; }
  return {status: done.status, stdout: done.stdout, stderr: done.stderr, json};
}

/** A minimal MCP stdio client (JSON-RPC 2.0, newline-delimited). */
export async function mcp(vault, extra = []) {
  assertSynthetic(vault.root);
  const child = spawn(MCP.argv[0], [...MCP.argv.slice(1), '--root', vault.root, 'serve', ...extra],
    {env: sandbox(vault.box, referenceEnv(MCP)), cwd: vault.box, stdio: ['pipe', 'pipe', 'pipe']});
  let buffer = '';
  let seq = 0;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  child.stderr.resume();
  const call = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++seq;
    const timer = setTimeout(() => fail(new Error(`MCP ${method} timed out`)), 30000);
    pending.set(id, message => { clearTimeout(timer); ok(message); });
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
  const init = await call('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'reader-contract', version: '1'}});
  child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
  return {
    init, call,
    tool: async (name, args) => (await call('tools/call', {name, arguments: args})).result,
    close: () => new Promise(ok => { child.once('exit', ok); child.stdin.end(); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }),
  };
}

// ---------------------------------------------------------------------------------------- shapes

const FORMATS = [
  ['datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/],
  ['sha256', /^[0-9a-f]{64}$/],
  ['sha1', /^[0-9a-f]{40}$/],
];
// Keys that are data (paths, ids, dates, names, labels) rather than field names (lower-case identifiers).
const DYNAMIC_KEY = /\/|:|\s|^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{40,64}$|^\d|^[^a-z_$]/;

/**
 * A JSON-schema-ish shape: primitives as type names (strings carry a detected format such as
 * string:datetime), {object: {key: shape}} with `key?` for keys some elements lack, {map: shape}
 * for objects keyed by data (paths, ids, dates, names: every key not a lower-case identifier), {array: shape} (elements merged, so order never matters)
 * and {anyOf: [...]} for mixed types. Values (timestamps, ids, text, counts) never appear.
 */
export function shapeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return {array: value.length ? value.map(shapeOf).reduce(merge) : 'empty'};
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length && keys.every(k => DYNAMIC_KEY.test(k))) return {map: keys.map(k => shapeOf(value[k])).reduce(merge)};
    return {object: Object.fromEntries(keys.sort().map(k => [k, shapeOf(value[k])]))};
  }
  if (typeof value === 'string') {
    const format = FORMATS.find(([, re]) => re.test(value));
    return format ? 'string:' + format[0] : 'string';
  }
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function variants(s) {
  return s && typeof s === 'object' && s.anyOf ? s.anyOf : [s];
}

function kind(s) {
  if (typeof s === 'string') return s.startsWith('string') ? 'string' : s === 'integer' ? 'number' : s;
  return Object.keys(s)[0];
}

function merge(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const out = [];
  for (const v of [...variants(a), ...variants(b)]) {
    const i = out.findIndex(o => kind(o) === kind(v));
    if (i < 0) { out.push(v); continue; }
    out[i] = mergeSame(out[i], v);
  }
  out.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  return out.length === 1 ? out[0] : {anyOf: out};
}

function mergeSame(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  if (typeof a === 'string') return kind(a) === 'number' ? 'number' : 'string';
  if (a.array !== undefined) return {array: a.array === 'empty' ? b.array : b.array === 'empty' ? a.array : merge(a.array, b.array)};
  if (a.map !== undefined) return {map: merge(a.map, b.map)};
  const keys = new Set([...Object.keys(a.object), ...Object.keys(b.object)].map(k => k.replace(/\?$/, '')));
  const object = {};
  for (const key of [...keys].sort()) {
    const left = a.object[key] ?? a.object[key + '?'];
    const right = b.object[key] ?? b.object[key + '?'];
    const optional = left === undefined || right === undefined || (key + '?') in a.object || (key + '?') in b.object;
    object[optional ? key + '?' : key] = left === undefined ? right : right === undefined ? left : merge(left, right);
  }
  return {object};
}

/** Compare a value's shape with tests/contract/golden/NAME.json (or record it under READER_CONTRACT_UPDATE=1). */
export function assertShape(name, value) {
  const file = join(GOLDEN, name + '.json');
  const shape = shapeOf(value);
  const text = JSON.stringify(shape, null, 1) + '\n';
  if (process.env.READER_CONTRACT_UPDATE === '1') {
    mkdirSync(GOLDEN, {recursive: true});
    writeFileSync(file, text);
    return;
  }
  assert.ok(existsSync(file), `missing golden ${relative(REPO, file)}; record it with READER_CONTRACT_UPDATE=1 against the reference server`);
  assert.deepEqual(shape, JSON.parse(readFileSync(file, 'utf8')), `shape of ${name} differs from ${relative(REPO, file)}`);
}

// ---------------------------------------------------------------------------------------- vault files

/** Every file under `dir` (vault-relative), skipping .git. */
export function files(root, dir = '') {
  const out = [];
  const base = join(root, dir);
  if (!existsSync(base)) return out;
  for (const name of readdirSync(base)) {
    const rel = dir ? `${dir}/${name}` : name;
    if (rel === '.git') continue;
    const info = statSync(join(root, rel));
    if (info.isDirectory()) out.push(...files(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

/** {path: size:mtime} for durable vault files (everything outside .reader/ and .git/). */
export function snapshot(root) {
  return Object.fromEntries(files(root).filter(p => !p.startsWith('.reader/')).map(p => {
    const s = statSync(join(root, p));
    return [p, `${s.size}:${s.mtimeMs}`];
  }));
}

export function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

export function sleep(ms) {
  return new Promise(ok => setTimeout(ok, ms));
}

/** Retry `fn` until it returns a truthy value or `timeout` passes. */
export async function until(fn, timeout = 15000, step = 100) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(step);
  }
  throw new Error('condition not met in time; last value: ' + JSON.stringify(last)?.slice(0, 400));
}
