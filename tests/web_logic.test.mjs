import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bodyOf, codePointIndex, codePointOffset, occurrences, projectSource, rawCodePoints, sourceRangeForQuote, visibleQuote} from '../src/reader_mcp/web_ui/logic.mjs';

test('formatted selections retain exact code-point anchors after an emoji',()=>{
  const raw='---\ntitle: Hidden\n---\n\n# A title\n\nA 🐈 sees **a precise** passage &amp; a [link](other.md).';
  const range=sourceRangeForQuote(raw,'a precise passage & a link');
  assert.equal(rawCodePoints(raw,range.start,range.end),'a precise** passage &amp; a [link');
  assert.equal(visibleQuote(projectSource(raw),range.start,range.end),'a precise passage & a link');
  assert.ok(range.start < raw.indexOf('a precise'));
  assert.equal(bodyOf(raw).text.trimStart().startsWith('# A title'),true);
});
test('ambiguous passages refuse instead of picking an author’s location',()=>{
  const raw='Same thought.\n\nSame thought.';
  assert.throws(()=>sourceRangeForQuote(raw,'Same thought'),/more than once/);
  assert.deepEqual(sourceRangeForQuote(raw,'Same thought',{start:15,end:raw.length}),{start:15,end:27});
});
test('source projection handles snake-case names and large literal prose',()=>{
  assert.equal(projectSource('A `job_queue.at(job_42)` is present.').text,'A job_queue.at(job_42) is present.');
  const raw='A'.repeat(160000)+' **a unique thought**.';
  assert.equal(sourceRangeForQuote(raw,'a unique thought').start,160003);
});
test('find uses literal Unicode matches without shifting later offsets',()=>{
  assert.deepEqual(occurrences('İ wait; a.b then a.b','a.b'),[{start:8,end:11},{start:17,end:20}]);
  assert.deepEqual(occurrences('An ECHO and an echo','echo'),[{start:3,end:7},{start:15,end:19}]);
});
test('heading slugs match the link graph (links.py slug) for the same headings',async()=>{
  const {headingSlug}=await import('../src/reader_mcp/web_ui/logic.mjs');
  // Rendered textContent of the headings tested in tests/test_links.py.
  assert.equal(headingSlug('1. The real thing & more'),'1-the-real-thing--more');
  assert.equal(headingSlug('Why it matters'),'why-it-matters');
  assert.equal(headingSlug('Ünïcode — dash’s'),'ünïcode--dashs');
});
// Reference implementations the fast paths must match exactly.
const slowRaw=(raw,start,end)=>Array.from(raw).slice(start,end).join('');
const slowQuote=(projection,start,end)=>{const indices=projection.starts.map((cp,i)=>cp>=start&&projection.ends[i]<=end?i:-1).filter(i=>i>=0);return indices.length?projection.text.slice(indices[0],indices.at(-1)+1).replace(/\s+/gu,' ').trim():'';};
function sample(seed){
  let x=seed;const next=n=>{x=(x*1103515245+12345)%2147483648;return x%n;};
  const parts=['word ','🐈','\uD800','\uDC00','**bold** ','[link](a.md) ','`code` ','&amp; ','\n\n## Head\n','\n- item ','é','𝒳'];
  return Array.from({length:120},()=>parts[next(parts.length)]).join('');
}
test('code point index matches Array.from on emoji and lone surrogates',()=>{
  for(let seed=1;seed<40;seed++){const text=sample(seed),index=codePointIndex(text);for(let i=0;i<=text.length;i++)assert.equal(index(i),codePointOffset(text,i),`seed ${seed} offset ${i}`);}
  const ascii=codePointIndex('plain text');assert.equal(ascii(5),5);assert.equal(ascii(99),10);
});
test('raw code point slices and visible quotes match the reference implementations',()=>{
  for(let seed=1;seed<25;seed++){
    const raw=sample(seed),length=Array.from(raw).length,projection=projectSource(raw);
    for(let start=0;start<=length;start+=3)for(const end of [start,start+1,start+7,start+40,length+2]){
      assert.equal(rawCodePoints(raw,start,end),slowRaw(raw,start,end),`raw ${seed} ${start}-${end}`);
      assert.equal(visibleQuote(projection,start,end),slowQuote(projection,start,end),`quote ${seed} ${start}-${end}`);
    }
  }
});
test('anchoring on a large document stays linear',()=>{
  const raw=('A 🐈 paragraph with **bold** text and a [link](x.md).\n\n').repeat(40000),index=codePointIndex(raw);
  const started=performance.now();let total=0;for(let i=0;i<raw.length;i+=97)total+=index(i);
  assert.ok(total>0);assert.ok(performance.now()-started<500,'lookups are logarithmic');
  const projection=projectSource(raw),at=Array.from(raw).length-40;
  assert.equal(visibleQuote(projection,at,at+10),slowQuote(projection,at,at+10));
});
test('counts use singular and plural nouns',async()=>{
  const {plural}=await import('../src/reader_mcp/web_ui/logic.mjs');
  assert.equal(plural(1,'comment'),'1 comment');
  assert.equal(plural(0,'comment'),'0 comments');
  assert.equal(plural(2,'reply','replies'),'2 replies');
  assert.equal(plural(1200,'work'),'1,200 works');
});
test('thread quotes display without Markdown markers',async()=>{
  const {plainQuote}=await import('../src/reader_mcp/web_ui/logic.mjs');
  assert.equal(plainQuote('A **lifetime** of `job_queue` reading'),'A lifetime of job_queue reading');
  assert.equal(plainQuote('waits here.\n\n## Chapter 6\n\nA *quiet* [library](a.md) …'),'waits here. Chapter 6 A quiet library …');
  assert.equal(plainQuote('half of a **bold run'),'half of a bold run');
  assert.equal(plainQuote('C# and 3 * 4 stay'),'C# and 3 * 4 stay');
});
test('a repeated quote inside one block resolves to the counted occurrence only when the counts agree',()=>{
  const raw='Intro.\n\nSame word, then same word, then same word.\n';
  const bounds={start:8,end:raw.length};
  assert.throws(()=>sourceRangeForQuote(raw,'same word',bounds),/more than once/);
  assert.deepEqual(sourceRangeForQuote(raw,'same word',{...bounds,occurrence:1,count:2}),{start:40,end:49});
  assert.deepEqual(sourceRangeForQuote(raw,'same word',{...bounds,occurrence:0,count:2}),{start:24,end:33});
  assert.throws(()=>sourceRangeForQuote(raw,'same word',{...bounds,occurrence:1,count:3}),/more than once/,'disagreeing counts keep the refusal');
  assert.throws(()=>sourceRangeForQuote(raw,'same word',{...bounds,occurrence:2,count:2}),/more than once/);
});
test('find stops at 2,000 matches and says when more exist',()=>{
  const exact=occurrences('a '.repeat(2000),'a'),more=occurrences('a '.repeat(2001),'a');
  assert.equal(exact.length,2000);assert.equal(exact.limited,undefined,'exactly 2,000 is a full count');
  assert.equal(more.length,2000);assert.equal(more.limited,true,'2,001 matches report a floor');
});
