import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ADMIN,adminHash,adminPath,adminPathFromHash,adminRoute,isAdminHash,isAdminPath,libraryReturn} from '../src/reader_mcp/web_ui/admin-routes.mjs';

test('Reader Admin routes: Overview, sections, parameters and the legacy #backstage',()=>{
  assert.equal(adminPathFromHash('#admin'),ADMIN);
  assert.equal(adminPathFromHash('#backstage'),ADMIN,'legacy Behind the scenes opens Overview');
  assert.equal(adminPathFromHash('#admin/overview'),ADMIN);
  assert.equal(adminPathFromHash('#admin/settings'),':admin/settings');
  assert.equal(adminPathFromHash('#admin/inbox/'),':admin/inbox','a trailing slash is the same page');
  // RW-44's detail routes parse here; the section registry decides whether a section accepts them.
  const job='123e4567-e89b-42d3-a456-426614174000';
  assert.equal(adminPathFromHash('#admin/jobs/'+job),':admin/jobs/'+job);
  assert.deepEqual(adminRoute(':admin/jobs/'+job),{section:'jobs',params:[job]});
  assert.deepEqual(adminRoute(ADMIN),{section:'overview',params:[]});
  assert.equal(adminRoute('library/a.md'),null);
  for(const other of ['','#','#read=library%2Fa.md','#search','#scratch','#administrator','#backstage/x',null,undefined])assert.equal(adminPathFromHash(other),null,String(other));
});

test('nothing untrusted is echoed: malformed or hostile segments become the not-found page',()=>{
  for(const bad of ['#admin/%3Cscript%3E','#admin/%E0%A4','#admin/Settings','#admin/a/b/c/d/e','#admin/x/'+'y'.repeat(200),'#admin/..'])
    assert.equal(adminPathFromHash(bad),':admin/not-found',bad);
});

test('hashes round-trip and the app recognizes admin paths and hashes',()=>{
  for(const path of [ADMIN,':admin/settings',':admin/logs/run-2026.10.26_1'])assert.equal(adminPathFromHash(adminHash(path)),path);
  assert.equal(adminHash(ADMIN),'#admin');assert.equal(adminHash(adminPath('settings')),'#admin/settings');assert.equal(adminPath('overview'),ADMIN);
  assert.ok(isAdminPath(':admin/inbox')&&isAdminPath(ADMIN)&&!isAdminPath(':administrator')&&!isAdminPath(':backstage')&&!isAdminPath(null));
  assert.ok(isAdminHash('#backstage')&&isAdminHash('#admin/x')&&!isAdminHash('#adminx'));
});

test('Back to Library returns to the view left, at its saved place: no passage, heading or search terms',()=>{
  assert.equal(libraryReturn('#read=library%2Fa.md&at=%7B%22query%22%3A%22secret%22%7D&h=intro'),'#read=library%2Fa.md');
  assert.equal(libraryReturn('#read=library%2Ffar.md%23far-section'),'#read=library%2Ffar.md','a hand-made heading link too');
  assert.equal(libraryReturn('#read=library%2Fa.md%40abc1234'),'#read=library%2Fa.md%40abc1234','a historical version stays itself');
  assert.equal(libraryReturn('#search=q%3Dprivate'),'#search');
  assert.equal(libraryReturn('#issue=2026-W43'),'#issue=2026-W43');
  const split='#split='+encodeURIComponent(JSON.stringify({t:{d:'row',s:[.5,.5],c:['#read=library%2Fa.md','']},f:1}));
  assert.equal(libraryReturn(split),split,'a split layout is kept whole');
  for(const home of ['','#admin','#admin/settings','#backstage','javascript:alert(1)','#read=%E0%A4','#split='+'x'.repeat(9000)])assert.equal(libraryReturn(home),'',home);
});
