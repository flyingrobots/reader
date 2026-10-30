/* Now playing: a status-line control for the utterance Reader last queued with AI-TTS.
   Polls GET /api/speak/<id> every two seconds while the page is visible and hides
   itself when the daemon reports a terminal state. Transport buttons are enabled
   only while this utterance is the one AI-TTS is playing (the server enforces it too). */
import {useSyncExternalStore} from 'react';
import {Pause, Play, SkipForward, StepBack, StepForward, Volume2} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';

export type Speaking={id:string;state:string|null;held:boolean;current:boolean;segment_count?:number|null;completed_segments?:number|null;segment?:{number:number;count:number}|null;error?:string|null;terminal?:boolean};
type Api=(path:string,payload?:unknown)=>Promise<any>;
const TERMINAL=new Set(['Played','Skipped','Cancelled','Failed']);
let speaking:Speaking|null=null,api:Api|null=null,timer:ReturnType<typeof setTimeout>|undefined,failures=0,generation=0;
const listeners=new Set<()=>void>();
const set=(next:Speaking|null)=>{speaking=next;listeners.forEach(l=>l());};
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};

export function setSpeechApi(value:Api){api=value;}
function schedule(){
  clearTimeout(timer);if(!speaking)return;const mine=generation;
  timer=setTimeout(()=>{if(mine!==generation)return;if(document.visibilityState==='visible')poll();else document.addEventListener('visibilitychange',()=>{if(mine===generation)poll();},{once:true});},2000);
}
async function poll(){
  const id=speaking?.id,mine=generation;if(!id||!api)return;
  try{
    const next:Speaking=await api('/api/speak/'+encodeURIComponent(id));if(mine!==generation)return;failures=0;
    if(next.state&&TERMINAL.has(next.state)){
      if(next.state==='Failed')toast.error('AI-TTS couldn’t speak that',{description:next.error||undefined,duration:8000});
      set(null);return;
    }
    set(next);
  }catch(error){
    if(mine!==generation)return;
    if(++failures>=3){toast.error('Lost track of AI-TTS playback',{description:error instanceof Error?error.message:String(error),duration:8000});set(null);return;}
  }
  schedule();
}
/** Show the control for a freshly queued utterance; a newer one replaces it. */
export function trackSpeech(submission:Speaking){generation++;failures=0;set({...submission,current:false});schedule();}

async function act(action:string){
  const id=speaking?.id;if(!id||!api)return;
  try{await api('/api/speak/'+encodeURIComponent(id),{action});}
  catch(error){toast.error(error instanceof Error?error.message:String(error),{duration:6000});}
  generation++;poll();
}
function label(s:Speaking){
  const paused=s.state==='Paused'||(s.current&&s.held);
  const progress=s.segment?` · ${s.segment.number} of ${s.segment.count}`:s.segment_count&&s.segment_count>1&&s.state==='Playing'?` · ${(s.completed_segments||0)+1} of ${s.segment_count}`:'';
  if(s.current||s.state==='Playing'||s.state==='Paused')return (paused?'Paused':'Speaking')+progress;
  if(s.state==='Synthesizing')return 'Preparing speech';
  return s.held?'Queued · held':'Queued';
}
export function SpeechControl(){
  const s=useSyncExternalStore(subscribe,()=>speaking);
  if(!s)return null;
  const paused=s.state==='Paused'||(s.current&&s.held),text=label(s);
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-foreground" data-speech-control="" data-speech-state={s.state||''} data-current={s.current?'':undefined} role="group" aria-label="AI-TTS playback">
    <Volume2 aria-hidden="true" className="size-3.5 text-primary max-[520px]:text-muted-foreground"/>
    <span className="text-[10px] text-muted-foreground max-[700px]:hidden" data-speech-label="" aria-live="polite">{text}</span>
    <ButtonGroup>
      <Button variant="ghost" size="icon-xs" data-speech-extra="" className="max-[700px]:hidden" aria-label="Previous segment" title="Previous segment" disabled={!s.current} onClick={()=>act('previous_segment')}><StepBack/></Button>
      <Button variant="ghost" size="icon-xs" data-speech-action={paused?'resume':'pause'} aria-label={paused?'Resume speech':'Pause speech'} title={paused?'Resume':'Pause'} disabled={!s.current} onClick={()=>act(paused?'resume':'pause')}>{paused?<Play/>:<Pause/>}</Button>
      <Button variant="ghost" size="icon-xs" data-speech-extra="" className="max-[700px]:hidden" aria-label="Next segment" title="Next segment" disabled={!s.current} onClick={()=>act('next_segment')}><StepForward/></Button>
      <Button variant="ghost" size="icon-xs" data-speech-extra="" className="max-[700px]:hidden" aria-label={s.current?'Skip this speech':'Cancel queued speech'} title={s.current?'Skip':'Cancel'} onClick={()=>act(s.current?'skip':'cancel')}><SkipForward/></Button>
    </ButtonGroup>
  </span>;
}
