import {useState, type ReactNode} from 'react';
import {InfoIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger} from '@/components/ui/popover';

/** Explanations open by hover, keyboard focus or tap; never hover-only. */
export function HelpTip({title,children}:{title:string;children:ReactNode}){
  const [open,setOpen]=useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger openOnHover delay={200} closeDelay={150} onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))setOpen(true);}} render={<Button type="button" variant="ghost" size="icon-xs" aria-label={'About '+title}/>}><InfoIcon aria-hidden/></PopoverTrigger>
    <PopoverContent className="flex max-w-[calc(100vw-2rem)] flex-col gap-2" side="top">
      <PopoverTitle>{title}</PopoverTitle><PopoverDescription>{children}</PopoverDescription>
    </PopoverContent>
  </Popover>;
}
