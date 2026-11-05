import { readFile, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type InboxRun = { run_id?: string; status: string; supervisor_pid?: number; message: string };
export type InboxCoordination = { run?: InboxRun; claims: string[]; errors: string[]; pending?: boolean };

/** Arrivals wait in .reader/inbox/, which Obsidian doesn't index. Returned with their logical inbox/ paths; never follows a symlink. */
export async function hiddenInboxFiles(base: string, limit = 10000): Promise<string[]> {
  const found: string[] = [];
  const walk = async (folder: string, logical: string) => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (found.length >= limit) return;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) await walk(join(folder, entry.name), logical + '/' + entry.name);
      else if (entry.isFile()) found.push(logical + '/' + entry.name);
    }
  };
  await walk(join(base, '.reader/inbox'), 'inbox');
  return found;
}

/** Completed-run snapshots do not describe the current inbox after later filing. */
export function currentInboxRunMessage(run?: InboxRun): string {
  return run && ['starting', 'running', 'interrupted'].includes(run.status) ? run.message : '';
}

/** Read reservations as well as runner state; a reservation does not prove a worker is alive. */
export async function readInboxCoordination(base: string): Promise<InboxCoordination> {
  const result: InboxCoordination = { claims: [], errors: [] };
  for (const name of ['pending.json','queue.json']) {
    try {
      const info=await lstat(join(base,'.reader/inbox-runner',name));
      if(info.isSymbolicLink()||!info.isFile())result.errors.push('Unsafe inbox recovery journal.');
      else result.pending=true;
    } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')result.errors.push(String(error)); }
  }
  const names = ['inbox-runner/state.json', 'upkeep-claims.json'];
  const reads = await Promise.allSettled(names.map(async name => {
    try { return JSON.parse(await readFile(join(base, '.reader', name), 'utf8')) as unknown; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }));
  for (const [index, read] of reads.entries()) {
    if (read.status === 'rejected') { result.errors.push(`Cannot read inbox coordination (${names[index]}): ${String(read.reason)}`); continue; }
    const value = read.value;
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      result.errors.push(`Invalid inbox coordination (${names[index]}).`); continue;
    }
    if (index === 0) {
      const run = value as Record<string, unknown>;
      if (typeof run.status !== 'string' || typeof run.message !== 'string') result.errors.push('Invalid inbox run status.');
      else result.run = run as InboxRun;
    } else {
      const entries = Object.entries(value);
      if (entries.some(([path, owner]) => !path.startsWith('inbox/') || typeof owner !== 'string' || !owner)) result.errors.push('Invalid inbox filing reservations.');
      else result.claims = entries.map(([path]) => path).sort();
    }
  }
  return result;
}

/** Resolve a top-level name from inboxItems to a source, without following receipt paths. */
export function inboxDocument(arrival: string, files: string[]): string | undefined {
  const root = 'inbox/' + arrival;
  const members = files.filter(path => path === root || path.startsWith(root + '/')).sort();
  return members.find(path => /\.(md|txt|pdf)$/i.test(path))
    ?? members.find(path => !path.endsWith('/receipt.json')) ?? members[0];
}
