/* Now playing: a status-line control for the utterance Reader last queued with AI-TTS.
   In browser-streaming mode (playback=false), segments are synthesized on the server
   and streamed sequentially to a local <audio> element in this browser tab, so
   transport controls act locally and never affect other devices or host speakers. */
import {useState,useSyncExternalStore} from 'react';
import {Pause, Play, SkipForward, StepBack, StepForward, Volume2} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';

export type SpeechSegment={index:number;state?:string|null;duration_ms?:number|null;audio_ready:boolean;error?:string|null};
export type Speaking={id:string;path?:string;source_sha256?:string;state:string|null;held:boolean;current:boolean;playback?:boolean;segment_count?:number|null;completed_segments?:number|null;segment?:{number:number;count:number}|null;segments?:SpeechSegment[];error?:string|null;terminal?:boolean};
type Api=(path:string,payload?:unknown)=>Promise<any>;
const TERMINAL=new Set(['Played','Skipped','Cancelled','Failed']);
let speaking:Speaking|null=null,api:Api|null=null,timer:ReturnType<typeof setTimeout>|undefined,failures=0,generation=0;
let audio:HTMLAudioElement|null=null,activeSegment=0,localPaused=false,loadedUrl='';
const listeners=new Set<()=>void>();
const set=(next:Speaking|null)=>{speaking=next;listeners.forEach(l=>l());};
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};

function ensureAudio(){
  if(audio||typeof Audio==='undefined')return audio;
  audio=new Audio();
  audio.preload='auto';
  audio.addEventListener('ended',()=>{
    const s=speaking;
    if(!s||s.playback!==false)return;
    const total=s.segment_count??s.segments?.length??1;
    activeSegment+=1;
    loadedUrl='';
    if(activeSegment>=total){
      const id=s.id;
      generation++;
      stopAudio();
      set(null);
      api?.('/api/speak/'+encodeURIComponent(id),{action:'cancel'}).catch(()=>{});
      return;
    }
    syncBrowserAudio(s);
  });
  return audio;
}
function stopAudio(){
  clearTimeout(timer);
  loadedUrl='';
  localPaused=false;
  activeSegment=0;
  if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
}
function syncBrowserAudio(s:Speaking){
  const segments=s.segments||[];
  const total=s.segment_count??(segments.length||1);
  const seg=segments.find(item=>item.index===activeSegment);
  if(seg?.error){
    toast.error('AI-TTS couldn’t speak that',{description:seg.error,duration:8000});
    stopAudio();set(null);return;
  }
  if(seg?.audio_ready){
    const url='/api/speak/'+encodeURIComponent(s.id)+'/segments/'+activeSegment;
    const player=ensureAudio();
    if(player&&loadedUrl!==url){
      loadedUrl=url;
      player.src=url;
      if(!localPaused){
        player.play().catch(()=>{localPaused=true;if(speaking?.id===s.id)set({...speaking,state:'Paused',current:true});});
      }
    }
    set({...s,current:true,held:false,state:localPaused?'Paused':'Playing',segment:{number:activeSegment+1,count:total}});
    return;
  }
  set({...s,current:false,held:false,state:'Synthesizing',segment:{number:activeSegment+1,count:total}});
}

export function setSpeechApi(value:Api){api=value;}
function schedule(delay=2000){
  clearTimeout(timer);if(!speaking)return;const mine=generation;
  timer=setTimeout(()=>{if(mine!==generation)return;if(document.visibilityState==='visible')poll();else document.addEventListener('visibilitychange',()=>{if(mine===generation)poll();},{once:true});},delay);
}
async function poll(){
  const id=speaking?.id,mine=generation;if(!id||!api)return;
  try{
    const next:Speaking=await api('/api/speak/'+encodeURIComponent(id));if(mine!==generation)return;failures=0;
    if(next.state&&TERMINAL.has(next.state)){
      if(next.state==='Failed')toast.error('AI-TTS couldn’t speak that',{description:next.error||undefined,duration:8000});
      stopAudio();set(null);return;
    }
    const merged:Speaking={...next,path:speaking?.path,source_sha256:speaking?.source_sha256};
    if(merged.playback===false){
      syncBrowserAudio(merged);
      const segments=merged.segments||[];
      const total=merged.segment_count??(segments.length||1);
      const allReady=segments.length>=total&&segments.every(seg=>seg.audio_ready);
      if(!allReady&&speaking)schedule(segments.find(seg=>seg.index===activeSegment)?.audio_ready?1500:350);
      return;
    }
    set(merged);
  }catch(error){
    if(mine!==generation)return;
    if(++failures>=3){toast.error('Lost track of AI-TTS playback',{description:error instanceof Error?error.message:String(error),duration:8000});stopAudio();set(null);return;}
  }
  schedule();
}
/** Show the control for a freshly queued utterance; a newer one replaces it. */
export function trackSpeech(submission:Speaking){
  generation++;failures=0;stopAudio();
  set({...submission,current:false});
  schedule(submission.playback===false?200:2000);
}

