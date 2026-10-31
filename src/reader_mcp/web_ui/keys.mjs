/** One keymap for the whole page: a table of bindings, a sequence parser (counts, "a registers,
 *  multi-key sequences, a–z arguments), a mode stack, the `:` command line and the generated help.
 *  Features add keys with map() and commands with command(); nothing else listens for page keys. */
import {escapeHTML as esc} from './logic.mjs';

const byId=id=>globalThis.document?.getElementById(id)||null;
const NAMED={' ':'<Space>',Enter:'<CR>',Tab:'<Tab>',Escape:'<Esc>',ArrowDown:'<Down>',ArrowUp:'<Up>',ArrowLeft:'<Left>',ArrowRight:'<Right>',Home:'<Home>',End:'<End>',PageDown:'<PageDown>',PageUp:'<PageUp>',Backspace:'<BS>',Delete:'<Del>'};
/** The token for a keydown: a printable character, or a <Name> such as <Space>, <CR>, <C-d>, <F10>. */
export function keyToken(event){
  const key=event.key;let token=NAMED[key]||(key.length===1?key:/^F\d{1,2}$/.test(key)?`<${key}>`:null);
  if(!token)return null;
  if(event.ctrlKey)token=key.length===1?`<C-${key.toLowerCase()}>`:`<C-${token.slice(1,-1)}>`;
  return token;
}
const PLACEHOLDERS={'{a-z}':/^[a-z]$/,'{register}':/^[a-z"]$/,'{mark}':/^[a-z']$/};
/** '<Space>,t' → ['<Space>', ',', 't']; '{a-z}' is one argument slot. */
export function parseKeys(text){
  const tokens=[];for(let i=0;i<text.length;){
    if(text[i]==='<'){const end=text.indexOf('>',i);if(end>i+1){tokens.push(text.slice(i,end+1));i=end+1;continue;}}
    if(text[i]==='{'){const end=text.indexOf('}',i);if(end>i&&PLACEHOLDERS[text.slice(i,end+1)]){tokens.push(text.slice(i,end+1));i=end+1;continue;}}
    tokens.push(text[i]);i++;
  }
  return tokens;
}
/** How a binding's tokens relate to typed ones: 'exact', 'prefix' (more keys needed) or null; with any argument characters. */
export function matchKeys(tokens,typed){
  if(typed.length>tokens.length)return null;const args=[];
  for(let i=0;i<typed.length;i++){const want=tokens[i],pattern=PLACEHOLDERS[want];
    if(pattern){if(!pattern.test(typed[i]))return null;args.push(typed[i]);}else if(want!==typed[i])return null;}
  return {kind:typed.length===tokens.length?'exact':'prefix',args};
}
const LABELS={'<Space>':'Space','<CR>':'Enter','<Esc>':'Escape','<Tab>':'Tab','<Down>':'↓','<Up>':'↑','<Left>':'←','<Right>':'→','{a-z}':'a–z','{register}':'a–z','{mark}':'a–z'};
/** Readable key names for the help and hints: <C-d> → Ctrl d. */
export function keyLabel(token){if(LABELS[token])return LABELS[token];const ctrl=token.match(/^<C-(.+)>$/);if(ctrl)return 'Ctrl '+(LABELS['<'+ctrl[1]+'>']||ctrl[1]);return token.replace(/^<(.+)>$/,'$1');}
/** Help text is plain; `x` marks a key. */
const richHelp=text=>esc(text).replace(/`([^`]+)`/g,'<kbd>$1</kbd>');
const kbd=tokens=>tokens.map(t=>`<kbd>${esc(keyLabel(t))}</kbd>`).join(' ');
/** Closest command name for a typo: edit distance, preferring shared prefixes. */
export function closest(word,names){
  const distance=(a,b)=>{const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const saved=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=saved;}}return row[b.length];};
  let best=null,score=Infinity;for(const name of names){const d=distance(word,name)-(name.startsWith(word.slice(0,2))?.5:0);if(d<score){score=d;best=name;}}
  return score<=Math.max(2,word.length/2)?best:null;
}
export const LIMITS={sequenceMs:650,leaderMs:1200,history:100,count:9999};

/**
 * Create the keymap. Options:
 *  - guard(event): true when page keys must not run (typing, dialogs not owned by a mode);
 *  - escape(event): the page's Escape once no mode or pending keys are left to cancel;
 *  - changed(): called when the mode, pending keys or table change (updates the status line);
 *  - notify(message, type): toasts for the command line.
 */
export function createKeys({guard=()=>false,escape=()=>{},changed=()=>{},notify=()=>{},storage=globalThis.localStorage}={}){
  const table=[],commands=[],modes=new Map(),before=[],groups=new Map(),prefixes=new Map();
  const stack=['normal'];let sectionOrder=[];let pending=[],count='',register=null,timer=0;
  const mode=()=>stack.at(-1);
  const emit=()=>{changed();renderPending();};
  /** Add bindings: {mode:'normal'|'visual'|[…], keys:'gg', when?, run({count,register,args,event}), help?, hint?, group?, display?, global?}.
   *  run() returning false declines the key so the next matching binding (or the browser) gets it.
   *  Entries without run() document keys that a panel handles itself (they appear in the help only). Returns an unmap function. */
  function map(...entries){
    const added=entries.flat().map(entry=>({...entry,modes:[].concat(entry.mode||'normal'),tokens:parseKeys(entry.keys||'')}));
    table.push(...added);scheduleHelp();emit();
    return ()=>{for(const entry of added){const i=table.indexOf(entry);if(i>=0)table.splice(i,1);}scheduleHelp();};
  }
  /** Name a key prefix for the leader hints, e.g. group('<Space>,','more'). */
  function group(prefix,hint){groups.set(prefix,hint);}
  /** A key that starts a family like the leader does, e.g. prefix('<C-w>',{label:'WINDOW',ms:1500}): while it waits, the
   *  status line shows the label and the family's hints, and an unknown next key is swallowed. */
  function prefix(token,{label,ms=LIMITS.leaderMs}={}){prefixes.set(token,{label,ms});}
  const leads=token=>token==='<Space>'||prefixes.has(token);
  /** Register a mode beyond NORMAL: {label(), hints(), escape()}; enter() pushes it, leave() pops it. */
  function defineMode(name,spec){modes.set(name,spec);}
  function enter(name){if(mode()!==name)stack.push(name);clearPending();emit();}
  function leave(name){const i=stack.lastIndexOf(name);if(i>0)stack.splice(i);clearPending();emit();}
  const live=(entry,event)=>entry.run&&(!entry.when||entry.when(event));
  function clearPending(){clearTimeout(timer);timer=0;pending=[];count='';register=null;lapsed=null;}
  // A sequence the timer gave up on, and until when its next key still counts. The timer can run late, after a key that
  // was typed in time but is still queued behind a busy page; that key's own timestamp decides, not when it is handled.
  let lapsed=null;
  function call(entry,args,event){
    const context={count:count?Math.min(LIMITS.count,+count):0,register,args,event,keys:api};
    clearPending();
    const result=entry.run(context);
    if(result&&typeof result.catch==='function')result.catch(error=>{console.error(error);notify(error.message||String(error),'error');});
    return result!==false;
  }
  /** Run the first live exact binding that does not decline; true when one ran. */
  function runExact(list,event){for(const {entry,args} of list)if(call(entry,args,event))return true;return false;}
  function candidates(typed,event){
    const out=[];for(const entry of table){if(!entry.modes.includes(mode())||entry.global||!live(entry,event))continue;const m=matchKeys(entry.tokens,typed);if(m)out.push({entry,...m});}
    return out;
  }
  /** Feed one key token; returns true when the keymap used it. */
  function feed(token,event){
    const counting=mode()==='normal'||mode()==='visual';
    if(!pending.length&&counting){
      // "a names the register for the next action; an invalid name cancels it.
      if(register===''){register=/^[a-z"]$/.test(token)?token:null;emit();return true;}
      if(token==='"'&&register===null){register='';emit();return true;}
      if(/^[1-9]$/.test(token)||count&&/^[0-9]$/.test(token)){count+=token;emit();return true;}
    }
    if(!pending.length&&token===','&&mode()==='normal')token='<Space>';
    if(!pending.length&&lapsed&&Number.isFinite(event?.timeStamp)&&event.timeStamp<=lapsed.until)({keys:pending,count,register}=lapsed);
    lapsed=null;
    const typed=[...pending,token],found=candidates(typed,event);
    const exact=found.filter(c=>c.kind==='exact'),longer=found.filter(c=>c.kind==='prefix');
    if(!found.length){
      const leader=leads(pending[0]);const had=pending.length;clearPending();emit();
      if(leader)return true;  // An unknown key after the leader is swallowed, never typed into the page.
      return had?feed(token,event):false;
    }
    if(exact.length&&!longer.length){const ran=runExact(exact,event);emit();if(!ran&&typed.length===1)return false;return true;}
    pending=typed;clearTimeout(timer);
    const ms=pending[0]==='<Space>'?LIMITS.leaderMs:prefixes.get(pending[0])?.ms??LIMITS.sequenceMs,until=Number.isFinite(event?.timeStamp)?event.timeStamp+ms:-Infinity;
    timer=setTimeout(()=>{timer=0;const waiting=candidates(pending,event).filter(c=>c.kind==='exact');
      if(waiting.length)runExact(waiting,event);else{const kept={keys:pending,count,register,until};clearPending();lapsed=kept;}emit();},ms);
    emit();return true;
  }
  /** The page's keydown listener. */
  function handle(event){
    if(event.isComposing||event.defaultPrevented)return;
    for(const hook of before)if(hook(event))return;
    const token=keyToken(event);if(!token)return;
    const global=table.find(entry=>entry.global&&live(entry,event)&&entry.keys===token&&!event.metaKey&&!event.altKey);
    if(global){event.preventDefault();clearPending();call(global,[],event);emit();return;}
    if(token==='<Esc>'){
      // One step toward NORMAL: pending keys first, then the current mode, then the page's own Escape.
      if(pending.length||count||register!==null){clearPending();emit();if(!guard(event)){event.preventDefault();return;}}
      const spec=modes.get(mode());
      if(mode()!=='normal'&&spec?.escape&&!guard(event)){event.preventDefault();spec.escape();emit();return;}
      escape(event);return;
    }
    if(guard(event)||event.metaKey||event.altKey)return;
    if(feed(token,event))event.preventDefault();
  }
  /** Hooks that see keys before the table (a panel's own keys); return true to consume. */
  function intercept(hook){before.push(hook);}

  // Status line ---------------------------------------------------------------
  function hintsFor(prefix){
    const seen=new Map();
    for(const entry of table){if(!entry.modes.includes(mode())||!live(entry))continue;const m=matchKeys(entry.tokens,prefix);if(m?.kind!=='prefix')continue;
      const next=entry.tokens[prefix.length],exact=entry.tokens.length===prefix.length+1;
      if(seen.has(next))continue;const label=exact?entry.hint:groups.get([...prefix,next].join(''));if(label)seen.set(next,label);}
    return [...seen].map(([token,label])=>`<kbd>${esc(keyLabel(token))}</kbd> ${esc(label)}`).join(' ');
  }
  /** The mode label and key hints the keymap owns, or null when the page decides (NORMAL, panels). */
  function status(){
    if(pending[0]==='<Space>')return {mode:'LEADER',keys:hintsFor(pending)};
    if(pending.length&&prefixes.has(pending[0]))return {mode:prefixes.get(pending[0]).label,keys:hintsFor(pending)};
    const spec=modes.get(mode());
    if(mode()!=='normal'&&spec)return {mode:spec.label(),keys:spec.hints?.()||''};
    return null;
  }
  let pendingEl=null;
  function renderPending(){
    pendingEl??=byId('status-pending');if(!pendingEl)return;
    const text=(count||'')+(register!==null?'"'+register:'')+(leads(pending[0])?'':pending.map(keyLabel).join(''));
    pendingEl.textContent=text;pendingEl.hidden=!text;
  }

  // Command line --------------------------------------------------------------
  /** Register an Ex command: {name, aliases?, args?, help, complete?(prefix)→[{value,label?}]|Promise, run(args, {bang})}. */
  function command(spec){commands.push(spec);scheduleHelp();return ()=>{const i=commands.indexOf(spec);if(i>=0)commands.splice(i,1);scheduleHelp();};}
  const visibleCommands=()=>commands.filter(c=>!c.when||c.when());
  function findCommand(name){
    const all=visibleCommands();
    const exact=all.find(c=>c.name===name||c.aliases?.includes(name));if(exact)return exact;
    const prefixed=all.filter(c=>c.name.startsWith(name));return name&&prefixed.length===1?prefixed[0]:null;
  }
  let history=[];try{const saved=JSON.parse(storage?.getItem('reader.commands.v1')||'[]');if(Array.isArray(saved))history=saved.filter(h=>typeof h==='string').slice(-LIMITS.history);}catch{}
  const line={form:null,input:null,menu:null,opener:null,choices:null,choice:-1,base:'',browse:-1,draft:''};
  function setupLine(){
    if(line.form)return true;
    line.form=byId('command-line');line.input=byId('command-input');line.menu=byId('command-menu');
    if(!line.form)return false;
    line.form.addEventListener('submit',event=>{event.preventDefault();execute(line.input.value);});
    line.input.addEventListener('input',()=>{line.choices=null;line.browse=-1;showChoices();});
    line.input.addEventListener('keydown',lineKey);
    line.input.addEventListener('blur',()=>setTimeout(()=>{if(mode()==='command'&&document.activeElement!==line.input)closeLine(false);},0));
    return true;
  }
  /** Open the command line in the status bar, optionally with text already typed. */
  function openLine(text=''){
    if(!setupLine())return;
    line.opener=document.activeElement;enter('command');
    byId('statusline')?.classList.add('commanding');
    line.form.hidden=false;line.input.value=text;line.choices=null;line.browse=-1;showChoices();line.input.focus();emit();
  }
  function closeLine(restore=true){
    if(!line.form||line.form.hidden)return;
    line.form.hidden=true;line.choices=null;showChoices();byId('statusline')?.classList.remove('commanding');
    leave('command');
    if(restore){const opener=line.opener;(opener?.isConnected&&opener!==document.body&&opener!==line.input?opener:byId('main'))?.focus({preventScroll:true});}
    line.opener=null;emit();
  }
  function lineKey(event){
    const key=event.key;
    if(key==='Escape'||key==='Backspace'&&!line.input.value||event.ctrlKey&&key==='c'){event.preventDefault();event.stopPropagation();closeLine();return;}
    if(key==='Tab'){event.preventDefault();complete(event.shiftKey?-1:1);return;}
    if(key==='ArrowUp'||key==='ArrowDown'||event.ctrlKey&&(key==='p'||key==='n')){event.preventDefault();recall(key==='ArrowUp'||key==='p'?-1:1);return;}
  }
  /** Up/Down: earlier commands that start with what is typed (per device). */
  function recall(delta){
    if(line.browse<0){line.draft=line.input.value;line.browse=history.length;}
    const matches=i=>history[i]?.startsWith(line.draft);
    let i=line.browse+delta;while(i>=0&&i<history.length&&!matches(i))i+=delta;
    if(i<0)return;if(i>=history.length){line.browse=history.length;line.input.value=line.draft;return;}
    line.browse=i;line.input.value=history[i];
  }
  async function choicesFor(text){
    const space=text.indexOf(' ');
    if(space<0)return visibleCommands().map(c=>c.name).filter(name=>name.startsWith(text)).sort().map(name=>({value:name,label:name}));
    const name=text.slice(0,space),spec=findCommand(name);if(!spec?.complete)return [];
    const typed=text.slice(space+1);
    const found=await spec.complete(typed);
    return (found||[]).slice(0,50).map(item=>typeof item==='string'?{value:item,label:item}:item).map(item=>({...item,value:spec.name+' '+item.value}));
  }
  /** Tab: complete the command name or its argument; repeated Tab cycles through the choices. */
  async function complete(delta){
    if(!line.choices){
      const text=line.input.value,choices=await choicesFor(text);if(line.input.value!==text)return;
      line.base=text;line.choices=choices;line.choice=-1;
      if(!choices.length){showChoices('No completions');return;}
    }
    if(!line.choices.length)return;
    line.choice=(line.choice+delta+line.choices.length)%line.choices.length;
    line.input.value=line.choices[line.choice].value;
    // A single command-name match completes with a trailing space, ready for its argument.
    if(line.choices.length===1&&!line.base.includes(' ')&&findCommand(line.input.value)?.args)line.input.value+=' ';
    if(line.choices.length===1)line.choices=null;
    showChoices();
  }
  function showChoices(message=''){
    if(!line.menu)return;
    if(message){line.menu.textContent=message;line.menu.hidden=false;return;}
    if(!line.choices||line.choices.length<2){line.menu.replaceChildren();line.menu.hidden=true;return;}
    const start=Math.max(0,Math.min(line.choice-2,line.choices.length-6));
    line.menu.innerHTML=line.choices.slice(start,start+6).map((c,i)=>`<span class="command-choice" role="option" aria-selected="${start+i===line.choice}">${esc(c.label||c.value)}</span>`).join('')+(line.choices.length>6?`<span class="command-more">${line.choice+1}/${line.choices.length}</span>`:'');
    line.menu.hidden=false;
  }
  /** Run a command line such as "theme paper"; unknown names toast the closest match. */
  async function execute(text){
    text=text.trim().replace(/^:+/,'');
    closeLine(false);
    if(!text){byId('main')?.focus({preventScroll:true});return;}
    history=[...history.filter(h=>h!==text),text].slice(-LIMITS.history);try{storage?.setItem('reader.commands.v1',JSON.stringify(history));}catch{}
    const match=text.match(/^(\S+?)(!?)(?:\s+(.*))?$/),name=match[1],bang=!!match[2],args=(match[3]||'').trim();
    const spec=findCommand(name);
    // Focus returns to the page first, so a command may move it again (a panel, a dialog).
    const opener=line.opener;(opener?.isConnected&&opener!==document.body?opener:byId('main'))?.focus({preventScroll:true});
    if(!spec){const near=closest(name,visibleCommands().map(c=>c.name));notify(`Not a command: :${name}.`+(near?` Did you mean :${near}?`:''),'error');return;}
    // A command may use the selection (:speak selection); afterwards VISUAL ends, as in Vim.
    try{await spec.run(args,{bang});}catch(error){console.error(error);notify(error.message||String(error),'error');}
    finally{for(let guard=0;stack.length>1&&guard<8;guard++){const top=stack.at(-1),exit=modes.get(top)?.escape;if(exit)exit();if(stack.at(-1)===top)stack.pop();}}
    emit();
  }

  // Help ----------------------------------------------------------------------
  let helpFrame=0;
  function scheduleHelp(){if(helpFrame)return;helpFrame=1;queueMicrotask(()=>{helpFrame=0;renderHelp();});}
  /** The help dialog's key lists, generated from the table and the commands. */
  function renderHelp(){
    const root=byId('help-keys');if(!root)return;
    const sections=new Map();
    for(const entry of table){if(!entry.help)continue;const name=entry.group||'Reading';if(!sections.has(name))sections.set(name,[]);sections.get(name).push(entry);}
    let html='';
    const rank=name=>{const i=sectionOrder.indexOf(name);return i<0?sectionOrder.length:i;};
    for(const [name,entries] of [...sections].sort((a,b)=>rank(a[0])-rank(b[0]))){
      html+=`<h3 class="help-group">${esc(name)}</h3><dl class="keymap">`+entries.map(entry=>`<dt>${entry.display?entry.display.split(' / ').map(part=>kbd(part.split(' '))).join(' / '):kbd(entry.tokens)}</dt><dd>${richHelp(entry.help)}</dd>`).join('')+'</dl>';
    }
    const documented=commands.filter(c=>c.help);
    if(documented.length)html+=`<h3 class="help-group">Command line</h3><p class="quiet">Press <kbd>:</kbd> to type a command in the status line. <kbd>Tab</kbd> completes, <kbd>↑</kbd> <kbd>↓</kbd> recall earlier commands, <kbd>Enter</kbd> runs, <kbd>Esc</kbd> cancels.</p><dl class="keymap commands">`+documented.map(c=>`<dt data-command="${esc(c.name)}"><kbd>:${esc(c.name)}${c.args?' '+esc(c.args):''}</kbd></dt><dd>${richHelp(c.help)}</dd>`).join('')+'</dl>';
    root.innerHTML=html;
  }
  /** Every key sequence a binding maps, for tests and the help. */
  const listed=()=>table.map(entry=>({mode:entry.modes,keys:entry.keys,help:entry.help||'',group:entry.group||'Reading',runs:!!entry.run,...(entry.display?{display:entry.display}:{})}));

  defineMode('command',{label:()=>'COMMAND',hints:()=>'',escape:()=>closeLine()});
  /** The help's section order; sections not named follow in the order their first key was mapped. */
  function order(names){sectionOrder=[...names];scheduleHelp();}
  const api={map,group,prefix,order,defineMode,enter,leave,mode,handle,intercept,status,command,openLine,closeLine,execute,renderHelp,listed,feed,clear(){clearPending();emit();},pending:()=>({keys:[...pending],count,register}),commands:()=>visibleCommands().map(c=>c.name)};
  return api;
}
