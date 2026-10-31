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
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Item, ItemContent} from '@/components/ui/item';
import {Kbd} from '@/components/ui/kbd';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import {Notice} from '@/theme/molecules/notice';
import {SpeechVoice} from './speech-voice';
import {Textarea} from '@/components/ui/textarea';

export type AppDialogFrame={id:string;title:string;closeLabel:string;className?:string;description?:string;onClosed:()=>void;
  initialFocus?:RefObject<HTMLElement|null>;attributes?:Record<string,string>};
type Register={register:(close:()=>void)=>void};

export function AppDialog({frame,register,children}:{frame:AppDialogFrame;children:(close:()=>void)=>ReactNode}&Register){
  const [open,setOpen]=useState(true);
  // Focus returns as the dialog starts closing, not after Base UI's exit animation, so keys typed then reach the page.
  const opener=useRef<Element|null>(document.activeElement),popup=useRef<HTMLDivElement|null>(null);
  const close=useCallback(()=>{setOpen(false);const active=document.activeElement,back=opener.current;
    if((!active||active===document.body||popup.current?.contains(active))&&back instanceof HTMLElement&&back!==document.body&&back.isConnected)back.focus({preventScroll:true});},[]);
  register(close);
  return <Dialog open={open} onOpenChange={next=>{if(next)setOpen(true);else close();}} onOpenChangeComplete={next=>{if(!next)frame.onClosed();}}>
    <DialogContent ref={popup} id={frame.id} data-reader-modal="" data-ui="shadcn" showCloseButton={false} aria-labelledby={frame.id+'-title'} {...frame.attributes}
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
    <Item variant="muted" render={<blockquote/>} id="annotation-quote" className="m-0 max-h-40 overflow-auto"><ItemContent className="font-serif text-xl leading-snug text-muted-foreground">{options.quote}</ItemContent></Item>
    <form id="annotation-form" className="flex flex-col gap-3" onSubmit={async event=>{event.preventDefault();setBusy(true);try{await options.submit(body.current?.value||'');}finally{setBusy(false);}}}>
      <label className="sr-only" htmlFor="annotation-body">Your comment</label>
      <Textarea ref={body} autoFocus id="annotation-body" rows={5} maxLength={16000} placeholder="What caught your attention?" required/>
      <Button type="submit" className="self-end" disabled={busy}>{warning?'Leave warning':'Leave comment'}</Button>
    </form>
  </>}</AppDialog>;
}

export type SpeakScope='article'|'from'|'selection';
export type SpeakOptions={hasSelection:boolean;api:(path:string,payload?:unknown)=>Promise<any>;choose:(scope:SpeakScope,voice?:string)=>void;onClosed:()=>void};
const CHOICES:[SpeakScope,string,string][]=[['article','Whole article','a'],['from','From here','f'],['selection','Selection','s']];
export function SpeakMenu({options,register}:{options:SpeakOptions}&Register){
  const first=useRef<HTMLButtonElement|null>(null),selection=useRef<HTMLButtonElement|null>(null),[voice,setVoice]=useState<string|undefined>();
  return <AppDialog register={register} frame={{id:'speak-menu',title:'Send to AI-TTS',closeLabel:'Close',className:'w-[min(320px,calc(100vw-2rem))] max-w-none p-4 sm:max-w-none',
    initialFocus:options.hasSelection?selection:first,onClosed:options.onClosed}}>{()=><>
    <ButtonGroup orientation="vertical" className="w-full" onKeyDown={event=>{
      const scope=({a:'article',f:'from',s:'selection'} as Record<string,SpeakScope>)[event.key];
      if(scope&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();if(scope!=='selection'||options.hasSelection)options.choose(scope,voice);return;}
      if(['j','k','ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();
        const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-speak]:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index+(['j','ArrowDown'].includes(event.key)?1:-1)+items.length)%items.length]?.focus();}}}>
      {CHOICES.map(([scope,label,key])=><Button key={scope} ref={scope==='article'?first:scope==='selection'?selection:undefined} autoFocus={scope===(options.hasSelection?'selection':'article')} variant="outline" size="sm" className="w-full justify-between" data-speak={scope}
        disabled={scope==='selection'&&!options.hasSelection} title={scope==='selection'&&!options.hasSelection?'Select a passage to send only that.':undefined}
        onClick={()=>options.choose(scope,voice)}><span>{label}</span><Kbd>{key}</Kbd></Button>)}
    </ButtonGroup>
    <SpeechVoice api={options.api} onChange={setVoice}/>
    <p className="text-[11px] text-muted-foreground">AI-TTS speaks it through its own queue; holds and other speakers are respected.</p>
  </>}</AppDialog>;
}

/** The Documents picker's shell. Its content (filter, folder scope, the document tree, the key hints) is the plain-JavaScript
    #picker-content from index.html, which app.mjs drives by id; the popup adopts that node once and stays mounted, so the
    content and its handlers persist between openings. The first Escape hides an open filter instead of closing. */
