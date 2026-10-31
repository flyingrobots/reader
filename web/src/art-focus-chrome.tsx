/* The art focus view's chrome (#147): the heading, the actions and the Artist's note over the full-screen art, plus the
   status line. art-focus.mjs creates the view, mounts this once (it never re-renders) and wires the buttons by their
   data-focus-* hooks, toggling the note's `hidden` and writing the status. The art-focus-* classes only position these
   over the stage (style.css); the look is shadcn's. */
import {Button} from '@/components/ui/button';
import {ButtonGroup} from '@/components/ui/button-group';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';

export type ArtFocusChromeProps={title:string;credit:string;brief:string};
const glass='bg-background/80 backdrop-blur-md';

export function ArtFocusChrome({title,credit,brief}:ArtFocusChromeProps){
  return <>
    <div className="art-focus-bar">
      <Card size="sm" className={'art-focus-heading w-fit min-w-48 max-w-[min(60ch,100%)] shrink-0 gap-0 py-2.5 '+glass}>
        {/* CardContent, not CardHeader: the header is a container-query container, whose zero intrinsic width would stop the card fitting its title. */}
        <CardContent className="flex flex-col gap-0.5">
          <p className="m-0 text-[9px] font-semibold tracking-[.14em] text-primary uppercase">Art</p>
          <CardTitle role="heading" aria-level={2} className="art-focus-title m-0 font-serif text-[clamp(20px,2.6vw,32px)]! leading-tight font-medium">{title}</CardTitle>
          {credit?<CardDescription className="text-[11px]">{credit}</CardDescription>:null}
        </CardContent>
      </Card>
      <ButtonGroup className={'art-focus-actions flex-wrap rounded-lg p-2 '+glass}>
        <Button type="button" variant="outline" size="sm" data-focus-note="" aria-expanded="false" aria-controls="art-focus-note">Artist’s note</Button>
        <Button type="button" variant="outline" size="sm" data-focus-prompt="">Prompt</Button>
        <Button type="button" variant="outline" size="sm" data-focus-regenerate="">Regenerate this</Button>
        <Button type="button" size="sm" data-focus-close="" aria-label="Close the focus view (Esc)">Close</Button>
      </ButtonGroup>
    </div>
    <Card size="sm" id="art-focus-note" hidden className={'art-focus-note [&[hidden]]:hidden '+glass}>
      <CardHeader><CardTitle role="heading" aria-level={3} className="m-0 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Artist’s note</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 font-serif text-[15px] leading-relaxed">{brief.split(/\n{2,}/).map((paragraph,i)=><p key={i} className="m-0">{paragraph}</p>)}</CardContent>
    </Card>
    <p className={'art-focus-status m-0 rounded-lg px-3 py-2 text-sm shadow-sm ring-1 ring-foreground/10 '+glass} role="status" aria-live="polite"/>
  </>;
}
