/* What changed: a Sheet listing paragraph hunks between the edition someone read and this one. */
import {useEffect, useState, useSyncExternalStore} from 'react';
import {Button} from './components/ui/button';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter} from './components/ui/sheet';

type Words=['='|'-'|'+',string][];
export type Hunk={op:'equal';count:number;new_start:number;new_end:number}|{op:'insert';new:string;new_start:number;new_end:number}|{op:'delete';old:string;new_start:number;new_end:number}|{op:'replace';old:string;new:string;words:Words;new_start:number;new_end:number};
type Thread={owner:string;kind:string;status:string;quote:string};
export type ChangeSet={title?:string;status:'changed'|'unchanged'|'unavailable'|'unread';read_at?:string;against?:string|null;successor?:string;successor_revision?:number;
  stats?:{added:number;removed:number;reworded:number;unchanged:number};hunks?:Hunk[];truncated?:boolean;reason?:string;
  annotations?:{exact:number;relocated:number;orphaned:number;ambiguous:number;threads:Thread[]}};
export type ChangesOptions={data:ChangeSet;participant:string;seek:(start:number,end:number)=>void;caughtUp?:()=>Promise<void>;onClose:()=>void};

const NARROW='(max-width: 640px)';
const subscribe=(listener:()=>void)=>{const q=matchMedia(NARROW);q.addEventListener('change',listener);return ()=>q.removeEventListener('change',listener);};
const narrowNow=()=>matchMedia(NARROW).matches;
// Docked beside the page (web_ui/dock.mjs sets data-dock on the root): clicking the page keeps the panel open.
const subscribeDocked=(listener:()=>void)=>{const o=new MutationObserver(listener);o.observe(document.documentElement,{attributes:true,attributeFilter:['data-dock']});return ()=>o.disconnect();};
const dockedNow=()=>document.documentElement.dataset.dock==='right';
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
const day=(value?:string)=>value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';

/** "Your 2 highlights: 1 relocated, 1 exact. Agy's warning: its passage was removed." */
export function annotationSummary(data:ChangeSet,participant:string){
  const threads=data.annotations?.threads||[];if(!threads.length)return null;
  const groups=new Map<string,Thread[]>();for(const t of threads){const key=t.owner+'\u0000'+t.kind;groups.set(key,[...(groups.get(key)||[]),t]);}
  const said=(status:string)=>({exact:'unchanged',relocated:'relocated',orphaned:'its passage was removed',ambiguous:'its passage now appears more than once'} as Record<string,string>)[status]||status;
  // Yours first, then other readers by name, so the summary reads the same every time.
  return [...groups.values()].sort((a,b)=>(+(b[0].owner===participant)-+(a[0].owner===participant))||a[0].owner.localeCompare(b[0].owner)||a[0].kind.localeCompare(b[0].kind)).map(list=>{
    const {owner,kind}=list[0],who=owner===participant?'Your':owner+'’s',noun=kind==='warning'?'warning':'highlight';
    if(list.length===1)return `${who} ${noun}: ${said(list[0].status)}.`;
    const counts=new Map<string,number>();for(const t of list)counts.set(said(t.status),(counts.get(said(t.status))||0)+1);
    return `${who} ${list.length} ${noun}s: ${[...counts].map(([s,n])=>`${n} ${s}`).join(', ')}.`;
  }).join(' ');
}

function HunkView({hunk,seek}:{hunk:Hunk;seek:(start:number,end:number)=>void}){
  if(hunk.op==='equal')return <li className="change-equal" data-op="equal">{plural(hunk.count,'unchanged paragraph')}</li>;
  const body=hunk.op==='replace'?<p className="change-words">{hunk.words.map(([op,text],i)=>op==='='?<span key={i}>{text}</span>:op==='-'?<del key={i}>{text}</del>:<ins key={i}>{text}</ins>)}</p>
    :hunk.op==='insert'?<p className="change-text">{hunk.new}</p>:<p className="change-text"><del>{hunk.old}</del></p>;
  const label={replace:'Reworded',insert:'Added',delete:'Removed'}[hunk.op];
  return <li data-op={hunk.op}><button type="button" className={'change-hunk change-'+hunk.op} data-start={hunk.new_start} onClick={()=>seek(hunk.new_start,hunk.new_end)} aria-label={`${label}; show in the article`}>
    <span className="change-kind">{label}</span>{body}</button></li>;
}

export function ChangesPanel({data,participant,seek,caughtUp,onClose}:ChangesOptions){
  const [open,setOpen]=useState(true),[busy,setBusy]=useState(false);
  const narrow=useSyncExternalStore(subscribe,narrowNow);
  const docked=useSyncExternalStore(subscribeDocked,dockedNow);
  // Closing returns focus to the page (#59). Base UI's own return skipped the non-tabbable #main for the first
  // tabbable element inside it (the reading log), so focus moves here instead, unless it already went elsewhere.
  useEffect(()=>{if(open)return;onClose();requestAnimationFrame(()=>{const active=document.activeElement;
    if(!active||active===document.body||active.closest('#changes-panel'))document.querySelector<HTMLElement>('#main')?.focus({preventScroll:true});});},[open]);
  const s=data.stats;
  const title=data.title||(data.successor?'Compared with the newer version':data.against?`Since ${data.against} read it`:'Since you read it');
  const summary=annotationSummary(data,participant);
  // On wide screens the panel sits beside the article (no backdrop), so clicking a change shows it in place; docked, a
  // click on the page leaves it open.
  return <Sheet open={open} onOpenChange={setOpen} modal={narrow?true:false} disablePointerDismissal={docked}>
    <SheetContent side={narrow?'bottom':'right'} id="changes-panel" className="changes-panel data-[side=right]:w-full data-[side=right]:sm:max-w-[min(520px,100vw)]" data-reader-decoration=""
      finalFocus={false}>
      <SheetHeader><SheetTitle>{title}</SheetTitle>
        <SheetDescription>{data.read_at&&!data.successor?`Read on ${day(data.read_at)}. `:''}{s?[plural(s.reworded,'paragraph')+' reworded',s.added+' added',s.removed+' removed',s.unchanged+' unchanged'].join(' · '):''}</SheetDescription></SheetHeader>
      <div className="changes-body">
        {summary?<p className="changes-annotations">{summary}</p>:null}
        {data.status==='unavailable'?<p className="changes-note">{data.reason}</p>:null}
        <ol className="changes-hunks">{(data.hunks||[]).map((hunk,i)=><HunkView key={i} hunk={hunk} seek={(a,b)=>{seek(a,b);if(narrow)setOpen(false);}}/>)}</ol>
        {data.truncated?<p className="changes-note">Diff too large; showing the first {data.hunks?.length} changes.</p>:null}
      </div>
      {caughtUp?<SheetFooter><Button id="changes-caught-up" disabled={busy} onClick={async()=>{setBusy(true);try{await caughtUp();setOpen(false);}finally{setBusy(false);}}}>Mark as caught up</Button></SheetFooter>:null}
    </SheetContent></Sheet>;
}
