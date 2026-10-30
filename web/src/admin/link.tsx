/* A link to an admin section: a real href (open in a new tab, copy), and in-app navigation on a plain click. It forwards
   anchor props, so a shadcn component can render as it (`<Button render={<AdminLink …/>}>`, `<Item render={…}>`). */
import type {AnchorHTMLAttributes} from 'react';
import type {AdminContext} from './sections';

export function AdminLink({context,section,params=[],onClick,...props}:{context:Pick<AdminContext,'href'|'go'>;section:string;params?:string[]}&AnchorHTMLAttributes<HTMLAnchorElement>){
  return <a {...props} href={context.href(section,...params)} onClick={event=>{
    onClick?.(event);
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();context.go(section,...params);
  }}/>;
}
