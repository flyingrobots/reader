/* Companions: the optional tools Reader works with (AI-TTS, Colorful Language, wide-md, git-locks),
   their status in Behind the scenes, and the calm "not installed" prompt a missing feature shows.
   Installs run as maintenance jobs on the server (/api/companions); this file only asks for them. */
import {useEffect, useRef, useState} from 'react';
import {CheckIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, ListChecksIcon} from 'lucide-react';
import {SpeechVoice} from './speech-voice';
import {toast} from 'sonner';
import {Alert, AlertDescription, AlertTitle} from './components/ui/alert';
import {Button} from './components/ui/button';
import {Card, CardDescription, CardFooter, CardHeader, CardTitle} from './components/ui/card';
import {ButtonGroup} from './components/ui/button-group';
import {CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockHeader, CodeBlockTitle} from './components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from './components/ui/collapsible';
import {Field, FieldLabel} from './components/ui/field';
import {Input} from './components/ui/input';
import {Kbd} from './components/ui/kbd';
import {StatusBadge, type Tone} from './theme/atoms/status-badge';
import {SectionHeading} from './theme/atoms/section-heading';
import {RelativeTime} from './theme/atoms/time';
import {FactList} from './theme/molecules/fact-list';
import {Notice} from './theme/molecules/notice';
import {LoadingState} from './theme/molecules/states';
import {Toolbar} from './theme/molecules/toolbar';
import {StatusCard} from './theme/organisms/status-card';
import {CardGrid} from './theme/templates/card-grid';
import type {Job} from './backstage';

type Guide={commands:string[];note:string};
type Plan={available:boolean;pinned?:string;reason:string|null;changes:string[];help?:string|null};
type Start={available:boolean;label:string;plist:string;commands:string[];changes:string[]};
export type Companion={name:string;title:string;repo:string;feature:string;keys:string|null;enables:string;state:'installed'|'missing'|'too-old'|'not-running'|'error';label:string;
  version:string|null;path:string|null;origin?:string|null;managed?:boolean;message:string|null;actions:string[];install:Plan|null;start?:Start;guide:Guide|null;facts:[string,string][];job:Job|null;
  coordination?:{mode:string;label:string;message:string;store:string|null}};
type Cli={name:string;title:string;link:string|null;path:string|null;state:string;voices:string[]};
export type CompanionsStatus={companions:Companion[];cli?:Cli[];local_model?:{preset:string|null;base_url:string|null;gpu:{mode:string;label:string;message:string}|null}|null;checked_at:string};
type Api=(path:string,payload?:unknown)=>Promise<any>;
export type CompanionAct=(name:string,action:string,extra?:Record<string,unknown>)=>Promise<any>;

const TONE:Record<string,Tone>={installed:'ok',missing:'neutral','too-old':'attention','not-running':'attention',error:'error'};
const ACTION_LABEL:Record<string,string>={install:'Install',update:'Update',start:'Start…'};

// "Don't show again", per feature. A dismissed prompt still says what is missing, in one line.
const DISMISSED='reader.companions.dismissed.v1';
function dismissedSet():Set<string>{try{return new Set(JSON.parse(localStorage.getItem(DISMISSED)||'[]'));}catch{return new Set();}}
export function isDismissed(name:string){return dismissedSet().has(name);}
export function setDismissed(name:string,value=true){try{const set=dismissedSet();if(value)set.add(name);else set.delete(name);localStorage.setItem(DISMISSED,JSON.stringify([...set]));}catch{/* Private windows: the prompt shows again. */}}

// Behind the scenes opens a card with its guide, path form or confirmation already showing.
let focus:{name:string;panel:string}|null=null;const focusListeners=new Set<()=>void>();
export function focusCompanion(name:string,panel='guide'){focus={name,panel};focusListeners.forEach(l=>l());}

