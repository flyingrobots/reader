import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {BookOpenIcon, InfoIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Field, FieldLabel} from '@/components/ui/field';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {ADMIN_DOCUMENTS} from './documentation-topics';

const slug=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-');
type HelpContext={jump:(section:string)=>void;open:boolean;show:()=>void;ids:Set<string>;aliases:Record<string,string>};
const DocumentationContext=createContext<HelpContext|null>(null);
export function AdminDocHelp({title,section}:{title:string;section?:string}){
  const context=useContext(DocumentationContext);if(!context)return null;
  const named=slug(title),target=section||context.aliases[named]||named;
  if(!context.ids.has(target))return null;
  return <Button type="button" variant="ghost" size="icon-xs" aria-label={'About '+title} title={'Read documentation: '+title} data-admin-doc-link={target} onClick={()=>context.jump(target)}><InfoIcon aria-hidden/></Button>;
}
/** The header button that opens this section's reference; nothing on a route with no section. */
export function AdminDocsButton(){
  const context=useContext(DocumentationContext);if(!context)return null;
  return <Button id="admin-doc-toggle" variant="outline" size="sm" aria-controls="admin-reference-pane" aria-expanded={context.open} onClick={context.show}><BookOpenIcon data-icon="inline-start" aria-hidden/><span className="max-sm:sr-only">Docs</span></Button>;
}
/** Gives the Admin header and page a section's reference, shown over them in a Sheet. The Sheet stays mounted while closed, so its headings, section and scroll position survive. */
export function AdminDocumentationWorkspace({topic,markdown,children}:{topic:string;markdown:(text:string)=>string;children:ReactNode}){
  const body=useRef<HTMLDivElement|null>(null),panel=useRef<HTMLDivElement|null>(null),[section,setSection]=useState('overview');
  // The Sheet's portal mounts after this component's first commit, so setup waits for the element to arrive.
  const [bodyElement,setBodyElement]=useState<HTMLDivElement|null>(null);
  const attachBody=useCallback((element:HTMLDivElement|null)=>{body.current=element;setBodyElement(element);},[]);
  const topicDocument=ADMIN_DOCUMENTS[topic],reference=topicDocument.source;
  const headings=useMemo(()=>[...reference.matchAll(/^#{2,3} (.+)$/gm)].map(match=>({title:match[1],id:slug(match[1])})),[reference]);
  const sectionRef=useRef(section),position=useRef(0),pendingHeading=useRef<string|null>(null),openingHeading=useRef<string|null>(null);sectionRef.current=section;
  const [visible,setVisible]=useState(false),jumpFrame=useRef(0);
  useEffect(()=>()=>cancelAnimationFrame(jumpFrame.current),[]);
  const html=useMemo(()=>markdown(reference),[markdown,reference]);
  const scrollToHeading=useCallback((id:string)=>{
    const element=body.current,target=element?.querySelector<HTMLElement>('#admin-doc-'+id);if(!target||!element)return;
    element.scrollTo({top:Math.max(0,element.scrollTop+target.getBoundingClientRect().top-element.getBoundingClientRect().top-16),behavior:'instant'});position.current=element.scrollTop;target.focus({preventScroll:true});
  },[]);
  const jump=useCallback((id:string)=>{
    pendingHeading.current=id;openingHeading.current=id;setVisible(true);setSection(id);cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current=requestAnimationFrame(()=>{
      if(panel.current?.hidden)return; // Still opening: the observer below takes the jump when the reference has a size.
      pendingHeading.current=null;scrollToHeading(id);
    });
  },[scrollToHeading]);
  // A closed Sheet has no layout and no scroll offset, so its place is restored the moment the reference has a size again.
  useLayoutEffect(()=>{
    const element=bodyElement;if(!element)return;
    let shown=false;
    const observer=new ResizeObserver(()=>{
      const showing=element.clientHeight>0;if(showing===shown)return;shown=showing;if(!showing)return;
      const heading=pendingHeading.current;pendingHeading.current=null;
      if(heading)scrollToHeading(heading);else element.scrollTop=position.current;
    });
    observer.observe(element);return ()=>observer.disconnect();
  },[bodyElement,scrollToHeading]);
  useLayoutEffect(()=>{
    const element=bodyElement;if(!element)return;
    try{const saved=JSON.parse(sessionStorage.getItem('reader.admin.docs.position.'+topic)||'null');if(saved&&Number.isFinite(saved.top)&&saved.top>=0&&saved.top<1e7){position.current=saved.top;setSection(headings.some(h=>h.id===saved.section)?saved.section:'overview');}else{position.current=0;setSection('overview');}}catch{position.current=0;setSection('overview');}
    for(const heading of element.querySelectorAll<HTMLElement>('h1,h2,h3')){heading.id='admin-doc-'+slug(heading.textContent||'');heading.tabIndex=-1;}
    for(const table of element.querySelectorAll('table')){if(table.parentElement?.classList.contains('admin-doc-table'))continue;const wrap=document.createElement('div');wrap.className='admin-doc-table';table.before(wrap);wrap.append(table);}
    for(const link of element.querySelectorAll<HTMLAnchorElement>('a[href]')){const href=link.getAttribute('href')||'';if(!href.startsWith('#')){link.href=new URL(href,'https://github.com/flyingrobots/reader/blob/main/docs/topics/'+topic+'.md').href;link.target='_blank';link.rel='noreferrer noopener';}}
    const referencePanel=panel.current;
    const save=()=>{if(referencePanel?.hidden===false)position.current=element.scrollTop;try{sessionStorage.setItem('reader.admin.docs.position.'+topic,JSON.stringify({top:position.current,section:sectionRef.current}));}catch{}};
    window.addEventListener('pagehide',save);return ()=>{save();window.removeEventListener('pagehide',save);cancelAnimationFrame(jumpFrame.current);};
  },[html,topic,headings,bodyElement]);
  return <DocumentationContext.Provider value={{jump,open:visible,show:()=>{cancelAnimationFrame(jumpFrame.current);openingHeading.current=null;setVisible(true);},ids:new Set(headings.map(h=>h.id)),aliases:topicDocument.aliases||{}}}>
    <div id="admin-workspace" className="contents">{children}</div>
    <Sheet open={visible} onOpenChange={next=>{if(!next&&body.current)position.current=body.current.scrollTop;setVisible(next);}}>
      <SheetContent ref={panel} id="admin-reference-pane" side="right" keepMounted className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl" data-doc-section={section} data-doc-topic={topic}
        initialFocus={()=>(openingHeading.current&&body.current?.querySelector<HTMLElement>('#admin-doc-'+openingHeading.current))||true}>
        <SheetHeader className="gap-3 pr-12"><SheetTitle>{topicDocument.title} reference</SheetTitle>
          <Field><FieldLabel htmlFor="admin-doc-contents">Contents</FieldLabel><NativeSelect id="admin-doc-contents" className="w-full" value={headings.some(h=>h.id===section)?section:'overview'} onChange={event=>jump(event.target.value)}>{headings.map(heading=><NativeSelectOption key={heading.id} value={heading.id}>{heading.title}</NativeSelectOption>)}</NativeSelect></Field>
        </SheetHeader>
        <div ref={attachBody} id="admin-doc-body" className="admin-doc-body relative min-h-0 flex-1 overflow-auto overscroll-contain px-4" role="region" aria-label={topicDocument.title+' documentation'} tabIndex={0}
          onScroll={event=>{if(panel.current?.hidden===false)position.current=event.currentTarget.scrollTop;}}
          onClick={event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');if(!link)return;event.preventDefault();jump(decodeURIComponent(link.hash.slice(1)));}}
          dangerouslySetInnerHTML={{__html:html}}/>
      </SheetContent>
    </Sheet>
  </DocumentationContext.Provider>;
}
