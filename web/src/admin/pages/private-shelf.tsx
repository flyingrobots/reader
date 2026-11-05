/* Admin › Publish: documents encrypted on this machine. Only a browser here sees this: through a tailnet the API answers
   404, so the upload level doesn't appear and a note says where to go instead. Passphrases go to the server once, and the key stays in its memory
   behind an HttpOnly cookie. Documents open in the reader, as previews: nothing about them is saved, and their URLs carry only an ID. */
import {useCallback, useEffect, useState} from 'react';
import {LockIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Spinner} from '@/components/ui/spinner';
import {StatusBadge} from '@/theme/atoms/status-badge';
import {RelativeTime} from '@/theme/atoms/time';
import {Notice} from '@/theme/molecules/notice';
import {StatusCard} from '@/theme/organisms/status-card';
import {ConfirmAction} from '@/theme/organisms/confirm-action';
import {plural} from '../../plural';
import {size} from './inbox';

type Api=(path:string,payload?:unknown,extra?:Record<string,unknown>)=>Promise<any>;
type StoredFile={path:string;bytes:number};
type Waiting={id:string;title:string;files:number;bytes:number;received_at?:string|null};
type Stored={id:string;title:string;author?:string|null;received_at?:string;files:StoredFile[]};
export type PrivateStatus={installed:boolean;initialized:boolean;unlocked:boolean;items:Stored[]};
const MIN_PASSPHRASE=12;

export function usePrivateStatus(api:Api){
  const [status,setStatus]=useState<PrivateStatus|null>(null),[available,setAvailable]=useState(false),[checked,setChecked]=useState(false);
  const refresh=useCallback(async()=>{try{setStatus(await api('/api/private'));setAvailable(true);}catch{setStatus(null);setAvailable(false);}finally{setChecked(true);}},[api]);
  useEffect(()=>{refresh();},[refresh]);
  return {status,available,checked,refresh};
}

