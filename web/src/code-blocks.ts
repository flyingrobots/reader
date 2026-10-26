/* The shadcn Code Block for code rendered by the plain-JavaScript markdown pipeline (documents,
   embeds, the scratch preview, chat, inbox reports and activity prose).
   The markup is the React component's own: CodeBlock, CodeBlockHeader, CodeBlockTitle,
   CodeBlockActions, CodeBlockCopyButton and CodeBlockContent render once into a detached
   prototype, and every block reuses those elements' classes and attributes. The fence's own
   <code> element, its text node and its data-source offsets move into the block unchanged, so
   find, selection and annotation anchoring see the exact source text. Syntax colors are CSS
   custom highlights over that text (code-highlight.ts, loaded on demand), never new DOM.
   Line numbers are one decoration gutter per block rather than one CodeBlockLine per line:
   thousands of line elements made a large document's layout about 8x slower than plain <pre>.
   The header, copy button and gutter are decoration (data-reader-decoration). */
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CheckIcon} from 'lucide-react';
import {CodeBlock,CodeBlockHeader,CodeBlockTitle,CodeBlockActions,CodeBlockCopyButton,CodeBlockContent} from './components/ui/code-block';
import type {Token} from './code-highlight';
import {languageOf} from './code-languages';
import {notify} from './notify';

export type CodeBlockOptions={wrap?:boolean;lineNumbers?:boolean};
// Blocks per container, lines that get a number gutter, and characters highlighted per block.
const LIMIT=4000,GUTTER_LINES=5000,HIGHLIGHT_CHARS=100_000;
const NAMES:Record<string,string>={js:'JavaScript',javascript:'JavaScript',ts:'TypeScript',typescript:'TypeScript',tsx:'TSX',jsx:'JSX',py:'Python',python:'Python',
  sh:'Shell',bash:'Bash',zsh:'Zsh',shell:'Shell',console:'Console',json:'JSON',yaml:'YAML',yml:'YAML',toml:'TOML',md:'Markdown',markdown:'Markdown',mermaid:'Mermaid',
  html:'HTML',css:'CSS',sql:'SQL',rust:'Rust',rs:'Rust',c:'C',cpp:'C++',powershell:'PowerShell',ps1:'PowerShell',diff:'Diff',graphql:'GraphQL',text:'Text',txt:'Text',plaintext:'Text'};
/** The header label for a fence's info word. */
export const languageLabel=(language:string)=>NAMES[language.toLowerCase()]??(language||'Text');

type Slot={className:string;attributes:[string,string][]};
type Prototype={block:Slot;header:Slot;title:Slot;actions:Slot;button:Slot;content:Slot;code:Slot;copy:string;check:string};
let prototype:Prototype|undefined;
const slotOf=(el:Element):Slot=>({className:el.getAttribute('class')||'',attributes:[...el.attributes].filter(a=>a.name!=='class'&&a.name!=='style'&&a.name!=='aria-label').map(a=>[a.name,a.value])});
/** Render the React component once, detached, and keep each part's classes and attributes. */
function proto():Prototype{
  if(prototype)return prototype;
  const host=document.createElement('div'),root=createRoot(host);
  flushSync(()=>root.render(h('div',null,
    h(CodeBlock,null,
      h(CodeBlockHeader,null,h(CodeBlockTitle,null,'x'),h(CodeBlockActions,null,h(CodeBlockCopyButton,{value:''}))),
      h(CodeBlockContent,null,'x')),
    // The icon CodeBlockCopyButton swaps in once copied.
    h('div',{'data-check':''},h(CheckIcon)))));
  const q=(slot:string)=>host.querySelector(`[data-slot="${slot}"]`)!,button=q('code-block-copy-button');
  prototype={block:slotOf(q('code-block')),header:slotOf(q('code-block-header')),title:slotOf(q('code-block-title')),actions:slotOf(q('code-block-actions')),button:slotOf(button),
    content:slotOf(q('code-block-content')),code:slotOf(q('code-block-code')),copy:button.querySelector('svg')!.outerHTML,check:host.querySelector('[data-check] svg')!.outerHTML};
  root.unmount();
  return prototype;
}
function apply(el:Element,slot:Slot,extra=''){el.setAttribute('class',extra?slot.className+' '+extra:slot.className);for(const [name,value] of slot.attributes)if(!el.hasAttribute(name)||name==='data-slot')el.setAttribute(name,value);}
function make(doc:Document,tag:string,slot:Slot){const el=doc.createElement(tag);apply(el,slot);return el;}

