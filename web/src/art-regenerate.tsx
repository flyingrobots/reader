/* Regenerate this (#147): a new version of an article's art, steered by the reader's direction. Built as the shadcn
   AI Elements Prompt Input (https://ui.shadcn.com/docs/ai-elements/base/prompt-input): a form around an Input Group
   with its textarea, and a block-end addon holding the Model Selector menu (here: who makes the art, the Settings
   "Art made by" list) and the send button. Enter sends, Shift+Enter adds a line, Esc cancels. No attachments: a
   direction is text. The new version never replaces the one on screen. */
import * as React from 'react';
import {ArrowUpIcon, ChevronDownIcon, LoaderCircleIcon} from 'lucide-react';
import {DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea} from './components/ui/input-group';

export type ArtProducer={id:string;label:string;model?:string|null;kind?:string;available?:boolean};
export type ArtRegenerateOptions={title:string;initial:string;from:'direction'|'brief';producers:ArtProducer[];producer:string|null;max:number;
  disabled?:string|null;submit:(direction:string,producer:string|null)=>Promise<void>;close:()=>void};

export function ArtRegenerate({title,initial,from,producers,producer:chosen,max,disabled,submit,close}:ArtRegenerateOptions){
  const [text,setText]=React.useState(initial);
  const usable=producers.filter(p=>p.available!==false);
  const [producer,setProducer]=React.useState<string|null>(usable.find(p=>p.id===chosen)?.id??usable[0]?.id??null);
  const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState<string|null>(null);
  const formRef=React.useRef<HTMLFormElement>(null),areaRef=React.useRef<HTMLTextAreaElement>(null);
  const current=usable.find(p=>p.id===producer);
  const tooLong=text.length>max,canSend=!disabled&&!busy&&!!producer&&text.trim().length>0&&!tooLong;
  React.useEffect(()=>{const area=areaRef.current;if(area){area.focus();area.setSelectionRange(area.value.length,area.value.length);}},[]);
  async function onSubmit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!canSend)return;setBusy(true);setError(null);
    try{await submit(text.trim(),producer);}catch(caught){setError(caught instanceof Error?caught.message:String(caught));setBusy(false);}
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} className="art-regenerate" aria-labelledby="art-regenerate-title" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();close();}}}>
      <h3 id="art-regenerate-title" className="art-regenerate-title">Regenerate this</h3>
      <p className="art-regenerate-lede">A new version of the art for <strong>{title}</strong>, steered by your direction. {from==='direction'?'This is the direction the version on screen was made with.':'This version had no direction; its Artist’s note is a starting point.'} The version on screen is kept.</p>
      <InputGroup>
        <InputGroupTextarea ref={areaRef} id="art-direction" aria-label="Your direction for the new version" value={text} disabled={busy||!!disabled} rows={6} maxLength={max*2}
          onChange={event=>setText(event.target.value)} placeholder="Describe what the new version should change: imagery, mood, palette, motion…" className="p-3"
          aria-invalid={tooLong||undefined} aria-describedby="art-direction-count"
          onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();formRef.current?.requestSubmit();}}}/>
        <InputGroupAddon align="block-end">
          <InputGroupText id="art-direction-count" className={tooLong?'text-destructive':undefined}>{text.length.toLocaleString()} / {max.toLocaleString()}</InputGroupText>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={busy||!usable.length} render={<InputGroupButton size="sm" variant="outline" className="ml-auto" aria-label={`Art made by: ${current?.label??'no producer'}`}/>}>
              {current?current.label+(current.model?` · ${current.model}`:''):'No producer'}<ChevronDownIcon/>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Art made by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={producer??''} onValueChange={value=>setProducer(String(value))}>
                  {usable.map(item=><DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>{item.label}{item.model?` · ${item.model}`:''}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <InputGroupButton type="submit" size="icon-sm" variant="default" className="rounded-full" disabled={!canSend} aria-label="Make the new version" title={disabled||undefined} data-needs-reader={disabled?'':undefined}>
            {busy?<LoaderCircleIcon className="animate-spin"/>:<ArrowUpIcon/>}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <div className="art-regenerate-foot">
        <span role="status" aria-live="polite">{disabled?disabled:error?error:busy?'Queuing…':tooLong?`At most ${max.toLocaleString()} characters.`:'Enter sends · Shift Enter adds a line · Esc cancels'}</span>
        <InputGroupButton type="button" size="sm" variant="ghost" onClick={close}>Cancel</InputGroupButton>
      </div>
    </form>
  );
}
