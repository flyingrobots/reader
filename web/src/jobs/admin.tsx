/* Reader Admin's coding-job, LLM log and repository panels (RW-44). They are page contents for the admin shell's
   routes (#admin/jobs, #admin/jobs/<uuid>, #admin/logs, #admin/logs/<kind>/<date>/<run-id>, #admin/repositories);
   the shell owns layout, headings and focus. Every list reads bounded pages; nothing here starts a job, prunes a
   log or changes a repository except the explicit registration controls, which the server accepts only from this Mac.
   A failed request shows as unavailable, never as an empty healthy list. */
import * as React from 'react';
import {ArrowUpRightIcon, LoaderCircleIcon, RefreshCwIcon} from 'lucide-react';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {CodeBlock, CodeBlockContent} from '../components/ui/code-block';
import {Field, FieldDescription, FieldGroup, FieldLabel} from '../components/ui/field';
import {Input} from '../components/ui/input';
import {Textarea} from '../components/ui/textarea';
import {Checkbox} from '../components/ui/checkbox';
import {JobDetail, OutcomeBadge, type JobViewOptions} from './job-detail';
import {OUTCOME_LABELS, type JobRun} from './store';
import {needsReader, NEEDS_READER} from '../static-demo';

export type AdminPanelProps={options:JobViewOptions;navigate:(route:string)=>void};
type Load<T>={data:T|null;error:string|null;loading:boolean};
function useLoad<T>(path:string|null,api:JobViewOptions['api'],deps:unknown[]=[]):[Load<T>,()=>void]{
  const [state,setState]=React.useState<Load<T>>({data:null,error:null,loading:!!path});
  const [tick,setTick]=React.useState(0);
  React.useEffect(()=>{
    if(!path){setState({data:null,error:null,loading:false});return;}
    let live=true;setState(s=>({...s,loading:true}));
    api(path).then(data=>{if(live)setState({data,error:null,loading:false});},error=>{if(live)setState({data:null,error:error instanceof Error?error.message:String(error),loading:false});});
    return ()=>{live=false;};
  },[path,tick,...deps]);
  return [state,()=>setTick(t=>t+1)];
}
function Unavailable({what,error}:{what:string;error:string|null}){
  return <p className="admin-unavailable" role="alert">{needsReader('jobs')?`${what} ${NEEDS_READER.toLowerCase()}.`:`${what} unavailable: ${error||'no answer'}`}</p>;
}
const when=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'—';

