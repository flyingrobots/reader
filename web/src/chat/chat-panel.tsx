/* Chat with the voices about the open document: history, streamed turns, @mentions, pasted replies for manual voices, replies and chime-ins. */
import {LogBlock} from '../log-block';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Autocomplete as AutocompletePrimitive, Combobox as ComboboxPrimitive} from '@base-ui/react';
import {ArrowUpIcon, ClipboardPasteIcon, CornerUpLeftIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, SquareIcon, XIcon} from 'lucide-react';
import {Badge} from '../components/ui/badge';
import {Card} from '../components/ui/card';
import {Button} from '../components/ui/button';
import {ButtonGroup} from '../components/ui/button-group';
import {Bubble, BubbleContent} from '../components/ui/bubble';
import {Message, MessageContent, MessageFooter, MessageHeader} from '../components/ui/message';
import {MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport} from '../components/ui/message-scroller';
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea} from '../components/ui/input-group';
import {ComboboxContent, ComboboxEmpty, ComboboxList} from '../components/ui/combobox';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '../components/ui/select';
import {createRawBus, RawOutput, type RawBus} from './raw-output';
import {localOnly, needsReader, NEEDS_READER} from '../static-demo';

const TERMINAL=new Set(['done','failed','timeout','cancelled']);
export type Voice={name:string;mention:string[];enabled:boolean;manual:boolean;available:boolean;runnable:boolean;cli:string|null};
type Turn={id:string;chat_id:string;voice:string;reply_to:string;state:string;message:string;text:string;rev:number;ahead?:number;error?:string|null;retry_of?:string|null;kind?:'turn'|'listen'|'chime_in';root?:string|null;reason?:string|null;
  started_at?:string|null;timeout_seconds?:number|null;log?:string|null};
/** Merge a turn snapshot: the higher revision wins its state, the longer text wins (deltas can be ahead of a snapshot). */
const finished=new Set<string>();
function merge(old:Record<string,Turn>,turns:Turn[]){
  const next={...old};
  for(const turn of turns){const prior=next[turn.id];if(TERMINAL.has(turn.state)||finished.has(turn.id)){delete next[turn.id];continue;}
    const state=prior&&prior.rev>turn.rev?prior:turn;next[turn.id]={...state,text:prior&&(prior.text||'').length>(turn.text||'').length?prior.text:turn.text||''};}
  return next;
}
type ChatMessage={id:string;author:string;body:string;mentions?:string[];reply_to:string|null;created_at:string;chosen_by?:string|null;retry_of?:string;
  routing?:{voices:string[];chosen_by:string|null};
  kind?:'message'|'chime_in'|'hand';reason?:string;state?:'raised'|'accepted'|'declined'|'expired';root?:string;hand_id?:string;
  listening?:{voices:string[];warnings:{voice:string;message:string;changed_paths:string[]}[];
    runs?:{turn_id:string;voice:string;state:string;outcome?:string|null;failure?:string|null;log?:string|null}[]};
  runtime?:{cli?:string;version?:string|null;model?:string|null;manual?:boolean;pasted_by?:string}|null;
  turn?:{id:string;state:string;seconds:number|null;changed_paths:string[];commits:string[];commit:string|null;error?:string;stderr_tail?:string;exit_code?:number|null;
    failure?:string;warning?:string;timeout_seconds?:number|null;log?:string|null}};
