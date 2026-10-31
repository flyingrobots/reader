/* Reader's app dialogs whose body plain JavaScript fills (the diagram viewer's enlarged copy, the generated key map):
   a shadcn Dialog with a title, a labelled close button and one body element. app.mjs opens one with openShellDialog;
   `fill` runs once the body exists, and `onClosed` after it has gone, when the app resumes reading. The popup carries
   data-reader-modal so app.mjs's modalOpen() treats it like any modal: no selection capture, no reading keys. */
import {useCallback, useRef, useState} from 'react';
import {XIcon} from 'lucide-react';
import {cn} from 'cn';
import {Button} from '@/components/ui/button';
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';

export type ShellDialogOptions={id:string;title:string;description?:string;closeLabel:string;className?:string;
  bodyId:string;bodyClassName?:string;fill:(body:HTMLElement)=>void;focusBody?:boolean;onClosed:()=>void};

export function ShellDialog({options,register}:{options:ShellDialogOptions;register:(close:()=>void)=>void}){
  const [open,setOpen]=useState(true);
  register(()=>setOpen(false));
  const body=useRef<HTMLDivElement|null>(null);
  // Stable, so React attaches it once: fill() must run once per opening, not on every render.
  const attach=useCallback((element:HTMLDivElement|null)=>{if(element&&body.current!==element){body.current=element;options.fill(element);}},[options]);
  return <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={next=>{if(!next)options.onClosed();}}>
    <DialogContent id={options.id} data-reader-modal="" data-ui="shadcn" showCloseButton={false} aria-labelledby={options.id+'-title'}
      initialFocus={options.focusBody?body:undefined} className={cn('flex max-h-[90vh] flex-col gap-3',options.className)}>
      <DialogHeader className="flex-row items-center justify-between gap-2">
        <DialogTitle id={options.id+'-title'} className="font-serif text-xl font-medium">{options.title}</DialogTitle>
        <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={options.closeLabel}/>}><XIcon aria-hidden/></DialogClose>
      </DialogHeader>
      {options.description?<DialogDescription>{options.description}</DialogDescription>:null}
      <div id={options.bodyId} tabIndex={0} className={cn('min-h-0 overflow-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',options.bodyClassName)}
        ref={attach}/>
    </DialogContent>
  </Dialog>;
}