/** Turn every markdown-it fence (<pre><code>) under root into a Code Block. Works on a live
    container or a <template>'s content; idempotent. */
export function decorateCodeBlocks(root:ParentNode,{wrap=false,lineNumbers=true}:CodeBlockOptions={}){
  const blocks=[...root.querySelectorAll<HTMLPreElement>('pre:not([data-slot]):has(>code:only-child)')].slice(0,LIMIT);
  if(!blocks.length)return;
  const p=proto();
  for(const pre of blocks){
    const doc=pre.ownerDocument,code=pre.firstElementChild as HTMLElement,source=code.textContent??'';
    const language=[...code.classList].find(name=>name.startsWith('language-'))?.slice(9)||'';
    const host=doc.createElement('div');host.className='reader-code-block';
    const block=make(doc,'div',p.block),header=make(doc,'div',p.header),title=make(doc,'div',p.title),actions=make(doc,'div',p.actions),button=make(doc,'button',p.button);
    header.setAttribute('data-reader-decoration','');title.textContent=languageLabel(language);
    button.setAttribute('type','button');button.setAttribute('aria-label','Copy code');button.setAttribute('title','Copy code');button.setAttribute('data-code-copy','');button.innerHTML=p.copy;
    actions.append(button);header.append(title,actions);
    const content=make(doc,'pre',p.content);
    if(wrap)content.setAttribute('data-wrap','true');
    apply(code,p.code,[...code.classList].filter(name=>name.startsWith('language-')).join(' '));
    if(language)code.dataset.language=language;
    code.dataset.highlight=languageOf(language)&&source.length<=HIGHLIGHT_CHARS?'lazy':'off';
    // The gutter lines up with the code because the code never wraps when it is shown.
    const count=(source.endsWith('\n')?source.slice(0,-1):source).split('\n').length;
    if(lineNumbers&&!wrap&&count>1&&count<=GUTTER_LINES){
      const gutter=doc.createElement('span');gutter.dataset.slot='code-block-gutter';gutter.setAttribute('data-reader-decoration','');gutter.setAttribute('aria-hidden','true');
      gutter.textContent=Array.from({length:count},(_,i)=>i+1).join('\n');content.dataset.gutter=String(String(count).length);content.append(gutter);
    }
    pre.replaceWith(host);content.append(code);block.append(header,content);host.append(block);
  }
  if(root instanceof Element&&root.isConnected)watchLazy();
}
/** The exact fence text of a decorated block. */
export const codeText=(code:Element)=>code.textContent??'';

// Copy: one delegated listener for every vanilla block; toast through notify().
async function copyText(text:string){
  try{await navigator.clipboard.writeText(text);return true;}catch{/* No clipboard API (insecure context): fall back below. */}
  const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
  try{return document.execCommand('copy');}catch{return false;}finally{area.remove();}
}
export function installCodeCopy(){
  // Build the prototype now, outside any React render: chat bodies are decorated inside one (useMemo).
  proto();
  document.addEventListener('click',async event=>{
    const button=(event.target as Element|null)?.closest?.<HTMLButtonElement>('button[data-code-copy]');if(!button)return;
    event.preventDefault();event.stopPropagation();
    const code=button.closest('[data-slot="code-block"]')?.querySelector('[data-slot="code-block-code"]');if(!code)return;
    const text=codeText(code);
    if(!await copyText(text)){notify('Couldn’t copy: the browser refused clipboard access.','error');return;}
    const p=proto();button.innerHTML=p.check;button.dataset.copied='true';button.setAttribute('aria-label','Copied');
    clearTimeout(+(button.dataset.copiedTimer||0));
    button.dataset.copiedTimer=String(setTimeout(()=>{button.innerHTML=p.copy;delete button.dataset.copied;button.setAttribute('aria-label','Copy code');},2000));
    const lines=text.replace(/\n$/,'').split('\n').length;
    notify(`Copied ${lines===1?'1 line':lines.toLocaleString('en-US')+' lines'} of code.`,'success');
  });
  // Blocks that arrive as HTML strings (chat, reports) are highlighted when they connect.
  new MutationObserver(()=>{if(document.querySelector('[data-slot="code-block-code"][data-highlight=lazy]'))watchLazy();}).observe(document.body,{childList:true,subtree:true});
}

