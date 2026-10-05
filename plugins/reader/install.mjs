import { readFile, mkdir, copyFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {writeSettings} from './settings.mjs';
const project = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw new Error('Pass the private vault path: npm run install:vault -- /path/to/vault');
const vault = resolve(process.argv[2]);
const code = resolve(project, '../..');
if (vault === code) throw new Error('The code checkout must not be used as the private vault');
const manifest = JSON.parse(await readFile(join(project, 'dist/manifest.json'), 'utf8'));
if (manifest.id !== 'reader') throw new Error('Unexpected plugin identity');
const config = join(vault, '.obsidian');
if (!(await lstat(config)).isDirectory()) throw new Error('Expected an existing Obsidian vault');
const dest = join(config, 'plugins', manifest.id);
for (const path of [join(config, 'plugins'), dest]) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(dest, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const path = join(dest, name);
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await copyFile(join(project, 'dist', name), path);
}
console.log(`Installed Reader ${manifest.version} in ${dest}. Enable Reader in Community plugins.`);

const settingsPath = join(dest, 'data.json');
let settings = {};
try {
  if ((await lstat(settingsPath)).isSymbolicLink()) throw new Error('Refusing symlink settings');
  settings = JSON.parse(await readFile(settingsPath, 'utf8'));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeSettings(settingsPath, {...settings, backendRoot: code});
