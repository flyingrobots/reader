import {AdminDocsButton, AdminDocumentationWorkspace} from './documentation';
/* Reader Admin: a routed application layout (shadcn Sidebar composition) in place of the long Behind the scenes page.
   The sidebar groups the registered sections and ends with Back to Library; the header has the sidebar trigger, a breadcrumb and Docs;
   the page shows one section at a time under its own heading. Scrolling is the window's own (no reading smoother or
   pagination). Each route change starts at the top and focuses the page heading without scrolling. */
import {useLayoutEffect, useRef} from 'react';
import {ArrowLeftIcon, CompassIcon} from 'lucide-react';
import {Button} from '../components/ui/button';
import {AdminHeader, AdminPage} from '../theme/templates/admin-page';
import {EmptyState} from '../theme/molecules/states';
import {Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar} from '../components/ui/sidebar';
import {ADMIN_GROUPS, ADMIN_SECTIONS, OVERVIEW, sectionFor, type AdminContext, type AdminSection} from './sections';
import {NeedsReader} from './panels';
import {AdminLink} from './link';

const NAV_ID='admin-sections';
// On phones the sections are a sheet. Choosing one closes it and its page heading keeps focus (Escape returns to the trigger).
let headingAfterSheet=false;
const sheetFocus=()=>{if(!headingAfterSheet)return true;headingAfterSheet=false;return document.getElementById('admin-title')||true;};

function SectionNav({context,current}:{context:AdminContext;current:string}){
  const {isMobile,setOpenMobile}=useSidebar();
  return <nav aria-label="Admin sections" id={NAV_ID}>{ADMIN_GROUPS.map(group=><SidebarGroup key={group} role="group" aria-label={group}><SidebarGroupLabel>{group}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu className="m-0 list-none p-0">
    {ADMIN_SECTIONS.filter(section=>section.group===group).map(section=>{const Icon=section.icon,active=section.id===current,count=section.count?.(context)||0;
      return <SidebarMenuItem key={section.id}>
        <SidebarMenuButton isActive={active} aria-current={active?'page':undefined} data-admin-nav={section.id}
          render={<a href={context.href(section.id)} onClick={event=>{
            if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
            event.preventDefault();if(isMobile){headingAfterSheet=true;setOpenMobile(false);}
            if(active)focusHeading();else context.go(section.id);
          }}/>}>
          <Icon aria-hidden/><span>{section.title}</span>{section.needsReader&&context.local?<span className="sr-only"> (needs Reader on your computer)</span>:null}
        </SidebarMenuButton>{count?<SidebarMenuBadge className="text-destructive" data-admin-nav-badge={section.id}>{count}<span className="sr-only"> need attention</span></SidebarMenuBadge>:null}</SidebarMenuItem>;})}
  </SidebarMenu></SidebarGroupContent></SidebarGroup>)}</nav>;
}

/** The page heading takes focus without scrolling, so Tab continues into the section and screen readers announce it. */
function focusHeading(){
  const heading=document.getElementById('admin-title');if(!heading)return;
  heading.focus({preventScroll:true});
}

function Header({context,section}:{context:AdminContext;section:AdminSection|null}){
  const {open,openMobile,isMobile}=useSidebar(),overview=section?.id===OVERVIEW;
  return <AdminHeader
    trigger={<SidebarTrigger aria-label="Show or hide the admin sections" aria-controls={NAV_ID} aria-expanded={isMobile?openMobile:open}/>}
    home={overview?{label:'Reader Admin'}:{label:'Reader Admin',href:context.href(OVERVIEW),onClick:event=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();context.go(OVERVIEW);}}}
    current={section?section.title:'Not found'}
    actions={<AdminDocsButton/>}/>;
}

export function AdminShell({context}:{context:AdminContext}){
  const section=sectionFor(context.route),key=[context.route.section,...context.route.params].join('/');
  // Each route opens at its top, with its heading focused (never a filter or a field). Native scrolling only.
  const shown=useRef<string|null>(null);
  useLayoutEffect(()=>{
    if(shown.current===key)return;shown.current=key;
    window.scrollTo({top:0,left:0,behavior:'instant'});focusHeading();
  },[key]);
  const page=<>
      <Header context={context} section={section}/>
      <AdminPage id="admin-content" data-admin-section={section?.id||'not-found'} wide={!!section} title={section?section.title:'Section not found'} lede={section?section.description:'Reader Admin has no page at this address.'}>
        {!section?<EmptyState id="admin-not-found" icon={CompassIcon} title="No page here" description="Reader Admin has no page at this address."><Button variant="outline" size="sm" render={<a href={context.href(OVERVIEW)} onClick={event=>{event.preventDefault();context.go(OVERVIEW);}}/>} nativeButton={false}>Go to the Overview</Button></EmptyState>
          :section.needsReader&&context.local?<NeedsReader what={section.title}/>:section.render(context)}
      </AdminPage>
  </>;
  return <SidebarProvider className="reader-admin font-sans" id="reader-admin" data-admin-section={section?.id||'not-found'}>
    <Sidebar collapsible="offcanvas" mobileTitle="Admin sections" mobileDescription="Reader Admin’s sections." mobileFinalFocus={sheetFocus}>
      <SidebarHeader><Button variant="ghost" size="sm" className="justify-start font-semibold" nativeButton={false} render={<AdminLink context={context} section={OVERVIEW}/>}>Reader Admin</Button></SidebarHeader>
      <SidebarContent><SectionNav context={context} current={section?.id||''}/></SidebarContent>
      <SidebarFooter><Button id="admin-back" variant="ghost" size="sm" className="justify-start" onClick={context.backToLibrary}><ArrowLeftIcon data-icon="inline-start" aria-hidden/>Back to Library</Button></SidebarFooter>
    </Sidebar>
    <SidebarInset className="min-w-0 bg-background">
      {section?<AdminDocumentationWorkspace key={section.id} topic={section.id} markdown={context.markdown}>{page}</AdminDocumentationWorkspace>:page}
    </SidebarInset>
  </SidebarProvider>;
}
