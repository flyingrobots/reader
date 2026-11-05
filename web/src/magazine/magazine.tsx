/* The homepage as this week's issue. web_ui/magazine.mjs chooses the pieces and builds the model; this draws the spread.
   The layout follows the issue's column, not the window: the File Explorer can narrow it at any window width. Class names
   such as .issue-cover are hooks for the app, art, prose colors and tests; they carry no style. */
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDownIcon,ChevronLeftIcon,ChevronRightIcon} from 'lucide-react';
import {cn} from 'cn';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card,CardAction,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible';
import {Empty,EmptyDescription,EmptyHeader,EmptyTitle} from '@/components/ui/empty';
import {Item,ItemActions,ItemContent,ItemDescription,ItemGroup,ItemTitle} from '@/components/ui/item';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';
import {SectionItems,type SectionLink} from '../library-sections';
import {needsReader,NEEDS_READER} from '../static-demo';

type Piece={path:string;title:string;href:string;read:boolean;kicker:string;author:string;date:string;time:string|null;art:boolean};
type Row={path:string;title:string;href:string;read:boolean;meta:string};
export type IssueModel={week:string;number:number;year:string;dates:string;window:string;note:string;older:string|null;newer:string|null;
  past:{id:string;label:string;count:number;current:boolean}[];cover:Piece|null;features:Piece[];counts:{label:string;value:number}[];
  letter:{path:string;title:string;href:string}|null;sections:SectionLink[];contents:{id:string;label:string;count:number;items:Row[];more:Row[]}[];artMake:boolean};
export type WritingPiece={path:string;title:string;date:string};
export type IssueActions={api:(url:string)=>Promise<{standfirst?:string;source?:string;model?:string}>;openIssue:(week:string)=>void;queue:(path:string)=>void;makeArt:(path:string)=>void;admin:()=>void;
  wire:(element:HTMLElement)=>void;writing:(()=>Promise<WritingPiece[]>)|null};
type Standfirst={text:string;source?:string;model?:string}|null;

// A magazine's pieces sit in ruled columns, not boxes: a Card without its chrome, so type and rules set the page.
const OPEN='overflow-visible rounded-none bg-transparent text-foreground ring-0 [--card-spacing:0px]';
const KICKER='issue-kicker block text-[11px] font-[650] tracking-[.12em] uppercase text-primary';
const HEADLINE='bg-linear-to-r from-current to-current bg-size-[0_1px] bg-position-[0_92%] bg-no-repeat transition-[background-size,color] duration-300 hover:bg-size-[100%_1px] hover:text-primary focus-visible:text-primary';
const REST_SPAN:Record<number,string>={1:'@min-[1360px]/issue:col-span-12',2:'@min-[1360px]/issue:col-span-6',3:'@min-[1360px]/issue:col-span-4',4:'@min-[1360px]/issue:col-span-3'};

/** Only the pieces on screen, three requests at a time; a piece with no standfirst shows none. */
function useStandfirsts(paths:string[],api:IssueActions['api']){
  const [found,setFound]=useState<Record<string,Standfirst>>({});
  useEffect(()=>{
    let alive=true;const queue=[...paths];
    const worker=async()=>{for(let path=queue.shift();path;path=queue.shift()){
      let entry:Standfirst=null;
      try{const data=await api('/api/standfirst?path='+encodeURIComponent(path));if(data.standfirst)entry={text:data.standfirst,source:data.source,model:data.model};}catch{/* A missing standfirst is not an error. */}
      if(alive)setFound(current=>({...current,[path!]:entry}));}};
    void Promise.all([worker(),worker(),worker()]);
    return ()=>{alive=false;};
  },[]);
  return found;
}

