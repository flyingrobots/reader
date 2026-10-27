/* An article's repair prompt as a card (RW-44): title, repository, issue, the prompt in an editor, Copy, the coding
   agent, Run → PR, the current run and earlier runs. Built as the shadcn AI Elements Prompt Input (a form around an
   Input Group with its textarea and a block-end addon holding the agent menu and the submit button), with the
   shared job summary below it. The prompt is a form: typing stays in the editor, Escape leaves it, and reader
   motions never take its keys. Editing makes a run-local revision; the article is never rewritten.

   Nothing launches on view: rendering, hovering, expanding or restoring the page only reads. A run starts when the
   reader presses Run → PR, with a request UUID that is kept while that request is unanswered, so a retried click is
   the same request, never a second run. Static demos, historical editions and inbox previews stay readable and
   copyable but cannot run. */
import * as React from 'react';
import {ArrowUpRightIcon, ChevronDownIcon, CopyIcon, GitPullRequestArrowIcon, LoaderCircleIcon, RotateCcwIcon, WrenchIcon} from 'lucide-react';
import {DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger} from '../components/ui/dropdown-menu';
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea} from '../components/ui/input-group';
import {Button} from '../components/ui/button';
import {articleActions, statusLabel, submitJob, type ArticleActions, type BlockInfo} from './store';
import {JobSummary, type JobViewOptions} from './job-detail';

export type PromptBlock={id:string;title:string;repo:string;issue:number|null;prompt:string;line:number};
/** Why this card cannot run here (static demo, past edition, inbox preview), or null. */
export type PromptContext={path:string;sha256:string;blocked:string|null;options:JobViewOptions;onAdmin?:(route:string)=>void};
const MAX=32*1024;
const bytes=(text:string)=>new TextEncoder().encode(text).length;
const uuid=()=>globalThis.crypto.randomUUID();