async function copy(text:string){
  try{await navigator.clipboard.writeText(text);return true;}
  catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
    const ok=document.execCommand('copy');area.remove();return ok;}
}
function Commands({guide,id}:{guide:Guide;id:string}){
  const [copied,setCopied]=useState(false);const text=guide.commands.join('\n');
  return <div className="flex min-w-0 flex-col gap-2" id={id} data-companion-panel="guide">
    <CodeBlock size="sm"><CodeBlockHeader><CodeBlockTitle>Commands</CodeBlockTitle><CodeBlockActions>
      <Button variant="ghost" size="xs" aria-label="Copy the commands" onClick={async()=>{if(await copy(text)){setCopied(true);setTimeout(()=>setCopied(false),2000);}else toast.error('Couldn’t copy; select the commands instead.');}}>
        {copied?<CheckIcon data-icon="inline-start" aria-hidden/>:<CopyIcon data-icon="inline-start" aria-hidden/>}{copied?'Copied':'Copy'}</Button></CodeBlockActions></CodeBlockHeader>
      <CodeBlockContent wrap data-reader-decoration="">{text}</CodeBlockContent></CodeBlock>
    <span className="text-xs text-muted-foreground">{guide.note}</span>
  </div>;
}
function Changes({title,items,confirm,onConfirm,onCancel,busy}:{title:string;items:string[];confirm:string;onConfirm:()=>void;onCancel:()=>void;busy:boolean}){
  const ref=useRef<HTMLButtonElement>(null);useEffect(()=>{ref.current?.focus();},[]);
  return <Alert role="group" aria-label={title} data-companion-panel="confirm" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onCancel();}}}>
    <ListChecksIcon aria-hidden/>
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription className="flex flex-col gap-2">
      <ul className="list-disc pl-4 [overflow-wrap:anywhere]">{items.map(item=><li key={item}>{item}</li>)}</ul>
      <span>Nothing runs with sudo, and nothing else on this Mac is changed.</span>
      <ButtonGroup><Button ref={ref} size="sm" data-confirm="" disabled={busy} onClick={onConfirm}>{confirm}</Button><Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button></ButtonGroup>
    </AlertDescription>
  </Alert>;
}
function Log({api,name,job}:{api:Api;name:string;job:Job|null}){
  const [text,setText]=useState<string|null>(null),[open,setOpen]=useState(false);
  useEffect(()=>{if(!open)return;let live=true;const load=()=>api('/api/companions/log?name='+encodeURIComponent(name)).then(r=>{if(live)setText(r.log||'');},()=>{});load();
    const timer=job?setInterval(load,1500):undefined;return ()=>{live=false;clearInterval(timer);};},[open,name,job?.id]);
  return <Collapsible open={open} onOpenChange={setOpen} data-companion-log="" className="rounded-lg border">
    <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>Install log</CollapsibleTrigger>
    <CollapsibleContent className="border-t p-2"><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-72" data-reader-decoration="">{text===null?'Loading…':text||'No install has run yet.'}</CodeBlockContent></CodeBlock></CollapsibleContent>
  </Collapsible>;
}

