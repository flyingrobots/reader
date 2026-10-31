import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {InfoIcon, PanelRightCloseIcon, PanelRightOpenIcon} from 'lucide-react';
import {cn} from 'cn';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Field, FieldLabel} from '@/components/ui/field';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import {ADMIN_DOCUMENTS} from './documentation-topics';

const slug=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-');
type HelpContext={jump:(section:string)=>void;ids:Set<string>;aliases:Record<string,string>};
const DocumentationContext=createContext<HelpContext|null>(null);
export function AdminDocHelp({title,section}:{title:string;section?:string}){
  const context=useContext(DocumentationContext);if(!context)return null;
  const named=slug(title),target=section||context.aliases[named]||named;
  if(!context.ids.has(target))return null;
  return <Button type="button" variant="ghost" size="icon-xs" aria-label={'About '+title} title={'Read documentation: '+title} data-admin-doc-link={target} onClick={()=>context.jump(target)}><InfoIcon aria-hidden/></Button>;
}
export function AdminDocumentationWorkspace({topic,markdown,children}:{topic:string;markdown:(text:string)=>string;children:ReactNode}){
  const body=useRef<HTMLDivElement|null>(null),panel=useRef<HTMLDivElement|null>(null),[section,setSection]=useState('overview');
  const topicDocument=ADMIN_DOCUMENTS[topic],reference=topicDocument.source;
  const headings=useMemo(()=>[...reference.matchAll(/^#{2,3} (.+)$/gm)].map(match=>({title:match[1],id:slug(match[1])})),[reference]);
  const sectionRef=useRef(section);sectionRef.current=section;
  const [visible,setVisible]=useState(()=>{try{return (localStorage.getItem('reader.admin.docs.visible.v1')??localStorage.getItem('reader.indexes.docs.visible.v1'))!=='false';}catch{return true;}}),jumpFrame=useRef(0);
  useEffect(()=>{try{localStorage.setItem('reader.admin.docs.visible.v1',String(visible));}catch{}},[visible]);
  useEffect(()=>()=>cancelAnimationFrame(jumpFrame.current),[]);
  const html=useMemo(()=>markdown(reference),[markdown,reference]);
  const jump=useCallback((id:string)=>{
    setVisible(true);setSection(id);cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current=requestAnimationFrame(()=>{
      const element=body.current,target=element?.querySelector<HTMLElement>('#admin-doc-'+id);if(!target||!element||panel.current?.hidden)return;
      element.scrollTo({top:Math.max(0,element.scrollTop+target.getBoundingClientRect().top-element.getBoundingClientRect().top-16),behavior:'instant'});target.focus({preventScroll:true});
      if(matchMedia('(max-width:1023px)').matches)panel.current?.scrollIntoView({block:'start',behavior:'instant'});
    });
  },[]);
  useLayoutEffect(()=>{
    const element=body.current;if(!element)return;
    try{const saved=JSON.parse(sessionStorage.getItem('reader.admin.docs.position.'+topic)||'null');if(saved&&Number.isFinite(saved.top)&&saved.top>=0&&saved.top<1e7){element.scrollTop=saved.top;setSection(headings.some(h=>h.id===saved.section)?saved.section:'overview');}else{element.scrollTop=0;setSection('overview');}}catch{element.scrollTop=0;setSection('overview');}
    for(const heading of element.querySelectorAll<HTMLElement>('h1,h2,h3')){heading.id='admin-doc-'+slug(heading.textContent||'');heading.tabIndex=-1;}
    for(const table of element.querySelectorAll('table')){if(table.parentElement?.classList.contains('admin-doc-table'))continue;const wrap=document.createElement('div');wrap.className='admin-doc-table';table.before(wrap);wrap.append(table);}
    for(const link of element.querySelectorAll<HTMLAnchorElement>('a[href]')){const href=link.getAttribute('href')||'';if(!href.startsWith('#')){link.href=new URL(href,'https://github.com/flyingrobots/reader/blob/main/docs/topics/'+topic+'.md').href;link.target='_blank';link.rel='noreferrer noopener';}}
    const save=()=>{try{sessionStorage.setItem('reader.admin.docs.position.'+topic,JSON.stringify({top:element.scrollTop,section:sectionRef.current}));}catch{}};
    window.addEventListener('pagehide',save);return ()=>{save();window.removeEventListener('pagehide',save);cancelAnimationFrame(jumpFrame.current);};
  },[html,topic,headings]);
  return <DocumentationContext.Provider value={{jump,ids:new Set(headings.map(h=>h.id)),aliases:topicDocument.aliases||{}}}>
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-end gap-2"><AdminDocHelp title={topicDocument.title+' reference'} section="overview"/><Button id="admin-doc-toggle" variant="outline" size="sm" aria-controls="admin-reference-pane" aria-expanded={visible} onClick={()=>{cancelAnimationFrame(jumpFrame.current);setVisible(value=>!value);}}>
        {visible?<PanelRightCloseIcon data-icon="inline-start" aria-hidden/>:<PanelRightOpenIcon data-icon="inline-start" aria-hidden/>}{visible?'Hide documentation':'Show documentation'}
      </Button></div>
      <div id="admin-workspace" data-docs-visible={visible} className={cn('grid min-w-0 gap-4',visible?'lg:grid-cols-2':'grid-cols-1')}>
      <div id="admin-dashboard-pane" className="min-w-0 lg:h-[calc(100dvh-17.5rem)] lg:min-h-80 lg:overflow-y-auto lg:overscroll-contain lg:pr-2" role="region" aria-label={topicDocument.title+' dashboard'} tabIndex={0}>{children}</div>
      <Card ref={panel} id="admin-reference-pane" hidden={!visible} className="min-w-0 gap-0 lg:h-[calc(100dvh-17.5rem)] lg:min-h-80" data-doc-section={section} data-doc-topic={topic}>
        <CardHeader className="gap-3 pb-3"><CardTitle role="heading" aria-level={2}>{topicDocument.title} reference</CardTitle>
          <Field><FieldLabel htmlFor="admin-doc-contents">Contents</FieldLabel><NativeSelect id="admin-doc-contents" className="w-full" value={headings.some(h=>h.id===section)?section:'overview'} onChange={event=>jump(event.target.value)}>{headings.map(heading=><NativeSelectOption key={heading.id} value={heading.id}>{heading.title}</NativeSelectOption>)}</NativeSelect></Field>
        </CardHeader>
        <CardContent ref={body} id="admin-doc-body" className="admin-doc-body relative max-h-[75dvh] min-h-0 flex-1 overflow-auto overscroll-contain" role="region" aria-label={topicDocument.title+' documentation'} tabIndex={0}
          onClick={event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');if(!link)return;event.preventDefault();jump(decodeURIComponent(link.hash.slice(1)));}}
          dangerouslySetInnerHTML={{__html:html}}/>
      </Card>
      </div>
    </div>
  </DocumentationContext.Provider>;
}
