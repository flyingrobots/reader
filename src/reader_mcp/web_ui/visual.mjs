/** VISUAL and VISUAL LINE: select passages from the keyboard with a reading cursor, then highlight,
 *  comment, warn, speak, yank or search for more like them. Also the motions NORMAL shares with it
 *  (% footnotes, gd first use, zz/zt/zb), which work on the same text model. */
import {textModel,lineMove,lineEdge} from './cursor.mjs';
import {plural} from './logic.mjs';

export function installVisual({state,keys,reading,scrollToPosition,notify,captureSelection,createAnnotation,annotate,speak,registers,quickfix,links,jumps,report}){
  const $=selector=>document.querySelector(selector);
  const v={model:null,anchor:0,head:0,linewise:false,goal:null,remembered:null,flashTimer:0,flashed:null};
  const active=()=>keys.mode()==='visual';
  const highlights=()=>window.Highlight&&CSS.highlights?CSS.highlights:null;
  const article=()=>$('#article');
  const textual=()=>!!state.doc&&typeof state.doc.text==='string'&&!!article();

  /** Visible-area tests in either layout. */
  function view(){
    const book=reading.geometry();
    if(book){const box=book.viewport.getBoundingClientRect();return {book:true,top:box.top,bottom:box.bottom,left:box.left,right:box.right,width:box.width};}
    const status=$('#statusline')?.getBoundingClientRect().height||32;
    return {book:false,top:8,bottom:innerHeight-status-8,left:0,right:innerWidth,width:innerWidth};
  }
  const onScreen=(r,box=view())=>box.book?r.left>=box.left-1&&r.right<=box.right+1:r.top>=box.top-1&&r.bottom<=box.bottom+1;
  /** The first position on screen: the top of the window, or the left page of the spread. */
  function firstOnScreen(model){const box=view();return model.first(r=>box.book?r.left>=box.left-1:r.top>=box.top-1);}
  function lastOnScreen(model){const box=view();return Math.max(0,model.first(r=>box.book?r.left>=box.right-1:r.bottom>box.bottom+1)-1);}

  function enter(linewise=false){
    if(!textual()){notify(state.doc?'Keyboard selection works in text documents.':'Open a document to select a passage.');return;}
    const model=textModel(article());if(!model.length){notify('There is no text to select here.');return;}
    v.model=model;v.linewise=linewise;v.goal=null;
    // Start where the cursor last was in this document if that is still on screen, else at the first sentence on screen.
    let head=null;const kept=v.remembered;
    if(kept&&kept.path===state.doc.path&&kept.node.isConnected){const at=model.locate(kept.node,kept.offset);if(at<model.length&&onScreen(model.rect(at)))head=at;}
    if(head===null){
      const first=firstOnScreen(model),span=model.spanAt('sentences',first);
      head=span&&span[0]>=first?span[0]:model.nextStart('sentences',first);
      if(head>=model.length||!onScreen(model.rect(head)))head=Math.min(first,model.length-1);
    }
    v.anchor=v.head=linewise?model.blockStart(head):head;
    state.visual=true;$('#selection-tools').hidden=true;
    keys.enter('visual');draw();
  }
  function exit(){
    if(!v.model){keys.leave('visual');return;}
    const point=v.model.range(Math.min(v.head,v.model.length-1));if(point&&state.doc)v.remembered={path:state.doc.path,node:point.startContainer,offset:point.startOffset};
    v.model=null;state.visual=false;
    highlights()?.delete('reader-visual');highlights()?.delete('reader-cursor');
    getSelection()?.removeAllRanges();keys.leave('visual');
  }
  /** The selected span [lo, hi): blocks in VISUAL LINE. */
  function span(){
    const m=v.model;let lo=Math.min(v.anchor,v.head),hi=Math.max(v.anchor,v.head);
    if(v.linewise){lo=m.blockStart(lo);hi=m.blockEnd(hi);}
    return [lo,hi];
  }
  /** What an action applies to: the selection, or the sentence under the cursor when nothing is selected yet. */
  function effective(){
    const [lo,hi]=span();if(hi>lo)return v.model.trim(lo,hi);
    const sentence=v.model.spanAt('sentences',v.head);return sentence?v.model.trim(sentence[0],sentence[1]):[lo,hi];
  }
  /** The character the cursor shows: the last selected one when the selection grows forward. */
  const cursorAt=()=>{
    const m=v.model;let i=Math.min(m.length-1,v.head);
    if(!v.linewise&&v.head>v.anchor){i=v.head-1;while(i>v.anchor&&/\s/.test(m.text[i]))i--;}
    return Math.max(0,i);
  };
  function draw(reveal=true){
    const m=v.model;if(!m)return;const [lo,hi]=span(),registry=highlights(),at=cursorAt();
    const word=m.spanAt('words',at),[c0,c1]=word&&word[0]<=at?word:[at,at+1];
    if(registry){
      if(hi>lo)registry.set('reader-visual',new Highlight(m.range(lo,hi)));else registry.delete('reader-visual');
      registry.set('reader-cursor',new Highlight(m.range(c0,c1)));
    }
    // The page selection paints the selected text (::selection) and lets assistive technology read it. reader-visual has
    // no on-screen style; it carries the same range to the page-turn rasterizer. (A body class here would restyle the whole
    // document: over a second for a 2 MB article.)
    const selection=getSelection(),range=hi>lo?m.range(...m.trim(lo,hi)):m.range(at);
    if(selection&&range){selection.removeAllRanges();selection.addRange(range);}
    if(reveal)show(m.range(c0,c1));
    keys.clear();
  }
  /** Keep the cursor in view: scroll in continuous reading, turn the spread in two-page reading. */
  function show(range){
    if(!range)return;
    if(reading.geometry()){reading.reveal(range);return;}
    const r=range.getBoundingClientRect(),box=view();
    if(r.top<box.top+24||r.bottom>box.bottom-24)scrollToPosition(scrollY+r.top-innerHeight*.36,true,range);
  }
  /** Apply a motion count times; vertical motions keep the column they started in. */
  function move(step,{count}={},vertical=false){
    if(!v.model)return;if(!vertical)v.goal=null;
    for(let n=0;n<Math.max(1,count||1);n++){const next=step(v.head);if(next===v.head)break;v.head=next;}
    draw();
  }
  const m=()=>v.model;
  const line=delta=>i=>{
    if(v.linewise)return delta>0?m().nextBlock(i)>=m().length?i:m().nextBlock(i):m().prevBlock(i);
    v.goal??=m().rect(i).left;return lineMove(m(),i,delta,v.goal);
  };
  /** Select a text object around the cursor: is/as a sentence, ip/ap a paragraph or block. */
  function object(kind,around){
    const model=m(),at=cursorAt();
    if(kind==='p'){v.anchor=model.blockStart(at);v.head=model.blockEnd(at);}
    else{const s=model.spanAt('sentences',at)||[at,at];v.anchor=s[0];let end=s[1];if(around)while(end<model.length&&model.text[end]===' ')end++;v.head=end;}
    v.linewise=false;draw();
  }
  /** Capture the effective range as the page selection; true when it maps to source text. */
  function capture(){
    const [lo,hi]=effective();if(lo>=hi){notify('There is nothing to select here.');return false;}
    if(state.doc?.historical){notify('Historical versions are read-only. Open the current file to annotate or copy with its citation.');return false;}
    const range=m().range(lo,hi),selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    // The model's text is the rendered text, so this works even before the page has painted the selection.
    state.selected=null;captureSelection({range,quote:m().text.slice(lo,hi)});$('#selection-tools').hidden=true;
    return !!state.selected&&state.selected.path===state.doc?.path;
  }
  function act(fn){if(!v.model)return;try{fn();}finally{exit();}}
  /** Status: VISUAL · 2 sentences · 41 words. */
  function describe(){
    if(!v.model)return '';
    const model=m(),[lo,hi]=effective();let sentences=0,words=0;
    for(let b=model.blockIndex(lo),n=0;b<model.blocks.length&&model.blocks[b].start<hi&&n<20000;b++,n++){
      const {sentences:s,words:w}=model.segments(b);
      sentences+=s.filter(([a,e])=>e>lo&&a<hi).length;words+=w.filter(([a,e])=>a>=lo&&e<=hi).length;
    }
    return `${plural(sentences,'sentence')} · ${plural(words,'word')}`;
  }
  keys.defineMode('visual',{
    label:()=>v.linewise?'VISUAL LINE':'VISUAL',
    hints:()=>`<span class="status-count">${describe()}</span> <kbd>h</kbd> highlight <kbd>c</kbd> comment <kbd>!</kbd> warn <kbd>y</kbd> yank <kbd>Esc</kbd> cancel`,
    escape:exit,
  });

  // Footnotes, first use and alignment: shared by NORMAL and VISUAL ------------------------------
  /** `[^label]` markers in the text; a definition starts its block and is followed by a colon. */
  function footnotes(model){
    const found=[];for(const match of model.text.matchAll(/\[\^([^\]\s]{1,60})\]/g)){const index=match.index,end=index+match[0].length;found.push({index,end,label:match[1],definition:model.text[end]===':'&&model.blockStart(index)===index});}
    return found;
  }
  /** From a reference to its note, or from a note back to its first reference. */
  function footnoteFrom(model,at,{visibleOnly=false}={}){
    const marks=footnotes(model);if(!marks.length)return null;
    const box=view(),candidates=visibleOnly?marks.filter(mark=>onScreen(model.rect(mark.index),box)):marks;
    const here=candidates.find(mark=>mark.end>at)||(visibleOnly?candidates[0]:null);if(!here)return null;
    const target=here.definition?marks.find(mark=>!mark.definition&&mark.label===here.label):marks.find(mark=>mark.definition&&mark.label===here.label);
    return target||null;
  }
  /** First use of a term in the document: a whole-word, case-insensitive match. */
  function firstUse(model,term){
    term=term.trim();if(!term)return null;
    const pattern=new RegExp('(?<![\\p{L}\\p{N}_])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')+'(?![\\p{L}\\p{N}_])','iu');
    const match=pattern.exec(model.text);return match?{index:match.index,end:match.index+match[0].length}:null;
  }
  /** Briefly mark a place NORMAL jumped to (the cursor highlight, without entering VISUAL). */
  function flash(range){
    const registry=highlights();v.flashed=range;if(!registry||!range)return;
    registry.set('reader-cursor',new Highlight(range));clearTimeout(v.flashTimer);
    v.flashTimer=setTimeout(()=>{if(!active())registry.delete('reader-cursor');},1600);
  }
  function revealNormal(range){if(!range)return;jumps.record();const r=range.getBoundingClientRect();if(!reading.reveal(range))scrollToPosition(scrollY+r.top-innerHeight*.36,true,range);flash(range);}
  /** zt / zz / zb: put a place at the top, centre or bottom of the window (continuous reading). */
  function align(where){
    let range=null;
    if(v.model)range=m().range(cursorAt(),cursorAt()+1);
    else if(state.find?.length&&state.findIndex>=0)range=state.find[state.findIndex];
    else if(v.flashed?.startContainer?.isConnected)range=v.flashed;
    else if(document.activeElement&&article()?.contains(document.activeElement)){range=document.createRange();range.selectNode(document.activeElement);}
    if(!range){notify('Nothing to align yet: find a passage, follow a jump or select with v first.');return;}
    if(reading.geometry()){reading.reveal(range);return;}
    const r=range.getBoundingClientRect(),box=view();
    const top=where==='top'?scrollY+r.top-box.top-16:where==='bottom'?scrollY+r.bottom-box.bottom+16:scrollY+r.top-(box.top+box.bottom)/2+r.height/2;
    scrollToPosition(top,true,range);
  }
  const normalModel=()=>textual()?textModel(article()):null;
  function footnoteNormal(){
    const model=normalModel();if(!model){notify('Open a text document to follow footnotes.');return;}
    let at=0;const last=v.flashed;if(last?.startContainer?.isConnected&&onScreen(last.getBoundingClientRect()))at=model.locate(last.startContainer,last.startOffset);else at=firstOnScreen(model);
    const target=footnoteFrom(model,at,{visibleOnly:!(last?.startContainer?.isConnected&&onScreen(last.getBoundingClientRect()))});
    if(!target){notify('No footnote marker on this page.');return;}
    revealNormal(model.range(target.index,target.end));
  }
  function firstUseNormal(){
    const term=$('#find-query')?.value||state.fromSearch?.query||'';
    if(!term.trim()){notify('Find a term with / first, or select it with v, then press gd.');return;}
    const model=normalModel();if(!model)return;const hit=firstUse(model,term);
    if(!hit){notify('“'+term+'” is not in this document.');return;}
    revealNormal(model.range(hit.index,hit.end));
  }
  /** The link under the cursor, for K, gf and gx in VISUAL. */
  function linkAtCursor(){const range=m().range(cursorAt(),cursorAt()+1);const node=range?.startContainer;return (node?.nodeType===1?node:node?.parentElement)?.closest('a[href]')||null;}

  // Keys -----------------------------------------------------------------------------------------
  const sel='Selecting (v, V)';
  keys.map(
    {mode:'normal',keys:'v',when:()=>!!state.doc,run:()=>enter(false),group:sel,help:'Select from the keyboard: a reading cursor starts at the first sentence on screen'},
    {mode:'normal',keys:'V',when:()=>!!state.doc,run:()=>enter(true),group:sel,help:'Select whole blocks (paragraphs, list items, headings)'},
    {mode:'visual',keys:'v',run:()=>v.linewise?(v.linewise=false,draw(false)):exit()},
    {mode:'visual',keys:'V',run:()=>v.linewise?exit():(v.linewise=true,draw(false))},
    {mode:'visual',keys:'j',run:c=>move(line(1),c,true),group:sel,display:'j k / ↓ ↑',help:'Down / up a line (a block in VISUAL LINE); in two-page reading the spread turns at the page edge'},
    {mode:'visual',keys:'k',run:c=>move(line(-1),c,true)},
    {mode:'visual',keys:'<Down>',run:c=>move(line(1),c,true)},
    {mode:'visual',keys:'<Up>',run:c=>move(line(-1),c,true)},
    {mode:'visual',keys:'<Right>',run:c=>move(i=>Math.min(m().length,i+1),c),group:sel,display:'← / →',help:'One character back / forward'},
    {mode:'visual',keys:'<Left>',run:c=>move(i=>Math.max(0,i-1),c)},
    {mode:'visual',keys:'w',run:c=>move(i=>m().nextStart('words',i),c),group:sel,display:'w / b / e',help:'Next word / previous word / end of the word'},
    {mode:'visual',keys:'b',run:c=>move(i=>m().prevStart('words',i),c)},
    {mode:'visual',keys:'e',run:c=>move(i=>m().nextEnd('words',i),c)},
    {mode:'visual',keys:')',run:c=>move(i=>m().nextStart('sentences',i),c),group:sel,display:') / (',help:'Next sentence / start of this or the previous sentence; counts work: 3) selects three'},
    {mode:'visual',keys:'(',run:c=>move(i=>m().prevStart('sentences',i),c)},
    {mode:'visual',keys:'}',run:c=>move(i=>m().nextBlock(i),c),group:sel,display:'} / {',help:'Next paragraph or block / start of this or the previous one'},
    {mode:'visual',keys:'{',run:c=>move(i=>m().prevBlock(i),c)},
    {mode:'visual',keys:'0',run:()=>move(i=>lineEdge(m(),i,-1)),group:sel,display:'0 / $',help:'Start / end of the line'},
    {mode:'visual',keys:'$',run:()=>move(i=>lineEdge(m(),i,1))},
    {mode:'visual',keys:'gg',run:()=>move(()=>0),group:sel,display:'g g / G',help:'Start / end of the document'},
    {mode:'visual',keys:'G',run:()=>move(()=>m().length)},
    {mode:'visual',keys:'H',run:()=>move(()=>firstOnScreen(m())),group:sel,display:'H / M / L',help:'Top / middle / bottom of the screen (in two-page reading: the left page, the right page, the last line)'},
    {mode:'visual',keys:'M',run:()=>move(()=>{const box=view(),model=m();return box.book?model.first(r=>r.left>=box.left+box.width/2):lineEdge(model,model.first(r=>r.top>=(box.top+box.bottom)/2),-1);})},
    {mode:'visual',keys:'L',run:()=>move(()=>lineEdge(m(),lastOnScreen(m()),-1))},
    {mode:'visual',keys:'o',run:()=>{[v.anchor,v.head]=[v.head,v.anchor];draw();},group:sel,help:'Move the cursor to the other end of the selection'},
    {mode:'visual',keys:'is',run:()=>object('s',false),group:sel,display:'i s / a s',help:'Select the sentence under the cursor (a s includes the space after it)'},
    {mode:'visual',keys:'as',run:()=>object('s',true)},
    {mode:'visual',keys:'ip',run:()=>object('p',false),group:sel,display:'i p / a p',help:'Select the paragraph or block under the cursor'},
    {mode:'visual',keys:'ap',run:()=>object('p',true)},
    {mode:'visual',keys:'%',run:()=>{const t=footnoteFrom(m(),cursorAt());if(!t){notify('No footnote marker under the cursor.');return;}v.head=t.index;draw();}},
    {mode:'visual',keys:'gd',run:()=>{const [lo,hi]=span(),model=m(),word=model.spanAt('words',cursorAt());const term=hi>lo&&hi-lo<=80?model.text.slice(lo,hi):word?model.text.slice(word[0],word[1]):'';const hit=firstUse(model,term);if(!hit){notify('Nothing to look up under the cursor.');return;}v.anchor=v.head=hit.index;v.linewise=false;draw();}},
    {mode:'visual',keys:'zz',run:()=>align('middle')},{mode:'visual',keys:'zt',run:()=>align('top')},{mode:'visual',keys:'zb',run:()=>align('bottom')},
    {mode:'visual',keys:'h',run:()=>act(()=>{if(capture())createAnnotation('highlight').catch(report);}),group:sel,display:'h / c / !',help:'Highlight / comment on / leave a warning on the selection (with nothing selected yet: the sentence under the cursor)'},
    {mode:'visual',keys:'c',run:()=>act(()=>{if(capture())annotate('comment');})},
    {mode:'visual',keys:'!',run:()=>act(()=>{if(capture())annotate('warning');})},
    {mode:'visual',keys:'s',run:()=>act(()=>{if(capture())speak();}),group:sel,help:'Send the selection to AI-TTS'},
    {mode:'visual',keys:'y',run:({register})=>act(()=>{if(capture())registers.yank(register||'"',state.selected);}),group:sel,display:'y / " a y',help:'Yank the passage with its citation into the unnamed register, or into register a–z'},
    {mode:'visual',keys:'*',run:()=>{const [lo,hi]=effective(),text=m().text.slice(lo,hi).slice(0,1000);act(()=>{});quickfix.moreLike(text);},group:sel,help:'Find more like this: a meaning search for the selection, as a location list'},
    {mode:'visual',keys:'K',run:()=>{const a=linkAtCursor();exit();if(a){a.focus({preventScroll:true});links.preview(a);}else notify('The cursor is not on a link.');}},
    {mode:'visual',keys:'gf',run:()=>{const a=linkAtCursor();exit();if(a)links.follow(a);else notify('The cursor is not on a link.');}},
    {mode:'visual',keys:'gx',run:()=>{const a=linkAtCursor();exit();if(a)links.external(a);else notify('The cursor is not on a link.');}},
    {mode:'visual',keys:':',run:()=>keys.openLine()},
  );
  document.addEventListener('pointerdown',event=>{if(active()&&!event.target.closest?.('#statusline'))exit();},true);
  return {enter,exit,active,align,speak:()=>act(()=>{if(capture())speak();}),footnote:footnoteNormal,firstUse:firstUseNormal,flash,
    /** Test and command access: the current selection text. */
    text(){if(!v.model)return '';const [lo,hi]=effective();return v.model.text.slice(lo,hi);}};
}
