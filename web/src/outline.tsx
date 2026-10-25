import {useRef, type KeyboardEvent} from 'react';
import {Button} from './components/ui/button';
import {Popover, PopoverTrigger, PopoverContent, PopoverTitle} from './components/ui/popover';
import {Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle} from './components/ui/sheet';

export type OutlineEntry={title:string;depth:number;label:string};
export type OutlineModel={mode:'rail'|'popover'|'sheet'|null;open:boolean;title:string;entries:OutlineEntry[];folded:boolean;railOpen:boolean};
export type OutlineActions={outlineToggle:()=>void;outlineOpen:(open:boolean)=>void;outlineGo:(index:number)=>void};

const Icon=()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6h16M8 12h12M8 18h12"/></svg>;

/** j/k and arrows move between entries; Home/End jump to the ends. */
function move(event:KeyboardEvent<HTMLElement>){
  const keys:Record<string,number>={ArrowDown:1,j:1,ArrowUp:-1,k:-1};
  if(!(event.key in keys)&&event.key!=='Home'&&event.key!=='End')return;
  const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-outline-entry]')];if(!items.length)return;
  event.preventDefault();event.stopPropagation();
  const at=items.indexOf(document.activeElement as HTMLButtonElement);
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,(at<0?0:at)+keys[event.key]));
  items[next].focus();items[next].scrollIntoView({block:'nearest'});
}

function Entries({outline,active,actions,activeRef}:{outline:OutlineModel;active:number;actions:OutlineActions;activeRef:React.RefObject<HTMLButtonElement|null>}){
  return <nav aria-label="Document outline" className="outline-sheet-nav" onKeyDown={move}>
    <ol className="outline-list">{outline.entries.map((entry,index)=><li key={index} data-depth={entry.depth}>
      <button type="button" data-outline-entry="" ref={index===Math.max(0,active)?activeRef:undefined} aria-current={index===active?'location':undefined} onClick={()=>actions.outlineGo(index)}><span className="outline-entry-title">{entry.title}</span>{entry.label?<span className="outline-entry-page">{entry.label}</span>:null}</button>
    </li>)}</ol>
    {outline.folded?<p className="outline-folded">Deeper levels are folded in long outlines.</p>:null}
  </nav>;
}

/** The status-line Outline button, and the popover (two pages, narrow windows) or bottom sheet (phones). */
export function OutlineControl({outline,active,actions}:{outline:OutlineModel;active:number;actions:OutlineActions}){
  const activeRef=useRef<HTMLButtonElement|null>(null);
  if(!outline.mode)return null;
  const label=<><Icon/><span>Outline</span></>;
  const common={id:'outline-open',variant:'ghost' as const,size:'xs' as const,className:'status-button',title:'Document outline · Space o','aria-label':'Document outline'};
  if(outline.mode==='rail')return <Button {...common} aria-pressed={outline.railOpen} aria-controls="outline-rail" onClick={actions.outlineToggle}>{label}</Button>;
  if(outline.mode==='sheet')return <Sheet open={outline.open} onOpenChange={actions.outlineOpen}>
    <SheetTrigger render={<Button {...common}/>}>{label}</SheetTrigger>
    <SheetContent side="bottom" id="outline-sheet" className="outline-sheet" initialFocus={activeRef}><SheetHeader><SheetTitle>Contents</SheetTitle></SheetHeader><Entries outline={outline} active={active} actions={actions} activeRef={activeRef}/></SheetContent>
  </Sheet>;
  return <Popover open={outline.open} onOpenChange={actions.outlineOpen}>
    <PopoverTrigger render={<Button {...common}/>}>{label}</PopoverTrigger>
    <PopoverContent id="outline-popover" className="outline-popover" side="top" align="end" initialFocus={activeRef}><PopoverTitle>Contents</PopoverTitle><Entries outline={outline} active={active} actions={actions} activeRef={activeRef}/></PopoverContent>
  </Popover>;
}
