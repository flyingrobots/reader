import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leaves,splitLeaf,removeLeaf,swapNext,equalize,layout,fits,resize,neighbor,cleanRoute,encodeLayout,decodeLayout,mapOffset,matchHeading,headingKey,MIN_WIDTH,DIVIDER} from '../src/reader_mcp/web_ui/split.mjs';

const A={id:1,route:'#read=library%2Fa.md'},B={id:2,route:'#read=library%2Fb.md'},C={id:3,route:''},D={id:4,route:'#backstage'};
const ids=tree=>leaves(tree).map(l=>l.id);
const box={x:0,y:0,w:1280,h:868};

test('split, close, swap and equalize keep a tidy tree',()=>{
  let tree=splitLeaf(A,1,'row',B);
  assert.deepEqual(tree,{dir:'row',sizes:[.5,.5],children:[A,B]});
  tree=splitLeaf(tree,2,'row',C);  // Same direction: a third column, halving pane 2.
  assert.deepEqual(tree.sizes,[.5,.25,.25]);assert.deepEqual(ids(tree),[1,2,3]);
  tree=splitLeaf(tree,1,'col',D);  // Across: pane 1 becomes a stack.
  assert.equal(tree.children[0].dir,'col');assert.deepEqual(ids(tree),[1,4,2,3]);
  assert.deepEqual(ids(splitLeaf(A,1,'row',B,{before:true})),[2,1]);
  assert.deepEqual(ids(swapNext(tree,4)),[1,2,4,3]);
  assert.deepEqual(ids(swapNext(tree,3)),[3,4,2,1],'the last pane swaps with the first');
  const closed=removeLeaf(tree,4);assert.deepEqual(closed.children[0],A,'a one-child stack collapses into its pane');
  assert.ok(Math.abs(closed.sizes.reduce((a,b)=>a+b)-1)<1e-9);
  const merged=removeLeaf(splitLeaf(splitLeaf(A,1,'col',B),2,'row',C),1);
  assert.deepEqual(merged,{dir:'row',sizes:[.5,.5],children:[B,C]},'a row inside a row merges');
  assert.equal(removeLeaf(A,1),null);
  assert.deepEqual(equalize({dir:'row',sizes:[.7,.2,.1],children:[A,B,C]}).sizes,[1/3,1/3,1/3]);
});

test('layout gives pixel boxes, dividers and minimums',()=>{
  const tree={dir:'row',sizes:[.5,.5],children:[A,{dir:'col',sizes:[.5,.5],children:[B,C]}]};
  const {panes,dividers}=layout(tree,box);
  assert.deepEqual(panes.get(1),{x:0,y:0,w:637,h:868});
  assert.deepEqual(panes.get(2),{x:643,y:0,w:637,h:431});assert.deepEqual(panes.get(3),{x:643,y:437,w:637,h:431});
  assert.equal(dividers.length,2);assert.deepEqual([dividers[0].before,dividers[0].after],[1,2]);assert.equal(dividers[0].w,DIVIDER);
  assert.equal(fits(tree,box),true);
  assert.equal(fits({dir:'row',sizes:[.25,.25,.25,.25],children:[A,B,C,D]},box),false,'four columns of 316px are under the 320px minimum');
  const wider=resize({dir:'row',sizes:[.5,.5],children:[A,B]},[],0,200,box);
  assert.ok(wider.sizes[0]>.65&&wider.sizes[0]<.67);
  const clamped=resize({dir:'row',sizes:[.5,.5],children:[A,B]},[],0,5000,box);
  assert.equal(layout(clamped,box).panes.get(2).w,MIN_WIDTH,'a divider stops at the neighbor’s minimum');
});

