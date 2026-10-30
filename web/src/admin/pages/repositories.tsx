/* Admin › Repositories (#admin/repositories): which local checkouts article prompts may run in. Design sheet:
   docs/admin-design/repositories.md. Registration and removal are the only writes, and the server accepts them only
   from this Mac; removing an entry never touches the checkout, its worktrees or branches. */
import * as React from 'react';
import {FolderGitIcon, RefreshCwIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Spinner} from '@/components/ui/spinner';
import {Textarea} from '@/components/ui/textarea';
import {StatusBadge} from '@/theme/atoms/status-badge';
import {FactList} from '@/theme/molecules/fact-list';
import {Notice} from '@/theme/molecules/notice';
import {EmptyState, LoadingState} from '@/theme/molecules/states';
import {Toolbar} from '@/theme/molecules/toolbar';
import {ConfirmAction} from '@/theme/organisms/confirm-action';
import {StatusCard} from '@/theme/organisms/status-card';
import {CardGrid} from '@/theme/templates/card-grid';
import {Unavailable, useLoad, type AdminPanelProps} from '../../jobs/admin';
import {forgetArticleActions} from '../../jobs/store';
import {needsReader} from '../../static-demo';

type Repository={repo:string;checkout?:string;remote?:string;base?:string;worktree_root?:string;agents?:string[];agent_modes?:Record<string,string>;
  verify?:{argv:string[];timeout_seconds:number;lock:{keys:string[]}|null};problems:string[]|null;error?:string};
const AGENTS=[{name:'codex',label:'Codex'},{name:'claude',label:'Claude Code'}];

function RepositoryCard({repo,busy,onRemove}:{repo:Repository;busy:boolean;onRemove:()=>void}){
  return <StatusCard data-repository={repo.repo} title={repo.repo}
    badge={repo.problems?.length?<StatusBadge tone="error">Needs attention</StatusBadge>:repo.problems?<StatusBadge tone="ok">Ready</StatusBadge>:null}
    footer={<ConfirmAction label="Remove" disabled={busy} confirm="Remove" title={`Stop using ${repo.repo}?`} onConfirm={onRemove}
      description="Article prompts will no longer run in it. Its checkout, worktrees and branches are not touched."/>}>
    {repo.error?<Notice tone="error" title="Unreadable entry">{repo.error}</Notice>:<FactList layout="rows" facts={[
      {label:'Checkout',value:repo.checkout},{label:'Remote / base',value:`${repo.remote} / ${repo.base}`},{label:'Worktrees',value:repo.worktree_root},
      {label:'Agents',value:(repo.agents||[]).map(a=>`${a} (${repo.agent_modes?.[a]})`).join(', ')},
      {label:'Verification',value:<><code className="font-mono text-xs">{repo.verify?.argv.join(' ')}</code>{repo.verify?.lock?` under git-locks ${repo.verify.lock.keys.join(', ')}`:' (no lock)'}</>}]}/>}
    {repo.problems?.length?<Notice tone="error" title="Problems"><ul className="list-disc pl-4">{repo.problems.map(p=><li key={p}>{p}</li>)}</ul></Notice>:null}
  </StatusCard>;
}