export function JobsPanel({options,navigate}:AdminPanelProps){
  const [repo,setRepo]=React.useState(''),[state,setState]=React.useState(''),[path,setPath]=React.useState(''),[cursor,setCursor]=React.useState(0);
  const query=new URLSearchParams({...(repo?{repo}:{}),...(state?{state}:{}),...(path?{path}:{}),cursor:String(cursor),limit:'25'});
  const [list,reload]=useLoad<{runs:JobRun[];total:number;next:number|null;configured:boolean;read_only:boolean}>(needsReader('jobs')?null:'/api/jobs?'+query,options.api);
  const [all]=useLoad<{runs:JobRun[]}>(needsReader('jobs')?null:'/api/jobs?limit=50',options.api);
  const repos=[...new Set((all.data?.runs||[]).map(r=>r.source.repo))],paths=[...new Set((all.data?.runs||[]).map(r=>r.source.path))];
  if(list.error||needsReader('jobs'))return <Unavailable what="Coding jobs" error={list.error}/>;
  return <div className="admin-jobs" data-admin-panel="jobs">
    <div className="admin-filters" role="group" aria-label="Filter coding jobs">
      <label>Repository <select value={repo} onChange={e=>{setRepo(e.target.value);setCursor(0);}}><option value="">All</option>{repos.map(r=><option key={r}>{r}</option>)}</select></label>
      <label>State <select value={state} onChange={e=>{setState(e.target.value);setCursor(0);}}><option value="">All</option><option value="active">Active</option>
        {Object.entries(OUTCOME_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Article <select value={path} onChange={e=>{setPath(e.target.value);setCursor(0);}}><option value="">All</option>{paths.map(p=><option key={p}>{p}</option>)}</select></label>
      <Button size="sm" variant="outline" onClick={reload}><RefreshCwIcon/>Refresh</Button>
    </div>
    {list.loading&&!list.data?<p className="job-quiet" role="status"><LoaderCircleIcon className="animate-spin" aria-hidden/> Loading coding jobs…</p>:null}
    {list.data&&!list.data.configured?<p className="job-quiet">No repositories are registered, so no article prompt can run yet. Register one under Repositories.</p>:null}
    {list.data?.read_only?<p className="job-quiet">Another Reader server owns coding jobs for this vault; this page is read-only.</p>:null}
    {list.data?<table className="admin-table"><caption className="sr-only">Coding jobs, newest first</caption>
      <thead><tr><th scope="col">Task</th><th scope="col">Repository</th><th scope="col">State</th><th scope="col">Agent</th><th scope="col">Started</th><th scope="col">Result</th></tr></thead>
      <tbody>{list.data.runs.length?list.data.runs.map(run=><tr key={run.id} data-job-row={run.id}>
        <td><a href={'#admin/jobs/'+run.id} onClick={e=>{e.preventDefault();navigate('#admin/jobs/'+run.id);}}>{run.source.title}</a></td>
        <td>{run.source.repo}</td><td><OutcomeBadge run={run}/></td><td>{run.agent_label}</td><td>{when(run.created_at)}</td>
        <td>{run.pr?<a href={run.pr.url} target="_blank" rel="noreferrer noopener">PR #{run.pr.number}<ArrowUpRightIcon aria-hidden className="job-inline-icon"/></a>:run.message?.slice(0,120)}</td>
      </tr>):<tr><td colSpan={6} className="job-quiet">No coding jobs match.</td></tr>}</tbody></table>:null}
    {list.data?<div className="admin-pager"><span>{list.data.total.toLocaleString()} jobs</span>
      <Button size="sm" variant="ghost" disabled={!cursor} onClick={()=>setCursor(Math.max(0,cursor-25))}>Newer</Button>
      <Button size="sm" variant="ghost" disabled={list.data.next===null} onClick={()=>setCursor(list.data!.next!)}>Older</Button></div>:null}
  </div>;
}

export function JobPanel({id,options,navigate}:AdminPanelProps&{id:string}){
  if(needsReader('jobs'))return <Unavailable what="Coding jobs" error={null}/>;
  return <JobDetail id={id} options={options} onArticle={path=>navigate('#read='+encodeURIComponent(path))}/>;
}

type LogRow={path:string;kind:string;run_id:string;status:string|null;outcome?:string|null;started_at:string|null;ended_at:string|null;agent:string|null;title:string|null;bytes:number;artifacts:string[];sealed:boolean};
export function LogsPanel({options,navigate}:AdminPanelProps){
  const [kind,setKind]=React.useState(''),[pages,setPages]=React.useState<(string|null)[]>([null]);
  const cursor=pages.at(-1);
  const query=new URLSearchParams({...(kind?{kind}:{}),...(cursor?{cursor}:{}),limit:'30'});
  const [page,reload]=useLoad<{runs:LogRow[];next:string|null;kinds:string[];retention:string}>(needsReader('logs')?null:'/api/logs?'+query,options.api);
  if(page.error||needsReader('logs'))return <Unavailable what="The LLM log archive" error={page.error}/>;
  return <div className="admin-logs" data-admin-panel="logs">
    <p className="job-quiet">Every LLM run Reader starts is archived under <code>logs/llm/</code> and kept forever. This page reads it in pages; it never prunes.</p>
    <div className="admin-filters" role="group" aria-label="Filter LLM logs">
      <label>Kind <select value={kind} onChange={e=>{setKind(e.target.value);setPages([null]);}}><option value="">All</option>{(page.data?.kinds||[]).map(k=><option key={k}>{k}</option>)}</select></label>
      <Button size="sm" variant="outline" onClick={reload}><RefreshCwIcon/>Refresh</Button>
    </div>
    {page.loading&&!page.data?<p className="job-quiet" role="status">Reading the archive…</p>:null}
    {page.data?<table className="admin-table"><caption className="sr-only">Archived LLM runs, newest first</caption>
      <thead><tr><th scope="col">Run</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Agent</th><th scope="col">Started</th><th scope="col">Size</th></tr></thead>
      <tbody>{page.data.runs.length?page.data.runs.map(row=><tr key={row.path} data-log-row={row.run_id}>
        <td><a href={'#admin/'+row.path.replace(/^logs\/llm\//,'logs/')} onClick={e=>{e.preventDefault();navigate('#admin/'+row.path.replace(/^logs\/llm\//,'logs/'));}}>{row.title||row.run_id}</a></td>
        <td>{row.kind}</td><td><Badge variant={row.sealed?'outline':'secondary'}>{row.outcome||row.status||'unknown'}{row.sealed?'':' · open'}</Badge></td>
        <td>{row.agent||'—'}</td><td>{when(row.started_at)}</td><td>{row.bytes?(row.bytes/1024).toLocaleString(undefined,{maximumFractionDigits:1})+' KiB':'—'}</td></tr>)
        :<tr><td colSpan={6} className="job-quiet">No archived runs{kind?` of kind ${kind}`:''}.</td></tr>}</tbody></table>:null}
    {page.data?<div className="admin-pager">
      <Button size="sm" variant="ghost" disabled={pages.length<2} onClick={()=>setPages(pages.slice(0,-1))}>Newer</Button>
      <Button size="sm" variant="ghost" disabled={!page.data.next} onClick={()=>setPages([...pages,page.data!.next])}>Older</Button></div>:null}
  </div>;
}

export function LogPanel({path,options}:AdminPanelProps&{path:string}){
  const relative='logs/llm/'+path.replace(/^logs\//,'');
  const [detail]=useLoad<{run:LogRow;meta:Record<string,unknown>;artifacts:string[]}>(needsReader('logs')?null:'/api/logs/run?path='+encodeURIComponent(relative),options.api);
  const [name,setName]=React.useState<string|null>(null);
  const chosen=name||detail.data?.artifacts.find(a=>a.startsWith('prompt'))||detail.data?.artifacts[0]||null;
  const [artifact]=useLoad<{text:string|null;bytes:number|null;truncated:boolean;limit:number;available:boolean}>(chosen?`/api/logs/artifact?path=${encodeURIComponent(relative)}&name=${encodeURIComponent(chosen)}`:null,options.api,[relative]);
  if(detail.error||needsReader('logs'))return <Unavailable what="This LLM run" error={detail.error}/>;
  if(!detail.data)return <p className="job-quiet" role="status">Reading the run…</p>;
  return <article className="admin-log" data-admin-panel="log">
    <p className="job-quiet">{detail.data.run.kind} · {detail.data.run.status} · {relative}{detail.data.run.sealed?'':' · still open (.partial artifacts)'}</p>
    <details><summary>Run metadata</summary><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-96">{JSON.stringify(detail.data.meta,null,2)}</CodeBlockContent></CodeBlock></details>
    <div className="job-artifact-tabs" role="tablist" aria-label="Artifacts">{detail.data.artifacts.map(a=><Button key={a} size="xs" role="tab" aria-selected={a===chosen} variant={a===chosen?'secondary':'ghost'} onClick={()=>setName(a)}>{a}</Button>)}</div>
    {artifact.data?<div className="job-artifact"><p className="job-quiet">{artifact.data.truncated?`A preview of the first ${(artifact.data.limit/1024).toLocaleString()} KiB; the archive keeps the complete artifact.`:'Complete.'}</p>
      <Button size="xs" variant="outline" onClick={()=>navigator.clipboard?.writeText(artifact.data!.text||'')}>Copy{artifact.data.truncated?' preview':''}</Button>
      <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-[32rem]">{artifact.data.text??'Missing from the archive.'}</CodeBlockContent></CodeBlock></div>
      :artifact.error?<Unavailable what={chosen||'Artifact'} error={artifact.error}/>:null}
  </article>;
}

type Repository={repo:string;checkout?:string;remote?:string;base?:string;worktree_root?:string;agents?:string[];agent_modes?:Record<string,string>;
  verify?:{argv:string[];timeout_seconds:number;lock:{keys:string[]}|null};problems:string[]|null;error?:string};
export function RepositoriesPanel({options}:AdminPanelProps){
  const [registry,reload]=useLoad<{configured:boolean;error:string|null;repositories:Repository[]}>(needsReader('jobs')?null:'/api/repositories?check=1',options.api);
  const [form,setForm]=React.useState({repo:'',checkout:'',remote:'origin',base:'main',worktree_root:'',agents:['codex'] as string[],argv:'',timeout:'1800',store:'',keys:'host/heavy-work'});
  const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState<string|null>(null);
  if(registry.error||needsReader('jobs'))return <Unavailable what="Repository registration" error={registry.error}/>;
  const act=async(payload:Record<string,unknown>,done:string)=>{setBusy(true);setMessage(null);try{await options.api('/api/repositories',payload);setMessage(done);reload();}catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const register=(event:React.FormEvent)=>{event.preventDefault();
    const entry:Record<string,unknown>={checkout:form.checkout.trim(),remote:form.remote.trim(),base:form.base.trim(),worktree_root:form.worktree_root.trim(),agents:form.agents,
      verify:{argv:form.argv.split('\n').map(a=>a.trim()).filter(Boolean),timeout_seconds:Number(form.timeout),
        ...(form.store.trim()?{lock:{store:form.store.trim(),keys:form.keys.split(/[\s,]+/).filter(Boolean)}}:{})}};
    act({action:'register',repo:form.repo.trim(),entry},`Registered ${form.repo.trim()}.`);};
  const set=(key:keyof typeof form)=>(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setForm({...form,[key]:event.target.value});
  return <div className="admin-repositories" data-admin-panel="repositories">
    <p className="job-quiet">Articles name only a GitHub repository. Here Reader learns where its checkout is, which remote and base branch to use, where job worktrees go,
      which coding agents may run and which guarded command must pass before a pull request is opened. No credentials are stored; GitHub access comes from <code>gh</code>.</p>
    {registry.data?.error?<p className="admin-unavailable" role="alert">{registry.data.error}</p>:null}
    <Button size="sm" variant="outline" onClick={reload} disabled={registry.loading}><RefreshCwIcon/>Check again</Button>
    <ul className="admin-repo-list">{(registry.data?.repositories||[]).map(repo=><li key={repo.repo} data-repository={repo.repo}>
      <h3 className="job-section">{repo.repo} {repo.problems?.length?<Badge variant="destructive">Needs attention</Badge>:repo.problems?<Badge variant="secondary">Ready</Badge>:null}</h3>
      {repo.error?<p className="admin-unavailable">{repo.error}</p>:<dl className="job-facts">
        <div><dt>Checkout</dt><dd>{repo.checkout}</dd></div><div><dt>Remote / base</dt><dd>{repo.remote} / {repo.base}</dd></div>
        <div><dt>Worktrees</dt><dd>{repo.worktree_root}</dd></div><div><dt>Agents</dt><dd>{(repo.agents||[]).map(a=>`${a} (${repo.agent_modes?.[a]})`).join(', ')}</dd></div>
        <div><dt>Verification</dt><dd><code>{repo.verify?.argv.join(' ')}</code>{repo.verify?.lock?` under git-locks ${repo.verify.lock.keys.join(', ')}`:' (no lock)'}</dd></div></dl>}
      {repo.problems?.length?<ul className="admin-problems">{repo.problems.map(p=><li key={p}>{p}</li>)}</ul>:null}
      <Button size="xs" variant="ghost" disabled={busy} onClick={()=>{if(confirm(`Stop using ${repo.repo} for coding jobs? Its checkout, worktrees and branches are not touched.`))act({action:'remove',repo:repo.repo},`Removed ${repo.repo}.`);}}>Remove</Button>
    </li>)}</ul>
    {registry.data&&!registry.data.repositories.length?<p className="job-quiet">No repositories are registered yet.</p>:null}
    <form className="admin-register" onSubmit={register} aria-labelledby="register-repository">
      <h3 id="register-repository" className="job-section">Register a repository</h3>
      <FieldGroup>
        <Field><FieldLabel htmlFor="repo-name">GitHub repository</FieldLabel><Input id="repo-name" value={form.repo} onChange={set('repo')} placeholder="owner/name" required/></Field>
        <Field><FieldLabel htmlFor="repo-checkout">Checkout folder</FieldLabel><Input id="repo-checkout" value={form.checkout} onChange={set('checkout')} placeholder="/path/to/checkout" required/>
          <FieldDescription>Its remote must be github.com/owner/name. Existing uncommitted work there is never touched.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="repo-remote">Remote</FieldLabel><Input id="repo-remote" value={form.remote} onChange={set('remote')} required/></Field>
        <Field><FieldLabel htmlFor="repo-base">Base branch</FieldLabel><Input id="repo-base" value={form.base} onChange={set('base')} required/></Field>
        <Field><FieldLabel htmlFor="repo-worktrees">Worktree folder</FieldLabel><Input id="repo-worktrees" value={form.worktree_root} onChange={set('worktree_root')} placeholder="/path/outside/the/checkout" required/></Field>
        <Field><FieldLabel>Coding agents</FieldLabel><div className="admin-checks">{['codex','claude'].map(name=><label key={name}><Checkbox checked={form.agents.includes(name)}
          onCheckedChange={checked=>setForm({...form,agents:checked?[...form.agents,name]:form.agents.filter(a=>a!==name)})}/> {name==='codex'?'Codex':'Claude Code'}</label>)}</div></Field>
        <Field><FieldLabel htmlFor="repo-verify">Verification command, one argument per line</FieldLabel><Textarea id="repo-verify" value={form.argv} onChange={set('argv')} rows={3} placeholder={'python3\nscripts/check_container.py\npython'} required/>
          <FieldDescription>Run without a shell in the job’s worktree. Use the project’s guarded runner when it has one.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="repo-timeout">Verification timeout (seconds)</FieldLabel><Input id="repo-timeout" inputMode="numeric" value={form.timeout} onChange={set('timeout')}/></Field>
        <Field><FieldLabel htmlFor="repo-store">git-locks store for verification (optional)</FieldLabel><Input id="repo-store" value={form.store} onChange={set('store')} placeholder="/path/to/git-locks-store.git"/></Field>
        <Field><FieldLabel htmlFor="repo-keys">Lock keys</FieldLabel><Input id="repo-keys" value={form.keys} onChange={set('keys')}/></Field>
      </FieldGroup>
      <Button type="submit" disabled={busy}>{busy?<LoaderCircleIcon className="animate-spin"/>:null}Register</Button>
      <p role="status" aria-live="polite" className="job-quiet">{message}</p>
    </form>
  </div>;
}