test('neighbors follow geometry',()=>{
  const tree={dir:'row',sizes:[.5,.5],children:[A,{dir:'col',sizes:[.5,.5],children:[B,C]}]};
  const rects=layout(tree,box).panes;
  assert.equal(neighbor(rects,1,'l'),2);assert.equal(neighbor(rects,2,'j'),3);assert.equal(neighbor(rects,3,'k'),2);
  assert.equal(neighbor(rects,3,'h'),1);assert.equal(neighbor(rects,1,'h'),null);
});

test('routes keep paths, never text, and the layout round-trips',()=>{
  assert.equal(cleanRoute('#read=library%2Fa.md&at=%7B%22query%22%3A%22secret%22%7D&h=intro'),'#read=library%2Fa.md&h=intro');
  assert.equal(cleanRoute('#search?q=private+words'),'#search');
  assert.equal(cleanRoute('#issue=2026-W43'),'#issue=2026-W43');
  assert.equal(cleanRoute('javascript:alert(1)'),'');
  const tree={dir:'row',sizes:[.6,.4],children:[{id:7,route:'#read=library%2Fa.md&at=%7B%7D'},{dir:'col',sizes:[.5,.5],children:[B,C]}]};
  const hash=encodeLayout(tree,2,[7,2]);
  assert.ok(!hash.includes('%26at'));
  const back=decodeLayout(hash,10);
  assert.deepEqual(leaves(back.tree).map(l=>l.route),['#read=library%2Fa.md','#read=library%2Fb.md','']);
  assert.deepEqual(ids(back.tree),[10,11,12]);assert.equal(back.focus,11);assert.deepEqual(back.bind,[10,11]);assert.equal(back.next,13);
  assert.ok(Math.abs(back.tree.sizes[0]-.6)<1e-9);
  assert.equal(decodeLayout('#split=not-json'),null);
  assert.equal(decodeLayout('#split='+encodeURIComponent(JSON.stringify({t:{d:'row',s:[1,1,1,1,1],c:['','','','','']}}))),null,'five panes are refused');
  assert.equal(decodeLayout('#split='+encodeURIComponent(JSON.stringify({t:''}))),null,'one pane is not a split');
});

test('source offsets map across version hunks, both ways',()=>{
  // Old: [0,10) title, [12,40) kept, [42,60) reworded, [62,80) deleted. New: [0,10), [12,40), [42,66) reworded, [68,90) inserted.
  const hunks=[{op:'equal',count:2,old_start:0,old_end:40,new_start:0,new_end:40},{op:'replace',old_start:42,old_end:60,new_start:42,new_end:66},
    {op:'delete',old_start:62,old_end:80,new_start:68,new_end:68},{op:'insert',old_start:80,old_end:80,new_start:68,new_end:90}];
  assert.equal(mapOffset(hunks,12),12);assert.equal(mapOffset(hunks,51),Math.round(42+9/18*24));
  assert.equal(mapOffset(hunks,70),68,'a deleted block maps to where it was');
  assert.equal(mapOffset(hunks,75,false),80,'an inserted block maps back to where it lands');
  assert.equal(mapOffset(hunks,41),42,'between blocks: the next block');
  assert.equal(mapOffset(hunks,500),90);assert.equal(mapOffset([],33),33);
});

test('the heading fallback matches text, level and repeat',()=>{
  const left=[{text:'Intro',level:1},{text:'Notes',level:2},{text:'Method',level:2},{text:'Notes',level:2}];
  const right=[{text:'intro ',level:1},{text:'Method',level:2},{text:'Notes',level:3},{text:'Notes',level:2},{text:'Notes',level:2}];
  assert.deepEqual(headingKey(left,3),{text:'Notes',level:2,nth:1});
  assert.equal(matchHeading(right,headingKey(left,3)),4,'the second "Notes" at level 2');
  assert.equal(matchHeading(right,headingKey(left,0)),0,'whitespace and case are ignored');
  assert.equal(matchHeading(right,{text:'Notes',level:2,nth:5}),3,'a missing repeat falls back to the first match');
  assert.equal(matchHeading(right,{text:'Absent',level:2,nth:0}),-1);
});
