// The keymap's sequence parser: tokens, counts, "a registers, multi-key timeouts, leader swallowing,
// declining bindings and the mode stack's Escape. No DOM: keys.mjs only touches the page when it exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKeys,keyToken,parseKeys,matchKeys,keyLabel,closest,LIMITS} from '../src/reader_mcp/web_ui/keys.mjs';

LIMITS.sequenceMs=40;LIMITS.leaderMs=60;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const key=(k,extra={})=>({key:k,ctrlKey:false,metaKey:false,altKey:false,isComposing:false,defaultPrevented:false,target:{},prevented:false,preventDefault(){this.prevented=true;this.defaultPrevented=true;},...extra});
function setup(options={}){
  const calls=[],escapes=[];
  const keys=createKeys({escape:()=>escapes.push('page'),storage:null,...options});
  const log=name=>context=>{calls.push({name,count:context.count,register:context.register,args:context.args});};
  return {keys,calls,escapes,log,type:(...ks)=>ks.map(k=>{const event=typeof k==='string'?key(k):k;keys.handle(event);return event;})};
}

test('tokens and notation', () => {
  assert.equal(keyToken(key(' ')),'<Space>');
  assert.equal(keyToken(key('d',{ctrlKey:true})),'<C-d>');
  assert.equal(keyToken(key('Enter')),'<CR>');
  assert.equal(keyToken(key('F10')),'<F10>');
  assert.equal(keyToken(key('Shift')),null);
  assert.deepEqual(parseKeys('<Space>,t'),['<Space>',',','t']);
  assert.deepEqual(parseKeys("m{a-z}"),['m','{a-z}']);
  assert.deepEqual(parseKeys('<'),['<']);
  assert.deepEqual(matchKeys(parseKeys("'{mark}"),["'","'"]),{kind:'exact',args:["'"]});
  assert.equal(matchKeys(parseKeys('m{a-z}'),['m','A']),null);
  assert.equal(matchKeys(parseKeys(']]'),[']']).kind,'prefix');
  assert.equal(keyLabel('<C-o>'),'Ctrl o');
  assert.equal(closest('chnages',['changes','chat','check']),'changes');
  assert.equal(closest('zzzzzz',['changes']),null);
});

test('single keys run at once; unknown keys are left to the browser', () => {
  const {keys,calls,log,type}=setup();
  keys.map({keys:'j',run:log('j')});
  const [j,x]=type('j','x');
  assert.deepEqual(calls.map(c=>c.name),['j']);
  assert.equal(j.prevented,true);assert.equal(x.prevented,false);
});

test('counts and registers reach the binding', () => {
  const {keys,calls,log,type}=setup();
  keys.map({keys:'j',run:log('j')},{mode:'visual',keys:'y',run:log('y')});
  type('1','2','j');
  assert.equal(calls[0].count,12);
  keys.defineMode('visual',{label:()=>'VISUAL',escape:()=>keys.leave('visual')});keys.enter('visual');
  type('"','a','y');
  assert.equal(calls[1].register,'a');
  type('y');assert.equal(calls[2].register,null,'the register applies to one action only');
  type('"','A','y');assert.equal(calls[3].register,null,'an invalid register name cancels it');
});

test('a prefix waits for the rest of its sequence, then times out', async () => {
  const {keys,calls,log,type}=setup();
  keys.map({keys:'gg',run:log('gg')},{keys:']',run:log(']')},{keys:']]',run:log(']]')},{keys:'j',run:log('j')});
  type('g','g');assert.deepEqual(calls.map(c=>c.name),['gg']);
  type('g');assert.deepEqual(keys.pending().keys,['g']);
  await wait(60);assert.deepEqual(keys.pending().keys,[],'a lone g expires');
  type(']');await wait(60);assert.deepEqual(calls.map(c=>c.name),['gg',']'],'an exact match that is also a prefix runs on the timeout');
  type(']',']');assert.deepEqual(calls.map(c=>c.name),['gg',']',']]']);
  type('g','j');assert.deepEqual(calls.map(c=>c.name),['gg',']',']]','j'],'a broken sequence retries the last key on its own');
});

test('arguments: m{a-z} and \'{mark}', () => {
  const {keys,calls,log,type}=setup();
  keys.map({keys:'m{a-z}',run:log('m')},{keys:"'{mark}",run:log("'")});
  type('m','q',"'","'");
  assert.deepEqual(calls.map(c=>[c.name,c.args[0]]),[['m','q'],["'","'"]]);
});

test('leader: comma is an alias, unknown keys are swallowed, status names the next keys', async () => {
  const {keys,calls,log,type}=setup();
  keys.group('<Space>,','more');
  keys.map({keys:'<Space>e',run:log('files'),hint:'files'},{keys:'<Space>,t',run:log('theme'),hint:'theme editor'},{keys:'x',run:log('x')});
  type(' ');
  assert.equal(keys.status().mode,'LEADER');
  assert.match(keys.status().keys,/<kbd>e<\/kbd> files <kbd>,<\/kbd> more/);
  type(',');assert.match(keys.status().keys,/theme editor/);
  type('t');assert.deepEqual(calls.map(c=>c.name),['theme']);
  type(',','e');assert.deepEqual(calls.map(c=>c.name),['theme','files'],'comma starts the leader');
  const [,x]=type(' ','x');assert.equal(x.prevented,true);assert.deepEqual(calls.map(c=>c.name),['theme','files'],'an unknown leader key never runs x');
  type(' ');await wait(80);assert.equal(keys.status(),null,'the leader times out');
});

