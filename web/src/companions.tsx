/* Companions: the optional tools Reader works with (AI-TTS, Colorful Language, wide-md, git-locks),
   their status in Behind the scenes, and the calm "not installed" prompt a missing feature shows.
   Installs run as maintenance jobs on the server (/api/companions); this file only asks for them. */
import {useEffect, useRef, useState} from 'react';
import {CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon} from 'lucide-react';
import {toast} from 'sonner';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter} from './components/ui/card';
import {Input} from './components/ui/input';
import {when, type Job} from './backstage';

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

const BADGE:Record<string,'secondary'|'outline'|'destructive'|'default'>={installed:'secondary',missing:'outline','too-old':'outline','not-running':'outline',error:'destructive'};
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
  return <div className="companion-guide" id={id}>
    <div className="companion-commands-wrap"><pre className="companion-commands" data-reader-decoration=""><code>{text}</code></pre>
      <Button variant="outline" size="xs" className="companion-copy" aria-label="Copy the commands" onClick={async()=>{if(await copy(text)){setCopied(true);setTimeout(()=>setCopied(false),2000);}else toast.error('Couldn’t copy; select the commands instead.');}}>
        {copied?<CheckIcon data-icon="inline-start" aria-hidden/>:<CopyIcon data-icon="inline-start" aria-hidden/>}{copied?'Copied':'Copy'}</Button></div>
    <p className="backstage-note">{guide.note}</p>
  </div>;
}
function Changes({title,items,confirm,onConfirm,onCancel,busy}:{title:string;items:string[];confirm:string;onConfirm:()=>void;onCancel:()=>void;busy:boolean}){
  const ref=useRef<HTMLButtonElement>(null);useEffect(()=>{ref.current?.focus();},[]);
  return <div className="companion-confirm" role="group" aria-label={title} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onCancel();}}}>
    <p className="backstage-message"><strong>{title}</strong></p>
    <ul>{items.map(item=><li key={item}>{item}</li>)}</ul>
    <p className="backstage-note">Nothing runs with sudo, and nothing else on this Mac is changed.</p>
    <ButtonGroup><Button ref={ref} size="sm" data-confirm="" disabled={busy} onClick={onConfirm}>{confirm}</Button><Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button></ButtonGroup>
  </div>;
}
function Log({api,name,job}:{api:Api;name:string;job:Job|null}){
  const [text,setText]=useState<string|null>(null),[open,setOpen]=useState(false);
  useEffect(()=>{if(!open)return;let live=true;const load=()=>api('/api/companions/log?name='+encodeURIComponent(name)).then(r=>{if(live)setText(r.log||'');},()=>{});load();
    const timer=job?setInterval(load,1500):undefined;return ()=>{live=false;clearInterval(timer);};},[open,name,job?.id]);
  return <details className="companion-log" onToggle={event=>setOpen((event.target as HTMLDetailsElement).open)}><summary>Install log</summary>
    <pre data-reader-decoration="">{text===null?'Loading…':text||'No install has run yet.'}</pre></details>;
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
  const state=running?{label:running.progress?.split(' · ')[0]||running.label,variant:'default' as const}:{label:item.label,variant:BADGE[item.state]||'outline'};
  const facts:[string,string|null|undefined][]=[['Version',item.version],['Path',item.path],...item.facts];
  return <Card size="sm" className="backstage-card companion-card" id={'companion-'+item.name} data-companion={item.name} data-state={running?'running':item.state}>
    <CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>{item.enables}{item.keys?<> · <kbd>{item.keys}</kbd></>:null}</CardDescription>
      <CardAction><Badge variant={state.variant} className="backstage-badge" data-companion-badge="">{running?<Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>:null}{state.label}</Badge></CardAction></CardHeader>
    <CardContent>
      {running?<p className="backstage-message companion-progress" aria-live="polite">{running.progress||running.label+'…'}</p>:item.message?<p className={'backstage-message'+(item.state==='error'?' backstage-error':'')}>{item.message}</p>:null}
      <dl className="backstage-facts">{facts.map(([label,value])=>value?<div key={label} data-fact={label.toLowerCase()} className={label==='Path'||label==='Socket'||label==='Store'?'companion-wide':''}><dt>{label}</dt><dd>{label==='Path'||label==='Socket'||label==='Store'?<code>{value}</code>:value}</dd></div>:null)}</dl>
      {item.install&&!item.install.available&&item.state!=='installed'&&item.install.reason?<p className="backstage-note" data-install-blocked="">{item.install.reason}{item.install.help?<> <a href={item.install.help} target="_blank" rel="noreferrer">{item.install.help.replace('https://','')}</a></>:null}</p>:null}
      {error?<p className="backstage-message backstage-error" role="alert">{error}</p>:null}
      {panel==='confirm'&&plan?<Changes title={primary==='start'?'Start AI-TTS':`${ACTION_LABEL[primary!]} ${item.title}${item.install?.pinned?' '+item.install.pinned:''}`} items={[...plan.changes,...(primary==='start'&&item.start?item.start.commands.map(c=>'Runs: '+c):[])]}
        confirm={primary==='start'?'Start':ACTION_LABEL[primary!]} busy={pending||busy} onConfirm={()=>run(primary!)} onCancel={()=>setPanel(null)}/>:null}
      {panel==='guide'&&item.guide?<Commands guide={item.guide} id={'companion-guide-'+item.name}/>:null}
      {panel==='path'?<form className="companion-path" onSubmit={event=>{event.preventDefault();run('set-path',{path});}}>
        <label htmlFor={'companion-path-'+item.name}>{item.name==='git-locks'?'Path to git-locks, or to a git-locks store (…/store.git)':'Path to the colorful binary'}</label>
        <div className="companion-path-row"><Input id={'companion-path-'+item.name} value={path} placeholder="/absolute/path" autoFocus onChange={event=>setPath(event.target.value)}/>
          <ButtonGroup><Button size="sm" type="submit" disabled={pending}>Save</Button><Button size="sm" variant="outline" type="button" disabled={pending} onClick={()=>run('set-path',{path:''})}>Clear</Button></ButtonGroup></div>
      </form>:null}
      {['colorful','wide-md','ai-tts'].includes(item.name)&&(item.install||item.start||running)?<Log api={api} name={item.name} job={running}/>:null}
    </CardContent>
    <CardFooter className="companion-footer"><ButtonGroup>
      {primary?<Button size="sm" data-action={primary} disabled={!!running||busy||pending} onClick={()=>setPanel(panel==='confirm'?null:'confirm')}>{ACTION_LABEL[primary]}</Button>:null}
      {item.guide&&item.state!=='installed'?<Button size="sm" variant="outline" data-action="guide" aria-expanded={panel==='guide'} onClick={()=>setPanel(panel==='guide'?null:'guide')}>How to install</Button>:null}
      {item.actions.includes('set-path')?<Button size="sm" variant="outline" data-action="set-path" aria-expanded={panel==='path'} onClick={()=>{setPath(item.path||'');setPanel(panel==='path'?null:'path');}}>Set path</Button>:null}
      <Button size="sm" variant="outline" data-action="check" disabled={pending} onClick={()=>run('check')}>Check again</Button>
    </ButtonGroup><a className="companion-repo" href={item.repo} target="_blank" rel="noreferrer">{item.repo.replace('https://github.com/','')}<ExternalLinkIcon aria-hidden className="size-3"/></a></CardFooter>
  </Card>;
}