function CompanionCard({item,api,act,busy}:{item:Companion;api:Api;act:CompanionAct;busy:boolean}){
  const [panel,setPanel]=useState<string|null>(null),[path,setPath]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{const apply=()=>{if(focus&&focus.name===item.name){setPanel(focus.panel);focus=null;requestAnimationFrame(()=>document.getElementById('companion-'+item.name)?.scrollIntoView({block:'center',behavior:'smooth'}));}};
    apply();focusListeners.add(apply);return ()=>{focusListeners.delete(apply);};},[item.name]);
  const running=item.job,primary=item.actions.find(a=>a in ACTION_LABEL);
  async function run(action:string,extra:Record<string,unknown>={}){
    setPending(true);setError(null);
    try{await act(item.name,action,extra);setPanel(null);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(false);}
  }
  const plan=primary==='start'?item.start:item.install;
  const state:{label:string;tone:Tone}=running?{label:running.progress?.split(' · ')[0]||running.label,tone:'active'}:{label:item.label,tone:TONE[item.state]||'neutral'};
  const wide=(label:string)=>label==='Path'||label==='Socket'||label==='Store';
  const facts:[string,string|null|undefined][]=[['Version',item.version],['Path',item.path],...item.facts];
  return <StatusCard id={'companion-'+item.name} data-companion={item.name} data-state={running?'running':item.state} title={item.title}
    description={<>{item.enables}{item.keys?<> · <Kbd>{item.keys}</Kbd></>:null}</>}
    badge={<StatusBadge tone={state.tone} busy={!!running} data-companion-badge="">{state.label}</StatusBadge>}
    footer={<div className="flex w-full flex-wrap items-center justify-between gap-2"><ButtonGroup className="flex-wrap">
      {primary?<Button size="sm" data-action={primary} disabled={!!running||busy||pending} onClick={()=>setPanel(panel==='confirm'?null:'confirm')}>{ACTION_LABEL[primary]}</Button>:null}
      {item.guide&&item.state!=='installed'?<Button size="sm" variant="outline" data-action="guide" aria-expanded={panel==='guide'} onClick={()=>setPanel(panel==='guide'?null:'guide')}>How to install</Button>:null}
      {item.actions.includes('set-path')?<Button size="sm" variant="outline" data-action="set-path" aria-expanded={panel==='path'} onClick={()=>{setPath(item.path||'');setPanel(panel==='path'?null:'path');}}>Set path</Button>:null}
      <Button size="sm" variant="outline" data-action="check" disabled={pending} onClick={()=>run('check')}>Check again</Button>
    </ButtonGroup><Button variant="link" size="sm" className="px-0" nativeButton={false} render={<a href={item.repo} target="_blank" rel="noreferrer"/>}>{item.repo.replace('https://github.com/','')}<ExternalLinkIcon data-icon="inline-end" aria-hidden/></Button></div>}>
    {running?<span className="text-sm" aria-live="polite" data-companion-progress="">{running.progress||running.label+'…'}</span>:item.message?<Notice tone={item.state==='error'?'error':'info'} title={item.message}/>:null}
    <FactList layout="rows" facts={facts.map(([label,value])=>({key:label.toLowerCase(),label,value:value&&wide(label)?<code className="font-mono text-xs">{value}</code>:value}))}/>
    {item.name==='ai-tts'?<SpeechVoice api={api} saveDefault/>:null}
    {item.install&&!item.install.available&&item.state!=='installed'&&item.install.reason?<Notice data-install-blocked="" title="Install isn’t available here">{item.install.reason}{item.install.help?<> <a className="text-primary underline-offset-4 hover:underline" href={item.install.help} target="_blank" rel="noreferrer">{item.install.help.replace('https://','')}</a></>:null}</Notice>:null}
    {error?<Notice tone="error" role="alert" title={error}/>:null}
    {panel==='confirm'&&plan?<Changes title={primary==='start'?'Start AI-TTS':`${ACTION_LABEL[primary!]} ${item.title}${item.install?.pinned?' '+item.install.pinned:''}`} items={[...plan.changes,...(primary==='start'&&item.start?item.start.commands.map(c=>'Runs: '+c):[])]}
      confirm={primary==='start'?'Start':ACTION_LABEL[primary!]} busy={pending||busy} onConfirm={()=>run(primary!)} onCancel={()=>setPanel(null)}/>:null}
    {panel==='guide'&&item.guide?<Commands guide={item.guide} id={'companion-guide-'+item.name}/>:null}
    {panel==='path'?<form data-companion-panel="path" onSubmit={event=>{event.preventDefault();run('set-path',{path});}}>
      <Field><FieldLabel htmlFor={'companion-path-'+item.name}>{item.name==='git-locks'?'Path to git-locks, or to a git-locks store (…/store.git)':'Path to the colorful binary'}</FieldLabel>
        <div className="flex flex-wrap gap-2"><Input id={'companion-path-'+item.name} className="min-w-48 flex-1" value={path} placeholder="/absolute/path" autoFocus onChange={event=>setPath(event.target.value)}/>
          <ButtonGroup><Button size="sm" type="submit" disabled={pending}>Save</Button><Button size="sm" variant="outline" type="button" disabled={pending} onClick={()=>run('set-path',{path:''})}>Clear</Button></ButtonGroup></div></Field>
    </form>:null}
    {['colorful','wide-md','ai-tts'].includes(item.name)&&(item.install||item.start||running)?<Log api={api} name={item.name} job={running}/>:null}
  </StatusCard>;
}

