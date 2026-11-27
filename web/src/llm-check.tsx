/* Ephemeral provider chat. The API owns startup and GPU admission; polling displays bounded output. */
import {useEffect, useRef, useState} from 'react';
import {Button} from './components/ui/button';
import {Bubble, BubbleContent} from './components/ui/bubble';
import {Message, MessageContent, MessageGroup, MessageHeader} from './components/ui/message';
import {InputGroup, InputGroupTextarea} from './components/ui/input-group';
import {CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle} from './components/ui/code-block';
import {Field, FieldLabel} from './components/ui/field';
import {Notice} from './theme/molecules/notice';
import {StatusCard} from './theme/organisms/status-card';
import type {Provider} from './local-model';

type Api=(path:string,payload?:unknown)=>Promise<any>;
type Turn={role:'user'|'assistant';content:string};
type Result={state:string;text?:string;reasoning?:string;output?:string;error?:string};

export function LLMCheckCard({api,provider}:{api:Api;provider:Provider}){
  const [messages,setMessages]=useState<Turn[]>([]),[prompt,setPrompt]=useState(''),[result,setResult]=useState<Result>({state:'idle'});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef<string|null>(null);
  useEffect(()=>()=>{active.current=null;},[]);
  const send=async()=>{
    if(busy||!prompt.trim())return;
    const id=crypto.randomUUID(), next:Turn[]=[...messages,{role:'user',content:prompt.trim()}];
    active.current=id;setBusy(true);setError('');setResult({state:'running'});
    // Schedule after each read so a slow connection cannot accumulate polling requests.
    let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      if(active.current!==id)return;
      try{const view=await api('api/llm-check?id='+id);if(active.current===id&&view.state!=='idle')setResult(view);}
      catch{/* The POST reports a transport error; polling is only a preview. */}
      if(active.current===id)timer=setTimeout(poll,500);
    };
    timer=setTimeout(poll,500);
    try{
      const view:Result=await api('api/llm-check',{id,model:provider.model,base_url:provider.base_url,messages:next});
      if(active.current!==id)return;
      setResult(view);
      if(view.state==='succeeded'&&view.text){setMessages([...next,{role:'assistant',content:view.text}]);setPrompt('');}
      else setError(view.error||'The model returned no answer.');
    }catch(e){if(active.current===id)setError((e as Error).message);}
    finally{clearTimeout(timer);if(active.current===id){active.current=null;setBusy(false);}}
  };
  return <StatusCard title="LLM Sanity Check" data-lm="sanity-check" description={`Chat with ${provider.model} through ${provider.label}. Save provider changes above before testing. This chat stays in memory.`}>
    <div className="flex flex-col gap-4">
      {provider.remote_notice?<Notice tone="info">{provider.remote_notice}</Notice>:null}
      <MessageGroup className="max-h-80 overflow-y-auto" aria-label="Sanity check conversation">
        {messages.map((message,index)=><Message key={index} align={message.role==='user'?'end':'start'}><MessageContent>
          <MessageHeader>{message.role==='user'?'You':provider.model}</MessageHeader>
          <Bubble variant={message.role==='user'?'default':'secondary'}><BubbleContent className="whitespace-pre-wrap">{message.content}</BubbleContent></Bubble>
        </MessageContent></Message>)}
        {busy&&result.text?<Message><MessageContent><MessageHeader>{provider.model}</MessageHeader><Bubble variant="secondary"><BubbleContent className="whitespace-pre-wrap">{result.text}</BubbleContent></Bubble></MessageContent></Message>:null}
      </MessageGroup>
      <form onSubmit={e=>{e.preventDefault();void send();}} className="flex flex-col gap-3">
        <Field><FieldLabel htmlFor="llm-check-prompt">Message</FieldLabel><InputGroup><InputGroupTextarea id="llm-check-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={busy} maxLength={24000} placeholder="Say hello or ask a quick question…"/></InputGroup></Field>
        <div className="flex gap-2"><Button type="submit" disabled={busy||!prompt.trim()}>{busy?'Checking…':'Send to selected LLM'}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={()=>{setMessages([]);setResult({state:'idle'});setError('');}}>New chat</Button></div>
      </form>
      {error?<Notice tone="error" role="alert">{error} Check the startup settings below if the server is unavailable.</Notice>:null}
      <CodeBlock><CodeBlockHeader><CodeBlockTitle>LLM output</CodeBlockTitle></CodeBlockHeader><CodeBlockContent className="max-h-64 overflow-auto whitespace-pre-wrap" data-lm="sanity-output">{[result.output,result.reasoning&&'Reasoning:\n'+result.reasoning,result.text&&'Response:\n'+result.text].filter(Boolean).join('\n')||'Startup diagnostics and model output appear here.'}</CodeBlockContent></CodeBlock>
      <p className="text-sm text-muted-foreground">Startup uses the separately saved command below. Startup output appears when the command finishes; model output streams while it answers.</p>
    </div>
  </StatusCard>;
}