function StandfirstText({path,entry,className}:{path:string;entry:Standfirst|undefined;className:string}){
  if(entry===null)return null;
  return <>
    <CardDescription data-standfirst={path} data-source={entry?.source} className={cn('text-pretty empty:hidden',className)}>{entry?.text}</CardDescription>
    {entry?.source==='local-model'&&entry.model?<Badge variant="outline" className="issue-machine-mark mt-2.5 font-mono text-[10px] font-normal text-muted-foreground" data-reader-decoration="">local model · {entry.model.split('/').pop()||entry.model}</Badge>:null}
  </>;
}
const Rule=()=><Separator orientation="vertical" aria-hidden className="h-3 data-vertical:self-center"/>;
function Byline({piece,className}:{piece:Piece;className?:string}){
  return <CardDescription className={cn('issue-byline flex flex-wrap items-center gap-x-2 gap-y-1 lining-nums',className)}>
    <span className="font-semibold text-foreground">{piece.author}</span><Rule/>{piece.date}{piece.time?<><Rule/>{piece.time}</>:null}<Rule/>
    {piece.read?<Badge variant="ghost" className="px-0 font-normal text-muted-foreground">Read</Badge>:<Badge variant="ghost" className="px-0 font-normal text-foreground before:size-1.25 before:rounded-full before:bg-primary">Unread</Badge>}
  </CardDescription>;
}
function QueueButton({piece,queue}:{piece:Piece;queue:IssueActions['queue']}){
  const local=needsReader();
  return <Button type="button" variant="ghost" size="xs" className="issue-queue mt-2.5 -ml-2 text-muted-foreground" data-queue-add={piece.path} aria-label={`Add ${piece.title} to your queue`} title={local?NEEDS_READER:'Add to your queue · q'}
    disabled={local} data-needs-reader={local?'':undefined} onClick={event=>{event.preventDefault();queue(piece.path);}}>+ Queue</Button>;
}
function MakeArt({path,makeArt}:{path:string;makeArt:IssueActions['makeArt']}){
  const [making,setMaking]=useState(false),local=needsReader('art');
  return <Button type="button" variant="ghost" size="xs" className="issue-art-make mt-2.5 text-muted-foreground" data-art-generate={path} data-reader-decoration="" title={local?NEEDS_READER:'An agent reads the piece, writes an art brief and composes a scene; a background job'}
    disabled={local||making} data-needs-reader={local?'':undefined} onClick={event=>{event.preventDefault();setMaking(true);makeArt(path);}}>{making?'Making art…':'Make cover art'}</Button>;
}

function Masthead({model,openIssue}:{model:IssueModel;openIssue:IssueActions['openIssue']}){
  const step=(week:string|null,label:string,key:string,icon:ReactNode)=><Button type="button" variant="ghost" size="icon-xs" data-issue={week||''} disabled={!week} aria-label={`${label} issue`} title={`${label} issue · ${key}`} onClick={event=>{event.preventDefault();if(week)openIssue(week);}}>{icon}</Button>;
  return <header className="issue-masthead grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-2.5 border-x-0 border-t-0 border-b-[3px] border-double border-foreground pb-3.5 @min-[641px]/issue:grid-cols-[1fr_auto_1fr] @min-[641px]/issue:gap-6">
    <div className="issue-dateline grid gap-0.75 text-[11px] tracking-[.08em] uppercase text-muted-foreground lining-nums"><span className="font-[650] text-foreground">Issue {model.number} · {model.year}</span><span>{model.dates}</span></div>
    <h1 className="issue-flag col-span-full row-start-1 font-serif text-[52px] leading-[.9] font-medium tracking-[-.035em] @min-[641px]/issue:col-span-1 @min-[641px]/issue:col-start-2 @min-[641px]/issue:text-center @min-[641px]/issue:text-[length:clamp(46px,6vw,76px)] @min-[1360px]/issue:text-[length:clamp(76px,4.4vw,116px)]" id="home-title">Reader<span className="text-primary" aria-hidden>.</span><span className="sr-only"> Issue {model.week}</span></h1>
    <nav className="issue-nav flex flex-wrap items-center justify-end gap-0.5 @min-[641px]/issue:gap-1.5" aria-label="Issues">
      {step(model.older,'Previous','[',<ChevronLeftIcon/>)}
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="ghost" size="xs" className="issue-archive tracking-[.04em] text-muted-foreground"/>}>Past issues</PopoverTrigger>
        <PopoverContent align="end" className="issue-archive-list w-60 p-1.5">
          <ItemGroup aria-label="Past issues" className="gap-0">{model.past.map(week=><div role="listitem" key={week.id}><Item size="xs" render={<a href={'#issue='+week.id} data-issue={week.id} aria-current={week.current?'page':undefined} className="no-underline" onClick={event=>{event.preventDefault();openIssue(week.id);}}/>}>
            <ItemContent><ItemTitle className={cn(week.current?'font-semibold':'font-normal')}>{week.label}</ItemTitle></ItemContent>
            <ItemActions className="text-xs text-muted-foreground tabular-nums">{week.count} {week.count===1?'piece':'pieces'}</ItemActions>
          </Item></div>)}</ItemGroup>
        </PopoverContent>
      </Popover>
      {step(model.newer,'Next',']',<ChevronRightIcon/>)}
    </nav>
  </header>;
}

