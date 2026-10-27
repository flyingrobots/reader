// The packed artifact is what users get: build the tarball, install it into a fresh
// directory outside the checkout and run its bin from there. `npm test` builds dist first;
// --ignore-scripts keeps prepack from rewriting dist while the lock tests import it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('npm pack installs into a clean directory and its bin runs', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'reader-pack-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const checkout = await realpath(join(packageDir, '..'));
  assert.ok(!(dir + sep).startsWith(checkout + sep), 'install dir must be outside the checkout');
  const { version } = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));

  const packed = await run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], { cwd: packageDir });
  const [entry] = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')));
  const files = entry.files.map((file) => file.path).sort();
  assert.deepEqual(files, ['dist/cli.d.ts', 'dist/cli.js', 'dist/lock.d.ts', 'dist/lock.js', 'package.json']);
  t.diagnostic(`tarball ${entry.filename}: ${entry.size} bytes packed, ${entry.unpackedSize} unpacked`);

  const app = join(dir, 'app');
  await run(npm, ['install', '--prefix', app, '--no-audit', '--no-fund', '--ignore-scripts', '--offline', join(dir, entry.filename)], { cwd: dir });
  const bin = join(app, 'node_modules', '.bin', 'reader-ts');
  const { stdout } = await run(bin, ['--version'], { cwd: dir });
  assert.equal(stdout, `reader-ts ${version}\n`);
  await assert.rejects(run(bin, ['--bogus'], { cwd: dir }), (error) => error.code === 2);

  // The installed library entry point resolves and exposes the lock adapter.
  const { stdout: mechanism } = await run(process.execPath, ['--input-type=module', '-e',
    "import { defaultLockAdapter } from 'reader-library/lock'; console.log(defaultLockAdapter().mechanism)"], { cwd: app });
  assert.match(mechanism, /^flock\(2\) via /);
});
