import {writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function writeSettings(path, settings) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2), {flag: 'wx', mode: 0o600});
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
