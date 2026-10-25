/** Obsidian-style embeds, rendered live: `![[note]]`, `![[note#Heading]]`, `![[note#^block]]`, `![[pic.png|300]]`,
 *  `![[paper.pdf#page=3]]`. markdown-it finds them (never in code), the server resolves the tree (/api/embeds,
 *  src/reader_mcp/embeds.py) and each embedded fragment renders with the embedded file's own source offsets, so
 *  annotations made inside an embed belong to that file. Everything an embed adds around the text is decoration. */

export const LIMITS={depth:4,eager:16,batch:16,total:200,pdf:12};
const MARKDOWN=['.md','.markdown'],IMAGES=['.png','.jpg','.jpeg','.gif','.webp','.svg','.avif','.bmp'];
const AUDIO=['.mp3','.wav','.m4a','.ogg','.flac','.webm'],VIDEO=['.mp4','.mov','.mkv','.ogv'];
const KNOWN=[...MARKDOWN,...IMAGES,...AUDIO,...VIDEO,'.pdf','.txt','.json','.csv','.html','.canvas'];

/** 'markdown', 'image', 'pdf', 'audio', 'video' or 'other'; an unknown extension is part of a note's name. */
export function kindOf(path){
  const name=String(path).split('/').pop().toLowerCase(),ext=name.includes('.')?'.'+name.split('.').pop():'';
  if(!KNOWN.includes(ext)||MARKDOWN.includes(ext))return 'markdown';
  return IMAGES.includes(ext)?'image':ext==='.pdf'?'pdf':AUDIO.includes(ext)?'audio':VIDEO.includes(ext)?'video':'other';
}
/** The parts of an embed's inner text, as embeds.parse() reads them on the server. */
export function parseEmbed(raw){
  raw=String(raw).slice(0,2000);
  const unescaped=raw.replace(/\\\|/g,'|'),bar=unescaped.indexOf('|');
  const head=bar<0?unescaped:unescaped.slice(0,bar);let alias=bar<0?'':unescaped.slice(bar+1).trim();
  const hash=head.indexOf('#'),target=(hash<0?head:head.slice(0,hash)).trim(),fragment=hash<0?'':head.slice(hash+1).trim();
  const kind=target?kindOf(target):'markdown';let width=null,height=null,page=null;
  if(kind==='image'&&bar>=0){const size=alias.match(/^\s*(\d{1,5})(?:\s*x\s*(\d{1,5}))?\s*$/);if(size){width=+size[1];height=size[2]?+size[2]:null;alias='';}}
  if(kind==='pdf'){const match=fragment.match(/^page=(\d{1,5})$/);page=match?+match[1]:null;}
  return {raw,target,fragment,alias,kind,width,height,page};
}
/** Code point offset -> UTF-16 index in text: one scan, then O(log n) per lookup. */
export function unitIndex(text){
  const pairs=[];for(let i=0,cp=0;i<text.length;i++,cp++){const c=text.charCodeAt(i),d=text.charCodeAt(i+1);if(c>=0xD800&&c<=0xDBFF&&d>=0xDC00&&d<=0xDFFF){pairs.push(cp);i++;}}
  return cp=>{let lo=0,hi=pairs.length;while(lo<hi){const mid=(lo+hi)>>1;if(pairs[mid]<cp)lo=mid+1;else hi=mid;}return Math.min(text.length,cp+lo);};
}
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BLOCK_ID=/[ \t]+\^[A-Za-z0-9-]{1,64}[ \t]*$/,ONLY_ID=/^\^[A-Za-z0-9-]{1,64}[ \t]*$/;

/** markdown-it rules: `![[…]]` embeds and `[[…]]` wikilinks as inline tokens (so code spans and fences keep
 *  them literally, and `\![[` is a `!` and a link), and Obsidian block ids hidden from the rendered text. */
