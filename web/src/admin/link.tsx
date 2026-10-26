/* A link to an admin section: a real href (open in a new tab, copy), and in-app navigation on a plain click. */
import type {ReactNode} from 'react';
import type {AdminContext} from './sections';

export function AdminLink({context,section,params=[],children,className}:{context:Pick<AdminContext,'href'|'go'>;section:string;params?:string[];children:ReactNode;className?:string}){
  return <a className={className} href={context.href(section,...params)} onClick={event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();context.go(section,...params);
  }}>{children}</a>;
}
