import {useRef,useState,useSyncExternalStore} from 'react';
import {Notice} from './theme/molecules/notice';
import {createRoot} from 'react-dom/client';
import {ArrowUpIcon,ChevronDownIcon,LoaderCircleIcon,RefreshCwIcon,TextQuoteIcon,TriangleAlertIcon} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './components/ui/dialog';
import {Button} from './components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuGroup,DropdownMenuLabel,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {InputGroup,InputGroupAddon,InputGroupButton,InputGroupTextarea} from './components/ui/input-group';
import {Message,MessageContent,MessageFooter,MessageHeader} from './components/ui/message';
import {Trace,TraceDescription,TraceIcon,TraceLine,TraceTitle} from './components/ui/trace';
import {Skeleton} from './components/ui/skeleton';
type Model={open:boolean;loading:boolean;busy:boolean;error:string;prompt:null|{author:string;question:string;evidence:unknown;evidence_warning?:string;earlier?:boolean};
  voice:string;voices:{name:string}[];task:null|{state:string;commit?:{status:string;error?:string}}};
type Options={getSnapshot():Model;subscribe(fn:()=>void):()=>void;actions:{close():void;generate(regenerate?:boolean):void;voice(value:string):void;write(opening?:string):void;evidence():void}};

// AI Elements composition: the voice's work is a Trace line (Reasoning), its question is a
// Message, and the answer starts in a Prompt Input whose menu picks the voice (Model Selector).
// Sending hands the opening text to an ordinary Scratch draft.
function WritingPrompt({getSnapshot,subscribe,actions}:Options){
  const model=useSyncExternalStore(subscribe,getSnapshot),disabled=model.loading||model.busy;
  const [opening,setOpening]=useState(''),form=useRef<HTMLFormElement>(null);
  const prompt=model.prompt,voice=model.voice||prompt?.author||'';
  return <Dialog open={model.open} onOpenChange={open=>{if(!open)actions.close();}} onOpenChangeComplete={open=>{if(!open&&!getSnapshot().open)(document.querySelector<HTMLElement>('.scratch-editor .cm-content')??document.querySelector<HTMLElement>('#main'))?.focus({preventScroll:true});}}>
    <DialogContent className="reader-quiz-dialog reader-writing-prompt" data-reader-writing-prompt="" finalFocus={false} onKeyDown={event=>event.stopPropagation()}>
      <DialogHeader><DialogTitle>Write about this</DialogTitle><DialogDescription>A voice asks a question. Your answer stays on this device until you save it.</DialogDescription></DialogHeader>
      {model.loading?<Skeleton className="h-24 w-full"/>:<div className="flex flex-col gap-4">
        {model.busy&&<Trace aria-live="polite"><TraceLine status="running" role="status">
          <TraceIcon><LoaderCircleIcon className="animate-spin"/></TraceIcon>
          <TraceTitle>{model.task?.state==='queued'?`Waiting for ${voice||'a voice'}`:`${voice||'A voice'} is thinking of a question`}</TraceTitle>
        </TraceLine></Trace>}
        {model.error&&<Trace><TraceLine status="error" role="alert"><TraceIcon><TriangleAlertIcon/></TraceIcon><TraceTitle>{model.error}</TraceTitle></TraceLine></Trace>}
        {prompt&&!model.busy&&<Message>
          <MessageContent className="gap-2">
            <MessageHeader>{prompt.author}{prompt.earlier?' · earlier edition':''}</MessageHeader>
            <p className="reader-writing-question">{prompt.question}</p>
            {!prompt.evidence&&<Trace><TraceLine><TraceDescription>The question has no verified passage link.</TraceDescription></TraceLine></Trace>}
            <MessageFooter>
              {!!prompt.evidence&&<Button variant="ghost" size="sm" onClick={actions.evidence}><TextQuoteIcon data-icon="inline-start"/>Show me in the text</Button>}
              <Button variant="ghost" size="sm" disabled={disabled||!model.voices.length} onClick={()=>actions.generate(true)}><RefreshCwIcon data-icon="inline-start"/>Ask something else</Button>
            </MessageFooter>
          </MessageContent>
        </Message>}
        {!model.voices.length&&<Notice title="Configure an enabled voice to generate a question.">Existing saved questions remain readable.</Notice>}
        {model.task?.commit?.status==='failed'&&<Notice tone="error" role="alert" title="The question was saved, but its commit failed.">{model.task.commit.error}</Notice>}
        <form ref={form} onSubmit={event=>{event.preventDefault();if(prompt&&!disabled){actions.write(opening);setOpening('');}}}>
          <InputGroup>
            <InputGroupTextarea aria-label="Your answer" placeholder={prompt?'Start your answer. Send it to keep writing in Scratch.':'Your answer goes here once the question arrives.'}
              value={opening} maxLength={64*1024} disabled={!prompt} onChange={event=>setOpening(event.target.value)}
              onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();form.current?.requestSubmit();}}}/>
            <InputGroupAddon align="block-end">
              <DropdownMenu>
                <DropdownMenuTrigger disabled={disabled||!model.voices.length} render={<InputGroupButton size="sm" aria-label={'Question voice: '+(voice||'none')}/>}>
                  {voice||'Choose a voice'}<ChevronDownIcon/>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup><DropdownMenuLabel>Ask me something</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={model.voice} onValueChange={value=>{if(value&&value!==model.voice)actions.voice(String(value));}}>
                      {model.voices.map(v=><DropdownMenuRadioItem key={v.name} value={v.name} closeOnClick>{v.name}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <InputGroupButton type="submit" size="sm" variant="default" className="ml-auto" disabled={disabled||!prompt}>Write a response<ArrowUpIcon/></InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>}
    </DialogContent>
  </Dialog>;
}
export function mountWritingPrompt(options:Options){const element=document.createElement('div');element.dataset.readerDecoration='';document.body.append(element);const root=createRoot(element);root.render(<WritingPrompt {...options}/>);return {destroy(){root.unmount();element.remove();}};}
