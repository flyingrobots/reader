/* Admin › Publish: upload documents into the private vault and watch them get filed. Publishing here means filing, and
   nothing becomes public. Uploads go to /api/inbox/deliveries; filing is a run scoped to this upload, so whatever else
   is waiting stays put. Each privacy level says plainly where its text can go. */
import {useEffect, useRef, useState} from 'react';
import {FileUpIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Spinner} from '@/components/ui/spinner';
import {StatusBadge, type Tone} from '@/theme/atoms/status-badge';
import {Notice} from '@/theme/molecules/notice';
import {StatusCard} from '@/theme/organisms/status-card';
import {plural} from '../../plural';
import {size} from './inbox';

type Api=(path:string,payload?:unknown,extra?:Record<string,unknown>)=>Promise<any>;
type Stage='idle'|'uploading'|'waiting'|'filing'|'filed'|'stopped';
type Step={message:string;state?:string};

const CONTENT_TYPE='application/vnd.reader.delivery',MAX_FILE=32*1024**2,MAX_TOTAL=64*1024**2,MAX_FILES=64;
const LEVELS=[
  {value:'no-cloud',label:'No cloud models',detail:'Only a local model reads it. It is still committed and pushed with your vault.'},
  {value:'normal',label:'Normal',detail:'Codex, Claude Code, agy or a local model may read excerpts, in that order. Committed and pushed with your vault.'},
  {value:'machine-only',label:'This machine only',detail:'Encrypted and never pushed. Not available yet.',disabled:true}];
const STAGES:Record<Stage,{label:string;tone:Tone}>={idle:{label:'Ready',tone:'neutral'},uploading:{label:'Uploading',tone:'active'},waiting:{label:'Uploaded',tone:'active'},
  filing:{label:'Filing',tone:'active'},filed:{label:'Filed',tone:'ok'},stopped:{label:'Not filed',tone:'error'}};

