import {createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {InfoIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Field, FieldLabel} from '@/components/ui/field';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import reference from '../../../../docs/topics/indexes.md';

const slug=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-');
const headings=[...reference.matchAll(/^#{2,3} (.+)$/gm)].map(match=>({title:match[1],id:slug(match[1])}));
const DocumentationContext=createContext<(section:string)=>void>(()=>{});
export function IndexDocHelp({title,section}:{title:string;section:string}){
  const open=useContext(DocumentationContext);
  return <Button type="button" variant="ghost" size="icon-xs" aria-label={'About '+title} title={'Read documentation: '+title} data-index-doc-link={section} onClick={()=>open(section)}><InfoIcon aria-hidden/></Button>;
}
export function IndexWorkspace({markdown,children}:{markdown:(text:string)=>string;children:ReactNode}){
  const body=useRef<HTMLDivElement|null>(null),panel=useRef<HTMLDivElement|null>(null),[section,setSection]=useState('overview');
  const html=useMemo(()=>markdown(reference),[markdown]);
  const jump=useCallback((id:string)=>{
    const target=body.current?.querySelector<HTMLElement>('#index-doc-'+id);if(!target)return;
    setSection(id);body.current!.scrollTo({top:Math.max(0,body.current!.scrollTop+target.getBoundingClientRect().top-body.current!.getBoundingClientRect().top-16),behavior:'instant'});target.focus({preventScroll:true});
    if(matchMedia('(max-width:1023px)').matches)panel.current?.scrollIntoView({block:'start',behavior:'instant'});
  },[]);
  useLayoutEffect(()=>{
    const element=body.current;if(!element)return;
    for(const heading of element.querySelectorAll<HTMLElement>('h1,h2,h3')){heading.id='index-doc-'+slug(heading.textContent||'');heading.tabIndex=-1;}
    for(const table of element.querySelectorAll('table')){if(table.parentElement?.classList.contains('index-doc-table'))continue;const wrap=document.createElement('div');wrap.className='index-doc-table';table.before(wrap);wrap.append(table);}
    for(const link of element.querySelectorAll<HTMLAnchorElement>('a[href]')){const href=link.getAttribute('href')||'';if(!href.startsWith('#')){link.href=new URL(href,'https://github.com/flyingrobots/reader/blob/main/docs/topics/indexes.md').href;link.target='_blank';link.rel='noreferrer noopener';}}
  },[html]);
  return <DocumentationContext.Provider value={jump}>
    <div id="indexes-workspace" className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div id="index-dashboard-pane" className="min-w-0 lg:h-[calc(100dvh-15rem)] lg:min-h-80 lg:overflow-y-auto lg:overscroll-contain lg:pr-2" role="region" aria-label="Index dashboard" tabIndex={0}>{children}</div>
      <Card ref={panel} id="index-reference-pane" className="min-w-0 gap-0 lg:h-[calc(100dvh-15rem)] lg:min-h-80" data-doc-section={section}>
        <CardHeader className="gap-3 pb-3"><CardTitle role="heading" aria-level={2}>Indexes reference</CardTitle>
          <Field><FieldLabel htmlFor="index-doc-contents">Contents</FieldLabel><NativeSelect id="index-doc-contents" className="w-full" value={headings.some(h=>h.id===section)?section:'overview'} onChange={event=>jump(event.target.value)}>{headings.map(heading=><NativeSelectOption key={heading.id} value={heading.id}>{heading.title}</NativeSelectOption>)}</NativeSelect></Field>
        </CardHeader>
        <CardContent ref={body} id="index-doc-body" className="index-doc-body relative max-h-[75dvh] min-h-0 flex-1 overflow-auto overscroll-contain" role="region" aria-label="Index documentation" tabIndex={0}
          onClick={event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');if(!link)return;event.preventDefault();jump(decodeURIComponent(link.hash.slice(1)));}}
          dangerouslySetInnerHTML={{__html:html}}/>
      </Card>
    </div>
  </DocumentationContext.Provider>;
}
