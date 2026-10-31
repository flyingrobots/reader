/* Reader's app dialogs: shadcn Dialogs that plain JavaScript opens (openAppDialog in reader-controls.tsx) and that remove
   themselves once closed. AppDialog holds the open state, the title and a labelled close button; `onClosed` runs after
   the dialog has gone, when the app resumes reading. Every popup carries data-reader-modal, so app.mjs's modalOpen()
   treats it like any modal: no selection capture, no reading keys.
   - ShellDialog: one body that plain JavaScript fills (the key map, the diagram viewer's enlarged copy).
   - AnnotationDialog: a comment or warning on the selected passage.
   - SpeakMenu: what to send to AI-TTS, with a, f and s as shortcuts.
   A native dialog's showModal() moved focus at once; Base UI's initialFocus runs a frame later. The initial element also
   takes autoFocus, which React applies as it mounts, so keys typed the moment a dialog appears (a, f, s in the Speak
   menu; Ctrl-r in a comment) reach it. */
import {useCallback, useRef, useState, type ReactNode, type RefObject} from 'react';
import {XIcon} from 'lucide-react';
import {cn} from 'cn';
import {Button} from '@/components/ui/button';
import {ButtonGroup} from '@/components/ui/button-group';
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Kbd} from '@/components/ui/kbd';
import {Textarea} from '@/components/ui/textarea';

export type AppDialogFrame={id:string;title:string;closeLabel:string;className?:string;description?:string;onClosed:()=>void;
  initialFocus?:RefObject<HTMLElement|null>;attributes?:Record<string,string>};
type Register={register:(close:()=>void)=>void};

export function AppDialog({frame,register,children}:{frame:AppDialogFrame;children:(close:()=>void)=>ReactNode}&Register){
  const [open,setOpen]=useState(true),close=useCallback(()=>setOpen(false),[]);
  register(close);
  return <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={next=>{if(!next)frame.onClosed();}}>
    <DialogContent id={frame.id} data-reader-modal="" data-ui="shadcn" showCloseButton={false} aria-labelledby={frame.id+'-title'} {...frame.attributes}
      initialFocus={frame.initialFocus} className={cn('flex max-h-[90vh] flex-col gap-3',frame.className)}>
      <DialogHeader className="flex-row items-center justify-between gap-2">
        <DialogTitle id={frame.id+'-title'} className="font-serif text-xl font-medium">{frame.title}</DialogTitle>
        <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={frame.closeLabel}/>}><XIcon aria-hidden/></DialogClose>
      </DialogHeader>
      {frame.description?<DialogDescription>{frame.description}</DialogDescription>:null}
      {children(close)}
    </DialogContent>
  </Dialog>;
}

export type ShellDialogOptions=Omit<AppDialogFrame,'initialFocus'>&{bodyId:string;bodyClassName?:string;fill:(body:HTMLElement)=>void;focusBody?:boolean};
export function ShellDialog({options,register}:{options:ShellDialogOptions}&Register){
  const body=useRef<HTMLDivElement|null>(null);
  // Stable, so React attaches it once: fill() must run once per opening, not on every render.
  const attach=useCallback((element:HTMLDivElement|null)=>{if(element&&body.current!==element){body.current=element;options.fill(element);}},[options]);
  return <AppDialog frame={{...options,initialFocus:options.focusBody?body:undefined}} register={register}>{()=>
    <div id={options.bodyId} tabIndex={0} className={cn('min-h-0 overflow-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',options.bodyClassName)} ref={attach}/>}
  </AppDialog>;
}

export type AnnotationOptions={kind:'comment'|'warning';quote:string;submit:(text:string)=>Promise<void>;onClosed:()=>void};
export function AnnotationDialog({options,register}:{options:AnnotationOptions}&Register){
  const warning=options.kind==='warning',body=useRef<HTMLTextAreaElement|null>(null),[busy,setBusy]=useState(false);
  return <AppDialog register={register} frame={{id:'annotation-dialog',title:warning?'Leave a warning.':'Leave a thought.',closeLabel:'Close annotation',
    className:'w-[min(570px,calc(100vw-2rem))] max-w-none p-6 sm:max-w-none',initialFocus:body,onClosed:options.onClosed,attributes:{'data-kind':options.kind}}}>{()=><>
    <blockquote id="annotation-quote" className={cn('m-0 max-h-40 overflow-auto border-l pl-4 font-serif text-xl leading-snug text-muted-foreground',warning?'border-[var(--warning)]':'border-primary')}>{options.quote}</blockquote>
    <form id="annotation-form" className="flex flex-col gap-3" onSubmit={async event=>{event.preventDefault();setBusy(true);try{await options.submit(body.current?.value||'');}finally{setBusy(false);}}}>
      <label className="sr-only" htmlFor="annotation-body">Your comment</label>
      <Textarea ref={body} autoFocus id="annotation-body" rows={5} maxLength={16000} placeholder="What caught your attention?" required/>
      <Button type="submit" className="self-end" disabled={busy}>{warning?'Leave warning':'Leave comment'}</Button>
    </form>
  </>}</AppDialog>;
}

export type SpeakScope='article'|'from'|'selection';
export type SpeakOptions={hasSelection:boolean;choose:(scope:SpeakScope)=>void;onClosed:()=>void};
const CHOICES:[SpeakScope,string,string][]=[['article','Whole article','a'],['from','From here','f'],['selection','Selection','s']];
export function SpeakMenu({options,register}:{options:SpeakOptions}&Register){
  const first=useRef<HTMLButtonElement|null>(null),selection=useRef<HTMLButtonElement|null>(null);
  return <AppDialog register={register} frame={{id:'speak-menu',title:'Send to AI-TTS',closeLabel:'Close',className:'w-[min(320px,calc(100vw-2rem))] max-w-none p-4 sm:max-w-none',
    initialFocus:options.hasSelection?selection:first,onClosed:options.onClosed}}>{()=><>
    <ButtonGroup orientation="vertical" className="w-full" onKeyDown={event=>{
      const scope=({a:'article',f:'from',s:'selection'} as Record<string,SpeakScope>)[event.key];
      if(scope&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();if(scope!=='selection'||options.hasSelection)options.choose(scope);return;}
      if(['j','k','ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();
        const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-speak]:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index+(['j','ArrowDown'].includes(event.key)?1:-1)+items.length)%items.length]?.focus();}}}>
      {CHOICES.map(([scope,label,key])=><Button key={scope} ref={scope==='article'?first:scope==='selection'?selection:undefined} autoFocus={scope===(options.hasSelection?'selection':'article')} variant="outline" size="sm" className="w-full justify-between" data-speak={scope}
        disabled={scope==='selection'&&!options.hasSelection} title={scope==='selection'&&!options.hasSelection?'Select a passage to send only that.':undefined}
        onClick={()=>options.choose(scope)}><span>{label}</span><Kbd>{key}</Kbd></Button>)}
    </ButtonGroup>
    <p className="text-[11px] text-muted-foreground">AI-TTS speaks it through its own queue; holds and other speakers are respected.</p>
  </>}</AppDialog>;
}