function Cover({piece,entry,solo,artMake,actions}:{piece:Piece;entry:Standfirst|undefined;solo:boolean;artMake:boolean;actions:IssueActions}){
  return <Card role="region" aria-labelledby="cover-title" className={cn(OPEN,'issue-cover min-w-0 pt-9 pb-8 @min-[641px]/issue:pt-12 @min-[641px]/issue:pb-10 @min-[1001px]/issue:col-start-1 @min-[1001px]/issue:row-start-1 @min-[1001px]/issue:pt-16 @min-[1001px]/issue:pb-18',solo?'@min-[1360px]/issue:col-[1/13]':'@min-[1360px]/issue:col-[1/9]')}>
    {/* The figure follows the title in the document but is drawn above the kicker. */}
    <CardHeader className="gap-0">
      <CardDescription className={cn(KICKER,'mb-3.5')}>{piece.kicker}</CardDescription>
      <CardTitle role="heading" aria-level={2} id="cover-title" className="cover-title font-serif text-[length:clamp(36px,10.5vw,48px)] leading-none font-[420] tracking-[-.028em] text-balance wrap-anywhere @min-[641px]/issue:max-w-[15ch] @min-[641px]/issue:text-[length:clamp(42px,9.5cqi,132px)] @min-[1360px]/issue:max-w-[16ch]"><a href={piece.href} data-path={piece.path} data-piece="" data-cover="" className={HEADLINE}>{piece.title}</a></CardTitle>
    </CardHeader>
    {piece.art?<figure className="cover-art order-first self-stretch" data-art={piece.path} data-reader-decoration=""/>:null}
    <CardContent>
      <StandfirstText path={piece.path} entry={entry} className="cover-standfirst mt-5.5 max-w-[44ch] font-serif text-lg leading-normal font-[380] text-foreground @min-[641px]/issue:mt-7.5 @min-[641px]/issue:text-[length:clamp(19px,1.7vw,23px)] @min-[1360px]/issue:max-w-[58ch] @min-[1360px]/issue:text-[length:clamp(21px,calc(1vw+6px),31px)]"/>
      <Byline piece={piece} className="mt-6.5 text-xs"/>
      <QueueButton piece={piece} queue={actions.queue}/>
      {!piece.art&&artMake?<MakeArt path={piece.path} makeArt={actions.makeArt}/>:null}
    </CardContent>
  </Card>;
}