async function act(action:string){
  const s=speaking;if(!s||!api)return;
  if(s.playback===false){
    const total=s.segment_count??(s.segments?.length||1);
    if(action==='pause'){
      localPaused=true;audio?.pause();
      set({...s,state:'Paused',current:true});
      return;
    }
    if(action==='resume'){
      localPaused=false;
      if(audio)audio.play().catch(()=>{localPaused=true;if(speaking?.id===s.id)set({...speaking,state:'Paused',current:true});});
      set({...s,state:'Playing',current:true});
      return;
    }
    if(action==='previous_segment'){
      if(activeSegment>0){activeSegment-=1;loadedUrl='';localPaused=false;syncBrowserAudio(s);}
      return;
    }
    if(action==='next_segment'){
      if(activeSegment+1<total){activeSegment+=1;loadedUrl='';localPaused=false;syncBrowserAudio(s);return;}
      action='skip';
    }
    if(action==='skip'||action==='cancel'){
      const id=s.id;
      generation++;stopAudio();set(null);
      try{await api('/api/speak/'+encodeURIComponent(id),{action:'cancel'});}catch{}
      return;
    }
  }
  try{await api('/api/speak/'+encodeURIComponent(s.id),{action});}
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
/** What is speaking now, for a slot that exists only while something is. */
export const useSpeaking=()=>useSyncExternalStore(subscribe,()=>speaking);
export function SpeechControl({expanded=false}:{expanded?:boolean}={}){
  const s=useSyncExternalStore(subscribe,()=>speaking);
  if(!s)return null;
  const paused=s.state==='Paused'||(s.current&&s.held),text=label(s);
  return <span className={expanded?"inline-flex flex-wrap items-center gap-1.5 text-foreground":"inline-flex items-center gap-1.5 whitespace-nowrap text-foreground"} data-speech-control="" data-speech-state={s.state||''} data-current={s.current?'':undefined} role="group" aria-label="AI-TTS playback">
    <Volume2 aria-hidden="true" className="size-3.5 text-primary max-[520px]:text-muted-foreground"/>
    <span className={expanded?"text-sm text-muted-foreground":"text-[10px] text-muted-foreground max-[700px]:hidden"} data-speech-label="" aria-live="polite">{text}</span>
    <ButtonGroup>
      <Button variant="ghost" size={expanded?"icon-sm":"icon-xs"} data-speech-extra="" className={expanded?undefined:"max-[700px]:hidden"} aria-label="Previous segment" title="Previous segment" disabled={!s.current} onClick={()=>act('previous_segment')}><StepBack/></Button>
      <Button variant="ghost" size={expanded?"icon-sm":"icon-xs"} data-speech-action={paused?'resume':'pause'} aria-label={paused?'Resume speech':'Pause speech'} title={paused?'Resume':'Pause'} disabled={!s.current} onClick={()=>act(paused?'resume':'pause')}>{paused?<Play/>:<Pause/>}</Button>
      <Button variant="ghost" size={expanded?"icon-sm":"icon-xs"} data-speech-extra="" className={expanded?undefined:"max-[700px]:hidden"} aria-label="Next segment" title="Next segment" disabled={!s.current} onClick={()=>act('next_segment')}><StepForward/></Button>
      <Button variant="ghost" size={expanded?"icon-sm":"icon-xs"} data-speech-extra="" className={expanded?undefined:"max-[700px]:hidden"} aria-label={s.current?'Skip this speech':'Cancel queued speech'} title={s.current?'Skip':'Cancel'} onClick={()=>act(s.current?'skip':'cancel')}><SkipForward/></Button>
    </ButtonGroup>
  </span>;
}

/** The article-title action shares the footer's exact utterance and transport store. */
export function ArticleSpeechControl({path,sourceSha,onRead}:{path:string;sourceSha:string;onRead:()=>Promise<unknown>}){
  const s=useSyncExternalStore(subscribe,()=>speaking),[pending,setPending]=useState(false);
  if(s?.path===path&&s.source_sha256===sourceSha)return <SpeechControl expanded/>;
  return <Button id="speak-article" variant="outline" size="sm" disabled={pending} onClick={async()=>{setPending(true);try{await onRead();}finally{setPending(false);}}}><Volume2 data-icon="inline-start"/>{pending?'Queuing…':'Read aloud'}</Button>;
}
