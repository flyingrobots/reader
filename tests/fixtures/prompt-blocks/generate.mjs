// A deterministic corpus of Markdown documents that mix prompt wrappers with every block construct that can
// hide or break them (fences, math, HTML blocks, lists, quotes, indented code, tables). `--write` records what
// the browser parser finds in agreement.json; tests/test_prompt_blocks.py requires the server parser to agree.
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const meta=id=>`{"v":1,"id":"${id}","title":"Task ${id}","repo":"acme/widget","issue":null}`;
const FRAGMENTS=[
  '```','```','~~~','````','```text','```markdown','  ```','    ```','\t```text','~~~text',
  '$$','$$ x $$','\\[','\\]','$$x$$',
  '<div>','</div>','<span>','</span>','<!-- note -->','<!-- open','-->','<pre>','</pre>','<?php','?>','<![CDATA[',']]>','<!DOCTYPE x>',
  '- item','  continued','    indented','> quote','>','1. one','2) two','* star','',' ','','Plain text','# Heading','---','===','| a | b |','|---|---|',
  'Task line','<!-- /reader:prompt -->','<!-- reader:prompt {"v":1} -->',
];
export function generate(count=700,seed=0x5eed){
  let state=seed>>>0;
  const random=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
  const pick=list=>list[Math.floor(random()*list.length)];
  const docs=[];
  for(let n=0;n<count;n++){
    const lines=[],parts=4+Math.floor(random()*14);
    for(let p=0;p<parts;p++){
      const roll=random();
      if(roll<0.22){
        const id=pick(['alpha','beta','gamma']),gap=pick(['','','\n']),prefix=pick(['','','','','> ','  ','- ']);
        const block=[`<!-- reader:prompt ${meta(id)} -->`,...(gap?['']:[]),pick(['```text','~~~text','````text']),'Do the task.',''];
        const fence=block[block.length-3].replace('text','');
        block[block.length-1]=fence;
        block.push(...(gap?['']:[]),'<!-- /reader:prompt -->');
        lines.push(...block.map(line=>line?prefix+line:line));
      }else if(roll<0.30)lines.push(`<!-- reader:prompt ${meta(pick(['alpha','delta']))} -->`);
      else lines.push(pick(FRAGMENTS));
    }
    docs.push(lines.join('\n')+'\n');
  }
  return docs;
}

if(process.argv.includes('--write')){
  const require=createRequire(import.meta.url);
  const markdownit=require('../../../src/reader_mcp/web_ui/vendor/markdown-it.min.js');
  const {mathPlugin}=await import('../../../src/reader_mcp/web_ui/math.mjs');
  const {calloutPlugin}=await import('../../../src/reader_mcp/web_ui/callouts.mjs');
  const {embedPlugin}=await import('../../../src/reader_mcp/web_ui/embeds.mjs');
  const {promptPlugin}=await import('../../../src/reader_mcp/web_ui/prompt-blocks.mjs');
  const md=markdownit({html:true,linkify:true,breaks:false}).use(mathPlugin).use(calloutPlugin).use(embedPlugin).use(promptPlugin);
  const rows=generate().map(markdown=>{const env={prompts:{}};md.parse(markdown,env);
    return {markdown,blocks:env.prompts.blocks.map(b=>[b.id,b.line,b.endLine,b.prompt]),rejected:env.prompts.rejected.map(r=>[r.line,r.reason])};});
  writeFileSync(new URL('./agreement.json',import.meta.url),JSON.stringify(rows)+'\n');
  console.log(rows.length,'cases;',rows.filter(r=>r.blocks.length).length,'with blocks;',rows.filter(r=>r.rejected.length).length,'with rejections');
}
