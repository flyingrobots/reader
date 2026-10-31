/* How a piece of art was made (#146): the body of #art-prompt-card. art-prompt.mjs decides when the card shows (hover,
   focus, long press) and where it sits, loads the answer from /api/art/prompt and renders it here. The card is a shadcn
   Card: who made it and when, the Artist's note, then each stage's prompt as sent, with the instructions first and the
   quoted article, brief and scene-language reference collapsed. */
import {useState} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from '@/components/ui/card';
import {CodeBlock, CodeBlockContent} from '@/components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';

type Part={kind:string;text:string;chars:number};
type Stage={name:string;parts:Part[];truncated?:boolean};
export type ArtPrompt={title?:string;producer?:{label?:string;model?:string};created_at?:string;prompts?:Record<string,string|null>;
  handcrafted?:boolean;recorded?:boolean;message?:string;stages:Stage[];log?:string};
export type ArtPromptView={state:'loading'}|{state:'error';message:string}|{state:'ready';prompt:ArtPrompt;title?:string;brief?:string};

const STAGES:Record<string,string>={brief:'Brief prompt',scene:'Scene prompt',repair:'Repair prompt'};
const PARTS:Record<string,string>={article:'The article, as quoted',brief:'The brief, as quoted',reference:'The scene language reference'};
const day=(value?:string)=>{const date=value?new Date(value):null;return date&&!isNaN(+date)?date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):null;};
const Message=({children}:{children:string})=><p data-art-prompt-message="" className="text-muted-foreground italic">{children}</p>;
const Text=({text,className}:{text:string;className?:string})=><CodeBlock size="sm" data-prompt-text=""><CodeBlockContent wrap className={className}>{text}</CodeBlockContent></CodeBlock>;

function CopyButton({text}:{text:string}){
  const [label,setLabel]=useState('Copy');
  return <Button variant="outline" size="xs" data-copy="" onClick={async event=>{event.preventDefault();
    try{await navigator.clipboard.writeText(text);setLabel('Copied');}catch{setLabel('Copy failed');}setTimeout(()=>setLabel('Copy'),1600);}}>{label}</Button>;
}

function StageSection({stage,layout}:{stage:Stage;layout:()=>void}){
  return <section data-art-prompt-stage="" data-stage={stage.name} className="flex flex-col gap-2 border-t pt-3">
    <div className="flex items-center justify-between gap-2">
      <h4 data-art-stage-title="" className="m-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{STAGES[stage.name]||stage.name}</h4>
      <CopyButton text={stage.parts.map(part=>part.text).join('')}/>
    </div>
    {stage.parts.map((part,i)=>part.kind==='instructions'?<Text key={i} text={part.text.trim()}/>
      :<Collapsible key={i} data-part={part.kind} onOpenChange={()=>requestAnimationFrame(layout)}>
        <CollapsibleTrigger className="group/quote flex items-center gap-1 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground">
          <ChevronRightIcon aria-hidden className="size-3 transition-transform group-data-[panel-open]/quote:rotate-90"/>{PARTS[part.kind]||part.kind} <span className="text-muted-foreground/70">{part.chars.toLocaleString()} characters</span>
        </CollapsibleTrigger>
        <CollapsibleContent><Text text={part.text} className="max-h-64"/></CollapsibleContent>
      </Collapsible>)}
    {stage.truncated?<Message>The rest of this prompt is in the run log.</Message>:null}
  </section>;
}

export function ArtPromptCard({view,layout}:{view:ArtPromptView;layout:()=>void}){
  if(view.state!=='ready')return <Card size="sm" className="max-h-[inherit] overflow-auto shadow-lg"><CardContent>
    <Message>{view.state==='loading'?'Reading the run log…':view.message}</Message></CardContent></Card>;
  const {prompt}=view,who=prompt.producer||{},versions=Object.values(prompt.prompts||{}).filter(Boolean);
  const meta=[who.label?`Made by ${who.label}${who.model?` (${who.model})`:''}`:null,day(prompt.created_at),versions.length?'prompts '+versions.join(' · '):null].filter(Boolean).join(' · ');
  const note=(view.brief||'').split(/\n{2,}/)[0];
  return <Card size="sm" className="max-h-[inherit] overflow-auto overscroll-contain shadow-lg">
    <CardHeader>
      <p className="m-0 text-[9px] font-semibold tracking-[.14em] text-primary uppercase">How this art was made</p>
      <CardTitle className="font-serif text-lg font-medium">{prompt.title||view.title||'Untitled'}</CardTitle>
      {meta?<CardDescription className="text-[11px] [overflow-wrap:anywhere]">{meta}</CardDescription>:null}
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {note?<blockquote data-art-prompt-note="" className="m-0 rounded-r-md border-l-2 bg-muted/50 px-3 py-2 font-serif text-sm leading-relaxed">
        <span className="mb-1 block font-sans text-[9px] font-semibold tracking-[.12em] text-muted-foreground uppercase">Artist’s note</span>{note}</blockquote>:null}
      {prompt.handcrafted?<Message>{prompt.message||''}</Message>
        :!prompt.recorded?<Message>{prompt.message||'Prompt not recorded for this version.'}</Message>
        :prompt.stages.map(stage=><StageSection key={stage.name} stage={stage} layout={layout}/>)}
    </CardContent>
    {prompt.recorded&&prompt.log?<CardFooter className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">Run log&nbsp;<code className="font-mono text-[10px]">{prompt.log}</code></CardFooter>:null}
  </Card>;
}