export function PromptCard({block,context}:{block:PromptBlock;context:PromptContext}){
  const [text,setText]=React.useState(block.prompt);
  const [server,setServer]=React.useState<ArticleActions|null>(null),[loadError,setLoadError]=React.useState<string|null>(null);
  const [agent,setAgent]=React.useState<string|null>(null);
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState<string|null>(null),[copied,setCopied]=React.useState(false);
  const [current,setCurrent]=React.useState<string|null>(null);
  const request=React.useRef<{id:string;key:string}|null>(null);
  const area=React.useRef<HTMLTextAreaElement>(null),card=React.useRef<HTMLElement>(null);
  const titleId=React.useId(),planId=React.useId();
  React.useEffect(()=>{
    if(context.blocked)return;
    let live=true;
    articleActions(context.path,context.sha256).then(result=>{if(!live)return;setServer(result);},cause=>{if(live)setLoadError(cause instanceof Error?cause.message:String(cause));});
    return ()=>{live=false;};
  },[context.path,context.sha256,context.blocked]);
  const info:BlockInfo|undefined=server?.blocks.find(b=>b.id===block.id);
  const agents=(info?.agents||[]).filter(a=>a.available);
  React.useEffect(()=>{if(!agent&&agents.length)setAgent(agents[0].name);},[agents.length]);
  React.useEffect(()=>{if(!current&&info?.runs.length)setCurrent(info.runs[0].id);},[info?.runs.length]);
  const edited=text!==block.prompt,tooLong=bytes(text)>MAX,blank=!text.trim();
  const issueUrl=block.issue?`https://github.com/${block.repo}/issues/${block.issue}`:null;
  const reason=context.blocked||(loadError?`Reader couldn’t read this article’s prompts: ${loadError}`:null)
    ||(server&&!server.configured?'No repositories are set up for coding jobs in this Reader.':null)
    ||(server?.read_only?'Another Reader server owns coding jobs for this vault.':null)
    ||(server&&!info?'Reader’s copy of this article has no matching prompt. Reload the article.':null)
    ||(info&&!info.registered?`${block.repo} isn’t set up in Reader yet.`:null)
    ||(info&&info.registered&&!agents.length?'None of this repository’s coding agents is installed where Reader can find it.':null);
  const latest=info?.runs[0];
  const canRun=!reason&&!!server&&!!agent&&!busy&&!tooLong&&!blank&&!(latest?.active&&latest.id===current);
  const chosen=agents.find(a=>a.name===agent);

  async function run(event:React.FormEvent){
    event.preventDefault();
    if(!canRun||!agent)return;
    const key=JSON.stringify([text,agent,latest?.id||null]);
    // The same request UUID while this exact request is unanswered: a second click after an error is the same request.
    if(!request.current||request.current.key!==key)request.current={id:uuid(),key};
    setBusy(true);setError(null);
    try{
      const admitted=await submitJob({request_id:request.current.id,path:context.path,sha256:context.sha256,block_id:block.id,prompt:text,agent,
        predecessor:latest&&!latest.active?latest.id:null});
      request.current=null;setCurrent(admitted.id);
      setServer(await articleActions(context.path,context.sha256,true));
      context.options.notify?.(admitted.duplicate?'That run was already admitted.':'Coding job started. You can keep reading.');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{setError('Copying needs clipboard access; select the prompt and copy it.');}
  }
  const plan=reason?null:<>Run → PR works on a new branch from <code>{info?.base||'the base branch'}</code> in <strong>{block.repo}</strong>, {block.issue?<>links issue #{block.issue}</>:<>creates an issue if the finding is confirmed</>},
    and opens a pull request only after Reader verifies the change. Nothing is merged.</>;
  return <section ref={card} className="prompt-card" aria-labelledby={titleId} tabIndex={-1} data-prompt-card={block.id} data-reader-decoration="">
    <header className="prompt-card-head">
      <span className="prompt-card-eyebrow"><WrenchIcon aria-hidden/>Repair prompt</span>
      <h3 id={titleId} className="prompt-card-title">{block.title}</h3>
      <p className="prompt-card-target">
        <a href={`https://github.com/${block.repo}`} target="_blank" rel="noreferrer noopener">{block.repo}<span className="sr-only"> on GitHub (opens a new tab)</span></a>
        {' · '}{issueUrl?<a href={issueUrl} target="_blank" rel="noreferrer noopener">Issue #{block.issue}<ArrowUpRightIcon aria-hidden/></a>:<span>Create issue</span>}
      </p>
    </header>
    <form onSubmit={run} aria-describedby={plan?planId:undefined} onKeyDown={event=>{
      if(event.key==='Escape'&&(event.target as HTMLElement).matches('textarea')){event.preventDefault();event.stopPropagation();card.current?.focus({preventScroll:true});}}}>
      <InputGroup>
        <InputGroupTextarea ref={area} aria-label={`Prompt: ${block.title}`} value={text} rows={Math.min(14,Math.max(4,text.split('\n').length))} disabled={busy}
          onChange={event=>setText(event.target.value)} spellCheck={false} className="prompt-card-editor p-3" aria-invalid={tooLong||blank||undefined}/>
        {/* Wraps at phone width instead of squeezing the label one letter per line. */}
        <InputGroupAddon align="block-end" className="flex-wrap gap-y-1">
          <InputGroupText className={tooLong?'whitespace-nowrap text-destructive':'whitespace-nowrap'}>{edited?'Edited for this run':'As written'}{tooLong?' · over 32 KiB':''}</InputGroupText>
          {edited?<InputGroupButton size="sm" variant="ghost" onClick={()=>setText(block.prompt)} aria-label="Restore the article’s prompt"><RotateCcwIcon/>Reset</InputGroupButton>:null}
          <InputGroupButton size="sm" variant="ghost" className="ml-auto" onClick={copy} data-prompt-copy=""><CopyIcon/>{copied?'Copied':'Copy'}</InputGroupButton>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={busy||!agents.length} render={<InputGroupButton size="sm" variant="outline" aria-label={`Coding agent: ${chosen?.label??'none available'}`}/>}>
              {chosen?chosen.label:'No agent'}<ChevronDownIcon/>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Coding agent</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent??''} onValueChange={value=>setAgent(String(value))}>
                  {agents.map(item=><DropdownMenuRadioItem key={item.name} value={item.name} closeOnClick>{item.label} · {item.mode}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <InputGroupButton type="submit" size="sm" variant="default" disabled={!canRun} title={reason||undefined} data-prompt-run="" data-needs-reader={context.blocked?'':undefined}>
            {busy?<LoaderCircleIcon className="animate-spin"/>:<GitPullRequestArrowIcon/>}Run → PR
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
    <p className="prompt-card-plan" id={planId} role="status" aria-live="polite">
      {error?<span className="prompt-card-error">{error}</span>:reason?<>{reason}{info&&!info.registered&&context.onAdmin?<> <Button size="xs" variant="link" onClick={()=>context.onAdmin!('#admin/repositories')}>Set up repository</Button></>:null}</>:plan}
    </p>
    {current?<JobSummary id={current} options={context.options} onAdmin={context.onAdmin?id=>context.onAdmin!('#admin/jobs/'+id):undefined}/>:null}
    {info&&info.runs.length>1||info?.runs.length===1&&info.runs[0].id!==current?<details className="prompt-card-history">
      <summary>Earlier runs ({info!.runs.length})</summary>
      <ul>{info!.runs.map(r=><li key={r.id}>
        <Button size="xs" variant={r.id===current?'secondary':'ghost'} onClick={()=>setCurrent(r.id)} aria-pressed={r.id===current}>{statusLabel(r)} · {new Date(r.created_at).toLocaleString()}</Button>
        {r.pr?<a href={r.pr.url} target="_blank" rel="noreferrer noopener">PR #{r.pr.number}</a>:null}
      </li>)}</ul>
    </details>:null}
  </section>;
}
