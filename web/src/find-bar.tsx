/* Find inside the open document (/): a shadcn InputGroup with the match count and a ButtonGroup to step or close, in the
   document only while open. app.mjs owns the query, the count and the behaviour and reaches these by id (#find-query,
   #find-count, #find-prev, #find-next, #find-close); the island renders once, so its writes to the count and the input stay put. */
import {ChevronDownIcon, ChevronUpIcon, XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ButtonGroup} from '@/components/ui/button-group';
import {InputGroup, InputGroupAddon, InputGroupInput, InputGroupText} from '@/components/ui/input-group';
import {Label} from '@/components/ui/label';

export function FindBar(){
  return <div id="find-bar" className="find-bar" role="search" data-ui="shadcn"><div className="flex w-full items-center gap-2 rounded-xl bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
    <InputGroup className="min-w-0 flex-1">
      <InputGroupAddon><Label htmlFor="find-query">/</Label></InputGroupAddon>
      <InputGroupInput id="find-query" aria-label="Find within this document" autoComplete="off" spellCheck={false}/>
      <InputGroupAddon align="inline-end"><InputGroupText id="find-count" aria-live="polite" className="text-xs tabular-nums">0 / 0</InputGroupText></InputGroupAddon>
    </InputGroup>
    <ButtonGroup>
      <Button type="button" variant="outline" size="icon-sm" id="find-prev" aria-label="Previous match"><ChevronUpIcon aria-hidden/></Button>
      <Button type="button" variant="outline" size="icon-sm" id="find-next" aria-label="Next match"><ChevronDownIcon aria-hidden/></Button>
      <Button type="button" variant="outline" size="icon-sm" id="find-close" aria-label="Close find"><XIcon aria-hidden/></Button>
    </ButtonGroup>
  </div></div>;
}
