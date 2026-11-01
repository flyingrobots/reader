/** Resolve file: Markdown tokens from source-hash-bound records, before sanitizing HTML.
 * No source text is rewritten, so annotation coordinates continue to address the preserved original. */
export async function portableEnvironment(md,text,record,options={}){
  if(!record?.targets?.length)return {targets:[]};
  const references=[];md.parse(text,{...options,portableCollect:references});
  const byKey=new Map(record.targets.map(r=>[r.key,r]));
  const byFallback=new Map(record.targets.filter(r=>r.fallback_key).map(r=>[r.fallback_key,r]));
  const identity=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const targets=await Promise.all([...new Set(references)].map(async reference=>{
    const [source_url,label,kind]=JSON.parse(reference);
    const value=byKey.get(await identity(reference))||byFallback.get(await identity(JSON.stringify([source_url,kind])));
    return value?{...value,source_url,label,kind}:null;
  }));
  return {targets:targets.filter(Boolean)};
}

export function portableLinkPlugin(md){
  const validate=md.validateLink;
  md.validateLink=url=>/^file:/i.test(url)||validate(url);
  md.core.ruler.after('inline','reader_portable_links',state=>{
    const repairs=new Map((state.env.portableLinks?.targets||[]).map(r=>[JSON.stringify([r.source_url,r.label,r.kind]),r]));
    const safe=target=>{
      if(typeof target!=='string'||/[\\\u0000-\u001f]/.test(target))return false;
      if(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:[\/#]|$)/.test(target))return true;
      try{const path=decodeURIComponent(target.split('#')[0]);return path.startsWith('library/')&&!/[?\\\u0000-\u001f]/.test(path)&&path.split('/').every(p=>p&&!p.startsWith('.'));}catch{return false;}
    };
    function visit(tokens){
      for(let i=0;i<tokens.length;i++){
        const token=tokens[i],isImage=token.type==='image';
        if(isImage||token.type==='link_open'){
          const attr=isImage?'src':'href',url=token.attrGet(attr)||'';
          if(/^file:/i.test(url)){
            let close=i,label=token.content;
            if(!isImage){label='';for(close=i+1;close<tokens.length&&tokens[close].type!=='link_close';close++)label+=tokens[close].content||'';}
            const key=JSON.stringify([url,label,isImage?'image':'link']);
            if(state.env.portableCollect){state.env.portableCollect.push(key);continue;}
            const repair=repairs.get(key);
            if(repair?.status==='resolved'&&safe(repair.target)){token.attrSet(attr,repair.target);}
            else{
              token.attrs=(token.attrs||[]).filter(([name])=>name!==attr);
              token.attrSet('title','Local reference unavailable: '+(repair?.reason||'No current repair record'));
              if(isImage){token.type='text';token.tag='';token.attrs=null;token.children=null;token.content=(label||'Image')+' (local image unavailable)';}
              else{token.tag='span';token.attrJoin('class','local-link-unavailable');token.attrSet('tabindex','0');token.attrSet('aria-label',label+'. '+token.attrGet('title'));if(tokens[close])tokens[close].tag='span';}
            }
          }
        }
        if(token.children&&!isImage)visit(token.children);
      }
    }
    visit(state.tokens);
  });
}
