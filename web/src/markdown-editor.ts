/** A reusable Markdown source editor: CodeMirror 6 with Vim keys, Markdown syntax highlighting in Reader's
 *  theme tokens and a monospace face. Loaded on demand (controls/editor.js); the scratch pad uses it and a
 *  journal can reuse it. Ex commands (`:w`, `:preview`, …) dispatch to the editor that ran them. */
import {EditorState} from '@codemirror/state';
import {EditorView,keymap,drawSelection,highlightActiveLine,placeholder as placeholderText} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import {markdownLanguage} from '@codemirror/lang-markdown';
import {HighlightStyle,LanguageSupport,syntaxHighlighting} from '@codemirror/language';
import {tags as t} from '@lezer/highlight';
import {vim,Vim,getCM} from '@replit/codemirror-vim';

export type EditorMode='NORMAL'|'INSERT'|'VISUAL'|'REPLACE';
export type EditorOptions={
  doc?:string;vim?:boolean;placeholder?:string;label?:string;
  onChange?:(text:string)=>void;
  /** The cursor as a code-point offset into the text (Reader's source coordinates count code points). */
  onCursor?:(offset:number)=>void;
  onMode?:(mode:EditorMode)=>void;
  /** Escape in Vim normal mode (the second Escape from insert mode): leave the editor. */
  onExit?:()=>void;
  /** Ctrl-r {a-z or "} in insert mode: paste that Reader register (Vim's own registers are not used). */
  onRegister?:(name:string)=>void;
  /** Ex commands by name: `:w` calls commands.write(args). */
  commands?:Record<string,(args:string)=>void>;
};
export type MarkdownEditor={view:EditorView;text():string;setText(text:string):void;insert(text:string):void;focus():void;mode():EditorMode;destroy():void};

const highlight=HighlightStyle.define([
  {tag:t.heading,color:'var(--accent)',fontWeight:'600'},
  {tag:t.strong,fontWeight:'700'},{tag:t.emphasis,fontStyle:'italic'},{tag:t.strikethrough,textDecoration:'line-through'},
  {tag:[t.link,t.url],color:'var(--own)'},{tag:t.monospace,color:'var(--ink)'},
  {tag:t.quote,color:'var(--muted)',fontStyle:'italic'},{tag:t.list,color:'var(--accent)'},
  {tag:[t.processingInstruction,t.meta,t.contentSeparator,t.labelName],color:'var(--muted)'},
]);
const theme=EditorView.theme({
  '&':{color:'var(--ink)',backgroundColor:'var(--surface)',height:'100%',fontSize:'14px'},
  '.cm-scroller':{fontFamily:'var(--mono)',lineHeight:'1.65',padding:'14px 0'},
  '.cm-content':{caretColor:'var(--accent)',padding:'0 18px'},
  '.cm-cursor, .cm-dropCursor':{borderLeftColor:'var(--accent)'},
  '.cm-fat-cursor':{background:'var(--accent)',color:'var(--accent-ink)'},
  '&:not(.cm-focused) .cm-fat-cursor':{background:'none',outline:'solid 1px var(--accent)',color:'transparent'},
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':{backgroundColor:'color-mix(in srgb, var(--accent) 28%, transparent)'},
  '.cm-activeLine':{backgroundColor:'color-mix(in srgb, var(--ink) 4%, transparent)'},
  '.cm-placeholder':{color:'var(--faint)'},
  '.cm-panels':{backgroundColor:'var(--raised)',color:'var(--ink)',borderTop:'1px solid var(--line)'},
  '.cm-vim-panel input':{color:'var(--ink)',fontFamily:'var(--mono)'},
  '&.cm-focused':{outline:'none'},
});

const editors=new WeakMap<EditorView,EditorOptions>();
const ex=new Set<string>();
/** Route `:name args` to the running editor's handler; the first editor to define a name registers it with Vim. */
function defineEx(name:string,prefix:string){
  if(ex.has(name))return;ex.add(name);
  Vim.defineEx(name,prefix,(cm:any,params:any)=>{const view:EditorView|undefined=cm?.cm6;const handler=view&&editors.get(view)?.commands?.[name];if(handler)handler((params?.argString||'').trim());});
}
const codePoints=(text:string,end:number)=>{let n=0;for(let i=0;i<end;i++){const c=text.charCodeAt(i);if(c<0xd800||c>0xdbff||i+1>=end)n++;}return n;};

export function createMarkdownEditor(parent:HTMLElement,options:EditorOptions={}):MarkdownEditor{
  let mode:EditorMode='NORMAL';
  const extensions=[
    ...(options.vim===false?[]:[vim()]),
    history(),drawSelection(),highlightActiveLine(),EditorView.lineWrapping,new LanguageSupport(markdownLanguage),syntaxHighlighting(highlight),theme,
    keymap.of([...defaultKeymap,...historyKeymap]),
    EditorView.contentAttributes.of({'aria-label':options.label||'Markdown source','spellcheck':'true'}),
    ...(options.placeholder?[placeholderText(options.placeholder)]:[]),
    EditorView.updateListener.of(update=>{
      if(update.docChanged)options.onChange?.(update.state.doc.toString());
      if(update.docChanged||update.selectionSet){const head=update.state.selection.main.head;options.onCursor?.(codePoints(update.state.doc.sliceString(0,head),head));}
    }),
  ];
  const view=new EditorView({state:EditorState.create({doc:options.doc||'',extensions}),parent});
  editors.set(view,options);
  for(const name of Object.keys(options.commands||{}))defineEx(name,name);
  const cm=options.vim===false?null:getCM(view);
  if(cm){(cm as any).on('vim-mode-change',(event:{mode:string;subMode?:string})=>{mode=event.mode==='insert'?'INSERT':event.mode==='visual'?'VISUAL':event.mode==='replace'?'REPLACE':'NORMAL';options.onMode?.(mode);});}
  else mode='INSERT';
  // Escape in normal mode leaves the editor; Vim handles every other Escape (insert or visual back to normal).
  view.dom.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.isComposing)return;
    const state=(cm as any)?.state?.vim;
    const normal=cm?!state?.insertMode&&!state?.visualMode&&!state?.inputState?.operator&&!view.dom.querySelector('.cm-vim-panel input'):true;
    if(normal){event.preventDefault();event.stopPropagation();options.onExit?.();}
  },true);
  // Ctrl-r then a register name, in insert mode, before Vim sees either key.
  let awaitingRegister=false;
  if(options.onRegister)view.dom.addEventListener('keydown',event=>{
    if(event.isComposing||['Shift','Control','Alt','Meta','CapsLock'].includes(event.key))return;
    if(awaitingRegister){
      awaitingRegister=false;event.preventDefault();event.stopPropagation();
      if(/^[a-z"]$/.test(event.key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey)options.onRegister?.(event.key);
      return;
    }
    const insert=cm?!!(cm as any).state?.vim?.insertMode:true;
    if(insert&&event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key==='r'){event.preventDefault();event.stopPropagation();awaitingRegister=true;}
  },true);
  view.dom.addEventListener('blur',()=>{awaitingRegister=false;},true);
  return {
    view,
    text:()=>view.state.doc.toString(),
    setText(text){view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text}});},
    insert(text){const at=view.state.selection.main;view.dispatch({changes:{from:at.from,to:at.to,insert:text},selection:{anchor:at.from+text.length}});view.focus();},
    focus(){view.focus();},
    mode:()=>mode,
    destroy(){editors.delete(view);view.destroy();},
  };
}