export function embedPlugin(md){
  const inner=(state,from)=>{const src=state.src;let i=from;while(i<state.posMax&&src[i]!==']'&&src[i]!=='['&&src[i]!=='\n')i++;return src.startsWith(']]',i)&&i>from?i:-1;};
  md.inline.ruler.before('image','reader_embed',(state,silent)=>{
    const at=state.pos;if(state.src.charCodeAt(at)!==0x21||!state.src.startsWith('[[',at+1))return false;
    const end=inner(state,at+3);if(end<0)return false;
    if(!silent){const token=state.push('reader_embed','',0);token.meta=parseEmbed(state.src.slice(at+3,end));}
    state.pos=end+2;return true;
  });
  md.inline.ruler.before('link','reader_wikilink',(state,silent)=>{
    const at=state.pos;if(!state.src.startsWith('[[',at))return false;
    const end=inner(state,at+2);if(end<0)return false;
    const body=state.src.slice(at+2,end),bar=body.indexOf('|'),target=bar<0?body:body.slice(0,bar),label=bar<0?'':body.slice(bar+1);
    if(!target.trim())return false;
    const href=encodeURI(target);if(!md.validateLink(href))return false;
    if(!silent){const open=state.push('link_open','a',1);open.attrs=[['href',href]];open.markup='wikilink';const text=state.push('text','',0);text.content=label||target;state.push('link_close','a',-1);}
    state.pos=end+2;return true;
  });
  md.renderer.rules.reader_embed=(tokens,index,options,env)=>{
    const e=tokens[index].meta;
    if(!env?.embeds)return escape('![['+e.raw+']]');  // Chat bodies and other plain renders keep the text.
    if(e.kind==='image'&&e.target)return `<img class="embed-image" data-embed-image src="${escape(e.target)}" alt="${escape(e.alias||e.target.split('/').pop())}"${e.width?` width="${e.width}"`:''}${e.height?` height="${e.height}"`:''}>`;
    const tag=e.block?'div':'span';
    return `<${tag} class="document-embed" data-embed="${escape(e.raw)}" data-embed-kind="${e.kind}"></${tag}>`;
  };
  md.core.ruler.after('inline','reader_block_ids',state=>{
    for(let i=0;i<state.tokens.length;i++){
      const token=state.tokens[i];if(token.type!=='inline'||!token.children?.length)continue;
      // A paragraph of nothing but document embeds becomes those embeds, as blocks (never a <div> inside a <p>).
      const solid=token.children.filter(child=>child.type!=='softbreak'&&!(child.type==='text'&&!child.content.trim()));
      if(state.tokens[i-1]?.type==='paragraph_open'&&solid.length&&solid.every(child=>child.type==='reader_embed'&&child.meta.kind!=='image')){
        state.tokens[i-1].hidden=state.tokens[i+1].hidden=true;for(const child of solid)child.meta.block=true;continue;}
      const children=token.children,last=children.at(-1);if(last.type!=='text')continue;
      if(ONLY_ID.test(last.content)&&children.length===1){last.content='';if(state.tokens[i-1]?.type==='paragraph_open')state.tokens[i-1].attrSet('hidden','');continue;}
      if(ONLY_ID.test(last.content)&&children.at(-2)?.type==='softbreak'){children.splice(-2,2);continue;}
      if(BLOCK_ID.test(last.content))last.content=last.content.replace(BLOCK_ID,'');
    }
  });
}

/** The live embed controller for the open document. `render(container, text, path, depth, {range, chain, children})`
 *  renders one fragment (and mounts its embeds); `changed(contents)` runs after embeds arrive late. */
