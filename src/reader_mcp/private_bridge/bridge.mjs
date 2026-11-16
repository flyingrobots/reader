#!/usr/bin/env node
/* Reader's encrypted machine-only storage, over git-cas. One request per process: a JSON header line on stdin, then
   any payload bytes. Keys and payloads only ever arrive on stdin, and plaintext only ever leaves on stdout, so neither
   touches a command line or a file. Errors report a code, never content. */
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [, , repo, tool] = process.argv;
const {default: ContentAddressableStore} = await import(pathToFileURL(join(tool, 'node_modules/@git-stunts/git-cas/index.js')).href);
const SCHEME = {scheme: 'framed'};

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const all = Buffer.concat(chunks), end = all.indexOf(10);
  if (end < 0) throw Object.assign(new Error('Missing request'), {code: 'BAD_REQUEST'});
  return {request: JSON.parse(all.subarray(0, end).toString()), payload: all.subarray(end + 1)};
}
async function* once(bytes) { yield bytes; }
async function deriveVaultKey(cas, passphrase) {
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption?.kdf) throw Object.assign(new Error('No vault'), {code: 'NO_VAULT'});
  const {salt, ...kdf} = metadata.encryption.kdf;
  const {key} = await cas.deriveKey({passphrase, salt: Buffer.from(salt, 'base64'), ...kdf});
  return key;
}
async function keyOf(cas, request) {
  return request.key ? Buffer.from(request.key, 'hex') : deriveVaultKey(cas, request.passphrase);
}
async function put(cas, key, slug, bytes) {
  const manifest = await cas.store({source: once(bytes), slug, filename: 'data', encryptionKey: key, encryption: SCHEME});
  const treeOid = await cas.createTree({manifest});
  await cas.addToVault({slug, treeOid, encryptionKey: key, force: true});
}
async function get(cas, key, slug) {
  const treeOid = await cas.resolveVaultEntry({slug, encryptionKey: key});
  const manifest = await cas.readManifest({treeOid});
  const chunks = [];
  for await (const chunk of cas.restoreStream({manifest, encryptionKey: key})) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  const {request, payload} = await readInput();
  const cas = await ContentAddressableStore.open({cwd: repo});
  const reply = (value, bytes) => { process.stdout.write(JSON.stringify(value) + '\n'); if (bytes) process.stdout.write(bytes); };
  try {
    switch (request.op) {
      case 'init':
        await cas.initVault({passphrase: request.passphrase, kdfOptions: {algorithm: 'scrypt'}, privacy: true});
        reply({ok: true});
        break;
      case 'unlock': {
        const key = await deriveVaultKey(cas, request.passphrase);
        await cas.listVault({encryptionKey: key});
        reply({ok: true, key: Buffer.from(key).toString('hex')});
        break;
      }
      case 'store': {
        const key = await keyOf(cas, request), end = request.meta_bytes;
        await put(cas, key, request.id + '/meta', payload.subarray(0, end));
        await put(cas, key, request.id + '/data', payload.subarray(end));
        reply({ok: true});
        break;
      }
      case 'list': {
        const key = await keyOf(cas, request), items = [];
        for (const entry of await cas.listVault({encryptionKey: key})) {
          if (entry.slug.endsWith('/meta')) items.push({id: entry.slug.slice(0, -5), meta: (await get(cas, key, entry.slug)).toString()});
        }
        reply({ok: true, items});
        break;
      }
      case 'read': {
        const key = await keyOf(cas, request);
        reply({ok: true}, await get(cas, key, request.id + '/data'));
        break;
      }
      case 'delete': {
        const key = await keyOf(cas, request);
        for (const suffix of ['/meta', '/data']) await cas.removeFromVault({slug: request.id + suffix, encryptionKey: key});
        reply({ok: true});
        break;
      }
      default:
        throw Object.assign(new Error('Unknown operation'), {code: 'BAD_REQUEST'});
    }
  } finally {
    await cas.close?.();
  }
}
main().catch(error => { process.stdout.write(JSON.stringify({ok: false, code: error.code || 'FAILED'}) + '\n'); process.exitCode = 1; });
