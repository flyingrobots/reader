/* Atom: a heading for a group of cards within an Admin page (the page's own h1 belongs to the AdminPage template). */
import type {ReactNode} from 'react';

export function SectionHeading({id,children}:{id?:string;children:ReactNode}){
  return <h2 id={id} data-slot="section-heading" className="font-serif text-2xl leading-tight font-normal tracking-tight">{children}</h2>;
}
