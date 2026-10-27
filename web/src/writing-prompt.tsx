import {useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import {Button} from './components/ui/button';
import {Select,SelectContent,SelectGroup,SelectItem,SelectTrigger,SelectValue} from './components/ui/select';
import {Field,FieldLabel} from './components/ui/field';
import {Skeleton} from './components/ui/skeleton';
type Model={open:boolean;loading:boolean;busy:boolean;error:string;prompt:null|{author:string;question:string;evidence:unknown;evidence_warning?:string;earlier?:boolean};
  voice:string;voices:{name:string}[];task:null|{state:string;commit?:{status:string;error?:string}}};
type Options={getSnapshot():Model;subscribe(fn:()=>void):()=>void;actions:{close():void;generate(regenerate?:boolean):void;voice(value:string):void;write():void;evidence():void}};
function WritingPrompt({getSnapshot,subscribe,actions}:Options){
  const model=useSyncExternalStore(subscribe,getSnapshot),disabled=model.loading||model.busy;
  return <Dialog open={model.open} onOpenChange={open=>{if(!open)actions.close();}} onOpenChangeComplete={open=>{if(!open&&!getSnapshot().open)(document.querySelector<HTMLElement>('.scratch-editor .cm-content')??document.querySelector<HTMLElement>('#main'))?.focus({preventScroll:true});}}>
    <DialogContent className="reader-quiz-dialog" data-reader-writing-prompt="" finalFocus={false} onKeyDown={event=>event.stopPropagation()}>
      <DialogHeader><DialogTitle>Write about this</DialogTitle><DialogDescription>A voice asks a question. Your answer stays on this device until you save it.</DialogDescription></DialogHeader>
      {model.loading?<Skeleton className="h-24 w-full"/>:<>
        <Field><FieldLabel htmlFor="writing-prompt-voice">Ask me something</FieldLabel><Select value={model.voice||null} disabled={disabled||!model.voices.length} onValueChange={value=>{if(value)actions.voice(value);}}>
          <SelectTrigger id="writing-prompt-voice"><SelectValue placeholder="Choose a voice"/></SelectTrigger><SelectContent><SelectGroup>{model.voices.map(v=><SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select></Field>
        {model.busy&&<p role="status">{model.task?.state==='queued'?'Waiting for a voice…':'Thinking of a question…'}</p>}
        {model.error&&<p role="alert" className="text-destructive">{model.error}</p>}
        {model.prompt?<><p className="text-muted-foreground">{model.prompt.author}{model.prompt.earlier?' · earlier edition':''}</p><p className="text-xl leading-relaxed">{model.prompt.question}</p>
          {model.prompt.evidence?<Button variant="link" onClick={actions.evidence}>Show me in the text</Button>:<p className="text-muted-foreground">The question has no verified passage link.</p>}
          <DialogFooter><Button variant="outline" disabled={disabled||!model.voices.length} onClick={()=>actions.generate(true)}>Ask something else</Button><Button disabled={disabled} onClick={actions.write}>Write a response</Button></DialogFooter>
        </>:<Button disabled={disabled||!model.voices.length} onClick={()=>actions.generate()}>Ask a question</Button>}
        {!model.voices.length&&<p className="text-muted-foreground">Configure an enabled voice to generate a question. Existing saved questions remain readable.</p>}
        {model.task?.commit?.status==='failed'&&<p role="alert">The question was saved, but its commit failed. {model.task.commit.error}</p>}
      </>}
    </DialogContent>
  </Dialog>;
}
export function mountWritingPrompt(options:Options){const element=document.createElement('div');element.dataset.readerDecoration='';document.body.append(element);const root=createRoot(element);root.render(<WritingPrompt {...options}/>);return {destroy(){root.unmount();element.remove();}};}
