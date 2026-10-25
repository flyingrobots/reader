/** Registers, the quickfix list, marks and the jump list: local, per device and participant, and never
 *  written to the vault. Lists open in the right-side panel; ]q/[q, 'a and Ctrl-o/Ctrl-i walk them. */
import {escapeHTML as esc,plainQuote,plural} from './logic.mjs';

export const LIST_LIMITS={quote:16*1024,quickfix:500,jumps:100};
const REGISTERS='reader.registers.v1',QUICKFIX='reader.quickfix.v1',MARKS='reader.marks.v1';
const load=(key,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&typeof value==='object'?value:fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
/** A citation as Markdown: the quote as a block quote, then a link to its document. */
export function citation(entry){
  const quote=plainQuote(entry.quote).trim().split('\n').map(line=>'> '+line).join('\n');
  return `${quote}\n>\n> — [${(entry.title||entry.path).replace(/[[\]]/g,'')}](${entry.path.replace(/ /g,'%20')})\n`;
}
const sameSpot=(a,b)=>!!a&&!!b&&a.path===b.path&&a.offset===b.offset&&Math.abs((a.fraction||0)-(b.fraction||0))<.05;

export function installLists({state,api,notify,openAt,position,goTo,param=encodeURIComponent,onChange=()=>{}}){
  const $=selector=>document.querySelector(selector);
  const who=()=>state.prefs.participant||'You';
  const panel=$('#list-panel'),body=$('#list-body'),title=$('#list-title');
  let opener=null,current=null;

  // Registers ---------------------------------------------------------------------------------
  const registers={
    all(){const all=load(REGISTERS,{});return all[who()]&&typeof all[who()]==='object'?all[who()]:{};},
    get(name){return registers.all()[name]||null;},
    /** "a y: the passage, its path, edition and source offsets; a named yank also fills the unnamed register. */
    yank(name,selected){
      if(!selected)return;
      const entry={path:selected.path,sha256:selected.sha256,start:selected.start,end:selected.end,quote:String(selected.quote).slice(0,LIST_LIMITS.quote),title:String(state.doc?.metadata?.title||state.doc?.title||selected.path),at:new Date().toISOString()};
      const all=load(REGISTERS,{}),mine={...(all[who()]||{})};mine['"']=entry;if(name!=='"')mine[name]=entry;all[who()]=mine;
      const stored=save(REGISTERS,all);
      try{navigator.clipboard?.writeText(plainQuote(entry.quote)).catch(()=>{});}catch{}
      notify(stored?(name==='"'?'Copied with its citation.':`Copied with its citation to register ${name}.`):'Couldn’t keep the register in this browser’s storage.',stored?'success':'error');
      onChange();
    },
    /** Ctrl-r a in a writing box: the citation, as Markdown. */
    paste(name,target){
      const entry=registers.get(name);if(!entry){notify(`Register ${name} is empty. Select a passage with v and press "${name==='"'?'':name}y.`.replace('""','"'));return;}
      target.focus();const text=citation(entry);
      // insertText keeps undo and fires input events, so React-controlled boxes see the change.
      if(!document.execCommand('insertText',false,text)){const at=target.selectionStart??target.value.length;target.setRangeText(text,at,target.selectionEnd??at,'end');target.dispatchEvent(new Event('input',{bubbles:true}));}
    },
  };

  // Quickfix ----------------------------------------------------------------------------------
  let qf=load(QUICKFIX,null);if(!qf||!Array.isArray(qf.items))qf={title:'',items:[],index:-1};
  const quickfix={
    get:()=>qf,
    active:()=>qf.items.length>0,
    set(name,items,{show=true}={}){qf={title:name,items:items.slice(0,LIST_LIMITS.quickfix),index:-1};save(QUICKFIX,qf);onChange();if(show)lists.open('quickfix');},
    clear(){qf={title:'',items:[],index:-1};save(QUICKFIX,qf);if(current==='quickfix')close();onChange();},
    async go(index){
      if(!qf.items.length){notify('The location list is empty. Try :grep <words>.');return;}
      if(index<0||index>=qf.items.length){notify(index<0?'At the first location.':'At the last location.');return;}
      qf.index=index;save(QUICKFIX,qf);onChange();if(current==='quickfix')render();
      await openAt(qf.items[index]);
    },
    step(delta,count=1){return quickfix.go((qf.index<0&&delta>0?-1:qf.index)+delta*Math.max(1,count));},
    /** :grep — passages with these words, from the library's search index. */
    grep(query,mode='words'){
      query=query.trim().slice(0,1000);if(!query){notify('Type what to look for: :grep <words>.');return;}
      return search(query,mode,mode==='meaning'?'More like this':'grep '+query);
    },
    moreLike(text){text=text.replace(/\s+/g,' ').trim();if(!text){notify('Select a passage first.');return;}return search(text.slice(0,1000),'meaning','More like this');},
  };
  async function search(query,mode,name){
    let data;
    try{data=await api('/api/search/page?q='+param(query)+'&mode='+mode+'&limit=50&participant='+param(who()));}
    catch(error){if(!error.offline)notify('Search didn’t run: '+(error.message||error),'error');return;}
    const items=[];for(const work of data.works||[])for(const passage of work.passages||[])items.push({path:passage.path,title:work.title,label:passage.excerpt,at:{line:passage.line,page:passage.page,terms:data.terms||[],query},source:mode});
    if(!items.length){notify(`Nothing found for “${query.slice(0,60)}”.`);return;}
    quickfix.set(name,items);
    notify(`${plural(items.length,'location')} · ]q opens the next.`);
  }

  // Marks -------------------------------------------------------------------------------------
  const marks={
    all(){const all=load(MARKS,{});return all[who()]&&typeof all[who()]==='object'?all[who()]:{};},
    set(name){
      const spot=position();if(!spot){notify(state.doc?'Marks are for the current edition of a library document.':'Open a document to set a mark.');return;}
      const all=load(MARKS,{}),mine={...(all[who()]||{})};mine[spot.path]={...(mine[spot.path]||{}),[name]:{...spot,at:new Date().toISOString()}};all[who()]=mine;
      // Keep marks for the 200 most recently marked documents.
      const paths=Object.keys(mine);if(paths.length>200){paths.sort((a,b)=>Math.max(...Object.values(mine[a]).map(m=>Date.parse(m.at)||0))-Math.max(...Object.values(mine[b]).map(m=>Date.parse(m.at)||0)));for(const path of paths.slice(0,paths.length-200))delete mine[path];}
      save(MARKS,all);notify(`Mark ${name} set.`);onChange();
    },
    async jump(name){
      if(name==="'"){await jumps.swap();return;}
      const mark=state.doc&&marks.all()[state.doc.path]?.[name];
      if(!mark){notify(`No mark ${name} in this document. Set one with m${name}.`);return;}
      if(mark.sha256!==state.doc.sha256)notify(`This edition changed since mark ${name} was set; the place is approximate.`);
      jumps.record();await goTo(mark);
    },
  };

  // Jump list ---------------------------------------------------------------------------------
  let list=[],at=0;
  const jumps={
    /** Remember where you are before a jump (a search hit, a mark, gg, another document). */
    record(){const spot=position();if(!spot)return;list=list.slice(0,at);if(!sameSpot(list.at(-1),spot))list.push(spot);if(list.length>LIST_LIMITS.jumps)list=list.slice(-LIST_LIMITS.jumps);at=list.length;},
    async back(count=1){
      if(at===list.length){const spot=position();if(spot&&!sameSpot(list.at(-1),spot))list.push(spot);at=list.length-1;}
      if(at<=0){notify('No earlier place in the jump list.');return;}
      at=Math.max(0,at-Math.max(1,count));await goTo(list[at]);
    },
    async forward(count=1){
      if(at>=list.length-1){notify('No later place in the jump list.');return;}
      at=Math.min(list.length-1,at+Math.max(1,count));await goTo(list[at]);
    },
    /** '' — back to where you were before the latest jump, and again to return. */
    async swap(){
      const target=at<list.length?list[at]:list.at(-1);if(!target){notify('No earlier place to return to.');return;}
      const spot=position();list=list.slice(0,at<list.length?at:list.length-1);if(spot)list.push(spot);at=list.length;
      await goTo(target);
    },
    size:()=>list.length,
  };

  // The side panel ----------------------------------------------------------------------------
  function rows(kind){
    if(kind==='quickfix')return qf.items.map((item,index)=>({key:String(index+1),small:`${item.title||item.path}${item.at?.page?' · p. '+item.at.page:item.at?.line?' · line '+item.at.line:''}`,quote:item.label||'',current:index===qf.index,open:()=>quickfix.go(index)}));
    if(kind==='registers')return Object.entries(registers.all()).sort(([a],[b])=>a==='"'?-1:b==='"'?1:a.localeCompare(b)).map(([name,entry])=>({key:name==='"'?'"':'"'+name,small:entry.title,quote:plainQuote(entry.quote).slice(0,280),open:()=>openAt({path:entry.path,sha256:entry.sha256,start:entry.start,end:entry.end})}));
    if(kind==='marks'){
      const all=marks.all(),here=state.doc?.path,out=[];
      for(const [path,named] of Object.entries(all).sort(([a],[b])=>(a===here?-1:b===here?1:a.localeCompare(b))))for(const [name,mark] of Object.entries(named).sort())out.push({key:"'"+name,small:(path===here?'This document':state.data?.works?.find(w=>w.primary===path)?.title||path)+(mark.progress!=null?' · '+Math.round(mark.progress*100)+'%':''),quote:'',open:async()=>{if(path!==state.doc?.path)jumps.record();await goTo(mark);}});
      return out;
    }
    return [];
  }
  const TITLES={quickfix:()=>qf.title?`Locations · ${qf.title}`:'Locations',registers:()=>'Registers',marks:()=>'Marks'};
  const EMPTY={quickfix:'No locations yet. :grep <words> fills this list.',registers:'Nothing yanked yet. Select with v, then press y or "ay.',marks:'No marks yet. Press m and a letter to mark your place.'};
  function render(){
    if(!current)return;const items=rows(current);
    title.textContent=TITLES[current]();panel.dataset.mode=current.toUpperCase();
    body.innerHTML=items.length?items.map((item,index)=>`<button type="button" class="thread-list-item list-item${item.current?' current':''}" data-list-index="${index}"${item.current?' aria-current="true"':''}><small><kbd>${esc(item.key)}</kbd> ${esc(item.small)}</small>${item.quote?`<blockquote>${esc(item.quote)}</blockquote>`:''}</button>`).join(''):`<p class="empty-note">${esc(EMPTY[current])}</p>`;
    body.querySelectorAll('[data-list-index]').forEach(button=>button.onclick=()=>items[+button.dataset.listIndex].open());
  }
  const lists={
    /** Show a list in the side panel ('quickfix', 'registers' or 'marks'); focus moves into it. */
    open(kind){
      const active=document.activeElement;if(!panel.contains(active))opener=active&&active!==document.body?active:null;
      current=kind;render();panel.hidden=false;
      (body.querySelector('.list-item.current')||body.querySelector('.list-item')||title).focus({preventScroll:true});onChange();
    },
    close,
    isOpen:()=>!panel.hidden,
    contains:element=>panel.contains(element),
    refresh(){if(!panel.hidden)render();},
  };
  function close(restore=true){
    if(panel.hidden)return;panel.hidden=true;current=null;const back=opener;opener=null;
    if(restore)(back?.isConnected&&!back.closest('[hidden],dialog:not([open])')?back:$('#main')).focus({preventScroll:true});onChange();
  }
  $('#list-close').onclick=()=>close();
  // j / k or arrows between rows, as in the other panels; Enter opens one.
  body.addEventListener('keydown',event=>{
    const items=[...body.querySelectorAll('.list-item')],index=items.indexOf(document.activeElement);
    if(index<0||event.ctrlKey||event.metaKey||event.altKey)return;
    if(['j','k','ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();items[(index+(['j','ArrowDown'].includes(event.key)?1:-1)+items.length)%items.length].focus();}
    else if(event.key==='g'||event.key==='G'||event.key==='Home'||event.key==='End'){event.preventDefault();event.stopPropagation();items[event.key==='g'||event.key==='Home'?0:items.length-1].focus();}
  });
  return {registers,quickfix,marks,jumps,lists};
}