function Feature({piece,entry,index,rest,queue}:{piece:Piece;entry:Standfirst|undefined;index:number;rest:number;queue:IssueActions['queue']}){
  const lead=index===0,first=index%2===0;
  return <Card role="article" aria-labelledby={`feature-${index}`} className={cn(OPEN,'issue-feature relative min-w-0 border-border py-7 @min-[641px]/issue:border-l @min-[641px]/issue:px-7 @min-[641px]/issue:py-0',
    !lead&&'border-t @min-[641px]/issue:border-t-0',first&&'@min-[641px]/issue:border-l-0 @min-[641px]/issue:pl-0',first&&!lead&&'@min-[1001px]/issue:border-l @min-[1001px]/issue:pl-7',
    '@min-[1360px]/issue:border-l-0 @min-[1360px]/issue:px-0 @min-[1360px]/issue:pt-11 @min-[1360px]/issue:pb-14',
    lead?'@min-[1360px]/issue:col-[9/13] @min-[1360px]/issue:row-start-1 @min-[1360px]/issue:pt-16 @min-[1360px]/issue:pb-18':cn('@min-[1360px]/issue:row-start-2',REST_SPAN[rest]))}>
    {/* On the broadsheet the features leave their section's grid: rules between them sit in the gutter. */}
    {!lead?<Separator aria-hidden className={cn('absolute inset-x-[calc(clamp(24px,1.6vw,44px)/-2)] top-0 hidden data-horizontal:w-auto @min-[1360px]/issue:block',index===1&&'left-0',index===rest&&'right-0')}/>:null}
    {index!==1?<Separator orientation="vertical" aria-hidden className={cn('absolute left-[calc(clamp(24px,1.6vw,44px)/-2)] hidden @min-[1360px]/issue:block',lead?'top-16 bottom-18':'top-11 bottom-14')}/>:null}
    <Badge variant="ghost" aria-hidden className="feature-number mb-4 hidden h-auto self-start p-0 font-serif text-[13px] leading-none font-normal text-muted-foreground lining-nums @min-[641px]/issue:inline-flex">{String(index+2).padStart(2,'0')}</Badge>
    {piece.art?<div className="feature-art mb-4.5 aspect-[2.4/1] w-full overflow-hidden rounded-sm bg-background @min-[641px]/issue:aspect-[320/150] [&_img]:block [&_img]:size-full [&_img]:object-cover" data-art-thumb={piece.path} data-reader-decoration="" aria-hidden/>:null}
    <CardHeader className="gap-0">
      <CardDescription className={cn(KICKER,'mb-3.5')}>{piece.kicker}</CardDescription>
      <CardTitle role="heading" aria-level={3} id={`feature-${index}`} className={cn('feature-title font-serif text-[length:clamp(21px,1.9vw,26px)] leading-[1.16] font-[450] tracking-[-.012em] text-balance wrap-anywhere',lead?'@min-[1360px]/issue:text-[length:clamp(28px,1.6vw+8px,48px)] @min-[1360px]/issue:leading-[1.08]':'@min-[1360px]/issue:text-[length:clamp(23px,1.25vw+6px,36px)]')}><a href={piece.href} data-path={piece.path} data-piece="" className={HEADLINE}>{piece.title}</a></CardTitle>
    </CardHeader>
    <CardContent>
      <StandfirstText path={piece.path} entry={entry} className={cn('feature-standfirst mt-3.5 line-clamp-4 text-sm leading-[1.6] @min-[641px]/issue:line-clamp-6',lead?'@min-[1360px]/issue:line-clamp-9 @min-[1360px]/issue:max-w-[64ch] @min-[1360px]/issue:font-serif @min-[1360px]/issue:text-[length:clamp(16px,.4vw+10px,20px)] @min-[1360px]/issue:leading-[1.55] @min-[1360px]/issue:text-foreground':'@min-[1360px]/issue:max-w-[64ch] @min-[1360px]/issue:text-[length:clamp(14px,.35vw+9px,17px)]')}/>
      <Byline piece={piece} className="mt-4 text-[11px]"/>
      <QueueButton piece={piece} queue={queue}/>
    </CardContent>
  </Card>;
}

