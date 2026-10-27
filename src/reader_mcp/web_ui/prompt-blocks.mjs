/* `reader:prompt` v1 blocks (RW-44): an article's repair prompt, shown as a prompt card that can become a
   coding job. The same rules as src/reader_mcp/prompt_blocks.py, applied to markdown-it's own block tokens
   before rendering and sanitizing: a top-level column-0 HTML block `<!-- reader:prompt {JSON} -->`, one
   top-level column-0 `text` fence, and `<!-- /reader:prompt -->`, with only blank lines between. Metadata is
   a flat JSON object (strings, integers, null; no duplicate keys). Anything else stays ordinary Markdown.
   Pure (no DOM), so Node tests run it against the vendored markdown-it and the Python parser.

   Rendering: a valid block's markers render as nothing and its fence is wrapped in
   <div class="reader-prompt" data-reader-prompt="NONCE:INDEX">, where NONCE is fresh for every render.
   The page mounts cards only for wrappers carrying its own nonce, so raw HTML in an article cannot
   manufacture a card; the server re-reads the source anyway before it admits a run. */
export const VERSION=1,MAX_METADATA=2048,MAX_PROMPT=32*1024,MAX_TITLE=160,MAX_ISSUE=2**31-1;
const FIELDS=['v','id','title','repo','issue'];
const OPEN='<!-- reader:prompt',CLOSE='<!-- /reader:prompt';
const ID=/^[a-z0-9-]{1,64}$/,OWNER=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/,REPO_NAME=/^[A-Za-z0-9._-]{1,100}$/;
const CONTROL=/[\u0000-\u001f\u007f-\u009f]/;
const BLANK=/^[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/;
const TOKEN=/[ \t\n\r]*(?:("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")|(-?(?:0|[1-9][0-9]{0,15}))(?![0-9.eE])|(null)|([{}:,]))/y;
const TRAILING=/^[ \t\n\r]*$/;
const utf8=text=>new TextEncoder().encode(text).length;
const trimEnd=text=>text.replace(/[ \t]+$/,'');

export function repositoryName(value){
  if(typeof value!=='string'||value.split('/').length!==2)return false;
  const [owner,name]=value.split('/');
  return OWNER.test(owner)&&REPO_NAME.test(name)&&name!=='.'&&name!=='..'&&!name.toLowerCase().endsWith('.git');
}

/** A flat JSON object of strings, integers and nulls, or null. */
export function flatJson(text){
  const tokens=[];let pos=0;
  while(pos<text.length){
    TOKEN.lastIndex=pos;const match=TOKEN.exec(text);
    if(!match){if(TRAILING.test(text.slice(pos)))break;return null;}
    pos=TOKEN.lastIndex;
    const [,string,number,nil,punct]=match;
    tokens.push(string!==undefined?['s',JSON.parse(string)]:number!==undefined?['n',Number(number)]:nil?['z',null]:['p',punct]);
    if(tokens.length>64)return null;
  }
  const is=(token,kind,value)=>token&&token[0]===kind&&(value===undefined||token[1]===value);
  if(tokens.length<2||!is(tokens[0],'p','{')||!is(tokens.at(-1),'p','}'))return null;
  const body=tokens.slice(1,-1),result=Object.create(null);
  for(let index=0;index<body.length;index+=4){
    const pair=body.slice(index,index+4);
    if(pair.length<3||!is(pair[0],'s')||!is(pair[1],'p',':')||pair[2][0]==='p')return null;
    if(pair.length===4&&(!is(pair[3],'p',',')||index+4>=body.length))return null;
    if(Object.hasOwn(result,pair[0][1]))return null;
    result[pair[0][1]]=pair[2][1];
  }
  return result;
}

/** [fields, null] for valid v1 metadata, else [partial fields or null, reason]. */
export function metadata(text){
  if(utf8(text)>MAX_METADATA)return [null,'metadata-size'];
  if(['<!--','-->','--!>'].some(seq=>text.includes(seq)))return [null,'metadata-unsafe'];
  const data=flatJson(text);
  if(!data)return [null,'metadata-json'];
  if(!Number.isInteger(data.v))return [data,'metadata-fields'];
  if(data.v!==VERSION)return [data,'version'];
  const keys=Object.keys(data);
  if(keys.length!==FIELDS.length||!FIELDS.every(key=>keys.includes(key)))return [data,'metadata-fields'];
  if(typeof data.id!=='string'||!ID.test(data.id))return [data,'id'];
  const title=data.title;
  if(typeof title!=='string'||!title.isWellFormed()||BLANK.test(title)||[...title].length>MAX_TITLE||CONTROL.test(title))return [data,'title'];
  if(!repositoryName(data.repo))return [data,'repo'];
  if(data.issue!==null&&!(Number.isInteger(data.issue)&&data.issue>=1&&data.issue<=MAX_ISSUE))return [data,'issue'];
  return [data,null];
}

function shape(token){
  if(token.type!=='html_block')return null;
  const first=token.content.replace(/^[ \t]+/,'').split('\n')[0];
  if(first.startsWith(CLOSE))return 'close';
  if(first.startsWith(OPEN)&&(first.length===OPEN.length||first[OPEN.length]===' '||first[OPEN.length]==='\t'))return 'open';
  return null;
}
function singleLine(token){const text=token.content.endsWith('\n')?token.content.slice(0,-1):token.content;return text.includes('\n')?null:text;}

/** Valid blocks and rejections from markdown-it block tokens of `src` (the normalized body it parsed).
 *  Blocks carry their tokens under a non-enumerable `tokens` key for the renderer. */
export function findPrompts(tokens,src){
  const lines=src.split('\n');
  const top=tokens.filter(t=>t.level===0&&t.block&&(t.nesting===0||t.nesting===1));
  const candidates=[],rejected=[];let depth=0;
  top.forEach((token,index)=>{
    const kind=shape(token);
    if(kind==='close'){depth=Math.max(0,depth-1);return;}
    if(kind!=='open')return;
    const line=token.map[0],nested=depth>0;depth++;
    const fence=top[index+1],close=top[index+2];
    if(nested){rejected.push({line,reason:'nested'});return;}
    if(!fence||fence.type!=='fence'||!close||shape(close)!=='close'){rejected.push({line,reason:'structure'});return;}
    candidates.push({line,token,fence,close});
  });
  const rows=[],seen=new Map();
  for(const {line,token,fence,close} of candidates){
    const opener=singleLine(token),closer=singleLine(close);
    let reason=null,data=null;
    if(opener===null||!opener.startsWith(OPEN+' ')||!trimEnd(opener).endsWith(' -->'))reason='marker';
    else if(closer===null||trimEnd(closer)!==CLOSE+' -->')reason='marker';
    else if(lines[fence.map[0]]!==fence.markup+'text'||fence.info!=='text')reason='fence';
    else{
      [data,reason]=metadata(trimEnd(opener).slice(OPEN.length+1,-' -->'.length));
      if(reason===null)reason=utf8(fence.content)>MAX_PROMPT?'prompt-size':BLANK.test(fence.content)?'prompt-empty':null;
    }
    const id=data&&typeof data.id==='string'&&ID.test(data.id)?data.id:null;
    if(id)seen.set(id,(seen.get(id)||0)+1);
    rows.push({line,endLine:close.map[1],id,reason,data,token,fence,close});
  }
  const blocks=[];
  for(const row of rows){
    if(row.id&&seen.get(row.id)>1)row.reason='duplicate-id';
    if(row.reason){rejected.push({line:row.line,reason:row.reason,...(row.id?{id:row.id}:{})});continue;}
    const block={id:row.data.id,title:row.data.title,repo:row.data.repo,issue:row.data.issue,prompt:row.fence.content,line:row.line,endLine:row.endLine};
    Object.defineProperty(block,'tokens',{value:[row.token,row.fence,row.close]});
    blocks.push(block);
  }
  rejected.sort((a,b)=>a.line-b.line);
  return {blocks,rejected};
}

const nonce=()=>{const bytes=new Uint8Array(12);globalThis.crypto.getRandomValues(bytes);return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');};

/** markdown-it plugin. A render whose env carries `prompts: {}` gets env.prompts = {nonce, blocks, rejected};
 *  without it (embeds, chat, scratch) prompt blocks render as ordinary code. */
export function promptPlugin(md){
  md.core.ruler.after('block','reader_prompts',state=>{
    const sink=state.env?.prompts;if(!sink)return;
    const found=findPrompts(state.tokens,state.src);
    Object.assign(sink,{nonce:nonce(),blocks:found.blocks,rejected:found.rejected});
    found.blocks.forEach((block,index)=>{const [open,fence,close]=block.tokens;open.meta={...open.meta,readerPromptMarker:true};close.meta={...close.meta,readerPromptMarker:true};fence.meta={...fence.meta,readerPrompt:index};});
  });
  const html=md.renderer.rules.html_block,fence=md.renderer.rules.fence;
  md.renderer.rules.html_block=(tokens,index,options,env,self)=>tokens[index].meta?.readerPromptMarker&&env?.prompts?'':html(tokens,index,options,env,self);
  md.renderer.rules.fence=(tokens,index,options,env,self)=>{
    const inner=fence(tokens,index,options,env,self),at=tokens[index].meta?.readerPrompt;
    return at===undefined||!env?.prompts?.nonce?inner:`<div class="reader-prompt" data-reader-prompt="${env.prompts.nonce}:${at}" data-reader-decoration="">${inner}</div>\n`;
  };
}

/** The blocks a rendered container may mount: wrappers with this render's nonce, each at most once. */
export function promptMounts(container,prompts){
  if(!prompts?.nonce)return [];
  const used=new Set();
  return [...container.querySelectorAll('[data-reader-prompt]')].flatMap(element=>{
    const [mark,at]=String(element.getAttribute('data-reader-prompt')).split(':'),index=Number(at);
    if(mark!==prompts.nonce||!Number.isInteger(index)||!prompts.blocks[index]||used.has(index))return [];
    used.add(index);return [{element,block:prompts.blocks[index]}];
  });
}
