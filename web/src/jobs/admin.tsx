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
import {type JobViewOptions} from './job-detail';
import {Notice} from '../theme/molecules/notice';
import {forgetArticleActions} from './store';
import {needsReader, NEEDS_READER} from '../static-demo';

/** `go`/`href` are the admin shell's section navigation; `open` opens a library document. */
export type AdminPanelProps={options:JobViewOptions;go:(section?:string,...params:string[])=>void;href:(section?:string,...params:string[])=>string;open:(path:string)=>void};
/** A log run's route parameters: `logs/llm/<kind>/YYYY/MM/DD/<run-id>` ⇄ [kind, YYYY-MM-DD, run-id]. */
export function logParams(path:string){const [kind,y,m,d,run]=path.replace(/^logs\/llm\//,'').split('/');return [kind,`${y}-${m}-${d}`,run];}
export function logPath(params:string[]){const [kind,date,run]=params;return `logs/llm/${kind}/${date.replace(/-/g,'/')}/${run}`;}
type Load<T>={data:T|null;error:string|null;loading:boolean};
export function useLoad<T>(path:string|null,api:JobViewOptions['api'],deps:unknown[]=[]):[Load<T>,()=>void]{
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
/** A failed read as a destructive Alert (role alert); in the static demo, the honest "needs Reader" message instead. */
export function Unavailable({what,error}:{what:string;error:string|null}){
  return needsReader('jobs')?<Notice role="alert" title={`${what} ${NEEDS_READER.toLowerCase()}.`}/>:<Notice tone="error" role="alert" data-unavailable="" title={`${what} unavailable`}>{error||'No answer.'}</Notice>;
}
/** A full local date and time, or an em dash for none. */
export const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'—';
const when=dateTime;

type Repository={repo:string;checkout?:string;remote?:string;base?:string;worktree_root?:string;agents?:string[];agent_modes?:Record<string,string>;
  verify?:{argv:string[];timeout_seconds:number;lock:{keys:string[]}|null};problems:string[]|null;error?:string};
export function RepositoriesPanel({options}:AdminPanelProps){
  const [registry,reload]=useLoad<{configured:boolean;error:string|null;repositories:Repository[]}>(needsReader('jobs')?null:'/api/repositories?check=1',options.api);
  const [form,setForm]=React.useState({repo:'',checkout:'',remote:'origin',base:'main',worktree_root:'',agents:['codex'] as string[],argv:'',timeout:'1800',store:'',keys:''});
  const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState<string|null>(null);
  if(registry.error||needsReader('jobs'))return <Unavailable what="Repository registration" error={registry.error}/>;
  const act=async(payload:Record<string,unknown>,done:string)=>{setBusy(true);setMessage(null);try{await options.api('/api/repositories',payload);forgetArticleActions();setMessage(done);reload();}catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
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
        <Field><FieldLabel htmlFor="repo-keys">Lock keys</FieldLabel><Input id="repo-keys" value={form.keys} onChange={set('keys')} placeholder="host/docker/<project-worker>/"/></Field>
      </FieldGroup>
      <Button type="submit" disabled={busy}>{busy?<LoaderCircleIcon className="animate-spin"/>:null}Register</Button>
      <p role="status" aria-live="polite" className="job-quiet">{message}</p>
    </form>
  </div>;
}