// Highlighting: blocks near the viewport (or the next spreads), in idle-time batches; ranges live
// in one Highlight per role, pruned when blocks leave. A 2 MB document never tokenizes code no one sees.
const watching=new Set<Element>();
let nearby:IntersectionObserver|undefined;
function watchLazy(){
  if(!('highlights' in CSS)||typeof Highlight==='undefined'||typeof IntersectionObserver==='undefined')return;
  nearby??=new IntersectionObserver(entries=>{let any=false;for(const entry of entries)if(entry.isIntersecting){const code=entry.target as HTMLElement;nearby!.unobserve(code);watching.delete(code);if(code.dataset.highlight==='watching'){code.dataset.highlight='pending';any=true;}}if(any)scheduleHighlight();},{rootMargin:'150% 200%'});
  for(const code of document.querySelectorAll<HTMLElement>('[data-slot="code-block-code"][data-highlight=lazy]')){code.dataset.highlight='watching';watching.add(code);nearby.observe(code);}
}
const highlights=new Map<string,Highlight>();
const owned=new Map<Element,{role:string;range:Range}[]>();
let module:Promise<typeof import('./code-highlight')>|undefined,scheduled=false;
const load=()=>module??=import(new URL('./highlight.js',import.meta.url).href) as Promise<typeof import('./code-highlight')>;
function roleHighlight(role:string){
  let set=highlights.get(role);
  // Below annotations, find and the current match, which may recolor the text.
  if(!set){set=new Highlight();set.priority=-1;highlights.set(role,set);CSS.highlights.set('reader-syntax-'+role,set);}
  return set;
}
function prune(){for(const code of watching)if(!code.isConnected){nearby?.unobserve(code);watching.delete(code);}
  for(const [code,ranges] of owned)if(!code.isConnected){for(const {role,range} of ranges)highlights.get(role)?.delete(range);owned.delete(code);}}
const idle=(callback:()=>void)=>'requestIdleCallback' in window?requestIdleCallback(callback,{timeout:2000}):setTimeout(callback,16);
export function scheduleHighlight(){
  if(scheduled||!('highlights' in CSS)||typeof Highlight==='undefined')return;scheduled=true;
  idle(()=>{scheduled=false;void highlightPending();});
}
async function highlightPending(){
  prune();
  const pending=[...document.querySelectorAll<HTMLElement>('[data-slot="code-block-code"][data-highlight=pending]')];if(!pending.length)return;
  let api:typeof import('./code-highlight');
  try{api=await load();}catch(error){console.warn('Code highlighting did not load',error);for(const code of pending)code.dataset.highlight='off';return;}
  const started=performance.now();
  for(const code of pending){
    if(!code.isConnected||code.dataset.highlight!=='pending')continue;
    const language=code.dataset.language||'';
    if(!api.languageOf(language)){code.dataset.highlight='off';continue;}
    code.dataset.highlight='working';
    let tokens:Token[]|null=null;
    try{tokens=await api.tokenize(codeText(code),language);}catch(error){console.warn('Code highlighting failed',error);}
    if(!tokens||!code.isConnected){code.dataset.highlight='off';continue;}
    paint(code,tokens);code.dataset.highlight='done';
    // Yield after ~12 ms so reading, scrolling and typing stay responsive.
    if(performance.now()-started>12){scheduleHighlight();return;}
  }
}
/** Map token offsets (into the code text) onto its text nodes: one range per token, never across nodes. */
function paint(code:HTMLElement,tokens:Token[]){
  const nodes:{node:Text;start:number}[]=[],walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);
  for(let start=0,node=walker.nextNode() as Text|null;node;node=walker.nextNode() as Text|null){nodes.push({node,start});start+=node.data.length;}
  const ranges:{role:string;range:Range}[]=[];let index=0;
  for(const token of tokens){
    while(index<nodes.length-1&&nodes[index+1].start<=token.offset)index++;
    const at=nodes[index];if(!at)break;
    const from=token.offset-at.start,to=Math.min(at.node.data.length,from+token.length);if(from<0||from>=to)continue;
    const range=document.createRange();range.setStart(at.node,from);range.setEnd(at.node,to);
    roleHighlight(token.role).add(range);ranges.push({role:token.role,range});
  }
  owned.set(code,ranges);
}
