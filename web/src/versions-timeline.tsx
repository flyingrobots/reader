/* The versions timeline in the Versions panel (Space v): each edition of a document, its git history, where you are and
   what you read, with a compare button per row. versions.mjs owns the state (the version marked to compare from), the
   keyboard (j/k, Enter, c, Escape) and the clicks, which it reads from the data-* attributes rendered here; the model is
   its timelineModel. */
import {ArrowLeftRightIcon, ChevronRightIcon} from 'lucide-react';
import {cn} from 'cn';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Kbd} from '@/components/ui/kbd';

type Tag={kind:'here'|'read'|'newest'|'edited'|'same';text:string};
type Readers={label:string;own:boolean;others:number}|null;
type Commit={ref:string;here:boolean;marked:boolean;mark:string;when:string;subject:string;short:string;tags:Tag[];readers:Readers;compareLabel:string};
type Edition={ref:string;here:boolean;newest:boolean;marked:boolean;mark:string;name:string;where:string|null;meta:string;tags:Tag[];readers:Readers;compareLabel:string;
  historyOpen:boolean;historyLabel:string;historyNote:string|null;commits:Commit[]};
export type TimelineModel={title:string;counts:string;sideBySide:boolean;openNewer:{ref:string;label:string}|null;marked:string|null;editions:Edition[];more:number;catalog:string|null};

const TAG_VARIANT:Record<Tag['kind'],'default'|'secondary'|'outline'>={here:'default',read:'secondary',newest:'outline',edited:'outline',same:'outline'};
const row='flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:bg-muted data-[marked]:ring-2 data-[marked]:ring-primary';

function Tags({tags,readers}:{tags:Tag[];readers:Readers}){
  return <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
    {tags.map(tag=><Badge key={tag.kind} variant={TAG_VARIANT[tag.kind]} data-vt-tag={tag.kind} className="h-4 px-1.5 text-[10px] font-normal">{tag.text}</Badge>)}
    {readers?<span className="flex items-center gap-0.5" title={readers.label} aria-label={readers.label} data-vt-readers="">
      {readers.own?<span data-vt-reader="own" className="size-1.5 rounded-full bg-primary"/>:null}
      {Array.from({length:readers.others},(_,i)=><span key={i} data-vt-reader="other" className="size-1.5 rounded-full bg-muted-foreground/60"/>)}
    </span>:null}
  </span>;
}

function Compare({target,label}:{target:string;label:string}){
  return <Button variant="ghost" size="icon-xs" data-compare-ref={target} aria-label={label} title="Compare (c)"><ArrowLeftRightIcon aria-hidden/></Button>;
}

export function VersionsTimeline({model}:{model:TimelineModel|null}){
  if(!model)return null;
  return <div className="flex flex-col gap-3 text-sm">
    <p data-versions-sub="" className="text-muted-foreground"><span className="font-medium text-foreground">{model.title}</span><br/>{model.counts}</p>
    <div className="flex flex-wrap gap-1.5">
      <Button variant="outline" size="xs" data-compare-current="">Compare with current</Button>
      {model.sideBySide?<Button variant="outline" size="xs" data-compare-split="" title="Open the selected version beside this one, scrolling together">Compare side by side</Button>:null}
      {model.openNewer?<Button variant="outline" size="xs" data-open-ref={model.openNewer.ref}>{model.openNewer.label}</Button>:null}
    </div>
    <p data-versions-hint="" aria-live="polite" className="text-xs text-muted-foreground">
      {model.marked?<>Comparing from <strong className="text-foreground">{model.marked}</strong>. Choose another version and press <Kbd>c</Kbd>, or <Button variant="link" size="xs" className="h-auto px-0" data-unmark="">cancel</Button>.</>
        :<><Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>c</Kbd> compare two</>}
    </p>
    <ol aria-label="Editions and their history" className="m-0 flex list-none flex-col gap-1 p-0">
      {model.editions.map(edition=><li key={edition.ref} data-vt-edition="" data-here={edition.here||undefined} data-newest={edition.newest||undefined}>
        <div className="flex items-start gap-1">
          <button type="button" data-vt-item="file" data-vt-key={edition.ref} data-ref={edition.ref} aria-current={edition.here?'true':'false'} data-marked={edition.marked||undefined} className={row}>
            <span aria-hidden data-vt-mark="" className={cn('w-3 shrink-0 text-center',edition.here?'text-primary':'text-muted-foreground')}>{edition.mark}</span>
            <span className="flex min-w-0 flex-col">
              <span data-vt-name="" className="font-medium">{edition.name}{edition.where?<small className="font-normal text-muted-foreground"> · {edition.where}</small>:null}</span>
              {edition.meta?<span className="text-xs text-muted-foreground">{edition.meta}</span>:null}
            </span>
            <Tags tags={edition.tags} readers={edition.readers}/>
          </button>
          <Compare target={edition.ref} label={edition.compareLabel}/>
        </div>
        {edition.commits.length?<Collapsible defaultOpen={edition.historyOpen} className="ml-5">
          <CollapsibleTrigger data-vt-item="history" data-vt-key={"history:"+edition.ref} className="group/history flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRightIcon aria-hidden className="size-3 transition-transform group-data-[panel-open]/history:rotate-90"/>{edition.historyLabel}
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted>
            <ol className="m-0 flex list-none flex-col p-0">
              {edition.commits.map(commit=><li key={commit.ref} className="flex items-start gap-1">
                <button type="button" data-vt-item="commit" data-vt-key={commit.ref} data-ref={commit.ref} aria-current={commit.here?'true':'false'} data-marked={commit.marked||undefined} className={row}>
                  <span aria-hidden data-vt-mark="" className="w-3 shrink-0 text-center text-muted-foreground">{commit.mark}</span>
                  <span className="flex min-w-0 flex-col"><span data-vt-when="" className="text-xs text-muted-foreground tabular-nums">{commit.when}</span><span data-vt-subject="" className="text-xs [overflow-wrap:anywhere]">{commit.subject}</span></span>
                  <span className="ml-auto flex shrink-0 flex-col items-end gap-1"><Tags tags={commit.tags} readers={commit.readers}/><code className="font-mono text-[10px] text-muted-foreground">{commit.short}</code></span>
                </button>
                <Compare target={commit.ref} label={commit.compareLabel}/>
              </li>)}
              {edition.historyNote?<li data-vt-note="" className="px-2 py-1 text-xs text-muted-foreground">{edition.historyNote}</li>:null}
            </ol>
          </CollapsibleContent>
        </Collapsible>:null}
      </li>)}
    </ol>
    {model.more?<p data-vt-note="" className="text-xs text-muted-foreground">+{model.more} more editions not shown</p>:null}
    {model.catalog?<p data-vt-note="" className="text-xs text-muted-foreground">Catalog note (describes this file; not an edition): <code className="font-mono">{model.catalog}</code></p>:null}
    <p aria-hidden className="flex gap-3 text-[11px] text-muted-foreground"><span>● reading</span><span>◐ you read</span><span>★ newest</span></p>
  </div>;
}