export function installEmbeds({api,param,render,wire,pdfPage,navigate,changed=()=>{}}){
  let docs=new Map(),units=new Map(),hostPath=null,generation=0,observer=null,waiting=new Map(),shown=0,pdfs=0,flushing=null;
  const twoPage=()=>document.body.classList.contains('two-page');
  function reset(){generation++;hostPath=null;docs=new Map();units=new Map();observer?.disconnect();observer=null;waiting=new Map();shown=0;pdfs=0;}
  const doc=path=>docs.get(path)||null;
  const unit=(path,cp)=>{if(!units.has(path))units.set(path,unitIndex(docs.get(path).text));return units.get(path)(cp);};
  const keyOf=(path,fragment)=>path+'#'+(fragment||'');

  function header(el,node){
    const label=node.alias||node.title||node.path?.split('/').pop()||node.target,where=node.page?' · page '+node.page:node.fragment?' · '+node.fragment.replace(/^\^/,'^'):'';
    const bar=document.createElement('div');bar.className='embed-header';bar.dataset.readerDecoration='';
    const link=document.createElement('a');link.className='embed-source';link.href='#read='+param(node.path)+(node.page?'&at='+param(JSON.stringify({page:node.page})):'');link.dataset.embedOpen='';
    link.title='Open '+(node.title||node.path);link.append('from ');const cite=document.createElement('cite');cite.textContent=label;link.append(cite,where+' ↗');
    link.addEventListener('click',event=>{event.preventDefault();const heading=node.fragment&&!node.fragment.startsWith('^')&&node.kind==='markdown'?node.fragment.split('#').filter(Boolean).pop():'';navigate(node.path,{fragment:heading,at:node.page?{line:1,page:node.page,terms:[],query:''}:null});});
    bar.append(link);el.append(bar);
  }
  const MESSAGES={missing:'No document matches this embed',ambiguous:'This embed matches more than one document; write a longer path',cycle:'This document embeds itself here; it is shown once',
    depth:`Embedded more than ${LIMITS.depth} levels deep`,'too-large':'Too large to embed','no-fragment':'Nothing in the document matches this section',
    unsupported:'This kind of file can’t be embedded',error:'This embedded document couldn’t be read',limit:`Only the first ${LIMITS.total} embeds in a document are shown`};
  function note(el,state,node){
    el.dataset.embedState=state;el.replaceChildren();if(node?.path&&state!=='missing'&&state!=='ambiguous')header(el,node);
    const p=document.createElement('p');p.className='embed-note';p.dataset.readerDecoration='';
    p.textContent=(MESSAGES[state]||'Embedded document')+(state==='no-fragment'&&node.fragment?`: “${node.fragment}”`:'')+(state==='too-large'&&node.bytes?` (${Math.round(node.bytes/1024).toLocaleString('en')} KB)`:'')+(node?.path?'':` · ${node?.target||el.dataset.embed}`);
    el.append(p);
  }
  function placeholder(el,text,state){el.dataset.embedState=state;el.replaceChildren();const p=document.createElement('p');p.className='embed-note';p.dataset.readerDecoration='';p.textContent=text;el.append(p);}

  /** Show one resolved node in its placeholder. */
  async function apply(el,node,chain,depth,id){
    if(id!==generation||!el.isConnected)return null;
    if(node.status==='deferred'){defer(el,chain,depth);return null;}
    if(node.status!=='ok'){note(el,node.status,node);return null;}
    if(shown>=LIMITS.total){note(el,'limit',node);return null;}
    shown++;
    if(node.kind==='pdf'){
      el.dataset.embedState='ok';el.replaceChildren();header(el,node);
      if(pdfs>=LIMITS.pdf){const p=document.createElement('p');p.className='embed-note';p.dataset.readerDecoration='';p.textContent=`Only the first ${LIMITS.pdf} PDF embeds are drawn; open this one to read it`;el.append(p);return null;}
      pdfs++;const frame=document.createElement('div');frame.className='embed-pdf';frame.dataset.readerDecoration='';el.append(frame);
      // Drawn when it nears the viewport; the document never waits for it.
      pdfPage(frame,'/api/file?path='+param(node.path),node.page||1).catch(()=>{frame.remove();const p=document.createElement('p');p.className='embed-note';p.dataset.readerDecoration='';p.textContent='This PDF page couldn’t be drawn';el.append(p);});
      return null;
    }
    if(node.kind==='image'){el.dataset.embedState='ok';el.replaceChildren();const img=document.createElement('img');img.className='embed-image';img.src='/api/file?path='+param(node.path);img.alt=node.alias||node.target;if(node.width)img.width=node.width;if(node.height)img.height=node.height;el.append(img);return null;}
    const key=keyOf(node.path,node.fragment);
    if(chain.includes(key)){note(el,'cycle',node);return null;}
    const source=docs.get(node.path);if(!source){note(el,'error',node);return null;}
    el.dataset.embedState='ok';el.replaceChildren();header(el,node);
    const content=document.createElement('div');content.className='embedded-content';content.dataset.sourcePath=node.path;content.dataset.embedStart=node.start;content.dataset.embedEnd=node.end;el.append(content);
    await render(content,source.text,node.path,depth,{range:[unit(node.path,node.start),unit(node.path,node.end)],chain:[...chain,key],children:node.children||[]});
    wire(content,node.path);return content;
  }
  /** Ask the server about the embeds written in `from`; documents arrive once per response. */
  async function resolve(from,raws,chain,depth){
    const query='/api/embeds?from='+param(from)+'&depth='+(depth-1)+chain.map(key=>'&ancestor='+param(key)).join('')+raws.map(raw=>'&target='+param(raw)).join('');
    const data=await api(query);
    for(const [path,value] of Object.entries(data.documents||{}))if(!docs.has(path))docs.set(path,{...value,path,kind:'.'+path.split('.').pop()});
    return data.nodes;
  }
  async function load(items,from,chain,depth,id){
    const contents=[];
    for(let i=0;i<items.length;i+=LIMITS.batch){
      const batch=items.slice(i,i+LIMITS.batch);
      let nodes;try{nodes=await resolve(from,batch.map(el=>el.dataset.embed),chain,depth);}catch{for(const el of batch)note(el,'error',{target:el.dataset.embed});continue;}
      if(id!==generation)return contents;
      for(const [index,el] of batch.entries()){const content=await apply(el,nodes[index],chain,depth,id);if(content)contents.push(content);}
    }
    return contents;
  }
  /** Mount the embeds a fragment rendered: the server's nested nodes when known, else fetched (eagerly or lazily). */
  async function mount(container,from,{depth=0,chain=[],children=null}={}){
    const id=generation,level=depth+1;
    const scope=container.closest('.embedded-content')||null;
    const els=[...container.querySelectorAll('[data-embed]:not([data-embed-state])')].filter(el=>(el.parentElement.closest('.embedded-content')||null)===scope);
    if(!els.length)return;
    if(!chain.length){chain=[keyOf(from,'')];hostPath=from;}
    if(level>LIMITS.depth){for(const el of els)note(el,'depth',{...parseEmbed(el.dataset.embed),path:null});return;}
    for(const el of els)placeholder(el,'Embedded document · loading…','loading');
    const rest=[];
    if(children){
      const queues=new Map();for(const node of children){if(!queues.has(node.raw))queues.set(node.raw,[]);queues.get(node.raw).push(node);}
      for(const el of els){const node=queues.get(el.dataset.embed)?.shift();if(node)await apply(el,node,chain,level,id);else rest.push(el);}
      if(rest.length)await load(rest,from,chain,level,id);
      return;
    }
    const eager=els.slice(0,LIMITS.eager);
    await load(eager,from,chain,level,id);
    for(const el of els.slice(LIMITS.eager))defer(el,chain,level,from);
  }
  /** Embeds past the first few load as they near the viewport (all of them, in the background, in two-page mode). */
  function defer(el,chain,depth,from=null){
    from??=el.parentElement.closest('.embedded-content')?.dataset.sourcePath||hostPath;
    placeholder(el,'Embedded document · loads as you read','deferred');
    waiting.set(el,{chain,depth,from});
    if(twoPage()){flush();return;}
    observer??=new IntersectionObserver(entries=>{let any=false;for(const entry of entries)if(entry.isIntersecting&&waiting.has(entry.target)){waiting.get(entry.target).ready=true;observer.unobserve(entry.target);any=true;}if(any)flush();},{rootMargin:'1200px 0px'});
    observer.observe(el);
  }
  function flush(){
    if(flushing)return flushing;
    const id=generation;
    flushing=(async()=>{
      await new Promise(resolve=>requestAnimationFrame(resolve));
      while(id===generation){
        const ready=[...waiting].filter(([el,info])=>el.isConnected&&(info.ready||twoPage()));if(!ready.length)break;
        const [,info]=ready[0],group=ready.filter(([,other])=>other.from===info.from&&other.chain.join('\n')===info.chain.join('\n')).slice(0,LIMITS.batch).map(([el])=>el);
        for(const el of group)waiting.delete(el);
        const contents=await load(group,info.from||'',info.chain,info.depth,id);
        if(id===generation)changed(contents);
      }
    })().finally(()=>{flushing=null;});
    return flushing;
  }
  /** Every embedded fragment on the page, with its file and code point range. */
  function scopes(root){return [...root.querySelectorAll('.embedded-content[data-source-path]')];}
  return {reset,mount,doc,scopes,flush,pending:()=>waiting.size};
}
