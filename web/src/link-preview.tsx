/* Link previews (links.mjs decides when): a shadcn HoverCard anchored to a link the document itself contains. Those links
   are rendered Markdown, not React, so the card has no Trigger; links.mjs opens and closes it, keeping the hover pause,
   Escape, scroll and selection rules. On a phone the card is a bottom sheet inside the 16 px gutters, placed by a
   virtual anchor just above the status line. Previews appear constantly while reading, so the card does not animate. */
import {HoverCard, HoverCardContent} from '@/components/ui/hover-card';

export type LinkPreviewData={type:'external';host:string}|{type:'missing';message:string}
  |{type:'document';title:string;project?:string;kind?:string;read?:boolean;authors?:string[];heading?:string;excerpt?:string};
export type LinkPreviewState={anchor:Element;data:LinkPreviewData;sheet:boolean}|null;

const STATUS_LINE=52,GUTTER=16;
const sheetAnchor={getBoundingClientRect:()=>new DOMRect(GUTTER,innerHeight-STATUS_LINE,innerWidth-2*GUTTER,0)};
const Kicker=({children}:{children:string})=><div data-link-preview-kicker="" className="mb-1 text-[9px] font-semibold tracking-[.1em] text-muted-foreground uppercase">{children}</div>;

function Body({data}:{data:LinkPreviewData}){
  if(data.type==='external')return <><Kicker>External link</Kicker><div data-link-preview-host="" className="font-mono text-sm">{data.host}</div></>;
  if(data.type==='missing')return <><Kicker>Not in the library</Kicker><p data-link-preview-excerpt="" className="text-xs text-muted-foreground">{data.message}</p></>;
  return <>
    <Kicker>{data.project||(data.kind==='.pdf'?'PDF':'From the library')}</Kicker>
    <div data-link-preview-title="" className="font-serif text-base leading-snug font-semibold">{data.title}
      {!data.read?<span data-unread="" className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" title="Unread edition" aria-label="Unread edition"/>:null}</div>
    {data.authors?.length?<div className="mt-0.5 text-[11px] text-muted-foreground">{data.authors.join(' · ')}</div>:null}
    {data.heading?<div data-link-preview-heading="" className="mt-2 text-[11px] text-primary">§ {data.heading}</div>:null}
    {data.excerpt?<p data-link-preview-excerpt="" className="mt-1.5 line-clamp-6 text-xs leading-normal text-muted-foreground">{data.excerpt}</p>:null}
  </>;
}

export function LinkPreview({preview,onLeave}:{preview:LinkPreviewState;onLeave:(next:EventTarget|null)=>void}){
  return <HoverCard open={!!preview}>
    {preview?<HoverCardContent id="link-preview" role="tooltip" data-ui="shadcn" data-reader-decoration="" data-sheet={preview.sheet?'':undefined}
      anchor={preview.sheet?sheetAnchor:preview.anchor} side={preview.sheet?'top':'bottom'} align="start" sideOffset={preview.sheet?0:8} alignOffset={0}
      className={(preview.sheet?'max-h-[45vh] w-[calc(100vw-32px)] overflow-auto p-3.5':'w-[min(360px,calc(100vw-32px))] p-3.5')+' data-open:animate-none data-closed:animate-none'}
      onMouseLeave={event=>onLeave(event.relatedTarget)}>
      <Body data={preview.data}/>
    </HoverCardContent>:null}
  </HoverCard>;
}
