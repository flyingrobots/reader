/* Admin › Publish: named tokens that let another machine or agent deliver to the inbox. Only a browser on this machine
   sees this. The secret appears once, and the server keeps only its hash. */
import {useCallback, useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Field, FieldDescription, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle} from '@/components/ui/item';
import {RelativeTime} from '@/theme/atoms/time';
import {Notice} from '@/theme/molecules/notice';
import {StatusCard} from '@/theme/organisms/status-card';
import {ConfirmAction} from '@/theme/organisms/confirm-action';
import {plural} from '../../plural';
import {size} from './inbox';

type Api=(path:string,payload?:unknown,extra?:Record<string,unknown>)=>Promise<any>;
type Token={id:string;name:string;created_at:string;last_used_at:string|null;uploads_today:number;bytes_today:number};

export function DeliveryTokens({api}:{api:Api}){
  const [tokens,setTokens]=useState<Token[]|null>(null),[name,setName]=useState(''),[fresh,setFresh]=useState<{name:string;token:string}|null>(null),[error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{try{setTokens((await api('/api/delivery-tokens')).tokens);}catch{setTokens(null);}},[api]);
  useEffect(()=>{load();},[load]);
  const act=async(payload:Record<string,unknown>)=>{setError(null);try{const result=await api('/api/delivery-tokens',payload);await load();return result;}catch(cause){setError((cause as Error).message);return null;}};
  if(tokens===null)return null;
  return <StatusCard data-delivery-tokens="" title="Delivery tokens" description="Let another machine or agent send documents to your inbox. A token can’t read your library or start filing, and it’s limited to 200 uploads and 512 MB a day.">
    {error?<Notice id="token-error" tone="error" role="alert">{error}</Notice>:null}
    {fresh?<Notice id="token-fresh" title={`Copy the token for “${fresh.name}” now. It won’t be shown again.`}><code id="token-value" className="font-mono text-xs [overflow-wrap:anywhere]">{fresh.token}</code></Notice>:null}
    <form className="flex items-end gap-2" onSubmit={async event=>{event.preventDefault();const created=await act({action:'create',name});if(created){setFresh(created);setName('');}}}>
      <Field className="flex-1"><FieldLabel htmlFor="token-name">New token’s name</FieldLabel><Input id="token-name" value={name} maxLength={80} placeholder="My laptop" onChange={event=>setName(event.target.value)}/></Field>
      <Button id="token-create" type="submit" size="sm" disabled={!name.trim()}>Create token</Button>
    </form>
    {tokens.length?<ItemGroup role="list" aria-label="Delivery tokens" className="mt-3">{tokens.map(token=><Item key={token.id} size="sm" role="listitem" data-token={token.name}>
      <ItemContent className="min-w-0">
        <ItemTitle className="[overflow-wrap:anywhere]">{token.name}</ItemTitle>
        <ItemDescription>{token.last_used_at?<>Used <RelativeTime value={token.last_used_at}/></>:'Not used yet'} · {plural(token.uploads_today,'upload')} today · {size(token.bytes_today)}</ItemDescription>
      </ItemContent>
      <ItemActions><ConfirmAction label="Revoke" title={`Revoke “${token.name}”?`} description="Anything using this token will stop being able to deliver." confirm="Revoke" onConfirm={()=>{setFresh(null);act({action:'revoke',id:token.id});}}/></ItemActions>
    </Item>)}</ItemGroup>:<FieldDescription className="mt-3">No tokens yet.</FieldDescription>}
  </StatusCard>;
}