export function CompanionsSection({api,act,status,busy,onRefresh}:{api:Api;act:CompanionAct;status:CompanionsStatus|null;busy:boolean;onRefresh:()=>void}){
  return <section className="flex flex-col gap-4" id="companions" aria-labelledby="companions-title">
    <SectionHeading id="companions-title">Companions</SectionHeading>
    <Toolbar status={<>{status?<>Checked <RelativeTime value={status.checked_at}/></>:'Looking for companion tools…'}<span className="mt-1 block text-muted-foreground">Separate projects that add features. Reader works without each one; a feature that needs a missing companion says so and offers setup here.</span></>}>
      <Button id="companions-check" variant="outline" size="sm" onClick={onRefresh}>Check again</Button></Toolbar>
    {status?<CardGrid>{status.companions.map(item=><CompanionCard key={item.name} item={item} api={api} act={act} busy={busy}/>)}</CardGrid>:<LoadingState/>}
  </section>;
}

/** The non-blocking prompt a missing feature shows: what is missing, what it adds, its repo, Install when safe, and Don't show again. */
export function CompanionPrompt({item,id,onInstall,onSetup}:{item:Companion;id:string|number;onInstall:()=>void;onSetup:(panel:string)=>void}){
  const install=item.actions.includes('install')||item.actions.includes('update')?item.actions.includes('install')?'install':'update':null;
  const heading=item.state==='not-running'?`${item.title} isn’t running`:item.state==='too-old'?`${item.feature} needs a newer ${item.title}`:`${item.feature} needs ${item.title}`;
  return <Card size="sm" className="companion-prompt w-[min(var(--width,356px),calc(100vw-32px))] font-sans shadow-lg" data-ui="shadcn" data-companion-prompt={item.name} role="status">
    <CardHeader><CardTitle data-prompt-title="">{heading}</CardTitle>
      <CardDescription>{item.enables}{item.state==='missing'&&install?' Install builds the pinned release into this vault’s tooling folder; it takes a few minutes.':''}{item.state==='not-running'&&item.start?.available?' Start asks launchd to run its daemon.':''}</CardDescription></CardHeader>
    <CardFooter className="flex-wrap gap-2">
      {install?<Button size="xs" data-prompt-action="install" onClick={()=>{toast.dismiss(id);onInstall();}}>{install==='install'?'Install':'Update'}</Button>
        :item.state==='not-running'&&item.start?.available?<Button size="xs" data-prompt-action="start" onClick={()=>{toast.dismiss(id);onSetup('confirm');}}>Start…</Button>
        :<Button size="xs" data-prompt-action="setup" onClick={()=>{toast.dismiss(id);onSetup('guide');}}>How to install</Button>}
      <Button size="xs" variant="link" nativeButton={false} render={<a href={item.repo} target="_blank" rel="noreferrer"/>}>About {item.title}</Button>
      <Button size="xs" variant="ghost" className="ml-auto" data-prompt-action="dismiss" onClick={()=>{setDismissed(item.name);toast.dismiss(id);}}>Don’t show again</Button>
    </CardFooter>
  </Card>;
}
