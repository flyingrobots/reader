/* Template: the responsive grid Admin cards sit in. One column on a phone; as many 20rem columns as fit above that. */
import type {ReactNode} from 'react';
import {cn} from 'cn';

export function CardGrid({children,className,...props}:{children:ReactNode;className?:string;id?:string}){
  return <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4',className)} {...props}>{children}</div>;
}
