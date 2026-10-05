import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { editorInfoField, setIcon } from 'obsidian';
export interface Thread {
  kind?: 'highlight' | 'warning';
  id: string; document_path: string; owner: string; created_at: string; revision: number; resolved: boolean;
  anchor: { quote: string; start: number; end: number; prefix: string; suffix: string; source_sha256: string };
  comments: { id: string; author: string; body: string; created_at: string; reply_to: string | null }[];
  location?: { status: string; start?: number; end?: number };
}
export interface AnnotationHost {
  threadsFor(path: string): Thread[];
  participant(): string;
  openThread(id: string): Promise<void>;
  annotationEditors: Set<EditorView>;
}
export function annotationClass(thread: Thread, participant: string){
  return `reader-highlight ${thread.kind==='warning'?'reader-warning-annotation':thread.owner===participant?'reader-highlight-own':'reader-highlight-other'}`;
}
export function annotationTitle(thread: Thread){return `${thread.kind==='warning'?'Warning · ':''}${thread.owner} · ${thread.comments.length} comments`;}
export const annotationsChanged = StateEffect.define<null>();
export function locateQuote(text: string, anchor: Thread['anchor']): {from:number;to:number} | undefined {
  const positions: number[]=[];let offset=0;
  while(offset<=text.length) { const i=text.indexOf(anchor.quote,offset);if(i<0)break;positions.push(i);offset=i+1;if(positions.length>1000)return; }
  if(positions.length===1)return {from:positions[0],to:positions[0]+anchor.quote.length};
  const matches=positions.filter(i=>text.slice(Math.max(0,i-anchor.prefix.length),i)===anchor.prefix && text.slice(i+anchor.quote.length,i+anchor.quote.length+anchor.suffix.length)===anchor.suffix);
  if(matches.length===1)return {from:matches[0],to:matches[0]+anchor.quote.length};
}
class CommentIcon extends WidgetType {
  host: AnnotationHost; thread: Thread;
  constructor(host: AnnotationHost,thread: Thread){super();this.host=host;this.thread=thread;}
  eq(other: CommentIcon){return other.thread.id===this.thread.id && other.thread.revision===this.thread.revision;}
  toDOM(){
    const button=document.createElement('button');button.className='reader-comment-icon';setIcon(button,this.thread.kind==='warning'?'message-square-warning':'message-square');
    button.setAttribute('aria-label',`Open ${this.thread.owner}’s ${this.thread.kind==='warning'?'warning':'comment'} thread`);button.title=annotationTitle(this.thread);
    button.onclick=e=>{e.preventDefault();void this.host.openThread(this.thread.id);};return button;
  }
  ignoreEvent(){return true;}
}
export function annotationExtension(host: AnnotationHost){
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet; view: EditorView;
    constructor(view: EditorView){this.view=view;host.annotationEditors.add(view);this.decorations=this.build();}
    update(){this.decorations=this.build();}
    destroy(){host.annotationEditors.delete(this.view);}
    build(){
      const path=this.view.state.field(editorInfoField,false)?.file?.path;if(!path)return Decoration.none;
      const text=this.view.state.doc.toString();const ranges=[];
      for(const thread of host.threadsFor(path)) {
        if(thread.resolved)continue;const range=locateQuote(text,thread.anchor);if(!range)continue;
        ranges.push(Decoration.mark({class:annotationClass(thread,host.participant()),
          attributes:{title:annotationTitle(thread),'data-reader-thread':thread.id}}).range(range.from,range.to));
        ranges.push(Decoration.widget({widget:new CommentIcon(host,thread),side:1}).range(range.to));
      }
      return Decoration.set(ranges,true);
    }
  },{decorations:value=>value.decorations,eventHandlers:{click(event){
    const target=(event.target as HTMLElement).closest('[data-reader-thread]') as HTMLElement | null;
    if(target?.dataset.readerThread){void host.openThread(target.dataset.readerThread);return true;}return false;
  }}});
}
