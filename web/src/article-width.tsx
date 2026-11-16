import {useRef, useState} from 'react';
import {Slider} from './components/ui/slider';

export type ArticleWidthModel={shown:boolean;standard:number;max:number};
export type ArticleWidthActions={articleWidthPreview:(value:string)=>void;articleWidthCommit:()=>void};

const MIN=480,STEP=10,PRESETS:Record<string,number>={narrow:640,wide:960,wider:1200};
const position=(value:string,{standard,max}:ArticleWidthModel)=>Math.max(MIN,Math.min(max,value==='full'?max:PRESETS[value]??(/^\d+$/.test(value)?Number(value):standard)));
// The stop nearest Standard is Standard, and only that one, so the arrow keys can always step away from it again.
const choice=(px:number,{standard,max}:ArticleWidthModel)=>px>=max?'full':Math.abs(px-standard)<STEP/2?'standard':Object.keys(PRESETS).find(name=>PRESETS[name]===px)??String(px);
export const articleWidthLabel=(value:string)=>value==='standard'?'Standard':value==='full'?'Full window':`${PRESETS[value]??value} px`;

/** The footer's article width slider. The article rewraps as it moves; the choice is saved when it lets go. */
export function ArticleWidthControl({model,value,actions}:{model:ArticleWidthModel;value:string;actions:ArticleWidthActions}){
  const [moving,setMoving]=useState<number|null>(null),pointer=useRef(false);
  if(!model.shown)return null;
  const px=moving??position(value,model),label=articleWidthLabel(choice(px,model));
  return <div className="article-width" title={`Article width: ${label}`} onPointerDownCapture={()=>{pointer.current=true;}}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M1.5 3v10M14.5 3v10M4 8h8M6 6 4 8l2 2M10 6l2 2-2 2"/></svg>
    <span id="article-width-label" className="sr-only">Article width</span>
    <Slider aria-labelledby="article-width-label" min={MIN} max={model.max} step={STEP} value={[px]}
      onValueChange={next=>{const at=Array.isArray(next)?next[0]:next;setMoving(at);actions.articleWidthPreview(choice(at,model));}}
      onValueCommitted={()=>{actions.articleWidthCommit();setMoving(null);
        // Reading keys ignore a focused slider: after a drag they belong to the article again. Keyboard users keep focus.
        if(pointer.current&&document.activeElement instanceof HTMLElement)document.activeElement.blur();pointer.current=false;}}/>
    {moving!==null&&<output className="article-width-readout">{label}</output>}
  </div>;
}