function Summary({model}:{model:IssueModel}){
  return <Card role="complementary" aria-label="This issue" className="issue-summary mb-10 min-w-0 self-start @min-[641px]/issue:mb-13 @min-[1001px]/issue:col-start-2 @min-[1001px]/issue:row-start-1 @min-[1001px]/issue:my-16 @min-[1001px]/issue:mb-18 @min-[1001px]/issue:self-end @min-[1360px]/issue:sticky @min-[1360px]/issue:top-7 @min-[1360px]/issue:col-start-13 @min-[1360px]/issue:row-[1/span_3] @min-[1360px]/issue:mb-14 @min-[1360px]/issue:max-h-[calc(100vh-92px)] @min-[1360px]/issue:self-start @min-[1360px]/issue:overflow-y-auto @min-[1360px]/issue:overscroll-contain">
    <CardContent className="flex flex-col gap-5 @min-[641px]/issue:flex-row @min-[641px]/issue:items-start @min-[641px]/issue:gap-10 @min-[1001px]/issue:flex-col @min-[1001px]/issue:items-stretch @min-[1001px]/issue:gap-5">
      <ItemGroup className="w-auto flex-row flex-wrap gap-x-7 gap-y-3 @min-[1001px]/issue:flex-col @min-[1360px]/issue:flex-row">{model.counts.map(count=><Item key={count.label} role="listitem" data-issue-stat="" className="w-auto flex-1 basis-18 rounded-none border-0 p-0 @min-[641px]/issue:flex-none @min-[641px]/issue:basis-auto">
        <ItemContent className="gap-0.5"><ItemDescription className="text-[10px] tracking-[.12em] uppercase">{count.label}</ItemDescription><ItemTitle className="line-clamp-none font-serif text-[34px] leading-none font-normal tabular-nums lining-nums @min-[641px]/issue:text-[44px] @min-[1360px]/issue:text-[length:clamp(36px,2vw,52px)]">{count.value}</ItemTitle></ItemContent>
      </Item>)}</ItemGroup>
      {model.letter?<Item variant="outline" className="issue-letter min-w-0 flex-1 no-underline [a]:hover:bg-transparent" render={<a href={model.letter.href} data-path={model.letter.path}/>}>
        <ItemContent><ItemDescription className={KICKER}>From the editors</ItemDescription><ItemTitle className="issue-letter-title line-clamp-none font-serif text-[17px] leading-[1.35] font-normal italic text-balance group-hover/item:text-primary">{model.letter.title}</ItemTitle></ItemContent>
      </Item>:null}
      <nav className="issue-index hidden flex-col gap-2 @min-[1360px]/issue:flex" aria-label="Sections in this issue">
        <h2 className="issue-kicker font-sans text-[11px] font-[650] tracking-[.12em] uppercase text-muted-foreground">Sections</h2>
        <div id="issue-sections" data-reader-decoration=""><SectionItems items={model.sections}/></div>
      </nav>
    </CardContent>
  </Card>;
}

