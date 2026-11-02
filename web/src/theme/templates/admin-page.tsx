/* Templates: the Admin page frame. AdminHeader is the sticky bar (sidebar trigger, a shadcn Breadcrumb, the page's actions);
   AdminPage is the section body, laid out as one column with even gaps, under a page head for assistive technology only:
   the breadcrumb names the section on screen, while the h1 still takes focus and is announced on each route change.
   Pages fill the body; they never restyle the frame. */
import {cn} from 'cn';
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

export function AdminPage({title,lede,children,wide=false,...props}:{wide?:boolean;title:ReactNode;lede:ReactNode;children:ReactNode;id?:string}&Record<`data-${string}`,string>){
  return <div className={cn('mx-auto flex w-full flex-col gap-6 px-4 pt-6 pb-24 md:px-8 md:pt-8 lg:px-12',wide?'max-w-none':'max-w-6xl')} {...props}>
    <h1 id="admin-title" tabIndex={-1} data-slot="admin-title" className="sr-only">{title}</h1>
    <p data-slot="admin-lede" className="sr-only">{lede}</p>
    {children}
  </div>;
}
