/* Admin › Voices (#admin/voices): the agent command lines chat voices and the librarian run, and GPU coordination for the
   local model. Design sheet: docs/admin-design/voices.md. Reader only finds them; it never installs or signs in, so
   this page has no install buttons. An unchecked or unreadable status says so. */
import {Fragment} from 'react';
import {ArrowUpRightIcon, TerminalIcon} from 'lucide-react';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle} from '@/components/ui/item';
import {StatusBadge} from '@/theme/atoms/status-badge';
import {Notice} from '@/theme/molecules/notice';
import {EmptyState, LoadingState, Unavailable} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import type {CompanionsStatus} from '../../companions';

export function VoicesPage({status,error=null}:{status:CompanionsStatus|null;error?:string|null}){
  const gpu=status?.local_model?.gpu;
  if(!status)return error?<Unavailable id="companion-cli-pending" what="Agent command lines" error={error}/>:<div id="companion-cli-pending" data-state="loading"><LoadingState>Looking for agent command lines…</LoadingState></div>;
  if(!status.cli&&!gpu)return <EmptyState id="companion-cli-none" icon={TerminalIcon} title="No agent command lines" description="This Reader reports none."/>;
  return <div className="flex flex-col gap-4">
    <StatusCard id="companion-cli" title="Agent command lines" description="Chat voices and the inbox librarian run these with your own account. Reader only finds them; install and sign in yourself.">
      <ItemGroup>{(status.cli||[]).map((cli,index)=><Fragment key={cli.name}>{index?<ItemSeparator role="presentation"/>:null}
        <Item size="sm" role="listitem" className="px-0" data-cli={cli.name} data-state={cli.state}>
          <ItemMedia variant="icon"><TerminalIcon aria-hidden/></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>{cli.title} <code className="font-mono text-xs text-muted-foreground">{cli.name}</code></ItemTitle>
            <ItemDescription className="line-clamp-none [overflow-wrap:anywhere]">{cli.path?<code className="font-mono text-xs">{cli.path}</code>:'Not found on this computer.'}{cli.voices.length?<> · used by {cli.voices.join(', ')}</>:null}</ItemDescription>
          </ItemContent>
          <ItemActions className="max-sm:basis-full">
            <StatusBadge tone={cli.path?'ok':'neutral'}>{cli.path?'Found':'Not found'}</StatusBadge>
            {!cli.path&&cli.link?<a className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href={cli.link} target="_blank" rel="noreferrer">Setup<ArrowUpRightIcon className="size-3.5" aria-hidden/></a>:null}
          </ItemActions>
        </Item></Fragment>)}</ItemGroup>
    </StatusCard>
    {gpu?<Notice id="companion-gpu" data-gpu={gpu.mode} title={`GPU coordination: ${gpu.label}.`}>{gpu.message}</Notice>:null}
  </div>;
}