async function digest(file:File){
  const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
const titleOf=(name:string)=>name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim();
/** Browsers report a chosen folder's files with their paths; a bare file uses its name. */
const pathOf=(file:File)=>(file as File&{webkitRelativePath?:string}).webkitRelativePath||file.name;

export function PublishPage({api}:{api:Api}){
  const [files,setFiles]=useState<File[]>([]),[title,setTitle]=useState(''),[author,setAuthor]=useState(''),[level,setLevel]=useState('no-cloud');
  const [stage,setStage]=useState<Stage>('idle'),[steps,setSteps]=useState<Step[]>([]),[error,setError]=useState<string|null>(null),[note,setNote]=useState<string|null>(null);
  const [dragging,setDragging]=useState(false);
  const input=useRef<HTMLInputElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const total=files.reduce((sum,file)=>sum+file.size,0),busy=['uploading','waiting','filing'].includes(stage);
  const problem=files.length>MAX_FILES?`An upload has at most ${MAX_FILES} files.`:files.some(file=>file.size>MAX_FILE)?'Each file can be at most 32 MB.':total>MAX_TOTAL?'An upload can be at most 64 MB.':null;
  const choose=(chosen:FileList|null)=>{if(!chosen?.length)return;const list=Array.from(chosen);setFiles(list);setStage('idle');setSteps([]);setError(null);setNote(null);if(!title.trim())setTitle(titleOf(list[0].name));};

  const watch=(id:string,run:string|null)=>{
    const tick=async()=>{
      try{
        const [delivery,inbox]=await Promise.all([api('/api/inbox/deliveries?id='+encodeURIComponent(id)),api('/api/inbox')]);
        const ours=!!run&&inbox.runner?.run_id===run;
        if(ours&&inbox.model_chain?.run_id===run)setSteps(inbox.model_chain.steps||[]);
        if(delivery.status==='filed'){setStage('filed');setNote(`Filed and committed to ${delivery.bundle_path}.`);return;}
        if(ours&&!['starting','running'].includes(inbox.runner.status)){setStage('stopped');setNote(inbox.runner.status==='finished'?'It wasn’t filed, and it stays safely in the inbox with its receipt.':inbox.runner.message);return;}
      }catch(cause){setError((cause as Error).message);setStage('stopped');return;}
      timer.current=setTimeout(tick,1000);
    };
    timer.current=setTimeout(tick,300);
  };

  const publish=async()=>{
    setError(null);setNote(null);setSteps([]);setStage('uploading');
    try{
      const described=await Promise.all(files.map(async file=>({path:pathOf(file),bytes:file.size,sha256:await digest(file)})));
      const id=crypto.randomUUID();
      const header={upload:1,request_id:id,title:title.trim(),privacy:level,provenance:author.trim()?{author:author.trim()}:{},files:described};
      await api('/api/inbox/deliveries',{},{contentType:CONTENT_TYPE,body:new Blob([JSON.stringify(header)+'\n',...files])});
      setStage('waiting');
      let run:string|null=null;
      try{run=(await api('/api/inbox',{action:'start',arrivals:[id]})).run_id;setStage('filing');}
      catch(cause){setStage('stopped');setNote(`It’s safely in the inbox, but filing didn’t start: ${(cause as Error).message}`);return;}
      watch(id,run);
    }catch(cause){setStage('stopped');setError((cause as Error).message);}
  };

  const state=STAGES[stage];
  return <section id="backstage-publish" aria-label="Publish" className="flex flex-col gap-6" data-publish-stage={stage}>
    <form className="contents" onSubmit={event=>{event.preventDefault();publish();}}>
      <StatusCard title="Publish to your library" description="Files go into your private vault. Nothing here becomes public."
        badge={<StatusBadge tone={state.tone} busy={busy} data-publish-badge="">{state.label}</StatusBadge>}
        footer={<Button id="publish-submit" type="submit" disabled={busy||!files.length||!title.trim()||!!problem}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:<FileUpIcon data-icon="inline-start" aria-hidden/>}{busy?state.label+'…':'Publish'}</Button>}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="publish-files">Files</FieldLabel>
            <div id="publish-drop" data-dragging={dragging?'true':'false'} className="rounded-lg border border-dashed border-border p-6 text-center data-[dragging=true]:bg-muted"
              onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);if(!busy)choose(event.dataTransfer.files);}}>
              <input ref={input} id="publish-files" type="file" multiple className="sr-only" disabled={busy} onChange={event=>choose(event.target.files)}/>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>input.current?.click()}>Choose files</Button>
              <p className="mt-2 text-sm text-muted-foreground">or drop them here</p>
            </div>
            <FieldDescription id="publish-summary">{files.length?`${plural(files.length,'file')} · ${size(total)}. The first, ${files[0].name}, is the main document.`:'Up to 64 files and 64 MB. Choose the main document first.'}</FieldDescription>
          </Field>
          {problem?<Notice id="publish-problem" tone="error" role="alert">{problem}</Notice>:null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="publish-title">Title</FieldLabel><Input id="publish-title" value={title} maxLength={500} disabled={busy} onChange={event=>setTitle(event.target.value)}/></Field>
            <Field><FieldLabel htmlFor="publish-author">Author <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="publish-author" value={author} maxLength={1000} disabled={busy} onChange={event=>setAuthor(event.target.value)}/></Field>
          </div>
          <fieldset className="flex flex-col gap-3" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">Who can read it</legend>
            {LEVELS.map(option=><label key={option.value} className="flex items-start gap-2 text-sm has-[:disabled]:opacity-60">
              <input type="radio" name="publish-level" className="mt-1" value={option.value} checked={level===option.value} disabled={option.disabled} onChange={()=>setLevel(option.value)}/>
              <span><span className="font-medium">{option.label}</span><br/><span className="text-muted-foreground">{option.detail}</span></span>
            </label>)}
          </fieldset>
        </FieldGroup>
      </StatusCard>
    </form>
    {stage!=='idle'?<StatusCard title="Progress">
      <ol id="publish-steps" className="flex flex-col gap-1 text-sm" aria-live="polite">
        <li data-step="upload">{stage==='uploading'?'Uploading…':error&&stage==='stopped'&&!steps.length&&!note?'The upload failed.':'Uploaded, with its receipt checked.'}</li>
        {stage==='filing'&&!steps.length?<li>Starting the filing run…</li>:null}
        {steps.map((step,index)=><li key={index} data-step-state={step.state}>{step.message}</li>)}
      </ol>
      {error?<Notice id="publish-error" tone="error" role="alert">{error}</Notice>:null}
      {note?<Notice id="publish-note" tone={stage==='filed'?'info':'error'}>{note}</Notice>:null}
    </StatusCard>:null}
  </section>;
}
