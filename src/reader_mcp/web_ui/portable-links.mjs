/** Resolve file: Markdown tokens from source-hash-bound records, before sanitizing HTML.
 * No source text is rewritten, so annotation coordinates continue to address the preserved original. */
export function portableLinkPlugin(md){
  const validate=md.validateLink;
  md.validateLink=url=>/^file:/i.test(url)||validate(url);
  md.core.ruler.after('inline','reader_portable_links',state=>{
    const repairs=new Map((state.env.portableLinks?.targets||[]).map(r=>[JSON.stringify([r.source_url,r.label,r.kind]),r]));
    const safe=target=>typeof target==='string'&&(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:[\/#]|$)/.test(target)||/^library\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/.test(target));
    function visit(tokens){
      for(let i=0;i<tokens.length;i++){
        const token=tokens[i],isImage=token.type==='image';
        if(isImage||token.type==='link_open'){
          const attr=isImage?'src':'href',url=token.attrGet(attr)||'';
          if(/^file:/i.test(url)){
            let close=i,label=token.content;
            if(!isImage){label='';for(close=i+1;close<tokens.length&&tokens[close].type!=='link_close';close++)label+=tokens[close].content||'';}
            const repair=repairs.get(JSON.stringify([url,label,isImage?'image':'link']));
            if(repair?.status==='resolved'&&safe(repair.target)){token.attrSet(attr,repair.target);}
            else{
              token.attrs=(token.attrs||[]).filter(([name])=>name!==attr);
              token.attrSet('title','Local reference unavailable: '+(repair?.reason||'No current repair record'));
              if(isImage){token.content=(label||'Image')+' (local image unavailable)';}
              else{token.tag='span';token.attrJoin('class','local-link-unavailable');if(tokens[close])tokens[close].tag='span';}
            }
          }
        }
        if(token.children&&!isImage)visit(token.children);
      }
    }
    visit(state.tokens);
  });
}
