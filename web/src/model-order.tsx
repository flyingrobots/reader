/* Admin › Models: the order Reader tries models for decisions that belong to no voice, such as filing, and how the
   local model starts when it is last in line. Backed by /api/model-chain; see docs/inbox-runner.md. The start command
   runs a program on the vault machine, so only a browser there can see or change it. */
import {useEffect, useState} from 'react';
import {Button} from './components/ui/button';
import {Field, FieldDescription, FieldGroup, FieldLabel} from './components/ui/field';
import {Input} from './components/ui/input';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from './components/ui/select';
import {Spinner} from './components/ui/spinner';
import {Switch} from './components/ui/switch';
import {StatusBadge} from './theme/atoms/status-badge';
import {Notice} from './theme/molecules/notice';
import {LoadingState} from './theme/molecules/states';
import {StatusCard} from './theme/organisms/status-card';

type Api=(path:string,payload?:unknown)=>Promise<any>;
type Provider={name:string;label:string;installed:boolean};
type Config={order:string[];local:{start:string;command?:string[];model:string}};
type View={config:Config;can_edit_command:boolean;providers:Provider[]};
type Draft={order:string[];start:string;command:string;model:string};

const START=[{value:'lmstudio',label:'Start LM Studio with lms'},{value:'command',label:'Run a command'},{value:'off',label:'Don’t start it'}];
const mono='font-mono text-xs';
const draftOf=(view:View):Draft=>({order:view.config.order,start:view.config.local.start,command:(view.config.local.command||[]).join(' '),model:view.config.local.model});

export function ModelOrderCard({api}:{api:Api}){
  const [view,setView]=useState<View|null>(null),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const accept=(next:View)=>{setView(next);setDraft(draftOf(next));setError(null);};
  useEffect(()=>{api('/api/model-chain').then(accept).catch((e:Error)=>setError(e.message));},[]);
  const changed=!!view&&!!draft&&JSON.stringify(draft)!==JSON.stringify(draftOf(view));
  const save=async()=>{if(!draft||!view)return;setBusy(true);
    const local:Record<string,unknown>={start:draft.start,model:draft.model.trim()};
    if(view.can_edit_command)local.command=draft.command.trim().split(/\s+/).filter(Boolean);
    try{accept(await api('/api/model-chain',{order:draft.order,local}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <form id="model-order-form" className="contents" onSubmit={e=>{e.preventDefault();save();}}>
    <StatusCard data-lm="model-order" title="Filing models" description="Filing asks each model in turn and moves on when one can’t answer. Codex is the librarian; any other model is told it is standing in. The first three send excerpts to their vendors."
      footer={<Button type="submit" size="sm" id="model-order-save" disabled={busy||!changed}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}{busy?'Saving…':'Save filing models'}</Button>}>
      {error?<Notice id="model-order-error" tone="error" role="alert">{error}</Notice>:null}
      {!view||!draft?(error?null:<LoadingState>Loading filing models…</LoadingState>):<FieldGroup>
        {view.providers.map((provider,index)=><Field key={provider.name} orientation="horizontal" data-provider={provider.name}>
          <FieldLabel htmlFor={'model-order-'+provider.name}>{index+1}. {provider.name==='local'?'Local model':provider.label}{provider.installed?null:<StatusBadge tone="neutral" className="ml-2">Not installed</StatusBadge>}</FieldLabel>
          <Switch id={'model-order-'+provider.name} checked={draft.order.includes(provider.name)} onCheckedChange={on=>setDraft({...draft,order:view.providers.map(p=>p.name).filter(name=>name===provider.name?on:draft.order.includes(name))})}/>
        </Field>)}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="model-order-start">When the local model isn’t ready</FieldLabel>
            <Select items={START} value={draft.start} onValueChange={value=>{if(value)setDraft({...draft,start:value});}}><SelectTrigger id="model-order-start"><SelectValue/></SelectTrigger>
              <SelectContent><SelectGroup>{START.map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="model-order-model">Local model for filing</FieldLabel>
            <Input id="model-order-model" value={draft.model} spellCheck={false} autoComplete="off" placeholder="First text model listed" onChange={e=>setDraft({...draft,model:e.target.value})}/></Field>
        </div>
        {draft.start==='command'?<Field><FieldLabel htmlFor="model-order-command">Start command</FieldLabel>
          <Input id="model-order-command" className={mono} value={draft.command} disabled={!view.can_edit_command} spellCheck={false} autoComplete="off" placeholder="/absolute/path/to/script argument" onChange={e=>setDraft({...draft,command:e.target.value})}/>
          <FieldDescription>{view.can_edit_command?'An absolute path and its arguments, split on spaces and run without a shell, so aliases won’t work.':'This runs a program on the vault machine, so it can only be changed in a browser there.'}</FieldDescription></Field>:null}
      </FieldGroup>}
    </StatusCard>
  </form>;
}