export function CompanionsSection({api,act,status,busy,onRefresh}:{api:Api;act:CompanionAct;status:CompanionsStatus|null;busy:boolean;onRefresh:()=>void}){
  return <section className="backstage-section" id="companions" aria-labelledby="companions-title">
    <div className="backstage-section-head"><h2 id="companions-title">Companions</h2>
      <span className="backstage-checked">{status?'Checked '+when(status.checked_at):'Looking for companion tools…'}</span>
      <Button id="companions-check" variant="outline" size="sm" onClick={onRefresh}>Check again</Button></div>
    <p className="backstage-intro">Separate projects that add features. Reader works without each one; a feature that needs a missing companion says so and offers setup here.</p>
    <div className="backstage-grid">{status?status.companions.map(item=><CompanionCard key={item.name} item={item} api={api} act={act} busy={busy}/>):null}</div>
  </section>;
}

/** The non-blocking prompt a missing feature shows: what is missing, what it adds, its repo, Install when safe, and Don't show again. */
export function CompanionPrompt({item,id,onInstall,onSetup}:{item:Companion;id:string|number;onInstall:()=>void;onSetup:(panel:string)=>void}){
  const install=item.actions.includes('install')||item.actions.includes('update')?item.actions.includes('install')?'install':'update':null;
  const heading=item.state==='not-running'?`${item.title} isn’t running`:item.state==='too-old'?`${item.feature} needs a newer ${item.title}`:`${item.feature} needs ${item.title}`;
  return <div className="companion-prompt" data-companion-prompt={item.name} role="status">
    <p className="companion-prompt-title">{heading}</p>
    <p className="companion-prompt-body">{item.enables}{item.state==='missing'&&install?' Install builds the pinned release into this vault’s tooling folder; it takes a few minutes.':''}{item.state==='not-running'&&item.start?.available?' Start asks launchd to run its daemon.':''}</p>
    <div className="companion-prompt-actions">
      {install?<Button size="xs" data-prompt-action="install" onClick={()=>{toast.dismiss(id);onInstall();}}>{install==='install'?'Install':'Update'}</Button>
        :item.state==='not-running'&&item.start?.available?<Button size="xs" data-prompt-action="start" onClick={()=>{toast.dismiss(id);onSetup('confirm');}}>Start…</Button>
        :<Button size="xs" data-prompt-action="setup" onClick={()=>{toast.dismiss(id);onSetup('guide');}}>How to install</Button>}
      <a href={item.repo} target="_blank" rel="noreferrer" className="companion-prompt-link">About {item.title}</a>
      <Button size="xs" variant="ghost" data-prompt-action="dismiss" onClick={()=>{setDismissed(item.name);toast.dismiss(id);}}>Don’t show again</Button>
    </div>
  </div>;
}