export function RepositoriesPage({options}:AdminPanelProps){
  const [registry,reload]=useLoad<{configured:boolean;error:string|null;repositories:Repository[]}>(needsReader('jobs')?null:'/api/repositories?check=1',options.api);
  const [form,setForm]=React.useState({repo:'',checkout:'',remote:'origin',base:'main',worktree_root:'',agents:['codex'] as string[],argv:'',timeout:'1800',store:'',keys:''});
  const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState<{text:string;error:boolean}|null>(null);
  if(registry.error||needsReader('jobs'))return <Unavailable what="Repository registration" error={registry.error}/>;
  const act=async(payload:Record<string,unknown>,done:string)=>{setBusy(true);setMessage(null);try{await options.api('/api/repositories',payload);forgetArticleActions();setMessage({text:done,error:false});reload();}catch(error){setMessage({text:error instanceof Error?error.message:String(error),error:true});}finally{setBusy(false);}};
  const register=(event:React.FormEvent)=>{event.preventDefault();
    const entry:Record<string,unknown>={checkout:form.checkout.trim(),remote:form.remote.trim(),base:form.base.trim(),worktree_root:form.worktree_root.trim(),agents:form.agents,
      verify:{argv:form.argv.split('\n').map(a=>a.trim()).filter(Boolean),timeout_seconds:Number(form.timeout),
        ...(form.store.trim()?{lock:{store:form.store.trim(),keys:form.keys.split(/[\s,]+/).filter(Boolean)}}:{})}};
    act({action:'register',repo:form.repo.trim(),entry},`Registered ${form.repo.trim()}.`);};
  const set=(key:keyof typeof form)=>(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setForm({...form,[key]:event.target.value});
  const repositories=registry.data?.repositories||[];
  return <div className="flex flex-col gap-6" data-admin-panel="repositories">
    <Toolbar media={registry.loading?<Spinner aria-hidden/>:null} status={<>Articles name only a GitHub repository. Here Reader learns where its checkout is and what must pass before a pull request opens. No credentials are stored; GitHub access comes from <code className="font-mono text-xs">gh</code>.</>}>
      <Button size="sm" variant="outline" onClick={reload} disabled={registry.loading}><RefreshCwIcon data-icon="inline-start" aria-hidden/>Check again</Button>
    </Toolbar>
    {registry.data?.error?<Notice tone="error" role="alert" title="The registry has a problem">{registry.data.error}</Notice>:null}
    {message?<Notice role="status" tone={message.error?'error':'info'} title={message.text} data-repository-message=""/>:null}
    {!registry.data?<LoadingState/>:repositories.length?<CardGrid className="grid-cols-1">{repositories.map(repo=><RepositoryCard key={repo.repo} repo={repo} busy={busy} onRemove={()=>act({action:'remove',repo:repo.repo},`Removed ${repo.repo}.`)}/>)}</CardGrid>
      :<EmptyState icon={FolderGitIcon} title="No repositories are registered yet" description="Register one below so article prompts can run in it."/>}
    <form onSubmit={register} aria-labelledby="register-repository" data-register-repository="">
      <StatusCard title="Register a repository" titleId="register-repository" description="Each field is checked by the server before anything is saved."
        footer={<Button type="submit" disabled={busy}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}Register</Button>}>
        <FieldGroup className="max-w-2xl">
          <Field><FieldLabel htmlFor="repo-name">GitHub repository</FieldLabel><Input id="repo-name" value={form.repo} onChange={set('repo')} placeholder="owner/name" required/></Field>
          <Field><FieldLabel htmlFor="repo-checkout">Checkout folder</FieldLabel><Input id="repo-checkout" value={form.checkout} onChange={set('checkout')} placeholder="/path/to/checkout" required/>
            <FieldDescription>Its remote must be github.com/owner/name. Existing uncommitted work there is never touched.</FieldDescription></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="repo-remote">Remote</FieldLabel><Input id="repo-remote" value={form.remote} onChange={set('remote')} required/></Field>
            <Field><FieldLabel htmlFor="repo-base">Base branch</FieldLabel><Input id="repo-base" value={form.base} onChange={set('base')} required/></Field>
          </div>
          <Field><FieldLabel htmlFor="repo-worktrees">Worktree folder</FieldLabel><Input id="repo-worktrees" value={form.worktree_root} onChange={set('worktree_root')} placeholder="/path/outside/the/checkout" required/></Field>
          <FieldSet>
            <FieldLegend variant="label">Coding agents</FieldLegend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">{AGENTS.map(agent=><Field key={agent.name} orientation="horizontal" className="w-auto">
              <Checkbox id={'repo-agent-'+agent.name} checked={form.agents.includes(agent.name)} onCheckedChange={checked=>setForm({...form,agents:checked?[...form.agents,agent.name]:form.agents.filter(a=>a!==agent.name)})}/>
              <FieldLabel htmlFor={'repo-agent-'+agent.name} className="font-normal">{agent.label}</FieldLabel></Field>)}</div>
          </FieldSet>
          <Field><FieldLabel htmlFor="repo-verify">Verification command, one argument per line</FieldLabel><Textarea id="repo-verify" className="font-mono" value={form.argv} onChange={set('argv')} rows={3} placeholder={'python3\nscripts/check_container.py\npython'} required/>
            <FieldDescription>Run without a shell in the job’s worktree. Use the project’s guarded runner when it has one.</FieldDescription></Field>
          <Field className="sm:max-w-48"><FieldLabel htmlFor="repo-timeout">Verification timeout (seconds)</FieldLabel><Input id="repo-timeout" inputMode="numeric" value={form.timeout} onChange={set('timeout')}/></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="repo-store">git-locks store (optional)</FieldLabel><Input id="repo-store" value={form.store} onChange={set('store')} placeholder="/path/to/git-locks-store.git"/></Field>
            <Field><FieldLabel htmlFor="repo-keys">Lock keys</FieldLabel><Input id="repo-keys" value={form.keys} onChange={set('keys')} placeholder="host/docker/<project-worker>/"/></Field>
          </div>
        </FieldGroup>
      </StatusCard>
    </form>
  </div>;
}
