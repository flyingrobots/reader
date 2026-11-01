/* Container approvals for article coding jobs. Discovery is read-only; inference and registration
   require separate explicit actions. Changing repository/base invalidates every prior preview. */
import * as React from 'react';
import {FolderGitIcon, RefreshCwIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
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

type Approval={repo:string;revision:string;path:string|null;blob_sha:string|null;sha256:string;configuration:{image:string;[key:string]:unknown};inferred:boolean;assumptions?:string[]};
type Inventory={repo:string;ref:string;base_sha:string;configurations:{path:string;blob_sha:string}[];state:'found'|'missing'};
type Repository={repo:string;legacy?:boolean;base?:string;agents?:string[];agent_modes?:Record<string,string>;
  environment?:Approval&{image_id:string};verify?:{argv:string[]};problems:string[]|null;error?:string};
const AGENTS=[{name:'codex',label:'Codex'},{name:'claude',label:'Claude Code'}];

function RepositoryCard({repo,busy,onRemove}:{repo:Repository;busy:boolean;onRemove:()=>void}){
  const env=repo.environment;
  return <StatusCard data-repository={repo.repo} title={repo.repo}
    badge={<StatusBadge tone={repo.error||repo.legacy?'error':'neutral'}>{repo.legacy?'Reconfigure':repo.error?'Invalid approval':'Configured'}</StatusBadge>}
    footer={<ConfirmAction label="Remove" disabled={busy} confirm="Remove" title={`Stop using ${repo.repo}?`} onConfirm={onRemove}
      description="Future prompts cannot use this registration. The persistent container workspace, branches and run archives are retained."/>}>
    {repo.error?<Notice tone="error" title="Unreadable entry">{repo.error}</Notice>:<FactList layout="rows" facts={[
      {label:'Base',value:repo.base},
      {label:'Configuration',value:env?env.path||'Approved inferred configuration':'Legacy host checkout'},
      {label:'Pinned revision',value:env?.revision},
      {label:'Image',value:env?.configuration.image},
      {label:'Image identity',value:env?.image_id},
      {label:'Agents',value:(repo.agents||[]).map(a=>`${a} (${repo.agent_modes?.[a]})`).join(', ')},
      {label:'Verification',value:<code>{repo.verify?.argv.join(' ')}</code>}]}/>}
    {repo.problems?.length?<Notice title="Environment checks"><ul className="list-disc pl-4">{repo.problems.map(p=><li key={p}>{p}</li>)}</ul></Notice>:null}
    {env?<FieldGroup><Field><FieldLabel htmlFor={'setup-'+repo.repo}>Check tools and sign-in from this Mac</FieldLabel>
      <Textarea id={'setup-'+repo.repo} readOnly rows={2} value={`reader --root "$READER_ROOT" container check ${repo.repo}`}/>
      <FieldDescription>Uses the managed worker and stops it after checking. Configuration approval alone does not establish readiness. See this page’s documentation for installation and sign-in commands.</FieldDescription>
    </Field></FieldGroup>:null}
  </StatusCard>;
}

export function RepositoriesPage({options}:AdminPanelProps){
  const [registry,reload]=useLoad<{configured:boolean;error:string|null;repositories:Repository[]}>(needsReader('jobs')?null:'/api/repositories',options.api);
  const [form,setForm]=React.useState({repo:'',base:'main',agents:['codex'] as string[],argv:'',timeout:'1800',store:'',imageId:''});
  const [inventory,setInventory]=React.useState<Inventory|null>(null),[preview,setPreview]=React.useState<Approval|null>(null);
  const [path,setPath]=React.useState(''),[consent,setConsent]=React.useState(false);
  const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState<{text:string;error:boolean}|null>(null);
  const act=async(payload:Record<string,unknown>,done:string,accept?:(data:any)=>void)=>{
    setBusy(true);setMessage(null);
    try{const data=await options.api('/api/repositories',payload);accept?.(data);forgetArticleActions();setMessage({text:done,error:false});if(!accept)reload();}
    catch(error){setMessage({text:error instanceof Error?error.message:String(error),error:true});}
    finally{setBusy(false);}
  };
  const set=(key:keyof typeof form)=>(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{
    setForm({...form,[key]:event.target.value});
    if(key==='repo'||key==='base'){setInventory(null);setPreview(null);setConsent(false);setPath('');}
  };
  const discover=()=>act({action:'discover-container',repo:form.repo.trim(),base:form.base.trim()},'GitHub configuration inventory loaded.',data=>{
    setInventory(data);setPreview(null);setConsent(false);setPath(data.configurations[0]?.path||'');
  });
  const select=()=>inventory&&act({action:'select-container',repo:inventory.repo,revision:inventory.base_sha,path},'Configuration preview loaded.',data=>{setPreview(data);setForm({...form,imageId:''});});
  const infer=()=>inventory&&consent&&act({action:'infer-container',repo:inventory.repo,revision:inventory.base_sha,consent:true},'Inferred proposal loaded. Review it before registering.',data=>{setPreview(data);setForm({...form,imageId:''});});
  const register=(event:React.FormEvent)=>{
    event.preventDefault();if(!preview||busy)return;
    const verifyTimeout=Number(form.timeout);
    const approved={kind:'devcontainer',revision:preview.revision,path:preview.path,blob_sha:preview.blob_sha,
      sha256:preview.sha256,configuration:preview.configuration,inferred:preview.inferred,consent:preview.inferred&&consent,
      image_id:form.imageId.trim(),lock_store:form.store.trim(),timeout_seconds:Math.max(7200,3600+verifyTimeout+600)};
    act({action:'register',repo:preview.repo,entry:{environment:approved,base:form.base.trim(),agents:form.agents,
      verify:{argv:form.argv.split('\n').filter(a=>a.length>0),timeout_seconds:verifyTimeout}}},`Configured ${preview.repo}. Container tools and sign-in are checked before a job runs.`);
  };
  const repositories=registry.data?.repositories||[];
  if(registry.error||needsReader('jobs'))return <Unavailable what="Repository registration" error={registry.error}/>;
  return <div className="flex flex-col gap-6" data-admin-panel="repositories">
    <Toolbar media={registry.loading?<Spinner aria-hidden/>:null} status="Coding jobs clone and work inside local Docker devcontainers. Start by inspecting the repository on GitHub.">
      <Button size="sm" variant="outline" onClick={reload} disabled={registry.loading}><RefreshCwIcon data-icon="inline-start" aria-hidden/>Refresh registrations</Button>
    </Toolbar>
    {registry.data?.error?<Notice tone="error" role="alert" title="The registry has a problem">{registry.data.error}</Notice>:null}
    {message?<Notice role="status" tone={message.error?'error':'info'} title={message.text} data-repository-message=""/>:null}
    {!registry.data?<LoadingState/>:repositories.length?<CardGrid className="grid-cols-1">{repositories.map(repo=><RepositoryCard key={repo.repo} repo={repo} busy={busy} onRemove={()=>act({action:'remove',repo:repo.repo},`Removed ${repo.repo}.`)}/>)}</CardGrid>
      :<EmptyState icon={FolderGitIcon} title="No repositories are configured" description="Inspect a repository below to choose its container configuration."/>}
    <form onSubmit={register} aria-labelledby="register-repository" data-register-repository="">
      <StatusCard title="Configure a repository" titleId="register-repository" description="Inspect GitHub, review a pinned configuration, then approve the local execution policy."
        footer={<Button type="submit" disabled={busy||!preview||!form.agents.length}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}Approve registration</Button>}>
        <FieldSet disabled={busy} aria-busy={busy}><FieldGroup className="max-w-2xl">
          <Field><FieldLabel htmlFor="repo-name">GitHub repository</FieldLabel><Input id="repo-name" value={form.repo} onChange={set('repo')} placeholder="owner/name" required/></Field>
          <Field><FieldLabel htmlFor="repo-base">Base branch</FieldLabel><Input id="repo-base" value={form.base} onChange={set('base')} required/></Field>
          <Button type="button" variant="outline" className="self-start" onClick={discover} disabled={busy||!form.repo.trim()||!form.base.trim()}>Inspect GitHub configuration</Button>
          {inventory?<>
            <FactList layout="rows" facts={[{label:'Inspected commit',value:inventory.base_sha}]}/>
            {inventory.state==='found'?<Field><FieldLabel htmlFor="repo-config">Repository configuration</FieldLabel>
              <Select value={path} onValueChange={value=>{setPath(String(value));setPreview(null);}} disabled={busy} items={inventory.configurations.map(c=>({label:c.path,value:c.path}))}>
                <SelectTrigger id="repo-config" className="w-full"><SelectValue/></SelectTrigger>
                <SelectContent><SelectGroup>{inventory.configurations.map(c=><SelectItem key={c.path} value={c.path}>{c.path}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Button type="button" variant="outline" className="self-start" onClick={select} disabled={busy||!path}>Review configuration</Button>
            </Field>:<FieldSet><FieldLegend variant="label">No devcontainer configuration found</FieldLegend>
              <FieldDescription>Reader can propose a Node/Python starting configuration from this commit’s manifest names. Compatibility still needs verification.</FieldDescription>
              <Field orientation="horizontal"><Checkbox id="repo-infer" checked={consent} disabled={busy} onCheckedChange={checked=>{setConsent(checked===true);setPreview(null);}}/>
                <FieldLabel htmlFor="repo-infer">Allow inference for this inspected revision</FieldLabel></Field>
              <Button type="button" variant="outline" className="self-start" onClick={infer} disabled={busy||!consent}>Infer configuration</Button>
            </FieldSet>}
          </>:null}
          {preview?<>
            <Field><FieldLabel htmlFor="repo-preview">Configuration to approve</FieldLabel><Textarea id="repo-preview" readOnly rows={8} value={JSON.stringify(preview.configuration,null,2)}/>
              <FieldDescription>Source digest: {preview.sha256}</FieldDescription></Field>
            {preview.assumptions?.length?<Notice title="Proposal assumptions"><ul className="list-disc pl-4">{preview.assumptions.map(item=><li key={item}>{item}</li>)}</ul></Notice>:null}
            <Field><FieldLabel htmlFor="repo-image">Prepared local image identity</FieldLabel><Input id="repo-image" value={form.imageId} onChange={set('imageId')} placeholder="sha256:…" pattern="sha256:[0-9a-f]{64}" required/>
              <FieldDescription>Use the full immutable identity of the compatible managed image for {preview.configuration.image}. Image preparation is documented alongside this page.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="repo-store">Workstation git-locks store</FieldLabel><Input id="repo-store" value={form.store} onChange={set('store')} placeholder="/path/to/workstation.git" required/></Field>
            <FieldSet><FieldLegend variant="label">Container coding agents</FieldLegend><FieldGroup>{AGENTS.map(agent=><Field key={agent.name} orientation="horizontal">
              <Checkbox id={'repo-agent-'+agent.name} checked={form.agents.includes(agent.name)} onCheckedChange={checked=>setForm({...form,agents:checked?[...form.agents,agent.name]:form.agents.filter(a=>a!==agent.name)})}/>
              <FieldLabel htmlFor={'repo-agent-'+agent.name}>{agent.label}</FieldLabel></Field>)}</FieldGroup></FieldSet>
            <Field><FieldLabel htmlFor="repo-verify">Container verification command, one argument per line</FieldLabel><Textarea id="repo-verify" value={form.argv} onChange={set('argv')} rows={3} required/>
              <FieldDescription>Runs inside the job’s container workspace. Each nonempty line is one literal argument.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="repo-timeout">Verification timeout (seconds)</FieldLabel><Input id="repo-timeout" type="number" min={60} max={82200} value={form.timeout} onChange={set('timeout')} required/></Field>
          </>:null}
        </FieldGroup></FieldSet>
      </StatusCard>
    </form>
  </div>;
}
