/* Atom: a status shown as a shadcn Badge. A tone names what the status means; the Badge variant follows from it, so every
   Admin page shows the same meaning the same way. A busy status carries the shadcn Spinner. */
import type {ComponentProps} from 'react';
import {Badge} from '@/components/ui/badge';
import {Spinner} from '@/components/ui/spinner';

/** ok: healthy or done · attention: needs a look · error: failed or unreadable · active: working now · neutral: no judgment. */
export type Tone='ok'|'attention'|'error'|'active'|'neutral';
const VARIANT:Record<Tone,ComponentProps<typeof Badge>['variant']>={ok:'secondary',attention:'outline',error:'destructive',active:'default',neutral:'outline'};

export function StatusBadge({tone,busy,children,...props}:{tone:Tone;busy?:boolean}&Omit<ComponentProps<typeof Badge>,'variant'>){
  return <Badge variant={VARIANT[tone]} data-tone={tone} {...props}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}{children}</Badge>;
}