export function PrivateShelf({api,privacy}:{api:Api;privacy:ReturnType<typeof usePrivateStatus>}){
  const {status,available,checked,refresh}=privacy;
  const [passphrase,setPassphrase]=useState(''),[again,setAgain]=useState(''),[understood,setUnderstood]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const act=async(payload:Record<string,unknown>)=>{setBusy(true);setError(null);
    try{await api('/api/private',payload);setPassphrase('');setAgain('');setUnderstood(false);await refresh();return true;}
    catch(cause){setError((cause as Error).message);return false;}finally{setBusy(false);}};
  const [waiting,setWaiting]=useState<Waiting[]>([]),[batchError,setBatchError]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[progress,setProgress]=useState<{done:number;total:number}|null>(null);
  // One at a time, in list order. A failure stops the rest, and whatever hasn't moved stays selected to try again.
  const encryptSelected=async()=>{
    const chosen=waiting.filter(arrival=>selected.includes(arrival.id));
    setBusy(true);setBatchError(null);setProgress({done:0,total:chosen.length});
    try{for(const [index,arrival] of chosen.entries()){
      try{await api('/api/private',{action:'encrypt-arrival',id:arrival.id});}
      catch(cause){setBatchError(`Stopped at “${arrival.title}”: ${(cause as Error).message}`);break;}
      setSelected(current=>current.filter(id=>id!==arrival.id));setProgress({done:index+1,total:chosen.length});
    }}finally{setBusy(false);setProgress(null);await refresh();}
  };
  useEffect(()=>{if(!status?.unlocked){setWaiting([]);return;}api('/api/inbox').then(inbox=>setWaiting((inbox.arrivals||[]).filter((arrival:{bundle?:boolean;integrity?:string})=>arrival.bundle&&arrival.integrity==='intact'))).catch(()=>setWaiting([]));},[api,status]);
  if(!available||!status)return checked?<Notice id="private-elsewhere" role="note" title="Encrypted storage isn’t available at this address.">To set a passphrase or encrypt documents, open Publish in a browser on the computer that holds your library, using its local address (for example <code className="font-mono text-xs">http://127.0.0.1:8766/#admin/publish</code>). A Tailscale address can’t reach it, even on that computer.</Notice>:null;
  const badge=status.unlocked?<StatusBadge tone="active" data-private-state="unlocked">Unlocked</StatusBadge>:status.initialized?<StatusBadge tone="neutral" data-private-state="locked">Locked</StatusBadge>:<StatusBadge tone="neutral" data-private-state="unset">Not set up</StatusBadge>;
  const mismatch=!!again&&again!==passphrase;
  const chosen=waiting.filter(arrival=>selected.includes(arrival.id)),allSelected=!!waiting.length&&chosen.length===waiting.length;
  return <><StatusCard data-private="" title="On this machine only" description="Encrypted copies that never join your vault or leave this Mac. No model, voice or search can find them through Reader." badge={badge}
    footer={status.unlocked?<Button id="private-lock" variant="outline" size="sm" disabled={busy} onClick={()=>act({action:'lock'})}><LockIcon data-icon="inline-start" aria-hidden/>Lock</Button>:undefined}>
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
    </FieldGroup></form>:status.items.length?<Table aria-label="Encrypted documents">
      <TableHeader><TableRow><TableHead>Document</TableHead><TableHead className="max-sm:hidden">Files</TableHead><TableHead className="max-sm:hidden">Received</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
      <TableBody>{status.items.map(item=><TableRow key={item.id} data-private-item={item.id}>
        <TableCell className="font-serif text-base whitespace-normal [overflow-wrap:anywhere]">{item.title}</TableCell>
        <TableCell className="text-muted-foreground tabular-nums max-sm:hidden">{plural(item.files.length,'file')}</TableCell>
        <TableCell className="text-muted-foreground max-sm:hidden">{item.received_at?<RelativeTime value={item.received_at}/>:null}</TableCell>
        <TableCell><div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" data-private-open="" nativeButton={false} render={<a href={`#read=private/${encodeURIComponent(item.id)}`}/>}>Open</Button>
          <ConfirmAction variant="outline" size="sm" label="Delete" title={`Delete “${item.title}”?`} description="This removes it from encrypted storage for good." confirm="Delete" onConfirm={()=>act({action:'delete',id:item.id})}/>
        </div></TableCell>
      </TableRow>)}</TableBody>
    </Table>:<p id="private-empty" className="text-sm text-muted-foreground">Nothing is stored here yet. Choose “This machine only” above.</p>}
  </StatusCard>
  {status.unlocked&&waiting.length?<StatusCard id="private-waiting" title="Waiting in the inbox" description="Encrypting moves a delivery to encrypted storage instead of filing it, and removes the inbox copy once the encrypted copy is checked. Any copy on the machine that sent it stays there."
    badge={<StatusBadge tone="active">{plural(waiting.length,'delivery','deliveries')}</StatusBadge>}
    footer={<>
      <ConfirmAction id="private-encrypt-selected" variant="default" size="default" label={progress?<><Spinner data-icon="inline-start" aria-hidden/>Encrypting {progress.done+1} of {progress.total}…</>:<><LockIcon data-icon="inline-start" aria-hidden/>Encrypt selected{chosen.length?` (${chosen.length})`:''}</>} title={`Encrypt ${plural(chosen.length,'document')}?`} description="They move to encrypted storage and leave the inbox. They won’t be filed, and a lost passphrase loses them." confirm="Encrypt" disabled={busy||!chosen.length} onConfirm={encryptSelected}/>
      <span id="private-selection-note" className="text-sm text-muted-foreground">{chosen.length?`${chosen.length} of ${waiting.length} selected.`:'Select the documents to encrypt.'}</span>
    </>}>
    {batchError?<Notice id="private-batch-error" tone="error" role="alert">{batchError}</Notice>:null}
    <Table aria-label="Deliveries that could be encrypted">
      <TableHeader><TableRow>
        <TableHead className="w-8"><Checkbox id="private-select-all" data-private-select-all="" aria-label="Select all" disabled={busy} checked={allSelected} indeterminate={!!chosen.length&&!allSelected} onCheckedChange={value=>setSelected(value?waiting.map(arrival=>arrival.id):[])}/></TableHead>
        <TableHead>Document</TableHead><TableHead className="max-sm:hidden">Size</TableHead><TableHead className="max-sm:hidden">Received</TableHead>
      </TableRow></TableHeader>
      <TableBody>{waiting.map(arrival=><TableRow key={arrival.id} data-private-waiting={arrival.id} data-state={selected.includes(arrival.id)?'selected':undefined}>
        <TableCell><Checkbox id={`private-select-${arrival.id}`} data-private-select="" disabled={busy} checked={selected.includes(arrival.id)} onCheckedChange={value=>setSelected(current=>value?[...current,arrival.id]:current.filter(id=>id!==arrival.id))}/></TableCell>
        <TableCell className="whitespace-normal"><label htmlFor={`private-select-${arrival.id}`} className="block cursor-pointer font-serif text-base [overflow-wrap:anywhere]">{arrival.title}</label></TableCell>
        <TableCell className="text-muted-foreground tabular-nums max-sm:hidden">{plural(arrival.files,'file')} · {size(arrival.bytes)}</TableCell>
        <TableCell className="text-muted-foreground max-sm:hidden">{arrival.received_at?<RelativeTime value={arrival.received_at}/>:null}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </StatusCard>:null}</>;
}

export function EncryptedPage({api}:{api:Api}){
  const privacy=usePrivateStatus(api);
  return <section id="backstage-encrypted" aria-label="Encrypted" className="flex flex-col gap-6"><PrivateShelf api={api} privacy={privacy}/></section>;
}
