/* Templates: the Admin page frame. AdminHeader is the sticky bar (sidebar trigger, a shadcn Breadcrumb, Back to Library);
   AdminPage is the page head (the focusable h1 and its one-line lede, divided from the body by a Separator) above the
   section body, laid out as one column with even gaps. Pages fill the body; they never restyle the frame. */
import type {ReactNode} from 'react';
import {Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator} from '@/components/ui/breadcrumb';
import {Separator} from '@/components/ui/separator';

export function AdminHeader({trigger,home,current,actions}:{trigger:ReactNode;home:{label:string;href?:string;onClick?:(event:React.MouseEvent<HTMLAnchorElement>)=>void};current:string;actions?:ReactNode}){
  return <header data-reader-decoration="" data-admin-header="" className="sticky top-0 z-10 flex min-h-13 items-center gap-2 border-b border-border bg-background px-3 py-2 md:px-6">
    {trigger}
    <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center"/>
    <Breadcrumb className="min-w-0 flex-1" data-admin-breadcrumb="">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="shrink-0">{home.href?<BreadcrumbLink href={home.href} onClick={home.onClick}>{home.label}</BreadcrumbLink>:home.label}</BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate">{current}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    {actions}
  </header>;
}

export function AdminPage({title,lede,children,...props}:{title:ReactNode;lede:ReactNode;children:ReactNode;id?:string}&Record<`data-${string}`,string>){
  return <div className={'mx-auto flex w-full flex-col gap-6 px-4 pt-6 pb-24 md:px-8 md:pt-8 lg:px-12 '+(props['data-admin-section']==='indexes'?'max-w-none':'max-w-6xl')} {...props}>
    <div className="flex flex-col gap-2">
      <h1 id="admin-title" tabIndex={-1} data-slot="admin-title" className="scroll-mt-16 font-serif text-3xl leading-tight font-normal tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-4xl">{title}</h1>
      <p data-slot="admin-lede" className="max-w-prose text-sm text-muted-foreground">{lede}</p>
    </div>
    <Separator/>
    {children}
  </div>;
}
