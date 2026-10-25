import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInboxCoordination, inboxDocument, currentInboxRunMessage } from '../src/inbox.ts';
import { inboxItems } from '../src/model.ts';

test('finished-run remaining-arrivals snapshots cannot report current pending work',()=>{
  const message='Codex finished; some arrivals remain. Review its report.';
  const run={status:'finished',message};
  assert.equal(currentInboxRunMessage(run),'');
  assert.deepEqual(inboxItems(['inbox/README.md']),[]);
  assert.deepEqual(inboxItems(['inbox/new/note.md']),['new']);
  assert.equal(run.message,message, 'Keep historical diagnostics unchanged');
  assert.equal(currentInboxRunMessage({status:'failed',message:'An earlier failure'}),'');
  assert.equal(currentInboxRunMessage(undefined),'');
});
test('active and interrupted runs retain their actionable status messages',()=>{
  for (const status of ['starting','running','interrupted']) {
    assert.equal(currentInboxRunMessage({status,message:'Current run status'}),'Current run status');
  }
});

test('reserved arrivals are observable before any run and disappear only after release', async () => {
  const root=await mkdtemp(join(tmpdir(),'reader-inbox-'));
  try {
    await mkdir(join(root,'.reader'));
    await writeFile(join(root,'.reader/upkeep-claims.json'),JSON.stringify({'inbox/a':'owner'}));
    assert.deepEqual(await readInboxCoordination(root),{claims:['inbox/a'],errors:[]});
    await writeFile(join(root,'.reader/upkeep-claims.json'),'{}');
    assert.deepEqual(await readInboxCoordination(root),{claims:[],errors:[]});
  } finally { await rm(root,{recursive:true}); }
});
test('a refusal remains visible without report files and malformed coordination cannot look idle', async () => {
  const root=await mkdtemp(join(tmpdir(),'reader-inbox-'));
  try {
    await mkdir(join(root,'.reader/inbox-runner'),{recursive:true});
    const run={status:'failed',message:'Filing already assigned',run_id:'test'};
    await writeFile(join(root,'.reader/inbox-runner/state.json'),JSON.stringify(run));
    await writeFile(join(root,'.reader/upkeep-claims.json'),'not json');
    const state=await readInboxCoordination(root);
    assert.deepEqual(state.run,run);
    assert.equal(state.errors.length,1);
    assert.match(state.errors[0],/upkeep-claims/);
    await writeFile(join(root,'.reader/upkeep-claims.json'),'[]');
    assert.equal((await readInboxCoordination(root)).errors.length,1);
    await rm(join(root,'.reader/inbox-runner/state.json'));
    await rm(join(root,'.reader/upkeep-claims.json'));
    assert.deepEqual(await readInboxCoordination(root),{claims:[],errors:[]});
  } finally { await rm(root,{recursive:true}); }
});
test('open selects source files within the exact arrival and handles a moved arrival',()=>{
  const paths=['inbox/abc/receipt.json','inbox/abc/note.md','inbox/abcd/wrong.md','inbox/file.txt'];
  assert.equal(inboxDocument('abc',paths),'inbox/abc/note.md');
  assert.equal(inboxDocument('file.txt',paths),'inbox/file.txt');
  assert.equal(inboxDocument('gone',paths),undefined);
  assert.deepEqual(inboxItems(paths).map(arrival=>inboxDocument(arrival,paths)),
    ['inbox/abc/note.md','inbox/abcd/wrong.md','inbox/file.txt']);
});
