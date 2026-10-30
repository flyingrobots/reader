/* Atom: the icon of a run's state, for ItemMedia. Running is the shadcn Spinner; done and failed are lucide icons with a
   spoken label, never bare ✓ / ✕ glyphs. */
import {CircleCheckIcon, CircleDashedIcon, CircleXIcon} from 'lucide-react';
import {Spinner} from '@/components/ui/spinner';

export type RunState='running'|'succeeded'|'failed'|'waiting';
export function RunStateIcon({state}:{state:RunState}){
  if(state==='running')return <Spinner aria-label="Running"/>;
  if(state==='succeeded')return <CircleCheckIcon className="text-primary" role="img" aria-label="Succeeded"/>;
  if(state==='failed')return <CircleXIcon className="text-destructive" role="img" aria-label="Failed"/>;
  return <CircleDashedIcon className="text-muted-foreground" role="img" aria-label="Waiting"/>;
}