export type PickerControl={open:()=>void;close:()=>void;isOpen:()=>boolean};
export function PickerDialog({content,escape,onOpenChange,register}:{content:HTMLElement;escape:()=>boolean;onOpenChange:(open:boolean)=>void;
  register:(control:PickerControl)=>void}){
  const [open,setOpen]=useState(false),state=useRef(open),back=useRef<HTMLElement|null>(null);state.current=open;
  // Closing returns focus to what had it, or to the document. Without an opener (a new split pane opens on the picker)
  // Base UI would fall back to the first tabbable element, such as a margin pin, which keeps the keys for itself.
  // Focus leaves as the picker starts closing, as it did from a native dialog: during Base UI's exit animation the popup
  // would otherwise keep it, and a key typed then (/ opens the filter in #file-results) would land in the closing picker.
  const release=()=>{const active=document.activeElement;if(!active||active===document.body||document.getElementById('picker')?.contains(active))back.current?.focus({preventScroll:true});};
  const close=()=>{setOpen(false);release();};
  register({open:()=>{const element=document.activeElement;back.current=element instanceof HTMLElement&&element!==document.body?element:document.getElementById('main');setOpen(true);},
    close,isOpen:()=>state.current});
  const adopt=useCallback((element:HTMLDivElement|null)=>{if(element&&content.parentElement!==element){element.append(content);content.hidden=false;}},[content]);
  // Base UI's own return (finalFocus) is off: with no opener it picked the first tabbable element, such as a margin pin.
  return <Dialog open={open} onOpenChange={(next,details)=>{if(!next&&details.reason==='escape-key'&&escape()){details.cancel();return;}if(next)setOpen(true);else close();}}
    onOpenChangeComplete={onOpenChange}>
    <DialogContent keepMounted id="picker" data-reader-modal="" data-ui="shadcn" showCloseButton={false} aria-labelledby="picker-title"
      initialFocus={false} finalFocus={false} className="flex max-h-[min(86vh,760px)] w-[min(720px,calc(100vw-2rem))] max-w-none flex-col gap-0 p-0 sm:max-w-none">
      <div ref={adopt} className="flex min-h-0 flex-1 flex-col"/>
    </DialogContent>
  </Dialog>;
}

/** The Scratch pad's Save to vault (or Save a new version) form. scratch.mjs computes the defaults, saves through the API
    and closes the dialog on success; a failure comes back as {error, slug?}, where a suggested free slug replaces the
    typed one. The slug follows the title until it is edited by hand. */
export type ScratchSaveFields={title:string;slug?:string;shifted?:string;status:string;responds_to:string};
export type ScratchSaveOptions={revising:boolean;title:string;slug:string;responds:string;prompt:boolean;pathFor:(slug:string)=>string;
  slugify:(title:string)=>string;submit:(fields:ScratchSaveFields,reply:boolean)=>Promise<{error:string;slug?:string}|void>;onClosed:()=>void};
export function ScratchSaveDialog({options,register}:{options:ScratchSaveOptions}&Register){
  const [title,setTitle]=useState(options.title),[slug,setSlug]=useState(options.slug),[edited,setEdited]=useState(false);
  const [shifted,setShifted]=useState(''),[status,setStatus]=useState('draft'),[responds,setResponds]=useState(options.responds);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),titleInput=useRef<HTMLInputElement|null>(null);
  const select=useCallback((element:HTMLInputElement|null)=>{if(element&&titleInput.current!==element){titleInput.current=element;element.focus();element.select();}},[]);
  return <AppDialog register={register} frame={{id:'scratch-save',title:options.revising?'Save a new version':'Save to vault',closeLabel:'Close',initialFocus:titleInput,
    className:'w-[min(520px,calc(100vw-2rem))] max-w-none p-6 sm:max-w-none',onClosed:options.onClosed}}>{close=>
    <form className="flex flex-col gap-4" onSubmit={async event=>{
      event.preventDefault();setError(null);setBusy(true);
      const reply=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='yes';
      const failure=await options.submit({title,status,responds_to:responds,...(options.revising?{shifted}:{slug})},reply);
      setBusy(false);if(failure){setError(failure.error);if(failure.slug){setSlug(failure.slug);setEdited(true);}}}}>
      <FieldGroup className="gap-3">
        <Field><FieldLabel htmlFor="scratch-save-name">Title</FieldLabel>
          <Input ref={select} id="scratch-save-name" name="title" maxLength={200} required value={title} onChange={event=>{setTitle(event.target.value);if(!edited)setSlug(options.slugify(event.target.value));}}/></Field>
        {options.revising?<Field><FieldLabel htmlFor="scratch-save-shifted">What shifted (optional)</FieldLabel>
            <Input id="scratch-save-shifted" name="shifted" maxLength={2000} value={shifted} onChange={event=>setShifted(event.target.value)}/></Field>
          :<Field><FieldLabel htmlFor="scratch-save-slug">Slug</FieldLabel>
            <Input id="scratch-save-slug" name="slug" maxLength={60} pattern="[a-z0-9\-]{1,60}" required value={slug} onChange={event=>{setSlug(event.target.value);setEdited(true);}}/></Field>}
        <Field><FieldLabel htmlFor="scratch-save-status">Status</FieldLabel>
          <NativeSelect id="scratch-save-status" name="status" className="w-full" value={status} onChange={event=>setStatus(event.target.value)}>
            <NativeSelectOption value="draft">Draft</NativeSelectOption><NativeSelectOption value="published">Published</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="scratch-save-responds">Responds to (optional)</FieldLabel>
          <Input id="scratch-save-responds" name="responds_to" placeholder="library/…" spellCheck={false} value={responds} onChange={event=>setResponds(event.target.value)}/></Field>
      </FieldGroup>
      <FieldDescription>Saves <code data-save-path="" className="font-mono">{options.pathFor(slug)}</code> as your own writing and commits only that file.</FieldDescription>
      {error?<Notice tone="error" role="alert" data-save-error="" title={error}/>:null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" data-save-close="" onClick={close}>Cancel</Button>
        <Button type="submit" size="sm" disabled={busy}>Save and commit</Button>
        {options.prompt?<Button type="submit" variant="outline" size="sm" name="reply" value="yes" disabled={busy}>Save and ask for a reply</Button>:null}
      </div>
    </form>}
  </AppDialog>;
}
