/* Reader Admin: a routed application layout (shadcn Sidebar composition) in place of the long Behind the scenes page.
   The sidebar lists the registered sections; the header has the sidebar trigger, a breadcrumb and Back to Library;
   the page shows one section at a time under its own heading. Scrolling is the window's own (no reading smoother or
   pagination). Each route change starts at the top and focuses the page heading without scrolling. */
import {useLayoutEffect, useRef} from 'react';
import {ArrowLeftIcon} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Separator} from '../components/ui/separator';
import {Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar} from '../components/ui/sidebar';
import {ADMIN_SECTIONS, OVERVIEW, sectionFor, type AdminContext, type AdminSection} from './sections';
import {NeedsReader} from './panels';
import {AdminLink} from './link';

const NAV_ID='admin-sections';
// On phones the sections are a sheet. Choosing one closes it and its page heading keeps focus (Escape returns to the trigger).
let headingAfterSheet=false;
const sheetFocus=()=>{if(!headingAfterSheet)return true;headingAfterSheet=false;return document.getElementById('admin-title')||true;};

function SectionNav({context,current}:{context:AdminContext;current:string}){
  const {isMobile,setOpenMobile}=useSidebar();
  return <nav aria-label="Admin sections" id={NAV_ID}><SidebarGroup><SidebarGroupContent><SidebarMenu className="m-0 list-none p-0">
    {ADMIN_SECTIONS.map(section=>{const Icon=section.icon,active=section.id===current;
      return <SidebarMenuItem key={section.id}>
        <SidebarMenuButton isActive={active} aria-current={active?'page':undefined} data-admin-nav={section.id}
          render={<a href={context.href(section.id)} onClick={event=>{
            if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
            event.preventDefault();if(isMobile){headingAfterSheet=true;setOpenMobile(false);}
            if(active)focusHeading();else context.go(section.id);
          }}/>}>
          <Icon aria-hidden/><span>{section.title}</span>{section.needsReader&&context.local?<span className="sr-only"> (needs Reader on your computer)</span>:null}
        </SidebarMenuButton></SidebarMenuItem>;})}
  </SidebarMenu></SidebarGroupContent></SidebarGroup></nav>;
}

/** The page heading takes focus without scrolling, so Tab continues into the section and screen readers announce it. */
function focusHeading(){
  const heading=document.getElementById('admin-title');if(!heading)return;
  heading.focus({preventScroll:true});
}

function Header({context,section}:{context:AdminContext;section:AdminSection|null}){
  const {open,openMobile,isMobile}=useSidebar();
  return <header className="admin-header" data-reader-decoration="">
    <SidebarTrigger aria-label="Show or hide the admin sections" aria-controls={NAV_ID} aria-expanded={isMobile?openMobile:open} className="admin-trigger"/>
    <Separator orientation="vertical" className="admin-header-rule"/>
    <nav aria-label="Breadcrumb" className="admin-breadcrumb"><ol>
      <li>{section?.id===OVERVIEW?<span>Reader Admin</span>:<AdminLink context={context} section={OVERVIEW}>Reader Admin</AdminLink>}</li>
      <li aria-hidden="true" className="admin-breadcrumb-sep">›</li>
      <li><span aria-current="page">{section?section.title:'Not found'}</span></li>
    </ol></nav>
    <Button id="admin-back" variant="outline" size="sm" className="admin-back" onClick={context.backToLibrary}><ArrowLeftIcon data-icon="inline-start" aria-hidden/>Back to Library</Button>
  </header>;
}

export function AdminShell({context}:{context:AdminContext}){
  const section=sectionFor(context.route),key=[context.route.section,...context.route.params].join('/');
  // Each route opens at its top, with its heading focused (never a filter or a field). Native scrolling only.
  const shown=useRef<string|null>(null);
  useLayoutEffect(()=>{
    if(shown.current===key)return;shown.current=key;
    window.scrollTo({top:0,left:0,behavior:'instant'});focusHeading();
  },[key]);
  return <SidebarProvider className="reader-admin" id="reader-admin" data-admin-section={section?.id||'not-found'}>
    <Sidebar collapsible="offcanvas" className="admin-sidebar" mobileTitle="Admin sections" mobileDescription="Reader Admin’s sections." mobileFinalFocus={sheetFocus}>
      <SidebarHeader><AdminLink context={context} section={OVERVIEW} className="admin-brand">Reader Admin</AdminLink></SidebarHeader>
      <SidebarContent><SectionNav context={context} current={section?.id||''}/></SidebarContent>
      <SidebarFooter><Button variant="ghost" size="sm" className="admin-back-side" onClick={context.backToLibrary}><ArrowLeftIcon data-icon="inline-start" aria-hidden/>Back to Library</Button></SidebarFooter>
    </Sidebar>
    <SidebarInset className="admin-inset">
      <Header context={context} section={section}/>
      <div className="admin-content" id="admin-content" data-admin-section={section?.id||'not-found'}>
        <div className="admin-page-head">
          <h1 id="admin-title" tabIndex={-1}>{section?section.title:'Section not found'}</h1>
          <p className="admin-lede">{section?section.description:'Reader Admin has no page at this address.'}</p>
        </div>
        {!section?<p className="backstage-message" id="admin-not-found"><AdminLink context={context} section={OVERVIEW}>Go to the Overview</AdminLink></p>
          :section.needsReader&&context.local?<NeedsReader what={section.title}/>
          :section.render(context)}
      </div>
    </SidebarInset>
  </SidebarProvider>;
}