test('when() and declining bindings choose between rows for one key', () => {
  const {keys,calls,type}=setup();let book=false;
  keys.map({keys:'j',when:()=>book,run:()=>{calls.push('turn');}},{keys:'h',run:()=>false},{keys:'j',run:()=>{calls.push('scroll');}});
  type('j');book=true;type('j');
  assert.deepEqual(calls,['scroll','turn']);
  const [h]=type('h');assert.equal(h.prevented,false,'a declined key goes to the browser');
});

test('Escape: pending keys first, then the mode, then the page', () => {
  const {keys,escapes,type}=setup();let left=0;
  keys.map({keys:'gg',run:()=>{}});
  keys.defineMode('visual',{label:()=>'VISUAL',escape:()=>{left++;keys.leave('visual');}});
  keys.enter('visual');type('3');
  type('Escape');assert.equal(keys.pending().count,'');assert.equal(left,0,'the count is cancelled first');
  type('Escape');assert.equal(left,1);assert.equal(keys.mode(),'normal');
  type('Escape');assert.deepEqual(escapes,['page']);
});

test('the guard keeps keys out of fields, except global bindings', () => {
  let typing=true;const {keys,calls,log,type}=setup({guard:()=>typing});
  keys.map({keys:'j',run:log('j')},{keys:'<F10>',global:true,run:log('f10')});
  type('j','F10');assert.deepEqual(calls.map(c=>c.name),['f10']);
  typing=false;type('j');assert.deepEqual(calls.map(c=>c.name),['f10','j']);
});

test('intercept hooks see keys first; listed() reports every row', () => {
  const {keys,calls,log,type}=setup();
  keys.map({keys:'q',run:log('q'),help:'Queue it'},{keys:'',display:'Tab Enter',help:'Documented only'});
  keys.intercept(event=>event.key==='q'&&event.target.inPanel);
  type(key('q',{target:{inPanel:true}}));assert.deepEqual(calls,[]);
  type('q');assert.equal(calls.length,1);
  assert.deepEqual(keys.listed().map(e=>[e.keys,e.runs]),[['q',true],['',false]]);
});

test('commands: exact names, aliases and unique prefixes; typos suggest', async () => {
  const notes=[];const {keys}=setup({notify:message=>notes.push(message)});const ran=[];
  keys.command({name:'theme',args:'<id>',run:args=>ran.push('theme '+args)});
  keys.command({name:'changes',aliases:['diff'],run:()=>ran.push('changes')});
  keys.command({name:'check',run:()=>ran.push('check')});
  await keys.execute('theme paper');await keys.execute('diff');await keys.execute('chec');await keys.execute(':the ink');
  assert.deepEqual(ran,['theme paper','changes','check','theme ink']);
  await keys.execute('ch');assert.match(notes.at(-1),/Not a command: :ch\./,'an ambiguous prefix does not guess');
  await keys.execute('chnages');assert.match(notes.at(-1),/Did you mean :changes\?/);
});

test('a prefix family (Ctrl-w) labels the status line, waits its own time and swallows unknown keys', async () => {
  const {keys,calls,log,type}=setup();
  keys.prefix('<C-w>',{label:'WINDOW',ms:80});
  keys.map({keys:'<C-w>v',run:log('vsplit'),hint:'side by side'},{keys:'<C-w>s',run:log('split'),hint:'stacked'},{keys:'j',run:log('j')});
  type(key('w',{ctrlKey:true}));
  assert.deepEqual(keys.status(),{mode:'WINDOW',keys:'<kbd>v</kbd> side by side <kbd>s</kbd> stacked'});
  await wait(50);type('v');
  assert.deepEqual(calls.map(c=>c.name),['vsplit'],'the second key still counts after the default sequence time');
  const [,x]=type(key('w',{ctrlKey:true}),'x');
  assert.equal(x.prevented,true,'an unknown key after the prefix is swallowed');
  assert.equal(keys.status(),null);
  type('j');assert.deepEqual(calls.map(c=>c.name),['vsplit','j']);
  // Another binding can enter the family (Space W).
  keys.map({keys:'<Space>W',run:()=>{keys.feed('<C-w>');}});
  type(' ','W','s');assert.deepEqual(calls.map(c=>c.name),['vsplit','j','split']);
});

test('a key typed in time continues its sequence even when the timeout ran first', async () => {
  const {keys,calls,log,type}=setup();
  keys.map([{keys:'gg',run:log('top')},{keys:'G',run:log('end')}]);
  // A busy page: the second g was pressed 10 ms after the first but is handled after the 40 ms timeout has run.
  type(key('g',{timeStamp:1000}));await wait(LIMITS.sequenceMs+20);
  assert.deepEqual(keys.pending().keys,[],'the timeout cleared the pending g');
  type(key('g',{timeStamp:1010}));
  assert.deepEqual(calls.map(c=>c.name),['top'],'gg still runs: the second key was typed before the deadline');
  // A key typed after the deadline starts afresh.
  type(key('g',{timeStamp:5000}));await wait(LIMITS.sequenceMs+20);type(key('g',{timeStamp:5000+LIMITS.sequenceMs+1}));
  assert.deepEqual(calls.map(c=>c.name),['top'],'too late: no second gg');
  assert.deepEqual(keys.pending().keys,['g'],'the late g is pending on its own');
});