type LogUsage={path:string;bytes:number;runs:number;retention:string};
type Chat={id:string;title:string;document_path:string;started_by:string;created_at:string;revision:number;messages:ChatMessage[];settings?:{chime_ins?:ChimeIns}};
type ChimeIns='off'|'hands'|'free';
const CHIME_INS:{value:ChimeIns;label:string}[]=[{value:'off',label:'Chime-ins off'},{value:'hands',label:'Voices raise hands'},{value:'free',label:'Voices speak freely'}];
const HAND_TTL=10*60*1000;
/** A plain one-line excerpt: Markdown emphasis, code and link syntax removed. */
const excerpt=(text:string,size=80)=>{const flat=text.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*_`#>~]+/g,'').replace(/\s+/g,' ').trim();return flat.length>size?flat.slice(0,size)+'…':flat;};
const handOpen=(m:ChatMessage)=>m.state==='raised'&&Date.now()-Date.parse(m.created_at)<HAND_TTL;
const handLabel:Record<string,string>={accepted:'spoke',declined:'not now',expired:'expired',raised:'expired'};
type Summary={id:string;created_at:string;updated_at:string;messages:number;last:{author:string;body:string}|null};
type Commit={status:string;commit:string|null;error?:string};
export type ChatProps={open:boolean;path:string|null;title:string;participant:string;api:(path:string,payload?:unknown)=>Promise<any>;
  markdown:(text:string)=>string;openPath:(path:string)=>void;onClose:()=>void;notify:(message:string,type?:'info'|'success'|'error')=>void};

const uuid=()=>crypto.randomUUID();
const when=(value:string)=>{try{return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}catch{return value;}};
const stateLabel=(turn:Turn)=>turn.state==='queued'?(turn.ahead?`Queued (${turn.ahead} ahead)`:'Queued'):turn.state==='waiting'?turn.message:turn.state==='running'?'Thinking…':turn.message;
type RawProps={chatId:string;api:(path:string,payload?:unknown)=>Promise<any>;bus:RawBus;openRaw:Set<string>;setRaw:(turnId:string,open:boolean)=>void};
const failedLabel:Record<string,string>={failed:'Failed',timeout:'Timed out',cancelled:'Cancelled'};
const LISTEN_OUTCOME:Record<string,string>={pass:'passed',hand:'raised a hand',discarded:'discarded (it changed files)'};
/** Why a turn did not finish, in a few words; the full reason follows it. */
const failureLabel:Record<string,string>={exit:'CLI error',unreadable:'Unreadable output',empty:'No output',status:'CLI reported failure','no-reply':'No reply',
  timeout:'Timed out',cancelled:'Cancelled',resource:'Stopped by a resource limit',capacity:'Not started: low disk space',interrupted:'Interrupted'};
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const limit=(seconds?:number|null)=>seconds?(seconds%60===0?`${seconds/60} min`:`${seconds} s`):'';
const bytes=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KiB`:n<1073741824?`${(n/1048576).toFixed(1)} MiB`:`${(n/1073741824).toFixed(2)} GiB`;
/** Elapsed time of a running turn against its timeout, ticking once a second; it stops at the timeout. */
function Elapsed({since,timeout}:{since:string;timeout?:number|null}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const seconds=Math.min(Math.max(0,(now-Date.parse(since))/1000),timeout||Infinity);
  return <span className="chat-elapsed" data-chat-elapsed="" title={timeout?`Stops after ${timeout} s (timeout_seconds in voices.json)`:undefined}>{clock(seconds)}{timeout?` of ${limit(timeout)}`:''}</span>;
}
/** The active `@word` before the caret, if any. */
function mentionAt(text:string,caret:number){const match=/(^|[\s(])@([\w-]{0,40})$/.exec(text.slice(0,caret));return match?{start:caret-match[2].length-1,query:match[2]}:null;}

function runtimeLabel(runtime:ChatMessage['runtime']){
  if(!runtime)return '';const {cli,version,model}=runtime;
  return [version&&cli&&version.toLowerCase().includes(cli.toLowerCase())?version:[cli,version].filter(Boolean).join(' '),model].filter(Boolean).join(' · ');
}
function Markdown({text,markdown}:{text:string;markdown:(text:string)=>string}){
  const html=useMemo(()=>markdown(text),[text,markdown]);
  return <div className="chat-markdown" dangerouslySetInnerHTML={{__html:html}}/>;
}

function Footer({message,retried,onRetry,onReply,openPath,raw}:{message:ChatMessage;retried:boolean;onRetry:()=>void;onReply:(()=>void)|null;openPath:(path:string)=>void;raw:RawProps}){
  const turn=message.turn;
  const reply=onReply?<Button variant="ghost" size="xs" onClick={onReply} data-chat-reply="" title="Reply to this message · r"><CornerUpLeftIcon/>Reply to @{message.author}</Button>:null;
  if(!turn)return reply?<MessageFooter className="chat-footer"><span className="chat-facts">{reply}</span></MessageFooter>:null;
  const failed=turn.state!=='done',listening=message.listening;
  return <MessageFooter className="chat-footer">
    <span className="chat-facts">
      {reply}
      {listening?.voices.length?<span data-chat-listened="" title="These voices were asked whether they had something to add">listened: {listening.voices.join(', ')}</span>:null}
      {failed?<span className="chat-failed" data-chat-state={turn.state} data-chat-failure={turn.failure||''}>{(turn.failure&&failureLabel[turn.failure])||failedLabel[turn.state]||turn.state}</span>:null}
      {turn.seconds!=null?<span title={turn.timeout_seconds?`Timeout: ${turn.timeout_seconds} s (timeout_seconds in voices.json)`:undefined}>{turn.seconds.toFixed(1)} s{turn.timeout_seconds?` of ${limit(turn.timeout_seconds)}`:''}</span>:null}
      {turn.commit?<span title={turn.commits.join('\n')}>commit <code>{turn.commit.slice(0,8)}</code>{turn.commits.length>1?` +${turn.commits.length-1}`:''}</span>:null}
      {turn.changed_paths.length?<span className="chat-changed">changed {turn.changed_paths.map((path,index)=><span key={path}>{index?', ':''}{path.startsWith('library/')?<a href={'#read='+encodeURIComponent(path)} onClick={event=>{event.preventDefault();openPath(path);}}>{path}</a>:<code>{path}</code>}</span>)}</span>:null}
      {failed&&!retried?<Button variant="ghost" size="xs" onClick={onRetry} data-chat-retry=""><RotateCcwIcon/>Retry</Button>:null}
    </span>
    {listening?.warnings.map((warning,index)=><span key={index} className="chat-failed" data-chat-warning="">{warning.message}</span>)}
    {failed&&turn.stderr_tail?<details className="chat-error" data-chat-reason=""><summary>{turn.error||'Details'}</summary><div className="chat-raw-heading">stderr (last lines)</div><LogBlock text={turn.stderr_tail} contentClassName="max-h-40"/></details>
      :failed&&turn.error?<p className="chat-error" data-chat-reason="">{turn.error}</p>:null}
    {!failed&&turn.warning?<p className="chat-warning" data-chat-warning="">{turn.warning}</p>:null}
    <RawOutput chatId={raw.chatId} turnId={turn.id} running={false} open={raw.openRaw.has(turn.id)} onOpenChange={open=>raw.setRaw(turn.id,open)} api={raw.api} bus={raw.bus}/>
    {listening?.runs?.length?<details className="chat-listen-raw" data-chat-listen-raw="" data-reader-decoration=""><summary>Listening checks · raw output ({listening.runs.length})</summary>
      {listening.runs.map(run=><RawOutput key={run.turn_id} chatId={raw.chatId} turnId={run.turn_id} running={false} open={raw.openRaw.has(run.turn_id)} onOpenChange={open=>raw.setRaw(run.turn_id,open)} api={raw.api} bus={raw.bus}
        label={`${run.voice} · ${run.state==='done'?(LISTEN_OUTCOME[run.outcome||'']||run.outcome):(run.failure&&failureLabel[run.failure])||failedLabel[run.state]||run.state}`}/>)}</details>:null}
  </MessageFooter>;
}

export function ChatPanel(props:ChatProps){
  const {open,path,title,participant,api,markdown,openPath,onClose,notify}=props;
  const [voices,setVoices]=useState<Voice[]>([]),[configured,setConfigured]=useState(true);
  const [history,setHistory]=useState<Summary[]>([]),[chat,setChat]=useState<Chat|null>(null);
  const [turns,setTurns]=useState<Record<string,Turn>>({}),[commit,setCommit]=useState<Commit|null>(null);
  const [draft,setDraft]=useState(''),[pasting,setPasting]=useState(false),[pasteText,setPasteText]=useState(''),[pasteVoice,setPasteVoice]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [mention,setMention]=useState<{start:number;query:string}|null>(null);
  const [replyTo,setReplyTo]=useState<ChatMessage|null>(null),[flash,setFlash]=useState<string|null>(null);
  const hushed=useRef(false),raisedBatch=useRef(0),raisedTimer=useRef<number|undefined>(undefined);
  const [logs,setLogs]=useState<LogUsage|null>(null);
  // Another Reader server owns chat for this vault (#20): chats stay readable here, and the composer says why it cannot send.
  const [readOnly,setReadOnly]=useState<string|null>(null);
  const owned=useCallback((data:any)=>{if(data?.owner)setReadOnly(data.owner.writable?null:data.owner.message);},[]);
  const bus=useMemo(()=>createRawBus(),[]);
  const [openRaw,setOpenRaw]=useState<Set<string>>(()=>new Set());
  const setRaw=useCallback((turnId:string,value:boolean)=>setOpenRaw(old=>{const next=new Set(old);if(value)next.add(turnId);else next.delete(turnId);return next;}),[]);
  const requests=useRef<Record<string,string>>({});
  const textarea=useRef<HTMLTextAreaElement>(null);
  // A caret position to restore once the draft it belongs to has rendered (before the next keystroke).
  const caret=useRef<number|null>(null);
  useLayoutEffect(()=>{const element=textarea.current;if(caret.current==null||!element)return;element.setSelectionRange(caret.current,caret.current);caret.current=null;},[draft]);
  const chatRef=useRef<Chat|null>(null);chatRef.current=chat;
  const turnsRef=useRef(turns);turnsRef.current=turns;
  const openRef=useRef(open);openRef.current=open;
  // The stream is lost when it errors and does not reopen, or stays silent past its heartbeat.
  const [lost,setLost]=useState(false),[generation,setGeneration]=useState(0);
  const lostRef=useRef(false);
  // Pressing New chat starts a chat even if the document already has one; otherwise its newest is reused.
  const fresh=useRef(false);
  const fail=useCallback((error:unknown)=>{const message=error instanceof Error?error.message:String(error);
    if(message.startsWith('Another Reader server owns chat'))setReadOnly(message);notify(message,'error');},[notify]);

  // The server's pending turns replace ours: a turn that finished while we were not listening disappears.
  const load=useCallback(async(id:string)=>{const data=await api('/api/chat?id='+encodeURIComponent(id));setChat(data.chat);setVoices(data.voices);setConfigured(data.configured);setCommit(data.commit);setLogs(data.llm_logs||null);owned(data);
    const live=new Set((data.pending as Turn[]).map(t=>t.id));
    setTurns(old=>merge(Object.fromEntries(Object.entries(old).filter(([tid,t])=>t.chat_id===id&&live.has(tid))),data.pending));},[api,owned]);
  // History for this document; the newest chat reopens.
  useEffect(()=>{
    if(!open||!path)return;
    if(chatRef.current&&chatRef.current.document_path===path)return;
    let live=true;setChat(null);setTurns({});setHistory([]);fresh.current=false;
    (async()=>{try{const data=await api('/api/chats?path='+encodeURIComponent(path));if(!live)return;setHistory(data.chats);setVoices(data.voices);setConfigured(data.configured);setLogs(data.llm_logs||null);owned(data);if(data.chats[0])await load(data.chats[0].id);}catch(error){fail(error);}})();
    return ()=>{live=false;};
  },[open,path,api,load,fail]);
  // Keep the history label of the open chat current.
  useEffect(()=>{if(chat)setHistory(old=>old.map(c=>c.id===chat.id?{...c,messages:chat.messages.length}:c));},[chat]);
  const pending=Object.values(turns).filter(t=>!TERMINAL.has(t.state));
  const streaming=!!chat&&(open||pending.length>0);
  // One EventSource per chat, kept while the panel is open or a turn is still pending.
  useEffect(()=>{
    if(!streaming||!chat)return;
    const id=chat.id,source=new EventSource('/api/chat/stream?id='+encodeURIComponent(id));
    let seen=Date.now(),failedAt=0,interval=15;const checked=new Set<string>();
    // Any event proves the stream is alive again; reload what may have been missed meanwhile.
    const parse=(event:Event)=>{seen=Date.now();failedAt=0;
      if(lostRef.current){lostRef.current=false;setLost(false);notify('Reconnected to Reader.','success');load(id).catch(()=>{});}
      return JSON.parse((event as MessageEvent).data);};
    const markLost=()=>{if(lostRef.current)return;lostRef.current=true;setLost(true);
      notify('Lost connection to Reader. A running turn may still finish there; Retry reconnects.','error');};
    // `hello` and `ping` carry the chat's revision and pending turns; reload when this panel disagrees.
    const reconcile=(data:{revision:number|null;pending:string[];interval?:number})=>{
      if(data.interval)interval=data.interval;
      const held=Object.keys(turnsRef.current),local=chatRef.current;
      const stale=(data.revision!=null&&local?.id===id&&data.revision!==local.revision)||held.some(t=>!data.pending.includes(t))||data.pending.some(t=>!turnsRef.current[t]);
      if(stale)load(id).catch(()=>{});
    };
    source.addEventListener('hello',event=>reconcile(parse(event)));
    source.addEventListener('ping',event=>reconcile(parse(event)));
    source.addEventListener('posted',event=>{const data=parse(event);
      setChat(old=>old&&old.id===id&&!old.messages.some(m=>m.id===data.message.id)?{...old,revision:Math.max(old.revision,data.revision),messages:[...old.messages,data.message]}:old);});
    source.onerror=()=>{if(!failedAt)failedAt=Date.now();if(source.readyState===EventSource.CLOSED)markLost();};
    const watchdog=setInterval(()=>{const now=Date.now();
      if((failedAt&&now-failedAt>5000)||now-seen>Math.max(3,interval*2.5)*1000)markLost();
      // A running turn well past its timeout: ask the server what became of it.
      for(const turn of Object.values(turnsRef.current))
        if(turn.state==='running'&&turn.started_at&&turn.timeout_seconds&&!checked.has(turn.id)&&now-Date.parse(turn.started_at)>(turn.timeout_seconds+interval*2)*1000){
          checked.add(turn.id);load(id).catch(markLost);}
    },1000);
    source.addEventListener('state',event=>{const turn:Turn=parse(event);setTurns(old=>merge(old,[turn]));});
    // A delta past the text we hold means we missed some; resynchronize from the server.
    let resync=false;
    source.addEventListener('delta',event=>{const delta=parse(event);let gap=false;
      setTurns(old=>{const turn=old[delta.turn_id];if(!turn||(turn.text||'').length<delta.offset){gap=true;return old;}return {...old,[turn.id]:{...turn,text:turn.text.slice(0,delta.offset)+delta.text}};});
      if(gap&&!resync){resync=true;load(id).catch(()=>{}).finally(()=>{resync=false;});}});
    source.addEventListener('raw',event=>bus.publish(parse(event)));
    source.addEventListener('started',event=>{const data=parse(event);notify(`${data.voice} is replying…`);});
    source.addEventListener('done',event=>{const data=parse(event);if(data.llm_logs)setLogs(data.llm_logs);
      finished.add(data.turn_id);setTurns(old=>{const next={...old};delete next[data.turn_id];return next;});
      if(data.message)setChat(old=>old&&old.id===id&&!old.messages.some(m=>m.id===data.message.id)?{...old,revision:data.revision??old.revision,messages:[...old.messages,data.message]}:old);
      const message:ChatMessage|null=data.message;
      if(message&&message.turn?.state==='done'){if(!openRef.current)notify(`${message.author} replied`,'success');if(message.turn.changed_paths.length)notify(`${message.author} changed ${message.turn.changed_paths.length} file${message.turn.changed_paths.length>1?'s':''}: ${message.turn.changed_paths.slice(0,3).join(', ')}`);}
      else if(message)notify(`${message.author}: ${failedLabel[message.turn?.state||'failed']||'Failed'}${message.turn?.error?' — '+message.turn.error:''}`,'error');
    });
    // Hands, listening notes and expiries arrive as message upserts.
    source.addEventListener('message',event=>{const data=parse(event),message:ChatMessage=data.message;
      setChat(old=>{if(!old||old.id!==id)return old;const at=old.messages.findIndex(m=>m.id===message.id);
        const messages=at<0?[...old.messages,message]:old.messages.map((m,i)=>i===at?message:m);return {...old,revision:data.revision??old.revision,messages};});
      if(data.hand&&message.state==='raised'){raisedBatch.current++;clearTimeout(raisedTimer.current);
        raisedTimer.current=window.setTimeout(()=>{const n=raisedBatch.current;raisedBatch.current=0;notify(`✋ ${n} voice${n>1?'s have':' has'} something to add`);},700);}});
    source.addEventListener('warning',event=>{const data=parse(event);notify(data.message,'error');});
    source.addEventListener('commit',event=>{const data:Commit=parse(event);setCommit(data);if(data.status==='failed')notify('Couldn’t commit the chat: '+(data.error||'unknown error'),'error');});
    return ()=>{clearInterval(watchdog);source.close();lostRef.current=false;setLost(false);};
  },[streaming,chat?.id,notify,load,bus,generation]);
  const reconnect=()=>{setGeneration(g=>g+1);if(chatRef.current)load(chatRef.current.id).catch(()=>{});};

  const runnable=voices.filter(v=>v.runnable),mentionable=voices.filter(v=>v.enabled);
  // Manual voices (`"cli": null` in voices.json) answer by paste; the paste control names the one chosen.
  const manual=voices.filter(v=>v.manual),pasteName=manual.find(v=>v.name===pasteVoice)?.name??manual[0]?.name??null;
  const listening=pending.filter(t=>t.kind==='listen'),speaking=pending.filter(t=>t.kind!=='listen');
  const chimeIns:ChimeIns=chat?.settings?.chime_ins||'hands';
  const byId=useMemo(()=>new Map((chat?.messages||[]).map(m=>[m.id,m])),[chat]);
  const items=mention?mentionable.filter(v=>[v.name,...v.mention].some(n=>n.toLowerCase().startsWith(mention.query.toLowerCase()))):[];
  const retried=new Set([...(chat?.messages||[]).map(m=>m.retry_of).filter(Boolean),...Object.values(turns).map(t=>t.retry_of).filter(Boolean)] as string[]);
  const ensureChat=async()=>{if(chatRef.current)return chatRef.current;const key='create:'+path;requests.current[key]||=uuid();
    // Another tab may have started this document's chat meanwhile: reuse it unless New chat was pressed.
    const data=await api('/api/chat',{action:'create',path,participant,request_id:requests.current[key],reuse:!fresh.current});delete requests.current[key];fresh.current=false;
    setChat(data.chat);setVoices(data.voices);owned(data);setTurns(old=>merge(old,data.pending||[]));
    setHistory(old=>[{id:data.chat.id,created_at:data.chat.created_at,updated_at:data.chat.created_at,messages:data.chat.messages.length,last:null},...old.filter(c=>c.id!==data.chat.id)]);chatRef.current=data.chat;return data.chat as Chat;};
  const post=async(action:'send'|'paste',body:string)=>{
    if(!body.trim()||busy)return false;setBusy(true);
    try{const current=await ensureChat(),key=action+':'+current.id+':'+body;requests.current[key]||=uuid();
      const reply=action==='send'&&replyTo&&replyTo.id&&current.messages.some(m=>m.id===replyTo.id)?replyTo.id:undefined;
      const data=await api('/api/chat',{action,id:current.id,body,participant,request_id:requests.current[key],...(reply?{reply_to:reply}:{}),...(action==='paste'&&pasteName?{voice:pasteName}:{})});delete requests.current[key];
      setChat(data.chat);owned(data);setTurns(old=>merge(old,data.pending));if(action==='send')setReplyTo(null);hushed.current=false;
      const routing=data.message?.routing;
      if(action==='send'&&!data.turns.length){const named=(data.message?.mentions||[]) as string[];
        const pasted=manual.find(v=>named.includes(v.name))?.name;
        notify(pasted?`${pasted} answers by paste: use “Paste ${pasted}’s reply”.`:runnable.length?'No enabled voice was mentioned.':'No voices are configured for chat; add voices.json to the vault.');}
      else if(routing?.chosen_by==='random')notify(`${routing.voices[0]} was chosen at random to answer.`);
      return true;
    }catch(error){fail(error);return false;}finally{setBusy(false);}
  };
  // The web demo's one chat switch (#108): the shim's serves.chat turns the composer on.
  const offline=needsReader('chat');
  const send=async()=>{if(offline)return;if(await post('send',draft)){setDraft('');setMention(null);}};
  const paste=async()=>{if(await post('paste',pasteText)){setPasteText('');setPasting(false);}};
  const cancel=async(turn:Turn)=>{try{await api('/api/chat',{action:'cancel',turn_id:turn.id,id:turn.chat_id});}catch(error){fail(error);}};
  const retry=async(message:ChatMessage)=>{if(!chat)return;try{const data=await api('/api/chat',{action:'retry',id:chat.id,message_id:message.id});setChat(data.chat);setTurns(old=>merge(old,data.pending));}catch(error){fail(error);}};
  const choose=(voice:Voice|null)=>{
    const element=textarea.current;if(!voice||!mention||!element)return;
    const alias=voice.mention[0]||voice.name,at=element.selectionStart??draft.length;
    const next=draft.slice(0,mention.start)+'@'+alias+' '+draft.slice(at);setDraft(next);setMention(null);
    caret.current=mention.start+alias.length+2;element.focus();
  };
  const track=(text:string,caret:number)=>{setDraft(text);setMention(mentionAt(text,caret));
    // Typing stops pending listening checks; raised hands stay.
    if(text&&listening.length&&chat&&!hushed.current){hushed.current=true;api('/api/chat',{action:'hush',id:chat.id}).catch(()=>{});}};
  const aliasOf=(name:string)=>{const voice=voices.find(v=>v.name===name);return voice?.mention[0]||name.split(/\s+/).pop()||name;};
  const reply=(message:ChatMessage)=>{
    const alias=aliasOf(message.author),rest=draft.replace(/^\s*@[\w-]+\s*/,''),next='@'+alias+' '+rest;
    setDraft(next);setMention(null);setReplyTo(message);caret.current=alias.length+2;textarea.current?.focus();
    if(next===draft){textarea.current?.setSelectionRange(alias.length+2,alias.length+2);caret.current=null;}
  };
  const jump=(id:string)=>{const element=document.querySelector(`#chat-panel [data-chat-message="${CSS.escape(id)}"]`);if(!element)return;
    element.scrollIntoView({block:'center',behavior:'auto'});setFlash(id);window.setTimeout(()=>setFlash(value=>value===id?null:value),1600);};
  const decide=async(hand:ChatMessage,decision:'accept'|'decline')=>{if(!chat)return;
    try{const data=await api('/api/chat',{action:'hand',id:chat.id,message_id:hand.id,decision});setChat(data.chat);setTurns(old=>merge(old,data.pending));}catch(error){fail(error);}};
  const configure=async(value:ChimeIns)=>{try{const current=await ensureChat();const data=await api('/api/chat',{action:'settings',id:current.id,chime_ins:value});setChat(data.chat);}catch(error){fail(error);}};
  const isVoice=(m:ChatMessage)=>!!m.turn||!!m.runtime?.manual;
  const isMine=(m:ChatMessage)=>!m.turn&&!m.runtime?.manual;

  return <aside id="chat-panel" className="chat-panel" hidden={!open} aria-labelledby="chat-title" data-reader-decoration="">
    <div className="chat-top">
      <div className="chat-heading"><div className="eyebrow">Chat with the voices</div><h2 id="chat-title" title={title}>{title||'This document'}</h2></div>
      <ButtonGroup>
        <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={()=>{fresh.current=true;setChat(null);setTurns({});setCommit(null);setReplyTo(null);textarea.current?.focus();}}><PlusIcon/></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close chat" onClick={onClose} id="chat-close"><XIcon/></Button>
      </ButtonGroup>
    </div>
    <div className="chat-settings"><Select items={CHIME_INS} value={chimeIns} disabled={offline} onValueChange={value=>{if(value&&value!==chimeIns)configure(value as ChimeIns);}}>
      <SelectTrigger id="chat-chime-ins" size="sm" aria-label="When voices who were not addressed may chime in" title={offline?NEEDS_READER:'After an addressed reply, the other voices are asked whether they have something to add'}><SelectValue/></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}><SelectGroup>{CHIME_INS.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
    {history.length>0?<div className="chat-history"><Select items={history.map(c=>({value:c.id,label:`${when(c.created_at)} · ${c.messages} messages`}))} value={chat?.id??null} onValueChange={value=>{if(value)load(value).catch(fail);}}>
      <SelectTrigger id="chat-history" size="sm" className="w-full" aria-label="Earlier chats about this document"><SelectValue placeholder="New chat"/></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}><SelectGroup>{history.map(c=><SelectItem key={c.id} value={c.id}>{when(c.created_at)} · {c.messages} messages{c.last?` · ${c.last.author}`:''}</SelectItem>)}</SelectGroup></SelectContent></Select></div>:null}
    <MessageScrollerProvider>
      <MessageScroller className="chat-scroller">
        <MessageScrollerViewport>
          <MessageScrollerContent className="chat-messages" aria-live="polite">
            {!chat?.messages.length&&!pending.length?<p className="chat-empty">{configured?<>Ask about this document. <kbd>@</kbd> chooses who answers{runnable.length?<>: {runnable.map(v=>'@'+(v.mention[0]||v.name)).join(', ')}</>:null}. Without a mention, one voice is chosen at random.</>:<>No voices are configured for chat. Add <code>voices.json</code> to the vault to run them.</>}</p>:null}
            {chat?.messages.map(message=>message.kind==='hand'?<MessageScrollerItem key={message.id}>
              <Card size="sm" className="chat-hand" data-chat-hand={message.id} data-author={message.author} data-hand-state={handOpen(message)?'raised':message.state}>
                <p>✋ <strong>{message.author}</strong> has something to add: {message.reason}</p>
                {handOpen(message)?<ButtonGroup><Button size="xs" onClick={()=>decide(message,'accept')} data-chat-hand-accept="">Let them speak</Button><Button variant="ghost" size="xs" onClick={()=>decide(message,'decline')} data-chat-hand-decline="">Not now</Button></ButtonGroup>
                  :<span className="chat-hand-state">{handLabel[message.state||'expired']}</span>}
              </Card>
            </MessageScrollerItem>:<MessageScrollerItem key={message.id} scrollAnchor={isMine(message)}>
              <Message align={isMine(message)?'end':'start'} data-chat-message={message.id} data-author={message.author} data-chat-state={message.turn?.state} data-chat-kind={message.kind||'message'}
                data-chat-flash={flash===message.id?'':undefined} tabIndex={isVoice(message)?0:undefined}
                onKeyDown={event=>{if(event.key==='r'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&isVoice(message)&&event.target===event.currentTarget){event.preventDefault();reply(message);}}}>
                <MessageContent>
                  <MessageHeader className="chat-author"><span>{message.author}</span><span className="chat-runtime">{message.kind==='chime_in'?<Badge variant="secondary" className="chat-chimed" title={message.reason?'Raised a hand: '+message.reason:undefined}>chimed in</Badge>:null}{message.runtime?.manual?'pasted by hand':runtimeLabel(message.runtime)}{message.chosen_by==='random'?' · chosen at random':''}</span></MessageHeader>
                  {message.reply_to&&isMine(message)&&byId.get(message.reply_to)?<button type="button" className="chat-quote" data-chat-quote={message.reply_to} onClick={()=>jump(message.reply_to!)} title="Show the message this replies to">
                    <span>{byId.get(message.reply_to)!.author}</span> {excerpt(byId.get(message.reply_to)!.body)}</button>:null}
                  {message.body?<Bubble variant={isMine(message)?'default':message.turn&&message.turn.state!=='done'?'destructive':'muted'} align={isMine(message)?'end':'start'}><BubbleContent><Markdown text={message.body} markdown={markdown}/></BubbleContent></Bubble>:null}
                  <Footer message={message} retried={retried.has(message.id)} onRetry={()=>retry(message)} onReply={isVoice(message)?()=>reply(message):null} openPath={openPath} raw={{chatId:chat.id,api,bus,openRaw,setRaw}}/>
                </MessageContent>
              </Message>
            </MessageScrollerItem>)}
            {speaking.map(turn=><MessageScrollerItem key={turn.id}>
              <Message align="start" data-chat-turn={turn.id} data-turn-state={turn.state} data-author={turn.voice}>
                <MessageContent>
                  <MessageHeader className="chat-author"><span>{turn.voice}</span><span className="chat-runtime chat-turn-state" role="status">{lost?<span data-chat-lost="">Lost connection to Reader</span>:<>{turn.kind==='chime_in'?'Chiming in · ':''}{stateLabel(turn)}{turn.state==='running'&&turn.started_at?<> <Elapsed since={turn.started_at} timeout={turn.timeout_seconds}/></>:null}</>}</span></MessageHeader>
                  {turn.text?<Bubble variant="muted"><BubbleContent><Markdown text={turn.text} markdown={markdown}/></BubbleContent></Bubble>:null}
                  <MessageFooter className="chat-footer">{lost?<Button variant="ghost" size="xs" onClick={reconnect} data-chat-reconnect=""><RefreshCwIcon/>Retry</Button>:null}<Button variant="ghost" size="xs" onClick={()=>cancel(turn)} data-chat-cancel=""><SquareIcon/>Cancel</Button>
                    {turn.state==='running'&&chat?<RawOutput chatId={chat.id} turnId={turn.id} running open={openRaw.has(turn.id)} onOpenChange={open=>setRaw(turn.id,open)} api={api} bus={bus}/>:null}</MessageFooter>
                </MessageContent>
              </Message>
            </MessageScrollerItem>)}
            {listening.length?<p className="chat-listening" data-chat-listening="" role="status">Listening: {listening.map(t=>t.voice).join(', ')}… <span>typing stops it</span></p>:null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton/>
      </MessageScroller>
    </MessageScrollerProvider>
    {commit?.status==='failed'?<p className="chat-commit-error" role="status">The last change to this chat isn’t committed: {commit.error}</p>:null}
    {pasting&&pasteName?<form className="chat-paste" onSubmit={event=>{event.preventDefault();paste();}}>
      {manual.length>1?<Select items={manual.map(v=>({value:v.name,label:v.name}))} value={pasteName} onValueChange={value=>{if(value)setPasteVoice(value as string);}}>
        <SelectTrigger id="chat-paste-voice" size="sm" aria-label="Whose reply you are pasting"><SelectValue/></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}><SelectGroup>{manual.map(v=><SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectGroup></SelectContent></Select>:null}
      <label htmlFor="chat-paste-body">{pasteName}’s reply, pasted by hand</label>
      <InputGroup><InputGroupTextarea id="chat-paste-body" rows={4} maxLength={65536} value={pasteText} onChange={event=>setPasteText(event.target.value)} placeholder={`Paste ${pasteName}’s reply…`}/>
        <InputGroupAddon align="block-end"><InputGroupButton variant="ghost" size="xs" onClick={()=>{setPasting(false);setPasteText('');}}>Cancel</InputGroupButton><InputGroupButton type="submit" variant="default" size="xs" className="ml-auto" disabled={!pasteText.trim()||busy}>Save as {pasteName}</InputGroupButton></InputGroupAddon></InputGroup>
    </form>:null}
    {replyTo?<div className="chat-replying" data-chat-replying={replyTo.id}>
      <span><CornerUpLeftIcon/>Replying to {replyTo.author} · “{excerpt(replyTo.body)}”{replyTo.runtime?.manual?<em> {replyTo.author} answers by paste: use “Paste {manual.length>1?'a':replyTo.author+'’s'} reply” for the answer.</em>:null}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Cancel the reply" onClick={()=>setReplyTo(null)} data-chat-reply-cancel=""><XIcon/></Button></div>:null}
    {readOnly?<p className="chat-read-only" role="status" data-chat-read-only="">{readOnly}</p>:null}
    <form className="chat-composer" onSubmit={event=>{event.preventDefault();send();}}>
      {/* Base UI Autocomplete is the free-text member of the Combobox family: the textarea keeps the whole message. */}
      <AutocompletePrimitive.Root<Voice> items={items} filteredItems={items} filter={null} mode="none" open={!!mention&&items.length>0} onOpenChange={value=>{if(!value)setMention(null);}}
        value={draft} onValueChange={(value,details)=>{if(details.reason==='item-press'){choose(items.find(v=>v.name===value)||null);return;}if(details.reason==='input-change'){const element=textarea.current;track(value,element?.selectionStart??value.length);}}}
        itemToStringValue={voice=>voice.name} autoHighlight>
        <InputGroup className="chat-input">
          <ComboboxPrimitive.Input render={<InputGroupTextarea ref={textarea} id="chat-input" rows={2} maxLength={65536} placeholder={offline?'Chat needs Reader on your computer, where the voices run.':'Message the voices… @ to mention'} aria-label="Message the voices" disabled={offline} title={offline?NEEDS_READER:undefined}/>}
            onKeyDown={event=>{
              if(event.key==='Escape'&&mention){event.preventDefault();setMention(null);return;}
              if(event.key==='Enter'&&!event.shiftKey&&!(mention&&items.length)&&!event.nativeEvent.isComposing){event.preventDefault();send();}
            }}
            onSelect={event=>{const element=event.currentTarget as unknown as HTMLTextAreaElement;setMention(mentionAt(element.value,element.selectionStart??element.value.length));}}/>
          <InputGroupAddon align="block-end">
            {pasteName&&!offline?<InputGroupButton variant="ghost" size="xs" onClick={()=>setPasting(value=>!value)} aria-pressed={pasting} id="chat-paste-toggle"><ClipboardPasteIcon/>{manual.length>1?'Paste a reply':`Paste ${pasteName}’s reply`}</InputGroupButton>:null}
            <InputGroupButton type="submit" variant="default" size="icon-xs" className="ml-auto" aria-label="Send" disabled={!draft.trim()||busy} {...localOnly('chat')} id="chat-send"><ArrowUpIcon/></InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <ComboboxContent className="chat-mentions" side="top" align="start" anchor={textarea}>
          <ComboboxEmpty>No voice by that name</ComboboxEmpty>
          <ComboboxList>{(voice:Voice)=><AutocompletePrimitive.Item key={voice.name} value={voice} data-slot="combobox-item" className="relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"><span>@{voice.mention[0]||voice.name}</span><span className="chat-mention-name">{voice.name}{voice.manual?' · paste':voice.runnable?'':' · unavailable'}</span></AutocompletePrimitive.Item>}</ComboboxList>
        </ComboboxContent>
      </AutocompletePrimitive.Root>
    </form>
    <p className="chat-privacy">Each turn sends this document, the chat and anything the voice reads to that voice’s provider. Voices act with their normal authority in the vault; chats are committed.
      {logs?<> Every run’s raw output is kept in <code>{logs.path}</code> (<span data-chat-log-usage="">{bytes(logs.bytes)}, {logs.runs} run{logs.runs===1?'':'s'}</span>) and never expires.</>:null}</p>
  </aside>;
}
