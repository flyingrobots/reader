/* Molecule: a page or section toolbar as a muted shadcn Item: a live status line on the left, actions on the right.
   ("Checked 3 min ago · [Check again]"). Wraps to two lines on a phone. */
import type {ReactNode} from 'react';
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia} from '@/components/ui/item';

export function Toolbar({status,media,children,...props}:{status:ReactNode;media?:ReactNode;children?:ReactNode;id?:string}){
  return <Item variant="muted" size="sm" data-toolbar="" {...props}>
    {media?<ItemMedia>{media}</ItemMedia>:null}
    <ItemContent className="min-w-0"><ItemDescription aria-live="polite" className="text-foreground">{status}</ItemDescription></ItemContent>
    {children?<ItemActions className="flex-wrap">{children}</ItemActions>:null}
  </Item>;
}
