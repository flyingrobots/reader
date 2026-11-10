import './jail_guard.cjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {portableLinkPlugin,portableEnvironment} from '../src/reader_mcp/web_ui/portable-links.mjs';
import {createHash} from 'node:crypto';
import {mathPlugin} from '../src/reader_mcp/web_ui/math.mjs';
const markdownit=createRequire(import.meta.url)('../src/reader_mcp/web_ui/vendor/markdown-it.min.js');
const md=markdownit({html:true}).use(portableLinkPlugin);
const row=(source_url,label,kind,target)=>({source_url,label,kind,target,status:'resolved'});
const render=(source,targets=[])=>md.render(source,{portableLinks:{targets}});

test('inline and reference links use exact URL and label mappings',()=>{
  const source='[A **bold** name][one]\n\n[one]: file:///repo\n\n[Second](file:///repo)';
  const html=render(source,[row('file:///repo','A bold name','link','https://github.com/example/one'),
    row('file:///repo','Second','link','https://github.com/example/two')]);
  assert.match(html,/<a href="https:\/\/github.com\/example\/one">A <strong>bold<\/strong> name<\/a>/);
  assert.match(html,/<a href="https:\/\/github.com\/example\/two">Second<\/a>/);
});
test('images resolve locally, while an unresolved image has visible fallback text',()=>{
  const source='![A *picture*](file:///pic.png)';
  assert.match(render(source,[row('file:///pic.png','A *picture*','image','library/packet/assets/hash.png')]),
    /<img src="library\/packet\/assets\/hash.png" alt="A picture">/);
  const missing=render(source);
  assert.match(missing,/A \*picture\* \(local image unavailable\)/);
  assert.doesNotMatch(missing,/<img|src=/);
});
test('unresolved links retain their label and explanation, never raw Markdown or file href',()=>{
  const html=render('[Missing](file:///gone)',[{source_url:'file:///gone',label:'Missing',kind:'link',status:'unresolved',reason:'Deleted worktree'}]);
  assert.match(html,/<span title="Local reference unavailable: Deleted worktree" class="local-link-unavailable"[^>]*>Missing<\/span>/);
  assert.doesNotMatch(html,/href=|file:|\[Missing\]/);
});
test('browser matches hashed identities without receiving host paths from the repair API',async()=>{
  const key=createHash('sha256').update(JSON.stringify(['file:///private/example','Label','link'])).digest('hex');
  const record={targets:[{key,status:'resolved',target:'https://github.com/example/project'}]};
  assert.doesNotMatch(JSON.stringify(record),/file:|private/);
  const env=await portableEnvironment(md,'[Label](file:///private/example)',record);
  assert.match(md.render('[Label](file:///private/example)',{portableLinks:env}),/<a href="https:\/\/github.com\/example\/project">Label<\/a>/);
});
test('code stays literal and unsafe destinations never become links',()=>{
  const html=render('`[Code](file:///code)`\n\n```md\n[X](file:///fenced)\n```\n\n[Bad](javascript:alert(1))\n');
  assert.match(html,/<code>\[Code\]\(file:\/\/\/code\)<\/code>/);
  assert.doesNotMatch(html,/<a/);
  for(const target of ['file:///secret','javascript:alert(1)','https://github.com.evil/a/b','library/%2e%2e/secret','library/a\\b']){
    assert.doesNotMatch(render('[X](file:///x)',[row('file:///x','X','link',target)]),/href=/);
  }
});

test('repair collection uses the document math setting when labels contain dollars',async()=>{
  const parser=markdownit().use(mathPlugin).use(portableLinkPlugin);
  const source='[$x=y$](file:///repo/file.md)';
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const record={targets:[{key:hash(['file:///repo/file.md','$x=y$','link']),fallback_key:hash(['file:///repo/file.md','link']),status:'resolved',target:'https://github.com/example/project'}]};
  for(const mathDollar of [false,true]){
    const options={mathDollar};
    const portableLinks=await portableEnvironment(parser,source,record,options);
    const html=parser.render(source,{...options,portableLinks});
    assert.match(html,/<a href="https:\/\/github.com\/example\/project">/);
    assert.equal(html.includes('reader-math'),mathDollar);
  }
});
