import {useState} from 'react';
import {AudioLinesIcon, MessageSquareIcon, SearchIcon, PaletteIcon, ListIcon, SettingsIcon, PlusIcon, SlidersHorizontalIcon} from 'lucide-react';
import {SpeechControl,useSpeaking} from './speech-control';
import {Popover,PopoverTrigger,PopoverContent,PopoverHeader,PopoverTitle} from './components/ui/popover';
import {Button} from './components/ui/button';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from './components/ui/dialog';
import {Field, FieldGroup, FieldLabel} from './components/ui/field';
import {Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem} from './components/ui/select';
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem} from './components/ui/dropdown-menu';

const TOOLS=[{id:'speak',label:'Speak',icon:AudioLinesIcon},{id:'chat',label:'Chat',icon:MessageSquareIcon},{id:'search',label:'Search',icon:SearchIcon},{id:'colors',label:'Colors',icon:PaletteIcon},{id:'outline',label:'Outline',icon:ListIcon},{id:'settings',label:'Settings',icon:SettingsIcon}] as const;
export const dockSlots=(value:unknown):string[]=>Array.isArray(value)?Array.from({length:4},(_,i)=>TOOLS.some(t=>t.id===value[i])?value[i]:''):['speak','chat','search','colors'];

export function ColorControl({intensity,onChange,dock=false,disabled=false}:{intensity:string;onChange:(value:string)=>void;dock?:boolean;disabled?:boolean}){
  const [open,setOpen]=useState(false);
  return <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger render={<Button variant="ghost" size={dock?'default':'xs'} disabled={disabled} aria-label="Colorful Language" className={dock?'h-14 min-w-0 flex-col gap-1':'status-button'} />}><PaletteIcon aria-hidden/>{dock?<span className="text-xs">Colors</span>:<span>Colors: {intensity}</span>}</DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end"><DropdownMenuRadioGroup value={intensity} onValueChange={value=>{onChange(value);setOpen(false);}}>
      {['off','subtle','clear','vivid'].map(value=><DropdownMenuRadioItem key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup></DropdownMenuContent>
  </DropdownMenu>;
}

export function MobileDock({slots,reading,chatAvailable,prose,run,save,setProse}:{slots:unknown;reading:boolean;chatAvailable:boolean;prose:{intensity:string}|null;run:(tool:string)=>void;save:(slots:string[])=>void;setProse:(value:string)=>void}){
  const [open,setOpen]=useState(false),[draft,setDraft]=useState<string[]>([]),selected=dockSlots(slots);
  const speaking=useSpeaking();
  const configure=()=>{setDraft(selected);setOpen(true);};
  return <>
    <Button id="dock-configure" data-status-priority="1" variant="ghost" size="icon-sm" aria-label="Customize dock" onClick={configure}><SlidersHorizontalIcon/></Button>
    <nav id="mobile-dock" data-status-priority="1" aria-label="Reading tools" className="grid grid-cols-4 gap-1">
      {selected.map((id,index)=>{const tool=TOOLS.find(t=>t.id===id);return <div key={index} className="min-w-0" data-dock-slot={index}>
        {!tool?<Button variant="ghost" className="h-14 w-full flex-col gap-1" aria-label={`Choose tool for slot ${index+1}`} onClick={configure}><PlusIcon/><span className="text-xs">Add tool</span></Button>
          :tool.id==='speak'&&speaking?<Popover><PopoverTrigger render={<Button variant="ghost" className="h-14 w-full min-w-0 flex-col gap-1" data-dock-tool="speak"/>}><AudioLinesIcon aria-hidden/><span className="text-xs">Speak</span></PopoverTrigger><PopoverContent side="top" align="start" className="max-w-[calc(100vw-16px)] [&_button]:min-h-11 [&_button]:min-w-11"><PopoverHeader><PopoverTitle>Playback</PopoverTitle></PopoverHeader><SpeechControl expanded/><Button variant="outline" onClick={()=>run('speak')}>Choose passage to speak</Button></PopoverContent></Popover>
          :tool.id==='colors'?<ColorControl dock disabled={!prose} intensity={prose?.intensity||'off'} onChange={setProse}/>
          :<Button variant="ghost" className="h-14 w-full min-w-0 flex-col gap-1" data-dock-tool={tool.id} disabled={tool.id==='chat'?!chatAvailable:['speak','outline'].includes(tool.id)&&!reading} onClick={()=>run(tool.id)}><tool.icon aria-hidden/><span className="text-xs">{tool.label}</span></Button>}
      </div>;})}
    </nav>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Customize dock</DialogTitle><DialogDescription>Choose up to four tools. These choices are saved on this device.</DialogDescription></DialogHeader>
      <FieldGroup>{draft.map((value,index)=><Field key={index}><FieldLabel htmlFor={`dock-slot-${index}`}>Slot {index+1}</FieldLabel><Select value={value||'empty'} onValueChange={next=>setDraft(current=>current.map((v,i)=>i===index?(next==='empty'?'':next||''):v))}><SelectTrigger id={`dock-slot-${index}`}><SelectValue/></SelectTrigger><SelectContent><SelectGroup><SelectItem value="empty">Empty</SelectItem>{TOOLS.map(tool=><SelectItem key={tool.id} value={tool.id}>{tool.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>)}</FieldGroup>
      <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={()=>{save(dockSlots(draft));setOpen(false);}}>Save dock</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