function ContentsRow({row}:{row:Row}){
  return <div role="listitem" data-read={row.read?'':undefined}><Item render={<a href={row.href} data-path={row.path} data-piece=""/>} className="rounded-none border-0 border-b border-border/55 px-0 py-2.25 no-underline [a]:hover:bg-transparent">
    <ItemContent className="min-w-0 gap-0.75">
      <ItemTitle className={cn('contents-title line-clamp-none block font-serif text-base leading-[1.35] font-normal wrap-anywhere group-hover/item:text-primary group-focus-visible/item:text-primary @min-[1360px]/issue:text-[length:clamp(16px,.25vw+12px,18px)]',row.read&&'text-muted-foreground')}>{row.title}{row.read?null:<Badge className="ml-2 inline-block size-1.25 border-0 p-0 align-middle" title="Unread edition" aria-label="Unread edition"/>}</ItemTitle>
      <ItemDescription className="contents-meta text-[11px]">{row.meta}</ItemDescription>
    </ItemContent>
  </Item></div>;
}
function ContentsGroup({group}:{group:IssueModel['contents'][number]}){
  return <Card role="region" aria-label={group.label} id={group.id} tabIndex={-1} className={cn(OPEN,'contents-group mb-8.5 break-inside-avoid gap-0 outline-none')}>
    <CardHeader className="items-baseline border-b [.border-b]:pb-2">
      <CardTitle role="heading" aria-level={3} className="text-[11px] font-[650] tracking-[.12em] uppercase">{group.label}</CardTitle>
      <CardAction><Badge variant="secondary" className="h-4.5 px-1.5 text-[11px] font-normal tabular-nums">{group.count}</Badge></CardAction>
    </CardHeader>
    <CardContent>
      <ItemGroup aria-label={group.label} className="gap-0">{group.items.map(row=><ContentsRow key={row.path} row={row}/>)}</ItemGroup>
      {group.more.length?<Collapsible className="contents-more">
        <CollapsibleTrigger render={<Button type="button" variant="ghost" size="xs" className="group/more mt-1 -ml-2 tracking-[.06em] uppercase"/>}>{group.more.length} more<ChevronDownIcon data-icon="inline-end" className="transition-transform group-data-[panel-open]/more:rotate-180"/></CollapsibleTrigger>
        <CollapsibleContent keepMounted><ItemGroup aria-label={`More in ${group.label}`} className="gap-0">{group.more.map(row=><ContentsRow key={row.path} row={row}/>)}</ItemGroup></CollapsibleContent>
      </Collapsible>:null}
    </CardContent>
  </Card>;
}

function YourWriting({load,wire}:{load:NonNullable<IssueActions['writing']>;wire:IssueActions['wire']}){
  const [pieces,setPieces]=useState<WritingPiece[]>([]),section=useRef<HTMLElement>(null);
  useEffect(()=>{let alive=true;load().then(found=>{if(alive)setPieces(found);}).catch(error=>console.warn('Your writing',error));return ()=>{alive=false;};},[]);
  useEffect(()=>{if(section.current)wire(section.current);},[pieces]);
  if(!pieces.length)return null;
  return <section ref={section} className="your-writing mx-auto my-8 flex max-w-[76rem] flex-col gap-3 px-6" data-reader-decoration="">
    <h2 className="font-serif text-[1.35rem]">Your writing</h2>
    <ItemGroup className="gap-1">{pieces.map(piece=><Item key={piece.path} role="listitem" className="rounded-none border-0 p-0">
      <ItemContent className="min-w-0"><Button variant="link" size="xs" className="h-auto justify-start p-0 text-sm whitespace-normal" render={<a href={'#read='+encodeURIComponent(piece.path)} data-path={piece.path}/>}>{piece.title}</Button></ItemContent>
      <ItemActions className="text-sm whitespace-nowrap text-muted-foreground"><time>{piece.date}</time></ItemActions>
    </Item>)}</ItemGroup>
  </section>;
}

