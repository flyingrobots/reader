/* Admin › Publish: documents encrypted on this machine. Only a browser here sees this: through a tailnet the API answers
   404, so the card and the upload level don't appear. Passphrases go to the server once, and the key stays in its memory
   behind an HttpOnly cookie. Text is shown here and never cached or saved by this page. */
import {useCallback, useEffect, useState} from 'react';
import {LockIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle} from '@/components/ui/item';
import {Spinner} from '@/components/ui/spinner';
import {StatusBadge} from '@/theme/atoms/status-badge';
import {RelativeTime} from '@/theme/atoms/time';
import {Notice} from '@/theme/molecules/notice';
import {StatusCard} from '@/theme/organisms/status-card';
import {ConfirmAction} from '@/theme/organisms/confirm-action';
import {plural} from '../../plural';

type Api=(path:string,payload?:unknown,extra?:Record<string,unknown>)=>Promise<any>;
type StoredFile={path:string;bytes:number};
type Stored={id:string;title:string;author?:string|null;received_at?:string;files:StoredFile[];text?:string|null};
export type PrivateStatus={installed:boolean;initialized:boolean;unlocked:boolean;items:Stored[]};
const MIN_PASSPHRASE=12;

export function usePrivateStatus(api:Api){
  const [status,setStatus]=useState<PrivateStatus|null>(null),[available,setAvailable]=useState(false);
  const refresh=useCallback(async()=>{try{setStatus(await api('/api/private'));setAvailable(true);}catch{setStatus(null);setAvailable(false);}},[api]);
  useEffect(()=>{refresh();},[refresh]);
  return {status,available,refresh};
}