export function Magazine({model,actions}:{model:IssueModel;actions:IssueActions}){
  const {cover,features,contents}=model,rest=Math.max(0,features.length-1);
  const standfirsts=useStandfirsts([cover,...features].filter(Boolean).map(piece=>piece!.path),actions.api);
  return <div className="@container/issue" data-ui="shadcn">
    <div className="issue px-4 pt-5 pb-24 font-sans text-foreground [&_a]:no-underline @min-[641px]/issue:px-9 @min-[641px]/issue:pt-8 @min-[641px]/issue:pb-25 @min-[1001px]/issue:px-[clamp(40px,4vw,120px)] @min-[1001px]/issue:pt-10 @min-[1001px]/issue:pb-30 @min-[1360px]/issue:px-[clamp(56px,4vw,120px)]" id="issue" data-week={model.week}>
      <Masthead model={model} openIssue={actions.openIssue}/>
      {model.note?<p className="issue-note mt-4.5 mb-0 font-serif text-[15px] leading-normal italic text-muted-foreground" role="note">{model.note}</p>:null}
      <div className="issue-spread grid grid-cols-[minmax(0,1fr)] @min-[1001px]/issue:grid-cols-[minmax(0,1fr)_240px] @min-[1001px]/issue:gap-x-18 @min-[1360px]/issue:grid-cols-[repeat(12,minmax(0,1fr))_clamp(260px,15vw,400px)] @min-[1360px]/issue:gap-x-[clamp(24px,1.6vw,44px)]">
        {cover?<><Cover piece={cover} entry={standfirsts[cover.path]} solo={!features.length} artMake={model.artMake} actions={actions}/><Summary model={model}/></>
          :<Empty className="issue-empty col-span-full max-w-[46ch] items-start px-0 py-20 text-left"><EmptyHeader className="max-w-none items-start gap-4"><EmptyTitle role="heading" aria-level={2} className="font-serif text-[40px] leading-[1.15] font-[420]">Nothing has arrived yet.</EmptyTitle><EmptyDescription className="text-base leading-[1.6]">When works are filed with a date, the newest become this week’s issue. Reader Admin keeps the library statistics.</EmptyDescription></EmptyHeader></Empty>}
        {features.length?<section className="issue-features col-span-full grid grid-cols-[minmax(0,1fr)] border-y border-border pt-2 pb-6 @min-[641px]/issue:grid-cols-2 @min-[641px]/issue:gap-y-10 @min-[641px]/issue:pt-11 @min-[641px]/issue:pb-14 @min-[1001px]/issue:grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] @min-[1001px]/issue:gap-y-0 @min-[1360px]/issue:contents" aria-label="Features">{features.map((piece,index)=><Feature key={piece.path} piece={piece} entry={standfirsts[piece.path]} index={index} rest={rest} queue={actions.queue}/>)}</section>:null}
        {contents.length?<section className={cn('issue-contents col-span-full pt-12 @min-[1360px]/issue:border-t @min-[1360px]/issue:border-border',cover&&'@min-[1360px]/issue:col-[1/13]')} aria-labelledby="contents-title">
          <h2 className="issue-section-title mb-7 font-serif text-3xl font-[450] tracking-[-.01em]" id="contents-title">In this issue</h2>
          <div className="contents-columns columns-[260px] gap-x-14 @min-[1360px]/issue:columns-[280px] @min-[1360px]/issue:gap-x-[clamp(40px,2.6vw,64px)]">{contents.map(group=><ContentsGroup key={group.id} group={group}/>)}</div>
        </section>:null}
      </div>
      <footer className="issue-footer mt-10 border-t border-border pt-5 text-[11px] leading-[1.6] text-muted-foreground @min-[641px]/issue:flex @min-[641px]/issue:items-baseline @min-[641px]/issue:justify-between @min-[641px]/issue:gap-8 @min-[1360px]/issue:gap-16">
        <p className="mb-0 max-w-[72ch]">Chosen from works filed {model.window}: unread first, then how recent, the kind of writing, other voices’ reading, open margin threads{model.letter?' and the newsletter’s picks':''}. Each feature comes from a different project where one is available.</p>
        <Button type="button" variant="link" size="xs" id="issue-backstage" className="mt-3 h-auto max-w-full shrink-0 px-0 text-left text-[11px] whitespace-normal @min-[641px]/issue:mt-0 @min-[641px]/issue:whitespace-nowrap" onClick={actions.admin}>Library statistics are in Reader Admin ↗</Button>
      </footer>
    </div>
    {actions.writing?<YourWriting load={actions.writing} wire={actions.wire}/>:null}
  </div>;
}