export function PrivateShelf({api,html,privacy}:{api:Api;html:(text:string)=>string;privacy:ReturnType<typeof usePrivateStatus>}){
  const {status,available,refresh}=privacy;
  const [passphrase,setPassphrase]=useState(''),[again,setAgain]=useState(''),[understood,setUnderstood]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[open,setOpen]=useState<Stored|null>(null);
  const act=async(payload:Record<string,unknown>)=>{setBusy(true);setError(null);
    try{await api('/api/private',payload);setPassphrase('');setAgain('');setUnderstood(false);await refresh();return true;}
    catch(cause){setError((cause as Error).message);return false;}finally{setBusy(false);}};
  const [waiting,setWaiting]=useState<{id:string;title:string}[]>([]);
  useEffect(()=>{if(!status?.unlocked){setWaiting([]);return;}api('/api/inbox').then(inbox=>setWaiting((inbox.arrivals||[]).filter((arrival:{bundle?:boolean;integrity?:string})=>arrival.bundle&&arrival.integrity==='intact'))).catch(()=>setWaiting([]));},[api,status]);
  const view=async(id:string)=>{setError(null);try{setOpen(await api('/api/private/item?id='+encodeURIComponent(id)));}catch(cause){setError((cause as Error).message);await refresh();}};
  if(!available||!status)return null;
  const badge=status.unlocked?<StatusBadge tone="active" data-private-state="unlocked">Unlocked</StatusBadge>:status.initialized?<StatusBadge tone="neutral" data-private-state="locked">Locked</StatusBadge>:<StatusBadge tone="neutral" data-private-state="unset">Not set up</StatusBadge>;
  const mismatch=!!again&&again!==passphrase;
  return <StatusCard data-private="" title="On this machine only" description="Encrypted copies that never join your vault or leave this Mac. No model, voice or search can find them through Reader." badge={badge}
    footer={status.unlocked?<Button id="private-lock" variant="outline" size="sm" disabled={busy} onClick={()=>{setOpen(null);act({action:'lock'});}}><LockIcon data-icon="inline-start" aria-hidden/>Lock</Button>:undefined}>
    {error?<Notice id="private-error" tone="error" role="alert">{error}</Notice>:null}
    {!status.installed?<div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">This needs a small pinned tool, which Reader installs into <code className="font-mono text-xs">~/.reader</code>. It needs Node.js.</p>
      <div><Button id="private-install" size="sm" disabled={busy} onClick={()=>act({action:'install'})}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}{busy?'Installing…':'Install encrypted storage'}</Button></div>
    </div>:!status.initialized?<form className="contents" onSubmit={event=>{event.preventDefault();act({action:'setup',passphrase});}}><FieldGroup>
      <Notice id="private-warning" tone="error" role="note" title="There is no way to recover a lost passphrase.">If you forget it, these files are gone, and they’re the only copies Reader has. Nothing here is backed up.</Notice>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="private-new">New passphrase</FieldLabel><Input id="private-new" type="password" autoComplete="new-password" value={passphrase} onChange={event=>setPassphrase(event.target.value)}/><FieldDescription>At least {MIN_PASSPHRASE} characters.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="private-again">Type it again</FieldLabel><Input id="private-again" type="password" autoComplete="new-password" value={again} aria-invalid={mismatch} onChange={event=>setAgain(event.target.value)}/>{mismatch?<FieldDescription>These don’t match yet.</FieldDescription>:null}</Field>
      </div>
      <Field orientation="horizontal"><Checkbox id="private-understood" checked={understood} onCheckedChange={value=>setUnderstood(!!value)}/><FieldLabel htmlFor="private-understood">I understand a lost passphrase can’t be recovered</FieldLabel></Field>
      <div><Button id="private-setup" type="submit" size="sm" disabled={busy||passphrase.length<MIN_PASSPHRASE||passphrase!==again||!understood}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}Set up encrypted storage</Button></div>
    </FieldGroup></form>:!status.unlocked?<form className="contents" onSubmit={event=>{event.preventDefault();act({action:'unlock',passphrase});}}><FieldGroup>
      <Field><FieldLabel htmlFor="private-passphrase">Passphrase</FieldLabel><Input id="private-passphrase" type="password" autoComplete="current-password" value={passphrase} onChange={event=>setPassphrase(event.target.value)}/><FieldDescription>It stays unlocked in this browser until you lock it or 15 minutes pass without use.</FieldDescription></Field>
      <div><Button id="private-unlock" type="submit" size="sm" disabled={busy||!passphrase}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}Unlock</Button></div>
    </FieldGroup></form>:status.items.length?<ItemGroup role="list" aria-label="Encrypted documents">{status.items.map(item=><Item key={item.id} size="sm" role="listitem" data-private-item={item.id}>
      <ItemContent className="min-w-0">
        <ItemTitle className="font-serif text-base font-normal [overflow-wrap:anywhere]">{item.title}</ItemTitle>
        <ItemDescription>{plural(item.files.length,'file')}{item.received_at?<> · <RelativeTime value={item.received_at}/></>:null}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" data-private-open="" onClick={()=>view(item.id)}>Open</Button>
        <ConfirmAction label="Delete" title={`Delete “${item.title}”?`} description="This removes it from encrypted storage for good." confirm="Delete" onConfirm={()=>{setOpen(null);act({action:'delete',id:item.id});}}/>
      </ItemActions>
    </Item>)}</ItemGroup>:<p id="private-empty" className="text-sm text-muted-foreground">Nothing is stored here yet. Choose “This machine only” above.</p>}
    {status.unlocked&&waiting.length?<div id="private-waiting" className="mt-4 flex flex-col gap-2">
      <h3 className="text-sm font-medium">Waiting in the inbox</h3>
      <p className="text-sm text-muted-foreground">Encrypting moves a delivery here instead of filing it, and removes the inbox copy once the encrypted copy is checked. Any copy on the machine that sent it stays there.</p>
      <ItemGroup role="list" aria-label="Deliveries that could be encrypted">{waiting.map(arrival=><Item key={arrival.id} size="sm" role="listitem" data-private-waiting={arrival.id}>
        <ItemContent className="min-w-0"><ItemTitle className="font-serif text-base font-normal [overflow-wrap:anywhere]">{arrival.title}</ItemTitle></ItemContent>
        <ItemActions><ConfirmAction label="Encrypt" title={`Encrypt “${arrival.title}”?`} description="It moves to encrypted storage and leaves the inbox. It won’t be filed, and a lost passphrase loses it." confirm="Encrypt" disabled={busy} onConfirm={()=>{act({action:'encrypt-arrival',id:arrival.id});}}/></ItemActions>
      </Item>)}</ItemGroup>
    </div>:null}
    {open&&status.unlocked?<article id="private-view" className="mt-4 rounded-lg border border-border p-4">
      <h3 className="font-serif text-lg">{open.title}</h3>
      <ul className="my-2 text-sm">{open.files.map(file=><li key={file.path}><a data-private-file={file.path} href={`/api/private/file?id=${encodeURIComponent(open.id)}&path=${encodeURIComponent(file.path)}`}>{file.path}</a></li>)}</ul>
      {open.text!=null?<div id="private-text" data-reader-decoration="" dangerouslySetInnerHTML={{__html:html(open.text)}}/>:<p className="text-sm text-muted-foreground">Download its files above to read them.</p>}
    </article>:null}
  </StatusCard>;
}
